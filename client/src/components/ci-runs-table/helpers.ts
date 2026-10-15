import type { CiRun } from "@devdigest/shared";

export type RelativeTime = { unit: "now" | "minutes" | "hours" | "days"; count: number };

/** Coarse age as a unit + count, never copy — `useRelativeTime` formats it through
 *  `runs.ago.<unit>` in `ci.json`. Null when absent or unparseable. */
export function relativeTime(iso: string | null | undefined): RelativeTime | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return { unit: "now", count: 0 };
  if (m < 60) return { unit: "minutes", count: m };
  const h = Math.round(m / 60);
  if (h < 24) return { unit: "hours", count: h };
  return { unit: "days", count: Math.round(h / 24) };
}

/** Cost in USD; null stays "—" (never shown as $0). */
export function formatCost(cost: number | null | undefined): string {
  return cost == null ? "—" : `$${cost.toFixed(4)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export type StatusKey = "succeeded" | "noFindings" | "failed" | "running";

/** Message key (under `runs.status`) for a run status; null for an unknown one. */
export function statusKey(status: string | null | undefined): StatusKey | null {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "no_findings":
      return "noFindings";
    case "failed":
      return "failed";
    case "running":
      return "running";
    default:
      return null;
  }
}

export function reasonKey(reason: CiRun["failure_reason"]): "resultRejected" | "noResult" | null {
  if (reason === "result_rejected") return "resultRejected";
  if (reason === "no_result") return "noResult";
  return null;
}
