# P51 — Tauri + Node sidecar migration spike

> This document is the plan only. **No Tauri install, no Rust toolchain install, no `src-tauri`
> scaffold, no code change, no dependency addition, no measurement has been performed.** Producing
> this document is the entirety of this session's work on P51 — the actual spike (standing up a
> Tauri shell, designing the renderer↔sidecar transport, resolving the sidecar packaging story,
> triaging `src/main`/`src/engine` module by module) does not start until the user reviews this plan
> and explicitly signs off. **Do not begin implementation from this document alone.**

## 0. What this phase is, and what it replaces

P51 previously held *"Electrobun migration spike, reopened."* That plan
(`docs/v1/plans/P51-electrobun-migration.md`) is **deleted** and this document takes the slot. The
motivating question is unchanged — `docs/PERF.md` §2.2's structural finding — but the candidate
runtime is different, and so is the architecture being proposed.

**`docs/v1/plans/P20-electrobun-spike.md` is untouched and stays closed.** Its verdict ("out of
scope — will not be done") is the record of the *Electrobun* investigation and is not reopened,
revised, or superseded here. Only P51's slot is repurposed.

### 0.1 Why a runtime change is still worth asking about

`docs/PERF.md` §2.2 is the whole motivation and it has not changed: baseline overhead with **zero
connections and zero tabs** is ≈620–626 MB (Browser 254.8 + GPU 149.6 + NetworkService 81.3 + Tab
134.8), against SPEC §2's 350 MB budget. The app's own loaded delta is only ≈25–97 MB. That section
records the conclusion plainly — this is "Chromium/Electron process overhead … not something P12's
levers act on" — and `tests/e2e/memory.spec.ts` was **removed** rather than kept permanently red
(commit `d23121e`; SPEC §10's P20 row records the same). The budget is failed by the
runtime, not by the app. A runtime that embeds the *system* webview instead of vendoring Chromium is
the only lever left, and Tauri is the other mainstream candidate for exactly that.

### 0.2 Why Electrobun's dealbreakers do not automatically carry over — and why they still have to be re-checked

P20 closed on two dealbreakers. Tauri is architecturally different enough that neither transfers
1:1, **but neither is presumed solved either** — each needs its own answer under Tauri, from scratch:

| P20 dealbreaker | Why it does not transfer verbatim | What still has to be established |
|---|---|---|
| **No E2E/WebDriver path.** Electrobun's WKWebView exposes no WebDriver/CDP endpoint Playwright can attach to. | Tauri ships a first-party WebDriver story (`tauri-driver`) rather than having none at all. | **`tauri-driver`'s actual platform coverage.** Best current knowledge is that it wraps `WebKitWebDriver` (Linux/WebKitGTK) and Microsoft's `msedgedriver` (Windows/WebView2) — and that **macOS is not supported**, because Apple ships no WebDriver server for WKWebView. This app is macOS-only (SPEC §1/§3; `electron-builder.yml`'s `minimumSystemVersion: '13.0'`, arm64-only targets). *Unverified — a future spike stage must confirm this against Tauri's own current docs before anything else.* If it holds, this is the **same class of dealbreaker P20 hit**, and §5 Q2 says so plainly rather than burying it. |
| **No zero-copy/port-transfer primitive for bulk data.** Electrobun's RPC bridge only copies payloads, so every result page would land on the main process's event loop. | Tauri's own `invoke`/event bridge has the same limitation (no `MessagePort` transfer; Rust sits in the middle). A direct-socket sidecar would have sidestepped the question entirely, but **§1.1 decided against it** — everything routes through Tauri's bridge, forward-only. | Whether a forward-only relay (no deserialize, §1.1) clears P20's dealbreaker #2 on its own, without needing to bypass Tauri's bridge the way option (b) would have. See §3.2. |

Tauri's relevant architecture, as best-current-knowledge (each point **unverified here; a future
spike stage should confirm directly against Tauri's own documentation and a real build**):

- A **Rust core** (`src-tauri/`) owning the native window, menu and app lifecycle, with **WRY**
  driving the platform webview — WKWebView on macOS, i.e. the same system-webview bet Electrobun
  made, and the same reason the memory question is worth asking at all.
- Its **own IPC bridge**: the webview calls `invoke('command', args)` into Rust commands, and Rust
  emits events back. Payloads are serialized; there is no port-transfer primitive.
- **First-class sidecar support**: `tauri.conf.json`'s `bundle.externalBin` declares external
  binaries that get bundled into the app, and `tauri-plugin-shell`'s sidecar API spawns and manages
  them. This is the mechanism the whole premise below rests on, and it is the single most important
  thing for a spike to verify hands-on first.

## 1. The premise (decided by the user — not an open question)

**The Tauri (Rust) core stays as barebones as possible; as much functionality as possible lives in
the Node.js sidecar.** Concretely, the target split is:

**Stays in Rust (`src-tauri/`)** — and nothing beyond it without a stated reason:

- Native window creation, sized/positioned from persisted bounds — the equivalent of
  `src/main/window.ts` (58 lines: `new BrowserWindow`, `titleBarStyle: 'default'`,
  `backgroundColor: '#1F1F1F'`, `minWidth: 900`/`minHeight: 600`, `ready-to-show`, debounced
  `resize`/`move` persistence).
- The native menu — `src/main/menu.ts` (127 lines, **14** `accelerator` entries), whose items today
  just `webContents.send` the `kira:menu:*` channels.
- App lifecycle — `src/main/index.ts`'s `app.setName`, `app.setPath('userData', …)`,
  `app.whenReady`, `activate`, `window-all-closed`, and the `before-quit` flush handshake.
- Spawning, owning and supervising the Node sidecar (§3.4).
- The renderer-security posture that `src/main/security.ts` (60 lines) owns today, restated in
  Tauri's own terms (CSP, allowlist/capabilities, navigation guard) — see §3.6.

**Moves into the Node sidecar** — one process, replacing today's *two*:

- All of `src/main` except window/menu/lifecycle: the IPC handler business logic
  (`src/main/ipc/*.ts` — 14 modules), the SQLite storage layer
  (`src/main/storage/` — `db.ts`'s `drizzle-orm/sqlite-proxy` over `node:sqlite` with a 200-entry
  statement cache, `migrate.ts`, 5 SQL migrations, 10 repos under `storage/repos/`), settings /
  layout / tabs / saved-queries / filters / connections persistence, the op log
  (`src/main/oplog.ts`), pre-connect scripts (`src/main/preconnect.ts`), the tree service
  (`src/main/tree-service.ts`), connection state (`src/main/connections.ts`) and logging
  (`src/main/log.ts`).
- All of `src/engine` — the adapter layer (19 entries under `src/engine/adapters/`, eleven adapter
  directories plus the shared `mysql-family`/`sql-text`/`sql-mutate` helpers), the cache layer, the
  scheduler, `control.ts`, `data.ts` and `rpc.ts`.

Today those are **two** processes: `src/main` (51 TypeScript files / 3 567 lines, plus 5 `.sql`
migrations) owns IPC and storage, and the engine (`src/engine`, 119 files / 14 743 lines) runs as an
Electron `utilityProcess` forked by `src/main/engine-host.ts`
(`utilityProcess.fork(join(__dirname, 'engine.js'), [], { serviceName: 'kira-engine', stdio: 'pipe',
execArgv: ['--max-old-space-size=' + maxOldSpaceMb] })`). Under the premise, they collapse into one
Node sidecar — **whether that collapse is right, or whether the sidecar should itself fork a
child for driver work to preserve today's isolation, is an open question (§3.5), not a decision this
document makes.**

**The renderer is not rewritten.** `src/renderer` (182 files / 33 027 lines) imports `'electron'`
**nowhere** — verified: `grep -rn electron src/renderer` returns nothing. It reaches the platform
only through `window.kira` (the `contextBridge` surface exposed at `src/preload/index.ts:155`) and
the relayed `MessagePort` picked up in `src/renderer/bridge/port.ts:29-41`. Exactly **15** files in
`src/` import from `'electron'` at all — 14 under `src/main` + `src/preload`, plus
`src/engine/index.ts:3`, which is `import type { MessagePortMain }`, type-only. That isolation is
the strongest structural argument that this migration is even feasible, and it is unchanged since
P20 recorded the same finding.

## 1.1 Refinements decided in review (session of 2026-08-28)

Three of §3/§5's open questions were resolved by the user before any further work was done. Recorded
here as decisions, not findings — none of them has been verified against a real Tauri build.

- **Transport (§3.1): decided as option (a), forward-only.** The renderer talks to the sidecar
  exclusively through Tauri's own `invoke`/event bridge — no direct socket from the webview to the
  sidecar (option (b) is dropped). The Rust core's role in that path is a pure forward-only relay: it
  moves bytes between the webview and the sidecar without deserializing them into typed Rust structs.
  This keeps Tauri's `invoke`-only security/capability model intact (the concern that told against
  (b) in §3.1) while avoiding the double-(de)serialization cost that was (b)'s only real argument in
  the first place (§3.2). What the spike still has to confirm: whether this is achievable at all
  under Tauri's *default* JSON-argument `invoke` convention, which round-trips every payload through
  `serde_json` — Tauri also offers lower-level primitives (e.g. its `Channel` API for streaming, or a
  custom protocol handler for raw byte payloads) that may be what "forward only, no deserialize"
  actually requires in practice, rather than a plain `#[tauri::command]` with typed arguments.
  Confirming which primitive gets a real forward-without-reparse, and at what payload size the
  difference stops mattering against `docs/PERF.md` §2.1's budgets, replaces the old (a)-vs-(b) fork
  as the concrete task.

