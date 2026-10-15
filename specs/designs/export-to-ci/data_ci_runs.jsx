  ],
  byModelCost: [
    { label: "gpt-4.1", value: 6.10, color: "#3b82f6" },
    { label: "gpt-4o", value: 2.22, color: "#10b981" },
    { label: "gpt-4o-mini", value: 0.42, color: "#8b5cf6" },
  ],
};

const CI_RUNS = [
  { id: "ci1", ts: "2026-06-01 08:42", pr: 482, prTitle: "Add rate limiting to public API endpoints", agent: "Security Reviewer", source: "GitHub Actions", duration: 7.4, findings: { CRITICAL: 2, WARNING: 1 }, cost: 0.07, status: "succeeded" },
  { id: "ci2", ts: "2026-06-01 07:15", pr: 479, prTitle: "Migrate sessions table to UUID primary key", agent: "Security Reviewer", source: "GitHub Actions", duration: 9.1, findings: { CRITICAL: 1, WARNING: 4 }, cost: 0.09, status: "succeeded" },
  { id: "ci3", ts: "2026-05-31 22:03", pr: 477, prTitle: "Fix flaky checkout integration test", agent: "Performance Reviewer", source: "CircleCI", duration: 5.2, findings: {}, cost: 0.03, status: "no_findings" },
  { id: "ci4", ts: "2026-05-31 18:30", pr: 471, prTitle: "Refactor invoice PDF renderer", agent: "Security Reviewer", source: "GitHub Actions", duration: 0, findings: {}, cost: 0, status: "failed" },
  { id: "ci5", ts: "2026-05-31 14:12", pr: 468, prTitle: "Add idempotency keys to charge endpoint", agent: "Performance Reviewer", source: "GitHub Actions", duration: 6.8, findings: { WARNING: 1, SUGGESTION: 2 }, cost: 0.05, status: "succeeded" },
];

const COMMUNITY_SKILLS = [
  { name: "owasp-top-10-review", repo: "secdev/agent-skills", stars: 1240, lang: "any", desc: "Maps diff changes to the OWASP Top 10 with CWE references." },
  { name: "react-hooks-rules", repo: "frontend-guild/skills", stars: 842, lang: "TypeScript", desc: "Detects conditional hooks, missing deps, stale closures." },
  { name: "sql-injection-gate", repo: "secdev/agent-skills", stars: 690, lang: "any", desc: "Flags string-concatenated SQL and unparameterized queries." },
  { name: "a11y-jsx-audit", repo: "a11y-collective/skills", stars: 318, lang: "TypeScript", desc: "Checks JSX for missing alt text, ARIA, and focus traps." },
];

Object.assign(window, { AGENTS, AGENT_TEMPLATES, EVAL_CASES, TRACE, AGENT_PERF, CI_RUNS, COMMUNITY_SKILLS });
