# reviewer-core/specs — engine feature specifications

Specs for changes that live entirely inside the engine (a new prompt slot, a new
gate, a change to how findings are scored or reduced). Anything that also changes
an API route or the UI goes in `../../specs/`.

A gate or scoring change must state its acceptance checks as engine tests —
`npm test` is hermetic, so there is no excuse for an unverified gate.

Format and lifecycle: see [`../../specs/README.md`](../../specs/README.md).
