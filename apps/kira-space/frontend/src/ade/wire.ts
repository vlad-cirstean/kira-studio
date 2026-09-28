// P129 Part 3 §2.3: TS mirrors of Part 1/2's own wire structs (`bridge/ade.go`), only the ones this
// part reads (the other 13 methods' own request/result shapes land with their first consumer part,
// §0.10). Field names and optionality copied from `ade.go`'s json tags — the generated bindings'
// `models.ts` is the cross-check. Every array/map field below is typed non-null even where a Go
// pointer/map could in principle be nil: every `toWire*` helper in `ade.go` builds these with an
// explicit `make(...)`, never a bare nil slice/map, except the handful `bridge/index.ts`'s own
// `normalizeAde*` helpers coerce at the boundary (colors, a plan's four fields, a pair's own
// shared/conflicts, a refresh result's newlyMerged) — those really can be absent (an empty queue,
// or `Refresh`'s own zero-value error path), so the coercion lives once, at the one place raw JSON
// enters this app, rather than a null check at every `useQueue()` call site.

/** `AdeSessionWire` — `Sessions()`'s own list element; `terminalId` is `""` once stopped. */
export interface AdeSession {
  id: string;
  claudeSessionId: string;
  codeRepoId: string;
  branch: string;
  newWorkId: string;
  cwd: string;
  state: string;
  terminalId: string;
  startedAt: number;
  lastActiveAt: number;
}

export interface AdeSessionsResult {
  sessions: AdeSession[];
}

/** `AdeMain` — `RepoSnapshot.main`'s own shape; absent means main is unresolved (§0.6). */
interface AdeMain {
  name: string;
  ref: string;
  tip: string;
}

export interface AdeFile {
  path: string;
  added?: number | null;
  deleted?: number | null;
  binary: boolean;
}

export interface AdeCommit {
  sha: string;
  message: string;
}

interface AdeDirty {
  code: string;
  path: string;
}

/** A branch's or new-work item's own read-side Jira link — always present, empty meaning "none". */
interface AdeJira {
  key: string;
  url: string;
}

/** `AdeBranchWire` — one queued branch's own assembled facts. */
export interface AdeBranch {
  id: string;
  branch: string;
  kind: string;
  name: string;
  draftTitle: string;
  startFrom: string;
  exists: boolean;
  ref: string;
  tip: string;
  owner: string;
  authorEmail: string;
  isMine: boolean;
  lastCommitAt: number;
  base: string;
  ahead: number;
  behind: number;
  merged: boolean;
  mergedAt?: number | null;
  worktree: string;
  files: AdeFile[];
  commits: AdeCommit[];
  commitCount: number;
  dirty: AdeDirty[];
  upstream: string;
  upstreamAhead: number;
  upstreamBehind: number;
  jira: AdeJira;
  prUrl: string;
  est: string;
  notes: string;
  addedAt: number;
}

/** `AdeNewWorkWire` — one queued piece of work with no branch yet. */
export interface AdeNewWork {
  id: string;
  title: string;
  startFrom: string;
  branchName: string;
  est: string;
  notes: string;
  jira: AdeJira;
  createdAt: number;
  branchCandidates?: string[];
}

/** `AdePlanWire` — `day[item]` absent/null means no own day (Part 2 §2.1: `NULL` = Later). */
export interface AdePlan {
  day: Record<string, string | null>;
  order: string[];
  queuedAfter: Record<string, string>;
  unpushed: Record<string, boolean>;
}

/** `AdePair` — a mine×mine or mine×review overlap; `conflicts` is Part 2's merge-tree result
 *  (§0.3: a mine×review conflict only where this is non-empty, never file overlap alone). */
export interface AdePair {
  a: string;
  b: string;
  shared: string[];
  conflicts: string[];
}

interface AdeHistoryItem {
  item: string;
  kind: string;
  title: string;
  branch: string;
  mergedAt?: number | null;
  archivedAt: number;
}

/** `AdeDependencyWire` — one live external dependency's own assembled facts (P135 §4.4). No git
 *  field of any kind: a dependency never has a branch. */
export interface AdeDependency {
  id: string;
  title: string;
  waitingOn: string;
  expectedBy: string | null;
  createdAt: number;
  blocks: string[];
}

