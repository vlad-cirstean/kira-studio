# P56 — Native shell parity: the bridge completed, the `engine` Stream, window/menu/security/lifecycle

> Sequences P52's §7.1/§7.2/§8.1–§8.3/§9 against the tree as it stands after P53, P54 and P55.
> P52 §4–§10 are settled and are not reopened here; where this plan departs from P52 it is because
> reading the actual `wailsapp/wails/v3@v3.0.0-beta.15` source (or running it) disproved or refined
> something, and each such case is called out with its evidence. P52 §15: **G1 is the only gate in
> this migration and it passed at 261.7 MB.** No gate here.
>
> Every Wails claim below was read out of
> `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/` — the exact version
> `shell/go.mod` pins — with `file:line` citations, the same way P55 §1.1 cited
> `keybase/go-keychain`. Four of them were additionally **executed** in this sandbox (§1.7); those
> are marked *probed*. `wails.io`/`v3.wails.io` remain 403-blocked from both of this project's
> environments (AGENTS.md, P51), so the module cache is the only source and there was nothing else
> to check against.

## 0. What this phase is, and what it is not

P52's phasing table (line 72) assigns P56: *"The bridge (61 channels), the `engine` Stream, native
shell parity (window/menu/security/lifecycle) — No [`src/` changes]"*. Confirmed by reading that
table for this plan; P55 §7 then narrowed the bridge half by naming exactly what it was handing
over.

Concretely, three bodies of work:

1. **The bridge, finished.** §1.1 counts the 61 channels out of `src/shared/protocol/ipc.ts` itself
   rather than trusting P52 §7.1's own shape table (which does not add up — see §1.1). P55 shipped
   46 of them; P56 owes the remaining 15, of which **two are not in P55 §7's hand-over list**
   (`LayoutService.Set`, `FiltersService.Replace`) and **one is a dead channel that must not get an
   emitter at all** (`kira:engine:state`, §1.9).
2. **The `engine` Stream** — `bridge/stream.go`, the renderer-facing half of P54's already-built
   `Host.AttachStream`/`Host.SendData` data plane, plus the switch of `main.go`'s `resolveEngine()`
   off the P52 ping fixture onto the real bundled engine, because the Stream row cannot be honestly
   exercised against a child that answers only `ping` (D12).
3. **Native shell parity** — a new `internal/shell` package: the window (bounds persistence, the
   cold-start log line), the menu (14 accelerators), the security posture that survives WKWebView,
   and the quit-flush handshake, whose Wails mechanism turns out to be **`Options.ShouldQuit`** and
   whose one non-negotiable constraint is that it must not block (§1.3 — this is the single most
   important finding in this document).

**Not in this phase.**

- **No `src/` change of any kind.** §7 checks this rather than assuming it.
- No renderer rewrite. `src/renderer/bridge/` and `src/preload/index.ts` are P57's row. The one
  renderer-adjacent file P56 touches is `shell/frontend/shim/kira-bridge.ts`, which is under
  `shell/`, not `src/` (D11).
- No packaging, no signing, no `scripts/verify-packaging.sh` rewrite, no `docs/` updates — P52 §10
  and §14 assign those to P57.
- No test-tier work (`tests/ui/`, the webkit tier) — P52 §12.3, P57.

## 1. What reading the current tree and the real Wails source found

### 1.1 The 61 channels, counted — and the three surprises in the count

P52 §7.1's shape table says 43 request/response + 17 push + 1 fire-and-forget + 1 port. That is 62,
and it is wrong in both directions. Counted directly out of `src/shared/protocol/ipc.ts:21-86`, the
`IPC` const has **exactly 61 keys**:

| Group | Count | Status after P55 |
|---|---:|---|
| `appInfo`, `engineStatus` | 2 | done (P52 M1) |
| `settingsGetAll`, `layoutGetAll`, `tabsList`, `tabsSave`, `filtersList`, `opsRecent` | 6 | done (P52 M1) |
| 12 × `connections*`, 4 × `tree*` | 16 | done (P55) |
| **`settingsSet`, `layoutSet`, `filtersReplace`, `opsCancel`** | **4** | **P56** |
| **`filesChooseSave`, `filesChooseOpen`** | **2** | **P56** |
| **9 × `queries*`** | **9** | **P56** |
| **`appFlushed`** (renderer→Go, fire-and-forget) | **1** | **P56** |
| **`port`** (the `MessagePort` transfer) | **1** | **P56**, as the `engine` Stream |
| Go→renderer push | **20** | **P56** (19 live, 1 dead — below) |
| | **61** | |

Three things this count establishes that the plan text before it did not:

1. **There are 20 push channels, not 17.** P52 §7.1 names `kira:connection:state`,
   `kira:settings:changed`, `kira:op:update`, `kira:app:metrics`, `kira:engine:state`,
   `kira:open-settings` and the 11 `kira:menu:*` — 17. It omits
   `kira:connection:metadataInvalidated`, `kira:connections:changed` and
   `kira:app:flush-before-close`, all three of which are real Go→renderer pushes
   (`src/main/index.ts:99-102`, `:58`). `bridge/events.go` owns 20 constants.
2. **`kira:engine:state` is a dead channel.** Grepped for this plan: it has **zero emitters in
   `src/main`** and **zero subscribers in `src/renderer` beyond `bridge/control.ts`'s own
   pass-through wrapper** (`control.ts:52`, `onEngineState`, called by nothing). The status bar gets
   its liveness from `engineState.status` in `src/renderer/workbench/state/engine.ts`, which pings
   over the data channel. **P56 must not invent an emitter for it** — that would be new behaviour
   dressed up as parity. It is recorded here as a channel P57 should delete from `ipc.ts`.
3. **P55 §7's hand-over list is not exhaustive.** It names `bridge/events.go`, `bridge/stream.go`,
   `bridge/files.go`, `bridge/queries.go`, `bridge/lifecycle.go`, `SettingsService.Set` and
   `OpsService.Cancel`. Reading the current `shell/internal/bridge/` shows `layout.go` has only
   `GetAll` and `filters.go` only `List` — **`LayoutService.Set` and `FiltersService.Replace` are
   missing too**, and both have real renderer callers (`src/renderer/bridge/control.ts`,
   `src/main/ipc/layout.ts:11`, `ipc/filters.ts:18`). They are in this phase.

### 1.2 Wails dialogs: P55 §6.2's hand-over is accurate, and four things it could not know

P55 §6.2 read `dialog_manager.go` and `dialogs.go` for P56 and recorded the API surface. Re-checked
against the pulled module for this plan: **the surface it recorded is correct and unchanged**
(`dialog_manager.go:16-36`; `dialogs.go:262/279/287/316/247/257` for open, `:423/451/456/461/479`
for save). Four further facts came out of the platform implementation, which P55 did not read, and
each changes the port:

1. **Cancel is signalled by an empty string, not a flag.** `showSaveFileDialog`'s completion handler
   passes `NULL` unless `result == NSModalResponseOK` (`dialogs_darwin.go`, the
   `static void showSaveFileDialog` body), `saveFileDialogCallback` turns that into
   `C.GoString(nil)` = `""`, and `PromptForSingleSelection` returns `("", nil)`
   (`dialogs.go:461-472`). Open is the same shape: on cancel `processOpenFileDialogResults` sends
   nothing and `openFileDialogCallbackEnd` closes the channel, so the receive yields `""`
   (`dialogs_darwin.go`, `processOpenFileDialogResults` / `openFileDialogCallbackEnd:559-572`).
   So `canceled` is `path == ""`, and there is no other signal.
2. **The save dialog has no filters and no title on macOS.** `SaveFileDialogStruct` carries
   `filters` and `title` fields and exposes `AddFilter`/`SetOptions` for them (`dialogs.go:381-429`),
   but `showSaveFileDialog` is passed only `message`, `directory`, `buttonText` and `filename` — the
   filters and the title are never read on darwin. `AddFilter` on a save dialog is a silent no-op.
   This costs us nothing (`ipc/files.ts`'s `chooseSave` passes only `defaultPath`), but it means the
   port must not pretend otherwise.
3. **The open dialog flattens every filter into one extension set.** `macosOpenFileDialog.show`
   splits each `FileFilter.Pattern` on `;`, strips a leading `*.` from each component, and joins
   **all filters' components** into a single `;`-separated string
   (`dialogs_darwin.go`, `func (m *macosOpenFileDialog) show`). Electron's
   `filters: [{name, extensions}]` groups — which macOS renders as a dropdown — do not survive. One
   `AddFilter` call with every extension is therefore the honest translation, not one per group.
4. **There is no `*` wildcard.** `OpenPanelDelegate.panel:shouldEnableURL:`
   (`dialogs_darwin_delegate.m:29-37`) enables a file only when its name `hasSuffix:` `"." + ext`
   for some allowed extension; `"*"` would mean "ends with `.*`". And `"*"` is not a valid
   `UTType` filename extension, so it also lands in the `setAllowedFileTypes:` legacy array
   alongside a `setAllowedContentTypes:` call. **`src/renderer/project/ConnectionDialog.vue:246-251`
   passes exactly this** — `{name: 'All files', extensions: ['*']}` as its second filter — so a
   verbatim translation would break the SQLite file picker's escape hatch. `shouldEnableURL`
   returns `YES` for everything when `allowedExtensions` is empty
   (`dialogs_darwin_delegate.m:19-21`), so the correct translation of "one of the filters is `*`" is
   **no filter at all** (D8).

`app.getPath('downloads')` still has no Wails analogue: `EnvironmentManager` exposes `Info`,
`IsDarkMode`, `GetAccentColor`, `OpenFileManager`, `HasFocusFollowsMouse` and nothing else
(`environment_manager.go:23-58`). `filepath.Join(home, "Downloads")` stands, as P55 §6.2 said.

### 1.3 The quit-flush handshake: `ShouldQuit` is the mechanism, and it must not block

P52 §8.3 designed `Lifecycle.RequestQuit()` as *"emits `kira:app:flush-before-close`, waits on a
channel with a `time.After(2 * time.Second)` fallback, then runs shutdown … then `app.Quit()`"*, and
flagged as **the one lifecycle detail needing live macOS verification** whether Wails' `role: quit`
and AppKit's own Cmd+Q would bypass a custom handler. Read from source, both halves resolve — one of
them the opposite way round from the design.

**There is a real `before-quit` analogue, and it covers every quit path.**
`application.Options.ShouldQuit func() bool` (`application_options.go:91-94`) is consulted by
`App.shouldQuit()` (`application.go:1029-1034`), which is called from the exported
`shouldQuitApplication()` (`application_darwin.go:783-787`), which is called by the app delegate's
`applicationShouldTerminate:` — returning `NSTerminateCancel` when it is false
(`application_darwin_delegate.m:60-67`). Because it hangs off `applicationShouldTerminate:`, it
covers **Cmd+Q, the Apple-menu Quit item, the Dock's Quit, and `App.Quit()` itself** —
`App.Quit()` is `InvokeSync(a.impl.destroy)` (`application.go:961-965`) and `macosApp.destroy` is
`[NSApp terminate:nil]` (`application_darwin.go`, `static void destroyApp`). The Linux path is the
same shape (`application_linux.go:126`), so `wails3 task dev` on this sandbox exercises it too.
This is strictly better than P52 §8.3's design, which could only have covered the paths that route
through our own menu item.

**But `ShouldQuit` runs on the main thread, and blocking it deadlocks the very ack it is waiting
for.** The chain is synchronous cgo from `applicationShouldTerminate:`, so for as long as
`ShouldQuit` has not returned, the main run loop is stopped. Two things the handshake needs travel
through that run loop:

- **The renderer's ack.** `Lifecycle.Flushed()` is an ordinary bound call, which arrives as an HTTP
  request over the registered `wails://` scheme; on darwin the scheme handler's exported entry point
  is `processURLRequest` (`application_darwin.go:431-445`), a **main-thread** cgo callback that
  hands the request to the `webviewRequests` channel for a worker goroutine
  (`application.go:404`, `:705-710`). No main thread, no `Flushed()`.
- **The `kira:app:flush-before-close` emission.** `EventManager.Emit`
  (`event_manager.go:31-45`) → `EventProcessor.Emit` (`events.go:144-172`) → the frontend mailbox →
  `WebviewWindow.DispatchWailsEvent` (`webview_window.go:1443`) → `enqueueEventJS`, which ends at an
  `InvokeSync(execJS)` on the main thread.

And the ack is not cheap: `src/renderer/state/tabs.ts:131-137` responds to `onFlushBeforeClose` by
**awaiting a `tabsSave` round trip** before calling `appFlushed()` — a second bound call that also
needs the main thread. A blocking `ShouldQuit` would guarantee the 2 s timeout every single time and
lose exactly the debounced save the handshake exists to protect.

**So the port is Electron's own shape, not P52 §8.3's:** `ShouldQuit` returns **false** on the first
call (`preventDefault()`), kicks the flush off on a goroutine, and calls `app.Quit()` again when the
teardown is done; the second `ShouldQuit` sees a completed flag and returns true. §4.6 gives the
code. `App.Quit()`'s `InvokeSync` never returns on that second pass because `[NSApp terminate:]`
does not return — the same way Electron's `app.quit()` behaves, and harmless.

**The custom Quit menu item is still required, but for a different reason.** On darwin a `MenuItem`
whose `role` is `Quit` gets `menuItem.action = terminate:` from
`roleToSelector[Quit]` (`menuitem_selectors_darwin.go:19`, applied at
`menuitem_darwin.go:415-424`), so its Go `OnClick` — which `NewQuitMenuItem` sets to
`globalApplication.Quit()` (`menuitem_roles.go`, `NewQuitMenuItem`) — **never fires**. That does not
break the handshake any more (`terminate:` goes through `applicationShouldTerminate:` anyway), but
it does mean a role-based Quit item cannot carry app-specific behaviour. P56 uses a plain custom
item (no role, so `menuItem.action = handleClick`, `menuitem_darwin.go:27`) with the Cmd+Q
accelerator, calling the same `Quitter.RequestQuit()` — belt and braces, and the only way the item's
own label and click path stay ours.

### 1.4 The menu: two translation traps, one of them proven by running it

- **`Control` is not a valid Wails modifier.** `modifierMap` (`keys.go:55-65`) accepts
  `cmdorctrl`/`cmd`/`command`, `ctrl`, `optionoralt`/`alt`/`option`, `shift`, `super` — and nothing
  else. `src/shared/domain/shortcuts.ts:67-75`'s `chordToAccelerator` emits the literal
  `"Control"` for `ctrl: true`, which `tab.next` and `tab.prev` both set. A verbatim port therefore
  produces `"Control+Tab"`, which `parseAccelerator` rejects — and `SetAccelerator` **logs the error
  and returns the item unchanged** (`menuitem.go:275-287`), so the two tab-switching accelerators
  would silently not exist. *Probed* (§1.7): `SetAccelerator("Control+Tab")` logs
  `invalid accelerator: 'Control' is not a valid modifier` and leaves `GetAccelerator() == ""`;
  `"Ctrl+Tab"` yields `"Ctrl+TAB"`. §4.2's builder maps `ctrl` → `Ctrl`.
- **`UnHide` is a dead role on macOS.** `roleToSelector` has `ShowAll: "unhideAllApplications:"`
  but no entry for `UnHide` (`menuitem_selectors_darwin.go:14-19`), while `NewRole(UnHide)` returns
  `NewUnhideMenuItem()` — a plain "Show All" item with no click handler
  (`menuitem_roles.go`, `NewUnhideMenuItem`). Wails' own `NewAppMenu()` uses `UnHide` (`roles.go`,
  `NewAppMenu`), so copying the stock app menu reproduces the bug. Electron's `role: 'unhide'`
  (`src/main/menu.ts:31`) maps to `ShowAll`, and that is what §4.2 uses.

