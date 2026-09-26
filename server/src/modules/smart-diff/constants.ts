import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Constants for Smart Diff (L03). Pure data only — ring 2 — see
 * `modules/smart-diff/README.md` for the rule table with its disputed cases.
 */

/** Display order in the Files changed tab: `core → tests → wiring → docs → boilerplate`. */
export const SMART_DIFF_ROLE_ORDER: readonly SmartDiffRole[] = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
];

/** A normalized path — `\` replaced by `/`, lowercased, split into directory
 *  segments and a basename. See `helpers.ts#normalizePath`. */
export interface NormalizedPath {
  /** Full normalized path (lowercased, `/`-separated). */
  path: string;
  /** Directory parts only — excludes the basename. */
  segments: string[];
  /** The final path segment, lowercased. */
  base: string;
}

type RoleRule = { role: SmartDiffRole; test: (p: NormalizedPath) => boolean };

const LOCK_BASENAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const BOILERPLATE_DIR_SEGMENTS = new Set(['dist', 'build', '__snapshots__']);
const TEST_DIR_SEGMENTS = new Set(['test', 'tests', '__tests__', 'e2e']);
const WIRING_INDEX_BASENAMES = new Set(['index.ts', 'index.tsx', 'index.js', 'index.mjs']);
const WIRING_DIR_SEGMENTS = new Set(['.github', '.claude']);
const DOCS_DIR_SEGMENTS = new Set(['docs']);

/**
 * Ordered classification rules — first match wins (spec §Scope rules 1–4).
 * `core` is not listed here: it is `classifyFile`'s fallback when nothing
 * matches. Order is `boilerplate → tests → wiring → docs`, which is why e.g.
 * `e2e/README.md` lands in `tests` (rule 2) rather than `docs` (rule 4), and
 * `.claude/skills/security/SKILL.md` lands in `wiring` (rule 3) rather than
 * `docs`.
 */
export const ROLE_RULES: readonly RoleRule[] = [
  {
    role: 'boilerplate',
    test: (p) =>
      LOCK_BASENAMES.has(p.base) ||
      p.base.endsWith('.lock') ||
      p.segments.some((s) => BOILERPLATE_DIR_SEGMENTS.has(s)) ||
      p.base.endsWith('.snap') ||
      /\.generated\./.test(p.base) ||
      p.base.endsWith('.min.js'),
  },
  {
    role: 'tests',
    test: (p) =>
      p.base.endsWith('.test.ts') ||
      p.base.endsWith('.test.tsx') ||
      p.base.endsWith('.spec.ts') ||
      p.base.endsWith('.spec.tsx') ||
      p.segments.some((s) => TEST_DIR_SEGMENTS.has(s)),
  },
  {
    role: 'wiring',
    test: (p) =>
      WIRING_INDEX_BASENAMES.has(p.base) ||
      /\.config\./.test(p.base) ||
      (p.base.startsWith('tsconfig') && p.base.endsWith('.json')) ||
      p.base.startsWith('.eslintrc') ||
      p.base.startsWith('.env') ||
      (p.base.startsWith('docker-compose') && (p.base.endsWith('.yml') || p.base.endsWith('.yaml'))) ||
      p.segments.some((s) => WIRING_DIR_SEGMENTS.has(s)),
  },
  {
    role: 'docs',
    test: (p) =>
      p.base.endsWith('.md') ||
      p.base.startsWith('readme') ||
      p.base.startsWith('changelog') ||
      p.base.startsWith('license') ||
      p.segments.some((s) => DOCS_DIR_SEGMENTS.has(s)),
  },
];
