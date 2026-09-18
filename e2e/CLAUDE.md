# @devdigest/e2e — module map

Deterministic browser flows for the web app, driven by Vercel **agent-browser**
(Rust + CDP CLI). No Playwright, no LLM, no API key. Flow format, env knobs and
coverage table → `./README.md` — **read before writing or debugging a flow**.

## Commands

```sh
npm i -g agent-browser && agent-browser install   # once
./scripts/e2e.sh      # hermetic: own Postgres :5433, API :3101, web :3100
npm test              # runs flows against E2E_BASE_URL (default :3000)
npm run typecheck
npm run lint          # eslint
```

Uses **npm**, not pnpm.

## Layout

`specs/NN-name.flow.json` — here `specs/` means **agent-browser flow specs**, not
feature specifications. `run.ts` executes every flow in order against one shared
browser session; `lib/assert.ts` holds the assertion helpers.

## Conventions

- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`.
  The AI `chat` command is never used — that is what keeps runs stable and
  key-free.
- `wait --text` / `wait --url` **are** the assertions: a non-zero exit fails the
  step and the flow.
- Flows target read-only seeded data (`acme/payments-api`, PR #482, seeded
  agents) so nothing can trigger a model call.
- A new flow is a new numbered JSON file; keep it typological, not exhaustive.

## Do not touch

- `docker compose down -v` for your dev DB — `-v` deletes `devdigest_pgdata`
  along with every imported repo and review.

## Gotchas

- **Run hermetically.** Flows 02/04/05 follow the home redirect to the *first*
  repo, so they assume the seeded demo repo is the only one. Against a real dev
  DB they land on the wrong repo and fail.
- Failure screenshots land in `test-results/` (git-ignored, uploaded by
  `.github/workflows/e2e-web.yml`).

## Read when

- Writing a flow that will not flake, and what this suite cannot assert →
  `docs/writing-a-flow.md` — **read before adding or debugging a flow**
- Routes and selectors the flows depend on → `../client/README.md`
- Seeded fixture data → `../server/src/db/seed.ts`
- Learned decisions → `INSIGHTS.md` — **read it before changing a flow**, and run
  `/engineering-insights` at the end of the task to append what this session
  learned
