# P264 Stream B findings

Foundation gaps hit during Stream B. Each worked around in Space code. Foundation owner decides.

## Foundation gaps

- `ContextMenu` close steals focus from a text field. `startRepoRename` waits for menu close plus `promiseTimeout(0)` before focusing.
- `ConfirmDialogView` lacks `cancelLabel`. "Keep" / "Leave" cancel buttons now read "Cancel".
- `menu.open` is Shift+F10 only. `AdeTaskCard` lost the `ContextMenu` key (U40 blocks `@keydown.context-menu`).
- No generic delete shortcut id. `AdeWorkflowGraph` plain Delete stays `permanent U40` (must reach text fields).
- `plural()` has no thousands grouping.
- `formatRelative` has no future form ("in 2h").
- `behaviour/format` has no date-only helper. `mobile/state/useAgentsModel.ts` label "Tue, 14 Oct" stays `permanent U52`.
- `TIMING` lacks a transient-note key. Capture note and terminal notice use `copiedFeedback` (1500 ms, was 2000/3000).
- `TIMING` lacks a refit/validate debounce key. Uses `search` / `preview`.
- `formatDuration` renders "5.0 s" for the preparing tag.

## Behaviour shifts

- Needs age column reads "5m ago", was "5m". Column widened to `w-19`.
- Repo tree: Playwright click on a dir leaves it collapsed (also at base `b4c455db1`). Spec uses ArrowRight.
- Tree sort is natural (`file2` before `file10`). Unit expectation updated.

## Spec adaptations

- Clipboard stubs target `navigator.clipboard.writeText` (`useCopy`): ade-v2-task-menu, ade-v2-sessions.
- Test UA is Mac: `form.save` is Meta. ade-v2-workflows presses `Meta+s`.
- `rebaseActions.retry` renamed `isRetry`; unit test updated.

## Known failures not fixed

- repo-graph specs (refresh 53/129, paging, columns, badges, workspace 435/1159) fail in the full run. Same two refresh tests fail identically at base `b4c455db1` (3 repeats each, workers=1). Not caused by Stream B.
- ui-timing wall-clock budgets: budgets.spec completion-popup p50, perf.spec scroll p95.

## Permanent allowlist

All eight `stream-b.txt` lines carry a reason in the file.
