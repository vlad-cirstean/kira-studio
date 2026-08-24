# P22 — App-owned tooltips

> Not an original SPEC.md §10 deliverable line — P22 is user-directed, reported against shipped
> work. The ask, verbatim: *"the toolbar buttons and buttons in general don't show the hint when
> mouse is over them. for all these hints, show them in an app owned element, not with the system
> one"*. Added to §10 as a historical record of what shipped and when, the same way P13's and P16's
> rows exist despite not mapping to one original spec sentence.
>
> **Why a new phase and not an addendum.** The two addendum precedents in this repo are P18 §9
> ("every item below is either a defect in what §4 step 4 shipped or the other half of a line this
> plan already owns") and P19 §9 (one of that plan's own §8 open questions, resolved). Neither test
> passes here: the native `title` attribute was not introduced by any one phase — it accreted across
> P0–P21 in 34 files (F1) — and no existing plan owns a line about hover hints. The closest hook is
> **P16 §4's D4**, which already concluded, for one widget, that *"a native tooltip is unreadable for
> anything beyond one short line, isn't reachable on touch, and can't be copied"*, and P16's §11
> non-goals which left `.status-dot`'s tooltip as *"a documented follow-up, not done here"*. That is
> a precedent to cite (D1), not a document to append to: P16's SPEC row is a closed past-tense
> record of a six-item batch, and this phase is app-wide, adds a primitive, a directive and a global
> controller, and changes 123 call sites in one sweep.
>
> Nothing in this phase touches an adapter, the engine host, IPC, storage or any tab schema. Every
> change is renderer-side.

## 0. Ground rules for this phase

- **Not one hint may be lost, and not one may become less accessible.** Every one of the 123 `title`
  attributes (F1) either becomes a `v-tooltip` or is named here with a reason. The native `title`
  is also the *accessible name* of most icon-only buttons in this app today (F6) — removing it
  without replacing that name would trade a rendering bug for a screen-reader bug. D7 is where that
  is written down, and it is mechanical, not per-site judgment.
- **The tooltip must never be able to intercept a click.** The user's report is about buttons; a
  tooltip that eats the press it is describing would be strictly worse than no tooltip. The
  surface is `pointer-events: none` and lives in a `Teleport`, never inside the trigger (D4).
- **One controller, one listener set, one floating element.** Not 123 components each with their
  own `mouseenter` timer. `workbench/ContextMenu.vue` + `workbench/state/contextMenu.ts` is the
  established shape for exactly this (F7) and this phase copies it rather than inventing a second.
- **A disabled button is where the hint matters most.** A dozen of these titles exist purely to
  explain *why* a control is disabled (F5). Any design that hangs listeners off the trigger element
  silently drops exactly those — D3 exists for this reason and nothing else.
- **No new dependency.** No Floating UI, no Popper, no tippy. `ErrorPopover.vue`'s own 12-line
  `position()` already solves anchoring in this codebase (F8) and is the thing to mirror.
- **Reuse `.p-float`.** The completion popup, the lint tooltip, the context menu, every popover and
  every dialog are the same primitive bound to the same tokens. P18's D12 is the standing rule —
  *"a default-styled popup would be the only piece of un-themed chrome"* — and a tooltip is not the
  place to break it.
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint gets one line at its implementation site, not a paraphrase.
- Run `bun run lint`, `bun run typecheck` and `bun run build` throughout; `xvfb-run -a bun run
  test:ui` from step 3 on. `bun run test:db` is untouched by this phase — no adapter changes.

## 1. Findings (verified against the tree and `node_modules`, not assumed)

**F1 — the app has no tooltip of its own; every hint is the native `title` attribute, 123 of them
in 34 files.** `grep -rnoE '(^|[^-a-zA-Z:])(:?title)=' src/renderer` returns exactly **129** hits.
Six of those are **component props**, not HTML attributes, and must not be touched: `DialogFrame`'s
`title` prop (`SettingsDialog.vue:104`, `FiltersDialog.vue:101`, `ConnectionDialog.vue:215`) and
`SavedListMenu`'s (`ConsoleSavedMenu.vue:103`, `FilterHistoryMenu.vue:143`,
`StreamFilterHistoryMenu.vue:72`). That leaves **123 real `title` attributes**:

