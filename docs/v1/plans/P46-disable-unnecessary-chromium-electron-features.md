# P46 — Disable unnecessary Chromium/Electron features: every default-on capability this app has no user for, turned off with an assertion behind it

> **The phase, in the user's own words** (SPEC.md:1069): *"audit the app's Electron/Chromium surface
> and disable whatever this app doesn't use — renderer capabilities the app never needs, DevTools
> reachability outside development, spellcheck/autofill/form-data features, unused Chromium
> command-line switches, background-throttling and GPU features the app doesn't rely on, and any
> other default-on Electron/Chromium capability with no purpose here"*, with the *why* column
> recording the framing directly: *"disable unnecessary Chromium and Electron features."*
>
> **The mandate's premise is right, and three of its clauses resolve the opposite way from how they
> read.** *Unused command-line switches*: the app passes **zero** switches, so there is nothing to
> remove — and the honest answer is that none should be added either (F75/D79). *Background
> throttling*: it is already on, and it is the right setting (F72/D80). *GPU features*: hardware
> acceleration stays, because the grid's scroll budget depends on it — WebGL is the one GPU surface
> with no user (F73/D75).
>
> **What is actually open, reproduced against the shipped renderer, not inferred:**
> - **The renderer can navigate the app window to a remote origin right now.** In the real app, under
>   the real Playwright harness, `location.href = 'https://kira-studio.invalid/'` moves the window
>   from `file:///…/out/renderer/index.html` to that URL and the workbench is gone
>   (`[data-testid="status-bar"]` → absent). The `<meta>` CSP does not stop it; CSP has no say over
>   top-level navigation (F66).
> - **The renderer can open a second, unhardened BrowserWindow onto a remote origin right now.**
>   `window.open('https://example.com/')` returns a live handle and
>   `BrowserWindow.getAllWindows().length` goes 1 → 2, in the real app (F65).
> - **Every Chromium permission is granted, because no handler is installed.**
>   `Notification.requestPermission()` → `'granted'` in the real app (F67).
> - **`devTools` is `true` in the packaged build**, so `openDevTools()` works there — even though the
>   *keyboard* path is already closed, which this plan proves rather than assumes (F64).
> - **The spellchecker is on**, including for the connection dialog's password field the moment the
>   eye toggle reveals it (F69).
>
> **The two findings that stop this from being a blanket "disable everything" pass**, both proven by
> running them:
> - **A deny-all permission handler breaks the app.** `navigator.clipboard.readText()` /
>   `writeText()` both go through `setPermissionRequestHandler`, under the names `clipboard-read` and
>   `clipboard-sanitized-write`. Deny them and copy/paste throws `NotAllowedError` everywhere — the
>   grid's paste, `clipboard.ts`'s `copyText` (38 call sites), and sixteen assertions in
>   `interaction.spec.ts`/`data-view.spec.ts` — all Docker-gated, so it would have shipped green from
>   this sandbox (F68/D71).
> - **Turning off the `grantFileProtocolExtraPrivileges` fuse bricks the packaged app.** Flipped off
>   on a copied Electron 43.4.1 binary, the renderer's own `<script type="module" crossorigin>` is
>   refused: *"Access to script at 'file://…' from origin 'null' has been blocked by CORS policy."*
>   The window never boots. electron-builder's own documentation for that fuse says *"if you aren't
>   serving pages from `file://` you should disable this fuse"* — this app **is** serving from
>   `file://` (F71/D78).
>
> **The fuses that are safe were proven safe the same way**: with `runAsNode`, `nodeOptions` and
> `nodeCliInspectArguments` flipped off on that copied binary, **the real `out/main/index.js` boots
> normally** — `did-finish-load at uptime 543ms`, and the engine's `utilityProcess`
> (`--utility-sub-type=node.mojom.NodeService`) starts — while `ELECTRON_RUN_AS_NODE=1 electron -e …`
> stops working and `--inspect=9333` is silently ignored (F71).
>
> **Ten commits. Every disable lands with something that fails if it is reverted** — a
> `tests/unit/` spec or a scenario in a new Docker-free `tests/ui/hardening.spec.ts` — except the
> three fuses, whose packaged half is honestly recorded as macOS-owed debt (§8).
>
> **Branch tip when this plan was written: `8d4b4ea` on `feature/kickoff`; `git status --porcelain`
> over the repo was empty apart from this file.** Baselines measured here, on that tree:
> `bun run lint` → *"Checked 462 files in 611ms. No fixes applied."*; `bun run typecheck` → exit 0,
> all five projects; `bunx electron-vite build` → *"✓ built in 5.46s"*; `bun test tests/unit` →
> **63 pass, 0 fail, 1358 ms**; `xvfb-run -a bunx playwright test tests/ui/{sqlite,startup,smoke,connections,workbench}.spec.ts`
> → **13 passed (36.2 s)**; `bun run verify:packaging` → *"all checks passed"* (A1–A6 skipped, no
> `dist/`). Re-measure before editing.

---

## 0. Ground rules for this phase

- **Nothing is disabled without evidence that the app does not use it.** Every finding below names
  either a grep over the tree with its result, or a run whose output is quoted. "Electron's security
  checklist says so" is not a reason on its own; "this app has zero `<form>` elements" is.
- **Every disable lands with an assertion that fails if the disable is reverted.** Where an assertion
  is impossible or vacuous *in this sandbox*, the decision says so in its own words rather than
  implying coverage that does not exist (D75's WebGL scenario and D77's fuses are the two).
- **Defaults are not restated in code.** Electron 43.4.1 already defaults `webviewTag`,
  `webSecurity`, `allowRunningInsecureContent`, `experimentalFeatures`, `nodeIntegrationInWorker`,
  `nodeIntegrationInSubFrames`, `navigateOnDragDrop` and `plugins` the way this app wants them
  (F63). Writing them out again is comment-noise that AGENTS.md's comment rule exists to prevent, and
  it protects against nothing — a pinned Electron cannot change its own defaults. They are pinned in
  a test instead (D69), which *does* catch the case that matters: a future session editing
  `webPreferences` by hand, or an Electron bump changing a default.
- **A capability the app *does* use is out of scope no matter how attractive it looks.**
  `window.confirm()` has six callers; `navigator.clipboard` is reached from 38 `copyText` call sites
  plus the grid's own paste path. `disableDialogs`, `safeDialogs`
  and a blanket permission denial are therefore not on the table, and §6 records that they were
  considered and why.
- **`bun run format`/`lint`/`typecheck` (node, web, db, unit) and `bunx electron-vite build` stay
  green after every commit**, and the Docker-free Playwright subset
  (`tests/ui/{sqlite,startup,smoke,connections,workbench}.spec.ts`, plus the new
  `tests/ui/hardening.spec.ts` from commit 1 onward) is re-run after every commit. `bun test tests/unit`
  is re-run after commits 1, 2, 5 and 7. Conventional Commits, one per step of §4.
- Comments per AGENTS.md: only where the code cannot say it for itself. `security.ts` earns exactly
  three — the clipboard allowlist (a reader will otherwise "simplify" it to a deny-all and break
  paste), the `file://` fuse hazard, and why `will-frame-navigate` rather than `will-navigate`.

---

## 1. Findings

F-numbers continue from P45, which ended at **F61**. Decisions continue from **D68**.

### F62 — The app's Electron surface today, in full

