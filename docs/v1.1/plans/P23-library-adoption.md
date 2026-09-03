# P23 — library adoption: `@floating-ui/dom` for positioning, `github.com/google/uuid` for IDs

> **What this phase is.** Two small, independent, already-researched adoptions, run as their own
> phase ahead of the queued code-review phase — not a survey (that already happened, informally, in
> the course of earlier work) and not a redesign. Part A replaces four divergent flip/clamp
> implementations on the frontend with one library-backed one, fixing a real, reproducible bug along
> the way. Part B replaces a 24-line hand-rolled UUID generator on the backend with a library that
> was already a direct dependency of this module, used elsewhere in the same tree.
>
> **Every claim below was re-verified against the tree at this phase's own base commit** (`48c3abc`,
> `docs(plan): P22 Pass B — parity, cutover and deletion plan for SlickGrid`, branch
> `claude/feature-v1-1-p5-onwards-2isfzt`) — file:line citations point at that commit's content,
> not at a prior summary taken on faith. Two things the earlier summary got right and one thing it
> undercounted, both caught by re-verifying: `internal/id.New()`'s call sites are **five**, not
> three (`internal/adapterhost/host.go:118` was missing from the earlier list), and
> `github.com/google/uuid` was already a **direct**, unmarked dependency before this phase touched
> `go.mod` at all — this phase's job for Part B's "must be direct" requirement was to *verify and
> keep it that way*, not to promote it from indirect.

---

## 0. Scope and non-scope

**In scope**: `apps/kira-studio/frontend/src/theme/anchoredPosition.ts` and its three consumers
(`theme/primitives/PopoverPanel.vue`, `workbench/AppTooltip.vue`, `project/ErrorPopover.vue`),
`workbench/ContextMenu.vue`'s own hand-rolled positioning (top-level menu and submenu), and
`workbench/state/tooltip.ts`'s one small supporting change (§3.4). On the Go side:
`internal/id/uuid.go` and its five call sites, `go.mod`/`go.sum`.

**Out of scope, explicitly**: anything under `apps/kira-studio/frontend/src/views/grid/`,
`views/console/ConsoleResultGrid.vue`, or `tests/ui/*grid*`/`tests/ui/*slick*` specs — a separate,
concurrent phase (the SlickGrid migration, `docs/v1.1/plans/P22-slickgrid-*.md`) owns those files
right now. This phase touches **zero** files in that set — verified by the final diff in §6. Two
of PopoverPanel's own consumers (`views/grid/ColumnsMenu.vue`, `views/grid/PreviewCommandPanel.vue`)
live under `views/grid/`, but PopoverPanel's public contract (props `anchor`/`width`/`testId`/
`backdropTestId`, one `close` emit, a default slot) is unchanged by this phase, so neither file
needed touching, and neither was touched.

---

## 1. Part A — the frontend, re-verified

### 1.1 The four implementations, as they stood at the base commit

**#1 — `theme/anchoredPosition.ts`** (67 lines, deleted whole by this phase). A pure function,
`anchoredPosition(anchor, panel, viewport, opts)`, two named strategies:

- `'menu'` (`:44-51` horizontal, `:53-60` vertical): clamps both axes into the viewport
  unconditionally (`Math.min(Math.max(naturalLeft, gap), maxLeft)`), and picks whichever side of
  the anchor has more room (`opensUpward = panel.height > spaceBelow && spaceAbove > spaceBelow`).
- `'callout'` (the default, `:47-51`/`:61-64`): starts below-left of the anchor, pulls back **only
  on an actual overflow** — reduced left only if it would run past the right edge, flipped above
  only if it would run past the bottom edge. Unlike `'menu'`, an anchor already off-screen to the
  left is never clamped back into the positive range (the deleted unit test's own test 4 named this
  explicitly: *"byte-for-byte the original AppTooltip/ErrorPopover behavior, not a new fix"*).

Both strategies are **viewport-only**: `viewport: PanelSize` is `{ width: window.innerWidth, height:
window.innerHeight }` at every one of the three call sites (§1.2) — no clipping-ancestor or
scroll-container awareness, and no mechanism to reposition on a scroll or resize of anything but the
window itself.

