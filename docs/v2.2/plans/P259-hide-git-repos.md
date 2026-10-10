# P259 plan: hide git repos, remove-repo placement

Ask (user, verbatim): "another phase for the git repos to be able to hide them. In both cases
where it's imported one by one or the entire folder. And the remove repository button should be
somehow in the repository view, now it's there like a generic button. I mean the panel that owns
the button."

Base: `v2.0` at `dcdbe9233` (P258 landed). One sequential Sonnet implementer.

Method: `codegraph_explore` on the main checkout index (same commit). It resolved Go storage and
git-ui symbols; Space frontend files (`ReposDialog.vue`, `GitPanel.vue`) are not in the index, so
those were read directly. Rest by grep/Read over the worktree.

## 1. Findings

Repo registry (Space only, `kira-space.db`):

- `code_repos` (`internal/storage/repos/coderepos.go`, `CodeReposRepo`): one row per imported
  checkout. Wire `model.CodeRepo` = TS `RepoSummary` (`packages/shared/domain/repo.ts`, zod).
  Read by `CodeWorkspaceService.ListRepos`, pushed to every window through `kira:adetask:repos`
  (`OnReposChanged` -> `state/coderepos.ts` `hydrateCodeRepos`).
- `ade_repo_config.source`: `'added'` or the scan folder path that imported the repo.
- `ade_folders (path, watch)`: scan folders. `TaskBoard.AddFolder` scans to depth 3 and imports
  every repo not yet known (`importFolder`, `internal/ade/repoconfig.go`). Watch mode rescans on
  fsnotify create/rename (`folderwatch.go`). `RemoveFolder` keeps the repos, sets them to `'added'`.
- `importFolder` skips `ErrAlreadyImported`, so a row that exists survives every rescan untouched.
  A row the user **removes** comes back on the next rescan of a watched folder. Hiding is the
  answer to that: the row stays, so rescans never re-add it.

Where repos are listed:

- Git panel Repos tab (`frontend/src/repo/GitPanel.vue`, `filteredRepos` over
  `codeReposStore.records`): the left bar list. Row context menu has Open, Copy path, Open
  terminal, Configure repository…, Colour, Rename…, Close, **Remove (no confirm)**.
- Repositories dialog (`frontend/src/repo/ReposDialog.vue`, P205): left nav lists every repo plus a
  Scan folders tab; right section shows the selected repo as `<h2 font-semibold>` name plus
  `RepoConfigForm`. **"Remove repository" sits in `DialogFooter`, left of Close**
  (`repos-dialog-repo-remove`, `variant="dialog-danger"`): a dialog-level footer button, not part
  of the repo's own panel. This is the "generic button" the user means.
- ADE reads the same records (tab strip, `AdeView` empty state, `AdeAddPopover` picker via
  `adeTaskRepos`). Agent MCP `task_info.registered` reads `ade_repo_config`.

Autoload cost today: `repoHeads.ts` calls `CodeWorkspaceService.RepoHeads` with no ids on every
`records` change, which spawns git for every imported repo (4-way pool). `RepoWorktreeLinks` reads
every repo to resolve worktree anchors.

git-ui (`packages/git-ui`) has no repo list and no remove action; its `GitViewHead` is the repo
graph's head. Nothing in this phase touches `packages/git-ui` or the git-ipc contract.

## 2. Model

- `code_repos.hidden INTEGER NOT NULL DEFAULT 0`: the only flag that decides visibility, for a
  repo imported one by one and one imported by a folder alike.
- `ade_folders.hidden INTEGER NOT NULL DEFAULT 0`: folder-level "hide all". Setting it writes the
  same value onto every repo whose `source` is that folder (one transaction) and makes later
  discoveries in that folder import hidden. Clearing it unhides every repo of that folder.
- A single repo can be unhidden inside a hidden folder: repo flag false, folder flag stays, new
  discoveries still come in hidden.
