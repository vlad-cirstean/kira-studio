# P9 — Row coloring settings

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P9 row): *"A settings toggle to
> disable the data grid's row coloring — when off, every row renders white/plain. Separately, drop
> the distinct color currently applied to string-typed cell values in the grid; strings render in
> the plain text color like every other type."* Why: *"User-directed UI change: row coloring should
> be optional, and string values shouldn't stand out from other types by color."*
>
> **The headline, in one line: the grid's "row coloring" is not a background, a stripe, a parity
> rule or a hash — it is a per-*column* text colour derived from the column's `typeClass`, applied
> as an inline `color` style on every body cell, and there is exactly one function that decides
> it.** `DataGrid.vue`'s `colorForColumn` (`:110-113`) looks the page's own
> `ColumnDescriptor.typeClass` up in `theme/icons.ts`'s `CATEGORY_COLOR` (`:185-195`), and
> `renderRows` writes the answer into each `CellVM.color` (`:1290`), rendered as
> `:style="{ … color: cellVm.color || undefined }"` (`:1795`). Turning row colouring off is
> therefore one early return, not a styling rework.
>
> **There is no zebra striping to disable, and the code says so in as many words**:
> `DataGrid.vue:2008-2012` — *"No zebra striping — the design's own `_gridrows.html`/`_style.css`
> draws no alternating row colour, only the hover state below."* Verified: no `nth-child`, `:odd`,
> `:even` or row-parity rule exists anywhere in the renderer's CSS. Grid rows are already
> background-transparent; "renders white/plain" is about the *text*, which in this app's one dark
> palette means `--kira-fg` (`#cccccc`).
>
> **The string colour is one table row.** `CATEGORY_COLOR.string` is `var(--kira-syntax-string)`
> (`#ce9178`, `tokens.css:98`). Dropping it is a one-value edit — but `uuid` is a *second* row
> pointing at the same token (`icons.ts:191`), and leaving it behind would recreate exactly the
> cross-surface divergence the P46-7 comment above it was written to close (F4). Both move.
>
> **The settings pattern this hangs off is already boolean-shaped and already has a precedent
> leaf**: `appearance.wordWrap` (P42 D14) is a `z.boolean().default(true)` in
> `packages/shared/domain/settings.ts:14`, a `bool` in `model.AppearanceSettings`
> (`model/settings.go:9`), one `leaf()` call in `repos/settings.go:57`, one `if` in
> `SettingsRepo.Set` (`:93-97`), and one checkbox in `SettingsDialog.vue:233-245`. `appearance.rowColoring`
> is the same five edits. **No migration and no schema-version bump**: `settings` is one row per
> leaf with a per-leaf fallback to `model.DefaultSettings()` (`repos/settings.go:53-61`), so an
> existing `kira.sqlite` with no `appearance.rowColoring` row resolves to the default and behaves
> exactly as it does today.
>
> **Themes are not a factor, because there is exactly one theme.** v1's P38 Catppuccin plan was
> written and never implemented — there is no `data-theme` attribute, no `appearance.theme` leaf and
> no second palette anywhere in the tree (F6). Every colour this phase touches is already a
> `--kira-*` custom property, so a future theme family keeps working with no P9-shaped follow-up.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `905c346` (`docs(v1.1): close out P8's acceptance checklist against what actually
ran`), branch `claude/feature-v1-1-p5-onwards-2isfzt`. P1-P8, P10 and P11 have landed.

**P8's own storage work does not touch this phase's subject.** `0002_p8_windows.sql` creates
`windows` and rebuilds `tabs` for `window_key`; it does not read, write or migrate the `settings`
table, and P8 added no settings leaf. What P8 *does* establish and P9 inherits for free:
`docs/ARCHITECTURE.md:791-794` puts settings firmly on the **app-wide** side of the per-window
line, and `SettingsService.Set` broadcasts the merged settings with `Emit` — the
every-window delivery shape, not `EmitFocused` (`internal/bridge/settings.go:38`). So toggling row
colouring in one window repaints the grid in every open window, with no P9 work at all (D6).

### 0.2 Scope

