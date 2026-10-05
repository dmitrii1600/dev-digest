  { id: "l3", rule: "console.log in src/jobs/* is acceptable — those run in workers without a logger", scope: "repo", source_pr: 455, confidence: 0.71, confirmed_count: 2, created_at: "2026-04-08", updated_at: "2026-04-30" },
  { id: "l4", rule: "Prefer Vitest over Jest assertions; this org standardized on it", scope: "global", source_pr: 277, confidence: 0.95, confirmed_count: 12, created_at: "2025-11-14", updated_at: "2026-05-02" },
];

// ---- eval ----
const EVAL = {
  current: { recall: 0.82, precision: 0.91, citation: 0.95, traces_passed: 17, traces_total: 20, cost: 0.23, duration_ms: 12000 },
  delta: { recall: +0.04, precision: -0.02, citation: +0.01 },
  trend: {
    recall:   [0.71, 0.74, 0.73, 0.78, 0.76, 0.80, 0.78, 0.82],
    precision:[0.86, 0.88, 0.90, 0.89, 0.92, 0.93, 0.93, 0.91],
    citation: [0.90, 0.91, 0.92, 0.92, 0.93, 0.94, 0.94, 0.95],
  },
  runs: [
    { id: "r1", agent: "ag1", ran_at: "2026-05-29 09:14", version: "v7", recall: 0.82, precision: 0.91, citation: 0.95, passed: 17, total: 20, cost: 0.23,
      prompt: "You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, untrusted input reaching a sink, and the lethal trifecta.\nReturn at most 5 findings ranked by severity.\nFlag unused imports as suggestions.\nEvery finding MUST cite file and start_line\u2013end_line inside the diff hunks." },
    { id: "r2", agent: "ag1", ran_at: "2026-05-27 16:40", version: "v6", recall: 0.78, precision: 0.93, citation: 0.94, passed: 16, total: 20, cost: 0.21,
      prompt: "You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, untrusted input reaching a sink, and the lethal trifecta.\nReturn at most 5 findings ranked by severity.\nEvery finding MUST cite file and start_line\u2013end_line inside the diff hunks." },
    { id: "r3", agent: "ag1", ran_at: "2026-05-25 11:02", version: "v5", recall: 0.80, precision: 0.92, citation: 0.94, passed: 16, total: 20, cost: 0.24,
      prompt: "You are a security PR reviewer. Look for hardcoded secrets and untrusted input reaching a sink.\nReturn findings ranked by severity.\nCite file and line for each finding." },
    { id: "r4", agent: "ag1", ran_at: "2026-05-22 14:33", version: "v4", recall: 0.76, precision: 0.92, citation: 0.93, passed: 15, total: 20, cost: 0.22,
      prompt: "You are a security PR reviewer. Look for hardcoded secrets and untrusted input reaching a sink.\nReturn findings ranked by severity." },
    { id: "r5", agent: "ag1", ran_at: "2026-05-19 10:08", version: "v3", recall: 0.78, precision: 0.89, citation: 0.92, passed: 15, total: 20, cost: 0.20,
      prompt: "You are a PR reviewer. Look for security problems in the diff and report them." },
    { id: "r6", agent: "ag2", ran_at: "2026-05-28 13:20", version: "v4", recall: 0.74, precision: 0.88, citation: 0.90, passed: 13, total: 18, cost: 0.19,
      prompt: "You are a performance reviewer. Flag N+1 queries, missing indexes, and hot-path allocations.\nReturn findings ranked by impact.\nCite file and start_line\u2013end_line inside the diff hunks." },
    { id: "r7", agent: "ag2", ran_at: "2026-05-24 10:11", version: "v3", recall: 0.71, precision: 0.90, citation: 0.89, passed: 12, total: 18, cost: 0.18,
      prompt: "You are a performance reviewer. Flag N+1 queries and missing indexes.\nReturn findings ranked by impact.\nCite file and line." },
    { id: "r8", agent: "ag2", ran_at: "2026-05-20 09:02", version: "v2", recall: 0.69, precision: 0.87, citation: 0.88, passed: 11, total: 18, cost: 0.17,
      prompt: "You are a performance reviewer. Flag slow database queries.\nReturn findings ranked by impact." },
    { id: "r9", agent: "ag3", ran_at: "2026-05-26 15:47", version: "v2", recall: 0.63, precision: 0.79, citation: 0.85, passed: 8, total: 14, cost: 0.14,
      prompt: "You are a mentoring reviewer. Explain issues kindly and suggest idiomatic fixes.\nReturn findings with a teaching note.\nCite file and start_line\u2013end_line." },
    { id: "r10", agent: "ag3", ran_at: "2026-05-21 12:30", version: "v1", recall: 0.58, precision: 0.76, citation: 0.83, passed: 7, total: 14, cost: 0.13,
      prompt: "You are a mentoring reviewer. Explain issues kindly.\nReturn findings with a teaching note." },
  ],
  traces: [
    { id: "t01", name: "stripe-key-leak", pass: true, expected: "CRITICAL security", actual: "CRITICAL security" },
    { id: "t02", name: "n+1-users", pass: true, expected: "WARNING perf", actual: "WARNING perf" },
    { id: "t03", name: "ssrf-webhook", pass: true, expected: "CRITICAL security", actual: "CRITICAL security" },
    { id: "t04", name: "missing-retry-after", pass: false, expected: "WARNING bug", actual: "— (missed)" },
    { id: "t05", name: "magic-number", pass: true, expected: "SUGGESTION style", actual: "SUGGESTION style" },
    { id: "t06", name: "unused-import", pass: false, expected: "— (none)", actual: "SUGGESTION style (false +)" },
  ],
};

