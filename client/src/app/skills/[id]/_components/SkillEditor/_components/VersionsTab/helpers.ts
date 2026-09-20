import { DATE_FORMAT_OPTS } from "./constants";

/** The current version is the highest version number in the list — the
 *  versions endpoint returns newest-first, so it's simply the first row. */
export function isCurrent(version: number, versions: { version: number }[]): boolean {
  return versions.length > 0 && version === Math.max(...versions.map((v) => v.version));
}

export function formatVersionDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", DATE_FORMAT_OPTS);
}

/** The version immediately before `version`, or `null` when this is the oldest
 *  one on record. The predecessor is the highest version number below this one
 *  — not `version - 1`, which a pruned or partially-seeded history need not
 *  contain. */
export function previousVersion<T extends { version: number }>(version: number, versions: T[]): T | null {
  const earlier = versions.filter((v) => v.version < version);
  if (earlier.length === 0) return null;
  return earlier.reduce((best, v) => (v.version > best.version ? v : best));
}