1. A new persisted boolean setting, `appearance.rowColoring` (default `true` — today's behaviour),
   plumbed through the shared Zod schema, the Go model, the repo, and the Settings dialog's
   Appearance section, following `appearance.wordWrap` exactly.
2. `DataGrid.vue` renders every body cell in the plain foreground colour when it is off.
3. Independently of the toggle: text/string-classed values lose their distinct colour and render in
   the plain foreground colour, in the one shared colour table (`theme/icons.ts`'s
   `CATEGORY_COLOR`), `uuid` included.
4. One `tests/ui/` spec covering all three states (on, off, and strings-plain-while-on).

### 0.3 Not in this phase

- **P17's apply-on-save settings rework.** P9 lands its toggle using today's apply-immediately
  pattern (`patchSettings` on `@change`, with `SettingsDialog.vue:24-36`'s open-time
  `initialSettings` baseline that Cancel patches back). See D7 for why the two do not need
  sequencing in either direction.
- **Retiring the other three type colours.** Numbers, booleans and temporals keep their VS Code
  Dark Modern hues while the toggle is on. The row asks for strings only.
- **The type-colour *badges*** — the column-header tooltip's `metaColor`
  (`views/shared/page/columns.ts:203`), the cell editor's data-type badge
  (`CellEditorView.vue:400`) and the definition view's Structure column
  (`ColumnsSection.vue:59`, `:68`). These are chrome describing a column, not rows of data; the
  toggle leaves them alone. D3.
- **A per-connection or per-tab colouring override.** One app-wide appearance setting, like every
  other leaf in that section.
- **Any change to the state colours** a cell can carry — NULL, FK, staged edit, current search
  match. Each is a semantic signal with its own class rule, and each already outranks the type
  colour today (`DataGrid.vue:1286-1290`). D4.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is **[verified in source]** against this
  tree at the cited `file:line`, or **[verified here]** where it was executed in this sandbox.
- **No new dependency, no new abstraction.** The whole phase is one schema field, one Go field, two
  repo lines, one checkbox, one early return and one table row.
- **No unit test.** `AGENTS.md`'s bar — a boolean setting and a lookup-table row are not
  "genuinely complex or deeply-nested logic"; the `tests/ui/` spec in §6 is the guard, and it is the
  only new test this phase adds.
- **Comments only where the code cannot say it for itself.** Exactly one comment is genuinely owed:
  `icons.ts:168-184`'s existing block states the old rule ("number/string/boolean map onto the token
  VS Code itself gives that literal kind") and must be corrected rather than left lying, since the
  string row is the thing being changed out from under it.

---

## 1. What the code does today

### 1.1 The grid's only "row colour" is a per-column type colour on the cell text

**[verified in source]** The chain, end to end:

| Step | Location | What it does |
|---|---|---|
| 1 | `views/grid/DataGrid.vue:110-113` | `colorForColumn(name)` reads `columnByName.get(name)?.typeClass` — the adapter's own authoritative `typeClassFor()` verdict, carried on the page's `ColumnDescriptor` — and returns `typeClassColor(typeClass)`, or `''` when the column is unknown. |
| 2 | `theme/icons.ts:129-144` | `categoryForTypeClass` maps the six wire `TypeClass` values onto nine render categories: `number→numeric`, `boolean→boolean`, `temporal→datetime`, `text→string`, and `binary`/`json`/`other` all onto `other`. |
| 3 | `theme/icons.ts:185-195` | `CATEGORY_COLOR` is the whole colour vocabulary: `numeric: var(--kira-syntax-number)`, `boolean: var(--kira-syntax-keyword)`, `datetime: var(--kira-syntax-control)`, `uuid`/`string: var(--kira-syntax-string)`, and `json`/`array`/`binary`/`other: var(--kira-fg)`. |
| 4 | `views/grid/DataGrid.vue:1259-1265` | `renderRows` builds `colorByCol` **once per visible column per render**, not per cell (a P46-6/7 fix, its own comment). |
| 5 | `views/grid/DataGrid.vue:1286-1290` | Each `CellVM.color` is that column's colour — **unless** the cell is NULL, an FK link, a staged edit, or the current search match, each of which already carries a meaningful colour via its own class rule; those get `''` so an inline style never silently outranks a higher-priority signal. |
| 6 | `views/grid/DataGrid.vue:1795` | The template writes it: `:style="{ …, color: cellVm.color || undefined }"`. |

So: **a row's colouring is a function of its columns' declared types, nothing else.** It is not
computed from row parity, not from the row's values, not from a hash, and not from the connection's
own colour (`theme/connColor.ts`'s `connColorVar` is used by tab rails, tree rails, op-log dots and
menu swatches — `TabStrip.vue:179`, `MainView.vue:44`/`:133`, `OperationsPanel.vue:217`,
`ContextMenu.vue:212`/`:255` — and by nothing in `views/grid/`).

### 1.2 There is no row background to turn off, and the code already says so

**[verified in source]** `.grid-row` (`DataGrid.vue:1997-2006`) sets `position`, `left`, `right` and
`contain: layout` — no background at all. The next declaration is the comment quoted in the
headline (`:2008-2012`): no zebra striping, by design, matching the design system's own
`docs/design/kira-design-system/parts/_gridrows.html`, which draws no per-cell colour either.
A row acquires a background only from hover (`:2010-2012`), a pending insert (`:2210-2212`), or a
cell-level class (`.selected`, `.search-match`). Grepping the whole renderer for `nth-child`,
`:odd`, `:even` or any alternating-row rule returns nothing in `views/`.

**Therefore "when off, every row renders white/plain" is a statement about text**, and the plain
colour is `--kira-fg` = `#cccccc` (`theme/tokens.css:7`) — near-white against `--kira-bg` `#1f1f1f`,
which is what "white" means in this app's one dark palette.

### 1.3 How a setting is stored, read and applied today

**[verified in source]** Five files, one leaf, and `appearance.wordWrap` as the template:

1. `packages/shared/domain/settings.ts:6-15` — `appearanceSettingsSchema`, with
   `wordWrap: z.boolean().default(true)` and its own comment recording why `.default(true)` is
   load-bearing (a row saved before the field existed must still parse); `:58-74` — `defaultSettings`.
2. `apps/kira-studio/internal/storage/model/settings.go:5-10` (`AppearanceSettings`), `:32-46`
   (`DefaultSettings`, *"mirrors packages/shared/domain/settings.ts's defaultSettings verbatim"*),
   `:51-56` (`AppearancePatch`, every leaf a pointer), `:105-121` (`Validate`, per-leaf, bounds only
   — `WordWrap` needs no case, because a `bool` has no invalid value).
3. `apps/kira-studio/internal/storage/repos/settings.go:53-61` — `GetAll` starts from
   `model.DefaultSettings()` and overlays one `leaf(...)`/`leafValid(...)` call per key; `:77-98` —
   `Set` writes only the leaves actually patched, in one transaction, then re-reads.
4. `apps/kira-studio/internal/bridge/settings.go:30-40` — merge, conditionally re-push the cache
   budget, `Emit(ChannelSettingsChanged, merged)` to every window, return the merged settings.
5. `apps/kira-studio/frontend/src/state/settings.ts` — `settingsState` is one `reactive<Settings>`
   (`:9`); `patchSettings` (`:50-62`) applies the patch optimistically, awaits `settingsSet`, then
   re-assigns from the returned settings; `applyAppearance` (`:19-28`) pushes font/row-height into
   CSS custom properties and bumps `appearanceVersion`.
6. `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue:71-73` (`onWordWrapChange`) and
   `:233-245` (the `label.field.checkbox` + `data-testid="settings-word-wrap"`).

**A component consumes a setting by reading `settingsState` inside a `computed`** — `DataGrid.vue:66`
(`rowHeight`) is the existing precedent inside this very component, so reactivity from a settings
change into a grid re-render is already proven in the tree, not assumed.

---

## 2. Findings

### F1 — "Row coloring" is per-column type colouring of cell text, and it lives in one function
**[verified in source]** §1.1. `DataGrid.vue:110-113` is the single decision point, called from
exactly one place (`:1264`). Nothing else in `views/grid/` sets a colour on a body cell.

### F2 — There is no alternating/parity/hash row colour anywhere to disable
**[verified in source]** §1.2. `DataGrid.vue:2008` states it as an intentional design decision, and
the rest of the renderer has no alternating-row rule at all.

### F3 — The data grid is the *only* view that colours values by type
**[verified in source]** `typeClassColor`/`columnTypeColor` have exactly five call sites
(`grep -rn "typeClassColor\|columnTypeColor" apps packages`): `DataGrid.vue:19`/`:112`,
`views/shared/page/columns.ts:204` (column-header tooltip badge), `CellEditorView.vue:400` (cell
editor's type badge), `ColumnsSection.vue:59`/`:68` (definition view's Structure table), and
`icons.ts` itself. `ConsoleResultGrid.vue`, `StreamView.vue`, `KeyValueView.vue` and
`DocumentRow.vue` colour no cell value at all — every `color:` in their scoped styles is chrome
(`--kira-fg-muted`, `--kira-fg-disabled`, `--kira-error`). **So the toggle has exactly one consumer,
and the string change has one consumer plus three badges.**

### F4 — `uuid` points at the same string token, and only the string-guessing path can reach it
**[verified in source]** `CATEGORY_COLOR.uuid` is `var(--kira-syntax-string)` (`icons.ts:191`), and
`categoryForTypeClass` (`:129-144`) never returns `uuid` — the wire `TypeClass` set has no UUID
member, so a UUID column reaches the grid as `text`. `uuid` is reachable only through
`columnTypeCategory`'s string guess (`:93`), whose one caller is the definition view's Structure
table. The comment at `:179-184` says why they were deliberately unified: *"a live cross-check
against MariaDB's own native UUID column confirmed the grid and cell editor … already colour it that
way — this keeps the Structure pane's own string-guessing path from being the one place left
disagreeing."* **Changing `string` without `uuid` would put that divergence straight back.**

### F5 — No migration, no schema bump, no orphan
**[verified in source]** `repos/settings.go:53-61` starts from `model.DefaultSettings()` and
overlays only the keys actually present in the `settings` table; `leaf`/`leafValid` (`:142-169`)
return early on a missing key. An existing database simply has no `appearance.rowColoring` row and
resolves to `true`. On the TypeScript side `.default(true)` does the same for a `Settings` object
parsed from an older shape. **P8's `0002_p8_windows.sql` touches `windows` and `tabs` only** — no
`settings` statement anywhere in it — so nothing in the P8 migration interacts with this leaf.

### F6 — Themes are not a factor: there is exactly one palette in the tree
**[verified here]** `grep -rn "data-theme\|appearance.theme\|kira-dark"` over
`apps/`+`packages/` returns nothing; `theme/tokens.css` declares one `:root` block and there is no
second palette file. v1's `docs/v1/plans/P38-catppuccin-themes.md` was written but never
implemented. Both colours this phase deals with are already custom properties
(`--kira-syntax-string`, `--kira-fg`), so a future theme family re-skins them for free and this
phase adds no new hard-coded colour to find later.

### F7 — In `tests/ui/`, a settings *write* is answered by a wildcard that echoes the defaults back
**[verified in source]** `tests/ui/support/mockRuntime.ts:154` answers `settingsSet` with
`JSON.stringify(defaultSettings)` whenever a spec supplies no snapshot of its own. Because
`patchSettings` re-assigns `settingsState` from the response (`state/settings.ts:57-61`), a spec
that ticks the checkbox and supplies nothing would see the flag flip and then immediately flip back.
**A spec that drives the dialog must supply its own `settingsSet` snapshot**; the mock's
single-snapshot shortcut (`mockRuntime.ts:345` — `list.length === 1 ? list[0] : …`) means one
snapshot answers regardless of the exact patch args, so this costs one array entry. This is
non-obvious and is the one thing most likely to be got wrong in §6.

### F8 — The `tests/ui/` tier can boot the app with any settings it likes
**[verified in source]** `tests/ui/support/bootSnapshots.ts:31` answers `settingsGetAll` with
`defaultSettings`, and `mergeBootSnapshots` (`:42-46`) lets a spec **replace** that channel's
snapshot outright. So "boot with row colouring off" is one override, no dialog interaction needed —
which is what makes the off-state assertion independent of F7's write path.

---

## 3. Checked, and not fired

- **A row-background rule hiding in a shared stylesheet.** `theme/base.css`, `theme/primitives.css`
  and `theme/tokens.css` carry no `nth-child`/parity rule and no `.p-tr` background. Nothing to
  disable outside `DataGrid.vue`.
- **Connection colour bleeding into rows.** `connColorVar` is never imported by `views/grid/`.
- **The console's tabular result.** `ConsoleResultGrid.vue` renders no per-type cell colour, so it
  needs no gate and gains nothing from one (F3).
- **A generated-bindings runtime hazard.** `frontend/bindings/**/model/models.ts` emits plain TS
  `interface`s (checked: `AppearanceSettings` at `:28-33`), not classes with a `createFrom`
  constructor, so nothing on the response path can silently drop a field the generated model does
  not know about. Regenerating bindings is still required for type fidelity (§5 C2), but it is not
  load-bearing for correctness.
- **Existing tests asserting a type colour.** `grep -rn "ce9178\|syntax-string\|metaColor"` over
  `apps/kira-studio/tests/` returns nothing — no spec pins the string colour, so C1 breaks no test.
- **`Validate` needing a new case.** Bounds validation exists only for enums and numeric ranges
  (`model/settings.go:105-121`); `WordWrap` has no case and neither does a second bool.

---

## 4. Decisions

**D1 — The setting is `appearance.rowColoring`, a boolean defaulting to `true`.** Same section, same
shape and same five-file path as `appearance.wordWrap`. `true` is today's behaviour, so an existing
install and a fresh one both look exactly as they do now until the user says otherwise.

**D2 — The toggle is enforced in `colorForColumn`, not in CSS.** One early return
(`if (!settingsState.appearance.rowColoring) return '';`) makes `CellVM.color` `''` for every cell,
which the template already renders as *no inline style at all* (`:1795`'s `|| undefined`), so cells
inherit `--kira-fg`. A CSS-class approach cannot work: an inline `style` beats any class rule short
of `!important`, and adding `!important` to fight code this phase already owns is strictly worse.
Reactivity comes for free — `colorForColumn` is called from inside the `renderRows` computed
(`:1264`), so reading `settingsState` there makes the setting a tracked dependency, exactly like
`rowHeight` at `:66`.

**D3 — The toggle governs grid *body cells* only, not the type badges.** The column-header tooltip's
type chip, the cell editor's type badge and the Structure table's type column each describe *a
column's declared type* — that is what the colour is *for* there, and it is one badge on screen, not
a wall of tinted values. The SPEC row scopes the toggle to "the data grid's row coloring". Gating
them too would need the setting threaded into three more components for no stated need.

**D4 — The toggle does not touch the four state colours.** NULL (`--kira-fg-disabled`, italic), FK
(`--kira-info`), staged edit (`--kira-warn`) and current search match (`--kira-bg` on
`--kira-search-match-current`) are signals, not decoration, and `renderRows:1286-1290` already
excludes each of them from the inline type colour. "Every row renders white/plain" means no
type-derived colour; a NULL that stopped being visibly NULL would be a regression, not the ask.

**D5 — The string colour is dropped in `CATEGORY_COLOR`, for `string` *and* `uuid` together — not
overridden in the grid.** Both become `var(--kira-fg)`, joining `json`/`array`/`binary`/`other`,
which already resolve there. The alternative — special-casing `text` inside `colorForColumn` —
leaves the grid saying "plain" while the header tooltip, the cell editor and the Structure table
still say `#ce9178` for the same column, which is precisely the cross-surface divergence
`icons.ts:179-184` was written to close (F4). One vocabulary, four surfaces, agreeing: that property
is worth more than keeping an orange chip in a tooltip. `icons.ts:168-184`'s comment block is
rewritten in the same commit to state the new rule and why, since it currently documents the old
one. *If the user later wants the badges to keep the hue*, the narrow variant is a one-line override
in `colorForColumn` — recorded here so the trade is visible, not re-derived.

**D6 — Nothing multi-window is needed.** Settings are app-wide (`docs/ARCHITECTURE.md:791-794`) and
`SettingsService.Set` already broadcasts with `Emit`, the every-window shape (P8's own
`Emit`/`EmitTo`/`EmitFocused` split, `internal/bridge/settings.go:38`); every window's
`onSettingsChanged` subscription (`state/settings.ts:46-47`) reassigns `settingsState`, and each
window's grid recomputes. This is asserted by inspection, not by a new test — the broadcast shape is
P8's subject and already has its coverage there.

**D7 — P9 does not wait for P17, and P17 is not made harder by P9.** P17 (settings panel
apply-on-save + revert-to-defaults) rewrites `SettingsDialog.vue`'s commit mechanism for *every*
control; a fourth Appearance checkbox written in the established shape is one more control to stage,
not a new mechanism to unwind. In the other direction, P9 needs nothing from P17: today's
apply-immediately path is what makes the toggle's effect visible while the dialog is still open,
which is the desirable behaviour for a visual setting either way. Two concrete pieces of P17-facing
plumbing come free: `SettingsDialog.vue:24-36`'s open-time `initialSettings` clone is built from
`settingsState.appearance` wholesale, so Cancel already reverts the new leaf with no extra code; and
`defaultSettings`/`model.DefaultSettings()` already carry its default, which is what P17's
revert-to-defaults button will read. **Recommendation: implement P9 now, against today's pattern.**

**D8 — One new test, in `tests/ui/`.** Three assertions in one spec (§6). No unit test: per
`AGENTS.md`, a boolean leaf and a lookup-table row are plumbing, and the Go repo's per-leaf
read/write is a CRUD round-trip the bar explicitly excludes.

---

## 5. Implementation order

Four commits, in this order. Each is independently revertible; C1 is deliberately first because it
is the one change that needs no new setting to exist.

### C1 — `refactor(theme): string values render in the plain text colour`

- `frontend/src/theme/icons.ts`: `CATEGORY_COLOR.uuid` (`:191`) and `CATEGORY_COLOR.string`
  (`:193`) → `var(--kira-fg)`.
- Rewrite the comment block at `:168-184` so it states the rule that now holds — numeric, boolean
  and temporal carry a VS Code Dark Modern token colour; every other class, strings and UUIDs
  included, renders in the plain foreground — and keeps the *why* for the three that remain. Delete
  the sentences that only justified the string/uuid colouring; do not leave them contradicting the
  table two lines below.
- Nothing else changes: `columnTypeColor`/`typeClassColor` keep returning a non-empty string for
  every category, so `metaColor: typeClassColor(...) || undefined` (`columns.ts:204`) behaves
  exactly as it already does for an `other`-classed column.

### C2 — `feat(settings): row colouring is a setting`

- `packages/shared/domain/settings.ts`: `rowColoring: z.boolean().default(true)` in
  `appearanceSettingsSchema` (beside `wordWrap`, with a one-line comment stating that
  `.default(true)` keeps a pre-P9 stored shape parsing to today's behaviour), and
  `rowColoring: true` in `defaultSettings.appearance`.
- `internal/storage/model/settings.go`: `RowColoring bool \`json:"rowColoring"\`` on
  `AppearanceSettings`; `RowColoring: true` in `DefaultSettings`; `RowColoring *bool` on
  `AppearancePatch`. No `Validate` case (a bool has none — same as `WordWrap`).
- `internal/storage/repos/settings.go`: one `leaf(stored, "appearance.rowColoring",
  &result.Appearance.RowColoring)` in `GetAll`, and the matching `if a.RowColoring != nil { …
  upsertSettingsLeaf(tx, "appearance.rowColoring", *a.RowColoring) }` in `Set`.
- No migration file, no `schema_version` bump (F5).
- Regenerate bindings: `cd apps/kira-studio && wails3 generate bindings -b -i -ts -names` — the
  generated `model/models.ts` `AppearanceSettings`/`AppearancePatch` interfaces must carry the new
  field before `bun run typecheck:web` and `bun run build` run (§6).

### C3 — `feat(grid): a settings toggle turns the grid's type colours off`

- `SettingsDialog.vue`: `onRowColoringChange` beside `onWordWrapChange` (`:71-73`), and a
  `label.field.checkbox` in the Appearance pane with `data-testid="settings-row-coloring"`, label
  **Row colouring**, and helper text naming what it does and what off looks like — e.g. *"Colour
  grid values by their column's data type. Off renders every row in the plain text colour."*
  Placement: directly after the Word wrap checkbox, so the two booleans sit together.
- `DataGrid.vue`: the early return in `colorForColumn` (D2). No other change — `renderRows`,
  `CellVM`, the template binding and every CSS rule stay exactly as they are.

### C4 — `test(ui): the row-colouring toggle, and strings render plain`

The spec described in §6.1. New file, `apps/kira-studio/tests/ui/row-coloring.spec.ts`.

**No `docs/ARCHITECTURE.md` change.** Its Storage section already describes `settings` generically
(*"fonts, sizes, budgets, toggles"*), its UI-architecture section documents structural rules rather
than the per-type colour vocabulary, and this phase introduces no new mechanism, invariant or
subsystem fact. Saying so here is the record; inventing a paragraph to have a docs commit would be
padding.

---

## 6. Verification

### 6.1 The `tests/ui/` spec — the whole phase is provable in this sandbox

`tests/ui/` drives the real built bundle (real Vue, real `bridge/{control,port}.ts`) in real WebKit
with both wire planes mocked, so a settings toggle plus a rendered grid is exactly the shape it
covers. Existing pattern to follow: `tests/ui/data-view.spec.ts` (`:72` `bigRowsFixture(CONNECTION_ID)`,
`:1180-1202` `connectAndExpand`, `:1213-1219` dblclick the table row and wait for
`[data-testid="data-grid"]`) and `tests/ui/perf.spec.ts:118-143` for the shorter variant.

`bigRowsFixture`'s page is the right fixture with no new capture needed: `BIG_ROWS_COLUMNS`
(`tests/ui/support/postgresFixture.ts:749-765`) is exactly one `typeClass: 'number'` column (`id`)
and one `typeClass: 'text'` column (`hash`), which is the minimal shape that distinguishes all three
states. Cells are addressable as
`[data-testid="grid-cell"][data-row="0"][data-column="id"|"hash"]` (`DataGrid.vue:1784-1788`), and
the assertion is `getComputedStyle(cell).color`:

| Expected | Value | Source |
|---|---|---|
| `--kira-syntax-number` | `rgb(181, 206, 168)` | `tokens.css:99` (`#b5cea8`) |
| `--kira-fg` | `rgb(204, 204, 204)` | `tokens.css:7` (`#cccccc`) |

Three scenarios:

1. **Colouring on (default boot) — a number column is coloured, a text column is not.** Boot with
   the stock snapshots, open `app.big_rows`, assert `id`'s cell colour is the number token and
   `hash`'s is `--kira-fg`. This is the C1 guard: before C1 it would read `rgb(206, 145, 120)`.
2. **Colouring off at boot — both columns are plain.** `relaunch({ control: [...FIXTURE.control,
   { channel: IPC.settingsGetAll, response: { ...defaultSettings, appearance: {
   ...defaultSettings.appearance, rowColoring: false } } }] })` — `mergeBootSnapshots` replaces the
   default `settingsGetAll` outright (F8, `bootSnapshots.ts:42-46`). Assert both cells read
   `rgb(204, 204, 204)`, and — the stronger claim — that neither cell carries an inline `color` at
   all (`el.style.color === ''`), which is what D2 actually produces.
3. **Flipping the toggle live repaints the open grid.** With the grid open, click
   `[data-testid="open-settings"]` (`StatusBar.vue:131`), the Appearance section is already active
   (`SettingsDialog.vue:40`), click `[data-testid="settings-row-coloring"]`, close the dialog, and
   assert `id` has gone plain. **This scenario must supply its own `settingsSet` snapshot returning
   the flipped `Settings`** — otherwise `mockRuntime.ts:154`'s wildcard echoes the untouched
   defaults back and `patchSettings` reverts the flag (F7). One entry suffices, since a channel with
   exactly one snapshot answers regardless of args (`mockRuntime.ts:345`).

### 6.2 Running it here

**[verified here]** This container has no Playwright browsers cached
(`~/.cache/ms-playwright` does not exist), so the implementer runs `bunx playwright install webkit`
plus the system libraries its own post-install warning names before the first run — the procedure
`apps/kira-studio/playwright.config.ts:12-16` already documents. Then:

```
bun run test:ui                 # builds the bundle first, then --project=ui
bun run lint && bun run typecheck && bun run build
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
```

No Docker, no container, no `xvfb`, no real backend — none of this phase's subjects need one.
`typecheck:web` requires the regenerated bindings from C2 to be on disk.

### 6.3 What must not regress

- `tests/ui/data-view.spec.ts`, `cell-editor.spec.ts`, `console.spec.ts`, `definition.spec.ts`,
  `tooltips.spec.ts` — all pass unchanged. None asserts a colour (§3), so any failure here means
  something other than colour moved.
- The four state colours still win over the type colour with the toggle **on**: a NULL cell is still
  italic `--kira-fg-disabled`, an FK cell still `--kira-info`, a staged edit still `--kira-warn`
  (D4). `mutations.spec.ts` and `data-view.spec.ts` already exercise these paths.
- Grid scroll performance is untouched: `colorByCol` is still built once per column per render, and
  the early return makes it strictly cheaper when off. `tests/ui/perf.spec.ts` and `budgets.spec.ts`
  remain the tripwires.

---

## 7. Acceptance checklist

1. `appearance.rowColoring` exists in the Zod schema, `defaultSettings`, `model.AppearanceSettings`,
   `model.DefaultSettings`, `model.AppearancePatch`, and both halves of `SettingsRepo` — and
   nowhere else needs it.
2. No migration file was added and `schema_version` did not change.
3. A Settings → Appearance checkbox labelled Row colouring, carrying
   `data-testid="settings-row-coloring"`, toggles it; Cancel reverts it like every other field.
4. With it off, every grid body cell renders with no inline `color` and inherits `--kira-fg`;
   NULL/FK/staged-edit/current-match cells keep their own colours.
5. With it on, a `number` column is `#b5cea8`, a `boolean` column `#569cd6`, a `temporal` column
   `#c586c0`, and a `text`/`uuid` column `#cccccc`.
6. `CATEGORY_COLOR` has no `var(--kira-syntax-string)` entry left, and the comment above it
   describes the rule that now holds.
7. `tests/ui/row-coloring.spec.ts` covers all three scenarios in §6.1 and passes; every other
   `tests/ui/` spec passes unchanged.
8. `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:ui`, `go build`/`go test
   ./apps/kira-studio/internal/...` all clean.

---

## 8. Open questions, handed forward

- **OQ-1 — Should the type-colour vocabulary itself become a setting rather than a boolean?** The
  toggle P9 ships is all-or-nothing. If the user later wants "numbers only" or a custom hue per
  class, the natural shape is an enum or a small map on the same leaf, and `CATEGORY_COLOR` is
  already the one place that would change. Not built now: nothing has asked for it, and a boolean
  that later widens into an enum is a schema change P17's own settings rework can absorb cheaply.
- **OQ-2 — For P17.** Row colouring is the first Appearance setting whose effect is *only* visible
  behind the dialog (the grid it repaints is covered by the modal while it is open). If P17 moves
  every control to apply-on-save, this one loses its live preview entirely, where font/row-density
  keep theirs via the dialog's own preview strip (`SettingsDialog.vue:214-230`). P17 should decide
  deliberately whether to give it a preview row, not discover the gap after the rework.
