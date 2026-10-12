# P269 code review round 2: findings

Base commit: `761fdf502` (same base as round 1). Scope: `git diff 761fdf502..HEAD` at `348ba9b6b`:
1696 files, 371 commits. Round 1 fixer commits (`7ffe473d9`, `62833d315`, `e6aa879ee`, `a915c7e42`,
`0e4ced4eb`, `9b84758b4`, `254ca61e7`, `295fdde7d`) reviewed as unreviewed code.

Reviewer: one Opus pass, three dimensions (architecture/security, correctness, performance). Report
only; fixer commits per group below.

## Scope and method

- Round 1 fixer commits, each traced to its callers.
- Go: P266 error model across `adetask.go`, `codeworkspace.go`, `mobileweb/*`, `gitsession/ops.go`,
  `prompts/router.go`, `scriptruns/bound.go`, `terminal/validate.go`, `appupdate/install.go`,
  `collections.go`; Go catalog reader; every `renameio` adopter.
- Frontend: P264 behaviour composables (`latest`, `asyncAction`, `followTail`, `persisted`,
  `panelSearch`, `listNavigation`, `activeDescendant`), `createTabsStore` close family and every
  programmatic `closeTab` caller, P265 format-helper consolidation (every removed local formatter
  checked against its replacement), ADE board actions, memory panel and queries, git-core i18n
  moves, git-ui `OpsState`, grid formatters, mobile app wiring, guards and hooks.

## Round 1 fixes: verdicts

- `7ffe473d9` (discard confirm in git-ui and mobile): provider wiring correct. git-ui reaches the
  host Pinia and both hosts mount `ConfirmDialog`; review decoration mini-apps hold no dirty dialog.
  Touch sizing gap: P269-4.
- `62833d315` (`dropTabs`): correct. Shares `closeTabInternal` (pinned skip, active hand-off,
  `onClosed`), one `saveNow`. The only other programmatic close loop
  (`closeVariableSetTabsForOwner`) closes a kind with no `isDirty`, so it never prompts.
- `e6aa879ee` (`shortcutKeydown` on `DialogContent`): correct. `onKeydown` reaches reka's content
  element through `$attrs`. Portaled popovers and the discard confirm do not bubble into it, which
  is the intended scoping. No dialog body holds Monaco; `AutocompleteField` was already ahead of the
  window listener at base. No other `useShortcut(window, …)` remains.
- `a915c7e42` (memoised split): correct. Text and dialect drive the split; caret moves only scan.
- `0e4ced4eb` (ANSI cache): correct. `lines` is a `shallowRef` of plain objects, so the write in
  the computed tracks nothing; line text is immutable and every reopen or clear makes new objects.
- `9b84758b4` (reveal and scroll closer): correct. The scroller carries `.autocomplete-suggestions`;
  a document scroll still closes the popup.
- `254ca61e7` (`String(n)`): correct at the PR call sites; the same defect remains elsewhere
  (P269-5).
- `295fdde7d` (`WithStaticPermissions`): correct. renameio chmods the temp file when the mode
  differs. macOS-only app, so no Windows path. A symlinked token file is replaced by a regular file;
  the removed `AtomicWriteFile` did the same.

Nothing real found in: P266 Go error mapping (every code a UI branches on, `E_PREPARING`,
`E_ALREADY_IMPORTED`, `E_CONFLICT` for workflow saves, is still emitted on its path; mobile status
mapping and idempotency codes are consistent with the phone client), Go catalog reader (all keys
literal), remaining `renameio` adopters (app-private dirs), git-core `TextRef` moves, `OpsState`
i18n, ADE `catalogParts`, memory panel and query `staleTime`, Pinia store ids (unique), grid date
formatters (visible cells only), `createLatestRequest` and `runLatest`, `useFollowTail`,
`usePersistedState`, list navigation, added listeners and timers (none raw), guards (failures
recorded, no masked exit).

## Group 1: duration helpers swapped for the wrong formatter (root cause: P264/P265 format consolidation)

### P269-1 (Low) ADE "Preparing" timer can show a negative millisecond value

- Where: `apps/kira-space/frontend/src/ade/v2/board/actions.ts:275,336`;
  `apps/kira-space/frontend/src/ade/v2/plan/usePlanModel.ts:234-256`.
- Defect: the removed local `formatElapsed` clamped at 0 and showed whole seconds. Its replacement
  `formatDuration` is the finished-duration formatter (`theme/src/format.ts:31`): no clamp, tenths
  under a minute, `toFixed(2)` milliseconds under 1ms. `liveNow` ticks every 30s
  (`TIMING.clockTickSlow`) until a setup runs. `secondTick.resume()` has no immediate callback, so
  the first second after a setup starts reads a `liveNow` up to 30s old.
