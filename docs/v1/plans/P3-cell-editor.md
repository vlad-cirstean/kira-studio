# P3 — Cell editor

> Plan for SPEC.md §10 phase **P3**. Authored by Opus, executed by Sonnet.
> Deliverable: *CodeMirror panel, format autodetect, manual override, beautify (indented/compact) — depends on grid selection.*
>
> P2 ended with a grid that knows exactly which cell you clicked and a page format that keeps the server's own bytes for every value. P3 is the phase that finally shows one of those values at full size. It is also the phase that brings **CodeMirror** into the app for the first time — the editor P4's DDL tab, P5's command preview, P5.5's console and P8's document view all inherit — so half of P3's real work is deciding where that editor lives and what it is allowed to assume.

## 0. Ground rules for this phase

- Build **only** what P3 lists. Read §8 (Out of scope) before starting and again whenever you feel like "just adding" a commit button, a fold gutter, a DDL tab or a copy item.
- Run `bun run lint`, `bun run typecheck` and `bun run build` at the end of each numbered step, and `bun run test:ui` from Step 2 on. A step is done when its acceptance check passes. `bun run test:db` is unchanged by this phase but must stay green — run it once at Step 7 after the fixture edit.
- **P3 issues no database operations.** Not one. Everything the panel renders was already fetched by P2's read path and already lives in the renderer. The operations panel must gain **zero** rows while the cell editor is used, and that is asserted (§11.9). If a design idea in this phase needs a query, it is the wrong design or the wrong phase.
- **Nothing under `src/main`, `src/engine`, `src/preload` or `src/shared` changes.** P3 is a renderer-only phase plus one test fixture. No migration, no IPC channel, no port op, no adapter method, no `Caps` flag. If you find yourself opening a file in those trees, stop and re-read §3.
- **No Vue reactivity around the editor.** A `reactive()` or `ref()` wrapper around a CodeMirror `EditorView` proxies every internal object the view touches on every transaction. It is the same class of mistake as wrapping a page in `reactive()` (P2's standing rule) and it produces the same symptom: a frame budget spent in the proxy. The view is a plain non-reactive binding.
- **The panel never modifies data and never pretends to.** Beautify reformats what is on screen; it does not rewrite the cell. §8.13's staging machinery is P5's, and P3 ships no part of it (D5).

### P0/P1/P2 realities you must work with (verified against the tree, not the plans)

These are facts about the code as it stands at `768b5ab` (the two commits after `aed2999` are docs-only —
a design mockup and a SPEC cross-reference — so `src/` is exactly the tree P2 left). Do not rediscover
them the hard way.

1. **`CellEditorPanel.vue` is three lines** — `<EmptyState icon="edit" label="No cell selected" />`. Its slot in `WorkbenchShell.vue` already exists: `grid-area: cell`, `data-testid="cell-editor"`, a `Splitter` above it with `min 120 / max 480`, and the whole thing rendered under `v-if="cellVisible"`. **P3 fills the slot; it does not lay out the shell.** The only shell edit in this phase is Step 6's toggle.
2. **`layoutState.panel.cellEditor` is `{ visible, height }`, defaults `{ true, 180 }`, and persists** through `kira:layout:*` like the other panels — but **nothing can toggle it.** `workbench/state/layout.ts` exports `toggleProjectPanel` and `toggleOperationsPanel` only, and `WorkbenchShell.vue` unmounts the panel entirely when `visible` is false. P0 Step 6c recorded: *"The cell-editor panel toggle is not in §8.1's status bar; leave it toggled by its own header chevron"* — no header and no chevron were ever built, so today the flag is write-only. See **D16**.
3. **The grid's selection is `runtime[tabId].selection`** in `src/renderer/views/grid/state.ts`: a reactive `Record<string, DataViewRuntime>` whose `selection` is `{kind:'cell'} | {kind:'range'} | {kind:'row'} | {kind:'column'}`. It is written in five places in `DataGrid.vue` (cell click, shift-click, gutter click, header click, arrow keys) and read in exactly one — `DataGrid.vue`'s own `isSelected()`, which draws the highlight. Nothing outside the grid consumes it today; P2 D23 shipped it explicitly so that P3 would have something to read.
4. **`selection.col` / `selection.cols` are *display* positions, not page column indices.** `DataGrid.vue` maps them through a local `displayIndexToPageIndex` computed built from `columnOrder` (which itself merges `tab.state.columnOrder` with `page.columns`). Any consumer outside the grid that treats `selection.col` as an index into `page.columns` reads the wrong column the moment a user drags a header. Step 2 moves that mapping into `views/grid/columns.ts` so there is one of it.
5. **`runtime` is never pruned.** `closeTab` drops the page and the hydration flag but leaves `runtime[tabId]` behind. Not P3's to fix — it just means the cell editor keys off the **active tab**, never off iterating `runtime`.
6. **`views/grid/page.ts` is the only decoder.** Pages live in a plain non-reactive `Map`, frozen, with `pageVersion` as the single reactive signal; `cell(tabId, row, col)` returns `{ text, isNull, truncated }` through a decode cache that is cleared whenever the visible row window moves. P3 does not decode chunks itself — it receives an already-decoded value from the grid (D1).
7. **`page.columns[i]` is `{ name, dataType, typeClass, nullable, isPrimaryKey }`** where `dataType` is the server's verbatim type name (`numeric(20,6)`, `jsonb`, `varchar(50)`) and `typeClass` is one of `number | text | boolean | temporal | binary | json | other`. P2 D3 wrote it down as being *for* this phase: "P3's cell editor gets the same text and does its own format autodetect on it." The detector uses both (§5).
8. **Binary columns arrive as `0x…` hex text** (P2 §5b/§6c, both adapters) — the panel will never see raw bytes, only that hex rendering.
9. **A value over `MAX_CELL_BYTES` (64 KB) was cut at the engine**, on a UTF-8 code-point boundary, and `isTruncated(chunk, row)` is true for it. The panel can never show more than 64 KB of any cell, cannot fetch the rest, and must say so rather than presenting a silent prefix as the value.
10. **`NULL` and `''` are distinguishable only through the null bitset.** `cell()` returns `isNull: true` with `text: ''` for a NULL and `isNull: false` with `text: ''` for an empty string. §8.5 already requires the grid to render them differently; §8.6's panel inherits that requirement.
11. **`connectionsState.records` is `ConnectionSummary[]` and carries `readOnly`**; `connectionsState.states[id]` is `ConnectionState` and carries `status` and `caps`. §8.6's forced-read-only reads the former. There is no other renderer-visible read-only signal — the engine-side guard §8.12 describes does not exist yet (it is P5's).
12. **`settingsState` lives at `renderer/state/settings.ts`** (moved there by P2 D20) and `applyAppearance()` writes `--kira-font-family`, `--kira-font-size` and `--kira-row-height` onto `document.documentElement`. §8.2 says one font family and size for "UI, grid **and editors** alike", so the editor styles itself from those variables and never hardcodes a font.
13. **`tokens.css` has no syntax colours.** The Dark Modern token set stops at chrome, status and the twelve connection colours. Highlighting needs a new token group (D18).
14. **There is no CodeMirror in the tree.** No `@codemirror/*` in `package.json`, no import anywhere. P1 Step 10b deliberately left the operations panel's expanded command as plain text with a comment saying *"P3 upgrades it when CodeMirror lands"*; see **D19** for why P3 declines that.
15. **`externalizeDepsPlugin()` runs for `main` and `preload` only** — the renderer is bundled by Vite with no externalisation. `vue`, `tailwindcss`, `@vscode/codicons` and `@playwright/test` are all in **`devDependencies`**; `pg`, `mariadb`, `drizzle-orm`, `zod` and `electron-log` are in `dependencies` because the main/engine bundles load them at runtime from `node_modules`. A renderer-only package in `dependencies` is the wrong bucket. **CodeMirror is renderer-only → `devDependencies`** (D3).
16. **`bunfig.toml` sets `install.exact = true`**, so `bun add -d …` pins exact versions with no caret, matching every other line of `package.json`. Do not hand-edit the versions.
17. **Renderer path aliases are `@shared/*` and `@renderer/*` only.** Inside `src/renderer`, relative imports are the convention (`../../state/settings`), and `@renderer/*` is used nowhere. Follow the local convention.
18. **`tests/ui/fixtures.ts` gives `kira` / `relaunch` / `consoleErrors`** with `KIRA_HOME` isolated under `tmpdir()`. Every spec ends with `expect(consoleErrors).toEqual([])` — a Vue warning fails the suite. Container-backed specs `test.skip` with `DOCKER_UNAVAILABLE_MESSAGE`. The tree/grid helpers (`findRow`, `expandRow`, `openRowMenu`, `getOps`) are **copy-pasted into each spec file** — there is no shared helper module, and P3 follows that convention rather than inventing one mid-phase.
19. **The Postgres fixture has no free-text format samples.** `0001_seed.sql` gives `app.wide_table` (60 columns incl. `jsonb_a`, `uuid_a`, `bytea_a`, `ts_a`, `numeric_a`), `app.nulls_and_unicode` (NULL, `''`, emoji/CJK/RTL, a 1 MB `text` and a 256 KB `bytea`) and `app.nested_json` (5-level `jsonb` with a 200-element array). Nothing anywhere holds XML, SQL, base64, an epoch, a URL or CSV — so seven of §8.6's twelve formats cannot be exercised end to end today. See **D20**.
20. **Nothing asserts an exact table list in the `app` schema** — `postgres.spec.ts` uses `expect(byKind('table')).toContain('wide_table')`, `tree.spec.ts` counts only `wide_table`'s 60 columns, and every UI spec addresses tables by path. Verified before D20 was written: adding one table to the seed breaks nothing.
21. **`schema_version` is 2** (`0001_init.sql`, `0002_p2.sql`). P3 adds no migration; if you think you need one, you are building P5.
22. **`SettingsDialog.vue` uses native `<select>` and `<input>` controls** with `data-testid`s, and the app has no custom dropdown component — `ContextMenu.vue` and `ColumnsMenu.vue` are popovers, not form controls. The format override uses a native `<select>` for the same reason (D8).
23. **`docs/design/vscode-modern-ui/` is a chrome mockup, not a functional spec.** `Main.dc.html` draws a cell-editor panel whose header reads *column name · type pill · spacer · format select · indented/compact segmented pair · wrap · copy · expand*. P3's header (Step 5b) follows that order for the controls that exist in this phase and deliberately omits the rest: **copy** is P6's clipboard scope, **expand** is not in §8.6 at all, and **wrap** is unconditional here (D7). The mockup's restyle itself — rounded-pill tabs, the 4/6/8 px radius tiers, flat chrome — is a cross-cutting change to `tokens.css` and every panel, and it is not P3's: P3 styles against `tokens.css` as it is today and restyles with everything else whenever that redesign lands.

