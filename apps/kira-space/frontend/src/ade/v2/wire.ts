// Frozen at P143 (ADE v2 wire contract). Mirrors apps/kira-space/internal/bridge/adewire.
// Changing a key, type or value set is a contract change (docs/HISTORY.md (v2.0 P143) rule 1).

import type { FileChange, GitHostInfo } from '@kira/git-ipc';
import type { RunOutcome } from '@shared/domain/runOutcome';

// ---- shared
export interface Jira {
  key: string;
  url: string;
}
interface DirtyEntry {
  code: string;
  path: string;
}
export interface RemoteOpError {
  kind: string;
  message: string;
  remoteMessage: string | null;
}

// ---- repos (§6.3, D15)
export interface Environment {
  name: string;
  deployedShaScript: string;
}
export interface Repo {
  codeRepoId: string;
  name: string /* code_repos.name */;
  nickname: string /* '' = use name */;
  path: string;
  source: string /* 'added' | folder path */;
  usedByTasks: boolean;
  integrationBranches: string[] /* besides main */;
  prepareScript: string;
  prepareTimeout: string;
  worktreeBasePath: string /* '' = the default */;
  environments: Environment[];
}
export interface Folder {
  path: string;
  watch: boolean;
  hidden: boolean;
  repoCount: number;
  hiddenCount: number;
}
export interface ReposResult {
  repos: Repo[];
  folders: Folder[];
}
export interface FolderImportResult {
  folder: Folder;
  imported: string[] /* codeRepoIds */;
}

// ---- workflows (§5.1.1, D2, D6, D13)
export type StepKind = 'agent' | 'script' | 'review' | 'manual';
/** A status id from the user's set, such as 'in-progress'. */
export type TaskStatus = string;
export type RunsOn = 'once' | 'each repo' | `only ${string}` /* nickname */;
/** A result a step may report through finish_step. `next` is 'next' | 'end' | 'stop' or a step id of the workflow; `loop` says the route goes back to the step or an earlier one (a return, counted against the step's `maxReturns`). */
export interface StepResult {
  id: string;
  ok: boolean;
  description: string;
  next: string;
  loop: boolean;
}
/** One step of a workflow. Fields of another kind than `kind` hold their zero value. */
export interface WorkflowStep {
  id: string;
  name: string;
  kind: StepKind;
  status: TaskStatus;
  skip: boolean /* no task enters it by moving forward */;
  /** Manual: open a Claude Code session. */
  session: boolean;
  /** Script. */
  command: string;
  /** Agent, script, review; '' on a manual step. */
  runsOn: RunsOn | '';
  before: 'auto' | 'approval' | '';
  results: StepResult[];
  /** Returns a result may make to this step or an earlier one before the run stops; 0 = no limit (review steps only). */
  maxReturns: number;
  timeout: string;
  /** Agent prompt; manual: the session's first message. */
  prompt: string;
  allowedTools: string[] /* D6, [] = none added */;
  /** Name of the smart script that replaces `prompt`; '' = a prompt step. */
  smartScript: string;
  /** The smart script's values per param name. */
  params: Record<string, string[]>;
  /** Set on a review step: it waits for the user instead of running an agent. */
  review: ReviewStepConfig | null;
  /** Agent policy; the default (write, network on) when the step has no block. */
  sandbox: StepSandbox;
}
export type SandboxAccess = 'write' | 'read' | 'off';
export interface StepSandbox {
  access: SandboxAccess;
  /** Extra read-only folders: absolute or `~/`. */
  read: string[];
  /** Extra read-write paths: absolute or `~/`. */
  allow: string[];
  network: boolean;
}
export interface ReviewStepConfig {
  sendTo: 'implementer' | 'new';
  /** Earlier prompt step whose session takes the comments; '' = the nearest one. */
  implementer: string;
}
export interface Workflow {
  id: string;
  name: string;
  /** Turns on the Kira Space tools (declare repos, request branches) for the work of a task. */
  kiraSpaceMcp: boolean;
  steps: WorkflowStep[];
}
export interface WorkflowError {
  line: number /* 0 = not line-specific */;
  message: string;
}
export interface WorkflowEntry {
  fileName: string /* stable key */;
  path: string;
  workflow: Workflow | null /* last valid version; null if never valid */;
  error: WorkflowError | null /* current file's error */;
  usedBy: number;
  hash: string /* identifies the file text; Save sends it back as baseHash */;
}
export interface WorkflowsResult {
  dir: string;
  workflows: WorkflowEntry[];
  sandbox: SandboxSupport;
}
export interface WorkflowYaml {
  fileName: string;
  path: string;
  yaml: string;
  hash: string /* identifies yaml; Save sends it back as baseHash */;
}
export interface WorkflowValidation {
  workflow: Workflow | null;
  error: WorkflowError | null;
} // exactly one non-null