- **Sidecar bundling (§3.3): narrowed to Node's Single Executable Applications (SEA) or
  `bun build --compile`.** `pkg` is dropped — it is no longer actively maintained. Checked directly
  against both tools' own documented mechanism for native addons: **neither can link a compiled
  native addon into the executable's own machine code.** Both embed the addon's compiled bytes as a
  data asset inside the one shipped file, and at first use extract those bytes to a real temporary
  file on disk before calling `process.dlopen()` against that path — Node's own docs
  (`nodejs.org/api/single-executable-applications.html`) show the exact mechanism: `sea.getRawAsset()`
  pulls the embedded bytes, the app writes them to `os.tmpdir()`, then `process.dlopen()` loads that
  temp file; Bun's `build --compile` does the equivalent extract-then-`dlopen` internally for `.node`
  files. So "one file to ship" survives; "no second file ever touches disk" does not — a real file
  materializes in the temp directory every time the sidecar starts, then gets dynamically loaded.
  One concrete consequence worth flagging now rather than at packaging time: if `hardenedRuntime` is
  ever turned on (deliberately `false` today, `electron-builder.yml`), macOS's library-validation
  restrictions target exactly this pattern — a signed process `dlopen`-ing a binary that was not part
  of its own signed bundle — and would need the `disable-library-validation` entitlement or an
  equivalent Tauri-side accommodation. The two candidates differ on a deeper question, separate from
  the extraction mechanism they share: SEA runs the addon on a **real Node binary**, so the only
  requirement is building the addon against that exact Node version's ABI — the same *kind* of problem
  `scripts/native-electron-build.sh` already solves for Electron's ABI today, arguably simpler since a
  stock Node ABI is the boring, well-supported case Confluent's own prebuilds target. Bun is **not**
  Node — it runs on JavaScriptCore, not V8, and its own project describes its Node-API compatibility
  layer as partial; whether `@confluentinc/kafka-javascript` (already the addon that needs
  `CKJS_LINKING=dynamic` to dodge a blocked vendored build under Electron, per `AGENTS.md`) works
  under that shim at all is a separate, unverified, and more fundamental risk than the packaging trick
  both tools share. **A spike choosing between them should treat "does the Kafka addon load under Bun
  at all" as a go/no-go check to run before anything else, not an assumption.**

