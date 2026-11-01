# P430 Clipboard capture hotkey: link or text into Kira Space

Plan for `docs/v0.2.24/SPEC.md` row P430 (Stream B). Base: `4982f7a66` (`chapter/v0.2.24-stream-b`, P423, P427, P428,
P429 landed). Discovery ran through `codegraph_explore` (12 calls: `shell.OpenWindow`/`WindowOpenerDeps`/`Chord`/
`Shortcuts`; Space `main.go` window wiring, `Ephemeral`, purges; `HostViewService` `Open`/`openTarget`/`openIssue`/
`issueProvider`/`HostViewTargets`; `AdeTaskService.CaptureTask`/`CreateTask`/`UpdateTask`, `TaskBoard.CaptureTask`,
`AdeTaskRepo` `insertTask`/`CaptureTask`/`CreateTask`; `validateAdeName`/`validateAdeNotes`; Space `SettingsRepo`
`GetAll`/`Set`, `model.Settings`/`SettingsPatch`, `SettingsService.Set`/`OnChanged`, `settingsDomain.ts`; `App.vue`,
`HostViewWindow`, host view store; `shell.Options`/`Attach`/`WindowRegistry` `Focus`/`Close`/`AddEphemeral`;
flowharness `New`/`Opt`/`WindowManager`, appwire `ShellHooks`/`BindShell`), then Read/Grep for the Wails beta.28
source (`GlobalShortcutManager`, darwin/windows/linux X11/portal backends, `ClipboardManager`, `MacWindowClassPanel`,
`windowFocus`), `main.ts` boot, `bridge/index.ts`, UI spec support, settings panes, `en.json`, `ARCHITECTURE.md`.

One sequential Sonnet implementer.

## Ask

- Copy in any app, press a global hotkey, Kira Space opens a quick-capture popup that reads the clipboard once.
- No Accessibility permission. No selection reading.
- Popup recognises the content and preselects an action, so Enter confirms:
  - GitHub or Azure PR link: open the PR view (P427).
  - Jira key or link: open the issue viewer (P428).
  - Anything else: Later.
- macOS: `RegisterEventHotKey` (no Accessibility). Wayland: portal or the desktop's shortcut settings.
- No tray icon. Works while the process runs (macOS keeps it running with no window). Windows and Linux: only while
  running, no background mode.
- Out of scope: tray icon, clipboard watcher, URL scheme, Share/Services menu, browser extension.

## Findings (current tree and Wails beta.28)

- **Wails beta.28 ships global shortcuts.** `application.App.GlobalShortcut *GlobalShortcutManager`:
  `Register(accel, cb) error`, `Unregister(accel) error`, `IsRegistered`, `UnregisterAll` (called at shutdown).
  Backends: darwin Carbon `RegisterEventHotKey` (comment: no Accessibility needed), Windows `RegisterHotKey`, Linux X11
  `XGrabKey`, Wayland `org.freedesktop.portal.GlobalShortcuts` over `godbus/dbus/v5` (already an indirect dep).
  Register before `app.Run` is deferred to start; an OS rejection then goes to `Options.ErrorHandler`, not the caller.
  The callback runs on its own goroutine.
