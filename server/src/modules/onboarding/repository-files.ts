import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  EXCERPT_MAX_LINES,
  README_MAX_CHARS,
  RUN_SOURCE_FILES,
  RUN_SOURCE_MAX_CHARS,
  TRUNCATION_MARKER,
} from './constants.js';
import { isSecretEnvFile, type SourceText } from './helpers.js';

/**
 * The clone reader for the onboarding generator — ring 3, because the
 * filesystem is. Reads the root run-sources (README, package.json, …) and the
 * ranked excerpts. Same traversal guard as
 * `modules/project-context/repository-files.ts`. No model call in this file.
 * Never throws: anything unreadable is skipped.
 */

/** Bytes read per char of cap — enough for multi-byte text without reading a whole big file. */
const BYTES_PER_CHAR = 4;
/** Upper bound on the bytes read for one excerpt. */
const EXCERPT_MAX_BYTES = 256 * 1024;

const RUN_SOURCE_ORDER = RUN_SOURCE_FILES.map((n) => n.toLowerCase());

/** First `maxBytes` of a file as utf8; `null` for a binary (NUL in the first KiB). */
async function readHead(path: string, maxBytes: number): Promise<{ text: string; cut: boolean } | null> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await fh.read(buf, 0, maxBytes + 1, 0);
    const cut = bytesRead > maxBytes;
    const slice = buf.subarray(0, Math.min(bytesRead, maxBytes));
    if (slice.subarray(0, 1024).includes(0)) return null;
    let text = slice.toString('utf8');
    // A split multi-byte sequence decodes to U+FFFD at the tail — trim it.
    if (cut) while (text.endsWith('�')) text = text.slice(0, -1);
    return { text, cut };
  } finally {
    await fh.close();
  }
}

/**
 * The allowlisted root files that exist in the clone, in allowlist order. Root
 * only, regular files only (`lstat`, so a symlink is skipped), and a secret
 * `.env*` file is never opened.
 */
export async function readRunSources(clonePath: string): Promise<SourceText[]> {
  try {
    const root = resolve(clonePath);
    const entries = await readdir(root, { withFileTypes: true });
    const byLower = new Map<string, string>();
    for (const e of entries) {
      if (isSecretEnvFile(e.name)) continue;
      const lower = e.name.toLowerCase();
      if (RUN_SOURCE_ORDER.includes(lower) && !byLower.has(lower)) byLower.set(lower, e.name);
    }

    const out: SourceText[] = [];
    for (const lower of RUN_SOURCE_ORDER) {
      const name = byLower.get(lower);
      if (!name) continue;
      try {
        const full = join(root, name);
        const st = await lstat(full);
        if (!st.isFile()) continue;
        const cap = lower.startsWith('readme') ? README_MAX_CHARS : RUN_SOURCE_MAX_CHARS;
        const head = await readHead(full, cap * BYTES_PER_CHAR);
        if (!head) continue;
        const over = head.text.length > cap;
        const text = over ? head.text.slice(0, cap) : head.text;
        out.push({ path: name, text: over || head.cut ? text + TRUNCATION_MARKER : text });
      } catch {
        // unreadable → skipped
      }
    }
    return out;
  } catch {
    return [];
  }
}

function isAbsoluteLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * The first `EXCERPT_MAX_LINES` lines of each path, in the order given.
 * Refuses absolute paths, `..` segments and anything whose real path leaves
 * the clone; skips missing, unreadable and binary files.
 */
export async function readExcerpts(clonePath: string, paths: string[]): Promise<SourceText[]> {
  const out: SourceText[] = [];
  let realRoot: string;
  try {
    realRoot = await realpath(resolve(clonePath));
  } catch {
    return out;
  }
  const root = resolve(clonePath);

  for (const rel of paths) {
    try {
      if (isAbsoluteLike(rel)) continue;
      const norm = rel.replaceAll('\\', '/').replace(/^\.\//, '');
      if (norm.length === 0 || norm.split('/').some((seg) => seg === '..' || seg === '')) continue;

      const full = resolve(root, norm);
      if (full !== root && !full.startsWith(root + sep)) continue;
      const realFull = await realpath(full);
      if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) continue;

      const st = await stat(realFull);
      if (!st.isFile()) continue;
      const head = await readHead(realFull, EXCERPT_MAX_BYTES);
      if (!head) continue;

      const lines = head.text.replace(/\r\n?/g, '\n').split('\n');
      const cut = head.cut || lines.length > EXCERPT_MAX_LINES;
      const text = lines.slice(0, EXCERPT_MAX_LINES).join('\n') + (cut ? TRUNCATION_MARKER : '');
      out.push({ path: norm, text });
    } catch {
      // unreadable → skipped
    }
  }
  return out;
}
