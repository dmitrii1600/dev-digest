import type { RunSummary } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import type { Clock } from './server.js';

/** A run's status once it stops changing. `null` (not-yet-set) and `'running'`
 *  both mean "keep waiting". */
export const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

/** Poll interval growth: starts at `pollMs`, ×1.5 per poll, capped here — about
 *  125 polls in 10 minutes, comfortably inside the API's 120/min global limit
 *  even with the studio also polling. */
export const MAX_POLL_MS = 5_000;
const BACKOFF_FACTOR = 1.5;
/** A run id absent from `GET /pulls/:id/runs` for this many consecutive polls
 *  is treated as terminal ("missing") rather than blocking the wait forever. */
export const MISSING_THRESHOLD = 3;

export interface WaitForRunsOpts {
  api: ApiClient;
  prId: string;
  runIds: string[];
  clock: Clock;
  waitMs: number;
  pollMs: number;
  signal?: AbortSignal;
  /** Called after every poll, with the 1-based poll index and elapsed time. */
  onTick?: (pollIndex: number, runs: RunSummary[], elapsedMs: number) => void | Promise<void>;
}

export interface WaitForRunsResult {
  state: 'terminal' | 'timeout' | 'aborted';
  runs: RunSummary[];
  elapsedMs: number;
}

function isTerminalStatus(status: string | null): boolean {
  return status !== null && TERMINAL_STATUSES.has(status);
}

/**
 * Polls `GET /pulls/:id/runs` until every id in `runIds` reaches a terminal
 * status (or is missing for `MISSING_THRESHOLD` polls in a row), the wait
 * limit passes, or `signal` aborts. The server run itself is never touched —
 * on `timeout`/`aborted` it keeps running; this only stops OUR waiting.
 */
export async function waitForRuns(opts: WaitForRunsOpts): Promise<WaitForRunsResult> {
  const start = opts.clock.now();
  let interval = opts.pollMs;
  let pollIndex = 0;
  const missingStreak = new Map<string, number>();
  let lastRuns: RunSummary[] = [];

  while (true) {
    if (opts.signal?.aborted) {
      return { state: 'aborted', runs: lastRuns, elapsedMs: opts.clock.now() - start };
    }
    if (opts.clock.now() - start >= opts.waitMs) {
      return { state: 'timeout', runs: lastRuns, elapsedMs: opts.clock.now() - start };
    }

    const runs = await opts.api.listRuns(opts.prId, opts.signal ? { signal: opts.signal } : undefined);
    lastRuns = runs;
    pollIndex++;

    let allTerminal = true;
    for (const runId of opts.runIds) {
      const run = runs.find((r) => r.run_id === runId);
      if (!run) {
        const streak = (missingStreak.get(runId) ?? 0) + 1;
        missingStreak.set(runId, streak);
        if (streak < MISSING_THRESHOLD) allTerminal = false;
        continue;
      }
      missingStreak.set(runId, 0);
      if (!isTerminalStatus(run.status)) allTerminal = false;
    }

    const elapsedMs = opts.clock.now() - start;
    await opts.onTick?.(pollIndex, runs, elapsedMs);

    if (allTerminal) {
      return { state: 'terminal', runs, elapsedMs };
    }
    if (opts.signal?.aborted) {
      return { state: 'aborted', runs, elapsedMs: opts.clock.now() - start };
    }
    if (opts.clock.now() - start >= opts.waitMs) {
      return { state: 'timeout', runs, elapsedMs: opts.clock.now() - start };
    }

    await opts.clock.sleep(interval, opts.signal);
    interval = Math.min(MAX_POLL_MS, interval * BACKOFF_FACTOR);
  }
}
