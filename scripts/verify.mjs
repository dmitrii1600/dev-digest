#!/usr/bin/env node
/**
 * verify — the one way an agent runs this repo's checks.
 *
 *   node scripts/verify.mjs <pkg> [<pkg> …] [options]
 *
 *   <pkg>          server | client | reviewer-core | mcp | e2e (one or more)
 *   (default)      lint + typecheck (+ arch in server) + the hermetic vitest lane
 *   --checks       lint / typecheck / arch only, no tests
 *   --tests        the hermetic vitest lane only
 *   --file <p>     vitest on that file only (repeatable; relative to the repo root or
 *                  the package); implies --tests. The narrowest per-step verify.
 *   --it           also run the server integration lane (`*.it.test.ts`, needs Docker)
 *   --no-cache     re-run even when this exact tree already has a result
 *   --tail N       lines of output kept on failure (default 40)
 *
 * Why it exists: lint, typecheck and vitest print hundreds of lines a run, and four
 * agents in the chain (implementer, test-writer, plan-verifier, architecture-reviewer)
 * each re-run them. This script prints ONE line per command — package, command, result,
 * duration — and the tail of the output only on failure. Tests run with the dot
 * reporter. Successful results are cached under `.devdigest/verify/` keyed by a
 * fingerprint of the working tree (HEAD + diff + untracked blobs): a later agent on the
 * identical tree gets the cached line, marked `cached`, instead of a second run. The
 * cache is written by this script, never by an agent, so "re-run, do not trust the
 * report" still holds. A failure is never cached.
 *
 * Exit code 1 when any command fails. No dependencies beyond Node >= 22.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.devdigest', 'verify');
const CACHE_FILE = join(CACHE_DIR, 'cache.json');

const PM = { server: 'pnpm', client: 'pnpm', 'reviewer-core': 'npm', e2e: 'npm', mcp: 'npm' };

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { pkgs: [], checks: true, tests: true, files: [], it: false, cache: true, tail: 40 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--checks') {
      opts.tests = false;
      opts.checks = true;
    } else if (a === '--tests') {
      opts.checks = false;
      opts.tests = true;
    } else if (a === '--file') {
      opts.files.push(argv[++i]);
      opts.checks = false;
      opts.tests = true;
    } else if (a === '--it') opts.it = true;
    else if (a === '--no-cache') opts.cache = false;
    else if (a === '--tail') opts.tail = Number(argv[++i]) || 40;
    else if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else if (a.startsWith('-')) die(`unknown option ${a}`);
    else opts.pkgs.push(a.replace(/[\\/]+$/, ''));
  }
  if (!opts.pkgs.length) {
    usage();
    process.exit(2);
  }
  for (const p of opts.pkgs) {
    if (!PM[p]) die(`unknown package "${p}" — one of ${Object.keys(PM).join(', ')}`);
  }
  if (opts.files.length && opts.pkgs.length !== 1) die('--file takes exactly one package');
  return opts;
}

function usage() {
  process.stderr.write(
    'usage: node scripts/verify.mjs <pkg> [<pkg> …] [--checks | --tests | --file <p> …] [--it] [--no-cache] [--tail N]\n',
  );
}

function die(msg) {
  process.stderr.write(`verify: ${msg}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Tree fingerprint — HEAD + working-tree diff + untracked blobs
// ---------------------------------------------------------------------------

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function fingerprint() {
  const head = git(['rev-parse', 'HEAD'])?.trim() ?? 'no-head';
  const diff = git(['diff', '--no-color', '--no-ext-diff', 'HEAD', '--']) ?? '';
  // Our own cache and vitest's transient config timestamps must not move the tree.
  const untracked = (git(['ls-files', '--others', '--exclude-standard']) ?? '')
    .split('\n')
    .filter((p) => p.trim() && !p.startsWith('.devdigest/') && !/\.timestamp-\d+-[0-9a-f]+\.mjs$/.test(p))
    .map((p) => `${p}:${git(['hash-object', '--', join(ROOT, p)])?.trim() ?? 'gone'}`)
    .sort()
    .join('\n');
  const h = createHash('sha256');
  for (const part of [head, '\n--diff--\n', diff, '\n--untracked--\n', untracked]) h.update(part);
  return h.digest('hex');
}

// ---------------------------------------------------------------------------
// Commands per package
// ---------------------------------------------------------------------------

function vitest(pm, ...args) {
  const base = pm === 'pnpm' ? 'pnpm exec vitest run' : 'npm exec -- vitest run';
  return [base, '--reporter=dot', ...args].join(' ');
}

function commandsFor(pkg, opts) {
  const pm = PM[pkg];
  const cmds = [];
  if (opts.checks) {
    cmds.push(`${pm} run lint`, `${pm} run typecheck`);
    if (pkg === 'server') cmds.push('pnpm run arch');
  }
  if (opts.tests) {
    if (pkg === 'e2e') {
      process.stderr.write('verify: e2e tests need the hermetic stack — run ./scripts/e2e.sh yourself\n');
    } else if (opts.files.length) {
      const files = opts.files.map((f) => {
        const rel = relative(join(ROOT, pkg), resolve(ROOT, f)).split(sep).join('/');
        return rel.startsWith('..') ? f : rel;
      });
      cmds.push(vitest(pm, ...files.map((f) => JSON.stringify(f))));
    } else if (pkg === 'server') {
      cmds.push(vitest(pm, '--exclude "**/*.it.test.ts"'));
      if (opts.it) cmds.push(vitest(pm, '.it.test'));
    } else if (pkg === 'reviewer-core') {
      cmds.push(vitest(pm, '--passWithNoTests'));
    } else {
      cmds.push(vitest(pm));
    }
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// Run + cache
// ---------------------------------------------------------------------------