/** `AdeRepoSnapshot` — the queue board's own full read (§5.1 of Part 2's plan). */
export interface AdeRepoSnapshot {
  codeRepoId: string;
  gitRepoId: string;
  main?: AdeMain;
  /** P129 Part 4 §2.3: the repo's own default remote, `''` when none — `AdeMainLine`'s dialog
   *  templates read this for `git fetch <remote>` rather than a hardcoded "origin". */
  remote: string;
  branches: AdeBranch[];
  newWork: AdeNewWork[];
  plan: AdePlan;
  colors: Record<string, number>;
  pairs: AdePair[];
  history: AdeHistoryItem[];
  dependencies: AdeDependency[];
  lastFetchAt?: number | null;
  autofetchMinutes: number;
  worktreeBasePath: string;
}

/** `AdePr` — `ResolveBranchPr`'s raw state plus title, verbatim (no Merge action, §0). */
export interface AdePr {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface AdeRepoPrs {
  kind: string; // 'ok' | 'disabled' | 'unavailable'
  branches: Record<string, AdePr>;
  /** P129 Part 6 §0.8: the repo's own web root, `''` when there's no GitHub remote (renders the
   *  Branch ref unlinked). */
  webUrl: string;
}

/** `gitsession.RemoteOpError` — `AdeRefreshResult.error`'s own shape, reused verbatim by
 *  `AdeForcePushResult` (§0.16, same Go type on both). Not exported: every reader (`adeActions.ts`'s
 *  `forcePush`) reaches it through `AdeForcePushResult['error']`, never by importing this name. */
interface AdeRemoteOpError {
  kind: string;
  message: string;
  remoteMessage?: string;
}

export interface AdeRefreshResult {
  refsChanged: number;
  newlyMerged: string[];
  error?: AdeRemoteOpError;
}

/** `gitsession.credentialRequestPayload` — `kira:ade:credential`'s own payload, mapped through
 *  `useCodeReposStore` rather than a snapshot cache (§0.14). */
export interface AdeCredentialRequest {
  requestId: string;
  repoId: string;
  prompt: string;
  masked: boolean;
}

/** `kira:ade:repo`'s own payload — a debounced "re-fetch this repo's snapshot/prs" signal. */
export interface AdeRepoChangedEvent {
  codeRepoId: string;
}

// P129 Part 4 §2.3: the launch/archive wire mirrors — Part 3 left these six methods' request/result
// shapes for their first consumer part (§0.10 of the Part 3 plan). Every field mirrors
// `bridge/ade.go`'s own json tags exactly; not `omitempty` on the Go side stays required here too
// (branch/newWorkId/resume are "" when unused, never left off the wire).

/** `AdePrepareLaunchArgs` — exactly one of `branch`/`newWorkId` is non-empty (§4.6 of Part 1's
 *  plan); `resume` is `''` for a new session, else an existing `ade_sessions.id`. */
export interface AdePrepareLaunchArgs {
  codeRepoId: string;
  branch: string;
  newWorkId: string;
  cwd: string;
  resume: string;
  message: string;
}

/** `AdePrepareLaunchResult` — `command` is the base launch (no hooks/prompt yet); the renderer's own
 *  `openTerminalSession` call is what actually spawns it (§0.14). */
export interface AdeLaunch {
  terminalId: string;
  sessionId: string;
  command: string;
}

/** `AdeSendArgs` — `sessionId` is the `ade_sessions` record id, not the Claude session id. */
export interface AdeSendArgs {
  sessionId: string;
  message: string;
}

export interface AdeItemArgs {
  codeRepoId: string;
  item: string;
}

export interface AdeArchiveArgs {
  codeRepoId: string;
  item: string;
  discard: boolean;
}

/** `AdeArchiveRiskResult` — `blocked`, when non-empty, names the reason `Archive` would refuse
 *  outright (§0.16 step 2). */
export interface AdeArchiveRisk {
  dirty: AdeDirty[];
  unmerged: number;
  worktree: string;
  blocked?: string;
}

export interface AdeSetQueuedAfterArgs {
  codeRepoId: string;
  item: string;
  after: string;
}

/** `AdeJiraPatch` — the wire's own nested Jira half of `AdeNewWorkPatch`/`AdeBranchMetaPatch`
 *  (§5.3 of Part 2's plan: `patch{..., jira, ...}`) — the store's flat key/URL pointer pair, grouped
 *  to match the read side's own nested `AdeJira`. Module-private: only `AdeNewWorkPatch`/
 *  `AdeBranchMetaPatch` (both exported) are ever imported by name outside this file; knip flagged
 *  the earlier `export` here as unused. */
interface AdeJiraPatch {
  key?: string;
  url?: string;
}

/** `AdeNewWorkPatchArgs`, widened for Part 6's own writes (§0.12) — Part 4's only field was
 *  `branchName` (the Start-new-work dialog's own draft-to-branch rename). */
export interface AdeNewWorkPatch {
  title?: string;
  jira?: AdeJiraPatch;
  startFrom?: string;
  notes?: string;
  est?: string;
  branchName?: string;
}

export interface AdeUpdateNewWorkArgs {
  codeRepoId: string;
  id: string;
  patch: AdeNewWorkPatch;
}

/** `AdeBranchMetaPatchArgs` (§0.11/§0.12) — `SetBranchMeta` never turns a branch back into
 *  "review" and nothing in Part 6 changes `kind`, so this patch has no `kind` field at all. */
export interface AdeBranchMetaPatch {
  name?: string;
  jira?: AdeJiraPatch;
  prUrl?: string;
  est?: string;
  notes?: string;
}

export interface AdeSetBranchMetaArgs {
  codeRepoId: string;
  branch: string;
  patch: AdeBranchMetaPatch;
}

/** §0.15: the candidate picker's own resolution — binds an ambiguous new-work draft to the branch
 *  Claude actually created. */
export interface AdeBindNewWorkArgs {
  codeRepoId: string;
  id: string;
  branch: string;
}

/** `AdeSetPlanArgs` — `timelineOps.ts`'s own `SetPlanArgs` (§0.13) plus the repo id every wire args
 *  type carries; `days` only for the touched ids, `order` always the full array (§0.13). */
export interface AdeSetPlanArgs {
  codeRepoId: string;
  days: Record<string, string | null>;
  order: string[];
}

/** `AdeForcePushArgs` — one call per force-push batch (§0.16); `confirmProtected` names the
 *  branches whose own protected-branch prompt the caller already confirmed (re-sent one at a
 *  time, §0.16's own "branches confirm one at a time"). */
export interface AdeForcePushArgs {
  codeRepoId: string;
  branches: string[];
  confirmProtected?: string[];
}

/** `AdeForcePushResult` — one outcome per requested branch. */
export interface AdeForcePushResult {
  branch: string;
  ok: boolean;
  error?: AdeRemoteOpError;
}

/** `AdeCandidateBranch` — `Queue.Candidates`' own row (§0.19/§5.3): every branch not yet queued or
 *  archived, newest commit first (server-sorted, no client re-sort). */
export interface AdeCandidateBranch {
  name: string;
  author: string;
  lastCommitAt: number;
  remoteOnly: boolean;
  mine: boolean;
}

export interface AdeAddBranchArgs {
  codeRepoId: string;
  branch: string;
  kind?: string;
}

/** `AdeAddNewWorkArgs` — `startFrom` `''` means `main` (Go's own default, §0.19). */
export interface AdeAddNewWorkArgs {
  codeRepoId: string;
  title: string;
  jiraKey: string;
  jiraUrl: string;
  startFrom: string;
  notes: string;
  est: string;
}

/** `AdeAddDependencyArgs` — `blocks` names the items linked as blocked by this dependency at
 *  creation (P135 §4.4). */
export interface AdeAddDependencyArgs {
  codeRepoId: string;
  title: string;
  waitingOn: string;
  expectedBy: string;
  blocks: string[];
}

/** `AdeDependencyPatchArgs` — `expectedBy` of `''` clears the date. Unexported, `AdeJiraPatch`'s own
 *  convention: nothing outside this file imports it by name, only `AdeUpdateDependencyArgs`. */
interface AdeDependencyPatch {
  title?: string;
  waitingOn?: string;
  expectedBy?: string;
}

export interface AdeUpdateDependencyArgs {
  codeRepoId: string;
  id: string;
  patch: AdeDependencyPatch;
}

export interface AdeDependencyArgs {
  codeRepoId: string;
  id: string;
}

export interface AdeSetBlockerArgs {
  codeRepoId: string;
  dependency: string;
  item: string;
  linked: boolean;
}
