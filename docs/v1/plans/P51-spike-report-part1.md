# P51 — Spike report, part 1: what this Linux sandbox could verify

> Companion to `docs/v1/plans/P51-wails-go-node-engine-spike.md` (the plan). This is the first
> installment of the report §6 asks for — the subset of the spike answerable **from this Linux
> sandbox, with no macOS machine and with `wails.io`/`v3.wails.io` egress-blocked (reconfirmed
> again this session)**. It replaces inference and single-file GitHub reads with a real installed
> toolchain, a real generated project, and two working, measured prototypes. It does **not** close
> the phase: §3.4, §3.5, §3.7 and the native-shell half of §3.8 are macOS-only and remain entirely
> unaddressed — see "What is still blocked" below. §5 Q4 (macOS machine availability) is the
> reason, unchanged from the plan.

## Environment used

- Ubuntu 24.04, Go toolchain auto-upgraded 1.24.7 → **1.26.7** (module-declared minimum for
  `wails/v3@v3.0.0-beta.15`), installed via `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`
  — resolved entirely through `proxy.golang.org`, which is **not** on this environment's egress
  block list (unlike `wails.io`).
- `wails3`'s own Linux build needs `libgtk-4-dev` and `libwebkitgtk-6.0-dev` (`pkg-config` targets
  `gtk4` / `webkitgtk-6.0`) purely so the **CLI and any Linux-hosted dev build** can embed a
  webview locally — this is tooling for developing *on* Linux, not a claim that Linux is a
  shipping target (§0 restates Go, not the OS, as the only decided premise; the app's actual
  target stays macOS per the deleted plans' own scope).
- `wails3 doctor` after installing those packages reports a clean build environment (Go, gcc, gtk4,
  webkitgtk-6.0, npm, pkg-config all present; only Android SDK and code-signing are absent, both
  irrelevant here).

## §3.1 — Confirmed with a real scaffold and build (was: one GitHub discussion)

`wails3 init -t vanilla` → `go mod tidy` → `wails3 generate bindings` → `npm run build` (Vite) →
`go build` all succeeded, producing a working ~16.5 MB Linux/GTK4 binary end to end. This confirms
mechanically, not just from reading the maintainer's #3021 answer, that:

- **The binding model is service structs**, exactly as §3.2 hypothesized:
  `application.NewService(&GreetService{})` in `main.go`, one Go method (`Greet(name string) string`)
  becoming one generated TS export. Confirms "a handful of service structs matching today's 14
  `src/main/ipc/*` modules" is the right shape, not "one generic dispatch method."
- **No sidecar mechanism exists** — still true, nothing in the scaffold or `wails3 doctor` output
  suggests otherwise. The Go↔Node engine transport genuinely has to be hand-rolled (§3.3, below).
- **`go:embed` is real and is what `main.go` uses for the frontend** (`//go:embed all:frontend/dist`)
  — confirming §3.1's note that this mechanism exists for the *frontend assets*, and separately
  confirming (by its absence from anywhere in the scaffold) that it has no bearing on §1.2's
  vendored-Node-runtime requirement, which stays a custom packaging step regardless.

## §3.2 — Resolved from the real installed `@wailsio/runtime@3.0.0-beta.15` package (was: one file read from GitHub HEAD)

Reading `frontend/node_modules/@wailsio/runtime/dist/runtime.js` and `dist/stream.js` from an
actual `npm install` — not the v3 GitHub branch — gives two results, one confirming the plan's
prior partial finding and one new:

**Confirmed as the plan suspected:** the default binding transport (`newRuntimeCaller` →
`runtimeCallWithID`) is a JSON `fetch()` POST to `window.location.origin + "/wails/runtime"`,
parsed as JSON or text by response `Content-Type`. New detail the prior GitHub read didn't surface:
bodies over 512 KB are split into serial chunked POSTs (`sendChunked`), sized to stay under
WebView2's request-buffering limit — a Windows-specific constraint that doesn't bind macOS but
confirms the default path really is "marshal the whole page as one JSON string," chunking or not.
`setTransport()` is real, exported, and documented with a runnable example in the source comment.

**New, not in the plan before — directly answers §3.2's second open bullet:** the runtime ships a
**first-class streaming primitive**, `Stream()` / `WailsSocket` / `JSONStream()` in `stream.js`
(869 lines, not a stub) — "the WebSocket programming model without a listening socket," per its
own header comment: Go→JS over one held long-poll per connection, JS→Go over plain POST, against
`/wails/stream/*`. Concretely:

- `WailsSocket` extends `EventTarget` and deliberately mirrors the `WebSocket` API
  (`readyState`, `send()`, `onopen`/`onmessage`/`onclose`/`onerror`), with one **stated, deliberate**
  divergence: `binaryType` defaults to `"arraybuffer"`, not `"blob"` — the source comment says this
  is specifically so bulk binary data doesn't force an extra async hop to read every message.
- `Stream(name)` gives raw bytes both directions. `JSONStream(name)` is a separate, opt-in wrapper
  that adds `JSON.stringify`/`JSON.parse` on top — meaning **JSON is not mandatory** on this path,
  unlike the default `Call` binding.
- This means `docs/ARCHITECTURE.md`'s "bulk data skips the main process" invariant has a concrete
  candidate to survive in modified form under Wails: **route request/response control traffic over
  the default `Call` binding, and route bulk result pages over `Stream()` as raw bytes**, avoiding a
  full JSON round-trip for exactly the payloads §2.1 says bypass main today. This is a verified
  *primitive*, not a finished design — the spike still owes the concrete wiring (how a Go handler
  decides which pages are "bulk," how the renderer correlates a stream frame back to the request
  that asked for it, whether `docs/PERF.md` §2.1's 8 ms scroll budget holds) before this counts as
  the §3.2 design deliverable. But the prior version of this document's "hypothesis from reading one
  file of a beta-branch runtime" is now a **verified, real API**, checked against the actual
  installed package.

## §3.3 — A working, measured prototype (was: a design only)

Standalone spike code (not committed under `src/` — it is throwaway, per this document's own rule
against half-finished implementations landing in the real tree) at
`gonode/main.go` + `gonode/engine_stub.mjs` in the spike's scratch workspace implements:

- **Framing**: 4-byte big-endian length prefix + UTF-8 JSON body, both directions over stdio pipes
  — the decided mechanism from §3.3.
- **Payload shapes reused verbatim**: `PortRequest`/`PortResponse`/`PortEvent` from
  `src/shared/protocol/port.ts`, re-declared as Go structs with matching JSON tags.
- **`EngineHost` Go analogue**: spawner (`os/exec`), a pending-call map keyed by request id, a
  per-call timeout, and an event fan-out channel for unsolicited `PortEvent` frames.

Measured, not estimated:

| Case | Result |
|---|---|
| `ping` round trip | Correct payload (`{pong:true, enginePid, at}`) |
| `echo` round trip | Payload returned unmodified |
| Structured error | `{code:"E_SPIKE", message:"synthetic failure"}` surfaced as a Go `error` carrying both fields |
| Unsolicited `PortEvent` | Delivered and drained independently of any pending call |
| Bulk payload | 50 000-row JSON page, 1 377 781 bytes, round-tripped in **58.4 ms** |

This is a genuine, if synthetic, latency data point for a 1.3 MB JSON payload over stdio framing on
this machine — useful context for §3.2's budget question, not a substitute for measuring the real
engine's actual page sizes.

## §3.6 — Crash-detection promptness, measured (was: "should confirm rather than assume")

A second engine stub that never responds and exits mid-call, run against the same `EngineHost`:
the pending `ping` call failed with `E_ENGINE_DOWN` in **79 ms total process runtime** — nowhere
near the call's 2 s timeout — confirming `cmd.Wait()`-based detection fires promptly on child exit
rather than waiting out a timeout or requiring a poll. This is exactly the property §3.6 asked to
confirm before treating the no-auto-respawn policy as portable.

## Two hidden design decisions the triage surfaces (§3.10's own warning, made concrete)

The plan already flagged that "rewrite it in Go" could hide a real decision in exactly two places;
reading both files confirms it:

- **`src/main/ipc/errors.ts`'s `[CODE] message` folding is an Electron-IPC-specific workaround**,
  stated in its own comment: Electron's IPC serialization drops everything but `.message`, so a
  thrown error's `.code` gets folded into the message text as the one place every handler's errors
  pass through. Wails does **not** have this constraint — `runtime.js`'s error path parses a JSON
  body shaped `{kind, message, cause}` and preserves `cause` on the reconstructed JS error
  (`err.cause = json.cause`). A Go handler can return a structured `{code, message}` object as
  `cause` directly; the renderer's `[CODE] text`-prefix parsing convention can be **retired**, not
  ported. Net simplification for whichever service-struct layer replaces `src/main/ipc/`.
- **`src/main/storage/db.ts`'s 200-entry statement cache exists because `node:sqlite`'s `prepare()`
  recompiles the SQL every call.** Whichever Go SQLite path is chosen needs this question answered
  on its own terms — several Go SQL drivers/ORMs already do internal statement caching (worth
  checking library-by-library rather than assuming a bespoke cache is needed) — not copied
  mechanically. This spike does not pick a driver; it only confirms the question is real.

## §3.10 — Per-module triage, performed

Every entry the plan enumerated, with actual current line counts and disposition. "Go" means
"becomes Go code in the new architecture, no `src/engine` involvement." Nothing below overturns
§1.1's expectation that the answer is "Go" everywhere above `src/engine/` — the value here is the
size data and the two callouts above, not a surprise verdict.

| File | Lines | Disposition |
|---|---:|---|
| `src/main/index.ts` | 173 | Go — lifecycle (`app.setName`/`userData` path, `whenReady`/`activate`/`window-all-closed`) plus the `before-quit`/`appFlushed` quit-flush handshake (`ipcMain.on(IPC.appFlushed, …)` at L42, `webContents.send(IPC.appFlushBeforeClose)` at L58, held in `before-quit` at L152) — needs Wails' own lifecycle hook, open per §3.6. |
| `src/main/window.ts` | 58 | Go — window/menu/lifecycle idioms map onto `application.WebviewWindowOptions` directly (confirmed shape from the scaffold's `main.go`). |
| `src/main/menu.ts` | 127 | Go — native menu, 14 accelerator entries; Wails' menu API scaffolding not yet exercised by this report. |
| `src/main/log.ts` | 45 | Go — no engine dependency. |
| `src/main/env.ts` | 4 | Go — trivial. |
| `src/main/security.ts` | 60 | Go — becomes Wails' CSP/security config; §3.8 already notes this loses its current test coverage regardless of the port. |
| `src/main/connections.ts` | 409 | Go — largest single `src/main` file; state synthesis on engine-exit (§3.6) lives here today. |
| `src/main/engine-config.ts` | 33 | Go — config only, no behavior tied to Electron. |
| `src/main/engine-host.ts` | 115 | Go — **this file's shape is what `gonode/main.go` above already prototypes**: spawner, pending-call map, timeout, exit handler. |
| `src/main/oplog.ts` | 114 | Go — no Electron/engine coupling beyond storage. |
| `src/main/preconnect.ts` | 237 | Go — `node:child_process.spawn` → Go `os/exec`, per §1.1. |
| `src/main/secret-cipher.ts` | 111 | Go — folds into the same process as `storage/repos/secrets.ts` per §3.5; library choice still open. |
| `src/main/tree-service.ts` | 154 | Go — no engine coupling. |
| `src/main/ipc/app.ts` | 13 | Go — thin handler, one of 14 modules feeding into whatever replaces `registry.ts`. |
| `src/main/ipc/connections.ts` | 46 | Go |
| `src/main/ipc/deps.ts` | 11 | Go — shared `IpcDeps`-equivalent; its Go shape decides how service structs share dependencies. |
| `src/main/ipc/engine.ts` | 7 | Go |
| `src/main/ipc/errors.ts` | 27 | **Go, but not a straight port** — see callout above. The `[CODE] message` folding convention should be retired, not translated. |
| `src/main/ipc/files.ts` | 54 | Go |
| `src/main/ipc/filters.ts` | 23 | Go |
| `src/main/ipc/layout.ts` | 10 | Go |
| `src/main/ipc/ops.ts` | 20 | Go |
| `src/main/ipc/queries.ts` | 87 | Go |
| `src/main/ipc/registry.ts` | 28 | Go — 11 handler groups; its Go analogue is the `Services: []application.Service{...}` list the scaffold's `main.go` already shows the shape of. |
| `src/main/ipc/settings.ts` | 24 | Go |
| `src/main/ipc/tabs.ts` | 16 | Go |
| `src/main/ipc/tree.ts` | 36 | Go |
| `src/main/storage/db.ts` | 109 | **Go, but not a straight port** — see callout above. The 200-entry statement cache's necessity depends on the chosen Go SQLite path. |
| `src/main/storage/migrate.ts` | 32 | Go — migration runner; 5 `.sql` files themselves are SQL, portable as-is modulo dialect. |
| `src/main/storage/paths.ts` | 26 | Go |
| `src/main/storage/schema/*` (9 files) | 6–22 each | Go — per §1.4, no obligation to replicate zod's `.default()` backward-compat machinery; a fresh Go schema is in scope, not a port of the TS shape. |
| `src/main/storage/repos/*` (10 files) | 46–198 each | Go — mechanical repository-pattern port; `secrets.ts` (83 lines) is the one with the §3.5 envelope-format question attached. |
| `src/preload/index.ts` | 161 | **Disappears entirely** into §3.2's bridge — this report's `Stream()`/`Call` split (above) is the concrete shape that bridge now has a real candidate design for. |
| `src/engine/index.ts` | 56 | **The one `src/engine` file that changes.** Confirmed by reading it directly: it imports `MessagePortMain` (type-only) and holds `activePort`/`handleRequest`, the `attach-port` branch and the direct `process.parentPort` branch §3.3 already said collapse into one under this design — nothing else in `src/engine` needs to change. |

## What is still blocked in this environment (unchanged from the plan, reconfirmed)

- **§3.4 (packaging/signing), §3.5 (Keychain library choice), §3.7 (real RAM measurement)** — all
  require a macOS arm64 machine. Nothing in this report substitutes for that; §5 Q4 stands exactly
  as written.
- **`wails.io` / `v3.wails.io`** — reconfirmed blocked by this environment's egress proxy again this
  session (both a raw `curl` and `WebFetch` fail identically). Every finding in this report comes
  from an actually-installed package or generated project, not the official docs, which remain
  unread from here.
- **§3.8's native-shell WKWebView/WebDriver question** is still unanswerable here (no macOS, no
  WKWebView). A secondary attempt to at least confirm the GitHub-discussion claim that
  `wails3 dev` exposes bindings at `http://localhost:34115` for a Playwright-against-a-browser
  workflow did not produce a result — not because of a Wails-specific limitation, but because this
  sandbox terminates a backgrounded long-lived process (`xvfb-run wails3 task dev`) at the end of
  the shell command that started it, before the dev server finished its own build step. This is a
  sandbox process-lifecycle limitation, not a finding about Wails, and is worth retrying somewhere
  a background server can stay up across tool calls.
