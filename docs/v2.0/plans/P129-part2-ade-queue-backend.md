# P129 Part 2 — `ade` queue backend: persistence and git facts

Plan for `docs/v2.0/SPEC.md`'s `P129 Part 2` row. Planned against `v1.9` at `f29e615c` (P129 Part 1,
P130 landed).

Binding inputs: Part 1 plan §2 (whole-phase architecture, `docs/v2.0/plans/P129-part1-ade-agent-runtime.md`),
Part 1's result section in `docs/v2.0/SPEC.md`, design `docs/v2.0/design/SPEC.md` §1, §2.3, §2.4,
§3, §3.1, §5, §6, and `mockup.html`'s `renderVals()` (colors, conflicts, shares, behind, at-risk).
The design wins over the mockup; Part 1 plan §2 wins over both where it already decided.

Every path, symbol and count below was measured in this container at `f29e615c`:
`codegraph_explore` for symbols, call graphs and blast radius (`gitsession` `Conn`/`Registry`/
`RepoEntry`, `RunRemote`/`PushPreflight`/autofetch, `RunOp`/`WorktreeRemovePreflight`,
`Stacks`/`Refs`/`mergeBase`/`fileChanges`, `porcelain` merge-tree/refs/status, `ResolveBranchPr`/
`ghclient`, Space bridge `AdeService`/`Events`/settings, `ade.Tracker`, storage repos and
migrations, `main.go` `wireAde`/`wireGit`), then `Read` for exact lines.

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions (Part 1 plan §0), not reopened: `ready` and `ciFailing` dropped; PR is
`ResolveBranchPr`'s raw `State` plus `Title` (plus `Number`/`URL` for the link); Jira is a plain key
plus pasted URL; no Merge action.

1. **go-git declined, requirement named.** Design §3.1 suggests go-git for the in-memory three-way
   merge. go-git v5's `Merge` supports fast-forward only; it has no three-way tree merge, so it
   cannot answer "does A conflict with B". `git merge-tree --write-tree` (git ≥ 2.38; container has
   2.43.0) does exactly that in memory, writes no worktree or index, and already has a porcelain
   builder and parser here (`porcelain.MergeTreeArgs`, `ParseMergeTreeOutput`). Changed-path sets
   come from the existing `numstat`/`name-status` range reads. Same outcome as the design asks
   (no checkout, no temp files); different engine.
2. **`unpushed` is derived from git, not stored.** Design §6 lists `RepoPlan.unpushed`; the mockup
   sets it after a rebase. Design tooltip: "rebased locally; the remote still has the old commits".
   That is exactly "local branch diverged from its upstream" (ahead > 0 and behind > 0 against
   upstream), which git already knows. Storing it would go stale the moment Claude pushes. Served
   inside `plan.unpushed` so Part 3's `useQueue` port keeps the design's shape. Ahead-only (never
   rewritten, just not pushed) is not `unpushed`: it needs a plain push, which Claude does. The
   mockup's `rebased` flag is mock-only and dropped: real `behind` covers it.
3. **Credentials for `RunRemote` (Part 1 §2.3's open item).** Today a nil `Conn` means
   credential-free (`autofetch.go`). Ade gets one long-lived `gitsession.Conn` of its own (id
   `ade`, label `Kira Space ade`). Its `emit` maps `credential.request` to a new focused-window
   channel `kira:ade:credential` (payload verbatim: `requestId`, `repoId`, `prompt`, `masked`), and
   a bound `AdeService.ProvideCredential(requestId, secret *string)` answers through
   `Conn.ProvideCredential`. `RunRemote` gets that conn plus `RemoteDeps{Askpass: broker}`, the
   same broker `wireGit` already builds. Part 3 wires the renderer half onto the existing
   `gitCredential.ts` store (`enqueueCredentialRequest`); the snapshot carries `gitRepoId` so it
   maps `repoId` to a repo tab. The channel is an addition the SPEC row did not name.
4. **Autofetch maps to the global leaf, not per repo.** Part 1 plan §2.4 said "autofetch maps to
   the existing per-repo fetch interval". Measured: the interval is the global
   `git.fetchAutoIntervalMinutes` (`model.GitSettings`), 0 = off. Design `UiPrefs.autofetch` is a
   boolean view over it (`> 0`); no new leaf. Ade's `Conn` is not `DisableAutoFetch`ed, so holding
   a repo arms the existing timer exactly as the git module does. `lastFetchAt` is the mtime of
   `<CommonDir>/FETCH_HEAD` (covers fetches by Claude, autofetch and the git module alike).
5. **Parent (`Branch.base`) inference.** Design §6 `base` is the branch a branch stacks on;
   `behind` is measured against it (mockup: child behind parent, root behind main). Rule, first
   match:
   1. `branch.<b>.kirastackparent` (`gitops.StackParentKey`) naming another queued, non-merged
      branch;
   2. nearest queued, non-merged branch whose tip is a strict ancestor of `b`'s tip ("nearest" =
      most commits reachable from it, i.e. deepest ancestor; tie: `start_from` hint, then
      lexicographically smallest name);
   3. `start_from` hint when that branch is queued and its tip equals `b`'s merge base with it;
   4. `main`.
   Cycle guard: a parent chain revisiting a branch falls back to `main` for the branch that
   closes the cycle. `ahead`, `behind`, `files`, `commits` are measured against the parent's ref
   (`mainRef` for roots). `queuedAfter` stays ade's own override (Part 1 §2.4) and never feeds
   this rule: it is intent until Claude rebases.
6. **Main ref.** `origin/HEAD` target (`e.originHead`), else the first of the repo's
   `ReviewBaseCandidates` that resolves, trying `<defaultRemote>/<c>` then local `<c>`. None
   resolves: snapshot's `main` is null and branches carry meta only (`factsError: "noMain"`).
7. **Conflicts and shares wire form.** Backend serves facts, not order-dependent verdicts:
   `pairs: [{a, b, shared: [path], conflicts: [path]}]`. Pairs computed only where `a` is `mine`
   and `b` is `mine` or `review`, neither `parked` nor merged, neither an ancestor of the other,
   and their own-file sets (§4.2) intersect. `conflicts` = merge-tree conflicted paths ∩ `shared`;
   an intersecting pair with empty `conflicts` is a share. Design §3's `after`/ripple and the
   mockup's "nearest earlier segment" pick depend on plan order and live in Part 3's `useQueue`.
   Known limitation: a rename/delete conflict whose two paths differ and neither lies in `shared`
   is dropped (recorded in ARCHITECTURE Known open items).
