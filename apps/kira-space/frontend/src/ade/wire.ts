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

/** `AdeFocusSessionArgs` — `FocusSession`'s own args (P129 Part 7 §0.9). `itemId` is `''` for an
 *  orphan row (no queue item to select, only the repo tab). */
export interface AdeFocusSessionArgs {
  sessionId: string;
  itemId: string;
}

/** `kira:ade:open-session`'s own payload — `FocusSession`'s emit half, EmitTo'd to the window it
 *  just focused. */
export interface AdeOpenSessionEvent {
  codeRepoId: string;
  itemId: string;
  sessionId: string;
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
 *  `openTerminalSession` call is what actually spawns it (§0.14). `cwd` (P129 Part 7 §0.12) is the
 *  effective cwd — `args.Cwd` for a new launch, the recorded (and possibly just-recreated) cwd for a
 *  resume — always what `launch.ts`'s `deliver` opens the terminal at. */
export interface AdeLaunch {
  terminalId: string;
  sessionId: string;
  command: string;
  cwd: string;
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

interface AdeDirty {
  code: string;
  path: string;
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
