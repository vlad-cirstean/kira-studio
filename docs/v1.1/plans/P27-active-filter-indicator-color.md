# P27 — colour the filter/ORDER BY field labels when they're actually in use

> **What this phase is.** A small, contained visual-state bug, not an investigation-depth phase.
> User's own words: *"when anywhere filter or order by is actually in use make color those grey
> labels with a color so it's obvious (this one for all data views)."* Every place in the frontend
> that labels a filter/sort input field renders that label in the same grey whether the field holds
> an applied value or is empty — so a user glancing at an open tab cannot tell "this view is
> filtered/sorted right now" from "nothing is filtered." The fix colours the label only when the
> field's underlying state is genuinely applied (the tab's persisted `filter`/`sort`/`search`/
> `offsetFilter`/`timestampFilter`/`partitions`, not the live, not-yet-applied text buffer).
>
> **Every claim below was re-verified against the tree at this phase's own base commit**
> (`e2d3b87`, `fix(grid): drag-select live preview, header resize/height, inline editor box
> model`, branch `claude/feature-v1-1-p5-onwards-2isfzt`) — file:line citations point at that
> commit's content unless marked "(post-fix)".

---

## 0. Scope and non-scope

**In scope**: `frontend/src/theme/primitives.css` (the shared `.ph` prefix-label rule),
`frontend/src/theme/primitives/TextField.vue` and `AutocompleteField.vue` (both prefix-label
consumers), `frontend/src/views/grid/FilterToolbar.vue` (WHERE/ORDER BY), `frontend/src/views/
documents/DocumentView.vue` (SORT), `frontend/src/views/stream/StreamView.vue` (offset/since, and
the partition-filter button).

**Out of scope, explicitly**: anything under `frontend/src/views/grid/slick/`,
`kiraSlickGrid.ts`, `SlickGridHost.vue`, or `internal/adapters/`/`internal/connections/` — a
separate, concurrent phase (the SlickGrid migration) owns the former, and a third phase owns the
latter. This phase's diff touches zero files in either set (confirmed by the final diff, §4). The
incumbent (non-Slick) grid's own `DataGrid.vue` sort chevron (`.sort-indicator`,
`DataGrid.vue:1879`, `:2053-2060`) is `views/grid/DataGrid.vue`, not `views/grid/slick/**` — but it
needed **no change** anyway (§1.4): it's `v-if`-rendered only while a sort is active and already
uses `var(--kira-accent)`, so it was read, not edited.

---

## 1. Investigation — every filter/sort label in the frontend, checked against its actual render path

`prefix` (the labelled-input pattern, e.g. `<TextField prefix="…">`) is a distinct prop from the
unrelated `testid-prefix` string a few toolbars also pass (`DataToolbar.vue:177`, `DocumentView.vue
:559/701`, `console/ConsoleView.vue:645`, `keyvalue/KeyValueView.vue:855` — all just namespace a
`data-testid`, nothing to do with a label). Grepping the real `prefix="…"` prop across every `.vue`
file in `frontend/src` turns up exactly six call sites, and no others exist anywhere in the tree:

| Call site | Label | Field | View |
|---|---|---|---|
| `views/grid/FilterToolbar.vue:144` | `WHERE` | free-text SQL predicate | Grid (SQL/ClickHouse) |
| `views/grid/FilterToolbar.vue:159` | `ORDER BY` | free-text SQL sort | Grid (SQL/ClickHouse) |
| `views/documents/DocumentView.vue:672` | `SORT` | Mongo sort document | Documents (Mongo) |
| `views/stream/StreamView.vue:666` | `offset` | Kafka starting offset | Stream (Kafka) |
| `views/stream/StreamView.vue:720` | `since` | Kafka starting timestamp | Stream (Kafka) |

(Five listed — `DocumentView.vue`'s filter box, `documents/DocumentView.vue:658-668`, has **no**
`prefix` at all, just a placeholder; see §1.2.)

Both consumers render the identical markup for `prefix`:

- `theme/primitives/TextField.vue:62`: `<span v-if="prefix" class="ph">{{ prefix }}</span>`
- `theme/primitives/AutocompleteField.vue:245`: `<span v-if="prefix" class="ph">{{ prefix }}</span>`

and both are styled by the one shared rule in `theme/primitives.css:167-169`:

```css
.p-input .ph,
.p-input input::placeholder {
  color: var(--kira-fg-disabled);
}
```

`--kira-fg-disabled` (`theme/tokens.css:9`, `#6e6e6e`) is a *static* colour — nothing in this rule,
or anywhere else touching `.ph`, is conditioned on whether the field's value is empty or applied.
Confirmed by reading every one of the five call sites' surrounding script block (not assumed): none
passes a class or style that varies with state today. This is the literal bug — five labels, all
five genuinely grey-regardless-of-state.