| File | n | File | n | File | n |
|---|---|---|---|---|---|
| `views/documents/DocumentView.vue` | 15 | `views/grid/SearchToolbar.vue` | 6 | `theme/primitives/TextField.vue` | 2 |
| `views/grid/DataToolbar.vue` | 14 | `workbench/StatusBar.vue` | 5 | `project/FiltersDialog.vue` | 1 |
| `views/stream/StreamView.vue` | 10 | `project/ConnectionDialog.vue` | 3 | `workbench/panels/ProjectPanel.vue` | 1 |
| `views/keyvalue/KeyValueView.vue` | 10 | `workbench/panels/OperationsPanel.vue` | 3 | `views/stream/StreamComposeMessage.vue` | 1 |
| `views/celleditor/CellEditorView.vue` | 8 | `views/stream/StreamSearchToolbar.vue` | 3 | `views/grid/PreviewCommandPanel.vue` | 1 |
| `views/keyvalue/KeyValueSearchToolbar.vue` | 6 | `views/grid/FilterToolbar.vue` | 3 | `views/grid/ColumnsMenu.vue` | 1 |
| `views/documents/DocumentSearchToolbar.vue` | 6 | `views/console/ConsoleView.vue` | 3 | `views/definition/ConstraintsSection.vue` | 1 |
| `workbench/panels/ViewChrome.vue` | 2 | `project/TreeRow.vue` | 3 | `views/definition/ColumnsSection.vue` | 1 |
| `views/shared/SavedListMenu.vue` | 2 | `views/shared/FilterHistoryMenu.vue` | 1 | `theme/primitives/SegmentedControl.vue` | 1 |
| `views/grid/DataGrid.vue` | 2 | `views/console/ConsoleSavedMenu.vue` | 1 | `theme/primitives/RunState.vue` | 1 |
| `views/definition/DefinitionView.vue` | 2 | `views/console/ConsoleResultGrid.vue` | 2 | `project/SearchBox.vue` | 1 |
| | | | | `project/ColorPicker.vue` | 1 |

**103 of the 123 sit on an interactive control** (a `<button>`, an `IconButton`, an `AppButton`, a
`SegmentedControl` option, a `role="radio"` swatch). The other **20 sit on non-interactive text**
and are the "hover to see the untruncated value / the status detail" idiom:
`OperationsPanel.vue:237,240`, `StatusBar.vue:37,45`, `KeyValueView.vue:618,629,633`,
`views/definition/ColumnsSection.vue:68`, `DataGrid.vue:999,1097`, `FilterToolbar.vue:182`,
`StreamView.vue:744`, `CellEditorView.vue:351,405`, `ConsoleResultGrid.vue:164,189`,
`DocumentView.vue:727`, `TreeRow.vue:105,112`, `RunState.vue:26`. D2 takes both groups.

**F2 — neither button primitive declares a `title` prop; every one arrives by attribute
fallthrough, and both primitives are single-root.** `IconButton.vue:4-5` says so in its own comment
(*"Every other native attribute (disabled, title, aria-label, data-testid, @click, class) reaches
the `<button>` by fallthrough"*) and its template root is one `<button>` (`:21-29`).
`AppButton.vue`'s root is likewise a single `<button>` (`:21-32`), with no `inheritAttrs: false`
anywhere in `src/renderer`. **This is what makes a directive viable**: Vue 3 applies a custom
directive placed on a component to that component's single root element, so `<IconButton
v-tooltip="'Refresh'" />` lands the directive on the real `<button>`, exactly where `title=` lands
today. (`AppButton.vue` is the file formerly named `Button.vue`; commit `012a9ba` renamed the
single-word primitives to satisfy the Vue multi-word component lint. Historical plan docs still say
`Button.vue` — the current file is the authority, and the same lint rule is why D5 names the new
component `AppTooltip.vue` and not `Tooltip.vue`.)

**F3 — why the native tooltip is unreliable here, and why the remedy does not depend on picking one
cause.** Three mechanisms are in play, of which two are verifiable in this tree and one is not:

- *(a) Verifiable, in-tree: any open overlay swallows the hover.* `PopoverPanel.vue:87-91`'s
  `.menu-backdrop` is `position: fixed; inset: 0; z-index: 20` — a full-viewport transparent sheet
  mounted for the whole life of every `ColumnsMenu` / `FilterHistoryMenu` / `ConsoleSavedMenu` /
  `PreviewCommandPanel` / stream partition menu. `DialogFrame.vue:104-112`'s `.scrim` is the same
  shape at `z-index: 100`. While either is up, the element under the cursor is the sheet, so no
  toolbar button beneath it has a `title` to report. This is real, it is narrow, and it is not the
  whole story.
- *(b) Verifiable, in-tree: nothing in the app suppresses hover globally.* Checked and ruled out, so
  the plan does not chase a phantom: there is no `pointer-events` declaration anywhere in
  `src/renderer` (grep: zero hits), no `-webkit-app-region`, and the only global `user-select: none`
  is `base.css:62` on `body`, which does not affect tooltips. The one shared ticker that could
  re-render a toolbar under the cursor — `state/runState.ts:7-21`'s 200 ms `setInterval` — is armed
  **only while an op is running** (`opsState.records.some(r => r.status === 'running')`) and is
  cleared otherwise, and Vue writes an attribute only when its value actually changed, so idle
  toolbars are not being churned.
- *(c) Not verifiable from this tree, and deliberately not relied on: the platform delay.* The app
  is macOS-only (SPEC.md:16; `package.json` ships only `package:mac`), where Electron surfaces
  `title` through AppKit's own tooltip machinery. Its initial delay is a user default, not
  something a page or a `BrowserWindow` option can set — `main/window.ts:13-26` has no knob for it
  and there is none to add. A hint the user has to hold still for a second or more to see is,
  functionally, a hint that does not show.

The important consequence is that **(a) and (c) have the same remedy and (c) cannot be fixed any
other way**: the app must own the element. That is also, independently, what was asked for. The
plan therefore states the diagnosis honestly and does not stake the phase on it.

**F4 — the delay this app should use is already in this app.** `editor/CodeMirrorHost.vue:111-113`
runs the lint hover tooltip at `delay: 400`, with its own comment recording that the number was
chosen deliberately rather than inherited. 400 ms is inside the 300–500 ms band VS Code uses for
its own hover chrome, and reusing it means the app has one hover-pause constant instead of two
that differ for no reason (D6).

**F5 — a disabled button dispatches no mouse events, and a dozen hints live only on disabled
buttons.** Blink does not dispatch `mouseover`/`mousemove`/`pointerover` on a disabled form
control — the event is retargeted to the nearest enabled ancestor — which is why the folk remedy is
to wrap a disabled button in a `<div>` just to hang a tooltip on it. Hit testing is unaffected, so
the *native* `title` still works there today. The sites that would silently regress under a naive
`@mouseenter` implementation, each of which exists specifically to explain a disabled state:
`DataToolbar.vue:278` (`'Count rows first'`), `:341`/`:348`/`:372` (`'Connection is read-only'`),
`StreamView.vue:501` (`'Select a message first'`), `DocumentView.vue:565` (`'Connection does not
support insert'`), `KeyValueView.vue:491`/`:527`/`:560` (`addTitle`/`editTitle`/`deleteTitle`, which
resolve through `writeDisabledReason()` at `:164` to `'Not supported for this connection type'` or
`'Connection is read-only'`), `CellEditorView.vue:382`/`:391`/`:399` (`beautifyIndentedTitle` /
`beautifyCompactTitle` / `resetDisabledTitle`), `ColumnsMenu.vue:129` (`'Primary key — always
shown'`), and `ViewChrome.vue:61`/`:71` (Refresh/Stop, both `:disabled`-bound). D3 is built around
this and nothing else.

