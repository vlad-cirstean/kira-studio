# P176: Studio frontend small follow-ups

Source: `SPEC.md` row P176. Origin: P168 Part 13 F24, Part 5 F7, Part 6 F11, Part 6 F19, P170
studio-frontend F8. Item 5 carries the user's decision: keep grid paste as is; check that a paste
into an open cell editor lands as one value, fix it if not.

Read from source at `bc41c80` (origin/v2.0). P174 (Stream A) is not landed yet; see "Concurrency".
P170, P174 and P175 were checked against each item. None resolves one, but P174 touches three of
the files below.

## Current state per item

### 1. Part 13 F24: strict guard in `openTrackedTab`

Landed already (`48ce095` and the round's close-out):
- `StudioStart.vue:30` filters recent entries whose connection is gone, and `openRecent` (`:49-56`)
  returns early on a missing connection record.
- `state/tabs.ts:81-83` `pruneRecent`, called from the `onConnectionsChanged` listener (`:173-180`).

Still open: `openTrackedTab` (`state/tabs.ts:222-234`) opens a tab for any `connectionId`. The
commit `48ce095` kept the `OpenTabResult` return on purpose: a nullable return breaks callers that
destructure it, and unit specs that never seed `connectionsStore.records`. The row asks for the
guard anyway, so this plan does it and pays that cost.

Every caller of the four tracked openers (`openDataTab`, `openDocumentTab`, `openKeyValueTab`,
`openStreamTab`):

- Uses the result, needs a null branch:
  - `project/ProjectTree.vue:102,107,112,117` (`onOpen`, destructures `{ id, reused }`).
  - `views/grid/menu.ts:106` (`navigateForeignKey`) and `:132` (`editReferencedRow`).
  - `project/menus.ts:437` (saved-filter item).
  - `project/menuItems.ts:136,145` (`countItem`; its `openTab` type is `=> { id: string }`), fed by
    `project/menus.ts:322,355`.
  - `views/definition/columnsMenu.ts:10-25` (`targetTabForTable` returns `.id`), used at `:62` and
    `:75`.
- Ignores the result, no change beyond the type flowing through:
  - `workbench/panels/StudioStart.vue:52-55`.
  - `workbench/UploadObjectDialog.vue:77`, after the upload await, so a connection deleted
    mid-upload is a real path.
  - `views/shared/keyvalue/mutations.ts:83`, after a mutation await, so the same applies.
  - `views/browse/BrowseView.vue:220`, `views/browse/menu.ts:51,70`.
  - `project/menus.ts:312,344,400`, into `menuItems.ts:51`, typed `=> unknown`.

Unit specs that call a tracked opener without seeding a connection record:
- `stream-count-honors-filter`, `sqs-mutation-never-polls`, `sigma-count-refresh`,
  `tabs-save-retries-after-failure`, `view-state`, `document-collapse-all-preserves-other-pages`,
  `tabs-save-serialized` (all under `apps/kira-studio/tests/unit/`).

Out of the row's scope: `openDefinitionTab`, `openConsoleTab`, `openBrowseTab`. The row names
`openTrackedTab`. Every caller of those three runs on a live tree row or a live tab, synchronously.
`OperationsPanel.vue:105` re-runs an op whose connection may be gone, but its menu item is gated on
`connectionsStore.states[id]?.caps?.sql`, and a deleted connection has no state.

### 2. Part 5 F7: stale comment in `fkPreview.ts`

Still open. `views/grid/fkPreview.ts:59-65` names `readRequestWireSchema` (deleted) and
`E_BAD_REQUEST`. Current truth: Go `ReadRequestWire.Validate` (`internal/adapterhost/wire.go:61`,
`validPageSize` at `:25`) rejects any `pageSize` other than 10/100/1000/10000. `decodeAndValidate`
(`internal/adapterhost/dataframe.go:123-131`) maps that to `E_QUERY` (`adapters.CodeQuery`).

### 3. Part 6 F11: mask parity fixtures

TS fix landed (`3561a85`: `GO_SPACE` set, `\p{Nd}` digits in `packages/shared/domain/mask.ts`). The
fixtures were routed and never added. `tests/fixtures/mask/` (66 cases) has no U+FEFF or non-ASCII
digit case. Both readers auto-discover `*.input.json`: Go `internal/mask/parity_test.go`
(`TestMaskFixtureParity`) and `tests/unit/mask-parity.spec.ts`. No generator script exists. Go is
the source of truth: the Go test prints `got` on mismatch, and that value becomes `expected.json`.

### 4. Part 6 F19 (optional): explain-plan fixture with a large untyped number

The Go fix landed. `internal/queryplan/metrics.go:59` `formatJSNumber` ports JS
`Number.prototype.toString`, and Go's `TestFormatJSNumberMatchesJSToString`
(`parse_test.go:202`) covers `1234567.5` and `2e20`. No shared fixture carries such a value, so
nothing pins Go against the TS parsers' `String(v)` (`planParsers/mysql.ts:66,70`). Done here: one
fixture, auto-discovered by `parse_test.go` `TestParityFixtures` and
`tests/fixtures/explain-plans/loader.ts`. Cost is two JSON files.

### 5. P170 F8: paste into an open cell editor

Decided: grid-level paste stays as is (`views/shared/clipboardFormats.ts:171-184`). There is no
change there.

Checked against the open inline editor. **It does not insert as one value**:
- SlickGrid's `handleKeyDown` (`node_modules/slickgrid/src/slick.grid.ts:4488-4489`) fires
  `onKeyDown` for every keydown under the canvas, including one from the editor's own `<input>`.
- `SlickGridHost.vue` `onKeydown` (`:1873-1889`) catches Ctrl/Cmd+V with no editor check. It calls
  `preventDefault` (no native paste into the input), then `onPaste()`. `onPaste()` spreads the
  clipboard down from the selection anchor, which is the cell being edited. A multi-line clipboard
  stages edits on the rows below. The editor stays open with its old text.
- Same root cause for Ctrl/Cmd+C: copying selected text inside the editor copies the whole cell
  selection instead.
- Pending-insert-row inputs (`grid-cell-insert-input`, rendered by `cellFormatter`) sit under the
  same canvas, so the same branch hijacks them too.

Second defect, same "one value" requirement: the editor is `<input type="text">`
(`views/grid/slick/editor.ts:61-63`). A single-line input cannot hold a line break. A pasted
multi-line text turns line breaks into spaces (WebKit, Chromium). `loadValue` (`:79-86`)
assigning a stored value that has a line break strips it during value sanitization. Then
`isValueChanged` (`:104`) reports a change, and Enter or a click elsewhere stages the flattened
text. Opening a multi-line cell and leaving it silently rewrites the value. Fix: make the editor a
`<textarea>`, which holds the text exactly. SlickGrid already calls `preventDefault` on the keys it
handles (Enter commits, arrows navigate; `slick.grid.ts:4543-4575`), so keyboard behavior does not
change.

Pending-insert inputs stay `<input>`. They are formatter-rendered per row and outside the editor
this item names. Their line-break handling is a pre-existing limitation (a TSV paste with a quoted
multi-line field already stages a value they cannot show). Step 6 records it in
`docs/ARCHITECTURE.md` "Known open items" instead of half-fixing it.

## Decisions

- **D1 (item 1).** `openTrackedTab` returns `OpenTabResult | null`. It returns `null` without
  opening or recording a recent entry when `useConnectionsStore(pinia).connectionRecord(connectionId)`
  is undefined. The four tracked openers return the same nullable type. The guard lives only in
  the store. Remove `StudioStart.openRecent`'s own early return, and keep the `recentEntries`
  display filter. Add a one-line comment on the guard: "A tab for a deleted connection violates the
  tabs FK and fails every later save." Each caller that uses the result returns early on `null`.
- **D2 (item 1 tests).** Add `apps/kira-studio/tests/support/connectionRecord.ts` exporting
  `seedConnectionRecord(id: string, kind?: ConnectionKind)`. It pushes a minimal record onto
  `useConnectionsStore().records`, using the cast shape `console-run-after-tab-close.spec.ts:64-68`
  already uses. Each of the seven specs seeds every connection id it opens. Use `!` on results the
  spec knows are non-null (`noNonNullAssertion` is off in `biome.json`). Don't migrate the eight
  console specs that already push inline: unrelated churn.
- **D3 (item 5).** In `onKeydown`, the Ctrl/Cmd+C and Ctrl/Cmd+V branches run only when the native
  event's target is not a text control (`HTMLInputElement`, `HTMLTextAreaElement`, or
  `isContentEditable`). Read the target from `e.getNativeEvent<KeyboardEvent>().target`, which this
  function already uses for `.code`. That covers the inline editor and the insert-row inputs with
  one check. The browser's native paste and copy then apply. No hand-rolled paste handler.
