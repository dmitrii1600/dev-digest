import type { ConventionCandidate } from "@devdigest/shared";
import { EXTRACT_ERROR_COPY } from "./constants";

/** Coarse age of the last scan. Returns a unit + count, never copy — the
 *  component formats it through `page.ago.<unit>` in `conventions.json`. */
export interface TimeAgo {
  unit: "now" | "minutes" | "hours" | "days";
  count: number;
}

export function timeAgo(iso: string, now: number = Date.now()): TimeAgo {
  const diff = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(diff / 60_000);
  if (m < 1) return { unit: "now", count: 0 };
  if (m < 60) return { unit: "minutes", count: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: "hours", count: h };
  return { unit: "days", count: Math.floor(h / 24) };
}

/** The i18n key for an extract error, or `null` for a generic failure. */
export function extractErrorKey(code: string | undefined): string | null {
  return (code && EXTRACT_ERROR_COPY[code]) ?? null;
}

export function acceptedOf(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return candidates.filter((c) => c.status === "accepted");
}

/** Accepted candidates not yet absorbed into a skill — what Create skill acts on. */
export function creatableOf(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return acceptedOf(candidates).filter((c) => !c.skill_id);
}
