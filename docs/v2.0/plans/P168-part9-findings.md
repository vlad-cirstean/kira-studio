# P168 Part 9 findings: shared frontend base

Plan: `P168-prep-plan.md` §5.8 (no separate review plan, per `CLAUDE.md`). Base `f40cd35`; HEAD
reviewed `1f320ff`. No commit since `f40cd35` touches an owned path (`git log f40cd35..HEAD --
<owned>` is empty), so the whole owned tree is reviewed as-is. Reviewer reports only. Fixer rules:
plan §6, §3.3.

Owned: `packages/{workbench,theme,kira-ui}/**`, `packages/shared/package.json`,
`packages/shared/protocol/events.ts`, `packages/shared/domain/{agent,base64,color,git,layout,ops,
path,repo,scripts,settings,shortcuts,tabs}.ts`.

Routed in: none. `P168-routed-from-stream{A,B,C}.md` and `P168-routed-to-stream-a.md` name no
Part 9 file (every item there targets Go, Stream C views, or Part 8).

## Findings

### Block 1: state factories, terminal, tooltip, settings

#### F1 (medium): terminal drain drops the oldest output, so a background ADE session loses its mode-setting prefix

- `packages/workbench/src/state/createTerminalsStore.ts:27-30,84-96,102-109`.
- The drain (256 KiB, oldest chunk dropped) was sized for "one tick" between open and mount. It is
  no longer that: Kira Space's ADE opens sessions headlessly (`ade/v2/dialog/deliver.ts:36`
  `openLaunch`, `state/adeDialogs.ts:87`, `state/adeTakeOver.ts:42`, `review/AdeReviewAgentPanel.vue:58`)
  and attaches a sink only when the user later opens `AdeTuiPane.vue`. `useTerminalMount` attaches
  its sink before `openTerminalSession`, so the normal tab path never drains; ADE is the drain's
  real user.
- Scenario: a `claude` session runs unattended for minutes; its TUI redraw output passes 256 KiB.
  The user opens the pane. xterm receives only the newest 256 KiB, cut at an arbitrary chunk edge.
  Lost: the start-up sequences (bracketed paste `CSI ?2004h`, focus reporting, cursor hide) and
  possibly half an escape or a split UTF-8 code point in the first kept chunk. Paste then submits
  line by line; the screen shows garbage until the next full redraw.
- Also: one chunk larger than the limit is dropped whole (`while` drops it even when it is the only
  chunk), leaving nothing.
- Fix: make the xterm instance the buffer. On `openTerminalSession` with no sink attached, create
  the terminal through the renderer (`loadTerminalRenderer()` then `getOrCreateTerminal(tabId,
  deps)`; the store cannot import the renderer statically without pulling xterm into the boot
  bundle, so pass a `rendererDeps` getter into `createTerminalsStore` or `openTerminalSession`), so xterm's own parser keeps modes and its
  5000-line scrollback bounds memory. Keep the drain only for the sub-tick window before the
  renderer chunk resolves. If the fixer keeps a byte drain instead, it must at least never drop the
  newest chunk, and must record the trade-off as a `DESIGN-DECISION` in the store comment.

#### F2 (low): a failed tab save is swallowed and never retried

- `packages/workbench/src/state/createTabsStore.ts:217-231`.
- `enqueueSave` clears `nextSnapshot` before the call; the rejection handler is `() => {}`.
  `lastSavedSnapshot` stays old, but nothing re-queues the failed snapshot.
- Scenario: one `TabsService.Save` fails (DB busy, validation error on one record). No log, no
  retry. The tab layout on disk stays stale until some unrelated tab change saves again. On close,
  `flushPendingTabState` acks after a failed save and the window closes with the newest tab state
  lost.
- Fix: in the rejection handler, `console.error` the error and, when `nextSnapshot === null`, put
  `toSave` back into `nextSnapshot` so the next `saveIfChanged`/flush retries it. Do not loop
  automatically on a persistent failure.

#### F3 (low, a11y): `TooltipDisabledTrigger` adds a second tab stop when the button is enabled

- `packages/theme/src/components/ui/tooltip/TooltipDisabledTrigger.vue:9`,
  `packages/theme/src/components/TooltipIconButton.vue:187-191`.
- The wrapper `<span tabindex="0">` is focusable regardless of the button's state. Callers pass a
  static `disabled-trigger` with a dynamic `:disabled` (`views/shared/page/PagerControls.vue:70,78,
  109,118`, `views/shared/EditBufferActions.vue:62,73,83`, `views/shared/keyvalue/KeyValuePane.vue:
  747,804,814`).
- Scenario: keyboard user tabs through the pager while on page 2. Each enabled button costs two
  Tab presses; the first lands on an unnamed `span` that screen readers announce as an empty group.
- Fix (owned files only): `TooltipIconButton` binds the wrapper's tabindex to the button's real
  state, e.g. `TooltipDisabledTrigger` takes a `disabled` prop and renders `:tabindex="disabled ? 0
  : -1"`; `TooltipIconButton` passes `!!$attrs.disabled`. Callers stay unchanged.

#### F4 (low): `WorkbenchShell` reports non-drag panel resizes as user drags, so `widthUserSet` is always true

- `packages/workbench/src/components/WorkbenchShell.vue:74-85,112`,
  `packages/workbench/src/state/createLayoutStore.ts:105-119`.