### 1.1 Grid — `FilterToolbar.vue`'s WHERE / ORDER BY

`FilterToolbar.vue`'s WHERE and ORDER BY boxes are the SQL/ClickHouse grid's persistent filter row
(README's "the filter row is permanent — Clear, never close", `FilterToolbar.vue:122-123`). The
applied state already lives on the tab, independent of the live-typed buffer:

- `tab.state.filter: string | null` (`packages/shared/domain/tabs.ts:41`, `dataTabStateSchema`) —
  `null` means "no WHERE applied."
- `tab.state.sort: SortSpec | null` (`tabs.ts:42`) — `null` means "no ORDER BY applied."

`FilterToolbar.vue`'s own `whereText`/`orderByText` refs (`:40-41`) are the **live edit buffer**,
kept in sync with `tab.state.filter`/`tab.state.sort` by a `watch` (`:51-64`) but not identical to
them mid-edit — so the label's "is this on" test has to read `tab.state.filter`/`tab.state.sort`
directly, not the text ref (an in-progress, not-yet-applied edit shouldn't light the label up, and
a value that's been typed-then-cleared-then-blurred correctly goes back to unapplied).

### 1.2 Documents (Mongo) — `DocumentView.vue`'s SORT (and why the Filter box is untouched)

`DocumentView.vue`'s filter row (`:634-685`) has two boxes: a plain filter field (`:658-668`, no
`prefix`, just the placeholder `"Filter (e.g. { name: 'a' })"`) and a `SORT`-prefixed field
(`:669-681`). Checked directly rather than assumed: the filter box genuinely has no label to
recolour today (`AutocompleteField`'s `prefix` prop is simply never passed there) — so per this
phase's own rule (§0, "confirm it's actually grey-regardless-of-state," not "add a label that
doesn't exist"), that box is left alone. Only `SORT` (`:672`) gets the fix.

The applied state: `DocumentTabState.sort: SortSpec | null` (`tabs.ts:85`) — same nullable
contract as the grid's own `tab.state.sort`. `sortText` (`DocumentView.vue:162`) is the live buffer,
same divergence-during-edit reasoning as §1.1.

### 1.3 Stream (Kafka) — `StreamView.vue`'s offset / since, and the partition button

Kafka's positioning-filter row (`isKafka`-gated, `StreamView.vue:645`, SQS shows none of it — no
matching concept, `tabs.ts:117-119`'s own comment) has three independent filter dimensions, each
persisted as its own field on `StreamTabState` (`tabs.ts:141-143`):

- `offsetFilter: string | null` — the `offset`-prefixed `TextField` (`StreamView.vue:663-672`).
- `timestampFilter: string | null` — the `since`-prefixed `TextField` (`:716-727`).
- `partitions: number[]` (default `[]`) — no `prefix` label, but an `AppButton` whose own text
  (`partitionButtonLabel`, `:406-411`: `"all partitions"` when empty, `"partition N"` / `"N
  partitions"` otherwise) is exactly the same "state-bearing label rendered in one flat colour
  regardless of state" shape, just as a button rather than an input's prefix span (`AppButton`'s
  default variant colour is `--kira-fg-muted`, `theme/primitives.css:77`, unconditionally). Checked
  `AppButton.vue` directly (§0's file list): it has no prop for this ("active" already means
  "toggled open," §2.3), so this call site needs its own colour, not a new component prop.

Each of the three is a genuinely separate, independently-appliable filter (a user can set an offset
without a timestamp, or a partition subset without either) — so each label/button is coloured off
its own field, not some combined "any filter is set" flag.

### 1.4 What was checked and needed *no* change

- **`DataGrid.vue`'s column-header sort chevron** (`.sort-indicator`, `:1879`, styled `:2053-2060`):
  `v-if="currentSortDirection(...)"` — already renders only while that column is actually sorted,
  already `color: var(--kira-accent)`. This is the existing precedent this phase's colour choice
  (§2) follows, not a bug to fix.
- **`views/grid/slick/slickTheme.css`'s `.slick-sort-indicator`** (`:452-476`): also already
  `color: var(--kira-accent)` at rest, out of scope regardless (§0).
- **`keyvalue/KeyValueView.vue`**: read in full (`:641-797`, its whole `#toolbar` slot). No
  persisted query filter or sort exists for this view at all — only a page-local "search the
  already-loaded rows" toggle (`searchFilter.ts`, `IconButton :active="!!rt?.searchOpen"`,
  `:789-795`), which is a different feature (finds/highlights within what's already loaded, doesn't
  requery) with no grey label of its own. Confirmed by grep: no `prefix=` call site anywhere in this
  file. Untouched, per the task's own "don't force this fix onto a view that has no such
  indicator."
