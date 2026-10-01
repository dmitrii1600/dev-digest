import { ERROR_COPY, REASON_ERROR_COPY, UNKNOWN_ERROR_KEY } from "./constants";

/** Coarse age of the tour. Returns a unit + count, never copy — the view formats
 *  it through `ago.<unit>` in `onboarding.json`. */
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

/** `https://github.com/<owner/repo>/blob/<default branch>/<path>` — each segment encoded. */
export function githubFileUrl(fullName: string, branch: string, path: string): string {
  const file = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${encodeURIComponent(branch)}/${file}`;
}

/** The i18n key (under `onboarding`) for a generate error. Unknown codes and
 *  reasons fall back to the generic message. */
export function errorCopyKey(code: string | undefined, details?: unknown): string {
  if (!code) return UNKNOWN_ERROR_KEY;
  const reasoned = REASON_ERROR_COPY[code];
  if (reasoned) {
    const reason = (details as { reason?: unknown } | null | undefined)?.reason;
    return typeof reason === "string" && reasoned.reasons.includes(reason)
      ? `${reasoned.base}.${reason}`
      : UNKNOWN_ERROR_KEY;
  }
  return ERROR_COPY[code] ?? UNKNOWN_ERROR_KEY;
}

/** The studio URL of the tour page (AC-14). */
export function tourUrl(origin: string, repoId: string): string {
  return `${origin}/repos/${repoId}/tour`;
}