- reka's `callPanelCallbacks` fires `onResize` on the first layout (`lastNotifiedSize == null`),
  on every programmatic `resize()`, and on group-size changes. Each lands in `onProjectResize`, then
  both apps' `@resize-project="layoutStore.setProjectWidth"`, which sets `widthUserSet: true`.
- Scenario (Kira Space): first launch mounts the project panel; reka's initial `onResize(260)`
  persists `widthUserSet: true`. Later the user opens the Review tab; `GitPanel.vue:283`
  `ensureReviewPanelWidth(320)` sees `widthUserSet` and never widens. The C11 §14 OQ2 widen is
  dead. Even when the widen runs first (Review tab restored active), its own `resize(320)` echoes
  back through `setProjectWidth` and flips the flag, contradicting `ensureReviewPanelWidth`'s
  "never touches widthUserSet". Every launch also writes one needless `LayoutService.Set`.
- Fix: in `onProjectResize`, ignore a size within 1 px of `props.projectWidth` (covers mount and
  programmatic `resize()`), or emit only while the handle reports dragging (`ResizableHandle`
  `@dragging`) or after a keyboard step. Keep `lastEmittedProjectWidth`.

#### F5 (low): `QuickCommandsDialog` resyncs every draft on any record change, discarding text being typed

- `packages/workbench/src/terminal/QuickCommandsDialog.vue:36-47`.
- `syncScriptDrafts` rebuilds all drafts whenever `scripts.records()` changes. A commit is per
  blur.
- Scenario: user edits a script's name, presses Tab into its command field and keeps typing. The
  name blur's `update` round trip lands and broadcasts `customScriptsChanged`; the watcher resets
  that row's `command` draft to the stored value, erasing the characters typed meanwhile. Same when
  another window edits any script while this dialog is open.
- Fix: track the last-seen record per id; on change, overwrite a row's draft only where the draft
  still equals that row's previous record (untouched) or the record itself changed. Add new ids,
  drop removed ids.

#### F6 (low): Terminal panel runs a script with an empty cwd and drops remove failures

- `packages/workbench/src/terminal/TerminalPanel.vue:100-111`.
- `runScript` uses `script.workingDir || ctx.defaultCwd()` with no `canOpen` guard. Before
  `hydrateTerminalDefaults` resolves (or when `$HOME` cannot be resolved, `''` by contract), a run
  opens a tab with `cwd: ''`; Go's `ValidateOpen` rejects it and the user gets a failed tab instead
  of a disabled action. `useNewTerminal` already guards this exact case for plain terminals.
- `onRemove` awaits `removeScript` with no catch; the context-menu path (`run: () => onRemove(...)`)
  leaves a rejected remove as an unhandled rejection with no message (the dialog path catches and
  shows it).
- Fix: disable Run (button and menu item) while both `workingDir` and `ctx.defaultCwd()` are empty;
  catch `onRemove` errors into a visible message (reuse `addError` or a panel-level error line).

#### F7 (low): hydrate-then-subscribe gap in four store factories

- `packages/workbench/src/state/createSettingsStore.ts:136-144`, `createLayoutStore.ts:204-209`,
  `createKeepAwakeStore.ts:251-257`, `createAgentSessionsStore.ts:71-77`.
- Each awaits its snapshot, then subscribes. A broadcast landing during the await is lost.
  `createOpLogStore` already fixed this exact shape (P108 Part 12 F7: subscribe first, buffer).
- Scenario: window B boots while window A changes a setting, the layout or keep-awake. B renders
  the pre-change value until the next change. Window boot is short, so the window is small.
- Fix: subscribe before the await and keep the latest pushed value; after the snapshot resolves,
  apply the pushed value over it when one arrived. Settings/layout/keep-awake/sessions events all
  carry the whole state, so "latest wins" is exact.

Block 1 other checks, nothing filed:
- `createTabsStore` incognito watch item holds: `duplicateTab` calls `onDuplicated` (Studio copies
  the flag) before `saveNow`, and Studio's `persistable` filters incognito. Close/closeOthers/
  closeToTheRight/closeAll keep exactly one active tab per workspace.
- `order` is never rewritten after `moveTab`, but both Go `TabsRepo.Save` paths store the array
  index as `"order"`, so nothing drifts. Dropped.
- `createTerminalsStore` late-output drop holds: output after `closeTerminalSession` hits no sink
  and no `byTabId` entry. ADE terminals reach `cleanupTabRuntime` through `adeTerminals.ts:35-36`,
  so xterm instances are disposed. Dropped.
- `createSettingsStore` concurrent `patchSettings` race dropped: Settings dialogs stage edits in a
  draft and send one patch on Save; no per-keystroke patches exist.
- `SettingsShell.resetLeaf` assigns a defaults array by reference; the one array leaf
  (`git.protectedBranches`) is replaced, never mutated (`GitPane.vue:41,47`). Dropped.
- `DockResizeHandle`: VueUse 15 `useDraggable` ends on `pointerup` and `pointercancel`; no stuck
  drag. `KuiColumnResizeHandle` cleans listeners on cancel and unmount.
- `queryClient` defaults (`retry: false`, no focus refetch) match the bridge's local, non-transient
  failure model. `refetchOnReconnect` default left alone: no network dependency to react to.
- `terminalWrite`/`terminalResize` rejections (`void`ed) after a session exits: console noise only;
  the footer already shows the exit. Dropped.
