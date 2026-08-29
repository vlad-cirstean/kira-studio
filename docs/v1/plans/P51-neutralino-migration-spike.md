# P51 — NeutralinoJS migration spike (walking-skeleton launch)

> Plan for SPEC.md §10 phase **P51**. Deliverable, from the phasing table: *"on a branch cut from
> this point, get the app's existing built frontend rendering inside a NeutralinoJS window (a
> walking-skeleton launch), and record what that took and what it didn't reach."* Explicitly out of
> scope per the same row: OS keychain/credential encryption (P25's `safeStorage` equivalent), the
> native DB adapters and their engine subprocess, the bulk-data `MessageChannelMain` transport,
> packaging, and an E2E harness.
>
> **Read §0 first.** Unlike P20 (Electrobun), where the research verdict was "the runtime cannot be
> obtained here," this phase's verdict is the opposite: **the walking skeleton already ran, for
> real, in this sandbox, during the research for this document.** §0 is therefore not a list of
> blockers — it is a record of what was actually built and measured, so the Sonnet session
> implementing §3 is reproducing a known-working path rather than exploring an unknown one. The
> blockers that *do* exist are all in the deferred scope (§4), not in the walking skeleton.

---

## 0. Feasibility verdict (read this first)

**Yes. Kira Studio's existing, unmodified `out/renderer/` build renders in full inside a
NeutralinoJS window.** Verified end to end in this Linux sandbox on 2026-08-28 — a throwaway
scaffold under the scratchpad, never inside the repo — with a screenshot of the real workbench
(connections panel, empty state, "New connection" button, status bar) and zero console errors.

| Question | Answer |
|---|---|
| Is the CLI installable from this sandbox? | **Yes.** `@neutralinojs/neu@11.7.2` from `registry.npmjs.org`, 88 packages, 4 s. |
| Are the native runtime binaries reachable? | **Yes** — GitHub *Releases downloads* are permitted. `api.github.com` is **403**, which silently degrades the CLI to `nightly`; §0.5 has the one-line fix. |
| Does the Linux binary run here? | **Yes**, after `apt-get install libwebkit2gtk-4.1-0`. Verified with a real X window under `xvfb`, screenshotted. |
| Does the app's own renderer bundle load? | **Yes**, unmodified, straight out of `out/renderer/`. CSS applies, the module script executes. |
| Does the app *mount* with no shim? | **No** — one error, and only one: `TypeError: undefined is not an object (evaluating 'kira.onFlushBeforeClose')`. |
| Does it mount with a `window.kira` stub? | **Yes.** A ~30-line stub is sufficient for the entire workbench to render. |
| Does `neu build` produce a runnable artifact? | **Yes** for the bare binary + `resources.neu`. **No** for a real macOS `.app` — see §0.6. |
| Is any of this a macOS answer? | **No.** See §0.4. This is a WebKitGTK answer that de-risks a WKWebView attempt; it does not substitute for one. |

### 0.1 The install and download chain, with exact commands and output

```
$ npm view @neutralinojs/neu
@neutralinojs/neu@11.7.2 | MIT | deps: 18 | versions: 103
neu CLI for Neutralinojs
.unpackedSize: 216.8 kB
maintainers:
- shalithasuranga <shalithasuranga@gmail.com>

$ npm view neutralinojs
npm error 404 Not Found - GET https://registry.npmjs.org/neutralinojs - Not found
      # there is no `neutralinojs` package; the CLI is @neutralinojs/neu and the
      # browser client library is @neutralinojs/lib (6.9.0). The native runtime is
      # not on npm at all.

$ npm install @neutralinojs/neu@11.7.2
added 88 packages in 4s

$ npx neu create kiraprobe
neu: INFO Checking if neutralinojs/neutralinojs-minimal is a valid Neutralinojs app template...
neu: WARN Unable to check the template validity via the GitHub API. Assuming that the template is valid...
neu: INFO Downloading neutralinojs/neutralinojs-minimal template to kiraprobe directory...
neu: INFO Extracting template zip file...
neu: INFO Downloading Neutralinojs binaries..
neu: WARN Unable to fetch the latest version tag from GitHub. Using nightly releases...
neu: INFO Extracting binaries.zip file...
neu: INFO Downloading the Neutralinojs client..
neu: WARN Unable to fetch the latest version tag from GitHub. Using nightly releases...
neu: INFO Downloading the Neutralinojs types..
neu: INFO Enter 'cd kiraprobe && neu run' to run your application.
```

Seven platform binaries land in `bin/`, all genuine and all correct-architecture:

```
$ file bin/*
bin/neutralino-linux_x64:     ELF 64-bit LSB pie executable, x86-64 …
bin/neutralino-mac_arm64:     Mach-O 64-bit arm64 executable …
bin/neutralino-mac_universal: Mach-O universal binary with 2 architectures: [x86_64] [arm64]
bin/neutralino-win_x64.exe:   PE32+ executable (GUI) x86-64 …
```

Reachability, probed directly (`curl -sS -o /dev/null -w '%{http_code}\n'`):

| Host / path | Result |
|---|---|
| `https://github.com/neutralinojs/neutralinojs/releases/download/v6.9.0/neutralinojs-v6.9.0.zip` | **200**, 8 050 711 bytes, 7 binaries inside |
| `https://github.com/neutralinojs/neutralino.js/releases/download/v6.9.0/neutralino.js` | **200**, 17 597 bytes |
| `https://raw.githubusercontent.com/…` | **200** |
| `https://neutralino.js.org/` | **200** (docs are readable from here, unlike P20's `electrobun.dev`) |
| `https://api.github.com/repos/neutralinojs/neutralinojs/releases/latest` | **403** |
| `https://github.com/neutralinojs/neutralinojs/releases/latest` (HTML redirect) | **403** |

This is the same allow-list P20 §0.1 documented, re-confirmed against
`curl -sS "$HTTPS_PROXY/__agentproxy/status"`: `registry.npmjs.org, jsr.io, npm.jsr.io, pypi.org,
files.pythonhosted.org, index.crates.io, proxy.golang.org`, plus GitHub *release downloads* and
`raw.githubusercontent.com`. The MCP GitHub tools are repo-scoped to `vlad-cirstean/kira-studio`
and return `Access denied` for `neutralinojs/*`, so they are not a workaround either.

**Unlike P20, none of this is a blocker.** The only thing `api.github.com` was needed for is
resolving "what is the latest tag," and that is trivially replaced (§0.5).

### 0.2 The Linux prerequisite, and why `ldd` hides it

The binary does **not** link WebKit — it `dlopen`s it, so `ldd` reports no missing library and the
failure would otherwise only appear at runtime:

```
$ ldd bin/neutralino-linux_x64 | grep -ci webkit
0
$ strings bin/neutralino-linux_x64 | grep -i webkit | head -3
Please install libwebkit2gtk-4.0-37 or libwebkit2gtk-4.1-0 library to run this application.
libwebkit2gtk-4.0.so.37
libwebkit2gtk-4.1.so.0

$ ldconfig -p | grep -c webkit
0                                         # before
$ apt-get update && apt-get install -y libwebkit2gtk-4.1-0
$ ldconfig -p | grep webkit2gtk
        libwebkit2gtk-4.1.so.0 (libc6,x86-64) => /lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0
```

`apt-get update` first is **required, not optional**: without it the install fails with `404 Not
Found` on four stale package URLs (`libwebkit2gtk-4.1-0`, `libpipewire-0.3-common`,
`xdg-dbus-proxy`, `xdg-desktop-portal`). This is the same shape of finding as P20 §0.2 for
Electrobun, and the same package.

### 0.3 The walking skeleton, as actually built and run

Three runs, each screenshotted from the Xvfb root window (`xwd` → `xwdtopnm` → `pnmtopng`; the
container has no `import`/`scrot`, `x11-utils`/`x11-apps`/`netpbm` were installed for this).

**Run 1 — the stock template**, to establish the runtime works at all. A real 800×500 X window
titled `kiraprobe`, rendering the sample page and reporting `server: v6.9.0 . client: v6.9.0`, with
the WebKit Web Inspector docked. `xwininfo -root -tree` confirms the window; a local static server
answers on `127.0.0.1:<port>` and `.tmp/auth_info.json` carries `nlPort`/`nlToken`/`nlConnectToken`.

**Run 2 — the app's real `out/renderer/`, no shim.** `resources/` was replaced wholesale by a copy
of `electron-vite build`'s renderer output (4 files, 2.4 MB: `index.html`, `assets/index-*.js`
2 133 kB, `assets/index-*.css` 169 kB, `assets/codicon-*.ttf` 149 kB). Result: a real 1280×800
window titled **Kira Studio**, the app's dark background painted — so the HTML parsed, the
stylesheet loaded and applied — and an empty `#app`. Exactly one console error, and it names the
whole gap:

```
http://127.0.0.1:33487/assets/index-C-ZRu_Aa.js:7091:35: CONSOLE JS ERROR
  TypeError: undefined is not an object (evaluating 'kira.onFlushBeforeClose')
```

That is `src/renderer/bridge/control.ts:34`'s module-scope `const kira = window.kira` with nothing
behind it. `main.ts`'s `bootstrap()` awaits five `hydrate*()` calls before `createApp(App).mount()`,
so the throw happens before Vue ever mounts.

**Run 3 — the same bundle plus a `window.kira` stub.** A ~30-line classic (non-module) script,
loaded from `<script src="./kira-stub.js">` immediately before the app's own module tag, installing
a `Proxy` on `window.kira` whose `on*` members return a no-op unsubscribe and whose other members
return a resolved promise — `defaultSettings` / `defaultLayout` verbatim from
`src/shared/domain/{settings,layout}.ts`, `{alive:false,pid:null}` for `engineStatus`, and `[]` for
everything else. **The entire workbench rendered**: connections panel with its search and `+`
affordances, the "No connections yet" empty state with its `New connection` button, the status bar
reading `no selection` and `engine connecting`, fonts and Catppuccin-derived colours correct.
**Zero console errors.** The packaged (`neu build`) Linux binary produces a byte-identical
screenshot to the `neu run` one.

Side observations, recorded because they were free, **not as results** — the same discipline P20 D6
insists on, and they violate it in one direction on purpose (see §0.4):

- Cold start, direct binary under `xvfb`, spawn → X window mapped, 3 runs: **150 / 127 / 127 ms**.
  Note this is *window mapped*, not first paint of the app UI, and the Electron figure it sits
  beside (`did-finish-load at uptime 499ms`, from this sandbox's own run) is a different marker.
- Resident set, `ps -eo rss`, same machine, same session, zero connections, zero tabs:
  **Neutralino shell ≈ 166 MB in 1 process**; **Electron, the real app, ≈ 797 MB across 7
  processes** (browser 186 + two zygotes 125 + GPU 146 + NetworkService 85 + renderer 136 + the
  engine's `node.mojom.NodeService` 118).
- `neu build --macos-bundle` output: `dist/kira-studio/` at 24 MB total, `resources.neu` 2.5 MB.

### 0.4 What Linux does and does not tell you

The same caveat P20 §0.2 raised, and it has not weakened. SPEC §1/§3 scope this product to **macOS
13+, arm64**. Neutralino embeds `webview/webview`, which means **WebKitGTK on Linux and WKWebView on
macOS** — two different engines with different process models, different memory accounting and
different frame scheduling.

What the Linux run *does* establish, and it is not nothing:

- The renderer bundle is **portable off Chromium**. 31 989 lines of Vue, CodeMirror 6, Tailwind v4
  and two hand-rolled virtualizers rendered correctly on a WebKit engine with no code change and no
  console error. That is the single largest unknown in any Electron-alternative move for this app,
  and it is now answered in the encouraging direction — on a WebKit *cousin* of WKWebView.
- The **static-serving model works**: `base: './'` relative asset paths, and the `<meta>` CSP
  `default-src 'self'; script-src 'self'; …` is satisfied because Neutralino serves over
  `http://127.0.0.1:<port>`, not `file://`. No `grantFileProtocolExtraPrivileges`-shaped trap
  (`electron-builder.yml`'s own warning) exists here.
- The **shim surface is one object**, because `src/renderer` imports `'electron'` **nowhere** and
  reaches the platform only through `window.kira` and one relayed `MessagePort`.

What it does **not** establish: any macOS number, any WKWebView rendering claim, native title bar /
traffic-light behaviour, the macOS application menu, or that the published macOS binary even
launches. The published `neutralino-mac_arm64` v6.9.0 declares
`LC_BUILD_VERSION … minos 14.0.0 sdk 14.5.0` — **macOS 14**, above SPEC §3's macOS 13 floor and
above `electron-builder.yml`'s `minimumSystemVersion: '13.0'`. That is the same class of finding as
P20 §8 Q1 and it is a real product constraint, not a footnote (D9, §8 Q1).

### 0.5 Reproducibility: pin the version, never let the CLI guess

Because `api.github.com` is 403 here, `neu create` silently resolves both the runtime and the client
to the **`nightly`** tag (two `WARN` lines, exit code 0). A spike whose runtime is "whatever
`nightly` was that afternoon" is not reproducible. `src/modules/downloader.js`'s
`getBinaryDownloadUrl`/`getClientDownloadUrl` consult the API **only when `cli.binaryVersion` /
`cli.clientVersion` are empty**, so setting them makes the whole problem disappear:

```
$ node -e "…set cli.binaryVersion='6.9.0', cli.clientVersion='6.9.0'…"
$ neu update
neu: INFO Downloading Neutralinojs binaries..
neu: INFO Extracting binaries.zip file...
neu: INFO Downloading the Neutralinojs client..
neu: INFO Downloading the Neutralinojs types..
      # no WARN, no API call, deterministic artifacts
```

v6.9.0 is the current release (released 2026-07-24; confirmed from
`raw.githubusercontent.com/…/CHANGELOG.md` and cross-checked against `npm view @neutralinojs/lib
version` → `6.9.0`, since the API path that would normally answer this is blocked).

### 0.6 Three things that do **not** work, found by trying them

1. **`documentRoot` outside the project directory crashes the native binary.** Pointing
   `documentRoot` / `cli.resourcesPath` at `/../out/renderer/` — the obvious way to avoid copying
   the build output — dies immediately:
   ```
   terminate called after throwing an instance of 'std::bad_alloc'
     what():  std::bad_alloc
   ```
   A **symlink** (`neutralino/resources -> ../out/renderer`) works and renders identically, so the
   constraint is on the configured path string, not on the filesystem layout. D4 chooses a copy
   step over the symlink anyway, for a reason the symlink itself creates.
2. **`neu build --macos-bundle` does not produce a macOS app bundle.** Read the CLI's own source
   (`src/modules/bundler.js:211-217`): it is `fs.renameSync(binary, binary + '.app')` and nothing
   else. The result is a bare Mach-O file whose name ends in `.app` — no `Contents/MacOS/`, no
   `Info.plist`, no `CFBundleIdentifier`, no icon, no signature. Confirmed:
   ```
   $ file dist/kira-studio/kira-studio-mac_arm64.app
   kira-studio-mac_arm64.app: Mach-O 64-bit arm64 executable, flags:<…>
   ```
   `scripts/verify-packaging.sh`'s A3 (ad-hoc signature) and A5 (`CFBundleIdentifier ==
   com.kirathecat.kira-studio`) have nothing to assert against. Packaging is genuinely from scratch
   (§4).
3. **`neu build` fails on files the page never uses.** It hard-errors on a missing
   `cli.clientLibrary` target and on a missing `modes.window.icon` — `ENOENT … './resources/js/
   neutralino.js'`, then `ENOENT … './resources/icons/appIcon.png'` — even though a pure static
   shell references neither. Both files must exist inside `resources/`.

### 0.7 One deferred-scope question answered early, because it was cheap

The app's `<meta>` CSP is `script-src 'self'`, which would plausibly block Neutralino's own
injected globals and break every native API before a future phase even starts. **It does not.**
Verified by adding `<script src="./js/neutralino.js">` to the shell and probing:

```
CONSOLE ERROR NLPROBE NL_TOKEN=string NL_PORT=number Neutralino=object
CONSOLE ERROR NLPROBE init-ok
CONSOLE ERROR NLPROBE mem-ok total=undefined     # a real native round-trip resolved, not rejected
```

So the `NL_*` globals arrive (WebKit user scripts are not subject to the page CSP), the client
library loads as a same-origin `'self'` script, `Neutralino.init()` succeeds, and a real
`computer.getMemoryInfo()` call round-trips over the WebSocket bridge. This is recorded as a
**finding for a future phase**, not as scope for this one — this phase's shell does not load the
client library at all (D3).

---

## 1. Ground rules for this phase

- **The branch is not expected to merge.** Same posture as P20 D10: this is a throwaway artefact
  answering a question, on `claude/electron-neutralino-migration-k91kc8`, cut from `feature/kickoff`.
- **`src/`, `electron.vite.config.ts`, `electron-builder.yml`, `scripts/verify-packaging.sh` and
  every file under `tests/` are not touched.** Not one line. The Electron app must still build,
  run and test exactly as it does today, on this branch, at every commit. If a change to `src/`
  looks necessary, that is a finding to write down, not a change to make (D2).
- **No new runtime or dev dependency in the root `package.json`.** The CLI is invoked with
  `npx`/`bunx` from inside the shell directory, which has its own `package.json`. Nothing about the
  Electron app's dependency graph changes (D5).
- **Every claim in the phase record is backed by a command and its output**, in P20's style. A
  screenshot counts; "should work" does not.
- **Scope left out is left out entirely, not half-implemented** (AGENTS.md). There is no half-wired
  IPC channel, no partial engine spawn, no stubbed keychain. §4's items are absent, and §4 says what
  each would actually take.
- **The stub is labelled as a stub, in the file.** Its header says it fakes the platform, returns
  fixed data, and that no `window.kira` call it answers reaches anything real.

### Realities this phase works with (re-counted against the current tree, 2026-08-28)

1. **`src/renderer` imports `'electron'` zero times.** `grep -rn electron src/renderer` → nothing.
   Fifteen files in `src/` import it: fourteen under `src/main`/`src/preload`, plus
   `src/engine/index.ts`, which is `import type { MessagePortMain }` — type-only. The renderer
   reaches the platform through exactly two doors: `window.kira` (the `contextBridge` surface,
   `src/preload/index.ts:155`) and a `MessagePort` relayed via `window.postMessage`
   (`src/renderer/bridge/port.ts`). This is why §0.3's run 3 worked with a 30-line shim.
2. **`window.kira` is captured once, at module scope.** `src/renderer/bridge/control.ts:34` is
   `const kira = window.kira;`. The stub must therefore be installed by a **classic script tag
   ordered before the app's module tag** — not from inside a module, not lazily. (P50 D3 records the
   same fact from the other direction: `window.kira` is frozen and non-configurable under Electron,
   so renderer-side patching is impossible there. Under Neutralino there is no `contextBridge`, so
   the property is an ordinary one and the ordering is the only constraint.)
3. **Boot order is hydrate-then-mount.** `src/renderer/main.ts:60-70`: `initCacheStats()`,
   `initAppMetrics()`, then `await Promise.all([hydrateLayout, hydrateSettings, hydrateConnections,
   hydrateOps, hydrateTabs])`, then `createApp(App).directive('tooltip', vTooltip).mount('#app')`.
   Any rejection in that `Promise.all` means nothing mounts — which is precisely §0.3 run 2.
4. **`defaultSettings` and `defaultLayout` already exist** as exported constants
   (`src/shared/domain/settings.ts:54`, `src/shared/domain/layout.ts:47`). The stub copies their
   values; it does not import them (the stub is a plain `.js` file outside the Vite graph).
5. **The renderer build output is four files and it is already relative-path-clean.**
   `electron.vite.config.ts`'s renderer block sets `base: './'` and `root: 'src/renderer'`, so
   `out/renderer/index.html` references `./assets/…`. Nothing about it assumes `file://` or
   Electron. Its `<meta>` CSP is
   `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:;
   img-src 'self' data:`.
6. **`out/` is gitignored** (`.gitignore`'s `out` entry, under "Next.js build output"), and so are
   `dist` and `node_modules/`. A `neutralino/bin/` directory of 22 MB of downloaded binaries is
   **not** covered by any existing rule and would otherwise be committed (D6).
7. **The control surface is 61 IPC channels** (`src/shared/protocol/ipc.ts`'s `IPC` const) in four
   shapes: request/response, main→renderer push, renderer→main fire-and-forget, and one
   `MessagePort` transfer (`port: 'kira:port'`). The stub answers the first three shapes trivially
   and the fourth not at all — `bridge/port.ts`'s `ready` promise simply never resolves, which is
   why the status bar reads `engine connecting` forever and is the correct, honest depiction of a
   shell with no engine.
8. **Neutralino has no Node.js anywhere in its own process model.** The native binary is C++
   (`webview/webview` + `zserge/tray` + `portable-file-dialogs` + Asio); the page gets the
   `Neutralino.*` client and nothing else. Both routes to a child process — the **extensions**
   mechanism and `os.spawnProcess` — are stdio/WebSocket-mediated by the native binary, and both are
   out of scope here (§4).
9. **Neutralino's `Neutralino.*` surface, read from the v6.9.0 `neutralino.d.ts` this research
   downloaded**, is 15 namespaces: `app`, `clipboard`, `computer`, `custom`, `debug`, `events`,
   `extensions`, `filesystem`, `net`, `os`, `resources`, `server`, `storage`, `updater`, `window`.
   **There is no keychain, credential or secure-storage namespace of any kind** —
   `grep -i "keychain\|keyring\|secure" neutralino.d.ts` returns nothing, and `storage` is a plain
   unencrypted key/value store. `window.setMainMenu(WindowMenu)` does exist, with a per-item
   `shortcut`, and the docs describe it as "the application menu on macOS."
10. **The size of what a full migration would eventually have to replace**, for context only:
    `src/main` 50 files / 3 406 lines, `src/preload` 1 / 161, `src/engine` 119 / 14 743,
    `src/renderer` 178 / 31 989, `src/shared` 26 / 2 836. §4 is written against these numbers; this
    phase touches none of them.

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The phase's deliverable is a launchable static shell, and that is the whole of it.** The success condition is: a Neutralino window opens, the real `out/renderer/` bundle mounts, the workbench renders, no console errors. No IPC works, no data loads, nothing connects. | This is what the user asked for verbatim ("skip the more complex things like keychain and only try to run the app using neutralino"), what the phasing table row says, and — decisively — what §0.3 proves is achievable *today*. P20's failure mode was reading the phasing table's optimistic wording as literal scope; the correction is to define the scope by what was empirically reached, which here happens to be exactly what was asked for. |
| D2 | **Zero edits to `src/`, `tests/`, `electron.vite.config.ts`, `electron-builder.yml`, `scripts/verify-packaging.sh`, or the root `package.json`.** The shell consumes `out/renderer/` as a read-only input. | The Electron app is the working product and this is a throwaway comparative spike (the row's own "comparative, not a one-way door"). Any `src/` change would (a) need to survive the branch never merging, (b) risk the Electron build, and (c) make it impossible to claim the *unmodified* renderer runs — which is the single most valuable finding this phase has. It is also the only way "the renderer needed no changes" stays a true sentence. |
| D3 | **The shell does not load `neutralino.js` and calls no `Neutralino.*` API.** The client library file is present only because `neu build` demands it (§0.6 item 3); no `<script>` tag references it. | A walking skeleton that already calls native APIs is not a walking skeleton, it is the start of the migration D1 rules out. Keeping the page free of `Neutralino.*` also keeps the finding clean: what rendered is *the app's bundle*, not the app's bundle plus some Neutralino glue. §0.7 already answered the one question that would otherwise justify loading it early (does the app's CSP permit it — yes), so nothing is lost by deferring. |
| D4 | **The shell's `resources/` is produced by a small copy-and-inject script, not a symlink and not a rewritten `electron-vite` `outDir`.** `scripts/build-neutralino-shell.sh` copies `out/renderer/` into `neutralino/resources/`, drops in `kira-stub.js`, and injects the one `<script>` tag into the *copied* `index.html`. | All three options were considered against §0.6. A `documentRoot` outside the project **crashes** the binary, so that is out. A symlink works (verified) but the stub tag has to be injected into `index.html` — which under a symlink *is* `out/renderer/index.html`, i.e. editing a build product that `electron-vite build` silently overwrites and that `out/` being gitignored makes invisible in `git status`. Changing the renderer's `outDir` is a D2 violation. A copy is the only option where the injected tag lives somewhere stable, `out/` stays pristine, and re-running the script after a rebuild is idempotent. |
| D5 | **The Neutralino CLI is a dependency of `neutralino/package.json`, never of the repo root's.** Invoked as `npx neu …` from `neutralino/`. | Reality #6 and the branch's throwaway status. Adding `@neutralinojs/neu` to the root `devDependencies` would put a `bun.lock` change on a branch that is not supposed to merge, and would drag 88 packages into every future `bun install` for a directory nobody but this phase reads. It also keeps `bun install` at the repo root byte-identical, which is what makes "the Electron app is unaffected" verifiable rather than asserted. |
| D6 | **`cli.binaryVersion` and `cli.clientVersion` are pinned to `6.9.0` in the committed config, and `neutralino/bin/` is gitignored.** | §0.5: unpinned, this sandbox's 403 on `api.github.com` silently resolves to `nightly`, so the artefact is unreproducible and the phase record would be describing an unnamed build. Pinning also makes the config work identically on a machine *with* API access, which is the machine the macOS follow-up would run on. `bin/` is 22 MB of redistributable binaries with no existing `.gitignore` rule covering it (reality #6) — it is regenerable in one `neu update`, so it is ignored rather than committed. |
| D7 | **The stub is a hand-written `Proxy`, ~30 lines, with fixed defaults — not a generated mock, not a replay of P50's `tests/ipc/` fixtures.** `on*` members return a no-op unsubscribe; `settingsGetAll`/`layoutGetAll` return the `defaultSettings`/`defaultLayout` values verbatim; `engineStatus` returns `{alive:false,pid:null}`; everything else resolves to `[]`. | Verified sufficient in §0.3 run 3 — the whole workbench, zero errors. A generated or fixture-driven mock would be strictly more machinery for the same picture, and would create a false impression that the shell has data-plane behaviour. The `Proxy` also means the shell does not have to enumerate all 61 channels (reality #7) and will not break when a 62nd is added. Copying the two default objects by value rather than importing them is deliberate: the stub is a plain classic script outside the Vite graph (reality #2), and it must stay that way to be installable before the app's module tag. |
| D8 | **Linux is where this phase runs, and the record says so in every sentence that reports a number.** No macOS claim is made, and the Linux RSS/startup figures are labelled observations, not results. | §0.4. P20 D4 refused a Linux spike outright because P20's deliverable *was* a macOS measurement; this phase's deliverable is "does the frontend render in a Neutralino-hosted window at all," and that question has real, transferable Linux content — it is the renderer bundle's portability off Chromium, on a WebKit engine. Reporting the footprint numbers is still worth doing (they are free, and same-machine same-instrument, which is more than `docs/PERF.md` §2.2's cross-environment figures can say), but calling them a comparison would be P20 D6's mistake in a new costume. **They do not go in `docs/PERF.md`.** |
| D9 | **The macOS 14 floor is recorded as a finding, not resolved.** The published `neutralino-mac_arm64` binary's `LC_BUILD_VERSION` is `minos 14.0.0`; SPEC §3 says macOS 13+. | It is a genuine product-scope conflict and the phase that discovers it should say so plainly rather than quietly assume someone will rebuild the runtime from source. Whether Neutralino would have to be built with a lower deployment target, or SPEC's floor moved, is a decision for the human (§8 Q1) — exactly the shape of P20 §8 Q1, which raised Electrobun's macOS 14 floor the same way. |
| D10 | **The phase record is appended to this file, not to `docs/PERF.md` or `docs/ARCHITECTURE.md`.** SPEC §10's P51 row gets one implementation-record paragraph appended by the implementing session, in the P48/P49/P50 style. | `docs/ARCHITECTURE.md` documents the architecture the app *has* — an Electron three-process model that this phase does not change by one line (D2). `docs/PERF.md` §2's numbers are Electron-under-`getAppMetrics()` and must stay comparable to themselves (P20 D9's reasoning, unchanged). A throwaway shell on a non-merging branch belongs in its own plan document's outcome section. |

---

## 3. Implementation order

Everything below has been executed once already, in a scratch directory, exactly in this order.
Where a step has a known failure mode, it is named.

### Stage 0 — prerequisites in the session's environment

1. `apt-get update && apt-get install -y libwebkit2gtk-4.1-0` (§0.2 — `apt-get update` is
   mandatory; without it four packages 404). Confirm with `ldconfig -p | grep webkit2gtk`.
2. `apt-get install -y x11-utils x11-apps netpbm` — only for verification (`xwininfo` to prove a
   window exists, `xwd`+`xwdtopnm`+`pnmtopng` to screenshot it). `xvfb-run` is already present.
3. `bun install` at the repo root if `node_modules/` is empty, then `bunx electron-vite build`. The
   renderer half needs no Electron binary. Confirm `out/renderer/index.html` and
   `out/renderer/assets/` exist.

### Stage 1 — scaffold the shell (`neutralino/`, new, top-level)

4. `mkdir neutralino && cd neutralino && npm init -y`, then
   `npm install --no-audit --no-fund @neutralinojs/neu@11.7.2` (D5 — root `package.json` untouched).
5. `npx neu create kira-shell` into a temp path, then move its `bin/` and its
   `resources/js/neutralino.js`, `resources/icons/appIcon.png`, `resources/icons/trayIcon.png` into
   `neutralino/`. (Only these four artefacts are wanted; the sample page and `main.js` are not.)
   `neu create` will print two `WARN … Using nightly releases` lines here — expected, fixed in the
   next step.
6. Write `neutralino/neutralino.config.json` by hand (§5 for its shape): `applicationId
   com.kirathecat.kira-studio`, `cli.binaryName kira-studio`, window title `Kira Studio`,
   1280×800 with `minWidth: 900` / `minHeight: 600` — `src/main/window.ts:20-21`'s own values, and
   the only size constraints it sets (the initial size there comes from restored layout bounds,
   which a shell with no storage has none of) — `documentRoot`
   and `cli.resourcesPath` both `/resources/`, `cli.binaryVersion` and `cli.clientVersion` both
   `"6.9.0"` (D6), `nativeAllowList` trimmed to `["app.*"]` since D3 calls nothing,
   `enableInspector: false`.
7. `npx neu update` — must run clean, with **no** `WARN` line (D6/§0.5). If a `WARN` appears, the
   version pin did not take; fix the config rather than proceeding.

### Stage 2 — the stub and the build script

8. `neutralino/kira-stub.js` — D7's ~30-line `Proxy`, with a header comment saying in as many words
   that it fakes the entire platform surface, that every value is fixed, and that nothing it returns
   reaches anything real.
9. `scripts/build-neutralino-shell.sh` (D4): fail if `out/renderer/index.html` is missing, with a
   message naming `bun run build`; `rm -rf neutralino/resources/assets` and copy `out/renderer/`
   into `neutralino/resources/`; copy `kira-stub.js` beside it; inject
   `<script src="./kira-stub.js"></script>` into the copied `index.html` immediately before its
   `<script type="module"` tag; be idempotent (re-running must not inject twice). Keep
   `resources/js/neutralino.js` and `resources/icons/*` in place — `neu build` hard-errors without
   them (§0.6 item 3) even though D3's page never references them.

### Stage 3 — run it, and prove it

10. `sh scripts/build-neutralino-shell.sh && cd neutralino && npx neu run --disable-auto-reload`,
    under `xvfb-run -a` on Linux. The CLI prints the chosen port and `neu CLI connected with the
    application`; the two `libEGL warning: DRI3 …` lines are Xvfb noise and are expected.
11. Prove the window: `xwininfo -root -tree` must show a window titled **Kira Studio** at the
    configured size. Screenshot it (`xwd -root -silent | xwdtopnm | pnmtopng`) and eyeball that the
    connections panel, the empty state and the status bar are all present.
12. Prove there are no errors: re-run once with `enableInspector: true`, which makes WebKit write
    console messages to the CLI's stdout, and confirm **no** `CONSOLE JS ERROR` line. (This is how
    §0.3 run 2's single error was caught; without the inspector flag the run is silent and a broken
    page looks identical to a working one.) Set it back to `false` afterwards.
13. `npx neu build` (without `--macos-bundle`, per §0.6 item 2 — the flag produces a misleading
    artefact and packaging is out of scope). Run `dist/kira-studio/kira-studio-linux_x64` directly
    and confirm it renders identically to step 11's screenshot.

### Stage 4 — the record

14. Append an **Outcome** section to this file: the exact versions used (`@neutralinojs/neu`,
    runtime, client), the commands run, what rendered, what did not, the console output, and the
    footprint/startup observations with D8's labelling.
15. Append one implementation-record paragraph to SPEC §10's P51 row, in the P48/P49/P50 style
    ("Implemented per `docs/v1/plans/P51-neutralino-migration-spike.md` — …"). Do not rewrite the
    row's existing text.
16. `git status` must show nothing outside `neutralino/`, `scripts/build-neutralino-shell.sh`,
    `.gitignore`, `docs/v1/plans/P51-neutralino-migration-spike.md` and `docs/v1/SPEC.md`.

---

## 4. Explicitly out of scope — and what each would actually take

Named concretely, so the next phase starts from a list rather than a blank page.

- **OS keychain / credential encryption (P25's `safeStorage` equivalent).** Neutralino has **no**
  secure-storage API at all (reality #9); `Neutralino.storage` writes plaintext files. There are
  three routes and each is real work: a **native extension** in a language with Keychain bindings,
  which reintroduces a second executable to sign; a **C++ Neutralino fork** adding a namespace,
  which forks the runtime; or `os.execCommand('security add-generic-password …')`, which is a shell
  round-trip per credential with quoting hazards. Whichever is chosen must preserve
  `SecretStorageStatus` (`src/shared/domain/secrets.ts`: `{available, backend:
  'keychain'|'basic_text'|'unavailable', insecureFallback, reason}`), probed once at startup, since
  `tests/e2e/secrets.spec.ts` scenario 1 fails loudly rather than skipping when `darwin` does not
  report `true`/`'keychain'`. A Linux dev fallback equivalent to `KIRA_INSECURE_SECRETS` (AGENTS.md,
  P25 D13) would have to be invented from nothing — Chromium's `basic_text` obfuscation has no
  Neutralino analogue.
- **The engine subprocess and the DB adapters.** `src/engine` is 119 files / 14 743 lines and
  `src/main/engine-host.ts` forks it with `utilityProcess.fork(…, {execArgv:
  ['--max-old-space-size=' + maxOldSpaceMb]})` — a V8 flag with no meaning outside Node, and a
  user-facing setting (`advanced.engineMemoryCapMb`). Under Neutralino this becomes a **vendored
  real Node.js runtime** spawned as a child, which is exactly the shape the parallel
  `wails-native-shell-spike` branch decided on for Wails (its §1.2, "real, standard Node.js … not
  compiled into a single executable"). Neutralino's two child-process routes are `os.spawnProcess`
  (stdio events marshalled through the native binary and out over the WebSocket to the page) and the
  **extensions** mechanism (the child receives `nlPort`/`nlToken`/`nlConnectToken` on stdin and
  connects back over `ws://localhost:{port}`, reaching the page via `app.broadcast`). Both are
  string/JSON-framed. `src/shared/protocol/port.ts`'s `PortRequest`/`PortResponse`/`PortEvent` are
  already transport-agnostic and would carry over; the framing layer and both endpoints would not.
- **The bulk-data `MessageChannelMain` transport.** `docs/ARCHITECTURE.md`'s Process model states
  the invariant — *"Bulk data skips the main process"* — implemented as a `MessageChannelMain` whose
  `port1` goes to the engine and `port2` to the renderer, so result pages never transit main.
  **Neutralino has no port-transfer primitive and no zero-copy or binary path**: every byte between
  a child process and the page goes child → WebSocket → native binary → `app.broadcast` → page, as
  JSON. This is the *same dealbreaker* P20 §9 item 2 recorded for Electrobun, and the same one the
  Wails spike had to design around. It is the largest architectural question a real migration faces
  and it is **not** softened by anything this phase found. `src/engine/rpc.ts`'s `transfer` argument
  is documented as always `undefined` today, so today's payloads are structured-clone rather than
  zero-copy — which lowers the bar without removing it.
- **Packaging, signing, notarization.** §0.6 item 2: the CLI's macOS "bundle" is a rename. A real
  `.app` (`Contents/{MacOS,Resources,Info.plist}`, `CFBundleIdentifier`, icon, ad-hoc `identity:
  '-'` signature) would be hand-built, plus a dmg/zip step, plus a replacement for
  `scripts/verify-packaging.sh`'s A1–A6 — of which A3 (ad-hoc signature) and A5
  (`CFBundleIdentifier`) currently have no artefact to inspect, and A4/A6 (asar-unpacked
  `engine.js`, unpacked Kafka `.node`) describe an archive format Neutralino does not have. S6/S7
  (`electronFuses`) have no analogue, but what they protect against — the shipped app being usable
  as a general-purpose Node runtime — applies *more* to a bundle that vendors a real `node` binary,
  not less.
- **An E2E harness.** `tests/e2e/fixtures.ts` is built on `_electron.launch()`. Playwright has an
  Electron driver and a browser driver and **no Neutralino driver**; the window is WebKitGTK on
  Linux and WKWebView on macOS, neither of which speaks CDP, and Playwright's WebKit support
  requires *its own patched build*, not the system one. This is P20 §9 item 1 verbatim, and it
  applies here for the identical reason. Three things a future phase could look at, none
  investigated here: WebKitGTK's `WEBKIT_INSPECTOR_SERVER` remote inspector (WebKit Inspector
  Protocol, not CDP — and Linux-only, so not the platform that matters); Appium's
  `mac2-driver`/XCUITest, which drives the OS accessibility tree rather than the DOM and would mean
  rewriting the suite's interaction model rather than porting it; and Neutralino's own
  `computer.sendKey`/`setMousePosition` (documented as working on Windows and macOS, and on Linux
  only under X11), which is OS-level input synthesis with no DOM query side at all.
- **The native menu, window chrome and lifecycle.** `src/main/menu.ts` is a native `Menu` with 13
  `accelerator` entries, whose items `webContents.send` the 11 `kira:menu:*` channels;
  `src/main/window.ts` restores bounds and persists debounced `resize`/`move`;
  `src/main/index.ts` holds a `before-quit` flush handshake with a 2 s timeout.
  `Neutralino.window.setMainMenu()` exists with per-item `shortcut` and is documented as the
  application menu on macOS, so this is *plausible* but entirely unbuilt and unverified — the shell
  has no menu at all.
- **Anything in `docs/PERF.md`.** D8/D10. No section is added, no number is edited, no budget is
  relaxed or re-measured. The Linux footprint figures live in this file's Outcome section and
  nowhere else.
- **A recommendation for or against migrating.** This phase establishes that the frontend renders.
  It does not establish that the migration is a good idea, and §7 lists what would have to be true
  first.

---

## 5. Target tree

```
neutralino/                              NEW  the shell — throwaway, branch-only
  package.json                           NEW  @neutralinojs/neu@11.7.2 only (D5)
  package-lock.json                      NEW
  neutralino.config.json                 NEW  pinned to runtime/client 6.9.0 (D6)
  kira-stub.js                           NEW  ~30 lines, D7's Proxy, header says it is a fake
  bin/                                  (ign) 7 platform binaries, ~22 MB, `neu update` regenerates
  resources/                                  built by scripts/build-neutralino-shell.sh (D4)
    index.html                          (gen) copy of out/renderer's, + one injected <script>
    assets/                             (gen) copy of out/renderer/assets/
    kira-stub.js                        (gen) copy
    js/neutralino.js                     NEW  present only because `neu build` demands it (§0.6)
    icons/{appIcon,trayIcon}.png         NEW  same reason
  dist/                                 (ign) `neu build` output; covered by .gitignore's `dist`
scripts/
  build-neutralino-shell.sh              NEW  copy out/renderer -> neutralino/resources, inject stub
.gitignore                               MOD  + neutralino/bin/ and neutralino/resources/ (D6, D4)
docs/v1/plans/
  P51-neutralino-migration-spike.md      MOD  this file + an Outcome section
docs/v1/SPEC.md                          MOD  §10 P51 row: one appended implementation paragraph
src/**                                    --  UNCHANGED (deliberately — D2)
tests/**                                   --  UNCHANGED (deliberately — D2)
electron.vite.config.ts                    --  UNCHANGED
electron-builder.yml                       --  UNCHANGED
scripts/verify-packaging.sh                --  UNCHANGED
package.json / bun.lock                    --  UNCHANGED (deliberately — D5)
docs/ARCHITECTURE.md                       --  UNCHANGED (deliberately — D10)
docs/PERF.md                               --  UNCHANGED (deliberately — D8/D10)
```

`neutralino/resources/` is gitignored in full: every file in it is either a copy of a build product
or a copy of a committed source (`kira-stub.js`), except `js/neutralino.js` and `icons/*`, which
`neu update`/`neu create` regenerate. The committed sources of the shell are therefore five files:
`package.json`, `package-lock.json`, `neutralino.config.json`, `kira-stub.js`, and the build script.

---

## 6. Acceptance checklist

- [ ] `libwebkit2gtk-4.1-0` installed after an `apt-get update`; `ldconfig -p | grep webkit2gtk`
      shows `libwebkit2gtk-4.1.so.0`.
- [ ] `neutralino/neutralino.config.json` pins `cli.binaryVersion` and `cli.clientVersion` to
      `"6.9.0"`, and `npx neu update` runs with **no** `WARN … Using nightly releases` line (D6).
- [ ] The root `package.json` and `bun.lock` show a clean `git diff` (D5).
- [ ] `git diff` over `src/`, `tests/`, `electron.vite.config.ts`, `electron-builder.yml` and
      `scripts/verify-packaging.sh` is empty (D2).
- [ ] `bun run build` still succeeds and `xvfb-run -a ./node_modules/electron/dist/electron
      --no-sandbox out/main/index.js` still boots the Electron app on this branch.
- [ ] `sh scripts/build-neutralino-shell.sh` is idempotent — running it twice leaves exactly one
      `<script src="./kira-stub.js">` in `neutralino/resources/index.html`.
- [ ] `neu run` opens a window that `xwininfo -root -tree` reports as titled **Kira Studio** at the
      configured size.
- [ ] A screenshot shows the real workbench: connections panel, "No connections yet" empty state,
      `New connection` button, status bar.
- [ ] A run with `enableInspector: true` produces **no** `CONSOLE JS ERROR` line, and
      `enableInspector` is back to `false` in the committed config.
- [ ] `neu build`'s `dist/kira-studio/kira-studio-linux_x64` renders identically to the `neu run`
      window.
- [ ] `neutralino/bin/` and `neutralino/resources/` are gitignored; `git status` is clean of both.
- [ ] `kira-stub.js`'s header comment says plainly that it fakes the platform and that nothing it
      returns is real.
- [ ] The Outcome section records exact versions, exact commands, and labels every Linux number as
      a Linux observation (D8).
- [ ] `docs/PERF.md` and `docs/ARCHITECTURE.md` show a clean `git diff` (D10).
- [ ] SPEC §10's P51 row gains one appended implementation paragraph and no rewrite.

---

## 7. What this phase does not answer

Recorded so a successful walking skeleton is not mistaken for a green light.

1. **Does any of it work on macOS?** Nothing here ran on WKWebView. The published macOS binary's
   `minos` is 14.0.0 against SPEC's 13+ floor (D9). Until someone launches this shell on an Apple
   Silicon Mac, the renderer's WebKit portability is evidence, not proof.
2. **Can bulk data still bypass the shell process?** No, on current evidence — Neutralino has no
   port-transfer and no binary channel (§4). `docs/ARCHITECTURE.md`'s "bulk data skips the main
   process" invariant does not survive as written, and `docs/PERF.md` §2.1's interaction budgets
   were measured under a design where it held.
3. **Is there any E2E story?** None found. This is the dealbreaker that killed P20 (§9 item 1) and
   it is unchanged.
4. **Does the runtime hold up under real load?** The shell renders an empty workbench. A 10 000-row
   virtualized grid, CodeMirror 6 with the SQL language pack, and the scroll behaviour P29/P47 tuned
   against *Chromium's* frame scheduling are all unexercised.
5. **Maturity and supply chain.** `@neutralinojs/neu` is MIT with 103 published versions and a
   single listed npm maintainer; the runtime is C++ over `webview/webview`. Against that, Electron
   44 is a vendored 227 MB binary in `node_modules` with a known rebuild story for the Kafka native
   addon (AGENTS.md). This is a factor in the decision independent of any number.
6. **What the app would lose.** `src/main/security.ts` is an audited list of Chromium capabilities
   deliberately turned off, and `electron-builder.yml`'s three `electronFuses` close the
   "debuggable outside development" path. Neither has a Neutralino equivalent, and Neutralino's own
   posture (`nativeAllowList`, `tokenSecurity`, a localhost HTTP server + WebSocket the page talks
   to) is a different security model that would need auditing from scratch, not porting.

---

## 8. Open questions for the user

1. **macOS 13 or 14?** The published Neutralino macOS binary requires macOS 14 (D9), SPEC §3 says
   13+, `electron-builder.yml` says `minimumSystemVersion: '13.0'`. Building the runtime from
   source with a lower deployment target is possible in principle and unbudgeted; moving SPEC's
   floor is a product decision. This is the same question P20 §8 Q1 raised for Electrobun and it is
   still unanswered.
2. **Is there a Mac to run this on?** Everything in §0 is Linux/WebKitGTK. The shell is
   platform-agnostic by construction — `neu run --arch arm64` on a Mac with the same committed
   config should be the whole of it — but nobody has done it. `docs/PERF.md` §3's manual macOS
   procedures have been unfilled since P12 for the same reason. **Partially answered by §9.1
   (2026-08-29):** the shell ran on a real Apple Silicon Mac and rendered under WKWebView — a
   memory reading only, not a rendering/console-error re-verification, and not a resolution of
   D9's macOS 14 floor question below.
3. **Given §4's bulk-data finding, is a Neutralino migration still interesting?** Three candidates
   have now been looked at and **all three** fail the same test: Electrobun (P20 §9 item 2, no
   port-transfer primitive), Wails (its own §3.2/§3.3 — bulk data necessarily transits the Go
   process), and Neutralino (§4, JSON over a WebSocket through the native binary). If "bulk data
   skips the main process" is non-negotiable, that is a finding about *the whole category* of
   system-webview shells, not about any one of them, and it should be decided once rather than
   rediscovered a fourth time.
4. **Should the shell be kept or deleted after the record is written?** P20 D10 deleted its
   artefacts. This one is five committed files and costs nothing to keep on a non-merging branch —
   but "keep" and "delete" should be a decision, not a default.

---

## 9. Outcome

Implemented exactly per §3, on this branch (`claude/electron-neutralino-migration-k91kc8`, cut from
`feature/kickoff`), in this Linux sandbox, 2026-08-28. Every acceptance-checklist item in §6 is met.

**Versions.** `@neutralinojs/neu@11.7.2` (CLI, from `registry.npmjs.org`). Runtime and client both
pinned to `6.9.0` per D6 — `npx neu update` ran with **no** `WARN … Using nightly releases` line,
confirming the pin took.

**Commands run, in order** (§3 Stage 0–3, all against the already-present `apt-get install -y
libwebkit2gtk-4.1-0` and the already-built `out/renderer/` from this session's environment):

```
$ mkdir neutralino && cd neutralino && npm init -y
$ npm install --no-audit --no-fund @neutralinojs/neu@11.7.2
$ npx neu create /tmp/kira-shell-scaffold        # bin/, resources/js/neutralino.js,
                                                  # resources/icons/{appIcon,trayIcon}.png pulled
                                                  # from here; sample page/main.js discarded
$ npx neu update                                 # after writing the pinned neutralino.config.json
$ sh scripts/build-neutralino-shell.sh           # run twice; index.html carries exactly one
                                                  # <script src="./kira-stub.js"> both times
$ xvfb-run -a npx neu run --disable-auto-reload
$ npx neu build
$ ./dist/kira-studio/kira-studio-linux_x64
```

**What rendered.** `xwininfo -root -tree` reported a window titled **Kira Studio**, 1280×800, for
both the `neu run` launch and the standalone `dist/kira-studio/kira-studio-linux_x64` binary. A
screenshot of each (`xwd` → `xwdtopnm` → `pnmtopng`) shows the real workbench — connections panel
with search/`+`, the "No connections yet" empty state and its `New connection` button, the status
bar reading `no selection` / `engine connecting` — and the two screenshots are **byte-identical**
(`diff` on the two PNGs reports no difference), confirming `neu build`'s packaged output matches the
dev-run output exactly.

**Console errors.** A run with `enableInspector: true` (reverted to `false` immediately after,
matching the committed config) produced zero `CONSOLE JS ERROR` lines in the CLI's stdout. The two
`libEGL warning: DRI3 …` lines present in every run are Xvfb/software-rendering noise, not app
output.

**Electron regression check (D2).** `xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox
out/main/index.js` on this same branch, after all of the above, logged `did-finish-load at uptime
393ms` — the real app still boots unmodified. `git diff` over `src/`, `tests/`,
`electron.vite.config.ts`, `electron-builder.yml`, `scripts/verify-packaging.sh`, the root
`package.json` and `bun.lock` is empty.

**Committed footprint.** Five files, matching §5 exactly: `neutralino/package.json`,
`neutralino/package-lock.json`, `neutralino/neutralino.config.json`, `neutralino/kira-stub.js`, and
`scripts/build-neutralino-shell.sh`, plus a `.gitignore` addition for `neutralino/bin/`,
`neutralino/resources/` and `neutralino/.tmp/` (D4/D6). `neutralino/bin/` (7 platform binaries,
~19 MB on disk) and `neutralino/resources/` (the copied+injected build output) are present on disk
but untracked, exactly as designed.

**Linux-only observations** (D8 — not results, not comparable to `docs/PERF.md`, not repeated
there): consistent with the §0.3 research figures on the same machine — a ~150 ms window-mapped cold
start for the direct binary under Xvfb, and a single-process RSS well under the multi-process
Electron figure recorded in §0.3. Re-measuring these was not repeated as part of this
implementation pass; §0.3's numbers stand as the recorded observation.

This closes the phase's own deliverable (D1): the unmodified renderer bundle mounts and the
workbench is fully visible with no engine, no data, and no console error, on a branch that leaves
the real Electron app provably untouched. §7's open questions (macOS, bulk-data transport, E2E,
load, security posture) remain exactly as recorded — this phase answers only whether a window comes
up, and it does.

### 9.1 Real macOS memory measurement (2026-08-29 addendum)

Answers §8 Q2 in part: **there is a Mac, and the shell was run on it.** Same real Apple Silicon Mac
(arm64, macOS 26.5.2) `docs/PERF.md` §2.4's P52 gate G1 used, on this branch, this session. This is
a memory reading, not a re-verification of §0.3/§9's render/console-error claims — those were not
repeated here.

**This is not a gate.** Unlike P52 §15, P51 defines no memory threshold and no go/no-go verdict for
this phase. The number below is recorded for comparison against `docs/PERF.md`'s Electron and Wails
figures, per D8's own logic in reverse: D8 kept the *Linux* figures out of `docs/PERF.md` because
WebKitGTK is not the target platform's engine; a *macOS* WKWebView figure has no such disqualifier.
It is not added to `docs/PERF.md` in this pass — only the plan record is updated, matching D10's
posture that this file, not `docs/PERF.md`, is where P51's own numbers live.

**Setup**, from a clean checkout of this branch: `bun run build` (renderer already present from
verifying this pass), `cd neutralino && npm install`, `npx neu update` — ran with **no** `WARN …
nightly` line, confirming the `6.9.0` pin still holds and, unlike §0.1's sandbox, `npx neu create`
on this machine printed `Found the latest release tag v6.9.0` rather than the `403`-driven nightly
fallback: `api.github.com` is reachable from here. `neutralino/bin/` and `neutralino/resources/`
are both gitignored and regenerate from scratch (D4/D6), so a fresh `neu create` scaffold was used
once to pull `resources/icons/{appIcon,trayIcon}.png` (§0.6 item 3 — `neu build` hard-errors
without them; `neu update` alone does not fetch them), then discarded. `sh
scripts/build-neutralino-shell.sh` built `neutralino/resources/` from `out/renderer/` as normal.

**Instrument and method.** No Go/`gopsutil` tooling exists on this branch (that is
`wails-native-shell-spike`'s `shell/cmd/g1measure`, a different app entirely) and `docs/PERF.md`
§2.4's `responsibility_get_pid_responsible_for_pid` attribution does not apply here regardless:
Neutralino's `neu build --macos-bundle` is a bare rename with no `Info.plist` (§0.6 item 2), so
there is no signed `.app` to launch via Finder/LaunchServices, and both `neu run` and the packaged
binary are reached by direct exec. Process attribution instead used **exact spawn-timestamp
correlation** (`ps -o lstart`): on every launch, the app's own three WebKit XPC helpers
(`.GPU`/`.Networking`/`.WebContent`) spawn within the same second as the app's own pid, distinct
from unrelated WebKit helpers already running on the machine from other apps (idle since a prior
day, per their own `lstart`). Confirmed directly by killing the app: only the four
same-timestamp pids exited; the stale helpers from other apps stayed running. RSS was sampled with
`ps -o rss=` for exactly those four pids, 10 samples 1 s apart, minimum taken, across three
independent launches for reproducibility: `neu run --disable-auto-reload` (dev mode,
`--load-dir-res`) once, and the packaged `neu build` output
(`dist/kira-studio/kira-studio-mac_arm64`, run directly, no CLI wrapper) twice.

**Result — converged within noise across all three independent launches:**

| Process | RSS (min) |
|---|---|
| `kira-studio-mac_arm64` (native binary) | ≈103.8 MB |
| `com.apple.WebKit.GPU` | ≈29.8 MB |
| `com.apple.WebKit.Networking` | ≈23.9 MB |
| `com.apple.WebKit.WebContent` | ≈77.8 MB |
| **Total** | **≈234.8 MB** (240 464 KB min) |

This is the real workbench (connections panel, empty state, status bar) rendering under the
`window.kira` stub from §0.3 run 3 — no engine, no IPC, no data, unchanged from this phase's D1
scope. A first, hastier sample (taken 4 s after launch, before the page had visibly finished
settling) read a stray ≈168 MB and was discarded as a measurement artifact once the following two
runs reproduced ≈235 MB from a full 10 s settle; it is not reported as a fourth data point.

**Against `docs/PERF.md`'s real-machine figures** (§2.2 Electron, §2.4 Wails/Go, same machine):

| Shell | Config | RSS |
|---|---|---|
| Electron (real app) | idle | 620–626 MB |
| Wails/Go (real app, G1) | blank | 216.3 MB |
| Wails/Go (real app, G1) | real renderer, 9 boot-path DB reads | 261.7 MB |
| Neutralino (this phase's shell) | real renderer, no engine/IPC/data | ≈234.8 MB |

Neutralino's reading sits between Wails' blank and real-renderer configs — closer to Wails' *blank*
figure is the fairer comparison, since this shell has no engine or data attached either. Both sit
far under Electron's baseline; neither result suggests Neutralino is a memory outlier against Wails
on the one axis this phase can measure.

**What this does not establish**, matching D8/§7's own discipline applied to a macOS number instead
of a Linux one: this is not a formal gate reading (P51 defines none, unlike P52 §15); the launch is
a direct exec, not the Finder/LaunchServices path a distributed app would use, so it carries the
same caveat `docs/PERF.md` §2.4 recorded for an `exec`'d Wails blank config (undercounts helpers
relative to a real launch) — except here every reading, including the packaged-binary ones, is
already an `exec`, so there is no LaunchServices-launched figure to compare against, unlike Wails'
G1 pass. It has not been through a review pass the way P52's G1 number was (§2.4 found and fixed
three real bugs before trusting its own reading); no equivalent scrutiny has been applied here. It
says nothing about §4's engine subprocess, bulk-data transport, or load behaviour, all still
unbuilt.

### 9.2 macOS packaging: real .app bundle feasibility (2026-08-29 addendum)

User-directed check before P52 proceeds further: is a real, distributable macOS `.app` even
buildable on top of Neutralino, or is packaging itself a blocker independent of the engine bridge?

**`neu build --macos-bundle` does not produce a real app bundle.** Read directly from the installed
CLI's own source
(`neutralino/node_modules/@neutralinojs/neu/src/modules/bundler.js:211-217`): the entire
`macosBundle` branch is `fs.renameSync(binary, binary + '.app')` — one rename, nothing else. Built
and confirmed empirically (`npx neu build --release --macos-bundle` from `neutralino/`): the output
`kira-studio-mac_universal.app` is `file(1)`-reported as a flat Mach-O universal binary, not a
directory — no `Contents/`, no `Info.plist`, no bundle identifier, no icon. This is the same gap
§0.6 item 2 already named in passing; this addendum is the first time it was checked for real. A
plain renamed executable would not register with LaunchServices or pass Gatekeeper's bundle checks
regardless of signing — this is not a signing problem, it is a missing-structure problem.

**A real bundle is buildable from Linux, without a Mac, for the structural half of packaging.**
Neutralino's own docs don't cover this gap; the community fills it with an unofficial script
(`hschneider/neutralino-build-scripts`' `build-mac.sh` — confirmed via its README and script body:
`jq`-driven config extraction, a scaffold `cp -r` into `Contents/`, `sed` templating for
`Info.plist`, explicitly noting it "should also run on Linux or Windows/WSL"). Rather than vendor a
third-party script sight-unseen, its approach was reproduced and verified directly against this
repo's own build output: `scripts/build-neutralino-macos-bundle.sh` (new, this addendum) takes
`neutralino/dist/kira-studio/kira-studio-mac_$arch` (the plain `neu build`, no `--macos-bundle`)
and `build/icon.png` (the same 1024×1024 source `electron-builder.yml` already uses) and produces
`neutralino/dist/kira-studio/mac_$arch/Kira Studio.app` with a real `Contents/MacOS/kira-studio`,
`Contents/Resources/{resources.neu,appIcon.icns}`, and a generated `Contents/Info.plist`
(`CFBundleIdentifier` and version read from `neutralino.config.json` via `jq`, not hand-copied).
Icon conversion needed `png2icns` (Debian/Ubuntu package `icnsutils`, not preinstalled — installed
for this check, no Mac-only tool involved). Run for real, arm64, output verified three ways:
`Contents/MacOS/kira-studio` is `file(1)`-reported as a valid arm64 Mach-O executable (the same
binary `neu build` fetched, untouched); `Contents/Info.plist` parses cleanly under Python's
`plistlib` with the expected `CFBundleIdentifier: com.kirathecat.kira-studio`;
`Contents/Resources/appIcon.icns` is `file(1)`-reported as a valid `ic10`-type Mac OS X icon. The
directory layout matches Apple's documented bundle structure exactly.

**What this does and does not settle.** Settled: macOS packaging is not a hard blocker on
Neutralino's own account — a correctly-shaped, real `.app` bundle is producible cross-platform, in
CI, from this repo's existing build output, with a script now committed
(`scripts/build-neutralino-macos-bundle.sh`) rather than a one-off manual step. Not settled, because
nothing in this sandbox can settle it: whether the packaged binary actually launches under
LaunchServices, resolves `resources.neu` correctly from inside `Contents/Resources` at runtime, and
clears Gatekeeper — `codesign` is an Apple-only binary with no Linux equivalent here, and there is
no macOS kernel in this sandbox to exec the Mach-O regardless of signing. This is not a new
limitation Neutralino introduces: `scripts/verify-packaging.sh`'s own A3/A5 checks already gate on
`command -v codesign` / `command -v PlistBuddy` and skip with a note on a non-macOS runner, because
the existing Electron pipeline has always had the same requirement — this sandbox could never
verify electron-builder's signed output end-to-end either. What genuinely differs from Electron:
electron-builder does all of the above (bundle scaffold, `Info.plist`, `asar`, ad-hoc signing,
fuses) automatically; Neutralino has none of it built in, so this project now owns a small,
independent script for the structural half, and still needs a real Mac for the signing/launch half
— same as today's Electron build already requires for its own final verification.

### 9.3 macOS packaging with a real engine: vendored Node + kafka-javascript's native addon (2026-08-29 addendum)

Follow-up to §9.2, user-directed: §9.2 only packaged the empty shell. The real risk is whether the
*engine* — a plain Node process P52 will spawn via `child_process.fork()`, plus
`@confluentinc/kafka-javascript`'s native addon (P32's hardest packaging problem for Electron,
D6/D7) — can be packaged for macOS at all without a Mac to build on.

**Neither piece needs a from-source compile.** Precedent: `wails-native-shell-spike`'s P51
(`docs/v1/plans/P51-wails-go-node-engine-spike.md` §1.2, §3.7) already reached the same conclusion
independently — "vendor an actual Node.js runtime binary, the ordinary kind anyone downloads from
nodejs.org" — stated there as a decision from the repo owner. This addendum reproduces it
concretely for Neutralino, with real downloaded artifacts, not just the architectural argument:

- **Node runtime**: `https://nodejs.org/dist/v22.22.2/node-v22.22.2-darwin-arm64.tar.gz` (matching
  this sandbox's own `node -v` — v22.22.2, ABI 127) downloads and extracts cleanly from Linux;
  `bin/node` is `file(1)`-confirmed as a valid arm64 Mach-O executable, 113 MB uncompressed. No
  macOS or cross-compiler involved — it's a prebuilt official release, same as anyone installing
  Node normally.
- **`@confluentinc/kafka-javascript`'s native addon**: publishes real prebuilds per Node ABI via
  `node-pre-gyp` (`package.json`'s `binary` block) on GitHub Releases, independent of Electron
  entirely — confirmed by downloading
  `confluent-kafka-javascript-v1.10.0-node-v127-darwin-unknown-arm64.tar.gz` directly (the exact
  asset list came from GitHub's `releases/expanded_assets/v1.10.0` fragment, since the repo API
  itself is out of this session's GitHub scope). Extracted `.node` is `file(1)`-confirmed as a
  valid arm64 Mach-O bundle, ABI 127 — the same ABI the vendored Node runtime above needs. This
  sidesteps P32 D6 entirely: `native-electron-build.sh`'s whole reason to exist is rebuilding this
  addon against Electron's *non-standard* embedded-Node ABI, which requires Electron's own headers
  (`artifacts.electronjs.org`, proxy-blocked in this sandbox per that script's own header comment).
  A plain-Node engine needs no such rebuild — Confluent already publishes the ABI Node itself uses.

Both fetches are now `scripts/fetch-neutralino-engine-runtime.sh` (new), writing to
`neutralino/engine-runtime/` (gitignored, same treatment as `neutralino/bin/` — these are
build-time fetches, not repo content). Re-run confirmed idempotent (second run re-uses both
artifacts, no re-download).

**Full composition, verified for real.** Both artifacts were assembled into §9.2's actual `.app`
bundle, alongside a real copy of `out/main/engine.js` + `out/main/chunks/` (the existing
Electron-agnostic engine build, P51 reality #1/#7 — untouched) and the JS-side runtime
dependencies `@confluentinc/kafka-javascript`'s native loader actually needs:
`node_modules/@confluentinc/kafka-javascript` itself calls `require('bindings')('confluent-kafka-javascript')`
(`librdkafka.js:11`) rather than requiring the `.node` file directly, so `node_modules/bindings`
(and its own dependency `file-uri-to-path`) must ship too — both copied in. `zod`, the one other
bare-specifier `require()` in `engine.js` itself, was included for the same reason. Resulting
layout: `Contents/Resources/node/bin/node` (vendored runtime) and `Contents/Resources/engine/`
(`engine.js`, `chunks/`, `node_modules/{@confluentinc/kafka-javascript,bindings,file-uri-to-path,zod}`),
with the darwin-arm64 `.node` swapped into
`engine/node_modules/@confluentinc/kafka-javascript/build/Release/` in place of the Linux one `bun
install` left there for local dev.

Verified three ways: `file(1)` on both native artifacts inside the assembled bundle confirms arm64
Mach-O; the assembled bundle's directory nesting puts `engine/node_modules/` exactly where Node's
own module resolution would find it from `engine/chunks/*.js` (parent-directory walk — the same
layout electron-builder's `asarUnpack` already relies on for pure-JS `require()` today, minus the
asar); and `bindings`' own resolution function (`bindings.js`, invoked for real against the
assembled tree, not simulated) was called with `module_root` pointing at the bundled
`@confluentinc/kafka-javascript` directory and returned exactly
`.../build/Release/confluent-kafka-javascript.node` — the file placed there. Total assembled
bundle: 145 MB (108 MB vendored Node, 32 MB engine + kafka addon, ~5 MB shell/resources).

**What this does not establish**, same boundary as §9.2: the vendored binaries are foreign-arch
Mach-O on this x86-64 Linux sandbox, so nothing here executes `node`, forks the engine, or actually
`dlopen`s the kafka addon — only their presence, format, and resolution paths are checked. Whether
`child_process.fork()` from the vendored `node` binary behaves identically to Electron's
`utilityProcess.fork()` (structured clone, `MessagePort` transfer) is unverified and stays P52
implementation work, not a packaging question. The 145 MB figure is this addendum's ad-hoc
assembly, not a production layout decision (whether `npm`/`npx`/`corepack` should also be stripped
from the vendored runtime, whether `node_modules` should be deduplicated against the app process's
own, exact `Info.plist`/entitlements for a two-executable bundle — a real `node` binary alongside
`kira-studio` — per the Wails plan's own note that this raises the *same* Node-runtime hardening
question Electron's `runAsNode` fuse addresses, "more, not less") is P52's to make, not this
addendum's.
