# P132 Part 2 — Kira Space op log: plan

Plan for `docs/v2.0/SPEC.md`'s **P132 Part 2** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `8477fee1` (P138 result landed; P129 Part 7, P135-P138 landed;
nothing in flight). Every line number below is at that commit. Part 1 plan
(`P132-part1-shared-panel-and-dock.md` §2.6) bounds this part; each claim there was re-read against
source, and §0 lists where this plan departs from it.

**Discovery method, disclosed.** First `codegraph_explore` call warned its index came from main
checkout (other branch). `scripts/codegraph-setup.sh` then built a worktree-local index. Eight
`codegraph_explore` calls ran against it before any `Read`/`grep` of files they covered:
gitsession write entry points and spawn sites (`RunOp`, `UndoRun`, `RunRemote`, `RunRestack`,
`runWriteArgvList`, `runRemoteSpawn`, `runPullOp`, `runRestackSpawn`); `opSlot` cancel family;
`RunRemote`/`RunOp` callers (`gitrpc`, `ade/queue.go`, `autofetch.go`); Studio `internal/oplog` and
`bridge/ops.go`; `appevent`/Space `bridge/events.go`; `createOpLogStore`/`OpLogPanel`/
`WorkbenchShell`; `createCoreControl`; Space `main.go` `wireGit`. `Read`/`grep`/`sed` then pinned
line numbers, test files and `package.json` scripts.

---

## 0. Open points and resolutions

| Open point | Resolution | Where |
|---|---|---|
| `RunRestack` in or out | Task prompt read "excluding auto-fetch/RunRestack"; SPEC row and Part 1 §0.4 both include `RunRestack` as a user-initiated write. **Included.** The SPEC row is the ask; the prompt phrase most plausibly meant the nil-conn auto-fetch exclusion. Flagged to the user; dropping it later is deleting one `startOp` call plus its test row. | §3.3 |
| Reuse Studio's Go op log? | **No reuse possible; no lift.** Studio's `apps/kira-studio/internal/oplog/wire.go` (294 lines) is a SQLite-backed consumer of adapterhost `op:start`/`op:end` events (`repos.OpsRepo` Append/Finish/Recent/Prune/ReconcileInterrupted). It has no in-memory ring; Studio's 500 cap lives in the renderer. Space reuses the repo-root leaves instead: `internal/notify.Emitter[T]`, `internal/kiratime`, `internal/ipcerr`, `internal/appevent`. New ring is app-local `apps/kira-space/internal/oplog`: Studio has no use for it, so a repo-root package earns nothing. | §3.1 |
| Where `Registry.OpLog` gets set | Part 1 §2.6 said `main.go` after the emitter (`:112`). **Wrong:** `wireGit` (`main.go:518-558`) calls `gitSock.Start()` at `:556`, before `main.go:112` creates the emitter, so a paired VS Code client can run a write first. Set `Registry.OpLog` inside `wireGit` before `gitSock.Start()`. `oplog.New()` needs no emitter; `Events.AttachOpLog` subscribes later. | §3.4 |
| Multi-window scoping | **One process-global ring, broadcast to every window** (`appevent.Emitter.Emit`). A `RepoEntry` is shared across windows, so one window's write changes every window's repo. Clear is per-window, renderer-only. Each window hydrates `Recent(200)` at boot. | §3.5 |
| Source label | `source` = `Conn.ClientLabel`. Native graph conn label is `"This window"` (`bridge/gitstream.go:25`): relative, so false in every other window. **Rename to `"Kira Space"`.** Same rename fixes a pre-existing oddity: `gitpreflight/undo.go:37` shows "(window: This window)" in another window's undo tooltip. Flagged to the user. | §3.5 |
| Record identity field | Part 1 said `repoId`. Space has no repo id outside `gitrpc` routing. **Use `repoRoot` (`Summary.Root`, tooltip) plus `repoName` (`filepath.Base(Root)`, column).** | §3.1 |
| Which actions produce ops | Every write entry with a non-nil conn: native git module (per window), paired VS Code clients, `ade` (Refresh fetch `queue.go:1446`, ForcePush `:1606`, Archive worktreeRemove `:1795`). Excluded: auto-fetch (nil conn, `autofetch.go:163`), `RunPrepare` (Part 1 §0.4: read-only preflight), every read. | §3.3 |
| `ade/queue.go` edit | **None.** Hooks sit in `gitsession`; `ade` already passes its own non-nil `q.conn`/`adeConnLabel` (`"Kira Space ade"`). Matches the SPEC row. | §3.3 |
| Cancel race | `Log.Cancel` calls the registered cancel func under `log.mu`. Each op unregisters (`Finish`/`ClearCancel`) before its `opSlot.release()`. So a cancel never hits a later op's slot. Lock order `log.mu` then `slot.mu`; cancel funcs never call back into `Log`. | §3.2 |
| Shared-code touch-ups | Two small fixes in `packages/workbench`, both needed by Space: (1) `createOpLogStore.hydrateOps` never flips `hydrated` if `recent` rejects, so the buffer grows forever and live updates never apply. Space hydrates in `Promise.allSettled`, so a rejection leaves a live window silently dead. (2) `opLogMenuItems` enables Cancel for any running row, while `OpLogPanel`'s inline stop button honours `canCancel`. Space's push family is never cancellable, so the menu would offer a no-op. | §3.7 |
| Dock in `ade` (full-layout) mode | **Shown**, governed only by `panel.operations.visible`. `ade` produces ops (fetch, force-push, archive); hiding the dock there would hide their log. Project panel hides in full mode; dock stays full-width regardless. | §3.8 |
| Split | **No.** Go producer, generated bindings, frontend and tests form one order-dependent chain (bindings come from Go; the store uses bindings). One sequential implementer. | §4 |
| Library rule | No new dependency (`package.json`, `go.mod`). Pinia via `createOpLogStore`, not TanStack Query: the store needs subscribe-before-snapshot buffering, live per-record patching and per-window clear, none of which a query cache models. Wrapper is `<script setup lang="ts">`, Tailwind only, no `<style>`. Command quoting hand-rolled: `go.mod` carries no shell-quoting library, and display-only quoting is one idiom already used three times in-repo (`ade/command.go:25`, `gitaskpass/broker.go:128`, `agenthooks/config.go:68`). | §3.1, §3.6 |