- Re-scan, re-add of the same folder, watch toggle: never touch existing `hidden` values
  (`importFolder` skips known rows; `AddFolder` upsert writes `watch` only).
- `RemoveFolder`: repos turn `'added'`, keep their `hidden` value.

## 3. Defaults (for user review)

- D1. Hidden is scoped to the Git module's repo list (Git panel Repos tab). ADE (tab strip,
  new-task picker, candidates), agent `task_info.registered`, mobile and open workspaces in other
  windows are unaffected. A hidden repo stays fully usable.
- D2. Persistence: `code_repos.hidden` plus `ade_folders.hidden`, engine-wide in the Space DB
  (migration `0032_p259_repo_hidden.sql`). No settings-table row, no per-window state.
- D3. Folder "hide all" = folder flag plus bulk write onto its repos, and new discoveries import
  hidden. Unhide folder = clear flag plus unhide all its repos. Per-repo unhide inside a hidden
  folder allowed.
- D4. "Show hidden" is a Git panel header toggle (eye icon, Repos tab only, rendered only while at
  least one repo is hidden). Session-only (Pinia store, not persisted), resets to off on reload. Hidden rows
  then render dimmed (`text-muted-foreground`) with an `eye-closed` 13px icon and their menu offers
  "Show" instead of "Hide".
- D5. Hiding from the Git panel closes that repo's workspace in this window (same calls as the
  row's Close: `collapseRepoWorktrees` then `closeRepoWorkspace`). Other windows keep theirs open.
- D6. Hide/Show is offered on top-level repo rows only. A worktree child record (nested under its
  anchor) has no Hide; hiding an anchor hides its nested worktree rows with it.
- D7. Repositories dialog lists every repo, hidden included (it is the management surface).
  Hidden nav rows render dimmed with a trailing `eye-closed` icon.
- D8. Remove moves into the selected repo's own panel in the dialog: a repo head on the Studio view
  head recipe (`ViewToolbar`: colour dot, `repo` codicon 13px, dim parent dir plus name,
  `Badge` for source and for Hidden, colour band below), actions at the right: Hide/Show toggle
  button and a "Remove repository…" `TooltipIconButton` (`trash`), Studio `KeyValuePane` toolbar
  delete precedent. The footer button is deleted; footer keeps only Close (and the folders note).
  The `<h2 font-semibold>` title is replaced by this head (P258: no semibold).
- D9. Remove always confirms through the workbench `ConfirmDialog` (`danger: true`,
  `confirmLabel: 'Remove'`). For a folder-sourced repo the message adds that a rescan of that
  folder imports it again and suggests Hide. The Git panel row menu's Remove (today no confirm)
  uses the same shared confirm helper.
- D10. Importing an already imported hidden repo one by one (dialog Import, `openRepoAtPath`)
  unhides it and returns the existing record instead of `E_ALREADY_IMPORTED`. A visible duplicate
  still answers `E_ALREADY_IMPORTED`.
- D11. Scan folders tab: each folder row gets a Hide all / Show all `TooltipIconButton`
  (`eye-closed`/`eye`, `aria-pressed`) and its count reads `N repos · M hidden` when M > 0.
- D12. No autoload cost: `repoHeads.ts` asks `RepoHeads` for visible top-level ids only (plus
  hidden ones while Show hidden is on); no call when that set is empty. `RepoWorktreeLinks` stays
  engine-wide (anchor resolution needs every row; cost unchanged). No Keychain access anywhere.
- D13. No git-ipc change, so no `ContractVersion` bump (stays 48). `adewire` grows
  `Folder.hidden`, `Folder.hiddenCount` and `FolderHiddenArgs`; `RepoSummary` grows `hidden`.
- D14. Empty state: all repos hidden and Show hidden off -> Git panel shows `Empty`
  ("All repositories are hidden") with a "Show hidden" button, not the import empty state.

## 4. Backend

### 4.1 Storage

- `apps/kira-space/internal/storage/migrations/0032_p259_repo_hidden.sql`:
  `ALTER TABLE code_repos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`
  `ALTER TABLE ade_folders ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`
