import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { SPECS_ROOT } from './constants.js';

/**
 * The clone writer for Project Context — ring 3, because the filesystem is.
 * Pure name/content rules live in `helpers.ts`; the orchestration (locking,
 * version checks, tracked check) lives in `service.ts`. Every function here is
 * small and stateless so the service can be tested against a tmp clone.
 *
 * Containment rule (server/INSIGHTS.md "clone dir reached through a junction"):
 * `realRoot` is `realpath(clonePath)`, resolved once. A junction AT the clone
 * root is therefore fine; a symlink or junction BELOW it is refused.
 */

const RENAME_ATTEMPTS = 8;

export type LayoutResult =
  | { ok: true; abs: string; exists: boolean }
  | { ok: false; rule: 'layout' };

export interface CurrentFile {
  bytes: Buffer;
  version: string;
  size: number;
  /** ISO modification time. */
  mtime: string;
}

/** SHA-256 hex of the bytes — the optimistic-concurrency token. */
export function versionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

/** `realpath(clonePath)`, or `null` when the clone is not a readable directory. */
export async function resolveRealRoot(clonePath: string): Promise<string | null> {
  try {
    return await realpath(resolve(clonePath));
  } catch {
    return null;
  }
}

function absFor(realRoot: string, relPath: string): string {
  return join(realRoot, ...relPath.split('/'));
}

/**
 * Walk every segment of `relDir` below `realRoot` with `lstat`. A segment that is a
 * symlink, a junction (`isSymbolicLink()` covers both) or not a directory fails
 * with `layout`. A missing segment is created (non-recursive `mkdir`, then
 * re-`lstat`ed) when `createDirs`, otherwise the walk ends with `exists: false`.
 */
export async function checkDir(
  realRoot: string,
  relDir: string,
  opts: { createDirs: boolean },
): Promise<LayoutResult> {
  let cur = realRoot;
  for (const seg of relDir.split('/').filter((s) => s !== '')) {
    cur = join(cur, seg);
    let st = await lstat(cur).catch((e: unknown) => {
      if (isErrno(e, 'ENOENT')) return null;
      throw e;
    });
    if (!st) {
      if (!opts.createDirs) return { ok: true, abs: absFor(realRoot, relDir), exists: false };
      await mkdir(cur).catch((e: unknown) => {
        if (!isErrno(e, 'EEXIST')) throw e; // a concurrent create won the race; re-lstat below
      });
      st = await lstat(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, rule: 'layout' };
  }
  return { ok: true, abs: absFor(realRoot, relDir), exists: true };
}

/**
 * Same walk for the folders above the target, then the target itself must not be a
 * symlink and must be a regular file when it exists. Returns the absolute target.
 */
export async function checkLayout(
  realRoot: string,
  relPath: string,
  opts: { createDirs: boolean },
): Promise<LayoutResult> {
  const idx = relPath.lastIndexOf('/');
  const dir = idx === -1 ? '' : relPath.slice(0, idx);
  const abs = absFor(realRoot, relPath);
  const res = await checkDir(realRoot, dir, opts);
  if (!res.ok || !res.exists) return res.ok ? { ok: true, abs, exists: false } : res;
  const st = await lstat(abs).catch((e: unknown) => {
    if (isErrno(e, 'ENOENT')) return null;
    throw e;
  });
  if (!st) return { ok: true, abs, exists: false };
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, rule: 'layout' };
  return { ok: true, abs, exists: true };
}

/** `null` on ENOENT. */
export async function readCurrent(abs: string): Promise<CurrentFile | null> {
  try {
    const bytes = await readFile(abs);
    const st = await stat(abs);
    return { bytes, version: versionOf(bytes), size: bytes.length, mtime: st.mtime.toISOString() };
  } catch (e) {
    if (isErrno(e, 'ENOENT')) return null;
    throw e;
  }
}

/** Entry names of a directory; `[]` when it does not exist. */
export async function listNames(absDir: string): Promise<string[]> {
  try {
    return await readdir(absDir);
  } catch (e) {
    if (isErrno(e, 'ENOENT')) return [];
    throw e;
  }
}

/** `wx`: lets `EEXIST` surface so the caller can pick the next free name. */
export async function createExclusive(abs: string, bytes: Uint8Array): Promise<void> {
  await writeFile(abs, bytes, { flag: 'wx' });
}

/** Non-recursive `mkdir`: lets `EEXIST` surface. */
export async function mkdirExclusive(abs: string): Promise<void> {
  await mkdir(abs);
}

/**
 * Windows refuses `rename` over a file another process has open (EPERM/EBUSY/EACCES)
 * for a few milliseconds; retry briefly before surfacing it. POSIX never retries.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const transient = isErrno(e, 'EPERM') || isErrno(e, 'EBUSY') || isErrno(e, 'EACCES');
      if (!transient || attempt >= RENAME_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 10 * attempt));
    }
  }
}

/**
 * Write a sibling temp file, then `rename` it over the target. The temp name never
 * ends in `.md`, so the listing cannot show it. Removed again on failure.
 */
export async function replaceAtomic(abs: string, bytes: Uint8Array): Promise<void> {
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, bytes, { flag: 'wx' });
    await renameWithRetry(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/**
 * Unlink the file, then `rmdir` each now-empty parent up to and EXCLUDING
 * `<realRoot>/.devdigest/specs`. A non-empty parent stops the walk.
 */
export async function removeAndPrune(realRoot: string, abs: string): Promise<void> {
  await unlink(abs);
  const stop = absFor(realRoot, SPECS_ROOT);
  let dir = dirname(abs);
  while (dir !== stop && dir.startsWith(stop + sep)) {
    try {
      await rmdir(dir);
    } catch {
      return; // ENOTEMPTY (or anything else): leave it
    }
    dir = dirname(dir);
  }
}
