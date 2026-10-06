# P170 review: shared-space-frontend

Base commit `f40cd35`. Reviewed HEAD `13b1f86` (branch `p168-stream-b`, equal to local `v2.0`).
Scope: `git diff f40cd35..HEAD` over `packages/**`, `apps/kira-space/frontend/**`,
`apps/kira-space/tests/**`, `apps/kira-space-vscode/**`, P168 Parts 9, 17 (TS), 18, 19, 21, 22
(frontend), 23. Go is out of scope. Parked items P172-P180 are not re-reported.

Counts: high 0, medium 1, low 6.

## F1 (medium): blame disappears when the workspace folder path is not git's real path

- Where: `apps/kira-space-vscode/src/blameWidget.ts:149-151` (Part 23 F6 fix, `e3c0419`).
- What: the blame path is now `relative(repo.root, fsPath)`. `repo.root` comes from
  `git rev-parse --show-toplevel` (`apps/kira-space/internal/gitclient/repo.go:214`), which
  resolves symlinks. VS Code's `document.uri.fsPath` keeps the path the folder was opened by.
- Scenario: open a workspace through a symlink (`~/code` linked to `/Volumes/data/code`, or any
  folder under macOS `/tmp` or `/var`, whose real path is `/private/...`). `rel` starts with
  `..`, the new escape guard fires, and the status bar shows no blame for every line. Before the
  fix, blame worked for this setup whenever the folder was the repo root.
- Fix: resolve the document path with `fs.promises.realpath` (NFC) before `relative`, or relate
  it to the folder first and prefix the folder's own path relative to the realpath'd root. Keep
  the escape guard.

## F2 (low): Part 21 F14 left two sibling `role="button"` rows unfixed

- Where: `apps/kira-space/frontend/src/ade/v2/needs/AdeAllSessionRow.vue:53`,
  `apps/kira-space/frontend/src/ade/v2/backlog/AdeBacklogRow.vue:66`.
- What: `fbfdf9b` fixed only `AdeTaskCard` and `AdeBranchRow`. `AdeAllSessionRow` still has
  `@keydown.enter="open"` without `.self`, and neither row handles Space.
- Scenario: in Needs > All sessions, Tab to "Take over" and press Enter. The button's click
  requests the take-over and the bubbled keydown also runs `open()`. Space on a focused row does
  nothing in both components.
- Fix: same as `fbfdf9b`: `@keydown.enter.self` plus `@keydown.space.self.prevent` on both rows.

## F3 (low): tab strip `tablist` owns non-tab buttons and has no arrow-key model

- Where: `packages/workbench/src/components/TabStrip.vue:247`, `:259`, `:272`, `:315` (Part 9 F11
  fix, `9145627`).
- What: the row is now `role="tablist"`, each chip `role="presentation"`, and the inner button
  `role="tab"`. The close button stays a sibling inside the presentation chip, so it becomes a
  direct owned child of the tablist (an ARIA required-children violation axe reports). The tab
  pattern also promises Left/Right navigation with one tab stop; every tab stays a Tab stop and no
  arrow handling exists. Pinned tabs sit outside the tablist.
- Scenario: a screen reader announces "tab 1 of N" while the user cannot move by arrows, and the
  close controls are reported as invalid children.
- Fix: either drop the tab roles (keep `aria-current` on the active chip button, named close
  buttons stay) or implement the full pattern: roving `tabindex`, arrow keys, and close buttons
  taken out of the tab sequence (`tabindex="-1"`, Delete on a focused tab closes it).

## F4 (low): a stale repo-list response can now close a workspace the user just opened

- Where: `apps/kira-space/frontend/src/state/coderepos.ts:27-33` (Part 22 `1b0af29`).
- What: `hydrateCodeRepos` replaces `records` with whatever response lands last, with no ordering
  guard, and since `1b0af29` it also closes every open workspace missing from that list. It now
  runs on every repo-list broadcast (`ade/queries.ts:70-73`), from ADE import
  (`ade/v2/queries.ts:335`), and from `openRepoAtPath`/`reorderCodeRepos` recovery paths.
- Scenario: a list request issued before an import commits resolves after `openRepoAtPath` has
  appended and opened the new repo. The stale list lacks it, so the new workspace and its tabs are
  closed; the next broadcast restores the record but not the workspace. A response that lands
  between the import's insert and its own append also leaves the record listed twice.
- Fix: guard with a request sequence (apply only the newest response), and replace the local
  appends in `importRepoViaDialog`/`openRepoAtPath` with an upsert by id.

## F5 (low): `editor.openAllChanges` still joins a server path without containment

- Where: `apps/kira-space-vscode/src/proxyHandlers.ts:403` (sibling of Part 23 `dbdf14c`).
- What: `dbdf14c` added `containedPath` for `editor.openWorkingDiff` and
  `editor.resolveConflict`, but `openAllChanges` still builds `resource` as
  `join(root, change.path)` unchecked. The multi-diff editor offers Open File on that resource.
- Scenario: a crafted repository with a tree entry whose name holds `..` components yields a
  resource outside the repo root. Low: needs a hostile repo and an explicit Open File click.
- Fix: `containedPath('editor.openAllChanges', root, change.path)`, skipping (or labelling only)
  an entry that escapes.

## F6 (low): Part 22 hand-rolls a second subscribe-before-snapshot helper

- Where: `apps/kira-space/frontend/src/state/gitClients.ts:46-66` (`5831164`).
- What: Part 9 added `packages/workbench/src/state/hydrateThenSubscribe.ts` for exactly this
  shape. Part 22 re-implements it with two pushed flags and no unsubscribe on a failed snapshot
  (a rejected `Promise.all` leaves both listeners installed, unlike the shared helper).
