import { describe, it, expect } from 'vitest';
import { MultiReviewRequest, RunSummary } from '@devdigest/shared';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`);

describe('MultiReviewRequest', () => {
  it('accepts 1 and 10 unique ids', () => {
    expect(MultiReviewRequest.safeParse({ agentIds: ids(1) }).success).toBe(true);
    expect(MultiReviewRequest.safeParse({ agentIds: ids(10) }).success).toBe(true);
  });

  it.each([
    ['no ids', { agentIds: [] }],
    ['11 ids', { agentIds: ids(11) }],
    ['a duplicate', { agentIds: ['a', 'a'] }],
    ['an empty string', { agentIds: [''] }],
    ['a missing key', {}],
  ])('rejects %s, naming agentIds', (_n, body) => {
    const r = MultiReviewRequest.safeParse(body);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path[0]).toBe('agentIds');
  });

  it('rejects an extra key and names it', () => {
    const r = MultiReviewRequest.safeParse({ agentIds: ['a'], all: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain('all');
  });
});

describe('RunSummary.multi_run_id', () => {
  const base = {
    run_id: 'r', agent_id: null, agent_name: null, provider: null, model: null,
    status: 'done', error: null, duration_ms: null, tokens_in: null, tokens_out: null,
    cost_usd: null, findings_count: null, findings_counts: null, grounding: null,
    ran_at: null, score: null, blockers: null,
  };
  it('accepts an object without the key and one with null', () => {
    expect(RunSummary.safeParse(base).success).toBe(true);
    expect(RunSummary.safeParse({ ...base, multi_run_id: null }).success).toBe(true);
  });
});