// ---- memory ----
const MEMORY = [
  { id: "m1", content: "Team decided **not** to adopt tRPC; public surface stays REST + OpenAPI. Revisit in Q3.", scope: "team", kind: "decision", confidence: 0.92, last_used: "2026-05-20", updated: "2026-04-15", sources: [{ pr: 401, context: "tRPC migration RFC closed wontfix" }, { pr: 423, context: "OpenAPI spec re-affirmed" }] },
  { id: "m2", content: "`bucketKey()` must include the API version prefix or v1/v2 clients collide in the same bucket.", scope: "repo", kind: "fact", confidence: 0.84, last_used: "2026-05-29", updated: "2026-05-29", sources: [{ pr: 482, context: "raised during current review" }] },
  { id: "m3", content: "Reviewer prefers findings grouped by file, not by severity, when a PR touches >6 files.", scope: "global", kind: "preference", confidence: 0.67, last_used: "2026-05-12", updated: "2026-03-30", sources: [{ pr: 471, context: "explicit reviewer feedback" }] },
  { id: "m4", content: "DB migrations always ship in their own PR — never bundled with feature code.", scope: "repo", kind: "convention", confidence: 0.95, last_used: "2026-05-26", updated: "2026-02-11", sources: [{ pr: 479, context: "split requested" }, { pr: 356, context: "migration isolated" }, { pr: 288, context: "convention origin" }] },
  { id: "m5", content: "Stripe webhooks are verified with the `stripe-signature` header — do not flag the raw-body parser as a bug.", scope: "repo", kind: "fact", confidence: 0.88, last_used: "2026-05-18", updated: "2026-01-09", sources: [{ pr: 288, context: "raw body intentional" }] },
  { id: "m6", content: "Don't flag `try/catch` around `JSON.parse` — it's intentional defensive parsing in this repo.", scope: "repo", kind: "learning", confidence: 0.93, last_used: "2026-05-30", updated: "2026-05-30", sources: [{ pr: 482, context: "learned from a dismissed finding" }] },
];

// ---- personas ----
const PERSONAS = [
  { name: "Security", icon: "Shield", color: "#ef4444", score: 38, duration_ms: 8200, cost: 0.06,
    summary: "Two critical exposures: a committed live key and an SSRF-shaped webhook forwarder. Block.",
    findings: [FINDINGS[0], FINDINGS[1], FINDINGS[3]] },
  { name: "Performance", icon: "Zap", color: "#f59e0b", score: 64, duration_ms: 7400, cost: 0.05,
    summary: "N+1 in the user list will bite under the new limiter. Redis round-trip is acceptable.",
    findings: [FINDINGS[2], { id: "p_perf1", severity: "SUGGESTION", category: "perf", title: "Pipeline INCR+EXPIRE into one round-trip", file: "src/middleware/ratelimit.ts", start_line: 27, end_line: 28, confidence: 0.6, rationale: "Two sequential Redis calls per request can be a single `MULTI`/pipeline.", suggestion: "Use `redis.multi().incr(key).expire(key, WINDOW).exec()`." }] },
  { name: "Junior Mentor", icon: "Lightbulb", color: "#3b82f6", score: 72, duration_ms: 6900, cost: 0.04,
    summary: "Readable change. A couple of naming + magic-number nits worth fixing before merge.",
    findings: [FINDINGS[4], FINDINGS[5]] },
  { name: "Customer-Facing", icon: "Users", color: "#8b5cf6", score: 58, duration_ms: 7100, cost: 0.05,
    summary: "Missing Retry-After breaks well-behaved client back-off — a real DX regression.",
    findings: [FINDINGS[3], { id: "p_cf1", severity: "WARNING", category: "bug", title: "429 body has no machine-readable error code", file: "src/middleware/ratelimit.ts", start_line: 52, end_line: 52, confidence: 0.66, rationale: "Clients can't distinguish rate-limit from other 4xx without a body `code`.", suggestion: "Return `{ code: 'rate_limited', retry_after: n }`." }] },
  { name: "Architecture", icon: "Boxes", color: "#10b981", score: 69, duration_ms: 9100, cost: 0.07,
    summary: "Second Redis connection duplicates the session-cache client. Consolidate on the singleton.",
    findings: [{ id: "p_arch1", severity: "WARNING", category: "style", title: "Duplicate Redis connection", file: "src/middleware/ratelimit.ts", start_line: 4, end_line: 4, confidence: 0.83, rationale: "A new `new Redis()` is constructed here, but `src/lib/redis.ts` already exports a shared client (see PR #356).", suggestion: "Import the shared `redis` singleton from `src/lib/redis.ts`." }, FINDINGS[2]] },
];

const PERSONA_CONFLICTS = [
  { file: "src/middleware/ratelimit.ts", line: 28, title: "Magic number 3600",
    takes: [
      { persona: "Junior Mentor", verdict: "SUGGESTION", note: "Extract for readability." },
      { persona: "Security", verdict: "ignored", note: "Not a security concern." },
      { persona: "Architecture", verdict: "ignored", note: "Cosmetic; out of scope for arch review." },
    ] },
  { file: "src/middleware/ratelimit.ts", line: 52, title: "429 response shape",
    takes: [
      { persona: "Customer-Facing", verdict: "WARNING", note: "Needs machine-readable code + Retry-After." },
      { persona: "Performance", verdict: "ignored", note: "No perf impact." },
      { persona: "Security", verdict: "ignored", note: "No security impact." },
    ] },
];

Object.assign(window, {
  REPO, PR, VERDICT, INTENT, RISKS, REVIEW_FOCUS, BLAST, FINDINGS, DIFF, HISTORY, CODE_SNIPPETS,