**F6 — `title` is currently the accessible name of most icon-only controls.** `src/renderer` has
**18** `aria-label` attributes against 123 `title`s, and exactly **seven** elements carry both —
`ProjectPanel.vue:42-48` (note the two strings differ: `aria-label="Add connection"` vs
`title="New connection"`), `StatusBar.vue:79-85`, `ConnectionDialog.vue:387-388`,
`SearchBox.vue:22-23`, `TreeRow.vue:96-97`, `ColorPicker.vue:20-21` and `FiltersDialog.vue:138`.
Every `IconButton` renders a codicon glyph and no text (`IconButton.vue:27`), so with `title`
removed and nothing put back, ~100 buttons would have **no accessible name at all**. This is the
single largest risk in the phase; D7 is its answer, and those seven elements are the cases its
"only where there is nothing to overwrite" clause must leave alone.

**F7 — the app already has the exact architecture this needs, twice.**
`workbench/ContextMenu.vue` is a singleton mounted once in `App.vue:50`, `Teleport`ed to `body`,
driven by a `reactive` module (`workbench/state/contextMenu.ts:23-39`) with `open`/`x`/`y`/`items`
and two functions, positioned `fixed` with a viewport clamp, and closed on
`document` `mousedown` (capture), `Escape`, capture-phase `window` `scroll` and `window` `blur`
(`ContextMenu.vue:44-56`). `ErrorPopover.vue:4` says outright that it *"Mirrors ContextMenu.vue's
Teleport/fixed-position/outside-click-closes pattern."* A third instance of that pattern is the
consistent move, not a new invention.

**F8 — the anchoring maths to copy is 12 lines and already written.**
`ErrorPopover.vue:17-29`'s `position()`: `await nextTick()`, read the trigger rect and the popover
rect, place at `left = t.left`, `top = t.bottom + 4`, clamp `left` into
`[4, innerWidth - p.width - 4]`, and flip to `t.top - p.height - 4` when it would overflow the
bottom. That is exactly a tooltip's placement policy. `PopoverPanel.vue:42-54` is the same idea for
trigger-anchored menus and additionally re-runs on `window` `resize`.

**F9 — `src/renderer` has no custom directive today, and registering one is a single line.**
`main.ts:60` is `createApp(App).mount('#app')`; grep for `directive` in `src/renderer` returns only
`IconButton.vue`'s prose comment. So `createApp(App).directive('tooltip', vTooltip).mount('#app')`
is the whole registration, and `v-tooltip` cannot collide with anything.

