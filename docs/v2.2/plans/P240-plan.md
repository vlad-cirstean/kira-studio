# P240 plan: one-step review from the ADE Plan

SPEC row P240. User's words: "I want it to be very easy, from a task in the ADE plan window, to
open a review window."

Base: `v2.0` tip after Stream A (P236) lands. One sequential Sonnet implementer. Frontend only.

Discovery: `codegraph_explore` over the review flow (`OpenWindow`, `WindowRegistry.AddEphemeral`,
git-ui `ReviewView`, `ReviewFilesPane`, `BaseSelector`, `runMenuShortcut`). `apps/kira-space/**` is
not in the index, so its files were read directly: `internal/ade/review.go`,
`internal/bridge/adetask.go`, `ade/v2/{queries,wire}.ts`, `review/*`, `state/adeReviewWindow.ts`,
`plan/{AdeTaskCard,AdeBranchRow,useTaskMenu,usePlanModel}`, `board/taskMenu.ts`,
`panel/{AdeTaskPanel,AdeTaskTab,AdeBranchPanel,AdeStageBlock,headerActions}`, `shell/AdeShell.vue`,
`main.ts`, `packages/shared/domain/shortcuts.ts`, `packages/workbench/src/state/contextMenu.ts`.

## 1. What exists today

### 1.1 The "plan window"

The ADE module's Plan tab: `AdeShell.vue` renders `AdePlanView` (day bands of task cards) beside
`AdePanel` (task panel, or branch panel when a branch is selected). Selection lives in the
`adeBoardUi` Pinia store (`selectedTaskId`, `selectedBranchId`). Not a separate native window.

### 1.2 What a task owns

`Task` (`wire.ts`): kind `task | review | parked`, workflow stage, `runs[]` (state, `branchId`),
`branchIds`. One task has one or more `Branch` rows, one per repo or added branch:

- `name` (`''` until created: draft), `kind` (`mine | review | parked`), `base` (ref name),
  `baseBranchId` (stacked on a planner branch).
- `ahead`/`behind` against the resolved base, `files[]`, `commits[]`, `dirty[]` (uncommitted
  worktree entries), `worktree` (`''` none), `setup`, `mergedIntoMain`.
- PR state comes separately from `usePrs()` keyed by branch id.

### 1.3 The review window (P150)

One ephemeral native window per task branch, never restored on relaunch.

- Open: `AdeTaskService.OpenReviewWindow({branchId})` (`internal/bridge/adetask.go:751`) calls
  `TaskBoard.OpenReviewWindow` (`internal/ade/review.go:82`). Rejects archived, `parked`, and
  uncreated (`name == ''`) branches. **Already dedupes:** an existing `ade_review_windows` row for
  the branch returns `Existing`, and the bridge calls `FocusWindow(key)` and returns `false`.
  Otherwise it pins the git review session, creates the window row, opens the window, sets its
  title `Review · <repo> · <branch>`, returns `true`. Per-task lock serialises racing opens.
- Boot: `main.ts` asks `ReviewWindowTarget({windowKey})`; a non-null target sets
  `useAdeReviewWindowStore().target` and `App.vue` renders `AdeReviewWindow` instead of the
  workbench.
- Target: `{taskId, branchId, codeRepoId, gitRepoId, branch, base, worktree}`. `base` is the
  branch's own `Base` or the repo's main ref (`reviewSpellings`). Worktree is not required.
- Teardown: task archive closes its review windows (`teardownReview`, `closeTaskReviewWindows`).

### 1.4 Relation to the git review tool

`AdeReviewFiles.vue` mounts git-ui's `ReviewView` (`view: 'review'`, `pane: 'files'`,
`reviewFilter: 'needsReview'`) on `{repoId: gitRepoId, branch, base}`. So the window is the git
review tool scoped to one branch: merge-base range diff, `Since review | Full range` mode
(`ReviewFilesPane`), per-file and per-range reviewed marks in the same pinned review session the
Git module and the VS Code extension read. Centre pane: the workbench diff tabs, where
`askReviewAgent.ts` adds "Ask review agent" on a selection. Right pane: `AdeReviewAgentPanel`
(review agent session, inline questions) and the GitHub sync in the header.

### 1.5 Entry points today (all call `useOpenReviewWindow` in `ade/v2/queries.ts:306`)