**#2 — `theme/primitives/PopoverPanel.vue`** (was 142 lines). `reposition()` (`:48-63`) called
`anchoredPosition(rect, { width: props.width, height: popoverHeight }, viewport, { align:
props.anchor, strategy: 'menu' })`, where `popoverHeight` came from `popoverEl.value?.offsetHeight
?? 0` — **0 on the very first call**, before the popover has ever painted, which is why
`onMounted` (`:97-107`) called `reposition()` twice: once synchronously, once after `nextTick()`,
so *"the first paint's guess is corrected before the user can see it"* (`:52-54`'s own comment).
`window.addEventListener('resize', reposition)` (`:106`) was the only thing that kept it pinned to
its trigger after that — no scroll tracking of any kind. This is the primitive twelve other
components mount (`ColumnsMenu`, `PreviewCommandPanel`, `SavedListMenu`, `DateTimePicker`,
`TimestampPane`, `CellEditorView`, `KeyValueView`, `StreamComposeMessage`, `StreamView`,
`ProjectionMenu`, `ConsoleView`, `AutocompleteField` — `grep -rl PopoverPanel frontend/src
--include='*.vue'`, twelve matches other than the primitive itself).

**#3 — `workbench/AppTooltip.vue`**. `position()` (`:13-24`) called `anchoredPosition(anchor, p,
viewport)` — no `opts`, so the default `'callout'` strategy. `anchor` came from
`workbench/state/tooltip.ts`'s `getAnchorRect()` (`:73-75`, deleted by this phase — see §3.4),
which returned a plain `DOMRect`, not the element itself.

**#4a — `workbench/ContextMenu.vue`'s own `position()`** (was `:59-70`), the top-level menu's own
hand-rolled clamp, **entirely separate from #1-#3** — it never called `anchoredPosition` at all:

```ts
let left = contextMenuState.x;
let top = contextMenuState.y;
if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 4);
if (top + rect.height > window.innerHeight)
  top = Math.max(0, window.innerHeight - rect.height - 4);
```

Anchored to the mouse click point (`contextMenuState.x`/`.y`), not an element — a clamp only, no
flip, and (worth noting precisely, since the replacement changes it slightly, §1.3) an
**asymmetric** gap: 4px of padding on an edge it actually had to pull back from, 0px on an edge it
never needed to (the `Math.max(0, …)` floor).

**#4b — `.submenu`'s own CSS** (was `:360-369`), the second half of the same file and the one with
a live bug:

```css
.submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  ...
}
```

**No flip. No clamp. None at all.** `.submenu-trigger { position: relative }` (was `:356-358`) is
what let this resolve against the trigger row instead of some ancestor, and `.context-menu`'s own
`overflow: visible` override (was `:315-318`, with a comment saying exactly why) existed **only**
so this absolutely-positioned child could pop out past its parent's box without being clipped.

### 1.2 The bug, reproduced and fixed

A submenu (`menu.ts`'s Color submenu — every `menu.ts`/`grid/menu.ts` module builds one the same
way, `type: 'submenu'`) opened near the right or bottom edge of the window rendered partly or
wholly offscreen, because #4b had nothing to stop it. `docs/v1.1/plans/P22-grid-library-survey.md`
never touches this file; this was found and fixed fresh in this phase, not carried forward from an
earlier finding.

**Reproduced and proven fixed by a real Playwright/WebKit test**,
`apps/kira-studio/tests/ui/tabs.spec.ts`, `a submenu near the right edge flips to open on the left
instead of running offscreen (P23)` (added by this phase, right after the existing colour-submenu
test in the same file). The technique: a 420×720 viewport, a right-click 10px in from the
**connection row's own right edge** rather than its center (so the top-level menu itself opens far
enough right that a naive further-right submenu has no room), then hover Color and assert the
submenu's own bounding box:

```ts
expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(viewport.width);   // not clipped right
expect(submenuBox.x).toBeGreaterThanOrEqual(0);                                 // not clipped left
expect(submenuBox.x + submenuBox.width).toBeLessThanOrEqual(triggerBox.x + 1);  // actually flipped
```

**This test was verified against the actual bug, not just against the fix** — the two ways that
matters are easy to get backwards, so both were checked by hand before this test was trusted:

1. With the pre-fix CSS restored verbatim (`left: 100%; top: -4px`, no flip, no shift) in a scratch
   edit, the test failed with `submenuBox.x + submenuBox.width = 571` against a 420px viewport — a
   151px overflow, the exact shape of the bug.
2. **A real implementation bug in this phase's own first draft was caught by the same process**: a
   plain `ref="submenuRef"` on the submenu `<div>` sat inside this template's own `v-for="item in
   contextMenuState.items"`, and Vue collects any `ref` bound inside a `v-for` scope into an array
   — `[HTMLDivElement]`, not the element — regardless of the inner `v-if` ever mounting at most one
   of them. `submenuRef.value.parentElement` was therefore silently `undefined` on every call, the
   `if (!el || !trigger) return;` guard returned early every time, and `submenuStyle` never left its
   initial `{ left: '0px', top: '0px' }` — the submenu still passed `toBeVisible()` (present,
   rendered, non-zero size), just at the wrong position, and the test's own first two assertions
   passed too, *by coincidence*, since `(0,0)` happens to be both `>= 0` and `<= triggerBox.x`. Only
   the disable-flip check (item 1 above, re-run against this broken draft) exposed it, because
   `0 + 160 <= 420` is also true. Fixed with a function ref (`:ref="setSubmenuRef"`, a plain function
   assigning `submenuRef.value = el`), which Vue calls directly instead of array-collecting,
   regardless of the `v-for` it sits in — `apps/kira-studio/frontend/src/workbench/ContextMenu.vue`'s
   own comment on `setSubmenuRef` explains this for the next reader. Re-run after the fix:
   `submenuBox = { x: 71, y: 267, width: 160, height: 193 }` against `triggerBox.x = 241` — genuinely
   flipped to the trigger's left, not merely clamped.

