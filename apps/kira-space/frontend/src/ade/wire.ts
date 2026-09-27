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

/** `AdeRepoSnapshot` — the queue board's own full read (§5.1 of Part 2's plan). */
export interface AdeRepoSnapshot {
  codeRepoId: string;
  gitRepoId: string;
  main?: AdeMain;
  branches: AdeBranch[];
  newWork: AdeNewWork[];
  plan: AdePlan;
  colors: Record<string, number>;
  pairs: AdePair[];
  history: AdeHistoryItem[];
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
}

/** `gitsession.RemoteOpError` — `AdeRefreshResult.error`'s own shape. */
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
