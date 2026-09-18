# specs — feature specifications

A spec describes a feature **before** it is built: the problem, the intended
behaviour, the contract, and how we will know it works. It is the input to an
implementation, not a description written afterwards (that is `README.md`) and
not a record of what we learned (that is `INSIGHTS.md`).

Cross-package features are specified here; features that live entirely inside one
package go in `<module>/specs/`.

## Convention

One file per feature: `NN-short-name.md` (`01-run-cost-badge.md`).

```
# <feature>
## Problem        why this exists; who is blocked without it
## Scope          in / explicitly out
## Contract       API, schema, or UI surface it adds or changes
## Acceptance     observable checks that prove it works
## Open questions
```

Move a spec to `done/` once shipped, or delete it and let the code and README
speak — do not leave stale specs where an agent will read them as current intent.