### Prerequisites to verify before Step 1

```
colima status                    # must report a running VM; if not: colima start --cpu 4 --memory 6 --disk 40
docker info                      # must succeed
docker pull postgres:17-alpine   # P3's own spec is Postgres-backed
docker pull mariadb:11.4         # unchanged by P3, but `bun run test:ui` runs mariadb.spec.ts too
```

---

## 1. Decisions made in this plan

The spec leaves these open. They are decided here — implement as written, do not re-litigate.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **The panel reads a cross-view publication, never `views/grid/*`.** A new `src/renderer/state/cellSelection.ts` holds one `SelectedCell \| null`; `DataGrid.vue` **publishes** into it when the selection or the page changes; `views/celleditor/` **reads** it and imports nothing from `views/grid/`. | §11 is explicit that `renderer/state/` exists "so `views/*` are siblings that depend downward on shared state, never sideways on each other" — and `views/celleditor/` importing `views/grid/page.ts` is precisely the sideways edge that rule forbids. It is also the shape that survives: §8.9 says a stream message's body renders "in the document/cell viewer", so P8/P10 will publish into the same slot instead of the panel growing a branch per view kind. The publication carries the already-decoded string, so the panel never touches the columnar codec. |
| **D2** | **The CodeMirror wrapper lives in a new top-level `src/renderer/editor/`, not in `views/celleditor/`.** Three files: `CodeMirrorHost.vue`, `theme.ts`, `languages.ts`. §11's literal layout does not list it; this plan extends the layout and records the extension here. | §3 of the spec names four consumers of CodeMirror — "DDL tab, cell editor, document view, command preview" — and §8.14 adds the console. Putting the host inside `views/celleditor/` means P4's `views/ddl/` imports sideways from a sibling view, the exact dependency §11 was written to prevent, and P4 would then either duplicate the wrapper or move it — a move that costs more than putting it in the right place now. `renderer/editor/` sits beside `renderer/theme/` and `renderer/bridge/` as shared renderer infrastructure that no view owns. **Everything format-specific — the vocabulary, the detector, the beautifiers — stays in `views/celleditor/`**, because those are cell-editor semantics, not editor infrastructure. |
| **D3** | **Granular CodeMirror packages in `devDependencies`; no `codemirror` meta-package and no `basicSetup`.** Exactly: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/lang-json`, `@codemirror/lang-xml`, `@codemirror/lang-sql`, `@lezer/highlight`. | `devDependencies` because the renderer is bundled, not externalised (§0 note 15). Granular because `basicSetup` pulls autocomplete, search, lint, fold, bracket-matching and a full keymap into a panel that in this phase cannot even be typed into — §2.2 budgets RAM, and an editor that ships five features nobody asked for is five features to keep working. `@codemirror/lang-xml` covers HTML as well (D8's vocabulary treats "XML / HTML" as one format, exactly as §8.6 writes it), which avoids `@codemirror/lang-html` dragging in the JavaScript and CSS parsers for a cell value. |
| **D4** | **One `EditorView` per panel instance, created on mount and reconfigured through `Compartment`s** (language, read-only, wrapping is fixed on). Changing cell, format or read-only state is a `dispatch`, never a re-creation. The view is held in a plain `let`, not a `ref`. | §2.1 budgets **50 ms from cell selection to a populated editor** — that is the one row of the budget table P3 is responsible for. Tearing down and rebuilding a view means re-parsing the theme, re-instantiating the language, and a full DOM rebuild; a `changes` transaction against an existing view is a single measured layout. The plain `let` is §0's no-reactivity rule applied to the editor. |
| **D5** | **The P3 panel is read-only in every case, and says which of two reasons applies:** `connection-read-only` (§8.6's forced case, driven by `ConnectionSummary.readOnly`) and `not-editable-yet` (everything else). §8.6's "Editable" lands in **P5**, together with the pending-change set that makes an edit mean anything. P3 builds **no** draft store, no commit control, no staging call, no `stageCellEdit` stub. | An editable buffer whose contents are silently discarded at the next click is a worse product than a read-only one and is exactly the "half-implemented scope" `AGENTS.md` forbids; a draft store that survives cell switches *is* P5's pending-change set, built early under a different name and thrown away. What P3 owes P5 is not machinery but a **resolved, correct target descriptor** — which cell, in which tab, in which column, with which type, truncated or not, forced read-only or not — and that is real work the panel needs anyway. §4g writes down exactly what P5 adds and where. The two-reason split matters: it makes §8.6's read-only requirement observable and testable *today* (`data-read-only-reason="connection-read-only"`), so P5 inherits a working, asserted affordance instead of writing it blind. |
| **D6** | **The CodeMirror document is a display buffer.** Beautify and manual override change what is rendered; the stored value is untouched and is always one click away via **Reset**, which is enabled exactly when the buffer differs from it. | This is what makes a read-only panel with a Beautify button coherent rather than confusing. It is also the invariant that keeps P5 honest: when editing lands, the thing that gets staged is the buffer, and the user has always been able to see whether the buffer is the stored value or a reformatting of it. (Note for the implementer: `EditorState.readOnly` blocks *user input*; a programmatic `view.dispatch({changes})` still applies, which is what Beautify and Reset use.) |
| **D7** | **No auto-beautify. The stored text is shown verbatim on populate, with line wrapping always on.** Beautify is two explicit buttons. There is no wrap toggle. | A database client's job is to show what is stored. Auto-formatting a `jsonb` value on selection would mean the panel and the grid disagree about the same cell, and the user could not tell which one is the truth. Wrapping solves the actual readability problem (a 40 KB single-line JSON) without altering a byte, so it is on unconditionally and needs no control. |
| **D8** | **The format vocabulary is a closed 12-member list matching §8.6 exactly**, declared once in `views/celleditor/formats.ts`: `json`, `xml` (labelled *XML / HTML*), `sql`, `base64`, `hex`, `epochSeconds`, `epochMillis`, `iso8601`, `uuid`, `url`, `csv`, `text`. The override control is a native `<select>` whose first entry is `Auto`. | §8.6 lists the formats; a closed vocabulary decided once is the same call P1 D4 made for `Caps` and P2 D18 made for tab kinds. §8.6's "epoch seconds/millis" is two entries because a manual override has to be able to say *which*. `xml` is one entry because §8.6 writes "XML/HTML" as one item and one Lezer grammar serves both. A native `<select>` matches §0 note 22 and is the only control here that a keyboard user and Playwright both get for free. |
| **D9** | **Detection is a scored guess over `{ text, typeClass, dataType, columnName }`, returning a *ranked list*, and the column's `typeClass` gates which detectors are even eligible** (§5's table). Ties break on a fixed precedence order. Detection runs once per (target, override) change — never on a keystroke, never after a beautify. | §8.6 says "Detection is a scored guess, always overridable", so a ranked list with scores is the honest return type and the reason string is what makes an override an informed choice rather than a fight with a black box. Gating on `typeClass` is the whole payoff of P2 D3: an `int4` column holding `12345678` is not base64 and not hex, and no amount of regex cleverness beats simply knowing the server's type. Re-detecting after beautify would let the panel change its own mind about a value the user never changed. |
| **D10** | **Beautify is a lossless text→text transform. It never round-trips through a JavaScript value** — no `JSON.parse`/`JSON.stringify`, no `DOMParser`/`XMLSerializer`. Both formatters are scanners that copy every literal's raw slice verbatim and only change the whitespace *between* tokens. | `JSON.parse('{"id":12345678901234567890}')` returns `12345678901234567890` as `12345678901234568000`. P2 D3 exists precisely so a `numeric(20,6)` survives the trip from the server; corrupting the same number in the viewer — and, in P5, staging the corruption as a write — would undo that decision one phase later. `DOMParser` has the same class of problem for entities, CDATA and HTML fragments, plus it rejects input a user legitimately wants to look at. The scanners are ~80 lines each and the JSON one doubles as the JSON detector's validator, so there is one implementation of "is this JSON". |
| **D11** | **Beautify is offered for `json` and `xml` only.** Every other format declares no formatter, and both buttons render `disabled` with a title naming the reason. **SQL formatting is explicitly declined in P3** and belongs to whichever phase takes a SQL-formatter dependency for the console (P5.5). | A formatter that is not lossless is not shippable here (D10), and every SQL pretty-printer worth having needs a dialect-aware parser plus opinions about keyword casing — a dependency and a design conversation that belong with the console, where formatting a statement is a first-class feature rather than a side effect of viewing a cell. This is not a half-built beautify: beautify is *complete* for the formats where it can be done correctly, and the UI states plainly where it cannot. |
| **D12** | **A manual override sticks per `(connectionId, path, columnName)` for the session**, in a plain in-memory map in `views/celleditor/state.ts`. It is **never persisted** — not to `tabs.state_json`, not to `settings`, not to SQLite. Choosing `Auto` clears it. | §8.6: "the choice sticks per column for the session". Keying on `(connectionId, path, column)` rather than on `(tabId, column)` is what makes two tabs on the same table agree, matching how P2 D19 scoped saved filters and history. Not persisting is the literal reading of "for the session" and it is also the right call: `DataTabState` is validated and round-tripped through SQLite on every tab write, and adding a per-column format map to it would grow a persisted schema for a preference whose whole point is that it is disposable. |
| **D13** | **A `range` selection publishes its focus end** (the moving end, `sel.row`/`sel.col`); `row` and `column` selections publish **nothing** and the panel returns to its empty state. | The focus end is the cell the user last touched — the same convention every spreadsheet uses for the formula bar, and the cell the arrow keys are moving. A whole-row or whole-column selection has no single value to render, and picking one arbitrarily (the first cell, say) would show a value the user never pointed at. §8.6 says "clicking a cell"; a gutter click is not that. |
| **D14** | **NULL, empty string and truncated are three distinct, badged states.** NULL renders an empty editor with a `NULL` badge and no format detection at all; `''` renders an empty editor with an `empty` badge; a truncated value renders normally with a `truncated` badge and a status line saying the first 64 KB is all that was fetched. | §8.5 already requires NULL and `''` to be visually distinct in the grid and the same value cannot become ambiguous one panel down. The truncation badge is not decoration: it is the difference between "this cell contains this text" and "this cell starts with this text", and in P5 it is a hard blocker on staging an edit (§4g). |
| **D15** | **One status line carries a derived reading where detection implies a decoding:** epoch seconds/millis → the ISO-8601 UTC rendering, base64 → decoded byte count, hex → byte count, csv → *rows × columns*. The reading is **text on the status line only** — it never replaces the document. | A panel that announces "detected: epoch millis" and then shows you `1705315425123` has told you nothing you did not already see. This is the payoff of detection and it costs one line. Keeping it out of the document is what keeps D6's invariant intact: the buffer is the stored value (or a reformatting of it), never an interpretation of it. |
| **D16** | **The panel gets a status-bar toggle (`⬓ Cell editor`) *and* a collapse chevron in its own header, both calling one `toggleCellEditorPanel()`.** This overrules P0 Step 6c's note that the toggle stays out of the status bar. No menu item and no accelerator. | P0's note was written when the panel had no content, no header and no chevron; as it stands the flag is unreachable in both directions (§0 note 2), so a chevron alone would let a user hide the panel with no way back. §8.1 is unambiguous that "both side and bottom panels toggle from status-bar buttons", and the cell editor panel is one of the two bottom panels in §8.1's own diagram. The chevron stays because P0 wanted it and it is the affordance closest to the thing it hides. No accelerator: the binding table is §8.15's and P6 owns it, and a third View-menu item would touch `ipc.ts`, `menu.ts`, `preload`, `App.vue` and `layout.ts` for a shortcut P6 will re-derive anyway. |
| **D17** | **The SQL highlighting dialect comes from the connection's `kind`** — `postgres` → `PostgreSQL`, `mariadb` → `MySQL`, anything else → the default `StandardSQL`. | The panel already knows the connection; using it costs one lookup and makes `$1` placeholders and backtick quoting highlight correctly instead of as errors. It also means every future adapter gets a sensible default without touching this file. |
| **D18** | **Syntax colours are a new `--kira-syntax-*` token group in `tokens.css`, consumed by one shared `HighlightStyle` in `renderer/editor/theme.ts`.** The editor's font is `var(--kira-font-family)` at `var(--kira-font-size)`, and a settings change calls `view.requestMeasure()`. | Colours belong with the other Dark Modern tokens, not inline in a TypeScript theme object where P4 and P5.5 would each re-derive them; one `HighlightStyle` is what makes the DDL tab, the console and the cell editor look like one application. §8.2 mandates one font for "UI, grid and editors alike" — CodeMirror caches character metrics, so a font change without `requestMeasure()` leaves the editor laying out against the old metrics until the next scroll. |
| **D19** | **P3 does not retrofit the operations panel's expanded command row to CodeMirror.** P1 Step 10b's deviation comment is updated in place to name the real blocker and to re-point the upgrade at **P5**. | The blocker is not the missing dependency, it is that the expanded row lives inside `VirtualList.vue` at a fixed 20 px row height, and P2 §0 note 14 forbids generalising that component. Making it variable-height for a log detail is a real change to a component every panel depends on, and it buys nothing in P3. P5 is the natural owner: it builds §8.5's *Preview command* panel, which is the app's first genuine read-only statement-rendering surface, and the op-log detail is the same widget shown somewhere else. |
| **D20** | **Testing is one new Playwright spec and one additive fixture table.** `tests/db/fixtures/0001_seed.sql` gains `app.formats` (one row per format, in a `text` column so nothing is pre-classified by its type); `tests/ui/cell-editor.spec.ts` is new. **No new Testcontainers scenarios and no change to `postgres.spec.ts` or `mariadb.spec.ts`** — verified against the tree: P3 touches no adapter, no engine file and no shared protocol type, so there is no DB-facing behaviour to assert. | §9.2 names "cell editor autodetect + beautify" as required UI coverage, and seven of the twelve formats have no sample anywhere in the fixture (§0 note 19) — a detector tested only against JSON and UUID is a detector with seven untested branches. The samples go in a `text` column deliberately: a `jsonb` column would let `typeClass` decide the answer and the free-text path (which is what §8.6 actually calls out: "Format autodetect **even for free text**") would go unexercised. §0 note 20 verified nothing counts tables in `app`. |
| **D21** | **The panel is fed by `data` tabs only.** Any other state — no tab, a non-`data` tab, a tab with no selection, a restored tab that has not loaded — renders the P0 empty state, unchanged. | P2 D18 made `data` the only renderable tab kind, so there is nothing else to be fed by. When P4's DDL tab and P8's document view arrive they publish into `cellSelection` or they do not, and the panel needs no branch for them either way. |

---

## 2. Target tree at the end of P3

New and modified files only; everything else from P0/P1/P2 is untouched.

```
package.json                                    MOD  + 8 @codemirror/@lezer packages (devDependencies, D3)
src/
  renderer/
    editor/                                     NEW  shared CodeMirror infrastructure (D2)
      CodeMirrorHost.vue                             the one Vue↔EditorView wrapper (D4)
      theme.ts                                       Dark Modern EditorView.theme + HighlightStyle (D18)
      languages.ts                                   language id -> LanguageSupport, SQL dialect (D17)
    state/
      cellSelection.ts                          NEW  the cross-view selected-cell publication (D1)
      tabs.ts                                   MOD  clear the publication when its tab closes
    views/
      celleditor/                               NEW  (SPEC §11's reserved folder)
        CellEditorView.vue                           header + editor + status line
        state.ts                                     session format overrides + panel view state (D12)
        formats.ts                                   the closed vocabulary, labels, capabilities (D8)
        detect.ts                                    scored autodetect + derived readings (D9, D15)
        beautify.ts                                  lossless JSON/XML indent & compact (D10, D11)
      grid/
        columns.ts                              MOD  + resolveColumnOrder / pageColumnIndexFor
        DataGrid.vue                            MOD  use those; publish the selected cell
    workbench/
      panels/CellEditorPanel.vue                MOD  delegates to CellEditorView (keeps its testid)
      panels/OperationsPanel.vue                MOD  one comment updated (D19) — no behaviour change
      StatusBar.vue                             MOD  ⬓ Cell editor toggle (D16)
      state/layout.ts                           MOD  + toggleCellEditorPanel (D16)
    theme/tokens.css                            MOD  + --kira-syntax-* group (D18)
tests/
  db/fixtures/0001_seed.sql                     MOD  + app.formats (D20)
  ui/cell-editor.spec.ts                        NEW  §9.2's autodetect + beautify coverage
docs/plans/P3-cell-editor.md                    (this file)
```

Twenty files, and five of them are a comment, a token block, a three-line function, a two-line delegation and a handful of call sites. That is what a phase looks like when the phase before it left the right seam.

---

## 3. What P3 does not change

Read this before touching anything outside §2's list.

- **`src/main`, `src/engine`, `src/preload` and `src/shared` — nothing at all.** No IPC channel, no port op, no `Adapter` method, no `Caps` flag, no migration, no Zod schema, no `TabularPage` field. The format vocabulary is renderer-only session state that never crosses a wire and never reaches SQLite, so it does not belong in `shared/` (D12). If a P3 edit lands in one of those trees, the design took a wrong turn.
- **The grid's selection semantics.** `Selection`'s shape, the five places that write it, shift-extension, arrow-key movement, the `.selected` styling: unchanged. Step 2 adds a publication *side effect* and moves one computed into `columns.ts`; it changes no behaviour a user can see.
- **`views/grid/page.ts`, `state.ts`, `search.ts`, `DataView.vue`, the toolbars, the pager, the filter toolbar.** P3 reads none of them and edits none of them.
- **`VirtualList.vue`** (still fixed-row-height, still not generalised — D19), `Splitter.vue`, `ContextMenu.vue`, `EmptyState.vue`, `Codicon.vue`, `WorkbenchShell.vue`'s grid template.
- **The caches, prefetch, the op log and the operations panel's behaviour.** P3 issues no operations; the panel's only edit is a comment.
- **Session restore.** `tabs`/`ui_layout` rows keep their shape. The one new persisted value is `panel.cellEditor.visible` actually changing, which the existing layout schema already covers.
- **`scripts/demo-dbs`.** Manual acceptance in Steps 1–6 uses the columns the demo Postgres already has (`jsonb`, `uuid`, `bytea`, `timestamptz`); the twelve-format coverage is the Testcontainers fixture's job (D20).

---

## 4. Shared contracts (Steps 1–2 write these; the rest of the plan refers back)

### 4a. `src/renderer/state/cellSelection.ts` — the publication (D1)

The only thing that crosses between the grid and the cell editor.

```ts
import type { ColumnDescriptor } from '@shared/protocol/page';
import { reactive } from 'vue';

export interface SelectedCell {
  tabId: string;
  connectionId: string | null;
  /** Encoded NodePath of the tab's target — the override key's second component (D12). */
  path: string;
  /** Index into the page's own `columns`/`chunks`, never a display position (§0 note 4). */
  columnIndex: number;
  column: ColumnDescriptor;
  /** Row index within the loaded page, 0-based, as the grid's gutter shows it minus one. */
  row: number;
  /** The decoded server text. `null` means SQL NULL — an empty string is `''` (D14). */
  value: string | null;
  /** The engine cut this value at MAX_CELL_BYTES; the rest was never fetched (D14). */
  truncated: boolean;
}

export const cellSelectionState = reactive<{ current: SelectedCell | null }>({ current: null });

export function publishSelectedCell(cell: SelectedCell | null): void;
/** Called from tabs.ts beside every dropPage(): a closed tab has no selected cell. */
export function clearSelectedCellFor(tabId: string): void;

/** Stable identity of a selection, for `data-cell-key` and for change detection. */
export function cellKey(cell: SelectedCell): string;   // `${tabId}:${row}:${column.name}`
```

Notes that are not optional:

- `publishSelectedCell` **replaces** `current` wholesale; it never mutates the existing object. Downstream watchers compare on `cellKey` plus `value`, so an in-place mutation would be invisible to them.
- `value` is a plain string. One cell is at most 64 KB (§0 note 9), so the panel's whole retained footprint is that string plus CodeMirror's document — worth stating against §2.2, and worth remembering if anyone later proposes publishing a *range*.
- The module holds no history, no map keyed by tab, no per-tab last-selection. One cell. When the user switches tabs the grid remounts and publishes again (or publishes `null`).

### 4b. `src/renderer/views/celleditor/formats.ts` — the vocabulary (D8)

```ts
export const CELL_FORMATS = [
  'json', 'xml', 'sql', 'base64', 'hex',
  'epochSeconds', 'epochMillis', 'iso8601', 'uuid', 'url', 'csv', 'text',
] as const;
export type CellFormat = (typeof CELL_FORMATS)[number];

export const FORMAT_LABEL: Record<CellFormat, string> = {
  json: 'JSON',
  xml: 'XML / HTML',
  sql: 'SQL',
  base64: 'Base64',
  hex: 'Hex',
  epochSeconds: 'Epoch (seconds)',
  epochMillis: 'Epoch (milliseconds)',
  iso8601: 'ISO-8601',
  uuid: 'UUID',
  url: 'URL',
  csv: 'CSV',
  text: 'Plain text',
};

/** Which CodeMirror grammar renders a format; `plain` means no language extension (D3). */
export type EditorLanguageId = 'json' | 'xml' | 'sql' | 'plain';
export const FORMAT_LANGUAGE: Record<CellFormat, EditorLanguageId>;  // json/xml/sql map across; the rest are 'plain'

/** True only where a lossless reformatter exists (D11): json and xml. */
export function canBeautify(format: CellFormat): boolean;
```

### 4c. `src/renderer/views/celleditor/detect.ts` — the scored guess (D9, D15)

```ts
export interface DetectInput {
  text: string;
  typeClass: TypeClass;      // from the ColumnDescriptor (§0 note 7)
  dataType: string;          // the server's verbatim type name
  columnName: string;        // used only by the epoch detectors' name hint (§5)
}

export interface FormatGuess {
  format: CellFormat;
  /** 0..1. `text` is always present as the 0.10 floor, so the list is never empty. */
  score: number;
  /** One short phrase, shown as the `Auto` option's title: 'balanced JSON object, 214 tokens'. */
  reason: string;
}

/** Sorted by score desc, then by §5's precedence order. Never empty. */
export function detectFormat(input: DetectInput): FormatGuess[];

/** D15's one-line reading, or null when the format implies no decoding. */
export function describeValue(format: CellFormat, text: string): string | null;
```

`detectFormat` must be pure, synchronous and allocation-light: it is on the 50 ms path and it runs against up to 64 KB. No detector may use a regex with nested quantifiers, and every full-text scan must be a single pass (§5).

### 4d. `src/renderer/views/celleditor/beautify.ts` — lossless reformatting (D10, D11)

```ts
export type BeautifyMode = 'indented' | 'compact';

export interface BeautifyResult {
  /** The reformatted text, or the input unchanged when `ok` is false. */
  text: string;
  ok: boolean;
  /** Present only when `ok` is false: 'invalid JSON at offset 4021'. Shown on the status line. */
  reason?: string;
}

export function beautify(text: string, format: CellFormat, mode: BeautifyMode): BeautifyResult;
```

`beautify` is **always applied to the stored value**, never to the current buffer (§6). That is what makes the two modes mutually reversible and Reset trivial, and it is what makes `indented(indented(x)) === indented(x)` true by construction rather than by care.

### 4e. `src/renderer/editor/CodeMirrorHost.vue` — the wrapper (D4)

```ts
defineProps<{
  doc: string;
  language: EditorLanguageId;
  /** Only consulted when `language === 'sql'` (D17). */
  sqlDialect?: 'postgres' | 'mariadb';
  readOnly: boolean;
}>();
```

Construction, exactly:

- `onMounted` builds the state with `[lineNumbers(), highlightSpecialChars(), EditorView.lineWrapping, keymap.of(defaultKeymap), syntaxHighlighting(kiraHighlightStyle), kiraEditorTheme, languageCompartment.of(...), readOnlyCompartment.of(...)]` and nothing else. No `history()` (nothing is editable — P5 adds it with editing), no `basicSetup`, no folding, no search, no autocomplete.
- `highlightSpecialChars()` earns its place: a database client that renders a stray `\r`, a NUL or a zero-width space as an invisible gap is lying about the stored value.
- The `EditorView` is a plain module-scope `let` inside `<script setup>`, never `ref`/`shallowRef`/`reactive` (§0's rule, D4).
- `watch(() => props.doc)` → one `dispatch({ changes: { from: 0, to: state.doc.length, insert: doc }, selection: { anchor: 0 } })` and reset the scroller to the top. Never re-create.
- `watch(() => [props.language, props.sqlDialect])` → `dispatch({ effects: languageCompartment.reconfigure(...) })`.
- `watch(() => props.readOnly)` → `dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(...)) })`.
- `watch(() => [settingsState.appearance.fontFamily, settingsState.appearance.fontSize])` → `view.requestMeasure()` (D18).
- `onUnmounted` → `view.destroy()`.
- The root element fills its parent (`height: 100%`); the scroller, not the panel, owns the overflow.

### 4f. Test hooks (normative)

Pinned here so Step 5 and Step 7 cannot drift, and so a later phase knows what it must not rename casually (the same discipline P0 applied to the chrome regions).

| Hook | On | Meaning |
|---|---|---|
| `data-testid="cell-editor"` | the shell's panel wrapper | **Unchanged from P0.** Present iff the panel is visible. |
| `data-testid="cell-editor-panel"` | `CellEditorView`'s root | Present only when a cell is selected. |
| `data-cell-key` | same | `${tabId}:${row}:${column.name}` (§4a) — what a spec awaits to know the panel caught up. |
| `data-format` | same | The **effective** format id: the override if set, else the detected one. |
| `data-detected` | same | The detected format id, always, even when overridden. |
| `data-formatted` | same | `none` \| `indented` \| `compact` (§6c). |
| `data-read-only-reason` | same | `connection-read-only` \| `not-editable-yet` (D5). |
| `data-testid="cell-editor-empty"` | the `EmptyState` | Present iff no cell is selected. |
| `data-testid="cell-editor-target"` | the header label | `<table>.<column> · row N`, with `dataType` as a type pill beside it. |
| `data-testid="cell-editor-badge-null"` / `-empty` / `-truncated` | the badges | Present iff that state holds (D14). |
| `data-testid="cell-editor-format"` | the `<select>` | Value is `auto` or a `CellFormat`. |
| `data-testid="cell-editor-beautify-indented"` / `-compact` / `-reset` | the three buttons | `disabled` per §6c. |
| `data-testid="cell-editor-status"` | the status line | Detection, byte length, reading, notices. |
| `data-testid="cell-editor-collapse"` | the header chevron | Calls `toggleCellEditorPanel()`. |
| `data-testid="toggle-cell-editor-panel"` | the status-bar button | Same handler (D16). |

The editor's text is read through `[data-testid="cell-editor-panel"] .cm-content` — CodeMirror's own class, which is stable across its 6.x line.

### 4g. The seam P5 fills — specified, not built (D5)

P3 ships none of this. It is written down so P5 is additive and nothing here gets re-litigated.

P5 adds `src/renderer/views/celleditor/edit.ts`:

```ts
export function commitCellEdit(target: SelectedCell, next: string | null): void;
```

which stages a pending cell edit on the target tab's pending-change set (§8.13) and never writes to the database. What P3 guarantees it:

1. **`SelectedCell` is already resolved and correct** — the right tab, the right page column after any reorder, the decoded value, the NULL/empty distinction. P5 adds no resolution logic.
2. **`readOnlyReason` already exists** with `connection-read-only` computed from `ConnectionSummary.readOnly` and asserted by a spec. P5 replaces the `not-editable-yet` arm with `null` and flips `CodeMirrorHost`'s `readOnly` prop; it does not rewrite the reason plumbing. P5 also adds `value-truncated` to the union — a value cut at 64 KB (§0 note 9) can never be staged, because staging it would write the prefix over the whole value.
3. **P3 deliberately does not resolve the row's primary key.** §8.13 addresses rows by PK and needs a story for composite keys, for tables with no PK (`ctid` and friends) and for added rows that have no key yet — that story is one design, owned by P5, and half of it built in P3 against the cell editor's needs alone would be the wrong half.

---

## 5. Detection rules (normative)

Implement §5 exactly. Every rule here exists because the obvious version of it is wrong in a way the fixture will catch.

### 5a. Eligibility by `typeClass`

Detectors run only when the column's `typeClass` allows them. This is P2 D3's dividend: the server already told us what the column is, and no regex beats that.

| `typeClass` | Eligible detectors |
|---|---|
| `json` | `json`, `text` |
| `temporal` | `iso8601`, `text` |
| `number` | `epochSeconds`, `epochMillis`, `text` |
| `binary` | `hex`, `base64`, `text` |
| `boolean` | `text` |
| `text`, `other` | **all twelve** — this is §8.6's "even for free text" case |

A NULL value runs no detector at all (D14): the panel shows the column's override if one is set, else `text`, and the `<select>` is disabled.
An empty string is `text` at score 1.0 with reason `empty value`, with no other detector run.

### 5b. Per-detector gates and scores

`t` is the input trimmed of leading and trailing ASCII whitespace. All regexes are anchored and linear; none may contain a nested quantifier.

| Format | Gate | Score |
|---|---|---|
| `json` | `t` starts with `{` or `[` **and** ends with the matching `}` / `]` | full scan by `beautify.ts`'s JSON scanner: valid → **0.95**, and **1.0** when `typeClass === 'json'`. Scan fails → **0.35**, reason `looks like JSON, invalid at offset N` — deliberately still the winner over plain text, because showing malformed JSON with JSON highlighting is how a user finds the malformation. |
| `xml` | `t` starts with `<` and ends with `>` | tags balance under the XML scanner → **0.90**; a `<?xml` or `<!DOCTYPE` prefix → **0.95**; starts and ends right but unbalanced → **0.30** |
| `sql` | the first word is one of `select insert update delete with create alter drop truncate explain begin commit rollback grant revoke merge` (case-insensitive) | a second keyword from `from where join values set into group order limit returning union having on as` is also present → **0.70**; leading keyword only → **0.45** |
| `uuid` | full match `^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$` | **0.95**, and **1.0** when `dataType` contains `uuid`. Shape-only on purpose: version/variant nibble checks reject the nil UUID and anything a server stored that RFC 4122 does not bless, and the panel's job is to render what is there. |
| `url` | full match `^[a-zA-Z][a-zA-Z0-9+.\-]*://[^\s]+$`, length ≤ 4096 | **0.90**. A bare `example.com` is text — a scheme is required, which also covers `s3://` and `postgres://`. |
| `hex` | full match `^(0x)?([0-9a-fA-F]{2})+$`, ≥ 16 hex digits, **and** at least one digit in `a–fA–F` **or** a `0x` prefix **or** `typeClass === 'binary'` | `0x` prefix or `binary` → **1.0**; otherwise **0.60**. The "at least one letter" clause is the rule that stops an 8-digit integer id from being called hex. |
| `base64` | full match `^[A-Za-z0-9+/]+={0,2}$` or the URL-safe `^[A-Za-z0-9_-]+={0,2}$`; length a multiple of 4 and **≥ 24**; at least one character outside `[0-9a-fA-F]`; **and** either it contains one of `+ / = _ -` **or** it mixes upper case, lower case and a digit; and it decodes without throwing | **0.75**, or **0.85** when it is padded or contains `+`/`/`. The last gate clause is the one that matters: without it every 16-character lower-case slug in the database is "base64", because random letters decode to random bytes and no amount of entropy-sniffing tells them apart. Requiring 24 characters plus either a base64-only character or a mixed character profile costs a few genuine short payloads and buys a detector that is not constantly wrong. Note that hex wins any genuine overlap, which is the right default for a database client. |
| `epochSeconds` | full match `^-?\d{9,11}$` and the value is within `[1e8, 4.1e9]` (1973-03-03 … 2100-01-01) | **0.70**, **+0.10** when `columnName` matches `/(_at\|_time\|_ts\|timestamp\|date)$/i`, capped at 0.80 |
| `epochMillis` | full match `^-?\d{12,14}$` and the value is within `[1e11, 4.1e12]` | same shape as `epochSeconds` |
| `iso8601` | full match `^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z\|[+-]\d{2}(:?\d{2})?)?)?$` | **0.85**, and **0.95** when `typeClass === 'temporal'`. **The space separator is not optional to support:** Postgres renders `timestamptz` as `2024-01-15 10:23:45.123456+00` and MariaDB as `2024-01-15 10:23:45`, so a detector that insists on `T` fails on the app's single most common temporal value. |
| `csv` | ≥ 2 non-empty lines, and there is a delimiter `d ∈ {',', '\t', ';'}` for which every line yields the same field count ≥ 2 under a quote-aware split (a `"` opens a field that ends at the next unescaped `"`, `""` is a literal quote) | **0.60**, or **0.75** at ≥ 3 lines. A single line is never CSV — that rule alone is what keeps `a, b` in a comment column out of CSV mode. |
| `text` | always | **0.10** |

