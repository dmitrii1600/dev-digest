# `project-context` — clone Markdown attached to agents and skills

`project-context` lets a user pick Markdown files from a repo's local clone
(specs, docs, `INSIGHTS.md`, anything `.md`) and attach them, in order, to an
**agent** or to a **skill**. When that agent runs a review, the attached
documents are read from the clone and injected into the prompt as untrusted,
path-labelled data. No route in this module calls a model
(`routes.ts:96`).

The module is a port plus an adapter-shaped reader: `run-executor.ts` reaches it
only through `Container['projectContext']` (`platform/container.ts:170`), a
type-only edge — the same shape as `intent` — because `no-cross-module-reach-in`
forbids importing `modules/project-context/*` directly.

## A run, end to end

```mermaid
sequenceDiagram
  participant RX as run-executor.ts
  participant PC as ProjectContextService<br/>resolveForRun
  participant DB as Postgres<br/>agent/skill_context_docs
  participant FS as repository-files.ts<br/>readDoc
  participant TK as tokenizer adapter
  participant RC as reviewer-core<br/>assemblePrompt

  RX->>PC: resolveForRun(repoId, clonePath, agentId)
  PC->>DB: pathsForRun (agent paths + enabled skills, in order)
  DB-->>PC: agent paths, then each skill's paths
  Note over PC: orderForInjection: agent first, skills in order, dedupe
  loop each path, read once
    PC->>FS: readDoc(clonePath, path)
    FS-->>PC: text (≤ 64 KB) or null
    PC->>TK: count(wrapProjectDoc(path, text))
  end
  PC-->>RX: docs, skipped, truncated, tokens
  RX->>RC: specs = docs (omitted when empty)
  RC-->>RX: "## Project context" slot, doc:path labels
  Note over RX: trace.specs_read = doc paths
```

- `resolveForRun` never throws for a missing clone or file: no `clonePath` returns
  an empty result (`service.ts:294`); an unreadable path lands in `skipped`
  (`service.ts:302`). `run-executor.ts` additionally swallows a rejected call
  (`run-executor.ts:422`), so Project Context can never fail a run.
- It is resolved **once per agent run**, and the result is reused across
  map-reduce chunks (`run-executor.ts:413`).
- With no documents the `specs` input is left out and the prompt is unchanged
  (`run-executor.ts:246`).

## Routes

All six go through `getContext` for the workspace and declare Zod
`params`/`querystring`/`body`/`response`, so invalid input is a 422 before the
handler (`routes.ts`).

| Route | Query / body | Returns | Notes |
|---|---|---|---|
| `GET /repos/:id/context` | — | `ContextFileList` `{ cloned, total, files[] }` | `files` is capped at 500, sorted by path, no `content`; `total` is the uncapped count. Each file carries `kind`, `size`, `updated_at`, `tokens`, `used_by`. Not cloned → `{ cloned: false, total: 0, files: [] }`. |
| `GET /repos/:id/context/file` | `?path=` | `SpecFile` with `content` | The path must be in the listing, else 422 (`service.ts:224`); unreadable → 404. |
| `GET /agents/:id/context` | `?repoId=` (uuid) | `ContextAttachments` `{ repo_id, paths }` | Paths in attach order. |
| `PUT /agents/:id/context` | `?repoId=`, body `{ paths }` | `ContextAttachments` | Replaces the whole ordered list. |
| `GET /skills/:id/context` | `?repoId=` | `ContextAttachments` | |
| `PUT /skills/:id/context` | `?repoId=`, body `{ paths }` | `ContextAttachments` | |

Contracts live in `@devdigest/shared` (`vendor/shared/contracts/platform.ts:254`):

- A `ContextPath` is 1–1024 characters and must end in `.md`. The `PUT` body is
  `{ paths }` with at most 500 entries, strict, and the paths must be unique.
- An unknown repo, agent or skill is 404, scoped to the caller's workspace
  (`repository.ts` `getRepo` / `agentExists` / `skillExists`).
- A `PUT` validates against the current listing **only the paths that are not
  already persisted** (`service.ts:251`). A previously attached file that has
  since vanished from the clone stays attachable and is reported as skipped at
  run time, rather than blocking every later edit. A new path outside the
  listing is a 422 naming the offenders.
- `tokens` on a listing row is the size of the block **as injected**, that is of
  `wrapProjectDoc(path, text)`, not of the raw file (`service.ts:213`); it is
  `null` when the file cannot be read. `used_by` counts distinct agents, through
  a direct attachment or through an enabled skill link (`repository.ts` `usedByPairs`,
  `helpers.ts` `countUsedBy`).

## Data model

Migration `0016_lethal_hellion.sql`, schema in `src/db/schema/project-context.ts`.
Both tables are binding tables like `agent_skills`: no `workspace_id`; tenancy is
checked in the service against the owner and the repo.

| Table | Columns | Keys |
|---|---|---|
| `agent_context_docs` | `agent_id`, `repo_id`, `path`, `order`, `created_at` | PK `(agent_id, repo_id, path)`; FK to `agents` and `repos`, both `ON DELETE cascade`; index on `repo_id` |
| `skill_context_docs` | `skill_id`, `repo_id`, `path`, `order`, `created_at` | PK `(skill_id, repo_id, path)`; FK to `skills` and `repos`, both cascade; index on `repo_id` |

