# P168 Part 21 findings: Space ADE frontend and review window

Reviewer: Opus, Stream C. Review only, no fixes. Base for "unreviewed fixer commits": `f40cd35`.
Tree reviewed: `p168-stream-c` at `48ce095`.

Scope (SPEC row "P168 Part 21", prep plan §5.20):

- Own: `apps/kira-space/frontend/src/ade/**`, `tests/ui/{ade-v2-*,support/adeV2.ts}`,
  `tests/unit/{ade*,support/adeV2Fixtures.ts,support/mockupV2Oracle.ts}`,
  `tests/fixtures/ade-v2/**`.
- One hop read: `frontend/src/App.vue` (`AdeReviewWindow` mount), `bridge/control`,
  `repo/git/transport.ts` (`onReviewRepaint`, `gitTransportFor`), `state/repoOpenHold.ts`,
  `@workbench` agent-activity store, `TooltipProvider`/`TooltipContent` (theme), Go
  `adewire`/`internal/ade` callees named below.
- Fixer commits in owned files since `f40cd35`, treated as unreviewed: `6af53ab`, `076bd81`,
  `fda8259`, `c50bb3f`, `59e7483`, `b604dbf`. Covered below (F13 is from `59e7483`).
- Routed-in items: none of `P168-routed-from-stream{A,B,C}.md` names Part 21.

Severity: high = data loss, security, crash or wrong result in a common path.

## F1 (high): panel resize handles snap to their limit on every drag, and a click persists 0

File: `apps/kira-space/frontend/src/ade/v2/panel/AdePanelResizeHandle.vue:37-54`.