1. Board branch row right-click menu, item `ade-review-code` (`plan/AdeBranchRow.vue`).
2. Branch panel header action `kind: 'review'` (`panel/headerActions.ts`, `AdeBranchPanel.vue`).
3. Review stage block rows, button `ade-review-code` (`panel/AdeStageBlock.vue`), only while the
   task's workflow has a `review` stage.

Gaps: nothing on the card itself, nothing in the task context menu, nothing in the task panel
header, no shortcut, and three different disabled rules. No UI spec clicks any of them.

## 2. Design

No Go change: open, dedupe and focus already work per branch, and a task's review window is the
window of one of its branches. All work is one shared rule, one composable, and wiring.

### 2.1 Shared rule: `board/reviewCode.ts` (new, pure)

```ts
export interface ReviewChoice {
  branchId: string;
  label: string;          // `${row.repo} · ${row.name}`
  disabled: boolean;
  tip: string;            // reason when disabled, else what the click does
}
export function reviewChoice(row: BranchRowModel, task: Task): ReviewChoice | null;
export function reviewChoices(card: CardModel): ReviewChoice[];
```

Rules, in order:

| Branch state | Result |
|---|---|
| `kind === 'parked'` | `null` (hidden; Go rejects it) |
| `name === ''` | disabled, `Create the branch first` |
| `ahead === 0 && files.length === 0` | disabled, `No commits on top of <base> yet`, plus `; N uncommitted changes are not reviewed` when `dirty.length > 0` |
| a run of the task with `branchId === row.id` is `running` | enabled, `An agent is still working: the review updates as it commits` |
| otherwise | enabled, `Open the review window` |

`<base>` is the same name `AdeBranchPanel.baseName` shows: move that expression into this module as
`baseNameOf(row, graph)` and have `AdeBranchPanel` import it, so one spelling exists. A merged
branch stays enabled (it can still hold unreviewed commits). No unit test: a short linear rule,
covered by the UI spec (CLAUDE.md test bar).

### 2.2 Composable: `review/useReviewCode.ts` (new)

Wraps `useOpenReviewWindow()` (TanStack mutation, unchanged) and the context menu store.

```ts
export function useReviewCode() {
  function open(taskId: string, branchId: string, returnTo: HTMLElement | null): void;
  function openTask(card: CardModel, anchor: HTMLElement | null): void;
  const pending: Ref<boolean>;
}
```

- `open`: clears `ui.actionError[taskId]`, calls `mutate({branchId})`. `onError`:
  `ui.select(taskId)` only when nothing of that task is selected, then
  `ui.actionError[taskId] = message` (the pattern `AdeBranchRow` already uses; the task panel
  header shows it). `onSettled`: refocus `returnTo` when `isConnected`
  (`focus({preventScroll: true})`). Focus inside the review window is native: a new window takes
  OS focus on open, an existing one through `FocusWindow`. Refocusing the invoker means that when
  the user closes the review window, the main window returns with keyboard focus on the same
  card or row rather than on `body`. Reka's menu otherwise returns focus to the `ContextMenu.vue`
  0x0 trigger span.
- `openTask`: `choices = reviewChoices(card).filter(c => !c.disabled)`.
  - 0 enabled: no call. The visible control is already disabled with the first choice's tip.
  - 1 enabled: `open(card.task.id, it.branchId, anchor)`.
  - `ui.selectedBranchId` is one of the enabled choices: open that one.
  - otherwise: `contextMenu.openContextMenuAt(rect.left, rect.bottom, items)` under `anchor`. The
    items are a `label` `Review which branch?` plus one item per choice (disabled ones kept with
    their `hint`), id `ade-review-pick-<branchId>`. On menu close without a pick, refocus `anchor`
    after the close settles (`watch(() => contextMenu.open, ..., { once: true })` plus `nextTick`).
    The implementer confirms with `toBeFocused()` that reka's own focus return does not win.
- `pending` mirrors `isPending`; buttons bind `:disabled` to it. Go's per-task lock already makes
  a double open safe, so this is only for feedback.

### 2.3 Shortcut

Add `'ade.reviewCode': { chord: { key: 'R', cmdOrCtrl: true, shift: true } }` to
`packages/shared/domain/shortcuts.ts` (a local binding, like `grid.*`, so no Go `accel.go` row:
that table mirrors only menu accelerators). No existing binding or native menu accelerator uses
Cmd/Ctrl+Shift+R in either app.

