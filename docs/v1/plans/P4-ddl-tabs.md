# P4 — DDL tabs

> Plan for SPEC.md §10 phase **P4**. Authored by Opus, executed by Sonnet.
> Deliverable: *Read-only DDL view, editable-ready model — small, independent.*
>
> P3 put CodeMirror in `src/renderer/editor/` explicitly so that P4 would not have to. P4 is the phase that collects on that: it is the app's **second tab kind**, its **first non-grid main view**, and the first time the `Adapter` interface grows a method since P2. Two thirds of the work is not the view at all — it is (a) teaching the tab model that `data` is not the only kind, and (b) making Postgres produce a table definition it has no `SHOW CREATE TABLE` for.

## 0. Ground rules for this phase

- Build **only** what P4 lists. Read §8 (Out of scope) before starting and again whenever you feel like "just adding" a save button, a diff, a copy item, an *Open DDL* on a sequence, or a second toolbar control.
- Run `bun run lint`, `bun run typecheck` and `bun run build` at the end of each numbered step. `bun run test:db` from Step 2 on, `bun run test:ui` from Step 5 on. A step is done when its acceptance check passes.
- **DDL is read-only in this phase and modelled for editing — and those are two different things.** The model work (§4a, §4f) is real and is P4's; the *editing affordance* is not, and none of it is built: no save button, no dirty flag, no diff, no `ALTER` generation, no staging call, not even a disabled one. §1 of the spec puts DDL editing outside v1 entirely. A control that does nothing is worse than no control.
- **Every statement Kira emits is quoted by the server, never by us.** Postgres: `format('%I' / '%L')`, `quote_ident`, `quote_literal`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`. MariaDB: `SHOW CREATE …`, plus the existing `quoteIdent` for the one identifier that has to reach the statement text. There is no place in P4 where TypeScript builds a quoted identifier or a quoted literal out of a name (D9).
- **No new dependency.** Not one. `renderer/editor/` already has everything the view needs, and both adapters already have a cancellable query helper. `package.json` is untouched.
- **No migration.** `metadata_cache.kind` and `op_log.kind` are unconstrained `TEXT` (§0 note 11), so the two new vocabulary members cost nothing on disk. `schema_version` is still 2 at the end of P4; if you think you need a migration, you are building P5.
- **The DDL read is a metadata read, not a data read.** It goes over the control channel through main and lands in the L1 cache with `children` and `describe`, not over the MessagePort with result pages (D1). If a P4 edit lands in `src/engine/data.ts`, `src/engine/cache/` or `src/renderer/bridge/data.ts`, the design took a wrong turn.

### P0/P1/P2/P3 realities you must work with (verified against the tree, not the plans)

These are facts about the code as it stands at **`b9ef41f`**. Do not rediscover them the hard way.

1. **The tree is two commits past P3's last step**, and both are the VS Code Modern UI restyle (`4f940bc` "apply the VS Code Modern UI mockup across the renderer", `b9ef41f` "merge tab-strip, toolbar and grid into one editor-area box"). P3's §0 note 23 caveat is therefore **spent** — the restyle has landed, `WorkbenchShell.vue` now draws one `.editor-area` box containing the tab strip, the toolbar and the main view, and `tokens.css` carries the radius tiers. P4 styles against `tokens.css` as it is and introduces no new token.
2. **`caps.ddl` already exists and is `true` for both adapters** (`src/engine/adapters/postgres/caps.ts`, `src/engine/adapters/mariadb/caps.ts`). `mariadb/caps.ts` even carries the comment *"`caps.ddl: true` is a statement about what MariaDB can do — `ddl()` itself is P4's."* `src/shared/caps.ts` documents the flag as *"gates §8.10's Open DDL"*.
3. **`Adapter` has no `ddl()`.** The normative roadmap comment at the bottom of `src/engine/adapters/adapter.ts` names P4's exact signature — `ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>`, gated by `caps.ddl` — and says not to change it without amending `docs/plans/P1-connections-and-tree.md` §4b. **`SourceText` does not exist anywhere in the tree** (`rg SourceText` returns that one comment). P4 defines it (D2).
4. **`tabKindSchema` already enumerates `'ddl'`** (`src/shared/domain/tabs.ts`), but `RENDERABLE_TAB_KINDS` is `['data']`, and `src/main/storage/repos/tabs.ts` **drops any restored row whose kind is not in that list**, with a `warn`. A DDL tab does not survive a relaunch until that array grows.
5. **`tabRecordSchema.state` is `dataTabStateSchema`**, with the comment *"widened to a union when a second kind lands"*. P4 is that phase (D4).
6. **Six renderer files read `tab.state.<data field>`**: `views/grid/DataGrid.vue`, `DataToolbar.vue`, `FilterToolbar.vue`, `FilterHistoryMenu.vue`, `views/grid/state.ts`, `project/menus.ts` — plus `state/tabs.ts` itself (`patchTabState`, `duplicateTab`). Every one of them is already downstream of a `kind === 'data'` guard; they need **narrowing, not logic**. `DataGrid.vue` and `FilterHistoryMenu.vue` each have their own local `function tab() { return tabsState.tabs.find(t => t.id === props.tabId) ?? null }`; `DataToolbar.vue` and `FilterToolbar.vue` each have `const tab = computed(() => activeTab.value)`.
7. **`MainView.vue` is the entire tab-kind dispatch in the app** — ten lines: `<DataTabView v-if="activeTab && activeTab.kind === 'data'" :key="activeTab.id" :tab="activeTab" />` else `<EmptyState icon="table" label="No tab open" />`. `:key` by tab id means one component instance per tab and a full remount on every tab switch.
8. **`Toolbar.vue` renders the tinted band for `kind === 'data'` only**, and otherwise an `EmptyState` labelled **"No connection selected"** — which is exactly what a DDL tab would show today. It also owns the §8.12 connection tint (`borderLeft` + `color-mix` background) for the band.
9. **The control channel has no generic "metadata read".** `IPC.treeChildren` / `treeDescribe` / `treeInvalidate` → `main/ipc/tree.ts` → `TreeService` (`main/tree-service.ts`), which does L1 cache-aside through `storage/repos/metadata-cache.ts` and calls `engineHost.call(ENGINE_OP.children | describe)`. Each op is its own named channel with its own Zod payload/result pair in `shared/protocol/engine-ops.ts`. DDL gets its own, in the same three places.
10. **`repos/metadata-cache.ts`: `MetaKind = 'children' | 'describe'`.** The unique index is `(connection_id, path)` — **`kind` is not part of the key** — so both payloads share one row under `{ children?, describe? }`; the row's `kind` column is informational (whichever was written last); `putCached` merges over one key inside a transaction; `dropCached(connectionId, path)` drops **all** of it; `MAX_PAYLOAD_BYTES` is 4 MB and an over-budget payload is logged and silently not cached.
11. **Neither `metadata_cache.kind` nor `op_log.kind` has a CHECK constraint** — both are plain `TEXT` (`0001_init.sql:47-54`, `:56-66`). Adding a `'ddl'` `MetaKind` and a `'ddl'` `OpKind` needs **no migration**.
12. **`opKindSchema`** (`shared/domain/ops.ts`) is a closed Zod enum — `connect, disconnect, children, describe, test, read, count` — with a comment reserving `'mutate'` (P5) and `'execute'` (P5.5). `OperationsPanel.vue` renders `item.record.kind` as free text; there is **no per-kind label or icon map to update**.
13. **Control-channel errors reach the renderer as `[CODE] message`.** `main/ipc/errors.ts` folds `err.code` into the message because Electron's IPC serialization drops everything but `.message`; the **port** channel preserves `err.code` (which is why `views/grid/state.ts` can switch on `DISCONNECTED_CODES`). Nothing in the renderer parses the prefix today — `project/state/tree.ts` renders the raw message. **P4 does not add a parser** (§4d explains what it does instead).
14. **§8.4's Reconnect & load lives in `DataView.vue` and nowhere else**, as `needsReconnect = !isHydrated(tab.id) || connectionStatus !== 'connected'` over two reactive sources. Both `isHydrated` and `connectionsState.states[id].status` are live, so a connection dropping mid-session flips the gate on its own. The DDL view needs its own copy of that three-line pattern — it is three lines, not a component to extract.
15. **`views/grid/state.ts` holds `runtime` as a `reactive` `Record<tabId, DataViewRuntime>`**, created lazily on first load and never pruned; `DataView.vue`'s `onMounted` loads only `if (!needsReconnect && !runtime[tab.id])`, which is what makes a tab switch not refetch. `views/ddl/state.ts` copies that shape (D15).
16. **The `ContextMenu` service already exists** — `workbench/state/contextMenu.ts` (`openContextMenu(ev, items)`, a `MenuItem` union with `item`/`submenu`/`separator`, `disabled`/`checked`/`danger`/`icon`/`swatch`) and `workbench/ContextMenu.vue`. `project/menus.ts` already builds `relationMenu(row)` for `table`/`view`/`matview` in §8.10's own order. **P4 adds one item to that array and nothing else.** §8.10's *full* matrix — grid cell/row/header, document, operations-log row, the remaining tab items — is P6's, and P4 must not start it.
17. **`relationMenu` has no caps awareness today.** Caps live at `connectionsState.states[id].caps` (`ConnectionState.caps` is `capsSchema.nullable()`), filled from the `ENGINE_OP.connect` result — so a **disconnected connection's caps are `null`**. That matters because `TreeService.children()` returns an L1 hit **before** `requireConnected()`, so a disconnected connection can legitimately render a fully expanded cached subtree. See **D5** for what the menu does about it.
18. **`renderer/editor/` is exactly three files and already does everything a DDL tab needs.** `CodeMirrorHost.vue` takes `{ doc, language, sqlDialect?, readOnly }`, holds the `EditorView` in a plain `let`, reconfigures language and read-only through `Compartment`s, has `lineNumbers`, `highlightSpecialChars`, `EditorView.lineWrapping`, `defaultKeymap`, `syntaxHighlighting(kiraHighlightStyle)` and the `--kira-font-*` theme, and **resets `scrollDOM.scrollTop = 0` on every `doc` change**. `languages.ts` maps `'sql'` + `'postgres' | 'mariadb'` onto `@codemirror/lang-sql`'s `PostgreSQL` / `MySQL` dialects. The host uses **no `defineExpose`** — a consumer cannot reach the `EditorView` (which is why D15 declines scroll persistence).
19. **`views/celleditor/CellEditorView.vue` is the pattern to copy** for a view that hosts the editor: computed props into `<CodeMirrorHost>`, `data-*` attributes on the root for the spec, one muted status line, `EmptyState` for the nothing-to-show case.
20. **Both adapters export `quoteIdent` from their own `read.ts`** (`postgres/read.ts:24` — `"…"` doubling, NUL rejected; `mariadb/read.ts:24` — backtick doubling, NUL rejected). Adapter rule 7 in `adapter.ts` is normative: *every identifier a statement emits came out of a catalog query in the same op*. Rule 3 is too: `ctx.setCommand()` before the statement, which `runQuery` already does for every call — so for a multi-query op the op log shows the **last** statement issued, exactly as `describe()` behaves today. That is not a bug to fix in P4.
21. **The fixtures already contain everything the DDL scenario needs — no fixture change in P4.** `tests/db/fixtures/0001_seed.sql` has `app.wide_table` (60 columns, PK, indexes), `app.order_items` (FKs), `app.composite_pk`, `app.employees` (self-referencing FK), `app."weird""name"`, `app."Order Items"`, `app.order_summary` (view), `app.customer_totals` (matview), `app.invoice_number_seq`, `app.full_name(...)` and `analytics.events`. `0002_mariadb_seed.sql` mirrors it (no matview) and adds `noop_procedure`.
22. **Neither DB spec has a DDL scenario.** `tests/db/postgres.spec.ts` runs 19 numbered tests ending at *"19. unsupported kind"*; `mariadb.spec.ts` runs 18 ending at *"18. read cannot write"*. §9.1 names **DDL** in its required scenario list, so this is genuinely new coverage, not a rename.
23. **`tests/ui/*.spec.ts` still copy their tree helpers per file** (`findRow`, `expandRow`, `openRowMenu`, `getOps`) — P3 §0 note 18 holds, and P4 follows the same convention rather than inventing a shared helper module mid-phase. `tests/ui/support/pg.ts` owns the container; `tests/ui/global.d.ts` types `window.kira` straight off `KiraApi`, so a new IPC method needs no test-side declaration.
24. **There is no DDL mockup.** `docs/design/vscode-modern-ui/` contains `Main.dc.html` (grid tab), `MainNoColor.dc.html`, `ConnectionDialog.dc.html`, `SettingsDialog.dc.html` — nothing draws a DDL tab. P4 has no mockup to follow and matches the chrome that landed in `4f940bc`/`b9ef41f`.
25. **`bunfig.toml` pins exact versions** and P4 adds no dependency, so `package.json` is not in §2's tree at all.

### Prerequisites to verify before Step 1

```
colima status                    # must report a running VM; if not: colima start --cpu 4 --memory 6 --disk 40
docker info                      # must succeed
docker pull postgres:17-alpine   # P4's DB scenario and its UI spec are Postgres-backed
docker pull mariadb:11.4         # P4's second DB scenario
```

---

## 1. Decisions made in this plan

The spec leaves these open. They are decided here — implement as written, do not re-litigate.

| # | Decision | Rationale |
|---|---|---|
| **D1** | **DDL travels the control channel, not the MessagePort.** One new engine op `adapter:ddl`, one new IPC channel `kira:tree:ddl`, one new `TreeService.ddl(connectionId, path, refresh)` doing L1 cache-aside beside `describe()`, one new `MetaKind` value `'ddl'` in `metadata_cache`. | §7 is explicit that L1 metadata is "databases, schemas, tables, columns, PK/FK, indexes, **DDL**", persisted in `metadata_cache`, no TTL, dropped on connection delete and refreshed on reconnect — every one of those behaviours already exists in `TreeService` and comes free. The port exists to move *columnar result pages as transferable buffers*; a few KB of text is not that. Putting it in the `kira:tree:*` group is not a naming stretch: that group has always meant "L1 metadata about a tree node", which is exactly what a definition is. A separate `main/ipc/ddl.ts` + service would duplicate `requireConnected`, the cache-aside and the deps for one method. |
| **D2** | **`SourceText` is `{ path, kind, qualifiedName, statements: string[], origin, notes, generatedAt }`**, declared with its Zod schema in a new `src/shared/domain/ddl.ts`, together with the single joiner `ddlText(source)`. No field is optional and none is unused in P4 (§4a maps each to the thing that reads it). | The roadmap comment in `adapter.ts` already promised this return type by name; P4 fills it in. The shape is chosen so that **every field earns its keep in P4 while also being what a later editing phase needs** (§4f) — a list of statements rather than one blob because the unit of execution and of per-statement error reporting is a statement; `origin` because "the server's own text" and "text Kira composed" are not interchangeable and the user must be able to tell; `notes` because a composed definition is incomplete by construction and hiding that would be a lie; `path`/`kind`/`qualifiedName` because they are the object identity any later `ALTER` addresses. One `ddlText()` so main, the renderer and the tests never disagree about what the document is. |
| **D3** | **"Editable-ready" means exactly the four guarantees in §4f and nothing more.** P4 ships **no** editing affordance: no save/apply, no dirty tracking, no diff, no `ALTER` generation, no draft store, no disabled-but-present button, no `edit.ts` stub. The `CodeMirrorHost` is mounted with `readOnly: true` unconditionally. | This is the P3 D5 call applied one phase later, and the same argument holds harder: §1 puts DDL editing outside **v1**, not merely outside P4, so machinery built now has no scheduled consumer at all. What a future phase actually needs from P4 is a *correct, addressable, honestly-labelled model of the current definition* — and that is real work P4 must do anyway to render anything. A greyed-out Save button would be the exact "half-implemented implementation" `AGENTS.md` forbids. |
| **D4** | **`TabRecord` becomes a discriminated union on `kind`.** `DataTabRecord { kind: 'data'; state: DataTabState }` and `DdlTabRecord { kind: 'ddl'; state: DdlTabState }`, `tabRecordSchema` becomes `z.discriminatedUnion('kind', […])`, `RENDERABLE_TAB_KINDS` becomes `['data', 'ddl']`, and `shared/domain/tabs.ts` exports `asDataTab(tab)`. `DdlTabState` is `{}` — a DDL tab persists no per-tab state. | The union on `kind` is the only shape that cannot be wrong: `z.union([dataTabStateSchema, ddlTabStateSchema])` on `state` alone would accept a `{}` for a `data` tab and quietly restore a broken grid. `state` is already commented "widened to a union when a second kind lands" (§0 note 5) — this is that. The cost is a mechanical narrowing pass over the six call sites of §0 note 6, all of which are already inside a `kind === 'data'` branch, and the benefit is that P5.5's `console`, P8's `document`, P9's `keyvalue` and P10's `stream` each add one member instead of re-opening this. `DdlTabState = {}` because a definition is entirely derived from `(connectionId, path)`: there is genuinely nothing per-tab to remember. |
| **D5** | **One entry point: an `Open DDL` item in the existing tree `relationMenu`** (table / view / matview), placed **after `Open data in new tab` and before `Refresh`** — §8.10's own order, with the gap where P5.5's *Open query console* will land. It is present iff `connectionsState.states[row.connectionId]?.caps?.ddl === true`. No tab-strip item, no keyboard shortcut, no menu-bar item, no change to double-click, no new `ContextMenu` service work. | §8.10's full matrix is P6's and P4 must not pre-build it — but the *service* and the *relation menu* already exist (§0 note 16), so the minimal, non-duplicative entry point is literally one array element in a function P6 will later extend. Gating on live caps is exactly what §5 says the flag is for and follows the precedent P2 set for the projection menu (`engine-ops.ts` records it: "the renderer's projection menu branches on this"). The consequence — the item is absent on a disconnected connection whose tree is being served from L1 (§0 note 17) — is accepted deliberately: the alternative is a menu item that opens a tab guaranteed to fail, or a second, kind-keyed source of truth for capabilities in the renderer. The reachable path is Connect → right-click, which is already the path for everything else on that connection. |
| **D6** | **`ddl()` on the `Adapter` matches the roadmap signature verbatim** and lives in a new `ddl.ts` inside each adapter folder (`postgres/ddl.ts`, `mariadb/ddl.ts`) — the fixed per-adapter shape §11 mandates (`index.ts`/`client.ts`/`query.ts`/**`ddl.ts`**/`read.ts`). Supported paths: Postgres `database/schema/{table,view,matview}`, MariaDB `database/{table,view}`. A wrong **depth** is `E_NOT_FOUND` (matching `describe()`'s message shape); a **sequence, function or column** node is `E_UNSUPPORTED`. | §11 names `ddl.ts` as part of the adapter shape *before it exists* precisely so that a reviewer knows where MongoDB's will go. The two error codes are the existing closed set and the existing discipline — `read()` already throws `E_NOT_FOUND` for a non-relation path — so this is not a new convention, it is the one in the file. |
| **D7** | **Postgres composes; MariaDB asks the server.** There is no `pg_get_tabledef` — Postgres exposes `pg_get_viewdef`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_expr` and `format_type`, but nothing that renders a whole `CREATE TABLE`, so §5's composer builds one from the catalog. MariaDB has `SHOW CREATE TABLE` / `SHOW CREATE VIEW`, whose output is passed through **verbatim**. `origin` records which happened: `'composed'` or `'server'`. | This asymmetry is a fact about the two servers, not a design choice, and pretending otherwise would mean either reimplementing MariaDB's own formatter (pointless and worse) or shipping Postgres tables with no definition (the deliverable's whole point). Recording it in the model is what lets the view say *"composed from catalog metadata"* instead of implying `pg_dump` fidelity. |
| **D8** | **Postgres emits one statement per object, never inline constraints:** `CREATE TABLE` with columns only, then one `ALTER TABLE … ADD CONSTRAINT` per constraint, then one `CREATE INDEX` per non-constraint-backed index, then `COMMENT ON …` for the relation and each commented column — in that fixed, documented order (§5). | Statement-per-object is what makes `statements: string[]` meaningful rather than decorative: it is the future execution unit, the future per-statement error unit and the future diff unit, and it is what `pg_dump` does for the same reasons. It also means every constraint and index is the **server's own text** (`pg_get_constraintdef` / `pg_get_indexdef`) rather than something we re-render from parts — the fewer fragments we author, the fewer we can author wrongly. |
| **D9** | **The server quotes everything that lands inside an emitted statement.** Postgres: `format('%I', …)` for identifiers, `format('%L', …)` for comment literals, and `format('%s', …)` only for text the server itself already quoted in an earlier column of the same query. MariaDB: the one identifier that must reach `SHOW CREATE …` goes through the existing `quoteIdent`, after the object has been resolved from `information_schema` with bound parameters in the same op. | This is the standing ground rule of every catalog file in the tree ("never interpolate a database identifier into SQL") applied to a phase whose entire output *is* SQL text. `format('%I')` also matches `pg_dump`'s quoting exactly — it quotes only when necessary — so `app."weird""name"` comes out right and `app.orders` does not grow gratuitous quotes. The MariaDB case is the documented exception in Adapter rule 7: the identifier came out of a catalog query in the same op, and `quoteIdent` is the sanctioned tool for it. |
| **D10** | **`notes: string[]` is the whole honesty channel; there is no `complete` boolean.** Every composed Postgres object carries the scope sentence as `notes[0]`; object-specific caveats append. `notes.length > 0` is the only signal the view branches on. | A `complete` flag would be either a constant (`false` for every composed object — dead) or a restatement of `notes.length === 0` (derived — dead). One field, one meaning, always rendered when non-empty. The scope sentence is not boilerplate: triggers, RLS, grants, ownership, storage parameters, tablespaces and non-default collations genuinely are not in the text, and a user who copies a composed definition into a migration needs to know that before they find out. |
| **D11** | **The view is read-only unconditionally, with `data-read-only-reason="ddl-not-editable"`.** The connection's `readOnly` flag is deliberately **not** consulted. | P3's two-reason split existed because §8.6 promised an editable cell editor and one of the two reasons was already real. Here there is exactly one reason and it is permanent for v1 (§1), and a DDL tab never writes anything — so branching on `ConnectionSummary.readOnly` would produce two different labels for the same unchanging truth and imply that the other branch is writable. |
| **D12** | **P4 changes nothing under `src/renderer/editor/`.** The DDL view mounts `CodeMirrorHost` with `language="sql"`, `:sqlDialect` from the connection's `kind`, `:readOnly="true"` and the joined document — no new prop, no `defineExpose`, no theme token, no language. | This is the test of whether P3 D2 put the host in the right place, and it passes. Any pressure to modify the host in P4 (to reach the scroller, to add a fold gutter, to add a copy command) is a signal that a feature has been smuggled in — check it against §8 before touching that folder. |
| **D13** | **The toolbar band gains a `DdlToolbar` with exactly one control: `↻ Refresh`.** No Stop, no copy, no export, no "open in console", no filter row. Refresh re-fetches with `refresh: true`, which rewrites only the `ddl` key of the cache row. | The band cannot stay as it is: today a non-`data` tab renders an `EmptyState` reading *"No connection selected"* (§0 note 8), which is simply wrong text under a DDL tab. Refresh has to exist because the tree's own *Refresh* re-fetches `children` and merges — it does **not** drop the `ddl` payload (§0 note 10, D20), so without this the definition would be uninvalidatable short of a reconnect. **Stop is declined on purpose:** the op id for a control-channel op is generated engine-side in `runOp` (`children` and `describe` behave identically), so a stop button here would mean threading a renderer-generated op id through a third IPC channel — while a working cancel path already exists for exactly this class of op, namely §8.11's per-row Cancel in the operations panel. |
| **D14** | **`openDdlTab(connectionId, path)` mirrors `openDataTab`**: it activates an existing `ddl` tab for the same `(connectionId, path)` if one exists, else creates one and marks it hydrated. The tab keeps the object's own name as its title; it is distinguished from the object's data tab by a `file-code` codicon and a `data-tab-kind` attribute. No `(DDL)` suffix, no `:title` tooltip. | §8.4's identity rule is about `id`, and "open the same table twice" is a *data* affordance — two identical read-only definitions side by side is not something to build a path to. Distinguishing by icon is what §8.1's icon language is for and is what DataGrip does; a title suffix is tab-strip polish and P6 owns the tab strip. |
| **D15** | **`views/ddl/state.ts` holds a `runtime: Record<tabId, DdlViewRuntime>` exactly like `views/grid/state.ts`**, so switching tabs does not refetch. **Scroll position is not preserved across a tab switch and not persisted**, and `DdlTabState` stays `{}`. | The runtime map is the established shape (§0 note 15) and it is what makes a tab switch instant. Scroll is declined because keeping it would mean exposing the `EditorView`'s scroller from P3's shared host (§0 note 18) — a change to infrastructure four future views depend on, for one nicety, in a phase the spec calls "small, independent". It is a one-line addition in whichever later phase actually wants it, and it is listed in §8 so nobody adds it quietly. |
| **D16** | **`opKindSchema` gains `'ddl'`**, `ctx.setRows(statements.length)`, and there is **no migration** because `op_log.kind` is free text (§0 note 11). The operations panel needs no change. | The op log is §8.11's "every DB operation, live" — a definition fetch is a DB operation and hiding it would break the property the tree/cache specs already assert (op counts as the observable proof of cache behaviour). `setRows` follows the existing convention from `adapter.ts` §4c: children → node count, describe → column count, so ddl → statement count. |
| **D17** | **Testing is one new scenario in each DB spec plus one new Playwright spec, and no fixture change.** The DB scenario's core assertion is a **round trip**: execute the emitted statements into a scratch database and `describe()` the copy, then compare it to the original. `tests/ui/ddl.spec.ts` is Postgres-backed and follows `cell-editor.spec.ts`'s conventions. | §9.1 lists DDL as a required scenario and neither spec has one (§0 note 22). Asserting on substrings alone would pass for text that does not execute — and "does this text actually recreate the object" is the only assertion that is worth anything for a composer we wrote ourselves. Doing it in a **separate database** (not a scratch schema) keeps the qualified names in the emitted text valid verbatim, with no string surgery in the test. No fixture change: §0 note 21 verified the seed already has quoted names, a view, a matview, composite PKs and FKs. |
| **D18** | **Sequence and function DDL are declined in P4.** `ddl()` throws `E_UNSUPPORTED` for those node kinds. | §8.10 puts *Open DDL* on the Table/view/collection row only, so a sequence or function definition would be unreachable code with no menu item to invoke it — code written for nobody, which is exactly what §10's "small, independent" is protecting. Postgres would also drag in `pg_get_functiondef` over *overloads sharing one tree path* (the tree encodes a function by name only), which is a genuine design question and not one P4 should answer in passing. |
| **D19** | **A view's definition is the server's own body, with nothing stripped.** Postgres emits `CREATE VIEW <q> AS\n<pg_get_viewdef(oid, true)>` (single trailing `;` removed, §5c); MariaDB passes `SHOW CREATE VIEW`'s text through **including its `DEFINER=` and `SQL SECURITY` clauses**, with a note saying so. | Silently stripping a `DEFINER` clause would mean the app shows a definition that is not the one the server holds and that behaves differently if executed — the worst failure mode a read-only viewer has. Saying so in `notes` costs one sentence and makes the surprise the server's, not ours. |
| **D20** | **A DDL refresh never calls `dropCached`.** It re-fetches and `putCached`s over the `ddl` key only, exactly as `describe(refresh: true)` does. | `metadata_cache`'s unique index is `(connection_id, path)` and all three payloads share one row (§0 note 10), so `dropCached(connectionId, path)` would also throw away that node's cached `children` and `describe` — turning "refresh this definition" into "make the tree re-query this node". `putCached`'s merge already does the right thing inside a transaction. |

---

## 2. Target tree at the end of P4

New and modified files only; everything else from P0–P3 is untouched. **`package.json` is not in this list** (D-note: P4 adds no dependency).

```
src/
  shared/
    domain/
      ddl.ts                                    NEW  SourceText, its Zod schema, ddlText() (D2)
      tabs.ts                                   MOD  TabRecord -> discriminated union; DdlTabState;
                                                     asDataTab(); RENDERABLE_TAB_KINDS += 'ddl' (D4)
      ops.ts                                    MOD  + 'ddl' op kind (D16)
    protocol/
      engine-ops.ts                             MOD  + ENGINE_OP.ddl payload/result schemas
      ipc.ts                                    MOD  + IPC.treeDdl, TreeDdlResult, KiraApi.treeDdl
  engine/
    adapters/
      adapter.ts                                MOD  + ddl() on Adapter; P4's roadmap row retired
      postgres/
        ddl.ts                                  NEW  the composer (§5)
        index.ts                                MOD  + ddl() delegation
      mariadb/
        ddl.ts                                  NEW  SHOW CREATE passthrough (§6)
        index.ts                                MOD  + ddl() delegation
    control.ts                                  MOD  + handleDdl, one handlers[] entry
  main/
    storage/repos/metadata-cache.ts             MOD  MetaKind += 'ddl' (D1)
    tree-service.ts                             MOD  + ddl() cache-aside beside describe()
    ipc/tree.ts                                 MOD  + kira:tree:ddl handler
  preload/index.ts                              MOD  + treeDdl
  renderer/
    bridge/control.ts                           MOD  + treeDdl
    state/tabs.ts                               MOD  openDdlTab, activeDataTab, findDataTab,
                                                     patchDataTabState, duplicateTab branch (D4/D14)
    project/menus.ts                            MOD  + Open DDL in relationMenu (D5)
    views/
      ddl/                                      NEW  (SPEC §11's reserved folder)
        DdlView.vue                                  reconnect gate, notes strip, editor, status line
        DdlToolbar.vue                               one Refresh button (D13)
        state.ts                                     runtime map + load/refresh (D15)
      grid/
        state.ts                                MOD  narrowing only (findDataTab, patchDataTabState)
        DataGrid.vue                            MOD  narrowing only
        DataToolbar.vue                         MOD  narrowing only
        FilterToolbar.vue                       MOD  narrowing only
        FilterHistoryMenu.vue                   MOD  narrowing only
    workbench/panels/
      MainView.vue                              MOD  dispatch DdlView on kind === 'ddl'
      Toolbar.vue                               MOD  DdlToolbar in the tinted band (D13)
      TabStrip.vue                              MOD  file-code icon + data-tab-kind (D14)
tests/
  db/postgres.spec.ts                           MOD  + scenario 20, 'ddl' (D17)
  db/mariadb.spec.ts                            MOD  + scenario 19, 'ddl' (D17)
  ui/ddl.spec.ts                                NEW  §9.2 coverage for the DDL tab
docs/plans/P4-ddl-tabs.md                       (this file)
```

Twenty-eight files, of which five are one-line vocabulary additions and five are pure type narrowing with no behaviour change. The genuinely new code is two adapter files, three view files, and one shared type.

---

## 3. What P4 does not change

Read this before touching anything outside §2's list.

- **`src/renderer/editor/` — nothing at all** (D12). No new prop on `CodeMirrorHost`, no `defineExpose`, no new language, no new syntax token.
- **`src/engine/data.ts`, `src/engine/cache/`, `src/renderer/bridge/data.ts`, `shared/protocol/data-ops.ts`, `shared/protocol/page.ts`.** DDL is not a page and never touches L2/L3 (D1).
- **`src/engine/scheduler/ops.ts`.** `runOp` already does everything the new op needs; the only change anywhere near it is one member of `opKindSchema`.
- **Migrations and `storage/schema/`.** `schema_version` stays 2 (§0 note 11).
- **The grid, its toolbars, its pager, its filter/search toolbars, its caches and prefetch.** The five `views/grid/*` entries in §2 are type narrowing and must contain no behaviour change — if a grid Playwright spec's behaviour changes, the narrowing was done wrong.
- **`views/celleditor/*` and `state/cellSelection.ts`.** A DDL tab publishes no selected cell and the cell-editor panel keeps its P3 empty state under one; §8.6's panel is fed by `data` tabs only (P3 D21), and P4 does not change that.
- **`workbench/StatusBar.vue`, `workbench/state/layout.ts`, `WorkbenchShell.vue`'s grid template, `Splitter.vue`, `VirtualList.vue`, `ContextMenu.vue`, `EmptyState.vue`, `Codicon.vue`.**
- **`OperationsPanel.vue`** — the new op kind renders through the existing free-text column (§0 note 12).
- **`project/state/tree.ts`** — the tree's own refresh, expansion and search are unchanged; `menus.ts` is the only project-panel file P4 touches.
- **`tests/db/fixtures/*` and `scripts/demo-dbs/*`** (§0 note 21, D17).

---

## 4. Shared contracts (Steps 1 and 5 write these; the rest of the plan refers back)

### 4a. `src/shared/domain/ddl.ts` — the model (D2)

```ts
import { z } from 'zod';
import { type NodeKind, nodeKindSchema } from './tree';

/** Where the text came from. 'server' is the engine's own definition, byte for byte. */
export const ddlOriginSchema = z.enum(['server', 'composed']);
export type DdlOrigin = z.infer<typeof ddlOriginSchema>;

export const sourceTextSchema = z.object({
  /** Encoded NodePath of the object — the L1 cache key's second component and the tab's path. */
  path: z.string(),
  kind: nodeKindSchema,
  /** Display form, unquoted, identical to ObjectMeta.qualifiedName: 'app.order_items'. */
  qualifiedName: z.string(),
  /** Ordered, each without a trailing semicolon. Never empty. */
  statements: z.array(z.string()).min(1),
  origin: ddlOriginSchema,
  /** One short sentence per caveat; [] when there is nothing to say (D10). */
  notes: z.array(z.string()),
  /** ISO-8601, stamped by the adapter when the text was produced. */
  generatedAt: z.string(),
});
export type SourceText = z.infer<typeof sourceTextSchema>;

/** The one definition of "the document". Used by the view, and by the DB specs' round trip. */
export function ddlText(source: SourceText): string {
  return source.statements.map((s) => `${s};`).join('\n\n');
}
```

Who reads what, so that no field is decoration:

| Field | Read by, in P4 |
|---|---|
| `path`, `kind` | the view's header icon and label; the cache key is the tab's own path, and this is the assertion that the adapter answered about the object that was asked for |
| `qualifiedName` | the view's header label (`app.order_items`) |
| `statements` | `ddlText()` → the editor document; the status line's `N statements`; the DB specs execute them one by one |
| `origin` | the status line (`server definition` / `composed from catalog metadata`) — and the reason the notes strip exists at all |
| `notes` | the notes strip above the editor, rendered iff non-empty |
| `generatedAt` | the status line, next to `from cache` / `from server` — with no TTL on L1 (§7), the age of the text is the only thing that tells a user whether to press Refresh |

Two rules that are not optional:

- **`statements` carries no trailing semicolons and no blank padding.** `ddlText()` adds exactly one `;` per statement and exactly one blank line between them. Anything else and the round-trip assertion in Step 8 has to start trimming, which is how a formatter's bugs get tested away.
- **`SourceText` is inert data.** It is produced in the engine, validated at the trust boundary in main, cached as JSON, and rendered. Nothing derives behaviour from it except the two `origin`/`notes` branches above.

### 4b. The wire: one engine op, one IPC channel

`src/shared/protocol/engine-ops.ts`:

```ts
export const ENGINE_OP = { …, ddl: 'adapter:ddl' } as const;

engineOpPayloadSchema[ENGINE_OP.ddl] = z.object({ connectionId: z.string(), path: nodePathWireSchema });
engineOpResultSchema[ENGINE_OP.ddl]  = z.object({ ddl: sourceTextSchema });
```

`src/shared/protocol/ipc.ts`:

```ts
export const IPC = { …, treeDdl: 'kira:tree:ddl' } as const;

export interface TreeDdlResult { ddl: SourceText; source: 'cache' | 'server' }

// on KiraApi, beside treeDescribe:
treeDdl(args: { connectionId: string; path: string; refresh?: boolean }): Promise<TreeDdlResult>;
```

`src/main/tree-service.ts` — `ddl()` is `describe()` with three words changed, and that is the point:

```ts
async ddl(connectionId, path, refresh) {
  if (!refresh) {
    const cached = await getCached(db, connectionId, path, 'ddl');
    if (cached !== null) {
      const parsed = sourceTextSchema.safeParse(cached);
      if (parsed.success) return { ddl: parsed.data, source: 'cache' };
      await dropCached(db, connectionId, path);          // a corrupt row is a miss, as elsewhere
    }
  }
  await requireConnected(connectionId);
  const result = await engineHost.call<{ ddl: SourceText }>(ENGINE_OP.ddl, {
    connectionId, path: decodePath(connectionId, path),
  });
  await putCached(db, connectionId, path, 'ddl', result.ddl);
  return { ddl: result.ddl, source: 'server' };
}
```

`refresh: true` skips the read and lets `putCached` merge — it must **not** call `dropCached` (D20).

`src/main/ipc/tree.ts` reuses the existing `treeArgsSchema` verbatim; `preload/index.ts` and `renderer/bridge/control.ts` each gain one line beside `treeDescribe`.

### 4c. The adapter method (D6)

```ts
// on Adapter, between describe() and cancel():
/** The object's definition as executable statements. Gated by caps.ddl; L1-cached by main. */
ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>;
```

Add it to the interface **and** retire P4's row from the roadmap comment at the bottom of `adapter.ts`, leaving P5's and P5.5's rows in place. The engine handler in `control.ts`:

```ts
async function handleDdl(payload: unknown) {
  const { connectionId, path } = engineOpPayloadSchema[ENGINE_OP.ddl].parse(payload);
  const adapter = requireAdapter(connectionId);
  const { value } = await runOp({ connectionId, kind: 'ddl' }, async (ctx) => {
    const ddl = await adapter.ddl(path, ctx);
    ctx.setRows(ddl.statements.length);
    return ddl;
  });
  return { ddl: value };
}
```

Note there is no `caps.ddl` check in the handler: an adapter whose caps say `ddl: false` implements `ddl()` by throwing `E_UNSUPPORTED`, which is one place to look rather than two. The menu (D5) is what stops a user reaching it.

### 4d. `src/renderer/views/ddl/state.ts` — the view runtime (D15)

```ts
export interface DdlViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: string | null;              // the raw IPC message, '[CODE] text' and all (§0 note 13)
  source: 'cache' | 'server' | null;
  ddl: SourceText | null;
}

export const runtime = reactive({} as Record<string, DdlViewRuntime>);

export async function load(tabId: string, opts?: { refresh?: boolean }): Promise<void>;
```

`load` is deliberately simpler than the grid's:

- It resolves the tab through `tabsState`, returns early without a `connectionId`, sets `status: 'loading'`, awaits `control.treeDdl(connectionId, path, opts?.refresh)`, then stores `ddl` + `source` and sets `status: 'idle'`.
- **There is no op-id bookkeeping and no supersession guard.** The only two callers are the view's `onMounted` and the toolbar's Refresh; there is no pager, no filter and no prefetch to race against. Do not copy the grid's `rt.opId !== opId` dance for a shape that cannot produce it.
- **On error it stores the message and nothing else** (§0 note 13). It does **not** parse the `[CODE]` prefix and it does **not** call `unmarkHydrated`: `DdlView.vue`'s reconnect gate is computed from `connectionsState.states[…].status`, which the engine's own `connection:state` event already flips when a connection dies — so the disconnected case corrects itself with no code-sniffing (§0 note 14).
- `runtime` is keyed by tab id and pruned nowhere, matching the grid (§0 note 15). `state/tabs.ts`'s close paths do **not** gain a DDL-specific cleanup call in P4: unlike a page, a `SourceText` is a few KB of plain text and unlike `cellSelection` it is not rendered on behalf of a tab that no longer exists.

### 4e. Test hooks (normative)

Pinned here so Step 6 and Step 8 cannot drift, and so a later phase knows what it must not rename casually.

| Hook | On | Meaning |
|---|---|---|
| `data-testid="ddl-view"` | `DdlView`'s root | Present iff a `ddl` tab is active and past its reconnect gate. |
| `data-path` | same | The tab's encoded path — what a spec awaits to know the view caught up. |
| `data-origin` | same | `server` \| `composed` (D7). |
| `data-source` | same | `cache` \| `server` — L1 observability, asserted in Step 8. |
| `data-read-only-reason` | same | Always `ddl-not-editable` (D11). |
| `data-testid="ddl-reconnect"` | the reconnect panel | §8.4's gate; its button is `data-testid="ddl-reconnect-load"`. |
| `data-testid="ddl-loading"` | the loading bar | Present only while `status === 'loading'`. |
| `data-testid="ddl-error"` | the error strip | The raw message, verbatim. |
| `data-testid="ddl-notes"` | the notes strip | Present iff `notes.length > 0`; one `<li>` per note. |
| `data-testid="ddl-target"` | the header label | `<qualifiedName>` plus the node kind as a small pill. |
| `data-testid="ddl-status"` | the status line | origin · statement count · source · `generatedAt`. |
| `data-testid="ddl-refresh"` | the toolbar button | Calls `load(tabId, { refresh: true })` (D13). |
| `data-tab-kind` | each tab button in `TabStrip.vue` | `data` \| `ddl` (D14). |

The document is read through `[data-testid="ddl-view"] .cm-content` — CodeMirror's own class, stable across its 6.x line, and the same hook `cell-editor.spec.ts` already uses.

### 4f. The seam a later phase fills — specified, not built (D3)

P4 ships none of this. It is written down so that whichever phase eventually revisits §1's "modelled for editing" is additive, and so that nothing here gets re-litigated.

What that phase adds: a mutable buffer beside `DdlViewRuntime.ddl`, a dirty comparison, and an apply path. What P4 guarantees it:

1. **The original is exact, addressable and reproducible.** `runtime[tabId].ddl` is the immutable fetched `SourceText`; the document on screen is `ddlText(ddl)` and nothing else — no beautify, no normalisation, no trailing-whitespace fixups. A dirty check is therefore `buffer !== ddlText(runtime[tabId].ddl)` with no new machinery, which is P3 D6's display-buffer invariant applied to a whole object instead of a cell.
2. **The unit is the statement.** `statements: string[]` is already what a run-all would iterate and what a per-statement error would index into. A later phase does not have to split a blob on semicolons — which cannot be done correctly without a dialect-aware lexer, and which is exactly the trap this shape avoids.
3. **The text's provenance is recorded.** `origin === 'composed'` means the text is Kira's rendering of the catalog, not the server's own definition — so a future "apply my edits" knows that a naive text diff against it is a diff against our formatting choices, and `notes` already enumerates what the text does not express. An editing phase that ignores both would ship a feature that silently drops triggers.
4. **The identity of the target is carried, not re-derived.** `path` + `kind` + `qualifiedName` are the object any later `ALTER` addresses, resolved once, in the engine, by the adapter that knows the dialect.

What P4 deliberately does **not** decide, and leaves whole to that phase: whether editing means executing the buffer or diffing it into `ALTER`s; how a composed definition is applied at all; transaction and rollback semantics; and the read-only-connection interaction. Half of that design, built now against a viewer's needs, would be the wrong half.

---

## 5. Postgres DDL composition (normative)

Implement §5 exactly. `postgres/ddl.ts` exports one function; `index.ts` resolves the client and delegates.

```ts
export async function buildDdl(
  exec: QueryExecutor,          // catalog.ts's executor — cancellable, command-logged
  segments: NodePath['segments'],
  schema: string,
  object: PathSegment,          // kind is table | view | matview
): Promise<SourceText>;
```

Queries run **sequentially**, never `Promise.all` — the same single-`Client` rule `describe()` and `getReadTarget()` already document.

### 5a. Path validation

Depth must be 3 with kinds `database` / `schema` / `{table,view,matview}`.

- Wrong depth, or a first/second segment of the wrong kind → `E_NOT_FOUND`, message shaped like `describe()`'s (`ddl requires a database/schema/table path, got depth N`).
- Third segment is `sequence`, `function` or `column` → `E_UNSUPPORTED`, message naming the kind (D18).
- The relation is resolved with the existing `catalog.getRelationInfo(exec, schema, name)`, which throws `E_NOT_FOUND` for a dropped object and hands back the `oid` and the relation comment.

`qualifiedName` is `` `${schema}.${object.name}` `` — plain and unquoted, identical to `describe()`'s (D9's quoted form is a separate value, produced by query (b) below, and only ever appears inside `statements`).

### 5b. The queries

**(b) Relation shape** — one row, and the source of the server-quoted name every later statement reuses:

```sql
SELECT c.relkind,
       format('%I.%I', n.nspname, c.relname) AS qname,
       pg_get_partkeydef(c.oid)              AS partition_by,
       c.relispartition                      AS is_partition,
       CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS viewdef
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = $1::oid
```

**(c) Columns** — tables only:

```sql
SELECT format('%I', a.attname)                      AS col,
       format_type(a.atttypid, a.atttypmod)         AS type,
       a.attnotnull                                 AS not_null,
       a.attidentity                                AS identity,
       a.attgenerated                               AS generated,
       pg_get_expr(d.adbin, d.adrelid)              AS default_expr
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum
```

**(d) Constraints** — tables only, ordered so a reader sees the key first:

```sql
SELECT format('%I', con.conname) AS name, pg_get_constraintdef(con.oid, true) AS def
FROM pg_constraint con
WHERE con.conrelid = $1::oid AND con.contype IN ('p','u','c','f','x')
ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2
                          WHEN 'x' THEN 3 ELSE 4 END, con.conname
```

The explicit `contype` list is deliberate: it excludes anything a future server version adds to that column rather than emitting a statement built from a `contype` this code has never seen.

**(e) Indexes** — tables and matviews; constraint-backed indexes are excluded because (d) already emitted them:

```sql
SELECT pg_get_indexdef(ix.indexrelid) AS def, i.relname AS name
FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
WHERE ix.indrelid = $1::oid
  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid)
