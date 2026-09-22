#!/usr/bin/env node
/**
 * pr-self-review gate — the deterministic half of `.claude/skills/pr-self-review/`.
 *
 * One script, several modes, no dependencies beyond Node >= 22 and git:
 *
 *   scope   [--base <ref>] [--no-cache] [--offline]
 *           Work out what is under review: merge-base with origin/main, changed +
 *           untracked files, the skill routing per file, packages touched, the
 *           INSIGHTS.md files to read, per-file cache hits. Writes scope.json and
 *           prints it as JSON for the skill to read.
 *   checks  Run lint / typecheck (/ arch) in every touched package. Writes checks.json.
 *   static  Run the repo-specific rules that need no LLM (migrations, lock-files,
 *           CLAUDE.md stubs, do-not-touch, test naming, engine purity, secrets, …).
 *           Prints findings as JSON.
 *   finalize
 *           Compose report.json from static rules + checks.json + findings.json
 *           (the skill's own findings) + carried-over cached findings, apply
 *           waivers.json, compute the verdict, write pr-body.md, append
 *           history.jsonl, refresh cache.json. Prints a markdown summary.
 *   fingerprint
 *           Print the content fingerprint of the current tree (diff vs merge-base
 *           + untracked blobs). Committing the same content does not change it.
 *   claude  Claude Code PreToolUse hook: reads the tool call from stdin, and if it
 *           is `gh pr create|merge` or `git push`, blocks (exit 2) unless a fresh
 *           report.json says PASS for this exact tree.
 *   git     The same check as a git pre-push hook (exit 1 to block).
 *
 * Everything it writes lives under .devdigest/pr-self-review/ (git-ignored).
 * The routing table (`ROUTES`) is the source of truth — routing.md explains it.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths and constants
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, '.devdigest', 'pr-self-review');
const FILES = {
  scope: join(OUT_DIR, 'scope.json'),
  checks: join(OUT_DIR, 'checks.json'),
  findings: join(OUT_DIR, 'findings.json'),
  report: join(OUT_DIR, 'report.json'),
  waivers: join(OUT_DIR, 'waivers.json'),
  cache: join(OUT_DIR, 'cache.json'),
  history: join(OUT_DIR, 'history.jsonl'),
  prBody: join(OUT_DIR, 'pr-body.md'),
};
const REPORT_VERSION = 1;
const SEVERITY_SOURCE = 'server/src/vendor/shared/contracts/findings.ts';
const SKILLS_DIR = join(ROOT, '.claude', 'skills');
const PACKAGES = ['server', 'client', 'reviewer-core', 'e2e'];
const PM = { server: 'pnpm', client: 'pnpm', 'reviewer-core': 'npm', e2e: 'npm' };
const LOCKFILES = {
  server: 'server/pnpm-lock.yaml',
  client: 'client/pnpm-lock.yaml',
  'reviewer-core': 'reviewer-core/package-lock.json',
  e2e: 'e2e/package-lock.json',
};
const SIZE_LIMITS = { files: 40, lines: 1500 };
const INSIGHTS_THRESHOLD_LINES = 150;
const INLINE_REVIEW_MAX_FILES = 10;
// Only a command that *starts* a shell segment counts — `echo "gh pr create"` does not.
const GATED_COMMAND = /(^|[;&|(\n]\s*)(gh\s+pr\s+(create|merge)|git\s+push)\b/;
const IS_WIN = process.platform === 'win32';

// Skills that exist but are not review skills — never "unrouted".
const NON_REVIEW_SKILLS = new Set(['engineering-insights', 'mermaid-diagram', 'pr-self-review']);

/**
 * Routing table: the first route whose `test` matches wins. `skills` are always
 * applied; `extra(path, content)` adds conditional ones. A source file that
 * matches nothing is reported as `unrouted` (WARNING).
 */
