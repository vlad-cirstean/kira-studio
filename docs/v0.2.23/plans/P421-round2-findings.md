# P421 code review, round 2: findings

Base: `3a52051` (v0.2.22 squash merge), same as round 1.
Scope: `3a52051..d803205` (chapter/v0.2.23 head). Treated as unreviewed: round 1 fixer commits
`233ecdd`, `665c7c0`, `9c1666a`, `cfc109b`, `5cb74d2`; all of P420 Part 2 (`ca6457f..1bc94f7`);
Go convention fixes `39b1ee1`; Playwright config `a4f02b7`; test wait changes `1cc66e4`.

Severity count: 0 High, 1 Medium, 5 Low.

Not a finding: P408 sandbox `wt/<repo>` change on macOS Seatbelt is unverifiable here.

## Round 1 fixes re-checked

- F1 (content hash guard): diff-tab path holds only partly. See R2-F1 (hash and shown text come
  from two reads; a conflict reloads the hash but not the text) and R2-F2 (file-list marks send
  no hash).
- F2 (token-only userinfo): correct. `[^/\s@]+@` masks `https://ghp_x@host`. A raw unencoded `@`
  inside a password leaks the part after it; RFC 3986 needs `%40` there, so not a finding.
- F3 (run note restore): correct. `completeRun` writes the end note under the same `taskMu`, so
  the re-read under lock sees it. A run that left `running` keeps its own note.