ORDER BY i.relname
```

**(f) Comments** — the relation's, then one per commented column. `$2` is `qname` from (b), already server-quoted, so `%s` splices it verbatim:

```sql
SELECT format('COMMENT ON %s %s IS %L', $3::text, $2::text, obj_description($1::oid, 'pg_class')) AS stmt
WHERE obj_description($1::oid, 'pg_class') IS NOT NULL
```
```sql
SELECT format('COMMENT ON COLUMN %s.%I IS %L', $2::text, a.attname,
              col_description(a.attrelid, a.attnum)) AS stmt
FROM pg_attribute a
WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
  AND col_description(a.attrelid, a.attnum) IS NOT NULL
ORDER BY a.attnum
```

`$3` is `TABLE` / `VIEW` / `MATERIALIZED VIEW`, chosen in TypeScript from the node kind — the one keyword P4 authors, and it is a keyword, not an identifier.

### 5c. Statement assembly

Column line, in this order, all parts optional but the first two:

```
  <col> <type>[ GENERATED ALWAYS AS (<default_expr>) STORED
               | GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY
               | DEFAULT <default_expr>][ NOT NULL]
```

- `generated = 's'` wins and **suppresses** the `DEFAULT` (the generation expression arrives in `default_expr`; emitting both produces a statement Postgres rejects).
- `identity` is `'a'` → `GENERATED ALWAYS AS IDENTITY`, `'d'` → `GENERATED BY DEFAULT AS IDENTITY`, and also suppresses the `DEFAULT` (the sequence default is implicit in the identity clause).
- Otherwise a non-null `default_expr` becomes ` DEFAULT <expr>`, verbatim — `pg_get_expr` already quoted whatever is inside it.

Then, in this fixed order:

| # | `table` | `view` | `matview` |
|---|---|---|---|
| 1 | `CREATE TABLE <qname> (\n<lines joined ",\n">\n)` + ` PARTITION BY <partition_by>` when non-null | `CREATE VIEW <qname> AS\n<viewdef>` | `CREATE MATERIALIZED VIEW <qname> AS\n<viewdef>` |
| 2 | one `ALTER TABLE <qname> ADD CONSTRAINT <name> <def>` per (d) row | — | — |
| 3 | one `<def>` per (e) row, verbatim | — | one `<def>` per (e) row, verbatim |
| 4 | the relation `COMMENT ON …` when there is one | same | same |
| 5 | one `COMMENT ON COLUMN …` per commented column | same | same |

`viewdef` is `pg_get_viewdef(oid, true)` with **exactly one** trailing `;` removed if present (it emits one; `SourceText.statements` carries none) and no other trimming — its internal indentation is the server's and stays (D19).

### 5d. `origin` and `notes`

`origin` is `'composed'` for all three kinds — a view's body is the server's, but the `CREATE …` wrapper is ours, and claiming `'server'` for a statement Postgres never produced would defeat the field.

`notes[0]`, always:

> Composed from catalog metadata: triggers, row-level security policies, grants, ownership, storage parameters, tablespaces and non-default column collations are not included.

Then, conditionally:

- `is_partition` → `This table is a partition of another table; its CREATE TABLE … PARTITION OF form is not reconstructed.`
- `kind === 'matview'` → `A materialized view is created without data; REFRESH MATERIALIZED VIEW populates it.`

### 5e. Cost

Five queries for a table, three for a view. All are `pg_catalog` lookups keyed on one `oid` and all are cancellable through `runQuery` like every other catalog query in the adapter. There is no `LIMIT` and no pagination anywhere in this path: a definition is bounded by the object's own shape, and a 60-column table with a dozen indexes is a few KB.

---

## 6. MariaDB DDL retrieval (normative)

`mariadb/ddl.ts`, same exported shape as §5's.

### 6a. Path validation

Depth must be 2 with kinds `database` / `{table,view}`. Wrong depth → `E_NOT_FOUND`; `sequence`, `function` or `column` → `E_UNSUPPORTED` (D18).

### 6b. Resolve, then ask

```sql
SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
```

- No row → `E_NOT_FOUND`, message naming the object.
- `BASE TABLE` → `SHOW CREATE TABLE <qdb>.<qtable>`; the statement is the row's **`Create Table`** column.
- `VIEW` → `SHOW CREATE VIEW <qdb>.<qtable>`; the statement is the row's **`Create View`** column.
- `SEQUENCE` → `E_UNSUPPORTED` (no menu entry reaches it; D18).

`<qdb>`/`<qtable>` are `quoteIdent(database)` / `quoteIdent(name)` — `SHOW CREATE` takes no placeholder, and the names came out of the `information_schema` lookup above in the same op, which is Adapter rule 7's condition (D9). If the driver returns no row or an empty definition column, throw `E_QUERY` with the object named rather than emitting an empty `statements` array (`sourceTextSchema` requires at least one).

### 6c. Shape

- `statements` is exactly one entry: the server's text with **exactly one** trailing `;` removed if present (MariaDB does not emit one, but do not assume it across versions) and nothing else touched — no re-indentation, no `DEFINER` stripping (D19).
- `origin` is `'server'`.
- `qualifiedName` is `` `${database}.${name}` ``, matching `describe()`.
- `notes`:
  - table → `Triggers and grants are not included in SHOW CREATE TABLE.`
  - view → `This is the server's own SHOW CREATE VIEW text, including its DEFINER and SQL SECURITY clauses.`

