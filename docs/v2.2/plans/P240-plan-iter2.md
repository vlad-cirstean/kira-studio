# P240 plan, iter2: one-step review from the ADE Plan

SPEC row P240. User's words: "very easy, from a task in the ADE plan window, to open a review
window." Requirements carried from the user:

- R1 one step from a task in the Plan opens its review window.
- R2 the window diffs the branch against its base through the content-aware review tool (git-ui
  `ReviewView`, merge-base range, reviewed marks).
- R3 a task with several branches shows a picker.
- R4 a branch with only uncommitted changes: open disabled, reason shown.
- R5 every interpolated value shown in UI previews its resolved value and is visibly marked as a
  variable.
- R6 Tailwind, shadcn-vue, VueUse, Pinia, TanStack per CLAUDE.md.

Base: `v2.0` at `6454611a0` (P236-P239 and P244 landed). One sequential Sonnet implementer.
Product code frontend only; one Go flow test added.

Discovery: `codegraph_explore` over the review flow and shared packages (git-ui `ReviewView`,
`ReviewCommitRow`, workbench `queries`, theme). `apps/kira-space/**` is still not in the index
(queries for `useOpenReviewWindow`, `AdeTaskService`, `TaskBoard.OpenReviewWindow` return only
other apps' symbols), so Space files were read directly: `internal/ade/{review,board_facts}.go`,
`internal/bridge/adetask.go`, `internal/appwire/appwire.go`, `main.go`, `ade/v2/{wire,queries}.ts`,
`plan/{AdeTaskCard,AdeBranchRow,useTaskMenu,usePlanModel}`, `board/taskMenu.ts`,
`panel/{AdeTaskPanel,AdeBranchPanel,AdeStageBlock,headerActions}`, `shell/AdeShell.vue`,
`AdeTip.vue`, `packages/workbench/src/{state/contextMenu.ts,components/ContextMenu.vue,
shortcuts/keys.ts}`, `packages/theme/src/components/TooltipIconButton.vue`,
`packages/shared/domain/shortcuts.ts`, `tests/ui/support/adeV2.ts`, `tests/e2e-real/**`,
`internal/flows/adeflow/lifecycle_test.go`, `tests/fixtures/ade-v2/board.json`.

## 0. What changed vs iter1

Re-read against the current tree. `git diff --stat c12773157..HEAD -- apps/kira-space/frontend/src/ade`
is empty: P236-P239 and P244 did not touch `ade/v2/**`. Iter1's facts on that tree still hold.
Deltas come from re-reading shared code and from the user's added requirements:

1. **Picker rule (R3).** Iter1 opened directly when only one branch was enabled, or when the
   selected branch was one of them. Now a task-level invoke on a task with 2+ non-hidden branches
   always shows the picker, disabled ones included with their reason. A branch-level invoke (row
   button, row menu, shortcut on a focused or selected branch) opens that branch directly.
2. **No-commits rule (R4).** Iter1 used `ahead === 0 && files.length === 0`. Fixture `b_searchui`
   has `ahead: 0, files: 1`, so `files` is not a commit signal. Rule is now `ahead === 0`
   (merge-base range empty, so the review tool has nothing). Split copy for dirty vs clean.
3. **Variables (R5), new.** Shared `TextPart` type plus `VarText.vue` renders resolved values as
   marked chips. Tips, menu hints and the picker use it.
4. **Submenu hints, found bug.** `ContextMenu.vue` renders `hint` only for top-level items.
   Iter1's multi-branch submenu relied on per-item disabled hints that never render. Fixed here.
5. **Base preview matches the window.** Board `Branch.base` is already resolved in Go
   (`computeBranch`: `sb.Base` or the repo main name). Window uses `reviewSpellings` (same name,
   maybe remote-prefixed). Go flow test now pins that both name the same branch.
6. **Tests.** P236 conventions: `adeBoard(edit)` helper replaces hand deep copies; new Go flow
   test in `adeflow`; new `e2e-real` spec (real git facts drive the disabled state). Server build
   has no window manager (`OpenWindow` is bound only in `main.go`), so e2e-real asserts the error
   route, not a window.
7. **Open questions resolved by the user:** picker (Q2), uncommitted-only disabled (Q3).
   Q1 (chord) stays Cmd/Ctrl+Shift+R per SPEC. Q4 moot: streams landed.

## 1. What exists (verified)

- Open: `AdeTaskService.OpenReviewWindow({branchId})` (`internal/bridge/adetask.go:751`) calls
  `TaskBoard.OpenReviewWindow` (`internal/ade/review.go:82`). Rejects archived, `parked`, uncreated
  (`name == ''`). Existing window: `FocusWindow(key)`, returns `false`. Per-task lock. Go does
  **not** reject a branch with no commits; R4 is a frontend rule.
- Target base: `reviewSpellings` (`review.go:34`): `sb.Base` resolved through the branch
  inventory, else repo main spelling.
- Board base: `computeBranch` (`board_facts.go:248`) sets wire `base` to `sb.Base` or
  `sc.mainName`, so `Branch.base` is never `''` on the wire.
- `AdeBranchPanel.baseName` (`panel/AdeBranchPanel.vue:45`): parent planner branch name, else
  `branch.base`, else `'main'`.
- Entry points today, all `useOpenReviewWindow` (`queries.ts:306`): branch row menu
  `ade-review-code` (`AdeBranchRow.vue:53`), branch panel header action `review`
  (`AdeBranchPanel.vue:86`), review stage block rows `ade-review-code` (`AdeStageBlock.vue:284`).
  Three different disabled rules. No UI spec clicks any (`rg ade-review-code tests/ui` empty).
- `MenuItem.hint: string`; `ContextMenu.vue:133` renders it for top-level items only.
- `TooltipIconButton` default slot overrides the tooltip body. `AdeTip` takes `text: string`.
- Shortcut: no binding or native accelerator uses Cmd/Ctrl+Shift+R in either app.
  `shortcutFor(e, ids)` in `@workbench/shortcuts/keys`.

## 2. Design

### 2.1 Variable text (R5): `packages/theme/src/varText.ts` + `components/VarText.vue` (new)

```ts
export type TextPart = string | { name: string; value: string };
export function plainText(parts: readonly TextPart[]): string; // aria-label, title fallbacks
```

`VarText.vue` (`<script setup lang="ts">`, props `parts`): strings render as text. A var part
renders as an inline chip: `inline-flex items-center gap-0.5 rounded-kira-xs border border-dashed
border-info/60 bg-info/10 px-1 font-data text-info`, a leading `CodiconIcon name="symbol-variable"`
(size 11), the resolved value as text, `data-testid="var-chip"`, `:data-var="name"`,
`:aria-label="`${name}: ${value}`"`. Tokens: `--color-info` exists in `tailwind-core.css`;
implementer confirms `border-info`/`bg-info` resolve, else uses the nearest theme token. No
`<style>` block. Lives in `theme` (not `ade/v2`) so P242 Part 2's variable previews reuse it.

Scope rule for R5: every value P240 substitutes into fixed copy is a var part (branch, base).
A row whose whole label *is* the data (picker items `repo · branch`, matching the existing row
menu label) is data, not interpolation, and stays plain. Copy avoids interpolating counts.

Rendering sites:
- `AdeTip.vue`: optional `parts?: readonly TextPart[]`; when set, `TooltipContent` renders
  `<VarText :parts>` instead of `text`. `v-if` covers either.
- `MenuItem.hint` widens to `string | readonly TextPart[]` (`packages/workbench/src/state/contextMenu.ts`).
  `ContextMenu.vue` renders it through `VarText` (string becomes one part).
- `ContextMenu.vue` submenu items gain the same `Tooltip`/`TooltipTrigger as-child`/`TooltipContent`
  wrap top-level items have (`:disabled="!sub.hint"`). Fixes delta 4.
- `TaskMenuItem.hint` (`board/taskMenu.ts`) widens the same way; `toItem` passes it through.

### 2.2 Shared rule: `ade/v2/board/reviewCode.ts` (new, pure)

```ts
export interface ReviewChoice {
  branchId: string;
  label: string;            // `${row.repo} · ${row.name}`
  disabled: boolean;
  tip: readonly TextPart[]; // reason when disabled, preview when enabled
}
export function baseNameOf(row: BranchRowModel, graph: BranchGraph): string;
export function reviewChoice(row: BranchRowModel, task: Task, graph: BranchGraph): ReviewChoice | null;
export function reviewChoices(card: CardModel, graph: BranchGraph): ReviewChoice[];
```

`baseNameOf` is `AdeBranchPanel.baseName` moved here; `AdeBranchPanel` imports it (one spelling;
P241 reuses it). `b = { name: 'base', value: baseNameOf(...) }`, `br = { name: 'branch', value:
row.branch.name }`. Rules, first match wins:

| Branch state | Result |
|---|---|
| `branch.kind === 'parked'` | `null` (hidden; Go rejects it) |
| `branch.name === ''` | disabled, `['Create the branch first']` |
| `ahead === 0 && dirty.length > 0` | disabled, `['Only uncommitted changes on ', br, '. Commit them to review against ', b, '.']` |
| `ahead === 0` | disabled, `['No commits on top of ', b, ' yet']` |
| a task run is `running` | enabled, `['Review ', br, ' against ', b, '\nAn agent is still working: the review updates as it commits']` |
| otherwise | enabled, `['Review ', br, ' against ', b]` |

Merged branches stay enabled. A missing base (Go `base.ok` false) also yields `ahead === 0`;
P241 adds `baseMissing` and should add a row above `ahead === 0` then (noted in §5). No unit test:
a short linear table, covered by the UI spec (CLAUDE.md test bar).

### 2.3 Composable: `ade/v2/review/useReviewCode.ts` (new)

Wraps `useOpenReviewWindow()` (TanStack mutation, unchanged), `useContextMenuStore`,
`useAdeBoardUiStore`. No new Pinia store: no new shared state.

```ts
export function useReviewCode() {
  function open(taskId: string, branchId: string, returnTo: HTMLElement | null,
                opts?: { onError?(msg: string): void }): void;
  function openTask(card: CardModel, anchor: HTMLElement | null): void;
  const pending: Ref<boolean>;
}
```

- `open`: `delete ui.actionError[taskId]`, `mutate({branchId})`. `onError`: `opts.onError` when
  given, else `ui.select(taskId)` only when that task is not selected, then
  `ui.actionError[taskId] = message`. `onSettled`: `returnTo?.isConnected` then
  `returnTo.focus({ preventScroll: true })`. The native window takes OS focus itself; refocusing
  the invoker means closing the review window returns keyboard focus to the same card or row.
- `openTask`: `choices = reviewChoices(card, graph)`.
  - 0: no call (control hidden).
  - 1: `open(...)` when enabled; disabled means the visible control is already disabled.
  - 2+: picker. `contextMenu.openContextMenuAt(rect.left, rect.bottom, items)` under `anchor`:
    `{type:'label', label:'Review which branch?'}`, then one item per choice, id
    `ade-review-pick-<branchId>`, `label`, `disabled`, `hint: tip`, run `open(..., anchor)`.
    On close without a pick: `watch(() => contextMenu.open, ..., { once: true })` then
    `nextTick` refocus `anchor`. Implementer proves with `toBeFocused()` that reka's own focus
    return does not win.
- `pending` mirrors `isPending`; buttons bind `:disabled` to it. Go's lock already makes a double
  open safe; this is feedback only.

### 2.4 Shortcut

`'ade.reviewCode': { chord: { key: 'R', cmdOrCtrl: true, shift: true } }` in
`packages/shared/domain/shortcuts.ts`. Local binding (like `grid.*`): no Go `accel.go` row.

`shell/AdeShell.vue`: wrap the Plan branch (`<AdePlanView/> <AdePanel/>`) in
`<div ref="planEl" class="contents">`. `useEventListener(planEl, 'keydown', ...)`:
`shortcutFor(e, ['ade.reviewCode'])`, skip when `e.defaultPrevented`, then `preventDefault()`.
Target, first match wins:
1. focus inside `[data-testid="ade-branch-row"][data-branch-id]`: that branch;
2. focus inside `[data-testid="ade-card"][data-task-id]`: that task;
3. `ui.selectedBranchId`: that branch;
4. `ui.selectedTaskId`: that task;
5. none: no-op.

Branch target: `open(taskId, id, focusedEl)` when its `reviewChoice` is enabled, else no-op.
Task target: `openTask(model.cardFor(id), anchor)`; `anchor` is the focused element when inside the
card, else the card head. Focus beats selection because Tab moves focus without selecting.

### 2.5 Visible actions (R1)

1. **Card head** (`plan/AdeTaskCard.vue`): `TooltipIconButton icon="git-compare" label="Review code"
   data-testid="ade-card-review"` at the right end of the head's first line (`ml-auto`),
   `@click.stop="reviewCode.openTask(card, $event.currentTarget)"`. Shown when
   `reviewChoices(card).length > 0`. Disabled (`disabledTrigger`) when every choice is disabled;
   tooltip slot `<VarText :parts="choices[0].tip"/>` for one choice, else `Review code: pick a
   branch` plus the shortcut. Review cards have no head (`v-if="!card.review"`); rows and menu
   carry the action there.
2. **Branch row** (`plan/AdeBranchRow.vue`): root gets `group`; trailing `TooltipIconButton`
   `data-testid="ade-branch-review"`, shown when `reviewChoice` is non-null, classes
   `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` plus `opacity-100` when
   selected. `@click.stop` runs `open(taskId, row.id, rowEl)`. Disabled plus `VarText` tip.
3. **Task context menu** (`board/taskMenu.ts`, `plan/useTaskMenu.ts`): `TaskMenuCmd` gains
   `{ kind: 'review'; branchId: string } | { kind: 'reviewPick' }`; `TaskMenuItem` gains
   `shortcut?: ShortcutId`; `TaskMenuInput` gains `choices: ReviewChoice[]` (computed in
   `useTaskMenu.items()`). Right after the label line, task and review cards alike:
   - 1 choice: item `ade-task-review`, `Review code`, `shortcut: 'ade.reviewCode'`,
     disabled/hint from the choice, cmd `review`;
   - 2+: submenu `ade-task-review`, `Review code`, items `ade-task-review-<branchId>` with the
     choice labels, disabled/hint each (the menu is already a picker, so no second popup);
   - 0: nothing.
   `useTaskMenu` records the anchor in `open`/`openAt` (`ev.currentTarget` or `el`) and maps
   `review` to `reviewCode.open(taskId, cmd.branchId, anchor)`. `toItem` passes `shortcut`.
   `reviewPick` is not needed if the submenu carries the picks; drop it if unused (`lint:dead`).
4. **Branch row menu** (`AdeBranchRow.onMenu`): keep id `ade-review-code`, label `Review code`,
   `disabled`/`hint` from `reviewChoice`, `shortcut: 'ade.reviewCode'`; hidden when `null`.
   `run` goes through `useReviewCode.open`; drop the inline mutate.
5. **Task panel header** (`panel/AdeTaskPanel.vue` `#actions`): `Button variant="dialog"
   size="kira-lg" data-testid="ade-panel-review"` labelled `Review code`, before `More actions`.
   `AdeTip` with `parts` (choice tip, or `Pick a branch`) plus `formatShortcut('ade.reviewCode')`.
   Calls `openTask(card, $event.currentTarget)`. Same hidden/disabled rule as (1).
6. **Branch panel** (`panel/AdeBranchPanel.vue`): `review` header action takes `:disabled` and
   `VarText` tip from `reviewChoice`, runs `useReviewCode.open` with `onError` writing the local
   `setupError`. Remove the local `openReview`. `baseName` becomes `baseNameOf`.
   `headerActions.ts` unchanged.
7. **Review stage block** (`panel/AdeStageBlock.vue`): `reviewRows` buttons take disabled/tip from
   `reviewChoice` (`AdeTip :parts`), call `useReviewCode.open` with `onError` writing `error`.
   Remove the local `openReview`.

After this, `useOpenReviewWindow` has one caller, `review/useReviewCode.ts`.

### 2.6 Not done (scope)

- No "already open" badge: no query lists open review windows; a click on one focuses it, the
  reuse the user asked for. A badge needs a bound method plus an event.
- No per-task multi-branch window: session, tabs and target are per branch by design (P150).
- No change to the review window, git-ui, Go product code or the IPC contract.
- Existing interpolated text P240 does not touch (e.g. `AdeBranchPanel` facts line) stays as is.

Library check: shadcn-vue `Button`, `Tooltip`, `TooltipIconButton`; the reka-based `ContextMenu`
store; VueUse `useEventListener`; existing Pinia `adeBoardUi` and `contextMenu` stores; existing
TanStack mutation. Every component `<script setup lang="ts">`, Tailwind utilities only. No new
dependency.

## 3. Files (ownership list)

Product, frontend (`apps/kira-space/frontend/src/`):

| File | Change |
|---|---|
| `ade/v2/board/reviewCode.ts` | new: `reviewChoice`, `reviewChoices`, `baseNameOf` |
| `ade/v2/review/useReviewCode.ts` | new composable |
| `ade/v2/board/taskMenu.ts` | `review` cmd, `shortcut`, `choices` input, entries, `hint` type |
| `ade/v2/plan/useTaskMenu.ts` | choices, run `review`, anchor, `shortcut` passthrough |
| `ade/v2/plan/AdeTaskCard.vue` | card head button |
| `ade/v2/plan/AdeBranchRow.vue` | row button, menu item via rule |
| `ade/v2/panel/AdeTaskPanel.vue` | header button |
| `ade/v2/panel/AdeBranchPanel.vue` | review action via rule, `baseNameOf` |
| `ade/v2/panel/AdeStageBlock.vue` | review rows via rule |
| `ade/v2/shell/AdeShell.vue` | `planEl` wrapper, shortcut listener |
| `ade/v2/AdeTip.vue` | `parts` prop |

Shared packages:

| File | Change |
|---|---|
| `packages/shared/domain/shortcuts.ts` | `ade.reviewCode` |
| `packages/theme/src/varText.ts` | new: `TextPart`, `plainText` |
| `packages/theme/src/components/VarText.vue` | new |
| `packages/workbench/src/state/contextMenu.ts` | `hint` widened |
| `packages/workbench/src/components/ContextMenu.vue` | `VarText` hints, submenu item tooltips |

Tests and docs:

| File | Change |
|---|---|
| `apps/kira-space/tests/ui/ade-v2-review-open.spec.ts` | new (4.1) |
| `apps/kira-space/tests/e2e-real/ade-review-open-real.spec.ts` | new (4.3) |
| `apps/kira-space/internal/flows/adeflow/review_test.go` | new (4.2) |
| `docs/ARCHITECTURE.md` | one line: interpolated UI values render through `VarText` |
| `docs/v2.2/SPEC.md` | P240 status and result |

Not touched: `ade/v2/queries.ts`, `panel/headerActions.ts`, `internal/**` product code,
`tests/fixtures/**`, `package.json`, lockfile.

## 4. Tests

### 4.1 Playwright mock tier: `tests/ui/ade-v2-review-open.spec.ts`

`openPlan(relaunch, [{ channel: IPC.adeTaskOpenReviewWindow, response: true }])`, committed
`board.json`, variants through `adeBoard(edit)`. Assert calls with the `control.log()` filter
`ade-v2-task-menu.spec.ts` uses. Fixture facts: `T_deps` one branch `b_deps` (ahead 1, a running
run); `T_bill` three created branches; `T_search` `b_search` (ahead 6) and `b_searchui` (ahead 0,
no dirty); `T_alerts` two drafts; `R_sara` review card (`b_sara`); `T_spike` parked.

1. `T_deps` card button: one call `{branchId: 'b_deps'}`. Tooltip has `var-chip[data-var=branch]`
   `chore/deps-bump`, `var-chip[data-var=base]` `main`, and the agent-working line.
2. `T_bill` card button: picker with 3 `ade-review-pick-*`; pick `b_billdash`: one call with it.
   Reopen, Escape: no call, focus back on `ade-card-review`.
3. `T_search` card button: picker; `ade-review-pick-b_searchui` disabled, hover shows
   `No commits on top of` + base chip `feat/search-index`; pick `b_search`: one call.
4. `T_alerts`: card button disabled; right-click card, `ade-task-review` submenu items disabled,
   hover hint `Create the branch first` (proves the submenu hint fix). No call.
5. `T_spike`: no `ade-card-review`, no `ade-task-review`.
6. `R_sara`: right-click card, `ade-task-review` calls `b_sara`; hover row, `ade-branch-review`:
   same call. Menu item shows the `ade.reviewCode` shortcut text.
7. Shortcut: click `T_deps` head, `ControlOrMeta+Shift+R`: one call, `ade-card-head` focused after
   settle. Click row `b_billdash`, shortcut: call `b_billdash`, no picker. Click `T_bill` head,
   shortcut: picker.
8. Task panel: select `T_deps`, `ade-panel-review`: one call.
9. Uncommitted only (R4): `adeBoard` sets `b_deps` `ahead: 0, files: [], commits: [], dirty: [one]`.
   Card button disabled; tooltip `Only uncommitted changes on` with branch and base chips. No call
   from the shortcut either.
10. Error: `adeTaskOpenReviewWindow` answers `error`. `T_deps` card button:
    `ade-panel-action-error` shows the message; stage block route shows `ade-stage-block-error`.
11. Legacy entries, one assertion each: branch-row menu `ade-review-code`, branch panel header
    review action, stage block `ade-review-code`, each calls with its branch id.

Do not edit `ade-v2-panel.spec.ts`.

### 4.2 Go flow test: `internal/flows/adeflow/review_test.go`

Real git, real temp repo, flow harness (`WindowMgr` fake), helpers from `lifecycle_test.go`
(`doneFixture`, `gitOut`). One test, `TestReviewOpenFacts`: the board facts the frontend rule reads
are real, and the base preview names what the window diffs.
1. Fresh done branch with an edited, uncommitted file in its worktree: board `Ahead == 0`,
   `len(Dirty) == 1`.
2. Commit in the worktree: `Ahead == 1`, `Dirty` empty.
3. `OpenReviewWindow`, then `ReviewWindowTarget`: `tgt.Base` names the board `Branch.Base`
   (equal, or equal after stripping the default remote prefix). Same for a stacked branch when an
   existing adeflow helper builds one; skip otherwise, no new helper for it.

No new bound method, so P236's coverage gate is unaffected.

### 4.3 e2e-real: `tests/e2e-real/ade-review-open-real.spec.ts`

Server build has no window manager, so `OpenReviewWindow` errors `review windows are not
available`. One test, `DONE_SCENARIO`, helpers from `support/ade.ts` and `support/gitRepo.ts`:
run a task to a worktree; write a file there; refresh the board the way `ade-board-real` does.
`ade-card-review` disabled, tooltip base chip `main`. Commit in the worktree, refresh: enabled,
tooltip `Review feat/... against main`. Click: `ade-panel-action-error` shows the server message.

### 4.4 Checks

Per commit: `bun run typecheck`, `lint`, `lint:dead`, Space build. Once at phase end: the new UI
spec plus `ade-v2-task-menu`, `ade-v2-plan`, `ade-v2-panel`, `ade-v2-review`, `ade-v2-run`; Studio
specs that open submenus (`rg -l context-submenu apps/kira-studio/tests/ui`: `tabs`,
`mask-preview`, `console`, `autocomplete`, `interaction`); `test:flows:space`;
`test:e2e-real:space`. No unit tests.

## 5. Overlap and ordering

- P236-P239, P244 landed; no stream holds any P240 file. Runs now, row order.
- **P241** edits `plan/AdeTaskCard.vue`, `plan/AdeBranchRow.vue`, `panel/AdeBranchPanel.vue`,
  `board/taskMenu.ts`, `plan/useTaskMenu.ts` (5 shared files) and reuses `baseNameOf`. No split:
  P241 runs after P240 is committed. P241 should add a `baseMissing` row to `reviewChoice` above
  `ahead === 0` and render its base picker labels through `VarText` (R5).
- **P242 Part 2** edits task menu and branch row again and needs variable previews: reuse
  `VarText`/`TextPart`.
- P240 touches no `internal/**` product file, no migration, no fixture.

## 6. Orchestrator verification checklist

- [ ] `rg -n "useOpenReviewWindow" apps/kira-space/frontend/src`: definition plus one caller,
      `review/useReviewCode.ts`.
- [ ] `rg -n "reviewChoice" apps/kira-space/frontend/src`: callers in `AdeTaskCard`,
      `AdeBranchRow`, `useTaskMenu`, `AdeTaskPanel`, `AdeBranchPanel`, `AdeStageBlock`,
      `AdeShell` or `useReviewCode`.
- [ ] `rg -n "VarText" apps packages`: used by `AdeTip`, `ContextMenu.vue`, `AdeTaskCard`,
      `AdeBranchRow`, `AdeBranchPanel`.
- [ ] `rg -n "'ade.reviewCode'" apps packages`: table entry, `AdeShell` listener, a menu
      `shortcut:`, the panel tip.
- [ ] `ContextMenu.vue` submenu items render `hint` (spec case 4 passes).
- [ ] `git diff --stat 6454611a0..HEAD -- apps/kira-space/internal ':!apps/kira-space/internal/flows'`
      empty; `packages/git-ui` empty.
- [ ] `package.json` and lockfile unchanged. No `<style>` block, no Options API in touched `.vue`.
- [ ] UI spec has 11 cases; Go flow test and e2e-real spec exist and pass; neighbour specs pass.
- [ ] Hooks green on every commit (no `--no-verify`). Conventional commits, one per group:
      VarText and menu hints, rule plus composable, wiring, shortcut, tests, docs.
- [ ] SPEC P240 `Done`, result filled; `ARCHITECTURE.md` has the `VarText` line.