function readCache(fp) {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return c.fingerprint === fp ? (c.results ?? {}) : {};
  } catch {
    return {};
  }
}

function writeCache(fp, results) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({ fingerprint: fp, updated_at: new Date().toISOString(), results }, null, 2),
  );
}

function run(pkg, cmd, tailN) {
  const t0 = Date.now();
  const r = spawnSync(cmd, {
    cwd: join(ROOT, pkg),
    encoding: 'utf8',
    shell: true,
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  // eslint-disable-next-line no-control-regex
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return {
    ok: r.status === 0,
    exit: r.status,
    ms: Date.now() - t0,
    at: new Date().toISOString(),
    tail: output.split('\n').slice(-tailN).join('\n'),
  };
}

function fmt(pkg, cmd, res, cached) {
  const status = res.ok ? 'ok     ' : `FAIL(${res.exit ?? '?'})`;
  const dur = cached ? `cached ${res.at.slice(11, 19)}Z` : `${(res.ms / 1000).toFixed(1)}s`;
  return `${pkg.padEnd(13)} ${cmd.padEnd(64)} ${status}  ${dur}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fp = fingerprint();
  const results = opts.cache ? readCache(fp) : {};
  const failures = [];
  let hits = 0;
  let total = 0;

  process.stdout.write(`verify · tree ${fp.slice(0, 12)} · ${process.platform}\n`);
  for (const pkg of opts.pkgs) {
    for (const cmd of commandsFor(pkg, opts)) {
      total++;
      const key = `${pkg} :: ${cmd}`;
      const cached = Boolean(results[key]);
      if (cached) hits++;
      const res = cached ? results[key] : run(pkg, cmd, opts.tail);
      process.stdout.write(fmt(pkg, cmd, res, cached) + '\n');
      if (res.ok) results[key] = res;
      else {
        delete results[key];
        failures.push({ pkg, cmd, res });
      }
    }
  }
  writeCache(fp, results);

  for (const f of failures) {
    process.stdout.write(`\n--- ${f.pkg}: ${f.cmd} (last ${opts.tail} lines) ---\n${f.res.tail}\n`);
  }
  process.stdout.write(
    `\n${failures.length ? `${failures.length} FAILED` : 'all green'} · ${total} commands · ${hits} cached\n`,
  );
  process.exit(failures.length ? 1 : 0);
}

main();