const ROUTES = [
  {
    group: 'frontend',
    test: (p) =>
      p.startsWith('client/src/') &&
      /\.(ts|tsx)$/.test(p) &&
      !/\.test\.tsx?$/.test(p) &&
      !p.startsWith('client/src/vendor/'),
    skills: ['frontend-ui-architecture', 'react-best-practices'],
    extra: (p, content) =>
      /(^|\/)(page|layout|loading|error|not-found|template|default)\.tsx$/.test(p) ||
      /(^|\/)(route|middleware)\.ts$/.test(p) ||
      /['"]use (client|server)['"]/.test(content) ||
      /from\s+['"]next(\/|['"])/.test(content)
        ? ['next-best-practices']
        : [],
  },
  {
    group: 'frontend-tests',
    test: (p) => p.startsWith('client/') && /\.test\.tsx?$/.test(p),
    skills: ['react-testing-library'],
    extra: () => [],
  },
  {
    group: 'backend',
    test: (p) =>
      p.startsWith('server/src/') && /\.ts$/.test(p) && !p.startsWith('server/src/vendor/ui/'),
    skills: ['onion-architecture'],
    extra: (p) => {
      const s = [];
      if (/(^|\/)(routes|app|server)\.ts$/.test(p) || p.startsWith('server/src/platform/')) {
        s.push('fastify-best-practices');
      }
      if (/repository[^/]*\.ts$/.test(p) || p.startsWith('server/src/db/')) {
        s.push('drizzle-orm-patterns');
      }
      if (p.startsWith('server/src/db/schema/')) s.push('postgresql-table-design');
      if (/(^|\/)routes\.ts$/.test(p) || /^server\/src\/adapters\/(auth|secrets|github)\//.test(p)) {
        s.push('security');
      }
      if (p.startsWith('server/src/vendor/shared/contracts/')) s.push('zod', 'typescript-expert');
      return s;
    },
  },
  {
    group: 'engine',
    test: (p) => p.startsWith('reviewer-core/src/') && /\.ts$/.test(p) && !/\.test\.ts$/.test(p),
    skills: ['typescript-expert'],
    extra: (p) => {
      const s = [];
      if (/(prompt|grounding)\.ts$/.test(p) || p.includes('/llm/')) s.push('security');
      if (/schema|contract|structured/.test(p)) s.push('zod');
      return s;
    },
  },
  {
    group: 'convention-only',
    test: (p) =>
      p.startsWith('e2e/') ||
      p.startsWith('server/test/') ||
      p.startsWith('reviewer-core/test/') ||
      /\.test\.tsx?$/.test(p) ||
      p.startsWith('client/messages/') ||
      p.startsWith('client/src/vendor/') ||
      p.startsWith('server/src/vendor/ui/') ||
      p.startsWith('.claude/') ||
      p.startsWith('.githooks/') ||
      p.startsWith('.github/') ||
      p.startsWith('scripts/') ||
      p.startsWith('docs/') ||
      /(^|\/)(specs|migrations)\//.test(p) ||
      /\.(md|json|jsonc|yaml|yml|sql|sh|cjs|mjs|toml|txt|svg|png|ico|css|lock)$/.test(p) ||
      /(^|\/)\.(gitignore|gitattributes|env\.example|npmrc|nvmrc)$/.test(p) ||
      /(^|\/)(package\.json|tsconfig[^/]*\.json|eslint\.config\.[cm]?js|vitest\.config\.[cm]?ts|next\.config\.[cm]?[jt]s|postcss\.config\.[cm]?js|tailwind\.config\.[cm]?[jt]s|drizzle\.config\.ts)$/.test(
        p,
      ),
    skills: [],
    extra: () => [],
  },
];

const ALL_ROUTED_SKILLS = new Set([
  'frontend-ui-architecture',
  'react-best-practices',
  'next-best-practices',
  'react-testing-library',
  'onion-architecture',
  'fastify-best-practices',
  'drizzle-orm-patterns',
  'postgresql-table-design',
  'security',
  'zod',
  'typescript-expert',
]);

const CHECKS = {
  server: [
    ['pnpm', ['run', 'lint']],
    ['pnpm', ['run', 'typecheck']],
    ['pnpm', ['run', 'arch']],
  ],
  client: [
    ['pnpm', ['run', 'lint']],
    ['pnpm', ['run', 'typecheck']],
  ],
  'reviewer-core': [
    ['npm', ['run', 'lint']],
    ['npm', ['run', 'typecheck']],
  ],
  e2e: [
    ['npm', ['run', 'lint']],
    ['npm', ['run', 'typecheck']],
  ],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').trim()}`);
  }
  return r.status === 0 ? r.stdout : null;
}

function sha256(...parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${rel(path)} is not valid JSON: ${e.message}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function rel(abs) {
  return abs.slice(ROOT.length + 1).split('\\').join('/');
}

function readTree(path) {
  const abs = join(ROOT, path);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

function packageOf(path) {
  return PACKAGES.find((p) => path === p || path.startsWith(p + '/')) ?? null;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** The Severity enum, read from the canonical contract so the two cannot drift. */
function severityEnum() {
  const src = readTree(SEVERITY_SOURCE);
  const m = src.match(/export const Severity = z\.enum\(\[([^\]]+)\]\)/);
  if (!m) return ['CRITICAL', 'WARNING', 'SUGGESTION'];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Git state: base, files, diff, fingerprint
// ---------------------------------------------------------------------------

function resolveBase(explicit, { offline = false } = {}) {
  if (!offline) {
    // Best-effort: a stale origin/main makes the merge-base drift. Never fatal.
    spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: ROOT, timeout: 15_000 });
  }
  const candidates = explicit ? [explicit] : ['origin/main', 'main'];
  for (const c of candidates) {
    const mb = git(['merge-base', c, 'HEAD'], { allowFail: true });
    if (mb) return { ref: c, sha: mb.trim() };
  }
  throw new Error(`cannot resolve a base: tried ${candidates.join(', ')}`);
}

/** Changed files vs base (working tree, so committed + uncommitted) plus untracked. */
function changedFiles(baseSha) {
  const files = [];
  const out = git(['diff', '--name-status', '-M', baseSha, '--']);
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if (code === 'R' || code === 'C') files.push({ path: parts[2], status: code, from: parts[1] });
    else files.push({ path: parts[1], status: code });
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  for (const p of untracked.split('\n')) {
    if (p.trim()) files.push({ path: p, status: 'A', untracked: true });
  }
  return files;
}

function fullDiff(baseSha) {
  return git(['diff', '--no-color', '--no-ext-diff', baseSha, '--']);
}

function blobHash(path) {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return null;
  return git(['hash-object', '--', abs], { allowFail: true })?.trim() ?? null;
}

function computeFingerprint(baseSha, files) {
  const diff = fullDiff(baseSha);
  const untracked = files
    .filter((f) => f.untracked)
    .map((f) => `${f.path}:${blobHash(f.path)}`)
    .sort()
    .join('\n');
  return sha256(diff, '\n--untracked--\n', untracked);
}

/**
 * Per-file changed-line info on the NEW side: added lines (with text), removed
 * lines (text only) and hunk ranges with 3 lines of context — what a reviewer
 * sees. Untracked files count as entirely added.
 */
function fileHunks(baseSha, file) {
  const added = [];
  const ranges = [];
  const removed = [];
  if (file.untracked) {
    const lines = readTree(file.path).split(/\r?\n/);
    lines.forEach((t, i) => added.push({ line: i + 1, text: t }));
    ranges.push([1, Math.max(lines.length, 1)]);
    return { added, ranges, removed };
  }
  if (file.status === 'D') return { added, ranges, removed };
  const diff = git(['diff', '--no-color', '--no-ext-diff', '-U3', baseSha, '--', file.path], {
    allowFail: true,
  });
  if (!diff) return { added, ranges, removed };
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      newLine = Number(h[1]);
      const len = h[2] === undefined ? 1 : Number(h[2]);
      ranges.push([newLine, Math.max(newLine, newLine + len - 1)]);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      removed.push(raw.slice(1));
    } else if (raw.startsWith(' ') || raw === '') {
      newLine++;
    }
  }
  return { added, ranges, removed };
}

function numstat(baseSha, files) {
  let lines = 0;
  const out = git(['diff', '--numstat', baseSha, '--']);
  for (const l of out.split('\n')) {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t/);
    if (m) lines += (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]));
  }
  for (const f of files) {
    if (f.untracked) lines += readTree(f.path).split(/\r?\n/).length;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function isSourceFile(p) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
}