- `model.CodeRepo` (`storage/model/coderepos.go`): `Hidden bool \`json:"hidden"\``.
- `CodeReposRepo`: add `hidden` to `codeReposSelectColumns`, scan and `Create` insert. New
  `SetHidden(id string, hidden bool) (model.CodeRepo, error)`, `SetColor`'s shape (not found ->
  error).
- `model.AdeFolder`: `Hidden bool`, `HiddenCount int`. `AdeRepoConfigRepo.Folders`: select
  `f.hidden` and `(SELECT COUNT(*) FROM ade_repo_config a JOIN code_repos c ON c.id = a.code_repo_id
  WHERE a.source = f.path AND c.hidden = 1)`.
- `AdeRepoConfigRepo.SetFolderHidden(path string, hidden bool) (bool, error)`: one transaction:
  update `ade_folders.hidden`; false when no row; then
  `UPDATE code_repos SET hidden = ? WHERE id IN (SELECT code_repo_id FROM ade_repo_config WHERE source = ?)`.
- `AdeRepoConfigRepo.FolderHidden(path) (bool, error)` for the import path (or reuse `Folders`;
  implementer picks the cheaper read).

### 4.2 Import

- `codeworkspace.ImportOptions.Hidden bool`: passed into `store.Create`, so a hidden discovery is
  one insert, never insert-then-update.
- `importError` carries the existing `model.CodeRepo` on `ErrAlreadyImported` (exported accessor,
  e.g. `codeworkspace.ExistingRecord(err) (model.CodeRepo, bool)`), for D10.
- `TaskBoard.importFolder`: read the folder's `hidden` once per scan, pass
  `ImportOptions{RejectLinkedWorktree: true, Hidden: folderHidden}`.

### 4.3 Bound methods (Wails)

- `CodeWorkspaceService.SetRepoHidden(CodeWorkspaceSetHiddenArgs{ID string, Hidden bool})
  (model.CodeRepo, error)`: `E_BAD_REQUEST` on empty id; `reposChanged()` on success.
- `CodeWorkspaceService.ImportRepo`: on `ErrAlreadyImported` whose existing record is hidden,
  `SetHidden(false)`, `reposChanged()`, return it (D10).
- `AdeTaskService.SetFolderHidden(adewire.FolderHiddenArgs{Path string, Hidden bool})
  (adewire.Folder, error)`: `validateAdePath`; engine `TaskBoard.SetFolderHidden` cleans the path,
  `invalid("folder %s is not in the list")` when unknown, `notifyRepos()`, returns the folder.
- `adewire.Folder`: `Hidden bool \`json:"hidden"\``, `HiddenCount int \`json:"hiddenCount"\``;
  `TaskBoard.Repos` and `folderByPath` fill them. TS mirror in `frontend/src/ade/v2/wire.ts`.
- Regenerate bindings with `wails3 task common:generate:bindings` (`docs/DEV_ENVIRONMENT.md`).

## 5. Frontend (Space)

- `packages/shared/domain/repo.ts`: `hidden: z.boolean()` on `repoSummarySchema`.
- `frontend/src/bridge/index.ts`: `codeWorkspaceSetRepoHidden(id, hidden)`,
  `adeTaskSetFolderHidden(args)`.
- `state/coderepos.ts`: `setCodeRepoHidden(id, hidden)` (writes the returned record, like
  `setCodeRepoColor`); `importRepoViaDialog`/`openRepoAtPath` unchanged (D10 is server-side).
  Add `confirmRemoveCodeRepo(id, name, source?)`: shared D9 confirm plus `removeCodeRepo`. Used by
  the dialog head and the Git panel menu.