**F10 — the z-index ladder is implicit and has no room problem.** Every `z-index` in
`src/renderer`, ascending: 1–3 (grid sticky headers/gutter, `DataGrid.vue:1165,1173,1254,1273,1405`;
`StreamView.vue:892`; `VirtualList.vue:90`), 20 (`PopoverPanel.vue:90`'s backdrop), 30
(`ConsoleSavedMenu.vue:164`, `FilterHistoryMenu.vue:221` inner surfaces), 100 (`DialogFrame.vue:111`
scrim, `CommandPalette.vue:95`), 200 (`ContextMenu.vue:172`, `ErrorPopover.vue:123`,
`AutocompleteField.vue:263`). Nothing uses 300 (D4).

**F11 — seven existing UI assertions read `title` as a data channel, not as chrome.** They must be
retargeted in the same commit, and they are the reason a "leave `title` alongside" compromise is
not needed: `data-view.spec.ts:203-213` (`toolbar-count`'s title carries the row count, asserted
against `/1,000,000/`), `mutations.spec.ts:222-253` (same button, three reads), `leaks.spec.ts:215`
(`'Count all rows'`), `mariadb.spec.ts:143`, `s3.spec.ts:194-197`
(`'Not supported for this connection type'`), `cell-editor.spec.ts:670-673` (`/./` — that the
beautify button has *any* tooltip once enabled), `preconnect.spec.ts:104-105,190`
(`.status-dot`'s title carries the pre-connect failure text). Each is one token: `'title'` →
`'data-kira-tip'`.

**F12 — the design system's floating surface and its tokens.** `.p-float`
(`theme/primitives.css:428-434`) is `background: var(--kira-bg-elevated)`, `border:
var(--kira-border-width) solid var(--kira-border-strong)`, `border-radius: var(--kira-radius)`,
`box-shadow: var(--kira-shadow-dialog)`, `overflow: hidden`. The tooltip is that class plus a
`max-width`, `--kira-t-sm` type, `--kira-fg` text and `white-space: pre-wrap` — no new tokens.

## 2. Shapes introduced in this plan

```ts
// src/renderer/workbench/state/tooltip.ts   (state + directive + controller — the whole mechanism)

/** F4/D6: the app's one hover-pause constant, shared with the editor's lint tooltip. */
export const TOOLTIP_DELAY_MS = 400;
/** Move between two hinted controls inside this window and the next tooltip opens with no delay —
 *  scanning a toolbar shouldn't re-pay the pause per button (D6). */
export const TOOLTIP_REARM_MS = 300;

/** The attribute the directive writes and the controller reads. Also the Playwright handle that
 *  replaces `title` in the seven specs of F11. */
export const TIP_ATTR = 'data-kira-tip';

export const tooltipState = reactive({
  text: '' as string,
  open: false,
  /** Viewport coordinates, already clamped/flipped by the controller (F8). */
  x: 0,
  y: 0,
  /** Set while open, for AppTooltip.vue's id and the trigger's aria-describedby (D7). */
  id: null as string | null,
});

/** Registered once in main.ts as `v-tooltip` (F9). Writes/updates/removes TIP_ATTR, applies D7's
 *  accessible-name rule on bind, and hides the tooltip if the bound element is unmounted while
 *  showing it. Value `''`/null/undefined removes the attribute — a conditional hint is expressed
 *  by the bound expression, never by v-if on the directive. */
export const vTooltip: ObjectDirective<HTMLElement, string | null | undefined>;

/** Installs the single document-level listener set (D3). Called once from App.vue's onMounted,
 *  next to the existing control.on* subscriptions; returns its own teardown for leaks.spec.ts. */
export function initTooltips(): () => void;
```

```vue
<!-- src/renderer/workbench/AppTooltip.vue — the singleton surface, a sibling of <ContextMenu /> -->
<!-- Teleport to body, `.tooltip p-float`, position: fixed, z-index: 300, pointer-events: none,
     role="tooltip", :id="tooltipState.id" (D4/D7). -->
```

**A call site, before and after.** The whole migration is this edit, 123 times:

```html
<!-- before -->
<IconButton icon="refresh" :size="13" title="Refresh" :data-testid="refreshTestid" ... />
<AppButton :title="isWritable ? 'Add a row' : 'Connection is read-only'" :disabled="!isWritable" ...>
<span class="label" :title="row.name">

<!-- after -->
<IconButton icon="refresh" :size="13" v-tooltip="'Refresh'" :data-testid="refreshTestid" ... />
<AppButton v-tooltip="isWritable ? 'Add a row' : 'Connection is read-only'" :disabled="!isWritable" ...>
<span class="label" v-tooltip="row.name">
```

`title="X"` → `v-tooltip="'X'"`; `:title="expr"` → `v-tooltip="expr"`. No component gains a prop,
no template gains a wrapper element, no handler is touched.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The app owns the tooltip; the native `title` attribute is removed from `src/renderer` entirely, with zero exceptions.** A final grep for `title=` in `src/renderer` returns only the six component-prop sites of F1. | It is what was asked for (*"show them in an app owned element, not with the system one"*), it is the only fix available for F3(c), and it is the position this codebase already took once — P16 §D4 replaced one `title` with `ErrorPopover.vue` on the grounds that a native tooltip *"is unreadable for anything beyond one short line"*, and P16 §11 left the rest as an explicit follow-up. Leaving `title` in place *alongside* the new tooltip is the one option that is definitely wrong: both would open, at different times, in different places, saying the same thing. |
| D2 | **All 123 sites migrate in this phase — the 20 non-interactive ones (F1) included.** No "controls first, text later" split. | Native `title` on a truncated `<span>` already fires whether or not the text is actually clipped, so routing it through `v-tooltip` changes *where it renders* and nothing else — there is no behavioural question to defer, and no per-site judgment to make. A split would also leave the app with two tooltip systems visible at once, which is the complaint. It costs nothing extra: the same directive, and F11's seven assertions are a one-token change either way. Making the tooltip appear *only* when the text is genuinely clipped (`scrollWidth > clientWidth`) is a real refinement and is deferred by name in §5, because it is a behaviour change, unlike this. |
| D3 | **One controller, installed once, listening on `document`: a `requestAnimationFrame`-coalesced `pointermove` that resolves the hovered host as `document.elementFromPoint(x, y)?.closest('[data-kira-tip]')`.** Not `mouseenter`/`mouseleave` on the trigger, and not `pointerover` delegation. Two cheap guards keep the hit test off the hot path: skip entirely when the pointer is still inside the currently-open host's cached rect, and skip when the raw `event.target` is unchanged since the last frame. | F5 is the reason and it is decisive: Blink dispatches no pointer events on a disabled form control, so both `@mouseenter` and `pointerover` delegation lose the tooltip on the twelve-plus sites whose entire purpose is to explain a disabled state — including all four of `DataToolbar`'s write buttons and `ViewChrome`'s shared Refresh/Stop. Hit testing is not affected by `disabled`, so `elementFromPoint` finds them; that is also exactly how the native tooltip reaches them today, so this is the mechanism being replicated rather than a workaround. It is also one listener set for the whole app instead of 246 handlers, which is the difference between this and a per-component approach. The two guards mean the steady state — pointer resting on a button, reading its hint — costs zero hit tests, and a pointer crossing the app costs at most one per frame. §7 verifies the grid-scroll budget is unmoved rather than assuming it. |
| D4 | **The surface is a `Teleport to="body"` singleton at `z-index: 300`, `position: fixed`, `pointer-events: none`, `role="tooltip"`, styled `.p-float` (F12).** Placement copies `ErrorPopover.vue:17-29` verbatim in shape: below the trigger, left-aligned, 4 px gap, clamped horizontally into the viewport, flipped above when it would overflow the bottom. It re-positions on `window` `resize`, as `PopoverPanel.vue:65` already does. | `pointer-events: none` is the ground rule about never intercepting a click, expressed in one declaration rather than in careful hit-box arithmetic. 300 is the first free rung above F10's ladder, which puts the tooltip over the context menu (200), the autocomplete list (200) and the dialog scrim (100) — all three host hinted buttons, so anything lower would reproduce F3(a) in a new form. A singleton (F7) means no per-trigger DOM, no teleport churn, and one element to assert against in tests. Mirroring `ErrorPopover`'s maths rather than importing a positioning library keeps the no-new-dependency rule and keeps two nearly-identical placement policies literally similar. |
| D5 | **`AppTooltip.vue` lives in `workbench/`, beside `ContextMenu.vue`, and is mounted once in `App.vue` next to it — not in `theme/primitives/`.** | `theme/primitives/` holds things a view composes into its own layout; `workbench/` holds the app's own global chrome, which is what a single always-mounted overlay is. `ContextMenu.vue` sets that precedent and `App.vue:47-52` is already the list of global overlays. The `App` prefix is required, not stylistic: commit `012a9ba` renamed the single-word primitives to satisfy the Vue multi-word-component lint, so `Tooltip.vue` would not survive `bun run lint`. |
| D6 | **400 ms to open, `TOOLTIP_REARM_MS = 300` during which a move to another hinted control opens with no delay; hide is immediate.** Hidden on: pointer leaving the host, `pointerdown` anywhere, any `keydown`, capture-phase `scroll`, `window` `blur`, and the directive's `unmounted`. | 400 ms is not a new number — it is `CodeMirrorHost.vue:111`'s lint-hover delay (F4), so the app has one hover-pause constant, and it sits inside the 300–500 ms band the rest of the app's VS Code borrowings live in (the codicon set, P21's shortcut hints). The re-arm window is what makes scanning a toolbar feel like one gesture instead of five separate 400 ms waits, and it is how every desktop tooltip system behaves. The hide triggers are `ContextMenu.vue:44-56`'s existing list plus pointer-leave — a floating element that survives a scroll is pointing at a control that has moved, which is the bug `ContextMenu` already registers a capture-phase `scroll` listener to avoid. |
| D7 | **Accessibility is handled by two mechanical rules inside the directive, not by 123 judgment calls.** (1) On bind/update, if the element has no accessible name — no non-whitespace text content, no `aria-label`, no `aria-labelledby` — the directive mirrors the tooltip text into `aria-label`. (2) While the tooltip is open, the controller sets `aria-describedby` on the host to `AppTooltip`'s id and removes it on hide. The controller also opens on `focusin` and closes on `focusout`, so a keyboard user reaches the hint at all. | F6 is the risk: 123 `title`s against 18 `aria-label`s means removing `title` without rule (1) leaves roughly a hundred icon-only buttons unnamed — a strictly worse outcome than the bug being fixed, and exactly the "no half-implementation" case AGENTS.md rules out. Rule (1) is safe to automate because it only fires where there is nothing to overwrite: a text button (`AppButton` with a slot) keeps its own name, `FiltersDialog.vue:138`'s explicit `aria-label` wins, and only glyph-only controls are touched. Rule (2) plus `focusin` is what makes the visible hint and the announced hint the same string instead of two parallel systems that can drift. Putting both in the directive means a new call site gets them for free and cannot forget. |
| D8 | **The text lives in the `data-kira-tip` attribute, not in a `WeakMap` keyed by element.** | The controller's lookup is `closest('[data-kira-tip]')`, which needs the attribute to exist anyway for hit resolution, so a parallel map would be a second source of truth for the same string. It also gives Playwright a handle that is a one-token substitution for the seven `getAttribute('title')` assertions of F11, and it keeps the hint visible in DevTools, which `title` did. The cost is that the string is in the DOM twice for the ~20 sites that also render it as text — the same cost `title` has today. |
| D9 | **No shortcut is printed inside the tooltip, and P21's binding table is not consulted.** | VS Code does append the keybinding to a toolbar tooltip and it would be a natural follow-on, but P21 deliberately scoped its printed keys to *context menus* against an audited 104-row matrix, and none of the toolbar buttons here were part of that audit. Extending it means deciding, per button, which of the 123 hints names a bound command — new work with its own audit, not a free rider on this phase. §5 records it. |
| D10 | **`SegmentedControl`'s `options[].title` and `RunState`'s `title` prop keep their names; only their internal binding changes** (`:title="opt.title"` → `v-tooltip="opt.title"` at `SegmentedControl.vue:24`, and the same at `RunState.vue:26`). | Both are declared props with call sites across the app (`DefinitionView.vue:93-96`'s pane options, every `useRunState` consumer). Renaming the prop to `tip` would ripple into files this phase otherwise never opens, for no behavioural gain; the prop already means "the hover hint", which is still exactly what it is. |
| D11 | **`docs/SPEC.md` gains one short §8.17 paragraph describing the tooltip as app chrome and its 400 ms rule, plus §11's repo-layout entry for `workbench/AppTooltip.vue`, plus the P22 phasing row.** | The spec is the contract later phases read; a new always-mounted global overlay with its own z-index rung and its own accessibility contract is exactly the sort of thing §8 documents for `ContextMenu` already, and leaving it undocumented would make the next phase that adds a hinted button reach for `title` again. |

## 4. Implementation order

1. **The mechanism, with no call site migrated.** `workbench/state/tooltip.ts` (constants,
   `tooltipState`, `vTooltip`, `initTooltips`), `workbench/AppTooltip.vue`, the `.directive(...)`
   registration in `main.ts`, `<AppTooltip />` in `App.vue`'s template and `initTooltips()` in its
   `onMounted`/`onUnmounted` pair alongside the existing `unsubscribe` list. Nothing changes
   visibly yet — the app still shows native tooltips everywhere. Green.
2. **Migrate the two button primitives' own internals and the shared chrome**: `TextField.vue:79,89`,
   `SegmentedControl.vue:24`, `RunState.vue:26`, `ViewChrome.vue:61,71`, `StatusBar.vue`,
   `ProjectPanel.vue:46`, `OperationsPanel.vue`, `TreeRow.vue:96,105,112`, `SearchBox.vue:22`.
   This is the smallest set that proves D3's disabled-button path (`ViewChrome`'s Refresh/Stop) and
   D7's `aria-label` rule (`ProjectPanel.vue:45-46` has both a `title` and an `aria-label`, so it is
   the case that must *not* be overwritten).
