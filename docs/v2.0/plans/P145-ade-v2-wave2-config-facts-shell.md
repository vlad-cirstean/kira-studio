# P145 plan: ADE v2 wave 2 — workflow editing, repos config, integration and deploy facts ‖ shell, Plan timeline, task cards, Add

Two streams, one `P`. Stream A (Go) and Stream B (frontend) in separate worktrees off one base.
Implements preplan §4 P145 and the P143 contract's P145 rows. Nothing from P146+.

Inputs: `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P145, §5 matrix, §6 D1-D16),
`plans/P143-wire-contract.md` (frozen; §4 P145 methods, §5 channels), `plans/P144-*` (plan, notes),
`design/ade-v2/SPEC2.md`, `design/ade-v2/mockup.html`, `SPEC.md` P145 row. Base `B0`: `v2.0` tip once
this plan is approved and U1 (§2) is answered.

**Status: proposed, pending user approval and U1.**

## 0. Findings from the current tree

- P144 landed `AdeTaskService` (`bridge/adetask.go`, 20 methods), `ade.TaskBoard` (`board.go`,
  `board_facts.go`, `board_writes.go`, `rebasecheck.go`), `adeflow.Reader` (read-only), 0008 tables, and
  `frontend/src/ade/v2/board/*` (9 pure files, knip entries). `index.ts` has the 20 `adeTask*` entries +
  `onAdeTaskBoard|Backlog|Credential`; nothing for P145's 11 methods or `workflows`/`repos` channels.
- `computeBranch` (`board_facts.go:238`) fills `Integration: []`, `Deployments: []` (`zeroBranch`,
  line 33). `refreshRepo` (`board.go:526`) returns `MergedInto: []`.
- `AdeRepoConfigRepo` (`storage/repos/aderepoconfig.go`) is read-only (`List`, `Folders`); `List`
  defaults `prepare_timeout` to `'10m'`.
- Prepare script is the shared leaf `GitRepoSettings.WorktreePrepareScript` (row-per-leaf table
  `git_repo_settings`, `appsettings.Leaf`; no schema change to add a leaf). Its only runner is
  `gitsession.RunPrepare` (`worktree.go:458`, git-ui worktree add), hard-capped by
  `gitprepare.PrepareTimeout = 15m` (`gitprepare/runner.go:16`, "no setting raises it", G25 D12).
- Code-repo import lives in the bridge: `CodeWorkspaceService.ImportRepo` (`bridge/codeworkspace.go:268`:
  `Discovery.Status`, `gitclient.Identify`, dedupe by `RepoID`, `CodeRepos.Create`). No push channel
  tells the frontend `state/coderepos.ts` that `code_repos` changed.
- Git helpers present: `gitsession.RepoEntry.isAncestorOrNot` (unexported, `preflight.go:443`),
  `porcelain.IsAncestorArgs`, `CountRangeArgs`, `runAllowingExit`. No `git cherry` / `patch-id`
  helper; `gitclient.Spec.Stdin` exists (patch-id needs stdin).
- `fsnotify v1.10.1` and `go.yaml.in/yaml/v3` already direct in `go.mod`. `vue-draggable-plus`,
  `@vueuse/core`, `pinia`, `@tanstack/vue-query`, `reka-ui` already in `package.json`. shadcn
  primitives present: popover, tabs, tooltip, badge, dialog, input, textarea, switch, toggle-group.
  No new dependency is needed by either stream.
- **v1 Claude-dialog delivery needs v1-only methods.** `ade/launch.ts` `deliver()` calls
  `adePrepareLaunch` (v1, `ade_sessions` row keyed `codeRepoId`+`branch`) or `adeSend`, then opens the
  PTY via `terminalsStore.openTerminalSession`, shown in the v1 panel's Sessions tab. The v2 equivalents
  (`StartBranch`, `Send`, `Sessions`) land in P146/P147 A; the v2 panel lands in P146 B, its Sessions
  tab in P148 B. See U1.
- v1 frontend reach: `workbench/modes.ts` imports `ade/AdeView.vue`; `main.ts` imports
  `ade/state/agentSessions.ts`; `bridge/index.ts` imports v1 `ade/wire.ts` types. Nothing else outside
  `ade/` imports `ade/`.
- v1 tests: `tests/unit/ade-{all-agents-parity,dialog-flow,dialog-parity,dialog-rules,notes-markdown,
  queue-parity,queue-rules,timeline-parity}.spec.ts`, support `mockupOracle.ts`, `mockupToWire.ts`;
  `tests/ui/ade-{all-agents,dialogs,module,panel,timeline}.spec.ts`, support `ade.ts`; v1 FQNs and
  `emulateAdeRepoPush` in `tests/ui/support/mockRuntime.ts`. `modules.spec.ts` asserts
  `[data-testid="ade-view"]`.
- Visual baselines are CI-Linux-only; `--update-snapshots` from this sandbox corrupts them
  (`docs/DEV_ENVIRONMENT.md` "tests/visual/* pixel diffs").
- Real backend in sandbox: `go build -tags server` recipe (`DEV_ENVIRONMENT.md` P126 section; git
  discovery needs an uncommitted local `Locate` patch on Linux).

## 1. Decisions

Restated (preplan §6), implemented here: D1 (git CLI only; integration/deploy facts via
`merge-base --is-ancestor`, `git cherry`, `git patch-id --stable`; no go-git), D2 (workflows dir created
on first write, never seeded), D4 (first-10 cap UI), D9 (no Jira sync, no CI badge), D13 (writer
validates through `adeflow.Parse`), D14 (merge recorded only by `RecordMerge`, called from P146's merge
dialog finish), D15 (folders import into `code_repos`), D16 (no dependency/work-type UI).

| # | Decision | Why |
|---|---|---|
| F1 | Migration `0009_p145_ade_marks.sql` (§3.1). P146's `ade_sessions` rebuild becomes `0010`; closing step fixes the number in `SPEC.md` P146 row and preplan §1/§4 | Stale detection (SPEC2 §6: "was merged", "rebased since", env "moved back") needs memory git alone cannot give |
| F2 | Prepare timeout becomes a `GitRepoSettings` leaf `worktreePrepareTimeout` (default `15m`, max `2h`) next to the script; 0009 drops `ade_repo_config.prepare_timeout` | One script, one timeout, one store, used by git-ui's worktree add now and P146's setup later. Default keeps today's 15m |
| F3 | `gitprepare.PrepareTimeout` const becomes `DefaultPrepareTimeout`; `Spec.Timeout` required (> 0). G25 D12's "no setting raises it" is superseded by SPEC2 §6.3 | Preplan "lift PrepareTimeout to a per-repo value" |
| F4 | Integration/deploy containment is one evaluator (§3.5), cached per repo by shas | §6 and §6.2 define the same three outcomes; one rule set, one test |
| F5 | Only `mine` branches get integration/deploy rows; others `[]` | SPEC2 §6/§6.2 "every branch of mine" |
| F6 | Workflow form save on a file with a YAML syntax error: `E_INVALID` `fix the YAML error on line N first`. YAML save writes any text (valid or not); last-valid rule covers invalid | Never overwrite the user's text; SPEC2 §5.1.1 "last valid version stays in use" |
| F7 | `ImportWorkflow` target file = `<id>.yaml` (or sanitized source basename if unparseable); existing name → `E_INVALID`. `NewWorkflow` slugs the name, suffix `-2`… on collision, minimal valid one-stage `user` workflow | No silent overwrite; a new file must be valid to list |
| F8 | Folder scan: depth ≤ 3, stop descending at a repo root, skip hidden dirs and `node_modules`, skip bare repos and linked worktrees (`IsLinkedWorktree`). Already imported repos skipped, not errors. `RemoveFolder` keeps imported repos, sets their `source` to `added` | Worktrees under `~/wt` must never import; removing repos would close Git-module tabs (D15 shared list) |
| F9 | `codeworkspace.Import` (new) holds the import core; `CodeWorkspaceService.ImportRepo` and folder import both call it | One import rule set for both entry points |
| F10 | Deploy scripts: run in the repo root through `gitprepare` plumbing, fixed 60s timeout, first output line matching `^[0-9a-f]{7,40}$`, resolved by `rev-parse --verify <sha>^{commit}`; failure → status `unknown` + `error` | Fixture already models `unknown`; scripts are user-configured shell text like the prepare script |
| F11 | Task stage action buttons (`▶ Run`, `Done ›`, `Approve`, `Take over`, …) are not rendered this wave; the task row's left cell shows only the derived status tag. Buttons land with their methods (P147 B, preplan already lists them there) | No inert buttons (CLAUDE.md: no half-implemented scope). `SPEC.md` P145 row names only the git action column |
| F12 | Branch actions this wave: Force push (confirm dialog → P144 `ForcePush`). Rebase / Queue after per U1 | Only actions whose methods exist |
| F13 | New task from the Add popover: `workflowId: ''` | P144 precedent (promoted backlog item: no workflow; user picks via P147 `SetTaskWorkflow`) |
| F14 | `adeBoardUi` Pinia store persists `showAllItems`, `showHistory`, hidden repo ids through VueUse `useLocalStorage`; selection in memory | SPEC2 §12 `UiState2` is persisted state; preplan: Pinia, not settings |
| F15 | No committed visual baseline this wave; mockup comparison is a scripted screenshot pair + DOM geometry checks in a UI spec (§6.3) | CI-Linux-only baseline policy |
| F16 | Root stays `ade/AdeView.vue` (rewritten); new UI under `ade/v2/` | No edit to `workbench/modes.ts`; `modules.spec.ts` testid kept |
| F17 | `!` circle renders with its tooltip, not clickable; click targets land P148 B. History rows (`✓ merged · archived  web-app · api  <title>`) render here from `HistoryEntry` | Matrix §4.1 (`!` targets P148); history list is part of the timeline's `↑ Load history` |

## 2. User decision needed

**U1. Rebase / Queue after dialogs cannot deliver in P145.** The SPEC row asks for repo-named
rebase/queue/force-push dialogs. Force push needs no Claude and ships (F12). Rebase and Queue after
send a message to a Claude TUI session. No v2 launch/send method exists before P147 A (`StartBranch`,
`Send`). No v2 surface shows a TUI terminal before P148 B (Sessions tab). Options:

- **(a) Recommended:** move the Rebase / Queue after Claude dialogs (repo-named templates, editable
  message, push switch, busy check) to P148 B, next to `▶ Start`, which uses the same delivery. P145
  shows the `↓N main`, `↻ <branch>`, `✕ conflict` tags with their tooltips, without Rebase / Queue after
  buttons. Closing step updates the P145/P148 rows and preplan §5 (§9 row).
- (b) Deliver through v1 `adePrepareLaunch` / `adeSend` until P148, with a temporary terminal surface.
  Breaks preplan rule 5's intent and P148's "no v1 callers" premise; double work.
- (c) Pull `StartBranch` / `Send` / `Sessions` into P145 A. Blocked: needs P146's sessions migration
  and worktree-setup gate.

The plan below is written for (a). Under (b) or (c) the orchestrator re-plans §4.4 before B starts.

Preplan O3/O4/O5 need nothing from P145.

## 3. Stream A: workflow editing + watch, repos config, folders, integration and deploy facts

### 3.1 Migration `0009_p145_ade_marks.sql`

Register `{Version: 9, Name: "p145_ade_marks", File: "0009_p145_ade_marks.sql"}` in `embed.go`.

```sql
-- branch tip last seen fully contained in a target / environment (F1); recorded = D14
CREATE TABLE ade_branch_marks (
  branch_id TEXT NOT NULL REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('target','env')),
  name TEXT NOT NULL,
  merged_tip TEXT NOT NULL,
  recorded INTEGER NOT NULL DEFAULT 0 CHECK (recorded IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (branch_id, kind, name)
);
CREATE TABLE ade_env_state (
  code_repo_id TEXT NOT NULL,
  env TEXT NOT NULL,
  sha TEXT NOT NULL DEFAULT '', prev_sha TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL,
  PRIMARY KEY (code_repo_id, env),
  FOREIGN KEY (code_repo_id, env) REFERENCES ade_repo_envs (code_repo_id, name) ON DELETE CASCADE
);
ALTER TABLE ade_repo_config DROP COLUMN prepare_timeout;  -- F2
```

Check the bundled SQLite supports `DROP COLUMN` (≥ 3.35); if not, rebuild the table in the same
migration. `prev_sha` is set when `sha` changes.

### 3.2 Storage

- `model/adetask.go`: `AdeBranchMark`, `AdeEnvState`, `AdeRepoConfigPatch`; drop
  `AdeRepoConfig.PrepareTimeout`.
- `model/gitreposettings.go`: leaf `WorktreePrepareTimeout string` (default `"15m"`), patch field,
  `Validate`: `time.ParseDuration`, `> 0`, `≤ 2h`. `repos/gitreposettings.go`: key
  `worktreePrepareTimeout` read/write like `worktreePrepareScript`.
- `repos/aderepoconfig.go` writes: `Upsert(codeRepoID, patch)` (one tx: config row, integration rows
  dense rewrite, env rows: delete removed names, upsert the rest), `AddFolder`, `SetFolderWatch`,
  `RemoveFolder` (one tx: delete row, `source` → `added` for its repos), `SetSource(codeRepoID, src)`.
  `List` drops the timeout column.
- `repos/adefacts.go` (`AdeFactsRepo`, registered in `repos.New`): marks `Marks(branchIDs)`,
  `UpsertMark`, `DeleteMarksNotIn(kind, codeRepoID, names)` (target/env removed from config);
  env state `EnvStates(codeRepoID)`, `SetEnvState`.

### 3.3 Workflows: write, import, new, validate, watch (`internal/adeflow`)

- `writer.go`:
  - `ValidateYaml(src) adewire.WorkflowValidation` = `Parse` (exactly one of workflow/error).
  - `ReadYaml(dir, file)` → `WorkflowYaml`.
  - `SaveYaml(dir, file, src)` writes any text (F6), returns the `WorkflowEntry` (via `Reader`).
  - `Save(dir, file, wf)`: `wf.ID` must equal the file stem. Load the file into `yaml.Node` (missing
    file → new document); YAML syntax error → `E_INVALID` (F6). `applyWorkflow(doc, wf)`: top keys
    `id`/`name`/`stages`; sequence items matched by `id`, reordered to `wf` order, scalars updated in
    place (head/line/foot comments kept), removed items dropped, new items built in canonical key order
    (`id, name, kind, status`, then kind keys); keys absent before and equal to their default
    (`before: auto`, `on_failure: stop`, `session: false`, empty `allowed_tools`) not added; an existing
    `manual`/`automated` alias kept when its canonical kind is unchanged; multi-line `prompt`/`command`
    as literal `|`. Encode with indent 2, then `Parse` the bytes; any error → `E_INVALID`, nothing
    written.
  - `Import(dir, srcPath)` and `New(dir, name)` per F7.
  - All writes: `MkdirAll(dir, 0o755)` (D2: created on first write), temp file `.<name>.tmp-*` in the
    dir, `rename` (atomic; the reader ignores hidden files). File names
    `^[a-z0-9][a-z0-9_-]*\.yaml$`, no separators.
- `watch.go`: `Watch(dir, onChange func()) (stop func(), err error)` on `fsnotify`. Dir missing →
  watch its parent for `workflows` creation, then switch. Only `*.yaml` events (hidden/temp ignored),
  200ms debounce. `main.go` callback: `Reader.List(nil)` (records last-valid) then emit
  `adeTaskWorkflows`. Writes from the app also emit once (debounce dedupes the watch echo).
- "Changes apply from next stage/step on": `Task.currentStage` snapshot (P144 E6) is untouched by
  saves; no other work here. Stage advance on an edited workflow is P146's step machine.
- Tests (earn the bar: comment/order-preserving rewrite has several interacting rules; watcher is
  concurrency): `writer_test.go` (three design samples with added comments: edit scalar, reorder
  stages, delete step, add step, alias kept, default keys not added, syntax-error refusal, result
  re-parses equal to the struct); `watch_test.go` (create/modify/delete emit once per burst; dir
  created later; temp file ignored; bounded 5s waits, no sleeps-as-sync).

### 3.4 Repos config, folders, prepare timeout

- `internal/codeworkspace/import.go` (F9): `Import(ctx, store, runner, gitPath, path) (model.CodeRepo, error)`
  with sentinels `ErrNotRepo`, `ErrBare`, `ErrLinkedWorktree` (folder scan only), `ErrAlreadyImported`.
  `bridge/codeworkspace.go` `ImportRepo` maps them to today's codes unchanged. Confirm with the Space
  layering test that `ade` may import `codeworkspace`; if not, place it where the layering allows.
- `internal/ade/repoconfig.go` on `TaskBoard`:
  - `UpdateRepo(args)`: nickname (trim, ≤ 40, no newline; `''` = name), integration branches
    (`validateAdeBranchName`, distinct, ≤ 10, not the repo main), environments (name
    `^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$`, distinct, ≤ 10, script non-empty ≤ 4 KiB), prepare script and
    timeout → `GitRepoSettingsRepo` leaves through the same write path `gitrpc` `repoSettings.set` uses
    (its change notification included, so git-ui sees the new script/timeout). Removed targets/envs
    delete their marks. Emits `adeTaskRepos` + `adeTaskBoard`. Returns the `Repo`.
  - `AddFolder(path, watch)`: absolute, existing dir; insert row; scan (F8); import each found repo
    with `source = path`; `FolderImportResult`. `SetFolderWatch`, `RemoveFolder` (F8).
  - `Repos` reads timeout from `GitRepoSettings` (F2).
- `internal/ade/folderwatch.go`: per watched folder, `fsnotify` on the folder and every non-repo dir
  the scan visited; dir create/rename → 500ms debounce → rescan → import new repos → emit
  `adeTaskRepos`. Started for `watch = 1` folders at wiring; stopped by `SetFolderWatch(false)`,
  `RemoveFolder`, `TaskBoard.Close`.
- Prepare timeout (F2, F3): `gitprepare.Spec.Timeout`; `gitsession.RunPrepare` passes
  `RepoSettings().WorktreePrepareTimeout` (parsed; invalid stored value → default, logged) and its
  timeout message names the value.
- Test `folders_test.go` (scan rules interact: depth, stop at repo, hidden, `node_modules`, bare,
  linked worktree, already imported).

### 3.5 Integration and deployment facts (`internal/ade/integration.go`, `deploy.go`)

Git helpers (new, `gitsession/queuefacts.go` + `porcelain`): exported `IsAncestor(a, b)`,
`Cherry(upstream, head, limit)` (`git cherry <upstream> <head> <limit>` → plus/minus counts),
`DiffPatchID(base, tip)` (`git diff <base> <tip>` piped into `git patch-id --stable` via
`Spec.Stdin`), `RecentPatchIDs(ref, n)` (`git log --no-merges -p -n <n> <ref>` piped into
`patch-id --stable`; n = 500), `CountRange`. Read-only; never touch worktree, index, HEAD or refs.

Evaluator `contains(ctx, entry, baseTip, tip, targetTip) (state all|some|none, missing int)`:

1. no own commits (`baseTip..tip` empty) → `none`, `0` (row shows nothing).
2. `IsAncestor(tip, targetTip)` → `all`.
3. `Cherry(targetTip, tip, baseTip)`: all `-` → `all`; some `-` → `some`, `missing` = `+` count.
4. no `-`: `DiffPatchID(baseTip, tip)` ∈ `RecentPatchIDs(targetTip)` (squash) → `all`; else `none`.

Per-repo LRU (existing `hashicorp/golang-lru`): `(baseTip, tip, targetTip)` → result;
`targetTip` → patch-id set.

**Integration** (per `mine` created branch × configured target `T`; `T` resolves
`refs/remotes/<remote>/T`, else `refs/heads/T`; unresolved → `not merged`, note `<T> not found`).
Mark = `ade_branch_marks(branch, 'target', T)`:

| contains | mark | status | note |
|---|---|---|---|
| all | any | `merged` (upsert mark `merged_tip = tip`) | `up to date` |
| some / none | mark, `merged_tip` ancestor of tip | `stale` | `N commits since it was merged` (N = `CountRange(merged_tip, tip)`; 0 → `no longer in <T>`) |
| some / none | mark, `merged_tip` not ancestor | `stale` | `rebased since it was merged` |
| some | no mark | `stale` | `N commits since it was merged` (N = `missing`) |
| none | no mark | `not merged` | `''` |

Rebase rule (preplan "rebase marks merged targets stale"): before row 1, if a mark exists, `tip`
is not a descendant of `merged_tip`, and `tip` is not an ancestor of `T` → `stale`,
`rebased since it was merged`, even when patch-ids all match. `recorded` = mark's `recorded`.
`RecordMerge(branchId, target)` (D14): created `mine` branch, target configured → upsert mark
`merged_tip = tip`, `recorded = 1`; emits board. Nothing else ever sets `recorded`.

**Deployments** (per `mine` created branch × env with a state row): target = state `sha`.
`deployed` on `all`; `stale` on `some`, or when `prev_sha` contained the branch (`all`), `sha` does
not, and `sha` is an ancestor of `prev_sha` (note `<env> moved back to <sha7>`); `not deployed` on
`none`; `unknown` when the state has an `error` or the sha object is missing (`error`
`deployed SHA <sha7> is not in this clone`). `missingCommits` = `missing`. Notes per SPEC2 §6.2
(`runs <sha7>, contains this branch` / `<env> runs <sha7>: N commits of this branch are missing`).
Env marks mirror target marks (kind `env`) for the stale-after-squash case.

**Scripts** (F10): `RunEnvScripts(ctx, codeRepoID)`: per env sequentially, repos in parallel (4);
writes `ade_env_state`. Run: once at startup (goroutine after wiring, repos used by live tasks, then
emit board), in `Refresh` after the fetch for each refreshed repo (chip `↻` = Refresh of one repo).
`Board()` never runs scripts; it reads state rows.

**Refresh summary.** `RepoRefresh.mergedInto` = targets whose mark was inserted or moved to the
current tip during this refresh (newly merged). `refsChanged` unchanged from P144.

**Board.** `computeBranch` fills `integration` (one entry per configured target, config order) and
`deployments` (one per env). Fix-menu data needs no method (P143 §4: derived from `Branch` facts).

**Test** `integration_test.go` (earns the bar: merged/stale/patch-id rules interact; preplan accept):
real temp repos with bare remote, `develop` and `staging`: fast-forward merge, merge commit,
squash merge, cherry-pick subset (stale), new commits after merge, rebase after merge (stale
`rebased`), revert in target (`no longer in`), recorded merge (D14) with no git evidence, deploy
script printing a sha (deployed / partial / moved back / script failure / unknown object), cache
hit spawns nothing, `mergedInto` on refresh.

### 3.6 Bridge and wiring

- `bridge/adetask.go`: the 11 P145 methods (`WorkflowYaml`, `ValidateWorkflowYaml`, `SaveWorkflow`,
  `SaveWorkflowYaml`, `ImportWorkflow`, `NewWorkflow`, `UpdateRepo`, `AddFolder`, `SetFolderWatch`,
  `RemoveFolder`, `RecordMerge`) with arg validation; emit helpers `AdeTaskWorkflowsChanged`,
  `AdeTaskReposChanged` on `adewire.ChannelWorkflows|ChannelRepos`.
- `main.go`: workflows watch, folder watchers, startup env scripts, shutdown stops all.
- `frontend/src/bridge/index.ts`: 11 `adeTask*` entries (types from `../ade/v2/wire`, `trust<T>`
  only) and `onAdeTaskWorkflows`, `onAdeTaskRepos`. Totals after P145: 31 methods, 5 channels.

### 3.7 Commits (Stream A)

Each: pre-commit hook passes normally, plus `gofmt -l` empty, `go build ./...`,
`go vet ./apps/kira-space/...`. Never `--no-verify` to finish.

1. `feat(kira-space): ade facts migration and repo config writes` — 0009, models, repos, prepare
   timeout leaf. Extra: `go test ./apps/kira-space/internal/storage/...`.
2. `feat(kira-space): ade workflow YAML writer, import and new` — `writer.go`, test.
3. `feat(kira-space): watch the ade workflows folder` — `watch.go`, test.
4. `refactor(kira-space): share code repo import` — `codeworkspace/import.go`, bridge caller.
5. `feat(kira-space): per-repo prepare script timeout` — `gitprepare`, `gitsession/worktree.go`.
   Extra: `go test ./apps/kira-space/internal/{gitprepare,gitsession}/...`.
6. `feat(kira-space): ade folders import and watch` — `repoconfig.go`, `folderwatch.go`, test.
7. `feat(kira-space): integration merged and stale facts` — git helpers, `integration.go`,
   `RecordMerge` engine, Refresh `mergedInto`, test.
8. `feat(kira-space): deployment facts from environment scripts` — `deploy.go`, startup/refresh run.
9. `feat(kira-space): AdeTaskService P145 methods and channels` — `adetask.go`, `main.go`, `index.ts`.
10. `docs(v2.0): P145 stream A notes` — `plans/P145-streamA-notes.md` (commits, end checks,
    deviations). Write it incrementally if the stream halts.

### 3.8 Stream A end checks

`go test ./apps/kira-space/...` (gitsock rule §6.4), `go test -race
./apps/kira-space/internal/{ade,adeflow,gitsession}/...`, `bun run lint:go`, `bun run lint:dead`,
`go mod tidy` diff empty, `git diff B0 -- go.mod go.sum package.json bun.lock` empty. Server-tag smoke
(§6.4 recipe, temp home): `NewWorkflow` creates `workflows/`; external edit of the file shows in
`Workflows` and emits; broken edit keeps the last valid; `AddFolder` on a temp folder with two repos
and a linked worktree imports two; `git init` a third with watch on → imported; `UpdateRepo` sets
`develop` + an env script; a squash-merged branch reports `merged`.

## 4. Stream B: shell, Plan timeline, task cards, Add; v1 frontend removed

Imports only `ade/v2/wire.ts` (rule 5), `ade/v2/board/*`, shared stores/components. Consumes only
P144 methods: `Board`, `Prs`, `Refresh`, `ForcePush`, `ProvideCredential`, `CreateTask`,
`CandidateBranches`, `AddExistingBranch`, `SetPlan`, `AddBacklogItem`, `Workflows`, `Repos`; channels
`onAdeTaskBoard`, `onAdeTaskCredential`. Library use: Tailwind utilities (no scoped `<style>`),
shadcn-vue (Tabs, Popover, Tooltip, Badge, Dialog, Input, Textarea, ToggleGroup/Toggle for repo
chips), VueUse (`onKeyStroke`, `useElementSize`, `useLocalStorage`, `useTimeoutFn`), Pinia, TanStack
Query, `vue-draggable-plus`. No new shadcn primitive expected; if one is needed, `shadcn-vue add` into
`packages/theme/src/components/ui/` (B-owned) with no new package.

### 4.1 Data and state

- `ade/v2/queries.ts`: query keys + `useBoard`, `usePrs`, `useWorkflows`, `useRepos`,
  `useCandidates`; mutations `useRefresh`, `useForcePush`, `useCreateTask`, `useAddExistingBranch`,
  `useSetPlan` (optimistic plan update, rollback on error), `useAddBacklogItem`,
  `useProvideCredential`. One subscription: `onAdeTaskBoard` → invalidate board + prs.
- `ade/v2/state/adeBoardUi.ts` (one concern: board view state): `selectedTaskId`,
  `hiddenRepoIds`, `showAllItems`, `showHistory` (F14).
- Repo labels everywhere: `nickname || name` from `Repos`; pickers `nickname · full name`.
- Calendar/day settings: existing `Settings.ade` through the settings store, as v1.

### 4.2 Shell (`ade/AdeView.vue` rewritten, `ade/v2/shell/*`)

- Empty state when `code_repos` is empty (v1's import button kept, `data-testid="ade-view"` kept).
- Tab bar: shadcn Tabs with `Plan` only (Backlog, Needs you, Workflows, Repos land with their pages,
  P146-P148). Right: capture box, then `+ Add task` (opens the Add popover).
- Capture box `+ Add to backlog… (Enter)`: Enter → `AddBacklogItem`, clears, shows
  `added to backlog` ~2s; nothing else changes.
- Credential prompt: port v1's `onAdeCredential` handling to `onAdeTaskCredential` +
  `ProvideCredential` (masked input, cancel = `secret: null`).

### 4.3 Plan view (`ade/v2/plan/*`)

- Header (sticky): `Refresh all` first (→ `Refresh({codeRepoIds: []})`), one chip per `Board.repos`
  entry: name click toggles hide (tasks with no visible branch hide), `<n>m ago` from `lastFetchAt`,
  `↻` → `Refresh([id])`, per-repo error inline. Day controls ported from v1 (go to date, day off).
  Fetch summary text is P146 B.
- Timeline from `board/timeline.ts`: day bands, weekends, days off, capacity/overflow, overdue,
  Later; first 10 items then dashed `↓ Load all items · N more` / `Show only the first 10 again`
  (D4); dashed `↑ Load history · N archived tasks in the last 2 weeks` and history rows (F17).
  Selection highlights the task, ripple outline and the "On merge" line (`timeline.ts` outputs).
- Drag: `vue-draggable-plus` on task cards between days and Later; drop → `SetPlan` (order + day),
  no dialog. Drop arithmetic as a pure `board/dropPlan.ts` if it has more than one interacting rule
  (day, order, Later, hidden items past the cap); unit-test it then.
- Task card (§4.1 geometry: 10px radius, 1px border, 4px left edge task color, review blue, parked
  dashed, ~11% tinted 68px header, 10px gap): line 1 color square · stage progress (segments + label
  + bar/percent, tooltips, from `progress.ts` with the task's workflow from `Workflows`) · `!` circle
  (F17) · muted meta (`[3d → Mon 28 · ]PAY-102 · api · web-app`, truncates first); line 2 title,
  `line-clamp-2`, full title tooltip (`labels.ts` default-title rule).
- Branch rows: line 1 repo label · base marker (`baseMarker.ts`, three variants, tooltip,
  `no branch yet · from <base>`) · `!` (session needs you: none until P146, rendered from data) ·
  owner pill (review) · branch name (`truncate`, tooltip). Line 2 quiet context only (`no branch yet ·
  from main`, PR title for review items); merged/deployed text is P146 B.
- Left action column: task row = derived status tag (`status.ts`, F11). Branch rows = tag + action
  from `actions.ts` first-match; action buttons wired only for Force push (F12); every other tag
  shows with its tooltip and no button (U1 (a)); `⚙ preparing`/`✕ setup failed` text only (See
  error is P147 B); `▶ Start` not rendered (P148 B).
- Long text per SPEC2 §5.2 via Tailwind `truncate`/`line-clamp-2` + shadcn Tooltip.
- Colors: `--kira-*` tokens; task colors from the existing 20-slot palette (P138);
  `scripts/check-ade-colours.sh` allowlist updated (v1 entries pruned, no new literal).

### 4.4 Add popover and Force push

- `ade/v2/AdeAddPopover.vue` (shadcn Popover under the tab bar): **New task** — Title, Jira (link or
  key, parsed by the v1 `jira.ts` helper moved into `ade/v2/`), Repos (toggle chips, ≥ 1, every
  managed repo), Notes → `Add to Later` → `CreateTask` (F13) → select it, Plan tab active.
  **Existing branch** — search over `CandidateBranches` (all repos, newest first: `time · author ·
  repo · branch`) → `AddExistingBranch({taskId: ''})` → select the new task. Attach-to-task mode
  (`adding to: <task>`) lands with the panel's `+ Add branch` in P146 B.
- `ade/v2/AdeForcePushDialog.vue` (shadcn Dialog): `Force push <branch> (repo <nickname>) with
  lease?` → `ForcePush`; `error` shown in the dialog; success closes.
- Rebase / Queue after: per U1 (a), not this wave.

### 4.5 Delete the v1 frontend

"Delete v1 frontend" = every v1 UI file no longer reachable from `index.html`, plus its tests. v1
backend (`AdeService`, v1 `ade/wire.ts`, its `index.ts` entries) stays until P148 A.

- Move (`git mv`, then adapt to v2 wire) only what the v2 UI imports: expected `jira.ts`, `ago.ts`,
  `localDay.ts`, `tones.ts`, `AdeDayControls.vue`, `useTimelineDrag.ts`, credential handling; decide
  by actual imports. Moved files import nothing from v1 `ade/wire.ts`.
- Keep: `ade/wire.ts` (A-owned, P148), `ade/state/agentSessions.ts` (`main.ts`).
- Delete: every other file directly under `ade/` and `ade/state/`; v1 unit specs and support
  (`mockupOracle.ts`, `mockupToWire.ts`) listed in §0; v1 UI specs and `tests/ui/support/ade.ts`;
  v1 `adeX` FQNs, defaults and `emulateAdeRepoPush` in `mockRuntime.ts`/`ipcChannels.ts` that no
  remaining caller uses (`terminalAgentSessions` stays: boot).
- Files P146-P148 reuse and that are deleted now (`AdeNotesEditor.vue`, `notesExtensions.ts`,
  `AdeEstimateField.vue`, `AdePanelResizeHandle.vue`, `AdeChangesTab.vue`, `AdeActivityIcon.vue`,
  `AdeActivityGlyph.vue`, `activity.ts`, `AdeClaudeDialog.vue`, `dialogCompose.ts`, `dialogFlow.ts`,
  `launch.ts`, `turnWatch.ts`, `AdeConfirmDialog.vue`, `ade-notes-markdown.spec.ts`): restore with
  `git show B0:<path>` in the wave that needs them. List them in the B notes with `B0`.
- `bun run lint:dead` must be clean after this commit (no orphan exports or files).

### 4.6 Mock runtime and UI specs (`apps/kira-space/tests/ui/`)

- `support/mockRuntime.ts`: `AdeTaskService.<Method>` FQNs for every P144 method B calls; defaults
  from `tests/fixtures/ade-v2/{board,prs,workflows,repos,candidates}.json`; mutation calls emit
  `kira:adetask:board` (v2 replacement of `emulateAdeRepoPush`).
- `ade-v2-plan.spec.ts`: board fixture renders the first 10 items, `↓ Load all items · N more` and
  back; `↑ Load history`; card header facts + clamped title; base marker variants; branch tags incl.
  `checking…` and `conflict check failed`; repo chip hide/show; `Refresh` args (`[]` and `[id]`);
  credential prompt round trip; drag to another day → one `SetPlan` call with the expected args and
  no dialog; one geometry test (card radius/border/left edge, 68px header, 10px gap) via computed
  style.
- `ade-v2-add.spec.ts`: capture Enter → `AddBacklogItem` + note; New task → `CreateTask` args
  (`workflowId: ''`, chosen repos) and selection; Existing branch search → `AddExistingBranch` args.
- `ade-v2-force-push.spec.ts`: repo-named confirm → `ForcePush` args; error shown.
- `modules.spec.ts` unchanged and green.

### 4.7 Commits (Stream B)

Each: pre-commit hook passes normally; `bun run typecheck`; touched specs run.

1. `feat(kira-space): ade v2 board queries and ui store` — `queries.ts`, `state/adeBoardUi.ts`.
2. `feat(kira-space): ade v2 shell, tab bar and capture box` — `AdeView.vue` rewrite, shell, credential.
3. `feat(kira-space): ade v2 task cards and branch rows`.
4. `feat(kira-space): ade v2 plan timeline, drag, load all and history` (+ `dropPlan` spec if any).
5. `feat(kira-space): ade v2 add popover and force push dialog`.
6. `refactor(kira-space)!: delete the v1 ade frontend and its specs` (§4.5, colours allowlist).
   Extra: `bun run lint:dead`, `bun run test:unit`.
7. `test(kira-space): ade v2 UI specs on the mock runtime` (§4.6).
8. `docs(v2.0): P145 stream B notes` — `plans/P145-streamB-notes.md` (commits, deleted-for-later
   list with `B0`, mockup comparison verdict, deviations).

### 4.8 Stream B end checks

`bun run test:unit`, `bun run lint:all`, `bun run test:ui:space` (webkit + `libavif16` per
`DEV_ENVIRONMENT.md`), mockup comparison (§6.3).

## 5. Streams verdict, ownership, worktrees

**Split holds.** Zero file overlap; no ordering dependency:

- B calls only P144 methods/channels already in `index.ts` and reads only P143 fixtures/types. A's
  11 new methods and 2 channels have no B caller until P146/P147.
- A never touches `frontend/src/ade/**` or tests under `tests/{ui,unit,visual}`; B never touches Go,
  `index.ts`, `go.mod`.
- No contract change in either stream: `Integration`, `Deployment` (`unknown`), `RepoRefresh.mergedInto`,
  `Folder*`, `Workflow*` shapes cover P145. **No serial step 0.** A stream needing a wire change stops
  (preplan §3 rule 1).

| Path | A | B | Closing |
|---|---|---|---|
| `apps/kira-space/internal/**` (incl. `storage/migrations/0009_*.sql`, `embed.go`, `codeworkspace/import.go`, `gitprepare`, `gitsession`) | ✓ | | |
| `apps/kira-space/main.go` | ✓ | | |
| `apps/kira-space/frontend/src/bridge/index.ts` | ✓ | | |
| `go.mod`, `go.sum` (expected unchanged) | ✓ | | |
| `docs/v2.0/plans/P145-streamA-notes.md` | ✓ | | |
| `apps/kira-space/frontend/src/ade/**` except `ade/wire.ts`, `ade/v2/wire.ts`, `ade/state/agentSessions.ts` | | ✓ | |
| `packages/theme/src/components/ui/**` (new primitives only, if any) | | ✓ | |
| `scripts/check-ade-colours.sh` | | ✓ | |
| `apps/kira-space/tests/ui/**`, `tests/unit/ade-*`, `tests/unit/support/{mockupOracle,mockupToWire}.ts` | | ✓ | |
| `docs/v2.0/plans/P145-streamB-notes.md` | | ✓ | |
| `knip.json`, `docs/v2.0/SPEC.md`, this plan's `## Result`, preplan migration numbers, `docs/ARCHITECTURE.md` notes | | | ✓ |

Untouched by both: `ade/wire.ts` (v1), `ade/v2/wire.ts`, `tests/fixtures/ade-v2/**`,
`packages/shared/**`, `workbench/modes.ts`, `main.ts`, `state/**`, `package.json`, `bun.lock`. A
stream that needs any of these stops and reports. P151 (`/home/user/kira-studio-p151-c`, branch
`v2.0-p151-c`) owns `scripts/mutation/**` and may touch `package.json`; P145 touches neither.

Run from `/home/user/kira-studio`, base `B0`:

```sh
git worktree add -b v2.0-p145-a /home/user/kira-studio-p145-a B0
git worktree add -b v2.0-p145-b /home/user/kira-studio-p145-b B0
sh scripts/prepare-dev-environment.sh   # inside each worktree
```

Check each worktree is at `B0`. Orchestrator lands nothing on `v2.0` while streams run (except a
rule-1 amendment). A stopped stream resumes from its last commit, never from scratch. Implementers
call `codegraph_explore` before Read/Grep for any symbol not pinned to a file:line here.

Landing after both streams pass their end checks: `merge --ff-only v2.0-p145-a`; in B's worktree
`git rebase v2.0` (a real conflict = wrong ownership: stop, report); `merge --ff-only v2.0-p145-b`;
wave-end suite (§6.4); closing step (§7); remove worktrees, delete branches, `git push origin v2.0`.

## 6. Acceptance

### 6.1 Stream A (checked by the orchestrator)

- 11 P145 methods bound and in `index.ts` (31 total; `grep -c` both sides = 31); `kira:adetask:workflows`
  and `kira:adetask:repos` emitted from real call sites.
- `RecordMerge` is the only writer of `recorded = 1` (grep). No go-git; `git cherry`/`patch-id` via
  `gitclient` only.
- `gitprepare.PrepareTimeout` gone; `RunPrepare` reads the per-repo leaf (grep a real caller).
- No seeded workflow; `MkdirAll` for `workflows/` only in `adeflow/writer.go` / watcher.
- Contract untouched: `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts apps/kira-space/internal/bridge/adewire apps/kira-space/tests/fixtures/ade-v2 packages/shared` empty.

### 6.2 Stream B

- `ade/AdeView.vue` reaches `ade/v2/wire.ts` and every `board/*.ts` from `index.html` (closing step
  can drop both knip entries and `bun run knip` stays clean).
- No file under `ade/v2/` imports `ade/wire.ts` (grep). No v1 `adeX` call left in `frontend/src`
  except `bridge/index.ts` definitions and `terminalAgentSessions`.
- No scoped `<style>` in new components; no Options API; one store per concern.
- UI specs of §4.6 pass; `check-ade-colours.sh` passes.

### 6.3 Mockup comparison (B end, again at wave end on the landed tip)

Throwaway Playwright Chromium script (scratchpad, not committed), viewport 1440×900: screenshot
`docs/v2.0/design/ade-v2/mockup.html` Plan view, and the built test app (`bun run build:test:space`
output on the mock runtime with `board.json`) Plan view. Read both images; list differences. Expected
and accepted: no panel (P146), no stage action buttons (F11), no Rebase / Queue after buttons (U1),
no line-2 merged/deployed (P146), tabs other than Plan absent, app fonts. Anything else (card
geometry, header facts order, base markers, tags, first-10 cap, spacing, colors off-token) is a
defect fixed before landing. Verdict + image paths in the B notes.

### 6.4 Wave end (landed tip)

- `go build ./...`, `go test ./apps/kira-space/...`, `go test -race
  ./apps/kira-space/internal/{ade,adeflow,gitsession}/...`, `bun run test:unit`, `bun run lint:all`,
  `bun run test:ui:space`. Failures fixed in follow-up commits on `v2.0`.
- **gitsock flake (P152, out of scope).** Never skip, `-run`-exclude or retry-until-green. If
  `internal/gitsock` fails: (1) the failure must match P152's signature (`E_INTERNAL: read |0: file
  already closed`, a different review/comment test per run, passes alone with `-run '^Name$' -count=5`);
  (2) run `go test -count=3 ./apps/kira-space/internal/gitsock/...` on the landed tip and on `B0`
  (scratch worktree) and record both failure counts. Same signature and comparable rate → record as
  P152 in the Result, not fixed here. Any other error text, a deterministic failure, or a clearly
  higher rate than `B0` → P145 regression (A touched `gitsession`/`gitprepare`): root-cause and fix.
- Live smoke (server-tag recipe, `DEV_ENVIRONMENT.md` P126; local `Locate` patch reverted before
  finishing): temp home seeded with `windows('main')` and two scratch repos (one with `develop`, a
  squash-merged branch, an env script); Playwright Chromium on `/?window=main`: Plan renders real
  tasks, Add creates one, drag moves it, Refresh updates the chip, Force push confirm runs; via bound
  calls: workflow save/watch and folder import as in §3.8. Screenshot compared to the mockup (§6.3).

## 7. Closing step (serial subagent, after landing)

- `knip.json`: drop `src/ade/v2/wire.ts` and `src/ade/v2/board/*.ts` entries (P143 W15, P144 §4.3);
  `bun run knip` clean.
- `## Result` here (commits, counts, gitsock record, mockup verdict, licenses: none new,
  deviations); `## P145 result` in `SPEC.md` and row status.
- `SPEC.md` P146 row and preplan §1/§4: `ade_sessions` migration is `0010` (F1). Under U1 (a): P145
  row drops rebase/queue dialogs, P148 row adds them, preplan §5 §9 row updated.
- `docs/ARCHITECTURE.md` short notes: prepare timeout is a per-repo leaf shared by git-ui and ade
  (G25 D12 superseded); integration/deploy facts via `git cherry` + `patch-id` with marks memory;
  workflows dir watched. Full ade rewrite stays P149.
- Remove worktrees; push.

## 8. Carry-forward

- P146 B: subscribe `onAdeTaskRepos` and refresh `state/coderepos.ts` too (folder watch imports in
  the background; Git module list otherwise stale until reload). Add-popover attach mode. Fetch
  summary on the chip (`mergedInto`). Merge dialog calls `RecordMerge` on finish (D14); moved to P148 B (P146 M1).
- P146 A: migration `0010`; ade worktree setup uses `RepoSettings().WorktreePrepareTimeout`;
  stage advance against an edited workflow (snapshot rule).
- P147 B: Workflows page uses `ValidateWorkflowYaml` (debounced) / `SaveWorkflowYaml`;
  `onAdeTaskWorkflows`; F6 error text. Repos page uses P145 methods + `codeWorkspaceImportRepo`.
  Task stage action buttons (F11).
- P148 B (U1 (a)): Rebase / Queue after dialogs from `git show B0:apps/kira-space/frontend/src/ade/
  {AdeClaudeDialog.vue,dialogCompose.ts,dialogFlow.ts,launch.ts,turnWatch.ts}`.

## Result

Streams landed fast-forward on `v2.0` from `13e99974`. Notes: `P145-streamA-notes.md`, `P145-streamB-notes.md`.

**Commits:** 26 from `13e99974` to `886f57db` (A 12, B 10, closing 4: dead code, ARCHITECTURE, SPEC
and preplan, `AddExistingBranch` fix).

**Counts:** 31 `AdeTaskService` methods, 31 `adeTask*` entries; migration `0009`; `test:unit` 1727 pass;
`test:ui:space` 61 pass; `go test -race` on `ade`, `adeflow`, `gitsession` ok; `go build ./...` ok;
`lint:all` exit 0.

**gitsock flake (P152).** Not fixed. Same flake on `B0` and tip.
- Isolated `KIRA_SPACE_HOME`, `go test -count=3 ./apps/kira-space/internal/gitsock/...`: tip fails 1 test
  (`TestIntegration_FileReadBranches`), `B0` fails 2 (`TestIntegration_FileReadBranches`,
  `TestIntegration_ClearRemovesOnlyComments`). Both show `file.read` / `review.comment.add` error
  responses, a different test per run; both pass alone with `-run '^Name$' -count=5`.
  `gitsock` is untouched since `B0`. Comparable rate, so recorded as P152.
- Hang seen once on tip (`TestBroker_QueueBoundedAgainstUnlimitedEnqueue`, 10m timeout) while bun
  lint and typecheck ran concurrently. Not reproduced with `-run Broker -count=20` on tip or `B0`.
- Finding for P152: `gitsock` tests set `KIRA_HOME`, but `storage.Open()` reads `KIRA_SPACE_HOME`.
  Tests that call `storage.Open()` share `~/.kira-space/kira.db` across packages and runs. A `B0`
  worktree run against a DB already migrated to schema 9 fails with `schema_version (9) is newer`.
  Likely contributor to the flake.

**Dead code.** `lint:dead` clean. 11 unused v1 exported types deleted from `ade/wire.ts` with the v1
bridge calls and types only they used (`adeSessions`, `adeRepoSnapshot`, `adeUpdateNewWork`,
`adeSetBranchMeta`, `adeSetWorkType`, `normalizeAdeRepoSnapshot`). The six `@tiptap/*` packages stay
under a temporary `knip.json` ignore until P146's Notes tab. `knip.json` entries `ade/v2/wire.ts` and
`ade/v2/board/*.ts` stay: 14 exports and 83 types have no caller until P146+ (§7 drop deferred).

**Mockup verdict.** Plan view matches `mockup.html` within the accepted list (B notes §Mockup
comparison). Defects found by the pass fixed before landing.

**Live smoke** (server-tag build, temp `KIRA_SPACE_HOME`, local `Locate` patch reverted, two scratch
repos, `git.path` setting seeded, Playwright Chromium on `/?window=main`, screenshot
`scratchpad/smoke/shots/plan.png`): Plan renders real tasks; Add `New task` and `Existing branch` (two
branches) create tasks; Refresh all updates chips; Force push confirm runs and closes; `not pushed` and
`clean` tags render. Found and fixed one real defect: bridge `AddExistingBranch` rejected `taskId: ''`
(new task) with `taskId is required` (`886f57db`). Not run live: drag (covered by UI spec), workflow
save/watch and folder import (covered by engine tests `TestWorkflows_writesAndExternalEdits`,
`TestAddFolder_importsRealReposOnly`, `TestFolderWatch_importsNewRepo`), deploy script state and the
env/integration chips (tests `TestDeployment_scriptStates`, `TestIntegration_*`; no merged chip UI
until P146).

**Licenses:** none new. **Deviations:** see notes files; plus `AdeBranchMetaPatch` family and dead v1
bridge calls removed with the types.
