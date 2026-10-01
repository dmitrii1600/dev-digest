import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Dirent } from 'node:fs';
import {
  CONTEXT_EXCLUDED_DIRS,
  MAX_CONTEXT_FILES,
  MAX_DOC_BYTES,
  TRUNCATION_MARKER,
} from './constants.js';

/**
 * The clone reader for Project Context — ring 3, because the filesystem is.
 * Same guard shape as `modules/intent/repository-plans.ts`.
 */

export interface ListedFile {
  path: string;
  size: number;
  mtime: string;
}
export interface MarkdownListing {
  cloned: boolean;
  total: number;
  files: ListedFile[];
}
export interface ReadDoc {
  text: string;
  truncated: boolean;
  /** SHA-256 hex of the FULL on-disk bytes (before truncation); runs ignore it. */
  version: string;
}

const EXCLUDED = new Set<string>(CONTEXT_EXCLUDED_DIRS);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (EXCLUDED.has(e.name)) continue;
      await walk(root, join(dir, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(relative(root, join(dir, e.name)).split(sep).join('/'));
    }
  }
}

export async function listMarkdown(clonePath: string | null): Promise<MarkdownListing> {
  const none: MarkdownListing = { cloned: false, total: 0, files: [] };
  if (!clonePath) return none;
  const root = resolve(clonePath);
  const rs = await stat(root).catch(() => null);
  if (!rs || !rs.isDirectory()) return none;

  const rels: string[] = [];
  await walk(root, root, rels);
  rels.sort();
  const files: ListedFile[] = [];
  for (const path of rels.slice(0, MAX_CONTEXT_FILES)) {
    const st = await stat(join(root, path)).catch(() => null);
    if (!st) continue;
    files.push({ path, size: st.size, mtime: st.mtime.toISOString() });
  }
  return { cloned: true, total: rels.length, files };
}

function isAbsoluteLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p);
}

/** Never throws. `null` = missing, unreadable, binary, or outside the clone. */
export async function readDoc(clonePath: string, relPath: string): Promise<ReadDoc | null> {
  try {
    if (isAbsoluteLike(relPath)) return null;
    const norm = relPath.replaceAll('\\', '/').replace(/^\.\//, '');
    if (norm.length === 0) return null;
    if (norm.split('/').some((seg) => seg === '..' || seg === '')) return null;

    const root = resolve(clonePath);
    const full = resolve(root, norm);
    if (full !== root && !full.startsWith(root + sep)) return null;

    const realRoot = await realpath(root);
    const realFull = await realpath(full);
    if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) return null;

    const st = await stat(realFull);
    if (!st.isFile()) return null;
    const buf = await readFile(realFull);
    const version = createHash('sha256').update(buf).digest('hex');
    if (buf.subarray(0, 1024).includes(0)) return null;

    if (buf.length <= MAX_DOC_BYTES) return { text: buf.toString('utf8'), truncated: false, version };
    let text = buf.subarray(0, MAX_DOC_BYTES).toString('utf8');
    // A split multi-byte sequence decodes to U+FFFD at the tail — trim it.
    while (text.endsWith('�')) text = text.slice(0, -1);
    return { text: text + TRUNCATION_MARKER, truncated: true, version };
  } catch {
    return null;
  }
}
