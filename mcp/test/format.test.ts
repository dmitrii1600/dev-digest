import { describe, expect, it } from 'vitest';
import type { BlastRadius, DownstreamImpact, FindingRecord, ReviewRecord, RunSummary } from '@devdigest/shared';
import {
  clip,
  MAX_BLAST_DOWNSTREAM,
  MAX_BLAST_SYMBOLS,
  MAX_FINDINGS_CONCISE,
  MAX_FINDINGS_DETAILED,
  MAX_OUTPUT_CHARS,
  shapeBlastRadius,
  shapeReviews,
  sortFindings,
  toTextResult,
} from '../src/format.js';

function finding(overrides: Partial<FindingRecord> & Pick<FindingRecord, 'severity'>): FindingRecord {
  return {
    id: 'f-' + Math.random().toString(36).slice(2),
    review_id: 'r1',
    category: 'bug',
    title: 't',
    file: 'a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    suggestion: null,
    confidence: 0.5,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord> & Pick<ReviewRecord, 'id' | 'findings'>): ReviewRecord {
  return {
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'comment',
    summary: 'summary',
    score: 80,
    model: 'gpt-4.1',
    grounding: 'ok',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<RunSummary> & Pick<RunSummary, 'run_id'>): RunSummary {
  return {
    agent_id: 'agent-1',
    agent_name: 'General Reviewer',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'done',
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 100,
    cost_usd: null,
    findings_count: 0,
    findings_counts: null,
    grounding: 'ok',
    ran_at: '2026-01-01T00:00:00.000Z',
    score: 80,
    blockers: 0,
    ...overrides,
  };
}

describe('clip', () => {
  it('leaves short strings alone', () => {
    expect(clip('hi', 10)).toBe('hi');
  });
  it('clips and appends an ellipsis', () => {
    expect(clip('hello world', 5)).toBe('hello…');
  });
});

describe('sortFindings', () => {
  it('orders CRITICAL > WARNING > SUGGESTION', () => {
    const input = [
      finding({ severity: 'SUGGESTION' }),
      finding({ severity: 'CRITICAL' }),
      finding({ severity: 'WARNING' }),
    ];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.severity)).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
  });

  it('breaks severity ties by confidence descending', () => {
    const input = [
      finding({ severity: 'WARNING', confidence: 0.2 }),
      finding({ severity: 'WARNING', confidence: 0.9 }),
    ];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.confidence)).toEqual([0.9, 0.2]);
  });

  it('breaks confidence ties by file then start_line', () => {
    const input = [
      finding({ severity: 'WARNING', confidence: 0.5, file: 'b.ts', start_line: 1 }),
      finding({ severity: 'WARNING', confidence: 0.5, file: 'a.ts', start_line: 20 }),
      finding({ severity: 'WARNING', confidence: 0.5, file: 'a.ts', start_line: 5 }),
    ];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => `${f.file}:${f.start_line}`)).toEqual(['a.ts:5', 'a.ts:20', 'b.ts:1']);
  });
});

