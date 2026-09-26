import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/helpers.js';

/**
 * Classifier table — first match wins, per spec §Scope rules 1–4, else `core`.
 * A few cases are "disputed": the spec pins a specific outcome even though a
 * naive reading might expect another. Each disputed row's `it.each` title
 * states the tie-break so the reason survives a re-read of this file alone.
 */
describe('classifyFile', () => {
  it.each([
    ['pnpm-lock.yaml', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['Cargo.lock', 'boilerplate'],
    ['dist/app.js', 'boilerplate'],
    ['build/x.js', 'boilerplate'],
    ['src/x.generated.ts', 'boilerplate'],
    ['vendor/jquery.min.js', 'boilerplate'],
  ])('%s -> %s (lock/dist/build/generated/min rule)', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('src/__tests__/__snapshots__/x.snap -> boilerplate (disputed: the snapshot rule comes before tests)', () => {
    expect(classifyFile('src/__tests__/__snapshots__/x.snap')).toBe('boilerplate');
  });

  it.each([
    ['src/x.test.ts', 'tests'],
    ['src/x.test.tsx', 'tests'],
    ['server/test/reviews.it.test.ts', 'tests'],
    ['a/b.spec.tsx', 'tests'],
    ['server/test/helpers/pg.ts', 'tests'],
    ['tests/x.ts', 'tests'],
  ])('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it("e2e/README.md -> tests (disputed: e2e folder owns its README)", () => {
    expect(classifyFile('e2e/README.md')).toBe('tests');
  });

  it.each([
    ['src/index.ts', 'wiring'],
    ['vite.config.ts', 'wiring'],
    ['eslint.config.mjs', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
    ['.eslintrc.cjs', 'wiring'],
    ['.env.local', 'wiring'],
    ['docker-compose.test.yaml', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
  ])('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('.claude/skills/security/SKILL.md -> wiring (disputed: .claude/** comes before docs)', () => {
    expect(classifyFile('.claude/skills/security/SKILL.md')).toBe('wiring');
  });

  it.each([
    ['docs/x.md', 'docs'],
    ['README.md', 'docs'],
    ['readme.MD', 'docs'],
    ['CHANGELOG', 'docs'],
    ['LICENSE.txt', 'docs'],
    ['docs/diagram.png', 'docs'],
  ])('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it.each([
    ['server/src/modules/x/service.ts', 'core'],
    ['src/config.ts', 'core'],
  ])('%s -> %s (bare config.ts does not match *.config.*)', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it("scripts/build.ts -> core ('build' counts only as a directory segment)", () => {
    expect(classifyFile('scripts/build.ts')).toBe('core');
  });

  it('src\\\\__tests__\\\\x.test.ts -> tests (Windows path)', () => {
    expect(classifyFile('src\\__tests__\\x.test.ts')).toBe('tests');
  });
});