Everything else in `menu.ts` has a working analogue: `About`, `ServicesMenu`, `Hide`, `HideOthers`,
`Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `SelectAll`, `Minimise`, `Zoom`, `CloseWindow`, `Reload`,
`OpenDevTools` are all in `roles.go:13-63` with real selectors or real callbacks.

Two mechanical points the API forces:

- **`*Menu` has no exported "append this item".** It offers `Add(label) *MenuItem`,
  `AddRole(Role) *Menu`, `AddSubmenu`, `AddSeparator`, `Append(*Menu)` and package-level
  `NewMenuFromItems(item, …)` (`menu.go:45-108`, `:220-243`). Two items need to be built before
  being appended — the custom Quit item, and the `CloseWindow` role item re-accelerated to
  Cmd+Shift+W (`menu.ts:120-122`'s deliberate remap, which must survive per P52 §8.2). §4.2 has a
  three-line `addItem` helper over `Append(NewMenuFromItems(item))`.
- **The menu must be built after `application.New`.** `NewQuitMenuItem`, `NewHideMenuItem` and
  `NewAboutMenuItem` all read `globalApplication.options.Name` (`menuitem_roles.go`), and
  `globalApplication` is assigned inside `New` (`application.go:56`). Install it with
  `app.Menu.Set(menu)` (`menu_manager.go:16-25`).
- Menu callbacks run **on their own goroutine** (`menuitem.go:270-274`, `go func(){ m.callback(ctx) }()`),
  so a menu item may emit an event or start the quit flush without any main-thread hazard.

**DevTools is a build tag on macOS, not an option.** `WebviewWindowOptions.DevToolsEnabled` exists
(`webview_window_options.go:216`) but darwin calls `w.enableDevTools()` unconditionally
(`webview_window_darwin.go:1667`); the implementation is `//go:build … (!production || devtools)`
(`webview_window_darwin_dev.go:1`, setting `developerExtrasEnabled`) against an empty
`//go:build … production && !devtools` stub (`webview_window_darwin_production.go`). Likewise
`NewOpenDevToolsMenuItem()` returns `nil` under `production` (`menuitem_production.go`). The repo's
own `build/darwin/Taskfile.yml` already passes `-tags production` for a non-`DEV` build
(`build:native`'s `BUILD_FLAGS`), so `devTools: !app.isPackaged` is **already satisfied
structurally** — `config.IsDev()` is not the mechanism and must not be presented as one (§4.4).

### 1.5 Window bounds

`WebviewWindowOptions` carries `X`, `Y`, `Width`, `Height`, `MinWidth`, `MinHeight`,
`BackgroundColour`, `Hidden`, `URL` (`webview_window_options.go`), so a stored rectangle goes in at
creation with no post-hoc `SetBounds`. Reading it back: `WebviewWindow.Bounds() Rect`
(`webview_window.go:1061-1071`), `Rect{X, Y, Width, Height int}` (`screenmanager.go:42-47`) — note
`int`, against `model.WindowBounds`'s `float64` (which mirrors Electron's own
`BrowserWindow.getBounds()` shape and the `ui_layout` JSON already on disk); the conversion is
explicit and lossless in the direction that matters.

`Bounds()` is an `InvokeSync` (`webview_window.go:1065-1069`), so it must never be called from the
main thread while the main thread is blocked — but window-event callbacks run on their own goroutine
(`application.go:698-701`, `go a.handleWindowEvent(event)`), so the debounced persister is safe.

The events are `events.Common.WindowDidResize` (1032), `WindowDidMove` (1031) and `WindowClosing`
(1030) (`pkg/events/events.go:15-17`, `:52-54`), registered with
`win.OnWindowEvent(type, cb) func()` (`webview_window.go:942-965`).
`events.Common.WindowRuntimeReady` (`webview_window.go:843`, emitted on the frontend's
`wails:runtime:ready` message) is the analogue of `did-finish-load` and is where
`window.ts:32-34`'s cold-start log line goes.

One caveat, honestly stated: on darwin the delegate posts window notifications guarded by
`hasListeners(...)`, and `hasListeners` has **no `//go:build darwin` Go export anywhere in the
module** — the only `//export hasListeners` is in `application_ios.go:451`. `application.go:884`'s
own comment says *"On darwin hasListeners always returns true today"*, which is consistent with the
notifications being posted unconditionally there. The practical consequence is that registration
order does not gate delivery on macOS; it is still a source-read inference, and §6 lists it as a
macOS check owed.

### 1.6 Security posture under Wails: what exists, what is another platform's, what has no subject

P52 §9 wrote this table from prior knowledge and asked for verification on a real build. Verified
against the module here, which changes three rows:

| `security.ts` | Wails v3.0.0-beta.15, read | Verdict |
|---|---|---|
| `contextIsolation` / `sandbox` / `nodeIntegration: false` | No analogue, no subject — there is no Node in the webview | Strictly better, as P52 said |
| `devTools: !app.isPackaged` | **A build tag, not an option** (§1.4). `-tags production` already set by `build/darwin/Taskfile.yml` | Ports, by a different mechanism |
| Permission request/check handlers, clipboard allowlist | `WebviewWindowOptions.Permissions map[PermissionType]Permission` exists, with a `PermissionClipboardRead` constant (`webview_window_options.go:195`, `:308-312`) — but `resolvePermission` is implemented **only** in `permissions_linux.go` and `webview_window_windows.go:2175-2190`. **Zero darwin references.** | **Inert on macOS.** The option is set anyway (it is correct on Linux, where `wails3 task dev` runs) but the real clipboard answer is WebKit's own gesture heuristics — §6's macOS check |
| `window.open` deny | `MacWebviewPreferences.JavaScriptCanOpenWindowsAutomatically` (`webview_window_options.go`, `MacWebviewPreferences`); no `WKUIDelegate createWebViewWithConfiguration:` in `webview_window_darwin.m` | Partial: JS-initiated windows can be denied; there is no per-request handler |
| `will-frame-navigate` lock to the base URL | No navigation-policy delegate at all on darwin (grepped `webview_window_darwin.m` for `decidePolicy`: nothing) | **No analogue.** Stated as a loss, not papered over |
| `webviewTag: false` | No subject | Gone |
| `spellcheck: false` + `setSpellCheckerEnabled(false)` | **No spellcheck control anywhere in the module** (grepped: zero hits for `SpellCheck`/`spellCheck`/`automaticSpelling`) | **No analogue.** Mitigation stays in the renderer (`spellcheck="false"` on the field), which is P57's row |
| `webgl: false` | No analogue | Gone |
| The 7 `disable-*` Chromium switches | No subject | Gone |
| `grantFileProtocolExtraPrivileges` | No subject — assets are served through a registered scheme, not `file://` | Gone, and the whole class with it |
| — | `DefaultContextMenuDisabled` (`webview_window_options.go:222`) reads plausible but is referenced **only** from `webview_window_windows.go:2551` | Windows-only; do not claim it |

So `internal/shell/security.go` is small and mostly honest documentation of what is gone. What it
*does* is: set `Permissions` to deny everything except `PermissionClipboardRead`, set
`JavaScriptCanOpenWindowsAutomatically` false, leave `EnableFileDrop` false, leave
`OpenInspectorOnStartup` false, and carry the comment block explaining every row above.

### 1.7 Events and streams are testable in-process, without a display *(probed)*

Four things were **executed** in this sandbox (a scratch `internal/probe` package, since removed;
`go test`, Linux, no X server):

1. `application.New(application.Options{Name: "Kira Studio"})` runs in a plain `go test` with no
   display. It logs `AssetServer Info` / `Build Info` / `Platform Info` and returns a usable `*App`.
2. A menu can be built and asserted without `Run()`: `NewMenu()`, `AddSubmenu`, `AddRole`,
   `Add(label).SetAccelerator(...)`, `GetAccelerator()` all work. This makes **a real Go analogue of
   `tests/unit/menu.spec.ts` possible**, which P52 §13's `shell` row asks for and which nothing in
   the plan record had established was reachable.
3. `app.Event.Emit(name, data)` is **observable in-process** via `app.Event.On(name, cb)` —
   `EventProcessor.Emit` dispatches to Go listeners on a goroutine (`events.go:167-170`) quite
   independently of any window. Observed payload for
   `Emit("kira:app:metrics", map[string]any{"cpuPercent":1.5,"memoryBytes":42})` was
   `{"cpuPercent":1.5,"memoryBytes":42}`. So the emitter adapter has a real test, not a mocked one.
4. `app.HandleStream("engine", handler)` registers before `Run()` (`stream.go:719-726`) without
   error.

Because `New` short-circuits on a non-nil `globalApplication` (`application.go:49-51`), **a test
binary gets one `*App` for its whole life**. Tests must share it and use distinct event names or
unsubscribe (`On` returns its unsubscribe func).

