import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  SmartDiffRole,
  Conformance,
  Onboarding,
  EvalRun,
  EvalSuiteRun,
  EvalCaseInput,
  EvalCaseRunRequest,
  EvalSkillRunRequest,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('SmartDiffRole is widened to the five display-order roles', () => {
    expect(SmartDiffRole.options).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(() =>
      SmartDiff.parse({
        groups: [
          { role: 'tests', files: [{ path: 'a.test.ts', additions: 1, deletions: 0, finding_lines: [] }] },
          { role: 'docs', files: [{ path: 'README.md', additions: 1, deletions: 0, finding_lines: [] }] },
        ],
        split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
      }),
    ).not.toThrow();
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    const tour = {
      repo_id: 'r1',
      generated_at: '2026-10-01T00:00:00.000Z',
      index_sha: 'abc123',
      files_indexed: 42,
      provider: 'openrouter',
      model: 'm',
      architecture: { prose: 'p', diagram: null },
      critical_paths: [{ path: 'a.ts', reason: null }],
      run_locally: [{ line: 'pnpm dev', source_path: 'package.json' }],
      reading_path: [{ path: 'a.ts', reason: 'entry point' }],
      first_tasks: [{ text: 'Add a test', paths: ['a.ts'] }],
    };
    expect(() => Onboarding.parse(tour)).not.toThrow(); // a tour stored before task complexity existed
    const labelled = { ...tour, first_tasks: [{ text: 'Add a test', paths: ['a.ts'], complexity: 'low' }] };
    expect(() => Onboarding.parse(labelled)).not.toThrow();
    expect(() => Onboarding.parse({ ...tour, first_tasks: [{ ...tour.first_tasks[0], complexity: null }] })).not.toThrow();
    expect(() => Onboarding.parse({ ...tour, first_tasks: [{ ...tour.first_tasks[0], complexity: 'huge' }] })).toThrow();
    expect(() =>
      Onboarding.parse({
        ...tour,
        reading_path: Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.ts`, reason: null })),
      }),
    ).toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    // EC-8: an empty denominator is "not available" (null), never 0 or 1.
    expect(() =>
      EvalRun.parse({
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        duration_ms: 0,
        cost_usd: null,
        per_trace: [],
      }),
    ).not.toThrow();
    const suiteRun = {
      id: 'run1',
      kind: 'suite',
      owner_kind: 'agent',
      owner_id: 'a1',
      agent_id: 'a1',
      agent_version: 3,
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'partial',
      error: null,
      skills: [{ skill_id: 's1', name: 'Security', version: 2 }],
      cases: [{ case_id: 'c1', fingerprint: 'abc' }],
      cases_total: 2,
      cases_passed: 1,
      cases_errored: 1,
      metrics: { recall: 1, precision: null, citation_accuracy: 0.5 },
      duration_ms: 1200,
      cost_usd: null,
      started_at: '2026-10-05T00:00:00.000Z',
      finished_at: '2026-10-05T00:00:01.200Z',
    };
    const parsed = EvalSuiteRun.parse(suiteRun);
    expect(EvalSuiteRun.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parsed.metrics.precision).toBeNull();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('EvalCaseInput boundaries', () => {
  const valid = {
    name: 'stripe-key',
    input_diff: 'diff --git a/a.ts b/a.ts\n',
    input_meta: { pr_title: 't', pr_body: 'b' },
    expectation: 'must_find',
    target: { file: 'a.ts', start_line: 4, end_line: 4 },
  };
  const parse = (over: Record<string, unknown>) => EvalCaseInput.safeParse({ ...valid, ...over });
  const meta = (over: Record<string, unknown>) =>
    parse({ input_meta: { ...valid.input_meta, ...over } });

  it('accepts the base fixture', () => {
    expect(EvalCaseInput.safeParse(valid).success).toBe(true);
  });

  it('name: blank rejected, 120 code points accepted (astral counts as one), 121 rejected', () => {
    expect(parse({ name: '  ' }).success).toBe(false);
    expect(parse({ name: 'a'.repeat(119) + '😀' }).success).toBe(true);
    expect(parse({ name: 'a'.repeat(120) + '😀' }).success).toBe(false);
    expect(parse({ name: 'a'.repeat(121) }).success).toBe(false);
  });

  it('input_diff: counted in UTF-8 bytes', () => {
    expect(parse({ input_diff: 'a'.repeat(65_536) }).success).toBe(true);
    expect(parse({ input_diff: 'a'.repeat(65_537) }).success).toBe(false);
    expect(parse({ input_diff: 'a'.repeat(65_535) + 'é' }).success).toBe(false);
  });

  it('pr_title 300 / 301 code points, pr_body 16 384 / 16 385 bytes', () => {
    expect(meta({ pr_title: 'a'.repeat(300) }).success).toBe(true);
    expect(meta({ pr_title: 'a'.repeat(301) }).success).toBe(false);
    expect(meta({ pr_body: 'a'.repeat(16_384) }).success).toBe(true);
    expect(meta({ pr_body: 'a'.repeat(16_385) }).success).toBe(false);
  });

  it('target: start_line 0 rejected, start > end rejected at target.start_line, 4/4 accepted', () => {
    expect(parse({ target: { file: 'a.ts', start_line: 0, end_line: 4 } }).success).toBe(false);
    const bad = parse({ target: { file: 'a.ts', start_line: 5, end_line: 4 } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['target', 'start_line']);
    expect(parse({ target: { file: 'a.ts', start_line: 4, end_line: 4 } }).success).toBe(true);
  });

  it('rejects an extra key (owner_id)', () => {
    expect(parse({ owner_id: 'x' }).success).toBe(false);
  });

  it('run requests: skill needs a host, case does not', () => {
    expect(EvalSkillRunRequest.safeParse({}).success).toBe(false);
    expect(EvalCaseRunRequest.safeParse({}).success).toBe(true);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});
