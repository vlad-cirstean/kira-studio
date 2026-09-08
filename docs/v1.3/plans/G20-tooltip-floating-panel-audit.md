# G20 — Floating-UI tooltip/floating-panel audit

> **What this phase is.** SPEC's G20 row already carries two layers of survey — an original pass
> (`packages/git-ui`'s 57 native `title` tooltips, 8 hand-rolled floating panels) and a
> 2026-09-08 correction from direct user testing (a second, separate CodeMirror-native tooltip
> mechanism the first pass missed entirely, plus an instruction to check *every* tooltip-producing
> mechanism in *every* module, not stop at whichever one a module's most common pattern happens to
> be). This plan re-runs that whole survey from scratch, against the tree as it stands after G19
> landed (`packages/kira-ui` now exists, real, and has already absorbed one of the eight floating
> panels as a side effect of an unrelated migration), and finds **two more previously-unnamed
> consumers of the buggy CodeMirror mechanism** (`GrpcRequestView.vue`, the SQL console's own
> schema hover) plus **a third bug class in the same family** (`@codemirror/lint`'s
> diagnostic-hover tooltip, used by `ConsoleView.vue`/`CellEditorView.vue`, shares the exact same
> missing-`parent`/uncoordinated-`z-index` defect as the hover tooltip SPEC named) — none of which
> the SPEC row's own correction had found yet, which is exactly the risk that correction warned
> about and this phase's own job is to close out for real.
>
> **The single most consequential finding, structurally**: the CodeMirror-native bug lives in
> exactly *one* file (`CodeMirrorHost.vue`'s `onMounted` extension list), not per-consumer. Every
> hover-tooltip and every lint-diagnostic-hover across this entire app shares one `EditorView`
> construction path. Fixing it there fixes all five known consumers (and every future one) with a
> five-line change, touching none of `editor/hover.ts`, `RequestBodyPane.vue`, `GrpcRequestView.vue`,
> or `console/sqlHover.ts` — which also happens to insulate this fix from the concurrent,
> unmerged content-formatting work landing in some of those same files (§6).
>
> **The second most consequential finding**: `RowContextMenu.vue`'s hand-rolled clamp — one of
> SPEC's original 8 floating panels — no longer lives where SPEC's row describes it. G19 (commit
> `38f1eb38`) promoted that exact clamp logic, unchanged, into `packages/kira-ui/src/
> KuiContextMenu.vue`, as a side effect of a migration that had nothing to do with this phase.
> That is good news, not a complication: the fix now needs writing in exactly one file to cover
> every context-menu call site across `packages/git-ui` at once, and it is already sitting in the
> one package this phase was always going to extend.
>
> Every claim below was re-verified against source read or a command run in this container on
> 2026-09-08, against `claude/feature-v1-3-headless-git` at `3245f018` (G19 fully landed, working
> tree clean) — not copied from SPEC's own row, which this document corrects in several places
> (counts, file locations, and the true scope of the CodeMirror mechanism).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `3245f018` — the tip of G19's own five
commits (`38f1eb38` toolbar/menu migration, `6e4c4b6e` graph polish, `1fe3cf9d` CONTRACT_VERSION
22→23, `38dde669` review-bar polish, `3245f018` the interaction test tier). `packages/kira-ui`
exists, is wired into the workspace, `typecheck`, and `test:unit`. Working tree clean, no other
agent running concurrently in this worktree.

**This is a planning-only phase.** No implementation, however small, happens in this document or
its authoring — every file this plan names is read, not edited. §6 explains why implementation
itself is deliberately deferred behind a separate, unmerged batch of work in
`apps/kira-studio/frontend`.

### 0.2 Scope

Every tooltip-producing and every viewport-anchored floating-panel mechanism across both
frontends (`packages/git-ui` + `packages/kira-ui`, and `apps/kira-studio/frontend`), per SPEC's
own corrected G20 row and its explicit instruction not to assume a module is clear because its
most common mechanism already checked out. Concretely:

1. **`packages/git-ui`'s native `title`/`:title` tooltips** — re-counted, migration designed.
2. **`packages/git-ui`'s 8 hand-rolled floating panels** (context menu, force-delete popup, 7
   anchored dropdowns) — re-verified against G19's own changes, migration designed.
3. **`apps/kira-studio/frontend`'s `v-tooltip` mechanism** — re-counted, re-confirmed clean.
4. **`apps/kira-studio/frontend`'s CodeMirror-native `hoverTooltip` mechanism** — the SPEC
   correction's own headline finding, investigated to its actual root and its actual full
   consumer set (larger than SPEC's row states — F3 below).
5. **Every other bespoke hover/floating mechanism found by direct search** — `AutocompleteField
   .vue`'s own point-anchored hover panel (found already-correct — F4), `@codemirror/lint`'s
   diagnostic-hover tooltip (found buggy, previously unnamed — F3).
6. **A real Playwright geometry/interaction test design**, extending the two tiers G16 and G19
   already built, proving flip/shift/escape-from-clipping actually work, not just asserting it.

### 0.3 Ground rules

- **Re-verify, don't inherit.** Every count and every file:line citation below was re-produced in
  this container against the current tree — SPEC's own numbers (57/19, 229/73) have already
  drifted since the survey that produced them, confirmed in F1/F2.
- **No implementation in this phase**, and no implementation begins until the separate, unmerged
  `apps/kira-studio/frontend` bug-fix batch named in the task is merged — §6 states exactly which
  files are at risk of having moved by then and what to re-check before touching them.
- **Fix the mechanism, not the call site**, wherever one mechanism serves many consumers (D7 is
  the clearest case: one `CodeMirrorHost.vue` change fixes five separate features).

---

## 1. Findings

### Tooltips

#### F1 — `packages/git-ui`'s native tooltips: 63 across 20 files, not 57 across 19

```
grep -rn 'title="|:title="' packages/git-ui/src --include=*.vue
```

reports **63 occurrences across 20 files** today:

| File | Count | File | Count |
|---|---|---|---|
| `App.vue` | 1 | `components/StashList.vue` | 4 |
| `components/AppToolbar.vue` | 5 | `components/TagList.vue` | 2 |
| `components/BranchPicker.vue` | 4 | `components/UndoButton.vue` | 2 |
| `components/CommitMeta.vue` | 4 | `components/review/ReviewCommentsPane.vue` | 4 |
| `components/DiffView.vue` | 4 | `components/review/ReviewCommitRow.vue` | 2 |
| `components/FileTree.vue` | 11 | `components/review/ReviewFilesPane.vue` | 2 |
| `components/LoadMoreButton.vue` | 1 | `components/review/ReviewView.vue` | 9 |
| `components/PullStrategyPicker.vue` | 1 | `components/RefreshButton.vue` | 1 |
| `components/RepoPicker.vue` | 1 | `components/RowContextMenu.vue` | 1 |
| `components/SearchBox.vue` | 3 | `components/StashDetailPane.vue` | 1 |

The drift from SPEC's 57/19 is real and explained: `StashList.vue`/`StashDetailPane.vue` (G17,
landed after the original survey) and the review-bar additions G19 D5–D12 made (`ReviewView.vue`'s
swap button, back button, and search-reveal button each carry a `title`) account for the six new
occurrences and the one new file. `RowContextMenu.vue`'s own single `title` is its `:title` prop
forward (a menu heading, not a hover tooltip — confirmed by reading the file, §1 F6) and is **not**
part of the 63 that need migrating to a real tooltip; it stays exactly as it is. **62, not 63, are
real tooltip-migration candidates** — recorded here as the corrected, load-bearing number for §3's
implementation table.

#### F2 — `apps/kira-studio/frontend`'s `v-tooltip`: 234 across 71 files, and it is still the correct path

```
grep -rl "v-tooltip" apps/kira-studio/frontend/src --include=*.vue   → 71 files
grep -ro "v-tooltip" apps/kira-studio/frontend/src --include=*.vue | wc -l   → 234
```

Drift from SPEC's 229/73 (more occurrences, fewer files) reflects ordinary churn elsewhere in the
app since the original survey, unrelated to this chapter. The mechanism itself
(`workbench/state/tooltip.ts`'s singleton controller + `AppTooltip.vue`, both built on
`theme/floatingPosition.ts`'s `computeFloatPosition`) is unchanged and re-confirmed correct: a
document-level `pointermove` hit-test against a `data-kira-tip` attribute, `position: fixed`,
teleported to `<body>` (`AppTooltip.vue:50`), positioned via `flip`+`shift`+`size` middleware,
`z-index: var(--kira-z-tooltip)` (`AppTooltip.vue:85`, `tokens.css:232`, value `400` — the top rung
of a real five-step ladder, `tokens.css:228-232`). No gap here; F12 below notes the one thing it
still lacks (a geometry regression test of its own).

#### F3 — The CodeMirror-native `hoverTooltip` bug is real, confirmed, and has more consumers than SPEC's row names

**The shared entry point.** `apps/kira-studio/frontend/src/editor/hover.ts`'s `buildHoverSource`
(the whole file, 47 lines) turns a plain `(doc, pos) => lines | null` lookup into a real
`HoverTooltipSource`. It builds its own `dom`/`Tooltip` object directly (`hover.ts:30-45`) — no
positioning or container logic of its own; that is entirely `@codemirror/view`'s job once the
source function returns.

**Every current consumer of that shared entry point**, found by grepping the two functions it
backs (`buildHoverSource` has exactly two callers):

1. `apps/kira-studio/frontend/src/api/state/variableCompletion.ts:234`'s `variableHoverSource` —
   consumed by:
   - `views/httprequest/RequestBodyPane.vue:197` and `:210` (SPEC's own named case — the request
     panel's raw/code body editors).
   - `views/grpcrequest/GrpcRequestView.vue:416` (the gRPC message editor's variable hover) —
     **not named anywhere in SPEC's G20 row**, found only by grepping every caller of
     `variableHoverSource` rather than trusting the one call site SPEC's own correction described.
2. `views/console/sqlHover.ts:140`'s `sqlHoverSource` (schema/column hover in the SQL console) —
   **also not named in SPEC's row**, consumed by `ConsoleView.vue` wherever it wires
   `CodeMirrorHost`'s `hoverSource` prop for a SQL connection.

**The root cause, confirmed at the exact call site.** `apps/kira-studio/frontend/src/editor/
CodeMirrorHost.vue:211-213`:

```ts
function resolveHover(): Extension[] {
  return props.hoverSource ? [hoverTooltip(props.hoverSource)] : [];
}
```

`hoverTooltip(...)` (imported at `CodeMirrorHost.vue:25`) is called with no second argument and no
sibling `tooltips({...})` extension anywhere in this file's `onMounted` extensions array
(`:236-268`). CodeMirror's own container default for a tooltip is the editor's own DOM node unless
a `tooltips()` facet with an explicit `parent` is supplied — confirmed against
`@codemirror/view@6.43.10`'s own source
(`node_modules/.bun/@codemirror+view@6.43.10/.../dist/index.cjs`, `function tooltips(config = {})`
at line 10291, exported as `exports.tooltips`).

**The clipping ancestors, confirmed at their exact source, and correcting SPEC's own file
attribution.** SPEC's row says the tooltip "stays nested inside two `overflow: hidden` ancestors
(`.cm-host`, `.request-pane`)" — true, but both rules live one and two files away from
`RequestBodyPane.vue` itself, not inside it:

- `apps/kira-studio/frontend/src/editor/CodeMirrorHost.vue:418-422` — `.cm-host { height: 100%;
  min-height: 0; overflow: hidden; }`, the direct wrapper every `CodeMirrorHost` instance renders
  into (`:414`).
- `apps/kira-studio/frontend/src/views/httprequest/HttpRequestView.vue:602-607` —
  `.request-pane { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }`, a
  further-up ancestor specific to the HTTP request view (the gRPC view and the console have their
  own, differently-named panes with the same `overflow: hidden` shape — not individually cited
  here since the fix does not depend on any one of them).

**The z-index, confirmed as a real, previously-unquantified coincidence, not a design.**
`@codemirror/view`'s own `baseTheme` hardcodes `.cm-tooltip { zIndex: 500 }` (same source file,
`EditorView.baseTheme({ ".cm-tooltip": { zIndex: 500, ... } })` at line 10566). This app's own
stacking ladder (`theme/tokens.css:228-232`) tops out at `--kira-z-tooltip: 400`. **500 already
sits above every token in the ladder today** — so a naive `parent: document.body` fix alone would
happen to render correctly, by an accident of two unrelated numbers, not by any stated
relationship. That is precisely the kind of coordination gap D7 below closes explicitly rather
than leaving as a coincidence a future re-numbering of either scale could silently break.

**A third, previously-unnamed consumer of the identical defect: `@codemirror/lint`'s own
diagnostic-hover tooltip.** `CodeMirrorHost.vue:194-209`'s `resolveLint()` wires
`linter(source, { delay: 400 })` (from `@codemirror/lint`) into `lintCompartment`
(`:250`), independently of `hoverCompartment`/`resolveHover()` (`:251`). `@codemirror/lint`'s
`linter()` extension shows a hover tooltip over a diagnostic's underline using the identical
`showTooltip`/CodeMirror-tooltip machinery `hoverTooltip()` uses — confirmed by the shared
`.cm-tooltip`/`.cm-tooltip-lint` class names both this app's own `theme.ts:136` and the library's
own base theme reference, and by the fact that `theme.ts:154`'s own comment already documents the
SQL hover and the lint tooltip sharing "the same `.cm-tooltip-lint` chrome." Both extensions are
subject to the identical container/z-index gap, since CodeMirror's tooltip container is configured
once per `EditorView` (the `tooltips()` facet), not per-extension. **Consumers**:
`views/shared/celleditor/CellEditorView.vue` and `views/console/ConsoleView.vue`
(`grep lintSource apps/kira-studio/frontend/src` — both wire it). Neither is named anywhere in
SPEC's G20 row; found only by asking "what else in this file shares the tooltip system" per the
row's own instruction to check every mechanism, not just the one already reported.

**CodeMirror's own tooltip positioning is already viewport-aware — this narrows the fix.**
`@codemirror/view`'s tooltip layer defaults `tooltipSpace` to `windowSpace` (confirmed,
`.../index.cjs:10304`) and already flips above/below and clamps horizontally against that space
(`:10466`, `:10537-10538`'s `cm-tooltip-above`/`cm-tooltip-below` toggling). **No Floating UI
dependency, and no new positioning algorithm, is needed for this mechanism** — the actual missing
pieces are exactly the two SPEC named: escape the clipping ancestors, and coordinate the z-index.
D7 below is scoped to precisely that, not a rewrite of CodeMirror's own placement logic.

#### F4 — A fourth mechanism found, and confirmed already correct: `AutocompleteField.vue`'s own point-anchored hover panel

Per SPEC's own explicit warning that a fourth mechanism might exist unfound, a full search was
run: every `mouseenter`/`mouseover` handler outside `v-tooltip`-carrying files
(`grep -rln "mouseenter\|mouseover" ... | xargs grep -L "v-tooltip"`) turned up exactly two files —
`shortcuts/CommandPalette.vue:82` and `theme/primitives/AutocompleteField.vue:439` — both plain
`activeIndex = i` hover-highlight for keyboard-equivalent list navigation, not tooltips.

But `AutocompleteField.vue` does carry its own, separate, genuinely bespoke hover mechanism —
found by a second search (`grep -n "hover" AutocompleteField.vue`), not the one the first search's
false positives pointed at: a **field-local floating tooltip for the `{{variable}}` token under the
pointer**, used by the URL and header-value plain `<input>` fields (`AutocompleteField.vue:269-338`,
its own doc comment at `:269-279` states why it cannot reuse the app-owned singleton — "it
hit-tests per *element*, never re-resolving within one input as the pointer crosses from ordinary
text onto a `{{ref}}`"). **Confirmed already correct**: `openHoverAt` (`:306-315`) calls the same
`theme/floatingPosition.ts`'s `computeFloatPosition`, anchored via `pointReference(x, y)` — the
identical Floating-UI-backed primitive `AppTooltip.vue` and `ContextMenu.vue` already use, just
with a virtual point reference instead of an element reference. **No gap, no migration needed** —
recorded here explicitly so this mechanism is not mistaken for an unaudited one later, closing the
exact risk SPEC's own correction called out.

#### F5 — No fifth mechanism found

Beyond F1–F4: `apps/kira-studio/frontend/src`'s remaining `title="..."` occurrences (`grep -rln`,
19 files) were spot-checked and are all **component `title` props** (`<Dialog title="Confirm">`,
`<FilterHistoryMenu title="Saved">`), not native HTML `title` attributes producing a browser
tooltip — a real, checked distinction, not an assumption. No `Popover`/`Dropdown`-named component
exists outside the four SPEC already confirms are Floating-UI-based
(`ContextMenu.vue`/`PopoverPanel.vue`/`AutocompleteField.vue`/`ErrorPopover.vue`); the app's two
`<select>`-named components (`api/MethodSelect.vue`, `api/EnvironmentSelect.vue`) are native
`<select>` elements with no custom floating panel at all, out of scope by construction (the browser
owns their positioning).

### Other floating panels with no/partial collision detection

#### F6 — `RowContextMenu.vue`'s hand-rolled clamp has moved: it now lives in `packages/kira-ui/src/KuiContextMenu.vue`, unchanged and unfixed

`RowContextMenu.vue` (current state, all 39 lines) is a thin, byte-forwarding wrapper over
`KuiContextMenu` — confirmed by reading the whole file: it defines no positioning logic of its own
at all, forwards `sections`/`x`/`y`/`label`/`title` straight through
(G19 D3b, commit `38f1eb38`).

The clamp logic SPEC's row describes as living in `RowContextMenu.vue` is now in
`packages/kira-ui/src/KuiContextMenu.vue:121-139` — moved verbatim by G19, not rewritten:

```ts
const style = ref({ left: `${props.x}px`, top: `${props.y}px` });
onMounted(() => {
  ...
  requestAnimationFrame(() => {
    const el = menuEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width - 4);
    const maxTop = Math.max(0, window.innerHeight - rect.height - 4);
    style.value = {
      left: `${Math.min(props.x, maxLeft)}px`,
      top: `${Math.min(props.y, maxTop)}px`,
    };
  });
});
```

Same defects as before the move: post-mount clamp only (a one-frame flash at the unclamped
position, since positioning happens inside `requestAnimationFrame` after first paint), no `flip`
(a menu near the bottom edge shrinks its top coordinate down against the edge rather than opening
upward), and no height cap (a menu taller than the viewport is clamped in position but never
capped in size, so it can still overflow the top of the screen with nothing to scroll it into
view — `.kui-menu-root`'s own `max-height` in `theme/controls.css` is unset).

**The good news, structurally**: this is now genuinely a one-file fix. `KuiContextMenu.vue` is the
only place this logic exists, and `grep -rl RowContextMenu packages/git-ui/src` still finds all 8
of its original consumers (`App.vue` ×3, `BranchPicker.vue`, `RefreshButton.vue`... — re-confirmed;
see full list in D3) plus every review-panel context menu G19 D7 added — every one of them inherits
whatever fix lands in `KuiContextMenu.vue` for free, with zero call-site changes, exactly as G19's
own wrapper design intended (though G19 itself did not touch the clamp math — it only relocated
it, confirmed by `git log -p -- packages/kira-ui/src/KuiContextMenu.vue` showing the clamp block
introduced verbatim in `38f1eb38`, no later commit touching those lines).

#### F7 — `App.vue`'s force-delete confirmation popup: still zero clamping, unchanged

`packages/git-ui/src/App.vue:1244-1252`:

```html
<div
  v-if="forceDeleteRefCandidate"
  class="kv-branch-force-delete kv-branch-force-delete--floating"
  :style="{ left: `${forceDeleteRefCandidate.x}px`, top: `${forceDeleteRefCandidate.y}px` }"
>
```

with `.kv-branch-force-delete--floating` (`App.vue:1378-1384`) contributing only
`position: fixed; z-index: 30;` — no `flip`, no `shift`, no clamp of any kind. Raw click-point
coordinates, unbounded. Confirmed byte-for-byte unchanged since SPEC's own survey (no commit since
touches these lines — `git log -p -- packages/git-ui/src/App.vue` around this range shows nothing
past the original `docs/plans/P7.md` W14 commit).

#### F8 — The 7 anchored dropdowns: confirmed unchanged, confirmed all click-triggered, and confirmed to carry an inconsistent, unmanaged z-index scale

All 7 re-verified, each with `position: absolute; top: calc(100% + Npx); left: 0` (or `right: 0`
for one) and zero `flip`/`shift`:

| File | Rule (line) | Anchor side | z-index |
|---|---|---|---|
| `components/BranchPicker.vue` | `.kv-branch-panel` (`:383-387`) | `left: 0` | `10` |
| `components/PullStrategyPicker.vue` | `.kv-pull-picker-panel` (`:169-173`) | `left: 0` | `30` |
| `components/RepoPicker.vue` | `.kv-repo-list` (`:168-171`) | `left: 0` | `10` |
| `components/review/BaseSelector.vue` | `.kv-base-panel` (`:226-229`) | `left: 0` | `10` |
| `components/AppToolbar.vue` | `.kv-push-menu` (`:372-376`) | `right: 0` | `30` |
| `components/SearchBox.vue` | `.kv-search-error` (`:386-389`) | (unset — inline) | `20` |
| `components/SearchResults.vue` | `.kv-search-results` (`:121-125`) | `left: 0` | `10` |

None of the 7 was touched by G19 — confirmed by reading each file's own recent history and by G19's
own plan (§0.1/§5 non-goals) explicitly scoping its migration to toolbar buttons and the context
menu only, never the dropdowns. All 7 are click/toggle-triggered (`BranchPicker.vue`'s own doc
comment at `:11` — "a plain right-click... opening the same menu" — and `PullStrategyPicker.vue`
`:104-141`'s `@click="toggle"`/`@click="runWith"` pattern, confirmed representative of all 7), a
materially different interaction model from the hover-triggered tooltip mechanism, though the
underlying positioning primitive (offset+flip+shift, computed against a trigger element) is the
same shape either way.

**New finding beyond SPEC's row**: the z-index column above (`10`, `10`, `10`, `10`, `20`, `30`,
`30`) is ad hoc and uncoordinated — `packages/git-ui` has **no `--kv-z-*` token ladder at all**
(`grep -rn "z-index" packages/git-ui/src` finds only bare integer literals, no custom property),
unlike `apps/kira-studio/frontend`'s own real five-rung `--kira-z-*` scale
(`tokens.css:228-232`). `packages/kira-ui/src/theme/controls.css:100`'s own `.kui-menu-root`
likewise hardcodes `z-index: 30`. Nothing has collided yet by luck of low panel-nesting depth in
this app, but there is no scale to reason from when a new floating surface (this phase's own
tooltip, `KuiTooltip`) needs to be told where it ranks.

#### F9 — `packages/kira-ui` has no floating-positioning utility and no `@floating-ui/dom` dependency yet

`packages/kira-ui/package.json`'s only runtime dependency is `vue` (confirmed, full file read).
`@floating-ui/dom@1.8.0` is a **root** `package.json` dependency (`package.json:88`), consumed
today only by `apps/kira-studio/frontend` via `theme/floatingPosition.ts` — and even that app does
not redeclare it in its own `frontend/package.json` (which lists only `@kira/api-core`), relying on
root hoisting. `packages/git-ui/package.json`, by contrast, **does** explicitly declare every real
dependency it uses (`vue`, `slickgrid`, `@vscode/codicons`, plus its three `workspace:*` siblings)
even where those are also root-level deps — the established convention for this workspace's
packages is explicit declaration, not implicit hoisting. **This corrects one assumption in SPEC's
own row**, which says "this phase adds it there" of `packages/git-ui` — the investigation below
(D1) places the new dependency on `packages/kira-ui` instead, since that is where the actual
positioning logic will live, matching `packages/git-ui`'s own already-established "depend on
`@kira/kira-ui`, not on the primitives it wraps" boundary from G19 D3.

#### F10 — The two existing extension-side Playwright tiers are the right home for new geometry cases, and neither has an edge-of-viewport case today

`apps/kira-studio-vscode/playwright.config.ts` (full file read) defines exactly two projects:
`webview-layout` (G16 D10 — pixel geometry against a dead transport, `tests/layout/
webview-layout.spec.ts`) and `webview-interaction` (G19 §4.2/§8.4 — DOM interaction over a
narrowly-scoped fake-transport fixture, `tests/interaction/`, backed by
`support/fakeReviewHost.ts`'s four hand-written wire responses). Neither file contains an
assertion that triggers a tooltip, a context menu, or a dropdown and checks its resulting
`getBoundingClientRect()` against the viewport — confirmed by reading both spec files in full.
`fakeReviewHost.ts` already stands up one real, rendered review row (`FAKE_SHA`) with a working
file tree — enough surface to anchor a context-menu/dropdown geometry case against without writing
a new fixture; the graph-panel side (`webview-layout`'s own dead-transport harness) has no rendered
row at all (F1 in G16: a dead transport renders nothing), so a git-ui tooltip/menu case needs either
a live row (extending the fixture, mirroring how G19 built `fakeReviewHost.ts` for exactly this
reason) or a synthetic DOM fixture that mounts just the primitive under test.

#### F11 — `apps/kira-studio/frontend`'s own `tests/ui/tooltips.spec.ts` has no edge-of-viewport case either

239 lines, one large test (`tooltips.spec.ts:108`), covering delay timing, disabled-control hints,
popover interaction and accessibility — confirmed via `grep -n "innerWidth\|innerHeight\|
getBoundingClientRect"` returning nothing. So even the mechanism already confirmed correct (F2) has
no regression proof that its own `flip`/`shift` middleware actually fires at a real edge — a gap
worth closing cheaply in this same phase, since it is exactly the class of bug this whole phase
exists to guard against, and the app already has a working geometry-capable tier (`ui`, webkit,
real bundle, `apps/kira-studio/playwright.config.ts:41-48`) to add it to.

---

## 2. Decisions

### D1 — `packages/kira-ui` gains its own, fresh floating-positioning module — `@floating-ui/dom` lands there, not in `packages/git-ui`

New `packages/kira-ui/src/floatingPosition.ts`: a **fresh implementation**, not an import across
the app boundary (the two frontends are separate apps with separate builds — SPEC's own framing,
restated in the task, rules out a cross-app import). It reimplements exactly the shape
`apps/kira-studio/frontend/src/theme/floatingPosition.ts` already proves out: `computeFloatPosition
(reference, floatingEl, opts)` (the `offset`→`flip`(optional)→`shift`→`size` middleware chain,
`strategy: 'fixed'`, writing `--kui-float-max-w`/`--kui-float-max-h` custom properties the same way
the app-side version writes `--kira-float-max-w`/`-h`) and `pointReference(x, y)` (the virtual
zero-size element for a click-point anchor). `packages/kira-ui/package.json` gains
`"@floating-ui/dom": "1.8.0"` as an explicit dependency (F9) — the exact pinned version already
used at the root, so both frontends' floating-ui behavior stays in lockstep even though the module
itself is duplicated, not shared.

Every other decision below (`D2`–`D5`) is built on this one module.

### D2 — `packages/kira-ui` gains `KuiTooltip.vue` + a `vKuiTooltip` directive; `packages/git-ui`'s 62 real tooltip candidates migrate onto it

New `packages/kira-ui/src/tooltip.ts` — a fresh, host-agnostic reimplementation of `workbench/
state/tooltip.ts`'s controller: a reactive `tooltipState` singleton, a document-level
`pointermove`-hit-test against a `data-kui-tip` attribute (mirroring `TIP_ATTR`), the same
delay/rearm timing shape (`TOOLTIP_DELAY_MS`/`TOOLTIP_REARM_MS`, values kept — 400ms/300ms are not
app-specific constants, they are a considered hover-ergonomics choice worth reusing as-is), and the
same dismiss set (pointerdown, keydown, focusout, scroll, window blur). `KuiTooltip.vue` —
`Teleport to="body"`, `position: fixed`, positioned via `D1`'s `computeFloatPosition`, `z-index:
var(--kui-z-tooltip)` (D6), `pointer-events: none`. Exported as `KuiTooltip` + `vKuiTooltip` from
`packages/kira-ui/src/index.ts`.

**One instance per webview document, not a cross-document singleton** — `packages/git-ui/src/
App.vue` mounts one `<KuiTooltip />` for the graph panel; `components/review/ReviewView.vue` mounts
a second, independent one for the review sidebar. This is not a compromise: G19 F3 already
established that two separate webview documents cannot share one singleton (a fact about `iframe`
document isolation, not about this mechanism specifically), and G16's own `mount()` design already
mounts per-root for the same structural reason.

**The `Structured` tooltip content shape (`TooltipContent`'s `title`/`meta`/`metaColor`/`body`) is
not ported.** Every one of the 62 candidate sites is a plain string (`title="Refresh"`,
`:title="branchName"`) — confirmed by reading every match in F1's table; `packages/git-ui` has no
column-type-badge-shaped tooltip content the way `apps/kira-studio/frontend`'s one `meta`-using
caller does. `vKuiTooltip` therefore accepts `string | null | undefined` only — a smaller, correct
surface for this package's one real need, not a speculative port of a feature nothing here uses.

62 native `title`/`:title` attributes across 20 files (F1, minus `RowContextMenu.vue`'s own
`:title` prop-forward) convert to `v-kui-tooltip="'...'"` / `v-kui-tooltip="expr"`. Per-file list
in §3.

### D3 — `KuiContextMenu.vue`'s hand-rolled clamp is replaced with `computeFloatPosition`, fixing every one of its ~10+ consumers at once

`packages/kira-ui/src/KuiContextMenu.vue:121-139`'s `requestAnimationFrame`/manual-`Math.min` block
is deleted and replaced with:

```ts
const style = ref({ left: '-9999px', top: '-9999px' }); // off-screen until measured, avoiding F6's one-frame flash
onMounted(async () => {
  ...
  const el = menuEl.value;
  if (el) {
    const { left, top } = await computeFloatPosition(pointReference(props.x, props.y), el, {
      flip: false,
      placement: 'bottom-start',
    });
    style.value = { left: `${left}px`, top: `${top}px` };
  }
});
```

`flip: false` — matching `apps/kira-studio/frontend/src/workbench/ContextMenu.vue`'s own,
already-shipped precedent for its identically point-anchored top-level menu
(`theme/floatingPosition.ts:21-25`'s own documented reasoning: a point anchor has no "other side"
to flip to, only edges to stay clear of — `shift` alone keeps the whole menu on screen by sliding
it up/left as needed). `size()` (already part of D1's middleware chain, always included) caps
`--kui-float-max-h`, which `.kui-menu-root` (`theme/controls.css`) gains a `max-height: var
(--kui-float-max-h, none); overflow-y: auto;` rule for — a real improvement over the pre-existing
clamp, which had no answer at all for a menu taller than the viewport (F6). §7 item 1 flags the
`flip: false` choice for a human's own judgment.

Every consumer — `App.vue`'s 3 (commit/ref/stash menus), `FileTree.vue`'s new one (G19 D7's
`buildFileRowMenu`), every `review/*` row menu, `StashList.vue`'s (G17) — inherits this with zero
call-site changes, since none of them touch `KuiContextMenu.vue` directly; they all go through
`RowContextMenu.vue`'s unchanged wrapper API (F6).

### D4 — `App.vue`'s force-delete popup gets `computeFloatPosition`, not a new component

`packages/git-ui/src/App.vue:1244-1252`'s raw `left`/`top` binding is replaced with a computed
style backed by `D1`'s `computeFloatPosition(pointReference(x, y), panelRef, { placement:
'bottom-start' })`, called from a small `watch` on `forceDeleteRefCandidate` (mirroring
`AppTooltip.vue`'s own `watch`-then-`nextTick`-then-position shape). No new component — this is a
one-off, single-use popup; wrapping it in a shared primitive for a single consumer would be
over-abstraction `packages/kira-ui`'s own scoping discipline (G19 D3's "scoped to exactly what the
item needs") argues against. `.kv-branch-force-delete--floating`'s `z-index: 30` becomes
`z-index: var(--kui-z-popover)` (D6).

### D5 — `packages/kira-ui` gains `KuiPopoverPanel.vue`; the 7 dropdowns wrap their existing content in it rather than being rewritten

New `packages/kira-ui/src/KuiPopoverPanel.vue` — a fresh reimplementation of `apps/kira-studio/
frontend/src/theme/primitives/PopoverPanel.vue`'s own shape: a full-viewport, `position: fixed`,
transparent backdrop (click-outside-closes, `@close` emitted), an `Escape` handler, `anchor: 'left'
| 'right'` and `width` props, positioned via `D1`'s `computeFloatPosition` against
`backdropEl.value.parentElement` (the trigger's own wrapper element — the same "no consumer needs
to pass an anchor element explicitly" trick the Kira Studio original already proves out,
`PopoverPanel.vue:24-40`'s own comment explains why this works), and a plain `<slot />` for
whatever the consumer wants to render inside.

Each of the 7 dropdowns (F8) keeps its own internal markup and interaction logic completely
untouched (filter inputs, keyboard nav, list rendering) — only the outer positioned `<div
class="kv-*-panel">` is replaced with `<KuiPopoverPanel :anchor="..." :width="...">...same inner
content...</KuiPopoverPanel>`, preserving each one's original anchor side (`left` for
`BranchPicker`/`PullStrategyPicker`/`RepoPicker`/`BaseSelector`/`SearchResults`, `right` for
`AppToolbar`'s push-menu) and approximate width. `SearchBox.vue`'s `.kv-search-error` (an
error message, not a list) uses the same component with a single text node as its slot content —
one primitive serving both shapes, matching `PopoverPanel.vue`'s own stated generality
("`ColumnsMenu`, `FilterHistoryMenu`, `ConsoleSavedMenu`, `PreviewCommandPanel`" — a menu, a
history list, a saved-item list and a command panel already share one wrapper in the app this
pattern is borrowed from). §7 item 2 flags this as a call worth a human's confirmation once real
diffs exist, in case one of the 7 turns out to have interaction logic more tightly coupled to its
current DOM shape than this plan's read of it found.

### D6 — A `--kui-z-*` ladder, bridged from each host, closing F8/F9's coordination gap

New tokens, defined in `packages/kira-ui/src/theme/controls.css`'s own doc comment (as a documented
contract, the same way the `--kui-*` sizing/color vocabulary already is) and supplied by each
host's bridge file:

| Token | Rung |
|---|---|
| `--kui-z-popover` | lowest — dropdowns, the force-delete popup |
| `--kui-z-menu` | above popovers — context menus |
| `--kui-z-tooltip` | highest — the new `KuiTooltip` |

`packages/git-ui/src/theme/kui-bridge.css` (G19's existing file) gains three new lines mapping
these to fresh literal values (`--kui-z-popover: 20; --kui-z-menu: 30; --kui-z-tooltip: 40;`) —
`packages/git-ui` has no existing `--kv-z-*` ladder to bridge *from* (F8), so this phase is the one
that establishes the values, not merely re-maps them; `theme/controls.css`'s hardcoded `z-index:
30` on `.kui-menu-root` and every dropdown's own ad hoc literal (F8's table) are replaced with
these tokens throughout. `apps/kira-studio/frontend/src/theme/kui-bridge.css` (G19's existing file)
gains the same three lines, mapped from the app's real `--kira-z-*` ladder (`--kui-z-popover:
var(--kira-z-popover); --kui-z-menu: var(--kira-z-menu); --kui-z-tooltip: var(--kira-z-tooltip);`)
— inert today (nothing in that app consumes a `packages/kira-ui` floating surface yet, same as
G19's own bridge file), proving the contract on both sides regardless, per G19 D3's established
"prove it, stay inert" pattern for this exact file.

### D7 — The CodeMirror hover-tooltip fix: one change, in `CodeMirrorHost.vue`, fixing all five known consumers

`apps/kira-studio/frontend/src/editor/CodeMirrorHost.vue`'s `onMounted` extensions array
(`:236-268`) gains one new, **unconditional** (not compartmentalized, not toggled by any prop — it
is infrastructure every host needs identically, not a feature) extension:

```ts
import { ..., tooltips } from '@codemirror/view'; // add `tooltips` to the existing import at :21-28
...
tooltips({ parent: document.body }),
```

placed once in the extensions array, alongside (not inside) `hoverCompartment.of(resolveHover())`
and `lintCompartment.of(resolveLint())` — a single `tooltips()` facet value governs the whole
`EditorView`'s tooltip container, regardless of which extension is producing a given tooltip, which
is exactly why one line here reaches every consumer in F3.

The z-index coordination (F3's "coincidence, not a design" finding) is closed with a second,
equally small addition — an `EditorView.theme()` override placed *after* the library's own
`baseTheme` in extension precedence (CodeMirror/style-mod's own documented rule: a later-registered
theme wins a same-selector conflict), most naturally folded into this file's existing
`kiraEditorTheme` (`theme.ts`) as a new top-level rule:

```ts
'.cm-tooltip': { zIndex: 'var(--kira-z-tooltip)' },
```

replacing the library's own hardcoded `500` with an explicit reference to this app's real,
already-top-rung token (`tokens.css:232`) — so the two numbers can never silently diverge again,
regardless of which one is renumbered first. §7 item 3 flags the *mechanism* of this override
(CodeMirror theme extension vs. a plain global CSS rule) as worth a second look once a real diff
exists, since this plan's read of style-mod's precedence rules is based on CodeMirror's documented
model, not a runtime-verified assertion made in this container.

**Nothing else changes.** `editor/hover.ts`, `RequestBodyPane.vue`, `GrpcRequestView.vue`,
`console/sqlHover.ts`, `CellEditorView.vue`, `ConsoleView.vue` are all read for evidence in F3 and
edited by **none** of this decision — the entire fix lives upstream of every one of them, in the
one file that constructs every `EditorView` in this app. This is deliberate, not incidental: §6
explains why it also happens to insulate this fix from the concurrently-landing, unmerged
content-formatting work in some of those same files.

### D8 — `apps/kira-studio/frontend`'s four already-confirmed-correct components get no migration

`ContextMenu.vue`, `PopoverPanel.vue`, `AutocompleteField.vue`'s two mechanisms (its listbox
dropdown *and* its point-hover panel, F4), `ErrorPopover.vue`, and `AppTooltip.vue`/`tooltip.ts`
itself: no edit, no rewrite, in this phase. D7 (CodeMirror) and D9 (test-only additions) are the
only changes this phase makes inside `apps/kira-studio/frontend`.

### D9 — New geometry cases land in the four tiers that already exist; no fifth tier is created

- `apps/kira-studio/tests/ui/tooltips.spec.ts` (F11) gains two new geometry cases: a tooltip
  triggered near the bottom edge of the viewport (proves `flip`), and one triggered near a
  horizontal edge (proves `shift`) — against `AppTooltip.vue`'s real, already-shipped mechanism,
  closing F11's own gap regardless of anything else in this phase.
- The same file (or a sibling spec in `tests/ui/`, decided at implementation time by which existing
  fixture is closer) gains one case reproducing the actual reported CodeMirror bug: a hover
  tooltip triggered inside a `RequestBodyPane`-shaped `overflow: hidden` container, asserting it
  renders outside/above that container (proves D7's `parent: document.body`) and above the
  toolbar element specifically (proves D7's z-index coordination) — a direct re-creation of the
  bug SPEC's own correction reported, not a synthetic stand-in for it.
- `apps/kira-studio-vscode/tests/layout/webview-layout.spec.ts` (F10) gains flip/shift cases for
  the new `KuiTooltip` against the dead-transport harness (a tooltip can be attached to any static
  element already in the pre-connect DOM — the toolbar's own buttons render with no backend).
- `apps/kira-studio-vscode/tests/interaction/` gains one new spec exercising `KuiContextMenu` and
  one exercising `KuiPopoverPanel`, both via `fakeReviewHost.ts`'s existing rendered review row
  (F10) — right-clicking near the bottom of a constrained viewport (proves the menu's own `shift`,
  D3) and opening a dropdown near a horizontal edge (proves `KuiPopoverPanel`'s `shift`, D5).

§7 item 4 flags the coverage-depth question (one representative case per mechanism vs. one per call
site) as a human call.

---

## 3. Implementation, file by file

### `packages/kira-ui` — new files

| File | Content | Decision |
|---|---|---|
| `package.json` | `+ "@floating-ui/dom": "1.8.0"` | D1 |
| `src/floatingPosition.ts` | **New** — `computeFloatPosition`, `pointReference`, `autoUpdate` re-export, `FLOAT_MAX_*_VAR` constants | D1 |
| `src/tooltip.ts` | **New** — `tooltipState`, `initTooltips()`, `vKuiTooltip` directive | D2 |
| `src/KuiTooltip.vue` | **New** — the floating element, `Teleport to="body"` | D2 |
| `src/KuiPopoverPanel.vue` | **New** — backdrop + slot + positioning | D5 |
| `src/KuiContextMenu.vue` | Clamp math replaced with `computeFloatPosition` | D3 |
| `src/index.ts` | `+ KuiTooltip, vKuiTooltip, KuiPopoverPanel, floatingPosition.ts exports` | D2, D5 |
| `src/theme/controls.css` | `.kui-menu-root` gains `max-height`; new `--kui-z-*` doc comment; `.kui-tooltip`/`.kui-popover-backdrop` rules added | D3, D6 |

### `packages/git-ui/src` — tooltip migration (62 sites, 20 files) and floating-panel migration

| File | Change | Decision |
|---|---|---|
| `main.ts` | Registers `vKuiTooltip` as `v-kui-tooltip`; mounts nothing new itself (App.vue/ReviewView.vue own their `<KuiTooltip>` instance) | D2 |
| `App.vue` | 1 `title`→`v-kui-tooltip`; force-delete popup repositioned (D4); mounts `<KuiTooltip />` | D2, D4 |
| `components/AppToolbar.vue` | 5 `title`→`v-kui-tooltip`; `.kv-push-menu` wrapped in `KuiPopoverPanel` | D2, D5 |
| `components/BranchPicker.vue` | 4 `title`→`v-kui-tooltip`; `.kv-branch-panel` wrapped in `KuiPopoverPanel` | D2, D5 |
| `components/PullStrategyPicker.vue` | 1 `title`→`v-kui-tooltip`; `.kv-pull-picker-panel` wrapped | D2, D5 |
| `components/RepoPicker.vue` | 1 `title`→`v-kui-tooltip`; `.kv-repo-list` wrapped | D2, D5 |
| `components/review/BaseSelector.vue` | `.kv-base-panel` wrapped | D5 |
| `components/SearchBox.vue` | 3 `title`→`v-kui-tooltip`; `.kv-search-error` wrapped | D2, D5 |
| `components/SearchResults.vue` | `.kv-search-results` wrapped | D5 |
| `components/DiffView.vue` | 4 `title`→`v-kui-tooltip` | D2 |
| `components/FileTree.vue` | 11 `title`→`v-kui-tooltip` | D2 |
| `components/LoadMoreButton.vue` | 1 `title`→`v-kui-tooltip` | D2 |
| `components/CommitMeta.vue` | 4 `title`→`v-kui-tooltip` | D2 |
| `components/RefreshButton.vue` | 1 `title`→`v-kui-tooltip` | D2 |
| `components/StashDetailPane.vue` | 1 `title`→`v-kui-tooltip` | D2 |
| `components/StashList.vue` | 4 `title`→`v-kui-tooltip` | D2 |
| `components/TagList.vue` | 2 `title`→`v-kui-tooltip` | D2 |
| `components/UndoButton.vue` | 2 `title`→`v-kui-tooltip` | D2 |
| `components/review/ReviewView.vue` | 9 `title`→`v-kui-tooltip`; mounts its own `<KuiTooltip />` | D2 |
| `components/review/ReviewCommentsPane.vue` | 4 `title`→`v-kui-tooltip` | D2 |
| `components/review/ReviewCommitRow.vue` | 2 `title`→`v-kui-tooltip` | D2 |
| `components/review/ReviewFilesPane.vue` | 2 `title`→`v-kui-tooltip` | D2 |
| `components/RowContextMenu.vue` | No change — its `title` prop-forward is not a tooltip (F1) | — |
| `theme/kui-bridge.css` | `+ --kui-z-popover/-menu/-tooltip` mapping | D6 |

### `apps/kira-studio/frontend/src` — the CodeMirror fix and its tests only

| File | Change | Decision |
|---|---|---|
| `editor/CodeMirrorHost.vue` | `+ tooltips` import; `+ tooltips({ parent: document.body })` in the extensions array | D7 |
| `editor/theme.ts` | `+ '.cm-tooltip': { zIndex: 'var(--kira-z-tooltip)' }` in `kiraEditorTheme` | D7 |
| `theme/kui-bridge.css` | `+ --kui-z-popover/-menu/-tooltip` mapping from `--kira-z-*` (inert — D6) | D6 |
| `tests/ui/tooltips.spec.ts` | `+` two edge-of-viewport cases (D9) | D9 |
| `tests/ui/*.spec.ts` (new or existing, decided at implementation) | `+` one CodeMirror-hover-escapes-clipping-ancestor case | D9 |

**Not edited**: `editor/hover.ts`, `views/httprequest/RequestBodyPane.vue`,
`views/grpcrequest/GrpcRequestView.vue`, `views/console/sqlHover.ts`,
`views/shared/celleditor/CellEditorView.vue`, `views/console/ConsoleView.vue` — every one of these
is read for evidence in F3 and needs no change under D7's design (§6 explains why this matters for
sequencing).

### `apps/kira-studio-vscode` — new test cases only

| File | Change | Decision |
|---|---|---|
| `tests/layout/webview-layout.spec.ts` | `+` `KuiTooltip` flip/shift cases | D9 |
| `tests/interaction/*.spec.ts` (new) | `+` `KuiContextMenu` and `KuiPopoverPanel` edge cases, via `fakeReviewHost.ts` | D9 |

### Root

| File | Change |
|---|---|
| `package.json` | No new workspace entries (`packages/kira-ui` already registered by G19); no script changes needed (`test:unit`/`test:webview` already cover the touched directories) |

---

## 4. Test plan

### 4.1 Unit tests (`bun run test:unit`)

`packages/kira-ui/src` is already in the glob (G19 D16). New pure-logic candidates, matching the
package's own `contextMenuModel.test.ts` precedent (promote what's genuinely pure, leave
DOM-attached controller logic to the browser tiers):

- `floatingPosition.ts` itself has no pure logic worth unit-testing beyond what `@floating-ui/dom`
  already tests upstream — `pointReference`'s own zero-size-rect shape is the one pure function in
  it, trivial enough that a dedicated test is optional (left to implementation-time judgment, not
  mandated here).
- `tooltip.ts`'s rearm-window arithmetic (`enterHost`'s `withinRearmWindow` calculation) is a
  candidate for extraction into a small pure function (`isWithinRearmWindow(now, lastCloseAt,
  rearmMs)`) purely so it gets a real test — the app-side `workbench/state/tooltip.ts` this is
  ported from has never had one either (confirmed: no `tooltip.test.ts` exists anywhere in this
  repo today), so this would be new coverage on both sides of the port, not merely parity.

### 4.2 The `test:webview` layout/interaction tiers (extends G16/G19's own tiers, per D9)

No new Playwright project — both new specs land inside the two existing projects
(`webview-layout`, `webview-interaction`), per F10's own finding that neither needs a third tier
invented for it. Concrete cases, each asserting `getBoundingClientRect()` in real pixels against
the real viewport, matching G16 D10's own stated bar ("the guard must measure pixels"):

1. **`KuiTooltip` near the bottom edge** (proves `flip`): a toolbar button near the bottom of a
   short viewport, hover-triggered (or focus-triggered, to avoid a real `pointermove` simulation
   dependency — decided at implementation time based on which Playwright API proves more reliable
   in this harness), asserting the tooltip's own bottom edge stays `<=` viewport height.
2. **`KuiTooltip` near a horizontal edge** (proves `shift`): the same shape at the left or right
   edge of a narrow viewport, asserting the tooltip's own left/right edges stay within `[0,
   viewportWidth]`.
3. **`KuiContextMenu` near the bottom edge**, via `fakeReviewHost.ts`'s rendered review row,
   right-clicked near the bottom of a short-viewport interaction-tier page — asserts the menu
   stays fully on-screen (proving `shift`, since D3 deliberately keeps `flip: false` to match
   `ContextMenu.vue`'s own precedent — §7 item 1).
4. **`KuiPopoverPanel` near a horizontal edge**, via one of the migrated dropdowns rendered in a
   narrow interaction-tier viewport, asserting `shift` keeps it on-screen.
5. **The CodeMirror hover escapes its `overflow: hidden` ancestor and sits above the toolbar** —
   the direct re-creation of the actual reported bug, run against `apps/kira-studio/frontend`'s
   own `ui` tier (webkit, real bundle) rather than the extension's tiers, since this bug lives
   entirely in that app: a `RequestBodyPane`-shaped fixture with a real `overflow: hidden`
   ancestor stack and a toolbar element positioned to overlap the tooltip's un-fixed position,
   asserting (a) the tooltip's rendered rect is not clipped by its ancestor's own rect and (b) its
   computed `z-index` places it above the toolbar element in paint order.

Case 5's harness needs a decision at implementation time — reuse `tests/ui/support/`'s existing
static-server-over-the-built-bundle pattern (the same shape `apps/kira-studio-vscode/tests/layout/
support/server.ts` already reimplements independently for its own module, per G16 D10's own
module-boundary reasoning) rather than a new one.

### 4.3 Not covered by any automated tier, and why

- **The real VS Code webview host's own default stylesheet** (matching G16 D10's own Tier 2/3
  split) — this phase's geometry assertions run against the same dead-transport/fake-transport
  harnesses G16/G19 already validated beat a faithful VS Code stylesheet replica; a real host still
  needs a human, same as G16's own Tier 3 items 11-17.
- **Real mouse-hover timing** (as opposed to the delay/rearm *logic*, covered by 4.1's extracted
  pure function) — Playwright's synthetic hover does not reproduce the real 400ms pause a human
  finger/mouse produces; the geometry cases above trigger the tooltip programmatically (dispatching
  the same state change a real hover would eventually produce) rather than waiting out the delay,
  matching how `tooltips.spec.ts`'s own existing delay-timing test already isolates that concern
  from these geometry ones.

---

## 5. Non-goals

- **No `apps/kira-studio/frontend` component rewrite beyond `CodeMirrorHost.vue`/`theme.ts`.** The
  four already-correct components (D8) are untouched.
- **No migration of `apps/kira-studio/frontend`'s own components onto `@kira/kira-ui`.** Same
  boundary G19 D3 already drew and this phase does not cross — the new `--kui-z-*` bridge mapping
  in that app's `kui-bridge.css` stays inert, proving the contract without anything consuming it.
- **No `KuiContextMenu` submenu support.** Unchanged from G19 D3's own non-goal — nothing this
  phase touches needs one; Kira Studio's own richer `ContextMenu.vue` keeps its submenu machinery
  unmigrated.
- **No `CONTRACT_VERSION` bump.** Every change in this phase is presentation-layer positioning —
  no wire shape, no RPC method, no FlatBuffers schema is touched anywhere in either package.
- **No behavior change to *what* a tooltip/menu/dropdown shows** — only *how* it is positioned and
  dismissed. The one deliberate exception is the App.vue force-delete popup and the 7 dropdowns
  gaining real flip/shift/clamp they never had, which is this whole phase's point, not scope creep.
- **No new Floating-UI-adjacent dependency beyond `@floating-ui/dom` itself** — no positioning
  library swap, no CSS anchor-positioning polyfill, nothing beyond what `apps/kira-studio/
  frontend` already proves out at the same pinned version.
- **No touch to any file under active work in the concurrent, unmerged batch** beyond what D7
  already isolates itself from by design — §6 is explicit about which files carry residual risk
  anyway and what to re-check before editing them.

---

## 6. Concurrent, unmerged work in `apps/kira-studio/frontend` — staleness risk for implementation

A separate, unrelated worktree/branch — not visible to this session, not merged anywhere — is
concurrently fixing a batch of real bugs in `apps/kira-studio/frontend`, two of which share file
territory with this plan:

- **Their item 9** ("align to left the dropdown in the api module... check other dropdown in the
  app as well and properly align them") touches dropdown alignment generally in that app. **This
  plan's own investigation (F5, D8) found `apps/kira-studio/frontend`'s floating dropdowns are all
  already routed through `PopoverPanel.vue`, which is already Floating-UI-based** — so their fix is
  very likely a prop-level `anchor: 'left' | 'right'` misconfiguration at one or more call sites
  *within* the already-correct mechanism, not evidence of a missing-Floating-UI gap this plan
  failed to find. D8's "no migration needed" conclusion should hold regardless of their fix — but
  it was reached against this session's own snapshot and **must be re-confirmed against the actual
  tree state at implementation time**, not assumed to still hold from this document alone.
- **Their item 6** ("the interpolated-variable tooltip's internal formatting... explicitly scoped
  to formatting/readability only, NOT the positioning bug, which was left for this phase") touches
  `editor/hover.ts`'s `buildHoverSource` and/or `RequestBodyPane.vue`'s own call site — the exact
  two files this plan's F3 reads for evidence. **D7's fix deliberately does not edit either file** —
  the entire CodeMirror fix lives in `CodeMirrorHost.vue`/`theme.ts`, upstream of both, specifically
  so it is structurally insulated from whatever content-formatting change lands there first. This
  was a real design choice (§2 D7's own closing paragraph), not a coincidence — but the *line
  numbers* this plan cites for `RequestBodyPane.vue:197`/`:210` and `hover.ts`'s own structure may
  have shifted by the time D7 is implemented, and should be re-grepped rather than trusted from
  this document.
- **`GrpcRequestView.vue` and `views/console/sqlHover.ts`** — this plan's own two newly-found
  consumers of the CodeMirror bug (F3) — are named in **neither** the SPEC row nor the concurrent
  branch's own item list. Lower staleness risk than the two above, but still worth a fresh
  `grep variableHoverSource\|sqlHoverSource` before implementation, since D7's whole value
  proposition (one fix, five consumers) depends on the consumer list actually being complete at
  implementation time.

**The general instruction, restated plainly**: every file:line citation in §1 is a snapshot dated
2026-09-08. Implementation of this plan must re-run this document's own greps/reads against the
tree's actual state before editing any file this section names, not trust the citations verbatim —
the same discipline G16 and G19 both already apply to their own pre-commit `git status`/`git
pull --rebase` checks, extended here to apply *before* implementation starts too, specifically
because of this named concurrent risk.

---

## 7. Calls that want a human eye

### 1. `KuiContextMenu`'s `flip: false` choice

D3 matches `apps/kira-studio/frontend`'s own `ContextMenu.vue` precedent — a point-anchored menu
relies on `shift` (clamp) alone, never opens on the opposite side of its anchor point. The
alternative (`flip: true`) would open the menu *above* the click point when there's no room below,
which is closer to how many native OS context menus behave, at the cost of the menu appearing to
jump to an unexpected side relative to where the user clicked. **Recommendation: keep `flip:
false`**, matching the one precedent this repo already has and shipped — but this is a debatable
UX call, not a proven-correct one, and a reviewer who prefers native-menu-like flip behavior should
say so before implementation locks it in.

### 2. Whether all 7 dropdowns genuinely fit one `KuiPopoverPanel` wrapper

D5 assumes every one of the 7 (F8) can wrap its existing internal markup in a generic
backdrop+slot+position component with no change to that markup's own interaction logic — modeled
on `PopoverPanel.vue` already serving four visually different consumers in the app this pattern is
borrowed from. **Recommendation: proceed as designed**; if one of the 7 turns out, once a real diff
is attempted, to have positioning-coupled interaction logic (e.g. a keyboard-nav handler that reads
its own DOM ancestor chain in a way `KuiPopoverPanel`'s wrapper would break), special-case that one
file rather than block the other 6 or redesign the shared component around its one exception.

### 3. The CodeMirror z-index override's mechanism

D7 chooses an `EditorView.theme()` extension (added to `kiraEditorTheme`) over a plain global CSS
rule with `!important`, reasoning from CodeMirror/style-mod's documented extension-precedence
model (a later-registered theme overrides `baseTheme`). **Recommendation: proceed with the
`EditorView.theme()` approach** — it avoids the one `!important` this fix would otherwise be the
sole user of in an app that has so far avoided it entirely (matching G16 D2's own stated aversion)
— but this plan's confidence in style-mod's precedence behavior is based on reading CodeMirror's
own documented model, not a runtime-verified assertion made inside this container; implementation
should confirm the override actually wins before committing to it, and fall back to the `!important`
rule (recorded here as the named fallback, not a silent surprise) if it does not.

### 4. How deep the new geometry coverage should go

D9/§4.2 lists five new cases — one representative per *mechanism* (`KuiTooltip`, `KuiContextMenu`,
`KuiPopoverPanel`, plus the CodeMirror-specific case) rather than one per call site (which would be
`KuiTooltip` ×20 files, `KuiContextMenu` ×10+ consumers, `KuiPopoverPanel` ×7 dropdowns — a much
larger, much slower suite). **Recommendation: one representative case per mechanism**, trusting
that a shared positioning primitive behaves identically at every call site once proven correct at
one of them — matching this chapter's own established discipline (G16 D11 tested `Walk.Stream`'s
fix once, not once per RPC method that triggers a re-stream). A reviewer who has been burned by a
call-site-specific CSS override silently defeating a shared primitive's positioning before should
weigh in here specifically, since that is the one way "test the mechanism once" could give false
confidence.

### 5. Shared package vs. a direct `@floating-ui/dom` dependency in `packages/git-ui` itself

Resolved in this plan (D1/D2) in favor of the shared-package route — `packages/kira-ui` gains the
positioning module and the tooltip component, `packages/git-ui` only ever imports `@kira/kira-ui`.
Reasoning: (a) this is the exact pattern G19 just established for cross-cutting primitives
(`KuiButton`/`KuiContextMenu`), landing a second, unrelated implementation of the same middleware
chain directly in `packages/git-ui` would fork a pattern this repo just consolidated; (b) it makes
the mechanism available to a future host for free, matching SPEC's own "deliberately a stepping
stone" framing for this chapter's session/transport layer; (c) the `--kui-*` token-injection
contract already exists specifically to host components like this one. **Recommendation is
unambiguous** — flagged here only because the investigation instructions explicitly asked the
question be surfaced, not because real doubt remains.

### 6. Should `KuiTooltip` and `KuiPopoverPanel` share more than the positioning primitive?

Considered and declined in this plan — a single "floating surface" base component both `KuiTooltip`
(hover-triggered, delay/rearm timing, `pointer-events: none`) and `KuiPopoverPanel`
(click-triggered, backdrop, `Escape`-to-close) extend would need close to as many escape hatches as
the two currently-separate mechanisms already have in `apps/kira-studio/frontend`, where
`AppTooltip.vue`, `PopoverPanel.vue` and `ContextMenu.vue` all independently call the same
`computeFloatPosition` function without sharing a common wrapper component above it.
**Recommendation: keep them separate**, matching that established precedent over inventing a new
abstraction this phase does not need — but noted here since "one floating-surface base class" is a
reasonable-sounding idea a reviewer might otherwise expect to see and not find.