- **D4 (item 5).** `KiraCellEditor` builds a `<textarea rows="1">` instead of an `<input>`. Keep
  the class `cell-input` and the testid `grid-cell-input`. Existing Playwright `.fill()` and
  locators keep working. `wrapSelectionOnType` already accepts a textarea. In `slickTheme.css`,
  add `resize: none; overflow: hidden; white-space: pre;` and keep the box at one cell high.
  Inline Tailwind is not possible: the element is built in plain DOM inside a SlickGrid-owned cell,
  and the existing `.cell-input` rule lives in this file. Block keyboard newline insertion: in the
  editor's keydown listener, call `preventDefault` on Enter with Shift or Alt. Plain Enter reaches
  SlickGrid unchanged. Line breaks then come only from a paste or a loaded value, and typing
  behaves exactly as today.
- **D5.** No change to `parseDelimited` or the grid-level paste. That is the user's decision.

## Steps

One commit per step, conventional message. Run `bun run typecheck` and `bun run lint` before each
commit (the pre-commit hook runs them anyway). Expensive suites run once, in step 8.

1. **`fix(studio): no tracked tab opens for a deleted connection`** (D1, D2).
   - `frontend/src/state/tabs.ts`: guard plus nullable return on `openTrackedTab` and the four
     openers. Update the `OpenTabResult` doc comment: "`null` when the connection is gone".
   - `frontend/src/workbench/panels/StudioStart.vue`: drop the redundant guard and its comment.
   - `frontend/src/project/ProjectTree.vue` `onOpen`: `const opened = …; if (opened?.reused)
     reloadTab(kind, opened.id);` for the four tracked kinds.
   - `frontend/src/views/grid/menu.ts` `navigateForeignKey`, `editReferencedRow`: return on null.
   - `frontend/src/project/menus.ts:437`: return on null.
   - `frontend/src/project/menuItems.ts` `countItem`: type `=> { id: string } | null`, return on
     null.
   - `frontend/src/views/definition/columnsMenu.ts`: `targetTabForTable` returns `string | null`,
     and both `run` handlers return on null.
   - `tests/support/connectionRecord.ts` (new). Seed records in the seven unit specs listed above.
   - Check: `bun run typecheck`, `bun run lint`, `bun run lint:dead`,
     `bun test apps/kira-studio/tests/unit`.