### 1.8 The cost of importing Wails inside `internal/`: cgo, and how far it spreads

`pkg/application` is cgo on every platform (`linux_cgo.go`, `application_darwin.go`), so any
`internal/…` package that imports it makes `go build ./internal/...` require
`libgtk-4-dev`/`libwebkitgtk-6.0-dev`/`pkg-config` on Linux — ending the property AGENTS.md's P53
finding records (*"`go test ./internal/...` … need nothing but the Go toolchain"*). Today
`internal/bridge` imports no Wails at all (checked: `app.go`, `connections.go`, `engine.go`,
`filters.go`, `layout.go`, `ops.go`, `settings.go`, `tabs.go`, `tree.go` import only `appcore`,
`ipcerr`, `connections`, `tree`, `model`), and P54 D14 kept `enginehost` Wails-free on purpose via
the one-method `Sink` interface.

D1 keeps that discipline: **`internal/shell` is the only new package that imports Wails.** Every
piece of P56's logic that can be written against an interface is, and `internal/shell` is the thin
adapter layer. The cost is one package needing the dev headers; the benefit is that the ~1 200 lines
of bridge logic added here stay unit-testable on a bare toolchain.

### 1.9 `src/main/index.ts` read in full: the wiring P56 reproduces

Read end to end (173 lines). What P56 owes from it, in the order it appears:

| `index.ts` | Go |
|---|---|
| `Menu.setApplicationMenu(buildMenu({isDev}))` at module scope (`:27`) | `app.Menu.Set(shell.BuildMenu(...))`, but **after** `application.New` (§1.4) |
| `broadcast(channel, payload)` over every window (`:29-33`) | `app.Event.Emit(channel, payload)` — Wails fans out to every window itself (`events.go:113-119`) |
| `FLUSH_TIMEOUT_MS = 2000`, `pendingFlushAcks`, `requestFlush` (`:40-60`) | §4.6's `Quitter`. One window, so the per-`webContents.id` map collapses to one channel |
| `connections.onStateChange/onMetadataInvalidated/onListChanged` → 3 broadcasts (`:98-102`) | `bridge/events.go`, wired to P55's `On*` seams (P55 D15) |
| `engineHost.on('engine:down') → markAllErrored` (`:105`) | **already done** — P55's `connections.watch()` |
| `wireOplog(..., record => broadcast(IPC.opUpdate, record), ...)` (`:107-112`) | `bridge/events.go`, wired to P55's `Wiring.OnUpdate` |
| `APP_METRICS_INTERVAL_MS` interval → `broadcast(IPC.appMetrics, …)` (`:119-125`) | `bridge/events.go`, wired to P55's `Ticker.OnSample` (P55 §6.1 hands exactly this over) |
| `registerIpc(...)` (`:127`) | `main.go`'s `Services:` list, plus the four new services |
| `attachPort` / `generation` (`:129-137`) | Gone. Wails supersedes stream sessions by page generation itself (`stream.go:747-800`), which P52 §7.2 already banked on |
| `app.on('activate')` recreating a window (`:141-145`) | `events.Mac.ApplicationShouldHandleReopen` (`pkg/events/events.go:138`, `:279`; posted by `applicationShouldHandleReopen:` in `application_darwin_delegate.m:73-80`) — D10 |
| `app.on('window-all-closed')` no-op (`:147-149`) | `MacOptions.ApplicationShouldTerminateAfterLastWindowClosed: false` — D10. **The current `main.go` has this set to `true`**, which silently reverses today's macOS convention |
| `before-quit` → `clearInterval(metricsTimer)` → flush → `connections.shutdown()` → `engineHost.stop()` → `close()` → `app.quit()` (`:151-163`) | §4.6, split into `beforeFlush` and `teardown`, both `sync.OnceFunc` |

`src/main/ipc/settings.ts` read in full (24 lines): `setSettings` → **conditionally**
`pushEngineConfig` only when `patch.cache?.l2BudgetMb !== undefined` → **unconditionally** broadcast
`IPC.settingsChanged` with the merged result → return the merged result. The comment at `:15-18`
explains why the broadcast exists at all; it is load-bearing and ports verbatim.
`src/main/engine-config.ts` (33 lines): failures are logged at `warn`, **never thrown** — already
true of `enginehost.PushCacheConfig` (`config.go:16`).

`src/main/ipc/ops.ts` read in full: `opsCancel` is `await deps.engineHost.call(ENGINE_OP.cancel,
{opId})` and returns nothing. `ENGINE_OP.cancel`'s wire string is already `enginehost.OpCancel`
(`ops.go:14`, read from `engine-ops.ts` for P55 D12).

`src/main/ipc/queries.ts` read in full (87 lines): nine handlers, all thin wrappers over the two
repos, with zod shapes only. The one semantic constraint beyond shape is
`historyListArgsSchema`'s `limit: z.number().int().min(1).max(100)` (`:41`).
`src/shared/domain/queries.ts:42` puts `name` at `trim().min(1).max(120)` — already enforced Go-side
by `model.ValidSavedQueryName`, called from `SavedQueriesRepo.insert`/`Update`
(`storage/repos/saved_queries.go:109`, `:181`), so the bridge must not duplicate it.

`src/main/window.ts` read in full (58 lines): bounds spread into the constructor, `show: false` +
`ready-to-show`, the `did-finish-load` uptime line, the 300 ms debounce on `resize`/`move`, and
`win.on('closed', () => clearTimeout(timer))` with its D8 comment (*deliberately* not flushing the
pending write on quit). All five port; the D8 non-flush stays deliberate.

### 1.10 What P55 actually left behind, checked against the tree

- `shell/internal/bridge/` has nine services; `main.go` registers nine. `connections.go` has its 12
  methods and `tree.go` its 4 — P55's hand-over is complete and there is no "lands in P55" comment
  left.
- `appcore.Deps` has `DB`, `EngineHost`, `NodeVersion`, `StartedAt`, `Repos`, `Connections`, `Tree`
  and its doc comment names `Events` as P56's addition.
- `internal/metrics.Ticker` exists with `OnSample`/`Start`/`Stop` and `Interval = 5 * time.Second`;
  `main.go` starts it with no subscriber (P55 D15). `metrics.Sample` is
  `{CPUPercent float64 "cpuPercent"; MemoryBytes uint64 "memoryBytes"}` — already
  `AppMetricsSample`'s shape.
- `internal/oplog.Wiring.OnUpdate` exists and is unsubscribed.
- `enginehost` has `AttachStream(Sink) (detach func())`, `SendData([]byte) error`, `Sink` =
  `interface{ Send(frame []byte) error }` (`stream.go:18-20`, `:38`, `:74`), plus `Subscribe()`,
  `Call`, `CallTimeout`, `Alive`, `PID`, `Stop`.
- **`main.go`'s `resolveEngine()` still points at `testdata/engine-ping.mjs`** — AGENTS.md's P55
  finding says so and the source confirms it (`main.go:181-204`). `shell/runtime/engine/engine.cjs`
  (6.3 MB, built by `bun run build:engine`) and `shell/runtime/node/bin/node` are both present in
  this checkout. D12.
- `internal/enginetest/testdata/engine-fixture.mjs` — checked, per AGENTS.md's instruction not to
  trust P55's plan table. It currently answers `adapter:connect`, `adapter:disconnect`,
  `adapter:test`, `adapter:children`, `adapter:describe`, `adapter:definition`, `adapter:cancel`,
  `cache:configure` and **six** `fixture:` ops (`release-slow`, `emit-op-start`, `emit-op-end`,
  `request-count`, `last-connect-config`, `crash`) — three more than P55's own plan table listed.
  P56 needs **one more** (D13, `fixture:echo-data`, the only way to prove a data-tagged frame
  round-trips the Stream without being unmarshalled).
- `shell/frontend/shim/kira-bridge.ts` already subscribes to 19 of the 20 push channels under their
  exact `kira:*` names and comments each stub with "P56". Its `appFlushed` is an explicit no-op
  "until P56".

## 2. Decisions

**D1 — `internal/shell` is the only new package that imports Wails; everything else talks to it
through interfaces.** §1.8 gives the cost. Concretely: `bridge/events.go` emits through
`appcore.Emitter`; `bridge/stream.go` serves a `bridge.StreamSession`; `bridge/files.go` calls a
`bridge.Dialogs`; `bridge/lifecycle.go` calls a `bridge.Flusher`. `*application.StreamConn` already
satisfies `StreamSession` **structurally** (`Send([]byte) error` at `stream.go:234`,
`Receive() ([]byte, error)` at `:274`), so that one needs no adapter at all — the same trick P54 D14
used for `Sink`. This is not test-driven indirection for its own sake: three of the four have real
non-Wails implementations in the test suite and the fourth (`StreamSession`) is satisfied by the
real type unchanged.

**D2 — `ShouldQuit` never blocks; the flush runs on a goroutine and quits again when it is done.**
§1.3 is the evidence. This departs from P52 §8.3's literal design ("waits on a channel with a
`time.After` fallback" *inside* the handler) and is the same shape Electron uses. P52 §8.3's other
half — that a `role: quit` item bypasses a custom handler — is **confirmed** and handled by using a
role-free item.

**D3 — the teardown is two `sync.OnceFunc`s, and `Options.OnShutdown` runs both.** `ShouldQuit`'s
goroutine calls `beforeFlush()` (stop the metrics ticker — `index.ts:156`'s `clearInterval`, which
happens *before* the flush wait) then, after the ack or the timeout, `teardown()` (detach events,
stop oplog, shut connections down, stop the engine, close repos, close the db). A quit that never
goes through `ShouldQuit` — a signal, or `Run()` returning an error — still reaches
`Options.OnShutdown`, which calls both; whichever ran first makes the second a no-op. Without the
`OnceFunc`s the ordinary quit path would run the teardown twice.

**D4 — one `Events` type owns all 20 channel constants and every subscription, and nothing else
emits.** `SettingsService.Set` needs to emit too, so `appcore.Deps` gains an `Events *bridge.Events`
field rather than each service holding its own emitter. This is P52 §4.2's own `deps.ts` row, which
lists `Events`, coming due.

**D5 — `kira:engine:state` gets no emitter.** §1.1. Inventing one would be new behaviour, and the
renderer has no subscriber to receive it. Recorded for P57 to delete from `ipc.ts`.

**D6 — signal channels emit `nil`, not an empty object.** Electron's `sendToFocusedWindow(channel)`
sends no payload and `preload`'s `onSignal` discards arguments (`src/preload/index.ts:35-39`).
`Emitter.Emit(name, nil)` produces `{"name":…,"data":null}` on the wire, which every `onSignal`-style
subscriber ignores. An empty object would be equally ignored but would be a shape nobody asked for.

**D7 — `FilesService` returns Electron's exact result shapes, and cancel is `path == ""`.**
`{canceled, filePath}` and `{canceled, file:{path,name,size}}` are what
`src/renderer/state/objectStore.ts:68` and `ConnectionDialog.vue:253` read. §1.2's finding that
Wails signals cancel with an empty string is translated at the one boundary that knows it, the
`Dialogs` adapter's caller.

**D8 — a filter list containing the extension `*` becomes no filter at all.** §1.2 point 4. The
alternative — passing `*` through — silently breaks
`ConnectionDialog.vue`'s "All files" row on macOS. The translation is a pure function in
`bridge/files.go` with its own test table, not a line buried in the adapter.

**D9 — the `basename()` guard survives, and is the reason `ChooseSave` has a guard at all.**
`ipc/files.ts:30-31`'s comment is explicit: an S3 key routinely contains `/`, which
`showSaveDialog` would read as a subdirectory. Go: `filepath.Base(defaultName)`, plus an
`E_BAD_REQUEST` when `defaultName` is empty (`filepath.Base("")` is `"."`, which would open a save
panel proposing a file literally named `.`).

**D10 — the app survives its last window closing, as it does today.** `main.go` currently sets
`ApplicationShouldTerminateAfterLastWindowClosed: true` (a P52 M1 minimal-scaffold choice), which
reverses `index.ts:147-149`'s deliberate macOS convention. P56 sets it `false` and adds the
`activate` analogue: `app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, …)`
recreating the window when `app.Window.GetAll()` is empty (`window_manager.go:124`). ~20 lines, and
without it "native shell parity" is not parity.

