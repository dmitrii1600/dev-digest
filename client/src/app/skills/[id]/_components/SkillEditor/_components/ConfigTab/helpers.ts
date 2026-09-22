/** A "what changed" note is only meaningful once the body itself changed —
 *  the server only snapshots a version (and records the note on it) when
 *  `body` differs from the current one. Used to grey the note field's hint
 *  rather than to block typing (the server is the source of truth). */
export function bodyChanged(original: string, current: string): boolean {
  return original !== current;
}
