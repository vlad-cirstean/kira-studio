# P143 plan: ADE v2 wire-contract freeze

Serial phase. Freezes the Go and TS wire shapes, the bound-method list and push channels for
P144-P148, plus fixtures and one Go decode test. No behavior, no bound service, no stubs.

Inputs: `plans/P143-ade-v2-preplan.md` (§3 rules, §4 P143, §6 D1-D16, O1-O5),
`design/ade-v2/SPEC2.md` (§2, §5.1.1, §5.1.2, §12), `design/ade-v2/mockup.html` (mock data,
lines 1084-1230). Base `e76cec5`.

## 0. Findings from the current tree

- v1 Go wire types live in package `bridge` (`internal/bridge/ade.go`): 40+ `Ade*` types
  (`AdeBranchWire`, `AdePr`, `AdePlanWire`, `AdeCommit`, `AdeFile`, `AdeDirty`, `AdeJira`,
  `AdeRefreshResult`, `AdeForcePushResult`, ...). v2 names in the same package would collide until
  P148 deletes v1.
- v1 TS wire `frontend/src/ade/wire.ts` is hand-written; `bridge/index.ts` casts results with
  `trust<T>()` and patches `null` slices in `normalizeAdeRepoSnapshot`. Generated bindings
  (`frontend/bindings/`) are gitignored (`apps/kira-space/.gitignore:4`).
- Push channel strings: Go constants (`bridge/events.go`, `ChannelAde*`), TS
  `CHANNEL` map in `packages/shared/protocol/events.ts` (shared package, all files are knip entries).
- Mock UI runtime maps bridge keys to `<Service>.<Method>` FQNs
  (`tests/ui/support/mockRuntime.ts` `CHANNEL_TO_FQN`, e.g. `AdeService.SetPlan`).
- **knip blocks an unconsumed `ade/v2/wire.ts`.** Space frontend workspace entry is `index.html`
  only (`knip.json`). Probe run: a lone `src/ade/v2/wire.ts` fails `bun run knip` with
  `Unused files (1)`. Listing it as a workspace entry passes (verified, then reverted). `knip` runs
  in the pre-push hook (`.githooks/pre-push`).
- Biome checks JSON (`biome.json` includes `**`), so fixtures must be Biome-formatted.
- `Settings.ade` already exists (Go `model.AdeSettings`, zod `adeSettingsSchema`): panel width,
  horizon/history days, day overrides, workday hours, span share. v2 reuses it (SPEC2 §4: days work
  as in SPEC.md).

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W1 | Go wire types go in a new package `apps/kira-space/internal/bridge/adewire`, not `bridge/adev2_wire.go` | Zero collision with v1's `Ade*` types during P144-P147; final names need no rename after P148. Test still under `go test ./apps/kira-space/internal/bridge/...` (preplan accept) |
| W2 | Type names = SPEC2 §12 nouns, no prefix (`adewire.Task`, TS `Task` in `ade/v2/wire.ts`) | Package/module scope already disambiguates; traceable to SPEC2 |
| W3 | New bound service `AdeTaskService` (P144 A creates it in `bridge/adetask.go`). Bridge keys `adeTask<Method>`; mock FQN `AdeTaskService.<Method>` | v1 `AdeService` stays bound until P148; separate service lets P148 delete v1 whole |
| W4 | Every field always present on the wire. Nullable = Go pointer **without** `omitempty` = TS `T \| null`. No `omitempty` anywhere. Slices/maps never `nil` (builders `make`) | One rule both sides; round-trip test can enforce it; no `normalize*` helpers in `index.ts` |
| W5 | Instants: `int64` epoch ms, keys end `At`. Days: ISO `YYYY-MM-DD` string. Durations: YAML string as written (`15m`, `2h`) | v1 convention (`startedAt: number`); durations stay round-trippable to YAML |
| W6 | Repo identity on the wire is `codeRepoId` (`code_repos.id`, D15). SPEC2's `repo: string` becomes `codeRepoId`; nickname lives on `Repo` | One repo list shared with Git module |
| W7 | Workflow vocabulary follows the YAML (§5.1.1), camelCased: `session`, `runsOn`, `before: 'auto'\|'approval'`, `onFailure`, `allowedTools`. Kinds canonical only (`user`/`agent`/`script`; reader maps `manual`/`automated`) | YAML is canonical (D2); §12's `tui`/`scope`/`gate`/`onFail` names were draft aliases |
| W8 | Task `status` not on the wire (D10, derived in P144 B). No dependency, work-type or top-5 fields (D16, D4) | Preplan |
| W9 | `Jira` is `{ key, url }` only (D9: no sync, so no title/status) | Preplan D9 |
| W10 | Logs (run output, setup log, headless stream) are not inline in `Board`; read by `ReadLog` and pushed as chunks | Board stays small; logs bounded per run (P146 sets cap) |
| W11 | Sessions are their own list (`Sessions()`), not nested in `Branch` | Activity changes often; matches v1 `Sessions()` + invalidation channel |
| W12 | One `Run` row per attempt (`attempt` 1-based); UI shows the latest per (stage, step, branch) | §7 `· N runs`, Sessions tab lists all runs |
| W13 | `Task.currentStage` snapshots the stage in effect | P145 A rule: workflow edits apply from next stage/step; UI must render the stage the runs belong to |
| W14 | All v2 channel names land now: Go consts in `adewire/channels.go`, TS in `CHANNEL` | Removes `packages/shared/protocol/events.ts` from every wave's ownership |
| W15 | `knip.json` gains `src/ade/v2/wire.ts` as a Space frontend entry | Real requirement: pre-push `knip` fails on an unconsumed contract file (§0). Entry is removed in the P145 post-landing docs/serial step, once `index.html` reaches `ade/v2/wire.ts` through P145 B's UI |
| W16 | `AdeSettings` (D6 setting) = new leaf `Settings.ade.headlessSettingSources: 'user' \| 'all'` on the existing settings surface (`SettingsService`, `kira:settings:changed`). Name/values frozen here; **P146 A lands it** (Go `model.AdeSettings`, `repos/settings.go` read/upsert/validate, zod `adeSettingsSchema`) with the default it picks (O5). `user` = `--setting-sources user`; `all` = `--setting-sources user,project,local` | A leaf needs a default and storage path now, and O5 leaves the default open. A parallel `AdeSettings` wire type would duplicate the existing settings wire. P146 plan assigns `state/settingsDomain.ts` to Stream A |
| W17 | Permissive where O3 is open (below) | Wire cannot pre-empt an unanswered user question |