One query to resolve, one to fetch. Nothing else.

---

## Step 1 — The shared vocabulary and the wire

**Files:** `src/shared/domain/ddl.ts` (new); `src/shared/domain/ops.ts`, `src/shared/protocol/engine-ops.ts`, `src/shared/protocol/ipc.ts` (mod)

Write §4a verbatim, then add `'ddl'` to `opKindSchema` (leaving its reservation comment for `'mutate'`/`'execute'` intact), `ENGINE_OP.ddl` with its payload/result schemas beside `describe`'s, and `IPC.treeDdl` + `TreeDdlResult` + the `KiraApi.treeDdl` signature beside `treeDescribe`'s.

Nothing is wired yet — this step only makes the vocabulary exist, in one commit, so the diff that follows is about behaviour.

**Acceptance:** `bun run lint && bun run typecheck && bun run build` green. `rg "'ddl'" src/shared` shows the four additions and nothing else. No file outside `src/shared` changed.

---

## Step 2 — Postgres `ddl()`

**Files:** `src/engine/adapters/adapter.ts` (mod), `src/engine/adapters/postgres/ddl.ts` (new), `src/engine/adapters/postgres/index.ts` (mod)

- `adapter.ts`: add the method to the interface per §4c and retire P4's row from the roadmap comment.
- `postgres/ddl.ts`: §5, exactly. Reuse `catalog.getRelationInfo` for the oid; do not add a second oid lookup.
- `postgres/index.ts`: `async ddl(path, ctx)` validates the path shape (§5a), gets the client with `requireClient(databaseSegment.name)`, builds `execFor(client, ctx)` and delegates. It contains no SQL of its own — the same division `describe()`/`read()` already keep.

