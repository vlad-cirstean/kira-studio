# P51 — Wails (Go) shell + Go app core + Node engine child process, migration spike

> This document is the plan. **The repo owner has explicitly signed off on starting the spike**
> (2026-08-28), and `docs/v1/plans/P51-spike-report-part1.md` + `-part2.md` are the first two
> installments of the report §6 asks for — the subset answerable from a Linux sandbox with no macOS
> machine and with `wails.io`/`v3.wails.io` still egress-blocked. Part 1 covers §3.1, §3.2, §3.3, §3.6
> and §3.10 with a real installed toolchain, a real generated Wails v3 project, and two measured
> Go↔Node prototypes. Part 2 reads the Wails v3 Go source directly (not just the client runtime) and
> turns §3.2's bulk-data bridge from a hypothesis into a concrete design: a named `Stream()` carrying
> raw bytes for bulk pages, alongside the default JSON `Call` binding for everything else — grounded
> in source, but **not yet driven against a live running app** (two attempts hit this sandbox's own
> background-process lifecycle limits, not a Wails limitation; see part 2's last section).
> **§3.4, §3.5, §3.7 and the native-shell half of §3.8 remain untouched** — they need the macOS arm64
> machine §5 Q4 already named, which is still not available. Read both report parts before assuming
> any open question below is closed; this header is intentionally terse and the reports are the
> source of truth for what has actually been verified.

## 0. What this phase is, and what it replaces

P51 previously held *"Tauri + Node sidecar migration spike."* That plan
(`docs/v1/plans/P51-tauri-node-sidecar-spike.md`) is **deleted** and this document takes the slot.
This is a genuine architecture pivot, not a refinement of it, so **none of its Tauri-specific content
is carried forward** — not the `externalBin` sidecar mechanism, not `tauri-driver`, not the
Rust-side credential seam, not the SEA/`bun build --compile` single-file packaging analysis, not the
forward-only-`invoke`-relay transport decision. Two things changed:

- **Go, not Rust.** The repo owner's stated reason, verbatim: *"no rust as some more code might
  migrate in the main app and i prefer go."* Go is the only backend/shell language in scope for this
  phase. Tauri and Rust are ruled out explicitly, not left as an alternative to weigh.
- **A partial migration, not a total one.** The Tauri plan moved *everything* — `src/main` **and**
  `src/engine` — into one Node sidecar, leaving a barebones native core. This plan moves only the
  app's own logic (all of `src/main`) into Go, and leaves the DB engine (`src/engine`) exactly as it
  is, in TypeScript, on a real Node.js process. That is preferable to both of the alternatives it
  sits between: to "everything stays in one sidecar" (which put settings, tabs, layout and the op log
  behind the same crash boundary as driver code — see §3.6), and to "everything gets rewritten at
  once" (which would mean porting eleven DB adapters, the cache and the scheduler — 119 files,
  14 743 lines — into Go before anything ships).

