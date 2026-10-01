# P140 — `ade` repo tabs drag-reorder; `useDragReorder` consumers onto `vue-draggable-plus`: plan

Plan for `docs/v2.0/SPEC.md`'s **P140** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `a2d9e2c6`. Every line number below is at that commit.

**Discovery method, disclosed.** The `codegraph` MCP server is configured (`.mcp.json`) but its tools
were not surfaced in this session, and no index existed. `scripts/codegraph-setup.sh` built one,
then 8 `codegraph_explore` calls ran through the same server over stdio (JSON-RPC
`tools/call name=codegraph_explore`), each before any `Read`/`rg` of what it covered: ade repo
storage and `List`; `CodeReposRepo` `List/Create/Remove/sort_order`; existing `Reorder` patterns
(`ConnectionsRepo`, `VariablesRepo`, `useDragReorder`); `CodeWorkspaceService` and
`useCodeReposStore`; `useAdeTabStripHost`/`TabStripHost`/`moveTab`/`TabStrip` drag/`GitPanel`;
Space control bindings; `useDragReorder` consumers; `codeReposStore.records` consumers. `Read`/`rg`
then pinned templates, test locators and harness details.

---

## 0. Open points and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Where repo order lives | **Existing `code_repos.sort_order` column. No migration.** `0001_init.sql:56-63` already has `sort_order INTEGER NOT NULL`; `CodeReposRepo.List` orders by `sort_order ASC, name ASC` (`coderepos.go:27-33`); `Create` appends via `sqlitex.NextSortOrder` (`:59-63`). Only a write path is missing. A separate order table would duplicate a column that already means exactly this. | §3.1 |
| Reorder write shape | Full-list rewrite, `ConnectionsRepo.Reorder`'s own shape (Studio `connections.go:412-429`): caller sends ids in new order, one transaction rewrites `sort_order` dense, returns `List()`. Plus two rules Studio's version lacks (§3.1): unknown ids skipped, existing rows missing from `ids` appended in current order. | §3.1 |
| New repo | `Create`'s `NextSortOrder` gives `max+1`: lands last, in ade and Git panel. Unchanged. | §3.1 |
| Removed repo | `Remove` deletes the row; the gap in `sort_order` is harmless (`List` sorts, nothing reads the number as a position). The next reorder re-densifies. Unchanged. | §3.1 |
| How Git panel reads it | Same store, same array: `GitPanel.vue:111-116` `filteredRepos` filters `codeReposStore.records` in order. A reorder that reassigns `records` shows in Git panel immediately in the same window, and after reload in any window. No Git panel edit. | §3.3 |
| Worktree anchor side effect | `RepoWorktreeLinks` (`codeworkspace.go:188-256`) picks a worktree group's anchor as the main worktree, else smallest `(sortOrder, createdAt, id)`. Reordering two imported linked worktrees with no main worktree imported can change which one the Git panel nests the other under. Correct by that rule; `repoLinks.ts:39-46` refreshes on `records` reassign. Disclosed in result. | §3.3 |
| Other windows | No `code_repos` change event exists in Space; import/rename/remove do not sync live across windows either. A reorder in one window shows in another after reload. Same as today's rename. Not added here (cross-window repo-list sync is its own concern for every mutation, not reorder alone). Disclosed. | §10 |
| Frontend error path | Optimistic `records` reorder; on rejection, re-hydrate from Go (snap back to persisted truth) and rethrow. ade adapter catches and sets `adeActionsStore.actionError` on the dragged repo (the existing ade background-failure surface, `adeActions.ts:45-49`, rendered by `AdeRepoView.vue:468`). | §3.3, §3.4 |
| ade wiring | `useAdeTabStripHost.ts` gains `tabs.moveTab`. `TabStrip.vue` creates its Sortable only when `moveTab` exists (`TabStrip.vue:209-210`), so supplying it is the whole switch. Pinned "All agents" sits outside the sortable row. | §3.4 |
| Shared drag helper | **New `packages/workbench/src/util/useSortableReorder.ts`**: P137's bound-id-mirror pattern, once. Four sites need it (TabStrip, ColumnsMenu, EnvironmentsView, VariableSetView). Copying the ~25-line block four times is what `useDragReorder` was created to stop (its own `P107 T2-20` comment), and `.jscpd.json` would flag it. `TabStrip.vue` moves onto it too, behaviour identical. | §3.2 |
| Handle vs whole row | `EnvironmentsView`/`VariableSetView` rows hold text inputs and a radio; a whole-row Sortable would start drags from inside them. Both get `handle` = their existing grip (`environment-grip`, `variable-grip`). `ColumnsMenu` rows hold only a checkbox and a name: whole row, as today. Existing `http-variables.spec.ts:390-392` already drags by `variable-grip`. Disclosed: env rows no longer drag from outside the grip. | §3.5 |
| Filtered lists | Today `canReorder: () => !isFiltered`. Becomes the helper's `disabled` getter, applied through Sortable's `disabled` option. Keyboard `Alt+Arrow` (`onMove`) untouched. | §3.5 |
| Reseed guard | `syncDrafts` skips reseeding `order` while `dragIndex !== null` (`EnvironmentsView.vue:104`, `VariableSetView.vue:217`). Becomes `!dragging.value`, the helper's `onStart`/`onEnd` flag. | §3.5 |
| Popover drag clone | `ColumnsMenu` renders inside reka `PopoverContent` (portalled layer). `fallbackOnBody: false` there, so the clone stays inside the popover's own DOM and never lands outside its dismissable layer. Other sites keep `true` (P137's reason: escape the row's overflow clip). | §3.5 |
| Library rule | No new dependency: `vue-draggable-plus` (MIT, root `package.json`) already drives `TabStrip`, `useTimelineDrag`. No new Pinia store, no `<style>`, `<script setup lang="ts">` throughout. `useCodeReposStore` stays a plain Pinia store (not moved to TanStack Query): migrating its read path is outside this row. | §3 |
| Unit tests | One Go storage test for `CodeReposRepo.Reorder`: it has interacting rules (dense rewrite, unknown-skip, missing-append) and is the only proof order survives a restart, since UI mocks are static. No TS unit test: `moveId` is a two-line splice already exercised by every drag spec. | §6 |
| Split into streams | **No.** (a) and (b) both depend on `useSortableReorder.ts`, and `TabStrip.vue` (part of (a)'s path) moves onto it. Shared file plus ordering dependency. One sequential implementer. | §2 |

## 1. Confirmed current state

**Go, Kira Space**
- `apps/kira-space/internal/storage/migrations/0001_init.sql:56-64` `code_repos` (`sort_order INTEGER NOT NULL`), unique index on `repo_id`.
- `apps/kira-space/internal/storage/repos/coderepos.go`: `codeReposSelectColumns` `:11`; `List` `:27-33`; `Get` `:37`; `Create` `:55-71` (`NextSortOrder`); `Rename` `:74`; `Remove` `:95-100`. No reorder.
- `internal/sqlitex/query.go:66-76` `NextSortOrder`.
- `apps/kira-space/internal/bridge/codeworkspace.go`: args types `:37-48`; `ListRepos` `:88-90` (its comment already says "oldest-imported-first until a user reorders it"); `RepoWorktreeLinks` `:177-259`; `ImportRepo` `:265-299`; `RenameRepo` `:301-309`; `RemoveRepo` `:314-323`.
- Storage test harness precedent: `repos/gitreposettings_test.go:10-18` (`storage.OpenAt(t.TempDir())`).
- Reorder precedent: Studio `storage/repos/connections.go:412-429`, `variables.go:700-718`, bridge `variables.go:200-209`.

**Frontend, Kira Space**
- `frontend/src/bridge/index.ts:159-178` `codeWorkspace*` wrappers over `@bindings/codeworkspaceservice.js` (generated, not committed; regenerate per `docs/DEV_ENVIRONMENT.md:282-296`, `-names` load-bearing).
- `frontend/src/state/coderepos.ts`: `hydrateCodeRepos` `:26-28`; `importRepoViaDialog` `:32-38`; `renameCodeRepo` `:40-44`; `removeCodeRepo` `:51-55`; return `:92-`.
- `frontend/src/ade/useAdeTabStripHost.ts:1-56`: no `moveTab`; header comment `:6-8` says "no reorder path".
- `packages/workbench/src/components/TabStrip.vue:197-229`: id mirror `rowIds`, `useDraggable` only `if (moveTab)`, `onUpdate` maps `old/newDraggableIndex` to ids, calls `moveTab(from, to)`.
- `records` watchers (fire on reassign, not on in-place mutation): `repo/state/repoHeads.ts:47-54` (refresh heads), `repo/state/repoLinks.ts:39-46` (refresh worktree links), `repo/state/worktrees.ts:168-174`, `ade/AdeView.vue:28-35`.
- `GitPanel.vue:111-116` `filteredRepos`; repo rows `data-testid="repo-row"` `:402`.
- Tests: `tests/ui/support/ipcChannels.ts:66-71`, `support/mockRuntime.ts:48-53` (channel to FQN), `:161-167` (boot defaults); `tests/ui/ade-module.spec.ts:438-478` P137 test ending in a drag that asserts **no** reorder (`:469-477`).

**Frontend, Kira Studio (`useDragReorder` consumers)**
- `packages/workbench/src/util/useDragReorder.ts:1-53`.
- `apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue`: `useDragReorder(order)` `:74`; persistence in `onBeforeUnmount` `:80-99`; `Label` row `:113-122` (`draggable="true"`, `@dragstart/over/end`, `opacity-50` when `dragIndex === index`); grip span `:123` (no test id).
- `apps/kira-studio/frontend/src/api/EnvironmentsView.vue`: `useDragReorder` `:78-81`; `syncDrafts` guard `:104`; `isFiltered` `:119`; `onMove`/`onKeydown` `:173-192`; delegated listeners `:198-221` (`dragstart`/`dragover`/`dragend` plus `keydown`); row `:275-282` (`:draggable="!isFiltered"`, `opacity-50`); grips `:290-300`.
- `apps/kira-studio/frontend/src/api/VariableSetView.vue`: `useDragReorder` `:192-196`; guard `:217`; `isFiltered` `:243`; `onMove` `:404-413`; list container `listRef` `:521-526` (`data-testid="variables-list"`, also holds alerts and a header grid); `VariableRow` loop `:617-639` (`:index`, `:dragging`, `@dragstart/over/end`).
- `apps/kira-studio/frontend/src/api/VariableRow.vue`: props `index`, `dragging` `:29-32`; emits `dragstart/dragover/dragend` `:47-49`; listeners `:125-130`; root `:142-148` (`:draggable="!trailing && !filtered"`, trailing row has `data-id=""`); grips `:149-165`.
- Existing drag coverage: only `apps/kira-studio/tests/ui/http-variables.spec.ts:346-408` (`dragTo` on `variable-grip`, asserts one `IPC.variablesReorder` with `ids: ['v3','v1','v2']`). No drag coverage for environments or columns. `tooltips.spec.ts:193` locates `.columns-menu-item.is-pk` (class must stay).
- IPC: `IPC.variablesReorderEnvironments`, `IPC.variablesReorder` (`apps/kira-studio/tests/ui/support/ipcChannels.ts:110,114`).

## 2. Split

None. One implementer, one worktree, commits in §8 order. Reason in §0.

## 3. Design

### 3.1 Go: `CodeReposRepo.Reorder` and `CodeWorkspaceService.ReorderRepos`

`coderepos.go`, after `Rename`:

```go
// Reorder rewrites sort_order dense in the order ids gives, in one transaction. An id with no row
// (removed in another window) is skipped; a row ids omits (imported in another window) keeps its
// relative order after the listed ones. Returns List().
func (r *CodeReposRepo) Reorder(ids []string) ([]model.CodeRepo, error)
```

- `tx := r.DB.Begin()`, `defer tx.Rollback()`.
- Read current ids in tx: `SELECT id FROM code_repos ORDER BY sort_order ASC, name ASC`.
- Final order = `ids` filtered to existing, then existing ids not in `ids`, in current order.
- `UPDATE code_repos SET sort_order = ? WHERE id = ?` per final index. Commit. Return `r.List()`.
- Error wrapping: `repos: reorder code repos: %w`, matching this file's prefix.

`codeworkspace.go`:

```go
type CodeWorkspaceReorderArgs struct {
	IDs []string `json:"ids"`
}

// ReorderRepos persists a user's drag order (ade repo tabs) — the same list ListRepos and the
// Git panel read.
func (s *CodeWorkspaceService) ReorderRepos(args CodeWorkspaceReorderArgs) ([]model.CodeRepo, error)
```

- `len(args.IDs) == 0`: `ipcerr.BadRequest("ids is required")`. Duplicate id:
  `ipcerr.BadRequest("ids must be unique")`. Else `ipcerr.InternalResult(s.Deps.Repos.CodeRepos.Reorder(args.IDs))`.
- Fix `ListRepos`' comment (`:85-87`): order is `sort_order`, set by `ReorderRepos`.
- No migration, no model change (`model.CodeRepo.SortOrder` and `RepoSummary.sortOrder` exist).

Regenerate bindings (`wails3 task common:generate:bindings`) after this commit; `@bindings/codeworkspaceservice.js` then exports `ReorderRepos`.

### 3.2 Shared helper: `packages/workbench/src/util/useSortableReorder.ts`

```ts
/** Moves fromId to toId's pre-splice index — createTabsStore.moveTab's own rule, so a drop onto a
 *  later item lands after it and onto an earlier one lands before it. */
export function moveId(ids: readonly string[], fromId: string, toId: string): string[];

export interface SortableReorderOptions {
  /** Sortable `draggable` selector for items. */
  draggable: string;
  handle?: string;
  /** Presses here never start a drag; their click still fires. */
  filter?: string;
  direction?: 'horizontal' | 'vertical';
  /** Default true. */
  fallbackOnBody?: boolean;
  disabled?: () => boolean;
}

/** P137's TabStrip pattern, shared: vue-draggable-plus in forceFallback mode bound to an id mirror
 *  (the library reverts its own DOM move only when a list is bound), one onMove per drop. */
export function useSortableReorder(
  container: Ref<HTMLElement | null>,
  ids: () => readonly string[],
  onMove: (fromId: string, toId: string) => void,
  options: SortableReorderOptions,
): { dragging: Readonly<Ref<boolean>> };
```

Body is `TabStrip.vue:197-229` generalised:

- `rowIds = shallowRef<string[]>()`, `watch(ids, (v) => rowIds.value = [...v], { immediate: true })`.
- `useDraggable(container, rowIds, { draggable, handle, filter, preventOnFilter: false, direction, forceFallback: true, fallbackOnBody: options.fallbackOnBody ?? true, fallbackTolerance: 4, ghostClass: 'opacity-50', group: { name: <unique per call>, pull: false, put: false }, onStart, onEnd, onUpdate })`.
  `onUpdate` reads `ids()` (still pre-move), maps `oldDraggableIndex`/`newDraggableIndex` to
  `from`/`to`, calls `onMove(from, to)` when both exist and differ.
- `dragging`: `true` in `onStart`, `false` in `onEnd` (fires on no-op drops too).
- `disabled`: `watch(options.disabled, (v) => instance.option('disabled', v), { immediate: true })`
  when given. Confirm the return shape (`option`) and every option/event field name against
  `node_modules/vue-draggable-plus/dist/types/*.d.ts` and `@types/sortablejs` before writing; the
  contract above is what matters. If `useDraggable` instead accepts reactive options, pass a
  `computed` and drop the watch.
- Group name: a per-call constant is enough (`pull: false, put: false` already isolates lists);
  keep `'tab-strip'` for `TabStrip` so its DOM is unchanged.

`TabStrip.vue:197-229` becomes:

```ts
const moveTab = host.tabs.moveTab;
if (moveTab) {
  useSortableReorder(stripRef, () => scrollingTabs.value.map(({ tab }) => tab.id), moveTab, {
    draggable: '[data-testid="tab"]',
    filter: '[data-testid="tab-close"]',
    direction: 'horizontal',
  });
}
```

`shallowRef`/`useDraggable` imports drop from `TabStrip.vue` if unused. Behaviour identical; P137's
tab drag specs (`tabs.spec.ts`, `repo-workspace.spec.ts`) are the guard.

### 3.3 Space store and bridge

`frontend/src/bridge/index.ts`, after `codeWorkspaceRemoveRepo`:

```ts
codeWorkspaceReorderRepos: (ids: string[]): Promise<RepoSummary[]> =>
  unwrap(CodeWorkspaceService.ReorderRepos({ ids })).then((r) => trust<RepoSummary[]>(r ?? [])),
```

Update the `:156-158` comment's verb list (import/rename/reorder/remove).

`state/coderepos.ts`, new action:

```ts
/** Optimistic: the new order shows at once in ade's tab strip and the Git panel (both read
 *  `records`); a rejected save re-reads the persisted order, then rethrows. */
async function reorderCodeRepos(fromId: string, toId: string): Promise<void> {
  const ids = moveId(state.records.map((r) => r.id), fromId, toId);
  const byId = new Map(state.records.map((r) => [r.id, r]));
  state.records = ids.flatMap((id) => byId.get(id) ?? []);
  try {
    state.records = await control.codeWorkspaceReorderRepos(ids);
  } catch (err) {
    await hydrateCodeRepos();
    throw err;
  }
}
```

- `records` is **reassigned**, not mutated in place: `repoLinks.ts`'s watcher must re-run
  `RepoWorktreeLinks` (anchor can change, §0). Cost: the optimistic assign and the server echo each
  trigger one `RepoHeads` and one `RepoWorktreeLinks` refresh. One user gesture; no guard added. If the
  implementer finds the echo reassignment triggers visible flicker, assign the echo only when its
  id order differs from the optimistic one.
- Export `reorderCodeRepos` in the store's return. Header comment `:8-11` gains "reorder".

`GitPanel.vue`: no change. It reads `records` order already. Git panel gets no drag of its own
(the row asks for ade tabs; the Git panel only has to show the order).

### 3.4 ade adapter

`useAdeTabStripHost.ts`:

- `tabs.moveTab: (fromId, toId) => { void codeReposStore.reorderCodeRepos(fromId, toId).catch((err: unknown) => adeActions.actionError.set(fromId, \`Couldn't save repository order: ${message(err)}\`)); }`
  where `adeActions = useAdeActionsStore()` and `message` is `err instanceof Error ? err.message : String(err)`
  (inline; `dialogFlow.ts:73`'s `errMessage` is module-private, do not export it for one caller).
- The pinned `ALL_AGENTS_TAB` never reaches `moveTab` (outside the sortable row); no guard needed.
- Header comment `:6-8`: drop "no move capability" and "no reorder path"; say drag-reorder
  persists `code_repos.sort_order` through `reorderCodeRepos`, shared with the Git panel.

### 3.5 Studio consumers

**`ColumnsMenu.vue`**
- Drop the `useDragReorder` import and call (`:10`, `:72-74`); drop `draggable`, `@drag*`, and the
  `dragIndex` ternary on the `Label` (`:117-121`; keep `{ 'is-pk': … }` and `columns-menu-item` class).
- Add `ref="listEl"` on the `overflow-y-auto` container (`:112`) and
  `data-testid="columns-menu-row"` + `:data-name="name"` on each `Label`.
- `useSortableReorder(listEl, () => order.value, (from, to) => { order.value = moveId(order.value, from, to); }, { draggable: '[data-testid="columns-menu-row"]', direction: 'vertical', fallbackOnBody: false })`.
- `onBeforeUnmount` persistence unchanged. Update the `:72-73` comment.
- `v-for` index variable unused after this: drop it.

**`EnvironmentsView.vue`**
- Replace `:74-81` with `const { dragging } = useSortableReorder(listEl, () => displayEnvironments.value.map((e) => e.id), onDragMove, { draggable: '[data-testid="environment-row"]', handle: '[data-testid="environment-grip"]', direction: 'vertical', disabled: () => isFiltered.value })`
  where `onDragMove(from, to)` sets `order.value = moveId(order.value, from, to)` then
  `void variablesStore.reorderEnvironmentsList(order.value)`. `listEl` is the existing
  `useTemplateRef('listEl')` (`:197`); move its declaration above the helper call. Keep the
  comment about declaring before `syncDrafts`.
- `:104`: `if (!dragging.value) order.value = merged.order;`.
- Delete the three drag listeners and `rowIndexFromEvent` (`:205-221`); keep `rowIdFromEvent` and
  the `keydown` listener. Update the `:194-196` comment (keydown only).
- Row `:279-280`: drop `opacity-50` binding and `:draggable`. `v-for` index unused: drop it.
- `displayEnvironments` equals `orderedEnvironments` whenever the helper is enabled (not filtered),
  so display ids are the right source.

**`VariableSetView.vue` + `VariableRow.vue`**
- `VariableSetView.vue:188-196` becomes `const { dragging } = useSortableReorder(listRef, () => displayRows.value.filter((r) => r.id !== '').map((r) => r.id), onDragMove, { draggable: '[data-testid="variable-row"]:not([data-id=""])', handle: '[data-testid="variable-grip"]', direction: 'vertical', disabled: () => isFiltered.value })`;
  `onDragMove` sets `order.value = moveId(order.value, from, to)` then
  `void variableSetStore.reorderVariables(props.tab.id, scope.value, ownerId.value, order.value)`.
  `listRef` (`:431`) moves above the call.
- `:217`: `if (!dragging.value) order.value = merged.order;`.
- `VariableRow` loop `:617-639`: drop `:index`, `:dragging`, `@dragstart`, `@dragover`, `@dragend`.
  `v-for` index unused: drop it.
- `VariableRow.vue`: drop props `index`, `dragging` and their doc comment (`:29-32`); drop the three
  emits (`:47-49`); drop the three listeners (`:125-130`, keep `keydown`; fix the `:122-123`
  "all four listeners" comment); drop `:class="{ 'opacity-50': dragging }"` and `:draggable` (`:144`, `:147`).
  `filtered` stays (grip tooltip).
- Trailing row: excluded by the `:not([data-id=""])` selector, so never a drag source.

**Delete `packages/workbench/src/util/useDragReorder.ts`** once the three are migrated.

## 4. File ownership (one implementer)

| File | Change |
|---|---|
| `apps/kira-space/internal/storage/repos/coderepos.go` | `Reorder` |
| `apps/kira-space/internal/storage/repos/coderepos_test.go` | new, one test (§6) |
| `apps/kira-space/internal/bridge/codeworkspace.go` | `CodeWorkspaceReorderArgs`, `ReorderRepos`, `ListRepos` comment |
| `apps/kira-space/frontend/src/bridge/index.ts` | `codeWorkspaceReorderRepos` |
| `apps/kira-space/frontend/src/state/coderepos.ts` | `reorderCodeRepos` |
| `apps/kira-space/frontend/src/ade/useAdeTabStripHost.ts` | `moveTab`, comment |
| `packages/workbench/src/util/useSortableReorder.ts` | new |
| `packages/workbench/src/components/TabStrip.vue` | drag block onto helper |
| `packages/workbench/src/util/useDragReorder.ts` | deleted |
| `apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue` | onto helper |
| `apps/kira-studio/frontend/src/api/EnvironmentsView.vue` | onto helper |
| `apps/kira-studio/frontend/src/api/VariableSetView.vue`, `VariableRow.vue` | onto helper |
| `apps/kira-space/tests/ui/support/ipcChannels.ts`, `support/mockRuntime.ts` | new channel + FQN |
| `apps/kira-space/tests/ui/ade-module.spec.ts` | P137 test's drag block removed; new drag test |
| `apps/kira-studio/tests/ui/http-variables.spec.ts` | `dragTo` becomes mouse sequence |
| `apps/kira-studio/tests/ui/collections.spec.ts` | new environments drag scenario |
| `apps/kira-studio/tests/ui/data-view.spec.ts` | new columns drag scenario |
| `docs/ARCHITECTURE.md` | §5 |
| `docs/v2.0/SPEC.md` | P140 result section only |

Not touched: migrations, `model/`, `GitPanel.vue`, `AdeRepoTabs.vue`, `createTabsStore.ts`,
`host.ts`, `package.json`, `bun.lock`, generated bindings (gitignored).

## 5. `docs/ARCHITECTURE.md`

- `:1372-1375` (TabStrip reorder): reorder goes through `util/useSortableReorder.ts`, shared with
  Studio's column, environment and variable lists.
- `:2714-2715`: ade repo tabs reorder by drag; order is `code_repos.sort_order`, written by
  `CodeWorkspaceService.ReorderRepos` (full-list rewrite; unknown ids skipped, unlisted rows
  appended), shared with the Git panel's repo list; new imports land last.
- `:2803-2808` (`vue-draggable-plus` rationale): name `useSortableReorder` as the bound-list path,
  `useTimelineDrag` as the `sort: false` pass-through.
- Grep `docs/ARCHITECTURE.md` for any other `useDragReorder` or "native drag" mention of the three
  Studio lists and update it the same way.

## 6. Tests

Mouse sequence for every Sortable drag (P137 result: fallback emulates dragover on a 50 ms tick,
hold before `up`):

```ts
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(from.x, from.y + 10, { steps: 5 }); // past fallbackTolerance (x for tabs)
await page.mouse.move(to.x, to.y, { steps: 15 });
await page.waitForTimeout(300);
await page.mouse.up();
```

Aim the target at its first quarter (`to.y + to.height * 0.25` / `to.x + to.width * 0.25`), as
`ade-module.spec.ts:474` does. One small local helper per spec file; no shared support module across
apps.

### 6.1 Go

`apps/kira-space/internal/storage/repos/coderepos_test.go`, one table-driven test over a real DB
(`storage.OpenAt(t.TempDir())`): create A, B, C. Cases: `Reorder([C,A,B])` lists C,A,B with
`sort_order` 0,1,2; `Reorder([B,X])` (X unknown) lists B, then C,A in prior order; after `Remove(B)`
and a new `Create(D)`, `List` is C,A,D. A fresh `CodeReposRepo` over the same DB path reads the same
order (the "survives restart" proof the static UI mocks cannot give).

### 6.2 Space UI (`ade-module.spec.ts`)

- P137's `ade tabs render through the shared tab strip (P137)` (`:438-478`): delete the drag block
  `:469-477` (it asserts the behaviour this phase reverses). Rest unchanged.
- New `ade repo tabs reorder by drag; the order persists and shows in the Git panel (P140)`.
  Three repos A, B, C; `codeWorkspaceReorderRepos` snapshot answering `[C, A, B]`.
  1. Drag C onto A. Strip text: `All agents, C, A, B`. Exactly one `IPC.codeWorkspaceReorderRepos`
     call, `args.ids` `[C, A, B]`.
  2. Pinned "All agents" stays first; a drag starting on it moves nothing and sends no call.
  3. Switch to Git mode (the route `:104-130` uses); `repo-row` order is C, A, B.
  4. `relaunch` with `codeWorkspaceListRepos` answering `[C, A, B]`: ade strip reads C, A, B (boot
     path honours stored order; persistence itself is §6.1's proof).
  5. Error path: a fresh `relaunch` where `codeWorkspaceReorderRepos` answers
     `error: { code: 'E_INTERNAL', … }` and `codeWorkspaceListRepos` answers `[A, B, C]`: after the
     drag the strip settles back to A, B, C.

Add `codeWorkspaceReorderRepos: 'kira:codeWorkspace:reorderRepos'` to `ipcChannels.ts` and
`codeWorkspaceReorderRepos: 'CodeWorkspaceService.ReorderRepos'` to `mockRuntime.ts`. No boot
default (no boot call).

### 6.3 Studio UI

- `http-variables.spec.ts:390-392`: `dragTo` becomes the mouse sequence on `variable-grip` of v3
  onto v1. Assertions unchanged (one `variablesReorder`, ids `['v3','v1','v2']`).
- `collections.spec.ts` (environments scenario near `:362`), new
  `environments reorder by dragging the grip; refused while filtered (P140)`: two or three envs,
  `IPC.variablesReorderEnvironments` snapshot. Drag last grip onto first: one call, ids in new
  order, row order matches. Type a filter, drag again: no new call.
- `data-view.spec.ts` after the projection-restore block (`:1228-1233`), new step: open Columns,
  drag `hash` row onto `id` row, Escape; `grid-header-cell` order is `hash, id`; `toolbar-columns`
  has `has-indicator`. Restore isn't needed if it is the file's last columns step; otherwise drag
  back.

### 6.4 Unchanged, must stay green

`tabs.spec.ts` and `repo-workspace.spec.ts` P137 drag tests (TabStrip on the helper),
`tooltips.spec.ts:193` (`.columns-menu-item.is-pk`), `api-secret-reveal-isolation.spec.ts:338-343`
(grip hover + `Alt+ArrowUp`), `ade-all-agents.spec.ts`, `ade-timeline.spec.ts`.

## 7. Verification

Per commit (fast): `bun run lint`, `bun run typecheck`; after Go commits also
`go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/bridge/...` and
`gofmt -l apps/`. Regenerate bindings after commit 1, before any frontend typecheck/build.

End of phase, once, in full:

- `bun run test:go`
- `bun run test:unit`
- `bun run test:ui:space`
- `bun run test:ui:studio` (includes `ui-timing`)
- `bun run test:visual:studio`, `bun run test:visual:space` (expect no diff: no visual change)
- `bun run typecheck`
- `bun run lint:all` (`lint`, `lint:go`, `lint:dead`/knip: `useSortableReorder`, `moveId` must have
  real importers)

Failures get fixed as follow-up commits, one per finding, same phase; pre-existing ones too
(`CLAUDE.md`).

## 8. Steps and commits

Each commit passes the pre-commit hook without `--no-verify` and ends with the session's
attribution lines.

1. `feat(space): persist code repo order via CodeWorkspaceService.ReorderRepos` — §3.1 plus
   `coderepos_test.go` (§6.1). Regenerate bindings.
2. `feat(space): coderepos store reorder action` — §3.3 (`bridge/index.ts`, `coderepos.ts`) plus
   `ipcChannels.ts`/`mockRuntime.ts` entries.
3. `refactor(workbench): shared useSortableReorder; TabStrip onto it` — §3.2.
4. `feat(space): ade repo tabs reorder by drag` — §3.4, plus §6.2's removal of P137's no-reorder
   drag block (suite would otherwise be red).
5. `test(space): ade repo tab drag-reorder coverage` — §6.2 new test.
6. `refactor(studio): ColumnsMenu reorders through vue-draggable-plus` — §3.5, plus §6.3 columns step.
7. `refactor(studio): EnvironmentsView reorders through vue-draggable-plus` — §3.5, plus §6.3
   environments test.
8. `refactor(studio): variable rows reorder through vue-draggable-plus` — §3.5 `VariableSetView`/
   `VariableRow`, plus the `http-variables.spec.ts` drag rewrite (same commit, else red).
9. `refactor(workbench): delete useDragReorder` — file deletion.
10. Follow-up `fix(…)` commits for whatever §7's full run finds.
11. `docs: ARCHITECTURE records repo order persistence and useSortableReorder (P140)` — §5.
12. `docs(v2.0): P140 result` — result section under the SPEC row: commits, test counts
    before/after, §10 audit, §9 gaps, disclosures (env grip-only drag, worktree anchor, no
    cross-window live sync).

## 9. What a Linux sandbox cannot verify

- Drag feel in WebKitGTK/WKWebView and macOS trackpad (same gap P137 states).
- Live ade against real repos: optional, via `docs/DEV_ENVIRONMENT.md`'s P129 Part 5 bypass;
  report whether it ran. The real `ReorderRepos` round trip is proven by §6.1 and `go test`, not by
  the UI suite (static mocks).

## 10. Closing audit

Report each with command and result in the result section.

| Check | Command | Expect |
|---|---|---|
| `useDragReorder` gone | `rg 'useDragReorder'` (repo-wide, `docs/v*/plans` and `SPEC.md` history excepted) | no hit in code or `ARCHITECTURE.md` |
| File deleted | `test ! -e packages/workbench/src/util/useDragReorder.ts` | true |
| No native DnD in the three views | `rg -n 'draggable=\|@drag\|dragstart\|dragover\|dragend\|DragEvent\|dataTransfer' apps/kira-studio/frontend/src/views/grid/ColumnsMenu.vue apps/kira-studio/frontend/src/api/EnvironmentsView.vue apps/kira-studio/frontend/src/api/VariableSetView.vue apps/kira-studio/frontend/src/api/VariableRow.vue` | empty (Sortable's `draggable:` option is not matched) |
| Library really drives them | `rg -n 'useSortableReorder\(' apps packages` | `TabStrip.vue`, `ColumnsMenu.vue`, `EnvironmentsView.vue`, `VariableSetView.vue` |
| Helper uses the library | `rg -n "from 'vue-draggable-plus'\|forceFallback" packages/workbench/src/util/useSortableReorder.ts` | import, `forceFallback: true` |
| ade has `moveTab` | `rg -n 'moveTab' apps/kira-space/frontend/src/ade/useAdeTabStripHost.ts` | 1 hit |
| Bridge method has a caller | `rg -n 'ReorderRepos' apps/kira-space/frontend/src` | `bridge/index.ts` |
| Store action has a caller | `rg -n 'reorderCodeRepos' apps/kira-space/frontend/src` | definition plus adapter |
| No migration | `git diff --stat a2d9e2c6 -- apps/kira-space/internal/storage/migrations` | empty |
| No new dependency | `git diff --stat a2d9e2c6 -- package.json bun.lock '**/package.json'` | empty |
| Suites | §7 | all green |

## 11. Risks

- **Sortable `draggable` selector with `:not(...)`.** Sortable matches via `closest(el, selector)`,
  which uses `Element.matches`, so `:not([data-id=""])` works. If it does not, mark the trailing row
  with `data-trailing` and use `[data-testid="variable-row"]:not([data-trailing])`.
- **Trailing row as drop target.** It is not a draggable item, so Sortable does not sort past it.
  If a drop below the last real row ever lands after the trailing row, `filter` it as well.
- **`disabled` timing.** A filter typed mid-drag: Sortable finishes the current drag; `onUpdate`
  then still fires. Guard inside the consumer's `onDragMove` with `if (isFiltered.value) return`
  only if the §6.3 filtered scenario shows it.
- **`order` vs display ids.** `orderedEnvironments`/`allRealRows` drop ids with no row, so display
  ids can be a subset of `order` transiently. `moveId` on `order` with ids taken from display is
  still correct (both ids are in `order`).
- **Popover dismissal.** If the `ColumnsMenu` drag closes the popover in Chromium despite
  `fallbackOnBody: false`, the cause is reka's pointer-outside detection on the fallback clone;
  fix at the cause (e.g. the clone's container), never by suppressing dismissal globally.
- **Optimistic echo flicker.** §3.3 note.
- **knip.** `moveId` and `useSortableReorder` exported with real importers in both apps; the
  type `SortableReorderOptions` unexported if knip flags it.
- **jscpd.** If the three Studio `onDragMove` bodies trip it, fold the `order.value = moveId(...)`
  plus persist into one line each; do not add a second helper.

## 12. Acceptance

| Requirement | Where met |
|---|---|
| Persisted repo order path: storage and bridge plus frontend | §3.1, §3.3 |
| Wired through `useAdeTabStripHost.ts` and `TabStripHost.moveTab` | §3.4 |
| Plan states where order lives (schema/migration vs column) | §0, §3.1: existing column, no migration |
| How Git panel reads it | §0, §3.3 |
| How new or removed repos slot in | §0, §3.1 |
| `ade` tabs reorder by drag, order survives reload, shows in Git panel | §6.1, §6.2 |
| Three consumers on `vue-draggable-plus`: `useDraggable`, `forceFallback`, one move per drop | §3.2, §3.5 |
| `useDragReorder.ts` deleted, `rg 'useDragReorder'` empty | §8 step 9, §10 |
| Existing drag coverage passes; new ade drag test in `apps/kira-space/tests/ui/` | §6.2-6.4 |