This is exactly the kind of mistake a positioning refactor is good at hiding (everything still
*renders*, nothing throws, `toBeVisible()` is green) and exactly why the task brief's "verify with a
real UI test, not just because it's positioning" instruction mattered in practice, not just in
principle.

### 1.3 The design: one function, four (five) call sites

`@floating-ui/dom@1.8.0` (§1.4) is added as a real, exact-pinned `dependencies` entry
(`package.json`, matching `bunfig.toml:1-2`'s `exact = true` — every other entry in this manifest is
already exact). One new file, `frontend/src/theme/floatingPosition.ts` (76 lines), replaces
`anchoredPosition.ts` (deleted) as the single positioning code path:

```ts
export async function computeFloatPosition(
  reference: ReferenceElement,
  floatingEl: HTMLElement,
  opts: FloatOptions = {},
): Promise<{ left: number; top: number }> {
  const middleware: Middleware[] = [offset(opts.offset ?? 4)];
  if (opts.flip ?? true) middleware.push(flip());
  middleware.push(shift({ padding: opts.padding ?? 4 }));
  const { x, y } = await computePosition(reference, floatingEl, {
    strategy: 'fixed',
    placement: opts.placement ?? 'bottom-start',
    middleware,
  });
  return { left: x, top: y };
}
```

plus `pointReference(x, y)`, a `VirtualElement` (`getBoundingClientRect()` only) for the one caller
anchored to a mouse point rather than a DOM element, and a re-export of `autoUpdate`. `strategy:
'fixed'` matches every consumer's own existing CSS (`position: fixed`) and needs no change to any
of the `Teleport to="body"` wrappers already in place.

**A genuine simplification, stated plainly, not smuggled in**: `'menu'` and `'callout'` collapse
into **one** default (`placement: 'bottom-start'`, `offset: 4`, `flip: true`, `padding: 4`), not
two. Re-deriving each strategy's own math against floating-ui's middleware:

- `'menu'`'s flip rule (*"opens upward only when it doesn't fit below and there's more room
  above"*) is `flip()`'s own default behaviour.
- `'menu'`'s unconditional both-edge clamp is `shift({ padding })`'s default behaviour on **both**
  axes.
