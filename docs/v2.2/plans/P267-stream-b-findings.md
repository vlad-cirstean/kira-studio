# P267 Stream B findings

Needs from foundation or other streams, and planned named exemptions for R.

## Named PERMANENT exemptions to add (R)

- `plan/AdeTaskCard.vue`, `plan/AdeDayBand.vue`, `plan/AdeBranchRow.vue`: U88 board canvas density (P129). `AdeDayBand` already has U60.
- `ade/v2/shell/AdeShell.vue`, `mobile/TabBar.vue`: U101 `Badge variant="count"` marks attention, not a count in a tab.
- `ade/v2/AdeAutomationsBlock.vue`: one bare `<button>` left as is.

## Shared edits not done (outside Stream B ownership)

- `ConfirmDialogView` `busy` becomes `pending` in C6. Space callers still pass `:busy`: `AdePlanView.vue`, `AdeForcePushDialog.vue`, `AdeTakeOverDialog.vue`, `AdeAbortRebaseDialog.vue`, `mobile/screens/NeedsScreen.vue`, `mobile/screens/PlanTaskCard.vue`. Rename at merge.
- `isPrimaryModifier` takes `KeyboardEvent` only. `AdeNotesEditor` casts a `MouseEvent`. Widen the signature in `packages/workbench/src/shortcuts/keys.ts`, then drop the cast.
- Review code shortcut: add `ade.reviewCode` to `shell.Shortcuts` (`internal/shell/accel.go`) and `CHANNEL.reviewCode` to `packages/shared/protocol/events.ts`. Space uses a local `reviewCodeChord` in `internal/appshell/menu.go` and the literal channel `kira:menu:reviewCode` in `bridge/index.ts`.
- `useListNavigation().contextMenu` calls `onSelect`, which toggles dirs and opens files. `RepoFileTree` and `RepoList` keep explicit select-on-right-click.
- `TruncatedText` tooltip shows only on overflow. Repo-row root-path tooltip now appears only when truncated.
- `Spinner` has no `data-slot`. Mobile loading spec matches `.animate-spin`.

## Specs not written

- Review decoration load failure (`[data-slot="alert"]` with Retry in `ReviewBanner.vue`). `gitStreamMock` answers only `ok` results and has no wire-error path. Opening a review diff tab also needs `repo.file`/diff fixtures. Needs a mock extension (`{ t:'res', ok:false, error }`) first.

## Specs updated, unverified (not run, by instruction)

- `ade-v2-review-open.spec.ts`: `pressReview` emits `IPC.reviewCode` (no window keydown).
- `ade-v2-sessions.spec.ts`: `ade-session-id` plus `getByRole('button')`.
- `mobile/tabs.spec.ts`: plan group heading is `[data-slot="section-heading"]`; status chip is `ade-chip`.
