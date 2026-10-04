# P144 plan: ADE v2 wave 1 — task store, workflow reader, board snapshot ‖ pure board logic

Two streams, one `P`. Stream A (Go) and Stream B (frontend pure logic) in separate worktrees off one
base. Implements preplan §4 P144 and the P143 contract's P144 rows. Nothing from P145+.

Inputs: `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P144, §6 D1-D16, O1-O5),
`plans/P143-wire-contract.md` (frozen: `internal/bridge/adewire/{wire,channels}.go`,
`frontend/src/ade/v2/wire.ts`, `tests/fixtures/ade-v2/*.json`), `design/ade-v2/SPEC2.md`,
`design/ade-v2/mockup.html`, `SPEC.md` P144 row. Base: the commit landing this plan on `v2.0`.

## 0. Findings from the current tree

- v1 `ade.Queue` (`internal/ade/queue.go`) is per-repo and keyed on `model.AdeBranch` rows
  (`Store.Load(codeRepoID)`); its fact pipeline is `Queue` methods (`computeOneBranchFact`,
  `rangeFactsFor`, `computePairFacts`) over a `snapshotContext`. Reusable as-is: package funcs
  `pairFacts`, `orderPair`, `atRisk`, `colorSlot` (`facts.go`), `resolveQueuedRef`, `dirtyCode`,
  `toDirtyEntries` (`queue.go`), and `gitsession.RepoEntry` methods (`BranchInventory`, `MainRef`,
  `DefaultRemote`, `AheadBehind`, `RangeChanges`, `RangeCommits`, `MergeTreeConflicts`,
  `WorktreeStatus`, `ResolveBranchPr`, `PushPreflight`, `RunRemote`, `ConfigValue`).
- `ade_sessions` (0004) has `code_repo_id NOT NULL` FK and `CHECK ((branch = '') <> (new_work_id = ''))`.
  A v2 task-level session has neither, so adding columns alone is not enough: the table must be
  rebuilt with a widened CHECK. `AdeSessionsRepo.List()` is unfiltered and feeds v1 `Sessions()`.
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
- go-git `v5.19.2` (Apache-2.0) and `go.yaml.in/yaml/v3 v3.0.5` (MIT + Apache-2.0) sit in the
  module cache; yaml is `// indirect` in `go.mod`, go-git absent. go-git v5 has
  `Commit.MergeBase`, `Commit.IsAncestor`, `object.DiffTreeWithOptions` (rename detection) and
  `utils/diff` (line diff via `sergi/go-diff`, MIT, already its own dependency). No three-way
  content merge.

## 1. Decisions restated (preplan §6) and plan decisions

Implemented here: D1 (go-git conflict check), D2 (workflows dir, no seeds), D4 (first-10 cap, B),
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
| E8 | `conflictsIfRebased` computed in the snapshot for every visible branch, cached by `(baseTip, tip)` LRU; `Refresh` warms it for its repos before emitting `adeTaskBoard` | "After every refresh, every visible branch" (D1) holds by construction; repeat snapshots cost a cache hit |
| E9 | Pair conflicts keep `git merge-tree` (`pairFacts` unchanged) | D1 limits go-git to the rebase-conflict check |
| E10 | No dedicated Go tests for store CRUD; tests only for adeflow validation, the conflict check, and snapshot assembly (§3.6) | CLAUDE.md test bar |

## 2. Streams verdict and ownership

**Split holds.** Zero file overlap, no ordering dependency:

- B reads only P143 files (`ade/v2/wire.ts`, fixtures) and `state/settingsDomain.ts` types; A adds no
  file B reads.
- A never touches `frontend/src/ade/**` except the A-owned `ade/v2/wire.ts` (not edited in P144);
  B never touches Go, `bridge/index.ts`, `go.mod`.
- No wire change is planned. A stream needing one stops (preplan §3 rule 1).

| Path | A | B | Closing step |
|---|---|---|---|
| `apps/kira-space/internal/**` (incl. `storage/migrations/0008_*.sql`, `embed.go`) | ✓ | | |
| `apps/kira-space/main.go`, `go.mod`, `go.sum` | ✓ | | |
| `apps/kira-space/frontend/src/bridge/index.ts` | ✓ | | |
| `apps/kira-space/frontend/src/ade/v2/board/**` | | ✓ | |
| `apps/kira-space/frontend/src/ade/useQueue.ts` (calendar import only) | | ✓ | |
| `apps/kira-space/tests/unit/ade-v2-*.spec.ts`, `tests/unit/support/mockupV2Oracle.ts`, `tests/unit/support/adeV2Fixtures.ts` | | ✓ | |
| `knip.json` | | ✓ | |
| `docs/v2.0/SPEC.md` (P144 result + row), this plan's result section, `docs/ARCHITECTURE.md` go-git note | | | ✓ |

Not touched by either: `packages/shared/protocol/events.ts` (P143 landed all channels),
`tests/ui/**` (mock FQNs land in P145 B with first consumer), `package.json`/`bun.lock` (no new JS
dependency), `ade/v2/wire.ts`, fixtures.

### 2.1 Worktrees and landing

Run from `/home/user/kira-studio`, base `B0` = this plan's commit on `v2.0`:

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

`ade_sessions` rebuild (SQLite cannot alter a CHECK): create `ade_sessions_new` with v1 columns plus
`mode TEXT NOT NULL DEFAULT 'tui' CHECK (mode IN ('tui','headless'))`, `task_id`, `branch_id`,
`stage_id`, `step_id`, `run_id`, `resumes` (all `TEXT NOT NULL DEFAULT ''`); `code_repo_id`
nullable (FK kept); CHECK becomes
`(task_id = '' AND code_repo_id IS NOT NULL AND (branch = '') <> (new_work_id = '')) OR (task_id <> '' AND branch = '' AND new_work_id = '')`.
`INSERT INTO ade_sessions_new (v1 cols) SELECT v1 cols FROM ade_sessions` (keeps v1 rows working for
the still-live v1 UI; not a v2 data migration), drop old, rename, recreate `ade_sessions_repo`, add
index on `task_id`. `sqlitex.Migrate` runs each migration in one transaction with
`_foreign_keys=1` (DSN). No table references `ade_sessions`, so drop + rename is safe under enforced
FKs; the copied rows satisfy the `code_repos` FK already.

v1 `AdeSessionsRepo.List`/`ListByRepo`/`StopAllRunning` gain `WHERE task_id = ''` so v1 never sees
v2 rows; `scanAdeSessionRow` scans the new columns into `model.AdeSession` (new fields `Mode`,
`TaskID`, `BranchID`, `StageID`, `StepID`, `RunID`, `Resumes`; `CodeRepoID` read via
`sql.NullString`). Writers of v2 rows arrive in P146. See U2.

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
  - `only <repo>`: non-empty after `only `; matched against managed repos — see U1.
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

### 3.4 Rebase-conflict check (D1, O1) `internal/ade/rebasecheck.go`

`conflictsIfRebased(repo *git.Repository, baseTip, tip string) ([]string, error)`, plain merge
check of `tip` into `baseTip`, built on go-git v5 plumbing:

1. Commits via `repo.CommitObject`. `tip` ancestor of `baseTip`, or `baseTip` ancestor of `tip` →
   `[]`. `MergeBase` empty (unrelated) → `[]` (matches v1 `MergeTreeConflicts`).
2. More than one merge base (criss-cross): git merges the bases into a virtual base; this check
   does not. It uses the first base `MergeBase` returns. The differential test has a criss-cross
   case; a mismatch there escalates under O1.
3. `object.DiffTreeWithOptions(ctx, base, ours/theirs, &DiffTreeOptions{DetectRenames: true})` for
   both sides (git's default rename detection, 50% score).
4. Per path, classify: changed one side only → clean; both sides same resulting (mode, blob) →
   clean; modify/delete, add/add with different blobs, file/directory, rename/rename to different
   paths, rename vs delete, mode-only disagreement → conflict; both modified text → content check;
   either side binary (NUL in first 8000 bytes, git's heuristic) and blobs differ → conflict.
5. Content check: line diffs base→ours and base→theirs (`utils/diff.Do`, line mode), collect each
   side's changed base-line ranges, conflict when a range from one side overlaps or is adjacent to
   (touches) one from the other side (git xdiff merge treats touching hunks as a conflict).
   Insertions at the same base position on both sides with different text conflict.
6. Paths reported repo-relative, sorted, both-sides' names for renames.

Wiring: `TaskBoard` keeps one `*git.Repository` per repo opened with
`git.PlainOpenWithOptions(root, &git.PlainOpenOptions{DetectDotGit: true, EnableDotGitCommonDir: true})`
over `filesystem.NewStorage(..., cache.NewObjectLRU(8 * cache.MiByte))` (bounded memory per repo),
reopened on error; results in a per-repo `lru.Cache[mergeTreeKey, []string]` (512, existing
`hashicorp/golang-lru`). Visible branch = live task, created (`name <> ''`), resolved tip, not
merged, any kind. Latest base: base `''`/main → `MainRef` tip; base names another live planner
branch in the repo → that branch's tip; else `refs/remotes/<defaultRemote>/<base>` if present, else
local `refs/heads/<base>`, else `[]` with `slog.Warn`. Error from go-git (missing object in a
partial clone, SHA-256 repo) → see U3.

**Verification against `git merge-tree --write-tree` (O1).** `rebasecheck_test.go`, differential:

- Builder makes temp repos with the `git` CLI (`git -c user.name=t -c user.email=t@t`), one case
  each: disjoint files; same file, distant hunks; overlapping hunks; adjacent-line hunks; identical
  change both sides; insert at same spot; modify/delete; add/add same and different; binary both
  changed; mode change vs content change; rename + modify other side; rename/rename; file vs
  directory; criss-cross merge base; unrelated histories; ancestor either way.
- Seeded random cases (fixed seed, 300 iterations): one 40-line text file, each side applies 1-4
  random line edits (replace/insert/delete).
- Oracle per case: `git merge-tree --write-tree --name-only --no-messages <baseTip> <tip>` (git's
  own base selection), conflicted paths = output lines after the tree id, exit 1 = conflicts.
  Assert set equality with `conflictsIfRebased`. Skip with a clear message if `git` < 2.38.
- Opt-in real-history run: `ADE_REBASECHECK_REPO=<path>` compares every local branch tip against
  `MainRef` tip in that repo; `t.Skip` when unset. Run once at A's end against
  `/home/user/kira-studio` and paste the one-line count into the result.

Gate: zero mismatches on the fixed and random sets. A mismatch the implementer cannot fix in the
check (criss-cross is the expected candidate) → **stop, record the failing cases in this plan's
result section, orchestrator asks the user** before any fallback to `merge-tree` for this check.
Never fall back silently.

### 3.5 `TaskBoard` (`internal/ade/board.go`, `board_facts.go`, `board_writes.go`)

`TaskBoardDeps`: `Tasks *repos.AdeTaskRepo`, `Backlog *repos.AdeBacklogRepo`, `RepoConfig
*repos.AdeRepoConfigRepo`, `CodeRepos *repos.CodeReposRepo`, `GitRepoSettings` getter, `Registry`,
`GitPath`, `Askpass`, `Workflows *adeflow.Reader`, `OnBoard`, `OnBacklog`, `OnCredential`,
`AutofetchMinutes`, `HomeDir`, `Now`. Own Conn `ade-board` (debounced `repo.changed` → `OnBoard`,
v1's 250ms), per-repo mutex for writes and remote ops, per-repo caches (`rangeFacts` LRU, merge-tree
LRU, rebase-check LRU).

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
  `conflictsIfRebased` (§3.4); `setup` from `ade_worktree_setup` (null if none); `integration` and
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
  then compute `conflictsIfRebased` for that repo's visible branches (warms E8 cache), `mergedInto`
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
  workflow per U5, Later). Backlog writes emit `adeTaskBacklog`; promote emits both.
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

1. `feat(kira-space): ade v2 task store migration and repos` — 0008, models, three repos, v1
   sessions filter. Extra: `go test ./apps/kira-space/internal/storage/... ./apps/kira-space/internal/ade/...`.
2. `feat(kira-space): ade v2 workflow YAML reader` — `internal/adeflow`, yaml promoted to direct,
   test.
3. `refactor(kira-space): share rangeFacts between queue engines` — E3.
4. `feat(kira-space): go-git rebase-conflict check` — go-git direct, `rebasecheck.go` + test.
5. `feat(kira-space): ade v2 task board snapshot and refresh` — `board.go`, `board_facts.go`,
   `board_test.go`.
6. `feat(kira-space): ade v2 task, plan and backlog writes` — `board_writes.go`.
7. `feat(kira-space): AdeTaskService bridge and wiring` — `bridge/adetask.go`, `main.go`, `index.ts`.

### 3.8 Stream A end checks

`go test ./apps/kira-space/...`, `go test -race ./apps/kira-space/internal/ade/...`,
`bun run lint:go`, `bun run lint:dead`, `go mod tidy` diff empty. Migration up on a copy of a real
v1 `kira.db` (the dev home's DB if present, else one made by running the pre-P144 build): app starts,
v1 sessions still listed, v2 tables empty. Opt-in real-history rebase-check run (§3.4). License
check of every module `go.sum` gained (read each `LICENSE` in the module cache; every one must be
OSI-approved, no non-commercial/enterprise terms); list them in the result.

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
  is someone else's branch) · `⏳ <owner>` · `base behind`/`base conflict` · `✓ clean`; plus
  `▶ Start` flag when the branch never had a session). `CI failing` omitted (D9: no CI badge).
  `conflictsIfRebased` non-empty feeds the `✕ conflict` slot with action Rebase and tooltip
  `conflicts with <base> if rebased: <paths>` (D1 "existing conflict tags"); see U4.
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
`go build ./...`, `bun run test:ui:space` (v1 UI must be unaffected by the 0008 migration and the
sessions filter). Failures fixed in follow-up commits on `v2.0`.

Closing subagent (serial, after landing): `## Result` in this plan (commits, counts, O1 verdict with
the differential numbers, license list, deviations), `## P144 result` in `docs/v2.0/SPEC.md` and the
row status, and a short `docs/ARCHITECTURE.md` note under the ade queue paragraph: go-git now used
for the rebase-conflict check only (D1), merge-tree stays for pairs. Full ade section rewrite stays
P149.

## 6. Acceptance (checked once at phase end)

- Every P144 method in P143 §4 (20) is bound in `AdeTaskService`, has an `index.ts` entry, and
  returns data decodable into `adewire` (count check: `grep -c` of methods vs 20).
- `adeTaskBoard`, `adeTaskBacklog`, `adeTaskCredential` emitted from Go (grep for real call sites).
- Migration 0008 applies on a real v1 DB copy; v2 tables empty; v1 sessions still readable.
- Workflows dir under `KiraSpaceHome()/workflows`, not created by reads, no seeded file in the repo
  or binary (`grep -r "standard.yaml" apps/kira-space` finds no embed).
- Rebase-conflict differential test: 0 mismatches; real-history run count recorded.
- B: every §4.1 file exists and is imported by at least one spec or by another board file; knip
  clean; v1 parity specs green.
- `git diff B0 -- apps/kira-space/frontend/src/ade/v2/wire.ts apps/kira-space/tests/fixtures/ade-v2 packages/shared` empty (contract untouched).

## 7. User decisions needed (ask before the affected commit; do not invent)

- **U1. `only <repo>` in workflow YAML.** Plan default: valid only if it matches a managed repo's
  nickname or name, else a validation error (keeps the last valid version). Alternative: syntax
  only, unknown repo targets nothing at run time (more portable when sharing YAML with colleagues
  whose nicknames differ). Affects A commit 2.
- **U2. `ade_sessions` extension timing.** The P144 row includes it; nothing writes v2 sessions until
  P146. Plan default: do it now (table rebuild + v1 filter). Alternative: move it to P146's
  migration, where its first writer lands. Affects A commit 1.
- **U3. go-git cannot read a repo** (partial clone missing objects, SHA-256 object format). Plan
  default: that repo's `conflictsIfRebased` stays `[]` and a warning is logged. Alternative: fall
  back to `git merge-tree` for that repo only (O1 says a merge-tree fallback needs your OK).
- **U4. Rebase-conflict tag.** Plan default: `conflictsIfRebased` shows as `✕ conflict` + Rebase
  (tooltip names base and paths), in the existing `✕ conflict` slot. Alternative: show it as
  `base conflict`. Affects B commit 4.
- **U5. Promoted backlog item's workflow.** SPEC2 §11.1 says "creates a task in Spec", but D2 ships
  no default workflow. Plan default: workflow `''` (none) until the user picks one (P147
  `SetTaskWorkflow`). Alternative: an app setting for a default workflow id (new setting, P145+).
- Still-open preplan items: **O2** (backlog in SQLite) is assumed here; confirm before A commit 1.
  **O1** resolved by §3.4's gate. **O3**, **O4**, **O5** need nothing from P144 (wire stays
  permissive for O3).

## 8. Room for the later "Review code" phase (not planned here)

No columns added for it (no unused scaffolding). P144 choices that keep room: branch ids are
synthetic and stable across rename/rebase, so a later `ade_branch_reviews (branch_id, session_id,
reviewed_at_sha, …)` table and per-file viewed state keyed `(branch_id, path, blob_sha)` attach
without touching 0008; branch rows are archived, never deleted, so review history survives task
archive; `ade_sessions` gets `branch_id` and `mode`, so a persistent per-branch review agent can be
a session row (widening the `mode` CHECK then needs one more table rebuild, a known cost).
