# P99 — migrate every Vue file onto shadcn-vue/Tailwind/VueUse/Pinia/TanStack Query

`docs/v1.9/SPEC.md`'s P99 row, turned into concrete steps. Planned against `v1.9` at `dabae51`
(P98 landed). P98 wired the libraries and touched no `.vue` file; this phase is the migration.

Every count, path and version below was measured in this container against `dabae51` — repo
structure and call graphs through CodeGraph (`codegraph_explore`), bulk counts through `find`/
`grep`, registry reachability through live `curl`. §1 records three places P98's own plan is
already out of date, and §1.8 records a blocker P98's deviation note implies but does not state.

**This one document is the plan for all four parts** (§3). A part's implementer reads §0-§4,
its own part section (§5-§8), then §9-§14. Splitting it into four files would triple-copy §1-§4
and §9-§13; the plan-per-part rule exists so each pass's reasoning stays legible, which four
scoped part sections in one file satisfy.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Does "every `.vue` file" reach `packages/git-ui` and `packages/kira-ui`? (P98 §2.4 handed this here) | **No — `apps/kira-studio/frontend/src` only, 143 of the 200 files.** Four measured reasons, §2. One named exception: `packages/git-ui/src/components/SearchResults.vue`'s dual `<script>` block, a 5-line fix that would otherwise leave the repo with exactly one known violation of a `CLAUDE.md` standing rule | §2 |
| Does the scope need a Part split? | **Yes — four parts.** 143 `.vue` files, 41,013 lines, 7,125 lines of scoped CSS, plus 45 reactive state modules. Per `CLAUDE.md` an agent-decided split keeps the number: `P99 Part 1`…`Part 4`, never a new `P` number | §3 |
| Can `bunx shadcn-vue add` generate the components? | **No — the same registry fetch P98 root-caused still fails.** A verified direct-`curl` procedure replaces it; all 20 registry items this phase needs were fetched live and confirmed `http=200` | §1.8, §4 |
| How many stores, from how many modules? | **45 modules → 41 Pinia stores.** P98 §1.3's "39" counted `src/state/*.ts` by listing the directory; the real surface spans seven directories | §1.3, §5.2 |
| Which hand-written CSS survives? | **Only what Tailwind cannot express**, plus every class name a Playwright selector or a third-party library reads. 331 class-based selectors measured | §9, §1.7 |
| What about the 5 visual-regression baselines? | **`test:visual` runs and must stay green.** A pixel diff is a conversion bug to fix, not a baseline to bless — except the deliberate chrome changes §6.3 names, re-baselined one snapshot at a time with the reason recorded | §12 |
| One subagent or several? | **One sequential subagent per part, four parts in order.** No per-file or per-directory fan-out inside a part, by the SPEC row's own explicit instruction | §3 |
| The 255 deferred a11y findings? | **Not this phase's job (P101).** shadcn-vue's primitives carry correct roles/labels, so the count will drop as a side effect. Note what changed; do not chase it | §13 |

---

## 1. Confirmed current state

### 1.1 The file inventory

| Tree | `.vue` files | Lines | Scoped-CSS lines |
|---|---|---|---|
| `apps/kira-studio/frontend/src` | 143 | 41,013 | 7,125 |
| `packages/git-ui/src` | 46 | — | — |
| `packages/kira-ui/src` | 11 | — | — |
| **Total** | **200** | | |

124 of the 143 in-scope files carry a `<style>` block; 19 carry none.

### 1.2 There are two hand-rolled primitive layers, not one — and `kira-ui` is not this app's

The SPEC row and P98 §2.4 both point at `packages/kira-ui` as "the repo's hand-rolled primitive
layer". CodeGraph's blast radius says otherwise:

- `KuiButton` — **72 callers**, `KuiDialog` — **30**, `KuiSelect` — **6**, `KuiContextMenu` — **4**.
  Every one of them is in `packages/git-ui/src`.
- Exactly **4 files** under `apps/kira-studio/frontend/src` reference `kira-ui` at all, and **none
  is a `.vue` file**: `theme/base.css`, `theme/kui-bridge.css`, `theme/vscode-bridge.css` (CSS
  bridges) and `repo/git/gitUiModule.ts` (the lazy loader for the embedded git module).

This app's own primitive layer is `src/theme/primitives/` — 22 `.vue` files, with `AppButton.vue`
at **102 callers** (CodeGraph), plus `workbench/ContextMenu.vue`, `workbench/AppTooltip.vue`,
`workbench/ConfirmDialog.vue`. `KuiButton.vue`'s own header comment confirms the direction:
"generalises `apps/kira-studio/frontend`'s own `AppButton.vue` shape … for `packages/git-ui`'s own
toolbar/menu buttons". `kira-ui` is a copy made *for* git-ui, not a layer this app consumes.

**So the shadcn-vue replacement target for P99 is `theme/primitives/` + the workbench chrome, not
`packages/kira-ui`.**

### 1.3 State: 45 module-level `reactive()`/`ref()` modules across seven directories

P98 §1.3 measured 39 by listing `src/state/*.ts`. Two of those 39 are P98's own bootstrap
(`pinia.ts`, `queryClient.ts`), and six more directories hold the same module shape:

| Directory | Modules | Lines |
|---|---|---|
| `src/state/` | 37 | 4,585 |
| `src/api/state/` | 7 | 2,197 |
| `src/repo/state/` | 6 | 1,032 |
| `src/views/` (co-located) | 6 | — |
| `src/workbench/state/` | 2 | 327 |
| `src/project/state/` | 1 | 594 |
| `src/shortcuts/state.ts` | 1 | — |
| **Total** | **45** | |

Largest: `state/tabs.ts` 970, `api/state/collections.ts` 671, `project/state/tree.ts` 594,
`api/state/variables.ts` 558, `state/tabKinds.ts` 535, `workbench/state/tooltip.ts` 302.

**13 of them subscribe to a backend broadcast** (`control.on*Changed`) and write straight into
their `reactive` object — `state/connections.ts`, `customScripts.ts`, `dbmcp.ts`, `gitClients.ts`,
`keepAwake.ts`, `layout.ts`, `schemas.ts`, `settings.ts`, `tabs.ts`, `project/state/tree.ts`. That
subscription is multi-window sync, not a fetch; §5.4 says what happens to it.

### 1.4 Ad hoc data fetching

- `state/schemas.ts:36` `ensureDdl` — a hand-written `Map<string, Promise<string>>` of in-flight
  requests, a cache read, a race guard against a fresher write landing mid-flight, and a `finally`
  that evicts a rejected promise. 20 lines of comment explaining the cache semantics.
- `state/maskRules.ts` — `loadMaskRules` fetches and writes into `reactive`; `upsertMaskRule` and
  `removeMaskRule` each re-call the loader. A hand-rolled invalidate-after-mutate.
- `views/grid/PreviewCommandPanel.vue` — the per-component shape: `ref([])` + `loading` + `error`.

### 1.5 `<script setup lang="ts">` is already universal; one in-scope file deviates

All 200 files have a `<script setup>` block; no Options API, no `defineComponent`. Two carry a
second plain `<script lang="ts">` block, and **neither is a style lapse** — read both before
touching them:

- `views/repo/RepoTerminalView.vue:1` — module scope that must not re-run per instance, mirroring
  `editor/monaco.ts`. Carries a P97 `biome-ignore` because Biome's Vue support does not link scope
  across an SFC's two script blocks. **In scope.**
- `packages/git-ui/src/components/SearchResults.vue:1` — a named export, which `<script setup>`
  cannot carry. **Out of §2's package scope, fixed anyway** (§2.3).

Both fixes are the same move: lift the block's contents into a sibling `.ts` module and import it.
Neither is a rewrite to `<script setup>` in place — that would silently change the semantics the
block exists for. Fixing `RepoTerminalView.vue` also retires its `biome-ignore`.

### 1.6 Hand-rolled VueUse equivalents, measured

