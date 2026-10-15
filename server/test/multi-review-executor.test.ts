import { describe, it, expect, vi } from 'vitest';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { RunBus } from '../src/platform/sse.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository, PullRow } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';

// EC-3 / NFR-2: a failing shared preparation (diff load) fails EVERY queued run
// with that reason, trace before terminal status, and never reaches the LLM.
describe('ReviewRunExecutor — shared preparation failure', () => {
  it('ends every agent run failed with the diff-load reason and never resolves llm', async () => {
    const calls: string[] = [];
    const completed: { runId: string; values: { status: string; error: string | null } }[] = [];
    const fakeRepo = {
      getPrFiles: async () => {
        throw new Error('db down');
      },
      saveRunTrace: async (runId: string) => {
        calls.push(`trace:${runId}`);
      },
      completeAgentRun: async (runId: string, values: { status: string; error: string | null }) => {
        calls.push(`done:${runId}`);
        completed.push({ runId, values });
      },
    } as unknown as ReviewRepository;

    const llm = vi.fn();
    const container = {
      runBus: new RunBus(),
      git: {
        diff: async () => {
          throw new Error('no git');
        },
      },
      llm,
      intent: { ensure: vi.fn() },
    } as unknown as Container;

    const executor = new ReviewRunExecutor(container, fakeRepo, {} as Container['agentsRepo']);
    const jobs = ['r1', 'r2', 'r3'].map((runId) => ({
      runId,
      agent: { id: `a-${runId}`, name: `Agent ${runId}`, provider: 'openai', model: 'm', version: 1, systemPrompt: 's' } as unknown as AgentRow,
    }));

    await executor.executeRuns(
      'ws',
      { id: 'pr', number: 1, base: 'main', headSha: 'abc' } as unknown as PullRow,
      { owner: 'o', name: 'n' } as never,
      jobs,
    );

    expect(completed).toHaveLength(3);
    for (const c of completed) {
      expect(c.values.status).toBe('failed');
      expect(c.values.error).toBe('Failed to load PR diff: db down');
      expect(calls.indexOf(`trace:${c.runId}`)).toBeLessThan(calls.indexOf(`done:${c.runId}`));
    }
    expect(llm).not.toHaveBeenCalled();
    expect(container.intent.ensure).not.toHaveBeenCalled();
  });
});
