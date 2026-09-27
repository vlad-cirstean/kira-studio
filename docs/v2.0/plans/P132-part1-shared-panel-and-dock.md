# P132 Part 1 — shared Operations panel, full-width dock (Kira Studio)

Plan for `docs/v2.0/SPEC.md`'s `P132` row, split here into Part 1 and Part 2 (§1). Planned against
`v1.9` at `bcf7be70` (P129 Part 4 in flight, P133 planning in parallel; user-authorized concurrent
run, this time only).

This document is binding for the whole phase. §0-§2 fix every whole-phase decision: record
contract, shared component API, store factory, the layout choice with its evidence, and Kira
Space's producer and persistence. §3-§8 detail Part 1 only. Part 2 gets its own plan pass after
Part 1 lands, against the tree as it is then (`CLAUDE.md`), inside the boundaries of §2.6 here.

Discovery: `codegraph_explore` for symbols, call graphs and blast radius (`OperationsPanel.vue`,
`useOpsStore`, `OpRecord`/`OpKind`, shared `WorkbenchShell.vue`, `createLayoutStore`,
`toggleOperationsPanel`/`setOperationsHeight`, `ResizablePanelGroup`, `gitsession.RepoEntry.RunOp`/
`UndoRun`, `RunRemote`/`CancelRemote`, `Registry`/`NewRegistry`, Space `main.go` wiring, Space
`bridge/index.ts`, `SHORTCUTS`, both `TitleBar.vue`s, `defaultLayout`), then `Read`/`rg` for exact
lines.

---

## 0. What the SPEC row left open, and resolutions

**0.1 Layout choice: move the dock out of the horizontal group.** Not a re-proof of outer-vertical
nesting. Evidence, from source (`packages/workbench/src/components/WorkbenchShell.vue`):
- Lines 14-23 record the outer-vertical hang as a non-deterministic race: clean on a short timeout,
  hung on a long one, same steps, never root-caused. A pass count against `reka-ui` 2.10.5 (root
  `package.json:108`) cannot prove a race absent. Re-proving would leave the same risk in place.
- Lines 34-39 record a second, separate hazard: a `sizeUnit="px"` ops panel makes reka re-run
  `recalculateLayoutForPixelPanels` on every container ResizeObserver tick, feeding SlickGrid's own
  resize handling. That is why ops sits in percent with a px<->percent bridge (lines 103-117).
- A full-width flex sibling below the horizontal group puts the dock in **no** SplitterGroup at
  all. Both hazards need the dock inside a reka group, so neither can occur. The horizontal group
  keeps the one topology lines 14-16 record as proven stable.
- It deletes, not adds, machinery: `opsMarginPx` (118-126, the margin hack), the nested vertical
  group (176-211), `vGroupRef`/`useElementSize` (82-83), the percent bridge and its min/max
  (103-117), `onOpsResize` and the ops half of the ping-pong guard (93, 132-138).
- The project panel's blank strip (the bug) is structural in the old shape: project is a sibling
  of the whole main-plus-ops column. In the new shape both panels sit in the top row, and the row
  shrinks when the dock opens. No margin is needed.

The resize handle cannot be shadcn's `ResizableHandle` (a reka `SplitterResizeHandle`, only legal
inside a `SplitterGroup`). It is a new `DockResizeHandle.vue` on VueUse `useDraggable` (§2.4).
Gate stays the row's own: `tree.spec.ts`, `interaction.spec.ts`, `leaks.spec.ts`, plus the new
bounding-box test (§4.1).

**0.2 Record contract.** `OpKind` is DB-specific (`packages/shared/domain/ops.ts:3-29`). New base
`opLogRecordSchema` in the same file: `id`, `startedAt`, `durationMs`, `kind: z.string()`,
`status: opStatusSchema`, `command`, `error`. Studio's `opRecordSchema` becomes
`opLogRecordSchema.extend({...})` with its own `kind: opKindSchema`, `connectionId`, `tabId`,
`rows`, `commandTruncated`, `path`. Zero wire change for Studio. `opKindSchema` stays; the Go/TS
vocabulary parity test (`apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts:109`) is
untouched. Every consumer imports only the type (no `.parse` call anywhere, `rg opRecordSchema`).

**0.3 Persisted versus in-memory (Kira Space).** In-memory. A bounded ring in the Go process (500
records, newest first), shared by every window, lost on quit. Why:
- git's reflog is already the durable record of every ref a Space op moves. The op log is a
  session activity and failure-reading surface, not an audit trail.
- Space's SQLite has no `op_log`. Persisting needs a migration, a 64 KiB/8 KiB byte-bound policy
  and a retention pruner (Studio's `op_log` needed all three, `docs/ARCHITECTURE.md` §`op_log`
  bounds), and a write per op. No requirement names history across restarts.
- Go-side (not renderer-side) so a window opened later, or reloaded mid-op, hydrates the same list
  and still receives the running op's finish.