Two things that are easy to get subtly wrong here:

- **`format('%I')` is not `'"' + name + '"'`.** It quotes only when it has to, which is what makes `app.orders` come out unquoted and `app."weird""name"` come out right. Do not "normalise" it afterwards.
- **Identity and generated columns suppress the `DEFAULT`** (§5c). A table with a `GENERATED ALWAYS AS IDENTITY` column whose emitted DDL also carries `DEFAULT nextval(...)` will not execute, and Step 8's round trip is what catches it.

**Acceptance:** with Colima up, drive it from a scratch script against the fixture container (delete the script before committing — Step 8's spec is the permanent version): `app.wide_table`, `app.order_items`, `app.composite_pk`, `app."weird""name"`, `app.employees`, `app.order_summary`, `app.customer_totals`. Print `ddlText()` for each and read it. Assert by eye: quoting is right on the weird name, the composite PK is one `ADD CONSTRAINT`, the FKs name `app.orders`/`app.products`, the view's body is the server's, no index is emitted twice. Then check `notes[0]` is present on every one of them. `bun run lint && bun run typecheck && bun run test:db` green (the DB suite is unchanged by this step and must stay so).

---

## Step 3 — MariaDB `ddl()`

**Files:** `src/engine/adapters/mariadb/ddl.ts` (new), `src/engine/adapters/mariadb/index.ts` (mod)

§6, exactly. The delegation in `index.ts` mirrors Step 2's.

The one trap: the `mariadb` driver returns `SHOW CREATE …` rows as objects keyed by the server's own column names — `Create Table` and `Create View`, with a space. Read them by that exact string; do not index by position, and do not turn on `rowsAsArray` for this query.

**Acceptance:** the same scratch-script pass against the MariaDB fixture for `wide_table`, `order_items`, `weird\`name`, `Order Items` and `order_summary`. The table text is byte-identical to what `SHOW CREATE TABLE` prints in a `mariadb` client (compare directly); the view text still contains its `DEFINER=`. `bun run lint && bun run typecheck && bun run test:db` green.

---

## Step 4 — The read path, end to end

**Files:** `src/engine/control.ts`, `src/main/storage/repos/metadata-cache.ts`, `src/main/tree-service.ts`, `src/main/ipc/tree.ts`, `src/preload/index.ts`, `src/renderer/bridge/control.ts` (all mod)

- `control.ts`: `handleDdl` per §4c, plus its `handlers` entry.
- `repos/metadata-cache.ts`: `MetaKind` gains `'ddl'`; `CachedPayload` gains `ddl?: unknown`. Nothing else in that file changes — the merge, the 4 MB guard and the drop semantics are already right (D20).
- `tree-service.ts`: `ddl()` per §4b, and the `TreeService` interface gains it.
- `ipc/tree.ts`: one `handle(IPC.treeDdl, …)` reusing `treeArgsSchema`.
- `preload/index.ts`, `bridge/control.ts`: one line each, beside `treeDescribe`.

**Acceptance:** `bun run dev` against `scripts/demo-dbs`' Postgres. From devtools, with a connection connected:

```js
await window.kira.treeDdl({ connectionId: '<id>', path: 'database:kira/schema:public/table:<t>' })
```

returns `{ ddl, source: 'server' }` the first time and `source: 'cache'` the second, with **one** new `ddl` row in the operations panel across both calls; passing `refresh: true` produces a second row and `source: 'server'`. Expand that table's node in the tree afterwards and confirm the expansion is still a **cache** hit — i.e. the DDL write did not disturb the `children` payload sharing its row (D20). Repeat once against the demo MariaDB. `bun run lint && bun run typecheck && bun run build && bun run test:ui` green (the UI suite is unchanged by this step).

---

## Step 5 — The tab model grows a second kind

**Files:** `src/shared/domain/tabs.ts` (mod); `src/renderer/state/tabs.ts` (mod); `src/renderer/views/grid/{state.ts,DataGrid.vue,DataToolbar.vue,FilterToolbar.vue,FilterHistoryMenu.vue}` (mod); `src/renderer/project/menus.ts` (mod)

### 5a. `shared/domain/tabs.ts`

```ts
export const ddlTabStateSchema = z.object({});                 // D4: nothing to remember
export type DdlTabState = z.infer<typeof ddlTabStateSchema>;
export function defaultDdlTabState(): DdlTabState { return {}; }

const tabRecordBase = { id: z.string(), connectionId: z.string().nullable(), path: z.string(),
                        order: z.number().int(), active: z.boolean() };

export const tabRecordSchema = z.discriminatedUnion('kind', [
  z.object({ ...tabRecordBase, kind: z.literal('data'), state: dataTabStateSchema }),
  z.object({ ...tabRecordBase, kind: z.literal('ddl'),  state: ddlTabStateSchema }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
export type DataTabRecord = Extract<TabRecord, { kind: 'data' }>;
export type DdlTabRecord  = Extract<TabRecord, { kind: 'ddl' }>;

export function asDataTab(tab: TabRecord | null | undefined): DataTabRecord | null {
  return tab && tab.kind === 'data' ? tab : null;
}

export const RENDERABLE_TAB_KINDS: readonly TabKind[] = ['data', 'ddl'];
```

`tabKindSchema` keeps all six members — it is the vocabulary of what a tab *can* be, and `RENDERABLE_TAB_KINDS` remains the separate statement of what this build can draw. Update the comment on it from "Only 'data' is renderable in P2 (D18)" to name both kinds and keep the drop-on-restore rule.

`tabTitle` is unchanged (D14). `repos/tabs.ts` needs **no edit at all** — it already parses through `tabRecordSchema` and filters on `RENDERABLE_TAB_KINDS`, so a `ddl` row starts surviving a relaunch the moment the array grows. Verify that claim rather than assuming it.

### 5b. `renderer/state/tabs.ts`

- `openDdlTab(connectionId, path): string` — a copy of `openDataTab`'s reuse-or-create body with `kind: 'ddl'`, `state: defaultDdlTabState()`, no `newTab` option (D14), `hydrated.add(id)`, `saveNow()`.
- `duplicateTab` branches on `source.kind` to build the matching default state.
- `patchTabState` → **`patchDataTabState(id, patch: Partial<DataTabState>)`**, which finds the tab, returns early unless `kind === 'data'`, then assigns as before.
- New: `export const activeDataTab = computed<DataTabRecord | null>(() => asDataTab(activeTab.value))` and `export function findDataTab(id: string): DataTabRecord | null`.
- `activeTab` keeps its current type and its current name — `TabStrip`, `Toolbar`, `MainView` and `WorkbenchShell` all want the union.

### 5c. The narrowing pass

Purely mechanical, no behaviour change anywhere:

| File | Change |
|---|---|
| `views/grid/state.ts` | local `findTab` becomes `findDataTab` from `state/tabs`; `patchTabState` import becomes `patchDataTabState` |
| `views/grid/DataGrid.vue` | local `function tab()` returns `findDataTab(props.tabId)` |
| `views/grid/FilterHistoryMenu.vue` | same |
| `views/grid/DataToolbar.vue` | `const tab = computed(() => activeDataTab.value)` |
| `views/grid/FilterToolbar.vue` | same |
| `project/menus.ts` | `columnMenu`'s projection read uses `findDataTab(tabId)` |

If any of those needs more than a changed import and a changed call, stop: something is reading data-tab state from outside a data-tab branch, and that is a bug this step just uncovered.

**Acceptance:** `bun run lint && bun run typecheck && bun run build && bun run test:ui` green — **the whole UI suite, unchanged**, is the acceptance for this step: `data-view.spec.ts`, `tabs.spec.ts`, `perf.spec.ts` and `mariadb.spec.ts` all exercise the narrowed call sites, and any behaviour change shows up there. Then, from devtools, `openDdlTab(connectionId, path)` adds a tab to the strip (rendering `EmptyState` in the main view, which is expected until Step 6), and it survives a relaunch as a restored tab.

---

## Step 6 — The view

**Files:** `src/renderer/views/ddl/{state.ts,DdlView.vue,DdlToolbar.vue}` (new); `src/renderer/workbench/panels/{MainView.vue,Toolbar.vue,TabStrip.vue}` (mod)

### 6a. `views/ddl/state.ts`

§4d, exactly. Read §4d again before writing it — in particular the two things it says **not** to copy from the grid.

### 6b. `views/ddl/DdlView.vue`

`DataView.vue`'s skeleton with a different body:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ app.order_items  [table]                                                       │  header
├────────────────────────────────────────────────────────────────────────────────┤
│ ⓘ Composed from catalog metadata: triggers, row-level security policies, …     │  notes (v-if)
├────────────────────────────────────────────────────────────────────────────────┤
│  CodeMirrorHost — language "sql", read-only                                     │
├────────────────────────────────────────────────────────────────────────────────┤
│ composed · 7 statements · from cache · generated 2026-08-22 16:40 · read-only   │  status
└────────────────────────────────────────────────────────────────────────────────┘
```

- `props: { tab: DdlTabRecord }`, mounted with `:key="tab.id"` from `MainView` — one instance per tab, like `DataView`.
- **Reconnect gate** (§0 note 14), copied literally: `needsReconnect = !isHydrated(tab.id) || connectionStatus !== 'connected'`; its panel's button connects if needed, `markHydrated`s and calls `load(tab.id)`.
- `onMounted`: `if (!needsReconnect && !runtime[tab.id]) void load(tab.id)`.
- Loading bar and error strip: the same two elements `DataView.vue` uses, with P4's testids. The error strip prints the message verbatim (§0 note 13).
- **Header**: `qualifiedName` + the node kind as a small pill, using the same `.type-pill` treatment `CellEditorView` uses. Truncate with CSS, never JavaScript.
- **Notes strip**: rendered iff `ddl.notes.length > 0`, muted, an `info` codicon and a `<ul>`. Not a dismissible banner, not a colour — this is information, not a warning.
- **Editor**: `<CodeMirrorHost :doc="document" language="sql" :sql-dialect="dialect" :read-only="true" />`, where `document` is `ddl ? ddlText(ddl) : ''` and `dialect` is the connection's `kind` when it is `postgres` or `mariadb`, else `undefined` — the same three-line computed `CellEditorView.vue` already has (D12). The host stays mounted across loads; **never `v-if` it and never `:key` it**, or a Refresh rebuilds the whole editor.
- **Status line**: origin phrase (`server definition` / `composed from catalog metadata`), `N statements`, `from cache` / `from server`, `generated <local time>`, and `read-only`. One line, muted, ellipsised.
- Root attributes: `data-testid="ddl-view"`, `data-path`, `data-origin`, `data-source`, `data-read-only-reason="ddl-not-editable"` (§4e).

### 6c. `views/ddl/DdlToolbar.vue`

One button, `data-testid="ddl-refresh"`, codicon `refresh`, label `Refresh`, disabled while `runtime[tabId]?.status === 'loading'`, calling `load(tabId, { refresh: true })`. Same markup idiom as `DataToolbar`'s own refresh button (D13).

### 6d. Dispatch

- `MainView.vue`: add `<DdlView v-else-if="activeTab && activeTab.kind === 'ddl'" :key="activeTab.id" :tab="activeTab" />` before the `EmptyState`. Keep the `EmptyState` as the final fallback — a restored tab of a kind this build cannot draw never reaches the renderer (`repos/tabs.ts` drops it), but "no tab open" is still a real state.
- `Toolbar.vue`: the tinted `.toolbar-band` is now rendered for `data` **and** `ddl`, with `<DataToolbar/><FilterToolbar/>` inside for the former and `<DdlToolbar :tab-id="activeTab.id" />` for the latter. The `EmptyState` stays for "no tab". Do not move or restyle the band — the tint is §8.12's and landed in `4f940bc`.
- `TabStrip.vue`: `iconFor(tab)` returns `'file-code'` when `tab.kind === 'ddl'`, otherwise its existing path-tail lookup; each tab button gains `:data-tab-kind="tab.kind"` (§4e).

**Acceptance:** `bun run dev` against the demo Postgres. From devtools, `openDdlTab(connectionId, '<table path>')`: the tab appears with a distinct icon, the toolbar band shows Refresh (tinted with the connection colour), and the definition renders with SQL highlighting in the app font. Read it against `psql`'s `\d` for the same table — the columns, PK, FKs and indexes agree. **Refresh** produces exactly one new `ddl` row in the operations panel and the status line flips to `from server`; switching to another tab and back produces **none**. Typing into the editor changes nothing. Disconnect the connection: the view falls back to **Reconnect & load** on its own, and pressing it reconnects and reloads. Repeat once against the demo MariaDB. `bun run lint && bun run typecheck && bun run build && bun run test:ui` green.

---

## Step 7 — Open DDL

**Files:** `src/renderer/project/menus.ts` (mod)

One item in `relationMenu`, after `open-data-new-tab` and before `refresh`:

```ts
{ type: 'item', id: 'open-ddl', label: 'Open DDL', icon: 'file-code',
  run: () => { openDdlTab(row.connectionId, row.path); } },
```

included only when `connectionsState.states[row.connectionId]?.caps?.ddl === true` (D5). Build the array conditionally — do **not** add a `disabled: true` variant; §8.10's item is either offered or absent, and a permanently greyed row teaches a user nothing.

`menuForRow` keeps its current `switch`; `simpleObjectMenu` (sequence, function) and `columnMenu` are untouched (D18).

**Acceptance:** with a connected Postgres connection, right-click a table, a view and a matview: each menu shows **Open DDL** in §8.10's position and opens the tab. Right-click a sequence, a function and a column: no such item. Disconnect and right-click a table whose subtree is still rendered from L1: the item is absent and every other item still works (D5's accepted consequence — confirm it is the only visible difference). Right-clicking the same table twice and pressing Open DDL twice activates one tab, not two (D14). `bun run lint && bun run typecheck && bun run test:ui` green.

---

## Step 8 — Tests

**Files:** `tests/db/postgres.spec.ts`, `tests/db/mariadb.spec.ts` (mod); `tests/ui/ddl.spec.ts` (new)

### 8a. `postgres.spec.ts` — `test('20. ddl', …)`

Follows the file's own conventions: `createAdapter('postgres', deps)`, `makeCtx()`, `path([...])`, no new helper module.

1. **Shape.** `ddl()` on `app.order_items` returns `origin: 'composed'`, `kind: 'table'`, `qualifiedName: 'app.order_items'`, a non-empty `notes`, and `statements[0]` starting `CREATE TABLE app.order_items (`.
2. **Quoting.** `app."weird""name"`'s first statement contains `app."weird""name"` verbatim, and `app.orders`'s does **not** contain a gratuitously quoted `"app"."orders"` (the `format('%I')` behaviour of D9).
3. **Round trip — the assertion that matters.** On a side `Client`: `CREATE DATABASE kira_ddl_roundtrip`; connect to it; `CREATE SCHEMA app`; execute each of `ddl(app.wide_table)`'s statements in order; then point a **second adapter instance** at that database and `describe()` the copy. Assert the copy's `columns` (name, `dataType`, `nullable`, `defaultExpr`, `isPrimaryKey`), `primaryKey`, and the set of `indexes` (name, columns, unique) equal the original's. A second database rather than a scratch schema is what keeps the emitted qualified names valid verbatim, with no string rewriting in the test (D17). Drop the database in a `finally`.
4. **Round trip, quoted name.** The same, for `app."weird""name"` — the case where a quoting bug produces text that parses but names the wrong object.
5. **View.** `app.order_summary` returns one `CREATE VIEW app.order_summary AS` statement whose body contains the source tables, with no trailing `;` inside `statements[0]`.
6. **Matview.** `app.customer_totals` returns `CREATE MATERIALIZED VIEW …` plus the "created without data" note.
7. **Unsupported and not-found.** `ddl()` on `app.invoice_number_seq` and on `app.full_name` rejects with `E_UNSUPPORTED`; on a two-segment path and on a non-existent table it rejects with `E_NOT_FOUND` (D18, §5a).
8. **`ddlText` round trip.** `ddlText(source).split('\n\n').length === source.statements.length` and every line ends its statement with exactly one `;` — the one assertion that keeps §4a's two rules true.

### 8b. `mariadb.spec.ts` — `test('19. ddl', …)`

1. **Passthrough.** `ddl()` on `wide_table` returns `origin: 'server'`, one statement, and text byte-identical to a direct `SHOW CREATE TABLE` issued on a side connection (that is the whole contract — assert equality, not substrings).
2. **Round trip.** `CREATE DATABASE kira_ddl_roundtrip`, `USE` it, execute the statement, `describe()` the copy with a second adapter instance, compare columns/PK/indexes as in 8a.3. Drop in a `finally`.
3. **View.** `order_summary` returns `origin: 'server'`, its text still contains `DEFINER=`, and `notes` says so (D19).
4. **Unsupported and not-found.** `noop_procedure` / `full_name` (both `function` nodes) reject with `E_UNSUPPORTED`; a bad depth and a missing table reject with `E_NOT_FOUND`.

### 8c. `tests/ui/ddl.spec.ts`

Postgres-backed, following `cell-editor.spec.ts`'s conventions exactly (§0 note 23): its own copies of `findRow`/`expandRow`/`openRowMenu`/`getOps`, the Docker skip in `beforeAll`, connection creation through `window.kira.connectionsCreate`, and `expect(consoleErrors).toEqual([])` at the end.

1. **Open from the menu.** Connect, expand to `app`, right-click `order_items`, click `menu-item-open-ddl`. A tab appears with `data-tab-kind="ddl"`, `[data-testid="ddl-view"]` becomes visible with `data-path` equal to the table's path, `data-origin="composed"`, `data-source="server"`, and `.cm-content` contains `CREATE TABLE app.order_items`.
2. **Menu coverage.** The item is present on a table, a view and a matview row and **absent** on `invoice_number_seq`, `full_name` and a column row.
3. **Highlighting is live.** `[data-testid="ddl-view"] .cm-content span` has a non-zero count — the document is tokenised, which is what proves the SQL language extension is attached rather than the text being dumped into a plain editor.
4. **Read-only.** Click into the editor and `page.keyboard.type('DROP TABLE x;')`; the text is unchanged, and `data-read-only-reason` is `ddl-not-editable`.
5. **Notes.** `[data-testid="ddl-notes"]` is visible and mentions triggers (D10).
6. **Cache and ops.** Capture the op count; open the DDL tab for a **second** table, switch back to the first, and assert **no** new `ddl` op (D15's runtime map). Close the first tab and reopen it from the menu: one new op with `source="cache"` and no `ddl` op at all — the L1 hit. Press **Refresh**: exactly one new `ddl` op and `data-source="server"`.
7. **Two tabs, one target.** Open DDL twice for the same table: one tab, activated twice (D14).
8. **Data and DDL side by side.** Open the table's data tab and its DDL tab: two tabs, different icons, switching between them shows the grid and the definition respectively, and the cell-editor panel keeps its empty state while the DDL tab is active (§3's rule that P4 does not feed `cellSelection`).
9. **Session restore.** `relaunch()`: the DDL tab is back, shows `[data-testid="ddl-reconnect"]` and no editor; pressing **Reconnect & load** connects and renders the definition (§8.4).
10. **MariaDB.** Skipped here — §8b covers the second engine, and the renderer path is engine-agnostic by construction. Say so in a comment rather than leaving a reader to wonder.

Screenshot: `ddl-tab.png` (a composed Postgres table definition with its notes strip).

**Acceptance:** `bun run test:db` green with the two new scenarios; `bun run test:ui` green with Colima up; the screenshot lands in `test-results/screenshots/`; `consoleErrors` empty.

---

## 7. Landing the phase

Per SPEC §12, P4 is developed on its own branch started from `feature/kickoff`'s tip and its commits are replayed onto `feature/kickoff` as the final step, once Steps 1–8 are green. Conventional Commits throughout, one commit per numbered step, `feat(p4):` for Steps 1–7 and `test(p4):` for Step 8.

---

## 8. Explicitly out of scope for P4

Do not build, stub, or "prepare" any of these. If a P4 file seems to need one, the design is wrong — say so rather than scaffolding forward.

- **No DDL editing of any kind** (D3): no save, no apply, no dirty flag, no diff, no `ALTER` generation, no draft store, no disabled Save button, no `views/ddl/edit.ts`. §4f is a specification, not a file to create. §1 puts this outside v1.
- **No DDL for sequences, functions, procedures, indexes, schemas, databases or columns** (D18). `E_UNSUPPORTED`, and no menu item.
- **No `Open DDL` anywhere but the tree's relation menu** (D5): not on the tab strip, not on a grid header, not in the menu bar, not on a keyboard shortcut, not on double-click.
- **No other §8.10 menu work.** Grid cell/row/header menus, the document menu, the operations-log row menu and the tab row's remaining items are P6's whole deliverable. P4 adds one item to one existing array.
- **No copy, export, "save to file" or "open in query console"** on the DDL tab. Clipboard is P6's; the console is P5.5's. The editor's own ⌘C is the browser's and that is all.
- **No SQL formatting or re-indentation** of anything the server produced (P3 D11 declined a SQL beautifier and P4 has even less business reformatting a definition).
- **No search, fold gutter, minimap, autocomplete, bracket matching or line-number toggle** in the DDL editor — nothing beyond the extension list `CodeMirrorHost` already has (D12).
- **No scroll persistence** for the DDL editor, and no `defineExpose` on `CodeMirrorHost` (D15).
- **No Stop button** on the DDL toolbar, and no renderer-generated op id on the control channel (D13). Cancelling a hung metadata read is the operations panel's job today, for `children` and `describe` alike.
- **No `describe()` call from the DDL view.** The definition is self-contained; fetching column metadata to decorate it would double the op count for nothing.
- **No second consumer of `cellSelection`**, no publication from the DDL view, no change to the cell-editor panel (P3 D21).
- **No L2/L3 involvement**, no `data:*` port op, no cache-stat change. DDL is L1 and only L1 (D1).
- **No new migration, no new setting, no new persisted state** beyond `tabs` rows of kind `ddl` becoming restorable (D4).
- **No fixture change** (D17) and no change to `scripts/demo-dbs`.
- **No unit tests.** Two suites only, and P4 adds to both.

---

## 9. Risk register

| Risk | Signal | Response |
|---|---|---|
| **The tab-record union ripples further than expected** | `bun run typecheck` lists errors in files not named in Step 5c | Those files are reading data-tab state from outside a `kind === 'data'` branch — a real bug the union just exposed. Fix them by narrowing at the boundary, never by widening `DdlTabState` or by casting. |
| **A restored `ddl` tab is dropped on relaunch** | Step 5's acceptance relaunch loses the tab; a `dropping non-renderable tab kind` warn in the log | `RENDERABLE_TAB_KINDS` was not updated, or `tabRecordSchema`'s discriminated union rejects the stored `{}` state. Both are in Step 5a; verify with the actual log line, not by inspection. |
| **Composed Postgres DDL does not execute** | Step 8's round trip fails on `CREATE TABLE` | Almost always the identity/generated column rule (§5c): a `DEFAULT` emitted alongside `GENERATED … AS IDENTITY` or `… AS (expr) STORED`. Second most likely: a constraint emitted both inline and as an `ALTER` — §5's assembly never inlines one. |
| **An index is emitted twice** | The round trip fails with "relation already exists" on a `CREATE INDEX` | The `NOT EXISTS (… pg_constraint … conindid …)` clause in query (e) is what excludes constraint-backed indexes; a PK's index is not a separate object to recreate. |
| **`format('%I')` output gets "normalised" afterwards** | `app.orders` comes out as `"app"."orders"`, or `app."weird""name"` comes out mangled | D9: the server quotes, we splice. Any `'"' + x + '"'` in `postgres/ddl.ts` is the bug. |
| **A `SHOW CREATE` column is read by position** | MariaDB DDL is `undefined` or is the table *name* instead of its definition | §6b: the columns are `Create Table` / `Create View`, by name, with a space. |
| **A DDL refresh wipes the tree's cached children** | After Refresh on a DDL tab, expanding that table's node re-queries the server | D20: `refresh` must re-fetch and `putCached`, never `dropCached` — the three payloads share one `(connection_id, path)` row. Step 4's acceptance checks exactly this. |
| **The editor is re-created on every load** | Refresh visibly flickers; the DOM under `[data-testid="ddl-view"]` churns; scroll jumps for reasons other than the doc changing | Step 6b: `CodeMirrorHost` is mounted unconditionally and only its `doc` prop changes. A `v-if` or `:key` on it defeats P3 D4's compartment design. |
| **The op log's command shows only the last catalog query** | A `ddl` row's command column reads `SELECT format('COMMENT ON COLUMN …` | Expected, and identical to `describe()`'s behaviour today (§0 note 20). `runQuery` calls `setCommand` per query by design; do not "fix" it in P4 by inventing a multi-statement command field. |
| **`Open DDL` is missing on a disconnected connection** | A user with a cached tree right-clicks a table and sees no DDL item | D5's accepted consequence. Connect, then right-click. Do **not** patch it by inferring caps from `ConnectionKind` in the renderer — that is a second source of truth for capabilities and it will disagree with the engine the first time an adapter's caps change. |
| **The `SourceText` cache row exceeds 4 MB** | A `payload for …:… exceeds 4 MB, not cached` warn, and every open re-queries | Only reachable via a pathological definition. The behaviour is already correct (the read still works, it is just uncached); if it is ever hit for a real object, that is a measurement to bring to P12, not a cap to add in P4. |
| **A view's `DEFINER` clause "helpfully" stripped** | MariaDB view DDL differs from `SHOW CREATE VIEW`'s output | D19. The passthrough is byte-for-byte; §8b asserts equality precisely so this cannot drift. |
| **Vue warnings in the spec** | `consoleErrors` non-empty at the end of `ddl.spec.ts` | Usually `doc` receiving `null` instead of `''` before the first load lands, or a watcher firing after the view unmounts on a tab switch. Both are real bugs; the suite is right to fail. |

---

## 10. Open questions for the human

Both have defaults chosen and implemented in this plan; they are called out because they are the kind of thing worth overruling *before* the code exists.

1. **Postgres table DDL is composed by Kira, and its scope is fixed at columns + constraints + indexes + comments (D7/D8/D10).** Triggers, RLS policies, grants, ownership, storage parameters, tablespaces and non-default collations are stated in `notes` rather than emitted. The alternative is to keep widening the composer until it is a partial `pg_dump` reimplementation — each addition is another catalog query and another way for the round-trip test to be subtly wrong. Default taken: **a bounded, executable core, honestly labelled.** If you want triggers specifically (they are the most commonly missed one, and `pg_get_triggerdef` makes them cheap), say so and they become a sixth query in §5 rather than a note.
2. **`Open DDL` is absent while a connection is disconnected (D5).** Caps are only knowable from a live adapter, and the tree can render a cached subtree without one. The alternative is to show the item always and let the tab land on *Reconnect & load* — friendlier, but it means offering DDL on connection kinds whose adapters will never support it once P8–P10 land. Default taken: **gate strictly on live `caps.ddl`.** Overruling this is a one-line change in Step 7 and does not affect anything else in the phase.

---

## 11. Definition of done for P4

1. `bun install && bun run lint && bun run typecheck && bun run build && bun run test:ui && bun run test:db` is green from a clean clone with Colima running.
2. Right-clicking a table, view or matview on a connected Postgres or MariaDB connection offers **Open DDL**, and it opens a tab showing that object's definition with SQL highlighting, in the app's configured font, in the main view.
3. The definition is **correct**: for both engines, the emitted statements executed into a fresh database reproduce the object, asserted by comparing `describe()` of the copy against the original in `tests/db/*.spec.ts`.
4. Postgres definitions are composed from the catalog with every identifier and literal quoted by the server; MariaDB definitions are `SHOW CREATE`'s own text, byte for byte, `DEFINER` included.
5. `SourceText` is the editable-ready model of §4a — an ordered statement list with its object identity, its provenance and its caveats — and §4f's four guarantees hold. **No editing affordance exists anywhere in the tree**: `rg -i "dirty|stage|apply|save" src/renderer/views/ddl` returns nothing.
6. The DDL text is L1-cached: reopening a definition after closing its tab issues no database operation, and **Refresh** issues exactly one and does not disturb the tree's cached children for the same node.
7. A DDL tab survives a relaunch and comes back as §8.4's **Reconnect & load**, loading nothing until pressed.
8. `TabRecord` is a discriminated union on `kind`, `RENDERABLE_TAB_KINDS` is `['data', 'ddl']`, and the entire pre-existing UI suite passes unchanged — the narrowing pass altered no behaviour.
9. The DDL view is read-only with `data-read-only-reason="ddl-not-editable"`, typing changes nothing, and the notes strip states what a composed definition omits.
10. `git diff --stat b9ef41f -- src/renderer/editor package.json src/main/storage/migrations` is **empty**, and `schema_version` is still 2.
11. Nothing from §8 exists in the tree — in particular no DDL for sequences or functions, no clipboard code, no Stop button, no scroll persistence, no second menu entry point, and no `views/grid/*` behaviour change.