Handler: in `shell/AdeShell.vue`, wrap the Plan's `<AdePlanView/> <AdePanel/>` in
`<div ref="planEl" class="contents">`. Add `useEventListener(planEl, 'keydown', ...)`:
`shortcutFor(e, ['ade.reviewCode'])`, skip when `e.defaultPrevented`, then `preventDefault()`.
Target, first match wins:
- focus inside a branch row (`[data-testid="ade-branch-row"][data-branch-id]`): that branch;
- focus inside a card (`[data-testid="ade-card"][data-task-id]`): that task;
- `ui.selectedBranchId`: that branch;
- `ui.selectedTaskId`: that task.
A branch target calls `open(...)` when its `reviewChoice` is enabled. A task target calls
`openTask(card, anchor)`.
- `card` is `model.cardFor(id)`. `anchor` is the focused element when it lies inside the card
  (`[data-testid="ade-card"][data-task-id]`), else the card head.
- Nothing selected: no-op.

`contents` keeps the flex layout unchanged. The listener sits on the Plan tab only. It covers
the board and the panel, so the shortcut also works from the task detail.

### 2.4 Visible actions

1. **Card head** (`plan/AdeTaskCard.vue`): a `TooltipIconButton` (`icon="git-compare"`,
   `label="Review code"`, `data-testid="ade-card-review"`) at the right end of the first line of
   the card head, `@click.stop="reviewCode.openTask(card, $event.currentTarget)"`. Shown when
   `reviewChoices(card).length > 0`. It is disabled (`disabledTrigger` so the tooltip still
   shows) when every choice is disabled, with the first choice's tip. Review cards have no head
   (`v-if="!card.review"`), so for them the row icon (2) and the menu entry (3) carry the action.
   No per-card key handler: 2.3 covers a focused head. In 2.3, a focused card's `data-task-id`
   wins over `ui.selectedTaskId`, because focus can move by Tab without selecting.
2. **Branch row** (`plan/AdeBranchRow.vue`): add `group` to the row root and a trailing
   `TooltipIconButton` (`data-testid="ade-branch-review"`). It is shown when `reviewChoice` is
   non-null. Classes `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, plus
   `opacity-100` when the row is selected. `@click.stop` runs `open(taskId, row.id, rowEl)`.
   Disabled plus tip from the choice.
3. **Task context menu** (`board/taskMenu.ts`, `plan/useTaskMenu.ts`): new `TaskMenuCmd`
   `{ kind: 'review'; branchId: string }` and optional `shortcut?: ShortcutId` on
   `TaskMenuItem`, passed through `toItem`. `taskMenuModel` takes `choices: ReviewChoice[]` in
   `TaskMenuInput` (`useTaskMenu.items()` computes it). Insert right after the label line, for
   both task and review cards:
   - one choice: item `ade-task-review`, `Review code`, `shortcut: 'ade.reviewCode'`,
     disabled/hint from the choice;
   - several: submenu `ade-task-review`, `Review code`, items `ade-task-review-<branchId>` with
     the choice labels, disabled/hint each;
   - none: nothing.
   `useTaskMenu.run` maps `review` to `reviewCode.open(taskId, cmd.branchId, anchor)`, where
   `anchor` is the element `open`/`openAt` recorded (`ev.currentTarget` or `el`).
4. **Branch row menu** (`AdeBranchRow.onMenu`): keep id `ade-review-code`. Take
   `disabled`/`hint` from `reviewChoice` and add `shortcut: 'ade.reviewCode'`. Route `run`
   through `useReviewCode.open` and drop the inline mutate.
5. **Task panel header** (`panel/AdeTaskPanel.vue` `#actions`): a `Button`
   (`variant="dialog"`, `size="kira-lg"`, `data-testid="ade-panel-review"`, label
   `Review code`) before `More actions`. It sits in an `AdeTip` with the shortcut text
   (`formatShortcut('ade.reviewCode')`) and calls `openTask(card, $event.currentTarget)`.
   Same hidden/disabled rule as the card button. This is "from the task detail".
6. **Branch panel** (`AdeBranchPanel.vue`): the `review` header action gets
   `:disabled`/tooltip from `reviewChoice(row)` and runs through `useReviewCode.open`. Remove
   the local `openReview` mutation. `headerActions.ts` itself is unchanged.