### 5c. Ties

Equal scores break on this order, highest first:

```
json  xml  sql  uuid  iso8601  url  epochMillis  epochSeconds  hex  base64  csv  text
```

### 5d. `describeValue` (D15)

| Format | Reading |
|---|---|
| `epochSeconds` | `new Date(n * 1000).toISOString()` → `2024-01-15T10:23:45.000Z` |
| `epochMillis` | `new Date(n).toISOString()` |
| `base64` | `N bytes decoded` |
| `hex` | `N bytes` |
| `csv` | `R rows × C columns` |
| everything else | `null` |

### 5e. Performance

Detection plus the first render must fit inside §2.1's 50 ms cell-selection budget with room to spare. Concretely: the whole `detectFormat` pass over a 64 KB value must stay **under 5 ms** on the dev machine, which single-pass scanners and anchored regexes achieve comfortably. Measure it once with a scratch script in Step 3; if it does not, the cause is a backtracking regex, not the size of the value.

---

## 6. Beautify rules (normative)

Both formatters are single-pass scanners over the **stored** text (D6/§4d). Neither ever parses a value into a JavaScript object (D10).

### 6a. JSON

- Tokens: structural `{ } [ ] : ,`; string literals (`"` … `"` honouring `\\` and `\"`); numbers; the bare literals `true`, `false`, `null`; whitespace.
- Every non-whitespace token is emitted as the **raw slice of the input**. A number is never re-rendered, a string is never re-escaped. This is the rule that keeps `{"id":12345678901234567890}` intact.
- `indented`: two spaces per depth level, `": "` after a key, one member per line, `,` at the end of the line it belongs to, `{}` and `[]` emitted as-is when empty.
- `compact`: no whitespace anywhere outside string literals.
- A scan failure (unexpected token, unterminated string, unbalanced bracket, trailing content) returns `{ text: input, ok: false, reason: 'invalid JSON at offset N' }` — a beautify never damages a document it did not understand. A **truncated** cell (§0 note 9) lands here by construction, which is the correct outcome and worth a comment.
- The same scanner backs the `json` detector (§5b), so "valid JSON" has exactly one definition in the app.

