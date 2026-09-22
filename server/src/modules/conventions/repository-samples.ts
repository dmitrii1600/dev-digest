import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, resolve, sep } from 'node:path';
import {
  CONFIG_SKIP_DIRS,
  MAX_CONFIG_CHARS,
  MAX_CONFIG_FILES,
  MAX_SAMPLE_LINES,
  SAMPLE_TOKEN_BUDGET,
} from './constants.js';
import { isConfigFileName, normaliseRelPath, renderSample, type Sample, type SampleSet } from './helpers.js';

/**
 * The clone reader — ring 3, because the filesystem is. Selects the sample
 * files in CODE (configs + the ranked paths the caller got from `repoIntel`),
 * reads them with a traversal guard, and budgets them by tokens. No model call
 * anywhere in this file (criterion 39).
 */

/**
 * Config files in the clone root and one directory down (per-package repos
 * keep `tsconfig.json` / `eslint.config.mjs` per package). Root first, then
 * subdirectories alphabetically; capped at `MAX_CONFIG_FILES`.
 */
export async function findConfigFiles(clonePath: string): Promise<string[]> {
  const out: string[] = [];
  const rootEntries = await readdir(clonePath, { withFileTypes: true }).catch(() => []);
  for (const e of rootEntries) {
    if (e.isFile() && isConfigFileName(e.name)) out.push(e.name);
  }
  const dirs = rootEntries
    .filter((e) => e.isDirectory() && !CONFIG_SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  for (const dir of dirs) {
    const entries = await readdir(join(clonePath, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile() && isConfigFileName(e.name)) out.push(posix.join(dir, e.name));
    }
  }
  return out.slice(0, MAX_CONFIG_FILES);
}

/**
 * Read one sample. Refuses paths that resolve outside the clone, directories,
 * missing files and binaries (a NUL byte in the first KiB). Truncates to
 * `maxLines` with a marker so the model knows it did not see the end.
 */
export async function readSample(
  clonePath: string,
  rel: string,
  kind: Sample['kind'],
  maxLines = MAX_SAMPLE_LINES,
): Promise<Sample | null> {
  const norm = normaliseRelPath(rel);
  if (!norm) return null;
  const root = resolve(clonePath);
  const full = resolve(root, norm);
  if (full !== root && !full.startsWith(root + sep)) return null;
  const st = await stat(full).catch(() => null);
  if (!st || !st.isFile()) return null;
  const text = await readFile(full, 'utf8').catch(() => null);
  if (text === null) return null;
  if (text.slice(0, 1024).includes('\0')) return null;
  const body = kind === 'config' && text.length > MAX_CONFIG_CHARS ? text.slice(0, MAX_CONFIG_CHARS) : text;
  let lines = body.replace(/\r\n?/g, '\n').split('\n');
  let truncated = body.length < text.length;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }
  return { path: norm, kind, lines, truncated };
}

/**
 * Configs first, then code in rank order, until the token budget is spent. A
 * sample that would overflow the budget is skipped, not cut, so every included
 * file is citable end to end. Returns the ordered list that actually went in.
 */
export async function collectSamples(
  clonePath: string,
  codePaths: string[],
  count: (text: string) => number,
  budget = SAMPLE_TOKEN_BUDGET,
): Promise<SampleSet> {
  const samples: Sample[] = [];
  let spent = 0;
  const tryAdd = async (rel: string, kind: Sample['kind']) => {
    if (samples.some((s) => s.path === rel)) return;
    const sample = await readSample(clonePath, rel, kind);
    if (!sample) return;
    const cost = count(renderSample(sample));
    if (spent + cost > budget) return;
    spent += cost;
    samples.push(sample);
  };
  for (const rel of await findConfigFiles(clonePath)) await tryAdd(rel, 'config');
  for (const rel of codePaths) await tryAdd(rel, 'code');
  return { samples, sampledFiles: samples.map((s) => s.path) };
}
