# P268 code review round 1: findings

Base commit: `761fdf502` (code review round 2 close-out). Scope: `git diff 761fdf502..HEAD` at
`c29be265a` (P262-P267, plus the docs/CI/dev commits before P262): 1693 files, 360 commits.

Reviewer: one Opus pass, three dimensions (architecture/security, correctness, performance). Report
only; fixer commits per group below.

## Scope and method

Areas, each with owned files plus one-hop callers:

- A. Theme and workbench foundations: dialog parts and dirty guard, confirm and context menu stores,
  `behaviour/*` composables, `usePaneResize`, `QueryState`, `AutocompleteField`, `LogLines`, i18n
  runtime, `createQueryClient`, `createTabsStore`.
- B. Studio frontend: P267 A8 splits (console, document, stream, key-value, HTTP, gRPC, cell editor,
  connection dialog), tab kinds, menus, error-code branches.
- C. Space frontend and mobile: ADE board/panel/layout, review decorations, mobile screens.
- D. git-ui and docker-ui: `mount()` app, state classes on `createLatestRequest`, `CommitGrid`,
  docker edit diff, logs.
- E. Go: `ipcerr` codes and catalog reader, retired legacy codes, P266 bridge error model,
  `renameio` adoption, mobileweb mapping, prompts router, scriptruns, terminal, adapters.
- F. Guards and tests: `check-ui-primitives`, catalog checker, new specs.

Mechanical checks run (not committed): `vue-tsc` with `checkUnknownEvents`, `checkUnknownProps` and
`strictTemplates` on Studio, Space, mobile, docker-ui and git-ui. No renamed emit or removed prop has
a stale listener or caller (`cancel`->`close`, `pick`->`select`, `update:doc` and others all
resolve). Hits were fallthrough attributes and `v-model` width (`string | number`), not defects.
Error-code literals in TS all exist in `internal/ipcerr/codes.go` or `CLIENT_ERROR_CODES`; every
code a UI branches on is still emitted on that path in Go. Event-channel rename (`5636f481f`): Go
and TS names match. Catalog keys used by Go all exist; none carry vue-i18n plural or linked syntax.
New specs all assert.

Nothing real found in: event-name and bridge renames, legacy-code retirement, `createLatestRequest`
move (every git-ui caller passes `isCancelledTransport`), `persisted.ts` key migrations, ADE width
move to the layout store (validated both sides), docker `editDiff` catalog swap (`formatBytes` is
byte-identical to the old `formatSize`), Studio document/stream/key-value splits (P21 memos and the
stream resize single-commit survive), `createQueryClient` `staleTime: Infinity` default (every
non-push query sets `staleTime: 0` or polls), credential reveal split, `openExternal` (Go
re-validates URLs), added `v-html` sinks (both escaped), Go panics back to `E_INTERNAL`.

## Group 1: dirty guard inert outside the two shell apps (root cause: missing provider)

### P268-1 (Medium) Dialog discard guard does nothing in git-ui and mobile

- Where: `packages/theme/src/components/ui/dialog/DialogContent.vue:61-80`;
  `packages/workbench/src/bootstrapShell.ts:20-22`; `packages/git-ui/src/main.ts:96-117`;
  `apps/kira-space/frontend/mobile/main.ts:25-32`.
- Defect: `CONFIRM_DISCARD_KEY` is provided only by `provideShellServices`, which only the Studio
  and Space desktop `main.ts` call. git-ui's `mount()` builds its own Vue app (`createApp(MountRoot)`)
  and the mobile app has its own `createApp(App)`; neither provides it. In `requestClose`,
  `confirmDiscard` is `null`, so a dirty dialog closes at once on Esc and on the header X.
  `onPointerDownOutside` still blocks an outside click, so the guard only half-works.
- Affected: every git dialog with `:dirty` (`BranchDialog`, `TagDialog`, `RenameRefDialog`,
  `StashDialog`, `WorktreeDialog`, `StackDialog`, `ForcePushDialog`, `ResetDialog`,
  `RepoSettingsDialog`, `WorktreeList` confirm) and mobile `ReplySheet.vue:54`.
- Failure: Space, Git module, New branch dialog, type a name, press Esc. The dialog closes and the
  name is lost with no "Discard changes?" prompt. Same on the phone reply sheet's X. P267 B5 and the
  U100 guard report these dialogs as guarded; the guard is satisfied by an attribute that has no
  effect here.
