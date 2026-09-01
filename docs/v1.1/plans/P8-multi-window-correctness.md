# P8 — Multi-window correctness

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P8 row): *"Make sure the app works
> correctly with two or more windows open at once."* Why: *"Not verified since the Wails migration;
> multi-window is a real usage pattern this app should support cleanly, not an edge case."*
>
> **The headline, in one line: the app has never been able to open a second window at all — in
> either shell — so nothing about multi-window has ever been exercised, and the state that would
> have to be per-window is uniformly app-wide, with three places where two windows would actively
> destroy each other's data.**
>
> **There is exactly one window-creation call site** (`apps/kira-studio/main.go:231`) and exactly
> two ways to reach it: once at startup (`:237`), and from the Dock-reopen handler, which is
> explicitly guarded on `len(app.Window.GetAll()) == 0` (`internal/shell/app.go:96`). There is no
> *New Window* menu item (`internal/shell/menutemplate.go:91-104`), no renderer affordance, and —
> per `docs/ARCHITECTURE.md`'s Invariants — the renderer "opens no window" by design. The Electron
> shell this replaced had no *New Window* either (`18fe7bb^:src/main/menu.ts`). So P8 is not a
> bug-fix pass over a working multi-window app; it is the phase that makes the second window
> possible and makes the app correct once it exists.
>
> **Three destructive findings, all reproduced against real code in this sandbox, not argued
> from reading.** (1) `TabsRepo.Save` is `DELETE FROM tabs` + re-insert
> (`internal/storage/repos/tabs.go:90`) and the renderer always sends *its own whole tab list*
> (`state/tabs.ts:107`) — driven against a real `-tags server` binary with two independent
> clients, client B's save erased client A's tab outright (§1.3). (2) `LayoutRepo.Set` does its
> read *outside* its write transaction (`repos/layout.go:64-92`) — two windows patching two
> *different* leaves lost one of the two patches in **109 of 200** measured rounds (§1.3).
> (3) `window.bounds` is a single row for N windows (`repos/layout.go:57`, `:109`), so every window
> opens at the last-moved window's rectangle, exactly on top of it (measured, §1.3).
>
> **Two behavioural regressions against the Electron shell, both introduced by the port and neither
> recorded until now.** Menu signals were `sendToFocusedWindow(channel)`
> (`18fe7bb^:src/main/menu.ts:5-8`); under Wails they are `app.Event.Emit`, which Wails fans out to
> **every** window (`transport_event_ipc.go:15-27`) — so Cmd+W ("Close Tab") would close a tab in
> every open window at once. And the quit flush handshake was `Promise.all` over *every* window
> with a per-window ack map (`18fe7bb^:src/main/index.ts:47-60`, `:157`); the Go `Quitter` has one
> `sync.Once`-closed channel (`internal/shell/quit.go:26`, `:69`), so the **first** window to ack
> releases the wait for all of them — proven in §1.3.
>
> **What is genuinely already right, and is not touched:** the data plane. Wails' stream sessions
> are keyed per window (`stream.go:747-850`), `Router.AttachStream` builds a fresh `Session` and a
> fresh cache-stats subscription per connection (`adapterhost/dataframe.go:25-34`), and two
> concurrent `engine` stream clients against one real backend were both served correctly here
> (§1.3). The L2/L3 cache keys, the metrics ticker, the connect-coalescing map and every app-wide
> broadcast are all correct as they stand. §3 lists what was checked and did not fire.
>
> **What this plan cannot do, and says so throughout:** this sandbox is Linux, with no AppKit, no
> `NSApp`, no menu bar and no real WKWebView. Everything below that concerns *storage, wiring,
> events, sessions and lifecycle* was executed here for real (`internal/shell` compiles and its
> tests run on Linux — §1.3); everything that concerns *AppKit behaviour* (key-window resolution,
> the Window menu, `windowShouldClose`, sheet attachment, Cmd+`) is cited to the pinned Wails
> source and flagged **[needs a Mac]**, with a written procedure in §6.3.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `e84c635` (`docs(v1.1): close out P7's acceptance checklist against what actually
ran`), branch `claude/feature-v1-1-p5-onwards-2isfzt`. P1-P7, P10 and P11 have landed.

Prior work this plan builds on rather than rediscovering (`git log --oneline | grep -i window`):

| Commit | What it established |
|---|---|
| `0449df1` | `feat(main): the renderer cannot open a window, navigate away, or attach a webview` — Electron-era. The renderer-opens-no-window rule is still an invariant (`docs/ARCHITECTURE.md`:81-84); P8 does not weaken it. The *shell* opens windows; the renderer asks. |
| `ac1a5c4` | P56 native shell parity — the port that produced `internal/shell/{window,menu,quit}.go`. Its **D6** recorded that signal channels emit `nil` like Electron's `sendToFocusedWindow`, but not that the *targeting* changed from focused-window to broadcast. F2 below is that gap. Its **D10** (`ApplicationShouldTerminateAfterLastWindowClosed: false` + the reopen handler) stands and P8 keeps it. |
| `31ea9c7` | `fix(renderer): flush pending tab-state save before the window closes` — the Electron-era quit handshake, whose per-window ack map (`18fe7bb^:src/main/index.ts:47-60`) the Go port collapsed to one channel. F3. |
| P2 R1 (`internal/shell/window.go:64-70`'s comment) | `shell.Attach` returns a `detach` that `main.go` must call from `beforeFlush`. F4 is that the same `detachWindow` variable is *also* the reassignment point in `newWindow`, which is only safe while at most one window can exist. |

`docs/v1.1/plans/P7-cpu-memory-status-readout.md` §0.3 explicitly hands one item here: *"Multi-window
behaviour of the metrics event. `bridge/events.go:80-81` emits on one channel to whatever windows
exist; that is P8's subject, not this one."* Answered in §3 — broadcast is the correct behaviour for
that channel, and nothing needs to change.

### 0.2 Scope

1. Give the app a real second window: a *New Window* menu item and the window-creation path behind
   it, with per-window wiring that does not clobber the previous window's (F1, F4).
2. Restore focused-window targeting for the twelve menu signal channels (F2).
3. Restore the per-window quit flush handshake (F3), and add the per-window *close* flush the app
   has never had (F8).
4. Make the two pieces of state that are genuinely per-window actually per-window: the tab set and
   the window rectangle (F5, F6).
5. Fix the layout lost-update race (F7) and give panel layout the cross-window broadcast that makes
   "app-wide" true rather than merely silent.
6. Record the per-window/app-wide split in `docs/ARCHITECTURE.md`, and write the real-Mac
   verification procedure this sandbox cannot run (§6.3).

### 0.3 Not in this phase

- **Per-window settings, connections list, or op log.** All three are app-wide by design (one
  process, one database, one adapter host — `docs/ARCHITECTURE.md`'s Process model) and their
  existing broadcasts are already correct. D9.
- **Moving or dragging a tab between windows.** A real feature, with its own drag surface and its
  own state-transfer question; the phase brief asks for correctness with two windows, not for a
  tab-transfer UI.
- **A Window-menu list of open windows / `Cmd+`` cycling.** The mechanism is recorded in OQ-1 so it
  is not rediscovered, but it is useless without distinguishing per-window titles, and choosing what
  a window is titled is a UI decision outside this row. Deliberately out, not forgotten.
- **Cross-window live mirroring of loaded pages.** If two windows have the same table open and one
  commits an edit, the other's *renderer-side* page store is stale until it refreshes. The Go-side
  L2 entry is already dropped (`enginecache` `DropTarget` on mutate), so nothing serves wrong data
  from cache — the other window simply shows what it last read, exactly as it would if the edit came
  from another client entirely. D12.
- **Any change to the data plane.** §3 proves it is already correct per window.
- **Multi-window on Linux/Windows.** The app targets macOS 14+ arm64
  (`docs/ARCHITECTURE.md`'s Stack). Linux is the dev sandbox only.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every claim below is either **[verified here]** (executed
  in this sandbox — the command and its output are in §1.3), **[verified in source]** (cited to a
  file:line in this repo or in the pinned `wails/v3@v3.0.0-beta.15` module), or **[needs a Mac]**
  with the exact procedure that would settle it.
- **`internal/bridge` keeps importing no Wails** (P56 D1: `internal/shell/app.go` is the only
  adapter). Everything P8 needs from the window layer reaches `bridge` through a widened
  `appcore.Emitter` and plain string arguments, never a `*application.WebviewWindow`.
- **The renderer still opens no window.** *New Window* is a menu item handled in Go, not a
  renderer-initiated `window.open`. `Harden()`'s
  `JavaScriptCanOpenWindowsAutomatically: Disabled` (`internal/shell/security.go:25`) is unchanged.
- **Tests only where AGENTS.md's bar is met.** Two earn their keep here (D13); nothing else in this
  phase gets one.

---

## 1. What the code does today

### 1.1 There is exactly one window-creation call site, and it can never run twice

`apps/kira-studio/main.go:216-237` is the whole of it:

```go
var mainWindow *application.WebviewWindow
attachDialogs(app, func() application.Window { return mainWindow })
...
windowDeps := shell.WindowDeps{Layout: repositories.Layout, StartedAt: startedAt}
newWindow := func() {
    if detachWindow != nil {
        detachWindow()
    }
    win := app.Window.NewWithOptions(shell.Options(windowDeps, shell.Harden(), "/"))
    mainWindow = win
    detachWindow = shell.Attach(win, windowDeps)
}
shell.AttachReopen(app, newWindow)

newWindow()
```

`shell.AttachReopen` (`internal/shell/app.go:94-100`) is the only other caller, and it is gated:

```go
return app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {
    if len(app.Window.GetAll()) == 0 {
        newWindow()
    }
})
```

`grep -rn "NewWithOptions\|Window.New" --include=*.go --include=*.ts --include=*.vue` over the repo
returns that one production site plus one in `internal/shell/window_test.go`. **[verified in
source]** So no user action, no menu item and no renderer call can produce a second window today.

### 1.2 What is per-window, what is app-wide, and where the line sits today

Every row was read, not assumed. "Today" is what happens *if* a second window existed.

| State | Lives in | Today, with two windows | Verdict |
|---|---|---|---|
| Tab set + active tab | `tabs` table; `frontend/src/state/tabs.ts` | Each window keeps its own reactive list, and each `tabsSave` **replaces the whole table** (`repos/tabs.go:90`) | **F6 — destructive** |
| Window rectangle | `ui_layout` leaf `window.bounds` | One row; last mover wins; every new window opens on top of it (`shell/window.go:40-48`) | **F5 — wrong** |
| Panel layout (project/operations/cell editor) | `ui_layout` leaves; `state/layout.ts` | Both windows write the same rows through a read-outside-transaction merge; no change event exists | **F7 — lossy race + silent divergence** |
| Menu signals (12 channels) | `bridge.Events.Signal` → `app.Event.Emit` | Delivered to **every** window (`transport_event_ipc.go:22-27`) | **F2 — regression vs Electron** |
| Quit flush handshake | `shell/quit.go` | First ack releases the wait for all windows (`quit.go:26`, `:69`) | **F3 — regression vs Electron** |
| Window-close flush | — | Does not exist; a pending debounced tab patch is dropped | **F8 — gap** |
| Native file dialogs | `shell/app.go:41-66` via `main.go:217`'s `mainWindow` closure | Sheet attaches to the **most recently created** window, not the calling one | **F4 — wrong** |
| `shell.Attach` bounds/startup listeners | `main.go:157`'s single `detachWindow` | Creating window 2 detaches window 1's listeners | **F4 — wrong** |
| Data-plane session + cache-stats push | `adapterhost.Session` per `StreamConn` | One session per window, one subscription per session | Correct — §3 |
| L2 page cache / L3 counts | `internal/enginecache` | Keyed by `{connectionId,path,filter,projection,sort,pageSize,cursor}`; window-agnostic *by design* | Correct — §3 |
| Connections, connection state, settings, op log, app metrics, cache stats | Go-side services + broadcast channels | App-wide, broadcast to every window | Correct — §3 |
| Browser storage | — | None exists (`grep localStorage\|sessionStorage\|indexedDB` over `frontend/src` + `packages/shared`: zero hits) | Correct — §3 |

### 1.3 What this sandbox can and cannot do — verified, not assumed

Unlike `internal/metrics` (whose darwin build cannot compile here at all — P7 §1.4),
**`internal/shell` builds and runs on Linux**, including creating real `*application.WebviewWindow`
values against the shared `testApp` (`internal/shell/main_test.go`):

```
$ go vet ./apps/kira-studio/internal/shell/...          # clean
$ go test -count=1 -run TestAttach ./apps/kira-studio/internal/shell/... -v
--- PASS: TestAttach_PersistsResizeAfterDebounce (0.52s)
--- PASS: TestAttach_DetachStopsPersisting (0.52s)
```

That, plus the `-tags server` build (`go build -tags server ./apps/kira-studio` — succeeds here),
made four of this plan's findings **executable**, not merely read. All four probes were written,
run, and then deleted; their exact output follows.

**(a) Two windows coexist in the manager; both get the same rectangle.** Two
`testApp.Window.NewWithOptions` calls, then two `LayoutRepo.Set` bounds writes, then two
`shell.Options` calls:

```
window count after two NewWithOptions: 2
winA id=1 name="window-1"  winB id=2 name="window-2"
stored window.bounds after both windows persisted: {X:900 Y:400 Width:400 Height:300}
Options() #1: X=900 Y=400 W=400 H=300 InitialPosition=1
Options() #2: X=900 Y=400 W=400 H=300 InitialPosition=1
```

Window A's rectangle is gone, and every subsequent window is built at window B's. **[verified
here]** (Wails' own default window name is `window-<id>`, `webview_window.go:344-345` — a
per-process counter, so it is *not* a key that survives a restart. D2 depends on this.)

**(b) One ack releases the whole quit flush.** A real `shell.Quitter` with counting
`sync.OnceFunc` halves, one `ShouldQuit()`, then a single `Flushed()`:

```
channels emitted for the quit handshake: [kira:app:flush-before-close] (one broadcast, not one per window)
teardown ran after ONE ack, with the second window still flushing; order=[beforeFlush teardown]
```

**[verified here]**

**(c) Two independent clients, one real Go backend: the second erases the first's tabs.** The
`-tags server` binary, a temp `KIRA_HOME`, and two `POST /wails/runtime` clients with distinct
`x-wails-client-id` headers calling the real `TabsService`:

```
== client A saves one tab ==            {}
== list after A ==                      [{"id":"tab-A", ...}]
== client B saves its own tab ==        {}
== list after B (from client A) ==      [{"id":"tab-B", ...}]
```

`tab-A` is gone. This is the real bridge, the real repo and the real SQLite file — not a unit
stand-in. **[verified here]**

**(d) The layout read-modify-write loses updates, routinely.** 200 rounds; in each, two goroutines
patch two *non-overlapping* leaves (`panel.project.visible` and `panel.cellEditor.height`)
concurrently through `LayoutRepo.Set`:

```
rounds=200, rounds where one of two non-overlapping layout patches was lost: 109
```

`SetMaxOpenConns(1)` (`storage/db.go:54`) serialises the *statements*, but `Set`'s `GetAll()` runs
before `Begin()` (`repos/layout.go:64-92`), so the merge is computed against a snapshot another
writer can supersede. **[verified here]**

**(e) The data plane genuinely multiplexes.** Two concurrent WebSocket clients on
`/wails/stream/ws?name=engine` against the same `-tags server` binary, each sending
`{"kind":"req","id":1,"op":"ping"}` and holding the socket open across the other's connect:

```
window A: got MessageBinary reply, 80 bytes, identifier="KIF1"
window B: got MessageBinary reply, 80 bytes, identifier="KIF1"
```

Both answered, both with a well-formed FlatBuffers frame. **[verified here]**

**What this box cannot do**, and where §6.3's manual procedure takes over: there is no AppKit here,
so `app.Window.Current()` (which resolves `[NSApp keyWindow]` → `[NSApp mainWindow]`,
`application_darwin.go:169-181`) always returns the Linux GTK fallback; no menu bar, so no
accelerator can be pressed; no `windowShouldClose:` delegate (`webview_window_darwin.m:484-499`), so
the close-flush hook cannot be exercised end to end; no sheet, so dialog attachment cannot be seen;
and no real WKWebView, so a second window's WebKit helper processes — and therefore P7's metrics
readout with two windows open — cannot be observed.

---

## 2. Findings

### F1 — There is no code path to a second window at all, in either shell

**[verified in source]** §1.1. One call site (`main.go:231`), reachable at startup and on
Dock-reopen-with-zero-windows only. `internal/shell/menutemplate.go:91-104`'s Window section is
`Next Tab / Previous Tab / Close Tab / — / Minimise / Zoom / Close Window`: it can *close* a window
and can never make one. The Electron shell was the same
(`18fe7bb^:src/main/menu.ts`; its Window submenu had no New Window either).

This is why "not verified since the Wails migration" understates it: it has never been verifiable in
either shell. **P8's first commit is the one that makes the rest of this plan reachable at all.**

The accelerator is free: `packages/shared/domain/shortcuts.ts:24-37` has thirteen `global: true`
bindings; `CmdOrCtrl+N` is `app.newConnection` and `CmdOrCtrl+Shift+W` is `window.close`.
`CmdOrCtrl+Shift+N` is unclaimed. D8.

### F2 — Every menu signal reaches every window; Electron sent each to the focused one

**[verified in source]** The chain is four hops, none of which carries a window:

1. `internal/shell/menu.go:52` — `emitItem.OnClick(func(*application.Context) { d.Events.Signal(channel) })`.
   Wails' `*application.Context` for a menu click carries `clickedMenuItem`, `menuItemIsChecked` and
   `contextMenuData` and nothing else (`context.go:14-18`) — there is no window on it.
2. `internal/bridge/events.go:96-98` — `Signal` → `ev.emit.Emit(channel, nil)`.
3. `internal/shell/app.go:20-25` — the `appcore.Emitter` adapter → `e.app.Event.Emit(name, data)`.
4. `event_manager.go:30-43` → `customEventProcessor.Emit` → `EventIPCTransport.DispatchWailsEvent`,
   which snapshots **every** window and dispatches to each
   (`transport_event_ipc.go:15-27`).

Electron's was one hop with the opposite default:

```ts
function sendToFocusedWindow(channel: string): void {
  const window = BrowserWindow.getFocusedWindow();
  window?.webContents.send(channel);
}
```
(`18fe7bb^:src/main/menu.ts:5-8`.)

Twelve channels are affected, and `frontend/src/App.vue:31-46` subscribes to all twelve in every
window. The user-visible consequences, in the order a user would meet them:

- **Cmd+W ("Close Tab")** closes the active tab in *every* open window.
- **Ctrl+Tab / Ctrl+Shift+Tab** advance the tab in every window.
- **Cmd+, / Cmd+N** open the settings dialog / connection dialog in every window at once.
- **Cmd+B / Cmd+J** toggle both panels in both windows — and then *both* windows write the toggle
  to the same `ui_layout` rows (F7).
- **Cmd+Return / Cmd+Shift+Return ("Run", "Run All")** fire `runCommand('view.run')` in every
  window, so a menu-driven Run executes the *other* window's console statement too.

The last one is the reason F2 is filed as a correctness bug and not a papercut: it can send a
statement to a database from a window the user was not looking at.

The mechanism for the fix exists and is exported. `(*WebviewWindow).DispatchWailsEvent(*CustomEvent)`
(`webview_window.go:1443`) delivers to exactly one window, and `app.Window.Current()`
(`window_manager.go:74-83`) resolves the key window on darwin via
`[NSApp keyWindow] ?? [NSApp mainWindow]` (`application_darwin.go:169-181`) — the direct analogue of
`BrowserWindow.getFocusedWindow()`. D6.

### F3 — The quit flush handshake completes on the first window's ack

**[verified here — §1.3(b)] [verified in source]** `internal/shell/quit.go`:

```go
ackOnce sync.Once
...
func (q *Quitter) Flushed() { q.ackOnce.Do(func() { close(q.flushed) }) }
...
func (q *Quitter) flushThenQuit() {
    q.beforeFlush()
    q.events.Signal(bridge.ChannelFlushBeforeClose)   // broadcast: F2's mechanism, correct here
    select {
    case <-q.flushed:
    case <-time.After(q.timeout):
    ...
```

`close(q.flushed)` is a single edge. With two windows, the broadcast is right (both windows *should*
be asked to flush) but the wait is wrong: window A's ack unblocks the wait, `teardown()` runs, and
`repositories.Close()` / `db.Close()` (`main.go:167-177`) execute while window B's
`control.tabsSave(...)` (`state/tabs.ts:136`) is still in flight — the exact write the handshake
exists to protect.

Electron did this correctly and P8 is restoring, not inventing:

```ts
function requestFlush(win: BrowserWindow): Promise<void> { … per-window timer + ack map … }
…
void Promise.all(BrowserWindow.getAllWindows().map(requestFlush)).then(async () => { … });
```
(`18fe7bb^:src/main/index.ts:47-60`, `:157`.)

### F4 — `newWindow` detaches the previous window's listeners and steals the dialog target

**[verified in source]** `main.go:227-234`. Two distinct defects hide in five lines, both invisible
today because the closure can only run when zero windows exist:

- `if detachWindow != nil { detachWindow() }` — a single `func()` slot (`main.go:157`). Creating
  window 2 would unsubscribe **window 1's** `WindowDidResize`/`WindowDidMove`/`WindowClosing`/
  `WindowRuntimeReady` listeners and cancel its pending debounced bounds write
  (`internal/shell/window.go:97-103`). Window 1 would silently stop persisting its rectangle, and
  `beforeFlush` would only ever detach the newest window.
- `mainWindow = win` — the variable `attachDialogs`' closure reads (`main.go:216-217`,
  `internal/shell/app.go:47`/`:58`). A *Save file…* triggered from window 1 would open its sheet
  attached to window 2.

