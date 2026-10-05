#!/usr/bin/env node
/**
 * retro-usage — measured numbers for `/workflow-retro --deep`.
 *
 * Reads the Claude Code transcripts of one or more sessions of this project
 * (`~/.claude/projects/<slug>/<session>.jsonl` plus `<session>/subagents/*.jsonl`) and
 * prints what a retrospective needs and what a model cannot count reliably from memory:
 *
 *   - session totals: tokens and cost per model (from the harness's own cost-state line),
 *     API calls, rounds with the person, wall clock
 *   - every agent that ran: order, parent, model, duration, API calls, output / cache-read /
 *     cache-creation tokens, tool mix, lines written, tool errors, skills loaded
 *   - an estimated cost in USD per agent and per session at Anthropic list prices (input,
 *     output, cache read, cache write at 1.25× for the 5-minute TTL and 2× for the 1-hour
 *     TTL), next to the harness's own cost-state figure
 *   - files read by two or more agents, and files one agent read more than once
 *   - the markers in each agent's hand-back report (BLOCKED, Need clarification, NOT MET …)
 *   - with --stem: the verdict lines of the /run-plan reports under .devdigest/sdd/<stem>/
 *
 * No dependencies beyond Node >= 22. Read-only: it never writes anything.
 *
 *   node scripts/retro-usage.mjs                       # the most recent session
 *   node scripts/retro-usage.mjs --list                # recent sessions, newest first
 *   node scripts/retro-usage.mjs --session <id> [--session <id> …]   # id or unique prefix
 *   node scripts/retro-usage.mjs --since 2026-09-29    # every session touched since
 *   node scripts/retro-usage.mjs --last 3              # the three most recent
 *   node scripts/retro-usage.mjs … --stem 2026-09-29-project-context
 *   node scripts/retro-usage.mjs … --json
 *
 * `--project-dir <path>` picks another project's transcripts (a worktree has its own slug);
 * `--transcripts <dir>` points at the folder directly. `CLAUDE_CONFIG_DIR` is honoured.
 * `--prices <file.json>` adds or overrides prices, `{ "<model-id-prefix>": { "input": 4,
 * "output": 20, "cacheRead": 0.2 } }` in USD per million tokens (cache writes are derived).
 *
 * Token figures are summed per API call over the transcript, one entry per `message.id`
 * (a streamed message is written as several lines that repeat its usage). The
 * `totalTokens` a subagent result carries is only its *last* call's context size — it is
 * printed as "final ctx" so it is not mistaken for a total.
 *
 * The cost estimate is what the API would bill at first-party list price (PRICES below).
 * It reproduces the harness's cost-state to the cent where both cover the same calls. A
 * subscription plan pays no per-token bill; the figure is then the equivalent API spend,
 * not an invoice.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
};
const optAll = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

if (has('--help') || has('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}

const projectDir = resolve(opt('--project-dir') ?? process.cwd());
const slug = projectDir.replace(/[^a-zA-Z0-9]/g, '-');
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const transcriptsDir = opt('--transcripts') ?? join(configDir, 'projects', slug);
const asJson = has('--json');

if (!existsSync(transcriptsDir)) {
  console.error(`no transcripts folder for this project: ${transcriptsDir}`);
  console.error('pass --project-dir <path> (a worktree has its own slug) or --transcripts <dir>');
  process.exit(2);
}

// ---------------------------------------------------------------- prices

// USD per million tokens, Anthropic first-party list price (claude-api skill, cached 2026-09-25).
// Cache writes: 1.25× input for the 5-minute TTL, 2× input for the 1-hour TTL — verified
// against the harness's own cost-state figures on 2026-09-29 (opus $5.00/M, fable $20.00/M).
// Longest matching prefix wins; extend or override with --prices <file.json>.
const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};
if (opt('--prices')) Object.assign(PRICES, JSON.parse(readFileSync(opt('--prices'), 'utf8')));

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const unknownModels = new Set();

function priceOf(model) {
  const key = Object.keys(PRICES)
    .filter((k) => String(model).startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) {
    if (model) unknownModels.add(model);
    return null;
  }
  return PRICES[key];
}

/** USD for one usage bucket of one model; null when the model is not priced. */
function costOf(model, u) {
  const p = priceOf(model);
  if (!p) return null;
  return (
    (n(u.input) * p.input +
      n(u.output) * p.output +
      n(u.cacheRead) * p.cacheRead +
      n(u.cache5m) * p.input * 1.25 +
      n(u.cache1h) * p.input * 2) /
    1e6
  );
}

