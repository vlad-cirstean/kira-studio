# P6 — Vue Vapor mode

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P6 row): *"Evaluate Vue's Vapor mode
> (compiled, no-virtual-DOM rendering) against this app's own component tree, and adopt it wherever
> it genuinely helps."* Why: *"A newer Vue rendering mode with different tradeoffs than the app was
> originally built against; worth a real evaluation now that the backend rewrite is stable, rather
> than carrying an unexamined assumption either way."*
>
> **The verdict, in one line: declined — for a stated reason, with the app actually built and run
> in Vapor mode to get it.** Not "declined because it's new".
>
> **Vapor does not exist in the Vue this app runs.** `package.json:64` pins `vue@3.5.41`; that
> package contains the string `vapor` **zero times** — not in `compiler-sfc`, not in the runtime
> bundle. Vapor ships only in **3.6.0, which is not released**: as of 2026-09-01 npm's `vue@latest`
> is **3.5.42** and 3.6.0 is at **`rc.6`, published 2026-08-28 — four days before this evaluation**.
> `@vue/compiler-vapor` and `@vue/runtime-vapor` have never had a stable release at all: their npm
> `latest` tag points at a `0.0.0` placeholder whose dependencies are literally `workspace:*`.
>
> **The RC cycle is still, almost entirely, Vapor stabilisation.** Across the six `3.6.0-rc.*`
> releases (2026-07-18 → 2026-08-28), **100 of 104 changelog entries are Vapor fixes** — including
> 13 of 14 in rc.6 itself. Upstream's own guidance in that changelog: Vapor is "feature-complete in
> Vue 3.6 RC", recommended for *"partial usage in existing apps"* and *"building small new apps
> entirely in Vapor Mode"*, with *"we recommend having distinct regions in an app where one
> rendering mode or the other is used, and avoiding mixed nesting as much as possible."*
>
> **This app was nevertheless built and run in Vapor mode, three ways, on `3.6.0-rc.6`.** All 72
> SFCs are `<script setup lang="ts">`, so all 72 *compile* in Vapor with zero compiler errors. What
> the compile does not tell you is what happened next:
>
> - **Forcing Vapor while keeping `createApp()` compiles and then dies at mount** —
>   `TypeError: undefined is not an object (evaluating '…mount')`, blank `#app`. Interop is not
>   automatic; a VDOM app root cannot render a Vapor root component without `vaporInteropPlugin`.
> - **Switching to `createVaporApp()` boots and renders — and then fails 36 of the 38 `tests/ui`
>   tests** (the two survivors assert pure CSS on the window shell), all on one root cause:
>   **`v-tooltip` is an `ObjectDirective` (`workbench/state/tooltip.ts:281-297`), and Vapor's
>   custom-directive interface
>   is a plain function** — `applyDirectivesToElement` calls `dir(el, valueGetter, arg, modifiers)`
>   directly, so an object directive throws `TypeError: n is not a function` on every element it is
>   bound to. That directive is used **134 times across 41 of 72 SFCs**, and the two interfaces
>   cannot be served by one registration: VDOM's `withDirectives` normalises a function directive to
>   `{ mounted, updated }`, silently dropping the `unmounted` teardown this one needs.
> - **Porting the directive to Vapor's shape makes the app boot clean** (status bar and project
>   panel present, tooltips applied, zero console errors) — and the very first substantive spec then
>   surfaced a **Vapor-only `TypeError: null is not an object (evaluating 'cell2.connectionId')`**:
>   `CellEditorDock.vue:17,21` gates `<CellEditorView>` behind `v-if="cell"`, but under Vapor the
>   child's `sqlDialect` computed (`CellEditorView.vue:87`) re-runs with `props.cell === null`
>   *before* the parent's `v-if` tears it down. A latent non-null assumption VDOM's render ordering
>   has been hiding — found by the first spec that exercised the cell editor.
>
> **And the bundle gets bigger, not smaller.** Measured, same tree, same Vite 7.3.6 / plugin-vue
> 6.0.8: VDOM on 3.6.0-rc.6 is **1 056.12 kB (335.60 kB gzip)**; the same app fully in Vapor is
> **1 071.69 kB (340.82 kB gzip)** — **+15.6 kB raw, +5.2 kB gzip**. Vapor's runtime *is* smaller
> (a hello-world micro-app measured here: 112 149 B vs 146 798 B, **−34.6 kB raw / −10.5 kB gzip**),
> but this app is 72 template-heavy SFCs, and their compiled Vapor output costs roughly 50 kB raw /
> 16 kB gzip more than their VDOM render functions. **Selective adoption is worse still**: one
> component in Vapor plus `vaporInteropPlugin` ships both runtimes and costs **+67.9 kB raw /
> +24.2 kB gzip** over the VDOM baseline — to vaporise a single file.
>
> **And there is no rendering win to buy with any of that.** `docs/ARCHITECTURE.md:66-67` states the
> invariant Vapor's whole thesis is aimed at, and this app already satisfies it a different way:
> *"No Vue reactivity on row data. Rows live in plain frozen typed structures; the grid reads them
> imperatively and re-renders on an explicit version counter."* The grid's body is plain `<div>`s in
> a nested `v-for` over a memoised `renderRows` (`DataGrid.vue:1250`, `:1756`) — about thirty rows'
> worth of nodes, rebuilt once per rAF-coalesced scroll step, with no per-cell component and no
> per-cell reactive binding for Vapor to make finer-grained. `docs/PERF.md` §2.1 records that scroll
> work already runs at **p50 2.2 / 6.2 / 5.1 ms across its three scroll rows, against an 8 ms
> budget**, on the real macOS machine.
>
> **What is *not* being claimed:** that Vapor is bad, that it will not be right for this app later,
> or that anything here is a permanent verdict. §6 states the exact conditions under which this
> should be re-opened, and §5's D7 hands P19 a specific instruction so the decision is not
> accidentally reversed by a version bump.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `673b3b6` (`chore(shared): drop the dead Kafka stream-filter parse path`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P5 and P11 have landed. P5 in particular landed real
changes to `DocumentView.vue`, the five page stores, `views/console/state.ts`, tree state and
`main.ts`'s probe block — everything below was read against the current source, not against P5's
own prose about it.

Two facts from earlier phases matter here and both survive:

- **`docs/ARCHITECTURE.md:66-67`'s no-reactivity-on-row-data invariant.** It is the reason this
  app's hot paths are already outside the VDOM's per-binding diffing model, which is the model
  Vapor replaces. See F8.
- **`docs/PERF.md` §2.1's scroll budgets, passing.** The measurement that would justify a rendering
  rewrite does not exist, because the thing it would measure is not slow. See F8.

### 0.2 Scope

1. Establish what Vapor mode **actually is at the version this app can realistically run**, from
   the published packages and upstream's own changelog — not from recollection (§1).
2. Establish what **this app's component tree** looks like against Vapor's real constraints (§2).
3. **Actually build and run the app in Vapor mode** rather than reasoning about it (§3).
4. Produce a decision, with the conditions for revisiting it stated (§5, §6).

### 0.3 Not in this phase

- **Any adoption of Vapor mode, whole or partial.** That is the finding, not an omission (§5 D1).
- **Bumping `vue` to 3.6.x.** Version bumps are P19's row by name. §5 D7 tells P19 what to do when
  it gets there; P6 changes no pin.
- **Porting `v-tooltip` to Vapor's directive interface**, fixing `CellEditorView.vue`'s non-null
  assumption, or any other change whose only motivation is Vapor. Nothing here is a bug under the
  renderer the app actually ships; F7/E4 hand the one genuinely latent item to P12 by name.
- **Bundle splitting.** P5 F3/D8 owns that question (a single 1 049 840-byte chunk with no code
  splitting); the numbers in §3 are measured against that same un-split shape and are not an
  argument about it.
- **`.github/workflows/*.yml`** — same `workflow`-scope constraint P1 D10, P3 D15, P4 §0.3, P5 §0.3
  and `AGENTS.md`'s one Known-open-item record.
- **Editing P5's or any earlier plan doc.** `docs/v1.1/README.md`: plans are never retro-edited.

### 0.4 Ground rules

- **Every claim below is either a line read in this tree, a byte counted here, or a quote from a
  published upstream artifact.** Where a number was measured, the exact command and environment are
  named so it can be re-run.
- The experiments in §3 were run in throwaway copies of this tree under
  `/tmp/.../scratchpad/` — **no file in this repository was modified to produce them**, and none of
  them is proposed for landing.
- `AGENTS.md`'s standing rules apply to the one commit §7 proposes: Conventional Commits, no
  stubs, comments only where the code cannot say it itself.

---

## 1. Vapor mode, as it actually exists (upstream, verified)

### F1 — The Vue this app runs does not contain Vapor mode at all

`package.json:64` pins `"vue": "3.5.41"`. Read directly out of `node_modules`:

| Checked | Result |
|---|---|
| `grep -c -i vapor node_modules/vue/compiler-sfc/index.mjs` | **0** |
| `grep -o -i vapor node_modules/vue/dist/vue.runtime.esm-bundler.js` | **no matches** |
| `node_modules/@vue/` | **does not exist** (Bun hoists nothing under it) |

So "enable Vapor for this component" is not a switch that exists in the installed toolchain. It is
a **major-minor Vue upgrade**, and the rest of §1 is about what that upgrade is today.

Note the one piece of Vapor tooling this repo *does* already have: `@vitejs/plugin-vue@6.0.8`
(`package.json:53`) ships a `features.vapor` option and an `isVaporMode()` resolver, and its own
type declaration says of it — verbatim, `dist/index.d.mts` — **"Available in Vue 3.6 and later."**
The build plugin is ready; the framework it would drive is not installed.

### F2 — Vapor ships only in Vue 3.6.0, and 3.6.0 is not released

From the npm registry, read on 2026-09-01:

| Package | `latest` | `rc` | Notes |
|---|---|---|---|
| `vue` | **3.5.42** (2026-08-27) | **3.6.0-rc.6** (2026-08-28) | 3.6.0 final does not exist |
| `@vue/compiler-vapor` | **0.0.0** | 3.6.0-rc.6 | `0.0.0` is a placeholder — its `dependencies` are literally `{"@vue/shared":"workspace:*","@vue/reactivity":"workspace:*"}` |
| `@vue/runtime-vapor` | **0.0.0** | 3.6.0-rc.6 | same placeholder |

There is no `@vue/vapor` package to add to a 3.5 app, and no stable release of the two Vapor
packages in any form. In 3.6.0-rc.6, `@vue/runtime-vapor` is a **direct dependency of `vue`
itself** (`vue@3.6.0-rc.6`'s `package.json`), so adopting Vapor is not an additive install — it is
the 3.6 upgrade, whether or not a single component opts in.

The release cadence is worth reading too: `rc.1` 2026-07-18, `rc.2` 07-22, `rc.3` 08-11, `rc.4`
08-14, `rc.5` 08-21, `rc.6` 08-28. Six release candidates in six weeks, the most recent four days
before this evaluation.

### F3 — The entire RC cycle is Vapor stabilisation

Parsed out of `https://raw.githubusercontent.com/vuejs/core/minor/CHANGELOG.md` (the 3.6 branch;
`main`'s changelog only goes to 3.5.42), counting changelog bullets whose text mentions Vapor:

| Release | Date | Vapor entries / total |
|---|---|---|
| 3.6.0-rc.1 | 2026-07-18 | 11 / 13 |
| 3.6.0-rc.2 | 2026-07-22 | 14 / 14 |
| 3.6.0-rc.3 | 2026-08-11 | 35 / 36 |
| 3.6.0-rc.4 | 2026-08-14 | 12 / 12 |
| 3.6.0-rc.5 | 2026-08-21 | 15 / 15 |
| 3.6.0-rc.6 | 2026-08-28 | 13 / 14 |
| **rc total** | | **100 / 104** |
| beta total (17 releases) | | 276 / 335 |

These are not cosmetics. rc.6's list alone includes *"align DOM prop updates with VDOM"*, *"do not
skip the initial DOM prop set"*, *"clear `v-for` index alias for non-object sources"*, *"set value
as attribute so form reset restores it"*, *"render a null dynamic component as an empty branch"* —
i.e. `v-for`, DOM props and form-control behaviour were being corrected in the release published
four days ago. rc.3 (35 entries) includes *"align attrs fallthrough semantics with vdom"* and
*"preserve nested vdom slot content"*, both squarely in the interop surface a partial adoption
would live on.

### F4 — What upstream itself says, verbatim

From the same changelog's "About Vapor Mode" section (3.6.0-rc.1's release notes):

- **Status:** *"Vapor Mode is feature-complete in Vue 3.6 RC. For now, we recommend using it in the
  following cases: Partial usage in existing apps, such as implementing a performance-sensitive
  page in Vapor Mode. Building small new apps entirely in Vapor Mode."*
- **Interop:** *"When the interop plugin is installed, Vapor and non-Vapor components can be nested
  inside each other. This currently covers standard props, events, and slots usage, but does not
  yet account for all possible edge cases. … In general, we recommend having distinct regions in an
  app where one rendering mode or the other is used, and avoiding mixed nesting as much as
  possible."*
- **Unsupported, by design:** Options API; `app.config.globalProperties`; `getCurrentInstance()`
  returns `null`; `@vue:xxx` per-element lifecycle events; `v-memo`; **"Component template refs do
  not expose properties such as `$el`, `$props`, `$attrs`, `$slots`, and `$refs`."**
- **Custom directives have a different interface** — quoted in full because F6 turns on it:
  ```ts
  type VaporDirective = (
    node: Element | VaporComponentInstance,
    value?: () => any,
    argument?: string,
    modifiers?: DirectiveModifiers,
  ) => (() => void) | void
  ```
- **Behaviour:** *"Vapor Mode attempts to match VDOM Mode behavior as much as possible, but minor
  inconsistencies may still exist in edge cases because the two rendering modes are fundamentally
  different."*
- **Event delegation changed during the RC** (rc.1 breaking change): listeners are now attached
  directly by default and `document`-level delegation is opt-in via a Vapor-only `.delegate`
  modifier; `compilerOptions.eventDelegation` was removed.

### F5 — How the opt-in is actually spelled

Read out of `@vue/compiler-sfc@3.6.0-rc.6`'s `parse()` (`compiler-sfc.cjs.js:1585-1640`), so this
is the implementation and not a doc summary. `descriptor.vapor` becomes true if **any** of:

- `<script vapor>` or `<script setup vapor>` — and note `:1628`, `const isSetup = !!(attrs.setup ||
  attrs.vapor)`: **`vapor` implies `setup`**, so a plain-`<script>` Options-API SFC cannot opt in;
- `<template vapor>` — marks the whole SFC (`:1616`).

Plugin-level forcing is `vue({ features: { vapor: true } })`, whose own resolver
(`@vitejs/plugin-vue@6.0.8`, `dist/index.mjs:145-162`) forces every `<script setup>` SFC and
explicitly refuses `.vue` files with only a normal `<script>`.

So per-component adoption **is** available at 3.6 — the granularity SPEC.md's row implicitly asks
about exists. F6-F8 and §3 are about whether it buys anything here.

---

## 2. This app, measured against those constraints

### F6 — The one global custom directive is an `ObjectDirective`, and 41 of 72 SFCs use it

`main.ts:205` registers exactly one custom directive for the whole app:

```ts
createApp(App).directive('tooltip', vTooltip).mount('#app');
```

`vTooltip` (`workbench/state/tooltip.ts:281-297`) is an `ObjectDirective` with `mounted`, `updated`
and `unmounted` hooks — the `unmounted` one is load-bearing: it removes `data-kira-tip`, restores an
`aria-label` it owns, and closes/cancels a tooltip whose host element is going away.

Vapor's runtime does not accept that shape. `@vue/runtime-vapor@3.6.0-rc.6`,
`runtime-vapor.esm-bundler.js:8324-8329`:

```js
function applyDirectivesToElement(element, dirs) {
	for (const [dir, value, argument, modifiers] of dirs) if (dir) {
		const ret = dir(element, value, argument, modifiers);
		if (ret) onScopeDispose(ret);
	}
}
```

The directive is **called**. An object is not callable, and the failure is exactly what §3's E3
observed: `TypeError: n is not a function. (In 'n(t,s,i,o)', 'n' is an instance of Object)`.

Scale, counted in this tree: **`v-tooltip` appears 134 times in 41 of the 72 SFCs**, including
every hot-path view — `DataGrid.vue` (4), `ConsoleResultGrid.vue` (2), `TreeRow.vue` (3),
`DocumentRow.vue` (1), `DocumentView.vue` (11), `KeyValueView.vue` (11), `StreamView.vue` (12).

**The two interfaces cannot be served by one registration.** Global directives resolve through one
shared `appContext.directives` map for both modes, and VDOM's `withDirectives`
(`vue@3.6.0-rc.6`, `vue.runtime-with-vapor.esm-browser.js:3040-3043`) normalises a *function*
directive to `{ mounted: dir, updated: dir }` — dropping `unmounted` outright, and calling it with
`(el, binding, vnode, prevVnode)` rather than Vapor's `(el, valueGetter, arg, modifiers)`. So a
mixed-mode app needs **two implementations of the same directive under two names**, and every one
of the 134 call sites has to use the one matching its own component's mode. That is not a per-file
opt-in any more; it is a per-call-site one.

### F7 — Four sites reach a component template ref's `$el`, on the two primitives most worth vaporising

F4's unsupported list ends with *"Component template refs do not expose properties such as `$el`
…"*. This app relies on precisely that, in four places, and the source comments say so out loud
("Vue always exposes `$el` on a template ref regardless of `defineExpose`"):

| Site | What it does |
|---|---|
| `views/shared/page/SearchToolbar.vue:45,198` | `ref<{ $el: HTMLElement }>` on `TextField`; focuses `.$el.querySelector('input')` |
| `views/stream/StreamSearchToolbar.vue:41,85` | same pattern, same primitive |
| `views/console/ConsoleSavedMenu.vue:34,41` | same pattern, same primitive |
| `views/console/ConsoleResultGrid.vue:115,135` | `ref<{ scrollToIndex; $el }>` on `VirtualList`; **`getScrollElement: () => listRef.value?.$el`** — the virtualizer's scroll container |

The constraint binds on the **child**, not the parent: it is the referenced component that must not
be Vapor. So the two primitives you would most want to vaporise — `TextField.vue` and
`VirtualList.vue`, the leaf and the list machinery both rendered in bulk — are the two that cannot
be, without first rewriting these four sites. `ConsoleResultGrid.vue:135` is the sharpest case: the
console grid's entire virtualization is anchored on a `$el` Vapor does not provide.

### F8 — The hot paths are not VDOM-bound, so there is nothing for Vapor to win back

Vapor's thesis is that VDOM diffing and per-component re-render are the cost. This app already
avoids that cost by a different route, and the route is written down as an invariant
(`docs/ARCHITECTURE.md:66-67`): *"No Vue reactivity on row data. Rows live in plain frozen typed
structures; the grid reads them imperatively and re-renders on an explicit version counter."*

Read against the actual source:

- **`DataGrid.vue`** — the app's hottest component. Its body is `v-for="rowVm in renderRows"`
  (`:1756`) over plain `<div class="grid-row">` / `<div class="grid-cell">` elements: **no child
  component per row or per cell**; the only component inside the grid's own markup is
  `CodiconIcon` in a sorted header. `renderRows` (`:1250`) is one memoised computed producing view
  models for the visible window only, invalidated by `pageVersion` (`page.ts:9`) — a counter, not
  reactive row data. Scroll work is rAF-coalesced behind `__kiraGridScrollWorkStart`. Vapor's
  fine-grained per-binding effects have nothing finer to be than "rebuild ~30 rows of plain
  elements once per frame"; the array identity changes wholesale on every scroll step either way.
- **Virtualization is third-party and mode-neutral.** `@tanstack/vue-virtual@3.13.36`
  (`DataGrid.vue:369,382`, `ConsoleResultGrid.vue:131`) imports only `computed`, `unref`,
  `shallowRef`, `watch`, `triggerRef`, `onScopeDispose` — reactivity primitives shared by both
  modes. It is **not** a compatibility risk (see §4), but it is also not a beneficiary: the
  virtualizer is what keeps the node count small, and it does that identically under either mode.
- **`VirtualList.vue`** (documents / key-value / stream / browse / tree / ops / console) is the same
  story — a spacer, a slot per visible row, `startIndex`/`endIndex` arithmetic.
- **The measured position.** `docs/PERF.md` §2.1's three scroll rows: **p50 2.2 ms** (vertical),
  **6.2 ms** (horizontal) and **5.1 ms** (wide-table vertical, `scroll_grid`) of *work*, against an
  8 ms budget, on the real macOS machine, and all three rows pass. §2.1's own methodology note
  records that the p95 elevation there is a frame-scheduling artifact, not app work. There is no
  rendering deficit for Vapor to close.

The one place a no-VDOM mode would plausibly matter — thousands of independent reactive bindings
being diffed — is exactly the shape this app deliberately does not have.

### F9 — Component-tree shape: there is no "distinct region" to give to Vapor

Upstream's recommendation (F4) is distinct regions and minimal mixed nesting. This tree has no such
region:

- **31 of 72 SFCs are free of `v-tooltip`** — but they are not a *subtree*. `CodiconIcon.vue` is
  imported by **37 of 72** SFCs; `VirtualList.vue` by **7** (project tree, ops panel, documents,
  key/value, stream, browse, console results). Both are leaves rendered inside tooltip-bearing
  parents.
- **The two most self-contained candidates are blocked anyway.** `DocumentTree.vue` (recursive,
  tooltip-free, genuinely hot per expanded document row) is imported by `DocumentView.vue` and
  `ConsoleResultGrid.vue`, both tooltip-bearing, and its sibling `DocumentRow.vue` uses
  `v-tooltip` itself. `VirtualList.vue` is F7's `$el` case.
- **Every view is assembled from the same shared primitives** (`ViewChrome`, `ViewHeader`,
  `AppButton`, `IconButton`, `TextField`, `PopoverPanel`, `EmptyState`) — `docs/ARCHITECTURE.md`'s
  UI-architecture section states this as the design ("looks the same because it mounts the same
  primitives"). Shared primitives are precisely what a mode boundary cannot be drawn through.

### F10 — What is genuinely already compatible (so it is not re-litigated later)

Not everything is a blocker, and the compatible half is large:

- **All 72 SFCs are `<script setup lang="ts">`** — zero Options API anywhere, so F4's largest
  unsupported item does not apply. Four use `generic=` and they compile in Vapor unchanged.
- **The `vue` API surface the app imports is entirely mode-neutral**: `computed` (54), `ref` (45),
  `watch` (24), `reactive` (24), `onMounted` (24), `onUnmounted` (17), `nextTick` (16),
  `shallowReactive` (2), `onBeforeUnmount` (2), `watchEffect` (1), `useAttrs` (1), `shallowRef` (1),
  plus `createApp` (1) and two type-only imports. **No `getCurrentInstance`, no `v-memo`, no
  `v-once`, no `app.config.globalProperties`, no `@vue:` lifecycle events, no `defineAsyncComponent`,
  no `KeepAlive`, no `Transition`/`TransitionGroup`, no `Suspense`, no `provide`/`inject`, no
  render functions or JSX** — every one of those was grepped for and is absent.
- **`<Teleport to="body">`** (5 sites: `AppTooltip`, `ContextMenu`, `StatusBar`, `DialogFrame`,
  `ErrorPopover`) has a Vapor implementation (`VaporTeleport`) and compiled and rendered fine in §3.
- **CodeMirror** (`editor/CodeMirrorHost.vue`) is imperative DOM behind a template ref and an
  `onMounted` — it never enters Vue's rendering model at all, in either mode. It is not a risk.
- **No SSR anywhere in the pipeline, which removes Vapor's riskiest surface from consideration.**
  `vite.config.ts` builds a plain client bundle into `frontend/dist`, which `apps/kira-studio/main.go`
  embeds with `//go:embed all:frontend/dist` and Wails serves as static assets — there is no
  server render, no hydration, and `@vue/runtime-vapor`'s own README says the package "only runs in
  the browser" and ships an `esm-bundler` build only. Both facts line up with what this app does, so
  none of the SSR/hydration entries filling the RC changelog would ever be exercised here. It does
  not change the verdict; it is recorded so a future pass does not spend time on it.
- **Tooling**: `vue-tsc@3.3.11` accepts `<script setup vapor>` and typechecks the tree clean;
  `biome@2.5.10` parses it with no findings; `@vitejs/plugin-vue@6.0.8` needs no upgrade (its peer
  range `vue: ^3.2.25` admits 3.6.0 — the peer warning Bun prints during §3's install is only
  semver's prerelease rule against `3.6.0-rc.6`).

The consequence is worth stating plainly: **this app's incompatibility with Vapor is not spread
across its code.** It is four named items — one directive, four `$el` sites, one interop-shaped
latent bug, and a bundle that grows. That is why §3 could get so far so quickly, and also why §5
still declines: cheap to try is not the same as worth adopting.

---

## 3. The experiment: the app actually built and run in Vapor mode

Method: the tree at `673b3b6` copied to a scratch directory (no repo file touched), `vue` moved to
`3.6.0-rc.6`, `bun install`, then built with the repo's own `bun run build` and driven with the
repo's own `tests/ui` tier (Playwright, WebKit, static server over the real `dist`). Environment:
this Linux container, 4 cores — so **bundle bytes are exact and pass/fail is meaningful; wall-clock
timings from this box are not, and none are quoted as a result.**

### E1 — The app builds unchanged on 3.6.0-rc.6 (VDOM)

`bun run build`, no source or config change beyond the version:

| Build | Chunk | gzip |
|---|---|---|
| `vue@3.5.41`, VDOM (the shipping build) | 1 051.50 kB | 334.16 kB |
| `vue@3.6.0-rc.6`, VDOM | 1 056.12 kB | 335.60 kB |

Clean build, no errors, no source or config change. So the 3.6 upgrade *itself* is uneventful for this app —
which is what makes P19's instruction in D7 a narrow one rather than a warning about 3.6 generally.

### E2 — `features.vapor: true` compiles all 72 SFCs, and then the app does not mount

`vue({ features: { vapor: true } })` with `main.ts` unchanged. **Zero compiler errors** — 491
modules, 1 107.66 kB. Loaded in the `tests/ui` harness, `#app` is empty and the page throws:

```
[pageerror] Unhandled Promise Rejection: TypeError: undefined is not an object (evaluating 'No(Q,A).mount')
```

A `createApp()` root cannot render a Vapor root component. `vaporInteropPlugin` (or
`createVaporApp`) is mandatory, and nothing in the build tells you — the compile is green.

### E3 — `createVaporApp()`: the app renders, and then 36 of 38 `tests/ui` tests fail

`createVaporApp(App).directive('tooltip', vTooltip).mount('#app')` with `features.vapor: true`.
The workbench shell, project panel and splitters render (scope IDs intact, `data-v-…` present), and
the console fills with:

```
[error] TypeError: n is not a function. (In 'n(t,s,i,o)', 'n' is an instance of Object)
```

— F6's `ObjectDirective`, twice on first paint and on every subsequent element that binds it.
`tests/ui` (`--project=ui`, WebKit, the real built bundle), the whole tier: **36 failed, 2 passed**
(38 tests, 21.5 min). The two that passed are `workbench.spec.ts`'s pure-CSS checks — the window
inset and the scrollbar-corner colour — i.e. **every test that asserts app behaviour failed**. Every
failure inspected was a 60 s timeout waiting for an element that never appeared (a subtree whose
render aborted on the directive), and E4 confirms the cause by removing it.

### E4 — With the directive ported to Vapor's shape, the app boots clean — and a Vapor-only bug appears

`vTooltip` re-expressed as `VaporDirective` (a function using `watchEffect` over the value getter
and returning the old `unmounted` body as its cleanup), app on `createVaporApp`:

- Boot probe: `status-bar` present, `project-panel` present, 6 elements carrying `data-kira-tip`,
  **0 console errors**.
- `smoke.spec.ts` — **pass**. `tooltips.spec.ts` (the whole app-owned tooltip surface: delay,
  disabled controls, popovers, a11y) — **pass**.
- `data-view.spec.ts` (pagination, count, projection, sort, filter, search, stop, NULLs — the
  largest spec in the tier) — **every functional assertion passes**, and the spec then fails on its
  final `expect(consoleErrors).toEqual([])` with one Vapor-only error, identified against an
  unminified build:

  ```
  TypeError: null is not an object (evaluating 'cell2.connectionId')
  ```

  Mechanism, read in this tree: `CellEditorDock.vue:17` computes `cell = selectedCellFor(tabId)` and
  `:21` gates the whole dock behind `v-if="cell"`; `CellEditorView.vue:46` declares
  `cell: SelectedCell` (non-nullable), `:49` re-wraps it as `selectedCell`, and `:87` does
  `connectionRecord(selectedCell.value.connectionId)`. Under VDOM the parent's re-render unmounts
  the child before the child's computed re-runs; under Vapor the child's effect re-runs first, with
  `props.cell === null`.

  This is a latent non-null assumption in **this app's** code, not a Vue bug — but it is invisible
  under VDOM, was invisible to `vue-tsc`, and was invisible to the build. It is the concrete form of
  upstream's *"minor inconsistencies may still exist in edge cases"* (F4), found in the first
  substantive spec run. There is no reason to think it is the only one.

### E5 — Bundle sizes, measured (the claim Vapor is usually adopted for)

Every row is the same tree, same Vite 7.3.6 + plugin-vue 6.0.8, production `bun run build`, single
chunk (P5 F3 — this app has no code splitting):

| Build | Chunk | gzip | Δ vs 3.6 VDOM |
|---|---|---|---|
| 3.5.41 VDOM (**what ships today**) | 1 051.50 kB | 334.16 kB | — |
| 3.6.0-rc.6 VDOM | 1 056.12 kB | 335.60 kB | baseline |
| 3.6.0-rc.6, **all 72 SFCs Vapor**, `createVaporApp` | **1 071.69 kB** | **340.82 kB** | **+15.57 kB / +5.22 kB** |
| 3.6.0-rc.6, **one SFC Vapor** (`DataGrid.vue`) + `vaporInteropPlugin` | **1 124.02 kB** | **359.81 kB** | **+67.90 kB / +24.21 kB** |

To check that this is a property of *this app* and not of Vapor, the same measurement on a
hello-world SFC (two `ref`s, one `v-for`, one handler, one scoped style block), Vite library build, minified:

| Micro-app | raw | gzip |
|---|---|---|
| VDOM (`createApp`) | 146 798 B | 43 883 B |
| Vapor (`createVaporApp`) | **112 149 B** | **33 410 B** |
| **Vapor saving** | **−34 649 B** | **−10 473 B** |

So Vapor's runtime saving is real and about 10.5 kB gzip. This app has 72 template-heavy SFCs, and
their compiled Vapor output costs roughly **+50 kB raw / +16 kB gzip** more than their VDOM render
functions — swamping the saving. **The bundle-size argument runs backwards here.** And the
selective row is the important one for SPEC.md's "adopt it wherever it genuinely helps": partial
adoption ships *both* runtimes plus interop, so the first vaporised component costs 24 kB gzip
before it renders anything.

### E6 — Tooling behaves, except that the type layer does not know about the mode

- `bunx biome check` on a `<script setup vapor>` SFC: clean.
- `vue-tsc --noEmit` with `<script setup vapor>` on `DataGrid.vue`: **clean**.
- `vue-tsc --noEmit` with `features.vapor` + `createVaporApp(App)`: **one error**, and it is the
  interesting one —
  `Argument of type 'DefineComponent<…>' is not assignable to parameter of type 'VaporComponent'`
  at `main.ts:205`. The plugin-level `features.vapor` switch lives in `vite.config.ts`, which
  `vue-tsc` never reads, so **the type checker and the bundler disagree about what every component
  is**. Combined with E4, the practical position is: *neither the build nor the type checker can
  see a Vapor migration's real failure modes; only running the app can.*

---

## 4. Checked, and not fired

Stated explicitly so a later pass does not re-derive them. Each was read or run, not assumed.

| Checked | Verdict |
|---|---|
| **`@tanstack/vue-virtual@3.13.36`** — the one third-party Vue library in the tree | **Compatible.** Imports only `computed`, `unref`, `shallowRef`, `watch`, `triggerRef`, `onScopeDispose` — reactivity, shared by both modes. It is not a blocker (F8); it is also not a beneficiary. |
| **CodeMirror 6 integration** (`editor/CodeMirrorHost.vue`, mounted by 8 components) | **Not affected either way.** Imperative DOM inside a template ref; it never participates in Vue rendering. |
| **Options API** | **Absent.** All 72 SFCs are `<script setup lang="ts">`; F4's biggest unsupported item does not apply to this tree at all. |
| **`generic=` SFCs** (`VirtualList.vue`, `SegmentedControl.vue`, `SavedListMenu.vue`, `page/SearchToolbar.vue`) | **Compile in Vapor unchanged** (E2/E3 built all four). |
| **`<Teleport>`** (5 sites) | **Supported** (`VaporTeleport`); rendered correctly in E4's boot probe. |
| **`v-memo` / `v-once` / `getCurrentInstance` / `globalProperties` / `@vue:` events** | **None present.** Grepped; zero occurrences each. |
| **`defineAsyncComponent`** | **Not used anywhere** — so `defineVaporAsyncComponent` and async-boundary interop are moot. (P5 D8 contemplated introducing one for the CodeMirror chunk; that stays P5's question, and F10 notes CodeMirror is mode-neutral regardless.) |
| **`provide`/`inject`** | **Not used** — zero occurrences; cross-mode injection is moot. |
| **Scoped styles / `:deep()`** (72 scoped blocks, 38 `:deep()`) | **Work.** Vapor emits the same `data-v-…` scope IDs; verified in E4's rendered DOM. |
| **`defineExpose`** (11 sites) | **Not a blocker on its own** — a Vapor component can expose. F7's `$el` accesses are the blocker, and they are explicitly *not* exposed: `TextField.vue` has no `defineExpose` at all, and `VirtualList.vue:146` exposes only `scrollToIndex` while `ConsoleResultGrid.vue:135` reads `$el` beside it. |
| **Event delegation / `stopPropagation`** (8 explicit calls, 27 `@click.stop`, 1 `@contextmenu.prevent.stop`) | **A real interop hazard, not evaluated further** — rc.1 changed Vapor's default to direct attachment, so the delegation/`stopPropagation` interaction upstream documents applies only to `.delegate` opt-ins this app would never write. Recorded because it is the kind of thing that would need re-checking if the decision is ever revisited (§6). |
| **`shallowReactive` tree/search state, frozen pages, `pageVersion` counters** (P5 §3) | **Mode-neutral.** Reactivity is the same system in both modes; none of P5's memory findings or fixes interacts with the rendering mode. |

---

## 5. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **Do not adopt Vapor mode — neither wholly nor selectively — in this phase, and do not stage any of it.** | F1/F2: it does not exist in `vue@3.5.41`, and 3.6.0 is unreleased (`rc.6`, four days old at time of writing) with `@vue/{compiler,runtime}-vapor` having no stable release at all. F3: 100 of 104 RC changelog entries are Vapor fixes, including `v-for`, DOM-prop and form-control corrections in rc.6 itself. This app ships as a **packaged, ad-hoc-signed macOS desktop build with no auto-update** (`docs/PACKAGING.md`; `docs/ARCHITECTURE.md`'s "No auto-update") — a renderer regression reaches users as a shipped binary, not as a redeploy that can be rolled back. |
| **D2** | **Selective adoption is rejected on its own merits, not merely deferred with the rest.** | E5: partial adoption ships both runtimes plus interop — **+67.9 kB raw / +24.2 kB gzip to vaporise one component**, against a whole-app Vapor saving that is itself negative (+15.6 kB / +5.2 kB). F9: there is no "distinct region" to give it — `CodiconIcon` is in 37 of 72 SFCs, `VirtualList` in 9 parents, and upstream explicitly recommends against exactly the mixed nesting this tree would require. F6: the one global directive would need two implementations and a per-*call-site* choice across 134 sites. |
| **D3** | **The rendering-performance premise does not hold for this app, and that is the decisive finding — not the release status.** | F8: `docs/ARCHITECTURE.md:66-67` already excludes row data from reactivity; `DataGrid.vue:1250,1756` renders plain elements from a memoised view-model array with no per-cell component and no per-cell binding; both grids are virtualized by a mode-neutral library; `docs/PERF.md` §2.1 records scroll work at **p50 2.2 / 6.2 / 5.1 ms across its three scroll rows against an 8 ms budget, passing**. Vapor removes a cost this app does not pay. Even if 3.6.0 shipped stable tomorrow, D1 would still be *decline*, for this reason. |
| **D4** | **Record the four concrete blockers by name** — the `ObjectDirective` (F6), the four `$el` template refs (F7), the interop-ordering assumption in `CellEditorView.vue` (E4), and the negative bundle delta (E5) — **as the checklist any future re-evaluation starts from.** | §6 needs a starting point that is not "read the whole tree again". These four are what a future Vapor attempt has to answer first, and three of them were only found by running the app. |
| **D5** | **Do not "fix" anything in service of a mode the app does not use.** `v-tooltip` stays an `ObjectDirective`; the four `$el` refs stay; `vite.config.ts:11` stays `vue()` with no `features` block. | `AGENTS.md`: scope left out of a phase is left out entirely, not half-implemented. Every one of those changes is a no-op-or-worse under the renderer that ships, and a half-ported directive is exactly the kind of "ready for later" debt that is never collected. |
| **D6** | **`CellEditorView.vue`'s non-null assumption is handed to P12 (code review) by name, not fixed here.** The finding: `CellEditorDock.vue:17,21` gates on `v-if="cell"` while `CellEditorView.vue:46,49,87` assumes `props.cell` is non-null; the guarantee is the parent's render ordering, which is not a guarantee the child states or the types check. | It is genuinely latent — it cannot fire under VDOM, so there is no bug to fix in P6's scope, and P6 must not smuggle a defensive rewrite of a shared view into a docs phase. But it is exactly the kind of implicit-invariant finding P12's correctness round exists to catch, and it should not be lost with this document. |
| **D7** | **P19 (dependency bump) bumps `vue` to 3.6.x when it is stable, and must leave the renderer in VDOM mode**: no `features.vapor` in `vite.config.ts`, no `vapor` attribute in any SFC, `main.ts:205` stays `createApp(...)`. E1 shows the 3.6 upgrade itself is uneventful for this app; `@vitejs/plugin-vue@6.0.8` needs no bump for it (peer `^3.2.25` admits 3.6.0). | P19's row says "bump every dependency … to the latest available stable release". Vue 3.6 will be that. Vapor is 100% opt-in and stays off — this decision must not be reversed as a side effect of a version bump, which is precisely how an unexamined assumption gets re-created in the opposite direction. |
| **D8** | **Land exactly one change for this phase: the decision, recorded in `docs/ARCHITECTURE.md`.** No code, no config, no comment in `vite.config.ts`. | `AGENTS.md`: app facts live in `docs/ARCHITECTURE.md`, and "the renderer is VDOM-mode Vue, deliberately" is an app fact a future session would otherwise re-derive from scratch — this document plus §6's trigger is the durable record, and one line in the authoritative file is what points at it. A code comment would be a comment about something the code does not do, which is the kind `AGENTS.md` says not to write. |

---

## 6. When to re-open this

Not "when Vapor is stable" — that alone is not sufficient, because D3 is not about stability. All
of the following should hold before the question is worth another evaluation:

1. **`vue@latest` is 3.6.x or later** (Vapor released, not RC), and it has been the `latest` tag long
   enough to have a patch history — the `0.0.0` placeholders on `@vue/{compiler,runtime}-vapor` are
   replaced by real stable versions.
2. **A measured rendering deficit exists** — i.e. `docs/PERF.md` §2.1's grid-scroll budget is
   *failing* on the macOS machine for reasons attributable to render work, not frame scheduling.
   Absent that, D3 stands regardless of Vapor's maturity.
3. **The app has a subtree that is genuinely a region** — a view whose components are not shared with
   the rest of the workbench and do not use `v-tooltip`. Today it does not (F9). A future feature
   might.
4. **D4's four blockers have answers**, in this order: what `v-tooltip` becomes (F6), what replaces
   the four `$el` refs (F7), what the interop-ordering audit found beyond `CellEditorView.vue` (E4),
   and a re-measured bundle delta (E5) — because the E5 numbers are a property of *this* app's SFC
   count and template volume, and both will have changed.

If a future session re-runs the experiment: §3's method is the whole recipe — copy the tree, move
the `vue` pin, `bun install`, `bun run build`, then `playwright test --project=ui`. It produced
every number in this document in one session, most of that spent waiting on the WebKit tier rather
than on the port itself.

---

## 7. Implementation

**There is nothing here for a Sonnet implementer beyond one docs commit.** That is the honest
outcome of the phase, not an under-specification: D1-D3 decline adoption, D5 forbids preparatory
changes, and D6/D7 are instructions carried forward to P12 and P19 rather than work for P6.

### C1 — `docs: record the renderer's VDOM-mode decision (P6)`

One file, `docs/ARCHITECTURE.md`, two touches:

1. **The Stack table's `| UI |` row** (`:29`) — its Note cell is currently empty. Fill it with a
   single sentence naming the mode and pointing at this plan, e.g.:

   > VDOM mode — Vapor mode evaluated and declined in P6 (`docs/v1.1/plans/P6-vue-vapor-mode.md`)

2. **The `## UI architecture` section** (`:518`) — add one short bolded paragraph, in that
   section's existing voice ("the structural rules a future session needs to not reinvent"), saying:
   the renderer runs in Vue's VDOM mode deliberately; Vapor mode was evaluated against this tree in
   P6 and declined; the reason is not that it is new but that this app's hot paths already sit
   outside the VDOM's per-binding model (pointing at the existing no-reactivity-on-row-data
   invariant, `:66-67`) and that partial adoption would ship both runtimes; and that a Vue 3.6
   upgrade keeps VDOM mode. Keep it to a few sentences and let the plan doc carry the evidence —
   `AGENTS.md` is explicit that a phase's findings live in its plan, not bolted into another file.

Do **not** change: `package.json`'s `vue`/`@vitejs/plugin-vue`/`vite` pins,
`apps/kira-studio/frontend/vite.config.ts`, `main.ts`, `workbench/state/tooltip.ts`, or any SFC.
Do **not** add a "do not enable Vapor" comment to `vite.config.ts` (D8).

**Verify:** `bun run lint` clean. Nothing else can regress — no code changed.

---

## 8. Verification

There is no behavioural change to verify. What must be true when this phase closes:

1. `git diff` for the phase touches **exactly two files**: this plan and `docs/ARCHITECTURE.md`.
2. `bun run lint` is clean.
3. `package.json`'s `vue` pin is still `3.5.41`, `vite.config.ts:11` is still
   `plugins: [vue(), tailwindcss()]`, and no SFC contains the string `vapor`.
4. `docs/ARCHITECTURE.md` states the mode and points at this document.

The `tests/ui`, `tests/ipc` and Go tiers are untouched and are not re-run for this phase beyond
whatever the branch's normal gate already runs.

---

## 9. Acceptance checklist

- [ ] Vue's real Vapor availability established from the published packages, not recalled — F1
      (3.5.41 contains no Vapor), F2 (3.6.0 unreleased; `0.0.0` placeholders), F3 (100/104 RC
      entries are Vapor fixes), F4 (upstream's own status text and unsupported list).
- [ ] The app's component tree judged against those constraints with file:line evidence — F6
      (the directive, 134 sites / 41 SFCs), F7 (the four `$el` refs), F8 (why the hot paths are not
      VDOM-bound), F9 (no distinct region), F10 (what is already compatible).
- [ ] Build-tooling compatibility answered by building, not by reading — E1, E2, E6.
- [ ] The app actually run in Vapor mode, with the results recorded — E3 (36 of 38 `tests/ui` tests
      fail on the directive; the 2 survivors assert only CSS), E4 (boots clean once the directive is
      ported, and one Vapor-only latent bug surfaces in the first substantive spec).
- [ ] The bundle claim measured in both directions — E5 (app: +15.6 kB whole / +67.9 kB partial;
      micro-app: −34.6 kB, proving the saving is real but swamped here).
- [ ] A decision stated with its reason and its expiry conditions — D1-D3, §6.
- [ ] Findings that outlive the phase handed to their owners by name — D6 → P12, D7 → P19.
- [ ] Exactly one commit of work identified (C1), and the reason there is not more stated
      explicitly (§7).

---

## 10. Open questions, handed forward

- **OQ-1 → P12.** `CellEditorView.vue`'s non-null `props.cell` assumption (D6/E4). The narrow
  question for the correctness round: does the child state, or check, the invariant its parent's
  `v-if` provides — and are there other parent-gated children in this tree with the same shape?
  (`ReconnectGate` consumers and the per-view `CellEditorDock` mounts are the obvious places to
  look.)
- **OQ-2 → P19.** Bump `vue` to 3.6.x once stable, VDOM mode retained (D7). E1 measured the 3.6
  upgrade at +4.6 kB raw / +1.4 kB gzip with no source change; expect the real bump to be
  uneventful, and treat anything larger as a finding worth recording.
- **OQ-3 → whoever revisits.** §6's four conditions. In particular, E5's numbers are a property of
  this app's current SFC count and template volume; they are worth re-measuring rather than
  re-quoting.