- `'callout'`'s right/bottom-only pull-back is the *same* `shift()` call, minus one thing: `'menu'`
  additionally floors the left/top edges at `gap` even when the anchor's natural position was
  already off-screen in that direction; `'callout'` never did. `shift()`'s own default
  (`mainAxis: true`) *does* pull back on all four edges — which means this phase's one behavioural
  delta is that AppTooltip/ErrorPopover now also clamp on the left/top, where they previously did
  not (the deleted unit test's own test 4, §1.1). This is strictly a bug **fix** (an anchor
  genuinely off-screen to the left used to leave the tooltip off-screen too; now it doesn't), it
  was never exercised by anything captured in `tests/ui/` (grepped: no spec anchors a tooltip or
  error popover off the left edge), and it is the only intentional behavioural change carried by
  the consolidation itself — separate from the submenu bug fix, which is the phase's other,
  headline change.

Per-call-site options (§1.1's own numbering):

| Call site | `placement` | `offset` | `flip` | why |
|---|---|---|---|---|
| PopoverPanel (`align: 'left'`, default) | `bottom-start` | `4` (default) | `true` (default) | unchanged from `'menu'` |
| PopoverPanel (`align: 'right'`) | `bottom-end` | `4` | `true` | unchanged from `'menu'`, `align='right'` |
| AppTooltip | `bottom-start` (default) | `4` | `true` | was `'callout'`; see the shift-both-edges note above |
| ErrorPopover | `bottom-start` (default) | `4` | `true` | same |
| ContextMenu — top-level menu | `bottom-start` | **`0`** | **`false`** | anchored to a mouse *point*: no gap wanted between click and menu (the old code drew the menu flush at `contextMenuState.x/y`), and no "other side" exists to flip to — only the edges `shift()` already guards |
| ContextMenu — submenu | `right-start` | `{ mainAxis: 0, crossAxis: -4 }` | `true` (default) | `right-start`/`mainAxis:0` restates the old CSS's `left: 100%`; `crossAxis: -4` restates `top: -4px`; `flip` (left as the default, not turned off) is the actual bug fix — verified in §1.2 that `shift()` alone, without `flip`, does **not** fully rescue the reproduction case (a temporary `flip: false` override reproduced the 151px overflow even with `shift()` still active — floating-ui's default shift limiter does not push a floating element past its own reference to compensate for a same-side placement that has no room) |

**`autoUpdate`, decided per call site, not applied uniformly** (the task brief's own instruction —
*"a menu that's only open briefly may not need it, a popover that stays open while the user scrolls
its anchor does"*):

- **PopoverPanel: yes.** Its own header comment already names the shape of the problem this closes
  — the cell editor panel is docked at the bottom of the window, so a popover anchored to a trigger
  there had *"nowhere to grow into"* even before this phase; more generally, every one of its twelve
  consumers renders as a sibling of an ordinary toolbar/dialog trigger, several of which
  (`AutocompleteField`, `CellEditorView`'s `TimestampPane`) can sit inside a scrollable ancestor.
  `autoUpdate(anchorEl, el, reposition)` (started in `onMounted`, stopped in `onUnmounted`) replaces
  the old bare `resize` listener, and — as a side effect of switching to `computePosition`, which
  reads the floating element's own real `getBoundingClientRect()` — the old
  "guess-with-`offsetHeight`-then-correct-after-`nextTick`" two-pass dance (`:52-54`'s own comment,
  §1.1) is gone: the very first `reposition()` already sees the popover's real, laid-out size, so
  only one synchronous call is needed before `autoUpdate` takes over (a first call is still made
  explicitly, since `autoUpdate`'s own `ResizeObserver` setup fires its first callback
  asynchronously, and skipping it would flash the popover at its `(0,0)` default for one frame).
- **ErrorPopover: yes.** Unlike PopoverPanel, it renders no full-viewport backdrop at all — nothing
  stops the page behind it from scrolling while it's open — and its one real trigger,
  `project/TreeRow.vue`'s inline error text, sits inside the project tree's own scrolling panel.
  `autoUpdate` is started in the `watch(open, …)` handler (not `onMounted`, since the popover's
  content — and therefore `popoverRef.value` — only exists while `open` is true) and stopped both
  when `open` goes false and in `onUnmounted`.
- **AppTooltip: no.** `workbench/state/tooltip.ts`'s own `onScroll` (`:186-189`, kept unmodified by
  this phase) already closes the tooltip on **any** scroll (`window.addEventListener('scroll',
  onScroll, true)`, capture phase, catches a nested scrollable ancestor too) — the anchor genuinely
  cannot move out from under an open tooltip, so `autoUpdate` would track a case that structurally
  never happens. Kept on a resize listener only, matching the pre-existing behaviour exactly.
- **ContextMenu — top-level menu and submenu: no.** Neither had a resize listener before this
  phase (`workbench/ContextMenu.vue`'s `onMounted`, pre-phase, added only `mousedown`/`keydown`/
  `blur` — no `resize`), and both close on the first outside interaction (`onDocMouseDown`) or
  `Escape` — an "open briefly" surface in the brief's own sense. Not adding `autoUpdate` here is a
  preserved behaviour, not an oversight.

### 1.4 `@floating-ui/dom` — the dependency itself, researched fresh

**Version and license, from the live registry** (`registry.npmjs.org/@floating-ui/dom`,
2026-09-03): `dist-tags.latest` = **`1.8.0`**, published 2026-07-11. `license: "MIT"`. Its own two
runtime dependencies — `@floating-ui/core@^1.8.0` and `@floating-ui/utils@^0.2.12` — are both MIT
too (same registry, same author, `atomiks`/Floating UI org). No paid tier, no license key, nothing
resembling P22's PrimeVue/Handsontable findings.

**Popularity**: `api.npmjs.org/downloads/point/last-week` reports **97,884,937** weekly downloads
for `@floating-ui/dom` (96,339,524 for `@floating-ui/core`) — the great majority of that is
transitive (Radix UI, Headless UI, Popper's own successor project, and dozens of component
libraries all sit on top of it), but it is, by a wide margin, the most battle-tested positioning
primitive available for this exact problem shape.

**Bundle cost, measured the way this repo's own precedents measure it**
(`esbuild --bundle --minify --format=esm` + `gzip -9`, the same method `P19-dependency-runtime-
bump.md` and `P22-grid-library-survey.md` use):

| | raw | gzip |
|---|---:|---:|
| `{ computePosition, flip, shift, offset, autoUpdate }` alone, isolated | 15,842 B | 6,465 B |
| The real delta in this app's own launch chunk, `bun run build` before → after this phase's whole frontend diff | +15,620 B (1,302,300 → 1,317,920) | **+5,880 B** (398.47 kB → 404.35 kB) |

The isolated and real-app numbers agree closely (6,465 B vs. 5,880 B — the small gap is this app's
own new/changed wrapper code interacting with what was already shared/tree-shaken, not a second
copy of the library). **+5,880 B gzip is +1.48% of the pre-phase launch chunk** — a fraction of
what P19's own precedent bar tolerated for a single dependency (P13's `sql-formatter` at 38 KB
gzip, P19 §0.2), and it is buying the deletion of four independent implementations, not adding a
fifth alongside them.

### 1.5 `docs/ARCHITECTURE.md` conventions checked before touching these files

Read in full before this section was written (not skimmed). Nothing in "UI architecture" or the
renderer sections names a house rule specific to popovers/menus/theme primitives beyond what's
already reflected above (Teleport-to-body, `position: fixed`, the shared `.p-float` primitive). One
convention was actively preserved rather than accidentally dropped: `ContextMenu.vue`'s swatch
rendering (`connColorVar(item.swatch)`, the connection-colour token every menu row with a colour dot
already used) is untouched — this phase changes only *where* the submenu renders, never *what* it
renders, so the Color submenu's own magenta/blue/… swatches are byte-for-byte the same template
code as before. `docs/ARCHITECTURE.md`'s "no Vue reactivity on row data" invariant is grid-specific
(as the task brief itself already flagged) and has no subject here — nothing in this phase touches
row data or the grid's own reactivity model.

### 1.6 One CSS cleanup this consolidation makes possible, taken

`.context-menu`'s `overflow: visible` override (§1.1, #4b) existed only because the old submenu was
an absolutely-positioned child escaping its parent's box. Now that the submenu is its own
`position: fixed` surface, independent of any ancestor's `overflow`, the override serves no purpose
— removed, so `.context-menu` falls back to `.p-float`'s own default (`overflow: hidden`,
`theme/primitives.css:450-456`), matching every other floating surface in the app rather than being
a permanent, silently-obsolete exception. `.submenu-trigger { position: relative }` (§1.1, #4b) is
similarly now-dead (nothing beneath it needs a positioned ancestor any more) and was removed with
it.

---

## 2. Part B — the backend, re-verified

### 2.1 The hand-rolled generator, and its failure semantics

`apps/kira-studio/internal/id/uuid.go` (24 lines, deleted whole by this phase):

```go
// Package id generates the RFC 4122 version-4 UUIDs P53's repos need for filter_history and
// saved_queries rows (and P55's connections create/duplicate). A ~15-line generator over
// crypto/rand avoids adding a UUID library to P52 §2.2's deliberately short dependency list.
package id

func New() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand: a process that cannot get entropy has no business writing rows.
		panic(fmt.Sprintf("id: crypto/rand unavailable: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
```

**`id.New()` panics on entropy failure, by design and by comment** (`:16-17`). This is the one fact
the task brief called out as needing care, and it is exactly right: `crypto/rand.Read` failing is
treated as an unrecoverable process condition, not a value to propagate.

**`github.com/google/uuid@v1.6.0`'s `NewString()` has the identical failure contract**, read
directly from the installed module source
(`$(go env GOPATH)/pkg/mod/github.com/google/uuid@v1.6.0/version4.go:19-22`):

```go
// NewString creates a new random UUID and returns it as a string or panics.
// NewString is equivalent to the expression
//    uuid.New().String()
func NewString() string {
	return Must(NewRandom()).String()
}
```

— `Must(NewRandom())` panics on the same `crypto/rand` failure `NewRandom()` can surface as an
`error`. **`uuid.NewString()` is used everywhere in this phase, never `uuid.NewRandom()`** — the
panicking form is the one that preserves `id.New()`'s exact contract, and every one of the five real
call sites (§2.2) was checked individually against the brief's own carve-out ("a call site that
already handles a returned error would be a legitimate place to switch to the non-panicking form")
and none qualifies: none of the five is already threading a returned-error path that a panic would
be replacing with something worse, and none has a stated reason in its own code or history to want
`Create`/`Duplicate`/`Record`/`insert`/`RunOp` to behave differently on entropy exhaustion than they
already did. The failure contract is therefore preserved exactly, at every call site, not merely at
most of them.

### 2.2 The real call sites — five, not three

Grepped fresh (`grep -rn 'internal/id"\|id\.New('` across `apps/kira-studio`) rather than trusting
the earlier summary's list of three:

| # | File:line (pre-phase) | Context |
|---|---|---|
| 1 | `internal/storage/repos/filter_history.go:57` | `FilterHistoryRepo.Record`'s `INSERT INTO filter_history` |
| 2 | `internal/storage/repos/saved_queries.go:112` | `SavedQueriesRepo.insert`'s `INSERT INTO saved_queries` |
| 3 | `internal/connections/service.go:257` | `Service.Create`'s new connection id |
| 4 | `internal/connections/service.go:325` | `Service.Duplicate`'s new connection id |
| 5 | `internal/adapterhost/host.go:118` | `Host.RunOp`'s minted op id, when the caller didn't supply one |

**#5 is the one the earlier survey missed.** `adapterhost/host.go:17` imported the package as
`idgen "…/internal/id"` (the same alias `connections/service.go:17` used, both to avoid shadowing a
local `id`/`opID` variable named plainly) and called `idgen.New()` at `:118` to mint an op id when
`spec.OpID` was empty. This call site generates an id used only as an in-memory map key and an
event-log field (`h.running[opID]`, `opStartPayload.OpID`) — never persisted to a `connections`,
`filter_history`, or `saved_queries` row — but the task's own instruction was to replace **every**
hand-rolled call site, not just the ones backing a SQL table, and this is a real, load-bearing use
of `id.New()` that a three-item list would have silently left on the old generator.

Every one of the five now calls `uuid.NewString()` directly, with `github.com/google/uuid` imported
plainly (no alias) — `idgen` was only ever needed because `id` (the package name) collided with a
local `id string` variable in `connections/service.go`; `uuid` collides with nothing.

### 2.3 `github.com/google/uuid` was already a direct dependency, and still is

**Before this phase touched anything**: `go.mod:15` `github.com/google/uuid v1.6.0`, inside the
first `require (...)` block (`go.mod:5-32`, no `// indirect` comment anywhere in it) — the direct
block, not the second one (`go.mod:34-…`, every line there marked `// indirect`). Already imported
by `apps/kira-studio/main.go:13` (three call sites: `:296`, `:314`, `:345`, each minting a
`model.WindowRecord.Key`) and `internal/adapters/s3/transfer.go:10` (one call site, `:48`, the
`.kira-partial-<uuid>` temp-file suffix `docs/ARCHITECTURE.md`'s S3 section already documents).

**After this phase**: identical. `go mod tidy` was run (per the task's own instruction, to verify
rather than assume) and produced **zero diff** to `go.mod` or `go.sum` — expected, since this
phase's only Go-side dependency change is *fewer* internal call sites needing anything, and
`internal/id` itself imported nothing external (`crypto/rand`, `fmt` — both stdlib) whose removal
could shift anything in the requirement graph.

**Confirmed, explicitly, as the task asked**: `git grep -n "google/uuid" go.mod` after every edit in
this phase still returns exactly `go.mod:15: github.com/google/uuid v1.6.0` — no `// indirect`
marker, still inside the direct block. The survey's finding holds; this phase's job was to keep it
holding, and it does.

### 2.4 `internal/id` deleted; one stale comment fixed

With all five call sites moved, `internal/id/uuid.go` has no remaining callers (`grep -rn
'internal/id"'` across the whole repo, post-edit, returns nothing) and was deleted along with its
directory. One comment referenced it by name outside the package itself:
`internal/ipcfixture/harness.go:100`, describing `SeedConnection`'s own deliberate bypass of
`connections.Service.Create`'s random id assignment — updated from *"…own random `id.New()`
assignment…"* to *"…own random `uuid.NewString()` assignment…"*, since the sentence is a statement
about current source, not phase history, and leaving it naming a deleted function would be exactly
the kind of drift `AGENTS.md`'s "no shortcuts" bar exists to catch. Historical plan docs that
mention `internal/id` in prose (`docs/v1/plans/P53-go-storage-core.md`,
`docs/v1.1/plans/P19-dependency-runtime-bump.md` F12) are left as written, per this repo's own
convention that a plan doc is a point-in-time record, not a living one (`docs/ARCHITECTURE.md`'s own
front matter: *"the tree itself outranks this file"* — said of `SPEC.md`, and the same convention
extends to every dated plan doc in `docs/v1.1/plans/`).

---

## 3. Verification

### 3.1 Frontend gate

All run against the tree in `.claude/worktrees/agent-a9193c366b8937757` (this phase's isolated
worktree), toolchain bootstrapped via `sh scripts/setup.sh` (Go 1.27.0, Bun 1.3.11, `wails3` pinned
to `go.mod`'s `v3.0.0-beta.16`, bindings regenerated).

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | `Checked 381 files … No fixes applied.` |
| Typecheck (tests project) | `bun run typecheck:tests` | clean |
| Typecheck (web/vue-tsc) | `bun run typecheck:web` | clean |
| Typecheck (unit project) | `bun run typecheck:unit` | clean |
| Build | `bun run build` | succeeds; launch chunk 404.35 kB gzip (+5.88 kB / +1.48%, §1.4) |
| Unit tests | `bun run test:unit` | 223 pass — **8 pre-existing failures, unrelated to this phase**: all in `tests/unit/bridge-port.spec.ts` (`bridge/port.ts`'s Stream transport, a `close()`/timeout race), a file this phase never touches. Confirmed pre-existing, not introduced: `git stash`-ing this phase's entire diff and re-running reproduces the identical 8 failures on the unmodified tree. `AGENTS.md`'s "Known open items" says "None" as of this phase's base commit, so this is a newly-surfaced, pre-existing flake worth a follow-up, not something this phase caused or should paper over |
| UI — targeted (popovers, menus, submenus, tooltips) | `playwright test --project=ui tabs.spec.ts tooltips.spec.ts tree.spec.ts definition.spec.ts console.spec.ts autocomplete.spec.ts data-view.spec.ts interaction.spec.ts` | **24/24 pass**, including the new submenu-offscreen regression test |
| UI — full suite | `playwright test --project=ui` (all 25 spec files, 78 tests) | **77/78 pass.** The one failure, `perf.spec.ts`'s `p95 < 80ms` scroll-frame-time tripwire (`p95=85ms` under full-suite parallel load), is a grid-scroll timing test — a file this phase does not touch, explicitly out of scope (§0) — and reproduces green in isolation (`p95=70ms`, single worker, no contention), consistent with that spec's own comment about being *"loose enough to not chase this sandbox's own baseline cadence"* rather than a hard, always-reproducible number. Not a regression this phase caused |

The unit-test-layer coverage for the old pure-arithmetic `anchoredPosition()` function
(`tests/unit/anchored-position.spec.ts`, 8 cases across both strategies) was **deleted, not
ported**. `AGENTS.md`'s own bar — *"unit tests exist only for advanced, complex or deeply nested
logic"* — applied cleanly to the old file precisely because the flip/clamp arithmetic was pure and
self-contained; that arithmetic no longer lives in this repo's own code, it lives in
`@floating-ui/dom`, which ships its own (considerably larger) upstream test suite. Re-deriving
equivalent coverage here would mean either standing up a DOM environment this repo's `tests/unit/`
tier deliberately doesn't carry (`bunfig.toml` has no `happy-dom`/`jsdom`, and the one existing
DOM touchpoint in that tier, `tests/unit/column-widths-cache.spec.ts:15-16`, hand-stubs the two
calls it needs rather than pulling one in) or testing floating-ui's own already-tested behaviour —
neither clears the stated bar. The real replacement coverage is `tests/ui/`'s real-browser layer
(§1.2's submenu test, plus the pre-existing tooltip/popover/context-menu specs all still green),
which is what actually exercises this code against a real WebKit layout engine, unlike the deleted
unit test ever did.

### 3.2 Backend gate

| Check | Command | Result |
|---|---|---|
| Build | `go build ./...` | clean |
| Vet | `go vet ./...` | clean |
| `go mod tidy` | `go mod tidy` | zero diff to `go.mod`/`go.sum` (§2.3) |
| Tests | `go test ./apps/kira-studio/internal/...` | all packages `ok` (37 packages, `[no test files]` on the ones that never had any) — covers `storage/repos` (filter_history, saved_queries), `connections`, and `adapterhost` directly |
| Tests (whole module) | `go test ./...` | same result, `./apps/kira-studio` and `./cmd/g1measure` report `[no test files]` (expected — `main` package and a standalone measurement tool) |

### 3.3 The submenu-offscreen bug, specifically

Covered in full in §1.2: reproduced against the real pre-fix CSS, fixed, re-verified against a real
implementation bug the fix's own first draft introduced (the `v-for`/`ref`-array pitfall), and
proven fixed against the corrected code — `tests/ui/tabs.spec.ts`'s `a submenu near the right edge
flips to open on the left instead of running offscreen (P23)`.

---

## 4. What this phase deliberately did not do

- **Did not touch any grid file.** §0 states the boundary; the final diff (§6, this phase's actual
  commits) crosses it nowhere.
- **Did not add `autoUpdate` to every call site uniformly.** §1.3 explains the per-site reasoning;
  applying it everywhere "to be safe" would have been the wrong kind of consolidation — one code
  path, not one config.
- **Did not preserve the `'menu'`/`'callout'` naming or the exact old left/top-edge-clamp asymmetry
  in `'callout'`.** §1.3 states the one behavioural delta this causes and why it's a fix, not a
  regression, rather than silently absorbing it into "consolidation" without saying so.
- **Did not promote `github.com/google/uuid` from indirect to direct.** It was already direct;
  §2.3 is a verification, not a migration.
- **Did not add a NEW dependency notice to `NOTICES.md`.** That file's own scope (its first line)
  is *"third-party icon assets bundled with Kira Studio's UI"* — MIT library code with no bundled
  asset/mark isn't its subject, and every other MIT/BSD library this app already depends on
  (`vue`, `zod`, `google/uuid` itself, pre-phase) has no entry there either.

---

## 5. Sources

**Measured here** (this worktree, 2026-09-03): `bun run build` before/after this phase's frontend
diff; `esbuild --bundle --minify --format=esm` + `gzip -9` for `@floating-ui/dom`'s own
`computePosition`/`flip`/`shift`/`offset`/`autoUpdate` in isolation; `registry.npmjs.org/@floating-
ui/dom` and `api.npmjs.org/downloads/point/last-week/@floating-ui/{dom,core}` for version, license
and adoption; `go build`/`go vet`/`go test`/`go mod tidy` output; the full `tests/ui/` Playwright
suite (webkit, installed fresh via `bunx playwright install webkit --with-deps` in this sandbox).

**Read directly from source**: `github.com/google/uuid@v1.6.0`'s installed module
(`$(go env GOPATH)/pkg/mod/github.com/google/uuid@v1.6.0/version4.go`) for `NewString()`'s panic
contract and `LICENSE` for BSD-3-Clause; this repo's own pre-phase `theme/anchoredPosition.ts`,
`theme/primitives/PopoverPanel.vue`, `workbench/AppTooltip.vue`, `project/ErrorPopover.vue`,
`workbench/ContextMenu.vue`, `internal/id/uuid.go`, and every one of the five Go call sites, all
cited by file:line above against the base commit `48c3abc`.

**In-repo**: `docs/ARCHITECTURE.md` ("UI architecture", Invariants, Testing sections, read in full
before touching `theme/`/`workbench/`), `AGENTS.md` (the unit-test bar, the toolchain bootstrap
steps), `docs/v1.1/plans/P22-grid-library-survey.md` (§0.1's measurement method, followed for the
bundle-size table), `docs/v1.1/plans/P19-dependency-runtime-bump.md` (the "every pin gets checked"
convention this phase's `go mod tidy` verification follows, and F12's now-superseded
`internal/id/uuid.go:7` citation — left as written, §2.4).