**D11 — `shell/frontend/shim/kira-bridge.ts` gains exactly one line of behaviour: `appFlushed`.**
The shim is a P52 M1 boot-path bootstrap that P57 replaces wholesale; P55 deliberately did not grow
it even after adding ten `ConnectionsService` methods, and that precedent holds. The one exception
is `appFlushed`, because leaving it a no-op means every manual quit in this phase's own acceptance
check hits the 2 s timeout and the handshake is never actually observed working. It is a `shell/`
file, not a `src/` one.

**D12 — `resolveEngine()` switches to the real bundled engine, and its absence is a hard startup
failure.** AGENTS.md's P55 finding leaves this open and guesses "cutover, most likely". It belongs
here instead: P56's own row is *"the `engine` Stream"*, and a Stream whose far side answers only
`ping` cannot be exercised end to end — the acceptance check "open a table and see rows" is the
whole point of the row. P54's `stdio_main_integration_test.go` already proved the bundle correct
under a bare `node`. So `resolveEngine()` looks for `runtime/engine/engine.cjs` (beside the
executable first, then in the source tree) and fails with a message naming `bun run build:engine`;
`testdata/engine-ping.mjs` is **deleted**, since keeping a second candidate would be exactly the
half-state `AGENTS.md` rules out. Named alternative if this proves disruptive: keep the flip but
gate the acceptance check, not the code.

**D13 — the shared engine fixture gains one op, `fixture:echo-data`.** P52 §13's `bridge/stream`
row demands *"frame passthrough integrity for a ≥1 MB payload"* and *"demux by tag"*. The existing
fixture answers control-channel ops; nothing in it echoes a **data-tagged** frame back on the data
tag. `fixture:echo-data` answers on whichever tag it arrived on with the payload verbatim, which is
what makes "byte-identical, never unmarshalled" assertable. Checked first, per AGENTS.md's P55
finding: the fixture already has six `fixture:` ops, and this is a seventh, not a duplicate.

**D14 — the menu is a Wails-free template rendered by a Wails-dependent builder.**
`menutemplate.go` produces a `[]MenuSection` tree of plain structs (label, accelerator string, role,
channel, dev-only flag); `menu.go` walks it into `*application.Menu`. The template is what
`menutemplate_test.go` asserts — the direct Go analogue of `tests/unit/menu.spec.ts`'s
"a packaged build has no reload or toggleDevTools" — and the builder is additionally asserted
against the real Wails API (§1.7 proved that is possible), so a mistranslated accelerator cannot
hide behind `SetAccelerator`'s silent failure.

