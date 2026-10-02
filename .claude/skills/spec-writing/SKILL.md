---
name: spec-writing
description: "House rules for a DevDigest feature specification: the file template, EARS acceptance criteria, the design-review state checklist, traceability and verification hints, the size budget, the spec smells that mean a spec has drifted into a plan, and the self-check. Use when writing a spec (spec-creator), when turning a spec into a Requirements ledger (implementation-planner), or when checking a tree against a spec (plan-verifier). Not for implementation plans, READMEs or INSIGHTS."
---

# Spec writing

A spec says **what** a feature does, **for whom**, **why**, and **how we will know**. It
never says how the code is shaped. The moment a spec names a file to edit, a hook to
write or a test API to call, it has become a plan, and plans live in `plans/`.

The canonical convention is [`specs/README.md`](../../../specs/README.md); this skill is
the working detail behind it. A conflict between the two is a bug in this file.

## Naming and place

- Filename `YYYY-MM-DD-short-name.md`: today's date and two to four lowercase words that
  name the *feature* (`copy-finding-markdown`, not `client-change`).
- `Spec ID: SPEC-<stem>` where `<stem>` is the filename without `.md`. One glob
  (`**/specs/<stem>.md`) finds it; a stem is never reused.
- Folder: more than one package → `specs/`; one package → `server/specs/`,
  `client/specs/`, `reviewer-core/specs/` or `mcp/specs/`. `e2e/specs/` is flows, not
  specs. Pre-template files `01`–`09` keep their numbers and are never edited.
- Paths inside a spec are **repo-root relative** with `path:line`, never `../` relative.

## Template

Every heading stays, even when its body is one line. Identifiers are stable handles
that plans and ledgers cite: `US-n` stories, `AC-n` criteria, `EC-n` edge cases,
`NFR-n` non-functional requirements, `DR-n` design-review items, `Q-n` open questions.

```
# Spec: <feature>
Spec ID: SPEC-YYYY-MM-DD-short-name
Status: draft
Supersedes: SPEC-<yyyy-mm-dd>-<other-name> | none
Packages: <server, client, mcp, reviewer-core — those touched>

## Problem and user
<Who is blocked, on what, what they do today instead. 2–6 sentences.>
**Request vs tree:** <where the request's premise matches the code and where it does
not, with path:line; or "matches">

## Goals / Non-goals
**Goals**
- <observable outcome>
**Non-goals**
- <deliberately out, and where it goes if anywhere>

## User stories
- **US-1** As a <role>, I want <capability> so that <outcome>.

## Acceptance criteria (EARS)
- **AC-1** WHEN <event>, the system shall <response>. · traces: US-1 · verify: component
- **AC-2** The system shall <response>. · traces: US-1 · verify: e2e

## Edge cases
- **EC-1** IF <unwanted condition>, THEN the system shall <response>. · traces: DR-2 · verify: component

## Design review
**Source:** specs/designs/<slug>/<file> | none — checklist run against the tree
### Gaps
- **DR-1** <need> — nothing provides it today (checked path:line)
### Uncovered cases
- **DR-2** <state the design does not show> → EC-1
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` <surface> | `server` `modules/<name>` | `GET /…` | `<Name>` in server/src/vendor/shared/contracts/<file>.ts · existing \| new |
### UX improvements
- **DR-3** *proposed* <change> — motivated by US-n / EC-n

## Non-functional requirements
- **NFR-1** <category>: <checkable statement> · verify: <lane>

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-1 | component |
| EC-1 | DR-2 | component |
| NFR-1 | US-1 | static |
<every AC, EC and NFR has a row; every US and every DR-n gap/uncovered item is cited by
at least one row, or is listed under Open questions as unowned>

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | <conversation / brief> | <…> |
| answers | <re-invocation answers, quoted> | <…> |
| research | <researcher report title or path> | <…> |
| design | specs/designs/<slug>/<file> | <…> |
| repo | path:line | <…> |
| insights | <pkg>/INSIGHTS.md:<line> | <…> |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|

