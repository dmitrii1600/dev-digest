import { describe, it, expect } from 'vitest';
import { caseNameKey, checkManualTarget, pastedDiffFiles } from '../src/modules/evals/helpers.js';

// These fixture strings are mirrored in client/src/components/eval-cases/case-diff.test.ts.
// A rule change edits both tests.
const GIT_TWO_FILES = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' one',
  '+two',
  ' three',
  ' four',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -20,2 +20,3 @@',
  ' x',
  '+y',
  ' z',
].join('\n');

const BARE_ONE_FILE = [
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,6 +10,7 @@',
  '+const timeout = 0;',
  ' keep',
  ' keep',
  ' keep',
  ' keep',
  ' keep',
  ' keep',
].join('\n');

const BARE_TWO_FILES = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' one',
  '+two',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,1 +1,2 @@',
  ' one',
  '+two',
].join('\n');

describe('pastedDiffFiles', () => {
  it('(a) reads a diff --git two-file diff as two files', () => {
    const r = pastedDiffFiles(GIT_TWO_FILES);
    expect(r).toEqual({
      ok: true,
      files: [
        { path: 'src/a.ts', ranges: [[2, 2]] },
        { path: 'src/b.ts', ranges: [[21, 21]] },
      ],
    });
  });

  it('(b) reads the bare single-file placeholder as one file with its first added line', () => {
    expect(pastedDiffFiles(BARE_ONE_FILE)).toEqual({
      ok: true,
      files: [{ path: 'src/config.ts', ranges: [[10, 10]] }],
    });
  });

  it('(c) rejects a bare two-file diff', () => {
    expect(pastedDiffFiles(BARE_TWO_FILES)).toEqual({ ok: false, reason: 'diff_needs_git_headers' });
  });

  it('(d) rejects a hunk without file headers', () => {
    expect(pastedDiffFiles('@@ -1,1 +1,2 @@\n one\n+two')).toEqual({ ok: false, reason: 'diff_unparseable' });
  });

  it('(e) rejects a file header without a hunk', () => {
    expect(pastedDiffFiles('--- a/src/a.ts\n+++ b/src/a.ts\n')).toEqual({ ok: false, reason: 'diff_unparseable' });
    expect(pastedDiffFiles('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts')).toEqual({
      ok: false,
      reason: 'diff_unparseable',
    });
  });

  it('(f) drops a +++ /dev/null deletion, so a lone deletion is unparseable', () => {
    const del = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two';
    expect(pastedDiffFiles(del)).toEqual({ ok: false, reason: 'diff_unparseable' });
  });

  it('(g) keeps a root-level path as is', () => {
    const r = pastedDiffFiles('--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,2 @@\n a\n+b');
    expect(r).toEqual({ ok: true, files: [{ path: 'README.md', ranges: [[2, 2]] }] });
  });

  it('(h) parses CRLF line endings the same as LF', () => {
    const crlf = GIT_TWO_FILES.split('\n').join('\r\n');
    expect(pastedDiffFiles(crlf)).toEqual(pastedDiffFiles(GIT_TWO_FILES));
    expect(pastedDiffFiles(BARE_ONE_FILE.split('\n').join('\r\n'))).toEqual(pastedDiffFiles(BARE_ONE_FILE));
  });

  it('(k) a deletion-only hunk has no ranges', () => {
    const r = pastedDiffFiles('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,2 @@\n one\n-two\n three');
    expect(r).toEqual({ ok: true, files: [{ path: 'src/a.ts', ranges: [] }] });
  });

  it('splits non-adjacent added lines into separate runs and merges adjacent ones', () => {
    const d = '--- a/f.ts\n+++ b/f.ts\n@@ -1,6 +1,9 @@\n+a\n+b\n c\n+d\n e\n-f\n+g\n+h';
    const r = pastedDiffFiles(d);
    expect(r).toEqual({ ok: true, files: [{ path: 'f.ts', ranges: [[1, 2], [4, 4], [6, 7]] }] });
  });

  it('does not count a "\\ No newline" marker as a line', () => {
    const d = '--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file';
    expect(pastedDiffFiles(d)).toEqual({ ok: true, files: [{ path: 'f.ts', ranges: [[1, 1]] }] });
  });
});

describe('pastedDiffFiles — look-alike header lines (same fixture as the client parser)', () => {
  it('a deleted SQL comment (`--- ...` in the diff) does not shift the new-side line of the next added line', () => {
    const d = '--- a/db/q.sql\n+++ b/db/q.sql\n@@ -1,3 +1,3 @@\n select 1;\n--- old comment\n+-- new comment\n select 2;';
    expect(pastedDiffFiles(d)).toEqual({ ok: true, files: [{ path: 'db/q.sql', ranges: [[2, 2]] }] });
  });
});

describe('checkManualTarget', () => {
  const files = [{ path: 'src/a.ts', ranges: [[10, 12]] as [number, number][] }];
  const t = (file: string, s: number, e: number) => ({ file, start_line: s, end_line: e });

  it('(i) names a file that is not in the diff, including a .tsx near-miss and a case variant', () => {
    expect(checkManualTarget(files, t('src/a.tsx', 10, 10))).toEqual({
      reason: 'target_file_not_in_diff',
      field: 'target.file',
    });
    expect(checkManualTarget(files, t('src/A.ts', 10, 10))).toEqual({
      reason: 'target_file_not_in_diff',
      field: 'target.file',
    });
  });

  it('(j) overlap is inclusive: ending on the first changed line passes, one before does not', () => {
    expect(checkManualTarget(files, t('src/a.ts', 8, 10))).toBeNull();
    expect(checkManualTarget(files, t('src/a.ts', 8, 9))).toEqual({
      reason: 'target_outside_changes',
      field: 'target',
    });
    expect(checkManualTarget(files, t('src/a.ts', 12, 20))).toBeNull();
    expect(checkManualTarget(files, t('src/a.ts', 13, 20))).toEqual({
      reason: 'target_outside_changes',
      field: 'target',
    });
  });

  it('a file with no changed lines has no overlap', () => {
    expect(checkManualTarget([{ path: 'src/a.ts', ranges: [] }], t('src/a.ts', 1, 5))).toEqual({
      reason: 'target_outside_changes',
      field: 'target',
    });
  });
});

describe('caseNameKey', () => {
  it('(l) trims and ignores case', () => {
    expect(caseNameKey(' Stripe-Key ')).toBe(caseNameKey('stripe-key'));
  });
});
