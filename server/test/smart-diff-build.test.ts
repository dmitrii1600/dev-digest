import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, latestReviewPerAgent } from '../src/modules/smart-diff/helpers.js';
import type {
  SmartDiffFileInput,
  SmartDiffFindingInput,
  SmartDiffReviewInput,
} from '../src/modules/smart-diff/repository.js';

/** Hermetic — no Postgres. Covers `buildSmartDiff` and `latestReviewPerAgent`. */
describe('buildSmartDiff', () => {
  const files: SmartDiffFileInput[] = [
    { path: 'src/zzz.ts', additions: 4, deletions: 0 },
    { path: 'src/app.ts', additions: 10, deletions: 2 },
    { path: 'pnpm-lock.yaml', additions: 100, deletions: 0 },
    { path: 'src/app.test.ts', additions: 5, deletions: 1 },
    { path: 'docs/x.md', additions: 3, deletions: 0 },
  ];

  it('groups files in role order, GitHub order within a group, empty groups omitted', () => {
    const result = buildSmartDiff(files, []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'tests', 'docs', 'boilerplate']);
    // GitHub (input) order is preserved within a group: two core files,
    // `src/zzz.ts` listed before `src/app.ts` in `files`, come back in that
    // same order — not alphabetical, not reordered by any other rule.
    expect(result.groups.find((g) => g.role === 'core')!.files.map((f) => f.path)).toEqual([
      'src/zzz.ts',
      'src/app.ts',
    ]);
    expect(result.groups.find((g) => g.role === 'boilerplate')!.files[0]!.path).toBe('pnpm-lock.yaml');
    expect(SmartDiff.parse(result)).toBeTruthy();
  });

  it('an empty findings list gives all finding_lines equal to []', () => {
    const result = buildSmartDiff(files, []);
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }
  });

  it('finding_lines is sorted and deduped: two findings on line 11 give [11]', () => {
    const findings: SmartDiffFindingInput[] = [
      { file: 'src/app.ts', startLine: 11, dismissedAt: null },
      { file: 'src/app.ts', startLine: 11, dismissedAt: null },
      { file: 'src/app.ts', startLine: 3, dismissedAt: null },
    ];
    const result = buildSmartDiff(files, findings);
    const appTs = result.groups.find((g) => g.role === 'core')!.files.find((f) => f.path === 'src/app.ts')!;
    expect(appTs.finding_lines).toEqual([3, 11]);
  });

  it('a dismissed finding adds no line', () => {
    const findings: SmartDiffFindingInput[] = [
      { file: 'src/app.ts', startLine: 7, dismissedAt: new Date('2026-01-01') },
    ];
    const result = buildSmartDiff(files, findings);
    const appTs = result.groups.find((g) => g.role === 'core')!.files.find((f) => f.path === 'src/app.ts')!;
    expect(appTs.finding_lines).toEqual([]);
  });

  it('a finding for another file is ignored', () => {
    const findings: SmartDiffFindingInput[] = [{ file: 'not-in-files.ts', startLine: 1, dismissedAt: null }];
    const result = buildSmartDiff(files, findings);
    for (const group of result.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }
  });

  it('total_lines is the sum of every additions + deletions', () => {
    const result = buildSmartDiff(files, []);
    expect(result.split_suggestion.total_lines).toBe(4 + 0 + 10 + 2 + 100 + 0 + 5 + 1 + 3 + 0);
    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });

  it('SmartDiff.parse(result) succeeds', () => {
    const findings: SmartDiffFindingInput[] = [{ file: 'src/app.ts', startLine: 4, dismissedAt: null }];
    const result = buildSmartDiff(files, findings);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });
});

describe('latestReviewPerAgent', () => {
  it('two reviews from agent A: only the newer counts', () => {
    const older: SmartDiffReviewInput = {
      agentId: 'agent-a',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      findings: [{ file: 'x.ts', startLine: 5, dismissedAt: null }],
    };
    const newer: SmartDiffReviewInput = {
      agentId: 'agent-a',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      findings: [{ file: 'x.ts', startLine: 9, dismissedAt: null }],
    };
    const result = latestReviewPerAgent([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(newer);
  });

  it('agent B adds up (does not replace agent A)', () => {
    const a: SmartDiffReviewInput = { agentId: 'agent-a', createdAt: new Date('2026-01-01'), findings: [] };
    const b: SmartDiffReviewInput = { agentId: 'agent-b', createdAt: new Date('2026-01-01'), findings: [] };
    const result = latestReviewPerAgent([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([a, b]));
  });

  it('the null agent is its own bucket', () => {
    const namedAgent: SmartDiffReviewInput = { agentId: 'agent-a', createdAt: new Date('2026-01-01'), findings: [] };
    const noAgent: SmartDiffReviewInput = { agentId: null, createdAt: new Date('2026-01-01'), findings: [] };
    const result = latestReviewPerAgent([namedAgent, noAgent]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([namedAgent, noAgent]));
  });

  it('shuffled input gives the same result', () => {
    const oldest: SmartDiffReviewInput = { agentId: 'agent-a', createdAt: new Date('2026-01-01'), findings: [] };
    const middle: SmartDiffReviewInput = { agentId: 'agent-a', createdAt: new Date('2026-01-02'), findings: [] };
    const newest: SmartDiffReviewInput = { agentId: 'agent-a', createdAt: new Date('2026-01-03'), findings: [] };
    const inOrder = latestReviewPerAgent([oldest, middle, newest]);
    const shuffled = latestReviewPerAgent([newest, oldest, middle]);
    expect(inOrder).toEqual([newest]);
    expect(shuffled).toEqual([newest]);
  });
});