- F4 (comments loaded once): correct. Comments are now read outside the path lock, so two
  concurrent promotions can re-promote a comment the first already moved. `PromoteComment` has no
  `origin = 'working'` guard, but the second write recomputes the same anchor and range (or an
  older tip's, still consistent). Harmless; optional hardening only.
- F5 (throttled cache writes): correct. `useThrottleFn` is leading-only, so the cache can lag up
  to 120 ms, but `flush` writes it on the 300 ms debounce and on unmount. A fast tab switch
  unmounts, so it flushes. Closing the window within 300 ms of the last scroll drops that last
  backend write; no `pagehide` flush exists. Same as the console's own persistence, so noted only.

## R2-F1 Medium: working diff guard checks a hash the user never saw

- Where: `apps/kira-space/frontend/src/views/repo/reviewSource.ts:212` (`reloadOnConflict`),
  `:232` (`contentHash = r.contentHash` in `loadDiff`);
  `apps/kira-space/frontend/src/views/repo/RepoDiffView.vue:205-219` (models come from
  `useReviewWorkingDiff`); `apps/kira-space/internal/ade/review_working.go:114`
  (`ReviewWorkingFile`) vs `apps/kira-space/internal/ade/review.go:285` (`ReviewWorkingDiff`).
- Defect: Monaco shows text from `ReviewWorkingDiff`. The hash comes from a separate
  `ReviewWorkingFile` read made by `reviewDecorations.loadDiff`. On `E_CONFLICT`,
  `reloadOnConflict` fires only a `mark` repaint. That re-runs `loadDiff`, which stores the new
  disk hash. It never invalidates the `reviewWorking` diff query, so the models keep the old text.
  `reviewDecorations.mark` swallows the error (logs only), so the user sees no refusal.
- Failure: user views file at content A. Agent writes B; the hook-driven refresh is debounced, or
  B came from a process with no agent hook (refresh waits for window refocus). User marks lines
  10-12: server refuses, decorations reload with hash(B), editor still shows A. User clicks again:
  hash matches, mark stored on B in B's line coordinates. Unseen lines count as reviewed, which is
  exactly what F1 meant to stop. The same holds for comments. A smaller window also exists on every
  load, since the two reads are not atomic.
- Fix: take the hash from the read that fills the models. Return `contentHash` in
  `codeworkspace.DiffContent` (or `ReviewWorkingDiff`), store it where `RepoDiffView` rewrites the
  models, and have `workingReviewSource` send that value. On `E_CONFLICT`, invalidate the
  `['adetask','reviewWorking']` prefix so text, hunks and hash reload together. Show a short notice
  on a refused mark, as the thread already does for a refused comment.

## R2-F2 Low: file-list mark of uncommitted files is still unguarded

- Where: `apps/kira-space/frontend/src/ade/v2/review/AdeReviewFiles.vue:56` (`toggleWorking`
  sends no `contentHash`); `apps/kira-space/internal/bridge/adetask_review_working.go:57`
  (hash allowed only for one path); `apps/kira-space/internal/ade/review_working.go:149`
  (empty hash skips the check).
- Defect: the per-file checkbox and the folder checkbox mark whole files against whatever is on
  disk at click time. Round 1's guard only covers the diff tab.
- Failure: user reads `a.go` in its diff tab, agent rewrites it, user ticks `a.go` in the list
  before the list refreshes. Record stores `full` over the new content; promotion carries it into
  the committed review. Committed review has the same unguarded list mark, but its content only
  moves on a commit; here an agent edits continuously.
- Judgement: acceptable only as an explicit "I vouch for this file" gesture, and nothing in the UI
  says the list mark ignores what was shown. Fix, or record it as a known open item.
- Fix: return a per-file `contentHash` in `ReviewWorking` (the list already reads recorded files;
  add the rest, capped by `MaxSnapshotBytes`), send `contentHashes` by path with list marks, and
  refuse changed paths with `E_CONFLICT` plus a list reload.

## R2-F3 Low: every board push re-reads the whole uncommitted review

- Where: `apps/kira-space/frontend/src/ade/v2/review/useReviewWorking.ts:70`
  (`control.onAdeTaskBoard(invalidate)`); `apps/kira-space/internal/ade/board.go:286`
  (`notifyBoard`, 48 callers, not debounced except the `repo.changed` path).
- Defect: the review window invalidates the list and every open working diff on any board push,
  for any task, with no debounce. Agent hook events are debounced (`TIMING.fileSettle`), board
  pushes are not.
- Failure: three other tasks run agents; run state, note, artifact and branch-request changes
  push the board many times a minute. Each push runs `ReviewWorking` (worktree status, full
  promotion, a read per recorded file) plus one `ReviewWorkingDiff` per open tab, in a window that
  shows none of those tasks.
- Fix: route the board push through the same `invalidateSoon` debounce, and skip it when the
  board's revision for this window's task and branch did not change (or listen to the per-branch
  review event instead).

## R2-F4 Low: `toPass` hides an unexplained review context-menu failure

- Where: `apps/kira-space/tests/ui/ade-v2-review.spec.ts:1167-1176`; action in
  `apps/kira-space/frontend/src/views/repo/reviewDecorations.ts:583`.
- Defect: the comment says a right-click mid-layout "targets another line". That cannot cause the
  failure: `openCompose` opens a thread on whatever line holds the cursor, and the assertion does
  not check the line. Only a missing menu item, a click outside the modified pane, or a closed zone
  leaves no thread. No `actionTimeout` is set, so if the item is missing, the inner `click` waits
  for the 60 s test timeout and `toPass` never retries. The retry therefore covers only "item
  clicked, thread never shown", which is the case that would point to a product bug.
- Product race: not confirmed. Code read: `kira.review.addComment` registers on the modified editor
  only, after `handle.mount()` and `loadMonaco()`. A right-click in that gap or on the original pane
  gives a menu without the item. That is benign for a person (reopen the menu). Nothing in
  `paint`, `loadComments` or `revealCommentLines` closes a compose zone (`openThreadCommentId` stays
  null for compose).
- Fix: expose a ready marker (`data-review-ready` once `reviewDecorations.ready` settles) and wait
  for it. Right-click the modified pane's line and assert the compose opens on line 100. Drop
  `toPass`. If it still fails under load, capture a trace (`trace: 'on-first-retry'` is now set)
  before widening anything.

## R2-F5 Low: proof screenshot stalls 15 s on a step that failed to load

- Where: `apps/kira-studio/frontend/src/proof/useProofScreenshot.ts:25-29` (`whenSettled`);
  `apps/kira-studio/frontend/src/proof/ProofStepView.vue:66-72` (ready only after grid and query
  box report).
- Defect: a step whose `proofStep` or `proofViewState` query errors renders the error state but
  never calls `markReady`. `whenSettled` waits `READY_TIMEOUT_MS`, then throws
  `whenSettled: step view did not settle`. That English developer text lands in the localized
  `studio.proof.shot.failed.error` announcement.
- Failure: "copy all tabs" on a session with one broken step blocks 15 s, then fails the whole
  capture with an untranslated message. For copy, the clipboard write is held open that whole time.
- Fix: mark the step ready when its query or view-state query settles in error (the error state is
  what the screen shows). Throw a catalog-keyed error on timeout.

## R2-F6 Low: proof step pages leave console runtime entries behind

- Where: `apps/kira-studio/frontend/src/proof/pages.ts:68` (`releaseProofPage`);
  `apps/kira-studio/frontend/src/views/console/state.ts:341`, `:359` (both call `ensureRuntime`).
- Defect: release resets expansion and widths through setters that create `runtime[key]` when
  absent, and nothing deletes it. The console store already has a delete path that runs on tab
  close.
- Failure: every step tab visited in a long-lived proof window leaves one runtime object (sets,
  arrays, status) keyed `proof:<session>:<rev>:<ordinal>`. Each object is small; growth is
  unbounded for the window's life.
- Fix: expose the store's existing tab-drop path and call it from `releaseProofPage` instead of the
  two setters.

## Areas reviewed, nothing real found

- P420 Part 2 screenshot save: base64 and PNG magic checks, size caps, `safePngName` strips
  directories and unsafe runes, `renameio` write to the dialog's path. `modern-screenshot` is MIT.
- P420 Part 2 view state: backend `ViewState.Check` plus `maxViewStateBytes`; SlickGrid restore
  bounds-checks the saved selection; the `restoring` flag stops restore echoes.
- Proof Go convention fixes (`39b1ee1`): catalog keys exist in `en.json`; prompt title logic
  unchanged.
- Proof window open: `openMu` serializes create; live-window reuse emits the select.
- Playwright config (`a4f02b7`): top-level `use` merges into project `use`; WebKit `ui` project
  keeps its browser. CI artifact upload of the removed html report is the pending `pr.yml` patch.
- `1cc66e4` prompts wait widened to 15 s: an assertion on a mock-fed dialog; no product race found.