2. **`docs(grid): fk preview pageSize comment names the Go validator`**.
   `frontend/src/views/grid/fkPreview.ts:59-65`. Keep the 7a history in one clause. State that
   `ReadRequestWire.pageSize` is `10 | 100 | 1000 | 10000`, that Go `ReadRequestWire.Validate`
   rejects any other value with `E_QUERY`, and that 10 is the floor. Two or three lines.
3. **`test(mask): parity fixtures for U+FEFF in a name and Arabic-Indic date digits`**.
   - `tests/fixtures/mask/name-feff-inside-word.{input,expected}.json`: rule
     `{kind:"name", keepHint:true, correlate:false}`, key `null`, value `"Ann﻿Lee"` (JSON
     escape, so the character is visible in review). Go treats it as one word.
   - `tests/fixtures/mask/date-arabic-indic-digit-tail.{input,expected}.json`: rule
     `{kind:"date", keepHint:true, correlate:false}`, key `null`, value `"2024-01-01T١٢:00"`.
   - Generate `expected.json` from Go. Write a placeholder `{"output": ""}`, run
     `go test ./apps/kira-studio/internal/mask -run TestMaskFixtureParity`, and copy the printed
     `got` value in. Match the sibling files' two-space formatting.
   - Check: the Go test again, then `bun test apps/kira-studio/tests/unit/mask-parity.spec.ts`.
     Both must pass with no TS change (TS was fixed in `3561a85`). If TS fails, the port still
     drifts: fix `packages/shared/domain/mask.ts` in the same step and name the commit `fix:`.