3. **Migrate the views, one file at a time**, largest first: `DocumentView.vue`, `DataToolbar.vue`,
   `StreamView.vue`, `KeyValueView.vue`, `CellEditorView.vue`, the four search toolbars,
   `ConnectionDialog.vue`, `FilterToolbar.vue`, `ConsoleView.vue`, `DataGrid.vue`,
   `DefinitionView.vue`, `ColumnsSection.vue`, `ConstraintsSection.vue`, `ConsoleResultGrid.vue`,
   `ColumnsMenu.vue`, `PreviewCommandPanel.vue`, `SavedListMenu.vue`, `FilterHistoryMenu.vue`,
   `ConsoleSavedMenu.vue`, `StreamComposeMessage.vue`, `StreamSearchToolbar.vue`,
   `ColorPicker.vue`, `FiltersDialog.vue:138`. Finish with the grep from D1 returning only the six
   prop sites.
4. **Retarget F11's seven assertions** (`'title'` → `'data-kira-tip'`) and add the new coverage of
   D16 below. `xvfb-run -a bun run test:ui` green.
5. **Docs.** `docs/SPEC.md` per D11, and this plan committed alongside.

**New test coverage (step 4).** A `tests/ui/tooltips.spec.ts` with four scenarios, against the
Postgres fixture the other specs already start:
- **Enabled control**: hover `[data-testid="data-refresh"]`, assert `[data-testid="app-tooltip"]`
  is hidden before 400 ms and visible after, with the right text; move away, assert it hides.