- **UI testing strategy (§3.7): decided outright, not contingent on `tauri-driver`'s macOS support.**
  The suite moves fully to Playwright's isolated `webkit` tier — a hand-built stand-in for
  `window.kira`/the sidecar connection, no real native shell in the loop — the same design the deleted
  Electrobun plan had already worked out for the identical problem. This is decided regardless of
  whether `tauri-driver` turns out to support macOS: every spec that depends on a real native shell
  (today's `tests/e2e/`, and P50's `tests/ipc/*/*.frontend.spec.ts` tier, both of which run inside a
  real `_electron.launch()` window) is retired, not ported, once the migration lands. What that
  permanently gives up, stated plainly rather than left implied: native menu/window/lifecycle
  integration coverage, coverage of the real IPC bridge (whatever §3.1's forward-only relay turns out
  to be, its correctness is exercised by nothing once the tests fake it), `safeStorage`/keychain
  integration coverage (§3.6), and the real navigation-lock/security-posture coverage
  `src/main/security.ts` has today. P50's **backend** tier is the one piece with an obvious future
  home: it never opens a window today (`ELECTRON_RUN_AS_NODE=1 electron` used purely as an
  ABI-correct Node), so under the sidecar it runs the same logic against plain Node — if anything,
  simpler than today. §5's former Q2 is answered by this: not a hard stop, because the mitigation is
  unconditional rather than dependent on `tauri-driver`'s answer.

## 2. The surface being moved, measured against the current tree

Re-counted directly for this document; do not carry these forward without re-checking, the tree
grows.