4. **`test(queryplan): explain fixture with large untyped numeric metrics`**.
   - `tests/fixtures/explain-plans/mysql-large-untyped-metric.{input,expected}.json`. Copy
     `mysql-single-table.input.json`. In the table object, add two untyped keys,
     `"rows_produced_per_join":1234567.5` (replacing the existing value) and
     `"sort_buffer_bytes":2e20`, both as JSON number literals inside the plan string. Expected
     metric values: `"1234567.5"` and `"200000000000000000000"`.
   - Generate `expected.json` from Go's printed `got`
     (`go test ./apps/kira-studio/internal/queryplan -run TestParityFixtures`), formatted like
     `mysql-single-table.expected.json`.
   - Check: the Go test, then `bun test apps/kira-studio/tests/unit/explain-plan.spec.ts`.
5. **`fix(grid): clipboard keys inside a text control stay native`** (D3).
   `frontend/src/views/grid/SlickGridHost.vue` `onKeydown` only. One-line comment on the guard:
   the editor and insert-row inputs sit under SlickGrid's keydown handler.
6. **`fix(grid): inline cell editor keeps line breaks`** (D4).
   - `frontend/src/views/grid/slick/editor.ts`: `HTMLTextAreaElement`, the modified-Enter
     `preventDefault` in the editor's keydown listener (remove it in `destroy`). Update the file
     comment to say the editor is a one-row textarea and why: a text input strips line breaks.
   - `frontend/src/views/shared/slick/slickTheme.css`: textarea rules on
     `.slick-cell.editable .cell-input`.
   - `docs/ARCHITECTURE.md` "Known open items": one entry. A pending insert row's cell is a
     single-line `<input>`, so a staged value with a line break (pasted TSV/CSV) shows flattened,
     and typing in that input restages it without the break. Delete the entry when insert cells
     move to the same textarea editor.
7. **`test(grid): paste and copy inside the inline editor stay in the editor`**.
   - Move `CLIPBOARD_SHIM`/`installClipboardShim` from `tests/ui/interaction.spec.ts:1037-1050`
     into `tests/ui/support/clipboard.ts`, next to `installClipboardSpy`. Point
     `interaction.spec.ts` and `slick-grid.spec.ts:1096-1105` (an identical third copy) at it.
   - In `interaction.spec.ts`'s paste block (after the Ctrl+V assertions, about `:1369-1420`): set
     the shim to `"line one\nline two"`, then double-click an existing-row cell (inline editor
     open). Press `ControlOrMeta+V`. Assert the row below has no staged edit (`cellText`
     unchanged) and `grid-cell-input` is still open. Then `.fill('a\nb')`, press Enter, and assert
     the staged value keeps the break: read it from the cell dock, or from `displayCell` through the
     cell's text, whichever the spec already exposes. Don't add a hook for it.
   - This is a Playwright regression for a confirmed interaction bug, not a unit test. The
     CLAUDE.md unit-test bar is not involved. No unit test is added in this phase. Each logic
     change is a single guard (items 1, 5) or a type swap.
