/**
 * `modules/_shared/severity.ts` — the one tally behind both FINDINGS surfaces:
 * the PR list (latest review per PR) and the run timeline (per run). Pure, so
 * it gets unit coverage independent of either module's queries.
 */
import { describe, it, expect } from 'vitest';
import { rollupSeverities } from '../src/modules/_shared/severity.js';

describe('rollupSeverities', () => {
  it('tallies findings into the three Severity levels', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('keys match the Severity enum exactly, so no re-casing is needed downstream', () => {
    expect(Object.keys(rollupSeverities([]))).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
  });

  it('ignores a severity outside the enum — the column is free text, not a pg enum', () => {
    expect(rollupSeverities([{ severity: 'WEIRD' }, { severity: 'critical' }])).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
  });

  it('is all-zero for no findings — a clean review, not "unknown"', () => {
    expect(rollupSeverities([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});