### 6b. XML / HTML

- Tokens: `<?…?>`, `<!--…-->`, `<![CDATA[…]]>`, `<!DOCTYPE …>`, opening tags, closing tags, self-closing tags, and text runs.
- Attributes are copied **verbatim** inside their tag — never re-quoted, never reordered, never entity-normalised.
- Depth increases on an opening tag and decreases on a closing tag. Self-closing tags and the HTML void elements (`area base br col embed hr img input link meta source track wbr`) never change depth — without that list, any HTML fragment containing a `<br>` indents everything after it into a staircase.
- `indented`: two spaces per depth, one token per line. Whitespace-only text runs are dropped; a text run with content is emitted on its own line with its leading and trailing whitespace trimmed and its interior left exactly as it was.
- `compact`: the same token stream joined with nothing between tokens; whitespace-only runs dropped, content runs verbatim.
- Unbalanced input (a closing tag with no opener, an unterminated tag) returns `ok: false` with a reason and the input unchanged.

### 6c. Behaviour in the panel

- Pressing **Indented** or **Compact** sets the panel's `formatted` state and rewrites the buffer from the stored value in that mode. Pressing the same button twice is a no-op the user cannot detect; pressing the other one switches.
- **Reset** clears `formatted` and restores the stored value. It is disabled when `formatted === 'none'`.
- `formatted` is per-panel, not per-column, and resets to `'none'` whenever the target cell changes. Remembering a beautify preference per column is a feature nobody asked for and would have to survive the same override-key design as D12 for no stated benefit.
- A failed beautify leaves the buffer alone, leaves `formatted` at `'none'`, and shows the reason on the status line.