// ---- branch facts (§2, §6, §6.1, §6.2, D1, D14)
export interface WorktreeSetup {
  state: 'running' | 'ready' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  /** Why it failed, '' otherwise. */
  note: string;
}
export interface Deployment {
  env: string;
  deployedSha: string;
  checkedAt: number;
  status: 'deployed' | 'stale' | 'not deployed' | 'unknown' /* unknown: script failed, see error */;
  missingCommits: number;
  note: string;
  error: string;
}
export interface Integration {
  target: string;
  status: 'merged' | 'stale' | 'not merged';
  note: string;
  recorded: boolean /* D14: app's merge dialog recorded it */;
}
export interface ChangeRequest {
  number: number;
  title: string;
  state: string;
  url: string;
}
export interface Branch {
  id: string;
  taskId: string;
  codeRepoId: string;
  name: string /* '' until created */;
  kind: 'mine' | 'review' | 'parked';
  owner: string;
  base: string /* ref name */;
  baseBranchId: string /* '' if base is not a planner branch */;
  baseOwner: string /* '' if base is mine */;
  tip: string;
  ahead: number;
  behind: number;
  upstream: string;
  upstreamAhead: number;
  upstreamBehind: number;
  mergedIntoMain: boolean;
  mergedAt: number | null;
  worktree: string /* '' none */;
  setup: WorktreeSetup | null /* null until a worktree exists */;
  integration: Integration[] /* one per configured target */;
  deployments: Deployment[];
  conflictsIfRebased: string[] /* D1: paths conflicting if rebased onto latest base */;
  conflictCheck: 'checking' | 'done' | 'failed';
  conflictCheckReason: string /* '' unless failed */;
  dirty: DirtyEntry[];
  lastCommitAt: number | null;
  addedAt: number;
  /** '' user-made, 'agent' declared or named by an agent through the Kira Space tools. */
  origin: '' | 'agent';
  /** The stored base no longer resolves (deleted or renamed). */
  baseMissing: boolean;
  /** Display name of the previous base while a Change base is not completed by a verified rebase; '' otherwise. */
  basePendingFrom: string;
  /** A rebase, merge or cherry-pick is left half-done in the worktree. */
  rebaseInProgress: boolean;
}
export interface Pair {
  a: string;
  b: string /* branch ids */;
  shared: string[];
  conflicts: string[];
}