| Pattern | Files (`.vue` + `.ts`) | VueUse replacement |
|---|---|---|
| `window`/`document.addEventListener` + matching `removeEventListener` | 14 | `useEventListener` |
| `ResizeObserver` | 9 | `useResizeObserver` / `useElementSize` |
| A `setTimeout` debounce or a `debounced*` ref | 24 | `useDebounceFn` / `refDebounced` |
| `navigator.clipboard` (via `src/clipboard.ts`'s `copyText`) | 31 | `useClipboard` |
| `requestAnimationFrame` | 6 | `useRafFn` / `useResizeObserver` |
| Throttle | 3 | `useThrottleFn` |
| `onUnmounted` teardown blocks | 40 | mostly dissolve into the above |

Zero `IntersectionObserver`, `MutationObserver`, `localStorage`, `matchMedia`, `visibilitychange`
— the SPEC row names them as examples, not as findings. Say so; do not manufacture a migration.

`src/clipboard.ts` is a 3-line wrapper over `navigator.clipboard.writeText` with a 9-line comment
about returning the promise. `useClipboard` covers it; §9.3 has the caveat.

### 1.7 The gates, and two couplings a CSS migration can break

- **pre-commit**: `bun run lint` (Biome + `scripts/check-tokens.sh`), `bun run typecheck` (five
  projects; `vue-tsc` on this frontend and on `git-ui`/`kira-ui`).
- **pre-push**: `go build ./...`, `bun run lint:go`, `bun run lint:dead` (knip).
- **331 class-based Playwright selectors** across `apps/kira-studio/tests/{ui,visual}` (vs 3,176
  `data-testid` references). Most are third-party (`.view-lines` 55, `.suggest-widget` 17,
  `.slick-viewport`, `.xterm-rows`, `.monaco-*`) and untouched. App-owned ones are not:
  `.status-dot` 54, `.twisty` 38, `.kira-cell-selected` 7, `.dialog-footer` 6, `.url-field` 5,
  `.p-tree-rail` 5, `.p-conn-dot` 4, `.p-input` 3, `.node-icon` 3, `.tip-title`/`.tip-meta`/
  `.tip-body`, `.p-chip`, `.p-run-state`, `.header-key`, `.repo-head`, and more. §9.2 is the rule.
- **5 visual-regression baselines** (`connection-dialog`, `console`, `data-grid`, `schema-dialog`,
  `workbench-shell`), run by `bun run test:visual` — a **separate script**, not part of
  `test:ui` and not in either hook. P96/P97/P98 never ran it. §12 makes it a P99 gate.

### 1.8 `shadcn-vue add` cannot run here — but the registry is directly reachable

P98's deviation root-caused `init`'s failure to `ofetch` passing an `undici` `ProxyAgent` into the
runtime's global `fetch`, and noted `add` uses the same path. Re-confirmed for this plan: the
registry endpoints themselves are fine through the proxy. Live `curl` against
`https://shadcn-vue.com/r/styles/reka-nova/<name>.json`, all `http=200`:

`button` (4,063 B), `dialog`, `dropdown-menu`, `context-menu`, `tooltip`, `popover`, `select`,
`checkbox`, `input`, `separator`, `command`, `resizable`, `calendar`, `alert`, `tabs`,
`toggle-group`, `combobox`, `label`, `textarea`, `scroll-area`.

Each response is `{name, dependencies, registryDependencies, files:[{path, content}], type}`. §4 is
the write-to-disk procedure the CLI would have run.

Two facts from those payloads that change §4:

1. Registry files import siblings by the **style path**, not the alias — `DialogContent.vue` has
   `import { Button } from '@/styles/reka-nova/ui/button'`. The CLI rewrites that to the
   `components.json` alias. §4.2 does the same rewrite.
2. Icons come from **`@lucide/vue`** (`import { XIcon } from '@lucide/vue'`) — matching what P98
   actually installed (1.47.0), not the `lucide-vue-next` its own §2.1 table named. Confirmed
   `XIcon` is exported by the installed package.

`@vueuse/core` is a declared dependency of nearly every registry item (`reactiveOmit`), so the
first component landing also retires P98's `@vueuse/core` knip ignore on its own.

---

## 2. Scope decision: `apps/kira-studio/frontend/src` only

**In scope: the 143 `.vue` files under `apps/kira-studio/frontend/src`, plus the 45 state modules
beside them. Out: `packages/git-ui` (46 files) and `packages/kira-ui` (11).**

### 2.1 Why

1. **Tailwind is not in `packages/git-ui`'s build at all.** It is a second, independent Vite build
   (`packages/git-ui/vite.config.ts`, `vue()` only) targeting the VS Code webview. Including those
   57 files would mean first bootstrapping Tailwind + shadcn-vue into that build — work P98
   deliberately declined (§2.4) — and dropping Tailwind preflight into a webview whose chrome is
   themed from `--vscode-*` by a host this repo does not own the styling contract for.
2. **`packages/kira-ui` is git-ui's primitive layer, not this app's** (§1.2, measured: 4 non-`.vue`
   references from the studio app, 0 component usages). Replacing Kui\* with shadcn-vue would put
   `reka-ui` + Tailwind into the VS Code webview bundle to serve a package this app does not render
   through — while leaving this app's *actual* primitive layer, `theme/primitives/`, untouched.
3. **P100 extracts both wholesale.** Its SPEC row moves `packages/git-ui` and the studio-side git
   slice into a new `apps/kira-space`, reusing `git-ui`/`kira-ui` as they are. Migrating them now
   means doing the work and immediately moving it, and pre-commits P100's own decisions about that
   app's build and token vocabulary.
4. **`git-ui` renders in two hosts** — the VS Code webview *and*, through
   `repo/git/gitUiModule.ts`, inside this app. A styling change there is a change to both hosts'
   chrome at once, with `bun run test:webview` as the only gate on one of them.

### 2.2 What this costs, stated plainly

- P101 inherits the a11y findings in `git-ui`/`kira-ui` files as hand-fix work; no shadcn-vue swap
  will have resolved them. P101's row already scopes itself to "every finding that migration left
  behind", so this needs no SPEC change — but P101's planning pass should expect it.
- The repo keeps two primitive vocabularies (shadcn-vue here, Kui\* there) until P100 lands. That
  is already true today (`theme/primitives/` vs `kira-ui`); P99 does not create it.
- `bun run build:vscode` and `bun run test:webview` must come out **unchanged in content**, the
  same check P98 §12 used. A diff there means scope leaked.

### 2.3 The one deliberate crossing

`packages/git-ui/src/components/SearchResults.vue` (§1.5). Fix it: move the named export to a
sibling `.ts` module, delete the plain `<script>` block. Reason for crossing the boundary — the
`<script setup lang="ts">`-only rule is a `CLAUDE.md` standing rule over the whole repo, the fix is
five lines with no Tailwind, shadcn-vue or Pinia dependency, and leaving exactly one known
violation behind to honour a package boundary is worse than crossing it. Nothing else in either
package is touched. Lands in Part 1.

---

## 3. Split decision: four parts, `P99 Part 1` … `Part 4`

**A split is necessary.** 143 `.vue` files / 41,013 lines / 7,125 lines of scoped CSS, plus 45
state modules (~9,500 lines) and a shadcn-vue component set to generate. No single cold subagent
pass covers that while giving each file the judgment "one touch per file" demands — and a pass that
runs out of room mid-directory produces exactly the half-migrated tree the one-touch rule exists to
prevent.

Per `CLAUDE.md`, an **agent-decided** split keeps the phase number: `P99 Part 1: …` through
`P99 Part 4: …` in `SPEC.md`, never `P100`+ (P100 is taken, and inventing a number is the user's
call, not a subagent's). Each part gets its own implementation pass, its own commits and its own
result section; only the numbering changes.

### 3.1 The parts

| Part | Scope | `.vue` files | CSS lines |
|---|---|---|---|
| **Part 1 — libraries in place** | shadcn-vue component set generated; all 45 state modules → Pinia; the ad hoc fetches → TanStack Query; the mechanical call-site sweep; §2.3's crossing | 0 (judgment) | 0 |
| **Part 2 — shell, chrome, primitives** | `App.vue`, `theme/` (22), `workbench/` (17), `project/` (7), `shortcuts/` (1) | 48 | 2,570 |
| **Part 3 — the API client surface** | `api/` (19), `views/httprequest` (15), `views/grpcrequest` (5) | 39 | 1,607 |
| **Part 4 — data, repo, terminal, editor + final audit** | `views/{grid,console,shared,browse,definition,documents,keyvalue,stream,repo}` (45), `repo/` (8), `terminal/` (2), `editor/` (1) | 56 | 2,948 |

48 + 39 + 56 = 143. Sizing is by file count and CSS volume, not raw lines — `SlickGridHost.vue`
(2,701 lines) and `ConsoleSlickGrid.vue` (934) carry **zero** `<style>` lines, so line count
overstates their conversion work.

### 3.2 Why this order, and how it keeps "one touch per file"

The one-touch rule forbids reopening a file for a *second item from the SPEC row's list*. Two
orderings make that hold across parts rather than only inside one:

- **Part 1 does no `.vue` judgment work.** It converts stores and fetches, which rewrites import
  sites in files Parts 2-4 own. That sweep is mechanical — an import specifier and a
  `useXStore()` line, the store migration's own atomic unit — not a styling, primitive or
  composable decision. **This is the single named cross-part touch in the whole phase.** Doing it
  first means Parts 2-4 open each file with its state layer already final.
- **Part 2 holds every primitive's public API constant** while re-implementing it on shadcn-vue
  (§6.2). So Parts 3-4's 95 files need **zero** edits from Part 2, and open exactly once, for their
  own work. The repo's own precedent is `KuiContextMenu.vue`'s G34 D8 rewrite: "This component's
  own public API — every prop, every emit — is unchanged, so `RowContextMenu.vue` and all its
  consumers need zero edits."

**No parallel fan-out anywhere.** One sequential subagent per part, parts in order, each finished
and committed before the next is planned — the SPEC row's explicit instruction and `CLAUDE.md`'s
phase loop both. A part's apparent file-level independence is not grounds for an exception.

### 3.3 `SPEC.md`

This plan's own commit renames the P99 row to four `P99 Part N:` rows, each pointing at this file.
Nothing is renumbered; P100 and P101 keep their numbers and their order.

---

## 4. Getting shadcn-vue components in

### 4.1 Try the CLI once, then stop

Run `bunx shadcn-vue@2.8.2 add button` from `apps/kira-studio/frontend`. If it succeeds, the tool
chain is fixed and §4.2 is unnecessary — use the CLI for everything and say so in the result
section. If it fails with `TypeError: fetch failed` (P98's root-caused signature), go to §4.2 and
do not spend time on it: P98 already established this is not a proxy misconfiguration, not a policy
block, and not fixable by unsetting `HTTPS_PROXY` (`docs/DEV_ENVIRONMENT.md` forbids that anyway).

### 4.2 The direct-registry procedure

For each component name:

```sh
curl -sS "https://shadcn-vue.com/r/styles/reka-nova/<name>.json" -o /tmp/<name>.json
```

Then, for each entry in `files[]`:

1. Strip the `styles/reka-nova/ui/` prefix from `path`; write `content` to
   `apps/kira-studio/frontend/src/components/ui/<rest-of-path>`. That is the `ui` alias
   `components.json` already declares (`@/components/ui`).
2. Rewrite every `@/styles/reka-nova/ui/<x>` import specifier to `@/components/ui/<x>` — the
   rewrite the CLI performs (§1.8 fact 1).
3. Resolve `registryDependencies` recursively and fetch those too (`dialog` → `button`;
   `command` → `dialog`, `input-group`; `calendar` → `native-select`, `button`;
   `toggle-group` → `toggle`).
4. Check `dependencies` against root `package.json`. P98 installed `reka-ui`,
   `class-variance-authority`, `@lucide/vue`, `tw-animate-css`, `clsx`, `tailwind-merge`,
   `@vueuse/core`. Anything else a chosen component names gets added to the root
   `dependencies` in the same commit, licence checked at package level per `CLAUDE.md`.
5. `bun run format` over everything written — registry output is not Biome-formatted (double
   quotes, no `organizeImports`, different width).

Record in the result section exactly which route was used and which components landed.

### 4.3 The component set

Chosen from §10's inventory. Fetch only these; a component with no call site is dead code knip
reports.

| Registry item | Replaces | Call sites |
|---|---|---|
| `button` | `theme/primitives/AppButton.vue`, `IconButton.vue` | 102 + |
| `dialog` | `theme/primitives/DialogFrame.vue` and 12 workbench/api dialogs | 15 |
| `dropdown-menu` | `theme/primitives/PopoverPanel.vue`'s menu callers | ~20 |
| `context-menu` | `workbench/ContextMenu.vue` (see §6.3 — verify first) | 1 singleton |
| `popover` | `PopoverPanel.vue`'s non-menu callers, `project/ErrorPopover.vue`, `views/grid/FkPreviewPopover.vue` | ~8 |
| `tooltip` | `workbench/AppTooltip.vue` + `workbench/state/tooltip.ts` + the `v-tooltip` directive (see §6.4) | app-wide |
| `checkbox` | `theme/primitives/Checkbox.vue` | 10 |
| `input` | `theme/primitives/TextField.vue` | 25 |
| `label`, `separator` | ad hoc `<label>`/divider markup | many |
| `tabs` **or** `toggle-group` | `theme/primitives/SegmentedControl.vue` — pick by reading the component: it is a single-select control, so `toggle-group` with `type="single"` unless a call site genuinely needs panel semantics | 12 |
| `command` | `shortcuts/CommandPalette.vue`, `repo/QuickOpen.vue` | 2 |
| `resizable` | `theme/primitives/PanelSplitter.vue` — evaluate; decline with the reason named if the existing splitter's constraints (min sizes, persisted layout through `state/layout.ts`) do not map | 1 |
| `alert` | `theme/primitives/MessageStrip.vue`, `EmptyState.vue` | 40 |
| `scroll-area` | evaluate only where a scroll container already hand-styles a scrollbar | — |

**Not fetched, with reasons** (`CLAUDE.md` requires naming the requirement when declining):

- `calendar` / a date picker for `views/shared/DateTimePicker.vue` — that component edits a
  timestamp cell with spelling-preserving re-encoding semantics the repo built deliberately; a
  calendar widget does not cover it. Convert its CSS, leave its behaviour.
- `select` — `theme/primitives/` has no select; the app uses native `<select>` and
  `AutocompleteField.vue`. No call site.
- `combobox` — evaluate against `theme/primitives/AutocompleteField.vue` (674 lines) in Part 2. It
  is the largest primitive and carries Monaco-adjacent behaviour; if reka-ui's combobox cannot
  carry it, keep the component, convert its CSS and its `addEventListener`/debounce to VueUse, and
  record the specific requirement that declined it.
- `sonner`, `table`, `sheet`, `accordion`, `avatar`, `badge` — no hand-rolled equivalent exists.

### 4.4 knip

P98 §8 added `ignoreDependencies` for `@vueuse/core`, `reka-ui`, `class-variance-authority`,
`@lucide/vue`, `tw-animate-css`, `clsx`, `tailwind-merge` and an `ignore` for `src/lib/utils.ts`,
each with a comment naming P99 as the first consumer. **Part 1 deletes every one of those entries**
once its components land, and `bun run lint:dead` must stay clean without them. An entry that
cannot be deleted means the dependency still has no consumer — fix the consumer, never re-add the
ignore.

---

## 5. Part 1 — libraries in place

No `.vue` file's styling, primitives or composables change here. Output: the shadcn-vue component
set on disk, 41 Pinia stores, the fetch patterns on TanStack Query, and every call site updated.

### 5.1 Order

1. §4 — fetch and land the component set. Nothing imports it yet; that is Part 2's first job.
   Commit, then delete the §4.4 knip entries in the same commit that lands the first real import —
   or, if the set's own internal imports already consume every ignored package (check with
   `bun run lint:dead`), delete them here.
2. §2.3 — `SearchResults.vue`. One small commit, isolated from everything else.
3. §5.2-§5.4 — the stores, one commit per store or per tight group.
4. §5.5 — TanStack Query.

### 5.2 45 modules → 41 stores

Rules:

- **One store, one concern** (`CLAUDE.md`). Never a grab-bag. A module that already holds two
  concerns splits; two modules that are one concern merge.
- Store file stays where its module is (`state/tabs.ts` → `state/tabs.ts`), so import paths do not
  churn. Only the exported shape changes.
- **Setup stores** (`defineStore('tabs', () => { … })`), not option stores — the modules are
  already `ref`/`reactive` + functions, so a setup store is a near-transliteration and keeps every
  existing comment meaningful. It is also what `CLAUDE.md`'s `<script setup>`-only rule implies for
  consistency.
- Store id = the module's basename (`'tabs'`, `'maskRules'`). Unique; assert no collision across
  the seven directories before starting.

**The splits and merges** (read each module before acting; these are from measurement, and a module
may have changed):

| Module | Action |
|---|---|
| `state/schemas.ts` (154) | **Split 2**: `useSchemasStore` (the DDL document per connection) and `useSchemaDialogStore` (`schemaDialogState`: open + connectionId). Two concerns in one file today, named as such by P98 §1.3 |
| `state/tabs.ts` (970) | **Read before splitting.** If tab collection/activation and per-tab runtime state are separable, split; `state/tabRuntime.ts` (14) and `state/tabKinds.ts` (535) already sit beside it. If `tabKinds.ts` is pure type/dispatch data with no reactive state, it stays a plain module — **not everything becomes a store** |
| `state/connections.ts` (239) | **Split 2** if it holds both the connection list and the create/edit dialog state (the `schemas.ts` shape). Verify |
| `api/state/collections.ts` (671) | **Read before splitting** — collections tree + search + import are plausibly three concerns |
| `state/gitClients.ts` + `state/gitCredential.ts` + `state/repoOpenHold.ts` | Keep separate. P100 moves all three; merging them now creates work for P100 to undo |
| Everything else | 1:1 transliteration |

Target: **41 stores from 45 modules** (2 splits confirmed, others pending the read). The exact
number is an outcome, not a quota — record what actually landed and why it differs.

**What does *not* become a store**: a module with no module-level `reactive`/`ref` (pure functions,
constants, type dispatch tables). §1.3's list of 45 is the candidate set; anything outside it stays
as it is. `state/pinia.ts` and `state/queryClient.ts` are P98's bootstrap and are untouched.

### 5.3 The call-site sweep

`settingsState.foo` → `useSettingsStore().foo`, with the store call hoisted to a `const` at the top
of `<script setup>` rather than called inline per use. Where a store is read outside a component
(a `.ts` module, an event handler registered at import time), call `useXStore()` lazily inside the
function — Pinia needs the active instance, and P98 exported `pinia` from `state/pinia.ts`
specifically so a caller before `app.use()` can pass it. `storeToRefs` where a template
destructures.

This is the one cross-part touch (§3.2). Keep it mechanical: no CSS, no primitive, no composable
change rides along, even in a file Part 1 has open.

### 5.4 The 13 broadcast subscriptions

`control.on*Changed` subscriptions that write into the store stay exactly as they are — they are
multi-window sync from the Go side, not fetches, and TanStack Query has no better answer for a
push. Register them in the store body (setup stores run once, at first use) or keep the existing
`main.ts` hydrate call, whichever the module does today. **Do not** convert a broadcast into a
refetch: it would turn one push into N round trips and lose the "another window wrote this" origin
the existing comments rely on.

Exception: where a broadcast invalidates data that §5.5 moved to TanStack Query, the subscription
calls `queryClient.invalidateQueries({ queryKey: […] })` instead of writing a `reactive` field.
`state/schemas.ts:139`'s `onSchemaChanged` is exactly this case.

### 5.5 TanStack Query

Three named migrations plus whatever §12.3's audit finds:

1. 1. **`state/schemas.ts`'s `ensureDdl`** → `useQuery({ queryKey: ['schema', connectionId],
   queryFn: () => control.schemaGet(connectionId).then(r => r.ddl) })`. Query's own in-flight dedupe
   replaces the `pendingLoads` map; its cache replaces `byConnection`; a rejection is not cached,
   replacing the `finally` evict. **`saveDdl` becomes a `useMutation` whose `onSuccess` calls
   `setQueryData(['schema', id], result.ddl)`** — that write is what the race guard protected, and
   `setQueryData` is authoritative over an in-flight fetch, so the guard's 8-line comment
   dissolves. `onSchemaChanged` invalidates the same key (§5.4). Non-component callers
   (`editor/completion.ts`, diagnostics, hover) use `queryClient.fetchQuery` with the same key —
   the same cache, no second path.
2. **`state/maskRules.ts`** → `useQuery(['maskRules', connectionId])` plus `useMutation` for
   upsert/remove with `invalidateQueries` in `onSuccess`, replacing the hand-rolled
   re-call-the-loader. Keep the `counts` lockstep behaviour its comment describes — it is load
   bearing for `DataToolbar.vue`'s `hasMaskRules` toggle in the same tick. Verify after converting.
3. **`views/grid/PreviewCommandPanel.vue`** → `useQuery`; delete the `ref([])`/`loading`/`error`
   triple.

`staleTime`/`gcTime` are per-call-site (P98 §6 deliberately left them unset globally). Default to
`staleTime: Infinity` for data the Go side pushes a change event for (it cannot go stale silently);
give a real number only where nothing pushes.

Query keys: a flat convention, `[domain, ...ids]` — `['schema', connectionId]`,
`['maskRules', connectionId]`. Write it down in a short comment in `state/queryClient.ts` so
Parts 2-4 do not invent a second shape.

---

## 6. Part 2 — shell, chrome, primitives (48 files)

The 48 files in §10.1. This is the part every later part depends on, and the only one that changes
how the app looks at the chrome level.

### 6.1 Per file, in this order

1. Read the whole file, including its `<style>` block and every comment in it.
2. Swap hand-rolled primitives for shadcn-vue (§6.2).
3. Convert the `<style>` block to Tailwind utilities (§9).
4. Replace hand-rolled VueUse equivalents (§9.4 table).
5. Confirm `<script setup lang="ts">` (§1.5).
6. Move on. **Do not return to this file in a later part.**

### 6.2 Primitives keep their public API

`theme/primitives/AppButton.vue` (102 callers) becomes a thin wrapper over
`@/components/ui/button` — **same props** (`icon`, `variant`, `kind`, `active`, `count`), same
slot, same emitted DOM contract where a test selects on it. Same for `IconButton`, `Checkbox`,
`TextField`, `SegmentedControl`, `DialogFrame`, `MessageStrip`, `EmptyState`, `PopoverPanel`.

This is deliberate and is what makes §3.2's zero-edit guarantee hold. It is not a shim: the wrapper
is the app's own variant vocabulary (`kind: 'toolbar' | 'dialog'`, a count badge, the icon-box law
`AppButton`'s comment states) expressed over shadcn's primitive, which is exactly what
`class-variance-authority` is for — map `kind`/`variant` onto `buttonVariants` rather than
re-deriving classes.

A wrapper that ends up doing nothing but forward props — `EmptyState.vue` (20 lines),
`MessageStrip.vue` (28), `RunState.vue` (31) — is deleted and its callers import the shadcn
component directly, but **only in the part that owns those callers**. If the callers span Parts 3-4,
keep the wrapper in Part 2 and let it stand; a deletion that forces edits in 40 files across three
parts breaks one-touch for no gain.

### 6.3 `workbench/ContextMenu.vue` — the hard one

403 lines, 105 of CSS, plus `workbench/contextMenuKeys.ts` (92) and `state/contextMenu.ts` (73).
It is an **app-wide singleton opened programmatically at a point** (`contextMenuState.x/y`), with
hover-delayed submenus, roving keyboard focus, and flip/shift positioning through
`theme/floatingPosition.ts`.

reka-ui exports `ContextMenuRoot`/`Content`/`Item`/`Portal`/`Trigger`,
`DropdownMenuRoot`/`Content`/`Item`/`Portal`/`Trigger` and `PopoverAnchor` (confirmed against the
installed 2.10.5 `.d.ts`). The obstacle is that all of them are trigger-anchored, and this menu has
no trigger — it is opened from a store.

**Decide with the package in front of you, in this order:**

1. `DropdownMenuRoot` with `v-model:open` bound to `contextMenuState.open` and a zero-size anchor
   element positioned at `x`/`y`, with `DropdownMenuContent` doing the positioning. Preferred:
   reka-ui then owns the roving focus, the Escape/Tab handling, the submenu timing and the ARIA —
   which is most of what `contextMenuKeys.ts` hand-rolls, and most of what P101 would otherwise
   have to fix here.
2. `ContextMenuRoot` if its own pointer-position anchoring can be driven from the store.
3. If neither works, **keep the hand-rolled component**, convert its CSS and its
   `addEventListener`/`setTimeout` to VueUse, and record in the result section the exact
   requirement that declined the library (`CLAUDE.md` requires naming it, not just noting that the
   existing code works).

Whichever lands, `contextMenuKeys.ts` either dies with the hand-rolled handler or survives
unchanged. Do not half-migrate it.

### 6.4 `workbench/AppTooltip.vue` + the `v-tooltip` directive

`main.ts` registers `vTooltip` app-wide; `workbench/state/tooltip.ts` is 302 lines of
open/close/delay/anchor bookkeeping; `AppTooltip.vue` is the single teleported floating element.
shadcn's `tooltip` is per-trigger (`TooltipProvider` + `TooltipRoot` + `TooltipTrigger`), a
different architecture.

**Recommended**: keep the directive-plus-singleton architecture — it is a real requirement
(`v-tooltip` is used across all four parts' files and a per-trigger wrapper would mean editing
every one of them, violating one-touch for the sake of an internal refactor) — and replace only the
hand-rolled machinery inside it: `useEventListener` for the resize listener, `useTimeoutFn` for the
delay, `useFloating` from reka-ui or the existing `floatingPosition.ts` for placement. Name that
requirement in the result section. Revisit only if reading `tooltip.ts` shows the trigger set is
small enough to convert inside Part 2 alone.

### 6.5 `workbench/SettingsDialog.vue`

2,156 lines, 375 of CSS — the single largest file in the phase. It is many tabbed panes in one
file. Convert it as one file in one pass; do **not** split it into components as a side quest, and
do **not** defer it. If its size genuinely threatens the pass, it is the first commit of Part 2,
not the last.

---

## 7. Part 3 — the API client surface (39 files)

`api/` (19), `views/httprequest` (15), `views/grpcrequest` (5) — §10.2. Same per-file procedure as
§6.1, minus §6.2 (the primitives are already done; these files consume them unchanged).

Cohesive on purpose: one product area, one shared vocabulary of tables/panes/toolbars, so a
decision made in `FieldRowsTable.vue` carries to `FormDataTable.vue`, `MetadataTable.vue`,
`QueryParamsTable.vue`, `UrlEncodedTable.vue` and `RequestHeadersTable.vue` in the same pass.

Named per-file notes:

- `views/httprequest/FieldRowsTable.vue` — the only `<script setup lang="ts" generic="…">` in the
  repo (P98 §1.5). It already satisfies the rule; do not "fix" the generic away.
- `api/EditRawRequestDialog.vue`, `api/ImportCurlDialog.vue`, `project/SchemaDialog.vue` (Part 2)
  share one `debouncedText`/`setTimeout` shape — `refDebounced`, all of them.
- `views/grpcrequest/GrpcRequestView.vue` and `views/httprequest/HttpRequestView.vue` carry the
  debounce + primitive load; budget them first in the pass.

---

## 8. Part 4 — data, repo, terminal, editor + the final audit (56 files)

§10.3's files, same procedure. Plus §12.3, the phase-closing audit — it runs here because this is
the last part, and it covers all four.

Named per-file notes:

- `views/grid/SlickGridHost.vue` (2,701 lines, **0 CSS**) and `views/console/ConsoleSlickGrid.vue`
  (934, **0 CSS**) — no Tailwind work at all. Their work is VueUse (`ResizeObserver`,
  `addEventListener`, debounce, clipboard) and nothing else. Both carry a pre-existing
  `biome-ignore` for `noExplicitAny`; leave it.
- `views/repo/RepoTerminalView.vue` — §1.5's dual-`<script>` fix lands here, with its
  `biome-ignore` retired.
- `editor/MonacoHost.vue` (701/77) — Monaco owns most of its DOM. Convert the wrapper's CSS only;
  do not touch the selectors the 55 `.view-lines` / 17 `.suggest-widget` test references read
  (they are Monaco's, not this file's).
- `theme/primitives/VirtualList.vue` was converted in Part 2; if its `ResizeObserver` work suggests
  `useVirtualList`, that is a Part 2 call, and Part 4 inherits it.
- `views/shared/DateTimePicker.vue` — CSS and VueUse only (§4.3's declined `calendar`).

---

## 9. Conversion rules

### 9.1 CSS → Tailwind: what converts

Convert: layout (flex/grid/gap/padding/margin/size), typography, colour, border, radius, shadow,
opacity, cursor, overflow, transition, and every `:hover`/`:focus`/`:disabled`/`:first-child`
variant Tailwind has a modifier for.

`theme/base.css`'s existing `@theme` block already maps 24 `--kira-*` tokens onto utilities
(`bg-bg`, `text-muted`, the 12 `--color-conn-*`, `rounded-kira*`), and
`theme/shadcn-bridge.css` adds shadcn's vocabulary over the same palette. **Use those utilities;
never write a literal colour or a `var(--kira-…)` in a class where a token utility exists.** A
token with no utility gets one added to `base.css`'s `@theme` block — additively, never by editing
an existing entry.

### 9.2 What stays hand-written CSS

- Anything Tailwind cannot express: `@keyframes`, complex `grid-template-areas`, a selector
  reaching into a third-party subtree (`:deep(.slick-…)`, `:deep(.monaco-…)`, `:deep(.xterm-…)`).
- **Every class name a test selects on** (§1.7's list, and `grep` for the rest before deleting any
  class). Keep the class on the element as a marker with no rules, or with only the rules Tailwind
  cannot carry. The utilities do the styling; the class stays so the selector resolves. Never
  rewrite a test to chase a deleted class — `data-testid` is the app's convention (3,176 uses) and
  a class selector that exists is not a reason to churn 331 of them.
- Anything a `--kv-*`/`--kui-*` bridge consumes (`scripts/check-tokens.sh` gates this).

### 9.3 VueUse mapping

| Hand-rolled | Replace with | Caveat |
|---|---|---|
| `onMounted(() => x.addEventListener(…))` + `onUnmounted(remove)` | `useEventListener(target, event, fn)` | Auto-disposes. A listener registered with `capture: true` (`ContextMenu.vue`, `KuiContextMenu`) passes `{ capture: true }` — it is load-bearing, not incidental |
| `new ResizeObserver(…)` + `disconnect()` | `useResizeObserver` / `useElementSize` | `useElementSize` where only the box matters; `useResizeObserver` where the callback does work |
| `let t; clearTimeout(t); t = setTimeout(fn, MS)` | `useDebounceFn(fn, MS)` | |
| `const debounced = ref(x)` + a watcher + timeout | `refDebounced(source, MS)` | 8 sites (§1.6) |
| `navigator.clipboard.writeText` / `copyText` | `useClipboard().copy` | **`useClipboard` is a composable** — it cannot be called from `menus.ts`/`resultMenu.ts` and the other non-component call sites (19 of the 31). Keep `src/clipboard.ts` for those, implemented over `useClipboard`'s non-reactive path or left as-is with the requirement named. Do not force a composable into module scope |
| `requestAnimationFrame` loop | `useRafFn` | One-shot `rAF` (`TreeHost.vue`) is not a loop — leave it |
| Throttle | `useThrottleFn` | 3 sites |

Import from `@vueuse/core` only (P98 declined `@vueuse/components`/`/integrations`; if a needed
composable lives in one of those, add the package with the reason, do not hand-roll).

### 9.4 What not to do

- No behaviour change riding along with a conversion. If converting surfaces a bug, fix it as its
  own commit with its own message, not silently inside a styling commit.
- No `TODO`, no stubbed error path, no "converted the easy half" file. A file is done or it is not
  started (`CLAUDE.md`).
- No new abstraction invented mid-pass. If three files want the same wrapper, that is a real
  finding — make it once, in the part that owns all three, or leave it.

---

## 10. Per-file inventory

Regex-derived from the tree at `dabae51`; the implementer confirms each row against the file.
**Legend** — Primitives: `BTN` AppButton, `ICONBTN` IconButton, `DLG` DialogFrame, `POP`
PopoverPanel, `SEG` SegmentedControl, `CHK` Checkbox, `TXT` TextField, `AC` AutocompleteField,
`EMPTY` EmptyState, `MSG` MessageStrip. VueUse: `EV` addEventListener, `RO` ResizeObserver, `DEB`
debounce, `CLIP` clipboard, `TO` setTimeout, `RAF` requestAnimationFrame. Query: a local
`loading`/`error`/`isLoading` fetch triple.

Every one of the 143 files gets the CSS→Tailwind pass unless its CSS column reads `0`.

### 10.1 Part 2 — 48 files

| File | Lines | CSS | Primitives | VueUse | Query |
|---|---|---|---|---|---|
| `App.vue` | 114 | 8 | — | — | — |
| `project/ConnectionDialog.vue` | 1424 | 263 | BTN ICONBTN DLG SEG CHK TXT MSG | — | — |
| `project/DataGripImportDialog.vue` | 359 | 63 | BTN DLG CHK MSG | — | — |
| `project/ErrorPopover.vue` | 161 | 57 | BTN | EV CLIP | — |
| `project/FiltersDialog.vue` | 404 | 142 | BTN DLG CHK TXT | — | — |
| `project/ProjectTree.vue` | 247 | 32 | — | — | — |
| `project/SchemaDialog.vue` | 217 | 39 | BTN DLG | DEB TO | — |
| `project/TreeRow.vue` | 291 | 123 | — | — | — |
| `shortcuts/CommandPalette.vue` | 147 | 53 | DLG | — | — |
| `theme/CodiconIcon.vue` | 15 | 0 | — | — | — |
| `theme/EngineIcon.vue` | 185 | 0 | — | — | — |
| `theme/primitives/AppButton.vue` | 34 | 0 | — | — | — |
| `theme/primitives/AutocompleteField.vue` | 674 | 125 | BTN ICONBTN POP TXT | EV DEB CLIP TO | — |
| `theme/primitives/Checkbox.vue` | 49 | 0 | TXT | — | — |
| `theme/primitives/ColorPicker.vue` | 82 | 43 | CHK | — | — |
| `theme/primitives/DialogFrame.vue` | 147 | 43 | — | EV | — |
| `theme/primitives/EmptyState.vue` | 20 | 0 | — | — | — |
| `theme/primitives/IconButton.vue` | 99 | 57 | — | — | — |
| `theme/primitives/MessageStrip.vue` | 28 | 0 | — | — | — |
| `theme/primitives/PanelSearchBox.vue` | 77 | 34 | ICONBTN TXT | — | — |
| `theme/primitives/PanelShell.vue` | 128 | 18 | ICONBTN | — | — |
| `theme/primitives/PanelSplitter.vue` | 86 | 24 | — | — | — |
| `theme/primitives/PopoverPanel.vue` | 167 | 19 | ICONBTN POP | EV RO | — |
| `theme/primitives/ReconnectGate.vue` | 30 | 0 | BTN | — | — |
| `theme/primitives/RunState.vue` | 31 | 0 | — | — | — |
| `theme/primitives/SegmentedControl.vue` | 37 | 0 | — | — | — |
| `theme/primitives/TextField.vue` | 157 | 8 | BTN ICONBTN | — | — |
| `theme/primitives/TreeHost.vue` | 87 | 4 | — | RAF | — |
| `theme/primitives/ViewChrome.vue` | 132 | 0 | ICONBTN | — | — |
| `theme/primitives/ViewHeader.vue` | 53 | 0 | — | — | — |
| `theme/primitives/VirtualList.vue` | 198 | 18 | — | RO | — |
| `workbench/AppTooltip.vue` | 137 | 57 | POP | EV | — |
| `workbench/ConfirmDialog.vue` | 57 | 12 | BTN DLG | — | — |
| `workbench/ContextMenu.vue` | 403 | 105 | POP | EV TO | — |
| `workbench/DbMcpApprovalDialog.vue` | 191 | 36 | BTN DLG | — | — |
| `workbench/GenerateDataDialog.vue` | 435 | 65 | BTN DLG TXT MSG | — | — |
| `workbench/GitCredentialDialog.vue` | 115 | 21 | BTN DLG TXT | — | — |
| `workbench/GitPairingDialog.vue` | 122 | 16 | BTN DLG | — | — |
| `workbench/SettingsDialog.vue` | 2156 | 375 | BTN ICONBTN DLG CHK TXT | — | — |
| `workbench/StatusBar.vue` | 248 | 48 | — | — | — |
| `workbench/TitleBar.vue` | 291 | 140 | BTN | — | — |
| `workbench/UploadObjectDialog.vue` | 161 | 21 | BTN DLG TXT MSG | — | — |
| `workbench/WorkbenchShell.vue` | 154 | 72 | — | — | — |
| `workbench/panels/MainView.vue` | 35 | 0 | — | — | — |
| `workbench/panels/OperationsPanel.vue` | 444 | 164 | BTN SEG TXT EMPTY | CLIP | — |
| `workbench/panels/ProjectPanel.vue` | 54 | 4 | ICONBTN | — | — |
| `workbench/panels/StudioStart.vue` | 207 | 93 | — | — | — |
| `workbench/panels/TabStrip.vue` | 641 | 168 | ICONBTN | CLIP | — |

### 10.2 Part 3 — 39 files

| File | Lines | CSS | Primitives | VueUse | Query |
|---|---|---|---|---|---|
| `api/ApiDialogs.vue` | 25 | 0 | — | — | — |
| `api/ApiStart.vue` | 95 | 39 | — | — | — |
| `api/BulkVariablesEditor.vue` | 191 | 28 | BTN MSG | — | — |
| `api/CollectionRow.vue` | 245 | 81 | — | — | — |
| `api/CollectionsPanel.vue` | 236 | 49 | ICONBTN EMPTY | — | — |
| `api/CollectionsTree.vue` | 207 | 15 | — | CLIP | — |
| `api/CopyAsCurlDialog.vue` | 136 | 4 | BTN DLG MSG | — | — |
| `api/DynamicValuesDialog.vue` | 134 | 25 | BTN DLG EMPTY | CLIP | — |
| `api/EditRawRequestDialog.vue` | 147 | 16 | BTN DLG MSG | DEB TO | — |
| `api/EnvironmentSelect.vue` | 186 | 42 | POP SEG | — | — |
| `api/EnvironmentsView.vue` | 319 | 41 | BTN ICONBTN DLG TXT EMPTY | — | — |
| `api/ImportCurlDialog.vue` | 113 | 13 | BTN DLG MSG | DEB TO | — |
| `api/ImportReportStrip.vue` | 88 | 15 | ICONBTN MSG | — | — |
| `api/MethodSelect.vue` | 108 | 33 | POP AC | — | — |
| `api/SaveRequestDialog.vue` | 125 | 4 | BTN DLG TXT MSG | — | — |
| `api/VariableHistoryMenu.vue` | 130 | 39 | ICONBTN POP EMPTY | — | — |
| `api/VariableRow.vue` | 256 | 53 | ICONBTN CHK TXT | — | — |
| `api/VariableSetView.vue` | 584 | 51 | BTN ICONBTN DLG TXT EMPTY MSG | — | — |
| `api/VariablesOverviewPanel.vue` | 256 | 91 | POP EMPTY | CLIP | — |
| `views/grpcrequest/CallHistoryList.vue` | 189 | 39 | BTN ICONBTN EMPTY MSG | — | — |
| `views/grpcrequest/GrpcRequestView.vue` | 557 | 66 | BTN ICONBTN SEG TXT AC | DEB TO | — |
| `views/grpcrequest/MetadataTable.vue` | 310 | 29 | ICONBTN CHK TXT AC | — | — |
| `views/grpcrequest/ResponsePane.vue` | 486 | 90 | BTN ICONBTN SEG EMPTY MSG | — | — |
| `views/grpcrequest/SchemaBrowser.vue` | 276 | 72 | BTN ICONBTN SEG TXT EMPTY MSG | — | — |
| `views/httprequest/BinaryBodyPicker.vue` | 69 | 11 | BTN ICONBTN | — | — |
| `views/httprequest/CookiesPane.vue` | 254 | 74 | BTN ICONBTN AC EMPTY | — | — |
| `views/httprequest/FieldRowsTable.vue` | 408 | 36 | ICONBTN CHK TXT AC | — | — |
| `views/httprequest/FormDataTable.vue` | 179 | 16 | BTN ICONBTN TXT AC | — | — |
| `views/httprequest/HttpRequestView.vue` | 738 | 60 | BTN ICONBTN SEG TXT AC MSG | DEB | — |
| `views/httprequest/QueryParamsTable.vue` | 73 | 0 | — | — | — |
| `views/httprequest/RawExchangePane.vue` | 329 | 37 | ICONBTN EMPTY MSG | CLIP | — |
| `views/httprequest/RequestBodyPane.vue` | 251 | 16 | ICONBTN SEG MSG | — | — |
| `views/httprequest/RequestHeadersTable.vue` | 48 | 0 | — | — | — |
| `views/httprequest/RequestSettingsPane.vue` | 329 | 64 | CHK TXT | — | — |
| `views/httprequest/ResponseDiffDialog.vue` | 422 | 97 | BTN DLG MSG | — | — |
| `views/httprequest/ResponseHistoryList.vue` | 273 | 66 | BTN ICONBTN CHK EMPTY | — | — |
| `views/httprequest/ResponsePane.vue` | 546 | 75 | BTN ICONBTN SEG EMPTY MSG | — | — |
| `views/httprequest/TimelinePane.vue` | 432 | 120 | EMPTY MSG | — | — |
| `views/httprequest/UrlEncodedTable.vue` | 45 | 0 | — | — | — |

### 10.3 Part 4 — 56 files

| File | Lines | CSS | Primitives | VueUse | Query |
|---|---|---|---|---|---|
| `editor/MonacoHost.vue` | 701 | 77 | — | DEB TO | — |
| `repo/GitPanel.vue` | 753 | 188 | BTN ICONBTN SEG TXT EMPTY | CLIP | — |
| `repo/GitStart.vue` | 57 | 19 | EMPTY | — | — |
| `repo/QuickOpen.vue` | 234 | 82 | — | — | — |
| `repo/RepoFileTree.vue` | 109 | 12 | — | DEB TO | — |
| `repo/RepoReviewView.vue` | 77 | 5 | — | — | — |
| `repo/RepoSearchRow.vue` | 178 | 78 | — | — | — |
| `repo/RepoSearchView.vue` | 215 | 40 | ICONBTN TXT | — | — |
| `repo/RepoTreeRow.vue` | 154 | 75 | — | — | — |
| `terminal/TerminalPanel.vue` | 300 | 81 | BTN ICONBTN TXT EMPTY | — | — |
| `terminal/TerminalStart.vue` | 52 | 15 | EMPTY | — | — |
| `views/browse/BrowseView.vue` | 550 | 122 | ICONBTN EMPTY MSG | DEB TO | — |
| `views/console/ConsoleResultGrid.vue` | 515 | 110 | EMPTY MSG | — | — |
| `views/console/ConsoleSavedMenu.vue` | 187 | 34 | BTN ICONBTN POP TXT | — | — |
| `views/console/ConsoleSlickGrid.vue` | 934 | 0 | — | EV RO CLIP | — |
| `views/console/ConsoleView.vue` | 948 | 132 | BTN ICONBTN POP MSG | — | — |
| `views/console/ExplainResultView.vue` | 296 | 124 | ICONBTN | — | — |
| `views/definition/ColumnsSection.vue` | 144 | 57 | — | — | — |
| `views/definition/ConstraintsSection.vue` | 121 | 37 | — | — | — |
| `views/definition/DefinitionView.vue` | 394 | 32 | BTN ICONBTN SEG MSG | CLIP | — |
| `views/definition/IndexesSection.vue` | 53 | 13 | — | — | — |
| `views/definition/PropertiesSection.vue` | 45 | 10 | — | — | — |
| `views/definition/ValidationSection.vue` | 68 | 13 | — | — | — |
| `views/documents/DocumentView.vue` | 1112 | 130 | BTN ICONBTN SEG TXT AC EMPTY MSG | — | — |
| `views/documents/ProjectionMenu.vue` | 115 | 30 | BTN POP CHK | — | — |
| `views/grid/ColumnsMenu.vue` | 199 | 43 | BTN POP CHK | — | — |
| `views/grid/DataToolbar.vue` | 348 | 8 | ICONBTN SEG | — | — |
| `views/grid/DataView.vue` | 345 | 22 | ICONBTN MSG | — | — |
| `views/grid/FilterToolbar.vue` | 203 | 27 | BTN ICONBTN TXT AC | — | — |
| `views/grid/FkPreviewPopover.vue` | 284 | 92 | BTN POP | EV | — |
| `views/grid/PreviewCommandPanel.vue` | 106 | 25 | ICONBTN POP | — | yes |
| `views/grid/SlickGridHost.vue` | 2701 | 0 | BTN EMPTY | EV RO DEB CLIP TO | — |
| `views/keyvalue/KeyValueView.vue` | 30 | 7 | — | — | — |
| `views/repo/RepoDiffView.vue` | 169 | 19 | BTN EMPTY | — | — |
| `views/repo/RepoFileView.vue` | 436 | 136 | SEG EMPTY | RO DEB | — |
| `views/repo/RepoGraphView.vue` | 122 | 5 | EMPTY | RO | — |
| `views/repo/RepoMultiDiffView.vue` | 223 | 45 | BTN ICONBTN EMPTY | — | — |
| `views/repo/RepoTerminalView.vue` | 196 | 37 | — | RO DEB | — |
| `views/repo/ReviewThread.vue` | 137 | 51 | BTN | — | — |
| `views/shared/DateTimePicker.vue` | 430 | 89 | ICONBTN POP TXT | — | — |
| `views/shared/EditBufferActions.vue` | 92 | 7 | ICONBTN | — | — |
| `views/shared/FilterHistoryMenu.vue` | 256 | 34 | BTN ICONBTN POP TXT | — | — |
| `views/shared/ResponseFindBar.vue` | 214 | 18 | ICONBTN TXT | — | — |
| `views/shared/SavedListMenu.vue` | 145 | 42 | ICONBTN POP | — | — |
| `views/shared/celleditor/CellEditorDock.vue` | 61 | 17 | — | — | — |
| `views/shared/celleditor/CellEditorView.vue` | 767 | 120 | ICONBTN POP | — | — |
| `views/shared/celleditor/TimestampPane.vue` | 186 | 45 | ICONBTN POP SEG TXT | — | — |
| `views/shared/document/DocumentRow.vue` | 132 | 71 | — | — | — |
| `views/shared/document/DocumentTree.vue` | 156 | 79 | — | — | — |
| `views/shared/keyvalue/KeyValuePane.vue` | 1095 | 92 | BTN ICONBTN POP SEG TXT EMPTY MSG | — | — |
| `views/shared/page/PagerControls.vue` | 150 | 37 | ICONBTN TXT | — | — |
| `views/shared/page/SearchToolbar.vue` | 415 | 28 | ICONBTN SEG TXT | DEB TO | — |
| `views/stream/StreamComposeMessage.vue` | 166 | 41 | BTN ICONBTN POP TXT | — | — |
| `views/stream/StreamFilterHistoryMenu.vue` | 90 | 0 | — | — | — |
| `views/stream/StreamSearchToolbar.vue` | 159 | 17 | ICONBTN TXT | — | — |
| `views/stream/StreamView.vue` | 1162 | 178 | BTN ICONBTN POP SEG CHK TXT EMPTY MSG | DEB | — |

---

## 11. Commits

Conventional Commits. Granular — one coherent change per commit, so the log is the record (there is
no findings document). Each commit leaves `bun run lint` and `bun run typecheck` green; the
expensive suites run once near each part's end (`CLAUDE.md`'s "implement the whole plan first, then
test once and fix what's found").

**Part 1** — `feat(frontend): add the shadcn-vue component set`; `refactor(git-ui): move
SearchResults' named export out of its plain script block`; then one `refactor(frontend): move <X>
to a Pinia store` per store or per tight group; `feat(frontend): fetch DDL through TanStack Query`;
`feat(frontend): fetch mask rules through TanStack Query`; `chore(frontend): drop P98's knip
bootstrap ignores`.

**Parts 2-4** — one commit per directory or per cohesive file group, `refactor(frontend): migrate
<dir> to Tailwind and shadcn-vue`. `workbench/SettingsDialog.vue`, `workbench/ContextMenu.vue` and
`theme/primitives/AutocompleteField.vue` each earn their own commit. Part 4's last commits are
§12.3's audit fixes and `docs(v1.9): record P99 Part 4`.

Each part ends with its own `## P99 Part N result` section in `docs/v1.9/SPEC.md`, following P96/
P97/P98's shape: commits in order, what landed, every deviation from this plan, §12's measured
numbers. `docs/ARCHITECTURE.md`'s **Stack** row (added by P98, saying P99 migrates onto these
libraries) is updated by Part 4 to say it did.