7. **Review stage block** (`AdeStageBlock.vue`): `reviewRows` buttons take disabled/tip from
   `reviewChoice` and call `useReviewCode.open`. The local error string stays, routed through
   an `onError` option on `open`: add `opts?: { onError?(msg: string): void }`, default writes
   `ui.actionError`.

After this, `useOpenReviewWindow` has one caller (`useReviewCode`). Verify with grep.

### 2.5 Not done (scope)

- No "already open" badge: no query lists open review windows, and a click on an open one
  focuses it, which is the reuse the user asked for. A badge needs a new bound method plus an
  event, which is out of proportion.
- No multi-branch review window (one window for a whole task): the git review session, diff
  tabs and target are per branch by design (P150). Parked under open questions.
- No change to the review window itself, git-ui, Go, or the IPC contract.

## 3. Files

| File | Change |
|---|---|
| `apps/kira-space/frontend/src/ade/v2/board/reviewCode.ts` | new: `reviewChoice`, `reviewChoices`, `baseNameOf` |
| `apps/kira-space/frontend/src/ade/v2/review/useReviewCode.ts` | new composable |
| `apps/kira-space/frontend/src/ade/v2/board/taskMenu.ts` | `review` cmd, `shortcut`, `choices` input, entries |
| `apps/kira-space/frontend/src/ade/v2/plan/useTaskMenu.ts` | pass choices, run `review`, record anchor, map `shortcut` |
| `apps/kira-space/frontend/src/ade/v2/plan/AdeTaskCard.vue` | card head button |
| `apps/kira-space/frontend/src/ade/v2/plan/AdeBranchRow.vue` | row button, menu item via shared rule |
| `apps/kira-space/frontend/src/ade/v2/panel/AdeTaskPanel.vue` | header button |
| `apps/kira-space/frontend/src/ade/v2/panel/AdeBranchPanel.vue` | review action via shared rule, `baseNameOf` |
| `apps/kira-space/frontend/src/ade/v2/panel/AdeStageBlock.vue` | review rows via shared rule |
| `apps/kira-space/frontend/src/ade/v2/shell/AdeShell.vue` | `planEl` wrapper, shortcut listener |
| `packages/shared/domain/shortcuts.ts` | `ade.reviewCode` |
| `apps/kira-space/tests/ui/ade-v2-review-open.spec.ts` | new spec |
| `docs/v2.2/SPEC.md` | P240 status and result |

Library check (CLAUDE.md): this plan uses shadcn-vue `Button` and `TooltipIconButton`, the
existing reka-based `ContextMenu` store, VueUse `useEventListener`, the existing Pinia
`adeBoardUi` store (no new store: no new shared state), and the existing TanStack mutation. All
components are `<script setup lang="ts">` and styled with Tailwind utilities only. No new
dependency.

## 4. Tests

### 4.1 Playwright: `tests/ui/ade-v2-review-open.spec.ts`

Use `openPlan(relaunch, [{ channel: IPC.adeTaskOpenReviewWindow, response: true }])` and the
committed `board.json` fixture (real Go-generated wire shapes). Assert calls with the
`control.log()` filter used in `ade-v2-task-menu.spec.ts`. Fixture facts used: `T_deps` has one
branch `b_deps` and a running run; `T_bill` has three created branches; `T_alerts` has two draft
branches; `R_sara` is a review card (`b_sara`); `T_spike` is parked.

1. Card button on `T_deps` calls `{branchId: 'b_deps'}` exactly once. Its tooltip says an agent is
   still working.
2. Card button on `T_bill` opens the picker with three `ade-review-pick-*` items. Picking
   `b_billdash` calls with that id. Escape on a reopened picker makes no call, and focus returns
   to `ade-card-review`.
3. `T_alerts`: the card button is disabled. The menu item `ade-task-review-*` items are disabled
   with hint `Create the branch first`. No call.
4. `T_spike`: no `ade-card-review`, no `ade-task-review` menu entry.
5. `R_sara`: right-click the card, `ade-task-review` calls `b_sara`. Hover the row and click
   `ade-branch-review`: same call.
6. Shortcut: click the `T_deps` card head, press `ControlOrMeta+Shift+R`: one call, and
   `ade-card-head` of `T_deps` is focused after the call settles. Select branch `b_billdash` (row
   click), press the shortcut: call with `b_billdash`, no picker.
