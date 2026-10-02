import type { ContextDocKind, SpecFile } from "@devdigest/shared";

export interface SerializedEntry {
  kind: ContextDocKind;
  path: string;
}

/** What a skill's attached documents serialise to, in attach order. A path that
    is not in the listing (missing, or past the 500 cap) is left out. */
export function serializeAs(paths: readonly string[], files: readonly SpecFile[]): SerializedEntry[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const entries: SerializedEntry[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    if (file) entries.push({ kind: file.kind ?? "other", path });
  }
  return entries;
}

/** The SERIALIZES AS text: the injected heading on the first line, then one
    `- [kind] path` line per entry. `kindLabel` maps a kind to its display text. */
export function serializedText(
  heading: string,
  entries: readonly SerializedEntry[],
  kindLabel: (kind: ContextDocKind) => string,
): string {
  return [heading, ...entries.map((e) => `- [${kindLabel(e.kind)}] ${e.path}`)].join("\n");
}
