import { describe, it, expect } from 'vitest';
import {
  kindForPath,
  orderForInjection,
  countUsedBy,
  newPaths,
} from '../src/modules/project-context/helpers.js';

describe('kindForPath', () => {
  it.each([
    ['specs/a.md', 'specs'],
    ['docs/b.md', 'docs'],
    ['docs/specs/x.md', 'specs'],
    ['INSIGHTS.md', 'insights'],
    ['server/INSIGHTS.md', 'insights'],
    ['insights/a.md', 'insights'],
    ['README.md', 'other'],
    ['specs.md', 'other'],
  ])('%s -> %s', (p, k) => {
    expect(kindForPath(p)).toBe(k);
  });
});

describe('orderForInjection', () => {
  it('agent first, then skills, deduped at first position', () => {
    expect(orderForInjection(['b'], [['a', 'b'], ['c']])).toEqual(['b', 'a', 'c']);
  });
  it('empty', () => {
    expect(orderForInjection([], [])).toEqual([]);
  });
});

describe('countUsedBy', () => {
  it('counts distinct agents', () => {
    const m = countUsedBy([
      { agentId: '1', path: 'a' },
      { agentId: '1', path: 'a' },
      { agentId: '2', path: 'a' },
      { agentId: '2', path: 'b' },
    ]);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
    expect(m.get('c')).toBeUndefined();
  });
});

describe('newPaths', () => {
  it('returns only paths not persisted', () => {
    expect(newPaths(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
});