`--no-verify` is not an ending. A red hook is root-caused and fixed, and the shipped commit passes
it clean.

---

## 12. Verification

### 12.1 Per part

Baselines are P98's result section: `test:unit` 1535, `test:webview` 55, `test:ui` 311.

| Command | Expected |
|---|---|
| `bun run typecheck` | Clean, all five projects |
| `bun run lint` | Biome 0/0/0; `check-tokens.sh` resolves every `--kira-*`/`--kv-*`/`--kui-*` |
| `bun run lint:dead` | knip clean but for the declared `duplicates` warnings. From Part 1 on, **without** P98's bootstrap ignores (§4.4) |
| `bun run build` | Clean. Record any new Vite warning |
| `bun run build:vscode` | Clean and **unchanged in content** — the §2.2 scope check |
| `bun run test:unit` | 1535 passed |
| `bun run test:webview` | 55 passed |
| `bun run test:ui` | 311 total. A failure isolates with `--workers=1` and dates with `git diff --stat dabae51` before it is called contention — P96 established the method, P97/P98 reused it |
| `bun run test:visual` | **New gate** (§12.2) |

Go is untouched; `go build`/`go vet` are the pre-push hook's job.

### 12.2 Visual regression

`bun run test:visual` runs the 5 baselines. It has not run since before P96, so **Part 1 records a
clean baseline run before changing anything** — a pre-existing diff must not be mistaken for a
conversion bug.