describe('shapeReviews', () => {
  it('produces one AgentReview per review, with severity counts over ALL findings', () => {
    const r = review({
      id: 'rev-1',
      findings: [
        finding({ severity: 'CRITICAL' }),
        finding({ severity: 'WARNING' }),
        finding({ severity: 'WARNING' }),
      ],
    });
    const result = shapeReviews([r], [run({ run_id: 'run-1', status: 'done' })], 'concise');
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      agent_name: 'General Reviewer',
      run_id: 'run-1',
      run_status: 'done',
      counts: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 },
    });
    expect(result.truncated).toBeUndefined();
  });

  it('clips and omits a null suggestion in concise mode', () => {
    const r = review({
      id: 'rev-1',
      findings: [
        finding({ severity: 'WARNING', suggestion: 'x'.repeat(300) }),
        finding({ severity: 'SUGGESTION', suggestion: null }),
      ],
    });
    const result = shapeReviews([r], [], 'concise');
    const findings = result.reviews[0]!.findings as Record<string, unknown>[];
    expect((findings[0]!.suggestion as string).length).toBe(201); // 200 + ellipsis
    expect('suggestion' in findings[1]!).toBe(false);
  });

  it('adds detailed-only fields, including full FindingRecord and null cost_usd', () => {
    const r = review({ id: 'rev-1', findings: [finding({ severity: 'CRITICAL', rationale: 'y'.repeat(3000) })] });
    const result = shapeReviews([r], [run({ run_id: 'run-1', cost_usd: null })], 'detailed');
    const shaped = result.reviews[0] as Record<string, unknown>;
    expect(shaped.summary).toBe('summary');
    expect(shaped.model).toBe('gpt-4.1');
    expect(shaped.pr_id).toBe('pr-1');
    expect(shaped.cost_usd).toBeNull();
    const f = (shaped.findings as Record<string, unknown>[])[0]!;
    expect(f.id).toBeDefined();
    expect((f.rationale as string).length).toBe(2001);
    expect(f.review_id).toBe('r1');
  });

  it('never coerces a null run cost to 0', () => {
    const r = review({ id: 'rev-1', findings: [] });
    const result = shapeReviews([r], [run({ run_id: 'run-1', cost_usd: null })], 'detailed');
    expect((result.reviews[0] as Record<string, unknown>).cost_usd).toBeNull();
  });

  it('caps findings GLOBALLY across reviews and reports an accurate truncation block', () => {
    const manyCritical = Array.from({ length: 60 }, (_, i) =>
      finding({ severity: 'CRITICAL', file: `f${i}.ts`, start_line: i }),
    );
    const r1 = review({ id: 'rev-1', run_id: 'run-1', findings: manyCritical.slice(0, 30) });
    const r2 = review({ id: 'rev-2', run_id: 'run-2', agent_name: 'Security Reviewer', findings: manyCritical.slice(30) });
    const result = shapeReviews([r1, r2], [], 'concise');
    const shownTotal = result.reviews.reduce(
      (n, rv) => n + ((rv as Record<string, unknown>).findings as unknown[]).length,
      0,
    );
    expect(shownTotal).toBe(MAX_FINDINGS_CONCISE);
    expect(result.truncated).toEqual({
      shown: MAX_FINDINGS_CONCISE,
      total: 60,
      hint: 'Showing the most severe findings. Narrow with agent or run_id.',
    });
  });

  it('uses the tighter detailed cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => finding({ severity: 'WARNING', start_line: i }));
    const r = review({ id: 'rev-1', findings: many });
    const result = shapeReviews([r], [], 'detailed');
    expect((result.reviews[0] as Record<string, unknown>).findings).toHaveLength(MAX_FINDINGS_DETAILED);
    expect(result.truncated?.total).toBe(30);
  });
});

describe('toTextResult', () => {
  it('returns the payload unchanged when it fits', () => {
    const result = toTextResult({ pr: 'acme/x#1', reviews: [] });
    expect(JSON.parse(result.content[0].text)).toEqual({ pr: 'acme/x#1', reviews: [] });
  });

  it('halves shown findings until the payload fits under the char guard', () => {
    const huge = Array.from({ length: 200 }, (_, i) =>
      finding({ severity: 'CRITICAL', file: `f${i}.ts`, rationale: 'z'.repeat(2000) }),
    );
    const r = review({ id: 'rev-1', findings: huge });
    const shaped = shapeReviews([r], [], 'detailed');
    const result = toTextResult({ pr: 'acme/x#1', ...shaped });
    expect(result.content[0].text.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    const parsed = JSON.parse(result.content[0].text) as { truncated?: { shown: number; total: number } };
    expect(parsed.truncated).toBeDefined();
    expect(parsed.truncated!.total).toBe(200);
  });

  it('leaves a payload with no reviews array untouched even if oversized', () => {
    const payload = { blob: 'x'.repeat(MAX_OUTPUT_CHARS + 10) };
    const result = toTextResult(payload);
    expect(result.content[0].text.length).toBeGreaterThan(MAX_OUTPUT_CHARS);
  });
});

function downstream(overrides: Partial<DownstreamImpact> & Pick<DownstreamImpact, 'symbol'>): DownstreamImpact {
  return {
    callers: [],
    endpoints_affected: [],
    crons_affected: [],
    ...overrides,
  };
}

function blast(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: 'summary',
    degraded: false,
    reason: null,
    ...overrides,
  };
}

