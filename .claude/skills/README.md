# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Which ring a `server/` file belongs to and what it may import — enforced by `pnpm lint` + `pnpm arch` |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Shared | Read and append the module's `INSIGHTS.md` — durable engineering memory |
| [pr-self-review](pr-self-review/SKILL.md) | Shared | Pre-PR gate: routes the diff to the skills that own each file, runs lint/typecheck/arch, and blocks `gh pr create` / `git push` on any CRITICAL finding |
| [spec-writing](spec-writing/SKILL.md) | Shared | House rules for a feature spec: template, EARS criteria, design-review checklist, traceability, size budget, spec smells, self-check |
| [run-plan](run-plan/SKILL.md) | Shared | `/run-plan plans/<stem>.md` — builds an approved plan through the agent chain with capped fix loops (verifier, architecture review, gate) and a per-run report folder |
| [workflow-retro](workflow-retro/SKILL.md) | Shared | `/workflow-retro [--deep]` — **manual only**: retrospective of a finished agent workflow (agents, order, tokens, hard / easy / duplicated / missed per agent, proposals) → one entry in `docs/retro/ledger/`; numbers from `scripts/retro-usage.mjs` |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Agent tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
