import type { FindingRecord, PrFile } from "@devdigest/shared";
import { PREVIEW_MAX_LINES } from "./constants";

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * The patch lines of the hunks that overlap the finding's range, capped at
 * PREVIEW_MAX_LINES. Same new-side overlap rule as the server's `freezeDiff`
 * (`from <= end && start <= to`). `null` when there is nothing to preview.
 */
export function previewHunks(
  files: PrFile[] | undefined,
  finding: Pick<FindingRecord, "file" | "start_line" | "end_line">,
): { lines: string[]; truncated: boolean } | null {
  const patch = files?.find((f) => f.path === finding.file && f.patch)?.patch;
  if (!patch) return null;

  const start = Math.max(1, finding.start_line);
  const end = Math.max(start, finding.end_line);

  const hunks: { from: number; to: number; lines: string[] }[] = [];
  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      const from = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      hunks.push({ from, to: from + Math.max(len, 1) - 1, lines: [line] });
    } else {
      hunks.at(-1)?.lines.push(line);
    }
  }

  const lines = hunks.filter((h) => h.from <= end && start <= h.to).flatMap((h) => h.lines);
  if (lines.length === 0) return null;
  return { lines: lines.slice(0, PREVIEW_MAX_LINES), truncated: lines.length > PREVIEW_MAX_LINES };
}