- `repo/state/reposQueries.ts`: `useSetFolderHidden()` mutation, `onSettled: invalidateRepos`.
- `GitPanel.vue`:
  - `showHidden` from `repoVisibility` (D4, below). `filteredRepos` drops `hidden` rows unless
    `showHidden`.
  - Header: eye `TooltipIconButton` next to Manage repositories, `v-if` any hidden,
    `data-testid="repos-show-hidden"`, `aria-pressed`.
  - Row: hidden row dimmed plus `eye-closed` icon (`data-testid="repo-hidden-mark"`).
  - Menu: "Hide" (`eye-closed`) / "Show" (`eye`) item before the Rename/Close/Remove separator,
    `id: 'hide'`/`'show'`. Hide also runs D5. Remove goes through `confirmRemoveCodeRepo`.
  - `panelEmpty` stays "no records"; new all-hidden `Empty` (D14).
- `repo/state/repoVisibility.ts`: small Pinia store (one concern) holding `showHidden` and the
  visible top-level id set, read by both `GitPanel` and `repoHeads`.
- `repo/state/repoHeads.ts`: refresh with the visible id set (D12).
- `ReposDialog.vue`:
  - Right section, repos tab: replace `<h2>` with the repo head (D8),
    `data-testid="repos-dialog-repo-head"`; Hide toggle `repos-dialog-repo-hide`
    (`aria-pressed`); Remove `repos-dialog-repo-remove` (testid kept, moved).
  - Nav rows: dimmed plus `eye-closed` for hidden (D7), `data-hidden` attribute.
  - Folder rows: Hide all toggle `repos-dialog-folder-hide`, count text (D11).
  - Footer: remove button deleted.
- Styling: Tailwind utilities and shadcn-vue/theme parts only (`ViewToolbar`, `Badge`,
  `TooltipIconButton`, `Empty`); no scoped `<style>`, no semibold.

## 6. Tests

Split at the IPC boundary (CLAUDE.md): each scenario has a flow test and a UI spec asserting the
same result.

Flow tests (`apps/kira-space/internal/flows`):

- `repoflow/hidden_test.go` `TestHideRepo`: import, `SetRepoHidden(true)` -> record `hidden`,
  `ListRepos` agrees, `ChannelRepos` push, survives `flowharness` relaunch; empty id
  `E_BAD_REQUEST`; re-import of the hidden repo returns the same id unhidden (D10); re-import of a
  visible one `E_ALREADY_IMPORTED`. Writes contract `repos-hidden`:
  `CodeWorkspaceService.SetRepoHidden` (mask `createdAt`).
- `adeflow/boardfacts_test.go` (next to the existing folder test) or new
  `adeflow/folders_hidden_test.go` `TestHideFolder`: `AddFolder` with two repos;
  `SetFolderHidden(true)` -> both repos hidden, `Folder.hidden`, `hiddenCount` 2; a third repo
  created in the folder plus rescan (`AddFolder` again) imports hidden; unhide one repo, rescan,
  it stays visible; `SetFolderHidden(false)` unhides all; unknown folder -> invalid;
  `RemoveFolder` keeps flags. Writes contract `repos-hidden`: `AdeTaskService.SetFolderHidden`.
- Coverage gate (`flows/coverage`) picks up both new bound methods by name; `exempt.txt` stays
  empty.
- `bridge/adewire/wire_test.go` fixtures: add `hidden`/`hiddenCount` to every folder in
  `tests/fixtures/ade-v2/repos.json` and `folder-import.json` (round-trip test needs them).
- `tests/contract/repos.json`: `ImportRepo` record gains `"hidden": false` (regenerated by the
  flow run). Existing Go tests building `model.CodeRepo` literals need no change (zero value).
- No dedicated unit tests (CLAUDE.md bar): the folder/repo flag interplay is covered by flow tests.

UI specs (`apps/kira-space/tests/ui`):

- `repos-dialog.spec.ts`: update "removing a repository asks first" to click the head button and
  assert the footer has no remove; contract `repos-hidden` `SetRepoHidden`: head Hide sends
  `{id, hidden: true}` and the nav row turns `data-hidden`; folder-sourced remove confirm text
  names the folder; contract `SetFolderHidden`: folder Hide all sends `{path, hidden: true}` and
  the row shows `M hidden`.