- Fix: two `hydrateThenSubscribe` calls (pairing, clients) plus the plain `gitVsixStatus` read.

## F7 (low): unit test below the repo's test bar

- Where: `apps/kira-studio/tests/unit/hydrate-then-subscribe.spec.ts:22-35`.
- What: "a failed snapshot unsubscribes and rethrows" is a single-bad-input-to-single-error path,
  which CLAUDE.md excludes. The first test (push during the await wins) is ordering logic and
  stays.
- Fix: delete the second test.

## Dropped candidates

- Theme `TooltipContent` `pointer-events-none` (`288cb84`): reka's grace polygon includes the
  content rect, so the tooltip still stays open while the pointer is over it (WCAG 1.4.13
  hoverable holds). No tooltip in any app holds interactive content. Only text selection inside a
  tooltip is lost. Not a regression.
- Headless xterm (`26578f9`): the ADE reaper (`adeTerminals.ts`) runs `cleanupTabRuntime`, so the
  xterm is disposed; ADE opens at 80x24, xterm's default, so no size mismatch; Studio views attach
  a sink before `openTerminalSession`, so no extra xterm there.
- `hydrateThenSubscribe` concurrent calls leak a subscription: every caller runs once at boot.
  Whole-state events make the "latest push over snapshot" rule converge.
- Lazy `getItem` (`158892b`): no consumer keeps an item past the render pass (no `getDataItem`
  callers); all six `CommitRecord` fields are covered.
- Re-lease after eviction (`ef18204`) can repeat forever for a stream that keeps closing: bounded
  to 1 Hz by `RELEASE_RETRY_MS`, as designed.
- Tab save re-queue (`9145627`): `saveIfChanged` overwrites `nextSnapshot`, so the re-queue rarely
  matters, but the close-time flush always retries a failed save. No data loss.
- Double-click guards are per component instance (two surfaces for one task each have their own
  `busy`): Part 20's single-pending-launch guard covers the server side.
- Credential queue identity (`a951738`), pairing dialog close, resize handle (`05b13be`), Part 21
  store split (`bd06682`, three real one-concern stores with callers), workflow save scope,
  review-window watched turn, rebase/archive close-after-delivery: checked, correct.
- VS Code restored virtual documents after a >10 s wait: whether VS Code keeps an unresolved
  document in `workspace.textDocuments` is host behaviour no fake-host test proves; not reportable
  without a real VS Code host (P180).
- Review mark queue (`e3145b1`) clears `markError` per run, so an earlier failure can be hidden by
  a later success; the file list still reflects server state. Below the bar.
- Env row keys (`a45bb8c`) drift if another window removes a middle row: rare cross-window case,
  draft text only.
- `defaultRemoteFor` with slash-containing remote names: `remoteNamesFrom` already supports only
  single-segment names.
- Part 19 F4 (failed form dialog shows no visible error) is parked in P173.

## Coverage

Read in full, with one-hop callers: `createTerminalsStore.ts`, `terminalRenderer.ts`,
`terminalRendererLoader.ts`, `useTerminalMount.ts`, `adeTerminals.ts`, `hydrateThenSubscribe.ts`
and its four stores plus spec, `createTabsStore.ts` save chain, `TabStrip.vue` diff, Part 9
`4e76d45`/`666af00` diffs (OpLogPanel, TextPromptDialog, keys, TooltipDisabledTrigger,
QuickCommandsDialog, TerminalPanel, confirm label), `TooltipContent.vue`, `useLiveRegion.ts`,
`liveAnnouncements.ts`, App.vue announce wiring, `columns.ts` lazy item, `CommitGrid.vue` tab
stop, `RowContextMenu.vue`, five form dialogs, `rowMenuModel.ts` remote choice, `reviewFiles.ts`
mark queue, `layoutClient.ts` fallback, `rpc.ts` stream supersede removal and its two callers,
`socketChannel.ts` frame join, Part 21 `AdePanelResizeHandle.vue`, `AdeReviewWindow.vue`,
`adeBoardUi.ts` and the three new stores, `useTaskAction.ts`, `useNeedsAction.ts`, `adeTakeOver`
guard, `usePlanDrag.ts`, `usePlanModel.ts` phase key, `flow.ts` rebase/archive, `queries.ts`
workflow save scope and signals, `AdeRepoDetail.vue` env keys, card/branch row keyboard and their
sibling rows, Part 22 `gitCredential.ts`, `GitCredentialDialog.vue`, `GitPairingDialog.vue`,
`gitClients.ts`, `transport.ts` eviction, `repoHeads.ts`, `worktrees.ts`, `coderepos.ts`, Part 23
`connection.ts` (`whenConnected`, secret-storage handling), `extension.ts` status bar and
credential queue, `editorIntegration.ts` refresh, `reviewComments.ts` generations,
`reviewMarking.ts` base memo and repo-changed gate, `blameWidget.ts`, `proxyHandlers.ts`
containment. Changed UI specs for the above were read for vacuity (panel resize, review resize,
take-over double click, order-record failure, watched turn, notes debounce with installed clock).
Skimmed by diff only, no finding: Part 17 `614f647`/`f33f54f` error-code passthrough, Part 18
`2362bbd`, `7d42bde`, `3b2a878`, `f5ec5ac`, `412c64b`, `f1ce795`, Part 19 `6f03acf`, `d6446f2`,
`c7f4e09`, `8c6e369`, `9bcca97`, `c75982d`, `779007f`, Part 21 `786dde7`, `62ddf37`, `ec5695f`,
`24ea12e`, Part 22 `dfc803b`, `1aacb0d`, `5578ea7`, Part 23 `490a56b`, `72cd099`, and the
pre-P168-numbered ADE fixes (`6af53ab`..`b604dbf`).

## Routed

None. Every finding sits in this area's files.