### Open items affecting the contract (preplan §6)

- **O2 (assumed: backlog in SQLite).** Backlog has its own bound methods and an invalidation channel
  `adeTaskBacklog` for cross-window sync. If the user picks browser storage instead, those methods
  and the channel go (rule-1 amendment).
- **O3 (unspecified: parked toggle, review with many branches).** Wire is permissive:
  `Task.kind` and `Branch.kind` carry all three values; a `review` task may hold any number of
  branches; `UpdateTask` accepts `kind: 'task' | 'parked'` (review fixed at add). Where the toggle
  shows in UI is P146 B's call once O3 is answered. Nothing narrower is frozen.
- **O4 (assumed: `{jira}` = key only).** No wire effect: `Jira` keeps `key` and `url`; substitution
  is server-side (P146 A).
- O1, O5: no wire effect beyond W16.

## 2. Files and ownership

One sequential implementer owns all of these (§7).

| Path | Action |
|---|---|
| `apps/kira-space/internal/bridge/adewire/wire.go` | create: every type in §3 (package doc comment: frozen at P143, rule 1) |
| `apps/kira-space/internal/bridge/adewire/channels.go` | create: channel consts (§5) |
| `apps/kira-space/internal/bridge/adewire/wire_test.go` | create: the one test (§6.2) |
| `apps/kira-space/tests/fixtures/ade-v2/*.json` | create: 23 fixtures (§6.1) |
| `apps/kira-space/frontend/src/ade/v2/wire.ts` | create: TS mirror (§3) |
| `packages/shared/protocol/events.ts` | add v2 entries to `CHANNEL` (§5) |
| `knip.json` | add `"src/ade/v2/wire.ts"` to `apps/kira-space/frontend` `entry` with a one-line comment (W15) |
| `docs/v2.0/plans/P143-wire-contract.md`, `docs/v2.0/SPEC.md` | result section + row status (last commit) |

