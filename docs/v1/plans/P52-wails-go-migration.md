# P52 — Wails (Go) migration: the implementation plan

> This document supersedes `docs/v1/plans/P51-wails-go-node-engine-spike.md`'s **"plan only, no
> implementation"** status *for implementation purposes*. P51 and its four report installments stay
> exactly as written — they are the evidence base this plan is built on and are not revised here.
> What changes is the gate: **the repo owner has explicitly signed off on starting the migration
> (2026-08-28), accepting that P51 §3.5 (Keychain library) and §3.7 (a real RAM measurement) are
> still open.** §3.5 is **resolved by this document** (§6). §3.7 is **not resolved by this document
> and must not be treated as if it were** — it is resolved, for real, by this phase's own first
> milestone (§3, gate **G1**), before any of the ~3 600 lines of `src/main` business logic are
> ported. If G1 comes back unfavourable, the correct outcome is to stop, and this plan is
> deliberately sequenced so that stopping there costs a scaffold and nothing under `src/`.
>
> Everything in P51 §1 (the decided architecture) remains a **premise**. This plan designs against
> it; it does not reopen it.

## 0. Framing

### 0.1 What is actually being done

All of `src/main` (51 `.ts` files / 3 567 lines + 5 `.sql` migrations) is rewritten in Go, inside a
Wails v3 application that is also the native shell. `src/preload/index.ts` (161 lines) is deleted;
the renderer reaches the platform through Wails bindings instead. `src/engine` (119 files /
14 743 lines) is **not** ported — exactly one file's transport entry point changes
(`src/engine/index.ts`, 56 lines, see §7.3). `src/renderer` (182 files / 33 027 lines) keeps its
components, stores and views; only `src/renderer/bridge/` is rewritten.

The **sole justification** for any of this is `docs/PERF.md` §2.2: ≈620–626 MB of baseline
Chromium/Electron process overhead with zero connections and zero tabs, against SPEC §2's 350 MB
budget, which no app-level lever reaches (`tests/e2e/memory.spec.ts` was removed rather than kept
red, `d23121e`). Everything else this migration touches gets *worse* or stays flat — §11 enumerates
that honestly. If the memory number does not move, there is no case for the work, which is why the
number is measured first.

### 0.2 The one gate that can stop this phase

**G1, at the end of P52 (§3.3).** A minimal Wails+Go+vendored-Node build, measured for real RSS
against §2.2's 620–626 MB, with explicit go / amber / no-go thresholds and a named OS-level
instrument. Nothing under `src/`, `tests/` or `scripts/` is modified before G1 passes. The Electron
app remains the shipping app, untouched and buildable, at G1 time and for every phase after it up
to the cutover.

This ordering is not a formality. P51 §3.7's own inputs are three generic third-party figures and
one measurement of a *different* runtime; the honest position going in is that **nobody knows what
this build's RSS is**, and it is entirely possible the system-webview saving is smaller than the
vendored-Node cost that replaces Electron's own embedded Node. That possibility has to be cheap.

### 0.3 Granularity: six phases, one set of decisions

A 3 600-line rewrite is not one phase. Per `AGENTS.md`, genuinely separate chunks of work get
separately-numbered phases (P4–P12 were split that way), and each phase gets its own Opus plan
committed before implementation.

This document is therefore **both**:

1. **The full plan for P52** — the Go scaffold, the walking skeleton, and gate G1. Implementable
   directly from §3 with no further planning.
2. **The binding architectural record for P53–P57** — every decision P51 §3.10 flagged, plus the
   bridge design, the storage design, the Keychain choice and the project layout, decided once,
   here, so no later session has to make an architectural judgement call mid-implementation.

P53–P57 each still get their own (thin) Opus plan, per `AGENTS.md`, whose job is to sequence the
work against the *then-current* tree and record what that pass found — **not** to reopen §5–§9 of
this document.

| Phase | Delivers | Touches `src/`? |
|---|---|---|
| **P52** (this doc) | Go module + Wails scaffold, walking skeleton, **gate G1** | No |
| **P53** | Go storage core: db, migrations, 10 repos, settings/layout model | No |
| **P54** | Go `EngineHost` + `src/engine/stdio-main.ts` (a second, complete entry point) | One new file |
| **P55** | Go application services: connections, secrets/Keychain, preconnect, tree, files, oplog, metrics | No |
| **P56** | The bridge (61 channels), the `engine` Stream, native shell parity (window/menu/security/lifecycle) | No |
| **P57** | **Cutover**: renderer bridge rewritten, `src/main`/`src/preload` deleted, Electron removed, packaging + test-suite cutover | Yes, extensively |

The Electron app stays whole and shippable through P56. P57 is the only irreversible phase.

## 1. What P51 established that this plan simply uses

Not re-derived. Cited so the implementer knows which claims are load-bearing and where they came
from.

| Fact | Source | Status |
|---|---|---|
| Wails v3 binding model is **service structs**, one Go method → one generated TS export | part 1 (Linux scaffold), part 4 (macOS, real `.app`) | Verified twice, both platforms |
| Default `Call` transport is a JSON `fetch()` POST to `/wails/runtime`, chunked over 512 KB | part 1, from the installed `@wailsio/runtime@3.0.0-beta.15` `dist/` | Verified |
| `Stream()`/`WailsSocket` is real, binary (`binaryType: "arraybuffer"`), non-JSON, 869 lines | part 1 | Verified |
| Go side: `app.HandleStream(name, func(*StreamConn))`, `Send([]byte)` queues **without copying** | part 2, read from `pkg/application/stream.go` in the module cache | Verified (source), not live |
| Stream bounds: 8 MiB / 256 frames per connection, 64 MiB max frame, `ErrStreamFull` signalled never blocked | part 2 | Verified (source) |
| Stream sessions are superseded by page **generation** automatically on reload | part 2 | Verified (source) |
| Go↔Node stdio + 4-byte big-endian length prefix + `PortRequest`/`PortResponse`/`PortEvent` verbatim works | part 1 (`p51-spike-artifacts/gonode/main.go`), part 4 (`enginehost.go` in a real `.app`) | Verified, both platforms |
| `E_ENGINE_DOWN` on child exit fires in ~79 ms via `cmd.Wait()`, not a timeout | part 1 | Measured |
| Kafka's native addon is a **downloaded prebuild** under a vendored Node; no Electron ABI step at all | part 4 (`otool -L`, preserved mtime, loaded in a signed `.app`) | Verified on real hardware |
| `task darwin:package` ad-hoc signs the bundle; the nested `node` binary + `.node` need **four extra `codesign` lines** | part 4 | Verified on real hardware |
| App size 251 MB unoptimised; ~170 MB after dropping `include/` (64 MB) and `lib/node_modules/npm` (17 MB) | part 4 | Measured |
| On Linux, `/wails/runtime` and `/wails/stream/*` are unreachable over plain HTTP — `wails://` scheme interception | part 3 | Verified, Linux only |
| `wails.io`/`v3.wails.io` are 403-blocked from **both** environments; `proxy.golang.org` and `nodejs.org` are not | parts 1–4 | Verified repeatedly |

**One discrepancy the implementer will hit.** Part 4 states its hand-written source "remains under
`docs/v1/plans/p51-spike-artifacts/gonode-macos/`". **That directory does not exist in this
checkout** — `p51-spike-artifacts/` contains only `README.md` and `gonode/`. The reusable reference
is therefore `gonode/main.go` (part 1's prototype: spawner, framer, pending-call map, event
fan-out, `E_ENGINE_DOWN` on exit), which is present and complete. Do not go looking for
`enginehost.go`; it was not committed.

## 2. Project layout, module, and tooling

### 2.1 Where the Go code lives

A new top-level directory **`shell/`** — it names the role (native shell + app core), does not
collide with `src/`, `build/`, `scripts/`, `tests/` or `docs/`, and keeps the Go module's own
`build/` (which `wails3` generates for `Info.plist`, icons and entitlements) from colliding with the
repo's existing `build/`.

Module path: `github.com/kirathecat/kira-studio/shell`.

```
shell/
  go.mod  go.sum
  main.go                     application.New, Services list, window, menu, HandleStream, lifecycle
  Taskfile.yml                wails3's own task file (darwin:build, darwin:package, darwin:codesign:adhoc)
  build/                      wails3-generated: Info.plist, icons, entitlements
  frontend/dist/              renderer build output (git-ignored; see §2.3)
  internal/
    appcore/       deps.go        the Go analogue of src/main/ipc/deps.ts + startup ordering
    config/        paths.go       KIRA_HOME, kira.db, logs/  (src/main/storage/paths.ts)
                   env.go         isDevBuild                 (src/main/env.ts)
    logging/       log.go sweep.go                           (src/main/log.ts)
    storage/       db.go migrate.go
                   migrations/*.sql   (go:embed, the 5 existing files verbatim)
                   model/             Go structs replacing storage/schema/* + the zod row validation
                   repos/             10 files, 1:1 with src/main/storage/repos/
    secrets/       cipher.go status.go keychain_darwin.go keychain_linux.go
    enginehost/    host.go frames.go config.go              (engine-host.ts, engine-config.ts)
    connections/   service.go                               (connections.ts)
    preconnect/    supervisor.go                            (preconnect.ts)
    tree/          service.go                               (tree-service.ts)
    oplog/         wire.go                                  (oplog.ts)
    metrics/       sampler.go                               (replaces app.getAppMetrics())
    shell/         window.go menu.go security.go            (window.ts, menu.ts, security.ts)
    bridge/        app.go connections.go engine.go files.go filters.go layout.go lifecycle.go
                   ops.go queries.go settings.go tabs.go tree.go   (the 12 Wails services)
                   stream.go                                        (the bulk-data Stream handler)
                   events.go                                        (Go→renderer push)
                   ipcerr/errors.go                                 (replaces ipc/errors.ts)
```

