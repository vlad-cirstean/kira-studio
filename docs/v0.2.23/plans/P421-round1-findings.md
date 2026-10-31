# P421 code review, round 1: findings

Base: `3a52051` (v0.2.22 squash merge; holds the last review session, v0.2.22 round 1 fixes).
Scope: `3a52051..bc9331b` (chapter/v0.2.23 head, P404-P420 Part 1, plus three pre-chapter ADE
commits `21a9c6f`, `a4aeed5`, `ef0da7c`) and `chapter/v0.2.23..stream/p420b` at `ee4bce4` (P420
Part 2, read-only, still in progress).

Severity count: 0 High, 1 Medium, 4 Low.

Not a finding: P408 sandbox `wt/<repo>` change on macOS Seatbelt is unverifiable here.

## F1 Medium: uncommitted-review mark and comment carry no content guard

- Where: `apps/kira-space/internal/ade/review_working.go:133` (`ReviewWorkingMark`), `:176`
  (`ReviewWorkingCommentAdd`); `apps/kira-space/internal/bridge/adewire/wire.go:1030`
  (`ReviewWorkingMarkArgs`), `:1055` (`ReviewWorkingCommentAddArgs`), `:1020`
  (`ReviewWorkingFileReview` has no content hash); `apps/kira-space/frontend/src/views/repo/reviewSource.ts`
  (`workingReviewSource.mark`/`addComment` send only range).
- Defect: server re-reads the worktree at click time and stores the mark or comment against that
  content (`MarkWorkingFile` stores `cur.Hash` and `cur.Text` as snapshot). Nothing ties it to the
  content the user saw. Ranges are applied in the new file's coordinates.
- Failure: agent session edits the worktree while the user reviews it (P418's main use). User views
  file, agent appends 40 lines, user clicks "mark file reviewed". Record stores state `full` over
  the new snapshot, so unseen lines count as reviewed. Promotion later carries them into the
  committed review. A range mark or comment lands on shifted lines the same way.
- Fix: return the content hash in `ReviewWorkingFileReview`. Have the client send it back with
  mark and comment-add. Refuse with `E_CONFLICT` when `cur.Hash` differs, then reload the diff.

## F2 Low: `RedactText` misses token-only URL userinfo

- Where: `apps/kira-space/internal/oplog/redact.go:15` (`urlUserinfo`).
- Defect: regex needs `user:pass@`. `https://ghp_xxx@github.com/o/r.git` has no colon, so the
  token passes through. Common for GitHub/GitLab PAT remotes.
- Failure: such a URL in git argv, git stderr tail, an in-app MCP argument (`RedactJSON` runs
  `RedactText` on every string) or an error message lands in `op_log` unmasked. It stays on disk
  30 days and shows in the Operations panel.
- Fix: mask any userinfo, colon optional: `([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s@]+@`. Add the
  token-only case to the redact unit test.

## F3 Low: branch request restores run note unconditionally

- Where: `apps/kira-space/internal/ade/branchrequest.go:238`, `setRunNote` at `:368`.
- Defect: after the wait, `RequestBranches` writes the pre-request note back with no check of the
  current note or run state. Wait runs without the task lock.
- Failure: run is cancelled or fails during the 30-minute wait, and its end path writes its own
  note. The agent's MCP ctx then ends, the request resolves abandoned, and the old note (often
  `""`) overwrites the end note. The board loses why the run ended.
- Fix: restore only when the run is still running and its note is still `noteBranchApproval`.
  Do it as one conditional update, or under the task lock.

## F4 Low: promotion inflates every comment snapshot once per path

- Where: `apps/kira-space/internal/gitsession/working_review.go:530` (`promoteWorkingComments`),
  `:356` (`PromoteWorkingReview`).
- Defect: `PromoteWorkingReview` loads all branch comments, then `promoteWorkingComments` reloads
  all of them for each path. `Comments` inflates every `anchor_content` BLOB (up to
  `MaxSnapshotBytes` each). Cost is (paths + 1) x comments x snapshot size.
- Failure: `ReviewWorkingComments`, `ReviewWorkingMark` and `ReviewWorkingCommentAdd` each run full
  promotion first. Every open diff tab reloads comments on each comments repaint event. A branch
  with 20 paths and 50 working comments on large files inflates 1,050 snapshots per call.
- Fix: load comments once in `PromoteWorkingReview`, group by path, pass each group to
  `promoteWorkingPath`. Re-read only the rows a `PromoteComment` changed.

## F5 Low (stream/p420b, in progress): proof view state rebuilt on every scroll event

- Where: `stream/p420b` `apps/kira-studio/frontend/src/proof/useStepViewState.ts:50` (`update`);
  `apps/kira-studio/frontend/src/views/console/ConsoleResultGrid.vue:250` (`expandedIds`) and
  `:258` (`onDocScroll`); `ConsoleSlickGrid.vue` `onViewportScroll` calling `emitViewState`.
- Defect: each scroll event builds a full state, filters all document rows for expansion,
  stringifies the state twice and calls `queryClient.setQueryData`. That cache write notifies every
  step view of the same revision, since all share one `viewState` query. Only the backend write is
  debounced.
- Failure: scrolling a large document page makes O(rows) work plus an O(steps) query notify per
  scroll event (60+ per second). This stutters a proof with large pages or many tabs.
- Fix: throttle reporting to one per animation frame (VueUse `useThrottleFn` or rAF). Track
  expanded ids incrementally instead of filtering `documentRows`. Update the query cache only on
  flush or unmount.

## Areas reviewed, nothing real found

- P419 file edit: hash-guarded atomic save (`renameio`), path check (`pathsafe.ValidateRelPath`),
  UTF-8 and size guards, `writeMu`, frontend conflict and BOM handling.
- P408 branch request flow: one request per task, single resolver, re-check under lock before
  create, `createBranch` re-checks kind and archiving. Space tools now always on, per plan.
- P409 artifacts: URL scheme check, per-call and per-task caps, task-scoped grant, per-source
  timeout with gaps, dedupe.
- P417 Jira: issue key regex-anchored before argv use, other-site refusal, singleflight fetch,
  bounded output.
- P415 op log: foreign ingest cursor (rowid plus `data_version` on one connection), owner lock
  liveness, startup reconcile of own running rows, prune bounds.
- P420 Part 1 proof storage: transactions, draft and step caps, prune, monotonic close, edit
  accept and reject. Part 2 screenshot save validates PNG and size.
- Migrations 0055-0060, review 0005, studio 0046: data carried correctly; old tones fit the new
  color CHECK.
- P406 generated names: Crockford alphabet, collision retry.
