import type { PrBriefRecord, PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import { formatRunCost, formatTokenCount } from "@/components/run-cost-badge";

export type BriefView = "generating" | "error" | "ready" | "empty";

/** The slice of a React Query mutation the brief section reads. */
export interface BriefMutation {
  mutate: () => void;
  reset: () => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

/** The newest `review` record — reviews arrive newest-first; `summary` rows are skipped. */
export function latestReviewOf(reviews: ReviewRecord[] | undefined): ReviewRecord | null {
  return (reviews ?? []).find((r) => r.kind === "review") ?? null;
}

/** Findings that block: CRITICAL and not dismissed. */
export function blockersOf(review: ReviewRecord): number {
  return review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `"$0.0094 3.1K→410"`; an unknown cost or token count is "—", never zero. */
export function costLine(record: Pick<PrBriefRecord, "cost_usd" | "tokens_in" | "tokens_out">): string {
  const cost = record.cost_usd != null ? formatRunCost(record.cost_usd) : "—";
  const tokens =
    record.tokens_in != null && record.tokens_out != null
      ? `${formatTokenCount(record.tokens_in)}→${formatTokenCount(record.tokens_out)}`
      : "—";
  return `${cost} ${tokens}`;
}

/** Which body to show. Precedence: generating → error → ready → empty. A 409
    from this tab plus the server reporting `generating` is therefore just the
    skeleton, never the error and the skeleton together. */
export function briefView({
  data,
  mutation,
}: {
  data: PrBriefResponse | undefined;
  mutation: Pick<BriefMutation, "isPending" | "isError">;
}): BriefView {
  if (mutation.isPending || data?.generating) return "generating";
  if (mutation.isError) return "error";
  if (data?.brief) return "ready";
  return "empty";
}

/** The stored brief whose own body (Risk areas, Review focus) is shown: any
    stored brief unless a generation is in flight. Derived from `briefView` with
    the error state ignored, because a failed refresh keeps the previous brief on
    screen under the error (EC-3) — so this is not `briefView(...) === "ready"`. */
export function shownBrief({
  data,
  mutation,
}: {
  data: PrBriefResponse | undefined;
  mutation: Pick<BriefMutation, "isPending">;
}): PrBriefRecord | null {
  const view = briefView({ data, mutation: { isPending: mutation.isPending, isError: false } });
  return view === "ready" ? (data?.brief ?? null) : null;
}

const ERROR_KEYS = new Set([
  "timeout",
  "invalid_output",
  "llm_error",
  "brief_running",
  "no_changed_files",
  "provider_key_missing",
  "brief_input_too_large",
]);

/** `brief.json` key (under `error.`) for a failed generation: a 502 `brief_failed`
    is told apart by its `details.reason`; anything unrecognised reads as `llm_error`. */
export function errorCopyKey(code: string | undefined, details: unknown): string {
  const reason = (details as { reason?: unknown } | null | undefined)?.reason;
  const key = code === "brief_failed" ? (typeof reason === "string" ? reason : "llm_error") : code;
  return key && ERROR_KEYS.has(key) ? key : "llm_error";
}