| Thing | Current state | Where |
|---|---|---|
| Main + preload | 51 `.ts` files / 3 567 lines (+ 5 `.sql` migrations) | `src/main/`, `src/preload/` |
| Engine | 119 `.ts` files / 14 743 lines | `src/engine/` |
| Renderer | 182 files / 33 027 lines, zero `'electron'` imports | `src/renderer/` |
| Shared | 26 files / 2 836 lines | `src/shared/` |
| IPC channels | **61** entries on the `IPC` const | `src/shared/protocol/ipc.ts:20-87` |
| Handler registrations | 33 via `src/main/ipc/errors.ts`'s wrapper, 7 direct `ipcMain.handle`, 1 `ipcMain.on` (the quit-flush ack, `src/main/index.ts:42`) | `src/main/ipc/` |
| Renderer-side consumption | 39 `ipcRenderer.invoke` sites, 6 `ipcRenderer.on/off/send` sites, all inside one file | `src/preload/index.ts` |
| main→renderer push | 5 `webContents.send`/`postMessage` sites | `src/main/` |

**The 61 channels come in four shapes**, and every one of them needs an answer under Tauri:

1. **Request/response** (`invoke`) — the bulk of the surface: `connectionsList`, `treeChildren`,
   `queriesSave`, `settingsSet`, `filesChooseSave`, … . Maps naturally onto a request/response call
   into the sidecar, whichever transport §3.1 picks.
2. **main→renderer push** — `connectionState`, `connectionMetadataInvalidated`,
   `connectionsChanged`, `settingsChanged`, `opUpdate`, `appMetrics`, plus the 11 `kira:menu:*`
   channels and `openSettings` that the native menu fires. Note the split: the first six originate in
   *business logic* (sidecar), the menu ones originate in the *native menu* (Rust). That is two
   different push paths under the premise, not one.
3. **Renderer→main fire-and-forget** — `appFlushed` (`src/shared/protocol/ipc.ts:42`), the ack half
   of the `before-quit` flush handshake main holds a 2 s timeout on.
4. **`MessagePort` transfer** — exactly one channel, `port: 'kira:port'`
   (`src/shared/protocol/ipc.ts:27`), and it is architectural, not incidental. See §3.2.

### 2.1 The bulk-data path as it exists today

`docs/ARCHITECTURE.md`'s Process model section states the rule: **"Bulk data skips the main
process."** The implementation:

- `src/main/index.ts:129-137` — per `did-finish-load`, `new MessageChannelMain()`; `port1` goes to
  the engine via `engineHost.attachRendererPort(port1, generation)`, `port2` to the renderer via
  `win.webContents.postMessage('kira:port', { generation }, [port2])`.
- `src/preload/index.ts:157-160` — relays it out with `window.postMessage({ __kira: 'port', meta },
  '*', event.ports)`, because (its own comment) "a MessagePort cannot cross contextBridge directly."
- `src/renderer/bridge/port.ts:29-41` — picks it up, closes any previous port, rejects everything
  still pending on the old one.
- `src/engine/index.ts:19-33` — receives `{ kind: 'attach-port' }` over `process.parentPort` and
  drives the port from the far side.

The wire protocol over that port is `src/shared/protocol/port.ts`'s `PortRequest` / `PortResponse` /
`PortEvent` — a plain `{kind, id, op, payload}` request/response plus a topic-based event, i.e.
**not** something that depends on `MessagePort` semantics beyond "a duplex channel between two
processes that isn't main." Worth stating, because it means the *protocol* is portable even though
the *primitive* is Electron-specific. `src/engine/rpc.ts:49-58`'s `transfer` return value is
documented as "plumbing for a future platform" and is always undefined today — today's payloads are
structured-clone, not zero-copy — which lowers the bar a replacement has to clear.

## 3. What the spike still has to determine

Everything in this section is an **open question**. Nothing here is a finding.

### 3.1 How does the renderer talk to the sidecar?

**Decided — see §1.1: option (a), forward-only relay through Tauri's own bridge.** The two shapes
below are kept for their rationale, since that rationale is *why* (a) was chosen over (b) — but the
fork itself is closed. What remains open is which Tauri IPC primitive actually delivers "forward
without deserializing" in practice (§1.1's remaining sub-question).

**(a) Route everything through Tauri's own bridge.** The renderer only ever calls `invoke(...)`;
Rust commands relay to the sidecar over a local transport (the sidecar's stdio, a Unix domain
socket, or a loopback TCP/WebSocket port) and relay responses back.

- *For*: keeps Tauri's security model intact and idiomatic — the webview's only channel out is
  `invoke`, which is what Tauri's capability/permission system is designed around. Request-scoped
  ownership, and whatever relaunch/supervision semantics the `invoke` boundary gives for free, come
  along with it. It is also the shape Tauri's own documentation and examples assume.