`src/main/window.ts:20-25` is the entire renderer configuration:

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
},
```

Four keys. Everything else is Chromium's default. What is *absent* is the finding:

```
$ grep -rn "session\.\|defaultSession\|setPermission\|commandLine\|appendSwitch\|\
disableHardwareAcceleration\|openDevTools\|setWindowOpenHandler\|will-navigate\|will-redirect\|\
shell\.openExternal\|new-window" src/ --include=*.ts --include=*.vue
src/main/index.ts:28,46,55,113,117   → webContents.send / .id / .postMessage only
src/main/window.ts:32                → webContents.once('did-finish-load')
src/main/ipc/settings.ts:20          → webContents.send
src/main/menu.ts:7                   → webContents.send
(the remaining hits are the word "session" in two renderer comments)
```

So, exhaustively: **no `session` configuration of any kind** — no permission request handler, no
permission check handler, no device permission handler, no spellchecker call. **No
`app.commandLine` switch.** **No `setWindowOpenHandler`.** **No `will-navigate`,
`will-frame-navigate` or `will-attach-webview` guard.** **No `shell` import anywhere in `src/main`**
(the twelve `from 'electron'` lines import `app`, `BrowserWindow`, `ipcMain`, `Menu`,
`MessageChannelMain`, `dialog`, `safeStorage`, `utilityProcess` and nothing else) — the app has no
code path that opens an external URL at all. **No `electronFuses` key in `electron-builder.yml`.**
**No `crashReporter.start()`** (F76).

What *is* configured, and is correct: `contextIsolation`/`sandbox`/`nodeIntegration` above; a `<meta>`
CSP in `src/renderer/index.html:5-8` (`default-src 'self'; script-src 'self'; style-src 'self'
'unsafe-inline'; font-src 'self' data:; img-src 'self' data:`); and DevTools/reload menu items gated
behind `!app.isPackaged` in `src/main/menu.ts:11,91-97`.

### F63 — Electron 43.4.1's `webPreferences` defaults, read from the pinned version's own docs and confirmed at runtime

`package.json` pins `"electron": "43.4.1"`; `node_modules/electron/package.json` agrees. Defaults are
from `electron/electron@v43.4.1`'s own `docs/api/structures/web-preferences.md`, and the "reported"
column is what `webContents.getLastWebPreferences()` actually returned in the running app (F65's run).

| Option | Default in 43.4.1 | Does this app need it? | Verdict |
|---|---|---|---|
| `devTools` | `true` | Only unpackaged | **change** — D70 |
| `spellcheck` | `true` | No | **change** — D74 |
| `webgl` | `true` | No (canvas 2d only, F70) | **change** — D75 |
| `nodeIntegration` | `false` | No | already correct, pinned by test |
| `contextIsolation` | `true` | Yes | already correct, pinned by test |
| `sandbox` | `true` | Yes | already correct, pinned by test |
| `webSecurity` | `true` | Yes | already correct, pinned by test |
| `allowRunningInsecureContent` | `false` | No | already correct, pinned by test |
| `webviewTag` | `false` | No | already correct, pinned by test |
| `experimentalFeatures` | `false` | No | already correct, pinned by test |
| `nodeIntegrationInWorker` | `false` | No workers at all (F70) | already correct, pinned by test |
| `nodeIntegrationInSubFrames` | `false` | No sub-frames at all (F70) | already correct, pinned by test |
| `navigateOnDragDrop` | `false` | No | already correct (not reported; D69) |
| `plugins` | `false` | No | already correct (not reported; D69) |
| `enableDeprecatedPaste` | `false` | No — paste is `navigator.clipboard` (F68) | already correct |
| `disableDialogs` | `false` | **must stay `false`** — `window.confirm()` ×6 (F74) | leave |
| `safeDialogs` | `false` | **must stay `false`** — same reason (F74) | leave |
| `backgroundThrottling` | `true` | Throttling is wanted here (F72) | leave |
| `javascript`, `images` | `true` | Yes | leave |
| `enableWebSQL` | `true` | Irrelevant — Chromium removed the API (F70) | leave |
| `enableBlinkFeatures` / `disableBlinkFeatures` | `''` | No candidate survives D79's test | leave |
| `autoplayPolicy` | `no-user-gesture-required` | No media element exists (F70) | leave |

Reported by `getLastWebPreferences()` (identical in the isolated probe and in the real app under
Playwright): `allowRunningInsecureContent`, `contextIsolation`, `disableDialogs`, `disablePopups`,
`enableBlinkFeatures`, `experimentalFeatures`, `javascript`, `nodeIntegration`,
`nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`, `safeDialogs`, `safeDialogsMessage`,
`sandbox`, `webSecurity`, `webviewTag`. Notably **`devTools`, `spellcheck` and `webgl` are not
reported** — the three this phase changes are exactly the three that need their own assertion (D70,
D74, D75) rather than riding on the pinned-preferences test (D69).

### F64 — DevTools is already unreachable by keyboard in a packaged build. Proven, not assumed. But `openDevTools()` still works.

The claim "the packaged build has no DevTools" rests entirely on `menu.ts` omitting the
`toggleDevTools` role when `app.isPackaged`. That is only true if Electron/Chromium has no *other*
keyboard path to DevTools. It was tested rather than believed: an Electron 43.4.1 app with a fully
custom menu containing no `toggleDevTools` and no `reload`, sending real key events through
`webContents.sendInputEvent`:

```
RESULT {
  "devtoolsAfterF12": false,
  "devtoolsAfterCtrlShiftI": false,
  "devtoolsAfterCmdAltI": false,
  "devtoolsAfterCtrlShiftJ": false,
  "devtoolsAfterProgrammatic": true      ← wc.openDevTools()
}
```

So the *shortcut* surface is already closed, and no change is needed there. The residual is the last
line: `devTools` defaults to `true`, so `webContents.openDevTools()` remains functional in a packaged
build. Setting `devTools: false` closes it outright — Electron's own docs: *"If it is set to `false`,
can not use `BrowserWindow.webContents.openDevTools()` to open DevTools."* Confirmed on the same
harness with `devTools: false` in `webPreferences`: `"devtoolsOpened": false` after an
`openDevTools({ mode: 'detach' })` call that opened it every other time.

The same run also recorded `session.defaultSession.isSpellCheckerEnabled()` → `true` and
`getSpellCheckerLanguages()` → `["en-US"]` on a stock window (F69).

### F65 — The renderer can open a second, unhardened BrowserWindow onto a remote origin, today

No `setWindowOpenHandler` is installed anywhere (F62), so Electron's default action is `allow`. In an
isolated Electron 43.4.1 app with the app's own `webPreferences`:

```
"windowOpenReturn": "ok:handle",
"windowCountAfterOpen": 2,
```

And in **the real app**, under the real `tests/ui/fixtures.ts` harness in this sandbox:

```
SCRATCH {"notif":"granted","opened":"handle","count":2, …}
```

`count` is `BrowserWindow.getAllWindows().length` after
`window.open('https://example.com/', '_blank')` — a second real window, created with default web
preferences, which then loaded the remote page.

There is no legitimate caller to break by denying this. The tree has **zero** `window.open` calls,
**zero** `target="_blank"`, and **zero** `<a href=…>` elements in `src/renderer` and `src/shared`:

```
$ grep -rn "window\.open\|target=[\"']_blank\|<a \|href=" src/renderer src/shared
(no output)
```

File pickers are not popups: they go over IPC to `dialog.showOpenDialog`/`showSaveDialog` in
`src/main/ipc/files.ts`, which are native modals with no `webContents` involved.

### F66 — The renderer can navigate the app window away to a remote origin, today, and the CSP does not stop it

Reproduced in the real app, isolated from F65 so nothing else could explain it:

```
SCRATCH2 {
  "before":  "studio/out/renderer/index.html",
  "after":   "https://kira-studio.invalid/",
  "stillThere": false                          ← document.querySelector('[data-testid="status-bar"]')
}
```

`kira-studio.invalid` is deliberately unresolvable: the URL commits and the workbench is destroyed
even when the navigation itself cannot succeed, so this is not an artifact of the sandbox having
network access. The `<meta>` CSP at `src/renderer/index.html:5` is irrelevant here — `default-src`
governs subresource loads, not top-level navigation.

A `will-frame-navigate` guard that allows only the app's own base URL restores it (verified on the
isolated harness — `urlAfterNav` stayed on `file://…`), and **`webContents.reload()` still works
through it**, which matters for `bun run dev`'s Vite full reloads:

