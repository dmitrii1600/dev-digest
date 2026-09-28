import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import type { Clock } from '../src/server.js';
import { MAX_POLL_MS, waitForRuns } from '../src/wait.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState, PR_482_ID } from './helpers/fixtures.js';

function instrumentedClock(): Clock & { sleeps: number[]; advance(ms: number): void } {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleeps,
    advance(ms: number) {
      time += ms;
    },
    async sleep(ms: number) {
      sleeps.push(ms);
      time += ms;
      await Promise.resolve();
    },
  };
}

function setupApi() {
  const fake = createFakeApi(createFixtureState());
  const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
  return { fake, api };
}

const RUN_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const RUN_B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('waitForRuns', () => {
  it('follows the ×1.5 backoff sequence, capped at MAX_POLL_MS', async () => {
    const { fake, api } = setupApi();
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'running' },
    ];
    fake.scheduleRunStatuses(RUN_A, ['running', 'running', 'running', 'running', 'done']);
    const clock = instrumentedClock();

    await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A],
      clock,
      waitMs: 600_000,
      pollMs: 1_000,
    });

    // 1000, 1500, 2250, 3375, capped after that at 5000.
    expect(clock.sleeps.slice(0, 4)).toEqual([1_000, 1_500, 2_250, 3_375]);
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(MAX_POLL_MS);
  });

  it('is terminal once every run id reaches done/failed/cancelled', async () => {
    const { fake, api } = setupApi();
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'running' },
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_B, status: 'running' },
    ];
    fake.scheduleRunStatuses(RUN_A, ['done']);
    fake.scheduleRunStatuses(RUN_B, ['running', 'failed']);
    const clock = instrumentedClock();

    const result = await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A, RUN_B],
      clock,
      waitMs: 600_000,
      pollMs: 100,
    });

    expect(result.state).toBe('terminal');
    expect(result.runs.find((r) => r.run_id === RUN_A)?.status).toBe('done');
    expect(result.runs.find((r) => r.run_id === RUN_B)?.status).toBe('failed');
  });

  it('treats a run id absent for 3 consecutive polls as terminal ("missing")', async () => {
    const { fake, api } = setupApi();
    const MISSING_ID = 'cccccccc-0000-4000-8000-000000000003';
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'done' },
    ];
    const clock = instrumentedClock();
    let pollCount = 0;

    const result = await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A, MISSING_ID],
      clock,
      waitMs: 600_000,
      pollMs: 10,
      onTick: () => {
        pollCount++;
      },
    });

    expect(result.state).toBe('terminal');
    expect(pollCount).toBe(3);
  });

  it('returns timeout without exceeding the wait limit, run keeps going server-side', async () => {
    const { fake, api } = setupApi();
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'running' },
    ];
    const clock = instrumentedClock();

    const result = await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A],
      clock,
      waitMs: 5_000,
      pollMs: 2_000,
    });

    expect(result.state).toBe('timeout');
  });

  it('stops on an aborted signal without erroring', async () => {
    const { fake, api } = setupApi();
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'running' },
    ];
    const clock = instrumentedClock();
    const controller = new AbortController();
    controller.abort();

    const result = await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A],
      clock,
      waitMs: 600_000,
      pollMs: 1_000,
      signal: controller.signal,
    });

    expect(result.state).toBe('aborted');
  });

  it('calls onTick after every poll with a strictly increasing poll index', async () => {
    const { fake, api } = setupApi();
    fake.state.runs[PR_482_ID] = [
      { ...fake.state.runs[PR_482_ID]![0]!, run_id: RUN_A, status: 'running' },
    ];
    fake.scheduleRunStatuses(RUN_A, ['running', 'running', 'done']);
    const clock = instrumentedClock();
    const ticks: number[] = [];

    await waitForRuns({
      api,
      prId: PR_482_ID,
      runIds: [RUN_A],
      clock,
      waitMs: 600_000,
      pollMs: 10,
      onTick: (pollIndex) => {
        ticks.push(pollIndex);
      },
    });

    expect(ticks).toEqual([1, 2, 3]);
  });
});