- **Disabled control** (D3/F5, the assertion that would have caught the naive implementation):
  hover the read-only connection's `toolbar-add-row`, assert the tooltip appears and reads
  `Connection is read-only`.
- **Over an overlay** (F3(a)): open `ColumnsMenu`, hover a hinted control *inside* the popover,
  assert the tooltip renders above it — i.e. that `z-index: 300` clears the backdrop and the panel.
- **Click is never intercepted** (D4) and **accessibility** (D7): with the tooltip open over
  `data-refresh`, click it once and assert the refresh actually ran; assert the button carries
  `aria-describedby` while open and an `aria-label` matching its hint.

## 5. Explicitly out of scope

- **Rich content in a tooltip.** Plain text only — one string, `white-space: pre-wrap`. No markdown,
  no HTML slot, no embedded code sample, no icons. Anything that needs more than a sentence is what
  `ErrorPopover.vue` exists for (P16 §D4) and that widget is untouched here.
- **Showing the tooltip only when text is genuinely truncated** (`scrollWidth > clientWidth`) for
  the 20 non-interactive sites of F1. Native `title` does not do this today either, so keeping the
  current behaviour is not a regression; making it conditional is a deliberate behaviour change and
  belongs to whoever wants it, with its own decision about the grid's virtualized cells.