8. **Verification, once** (no commit unless something fails):
   - `bun run typecheck`, `bun run lint`, `bun run lint:dead`, `bun run test:unit`.
   - `go test ./apps/kira-studio/internal/mask ./apps/kira-studio/internal/queryplan`.
   - `bun run test:ui:studio`, the full `ui` project. Tracked-opener and editor changes reach many
     specs: `mode-switch` (F24's own UI case), `interaction`, `mutations`, `grid-commit-in-flight`,
     `cell-editor`, `mask-preview`, `slick-grid`.
   - Fix whatever fails as a follow-up commit, pre-existing or not (CLAUDE.md).
   - Append a "Result" section to this file (what landed, commits, checks run, anything not
     verified), committed as `docs: P176 result`.

## Acceptance against the row

- Items 1-4: done (steps 1-4). Item 4 is optional but cheap.
- Item 5: grid paste kept (user decision). Editor paste fixed (steps 5-7).
- `test:unit` green: step 8 gate.

## File ownership

All paths below are under `apps/kira-studio/` unless they start with `docs/`.

| File | Step | Also touched by P174 (Stream A, unlanded) |
|---|---|---|
| `frontend/src/state/tabs.ts` | 1 | no |
| `frontend/src/workbench/panels/StudioStart.vue` | 1 | no |
| `frontend/src/project/ProjectTree.vue` | 1 | no |
| `frontend/src/project/menus.ts` | 1 | no |
| `frontend/src/project/menuItems.ts` | 1 | no |
| `frontend/src/views/definition/columnsMenu.ts` | 1 | no |
| `frontend/src/views/grid/menu.ts` | 1 | **yes**: P174 hunk at `:114-118`, adjacent to this step's `:106`/`:132` edits |
| `tests/support/connectionRecord.ts` (new) | 1 | no |
| `tests/unit/stream-count-honors-filter.spec.ts` | 1 | no |
| `tests/unit/sqs-mutation-never-polls.spec.ts` | 1 | **yes** (P174 +3) |
| `tests/unit/sigma-count-refresh.spec.ts` | 1 | no |
| `tests/unit/tabs-save-retries-after-failure.spec.ts` | 1 | no |
| `tests/unit/view-state.spec.ts` | 1 | no |
| `tests/unit/document-collapse-all-preserves-other-pages.spec.ts` | 1 | no |
| `tests/unit/tabs-save-serialized.spec.ts` | 1 | no |
| `frontend/src/views/grid/fkPreview.ts` | 2 | no |
| `tests/fixtures/mask/name-feff-inside-word.*.json` (new) | 3 | no |
| `tests/fixtures/mask/date-arabic-indic-digit-tail.*.json` (new) | 3 | no |
| `tests/fixtures/explain-plans/mysql-large-untyped-metric.*.json` (new) | 4 | no |
| `frontend/src/views/grid/SlickGridHost.vue` | 5 | **yes**: P174 hunks at `:250`, `:409`, `:928`, `:2610-2635`, none in `onKeydown` |
| `frontend/src/views/grid/slick/editor.ts` | 6 | no |
| `frontend/src/views/shared/slick/slickTheme.css` | 6 | no |
| `docs/ARCHITECTURE.md` | 6 | **yes** (P174 +55/-2) |
| `tests/ui/support/clipboard.ts` | 7 | no |
| `tests/ui/interaction.spec.ts` | 7 | **yes** (P174 +5/-3) |
| `tests/ui/slick-grid.spec.ts` | 7 | no |

## Concurrency

- **P174:** overlaps in five files: `views/grid/menu.ts`, `SlickGridHost.vue`,
  `sqs-mutation-never-polls.spec.ts`, `interaction.spec.ts`, `docs/ARCHITECTURE.md`. The
  `menu.ts` edits sit within three lines of P174's hunk, so they would conflict. **P176 must not
  run in parallel with P174.** Start P176's implementer only after P174 lands on `v2.0`, from that
  tip. Line numbers above are against `bc41c80`; the implementer re-reads each file before
  editing.
- **P173 (Space git):** the only shared file is `docs/ARCHITECTURE.md` (step 6, one Known-open-items
  bullet). P176 touches nothing under `apps/kira-space/`, `packages/git-*` or
  `apps/kira-space-vscode/`. If the user allows P176 to overlap P173, the only possible conflict is
  that one bullet, resolved on rebase. CLAUDE.md's default is still one phase at a time.
- **Within P176:** one sequential implementer. Items 1 and 5 are file-disjoint, but the phase is
  small, and step 8's UI run covers both. A split buys nothing.
