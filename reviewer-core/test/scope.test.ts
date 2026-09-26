import { describe, it, expect } from 'vitest';
import type { Finding, FindingCategory, Severity } from '@devdigest/shared';
import { filterByScope } from '../src/index.js';

/**
 * The scope filter's invariants. The intent it keys on is derived from the
 * author-written PR body, so what it may NOT drop is the security boundary:
 * a CRITICAL, or a security/bug finding at any severity, always survives.
 */
function finding(severity: Severity, category: FindingCategory, scope: Finding['scope']): Finding {
  return {
    id: `${severity}-${category}-${String(scope)}`,
    severity,
    category,
    title: `${severity} ${category}`,
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    scope,
  } as Finding;
}

describe('filterByScope', () => {
  it('drops an out_of_scope non-CRITICAL perf/style/test finding', () => {
    for (const category of ['perf', 'style', 'test'] as const) {
      for (const severity of ['WARNING', 'SUGGESTION'] as const) {
        const { kept, dropped } = filterByScope([finding(severity, category, 'out_of_scope')]);
        expect(kept).toHaveLength(0);
        expect(dropped).toHaveLength(1);
      }
    }
  });

  it('always keeps an out_of_scope CRITICAL', () => {
    const { kept, dropped } = filterByScope([finding('CRITICAL', 'style', 'out_of_scope')]);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('never drops a security or bug finding, whatever its severity', () => {
    const input = (['security', 'bug'] as const).flatMap((category) =>
      (['WARNING', 'SUGGESTION'] as const).map((severity) => finding(severity, category, 'out_of_scope')),
    );
    const { kept, dropped } = filterByScope(input);
    expect(kept).toHaveLength(input.length);
    expect(dropped).toHaveLength(0);
  });

  it('keeps in_scope, unclear and unlabelled findings', () => {
    const input = (['in_scope', 'unclear', null, undefined] as const).map((scope) =>
      finding('SUGGESTION', 'style', scope),
    );
    expect(filterByScope(input).kept).toHaveLength(input.length);
  });
});