**D15 — `bridge/stream.go` passes the Wails `StreamConn` straight through as the `enginehost.Sink`,
and does not translate `ErrStreamFull`.** Wails' `Send` **blocks** rather than returning
`ErrStreamFull` (`stream.go:234-240`; `TrySend` is the non-blocking one, `:243-251` — the same
correction AGENTS.md's P54 finding already records against P52 §7.2). enginehost's own bounded queue
(64 frames / 32 MiB, `stream.go:27-30`) plus a blocking sink is precisely P52 §7.2's stated
backpressure policy: the queue fills, the read loop stops draining the engine's stdout, and the OS
pipe pushes back on the engine. `enginehost`'s `ErrStreamFull` retry path stays exercised by P54's
own synthetic-sink tests and is simply unused in production; that is a complete behaviour, not a
dead branch.

## 3. Target tree, file by file

```
shell/internal/shell/                   NEW package — the only new Wails importer (D1)
  app.go                NEW   emitter/dialogs adapters, HandleStream registration, reopen handler
  menu.go               NEW   template -> *application.Menu, app.Menu.Set
  menutemplate.go       NEW   the Wails-free declarative template (D14)
  menutemplate_test.go  NEW
  accel.go              NEW   Chord -> Wails accelerator string (shortcuts.ts's 13 global bindings)
  accel_test.go         NEW
  window.go             NEW   options from stored bounds, debounced persist, runtime-ready log
  debounce.go           NEW   the 300 ms debouncer, Wails-free
  debounce_test.go      NEW
  security.go           NEW   the posture that survives WKWebView, and why (§1.6)
  security_test.go      NEW
  quit.go               NEW   Quitter: ShouldQuit / RequestQuit / Flushed / Shutdown (D2, D3)
  quit_test.go          NEW
  menu_wails_test.go    NEW   the built *application.Menu, asserted against the real API (D14)
shell/internal/bridge/
  events.go             NEW   the 20 channel constants, Events, Attach (D4, D5, D6)
  events_test.go        NEW
  stream.go             NEW   StreamSession, ServeEngineStream (D1, D15)
  stream_test.go        NEW
  files.go              NEW   FilesService, Dialogs, the filter translation (D7, D8, D9)
  files_test.go         NEW
  queries.go            NEW   QueriesService, 9 methods
  queries_test.go       NEW
  lifecycle.go          NEW   LifecycleService.Flushed, Flusher
  lifecycle_test.go     NEW
  settings.go           UPDATED  + Set (cache re-push + settingsChanged)
  layout.go             UPDATED  + Set
  filters.go            UPDATED  + Replace
  ops.go                UPDATED  + Cancel
  settings_test.go      NEW
  layout_test.go        NEW
  filters_test.go       NEW
  ops_test.go           NEW
shell/internal/appcore/
  deps.go               UPDATED  + Emitter interface, + Events field
shell/internal/enginetest/
  testdata/engine-fixture.mjs  UPDATED  + fixture:echo-data (D13)
shell/main.go           UPDATED  services list, ShouldQuit/OnShutdown, menu, window, stream,
                                 events wiring, resolveEngine (D12)
shell/testdata/engine-ping.mjs  DELETED  (D12)
shell/frontend/shim/kira-bridge.ts  UPDATED  appFlushed only (D11)
```

No new Go module dependency. `go.mod`/`go.sum` are untouched.

## 4. Package designs

### 4.1 `internal/bridge/events.go`

```go
// Channel holds today's exact IPC channel strings (src/shared/protocol/ipc.ts's IPC const),
// which are the Wails event names verbatim (P52 §7.1) — the renderer's subscribe mechanism
// changes, the wire name does not.
const (
	ChannelOpenSettings           = "kira:open-settings"
	ChannelNewConnection          = "kira:menu:new-connection"
	ChannelToggleProjectPanel     = "kira:menu:toggle-project-panel"
	ChannelToggleOperationsPanel  = "kira:menu:toggle-operations-panel"
	ChannelCommandPalette         = "kira:menu:command-palette"
	ChannelTabNext                = "kira:menu:tab-next"
	ChannelTabPrev                = "kira:menu:tab-prev"
	ChannelTabClose               = "kira:menu:tab-close"
	ChannelViewFind               = "kira:menu:view-find"
	ChannelViewRefresh            = "kira:menu:view-refresh"
	ChannelViewRun                = "kira:menu:view-run"
	ChannelViewRunAll             = "kira:menu:view-run-all"
	ChannelFlushBeforeClose       = "kira:app:flush-before-close"
	ChannelConnectionState        = "kira:connection:state"
	ChannelMetadataInvalidated    = "kira:connection:metadataInvalidated"
	ChannelConnectionsChanged     = "kira:connections:changed"
	ChannelSettingsChanged        = "kira:settings:changed"
	ChannelOpUpdate               = "kira:op:update"
	ChannelAppMetrics             = "kira:app:metrics"
)

// ChannelEngineState is declared for completeness and deliberately never emitted: nothing in
// src/main sends it and nothing in src/renderer subscribes to it (P56 D5). P57 deletes it.
const ChannelEngineState = "kira:engine:state"

// Sources are the five push producers P55 left as seams (P55 D15). Each is a one-method
// interface so events_test.go can drive them without building a real service.
type Sources struct {
	Connections interface {
		OnStateChange(func(model.ConnectionState)) func()
		OnMetadataInvalidated(func(string)) func()
		OnListChanged(func([]model.ConnectionSummary)) func()
	}
	Oplog   interface{ OnUpdate(func(model.OpRecord)) func() }
	Metrics interface{ OnSample(func(metrics.Sample)) func() }
}

type Events struct{ /* emit appcore.Emitter */ }

func NewEvents(e appcore.Emitter) *Events

// Attach subscribes to every producer in s and returns one detach that unsubscribes all of them.
// It is called once at startup and detached first in the quit teardown (P56 D3), so nothing
// emits into a half-torn-down app.
func (ev *Events) Attach(s Sources) (detach func())

// Signal emits a payload-free channel (D6: nil, not {}). The menu and the quit handshake are its
// only callers.
func (ev *Events) Signal(channel string)

func (ev *Events) SettingsChanged(s model.Settings)
```

`appcore` gains, and nothing else:

```go
// Emitter is the Go→renderer push seam. internal/shell implements it over
// *application.App's Event.Emit; bridge/events.go is the only consumer, so no bridge file has to
// import Wails (P56 D1).
type Emitter interface{ Emit(name string, data any) }
```

and `Deps` gains `Events *bridge.Events`… which would be an import cycle (`bridge` imports
`appcore`). It gains **`Events appcore.Emitter`** instead, and `SettingsService.Set` constructs its
own `bridge.Events` view over it — or, simpler and what §4.5 specifies, calls
`s.Deps.Events.Emit(ChannelSettingsChanged, merged)` directly, since that is one line and the
constant lives in the same package.

### 4.2 `internal/shell/menutemplate.go`, `accel.go`, `menu.go`

```go
// accel.go — the Go port of src/shared/domain/shortcuts.ts's chordToAccelerator, for the 13
// `global: true` bindings menu.ts consumes. Only the modifier vocabulary differs: Wails'
// parseAccelerator (keys.go:55-65) accepts "Ctrl", never "Control", and silently drops an
// accelerator it cannot parse (menuitem.go:275-287) — so a verbatim port would leave Next/Previous
// Tab with no accelerator at all (P56 §1.4).
type Chord struct {
	Key       string // "N", "Return", "Tab", "F5", ","
	CmdOrCtrl bool
	Ctrl      bool
	Shift     bool
	Alt       bool
}

func (c Chord) Accelerator() string // "CmdOrCtrl+Shift+P", "Ctrl+Tab", "F5"

// Shortcuts mirrors SHORTCUTS' `global: true` rows by id, so the table can be diffed against the
// TS by name.
var Shortcuts = map[string]Chord{
	"app.settings":                {Key: ",", CmdOrCtrl: true},
	"app.newConnection":           {Key: "N", CmdOrCtrl: true},
	"view.toggleProjectPanel":     {Key: "B", CmdOrCtrl: true},
	"view.toggleOperationsPanel":  {Key: "J", CmdOrCtrl: true},
	"view.commandPalette":         {Key: "P", CmdOrCtrl: true, Shift: true},
	"view.find":                   {Key: "F", CmdOrCtrl: true},
	"view.refresh":                {Key: "F5"},
	"view.run":                    {Key: "Return", CmdOrCtrl: true},
	"view.runAll":                 {Key: "Return", CmdOrCtrl: true, Shift: true},
	"tab.next":                    {Key: "Tab", Ctrl: true},
	"tab.prev":                    {Key: "Tab", Ctrl: true, Shift: true},
	"tab.close":                   {Key: "W", CmdOrCtrl: true},
	"window.close":                {Key: "W", CmdOrCtrl: true, Shift: true},
}
```

```go
// menutemplate.go — Wails-free (D14).
type ItemKind int

const (
	ItemSeparator ItemKind = iota
	ItemRole              // a Wails role, optionally re-accelerated
	ItemEmit              // a custom item emitting Channel
	ItemQuit              // the custom, role-free Quit item (§1.3)
)

type Item struct {
	Kind        ItemKind
	Label       string             // ItemEmit / ItemQuit only
	Role        application.Role   // ItemRole only — see the note below
	Accelerator string             // "" for none
	Channel     string             // ItemEmit only, a bridge.Channel* constant
}

type Section struct {
	Label string
	Items []Item
}

// BuildTemplate is the direct analogue of buildMenu({isDev}) (src/main/menu.ts). Same four
// sections, same order, same labels, same accelerators.
func BuildTemplate(appName string, isDev bool) []Section
```

`Item.Role` is `application.Role`, so `menutemplate.go` is not literally Wails-free — but `Role` is
a bare `uint` constant in `roles.go` with no cgo behind it, and the package as a whole imports Wails
for `menu.go` anyway (§1.8). Stated plainly rather than pretending the split buys a build-tag win it
does not.

The template, item for item against `menu.ts`:

| Section | Items |
|---|---|
| `<appName>` | `About` (role) · sep · **New Connection** `CmdOrCtrl+N` → `ChannelNewConnection` · **Settings…** `CmdOrCtrl+,` → `ChannelOpenSettings` · sep · `ServicesMenu` (role) · sep · `Hide` · `HideOthers` · **`ShowAll`** (not `UnHide` — §1.4) · sep · **Quit `<appName>`** `CmdOrCtrl+Q`, `ItemQuit` |
| Edit | `Undo` · `Redo` · sep · `Cut` · `Copy` · `Paste` · `SelectAll` |
| View | **Toggle Project Panel** `CmdOrCtrl+B` · **Toggle Operations Panel** `CmdOrCtrl+J` · sep · **Command Palette…** `CmdOrCtrl+Shift+P` · **Find** `CmdOrCtrl+F` · **Refresh** `F5` · **Run Statement** `CmdOrCtrl+Return` · **Run All** `CmdOrCtrl+Shift+Return` · *(isDev only:* sep · `Reload` · `OpenDevTools`*)* |
| Window | **Next Tab** `Ctrl+Tab` · **Previous Tab** `Ctrl+Shift+Tab` · **Close Tab** `CmdOrCtrl+W` · sep · `Minimise` · `Zoom` · `CloseWindow` re-accelerated to `CmdOrCtrl+Shift+W` |

```go
// menu.go — the Wails half.
type MenuDeps struct {
	AppName string
	IsDev   bool
	Events  *bridge.Events
	Quit    func() // Quitter.RequestQuit
}

// BuildMenu renders the template. It must be called after application.New, because Wails' own
// role constructors read globalApplication.options.Name (menuitem_roles.go) — §1.4.
func BuildMenu(d MenuDeps) *application.Menu

// addItem appends a pre-built item. *Menu exposes Add(label)/AddRole(role) but no exported
// "append this one" (menu.go:45-108); the Quit item and the re-accelerated Close item both have
// to be constructed before they can be added.
func addItem(m *application.Menu, item *application.MenuItem) {
	m.Append(application.NewMenuFromItems(item))
}
```

`ItemEmit`'s click handler is `func(*application.Context) { d.Events.Signal(it.Channel) }`. Wails
runs menu callbacks on their own goroutine (`menuitem.go:270-274`), so no dispatch of our own is
needed. `ItemQuit`'s is `func(*application.Context) { d.Quit() }`, and the item carries **no role**
so `menuItem.action` stays `handleClick` rather than `terminate:` (§1.3).

### 4.3 `internal/shell/window.go` and `debounce.go`

```go
// debounce.go — Wails-free, so the 300 ms timer (window.ts:9's BOUNDS_DEBOUNCE_MS) is testable
// without a window.
type debouncer struct{ /* d time.Duration; mu sync.Mutex; timer *time.Timer */ }

func newDebouncer(d time.Duration) *debouncer
func (b *debouncer) trigger(fn func()) // resets the pending timer, exactly as clearTimeout does
func (b *debouncer) cancel()           // window.ts:47's `closed` handler (P12 D8)
```

```go
// window.go
type WindowDeps struct {
	Layout    *repos.LayoutRepo
	StartedAt time.Time
}

// Options returns the WebviewWindowOptions for the main window, with the stored bounds spread in
// exactly as window.ts:16 spreads `...(bounds ?? {})`: a missing row leaves Wails' own default
// placement alone rather than forcing a rectangle.
func Options(d WindowDeps, sec SecurityOptions) application.WebviewWindowOptions

// Attach wires the three window events window.ts owns: WindowDidResize / WindowDidMove persist
// the bounds behind the 300 ms debounce, WindowClosing cancels the pending timer (P12 D8 — the
// deliberate non-flush), and WindowRuntimeReady logs the cold-start line docs/PERF.md §3 reads.
// It returns one detach for all three.
func Attach(win *application.WebviewWindow, d WindowDeps) (detach func())
```

`Options` sets `Title: "Kira Studio"`, `MinWidth: 900`, `MinHeight: 600`,
`BackgroundColour: application.NewRGB(0x1F, 0x1F, 0x1F)`, `URL: "/"`, and `Width`/`Height`/`X`/`Y`
from `layout.Window.Bounds` when present (default `1280×800`, today's `main.go`). `Hidden` stays
false: `show: false` + `ready-to-show` (`window.ts:18`, `:28`) has no exact Wails analogue —
`WindowRuntimeReady` fires *after* the frontend runtime loads, so hiding until then would show a
later, not earlier, window than today. Stated as a deliberate small divergence rather than
approximated.

The persist callback reads `win.Bounds()` (an `InvokeSync`, safe from the event goroutine — §1.5)
and calls `d.Layout.Set(model.LayoutPatch{Window: &model.WindowPatch{Bounds: &model.WindowBounds{…}}})`,
converting `int` → `float64`. A failed write is logged at `warn` under scope `window` and never
propagated; there is nobody to propagate it to.

The runtime-ready line is
`slog.Info("did-finish-load at uptime "+…, "scope", "startup")` with
`time.Since(d.StartedAt).Milliseconds()` — `window.ts:33`'s wording preserved, since
`docs/PERF.md` §3's procedure greps for it.

### 4.4 `internal/shell/security.go`

```go
// SecurityOptions is what survives of src/main/security.ts under Wails/WKWebView (P56 §1.6).
// Most of that file has no analogue and is not ported; the table in §1.6 records each row and
// why, and P52 §11 already books the reduction as a real loss.
type SecurityOptions struct {
	Permissions map[application.PermissionType]application.Permission
	Webview     application.MacWebviewPreferences
}

// Harden returns the posture applied to the main window.
//
//   - Every capability is denied except PermissionClipboardRead, mirroring security.ts's
//     ALLOWED_PERMISSIONS allowlist and the reason it is an allowlist (P46 F68: a deny-all breaks
//     clipboard.ts's 38 copyText sites and the grid's paste path). NOTE: on macOS this map is
//     inert — resolvePermission exists only in permissions_linux.go and
//     webview_window_windows.go:2175. It is set because it is correct on Linux, where
//     `wails3 task dev` runs, and because it is the declaration of intent; §6 owns the real
//     macOS clipboard check.
//   - JavaScriptCanOpenWindowsAutomatically false is the nearest thing to setWindowOpenHandler's
//     deny; there is no per-request handler on darwin.
//   - DevTools is NOT set here: on darwin it is a build tag (`-tags production`, already passed by
//     build/darwin/Taskfile.yml), not an option (§1.4). Setting DevToolsEnabled would imply a
//     control this build does not have.
func Harden() SecurityOptions
```

### 4.5 The four completed request/response services

```go
// bridge/settings.go
type SettingsSetArgs struct {
	Patch model.SettingsPatch `json:"patch"`
}

// Set ports src/main/ipc/settings.ts verbatim: merge, conditionally re-push the engine's cache
// budget when cache.l2BudgetMb was in the patch, then broadcast the merged settings
// unconditionally — the broadcast closes the gap settings.ts:15-18 names (a settings change made
// through any path other than the renderer's own patchSettings() wrapper would otherwise never
// reach the renderer's local settingsState).
func (s *SettingsService) Set(args SettingsSetArgs) (model.Settings, error)
```

```go
// bridge/layout.go
type LayoutSetArgs struct {
	Patch model.LayoutPatch `json:"patch"`
}

func (s *LayoutService) Set(args LayoutSetArgs) (model.Layout, error)
```

```go
// bridge/filters.go
type FiltersReplaceArgs struct {
	ConnectionID string               `json:"connectionId"`
	Visibility   model.TreeVisibility `json:"visibility"`
}

func (s *FiltersService) Replace(args FiltersReplaceArgs) (model.TreeVisibility, error)
```

```go
// bridge/ops.go
type OpsCancelArgs struct {
	OpID string `json:"opId"`
}

// Cancel is a bare passthrough to the engine (src/main/ipc/ops.ts:16-19) — there is nothing in
// internal/oplog to build on, which is why P55 §7 left it here.
func (s *OpsService) Cancel(args OpsCancelArgs) error
```

Each guards its own bare-id/limit arguments with `ipcerr.BadRequest` before calling anything, per
the AGENTS.md P55 finding that a bridge method taking a bare id string gets an explicit guard rather
than relying on the service below to fail legibly: `Replace` rejects an empty `connectionId`
(`"connectionId is required"`, matching `filters.go`'s existing `List`), `Cancel` rejects an empty
`opId` (`"opId is required"`).

### 4.6 `internal/shell/quit.go`

```go
// Quitter is the Go analogue of src/main/index.ts:151-163's before-quit handler. It is wired
// three ways: application.Options.ShouldQuit (which covers Cmd+Q, the Apple menu, the Dock and
// App.Quit() alike — §1.3), application.Options.OnShutdown, and the menu's own Quit item.
type Quitter struct {
	events      *bridge.Events
	beforeFlush func() // sync.OnceFunc: metrics ticker Stop (index.ts:156)
	teardown    func() // sync.OnceFunc: the ordered shutdown
	timeout     time.Duration

	app      *application.App
	started  atomic.Bool
	done     atomic.Bool
	flushed  chan struct{}
	ackOnce  sync.Once
}

// NewQuitter takes the two teardown halves already wrapped in sync.OnceFunc by the caller, so
// main.go states the order in one place. flushTimeout is index.ts's FLUSH_TIMEOUT_MS.
func NewQuitter(events *bridge.Events, beforeFlush, teardown func(), flushTimeout time.Duration) *Quitter

// Attach supplies the app once application.New has returned. ShouldQuit is passed to
// application.New as a method value before that, which is why the app cannot be a constructor
// argument.
func (q *Quitter) Attach(app *application.App)

// ShouldQuit is application.Options.ShouldQuit. It NEVER blocks (P56 D2): the renderer's ack is
// itself a bound call, which arrives through the main thread (application_darwin.go:431's
// processURLRequest), so a handler that waited here would deadlock the very ack it waits for and
// guarantee the timeout — losing exactly the debounced tab save the handshake exists to protect
// (src/renderer/state/tabs.ts:131-137 awaits a tabsSave round trip before acking).
func (q *Quitter) ShouldQuit() bool {
	if q.done.Load() {
		return true
	}
	if q.started.CompareAndSwap(false, true) {
		go q.flushThenQuit()
	}
	return false // NSTerminateCancel — Electron's event.preventDefault()
}

// RequestQuit is the menu Quit item's click handler. App.Quit() routes through
// applicationShouldTerminate: too, so this is the same path, not a second one.
func (q *Quitter) RequestQuit() { q.app.Quit() }

// Flushed is the renderer's ack, bound as Lifecycle.Flushed (IPC.appFlushed). Fire-and-forget and
// idempotent: a late ack after the timeout is a no-op, not a panic on a closed channel.
func (q *Quitter) Flushed() { q.ackOnce.Do(func() { close(q.flushed) }) }

// Shutdown is application.Options.OnShutdown — the path a signal or a Run() error takes, where
// ShouldQuit never fires. Both halves are sync.OnceFunc, so the ordinary path's earlier calls make
// this a no-op rather than a double teardown (P56 D3).
func (q *Quitter) Shutdown() { q.beforeFlush(); q.teardown() }

func (q *Quitter) flushThenQuit() {
	q.beforeFlush()
	q.events.Signal(bridge.ChannelFlushBeforeClose)
	select {
	case <-q.flushed:
	case <-time.After(q.timeout):
		slog.Warn("quit flush timed out", "scope", "lifecycle", "timeoutMs", q.timeout.Milliseconds())
	}
	q.teardown()
	q.done.Store(true)
	q.app.Quit() // second pass: ShouldQuit now returns true
}
```

`timeout` is a field rather than a constant so `quit_test.go` can run the whole handshake in
milliseconds — the precedent P54 D10 and P55 D9 both set.

### 4.7 `internal/bridge/lifecycle.go`

```go
// Flusher is the ack seam. *shell.Quitter satisfies it; lifecycle_test.go uses a recorder.
type Flusher interface{ Flushed() }

// LifecycleService is IPC.appFlushed's one method — the only renderer→Go fire-and-forget channel
// in the whole surface (P52 §7.1). It returns nothing and cannot fail: a nil Flusher (a build with
// no window, e.g. a test) is a no-op, not an error.
type LifecycleService struct {
	Flusher Flusher
}

func (s *LifecycleService) Flushed() {
	if s.Flusher != nil {
		s.Flusher.Flushed()
	}
}
```

### 4.8 `internal/bridge/stream.go`

```go
// StreamSession is the whole of what the engine stream handler needs from a renderer connection.
// *application.StreamConn satisfies it structurally — Send([]byte) error (stream.go:234) and
// Receive() ([]byte, error) (stream.go:274) — so this package still imports no Wails (P56 D1).
type StreamSession interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}

// StreamName is the one named stream (P52 §7.2). The renderer's replacement for
// src/renderer/bridge/port.ts opens it once per page load; Wails supersedes an older generation's
// session automatically (stream.go:747-800), which is what retires index.ts's own `generation`
// counter.
const StreamName = "engine"

// ServeEngineStream runs for the life of one connection and returns when the renderer's side
// closes (page reload, window close, app shutdown). Outbound: conn is attached as the host's Sink
// directly — Wails' Send blocks rather than returning ErrStreamFull (stream.go:234-240; TrySend is
// the non-blocking one), which is exactly P52 §7.2's backpressure policy: enginehost's bounded
// queue fills, its read loop stops draining the engine's stdout, and the OS pipe pushes back on
// the engine (P56 D15). Inbound: every frame goes to the engine's stdin verbatim. Go never
// unmarshals a data-plane frame in either direction.
func ServeEngineStream(host *enginehost.Host, conn StreamSession) {
	detach := host.AttachStream(conn)
	defer detach()
	for {
		frame, err := conn.Receive()
		if err != nil {
			return
		}
		if err := host.SendData(frame); err != nil {
			// The engine is gone. The session stays open: enginehost has already failed every
			// pending call with E_ENGINE_DOWN (P54), and the renderer's own pending map is what
			// surfaces that — closing the stream here would additionally reject frames the
			// renderer has not sent yet, which is not today's behaviour.
			slog.Warn("engine stream send failed", "scope", "stream", "err", err)
		}
	}
}
```

### 4.9 `internal/bridge/files.go`

```go
// The four wire shapes, byte for byte src/shared/protocol/ipc.ts:133-149's.
type FilesChooseSaveArgs struct {
	DefaultName string `json:"defaultName"`
}
type FilesChooseSaveResult struct {
	Canceled bool    `json:"canceled"`
	FilePath *string `json:"filePath"`
}

type FileFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}
type FilesChooseOpenArgs struct {
	Filters []FileFilter `json:"filters,omitempty"`
	Title   string       `json:"title,omitempty"`
}
type ChosenFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}
type FilesChooseOpenResult struct {
	Canceled bool        `json:"canceled"`
	File     *ChosenFile `json:"file"`
}

// SaveFileRequest / OpenFileRequest are the platform-neutral asks. FilterPattern is already in
// Wails' own "*.a;*.b" form (dialogs.go:279's AddFilter doc); an empty FilterName means "no
// filter", which is how D8's `*` case is expressed.
type SaveFileRequest struct{ Directory, Filename string }
type OpenFileRequest struct{ Title, FilterName, FilterPattern string }

// Dialogs is the native-dialog seam. internal/shell implements it over app.Dialog with the main
// window attached for modality; files_test.go implements it with a recorder. Both methods return
// "" for a cancelled dialog, which is the only cancel signal Wails gives (P56 §1.2).
type Dialogs interface {
	SaveFile(req SaveFileRequest) (string, error)
	OpenFile(req OpenFileRequest) (string, error)
}

type FilesService struct {
	Dialogs Dialogs
}

// ChooseSave ports src/main/ipc/files.ts:26-36. filepath.Base, not the suggested name verbatim —
// an S3 key routinely contains '/', which the save panel would otherwise read as a subdirectory
// path (P56 D9, and files.ts:29-30's own comment).
func (s *FilesService) ChooseSave(args FilesChooseSaveArgs) (FilesChooseSaveResult, error)

// ChooseOpen ports files.ts:38-53, including the stat() that fills `size`.
func (s *FilesService) ChooseOpen(args FilesChooseOpenArgs) (FilesChooseOpenResult, error)

// wailsFilter collapses Electron's per-group filter list into the single extension set Wails'
// macOS open panel actually applies (dialogs_darwin.go's show() joins every filter's components
// into one ';' string). Returns ok == false when any extension is "*": Wails has no wildcard —
// panel:shouldEnableURL: matches on a literal ".<ext>" suffix (dialogs_darwin_delegate.m:29-37) —
// and an empty allowed-extension list is what actually means "all files" there (P56 D8).
func wailsFilter(filters []FileFilter) (name, pattern string, ok bool)

// downloadsDir is app.getPath('downloads')'s substitute; Wails' EnvironmentManager exposes no
// path API at all (environment_manager.go:23-58).
func downloadsDir() string
```

### 4.10 `internal/bridge/queries.go`

Nine methods, 1:1 with `src/main/ipc/queries.ts`, each a typed-struct wrapper over
`Deps.Repos.SavedQueries` / `Deps.Repos.FilterHistory` with an explicit guard and an `ipcerr`
translation. Name-length validation is **not** repeated here — it already lives in
`SavedQueriesRepo.insert`/`Update` via `model.ValidSavedQueryName`.

```go
type QueriesService struct{ Deps appcore.Deps }

type QueriesListArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
}
func (s *QueriesService) List(args QueriesListArgs) ([]model.SavedQuery, error)
func (s *QueriesService) ListConsole(args QueriesListArgs) ([]model.SavedQuery, error)

type QueriesSaveArgs struct {
	ConnectionID string           `json:"connectionId"`
	Path         string           `json:"path"`
	Name         string           `json:"name"`
	Body         model.FilterBody `json:"body"`
	Pinned       bool             `json:"pinned"`
}
func (s *QueriesService) Save(args QueriesSaveArgs) (model.SavedQuery, error)

type QueriesSaveConsoleArgs struct {
	ConnectionID string            `json:"connectionId"`
	Path         string            `json:"path"`
	Name         string            `json:"name"`
	Body         model.ConsoleBody `json:"body"`
	Pinned       bool              `json:"pinned"`
}
func (s *QueriesService) SaveConsole(args QueriesSaveConsoleArgs) (model.SavedQuery, error)

type QueriesUpdateArgs struct {
	ID     string  `json:"id"`
	Name   *string `json:"name,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}
func (s *QueriesService) Update(args QueriesUpdateArgs) (model.SavedQuery, error)

type QueriesIDArgs struct{ ID string `json:"id"` }
func (s *QueriesService) Delete(args QueriesIDArgs) error
func (s *QueriesService) Touch(args QueriesIDArgs) error

type QueriesHistoryListArgs struct {
	ConnectionID string `json:"connectionId"`
	Path         string `json:"path"`
	Limit        int    `json:"limit"`
}
func (s *QueriesService) HistoryList(args QueriesHistoryListArgs) ([]model.FilterHistoryEntry, error)

type QueriesHistoryRecordArgs struct {
	ConnectionID string          `json:"connectionId"`
	Path         string          `json:"path"`
	Where        *string         `json:"where"`
	OrderBy      *model.SortSpec `json:"orderBy"`
}
func (s *QueriesService) HistoryRecord(args QueriesHistoryRecordArgs) error
```

Guards, each `ipcerr.BadRequest`: `connectionId is required` on the four connection-scoped methods;
`id is required` on `Update`/`Delete`/`Touch`; and `limit must be between 1 and 100` on
`HistoryList`, which is `historyListArgsSchema`'s own `min(1).max(100)` (`queries.ts:41`) — the one
place zod was doing more than shape.

### 4.11 `internal/shell/app.go` and `main.go`

```go
// app.go — the Wails adapters. Nothing else in the repo imports pkg/application (P56 D1).

// emitter satisfies appcore.Emitter. EventManager.Emit takes data ...any (event_manager.go:31);
// a single nil argument is how a payload-free signal is expressed (P56 D6).
type emitter struct{ app *application.App }

func NewEmitter(app *application.App) appcore.Emitter

// dialogs satisfies bridge.Dialogs, attaching each panel to the main window so it opens as a
// sheet rather than a free-floating modal (dialogs.go:456 / :247).
type dialogs struct {
	app    *application.App
	window func() application.Window
}

func NewDialogs(app *application.App, window func() application.Window) bridge.Dialogs

// RegisterEngineStream registers the one named stream. The handler blocks for the life of the
// connection, which is what keeps it open (stream.go:162-166's StreamHandler contract).
func RegisterEngineStream(app *application.App, host *enginehost.Host) {
	app.HandleStream(bridge.StreamName, func(c *application.StreamConn) {
		bridge.ServeEngineStream(host, c)
	})
}

// AttachReopen is src/main/index.ts:141-145's `activate` handler: on macOS, closing the last
// window leaves the app running, and clicking the Dock icon brings a window back (P56 D10).
func AttachReopen(app *application.App, newWindow func()) (detach func())
```

`main.go`'s new shape, with the startup order P55 §7 established and the additions marked:

```
config.EnsureLayout → logging.Init → logging.Sweep → storage.Open → secrets.New
  → repos.New + repos.NewSecrets → Settings.GetAll → resolveEngine (D12) → enginehost.Start
  → preconnect.New → connections.New(...).Start → tree.New → enginehost.PushCacheConfig
  → oplog.New(...).Start → metrics ticker
  → NEW: quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second)
  → application.New(Options{ Services: 13, ShouldQuit: quitter.ShouldQuit,
                             OnShutdown: quitter.Shutdown,
                             Mac: {ApplicationShouldTerminateAfterLastWindowClosed: false} })
  → NEW: quitter.Attach(app); events = bridge.NewEvents(shell.NewEmitter(app)); eventsDetach = events.Attach(...)
  → NEW: app.Menu.Set(shell.BuildMenu(...))
  → NEW: shell.RegisterEngineStream(app, host); shell.AttachReopen(app, newWindow)
  → newWindow(): app.Window.NewWithOptions(shell.Options(...)) then shell.Attach(win, ...)
  → app.Run()
```

One ordering knot, stated so it is not rediscovered: `bridge.Events` needs the `*App`, the `Quitter`
needs the `Events`, and `application.New` needs the `Quitter`'s `ShouldQuit`. The `Quitter` is
therefore constructed with a `*bridge.Events` pointer that is populated by `Attach` after `New` —
or, equivalently and what §4.6's signature implies, `NewQuitter` takes the `*Events` and `main.go`
constructs the `Events` over a small indirection whose `*App` is filled in by `NewEmitter` after
`New`. Either is fine; the plan mandates only that `ShouldQuit` is passed to `application.New` as a
method value on an already-allocated `Quitter`.

`teardown`, in order (today's `OnShutdown` minus the ticker, which moves to `beforeFlush`):
`eventsDetach()` → `oplogWiring.Stop()` → `connectionsSvc.Shutdown()` → `host.Stop()` →
`repositories.Close()` → `db.Close()`.

The `Services:` list grows from nine to thirteen: `+ FilesService`, `+ QueriesService`,
`+ LifecycleService`, and `SettingsService`/`LayoutService`/`FiltersService`/`OpsService` gain
methods in place.

## 5. Testing plan

Per P52 §13 and the precedent P53 §5 / P54 §5 / P55 §5 set: `go test ./...`, standard-library
`testing`, table-driven, `go-cmp` for struct diffs, tests beside the code, `package foo_test` except
where an unexported symbol is the subject, real dependencies over mocks. Storage-touching tests go
through `storage.Open()` in a `t.TempDir()` `KIRA_HOME`; engine-touching tests use
`internal/enginetest` (P55 D13).

`internal/shell`'s tests use a **real `*application.App`** (§1.7 proved this runs headless on
Linux). Because `application.New` short-circuits on a non-nil `globalApplication`
(`application.go:49-51`), the package gets **one shared app via a `TestMain`-scoped helper**, and
every test that registers an event listener unsubscribes it.

`internal/enginetest`'s fixture gains `fixture:echo-data` (D13): answers on whichever tag the
request arrived on with `payload` verbatim.

### 5.1 `internal/bridge/events.go` — P52 §13's `bridge` row, push half

`events_test.go` (`package bridge_test`, a `recordingEmitter` implementing `appcore.Emitter`):

| Test | Asserts |
|---|---|
| `TestChannelConstantsMatchIpcTs` | A table of all 20 constants against the literal strings from `src/shared/protocol/ipc.ts` — the anti-drift guard, since a typo here is invisible until a renderer stops receiving |
| `TestSignalEmitsNilPayload` | `Signal(ChannelTabNext)` records `{name: "kira:menu:tab-next", data: nil}` (D6) |
| `TestAttachForwardsEveryProducer` | Five fake producers; one emission each; the recorder holds exactly five events with the right names **and** the payload identity (`go-cmp` on `model.ConnectionState`, `model.OpRecord`, `metrics.Sample`, `[]model.ConnectionSummary`, `string`) |
| `TestDetachUnsubscribesAll` | After `detach()`, five more emissions record nothing, and each fake's own unsubscribe was called exactly once |
| `TestEngineStateIsNeverEmitted` | Drive every producer; assert no recorded event is named `kira:engine:state` (D5's regression guard — this is the test that stops a future session "helpfully" wiring it) |

### 5.2 `internal/bridge` — the four completed services

`settings_test.go`, `layout_test.go`, `filters_test.go`, `ops_test.go`
(`package bridge_test`, real SQLite via `storage.Open()` in a `t.TempDir()` `KIRA_HOME`,
`enginetest.Host` where the engine is involved):

| Test | Asserts |
|---|---|
| `TestSettingsSetBroadcasts` | A patch that does **not** touch `cache.l2BudgetMb` still records exactly one `kira:settings:changed` carrying the merged settings (`settings.ts:15-18`'s gap) |
| `TestSettingsSetPushesCacheConfigOnlyWhenBudgetChanges` | Against a real fixture host: a patch containing `cache.l2BudgetMb` produces exactly one `cache:configure` engine call (`fixture:request-count`); a patch without it produces zero |
| `TestSettingsSetReturnsMerged` | The returned `model.Settings` equals a fresh `GetAll()` (`go-cmp`) |
| `TestLayoutSetRoundTrip` | A window-bounds patch and a panel patch each read back through `GetAll`; an empty patch is a no-op that still returns the current layout |
| `TestFiltersReplaceRoundTrip` | `Replace` then `List` returns the same `model.TreeVisibility`; an empty `connectionId` returns `E_BAD_REQUEST` with `"connectionId is required"` |
| `TestOpsCancelCallsEngine` | Against the fixture: `Cancel{OpID: "op-1"}` produces exactly one `adapter:cancel`; an empty `opId` returns `E_BAD_REQUEST` and **no** engine call |
| `TestOpsCancelSurfacesEngineDown` | After `fixture:crash`, `Cancel` returns an `*ipcerr.Error` with `Code == "E_ENGINE_DOWN"` (P54's code, passed through untouched — P55 D5) |

### 5.3 `internal/bridge/queries.go`

`queries_test.go` (`package bridge_test`, real SQLite, one seeded connection row so the FK holds):

| Test | Asserts |
|---|---|
| `TestSaveAndListFilters` | `Save` then `List` returns it; `kind == "filter"`; `body` round-trips through `model.FilterBody` including a `SortSpec` of each arm; `pinned: true` is reflected |
| `TestSaveAndListConsole` | The same for `SaveConsole`/`ListConsole`, and that `List` does **not** return console rows (nor `ListConsole` filter rows) |
| `TestUpdateRenameAndPin` | `Update` with only `Name`, only `Pinned`, and both; each leaves the other field alone |
| `TestDeleteAndTouch` | `Delete` removes exactly one row; `Touch` advances `usedAt` and nothing else |
| `TestHistoryRecordAndList` | `HistoryRecord` then `HistoryList` returns the entry with `where`/`orderBy` intact; a `nil` `orderBy` survives as `nil` |
| `TestHistoryListLimitGuard` | Table: `0`, `-1`, `101` each return `E_BAD_REQUEST` with `"limit must be between 1 and 100"`; `1` and `100` are accepted |
| `TestEmptyIdGuards` | Table over the seven methods taking a bare id, each returning `E_BAD_REQUEST` and touching no row |
| `TestNameValidationIsNotDuplicated` | A 200-character name fails, and the message is the repo's (`model.ValidSavedQueryName`'s), not a bridge-invented one — the guard against re-implementing validation at two layers |

### 5.4 `internal/bridge/stream.go` — P52 §13's `bridge/stream` row

`stream_test.go` (`package bridge_test`, a `fakeSession` implementing `StreamSession` plus a real
`enginetest.Host`):

| Test | Asserts | §13 item |
|---|---|---|
| `TestFramePassthroughIntegrity` | A 1 MiB `fixture:echo-data` request sent through `conn.Receive` comes back through `conn.Send` **byte-identical** (`bytes.Equal`, not a struct compare) | frame passthrough integrity for a ≥1 MB payload |
| `TestDemuxByTag` | A control-tag `op:start` emitted by the fixture reaches an `enginehost.Subscribe()` consumer and **never** reaches the session; a data-tag frame reaches the session and never reaches the subscriber | demux by tag |
| `TestBackpressureAtTheBoundedChannel` | A session whose `Send` blocks until released: after `dataQueueFrames` frames the host stops delivering, and every frame arrives in order once released, none dropped | backpressure at the bounded channel |
| `TestSessionCloseDetaches` | `Receive` returning an error makes `ServeEngineStream` return; a later `host.SendData` neither panics nor blocks | — |
| `TestSupersededSessionStopsReceiving` | Attaching a second session detaches the first: frames after the swap reach only the second (P54's `AttachStream` generation) | — |
| `TestEngineDownKeepsSessionOpen` | After `fixture:crash`, `ServeEngineStream` is still in its `Receive` loop and logs rather than returning (§4.8's comment) | — |

### 5.5 `internal/bridge/files.go`

`files_test.go` (`package bridge_test`, a `recordingDialogs` and a real `t.TempDir()` file):

| Test | Asserts |
|---|---|
| `TestChooseSaveBasenameGuard` | `defaultName: "a/b/c/key.csv"` reaches the dialog as `Filename: "key.csv"`, `Directory: <home>/Downloads` (D9, `files.ts:29-30`) |
| `TestChooseSaveCancel` | A dialog returning `""` yields `{Canceled: true, FilePath: nil}` (D7) |
| `TestChooseSaveSuccess` | A path yields `{Canceled: false, FilePath: &path}` |
| `TestChooseSaveEmptyNameRejected` | `defaultName: ""` returns `E_BAD_REQUEST` and calls no dialog |
| `TestChooseOpenReturnsStat` | A dialog returning a real temp file yields `{path, name: filepath.Base(path), size}` with the real byte count |
| `TestChooseOpenCancel` | `""` yields `{Canceled: true, File: nil}` |
| `TestChooseOpenMissingFile` | A dialog returning a path that no longer exists returns `E_INTERNAL` naming the stat failure, rather than a zero-size file |
| `TestWailsFilterTranslation` | Table: `ConnectionDialog.vue`'s real two-filter list (`sqlite/sqlite3/db/db3` + `*`) → **no filter** (D8); a single-group list → `("SQLite database", "*.sqlite;*.sqlite3;*.db;*.db3")`; two groups with no `*` → one flattened pattern with the first group's name; an empty list → no filter |
| `TestChooseOpenPassesTitle` | `title` reaches the dialog request unchanged, and an omitted title is `""` |

### 5.6 `internal/bridge/lifecycle.go`

`lifecycle_test.go`: `Flushed()` calls the `Flusher` exactly once per call; a `nil` `Flusher` is a
silent no-op; the method has no return value (a compile-time assertion via a `var _ interface{
Flushed() } = (*bridge.LifecycleService)(nil)`).

### 5.7 `internal/shell` — P52 §13's `shell` row

`menutemplate_test.go` (`package shell`, the template is the subject) — the direct Go analogue of
`tests/unit/menu.spec.ts`:

| Test | Asserts |
|---|---|
| `TestPackagedBuildHasNoDevItems` | `BuildTemplate(name, false)` contains no `Reload` and no `OpenDevTools` role anywhere (spec case 1) |
| `TestDevBuildHasBothDevItems` | `BuildTemplate(name, true)` contains both (spec case 2) |
| `TestSectionsAndLabelsMatchMenuTs` | Four sections in order (`<appName>`, Edit, View, Window); the 12 emitting items' labels and channels as a table against `menu.ts` |
| `TestQuitItemHasNoRole` | The Quit item is `ItemQuit`, its accelerator is `CmdOrCtrl+Q`, and its `Role` is the zero value — the regression guard for §1.3's `terminate:` finding |
| `TestShowAllNotUnhide` | The app section uses `application.ShowAll`, never `application.UnHide` (§1.4's dead-role finding) |
| `TestCloseWindowIsReaccelerated` | The Window section's `CloseWindow` role carries `CmdOrCtrl+Shift+W`, not the default `CmdOrCtrl+W` (`menu.ts:120-122`) |

`accel_test.go` (`package shell`): a parity table over all 13 `SHORTCUTS` `global: true` rows,
asserting the exact Wails accelerator string, with `tab.next`/`tab.prev` producing `Ctrl+Tab` /
`Ctrl+Shift+Tab` and **never** `Control+…` (§1.4).

`menu_wails_test.go` (`package shell_test`, real `*application.App`): `BuildMenu` produces a menu
whose every accelerator **actually parsed** — walk the built `*application.Menu` with `ItemAt`,
and for every item the template gave an accelerator, assert `GetAccelerator() != ""`. This is the
test that catches `SetAccelerator`'s silent failure mode (`menuitem.go:275-287`); without it a
mistranslation is invisible.

`debounce_test.go` (`package shell`): three `trigger`s inside the window fire the callback once,
with the last closure; a `trigger` after the window fires again; `cancel` before the window fires
nothing; `cancel` is safe with no pending timer; `go test -race` with concurrent `trigger`/`cancel`
is clean.

`quit_test.go` (`package shell_test`, real `*application.App` but never `Run()` — `RequestQuit` is
not exercised, only `ShouldQuit`/`Flushed`/`Shutdown`, with a 50 ms timeout):

| Test | Asserts |
|---|---|
| `TestShouldQuitReturnsFalseImmediately` | The first call returns `false` **within a millisecond** — the direct guard on D2's non-blocking requirement |
| `TestFlushAckCompletesTeardown` | `ShouldQuit()`, then `Flushed()`: `beforeFlush` ran before the ack, `teardown` ran after it, `done` is set, and the total elapsed time is well under the timeout |
| `TestFlushTimeoutStillTearsDown` | No ack: `teardown` still runs, after roughly the timeout, and a warn line is logged |
| `TestLateAckIsHarmless` | `Flushed()` after the timeout does not panic and does not re-run anything |
| `TestSecondShouldQuitReturnsTrue` | After the teardown, `ShouldQuit()` returns `true`; a concurrent burst of ten calls during the flush all return `false` and start exactly one flush |
| `TestShutdownWithoutShouldQuit` | `Shutdown()` alone (the signal path) runs both halves once |
| `TestTeardownRunsOnceAcrossBothPaths` | `ShouldQuit` → ack → `Shutdown()`: each half ran exactly once (D3) |
| `TestFlushBeforeCloseIsEmitted` | The recorded emitter saw exactly one `kira:app:flush-before-close`, before the ack was possible |

`security_test.go` (`package shell`): `Harden()` denies every `PermissionType` except
`PermissionClipboardRead`, which is `PermissionAllow`; `JavaScriptCanOpenWindowsAutomatically` is
explicitly false rather than unset; and a table pins the *set* of permission types the app has an
opinion about, so a future Wails version adding one fails the test rather than silently defaulting.

`window_test.go` (`package shell_test`, real SQLite): `Options` with no stored bounds returns
`1280×800` at Wails' default position with `X == 0 && Y == 0`; `Options` with a stored rectangle
returns it; a persist callback driven directly writes a `model.WindowBounds` readable through
`LayoutRepo.GetAll`; an `int`→`float64` conversion of a negative `X` (a second monitor to the left)
survives.

### 5.8 What is not testable here, and is not pretended to be

`internal/shell/app.go`'s three adapters (`NewEmitter`, `NewDialogs`, `RegisterEngineStream`) and
`AttachReopen` are thin glue over Wails calls that need a running app and, for the dialogs, a user.
`NewEmitter` is covered indirectly (§1.7 proved `Emit`→`On` works in-process, and
`events_test.go` covers everything above it); the other three are covered by §6's manual macOS
checks and by the boot check in §8. Stating this beats inventing an assertion that only proves the
adapter compiles.

## 6. The macOS checks this phase owes, and why they cannot be closed here

P52 §11 lists two of these as open; §1 adds three more. All five are 15-minute checks on the Apple
Silicon machine P51 part 4 and P52 G1 used, and the implementing session must record the result —
including "not available in this session", per the precedent P55 §10 criterion 4 set.

| Check | Why it cannot be closed from Linux | What "pass" looks like |
|---|---|---|
| **Cmd+Q intercepted** (P52 §11) | `applicationShouldTerminate:` is AppKit | Cmd+Q logs the flush emission, the renderer's `tabsSave` lands, and the app quits in well under 2 s — not exactly 2 s, which would mean the ack never arrived |
| **`navigator.clipboard` under WKWebView** (P52 §9/§11) | `Permissions` has no darwin implementation at all (§1.6) | The grid's copy (`clipboard.ts`'s `copyText`) and paste both work in the packaged build |
| **The Dock/reopen path** (D10) | `applicationShouldHandleReopen:` is AppKit; and `hasListeners` has no darwin Go export (§1.5) | Closing the window leaves the app running; clicking the Dock icon brings a window back with the stored bounds |
| **Window bounds actually persist** | `WindowDidResize`/`WindowDidMove` delivery depends on the same `hasListeners` path | Resize, quit, relaunch: the window comes back where it was |
| **DevTools is really absent in a packaged build** | It is a build tag applied by `task darwin:package`, not something a Linux `go build` exercises | Alt+Cmd+I does nothing and the View menu has no Developer Tools item in the packaged `.app` |

## 7. Scope boundary

**Zero `src/` changes.** Checked, not assumed. Every TS file this phase reads is a source of truth
being ported, not a target:

- `src/main/index.ts`, `window.ts`, `menu.ts`, `security.ts`, `engine-config.ts`,
  `ipc/files.ts`, `ipc/queries.ts`, `ipc/settings.ts`, `ipc/ops.ts`, `ipc/layout.ts`,
  `ipc/filters.ts`, `ipc/registry.ts`, `ipc/errors.ts` — **read only**. They keep running the
  Electron app unchanged through the coexistence window; P57 deletes `src/main`.
- `src/shared/protocol/ipc.ts`, `src/shared/domain/shortcuts.ts`, `queries.ts`,
  `src/shared/protocol/engine-ops.ts` — **read only**, for the literal channel strings, chords and
  op names this plan requires be read rather than inferred (AGENTS.md's P54 finding).
- `src/preload/index.ts`, `src/renderer/bridge/control.ts`, `src/renderer/state/tabs.ts`,
  `src/renderer/project/ConnectionDialog.vue`, `src/renderer/state/objectStore.ts` — **read only**,
  to establish what the renderer actually consumes (§1.1's dead-channel finding, §1.3's ack path,
  §1.2's real filter list).
- No `tests/` change, no `scripts/` change, no `package.json` change — no new script and no new npm
  dependency. `bun run build:engine` already exists (P54).

**One `shell/frontend/` change:** `shim/kira-bridge.ts`'s `appFlushed` (D11). Not `src/`.

**No new Go dependency.** `go.mod`/`go.sum` are untouched; `pkg/application` is already required.

**One deletion:** `shell/testdata/engine-ping.mjs` (D12). Nothing else references it —
`internal/enginehost/frame.go:13` and `internal/enginetest/testdata/engine-fixture.mjs:4` mention it
only in comments, which are updated to say it is gone.

**No gate.** P52 §15: G1 was the only gate and it passed at 261.7 MB.

## 8. Acceptance criteria

1. `bun run test:go` is green, and every item in P52 §13's `bridge`, `bridge/stream` and `shell`
   rows has a named test in §5.
2. **All 61 channels of `src/shared/protocol/ipc.ts` are accounted for**, and a comment in
   `bridge/events.go` records the accounting: 39 request/response methods across 13 services, 19
   emitted push channels, 1 deliberately-unemitted (`kira:engine:state`, D5), 1 fire-and-forget
   (`Lifecycle.Flushed`), 1 stream (`engine`). `grep -rn "P56" shell/` returns nothing but
   historical references in doc comments.
3. `gofmt -l shell` is empty; `go vet ./...` is clean; `go test -race ./internal/bridge/...
   ./internal/shell/...` is clean (the three packages in this phase with real concurrency are
   `stream`, `quit` and `debounce`).
4. `git diff --name-only` shows **zero** changes under `src/`, `tests/` and `scripts/`, and no
   `package.json` change. `bun run lint` and `bun run typecheck:node` pass (both should be near
   no-ops, which is itself the check that this held).
5. `wails3 generate bindings -b -i -ts` regenerated from `shell/` **pinned to the go.mod version**
   (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.15` — AGENTS.md's P55 finding
   about `@latest` skewing to beta.16), then `bun run build:engine && bun run build:wails` succeeds.
6. **The app boots and the shell works**: the menu shows four sections with working accelerators; a
   menu item's channel reaches the renderer (the shim already subscribes to all 19); the window
   opens at its stored size and a resize survives a restart; a connect against the **real** engine
   (D12) produces `connecting` → `connected`; opening a table returns rows over the `engine`
   Stream; the status bar's CPU/memory readout updates every 5 s (`kira:app:metrics` reaching the
   renderer for the first time); and quitting emits `kira:app:flush-before-close`, gets an ack, and
   exits without hitting the 2 s timeout.