Not touched: `bridge/index.ts` (gains `adeTask*` entries with each method's wave, A-owned),
`main.go`, migrations, `tests/ui/**` mock maps (B adds per wave), settings files (W16).

## 3. Types

TS below is authoritative for JSON keys and value sets. Go mirrors it in `adewire`:

- Go type name = TS name. Go field = key with first letter upper-cased, acronyms upper (`id`→`ID`,
  `codeRepoId`→`CodeRepoID`, `url`→`URL`, `githubUrl`→`GithubURL`, `runIds`→`RunIDs`,
  `pr`→`PR`). Every field has an explicit `json:"<key>"` tag, never `omitempty` (W4).
- `string` unions → `string` (doc comment lists the values). `number` → `int`; `*At` keys → `int64`.
  `T | null` → `*T`. `[number, number] | null` → `*[2]int`. `T[]` → `[]T`.
  `Record<string, T>` → `map[string]T`.
- Doc comments: one line per type, only where the key alone does not say it (CLAUDE.md comments
  rule). No methods in P143. Adding `Validate()` methods later is not a contract change; changing a
  key, type or value set is (preplan rule 1).

```ts
// ---- shared
export interface Jira { key: string; url: string }
export interface FileChange { path: string; added: number | null; deleted: number | null; binary: boolean }
export interface Commit { sha: string; message: string }
export interface DirtyEntry { code: string; path: string }
export interface RemoteOpError { kind: string; message: string; remoteMessage: string | null }

// ---- repos (§6.3, D15)
export interface Environment { name: string; deployedShaScript: string }
export interface Repo {
  codeRepoId: string; name: string /* code_repos.name */; nickname: string /* '' = use name */;
  path: string; source: string /* 'added' | folder path */; usedByTasks: boolean;
  integrationBranches: string[] /* besides main */; prepareScript: string; prepareTimeout: string;
  environments: Environment[];
}
export interface Folder { path: string; watch: boolean; repoCount: number }
export interface ReposResult { repos: Repo[]; folders: Folder[] }
export interface FolderImportResult { folder: Folder; imported: string[] /* codeRepoIds */ }

// ---- workflows (§5.1.1, D2, D6, D13)
export type StageKind = 'user' | 'agent' | 'script';
export type TaskStatus = 'To do' | 'In progress' | 'In review' | 'Done';
export type RunsOn = 'once' | 'each repo' | `only ${string}` /* nickname */;
export type OnFailure = 'stop' | 'retry 1' | 'retry 2' | `back:${string}` /* earlier step id, same stage */;
export interface PipelineStep {
  id: string; name: string; runsOn: RunsOn; before: 'auto' | 'approval'; onFailure: OnFailure;
  timeout: string; prompt: string; allowedTools: string[] /* D6, [] = none added */;
}
export interface Stage {
  id: string; name: string; kind: StageKind; status: TaskStatus;
  session: boolean; prompt: string;             // user ('' / false otherwise)
  steps: PipelineStep[];                        // agent ([] otherwise)
  command: string; runsOn: RunsOn | ''; onFailure: OnFailure | ''; timeout: string; // script ('' otherwise; script onFailure never back:, D13)
}
export interface Workflow { id: string; name: string; stages: Stage[] }
export interface WorkflowError { line: number /* 0 = not line-specific */; message: string }
export interface WorkflowEntry {
  fileName: string /* stable key */; path: string;
  workflow: Workflow | null /* last valid version; null if never valid */;
  error: WorkflowError | null /* current file's error */; usedBy: number;
}
export interface WorkflowsResult { dir: string; workflows: WorkflowEntry[] }
export interface WorkflowYaml { fileName: string; path: string; yaml: string }
export interface WorkflowValidation { workflow: Workflow | null; error: WorkflowError | null } // exactly one non-null

// ---- branch facts (§2, §6, §6.1, §6.2, D1, D14)
export interface WorktreeSetup {
  state: 'running' | 'ready' | 'failed'; startedAt: number; finishedAt: number | null; exitCode: number | null;
}
export interface Deployment {
  env: string; deployedSha: string; checkedAt: number;
  status: 'deployed' | 'stale' | 'not deployed' | 'unknown' /* unknown: script failed, see error */;
  missingCommits: number; note: string; error: string;
}
export interface Integration {
  target: string; status: 'merged' | 'stale' | 'not merged'; note: string;
  recorded: boolean /* D14: app's merge dialog recorded it */;
}
export interface PR { number: number; title: string; state: string; url: string }
export interface Branch {
  id: string; taskId: string; codeRepoId: string;
  name: string /* '' until created */; kind: 'mine' | 'review' | 'parked'; owner: string;
  base: string /* ref name */; baseBranchId: string /* '' if base is not a planner branch */;
  baseOwner: string /* '' if base is mine */;
  tip: string; ahead: number; behind: number;
  upstream: string; upstreamAhead: number; upstreamBehind: number;
  mergedIntoMain: boolean; mergedAt: number | null; worktree: string /* '' none */;
  setup: WorktreeSetup | null /* null until a worktree exists */;
  integration: Integration[] /* one per configured target */; deployments: Deployment[];
  conflictsIfRebased: string[] /* D1: paths conflicting if rebased onto latest base */;
  files: FileChange[]; commits: Commit[]; commitCount: number; dirty: DirtyEntry[];
  lastCommitAt: number | null; addedAt: number;
}
export interface Pair { a: string; b: string /* branch ids */; shared: string[]; conflicts: string[] }

// ---- runs, tasks, plan (§2, §4, §5, §12, D7, D10, D12, D16)
export type RunState = 'pending' | 'running' | 'stuck' | 'failed' | 'back' | 'done';
export interface Run {
  id: string; taskId: string; stageId: string; stepId: string /* script stage: stage id */;
  branchId: string /* once: first branch, D12 */; attempt: number; state: RunState;
  todo: [number, number] | null; loops: number /* send-back round */;
  note: string; summary: string /* finish_step summary */; sessionId: string /* '' for script */;
  exitCode: number | null; startedAt: number | null; finishedAt: number | null;
}
export interface Task {
  id: string; kind: 'task' | 'review' | 'parked'; title: string /* '' = default title */; owner: string;
  jira: Jira | null; githubUrl: string;
  workflowId: string /* '' = none */; stageId: string /* stage id | 'done' | '' */;
  currentStage: Stage | null /* W13 */;
  est: string /* '' none; extend-only, D16 */; notes: string /* Markdown */; color: number;
  branchIds: string[]; runs: Run[]; createdAt: number;
}
export interface Plan {
  day: Record<string, string> /* taskId -> ISO date; absent = Later */; order: string[] /* taskIds */;
  queuedAfter: Record<string, string> /* branchId -> branchId */; unpushed: Record<string, boolean>;
}
export interface HistoryEntry { taskId: string; title: string; codeRepoIds: string[]; mergedAt: number | null; archivedAt: number }
export interface RepoState { codeRepoId: string; mainName: string /* '' unresolved */; remote: string; lastFetchAt: number | null }
export interface Board {
  tasks: Task[]; branches: Branch[]; plan: Plan; pairs: Pair[]; history: HistoryEntry[];
  repos: RepoState[] /* repos used by tasks only, §3 */; worktreeBasePath: string; autofetchMinutes: number;
}
export interface RepoPrs { codeRepoId: string; kind: 'ok' | 'disabled' | 'unavailable'; webUrl: string }
export interface PrsResult { repos: RepoPrs[]; branches: Record<string, PR> /* branchId */ }

// ---- backlog (§11.1, O2)
export interface BacklogItem { id: string; text: string; addedAt: number; jira: Jira | null; githubUrl: string; notes: string }
export interface BacklogResult { items: BacklogItem[] /* order = priority */ }

// ---- add / refresh / archive results
export interface CandidateBranch { codeRepoId: string; name: string; author: string; lastCommitAt: number; remoteOnly: boolean; mine: boolean }
export interface CandidateBranchesResult { branches: CandidateBranch[] /* newest first */ }
export interface AddExistingBranchResult { task: Task; branch: Branch }
export interface MergedInto { branchId: string; target: string }
export interface RepoRefresh { codeRepoId: string; refsChanged: number; mergedInto: MergedInto[]; error: RemoteOpError | null }
export interface RefreshResult { repos: RepoRefresh[] }
export interface ForcePushResult { branchId: string; error: RemoteOpError | null }
export interface BranchRisk { branchId: string; worktree: string; dirty: DirtyEntry[]; unmerged: number; blocked: string }
export interface ArchiveRisk { taskId: string; branches: BranchRisk[] }

// ---- runs, logs, sessions (§5, §5.1.2, §7, D3)
export interface StartRunResult { runIds: string[] }
export type LogKind = 'run' | 'setup';
export interface LogChunk { seq: number; at: number; stream: 'stdout' | 'stderr' | 'event'; text: string }
export interface LogPage { kind: LogKind; id: string; chunks: LogChunk[]; nextSeq: number; done: boolean; truncated: boolean }
export interface Session {
  id: string; claudeSessionId: string; mode: 'tui' | 'headless'; state: 'running' | 'stopped';
  activity: '' | 'input' | 'working' | 'waiting' | 'idle' /* headless; TUI comes from agent events */;
  terminalId: string /* tui */; taskId: string; branchId: string /* '' = task-level */;
  stageId: string; stepId: string; runId: string /* headless */; resumes: string /* headless claude id */;
  cwd: string; cwdMissing: boolean; startedAt: number; lastActiveAt: number;
}
export interface SessionsResult { sessions: Session[] }
export interface Launch { terminalId: string; sessionId: string; command: string; cwd: string }

// ---- push payloads
export interface RunsChangedEvent { runs: Run[] }
export interface LogEvent { kind: LogKind; id: string; chunks: LogChunk[] }
export interface CredentialRequest { requestId: string; codeRepoId: string; prompt: string; masked: boolean }
export interface OpenSessionEvent { taskId: string; branchId: string; sessionId: string }
```

Arg types (Go `adewire`, TS same file; all keys required, nullable as above):

```ts
export interface CreateTaskArgs { title: string; jira: Jira | null; githubUrl: string; notes: string; codeRepoIds: string[]; workflowId: string }
export interface TaskPatch { title: string | null; jira: Jira | null; clearJira: boolean; githubUrl: string | null; est: string | null; notes: string | null; color: number | null; kind: 'task' | 'parked' | null }
export interface UpdateTaskArgs { taskId: string; patch: TaskPatch }   // null field = unchanged
export interface AddTaskRepoArgs { taskId: string; codeRepoId: string }
export interface AddExistingBranchArgs { codeRepoId: string; name: string; taskId: string /* '' = new task */ }
export interface SetPlanArgs { order: string[]; days: Record<string, string | null> /* null = Later */ }
export interface SetQueuedAfterArgs { branchId: string; afterBranchId: string /* '' = clear */ }
export interface RefreshArgs { codeRepoIds: string[] /* [] = every repo used by tasks */ }
export interface BranchArgs { branchId: string }
export interface ProvideCredentialArgs { requestId: string; secret: string | null /* null = cancel */ }
export interface AddBacklogItemArgs { text: string }
export interface BacklogPatch { text: string | null; jira: Jira | null; clearJira: boolean; githubUrl: string | null; notes: string | null }
export interface UpdateBacklogItemArgs { id: string; patch: BacklogPatch }
export interface BacklogItemArgs { id: string }
export interface MoveBacklogItemArgs { id: string; toIndex: number }
export interface FileNameArgs { fileName: string }
export interface SaveWorkflowArgs { fileName: string; workflow: Workflow }
export interface SaveWorkflowYamlArgs { fileName: string; yaml: string }
export interface ValidateWorkflowYamlArgs { yaml: string }
export interface ImportWorkflowArgs { path: string }
export interface NewWorkflowArgs { name: string }
export interface RepoPatch { nickname: string | null; integrationBranches: string[] | null; prepareScript: string | null; prepareTimeout: string | null; environments: Environment[] | null }
export interface UpdateRepoArgs { codeRepoId: string; patch: RepoPatch }
export interface FolderArgs { path: string; watch: boolean }
export interface PathArgs { path: string }
export interface RecordMergeArgs { branchId: string; target: string }
export interface StartRunArgs { taskId: string; branchNames: Record<string, string> /* branchId -> name, '' = Claude picks */; message: string }
export interface StepArgs { taskId: string; stageId: string; stepId: string }
export interface RunArgs { runId: string }
export interface TaskArgs { taskId: string }
export interface ReadLogArgs { kind: LogKind; id: string; afterSeq: number }
export interface TakeOverArgs { sessionId: string; stopIfRunning: boolean /* false on a running run = E_INVALID, D3 */ }
export interface LaunchStageArgs { taskId: string; message: string }
export interface StartBranchArgs { branchId: string; message: string }
export interface SetTaskWorkflowArgs { taskId: string; workflowId: string }
export interface SendArgs { sessionId: string; message: string }
export interface FocusSessionArgs { sessionId: string; taskId: string }
```

Errors: `ipcerr`
`E_INVALID` (bad args, wrong state), `E_NOT_FOUND` (unknown id), `E_GIT_UNAVAILABLE`, internal —
v1's codes, no new code.

## 4. Bound methods (`AdeTaskService`)

Bridge key `adeTask<Method>`; mock FQN `AdeTaskService.<Method>`. "Wave" = phase whose Stream A
lands the Go method and its `index.ts` entry. B consumes a method only from the wave after.

| Method | Args | Result | Wave |
|---|---|---|---|
| `Board` | — | `Board` | P144 |
| `Prs` | — | `PrsResult` | P144 |
| `Refresh` | `RefreshArgs` | `RefreshResult` (`mergedInto` empty until P145) | P144 |
| `ForcePush` | `BranchArgs` | `ForcePushResult` | P144 |
| `ProvideCredential` | `ProvideCredentialArgs` | `boolean` | P144 |
| `CreateTask` | `CreateTaskArgs` | `Task` (Later) | P144 |
| `UpdateTask` | `UpdateTaskArgs` | `Task` | P144 |
| `AddTaskRepo` | `AddTaskRepoArgs` | `Branch` (not created) | P144 |
| `CandidateBranches` | — | `CandidateBranchesResult` | P144 |
| `AddExistingBranch` | `AddExistingBranchArgs` | `AddExistingBranchResult` | P144 |
| `SetPlan` | `SetPlanArgs` | — | P144 |
| `SetQueuedAfter` | `SetQueuedAfterArgs` | — | P144 |
| `Backlog` | — | `BacklogResult` | P144 |
| `AddBacklogItem` | `AddBacklogItemArgs` | `BacklogItem` (top) | P144 |
| `UpdateBacklogItem` | `UpdateBacklogItemArgs` | `BacklogItem` | P144 |
| `MoveBacklogItem` | `MoveBacklogItemArgs` | — | P144 |
| `DeleteBacklogItem` | `BacklogItemArgs` | — | P144 |
| `PromoteBacklogItem` | `BacklogItemArgs` | `Task` (first stage, Later, no repos) | P144 |
| `Workflows` | — | `WorkflowsResult` | P144 |
| `Repos` | — | `ReposResult` | P144 |
| `WorkflowYaml` | `FileNameArgs` | `WorkflowYaml` | P145 |
| `ValidateWorkflowYaml` | `ValidateWorkflowYamlArgs` | `WorkflowValidation` | P145 |
| `SaveWorkflow` | `SaveWorkflowArgs` | `WorkflowEntry` | P145 |
| `SaveWorkflowYaml` | `SaveWorkflowYamlArgs` | `WorkflowEntry` | P145 |
| `ImportWorkflow` | `ImportWorkflowArgs` | `WorkflowEntry` | P145 |
| `NewWorkflow` | `NewWorkflowArgs` | `WorkflowEntry` | P145 |
| `UpdateRepo` | `UpdateRepoArgs` | `Repo` | P145 |
| `AddFolder` | `FolderArgs` | `FolderImportResult` | P145 |
| `SetFolderWatch` | `FolderArgs` | `Folder` | P145 |
| `RemoveFolder` | `PathArgs` | — | P145 |
| `RecordMerge` | `RecordMergeArgs` | — | P145 |
| `StartRun` | `StartRunArgs` | `StartRunResult` | P146 |
| `Approve` | `StepArgs` | — | P146 |
| `RetryRun` | `RunArgs` | `StartRunResult` | P146 |
| `StageDone` | `TaskArgs` | `Task` (Done › / Finish ✓) | P146 |
| `RetrySetup` | `BranchArgs` | — | P146 |
| `ReadLog` | `ReadLogArgs` | `LogPage` | P146 |
| `Sessions` | — | `SessionsResult` | P146 |
| `StopRun` | `RunArgs` | — | P147 |
| `TakeOver` | `TakeOverArgs` | `Launch` | P147 |
| `LaunchStage` | `LaunchStageArgs` | `Launch` (`▶ <Stage>`) | P147 |
| `StartBranch` | `StartBranchArgs` | `Launch` (`▶ Start`, §9) | P147 |
| `Send` | `SendArgs` | — | P147 |
| `FocusSession` | `FocusSessionArgs` | `boolean` | P147 |
| `SetTaskWorkflow` | `SetTaskWorkflowArgs` | `Task` (restarts at first stage) | P147 |
| `ArchiveRisk` | `TaskArgs` | `ArchiveRisk` | P147 |
| `ArchiveTask` | `TaskArgs` | — | P147 |

47 methods. P148 A adds none.

Not methods (no backend need): Copy YAML (frontend clipboard of `WorkflowYaml`), fix-menu entries
(derived from `Branch` facts), Needs-you list (P144 B derivation), task status (D10). Adding a
single repo on the Repos page reuses `codeWorkspaceImportRepo` then invalidates `Repos`.

## 5. Push channels

Go consts in `adewire/channels.go`; TS keys in `CHANNEL` (`packages/shared/protocol/events.ts`).

| TS key | Value | Payload | Emit | Wave |
|---|---|---|---|---|
| `adeTaskBoard` | `kira:adetask:board` | none (invalidate `Board`, `Prs`) | Emit | P144 |
| `adeTaskBacklog` | `kira:adetask:backlog` | none | Emit | P144 |
| `adeTaskCredential` | `kira:adetask:credential` | `CredentialRequest` | EmitFocused | P144 |
| `adeTaskWorkflows` | `kira:adetask:workflows` | none | Emit | P145 |
| `adeTaskRepos` | `kira:adetask:repos` | none | Emit | P145 |
| `adeTaskRuns` | `kira:adetask:runs` | `RunsChangedEvent` | Emit | P146 |
| `adeTaskLog` | `kira:adetask:log` | `LogEvent` | Emit | P146 |
| `adeTaskSessions` | `kira:adetask:sessions` | none | Emit | P146 |
| `adeTaskOpenSession` | `kira:adetask:open-session` | `OpenSessionEvent` | EmitTo | P147 |

Reused unchanged: `agentSessions`, `agentEvent` (TUI activity by `terminalId`), `terminal`,
`settingsChanged` (W16). Go const names `Channel<Key without adeTask>` (`ChannelBoard`, ...).

## 6. Fixtures and the test

### 6.1 Fixtures (`apps/kira-space/tests/fixtures/ade-v2/`, 23 files)

Transcribed from `mockup.html` (lines 1084-1230) and SPEC2 examples. Ids keep the mockup's
(`T_bill`, `b_meter`, ...); `codeRepoId` = `repo-web-app`, `repo-api`, `repo-mobile`, `repo-infra`,
`repo-docs`, `repo-dotfiles`. Instants are fixed epoch ms around 2026-09-22 (mockup `TODAY`).

| File | Type | Content |
|---|---|---|
| `board.json` | `Board` | 13 tasks (`T_cart`…`T_spike`, `R_sara`, `R_li`), 22 branches (18 `b_*`, not the `p_*` pool, plus 2 not-created per `T_alerts`/`T_csv` `draftRepos`), mockup `plan` (day offsets → ISO dates; `T_spike` absent = Later), runs from each task's `run` map (incl. `T_push` `back` + `loops: 1`, `T_cart` failed script run with `exitCode: 1`), `b_searchui` setup `failed`, `b_push` setup `running`, `b_auth` integration `stale` + note, `b_hooks` staging `stale`, deployments incl. `stale` prod on `b_authcb`, one non-empty `conflictsIfRebased`, `currentStage` per task, 1 pair (`b_bill`×`b_sara` shared `src/payments/client.ts`), 5 history rows, 3 `repos` states |
| `prs.json` | `PrsResult` | PRs from `PR(...)` calls; `mobile` repo `kind: 'disabled'` |
| `backlog.json` | `BacklogResult` | 4 items `i1`-`i4` (`i1` Jira PAY-140, `i2` GitHub issue) |
| `workflows.json` | `WorkflowsResult` | `standard`, `bugfix`, `chore` (mockup `workflowData`, kinds canonicalized, `allowedTools` set on 2 steps) + 1 entry with `workflow: null`, `error` line 11 |
| `workflow-yaml.json` | `WorkflowYaml` | `standard.yaml` text from `design/ade-v2/workflows/standard.yaml` |
| `workflow-validation.json` | `WorkflowValidation` | invalid: `✕ stage 4: kind must be user, agent or script` (`line: 0`) |
| `repos.json` | `ReposResult` | 6 repos from `repos()` (targets, prepare, timeout, envs, nicknames, sources), folder `~/code/acme` watch |
| `folder-import.json` | `FolderImportResult` | `~/code/oss`, 2 imported |
| `candidates.json` | `CandidateBranchesResult` | pool `p_invoice`, `p_scopes`, `p_csvapi`, `p_rate` |
| `add-existing-branch.json` | `AddExistingBranchResult` | `p_rate` as a new review task |
| `task.json` | `Task` | `CreateTask` result: `T_csv` with 2 not-created branch ids, `stageId: 'spec'` |
| `branch.json` | `Branch` | `AddTaskRepo` result: `name: ''`, `setup: null` |
| `refresh.json` | `RefreshResult` | web-app `refsChanged: 3`, 1 `mergedInto` develop; mobile with `error` |
| `force-push.json` | `ForcePushResult` | `b_auth`, `error: null` |
| `archive-risk.json` | `ArchiveRisk` | SPEC2 §10 example (`feat/usage-billing`, 1 dirty, 5 unmerged) |
| `start-run.json` | `StartRunResult` | 3 run ids |
| `log-page.json` | `LogPage` | `b_searchui` setup log (stderr line for the 404) |
| `sessions.json` | `SessionsResult` | every `S(...)` in branch + spec sessions; `9ab0` TUI running `input`; one TUI with `resumes` |
| `launch.json` | `Launch` | `TUI … (resumed)` of `9d10` |
| `event-runs.json` | `RunsChangedEvent` | `b_bill` impl todo `[4, 10]` |
| `event-log.json` | `LogEvent` | 2 `event` chunks of a headless run |
| `event-credential.json` | `CredentialRequest` | one masked prompt |
| `event-open-session.json` | `OpenSessionEvent` | `T_auth` / `b_auth` / `9ab0` |

Payload-free channels have none. Types fully covered inside
another fixture (`Repo`, `WorkflowEntry`, `BacklogItem`, `Run`, ...) get no file of their own,
except where a method returns them alone and the shape is worth seeing (`task.json`, `branch.json`).

Format with Biome (`bunx biome format --write apps/kira-space/tests/fixtures/ade-v2`).

### 6.2 The one test (`adewire/wire_test.go`)

`TestFixturesMatchWireTypes`, table-driven: file name → `func() any { return new(T) }`.

1. Read the dir (`../../../tests/fixtures/ade-v2`); fail if its file set differs from the table
   (no untested fixture, no missing fixture; count 23).
2. Per file: `json.Decoder` with `DisallowUnknownFields` into `T` (fixture key Go lacks → fail).
3. Re-marshal `T`; unmarshal both original and re-marshalled bytes into `any`; `reflect.DeepEqual`
   (Go key the fixture lacks, `null` vs `[]`, number-vs-string drift → fail). Report the file and
   a short diff (first differing path).

Earns CLAUDE.md's test bar per preplan §4 (only cross-language contract guard; streams depend on
it). No TS test: the TS mirror is checked once at acceptance (§9) and by P144 B's typed fixture
imports.

