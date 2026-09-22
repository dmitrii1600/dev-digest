import { DATE_FORMAT_OPTS } from "./constants";

/** The current version is the highest version number in the list — the
 *  versions endpoint returns newest-first, so it's simply the first row. */
export function isCurrent(version: number, versions: { version: number }[]): boolean {
  return versions.length > 0 && version === Math.max(...versions.map((v) => v.version));
}

export function formatVersionDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", DATE_FORMAT_OPTS);
}

/** The current (newest) version on record, or `null` for an empty history.
 *  Every non-current row diffs against this one — criterion 28 in
 *  `specs/05-skills-lab-criteria-gaps.md` — so the diff answers "what would
 *  restoring this version change?", not "what did this version change?".
 *  Found by the highest version number, not by array position, so a
 *  differently-ordered response still yields the right side. */
export function currentVersion<T extends { version: number }>(versions: readonly T[]): T | null {
  if (versions.length === 0) return null;
  return versions.reduce((best, v) => (v.version > best.version ? v : best));
}
