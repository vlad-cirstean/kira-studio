# P144 plan: ADE v2 wave 1 — task store, workflow reader, board snapshot ‖ pure board logic

Two streams, one `P`. Stream A (Go) and Stream B (frontend pure logic) in separate worktrees off one
base. Implements preplan §4 P144 and the P143 contract's P144 rows. Nothing from P145+.

Inputs: `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P144, §6 D1-D16, O2-O5),
`plans/P143-wire-contract.md` (frozen: `internal/bridge/adewire/{wire,channels}.go`,
`frontend/src/ade/v2/wire.ts`, `tests/fixtures/ade-v2/*.json`), `design/ade-v2/SPEC2.md`,
`design/ade-v2/mockup.html`, `SPEC.md` P144 row. Base `B0`: the commit landing §2.1 step 0 on `v2.0`.

**Status: approved by user, ready to implement.** User decisions recorded in this plan: D1 without
go-git (`git merge-tree` only, §3.4), `only <repo>` syntax-checked at load and validated at run time
(§3.3), `ade_sessions` change moves to P146 (§3.1), rebase conflict shows `✕ conflict` + Rebase while
`base conflict` stays for a conflict on the base itself (§4.1), promoted backlog item gets no workflow
(§3.5), backlog in SQLite (§3.2).

## 0. Findings from the current tree

- v1 `ade.Queue` (`internal/ade/queue.go`) is per-repo and keyed on `model.AdeBranch` rows
  (`Store.Load(codeRepoID)`); its fact pipeline is `Queue` methods (`computeOneBranchFact`,
  `rangeFactsFor`, `computePairFacts`) over a `snapshotContext`. Reusable as-is: package funcs
  `pairFacts`, `orderPair`, `atRisk`, `colorSlot` (`facts.go`), `resolveQueuedRef`, `dirtyCode`,
  `toDirtyEntries` (`queue.go`), and `gitsession.RepoEntry` methods (`BranchInventory`, `MainRef`,
  `DefaultRemote`, `AheadBehind`, `RangeChanges`, `RangeCommits`, `MergeTreeConflicts`,
  `WorktreeStatus`, `ResolveBranchPr`, `PushPreflight`, `RunRemote`, `ConfigValue`).
- `ade_sessions` (0004) has `code_repo_id NOT NULL` FK and `CHECK ((branch = '') <> (new_work_id = ''))`.
  A v2 task-level session needs a table rebuild with a widened CHECK. Nothing writes v2 sessions
  before P146, so that rebuild is P146's migration, not P144's.
- Prepare script and worktree base path are existing per-repo leaves in `git_repo_settings`
  (`GitRepoSettings.WorktreePrepareScript`, keyed by `code_repos.repo_id`), not ade config.
- `repos.ErrEstimateShrink` + `checkEstExtends` (`storage/repos/adequeue.go:427`) is v1's
  extend-only estimate rule (D16).
- v2 `mockup.html` keeps its logic in `renderVals()` closures (lines 1370-2790): step aggregation
  1448-1466, task status 1469-1478, first-10 cap 1864-1886, base marker 1818, branch tag first-match
  ~1830-1850, Needs-you items 2490-2520. Usable as a parity oracle, same mechanism as v1's
  `tests/unit/support/mockupOracle.ts`.
- Calendar arithmetic (`buildCalendar`, `offsetToIso`, `isoToOffset`, weekends, days off, `spanDays`,
  `parseEst`) lives inside v1 `useQueue.ts`, which P145 B deletes.
- knip: `apps/kira-space/frontend` entry is `index.html` + `src/ade/v2/wire.ts`. New
  `src/ade/v2/board/*.ts` files have no `index.html` path until P145, so pre-push `knip` fails on
  them unless listed as entries (same mechanism as P143 W15).
- `go.yaml.in/yaml/v3 v3.0.5` (MIT + Apache-2.0) sits in the module cache; it is `// indirect` in
  `go.mod`. No other new dependency.
- Rebase-conflict check reuses existing code (found via `codegraph_explore`):
  `gitsession.RepoEntry.MergeTreeConflicts(ctx, a, b)` (`gitsession/queuefacts.go:143`: merge base,
  `porcelain.MergeTreeArgs`, `runAllowingExit` 0/1, `porcelain.ParseMergeTreeOutput`; no merge base
  returns clean). `gitclient.RequiredVersion = "2.38.0"` and `Discovery.Status`
  (`gitclient/discovery.go`, kinds `ok|notFound|tooOld|unusable`, cached 30s) already gate the app
  on git >= 2.38.

## 1. Decisions restated (preplan §6) and plan decisions

Implemented here: D1 (`git merge-tree` rebase-conflict check, no go-git), D2 (workflows dir, no seeds), D4 (first-10 cap, B),
D5 (v2 tables start empty, no v1 data migration), D6 (`allowed_tools` schema + validation), D9
(Jira/GitHub stored, no sync), D10 (derived status, B), D13 (`back:` rules, namespaces), D15 (repos =
`code_repos`), D16 (no dependency/work type; estimate extend-only).

| # | Decision | Why |
|---|---|---|
| E1 | v1 tables are **not** dropped in P144. 0008 only adds. P148's migration drops them (preplan §1) | v1 `Queue`/`AdeService` and v1 UI stay live until P145 B / P148 A; dropping now breaks the running app. D5 holds: v2 tables start empty, nothing copied from v1 |
| E2 | v2 engine lives in package `internal/ade`, new type `TaskBoard` (files `board*.go`), its own `gitsession.Conn` (`ade-board`) | Same package reuses unexported fact helpers with no export churn; own Conn means zero edits to `Queue`'s lifecycle, so P148 deletes v1 files whole. Registry refcounts entries, so a second Conn shares the one `RepoEntry` |
| E3 | `rangeFactsFor` becomes a package func `rangeFacts(ctx, entry, caches, parentTip, tip)`; `Queue` calls it | The one fact step both engines need verbatim; moving it beats copying it. Only non-additive v1 edit |
| E4 | Workflows reader: package `internal/adeflow`, `go.yaml.in/yaml/v3` (promoted to direct) decoding into `yaml.Node`, own walk for validation and line numbers | Need node line numbers and strict unknown-key errors; P145 rewrites files through the same `yaml.Node` (comment/order preserving) |
| E5 | Last valid workflow persisted in `ade_workflow_last_valid` (JSON) | SPEC2 §5.1.1 "last valid version stays in use" must survive restart, else a file broken at boot drops every task's workflow |
| E6 | `Task.currentStage` stored as JSON on `ade_tasks.current_stage_json`, set when the task enters a stage | W13 snapshot; tasks keep rendering if the file later breaks |
| E7 | Task color is a column (`ade_tasks.color`), assigned by `colorSlot` at create, never reassigned | One row per task; v1's separate `ade_colors` existed only for its composite item key |
| E8 | `conflictsIfRebased` computed by `git merge-tree --write-tree` (existing `MergeTreeConflicts`) for visible branches after a refresh, cached by `(baseTip, tip)`, bounded concurrency; `Board()` never blocks on it (§3.4) | D1 without go-git: git is the single merge engine; merge-tree never touches worktree, index, HEAD or refs, so it is safe beside running agents |
| E9 | Pair conflicts and rebase conflicts share one git path (`MergeTreeConflicts`); `pairFacts` unchanged | One engine, no equivalence question |
| E10 | No dedicated Go tests for store CRUD; tests only for adeflow validation, the check's cache/failure/version states, and snapshot assembly (§3.6) | CLAUDE.md test bar |
| E11 | Branch wire gains `conflictCheck` (`checking|done|failed`) and `conflictCheckReason`, landed in serial step 0 (§2.1) before the streams | `string[]` alone cannot say "not computed yet" or "failed"; the UI must never read either as "no conflict" |

## 2. Streams verdict and ownership

**Split holds.** Zero file overlap, no ordering dependency:

- B reads only P143 files (`ade/v2/wire.ts`, fixtures) and `state/settingsDomain.ts` types; A adds no
  file B reads.
- A never touches `frontend/src/ade/**` except the A-owned `ade/v2/wire.ts` (edited only in step 0,
  before the split); B never touches Go, `bridge/index.ts`, `go.mod`.
- The only wire change is step 0 (§2.1, E11). A stream needing another stops (preplan §3 rule 1).

| Path | A | B | Closing step |
|---|---|---|---|
| `apps/kira-space/internal/**` (incl. `storage/migrations/0008_*.sql`, `embed.go`) | ✓ | | |
| `apps/kira-space/main.go`, `go.mod` (yaml `// indirect` removed; no go-git), `go.sum` only if `go mod tidy` changes it | ✓ | | |
| `apps/kira-space/frontend/src/bridge/index.ts` | ✓ | | |
| `apps/kira-space/frontend/src/ade/v2/board/**` | | ✓ | |
| `apps/kira-space/frontend/src/ade/useQueue.ts` (calendar import only) | | ✓ | |
| `apps/kira-space/tests/unit/ade-v2-*.spec.ts`, `tests/unit/support/mockupV2Oracle.ts`, `tests/unit/support/adeV2Fixtures.ts` | | ✓ | |
| `knip.json` | | ✓ | |
| `docs/v2.0/SPEC.md` (P144 result + row), this plan's result section, `docs/ARCHITECTURE.md` merge-tree note | | | ✓ |

Not touched by either: `packages/shared/protocol/events.ts` (P143 landed all channels),
`tests/ui/**` (mock FQNs land in P145 B with first consumer), `package.json`/`bun.lock` (no new JS
dependency), `ade/v2/wire.ts` and fixtures (step 0 only).

### 2.1 Worktrees and landing

**Step 0 (serial, one subagent, before the worktrees; preplan §3 rule 1 contract amendment, E11).**
`Branch` gains `conflictCheck: 'checking' | 'done' | 'failed'` and `conflictCheckReason: string`
(`''` unless `failed`). One commit `feat(kira-space): ade v2 conflict-check state on branch wire`
touching `internal/bridge/adewire/wire.go`, `frontend/src/ade/v2/wire.ts`,
`tests/fixtures/ade-v2/board.json` (every branch `done`/`''`, one `checking`, one `failed` with a
reason), the Go decode test, and `plans/P143-wire-contract.md`. `B0` = that commit's `v2.0` tip.

Run from `/home/user/kira-studio`, base `B0`:

```sh
git worktree add -b v2.0-p144-a /home/user/kira-studio-p144-a B0
git worktree add -b v2.0-p144-b /home/user/kira-studio-p144-b B0
sh scripts/prepare-dev-environment.sh   # run inside each worktree (bindings, frontend dist, codegraph)
```

Check each worktree is at `B0` (`git log -1`), not an orphan scaffold (`docs/DEV_ENVIRONMENT.md`).
Orchestrator lands nothing on `v2.0` while streams run (except a rule-1 amendment).

Landing, after both streams pass their own end checks (§3.8, §4.6):

1. `git -C /home/user/kira-studio merge --ff-only v2.0-p144-a`.
2. In B's worktree: `git rebase v2.0`. A real conflict means the ownership table was wrong: stop
   and report.
3. `git -C /home/user/kira-studio merge --ff-only v2.0-p144-b`.
4. On the landed tip: wave-end suite (§5).
5. Closing step (serial subagent): result sections, `SPEC.md` row, ARCHITECTURE note (§5).
6. `git worktree remove` both; `git branch -d v2.0-p144-a v2.0-p144-b`; `git push origin v2.0`.

A stopped stream resumes from its last commit in its worktree, never from scratch.

Implementers: call `codegraph_explore` before Read/Grep for any symbol not already pinned to a
file:line here (CLAUDE.md CodeGraph rule).

## 3. Stream A: task store, workflow reader, snapshot, CRUD

### 3.1 Migration `0008_p144_ade_tasks.sql`

Register `{Version: 8, Name: "p144_ade_tasks", File: "0008_p144_ade_tasks.sql"}` in `embed.go`. Ids
are `uuid.NewString()` (`google/uuid`, already direct). All `*_at` integer epoch ms.

```sql
CREATE TABLE ade_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task','review','parked')),
  title TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  jira_key TEXT NOT NULL DEFAULT '', jira_url TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '',
  workflow_id TEXT NOT NULL DEFAULT '', stage_id TEXT NOT NULL DEFAULT '',
  current_stage_json TEXT,                 -- E6, NULL = none
  est TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  color INTEGER NOT NULL CHECK (color BETWEEN 0 AND 19),
  created_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE TABLE ade_task_branches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',          -- '' = not created
  kind TEXT NOT NULL CHECK (kind IN ('mine','review','parked')),
  base TEXT NOT NULL DEFAULT '',          -- ref short name, '' = repo main
  queued_after TEXT NOT NULL DEFAULT '',  -- branch id
  position INTEGER NOT NULL,              -- order inside the task
  had_commits INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL, merged_at INTEGER, archived_at INTEGER
);
CREATE UNIQUE INDEX ade_task_branches_live_name ON ade_task_branches (code_repo_id, name)
  WHERE name <> '' AND archived_at IS NULL;
CREATE INDEX ade_task_branches_task ON ade_task_branches (task_id);
CREATE TABLE ade_task_plan (
  task_id TEXT PRIMARY KEY REFERENCES ade_tasks (id) ON DELETE CASCADE,
  day TEXT, position INTEGER NOT NULL      -- day NULL = Later
);
CREATE TABLE ade_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL, step_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending','running','stuck','failed','back','done')),
  todo_done INTEGER, todo_total INTEGER, loops INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '', exit_code INTEGER,
  started_at INTEGER, finished_at INTEGER,
  CHECK ((todo_done IS NULL) = (todo_total IS NULL))
);
CREATE INDEX ade_runs_task ON ade_runs (task_id);
CREATE TABLE ade_backlog (
  id TEXT PRIMARY KEY, text TEXT NOT NULL CHECK (text <> ''), position INTEGER NOT NULL,
  jira_key TEXT NOT NULL DEFAULT '', jira_url TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL
);
CREATE TABLE ade_repo_config (
  code_repo_id TEXT PRIMARY KEY REFERENCES code_repos (id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '', prepare_timeout TEXT NOT NULL DEFAULT '10m',
  source TEXT NOT NULL DEFAULT 'added'    -- 'added' | folder path (P145 writes folder imports)
);
CREATE TABLE ade_repo_integration (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (code_repo_id, branch)
);
CREATE TABLE ade_repo_envs (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  name TEXT NOT NULL, deployed_sha_script TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
  PRIMARY KEY (code_repo_id, name)
);
CREATE TABLE ade_folders (path TEXT PRIMARY KEY, watch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ade_worktree_setup (
  branch_id TEXT PRIMARY KEY REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('running','ready','failed')),
  started_at INTEGER NOT NULL, finished_at INTEGER, exit_code INTEGER
);                                         -- log storage + cap: P146 (W10)
CREATE TABLE ade_workflow_last_valid (
  file_name TEXT PRIMARY KEY, workflow_json TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
```

`ade_sessions` is not touched in P144. Its rebuild (task-level columns, widened CHECK, v1 `List`
filter) moves to P146's migration, where the first v2 session writer lands; recorded in preplan §4 P146.
`sqlitex.Migrate` runs each migration in one transaction with `_foreign_keys=1` (DSN).

### 3.2 Models and repos

- `storage/model/adetask.go`: `AdeTask`, `AdeTaskBranch`, `AdeTaskPlanRow`, `AdeRun`,
  `AdeBacklogItem`, `AdeRepoConfig`, `AdeRepoEnv`, `AdeFolder`, `AdeWorktreeSetup`, patch types
  (`AdeTaskPatch`, `AdeBacklogPatch`), `Validate()` per v1 discipline.
- `storage/repos/adetask.go` (`AdeTaskRepo`): tasks, branches, plan, runs (read only this wave),
  setup (read only), last-valid workflows. Methods: `ListLive()`, `ListArchived()`, `GetTask`,
  `CreateTask(task, branches)` (one tx: task row, branch rows, plan row appended at max position with
  day NULL), `UpdateTask(id, patch)` (est via `checkEstExtends`; kind only `task`↔`parked`, review
  refused), `AddBranch(b)`, `BranchesLive()`, `SetPlan(order, days)` (one tx, rewrites positions
  dense in `order`; ids not in `order` keep relative position after it), `SetQueuedAfter`,
  `MarkBranchFacts(hadCommits, merged)` (v1 `MarkFacts` shape), `RunsByTask()`, `SetupByBranch()`,
  `LastValid()/RecordLastValid(file, json)`.
- `storage/repos/adebacklog.go` (`AdeBacklogRepo`): `List`, `Add` (top: position = min-1),
  `Update`, `Move(id, toIndex)` (one tx, dense rewrite), `Delete`, `Promote(id, toTask)` (one tx:
  create task + plan row, delete item).
- `storage/repos/aderepoconfig.go` (`AdeRepoConfigRepo`): `List()` joining `code_repos` with config,
  integration and env rows (missing config row = defaults); folders list. Write methods: P145.
- Register all three in `repos.New`. Sentinel errors (`ErrTaskNotFound`, `ErrBranchOnTask`,
  `ErrRepoOnTask`, `ErrReviewKind`, reuse `ErrEstimateShrink`) map to `E_INVALID`/`E_NOT_FOUND` in the
  bridge.

### 3.3 Workflow reader `internal/adeflow`

- `Dir(home string) string` = `filepath.Join(home, "workflows")`; home = `config.KiraSpaceHome()`.
  Never created by the reader; missing or empty dir = valid empty list (D2). Only regular
  `*.yaml` files, sorted by name; hidden files, dirs, `.yml` ignored.
- `Parse(src []byte) (adewire.Workflow, *adewire.WorkflowError)`: `yaml.Unmarshal` into
  `yaml.Node`. Syntax error: `{line: <yaml line>, message: "unexpected content here (check the indentation)"}`
  (SPEC2 §5.1.1 wording; line parsed from the yaml error, 0 if absent). Semantic errors: `line` =
  offending node's line, message prefixed `stage N: ` / `stage N, step M: ` (1-based). Fixture
  `workflow-validation.json` uses `line: 0` for a semantic error; keep `line: 0` for messages whose
  node is missing (required key absent), node line otherwise.
- Rules (unknown key anywhere = error, keeps typos visible):
  - top: `id` (`^[a-z0-9][a-z0-9_-]*$`, must equal file stem — one file per id, no duplicates), `name`
    non-empty, `stages` non-empty list.
  - stage: `id` (same pattern, unique among stages), `name`, `kind` in `user|agent|script` with
    aliases `manual`→`user`, `automated`→`agent` (only these two; SPEC2 §5.1.1), `status` in the 4
    `TaskStatus` values.
  - user: `session` bool (default false), `prompt` required iff `session: true`; `steps`, `command`,
    `runs_on`, `on_failure`, `timeout` refused.
  - agent: `steps` non-empty; step `id` unique within the stage (D13: own namespace, may equal a
    stage id), `name`, `runs_on` (`once` | `each repo` | `only <repo>`), `before` `auto|approval`
    (default `auto`), `on_failure` `stop|retry 1|retry 2|back:<id>` (default `stop`; `back:` must
    name a step **earlier in the same stage**, D13), `timeout` required, `prompt` required,
    `allowed_tools` optional list (D6). `session`/`command` refused.
  - script: `command` required, `runs_on` required, `on_failure` without `back:` (D13), `timeout`
    required; `steps`/`session`/`prompt` refused.
  - `timeout`: `time.ParseDuration`, > 0, ≤ 24h; stored as written (W5).
  - `only <repo>`: syntax only at load (non-empty after `only `); no repo lookup, so a file stays
    portable between machines with different repo names. Validated against the task's managed repos
    at run time (P146 step machine, preplan §4 P146); B's `progress.ts` treats an unmatched `only`
    as no targets.
  - `allowed_tools`: each entry `^[A-Za-z_][A-Za-z0-9_-]*(\(.+\))?$` or `mcp__<server>__<tool>`
    form, no newline, no duplicates; empty list = none added.
- `Reader{Dir, Store}`: `List(usedBy func(id) int) adewire.WorkflowsResult` reads every file; valid
  → `RecordLastValid(file, json)` if changed; invalid → `workflow` = last valid from store (null if
  never), `error` set (`WorkflowEntry` shape). `Get(id)` returns the effective workflow. No watch,
  no write (P145).
- `adeflow_test.go` (table-driven): every rule above, alias mapping, `back:` to later/same/other
  stage step, stage-id = step-id allowed, line numbers, and the three design samples
  (`docs/v2.0/design/ade-v2/workflows/*.yaml`, read by relative path) parse valid. Earns the bar:
  parser with several interacting rules.

### 3.4 Rebase-conflict check (D1) `internal/ade/rebasecheck.go`

git CLI only, no go-git. `conflictsIfRebased(baseTip, tip)` calls the existing
`gitsession.RepoEntry.MergeTreeConflicts(ctx, baseTip, tip)` (§0): merge base, then
`git merge-tree --write-tree --messages --name-only -z --merge-base=<base> <baseTip> <tip>`, exit 0/1
parsed by `porcelain.ParseMergeTreeOutput`. No new git code. merge-tree never touches worktree, index,
HEAD or refs (it only writes unreachable objects to the object DB), so it is safe next to running
agents. Needs git >= 2.38.

- **Scope.** Visible branch = branch of a live (not archived) task, created (`name <> ''`), resolved
  tip, not merged, any kind: the Plan's set. The first-10 cap is display-only in B and unknown to the
  backend, so capped-out live branches are checked too. Archived, history and merged branches never
  are. Runs after a refresh for the refreshed repos' visible branches, and lazily from `Board()` for
  any visible branch with no cached result.
- **Latest base.** base `''`/main -> `MainRef` tip; base names another live planner branch in the repo
  -> that branch's tip; else `refs/remotes/<defaultRemote>/<base>` if present, else local
  `refs/heads/<base>`; none resolves -> `failed`, reason `base <name> not found`.
- **Cache.** Per-repo `lru.Cache[rebaseKey{baseTip, tip}, []string]` (512, existing
  `hashicorp/golang-lru`). Keys are shas, so a moved base or tip invalidates itself. Only successful
  results are cached; failures are retried on the next refresh.
- **Concurrency.** One board-wide semaphore (4) shared by all repos and all `Refresh` calls; in-flight
  checks deduped by key.
- **States per branch** (wire, step 0): `done` (`conflictsIfRebased` = paths, `[]` = clean),
  `checking` (cache miss, check queued or running), `failed` (`conflictCheckReason` set,
  `conflictsIfRebased` `[]`). `Board()` never blocks on git: hit -> `done`; miss -> `checking` and
  queue the check; each completion emits `adeTaskBoard` through `OnBoard` (v1 debounce). `Refresh`
  awaits its repos' checks after the fetch, so its emit is settled.
- **Git version.** `TaskBoardDeps` gains `GitStatus func(ctx) gitclient.GitStatus` (the app's
  `Discovery.Status`, cached 30s). Every check calls it first. `Kind == "tooOld"` -> `failed`, reason
  `git <detected> is older than <required>; merge-tree --write-tree needs <required>`; other non-`ok`
  kinds -> `failed` with `GitStatus.Reason` (or `git not found`). No merge-tree spawn in either case.
  The app-level git-blocked panel already stops a < 2.38 git at startup; this guards the case where
  git changes under a running app and keeps the failure visible per branch.
- **Failure.** merge-tree spawn error, exit > 1, parse error, missing object -> `failed` with the
  error text (first stderr line). Never mapped to `[]`/`done`.
- **UI** (B, §4.1 `actions.ts`): `checking…`; `✕ conflict` + Rebase with tooltip
  `conflicts with <base> if rebased: <paths>`; `conflict check failed` with the reason in the tooltip.
  `✓ clean` shows only for `done` with no paths.
- **Log.** Every check: `slog.Info("ade rebase check", repo, branch, base, baseTip7, tip7,
  result=clean|conflicts(n)|failed, cached, ms)`; failures `slog.Warn` with the reason.
- **Test** (`board_test.go`, earns the bar: cache/invalidation/failure rules interact): second call
  with the same `(baseTip, tip)` spawns nothing; moving the tip re-checks; `GitStatus` stub `tooOld` ->
  `failed` with the version reason and no spawn; failure not cached; a clean and a conflicting pair on
  real temp repos give `[]` and the conflicted paths.

### 3.5 `TaskBoard` (`internal/ade/board.go`, `board_facts.go`, `board_writes.go`)

`TaskBoardDeps`: `Tasks *repos.AdeTaskRepo`, `Backlog *repos.AdeBacklogRepo`, `RepoConfig
*repos.AdeRepoConfigRepo`, `CodeRepos *repos.CodeReposRepo`, `GitRepoSettings` getter, `Registry`,
`GitPath`, `GitStatus` (§3.4), `Askpass`, `Workflows *adeflow.Reader`, `OnBoard`, `OnBacklog`, `OnCredential`,
`AutofetchMinutes`, `HomeDir`, `Now`. Own Conn `ade-board` (debounced `repo.changed` → `OnBoard`,
v1's 250ms), per-repo mutex for writes and remote ops, per-repo caches (`rangeFacts` LRU, merge-tree
LRU, rebase-check LRU keyed `(baseTip, tip)`).

`Board(ctx) (adewire.Board, error)`:

- Tasks: live tasks in plan order; `runs` from `ade_runs` (empty until P146); `currentStage` from
  E6 JSON; `branchIds` by branch `position`.
- Repos used by live tasks; per repo (errgroup, limit 4): `openRepo`, `BranchInventory`, `MainRef`,
  `DefaultRemote`, `user.email`, worktree list. Per branch: not created → zero facts, `base` =
  stored base or main short name. Created → `resolveQueuedRef`; `owner` = tip author name
  (v1 rule), kind stored at add; `baseBranchId`/`baseOwner` per §3.4 base resolution (`baseOwner`
  '' when that base branch is mine); ahead/behind/files/commits via `rangeFacts(baseTip, tip)`;
  upstream ahead/behind; `dirty` from linked worktree; `mergedIntoMain` = v1 rule (tip ancestor of
  main and `had_commits`, or stored `merged_at`); write-back via `MarkBranchFacts`;
  `conflictsIfRebased` + `conflictCheck` + `conflictCheckReason` (§3.4, cache read only); `setup` from `ade_worktree_setup` (null if none); `integration` and
  `deployments` `[]` (no targets/envs until P145 config writes).
- `pairs`: per repo, `pairFacts` over that repo's created branches (ids = branch ids; kind mapping
  task `mine`/`review`/`parked`), merge-tree LRU as v1.
- `plan`: `day`/`order` from `ade_task_plan`; `queuedAfter` from branches; `unpushed` = v1 rule
  (`upstream <> '' && upstreamAhead > 0 && upstreamBehind > 0`) keyed by branch id.
- `history`: archived tasks (`codeRepoIds` from their branches, `mergedAt` = max branch
  `merged_at` if all merged else null). Empty until P147 archives.
- `repos`: `RepoState` per used repo (`lastFetchAt` from `FETCH_HEAD` mtime, v1).
- `worktreeBasePath` = `filepath.Join(userHome, "wt")` (SPEC2 §9 path rule; P146 creates
  worktrees); `autofetchMinutes` from setting.
- All slices/maps built with `make` (W4).

Other P144 methods (P143 §4 rows marked P144):

- `Prs`: `ResolveBranchPr` per created branch (errgroup 4), `RepoPrs.kind`/`webUrl` per used repo.
- `Refresh(codeRepoIds)`: `[]` = every repo used by live tasks. Per repo (sequential per repo mutex,
  repos in parallel, limit 4): v1 fetch path (`RunRemote` fetch prune), `refsChanged` over task
  branches + main (v1 `countRefsChanged` logic over branch names), PR-merge check marks `merged_at`,
  then run the rebase-conflict checks for that repo's visible branches and wait for them (§3.4), `mergedInto`
  `[]` (P145), per-repo `error`. Emit `adeTaskBoard` once at the end.
- `ForcePush(branchId)`: v1 per-branch body (remote from upstream, `PushPreflight`, `RunRemote
  forcePush` with lease), no protected confirm (contract has none: preflight's refusal returns as
  `error`).
- `ProvideCredential`: askpass broker answer, same as v1; prompts go to `adeTaskCredential`.
- `CreateTask(args)`: title or Jira key required; `codeRepoIds` ≥ 1, distinct, existing; workflow
  `''` or an effective workflow id (else `E_INVALID`); `stageId` = first stage id, `currentStage`
  snapshot; kind `task`; color via `colorSlot` over live tasks; one not-created branch per repo
  (kind `mine`, base `''`); plan row Later at end. Emits board.
- `UpdateTask`: `TaskPatch` (null = unchanged, `clearJira`), est extend-only, kind `task`↔`parked`.
- `AddTaskRepo`: refuses a repo the task already has a branch in; adds not-created branch.
- `CandidateBranches`: every `code_repos` repo (errgroup 4), local + remote-only branches not on a
  live task and not the repo main, newest first; `mine` = author email = `user.email`.
- `AddExistingBranch(codeRepoId, name, taskId)`: branch must resolve and not be on a live task.
  `taskId ''` → new task: kind `review` if not mine (owner = author) else `task`, title `''`,
  workflow `''`, plan Later at end. Else attach to that live task. Branch kind mine/review by author.
- `SetPlan(order, days)`: every id a live task; days ISO `YYYY-MM-DD` or null (Later).
- `SetQueuedAfter(branchId, afterBranchId)`: same repo, not self, no cycle; `''` clears.
- Backlog: `Backlog`, `AddBacklogItem` (top), `UpdateBacklogItem`, `MoveBacklogItem`,
  `DeleteBacklogItem`, `PromoteBacklogItem` (task: title = text, Jira, GitHub, notes, no repos,
  no workflow, the user picks one on the task later, Later). Backlog writes emit `adeTaskBacklog`; promote emits both.
- `Workflows`: `adeflow.Reader.List` with `usedBy` = live tasks per workflow id.
- `Repos`: `ReposResult` from `AdeRepoConfigRepo.List` + `prepareScript` from
  `GitRepoSettings.WorktreePrepareScript`, `usedByTasks`, `name` = `code_repos.name`.

Arg validation lives on adewire arg types' new `Validate()` methods in `bridge` (W: adding methods
is not a contract change, P143 §3), using v1's size/format helpers (`validateAdeName`,
`validateAdeNotes`, `validateAdeJira`, `validateAdeISODate`, `validateAdeBranchName`, `validateAdeEst`).

### 3.6 Bridge and wiring

- `internal/bridge/adetask.go`: `AdeTaskService{Board *ade.TaskBoard}` with the 20 P144 methods,
  results converted to `adewire` types; `adeTaskError` maps sentinels. Emit helpers
  `AdeTaskBoardChanged`, `AdeTaskBacklogChanged`, `AdeTaskCredentialRequested` on
  `adewire.Channel*`.
- `main.go`: `wireAdeTask(...)` builds `TaskBoard`, registers `AdeTaskService`; shutdown closes its
  Conn.
- `frontend/src/bridge/index.ts`: `adeTask<Method>` entries for the 20 methods and
  `onAdeTaskBoard`, `onAdeTaskBacklog`, `onAdeTaskCredential`, types from `../ade/v2/wire`, `trust<T>`
  only (no normalizers, W4).
- `board_test.go` (`ade` package, temp git repos via v1 `queue_test.go` harness helpers): base
  resolution (main / other task's branch / someone else's branch → `baseBranchId`, `baseOwner`),
  not-created branch, merged via ancestor, `conflictsIfRebased` populated after `Refresh` on a
  bare-remote setup, pairs keyed by branch id. Earns the bar: snapshot assembly with interacting
  base/kind/merge rules.

### 3.7 Commits (Stream A)

Each commit: pre-commit hook (`bun run lint`, `bun run typecheck`) passes normally, plus `gofmt -l`
empty, `go build ./...`, `go vet ./apps/kira-space/...`. Never `--no-verify` to finish.

1. `feat(kira-space): ade v2 task store migration and repos` — 0008, models, three repos. Extra: `go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/ade/...`.
2. `feat(kira-space): ade v2 workflow YAML reader` — `internal/adeflow`, yaml promoted to direct,
   test.
3. `refactor(kira-space): share rangeFacts between queue engines` — E3.
4. `feat(kira-space): merge-tree rebase-conflict check` — `rebasecheck.go` (cache, semaphore, version gate, log).
5. `feat(kira-space): ade v2 task board snapshot and refresh` — `board.go`, `board_facts.go`,
   `board_test.go`.
6. `feat(kira-space): ade v2 task, plan and backlog writes` — `board_writes.go`.
7. `feat(kira-space): AdeTaskService bridge and wiring` — `bridge/adetask.go`, `main.go`, `index.ts`.

### 3.8 Stream A end checks

`go test ./apps/kira-space/...`, `go test -race ./apps/kira-space/internal/ade/...`,
`bun run lint:go`, `bun run lint:dead`, `go mod tidy` diff empty. Migration up on a copy of a real
v1 `kira.db` (the dev home's DB if present, else one made by running the pre-P144 build): app starts,
v1 sessions still listed, v2 tables empty. `git diff B0 -- go.sum` lists any module gained; each
must be OSI-approved (read its `LICENSE` in the module cache), expected none. Manual check of the
three UI states on a real repo: a clean branch, a conflicting branch, and `GitStatus` forced `tooOld`.

## 4. Stream B: pure board logic (`frontend/src/ade/v2/board/`)

Pure TS functions over P143 wire types; no Vue, DOM, stores. VueUse: nothing applies (no
browser/DOM concern). Pinia: the `adeBoardUi` store (selection, show/hide repos, `showAllItems`,
`showHistory`) lands in P145 B with its UI; P144 functions take those values as plain inputs. Imports
only `../wire` (v2) and `state/settingsDomain.ts` types, never v1 `ade/wire.ts` (rule 5).

### 4.1 Files

- `calendar.ts`: moved from `useQueue.ts` — `buildCalendar`, `offsetToIso`, `isoToOffset`,
  `isoToDays`, weekend/day-off/`nextWork`/`firstWork`, `dayLabel`, `spanDays`, `parseEst`, `LATER`.
  `useQueue.ts` imports them (behavior unchanged; v1 parity specs must stay green). P145 deleting
  v1 then deletes nothing shared.
- `timeline.ts`: `buildTimeline(input)` → per-task start day, span (estimate via `parseEst`,
  workday hours, span share), end day (merge day), merge order (merge day, start day, plan
  position), per-day hours/capacity/overflow, overdue, weekends/days off, Later bucket, history list
  (archived in window, `↑ Load history · N archived tasks in the last 2 weeks` count), first-10 cap
  (D4: first 10 items in plan order incl. review items; days after the 10th hidden; `hiddenCount`;
  `showAllItems` input; collapse only when shown > 10; mockup 1864-1886), review item placed right
  above the first task that builds on it (base) or conflicts with it (pairs), parked excluded from
  merge order, ripple (tasks whose branches must rebase when the selected task merges: base or
  queued-after chains, plus shared-file pairs merging later) and the "On merge" line text.
- `progress.ts`: step state per (step, branch) = latest-attempt run (W12); step state = worst of
  runs (stuck > failed > running/back > pending; done when all done; SPEC2 §2); targets per
  `runsOn` (`once` = first branch in task order, D12; `each repo` = mine branches; `only <nick>`);
  stage segments (green done, amber current, red if a step stuck/failed, grey todo; agent wider);
  current label (`Spec`, `Implement 2/5`, `Done`); percent = mean over steps of mean over targets
  (done 1, running `todo[0]/todo[1]`, else 0); bar tooltip per step/repo; workflow tooltip
  (`Standard feature: ✓ Spec (user) › ▸ Implement (agent) › …`); per-branch progress line
  (`<step> n/m`, `· stuck`, `· failed`, `· waiting`, `↩ sent back`, `· fix N`, `<stage> ✓`).
- `status.ts`: derived status (D10, SPEC2 §5): finished → `Done`; any run stuck/failed or any
  branch setup failed → `Blocked`; first stage and nothing started → `To do`; else current stage's
  `status`. Type `DerivedStatus = TaskStatus | 'Blocked'` lives here (not on the wire, W8). Read-only
  panel text `Blocked · follows the workflow: a step is stuck or failed`.
- `actions.ts`: task stage action first-match (SPEC2 §4.2, incl. Archive only when finished) and
  branch tag/action first-match (`not created` · `⚙ preparing <elapsed>` · `✕ setup failed` +
  See error · `✓ merged` · `not merging` · review `✕ conflict`/`review` · `✕ conflict` + Queue after
  · `↑ not pushed` + Force push · `↓N main` + Rebase · `↻ <branch>` + Rebase (never for a base that
  is someone else's branch) · `⏳ <owner>` · `base behind`/`base conflict` · `checking…` ·
  `conflict check failed` · `✓ clean`; plus `▶ Start` flag when the branch never had a session).
  `CI failing` omitted (D9: no CI badge). `conflictCheck === 'done'` with non-empty
  `conflictsIfRebased` feeds the `✕ conflict` slot with action Rebase and tooltip
  `conflicts with <base> if rebased: <paths>`. `base conflict` stays for a conflict on the base
  branch itself. `checking` -> `checking…` (no action); `failed` -> `conflict check failed`,
  tooltip = `conflictCheckReason`; neither ever renders `✓ clean`. The mockup has no such states, so
  parity fixtures use `done` only.
- `baseMarker.ts`: `⑂` (base in same task), `⑂ <base without first path segment>` grey (other
  task), blue (someone else's), tooltip `starts from <base> (<owner>'s branch), not main`, not
  created → `no branch yet · from <base>`; nothing when base is main (mockup 1818).
- `labels.ts`: integration short labels (`develop`→`dev`, `staging`→`stg`, `release`→`rel`, else
  name), `▲<env>` with stale tone, line-2 order (context · merged · divider · deployed), tooltips;
  long-text helpers that are logic (default title rule: title, else Jira key, else PR title, else
  branch name, else `New task`; stage label truncation is CSS, not here).
- `needsYou.ts`: items from Board + Sessions + Prs: `stuck run` (red, Take over), `failed` (red,
  Retry), `question` (amber, Open; TUI session activity `input`), `approval` (amber, Approve; next
  step `before: approval` and previous done), `setup failed` (red, See error), `stale merge` (grey,
  Re-merge); order = kind rank as listed, then oldest first; footer counts (`N background runs ·
  M interactive sessions`; `waiting on CI` dropped, D9); badge count = item count (mockup 2490-2520).

### 4.2 Tests (`apps/kira-space/tests/unit/`)

- `support/adeV2Fixtures.ts`: loads `tests/fixtures/ade-v2/<name>.json` via `fs` and casts to the
  wire type (JSON imports widen string unions; the Go decode test already guards shape).
- `support/mockupV2Oracle.ts`: runs `docs/v2.0/design/ade-v2/mockup.html` `renderVals()` in
  `node:vm`, v1 `mockupOracle.ts` mechanism, `TZ=UTC`.
- `ade-v2-board-parity.spec.ts`: for every fixture task/branch, B's status, stage label + percent,
  task action, branch tag/action, base marker, and the Needs-you list (kinds + order) equal the
  oracle's rendered values. Earns the bar: two first-match tables plus status/progress precedence
  are too large to hold in one's head; the oracle caught drift in v1 (P129 Part 3).
  If `renderVals()` cannot run headless for v2, fall back to expected values transcribed from the
  mockup per fixture id, and record why in the result.
- `ade-v2-timeline.spec.ts`: merge order ties, multi-day spans across weekends/days off,
  capacity overflow, overdue, Later, first-10 boundary (exactly 10, 11, review item at 10th slot,
  days after the 10th hidden), ripple. Earns the bar: calendar/boundary arithmetic.
- `ade-v2-progress.spec.ts`: averaging over steps × repos with `todo` null/partial, `once` vs
  `each repo` vs `only`, latest-attempt selection, worst-of precedence incl. `back`. Earns the bar:
  aggregation with interacting rules.
- No tests for `baseMarker.ts`, `labels.ts`, `calendar.ts` move (covered by v1 parity specs).

### 4.3 knip

`knip.json` `apps/kira-space/frontend.entry` gains `"src/ade/v2/board/*.ts"` with a one-line
comment (consumed from `index.html` once P145 B's UI imports it; drop the entry then, P145 serial
step, same as W15).

### 4.4 Commits (Stream B)

Each commit: pre-commit hook passes normally; `bun test apps/kira-space/tests/unit` for touched
specs.

1. `refactor(kira-space): move ade calendar helpers to v2 board` — `calendar.ts`, `useQueue.ts`
   imports, `knip.json` entry. Extra: v1 `ade-*` unit specs green, `bun run lint:dead`.
2. `feat(kira-space): ade v2 timeline logic` — `timeline.ts`, `ade-v2-timeline.spec.ts`.
3. `feat(kira-space): ade v2 stage progress and derived status` — `progress.ts`, `status.ts`,
   `ade-v2-progress.spec.ts`.
4. `feat(kira-space): ade v2 action rules, base marker, labels` — `actions.ts`, `baseMarker.ts`,
   `labels.ts`.
5. `feat(kira-space): ade v2 Needs-you derivation` — `needsYou.ts`.
6. `test(kira-space): ade v2 board parity against the mockup` — oracle, fixtures loader, parity spec.

### 4.5 Library notes (B)

None new. Considered and declined: `date-fns`/`dayjs` (calendar is integer day offsets already
proven by v1 parity; a date lib would not remove the custom weekend/day-off logic).

### 4.6 Stream B end checks

`bun run test:unit`, `bun run typecheck`, `bun run lint`, `bun run lint:dead`.

## 5. Wave end and closing step

On the landed tip: `go test ./apps/kira-space/...`, `bun run test:unit`, `bun run lint:all`,
`go build ./...`, `bun run test:ui:space` (v1 UI must be unaffected by the 0008 migration).
Failures fixed in follow-up commits on `v2.0`.

Closing subagent (serial, after landing): `## Result` in this plan (commits, counts, manual
conflict-state check, license list, deviations), `## P144 result` in `docs/v2.0/SPEC.md` and the
row status, and a short `docs/ARCHITECTURE.md` note under the ade queue paragraph: rebase-conflict
check uses `git merge-tree` (git >= 2.38); go-git stays declined. Full ade section rewrite stays
P149.

## 6. Acceptance (checked once at phase end)

- Every P144 method in P143 §4 (20) is bound in `AdeTaskService`, has an `index.ts` entry, and
  returns data decodable into `adewire` (count check: `grep -c` of methods vs 20).
- `adeTaskBoard`, `adeTaskBacklog`, `adeTaskCredential` emitted from Go (grep for real call sites).
- Migration 0008 applies on a real v1 DB copy; v2 tables empty; v1 sessions still readable.
- Workflows dir under `KiraSpaceHome()/workflows`, not created by reads, no seeded file in the repo
  or binary (`grep -r "standard.yaml" apps/kira-space` finds no embed).
- Rebase-conflict check: `grep -rn 'go-git' go.mod apps/kira-space` empty; a real caller of
  `MergeTreeConflicts` from `rebasecheck.go`; board shows `checking`, `done`, `failed` per §3.4; every
  check logged; `checking…`/`✕ conflict`/`conflict check failed` handled in `actions.ts`.
- B: every §4.1 file exists and is imported by at least one spec or by another board file; knip
  clean; v1 parity specs green.
- `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts apps/kira-space/tests/fixtures/ade-v2 packages/shared` empty (contract untouched).

## 7. User decisions (resolved)

- `only <repo>` in workflow YAML: syntax-checked at load, validated against managed repos at run time
  (§3.3).
- `ade_sessions` extension: moves to P146's migration (§3.1).
- go-git: dropped; `git merge-tree` only (§3.4). Needs git >= 2.38, detected through
  `Discovery.Status` and surfaced per branch.
- Rebase-conflict tag: `✕ conflict` + Rebase; `base conflict` stays for a conflict on the base itself
  (§4.1).
- Promoted backlog item: no workflow; the user picks one on the task (P147 `SetTaskWorkflow`).
- Backlog storage: SQLite (preplan O2 confirmed).
- Preplan O3, O4, O5 need nothing from P144 (wire stays permissive for O3).

## 8. Room for the later "Review code" phase (not planned here)

No columns added for it (no unused scaffolding). P144 choices that keep room: branch ids are
synthetic and stable across rename/rebase, so a later `ade_branch_reviews (branch_id, session_id,
reviewed_at_sha, …)` table and per-file viewed state keyed `(branch_id, path, blob_sha)` attach
without touching 0008; branch rows are archived, never deleted, so review history survives task
archive; `ade_sessions` gets `branch_id` and `mode` in P146, so a persistent per-branch review agent can be
a session row (widening the `mode` CHECK then needs one more table rebuild, a known cost).
