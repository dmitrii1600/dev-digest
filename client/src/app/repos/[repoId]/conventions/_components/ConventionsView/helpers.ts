import type { ConventionCandidate } from "@devdigest/shared";
import { EXTRACT_ERROR_COPY } from "./constants";

/** "just now" / "4m ago" / "2h ago" / "3d ago" for the "last scan" line. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