// ---- runs, tasks, plan (§2, §4, §5, §12, D7, D10, D12, D16)
export type RunState = 'pending' | 'running' | 'stuck' | 'failed' | 'back' | 'done' | 'review';
export interface Run {
  id: string;
  taskId: string;
  stepId: string;
  branchId: string /* once: first branch, D12 */;
  attempt: number;
  state: RunState;
  loops: number /* send-back round */;
  note: string;
  summary: string /* finish_step summary */;
  sessionId: string /* '' for script */;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** How the run ended; null while it runs and for rows older than P242. */
  outcome: AdeRunOutcome | null;
  /** 'rebase' for a rebase run (outside the workflow), '' for a step run. */
  purpose: '' | 'rebase' | 'review';
  /** Times this branch's step went back, up to and including this attempt. */
  returns: number;
  /** A restart stopped the run mid-session: Resume continues its Claude conversation. */
  resumable: boolean;
  /** Where a review step run stands; null on every other run. */
  review: RunReview | null;
  /** The run's sandbox badge; null when it ran without one (script runs, rows before P287). */
  sandbox: RunSandboxBadge | null;
}
export interface RunSandboxBadge {
  access: SandboxAccess;
  /** False when the OS cannot enforce the profile: declared only. */
  enforced: boolean;
  denials: number;
  /** The last kept denial as `op target`; '' when none. */
  last: string;
}
interface SandboxSupport {
  enforced: boolean;
  /** The notice text when not enforced. */
  reason: string;
}
interface SandboxDenial {
  at: number;
  op: string;
  target: string;
  process: string;
}
export interface RunSandboxDetail {
  access: SandboxAccess;
  enforced: boolean;
  reason: string;
  write: string[];
  read: string[];
  allow: string[];
  network: boolean;
  /** The SBPL text as written; '' for access off. */
  profile: string;
  denials: SandboxDenial[];
  denialCount: number;
}
export type ReviewPhase = 'waiting' | 'sent' | 'working' | 'stuck' | 'done';
export interface RunReview {
  phase: ReviewPhase;
  round: number;
  route: 'implementer' | 'new';
  note: string;
}
/** An agent run that can take the review comments. */
interface ReviewCandidate {
  runId: string;
  step: string;
  attempt: number;
  finishedAt: number | null;
}
/** The latest send of a review run. */
interface ReviewRound {
  run: Run;
  n: number;
  route: 'implementer' | 'new';
  fallback: boolean;
  /** Commits the round added; null when unknown or not finished. */
  commits: number | null;
}
/** A branch's review step for its review window; `run` null = no review step there. */
export interface ReviewStepState {
  run: Run | null;
  stepName: string;
  results: StepResult[];
  route: 'implementer' | 'new';
  targetRunId: string;
  defaultTargetRunId: string;
  candidates: ReviewCandidate[];
  round: ReviewRound | null;
}
export interface SendReviewArgs {
  runId: string;
  route: 'implementer' | 'new' | '';
  targetRunId: string;
}
export interface FinishReviewArgs {
  runId: string;
  result: string;
  note: string;
}
export interface ReviewEvent {
  taskId: string;
  branchId: string;
}
/** What the agent reported beyond status and summary. */
interface AgentReport {
  conflictedFiles?: string[];
  lastGitError?: string;
  tried?: string;
}
interface BranchShas {
  branchId: string;
  name: string;
  before: string;
  after: string;
  onBase: boolean;
}
/** What git showed after a rebase run ended. */
interface RebaseFacts {
  verified: boolean;
  inProgress: boolean;
  aborted: boolean;
  ontoRef: string;
  ontoTip: string;
  conflictedFiles: string[];
  branches: BranchShas[];
  pushed: boolean | null;
}
/** `route`: where the result sent the step (`next`, `end`, `stop`, a step id, `back:<id>`, `retry`). */
type AdeRunOutcome = RunOutcome & {
  report?: AgentReport;
  rebase?: RebaseFacts;
  route?: string;
};
/** A code host provider's display text, as `GitHostService.Providers` and `/api/ade/hosts` answer. */
export type HostInfo = GitHostInfo;
export interface HostProviders {
  providers: HostInfo[];
}
export interface HostLink {
  provider: string;
  kind: 'changeRequest' | 'issue';
  ref: string;
}
export interface Task {
  id: string;
  kind: 'task' | 'review' | 'parked';
  title: string /* '' = default title */;
  owner: string;
  jira: Jira | null;
  hostUrl: string;
  hostLink: HostLink | null /* hostUrl as a provider recognises it */;
  workflowId: string /* '' = none */;
  entryStepId: string /* the step the task last entered | 'done' | '' without a workflow */;
  since: Record<
    string,
    number
  > /* '<stepId>/<branchId>' -> attempt; runs at or below it are history */;
  workflow: Workflow | null /* the version a started task runs; null until it starts */;
  workflowOutdated: boolean /* the live file differs from `workflow` */;
  est: string /* '' none; extend-only, D16 */;
  notes: string /* Markdown */;
  color: number;
  branchIds: string[];
  runs: Run[];
  createdAt: number;
  statusId: TaskStatus;
  /** Who set the status last: a step change ('auto') or the user. */
  statusBy: 'auto' | 'user';
}
/** One status of the user's set. `category` decides which status automation picks. */
export interface TaskStatusDef {
  id: TaskStatus;
  name: string;
  tone: 'amber' | 'red' | 'green' | 'blue' | 'purple' | 'grey';
  category: 'todo' | 'active' | 'review' | 'done';
}
export interface Plan {
  day: Record<string, string> /* taskId -> ISO date; absent = Later */;
  order: string[] /* taskIds */;
  queuedAfter: Record<string, string> /* branchId -> branchId */;
  unpushed: Record<string, boolean>;
}
export interface HistoryEntry {
  taskId: string;
  title: string;
  codeRepoIds: string[];
  mergedAt: number | null;
  archivedAt: number;
}
export interface RepoState {
  codeRepoId: string;
  mainName: string /* '' unresolved */;
  remote: string;
  lastFetchAt: number | null;
}
export interface Board {
  tasks: Task[];
  statuses: TaskStatusDef[];
  branches: Branch[];
  plan: Plan;
  pairs: Pair[];
  history: HistoryEntry[];
  repos: RepoState[] /* repos used by tasks only, §3 */;
  worktreeBasePath: string;
  autofetchMinutes: number;
}
interface RepoHost {
  codeRepoId: string;
  kind: 'ok' | 'disabled' | 'unavailable';
  host: HostInfo | null;
}
export interface ChangeRequestsResult {
  repos: RepoHost[];
  branches: Record<string, ChangeRequest> /* branchId */;
  branchUrls: Record<string, string> /* branchId -> web page; absent without a host */;
}

