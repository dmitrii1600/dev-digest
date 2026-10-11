import { describe, it, expect } from 'vitest';
import {
  aggregateRun,
  alertLine,
  caseFingerprint,
  compareCaseSets,
  evalTaskLine,
  extractFileDiff,
  findingMatches,
  freezeDiff,
  metricDelta,
  passDelta,
  patchToFileDiff,
  regressions,
  scoreCase,
  skillsChanged,
  truncateChars,
  truncateUtf8,
  type CaseOutcome,
} from '../src/modules/evals/helpers.js';
import { MAX_FROZEN_DIFF_BYTES } from '../src/modules/evals/constants.js';

const target = (file: string, s: number, e: number) => ({ file, start_line: s, end_line: e });
const span = (file: string, s: number, e: number) => ({ file, start_line: s, end_line: e });

describe('findingMatches', () => {
  const t = target('src/config.ts', 12, 14);
  it('matches an exact overlap', () => {
    expect(findingMatches(span('src/config.ts', 12, 14), t)).toBe(true);
  });
  it('matches on the edge: [10,12] vs [12,14]', () => {
    expect(findingMatches(span('src/config.ts', 10, 12), t)).toBe(true);
  });
  it('misses an adjacent range: [10,11] vs [12,14]', () => {
    expect(findingMatches(span('src/config.ts', 10, 11), t)).toBe(false);
  });
  it('is case-sensitive on the path', () => {
    expect(findingMatches(span('src/Config.ts', 12, 14), t)).toBe(false);
  });
  it('does not match a near-miss path (.tsx vs .ts)', () => {
    expect(findingMatches(span('src/config.tsx', 12, 14), t)).toBe(false);
  });
  it('matches a root-level file', () => {
    expect(findingMatches(span('README.md', 1, 2), target('README.md', 2, 3))).toBe(true);
  });
});

describe('extractFileDiff', () => {
  const raw = [
    'diff --git a/src/a.tsx b/src/a.tsx',
    '--- a/src/a.tsx',
    '+++ b/src/a.tsx',
    '@@ -1,1 +1,1 @@',
    '-x',
    '+tsx',
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,1 @@',
    '-y',
    '+ts',
    'diff --git a/src/b.ts b/src/b.ts',
    '@@ -1 +1 @@',
    '-z',
    '+zz',
  ].join('\n');

  it('captures only the block whose b/ path equals the path', () => {
    const block = extractFileDiff(raw, 'src/a.ts')!;
    expect(block).toContain('+ts');
    expect(block).not.toContain('+tsx');
    expect(block).not.toContain('src/b.ts');
  });
  it('does not let src/a.ts capture src/a.tsx', () => {
    const block = extractFileDiff(raw, 'src/a.tsx')!;
    expect(block).toContain('+tsx');
    expect(block).not.toContain('+ts\n');
  });
  it('returns null for a file that is not in the diff', () => {
    expect(extractFileDiff(raw, 'src/missing.ts')).toBeNull();
  });
});

describe('patchToFileDiff', () => {
  it('builds the diffFromPrFiles shape', () => {
    expect(patchToFileDiff('a.ts', '@@ -1 +1 @@\n-a\n+b')).toBe(
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b',
    );
  });
});

describe('freezeDiff', () => {
  const header = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts';
  /** A diff of exactly `bytes` ASCII bytes made of one hunk at lines 1..2. */
  const padded = (bytes: number): string => {
    const base = `${header}\n@@ -1,2 +1,2 @@\n+`;
    return base + 'x'.repeat(bytes - base.length);
  };

  it('keeps a diff of exactly 65 536 bytes untrimmed', () => {
    const d = padded(MAX_FROZEN_DIFF_BYTES);
    expect(Buffer.byteLength(d)).toBe(65_536);
    expect(freezeDiff(d, 1, 2)).toEqual({ ok: true, diff: d, trimmed: false });
  });

  it('trims a 65 537-byte diff to the overlapping hunks', () => {
    const big = `${header}\n@@ -1,2 +1,2 @@\n+small\n@@ -100,2 +100,2 @@\n+${'y'.repeat(70_000)}`;
    const r = freezeDiff(big, 1, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trimmed).toBe(true);
      expect(r.diff).toContain('+small');
      expect(r.diff).not.toContain('yyyy');
    }
    const edge = padded(MAX_FROZEN_DIFF_BYTES + 1);
    expect(Buffer.byteLength(edge)).toBe(65_537);
    // one hunk that alone is over the cap
    expect(freezeDiff(edge, 1, 2)).toEqual({ ok: false, reason: 'diff_too_large' });
  });

  it('is diff_too_large when the overlapping hunk alone exceeds the cap', () => {
    const big = `${header}\n@@ -1,2 +1,2 @@\n+${'y'.repeat(70_000)}`;
    expect(freezeDiff(big, 1, 2)).toEqual({ ok: false, reason: 'diff_too_large' });
  });

  it('is target_outside_diff when no hunk overlaps', () => {
    const big = `${header}\n@@ -1,2 +1,2 @@\n+a\n@@ -500,2 +500,2 @@\n+${'y'.repeat(70_000)}`;
    expect(freezeDiff(big, 200, 210)).toEqual({ ok: false, reason: 'target_outside_diff' });
  });

  it('uses the new-side range (a one-line hunk with no count covers one line)', () => {
    const big = `${header}\n@@ -7 +7 @@\n+a\n@@ -500,2 +500,2 @@\n+${'y'.repeat(70_000)}`;
    expect(freezeDiff(big, 7, 7).ok).toBe(true);
    expect(freezeDiff(big, 8, 8)).toEqual({ ok: false, reason: 'target_outside_diff' });
  });
});