- Failure: start a task whose repo has a prepare-worktree script. For about 1s the branch chip reads
  "⚙ Preparing -17342.00ms". After that it shows "12.4s" style tenths on a once-a-second clock,
  where base showed "12s".
- Fix: use `formatCompactDuration` (floors, clamps at 0; its doc names the elapsed-clock use) at both
  call sites.

### P269-2 (Low) Weekly Claude usage reset reads in hours, not days

- Where: `apps/kira-space/frontend/src/workbench/ClaudeUsageItem.vue:63-65`.
- Defect: the removed local `span()` rendered `{d}d {h}h` past a day. `formatDuration` stops at
  hours.
- Failure: Space status bar, Claude usage tooltip, weekly window: "resets Oct 19 … (in 167h 12m)";
  base showed "(in 6d 23h)".
- Fix: add a day step to the shared compact formatter (catalog keys for `{days}d {hours}h`) and use
  it here, or keep a day-aware helper in the theme format module.

## Group 2: user-sized input reported as a Kira defect (root cause: P266 `Contract` classification)

### P269-3 (Low) Over-long ADE message or YAML shows "Something went wrong inside Kira"

- Where: `apps/kira-space/internal/bridge/adetask.go:132` (`adeTaskInvalid` is
  `ipcerr.Contract`), used for user-sized values at `:392`, `:517`, `:553`, `:564`, `:691`, `:799`,
  `:813`, `:827`; display in `packages/workbench/src/bridge/codedError.ts:52-56`.
- Defect: `ipcerr.Contract` means "the UI always sets the value, so a violation is a Kira defect"
  (`internal/ipcerr/text.go`). Message length, workflow YAML size and repo-config script size are
  typed or pasted by the person, and no UI field caps them (no `maxlength` in the ADE Claude dialog,
  the phone reply sheet, the YAML editor or the repo config form). `errorText` wraps every
  `E_CONTRACT` in `common.error.contract.body`. The same file already maps name and notes length to
  `E_BAD_REQUEST` with catalog text (`adetask_validate.go:63-74`).
- Failure: ADE, task, Claude dialog. Paste a log over 32 KiB and send. The dialog shows "Something
  went wrong inside Kira (message is too long)." The phone reply sheet shows the same through
  `writeServiceError` (400). Pasting a YAML file over 1 MiB into the workflow editor does the same.
  Base showed a plain "message is too long".
- Fix: return `ipcerr.T(ipcerr.CodeBadRequest, <catalog key>, …)` for message, YAML, prepare-script
  and deployed-sha-script limits, mirroring `validateAdeNotes`. Keep `Contract` for ids, list counts
  and enum fields the UI controls.

## Group 3: phone discard confirm (root cause: fixer commit `7ffe473d9` reused the desktop host)

### P269-4 (Low) Mobile discard confirm uses desktop-size buttons

- Where: `apps/kira-space/frontend/mobile/App.vue:22`; `packages/workbench/src/components/ConfirmDialog.vue:29-40`;
  `packages/workbench/src/components/ConfirmDialogView.vue:15,70,81`.
- Defect: the phone mounts the store-host `ConfirmDialog`, which renders `ConfirmDialogView` without
  `touch`. The view documents `touch` as "the phone's 44px buttons", and every other phone confirm
  passes it. The reply sheet it guards uses `size="touch"` buttons.
- Failure: phone, Needs, Reply, type text, tap the X. "Discard unsaved edits" opens with `kira-lg`
  desktop buttons (well under the 44px target) over a sheet with 44px buttons.
- Fix: give `ConfirmDialog` a `touch` prop forwarded to the view and pass it from the mobile
  `App.vue`.

## Group 4: identifiers grouped as counts (root cause: P268-7 fix applied only at the PR sites)

### P269-5 (Low) Kafka partition ids render with digit grouping

- Where: `apps/kira-studio/frontend/src/views/stream/StreamFilterRow.vue:143,227`;
  `apps/kira-studio/frontend/src/views/stream/StreamFilterHistoryMenu.vue:42`.
- Defect: `t()` groups every numeric param (`theme/src/i18n/index.ts:20-27`). The rule noted beside
  `t()` says an identifier passes `String(n)`. Partition ids are passed as numbers.
- Failure: a Kafka topic with 1000 or more partitions. The partition picker lists "Partition 1,024".
  The filter button and the filter history menu show the same.
- Fix: pass `String(p)` at the three sites.

## Process note

`docs/v2.2/plans/P268-findings.md` still exists after its round was fixed. `CLAUDE.md` ("No
findings document survives a round once fixed") and the P268 row ("findings file deleted once
fixed") both require it gone. The P269 fixer should delete it with this file once round 2 lands.

## Counts

- High: 0
- Medium: 0
- Low: 5 (P269-1, P269-2, P269-3, P269-4, P269-5)