// ---- backlog (§11.1, O2)
export interface BacklogItem {
  id: string;
  text: string;
  addedAt: number;
  jira: Jira | null;
  hostUrl: string;
  hostLink: HostLink | null;
  notes: string;
}
export interface BacklogResult {
  items: BacklogItem[] /* order = priority */;
}

// ---- add / refresh / archive results
export interface CandidateBranch {
  codeRepoId: string;
  name: string;
  author: string;
  lastCommitAt: number;
  remoteOnly: boolean;
  mine: boolean;
}
export interface CandidateBranchesResult {
  branches: CandidateBranch[] /* newest first */;
}
export interface AddExistingBranchResult {
  task: Task;
  branch: Branch;
}
export interface MergedInto {
  branchId: string;
  target: string;
}
export interface RepoRefresh {
  codeRepoId: string;
  refsChanged: number;
  mergedInto: MergedInto[];
  error: RemoteOpError | null;
}
export interface RefreshResult {
  repos: RepoRefresh[];
}
export interface ForcePushResult {
  branchId: string;
  error: RemoteOpError | null;
}
export interface BranchRisk {
  branchId: string;
  worktree: string;
  dirty: DirtyEntry[];
  unmerged: number;
  blocked: string;
}
export interface ArchiveRisk {
  taskId: string;
  branches: BranchRisk[];
}

// ---- runs, logs, sessions (§5, §5.1.2, §7, D3)
export interface StartRunResult {
  runIds: string[];
}
export type LogKind = 'run' | 'setup';
export interface LogChunk {
  seq: number;
  at: number;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}
export interface LogPage {
  kind: LogKind;
  id: string;
  chunks: LogChunk[];
  nextSeq: number;
  done: boolean;
  truncated: boolean;
}
export interface Session {
  id: string;
  agentSessionId: string;
  provider: string;
  mode: 'tui' | 'headless';
  state: 'running' | 'stopped';
  activity:
    | ''
    | 'input'
    | 'working'
    | 'waiting'
    | 'idle' /* headless; TUI comes from agent events */;
  terminalId: string /* tui */;
  taskId: string;
  branchId: string /* '' = task-level */;
  stepId: string;
  runId: string /* headless */;
  resumes: string /* headless claude id */;
  purpose: '' | 'review';
  cwd: string;
  cwdMissing: boolean;
  startedAt: number;
  lastActiveAt: number;
}
export interface SessionsResult {
  sessions: Session[];
}
export interface Launch {
  terminalId: string;
  sessionId: string;
  command: string;
  cwd: string;
}