```
"urlAfterReload": "file:///…/index8.html",
"bodyAfterReload": "hello",
"blocked": ["open:https://example.com/", "frameNav:https://example.com/"]
```

`will-frame-navigate` fires ahead of `will-navigate` and covers sub-frames as well as the main frame,
so it is the single event to guard on (D72).

### F67 — Every Chromium permission is granted by default, because no handler is installed

With no `setPermissionRequestHandler`/`setPermissionCheckHandler` anywhere (F62), in an isolated
Electron 43.4.1 app:

```
RESULT4 {"notificationPerm":"granted","permNotif":"granted","permClipboard":"granted", …}
```

and in **the real app** under the Playwright harness: `"notif":"granted"`.

Chromium consults the check handler on page load, unprompted, for `media` (twice),
`web-app-installation` and `geolocation` — observed on every run. The renderer exposes
`navigator.geolocation`, `navigator.mediaDevices`, `Notification`, `navigator.usb`,
`navigator.serial`, `navigator.hid`, `IdleDetector` and `webkitSpeechRecognition`
(`navigator.bluetooth` is absent). This app uses none of them: no notification is ever raised
(`grep -rn "new Notification"` → nothing), no media element exists (F70), no device API is called.

### F68 — But a blanket deny-all breaks the app. `navigator.clipboard` is a permission, under two exact names.