describe('truncation', () => {
  it('keeps a 120-char name and cuts 121 to 120', () => {
    expect(truncateChars('a'.repeat(120), 120)).toHaveLength(120);
    expect(truncateChars('a'.repeat(121), 120)).toBe('a'.repeat(120));
  });
  it('never splits a code point at the byte cap', () => {
    // 16 383 ASCII bytes, then a 3-byte char straddling byte 16 384.
    const s = 'a'.repeat(16_383) + '€' + 'tail';
    const out = truncateUtf8(s, 16_384);
    expect(out).toBe('a'.repeat(16_383));
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(16_384);
    expect(out).not.toContain('�');
  });
  it('returns a short string unchanged', () => {
    expect(truncateUtf8('héllo', 16_384)).toBe('héllo');
  });
});

describe('caseFingerprint', () => {
  const base = {
    input_diff: 'd',
    pr_title: 't',
    pr_body: 'b',
    expectation: 'must_find' as const,
    file: 'f.ts',
    start_line: 1,
    end_line: 2,
  };
  it('is deterministic', () => {
    expect(caseFingerprint(base)).toBe(caseFingerprint({ ...base }));
    expect(caseFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    ['input_diff', 'd2'],
    ['pr_title', 't2'],
    ['pr_body', 'b2'],
    ['expectation', 'must_not_flag'],
    ['file', 'g.ts'],
    ['start_line', 3],
    ['end_line', 9],
  ] as const)('changes when %s changes', (key, value) => {
    expect(caseFingerprint({ ...base, [key]: value })).not.toBe(caseFingerprint(base));
  });
});

describe('scoreCase', () => {
  const t = target('f.ts', 10, 12);
  it('must_find passes iff a kept finding overlaps', () => {
    expect(scoreCase('must_find', t, [span('f.ts', 11, 11)], 1)).toEqual({
      status: 'passed',
      produced: 2,
      kept: 1,
      matched: 1,
      nmf_hits: 0,
    });
    expect(scoreCase('must_find', t, [span('f.ts', 1, 2)], 0).status).toBe('failed');
  });
  it('must_not_flag passes iff nothing overlaps, and counts hits', () => {
    expect(scoreCase('must_not_flag', t, [span('f.ts', 1, 2)], 0).status).toBe('passed');
    const r = scoreCase('must_not_flag', t, [span('f.ts', 10, 10), span('f.ts', 12, 13)], 0);
    expect(r.status).toBe('failed');
    expect(r.nmf_hits).toBe(2);
  });
});

describe('aggregateRun', () => {
  const o = (p: Partial<CaseOutcome>): CaseOutcome => ({
    expectation: 'must_find',
    status: 'passed',
    produced: 1,
    kept: 1,
    nmf_hits: 0,
    cost_usd: 0.01,
    ...p,
  });

  it('computes the three metrics', () => {
    const r = aggregateRun([
      o({}),
      o({ status: 'failed' }),
      o({ expectation: 'must_not_flag', nmf_hits: 1, status: 'failed', kept: 1, produced: 2 }),
      o({ expectation: 'must_not_flag', nmf_hits: 0, kept: 0, produced: 0 }),
    ]);
    expect(r.metrics.recall).toBe(0.5);
    // kept = 1+1+1+0 = 3, hits = 1 → 1 - 1/3
    expect(r.metrics.precision).toBeCloseTo(2 / 3, 10);
    // kept 3 / produced 4
    expect(r.metrics.citation_accuracy).toBe(0.75);
    expect(r.cases_passed).toBe(2);
    expect(r.status).toBe('completed');
  });

  it('gives null, never 0 or 1, on an empty denominator', () => {
    const noMustFind = aggregateRun([o({ expectation: 'must_not_flag', kept: 0, produced: 0 })]);
    expect(noMustFind.metrics.recall).toBeNull();
    expect(noMustFind.metrics.precision).toBeNull();
    expect(noMustFind.metrics.citation_accuracy).toBeNull();
  });

  it('is identical for identical input (NFR-2)', () => {
    const input = [o({}), o({ status: 'failed', kept: 0, produced: 3 })];
    expect(aggregateRun(input)).toEqual(aggregateRun([...input]));
  });

  it('derives status from the errored count', () => {
    expect(aggregateRun([o({}), o({})]).status).toBe('completed');
    const partial = aggregateRun([o({}), o({ status: 'errored' })]);
    expect(partial.status).toBe('partial');
    expect(partial.cases_errored).toBe(1);
    expect(aggregateRun([o({ status: 'errored' }), o({ status: 'errored' })]).status).toBe('failed');
  });

  it('leaves errored cases out of every denominator', () => {
    const r = aggregateRun([o({}), o({ status: 'errored', kept: 9, produced: 9 })]);
    expect(r.metrics.recall).toBe(1);
    expect(r.metrics.citation_accuracy).toBe(1);
  });

  it('sums cost over non-errored cases and poisons on an unknown one', () => {
    expect(aggregateRun([o({ cost_usd: 0.25 }), o({ cost_usd: 0.5 }), o({ status: 'errored', cost_usd: null })]).cost_usd).toBe(0.75);
    expect(aggregateRun([o({ cost_usd: 0.25 }), o({ cost_usd: null })]).cost_usd).toBeNull();
    expect(aggregateRun([o({ status: 'errored' })]).cost_usd).toBeNull();
  });
});

describe('deltas', () => {
  it('metricDelta is signed points with one decimal, null on a missing side', () => {
    expect(metricDelta(0.825, 0.795)).toBe(3);
    expect(metricDelta(0.5, 0.75)).toBe(-25);
    expect(metricDelta(0.5, 0.5)).toBe(0);
    expect(Object.is(metricDelta(0.5, 0.5), -0)).toBe(false);
    expect(metricDelta(null, 0.5)).toBeNull();
    expect(metricDelta(0.5, null)).toBeNull();
  });

  it('passDelta is a signed case count', () => {
    expect(passDelta({ cases_passed: 3 }, { cases_passed: 5 })).toBe(-2);
    expect(passDelta({ cases_passed: 5 }, { cases_passed: 3 })).toBe(2);
    expect(passDelta({ cases_passed: 5 }, null)).toBeNull();
  });

  it('regressions ignores null and only reports drops', () => {
    const latest = { recall: 0.5, precision: null, citation_accuracy: 0.9 };
    const prev = { recall: 0.75, precision: 0.8, citation_accuracy: 0.8 };
    expect(regressions(latest, prev)).toEqual([{ metric: 'recall', drop_points: 25 }]);
  });

  it('alertLine names each dropped metric', () => {
    expect(alertLine([])).toBeNull();
    expect(alertLine([{ metric: 'recall', drop_points: 25 }])).toBe(
      'Recall dropped 25.0 points since the previous run.',
    );
  });
});

describe('compareCaseSets / skillsChanged', () => {
  const r = (id: string, fp: string) => ({ case_id: id, fingerprint: fp });
  it('is the same only for equal ids and equal fingerprints', () => {
    expect(compareCaseSets([r('a', '1'), r('b', '2')], [r('b', '2'), r('a', '1')]).same).toBe(true);
  });
  it('counts edited cases and differing sizes', () => {
    const c = compareCaseSets([r('a', '1'), r('b', '2')], [r('a', '1'), r('b', 'X'), r('c', '3')]);
    expect(c).toEqual({ same: false, older_count: 2, newer_count: 3, edited_count: 1 });
  });
  it('detects a skill-set change', () => {
    const s = (id: string, v: number) => ({ skill_id: id, version: v });
    expect(skillsChanged([s('a', 1)], [s('a', 1)])).toBe(false);
    expect(skillsChanged([s('a', 1)], [s('a', 2)])).toBe(true);
    expect(skillsChanged([s('a', 1)], [])).toBe(true);
  });
});

describe('evalTaskLine', () => {
  it('names the frozen PR title and carries the trusted rules', () => {
    const line = evalTaskLine({ pr_title: 'fix: x' });
    expect(line).toContain('"fix: x"');
    expect(line).toContain('Review the ENTIRE diff');
  });
});
