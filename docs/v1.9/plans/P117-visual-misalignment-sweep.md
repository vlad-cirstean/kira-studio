# P117 — Post-P110 visual misalignment sweep: findings + fix plan

Opus planning pass. Findings and plan only — nothing here is implemented yet. Base: `e5e25b0f`.
Sites are `file:line` against that commit. Implementer re-reads each site before editing.

Path shorthands: `SF/` = `apps/kira-studio/frontend/src/`, `KF/` = `apps/kira-space/frontend/src/`,
`WB/` = `packages/workbench/src/`, `TH/` = `packages/theme/src/`, `UI/` = `TH/components/ui/`.

## §0 Goal, method, acceptance

**Goal.** Find every real visual break on Settings (both apps), every Api module view, and a
spot-check of the rest. Fix each at its root cause, everywhere that root cause was copied.

**Method.**
- Built both apps' static test bundles (`bun run build:test:studio`, `build:test:space`) at `HEAD`
  and at `6f6853c1` (`aee6cd08^`, the commit before P110's first commit B1), the latter in a
  throwaway worktree.
- Scratch Playwright specs dropped into `tests/ui/` for the run and then removed. They reused the
  existing `relaunch`/`installMocks` fixture and mocked bridge. They drove each surface, took a
  1440x960 screenshot, and dumped every element whose computed font-size was ≥13.5px (the app
  body is 12px, and its kira scale is 10-13px).
- Browser: Playwright WebKit (`webkit-2359`, the repo's own `ui` project engine).
- Pre/post pixel diff plus a stacked pre-over-post image per surface, each read by eye.
- `codegraph_explore` per finding, for every call site sharing the pattern (§1 lists each blast radius).

**Surfaces captured** (63 screenshots per build, 126 total, all read):
- Studio Settings: Appearance, Data, Cache, Api, Scripts, Claude Code, Database MCP, Advanced,
  each at the top and scrolled to the bottom (16).
- Space Settings: Appearance, Git, Connected editors, Advanced (4).
- Api: start page, collections tree, tree context menu, environment menu, Environments view,
  variable-set view, HTTP empty state, the 5 request panes (Params, Headers, Body, Settings,
  Cookies), all 7 body modes, the 6 response panes (Body, Headers, History, Raw, Timeline,
  Cookies), the raw-view toggle, the curl import dialog, gRPC initial, 3 gRPC request panes and
  3 gRPC response panes (35).
- Spot-checks: workbench shell, terminal mode, the connection dialog's kinds, General and Advanced
  tabs, and Space's empty, files, repos and review views (8).
- Also read: the existing console, schema-dialog and data-view `test:visual` baselines.

**Acceptance.**
1. Every §1 finding is fixed at every listed site, one commit per root cause (§3).
2. The §0 sweep re-run at phase end shows none of §1's defects. §4.3 is the procedure.
3. The §4.2 `test:visual` baselines are re-recorded in their own commits, each named in the
   message. No other baseline changes.
4. `bun run lint`, `bun run typecheck`, `bun run lint:dead` and both apps' builds pass on every
   commit. `test:ui:studio` and `test:ui:space` are green at phase end. No `--no-verify`.

**One phase, no Part split.** A Settings part and an Api part would share root-cause primitives.
`UI/toggle/index.ts` feeds both Settings' Row height (S5) and every Api pane switcher (A1).
`UI/input/*` feeds Settings' request-settings twin and the Api views (A2). A split would put
ordered edits to one file in two streams.

## §1 Findings

Origin column: **P110** means the pre-P110 build renders the surface correctly, so P110 caused the
regression. **pre** means the pre-P110 build shows the same defect. The SPEC row covers both
("real visual misalignment"). Fix both.

| # | Defect | Root cause | Origin |
| --- | --- | --- | --- |
| S1 | Vertical settings fields centre their label row, control and description | `<Field class="items-center">` on a `flex-col` Field | pre |
| S2 | Commit date and Git log level selects render blank | `:value` fights NativeSelect's internal `v-model` | P110 |
| S3 | Active settings nav item loses its blue fill while hovered | static `hover:bg-hover` beats conditional `bg-select` | P110 |
| S4 | Data font size stepper stretches full width | `.size-input` width wrapper dropped | P110 |
| S5 | Row height toggle is 12.8px/28px, not the app's 11px/22px | ToggleGroup `size="sm"` stock step | P110 |
| S6 | Three settings labels render 14px beside 11px siblings | Label primitive's stock `text-sm` | pre |
| S7 | Checkbox rows wrap their label; description column jumps per row | label and description are flex siblings | pre |
| S8 | Number steppers show WebKit's native spinner beside the custom chevrons | no spin-button hide on the stepper input | pre |
| A1 | Every Api pane/tab switcher renders 14px/32px | ToggleGroup stock `default` size | pre |
| A2 | Api filter boxes and row inputs render 14px/32px; "New environment" clipped | stock Input/InputGroup sizes | pre |

### S1 — vertical Field centred

`UI/field/index.ts:6` `fieldVariants` vertical = `flex-col gap-1`. Adding `items-center` makes
cross-axis centring horizontal. Each child shrinks to content and sits mid-pane. Examples: Data's
"Default page size" plus its narrow select, Cache's three labels, Advanced's two
retention/threshold labels, and every Api-pane label and its helper text. Fields without the class
("Data font size", "Row height") stay left, so one pane mixes both alignments.

Pre-P110 had the same look from `<Label class="field">`, since Label's own base is
`flex items-center` (`UI/label/Label.vue:19`). P110 I2-26 (`1fbca440`) moved it onto `<Field>` and
transcribed the centring as an explicit `items-center`.

Sites (21 in 8 files, from `codegraph_explore` on Field/fieldVariants callers, confirmed by grep):
- `KF/workbench/settings/GitPane.vue:90,115,148,173`
- `SF/views/httprequest/RequestSettingsPane.vue:108,136,165,246`
- `SF/workbench/settings/AdvancedPane.vue:54,81`
- `SF/workbench/settings/ApiPane.vue:88,112,142,226`
- `SF/workbench/settings/AppearancePane.vue:62`
- `SF/workbench/settings/CachePane.vue:62,87,97`
- `SF/workbench/settings/DataPane.vue:29`

Stale comments naming the class (`GitPane.vue:76`, `RequestSettingsPane.vue:96`,
`AdvancedPane.vue:47`, `ApiPane.vue:76`, `CachePane.vue:54`, `DataPane.vue:23`) change with them.

**Fix.** Drop `items-center` at all 21 sites. Stretch then gives each child full width, the same
as FontSizeField/RowDensityField. A select that must stay narrow (Data font, Default page size,
HTTP version) gets `self-start`, matching pre-P110's content-width select. Each label/reset row
must render as FontSizeField's does: label left, reset button right. The implementer checks this
per site: a row without `justify-between` gets it.

### S2 — NativeSelect blank

`UI/native-select/NativeSelect.vue:24-27` is `useVModel(..., { passive: true, defaultValue: '' })`,
bound with `v-model` on the `<select>`. A caller passing `:value` (an attribute), not
`:model-value`, gets overwritten by the internal `''`. The select shows no option and the real
setting is invisible.

Origin P110 B24 (`daa341cd`): the old `<select class="p-select" :value>` kept its `:value`/`@change`
pair when it became NativeSelect.

Sites (2; `codegraph_explore` on NativeSelect's 24 callers, then a grep of each one's binding):
- `WB/settings/fields/DateFormatField.vue:46`, shown in Studio AppearancePane and Space AppearancePane.
- `WB/settings/fields/GitLogLevelField.vue:46`, shown in Studio AdvancedPane and Space AdvancedPane.

Every other NativeSelect caller already uses `v-model` or `:model-value`/`@update:model-value`.

**Fix.** Switch both to `:model-value` plus `@update:model-value`, and type-narrow the emitted
value in the existing handler. That is ApiPane.vue:100's own shape.

### S3 — active item loses selection fill on hover

`WB/components/SettingsShell.vue:222-223`: static `hover:bg-hover` plus a conditional
`bg-select text-fg`. Tailwind emits `hover:` after base utilities, so hovering an active item
repaints it grey. Right after a click the pointer is still on the item, so every settings
screenshot and baseline shows the active section grey, not blue.

Origin P110 I2-8 (`ca6a0d29`), which replaced `bg-select! text-fg!` with a ternary but left
`hover:` static.

Same pattern (`codegraph_explore` on SettingsShell/DateTimePicker, then a grep for a static
`hover:bg-*` beside a conditional `bg-select|bg-primary`):
- `SF/views/shared/DateTimePicker.vue:279/283` (day cell), `:304/307` (month cell),
  `:318/321` (year cell). The selected `bg-primary` loses to `hover:bg-hover`. Pre-P110 a scoped
  `.selected` rule won on specificity, so this is also P110.

Correct precedent, already in the tree: `KF/repo/GitPanel.vue:400` and
`SF/views/grpcrequest/SchemaBrowser.vue:225` put `hover:bg-hover` only in the inactive branch.

**Fix.** Move `hover:bg-hover` into each inactive branch at all 4 sites.

### S4 — Data font size stepper full width

Pre-P110, FontSizeField wrapped its InputGroup in `.size-input { @apply w-24 }`
(`6f6853c1:SF/workbench/SettingsDialog.vue:160`, and the same in Space's SettingsDialog). P110
I2-22 (`0efa4f73`) folded the recipe into `TH/NumberStepperInput.vue:40` (`w-full`) and dropped the
wrapper.

`codegraph_explore` on NumberStepperInput's 14 callers: only FontSizeField had a width wrapper. The
ConnectionDialog stepper stays narrow (its own `groupClass`). Every other stepper was full width
before P110 too.

**Fix.** `WB/settings/fields/FontSizeField.vue:54` passes `group-class="w-24"`.

### S5 — Row height toggle off-scale

`WB/settings/fields/RowDensityField.vue:36-39` passes `size="sm"`. In `UI/toggle/index.ts:15` that
is shadcn's `h-7 ... text-[0.8rem]`, i.e. 28px and 12.8px. Pre-P110 `.segmented` rendered 11px
text on a 22px row.

Origin P110 B33.

**Fix.** Use A1's new `kira` size.

### S6 — 14px settings labels

`UI/label/Label.vue:19` base `text-sm`. Three settings labels pass no size:
- `WB/settings/fields/FontSizeField.vue:44`
- `WB/settings/fields/DateFormatField.vue:31`
- `WB/settings/fields/GitLogLevelField.vue:31`

Each renders 14px directly above an 11px "Row height" span. The DOM audit flagged no other Label
≥13.5px on any captured surface.

Precedent: WordWrapField.vue:40 passes `class="text-kira-sm"`.

**Fix.** Add `class="text-kira-sm"` at the 3 sites. The primitive stays untouched.

### S7 — checkbox + description rows

Each row is a horizontal `<Field>` (`flex-row items-center gap-1.5`) holding Checkbox, Label and
FieldDescription as siblings. The label shrinks and wraps: "Word / wrap", "Disable cookie / jar",
and a 3-line "Report session / activity to Kira / Studio". Each description starts at a different
x.

Sites with a description sibling (`codegraph_explore` on WordWrapField/Field/Checkbox/Label):
- `WB/settings/fields/WordWrapField.vue:30` (slot), shown in both AppearancePanes.
- `SF/workbench/settings/AppearancePane.vue:188,216`
- `SF/workbench/settings/ApiPane.vue:260`
- `SF/workbench/settings/ClaudeCodePane.vue:45,84`
- `SF/workbench/settings/DatabaseMcpPane.vue:90`
- `KF/workbench/settings/AppearancePane.vue:48`

Horizontal Fields without a description are fine and stay untouched: `ApiPane.vue:173,203` and
`RequestSettingsPane.vue:195,221,277`.

**Fix.** Use shadcn's own recipe: wrap Label plus FieldDescription in `<FieldContent>`
(`UI/field/FieldContent.vue`, already present, `flex-col`), and set `items-start` on that Field so
the checkbox aligns with the label's first line. For WordWrapField, put the Label and `<slot />`
inside FieldContent.

### S8 — native spinner inside every stepper

`TH/NumberStepperInput.vue:41-46` renders `InputGroupInput type="number"` with no spin-button
hide. WebKit draws its native spinner next to the two chevron buttons. The native spinner is the
white box visible in every settings stepper. Pre-P110's hide rule matched only `.p-input` inputs
(`6f6853c1:TH/primitives.css:231-237`). P104's InputGroup recipe never carried `.p-input`, so this
is pre-P110.

Blast radius: the 14 NumberStepperInput callers, one primitive. Plain `<Input type="number">`
sites have no custom chevrons, so their native spinner is their only stepper; they stay:
`DateTimePicker.vue:331,340,349`, `RequestSettingsPane.vue:152,181,262`, `PagerControls.vue:96`,
`git-ui/.../RepoSettingsDialog.vue:210`.

**Fix.** Add AutocompleteField.vue:582's already-allowlisted utilities to the inner input's class
at NumberStepperInput.vue:45: `[&::-webkit-inner-spin-button]:m-0`,
`[&::-webkit-inner-spin-button]:appearance-none`, and the `outer` pair.

### A1 — ToggleGroup stock size on every pane switcher

`UI/toggle/index.ts:6-22`: base `text-sm`, default size `h-8 min-w-8`, so 14px text in a 32px box.
Callers pass no size. In the HTTP view the Params/Headers/Body/Settings/Cookies row and the
Pretty/Raw and Body/Headers/History/Raw/Timeline/Cookies rows sit at 14px/32px beside 11px/22px
toolbar buttons. The DOM audit flagged every `toggle-group-item` on every Api capture. The
pre-P110 build is identical, so this is pre.

Sites (`codegraph_explore` on toggleVariants/ToggleGroup: 23 roots in 17 files):
- Api:
  - `SF/views/httprequest/HttpRequestView.vue:656`
  - `SF/views/httprequest/RequestBodyPane.vue:157`
  - `SF/views/httprequest/ResponsePane.vue:336,360`
  - `SF/views/grpcrequest/GrpcRequestView.vue:374,429`
  - `SF/views/grpcrequest/ResponsePane.vue:318`
  - `SF/views/grpcrequest/SchemaBrowser.vue:110`
- Elsewhere, same default size:
  - `SF/views/grid/DataToolbar.vue:264`
  - `SF/views/definition/DefinitionView.vue:254`
  - `SF/views/documents/DocumentView.vue:710`
  - `SF/views/stream/StreamView.vue:738`
  - `SF/views/shared/keyvalue/KeyValuePane.vue:826`
  - `SF/views/shared/celleditor/TimestampPane.vue:119`
  - `SF/workbench/panels/OperationsPanel.vue:247`
  - `KF/repo/GitPanel.vue:338,544`
  - `KF/views/repo/RepoFileView.vue:278`
- Already sized `sm`: `SF/project/ConnectionDialog.vue:797,1079,1098,1117` and
  `RowDensityField.vue:36` (S5).

**Fix.** Follow the Button precedent (`UI/button/index.ts:45-55`): keep shadcn's stock steps and
add a token size. Add `kira: 'h-control min-w-control px-2 text-kira-sm
[&_svg:not([class*=size-])]:size-3.5'` to `toggleVariants.size`. Pass `size="kira"` on every
ToggleGroup root in the two lists above plus RowDensityField. The root's `provide` carries it to
each item.

ConnectionDialog's four `sm` groups matched pre-P110 on capture and read correctly. They stay out
of scope.

The implementer confirms each site's surrounding bar still centres the group vertically after the
32px-to-22px drop. The HTTP pane row is `h-bar`, so it does.

### A2 — stock Input/InputGroup in Api views; clipped button

`UI/input/Input.vue:25` is shadcn's stock `h-8 ... text-base md:text-sm`, i.e. 32px/14px.
`UI/input-group/index.ts` `inputGroupVariants.default` is stock `h-8` too. Its `kira` variant
exists (P110 B25) but these call sites never adopted it.

In `SF/api/EnvironmentsView.vue` the filter InputGroup (`:240`, `w-full`) and the per-row
name/description Inputs (`:314,321`) are 14px/32px under 11px row chrome. The filter takes the
whole bar. The trailing `min-w-0` action group (`:250`) shrinks, and "New environment" is clipped
at the view's right edge (visible in both builds). `SF/api/VariableSetView.vue:486` (filter) and
`:551,560` (environment name/description) repeat the pattern, as does `SF/api/VariableRow.vue:167,
181,201` (variable rows).

Blast radius (`codegraph_explore` on InputGroup/InputGroupInput/Input callers, then a grep for
sites carrying no `variant="kira"`, `h-control`, `h-full` or `text-kira-*`):
- Stock InputGroup, 20 roots:
  - `SF/api/{CollectionsPanel.vue:164, DynamicValuesDialog.vue:91, EnvironmentsView.vue:240,
    VariableSetView.vue:486, VariablesOverviewPanel.vue:91}`
  - `SF/terminal/TerminalPanel.vue:168`
  - `SF/views/definition/DefinitionView.vue:314`
  - `SF/views/grpcrequest/{CallHistoryList.vue:119, GrpcRequestView.vue:503, SchemaBrowser.vue:198}`
  - `SF/views/httprequest/{CookiesPane.vue:103, FormDataTable.vue:112, HttpRequestView.vue:733,
    ResponseHistoryList.vue:159, ResponsePane.vue:445}`
  - `SF/views/shared/fields/FieldRowsTable.vue:315,346,361`
  - `SF/workbench/panels/ProjectPanel.vue:57`
  - `KF/repo/GitPanel.vue:377`
- Stock Input, 26 candidates:
  - `SF/api/{EnvironmentsView.vue:314,321, SaveRequestDialog.vue:99, VariableRow.vue:167,181,201,
    VariableSetView.vue:551,560}`
  - `SF/views/grpcrequest/SchemaBrowser.vue:126,135,182`
  - `SF/views/httprequest/{FormDataTable.vue:154, RequestSettingsPane.vue:150,179,260}`
  - `SF/views/shared/{DateTimePicker.vue:329,338,347, ResponseFindBar.vue:147,
    celleditor/TimestampPane.vue:133, keyvalue/KeyValuePane.vue:872,873,914,
    page/PagerControls.vue:91, page/SearchToolbar.vue:271}`

The grep is a heuristic. Several candidates size themselves another way, e.g. PagerControls and
SearchToolbar are already asserted at 22px by `tests/ui/control-sizing.spec.ts`. Some FieldRowsTable
groups wrap an auto-height textarea on purpose.

**Fix.**
1. Add a `size` axis to Input, following NativeSelect's and Button's cva shape. Put an
   `inputVariants` in `UI/input/index.ts` with `default` as today's stock string and
   `kira: 'h-control px-2 py-0 text-kira-sm'` (plus `kira-lg: 'h-control-lg ...'`). `default`
   stays byte-identical, same rule B25 used for InputGroup.
2. At each candidate, measure the rendered box in the running build (computed height and
   font-size). Move a site to `size="kira"` (Input) or `variant="kira"` (InputGroup) only if it
   renders at the stock 32px/14px inside 22px chrome. Leave a site already at 22px/11px, or one
   deliberately auto-height, and list it in the result section as checked.
3. EnvironmentsView/VariableSetView filter: `variant="kira"` plus a bounded width, e.g. `w-64`, so
   the filter stops taking the whole bar. Give the trailing action group `shrink-0` so "New
   environment" never clips. Apply the same to any other toolbar where the §4.3 re-sweep shows a
   clipped trailing group.

### Clean surfaces, and what was not a finding

Clean (no genuine break):
- Studio Settings' Scripts, Claude Code and Database MCP layouts, apart from S3/S7.
- workbench shell, console, schema dialog, data-view (baselines), terminal.
- Api start page, collections tree and its context menu, environment menu, curl import dialog.
- HTTP body modes and response panes, apart from A1.
- gRPC panes, apart from A1/A2.
- connection dialog: kinds, General, Advanced.
- Space: empty, files, repos, review.

Not findings:
- Terminal "Quick commands" header `font-semibold` (`SF/terminal/TerminalPanel.vue:143`): pre-P110
  renders it bold too. It is the old `.panel-title` weight, carried over faithfully.
- 20px "No connections yet" / "No request open" text: the Empty primitive's own title scale, by
  design.
- Pre-P110 builds show a grey band under each dialog footer. P110 fixed that, so it is not a
  regression.
- The masked secret value in VariableRow (dots, no box): a deliberate read-only display, the same
  in both builds.

## §2 Library/primitive rule

Every fix reuses a primitive or recipe already in the tree:
- Field/FieldContent (shadcn-vue).
- cva size axes (Button/NativeSelect precedent).
- InputGroup's existing `kira` variant.
- AutocompleteField's allowlisted spin-button utilities.
- GitPanel's inactive-branch hover precedent.

No new dependency, no scoped `<style>`, no new arbitrary value outside §1.2's allowlist. `min-w-control`
and `h-control` resolve through the existing `--spacing-control*` theme keys that Button's
`size-control` already uses.

## §3 Commit sequence, ownership, implementer call

**Implementer: one sequential Sonnet subagent.** This pass lands no fixes. §1 spans 10 root causes
and ~80 call sites, and each needs a per-site measured check plus baseline re-records. That is
implementation work under CLAUDE.md's "Opus plans, Sonnet implements" rule. Mixing a partial fix
set into the planning commit would blur what the orchestrator verifies.

No stream split. §0 explains the shared primitives. S1/S6/S7 also edit the same settings pane
files in sequence.

Order: independent small fixes first, then the primitive additions, then per-site adoption, then
guards and baselines. Each line below is its own commit, Conventional Commits style, with fast
checks passing:

1. `fix(workbench): bind NativeSelect model in date-format and git-log-level fields` (S2)
2. `fix(workbench): keep active settings section selected while hovered` (S3, SettingsShell)
3. `fix(studio): keep selected DateTimePicker cell filled while hovered` (S3, DateTimePicker)
4. `fix(settings): left-align vertical settings fields` (S1, 21 sites + 6 comments, both apps)
5. `fix(workbench): size settings field labels to the kira scale` (S6)
6. `fix(settings): stack checkbox label over its description` (S7)
7. `fix(theme): hide WebKit's native spinner inside NumberStepperInput` (S8)
8. `fix(workbench): restore the data font size stepper's width` (S4)
9. `feat(theme): add kira size to toggleVariants` (A1 primitive)
10. `fix: size every pane/tab ToggleGroup to the control scale` (A1 sites + S5)
11. `feat(theme): add kira size axis to Input` (A2 primitive)
12. `fix(api): kira-size Environments/VariableSet inputs, stop clipping New environment` (A2)
13. `fix: kira-size remaining stock Input/InputGroup sites` (A2 blast radius, measured subset)
14. `test(studio): guard toggle/filter heights and settings select values` (§4.1)
15. `test(studio): add HTTP request view visual snapshot` (§4.2)
16. `test: re-record Studio settings/data-view baselines for P117` (§4.2, name each file)
17. `test(space): re-record settings baselines for P117` (§4.2)

If commit 13 finds zero sites needing change beyond commit 12, it is skipped. The result section
says so and lists what was checked.

## §4 Verification

### §4.1 New UI-tier guards

Worth their keep, since every §1 defect passed lint, typecheck and the existing baselines:
- `apps/kira-studio/tests/ui/control-sizing.spec.ts`: new tests.
  - HTTP request pane `toggle-group-item` height ≈ `--kira-control-h`.
  - `environments-filter`'s `fieldset[data-slot=input-group]` height ≈ `--kira-control-h`.
  - `new-environment`'s right edge ≤ its view's right edge.
- `apps/kira-studio/tests/ui/settings-apply-on-save.spec.ts`, or a new test beside it:
  - `settings-date-format` value is `relative` on open.
  - `settings-git-log-level` value is `info` on open.
  - This catches S2's class of break, a select silently showing blank.
- `apps/kira-space/tests/ui/window-chrome.spec.ts` (it already opens Space's settings): the same
  `settings-date-format` value assertion.

No test for S1/S3/S4/S6/S7/S8. The re-recorded baselines cover them, and a computed-style
assertion per class would restate the class string.

### §4.2 Visual baselines

Re-record in their own commits (16/17) and name each file. Every Studio settings baseline shows S3,
because the spec clicks the nav item and the pointer stays on it. Most show S1/S6/S7 as well.
- Studio `tests/visual/settings.spec.ts-snapshots/` ×8.
- Space `tests/visual/settings.spec.ts-snapshots/` ×4.
- Studio `data-view.spec.ts-snapshots/data-grid-visual-linux.png`, if DataToolbar's ToggleGroup
  (A1) is in frame.
- Studio `connection-dialog`, `console`, `schema-dialog`, `workbench`: expected unchanged.
  Re-record only if `test:visual` actually diffs, and name the §1 finding that caused it.

New baseline: an HTTP request view with a sent response. The Api module had no snapshot and broke
silently, which the SPEC row explicitly allows for. Reuse the `collections.spec.ts` fixture shape.

### §4.3 Phase-end checks

- Per commit: `bun run lint`, `bun run typecheck`, `bun run lint:dead`, `bun run build:test:studio`,
  `bun run build:test:space`.
- Once near phase end:
  - `bun run test:ui:studio` and `bun run test:ui:space`.
  - `bun run test:visual:studio` and `bun run test:visual:space`, after the re-records.
- Re-sweep: repeat §0's method against the phase's final commit, using the same surface list and
  the ≥13.5px audit. Scratch specs go in the scratchpad and are copied in only for the run. Read
  every Settings and Api capture.
  - Expected: no `toggle-group-item` or stock Input/InputGroup ≥13.5px on Api surfaces.
  - Expected: settings labels left-aligned, the active nav item blue while hovered, both selects
    showing a value, and no native spinner.
  - Record the result in the SPEC result section as counts: surfaces captured, defects remaining.