- **`console/ConsoleView.vue`**: read in full; no filter/sort UI exists there at all (it's a raw
  query console — the query text itself *is* the filter, there's no separate "is a filter on"
  label to speak of). Untouched.
- **`views/shared/page/SearchToolbar.vue`'s "show only matching rows" toggle** (`:270-276`,
  `IconButton :active="filtering"`): a page-local search-result filter, styled through the app's
  ordinary pressed-button pattern (`.p-iconbtn.is-active`, background + brightened foreground) —
  the same toggle-button convention `toolbar-search`/`toolbar-count` already use everywhere in this
  app for "is this control currently engaged," and already visually distinct from its rest state
  (filled background, not just colour). This is a different, already-working affordance from the
  reported bug (a *static* grey label that never changes at all) — left alone.
- **`project/FiltersDialog.vue`** (the project tree's object-visibility filter): a different
  feature entirely — filters which tree *nodes* are shown, not a data view's rows — opened only via
  a context-menu action (`project/menus.ts:186,313`), with no persistent toolbar indicator anywhere
  to recolour. Out of scope: the task brief's own framing ("this one for all data views") is about
  grid/document/keyvalue/stream/console row-level filtering, not the tree.

---

## 2. The fix

### 2.1 Colour choice — reusing the app's existing "this is on" accent, not inventing one

`--kira-accent` (`theme/tokens.css:13`, `#0078d4`) is already this app's one existing convention for
"this control is actively on/deviating from default," independent of this phase:

- `IconButton.vue`'s `.is-primary` (`:46-49`) and its `.has-indicator` corner dot (`:74-85`, whose
  own doc comment reads *"a plain 5px accent dot… for a button whose 'is this active/filtering?'
  state needs surfacing"* — literally this phase's exact question, already answered once for a
  different indicator shape).
- `DataGrid.vue`'s own sort chevron (§1.4) — already blue, already exists precisely so an active
  sort reads differently from an inactive column.
- `theme/primitives.css`'s `.p-btn.primary`/`.p-dlgbtn.primary` (`:91-94`, `:116-120`) for a
  dialog's primary action.

So the fix reuses `var(--kira-accent)` rather than picking a new hue — consistent with the task's
own instruction to prefer an existing token over inventing one, and with this being the one colour
every other "is this on" cue in the app already converges on.

### 2.2 `theme/primitives.css` — a conditional variant of the shared `.ph` rule

Added directly after the existing rule (`:167-169`):

```css
/* P27: a filter/sort field's own prefix label ("WHERE", "ORDER BY", "SORT", "offset", "since")
   used to render in this exact same disabled grey regardless of whether the field held an applied
   value — no visual difference between "nothing is filtered/sorted" and "this view is filtered/
   sorted right now." `--kira-accent` is this app's existing "this is on" colour elsewhere
   (IconButton.vue's `.is-primary`/`.has-indicator`, DataGrid.vue's own sort chevron) — reused here
   rather than a new one. Each caller (FilterToolbar.vue, DocumentView.vue, StreamView.vue) decides
   "active" off its own persisted tab state, not the live edit buffer (§1.1). */
.p-input .ph.ph-active {
  color: var(--kira-accent);
}
```

### 2.3 `TextField.vue` / `AutocompleteField.vue` — one new prop each, `prefixActive`