- **Wayland portal semantics.** `register` returns nil at once; the binding runs on a worker goroutine. The compositor
  (and the user, in the desktop's shortcut settings) picks the final trigger. Failures (`cannot connect to session
  bus`, `portal session failed`, `BindShortcuts failed`, `portal did not grant shortcuts`) reach only `ErrorHandler`.
  `IsRegistered` reports what was asked, not what is bound.
- **Unsupported build tags** (`server`, `linux && !cgo`) return `global shortcuts are not supported on this platform`.
- **Clipboard:** `App.Clipboard.Text() (string, bool)`, main-thread dispatched by Wails, text only. No image read.
- **Popup window class on macOS:** `MacWindow.WindowClass = MacWindowClassPanel` with
  `PanelPreferences{NonActivating, FloatingPanel}`. Wails `windowFocus` on a non-activating panel calls
  `orderFrontRegardless` + `makeKeyWindow` and skips `activateIgnoringOtherApps`. So the popup shows over the
  frontmost app, takes keys, and does not bring the other Kira windows forward. Other useful options:
  `AlwaysOnTop`, `DisableResize`, `Frameless`, `InitialPosition: WindowCentered` + `Screen`, `Windows.HiddenOnTaskbar`.
- **No global hotkey or clipboard code in the tree.** `shell.Chord`/`shell.Shortcuts` build menu accelerators only.
- **Window plumbing.** `shell.Options` hardcodes `MinWidth 1024`/`MinHeight 640` and the workbench size; a popup
  needs its own options. `shell.OpenWindow` attaches bounds persistence (`Attach`) and the close flush. Ephemeral keys
  come from `WindowOpenerDeps.Ephemeral` in Space `main.go` (host view prefix `hostview-`, review keys); stale rows are
  purged at startup (`purgeHostViewWindows`).
- **Host view entry points (P427/P428).** `HostViewService.Open(ctx, {url})` classifies: change request link via
  `githost.Registry.ParseChangeRequestLink`, else issue via `issueProvider` (`issuetracker.Registry.ParseRef` +
  `IssueDetails` role), else `notViewable` error. It focuses an open window for the same identity. Capture reuses it.
- **Later.** `AdeTaskService.CaptureTask({title})` inserts at the top of Later (`insertTask(..., top=true)`); title
  only, max 500 bytes (`adeMaxNameBytes`). `UpdateTask` patches `notes` (1 MiB), `hostUrl` (validated by
  `Hosts.ParseLink`), `jira`. `adewire/**` is not Stream B's, so no new wire field: capture composes the two existing
  calls server-side.
- **Settings** are leaf rows (`settings` table, `section.key`), read in `SettingsRepo.GetAll`, written in `Set`,
  validated in `SettingsPatch.Validate`, mirrored in `frontend/src/state/settingsDomain.ts`. `SettingsService.Set`
  calls `OnChanged(merged)`. New leaves need no migration.
- **Space `main.go` ErrorHandler** handles only `*application.FatalError`; every other error is dropped today.
- **UI specs** read Go-written contract fixtures (`tests/contract/*.json`, e.g. `host-view.json`) and mock IPC
  through `tests/ui/support/ipcChannels.ts`/`mockRuntime.ts`.

## Design

### 1. Settings (`capture.enabled`, `capture.hotkey`)

- Go `model.CaptureSettings{Enabled bool; Hotkey string}`, default `{true, "CmdOrCtrl+Alt+Shift+K"}`. Four keys: rare
  enough to grab globally by default without stealing a chord another app uses.
- `CapturePatch{Enabled *bool; Hotkey *string}`; `validateCaptureSection` parses the hotkey with
  `shell.ParseChord` (below) and refuses one that equals any `shell.Shortcuts` chord (the app's own menu accelerators,
  which a global grab would steal from itself).
- `readCapture` / `upsertCapture` in `repos/settings.go`; `Settings.Capture`, `SettingsPatch.Capture`.
- TS: `captureSettingsSchema` in `settingsDomain.ts` (`enabled` boolean default true, `hotkey` string default as Go),
  added to `settingsSchema`, `settingsPatchSchema`, `defaultSettings`.
- No migration. Space migrations 0061+ stay unused by this phase.

### 2. Shell (`internal/shell/`, repo root)

- `chord.go`: `ParseChord(s string) (Chord, error)` and `Chord.Accelerator()` round trip (existing renderer). Rules:
  at least one of CmdOrCtrl/Ctrl/Alt; Shift alone is not enough; key is A-Z, 0-9, F1-F12, Space, or one of
  `` , . / ; ' [ ] - = ` ``; canonical order CmdOrCtrl, Ctrl, Alt, Shift, Key. Wails' own `parseAccelerator` is
  unexported, so this is the validation the settings write needs; Wails still re-parses at register.
- `hotkey.go`: `GlobalShortcuts` interface (`Register(accel string, cb func()) error`, `Unregister(accel string)
  error`) and `HotkeyBinding`, which holds the one active accelerator: `Apply(enabled bool, accel string, cb func())
  HotkeyState` unregisters the previous one, then registers the new one. `HotkeyState{State, Accelerator, Reason}`,
  states `off`, `active`, `requested` (Wayland: asked, binding unconfirmed), `failed`. `IsWayland()` reads
  `XDG_SESSION_TYPE == "wayland"` or `WAYLAND_DISPLAY != ""` (the Wails rule). A `ReportError(err)` entry turns a later
  `ErrorHandler` report into `failed` with its reason. Mutex-guarded: settings writes, the startup apply and
  `ErrorHandler` race.
- `popup.go`: `PopupSpec{Width, Height int}` and `PopupOptions(sec, key, cfg, spec, screen)`:
  `URL "/?window=<key>"`, `Name key`, width 560, height 320, no min size, `DisableResize`, `AlwaysOnTop`,
  `Frameless`, `InitialPosition WindowCentered` on `screen`, `Windows.HiddenOnTaskbar`, Mac
  `WindowClass: MacWindowClassPanel`, `PanelPreferences{NonActivating: true, FloatingPanel: true}`, same security
  options (`Harden()`), same background colour. `OpenPopup(d WindowOpenerDeps, key string, spec PopupSpec)` registers
  it with `AddEphemeral`, wires close flush and the `WindowClosing` hooks exactly as `OpenWindow` does, and skips
  `Attach`'s bounds persistence (always centered, never restored). Screen: the screen of `app.Window.Current()` when
  one is focused, else primary (Wails exposes no cursor screen; verify in the source at implementation time and use
  it if one exists).
- `WindowRegistry` gains nothing: `Focus` and `Close` already exist.

### 3. Capture service (`apps/kira-space/internal/bridge/capture.go`, new)

`CaptureService`, bound to Wails. Fields: `Deps`, `HostView *HostViewService`, `Tasks *AdeTaskService`,
`Windows hostViewWindowRows`, `Clipboard func() (string, bool)`, `OpenPopup func(key string)`,
`FocusWindow func(string) bool`, `CloseWindow func(string) bool`, `Binding *shell.HotkeyBinding`,
`Shortcuts shell.GlobalShortcuts`. Window key prefix `capture-`; `IsCaptureKey(key)`.

- **Trigger** (unbound method, the hotkey callback): read the clipboard once; trim; cap at 64 KiB on a UTF-8
  boundary (`Truncated` flag); classify; build a `CaptureItem`; if a popup is open, replace its item, emit
  `kira:capture:item` to that key, and focus it; else create a window row (`capture-<uuid>`, as `openTarget` does),
  store the item, `OpenPopup(key)`. One popup at a time. Serialised by a mutex.
- **Classification** (`classifyCapture`): the whole trimmed text, no whitespace, at most 2048 bytes (same cap as host
  view):
  - `hosts.ParseChangeRequestLink` hit: kind `changeRequest`, label from provider terms (`PR #7 owner/repo`).
  - else `HostView.issueProvider` hit: kind `issue`, label `<Tracker label> <KEY>`.
  - else non-empty: kind `text`.
  - empty or non-text clipboard: kind `empty`.
  Classification lives beside `HostViewService` so it reuses `issueProvider` and `hosts()`; it is a two-branch lookup
  over existing parsers, so no unit test (CLAUDE.md test bar).
- `CaptureItem` (wire): `id`, `kind` (`changeRequest|issue|text|empty`), `text`, `truncated`, `label`,
  `actions` (ordered, first preselected), `title` (prefill: first non-empty line, cut to 500 bytes on a rune
  boundary). Actions: `changeRequest` -> `[openChangeRequest, later]`; `issue` -> `[openIssue, later]`; `text` ->
  `[later]`; `empty` -> `[]`.
- **Bound methods:**
  - `WindowItem(ctx, {windowKey}) (*CaptureItem, error)`: the popup's boot read; null for a non-capture key.
  - `Confirm(ctx, {windowKey, itemId, action, title}) (CaptureResult, error)`: refuses a stale `itemId`
    (`ipcerr.Contract`) or an action not in the item's list. `openChangeRequest`/`openIssue` call
    `HostView.Open(ctx, {url: text})` and return its `HostViewOpen`. `later` calls `Tasks.CaptureTask({title})`
    (title required, 500 bytes), then, when there is more to keep, one `Tasks.UpdateTask` with `notes` (the full text
    when it differs from the title), `hostUrl` (text when `Hosts.ParseLink` recognises it), `jira` (key and URL for
    an issue item). If that patch fails the task still exists: return the error mapped as usual, text names the
    captured task, and the popup stays open with the error so nothing is lost silently. Success closes the popup.
  - `Dismiss(ctx, {windowKey})`: closes the popup; idempotent.
  - `Status(ctx) (shell.HotkeyState, error)`: current binding state.
- **Hotkey apply:** `Apply(settings)` from appwire on boot and from `SettingsService.OnChanged`; emits
  `kira:capture:status` when the state changes. `ReportShortcutError(err)` forwards to `Binding.ReportError`.
- **Popup lifetime:** closed on confirm, Esc, or focus loss (renderer `blur` via VueUse `useWindowFocus` calls
  `Dismiss`). Closing, not hiding, keeps no idle webview alive (P433 minimal RAM); each trigger boots a fresh one.
  `OnWindowClosing` forgets the item. Startup purges `capture-` rows like `purgeHostViewWindows`.

### 4. Wiring

- `appwire`: build `CaptureService` next to `HostView`; bind it as a Wails service. `ShellHooks` gains
  `OpenPopup func(key string)`, `Clipboard func() (string, bool)`, `Shortcuts shell.GlobalShortcuts`; `BindShell`
  sets them on `CaptureService` and runs the first `Apply`. Chain `SettingsService.OnChanged` so the existing hook
  keeps running and capture re-applies.
- Space `main.go`: `Ephemeral` adds `bridge.IsCaptureKey`; `OnWindowClosing` adds `wired.Capture.Forget`;
  `ShellHooks.OpenPopup` -> `shell.OpenPopup(winDeps, key, spec)`; `Clipboard` -> `app.Clipboard.Text`;
  `Shortcuts` -> `app.GlobalShortcut`. `ErrorHandler`: a non-fatal error whose text starts with
  `failed to register global shortcut` or `global shortcuts:` goes to `wired.Capture.ReportShortcutError`. The prefixes
  are Wails' own strings (beta.28 source); name that in a comment. `purgeCaptureWindows` at startup.
- macOS: `Mac.ApplicationShouldTerminateAfterLastWindowClosed: false` already keeps the process (and the hotkey)
  alive with no window. No activation policy change.

### 5. Frontend (`apps/kira-space/frontend/src/`)

- `capture/wire.ts`: zod schemas for `CaptureItem`, `CaptureResult`, `HotkeyState`.
- `capture/state.ts`: Pinia `useCaptureWindowStore` (`item`), one concern, like `useHostViewWindowStore`.
- `capture/queries.ts`: TanStack `useCaptureStatus` (push-invalidated by `kira:capture:status`, `staleTime: Infinity`),
  `useConfirmCapture`, `useDismissCapture` mutations. The item itself is store state set at boot and replaced by
  `kira:capture:item`.
- `capture/CaptureWindow.vue`: header (kind badge + label, or the text preview, 6 lines max, `truncated` note);
  action list from shadcn-vue `command` (keyboard nav, first action selected); for `later`, a shadcn-vue `input`
  holding the editable title; Enter confirms the selected action (also inside the title input); Esc dismisses
  (VueUse `onKeyStroke`); `kbd` hints. `empty`: message plus a Dismiss button, Enter dismisses. Errors render in an
  `alert`. Tailwind only.
- `main.ts`: when `windowKey` starts with `capture-`, fetch `control.captureWindowItem({windowKey})` and set the store,
  as the host view boot does. `App.vue`: `<CaptureWindow v-if="capture.item" />` before the host view branch; the
  panel toggles skip a capture window.
- `bridge/index.ts`: `captureWindowItem`, `captureConfirm`, `captureDismiss`, `captureStatus`, `onCaptureItem`,
  `onCaptureStatus`.
- `workbench/settings/CapturePane.vue` (new section `Capture` in `SettingsDialog.vue`): shadcn-vue `switch` for
  enabled; chord recorder (focusable `input` that turns the next keydown with a modifier into the canonical string;
  Backspace clears, Esc cancels); Reset to default; status line from `useCaptureStatus`: active, failed with reason,
  Wayland `requested` note ("Your desktop asks to confirm the shortcut; change it in the desktop's keyboard
  settings"), off. Save through the existing settings store `set`. The recorder is a keydown-to-string map of about
  20 lines: VueUse has no chord recorder and no library is worth adding (requirement: produce Wails accelerator
  syntax exactly).
- i18n under `space.capture.*`, `space.settings.capture.*`, `backend.space.capture.*` (streams.md subtrees).

### 6. Libraries

- Wails beta.28 `GlobalShortcutManager` and `ClipboardManager`: no new Go module, `go.mod`/`go.sum` unchanged.
  `golang.design/x/hotkey` is declined: Wails already covers macOS, Windows, X11 and adds the Wayland portal that
  library lacks.
- shadcn-vue `command`, `input`, `switch`, `kbd`, `alert`, `button`, `badge` (all present). No new primitive.
- VueUse `onKeyStroke`, `useWindowFocus`. TanStack Query, Pinia, zod. No npm dependency.

## Security

- Clipboard is read only on the user's hotkey press, once, in Go; the renderer never gets clipboard access.
- Captured text is shown as text (no `v-html`). Links open only through `HostView.Open`'s own parsers.
- Size caps: 64 KiB capture, 2048-byte link classification, existing task caps.
- Not logged: captured text never goes to `slog`; only kind and byte length at debug level.

## Tests

Flow test and UI spec split at the IPC boundary.

### Flow test (`apps/kira-space/internal/flows/captureflow/`, new package, `main_test.go` + `capture_test.go`)

Harness seams (`internal/flowharness/`): `Clipboard` fake (`SetText`, `SetEmpty`); `Shortcuts` fake recording
`Register`/`Unregister`, `Fire(accel)` runs the callback synchronously, `FailNext(err)`; `WindowManager` records
`OpenedPopups`; option `WithWayland()` makes `shell.IsWayland` true through a seam on `HotkeyBinding`
(not process env). `BindShell` in the harness wires all three.

Scenarios:
1. Boot: default chord registered once, `Status` `active`.
2. GitHub PR link (`fakehost` Forge link) on the clipboard, fire: popup opened, `WindowItem` kind `changeRequest`,
   first action `openChangeRequest`; `Confirm` opens a `hostview-` window with the PR target; popup closed.
3. Azure PR link (P423 `WithAzure` fake): same as 2 with the Azure target.
4. Jira key, then Jira browse URL: kind `issue`; `Confirm openIssue` opens the issue target; both share one window.
5. Multi-line text: kind `text`; `Confirm later` with an edited title: task at the top of Later, notes = full text.
6. PR link with action `later`: task `hostUrl` set. Jira key with `later`: task `jira` set.
7. Empty clipboard: kind `empty`, no actions; `Confirm` refused; `Dismiss` closes.
8. Second fire while open: same key, new item id, `kira:capture:item` emitted to the key, window focused; `Confirm`
   with the old id refused.
9. Settings: new chord unregisters the old and registers the new; chord equal to a menu accelerator or invalid
   refused by `SettingsService.Set`; `FailNext` -> `failed` with reason; disable -> unregistered, `off`;
   `ReportShortcutError` -> `failed`; `WithWayland` -> `requested`; each change emits `kira:capture:status`.
10. Text over 64 KiB: `truncated` true, stored text 64 KiB.

The test writes `apps/kira-space/tests/contract/capture.json` (one item per kind, each status) as the P427 flows do.
Coverage gate: every bound `CaptureService` method is called.

### UI spec (`apps/kira-space/tests/ui/capture.spec.ts`, `settings-capture.spec.ts`)

- Popup per fixture kind: label/preview, preselected action, Enter sends `captureConfirm` with the fixture args;
  ArrowDown to Later, edit title, Enter sends `later` with the title; Esc and window blur send `captureDismiss`;
  `empty` state; a pushed `kira:capture:item` replaces the content; a confirm error renders and keeps the popup.
- Settings pane: toggle writes `capture.enabled`; recorder turns Cmd/Ctrl+Alt+Shift+J into the accelerator string and
  saves it; a backend refusal shows inline; each status fixture renders its line (failed reason, Wayland note).
- Support: `support/capture.ts` (control builder from the fixture), channels in `ipcChannels.ts`, `mockRuntime.ts`
  event push for both channels.

### Not run here

- Real hotkey on macOS (Carbon), Windows and Wayland portal, plus the NSPanel focus behaviour: manual. Steps in
  "Manual check". Linux X11: run once under `xvfb-run` if the sandbox has it (`DEV_ENVIRONMENT.md` shows `xvfb-run` for headed WebKitGTK);
  else it joins the open item.

## Manual check (real hardware, after landing)

1. macOS: Safari frontmost, copy a GitHub PR link, press the chord. Popup appears over Safari, Safari stays active
   in the menu bar, other Kira windows do not come forward. Enter opens the PR view. No Accessibility prompt.
2. Close every Kira window, repeat with a Jira key: popup still appears (process alive), Enter opens the issue view.
3. Copy plain text, chord, edit title, Enter: task tops Later.
4. Set the chord to one another app holds: pane shows `failed` with the OS reason.
5. Windows 11 and a Wayland desktop (KDE Plasma 6 or GNOME 48+): chord fires; Wayland pane shows `requested`.

## Docs

- `docs/ARCHITECTURE.md`: new subsection "Clipboard capture (P430)" after "Comments (P429)": hotkey binding through
  Wails `GlobalShortcut`, settings leaves, classification order, popup panel window, lifetime, Later composition,
  ErrorHandler routing.
- "Known open items" (append):
  - Real global hotkey unverified on macOS, Windows and Wayland (P430); flow tests drive a fake binding.
  - Wayland binding state is unconfirmed (P430): the portal decides the trigger; the pane shows "requested".
  - Capture reads text only (P430): Wails beta.28 has no image clipboard read.
  - Linux X11 hotkey unverified (P430), only if the Xvfb run did not happen.
- `DEV_ENVIRONMENT.md`: no change (Stream B owns only its `az` section; nothing new to run).

## Commits (in order)

Fast checks per commit: `go build ./apps/kira-space/... ./internal/shell/...`, `go vet` on touched packages; from
commit 5, `bun run typecheck` and `bun run lint`.

1. `feat(shell): chord parsing and global hotkey binding` (`internal/shell/chord.go`, `hotkey.go`).
2. `feat(shell): popup window options` (`internal/shell/popup.go`).
3. `feat(space): capture settings leaves` (model, repos, validation, `settingsDomain.ts`).
4. `feat(space): capture service` (`bridge/capture.go`, appwire, `main.go`, backend i18n keys).
5. `feat(space): capture popup` (`src/capture/`, `App.vue`, `main.ts`, `bridge/index.ts`, i18n).
6. `feat(space): capture settings pane` (`CapturePane.vue`, `SettingsDialog.vue`, i18n).
7. `test(space): capture fakes and flows` (flowharness seams, `captureflow`, contract fixture).
8. `test(space): capture UI specs` (specs + support).
9. `docs: clipboard capture` (ARCHITECTURE section + Known open items).
10. Fixes from the end-of-phase run, grouped by root cause.
11. `docs: P430 result` (Result section at the end of this file; SPEC.md untouched).

## Verification

- Once near the end, from the worktree root:
  - `CGO_ENABLED=1 go test ./internal/shell/... ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/appwire/...
    ./apps/kira-space/internal/flowharness/... ./apps/kira-space/internal/storage/...`
  - `bun run test:flows:space` (coverage gate included)
  - `bun run test:ui:space`
  - `bun run lint:all`; `bun scripts/copy/check-catalog.ts --unused`
- Orchestrator checks:
  - `grep -rn "GlobalShortcut" apps/kira-space/main.go` hits; `git diff 4982f7a66 -- go.mod go.sum` is empty.
  - `grep -n "MacWindowClassPanel\|NonActivating" internal/shell/popup.go` hits.
  - `grep -n "Clipboard.Text" apps/kira-space/main.go` hits; `grep -rn "navigator.clipboard" apps/kira-space/frontend/src/capture` empty.
  - `grep -n "HostView.Open\|CaptureTask" apps/kira-space/internal/bridge/capture.go` hits both.
  - `grep -n "IsCaptureKey" apps/kira-space/main.go` hits `Ephemeral` and the purge.
  - `ls apps/kira-space/internal/storage/migrations/ | tail -1` still `0060_p415_op_log.sql`.
  - `captureflow` and both UI specs exist and pass.

## Risks

- **Wails global shortcut API is new in beta.** Bugs there land on us. Mitigation: one binding, status surfaced,
  manual check list above.
- **macOS panel focus.** A non-activating panel must still take keys for Enter and the title input; Wails calls
  `makeKeyWindow`. If WKWebView does not get first responder, fall back to a regular window with
  `activateIgnoringOtherApps` (the Dock state then changes). Verify on hardware.
- **Windows foreground lock.** `SetForegroundWindow` is allowed after `WM_HOTKEY`, so focus should work; unverified.
- **Linux focus stealing prevention** may show the popup unfocused on some WMs; Enter then needs a click first.
- **Popup boot latency.** A fresh webview per press costs a few hundred ms. Accepted for zero idle RAM; if it feels
  slow on hardware, a hidden reusable popup is a follow-up, not this phase.
- **ErrorHandler prefix match** depends on Wails error strings; a Wails bump that rewords them silently drops the
  `failed` state. The comment names the source; P434 review can recheck.
- **Default chord grab.** Enabled by default with a four-key chord. If the orchestrator prefers off by default, flip
  `Enabled` default in Go and TS; nothing else changes.
- **Later is two calls** (`CaptureTask` + `UpdateTask`) because `adewire` is out of Stream B's ownership. A failed
  patch leaves a title-only task; the popup reports it.

## Ownership

All paths Stream B's per `streams.md`:

- `internal/shell/chord.go`, `hotkey.go`, `popup.go` (new).
- `apps/kira-space/internal/bridge/capture.go` (new); `bridge/settings.go` untouched (hook chained in appwire).
- `apps/kira-space/internal/appwire/appwire.go`, `apps/kira-space/main.go`.
- `apps/kira-space/internal/storage/model/settings.go`, `storage/repos/settings.go`.
- `apps/kira-space/internal/flowharness/**`, `apps/kira-space/internal/flows/captureflow/` (new).
- `apps/kira-space/frontend/src/capture/` (new), `src/App.vue`, `src/main.ts`, `src/bridge/index.ts`,
  `src/state/settingsDomain.ts`, `src/workbench/settings/CapturePane.vue` (new), `src/workbench/SettingsDialog.vue`.
- `apps/kira-space/tests/ui/capture.spec.ts`, `settings-capture.spec.ts`, `tests/ui/support/**` (not `adeV2.ts`,
  `adeReviewStep.ts`), `tests/contract/capture.json`.
- `packages/theme/src/i18n/en.json`: `space.capture.*`, `space.settings.capture.*`, `backend.space.capture.*` only.
- `docs/ARCHITECTURE.md`: new capture subsection; Known open items append.
- Not touched: `go.mod`, `go.sum`, `adewire/**`, `ade/**`, `packages/shared/domain/shortcuts.ts`, migrations,
  `docs/v0.2.24/SPEC.md`.

## For the orchestrator

- Scope reading: "Wayland uses a portal or the desktop's shortcut settings" is met by the portal, whose trigger the
  user sets in the desktop's shortcut settings. A desktop shortcut that runs a CLI flag into the running instance would
  need argv forwarding (close to the out-of-scope URL scheme); not planned.
- Default enabled with `CmdOrCtrl+Alt+Shift+K`: confirm or flip (see Risks).
- No new shadcn-vue primitive, so no cross-stream duplicate check needed.