// ---- review (P150)
export interface WindowKeyArgs {
  windowKey: string;
}
export interface ReviewWindowTarget {
  taskId: string;
  branchId: string;
  codeRepoId: string;
  gitRepoId: string;
  branch: string;
  base: string;
  worktree: string;
}
export interface ReviewWorking {
  worktree: string /* '' = the branch has no worktree */;
  head: string;
  files: FileChange[];
}
export interface ReviewWorkingDiffArgs {
  branchId: string;
  path: string;
}
export interface ReviewAgentState {
  session: Session | null;
  hostWindowKey: string /* '' = not running */;
}
export interface ReviewAgentLaunch {
  launch: Launch;
  resumed: boolean;
  note: string /* '' or why a fresh one started */;
}
export interface ReviewForwardText {
  text: string;
}
export interface ForwardReviewResult {
  count: number;
}

// ---- push payloads
export interface RunsChangedEvent {
  runs: Run[];
}
export interface LogEvent {
  kind: LogKind;
  id: string;
  chunks: LogChunk[];
}
export interface OpenSessionEvent {
  taskId: string;
  branchId: string;
  sessionId: string;
}

/** A phone started this launch; the window opens its terminal and answers with `mobileLaunchOpened`. */
export interface MobileOpenLaunchEvent {
  launch: Launch;
  taskId: string;
  branchId: string;
}

export interface CreateTaskArgs {
  title: string;
  jira: Jira | null;
  hostUrl: string;
  notes: string;
  codeRepoIds: string[];
  workflowId: string;
  /** Per repo id; a missing repo starts from its main. */
  bases: Record<string, BaseChoice>;
  /** Plan day (YYYY-MM-DD) the task lands on; null lands in Later. */
  day: string | null;
}
/** A base: a planner branch (branchId), a git ref (ref), or both empty for the repo main. */
export interface BaseChoice {
  ref: string;
  branchId: string;
}
export interface SetBranchBaseArgs {
  branchId: string;
  base: BaseChoice;
}
export interface OntoArgs {
  branchId: string;
  /** null = the current base. */
  onto: BaseChoice | null;
  /** A review branch id: rebase onto it and queue after it. */
  queueWith: string;
  push: boolean;
  autostash: boolean;
}
export interface RebaseArgs extends OntoArgs {
  /** '' = the default prompt. */
  message: string;
}
interface RebaseStackItem {
  branchId: string;
  name: string;
  worktree: string;
  ontoRef: string;
}
type RebaseBlockerKind =
  | 'dirty'
  | 'running'
  | 'inProgress'
  | 'baseMissing'
  | 'parentDraft'
  | 'noWorktree'
  | 'setup';
