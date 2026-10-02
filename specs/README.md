# specs — feature specifications

A spec describes a feature **before** it is built: the problem, the user, the intended
behaviour as checkable criteria, and what is deliberately out. It is the input to a plan
(`implementation-planner`, saved under [`plans/`](../plans/README.md)) and the yardstick
for the finished tree (`plan-verifier`). It is not a plan (that is `plans/<same-name>.md`),
not a description written afterwards (that is `README.md`) and not a record of what we
learned (that is `INSIGHTS.md`).

Cross-package features are specified here; features that live entirely inside one
package go in `<pkg>/specs/` (`server/`, `client/`, `reviewer-core/`, `mcp/`).
`e2e/specs/` holds browser flows, not specs.

Specs are written by the [`spec-creator`](../.claude/agents/spec-creator.md) agent, in
English, and approved by a person. The agent writes only inside the spec folders and
never changes a `Status`.

## Convention

One file per feature: `YYYY-MM-DD-short-name.md`, the date the spec was started and a
two-to-four-word feature name (`2026-09-29-copy-finding-markdown.md`). There are no
ticket numbers; the **Spec ID** is the filename stem with a `SPEC-` prefix
(`SPEC-2026-09-29-copy-finding-markdown`), so an ID is readable on its own, sorts by
date, and finds its file with one glob across all five spec folders. A stem is never
reused; a superseding spec carries its own date.

```
# Spec: <feature>
Spec ID: SPEC-YYYY-MM-DD-short-name
Status: draft | approved | implemented
Supersedes: SPEC-<yyyy-mm-dd>-<other-name> | none
Packages: <those touched>

## Problem and user             who is blocked, on what, what they do instead; Request vs tree
## Goals / Non-goals            observable outcomes; what is deliberately out
## User stories                 US-n: As a <role>, I want <…> so that <…>
## Acceptance criteria (EARS)   AC-n, one EARS pattern each, checkable · traces · verify
## Edge cases                   EC-n, EARS "IF … THEN" form · traces · verify
## Design review                DR-n: Gaps · Uncovered cases · Module interactions · UX improvements
## Non-functional requirements  NFR-n: latency, caps, i18n, a11y, degraded mode, cost · verify
## Traceability                 one row per AC / EC / NFR: traces to · verify how
## Inputs and provenance        request · answers · research · design · repo · insights
## Untrusted inputs             runtime inputs only: Input · Source · Validation · On invalid
## Open questions               Q-n (blocking | non-blocking), never silently empty
```

Acceptance criteria and edge cases use **EARS** (Easy Approach to Requirements Syntax):
*Ubiquitous* (the system shall …), *Event-driven* (WHEN …), *State-driven* (WHILE …),
*Unwanted behaviour* (IF … THEN …), *Optional feature* (WHERE …). Each carries `shall`,
a `traces:` hint (the `US-n` story or `DR-n` design item it satisfies) and a `verify:`
lane (`unit | component | integration | e2e | static | manual`), and can be confirmed by
a test or by a person following steps. A `## Traceability` table maps every `AC`, `EC`
and `NFR` to what it traces to and how it is verified.

The full working detail — the template with identifiers, the design-review state
checklist, the size budget, the spec smells that mean a spec has drifted into a plan,
and the self-check — is the [`spec-writing`](../.claude/skills/spec-writing/SKILL.md)
skill. `node scripts/spec-lint.mjs <spec>` checks the structure (filename ↔ Spec ID,
Status, headings, EARS form, traceability rows); `/pr-self-review` runs it on every
changed spec, and a filename or ID mismatch blocks the PR.

## Lifecycle

`Status` replaces moving files around:

- `draft`: written by `spec-creator`; may still be extended by it.
- `approved`: a person sets this after reading the draft. From here the agent does not
  edit the file; a changed decision is a **new** spec, dated the day it is written,
  with `Supersedes: SPEC-<yyyy-mm-dd>-<other-name>`.
- `implemented`: a person sets this once the feature ships and `plan-verifier` reports
  `CONFORMS`.

Delete a spec only when the feature is abandoned; otherwise leave it, so the superseding
chain stays readable. Do not leave a `draft` that no longer reflects intent where an
agent will read it as current.

## Designs

Designs live in `specs/designs/<slug>/` as PNG screenshots or markdown mockups, and are
passed to `spec-creator` by path. A Figma URL is recorded under *Inputs and provenance*
as a reference only; the agent cannot open it and needs a PNG export next to it.

## Before this template

Files `01`–`09` here and in `server/`, `client/` and `reviewer-core/` were written
before this template, most of them as Development Plans. They stay as they are and are
read as context; they are not migrated and not edited by the agent.
