# P219 plan: terminal and API collections, move-to-collection menu, working-dir folder picker

Base: `776abcbc3` (`docs(v2.2): P219-P222 user fixes`), branch `v22-fix-A`.

## Ask (user's words)

"in the terminal module, the collections are added like in api module. Then for both terminal and
api module add a right click option to choose the collection you want smth in. For the working dir
have a folder select system dialog too."

Three parts:

1. Terminal quick-command collections get created and managed the way API collections are: a real
   collection row you create first (header button, background menu), name inline, rename inline,
   delete from its own menu. Today a terminal collection is only a free-text field typed per script.
2. Right-click "Move to collection" submenu on items in both modules: pick any existing collection,
   a new one, or (terminal only) none.
3. Quick-command working-directory field gets a native folder-select dialog button.

## What exists today (verified on disk)

### Terminal quick commands (both apps, shared code)

- Go: repo-root `internal/quickcommands` (`quickcommands.go`: `CustomScript`, `CustomScriptFields`
  with `Collection string` ('' = ungrouped), `Validate`, `MaxCollectionRunes = 64`; `repo.go`:
  `Repo{DB}` List/Get/Create/Update/Remove, List ordered `collection, sort_order, name`;
  `service.go`: `Service{Repo, Emit}`, every mutation broadcasts the full `[]CustomScript`).
- Each app's `internal/bridge/customscripts.go` is a forwarding shim (`CustomScriptsService`, type
  aliases for args). Both apps' `storage/repos/repos.go` wire `&quickcommands.Repo{DB: db}`.
- Tables: Studio `0024_p85_custom_scripts.sql` + `0031_p187_custom_script_collection.sql` (latest
  Studio migration is v32 `0032_p188_drop_claude_code_settings.sql`); Space
  `0020_p204_custom_scripts.sql` (latest Space migration is v22 `0022_p212_mobile_permissions.sql`).
  `sqlitex.Open` sets `_foreign_keys=1` for both apps (`internal/sqlitex/sqlitex.go:49`).
- TS domain: `packages/shared/domain/scripts.ts` (`customScriptFieldsSchema` with
  `collection: z.string()`).
- Store: `packages/workbench/src/terminal/createCustomScriptsStore.ts` (`CustomScriptsControl`,
  Pinia setup store, `hydrateThenSubscribe` over `customScriptsList` + `onCustomScriptsChanged`).
  Both apps' `frontend/src/bridge/index.ts` implement the control (lines ~346-355 Studio, ~69-77
  Space).
- Seam: `packages/workbench/src/terminal/module.ts` (`TerminalScriptsSeam{records, create, update,
  remove}`, `TerminalModuleContext{defaultCwd, openTerminalTab, host, scripts}`), built per app in
  `apps/kira-studio/frontend/src/workbench/terminalModule.ts` and
  `apps/kira-space/frontend/src/workbench/terminalModule.ts`, provided in each `App.vue`.
- `TerminalPanel.vue`: groups scripts by `script.collection` name (ungrouped first, then
  alphabetical), collapse state `useLocalStorage('kira.quickCommands.collapsed')` keyed by name,
  group header is a plain button (no menu, no rename), row menu Run / Edit… / Remove.
- `QuickCommandsDialog.vue`: Collection is a free-text `Input` + `<datalist>`; Working directory is
  a plain `Input`.

### API collections (Kira Studio only)

- Go: `api_collections` / `api_items` (`collection_id`, self-referencing `parent_id` with
  `ON DELETE CASCADE`). `repos/collections.go`: `CreateCollection`, `CreateItem`, `Rename`,
  `Delete` (re-indexes siblings via `reindexSiblings`), `nextItemOrder`. Bridge
  `internal/bridge/collections.go`: `CreateCollection`, `CreateItem`, `Rename`, `Delete`, each
  emitting `emitApiData(..., treeChange())`. No move operation exists.
- Frontend: `api/state/collections.ts` (TanStack Query tree, `useMutation` per write,
  `createCollection` creates `'New collection'` then sets `renamingKey` for inline naming),
  `api/menus.ts` (`CollectionMenuActions`, `menuForRow`, `backgroundMenu`), `CollectionsTree.vue`
  (wires actions, confirm-delete text "Delete collection "X" and everything inside it?"),
  `CollectionRow.vue` (inline rename `<input>` with focus/select, Enter/Esc/blur, empty or unchanged
  = cancel), `CollectionsPanel.vue` (header: search, `+` New request, `new-folder` New collection,
  Environments). `bridge/apiControl.ts` holds `collections*` calls.
