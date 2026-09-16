# @devdigest/reviewer-core — module map

The review engine: **diff → prompt → LLM → grounded findings**. Pipeline diagram
and public API → `./README.md` — **read before changing any stage**.

## Commands

```sh
npm test          # vitest, hermetic, stubbed LLMProvider — no keys, no network
npm run typecheck # doubles as the build
npm run lint      # eslint
```

Uses **npm**, not pnpm. The package never emits JS: the server consumes
`src/**` directly through the `@devdigest/reviewer-core` tsconfig path alias.

## Layout

`src/prompt.ts` assembly + `INJECTION_GUARD` · `src/grounding.ts` citation gate ·
`src/llm/` provider + structured output · `src/review/` run orchestration and
reduce · `src/index.ts` the public surface.

## Conventions

- **Purity is the contract.** No database, no filesystem, no GitHub, no direct
  network. The only side effect is a call through the injected `LLMProvider` —
  that is what makes the engine mock-testable. Adding an import that breaks this
  breaks the package's reason to exist.
- Contracts (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared`; the
  response shape is enforced out of band as a JSON Schema, never described in
  prompt prose.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are omitted when
  empty — a lesson starts feeding one without changing `assemblePrompt`'s shape.
- Anything untrusted is wrapped with `wrapUntrusted()` before it enters the
  prompt.

## Do not touch

- `src/grounding.ts` — a finding that does not cite a real diff line is dropped.
  This gate is what makes findings trustworthy.
- `INJECTION_GUARD` in `src/prompt.ts` — one shared trusted rule appended to
  every agent prompt. Never swap it for keyword scanning of untrusted text.

## Gotchas

- The model's `score` is **ignored** and recomputed from the findings that
  survive grounding, so score and findings can never disagree on screen.
- `verdict` is currently passed through from the model unchanged — that is why
  the verdict convention in the prompt docs is load-bearing.

## Read when

- Prompt conventions, severity rubric, verdict semantics →
  `../docs/agent-prompts/README.md` — **read before editing prompt assembly or an
  agent prompt**
- What severity actually decides — score, blockers, grounding, verdict →
  `docs/severity-score-and-gates.md` — **read before changing scoring, the CI
  gate, or anything that counts findings**
- How the server feeds this engine → `../server/README.md#review-context-non-obvious`
- Feature specs → `specs/` · learned decisions → `INSIGHTS.md` — **read it before
  changing code here**, and run `/engineering-insights` at the end of the task to
  append what this session learned