This is the finding that keeps the phase from being a blanket pass. With deny-all request **and**
check handlers, and a focused window (the unfocused case returns a misleading *"Document is not
focused"* and must not be mistaken for a permission result):

```
RESULT6 (deny-all) {"read":"threw:NotAllowedError:… Read permission denied.",
                    "write":"threw:NotAllowedError:… Write permission denied."}
RESULT6 (no handler) {"read":"KIRA-CLIPBOARD-PROBE","write":"ok"}
```

The names were then isolated by allowlisting one at a time:

| allowlist | `readText()` | `writeText()` |
|---|---|---|
| `[]` | `NotAllowedError` | `NotAllowedError` |
| `['clipboard-read']` | **ok** | `NotAllowedError` |
| `['clipboard-read','clipboard-sanitized-write']` | **ok** | **ok** |

Both arrive through **`setPermissionRequestHandler`**, logged as `request:clipboard-read` and
`request:clipboard-sanitized-write`. They never appear in the *check* handler's log, which only ever
saw `media`, `media`, `web-app-installation`, `geolocation`.

What would have broken: `src/renderer/clipboard.ts:5` (`copyText` — **38 call sites**, spread across
the project menus, tab strip, grid, ops panel, browse/stream/keyvalue/definition menus and the error
popover), `src/renderer/views/grid/DataGrid.vue:1215` (`onPaste` — the grid's whole
paste-into-cells path), and, in the test suite itself,
sixteen clipboard-dependent assertions across `tests/ui/interaction.spec.ts` and
`tests/ui/data-view.spec.ts` — all Docker-gated, so a deny-all would have shipped green from this
sandbox and failed on the first machine with Docker.

**The clipboard round-trip runs for real here**, so the allowlist is assertable in the Docker-free
subset — verified with a throwaway spec against the real app: `navigator.clipboard.writeText` then
`readText` returned `KIRA-RT`, with `document.hasFocus()` → `true`.

### F69 — The spellchecker is on, including for the connection dialog's password when it is revealed

`session.defaultSession.isSpellCheckerEnabled()` → `true`, languages `["en-US"]`, on a stock window
(F64's run). Two separate levers exist and neither implies the other: setting
`webPreferences.spellcheck: false` left `isSpellCheckerEnabled()` at `true`, and
`session.setSpellCheckerEnabled(false)` flipped it to `false`. Both are needed (D74).

What is actually spellchecked today:

- **CodeMirror is already exempt.** `@codemirror/view`'s `dist/index.js:8270` sets
  `spellcheck: "false"` on its content DOM, so the SQL/JSON editors were never affected.
- **`AutocompleteField.vue:216-217` already opts out by hand** (`autocomplete="off"`,
  `spellcheck="false"`) — evidence that the intent already existed but was applied at exactly one of
  sixty-one sites.
- **Everything else is spellchecked**: sixteen raw `<input>` elements, forty-five `<TextField>`
  mounts and two `<textarea>`s
  (`StreamComposeMessage.vue:95,106` — arbitrary Kafka/SQS message keys and payloads), all reached
  through `theme/primitives/TextField.vue`, whose `<input>` (`:62`) sets neither attribute.
- **Including the password field.** `project/ConnectionDialog.vue:449-463` renders
  `<TextField :type="showPassword ? 'text' : 'password'" data-testid="connection-password">`. The eye
  toggle at `:460` flips it to `type="text"`, at which point the database password is submitted to
  Chromium's spellchecker (macOS: `NSSpellChecker`) like any other prose.

### F70 — There is no form, no worker, no web storage, no media element, no spare renderer

Each of these is a grep or a `ps`, and each removes a candidate from the disable list by showing
there is nothing to disable:

```
$ grep -rn "<form" src/renderer --include=*.vue        → 0 hits
$ grep -rn "localStorage\|indexedDB\|sessionStorage" src/renderer   → 0 hits
$ grep -rn "new Worker\|Worker(\|serviceWorker\|requestFullscreen\|getDisplayMedia" src/renderer → 0 hits
$ grep -rn "<audio\|<video\|new Audio(" src/renderer   → 0 hits
$ grep -rn "webview\|<iframe" src/                     → 0 hits
$ grep -rn "getContext(" src/renderer
src/renderer/views/shared/page/columns.ts:14:  const ctx = canvas.getContext('2d');
src/renderer/fonts.ts:16:  measureCtx = canvas.getContext('2d');
```

Zero `<form>` elements means Chromium's form-autofill and password-manager heuristics have no form
owner to attach to — the "form-data features" half of the mandate is mostly already vacuous, and what
remains is the per-input `autocomplete` attribute (D76). Zero workers and zero sub-frames mean
`nodeIntegrationInWorker`/`nodeIntegrationInSubFrames` (already `false`) protect nothing that exists.
Zero media elements mean Chromium's hardware-media-key handling never registers (D79). The only
canvas use in the app is `2d`, twice, both for text measurement — hence D75.

`window.openDatabase` is `undefined` in the renderer, so `enableWebSQL`'s `true` default is inert:
Chromium removed the API, and Electron kept the option.

The running app's process tree, for the record — no spare renderer, so
`SpareRendererForSitePerProcess` has nothing to save (D79):

```
electron out/main/index.js                                  ← main
electron --type=zygote --no-zygote-sandbox                  ← zygote
electron --type=zygote                                      ← zygote
electron --type=gpu-process                                 ← GPU (kept, F73)
electron --type=utility --utility-sub-type=network.mojom.NetworkService
electron --type=utility --utility-sub-type=node.mojom.NodeService --max-old-space-size=512   ← the engine
electron --type=renderer --enable-sandbox                   ← exactly one
```

### F71 — Electron fuses: three flip safely, one bricks the app. Both halves measured.

`electron-builder.yml` sets no `electronFuses` key, so the packaged app ships every fuse at Electron's
default. `app-builder-lib` 26.15.3 (`out/configuration.d.ts:235,475-530`) supports the
`electronFuses` block and `resetAdHocDarwinSignature`, and `@electron/fuses` 1.8.0 is already in
`node_modules` — no new dependency (D77).

Measured by copying `node_modules/electron/dist` to `/tmp`, flipping fuses on the **copy** (the repo's
own binary was never touched; a control run at the end confirms it), and running against it:

| Fuse | Default | Flipped off ⇒ what happened |
|---|---|---|
| `RunAsNode` | on | `ELECTRON_RUN_AS_NODE=1 <copy> -e "console.log('RAN_AS_NODE_OK')"` → *"Unable to find Electron app at …"* (it took the app path instead). Control: the untouched repo binary still printed `RAN_AS_NODE_OK`. |
| `EnableNodeCliInspectArguments` | on | `<copy> --inspect=9333 .` → no *"Debugger listening"* line; app booted normally. |
| `EnableNodeOptionsEnvironmentVariable` | on | flipped in the same pass; no observable effect on the app. |
| `GrantFileProtocolExtraPrivileges` | on | **the app never boots.** `"moduleRan":false`, title stuck at `pending`, console: *"Access to script at 'file:///…/mod.js' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol …"* |

The decisive run is the third: with `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
`EnableNodeCliInspectArguments` all off (and `GrantFileProtocolExtraPrivileges` restored to on), the
**real `out/main/index.js`** launched under the fused copy and behaved identically to a normal run —
migrations `0001`…`0005` applied, `did-finish-load at uptime 543ms`, and the full process tree
including `--utility-sub-type=node.mojom.NodeService`. This settles the one thing that could have
gone wrong: electron-builder's own docs warn that `runAsNode: false` breaks `process.fork` in the main
process, and recommend Utility Processes instead — which is exactly what `src/main/engine-host.ts`
already uses (`utilityProcess.fork()`), and the run proves it.

The `grantFileProtocolExtraPrivileges` result is not a surprise once seen: `out/renderer/index.html`
is built as `<script type="module" crossorigin src="./assets/index-….js">` and loaded over `file://`,
and that fuse is precisely what lets a `file://` page fetch a sibling `file://` module. This is the
concrete instance of the mandate's own caution about breaking something the app secretly relies on.

### F72 — Non-finding: background throttling is already on, and it is the right setting

`backgroundThrottling` defaults to `true` and nothing in the app overrides it. The question the
mandate raises is whether anything here needs *not* to be throttled. Two candidates, both checked:

- **The quit flush handshake.** `src/main/index.ts:39-57` holds `before-quit` until each window acks
  `IPC.appFlushBeforeClose`. The renderer's handler (`src/renderer/state/tabs.ts:130-136`) *cancels*
  the pending debounce timer and calls `control.tabsSave(...)` immediately, acking in `.finally()`.
  It is IPC-driven end to end; no throttled timer is on the path.
- **The only interval in the app.** `src/renderer/state/runState.ts:8-14` runs one shared ticker,
  started only while an operation is in flight — i.e. only while the user is looking at it.

Chunked find-scans (`views/shared/page/scan.ts`) are `requestAnimationFrame`-driven, so a hidden
window pauses a scan rather than throttling it. That is the desirable behaviour for a hidden window
and is the status quo, not a change. **No change** (D80).

### F73 — Non-finding: hardware acceleration and the GPU process stay

`app.disableHardwareAcceleration()` is not called and must not be: the app's non-functional
requirements (`docs/ARCHITECTURE.md`'s Invariants, budgets in `docs/PERF.md` §1) turn on a virtualized
grid scrolling smoothly, which is exactly what GPU compositing buys. The GPU process in F70's tree is
load-bearing. The only GPU-adjacent capability with no user at all is WebGL (D75).

### F74 — Non-finding: `disableDialogs` and `safeDialogs` are off the table

`window.confirm()` has six callers, every one of them the confirmation gate on a destructive action:

```
src/renderer/views/keyvalue/KeyValueView.vue:341   delete an entire key
src/renderer/views/browse/menu.ts:133              delete an S3 object
src/renderer/views/stream/StreamView.vue:374       delete a message
src/renderer/views/documents/DocumentView.vue:436  delete a document
src/renderer/views/documents/menu.ts:73            delete a document
src/renderer/project/menus.ts:215,233              delete a connection
```

`disableDialogs: true` makes `confirm()` return `false`, so the app would fail safe rather than delete
silently — but every one of those actions would become unreachable. `safeDialogs: true` is worse in
kind: it offers the user a "prevent this page from creating additional dialogs" checkbox, and a user
who ticks it disables their own delete confirmations for the session. `FilterHistoryMenu.vue:36` and
`ConsoleSavedMenu.vue:25` already record that `window.prompt()` is unimplemented in Electron and that
the app substitutes its own inline input; **replacing `confirm()` the same way is a UI change and
belongs to a UI phase, not here** (§6).

### F75 — Non-finding: there is no unused command-line switch to remove, and none worth adding

`grep -rn "commandLine\|appendSwitch" src/` returns nothing (F62). The mandate's *"unused Chromium
command-line switches"* clause is therefore already satisfied — by absence. The remaining question is
whether to add any, and the answer is no (D79): a `--disable-features` list is fail-open (Chromium
silently ignores names it does not recognise, so a rename in a future Electron bump re-enables
everything with nothing able to notice), and every capability such a list would target here is either
untriggerable in this app (media keys — no media element, F70), not present in Electron's build
(`//chrome`-layer components such as the Cast Media Router), or already reachable through a
first-class Electron API that *is* assertable (`setSpellCheckerEnabled`, the permission handlers).

### F76 — Non-finding: the crash reporter is not started and uploads nothing

`grep -rn "crashReporter\|autoUpdater" src/` returns nothing. The child processes in F70's tree carry
`--enable-crash-reporter=<uuid>,no_channel` — Electron passes that to children unconditionally, and
`no_channel` means there is no upload endpoint because `crashReporter.start()` was never called. There
is nothing to disable. (`scripts/verify-packaging.sh` S1/S2 already guard the updater half.)

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| **D69** | **Defaults that are already correct are not restated in `webPreferences`. They are pinned by a test instead** — `tests/ui/hardening.spec.ts` asserts `webContents.getLastWebPreferences()` deep-equals the exact expected object (F63's "reported" list). | Restating eight already-correct defaults is the comment-noise AGENTS.md's comment rule exists to prevent, and it guards against nothing: a pinned Electron cannot change its own defaults mid-version. What *can* go wrong is a future session editing the `webPreferences` literal, or an Electron bump moving a default — and a deep-equality assertion catches both, in one line, where eight extra config keys catch neither. The three options this phase actually changes (`devTools`, `spellcheck`, `webgl`) are **not** in that reported set (F63), so each gets its own assertion rather than riding on this one. |
| **D70** | **`devTools: !app.isPackaged`.** DevTools stays fully available unpackaged (`bun run dev`, every Playwright run) and is impossible to open in a packaged build, `openDevTools()` included. | F64 measured both halves: the keyboard path is *already* closed by `menu.ts`'s gating (no shortcut opened DevTools with a custom menu), so this closes the one remaining path — the programmatic one, which was open. Nothing in a packaged renderer can currently call `openDevTools()` (no node integration, not on the `contextBridge` surface), so this is defence in depth rather than a live hole; it is worth one word because it turns "no caller exists today" into "no caller can exist." |
| **D71** | **A permission handler pair that denies everything except exactly `clipboard-read` and `clipboard-sanitized-write`**, installed on `session.defaultSession` once, after `app.whenReady()`. Both `setPermissionRequestHandler` and `setPermissionCheckHandler` consult one shared `Set`. | F67: today everything is granted, including notifications and geolocation, because no handler exists. F68: deny-all breaks copy and paste across `copyText`'s 38 call sites, the grid's paste path and sixteen test assertions, and the two names were isolated by running them one at a time rather than read off a list. One `Set` for both handlers means the allowlist can never drift between the two — the failure mode where a request is granted and the later check is not. |
| **D72** | **`setWindowOpenHandler` denies unconditionally; `will-frame-navigate` allows only the app's own base URL (`process.env.ELECTRON_RENDERER_URL ?? 'file://'`); `will-attach-webview` denies unconditionally.** | F65/F66: both holes are open right now and both were reproduced against the shipped renderer, not a toy. F65 also shows there is no caller to break — zero `window.open`, zero `target="_blank"`, zero `<a href>` in the whole renderer, and file pickers are native `dialog` modals over IPC, not popups. `will-frame-navigate` rather than `will-navigate` because it fires first and covers sub-frames too (F66); the base-URL allowance is what keeps `wc.reload()` and Vite's dev-server full reloads working, verified. `will-attach-webview` is one line and makes `webviewTag: false` unbypassable. |
| **D73** | **All three of the above live in one new module, `src/main/security.ts`, whose only `electron` import is `import type`.** It exports `rendererWebPreferences({ preload, isDev })`, `hardenSession(session)` and `hardenWindow(win, appBaseUrl)`. A second new one-line module, `src/main/env.ts`, exports `isDevBuild = !app.isPackaged` as the single definition of "development" for both `menu.ts` and `window.ts`. | Type-only `electron` imports are erased at transpile time, so `rendererWebPreferences` is unit-testable under Bun **with no module mocking at all** — the cheapest possible guard on the option set. One module also means the answer to "what is turned off, and why" is one file rather than a hunt across `window.ts`/`index.ts`/`menu.ts`. `env.ts` exists because `!app.isPackaged` would otherwise be read in two places for two related decisions that must never disagree; reading `app.isPackaged` at module load is already what `index.ts:24` does today, so it introduces no new pre-`whenReady` hazard (contrast `safeStorage`, P25 D1). |
| **D74** | **Both spellcheck levers: `spellcheck: false` in `webPreferences` *and* `session.setSpellCheckerEnabled(false)`.** | F69 measured that neither implies the other — `spellcheck: false` alone left `isSpellCheckerEnabled()` at `true`. The justification is not hypothetical: the connection dialog's password becomes plain `type="text"` the moment the eye toggle is used (`ConnectionDialog.vue:449-463`), and a spellchecked field hands its contents to the platform spell checker. CodeMirror already opts out on its own (`@codemirror/view` sets `spellcheck: "false"`), so the change costs the app nothing it was using, and removes red squiggles from every text field in the app — hostnames, table names, message payloads. |
| **D75** | **`webgl: false`.** | F70: the only `getContext()` calls in the tree are two `'2d'` contexts, both for text measurement. WebGL is a large, historically vulnerable surface (GPU driver reachable from renderer script) with literally no user here. **Stated plainly because it matters for how the acceptance checklist reads: the assertion for this one is vacuous in this sandbox** — WebGL is already blocklisted under xvfb (`ContextResult::kFatalFailure: WebGL1 blocklisted`), so `getContext('webgl')` returns `null` before and after. The scenario is written anyway because it becomes load-bearing on macOS, and §8 records that it has only ever passed vacuously here. |
| **D76** | **`autocomplete="off"` is added to `theme/primitives/TextField.vue`'s `<input>`, positioned *before* `v-bind="$attrs"` so any caller can still override it.** No other renderer change. | F70: with zero `<form>` elements there is no form owner, so Chromium treats every input as autocomplete-eligible by default; `AutocompleteField.vue:216` already sets this by hand, so the app's intent is established and this just applies it at the other sixty sites through the one primitive they all share. It is assertable at the DOM level (`connection-password` carries `autocomplete="off"`), which is why it is in and the more speculative form-data ideas are in §6. |
| **D77** | **`electron-builder.yml` gains `electronFuses` with `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `resetAdHocDarwinSignature: true`** — and `scripts/verify-packaging.sh` gains static checks S6 (the three are present and `false`) and S7 (`grantFileProtocolExtraPrivileges` is never set to `false`). | F71 measured all three as safe against the real app *and* measured that the engine's `utilityProcess` is unaffected — the one thing electron-builder's own `runAsNode` documentation warns about (`process.fork` in main), which this app does not use. Together they stop a packaged Kira Studio from being usable as a general-purpose Node runtime (`ELECTRON_RUN_AS_NODE`), from honouring `NODE_OPTIONS`/`NODE_EXTRA_CA_CERTS`, and from being attached to with `--inspect` — the last of which is the only remaining "DevTools reachability outside development" hole after D70, since a Node inspector on main is strictly more powerful than DevTools on the renderer. `resetAdHocDarwinSignature: true` is required, not optional: flipping fuses invalidates the signature and this build is ad-hoc signed (`identity: '-'`, P12 D12). S6/S7 run on Linux and in CI, so the *configuration* is guarded here even though the *artifact* can only be verified on macOS (§8). |
| **D78** | **`grantFileProtocolExtraPrivileges` is left ON, explicitly, with a comment saying why, and S7 makes turning it off a packaging-check failure.** `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`, `enableCookieEncryption` and `loadBrowserProcessSpecificV8Snapshot` are all left at their defaults. | F71: flipping it off blocks the renderer's own ES module with a CORS error and the app never boots — measured, not reasoned. electron-builder's own doc text (*"If you aren't serving pages from `file://` you should disable this fuse"*) reads like an invitation and is a trap for this app specifically, which is exactly why the reason is written down where the next person will look. The others: asar integrity validation is an experimental macOS feature whose hash flow interacts with signing, and this build is unsigned/ad-hoc — unverifiable here and a real breakage risk for no gain; `onlyLoadAppFromAsar` buys nothing when anyone who can drop an `app/` folder into the bundle can equally replace `app.asar` in an unsigned, unnotarized build; cookie encryption is meaningless for an app that sets no cookies. Adopting either of the last two would manufacture macOS verification debt for no measurable benefit, which P43/P44/P45 all treat as a cost. |
| **D79** | **No `app.commandLine` switch is added. Not one.** The mandate's switch clause is answered by F75's grep, and the reasoning is recorded here so a later phase does not re-litigate it from scratch. | Three reasons, in order of weight. (1) **It is fail-open and untestable**: Chromium ignores unknown `--disable-features` names silently, so an Electron bump that renames one re-enables the capability with nothing able to catch it — the opposite of every other change in this phase, each of which has an assertion that fails on revert. (2) **The targets are not there.** No media element exists, so hardware media-key handling never registers (F70); the Cast/Media Router components are `//chrome`-layer and not in Electron's build; there is no spare renderer to save (F70's process tree). (3) **Where a capability *is* real, Electron gives a first-class, assertable API for it** — `setSpellCheckerEnabled` (D74), the permission handlers (D71). Prefer the lever that can be tested, every time. |
| **D80** | **`backgroundThrottling` is left at its default (`true`, i.e. throttling on).** | F72 checked the two things that could have needed it off, and neither does: the quit-flush handshake is IPC-driven end to end (`state/tabs.ts:130-136` cancels its own timer and saves immediately), and the app's single `setInterval` runs only while an operation is in flight. Throttling a hidden window is what a well-behaved desktop app should do for the RAM/CPU budget this app is held to. Recorded as a decision rather than silence because the mandate asked the question directly. |
| **D81** | **All new UI coverage goes in one new Docker-free spec, `tests/ui/hardening.spec.ts`**, added to the standing Docker-free subset. Unit coverage goes in `tests/unit/security.spec.ts` (no mocking) and `tests/unit/menu.spec.ts` (`mock.module('electron', …)`). | The Docker-free subset is the only Playwright coverage that runs in this sandbox, so a hardening spec that needs Docker would ship unverified — and this phase's whole value is that each disable was confirmed. `mock.module` was validated here before being planned (`2 pass, 0 fail, 28 ms`; `bun test tests/unit` → 65 pass with it present, so it does not collide with the shared-module-registry hazard P45 F58 found), and `tests/unit/security.spec.ts` needs no mock at all because of D73's type-only import. |

---

## 3. The shape introduced: `src/main/security.ts`

Sketch, not final text — the implementing session writes it against the tree. What matters is the
signatures, the type-only `electron` import (D73), and the three comments (§0).

```ts
import type { BrowserWindow, Session, WebPreferences } from 'electron';

// Chromium routes both halves of navigator.clipboard through the permission *request* handler
// (P46 F68) — collapsing this to a deny-all breaks the grid's paste and clipboard.ts's five
// callers, with no failure visible in this repo's Docker-free test subset.
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

export function rendererWebPreferences(opts: {
  preload: string;
  isDev: boolean;
}): WebPreferences {
  return {
    preload: opts.preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: opts.isDev,
    spellcheck: false,
    webgl: false,
  };
}

export function hardenSession(session: Session): void {
  session.setSpellCheckerEnabled(false);
  session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  session.setDevicePermissionHandler(() => false);
}

export function hardenWindow(win: BrowserWindow, appBaseUrl: string): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // will-frame-navigate, not will-navigate: it fires first and covers sub-frames too (P46 F66).
  wc.on('will-frame-navigate', (event) => {
    if (!event.url.startsWith(appBaseUrl)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}
```

`src/main/env.ts`, in full:

```ts
import { app } from 'electron';

/** Unpackaged means development or test — the only place the dev menu and DevTools exist. */
export const isDevBuild = !app.isPackaged;
```

Call sites: `window.ts` builds `webPreferences: rendererWebPreferences({ preload, isDev: isDevBuild })`
and calls `hardenWindow(win, process.env.ELECTRON_RENDERER_URL ?? 'file://')` before the
`loadURL`/`loadFile` branch; `index.ts` calls `hardenSession(session.defaultSession)` after
`app.whenReady()` and passes `buildMenu({ isDev: isDevBuild })`.

`setDevicePermissionHandler(() => false)` is included with its status stated rather than implied: it
changes nothing observable today, because nothing in this app ever grants a WebUSB/HID/Serial device
in the first place. It is the lock that keeps that true, it is one line, and it sits next to the
handlers it belongs with.

---

## 4. Implementation order

Ten commits. Each is one sitting, independently reviewable and independently revertible. Each leaves
`bun run format`/`lint`/`typecheck` (node, web, db, unit) and `bunx electron-vite build` green, and
each is followed by the Docker-free Playwright subset —
`xvfb-run -a bunx playwright test tests/ui/{sqlite,startup,smoke,connections,workbench}.spec.ts`,
plus `tests/ui/hardening.spec.ts` from commit 1 onward. `bun test tests/unit` after commits 1, 2, 5, 7.

Ordering rationale: the module and its tests land first with **zero behavior change** (1), so every
later commit is a one-to-three-line diff whose revert is obvious; then the five renderer-level
disables one at a time (2–5, 7) with the one renderer-side change between them (6); then packaging
(8), which touches nothing the first seven do; then docs (9) and the §10 row (10), per this repo's
convention.

1. **`refactor(main): the renderer's security surface moves into one module`** — D73/D69/D81.
   New `src/main/env.ts` and `src/main/security.ts`, the latter exporting only
   `rendererWebPreferences({ preload, isDev })` **returning exactly today's four keys and nothing
   more**. `src/main/window.ts:20-25` calls it. `src/main/menu.ts:10-11` takes
   `{ isDev }: { isDev: boolean }` instead of reading `app.isPackaged` itself; `src/main/index.ts:24`
   passes `buildMenu({ isDev: isDevBuild })`.
   New `tests/unit/security.spec.ts` (no mocking — D73) pinning the returned object for both `isDev`
   values, and `tests/unit/menu.spec.ts` (`mock.module('electron', …)`, with `Menu.buildFromTemplate`
   returning its template so the test can walk it) pinning **today's** behaviour: the packaged
   template contains no `toggleDevTools` and no `reload` role, the dev template contains both.
   New `tests/ui/hardening.spec.ts` with its first scenario only: `getLastWebPreferences()`
   deep-equals F63's reported list.
   Verify: full gates; `bun test tests/unit` must go 63 → 63 + the new tests, 0 fail; the subset plus
   the new spec passes. **`git diff` must show no change to any `webPreferences` value.**

2. **`feat(main): DevTools cannot be opened in a packaged build`** — D70.
   `devTools: opts.isDev` added to `rendererWebPreferences`; `tests/unit/security.spec.ts` updated to
   assert `devTools: false` for `isDev: false` and `true` for `isDev: true`.
   `tests/ui/hardening.spec.ts` gains the dev-side guard: in the unpackaged harness,
   `webContents.openDevTools({ mode: 'detach' })` → `isDevToolsOpened()` is `true`, then
   `closeDevTools()`. The packaged inverse is covered by the unit test plus F64's recorded run.
   **If that scenario proves flaky** (a detached DevTools window in xvfb is the plausible failure),
   drop it rather than retry-loop it — the unit test is the real guard — and say so in the commit
   body.
   Verify: full gates; `bun test tests/unit`; subset + hardening spec.

3. **`feat(main): every Chromium permission is denied except the clipboard`** — D71.
   `hardenSession(session)` added to `security.ts` with the allowlist and the three handlers minus the
   spellchecker line (that is commit 5). Called from `src/main/index.ts` immediately after
   `app.whenReady()` and before `createSecretCipher()`.
   `tests/ui/hardening.spec.ts` gains two scenarios: (a) `Notification.requestPermission()` →
   `'denied'`, `navigator.permissions.query({ name: 'notifications' })` → `'denied'`, and
   `navigator.geolocation.getCurrentPosition` errors with code `1`; (b) **the clipboard still works** —
   `writeText` then `readText` round-trips, after focusing the window (F68: an unfocused document
   returns a misleading *"Document is not focused"* that must not be read as a permission result).
   Verify: full gates; subset + hardening spec. Scenario (b) is the one that would have caught a
   deny-all, and it runs for real here.

4. **`feat(main): the renderer cannot open a window, navigate away, or attach a webview`** — D72.
   `hardenWindow(win, appBaseUrl)` added to `security.ts`, called from `createWindow` before the
   `loadURL`/`loadFile` branch with `process.env.ELECTRON_RENDERER_URL ?? 'file://'`.
   `tests/ui/hardening.spec.ts` gains two scenarios, each the exact inverse of a reproduction in F65
   and F66: `window.open('https://example.com/', '_blank')` returns `null` and
   `BrowserWindow.getAllWindows().length` stays `1`; and after
   `location.href = 'https://kira-studio.invalid/'`, `webContents.getURL()` still ends in
   `out/renderer/index.html` and `[data-testid="status-bar"]` is still in the document.
   Note for the implementing session: `smoke.spec.ts` asserts `consoleErrors` is empty; check whether
   a prevented navigation logs anything to the renderer console and, if it does, keep that assertion
   out of these two scenarios and record what was logged in the commit body rather than filtering it
   silently.
   Verify: full gates; subset + hardening spec. Also run `bun run dev`'s equivalent path once —
   `ELECTRON_RENDERER_URL` set — to confirm the base-URL allowance does not block the dev server load.

5. **`feat(main): the built-in spellchecker is off`** — D74.
   `spellcheck: false` in `rendererWebPreferences`; `session.setSpellCheckerEnabled(false)` as the
   first line of `hardenSession`. `tests/unit/security.spec.ts` updated.
   `tests/ui/hardening.spec.ts` gains: `session.defaultSession.isSpellCheckerEnabled()` → `false` via
   `app.evaluate`, and an input's effective `spellcheck` property is `false` in the DOM.
   Verify: full gates; `bun test tests/unit`; subset + hardening spec.

6. **`feat(renderer): the shared text field opts out of autofill`** — D76.
   `theme/primitives/TextField.vue`'s `<input>` gains `autocomplete="off"`, placed **before**
   `v-bind="$attrs"` so a caller can override it. No other renderer file changes.
   `tests/ui/hardening.spec.ts` gains: open the connection dialog and assert
   `[data-testid="connection-password"]` has `autocomplete="off"`.
   Verify: full gates; subset + hardening spec — `connections.spec.ts` is the one that would notice
   any regression in dialog behaviour, and it is already in the subset.

7. **`feat(main): WebGL is off in the renderer`** — D75.
   `webgl: false` in `rendererWebPreferences`; `tests/unit/security.spec.ts` updated.
   `tests/ui/hardening.spec.ts` gains: `canvas.getContext('webgl')` is `null` while
   `canvas.getContext('2d')` is non-null. **The commit body must state that this scenario passes
   vacuously on Linux/xvfb** (WebGL is blocklisted there regardless) and is load-bearing only on
   macOS — §8 carries the same note.
   Verify: full gates; `bun test tests/unit`; subset + hardening spec.

8. **`build(package): the packaged app is neither a Node runtime nor debuggable`** — D77/D78.
   `electron-builder.yml` gains, with a comment carrying F71's measurement and D78's warning:
   ```yaml
   electronFuses:
     runAsNode: false
     enableNodeOptionsEnvironmentVariable: false
     enableNodeCliInspectArguments: false
     resetAdHocDarwinSignature: true      # fuses invalidate the ad-hoc signature (P12 D12)
   ```
   `scripts/verify-packaging.sh` gains **S6** (all three keys present and `false`) and **S7**
   (`grantFileProtocolExtraPrivileges` never set to `false` — F71 measured that it bricks the app),
   both in the existing `fail()` style and both static, so they run on Linux and in CI.
   Verify: `bun run verify:packaging` → all checks passed, and confirm S6/S7 actually fire by
   temporarily breaking each and reverting. Full gates. **The packaged half is macOS-owed** (§8):
   `package:mac` cannot run here (no macOS, and `prepackage:mac`'s native rebuild is blocked in this
   sandbox — AGENTS.md's Kafka section).

9. **`docs(architecture): the renderer's security surface`** — a new section in
   `docs/ARCHITECTURE.md`, placed after **Process model**: what is turned off and the one-sentence
   reason for each; the clipboard allowlist and *why it is an allowlist* (F68); the `file://` fuse
   hazard stated as a rule, not a footnote (F71/D78); the three non-findings that were decided rather
   than overlooked (background throttling, hardware acceleration, dialogs); and a pointer to
   `tests/ui/hardening.spec.ts` and `tests/unit/security.spec.ts` as what actually holds it. One line
   added to **Invariants**: *the renderer loads no remote content, opens no window, and navigates
   nowhere but its own base URL.*

10. **`docs(spec): record P46's Chromium/Electron feature reduction`** — rewrite SPEC.md:1069's
    outcome column from *"Not yet planned — queued"* in the same voice and at the same density as the
    P43/P44/P45 rows above it: what was disabled, what was deliberately not (D78/D79/D80 and §6),
    what was proven by running it, and what verification is owed on macOS (§8).

---

## 5. Verification

**After every commit**, in this order:

```
bun run format && bun run lint
bun run typecheck                       # node, web, db, unit — five projects
bunx electron-vite build
xvfb-run -a bunx playwright test tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts \
  tests/ui/smoke.spec.ts tests/ui/connections.spec.ts tests/ui/workbench.spec.ts \
  tests/ui/hardening.spec.ts
```

plus `bun test tests/unit` after commits 1, 2, 5 and 7, and `bun run verify:packaging` after commit 8.

Baselines to compare against, measured here on `8d4b4ea`: lint *"Checked 462 files … No fixes
applied"*; typecheck exit 0; build *"✓ built in 5.46s"*; unit **63 pass, 0 fail**; the five-spec
subset **13 passed (36.2 s)**; verify-packaging *"all checks passed"*. A commit that changes any of
these other than by adding tests is not done.

**What each disable is held by** — the point of the phase is that no row here reads "by inspection":

| Disabled | Held by | Runs in this sandbox? |
|---|---|---|
| Already-correct defaults (F63) | `hardening.spec.ts` — `getLastWebPreferences()` deep-equality | **yes** |
| `devTools` in packaged builds | `tests/unit/menu.spec.ts` + `tests/unit/security.spec.ts`; dev-side guard in `hardening.spec.ts` | **yes** (packaged branch by unit test) |
| Permissions (all but clipboard) | `hardening.spec.ts` — notifications/geolocation denied | **yes** |
| Clipboard **not** broken | `hardening.spec.ts` — write/read round-trip | **yes** (measured working here) |
| `window.open` | `hardening.spec.ts` — returns `null`, window count stays 1 | **yes** |
| External navigation | `hardening.spec.ts` — URL unchanged, status bar still present | **yes** |
| Spellchecker | `hardening.spec.ts` — `isSpellCheckerEnabled()` false + DOM `spellcheck` false | **yes** |
| Autofill opt-out | `hardening.spec.ts` — `connection-password` has `autocomplete="off"` | **yes** |
| WebGL | `hardening.spec.ts` — `getContext('webgl')` null | **vacuously** (D75; real only on macOS) |
| Fuses — configuration | `verify-packaging.sh` S6/S7 | **yes** |
| Fuses — packaged artifact | a `package:mac` run on the macOS box | **no** (§8) |

**Manual checks the implementing session runs once, not per commit:**

1. `bun run dev` starts, the window loads from `ELECTRON_RENDERER_URL`, DevTools opens from the View
   menu, and an edit triggers a Vite reload that is **not** blocked by D72's navigation guard.
2. In that dev window, copy a grid cell and paste into a cell — the D71 allowlist, exercised by hand
   against a real database rather than only through the round-trip assertion.
3. The connection dialog's password field: reveal it with the eye toggle and confirm no spellcheck
   underline appears (D74's actual motivation, F69).

---

## 6. Explicitly out of scope

- **`disableDialogs` / `safeDialogs`.** F74: six live `window.confirm()` callers, every one a
  destructive-action gate. Replacing them with the app's own confirmation UI — the way
  `FilterHistoryMenu.vue`/`ConsoleSavedMenu.vue` already replaced `window.prompt()` — is a UI change
  and belongs to a UI phase. Only after that would these two options be reachable.
- **`app.commandLine` switches, in their entirety.** D79, at length. Recorded as a decision rather
  than an omission precisely so a later phase does not spend the same afternoon on it.
- **`disableHardwareAcceleration()`.** F73: the grid's scroll budget depends on GPU compositing.
- **`backgroundThrottling: false`.** F72/D80: the default is already the setting this app wants, and
  nothing on the quit path depends on a timer.
- **`enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar`.** D78: one is experimental and
  entangled with a signing flow this build does not have; the other protects a bundle that anyone can
  edit anyway, because it is unsigned and unnotarized. Both would be pure macOS verification debt.
- **`grantFileProtocolExtraPrivileges: false`, and the custom-protocol migration that would make it
  safe.** F71 proves it breaks the app today. Serving the renderer from a registered custom protocol
  instead of `file://` — Electron's own recommendation — is a real, defensible follow-up, but it
  touches the build output, the CSP and the preload path, and it is a phase, not a commit.
- **A `webRequest` filter blocking non-`file:`/dev-server requests.** The `<meta>` CSP
  (`default-src 'self'`) already governs every subresource and `fetch`, and D72 now governs
  navigation and popups. A third layer over the same ground adds a per-request callback on the hot
  path for no capability that is still reachable.
- **Anything in `tests/db/`, `tests/electron-db/`, or the Docker-gated UI specs.** They are not
  touched. `interaction.spec.ts`/`data-view.spec.ts`'s sixteen clipboard assertions are named in
  F68 as *evidence*, not as files to edit — if D71 were wrong they would fail, which is the point.
- **The engine process's own network surface.** The drivers' outbound connections are the app's
  entire purpose; nothing here restricts them, and the `utilityProcess` is not a renderer.
- **Renaming or restructuring anything in `docs/v1/`.** P45 D57/D60 settled that; this phase appends
  one §10 outcome column and one new plan file.

---

## 7. Acceptance checklist

- [ ] `src/main/security.ts` exists, its only `electron` import is `import type`, and it exports
      exactly `rendererWebPreferences`, `hardenSession`, `hardenWindow`.
- [ ] `src/main/env.ts` is the only place `app.isPackaged` is read; `grep -rn "isPackaged" src/`
      returns exactly one hit.
- [ ] `rendererWebPreferences` returns `devTools: isDev`, `spellcheck: false`, `webgl: false`,
      `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `preload` — and **nothing
      else** (D69: no restated defaults).
- [ ] `hardenSession` is called once, on `session.defaultSession`, after `app.whenReady()`.
- [ ] The permission allowlist is exactly `clipboard-read` and `clipboard-sanitized-write`, in one
      `Set` shared by both handlers.
- [ ] `hardenWindow` is called in `createWindow` before the `loadURL`/`loadFile` branch.
- [ ] `tests/ui/hardening.spec.ts` exists, runs without Docker, and covers: pinned web preferences;
      notifications/geolocation denied; clipboard round-trip **working**; `window.open` denied and the
      window count unchanged; external navigation blocked with the status bar still present;
      spellchecker off; `connection-password` carrying `autocomplete="off"`; WebGL null.
- [ ] `tests/unit/security.spec.ts` and `tests/unit/menu.spec.ts` exist and pass;
      `bun test tests/unit` reports 0 fail and its file count has gone 7 → 9.
- [ ] `electron-builder.yml` sets the three fuses to `false` plus `resetAdHocDarwinSignature: true`,
      and **does not** set `grantFileProtocolExtraPrivileges`.
- [ ] `scripts/verify-packaging.sh` S6 and S7 exist, were each confirmed to fire by being broken and
      reverted, and `bun run verify:packaging` passes.
- [ ] `bun run format`/`lint`/`typecheck` (five projects)/`bunx electron-vite build` green after every
      commit; the Docker-free subset **plus `hardening.spec.ts`** green after every commit.
- [ ] `bun run dev` verified by hand: window loads, DevTools opens from the View menu, a Vite reload
      is not blocked, and a real copy/paste round-trips in the grid.
- [ ] `docs/ARCHITECTURE.md` has the new security-surface section and the added Invariants line.
- [ ] SPEC.md:1069's outcome column is written, and names both the macOS-owed fuse verification and
      the vacuous-here WebGL assertion rather than implying full coverage.
- [ ] No file under `docs/v1/plans/` other than this one is touched (P45 D65).

---

## 8. What is left, and who owns it

1. **The three fuses have never been verified on a packaged artifact.** They were measured against a
   *copied Electron binary* running the real `out/main/index.js` (F71), which is strong evidence and
   not the same thing as `dist/mac-arm64/Kira Studio.app`. `package:mac` needs macOS, and
   `prepackage:mac`'s native Kafka rebuild is blocked in this sandbox regardless (AGENTS.md). **Owner:
   whoever next runs `bun run package:mac` on the macOS box.** What to check: the app launches;
   `ELECTRON_RUN_AS_NODE=1 "Kira Studio.app/Contents/MacOS/Kira Studio" -e "…"` does not run as Node;
   `--inspect` prints no *"Debugger listening"*; `codesign -dv` still reports `Signature=adhoc` (the
   `resetAdHocDarwinSignature` half of D77); and a Kafka connection still works, since the fuse pass
   rewrites the same binary the native addon is loaded into.
2. **The WebGL assertion has only ever passed vacuously.** D75: xvfb blocklists WebGL before the
   option is consulted, so on this box the scenario cannot distinguish `webgl: false` from a revert.
   **Owner: the same macOS run** — confirm there that `getContext('webgl')` is `null` and that the
   grid still scrolls at the `docs/PERF.md` §1 budget with GPU compositing intact.
3. **The DevTools dev-side scenario may be dropped** (commit 2). If a detached DevTools window proves
   flaky under xvfb, the packaged branch is still held by `tests/unit/menu.spec.ts` and
   `tests/unit/security.spec.ts`, and the dev branch by the manual `bun run dev` check in §5. Whoever
   drops it should say so in the commit body, not silently.
4. **The custom-protocol migration** (§6) is the only path that would let
   `grantFileProtocolExtraPrivileges` be turned off, and it is the natural successor to this phase for
   anyone who wants to close the last `file://` privilege. It is a phase of its own: it changes the
   renderer's base URL, and therefore the CSP, the built asset paths and D72's `appBaseUrl`.
5. **Nothing in this phase changes what the engine process can reach on the network.** If a later
   phase wants to constrain outbound driver traffic, that is a different surface with different tools
   and none of this plan's findings apply to it.