The layout deliberately mirrors `src/main/`'s one-to-one so a reviewer can diff the two trees by
name. Where a Go file has no `src/main` counterpart (`metrics/`, `bridge/stream.go`,
`bridge/events.go`) it is because the Electron mechanism it replaces was a framework call, not a
file.

### 2.2 Go dependencies, decided

| Need | Choice | Why this one |
|---|---|---|
| Shell | `github.com/wailsapp/wails/v3` (pin the exact beta, `v3.0.0-beta.15` as of P51) | P51 §3.2, decided; beta accepted by the repo owner |
| SQLite | `github.com/mattn/go-sqlite3` | Links the real, unmodified upstream SQLite amalgamation — the same engine `node:sqlite` embeds — so the 5 existing `.sql` migrations and every repo query behave identically with nothing to re-validate. cgo is already unavoidable (Wails on macOS is cgo, part 4 built that way), so the usual "pure Go avoids cgo" argument buys this app nothing. **Named fallback:** `modernc.org/sqlite` if a cgo/cross-compile snag appears in packaging |
| Keychain | `github.com/keybase/go-keychain` | §6 |
| Process metrics | `github.com/shirou/gopsutil/v4/process` | §8.4 |
| Struct diffs in tests | `github.com/google/go-cmp` | Test-only; the one assertion helper, matching this repo's "one tool, default rules" habit (Biome, Bun) |

No ORM. Drizzle's value here was type-safe schema definitions shared with zod; in Go the schema is
the struct and `database/sql` with hand-written SQL is both smaller and more legible than any Go ORM
would be for 10 repos over 10 tables. Every query is a literal string next to its repo function.

### 2.3 Build tooling and the coexistence window

**Decision: coexist, do not clean-cutover.** `bun`, `electron-vite`, `electron-builder` and every
existing script stay exactly as they are through P52–P56, and the Electron app stays buildable and
shippable that whole time. Reasons, in order of weight:

1. **G1 can fail.** A clean cutover means the tree is mid-rewrite when the number that justifies the
   rewrite arrives. Coexistence means a no-go at G1 costs `shell/` and nothing else.
2. `src/engine` and `src/renderer` — 47 770 lines, 93 % of the tree — are shared by both shells
   unchanged. There is no duplication to pay for.
3. Each of P53–P56 delivers a **complete, tested** Go subsystem verified by Go tests against real
   SQLite / a real engine child. None of them needs the renderer, so none of them needs a
   half-populated bridge with a "not migrated yet" branch in it — which `AGENTS.md`'s no-stubs rule
   would rightly reject.

The renderer is built **twice** during the window, from one source tree: `electron.vite.config.ts`
stays untouched, and a new `vite.wails.config.ts` builds `src/renderer` to `shell/frontend/dist`
with the same aliases, Vue plugin and Tailwind plugin (`bun run build:wails`). Wails' `main.go`
consumes it via `//go:embed all:frontend/dist`, matching the scaffold part 1 built.

New `package.json` scripts, added over the window and surviving into P57:

```
build:wails   vite build -c vite.wails.config.ts
dev:wails     bun run build:wails && cd shell && wails3 task dev
test:go       cd shell && go test ./...
package:wails cd shell && task darwin:package && sh scripts/sign-bundle.sh
```

P57 deletes `electron.vite.config.ts`, `electron-builder.yml`, `scripts/native-electron-build.sh`,
the `electron*` devDependencies, `electron-log`, and every `*:mac`/`dev`/`build` script that names
them.

**Go toolchain in this repo's environments.** Per `AGENTS.md`'s P51 section: `go install
github.com/wailsapp/wails/v3/cmd/wails3@latest` via `proxy.golang.org` (not blocked), Go's own
toolchain auto-upgrades to whatever the module demands, and the Linux sandbox additionally needs
`apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for the CLI's own build. `wails3
task dev`'s first build takes ~60 s — start, poll and tear down inside **one** shell invocation.

## 3. P52 — scaffold, walking skeleton, and gate G1

This is the only phase this document plans to implementation depth. It exists to answer §3.7 as
cheaply as possible.

### 3.1 M0 — scaffold

- `wails3 init` a macOS project into `shell/`, module path per §2.1, `CFBundleIdentifier
  com.kirathecat.kira-studio-shell` (**not** the shipping id — the two apps must be distinguishable
  in Activity Monitor and in the Keychain during coexistence; P57 changes it to
  `com.kirathecat.kira-studio`).
- `vite.wails.config.ts` + `bun run build:wails`, producing `shell/frontend/dist` from the real
  `src/renderer`.
- Vendor a real Node runtime per part 4: `https://nodejs.org/dist/v<pinned>/node-v<pinned>-darwin-arm64.tar.gz`,
  extracted to `shell/runtime/node/`, **`include/` and `lib/node_modules/npm` deleted** (part 4's
  81 MB finding). `shell/runtime/` is git-ignored; a `scripts/vendor-node.sh` fetches and trims it
  reproducibly, and pins the version and SHA-256.
- `.gitignore` entries for `shell/bin/`, `shell/frontend/dist/`, `shell/runtime/`.

**Verified by:** `bun run build:wails && cd shell && task darwin:build` produces a launchable binary
that shows a window. Nothing else.

### 3.2 M1 — the walking skeleton

The smallest thing that is genuinely representative of the finished architecture's *memory*
profile, and nothing more.

- **Go shell**: one `application.New`, one `WebviewWindow`, `OnShutdown` closing the engine child.
- **One representative bound round trip**: a single `AppService.Info()` returning
  `{appVersion, go, node, kiraHome}` — the direct analogue of today's `IPC.appInfo` (`src/main/ipc/app.ts`).