- Fix: in git-ui `mount()`, call `provideShellServices(app)` (git-ui already reaches the host Pinia
  through the active-Pinia fallback for `useContextMenuStore`, and the host `ConfirmDialog` renders
  the confirm). For mobile, provide a `ConfirmDiscard` built on the phone's own `ConfirmDialogView`
  flow, or drop `dirty` from `ReplySheet` and exempt it explicitly. Add one UI spec per surface
  (git dialog Esc asks; mobile sheet X asks).

## Group 2: tab dirty guard on programmatic closes

### P268-2 (Medium) Deleted-connection cleanup now prompts, and declined or auto-declined tabs break every tab save

- Where: `apps/kira-studio/frontend/src/state/tabs.ts:174-181`;
  `packages/workbench/src/state/createTabsStore.ts:505-510`;
  `packages/workbench/src/state/confirmDialog.ts:33-37`.
- Defect: `onConnectionsChanged` closes tabs of a deleted connection through `actions.closeTab(id)`,
  which since P267 asks "Discard changes?" when the tab kind's `isDirty` is true (`data` with pending
  grid edits, `document`/`keyvalue` with a dirty edit buffer). The loop does not await, so with two
  or more dirty stale tabs each new `confirm()` settles the previous one as `false` (store F9 rule):
  every tab but the last stays open without the user choosing. A declined prompt also keeps the tab.
- Failure: open a table tab, stage a cell edit, delete that connection from the project panel and
  confirm the delete. A discard prompt appears for a connection that no longer exists. Decline it (or
  have two such tabs): the tab keeps a `connectionId` whose `tabs` row was cascade-deleted, so every
  later `tabsSave` for the window fails the whole replace-all transaction on the foreign key
  (`repos/tabs.go:92-117`). Tab persistence for that window stops until the tab is closed by hand;
  the save error only logs. This is the D7/F7 failure the comment above the loop exists to prevent.
- Fix: give `createTabsStore` an unguarded close for system-initiated cleanup (for example
  `closeTab(id, { force: true })` or a `dropTabs(ids)` action that reuses `closeTabInternal` plus one
  `saveNow()`), and use it here. Keep the prompt for user-initiated closes only.

## Group 3: window-level submit shortcut

### P268-3 (Low) Cmd/Ctrl+Enter in one automations dialog runs another dialog's action

- Where: `packages/workbench/src/automations/ScriptDialog.vue:241`,
  `packages/workbench/src/automations/run/RunScriptDialog.vue:139`,
  `packages/workbench/src/automations/schedule/ScheduleConfirmDialog.vue:121`.
- Defect: P267 moved `form.submit` from the dialog element (`@keydown.meta.enter` at base) to
  `useShortcut(window, ...)`. The handler calls `preventDefault`, and `useShortcut` skips events
  already prevented, so when two of these dialogs are mounted the first one registered always wins,
  wherever focus is.
- Failure: Automations, edit a script (`ScriptDialog` open). A cron fire routes the schedule
  confirm popup to the main window (P246). Focus is in the popup; Cmd+Enter saves the script dialog
  behind it and does not run the scheduled script.
- Fix: bind the shortcut to the dialog's own content element (a template ref on `DialogContent`, as
  `ReviewThread.vue` does with its textarea), not `window`.

## Group 4: performance regressions from P267 splits and rewrites

### P268-4 (Medium) Console re-splits the whole document on every caret move again

- Where: `apps/kira-studio/frontend/src/views/console/useConsoleRun.ts:44-49` (from `936d75297`).
- Defect: `statementAtCursorText` calls `splitSqlStatements(text, ...)` inside the computed that also
  reads `cursorPos`. The pre-split `ConsoleView.vue` kept the split in its own computed
  (`splitStatementsForText`, P21 round 2 performance finding 9) so a caret move only ran the cheap
  `statementAtOffset` scan. `canExplain` and `explainTooltip` are template-bound
  (`ConsoleView.vue:309,317`) and `cursorPos` updates on every `update:cursor`
  (`ConsoleView.vue:423`).
- Failure: every arrow key or click in a large SQL console re-runs the full quote/comment/
  dollar-quote state machine over the whole document. `docs/PERF.md` puts the console keystroke path
  at 43.4ms p50 against a 50ms budget; this adds a full split per caret move on top.