function routeFile(file) {
  const p = file.path;
  const content = file.status === 'D' ? '' : readTree(p);
  for (const r of ROUTES) {
    if (r.test(p)) {
      const skills = [...new Set([...r.skills, ...r.extra(p, content)])];
      return { group: r.group, skills };
    }
  }
  return { group: isSourceFile(p) ? 'unrouted' : 'convention-only', skills: [] };
}

function skillsOnDisk() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => {
      const fm = readFileSync(join(SKILLS_DIR, d.name, 'SKILL.md'), 'utf8').match(/^name:\s*(.+)$/m);
      return fm ? fm[1].trim() : d.name;
    });
}

function packagesTouched(files) {
  const pkgs = new Set();
  const checks = new Map(); // pkg -> Set of "pm run x"
  for (const f of files) {
    const pkg = packageOf(f.path);
    if (pkg) pkgs.add(pkg);
  }
  for (const pkg of pkgs) {
    const list = checks.get(pkg) ?? new Set();
    for (const [pm, args] of CHECKS[pkg]) list.add(`${pm} ${args.join(' ')}`);
    checks.set(pkg, list);
  }
  // server type-checks ../reviewer-core/src through a tsconfig path alias.
  if (pkgs.has('reviewer-core') && !pkgs.has('server')) {
    checks.set('server', new Set(['pnpm run typecheck']));
  }
  // A contract change must still type-check in the client's mirrored copy.
  if (files.some((f) => f.path.startsWith('server/src/vendor/shared/')) && !pkgs.has('client')) {
    checks.set('client', new Set(['pnpm run typecheck']));
  }
  return {
    packages: [...pkgs],
    checks: [...checks].map(([pkg, set]) => ({ pkg, commands: [...set] })),
  };
}

function insightsFor(files) {
  const set = new Set(['INSIGHTS.md']);
  for (const f of files) {
    const pkg = packageOf(f.path);
    if (pkg) set.add(`${pkg}/INSIGHTS.md`);
  }
  return [...set].filter((p) => existsSync(join(ROOT, p)));
}

// ---------------------------------------------------------------------------
// Static rules — CRITICAL/WARNING findings that need no LLM
// ---------------------------------------------------------------------------

function finding(rule, severity, file, line, summary, evidence, fix, extra = {}) {
  return {
    id: `static:${rule}:${file}${line ? ':' + line : ''}`,
    severity,
    skill: 'static',
    rule,
    file,
    line: line ?? 0,
    summary,
    evidence,
    fix,
    ...extra,
  };
}

