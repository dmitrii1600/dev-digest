import { describe, it, expect } from 'vitest';
import {
  buildSummary,
  emptyBlastRadius,
  resolveDegraded,
  toBlastRadius,
} from '../src/modules/blast/helpers.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import type { DownstreamImpact } from '@devdigest/shared';

/**
 * Hermetic unit tests for the pure blast mapper (`helpers.ts`). Fixtures are
 * plain `BlastResult`/`IndexState` literals — no DB, no Fastify.
 */

function makeResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toBlastRadius — grouping and the declaring-file guard', () => {
  it('groups callers by viaSymbol', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/x.ts', symbol: 'callX', viaSymbol: 'foo', line: 10, rank: 5 },
        { file: 'src/y.ts', symbol: 'callY', viaSymbol: 'foo', line: 20, rank: 5 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream).toHaveLength(1);
    expect(out.downstream[0]!.symbol).toBe('foo');
    expect(out.downstream[0]!.callers).toHaveLength(2);
  });

  it('drops a caller whose file declares the same-named changed symbol', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/a.ts', symbol: 'selfRef', viaSymbol: 'foo', line: 3, rank: 1 },
        { file: 'src/b.ts', symbol: 'realCaller', viaSymbol: 'foo', line: 8, rank: 2 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream).toHaveLength(1);
    expect(out.downstream[0]!.callers).toEqual([{ name: 'realCaller', file: 'src/b.ts', line: 8 }]);
  });

  it('a symbol with no surviving callers appears only in changed_symbols', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'lonely', kind: 'function' }],
      callers: [],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream).toEqual([]);
    expect(out.changed_symbols.map((s) => s.name)).toEqual(['lonely']);
  });
});

describe('toBlastRadius — per-symbol cap and ordering', () => {
  it('caps callers per symbol at the injected limit, keeping the highest-ranked', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/x.ts', symbol: 'c1', viaSymbol: 'foo', line: 1, rank: 3 },
        { file: 'src/y.ts', symbol: 'c2', viaSymbol: 'foo', line: 2, rank: 5 },
        { file: 'src/z.ts', symbol: 'c3', viaSymbol: 'foo', line: 3, rank: 1 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 2,
    });
    expect(out.downstream[0]!.callers).toHaveLength(2);
    expect(out.downstream[0]!.callers.map((c) => c.file)).toEqual(['src/y.ts', 'src/x.ts']);
  });

  it('orders callers within a group by rank desc, then file asc, then line asc', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/b.ts', symbol: 'c1', viaSymbol: 'foo', line: 5, rank: 2 },
        { file: 'src/b.ts', symbol: 'c2', viaSymbol: 'foo', line: 1, rank: 2 },
        { file: 'src/a2.ts', symbol: 'c3', viaSymbol: 'foo', line: 9, rank: 2 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream[0]!.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/a2.ts:9',
      'src/b.ts:1',
      'src/b.ts:5',
    ]);
  });

  it('orders groups by max caller rank desc, then caller count desc, then symbol asc', () => {
    const result = makeResult({
      changedSymbols: [
        { file: 'src/a.ts', name: 'foo', kind: 'function' },
        { file: 'src/a.ts', name: 'bar', kind: 'function' },
        { file: 'src/a.ts', name: 'baz', kind: 'function' },
      ],
      callers: [
        { file: 'src/x.ts', symbol: 'c1', viaSymbol: 'foo', line: 1, rank: 5 },
        { file: 'src/y.ts', symbol: 'c2', viaSymbol: 'bar', line: 1, rank: 9 },
        { file: 'src/z.ts', symbol: 'c3', viaSymbol: 'baz', line: 1, rank: 9 },
        { file: 'src/z2.ts', symbol: 'c4', viaSymbol: 'baz', line: 2, rank: 9 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    // baz and bar both top out at rank 9, but baz has 2 callers vs bar's 1.
    expect(out.downstream.map((d) => d.symbol)).toEqual(['baz', 'bar', 'foo']);
  });

  it('orders changed_symbols with downstream-having symbols first, in downstream order', () => {
    const result = makeResult({
      changedSymbols: [
        { file: 'src/c.ts', name: 'noCallers', kind: 'function' },
        { file: 'src/a.ts', name: 'foo', kind: 'function' },
        { file: 'src/b.ts', name: 'bar', kind: 'function' },
      ],
      callers: [
        { file: 'src/x.ts', symbol: 'c1', viaSymbol: 'bar', line: 1, rank: 9 },
        { file: 'src/y.ts', symbol: 'c2', viaSymbol: 'foo', line: 1, rank: 5 },
      ],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.changed_symbols.map((s) => s.name)).toEqual(['bar', 'foo', 'noCallers']);
  });
});

describe('toBlastRadius — endpoints and crons', () => {
  it('attributes the sorted, deduplicated union of endpoints/crons per group, keeping crons separate', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/x.ts', symbol: 'c1', viaSymbol: 'foo', line: 1, rank: 1 },
        { file: 'src/y.ts', symbol: 'c2', viaSymbol: 'foo', line: 2, rank: 1 },
      ],
      factsByFile: {
        'src/x.ts': { endpoints: ['GET /a'], crons: [] },
        'src/y.ts': { endpoints: ['GET /a', 'POST /b'], crons: ['job:sync'] },
      },
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: false,
      reason: null,
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream[0]!.endpoints_affected).toEqual(['GET /a', 'POST /b']);
    expect(out.downstream[0]!.crons_affected).toEqual(['job:sync']);
  });

  it('emits empty endpoints/crons when factsByFile is absent (fallback path)', () => {
    const result = makeResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'src/x.ts', symbol: 'c1', viaSymbol: 'foo', line: 1, rank: 0 }],
    });
    const out = toBlastRadius({
      result,
      changedFilesCount: 1,
      degraded: true,
      reason: 'no_data',
      maxCallersPerSymbol: 20,
    });
    expect(out.downstream[0]!.endpoints_affected).toEqual([]);
    expect(out.downstream[0]!.crons_affected).toEqual([]);
  });
});

