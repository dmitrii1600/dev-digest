# Design 06 — PR Brief on the Overview tab (markdown mockup)

Source: the "DevDigest — App prototype" artifact
(https://claude.ai/artifact/KP2JTS2LE2eDQCTx6MU1hK/), screen "PR Detail"
(`screen_pr_detail.jsx`, `findings.jsx` `VerdictBanner`, `diff.jsx` `SmartDiff`).
Extracted from the prototype's source on 2026-10-02. This file records
**behaviour and layout only**; mock data (`acme/payments-api#482`, file names,
numbers) is illustrative. Screenshots 01–05 in this folder show the same screen.

## Overview tab — `PR BRIEF` section

Section label `PR BRIEF` (icon `FileText`), then the brief card. Max content
width ~1080 px.

### States

| State | What renders |
|---|---|
| empty (no brief yet) | Centered card, min-height ~320 px: `FileText` icon tile, title **"No brief yet"**, text "Generate a Why+Risk brief for this PR.", primary button **Generate brief** (icon `FileText`). |
| loading (generating / regenerating) | The verdict banner stays, its score circle is replaced by a spinning `RefreshCw`; below it a two-column **skeleton** (two cards, each a 40 % title bar, four text bars 92/86/74/60 %, a divider, two bars 80/64 %). |
| ready | Banner, then a 2-column grid, then the Review-focus card (below). |

### Ready layout

1. **Verdict banner** (full width). Left: verdict icon tile (`XCircle`
   request_changes / `CheckCircle` approve / `MessageSquare` comment, coloured
   crit / ok / info). Title = verdict label, badge `"<n> findings · <m> blockers"`,
   an `Info` icon whose tooltip reads: *"Verdict, findings and score come from the
   latest agent review; what / why / risks / review-focus come from the brief."*
   Body text = the **brief's summary**. Right: a `RefreshCw` icon button
   (label "Re-run the brief for this PR"), then a circular **PR SCORE**, then a
   cost line `$<usd> <in>K→<out>K`.
2. **Left card**: `INTENT` (icon `Target`) — italic quoted intent, two columns
   `IN SCOPE` (green check) / `OUT OF SCOPE` (muted X), bulleted. Divider.
   `RISK AREAS` (icon `AlertTriangle`) — a wrap row of risk pills.
3. **Right card**: `BLAST RADIUS` (icon `Workflow`) — the existing L04 blast
   panel (counts row, Tree/Graph toggle, per-symbol callers, endpoint and cron
   chips). Divider. `Prior PRs touching these files` accordion (L04 P3 — not
   part of the brief).
4. **Review focus card** (full width): label `REVIEW FOCUS — READ THESE FIRST`
   (icon `ListChecks`) + count badge. Ordered list; each row is a button:
   `▸  <file>:<line>  — <reason>` (file:line in mono accent). Hover highlights
   the row; tooltip "Open <file>:<line> in Files changed". Hidden when the list
   is empty.

### Risk pill

- Two-part pill. Main part: icon by `kind` (`security`→Shield,
  `db_migration`→Database, `breaking_api`→AlertOctagon, `perf`→Zap,
  `deps`→Boxes) coloured by severity (high = crit red, medium = warn amber,
  low = info blue), title, and under it the first `file_refs` entry in mono.
  Clicking the main part jumps to that file (same as a review-focus click).
- Right part: a chevron button ("Why this is a risk") toggling an explanation
  panel under the row (one open at a time). The panel shows `explanation`
  and every `file_refs` entry as a mono link that also jumps to the file.
  Expanded pill gets a severity-coloured border.

## Jump to a file (review focus or risk click)

- If the file **is in this PR's diff**: switch to the **Files changed** tab,
  expand the role group containing the file, expand the file card, scroll it
  into view, and scroll to the target line when an anchor for `<file>:<line>`
  exists. The target file card gets an accent border (screenshot 05).
- If the file is **not** in the diff (e.g. only in the blast-radius map): stay
  on Overview and show a bottom-centered toast **"File not in this PR's diff"**
  (warn icon) for ~2.6 s.

## Files changed tab (target of the jump)

Unchanged L03 Smart Diff ("Reviewer-ordered diff", Smart / Original order,
role groups Core logic / Wiring / Boilerplate …, per-file "What this does"
summary, finding markers). Only the navigation target behaviour above is new.