## 7. Streams verdict: one sequential implementer

A split (A: Go types + fixtures + test; B: `wire.ts` + `CHANNEL` + `knip.json`) has zero file
overlap, but fails the "no ordering dependency" half of the streams rule:

- Fixture authoring is where contract gaps surface (a missing field, a wrong nullability). Each fix
  must change Go and TS together; B would need A's corrections mid-stream, which is the serial
  amendment loop the freeze exists to avoid.
- Acceptance (§9) diffs Go tags against TS keys; it needs both halves landed.
- Size M; two worktrees plus rebase cost more than they save.

Default: **one Sonnet implementer, commits in §8 order.**

## 8. Commits and fast checks

Pre-commit hook (`bun run lint`, `bun run typecheck`) runs on each; never `--no-verify`.

1. `feat(kira-space): ade v2 Go wire types and channels` — `adewire/wire.go`, `channels.go`.
   Checks: `gofmt -l`, `go build ./...`, `go vet ./apps/kira-space/internal/bridge/...`.
2. `test(kira-space): ade v2 wire fixtures and decode test` — 23 fixtures, `wire_test.go`.
   Checks: `go test ./apps/kira-space/internal/bridge/...`, Biome via hook.
3. `feat(kira-space): ade v2 TS wire mirror and push channels` — `frontend/src/ade/v2/wire.ts`,
   `packages/shared/protocol/events.ts`, `knip.json`. Checks: hook, `bun run lint:dead`.