- *Against*: it reintroduces exactly the hop the "barebones main process" direction wants to
  remove. Every one of the 61 channels needs a Rust command (or one generic relay command plus a
  discriminator), and every bulk page is back on the Rust core's event loop — the P20 dealbreaker #2
  shape, in Rust rather than in Bun.

**(b) The renderer opens a direct connection to the sidecar.** Most plausibly a loopback WebSocket
the sidecar listens on, whose port/token Rust passes to the webview at startup. Tauri's core is then
genuinely barebones: window, menu, lifecycle, spawn.

- *For*: matches the user's direction literally. It also makes §3.2 tractable rather than a
  regression to accept.
- *Against*: needs real thought about (i) Tauri's CSP — the webview's `connect-src` must permit the
  loopback endpoint, and this app currently loads from `file://` with a `<meta>` CSP; (ii)
  authentication — a loopback listener is reachable by any local process, so a per-launch token or a
  Unix socket (if the webview can reach one at all, which it likely cannot from JS) is required, not
  optional; (iii) losing the ownership/lifecycle semantics option (a) would inherit — nothing ties a
  socket connection to a Tauri command's lifetime; (iv) `src/main/security.ts`'s existing posture
  (navigation locked to the app's own base URL, `window.open` disabled, permissions denied except
  clipboard) has to be re-derived so that opening a socket doesn't quietly widen the surface those
  60 lines deliberately narrowed.

A hybrid was also considered — control-plane over (a), bulk data over (b) — but is dropped along with
(b) itself per §1.1: everything, including bulk data, goes over (a)'s forward-only relay.

**Resolved per §1.1. What the spike must still answer with a design:** which Tauri IPC primitive
(a typed `#[tauri::command]`, the `Channel` API, or a custom protocol handler) actually achieves a
forward-without-reparse for large payloads, and at what size the choice stops mattering.

### 3.2 Bulk data with no `MessagePort`

Tauri has no ports API; `MessageChannelMain` is Electron-specific and does not survive the move.
`docs/ARCHITECTURE.md`'s "bulk data skips the main process" invariant, and the interaction budgets in
`docs/PERF.md` §2.1 that depend on it, are what is at stake.

**Superseded by §1.1's decision: bulk data goes over the same forward-only `invoke`-based relay as
everything else, not a direct socket.** The question this section originally posed — whether a
direct-socket sidecar clears P20's dealbreaker #2 outright — is moot once (b) is off the table; the
relay has to clear it instead, by being genuinely forward-only rather than a re-serializing hop. That
puts the weight entirely on §3.1's remaining sub-question (which Tauri primitive forwards bytes
without a `serde_json` round trip), and on the items below, which still apply verbatim to a
relay-based design since a Tauri IPC frame is no more a structured clone than a WebSocket frame is:

- What the encoding cost is for `PortResponse` payloads that today cross as structured clones, and
  whether binary framing is needed to keep `docs/PERF.md` §2.1's budgets (5.6 ms p50 scroll against
  an 8 ms budget) intact.
- Whether the `src/shared/protocol/port.ts` protocol survives verbatim (it looks transport-agnostic,
  §2.1) or needs a framing layer.
- Whether the generation/reattach semantics `src/renderer/bridge/port.ts` and
  `src/main/index.ts:128-137` implement for renderer reload have a clean analogue over `invoke`/events.
- Whether a forward-only relay, implemented naively, still ends up on the Rust core's event loop for
  the duration of the forward — i.e. whether "no deserialize" is enough on its own to avoid P20
  dealbreaker #2's shape, or whether the *size* of the memcpy itself (a multi-megabyte result page)
  is enough to matter regardless of whether it's parsed. This is the one place §1.1's decision could
  still fail to clear the dealbreaker even if the primitive-selection question above goes well.

### 3.3 How the sidecar gets packaged, shipped and spawned

Tauri's `bundle.externalBin` mechanism expects **a single executable per target triple**, named with
the triple suffix. A Node application is not that shape.

**Candidates decided — see §1.1: Node's own SEA, or `bun build --compile`.** `pkg` is dropped
(unmaintained). Both share the same native-addon mechanism §1.1 already worked out in detail — embed
the compiled `@confluentinc/kafka-javascript` `.node` as a data asset, extract it to a real temp file
at first use, `dlopen()` that path — so "one file to ship" holds but a second file still materializes
on disk at runtime, with the `hardenedRuntime`/library-validation consequence §1.1 names. What
remains to cost out between the two candidates specifically:

- **SEA**: the addon (and `node:sqlite`, which pins a Node version floor of its own) needs building
  against the exact Node version the SEA embeds — the same *kind* of ABI-matching problem
  `scripts/native-electron-build.sh` already solves for Electron, on what is likely easier ground
  since it is a stock Node ABI.
