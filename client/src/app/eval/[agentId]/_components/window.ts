/* Pure helpers for the agent eval page's time window (`?window=`). */

export const WINDOWS = ["7d", "30d", "90d", "all"] as const;
export type EvalWindow = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: EvalWindow = "30d";

/** The `agentPage` message key of each window's label. */
export const WINDOW_LABEL_KEY = {
  "7d": "window7d",
  "30d": "window30d",
  "90d": "window90d",
  all: "windowAll",
} as const satisfies Record<EvalWindow, string>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS: Record<Exclude<EvalWindow, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** The URL value is untrusted: anything that is not exactly a window falls back to 30 days. */
export function parseWindow(raw: string | null | undefined): EvalWindow {
  return (WINDOWS as readonly string[]).includes(raw ?? "") ? (raw as EvalWindow) : DEFAULT_WINDOW;
}

/** The window's lower bound as an ISO datetime, or `undefined` for "all". */
export function sinceFor(window: EvalWindow, now: Date): string | undefined {
  if (window === "all") return undefined;
  return new Date(now.getTime() - DAYS[window] * DAY_MS).toISOString();
}

/** Whether a run started at `ranAt` falls inside the window (the bound itself is inside). */
export function inWindow(ranAt: string, since: string | undefined): boolean {
  if (!since) return true;
  return Date.parse(ranAt) >= Date.parse(since);
}
