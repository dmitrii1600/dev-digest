# Insights — @devdigest/web

Client-local facts that are not visible from the code: why a choice was made,
what we tried that did not work, what surprised us. Cross-package findings go in
`../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-15 — The PR-list header right-aligned its last column by index
  (`i === COLUMN_KEYS.length - 1`), so inserting any column before `updated`
  silently left the new one left-aligned while the rows' cell was right-aligned.
  Replaced with an explicit key set, `RIGHT_ALIGNED_COLUMNS`
  (`src/app/repos/[repoId]/pulls/constants.ts:56`). Adding a column means
  editing three things in step: `GRID`, `COLUMN_KEYS`, and the cell in `PRRow`.

- 2026-09-16 — `borderColor` is **itself a shorthand** for the four sides, so
  pairing it with `borderLeftColor` trips React's "updating a style property
  during rerender" warning exactly as `border` + `borderLeft` would. The comment
  at `src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts:7`
  warned about the shorthand and then used `borderColor` anyway; it now sets
  `borderTop/Right/BottomColor` per side. Invisible until something rerenders the
  card with `focused` changing — the severity filter is what surfaced it.

- 2026-09-20 — Never run `pnpm build` in `client/` while `next dev` is serving:
  both write `.next`, and the build leaves the dev server's manifests gone. Every
  chunk then 404s (`_next/static/chunks/main-app.js`, `…/app/layout.css`) and the
  page renders with no design-system CSS at all, which looks like a broken
  stylesheet rather than a broken server. Touching a source file does not recover
  it — the dev server must be restarted (`rm -rf .next && pnpm dev`). Verify a
  change either in the running dev server **or** with `build`, not both at once.

- 2026-09-18 — `pnpm test` passing does not mean the app compiles. Moving
  `lib/providers.tsx` → `providers/AppProviders.tsx` left one unresolved sibling
  import (`./api`), and all 82 tests still went green because no test mounts the
  provider stack — `pnpm typecheck` and `pnpm build` were the only things that
  caught it. After moving or renaming a module, `build` is the gate, not `test`.

- 2026-09-20 — `Modal` (`src/vendor/ui/kit/Modal.tsx:60`) pads its header and
  footer but renders `children` in a bare `<div style={{flex:1, overflow:"auto"}}>`.
  A consumer that forgets `padding: 24` on its own body wrapper gets fields flush
  against the dialog edge while the title and footer are inset — exactly what the
  conventions modal shipped with (`ConventionSkillModal/styles.ts:5`, fixed).
  Every other consumer (`CreateAgentModal`, `ConfirmModal`, `AddSkillModal`)
  carries `body: { padding: 24 }`; copy that line first when you build a modal.
- 2026-09-20 — Clicking a `Modal` by screenshot coordinates from the browser
  pane can land on the backdrop and silently close it (the backdrop is a
  full-screen `div` with `onClick={onClose}`, `Modal.tsx:22`). Drive modals with
  `find` refs and `form_input`, not coordinates from a scaled screenshot.

## Codebase Patterns

- 2026-09-20 — `Checkbox` in `src/vendor/ui/kit` is a `<button role="checkbox"
  aria-checked>`, not an `<input>`: in a test, `getAllByRole("checkbox")`
  returns buttons whose `.checked` is `undefined` — assert on
  `getAttribute("aria-checked")` (`ConventionSkillModal.test.tsx`).

- 2026-09-18 — The provider stack lives in `src/providers/`, not `src/lib/`
  (`AppProviders.tsx` + `theme` / `toast` / `repo-context`, re-exported by
  `index.ts`). `src/lib` is now only the API layer (`api.ts`, `hooks/*`) plus two
  shared modules, so the folder name finally describes its contents. Two rules
  keep it that way, both in `AGENTS.md`: cross-folder imports use `@/`, and
  `src/components` / `src/lib` may not import `src/app` (enforced by
  `no-restricted-imports` in `eslint.config.mjs`, core rule — this package has no
  `eslint-plugin-import`).

- 2026-09-18 — `src/lib/feature-models.ts` looks like a one-consumer module that
  should be demoted into `SettingsModels/`, and it should not be. Its header
  explains it is a hand-kept mirror of the server's `FEATURE_MODELS`, needed
  because importing a runtime *value* from `vendor/shared` breaks the webpack
  build. It is a cross-package sync point, so burying it seven folders deep would
  hide the "keep in sync" instruction from whoever changes the server registry.
  Placement rules lose to discoverability for contract mirrors.

- 2026-09-15 — There are two token formatters and they are not interchangeable:
  `formatTokens(in, out)` → `"8k→1.2k"` for the trace drawer
  (`src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/helpers.ts:27`)
  and `formatTokenCount(n)` → `"15.2K"` for one count
  (`src/components/run-cost-badge/RunCostBadge.tsx:33`). The second is
  deliberately NOT called `formatTokens` — same name, different arity is a trap.

- 2026-09-16 — `SEV` (`src/vendor/ui/primitives/tokens.ts:6`) is the canonical
  severity map: colour, background, icon **and** label in one place. Reuse it
  even when you cannot reuse `<SeverityBadge>` — that primitive renders
  label-then-count ("CRITICAL 2"), so a count-first pill hand-rolls the layout
  while still reading colours and icon from `SEV`. Three local `SEV_COLOR` copies
  already exist; do not add a fourth.
- 2026-09-16 — A pill's count and the cards it filters to are derived from the
  **same** `review.findings` array in `ReviewRunAccordion`
  (`.../_components/ReviewRunAccordion/ReviewRunAccordion.tsx:55`), which is why
  they cannot disagree. Counting from `agent_runs.findings_count` instead would
  reintroduce exactly the drift the denormalized `blockers` column already has.
- 2026-09-16 — A lazily-`enabled` hook is how to defer a fetch, not an effect.
  The PR-list hover preview calls `usePrReviews(prId)` with `enabled` tied to
  hover (`.../pulls/_components/PRRow/PRRow.tsx:60`); it is keyed
  `["reviews", prId]` — the same key the PR page uses — so hovering warms the
  cache and the click that follows renders with no second request.

- 2026-09-16 — Hover-preview state (anchor from `getBoundingClientRect()` plus a
  ~120 ms close grace period) lives in `useFindingsPreview`
  (`src/components/findings-preview/useFindingsPreview.ts`), shared by the PR
  list and the run timeline. The grace period is not polish: the card is
  `position: fixed`, so it is not a DOM child of its trigger and a plain
  `mouseleave` would snatch it away as the pointer crosses the gap. The card's
  own `onMouseEnter` calls `cancelClose` for the same reason.
- 2026-09-16 — The timeline's severity icons open the same preview on **hover**
  but stay inert to clicks — filtering belongs to the Review-runs card below.
  The handlers therefore go on the wrapping element, never on the chips
  (`.../RunHistory/RunHistory.tsx`), which is what keeps "icons are not
  clickable" true while hover works.

- 2026-09-18 — `src/lib/types.ts` is a re-export shim over `@devdigest/shared`,
  but it has already acquired one locally-declared interface, `PrRowView`
  (`src/lib/types.ts:38`). That is how a shim turns into a global types folder:
  `import { PrRowView } from "@/lib/types"` is indistinguishable at the call site
  from the contract re-exports around it, so nothing signals that this one is
  local and free to drift. A view model belongs with the view — keep the file a
  pure re-export and `AGENTS.md`'s "types come from `@devdigest/shared`" stays
  true by inspection.

- 2026-09-18 — `src/lib/hooks/index.ts` is the app's only `export *` barrel, and
  its own header comment blesses **both** `@/lib/hooks` and
  `@/lib/hooks/reviews` as correct. Both forms are live, so "who calls
  `useRunReview`?" is a two-grep question with no single right answer. Contrast
  the 30 `index.ts` files under `src/app`: every one re-exports a single
  component and none uses `export *` — that forwarding form is fine and should
  stay the pattern. Import the domain file directly in new code.

- 2026-09-18 — `AGENTS.md`’s "cross-folder imports use `@/`" splits on
  **sibling vs parent**, not on folder depth. In `TraceBody.tsx`
  (`src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:13`)
  a sibling component folder stays relative (`../TraceSection`) while the
  parent segment's own modules take the alias
  (`@/app/…/RunTraceDrawer/constants`, same file `:10`). The two forms sitting
  four lines apart is correct, not a half-done migration — read as
  "relative = same folder only", the compliant import gets filed as a
  violation.

- 2026-09-20 — `src/app/globals.css` is the app-owned seam for styling anything
  that `src/vendor/ui` renders, and the vendored tree already ships hook classes
  for it: `Markdown` emits `className="dd-md"`
  (`src/vendor/ui/primitives/Markdown.tsx:9`) and styles only `p`, `strong`,
  `code` and `a` inline, while the design system's base reset zeroes
  `h1,h2,h3,h4,p` margins (`src/vendor/ui/styles.css:205`). The result was
  rendered markdown with no heading hierarchy and unstyled lists on all five
  `Markdown` call sites. The fix is a `.dd-md …` block in `globals.css:26`, not
  an edit to the vendored primitive — `AGENTS.md` marks that tree do-not-touch,
  and `globals.css` already `@import`s it, so one app-side rule reaches every
  consumer.

- 2026-09-20 — `Modal` and `Drawer` in `src/vendor/ui/kit` render in place, not
  through a portal. A modal mounted *inside* a clickable card
  (`AgentCard` owns its delete `ConfirmModal`) therefore bubbles every click
  in it — Confirm, Cancel, the backdrop — up to the card's `onClick`, and the
  confirm dialog silently navigates into the editor. Wrap the modal in a
  `<div onClick={(e) => e.stopPropagation()}>` exactly as the card already
  does for its `Toggle`; or mount the modal in the parent list (`SkillsListView`
  owns `deletingId`), which is the cleaner shape when the parent already exists.

- 2026-09-20 — `Toggle` (`src/vendor/ui/primitives/Toggle.tsx`) has no
  `disabled` prop and the vendored tree is do-not-touch, so an inert toggle is a
  wrapper (`aria-disabled`, `title`, `SkillCard/styles.ts` `toggleDisabled`)
  **plus** a no-op `onChange`. The no-op is the part that matters: jsdom's
  `fireEvent.click` ignores `pointer-events: none`, so a test asserting "the
  toggle did nothing" only passes because the handler is swapped out
  (`SkillCard.tsx`, `ConfigTab.tsx`; both use the same style token).
- 2026-09-20 — `AddSkillModal` keeps each tab's form state inside the tab
  component and lets each tab render its own action row inside the body instead
  of lifting `canSubmit`/`submit` into a shared `Modal.footer`. Three sources with
  three different mutations do not want one footer; switching tabs discarding
  the draft is the intended semantics, not a bug (`AddSkillModal.tsx`).

## Tool & Library Notes

- 2026-09-16 — `@testing-library/user-event` is **not** installed; the suite uses
  `fireEvent` from `@testing-library/react` (`FindingCard.test.tsx:2`). Write new
  interaction tests with `fireEvent` rather than adding the dependency.
- 2026-09-16 — `eslint-plugin-react-hooks` v6 adds `set-state-in-effect`, which
  fires on the app's theme/localStorage hydration pattern in several places
  (`src/lib/theme.tsx:19`, `src/lib/repo-context.tsx:31`, …). It is `warn` in
  `eslint.config.mjs` — rewriting those is a separate, hydration-sensitive
  change. Do not silence the rule and do not half-fix it.

- 2026-09-16 — Screenshot coordinates from the Chrome MCP tools are NOT page
  coordinates. A page reporting `window.innerWidth` 1254 came back as a 1568-wide
  screenshot, so `hover` at a coordinate read off the image lands somewhere else
  entirely and a working popover looks broken. Verify a hover with
  `javascript_tool` (dispatch `mouseover`, then read `[role="tooltip"]`) or with
  an RTL test — do not conclude "regression" from a screenshot that shows nothing.

- 2026-09-20 — In the Claude desktop Browser pane, an emulated viewport wider
  than the pane **crops** the screenshot instead of scaling it: `resize_window`
  to 1440 then `screenshot` returns the leftmost 800 px, so a three-column card
  grid reads as one column and looks like a layout regression. `computer zoom`
  returns the whole page scaled down (region cropping is unsupported), so it is
  the way to see a wide layout. Confirm layout facts with `javascript_tool`
  (`getComputedStyle(grid).gridTemplateColumns`) rather than from the image.

- 2026-09-20 — `getByPlaceholderText("a
b")` never matches a multi-line
  placeholder: Testing Library normalises whitespace in the *element's*
  attribute before comparing, but not in the string you pass, so an exact
  match with an embedded newline is impossible. Query with a regex
  (`/Describe the rule/`) — `CreateSkillModal.test.tsx`.
- 2026-09-20 — When a test mocks `useXMutation` as `{ mutate }` and later
  invokes the captured `opts.onSuccess(...)` by hand, wrap that call in
  `act()`: it runs outside React's event path, so the `setState` it triggers
  (a toast, a close) is not flushed before the next `expect`. `fireEvent` is
  already wrapped; a callback you call yourself is not.

- 2026-09-20 — `IconName` (`src/vendor/ui/icons.tsx:167`) is `keyof typeof Icon`,
  and the `Icon` map exposes the lucide pencil only under the alias `Edit`
  (`icons.tsx:146-147`) — `icon: "Pencil"` typechecks nowhere even though the
  glyph exists. Use `"Edit"`. `ShieldAlert` does not exist either; `AlertOctagon`
  is the "blocked" glyph.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