- **`bun build --compile`**: Bun is not Node — JavaScriptCore, not V8, with Bun's own admittedly
  partial Node-API compatibility layer. Whether the Kafka addon (which already needs
  `CKJS_LINKING=dynamic` to avoid a build blocked under Electron, per `AGENTS.md`) loads under that
  layer at all is unverified and is the single riskiest unknown in this whole subsection — a go/no-go
  check to run before costing anything else about Bun.
- Bundling a full Node runtime plus the app's JS inside the `.app` and pointing `externalBin` at a
  thin launcher, as the alternative to a SEA/compiled single file, if neither candidate above proves
  workable for the native-addon/`node:sqlite` combination.
- Requiring a system Node — almost certainly unacceptable for a shipped desktop app; named here and
  dismissed with a reason rather than left implied.

What this does to **app size and startup** against Electron's vendored 221 MB binary is a headline
number the spike should produce, alongside the memory number from §0.1 — a Tauri app that is 8 MB of
Rust plus a 90 MB bundled Node runtime is a different story from one that is 8 MB total, and the
whole motivation is footprint.

### 3.4 Process lifecycle and supervision

Today's policy is explicit and narrow. `src/main/engine-host.ts`'s exit handler comments it: *"No
auto-respawn (§13.2 of the P1 plan): the user reconnects manually"* — on engine exit every pending
call is rejected with `E_ENGINE_DOWN` and `main/connections.ts` synthesizes error states for each
connection it believed live.

That policy was written for a process that owned **only DB adapters**. Under the premise, the
sidecar additionally owns settings, layout, tabs, saved queries, the op log and window-state
persistence. **Losing it mid-session stops being "reconnect your databases" and becomes "the app
cannot save anything."** The spike has to decide, with reasoning:

- Does no-auto-respawn survive, or does a sidecar hosting all app logic need supervised restart?
- If it restarts, what happens to in-flight state, to the renderer's open connections, and to the
  `port`-generation/reattach logic in `src/renderer/bridge/port.ts`?
- What replaces the `before-quit` flush handshake (`src/main/index.ts:152`, `IPC.appFlushBeforeClose`
  / `IPC.appFlushed`, 2 s timeout) when the thing being flushed lives across a process boundary from
  the thing holding the quit?
- What replaces `execArgv: ['--max-old-space-size=…']` — today's engine memory cap, a user-facing
  setting (`advanced.engineMemoryCapMb`). A spawned Node sidecar can take the same flag, so this one
  looks like it *survives* under Tauri where it did not under Electrobun's JSC runtime — worth
  confirming, and worth noting as a small point in Tauri's favor.

### 3.5 Does the engine stay a separate process?

`docs/ARCHITECTURE.md` gives the reason the engine is separate at all: driver work is "CPU-bursty.
In the main process it would stall window/menu handling; in the renderer it would drop frames. In its
own process it is fully parallel and its memory is separately capped and reclaimable." Collapsing
`src/main`'s logic and `src/engine` into **one** sidecar puts adapter work back on the same event
loop as settings writes, the op log and the tree service.

The premise says "as much as possible in the sidecar," which is about the **Rust/Node** split, not
necessarily about collapsing Node into a single process. The spike should decide explicitly whether
the sidecar is one process or two (a control sidecar plus a forked engine child, keeping today's
isolation and the memory cap while still keeping Rust barebones) and say why — this is a real design
choice the premise does not settle.

### 3.6 Credential storage — the seam that does not fit the premise

`src/main/secret-cipher.ts` (111 lines) is, by its own comment, *"the only file in the repo that
imports `safeStorage` (P25 D1)"*; `src/main/storage/repos/secrets.ts` is the only file that reads or
writes `connections.password`. `safeStorage` is Keychain-backed on macOS and is an **Electron API
with no Tauri equivalent**.

Tauri's candidates, as best-current-knowledge and **unverified**: `tauri-plugin-stronghold` (an
encrypted vault, not an OS keychain) and Rust keychain crates such as `keyring-rs` (which does front
the macOS Keychain). Both are **Rust-side**, which is precisely the seam that fights the premise: the
sidecar owns the credential *storage* (`repos/secrets.ts`, the SQLite row) but the only sane home for
the OS-keychain *call* is Rust. That implies a small privileged Rust surface — encrypt/decrypt an
opaque string — that the sidecar calls back into, which is the one place the "barebones core"
direction has to bend. The spike must design that seam deliberately rather than discovering it
mid-implementation, and must also account for:

- `SecretStorageStatus`'s existing contract (`available` / `backend` / `insecureFallback` /
  `reason`), which `tests/e2e/secrets.spec.ts` asserts must read `true` / `'keychain'` on darwin.
