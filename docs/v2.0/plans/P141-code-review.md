# P141 code review, round 1 of 2

Base: `771512bc` (P108 close-out). Head reviewed: `9a87cade` (P140 result).
Reviewer: one Opus pass, all three dimensions (A = architecture/structure/maintainability/security,
F = functional correctness/business logic, P = performance/resource efficiency).
Severity: high (data loss, security, user-visible wrong result), medium (real bug on a narrower
path, leak, sizeable waste), low (maintainability or rule breach with no runtime harm).

Status: in progress. Areas land as they finish.

## Findings

### Area 1: Kira Space ADE backend (`internal/ade`, `bridge/ade.go`, `storage/repos/adequeue.go`, migrations 0003-0007)

**F1. Rebind derives `kind` from the tip author, so fresh new work turns into a review branch.**
Dimension F. Severity high.
`apps/kira-space/internal/ade/queue.go:1124` (`bindNewWorkLocked` calls `resolveKind(row, userEmail, "")`).
Rebind runs on the first Snapshot after the agent creates its branch, usually before any commit lands. The tip
is then the start point's commit (main's tip), so `kind` follows whoever last committed to main. In a team repo
that is often someone else, so the user's own new work persists as `kind=review`, `work_type=review`. Nothing
re-derives `kind` later. The blocker rows rekeyed at `storage/repos/adequeue.go:820` then sit on a review branch,
breaking the invariant `checkBlockable` and `ErrWorkTypeBlocked` enforce.
Fix: a rebind always binds as `mine` (new work is the user's by construction; keep the new work's own
`work_type`). Drop the `kind` derivation from `bindNewWorkLocked` and `Store.Rebind`'s review branch.

**F2. Claude session id from a hook event reaches a shell command unquoted.**
Dimension A (security). Severity medium.
`apps/kira-space/internal/ade/tracker.go:400-408` stores `ev.SessionID` from any `SessionStart` hook body
verbatim. `apps/kira-space/internal/ade/command.go:10-17` concatenates it into the command that runs as
`$SHELL -l -i -c <command>` on the next resume. The hook socket is token-guarded, so this is defense in depth,
but one malformed or hostile body persists a shell payload that runs on a later click.
Fix: accept the id only when `uuid.Parse` succeeds (ignore the event otherwise), and quote with `quotePOSIX`
in `newCommand`/`resumeCommand`.

**F3. Two resume Prepares for one stopped record both succeed.**
Dimension F. Severity low.
`apps/kira-space/internal/ade/tracker.go:203-254`. Prepare checks `State == stopped` but reserves nothing. Two
quick resumes (double click, two windows) each get a pending intent; both Composes run `MarkRunning`, spawning
two `claude --resume <same id>` processes on one record. `byRecord` keeps only the second terminal, so the
first terminal's `live` entry leaks and its activity is attributed to nothing.
Fix: in Prepare's resume branch, refuse with `ErrSessionRunning` when `t.pending` or `t.byRecord` already holds
that record id (check under `t.mu`).

**F4. Snapshot spawns git work it can derive or already did.**
Dimension P. Severity medium.
`apps/kira-space/internal/ade/queue.go:787-794` runs `for-each-ref --merged=<mainTip> <ref>` per existing
branch, per Snapshot, uncached. `depths[b]` (`queue.go:617`, `rev-list --left-right --count tip...main`) already
answers it: left count 0 means tip is reachable from main. `reconcileNewWork` (`queue.go:1012-1023`) also re-runs
`BranchInventory` and `git config --get user.email`, which `snapshotLocked` runs again at `queue.go:486-497`.
Snapshot fires on every debounced `repo.changed`, so each queued branch costs at least one extra process.
Fix: `tipReachableFromMain = sc.hasMain && sc.depths[b.Branch] == 0`. Read inventory and `user.email` once in
`snapshotLocked`, pass both into `reconcileNewWork`, and re-read inventory only when a rebind happened.

**F5. `ade_sessions` grows forever and every read scans and stats all of it.**
Dimension P. Severity medium.
Nothing deletes `ade_sessions` rows. `bridge/ade.go:207-216` (`Sessions`) returns every row ever recorded and
`os.Stat`s each cwd (`cwdMissing`, `bridge/ade.go:85`) on every `AdeSessionsChanged` refetch. In
`main.go` `adeSessionsFor` calls `tracker.List()` (full table) and filters in Go. `reconcileHeuristicNewWork`
calls it once per active new-work item per Snapshot (`queue.go:1070`), inside the repo mutex.
Fix: add `AdeSessionsRepo.ListByRepo(codeRepoID)` on the existing `ade_sessions_repo` index and call it once
per `reconcileNewWork`. Bound `Sessions()` (only stopped sessions newer than a cutoff, or stat only rows the
renderer shows), or give the table a retention rule.