The fix is not "make `detachWindow` a slice": it is a per-window record, keyed by window, torn down
when *that* window closes. C2.

### F5 — One `window.bounds` row for N windows

**[verified here — §1.3(a)] [verified in source]** `internal/shell/window.go:40-48` reads
`layout.Window.Bounds` and, when present, sets `X`/`Y`/`Width`/`Height` and
`InitialPosition = application.WindowXY` on *every* window it builds; `Attach`'s `persist`
(`:74-79`) writes the single `window.bounds` leaf (`repos/layout.go:57`, `:109`) from *every*
window's resize/move.

Consequence: window 2 opens exactly on top of window 1, pixel for pixel — the classic "did it even
open?" failure — and whichever window the user moves last dictates where every future window opens.

This was also true of the Electron shell (`18fe7bb^:src/main/window.ts:12-13`, `:36-46`), which is
why it was never noticed: with one window, one rectangle is right.

### F6 — `TabsRepo.Save` is a whole-table replace, so two windows erase each other's tabs

**[verified here — §1.3(c)] [verified in source]** Two halves that are each individually reasonable
and jointly destructive:

```go
if _, err := tx.Exec(`DELETE FROM tabs`); err != nil { … }
for i, rec := range records { … INSERT … }
```
(`internal/storage/repos/tabs.go:90-100`.)