## 1. Confirmed current state

### Go

- `apps/kira-space/internal/oplog`: does not exist. `internal/bridge/ops.go`: does not exist.
- `internal/gitsession/ops.go`:
  - `RunOp(ctx, conn ConnID, connLabel string, op OpRequest)` at `:1157`: `opTable` lookup
    (`:192`), `ErrUnservedOpKind`, `Prepare`, `earlyError` path returning `OK: false`,
    `defer invalidateAfterWrite`, `runWriteArgvList`, `Reclassify`, `OpResult{OK, Error *OpError,
    Undo, Head, InProgress}`.
  - `UndoRun(ctx, id string)` at `:1266`: `undo.Take`, `undoRunFailure` NotFound, replays each argv
    through `runWriteArgv`. No conn label.
  - `runWriteArgv` (`:1104`) delegates to `runWriteArgvList` (`:1117`). Spawn site 1:
    `gitclient.Run` at `:1121` (`ReadOnly: false`, `Setsid: true`).
- `internal/gitsession/remote.go`:
  - `CancelRemote()` at `:23` returns `e.remoteOp.tryCancel()`.
  - `withAskpass` at `:116`: env carries the askpass token. Command capture reads argv only.
  - Spawn site 2: `runRemoteSpawn` at `:135-138` (fetch, push family, pull's fetch).
  - `RunRemote(ctx, conn *Conn, params, deps)` at `:280`: `opCtx, cancel`; `remoteOp.claim(kind,
    cancel, false)` failure returns `OperationInProgress` without spawn; `defer release; cancel`.
    Switch at `:369`: fetch `setKillable(true)` at `:371` then `runFetch`; push family
    `runPushFamily` (never killable); pull `runPullOp`.
  - `runPullOp` at `:501`: `setKillable(true)` `:502`, fetch spawn, `setKillable(false)` `:543`,
    integrate spawn (site 3) `gitclient.Run` at `:596-597`.
  - Cancelled fetch/pull returns `RemoteOpError{Kind: "Cancelled"}`.
- `internal/gitsession/stack.go`:
  - `CancelRestack()` at `:526`. Spawn site 4: `runRestackSpawn` at `:630`, `gitclient.Run` at
    `:633-634`.
  - `RunRestack(ctx, conn *Conn, branch)` at `:677`: `restack.claim("restack", cancel, true)`
    (killable from claim), `restackPrepare`, `runRestackPlan(opCtx, ctx, …)` (`:805`) whose config
    writes and `restoreHead` go through `runWriteArgv(ctx, …)`; cancelled results use
    `OpError{Kind: "Cancelled"}`.
- `internal/gitsession/opslot.go`: `claim`/`setKillable`/`release`/`tryCancel`/`forceCancel`, all
  under `s.mu`. `tryCancel` never touches anything outside the slot.
- `internal/gitsession/entry.go`: `RepoEntry` struct `:54-161`; `newRepoEntry(...)` at `:169`, one
  caller (`registry.go:166`).
- `internal/gitsession/registry.go`: `Registry` fields `:37-88`, `NewRegistry` `:92`, `acquire`
  `:136`.
- `internal/gitsession/conn.go:3-6`: package comment lists allowed imports (gitclient,
  gitpreflight, gitreview, stdlib). `entry.go` already also imports `ghclient`, `storage/model`;
  the comment is stale. `Conn{ID, ClientID, ClientLabel, …}`, `NewConn` at `:100`.
- Callers: `gitrpc/ops.go:27` (`RunOp`, passes `c.ClientLabel`), `gitrpc/ops.go:75` (`UndoRun`,
  inside `handleUndoRun` which has `c`), `gitrpc/remote.go:116`/`:134` (`RunRemote`/
  `CancelRemote`), `gitrpc/stack.go:70`/`:91` (`RunRestack`/`CancelRestack`),
  `gitsession/autofetch.go:163` (nil conn), `ade/queue.go:1446,1606,1795`. Tests call `UndoRun` at
  5 sites (`ops_test.go`, `stack_test.go`).
- `internal/bridge/gitstream.go:24-25`: `nativeClientID = "kira-native"`,
  `nativeLabel = "This window"`; `NewConn` at `:209`.
- `internal/bridge/events.go`: re-exports `appevent` channels; `AttachMetrics(m) func()` is the
  precedent for `AttachOpLog`.
- `internal/appevent/appevent.go`: holds hoisted channel constants (`ChannelToggleProjectPanel`,
  …). Studio `internal/bridge/events.go:23` (`ChannelToggleOperationsPanel`) and `:40`
  (`ChannelOpUpdate`) still define their own.
- `internal/appshell/menu.go:32`: view items hold only `Toggle Project Panel`.
  `internal/shell/accel.go:43`: `"view.toggleOperationsPanel": {Key: "J", CmdOrCtrl: true}`
  already exists (shared with Studio).
- `main.go`: `wireGit` `:518-558` (`gitsession.NewRegistry` then settings closures then
  `gitSock.Start()` `:556`); emitter `:112`; `bridge.NewEvents` `:114`; `AttachMetrics` `:175`;
  teardown `sync.OnceFunc` calls `detachMetrics()` before `gitSock.Close()`; Services `:237-252`;
  menu `:310`.
- `internal/layering_test.go` forbids domain packages importing `bridge` only.

### Frontend

- `packages/shared/domain/ops.ts`: `opStatusSchema` `:32` (`running|ok|error|cancelled`),
  `opLogRecordSchema` `:39`, Studio `OpRecord` extends it.
- `packages/shared/protocol/events.ts`: `toggleOperationsPanel` `:15`, `opUpdate` `:34`.
- `packages/workbench/src/state/createOpLogStore.ts`: `OpLogControl<R>{recent, onUpdate,
  cancel}`, `createOpLogStore<R>({control, searchText})`, `MAX_RECORDS=500`, `HYDRATE_LIMIT=200`;
  `hydrateOps` `:56-90` (the rejection gap: `:86` await throws, `hydrated` stays false).
  Tests: `oplog-hydrate-race.spec.ts`, `oplog-markraw.spec.ts`.
- `packages/workbench/src/components/opLog.ts:24`: `opLogMenuItems(record, cancel)`; Cancel
  disabled only on `status !== 'running'` (`:47`).
- `packages/workbench/src/components/OpLogPanel.vue`: props `records`, `runningCount`,
  `filterText`, `statusFilter`, `columns`, `clearHint`, `canCancel?`, `menuFor?`;
  `canCancelRecord`/`menuForRecord` `:48-55`; inline stop button honours `canCancel`.
- `packages/workbench/src/components/WorkbenchShell.vue`: `opsVisible?`/`opsHeight?` `:40-41`;
  `hasDock` `:54-59`; dock `v-if="hasDock && opsVisible"` `:153`; status bar
  `:class="{ 'mt-1': hasDock }"` `:175`; `hasDock`/Space comments `:42-45`, `:55-58`, `:170-174`.
- `packages/workbench/src/bridge/createCoreControl.ts`: `onToggleProjectPanel` interface `:167`,
  implementation `:250`. No `onToggleOperationsPanel`.
- `packages/workbench/src/state/createLayoutStore.ts:120-127`: `toggleOperationsPanel`/
  `setOperationsHeight` (Part 1).
- Studio: `frontend/src/bridge/index.ts:72` own `onToggleOperationsPanel`; `:288-291` ops methods;
  `App.vue:86` subscribes; `workbench/TitleBar.vue:64-73` toggle (`layout-panel`/
  `layout-panel-off`, label "Operations", `data-testid="toggle-operations-panel"`);
  `workbench/panels/OperationsPanel.vue` usage shape; `tests/ui/operations.spec.ts:128-162`
  full-width bounding-box test.
- Space:
  - `frontend/src/workbench/WorkbenchShell.vue` (81 lines): no `#dock`; stale comments `:14-17`
    ("no Operations panel") and `:26-28` (claims Go menu emits no accelerator channels; false
    since P116); `isFull` `:40`.
  - `workbench/TitleBar.vue`: comment `:14` ("no Operations panel toggle"); Repositories toggle
    `:50-59`, Settings `:60-68`.
  - `state/layout.ts:4-8,14-15`: comments say no ops view.
  - `App.vue:46-54`: menu subscriptions; comment `:34-37`.
  - `main.ts:85-93`: optional `Promise.allSettled` group (`gitClients`, `terminals`,
    `keepAwake`, `agentSessions`).
  - `bridge/index.ts` (312 lines): `spaceControl` merged over `createCoreControl(...)` at
    `:298-312`; imports `@bindings/*service.js`.
  - Bindings: `frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/`
    (15 services, `models.ts`, `index.ts`).
  - No `state/ops.ts`, no `OperationsPanel.vue`, no `tests/ui/operations.spec.ts`.
  - `tests/ui/window-chrome.spec.ts:59-71` asserts title-bar DOM order
    `['toggle-project-panel','open-settings','toggle-keep-awake','new-window']`; `:158-168`
    tests `kira:menu:toggle-project-panel`.
  - `tests/ui/support/ipcChannels.ts` (`IPC`), `mockRuntime.ts` `FQN_SUFFIX_BY_IPC_KEY` and
    `WILDCARD_DEFAULTS` `:139-181`.
- `docs/ARCHITECTURE.md:1276` (dock topology), `:1278` ("Kira Space's own producer is P132 Part
  2, out of this phase's scope"; "Kira Space's own dock … Part 2").

### P129 overlap check

SPEC row names Space `bridge/index.ts`, generated bindings and `tests/ui/support/{ipcChannels,
mockRuntime}.ts` as P129 overlap. `git log` on those paths: P129 Part 5/6 (`7067e505`,
`5f74dd8e`, `3a630ed5`, `99903f98`), P129 Part 7 (`02ac84a8`, `d7c32587`), P135 (`a2b2543f`),
P136 (`eddc5e7d`). `main.go`, `bridge/events.go`, `main.ts`, `App.vue`, `TitleBar.vue` last
touched by `02ac84a8` and `bcf7be70`. All landed on the chapter branch. Other worktrees
(`p129-part7-impl`, `p132-part1-impl`, …) are landed history. **Nothing in flight; no conflict.**

## 2. Split

One implementer. Order dependency: `oplog` → gitsession hooks → `OpsService` → bindings regen →
frontend store/bridge → wrapper/shell → tests. No independent stream exists.

## 3. Design

### 3.1 `apps/kira-space/internal/oplog`

Imports: stdlib, `internal/notify`, `internal/kiratime` (both stdlib-only repo-root leaves). No
app package. `log.go` only.

```go
package oplog

const Capacity = 500
const maxCommandBytes = 16 << 10

type Record struct {
	ID          string  `json:"id"`
	StartedAt   string  `json:"startedAt"`   // kiratime.NowISO()
	DurationMs  *int    `json:"durationMs"`  // nil while running
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`      // running|ok|error|cancelled
	Command     *string `json:"command"`
	Error       *string `json:"error"`
	RepoRoot    string  `json:"repoRoot"`
	RepoName    string  `json:"repoName"`
	Source      string  `json:"source"`
	Cancellable bool    `json:"cancellable"`
}

type Meta struct{ Kind, RepoRoot, RepoName, Source string }

func New() *Log
func (l *Log) OnUpdate(fn func(Record)) func()   // notify.Emitter; unsubscribe
func (l *Log) Start(m Meta) *Op                   // nil *Log returns nil *Op
func (l *Log) Recent(limit int) []Record          // newest first, copies
func (l *Log) Cancel(id string) bool              // false if unknown or not cancellable

func (o *Op) AddCommand(argv []string)            // nil-safe; emits
func (o *Op) SetCancel(fn func() bool)            // nil-safe; cancellable=true; emits
func (o *Op) ClearCancel()                        // nil-safe; cancellable=false; emits if changed
func (o *Op) Finish(status, errMsg string)        // nil-safe; idempotent; emits
```

- **Storage:** slice, newest first; `Start` prepends and trims past `Capacity`. Lookups by id
  scan linearly (500 max, human-rate ops). `Op` holds a pointer to its own record copy, so an
  evicted op still updates and emits its own final record (renderer store caps independently).
- **Cancel map:** `map[string]func() bool`, separate from the ring. `Cancel` looks up and calls
  the func **while holding `l.mu`**. `ClearCancel`/`Finish` delete the entry under `l.mu`. An
  op's caller runs `ClearCancel` before `opSlot.release()` (§3.3), so once `Cancel` has the lock
  and finds the entry, the slot still belongs to that op.
- **Emit:** every mutation copies the record under lock, then `notify.Emitter.Emit` after unlock
  (Emitter already snapshots subscribers).
- **IDs:** `crypto/rand.Text()` (Go 1.27.1; no uuid dependency needed in this package).
- **Command:** `AddCommand` renders `git` + each arg, quoting only args containing a byte outside
  `[A-Za-z0-9_@%+=:,./-]` with the POSIX idiom `'` + `strings.ReplaceAll(s, "'", `'\''`)` + `'`.
  Multiple calls join with ` && `. Cap at `maxCommandBytes`: cut back to a rune boundary
  (`utf8.RuneStart`), append `…`. Display-only; never executed. Declined library: `go.mod` has no
  shell-quoting package, and a new dependency for one display line fails CLAUDE.md's
  "non-trivial infrastructure" bar.
- **Durations:** `time.Since(start).Milliseconds()` on `Finish`, monotonic clock.

### 3.2 `gitsession/oplog.go` (new)

```go
type opCtxKey struct{}

func withOp(ctx context.Context, op *oplog.Op) context.Context
func opFrom(ctx context.Context) *oplog.Op                  // nil when absent
func (e *RepoEntry) startOp(kind, source string) *oplog.Op  // e.opLog.Start(Meta{…Root, Base(Root)…})
func (e *RepoEntry) noteWrite(ctx context.Context, argv []string) { opFrom(ctx).AddCommand(argv) }
func finishOp(op *oplog.Op, ok bool, errKind, errMsg string, err error)
```

`finishOp` mapping, first match wins:

1. `err` is `gitclient.ErrCancelled` or `context.Canceled` (`errors.Is`): `cancelled`.
2. `err != nil`: `error`, message `err.Error()`.
3. `errKind == "Cancelled"`: `cancelled`.
4. `!ok`: `error`, message `errMsg`.
5. Otherwise `ok`.

Each entry point wraps it for its own result type (`OpResult`/`RemoteOpResult`/`RestackResult`
carry `Error *OpError` or `*RemoteOpError`; both have `Kind`, `Message`).

Wiring:

- `RepoEntry.opLog *oplog.Log` (unexported), new last parameter of `newRepoEntry`; `Registry.OpLog
  *oplog.Log` (exported, nil default = logging off) passed at `registry.go:166`.
- Test helper `testentry_test.go` `testEntryOpts` gains `opLog *oplog.Log`.
- Update `conn.go:3-6` package comment: allowed imports now list `oplog` (and the already-present
  `ghclient`, `storage/model`), so the comment stops lying.

### 3.3 Entry-point hooks

All four switch to named returns and `defer` the finish. Attach the handle to `ctx` **before**
`opCtx` derives, so read ctx (`roCtx`) and spawn ctx (`opCtx`) both carry it.

- **`RunOp`** (`ops.go:1157`): start after the `opTable` lookup succeeds (an unserved kind is an
  RPC error, not an op). `op := e.startOp(req.Kind, connLabel)`; `ctx = withOp(ctx, op)`;
  `defer finishOp(op, res.OK, res.Error…, err)`. `earlyError` results log as `error` with no
  command, which is correct (nothing spawned).
- **`UndoRun`** (`ops.go:1266`): gains `connLabel string` (second parameter). Kind `"undo"`.
  Update `gitrpc/ops.go:75` to pass `c.ClientLabel`, and the 5 test call sites.
- **`RunRemote`** (`remote.go:280`): `op := (*oplog.Op)(nil); if conn != nil { op =
  e.startOp(params.Kind, conn.ClientLabel) }`, before `claim`. A refused claim
  (`OperationInProgress`) therefore logs as `error`, so a user sees why nothing ran. After a
  successful claim the existing defer becomes:
  ```go
  defer func() { op.ClearCancel(); e.remoteOp.release(); cancel() }()
  ```
  `op.SetCancel(e.CancelRemote)` sits next to `setKillable(true)` at `:371` (fetch) and `:502`
  (pull). `opFrom(roCtx).ClearCancel()` sits next to `setKillable(false)` at `:543`. Push family
  never registers a cancel.
- **`RunRestack`** (`stack.go:677`): `op := e.startOp("restack", conn.ClientLabel)` before
  `claim`; after claim, `op.SetCancel(e.CancelRestack)`; defer becomes `op.ClearCancel();
  e.restack.release(); cancel()`. Named-return finish deferred first so it runs last.
- **Four spawn sites** get `e.noteWrite(ctx, argv)` immediately before `gitclient.Run`:
  `ops.go:1121`, `remote.go:136` (inside `runRemoteSpawn`), `remote.go:596`, `stack.go:633`.
  Reads through `gitclient.Runner` elsewhere are never recorded.
- **Kinds:** `RunOp` `op.Kind` (22 `opTable` kinds), `UndoRun` `"undo"`, `RunRemote`
  `params.Kind` (`fetch|push|forcePush|deleteRemoteBranch|pull`), `RunRestack` `"restack"`.
- **Excluded:** nil-conn `RunRemote` (auto-fetch), `RunPrepare`, reads. `ade/queue.go`
  unchanged.

### 3.4 Bridge, events, menu (Go)

- `internal/appevent/appevent.go`: add `ChannelToggleOperationsPanel =
  "kira:menu:toggle-operations-panel"` and `ChannelOpUpdate = "kira:op:update"`. Studio
  `bridge/events.go:23,40` become re-exports (`= appevent.X`), same as the existing hoisted ones.
  Space `bridge/events.go` re-exports both.
- `Space bridge/events.go`: `func (e *Events) AttachOpLog(l *oplog.Log) func()` subscribes
  `l.OnUpdate` and calls `e.emit.Emit(ChannelOpUpdate, record)` (every window).
- `Space bridge/ops.go` (new): `OpsService{Log *oplog.Log}`; `Recent(OpsRecentArgs{Limit int
  json:"limit"}) ([]oplog.Record, error)`, `ipcerr.BadRequest` on `limit <= 0`;
  `Cancel(OpsCancelArgs{OpID string json:"opId"}) error`, `BadRequest` on empty id; a
  `Log.Cancel` false (finished or not cancellable) is not an error, same as Studio's
  `bridge/ops.go:45-51` discarding its own bool. Arg and return shapes match Studio, so
  `OpLogControl.cancel: Promise<void>` fits unchanged.
- `main.go`:
  - `wireGit`: `opLog := oplog.New()`; `gitRegistry.OpLog = opLog` before `gitSock.Start()`
    (`:556`); return `opLog` alongside existing results.
  - After `events` (`:114`): `detachOpLog := events.AttachOpLog(git.opLog)`; teardown calls it
    next to `detachMetrics()`.
  - Services list (`:237-252`): `application.NewService(&bridge.OpsService{Log: git.opLog})`.
- `internal/appshell/menu.go`: `Toggle Operations Panel` after `Toggle Project Panel` (`:32`),
  accelerator key `view.toggleOperationsPanel` (already in `shell/accel.go:43`), emits
  `ChannelToggleOperationsPanel` through `events.Signal`.
- `bridge/gitstream.go:25`: `nativeLabel = "Kira Space"`. `conn_test.go:336,404` use their own
  literal; no change needed there.
- Regenerate bindings: `wails3 task common:generate:bindings` in `apps/kira-space` (the task's
  `-names` flag is load-bearing; never hand-edit). Adds `opsservice.ts` plus `oplog` models.

### 3.5 Multi-window behaviour

- One `oplog.Log` per process, one `OpsService`, one `AttachOpLog` subscription. `Emit` reaches
  every window.
- `source` distinguishes origin: `"Kira Space"` (native git module, any window), `"Kira Space
  ade"` (ade queue), a VS Code client's own `ClientLabel`. No window id on native conns:
  `appshell/stream.go`'s `RegisterGitStream` carries no window identity, and a shared repo makes
  the op every window's concern anyway.
- Clear: renderer-only (`clearOps`), per window. Hint text: "Clears this window's list only — the
  log resets when Kira Space quits".
- New window: hydrates `Recent(200)`; running ops appear with a live cancel button if
  cancellable.

### 3.6 Space frontend

- `state/opsDomain.ts` (new): `spaceOpRecordSchema = opLogRecordSchema.extend({ repoRoot:
  z.string(), repoName: z.string(), source: z.string(), cancellable: z.boolean() })`;
  `SpaceOpRecord` type. Follows the `*Domain.ts` pattern (`modeDomain.ts`, `tabDomain.ts`).
- `bridge/index.ts` `spaceControl`: `opsRecent(limit)`, `opsCancel(opId)`, `onOpUpdate(cb)`, each
  parsing through `spaceOpRecordSchema` like sibling methods.
- `state/ops.ts` (new): `export const useOpsStore = createOpLogStore<SpaceOpRecord>({ control: {
  recent: control.opsRecent, onUpdate: control.onOpUpdate, cancel: control.opsCancel },
  searchText: (r) => \`${r.repoName} ${r.source}\` })`.
- `main.ts:85-93`: `opsStore.hydrateOps()` joins the optional `Promise.allSettled` group.
- `workbench/OperationsPanel.vue` (new, `<script setup lang="ts">`, no `<style>`): renders
  `OpLogPanel` with `v-model:filter-text`, `v-model:status-filter`, `:records="opsStore.visibleOps"`,
  `:running-count`, `:columns`, `clear-hint`, `:can-cancel="(r) => r.cancellable"`,
  `@clear="opsStore.clearOps"`, `@cancel="(r) => opsStore.cancelOp(r.id)"`. Default menu (no
  `menu-for`). `#cell` slot for `repo` (name, `title` = `repoRoot`) and `source`. Filter/status
  refs are local `ref`s, as in Studio's wrapper.
- Columns: time 90px, repo 140px, source 120px, kind 120px, status 90px, duration 70px, command
  1fr.
- `workbench/WorkbenchShell.vue`: pass `:ops-visible="layoutStore.panel.operations.visible"`,
  `:ops-height="layoutStore.panel.operations.height"`, `@resize-ops="layoutStore.setOperationsHeight"`,
  `<template #dock><OperationsPanel /></template>`. Prune stale comments `:14-17`, `:26-28`.
  **No keydown for J**: Cmd+J reaches the renderer only through the Go menu channel (Part 1 §0.5).
- `workbench/TitleBar.vue`: `TooltipIconButton` between Repositories and Settings, copied from
  Studio `TitleBar.vue:64-73` (icon `layout-panel`/`layout-panel-off`, label "Operations",
  `:aria-pressed`, `data-testid="toggle-operations-panel"`,
  `@click="layoutStore.toggleOperationsPanel"`). Prune comment `:14`.
- `App.vue`: `control.onToggleOperationsPanel(layoutStore.toggleOperationsPanel)` in the
  subscription array; prune comment `:34-37`.
- `state/layout.ts`: prune comments `:4-8,14-15`.

### 3.7 Shared code

- `createCoreControl.ts`: `onToggleOperationsPanel(cb)` in interface (next to `:167`) and
  implementation (next to `:250`, `on(CHANNEL.toggleOperationsPanel, cb)`). Studio
  `bridge/index.ts:72` drops its own copy; `App.vue:86` call site unchanged.
- `createOpLogStore.hydrateOps`: wrap the `recent` await; on rejection apply buffered updates to
  `[]`, set `state.records`, flip `hydrated = true`, rethrow. Live updates then keep flowing and
  the caller still sees the failure. One assertion in `oplog-hydrate-race.spec.ts` (rejecting
  `recent`, buffered update visible, later update applies): this is ordering/race logic,
  already covered by that spec, so it meets the unit-test bar.
- `opLog.ts`: `opLogMenuItems(record, cancel, canCancel = true)`; Cancel `disabled: record.status
  !== 'running' || !canCancel`. `OpLogPanel.vue`'s default `menuForRecord` passes
  `canCancelRecord(record)`. Studio unchanged: its wrapper passes its own `menu-for`
  (`OperationsPanel.vue:114,150`) calling `opLogMenuItems` with two arguments, so the default
  `true` applies.
- `WorkbenchShell.vue` (shared): delete `useSlots`/`hasDock`; `opsVisible`/`opsHeight` become
  required props; dock `v-if="opsVisible"`; status bar `class="mt-1"` unconditional. Rewrite the
  three comments. Both apps now always pass `#dock`.

### 3.8 Behaviour notes

- Full-layout mode (`ade`): dock visible when toggled; `isFull` does not gate it.
- Space status bar moves down 4px (unconditional `mt-1`), matching Studio. No Space visual
  baseline covers the shell (`tests/visual` captures dialogs only), so no baseline update.

## 4. File ownership (one implementer)

| Area | Files |
|---|---|
| Go ring | `apps/kira-space/internal/oplog/log.go`, `log_test.go` (new) |
| gitsession | `internal/gitsession/{oplog.go (new), oplog_test.go (new), ops.go, remote.go, stack.go, entry.go, registry.go, conn.go, testentry_test.go, ops_test.go, stack_test.go}` |
| gitrpc | `internal/gitrpc/ops.go` |
| Events | `internal/appevent/appevent.go`, `apps/kira-studio/internal/bridge/events.go`, `apps/kira-space/internal/bridge/events.go` |
| Space bridge/menu/main | `internal/bridge/{ops.go (new), gitstream.go}`, `internal/appshell/menu.go`, `main.go` |
| Bindings | `apps/kira-space/frontend/bindings/**` (generated) |
| Shared frontend | `packages/workbench/src/{bridge/createCoreControl.ts, state/createOpLogStore.ts, state/oplog-hydrate-race.spec.ts, components/opLog.ts, components/OpLogPanel.vue, components/WorkbenchShell.vue}` |
| Studio frontend | `apps/kira-studio/frontend/src/bridge/index.ts` |
| Space frontend | `frontend/src/{state/opsDomain.ts (new), state/ops.ts (new), state/layout.ts, bridge/index.ts, main.ts, App.vue, workbench/OperationsPanel.vue (new), workbench/WorkbenchShell.vue, workbench/TitleBar.vue}` |
| Space tests | `tests/ui/{operations.spec.ts (new), window-chrome.spec.ts, support/ipcChannels.ts, support/mockRuntime.ts}` |
| Docs | `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md` (result section) |

## 5. `docs/ARCHITECTURE.md`

- `:1278`: replace both "Part 2" deferrals with the landed state (Space mounts the dock; shell has
  no `hasDock`).
- New paragraph beside it, Space op log: in-memory `internal/oplog` ring (500, process-global,
  lost on quit); producer is `gitsession` write entry points with a non-nil conn; auto-fetch,
  `RunPrepare` and reads excluded; command from argv only (askpass env never recorded); cancel for
  fetch, pull's fetch stage and restack; broadcast to every window, clear per window; `source` =
  `Conn.ClientLabel`, native label `"Kira Space"`.
- No Known open item added.

## 6. Tests

Unit-test bar (CLAUDE.md): only concurrency, eviction and cancellation earn a Go test. Quoting,
`Recent` limit validation, `OpsService` arg guards, menu item: no test.

### 6.1 Go

- `internal/oplog/log_test.go`:
  - Eviction: 501 `Start`s, `Recent(1000)` has 500, oldest gone; evicted running op's `Finish`
    still emits its final record, and its `Cancel` still calls the func.
  - Cancel/unregister race: `SetCancel` func, `ClearCancel` concurrently with `Cancel`; after
    `ClearCancel` returns, `Cancel` returns false and the func is never called again.
  - Concurrency under `-race`: N goroutines `Start`/`AddCommand`/`Finish` while others call
    `Recent`; per-id emits arrive `running` first, final last.
- `internal/gitsession/oplog_test.go` (real `ExecRunner`, `newTestEntry` with `opLog`):
  - `RunOp` `branchCreate` success: one record, `status ok`, command `git branch …`, `source` =
    conn label.
  - `RunOp` classified failure (checkout of a missing ref): `status error`, message set.
  - `RunRemote` with nil conn (fetch against a local bare remote): no record.
  - Cancelled fetch: wrapping Runner (pattern `stack_test.go:42-66` `argSpawnCountingRunner`)
    parks the fetch spawn until ctx cancels; `Log.Cancel(id)` returns true; record ends
    `cancelled`, `cancellable` false.
- Existing `gitsession` tests keep passing with the `UndoRun` signature change.

### 6.2 Playwright (`test:ui:space`)

- `tests/ui/support/ipcChannels.ts`: `opsRecent: 'kira:ops:recent'`, `opsCancel:
  'kira:ops:cancel'`, `opUpdate: 'kira:op:update'`, `toggleOperationsPanel:
  'kira:menu:toggle-operations-panel'`.
- `support/mockRuntime.ts`: FQN `opsRecent` to `OpsService.Recent`, `opsCancel` to
  `OpsService.Cancel`; wildcard `opsRecent: '[]'`, `opsCancel: 'null'`.
- `tests/ui/operations.spec.ts` (new):
  - **Bounding box** (mirrors Studio `operations.spec.ts:128-162`): git mode, project panel
    visible, toggle ops; `dock.x` = `project.x`; dock right = main right; project bottom = main
    bottom; `dock.y - project bottom` = 6; status-bar `marginBottom` `0px`; tolerance ±0.5.
  - Records render: seed `opsRecent` with two records; repo name, source, kind, command visible.
  - Filter by repo name narrows rows.
  - Live update: `emitWailsEvent('kira:op:update', …)` running then ok patches one row.
  - Cancel button shown only for a running `cancellable: true` row; click sends `opsCancel` with
    its id; absent for running `cancellable: false`.
- `tests/ui/window-chrome.spec.ts`: DOM order becomes `['toggle-project-panel',
  'toggle-operations-panel','open-settings','toggle-keep-awake','new-window']`; new test mirroring
  `:158-168` for `kira:menu:toggle-operations-panel` (panel appears, emits again, disappears).

### 6.3 Studio

No new spec. `test:ui:studio` runs in full: shared shell, `createCoreControl`, `opLogMenuItems`
and events hoist all touch it.

## 7. Verification

Per-commit (hooks): pre-commit `bun run lint && bun run typecheck`; pre-push `go build ./...`,
`lint:go`, `lint:dead`.

Once, near phase end:

```sh
go test -race ./apps/kira-space/internal/oplog/... ./apps/kira-space/internal/gitsession/... \
  ./apps/kira-space/internal/gitrpc/... ./apps/kira-space/internal/bridge/... \
  ./apps/kira-space/internal/appshell/... ./internal/appevent/...
go test ./apps/kira-studio/internal/bridge/...
bun run typecheck
bun run lint:all
bun run test:unit
bun run test:ui:space
bun run test:ui:studio
bun run test:visual:space
```

`test:go` full tree needs GTK headers (`docs/DEV_ENVIRONMENT.md`); run package lists above.
Known pre-existing flakes (P132 Part 1 result): `budgets.spec.ts`, `slick-grid.spec.ts:896`,
`tree.spec.ts:158` at 4 workers. Any failure: fix per CLAUDE.md, never note-and-skip.

## 8. Steps and commits

1. `feat(space): in-memory op log ring` — `internal/oplog/log.go`, `log_test.go`.
2. `feat(space): log gitsession writes to op log` — `gitsession/oplog.go`, hooks in `RunOp`/
   `UndoRun`/`RunRemote`/`RunRestack`, four `noteWrite` sites, `Registry.OpLog`/`newRepoEntry`,
   `UndoRun` `connLabel` plus `gitrpc/ops.go` and test call sites, `conn.go` comment,
   `oplog_test.go`.
3. `feat(space): OpsService, op update push and operations menu item` — `appevent` hoist, Studio
   re-exports, Space `events.go` `AttachOpLog`, `bridge/ops.go`, `menu.go`, `main.go`
   (`wireGit`, Services, teardown), `nativeLabel`, regenerated bindings.
4. `refactor(workbench): core toggle-operations channel; menu and hydrate fixes` —
   `createCoreControl`, Studio `bridge/index.ts`, `opLog.ts` `canCancel`, `OpLogPanel.vue`,
   `createOpLogStore` rejection path plus spec assertion.
5. `feat(space): operations dock` — `opsDomain.ts`, `ops.ts`, Space `bridge/index.ts`, `main.ts`,
   `OperationsPanel.vue`, Space `WorkbenchShell.vue`, `TitleBar.vue`, `App.vue`, `layout.ts`.
6. `refactor(workbench): shell always mounts dock` — shared `WorkbenchShell.vue` drops `hasDock`.
7. `test(space): operations dock and menu toggle` — `operations.spec.ts`, `window-chrome.spec.ts`,
   support mocks.
8. Full verification run (§7); each fix its own `fix:` commit.
9. `docs: Kira Space op log` — `ARCHITECTURE.md`.
10. `docs(v2.0): P132 Part 2 result` — SPEC result section with commit list and test counts.

Step 5 before step 6: Space must pass `#dock` before the shared shell makes it required, or the
typecheck hook fails.

## 9. What a Linux sandbox cannot verify

- macOS menu accelerator Cmd+J firing the menu item: tests drive `kira:menu:toggle-operations-panel`
  through `emitWailsEvent`, never the native menu.
- WKWebView (macOS) rendering of the dock; Linux runs Chromium for Playwright and WebKitGTK for
  the real app, neither of which proves WKWebView geometry.
- Real VS Code paired client producing a record with its own `ClientLabel`: covered only through
  the `Conn.ClientLabel` path in Go tests.

## 10. Closing audit

```sh
rg -n 'hasDock' packages apps --glob '!**/node_modules/**'                          # none
rg -n 'createOpLogStore' apps/kira-space/frontend/src/state/ops.ts                  # 1+
rg -n '<OpLogPanel' apps/kira-space/frontend/src/workbench/OperationsPanel.vue      # 1
rg -n '<style' apps/kira-space/frontend/src/workbench/OperationsPanel.vue           # none
rg -n '<script setup lang="ts">' apps/kira-space/frontend/src/workbench/OperationsPanel.vue  # 1
rg -n 'ChannelOpUpdate|ChannelToggleOperationsPanel' internal/appevent/appevent.go   # 2
rg -n '"kira:op:update"|"kira:menu:toggle-operations-panel"' apps/*/internal         # none (re-exports only)
rg -n "key === 'j'|key === 'J'|KeyJ" apps/kira-space/frontend/src                   # none
rg -n 'onToggleOperationsPanel' apps/kira-studio/frontend/src/bridge/index.ts       # none
rg -n 'noteWrite\(' apps/kira-space/internal/gitsession --glob '!*_test.go'         # 4 call sites + definition
rg -n 'startOp\(' apps/kira-space/internal/gitsession --glob '!*_test.go'           # 4 entry points + definition
rg -n 'oplog|OpsService' apps/kira-space/internal/ade                               # none
rg -n '"This window"' apps/kira-space/internal --glob '!*_test.go'                  # none
git diff 8477fee1 -- package.json '**/package.json' go.mod go.sum                   # empty
```

## 11. Risks

- **Cancel after release.** A cancel landing after `opSlot.release()` could hit the next op's
  slot. Closed by `ClearCancel` before `release` and `Cancel` holding `log.mu`; §6.1 race test
  covers it.
- **Lock order.** `log.mu` then `slot.mu`. A cancel func calling back into `Log` would deadlock.
  Only `CancelRemote`/`CancelRestack` register; neither touches `Log`.
- **Emit volume.** One record per op, plus one emit per spawn (`AddCommand`). Restack emits per
  rebased branch; fine at human rate. Records are small; `Command` capped at 16 KiB.
- **Secret leakage.** Askpass token lives in env, never argv; `AddCommand` reads argv only. A URL
  with embedded credentials as a remote name would show; `RunRemote` takes remote names, not
  URLs.
- **`nativeLabel` rename** changes visible undo tooltip text ("(window: Kira Space)"). Intended;
  flagged.
- **Shared shell geometry.** Space status bar shifts 4px. Studio geometry unchanged (already
  `mt-1`). Studio's bounding-box test and Space's new one both run.
- **Bindings regen churn.** Regeneration may reorder `models.ts`. Commit whatever the task emits;
  never hand-edit.
- **Early `gitSock` client.** Covered by setting `Registry.OpLog` before `gitSock.Start()`;
  records made before any window subscribes still land in the ring and hydrate.
- **Evicted running op.** Needs 500 newer ops while one runs; keeps its cancel entry and emits
  its final record. A renderer that already dropped it re-adds it at top via `applyUpdate`.
  Accepted: shows a real finished op, not stale data.

## 12. Acceptance

- SPEC row: ring (500, in memory, every window) — §3.1, §3.5; hooks on `RunOp`, `UndoRun`
  (`connLabel`), `RunRemote` non-nil conn, `RunRestack` — §3.3; four spawn sites — §3.3;
  `CancelRemote`/`CancelRestack` — §3.3; `OpsService` + `kira:op:update` — §3.4; channel hoist,
  `onToggleOperationsPanel` in `createCoreControl` — §3.4, §3.7; menu item Cmd+J — §3.4; Space
  store, wrapper, `#dock`, title-bar toggle, `App.vue`, optional-group hydrate — §3.6; shared
  shell drops `hasDock` — §3.7.
- Tests: Space bounding box (dock left = project left), `operations.spec.ts`,
  `window-chrome.spec.ts`, `gitsession/oplog_test.go`, `go test -race`, both apps' `test:ui`,
  `test:unit`, `test:visual:space` green.
- §10 audit greps return expected counts; no new dependency; hooks green on every commit, no
  `--no-verify`.