7. §6's five macOS checks are run and recorded in the commit message, or their unavailability is
   stated explicitly rather than implied.
8. The Electron app still builds and runs (`bun run build`) — the coexistence rule, in force until
   P57.
9. `AGENTS.md` gains a **"P56 implementation findings"** entry on the same pattern as P52–P55's.
   Five things are already worth writing down before implementation starts and should be confirmed
   or corrected there:
   - **`go build ./internal/...` now needs `libgtk-4-dev`/`libwebkitgtk-6.0-dev`/`pkg-config` on
     Linux**, because `internal/shell` imports `pkg/application` (cgo). This retires the P53 finding
     that `./internal/...` needs nothing but the Go toolchain; per-package loops
     (`go test ./internal/storage/... ./internal/bridge/...`) still do not.
   - **`application.Options.ShouldQuit` is Wails' `before-quit`, and it must not block** (§1.3),
     together with the reason (the ack is a bound call that needs the main thread).
   - **A darwin `role: Quit` menu item's `OnClick` never fires** (`terminate:` selector), and
     **`Control` is not a valid Wails modifier** — both silent failures.
   - **`SetAccelerator` logs and drops** an unparseable accelerator rather than returning an error.
   - **`application.New` + menu building + `Event.Emit`/`Event.On` + `HandleStream` all work in a
     plain headless `go test` on Linux**, and `New` returns the same singleton on a second call —
     the property that makes `internal/shell` testable at all.