- The `KIRA_INSECURE_SECRETS` Linux dev fallback (P25 D13, documented in `AGENTS.md`) — Linux is
  this repo's dev/CI environment only, never a supported platform, but the CI story still needs an
  equivalent or the whole test suite loses its dev environment.
- The envelope format `kira:v1:<base64>` and P25 D10's pre-P25-plaintext passthrough — a migration
  of *stored* secrets is in play if the underlying primitive changes, not just a code swap.

### 3.7 E2E testing

Today: Playwright's Electron driver (`_electron.launch()`), 23 specs in `tests/e2e/`, plus P50's
two-tier `tests/ipc/` split (7 adapter folders, each with a backend spec run under
`ELECTRON_RUN_AS_NODE=1 electron` and a frontend spec run in a real Electron window against mocked
`ipcMain` handlers).

**Decided — see §1.1: the suite moves fully to Playwright's isolated `webkit` tier, unconditionally.**
`tauri-driver`'s actual platform support (best current knowledge: it wraps `WebKitWebDriver` on
Linux and `msedgedriver` on Windows, with **no macOS support**, since Apple ships no WebDriver server
for WKWebView) no longer gates this decision — it is not being adopted regardless of the answer, so
there is nothing left to check before other spike work the way §5's old Q2 implied. It is still worth
confirming for the record, since a live "no" independently corroborates why P20's dealbreaker class
recurs here, but it is no longer a fork the spike waits on.

What survives, restated against the decision rather than as a contingency:

- P50's **backend** tier — it never opens a window and only uses Electron as an ABI-correct Node
  today; under a Node sidecar it runs under plain Node, arguably *simpler*.
- The new isolated `webkit` tier, replacing both P50's **frontend** tier and all 23 `tests/e2e/`
  specs, per §1.1.
- Nothing replaces shell-integration coverage itself — native menu/window/lifecycle, the real IPC
  bridge, `safeStorage`/keychain (§3.6), `src/main/security.ts`'s navigation-lock posture. §1.1 states
  this as an accepted, permanent loss, not a gap to fill later.

Which specs lose their *subject* entirely regardless of driver or test tier: `budgets.spec.ts`,
`perf.spec.ts` and `startup.spec.ts` are built on `app.getAppMetrics()` and
`app.evaluate(() => process.uptime())` (Electron-only; `src/main/index.ts:120-124` also feeds
`IPC.appMetrics` from `getAppMetrics()`, so the app's own status-bar readout needs a replacement too,
not just the tests) — this loss is independent of §1.1's testing decision and would apply even if
shell-integration E2E had been kept.

### 3.8 Packaging and signing

`electron-builder.yml` (asar, `asarUnpack` for `out/main/engine.js` and the Kafka `.node`,
`identity: '-'` ad-hoc, `hardenedRuntime: false`, `electronLanguages: ['en']`, dmg+zip arm64,
five `electronFuses`) and `scripts/verify-packaging.sh` (150 lines; static checks S1–S7, artifact
checks A1–A5, asserting on `dist/mac-arm64/Kira Studio.app`) are entirely Electron-shaped. A
two-binary bundle — the Tauri `.app` plus the Node sidecar inside it — needs its own story:

- What Tauri's bundler produces, and whether an ad-hoc (`identity: '-'`) signature is even coherent
  when a second executable ships inside the bundle (a nested binary generally needs its own
  signature; unverified).
- The `electronFuses` block has no Tauri analogue and no longer means anything — but what it was
  *protecting against* (the app being usable as a general-purpose Node runtime, honoring
  `NODE_OPTIONS`, accepting `--inspect`) applies **more** to a shipped Node sidecar, not less. That
  is a real hardening question, not a line item to delete.
- What `scripts/verify-packaging.sh` becomes. S1–S5 (no updater dependency, no updater code, no
  publish config) are runtime-independent and should survive; S6/S7 and A1–A5 are Electron-specific.

### 3.9 Per-module disposition — enumerated, not performed

A full triage is future work; the spike's report owes a per-module disposition for:

```
src/main/          index.ts  window.ts  menu.ts  log.ts  env.ts  security.ts
                   connections.ts  engine-config.ts  engine-host.ts  oplog.ts
                   preconnect.ts  secret-cipher.ts  tree-service.ts
src/main/ipc/      app.ts  connections.ts  deps.ts  engine.ts  errors.ts  files.ts
                   filters.ts  layout.ts  ops.ts  queries.ts  registry.ts
                   settings.ts  tabs.ts  tree.ts
src/main/storage/  db.ts  migrate.ts  paths.ts  migrations/ (5)  schema/  repos/ (10)
src/preload/       index.ts
src/engine/        index.ts  control.ts  data.ts  rpc.ts  cache/  scheduler/  adapters/ (17)
```