**`docs/v1/plans/P20-electrobun-spike.md` is untouched and stays closed.** Its verdict ("out of
scope — will not be done") is the record of the *Electrobun* investigation and is not reopened,
revised, or superseded here. Only P51's slot is repurposed.

### 0.1 Why a runtime change is still worth asking about

`docs/PERF.md` §2.2 is the whole motivation and it has not changed: baseline overhead with **zero
connections and zero tabs** is ≈620–626 MB (Browser + GPU + NetworkService + Tab), against SPEC §2's
350 MB budget. That section records the conclusion plainly — this is "Chromium/Electron process
overhead … not something P12's levers act on" — and `tests/e2e/memory.spec.ts` was **removed** rather
than kept permanently red (commit `d23121e`). The budget is failed by the runtime, not by the app. A
runtime that embeds the *system* webview instead of vendoring Chromium is the only lever left, and
Wails is a mainstream candidate for exactly that, in Go.

## 1. The decided architecture (decided by the repo owner — not an open question)

Everything in this section is a **premise**. The spike does not get to revisit it; it gets to design
against it and report what it costs.

### 1.1 Wails (Go) becomes the native shell **and** absorbs all of today's `src/main`

One process, not two roles awkwardly split. Window, menu, lifecycle and renderer-security posture
become native Wails/Go idioms directly — the Go equivalents of `src/main/window.ts` (58 lines),
`src/main/menu.ts` (127 lines, **14** `accelerator` entries), `src/main/security.ts` (60 lines) and
the lifecycle half of `src/main/index.ts` (`app.setName`, `app.setPath('userData', …)` at
`src/main/index.ts:25`, `whenReady`, `activate`, `window-all-closed`, the `before-quit` flush
handshake at `src/main/index.ts:152`).

And in the *same* Go process, **all** of the rest of `src/main`:

- The IPC handler business logic — `src/main/ipc/*.ts`, **14** modules, 402 lines.
- The SQLite storage layer — `src/main/storage/`, today `drizzle-orm/sqlite-proxy` over `node:sqlite`
  (`db.ts`, 109 lines, statement-cached), `migrate.ts`, **5** `.sql` migrations, **9** schema modules,
  **10** repos under `storage/repos/`.
- Settings, layout, tabs, saved queries, filter history, tree filters, connections persistence.
- The op log (`src/main/oplog.ts`, 114 lines).
- Pre-connect scripts (`src/main/preconnect.ts`, 237 lines — today `node:child_process` `spawn` plus a
  settle-window/supervisor model; becomes `os/exec` in Go).
- The tree service (`src/main/tree-service.ts`, 154 lines).
- Connection state (`src/main/connections.ts`, 409 lines).
- Credential encryption (`src/main/secret-cipher.ts`, 111 lines — today the only file that imports
  Electron's `safeStorage`, P25 D1).
- Logging (`src/main/log.ts`, 45 lines).

Nothing in `src/main` stays in JavaScript. `src/preload/` disappears entirely into whatever §3.2's
renderer↔Go bridge turns out to be.

### 1.2 `src/engine` stays exactly as it is, on a **real, standard Node.js**

`src/engine` (119 `.ts` files / 14 743 lines: the adapter layer — 19 entries under
`src/engine/adapters/`, eleven adapter directories plus the shared `mysql-family`/`sql-text`/
`sql-mutate`/`abort`/`live` helpers — plus the cache layer, the scheduler, `control.ts`, `data.ts`,
`rpc.ts`) is **not ported, not rewritten, not re-bundled into another runtime.** It keeps running as
a genuine plain Node.js child process.

This is explicit and repeated: **real, standard Node.js.** Not Bun. Not Deno. Not Electrobun's
Cottontail. Not any other JS runtime. And **not compiled into a single executable** via `pkg`, Node's
SEA, or `bun build --compile`. Concretely:

- **Vendor an actual Node.js runtime binary** — the ordinary kind anyone downloads from nodejs.org —
  inside the `.app` bundle.
- Ship the engine's compiled `.js` files and its `node_modules` as **normal loose files** beside it.
- **Spawn it from Go** exactly the way `src/main/engine-host.ts` spawns it from Electron today
  (`utilityProcess.fork(join(__dirname, 'engine.js'), [], { serviceName: 'kira-engine', stdio:
  'pipe', execArgv: ['--max-old-space-size=' + maxOldSpaceMb] })`) — just from Go's `os/exec` instead
  of Electron's `utilityProcess`, and over a different real transport, since no `MessagePort` exists
  across a Go↔Node boundary (§3.3).

### 1.3 Install size is explicitly not a concern

Stated by the repo owner. This directly licenses §1.2's "vendor a real Node runtime" over any
single-file compilation trick, and it is worth naming because of what it *removes*: the entire
category of packaging risk the deleted Tauri plan had to grapple with — embedding a native addon as a
data asset, extracting it to a temp file at first use, and `dlopen`-ing a binary that was never part
of the signed bundle — simply does not arise here. See §3.4.

### 1.4 No backward compatibility, no data migration

The repo owner stated plainly that preserving the ability to read old persisted `kira.sqlite` rows in
the current TypeScript/zod schema shape is **not required**. This simplifies the Go-side storage and
settings rewrite considerably: define a fresh schema in Go, and skip replicating zod's
`.default()`-driven backward-compatibility mechanism entirely (`src/shared/domain/settings.ts` uses
**6** `.default(...)` calls specifically so that a settings row written before a key existed still
parses on the next launch — its own comment says so; none of that machinery needs a Go analogue).

### 1.5 This is a real architecture in its own right

It is not framed as a stepping stone, and the spike should not evaluate it as one. It happens to
*also* leave a door open, which is worth naming once and then leaving alone: `src/engine/adapters/
registry.ts` is already a clean `Partial<Record<ConnectionKind, (deps) => Promise<Adapter>>>` of
pluggable per-kind loaders — precisely the shape that would let a single connection kind's adapter be
reimplemented natively in Go while every other kind stays on the Node engine, behind a small dispatch
layer. That is the natural future direction and the reason this architecture does not foreclose going
further later. **It is out of scope for this phase** — see §4. This plan does not design it.

## 2. The surface being moved, measured against the current tree

Re-counted directly for this document against the current checkout; do not carry these forward
without re-checking, the tree grows.

| Thing | Current state | Where |
|---|---|---|
| Main + preload | 51 `.ts` files / 3 567 lines (+ 5 `.sql` migrations) | `src/main/`, `src/preload/` |
| Engine | 119 `.ts` files / 14 743 lines | `src/engine/` |
| Renderer | 182 files / 33 027 lines, **zero** `'electron'` imports | `src/renderer/` |
| Shared | 26 files / 2 836 lines | `src/shared/` |
| IPC channels | **61** entries on the `IPC` const | `src/shared/protocol/ipc.ts:20-87` |
| Handler registrations | 33 via `src/main/ipc/errors.ts`'s `handle()` wrapper, 7 direct `ipcMain.handle`, 1 `ipcMain.on` (the quit-flush ack, `src/main/index.ts:42`) | `src/main/ipc/` |
| Renderer-side consumption | 39 `ipcRenderer.invoke` sites, 6 `ipcRenderer.on/off/send` sites, all inside one file | `src/preload/index.ts` |
| main→renderer push | 5 `webContents.send`/`postMessage` sites | `src/main/` |
| Files importing `'electron'` at all | **15** — 14 under `src/main`/`src/preload`, plus `src/engine/index.ts:3`, which is `import type { MessagePortMain }`, type-only | `src/` |

**The renderer is not rewritten.** `grep -rn electron src/renderer` returns **nothing** — re-verified
for this document. It reaches the platform only through `window.kira` (the `contextBridge` surface at
`src/preload/index.ts:155`) and the relayed `MessagePort` picked up in `src/renderer/bridge/port.ts`.
That isolation is the strongest structural argument this migration is feasible at all, and it is
unchanged since P20 first recorded it.

**The 61 channels come in four shapes**, and every one needs an answer under Wails:

1. **Request/response** — the bulk of the surface (`connectionsList`, `treeChildren`, `queriesSave`,
   `settingsSet`, `filesChooseSave`, …). Maps onto a Wails binding, §3.2.
2. **Go→renderer push** — `connectionState`, `connectionMetadataInvalidated`, `connectionsChanged`,
   `settingsChanged`, `opUpdate`, `appMetrics`, plus the 11 `kira:menu:*` channels and `openSettings`
   the native menu fires. Note that under this architecture, unlike the Tauri plan's, **both** groups
   originate in the same Go process — business logic and native menu alike. That is one push path,
   not two.
3. **Renderer→main fire-and-forget** — `appFlushed` (`src/shared/protocol/ipc.ts:42`), the ack half of
   the `before-quit` flush handshake main holds a 2 s timeout on (`src/main/index.ts:42,152`).
4. **`MessagePort` transfer** — exactly one channel, `port: 'kira:port'`
   (`src/shared/protocol/ipc.ts:27`), and it is architectural, not incidental. See §2.1.

### 2.1 The bulk-data path as it exists today

`docs/ARCHITECTURE.md`'s Process model section states the rule: **"Bulk data skips the main
process."** The implementation, re-verified:

- `src/main/index.ts:132-135` — per `did-finish-load`, `new MessageChannelMain()`; `port1` goes to the
  engine via `engineHost.attachRendererPort(port1, generation)`, `port2` to the renderer via
  `win.webContents.postMessage('kira:port', { generation }, [port2])`.
- `src/preload/index.ts:157-160` — relays it out with `window.postMessage({ __kira: 'port', meta },
  '*', event.ports)`, because (its own comment) "a MessagePort cannot cross contextBridge directly."
- `src/renderer/bridge/port.ts:30-31` — picks it up off the `__kira: 'port'` envelope, closes any
  previous port, rejects everything still pending on the old one.
- `src/engine/index.ts:19-33` — receives `{ kind: 'attach-port' }` over `process.parentPort` and
  drives the port from the far side.

The wire protocol over that port is `src/shared/protocol/port.ts` — `PortRequest` (`{kind:'req', id,
op, payload}`), `PortResponse` (`ok` / `error` discriminated on the same `id`) and `PortEvent`
(`{kind:'evt', topic, payload}`). **This protocol is already transport-agnostic**, by its own
documented reasoning: it depends on nothing about `MessagePort` semantics beyond "a duplex channel
between two processes that isn't main." That matters more here than it did under the Tauri plan,
because Go↔Node genuinely has no `MessagePort` and needs a different real transport (§3.3) — and the
protocol design that transport must carry **already exists and is reusable verbatim**. What does not
exist yet is the transport itself, or either side's implementation of it.

`src/engine/rpc.ts`'s `transfer` return value is documented as "plumbing for a future platform" and is
always `undefined` today — today's payloads are structured-clone, not zero-copy — which lowers the bar
a replacement has to clear.

### 2.2 The Kafka native addon, stated precisely

`AGENTS.md`'s "Native Kafka driver" section and `docs/v1/SPEC.md`'s Kafka passage record a finding
that is easy to overstate in this phase's favor, so state it exactly:

- **`@confluentinc/kafka-javascript`'s own build (`util/configure.js`) always attempts a native
  compile with vendored C dependencies** (zlib / libcurl / libcrypto / zstd — it passes librdkafka's
  `mklove` configure `--install-deps --source-deps-only --enable-static`) **regardless of target
  runtime.** This is *not* specific to Electron's ABI.
- What **Electron's ABI specifically adds** is `scripts/native-electron-build.sh`'s extra complexity:
  matching Electron's non-standard embedded-Node ABI, read from `node_modules/electron/abi_version`
  (148 for the pinned electron@43.4.1), for a NAN addon whose published prebuilds are per-*Node*-
  version only — there is no Electron prebuild at all.
- **Under a stock, vendored Node runtime, that Electron-ABI-matching complexity disappears.** The
  addon targets a standard Node ABI, which is the boring, well-supported case Confluent's own
  prebuilds are published for.
- **The native compile step itself does not go away.** It still needs to happen once, at build/release
  time, on a controlled build machine — with `CKJS_LINKING=dynamic` (or equivalent) to link against
  system `libssl`/`zlib`/`libcurl` instead of triggering the vendored-source fetch. This is exactly
  what happens today: `native-electron-build.sh` runs only at `predev` / `pretest:e2e` /
  `pretest:db:kafka` / `prepackage:mac` time, **never on an end user's machine**.

So: the Electron-ABI-specific half goes away; the underlying one-time build-time compile does not, but
becomes simpler.

## 3. What the spike still has to determine

Everything in this section is an **open question**. Nothing here is a finding except where explicitly
marked as verified, with how it was verified.

### 3.1 Wails has no first-class sidecar / external-binary mechanism

**Verified**, by reading the live discussion `wailsapp/wails` #3021, *"External Binaries (e.g., Tauri
Sidecar)"* — which asks in as many words for a Tauri-sidecar equivalent. The maintainer's answer
points at Go's own `go:embed`; a later commenter names the exact gap, that embedding produces one
binary whereas a sidecar bundles a genuinely separate external executable. The discussion is not
resolved with a feature. **There is no `externalBin` analogue and no `tauri-plugin-shell` analogue.**

Consequences, both real if mechanical:

- **Spawning and supervising the Node child process is hand-rolled** in Go's `os/exec` — the
  `EngineHost` interface at `src/main/engine-host.ts` (status / attach / call / on / stop, a pending-
  call map with a 30 s default timeout, stdout/stderr pumped into `log.ts`) has to be rebuilt from
  primitives, not configured.
- **Bundling the vendored Node runtime plus the engine's JS and `node_modules` into the `.app` needs a
  custom build/packaging script.** Wails' bundler will not do it. Note `go:embed` is *not* the answer
  here even though it is the maintainer's suggestion — §1.2 requires loose files and a real Node
  binary, and embedding them into the Go binary would mean extracting them at runtime, which is the
  exact pattern §1.3/§3.4 avoids on purpose.

### 3.2 The renderer↔Go IPC mechanism

Wails' binding system is the rough analogue of Tauri's `invoke`, and the whole control-plane surface
has to land on it. Open:

- **How do the 61 wire-protocol channels map onto Wails bindings?** One Go method per channel, a
  handful of service structs matching today's 14 `src/main/ipc/*` modules, or one generic dispatch
  method with a discriminator? Today's shape — `src/main/ipc/registry.ts` registering 11 handler
  groups against a shared `IpcDeps` — has an obvious Go analogue, but the choice affects the
  generated TypeScript bindings the renderer would consume in place of `window.kira`.
- **Is there a lower-level or streaming primitive that avoids a full JSON round-trip for bulk data
  forwarded from the Node engine, or does the default binding convention marshal everything through
  JSON regardless?** This is the question that decides whether `docs/ARCHITECTURE.md`'s "bulk data
  skips the main process" invariant survives in any form, and whether `docs/PERF.md` §2.1's budgets
  (5.6 ms p50 scroll against an 8 ms budget) hold.

**Partial finding, and how it was obtained — treat as best current knowledge, not settled.**
`wails.io` and `v3.wails.io` are **blocked by this environment's egress proxy** — retried and
reconfirmed on 2026-08-28: both `WebFetch` and a raw `curl` to each domain fail identically, with the
`curl` failing at the CONNECT-tunnel stage with a 403, meaning this is a genuine network-level block
in this sandbox, not a tool-specific restriction. The official documentation has still never been read
from here. Reading the v3 runtime source on GitHub directly
(`v3/internal/runtime/desktop/@wailsio/runtime/src/runtime.ts`, `calls.ts`, master branch, read
2026-08-28) shows the default binding transport is a **`fetch()` to a local HTTP endpoint at
`window.location.origin + "/wails/runtime"`, with a `JSON.stringify(...)` body**, whose response is
parsed as JSON when the content type says so and as text otherwise; calls carry a `"call-id"` and are
cancellable. Two things follow, both for the spike to confirm rather than assume:

- The default path **is** a JSON round-trip, so bulk pages would be serialized on the Go side and
  parsed on the renderer side — the same class of cost the Tauri plan was worried about.
- But the same source exposes a `setTransport()` override, and the transport being an HTTP endpoint
  at all suggests a custom asset/HTTP handler serving a non-JSON response body may be reachable. That
  is a *hypothesis* from reading one file of a beta-branch runtime, not a design.

**The spike must verify all of this against Wails' own current documentation and a real build**, from
a machine with unrestricted network access.

**Decided: target Wails v3, beta status accepted.** v3 is the only line this document has any direct
evidence about — the `setTransport()` escape hatch above is the one concrete lead on avoiding a full
JSON round-trip for bulk data, and it does not exist to check in v2. The repo owner accepted v3's beta
status explicitly rather than defaulting to v2's stability. This closes former open question 3 in §5.

### 3.3 The Go↔Node engine transport

New code on both sides, and there is no framework help for any of it.

- **Decided: stdio pipes.** This closes former open question 1 in §5. Rationale: closest to today's
  `stdio: 'pipe'` fork, no filesystem artifact to create or clean up, and the channel's lifetime is
  tied to the child process by construction — the same property `utilityProcess.fork` gives main today.
  A Unix domain socket (independently addressable, easier to reconnect to without restarting the
  child) remains the fallback if the spike finds a concrete reason stdio doesn't work — e.g. if
  `engine-host.ts`'s stdout/stderr-to-`log.ts` pumping needs those streams left free for plain text
  logging rather than shared with framed protocol traffic. Loopback TCP is dropped entirely: a local
  listener is reachable by any other process on the machine and would need a per-launch token neither
  of the other two options requires.
- **Frame the existing protocol.** `PortRequest`/`PortResponse`/`PortEvent` (§2.1) carry over verbatim
  as payload shapes; what they need is a framing layer (length-prefix or newline-delimited) since a
  byte stream has no message boundaries where `postMessage` did. Whether the payloads stay JSON or
  gain a binary encoding for result pages is the same question as §3.2's second bullet, one hop
  earlier.
- **Write the Go side**: spawner, framer, pending-call map, event fan-out, timeout policy — the Go
  equivalent of `engine-host.ts`.
- **Adapt the Node side**: `src/engine/index.ts`'s entry point is built on `process.parentPort` and an
  `attach-port` message carrying a transferred `MessagePortMain`. Under this design there is no port
  to attach and no second channel — control frames and bulk frames arrive over the same transport, so
  the two code paths in that file (the `attach-port` branch driving `activePort`, and the direct
  `kind: 'req'` branch answering over `process.parentPort`) collapse into one. This is the single
  largest change to `src/engine`, and it should stay confined to `index.ts`: `control.ts`, `rpc.ts`,
  `data.ts` and every adapter should not need to know the transport changed.
- **Decide whether the renderer↔engine path stays direct in any form.** Today it genuinely bypasses
  main. Under this design the only channel out of the webview is Wails' own bridge, so bulk data
  necessarily transits the Go process. Whether Go can forward it without a full parse-and-reserialize
  is what §3.2 is really asking.

### 3.4 Packaging and signing

**Vendoring a real Node runtime (§1.2) is the deliberately chosen alternative to single-file
compilation, and it is a security/packaging improvement, not merely a size trade-off.** Because
install size is not a concern (§1.3), every executable and every native module — the Go binary, the
vendored Node binary, the Kafka `.node` addon, the engine's `.js` files — is an ordinary file present
in the signed bundle from build time. **There is no self-extract-to-a-temp-file-then-`dlopen` step at
runtime**, which is exactly the pattern that would have been a hardened-runtime / library-validation
risk under a SEA or `bun build --compile` approach.

This is also **the same shape Electron's own packaging already does successfully today**: Electron
already vendors a real Node binary, and `electron-builder.yml` already `asarUnpack`s and ships this
exact Kafka `.node` addon, both already signed as part of the existing pipeline. A well-trodden
pattern, not a novel risk.

The residual cost, stated plainly:

- **Two separately-signed executables in the bundle** — the Go binary and the vendored Node binary —
  with the Kafka addon and any other native modules swept into the same signing pass as ordinary
  bundled dylibs. Nested executables generally need their own signature.
- **Wails has no built-in automation for signing a second embedded binary** the way Tauri's sidecar
  tooling would have (§3.1). A custom `codesign` step in the build script is required, not optional.

What today's baseline is, to contrast against: `electron-builder.yml` (asar with `asarUnpack` for
`out/main/engine.js` and the Kafka `.node`; `identity: '-'` ad-hoc; `hardenedRuntime: false`;
`electronLanguages: ['en']`; dmg+zip arm64; `minimumSystemVersion: '13.0'`; five `electronFuses`),
plus `scripts/verify-packaging.sh` (150 lines — static checks S1–S7, artifact checks A1–A6 against
`dist/mac-arm64/Kira Studio.app`). What its equivalent would need to become:

