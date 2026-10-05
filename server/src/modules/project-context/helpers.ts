import type { ContextDocKind, ContextReadOnlyReason } from '@devdigest/shared';
import { MAX_DOC_BYTES, MAX_NAME_BYTES, SPECS_ROOT } from './constants.js';

/** Pure rules — no I/O. Kind is derived from the path alone (first match wins). */
export function kindForPath(path: string): ContextDocKind {
  const segments = path.split('/');
  const dirs = segments.slice(0, -1);
  const base = segments[segments.length - 1] ?? '';
  if (dirs.includes('specs')) return 'specs';
  if (dirs.includes('docs')) return 'docs';
  if (base === 'INSIGHTS.md' || dirs.includes('insights')) return 'insights';
  return 'other';
}

/** Agent paths first, then each skill's list in order; first occurrence wins. */
export function orderForInjection(
  agentPaths: readonly string[],
  skillPathLists: ReadonlyArray<readonly string[]>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [agentPaths, ...skillPathLists]) {
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Distinct agents per path. */
export function countUsedBy(
  pairs: ReadonlyArray<{ agentId: string; path: string }>,
): Map<string, number> {
  const agentsByPath = new Map<string, Set<string>>();
  for (const { agentId, path } of pairs) {
    let set = agentsByPath.get(path);
    if (!set) agentsByPath.set(path, (set = new Set()));
    set.add(agentId);
  }
  const out = new Map<string, number>();
  for (const [path, set] of agentsByPath) out.set(path, set.size);
  return out;
}

/** Requested paths not already persisted — only these need the listing check. */
export function newPaths(requested: readonly string[], persisted: readonly string[]): string[] {
  const have = new Set(persisted);
  return requested.filter((p) => !have.has(p));
}

// ---- Authoring rules (pure; the writer in repository-writes.ts does the I/O) ----

const ROOT_PREFIX = `${SPECS_ROOT}/`;

/** True only for a path that starts with exactly `.devdigest/specs/` (case-sensitive) plus a segment. */
export function isUnderSpecsRoot(path: string): boolean {
  return path.startsWith(ROOT_PREFIX) && path.length > ROOT_PREFIX.length;
}

export type SpecsPathRule = 'absolute' | 'dotdot' | 'empty_segment' | 'outside_root' | 'not_md';

/** Same absolute-like test as `repository-files.ts` (ring 2 may not import ring 3, so it is copied). */
function isAbsoluteLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(p);
}

/** `null` when `path` is a writable-shaped path under `.devdigest/specs/`, else the rule it fails. */
export function specsPathRule(path: string): SpecsPathRule | null {
  if (isAbsoluteLike(path)) return 'absolute';
  if (path.split(/[\\/]/).some((seg) => seg === '..')) return 'dotdot';
  if (path.split('/').some((seg) => seg === '')) return 'empty_segment';
  // A backslash is a separator on Windows, so it can never be part of a root-relative path.
  if (!isUnderSpecsRoot(path) || path.includes('\\')) return 'outside_root';
  if (!path.toLowerCase().endsWith('.md')) return 'not_md';
  return null;
}

export type EntryNameRule = 'too_long' | 'reserved' | 'bad_char' | 'trailing' | 'dot_name' | 'not_md';

const RESERVED_BASES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
// eslint-disable-next-line no-control-regex -- U+0000-U+001F are part of the rule
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/** `null` when `name` is a usable single path segment, else the rule it fails. */
export function entryNameRule(name: string, kind: 'file' | 'folder'): EntryNameRule | null {
  if (name === '' || name === '.' || name === '..') return 'dot_name';
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return 'too_long';
  if (BAD_CHARS.test(name)) return 'bad_char';
  if (name.endsWith('.') || name.endsWith(' ')) return 'trailing';
  const base = (name.split('.')[0] ?? '').toUpperCase();
  if (RESERVED_BASES.has(base)) return 'reserved';
  if (kind === 'file' && !name.toLowerCase().endsWith('.md')) return 'not_md';
  return null;
}

/** First free name: `x.md` -> `x-2.md` -> `x-3.md`; a folder `x` -> `x-2`. Compared lower-case. */
export function nextFreeName(
  name: string,
  kind: 'file' | 'folder',
  takenLower: ReadonlySet<string>,
): string {
  if (!takenLower.has(name.toLowerCase())) return name;
  const ext = kind === 'file' && name.toLowerCase().endsWith('.md') ? name.slice(-3) : '';
  const stem = ext ? name.slice(0, -3) : name;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!takenLower.has(candidate.toLowerCase())) return candidate;
  }
}

export function toLf(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

// Equivalent to `!text.isWellFormed()`, which the project's TS lib target does not declare.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export type ContentRule ='too_large' | 'not_utf8' | 'nul';

/** Runs on already-LF text. */
export function contentRule(text: string): ContentRule | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) return 'too_large';
  if (LONE_SURROGATE.test(text)) return 'not_utf8';
  if (text.includes('\u0000')) return 'nul';
  return null;
}

/** Uploaded bytes are validated, never rewritten; a BOM is allowed. */
export function uploadBytesRule(bytes: Uint8Array): ContentRule | null {
  if (bytes.length > MAX_DOC_BYTES) return 'too_large';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'not_utf8';
  }
  if (bytes.includes(0)) return 'nul';
  return null;
}

/** Precedence: outside_root > tracked > too_large. */
export function readOnlyReason(input: {
  path: string;
  tracked: boolean;
  size: number;
}): ContextReadOnlyReason | null {
  if (!isUnderSpecsRoot(input.path)) return 'outside_root';
  if (input.tracked) return 'tracked';
  if (input.size > MAX_DOC_BYTES) return 'too_large';
  return null;
}