A diff in Parts 2-4 is a **conversion bug by default**: the Tailwind rewrite is meant to be pixel
neutral, and a shifted border or a lost `line-height` is exactly what it catches. Fix the CSS.
Re-baseline with `test:visual:update` only for a deliberate chrome change (a shadcn dialog or menu
that genuinely looks different), one snapshot at a time, naming in the result section which
snapshot and what changed. Never bulk-update.

### 12.3 The phase-closing audit (Part 4)

Thoroughness is the SPEC row's own acceptance criterion, and "the touched files look converted" is
explicitly not enough. Run each of these over `apps/kira-studio/frontend/src` and account for
**every** hit — either it is converted, or the result section names the requirement that declined
the library.

| Check | Command | Pass condition |
|---|---|---|
| No hand-rolled event wiring | `grep -rn "addEventListener" --include='*.vue' --include='*.ts'` | Every hit is inside a VueUse call, a non-component module VueUse cannot reach, or a named exception |
| No raw observers | `grep -rn "ResizeObserver\|IntersectionObserver\|MutationObserver"` | Same |
| No hand-rolled debounce/throttle | `grep -rniE "debounc\|throttl"` | Every hit is a VueUse import or a `*_MS` constant fed to one |
| No raw clipboard | `grep -rn "navigator.clipboard"` | Only `src/clipboard.ts`, and only if §9.3's caveat applies |
| No `reactive(`/module `ref(` outside a store | `grep -rnE "^(export )?const \w+ = (reactive\|ref)\(" --include='*.ts'` | Every hit is inside a `defineStore` body or a module with no shared state |
| No manual fetch triple | `grep -rn "loading = ref(\|isLoading = ref(\|error = ref("` | Zero, or a named non-server-state use |
| Every component is `<script setup lang="ts">` | `grep -c "<script" each `.vue`` | Exactly 1 per file, across all 200 (both packages included — §2.3 closed the last one) |
| Scoped CSS is what Tailwind cannot do | `grep -c` style-block lines; compare to the 7,125 baseline | A large residue is a finding: sample 10 blocks and justify each, in the result section, by category (keyframes, `:deep`, marker class, grid template) |
| knip has no P98 leftovers | read `knip.json` | None of §4.4's seven entries remain |
| No orphaned primitive | `grep -rn "theme/primitives/"` per deleted wrapper | A deleted wrapper has zero importers |
| a11y side effect (informational) | `biome check` with `biome.json`'s `**/*.vue` `a11y: off` entry temporarily removed | Record the new count against P97's 255 across 85 files. **Do not fix** — that is P101. Restore the override |