const addCost = (a, b) => (a == null || b == null ? null : a + b);

// ---------------------------------------------------------------- helpers

const parseJsonl = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const fmt = (v) => n(v).toLocaleString('en-US');
const usd = (v) => (v == null ? 'n/a' : `$${v.toFixed(2)}`);
const fmtMs = (ms) => {
  const s = Math.round(n(ms) / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
};
const hhmm = (ts) => (ts ? new Date(ts).toISOString().slice(11, 16) : '—');
const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—');

const contentBlocks = (line) => {
  const c = line?.message?.content;
  return Array.isArray(c) ? c : [];
};

const USAGE_KEYS = ['output', 'cacheRead', 'cacheCreate', 'cache5m', 'cache1h', 'input', 'thinking'];
const emptyUsage = () => ({ calls: 0, output: 0, cacheRead: 0, cacheCreate: 0, cache5m: 0, cache1h: 0, input: 0, thinking: 0, cost: 0 });

/** Sum usage once per API call (max of each field over the lines sharing a message.id), per model, priced. */
function sumUsage(lines) {
  const byId = new Map();
  for (const l of lines) {
    if (l.type !== 'assistant' || !l.message?.usage) continue;
    const id = l.message.id ?? l.uuid;
    const u = l.message.usage;
    const cc = n(u.cache_creation_input_tokens);
    const c1h = n(u.cache_creation?.ephemeral_1h_input_tokens);
    // without a TTL breakdown every write is priced as the cheaper 5-minute one
    const c5m = u.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : cc;
    const p = byId.get(id) ?? { model: l.message.model, ...emptyUsage() };
    byId.set(id, {
      model: p.model ?? l.message.model,
      output: Math.max(p.output, n(u.output_tokens)),
      cacheRead: Math.max(p.cacheRead, n(u.cache_read_input_tokens)),
      cacheCreate: Math.max(p.cacheCreate, cc),
      cache5m: Math.max(p.cache5m, c5m),
      cache1h: Math.max(p.cache1h, c1h),
      input: Math.max(p.input, n(u.input_tokens)),
      thinking: Math.max(p.thinking, n(u.output_tokens_details?.thinking_tokens)),
    });
  }
  const t = { ...emptyUsage(), calls: byId.size, byModel: {} };
  for (const v of byId.values()) {
    const m = (t.byModel[v.model ?? '?'] ??= emptyUsage());
    m.calls += 1;
    for (const k of USAGE_KEYS) {
      t[k] += v[k];
      m[k] += v[k];
    }
    const c = costOf(v.model, v);
    m.cost = addCost(m.cost, c);
    t.cost = addCost(t.cost, c);
  }
  return t;
}

const projectPrefixes = [projectDir, projectDir.replace(/\\/g, '/'), projectDir.replace(/\//g, '\\')].map((p) =>
  p.toLowerCase(),
);
function relPath(p) {
  let s = String(p).replace(/\\\\/g, '\\');
  const lower = s.toLowerCase();
  for (const pre of projectPrefixes) {
    if (lower.startsWith(pre)) {
      s = s.slice(pre.length);
      break;
    }
  }
  return s.replace(/\\/g, '/').replace(/^\/+|^\.\//g, '');
}

const PATH_RE = /(?:[A-Za-z]:)?[\w.\\/-]+\.(?:md|ts|tsx|js|mjs|cjs|json|sql|ya?ml|sh|png|txt)\b/g;
function pathsInCommand(cmd) {
  const out = new Set();
  for (const m of String(cmd).match(PATH_RE) ?? []) {
    if (m.includes('node_modules') || m.includes('*') || m.startsWith('--')) continue;
    const r = relPath(m);
    if (r && !r.startsWith('-')) out.add(r);
  }
  return out;
}

const HANDBACK_MARKERS = [
  ['BLOCKED', /\bBLOCKED\b/g],
  ['Need clarification', /Need clarification/gi],
  ['Research needed', /Research needed/gi],
  ['Requirements review', /Requirements review/g],
  ['Deviations', /Deviations? from (the )?plan/gi],
  ['Could not establish', /Could not establish/gi],
  ['NOT MET', /\|\s*NOT MET\s*\|/g],
  ['PARTIAL', /\|\s*PARTIAL\s*\|/g],
  ['NOT VERIFIABLE', /\|\s*NOT VERIFIABLE\s*\|/g],
  ['CRITICAL', /—\s*CRITICAL\b/g],
  ['WARNING', /—\s*WARNING\b/g],
  ['Open questions', /Open questions?/gi],
  ['Follow-ups', /Follow-ups?/gi],
];

/** Tool calls, reads, writes, skills and errors of one transcript (main session or subagent). */
function toolProfile(lines) {
  const tools = {};
  const skills = [];
  const reads = [];
  const writes = new Set();
  const spawns = [];
  let errors = 0;
  for (const l of lines) {
    if (l.type === 'assistant') {
      for (const b of contentBlocks(l)) {
        if (b.type !== 'tool_use') continue;
        tools[b.name] = (tools[b.name] ?? 0) + 1;
        const input = b.input ?? {};
        if (b.name === 'Skill' && input.skill) skills.push(input.skill);
        if (b.name === 'Read' && input.file_path) reads.push(relPath(input.file_path));
        if ((b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') && input.file_path) {
          writes.add(relPath(input.file_path));
        }
        if (b.name === 'Bash' && input.command) reads.push(...pathsInCommand(input.command));
        if (b.name === 'Agent') {
          spawns.push({
            toolUseId: b.id,
            ts: l.timestamp,
            agentType: input.subagent_type ?? 'general-purpose',
            description: input.description ?? '',
            background: Boolean(input.run_in_background),
            promptChars: String(input.prompt ?? '').length,
          });
        }
      }
    } else if (l.type === 'user') {
      for (const b of contentBlocks(l)) if (b.type === 'tool_result' && b.is_error) errors += 1;
    }
  }
  return { tools, skills, reads, writes: [...writes], spawns, errors };
}

const isPersonPrompt = (l) => {
  if (l.type !== 'user' || l.isMeta || l.isSidechain) return false;
  const c = l.message?.content;
  if (typeof c === 'string') return c.trim().length > 0;
  return Array.isArray(c) && c.some((b) => b.type === 'text') && !c.some((b) => b.type === 'tool_result');
};

function sessionTitle(lines) {
  const t = [...lines].reverse().find((l) => l.type === 'custom-title')?.customTitle;
  if (t) return t;
  const first = lines.find(isPersonPrompt);
  const c = first?.message?.content;
  const text = typeof c === 'string' ? c : (c ?? []).find((b) => b.type === 'text')?.text ?? '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 80) || '(untitled)';
}

// ---------------------------------------------------------------- sessions

function listSessions() {
  return readdirSync(transcriptsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const file = join(transcriptsDir, f);
      return { id: basename(f, '.jsonl'), file, mtime: statSync(file).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

const all = listSessions();
if (all.length === 0) {
  console.error(`no session transcripts under ${transcriptsDir}`);
  process.exit(2);
}

if (has('--list')) {
  const rows = all.slice(0, Number(opt('--last') ?? 15)).map((s) => {
    const lines = parseJsonl(s.file);
    const agents = lines.filter((l) => l.toolUseResult?.agentId).length;
    const cost = [...lines].reverse().find((l) => l.type === 'cost-state')?.totalCostUSD;
    return `| ${s.id.slice(0, 8)} | ${s.mtime.toISOString().slice(0, 16).replace('T', ' ')} | ${agents} | ${
      cost !== undefined ? usd(cost) : '—'
    } | ${sessionTitle(lines)} |`;
  });
  console.log(`Transcripts: ${transcriptsDir}\n`);
  console.log('| session | last write (UTC) | agents | cost (harness) | title |\n|---|---|---|---|---|');
  console.log(rows.join('\n'));
  process.exit(0);
}

let selected;
const ids = optAll('--session');
if (ids.length) {
  selected = ids.map((id) => {
    const hits = all.filter((s) => s.id.startsWith(id));
    if (hits.length !== 1) {
      console.error(`--session ${id}: ${hits.length === 0 ? 'no such session' : 'ambiguous prefix'} (try --list)`);
      process.exit(2);
    }
    return hits[0];
  });
} else if (opt('--since')) {
  const since = new Date(opt('--since'));
  selected = all.filter((s) => s.mtime >= since);
} else if (opt('--last')) {
  selected = all.slice(0, Number(opt('--last')));
} else {
  selected = [all[0]];
}
selected.sort((a, b) => a.mtime - b.mtime);

// ---------------------------------------------------------------- analysis

/**
 * The hand-back text a subagent sent through its own `SubagentHandback` call (last one
 * wins). A background agent's `Agent` result is only `async_launched` and carries no
 * `handbackReport`, so this is the only place its report lives.
 */
function lastHandbackFromTranscript(lines) {
  let text = '';
  for (const l of lines) {
    if (l.type !== 'assistant') continue;
    for (const b of contentBlocks(l)) {
      if (b.type === 'tool_use' && b.name === 'SubagentHandback' && typeof b.input?.message === 'string') {
        text = b.input.message;
      }
    }
  }
  return text;
}

/** Context size of a transcript's last API call — what the harness reports as totalTokens. */
function lastCallContext(lines) {
  const last = [...lines].reverse().find((l) => l.type === 'assistant' && l.message?.usage);
  if (!last) return null;
  const u = last.message.usage;
  return (
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.output_tokens ?? 0)
  );
}

/**
 * Marker counts for a hand-back. A plan-verifier report states its own row counts in the
 * `**Items:**` header; those win over counting `| NOT MET |` cells, which also match a
 * delta table's "Was" column and overcount (a 0-NOT-MET delta once showed NOT MET ×3).
 */
function countMarkers(handback) {
  const markers = {};
  for (const [name, re] of HANDBACK_MARKERS) {
    const c = (handback.match(re) ?? []).length;
    if (c) markers[name] = c;
  }
  const items = handback.match(/^\*\*Items:\*\*([^\n]*)/m)?.[1];
  if (items) {
    for (const [name, re] of [
      ['NOT MET', /(\d+)\s+not met/i],
      ['PARTIAL', /(\d+)\s+partial/i],
      ['NOT VERIFIABLE', /(\d+)\s+not verifiable/i],
    ]) {
      const n = Number(items.match(re)?.[1] ?? NaN);
      if (Number.isNaN(n)) continue;
      if (n > 0) markers[name] = n;
      else delete markers[name];
    }
  }
  return markers;
}

function findNestedResult(subs, toolUseId) {
  for (const sub of subs) {
    for (const l of sub.lines) {
      if (!l.toolUseResult?.agentId) continue;
      const id = contentBlocks(l).find((b) => b.type === 'tool_result')?.tool_use_id;
      if (id === toolUseId) return { ...l.toolUseResult, ts: l.timestamp };
    }
  }
  return undefined;
}

function analyzeSession(s) {
  const lines = parseJsonl(s.file);
  const talk = lines.filter((l) => l.type === 'user' || l.type === 'assistant');
  const stamps = talk.map((l) => l.timestamp).filter(Boolean).sort();
  const costState = [...lines].reverse().find((l) => l.type === 'cost-state');
  const main = toolProfile(lines);

  // results of Agent calls, keyed by the tool_use id they answer
  const results = new Map();
  for (const l of lines) {
    if (!l.toolUseResult?.agentId) continue;
    const id = contentBlocks(l).find((b) => b.type === 'tool_result')?.tool_use_id;
    if (id) results.set(id, { ...l.toolUseResult, ts: l.timestamp });
  }

  // subagent transcripts
  const subDir = join(transcriptsDir, s.id, 'subagents');
  const subs = [];
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))) {
      const file = join(subDir, f);
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      } catch {
        /* an older transcript without meta */
      }
      const sl = parseJsonl(file);
      const st = sl.map((l) => l.timestamp).filter(Boolean).sort();
      subs.push({
        agentId: basename(f, '.jsonl').replace(/^agent-/, ''),
        toolUseId: meta.toolUseId,
        agentType: meta.agentType ?? '?',
        description: meta.description ?? '',
        depth: meta.spawnDepth ?? 1,
        start: st[0],
        end: st.at(-1),
        model: sl.find((l) => l.type === 'assistant')?.message?.model,
        usage: sumUsage(sl),
        profile: toolProfile(sl),
        lines: sl,
      });
    }
  }

  // parent of each subagent: whichever transcript holds the Agent tool_use that spawned it
  const spawnOwner = new Map();
  for (const sp of main.spawns) spawnOwner.set(sp.toolUseId, { owner: 'main', spawn: sp });
  for (const sub of subs) for (const sp of sub.profile.spawns) spawnOwner.set(sp.toolUseId, { owner: sub.agentType, spawn: sp });

  const agents = subs
    .map((sub) => {
      const owner = spawnOwner.get(sub.toolUseId);
      const r = results.get(sub.toolUseId) ?? findNestedResult(subs, sub.toolUseId);
      const handback = r?.handbackReport?.text || lastHandbackFromTranscript(sub.lines);
      const markers = countMarkers(handback);
      const launchedOnly = r?.status === 'async_launched';
      return {
        agentId: sub.agentId,
        agentType: sub.agentType,
        description: sub.description || owner?.spawn.description || '',
        parent: owner?.owner ?? (sub.depth > 1 ? '(nested)' : 'main'),
        depth: sub.depth,
        background: owner?.spawn.background ?? false,
        promptChars: owner?.spawn.promptChars ?? null,
        model: sub.model ?? r?.resolvedModel ?? '?',
        start: owner?.spawn.ts ?? sub.start,
        end: r?.ts ?? sub.end,
        durationMs: r?.totalDurationMs ?? (sub.start && sub.end ? new Date(sub.end) - new Date(sub.start) : null),
        status: launchedOnly && handback ? 'completed (bg)' : r?.status ?? '(no result in this session)',
        finalCtx: r?.totalTokens ?? lastCallContext(sub.lines),
        usage: sub.usage,
        tools: sub.profile.tools,
        toolStats: r?.toolStats ?? null,
        skills: sub.profile.skills,
        reads: sub.profile.reads,
        writes: sub.profile.writes,
        errors: sub.profile.errors,
        handbackTitle: handback.split('\n').find((l) => l.trim())?.trim().slice(0, 100) ?? '',
        handbackChars: handback.length,
        markers,
      };
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  const mainUsage = sumUsage(lines);
  const agentsCost = agents.reduce((acc, a) => addCost(acc, a.usage.cost), 0);

  return {
    id: s.id,
    file: s.file,
    title: sessionTitle(lines),
    branch: [...lines].reverse().find((l) => l.gitBranch)?.gitBranch ?? null,
    start: stamps[0],
    end: stamps.at(-1),
    wallMs: stamps.length ? new Date(stamps.at(-1)) - new Date(stamps[0]) : 0,
    personPrompts: lines.filter(isPersonPrompt).length,
    costState: costState
      ? {
          totalCostUSD: costState.totalCostUSD,
          apiMs: costState.totalAPIDuration,
          toolMs: costState.totalToolDuration,
          linesAdded: costState.totalLinesAdded,
          linesRemoved: costState.totalLinesRemoved,
          models: costState.modelUsage ?? {},
        }
      : null,
    estCost: addCost(mainUsage.cost, agentsCost),
    agentsCost,
    main: { usage: mainUsage, tools: main.tools, skills: main.skills, reads: main.reads, errors: main.errors },
    agents,
  };
}

function runPlanReports(stem) {
  const dir = join(projectDir, '.devdigest', 'sdd', stem);
  if (!existsSync(dir)) return { dir, reports: [] };
  const reports = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      const verdict = text.split('\n').find((l) => /^\*\*(Verdict|Status|Result)/.test(l)) ?? '';
      return { file: f, verdict: verdict.replace(/\*\*/g, '').trim().slice(0, 120), chars: text.length };
    });
  return { dir, reports };
}

const sessions = selected.map(analyzeSession);
const stem = opt('--stem');
const sdd = stem ? runPlanReports(stem) : null;

// cross-session read duplication
const readers = new Map(); // path -> Map(label -> count)
function countReads(label, paths) {
  for (const p of paths) {
    if (!p) continue;
    const m = readers.get(p) ?? new Map();
    m.set(label, (m.get(label) ?? 0) + 1);
    readers.set(p, m);
  }
}
for (const s of sessions) {
  countReads(`main:${s.id.slice(0, 8)}`, s.main.reads);
  for (const a of s.agents) countReads(`${a.agentType}:${a.agentId.slice(0, 6)}`, a.reads);
}
const sharedReads = [...readers.entries()]
  .filter(([, m]) => m.size >= 2)
  .map(([p, m]) => ({ path: p, readers: [...m.keys()], count: [...m.values()].reduce((x, y) => x + y, 0) }))
  .sort((a, b) => b.readers.length - a.readers.length || b.count - a.count);
const repeatedReads = [...readers.entries()]
  .flatMap(([p, m]) => [...m.entries()].filter(([, c]) => c >= 2).map(([label, c]) => ({ path: p, reader: label, count: c })))
  .sort((a, b) => b.count - a.count);

if (asJson) {
  const out = sessions.map(({ agents, ...s }) => ({ ...s, agents: agents.map(({ reads, ...a }) => a) }));
  console.log(JSON.stringify({ transcriptsDir, prices: PRICES, sessions: out, sharedReads, repeatedReads, sdd }, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- markdown

const out = [];
const H = (s) => out.push('', s, '');
const short = (s) => s.id.slice(0, 8);

out.push(`Transcripts: ${transcriptsDir}`);
H('## Sessions');
out.push(
  '| session | day | title | branch | wall clock | rounds with the person | agents | main API calls | main output | main cache read | cost (harness) | cost (est. list price) |',
);
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of sessions) {
  out.push(
    `| ${short(s)} | ${day(s.start)} | ${s.title.replace(/\|/g, '/')} | ${s.branch ?? '—'} | ${fmtMs(s.wallMs)} | ${
      s.personPrompts
    } | ${s.agents.length} | ${s.main.usage.calls} | ${fmt(s.main.usage.output)} | ${fmt(s.main.usage.cacheRead)} | ${
      s.costState ? usd(s.costState.totalCostUSD) : '—'
    } | ${usd(s.estCost)} |`,
  );
}

H('## Tokens and cost per model');
out.push(
  'Two rows per model: `harness` is the cost-state line the app writes (whole session, at its own cadence); `transcript` is summed from the API calls in the transcripts (main + agents) and priced at list price, cache writes by TTL.',
);
out.push('');
out.push('| session | model | source | API calls | input | output | thinking | cache read | cache write 5m | cache write 1h | cost |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of sessions) {
  for (const [model, u] of Object.entries(s.costState?.models ?? {})) {
    out.push(
      `| ${short(s)} | ${model} | harness | — | ${fmt(u.inputTokens)} | ${fmt(u.outputTokens)} | ${fmt(u.thinkingTokens)} | ${fmt(
        u.cacheReadInputTokens,
      )} | ${fmt(u.cacheCreationInputTokens)} (all TTLs) | | ${usd(n(u.costUSD))} |`,
    );
  }
  if (!s.costState) out.push(`| ${short(s)} | — | harness | no cost-state line in this transcript | | | | | | | |`);
  const merged = {};
  for (const u of [s.main.usage, ...s.agents.map((a) => a.usage)]) {
    for (const [model, m] of Object.entries(u.byModel)) {
      const x = (merged[model] ??= emptyUsage());
      x.calls += m.calls;
      for (const k of USAGE_KEYS) x[k] += m[k];
      x.cost = addCost(x.cost, m.cost);
    }
  }
  for (const [model, m] of Object.entries(merged)) {
    out.push(
      `| ${short(s)} | ${model} | transcript | ${m.calls} | ${fmt(m.input)} | ${fmt(m.output)} | ${fmt(m.thinking)} | ${fmt(m.cacheRead)} | ${fmt(
        m.cache5m,
      )} | ${fmt(m.cache1h)} | ${usd(m.cost)} |`,
    );
  }
}
if (unknownModels.size) out.push('', `n/a: no list price for ${[...unknownModels].join(', ')} — pass --prices <file.json>`);
for (const s of sessions) {
  // The cost-state line is written by the harness at its own cadence and has been seen to
  // omit part of the subagents' usage. When the transcripts' summed output exceeds it, say so.
  const transcriptOutput = s.agents.reduce((acc, a) => acc + a.usage.output, 0) + s.main.usage.output;
  const stateOutput = Object.values(s.costState?.models ?? {}).reduce((acc, u) => acc + n(u.outputTokens), 0);
  if (s.costState && transcriptOutput > stateOutput * 1.05) {
    out.push('');
    out.push(
      `⚠ ${short(s)}: transcripts sum to ${fmt(transcriptOutput)} output tokens (main + agents) but cost-state reports ${fmt(
        stateOutput,
      )} — the harness cost is a lower bound; use the transcript estimate (${usd(s.estCost)}) and the per-agent rows.`,
    );
  }
}

H('## Agents, in spawn order');
out.push(
  '| # | session | agent | description | parent | model | started | duration | gap before | API calls | output | cache read | cache create | final ctx | est. cost | tools | +/- lines | errors | status |',
);
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
let i = 0;
for (const s of sessions) {
  let prevEnd = null;
  for (const a of s.agents) {
    i += 1;
    const gap = prevEnd && a.start && a.depth === 1 ? fmtMs(new Date(a.start) - new Date(prevEnd)) : '—';
    if (a.depth === 1 && a.end) prevEnd = a.end;
    const toolMix = Object.entries(a.tools)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const lines = a.toolStats ? `+${a.toolStats.linesAdded}/-${a.toolStats.linesRemoved}` : '—';
    out.push(
      `| ${i} | ${short(s)} | ${a.agentType} | ${a.description.replace(/\|/g, '/')} | ${a.parent}${a.background ? ' (bg)' : ''} | ${
        a.model
      } | ${hhmm(a.start)} | ${a.durationMs != null ? fmtMs(a.durationMs) : '—'} | ${gap} | ${a.usage.calls} | ${fmt(a.usage.output)} | ${fmt(
        a.usage.cacheRead,
      )} | ${fmt(a.usage.cacheCreate)} | ${a.finalCtx != null ? fmt(a.finalCtx) : '—'} | ${usd(a.usage.cost)} | ${toolMix} | ${lines} | ${
        a.errors
      } | ${a.status} |`,
    );
  }
}
out.push('');
out.push(
  "`output` / `cache read` / `cache create` are sums over the agent's API calls; `final ctx` is the context size of its last call (what the harness reports as totalTokens); `est. cost` prices those sums at list price, cache writes by TTL. `gap before` is the wall clock between the previous top-level agent's end and this one's start — the orchestrator's or the person's time.",
);
for (const s of sessions) {
  out.push('', `${short(s)}: main session ${usd(s.main.usage.cost)} + agents ${usd(s.agentsCost)} = ${usd(s.estCost)} (est. list price)`);
}

H('## Hand-back reports');
out.push('| # | agent | prompt chars | report chars | first line | markers | skills loaded | files written |');
out.push('|---|---|---|---|---|---|---|---|');
i = 0;
for (const s of sessions) {
  for (const a of s.agents) {
    i += 1;
    const markers = Object.entries(a.markers)
      .map(([k, v]) => `${k} ×${v}`)
      .join(', ');
    out.push(
      `| ${i} | ${a.agentType} | ${a.promptChars ?? '—'} | ${fmt(a.handbackChars)} | ${a.handbackTitle.replace(/\|/g, '/')} | ${
        markers || '—'
      } | ${a.skills.length ? [...new Set(a.skills)].join(', ') : '—'} | ${a.writes.length ? a.writes.join(', ') : '—'} |`,
    );
  }
}

H('## Files read by two or more readers');
if (sharedReads.length === 0) out.push('none');
else {
  out.push('| file | readers | reads |');
  out.push('|---|---|---|');
  for (const r of sharedReads.slice(0, 40)) out.push(`| ${r.path} | ${r.readers.join(', ')} | ${r.count} |`);
  if (sharedReads.length > 40) out.push(`| … ${sharedReads.length - 40} more | | |`);
}
out.push('');
out.push(
  'A file every agent reads is either a real shared input (fine, but a candidate for a preloaded skill or a one-line pointer) or a sign that the hand-off carried a retelling instead of a path.',
);

H('## Files one reader opened more than once');
if (repeatedReads.length === 0) out.push('none');
else {
  out.push('| file | reader | times |');
  out.push('|---|---|---|');
  for (const r of repeatedReads.slice(0, 25)) out.push(`| ${r.path} | ${r.reader} | ${r.count} |`);
}

if (sdd) {
  H(`## /run-plan reports — ${sdd.dir}`);
  if (sdd.reports.length === 0) out.push('no reports on disk (the folder is git-ignored; a fresh clone or worktree has none)');
  else {
    out.push('| report | verdict line | chars |');
    out.push('|---|---|---|');
    for (const r of sdd.reports) out.push(`| ${r.file} | ${r.verdict || '—'} | ${fmt(r.chars)} |`);
  }
}

H('## Not measured here');
out.push('- what each agent found hard or easy, and what it missed — read its hand-back report and, in --deep, its transcript');
out.push('- whether a duplicated read was wasted — a shared input read once per agent is the design, not a defect');
out.push(
  '- a real invoice — `est. cost` is first-party list price applied to the transcript; a subscription plan pays no per-token bill, and a Bedrock/Vertex route prices differently',
);
out.push('- Bash-side reads are found by matching file-like tokens in the command text; a heredoc or a glob can hide one');

console.log(out.join('\n'));
