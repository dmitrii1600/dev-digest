import type { Crumb } from "@devdigest/ui";

/** CRLF → LF, the line ending the server writes. */
export const toLf = (text: string): string => text.replace(/\r\n/g, "\n");

/** Unsaved edits: compared after CRLF → LF on both sides, as the server stores LF. */
export function isDirty(text: string, baseline: string): boolean {
  return toLf(text) !== toLf(baseline);
}

/** The listing holds at most 500 rows; a path it does not contain is "past the cap". */
export function isPastCap(path: string, files: ReadonlyArray<{ path: string }>): boolean {
  return !files.some((f) => f.path === path);
}

/** Standard base64 of raw bytes (chunked so large buffers do not overflow the call stack). */
export function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** `<owner/repo> › Project Context › <selected path>`; the path is omitted until one is selected. */
export function crumbFor(repoName: string, title: string, selected: string | null): Crumb[] {
  return [{ label: repoName, mono: true }, { label: title }, ...(selected ? [{ label: selected, mono: true }] : [])];
}