- **The engine child, spawned for real**: `os/exec` on the vendored `shell/runtime/node/bin/node`,
  running a ~40-line `shell/testdata/engine-ping.mjs` that speaks the length-prefixed framing from
  `p51-spike-artifacts/gonode/engine_stub.mjs` and answers exactly one op, `ping`. `execArgv`
  carries `--max-old-space-size=512` (today's `advanced.engineMemoryCapMb` default), so the child's
  heap ceiling matches production.
  **It does not load `src/engine`.** Loading the real engine would measure `registry.ts`'s lazy
  loading, which §2.2 already measured at ~119 MB and which is unchanged by this migration.
- **The metrics sampler** (`internal/metrics`, §8.4) — needed here anyway, and it is the instrument
  G1 is measured with.
- **Two window configurations**, both built, both measured:
  - **(1) Blank.** The webview loads a static page with the one `AppService.Info()` call. This is
    the floor: the cost of Wails + WKWebView + Go + vendored Node, with no app in it.
  - **(2) Real renderer.** `shell/frontend/dist` is the actual Vue app. To boot it, M1 implements a
    small, **complete** read path — `appInfo`, `settingsGetAll`, `layoutGetAll`, `tabsList`,
    `connectionsList`, `connectionsStates`, `engineStatus`, `opsRecent`, `filtersList` — each
    reading from a real Go SQLite database that is empty, so each returns real defaults. These are
    the nine calls the renderer makes on boot; they are not stubs, they are the first nine of §7's
    61 and are written the way §7 specifies, then kept.

Configuration (2) is what §2.2's "zero connections, zero tabs" baseline actually is, and it is the
number G1 is decided on. Configuration (1) exists so that a catastrophic result is visible before
(2) is built at all.

### 3.3 G1 — the gate

**Instrument** (this also closes §3.7's "finding the replacement instrument is part of the work"):

- **Primary:** `internal/metrics`' own sampler (`gopsutil/v4/process`, §8.4), summing
  `MemoryInfo().RSS` over the app's whole process set.
- **Cross-check, mandatory:** `ps -o rss= -p $(pgrep -f 'Kira Studio Shell')` summed by hand, and
  Activity Monitor's Real Memory column for the same set. A single self-reported number is exactly
  what P51 §3.7 warns against; three agreeing numbers is a measurement.
- **The process set is not obvious and getting it wrong invalidates the result.** WKWebView runs the
  page in *separate* system helper processes — `com.apple.WebKit.WebContent`,
  `com.apple.WebKit.Networking`, `com.apple.WebKit.GPU` — which are not children of the Go process
  in the `ppid` sense. They must be included; they are the cost this migration is trying to reduce.
  Match on the app bundle, not on the pid tree.
- RSS double-counts shared pages across processes, exactly as `app.getAppMetrics()`'s
  `workingSetSize` sum does in §2.2. Comparing sum to sum is apples to apples; comparing either to a
  single-process figure is not.
- Method: 10 samples over an idle window after the window is shown and the renderer has settled,
  take the **min** — identical to `memory.spec.ts`'s own removed methodology, so the numbers are
  directly comparable to §2.2's table.

**Thresholds.** §2.2's baseline is 620–626 MB, and its loaded (5 connections / 10 tabs) scenario
adds ≈25–97 MB. SPEC §2's budget is 350 MB *loaded*. So the baseline has to land near ~253–325 MB
for the budget to be reachable at all.

| Result (config 2, min of 10) | Verdict |
|---|---|
| **≤ 300 MB** | **Go.** The 350 MB budget is plausibly reachable once loaded. Proceed to P53. |
| **300–450 MB** | **Amber — stop and ask the repo owner.** A large, real improvement over 620–626 MB, but SPEC §2's budget still fails. Whether that trade is worth rewriting 3 600 lines is the owner's call, not the implementing session's. Write the numbers up, stop, ask. |
| **> 450 MB** | **No-go.** Less than ~28 % off Electron's baseline. The migration's only justification is not met. Write the report, keep `shell/` as a spike artifact or delete it, stop. `src/` has not been touched. |

**Secondary hard check:** the vendored-Node engine child's own RSS at ping-only idle must be
**≤ 150 MB**. Today's engine process baseline is 118.3 MB (§2.2) running the *whole* lazy-loaded
engine; a bare Node answering `ping` measuring worse than that would mean the vendored runtime
itself is the problem, independent of the shell.

**Deliverable, regardless of outcome:** a new `docs/PERF.md` §2.3 recording both configurations,
all three instruments, the process set, the date and the machine — in the same shape §2.2 uses.
A no-go result is a finding, not a failure, and it gets written up with the same care as a go.

### 3.4 What P52 explicitly does not do

No `src/` change. No `tests/` change. No `scripts/` change beyond the two new scripts in §3.1/§2.3.
No `package.json` dependency added or removed (the new scripts only invoke tools already present, or
the Go toolchain, which is not an npm dependency). No storage repos, no bridge beyond the nine boot
calls, no menu, no security posture, no packaging.

## 4. Module-by-module mapping (§3.10, resolved)

"Go" means the file's behaviour is reimplemented in the named Go package and the TypeScript file is
deleted at P57. Line counts re-verified against the current checkout for this document.

### 4.1 `src/main/*`

| File | Lines | Goes to | Notes / decisions |
|---|---:|---|---|
| `index.ts` | 173 | `shell/main.go` + `internal/appcore/deps.go` | Startup ordering preserved exactly: paths → log sweep → open DB → migrate → probe secret cipher → load settings → start engine → connections → tree → push engine config → wire oplog → start metrics → register services → create window. The `upgradeLegacySecrets` step is **deleted** (§6.4). The quit-flush handshake becomes `bridge/lifecycle.go` (§8.3). |
| `window.ts` | 58 | `internal/shell/window.go` | `application.WebviewWindowOptions`; bounds read from `repos/layout` at create, persisted on resize/move behind the same 300 ms debounce, timer cleared on window close (P12 D8). The `did-finish-load` uptime log line survives as a Go `time.Since(start)` at the window's ready event — it is the cold-start measurement point `docs/PERF.md` §3 depends on. |
| `menu.ts` | 127 | `internal/shell/menu.go` | All 14 accelerators, same labels, same ordering. Each item calls `bridge/events.go`'s emitter with the **same channel string** it sends today (`kira:menu:*`, `kira:open-settings`), so the renderer's subscribe wrappers change mechanism only. `role: 'quit'` is **replaced by a custom item** calling `Lifecycle.RequestQuit()` (§8.3). Dev-only items gated on `config.IsDev()`. |
| `log.ts` | 45 | `internal/logging/` | `electron-log` → `log/slog` with a file handler at `logs/kira-YYYY-MM-DD.log`, scoped via `slog.With("scope", …)`. The 30-day mtime-based sweep ports verbatim, still best-effort and still never blocking startup. The engine child's stdout/stderr keep being pumped into the same sink (`enginehost` writes them at `info`/`error` under scope `engine`), preserving the single-log-file property. |
| `env.ts` | 4 | `internal/config/env.go` | `app.isPackaged` → whether the executable sits inside a `.app` bundle. |
| `security.ts` | 60 | `internal/shell/security.go` | See §9. Most of this file's content **has no analogue and is deleted, not ported** — that is a real loss, stated in §11. |
| `connections.ts` | 409 | `internal/connections/service.go` | Largest single file. Every behaviour in it is state machinery with no Electron dependency: the in-flight-connect dedupe map (D11), the three-state password convention (`null` unchanged / `''` clear / non-empty replace), the URI password strip/inject, the `emitListChanged` broadcast, `markAllErrored` on engine exit, the preconnect `arm()` race handling (D7). Go: a struct with a `sync.Mutex`, `map[string]ConnectionState`, and `singleflight`-shaped dedupe implemented with a `map[string]*connectAttempt` (do not add `golang.org/x/sync` for this; it is nine lines). |
| `engine-config.ts` | 33 | `internal/enginehost/config.go` | Verbatim behaviour, including "log the failure, never throw — a settings save must not fail because the engine is mid-restart." |
| `engine-host.ts` | 115 | `internal/enginehost/host.go` | §7.3. `gonode/main.go` is the reference shape. |
| `oplog.ts` | 114 | `internal/oplog/wire.go` | Verbatim, including the 500-op prune counter and the `engine:down` reconciliation that finishes in-flight rows as `error` (P12 F10). |
| `preconnect.ts` | 237 | `internal/preconnect/supervisor.go` | `spawn('/bin/sh', ['-c', cmd], {detached: true})` → `exec.Command("/bin/sh", "-c", cmd)` with `SysProcAttr{Setpgid: true}`, so the existing `process.kill(-pid)` process-group kill maps to `syscall.Kill(-pgid, …)` unchanged. The 2 s settle window, the SIGTERM→SIGKILL 2 s escalation, the stderr tail tracker (including its chunk/newline carry logic), the `dead`-before-`arm()` case and the "self-inflicted kills never fire onExit" rule all port literally. Note the `PATH` augmentation (`:/usr/local/bin:/opt/homebrew/bin`) must survive — it is why Homebrew-installed tools work in a pre-connect script. |
| `secret-cipher.ts` | 111 | `internal/secrets/` | §6. **Not a straight port** — the cipher, the envelope and the pre-P25 passthrough all change. |
| `tree-service.ts` | 154 | `internal/tree/service.go` | Cache-aside for `children`/`describe`/`definition`; the schema-mismatch drop, the truncated-listing rules (P43 iter2 D22, iter3 D38), and `DisconnectedError` → an `ipcerr` with code `E_DISCONNECTED`. The zod `safeParse` guards become Go `json.Unmarshal` into the model structs plus explicit validation; a parse failure drops the cached row exactly as today. |

### 4.2 `src/main/ipc/*` → `shell/internal/bridge/*`

One Go service struct per today's handler module, per part 1/part 4's confirmed service-struct
binding model. Eleven modules become twelve services (a new `Lifecycle` service, §8.3).

| File | Lines | Becomes | Notes |
|---|---:|---|---|
| `registry.ts` | 28 | `main.go`'s `Services: []application.Service{…}` | The scaffold's own shape; part 1 confirmed it. |
| `deps.ts` | 11 | `internal/appcore/deps.go` | One `Deps` struct (`DB`, `EngineHost`, `Connections`, `Tree`, `Secrets`, `Log`, `Events`), embedded by value into each service struct at construction. |
| `errors.ts` | 27 | `internal/bridge/ipcerr/errors.go` | **Not a straight port — the `[CODE] message` folding is retired.** See §5.3. |
| `app.ts` | 13 | `bridge/app.go` | `AppService.Info()`. `electron`/`chrome` version fields are replaced by `go`/`wails`/`webkit`; `node` becomes the vendored runtime's version, read from the child at startup. |
| `connections.ts` | 46 | `bridge/connections.go` | 12 methods. |
| `engine.ts` | 7 | `bridge/engine.go` | `EngineService.Status()`. |
| `files.ts` | 54 | `bridge/files.go` | Wails' own dialog API replaces Electron's `dialog`. The `basename()` guard on an S3 key containing `/` must survive — it is a real bug fix, not boilerplate. The invariant this file exists for (the *path* crosses the bridge, the bytes never do) is unchanged. |
| `filters.ts` | 23 | `bridge/filters.go` | 2 methods. |
| `layout.ts` | 10 | `bridge/layout.go` | 2 methods. |
| `ops.ts` | 20 | `bridge/ops.go` | 2 methods. |
| `queries.ts` | 87 | `bridge/queries.go` | 9 methods. |
| `settings.ts` | 24 | `bridge/settings.go` | Keeps the `settingsChanged` broadcast-after-write (the gap it closes is real) and the conditional `pushEngineConfig` on `cache.l2BudgetMb`. |
| `tabs.ts` | 16 | `bridge/tabs.go` | 2 methods. |
| `tree.ts` | 36 | `bridge/tree.go` | 4 methods. |

Argument validation: every service method takes a **typed Go struct** parameter rather than
`unknown`, which removes the per-handler zod `.parse()` calls outright — Wails unmarshals into the
struct and a shape mismatch fails at the boundary. Semantic validation that zod was doing beyond
shape (`limit` positive, non-empty ids) becomes an explicit guard at the top of the method, returning
an `ipcerr` with code `E_BAD_REQUEST`. This is not a loosening: it is the same trust boundary,
enforced by the type system plus one explicit check instead of a schema object.

### 4.3 `src/main/storage/*`

| File(s) | Becomes | Decisions |
|---|---|---|
| `db.ts` (109) | `internal/storage/db.go` | **The 200-entry statement cache is not ported.** See §5.4. |
| `migrate.ts` (32) | `internal/storage/migrate.go` | Same forward-only `schema_version` runner, same refusal on a version newer than the binary knows. |
| `migrations/*.sql` (5) | `internal/storage/migrations/*.sql`, `go:embed`ed | **Copied byte for byte.** They are plain SQLite DDL with no dialect issue, and keeping them identical means the Go schema is provably the same schema, which is worth more than the tidiness of collapsing five files into one. |
| `paths.ts` (26) | `internal/config/paths.go` | `KIRA_HOME` honoured identically; dir `0700`, db file `0600`, both via explicit `os.Chmod` after `MkdirAll` (Go's `MkdirAll` mode is umask-masked exactly as Node's is). **The database filename changes to `kira.db`** — see §5.1. |
| `schema/*` (9 files) | `internal/storage/model/` | Plain Go structs with `json` tags. Per P51 §1.4 there is no obligation to replicate zod's six `.default()` calls; the settings loader's own per-leaf fallback (`sectionFromStore`) is what actually provides forward compatibility and **is** ported, because it is the mechanism that makes a settings row written before a key existed still work. |
| `repos/*` (10 files, 46–198 lines) | `internal/storage/repos/` | Mechanical. `secrets.go` carries §6's envelope change; `ops.go` carries §5.4's `pruneOps` rewrite; `settings.go` and `layout.go` keep the per-leaf JSON-value-per-row storage shape (not a blob per section) for the reason `settings.ts`'s own comment gives. `recentOps`'s legacy `'ddl' → 'definition'` coercion is **dropped** — it exists for rows written before P19 and §1.4 removes any obligation to them. |

### 4.4 `src/preload/index.ts` (161) and `src/engine/index.ts` (56)

- **`src/preload/index.ts` is deleted at P57.** Its two jobs — exposing `window.kira` over
  `contextBridge`, and relaying the `MessagePort` out through `window.postMessage` because a port
  cannot cross the bridge — both disappear. Wails' generated bindings are the exposure mechanism;
  §7.2's Stream is the port replacement, and it needs no relay because it is created inside the page.
- **`src/engine/index.ts` is replaced, not edited.** A new `src/engine/stdio-main.ts` is added in
  P54 as a **second, complete** entry point over the same `control.ts`/`rpc.ts`/`cache` modules
  (§7.3). Both entry points are whole and independently built for the duration of the coexistence
  window; P57 deletes `index.ts`. This is deliberately not an `if (transport === …)` branch inside
  one file — a temporary conditional in the engine's entry point is exactly the kind of half-state
  `AGENTS.md` rules out, and two small complete files cost less than one file with a mode flag.
- Nothing else under `src/engine/` changes. Re-verified for this document: `index.ts` is the only
  file there importing anything from `electron` (`import type { MessagePortMain }`, type-only).

## 5. Storage decisions

### 5.1 The database file is renamed, and old data is not read

Per P51 §1.4, backward compatibility with existing `kira.sqlite` rows is explicitly not required.
The Go build therefore opens **`~/.kira-studio/kira.db`**, not `kira.sqlite`.

This is a better answer than either alternative. Refusing to start on an old file punishes the user
for the migration; renaming their file behind their back destroys their only copy. A different
filename means the Electron build and the Go build can both run on the same machine during the
coexistence window without colliding, and a user who wants their old connections back can still open
the old app. Post-cutover `kira.sqlite` is simply never read again, and nothing deletes it.

`logs/` is shared — both builds write `kira-YYYY-MM-DD.log` to the same directory with the same
30-day sweep, which is correct: they are the same app's logs.

### 5.2 Driver and connection settings

`mattn/go-sqlite3` (§2.2), one `*sql.DB` with `SetMaxOpenConns(1)`. This app's database is a small,
single-writer configuration store; serialising every statement onto one connection removes the
`SQLITE_BUSY` class of bug entirely and costs nothing measurable at these row counts. The four
startup pragmas port verbatim (`journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`,
`busy_timeout = 5000`) — `busy_timeout` becomes near-redundant under `MaxOpenConns(1)` but stays,
because WAL still admits an external reader (a developer with `sqlite3` open).

### 5.3 `src/main/ipc/errors.ts`'s `[CODE] message` folding: **retired**

P51 part 1 flagged this as a hidden decision. Confirmed here by reading the consumers, not just the
producer:

- The folding exists solely because Electron's IPC error serialisation preserves only `.message`
  (the file's own comment says so). Wails has no such constraint.
- **Nothing in `src/renderer` parses the `[CODE] ` prefix.** Grepped for this document: the only
  code-based branching is `views/shared/viewOp.ts`'s `classifyLoadError`, which reads `err.code` —
  and `err.code` is set by `renderer/bridge/port.ts` from the **port** channel's structured
  `PortResponse.error.code`, never from a folded control-channel message. The prefix's only observed
  effect today is that it appears verbatim in user-facing error text.

So the folding is retired, and the control channel gains the structured error shape the port channel
already has. Concretely:

- `internal/bridge/ipcerr` defines `type Error struct { Code, Message string }` implementing Go's
  `error`, whose `Error()` returns the **JSON encoding** `{"code":"…","message":"…"}`.
- Every bound service method returns `(T, error)`; every error path returns an `*ipcerr.Error`. One
  helper per code (`ipcerr.Disconnected(name)`, `ipcerr.EngineDown()`, `ipcerr.BadRequest(msg)`,
  `ipcerr.SecretStore(msg)`, …) so a bare `errors.New` never reaches the boundary.
- On the renderer side, **one** place — the new `bridge/control.ts` wrapper — catches, attempts
  `JSON.parse` on the message, and rebuilds `Error(message)` with `.code` attached. A message that
  does not parse becomes `{code: 'E_INTERNAL', message: <text>}` rather than being silently dropped.

The result: `classifyLoadError` works unchanged for both channels, `DISCONNECTED_CODES` keeps
matching, and displayed errors lose the `[E_QUERY] ` prefix. Net simplification, and a small UX
improvement.

P51 part 2 read that Wails' own error path preserves a `cause` field on the reconstructed JS error.
If that holds at implementation time, the implementer may carry `{code, message}` in `cause`
instead of in the message string — **the single renderer-side parse point makes that a two-line
change**, and the design deliberately does not depend on an unverified detail of a beta runtime.

### 5.4 `src/main/storage/db.ts`'s 200-entry statement cache: **not ported, and the reason it existed is removed**

The other hidden decision P51 part 1 flagged. Resolved by attacking the cause rather than porting
the workaround:

- The cache exists because `node:sqlite`'s `prepare()` recompiles on every call and Drizzle emits a
  small stable set of SQL strings. In Go there is no Drizzle: every query is a literal string in its
  repo function, and the handful that are genuinely hot (settings read, layout read, tabs list,
  op-log append/finish) are held as `*sql.Stmt` prepared once at `openDb` and kept for the process
  lifetime, on the repo struct. Everything else uses `db.Query`/`db.Exec` directly; at this app's row
  counts that is not a measurable cost.
- The cache's **cap** exists for one specific reason its own comment names: `repos/ops.ts`'s
  `pruneOps` builds a `notInArray` over up to 20 000 ids, producing a distinct SQL string per
  parameter count — an unbounded set. Confirmed by reading it for this document. That is rewritten
  at source into a single parameterless statement:

  ```sql
  DELETE FROM op_log
   WHERE id NOT IN (SELECT id FROM op_log ORDER BY started_at DESC LIMIT ?)
  ```

  One SQL string, one bound parameter, the same semantics, and no per-call-shape SQL anywhere in the
  Go tree. With that gone there is nothing left for a cap to protect against, and the whole cache
  concept retires with it.

## 6. Credential storage (P51 §3.5) — **resolved**

### 6.1 What `safeStorage` actually does, which is what has to be replaced

This matters because the obvious reading ("store the password in the Keychain") is the wrong
design. `safeStorage` stores a **single symmetric key** as one Keychain item and encrypts values
with it; the ciphertext lives in the app's own database. `secret-cipher.ts` mirrors that exactly:
`encryptString` → base64 → the `connections.password` column, with `storage/repos/secrets.ts` as the
only reader/writer of that column.

Keeping that shape is not conservatism, it is the correct design, for three reasons: one Keychain
item means one authorization decision rather than a prompt per connection; item count and item size
limits become irrelevant; and `SecretStore.copy()` stays a raw column copy that never needs the OS
key at all (P25 D11), which is a real property worth not losing.

### 6.2 The decision

**`github.com/keybase/go-keychain`**, holding one 32-byte random key; **AES-256-GCM** over the
plaintext; base64 ciphertext in `connections.password` under a **`kira:v2:`** envelope.

Keychain item attributes, all of which matter:

| Attribute | Value | Why |
|---|---|---|
| class | `kSecClassGenericPassword` | Same class `safeStorage` uses |
| service | `Kira Studio Safe Storage` | Distinct from the Electron build's own item, so the two coexist during the migration without either being able to read the other's data |
| account | `Kira Studio` | |
| accessible | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | The key must not be restorable from a backup onto another machine — the decrypt-failure message this app already shows ("may have been written on a different machine") is the behaviour we want, not something to work around |
| synchronizable | `false` | The key must never reach iCloud Keychain |

### 6.3 Why this library and not the other two

- **`zalando/go-keyring` — rejected.** Its macOS backend shells out to `/usr/bin/security`. That
  means a process spawn per operation, and — decisively — **it cannot express the two attributes
  above**: the `security` CLI offers no way to set `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` or
  clear `synchronizable`. It also makes `/usr/bin/security` the accessing binary rather than our
  signed app, which is the wrong access-control subject.
- **`99designs/keyring` — rejected as over-broad, not as wrong.** Its macOS backend *is* a
  `Security.framework` binding and would work. But it carries five backends this app will never use
  (pass, kwallet, secret-service, file, keyctl), and its file backend is passphrase-prompting, which
  is not what the Linux development fallback needs (§6.5). Notably, `99designs/keyring`'s own macOS
  path is built on `keybase/go-keychain` — so choosing `keybase/go-keychain` directly is "the
  99designs macOS backend, without the other five."
- **Raw cgo against `Security.framework` — rejected on cost, not on principle.** `keybase/go-keychain`
  *is* that cgo binding, already written, already exercising `SecItemAdd`/`SecItemCopyMatching`/
  `SecItemDelete` with the attribute surface above. Writing it again buys nothing. And the usual
  argument against a cgo dependency does not apply here: Wails on macOS is already cgo (part 4 built
  it that way), so this adds no new build constraint.

**Flagged honestly:** this is a library choice made from prior knowledge of these three packages,
not from a build in this session (P52 §3.4 forbids one). The P53/P55 implementer must pin an exact
version, confirm the attribute API surface against the pulled source under `$GOPATH/pkg/mod`
(`proxy.golang.org` is reachable, `AGENTS.md`), and — if `keybase/go-keychain` turns out not to
expose non-synchronizable generic passwords — fall back to `99designs/keyring`'s macOS backend
rather than to `zalando/go-keyring`, which cannot meet the requirement at all.

### 6.4 Envelope, and what is dropped

- Prefix bumps to **`kira:v2:`**. The cipher genuinely changes (AES-256-GCM under our own key, vs
  Chromium's AES-128-CBC under `safeStorage`'s), so reusing `kira:v1:` would let a v1 value be
  handed to a v2 decrypt and fail confusingly.
- **The pre-P25 plaintext passthrough (P25 D10) is dropped.** `decrypt()` of a non-enveloped value
  now returns an `E_SECRET_STORE` error naming the problem, instead of returning it verbatim.
  §1.4 removes the obligation, and a silent "this looked like plaintext so I returned it" branch is
  worse than an explicit failure in a fresh codebase.
- **`upgradeLegacySecrets` is deleted, not ported** (`repos/secrets.ts`, 30 lines). Its entire
  purpose is upgrading rows written before P25; under a fresh database (§5.1) no such row can exist.
- **AES-GCM's authentication tag is a genuine gain over the current design**: a tampered or truncated
  ciphertext fails to authenticate rather than decrypting to garbage. The existing user-facing
  decrypt-failure message ("It may have been written on a different machine or after a keychain
  reset — re-enter it to fix this connection") is kept verbatim; it is already correct for this case.

### 6.5 `SecretStorageStatus` and the Linux development fallback

The contract in `src/shared/domain/secrets.ts` — `{available, backend: 'keychain'|'basic_text'|'unavailable',
insecureFallback, reason}`, probed once at startup, never changing for the process's life — is
**preserved exactly**, including the literal `reason` strings, which the connection dialog renders
verbatim.

- **darwin**: probe by writing and reading back a canary item at startup. Success →
  `{available: true, backend: 'keychain', insecureFallback: false, reason: null}`. Failure → the
  existing unavailable message, unchanged.
- **linux, `KIRA_INSECURE_SECRETS` set**: `{available: true, backend: 'basic_text',
  insecureFallback: true}`, implemented as AES-256-GCM under a key derived from a **hardcoded
  compile-time constant** — deliberately the same threat model and the same honesty as Chromium's
  `basic_text` (a hardcoded key, not encryption), so the existing warning log line and the existing
  dialog copy stay true. A file-backed keyring is explicitly rejected here: it would *look* more
  secure than it is, and it would need a passphrase prompt in a headless CI container.
- **linux, variable unset**: `{available: false, backend: 'unavailable'}` and a password-bearing
  write is **refused**, exactly as today (P25 D13). This is the behaviour every password-bearing
  test in this repo depends on, and `AGENTS.md`'s secrets section documents it.
- **Any other platform**: unavailable, with today's message.

The `probeStatus` → `createSecretCipher` → one-shot-at-startup shape survives, minus the
Electron-specific "must run after `app.whenReady()`" constraint (electron/electron#45328), which has
no Go analogue.

**Coverage note:** P51 §3.8 lists real Keychain coverage as permanently lost when the UI suite moves
to the isolated `webkit` tier. Under this design it is **recovered**, in a better place: a
darwin-only Go test (`internal/secrets/keychain_darwin_test.go`) exercising the real Keychain item
round trip. That is one of the few things this migration makes strictly better, and §11 records it.

## 7. The renderer↔Go bridge and the bulk-data path

### 7.1 Control plane: 61 channels over `Call`

Per P51 part 2's design, confirmed twice on real builds: **one Go method per today's IPC channel**,
grouped into the twelve service structs of §4.2, marshalled as JSON over Wails' default `Call`
binding. These are control-plane payloads — settings, tree nodes, connection metadata, saved
queries — not result pages.

The four channel shapes from P51 §2 land as follows.

| Shape | Count | Mechanism |
|---|---:|---|
| Request/response | 43 | A bound service method. |
| Go→renderer push | 17 | `bridge/events.go` → Wails' event system, `app.Event.Emit(name, payload)`, using **today's exact channel strings** as event names (`kira:connection:state`, `kira:settings:changed`, `kira:op:update`, `kira:app:metrics`, `kira:engine:state`, `kira:open-settings`, and the 11 `kira:menu:*`). |
| Renderer→main fire-and-forget | 1 (`appFlushed`) | An ordinary bound method, `Lifecycle.Flushed()`. Nothing about it is bulk or high-frequency. |
| `MessagePort` transfer | 1 (`kira:port`) | Replaced entirely by §7.2's Stream. The channel constant disappears. |

**Wire types become Go-authored.** `wails3 generate bindings` emits TypeScript for every bound
method's parameter and return types. Those generated types become the single source of truth for the
IPC surface, and **`src/shared/protocol/ipc.ts` is deleted at P57** — its `IPC` const survives only
as the event-name strings, which move to a small `src/shared/protocol/events.ts`. `src/shared/domain/*`
keeps only what the renderer uses internally. This removes the duplication risk that would otherwise
exist between hand-written Go structs and hand-written TS interfaces, and it is the reason not to
hand-maintain both.

Validation at the trust boundary (`docs/ARCHITECTURE.md`'s invariant) moves wholly to Go: Wails
unmarshals into the typed struct, the method guards its own semantic preconditions, and every row
read back out of SQLite is validated in the repo before it is returned. The renderer stops doing
zod parsing of platform responses because the platform is now the thing that validated them.

### 7.2 Bulk data: one named `Stream`, and the correlation gap resolved

P51 part 2 left one thing genuinely open: *"the actual per-request correlation (which stream frame
answers which `Call`-issued request) is not designed here."* Resolved as follows.

**There is no correlation problem, because requests do not travel over `Call` at all.** The
engine's existing wire protocol (`src/shared/protocol/port.ts`) already carries its own request ids
— `PortRequest{kind:'req', id, op, payload}`, `PortResponse` discriminated on the same `id`,
`PortEvent{kind:'evt', topic, payload}` — and P51 §2.1 records that this protocol is already
transport-agnostic by design. So **both directions of the data plane ride the Stream**, and the
correlation is the one that already works today.

```
renderer                     Go                            engine (Node)
────────                     ──                            ─────────────
Stream("engine")             app.HandleStream("engine")    framed stdio
 .send(bytes) ────────────►  conn.Receive() ────────────►  len(4)|tag=1|body
                                (no unmarshal)
 onmessage  ◄────────────── conn.Send(body) ◄──────────── len(4)|tag=1|body
                                (no unmarshal)
```

- One named stream, `"engine"`, opened once per renderer session by the replacement for
  `src/renderer/bridge/port.ts` — the same "attached once per page load" lifetime today's port has.
- The renderer serialises a `PortRequest` to UTF-8 JSON bytes and calls `send()`. `Stream()`, **not**
  `JSONStream()` — the raw-bytes variant, per part 1's finding that `binaryType` defaults to
  `"arraybuffer"` specifically so bulk binary doesn't pay an extra async hop.
- Go's stream handler forwards those bytes to the engine's stdin verbatim, and forwards the engine's
  data frames to `StreamConn.Send()` verbatim. **Go never unmarshals a data-plane frame.**
  `StreamConn.Send` queues the slice without copying it (part 2), so a 1.3 MB page is handed over,
  not duplicated.
- The renderer does one `JSON.parse` per inbound frame and dispatches on `id`/`topic` — which is
  what `bridge/port.ts` already does today with the structured-clone result. Its pending-map,
  timeout and `onPortEvent` logic port essentially unchanged.

**Demultiplexing, which the single transport makes necessary.** Today the engine has *two* channels
to the app: `process.parentPort` (control: `connect`, `disconnect`, op events, cache config) and the
`MessagePort` (data). Under stdio there is one. So the Go↔Node framing gains **one byte**:

```
| length (uint32 BE) | channel (uint8) | body (JSON, UTF-8) |
                       0 = control, 1 = data
```

Go's read loop reads the length, reads the tag, and routes: `tag == 0` frames are unmarshalled into
`PortResponse`/`PortEvent` and fed to the pending-call map and event fan-out (`enginehost`'s own
machinery — these are small: op start/end, cache stats, connect results); `tag == 1` frames go
straight to the stream writer as opaque bytes. This is the concrete mechanism that lets Go stay out
of the data path while still owning the op log, and it is a one-byte change to the framing part 1
and part 4 already proved on both platforms.

**Backpressure, stated rather than hand-waved.** Part 2 records that `Send` signals fullness
(`ErrStreamFull`) at 8 MiB / 256 frames per connection rather than blocking, because blocking would
starve the poll the whole window depends on. Policy:

- A bounded channel (64 frames / 32 MiB, whichever first) sits between the read loop and the stream
  writer goroutine. The writer retries `Send` on `ErrStreamFull` with a short bounded backoff.
- If that channel fills, the read loop stops reading the engine's stdout, which propagates OS pipe
  backpressure to the engine itself — the correct place for it. Control frames stall behind it; that
  is accepted, and the queue is sized well above what the engine can actually have in flight (L2
  refuses to cache any page over half its 64 MB budget, and the largest page measured anywhere in
  this work is part 1's synthetic 1.3 MB), so reaching the bound means the *renderer* has stopped
  consuming — in which case stalling is correct behaviour, not a bug to paper over.
- No new error code is invented for this. There is no failure mode to report; there is only flow
  control.

**Session lifecycle comes for free.** Part 2 found that Wails supersedes and closes older-generation
stream sessions automatically on reload. That replaces `bridge/port.ts`'s hand-rolled "close any
previous port, reject everything still pending on the old one" and `src/main/index.ts`'s own
`generation` counter. The renderer keeps rejecting its own pending map on stream close; it stops
having to detect the supersede itself.

**What this costs, honestly.** `docs/ARCHITECTURE.md`'s invariant **"Bulk data skips the main
process"** does not survive literally — a Wails app has no channel out of the webview except Wails'
own bridge. It survives in the form that actually mattered: **bulk data passes through the Go
process without being parsed, copied or re-encoded.** ARCHITECTURE.md must be edited to say that at
P57, not left implying the old topology. The added cost versus today is one process hop and two
`copy`-free pipe writes; the removed cost is Electron's structured-clone serialise/deserialise. Which
way that nets out is **not known and is not claimed** — `docs/PERF.md` §2.1's 8 ms p50 scroll budget
must be re-measured against the webkit tier at P57 and recorded, pass or fail.

### 7.3 The Go↔Node engine transport

`internal/enginehost/host.go`, shaped after `p51-spike-artifacts/gonode/main.go` and the design
part 4 re-validated inside a real signed `.app`:

- `exec.Command(vendoredNode, engineJS)` with `execArgv`-equivalent
  `--max-old-space-size=<advanced.engineMemoryCapMb>` — P51 §3.6 asked for confirmation that this
  user-facing setting survives; it does, a real `node` binary takes the flag identically.
- `StdinPipe`/`StdoutPipe` for the framed channel, `StderrPipe` pumped line-wise into `logging` under
  scope `engine`, preserving today's single-log-file property.
- Pending-call map keyed by request id, 30 s default timeout (`DEFAULT_TIMEOUT_MS`), per-call
  override for the 20 s connect/test calls.
- `cmd.Wait()` in its own goroutine: on exit, every pending call fails with `E_ENGINE_DOWN`, and the
  `engine:down` event fires for `connections.markAllErrored` and `oplog`'s in-flight reconciliation.
  **No auto-respawn** — P1 §13.2's policy, unchanged. Part 1 measured this path at 79 ms, well
  inside the call timeout.
- The 1-byte channel tag and the stream plumbing of §7.2.

`src/engine/stdio-main.ts` (new, P54) is the Node counterpart: read framed stdin, tag `0` frames go
to `handleFrame` (control), tag `1` frames go to `dispatch` (data), responses are written back with
the matching tag. It imports the same `control.ts`, `rpc.ts` and `cache` modules `index.ts` does.
The two branches P51 §3.3 said would collapse do collapse — but into a tag switch rather than a
single path, because the control/data distinction is real and still needed by the Go side. `rpc.ts`'s
`transfer` return value stays the always-`undefined` typed pass-through it is today.

## 8. Native shell, lifecycle, and metrics

### 8.1 Window

`application.WebviewWindowOptions` with the current values: `minWidth 900`, `minHeight 600`,
background `#1F1F1F`, default title bar, shown on ready rather than on create. Bounds are read from
`repos/layout` before creation and written back behind the same 300 ms debounce, with the timer
cancelled on close (P12 D8 — the deliberate *non*-flush on quit stays deliberate).

### 8.2 Menu

All 14 accelerators from `menu.ts`, same labels, same grouping, `role`-backed items for
about/services/hide/minimize/zoom/close and the Edit menu, custom items emitting the existing
`kira:menu:*` event names. Dev-only Reload/DevTools gated on `config.IsDev()`.
`window.close`'s Shift+W remapping (because "Close Tab" claims Cmd+W) must survive — it is a
deliberate decision with a comment, not an accident.

### 8.3 Quit-flush handshake

Today: `before-quit` is preventDefault'd, `IPC.appFlushBeforeClose` is sent to every window, main
waits for `IPC.appFlushed` per window or 2 s, then shuts down connections, engine and DB and quits.
This exists because the renderer's tab/layout saves are debounced and a pager change made just before
quitting can still be sitting in a timer (`src/main/index.ts:35-60`).

In Go, a `Lifecycle` service (`bridge/lifecycle.go`) with:

- `RequestQuit()` — bound, and called by both the menu's Quit item and the window-close handler.
  Emits `kira:app:flush-before-close`, waits on a channel with a `time.After(2 * time.Second)`
  fallback, then runs shutdown in order: `connections.Shutdown()` (kills every live pre-connect
  process), `engineHost.Stop()`, `db.Close()`, `app.Quit()`. Re-entrancy guarded by a `sync.Once`,
  matching today's `quitting` flag.
- `Flushed()` — bound, fire-and-forget, closes the wait channel.

**This is the one lifecycle detail that needs live verification on real macOS**, and P56's plan must
say so: Wails' own `role: quit` menu item, and the Cmd+Q key equivalent AppKit installs, may bypass
a custom handler. If they do, the item must be a plain custom item with the Cmd+Q accelerator
attached and no `role`. Neither the Linux sandbox nor source reading can settle this; it is a
15-minute check on the machine part 4 used.

### 8.4 Metrics — the replacement for `app.getAppMetrics()`

`internal/metrics`, on `gopsutil/v4/process`. Every 5 s (today's `APP_METRICS_INTERVAL_MS`), sum
`MemoryInfo().RSS` and `CPUPercent()` across the app's process set and emit `kira:app:metrics` with
the existing `{cpuPercent, memoryBytes}` shape, so the status bar needs no change beyond its
subscribe mechanism.

The process set is the same one §3.3 defines, and getting it right matters here for the same reason:
the WebKit helper processes are where the memory actually is. `gopsutil` gives `Children()` from the
pid tree, which will **not** include them — so the sampler matches on the bundle, and P56's plan owes
a check that the sum it produces agrees with Activity Monitor on a real machine.

Note that today's `cpu.percentCPUUsage` is a delta since the previous `getAppMetrics()` call;
`gopsutil`'s `CPUPercent()` is cumulative-since-process-start unless the caller keeps the previous
sample. The sampler keeps the previous sample and reports the delta, preserving the "live app-wide
load figure" the status bar shows today rather than a lifetime average.

## 9. Renderer security posture

`src/main/security.ts` (60 lines) is the module P51 §3.8 already names as losing its test coverage.
It also loses most of its *subject*, and that must be stated rather than quietly ported:

| Today | Under Wails/WKWebView |
|---|---|
| `contextIsolation`, `sandbox`, `nodeIntegration: false` | No analogue and none needed — there is no Node in the webview at all. Strictly better. |
| `devTools: !app.isPackaged` | Wails' own dev-tools option, gated on `config.IsDev()`. Ports. |
| Permission request/check handlers with a clipboard allowlist | **No analogue.** WKWebView's permission model is not Chromium's; `navigator.clipboard` behaviour must be verified on a real build at P56 (the grid's paste path and `clipboard.ts`'s 38 `copyText` sites depend on it). |
| `window.open` deny, `will-frame-navigate` lock to the base URL, `webviewTag: false` | Partially: Wails exposes navigation and new-window callbacks. What is achievable must be established against a real build, not assumed. |
| `spellcheck: false` + `session.setSpellCheckerEnabled(false)` | **No analogue.** The reason it exists is real (the password field becomes `type="text"` when revealed). Mitigation moves into the renderer: `spellcheck="false"` on the field itself. |
| `webgl: false` | **No analogue.** |
| The 7 `disable-*` Chromium command-line switches | **No analogue and no subject** — there is no Chromium. |
| The 5 `electronFuses` | **No analogue.** §10.2 addresses what they protected against, which is now a different question. |
| `grantFileProtocolExtraPrivileges` | **No subject** — Wails serves the frontend through its own scheme handler, not `file://`. The whole class of problem disappears. |

This is a genuine reduction in explicitly-asserted hardening. It is also a genuine reduction in
attack surface (no Chromium, no Node in the renderer, no `file://` module loading). Both halves are
true and both go in §11.

## 10. Packaging, signing, and the vendored-`node` hardening question

### 10.1 The pipeline

Per part 4, done for real: `wails3 generate bindings` → `bun run build:wails` → `task darwin:package`
(which already runs `codesign --force --deep --sign -` on the assembled bundle), then
`scripts/sign-bundle.sh` doing the four lines part 4 established:

```
codesign --force --sign - "$APP/Contents/Resources/engine/node-runtime/bin/node"
codesign --force --sign - "$APP/Contents/Resources/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
```

The vendored runtime is trimmed per part 4 (`include/` 64 MB, `lib/node_modules/npm` 17 MB), landing
around 170 MB against Electron's recorded 252 MB. Install size is explicitly not a constraint
(P51 §1.3); the number is recorded because it is cheap and `docs/PERF.md` L-D tracks it.

`@confluentinc/kafka-javascript` installs with a plain `npm install` against the vendored Node — no
`electron-rebuild`, no ABI matching, no `CKJS_LINKING=dynamic`, because part 4 proved the addon
arrives as a **downloaded prebuild** for the standard Node ABI. `scripts/native-electron-build.sh`
is deleted at P57. **Do not forget npm's newer default-deny on install scripts**
(`npm install-scripts approve @confluentinc/kafka-javascript`, part 4 and `AGENTS.md`) — a bare
`npm install` silently leaves `build/Release/*.node` missing.

### 10.2 `scripts/verify-packaging.sh`, rewritten per §3.4's mapping

| Check | Fate |
|---|---|
| S1–S5 (no updater dep, no updater code, no update-info write, no publish config, scripts cannot publish) | Survive nearly verbatim — runtime-independent |
| S6/S7 (`electronFuses`, `grantFileProtocolExtraPrivileges`) | Deleted; replaced by the new N1/N2 below |
| A1/A2 (`latest*.yml`, `.blockmap`) | Deleted — electron-builder artifacts |
| A3 (ad-hoc signature) | Becomes a check over the bundle **and** both nested executables |
| A4 (`engine.js` unpacked outside the asar) | Becomes "engine JS, `node_modules` and the vendored `node` are present at their expected paths" |
| A5 (`CFBundleIdentifier == com.kirathecat.kira-studio`) | Survives as-is |
| A6 (Kafka `.node` unpacked, and only there) | Becomes "present beside the engine's `node_modules`, Mach-O arm64, signed" |
| **N1 (new)** | The vendored runtime contains `bin/node` and **not** `include/` or `lib/node_modules/npm` — the trim is a build guarantee, not a hope |
| **N2 (new)** | `codesign --verify --deep --strict` exits 0 |

**The hardening question a vendored `node` creates, answered plainly.** P51 §3.4 is right that
`electronFuses`' *purpose* — the shipped app not being usable as a general-purpose Node runtime,
not honouring `NODE_OPTIONS`, not accepting `--inspect` — applies **more** to a bundle containing a
real `node` binary, not less. What can and cannot be done:

- **Can:** the engine is spawned with an explicit argv, and the child's environment has
  `NODE_OPTIONS` and `NODE_REPL_EXTERNAL_MODULE` **cleared** by the Go spawner, so the app's own
  engine process cannot be steered by an inherited environment variable. This is the one part of the
  fuses' protection that genuinely ports, and it is not optional.
- **Can:** the binary is signed and the bundle resealed, so replacing it invalidates the signature.
- **Cannot:** stop a local user from running `Contents/Resources/engine/node-runtime/bin/node`
  directly. There is no fuse-equivalent. That capability is a real, new property of this bundle
  compared to today's fuse-flipped Electron, and pretending otherwise would be worse than recording
  it. It is a local-user capability, not a remote one, and the same user could download Node anyway
  — but it is a regression against the posture P46 deliberately established, and it belongs in §11.

## 11. What gets worse, and what stays unmeasured

P51 §6 asks for "a plain enumeration of everything that gets *worse*, not just what gets better."
That applies to this plan too.

**Worse:**

1. **Test coverage.** 23 `tests/e2e/` specs and 7 `*.frontend.spec.ts` specs stop running against a
   real shell (§12). Native menu/window/lifecycle coverage, real-bridge correctness and
   `security.ts`'s posture end up covered by nothing.
2. **`hardening.spec.ts` loses its subject entirely** — there are no Chromium permissions, no
   `webPreferences` and no fuses to assert. Its 60 lines of security posture become §9's much
   shorter, less-assertable list.
3. **`startup.spec.ts` loses its measurement point.** `app.evaluate(() => process.uptime())` has no
   analogue; cold start becomes a manual `docs/PERF.md` §3 procedure read from the log line.
4. **The bundle contains a general-purpose Node binary** that can be run directly (§10.2).
5. **Framework maturity** (P51 §3.9): Wails is smaller than Electron by every measure, on a beta
   line, with no sidecar mechanism, no WebDriver story, and — as parts 1–4 kept rediscovering — its
   documentation site is unreachable from both of this project's environments, so every question is
   answered by reading source.
6. **Two type systems describing one wire protocol**, mitigated but not eliminated by generating the
   TS from Go (§7.1).
7. **`docs/ARCHITECTURE.md`'s "bulk data skips the main process" invariant is weakened** to "passes
   through unparsed" (§7.2).

**Better:**

1. The memory number — **if** G1 says so, and only then.
2. Real Keychain coverage is *recovered* as a darwin-only Go test (§6.5), having been listed as
   permanently lost.
3. The Kafka native-addon build collapses from `native-electron-build.sh` + `electron-rebuild` +
   ABI matching + `CKJS_LINKING=dynamic` to a plain `npm install` (part 4).
4. `tests/ipc/**/*.backend.spec.ts` stops needing `ELECTRON_RUN_AS_NODE=1 electron` and runs under
   the vendored Node directly (§12).
5. Crash blast radius is unchanged from today's already-accepted shape (P51 §3.6) — settings, tabs,
   layout and the op log live in the Go process.
6. The `[CODE] message` folding retires (§5.3); the statement cache and its unbounded-SQL cause
   retire (§5.4); the pre-P25 plaintext passthrough and its upgrade pass retire (§6.4).
7. No `file://` module loading, no Node in the renderer, no Chromium — a smaller attack surface even
   as the *asserted* posture shrinks (§9).

**Unmeasured or unresolved going in — stated so no later session mistakes them for settled:**

- **§3.7, RAM.** Open until G1 (§3.3). This plan makes no claim about it and none of its later
  phases are authorised before G1 clears.
- **`docs/PERF.md` §2.1's interaction budgets under WKWebView.** The 8 ms p50 scroll budget was
  measured on Chromium. It is re-measured at P57 against the webkit tier and recorded, pass or fail.
  This is not gated — a scroll regression is a bug to fix, not a reason to abandon the migration —
  but it must not be assumed to hold.
- **Cold start.** Never measured for a Wails build. Recorded at P57.
- **Whether Cmd+Q can be intercepted** for the quit-flush handshake (§8.3) — a real macOS check at
  P56.
- **`navigator.clipboard` under WKWebView** (§9) — a real macOS check at P56.
- **Whether `keybase/go-keychain` exposes non-synchronizable generic passwords with an explicit
  accessibility class** (§6.3) — verified against the pulled module source at P53/P55, with a named
  fallback.
- **Whether Wails' error `cause` propagation works as part 2 read it** (§5.3) — the design does not
  depend on it.

## 12. Test infrastructure: deleted, kept, rebuilt

P51 §3.8's decision is **carried over, not reopened**: the UI test suite moves fully to Playwright's
isolated `webkit` tier with a hand-built stand-in for the bridge, unconditionally. Part 3's finding
(a plain browser tab cannot reach `/wails/runtime` because it is served through a registered URI
scheme inside the native process) is one more piece of evidence for that, not a new decision.

### 12.1 Deleted at P57

- All 23 `tests/e2e/` specs and `tests/e2e/fixtures.ts`/`support/` — they are built on
  `_electron.launch()`.
- `playwright.config.ts`'s `e2e` project.
- `tests/unit/security.spec.ts` and `tests/unit/menu.spec.ts` — their subjects (`security.ts`'s
  option object, the packaged-vs-dev menu template) become Go, and their Go equivalents live in
  `internal/shell/*_test.go`.
- `scripts/native-electron-build.sh` (§10.1) and `scripts/run-ipc-backend.sh`'s Electron-specific
  invocation (the script survives; its runtime changes, §12.2).
- `scripts/verify-packaging.sh` — rewritten, not deleted (§10.2).

### 12.2 Kept, some of it simplified

- **`tests/db/` entirely.** The adapters are untouched; Bun + Testcontainers is unaffected by the
  shell change.
- **`tests/electron-db/kafka.spec.ts` moves to `tests/db/kafka.spec.ts`** and runs under the
  vendored Node instead of `ELECTRON_RUN_AS_NODE=1 electron`. Part 4 proved the addon loads cleanly
  under a stock Node; the only reason that spec was quarantined was Electron's ABI. The
  `tests/electron-db/` directory and its tsconfig go away.
- **`tests/ipc/**/*.backend.spec.ts` (7 specs) survive with a smaller scope and a simpler runtime.**
  They run under the vendored Node rather than Electron, because the two reasons they needed Electron
  — `src/main/ipc/*` importing `electron`, and sqlite/kafka not loading under Bun — reduce to the
  second, which a real Node satisfies. **They do lose one half:** they currently drive "the real
  `handleFrame`/`dispatch`/`TreeService` stack," and `TreeService` becomes Go. So the backend specs
  keep the engine half and drop the `TreeService` half, whose coverage is recreated as
  `internal/tree/service_test.go` (§13).
- **`tests/ipc/**/<adapter>.fixture.ts` — kept verbatim, and this is the single most fortunate thing
  about this migration's test story.** Those generated fixtures are the tier's anti-drift guarantee
  ("a frontend spec cannot mock a shape the backend has stopped producing without that same fixture
  module's own backend assertion failing first"), they describe *engine* responses, and the engine is
  not changing. They survive the shell replacement untouched and keep doing their job across it.
- **The remaining `tests/unit/` specs** (renderer-side: scan, column-range, view-state, sql-text,
  sql-split, catalog-listing, anchored-position, run-state, metadata-cache) — unaffected.

### 12.3 Rebuilt as the `webkit` tier

A new Playwright project, `ui`, `testDir: ./tests/ui`, `use: { browserName: 'webkit' }`, serving the
built renderer from `shell/frontend/dist` over a static file server, with a stand-in installed as an
init script before the app boots:

- `window.kira` — a hand-written object with the same method names, backed by an in-memory fake
  whose responses come from the existing fixtures where one exists.
- A fake stream object exposing the same `send`/`onmessage` surface the real `Stream("engine")`
  wrapper does, so `bridge/port.ts`'s replacement is exercised for real against a fake far side.

The 7 `*.frontend.spec.ts` specs port into this tier close to mechanically (they already mock both
IPC halves; only the mocking mechanism changes). The pure-UI `tests/e2e/` specs — panel toggles,
tabs, tooltips, cell editor, autocomplete, tree filters, interaction, data-view — port too. The three
full-stack anchors (`sqlite.spec.ts`, `mongo.spec.ts`, `s3.spec.ts`) **cannot** and are retired;
`s3.spec.ts` in particular is the only spec exercising the real save/open dialogs and
`DATA_OP.objectDownload`'s "the engine writes the file itself" contract, which no mock can honestly
stand in for. That loss is real and is listed in §11.

`budgets.spec.ts`/`perf.spec.ts`/`leaks.spec.ts` are re-created in this tier — they measure renderer
work with the renderer's own instrumentation (`measureScrollResponses`' work-delta marks,
`__kiraGridRetainedBytes()`), none of which is Electron-specific. `startup.spec.ts` is not; it becomes
a manual procedure (§11).

## 13. Go testing convention (new territory — defined here)

There is no Go testing convention in this repo. This is it, and P53–P57 follow it.

- **`go test ./...`, standard library `testing`, table-driven.** One test-only dependency,
  `github.com/google/go-cmp`, for struct diffs. No assertion framework — this matches the repo's
  existing one-tool preference (Biome, Bun) rather than importing a second vocabulary.
- **Tests live beside the code** (`internal/storage/repos/settings_test.go`), in the same package
  when they need unexported access and in `package foo_test` when they are exercising the public
  surface. Prefer the latter.
- **Real dependencies, not mocks, wherever the dependency is cheap.** Storage tests open a real
  SQLite database in `t.TempDir()` and run the real embedded migrations — which means the migrations
  themselves are covered on every run, something `tests/unit/`'s hand-restated DDL never did.
  EngineHost tests spawn the real vendored `node` against a real script.
- **`t.Setenv("KIRA_HOME", t.TempDir())`** in every test that touches the filesystem, mirroring the
  isolation rule `docs/ARCHITECTURE.md`'s Testing section already states for the TS suites: a test
  must never touch a developer's real `~/.kira-studio`.
- **Platform-specific tests use build-tagged files** (`keychain_darwin_test.go`), never a runtime
  `if runtime.GOOS`. A darwin-only test is skipped by not being compiled, which is honest; a
  runtime skip that silently passes on Linux is not.
- **Wired as `bun run test:go`** so the repo keeps one entry point per suite.

Required coverage, by package — this is the acceptance criterion for each phase, not a wish list:

| Package | Must cover |
|---|---|
| `storage` | Fresh-DB migration, idempotent re-run, refusal on a newer `schema_version`, the four pragmas actually applied, `0600`/`0700` permissions |
| `storage/repos` | Round trip per repo; the settings per-leaf fallback for a missing key; the layout/tabs JSON shapes; `pruneOps`'s retention cut **and** its 20 000-row hard cap (§5.4); the "drop an unparseable row rather than propagate it" path |
| `secrets` | Encrypt/decrypt round trip; tamper detection (a flipped ciphertext byte fails to authenticate); refusal when the backend is unavailable; rejection of a non-enveloped value; the three `SecretStorageStatus` shapes; **darwin-only:** the real Keychain item round trip |
| `enginehost` | `ping` round trip; a structured error frame surfacing code+message; unsolicited event fan-out; `E_ENGINE_DOWN` on mid-call child exit; per-call timeout; **a data-tagged frame reaching the stream writer byte-identical and without being unmarshalled** |
| `preconnect` | One-shot exit 0; sidecar settle; failure before settle carrying the stderr tail; death between `start()` and `arm()`; SIGTERM→SIGKILL escalation; self-inflicted kills not firing `onExit`; process-group kill reaching a grandchild |
| `connections` | Create/update/duplicate/delete; the three-state password convention; URI password strip/inject; in-flight connect dedupe; `markAllErrored`; the "validate the secret can be encrypted before writing anything" ordering (P25 D6) |
| `tree` | Cache hit, cache miss, refresh bypass; schema-mismatch drop; truncated listing not cached and an older complete row dropped (P43 iter3 D38); `E_DISCONNECTED` when not connected |
| `oplog` | Start/end row lifecycle; the 500-op prune trigger; in-flight reconciliation on `engine:down` |
| `bridge` | `ipcerr` JSON round trip and the `E_INTERNAL` fallback for an unstructured error; one representative service method per service |
| `bridge/stream` | Demux by tag; backpressure at the bounded channel; frame passthrough integrity for a ≥1 MB payload |
| `shell` | Menu template shape (the Go analogue of `tests/unit/menu.spec.ts`), packaged-vs-dev difference |

## 14. Documentation owed at P57

- `docs/ARCHITECTURE.md`: the Stack table, the Process model diagram and its "bulk data skips the
  main process" paragraph (§7.2), the Storage section's `safeStorage`/`kira:v1:` paragraph (§6), the
  Renderer security surface section (§9), and the Testing section (§12).
- `docs/PERF.md`: §2.3 (the G1 numbers, written at P52 regardless of outcome), §2.1 re-measured
  against the webkit tier, §3's manual procedures rewritten for the new bundle, L-D's app-size row.
- `docs/PACKAGING.md`: rewritten for `task darwin:package` + `scripts/sign-bundle.sh`.
- `AGENTS.md`: the P51 environment section gains the Go toolchain / `bun run test:go` / vendored-Node
  workflow; the Electron-binary, `KIRA_INSECURE_SECRETS` and native-Kafka sections are rewritten or
  deleted as their subjects change.
- `docs/v1/SPEC.md`: a P52 row, and the P51 row's status updated from "plan only" to "superseded for
  implementation by P52."

## 15. Decision gate

**G1 (§3.3) is the only gate inside this plan, and it sits at the end of P52.** P53 does not start
until G1 has a recorded number and a recorded verdict. An amber result stops for the repo owner
rather than being resolved by the implementing session.

Everything after G1 is ordinary phased work under `AGENTS.md`'s normal loop: each of P53–P57 gets its
own Opus plan sequencing that phase against the then-current tree, implemented by Sonnet, with the
architectural decisions in §4–§10 of this document treated as settled rather than re-derived.