describe('shapeBlastRadius', () => {
  it('formats symbols and callers as compact strings, omitting empty endpoints/crons', () => {
    const b = blast({
      changed_symbols: [{ name: 'foo', file: 'a.ts', kind: 'function' }],
      downstream: [downstream({ symbol: 'foo', callers: [{ name: 'bar', file: 'b.ts', line: 10 }] })],
      summary: '1 changed symbol; 1 caller in 1 file; 0 endpoints; 0 crons.',
    });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    expect(result.pr).toBe('acme/x#1');
    expect(result.head_sha).toBe('sha1');
    expect(result.summary).toBe(b.summary);
    expect(result.changed_symbols).toEqual(['foo (function) a.ts']);
    expect(result.downstream).toEqual([{ symbol: 'foo', callers: ['b.ts:10 bar'] }]);
    expect(result.degraded).toBeUndefined();
    expect(result.reason).toBeUndefined();
    expect(result.hint).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it('includes endpoints and crons only when present, and keeps them apart', () => {
    const b = blast({
      changed_symbols: [{ name: 'foo', file: 'a.ts', kind: 'function' }],
      downstream: [
        downstream({
          symbol: 'foo',
          callers: [{ name: 'bar', file: 'b.ts', line: 10 }],
          endpoints_affected: ['GET /x'],
          crons_affected: ['job:digest'],
        }),
      ],
    });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    const group = (result.downstream as Record<string, unknown>[])[0]!;
    expect(group.endpoints).toEqual(['GET /x']);
    expect(group.crons).toEqual(['job:digest']);
  });

  it('caps changed_symbols and downstream, reporting an accurate truncated block', () => {
    const symbols = Array.from({ length: 60 }, (_, i) => ({ name: `s${i}`, file: 'a.ts', kind: 'function' }));
    const groups = Array.from({ length: 40 }, (_, i) =>
      downstream({ symbol: `s${i}`, callers: [{ name: 'c', file: 'a.ts', line: 1 }] }),
    );
    const b = blast({ changed_symbols: symbols, downstream: groups });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    expect((result.changed_symbols as unknown[]).length).toBe(MAX_BLAST_SYMBOLS);
    expect((result.downstream as unknown[]).length).toBe(MAX_BLAST_DOWNSTREAM);
    expect(result.truncated).toEqual({
      symbols_shown: MAX_BLAST_SYMBOLS,
      symbols_total: 60,
      downstream_shown: MAX_BLAST_DOWNSTREAM,
      downstream_total: 40,
      hint: "Showing the highest-ranked symbols first. Open the PR's Overview tab in the DevDigest studio for the full map.",
    });
  });

  it('sets degraded + reason + a hint that interpolates only the reason value', () => {
    const b = blast({ degraded: true, reason: 'index_partial' });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('index_partial');
    expect(result.hint).toBe('Index index_partial: callers may be missing. Re-index the repo from the DevDigest studio.');
  });

  it('omits degraded/reason/hint entirely when not degraded', () => {
    const b = blast({ degraded: false, reason: null });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    expect('degraded' in result).toBe(false);
    expect('reason' in result).toBe(false);
    expect('hint' in result).toBe(false);
  });

  it('halves shown downstream under the char guard until the payload fits', () => {
    const groups = Array.from({ length: 16 }, (_, i) =>
      downstream({
        symbol: `s${i}`,
        callers: Array.from({ length: 20 }, (_, j) => ({
          name: `caller_${'x'.repeat(80)}_${j}`,
          file: `src/file_${'y'.repeat(80)}_${i}_${j}.ts`,
          line: j,
        })),
        endpoints_affected: [`GET /endpoint_${'z'.repeat(80)}_${i}`],
      }),
    );
    const b = blast({ downstream: groups });
    const result = shapeBlastRadius(b, { label: 'acme/x#1', headSha: 'sha1' });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    const truncated = result.truncated as
      | { downstream_shown: number; downstream_total: number }
      | undefined;
    expect(truncated).toBeDefined();
    expect(truncated!.downstream_total).toBe(16);
    expect((result.downstream as unknown[]).length).toBe(truncated!.downstream_shown);
    expect(truncated!.downstream_shown).toBeLessThan(16);
  });
});