```ts
function saveIfChanged(): void {
  const snapshot = JSON.stringify(tabsState.tabs);
  if (snapshot === lastSavedSnapshot) return;
  lastSavedSnapshot = snapshot;
  void control.tabsSave(tabsState.tabs);
}
```
(`frontend/src/state/tabs.ts:103-108`; `tabsState.tabs` is that window's own list.)

Every `openTab`/`closeTab`/`activateTab`/`moveTab`/`duplicateTab` calls `saveNow()`, and every
`patchTabState` calls `saveDebounced()` (1 s) — so with two windows open, *any* tab interaction in
either window deletes the other window's rows within a second. On relaunch, `hydrateTabs`
(`:169-176`) reads the whole table into *both* windows, so whichever window last saved has its tabs
duplicated into both.

The `tabs` table has no window column (`migrations/0001_init.sql:87-95`), so there is nothing to
scope the delete by. C4/C5.

### F7 — `LayoutRepo.Set` reads outside its own transaction, and nothing tells the other window

**[verified here — §1.3(d)] [verified in source]** `repos/layout.go:63-92`: `GetAll()`, then merge,
then `Begin()`, then upsert all six leaves. Two callers whose patches touch entirely different
leaves still lose one of the two, because the loser's merge was computed from a pre-write snapshot
and it rewrites *all six* leaves from it. 109/200 rounds, measured.

This is reachable single-window in principle (two concurrent bound calls) but becomes routine with
two windows, because `state/layout.ts:35-45` debounces panel patches to 150 ms and both windows
receive the same broadcast panel-toggle signal (F2) at the same instant.

Second half of the finding: there is **no** `layoutChanged` event. `LayoutService.Set`
(`bridge/layout.go:55-61`) returns the merged value to its caller and emits nothing —
unlike `SettingsService.Set`, which broadcasts unconditionally
(`bridge/events.go:102-104`, and P56's note that the broadcast "is load-bearing"). So window A
resizing the project panel leaves window B showing the old width until relaunch, at which point
window B's own last write may have won anyway. Declaring panel layout app-wide (D3) is only honest
if the two windows actually agree; the broadcast is what makes that true.

### F8 — Closing a window flushes nothing

**[verified in source]** `ChannelFlushBeforeClose` has exactly one emitter, `Quitter.flushThenQuit`
(`quit.go:81`), and the quit path is the only thing that reaches it. `shell.Attach`'s
`WindowClosing` listener only cancels the pending bounds debounce (`window.go:89-91`,
deliberately, per P56 D8). So closing a window — Shift+Cmd+W, the red button, `Close Window` —
drops whatever `saveDebounced()` had pending: up to one second of scroll offset, filter text, sort,
projection and pager position for every tab in that window.

Today that costs the user a second of tab-state on quit-by-closing-the-window; once tabs are
per-window (C5) it costs them that window's most recent edits every time they close it, which is a
different order of severity.

The mechanism to fix it is verified in the pinned source, including its trap. On darwin,
`windowShouldClose:` returns `NO` and posts `EventWindowShouldClose`
(`webview_window_darwin.m:484-499`), which `DefaultWindowEventMapping` maps to
`Common.WindowClosing` (`pkg/events/defaults.go:43`). `HandleWindowEvent` runs **hooks first,
synchronously, and returns early if one cancels** (`webview_window.go:989-1002`), and only then
reaches the listeners — including Wails' own listener that destroys the window
(`webview_window.go:366-371`). So `win.RegisterHook(events.Common.WindowClosing, …)` +
`event.Cancel()` is a genuine "hold the close". **The trap:** `(*WebviewWindow).Close()` is itself
`w.emit(events.Common.WindowClosing)` (`webview_window.go:1248-1255`), so a hook that unconditionally
cancels and then calls `Close()` loops forever — the hook must be one-shot per window. C6 states
this explicitly.

### F9 — `Options` hard-codes one URL and one title for every window

**[verified in source]** `internal/shell/window.go:26-38` builds `Title: "Kira Studio"` and takes
`url` from its single caller, which always passes `"/"` (`main.go:231`). Not a bug on its own — it
is the seam D2 uses to hand each window its own identity, and it is recorded here so the
implementer changes `Options`' signature once rather than twice.

---

## 3. Checked, and not fired

Each of these was investigated as a suspected multi-window hazard and found correct. They are
recorded so a later pass does not re-open them.

- **The data plane is per-window already, at both layers.** Wails scopes stream sessions by window
  id: `sessionWithAdmission` refuses to resolve a session id outside the window that owns it
  (`stream.go:756-762`), only supersedes *older generations within the same window*
  (`stream.go:773`, `:830-840`), and `markAsDestroyed` calls `streams.dropWindow(w.id)` on close
  (`webview_window.go:298-302`). Above that, `Router.AttachStream` builds a fresh `Session` — its
  own bounded queue, its own writer goroutine, its own `ctx` — and its own `cache.OnStatsChanged`
  subscription per connection (`adapterhost/dataframe.go:25-34`;
  `enginecache/cache.go:193-205` is a real multi-listener registry, not a single slot). Two
  concurrent clients were served correctly here (§1.3(e)). Nothing to change.
- **The L2/L3 cache keys are window-agnostic on purpose.** `PageCacheKey`
  (`enginecache/pages.go:72-99`) hashes `{connectionId, path, projection, filter, sort, pageSize,
  cursor}`; `countKey` (`counts.go:35`) is `{connectionId, path, filter}`. Adding a window
  discriminator would be a *regression*: the same query issued from two windows must hit one entry,
  and the byte budget is app-wide because the process is.
- **The metrics ticker is one instance, created before any window exists** (`main.go:135-140`), and
  `bridge/events.go:80-82` broadcasts each sample. A second window neither starts a second sampler
  nor double-counts: `AppProcessSet` matches by executable-path substring across a single
  process-table scan (`docs/ARCHITECTURE.md`:778-781), so a second window's extra WebKit helpers
  are picked up as part of the same app total, which is what an app-wide readout should report.
  This closes P7 §0.3's handoff: broadcast is correct, and **no change is needed**. (That the
  helper set grows correctly with a second window is **[needs a Mac]** — §6.3 step 8.)
- **Concurrent `Connect` on the same connection is already coalesced.**
  `connections/service.go:386-407` keeps an `inFlight` map keyed by connection id and makes the
  second caller wait on the first's `done` channel. Two windows racing *Connect* on the same row
  produce one attempt and one adapter, not two.
- **Connection state, connections-changed, settings-changed and op-update broadcasts are correct.**
  All four are genuinely app-wide facts, and the renderer already reacts sanely in every window:
  `state/tabs.ts:144-150` closes tabs for a deleted connection, `:160-167` re-gates every open tab
  behind *Reconnect & load* when a connection goes down, and `project/state/tree.ts:298` refreshes
  the tree on `metadataInvalidated`. A window B whose connection window A just disconnected does the
  right thing already.
- **There is no browser-storage layer to be shared between same-origin windows.**
  `grep -rn "localStorage\|sessionStorage\|BroadcastChannel\|indexedDB"` over `frontend/src` and
  `packages/shared`: zero hits.
- **Tab ids cannot collide across windows.** `crypto.randomUUID()` (`state/tabs.ts:221`, `:353`), and
  `op_log.tab_id` is a plain column with no foreign key (`migrations/0001_init.sql:69-80`), so
  scoping tabs per window (C4) breaks no referential integrity.
- **Two windows staging conflicting edits on the same table cannot corrupt anything.** The staged
  write model is per tab in the renderer (`docs/ARCHITECTURE.md`'s "write model is staged"), and the
  second commit meets `AssertAffectedExactlyOne` (`adapters/sqlmutate.go`) — a visible refusal, which
  is the correct outcome, not a silent overwrite.
- **`SettingsRepo.Set` does not have F7's race.** Unlike `LayoutRepo.Set`, it writes only the leaves
  the caller actually patched, inside one transaction, with no read-then-merge
  (`repos/settings.go:64-115`). Two windows changing two different settings both land.

---

## 4. Decisions

**D1 — A window is a workbench; the app is the account.** The line P8 draws, and the one
`docs/ARCHITECTURE.md` will record (C10):

- **Per window:** the tab set and active tab; the window rectangle; the focused-window menu signals.
- **App-wide:** connections and their live state, settings, the op log, all three cache tiers, the
  metrics readout, the keychain, pre-connect supervision — and panel layout (D3).

Rationale: every app-wide item above is a property of *the one process and the one database*
(`docs/ARCHITECTURE.md`'s Process model: "One process for all connections"), and per-window copies of
them would be inventing divergence, not fixing it. Every per-window item is a property of *this
workbench* and is meaningless shared.

**D2 — The window key is minted by the shell and travels in the window's URL.** Each window gets a
durable key (a UUID) that the shell owns. It is set two ways at creation:
`WebviewWindowOptions.Name = key` (so Go-side code can map a native window back to its key without a
second registry) and `WebviewWindowOptions.URL = "/?window=" + key` (so the renderer can read it
**synchronously** at boot with `new URLSearchParams(location.search).get('window')`, before
`hydrateTabs()` runs).

Rejected: `Window.Name()` from `@wailsio/runtime` (`window.ts:376`). It is an async round trip that
`bootstrap()` would have to await before hydrating, and it is not reliable across build modes —
`getTargetWindow` falls back to `Window.GetAll()[0]` when no window id is resolvable
(`messageprocessor.go:148-156`), and in `-tags server` builds the window is a per-client
`BrowserWindow` named `browser-N` created only once the runtime WebSocket has registered
(`websocket_server.go:86`, `browser_window.go:22-33`). A URL parameter has none of those failure
modes and degrades to a documented default.

Rejected: reading the window off the bound call's `context.Context`
(`ctx.Value(application.WindowKey)`, `messageprocessor_call.go:16`, `:136`). It works, but it would
force `internal/bridge` to import `pkg/application`, breaking P56 D1.

Absent or unrecognised `?window=`, the renderer uses the key `"main"`. That is what `tests/ui`
(which serves the bundle over a plain static file server) and `tests/e2e-real` (a plain Chromium tab)
will see, so both tiers keep working unchanged with a single implicit workbench.

**D3 — Tabs and the window rectangle become per-window; panel layout stays app-wide and gains a
broadcast.** Panels are a *preference* — "how I like a workbench laid out" — in the same family as
font size and row density, which are already app-wide and already broadcast. Making them per-window
would mean a second `ui_layout` dimension for no user-visible gain. But "app-wide" is only true if
the windows agree, so `LayoutService.Set` starts emitting `kira:layout:changed` with the merged
layout, exactly as `SettingsService.Set` already does (F7's second half). C7.

**D4 — A new `0002_p8_windows.sql`, not an edit to `0001_init.sql`.** `migrations/embed.go:1-6`
records that five original migrations were collapsed into one because the app has never shipped —
but the runner is version-gated (`storage/migrate.go:49-52`), so a developer's existing
`~/.kira-studio/kira.sqlite` is already at version 1 and would silently never receive an edited
`0001`. A second file is the only correct answer, and the runner already supports the list
(`migrations/embed.go:26-32`).

```sql
CREATE TABLE windows (
  key         TEXT PRIMARY KEY,
  "order"     INTEGER NOT NULL,
  bounds_json TEXT
);
INSERT INTO windows (key, "order", bounds_json)
  SELECT 'main', 0, (SELECT value FROM ui_layout WHERE key = 'window.bounds');
ALTER TABLE tabs ADD COLUMN window_key TEXT NOT NULL DEFAULT 'main'
  REFERENCES windows(key) ON DELETE CASCADE;
CREATE INDEX tabs_window ON tabs(window_key, "order");
```

Foreign keys are on (`storage/db.go:35`), so `ON DELETE CASCADE` is real. The existing
`ui_layout` `window.bounds` leaf becomes inert; it is removed from `LayoutRepo`'s leaf list and
from `model.Layout`, and the stale row is left in place as a documented orphan exactly like
`advanced.engineMemoryCapMb` (`docs/ARCHITECTURE.md`:459-464) — the same judgement, for the same
reason.

**D5 — A window's row is deleted when it closes only if another window remains.** This is the one
rule that makes the model match both macOS convention and today's observable behaviour:

- Close a window while others are open → that workbench is finished; delete its `windows` row, which
  cascades its tabs. The user closed it; its tabs should not reappear.
- Close the *last* window → `ApplicationShouldTerminateAfterLastWindowClosed: false` (P56 D10) keeps
  the app alive, and a Dock click must bring the same workbench back with its tabs — exactly what
  happens today. So keep the row, and have `AttachReopen` reopen the highest-`order` row that has no
  live window.

**D6 — Focused-window delivery is `win.DispatchWailsEvent`, not `EmitEvent` plus a sender filter.**
`appcore.Emitter` gains `EmitFocused(name string, data any)`; `internal/shell/app.go` implements it
as `app.Window.Current()` → `(*WebviewWindow).DispatchWailsEvent(&application.CustomEvent{Name:…,
Data:…})`, falling back to nothing when there is no key window. `bridge.Events.Signal` switches to
it; the five *state* broadcasts (connection state, metadata invalidated, connections changed,
settings changed, op update, app metrics) and `ChannelFlushBeforeClose` stay on `Emit`.

Rejected: `(*WebviewWindow).EmitEvent`, which sets `CustomEvent.Sender` to the window name and then
broadcasts anyway (`webview_window.go:240-260`), leaving every other window to filter on
`ev.sender` (the field does reach JS — `events.ts:76`, `:96-97`). That wakes every renderer to
discard the event, and it puts the correctness of a destructive action (Close Tab) in the hands of a
renderer-side string comparison rather than the delivery layer.

**D7 — The quit handshake counts acks per live window, under the same single 2 s cap.**
`Quitter` gains a per-window pending-ack set, seeded from the window keys live at the moment
`flushThenQuit` runs, and `LifecycleService.Flushed` gains the caller's window key so an ack can be
attributed. Teardown proceeds when the set empties **or** the existing 2 s timeout fires — one
timeout for the whole handshake, not one per window, matching today's `2*time.Second`
(`main.go:178`) and Electron's own single `FLUSH_TIMEOUT_MS`. A window that closes mid-handshake is
removed from the set rather than being waited out.

**D8 — *New Window* is `CmdOrCtrl+Shift+N`, in the Window section, above *Close Window*.**
`CmdOrCtrl+N` is `app.newConnection` and is not being taken away — it is the more frequent action in
a database client, and renaming or remapping it would be a UX change this row does not authorise.
The binding is added to `packages/shared/domain/shortcuts.ts` (`window.new`, `global: true`) and
mirrored in `internal/shell/accel.go`'s `Shortcuts` table, which exists to be diffed against it
(`accel.go:37-38`).

**D9 — No per-window settings, connections list, or op log.** §0.3, D1.

**D10 — A second window opens cascaded, not stacked.** A new workbench with no stored rectangle
inherits the *focused* window's size and is offset by one title-bar step (`+24, +24`), clamped so it
stays on the same screen; a workbench restored from its own `windows` row uses its stored rectangle
verbatim. Without this, F5's fix still produces two windows a user cannot tell apart on first
launch.

**D11 — `Options` takes the window's own record.** `shell.Options(d WindowDeps, sec
SecurityOptions, w model.WindowRecord)` — it stops reading `LayoutRepo` for bounds and stops taking a
bare URL string, building `/?window=<key>`, `Name: <key>` and the rectangle from the record it is
given. One signature change, at the one call site, rather than three parameters accreting.

**D12 — Cross-window page staleness is documented, not fixed.** §0.3.

**D13 — Two tests, and only two.** Against AGENTS.md's bar (`concurrency — ordering, backpressure,
cancellation, races` and `cache eviction/invalidation with rules that interact`):

1. **The layout lost-update rule** (C7): concurrent non-overlapping patches must both survive. This
   is a genuine concurrency invariant, it is the one finding that was *measured* rather than argued,
   and a regression would be invisible to every other test. It replaces §1.3(d)'s throwaway probe.
2. **The quit-handshake ack set** (C8): with two windows registered, one ack must not release the
   wait; both acks, or the timeout, must. Ordering + cancellation, and the failure mode is silent
   data loss at shutdown.

Everything else in this phase is wiring, a schema column, or a menu item, and gets no test —
including per-window tab isolation, which `tests/e2e-real` covers end to end for real (§6.2) and
which a repo-level unit test would only restate.

---

## 5. Implementation order

Ten commits. Each is independently reviewable, and the order is chosen so that nothing lands in a
state where one window is worse off than it is today.

### C1 — `feat(shell): a window record, so a workbench is addressable`

- `0002_p8_windows.sql` per D4, added to `migrations/embed.go`'s `names` list.
- `model.WindowRecord{Key string; Order int; Bounds *WindowBounds}` in
  `internal/storage/model/`, with a `Validate()` in the shape the other model types use.
- `repos.WindowsRepo` — `List() ([]model.WindowRecord, error)` (ordered), `Create(rec) error`,
  `SetBounds(key string, b model.WindowBounds) error`, `Delete(key string) error`. Registered in
  `repos.New`/`Repos.Close` alongside the others; no prepared statement (not a hot boot path — the
  list is read once at startup).
- Remove `window.bounds` from `LayoutRepo`'s leaf list (`layout.go:57`, `:109`), from
  `model.Layout`/`LayoutPatch`, and from `packages/shared/domain/layout.ts`. The renderer reads and
  writes neither (`grep layoutState.window` → one `Object.assign` in `state/layout.ts:32` and no
  consumer), so this is a clean delete on that side.
- No behaviour change yet: `main.go` still creates one window.

### C2 — `refactor(shell): per-window wiring, not one global slot`

Fixes F4 without adding a second window yet.

- `shell.Options` takes `model.WindowRecord` (D11) and builds `URL: "/?window=" + key`,
  `Name: key`, and the rectangle from the record.
- `main.go`: replace `var detachWindow func()` and `var mainWindow *application.WebviewWindow` with
  one `windows` registry — key → `{win *application.WebviewWindow, detach func()}` behind a mutex,
  since window creation and `beforeFlush` run on different goroutines.
- `attachDialogs`' window func becomes `app.Window.Current()` with a fallback to any live window, so
  a sheet attaches to the window that asked (F4's second half).
- `beforeFlush` detaches **every** registered window.
- `shell.Attach` persists through `WindowsRepo.SetBounds(key, …)` instead of `LayoutRepo.Set`, so its
  `WindowDeps` gains the key and the repo. Its existing tests move with it, unchanged in intent.

### C3 — `feat(shell): New Window, and windows restored one per stored record`

- `menutemplate.go` gains a fourth `ItemKind`, `ItemNewWindow`, whose `OnClick` calls a
  `MenuDeps.NewWindow func()` — deliberately **not** an `ItemEmit`, because the action belongs in Go
  and must not travel through the renderer (§0.4). Placed in the Window section above `Minimise`,
  with a separator, carrying `Shortcuts["window.new"].Accelerator()`.
- `packages/shared/domain/shortcuts.ts`: `'window.new': { chord: { key: 'N', cmdOrCtrl: true, shift: true }, global: true }`;
  the same row in `internal/shell/accel.go`'s `Shortcuts` map (D8).
- `main.go`: at startup, `WindowsRepo.List()`; if empty, create one record (`key = uuid`, `order 0`,
  no bounds) and persist it; then open one window per record, in order.
- `newWindow(rec)` registers into C2's registry. `openNewWindow()` mints a record with the next
  `order`, applies D10's cascade against `app.Window.Current()`'s rectangle, persists, and opens it.
- `AttachReopen` (`shell/app.go:94-100`) keeps its zero-windows guard but now reopens the
  highest-`order` record with no live window, falling back to minting one (D5).
- A `WindowClosing` listener per window: remove it from the registry, run its `detach`, and
  `WindowsRepo.Delete(key)` **only if another window remains** (D5).
- `menutemplate_test.go` gains the new row (it asserts the template, so it must).

### C4 — `feat(tabs): tabs belong to a window`

- `TabsRepo.List(windowKey)` filters, and `Save(windowKey, records)` scopes its delete:
  `DELETE FROM tabs WHERE window_key = ?`, then inserts with that key. This is the one-line change
  that kills F6.
- `TabsService.List`/`Save` take `windowKey` in their args structs. The generated bindings are
  regenerated (`wails3 generate bindings -b -i -ts` — AGENTS.md's Wails section).
- A `windowKey` that names no `windows` row is rejected with `ipcerr.BadRequest` rather than
  silently writing orphan rows the foreign key would reject anyway with a worse message.

### C5 — `feat(renderer): the window knows which workbench it is`

- `frontend/src/state/window.ts`: `export const windowKey = new URLSearchParams(location.search).get('window') ?? 'main';`
  — read once, at module scope, synchronously (D2).
- `control.tabsList()`/`control.tabsSave()` pass it; `state/tabs.ts` needs no other change, because
  `tabsState.tabs` was always this window's own list.
- `control.appFlushed()` passes it too (D7).

### C6 — `fix(shell): a window flushes its pending tab state before it closes`

Fixes F8, using F8's verified mechanism and avoiding its verified trap.

- New channel `ChannelWindowFlushBeforeClose = "kira:window:flush-before-close"`, delivered to one
  window (D6's `EmitFocused` generalised to `EmitTo(windowKey, name, data)` — the same
  `DispatchWailsEvent` call, resolved by `app.Window.GetByName(key)`).
- `win.RegisterHook(events.Common.WindowClosing, …)`: if this window is not already flushing, mark
  it flushing, `event.Cancel()`, emit the channel, and on a goroutine wait for its ack or a 2 s
  timeout, then `win.Close()`. The `flushing` flag is what stops `Close()`'s own re-emit
  (`webview_window.go:1248-1255`) from looping.
- Renderer: `control.onWindowFlushBeforeClose(...)` runs exactly what `onFlushBeforeClose` already
  does (`state/tabs.ts:131-137`) — cancel the timer, `await tabsSave`, ack. Factor the body out so
  there is one flush routine with two triggers, not two copies.

### C7 — `fix(layout): one transaction, and the other window is told`

Fixes F7.

- `LayoutRepo.Set` opens its transaction first and does its `GetAll`-equivalent read **inside** it
  (`SELECT key, value FROM ui_layout` on the `*sql.Tx`), so merge and write are atomic.
- `LayoutService.Set` emits `ChannelLayoutChanged` with the merged layout, mirroring
  `SettingsService.Set` (`bridge/settings.go`, `events.go:102-104`).
- `state/layout.ts` subscribes and applies, guarding against re-emitting its own patch — the same
  shape `state/settings.ts:43-47` already uses for `onSettingsChanged`.
- **Test (D13.1):** two concurrent `Set` calls patching disjoint leaves; both must survive. One
  comment line above it naming the rule, per AGENTS.md.

### C8 — `fix(lifecycle): quit waits for every window's flush, not the first`

Fixes F3, restoring `18fe7bb^:src/main/index.ts:47-60`'s behaviour (D7).

- `Quitter` swaps `ackOnce`/`flushed` for a mutex-guarded `map[string]struct{}` of window keys
  still owing an ack, plus one `chan struct{}` closed when it empties. Seeded by a
  `LiveWindowKeys func() []string` the `Quitter` is constructed with.
- `Flushed(windowKey string)` removes one key; an unknown or repeated key is a no-op, keeping
  today's "a late ack is not a panic" property (`quit.go:67-69`).
- `LifecycleService.Flushed` and its `Flusher` interface take the key.
- The single 2 s cap and the `sync.OnceFunc` teardown ordering are unchanged.
- **Test (D13.2):** two registered keys; one ack does not release; both do; and the timeout path
  still releases with one outstanding. It lives in `internal/shell/quit_test.go`, which already has
  the emitter/order recorders this needs (`quit_test.go:16-73`).
- While here, fix one line of stale prose the commit necessarily touches: `bridge/lifecycle.go:3`
  claims *"lifecycle\_test.go uses a recorder"* and `bridge/events.go:39` claims *"events\_test.go
  can drive them"* — neither file exists (`ls internal/bridge/*_test.go` → `connections_test.go`,
  `files_test.go` only). Both were pruned against AGENTS.md's test bar and the comments were left
  behind. Correct the two sentences rather than resurrecting the files.

### C9 — `fix(menu): a menu command goes to the focused window`

Fixes F2, last of the behavioural commits so it lands on a tree where a second window actually
exists to prove it against.

- `appcore.Emitter` gains `EmitFocused(name string, data any)` and `EmitTo(windowKey string, name string, data any)`;
  `internal/shell/app.go`'s `emitter` implements both over `app.Window.Current()` /
  `app.Window.GetByName` + `DispatchWailsEvent` (D6).
- `bridge.Events.Signal` uses `EmitFocused`. The six state broadcasts and
  `ChannelFlushBeforeClose` keep `Emit` — stated in a comment, because the split is the whole point
  of the commit.
- `internal/shell/quit_test.go`'s `quitEmitter` (`:16-33`) is the one existing `appcore.Emitter`
  double in the tree; it gains the two new methods so the package still compiles. No new test — C9
  is a delivery-target change whose only honest proof is §6.3 step 3, on a Mac with a menu bar.

### C10 — `docs(architecture): what is per-window and what the app shares`

- A short subsection under Process model: D1's split, the `?window=` key mechanism (D2), the
  `windows` table and D5's close rule, and the focused-vs-broadcast channel split (D6) with the
  reason (`sendToFocusedWindow`'s successor).
- The Storage section's schema block gains `windows` and `tabs.window_key`, and the "known,
  deliberate orphan" paragraph gains the now-inert `ui_layout` `window.bounds` row (D4).
- The Invariants list's "renderer opens no window" line gets one clause: the *shell* opens windows,
  on a menu command; the renderer still cannot (§0.4).

---

## 6. Verification

### 6.1 What this sandbox can actually prove

Run after every commit:

```
go build ./apps/kira-studio/...
go vet ./apps/kira-studio/internal/...
go test ./apps/kira-studio/internal/...          # includes internal/shell, which runs here
bun run lint && bun run typecheck
bun run test:unit
bun run test:ui                                  # 36 tests, 18 spec files, real WebKit
bun run test:ipc:fe
```

`internal/shell` is the load-bearing one: it compiles and runs on Linux (§1.3), so C1-C3, C6, C8 and
C9's Go halves are all exercised here, including real `*application.WebviewWindow` values and real
`WindowsRepo`/`LayoutRepo`/`TabsRepo` writes against a temp `KIRA_HOME`.

`bun run test:ui` must stay green **unchanged**: it serves the bundle from a static file server with
no `?window=` parameter, which is exactly D2's `"main"` fallback path. If a `tests/ui` spec needs
editing for this phase, that is a signal the fallback is wrong, not that the spec is stale.

### 6.2 The two-client `-tags server` harness — the real multi-window proof this box *can* run

`go build -tags server ./apps/kira-studio` succeeds here, and §1.3(c)/(e) already used it to
reproduce F6 and to clear the data plane. `tests/e2e-real` is built on the same tag
(`docs/ARCHITECTURE.md`'s Testing section) and runs `workers: 2` with a per-test `KIRA_HOME` and
`WAILS_SERVER_PORT`. That makes a **two-page, one-backend** test genuinely available in this
sandbox, and it is where C4/C5 get their end-to-end proof:

> **New: `apps/kira-studio/tests/e2e-real/multiwindow-real.spec.ts`** (sqlite, so it needs no
> container — `sqlite-real.spec.ts`'s own Docker-free precedent). One backend; two browser contexts
> navigated to `/?window=w-one` and `/?window=w-two`. Open a table in page one and a *different*
> table in page two; assert each page's tab strip shows only its own tab, then reload both and assert
> each restores only its own. Against the pre-C4 tree this fails by showing the other page's tab (or
> none); against the post-C4 tree it passes. That is F6's regression guard, at the real wire
> boundary, with no mocking.

Its limits, stated plainly: `-tags server` has no native window, so it proves the **storage and
bridge** half of multi-window and nothing about menus, focus, sheets or window rectangles. Those are
§6.3's job.

### 6.3 What a human must run on a real Mac, once

Same discipline as P7 §7.2. Build and launch normally (`bun run setup && bun run dev`, or a packaged
build). Every step below is a claim this sandbox cannot check.

1. **A second window opens at all.** *Window → New Window* (⇧⌘N). Expect a second window,
   **offset** from the first, not stacked on it (D10). Record both rectangles.
2. **Windows restore.** Move and resize both windows, open two different tables in window 1 and one
   in window 2, quit (⌘Q), relaunch. Expect: two windows, each at its own rectangle, each with its
   own tabs and no cross-contamination. *(This is F5 + F6 together, and it is the single most
   important step.)*
3. **Menu commands go to the focused window only.** With both windows open and window 2 focused:
   press ⌘W. Expect window 2's active tab to close and **window 1 to be untouched**. Repeat for
   ⌃Tab, ⌘, (Settings), ⌘N (New Connection), ⌘B, ⌘J. Then focus window 1 and repeat one of them to
   confirm the target follows focus. *(F2.)*
4. **⌘↩ does not run in the background window.** Open a console tab in each window with different
   statements. Focus window 1, *View → Run Statement*. Expect exactly one op in the operations panel
   and window 2's console unchanged. *(F2, the reason it is a correctness bug.)*
5. **A file dialog attaches to the calling window.** With two windows open and window 2 focused, run
   an S3 *Download* (or any *Save file…* path) from window 2. Expect the save sheet to drop from
   window 2's title bar, not window 1's. *(F4.)*
6. **Closing a window flushes it.** In window 2, scroll a grid / change a filter, then immediately
   (well under a second) press ⇧⌘W. Relaunch. Expect window 2's scroll position and filter to have
   survived. *(F8.)*
7. **Quit waits for both windows.** In *both* windows, change something debounced (a filter in each)
   and immediately ⌘Q. Relaunch. Expect **both** windows' changes to have survived. Check
   `~/.kira-studio/logs/` for the absence of `quit flush timed out`. *(F3.)*
8. **Close-the-last-window still restores.** Close both windows (the app stays running — P56 D10),
   then click the Dock icon. Expect the last-closed workbench back, with its tabs. Then quit and
   relaunch: expect the same. *(D5.)*
9. **Panel layout agrees across windows.** Toggle the project panel in window 1 (⌘B or the toolbar).
   Expect window 2 to follow immediately. Drag the project panel width in window 1 and the cell
   editor height in window 2 at the same time; relaunch; expect **both** to have survived. *(F7.)*
10. **The metrics readout accounts for the second window.** Note the status bar's memory figure with
    one window; open a second and give it ~10 s. Expect the figure to rise by roughly one WebKit
    content process' footprint and to be the **same number in both windows**, not two independent
    readouts. Cross-check against Activity Monitor's Memory column summed over the Kira Studio
    process group, per P7's own convention. *(§3's metrics row; P7 §0.3's handoff.)*
11. **Nothing regressed with one window.** Quit, relaunch with a single window, and run P7 §7.2's
    own single-window checks plus an ordinary open-table/paginate/filter pass.

Record the outcome in this plan's §7 checklist, the way P7's own closeout commit did.

### 6.4 What must not regress

- **A single-window session behaves exactly as before**, including session restore, the quit
  handshake, and window bounds persistence. Steps 8 and 11 above.
- **`internal/bridge` still imports no Wails.** `grep -rn "wailsapp/wails" apps/kira-studio/internal/bridge/`
  must stay empty (P56 D1, §0.4).
- **The renderer still opens no window.** `grep -rn "window.open\|target=\"_blank\"" apps/kira-studio/frontend/src packages/shared`
  must stay empty, and `Harden()` unchanged (`docs/ARCHITECTURE.md`'s Renderer security surface).
- **The data plane is untouched.** No edit to `internal/adapterhost/`, `bridge/stream.go`, or
  `frontend/src/bridge/port.ts` should be needed by any commit in §5; if one seems to be, re-read §3
  first.
- **`bun run test:ui` and `bun run test:ipc:fe` pass with no spec edits** (§6.1).
- **Cache behaviour is unchanged**: `PageCacheKey`/`countKey` gain no window discriminator (§3).

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — `windows` table, `WindowRecord`, `WindowsRepo`; `window.bounds` removed from `ui_layout`'s
      leaf set and from the shared `Layout` type.
- [ ] C2 — per-window registry in `main.go`; `Options` takes a `WindowRecord`; dialogs attach to the
      current window; `beforeFlush` detaches every window.
- [ ] C3 — *New Window* (⇧⌘N) in the Window menu; startup opens one window per stored record;
      reopen and close follow D5.
- [ ] C4 — `tabs.window_key`; `TabsRepo`/`TabsService` scoped; bindings regenerated.
- [ ] C5 — the renderer reads `?window=` synchronously and passes it on tabs list/save and the flush
      ack.
- [ ] C6 — per-window close flush, with the one-shot hook that does not loop against `Close()`.
- [ ] C7 — `LayoutRepo.Set` merges inside its transaction; `kira:layout:changed` broadcast;
      the concurrency test (D13.1).
- [ ] C8 — per-window quit ack set under one 2 s cap; the handshake test (D13.2).
- [ ] C9 — `EmitFocused`/`EmitTo`; `Signal` targets the focused window; the six state broadcasts
      still broadcast.
- [ ] C10 — `docs/ARCHITECTURE.md` records the per-window/app-wide split, the `windows` table, the
      `?window=` key and the inert `window.bounds` orphan.
- [ ] `multiwindow-real.spec.ts` added and passing (§6.2).
- [ ] §6.1's full command set green.
- [ ] §6.3's eleven manual steps run on a real Mac, with the result recorded here.

---

## 8. Open questions, handed forward

**OQ-1 — A Window menu that lists the open windows, and ⌘`.** Deliberately out of scope (§0.3), with
the mechanism recorded so it is not re-derived: Wails maps a submenu item whose `role` is
`application.WindowMenu` onto `[NSApp setWindowsMenu:]` (`menu_darwin.go:118-121`,
`roles.go:16`), and `(*MenuItem).SetRole` (`menuitem.go:307`) is the setter — but `BuildMenu` builds
sections through `Menu.AddSubmenu`, which returns the submenu and discards the item
(`menu.go:102-106`), so the Window section would have to be built via
`application.NewSubMenuItem("Window")` + `Append` instead. The reason it is not done here: every
window is titled `"Kira Studio"` (`internal/shell/window.go:28`), so the list AppKit generates would
be N identical rows. Making it useful needs a per-window title — most likely the active tab's label,
pushed from the renderer — which is a UI decision this row does not cover. **Unverified:** whether
⌘` cycles windows without the windows menu registered; a Mac would settle it in seconds.

**OQ-2 — Should a restored workbench remember which screen it was on?** `WindowsRepo` stores a bare
rectangle, and D10 clamps a *new* window to the focused window's screen — but a restored window
whose display is gone (an undocked laptop) will open off-screen. Wails exposes
`(*WebviewWindow).GetScreen`/`SetScreen` and a `ScreenManager`; the honest answer is probably a
clamp-to-visible-frame at open time. Not in this phase because it is a one-window bug too, and
fixing it here would hide that.

**OQ-3 — Where does *New Window* belong for a database client?** This plan puts it in the Window
menu (there is no File menu). If P9 or a later UI phase introduces a File menu, ⇧⌘N should move
there and ⌘N's ownership (currently *New Connection*) is worth re-litigating at the same time.

**OQ-4 — Cross-window page staleness (D12).** Two windows on the same table, one commits: the other
keeps showing its last read until refreshed. The Go-side L2 entry is already dropped, so nothing
serves stale bytes from cache — but the app has a `kira:connection:metadataInvalidated` broadcast for
exactly this shape of problem on the *tree* side, and a `data:invalidated` sibling carrying
`{connectionId, path}` would let a background window re-gate the affected tabs the way
`state/tabs.ts:160-167` already re-gates on disconnect. Worth doing only if a real user meets it;
recorded so the mechanism is not reinvented.