**0.4 Kira Space producer.** Hook inside `gitsession`, not `gitrpc`. `ade`'s queue calls
`RepoEntry.RunOp`/`RunRemote` directly (`internal/ade/queue.go:1329,1489,1678`), bypassing
`gitrpc`. Logged: `RunOp`, `UndoRun`, `RunRemote` with a non-nil `conn`, `RunRestack`. Excluded:
- `RunRemote` with `conn == nil`: auto-fetch (`autofetch.go:163`), background, never
  user-initiated. Logging it floods the list on every interval, the row's own reason for excluding
  `gitclient.Runner` reads.
- `RunPrepare` (`worktree.go:458`): runs a user script, not a git operation, and already streams
  its own output to its dialog.
- Every read path.
`RunRestack` is not named in the row but is a user-initiated git write (`stack.restack`) with its
own cancel, the same class as the named ops. Included, not a scope change.

**0.5 Cmd+J in Kira Space: menu accelerator, not keydown. Premise correction.** The row says Space
binds shortcuts by keydown (`workbench/WorkbenchShell.vue:30`). Stale since P116: Space's Go menu
emits accelerated channels (`internal/appshell/menu.go:32`, Cmd+B `Toggle Project Panel`, consumed
at `App.vue:50`). The keydown listener exists only for `view.find`, which has no Space menu item.
Studio binds Cmd+J through its menu (`apps/kira-studio/internal/appshell/menu.go:41`). Space gets
the same menu item. A keydown listener as well would double-toggle whenever the webview has focus.
The ask (a Cmd+J binding) is delivered in full; only the mechanism differs.

**0.6 Store factory seams.** Studio-only behaviour today inside `state/ops.ts`: the filter haystack
reads the connection name (`ops.ts:82`). Becomes a `searchText(record)` seam. `runState.ts` reads
`opsStore.records` (lines 20-49) and stays a Studio consumer of Studio's store instance.