7. Task panel: select `T_deps`, click `ade-panel-review`: one call.
8. No commits: override `IPC.adeTaskBoard` with a deep copy of `board.json` where `b_deps` has
   `ahead: 0, files: [], dirty: [one entry]`. The card button is disabled and its tooltip reads
   `No commits on top of main yet; 1 uncommitted change is not reviewed`. Match the exact copy
   the implementer writes.
9. Error: `adeTaskOpenReviewWindow` answers with an error (`ControlSnapshot.error`). Click the
   card button on `T_deps`: `ade-panel-action-error` shows the message.

The existing three entry points (branch-row menu, branch panel, stage block) get one assertion
each in this spec (each calls with its branch id), since no spec covers them today. Do not edit
`ade-v2-panel.spec.ts` (Stream A's file; it lands first anyway).

### 4.2 Go

None: no Go change. `internal/flows/adeflow/lifecycle_test.go` already covers open, reuse
(`Existing`) and target resolution.

### 4.3 Checks before each commit

`pnpm` typecheck, lint (biome), `lint:dead`, Space build. Run the new spec, plus
`ade-v2-task-menu`, `ade-v2-plan`, `ade-v2-panel`, `ade-v2-review` and `ade-v2-run`, once at the
end.

## 5. Overlap and ordering

- **Stream A (P236) owns `apps/kira-space/frontend/src/ade/v2/**`** plus "any product file a P236
  finding needs". 10 of P240's 13 files are in that tree. **P240 must wait for Stream A to land.**
  Start from the post-A tip and re-read every listed file, since A may fix ADE findings in them.
- Stream B (P237): no overlap (Go realclaude tests, docs).
- Stream C (P238, P239): no file overlap. P240 does not touch `main.ts`, `bridge/control.ts`,
  `StatusBar.vue`, `ClaudeCodePane.vue`, settings, `appwire` or `tests/fixtures/**`. It reads
  `tests/fixtures/ade-v2/board.json` without editing it, and builds variants in the spec.
  `packages/shared/domain/shortcuts.ts` is not in C's list (C owns only `domain/agent.ts`).
- Table order (CLAUDE.md): P240 follows P239, so by default it starts after P236-P239 have all
  landed. Running it beside B or C once A lands is file-safe and keeps 3 streams. That needs the
  user's explicit OK, because it departs from row order.
- After landing: P236's bound-method coverage gate is unaffected (no new bound method).

## 6. Orchestrator verification checklist

- [ ] `rg -n "useOpenReviewWindow" apps/kira-space/frontend/src` shows the definition plus
      exactly one caller, `review/useReviewCode.ts`.
- [ ] `rg -n "reviewChoice" apps/kira-space/frontend/src` shows callers in
      `AdeTaskCard`, `AdeBranchRow`, `useTaskMenu`, `AdeTaskPanel`, `AdeBranchPanel`,
      `AdeStageBlock` and `AdeShell` (or `useReviewCode`).
- [ ] `rg -n "'ade.reviewCode'" apps packages` shows the table entry, the `AdeShell` listener,
      at least one menu `shortcut:` and the panel tip.
- [ ] `git diff --stat <base>..HEAD -- 'apps/kira-space/internal' 'internal' 'packages/git-ui'`
      is empty (frontend only).
- [ ] No new dependency: `package.json` and `pnpm-lock.yaml` are unchanged.
- [ ] No `<style>` block and no Options API in the touched `.vue` files.
- [ ] The new spec has all 9 cases plus the 3 legacy entry assertions, and it passes. The listed
      neighbour specs pass.
- [ ] Hooks are green on every commit (no `--no-verify`). Commits are Conventional, one per
      logical group: rule plus composable, wiring, shortcut, spec, docs.
- [ ] SPEC P240 status is `Done` and the result section is filled. Nothing is added to
      `docs/ARCHITECTURE.md` unless a fact changes (none expected).

## 7. Open questions for the user

1. Shortcut chord: Cmd/Ctrl+Shift+R proposed. Is a bare `R` on a focused card preferred? It is
   faster but collides with typing in any future inline field.
2. Multi-branch tasks: the plan shows a picker. Alternatives are opening every branch's window
   at once, or a single per-task window with a branch switcher. The last one is a P150-level
   redesign (per-branch session, tabs and agent).
3. "No commits yet" is disabled. Should a branch with only uncommitted changes open anyway?
   Today the review window shows committed changes only and notes the uncommitted count.
4. Concurrency: may P240 run beside Streams B and C once A lands, or wait for P239 per row
   order?