4. `docs(v2.0): P143 result` — result section in this file (fixture count, method count, anything
   amended), `SPEC.md` P143 row status. Then push (pre-push: `go build`, `lint:go`, `lint:dead`).

If commit 2 finds a contract gap, fix commit 1's types in a follow-up commit and record the change
in this plan's result section (it is pre-freeze; rule 1 applies from P143's landing on).

## 9. Acceptance

- Preplan: `bun run lint`, `bun run typecheck`, `go build ./...`,
  `go test ./apps/kira-space/internal/bridge/...`, `bun run lint:go`; plus `bun run lint:dead`.
- `ls apps/kira-space/tests/fixtures/ade-v2/*.json | wc -l` = 23 = test table length.
- Key-set parity (one-off script, not committed): per type, Go `json` tags in `adewire/*.go` equal
  TS interface keys in `ade/v2/wire.ts`; type-name sets equal. Output pasted (one line) into the
  result section.
- `grep -c omitempty adewire/wire.go` = 0.
- Every type in §3 and every method's arg/result type in §4 exists in both files; `CHANNEL` has the 9
  keys of §5 and Go has 9 `Channel*` consts with equal values.
- No new dependency (`git diff e76cec5 -- go.mod go.sum package.json bun.lock` empty).
- Nothing outside §2's file list changed.

## 10. Libraries

None new. `encoding/json` + `reflect` for the test (stdlib). No zod schema for the wire: v1 trusts
bound results (`trust<T>()`); validation lives on the Go side (P144+). JSON Schema generation
(e.g. `invopop/jsonschema`) declined: the round-trip test already enforces both directions on real
data, and TS still needs hand-written unions (template-literal `RunsOn`/`OnFailure` have no JSON
Schema equivalent `tsc` would infer).

## 11. Carry-forward for later wave plans

- P144 A: create `AdeTaskService`, register in `main.go`, add `index.ts` entries per §4 wave;
  builders `make` every slice/map (W4); `ade_sessions` new columns back `Session` fields.
- P145 serial landing step: drop the `knip.json` entry from W15 once `index.html` reaches
  `ade/v2/wire.ts`.
- P146 plan: lands W16's settings leaf and its default (O5); assigns `state/settingsDomain.ts` to
  Stream A; fixes the run-log cap behind `LogPage.truncated`.
- B streams add mock FQNs (`AdeTaskService.<Method>`) to `tests/ui/support/{ipcChannels,mockRuntime}.ts`
  in the wave they first consume a method.