---

## Step 1 — CodeMirror lands: dependencies, tokens, and the shared host

**Files:** `package.json`, `src/renderer/theme/tokens.css` (mod), `src/renderer/editor/{CodeMirrorHost.vue,theme.ts,languages.ts}` (new)

```
bun add -d @codemirror/state @codemirror/view @codemirror/language @codemirror/commands \
           @codemirror/lang-json @codemirror/lang-xml @codemirror/lang-sql @lezer/highlight
```

`-d` is not a typo — see §0 note 15 and D3. `bunfig.toml` pins exact versions (§0 note 16).

### 1a. Syntax tokens (D18)

Append a group to `tokens.css`, values taken from VS Code Dark Modern's default token colours so the editor and the chrome are visibly one theme:

```css
  /* Syntax tokens for CodeMirror (§3's editor surfaces: DDL, cell editor, document view,
     command preview, console). Dark Modern's default token colours. */
  --kira-syntax-comment: #6a9955;
  --kira-syntax-string: #ce9178;
  --kira-syntax-number: #b5cea8;
  --kira-syntax-keyword: #569cd6;
  --kira-syntax-control: #c586c0;
  --kira-syntax-name: #9cdcfe;
  --kira-syntax-property: #9cdcfe;
  --kira-syntax-function: #dcdcaa;
  --kira-syntax-tag: #569cd6;
  --kira-syntax-attribute: #9cdcfe;
  --kira-syntax-operator: #d4d4d4;
  --kira-syntax-punctuation: #cccccc;
  --kira-syntax-meta: #808080;
  --kira-syntax-invalid: #f14c4c;
```

### 1b. `renderer/editor/theme.ts`

Exports two values and nothing else:

- `kiraEditorTheme = EditorView.theme({...}, { dark: true })` covering: `&` (background `--kira-bg`, colour `--kira-fg`, `height: 100%`), `.cm-scroller` (`font-family: var(--kira-font-family)`, `font-size: var(--kira-font-size)`, `line-height: 1.5`), `.cm-content` (padding), `.cm-gutters` (`--kira-bg`, `--kira-fg-disabled`, right border `--kira-border`), `.cm-activeLine` and `.cm-activeLineGutter` (transparent — an active-line highlight in a read-only viewer is noise), `.cm-selectionBackground` and `&.cm-focused .cm-selectionBackground` (`--kira-select`), `.cm-cursor` (`--kira-fg`), and the scrollbar colour token. `{ dark: true }` matters: it is what makes CodeMirror's own built-in dark defaults apply to anything the theme does not name.
- `kiraHighlightStyle = HighlightStyle.define([...])` mapping `@lezer/highlight`'s `tags` onto the new variables: `comment/lineComment/blockComment` → comment; `string/special(string)` → string; `number` → number; `bool/null/keyword/typeName/atom` → keyword; `controlKeyword/moduleKeyword` → control; `propertyName` → property; `variableName/labelName` → name; `function(variableName)` → function; `tagName/angleBracket` → tag; `attributeName` → attribute; `operator/compareOperator/logicOperator` → operator; `punctuation/separator/bracket` → punctuation; `meta/processingInstruction/documentMeta` → meta; `invalid` → invalid.

### 1c. `renderer/editor/languages.ts`

```ts
export function languageExtension(
  id: EditorLanguageId,
  dialect?: 'postgres' | 'mariadb',
): Extension;   // [] for 'plain'
```

`json()` / `xml()` are used directly; `sql({ dialect })` resolves `postgres` → `PostgreSQL`, `mariadb` → `MySQL`, `undefined` → the package default (D17). Static imports, not dynamic — three grammars are small, and an `await import()` in the middle of the 50 ms selection path buys nothing and introduces a race between two rapid cell clicks.

### 1d. `renderer/editor/CodeMirrorHost.vue`

Exactly §4e. Read §4e again before writing it; every line of it is there because the obvious alternative costs frames or leaks.

**Acceptance:** temporarily mount the host in `CellEditorPanel.vue` against a hardcoded multi-line JSON string and run `bun run dev`. Assert by eye and by devtools: the colours match the grid's chrome and Dark Modern; changing the font size in Settings → Appearance restyles the editor **and** re-lays it out (no stale character metrics — that is the `requestMeasure()` call); `readOnly: true` blocks typing but allows click-drag selection, ⌘A and ⌘C; toggling `layoutState.panel.cellEditor.visible` from devtools destroys and recreates the view with no console warning. Then **revert the temporary mount**. `bun run build` must succeed — a package in the wrong dependency bucket fails here and nowhere earlier. `bun run lint && bun run typecheck && bun run test:ui` green.