**0.7 Tests "move with the code".** `tests/unit/ops-hydrate-race.spec.ts` and `ops-markraw.spec.ts`
test the hydrate/markRaw logic, which moves to `createOpLogStore`. They move to
`packages/workbench/src/state/` next to `agent-activity-reducer.spec.ts` (covered by `test:unit`,
root `package.json:55`, and both apps' unit tsconfigs). `tests/ui/operations.spec.ts` tests Studio's
own seams (connection-name filter, truncated Re-run). It stays in Studio's `tests/ui`; Playwright
suites are per app. Part 2 adds Space's own UI spec.

**0.8 Row facts re-checked.** `OperationsPanel.vue` is 427 lines. `#dock` is at shared
`WorkbenchShell.vue:198-210` (row said 193-205; the vertical group spans 176-211). `opsMarginPx` is
lines 123-126 and 159. Title-bar toggle at Studio `TitleBar.vue:64-73`. `App.vue:86` subscribes
the menu channel (row said 81). Other facts hold.

---

## 1. Split

Two parts, sequential, one Sonnet implementer each. Part 2 needs Part 1's shared component.
- **Part 1:** §0.2 contract, shared `OpLogPanel.vue` and `createOpLogStore`, Studio onto both,
  layout-store hoist, full-width dock (§0.1). Files in `packages/shared`, `packages/workbench`,
  `apps/kira-studio` only (§6). Kira Studio behaves as before, bar the width fix.
- **Part 2:** Kira Space's op log end to end: Go producer and ring, bridge, channel hoists, menu
  item, Space store and wrapper, dock and title-bar wiring, tests (§2.6).

Why split: Part 1 is a frontend refactor with a layout rework gated by the three hang-prone specs.
Part 2 is a Go producer across four `gitsession` entry points and four spawn sites plus a new bound
service. Either is a full pass alone. The split also keeps Part 1 clear of every file P129 is
editing (§8).

No worktree streams inside Part 1: the shared panel, the store factory and the Studio wrapper form
one order-dependent chain.

---

## 2. Design (whole phase)

### 2.1 Record contract (`packages/shared/domain/ops.ts`)

```ts
export const opLogRecordSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  kind: z.string(),
  status: opStatusSchema,
  command: z.string().nullable(),
  error: z.string().nullable(),
});
export type OpLogRecord = z.infer<typeof opLogRecordSchema>;
export const opRecordSchema = opLogRecordSchema.extend({ /* Studio fields, kind: opKindSchema */ });
```

Keep every existing field comment on the Studio fields. `opStatusSchema` must be declared before
the base schema.

### 2.2 Store factory (`packages/workbench/src/state/createOpLogStore.ts`)

```ts
export interface OpLogControl<R extends OpLogRecord> {
  recent(limit: number): Promise<R[]>;
  onUpdate(cb: (record: R) => void): () => void;
  cancel(id: string): Promise<void>;
}
export interface OpLogStoreOptions<R extends OpLogRecord> {
  control: OpLogControl<R>;
  /** Extra filter text per record, beyond command/kind/error. */
  searchText?: (record: R) => string;
}
export function createOpLogStore<R extends OpLogRecord>(options: OpLogStoreOptions<R>)
```

- `defineStore('ops', ...)`, same shape as `createLayoutStore`. No `extend`: no app adds actions.
- Body is today's `state/ops.ts` logic, unchanged in behaviour: `MAX_RECORDS = 500`,
  `HYDRATE_LIMIT = 200`, `markRaw` on every record, subscribe-before-snapshot buffer (F7),
  `applyUpdate`, `clearOps`, `visibleOps`, `runningCount`. Keep the F7/P21 comments, trimmed to the
  why.
- Haystack: `` `${command ?? ''} ${kind} ${error ?? ''} ${searchText?.(r) ?? ''}` ``.
- New action `cancelOp(id)`: `control.cancel(id)`, rejection caught and logged with
  `console.error('cancel op', err)`. Today's panel lets the rejection go unhandled.
- Returns `{ ...toRefs(state), hydrateOps, clearOps, cancelOp, visibleOps, runningCount }`.

Studio `state/ops.ts` becomes one call. `control` members are wrapped in arrows, not passed bound:
unit tests and `run-state.spec.ts` replace `control.*` members after import.

```ts
export const useOpsStore = createOpLogStore<OpRecord>({
  control: {
    recent: (limit) => control.opsRecent(limit),
    onUpdate: (cb) => control.onOpUpdate(cb),
    cancel: (id) => control.opsCancel(id),
  },
  // Resolved per call, as today (ops.ts:82): the connections store may not exist at module load.
  searchText: (r) => useConnectionsStore().connectionRecord(r.connectionId)?.name ?? '',
});
```

### 2.3 Shared panel (`packages/workbench/src/components/OpLogPanel.vue`)

`<script setup lang="ts" generic="R extends OpLogRecord">` (the `ModeSwitcher.vue` precedent).
Store-agnostic: props and emits only.

| Prop / emit / slot | Type | Notes |
|---|---|---|
| `records` | `readonly R[]` | the store's `visibleOps` |
| `runningCount` | `number` | |
| `v-model:filterText` | `string` | `ops-filter` input |
| `v-model:statusFilter` | `'all' \| 'running' \| 'error'` | export the union as `OpLogStatusFilter` |
| `columns` | `readonly OpLogColumn[]` | `{ id: string; label: string; width: string }`, in display order |
| `clearHint` | `string` | Clear button tooltip |
| `canCancel?` | `(r: R) => boolean` | default `() => true`; gates the inline stop button |
| `menuFor?` | `(r: R) => MenuItem[]` | default `[copyCommand, copyError, cancel]` from `opLogMenuItems` |
| `@clear` | | |
| `@cancel` | `(r: R)` | inline stop button and default menu's Cancel |
| `#cell` | `{ column, record }` | any column id not built in |
| `#detail` | `{ record, part: 'command' \| 'error' }` | optional; default is plain text |

- Built-in column ids: `time`, `kind`, `status`, `duration`, `command`. Markup copied from today's
  template lines 307, 317-331, 333-344. `command` shows the error with its tooltip when
  `status === 'error'`, else the command, as today.
- Grid template: `gridTemplateColumns` inline style, `columns.map((c) => c.width).join(' ')`, on
  the header and every op row. Replaces the arbitrary `grid-cols-[90px_…]` class. The P110 B36
  comment block (260-264) goes: the arbitrary value no longer exists.
- Header bar, empty state, virtual list (`useVirtualRows`, fixed 18px rows, `VIRTUAL_ROW_CLASS`),
  `role="listbox"`/`option`, Enter/Space expand (`onRowKeydown`), `expandedId`, detail rows and
  every `data-testid` (`ops-filter`, `virtual-list`, `op-row` with `data-status`, `op-time-cell`)
  are today's, unchanged. Right-click opens `useContextMenuStore().openContextMenu(event,
  menuFor(record))`.
- Default detail row: `<span class="font-data px-2 whitespace-nowrap overflow-x-auto">` holding
  `command: …` or `error: …`. The row keeps a fixed 18px height (P2 §0 note 14).
- Exported helper `opLogMenuItems(record, cancel)` returns `{ copyCommand, copyError, cancel }`
  `MenuItem`s, ids, labels, icons and `disabled` rules copied from today's 184-216. It lives in
  `packages/workbench/src/components/opLog.ts` next to the `OpLogColumn`/`OpLogStatusFilter` types.
  Keeping it out of the `.vue` file keeps it importable from `.ts`.
- Tailwind only, no `<style>` block: every rule that needed `:deep` belonged to Studio's Monaco
  detail.

Studio wrapper (`apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue`) keeps its
path and its only mount (`workbench/WorkbenchShell.vue:57`). It keeps every Studio seam:
- `columns`: `time 90px`, `connection 140px`, `tab 40px`, `kind 80px`, `status 90px`,
  `duration 70px`, `rows 60px`, `command 1fr`. Same order and widths as today.
- `#cell`: `connection` (colour chip via `connColorVar`, name, today's 308-315), `tab`
  (`tabTitleFor`, `data-testid="op-tab-cell"`), `rows`.