- **Printing keyboard shortcuts inside tooltips** (D9). P21's table is not consulted and no toolbar
  button gains a printed key.
- **Interactive/hoverable tooltips** — no tooltip a pointer can enter, select text in, or click a
  link inside. `pointer-events: none` (D4) forecloses it on purpose.
- **A tooltip on anything that does not have a `title` today.** This phase relocates 123 existing
  hints; it does not audit the app for controls that *should* have one. (The one prior audit of
  that kind left its trace at `CellEditorView.vue:130-132`.)
- **Touch/long-press affordances.** The app is macOS desktop-only (SPEC.md:16) and has no touch
  input path; `pointermove` covers mouse and trackpad, which is the whole surface.
- **`main/menu.ts`, the native menu bar, and any native chrome.** Nothing outside the renderer's own
  DOM is app-owned and none of it is in question.
- **A tooltip for the `<title>` of the window, or any `title` outside `src/renderer`** — there are
  none in `src/main`, `src/preload`, `src/engine` or `src/shared`.

## 6. Target tree at the end of P22

```
src/renderer/
  main.ts                        MOD  .directive('tooltip', vTooltip) (F9/D3)
  App.vue                        MOD  <AppTooltip /> beside <ContextMenu />; initTooltips() in
                                      the existing onMounted/onUnmounted pair
  workbench/
    state/tooltip.ts             NEW  TOOLTIP_DELAY_MS/TOOLTIP_REARM_MS/TIP_ATTR, tooltipState,
                                      vTooltip (D7's two a11y rules), initTooltips() (D3)
    AppTooltip.vue               NEW  Teleport singleton, .p-float, z-index 300,
                                      pointer-events: none, role="tooltip" (D4/D5)
    ContextMenu.vue               --  UNCHANGED (the pattern this copies, F7)
    StatusBar.vue                MOD  5 sites
    panels/{ViewChrome,ProjectPanel,OperationsPanel}.vue   MOD  2 / 1 / 3 sites
  theme/primitives/
    {TextField,SegmentedControl,RunState}.vue  MOD  2 / 1 / 1 sites (D10)
    {IconButton,AppButton}.vue    --  UNCHANGED (fallthrough already works, F2)
    primitives.css                --  UNCHANGED (.p-float reused as-is, F12)
  project/{TreeRow,SearchBox,ColorPicker,FiltersDialog,ConnectionDialog}.vue  MOD  3/1/1/1/3
  views/
    documents/{DocumentView,DocumentSearchToolbar}.vue     MOD  15 / 6
    grid/{DataToolbar,SearchToolbar,FilterToolbar,DataGrid,ColumnsMenu,PreviewCommandPanel}.vue
                                 MOD  14 / 6 / 3 / 2 / 1 / 1
    stream/{StreamView,StreamSearchToolbar,StreamComposeMessage}.vue  MOD  10 / 3 / 1
    keyvalue/{KeyValueView,KeyValueSearchToolbar}.vue      MOD  10 / 6
    celleditor/CellEditorView.vue                          MOD  8
    console/{ConsoleView,ConsoleResultGrid,ConsoleSavedMenu}.vue  MOD  3 / 2 / 1
    definition/{DefinitionView,ColumnsSection,ConstraintsSection}.vue  MOD  2 / 1 / 1
    shared/{SavedListMenu,FilterHistoryMenu}.vue           MOD  2 / 1
tests/ui/
  tooltips.spec.ts               NEW  the four scenarios of §4 step 4
  {data-view,mutations,leaks,mariadb,s3,cell-editor,preconnect}.spec.ts
                                 MOD  'title' -> 'data-kira-tip' (F11, seven assertions)
  budgets.spec.ts                 --  UNCHANGED (verified, not assumed — §7)
docs/
  SPEC.md                        MOD  new §8.17, §11 layout entry, P22 phasing row (D11)
  plans/P22-app-owned-tooltips.md  NEW  this document
```