export interface RebaseBlocker {
  branchId: string;
  kind: RebaseBlockerKind;
  text: string;
}
export interface RebasePreview {
  prompt: string;
  suffix: string;
  stack: RebaseStackItem[];
  blockers: RebaseBlocker[];
  noOp: boolean;
}
export interface RebaseStart {
  runId: string;
  noOp: boolean;
}
export interface RepoBranchesArgs {
  codeRepoId: string;
  branchId: string;
}
export interface BasePick {
  name: string;
  local: boolean;
  remote: boolean;
  branchId: string;
  taskId: string;
  taskTitle: string;
  draft: boolean;
  /** Why it cannot be chosen; '' = choosable. */
  excluded: string;
}
export interface RepoBranches {
  mainName: string;
  previous: string;
  branches: BasePick[];
}
export interface TaskPatch {
  title: string | null;
  jira: Jira | null;
  clearJira: boolean;
  hostUrl: string | null;
  est: string | null;
  notes: string | null;
  color: number | null;
  kind: 'task' | 'parked' | null;
  statusId: TaskStatus | null;
}
/** `id` '' = a new status. `reassign` maps a removed id to the id its tasks move to; without an entry they go to the first kept status of its category. */
export interface SaveStatusesArgs {
  statuses: TaskStatusDef[];
  reassign: Record<string, string>;
}
export interface SaveStatusesResult {
  statuses: TaskStatusDef[];
}
export interface UpdateTaskArgs {
  taskId: string;
  patch: TaskPatch;
} // null field = unchanged
export interface AddTaskRepoArgs {
  taskId: string;
  codeRepoId: string;
  base: BaseChoice | null;
}
export interface AddExistingBranchArgs {
  codeRepoId: string;
  name: string;
  taskId: string /* '' = new task */;
}
export interface HostLinkArgs {
  url: string;
  taskId: string /* '' = new task; ResolveHostLink ignores it */;
}
/** The branch a pasted link names, before anything is fetched. */
export interface HostLinkTarget {
  codeRepoId: string;
  remote: string;
  branch: string /* local name AddHostLink attaches */;
  headOwner: string /* '' unless fork */;
  fork: boolean;
  author: string /* change request author login; '' for a branch link */;
  changeRequest: ChangeRequest | null;
  onTaskId: string /* live task already holding branch */;
}
export interface SetPlanArgs {
  order: string[];
  days: Record<string, string | null> /* null = Later */;
}
export interface SetQueuedAfterArgs {
  branchId: string;
  afterBranchId: string /* '' = clear */;
}
export interface RefreshArgs {
  codeRepoIds: string[] /* [] = every repo used by tasks */;
}
export interface BranchArgs {
  branchId: string;
}
export interface AddBacklogItemArgs {
  text: string;
}
export interface BacklogPatch {
  text: string | null;
  jira: Jira | null;
  clearJira: boolean;
  hostUrl: string | null;
  notes: string | null;
}
export interface UpdateBacklogItemArgs {
  id: string;
  patch: BacklogPatch;
}
export interface BacklogItemArgs {
  id: string;
}
export interface MoveBacklogItemArgs {
  id: string;
  toIndex: number;
}
export interface FileNameArgs {
  fileName: string;
}
export interface SaveWorkflowArgs {
  fileName: string;
  workflow: Workflow;
  baseHash: string /* the entry hash the draft was built on; '' skips the check */;
}
export interface SaveWorkflowYamlArgs {
  fileName: string;
  yaml: string;
  baseHash: string /* the yaml hash the text was edited from; '' skips the check */;
}
export interface ValidateWorkflowYamlArgs {
  yaml: string;
}
export interface ImportWorkflowArgs {
  path: string;
}
export interface NewWorkflowArgs {
  name: string;
}
export interface RepoPatch {
  nickname: string | null;
  integrationBranches: string[] | null;
  prepareScript: string | null;
  prepareTimeout: string | null;
  worktreeBasePath: string | null;
  environments: Environment[] | null;
}
export interface UpdateRepoArgs {
  codeRepoId: string;
  patch: RepoPatch;
}
export interface FolderArgs {
  path: string;
  watch: boolean;
}
export interface FolderHiddenArgs {
  path: string;
  hidden: boolean;
}
export interface PathArgs {
  path: string;
}
export interface RecordMergeArgs {
  branchId: string;
  target: string;
}
export interface StartRunArgs {
  taskId: string;
  branchNames: Record<string, string> /* branchId -> name, '' = derived from the task title */;
  message: string;
  fromStepId?: string;
}
export interface StepArgs {
  taskId: string;
  stepId: string;
}
export interface RunArgs {
  runId: string;
}
export interface TaskArgs {
  taskId: string;
}
export interface ReadLogArgs {
  kind: LogKind;
  id: string;
  afterSeq: number;
}
export interface TakeOverArgs {
  sessionId: string;
  stopIfRunning: boolean /* false on a running run = E_BAD_REQUEST, D3 */;
}
export interface LaunchStepArgs {
  taskId: string;
  message: string;
  fromStepId?: string;
}
export interface StartBranchArgs {
  branchId: string;
  message: string;
}
export interface SetTaskWorkflowArgs {
  taskId: string;
  workflowId: string;
}
export interface SetTaskStepArgs {
  taskId: string;
  stepId: string;
  fromStepId?: string;
}
export interface SendArgs {
  sessionId: string;
  message: string;
}
export interface FocusSessionArgs {
  sessionId: string;
  taskId: string;
}
