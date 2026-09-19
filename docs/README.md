# docs — project-wide explanations

Stable, cross-package explanations that outlive a single change. Put a document
here when it explains **how something works or why it is shaped that way** and
more than one package cares.

Module-local docs live in `<module>/docs/`. Architecture that belongs to one
package stays in that package's `README.md`.

## Contents

- [`agent-prompts/`](./agent-prompts/README.md) — how a reviewer agent's system
  prompt is assembled, the severity/verdict conventions, and the checklist to
  run before shipping a prompt.

When you add a document here, add one line to this list and, if an agent must
read it under a specific condition, a pointer in the root `AGENTS.md`
(`## Read when`).