Both already own the `.ph` markup (§1). A new optional boolean prop, defaulting `false` so every
existing call site (the pager's page-jump box, the AWS `Region`/profile fields, etc. — every
`prefix=` consumer that *isn't* one of the five filter/sort fields) is byte-for-byte unaffected:

`TextField.vue` (`:16` adds the prop, `:62` reads it):

```ts
prefix?: string;
/** P27: lights the prefix label up in `--kira-accent` instead of the default disabled grey — set
 * by a filter/sort field's caller when the underlying (applied, not just typed) value is set. */
prefixActive?: boolean;
```

```html
<span v-if="prefix" class="ph" :class="{ 'ph-active': prefixActive }">{{ prefix }}</span>
```

`AutocompleteField.vue` gets the identical prop and the identical template change at `:245`.
`prefixActive` was named distinctly from the existing `active` prop on `IconButton`/`AppButton`
(§1.3's "AppButton already uses `active` to mean 'toggled open'") deliberately — a text field has no
such "is this button currently pressed" state, and reusing the name for a different meaning would
have been confusing on a component that had never had an `active` prop at all.

### 2.4 The five call sites

`FilterToolbar.vue:144` and `:159`:

```html
<AutocompleteField
  ...
  prefix="WHERE"
  :prefix-active="!!tab.state.filter"
  ...
/>
...
<AutocompleteField
  ...
  prefix="ORDER BY"
  :prefix-active="!!tab.state.sort"
  ...
/>
```

`DocumentView.vue:672`:

```html
<AutocompleteField
  v-model="sortText"
  prefix="SORT"
  :prefix-active="!!tab.state.sort"
  ...
/>
```

`StreamView.vue:666` and `:720`:

```html
<TextField
  v-model="offsetText"
  prefix="offset"
  :prefix-active="!!tab.state.offsetFilter"
  ...
/>
...
<TextField
  v-model="timestampText"
  prefix="since"
  :prefix-active="!!tab.state.timestampFilter"
  ...
/>
```

### 2.5 The one non-label case — `StreamView.vue`'s partition button

`AppButton` has no styling hook for "coloured but not toggled-open" (§1.3), so this one call site
gets an inline `:style`, mirroring the exact precedent `DataToolbar.vue:200` already uses for the
Count button's own stale-state colour (`:style="rt?.count?.stale ? { color: 'var(--kira-warn)' } :
undefined"` — same pattern, same file family, not a new idiom):

```html
<AppButton
  icon="filter"
  data-testid="stream-filter-partition"
  v-tooltip="'Filter by partition'"
  :style="selectedPartitions.length ? { color: 'var(--kira-accent)' } : undefined"
  @click="onTogglePartitionMenu"
>
  {{ partitionButtonLabel }}
</AppButton>
```

---

## 3. What this phase deliberately did not do

- **Did not touch `DocumentView.vue`'s Filter box** — it has no `prefix` label today; adding one
  would be a new affordance, not a colour fix to an existing grey one (§1.2).
- **Did not touch `KeyValueView.vue` or `ConsoleView.vue`** — neither has a persisted filter/sort
  query surface at all (§1.4).
- **Did not touch `SearchToolbar.vue`'s "show only matching rows" toggle** — a different,
  already-state-distinct affordance, not the reported bug (§1.4).
- **Did not touch `project/FiltersDialog.vue`** or its context-menu entry point — a tree-node
  visibility filter, not a data view's row filter, and has no persistent toolbar indicator to
  recolour regardless (§1.4).
- **Did not touch anything under `views/grid/slick/`, `kiraSlickGrid.ts`, `SlickGridHost.vue`, or
  any `internal/adapters/`/`internal/connections/` file** — out of this phase's scope by the task
  brief's own boundary (§0); the incumbent grid's already-correct sort chevron was read for
  precedent (§1.4), not edited.
- **Did not invent a new colour token** — `var(--kira-accent)`, already this app's one existing
  "this is on" cue (§2.1), is reused as-is.
- **Did not rename or restyle `IconButton`'s existing `active`/`AppButton`'s existing `active`
  prop** — `prefixActive` is a new, separately-named prop precisely to avoid overloading that
  existing "toggled open" meaning (§2.3).

---

## 4. Verification plan

Fast checks per commit (`bun run lint`, `bun run typecheck`, `bun run build`), then — once every
view above is fixed — the relevant `tests/ui/` specs run once as a batch per `AGENTS.md`'s cadence
rule: `data-view.spec.ts`, `autocomplete.spec.ts`, `interaction.spec.ts` (all three exercise
`filter-where-input`/`filter-orderby-input`), plus a full `--project=ui` run to catch anything
unanticipated, with results and any fixes recorded directly in the implementation commit(s) — this
plan doc is not re-edited after the fact to append a verification log (unlike P24/P25's own
convention of a §"Verification" section filled in post-hoc, this phase is small enough that the
commit message carries that record instead).

---

## 5. Sources

**Reproduced here** (this worktree, isolated per the task brief's instruction, 2026-09-03): every
file:line citation above was re-read against this phase's own base commit (`e2d3b87`) before being
cited, not carried over from memory of an earlier phase.

**In-repo**: `theme/tokens.css`, `theme/primitives.css`, `theme/primitives/{IconButton,AppButton,
TextField,AutocompleteField}.vue`, `views/grid/{DataToolbar,FilterToolbar,DataGrid}.vue`,
`views/grid/slick/slickTheme.css`, `views/documents/DocumentView.vue`, `views/stream/StreamView.vue`,
`views/keyvalue/KeyValueView.vue`, `views/console/ConsoleView.vue`, `views/shared/page/
SearchToolbar.vue`, `project/{FiltersDialog,menus}.ts/.vue`, `packages/shared/domain/tabs.ts`, all
cited by file:line above against the base commit `e2d3b87`. `docs/ARCHITECTURE.md` was checked for
an existing colour-token convention section and has none (colour conventions live in `tokens.css`/
`primitives.css` directly, per §2.1's citations); `AGENTS.md`'s "implement the whole plan first,
then test once" cadence rule (§0/§4 above) drives this phase's own verification ordering.