const SECRET_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'OpenAI-style key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
];
const ENGINE_FORBIDDEN_IMPORTS =
  /from\s+['"](node:)?(fs|fs\/promises|child_process|path|os|net|http|https)['"]|from\s+['"](pg|postgres|drizzle-orm|octokit|@octokit\/[^'"]+|simple-git|fastify)['"]/;

function staticRules(ctx) {
  const { files, baseSha, hunks, lines, skills } = ctx;
  const out = [];
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));

  // --- migrations ---------------------------------------------------------
  for (const f of files) {
    if (!f.path.startsWith('server/src/db/migrations/')) continue;
    const isSql = f.path.endsWith('.sql');
    const isSnapshot = /meta\/\d{4}_snapshot\.json$/.test(f.path);
    if ((isSql || isSnapshot) && f.status !== 'A') {
      out.push(
        finding(
          'migration-edited',
          'CRITICAL',
          f.path,
          0,
          'An applied migration was modified or removed',
          `status ${f.status} vs ${baseSha.slice(0, 7)}`,
          'Never edit an applied migration; generate a new one with `pnpm db:generate` (AGENTS.md → Do not touch).',
        ),
      );
    }
    if (isSql && f.status === 'A') {
      const name = posix.basename(f.path);
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) {
        out.push(
          finding(
            'migration-name',
            'CRITICAL',
            f.path,
            0,
            'Migration file is not named `NNNN_name.sql`',
            name,
            'Migrations are generated by `pnpm db:generate`, never named by hand.',
          ),
        );
      }
      if (!paths.has('server/src/db/migrations/meta/_journal.json')) {
        out.push(
          finding(
            'migration-journal',
            'CRITICAL',
            f.path,
            0,
            'New migration without a matching `meta/_journal.json` entry',
            'meta/_journal.json is not in the diff',
            'Regenerate with `pnpm db:generate`; drizzle-kit writes the SQL, the snapshot and the journal together.',
          ),
        );
      }
    }
  }

  // --- lock-files ----------------------------------------------------------
  for (const [pkg, lock] of Object.entries(LOCKFILES)) {
    const f = byPath.get(lock);
    if (!f) continue;
    if (f.status === 'D') {
      out.push(
        finding(
          'lockfile',
          'CRITICAL',
          lock,
          0,
          'Lock-file deleted',
          'status D',
          'Restore it. Never delete a lock-file to "fix" an install.',
        ),
      );
    } else if (!paths.has(`${pkg}/package.json`)) {
      out.push(
        finding(
          'lockfile',
          'CRITICAL',
          lock,
          0,
          'Lock-file changed without a change to its package.json',
          `${pkg}/package.json is not in the diff`,
          `A lock-file changes only by running ${PM[pkg]} in ${pkg}/ after a package.json change. Hand edits and copies between packages are forbidden.`,
        ),
      );
    }
  }

  // --- CLAUDE.md is a two-line stub ---------------------------------------
  for (const f of files) {
    if (!/(^|\/)CLAUDE\.md$/.test(f.path) || f.status === 'D') continue;
    // An HTML comment explaining the stub is fine; anything else is content.
    const body = readTree(f.path).replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').trim();
    if (body !== '@AGENTS.md') {
      out.push(
        finding(
          'claude-md-stub',
          'CRITICAL',
          f.path,
          1,
          'CLAUDE.md carries content other than `@AGENTS.md`',
          body.split('\n').slice(0, 3).join(' | '),
          'Write the content into AGENTS.md; CLAUDE.md is a stub so non-Claude agents see the same instructions.',
        ),
      );
    }
  }

  // --- do-not-touch --------------------------------------------------------
  if (paths.has('reviewer-core/src/grounding.ts')) {
    out.push(
      finding(
        'do-not-touch',
        'CRITICAL',
        'reviewer-core/src/grounding.ts',
        0,
        'The anti-hallucination gate was changed',
        'reviewer-core/src/grounding.ts is in the diff',
        'Changing it changes what a review means. Discuss first; if agreed, add a waiver with the decision as the reason.',
        { waivable: true },
      ),
    );
  }
  if (paths.has('reviewer-core/src/prompt.ts')) {
    const h = hunks.get('reviewer-core/src/prompt.ts');
    const diffText =
      git(['diff', '-U3', baseSha, '--', 'reviewer-core/src/prompt.ts'], { allowFail: true }) ?? '';
    if (/INJECTION_GUARD/.test(diffText) || byPath.get('reviewer-core/src/prompt.ts').untracked) {
      out.push(
        finding(
          'do-not-touch',
          'CRITICAL',
          'reviewer-core/src/prompt.ts',
          h.added.find((a) => /INJECTION_GUARD/.test(a.text))?.line ?? 0,
          '`INJECTION_GUARD` (or code adjacent to it) was changed',
          'INJECTION_GUARD appears in the prompt.ts hunks',
          'One shared trusted rule; never replace it with keyword scanning of untrusted text. Discuss first; waive with the decision as the reason.',
          { waivable: true },
        ),
      );
    }
  }

  // --- *.it.test.ts naming --------------------------------------------------
  for (const f of files) {
    if (!f.path.startsWith('server/test/') || !/\.test\.ts$/.test(f.path) || f.status === 'D') continue;
    const src = readTree(f.path);
    const hitsDb =
      /testcontainers|from\s+['"][^'"]*db\/client(\.js)?['"]|withPostgres|startPostgres/.test(src);
    const isIt = /\.it\.test\.ts$/.test(f.path);
    if (hitsDb && !isIt) {
      out.push(
        finding(
          'test-naming',
          'CRITICAL',
          f.path,
          1,
          'DB-backed test is not named `*.it.test.ts`',
          'imports testcontainers / db/client',
          'Rename to *.it.test.ts — the CI split is filename-driven; this file would run in the hermetic lane and fail without Docker.',
        ),
      );
    } else if (!hitsDb && isIt) {
      out.push(
        finding(
          'test-naming',
          'WARNING',
          f.path,
          1,
          '`*.it.test.ts` file does not appear to touch Postgres',
          'no testcontainers / db/client import found',
          'If it is hermetic, name it *.test.ts so it runs in the fast lane.',
        ),
      );
    }
  }

  // --- reviewer-core purity ------------------------------------------------
  for (const f of files) {
    if (!f.path.startsWith('reviewer-core/src/') || /\.test\.ts$/.test(f.path) || f.status === 'D') {
      continue;
    }
    for (const a of hunks.get(f.path).added) {
      if (ENGINE_FORBIDDEN_IMPORTS.test(a.text)) {
        out.push(
          finding(
            'engine-purity',
            'CRITICAL',
            f.path,
            a.line,
            'reviewer-core imports the outside world',
            a.text.trim(),
            'The engine is pure: no fs, network, DB or GitHub. Inject it through the server, or put it behind LLMProvider.',
          ),
        );
      }
    }
  }

  // --- secrets ---------------------------------------------------------------
  for (const f of files) {
    if (f.status === 'D') continue;
    const base = posix.basename(f.path);
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
      out.push(
        finding(
          'secret',
          'CRITICAL',
          f.path,
          0,
          'Environment file in the diff',
          base,
          'Env files are never committed; secrets go through SecretsProvider → ~/.devdigest/secrets.json.',
        ),
      );
      continue;
    }
    if (base === 'secrets.json') {
      out.push(finding('secret', 'CRITICAL', f.path, 0, 'secrets.json in the diff', base, 'Remove it from the tree.'));
      continue;
    }
    if (/\.(png|jpg|jpeg|gif|ico|woff2?|lock)$/.test(base)) continue;
    for (const a of hunks.get(f.path).added) {
      for (const [re, label] of SECRET_PATTERNS) {
        if (re.test(a.text)) {
          out.push(
            finding(
              'secret',
              'CRITICAL',
              f.path,
              a.line,
              `Looks like a ${label}`,
              a.text.trim().slice(0, 80),
              'Rotate it and move it out of the repo.',
            ),
          );
          break;
        }
      }
    }
  }

  // --- e2e flows ---------------------------------------------------------------
  for (const f of files) {
    if (!f.path.startsWith('e2e/specs/') || f.status === 'D') continue;
    const base = posix.basename(f.path);
    if (f.status === 'A' && !/^\d{2}-[a-z0-9-]+\.flow\.json$/.test(base)) {
      out.push(
        finding(
          'e2e-flow',
          'CRITICAL',
          f.path,
          0,
          'Flow file is not named `NN-name.flow.json`',
          base,
          'run.ts discovers flows by that suffix and runs them in filename order.',
        ),
      );
    }
    for (const a of hunks.get(f.path).added) {
      if (/"chat"/.test(a.text)) {
        out.push(
          finding(
            'e2e-flow',
            'CRITICAL',
            f.path,
            a.line,
            'Flow uses the AI `chat` command',
            a.text.trim(),
            'Deterministic locators only (--url, --text, find role|text|label); chat needs a model key and flakes.',
          ),
        );
        break;
      }
    }
  }

  // --- shared contracts mirrored in both vendor copies -----------------------
  for (const f of files) {
    const m = f.path.match(/^(server|client)\/src\/vendor\/shared\/(.+)$/);
    if (!m) continue;
    const other = `${m[1] === 'server' ? 'client' : 'server'}/src/vendor/shared/${m[2]}`;
    if (existsSync(join(ROOT, other)) && !paths.has(other)) {
      out.push(
        finding(
          'shared-drift',
          'WARNING',
          f.path,
          0,
          'Contract changed in one vendor copy only',
          `${other} unchanged`,
          'The server copy is canonical; mirror the change into the other copy in the same commit (root AGENTS.md → Gotchas).',
        ),
      );
    }
  }

  // --- size ----------------------------------------------------------------------
  if (files.length > SIZE_LIMITS.files || lines > SIZE_LIMITS.lines) {
    out.push(
      finding(
        'pr-size',
        'WARNING',
        files[0]?.path ?? '.',
        0,
        `Large diff: ${files.length} files, ~${lines} changed lines`,
        `limits ${SIZE_LIMITS.files} files / ${SIZE_LIMITS.lines} lines`,
        'Review quality drops with size. Split into independent PRs if the changes are separable.',
      ),
    );
  }

  // --- INSIGHTS.md hygiene --------------------------------------------------------
  const sourceLines = files
    .filter((f) => isSourceFile(f.path) && f.status !== 'D')
    .reduce((n, f) => n + (hunks.get(f.path)?.added.length ?? 0), 0);
  const insightsTouched = files.some((f) => /(^|\/)INSIGHTS[^/]*\.md$/.test(f.path));
  if (sourceLines > INSIGHTS_THRESHOLD_LINES && !insightsTouched) {
    out.push(
      finding(
        'no-insights',
        'WARNING',
        files.find((f) => isSourceFile(f.path))?.path ?? '.',
        0,
        `~${sourceLines} added source lines and no INSIGHTS.md entry`,
        'no INSIGHTS.md in the diff',
        'If anything non-obvious came up, run /engineering-insights. If nothing did, say so in the PR body.',
      ),
    );
  }
  for (const f of files) {
    if (!/(^|\/)INSIGHTS[^/]*\.md$/.test(f.path) || f.status !== 'M') continue;
    const removedEntries = hunks
      .get(f.path)
      .removed.filter((t) => /^\s*- \d{4}-\d{2}-\d{2} —|^### \d{4}-\d{2}-\d{2}/.test(t));
    if (removedEntries.length) {
      out.push(
        finding(
          'insights-rewrite',
          'WARNING',
          f.path,
          0,
          `${removedEntries.length} existing INSIGHTS entr${removedEntries.length === 1 ? 'y' : 'ies'} removed or rewritten`,
          removedEntries[0].trim().slice(0, 80),
          'INSIGHTS.md is append-only; refine a line in place only when this session sharpened it.',
        ),
      );
    }
  }

  // --- new feature component without its test ------------------------------------
  for (const f of files) {
    const m = f.path.match(/^(client\/src\/app\/.*\/_components\/([A-Za-z0-9]+))\/\2\.tsx$/);
    if (!m || f.status !== 'A') continue;
    const test = `${m[1]}/${m[2]}.test.tsx`;
    if (!existsSync(join(ROOT, test))) {
      out.push(
        finding(
          'component-test-missing',
          'WARNING',
          f.path,
          1,
          `New feature component without ${m[2]}.test.tsx`,
          `${test} not found`,
          'A feature folder owns its code and its test (client/AGENTS.md).',
        ),
      );
    }
  }

  // --- routing self-check --------------------------------------------------------
  for (const s of skills.onDisk) {
    if (!ALL_ROUTED_SKILLS.has(s) && !NON_REVIEW_SKILLS.has(s)) {
      out.push(
        finding(
          'unrouted-skill',
          'WARNING',
          `.claude/skills/${s}/SKILL.md`,
          1,
          `Skill \`${s}\` exists but has no row in the routing table`,
          'not in ROUTES / NON_REVIEW_SKILLS of pr-self-review-gate.mjs',
          'Add it to ROUTES (and routing.md) or to NON_REVIEW_SKILLS, so the table does not rot.',
        ),
      );
    }
  }
  for (const s of ALL_ROUTED_SKILLS) {
    if (!skills.onDisk.includes(s)) {
      out.push(
        finding(
          'unrouted-skill',
          'WARNING',
          '.claude/hooks/pr-self-review-gate.mjs',
          1,
          `Routing references skill \`${s}\` which is not on disk`,
          `.claude/skills/${s}/SKILL.md missing`,
          'Remove the route or restore the skill.',
        ),
      );
    }
  }
  for (const f of files) {
    if (f.route.group === 'unrouted') {
      out.push(
        finding(
          'unrouted-file',
          'WARNING',
          f.path,
          1,
          'Source file matched no routing group',
          f.path,
          'Extend ROUTES in pr-self-review-gate.mjs so this file gets a review skill, or mark its folder convention-only.',
        ),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

function buildContext(opts = {}) {
  const base = resolveBase(opts.base, { offline: !!opts.offline });
  const files = changedFiles(base.sha);
  for (const f of files) f.route = routeFile(f);
  const hunks = new Map(files.map((f) => [f.path, fileHunks(base.sha, f)]));
  const lines = numstat(base.sha, files);
  const skills = { onDisk: skillsOnDisk() };
  return {
    base,
    baseSha: base.sha,
    files,
    hunks,
    lines,
    skills,
    fingerprint: computeFingerprint(base.sha, files),
  };
}

function modeScope(args) {
  const started = new Date().toISOString();
  const ctx = buildContext({ base: args.base, offline: args.offline });
  const cache = args['no-cache'] ? { files: {} } : readJson(FILES.cache, { files: {} });
  const prev = readJson(FILES.report, null);
  const routed = packagesTouched(ctx.files);

  const files = ctx.files.map((f) => {
    const hash = f.status === 'D' ? null : blobHash(f.path);
    const cached =
      !!prev && !!hash && cache.files[f.path] === hash && f.route.skills.length > 0 && !args['no-cache'];
    const h = ctx.hunks.get(f.path);
    return {
      path: f.path,
      status: f.status,
      ...(f.from ? { from: f.from } : {}),
      ...(f.untracked ? { untracked: true } : {}),
      group: f.route.group,
      skills: f.route.skills,
      hunks: h.ranges,
      added_lines: h.added.length,
      hash,
      cached,
    };
  });

  const groups = {};
  for (const f of files) {
    if (!f.skills.length) continue;
    const g = (groups[f.group] ??= { skills: new Set(), files: [], to_review: [] });
    f.skills.forEach((s) => g.skills.add(s));
    g.files.push(f.path);
    if (!f.cached) g.to_review.push(f.path);
  }
  for (const g of Object.values(groups)) g.skills = [...g.skills];

  const toReview = files.filter((f) => f.skills.length && !f.cached).length;
  const scope = {
    version: REPORT_VERSION,
    started_at: started,
    base: { ref: ctx.base.ref, sha: ctx.base.sha },
    head: git(['rev-parse', 'HEAD']).trim(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    fingerprint: ctx.fingerprint,
    changed_lines: ctx.lines,
    packages: routed.packages,
    checks: routed.checks,
    insights_to_read: insightsFor(ctx.files),
    review_mode: toReview > INLINE_REVIEW_MAX_FILES ? 'subagent-per-group' : 'inline',
    files_to_review: toReview,
    groups,
    files,
    static_findings: staticRules(ctx),
    severity_enum: severityEnum(),
  };
  writeJson(FILES.scope, scope);
  process.stdout.write(JSON.stringify(scope, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function modeChecks() {
  const scope = readJson(FILES.scope, null);
  if (!scope) throw new Error('run `scope` first');
  const results = [];
  for (const { pkg, commands } of scope.checks) {
    for (const cmd of commands) {
      const [pm, ...args] = cmd.split(' ');
      const t0 = Date.now();
      const r = spawnSync(pm, args, {
        cwd: join(ROOT, pkg),
        encoding: 'utf8',
        shell: IS_WIN,
        timeout: 10 * 60_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      });
      const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      const ms = Date.now() - t0;
      results.push({
        pkg,
        cmd,
        ok: r.status === 0,
        exit: r.status,
        ms,
        tail: output.split('\n').slice(-40).join('\n'),
      });
      process.stderr.write(
        `[checks] ${pkg}: ${cmd} → ${r.status === 0 ? 'ok' : 'FAIL (' + r.status + ')'} in ${ms}ms\n`,
      );
    }
  }
  writeJson(FILES.checks, { fingerprint: scope.fingerprint, results });
  process.stdout.write(
    JSON.stringify({ results: results.map(({ tail, ...r }) => r) }, null, 2) + '\n',
  );
  for (const r of results) {
    if (!r.ok) process.stdout.write(`\n--- ${r.pkg}: ${r.cmd} ---\n${r.tail}\n`);
  }
}

// ---------------------------------------------------------------------------
// Finalize: compose the report, apply waivers, verdict, pr-body, history, cache
// ---------------------------------------------------------------------------

function normaliseSeverity(s, enumValues) {
  const up = String(s ?? '').toUpperCase();
  if (enumValues.includes(up)) return up;
  if (up === 'HIGH') return 'WARNING';
  if (up === 'MEDIUM' || up === 'LOW' || up === 'INFO') return 'SUGGESTION';
  return null;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function modeFinalize() {
  const scope = readJson(FILES.scope, null);
  if (!scope) throw new Error('run `scope` first');
  const ctx = buildContext({ base: scope.base.ref, offline: true });
  if (ctx.fingerprint !== scope.fingerprint) {
    throw new Error('tree changed since `scope` ran — re-run /pr-self-review from the start');
  }
  const enumValues = severityEnum();
  const checks = readJson(FILES.checks, { results: [] });
  if (checks.fingerprint && checks.fingerprint !== scope.fingerprint) {
    throw new Error('checks.json belongs to a different tree — run `checks` again');
  }
  const raw = readJson(FILES.findings, []);
  const prev = readJson(FILES.report, null);
  const waivers = readJson(FILES.waivers, []);
  const byPath = new Map(scope.files.map((f) => [f.path, f]));

  const findings = [];
  const dropped = [];

  // 1. static rules, recomputed fresh
  findings.push(...staticRules(ctx));

  // 2. failed machine checks
  for (const r of checks.results ?? []) {
    if (r.ok) continue;
    findings.push({
      id: `check:${r.pkg}:${slug(r.cmd)}`,
      severity: 'CRITICAL',
      skill: 'check',
      rule: r.cmd,
      file: `${r.pkg}/package.json`,
      line: 0,
      summary: `\`${r.cmd}\` failed in ${r.pkg}/ (exit ${r.exit})`,
      evidence: (r.tail ?? '').split('\n').slice(-12).join('\n'),
      fix: `cd ${r.pkg} && ${r.cmd}`,
    });
  }

  // 3. the skill's own findings — validated and grounded
  const rawList = Array.isArray(raw) ? raw : (raw?.findings ?? []);
  for (const f of rawList) {
    const reasons = [];
    const sev = normaliseSeverity(f.severity, enumValues);
    if (!sev) reasons.push(`severity "${f.severity}" not in [${enumValues.join(', ')}]`);
    const sf = byPath.get(f.file);
    if (!sf) reasons.push(`file "${f.file}" is not in the diff`);
    const line = Number(f.line);
    if (sf && (!Number.isInteger(line) || line < 1)) reasons.push('line must be a positive integer');
    if (sf && Number.isInteger(line) && line >= 1 && !sf.hunks.some(([a, b]) => line >= a && line <= b)) {
      reasons.push(
        `line ${line} is outside every hunk of ${f.file} (${sf.hunks.map(([a, b]) => `${a}-${b}`).join(', ')})`,
      );
    }
    if (!f.skill || (!ALL_ROUTED_SKILLS.has(f.skill) && f.skill !== 'insights')) {
      reasons.push(`skill "${f.skill}" is not a routed skill`);
    }
    if (!f.rule) reasons.push('rule (the skill section/rule name) is required');
    if (!f.summary) reasons.push('summary is required');
    if (reasons.length) {
      dropped.push({ ...f, reasons });
      continue;
    }
    findings.push({
      id: f.id || `${f.skill}:${f.file}:${line}:${slug(f.rule)}`,
      severity: sev,
      skill: f.skill,
      rule: f.rule,
      file: f.file,
      line,
      summary: f.summary,
      evidence: f.evidence ?? '',
      fix: f.fix ?? '',
    });
  }

  // 4. carried-over findings for cached files (skill findings only). A fresh
  //    finding with the same id wins — findings.json may legitimately still
  //    list a cached file (e.g. a finalize re-run after adding a waiver).
  if (prev) {
    const seen = new Set(findings.map((f) => f.id));
    for (const sf of scope.files) {
      if (!sf.cached) continue;
      for (const pf of prev.findings ?? []) {
        if (pf.file !== sf.path || pf.skill === 'static' || pf.skill === 'check' || seen.has(pf.id)) {
          continue;
        }
        const { waived, waiver_reason, waiver_author, carried, ...rest } = pf;
        findings.push({ ...rest, carried: true });
        seen.add(pf.id);
      }
    }
  }
  // Duplicate ids from any source collapse to the first occurrence.
  {
    const seen = new Set();
    for (let i = findings.length - 1; i >= 0; i--) {
      if (seen.has(findings[i].id)) findings.splice(i, 1);
      else seen.add(findings[i].id);
    }
  }

  // 5. waivers
  const waiverById = new Map(waivers.map((w) => [w.id, w]));
  for (const f of findings) {
    const w = waiverById.get(f.id);
    if (w && w.reason) {
      f.waived = true;
      f.waiver_reason = w.reason;
      f.waiver_author = w.author ?? null;
    }
  }
  const staleWaivers = waivers.filter((w) => !findings.some((f) => f.id === w.id)).map((w) => w.id);

  // 6. verdict + counts (waived findings are listed but do not count)
  const counts = Object.fromEntries(enumValues.map((s) => [s, 0]));
  for (const f of findings) if (!f.waived) counts[f.severity]++;
  const verdict = counts.CRITICAL > 0 ? 'BLOCK' : 'PASS';
  findings.sort(
    (a, b) =>
      enumValues.indexOf(a.severity) - enumValues.indexOf(b.severity) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const finished = new Date().toISOString();
  const report = {
    version: REPORT_VERSION,
    generated_at: finished,
    started_at: scope.started_at,
    duration_ms: Date.parse(finished) - Date.parse(scope.started_at),
    branch: scope.branch,
    base: scope.base,
    head: git(['rev-parse', 'HEAD']).trim(),
    fingerprint: scope.fingerprint,
    verdict,
    counts,
    waived: findings.filter((f) => f.waived).length,
    checks: (checks.results ?? []).map(({ tail, ...r }) => r),
    skills_applied: [...new Set(Object.values(scope.groups).flatMap((g) => g.skills))],
    groups: Object.fromEntries(
      Object.entries(scope.groups).map(([k, g]) => [
        k,
        {
          skills: g.skills,
          files: g.files.length,
          reviewed: g.to_review.length,
          cached: g.files.length - g.to_review.length,
        },
      ]),
    ),
    files: scope.files.length,
    changed_lines: scope.changed_lines,
    findings,
    dropped,
    stale_waivers: staleWaivers,
  };
  writeJson(FILES.report, report);

  // cache: every file reviewed (or carried) at this hash
  const cache = { fingerprint: scope.fingerprint, updated_at: finished, files: {} };
  for (const sf of scope.files) if (sf.hash) cache.files[sf.path] = sf.hash;
  writeJson(FILES.cache, cache);

  // history
  appendFileSync(
    FILES.history,
    JSON.stringify({
      at: finished,
      branch: scope.branch,
      verdict,
      counts,
      waived: report.waived,
      files: scope.files.length,
      lines: scope.changed_lines,
      duration_ms: report.duration_ms,
      rules: [...new Set(findings.filter((f) => !f.waived).map((f) => `${f.skill}:${f.rule}`))],
      checks_failed: report.checks.filter((c) => !c.ok).map((c) => `${c.pkg}:${c.cmd}`),
    }) + '\n',
  );

  writeFileSync(FILES.prBody, renderPrBody(report));
  process.stdout.write(renderMarkdown(report));
}

function renderPrBody(r) {
  const lines = [];
  lines.push('## Self review');
  lines.push('');
  lines.push(
    `**Verdict: ${r.verdict}** — ${r.counts.CRITICAL} critical, ${r.counts.WARNING} warning, ${r.counts.SUGGESTION} suggestion${r.waived ? `, ${r.waived} waived` : ''}.`,
  );
  lines.push('');
  if (r.checks.length) {
    lines.push('| Package | Check | Result |');
    lines.push('|---|---|---|');
    for (const c of r.checks) lines.push(`| ${c.pkg} | \`${c.cmd}\` | ${c.ok ? '✅' : '❌'} |`);
    lines.push('');
  }
  if (r.skills_applied.length) {
    lines.push(`Skills applied: ${r.skills_applied.map((s) => `\`${s}\``).join(', ')}.`);
  }
  const open = r.findings.filter((f) => !f.waived && f.severity !== 'SUGGESTION');
  if (open.length) {
    lines.push('');
    lines.push('<details><summary>Findings</summary>');
    lines.push('');
    for (const f of open) {
      lines.push(
        `- **${f.severity}** \`${f.file}${f.line ? ':' + f.line : ''}\` — ${f.summary} (${f.skill}: ${f.rule})`,
      );
    }
    lines.push('');
    lines.push('</details>');
  }
  const waived = r.findings.filter((f) => f.waived);
  if (waived.length) {
    lines.push('');
    lines.push('Waived:');
    for (const f of waived) lines.push(`- \`${f.file}\` — ${f.summary}. _Reason: ${f.waiver_reason}_`);
  }
  lines.push('');
  lines.push(
    `<sub>Generated by \`/pr-self-review\` at ${r.generated_at} · fingerprint \`${r.fingerprint.slice(0, 12)}\`</sub>`,
  );
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(r) {
  const out = [];
  out.push(`# pr-self-review — ${r.verdict}`);
  out.push('');
  out.push(
    `Branch \`${r.branch}\` vs \`${r.base.ref}\` (${r.base.sha.slice(0, 7)}) · ${r.files} files · ~${r.changed_lines} lines · ${Math.round(r.duration_ms / 1000)}s`,
  );
  out.push('');
  if (r.checks.length) {
    out.push('| Package | Check | Result | Time |');
    out.push('|---|---|---|---|');
    for (const c of r.checks) {
      out.push(`| ${c.pkg} | \`${c.cmd}\` | ${c.ok ? 'ok' : '**FAIL**'} | ${Math.round(c.ms / 1000)}s |`);
    }
    out.push('');
  }
  const groups = Object.entries(r.groups);
  if (groups.length) {
    out.push('| Group | Skills | Files | Reviewed | Cached |');
    out.push('|---|---|---|---|---|');
    for (const [g, v] of groups) {
      out.push(`| ${g} | ${v.skills.join(', ')} | ${v.files} | ${v.reviewed} | ${v.cached} |`);
    }
    out.push('');
  }
  for (const sev of Object.keys(r.counts)) {
    const list = r.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    const waivedN = list.length - r.counts[sev];
    out.push(`## ${sev} (${r.counts[sev]}${waivedN ? `, ${waivedN} waived` : ''})`);
    out.push('');
    for (const f of list) {
      const tag = f.waived ? ` _(waived: ${f.waiver_reason})_` : f.carried ? ' _(cached)_' : '';
      out.push(`- \`${f.file}${f.line ? ':' + f.line : ''}\` — **${f.summary}**${tag}`);
      const ev = f.evidence ? ` · \`${String(f.evidence).split('\n')[0].slice(0, 100)}\`` : '';
      out.push(`  ${f.skill} · ${f.rule}${ev}`);
      if (f.fix) out.push(`  Fix: ${f.fix}`);
      out.push(`  id: \`${f.id}\``);
    }
    out.push('');
  }
  if (r.dropped.length) {
    out.push(`## Dropped (${r.dropped.length}) — not grounded in the diff`);
    out.push('');
    for (const d of r.dropped) {
      out.push(`- \`${d.file}:${d.line}\` ${d.summary ?? ''} — ${d.reasons.join('; ')}`);
    }
    out.push('');
  }
  if (r.stale_waivers.length) {
    out.push(`Stale waivers (no matching finding): ${r.stale_waivers.map((s) => `\`${s}\``).join(', ')}`);
    out.push('');
  }
  out.push(
    r.verdict === 'BLOCK'
      ? `**BLOCK — ${r.counts.CRITICAL} critical. Fix them (or waive with a reason in ${rel(FILES.waivers)}) and re-run /pr-self-review.**`
      : `**PASS — \`gh pr create\` and \`git push\` are unlocked for this tree. PR body: ${rel(FILES.prBody)}**`,
  );
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function verifyGate() {
  const report = readJson(FILES.report, null);
  const ctx = buildContext({ offline: true, base: report?.base?.ref });
  const staticCritical = staticRules(ctx).filter((f) => f.severity === 'CRITICAL');
  const waivers = new Set(readJson(FILES.waivers, []).filter((w) => w.reason).map((w) => w.id));
  const unwaived = staticCritical.filter((f) => !waivers.has(f.id));
  if (unwaived.length) {
    return {
      ok: false,
      reason:
        `${unwaived.length} critical rule(s) fire on this tree:\n` +
        unwaived
          .map((f) => `  - ${f.file}${f.line ? ':' + f.line : ''} — ${f.summary} [${f.rule}]`)
          .join('\n'),
    };
  }
  if (!report) return { ok: false, reason: `no report at ${rel(FILES.report)}` };
  if (report.version !== REPORT_VERSION) return { ok: false, reason: 'report version mismatch' };
  if (report.fingerprint !== ctx.fingerprint) {
    return { ok: false, reason: 'report is stale — the tree changed since it was generated' };
  }
  if (report.verdict !== 'PASS') {
    return {
      ok: false,
      reason: `last report is ${report.verdict} (${report.counts?.CRITICAL ?? '?'} critical)`,
    };
  }
  return {
    ok: true,
    reason: `report ${report.generated_at} PASS for fingerprint ${ctx.fingerprint.slice(0, 12)}`,
  };
}

function block(reason, exitCode) {
  process.stderr.write(
    `pr-self-review: ${reason}\nRun /pr-self-review (Claude Code) and fix or waive every CRITICAL finding before opening a PR or pushing.\n`,
  );
  process.exit(exitCode);
}

function modeClaude() {
  let payload = {};
  try {
    const stdin = readFileSync(0, 'utf8');
    payload = stdin.trim() ? JSON.parse(stdin) : {};
  } catch {
    process.exit(0); // unreadable hook input — never block on our own bug
  }
  if (payload.tool_name !== 'Bash') process.exit(0);
  const command = String(payload.tool_input?.command ?? '');
  if (!GATED_COMMAND.test(command)) process.exit(0);
  const v = verifyGate();
  if (!v.ok) block(v.reason, 2);
  process.exit(0);
}

function modeGit() {
  const v = verifyGate();
  if (!v.ok) block(v.reason, 1);
  process.stderr.write(`pr-self-review: ok (${v.reason})\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const mode = args._[0] ?? 'help';
try {
  switch (mode) {
    case 'scope':
      modeScope(args);
      break;
    case 'checks':
      modeChecks();
      break;
    case 'static': {
      const ctx = buildContext({ base: args.base, offline: true });
      process.stdout.write(JSON.stringify(staticRules(ctx), null, 2) + '\n');
      break;
    }
    case 'finalize':
      modeFinalize();
      break;
    case 'fingerprint': {
      const ctx = buildContext({ base: args.base, offline: true });
      process.stdout.write(ctx.fingerprint + '\n');
      break;
    }
    case 'claude':
      modeClaude();
      break;
    case 'git':
      modeGit();
      break;
    default:
      process.stdout.write(
        'usage: node .claude/hooks/pr-self-review-gate.mjs <scope [--base ref] [--no-cache] [--offline] | checks | static | finalize | fingerprint | claude | git>\n',
      );
      process.exit(mode === 'help' ? 0 : 1);
  }
} catch (e) {
  process.stderr.write(`pr-self-review-gate ${mode}: ${e.message}\n`);
  // A gate must fail closed; every other mode just reports the error.
  process.exit(mode === 'claude' ? 2 : 1);
}