`useDraggable`'s `position.x` is not the pointer delta. VueUse sets `pressedDelta.x =
clientX0 - targetRect.left` on start and `x = clientX - pressedDelta.x` on move, so `position.x`
is the handle's viewport left plus the delta. The comment at :37 says the opposite. `onMove`
computes `clamp(start + sign * position.x)`, which is always far outside `[min, max]`.

`onEnd` also commits `lastDrag` when no move happened. It is `0` before the first drag, stale
after one.

Failure scenarios (probe-confirmed on the built UI, scratch spec deleted):

- Plan panel: dragging the handle 120px left (should widen 713 to 833) wrote
  `{"ade":{"panelWidth":340}}`, the minimum. Every drag lands on 340.
- Plan panel: a plain click on the handle (for example to focus it for the arrow keys) wrote
  `{"ade":{"panelWidth":0}}`, resetting the width to half the row.
- Review window (`AdeReviewWindow.vue:71-97`): the left handle (`invert`) snaps to 560, the right
  one to 280. A click calls `commitLeft(0)`/`commitRight(0)`. `commitLeft`/`commitRight` do not
  clamp, so the pane collapses to 0px and `useStorage` persists it across sessions.

Fix: track the pointer delta yourself. Record `e.clientX` in `onStart` and compute
`e.clientX - startX` in `onMove` (`onMove(position, e)` receives the event). Set a `moved` flag in
`onMove` and commit in `onEnd` only when it is set. Clamp in `commitLeft`/`commitRight` too. Fix
the comment at :37.

Coverage: `ade-v2-panel.spec.ts:223-244` ("dragging the handle persists the panel width") only
checks that some `panelWidth` write happened, so it passed. Assert the written value equals the
start width plus 120. Add one review-window drag assertion on the stored width. See F16.

## F2 (medium): Force push is offered on every branch, including someone else's

File: `apps/kira-space/frontend/src/ade/v2/panel/AdeBranchPanel.vue:222-232`.

`canForcePush` (:92) is computed but never used in the template. The header action row shows when
`canForcePush || setupFailed || actions.length`, and `headerActions` always returns at least one
action (`created` or `review`). So the Force push button renders for every branch: a draft with
no name, a merged branch, and a `review` branch owned by a colleague.

Failure scenario: a user opens a colleague's review branch and clicks Force push, then confirms.
`TaskBoard.ForcePush` pushes the local branch with a lease equal to the local remote-tracking tip.
If the local copy is behind or rebased locally, the colleague's remote branch is rewritten. The
plan-row path (`AdeBranchRow`) only offers it through `plan.unpushed`, so the two paths disagree.

Fix: put `v-if="canForcePush"` on the `AdeTip` wrapping the button.

Coverage: `ade-v2-panel.spec.ts:204` covers only the positive case. Add one negative assertion
(a review branch or a clean pushed branch shows no `ade-panel-force-push`).

## F3 (medium): after Retry setup, the setup log keeps the failed output and drops the new one

Files: `apps/kira-space/frontend/src/ade/v2/panel/AdeWorktreeSetup.vue:253-260,294`,
`AdeBranchPanel.vue:56-63`, `apps/kira-space/frontend/src/ade/queries.ts:36-42`,
`apps/kira-space/frontend/src/ade/v2/queries.ts:267-274`.

The setup log is keyed `['adetask','log','setup',branchId]` with `staleTime: Infinity`.
`RetrySetup` reruns `startSetup`, which calls `Logs.Reset(setup, branchId)` (`setup.go:277,293`,
`adelogs.go:46-65`): sequence numbers restart at 1. `appendChunks` drops every pushed chunk with
`seq <= last` held.

Failure scenario: a setup fails after 40 log lines. The user clicks Retry setup. The log pane
stays mounted (`running || failed`) and keeps showing the 40 old lines. The first 40 new chunks
are discarded. Only from chunk 41 on does new output appear, appended to the old failure. The user
reads the old error as the new one.

Fix: reset the cached log when a new setup starts. Watch `setup.startedAt` in
`AdeWorktreeSetup.vue` and call `queryClient.resetQueries({ queryKey: logKey('setup', id) })` on
change, or put `startedAt` in the log query key. A defensive `appendChunks` rule (a pushed chunk
with `seq` lower than the cache's first `seq` means a reset: refetch) is a fine addition.

Coverage: no spec retries a setup with an open log. Add one UI assertion: failed log shown,
Retry setup, push a chunk with `seq: 1`, expect it visible and the old lines gone.

## F4 (medium): stage actions and Take over launch twice on a double click

Files: `apps/kira-space/frontend/src/ade/v2/state/adeTakeOver.ts:143-186`,
`run/AdeTaskActionButton.vue:125-133`, `run/useTaskAction.ts:77-106`,
`needs/AdeNeedsRow.vue:42-50`, `needs/useNeedsAction.ts:34-53`, `plan/AdeAttention.vue`.

`useAdeTakeOverStore` has a `pending` set, but `request`/`launch` never check it. Only some
buttons disable on it (`AdeStoppedRow`, `AdeHeadlessPane`, `AdeAllSessionRow`, `AdeStageBlock`).
The task action button, the Needs-you action button and the `!` circle have no in-flight guard at
all, for Take over, Run (script stage), Approve, Retry and Done.

Failure scenario: a double click on `Take over` in the card's action cell sends two `TakeOver`
calls. Go's `takeOverSession` checks "conversation already open" before taking `taskMu`
(`launches.go:109-116`), so both pass, and two TUIs resume the same Claude conversation (two
terminals, interleaved transcript). A double click on a script stage's `▶ Run` sends two
`StartRun` calls.

Fix: return early from `launch` when `pending.has(sessionId)`. Give `useTaskAction` and
`useNeedsAction` a busy ref (or use the mutations' `isPending`) and disable their buttons while
it is set. The Go-side ordering is routed (R2).

## F5 (medium): a base/queue cycle crashes the Plan with unbounded recursion

Files: `apps/kira-space/frontend/src/ade/v2/board/timeline.ts:212-219` (`makeBranchRows.walk`),
`:514-526` (`rippleOf.down`), `board/branchGraph.ts:72-78`.

`buildBranchGraph` takes a branch's parent from `plan.queuedAfter`, else `baseBranchId`.
`ancestors` guards cycles with a `seen` set; `walk` and `down` do not. Go's `SetQueuedAfter`
cycle check follows only `QueuedAfter` links (`board_writes.go:433-438`), not `baseBranchId`.

Failure scenario: branch A (task 1) was created from branch B (task 2), so `parentOf(A) = B`.
B shares files with A and merges later, so `computeAfter` offers B "Rebase onto A". The user runs
it and `setQueuedAfter(B, A)` succeeds. Now `parentOf(B) = A`. Selecting task 1 runs
`rippleOf` → `down(A) → down(B) → down(A) …` until `RangeError`, inside the shared plan-model
computed. The Plan, panel, Needs-you badge and dialogs all fail to render. If A and B are on one
task instead, `makeBranchRows` finds no root and both rows silently vanish from the card.

Fix: give `walk` and `down` a visited set. After the root pass in `makeBranchRows`, walk any
branch id not yet emitted so a cycle still renders its rows. Backend half routed (R2).

## F6 (medium): every agent hook event rebuilds the whole plan model

File: `apps/kira-space/frontend/src/ade/v2/plan/usePlanModel.ts:254-256,270-340`.

`sessions` maps every running TUI session through `agentStore.activity.get(terminalId)`. The
agent store writes a new `AgentActivity` on every hook event (each `PreToolUse`/`PostToolUse`,
with a new `at`), even when the phase is unchanged. `sessions` then returns a new array, and the
`model` computed re-runs `buildTimeline`, every `buildTaskProgress`, `buildNeedsYou` and every
card, and the Plan re-renders.

Failure scenario: four agents running tool calls emit several hook events per second. Each
rebuilds the full board model and re-renders every visible card, for no visible change (only the
phase is read). Cost grows with board size times agent activity, on the app's default view.

Fix: derive a phase-only key first, e.g. `computed(() => running TUI sessions → 'id:phase'
joined)`, and rebuild `sessions` only when that key changes. Better still, split `model` so the
timeline and progress depend on the board, workflows and settings only, and the session-dependent
parts (needs, task cells, `hadSession`) are a second computed.

## F7 (medium): the Plan runs a `requestAnimationFrame` hit-test loop for its whole life

File: `apps/kira-space/frontend/src/ade/v2/plan/usePlanDrag.ts:183-188`.

`useElementByPoint` defaults its scheduler to `useRafFn`, started immediately. It calls
`document.elementFromPoint` every frame for as long as `AdePlanView` is mounted, though the
result is only read while `draggedId` is set.

Failure scenario: Kira Space left open on the Plan tab (its default) keeps the renderer awake at
the display's frame rate with a forced hit-test each frame. Idle CPU and battery drain on a
desktop app that stays open all day.

Fix: pass `scheduler: (cb) => useRafFn(cb, { immediate: false })`, keep the returned
`pause`/`resume`, `resume()` in `begin` and `pause()` in `end`.

## F8 (low): the review window never learns that a watched turn's terminal died

Files: `apps/kira-space/frontend/src/ade/v2/review/AdeReviewCompose.vue:66-82`,
`state/adeDialogs.ts:48-54`, `dialog/turnWatch.ts:81-91`.

`adeTurns.onLive` is fed only by a watcher inside `useAdeDialogsStore`. The review window never
instantiates that store, so its turn watches resolve only on `Stop`/`SessionEnd` hook events.

Failure scenario: the review agent's process is killed (or its terminal closed) mid-answer without
a `SessionEnd` hook. The compose status stays `Answering…` until the next Send, and the watch
entry stays in the module-level map.

Fix: feed `adeTurns.onLive` once per window from `installAdeSignals` (`ade/queries.ts`), not
from the dialogs store, e.g. a `watch` on the agent store's session list set up there.

## F9 (low): a failure after delivery leaves the dialog open, so Send repeats the prompt

File: `apps/kira-space/frontend/src/ade/v2/dialog/flow.ts:106-122,204-232`.

`sendRebase` delivers to Claude, then awaits `setQueuedAfter`. If that call fails, the catch
removes the pending key and sets the dialog error, but the dialog stays open and the armed watch
is never cancelled. `sendArchive` delivers per target in a loop; a failure on target 2 shows an
error after target 1 already got the prompt.

Failure scenario: `SetQueuedAfter` fails (branch removed meanwhile). The dialog shows the error
with Send still enabled. The user clicks Send again and Claude gets a second rebase prompt while
still running the first.

Fix: once any delivery succeeded, close the dialog and report the follow-up failure through
`setActionError` (the panel header), and cancel or keep the watch deliberately. Keep the
dialog-error path only for failures before anything was delivered.

## F10 (low): dropping a card onto an overdue card moves it into the past

File: `apps/kira-space/frontend/src/ade/v2/board/dropPlan.ts:63-70`.

A band refuses drops when `isPast || dayOff` (:72-74), but the card branch only refuses self and
review targets, then takes the target card's `entry.day`.

Failure scenario: dragging a task onto an overdue card in yesterday's band writes yesterday's
date. The task appears overdue right after being planned.

Fix: in the card branch, look up the target's band (`view.bands.find(b => b.key === entry.day)`)
and refuse the same way the band branch does.

## F11 (medium): workflow form reuses deleted stage and step ids, inheriting their runs

File: `apps/kira-space/frontend/src/ade/v2/board/workflowForm.ts:14-20,33-47,66-84`
(`AdeStageCard.vue:32-34,179`, `withKind` :63).

`nextId` mints the lowest free `step-N`/`stage-N`. The file's own comment says ids are run keys,
minted once. Runs are keyed `(stage_id, step_id, branch_id)` (`adetask.go:806-814`
`LatestRuns`, `runs.go:178-181`).

Failure scenario: a stage has `step-1`, `step-2`. Tasks have runs on `step-2`. The user removes
`step-2` and adds a new step: it is minted `step-2`. Every task in that stage now shows the old
step's latest run (done, failed or stuck) on the new step. The engine reads the same runs, so the
new step can count as done and never run. Switching a stage's kind to `agent` (`withKind`) also
mints `step-1` again.

Fix: mint ids that are never reused, e.g. `step-${crypto.randomUUID().slice(0, 8)}` (checked
against `taken`), for stages and steps.

## F12 (low): repo environments: rows keyed by index, whole-list writes race

File: `apps/kira-space/frontend/src/ade/v2/repos/AdeRepoDetail.vue:58-74,161-168`,
`repos/useCommitField.ts`.

Every env write sends the whole `environments` array built from `props.repo.environments`. Rows
are keyed by index and hold uncommitted text in `useCommitField`.

Failure scenarios: (a) two quick clicks on Add environment (or Add then Remove) each build from the
same stale list; the second write drops the first. (b) Row 2 has uncommitted edits and the user
removes row 1: the component keyed `0` keeps row 1's draft and now shows it against row 2's env,
and row 2's own draft is destroyed.

Fix: give env rows a stable client key (assigned when the list loads, carried through add and
remove). Serialize env writes: disable Add and Remove while `update.isPending`, or chain writes.

## F13 (low): Review code errors from the plan row menu are invisible unless the task is open

File: `apps/kira-space/frontend/src/ade/v2/plan/AdeBranchRow.vue:53-61` (fixer commit
`59e7483`).

The error goes to `ui.actionError[taskId]`, which only the open task panel renders. Opening the
menu does not select the task.

Failure scenario: right-click a branch of an unselected task, Review code, the call fails: nothing
shows. Other paths (`useTaskAction`, `useNeedsAction`) call `ui.select(taskId)` on error.

Fix: call `ui.select(props.row.branch.taskId)` in the `onError`.

## F14 (low, accessibility): nested interactive controls inside `role="button"` rows

Files: `apps/kira-space/frontend/src/ade/v2/plan/AdeBranchRow.vue:104-143`,
`plan/AdeTaskCard.vue:92-160`.

The branch row is `role="button"` with `tabindex="0"` and contains `AdeAttention`'s button. The
card head is `role="button"` and contains the title `<button>`. Nested interactive content breaks
screen-reader navigation, and Enter on the inner button bubbles to the row's `@keydown.enter`
(selecting the row too). Space, which activates a native button, does nothing on either.

Fix: make the row and head plain containers with one real button for selection (or stop
propagation on the inner controls and handle Space).

## F15 (low, test quality): root cause of the flaky `ade-v2-plan` tooltip spec

Spec: `apps/kira-space/tests/ui/ade-v2-plan.spec.ts:197-215` ("line 2 shows merged and deployed
chips with stale in amber and tooltips").

Reproduced 1 in 60 runs under CPU load (4 busy loops, 6 workers), 0 in 40 without load. A probe
spec (deleted) logged the trigger's events and `data-state`:

```
662 pointerenter / pointermove   (hover lands on the chip)
1088 state=delayed-open
1106 state=closed                 (18ms later, no pointerdown, no scroll, no keydown)
1122 pointerleave
1322 pointerenter                 (no pointermove follows)
```

A second probe logged the tooltip content's box and the element under the pointer:

```
874 content placed at 281,621 304x46 (side=top, sideOffset 0); element at pointer = tooltip-content
886 pointerout on the trigger
888 trigger -> closed
901 pointerleave
1095 pointerover / pointerenter (content removed after its close animation), no pointermove
```

Mechanism: the theme's `TooltipContent` (`packages/theme/src/components/ui/tooltip/
TooltipContent.vue`) takes pointer events. It sits flush on the trigger (`sideOffset` 0), its
arrow overhangs by half its size, and its open animation (`slide-in-from-bottom-2`) starts 8px
lower still. During those frames the content covers the stationary pointer, WebKit's synthetic
mouse move hit-tests it, the trigger gets `pointerout`/`pointerleave`, and Reka closes the tooltip
(`disable-hoverable-content` is set app-wide in `App.vue:69`). When the closing content goes away,
the trigger gets `pointerenter` but no `pointermove`. Reka's `TooltipTrigger` opens only on
`pointermove` (`TooltipTrigger.js:59-65`), so it stays closed and the 5s `toBeVisible` times out.
Under no load the overlapping frames are usually skipped before a hit test runs, hence the rarity.

Reproduction: 1 in 60 runs under CPU load (3-4 busy loops, 6 workers), 0 in 40 without load. The
`ade-v2-dialogs.spec.ts:170-173` `toPass` retry hover works around the same thing; its comment
blames the panel re-layout, which the probe does not support.

Real-user effect: a tooltip on a small trigger hovered near its top edge flickers shut and stays
shut until the mouse moves.

Fix (routed R1, `packages/theme` is Part 9): add `pointer-events-none` to `TooltipContent`'s
classes. `App.vue:68` already states that tooltips are `pointer-events: none`; the class makes it
true. Then drop the `toPass` workaround and its comment in `ade-v2-dialogs.spec.ts:169-173`
(Part 21 file) once that lands. The `ade-v2-plan` spec itself needs no change.

## F16 (low, test quality): two specs prove less than their names claim

- `ade-v2-panel.spec.ts:223-244`: see F1. It checks only that a `panelWidth` write happened.
- `ade-v2-panel.spec.ts:160`: `page.waitForTimeout(900)` is a blind sleep used to assert no second
  notes save. `openPlan` installs the Playwright clock, so `await page.clock.runFor(900)` makes it
  deterministic.

## F17 (low): the GitHub sync button disappears silently when its plan fails to load

File: `apps/kira-space/frontend/src/ade/v2/review/AdeReviewSync.vue:180-182,247`.

`visible` needs `data`. A rejected `adeTaskGitHubSyncPlan` (bridge or engine error) leaves `data`
undefined, so the whole control vanishes with no message, and focus refetches keep failing
silently.

Fix: render the button disabled with the error as its tooltip when `plan.isError`.

## F18 (low): ade terminal reaper misses terminals that exit after the sessions push

File: `apps/kira-space/frontend/src/ade/v2/state/adeTerminals.ts:201-220`.

The watch source is the running-session ids and the tracked ids. The local terminal status is read
only inside the callback. A terminal still `running` locally when the sessions push arrives is
skipped, and its later exit does not re-run the watch.

Failure scenario: the server marks the session stopped a moment before the PTY exit reaches this
window. The terminal entry, drain queue and xterm instance stay until some later sessions push.

Fix: include each tracked id's local status in the watch source.

## F19 (low): optimistic backlog move deletes the last item when the id is missing

File: `apps/kira-space/frontend/src/ade/v2/queries.ts:199-210`.

`items.findIndex` returns -1 for an item another window just deleted; `splice(-1, 1)` removes the
last item from the cached list until the refetch.

Fix: skip the optimistic edit when `from < 0`.

## F20 (low): workflow saves can land out of order

Files: `apps/kira-space/frontend/src/ade/v2/workflows/AdeWorkflowYaml.vue:202-224`,
`AdeWorkflowForm.vue:36-61`.

`flush` runs from the debounce, on blur and on unmount, with no serialization. Two saves can be in
flight at once and bound calls are not ordered. If the older text lands last, `dirty` is already
false (it compares against the newer draft), so the next workflows push replaces the editor with
the older file content.

Fix: serialize saves: keep one in-flight promise; when a flush arrives during a save, mark
`again` and re-run after it settles.

## F21 (low): `cardFor` rebuilds hidden cards on every call

Files: `apps/kira-space/frontend/src/ade/v2/plan/usePlanModel.ts:328-329`,
`needs/AdeNeedsPage.vue:15-18,35-36`, `needs/AdeAllSessions.vue:77-83`.

`cardFor` builds a full card for any task outside the first-10 cap or repo filter on every call,
uncached. The Needs page calls it twice per row per render.

Fix: memoize on-demand cards in a `Map` created inside the `model` computed.

## F22 (low, CLAUDE.md one-concern store): `adeBoardUi` holds several pages' state

File: `apps/kira-space/frontend/src/ade/v2/state/adeBoardUi.ts`.

Besides Plan selection and toggles it holds the Workflows page's file and mode, the Repos page's
selection, the Add popover state, the Run dialog target, per-task action errors and refresh
summaries. That is the "grab-bag" shape CLAUDE.md rules out.

Fix: move `workflowFile`/`workflowMode` and `repoId` into their pages (or one small store each),
and the Add popover state into `AdeAddPopover`'s own store if cross-component access is needed.

## F23 (low): the Run dialog sends a stale default as a custom message

File: `apps/kira-space/frontend/src/ade/v2/run/AdeRunDialog.vue:26-61`.

`edited` compares `message` with the live `initial` computed. A board push that renames the task
while the dialog is open changes `initial`, so an untouched message reads as edited and is sent
verbatim, with the old title, instead of `''` (server default).

Fix: snapshot `initial` when the dialog opens and compare against the snapshot.

## Design decisions (not findings)

- DESIGN-DECISION: Backlog Delete has no confirm and no undo (`AdeBacklogPage.vue:65-67`). Matches
  the mockup's one-click delete; a confirm or undo is a product call.
- DESIGN-DECISION: `dayMenuFor` and `extendHorizon` prune past `offDays`/`extraDays` on write
  (`c50bb3f`). An overdue span crossing a pruned past day off redraws one day shorter. Deliberate
  in that commit; affects only past bands.

## Dropped candidates

- Getter inside `queryKey` (`useReviewAgent`, `useGhSyncPlan`): vue-query's `cloneDeepUnref`
  always unwraps getters in `queryKey` (`utils.js:43-46`). Not a bug.
- TS `wire.ts` vs Go `adewire/wire.go` drift: scripted comparison of every exported struct's JSON
  tags against the TS interfaces: no mismatch.
- `AdeNotesEditor` flushing in `onBeforeUnmount` after the parent's scope stopped: `mutateAsync`
  still executes on the mutation cache after the observer unsubscribes; no loss found.
- `AdeTaskTab` name committed on both Enter and blur: second write is identical, harmless.
- Force push dialog text ("refused when someone else pushed since your last fetch"): matches
  `RunRemote`'s lease check against the local remote-tracking tip.
- `AdeReviewFiles` mounting git-ui after unmount: guarded by the template ref going null.
- Backlog notes edit racing "Plan as task": ordering of the two bound calls not established;
  not reported without evidence.

## Routed items

Written to `docs/v2.0/plans/P168-routed-from-streamC.md`.

- R1 (Part 9, `packages/theme`): tooltip root cause, see F15.
- R2 (Part 20 owner, Go `internal/ade`): `SetQueuedAfter` cycle check ignores `baseBranchId`
  (F5); `TakeOver`'s takeable checks run before `taskMu` (F4).

## Coverage

Read in full: every file under `frontend/src/ade/**` except `board/{progress,stageBlocks,labels,
panelFacts,needsYou(81-250),actions(1-180,303-422),status,baseMarker,fixMenu,runMessage}.ts`,
`dialog/compose.ts(140-503)`, `workflows/{AdeStepCard,AdeStageCard}` template detail, which were
skimmed: they are pure functions covered by `ade-v2-board-parity`, `ade-v2-progress`,
`ade-v2-timeline` and `ade-v2-dialog` unit specs. Specs: all `tests/ui/ade-v2-*.spec.ts` scanned
for sleeps, `.first()` and weak assertions; `ade-v2-plan`, `ade-v2-panel`, `ade-v2-dialogs` read in
the relevant parts; unit specs read for what they assert.