---

## Step 2 — The selected-cell contract

**Files:** `src/renderer/state/cellSelection.ts` (new), `src/renderer/views/grid/columns.ts` (mod), `src/renderer/views/grid/DataGrid.vue` (mod), `src/renderer/state/tabs.ts` (mod)

### 2a. `state/cellSelection.ts`

§4a verbatim. No imports from `views/`.

### 2b. `views/grid/columns.ts` — one column mapping, not two

Move the two computeds that today live inline in `DataGrid.vue`:

```ts
/** The display order: stored order filtered to live columns, then any new columns appended. */
export function resolveColumnOrder(page: TabularPage, stored: string[] | null): string[];
/** Display position -> index into page.columns/page.chunks. -1 when the name is gone. */
export function pageColumnIndexFor(page: TabularPage, order: string[], displayCol: number): number;
```

`DataGrid.vue` calls these instead of computing them locally (its `columnOrder` computed becomes a one-line call; `displayIndexToPageIndex` disappears in favour of the function). This is a pure extraction with no behaviour change, and it is the point at which the grid and the publication become structurally incapable of disagreeing about which column a click meant (§0 note 4).

### 2c. `DataGrid.vue` — publish

Add one `watch`, with `{ immediate: true }`, over `[() => rt()?.selection, () => pageVersion.n, () => props.tabId]`:

- No page, no runtime, or `selection === null` → `publishSelectedCell(null)`.
- `selection.kind === 'row' | 'column'` → `publishSelectedCell(null)` (D13).
- `selection.kind === 'cell'` → that cell. `selection.kind === 'range'` → `{ row: sel.row, col: sel.col }`, the focus end (D13).
- Resolve `columnIndex` through `pageColumnIndexFor`; a `-1` (the column vanished after a projection change) publishes `null`.
- Guard `row < page.rowCount` — a page swap can leave a selection pointing past the new page's end, and publishing a decoded cell from out of range would throw inside the codec.
- Read the value with the grid's existing `cell(tabId, row, pageCol)`; `isNull` becomes `value: null`, otherwise `value: text`. Carry `truncated` through.
- `connectionId` and `path` come from the tab record.

Plus one `onUnmounted`:

```ts
if (cellSelectionState.current?.tabId === props.tabId) publishSelectedCell(null);
```

The tab-id guard is load-bearing. `MainView.vue` keys `DataView` by tab id, so a tab switch unmounts one grid and mounts another, and the two orderings are not something to rely on: with the guard, a late unmount cannot clobber the freshly mounted tab's publication, and an early one is corrected by the new grid's `immediate` watch. The same unmount path covers a tab going back to *Reconnect & load* after an `E_NOT_FOUND` (which unmounts the grid but leaves the tab open) — the panel must not keep showing a value from a grid that is no longer on screen.

Two invariants worth stating because they read as accidents otherwise:

- **The panel always shows what the grid highlights.** `pageVersion` is in the watch's dependency list, so after paging, filtering or refreshing, the still-highlighted `(row, col)` republishes against the *new* page. The grid and the panel move together or the grid is lying.
- The watch must **not** depend on `scrollTop`/`scrollLeft`: scrolling changes no selection, and republishing per scroll frame would put a decode on the scroll path that §2.1 forbids.

### 2d. `state/tabs.ts`

Call `clearSelectedCellFor(id)` beside each existing `dropPage(id)` — in `closeTab`, `closeOthers` and `closeToTheRight`/`closeAll`'s loops. A panel showing a cell from a tab that no longer exists is a bug waiting for P5 to turn into a write against a closed tab.

**Acceptance:** the panel is still the P0 empty state; drive this from devtools. Clicking a cell sets `cellSelectionState.current` with the right `column.name`, `row` and `value`; arrow keys move it; shift-click publishes the focus end; clicking a row-number or a header clears it to `null`; **dragging a column to a new position and then clicking the same visual cell publishes the same `column.name` as before the drag** (the regression §0 note 4 exists to prevent); a NULL cell publishes `value: null` and the empty-string cell publishes `''`; the 1 MB cell in `nulls_and_unicode` publishes `truncated: true`; closing the tab clears it; scrolling changes nothing. `bun run test:ui` green — in particular `perf.spec.ts`, which is the check that the publication did not land in the scroll path.

---

## Step 3 — The format vocabulary and autodetect

**Files:** `src/renderer/views/celleditor/{formats.ts,detect.ts}`

Write §4b and §4c as code, implementing §5 exactly. Nothing imports these yet.

Two things here are easy to get subtly wrong and expensive to find later:

- **The `typeClass` gate is applied before any detector runs**, not as a score adjustment afterwards. `12345678` in an `int4` column must come back `text`, not `hex` — if it comes back `hex` the gate was implemented as a bonus instead of a filter.
- **`describeValue` must not throw** on input that passed its detector's gate but is nonsense at the edges (an epoch of `-999999999`, a base64 string whose decode is empty). Return `null` rather than a partially built string.