## 7. Acceptance checklist

- [ ] Hovering any toolbar button shows an app-drawn tooltip after ~400 ms, in the app's own
      elevated-surface style, with the app's font — and the macOS system tooltip never appears
      anywhere in the app again.
- [ ] `grep -rnE '(^|[^-a-zA-Z:])(:?title)=' src/renderer` returns **exactly six** hits, all of them
      the `DialogFrame`/`SavedListMenu` props of F1.
- [ ] Hovering a **disabled** button still shows its hint — verified explicitly on
      `DataToolbar`'s Add row / Delete row on a read-only connection, `StreamView`'s Delete with no
      row selected, `KeyValueView`'s Edit on a non-string key, `CellEditorView`'s Beautify on a
      plain-text value, and `ViewChrome`'s Refresh while a load is in flight (D3/F5).
- [ ] A tooltip for a control inside an open `ColumnsMenu`/`FilterHistoryMenu`/dialog renders
      **above** that surface, not behind it (D4/F10).
- [ ] Clicking a button while its tooltip is showing runs the button's own handler, once — the
      tooltip intercepts nothing (D4).
- [ ] The tooltip hides on pointer-leave, on click, on any key, on scroll, on window blur, and when
      its trigger is unmounted (D6) — no orphaned tooltip after closing a tab or a dialog.
- [ ] Moving between adjacent toolbar buttons within 300 ms opens the next hint immediately; the
      first hint after a pause still waits the full 400 ms (D6).
- [ ] Every icon-only control that lost a `title` has an `aria-label` carrying the same text, and
      the hovered/focused control carries `aria-describedby` pointing at the live tooltip (D7/F6) —
      asserted on at least one `IconButton`, and asserted *not* to have overwritten
      `ProjectPanel.vue:45`'s pre-existing `aria-label`.
- [ ] A keyboard user tabbing onto a hinted control sees the tooltip (D7's `focusin`).
- [ ] The 20 non-interactive hints (F1) work: the tree row label, the connection status dot, the
      grid column header, the operations-log command/error cells, the truncation chips (D2).
- [ ] All seven `getAttribute('title')` assertions of F11 pass against `data-kira-tip`, unchanged in
      meaning.
- [ ] `docs/PERF.md`'s grid-scroll and tree-expand budgets in `tests/ui/budgets.spec.ts` still pass
      unchanged — measured, not assumed, since D3 adds a per-frame hit test to `pointermove`.
- [ ] `tests/ui/leaks.spec.ts` still green: `initTooltips()`'s teardown removes every listener it
      added, and no `tooltipState` reference survives an unmounted trigger.
- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean;
      `xvfb-run -a bun run test:ui` green including the new `tooltips.spec.ts`.

## 8. Open questions for the user

1. **400 ms, or shorter?** §D6 takes the app's own existing hover constant (`CodeMirrorHost.vue`'s
   lint `delay: 400`) so there is one number rather than two. The reported symptom is "the hint
   doesn't show", which a shorter delay (250–300 ms) addresses more aggressively at the cost of
   tooltips flickering up while the pointer is merely crossing a toolbar. One-line flip either way,
   worth deciding deliberately rather than discovering.
2. **Should the 20 non-interactive hints (truncated tree labels, grid header cells, log rows) show
   the tooltip only when the text is actually clipped?** D2 ships them unconditional because that is
   what `title` does today, and §5 defers the conditional version. It is the one place where "match
   today's behaviour exactly" and "behave the way a tooltip should" disagree.
