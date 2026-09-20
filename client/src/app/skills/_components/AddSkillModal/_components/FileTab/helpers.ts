import type { SkillImportEntry } from "@devdigest/shared";

/** Browser-safe ArrayBuffer → base64 (no `Buffer` — this runs client-side).
 *  Chunked so a large `String.fromCharCode(...bytes)` spread never blows the
 *  call-stack argument limit. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Only a `.zip` upload produces more than the single synthetic "skill.md"
 *  entry — gate the archive-contents table on the filename, same as the
 *  server's own dispatch in `parseImport`. */
export function isArchive(filename: string): boolean {
  return filename.toLowerCase().endsWith(".zip");
}

export function keptEntries(entries: SkillImportEntry[]): SkillImportEntry[] {
  return entries.filter((e) => e.kept);
}

export function discardedEntries(entries: SkillImportEntry[]): SkillImportEntry[] {
  return entries.filter((e) => !e.kept);
}
