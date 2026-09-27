# Insights — @devdigest/e2e

Flakiness causes, agent-browser quirks, and fixture assumptions that are not
visible from the flow JSON. Cross-package findings go in `../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-20 — `agent-browser find text "<label>" click` refuses to click a
  button inside the `Drawer` from `@devdigest/ui` with *"covered by <div> at
  its click point"*, although `document.elementFromPoint` at the button's
  centre returns the button itself (verified in both the agent-browser page
  and the in-app browser). The drawer is `position: fixed` inside a scrolling
  `<main>`; whatever find-text uses as the click point disagrees with the
  rendered box. `click @eNN` (a snapshot ref) and `click "[data-testid=…]"`
  both work, so a flow clicks such a button by a `data-testid` on the element
  (`09-skills.flow.json` → `SkillPreviewDrawer.tsx`). Waiting out the slide-in
  animation does not help.

- 2026-09-16 — There is no negative text assertion. `wait --text X` waits for X to
  appear; nothing waits for X to be *gone*, so a filter or delete flow cannot
  assert a disappearance directly. Assert a positive consequence instead —
  `08-findings-severity.flow.json` waits for the "Show all findings" control to
  appear — and leave the counting to a component test, which can count rendered
  nodes. Do not approximate it with a sleep plus a screenshot.

- 2026-09-27 — `find role button --name "<tooltip>"` never matches a button that
  has visible content: the accessible name is the content (icon + count +
  "Critical"), and `title` only counts when there is no content. Flow 08 targeted
  the pill's tooltip "Show only this severity" and failed for ten CI runs; the fix
  is the visible label (`08-findings-severity.flow.json:16`, name from
  `client/src/vendor/ui/primitives/tokens.ts:10`), never an `aria-label` — that
  would hide the count from screen readers.
- 2026-09-27 — `wait --text` matches **innerText lines**, and a flex container
  puts every flex item on its own line. `<span style="display:inline-flex">
  <span>3</span> symbols</span>` renders as "3" / "symbols", so `wait --text
  "3 symbols"` times out although the screenshot shows exactly that. Keep number
  and label inside one inline (non-flex) span
  (`client/.../BlastRadiusPanel/BlastRadiusPanel.tsx:132`). Diagnose with
  `agent-browser get text body` — one token per line is the signature.
- 2026-09-27 — `find text "<row title>" click` straight after `wait --url /pulls`
  is a race: the row is fetched after the redirect, and `next dev` (hermetic
  runner, first compile) loses it while CI's `next start` wins. Flows 04/05 failed
  locally only. Always `wait --text` for the row before clicking it, as 02 and 08
  already did.

- 2026-09-27 — On Linux CI a `find … click` on an element **below the fold**
  reports success and does nothing: agent-browser scrolls neither the window
  nor the app's scrolling `<main>` first (`scrollintoview "text=…"` also leaves
  `main.scrollTop` at 0), and the headless viewport is only ~1280×577. Every
  click that passed in CI was inside that first screen; the severity pill
  (flow 08) and the Prior PRs toggle (flow 13) were not, and both "passed" the
  click and failed the next `wait`. Windows Chrome happened to click through.
  Fix: `["set","viewport","1280","1800"]` right after the first `open` (it does
  not stick when issued before a page exists, but persists across later
  `open`s in the shared session) — `08-findings-severity.flow.json:6`,
  `13-blast-radius.flow.json:6`.



## Codebase Patterns

- 2026-09-16 — Flow assertions are strings from `server/src/db/seed.ts`, so a seed
  change breaks flows. Adding a third seeded finding to PR #482 turned
  `wait --text "2 findings"` into a failure at `04-pr-findings.flow.json:13`. The
  coupling is the point — it is what makes these flows assert real data — but it
  means a seed change is not done until the flows are updated.
- 2026-09-16 — `find role button --name "<X>"` needs `<X>` unique on the page. A
  severity pill's active tooltip and the clear-filter link both read "Clear
  severity filter" at first; the fix was giving the link its own string ("Show
  all findings"), which is better for screen readers too. When a flow needs a
  locator the UI cannot provide unambiguously, change the UI — never reach for a
  positional selector.

- 2026-09-27 — `13-blast-radius.flow.json` asserts numbers that exist only because
  `server/src/db/seed-blast.ts` seeds a synthetic `full` index for the demo repo
  (3 symbols / 4 callers / 3 endpoints / 1 cron, one cached prior PR). Change
  that fixture and the flow — and `server/test/seed-blast.it.test.ts` — change
  together. Degraded / Resync / empty Prior PRs are deliberately NOT flowed
  (they never render against a `full` index; `BlastRadiusPanel.test.tsx` owns
  them).


## Tool & Library Notes

- 2026-09-18 — `agent-browser` is **not** a declared dependency of this package
  (`package.json` lists only tsx/eslint/typescript) — it is an external binary
  expected on `PATH`. On a machine without it, `./scripts/e2e.sh` brings the
  whole hermetic stack up successfully and then every flow fails identically with
  `spawn agent-browser ENOENT`, before any page loads, for a final `0/8 flows
  passed`. That output looks like a total application regression and is not one:
  identical failures across all eight flows at the *first* step is the signature
  of a missing driver, not of broken UI. Verify the app another way (curl the
  routes against a running stack) before believing it.

- 2026-09-27 — On Windows `run.ts:45` (`execFile("agent-browser")`, no shell)
  cannot launch npm's `agent-browser.cmd` shim: every step fails with `spawn
  agent-browser ENOENT` even though `agent-browser --version` works in the
  terminal. Point `AGENT_BROWSER_BIN` at the native binary
  (`%APPDATA%/npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe`).
  `scripts/e2e.sh` then runs fine from Git Bash; `pgrep`/`lsof` are missing but
  the plain `kill` was enough — no orphaned :3100/:3101 after two runs.
- 2026-09-27 — `find role ... --name X` is a case-insensitive **substring** match
  (`--exact` for exact); `wait --text` polls slowly, so probing a string with a
  short `timeout 8` gives false MISSes — use ≥ 30 s when checking a locator by
  hand.


## Recurring Errors & Fixes

## Session Notes

### 2026-09-27 — green the suite, cover L03/L04
Flow 08's severity-pill locator (title vs accessible name) was the only CI
failure; fixed in the flow. Added 11-intent-card, 12-smart-diff and
13-blast-radius (the last needs `seed-blast.ts`). First hermetic run on Windows:
10/13 — 04/05 row-click race, 13 flex-split stats text. Second run 13/13.
`e2e-web.yml` triggers restored (plus `reviewer-core/**`). The coverage table
in README.md now lists 01–13; the older entries above about a
`SkillPreviewDrawer` testid and "0/8 flows" describe a suite that no longer
exists (flow 09 has no testid step; there are 13 flows).


## Open Questions
