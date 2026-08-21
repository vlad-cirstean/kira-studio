# P0 — Foundations

> Plan for SPEC.md §10 phase **P0**. Authored by Opus, executed by Sonnet.
> Deliverable: *Bun + Biome + TS7 + electron-vite; three-process skeleton with MessagePort; SQLite storage + migrations; dark theme tokens + codicons; workbench shell (panels, status bar toggles, settings dialog with fonts); Playwright harness that launches and screenshots the app.*

## Implementation addenda (recorded by Sonnet during Step 1)

- **D8/D9 superseded.** At install time (2026-08-21), `typescript@7.0.2` is a published **stable**
  release and `vue-tsc@3.3.11` declares `peerDependencies: { typescript: '>=5.0.0' }`, accepting
  it. This is the exact convergence §3 anticipated ("converge on one toolchain once `vue-tsc` runs
  on TS7"), so it is done now rather than deferred: `@typescript/native-preview`/`tsgo` are **not**
  installed. Both `typecheck:node` and `typecheck:web` run against the same `typescript@7.0.2` —
  `tsc --noEmit` and `vue-tsc --noEmit` respectively. The two-tsconfig split (D8) is otherwise
  unchanged (still two configs, still no `-b` build-mode).
- **Dependency versions bumped to actual current releases**, not the plan's placeholder ranges
  (which were written without a live registry check): `electron@43.4.1`, `electron-vite@5.0.0`,
  `vite@7.3.6` (pinned below `electron-vite@5`'s supported peer ceiling — `vite@8.x` is out, is
  newer than what `electron-vite@5.0.0` supports), `vue@3.5.41`, `vue-tsc@3.3.11`,
  `@vitejs/plugin-vue@6.0.8`, `tailwindcss`/`@tailwindcss/vite@4.3.3`, `@playwright/test@1.62.1`,
  `@biomejs/biome@2.5.9`, `@vscode/codicons@0.0.46-24`, `@types/node@26.2.0`.
- **`esbuild` added to `trustedDependencies`** alongside `electron` — Bun blocks its postinstall
  otherwise (`bun pm untrusted` flagged it). Electron's own postinstall also did not run until its
  binary was fetched manually once (`node node_modules/electron/install.js`) because it wasn't yet
  trusted at the time of the first `bun install`; a clean install with `trustedDependencies` already
  set should not need that manual step.
- **`biome.json` migrated to the 2.5.9 schema** via `biome migrate --write` (schema version bump,
  `linter.rules.recommended` → `linter.rules.preset`, folder ignores in `files.includes` written
  without a trailing `/**`, which is deprecated since Biome 2.2.0).

## 0. Ground rules for this phase

- Build **only** what P0 lists. Anything that needs a database driver, a tree, or a data view is P1+. See §9 (Out of scope) at the end — read it before starting, and re-read it if you feel tempted to "just add".
- Everything placed on disk in P0 is load-bearing for P1–P11. Prefer the boring, conventional shape over the clever one.
- Run `bun run lint`, `bun run typecheck` and `bun run test:ui` at the end of each step listed below. A step is done when its acceptance check passes.
- `/compact` after each numbered step.

### Prerequisites to verify before Step 1

```
bun --version        # if missing: curl -fsSL https://bun.sh/install | bash
node --version       # tooling fallback only; Electron uses its own embedded Node
sw_vers -productVersion   # must be macOS 13+
uname -m             # must be arm64
```

Colima is **not** needed in P0 (no Testcontainers until P1). Do not install or configure it here; §3's Colima note applies from P1 onward.

---

## 1. Decisions made in this plan

The spec leaves these open. They are decided here — implement as written, do not re-litigate.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Module format: CJS for main/preload/engine, ESM for renderer.** `package.json` has **no** `"type": "module"`. | ESM preload requires `sandbox: false`, and `utilityProcess.fork` on ESM entry points is fragile. CJS for the Node-side bundles removes both risks. Renderer is bundled by Vite and is ESM regardless. |
| D2 | **SQLite driver: `node:sqlite`**, accessed only through `src/main/storage/db.ts`. | §3 allows it. Electron's embedded Node ≥ 22.13 exposes it unflagged; zero native rebuild step, which is worth a lot to a Bun-based toolchain. If it is unavailable at runtime the app fails loudly at startup (see Step 4) and the fallback is `better-sqlite3` + `electron-rebuild`, a one-file change inside `db.ts`. |
| D3 | **Migrations are `.sql` files imported with Vite's `?raw`**, listed in an explicit ordered array. | §6 requires "forward-only numbered SQL files". `?raw` keeps them as real `.sql` files (diffable, no escaping) while inlining them at build time, so nothing has to be read out of `app.asar` at runtime. |
| D4 | **No Pinia.** Renderer state lives in plain `reactive()` modules under `src/renderer/workbench/state/`. | §2.1 demands surgical control over reactivity; a store library buys nothing at this size and later has to be worked around for the grid. |
| D5 | **A fourth source dir, `src/preload/`**, not listed in §11. | electron-vite convention; the preload is ~30 lines and does not belong in `main/`. §11's layout is otherwise followed exactly. |
| D6 | **Only directories P0 actually fills are created.** No `.gitkeep` placeholders for `engine/adapters/*` or `renderer/views/*`. | Those are created by the phase that fills them; empty dirs are noise and git does not track them anyway. |
| D7 | **Biome config: `biome.json`, Biome 2.x schema**, `recommended` linter rules on, formatter at 2-space / 100 cols / single quotes / semicolons always, import sorting via `assist.actions.source.organizeImports`. | §3 says "default rules"; that is the linter. Formatting still needs *some* shape chosen — this is it. |
| D8 | **Two tsconfigs, no build-mode.** `tsconfig.node.json` (main + preload + engine + shared, checked with TS7 `tsgo`) and `tsconfig.web.json` (renderer + shared, checked with `vue-tsc`). Root `tsconfig.json` is `files: []` + `references` for editor tooling only. | §3's split toolchain. `tsgo` is run per-config, never with `-b`, since project-reference build mode is not reliable there yet. |
| D9 | **TS7 install:** `bun add -d @typescript/native-preview` (binary `tsgo`) **and** `typescript@^5` (required by `vue-tsc` and by Volar). If a stable `typescript@7` is published and `tsgo`'s job is subsumed, that is a later cleanup. | §3 explicitly anticipates two TS toolchains coexisting until `vue-tsc` runs on TS7. |
| D10 | **Storage root is overridable via `KIRA_HOME`.** Defaults to `~/.kira-studio`. When set, Electron's `userData` is also relocated under it. | Without this, Playwright runs would read and write the developer's real `kira.sqlite`. Non-negotiable for §9.2. |
| D11 | **Default appearance:** font family `"SF Mono", Menlo, monospace`, size `12`, row density `comfortable`. | §8.2 mandates *one* family for UI, grid **and editors**. A proportional family makes CodeMirror and the grid unusable, so the single family is monospace. |
| D12 | **Engine memory cap default 512 MB** via `execArgv: ['--max-old-space-size=512']` on `utilityProcess.fork`. Surfaced read-only in Settings → Advanced in P0. | §2.2 "bounded old-space". The settings-driven value (requiring an engine restart) lands with the rest of Advanced later. |
| D13 | **No electron-builder in P0.** | §10 puts unsigned packaging in P11. Adding it now means maintaining a config nothing exercises. |

---

## 2. Target tree at the end of P0

```
biome.json
bunfig.toml
electron.vite.config.ts
playwright.config.ts
package.json
tsconfig.json
tsconfig.node.json
tsconfig.web.json
src/
  main/
    index.ts                    app lifecycle, wiring
    window.ts                   BrowserWindow creation + bounds persistence
    engine-host.ts              utilityProcess fork/kill/respawn + port handoff
    ipc.ts                      ipcMain.handle registrations
    menu.ts                     minimal macOS application menu
    log.ts                      append-only file logger -> <KIRA_HOME>/logs
    storage/
      paths.ts                  KIRA_HOME resolution, 0700 dir, 0600 db file
      db.ts                     node:sqlite open + pragmas (the swap point, D2)
      migrate.ts                forward-only runner
      settings.ts               settings table accessors
      layout.ts                 ui_layout table accessors
      migrations/
        index.ts                ordered list of ?raw imports
        0001_init.sql           full §6 schema
  preload/
    index.ts                    contextBridge API + MessagePort relay
  engine/
    index.ts                    parentPort bootstrap, port attach
    rpc.ts                      request envelope dispatch
  renderer/
    index.html
    main.ts
    App.vue
    env.d.ts
    bridge/
      control.ts                typed wrapper over window.kira
      port.ts                   MessagePort acquisition + request/response
    theme/
      tokens.css                Dark Modern derived custom properties
      base.css                  resets, Tailwind import, @theme mapping
      Codicon.vue
    workbench/
      WorkbenchShell.vue
      ProjectPanel.vue
      TabStrip.vue
      Toolbar.vue
      MainView.vue
      CellEditorPanel.vue
      OperationsPanel.vue
      StatusBar.vue
      Splitter.vue
      SettingsDialog.vue
      sections/
        AppearanceSection.vue
        DataSection.vue
        CacheSection.vue
        AdvancedSection.vue
      state/
        layout.ts
        settings.ts
        engine.ts
  shared/
    ipc.ts                      control channel names + request/response types
    port.ts                     bulk-channel envelope types
    settings.ts                 settings keys, types, defaults
    layout.ts                   ui_layout keys, types, defaults
tests/
  ui/
    fixtures.ts                 launch/teardown helper with isolated KIRA_HOME
    smoke.spec.ts
    workbench.spec.ts
docs/plans/P0-foundations.md    (this file)
```

---

## Step 1 — Repo scaffolding

**Files:** `package.json`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore` (amend)

1. `bun init -y`, then rewrite `package.json` by hand:
   - `"name": "kira-studio"`, `"version": "0.1.0"`, `"private": true`, `"main": "out/main/index.js"`.
   - **No `"type": "module"`** (D1).
   - **`"trustedDependencies": ["electron"]`** — Bun blocks postinstall scripts by default, and without this Electron's binary is never downloaded and `_electron.launch()` fails with a confusing error. This is the single most likely thing to burn an hour; do it now.
   - Scripts:
     ```
     dev            electron-vite dev
     build          electron-vite build
     start          electron-vite preview
     lint           biome check .
     format         biome check --write .
     typecheck      bun run typecheck:node && bun run typecheck:web
     typecheck:node tsgo --noEmit -p tsconfig.node.json
     typecheck:web  vue-tsc --noEmit -p tsconfig.web.json
     test:ui        electron-vite build && playwright test
     ```
     `bun run <script>` honours the shebang of `node_modules/.bin` binaries, so `electron-vite` and `vue-tsc` execute under Node, not Bun's runtime. Do not "optimise" this with `bun x --bun`.
2. Dependencies:
   - runtime: *(none yet — `node:sqlite` is a builtin)*
   - dev: `electron`, `electron-vite`, `vite`, `vue`, `@vitejs/plugin-vue`, `tailwindcss@^4`, `@tailwindcss/vite`, `@vscode/codicons`, `@biomejs/biome`, `typescript@^5`, `@typescript/native-preview`, `vue-tsc`, `@playwright/test`, `@types/node`
   - Vue is a dev dependency because it is bundled into the renderer; nothing is resolved from `node_modules` at runtime.
3. `bunfig.toml`:
   ```toml
   [install]
   exact = true
   ```
4. `biome.json` per D7. Set `files.includes` to exclude `out`, `dist`, `test-results`, `playwright-report`, `node_modules`. Enable `vcs` with `clientKind: "git"` and `useIgnoreFile: true`.
5. tsconfigs per D8. Both: `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `noEmit: true`, `verbatimModuleSyntax: true`, `skipLibCheck: true`, and `paths` for `@shared/*` → `src/shared/*`, `@renderer/*` → `src/renderer/*`.
   - `tsconfig.node.json`: `include` main/preload/engine/shared + `electron.vite.config.ts`, `playwright.config.ts`, `tests/**`; `types: ["node", "electron"]`.
   - `tsconfig.web.json`: `include` renderer + shared; `lib: ["ESNext", "DOM", "DOM.Iterable"]`; `jsx` unset; `types: ["vite/client"]`.
   - Add `src/renderer/env.d.ts` declaring `*.vue` modules and the `window.kira` global (filled in at Step 3).
   - Add a `declare module '*.sql?raw' { const s: string; export default s }` ambient declaration in `src/main/storage/migrations/index.ts`'s neighbourhood (put it in `src/shared/vite-raw.d.ts` and include it from `tsconfig.node.json`).
6. Amend `.gitignore` — `out` and `dist` are already covered; append `test-results/` and `playwright-report/`. **Commit `bun.lock`.**

**Acceptance:** `bun install` succeeds and `node_modules/electron/dist/Electron.app` exists; `bun run lint` passes on an empty tree.

---

## Step 2 — electron-vite config and the three build targets

**Files:** `electron.vite.config.ts`, `src/renderer/index.html`

Single config with three sections. Key points:

- **`main`**: two rollup inputs so the engine is emitted alongside the main bundle —
  `input: { index: 'src/main/index.ts', engine: 'src/engine/index.ts' }`, `output.format: 'cjs'`, `entryFileNames: '[name].js'`. Result: `out/main/index.js` and `out/main/engine.js`. Add `externalizeDepsPlugin()`.
  *Why one build for two processes:* they share `src/shared`, have identical externals and identical output format; a second electron-vite section for the engine is not supported and a separate Vite invocation is pure overhead.
- **`preload`**: `input: 'src/preload/index.ts'`, `output.format: 'cjs'`, `externalizeDepsPlugin()`.
- **`renderer`**: `root: 'src/renderer'`, plugins `[vue(), tailwindcss()]`, `build.rollupOptions.input: resolve(__dirname, 'src/renderer/index.html')`, and `resolve.alias` for `@shared` / `@renderer`.
- `src/renderer/index.html`: `<html class="dark">`, a CSP meta tag (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:`), `<div id="app">`, `<script type="module" src="./main.ts">`.

**Acceptance:** with placeholder entry files (`console.log` in each), `bun run build` emits `out/main/index.js`, `out/main/engine.js`, `out/preload/index.js`, `out/renderer/index.html`.

---

## Step 3 — Three-process skeleton and MessagePort wiring

This is the structural heart of P0. Get the message flow right; the payloads are trivial.

### 3a. Shared protocol types

`src/shared/ipc.ts` — the **control** plane (renderer → main, via `ipcRenderer.invoke`):

```
'kira:app:info'        () -> { appVersion, electron, chrome, node, kiraHome }
'kira:settings:getAll' () -> Settings
'kira:settings:set'    (patch: Partial<Settings>) -> Settings
'kira:layout:getAll'   () -> Layout
'kira:layout:set'      (patch: Partial<Layout>) -> Layout
'kira:engine:status'   () -> { alive: boolean; pid: number | null }
```
Plus main → renderer pushes: `'kira:port'` (the MessagePort handoff) and `'kira:engine:state'`.

`src/shared/port.ts` — the **bulk** plane (renderer ↔ engine, via MessagePort). Define a request/response envelope now so P1 does not invent a second one:

```ts
type PortRequest  = { kind: 'req'; id: number; op: string; payload: unknown }
type PortResponse = { kind: 'res'; id: number; ok: true; payload: unknown }
                  | { kind: 'res'; id: number; ok: false; error: { message: string; code?: string } }
type PortEvent    = { kind: 'evt'; topic: string; payload: unknown }
```
P0 implements exactly one op: `'ping'` → `{ pong: true; enginePid: number; at: number }`.

### 3b. Main process

`src/main/engine-host.ts`:
- `startEngine()` → `utilityProcess.fork(join(__dirname, 'engine.js'), [], { serviceName: 'kira-engine', stdio: 'pipe', execArgv: ['--max-old-space-size=512'] })` (D12).
- Pipe the child's `stdout`/`stderr` into `log.ts`, prefixed `[engine]`.
- Track `alive`/`pid`; on `'exit'`, log and mark dead. **No auto-respawn in P0** — a respawn policy without connections to restore is guesswork; P1 owns it. Expose `attachRendererPort(port: MessagePortMain, generation: number)`.

`src/main/window.ts`:
- `BrowserWindow` with `titleBarStyle: 'default'` (native title bar, §8.1), `backgroundColor: '#1F1F1F'`, `show: false` + `ready-to-show` → `show()` (no white flash), `minWidth: 900`, `minHeight: 600`, `webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }`.
- Restore/persist bounds via `ui_layout` key `window.bounds` (debounced 300 ms on `resize`/`move`).

`src/main/index.ts` — ordering matters:
1. `app.setName('Kira Studio')`; if `KIRA_HOME` is set, `app.setPath('userData', join(KIRA_HOME, 'electron'))` — **before** `app.whenReady()`.
2. `await app.whenReady()`.
3. `openStorage()` (Step 4) — migrations run before any window exists, so the window can read persisted layout synchronously.
4. `startEngine()`.
5. `registerIpc()` (Step 3d), `buildMenu()`.
6. `createWindow()`.
7. On `webContents.on('did-finish-load')`: create a **fresh** `new MessageChannelMain()`, `engineHost.attachRendererPort(port1, ++generation)`, then `win.webContents.postMessage('kira:port', { generation }, [port2])`.
   *Why on every load, not once:* a renderer reload (HMR full reload, `Cmd+R`) destroys the old port. Re-issuing a channel per load and having the engine drop any port whose generation is stale is the only wiring that survives dev-mode reloads. This will bite you in dev if you skip it.
8. macOS lifecycle: `window-all-closed` does **not** quit; `activate` recreates the window; `before-quit` kills the engine and closes the DB.

### 3c. Preload

`src/preload/index.ts` (CJS, sandboxed):
- `contextBridge.exposeInMainWorld('kira', { ... })` with one thin method per control channel, each an `ipcRenderer.invoke` — never expose `ipcRenderer` itself.
- MessagePort relay — a `MessagePort` **cannot** cross `contextBridge`, so use the documented `window.postMessage` hop:
  ```js
  ipcRenderer.on('kira:port', (event, meta) => {
    window.postMessage({ __kira: 'port', meta }, '*', event.ports)
  })
  ```
- Mirror the exposed surface in `src/renderer/env.d.ts` as `declare global { interface Window { kira: KiraApi } }`, with `KiraApi` defined in `src/shared/ipc.ts` so both sides share one definition.

### 3d. IPC handlers

`src/main/ipc.ts` — `ipcMain.handle` for each control channel from 3a, delegating to `storage/settings.ts`, `storage/layout.ts`, `engine-host.ts`. Validate patch payloads against the known key set and drop unknown keys; the renderer is trusted here but the tables should never accumulate garbage.

### 3e. Engine

`src/engine/index.ts`:
```
process.parentPort.on('message', (e) => {
  // control frames from main; the renderer port arrives as e.ports[0]
})
```
- On an `attach-port` frame: close any previously held port, keep `e.ports[0]`, `port.start()`, register `port.on('message', ...)`.
- `src/engine/rpc.ts`: dispatch table `Record<string, (payload) => Promise<unknown>>`, wraps handler results into `PortResponse`, catches and serialises errors. Register `'ping'`.
- Import nothing from `electron` except `import type`. The engine is a plain Node process.

### 3f. Renderer bridge

- `src/renderer/bridge/port.ts`: listen for `window.addEventListener('message', ...)` with `data.__kira === 'port'`; store the port; expose `request(op, payload)` returning a promise keyed by an incrementing id, with a 30 s timeout that rejects. Also expose a `ready` promise so callers can await the handoff.
- `src/renderer/bridge/control.ts`: typed thin wrappers over `window.kira`.
- `src/renderer/workbench/state/engine.ts`: `reactive({ status: 'connecting' | 'ok' | 'down', pid, lastPingMs })`; on app mount, await the port then `ping()` and record round-trip time.

**Acceptance:** `bun run dev` opens a window; the status bar (Step 6) shows `engine ok · <n> ms`; `Cmd+R` in the window re-establishes the port and the status returns to `ok`.

---

## Step 4 — SQLite storage and migrations

**Files:** `src/main/storage/{paths,db,migrate,settings,layout}.ts`, `src/main/storage/migrations/{index.ts,0001_init.sql}`, `src/main/log.ts`

### 4a. `paths.ts`

```
kiraHome()  = process.env.KIRA_HOME ?? join(homedir(), '.kira-studio')
dbPath()    = join(kiraHome(), 'kira.sqlite')
logsDir()   = join(kiraHome(), 'logs')
```
`ensureLayout()`:
- `mkdirSync(kiraHome(), { recursive: true, mode: 0o700 })` **then** `chmodSync(kiraHome(), 0o700)`.
- Same for `logs/`.
- **The explicit `chmod` is required**: the `mode` argument to `mkdir` is masked by the process umask (typically `022`), so `0700` silently becomes `0700 & ~umask`. §6 says `0700`; assert it.
- After the DB file exists, `chmodSync(dbPath(), 0o600)` — again, unconditionally, not only on create, so an existing loose-permission file is tightened.

### 4b. `db.ts` (the swap point, D2)

- `import { DatabaseSync } from 'node:sqlite'` inside a `try/catch`; on failure throw a clear error naming `better-sqlite3` as the fallback so the failure mode is a legible message, not a stack trace about a missing builtin.
- Open, then run pragmas in this order: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- Export a narrow surface only — `exec(sql)`, `get(sql, params)`, `all(sql, params)`, `run(sql, params)`, `transaction(fn)`, `close()`. **Nothing outside this file may import `node:sqlite`.** That is what makes D2 reversible.

### 4c. `migrations/0001_init.sql`

Transcribe §6's schema exactly. Notes that will otherwise cost you a debugging round:

- `tabs` has a column named `order` — **`order` is a reserved word in SQLite**; quote it as `"order"` in the DDL and in every query. (Consider it a standing rule for this codebase.)
- `schema_version` is single-row: `CREATE TABLE schema_version (version INTEGER NOT NULL)`; seed with `INSERT INTO schema_version (version) VALUES (0)` inside the runner, not the migration.
- `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` and `ui_layout(key TEXT PRIMARY KEY, value TEXT NOT NULL)` — values are JSON-encoded scalars so types survive round-trips.
- `connections.password` is created here but is **only** ever read/written through the `SecretStore` indirection named in §6. P0 creates the column and nothing else touches it.
- Add the indexes the later phases will need anyway and that cost nothing now: `metadata_cache(connection_id, path)` unique, `op_log(started_at)`, `saved_queries(connection_id, path)`, `tabs("order")`, `connection_filters(connection_id)`.

### 4d. `migrations/index.ts`

```ts
import m0001 from './0001_init.sql?raw'
export const migrations = [{ version: 1, name: '0001_init', sql: m0001 }] as const
```
Explicit array, not a glob — the order must be visible in a diff.

### 4e. `migrate.ts`

- Create `schema_version` if absent, read `version` (0 if the table was just created).
- For each migration with `version > current`, in **one transaction per migration**: `exec(sql)` then `UPDATE schema_version SET version = ?`.
- Forward-only: if `current > max(migrations)`, throw — the user has downgraded the app onto a newer database, and silently continuing corrupts it.
- Log each applied migration through `log.ts`.

### 4f. `settings.ts` / `layout.ts`

- `getAll()` reads all rows and merges over the defaults from `src/shared/settings.ts` / `src/shared/layout.ts`, so a missing key is never `undefined` in the renderer.
- `set(patch)` upserts only known keys inside one transaction and returns the merged result.
- Defaults (D11): `appearance.fontFamily = '"SF Mono", Menlo, monospace'`, `appearance.fontSize = 12`, `appearance.rowDensity = 'comfortable'`.
- Layout defaults: `panel.project.visible = true`, `panel.project.width = 260`, `panel.operations.visible = false`, `panel.operations.height = 200`, `panel.cellEditor.visible = true`, `panel.cellEditor.height = 180`, `window.bounds = null`.

### 4g. `log.ts`

Append-only writer to `<kiraHome>/logs/kira-YYYY-MM-DD.log`, one line per entry `<iso> <level> <scope> <message>`, mirrored to stdout in dev. No rotation logic yet (op-log retention is P5-era); keep it under 40 lines.

**Acceptance:** delete `~/.kira-studio`, run `bun run dev`; the directory is recreated with `drwx------`, `kira.sqlite` with `-rw-------`, `sqlite3 ~/.kira-studio/kira.sqlite '.tables'` lists all ten tables from §6, and `SELECT version FROM schema_version` returns `1`. Relaunching does not re-apply the migration.

---

## Step 5 — Theme tokens and codicons

**Files:** `src/renderer/theme/tokens.css`, `src/renderer/theme/base.css`, `src/renderer/theme/Codicon.vue`

### 5a. `tokens.css`

One `:root` block of custom properties derived from VS Code **Dark Modern** (§8.1), grouped by role. Use these values:

```
--kira-bg              #1F1F1F   editor.background
--kira-bg-elevated     #202020   editorWidget.background
--kira-bg-chrome       #181818   sideBar / statusBar / titleBar / panel
--kira-bg-input        #313131   input + dropdown
--kira-fg              #CCCCCC
--kira-fg-muted        #9D9D9D
--kira-fg-disabled     #6E6E6E
--kira-border          #2B2B2B   contrastBorder / panel.border
--kira-border-strong   #313131   widget.border
--kira-focus           #0078D4
--kira-accent          #0078D4   button.background
--kira-accent-fg       #FFFFFF
--kira-select          #04395E   list.activeSelectionBackground
--kira-hover           #2A2D2E   list.hoverBackground
--kira-badge           #616161
--kira-scrollbar       #79797966
--kira-error           #F14C4C
--kira-warn            #CCA700
--kira-ok              #23D18B
--kira-info            #3794FF
```
Plus the **layout** tokens that give §8.1's reworked "detached" chrome — rounded, floating panels with thin borders rather than flat edges:
```
--kira-radius          6px
--kira-gap             4px      gap between floating panel surfaces
--kira-border-width    1px
--kira-statusbar-h     22px
--kira-shadow          0 2px 8px rgb(0 0 0 / 0.32)
```
And the appearance-driven tokens, written at runtime from `settings` (Step 6):
```
--kira-font-family, --kira-font-size, --kira-row-height
```
`--kira-row-height` derives from density: `compact` → 22px, `comfortable` → 28px.

Also add the twelve §8.12 connection swatches as `--kira-conn-red` … `--kira-conn-grey`. They cost nothing now and P1 wants them.

### 5b. `base.css`

- `@import "tailwindcss";`
- `@import "@vscode/codicons/dist/codicon.css";` — Vite resolves and emits `codicon.ttf` from `node_modules`. Verify the font actually loads in the built app (not just dev); if the emitted URL is wrong under `file://`, set `base: './'` in the renderer build.
- `@theme { --color-bg: var(--kira-bg); ... }` mapping the tokens into Tailwind v4's CSS-first config so utilities like `bg-chrome` / `text-muted` exist.
- Global resets: `html, body, #app { height: 100%; margin: 0; overflow: hidden; }`, `body { font-family: var(--kira-font-family); font-size: var(--kira-font-size); color: var(--kira-fg); background: var(--kira-bg-chrome); }`, `user-select: none` globally with `user-select: text` re-enabled on inputs and editors, `-webkit-font-smoothing: antialiased`, and a scrollbar style using `--kira-scrollbar`.

### 5c. `Codicon.vue`

`<i class="codicon codicon-{{name}}" :style="{ fontSize }" aria-hidden="true" />` with props `name: string`, `size?: number`. Every icon in the app goes through this component — no raw `codicon-*` classes elsewhere, so a future icon-set swap is one file.

**Acceptance:** a temporary `<Codicon name="database" />` in `App.vue` renders the glyph in both `bun run dev` and `bun run start` (built).

---

## Step 6 — Workbench shell

**Files:** everything under `src/renderer/workbench/`, plus `App.vue` and `main.ts`

This is an **empty shell**. Every region is a bordered, labelled placeholder. No trees, no grids, no tabs with content.

### 6a. Layout

`WorkbenchShell.vue` implements §8.1's diagram with CSS grid:

```
grid-template-areas:
  "project main"
  "project cell"
  "ops     ops"
  "status  status"
grid-template-columns: var(--project-w) 1fr
grid-template-rows: 1fr var(--cell-h) var(--ops-h) var(--kira-statusbar-h)
```
The right column stacks `TabStrip` → `Toolbar` → `MainView` inside the `main` area (they are one flex column, not separate grid rows, so the toolbar never desyncs from the view). Panel surfaces get `border-radius: var(--kira-radius)`, `border: 1px solid var(--kira-border)`, `background: var(--kira-bg)`, separated by `var(--kira-gap)` — the detached look §8.1 asks for.

Hidden panels collapse their track to `0` and are `v-if`'d out of the DOM.

Add `data-testid` on every region: `project-panel`, `tab-strip`, `toolbar`, `main-view`, `cell-editor`, `operations-panel`, `status-bar`. Playwright depends on these; do not rename them casually later.

### 6b. Placeholder panels

Each of `ProjectPanel`, `TabStrip`, `Toolbar`, `MainView`, `CellEditorPanel`, `OperationsPanel` is a centred, muted empty state with a codicon and one line of text, e.g. MainView → *"No tab open"*, ProjectPanel → header row with a disabled `+` button and *"No connections"*. Do **not** stub future controls (no pager, no filter toolbar, no tree rows).

### 6c. `Splitter.vue`

A 4-px hit-area drag handle (`col` / `row` orientation), pointer-events based, clamping to min/max, emitting the new size. Used between project↔main, main↔cell editor, and above the operations panel. Writes go through `state/layout.ts` debounced at 150 ms so a drag is one DB write, not sixty.

### 6d. `StatusBar.vue`

Left, per §8.1: two toggle buttons — `⬓ Project` (`codicon-layout-sidebar-left`) and `⬓ Operations` (`codicon-layout-panel`), each showing active/inactive state against `--kira-select`. Right: engine status dot (`--kira-ok` / `--kira-error`) with the ping ms as a tooltip, and the settings gear (`codicon-settings-gear`) that opens the settings dialog. Height is exactly `--kira-statusbar-h`.

The cell-editor panel toggle is not in §8.1's status bar; leave it toggled by its own header chevron.

### 6e. State modules (D4)

- `state/layout.ts` — `reactive(Layout)`, hydrated from `kira.layout.getAll()` **before mount** (await it in `main.ts` so there is no flash of default layout), each mutation persisted debounced.
- `state/settings.ts` — same shape; additionally an `applyAppearance()` that writes `--kira-font-family`, `--kira-font-size`, `--kira-row-height` onto `document.documentElement.style`. Call it on hydrate and on every change.
- `state/engine.ts` — as described in Step 3f.

### 6f. Settings dialog (§8.2)

`SettingsDialog.vue`: modal over a scrim, `Escape` closes, focus trapped, left-hand section list (Appearance / Data / Cache / Advanced), right-hand pane.

- **Appearance** — *the only functional section in P0*. Font family (text input with a datalist of the common macOS monospace families), font size (number, 9–24), row density (segmented control: Compact / Comfortable). Each change writes through `kira.settings.set` and applies immediately — no OK/Apply button, VS-Code style.
- **Data**, **Cache**, **Advanced** — render the controls §8.2 lists (page size, prefetch, count-on-open; L2 budget, hit rate, Clear caches; engine memory cap, op-log retention) as **disabled** inputs showing their default values, with a single muted line per section: *"Available once data views land."* Engine memory cap shows 512 MB read-only (D12).
  *Why render them disabled rather than omit them:* the section list and the dialog's sizing are load-bearing UI that later phases only need to enable, and a visibly-empty section is a better prompt than a missing one.

**Acceptance:** panels toggle from the status bar and their state survives an app restart; dragging a splitter and restarting restores the size; changing font size in Appearance instantly restyles the whole window and survives restart.

---

## Step 7 — Playwright harness

**Files:** `playwright.config.ts`, `tests/ui/fixtures.ts`, `tests/ui/smoke.spec.ts`, `tests/ui/workbench.spec.ts`

### 7a. `playwright.config.ts`

`testDir: './tests/ui'`, `fullyParallel: false`, `workers: 1`, `retries: 0`, `timeout: 60_000`, `reporter: [['list'], ['html', { open: 'never' }]]`, `outputDir: 'test-results'`. No `webServer`; the `test:ui` script builds first.

### 7b. `fixtures.ts`

A `test.extend` fixture providing `{ app: ElectronApplication; window: Page }`:

```ts
const kiraHome = await mkdtemp(join(tmpdir(), 'kira-ui-'))
const app = await _electron.launch({
  args: [resolve(__dirname, '../../out/main/index.js')],
  env: { ...process.env, KIRA_HOME: kiraHome, NODE_ENV: 'test' },
})
const window = await app.firstWindow()
await window.waitForSelector('[data-testid="status-bar"]')
```
Teardown closes the app and `rm -rf`s the temp home. **`KIRA_HOME` isolation (D10) is mandatory** — without it every test run mutates the developer's real settings and layout.

Also expose a `relaunch()` helper that closes and re-launches against the **same** `kiraHome`; the persistence assertions need it.

### 7c. `smoke.spec.ts` (the P0 deliverable)

1. Launch, assert exactly one window, assert `await app.evaluate(({ app }) => app.getName())` is `Kira Studio`.
2. Assert all seven `data-testid` regions from Step 6a are present (operations panel absent by default — assert it is *not* present, then toggled on).
3. Assert the engine status element reads `ok` (proves the whole main→engine→port→renderer chain).
4. `await window.screenshot({ path: 'test-results/screenshots/workbench.png' })`.
5. Assert no `console` errors were emitted during launch (attach a `page.on('console')` collector in the fixture).

### 7d. `workbench.spec.ts`

- Toggle project and operations panels from the status bar; assert DOM presence/absence; `relaunch()`; assert the toggled state persisted.
- Open the settings dialog from the status-bar gear; assert the four section names; switch to Appearance; set font size to 16; assert `getComputedStyle(document.documentElement).getPropertyValue('--kira-font-size')`; `relaunch()`; assert it is still 16.
- Screenshot the settings dialog to `test-results/screenshots/settings.png`.

**Acceptance:** `bun run test:ui` builds and passes green from a clean `out/`, and both PNGs exist.

---

## Step 8 — macOS menu and final polish

**Files:** `src/main/menu.ts`

Minimal but correct application menu — without it, `Cmd+Q`, `Cmd+W`, `Cmd+C/V` and the About item do not work, which makes every subsequent phase's manual testing miserable:

- **Kira Studio**: About, Settings… (`Cmd+,` → sends `kira:open-settings` to the renderer), Services, Hide/Hide Others/Show All, Quit.
- **Edit**: Undo/Redo/Cut/Copy/Paste/Select All (standard roles).
- **View**: Toggle Project Panel (`Cmd+B`), Toggle Operations Panel (`Cmd+J`), Reload / Toggle DevTools **in dev only**.
- **Window**: Minimize, Zoom, Close.

The View toggles send an IPC push that `state/layout.ts` handles — the same code path as the status-bar buttons, not a duplicate.

Keyboard shortcuts beyond these three are §8.15 and belong to P6. Do not build a keybinding table now.

**Acceptance:** `Cmd+B` / `Cmd+J` toggle the panels; `Cmd+,` opens settings; `Cmd+Q` quits cleanly with the engine terminated (check with `ps` that no `kira-engine` process survives).

---

## 9. Explicitly out of scope for P0

Do not build, stub, or "prepare" any of these. If a P0 file needs one of them to compile, the design is wrong — say so rather than scaffolding forward.

- **No adapters.** No `Adapter` interface, no `Caps` type, no `src/engine/adapters/` directory, no driver dependencies (`pg`, `mariadb`, `mongodb`, `ioredis`, kafka, sqs). §5 is P1.
- **No connections.** No connection dialog, no CRUD, no colors applied to chrome, no `SecretStore` implementation — the `connections` table exists in the schema and stays empty.
- **No project tree.** ProjectPanel is an empty state. No lazy loading, no search box, no filters, no context menus.
- **No data views.** No grid, no document/keyvalue/stream views, no DDL view, no CodeMirror at all (P2/P3 bring it), no tabs with content, no `src/renderer/views/`.
- **No caching layer.** No L1/L2/L3, no `metadata_cache` reads/writes, no byte budgets, no prefetch.
- **No operations log.** OperationsPanel is an empty state; nothing writes `op_log`.
- **No context-menu service.** §8.10 is P1's `ContextMenu` service.
- **No Testcontainers, no Colima setup, no `tests/db/`.** P1.
- **No electron-builder / packaging / signing.** P11 (D13).
- **No session restore.** The `tabs` table exists and stays empty; §8.4 is P2.
- **No unit tests** (§9 — the project has two suites only, and only the Playwright one exists in P0).

---

## 10. Risk register

| Risk | Signal | Response |
|---|---|---|
| `node:sqlite` missing or flagged in the shipped Electron | Startup throws from `db.ts` | Swap `db.ts` to `better-sqlite3` + `@electron/rebuild` and add it to `trustedDependencies`. Nothing outside `db.ts` changes (D2). |
| Bun skips Electron's postinstall | `_electron.launch()` cannot find the binary | `trustedDependencies: ["electron"]` in `package.json`, then `bun install --force`. |
| `tsgo` rejects a config option | `bun run typecheck:node` errors on a flag, not on code | Drop the offending option from `tsconfig.node.json`; keep `strict` and `noEmit`. Record the drop in a comment. |
| MessagePort lost on renderer reload | Status bar stuck on `connecting` after `Cmd+R` | This is the per-load channel re-issue in Step 3b.7 — verify the generation counter is incremented and the engine drops the stale port. |
| Codicon font 404s in the built app but not in dev | Empty boxes in `bun run start` | Set `base: './'` on the renderer build. |
| Directory permissions wider than `0700` | `ls -la ~/.kira-studio` shows group/other bits | The explicit `chmodSync` after `mkdirSync` (Step 4a) — umask masks the `mode` argument. |
| Playwright run clobbers the real `~/.kira-studio` | Developer's settings reset after a test run | `KIRA_HOME` fixture isolation (D10); assert in the fixture that `KIRA_HOME` is set and under `tmpdir()` before launching. |

---

## 11. Definition of done for P0

1. `bun install && bun run lint && bun run typecheck && bun run build && bun run test:ui` is green from a clean clone.
2. `bun run dev` opens a window with the §8.1 chrome, engine status `ok`.
3. `~/.kira-studio/` is `0700`, `kira.sqlite` is `0600`, `schema_version = 1`, all §6 tables present.
4. Panel visibility, panel sizes, window bounds and appearance settings survive a restart.
5. `test-results/screenshots/workbench.png` shows the dark workbench shell.
6. Nothing from §9 exists in the tree.
