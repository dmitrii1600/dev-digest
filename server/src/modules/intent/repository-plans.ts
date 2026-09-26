import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { MAX_PLAN_CHARS } from './constants.js';

/**
 * The clone reader for tier B (in-repo plan/spec files) — ring 3, because the
 * filesystem is. The one file in `modules/intent/` allowed `node:fs`, exactly
 * as `modules/conventions/repository-samples.ts` is for its module (the
 * sanctioned place for filesystem reads; `helpers.ts` stays pure).
 *
 * `relPath` is attacker-influenced: it comes from a PR body, either a
 * repo-relative path or the path segment of a same-repo GitHub blob URL
 * (`detectPlanRefs`, ring 2, classification only). This function is the guard.
 */

/** True for anything that is not a plain repo-relative path — reject outright,
 *  never silently rebase it under the clone root. */
function isAbsoluteLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Read one repo-relative file from the clone. Refuses an absolute path, any
 * `..` segment, and a symlink that resolves outside the clone (checked via
 * `realpath`, which the traversal check in `repository-samples.ts` does not
 * need to do because samples are chosen from the ranked index, not a PR body).
 * Skips binaries; truncates at `MAX_PLAN_CHARS` with a marker.
 *
 * Returns `null` — never throws — for anything that isn't a clean, readable,
 * in-bounds text file: a missing plan is an `unavailable` source, not a
 * failed run.
 */
export async function readRepoFile(clonePath: string, relPath: string): Promise<string | null> {
  if (isAbsoluteLike(relPath)) return null;

  const norm = relPath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (norm.length === 0) return null;
  if (norm.split('/').some((seg) => seg === '..' || seg === '')) return null;

  const root = resolve(clonePath);
  const full = resolve(root, norm);
  if (full !== root && !full.startsWith(root + sep)) return null;

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = await realpath(root);
    realFull = await realpath(full);
  } catch {
    return null; // clone root or target missing — an unavailable source, not a failure
  }
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) return null; // symlink escape

  const st = await stat(realFull).catch(() => null);
  if (!st || !st.isFile()) return null;

  const buf = await readFile(realFull).catch(() => null);
  if (buf === null) return null;
  if (buf.subarray(0, 1024).includes(0)) return null; // binary

  const text = buf.toString('utf8');
  return text.length > MAX_PLAN_CHARS ? `${text.slice(0, MAX_PLAN_CHARS)}\n… (truncated)` : text;
}