## Open questions
- **Q-1 (blocking):** <question the planner cannot proceed past> — <who decides>
- **Q-2 (non-blocking):** <question settled later> — <default taken in this draft>
<Once answered: a dated **Resolved decisions** line, then "- Q-n, resolved: <decision> (<affected ids>)"; the IDs are kept so references stay valid.>
<If none: "- None outstanding for the stated scope.">
```

## EARS — how a criterion is written

| Pattern | Shape | Example |
|---|---|---|
| Ubiquitous | The system shall … | The system shall log every authentication attempt. |
| Event-driven | WHEN <event>, the system shall … | WHEN the user submits the login form, the system shall validate the credentials. |
| State-driven | WHILE <state>, the system shall … | WHILE a sync is running, the system shall show progress. |
| Unwanted behaviour | IF <condition>, THEN the system shall … | IF validation fails three times within 60 seconds, THEN the system shall lock the account temporarily. |
| Optional feature | WHERE <feature is enabled>, the system shall … | WHERE MFA is enabled, the system shall require a TOTP code after the password. |

Rules:

- Exactly one pattern per criterion, always `shall`, one behaviour per criterion.
- "The system" may narrow to the component that owns the behaviour: "the Findings tab
  shall", "`get_blast_radius` shall".
- Checkable means a test or a person following steps can say yes or no. "should",
  "quickly", "user-friendly", "as appropriate", "properly", "robust" are not checkable
  and do not go in.
- Edge cases prefer the IF … THEN form; a WHILE or WHEN edge case is fine when the
  condition is a state or an event rather than a fault.
- Numbering is dense: `AC-1 … AC-n` with no gaps, same for `EC`, `NFR`, `DR`, `Q`, `US`.

## Design review — the state checklist

Run it per screen or per surface the feature touches, whether a design was given or not.
With a design, record which states it shows and which it does not; without one, record
which states the existing UI or API already handles (`path:line`) and which the feature
must decide. Say which of the two you did on the **Source** line.

- empty (no data yet) · loading · error · degraded or partial data (an unindexed repo, a
  failed LLM call) · stale data
- zero items · one item · many items · long or overflowing text
- narrow viewport · keyboard only · no permission or not signed in
- the same action twice (double submit, retry) · the action interrupted mid-way
- a background job running · the job finishing while the user looks elsewhere

Compare against what exists before calling anything a gap: primitives in
`client/src/vendor/ui/primitives/`, feature components under
`client/src/app/**/_components/`, routes in `server/src/modules/*/routes.ts`, contracts in
`server/src/vendor/shared/contracts/`, MCP tools in `mcp/src/tools/`.

**Module interactions** name both levels: the package (`client` → `server` →
`reviewer-core`, `mcp` → `server`) and the Fastify module (`server/src/modules/<name>`),
with the `@devdigest/shared` contract that carries each exchange, marked `existing` or
`new`. For two or more packages a mermaid sequence diagram under the table is welcome
(load `mermaid-diagram`). A `new` contract is a shape, not a Zod definition; if you sketch
it, load `zod` and keep it to the fields.

**UX improvements** are marked *proposed*. A proposal nobody accepted is also an Open
question; a plan never builds a proposal that was not adopted.

## Verification hints

Every `AC`, `EC` and `NFR` carries one hint from this vocabulary, chosen by where the
behaviour is observable, so the planner's Test plan and the verifier's ledger start from
the spec:

| Hint | Means | Runs as |
|---|---|---|
| `unit` | pure logic, no I/O | `reviewer-core`: `npm test` · `server`: `pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| `component` | a React component or hook in jsdom | `client`: `pnpm test` |
| `integration` | needs Postgres | `server`: `*.it.test.ts` under `pnpm test` |
| `e2e` | a browser flow | `e2e/specs/NN-name.flow.json` via `./scripts/e2e.sh` |
| `static` | a type, a lint rule, an arch rule | `<pm> run typecheck` · `lint` · `pnpm arch` |
| `manual` | a person follows numbered steps | steps written next to the criterion |

A hint is a lane, not a test design. "verify: component" does not name the test file,
the query or the assertion.

## Non-functional requirements — the categories to walk

Latency or size caps · degraded mode (what happens without the index, without the LLM,
without the clipboard) · i18n (`messages/en/<namespace>.json`, no literals) ·
accessibility (role, name, keyboard, not colour-only) · cost (no extra LLM call, no extra
request) · data retention · concurrency (double submit, parallel runs) · observability
(what is logged). Write one `NFR-n` per category that applies, each checkable; skip the
ones that do not.

## Untrusted inputs

Only **runtime inputs of the feature**, never the sources of the spec (those are
provenance). Untrusted means an outside party can shape it: a GitHub diff, PR title, body
or comment; a file under `server/clones/**`; LLM output; a form field, query parameter or
header; an MCP tool argument; clipboard or file contents the user pastes. Columns are
**Input · Source · Validation · On invalid**, and "On invalid" is a behaviour (reject with
422, truncate to N, render as plain text, skip the item), never "handle appropriately". Do
not propose keyword scanning of untrusted text: the engine's `INJECTION_GUARD` is the one
shared rule and is not redesigned in a spec.

**Validation vocabulary** — the part of web-security practice that applies to a Fastify +
Zod + Postgres stack. Name the rule in the *Validation* column and the observable outcome
in *On invalid*:

- *Shape and bounds* — a Zod contract on every HTTP body, param and query and on every
  MCP tool argument: type, enum, length or size cap, integer range; `.strict()` on a wire
  object. On invalid: 422 naming the field.
- *Identity* — an id resolves to a row the caller may see, or the response is 404; never
  another caller's row, never a distinguishable "exists but forbidden".
- *Text that is rendered* — plain text by default; markdown only through the existing
  renderer; never raw HTML from an untrusted string.
- *Text that reaches a prompt* — wrapped as untrusted, so the model reads it as data; an
  instruction inside it is quoted in the finding, never followed.
- *Paths and URLs* — a clone path stays under `server/clones/<repo>`; an outbound URL is
  an allow-listed host; no user-controlled path segment reaches the filesystem raw.
- *Secrets* — never in a request body the client builds, never echoed back, never logged.
- *Size and rate* — a cap on items per request and bytes per field, stated as a number.

Load the `security` skill only when the feature adds an auth, secrets or outbound-network
surface; for the usual route-plus-panel feature this list is enough.

## Size budget

| Feature | Lines | AC | EC |
|---|---|---|---|
| one screen or one endpoint | ≤ 120 | 4–8 | 3–6 |
| one package, several surfaces | ≤ 200 | 6–12 | 4–10 |
| cross-package | ≤ 300 | 8–16 | 6–12 |

Over budget means the spec is padding sections or has become two features. Split it or
cut the prose; never cut criteria to fit.

## Spec smells — the spec has become a plan

Any of these is rewritten before the spec is emitted:

- names a file to edit or create (`FindingCard.tsx`, `routes.ts`) outside *Module
  interactions* and *Inputs and provenance*;
- names a hook, a helper, a component prop, a Zod call, a test API (`fireEvent`,
  `vi.mock`) or a CSS rule;
- assigns a ring, a layer or a folder;
- contains a "Testability" or "Implementation notes" section;
- an NFR cites a style rule or an icon (`icons.tsx:20`) instead of a user-observable
  property;
- an AC describes an internal state ("the store is updated") instead of an observable.

`path:line` citations of the *current* tree are not smells: they ground a gap or a
constraint. The smell is prescribing the *future* tree.

## Self-check — before the spec is emitted

Run every line; a failed line is fixed in the file, not noted in the report.

1. Filename stem = `Spec ID` without `SPEC-`; `Status: draft`; `Supersedes` present.
2. All 12 headings present, in template order.
3. Every AC and EC: one EARS pattern, `shall`, no weak word, a `traces:` and a `verify:`.
4. Every EC from an uncovered design case cites its `DR-n`; every `DR-n` gap or uncovered
   item is cited somewhere or listed under Open questions.
5. Traceability has one row per AC, EC and NFR; no row cites an identifier that does not
   exist.
6. Untrusted inputs lists runtime inputs only; every row has a behaviour under "On
   invalid".
7. Provenance separates the request, the answers, the research, the designs and the tree.
8. No spec smell; within the size budget for the feature class.
9. Open questions is not silently empty; each `Q-n` says blocking or non-blocking and who
   decides.
10. `node scripts/spec-lint.mjs <path>` reports no CRITICAL and every WARNING is either
    fixed or explained in the Spec Report.

## Lifecycle

`Status` is set by a person: `draft` → `approved` (after reading) → `implemented` (after
`plan-verifier` reports `CONFORMS`). Once building has started, an approved spec is never
edited; a changed decision is a new spec, dated the day it is written, with `Supersedes`
pointing back. The planner plans against the newest spec in a `Supersedes` chain.

**Before building starts, amend in place.** A decision that changes an approved spec before
any code is built against it is an in-place amendment, not a new spec. The typical case is
a contradiction the planner finds in its Requirements review. Three conditions apply:

- the person asked for the change;
- `.devdigest/sdd/<stem>/` holds no `1x-build*` report;
- no commit after the plan's own touches code.

The amendment leaves the `Status` line untouched. It adds one dated line to *Resolved
decisions*, saying what changed and who decided it, plus an `answers` row in *Inputs and
provenance*. Stem and Spec ID stay, so the plan's path still points at it. Why: on
2026-10-01 a superseding spec written eight minutes after approval cost an extra file and an
extra round with the person, who chose the in-place amendment anyway
(`docs/retro/ledger/2026-10-01-onboarding-generator.md`, proposal 4).