## 9. Sequencing

Seven milestones, each ending at a green `go build ./internal/...` and `go test ./internal/...`.
M0–M2 are Wails-free and keep the bare-toolchain loop alive; M3 is where the GTK/WebKit headers
become necessary, so the environment step in §10 belongs immediately before it.

- **M0 — `appcore.Emitter` + `internal/bridge/events.go`.** The 20 constants, `Events`,
  `Signal`, `SettingsChanged`, `Attach`/detach, and §5.1's five tests against a recording emitter.
  First because every later milestone emits through it. Ends with the channel-constant table
  green — the cheapest possible guard against a typo that would otherwise surface as "the menu does
  nothing" three milestones later.
- **M1 — the four completed request/response services and `bridge/queries.go`.**
  `SettingsService.Set` (+ the conditional cache re-push + the unconditional broadcast),
  `LayoutService.Set`, `FiltersService.Replace`, `OpsService.Cancel`, the nine `QueriesService`
  methods, and `bridge/lifecycle.go`. All Wails-free, all storage- or fixture-backed. Ends with 38
  of the 39 request/response channels real (files is M2).
- **M2 — `bridge/stream.go` and `bridge/files.go`.** `fixture:echo-data` lands first inside this
  milestone (D13), since §5.4's two headline tests need it. Then the `Dialogs` seam, the filter
  translation and §5.5's table. Still Wails-free; still `./internal/...` on a bare toolchain.