- New `git-panel-hidden.spec.ts`: a hidden record (`REPO_RECORDS` copy with `hidden: true`) is
  absent from `repo-row`; `repos-show-hidden` reveals it with `repo-hidden-mark`; menu Hide sends
  `SetRepoHidden` and closes the open workspace; menu Show sends `hidden: false`; menu Remove asks
  first; `RepoHeads` args never include the hidden id while Show hidden is off; all-hidden `Empty`.
- Mock wiring: `tests/ui/support/ipcChannels.ts`, `mockRuntime.ts` FQN map
  (`CodeWorkspaceService.SetRepoHidden`, `AdeTaskService.SetFolderHidden`), push mapping
  `[IPC.adeTaskSetFolderHidden]: [IPC.adeTaskReposChanged]` like `SetFolderWatch`;
  `adeV2.ts` `repoRecord` gains `hidden: false`.

Visual (`apps/kira-space/tests/visual/git-module.spec.ts`): no existing git baseline shows the Git
panel or the Repositories dialog, so none is re-recorded. Add one baseline,
`git-repos-dialog.png` (dialog with the repo head, one hidden nav row), recorded with
`bun run test:visual:update:space`, reviewed by eye before commit.

## 7. Docs

- `docs/ARCHITECTURE.md`: "Repository list (P190)" paragraph: hidden flag, Show hidden, Remove in
  the repo head; storage list: Space `0032` adds `code_repos.hidden`, `ade_folders.hidden`.
- `docs/v2.2/SPEC.md`: P259 row `Done` plus `## P259 result` (defaults taken, commits) at phase end.

## 8. Commit groups (one implementer, in order)

1. `feat(space): hidden flag for repos and scan folders` — migration, model, `CodeReposRepo`,
   `AdeRepoConfigRepo`, `ImportOptions.Hidden`, `importFolder`.
2. `feat(space): bound SetRepoHidden and SetFolderHidden` — bridge, adewire, `TaskBoard`,
   D10 re-import, bindings, `wire.ts`, fixtures, flow tests, contract JSON.
3. `feat(space): hide repos in the Git panel` — `repoVisibility` store, `GitPanel`, `repoHeads`,
   `coderepos` helpers, menu confirm.
4. `feat(space): remove and hide in the repository head` — `ReposDialog`, folder Hide all,
   `reposQueries`.
5. `test(space): hidden repo UI specs and repos dialog baseline` — specs, mock wiring, baseline.
6. `docs: P259 architecture and result`.

## 9. File ownership

All in one stream: `apps/kira-space/internal/{storage,codeworkspace,ade,bridge,flows}/…`,
`apps/kira-space/frontend/src/{bridge,state,repo,ade/v2/wire.ts}`, `apps/kira-space/frontend/bindings`,
`apps/kira-space/tests/{ui,visual,contract,fixtures/ade-v2}`, `packages/shared/domain/repo.ts`,
`docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md`. No `packages/git-ui`, no `packages/git-ipc`.

Split: not warranted. Groups 2-5 depend on group 1's columns and on group 2's wire shape;
`ReposDialog` and `GitPanel` share `coderepos.ts` helpers. One sequential implementer.

## 10. Checks

Per commit (fast): `go build ./...`, `go vet ./apps/kira-space/...`, `bun run lint`,
`bun run typecheck:space-web`, `bun run typecheck:space-tests`,
`go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/bridge/adewire/...`.

Once at phase end: `bun run lint:go`, `bun run lint:dead`, full `bun run typecheck`,
`bun run test:flows:space` (coverage gate included),
`bun run test:ui:space` (at least `repos-dialog`, `git-panel-hidden`, `git-panel-tab`,
`repo-workspace`, `color-rails`), `bun run test:visual:space`. Fix every failure found, pre-existing
or not, per CLAUDE.md.