describe('resolveDegraded — the degraded table, first match wins', () => {
  it('flag_off wins even over a healthy index', () => {
    expect(resolveDegraded(makeResult(), makeState({ status: 'full' }), false)).toEqual({
      degraded: true,
      reason: 'flag_off',
    });
  });

  it('state.degraded uses its reason, defaulting to index_failed', () => {
    expect(
      resolveDegraded(makeResult(), makeState({ status: 'degraded', degraded: true }), true),
    ).toEqual({ degraded: true, reason: 'index_failed' });
    expect(
      resolveDegraded(
        makeResult(),
        makeState({ status: 'failed', degraded: true, degradedReason: 'repo_too_large' }),
        true,
      ),
    ).toEqual({ degraded: true, reason: 'repo_too_large' });
  });

  it('a repo that was never indexed reports no_data', () => {
    expect(
      resolveDegraded(
        makeResult(),
        makeState({ status: 'degraded', degraded: true, degradedReason: 'no_data' }),
        true,
      ),
    ).toEqual({ degraded: true, reason: 'no_data' });
  });

  it('partial status is degraded with index_partial, even though state.degraded is unset', () => {
    expect(resolveDegraded(makeResult(), makeState({ status: 'partial' }), true)).toEqual({
      degraded: true,
      reason: 'index_partial',
    });
  });

  it('a degraded facade result uses its own reason, defaulting to no_data', () => {
    expect(
      resolveDegraded(makeResult({ degraded: true }), makeState({ status: 'full' }), true),
    ).toEqual({ degraded: true, reason: 'no_data' });
    expect(
      resolveDegraded(
        makeResult({ degraded: true, reason: 'repo_too_large' }),
        makeState({ status: 'full' }),
        true,
      ),
    ).toEqual({ degraded: true, reason: 'repo_too_large' });
  });

  it('otherwise not degraded', () => {
    expect(resolveDegraded(makeResult(), makeState({ status: 'full' }), true)).toEqual({
      degraded: false,
      reason: null,
    });
  });
});

describe('buildSummary — all templates', () => {
  it('pluralises the changed-file count when no symbols are indexed', () => {
    expect(
      buildSummary({ changedFilesCount: 1, changedSymbolsCount: 0, downstream: [], degraded: false, reason: null }),
    ).toBe('No indexed symbols in the 1 changed file.');
    expect(
      buildSummary({ changedFilesCount: 3, changedSymbolsCount: 0, downstream: [], degraded: false, reason: null }),
    ).toBe('No indexed symbols in the 3 changed files.');
  });

  it('pluralises the symbol count when there is no downstream', () => {
    expect(
      buildSummary({ changedFilesCount: 2, changedSymbolsCount: 1, downstream: [], degraded: false, reason: null }),
    ).toBe('1 changed symbol; no downstream callers found.');
    expect(
      buildSummary({ changedFilesCount: 2, changedSymbolsCount: 2, downstream: [], degraded: false, reason: null }),
    ).toBe('2 changed symbols; no downstream callers found.');
  });

  it('counts callers/files/endpoints/crons across downstream', () => {
    const downstream: DownstreamImpact[] = [
      {
        symbol: 'foo',
        callers: [
          { name: 'c1', file: 'a.ts', line: 1 },
          { name: 'c2', file: 'b.ts', line: 2 },
        ],
        endpoints_affected: ['GET /a', 'POST /b'],
        crons_affected: ['job:x'],
      },
    ];
    expect(
      buildSummary({ changedFilesCount: 1, changedSymbolsCount: 2, downstream, degraded: false, reason: null }),
    ).toBe('2 changed symbols; 2 callers in 2 files; 2 endpoints; 1 cron.');
  });

  it('appends the degraded suffix', () => {
    expect(
      buildSummary({
        changedFilesCount: 1,
        changedSymbolsCount: 0,
        downstream: [],
        degraded: true,
        reason: 'index_partial',
      }),
    ).toBe('No indexed symbols in the 1 changed file. Index degraded: index_partial.');
  });
});

describe('emptyBlastRadius', () => {
  it('is the fixed no-changed-files value', () => {
    expect(emptyBlastRadius()).toEqual({
      changed_symbols: [],
      downstream: [],
      summary: 'No changed files recorded for this PR.',
      degraded: false,
      reason: null,
    });
  });
});
