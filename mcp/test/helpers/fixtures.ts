import type {
  Agent,
  BlastRadius,
  ConventionsPage,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

/**
 * Typed fixtures for the fake DevDigest API. Every field is typed with the
 * shared contracts, so a fixture that drifts from the real shape fails
 * `npm run typecheck`, not a test at runtime. IDs are real (fixed) uuids —
 * `resolve.ts` branches on "looks like a uuid" and the tests exercise that
 * branch deliberately.
 *
 * `createFixtureState()` returns a **fresh** object graph on every call, so
 * one test's mutations (via the fake API's `state`) never leak into another.
 */

export const WORKSPACE_ID = 'd16d9ed1-0c5c-4449-bf1d-0a11c9a97ccf';

export const REPO_PAYMENTS_ID = 'b085eb10-9d6e-4856-bfef-041131403642';
export const REPO_WEB_ID = '6e7414bf-70b2-45bd-a584-a7fa5854434f';

export const PR_482_ID = '59b8506d-45dd-4fd0-9bec-ecde604a1fc6';
export const PR_480_ID = '3603f1a0-7195-4767-9462-609305f6aaeb';

export const AGENT_GENERAL_ID = '92869063-b3d3-48fd-bad4-91ad77f45190';
export const AGENT_SECURITY_ID = '851bbe1a-f43c-42d0-8d3c-273e673b49c3';
export const AGENT_PERFORMANCE_ID = 'beb917e7-768f-4c25-9863-fd870fc323d9';
/** The one seeded agent that is disabled — used to prove list_agents / resolve filter it out. */
export const AGENT_TESTQUALITY_ID = '4fd0ca24-0f93-4106-9d0b-9d52c46a02f3';
export const AGENT_APICONTRACT_ID = '761d97dd-3ba6-48d2-af84-4578393c3e07';

export const RUN_GENERAL_ID = '88b44e0b-eeb5-41e5-b23b-585c0fe7ce29';
export const RUN_SECURITY_ID = '2dba5ecd-851d-4a0f-bb22-d95aceb277df';
export const REVIEW_GENERAL_ID = 'd4fd988e-4c5c-4b96-b2fa-1ecb31b495a7';
export const REVIEW_SECURITY_ID = 'faf7f75d-1d19-4183-9270-d101b8d4855a';

export const SCAN_ID = 'be054af5-30df-4974-bfae-0d9bddf3a934';
export const CANDIDATE_ACCEPTED_ID = '7569a66e-4bb1-4b3c-b897-43772901fcfe';
export const CANDIDATE_PENDING_ID = '2d7b03f3-bb9d-43c9-ba7f-296d79ad8f7d';
export const CANDIDATE_LOW_CONF_ID = 'ea0ad384-967b-48c0-a6b0-7e9adf7540c7';

function repoPayments(): Repo {
  return {
    id: REPO_PAYMENTS_ID,
    workspace_id: WORKSPACE_ID,
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

function repoWeb(): Repo {
  return {
    id: REPO_WEB_ID,
    workspace_id: WORKSPACE_ID,
    owner: 'acme',
    name: 'web',
    full_name: 'acme/web',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  };
}

function pr482(): PrMeta {
  return {
    id: PR_482_ID,
    number: 482,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit-public',
    base: 'main',
    head_sha: 'a1b2c3d4e5f6',
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: 'needs_review',
    opened_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    score: 61,
    cost_usd: 0.42,
    findings_counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
  };
}

/** No review yet — exercises get_findings' "no review yet" hint. */
function pr480(): PrMeta {
  return {
    id: PR_480_ID,
    number: 480,
    title: 'Bump lockfile',
    author: 'marisa.koch',
    branch: 'chore/bump-lockfile',
    base: 'main',
    head_sha: 'b2c3d4e5f6a1',
    additions: 4,
    deletions: 4,
    files_count: 1,
    status: 'needs_review',
    opened_at: '2026-09-03T10:00:00.000Z',
    updated_at: '2026-09-03T10:00:00.000Z',
    score: null,
    cost_usd: null,
    findings_counts: null,
  };
}

/** `GET /pulls/:id` — the 4 files match `server/src/db/seed.ts:129-132`. */
function prDetail482(): PrDetail {
  return {
    ...pr482(),
    body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
    files: [
      { path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { path: 'src/config.ts', additions: 4, deletions: 0 },
      { path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ],
    commits: [],
    linked_issue: null,
  };
}

function prDetail480(): PrDetail {
  return {
    ...pr480(),
    body: 'Routine dependency bump.',
    files: [{ path: 'pnpm-lock.yaml', additions: 4, deletions: 4 }],
    commits: [],
    linked_issue: null,
  };
}

/** `GET /pulls/:id/blast-radius` for PR 482 — a healthy (non-degraded) index read. */
function blast482(): BlastRadius {
  return {
    changed_symbols: [
      { name: 'applyRateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' },
      { name: 'RateLimitConfig', file: 'src/middleware/ratelimit.ts', kind: 'interface' },
    ],
    downstream: [
      {
        symbol: 'applyRateLimit',
        callers: [
          { name: 'registerPublicRoutes', file: 'src/api/public/webhooks.ts', line: 42 },
          { name: 'createUser', file: 'src/api/users.ts', line: 118 },
        ],
        endpoints_affected: ['GET /users/:id', 'POST /webhooks/stripe'],
        crons_affected: ['job:digest'],
      },
      {
        symbol: 'RateLimitConfig',
        callers: [{ name: 'loadConfig', file: 'src/config.ts', line: 9 }],
        endpoints_affected: [],
        crons_affected: [],
      },
    ],
    summary: '2 changed symbols; 3 callers in 3 files; 2 endpoints; 1 cron.',
    degraded: false,
    reason: null,
  };
}

/** `GET /pulls/:id/blast-radius` for PR 480 — an unindexed repo (`no_data`). */
function blast480(): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: 'No indexed symbols in the 1 changed file.',
    degraded: true,
    reason: 'no_data',
  };
}

function agents(): Agent[] {
  const base = {
    system_prompt: 'Review the diff.',
    output_schema: null,
    version: 1,
    strategy: 'single-pass' as const,
    ci_fail_on: 'critical' as const,
    repo_intel: true,
  };
  return [
    {
      ...base,
      id: AGENT_GENERAL_ID,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    },
    {
      ...base,
      id: AGENT_SECURITY_ID,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    },
    {
      ...base,
      id: AGENT_PERFORMANCE_ID,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    },
    {
      ...base,
      id: AGENT_TESTQUALITY_ID,
      name: 'Test Quality Reviewer',
      description: 'Flags uncovered branches, missing edge cases, over-mocking, and flaky tests.',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: false,
    },
    {
      ...base,
      id: AGENT_APICONTRACT_ID,
      name: 'API Contract Reviewer',
      description: 'Catches breaking route, response-shape, nullability, and status-code changes.',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    },
  ];
}

function runsForPr482(): RunSummary[] {
  return [
    {
      run_id: RUN_GENERAL_ID,
      agent_id: AGENT_GENERAL_ID,
      agent_name: 'General Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'done',
      error: null,
      duration_ms: 4200,
      tokens_in: 3000,
      tokens_out: 400,
      cost_usd: 0.02,
      findings_count: 3,
      findings_counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 1 },
      grounding: 'ok',
      ran_at: '2026-09-02T10:00:00.000Z',
      score: 61,
      blockers: 1,
    },
    {
      run_id: RUN_SECURITY_ID,
      agent_id: AGENT_SECURITY_ID,
      agent_name: 'Security Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'done',
      error: null,
      duration_ms: 5100,
      tokens_in: 3200,
      tokens_out: 420,
      cost_usd: 0.03,
      findings_count: 1,
      findings_counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
      grounding: 'ok',
      ran_at: '2026-09-02T10:05:00.000Z',
      score: 70,
      blockers: 0,
    },
  ];
}

function reviewsForPr482(): ReviewRecord[] {
  return [
    {
      id: REVIEW_GENERAL_ID,
      pr_id: PR_482_ID,
      agent_id: AGENT_GENERAL_ID,
      run_id: RUN_GENERAL_ID,
      agent_name: 'General Reviewer',
      kind: 'review',
      verdict: 'request_changes',
      summary:
        'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
      score: 61,
      model: 'gpt-4.1',
      grounding: 'ok',
      created_at: '2026-09-02T10:00:00.000Z',
      findings: [
        {
          id: '0a427a38-594a-4f2c-b741-268492b88c6d',
          review_id: REVIEW_GENERAL_ID,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
          suggestion: 'Move to env var and rotate the key immediately.',
          confidence: 0.98,
          kind: 'finding',
          trifecta_components: null,
          evidence: null,
          accepted_at: null,
          dismissed_at: null,
        },
        {
          id: 'fd2a839c-4125-4686-9614-52b696d6fd13',
          review_id: REVIEW_GENERAL_ID,
          severity: 'WARNING',
          category: 'perf',
          title: 'N+1 query in user list endpoint',
          file: 'src/api/users.ts',
          start_line: 45,
          end_line: 52,
          rationale: 'Loop issues one query per user, an N+1.',
          suggestion: 'Use a single IN query and group in memory.',
          confidence: 0.86,
          kind: 'finding',
          trifecta_components: null,
          evidence: null,
          accepted_at: null,
          dismissed_at: null,
        },
        {
          id: 'f9f1a7f9-6cbe-49df-9446-67c48a085238',
          review_id: REVIEW_GENERAL_ID,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Magic numbers for the bucket refill rate',
          file: 'src/middleware/ratelimit.ts',
          start_line: 63,
          end_line: 69,
          rationale: 'The refill interval and burst size are inline literals.',
          suggestion: 'Lift both into named constants or config.',
          confidence: 0.71,
          kind: 'finding',
          trifecta_components: null,
          evidence: null,
          accepted_at: null,
          dismissed_at: null,
        },
      ],
    },
    {
      id: REVIEW_SECURITY_ID,
      pr_id: PR_482_ID,
      agent_id: AGENT_SECURITY_ID,
      run_id: RUN_SECURITY_ID,
      agent_name: 'Security Reviewer',
      kind: 'review',
      verdict: 'comment',
      summary: 'No secrets or injection paths beyond the one General Reviewer already flagged.',
      score: 70,
      model: 'gpt-4.1',
      grounding: 'ok',
      created_at: '2026-09-02T10:05:00.000Z',
      findings: [
        {
          id: 'be054af5-30df-4974-bfae-0d9bddf3a934',
          review_id: REVIEW_SECURITY_ID,
          severity: 'WARNING',
          category: 'security',
          title: 'Rate limiter keyed on IP alone, spoofable behind a shared proxy',
          file: 'src/middleware/ratelimit.ts',
          start_line: 20,
          end_line: 28,
          rationale: 'X-Forwarded-For is trusted without a proxy allowlist.',
          suggestion: 'Validate the proxy chain or key on an authenticated id.',
          confidence: 0.65,
          kind: 'finding',
          trifecta_components: null,
          evidence: null,
          accepted_at: null,
          dismissed_at: null,
        },
      ],
    },
  ];
}

function conventionsForPayments(): ConventionsPage {
  return {
    scan: {
      id: SCAN_ID,
      repo_id: REPO_PAYMENTS_ID,
      status: 'done',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      sampled_files: ['src/config.ts', 'src/api/users.ts'],
      candidates_total: 3,
      candidates_grounded: 3,
      dropped_ungrounded: 0,
      dropped_duplicate: 0,
      tokens_in: 12000,
      tokens_out: 800,
      cost_usd: 0.01,
      error: null,
      started_at: '2026-09-01T09:00:00.000Z',
      finished_at: '2026-09-01T09:02:00.000Z',
    },
    candidates: [
      {
        id: CANDIDATE_ACCEPTED_ID,
        repo_id: REPO_PAYMENTS_ID,
        category: 'error_handling',
        rule: 'Wrap every external call in a try/catch that logs and rethrows a typed error.',
        evidence_path: 'src/api/users.ts',
        evidence_line: 45,
        evidence_snippet: 'try { ... } catch (err) { ... }',
        confidence: 0.92,
        status: 'accepted',
        edited: false,
        skill_id: null,
        created_at: '2026-09-01T09:02:00.000Z',
      },
      {
        id: CANDIDATE_PENDING_ID,
        repo_id: REPO_PAYMENTS_ID,
        category: 'naming',
        rule: 'Name rate-limit middleware files after the resource they guard, not the mechanism.',
        evidence_path: 'src/middleware/ratelimit.ts',
        evidence_line: 1,
        evidence_snippet: 'export function rateLimit(...)',
        confidence: 0.8,
        status: 'pending',
        edited: false,
        skill_id: null,
        created_at: '2026-09-01T09:02:00.000Z',
      },
      {
        id: CANDIDATE_LOW_CONF_ID,
        repo_id: REPO_PAYMENTS_ID,
        category: 'style',
        rule: 'Prefer named constants over inline numeric literals in config-adjacent modules.',
        evidence_path: 'src/config.ts',
        evidence_line: 12,
        evidence_snippet: 'const RATE = 100;',
        confidence: 0.55,
        status: 'pending',
        edited: false,
        skill_id: null,
        created_at: '2026-09-01T09:02:00.000Z',
      },
    ],
    rejected_count: 1,
  };
}

export interface FixtureState {
  repos: Repo[];
  pulls: Record<string, PrMeta[]>;
  agents: Agent[];
  runs: Record<string, RunSummary[]>;
  reviews: Record<string, ReviewRecord[]>;
  conventions: Record<string, ConventionsPage>;
  pullDetails: Record<string, PrDetail>;
  blast: Record<string, BlastRadius>;
}

/** A fresh, independent copy of the fixture graph — safe to hand to a new fake API per test. */
export function createFixtureState(): FixtureState {
  return {
    repos: [repoPayments(), repoWeb()],
    pulls: {
      [REPO_PAYMENTS_ID]: [pr482(), pr480()],
      [REPO_WEB_ID]: [],
    },
    agents: agents(),
    runs: {
      [PR_482_ID]: runsForPr482(),
      [PR_480_ID]: [],
    },
    reviews: {
      [PR_482_ID]: reviewsForPr482(),
      [PR_480_ID]: [],
    },
    conventions: {
      [REPO_PAYMENTS_ID]: conventionsForPayments(),
    },
    pullDetails: {
      [PR_482_ID]: prDetail482(),
      [PR_480_ID]: prDetail480(),
    },
    blast: {
      [PR_482_ID]: blast482(),
      [PR_480_ID]: blast480(),
    },
  };
}