- `#detail`: a root `<div class="ops-detail-cm h-full min-w-0">` around today's `MonacoHost`
  (352-362 for command with the truncation prefix, 370-375 for error). The three `.ops-detail-cm
  :deep(...)` rules (406-423) stay in this file's scoped `<style>`. They still match: the slot root
  is rendered by this component, so it carries this component's scope id.
- `menuFor`: Reveal originating tab, Copy command, Copy error, Re-run, Cancel. Today's order,
  built from `opLogMenuItems` plus Studio's two items.
- `onRerun`, `revealTab`, `opSqlDialect`, `connectionFor`, `ensureConnectedOnce`,
  `consoleViewStore.run`, with their comments. Studio logic, unchanged.
- `clear-hint="Clears the in-memory ring only — op_log retention is automatic"`.
- `@cancel` goes to `opsStore.cancelOp(record.id)`.

### 2.4 Full-width dock (`packages/workbench/src/components/WorkbenchShell.vue`)

Target template (Part 1):

```vue
<div class="workbench-shell flex flex-1 flex-col min-h-0 gap-0.5 px-1.5 pb-0.5 bg-chrome"
     :class="{ 'cursor-row-resize select-none': dockDragging }">
  <ResizablePanelGroup direction="horizontal" class="flex-1 min-h-0 gap-0.5">
    <ResizablePanel project … />            <!-- no :style marginBottom -->
    <ResizableHandle … />
    <ResizablePanel main :order="2" data-testid="main-panel">  <!-- one branch: today's 213-223 -->
  </ResizablePanelGroup>
  <template v-if="hasDock && opsVisible">
    <DockResizeHandle :height="dockHeight" :min="OPS_MIN_PX" :max="OPS_MAX_PX"
                      @resize="onOpsResize" @dragging="dockDragging = $event" />
    <div class="shrink-0 overflow-hidden min-w-0 min-h-0 rounded-kira border border-border bg-bg"
         data-testid="operations-panel" :style="{ height: `${dockHeight}px` }">
      <slot name="dock" />
    </div>
  </template>
  <div class="shrink-0 h-statusbar" :class="{ 'mt-1': hasDock }" data-testid="status-bar">…</div>
</div>
```

- `OPS_MIN_PX = 100`, `OPS_MAX_PX = 500`: today's effective bounds (lines 110-111).
  `dockHeight = clamp(opsHeight ?? 200, min, max)`. 200 is `defaultLayout`'s value.
- Delete: `opsPanelRef`, `vGroupRef`, `useElementSize`, `lastEmittedOpsHeight`, the ops `watch`,
  `opsHeightPercent`, `opsMinPercent`/`opsMaxPercent`, `opsMarginPx`, the nested vertical group.
  Keep the project half of the ping-pong guard (92, 95-101): the project panel is still reka's.
- `resize-ops` keeps its px contract. `onOpsResize(px)` emits directly; there is no percent
  conversion.
- Spacing is unchanged. Shell `gap-0.5` puts 2px above and below the 2px handle, so main-to-dock is
  6px, as today (vertical group `gap-0.5` + `h-0.5` handle + `gap-0.5`). Dock-to-status is shell
  `gap-0.5` + `mt-1`, 6px, as today.
- Rewrite the file-level comment (2-41, 53-56) tersely. Keep: the reka nesting hazard, now as the
  reason the dock sits outside every SplitterGroup; the project panel's `sizeUnit="px"` note. Drop:
  the margin reproduction and the percent-bridge story.
- `hasDock` stays in Part 1 (Space passes no `#dock` yet). Part 2 deletes it (§2.6).

`packages/workbench/src/components/DockResizeHandle.vue`:
- Props `height`, `min`, `max`. Emits `resize: [px]` and `dragging: [boolean]`.
- VueUse `useDraggable(el, { axis: 'y', preventDefault: true, onStart, onMove, onEnd })`, used for
  its pointer wiring only, never its `x`/`y`/`style`. `onStart` records `startY = e.clientY` and
  `startHeight = props.height`. `onMove` emits `clamp(startHeight + (startY - e.clientY), min,
  max)`. `isDragging` drives `data-state="drag"` and the `dragging` emit.