- Fix: restore a `splitStatements` computed keyed on `tab.state.text` and dialect, and have
  `statementAtCursorText` call `statementAtOffset(splitStatements.value, text, cursorPos)`.

### P268-5 (Low) Docker logs find re-parses ANSI for every buffered line on every batch

- Where: `packages/docker-ui/src/components/LogsView.vue:57-71`.
- Defect: `matchLines` maps all `lines` (cap `MAX_LINES = 20_000`) through `plain()`, which runs
  `parseAnsi` (Anser) per line. It recomputes whenever `lines` changes, which is every `onLogs`
  batch while the stream follows. The base filter used a plain `toLowerCase().includes` per line.
- Failure: with find open on a coloured, chatty container log near the cap, each incoming batch
  re-parses up to 20k ANSI lines on the main thread; scrolling and typing stutter while the stream
  runs.
- Fix: compute the plain text once per line in `append()` (store it on `Line`) and match against
  that; `matchLines` then stays a cheap scan.

## Group 5: AutocompleteField popup on reka Popover

### P268-6 (Low) Overflowing suggestions cannot be reached: wheel closes the list, arrows do not scroll

- Where: `packages/workbench/src/components/AutocompleteField.vue:173-185`, `333-338`, `432`.
- Defect: the P267 rewrite (`2a4d15dd1`) renders up to `MAX_VISIBLE = 12` options in a
  `PopoverContent` capped at `max-h-60` (240px) with `overflow-y-auto`; menu rows are `h-control`
  (22px), so 12 rows plus padding overflow. `useActiveDescendant` gets no `onActive`, so ArrowDown
  onto option 11 or 12 does not scroll it into view. The window capture `scroll` listener closes the
  popup on any scroll, including the list's own.
- Failure: in an HTTP header value, Ctrl+Space with 12 or more variables: the last options sit
  below the fold; ArrowDown highlights them out of sight; a mouse wheel over the list closes it.
- Fix: pass `onActive` that calls `scrollIntoView({ block: 'nearest' })` on the option, and ignore
  scroll events whose target is inside the popup content in `closeOnViewportChange`.

## Group 6: catalog number formatting

### P268-7 (Low) Identifiers render with digit grouping ("PR #12,345")

- Where: `packages/theme/src/i18n/index.ts:20-27` (and `CatalogText.vue:20-26`); callers
  `packages/git-ui/src/components/CommitMeta.vue:322,330`,
  `apps/kira-space/frontend/src/ade/v2/review/AdeReviewSync.vue:70,91-92`.
- Defect: `t()` groups every numeric param with `formatCount`, not only counts. PR numbers are
  identifiers but are passed as numbers.
- Failure: a repo past PR 999 shows "Open pull request #1,234 on GitHub", "#1,234 {title}" in the
  PR tooltip, "PR #1,234 is closed" and "Mark 3 files viewed on PR #1,234".
- Fix: group only `count` (and named quantity params), or pass identifiers as `String(n)` at these
  call sites and note the rule beside `t()`.

## Group 7: file permissions after the renameio swap

### P268-8 (Low) MCP token files keep a looser existing mode instead of enforcing 0600

- Where: `apps/kira-studio/internal/mcpauth/token.go:199-208` (`writeFile`, used by `Save`,
  `SaveHelperToken` and the helper script).
- Defect: `renameio.WriteFile` applies `WithExistingPermissions()` after `WithPermissions(perm)`
  (renameio v2.0.0 `writefile.go:25-28`), so an existing target keeps its current mode. The removed
  `AtomicWriteFile` always `Chmod`ed the temp file to `perm`.
- Failure: if the token record or helper token file was ever left 0644 (copied, restored from a
  backup, edited by hand), every later save keeps it world-readable; before, the next save repaired
  it to 0600. These files hold bearer credentials for the database MCP server.
- Fix: in `writeFile`, use `renameio.NewPendingFile(path, renameio.WithStaticPermissions(perm))`
  (or `Chmod(perm)` the pending file) so the mode is enforced on every write.

## Counts

- High: 0
- Medium: 3 (P268-1, P268-2, P268-4)
- Low: 5 (P268-3, P268-5, P268-6, P268-7, P268-8)