The expected answer under the premise is "sidecar" for nearly all of it, with `window.ts`,
`menu.ts`, `security.ts` and the lifecycle half of `index.ts` becoming Rust, `secret-cipher.ts`
splitting across the §3.6 seam, and `preload/index.ts` disappearing into whatever §3.1 picks. **That
expectation is a hypothesis for the triage to confirm or overturn, not the triage's result.**

## 4. Explicitly out of scope for this document

- No Tauri or Rust toolchain installed; no `cargo`, no `rustup`, no `tauri` CLI run.
- No `src-tauri/` scaffold created.
- No code change under `src/`, `tests/` or `scripts/`.
- No `package.json`, `Cargo.toml` or lockfile change; no dependency added or removed.
- No per-module triage performed — §3.9 enumerates the inputs only.
- No benchmark, no measurement, no memory or startup number produced for Tauri. §0.1's numbers are
  quoted from `docs/PERF.md`'s existing Electron record, not re-measured.
- No claim about Tauri's own behavior is presented as verified. Every one is flagged as
  best-current-knowledge for a future spike stage to confirm directly.

## 5. Open questions for the user (answer before a spike phase is scoped)

Three of the original six are resolved by §1.1 and kept here only as a record of what was asked and
answered:

1. ~~Which transport direction should the spike investigate first?~~ **Resolved — §1.1: option (a),
   forward-only relay. No direct socket, no hybrid.**
2. ~~Is losing macOS E2E coverage a hard stop, or pre-accepted?~~ **Resolved — §1.1: pre-accepted,
   unconditionally. The isolated `webkit` tier is adopted regardless of `tauri-driver`'s actual
   platform support**, so confirming that support is no longer a gate on other spike work (though
   still worth doing, for the record — see §3.7).
3. ~~Is a bundled Node runtime acceptable?~~ **Narrowed, not fully resolved — §1.1: the candidates are
   SEA or `bun build --compile` specifically (not `pkg`, not a hand-rolled bundle).** Still open:
   whether either candidate's actual footprint is acceptable once measured (below, renumbered Q3).

Still open:

1. **Is the §3.6 Rust-side credential seam acceptable?** The premise says everything in the sidecar;
   OS-keychain access realistically cannot be. Is a small privileged Rust surface an acceptable
   exception, or does the premise mean the app should move off OS-keychain storage entirely (which
   would be a change to P25's design, not just a port of it)?
2. **One sidecar or two (§3.5)?** Collapsing `src/main`'s logic and `src/engine` into one process
   contradicts the reason `docs/ARCHITECTURE.md` gives for splitting them. Should the spike design
   for a single sidecar, or a control sidecar plus a forked engine child?
3. **Given SEA/`bun compile` specifically (§1.1/§3.3), is the resulting footprint acceptable?** If
   "Tauri's few MB plus a bundled Node runtime" still lands well above Tauri's own baseline, the size
   half of the motivation weakens even if the memory half holds — and if the Kafka addon turns out not
   to load under Bun at all (§3.3's flagged go/no-go check), that alone may decide between the two
   candidates before footprint is even compared.
4. **Is there a macOS arm64 machine available for the spike at all?** `docs/PERF.md` §3's manual
   procedures remain unfilled for exactly this reason, and P20's §8 Q1 asked the same thing. A
   Linux-only investigation cannot answer the questions that matter here (§3.7), the same way it
   could not for Electrobun.

## 6. Decision gate

The eventual spike's deliverable is a **written report**, committed alongside this plan, covering:

- Every open question in §3, answered against a real Tauri build rather than documentation alone
  where that is possible — including §3.3's Bun/Kafka-addon go/no-go check, which should run early
  since a "no" decides the bundling candidate before footprint is even worth comparing.
- A concrete **design for the renderer↔sidecar transport** (§3.1) and for **bulk data** (§3.2),
  including whether the "bulk data skips the core" invariant survives intact, and a stated cost
  against `docs/PERF.md` §2.1's budgets if it does not.
- A concrete **sidecar packaging story** (§3.3), with the resulting app size and cold-start numbers
  next to Electron's.
- The **per-module disposition** (§3.9), completed.
- A plain enumeration of everything that gets *worse*, not just what gets better — the memory number
  is the only thing this migration is for, and a report that only lists wins is not usable for a
  decision.
- An explicit **go/no-go recommendation**.

**No implementation phase starts until the user has reviewed that report and signed off.** This
document does not authorize a spike; it scopes one.