- Attachments are **per repo**: the same agent has a separate list for each
  repo, and deleting a repo, agent or skill removes its rows.
- A `PUT` is delete-then-insert in one transaction, with the owner row locked
  `FOR UPDATE` so two concurrent `PUT`s serialise (`repository.ts:206`).
  `order` is the array index.

## The clone reader

`repository-files.ts` is ring 3 (the filesystem); `helpers.ts` is pure and does no
I/O. Limits are in `constants.ts`.

| Guard | Rule | Where |
|---|---|---|
| Listing | Walks the clone for `*.md` (case-insensitive), skipping `.git` and `node_modules`; symlinked entries are skipped, never followed | `repository-files.ts:83` |
| File cap | At most **500** files listed (sorted by path); `total` reports the full count | `constants.ts:3`, `repository-files.ts:112` |
| Traversal | Absolute-looking paths (`/…`, `\\…`, `C:\…`), `..` segments and empty segments return `null` | `repository-files.ts:127` |
| Containment | The resolved path must stay under the clone root, then the **`realpath`** of both must too, so a symlink pointing outside is rejected | `repository-files.ts:134` |
| Type | Must be a regular file; a NUL byte in the first 1 KB (binary) returns `null` | `repository-files.ts:141` |
| Size cap | **64 KB** per document; longer text is cut, a trailing split multi-byte character is trimmed, and `\n\n… [truncated at 64 KB]` is appended | `constants.ts:4`, `repository-files.ts:145` |
| Failure | `readDoc` never throws; every failure is `null` | `repository-files.ts:150` |

`kindForPath` derives a document's `kind` from its path alone, first match wins
(`helpers.ts:4`):

1. any directory segment named `specs` → `specs`
2. any directory segment named `docs` → `docs`
3. basename `INSIGHTS.md`, or a directory segment named `insights` → `insights`
4. otherwise `other`

## How a run resolves documents

1. `pathsForRun` returns the agent's own paths, then the paths of each skill linked
   to the agent, in `agent_skills.order`. A skill counts only when both
   `skills.enabled` and `agent_skills.enabled` are true (`repository.ts:234`).
2. `orderForInjection` concatenates the lists, agent first, and keeps the first
   occurrence of a path (`helpers.ts:15`). A document attached to both an agent
   and a skill is read and injected once.
3. Each path is read once with `readDoc`; the result feeds `docs`, `skipped`
   (null read) and `truncated` (cut at 64 KB).
4. `run-executor.ts` passes the docs as `specs` (`run-executor.ts:246`).
   `assemblePrompt` wraps each with `wrapProjectDoc(path, content)`, which emits
   `<untrusted source="doc:<path>">…</untrusted>`; `"`, `<`, `>` and newlines in
   the path are replaced with `_` so a file name cannot close the tag
   (`reviewer-core/src/prompt.ts:47`). The section is `## Project context`
   (`prompt.ts:147`).
5. The run log records one line per skipped and truncated path and a summary with
   the document count and tokens (`run-executor.ts:426`). The run trace's
   `specs_read` lists the injected paths (`run-executor.ts:348`), and
   `prompt_assembly.specs` holds the rendered slot.

The documents are **untrusted**: the shared `INJECTION_GUARD` tells the model that
everything inside `<untrusted>` blocks is data to analyse, never instructions
(`reviewer-core/src/prompt.ts:16`).

## Token counting

`countTokens` is injected as `(s) => this.tokenizer.count(s)`
(`platform/container.ts:176`), the shared tokenizer adapter
(`adapters/tokenizer/index.ts`). Both the listing and the run count the
**wrapped** block, so the picker's estimate and the run log use one rule.

`TiktokenTokenizer.count` encodes whole text normally. js-tiktoken's BPE merge is
super-linear on a single whitespace-free piece (a base64 blob, a minified line),
so when the text contains a run of 512 or more non-whitespace characters
(`/\S{512,}/`), it is encoded in 64-character slices and the counts are summed
(`adapters/tokenizer/index.ts:26`). The count differs slightly at slice seams.
Ordinary prose never hits the slicing path. If the encoder fails to load once, the
adapter falls back to `ceil(chars / 4)` for the rest of the process.

## Files

| File | Role |
|---|---|
| `routes.ts` | the six routes |
| `service.ts` | `ProjectContextService` — listing, validation, `resolveForRun` |
| `types.ts` | `ProjectContextPort` (what the container exposes), `ProjectContextStore`, `ProjectContextDeps` |
| `repository.ts` | Drizzle persistence, workspace-scoped lookups, `usedByPairs` |
| `repository-files.ts` | the clone reader and its guards |
| `helpers.ts` | `kindForPath`, `orderForInjection`, `countUsedBy`, `newPaths` — pure |
| `constants.ts` | `MAX_CONTEXT_FILES`, `MAX_DOC_BYTES`, excluded dirs, truncation marker |

The client side — the Project Context page and the Context tabs — is described in
`client/README.md`.
