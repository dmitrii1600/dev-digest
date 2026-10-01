import { describe, it, expect } from 'vitest';
import {
  kindForPath,
  orderForInjection,
  countUsedBy,
  newPaths,
  isUnderSpecsRoot,
  specsPathRule,
  entryNameRule,
  nextFreeName,
  toLf,
  contentRule,
  uploadBytesRule,
  readOnlyReason,
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

describe('isUnderSpecsRoot', () => {
  it.each([
    ['.devdigest/specs/a.md', true],
    ['.devdigest/specs/sub/a.md', true],
    ['docs/.devdigest/specs/a.md', false],
    ['.devdigest/specs-old/a.md', false],
    ['.devdigest/SPECS/a.md', false],
    ['.devdigest/specs/', false],
  ])('%s -> %s', (p, expected) => {
    expect(isUnderSpecsRoot(p)).toBe(expected);
  });
});

describe('specsPathRule', () => {
  it.each([
    ['/a.md', 'absolute'],
    ['C:\\x.md', 'absolute'],
    ['.devdigest/specs/../x.md', 'dotdot'],
    ['.devdigest/specs//a.md', 'empty_segment'],
    ['.devdigest/specs/a.txt', 'not_md'],
    ['docs/a.md', 'outside_root'],
    ['.devdigest/specs/a\\b.md', 'outside_root'],
    ['.devdigest/specs/a.md', null],
    ['.devdigest/specs/sub/A.MD', null],
  ])('%s -> %s', (p, rule) => {
    expect(specsPathRule(p)).toBe(rule);
  });
});

describe('entryNameRule', () => {
  it.each([
    ['CON', 'folder', 'reserved'],
    ['con.md', 'file', 'reserved'],
    ['Lpt9.md', 'file', 'reserved'],
    ['aux.txt.md', 'file', 'reserved'],
    ['COM0.md', 'file', null],
    ['CONSOLE.md', 'file', null],
    ['a<b.md', 'file', 'bad_char'],
    ['a\u001fb.md', 'file', 'bad_char'],
    ['a/b.md', 'file', 'bad_char'],
    ['x.md.', 'file', 'trailing'],
    ['x.md ', 'file', 'trailing'],
    ['..', 'folder', 'dot_name'],
    ['notes.MD', 'file', null],
    ['notes.mdx', 'file', 'not_md'],
    ['new-folder', 'folder', null],
  ] as const)('%j (%s) -> %s', (name, kind, rule) => {
    expect(entryNameRule(name, kind)).toBe(rule);
  });

  it('255 bytes passes, 256 fails', () => {
    expect(entryNameRule('a'.repeat(252) + '.md', 'file')).toBeNull();
    expect(entryNameRule('a'.repeat(253) + '.md', 'file')).toBe('too_long');
  });
  it('counts UTF-8 bytes, not characters', () => {
    expect(entryNameRule('€'.repeat(83) + '.md', 'file')).toBeNull(); // 252 bytes
    expect(entryNameRule('€'.repeat(84) + '.md', 'file')).toBeNull(); // 255 bytes
    expect(entryNameRule('€'.repeat(85) + '.md', 'file')).toBe('too_long'); // 258 bytes
  });
});

describe('nextFreeName', () => {
  const taken = (...n: string[]) => new Set(n.map((x) => x.toLowerCase()));
  it('free name is unchanged', () => {
    expect(nextFreeName('untitled.md', 'file', taken())).toBe('untitled.md');
  });
  it('suffixes -2 then -3', () => {
    expect(nextFreeName('untitled.md', 'file', taken('untitled.md'))).toBe('untitled-2.md');
    expect(nextFreeName('untitled.md', 'file', taken('untitled.md', 'untitled-2.md'))).toBe(
      'untitled-3.md',
    );
  });
  it('is case-insensitive and keeps the extension case', () => {
    expect(nextFreeName('untitled.md', 'file', taken('Untitled.MD'))).toBe('untitled-2.md');
    expect(nextFreeName('Notes.MD', 'file', taken('notes.md'))).toBe('Notes-2.MD');
  });
  it('folders', () => {
    expect(nextFreeName('new-folder', 'folder', taken('new-folder'))).toBe('new-folder-2');
  });
});

describe('contentRule / toLf', () => {
  it('exactly 65,536 bytes passes; 65,537 is too large', () => {
    expect(contentRule('a'.repeat(65_536))).toBeNull();
    expect(contentRule('a'.repeat(65_537))).toBe('too_large');
  });
  it('counts UTF-8 bytes (21,846 euro signs = 65,538 bytes)', () => {
    expect(contentRule('€'.repeat(21_846))).toBe('too_large');
  });
  it('measures after CRLF -> LF', () => {
    const text = ('a'.repeat(99) + '\r\n').repeat(655); // 66,155 bytes with CRLF, 65,500 after
    expect(Buffer.byteLength(text)).toBeGreaterThan(65_536);
    expect(Buffer.byteLength(toLf(text))).toBe(65_500);
    expect(contentRule(toLf(text))).toBeNull();
  });
  it('NUL and lone surrogate', () => {
    expect(contentRule('a\u0000b')).toBe('nul');
    expect(contentRule('\ud800')).toBe('not_utf8');
  });
  it('toLf only rewrites CRLF', () => {
    expect(toLf('a\r\nb\rc\n')).toBe('a\nb\rc\n');
  });
});

describe('uploadBytesRule', () => {
  it('invalid UTF-8', () => {
    expect(uploadBytesRule(new Uint8Array([0xc3, 0x28]))).toBe('not_utf8');
  });
  it('BOM passes', () => {
    expect(uploadBytesRule(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBeNull();
  });
  it('NUL and size', () => {
    expect(uploadBytesRule(new Uint8Array([0x61, 0, 0x62]))).toBe('nul');
    expect(uploadBytesRule(new Uint8Array(65_536).fill(0x61))).toBeNull();
    expect(uploadBytesRule(new Uint8Array(65_537).fill(0x61))).toBe('too_large');
  });
});

describe('readOnlyReason', () => {
  const p = '.devdigest/specs/a.md';
  it('size boundary', () => {
    expect(readOnlyReason({ path: p, tracked: false, size: 65_536 })).toBeNull();
    expect(readOnlyReason({ path: p, tracked: false, size: 65_537 })).toBe('too_large');
  });
  it('precedence: outside_root > tracked > too_large', () => {
    expect(readOnlyReason({ path: p, tracked: true, size: 70_000 })).toBe('tracked');
    expect(readOnlyReason({ path: 'docs/a.md', tracked: true, size: 70_000 })).toBe('outside_root');
  });
});