8. **Merged.** `merged` = (tip reachable from `mainRef` and `had_commits`) or `ResolveBranchPr`
   raw state `merged` (covers squash and rebase merges, whose tips never become ancestors).
   `had_commits` flips to 1 the first time a snapshot sees `ahead > 0` against `mainRef`, so a
   branch just created at main's tip is not "merged". `merged_at` is persisted on first detection
   and never cleared (history day). PR-based detection runs in `Refresh` and `RepoPrs`.
9. **Archive at-risk.** Design: uncommitted files plus commits not in main; review has nothing at
   risk. Plan: dirty paths count for **any** branch with a linked worktree, review included,
   because removing a dirty worktree discards them; unmerged = `merged ? 0 : count(mainRef..tip)`
   for `mine`/`parked` only; new work has nothing at risk. Deviation for data safety, disclosed.
10. **New-work rebind.** Design: new work has no branch until its agent makes one; sessions follow.
    Rule: with `branch_name` set (Part 4's optional name), bind that name once the branch exists.
    Without it, auto-bind only when exactly one candidate exists: a local branch not queued or
    archived, checked out in a linked worktree, whose reflog creation time
    (`git reflog show --format=%ct refs/heads/<b>`, last line) is ≥ the new work's first session
    `started_at` minus 5 s. More than one candidate: stay unbound, serve `branchCandidates`, and
    bind through `BindNewWork`. The picker UI goes to Part 6 (one sentence added to its row in this
    plan's commit).
11. **Owner and isMine.** `owner`/`author` = tip commit's author name; `isMine` = tip author email
    equals `git config user.email` (case-insensitive). `AddBranch` defaults `kind` to `mine` when
    `isMine`, else `review`; caller may override. `SetBranchMeta` switches only between `mine` and `parked`.
12. **PR is a separate query.** `RepoPrs(codeRepoId)` resolves `ResolveBranchPr` per queued branch
    (errgroup, limit 4) apart from the local snapshot, so a slow or offline `gh` never delays
    git facts. `disabled`/`unavailable` pass through per repo.
13. **Colors.** Assigned in the same transaction that adds an item: first slot 0..19 unused by any
    non-archived item in the repo, else least used (tie: lowest). Mockup's "visible" = in queue,
    not archived; same set. Rebind carries the slot. Archive keeps it (history shows it).
14. **Branch identity with remote-only refs.** Items are keyed `(codeRepoId, branch short name)`.
    Facts read `refs/heads/<b>` when present, else `refs/remotes/<defaultRemote>/<b>` (review
    branches are often remote-only). Neither: `exists: false`, meta only; Part 3 renders it.
15. **No unarchive.** Design has none; out.

---

## 1. Confirmed current state

### 1.1 Part 1 left

- `apps/kira-space/internal/bridge/ade.go`: `AdeService{Deps appcore.Deps; Tracker *ade.Tracker;
  Registry *terminal.Registry}` with `AgentSessions`, `Sessions`, `PrepareLaunch`, `Send`;
  `AdeSessionsChanged(ev *Events)` broadcasts `kira:ade:sessions`.
- `apps/kira-space/internal/ade/tracker.go`: `Tracker.List()`; records keyed by `branch` xor
  `new_work_id` (migration `0004`'s CHECK).
- `storage/migrations/0004_p129_ade_sessions.sql`, `embed.go` `names` list; next is `0005`.
  `code_repos.id TEXT PRIMARY KEY`; FKs on. `ade_sessions` times are `INTEGER` unix ms.
- `repos.Repos` fields: `Settings, Windows, GitClients, GitRepoSettings, CodeRepos, Layout, Tabs,
  AdeSessions`.
- `main.go`: `wireAde(repositories, registry, emitter, events)`; `wireGit` returns
  `gitWired{runner, discovery, registry, askpassBroker, router, sock}`.

### 1.2 `gitsession` reuse points (all `apps/kira-space/internal/gitsession/`)

| Need | Existing | Note |
|---|---|---|
| Hold a repo, get refs-moved events | `NewConn(id, clientID, label, emit)`, `Conn.Open(ctx, reg, gitPath, path)`, `Conn.Entry(repoID)`, `Conn.Close()` | `Open` subscribes; emits `repo.changed` (`refsChanged`/`worktreeChanged`) |
| Credentials | `Conn.AskCredential` emits `credential.request`; `Conn.ProvideCredential(id, *secret)` | Per-conn waiter map |
| Fetch, force push | `RunRemote(ctx, conn, RemoteOpParams{Kind, Remote, Branch, Prune, ExpectedRemoteTip, ConfirmToken}, RemoteDeps{Askpass})` | Exclusive per-repo slot, busy gives `OperationInProgress`; `forcePush` re-checks lease and protected-branch gate (`ConfirmToken` = branch name) |
| Lease tip | `PushPreflight(ctx, remote, branch).RemoteTip` | nil when remote branch absent |
| Remote pick | `pickAutoFetchRemote` (origin, else sole remote) | unexported |
| Worktrees | `Worktrees(ctx)`, `WorktreeRemovePreflight(ctx, path)` | verdict clean/dirty/blocked; blockers notAWorktree, mainWorktree, currentWorktree, openInAnotherWindow, locked |
| Worktree removal | `RunOp(ctx, connID, label, OpRequest{Kind: "worktreeRemove", Path, ConfirmToken})` | token = worktree basename, required when dirty |
| Stack config | `Stacks(ctx)`, `gitops.StackParentKey` | parent config per branch |
| Ranges | `mergeBase` (cached), `branchTip`, `fileChanges(numstat, nameStatus)`, `porcelain.CombineFileChanges` | unexported |
| Main | `originHead(ctx)`, `RepoSettings().ReviewBaseCandidates` | |
| Merge prediction | `porcelain.MergeTreeArgs(base, other, mergeBase)`, `ParseMergeTreeOutput(stdout, exit)`, `runAllowingExit(ctx, args, 0, 1)` | `--write-tree --messages --name-only -z` |
| Worktree status | `runOneInDir(ctx, dir, args)`, `porcelain.StatusArgs`/`ParseStatus` | |
| PR | `ResolveBranchPr(ctx, branch) PrLookupResult{Kind ok/disabled/unavailable, PRs}` | `ghclient.PR{Number, Title, URL, State}` |
| Paths | `Summary.CommonDir` | `FETCH_HEAD` mtime |

`gitclient` caps each repo at 4 concurrent reads (`maxConcurrentReads`), so fan-out beyond 4 only
queues.

### 1.3 Settings

Leaves `section.key` in `settings`; `model.Settings{Appearance, Advanced, Git}`,
`model.SettingsPatch`; `repos/settings.go` `readGit`/`upsertGit` via `appsettings.Leaf`/
`LeafValid`/`UpsertOptional`. TS mirror `apps/kira-space/frontend/src/state/settingsDomain.ts`
(zod); defaults consumed by `tests/ui/support/bootSnapshots.ts` and `mockRuntime.ts`.

### 1.4 Events

`appevent.Events`: `Signal` (focused), `SignalTo`, `Broadcast` (payload-free). Space
`bridge.Events` wraps a private `emit appevent.Emitter` (`Emit`/`EmitTo`/`EmitFocused`) for
payloads. `ChannelAdeSessions = "kira:ade:sessions"` in `bridge/events.go`.

---

## 2. Storage

### 2.1 Migration `0005_p129_ade_queue.sql`

Item id = branch short name, or `nw:<uuid>` for new work. Git forbids `:` in ref names, so the two
spaces never collide; `ade_plan`/`ade_colors` key on the item id without a type column.

```sql
CREATE TABLE ade_branches (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('mine', 'review', 'parked')),
  name         TEXT NOT NULL DEFAULT '',   -- user title override
  draft_title  TEXT NOT NULL DEFAULT '',   -- carried from new work on rebind
  start_from   TEXT NOT NULL DEFAULT '',
  jira_key     TEXT NOT NULL DEFAULT '',
  jira_url     TEXT NOT NULL DEFAULT '',
  pr_url       TEXT NOT NULL DEFAULT '',   -- pasted link; live PR comes from RepoPrs
  est          TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',   -- Markdown
  added_at     INTEGER NOT NULL,
  had_commits  INTEGER NOT NULL DEFAULT 0,
  merged_at    INTEGER,
  archived_at  INTEGER,
  PRIMARY KEY (code_repo_id, branch)
);
CREATE TABLE ade_new_work (
  id           TEXT PRIMARY KEY,           -- 'nw:' || uuid
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  jira_key     TEXT NOT NULL DEFAULT '',
  jira_url     TEXT NOT NULL DEFAULT '',
  start_from   TEXT NOT NULL DEFAULT 'main',
  notes        TEXT NOT NULL DEFAULT '',
  est          TEXT NOT NULL DEFAULT '',
  branch_name  TEXT NOT NULL DEFAULT '',   -- optional name typed at launch (Part 4)
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,
  CHECK (title <> '' OR jira_key <> '')
);
CREATE INDEX ade_new_work_repo ON ade_new_work (code_repo_id);
CREATE TABLE ade_plan (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  day          TEXT,                       -- ISO date, NULL = Later
  position     INTEGER NOT NULL,
  queued_after TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (code_repo_id, item)
);
CREATE TABLE ade_colors (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  slot         INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 19),
  PRIMARY KEY (code_repo_id, item)
);
```

Design §6 `NewWork` has `title`, not a name; `UserMeta.names` (the title override) applies to
branches only and is `ade_branches.name`. `draft_title` keeps new work's title after rebind, so a
branch's display title stays until the user sets `name`.

Register in `migrations/embed.go`'s `names`.

### 2.2 Model and repo

- `storage/model/adequeue.go`: `AdeBranch`, `AdeNewWork`, `AdePlanRow`, `AdeColor`,
  `AdeBranchMetaPatch` (pointer fields).
- `storage/repos/adequeue.go`: one `AdeQueueRepo` owning all four tables. One repo, one concern
  (the queue): rebind, archive, add-with-color and plan edits each need a transaction spanning
  tables. Methods:
  - `Load(codeRepoID) (AdeQueueState, error)` — all four tables for one repo, one read tx.
  - `AddBranch(codeRepoID, AdeBranch) (slot int, error)` — insert plus color (§0.13) in one tx.
    Already queued: `ErrQueued`. Archived: `ErrArchived` (no unarchive, §0.15). Bridge maps both
    to `E_INVALID`.
  - `AddNewWork(AdeNewWork) (slot int, error)`.
  - `UpdateNewWork(id, patch)`, `SetBranchMeta(codeRepoID, branch, patch)`.
  - `SetPlan(codeRepoID, days map[string]*string, order []string)` — upsert days, rewrite
    positions `0..n-1` in `order`.
  - `SetQueuedAfter(codeRepoID, item, after string)`.
  - `MarkFacts(codeRepoID, hadCommits []string, merged map[string]int64)` — idempotent flips.
  - `Archive(codeRepoID, item string, at int64)` — sets `archived_at`, deletes the item's plan
    row, clears `queued_after` pointing at it.
  - `Rebind(codeRepoID, newWorkID, branch string, now int64)` — §6.4's transaction.
- `repos.Repos` gains `AdeQueue *AdeQueueRepo`.

---

## 3. `gitsession` fact reads

New file `gitsession/queuefacts.go`: exported thin wrappers so `ade` never builds git argv itself
and every read goes through the entry's own runner, read pool and caches.

```go
type InventoryRef struct {
    Ref, Short, Tip string      // refs/heads/x | refs/remotes/origin/x
    Remote          string      // "" for local
    CommitterUnix   int64
    AuthorName, AuthorEmail string
    WorktreePath    string      // %(worktreepath), local only
    Upstream        string      // %(upstream)
    UpstreamAhead, UpstreamBehind int // parsed %(upstream:track)
    UpstreamGone    bool
}
func (e *RepoEntry) BranchInventory(ctx) ([]InventoryRef, error)
func (e *RepoEntry) MainRef(ctx) (ref, tip string, ok bool, err error)          // §0.6
func (e *RepoEntry) DefaultRemote(ctx) (string, bool)                           // pickAutoFetchRemote
func (e *RepoEntry) AheadBehind(ctx, left, right string) (ahead, behind int, err error)
func (e *RepoEntry) RangeChanges(ctx, base, tip string) ([]porcelain.FileChange, error) // mergeBase + fileChanges + CombineFileChanges
func (e *RepoEntry) RangeCommits(ctx, base, tip string, limit int) ([]RangeCommit, error) // log %h%x00%s -z
func (e *RepoEntry) Ancestors(ctx, tip string, among []string) ([]string, error) // for-each-ref --merged=<tip> over among
func (e *RepoEntry) MergeTreeConflicts(ctx, a, b string) (porcelain.MergePrediction, error) // mergeBase + MergeTreeArgs + runAllowingExit(0,1)
func (e *RepoEntry) WorktreeStatus(ctx, dir string) ([]porcelain.StatusEntry, error) // runOneInDir + StatusArgs/ParseStatus
func (e *RepoEntry) ReflogCreatedAt(ctx, branch string) (int64, bool, error)
func (e *RepoEntry) ConfigValue(ctx, key string) (string, error)                 // user.email
func (e *RepoEntry) StackParents(ctx) (map[string]string, error)                 // stack config read
```

- `porcelain/inventory.go`: `InventoryArgs()` — one `for-each-ref` over `refs/heads` and
  `refs/remotes` with `%(refname)%00%(objectname)%00%(committerdate:unix)%00%(authorname)%00
  %(authoremail)%00%(worktreepath)%00%(upstream)%00%(upstream:track)`, sorted `-committerdate`,
  excluding `refs/remotes/*/HEAD`; `ParseInventory`. Reuse `HeadsRefsArgs`'s exclusion pattern.
  `%(upstream:track)` parsing reuses the existing `[ahead N, behind M]`/`[gone]` parser if
  `porcelain/refs.go` has one; else add it here.
- Exact existing type names (`FileChange`, `StatusEntry`) are whatever `porcelain` exports today;
  the implementer uses those, no new parallel types.
- `MergeTreeConflicts` passes the merge base explicitly (`--merge-base`, git ≥ 2.40) through
  `MergeTreeArgs`; no merge base (unrelated histories) returns a `clean` prediction with no paths,
  never an error.
- `gitsession/queuefacts_test.go`: `ParseInventory` table test only (upstream track variants,
  `[gone]`, empty worktree path, NUL fields). Wrappers are pass-throughs; the `ade` integration test
  covers them against real git.

Blast radius: additions only; no existing signature changes.

---

## 4. Facts engine (`apps/kira-space/internal/ade/facts.go`, pure)

Pure functions over plain inputs (inventory, tips, ancestry, file sets), no git, no DB.

### 4.1 `inferParents`

Input: queued branches (non-archived, `exists`), their tips, stack-parent config, ancestry sets
(which queued tips are ancestors of each tip, from `Ancestors`), ancestry counts, `start_from`
hints, merged set. Output: `map[branch]parent` (`""` = main). Rule and cycle guard: §0.5.

### 4.2 Branch facts

For branch `b` with parent ref `p` (`mainRef` for roots):
- `ahead, behind` = `AheadBehind(tip(b), tip(p))`.
- `files` = `RangeChanges(tip(p), tip(b))` (merge base of the two, then numstat/name-status):
  `{path, added, deleted, binary}`. These are `b`'s own files.
- `commits` = `RangeCommits(tip(p), tip(b), 50)`: `{sha, message}`, newest first; `commitCount`
  carries the full count (`ahead`).
- `dirty` = `WorktreeStatus(worktreePath)` mapped to `{code: 'M' | '??' | 'D', path}` (staged or
  unstaged modification, rename, type change: `M`; untracked: `??`; deletion: `D`). Only for a
  branch checked out in a linked worktree or the main worktree.
- `unpushedVsMain` = `count(mainRef..tip)` for at-risk.
- `upstream`, `upstreamAhead`, `upstreamBehind`: inventory; no upstream but
  `refs/remotes/<defaultRemote>/<b>` exists: that ref, ahead/behind via `AheadBehind`.
- `unpushed` (§0.2) = upstream present and `upstreamAhead > 0 && upstreamBehind > 0`.

Cache: `golang-lru/v2` (already a dependency), 512 entries per repo, keyed
`(kind, tip(p), tip(b))`. Tips are immutable object ids, so no invalidation rule beyond eviction.
Dirty status is never cached (linked worktrees are not watched).

### 4.3 `pairFacts`

Input: branches with kind, merged, own-file sets, ancestry relation, and a merge-tree callback.
For each unordered pair passing §0.7's filter with non-empty `shared`, call merge-tree (cached by
the ordered `(tipA, tipB)`), `conflicts = conflictedPaths ∩ shared`, sorted. Output sorted by
`(a, b)`. `a`/`b` ordered so a mine×review pair always has `a` mine; mine×mine by name.

### 4.4 `mergedRule`, `rebindCandidates`, `colorSlot`, `atRisk`

Direct encodings of §0.8, §0.10, §0.13, §0.9.

### 4.5 Tests (`facts_test.go`, per CLAUDE.md's bar: interacting rules)

- `inferParents`: config wins; config naming a merged branch falls through; deepest ancestor
  chosen among two; tie broken by `start_from`, then name; equal-tip `start_from` hint; cycle via
  config (a parent of b, b parent of a) resolves one side to main; root falls to main.
- `pairFacts`: mine×review conflict; mine×mine share (overlap, clean merge); parked excluded;
  merged excluded; ancestor pair excluded; review×review excluded; no shared paths: no pair and no
  merge-tree call; conflicted path outside `shared` dropped; cache hit on unchanged tips.
- `mergedRule`: ancestor without `had_commits` not merged; ancestor with it merged; PR `merged`
  wins; PR `closed` not merged.
- `rebindCandidates`: typed name exists / missing; one candidate binds; two: ambiguous; branch
  created before the session (minus 5 s) excluded; queued or archived branch excluded.
- `colorSlot`: first free; all 20 used: least used, lowest on tie; archived items ignored.
- `atRisk`: review dirty counted, unmerged not; merged mine: unmerged 0; new work: none.

---

## 5. Queue service and bound surface

### 5.1 `apps/kira-space/internal/ade/queue.go`

```go
type QueueDeps struct {
    Store      *repos.AdeQueueRepo        // Tracker already imports storage/repos
    Sessions   func(codeRepoID string) []SessionRef // from Tracker.List
    CodeRepo   func(id string) (root string, ok bool)
    Registry   *gitsession.Registry
    GitPath    func() string              // Discovery.Status(ctx, git.path setting).Path
    Askpass    *gitaskpass.Broker
    CloseTerminal func(id string) error   // terminal.Registry.Close
    OnRepoChanged func(codeRepoID string)
    OnCredential  func(payload any)
    Now        func() time.Time
}
type Queue struct { … }
func NewQueue(QueueDeps) *Queue
func (q *Queue) Snapshot(ctx, codeRepoID) (RepoSnapshot, error)
func (q *Queue) Prs(ctx, codeRepoID) (RepoPrs, error)
func (q *Queue) Candidates(ctx, codeRepoID) ([]CandidateBranch, error)
func (q *Queue) AddBranch / AddNewWork / UpdateNewWork / SetBranchMeta / SetPlan / SetQueuedAfter / BindNewWork
func (q *Queue) Refresh(ctx, codeRepoID) (RefreshResult, error)
func (q *Queue) ForcePush(ctx, codeRepoID, branches, confirm []string) ([]ForcePushResult, error)
func (q *Queue) ArchiveRisk(ctx, codeRepoID, item) (ArchiveRisk, error)
func (q *Queue) Archive(ctx, codeRepoID, item string, discard bool) error
func (q *Queue) ProvideCredential(requestID string, secret *string) bool
func (q *Queue) Close()
```

Layering: `internal/ade` never imports `bridge` (Space `layering_test.go`). It already imports
`storage/model`, `storage/repos` and `internal/terminal` (`tracker.go`); adding `gitsession` and
`gitaskpass` keeps domain-over-domain imports only. `Sessions` reads the same package's `Tracker`.

Behavior:
- **Repo holding.** First use of a code repo opens it on ade's `Conn` (`Conn.Open(ctx, registry,
  gitPath, root)`), keyed by `RepoSummary.RepoID`. Held until `Close` (app shutdown) or the code
  repo disappears (`CodeRepo` lookup fails: `Conn.CloseRepo`).
- **Per-repo mutex** serializes `Snapshot`'s rebind step, writes, `Refresh`, `ForcePush`,
  `Archive` for one repo. Pure reads of git run under the entry's own pool.
- **Snapshot**, in order:
  1. `Load` from store; `BranchInventory`, `MainRef`, `StackParents`, `user.email`.
  2. Resolve queued refs (§0.14).
  3. Rebind check (§0.10); a bind writes, then re-`Load`s.
  4. `Ancestors` for each queued tip over the queued set; `inferParents`.
  5. Branch facts (errgroup, limit 4), then pairs.
  6. `MarkFacts` for new `had_commits` and git-rule merges.
  7. Assemble wire. Archived items go to `history` with meta only.
- **Signal.** `Conn` emits `repo.changed` for a held repo; a 250 ms per-repo debounce then calls
  `OnRepoChanged(codeRepoID)`. Every write also calls `OnRepoChanged` (no debounce).

### 5.2 Wire types (`bridge/ade.go`, mirrored by Part 3 in `frontend/src/ade/wire.ts`)

```go
type AdeRepoSnapshot struct {
    CodeRepoID, GitRepoID string
    Main       *AdeMain              // {name, ref, tip}; nil = unresolved (§0.6)
    Branches   []AdeBranchWire
    NewWork    []AdeNewWorkWire
    Plan       AdePlanWire           // {day map[item]ISO, order []item, queuedAfter map[item]item, unpushed map[item]true}
    Colors     map[string]int        // item -> slot
    Pairs      []AdePair             // {a, b, shared, conflicts}
    History    []AdeHistoryItem      // {item, kind, title, branch, mergedAt?, archivedAt}
    LastFetchAt *int64
    AutofetchMinutes int             // git.fetchAutoIntervalMinutes echo
    WorktreeBasePath string          // repo's configured worktree base, for Part 4's new-worktree path
}
type AdeBranchWire struct {
    ID, Branch, Kind, Name, DraftTitle, StartFrom string
    Exists bool; Ref, Tip string
    Owner, AuthorEmail string; IsMine bool; LastCommitAt int64
    Base string                         // parent item id, "" = main
    Ahead, Behind int
    Merged bool; MergedAt *int64
    Worktree string                     // path, "" = none
    Files   []AdeFile                   // {path, added, deleted, binary}
    Commits []AdeCommit                 // {sha, message}; CommitCount int
    Dirty   []AdeDirty                  // {code, path}
    Upstream string; UpstreamAhead, UpstreamBehind int
    Jira AdeJira                        // {key, url}
    PrURL, Est, Notes string
    AddedAt int64
}
type AdeNewWorkWire struct {
    ID, Title, StartFrom, BranchName, Est, Notes string
    Jira AdeJira; CreatedAt int64
    BranchCandidates []string           // §0.10 ambiguous case
}
type AdeCandidateBranch struct { Name, Author string; LastCommitAt int64; RemoteOnly bool }
type AdeRepoPrs struct { Kind string; Branches map[string]*AdePr } // Kind ok|disabled|unavailable
type AdePr struct { Number int; Title, URL, State string }        // raw ResolveBranchPr state
```

`Branch.sessions` (design §6) is Part 1's `Sessions()`, joined in `useQueue` by `branch`/
`new_work_id`; not duplicated here. Design `Branch.id` = item id; `repo` = `codeRepoId`.

`WorktreeBasePath`: the repo's existing per-repo leaf `kiraSpace.worktree.basePath`
(`model.GitRepoSettings.WorktreeBasePath`, read via `RepoEntry.RepoSettings()`), served verbatim.
`""` means no override; Part 4 then applies the git module's `WorktreeDialog` default. No new
setting.

### 5.3 `AdeService` additions (`apps/kira-space/internal/bridge/ade.go`)

New field `Queue *ade.Queue`. Every method validates args (`Validate()` returning `ipcerr`
`E_INVALID`), maps store/git errors through the existing `adeTrackerError`-style helper to
`InternalErr`, and never exposes raw git stderr beyond `RemoteOpError.Message`.

| Method | Args | Result |
|---|---|---|
| `RepoSnapshot` | `codeRepoId` | `AdeRepoSnapshot` |
| `RepoPrs` | `codeRepoId` | `AdeRepoPrs` |
| `CandidateBranches` | `codeRepoId` | `[]AdeCandidateBranch` (not queued, not archived, newest first; remote-only dedup against local) |
| `AddBranch` | `codeRepoId, branch, kind?` | item id |
| `AddNewWork` | `codeRepoId, title, jiraKey, jiraUrl, startFrom, notes, est` | item id |
| `UpdateNewWork` | `codeRepoId, id, patch{title, jira, startFrom, notes, est, branchName}` | — |
| `SetBranchMeta` | `codeRepoId, branch, patch{name, kind, jira, prUrl, est, notes}` | — (review: notes only, design "keep your own notes") |
| `SetPlan` | `codeRepoId, days{item: ISO or null}, order []item` | — |
| `SetQueuedAfter` | `codeRepoId, item, after` (`""` clears) | — |
| `BindNewWork` | `codeRepoId, id, branch` | — |
| `Refresh` | `codeRepoId` | `{refsChanged int, newlyMerged []item, error?: RemoteOpError}` |
| `ForcePush` | `codeRepoId, branches []string, confirmProtected []string` | `[]{branch, ok, error?}` |
| `ArchiveRisk` | `codeRepoId, item` | `{dirty []AdeDirty, unmerged int, worktree string, blocked?: string}` |
| `Archive` | `codeRepoId, item, discard bool` | — |
| `ProvideCredential` | `requestId, secret *string` | `bool` |

Validation:
- Jira key `^[A-Z][A-Z0-9]+-\d+$`; URLs `http`/`https` only, ≤ 2048 bytes; `prUrl` must contain
  `/pull/\d+`. Part 6 does the paste parsing; backend rejects malformed input.
- `est` `^\d+(\.\d+)?[hd]$` or empty (Part 6's hours/days toggle).
- `notes` ≤ 1 MiB; titles/names ≤ 500 chars; ISO dates `YYYY-MM-DD` parsed with `time.Parse`.
- `branch`/`branchName`/`startFrom`/`after`: non-empty, no NUL/space/`:`/leading `-`, ≤ 255
  bytes; real ref validity is git's (`exists: false` otherwise).
- `kind` enum; `SetBranchMeta.kind` only between `mine` and `parked`.
- Items in `SetPlan`/`SetQueuedAfter` must be non-archived items of that repo; `after` ≠ item.

Package functions in `bridge`:
- `const ChannelAdeRepo = "kira:ade:repo"`, `ChannelAdeCredential = "kira:ade:credential"`
  (`events.go`).
- `AdeRepoChanged(ev *Events, codeRepoID string)` — `emit.Emit(ChannelAdeRepo,
  {codeRepoId})`, all windows.
- `AdeCredentialRequested(ev *Events, payload any)` — `EmitFocused`.

Bindings: regenerate (`wails3 generate bindings`, per `docs/DEV_ENVIRONMENT.md`), FQN gate on
Space bindings unchanged for every other service.

### 5.4 Wiring (`apps/kira-space/main.go`)

`wireAde` gains `gitWired` (registry, askpass broker, discovery) and returns the `*ade.Queue`;
`AdeService.Queue` set at registration; teardown calls `queue.Close()` (closes the `Conn`,
releasing held entries) before `shutdownAde`'s hook stop. `wireGit` runs before `wireAde`
already or is moved first; confirm order in `main`.

---

## 6. Refresh, force push, archive, credentials, rebind

### 6.1 Refresh

1. Per-repo mutex. Remote = `DefaultRemote`; none: `{error: noRemote}`.
2. Tips before = last snapshot's cached tips for queued branches (or a fresh `BranchInventory`).
3. `RunRemote(ctx, conn, {Kind: "fetch", Remote, Prune: true}, {Askpass})`. `OperationInProgress`
   (autofetch or git module holds the slot) returns that error kind; UI shows `fetching…`.
4. Recompute snapshot. `refsChanged` = queued branches plus main whose resolved tip moved.
5. PR merged check: `ResolveBranchPr` for queued mine branches not merged (errgroup, limit 4).
6. `MarkFacts`; `newlyMerged` = items whose `merged_at` was set in this call.
7. `OnRepoChanged`.

Pairs rerun implicitly: cache keys are tips, so only moved refs miss the cache (design §3.1 "reruns
the conflict check for every ref that moved").

### 6.2 Force push

For each branch in order: remote = upstream's remote (else `DefaultRemote`); lease =
`PushPreflight(ctx, remote, branch).RemoteTip`; `RunRemote(ctx, conn, {Kind: "forcePush", Remote,
Branch, ExpectedRemoteTip: lease, ConfirmToken: branch if in confirmProtected})`. Failure (lease
rejected, `ProtectedBranch`, auth) is recorded for that branch and the loop continues. Implementer
confirms in `remote_test.go` that `forcePush` pushes `refs/heads/<b>` to the same-named remote
branch; if it needs an explicit refspec parameter, that is a param already present, not a new
path.

### 6.3 Archive

1. Per-repo mutex. Item is non-archived; new work skips to step 5.
2. Worktree = inventory `WorktreePath` of `refs/heads/<b>`. Main worktree: no removal.
3. `WorktreeRemovePreflight(ctx, path)`: `blocked` (open in another window, locked, …): `E_INVALID`
   with the blocker; nothing changes. `dirty` and `!discard`: `E_INVALID` `atRisk` (Part 4's
   dialog decides; `Send to Claude, then archive` re-calls after the agent's Stop).
4. Stop running sessions of the item: `CloseTerminal(terminalId)` for each `running` session
   (Tracker then marks them `stopped` through its existing reconcile).
5. Linked worktree: `RunOp(ctx, "ade", label, {Kind: "worktreeRemove", Path, ConfirmToken:
   basename(path) only when discard})`. Failure aborts before any DB change.
6. `Store.Archive` (tx); `OnRepoChanged`.

The branch, notes, links and color stay (design tooltip). At-risk numbers for the dialog come from
`ArchiveRisk` (§0.9); `Archive` itself trusts only `discard` plus preflight, not a stale count.

### 6.4 Rebind transaction

`Store.Rebind`: insert `ade_branches` (`kind` from `isMine`, `draft_title` = new work's title,
`start_from`, jira, notes, est); re-key `ade_plan.item` and `ade_colors.item` from `nw:<uuid>` to
the branch; update `queued_after` values pointing at the old id; `UPDATE ade_sessions SET
branch=?, new_work_id='' WHERE new_work_id=?`; delete the `ade_new_work` row. Then
`OnRepoChanged` and `AdeSessionsChanged` (sessions moved). `BindNewWork` runs the same path with an
explicit branch that must exist and be unqueued.

### 6.5 Credentials

Ade's `Conn` emits `credential.request`; its emit func calls `OnCredential`, which calls
`AdeCredentialRequested` (`kira:ade:credential`, focused window). Unanswered prompts
end when `RunRemote`'s context ends (existing `AskCredential` select). Nothing is logged or
persisted.

---

## 7. UiPrefs as settings leaves

New section `ade` (Go `model.AdeSettings`, `model.AdePatch`; `readAde`/`upsertAde` in
`repos/settings.go`; `Settings.Ade`, `SettingsPatch.Ade`):

| Leaf | Type | Default | Valid |
|---|---|---|---|
| `ade.panelWidth` | int | 0 (= half window) | 0 or 340..4000 |
| `ade.allAgentsFilter` | string | `active` | `active`/`older` |
| `ade.horizonDays` | int | 14 | 1..365 |
| `ade.historyDays` | int | 14 | 1..365 |
| `ade.extraDays` | []string | `[]` | ISO dates, ≤ 1000 |
| `ade.offDays` | []string | `[]` | ISO dates, ≤ 1000 |
| `ade.workWeekendDays` | []string | `[]` | ISO dates, ≤ 1000 |
| `ade.workdayHours` | number | 6 | 1..24 |
| `ade.spanDayShare` | number | 0.5 | 0.05..1 |

`historyOpen` is runtime only (Part 1 §2.4). `autofetch` is `git.fetchAutoIntervalMinutes` (§0.4).
TS: extend `settingsDomain.ts` zod schema and defaults; update `bootSnapshots.ts` and
`mockRuntime.ts` where they spell the settings shape; if `packages/shared/domain/settings.ts`
mirrors Space's shape, extend it too (implementer checks with `codegraph_explore` on
`defaultSettings`). No UI reads them yet (Part 3+).

---

## 8. Steps and commits

Record `P129P2_START=$(git rev-parse HEAD)` and save Space's generated bindings file list and
every non-ade service's `ByName` lines before step 1. Every commit passes the pre-commit hook and
`go build ./...`.

1. **`feat(space): ade queue storage`** — migration `0005`, `embed.go`, `model/adequeue.go`,
   `repos/adequeue.go`, `repos.Repos.AdeQueue`.
2. **`feat(space): ade settings leaves`** — §7, Go and TS; regenerate bindings (settings types).
3. **`feat(gitsession): queue fact reads`** — §3 plus `porcelain/inventory.go` and its parser test.
4. **`feat(space): ade facts engine`** — `ade/facts.go`, `ade/facts_test.go`.
5. **`feat(space): ade queue service`** — `ade/queue.go`, `ade/queue_test.go` (§9.1).
6. **`feat(space): AdeService queue surface`** — `bridge/ade.go`, `bridge/events.go`, `main.go`
   wiring and teardown; regenerate bindings; FQN gate.
7. **`docs: ARCHITECTURE records ade queue backend (P129 Part 2)`** — §8.2.
8. Result section `## P129 Part 2 result` in `docs/v2.0/SPEC.md`.

### 8.1 File inventory

New: `apps/kira-space/internal/storage/migrations/0005_p129_ade_queue.sql`,
`apps/kira-space/internal/storage/model/adequeue.go`,
`apps/kira-space/internal/storage/repos/adequeue.go`,
`apps/kira-space/internal/gitsession/queuefacts.go`,
`apps/kira-space/internal/gitclient/porcelain/{inventory.go,inventory_test.go}`,
`apps/kira-space/internal/ade/{facts.go,facts_test.go,queue.go,queue_test.go}`.

Edited: `storage/migrations/embed.go`, `storage/repos/{repos.go,settings.go}`,
`storage/model/settings.go`, `bridge/{ade.go,events.go,settings.go if it validates patches}`,
`apps/kira-space/main.go`, `apps/kira-space/frontend/src/state/settingsDomain.ts`,
`tests/ui/support/{bootSnapshots.ts,mockRuntime.ts}` as needed, generated Space bindings,
`docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`.

No renderer feature code: Part 3 consumes this.

### 8.2 `docs/ARCHITECTURE.md`

- Kira Space ade paragraph: queue tables, item ids, facts pipeline (inventory, parents, ranges,
  pairs), merge-tree over go-git with the requirement, merged rule, rebind rule, ade's own `Conn`
  and `kira:ade:credential`, `kira:ade:repo` debounce, Refresh/ForcePush/Archive paths.
- Known open items: rename/delete conflict limitation (§0.7); linked-worktree dirty state not
  watched (refreshes on snapshot only).

---

## 9. Verification

Measure `go test`, `test:unit`, `test:ui:space`, `test:ui:studio` at `P129P2_START` first.

| Command | Expected |
|---|---|
| `go build ./...`, `go vet ./...`, `bun run lint:go` | Clean |
| `go test ./apps/kira-space/internal/...` | Pass; layering test passes |
| `go test -race ./apps/kira-space/internal/ade/ ./apps/kira-space/internal/gitsession/` | Pass |
| Space bindings `adeservice.ts` | Part 1's 4 methods plus exactly §5.3's 15 |
| FQN gate, every other Space service | Identical to saved lines |
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `bun run test:unit`, `test:ui:space`, `test:ui:studio` | Baseline unchanged |

### 9.1 Tests (per CLAUDE.md's bar)

- `facts_test.go` (§4.5): the conflict/share computation plus interacting rules the SPEC row
  names.
- `queue_test.go`, integration against real git in `t.TempDir()`: bare `origin`, a clone with
  `main`, linked worktrees via `git worktree add`, real `storage.OpenAt`, real `Registry`. Cases:
  1. Two mine branches editing the same line: pair with `conflicts = [path]`; same file,
     different hunks: pair with `shared` only; different files: no pair.
  2. Mine × review conflict, review authored by another email: `kind` review, `owner` set.
  3. Stack: `b` created on `a`: `base = a`, `behind` 0; commit on `a`: `b.behind = 1`.
  4. `files` deltas and binary flag; `commits` newest first; `dirty` codes `M`, `??`, `D`.
  5. Merged: merge `a` into main on origin, `Refresh`: `newlyMerged = [a]`, `merged_at` set;
     branch at main's tip without commits not merged.
  6. Refresh fetches: origin gains a commit on a review branch; `refsChanged = 1`; pair rerun.
  7. Force push: rewrite `a` locally (`unpushed` true), `ForcePush` succeeds and `unpushed` clears;
     origin moved meanwhile: lease rejection reported for that branch, loop continues.
  8. Archive: clean worktree removed, row archived, plan row gone, color kept; dirty without
     `discard`: `atRisk` error, nothing changed; dirty with `discard`: removed.
  9. Rebind: new work plus a stubbed session record; branch created in a linked worktree after
     session start: bound, plan/color/session re-keyed; two candidates: unbound,
     `branchCandidates` of both.
  10. `-race`: concurrent `Snapshot` × 8 with a `Refresh` and a `SetPlan` on one repo.
- No test for repo CRUD, wrappers, settings leaves, or validation helpers.

### 9.2 Live check

Server-mode Space (`go build -tags server`, per `docs/DEV_ENVIRONMENT.md`) against this repo:
`AddBranch` two local branches, `RepoSnapshot` returns facts and pairs; `RepoPrs` returns
`disabled` or `unavailable` without `gh` auth (say which in the result section). No UI.

---

## 10. Closing audit

| Check | Command | Pass |
|---|---|---|
| No go-git | `rg -n 'go-git' go.mod apps/kira-space` | Empty |
| Only three git mutations | `rg -n 'RunRemote\|RunOp' apps/kira-space/internal/ade` | fetch, forcePush, worktreeRemove only |
| No argv built in `ade` | `rg -n '"(merge-tree\|for-each-ref\|log\|status)"' apps/kira-space/internal/ade` | Empty |
| No derived PR flags | `rg -n 'ready\|ciFailing\|Approved\|review(Decision\|State)' apps/kira-space/internal/ade apps/kira-space/internal/bridge/ade.go` | No field or derivation |
| Jira plain | `rg -n -i 'jira' apps/kira-space/internal` | key/url storage and validation only |
| Layering | Space `layering_test.go` | Pass |
| Every design §6 field served | Map `AdeRepoSnapshot`/`AdeRepoPrs`/settings to design §6 field by field in the result section | No field missing except dropped `ready`, `ciFailing`, Jira title/status |
| No renderer feature code | `git diff --stat $P129P2_START -- apps/kira-space/frontend/src` | Bindings and `settingsDomain.ts` only |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Snapshot cost on many branches (git spawns) | Tip-keyed LRU; entry read pool caps at 4; errgroup limit 4; dirty status is the only uncached read |
| O(n²) pairs | Filter by own-file intersection before merge-tree; merge-tree cached by tips |
| Linked-worktree edits not watched | Snapshot recomputes dirty each call; Part 3 invalidates on agent `Stop`; Known open item |
| Refresh collides with autofetch slot | `OperationInProgress` surfaced; caller retries |
| Rebind heuristic misfires | Only binds on exactly one candidate created after the session; typed name wins; ambiguous goes to user (Part 6) |
| `%(worktreepath)` needs git ≥ 2.23 | Container 2.43.0; Discovery's minimum version already exceeds it (implementer confirms) |
| Ade `Conn` holds entries forever, arming autofetch | Intended (§0.4): matches the global setting's meaning |
| Parent inference disagrees with user intent | `kirastackparent` config wins; `queuedAfter` override is Part 4's |

---

## 12. Acceptance, mapped to the SPEC row

| SPEC row wording | Where |
|---|---|
| Tables for per-branch meta (kind, names, links, estimate, notes as Markdown, archivedAt) | §2.1 `ade_branches` |
| plan (day, order, queuedAfter, unpushed) | §2.1 `ade_plan`; `unpushed` derived (§0.2) |
| colors (assigned once, never reassigned) | §2.1 `ade_colors`, §0.13 |
| new work (with the new-work-to-branch rebind for sessions) | §2.1 `ade_new_work`, §0.10, §6.4 |
| `UiPrefs` as Space settings leaves | §7 |
| worktrees, ahead/behind, changed files with deltas, commits, dirty list, owner/author, merged detection, candidate branches newest first | §3, §4.2, §0.8, §0.11, §5.3 `CandidateBranches` |
| conflicts/shares/behind with `git merge-tree --write-tree` and changed-path sets, go-git declined with requirement named | §0.1, §0.7, §4.3 |
| PR as `ResolveBranchPr`'s raw state and title only | §0.12, `AdePr` |
| Jira plain key plus pasted URL | §2.1, §5.3 validation |
| Refresh (fetch through `RunRemote`, rerun facts for moved refs, detect merged) | §6.1 |
| Force push (`--force-with-lease` through `RunRemote`) | §6.2 |
| Archive with at-risk check and worktree removal through `RunOp` | §0.9, §6.3 |
| `kira:ade:repo` push signal | §5.1, §5.3 |
| `ready`/`ciFailing` not computed | §10 audit |
| Every other design §6 field served by `AdeService` | §5.2, §10 audit |
| Go tests for the conflict/share computation | §4.5, §9.1 cases 1-2 |