Record the audit's full output summary in Part 4's result section, including any check that found
nothing. A round that finds nothing says so rather than manufacturing a finding (`CLAUDE.md`).

---

## 13. Deliberately out of scope — confirmed, not forgotten

- **`packages/git-ui` (46 files) and `packages/kira-ui` (11)** — §2, with §2.3's one crossing.
- **The 255 a11y findings and `biome.json`'s `**/*.vue` override** — P101. §12.3 measures the new
  count as information for P101's planning pass; it fixes nothing and restores the override.
- **The three `**/*.vue` Biome rule shutoffs P97 landed** (`a11y`, `useVueHyphenatedAttributes`,
  `noNonNullAssertion`). The latter two were measured false positives against `vue-tsc` (P97's own
  result section). If a shadcn-vue swap makes one genuinely unnecessary, that is P101's finding to
  record, not P99's to act on.
- **Extracting the git module** — P100.
- **`html.formatter.enabled`** — P97 left it off deliberately (126 files of churn on an
  experimental formatter). A repo-wide template rewrite is not a reason to revisit it here.
- **A virtualizer, a date library, a toast library** — none is in P98's dependency set, and none
  has a hand-rolled equivalent this SPEC row names. `VirtualList.vue` is evaluated against VueUse
  only (§8).
- **Monaco, SlickGrid, xterm styling** — third-party DOM. Their `:deep()` selectors stay CSS.
- **Test rewrites** — §9.2. A class a test selects on is kept, not chased.

## 14. Risks

| Risk | Handling |
|---|---|
| `shadcn-vue add` still broken | §4.2's verified direct-`curl` route. Confirmed reachable for all 20 registry items |
| Tailwind preflight already applied app-wide (P98 §1.2) — a converted file may render differently than its neighbour expects | `test:visual` (§12.2) is the detector; run it per part, not once at the end |
| A class deleted from a `<style>` block breaks a Playwright selector | §9.2's marker-class rule, plus `grep` before deleting any class |
| Part 1's store sweep is enormous and mechanical — easy to break a subtle reactivity contract | Convert one store at a time, commit each, keep `typecheck` green per commit. `storeToRefs` where a template destructures |
| `workbench/ContextMenu.vue` / the tooltip directive resist the library | §6.3 / §6.4 give the fallback and require the requirement to be named, per `CLAUDE.md` |
| A part runs long and lands half a directory | Commit per directory. A part that cannot finish its list stops at a directory boundary and says so; the next part starts there rather than the plan's boundary |