- `role="separator"`, `aria-orientation="horizontal"`, `aria-valuenow/min/max`, `tabindex="0"`,
  `aria-label="Resize operations panel"`. ArrowUp/ArrowDown ±10px; Home to `min`, End to `max`
  (WAI-ARIA window-splitter keys, parity with reka's keyboard-resizable handle).
- Classes: `relative shrink-0 h-0.5 bg-transparent hover:bg-focus data-[state=drag]:bg-focus
  cursor-row-resize` (today's handle look, shadow-free) plus a hit area `before:absolute
  before:inset-x-0 before:-inset-y-1 pointer-coarse:before:-inset-y-2`. That matches today's
  `hit-area-margins` (fine 4, coarse 8).
- Why hand-built on `useDraggable`: shadcn/reka's handle needs a `SplitterGroup` context (§0.1).
  VueUse owns the event wiring, so no drag maths beyond one subtraction and a clamp.

### 2.5 Layout store hoist (`packages/workbench/src/state/createLayoutStore.ts`)

Add `toggleOperationsPanel()` and `setOperationsHeight(height)` to the core return (bodies from
Studio `state/layout.ts:8-16`). Studio's `extend` keeps only `setCellEditorHeight`. Space's
`() => ({})` is unchanged and now exposes both. Prune the header comment's "Kira Space never
exposed toggleOperationsPanel/setOperationsHeight" line, and the matching line in Space
`state/layout.ts:6-8`. Part 2 wires the UI; the store surface lands in Part 1 because the row
places the hoist in its step (1).

### 2.6 Kira Space op log (Part 2 boundaries; Part 2's own plan details these)

**Go ring (`apps/kira-space/internal/oplog`, new, stdlib-only leaf).**
- `Record` JSON: `id`, `startedAt` (`kiratime.NowISO`), `durationMs`, `kind`, `status`
  (`running|ok|error|cancelled`), `command`, `error`, `repoId`, `repoName`
  (`filepath.Base(Summary.Root)`), `source` (the Conn's `ClientLabel`), `cancellable`.
- `Log`: mutex, newest-first ring capped at 500, and a running-id to cancel-func map. `Start`
  returns an `*Op` with `AddCommand(argv)` and `Finish(status, errMsg)`. `Recent(limit)`,
  `Cancel(id) bool`. `emit` runs after unlock, with a copy. All calls to one op come from its own
  goroutine, so start-before-finish order holds without the lock.
- Nil-receiver-safe `*Log`/`*Op` methods, so `gitsession` needs no nil checks and tests pass nil.
- `command`: each write argv rendered `git <args>`, POSIX-quoted where an arg needs it, joined with
  ` && ` (matches the stop-at-first-failure semantics of `runWriteArgvList` and the pull/restack
  sequences). Capped at 16 KiB, rune-safe, with a `…` suffix. The ring is in memory and argv
  length is bounded only by ARG_MAX. Quoting is hand-rolled: about ten lines of display-only
  formatting, no parsing, below the library bar.

**Hooks (`internal/gitsession`).**
- `Registry.OpLog *oplog.Log` field, threaded into `newRepoEntry`. `main.go` sets it after the
  deferred emitter exists (`main.go:112`) and before `Run`. Entries are only built on the first
  `Acquire`, after `Run`.
- The op handle rides `ctx` under an unexported key. Four write-spawn sites call one helper
  `e.noteWrite(ctx, argv)`: `runWriteArgvList` (`ops.go:1117`), `runRemoteSpawn` (`remote.go:135`),
  pull's merge/rebase spawn (`remote.go:596`), restack's rebase spawn (`stack.go:633`). Why `ctx`
  and not a parameter: the handle is request-scoped and crosses about a dozen private signatures
  (`runFetch`, `runPushFamily`, `runPullOp`, `runRestackPlan`, …). A parameter would rewrite each
  for pass-through.
- Entry points use named returns plus a deferred finish. `RunOp` starts after the `opTable` lookup
  (an unknown kind is a client bug, not a user op). `UndoRun` gains a `connLabel string` parameter
  (callers: `gitrpc/ops.go:75`, `ops_test.go`, `stack_test.go`). `RunRemote` starts only when
  `conn != nil`. `RunRestack` always starts.
- Status mapping: Go error gives `error` with `err.Error()`. `Error.Kind == "Cancelled"`
  (`remote.go:426,473,535`, `stack.go:810,828,835`) gives `cancelled`. Other `!OK` gives `error`
  with `Error.Message`. Otherwise `ok`.
- Cancel funcs: `RunRemote` fetch/pull get `e.CancelRemote` (a no-op outside a killable phase,
  D19). Push family gets none (`cancellable: false`): never killable. `RunRestack` gets
  `e.CancelRestack`. `RunOp`/`UndoRun` get none (`context.WithoutCancel`, `gitrpc/ops.go:12-16`).
- One `gitsession/oplog_test.go` on the scripted-runner harness (`testentry_test.go`) pins the
  decision structure: `RunOp` success logs command and `ok`; a classified failure logs `error`;
  `RunRemote` with nil conn logs nothing; a cancelled fetch logs `cancelled`. No separate
  ring-buffer test (a cap check is below the bar). Run `go test -race` on both packages.

**Bridge and channels.**
- `apps/kira-space/internal/bridge/ops.go`: `OpsService.Recent({limit})` (a non-positive limit is
  `BadRequest`, as in Studio) and `Cancel({opId})`, bound in `main.go:235`'s list. Regenerate
  bindings.
- Hoist `ChannelOpUpdate` and `ChannelToggleOperationsPanel` into `internal/appevent`. Studio's
  `bridge/events.go:23,40` re-exports them (the P116 precedent at Space `events.go:65-74`). Space
  re-exports both.
- Space menu: `Toggle Operations Panel`, Cmd+J (`shell.Shortcuts["view.toggleOperationsPanel"]`),
  after `Toggle Project Panel`.
- `createCoreControl` gains `onToggleOperationsPanel`. Studio `bridge/index.ts:72` drops its own
  copy.

**Space frontend.**
- `state/opsDomain.ts`: `spaceOpRecordSchema = opLogRecordSchema.extend({ repoId, repoName,
  source, cancellable })`.
- `bridge/index.ts`: `opsRecent`, `opsCancel`, `onOpUpdate` (`CHANNEL.opUpdate`, already shared in
  `packages/shared/protocol/events.ts:34`).
- `state/ops.ts`: `createOpLogStore<SpaceOpRecord>` with `searchText: r => \`${r.repoName}
  ${r.source}\``. Hydrate joins `main.ts`'s optional `Promise.allSettled` group (lines 85-97): an
  op-log failure must not take the window down.
- `workbench/OperationsPanel.vue` wrapper. Columns: `time 90px`, `repo 140px` (name, root path in
  tooltip), `source 120px`, `kind 120px`, `status 90px`, `duration 70px`, `command 1fr`.
  `canCancel: r => r.cancellable`, default menu, default detail. Clear hint: "Clears this window's
  list only — the log resets when Kira Space quits".
- `workbench/WorkbenchShell.vue`: `#dock`, `:ops-visible`, `:ops-height`, `@resize-ops`.
  `TitleBar.vue`: Operations toggle between Repositories and Settings (Studio's markup,
  `data-testid="toggle-operations-panel"`). `App.vue`: `control.onToggleOperationsPanel(...)`.
  Prune both files' "no Operations panel" comments.
- Shared `WorkbenchShell.vue`: both apps now pass `#dock`. Delete `hasDock`, make
  `opsVisible`/`opsHeight` required, render the dock branch and `mt-1` unconditionally. Space's
  status bar gains Studio's 4px `mt-1`. No visual baseline covers the shell; both apps'
  `tests/visual` capture only dialogs (`rg toHaveScreenshot`).

**Part 2 tests.** New `apps/kira-space/tests/ui/operations.spec.ts` (mocked control): full-width
bounding box (as §4.1) with the git module's project panel visible; records render with repo and
source; filter matches repo name; cancel shown only for `cancellable`. `window-chrome.spec.ts`: DOM
order list (line 62-67) gains `toggle-operations-panel`, plus a `kira:menu:toggle-operations-panel`
test mirroring line 158. Mocks: `tests/ui/support/ipcChannels.ts`/`mockRuntime.ts` gain the three
channels with an empty `opsRecent` default.

---

## 3. Part 1 steps and commits

Record `P132P1_START=$(git rev-parse HEAD)` first. Commit each step as it lands (Conventional
Commits). Per commit: `bun run typecheck`, `bun run lint`, `bun run lint:dead`, `bun run test:unit`.
UI suites once at the end (§4.3).

1. `refactor(shared): generic op-log record base` — §2.1.
2. `refactor(workbench): op-log store factory` — §2.2 factory; Studio `state/ops.ts` onto it; move
   both unit specs (§4.2) in this same commit so the moved logic never goes untested.
3. `refactor(workbench): layout store owns the operations panel actions` — §2.5.
4. `refactor(workbench): shared operations panel` — `opLog.ts`, `OpLogPanel.vue`; Studio wrapper
   rewritten onto it (§2.3).
5. `fix(workbench): operations dock spans the full width` — `DockResizeHandle.vue`, shared
   `WorkbenchShell.vue` (§2.4).
6. `test(studio): operations dock geometry and resize` — §4.1.
7. `docs: ARCHITECTURE records the shared op log panel and dock topology (P132 Part 1)` — §5.
8. `docs(v2.0): P132 Part 1 result` — SPEC result section.

Fixes from §4.3's single UI run land as follow-up `fix:` commits, one finding per commit.

---

## 4. Tests (per `CLAUDE.md`'s bar)

### 4.1 `apps/kira-studio/tests/ui/operations.spec.ts` (two new tests)

- **Full width.** Open the dock (`toggle-operations-panel`), then take bounding boxes of
  `project-panel`, `main-panel` (new testid on main's `ResizablePanel`, §2.4; `main-view` is the
  inner, border-inset div), `operations-panel`. Assert, to ±0.5px:
  - dock left = project left (the row's acceptance);
  - dock right = main panel right;
  - project bottom = main panel bottom (shared row, no blank strip);
  - dock top − project bottom = 6.
  - `getComputedStyle(project).marginBottom === '0px'`.
- **Resize.** Drag the handle (`role=separator` in the shell) up 60px with `page.mouse`: dock height
  +60 (±1). Then focus it and press ArrowUp: +10. Drag well past the top: height 500 (clamp).

### 4.2 Moved unit specs

`packages/workbench/src/state/oplog-hydrate-race.spec.ts` and `oplog-markraw.spec.ts`. Same
assertions, now against `createOpLogStore` with a fake `OpLogControl` and a fresh
`createPinia()`/`setActivePinia`. The window stub and the `control` monkeypatching go away.
Delete the Studio originals in the same commit. `run-state.spec.ts` stays and must pass unchanged.

No test for `OpLogPanel.vue`/`DockResizeHandle.vue` beyond §4.1: rendering and one clamp are below
the bar.

### 4.3 Once, at the end

- `bun run test:ui:studio` in full. `tree.spec.ts`, `interaction.spec.ts`, `leaks.spec.ts` are
  the row's named gate for the layout change. Run the first two at least twice more on their own
  (`--repeat-each=3`): the old hazard was non-deterministic. Record pass counts in the result
  section.
- `bun run test:ui:space` in full: Space mounts the same shared shell without `#dock`.
- `bun run test:unit`, `bun run typecheck`, `bun run lint:all`.
- `bun run test:visual:studio`: expected unchanged (only dialogs are captured). Any diff is a
  finding, not a baseline update.

---

## 5. `docs/ARCHITECTURE.md`

- The workbench-shell/splitter passage: the dock is a full-width flex sibling below the horizontal
  group, outside every SplitterGroup, and why (§0.1). Replace any text on the margin reproduction.
- The Operations panel: shared `OpLogPanel.vue` plus `createOpLogStore` in `packages/workbench`,
  the `OpLogRecord` base, and Studio's seams (§2.3).
- No "Known open items" entry: nothing is left open.

---

## 6. Part 1 file inventory

New:
- `packages/workbench/src/components/{OpLogPanel.vue, DockResizeHandle.vue, opLog.ts}`
- `packages/workbench/src/state/{createOpLogStore.ts, oplog-hydrate-race.spec.ts,
  oplog-markraw.spec.ts}`

Edited:
- `packages/shared/domain/ops.ts`
- `packages/workbench/src/components/WorkbenchShell.vue`,
  `packages/workbench/src/state/createLayoutStore.ts`
- `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue`,
  `apps/kira-studio/frontend/src/state/{ops.ts, layout.ts}`
- `apps/kira-space/frontend/src/state/layout.ts` (comment only)
- `apps/kira-studio/tests/ui/operations.spec.ts`
- `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`

Deleted: `apps/kira-studio/tests/unit/{ops-hydrate-race.spec.ts, ops-markraw.spec.ts}`.

Unchanged by design: Studio `TitleBar.vue`, `App.vue`, `shortcuts/state.ts`, `bridge/index.ts`
(`layoutStore.toggleOperationsPanel` now comes from the core store; same name). Any Go file. No new
dependency (`@vueuse/core` 15.0.0 already ships `useDraggable` with `axis`).

---

## 7. Closing audit (Part 1)

| Check | Command | Pass |
|---|---|---|
| Margin hack gone | `rg -n 'opsMarginPx\|marginBottom' packages/workbench/src/components/WorkbenchShell.vue` | Empty |
| No nested splitter | `rg -c '<ResizablePanelGroup' packages/workbench/src/components/WorkbenchShell.vue` | 1 |
| Shared panel used | `rg -n 'OpLogPanel' apps packages --glob '*.vue'` | Studio `OperationsPanel.vue` renders it |
| Factory used | `rg -n 'createOpLogStore' apps packages` | Studio `state/ops.ts` calls it |
| VueUse drag used | `rg -n 'useDraggable' packages/workbench/src/components/DockResizeHandle.vue` | Present |
| Hoist real | `rg -n 'toggleOperationsPanel\|setOperationsHeight' apps/kira-studio/frontend/src/state/layout.ts` | Empty |
| No Studio import in shared | `rg -n "kira-studio\|MonacoHost\|connections'" packages/workbench/src/components/OpLogPanel.vue packages/workbench/src/state/createOpLogStore.ts` | Empty |
| Kind generalized | `rg -n 'OpKind\|opKindSchema' packages/workbench` | Empty |
| SFC form | `rg -L '<script setup lang="ts"' packages/workbench/src/components/{OpLogPanel,DockResizeHandle}.vue`; `rg -n '<style' …` | Both empty |
| Studio behaviour | Menu order, columns, testids vs. §2.3 | Identical to `$P132P1_START` |
| Unit specs moved | `ls apps/kira-studio/tests/unit/ops-*`; `ls packages/workbench/src/state/oplog-*` | None; two |
| No Space behaviour change | `git diff --stat $P132P1_START -- apps/kira-space` | `state/layout.ts` comment only |
| Gate | §4.3 pass counts in the result section | All green |

---

## 8. Overlap with parallel work (checked at `bcf7be70`)

**P129 Part 4** owns `apps/kira-space/frontend/src/ade/*`, `internal/ade/*`,
`internal/bridge/ade.go`, Space `frontend/src/bridge/index.ts`, generated Space bindings,
`tests/unit/ade-*`, `tests/ui/{ade-*.spec.ts, support/ipcChannels.ts, support/mockRuntime.ts}`,
`packages/theme/src/components/ui/switch/*` (its plan §5; `git status` shows only `ade` files
dirty).
- **Part 1: no overlap.** Its only Space file is a comment in `state/layout.ts`. P129 has not
  touched that file since `f6f95d9e`.
- **The row's P129 file list is stale.** `main.go`/`internal/bridge/events.go` were edited by P129
  Parts 1-2 (`7a7e0d3e`, `6f0b0787`), and `frontend/src/main.ts` by Part 3 (`c73f44b5`). All
  landed. Part 4's plan states `main.ts` unchanged and lists neither Go file. The overlap there
  was resolved by earlier parts landing. Parts 5-7 are unplanned and may touch them again.
- **Real overlap is Part 2's alone:** Space `bridge/index.ts`, generated bindings (a `-clean=true`
  regenerate captures whatever Go is in the tree), `tests/ui/support/{ipcChannels,mockRuntime}.ts`,
  `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`. Part 2's plan must re-check which P129 part is then
  in flight.
- `internal/ade/queue.go` needs no P132 edit: the hook sits in `gitsession` (§2.6).

**P133** (its plan §8, cross-checked) owns Studio `workbench/SettingsDialog.vue`,
`settings/ScriptsPane.vue`, `state/settings.ts`, `state/customScripts.ts`, `terminalModule.ts`,
`packages/workbench/src/terminal/*`, `SettingsShell.vue`, `createSettingsStore.ts`, `SwatchRadio.vue`
comments, Space `ConnectedEditorsPane.vue` comment. `SettingsShell.vue` and `WorkbenchShell.vue`
are different files in the same directory. `createSettingsStore.ts` is not `createLayoutStore.ts`.
No shared file with Part 1 except `docs/ARCHITECTURE.md` (different sections) and `SPEC.md`
(different rows and result sections).

**Shared working tree.** Every stream commits to one checkout. The implementer must:
- Stage by explicit path only. Before each commit, run `git status --short` and confirm only this
  step's files are staged. Commit with `git commit -- <paths>`, so another agent's staged file is
  never swept in.
- Before editing a file another stream might own, run `git status --short <file>`. If it is dirty
  and not yours, work on another step until it is clean.
- Never `--no-verify` past a hook failing on another stream's half-done file. Wait for that
  stream's commit, then retry. A ref-lock error on commit: re-add and retry against the new HEAD,
  no force, no history rewrite.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Top row's height change on dock drag feeds SlickGrid resize through the horizontal group's ResizeObserver | Horizontal px recompute depends on width only; §4.3's repeated gate runs are the check. On a hang, record the repro and stop; do not reintroduce a splitter group |
| `leaks.spec.ts` counts window listeners; `useDraggable` adds `pointermove`/`pointerup` on `window` while the handle is mounted | Mounted only while the dock is open. If the spec flags it, pass `draggingElement` as the shell root (still covers drag-outside-handle) |
| Pinia generic factory loses action typing (P103 Part 2 §5.3 `extend` lesson) | No `extend` here; `R` is inferred from `control`. `typecheck` after step 2 proves it |
| `:deep` Monaco rules stop matching once moved into a slot | Slot root carries the wrapper's scope id (§2.3). Verify one expanded command row's `.monaco-editor` computed height is 18px |
| Status-filter emit type narrowing (`v as …` cast today) | `OpLogStatusFilter` union typed on the `v-model` |
| Concurrent streams fail each other's pre-commit hook | §8 shared-tree rules |

---

## 10. Acceptance, mapped to the SPEC row

| Row requirement | Where |
|---|---|
| Layout choice made, evidence recorded | §0.1; result section adds §4.3 pass counts |
| (1) Panel shell + `create*Store` into `packages/workbench` | §2.2, §2.3 (Part 1) |
| Studio seams injected: re-run, reveal tab, connection colour, MonacoHost dialect, `ensureConnectedOnce` | §2.3 Studio wrapper |
| Record contract off `OpKind` | §0.2, §2.1 |
| Toggle/height hoisted into `createLayoutStore` | §2.5 |
| Studio behaves as before, bar the width fix | §7 "Studio behaviour" and "No Space behaviour change" |
| (2) Full-width fix | §2.4 |
| (3) Space op log: producer, `#dock`, toggle, Cmd+J, persisted-vs-in-memory decision | §0.3-§0.5, §2.6 (Part 2) |
| Bounding-box assertion in both apps | §4.1 (Studio, Part 1); §2.6 (Space, Part 2) |
| Both suites pass | §4.3 (Part 1); Part 2 repeats for both |
| Studio ops coverage moves with the code | §0.7, §4.2 |