- An open request tab follows a moved item for free: `collectionIdFor(state)` derives the
  collection from the tree (`views/grpcrequest/schemaQuery.ts`, http send path), not from tab state.

### Shared primitives already present

- `packages/workbench/src/state/contextMenu.ts`: `MenuItem` already has `type: 'submenu'` and
  `checked`; `ContextMenu.vue` renders both (DropdownMenuSub, check mark inside submenus).
- Folder picker: `control.filesChooseFolder(title)` in shared `createCoreControl.ts` returns
  `{canceled, path}`; both apps' Go `FilesService.ChooseFolder` exist. UI precedent:
  `apps/kira-space/frontend/src/repo/RepoConfigForm.vue:170-183` (Input + `Button variant="dialog"
  size="kira-lg"` "Choose…").
- `useConfirmDialogStore` lives in `@workbench/state/confirmDialog`, usable from shared terminal code.
- `NativeSelect` in `@theme/components/ui/native-select` (used by settings panes).

## Design

### A. Terminal collections become first-class rows (mirror of `api_collections`)

Data model: new table `custom_script_collections(id, name, sort_order, created_at, updated_at)`;
`custom_scripts.collection` (name text) is replaced by `collection_id TEXT NULL REFERENCES
custom_script_collections(id) ON DELETE CASCADE`. NULL = ungrouped. Empty collections can exist
(the API module's own behaviour: create first, fill later). Rename touches one row.

Migration (same SQL in both apps; Studio `0033_p219_quick_command_collections.sql`, Space
`0023_p219_quick_command_collections.sql`, registered in each `migrations/embed.go`):

```sql
-- P219: quick-command collections become rows (api_collections' shape); scripts reference one by id.
CREATE TABLE custom_script_collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO custom_script_collections (id, name, sort_order, created_at, updated_at)
SELECT lower(hex(randomblob(16))), collection, ROW_NUMBER() OVER (ORDER BY collection) - 1, <now>, <now>
  FROM (SELECT DISTINCT collection FROM custom_scripts WHERE collection <> '');
ALTER TABLE custom_scripts ADD COLUMN collection_id TEXT REFERENCES custom_script_collections(id) ON DELETE CASCADE;
UPDATE custom_scripts
   SET collection_id = (SELECT c.id FROM custom_script_collections c WHERE c.name = custom_scripts.collection)
 WHERE collection <> '';
ALTER TABLE custom_scripts DROP COLUMN collection;
CREATE INDEX custom_scripts_collection ON custom_scripts(collection_id);
```

`<now>`: an `strftime` expression producing the exact `kiratime.FormatISO` shape — read
`internal/kiratime` and match it byte for byte. If the migration number is already taken when
implementing (P220-P222 may run in a parallel stream), take the next free number.

Go, `internal/quickcommands`:

- `quickcommands.go`: add `Collection{ID, Name, SortOrder, CreatedAt, UpdatedAt}` (json camelCase,
  `model.Collection`'s own shape). `CustomScript.Collection string` and
  `CustomScriptFields.Collection string` become `CollectionID *string \`json:"collectionId"\``.
  `Validate` drops the collection-length rule (moves to `validCollectionName`: trimmed, non-empty,
  ≤ `MaxCollectionRunes`). Add `Snapshot{Collections []Collection; Scripts []CustomScript}`.
- `repo.go`: `selectColumns` uses `collection_id`; scan into `sql.NullString`. `List` orders
  `sort_order, name`. Create/Update write `collection_id` and, when non-nil, check the collection
  exists inside the same statement path (`SELECT 1 FROM custom_script_collections WHERE id = ?`;
  missing = `invalid("quickcommands: no such collection")`). New: `ListCollections` (ORDER BY
  `sort_order, name`), `CreateCollection(name)` (`sqlitex.NextSortOrder`, `uuid.NewString()`),
  `RenameCollection(id, name)` (`sqlitex.RequireOneRow`), `DeleteCollection(id)` (FK cascade
  deletes its scripts — API parity), `Move(id string, collectionID *string)` (existence check, then
  `UPDATE custom_scripts SET collection_id = ?, updated_at = ?`; unknown script = wrapped
  `sql.ErrNoRows`).
- `service.go`: `List()` returns `Snapshot`; `broadcast()` emits `Snapshot` (`Emit func(Snapshot)`).
  New args/methods: `CreateCollectionArgs{Name}` → `Collection`, `RenameCollectionArgs{ID, Name}`,
  `DeleteCollectionArgs{ID}`, `MoveArgs{ID, CollectionID *string}`. Same `fail()` mapping, same
  broadcast after every mutation.
- Both apps' `internal/bridge/customscripts.go`: alias the new arg types, add forwarding methods
  `CreateCollection`, `RenameCollection`, `DeleteCollection`, `Move`; `List` returns
  `quickcommands.Snapshot`; `Emit` closure takes `quickcommands.Snapshot`.
- Regenerate Wails bindings in both apps (`wails3 task common:generate:bindings`, per
  `docs/DEV_ENVIRONMENT.md`). Bindings are not committed.

TS:

- `packages/shared/domain/scripts.ts`: `collection: z.string()` → `collectionId: z.string().nullable()`;
  add `scriptCollectionSchema`/`ScriptCollection` (`id, name, sortOrder, createdAt, updatedAt`) and
  `quickCommandsSnapshotSchema`/`QuickCommandsSnapshot{collections, scripts}`.
- `createCustomScriptsStore.ts`: `CustomScriptsControl.customScriptsList(): Promise<QuickCommandsSnapshot>`,
  `onCustomScriptsChanged(cb: (s: QuickCommandsSnapshot) => void)`, plus
  `customScriptsCreateCollection(name)`, `customScriptsRenameCollection(id, name)`,
  `customScriptsDeleteCollection(id)`, `customScriptsMove(id, collectionId | null)`. State gains
  `collections`; `apply` sets both arrays. New actions `createCollection` (returns the row),
  `renameCollection`, `removeCollection`, `moveScript`. Keep the Pinia hydrate+broadcast shape (see
  Deferred decisions).
- Both apps' `frontend/src/bridge/index.ts`: implement the four new control calls over
  `CustomScriptsService.*`; `customScriptsList` trusts `QuickCommandsSnapshot` (default
  `{collections: [], scripts: []}` for a null answer, both arrays `?? []`).
- `module.ts`: `TerminalScriptsSeam` gains `collections(): readonly ScriptCollection[]`,
  `createCollection(name): Promise<ScriptCollection>`, `renameCollection(id, name)`,
  `removeCollection(id)`, `move(id, collectionId | null)`. Both apps' `workbench/terminalModule.ts`
  wire them to the store.

Shared inline rename: extract `CollectionRow.vue`'s inline rename into
`packages/workbench/src/components/InlineRenameInput.vue` (`<script setup lang="ts">`, props
`{ name: string }`, emits `commit: [name]`, `cancel: []`; mounts focused with text selected; Enter
commits, Esc cancels, blur commits; trimmed empty or unchanged = cancel; `@click.stop`/`@dblclick.stop`;
same Tailwind classes; `data-testid` falls through from the caller). `CollectionRow.vue` renders it
under `v-if="renaming"` with `data-testid="collection-rename-input"` and drops its own
draft/inputRef/watch/commitRename/cancelRename.

`TerminalPanel.vue` (the API panel's shape, applied to quick commands):

- Header: keep search and `+` (add quick command); add `TooltipIconButton icon="new-folder"
  label="New collection" data-testid="quick-commands-new-collection"` after `+` (API header order).
  It calls `scripts.createCollection('New collection')` then sets local `renamingId` to the new id
  and makes sure the group is open. Errors go to the existing `removeError` line, renamed
  `actionError` (testid `quick-command-error`; update any spec that reads the old testid).
- Groups built from `scripts.collections()` (order as listed: `sort_order, name`) plus ungrouped
  scripts first with no header, as today. Empty collections render their header (count `0`, twisty
  without children). While a search is active, show a collection only if its name or one of its
  scripts matches.
- Collection header row: `CodiconIcon folder-library` (API collection icon), name, count;
  `data-testid="quick-command-group"` with `:data-id`/`:data-name`; when `renamingId === id` the name
  becomes `<InlineRenameInput data-testid="quick-command-collection-rename-input">` committing to
  `scripts.renameCollection`. Right-click menu: `New quick command` (opens dialog preset to this
  collection), `Rename` (sets `renamingId`), separator, `Delete` (danger; `useConfirmDialogStore`
  text `Delete collection "X" and everything inside it?`, the API's exact wording).
- Collapse state: `useLocalStorage<string[]>('kira.quickCommands.collapsedCollections', [])` keyed
  by collection id (names change on rename now). Default open, as today.
- Background right-click on the list area (empty space, including the empty state): `New quick
  command`, `New collection`. Bind with VueUse `useEventListener` on the scroll container, the API
  tree's own P105 §5.1 pattern.
- Empty state shows only when there are no scripts and no collections.
- `editor` ref becomes `{ script: CustomScript | null; collectionId: string | null } | null`.

`QuickCommandsDialog.vue`: Collection becomes `NativeSelect` (`data-testid="custom-script-collection"`)
with `No collection` ('' sentinel → `null`) plus `scripts.collections()`; initial value from
`script?.collectionId ?? props.collectionId ?? null`. Datalist and `collectionNames` deleted. New
collections are created from the panel (API parity), not typed in the dialog. Payload sends
`collectionId`.

### B. "Move to collection" submenu, both modules

Shared builder `packages/workbench/src/util/collectionMenu.ts`:

```ts
export interface CollectionChoice { id: string; name: string }
export function moveToCollectionMenu(opts: {
  collections: readonly CollectionChoice[];
  current: string | null;
  allowNone: boolean;
  canMoveTo?: (id: string | null) => boolean; // default: id !== current
  onMove(id: string | null): void | Promise<void>;
  onNew(): void | Promise<void>;
}): MenuItem
```

Returns `{ type: 'submenu', id: 'move-to-collection', label: 'Move to collection', icon:
'folder-library', items }`. Items: `No collection` (`id: 'move-to-none'`, only when `allowNone`),
one item per collection (`id: 'move-to-<id>'`, `checked` when current, disabled when
`!canMoveTo(id)`), separator, `New collection` (`id: 'move-to-new'`, icon `new-folder`). With zero
collections the list is just `No collection` (if allowed) and `New collection`.

Terminal (`TerminalPanel.vue` script row menu): Run, Edit…, `moveToCollectionMenu({ allowNone: true,
current: script.collectionId, onMove: (id) => scripts.move(script.id, id), onNew })`, separator,
Remove. `onNew`: `createCollection('New collection')` → `move(script.id, new.id)` → `renamingId =
new.id`, group open. Errors to `actionError`.

API, Go:

- `repos/collections.go`: `MoveItem(itemID, collectionID string) error` in one transaction: read the
  item's `collection_id`/`parent_id` (missing = `no item` error, Delete's wording); verify the target
  collection exists; no-op when already at that collection's root; claim
  `nextItemOrder(tx, collectionID, nil)`; rewrite `collection_id`/`updated_at` for the whole subtree
  with a recursive CTE (`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT i.id FROM api_items i
  JOIN sub ON i.parent_id = sub.id) UPDATE api_items SET collection_id = ?, updated_at = ? WHERE id
  IN (SELECT id FROM sub)`); set the moved item's `parent_id = NULL` and its new `sort_order`;
  `reindexSiblings(tx, oldCollection, oldParent)`; commit.
- `bridge/collections.go`: `CollectionsMoveItemArgs{ItemID, CollectionID}` + `MoveItem`
  (BadRequest on empty ids, `InternalErr` otherwise, `emitApiData(..., treeChange())`).
- `repos/collections_test.go`: one test — folder with a nested request two levels deep moves to
  another collection; every subtree row carries the new `collection_id`, the folder lands at the
  target root at the next `sort_order`, old siblings re-index dense; unknown target collection
  refused. Passes the CLAUDE.md bar (recursive subtree rewrite plus two-sided re-index).

API, frontend:

- `bridge/apiControl.ts`: `collectionsMoveItem(itemId, collectionId)`.
- `api/state/collections.ts`: `moveRowMutation` (`mutationKey: ['apiCollectionsTree', 'moveItem']`,
  `onSuccess: afterTreeListChange`); `moveRow(row, collectionId)` (expands the target collection,
  selects the moved row, `state.error` on failure, same try/catch shape as `renameRow`);
  `moveRowToNewCollection(row)` (create `'New collection'` → move → expand → `renamingKey` on the new
  collection).
- `api/menus.ts`: `CollectionMenuActions` gains `collections(): readonly CollectionChoice[]`,
  `moveTo(row, collectionId)`, `moveToNewCollection(row)`. Request and folder rows get the submenu
  (`allowNone: false`, `current: row.collectionId`, `canMoveTo: (id) => !(id === row.collectionId &&
  row.parentId === null)`), placed after Duplicate/Copy URL, before the Delete separator. Collection
  rows get none.
- `CollectionsTree.vue`: wire the three actions.

### C. Working-directory folder picker

- `module.ts`: `TerminalModuleContext.chooseFolder(title: string): Promise<string | null>` (null =
  cancelled).
- Both apps' `workbench/terminalModule.ts`: `chooseFolder: async (title) => { const r = await
  control.filesChooseFolder(title); return r.canceled ? null : r.path; }` (import `control` from
  `../bridge/control`, as `state/datagripImport.ts` / `state/coderepos.ts` already do).
- `QuickCommandsDialog.vue`: new prop `chooseFolder: (title: string) => Promise<string | null>`
  (passed by `TerminalPanel.vue` from `ctx.chooseFolder`, keeping the dialog props-only like
  `scripts`). Working directory row = `RepoConfigForm.vue`'s layout: `flex items-center gap-1.5`,
  the existing `Input` (`flex-1`), `Button variant="dialog" size="kira-lg"
  data-testid="custom-script-workingdir-choose"` "Choose…". Picker title `Working directory…`. A
  chosen path replaces `workingDir`; a rejection lands in the dialog's existing `error`.

## Files

Kira Studio: `internal/storage/migrations/0033_p219_quick_command_collections.sql`,
`internal/storage/migrations/embed.go`, `internal/storage/migrations/migrate_quick_command_collections_test.go`
(new), `internal/bridge/customscripts.go`, `internal/bridge/collections.go`,
`internal/storage/repos/collections.go`, `internal/storage/repos/collections_test.go`,
`frontend/src/bridge/index.ts`, `frontend/src/bridge/apiControl.ts`,
`frontend/src/workbench/terminalModule.ts`, `frontend/src/api/{CollectionRow.vue, CollectionsTree.vue,
menus.ts, state/collections.ts}`, `tests/ui/support/mockRuntime.ts`, `tests/ui/support/ipcChannels.ts`
(if it lists bound calls), `tests/ui/terminal-module.spec.ts`, `tests/ui/collections.spec.ts`,
`tests/visual/terminal-module.spec.ts-snapshots/quick-commands-dialog-visual-linux.png`.

Kira Space: `internal/storage/migrations/0023_p219_quick_command_collections.sql`,
`internal/storage/migrations/embed.go`, `internal/bridge/customscripts.go`,
`frontend/src/bridge/index.ts`, `frontend/src/workbench/terminalModule.ts`,
`tests/ui/support/mockRuntime.ts`, `tests/ui/support/bootSnapshots.ts`,
`tests/ui/terminal-quick-commands.spec.ts`.

Shared: `internal/quickcommands/{quickcommands.go, repo.go, service.go}`,
`packages/shared/domain/scripts.ts`, `packages/workbench/src/terminal/{module.ts,
createCustomScriptsStore.ts, TerminalPanel.vue, QuickCommandsDialog.vue}`,
`packages/workbench/src/components/InlineRenameInput.vue` (new),
`packages/workbench/src/util/collectionMenu.ts` (new).

Docs: `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md` (P219 status).

## Tests

- Go: migration test (Studio, existing `migrate_*_test.go` pattern): scripts with names `''`,
  `Backend`, `Backend`, `Web` → two collection rows, matching `collection_id`s, `''` → NULL,
  `collection` column gone. Space runs the same SQL; no second copy of the test. API `MoveItem` repo
  test (above). No quickcommands repo/service unit tests (CRUD, below the bar).
- No new TS unit tests (menu builder and store are thin).
- Playwright, Studio `terminal-module.spec.ts`: update fixtures (`collectionId: null`; every
  `customScriptsList` mock answers `{ collections, scripts }`); rewrite "group under collapsible
  collections" around collection rows (empty collection shows, ids in testids); rewrite "dialog adds
  into a collection" for the select; new: header New collection → inline rename → Enter sends
  `RenameCollection`; collection menu Delete confirms and sends `DeleteCollection`; script menu Move
  to collection → existing / No collection / New collection send the right calls; Choose… fills the
  working dir from a mocked `filesChooseFolder` and a cancelled pick leaves it unchanged.
- Playwright, Space `terminal-quick-commands.spec.ts`: fixture/boot snapshot shape updates; one test
  that Choose… fills the working dir (Space wires its own `terminalModule.ts`).
- Playwright, Studio `collections.spec.ts`: one test — request row Move to collection sends
  `MoveItem` with the target id; New collection creates then moves and opens the rename input.
- Visual: `quick-commands-dialog` baseline changes (select + Choose…). Regenerate per
  `apps/kira-studio/tests/visual/README.md`.
- Both apps' `mockRuntime.ts` CHANNEL_TO_FQN gains the new bound calls
  (`CustomScriptsService.CreateCollection/RenameCollection/DeleteCollection/Move`,
  `CollectionsService.MoveItem`); default boot answer for `customScriptsList` becomes
  `{"collections":[],"scripts":[]}`.
- Run the Playwright suites once, near phase end; fixes land as follow-up commits.

## Commits

1. `refactor(workbench): extract InlineRenameInput from the API collection row` — new component,
   `CollectionRow.vue` adopts it.
2. `feat(terminal): quick-command collections as rows, managed like API collections` — migrations,
   `internal/quickcommands`, both bridges, domain, store, seam, both `terminalModule.ts`, panel,
   dialog select, migration test, affected spec/mocks updates.
3. `feat: move to collection from the context menu in terminal and API` — `collectionMenu.ts`,
   terminal Move (Go + TS), API `MoveItem` (Go + TS) + repo test, specs.
4. `feat(terminal): folder picker for a quick command's working directory` — seam, both apps,
   dialog, specs, visual baseline.
5. `docs: P219 quick-command collections, move menu, folder picker` — ARCHITECTURE + SPEC status.
6. Follow-up `fix:`/`test:` commits from the end-of-phase Playwright run, if any.

## Verification (orchestrator)

- `grep -rn "collection: z.string()\|datalist" packages/shared/domain/scripts.ts packages/workbench/src/terminal` → none.
- `grep -rln "InlineRenameInput" apps packages --include=*.vue` → `CollectionRow.vue` and `TerminalPanel.vue`.
- `grep -rn "moveToCollectionMenu(" apps packages --include=*.ts --include=*.vue` → callers in
  `api/menus.ts` and `TerminalPanel.vue`.
- `grep -n "chooseFolder" apps/*/frontend/src/workbench/terminalModule.ts` → both apps.
- `grep -n "func (s \*CollectionsService) MoveItem\|func (r \*CollectionsRepo) MoveItem" -r apps/kira-studio/internal` → both.
- `grep -n "CreateCollection\|RenameCollection\|DeleteCollection\|Move" apps/*/internal/bridge/customscripts.go` → both apps.
- `grep -n "p219" apps/*/internal/storage/migrations/embed.go` → both apps.
- `go test ./internal/quickcommands/... ./apps/kira-studio/internal/storage/... ./apps/kira-space/internal/storage/...`; `go build ./...` in both apps; both frontends typecheck, lint, build.
- Playwright results for the four specs above, green, in the implementer's report.

## Docs

`docs/ARCHITECTURE.md`: schema block (`custom_scripts` now `collection_id`; new
`custom_script_collections`), migration list (Studio 0033, Space 0023), table-write table row, the
"Quick commands exist in both apps" paragraph (collections are rows created from the panel header
or background menu, named and renamed inline via shared `InlineRenameInput`, deleted with their
commands; dialog selects a collection; Move to collection submenu; Choose… folder picker via
`TerminalModuleContext.chooseFolder`; drop "Collections have no rename/delete UI"), the seam list
(`TerminalScriptsSeam` additions, `chooseFolder`), and the API collections section (Move to
collection, `MoveItem` moves a subtree to the target root). SPEC P219 row → Done.

## Deferred decisions (defaults chosen)

1. Terminal collections are a real table with ids, not free-text names: needed for empty
   collections created first (API behaviour) and for rename touching one row.
2. Deleting a terminal collection deletes its quick commands (API parity, same confirm wording).
   Alternative: ungroup them instead. Ask the user if parity is wrong here.
3. API move target is a collection's root only (the user said "collection"); no "none" in API, since
   every API item must belong to a collection. Folders move with their whole subtree.
4. The dialog's collection field is a select of existing collections; new collections come from the
   panel (API parity), not typed in the dialog.
5. Collections order by creation (`sort_order`), as in API, not alphabetically as before.
6. Collapse state re-keyed by id under a new local-storage key; the old name-keyed key is abandoned
   (per-viewer convenience only). Groups stay open by default, as today.
7. The quick-command store stays Pinia hydrate+broadcast, not TanStack Query: Go pushes the full
   snapshot after every mutation to every window (P204's design), so there is no fetch-with-loading
   cache for Query to own; adding one would duplicate that push path.
8. Migration ids for converted collections are `lower(hex(randomblob(16)))`, not UUID-formatted;
   ids are opaque everywhere they are read.
9. No drag-and-drop move; the context menu is the only move path (the ask).
10. Move to collection lives only on item rows (terminal script, API request/folder), not on
    collection rows.