Verify with a scratch script (delete it before committing — Step 7's spec is the permanent version) over at least these inputs, asserting the winning format:

| Input | `typeClass` | Expected |
|---|---|---|
| `{"a":1,"b":[1,2,3]}` | `json` | `json` @ 1.0 |
| `{"a":1,"b":[1,2,3]}` | `text` | `json` @ 0.95 |
| `{"a":1,` | `text` | `json` @ 0.35, reason names an offset |
| `<root><a x="1"/></root>` | `text` | `xml` |
| `<!DOCTYPE html><html><br><p>hi</p></html>` | `text` | `xml` @ 0.95 |
| `select id from t where x = 1` | `text` | `sql` @ 0.70 |
| `SELECT` | `text` | `sql` @ 0.45 |
| `00000000-0000-0000-0000-000000000000` | `text` | `uuid` |
| `2024-01-15 10:23:45.123456+00` | `temporal` | `iso8601` @ 0.95 |
| `2024-01-15T10:23:45Z` | `text` | `iso8601` |
| `1705315425` | `text` | `epochSeconds`, reading `2024-01-15T…Z` |
| `1705315425123` | `text` | `epochMillis` |
| `12345678` | `number` | `text` — **the gate test** |
| `12345678` | `text` | `text` — hex needs a letter or `0x` |
| `deadbeefdeadbeef` | `text` | `hex`, not `base64` |
| `0xcafebabe…` (≥ 16 digits) | `binary` | `hex` @ 1.0 |
| `SGVsbG8sIFdvcmxkIQ==` | `text` | `base64` @ 0.85 (padded), reading `13 bytes decoded` |
| `productnamefoo01` | `text` | `text` — **the base64 false-positive test** |
| `https://example.com/a?b=c` | `text` | `url` |
| `example.com` | `text` | `text` |
| `a,b,c\n1,2,3\n4,5,6` | `text` | `csv`, reading `3 rows × 3 columns` |
| `a, b` | `text` | `text` — one line is never CSV |
| `""` (empty) | `text` | `text` @ 1.0, reason `empty value` |
| 64 KB of lorem ipsum | `text` | `text`, and the whole pass under 5 ms (print the timing) |

**Acceptance:** the table above holds; `bun run lint && bun run typecheck` green.

---

## Step 4 — Beautify

**Files:** `src/renderer/views/celleditor/beautify.ts`

Write §6 as code. The JSON scanner is shared with `detect.ts`'s `json` gate — export it from `beautify.ts` and import it there, not the other way round, so the file that owns the grammar owns the validator.

Verify with a scratch script (delete before committing) asserting:

- `beautify('{"id":12345678901234567890}', 'json', 'indented')` contains the digits **verbatim** — the single most important assertion in this step (D10).
- `indented(indented(x)) === indented(x)` and `compact(compact(x)) === compact(x)` for a nested document.
- `compact(indented(x)) === compact(x)`.
- A string containing `}`, `\"`, `\\` and a literal newline escape survives byte-identical.
- `<a b="1 > 2"/>`'s attribute is untouched; a `<!-- comment -->`, a `<![CDATA[ <x> ]]>` and a `<?xml …?>` are each emitted as one token.
- `<p>a<br>b</p>` does not staircase (the void-element rule).
- A truncated JSON document (take `nested_json`'s value and cut it at 64 KB) returns `ok: false` with an offset, and the input unchanged.
- An XML document with a stray `</b>` returns `ok: false`, input unchanged.

**Acceptance:** those hold; `bun run lint && bun run typecheck` green.

---

## Step 5 — The panel

**Files:** `src/renderer/views/celleditor/{CellEditorView.vue,state.ts}`, `src/renderer/workbench/panels/CellEditorPanel.vue` (mod)

### 5a. `views/celleditor/state.ts`

```ts
export type ReadOnlyReason = 'connection-read-only' | 'not-editable-yet';   // P5 adds 'value-truncated'

/** Session-only, never persisted (D12). Key: `${connectionId}\u0000${path}\u0000${column}`. */
export function overrideFor(cell: SelectedCell): CellFormat | null;
export function setOverride(cell: SelectedCell, format: CellFormat | null): void;

/** connection-read-only wins, so §8.6's case is always the visible one. */
export function readOnlyReasonFor(cell: SelectedCell): ReadOnlyReason;
```

The override map is a `reactive<Record<string, CellFormat>>({})` — a plain record, because the keys are strings and the values are twelve-member literals, and nothing here is hot. A `\u0000` separator, because a connection id is a UUID but a path segment can legitimately contain `:` and `/`.

### 5b. `views/celleditor/CellEditorView.vue`

One header row, the editor, one status line. Nothing else.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ big_rows.payload · row 42 · [jsonb] [NULL]      [Auto — JSON ▾] │ [⇥][⇤] [↺]   🔒 ⌄ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  CodeMirrorHost                                                                         │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ detected JSON · 1 420 bytes · showing the first 64 KB                                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

The control order follows `docs/design/vscode-modern-ui/Main.dc.html`'s cell-editor head for everything P3 has (§0 note 23), which is why the format select sits left of the beautify pair rather than beside the target label.

- **Empty state**: when `cellSelectionState.current` is `null`, render the existing `EmptyState` with `icon="edit"` and label `No cell selected`, unchanged from P0. The header is not drawn in this state.
- **Target label**: `<tail of path>.<column name>`, then `row N` (1-based, matching the gutter), then the column's `dataType` verbatim as a small type pill (the mockup's `.type-pill`). Truncate the label with CSS, never with JavaScript.
- **Badges**: `NULL`, `empty`, `truncated` (D14), each a small chip with its own `data-testid`.
- **Format select**: `Auto — <detected label>` first, then the twelve formats in `CELL_FORMATS` order. Selecting `Auto` calls `setOverride(cell, null)`. The `<select>`'s `title` is the winning guess's `reason`. Disabled for a NULL value.
- **Beautify**: two icon buttons and a Reset, `disabled` per D11/§6c with a `title` explaining which (`Indented and compact formatting apply to JSON and XML/HTML.` / `Already showing the stored value.`).
- **Read-only chip**: a lock icon plus `Connection is read-only` or `Read-only in this version`, the latter with `title="Editing a cell stages a pending change; that arrives in a later version."` (D5).
- **Collapse chevron**: far right, calls `toggleCellEditorPanel()` (Step 6).
- **Status line**: `detected <LABEL>` or `<LABEL> (manual)`, the byte length of the value, `describeValue`'s reading when there is one, the truncation note when truncated, and the beautify failure reason when one is pending. Muted, one line, ellipsised.

The populate path, which is the one that has to fit §2.1's 50 ms:

```
watch cellSelectionState.current (and the override for it)
  -> value === null ? doc = '' : doc = value
  -> format = override ?? detectFormat(...)[0].format
  -> language = FORMAT_LANGUAGE[format]
  -> formatted = 'none'
  -> the host's props change; the host dispatches one transaction
```

No `await`, no `nextTick` dance, no re-creation of the host (`v-if` on the host component would defeat D4 — the host stays mounted and its props change).

Two guards on that path:

- **A republication of the same cell with the same value is a no-op.** `pageVersion` bumps on every page swap and the grid republishes; if the resulting `cellKey` and `value` are unchanged, do not touch `doc`, do not re-run detection, and do not reset `formatted`. Otherwise a background refresh would silently undo a user's beautify.
- **`doc` is never `null`.** A NULL cell passes `''`; the badge, not the document, carries the distinction (D14). Passing `null` into a `string` prop is the most likely source of the Vue warning that fails §9's last row.

Root element attributes for the spec: `data-testid="cell-editor-panel"`, `data-cell-key`, `data-format`, `data-detected`, `data-read-only-reason`, `data-formatted`.

### 5c. `workbench/panels/CellEditorPanel.vue`

Becomes a delegation, exactly like `MainView.vue` delegates to `DataView.vue`:

```vue
<script setup lang="ts">
import CellEditorView from '../../views/celleditor/CellEditorView.vue';
</script>
<template><CellEditorView /></template>
```

The `data-testid="cell-editor"` stays on the shell's wrapper div where P0 put it (`smoke.spec.ts` asserts it).

**Acceptance:** `bun run dev` against `scripts/demo-dbs`' Postgres. Open a table with a `jsonb` column and click a cell: the value appears formatted-as-stored with JSON highlighting inside the panel's existing splitter, in the app font. Then: **Indented** reflows it and enables **Reset**; **Compact** puts it on one line; **Reset** returns it to exactly the grid's text (compare with the grid cell). Override the column to `Plain text` and click three more rows in the same column — the override holds; open the same table in a second tab — it still holds; choose `Auto` — detection comes back. Click a `uuid` cell, a `bytea` cell (`0x…` → hex, byte count on the status line) and a `timestamptz` cell (ISO-8601 despite the space separator). Click a NULL and an empty string — different badges, empty editor, select disabled for the NULL. Mark the connection read-only from the tree menu and click a cell — the chip reads `Connection is read-only`. Throughout all of it the **operations panel gains zero rows**. `bun run lint && bun run typecheck && bun run build && bun run test:ui` green.

---

## Step 6 — Panel visibility

**Files:** `src/renderer/workbench/state/layout.ts` (mod), `src/renderer/workbench/StatusBar.vue` (mod), `src/renderer/views/celleditor/CellEditorView.vue` (mod: the chevron's handler), `src/renderer/workbench/panels/OperationsPanel.vue` (mod: one comment — D19)

- `layout.ts` gains `toggleCellEditorPanel()`, three lines, identical in shape to the two beside it.
- `StatusBar.vue` gains a third toggle button between Project and Operations: `data-testid="toggle-cell-editor-panel"`, codicon `symbol-string`, label `Cell editor`, `:class="{ active: layoutState.panel.cellEditor.visible }"` — the same markup as its neighbours.
- The header chevron calls the same function. Both paths write the same persisted flag, so hiding from one and showing from the other works with no extra state.
- `OperationsPanel.vue`: update P1 Step 10b's comment on the detail row to record D19 — CodeMirror now exists, the blocker is `VirtualList.vue`'s fixed row height, and the upgrade belongs with P5's command-preview panel. Change no markup.

**Acceptance:** the panel hides and shows from the status bar and from its own chevron; the state survives `relaunch()`; `smoke.spec.ts` still passes (the panel is visible by default, so its always-present assertion is unaffected); toggling it off while a cell is selected and back on re-populates the editor with that cell (the publication outlives the panel).

---

## Step 7 — Fixture and Playwright spec

**Files:** `tests/db/fixtures/0001_seed.sql` (mod), `tests/ui/cell-editor.spec.ts` (new)

### 7a. `app.formats` (D20)

Append to the Postgres seed, after `nested_json`:

```sql
-- ---------------------------------------------------------------------------------------------
-- formats — one row per §8.6 autodetect format, all in a plain `text` column so the detector
-- has to work from the value alone (typeClass 'text' enables every detector, §5a).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.formats (
  id     serial PRIMARY KEY,
  kind   text NOT NULL,          -- the expected detection, asserted by tests/ui/cell-editor.spec.ts
  sample text NOT NULL
);
```

Twelve rows, `kind` naming the expected format id and `sample` holding a representative value: a nested JSON object **containing a 20-digit integer literal** (scenario 5 depends on it); an XML document with an attribute, a comment and a CDATA section; a multi-clause `SELECT`; a padded base64 string of at least 24 characters with a known decoded byte length; a `0x`-prefixed hex string of at least 8 bytes; `1705315425`; `1705315425123`; `2024-01-15T10:23:45.123Z`; a nil-plus-one UUID; `https://example.com/path?q=1`; a three-line CSV; and a sentence of prose. Plus one thirteenth row, `kind = 'json-invalid'`, holding a JSON object cut mid-string — the §5b 0.35 case.

`kind` exists so the spec can address rows by meaning rather than by index; keep the insertion order stable and let the spec look rows up by their `kind` value through the grid's own cells.

Nothing else in the seed changes. Re-verify §0 note 20 before committing (`rg "byKind\('table'\)" tests/db`), then run `bun run test:db` — it must be green and unchanged in scenario count.

### 7b. `tests/ui/cell-editor.spec.ts`

Postgres-backed, following `data-view.spec.ts`'s conventions exactly (§0 note 18): its own copies of `findRow`/`expandRow`/`openRowMenu`/`getOps`, a Docker skip in `beforeAll`, connection creation through `window.kira.connectionsCreate`, and `expect(consoleErrors).toEqual([])` at the end. Turn prefetch off at the start for the op-count assertion.

A helper worth writing once at the top:

```ts
async function selectCell(page: Page, row: number, column: string): Promise<void>;
async function editorText(page: Page): Promise<string>;   // '.cm-content' innerText inside the panel
```

Scenarios:

1. **Populate.** Open `app.formats`, click the `sample` cell of the JSON row; the panel's `data-cell-key` becomes `<tabId>:<row>:sample`, `data-detected` is `json`, the editor text equals the grid cell's full value, and the target label names `formats.sample` and `row N`.
2. **Every format.** For each row of `app.formats`, click its `sample` cell and assert `data-detected` equals that row's `kind`, read out of the grid's own `kind` cell so the fixture and the assertion cannot drift. The single exception is the `json-invalid` row, which must detect `json` (§5b's 0.35 case — a bad implementation gives `text`); express that as a one-line mapping beside the loop, not as a skipped row.
3. **Type-driven detection.** `app.nested_json.data` (a `jsonb` column) detects `json`; `app.wide_table.uuid_a` detects `uuid`; `app.wide_table.ts_a` detects `iso8601` **with the space-separated Postgres rendering**; `app.wide_table.bytea_a` detects `hex` and the status line reports a byte count; `app.wide_table.int_a` detects `text`, not `hex` (§5a's gate, through the real UI).
4. **Beautify.** On `nested_json.data`: **Indented** makes `.cm-content` span more than one line and enables Reset; **Compact** collapses it to one; **Reset** restores text equal to the grid cell's; `data-formatted` tracks `none|indented|compact`. On the `text` row both buttons are `disabled` with a title.
5. **Lossless numbers.** The JSON sample in `app.formats` contains a 20-digit integer (7a); after **Indented** and again after **Compact**, the editor text still contains those exact twenty digits. This is D10's end-to-end assertion and the one that catches a `JSON.parse` creeping back in.
6. **Manual override sticks per column, for the session.** Override `sample` to `Plain text`; click three other rows in the same column — `data-format` stays `text` and `data-detected` still reports the real guess; open the same table in a second tab and select a `sample` cell — still `text`; select a *different* column — unaffected; choose `Auto` — detection returns. Then `relaunch()` and assert the override is **gone** (D12's session-only rule, asserted rather than assumed).
7. **NULL, empty, truncated.** On `app.nulls_and_unicode` (`data-row` is 0-based, as `data-view.spec.ts` already uses it): row `0`'s `label` shows the `NULL` badge with an empty editor and a disabled format select; row `1`'s `label` shows the `empty` badge; row `3`'s `big_text` shows the `truncated` badge and a status line naming 64 KB.
8. **Selection semantics.** A shift-click range populates the focus end; clicking the row-number gutter clears the panel to its empty state; clicking a header does the same (D13).
9. **Read-only.** Create a second connection with `readOnly: true`, connect, open a table, select a cell: `data-read-only-reason` is `connection-read-only`. On the writable connection it is `not-editable-yet`. In both cases typing into `.cm-content` changes nothing (`editorText` unchanged after `page.keyboard.type('x')`).
10. **Zero operations.** Capture the op count before scenario 1 and assert it is unchanged after scenario 9 (excluding the reads the tab opens themselves — capture immediately after the page renders). This is the phase-level invariant from §0.
11. **Populate latency tripwire.** Measure in-page between the click and `data-cell-key` updating for a 64 KB cell; assert **under 250 ms** and log the measured value. Deliberately far looser than §2.1's 50 ms for the same reason `perf.spec.ts` is loose about frames — Playwright drives an instrumented, unoptimised build, and this catches "someone re-creates the EditorView per cell", not the budget itself. Say so in a comment; §2.1's real measurement is P12's.
12. **Panel toggle.** Hide the panel from the status bar, assert `[data-testid="cell-editor"]` is gone, show it from the status bar, assert the previously selected cell is still rendered; `relaunch()` and assert the visibility persisted.

Screenshots: `cell-editor.png` (a formatted JSON cell) and `cell-editor-readonly.png`.

**Acceptance:** `bun run test:db` green and unchanged; `bun run test:ui` green with Colima up; the two screenshots land in `test-results/screenshots/`; `consoleErrors` empty.

---

## 8. Explicitly out of scope for P3

Do not build, stub, or "prepare" any of these. If a P3 file seems to need one, the design is wrong — say so rather than scaffolding forward.

- **No editing, no staging, no commit.** No pending-change set, no draft store, no `stageCellEdit`, no dirty marker, no "unsaved changes" warning, no cell tinting in the grid, no `mutate` anywhere. The panel is read-only with a stated reason (D5). §4g is a specification, not a file to create. **P5.**
- **No engine-side read-only enforcement.** §8.12's guard lives in the engine and is P5's; P3's chip is a UI affordance over `ConnectionSummary.readOnly` and nothing more.
- **No DDL tab**, no `views/ddl/`, no `ddl()` on the adapter, no *Open DDL* menu item. `renderer/editor/` exists for P4 to use, and that is the whole extent of P3's contribution to it. **P4.**
- **No command preview.** The data toolbar's `⌘ preview command` button stays disabled and inert (P2 Step 9). **P5.**
- **No console**, no `console` tab kind, no SQL execution, and **no SQL formatter** (D11). **P5.5.**
- **No document, key/value or stream views**, and no second consumer of `cellSelection` beyond the grid. **P8–P10.**
- **No grid context menus** — *Copy*, *Copy as JSON*, *Edit*, *Set NULL*, *Filter by this value* are all §8.10 rows that P2 D22 assigned whole to P6. Selecting a cell still opens no menu. **P6.**
- **No clipboard code** of any kind. The editor's own ⌘C is the browser's, and that is all. **P6.**
- **No keyboard shortcuts, no menu items, no accelerators** for the panel or its actions (D16). **P6.**
- **No PK/FK affordances** on the selected cell, no "go to referenced row", no use of `column.isPrimaryKey` beyond it being carried in `SelectedCell` because it is part of the descriptor. **P7.**
- **No CodeMirror features beyond §4e's list**: no fold gutter, no search panel, no autocomplete, no linting, no bracket matching, no multiple cursors, no `basicSetup`. Each of them is one line to add later in the phase that wants it, and each is a permanent maintenance surface added now for nobody.
- **No operations-panel upgrade** to CodeMirror (D19) and no change to `VirtualList.vue`.
- **No new IPC, no new port op, no new setting, no new migration, no new persisted state** other than `panel.cellEditor.visible` finally being writable.
- **No changes to detection at runtime**: no learning, no per-user format memory beyond D12's session map, no settings section for formats.
- **No decoding into the buffer.** A base64 value is never replaced by its decoded bytes, an epoch is never replaced by a date (D15). A *decode* action is a plausible future feature and it is not in §8.6.
- **No unit tests.** Two suites only, and P3 adds to exactly one of them.

---

## 9. Risk register

| Risk | Signal | Response |
|---|---|---|
| **`EditorView` wrapped in a Vue ref/reactive** | Typing or scrolling in the editor is visibly laggy; devtools shows Proxy frames in the profile; odd "cannot read property of undefined" during `destroy()` | D4: a plain `let` inside `<script setup>`. Vue's reactivity must never see the view, its state or its DOM. Same class of bug as a `reactive()` page in P2. |
| **The view is re-created per cell** | Selecting cells feels heavy; the 250 ms tripwire in Step 7 fails; the DOM node count under the panel churns | D4's compartments. Symptom cause is almost always a `v-if` or a `:key` on `CodeMirrorHost` in `CellEditorView.vue`. |
| **`JSON.parse` creeps into beautify** | A 20-digit integer becomes `…568000` after Indented; Step 7 scenario 5 fails | D10. There is no acceptable shortcut here; the scanner is the feature. If the scanner is too slow (it will not be — 64 KB, one pass), the answer is a faster scanner, not a parser. |
| **CodeMirror lands in `dependencies`** | `bun run typecheck` passes, `bun run build` fails or the packaged renderer throws `Cannot find module '@codemirror/state'` at runtime | §0 note 15 / D3. `externalizeDepsPlugin()` externalises `dependencies` for main and preload; a renderer package must be bundled. Step 1's acceptance runs `bun run build` for exactly this reason. |
| **A backtracking regex on a 64 KB value** | Selecting one particular cell freezes the window for seconds | §5's rule: anchored, linear, no nested quantifiers. The CSV and base64 gates are the two most likely offenders — both must be a length/charset check plus one linear pass, never a `(…)+` over the whole document. |
| **Detection re-runs after beautify** | The format flips when you press Indented; the status line disagrees with the select | D9: detection is a function of the target and the override only. Beautify writes the buffer; it must not feed back into the detector. |
| **The publication lands on the scroll path** | `perf.spec.ts`'s p95 regresses; the grid decodes a cell per frame | Step 2c: the watch depends on selection, page version and tab id — never on scroll offsets. |
| **A stale selection after a page swap** | A `RangeError` or garbage text in the panel after paging, filtering or refreshing | Step 2c's `row < page.rowCount` guard, and the fact that `pageVersion` is in the watch's dependency list so a swap re-resolves rather than leaving the old value on screen. |
| **A display-column selection read as a page index** | After dragging a column, the panel shows a different column's value than the highlighted cell | §0 note 4 and Step 2b's single mapping. Step 2's acceptance drags a column on purpose. |
| **A 64 KB single-line value with wrapping** | Selecting the `big_text` cell janks | Expected to be fine — CodeMirror viewports a wrapped long line — but it is the worst case in the app, it is in the fixture, and Step 7 scenario 11 measures it. If it does jank, the fix is a soft display cap with a stated notice, decided with the measurement in hand, not a guess now. |
| **A truncated JSON value's beautify "fails"** | The status line says `invalid JSON at offset 65530` on a value that is obviously JSON | Correct behaviour (§6a), and the `truncated` badge is right beside it. Do not "fix" it by tolerating unterminated documents — a formatter that invents a closing brace is a formatter that lies. |
| **The format override outliving the session** | A relaunch comes back with the old override | D12: the map is module state in the renderer. If it survives a relaunch, something persisted it — find it and remove it, do not add a clearing pass. |
| **`app.formats` breaking an existing DB assertion** | `postgres.spec.ts` scenario 3 fails | §0 note 20 says it will not, and Step 7a re-verifies before committing. If a future spec starts counting tables in `app`, that spec is wrong, not the fixture. |
| **The panel toggled off with no way back** | The cell editor disappears permanently | D16's two entry points. This is the actual state of the tree today (§0 note 2) and the reason the status-bar button is not optional. |
| **Vue warnings in the spec** | `consoleErrors` non-empty at the end of `cell-editor.spec.ts` | Usually a prop type mismatch on `CodeMirrorHost` (`doc` receiving `null` instead of `''` for a NULL cell) or a watcher firing after unmount. Both are real bugs; the suite is right to fail. |

---

## 10. Open questions for the human

Both have defaults chosen and implemented in this plan; they are called out because they are the kind of thing worth overruling *before* the code exists.

1. **The panel is read-only for writable connections too (D5).** §8.6 says the panel is editable and that committing stages a pending change — but the pending-change set is P5, so P3 would have to either invent a draft store (P5's data structure, built early under another name) or let typing silently evaporate. Default taken: **read-only in P3, with the two reasons distinguished so §8.6's forced case is real and tested today**, and P5 flips one prop and adds the commit path. The alternative is an editable scratch buffer that discards on the next click; say so if you would rather have that.
2. **No SQL beautifier (D11).** SQL is detected and highlighted; the Indented/Compact buttons are disabled for it with a stated reason. Doing it properly means a dialect-aware formatter dependency and a set of house style choices (keyword casing, comma placement, wrap width) that belong with the query console. Default taken: **decline in P3, revisit in P5.5.** If SQL cells are common in your data and you want a rough formatter now, that is a reasonable overrule — but it will be replaced when the console lands.

---

## 11. Definition of done for P3

1. `bun install && bun run lint && bun run typecheck && bun run build && bun run test:ui && bun run test:db` is green from a clean clone with Colima running.
2. Clicking any grid cell populates the panel with that cell's exact stored text — the same string the grid shows, in full, up to the 64 KB the engine fetched — in the app's configured font, inside the panel P0 reserved.
3. Autodetect covers all twelve of §8.6's formats, is driven by both the value and the column's server type, is a scored ranked guess with a stated reason, and is asserted end to end for every format against real rows in `app.formats`.
4. The format override is a native `<select>` that always wins over detection and sticks per `(connection, table, column)` for the session — asserted across rows, across tabs, and asserted **not** to survive a relaunch.
5. Beautify offers *indented* and *compact* for JSON and XML/HTML, is byte-lossless (a 20-digit integer survives, proven in the spec), is idempotent, is disabled with a reason where no lossless formatter exists, and never touches the stored value — Reset always returns exactly the grid's text.
6. NULL, empty string and truncated are three visibly distinct states, and a truncated value says so rather than presenting a prefix as the value.
7. The panel is forced read-only with `data-read-only-reason="connection-read-only"` on a connection marked read-only, and read-only with the other reason everywhere else; typing changes nothing in either case.
8. CodeMirror lives in `src/renderer/editor/` as one host, one theme and one language map, in `devDependencies`, with no `basicSetup` and no feature beyond §4e's list — and `views/celleditor/` imports nothing from `views/grid/`.
9. **Using the cell editor produces zero database operations** — the operations panel gains no rows through the whole of Step 7's spec.
10. The cell editor panel toggles from the status bar and from its own header chevron, and the state persists across a relaunch.
11. `git diff --stat aed2999 -- src/main src/engine src/preload src/shared` is **empty**, and `schema_version` is still 2.
12. Nothing from §8 exists in the tree — in particular no staging call, no draft store, no fold gutter, no clipboard code, no SQL formatter, no DDL view, and no change to `VirtualList.vue`.