**F6. ArchiveRisk reports zero unmerged commits when MainRef fails.**
Dimension F. Severity low.
`apps/kira-space/internal/ade/queue.go:1670` (`if ..., err := entry.MainRef(ctx); err == nil && hasMain`) drops
the error. A transient git failure makes the archive confirm show "nothing at risk" for a branch with unmerged
work. Every other git error in this function is returned.
Fix: return the `MainRef` error like the surrounding calls do.

**F7. AdeQueueRepo write scoping and one false guard comment.**
Dimension A. Severity low.
`apps/kira-space/internal/storage/repos/adequeue.go:503`: `UpdateNewWork` updates `WHERE id = ?`, ignoring the
`codeRepoID` `Queue.UpdateNewWork` receives, and allows editing archived new work. The change signal then goes to
whatever repo the caller named. `adequeue.go:515-517` says bridge validation restricts a review branch's patch
to Notes alone, and `frontend/src/ade/mutations.ts:113-115` says Go refuses the rest. No such check exists
(`bridge/ade.go:1010-1040`, `Queue.SetBranchMeta`); only the UI hides the inputs.
Fix: add `AND code_repo_id = ? AND archived_at IS NULL` to the update and its est select. Either add the
review-branch restriction in `Queue.SetBranchMeta` (load the row's kind) or delete the claim from both comments.

### Area 2: Kira Space ADE frontend data layer (`frontend/src/ade`)

**F8. Every queue write computes the full Snapshot twice.**
Dimension P. Severity medium.
Each Go write (`queue.go` `AddBranch`, `SetPlan`, `Archive`, `ForcePush`, ...) calls `notifyChanged`, which emits
`kira:ade:repo`; `queries.ts:173-176` invalidates the snapshot (and PRs) on it. Each mutation in
`frontend/src/ade/mutations.ts` (lines 86-312) also invalidates the same keys in `onSettled`, and `useAdeRefresh`
does too (`queries.ts:124-125`). The two invalidations land milliseconds apart. TanStack's default
`cancelRefetch: true` drops the first fetch client-side, but Go keeps computing it under the repo mutex, then
runs a second full Snapshot. A Snapshot is several git spawns per queued branch (F4).
Fix: rely on the push for writes whose Go method calls `notifyChanged` and drop the duplicate `onSettled`
snapshot/PR invalidations. Keep only invalidations Go does not push (`adeSessionsKey` after launch,
candidates).

**F9. Agent tool events recompute the whole queue view.**
Dimension P. Severity medium.
`AdeRepoView.vue:249-268` wraps the full `useQueue(...)` derivation (calendar, stacks, segments, bands, panel)
in one `computed` that reads `agentSessionsStore.activity`. The store `set`s a new activity object on every hook
event (`createAgentSessionsStore.ts:57-60`), so each `PreToolUse`/`PostToolUse` of an agent in this repo rebuilds
every segment, band and item object, and re-renders the timeline. `useQueue` only needs activity for `acts`,
`agents` and the panel agent list. `AdeAllAgentsView.vue:68-80` does the same for every repo with a session.
Fix: run `useQueue` without activity, and derive `acts`/`agents`/panel agents in a second, cheap `computed` keyed
on each session's phase (a `computed` map of `terminalId -> ActivityKind` that only changes when a phase does).

**F10. Shared retargeted mutations read the repo id at settle time.**
Dimension F. Severity low.
`state/adeActions.ts:113-123` binds one mutation per kind to `currentRepoId`, retargeted before each call.
`mutations.ts` callbacks call `toValue(codeRepoId)` when they run, not when the mutation started. If the user
acts on repo B while repo A's call is in flight, A's `onSettled` invalidates B's keys, and `useAdeSetPlan`'s
`onError` (`mutations.ts:180-184`) writes A's previous snapshot into B's cache entry.
Fix: read the repo from the mutation variables (`args.codeRepoId`; every args type carries it) in
`onMutate`/`onError`/`onSettled`, and return it in the `onMutate` context.

**F11. Notes typed for one item can save onto another.**
Dimension F. Severity medium.
`AdeNotesEditor.vue:21-31,58-68` emits `save` with only the Markdown. `AdeDetailsTab.vue:180` forwards it to
`useItemMeta.setNotes` (`useItemMeta.ts:123-128`), which reads `toValue(panel)` at call time. When the selected
item changes without an editor blur, the item-switch watcher's `flush()` and any pending 600 ms
`debouncedFlush` both write the outgoing item's text onto the incoming item. One real trigger: a rebind removes
the selected `nw:` item, and `useQueue` falls back to the first item while the user is typing. The incoming
item's notes are overwritten, and the outgoing item's last edit is lost.
Fix: track the item id the editor content belongs to, emit `save` with `(itemId, markdown)`, and have
`useItemMeta` write to that id (branch name or new-work id) rather than the current panel.