- **M3 — `internal/shell`: `accel.go`, `menutemplate.go`, `menu.go`.** The first Wails import.
  Install the GTK/WebKit dev headers (§10) before starting. Ends with §5.7's menu tests, including
  the real-`*application.App` accelerator-parse check that catches the `Control+Tab` trap.
- **M4 — `internal/shell`: `debounce.go`, `window.go`, `security.go`.** Bounds read at creation,
  persisted behind the 300 ms debounce, cancelled on close; the runtime-ready cold-start line; the
  posture of §1.6 with its comment block.
- **M5 — `internal/shell/quit.go`.** The `Quitter`, both `sync.OnceFunc` halves, and §5.7's
  eight-row quit table. Independent of M3/M4 in principle; last of the `internal/shell` work because
  its tests are the fiddliest to get deterministic.
- **M6 — wiring.** `internal/shell/app.go`'s adapters; `appcore.Deps` gains `Events`; `main.go`'s
  thirteen services, `ShouldQuit`/`OnShutdown`, menu, window, stream registration, reopen handler,
  `ApplicationShouldTerminateAfterLastWindowClosed: false`, and `resolveEngine()`'s switch to the
  real bundle (D12) with `testdata/engine-ping.mjs` deleted; the shim's `appFlushed` (D11). Finish
  with `gofmt -l shell` (empty), `go vet ./...`, `bun run test:go`,
  `wails3 generate bindings -b -i -ts`, `bun run build:engine`, `bun run build:wails`, and the real
  boot check of criterion 6.

M0 before everything is the only hard ordering constraint (M1, M2, M5 and M6 all emit). M3, M4 and
M5 could be reordered freely among themselves.

## 10. Environment notes for the implementing session

- **A fresh container has none of the toolchain** (AGENTS.md, P52 findings). M0–M2 need only the Go
  toolchain plus cgo for `mattn/go-sqlite3`. **From M3 on, `go build ./internal/...` itself needs**
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`, because `internal/shell`
  imports `pkg/application` (§1.8). This is new in P56 and retires the P53 finding.
- **Install `wails3` pinned**: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.15`
  with `export PATH=$PATH:$(go env GOPATH)/bin`. AGENTS.md's P55 finding: `@latest` resolved to
  beta.16 in that session, a silent skew between the bindings generator and the vendored runtime.
- **The Wails source is already in the module cache** at
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/`. Read it there;
  `wails.io`/`v3.wails.io` are 403-blocked from both of this project's environments and there is no
  docs site to prefer to the source.
- **`shell/runtime/` is git-ignored and must be populated**: `scripts/vendor-node.sh` for
  `runtime/node/bin/node`, `bun run build:engine` for `runtime/engine/engine.cjs`. Both were present
  in the session that wrote this plan; a fresh container will not have them, and after D12 the app
  refuses to start without the engine bundle.
- **`internal/shell`'s tests share one `*application.App`** and it cannot be reset
  (`application.go:49-51`). Write them to tolerate that: unique event names, always unsubscribe, and
  never call `Run()`.
- **A background process started in one shell invocation cannot be signalled from a later one** in
  this sandbox (AGENTS.md, P51) — start, poll, test and tear down a `wails3 task dev` run inside a
  single Bash invocation with a 120–150 s timeout, since the first build takes ~60 s.
- **Screenshotting a headless WebKitGTK window** (`xdotool search --name`, `import -window <id>`,
  AGENTS.md's P52 findings) is still the practical way to tell "the real app rendered" from "blank
  page because JS threw" here, and is the only way criterion 6's menu/window checks can be
  approximated on Linux at all. The real answers are §6's macOS checks.