- **S1–S5** (no updater dependency, no updater code in `src/`, `dmg.writeUpdateInfo: false`, no
  publish configuration, packaging scripts cannot publish) are runtime-independent and should survive
  almost verbatim.
- **S6/S7** are about `electronFuses` and have no Wails analogue — but *what they protect against*
  (the shipped app being usable as a general-purpose Node runtime, honoring `NODE_OPTIONS`, accepting
  `--inspect`) applies **more** to a bundle that vendors a real `node` binary, not less. That is a
  real hardening question this design creates and owes an answer to, not a line item to delete.
- **A1/A2** (no `latest*.yml` feed, no `.blockmap`) are electron-builder artifacts and go away.
- **A3** (ad-hoc signature) becomes a check over *both* executables, not one bundle root.
- **A4** (`engine.js` unpacked outside the asar) becomes "the engine's `.js`, its `node_modules` and
  the vendored `node` binary are present at their expected paths inside the bundle."
- **A5** (`CFBundleIdentifier == com.kirathecat.kira-studio`) survives as-is.
- **A6** (the Kafka `.node` is unpacked, and only there) becomes "the Kafka `.node` is present beside
  the engine's `node_modules`, built for the vendored Node's ABI, and signed."

The spike should also produce a **headline app-size and cold-start number** next to Electron's own
(`docs/PERF.md` L-D records 252 MB for today's `--dir` arm64 build). §1.3 says size is not a
constraint, but the number is still worth having in the report.

### 3.5 Credential storage — resolved as a seam, not merely relocated

Under the deleted Tauri plan this was the one place the architecture had to bend: the sidecar owned
the credential *row* while only Rust could make the OS-keychain *call*, so a small privileged
cross-process surface was unavoidable. **That seam does not exist here.** `secret-cipher.ts`'s logic
moves into the same Go process that owns `storage/repos/secrets.ts` and the SQLite database, so
Keychain access is ordinary in-process Go code.

What still has to be designed:

- **Which library.** Candidates, **unverified / best current knowledge**: `zalando/go-keyring` (thin,
  shells out to the platform's own tooling on macOS) and `99designs/keyring` (broader backend
  abstraction, includes a file-backed backend). Which fits best — and whether either is a good idea
  versus calling the macOS Security framework directly via cgo — is a spike question.
- **Preserve `SecretStorageStatus`'s existing contract.** `src/shared/domain/secrets.ts` defines it as
  `{ available, backend: 'keychain'|'basic_text'|'unavailable', insecureFallback, reason }`, probed
  once at startup and never changing for the life of the process. `tests/e2e/secrets.spec.ts`'s
  scenario 1 asserts `true`/`'keychain'` on darwin and fails loudly rather than skipping. The renderer
  shows `reason` verbatim in the connection dialog.
- **An equivalent to the `KIRA_INSECURE_SECRETS` Linux dev fallback** (P25 D13, documented in
  `AGENTS.md`). Linux is never a supported platform for this app — it is this repo's dev/CI
  environment only — but every password-bearing test needs *something* there, or the suite loses its
  dev environment. Today that something is Chromium's `basic_text` obfuscation via `safeStorage
  .setUsePlainTextEncryption(true)`, which has no Go analogue and would need to be invented (a
  hardcoded-key obfuscation in Go, or a file-backed keyring backend). What this becomes depends on
  what this repo's Go-based dev/CI story turns out to be, which is itself undesigned.
- **The envelope format.** `kira:v1:<base64>` and P25 D10's pre-P25-plaintext passthrough
  (non-enveloped values are returned verbatim). Per §1.4 there is no obligation to read old rows — so
  this is a chance to simplify, not a constraint. The spike should say explicitly whether the envelope
  and the passthrough survive or are dropped.

### 3.6 Crash blast radius returns to today's already-accepted shape

`src/main/engine-host.ts`'s exit handler states today's policy in its own comment: on engine exit,
every pending call is rejected with `E_ENGINE_DOWN` and `main/connections.ts` synthesizes error states
for every connection it believed live — *"No auto-respawn (§13.2 of the P1 plan): the user reconnects
manually."*

Under the **deleted** Tauri plan, that policy was in real trouble, because the sidecar owned settings,
layout, tabs, saved queries and the op log as well as the drivers — losing it meant not "reconnect
your databases" but "the app cannot save anything," and the plan had to open a supervised-restart
question it could not close.

**Under this architecture that regression is gone.** Settings, layout, tabs, saved queries, the op log
and all window state live in the Go process. Losing the Node engine child means exactly what it means
today: reconnect your databases. This is a concrete improvement over the earlier design and should be
recorded as one.

What the spike still has to confirm, since none of it is free:

- That the no-auto-respawn policy translates cleanly to a Go-hosted spawner — including that a dead
  child is detected promptly (`cmd.Wait()`, not a poll) and that every pending call is failed with the
  same `E_ENGINE_DOWN` code the renderer already branches on.
- What replaces the `before-quit` flush handshake (`src/main/index.ts:152`, `IPC.appFlushBeforeClose`
  / `IPC.appFlushed`, 2 s timeout) in Wails' own lifecycle hooks.
- That `execArgv: ['--max-old-space-size=…']` — today's engine memory cap, a user-facing setting
  (`advanced.engineMemoryCapMb`, `src/shared/domain/settings.ts:31`, default 512, range 256–4096) —
  survives verbatim. It should: a real `node` binary spawned by `os/exec` takes the same flag. Worth
  confirming rather than assuming, and worth noting as a point in this design's favor over any
  non-Node runtime.

### 3.7 RAM footprint — expected between the extremes, and it must be measured

The honest expectation is that this design lands **between** "everything in Node" and "everything in
Go," and the spike must produce a real number rather than reason to one. The inputs, each labeled with
what it actually is:

- **The Go core itself is small.** Independent benchmarks put a comparable Tauri Rust core around
  ~5 MB, with almost all of a reported Tauri/Wails app's memory being **the OS webview** — a cost
  identical for any framework embedding the system webview, and not something this design changes.
  *Generic third-party figure, not measured for this app, and Go's runtime is not Rust's.*
- **The vendored Node runtime carries its own baseline** — commonly cited around ~30–50 MB for a bare
  Node process. *Generic figure, not measured for this app.*
- **The engine's own logic has a real, measured number from this app's own history.** `docs/PERF.md`
  §2.2's "app's own loaded delta" of **≈25–97 MB** across processes is a legitimate anchor precisely
  because it is this exact code, already profiled on this app. (§2.2 also records the engine's own
  baseline RSS dropping ~151 MB → ~119 MB when `adapters/registry.ts` went lazy — that lazy-loading
  behavior carries over unchanged, since the engine is not being rewritten.)
- **Against Electron's current ≈620–626 MB baseline** (`docs/PERF.md` §2.2), zero connections, zero
  tabs.

**None of the Go / Wails / vendored-Node numbers are measured.** The spike's deliverable must include
a real measurement taken with the **same OS-level instrument this repo's other perf work uses**, not
vendor-published or generic-benchmark figures — and note that `app.getAppMetrics()`, which
`docs/PERF.md` §2.2 and `src/main/index.ts:121` both depend on, is Electron-only and has no analogue
here. Finding the replacement instrument is part of the work, and it is also what the app's own
status-bar CPU/memory readout (`IPC.appMetrics`) needs, not just the tests.

### 3.8 E2E testing — decision carried over, not reopened, and the spike's first step

**Decided: this is the spike's literal step one**, ahead of the transport and packaging work in
§3.2–§3.4 — the same sequencing the deleted Tauri plan used for `tauri-driver`'s macOS support. This
closes former open question 2 in §5. Not because the E2E decision below is contingent on the answer —
it isn't, it is unconditional either way — but because it is cheap to confirm and it is the same class
of finding that closed P20 outright, so it belongs at the front of the report rather than the back.

Wails also embeds the system webview (WKWebView on macOS), so it inherits the same problem: **Apple
ships no WebDriver server for WKWebView.**

What could be established from here, and how — `wails.io` and `v3.wails.io` are **egress-blocked in
this environment, reconfirmed 2026-08-28** (§3.2) — so this comes from GitHub and search results, not
official docs:

- **No first-party Wails WebDriver story surfaced.** The closest thing is discussion `wailsapp/wails`
  #4205, *"[v2] end-to-end testing?"*, where the recommended approach is to run `wails dev` and point
  **Playwright at `http://localhost:34115`** — the dev-mode URL that exposes the app, backend bindings
  included, in an ordinary browser. Commenters asked for real documentation; the discussion is not
  closed with any. *Treat as best current knowledge; confirm directly at spike time.*
- That dev-mode-in-a-browser path is interesting but is **not** shell-integration coverage — it is a
  browser against dev bindings, with no native window, menu or lifecycle in the loop.

**The decision is the same one the deleted plan already made, restated for this architecture and not
reopened: the UI test suite moves fully to Playwright's isolated `webkit` tier** — a hand-built
stand-in for the frontend↔backend bridge, no real native shell in the loop — **unconditionally**, not
contingent on whatever Wails' own driver story turns out to be. Today's 23 `tests/e2e/` specs and
P50's 7 `tests/ipc/*/*.frontend.spec.ts` specs (which run in a real `_electron.launch()` window) are
retired, not ported.

**What is permanently lost, stated plainly rather than left implied:**

- Native menu / window / lifecycle integration coverage.
- The real IPC bridge's correctness — whatever §3.2 picks, nothing exercises it once the tests fake it.
- Real Keychain / credential-flow coverage (§3.5), including `secrets.spec.ts`'s darwin guard.
- `src/main/security.ts`'s navigation-lock and capability-denial posture, presumably reimplemented as
  Wails' own CSP/security configuration and then covered by nothing.

**What survives:** P50's **backend** tier. It never opens a window today — it uses
`ELECTRON_RUN_AS_NODE=1 electron` purely as an ABI-correct Node — and under this design it runs
against the engine on plain, real Node, which is if anything simpler than today.

**What loses its subject entirely, independent of the testing decision:** `budgets.spec.ts`,
`perf.spec.ts` and `startup.spec.ts` are built on `app.getAppMetrics()` and
`app.evaluate(() => process.uptime())` — Electron-only (§3.7).

### 3.9 Framework maturity — an accepted trade-off, not a question

Wails is a **smaller, less mature project than Tauri**: fewer contributors, a thinner plugin ecosystem,
no first-party sidecar support (§3.1), and a v3 line still in beta while v2 is the stable one. This is
a real cost and the plan names it as one. **It is not for the spike to relitigate** — the repo owner's
preference for Go over Rust is a premise (§0), and this is the price of it. What the spike *should* do
is note concretely where the thinner ecosystem actually bites this app (sidecar bundling, second-binary
signing, testing story, keychain access) rather than restating the general point.

### 3.10 Per-module disposition — enumerated, not performed

A full triage is future work; the spike's report owes a per-module disposition for:

```
src/main/          index.ts  window.ts  menu.ts  log.ts  env.ts  security.ts
                   connections.ts  engine-config.ts  engine-host.ts  oplog.ts
                   preconnect.ts  secret-cipher.ts  tree-service.ts
src/main/ipc/      app.ts  connections.ts  deps.ts  engine.ts  errors.ts  files.ts
                   filters.ts  layout.ts  ops.ts  queries.ts  registry.ts
                   settings.ts  tabs.ts  tree.ts
src/main/storage/  db.ts  migrate.ts  paths.ts  migrations/ (5)  schema/ (9)  repos/ (10)
src/preload/       index.ts
src/engine/        index.ts  (transport entry point only — see §3.3)
```

Under §1.1 the expected answer is **"Go"** for every entry above `src/engine/`, with
`src/preload/index.ts` disappearing into §3.2's bridge and `src/engine/index.ts` being the one engine
file that changes at all. **That expectation is a hypothesis for the triage to confirm or overturn,
not the triage's result** — `src/main/ipc/errors.ts`'s `[CODE] message` folding convention, which the
renderer branches on, and `src/main/storage/db.ts`'s 200-entry statement cache are two places where
"rewrite it in Go" hides a real design decision.

## 4. Explicitly out of scope for this document

- No Go toolchain, Wails CLI, or any dependency installed; nothing built, nothing run.
- No scaffold created; no code change under `src/`, `tests/` or `scripts/`.
- No `package.json`, `go.mod` or lockfile change; no dependency added or removed.
- **No per-module triage performed** — §3.10 enumerates the inputs only.
- **No benchmark, no measurement, no memory, size or startup number produced** for Wails, Go, or a
  vendored Node runtime. §0.1/§3.7's numbers are quoted from `docs/PERF.md`'s existing Electron
  record, not re-measured.
- **No claim about Wails' own behavior is presented as verified** beyond the three things §3.1, §3.2
  and §3.8 name explicitly along with how they were obtained (a GitHub discussion, one file of the v3
  runtime source, and a second GitHub discussion) — and note that `wails.io`/`v3.wails.io` are
  **blocked by this environment's egress proxy**, so the official documentation was never read.
  Everything else is best-current-knowledge for a spike stage to confirm directly.
- **The incremental adapter-migration path (§1.5) is not designed here.** Naming it as the natural
  future direction is the whole of this document's treatment of it. No dispatch layer, no per-kind
  ordering, no Go adapter interface.
- Backward compatibility with existing `kira.sqlite` rows is out of scope by decision (§1.4), not by
  omission.

## 5. Open questions for the repo owner

Most of what the deleted plan asked is answered by §1's premises. Three of the original four were
resolved in review after this document's first draft; one genuinely remains open.

**Resolved:**

1. ~~Should the E2E/testing finding for Wails be checked before any other spike work?~~ **Yes —
   decided. This is the spike's literal step one (§3.8).**
2. ~~Wails v2 (stable) or v3 (beta)?~~ **v3, beta status accepted (§3.2).** The `setTransport()` lead
   on avoiding a JSON round-trip for bulk data only exists on v3.
3. ~~Which Go↔Node transport should the spike prototype first?~~ **stdio pipes (§3.3).** A Unix domain
   socket remains the named fallback if stdio proves unworkable for a concrete reason (e.g. contention
   with `engine-host.ts`'s stdout/stderr-based logging path) — not a coin flip to revisit casually.

**Still open:**

4. **Is there a macOS arm64 machine available for the spike at all?** `docs/PERF.md` §3's manual
   procedures remain unfilled for exactly this reason, and P20's §8 Q1 asked the same thing. A
   Linux-only investigation cannot answer §3.4, §3.5 or §3.7 — and this environment cannot even reach
   Wails' own documentation: confirmed three times now (§3.2, §3.8), and per this session's own proxy
   guidance a 403 is an organizational policy denial, not a transient failure, so a different network
   environment is required, not another retry.

## 6. Decision gate

The eventual spike's deliverable is a **written report**, committed alongside this plan, covering:

- **§3.8's E2E/WebDriver finding, checked first**, before any transport or packaging work — per §5's
  resolved sequencing decision.
- Every other open question in §3, answered against a **real Wails build and Wails' own current
  documentation** rather than inference, wherever that is possible.
- A concrete **design for the renderer↔Go bridge** (§3.2) and for **bulk data** — including whether
  `docs/ARCHITECTURE.md`'s "bulk data skips the main process" invariant survives in any form, and a
  stated cost against `docs/PERF.md` §2.1's budgets if it does not.
- A concrete **design for the Go↔Node engine transport** (§3.3), including exactly what changes in
  `src/engine/index.ts` and confirmation that nothing else in `src/engine` has to change.
- A concrete **bundling, packaging and signing story** (§3.4), with the resulting app size and
  cold-start numbers next to Electron's, and a stated answer to the `electronFuses`-equivalent
  hardening question a vendored `node` binary creates.
- A **real memory measurement** (§3.7) taken with a named OS-level instrument, against
  `docs/PERF.md` §2.2's ≈620–626 MB Electron baseline — not a vendor or generic-benchmark figure.
- The **per-module disposition** (§3.10), completed.
- A plain enumeration of everything that gets *worse*, not just what gets better — the memory number
  is the only thing this migration is for, and a report that only lists wins is not usable for a
  decision.
- An explicit **go/no-go recommendation**.

**No implementation phase starts until the repo owner has reviewed that report and signed off.** This
document scoped the spike; `docs/v1/plans/P51-spike-report-part1.md` is that report's first
installment, covering everything answerable without a macOS machine. Signing off on *this plan*
authorized starting the spike — it is not, on its own, sign-off on the go/no-go recommendation the
finished report will eventually make, which still needs §3.4/§3.5/§3.7 and a macOS machine before
it can be written.
