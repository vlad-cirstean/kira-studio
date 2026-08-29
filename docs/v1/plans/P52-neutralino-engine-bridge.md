# P52 — NeutralinoJS engine and IPC bridge (all adapters)

> Plan for the SPEC.md §10 **P52** row. Deliverable, from that row: *"replace `src/main`'s
> Electron-specific IPC/window/lifecycle code and P51's `window.kira` stub with a real
> Neutralino-hosted bridge, bringing every existing adapter up at once."* Explicitly out of scope
> per the same row: OS keychain/credential storage, packaging, and an E2E harness.
>
> **Read §0 first.** P51's §0 recorded a walking skeleton that had already been built; this §0
> records the two research questions the P52 row named as having no precedent to port — the
> `extensions` wire protocol and the chunked bulk relay — both **built and measured for real in
> this Linux sandbox on 2026-08-29**, in a throwaway scaffold outside the repo. Both work. §0 also
> records four things nobody asked about that will break the implementation if the implementing
> session does not know them (§0.3, §0.6, §0.8, §0.9), and one transport that measured *better*
> than the one this phase is going to build (§0.7) — recorded as a finding and an open question
> (§9 Q1), not as a change of plan.
>
> **The architecture below was decided with the user before this document was written** (§2's D1–D4
> restate it). It is a given. This plan's job is to say exactly how to build it and what the
> measurements say it costs — not to re-derive whether it is the right shape.

---

## 0. Feasibility verdict (read this first)

**Yes. Both new pieces work.** A Node.js process registered as a Neutralino extension completes the
handshake, exchanges traffic with the page in both directions, forks a real Node engine child, and
streams a 22 MB result payload to the page in chunks. Chunking does what it was chosen for: it is
**~2× faster** than one large message, cuts time-to-first-byte from ~1.7 s to ~27 ms, and — the
question the P52 row actually turned on — **it does prevent head-of-line blocking at the Neutralino
layer**, measurably and reproducibly (§0.5).

| Question | Answer |
|---|---|
| Can a Node process register as a Neutralino extension and connect? | **Yes.** Handshake is one JSON object on **stdin**, then EOF. Not env vars, not argv (§0.1). |
| Does it need a WebSocket dependency? | **No.** Node 22's global `WebSocket` is sufficient. Zero new npm packages for the transport. |
| Does `extensions.dispatch` (page → app process) work? | **Yes**, and the client library queues dispatches issued before the extension has connected. |
| Does `app.broadcast` (app process → page) work? | **Yes**, delivered to `Neutralino.events.on` as a DOM `CustomEvent` on `window` (§0.2). |
| Does `app.broadcast` leak to *other* extension processes? | **No.** A second, idle extension saw **0 of 118** broadcast chunks (§0.2). |
| Is frame ordering guaranteed? | **Yes.** Every run: strictly increasing `seq`, no gaps, reassembled payload byte-exact. |
| Is there a maximum message size? | **Yes, and it is fatal.** A frame over ~32 MB **silently closes the WebSocket** (code 1006) and kills the extension. The app's own documented worst-case page is *over* it (§0.3). |
| Does chunking prevent head-of-line blocking? | **Yes** — for anything not produced by the busy process itself (§0.5). Residual cost on the busy process is real and quantified. |
| What chunk size? | **256 KB of base64 text per frame**, with an event-loop yield between frames (§0.4, D6). |
| Does `child_process.fork()` carry the engine's payload? | **Yes — but only with `serialization: 'advanced'`.** The default (`'json'`) is 25–190× slower and destroys every typed array (§0.6). |
| Can the app process drive native window/menu APIs itself? | **Yes**, every one tried — *after* the window exists. Before it does, the native binary **segfaults** (§0.8). |
| Is the whole phase buildable and testable in this Linux sandbox? | **Mostly.** Everything in §0 ran here for real. End-to-end adapter smoke-testing is limited to **passwordless** connections, because this phase has no credential storage at all (§0.9, D12, §7). |

### 0.1 The extension handshake, exactly as it arrives

A scratch Neutralino app (v6.9.0 binary from `neutralino/bin/`, config with `enableExtensions: true`
and `extensions: [{ id: "com.kirathecat.appprocess", command: "node ${NL_PATH}/extensions/app/main.js" }]`)
was launched under `xvfb`. The extension's own log, verbatim, first six lines:

```
1787985539290 EXT boot pid=2310 node=v22.22.2 argv=[]
1787985539290 EXT env NL_*={}
1787985539352 EXT stdin isTTY=undefined hasWebSocketGlobal=function
1787985539353 EXT stdin chunk bytes=241 raw="{\"nlConnectToken\":\"SIxGDoROCV4ZNM4KnPuZWAX16oko2kfkEbXjfNl6I2MJhHHHc\",\"nlExtensionId\":\"com.kirathecat.appprocess\",\"nlPort\":\"33493\",\"nlToken\":\"IMP7Re8rxgeQ9wcnqVb76aXejZMQ64_QlUcZt7t1kGX_4bi.SIxGDoROCV4ZNM4KnPuZWAX16oko2kfkEbXjfNl6I2MJhHHHc\"}"
1787985539353 EXT handshake parsed keys=["nlConnectToken","nlExtensionId","nlPort","nlToken"]
1787985539367 EXT stdin end
1787985539378 EXT ws open
```

Facts to build on, none of which were assumptions:

1. **The credentials arrive on stdin as one JSON object, followed by EOF.** `process.env` contains
   **no** `NL_*` variable of any kind, and `process.argv` past the script path is empty. P51 §0.3's
   `.tmp/auth_info.json` is a *different* mechanism (`exportAuthInfo`, for the inverted "spawn
   Neutralino from your own process" model) and is not what an extension gets. Because stdin is
   closed after the write, the documented `fs.readFileSync(process.stdin.fd, 'utf-8')` idiom works;
   a streaming read that parses on each chunk works too and is what D2's host module should use
   (it does not block the event loop during boot).
2. **`nlToken` is `<secret>.<nlConnectToken>`.** The connect token is literally the suffix of the
   access token — the client library relies on this (`m().split(".")[1]`). Do not derive one from
   the other; use the two fields as given.
3. **`nlPort` is a string**, not a number.
4. **The URL is** `ws://localhost:{nlPort}?extensionId={nlExtensionId}&connectToken={nlConnectToken}`.
5. **Node 22's global `WebSocket` is sufficient** (`hasWebSocketGlobal=function`). The `ws` and
   `websocket` packages the official sample uses are unnecessary — no new dependency.
6. **Neutralino does not kill the extension on exit.** The extension must `process.exit()` from its
   own `onclose`. Confirmed: every run ends `ws close code=1006 — exiting` or `ws close 1000`.
7. **Config requirements:** `enableExtensions: true`, plus a `nativeAllowList` that admits
   `app.broadcast` (the app→page direction) and `extensions.dispatch` (the page→app direction).
   P51's committed config has `nativeAllowList: ["app.*"]` and no `enableExtensions` — both change.

### 0.2 The two directions, and what they are not

**Page → app process** is `Neutralino.extensions.dispatch(extensionId, event, data)`. The client
library **queues** dispatches issued before the target extension has connected and flushes them on
`extensionReady`, so the renderer needs no readiness gate of its own for this direction.

**App process → page** is a native-method call on the extension's own socket:

```js
ws.send(JSON.stringify({ id: crypto.randomUUID(), method: 'app.broadcast',
                         accessToken: nlToken, data: { event, data } }));
```

The page receives it through `Neutralino.events.on(event, cb)`. Read from the shipped
`neutralino.js` v6.9.0: **`events.on` is `window.addEventListener` and an incoming event is
delivered as `new CustomEvent(event, { detail: data })` dispatched on `window`.** Two consequences
the implementation must respect:

- **Event names share the `window` DOM event namespace.** An event named `message`, `error`,
  `resize` or `focus` would collide with a real DOM event. Every name this phase introduces is
  prefixed `kira:` (D4).
- The payload is at `e.detail`, and it arrives synchronously inside the page's own WebSocket
  `message` handler, after one `JSON.parse` of the entire frame. That parse is the page-side cost
  chunking is protecting against.

**`app.broadcast` does not reach other extensions.** Measured directly: a second extension whose
only job was to count `bulkChunk` events saw **zero** of the 118 chunks the first extension
broadcast in the same run (its log contains one line, `ws open`, and nothing else). Framework
events *are* delivered to extensions — the app process's own log shows `extClientConnect`,
`clientConnect`, `windowFocus`, `appClientConnect` arriving unbidden — which is where D2 gets its
"the page has connected" lifecycle signal from.

### 0.3 The frame-size ceiling — and why it makes the single-message design not merely slow but unusable

An ascending sweep of single-frame payload sizes, two runs, each ending where the socket died:

| base64 body (chars) | ≈ frame | Result |
|---|---|---|
| 11,184,812 | 11.2 MB | OK (572 ms) |
| 22,369,624 | 22.4 MB | OK (2 380 ms) |
| 27,962,028 | 28.0 MB | OK (1 888 ms) |
| 30,758,232 | 30.8 MB | OK (1 888 ms) |
| 31,037,852 | 31.0 MB | OK (2 161 ms) |
| 31,457,280 | 31.5 MB | OK (2 276 ms) |
| 31,876,712 | 31.9 MB | OK (2 334 ms) |
| 32,156,332 | 32.2 MB | **`ws close code=1006` — extension process dies, page never hears anything** |

The ceiling sits between 31.88 MB and 32.16 MB — consistent with **websocketpp's default
`max_message_size` of 32,000,000 bytes** (Neutralino's WebSocket server is websocketpp, per its own
`README.md` licence list). There is **no error frame, no `NE_*` code and no log line**: the socket
simply closes, and the extension's `onclose` handler is the only thing that notices.

This is the decisive argument for chunking, independent of any latency number.
`docs/PERF.md` §2.4 already records that *"at page size 10 000 rows on a wide table, a single page
can exceed 32 MB"* — of **raw** bytes. Base64 inflates that by ×1.333 (22 MB → 30,758,232 chars,
measured). **A single-message design would therefore kill the app process on a page the app is
documented to produce today.** Chunking is not an optimisation here; it is the only design that
works at all.

### 0.4 The chunking benchmark

Method: the app process holds a pre-generated base64 body and broadcasts it as either one frame or
`ceil(len / chunkBytes)` frames, with `await new Promise(r => setImmediate(r))` between frames where
noted. The page reassembles by string concatenation, then `atob`s the result. Concurrently the page
runs a control-channel probe (a small `extensions.dispatch` every 25 ms, answered by an immediate
`app.broadcast`) and a main-thread stall probe (a 10 ms `setInterval`, recording the worst gap).
Three repetitions per configuration; the table gives the **median**. Linux/WebKitGTK under Xvfb —
see §0.10 for what that does and does not transfer.

**4 MB payload** (5.59 MB base64) — roughly a 1 000-row page of a wide table:

| chunk | total ms | TTFB ms | ctl p50 ms | ctl p95 ms | page stall max ms |
|---|---|---|---|---|---|
| whole (1 frame) | 291 | 291 | 185 | 266 | 6 |
| 1 MB | 170 | 51 | 110 | 145 | 7 |
| **256 KB** | **151** | **21** | **76** | **126** | **3** |
| 64 KB | 166 | 7 | 89 | 116 | 4 |
| 16 KB | 218 | 5 | 95 | 166 | 6 |
| 64 KB, no yield | 164 | 7 | 89 | 139 | 4 |

**22 MB payload** (30.76 MB base64) — the largest page that still fits in a single frame at all,
i.e. the worst case §0.3 says must never be sent whole:

| chunk | total ms | TTFB ms | ctl p50 ms | ctl p95 ms | page stall max ms |
|---|---|---|---|---|---|
| whole (1 frame) | 1 726 *(1 404–4 176)* | = total | 1 118 *(865–2 502)* | 1 651 | **174** |
| 1 MB | 787 | 49 | 340 | 602 | 13 |
| **256 KB** | **772** | **27** | **317** | **562** | **6** |
| 64 KB | 857 | 8 | 338 | 618 | 4 |
| 16 KB | 1 039 | 5 | 373 | 718 | 33 |
| 64 KB, no yield | 915 | 8 | 450 | 863 | 4 |

Idle control-channel baseline, same session, nothing else in flight: **p50 29–57 ms, p95 58–86 ms.**

Read-outs:

- **Chunking is faster, not just fairer.** 772 ms vs 1 726 ms at 22 MB; 151 ms vs 291 ms at 4 MB.
- **Time-to-first-byte collapses** from "the whole transfer" to 21–27 ms. Nothing in this phase
  consumes that (progressive rendering is not in scope), but it is what makes progressive rendering
  possible later without another transport change.
- **256 KB is the best or joint-best configuration on every axis at both sizes.** 16 KB pays real
  per-frame overhead (1 878 frames at 22 MB); 1 MB pays TTFB. 64 KB is the runner-up and has a
  better TTFB — if a later phase wires progressive rendering, 64 KB becomes the better default.
- **The `setImmediate` yield between frames matters**, and only for control latency: at 22 MB it
  moves ctl p50 from 450 ms to 338 ms and p95 from 863 ms to 618 ms, at no throughput cost.
- Nothing is ever dropped. Earlier runs that appeared to lose control messages were measuring too
  soon; with a 500 ms grace period every probe was answered in every configuration
  (`neverAcked: 0` throughout). The cost of a bulk transfer is **latency, not loss**.

### 0.5 The single most important measurement: is the residual cost the relay or the process?

The 22 MB rows above still show ctl p50 ≈ 317 ms against a 29–57 ms idle baseline — chunking
improves head-of-line blocking by ~4–8× but does not remove it. To find out *where* that residual
lives, the same run was repeated with a **second, completely idle extension** whose only job was to
answer control pings. If Neutralino's own WebSocket handling serialises everything, the idle
extension's acks are delayed too; if the bottleneck is the busy process, they are not.

| Bulk mode (22 MB) | busy extension — ctl p50 / p95 / max | **idle extension — ctl p50 / p95 / max** |
|---|---|---|
| nothing in flight (baseline) | 29 / 58 / 62 | 30 / 58 / 87 |
| one whole frame | 859 / 1 457 / 1 567 | **88 / 1 004 / 1 085** |
| 256 KB chunks + yield | 349 / 626 / 627 | **49 / 85 / 101** |
| 256 KB chunks, no yield | 405 / 766 / 796 | **47 / 72 / 86** |

**This is the answer the P52 row was waiting for.**

- With **one big frame**, even a process that is doing nothing at all cannot get a small message to
  the page for up to **1.1 s**. Neutralino's relay genuinely serialises: the page's single WebSocket
  is occupied receiving the frame and nothing else gets through.
- With **256 KB chunks**, the idle extension is back at **essentially the idle baseline** (p50 49 ms
  vs 30 ms, p95 85 ms vs 58 ms). **Chunking does prevent head-of-line blocking at the Neutralino
  layer.** The mechanism is not merely "our own event loop stays free" — the relay itself
  interleaves other clients' traffic between chunks.
- The remaining ~317–349 ms p50 is therefore **the busy process's own event loop and outbound
  queue**, not Neutralino. That matters because it is architecturally addressable: moving the
  control channel to a second, control-only extension process would measurably restore control
  latency to baseline. This phase does **not** do that (D2 keeps one app process, as decided), but
  the number that would justify it is now on record (§9 Q2).

### 0.6 `child_process.fork()` — and the default that would have quietly destroyed the engine

Plain Node, no Neutralino involved. The child returns the engine's real payload shape: a
`Uint8Array` of N bytes plus a `Uint32Array` of offsets plus a null bitset (`TextColumnChunk`, see
reality #4).

| payload | `serialization: 'advanced'` | `serialization: 'json'` (**the default**) | typed arrays survive? |
|---|---|---|---|
| 64 KB | 1 ms | 20 ms | advanced **yes** / json **no** |
| 1 MB | 4 ms | 351 ms | advanced yes / json no |
| 4 MB | 11 ms | 2 070 ms | advanced yes / json no |
| 32 MB | 81 ms | **`FATAL ERROR: Reached heap limit — JavaScript heap out of memory`** (V8 stack shows `JsonStringifier::SerializeJSReceiverSlow`) | advanced yes / json — |

`child_process.fork()` defaults to `serialization: 'json'`, which serialises a `Uint8Array` as
`{"0":..,"1":..,…}` — one JSON object property per byte. `utilityProcess.fork` (what
`src/main/engine-host.ts` uses today) defaults to the structured-clone serialiser, so this
regression would be introduced by the migration itself and would have shown up as "the app is
mysteriously slow, then crashes on a big page." **`serialization: 'advanced'` is mandatory** (D3).

Small-message throughput over the same channel: **2 000 sequential request/response round trips in
210 ms — 0.105 ms each.** The app-process↔engine hop is free relative to everything else in this
document. Ordering is FIFO: a 32 MB page queued ahead of a control message is delivered first
(120 ms), so the app process must not rely on `fork()` IPC to prioritise a cancel — cancellation's
latency budget is set by the *renderer→app-process* hop (§0.5), not this one.

### 0.7 A transport that measured better than the one this phase will build

Recorded because it was found while proving §0.3, and because leaving it out would be dishonest.
Neutralino's `Neutralino.server.mount(path, dir)` mounts a directory onto the same built-in static
HTTP server that already serves the app. The page's origin *is* that server, so a `fetch()` of a
mounted file is **same-origin and passes the app's real `default-src 'self'` CSP unchanged**
(verified with the app's exact `<meta>` CSP in place). The app process writes the page to a temp
file; the page fetches it as an `ArrayBuffer`.

Same 22 MB payload, three runs:

| | file write | notify page | `fetch()` → ArrayBuffer | total | ctl p50 / p95 |
|---|---|---|---|---|---|
| run 1 | 145 ms | 156 ms | 339 ms | **495 ms** | 58 / 142 ms |
| run 2 | 125 ms | 142 ms | 292 ms | **434 ms** | 70 / 132 ms |
| run 3 | 149 ms | 172 ms | 312 ms | **484 ms** | 58 / 115 ms |

Idle baseline in that run: 57 / 86 ms. So the sideband is **~1.6× faster than 256 KB chunking**,
delivers a real `ArrayBuffer` with **no base64 and no JSON at all**, has **no 32 MB ceiling**, and
leaves control latency **at the idle baseline**.

It is not adopted, and the reasons are real, not face-saving:

- **It publishes query results on an unauthenticated localhost HTTP server.** Neutralino's static
  server has no token on file reads (`tokenSecurity` guards the WebSocket, not `GET /spool/x.bin`).
  Any local process could `curl` a customer's query results out of the mount. That is a security
  regression against today's in-process `MessageChannelMain`, and this app's whole point is other
  people's databases.
- It adds a temp-file lifecycle (write, serve, fetch, delete, crash-cleanup) to a data path that has
  none today, and turns every page read into disk I/O.
- The user decided the chunked-relay architecture before this document existed, and one measurement
  in one sandbox on the wrong webview engine is not grounds to overturn it unilaterally.

It is raised as **§9 Q1** for the user, with these numbers attached.

### 0.8 Two crashes, found by trying

1. **A native call from the app process before the window exists segfaults the native binary.**
   The extension connects during framework bootstrap — *before* the window and its page client. A
   `window.setTitle` issued at that moment killed the whole process (`EXIT=139`, extension log ends
   `ws open` → `ws close 1006`). With a wait for `appClientConnect` first, **every** native method
   tried succeeded from the app process:

   ```
   EXT CALL window.setTitle    -> {"success":true}
   EXT CALL window.getSize     -> {"returnValue":{"width":900,"height":600,"minWidth":-1,…},"success":true}
   EXT CALL window.getPosition -> {"returnValue":{"x":190,"y":212},"success":true}
   EXT CALL window.setSize     -> {"success":true}
   EXT CALL window.move        -> {"success":true}
   EXT CALL window.setMainMenu -> {"success":true}
   EXT CALL os.getEnv          -> {"returnValue":"/root","success":true}
   EXT CALL app.getConfig      -> {"returnValue":{"applicationId":"com.kirathecat.p52probe",…},"success":true}
   EXT CALL computer.getMemoryInfo -> {"returnValue":{"physical":{"available":15660249088,…}},"success":true}
   EXT CALL debug.log          -> {"message":"Wrote to the log file: neutralino.log","success":true}
   ```

   So **the app process owns the window and the menu directly** — it does not have to ask the page
   to do it, which keeps `src/main/window.ts` and `src/main/menu.ts` structurally where they are
   (D7). The startup gate is mandatory (D5).
2. **The app's real CSP forbids an inline `<script>`.** `script-src 'self'` with no `'unsafe-inline'`
   — an inline probe script was refused with `CONSOLE SECURITY ERROR Refused to execute a script
   because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive`. The
   replacement for `src/preload/index.ts` must therefore be an **external classic script file**,
   exactly as P51's stub already was (D8). This is not a new constraint; it is a constraint that
   would have been discovered the expensive way.

### 0.9 Is this phase buildable and testable in this Linux sandbox?

**Building: yes, entirely.** Every ingredient is present and was exercised: the pinned v6.9.0 binary
(`neutralino/bin/`), `libwebkit2gtk-4.1-0` (already installed on this machine, P51 §0.2's recipe),
`xvfb-run`, Node 22.22.2 with `node:sqlite` and a global `WebSocket`, and `esbuild` (already used by
`scripts/run-ipc-backend.sh`) for the Node-side bundles. Nothing in this phase needs the Electron
binary, and nothing needs `api.github.com` (P51 §0.5's version pin already removed that dependency).

**Testing: partially, and the limit is this phase's own scope, not the sandbox.** P52 explicitly
excludes credential storage, and Neutralino has no `safeStorage` equivalent of any kind (P51 reality
#9 — no keychain/keyring/secure-storage namespace exists). `src/main/connections.ts` calls
`cipher.encrypt(password)` only when `password !== null`, so a connection that carries no secret is
completely unaffected — but **any connection with a password cannot be saved at all** under a
cipher that reports `unavailable` (D12). Of the eleven `tests/db/support/*.ts` fixtures, exactly
four construct a `password: null` config: **sqlite, kafka, s3, sqs**. Those are the adapters this
phase can smoke-test end to end, and §7 picks three of them deliberately.

This is a real, plainly-stated gap, not a sandbox quirk: it would be identical on the target Mac.
Restoring password-bearing connections is a keychain phase, and it is the next thing this migration
needs after P52.

**Two suites stop being runnable, and this phase does not fix them.** `tests/e2e/` is built on
`_electron.launch()` and `tests/ipc/`'s frontend half on `playwright test --project=ipc-frontend`
against an Electron build; deleting `src/preload` and the Electron `main` entry point makes both
un-runnable. P51 §4 already established there is **no** Playwright driver for Neutralino and that
inventing one is its own phase. What survives, and should be proved to still survive (§6):
`tests/unit` (bun), `tests/db` (bun, adapters only — imports no Electron), and the `tests/ipc`
**backend** half, which today runs under `ELECTRON_RUN_AS_NODE=1 electron` purely as a Node runtime
with `--external:electron` — a one-word change in `scripts/run-ipc-backend.sh` runs it under plain
`node` instead. §9 Q3 asks the user what to do with the two dead suites.

### 0.10 What Linux tells you, and what it does not

The same caveat as P51 §0.4, unweakened. Every number above is **WebKitGTK on Linux under Xvfb with
software rendering**, and SPEC §1/§3 scope this product to macOS 13+/arm64, where the engine is
WKWebView. What transfers:

- The **wire protocol** (§0.1–§0.2) is the framework's own JSON-over-WebSocket contract and is
  platform-independent by construction.
- The **32 MB frame ceiling** (§0.3) is websocketpp's, compiled into the same C++ core on every
  platform. It will be the same number on macOS.
- The **`fork()` serialisation finding** (§0.6) is Node's, with no webview involved at all.
- The **shape** of the chunking result — chunked beats whole, the relay serialises whole frames,
  an idle client recovers under chunking — is a property of how the C++ core pumps its sockets, and
  is very likely to hold. The **absolute milliseconds are not macOS numbers** and must not be quoted
  as such.

P51 §9.1 established there is a real Apple Silicon Mac available. Re-running §0.4 and §0.5 there is
§9 Q4.

---

## 1. Ground rules for this phase

- **This phase edits `src/` for real.** P51 D2's "zero edits to `src/`" was correct for a spike and
  is over. `src/main`, `src/preload`, `src/shared/protocol` and exactly one file in `src/renderer`
  change (D9). `src/engine`'s 119 files and `src/renderer`'s other 177 do not.
- **Every adapter comes up at once, and no adapter file is touched.** The ten adapters under
  `src/engine/adapters/` are transport-agnostic (P51 reality #1/#7); they ride along for free once
  the bridge under them works. If an adapter needs a change to make this phase work, that is a
  finding to write down, not a change to make.
- **Best practices throughout, no shortcuts** (AGENTS.md). No half-wired channel, no `TODO`, no
  stubbed error handling. Scope left out is left out entirely — which is why D12 gives the secret
  cipher an *honest* unavailable implementation rather than a fake one.
- **Every claim in the outcome record is backed by a command and its output**, P51/P20 style.
- **The two throwaway proofs stay outside the repo.** §0's scaffolds were built under a scratch
  directory and are not committed. `src/` gets only real code.

### Realities this phase works with (re-counted against the current tree, 2026-08-29)

1. **Only 13 files in `src/` import `electron`**, and `src/renderer` imports it zero times.
   `src/main/index.ts` (`app`, `BrowserWindow`, `ipcMain`, `Menu`, `MessageChannelMain`, `session`),
   `secret-cipher.ts` (`safeStorage`), `window.ts`, `security.ts` (types only), `env.ts` (`app`),
   `engine-host.ts` (`utilityProcess`), `ipc/{settings,files,app,engine,layout,errors}.ts`,
   `menu.ts`, `src/preload/index.ts`, and `src/engine/index.ts` (`import type { MessagePortMain }`,
   type-only). **`src/main/storage/**` — 22 files, the whole SQLite layer — imports no Electron at
   all** and moves to the app process verbatim.
2. **The control surface is 61 channels in four shapes** (`src/shared/protocol/ipc.ts`), registered
   at **41 sites** across `src/main/ipc/*` and `src/main/index.ts`: request/response
   (`ipcMain.handle` + `ipcRenderer.invoke`), main→renderer push (`webContents.send` +
   `ipcRenderer.on`), renderer→main fire-and-forget (`ipcRenderer.send` + `ipcMain.on` — exactly one
   channel, `kira:app:flushed`), and one `MessagePort` transfer (`port: 'kira:port'`).
3. **The bulk protocol is already transport-agnostic.** `src/shared/protocol/port.ts` is 23 lines:
   `PortRequest`/`PortResponse`/`PortEvent`, plus `PingPayload`. Nothing in it mentions Electron or
   `MessagePort`. It carries over untouched (P51 §4 predicted this; re-confirmed).
4. **The bulk payload is columnar packed binary, not rows.** `TextColumnChunk` is
   `{ data: Uint8Array; offsets: Uint32Array; nulls: Uint8Array; truncated: Uint32Array }` with the
   invariant `text of row i = utf8.decode(data.subarray(offsets[i], offsets[i+1]))`. A `TabularPage`
   holds one per column; `DocumentPage` two; `KeyValuePage` two; `StreamPage` five. **This is why
   "100 rows per message" is not the right chunk unit** (D6): a row boundary is not a buffer
   boundary, and row width varies from ~20 bytes to `MAX_CELL_BYTES` = 64 KB per cell.
5. **`assertPageStructure` is a hard `instanceof` contract.** `src/shared/protocol/page.ts:588`
   throws unless `data`/`nulls` are genuine `Uint8Array`s and `offsets`/`truncated` genuine
   `Uint32Array`s, with `offsets.length === rowCount + 1` and `nulls.length === ceil(rowCount/8)`.
   `src/renderer/bridge/data.ts:33` calls it on every read. Whatever rehydrates a page on the other
   side of the relay must satisfy this exactly — including `Uint32Array`'s 4-byte alignment
   requirement when constructed as a view over a shared buffer.
6. **`window.kira` is captured once at module scope** (`src/renderer/bridge/control.ts:34`), so its
   replacement must still be installed by a classic script ordered before the app's module tag —
   and, per §0.8 item 2, from an external file, never inline.
7. **Cancellation never travelled over the `MessagePort`.** `src/main/ipc/ops.ts` sends
   `IPC.opsCancel` → `engineHost.call(ENGINE_OP.cancel)` over the control channel →
   `src/engine/control.ts`'s `handleCancel` → `scheduler/ops.ts`'s `cancelOp` → the op's
   `AbortController`. The data port was never involved, so this phase does not change cancellation's
   *semantics* — only the latency of its first hop (D10).
8. **`app.getAppMetrics()` has no Neutralino analogue.** `src/main/index.ts:120`'s 5 s timer sums
   `cpu.percentCPUUsage` and `memory.workingSetSize` across every Electron process to feed
   `IPC.appMetrics` and the status bar. `computer.getMemoryInfo` returns **system-wide** physical and
   virtual memory (verified, §0.8), not per-process anything. The window's WebKit helper processes
   are children of the native binary and are not reachable from Node without walking the process
   table (P51 §9.1 had to do exactly that, by spawn-timestamp correlation, to get a number at all).
9. **Neutralino has no window resize/move event.** The v6.9.0 `Builtin` event union is
   `ready | trayMenuItemClicked | windowClose | serverOffline | clientConnect | clientDisconnect |
   appClientConnect | appClientDisconnect | extClientConnect | extClientDisconnect | extensionReady |
   neuDev_reloadApp`. `src/main/window.ts`'s debounced `resize`/`move` bounds persistence has nothing
   to subscribe to (D7). The binary also emits `mainMenuItemClicked` and `windowFocus`, **neither of
   which is in the published `.d.ts` union** — found by `strings` on the binary and by observing them
   arrive. The menu wiring depends on the first of these.
10. **The renderer's transport module is 98 lines.** `src/renderer/bridge/port.ts` exposes exactly
    three things to the rest of the app: `ready`, `request(op, payload, opts)`, `onPortEvent(topic,
    cb)`. `bridge/data.ts` and `bridge/control.ts` are its only consumers. This is the one renderer
    file this phase rewrites (D9).
11. **Four `tests/db/support/*.ts` fixtures are passwordless** — `sqlite`, `kafka`, `s3`, `sqs` —
    and seven are not. `tests/db/support/sqlite.ts` seeds `BIG_ROWS = 1_000_000`, which is what makes
    a real 10 000-row page reachable in a Docker-free smoke test (§7).
12. **Two unit specs test modules this phase changes**: `tests/unit/security.spec.ts` (47 lines,
    imports `src/main/security.ts` directly) and `tests/unit/menu.spec.ts` (45 lines, mocks
    `electron` and walks `buildMenu`'s template). Everything else under `tests/unit` is
    renderer/engine logic and is untouched.

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Scope: replace `src/main`'s Electron-specific code and P51's `window.kira` stub with a real Neutralino-hosted bridge, bringing every adapter up at once.** Not staged adapter-by-adapter. | Decided with the user before this plan was written, and correct on the evidence: the ten adapters under `src/engine/adapters/` are transport-agnostic and were unmodified by P51 (reality #1, P51 realities #1/#7). Staging by adapter would stage nothing — the adapters are not what is at risk; the bridge under them is. |
| D2 | **One Node process — "the app process" — registers as the sole Neutralino extension** (`com.kirathecat.appprocess`). It owns the handshake, the WebSocket, the SQLite storage layer, the connections/tree services, the op log, the window, the menu, and the engine's lifecycle. | The decided architecture. It is also the only shape that keeps `src/main`'s existing services intact: 22 of its 50 files (the whole `storage/` tree) import no Electron and simply move. §0.1 proved the handshake; §0.8 proved this process can drive the window and menu itself, so nothing has to be delegated to the page. |
| D3 | **The engine is spawned with `child_process.fork(engine.js, [], { serialization: 'advanced', execArgv: ['--max-old-space-size=' + maxOldSpaceMb] })`.** Not `utilityProcess.fork` (Electron-only), and **never** the default `serialization`. | Plain Node-to-Node IPC needs no Neutralino involvement, and `execArgv` keeps the existing user-facing `advanced.engineMemoryCapMb` setting meaningful. `'advanced'` is not a tuning choice: §0.6 measured the default at 2 070 ms for a 4 MB page (vs 11 ms), an OOM crash at 32 MB, and — worse — silent destruction of every `Uint8Array`/`Uint32Array`, which `assertPageStructure` (reality #5) would then reject on every single read. |
| D4 | **The wire is `extensions.dispatch` (page → app process) and `app.broadcast` (app process → page), with every event name prefixed `kira:`.** Six names total: `kira:relay:open`, `kira:relay:req`, `kira:relay:res`, `kira:relay:chunk`, `kira:relay:evt`, `kira:ctl`. | The decided mechanism, verified in both directions (§0.2). The prefix is not cosmetic: `Neutralino.events.on` is `window.addEventListener` and an incoming event is a `CustomEvent` dispatched on `window`, so an unprefixed name like `message` or `error` would collide with a real DOM event and be delivered to unrelated listeners. |
| D5 | **The app process makes no `window.*` native call until it has seen `appClientConnect`.** That event, not `did-finish-load`, is the relay's attach point and bumps the generation counter. | §0.8 item 1: calling `window.setTitle` during bootstrap **segfaults the native binary** (exit 139). `appClientConnect` is delivered to the extension unbidden (§0.2) and means exactly what `did-finish-load` meant: a page is there to talk to. It is also the correct replacement for `src/main/index.ts:131`'s `attachPort`, including for a renderer reload. |
| D6 | **Bulk responses are chunked at 256 KB of base64 text per frame, with `await setImmediate()` between frames; anything at or under 256 KB goes in one frame; a hard 1 MB per-frame cap is enforced in code.** The chunk unit is **bytes, not rows**. | §0.4: 256 KB is the best or joint-best configuration on total time, TTFB, control latency and page stall, at both 4 MB and 22 MB. The yield is worth 100 ms of p50 control latency at 22 MB for free (§0.4). Bytes-not-rows because the wire form is columnar (reality #4) — a row boundary is not a buffer boundary, and "100 rows" is a 20 KB frame for a narrow table and a 6 MB frame for a wide one, which is precisely the variable the measurements say matters. The 1 MB cap is a guard against the §0.3 ceiling: a frame over ~32 MB closes the socket **silently**, with no error, and kills the app process. |
| D7 | **A relay codec lives in `src/shared/protocol/relay.ts`: it splits a `PortResponse` into a JSON envelope with `{ "__b": i, "t": "u8"\|"u32" }` placeholders plus one concatenated, 4-byte-aligned binary blob, base64s the blob, and rehydrates typed-array views on the other side.** One encoder, one decoder, one place that knows about base64. | The relay is JSON-only; a `Uint8Array` cannot cross it. Serialising each `TextColumnChunk` field independently would mean N base64 strings and N chunk-boundary cases; one blob means the chunker is a `String.prototype.slice` loop and the page's decoder is one `atob` (measured at 71–98 ms for 30.8 MB). 4-byte alignment is mandatory, not tidiness: `new Uint32Array(buffer, byteOffset, len)` throws unless `byteOffset % 4 === 0`, and reality #5 requires genuine `Uint32Array`s. Living in `src/shared` means both endpoints share one definition and one unit test. |
| D8 | **`src/preload/index.ts` is deleted. It is replaced by `src/bridge/` — plain TypeScript, bundled by esbuild to one classic (non-module) `kira-bridge.js` that the shell's `index.html` loads before the app's module tag.** | Neutralino has no `contextBridge`, no isolated world and no `ipcRenderer`, so nothing in that file survives. But the *ordering* constraint does (reality #6): `window.kira` is captured at module scope, so the object must exist before the app's module runs. And the file must be external, not inline — §0.8 item 2 measured the app's own CSP refusing an inline script. This is P51's `kira-stub.js` shape, built from real source instead of hand-written fakes. |
| D9 | **`src/renderer` changes in exactly one file: `bridge/port.ts` is rewritten as the chunk-reassembling transport.** `bridge/control.ts`, `bridge/data.ts` and the other 177 renderer files are untouched. | Preferred over changing more, per P51 D2's spirit — but said plainly rather than contorted around: `port.ts` **is** the transport, and the transport is what this phase replaces. Its entire public surface is `ready`, `request()` and `onPortEvent()` (reality #10); reassembly and rehydration hide behind `request()`, so `data.ts`'s `await request(DATA_OP.read, …)` and every call site above it are character-for-character unchanged, including `assertPageStructure` still running on the result. |
| D10 | **Cancellation keeps today's path and semantics; a cancel additionally aborts an in-flight relay stream.** The renderer→app-process hop's latency under load is documented, not hidden. | Reality #7: `opsCancel` never used the data port, so the `AbortController`/`assertNotCancelled` machinery inside the engine is untouched and still stops a running query exactly when it does today. What chunking changes is only the transfer: a cancel arriving mid-stream drops the undelivered chunks (app process stops enqueuing, renderer discards by request id). **Chunking does not let a cancel stop the query any earlier** — the engine produces a whole page before the first chunk exists — and the plan says so rather than implying otherwise. Measured cost of the first hop: ~30–57 ms idle, **p50 317–349 ms / p95 562–626 ms while a 22 MB relay is running through the same app process** (§0.4, §0.5). |
| D11 | **`src/main/security.ts` and `tests/unit/security.spec.ts` are deleted, not ported. What the app loses is written into `docs/ARCHITECTURE.md` in their place.** | Every entry in that module is a Chromium/Electron capability toggle — `webPreferences`, `session` permission handlers, `will-frame-navigate`, `webviewTag`, the spellchecker, WebGL, `electronFuses`. **None has a Neutralino equivalent**, and there is nothing to turn off because there is no Chromium. Leaving a dead module that configures a runtime the app no longer uses would be exactly the "stubbed" thing AGENTS.md forbids. The audit itself is valuable and survives as prose: Neutralino's posture is a different model (`nativeAllowList`, `tokenSecurity`, a localhost HTTP server plus WebSocket the page talks to) that needs auditing from scratch, and that audit is not this phase. |
| D12 | **`createSecretCipher()` is reimplemented in the app process to report `{ available: false, backend: 'unavailable', insecureFallback: false, reason: … }` on every platform, and to throw `SecretStoreError` from `encrypt`.** No keychain, no obfuscation, no environment-variable fallback. | Credential storage is out of scope for this phase by the SPEC row's own words. The honest expression of "out of scope" is the failure mode P25 D13 already designed for this exact situation: a password-bearing save fails **visibly** at the dialog rather than silently writing plaintext. `connections.ts` already guards every cipher call with `password !== null`, so passwordless connections work fully. Inventing a Node `basic_text` analogue would be building the keychain phase badly, inside a phase that excluded it. |
| D13 | **`src/main` keeps its directory name.** "Main process" is Electron vocabulary, and this is now the app process — but the rename is carried in the docs and the plan, not in 50 file paths. | A 50-file `git mv` buys one word, inflates the diff that reviews this phase's real risk (the relay), and makes every future `git log` traversal cross a rename boundary for no behavioural reason. `docs/ARCHITECTURE.md` gets one sentence establishing the vocabulary instead. |
| D14 | **`tests/` is edited in exactly three places** — delete `tests/unit/security.spec.ts` (D11), rewrite `tests/unit/menu.spec.ts` against the Neutralino menu shape, add `tests/unit/relay-codec.spec.ts` — and `tests/e2e/` and the `tests/ipc/` frontend half are left in the tree, un-runnable, for a later decision. | Reality #12: those two specs import modules this phase deletes or rewrites; leaving them broken is not an option and rewriting them is a few lines. The two dead suites are a different matter: P51 §4 established there is no Playwright driver for Neutralino at all, so "port them" is not a small task hiding in this phase — it is a phase. Deleting them destroys the record of what the app is supposed to do; leaving them destroys `bun run test:e2e`. §9 Q3 asks the user. |
| D15 | **`docs/ARCHITECTURE.md`'s Process model and Renderer security surface sections are rewritten, and the invariant "Bulk data skips the main process" is deleted rather than softened.** | It is simply no longer true. Every result page now transits the app process — engine → `fork()` IPC → app process → base64 → 256 KB frames → WebSocket → native binary → page. `docs/PERF.md` §2.1's interaction budgets were measured under a design where the old invariant held, which is a fact about those budgets that the next perf phase needs to be told (§4). Softening the sentence would leave a document that quietly lies. |
| D16 | **`electron.vite.config.ts` is replaced by `vite.config.ts` (renderer only) plus `scripts/build-app.sh` (esbuild for the app process, the engine and the bridge script).** `electron-builder.yml` and `scripts/verify-packaging.sh` are left untouched and dead. | `electron-vite` exists to build a main/preload/renderer triple, and two of those three are gone. esbuild is already this repo's Node-side bundler (`scripts/run-ipc-backend.sh`, `test:db:kafka`), so it is not a new tool. Packaging is out of scope by the SPEC row, so its config is not rewritten — and P51 §0.6 item 2 already established that Neutralino packaging is from scratch, not a port. |
| D17 | **The `neutralino/` shell from P51 is kept and extended, not rebuilt**: `enableExtensions: true`, an `extensions` entry, a widened `nativeAllowList`, and `scripts/build-neutralino-shell.sh` gains the app-process/engine/bridge copy steps. The `6.9.0` version pin (P51 D6) stands. | It already works, it is already committed, and its five files are exactly the right five. Reproducibility depends on the pin surviving (P51 §0.5: unpinned, this sandbox's `api.github.com` 403 silently resolves the runtime to `nightly`). |
| D18 | **The app process's own log goes through `src/main/log.ts` to `~/.kira-studio/logs`, not to stdout.** | An extension's stdout is inherited from the native binary and is not a reliable channel (under `neu run` it is interleaved with CLI output; run directly it goes wherever the process was launched from). The app already has a file logger with rotation (`sweepOldLogs`), and the engine's stdout/stderr already funnel into it — that stays true, with `child.stdout`/`child.stderr` from `fork({ stdio: ['ipc', 'pipe', 'pipe'] })` replacing `utilityProcess`'s. |

---

## 3. Implementation order

Written for a Sonnet session with no memory of §0's research. Where a step has a failure mode that
was actually hit, it is named.

### Stage 0 — environment

1. `apt-get update && apt-get install -y libwebkit2gtk-4.1-0` if `ldconfig -p | grep -c webkit2gtk`
   is 0 (P51 §0.2 — the `apt-get update` is mandatory or four packages 404). `xvfb-run` is present.
2. `bun install` at the repo root if `node_modules/` is empty. **The Electron binary is not needed
   for anything in this phase.**
3. Confirm the toolchain: `node --version` ≥ 22 (global `WebSocket`, `node:sqlite`),
   `node -e "console.log(typeof WebSocket)"` → `function`.

### Stage 1 — the wire, proved before anything is built on it

4. Write `src/main/neutralino/host.ts` — **the only file in the repo that knows the wire format**:
   - Read stdin incrementally, `JSON.parse` on each chunk until it succeeds; the object has
     `nlPort` (a **string**), `nlToken`, `nlConnectToken`, `nlExtensionId` (§0.1).
   - Connect to `ws://localhost:${nlPort}?extensionId=${nlExtensionId}&connectToken=${nlConnectToken}`
     using the **global `WebSocket`** — no new dependency.
   - `onclose` → `process.exit(0)`. Neutralino does not kill extensions (§0.1 item 6); without this
     the process leaks on every quit.
   - `nativeCall(method, data)` — send `{ id: crypto.randomUUID(), method, accessToken: nlToken, data }`,
     resolve on the matching `id`, reject on `data.error`.
   - `broadcast(event, data)` — `nativeCall('app.broadcast', { event, data })`.
   - `on(event, handler)` for inbound `{ event, data }` frames, including the framework's own
     (`appClientConnect`, `appClientDisconnect`, `windowClose`, `mainMenuItemClicked`).
   - **A `whenWindowReady` promise that resolves on the first `appClientConnect`.** Nothing may call
     a `window.*` method before it — §0.8 item 1: doing so **segfaults the native binary**, exit 139,
     with the extension log ending at `ws open`.
5. Update `neutralino/neutralino.config.json`: add `"enableExtensions": true`; add
   `"extensions": [{ "id": "com.kirathecat.appprocess", "command": "node ${NL_PATH}/app/index.js" }]`;
   widen `nativeAllowList` to `["app.*", "extensions.*", "window.*", "os.*", "computer.*",
   "debug.log"]`. Keep `binaryVersion`/`clientVersion` pinned to `"6.9.0"` (P51 D6).
6. **Prove it before going further**: a temporary boot that logs the handshake, broadcasts
   `kira:relay:open` after `whenWindowReady`, and answers one `kira:relay:req`. Run under
   `xvfb-run -a` with `enableInspector: true` and confirm a round trip in the CLI's stdout. If the
   process dies at `ws open` with exit 139, a `window.*` call escaped the gate.

### Stage 2 — the relay codec, with a unit test before a consumer

7. Write `src/shared/protocol/relay.ts`:
   - `encodeFrame(value)` → `{ envelope: unknown; blob: Uint8Array }`. Walk the value; replace each
     `Uint8Array`/`Uint32Array` with `{ __b: index, t: 'u8' | 'u32' }` and append its bytes to the
     blob, **padding to a 4-byte boundary before each `Uint32Array`** and recording `byteOffset`
     and `length`.
   - `decodeFrame(envelope, blob)` → the value, with `new Uint8Array(buf, off, len)` /
     `new Uint32Array(buf, off, len)` views over one `ArrayBuffer`.
   - `chunkBase64(b64, size)` / a reassembler. `CHUNK_BYTES = 256 * 1024` and
     `MAX_FRAME_BYTES = 1024 * 1024` are exported constants with a comment naming §0.3's ~32 MB
     socket-killing ceiling as the reason the cap exists.
8. `tests/unit/relay-codec.spec.ts`: round-trip a real `TabularPage` built by
   `createTabularPageBuilder` and assert `assertPageStructure` passes on the decoded copy —
   `instanceof Uint32Array` for `offsets`/`truncated`, `offsets.length === rowCount + 1`,
   `nulls.length === ceil(rowCount/8)`, and byte-identical cell text. Include a page whose column
   count forces an odd `data` length, so the alignment padding is actually exercised (without it,
   `new Uint32Array(buf, off, len)` throws).

### Stage 3 — the app process

9. `src/main/index.ts`: replace the Electron boot. No `app.whenReady`, no `BrowserWindow`, no
   `Menu.setApplicationMenu`, no `session`. New order: `host.connect()` → `ensureLayout()` →
   `sweepOldLogs()` → `openDb()` → `migrate()` → `upgradeLegacySecrets()` → `getAllSettings()` →
   `startEngine()` → services → `registerIpc()` → `await host.whenWindowReady` → window bounds,
   menu, `broadcast('kira:relay:open', { generation })`.
10. `src/main/engine-host.ts`: `utilityProcess.fork` → `child_process.fork(join(__dirname,
    'engine.js'), [], { serialization: 'advanced', stdio: ['ipc', 'pipe', 'pipe'], execArgv:
    ['--max-old-space-size=' + opts.maxOldSpaceMb] })`. **`serialization: 'advanced'` is not
    optional** — §0.6. `attachRendererPort(port, generation)` becomes `attachRelay(generation)`;
    `child.postMessage` becomes `child.send`; `child.on('message'|'exit')` are unchanged in shape.
    `stop()` becomes `child.kill()`. Everything else — the pending map, the timeout, `EngineHostError`,
    the `engine:down` fan-out — is untouched.
11. `src/engine/index.ts`: `process.parentPort.on('message', …)` → `process.on('message', …)`; drop
    the `attach-port` branch and the `MessagePortMain` import entirely. Data-op responses go back
    with `process.send(response)` exactly like control-op responses already do. `src/engine/rpc.ts`'s
    `transfer` pass-through becomes genuinely unreachable — **delete it and its doc comment**, and
    say so in the outcome record; it was plumbing for a capability that this transport definitively
    does not have.
12. `src/main/ipc/registry.ts` and the 12 `ipc/*.ts` files: `ipcMain.handle(channel, fn)` →
    `host.handle(channel, fn)`, `ipcMain.on` → `host.onFireAndForget`. Drop the unused
    `IpcMainInvokeEvent` first argument at all 41 sites. `ipc/errors.ts` keeps `toIpcError`'s
    `[CODE] message` folding verbatim — the renderer branches on that prefix and must keep seeing it.
    `ipc/files.ts` loses `BrowserWindow.fromWebContents` (single window) and swaps
    `dialog.showSaveDialog`/`showOpenDialog` for `os.showSaveDialog(title, { defaultPath, filters })`
    → `string` and `os.showOpenDialog(title, { filters })` → `string[]`; **neither returns a
    `canceled` flag**, so map empty/`''` to `{ canceled: true, … }` to preserve
    `FilesChooseSaveResult`/`FilesChooseOpenResult`. `ipc/app.ts`'s `AppInfo` loses `electron` and
    `chrome`: fill them from `NL_VERSION`/`NL_CVERSION` via `app.getConfig` (§0.8 shows the call
    works from the app process) and rename in `src/shared/protocol/ipc.ts` — this is the one
    `AppInfo` field change and the Settings > About view is its only consumer.
13. `src/main/window.ts`: `BrowserWindow` → `host.nativeCall('window.setSize'|'window.move'|
    'window.getSize'|'window.getPosition')`. Restore persisted bounds **after**
    `whenWindowReady` (D5). **There is no resize or move event to subscribe to** (reality #9) — the
    bridge script installs a `window.onresize` listener in the page and reports the new bounds over
    `kira:ctl`, which the app process debounces at the existing 300 ms and writes with `setLayout`.
    Record the visible consequence: the window opens at `neutralino.config.json`'s size and is then
    resized to the persisted bounds, so cold start has a visible resize that Electron did not have.
14. `src/main/menu.ts`: the Electron template → a `WindowMenu` array
    (`{ id, text, action?, shortcut?, isDisabled?, isChecked?, menuItems? }`) passed to
    `host.nativeCall('window.setMainMenu', { menu })` after `whenWindowReady`. Clicks arrive as the
    **`mainMenuItemClicked`** event — present in the binary's strings and observed at runtime, but
    **absent from the published v6.9.0 `.d.ts` `Builtin` union** (reality #9), so type it locally.
    Each item's `id` maps to one of the 11 `kira:menu:*` channels, broadcast to the page unchanged.
    `@shared/domain/shortcuts`'s `accelerator()` produces Electron accelerator strings
    (`CmdOrCtrl+…`); Neutralino's `shortcut` field is a different, thinner format — convert in
    `menu.ts`, do not change `shortcuts.ts`, and verify at least one shortcut actually fires before
    trusting the rest.
15. `src/main/secret-cipher.ts`: D12's unavailable-everywhere implementation. Keep the
    `SecretCipher` interface, `SecretStoreError`, the `kira:v1:` envelope constant and
    `isEnveloped`/`decrypt`'s pass-through-if-not-enveloped behaviour (an existing
    `~/.kira-studio/kira.sqlite` may hold enveloped values that can no longer be read — `decrypt`
    must throw `SecretStoreError` for those, not return ciphertext as a password).
16. Delete `src/main/security.ts` and `src/main/env.ts`'s Electron `app` import (`isDevBuild`
    becomes an esbuild `define` or `process.env.NODE_ENV`). Delete `tests/unit/security.spec.ts`.
17. `src/main/relay.ts` (new) — the chunked sender:
    - One outbound queue. For each `PortResponse`/`PortEvent`: `encodeFrame` → base64 the blob →
      if `≤ CHUNK_BYTES`, one `kira:relay:res`/`kira:relay:evt`; else `kira:relay:res` carrying the
      envelope and `{ chunks: n, b64Bytes }`, then `n` × `kira:relay:chunk` `{ id, seq, body }`,
      **`await setImmediate()` between every frame** (§0.4 — worth ~100 ms of p50 control latency
      at 22 MB, for free).
    - **Assert every outbound frame is under `MAX_FRAME_BYTES` and throw if not.** §0.3: an
      oversized frame closes the socket with **no error and no log line**, and the extension dies.
    - Concurrent streams from different tabs interleave by request id; round-robin between active
      streams rather than draining one before starting the next, so a second tab's small read is
      not stuck behind a 10 000-row page. *(Single-stream behaviour is measured in §0.4; the
      multi-stream case is designed for but was not measured — §6 asks for it to be verified.)*
    - A cancel for an in-flight stream drops its remaining chunks and sends `kira:relay:chunk`
      with `{ id, aborted: true }` (D10).

### Stage 4 — the renderer's two doors

18. `src/bridge/` (new, replacing `src/preload/`): plain TypeScript compiled to **one classic
    script**, `kira-bridge.js`, that
    - builds `window.kira` with the same 61-member `KiraApi` surface — each request/response member
      is `dispatch('kira:relay:req', { channel, payload })` awaiting a matching `kira:relay:res`;
      each `on*` member is a `Neutralino.events.on` subscription returning an unsubscribe;
      `appFlushed()` is a fire-and-forget dispatch;
    - calls `Neutralino.init()` and installs the page-side `window.onresize` reporter (step 13);
    - **must not be an inline `<script>`** — §0.8 item 2 measured the app's own CSP refusing one.
19. `src/renderer/bridge/port.ts` (rewrite, D9): keep `ready`, `request(op, payload, opts)` and
    `onPortEvent(topic, cb)` byte-identical in signature, plus `rejectAllPending` on a new
    `generation`. Internally: subscribe to `kira:relay:open`/`res`/`chunk`/`evt`; accumulate chunk
    bodies per request id in an array and `join('')` once at the end (measured: `atob` of 30.8 MB
    takes 71–98 ms); `decodeFrame` and resolve. `bridge/data.ts`'s `assertPageStructure(response.page)`
    must pass unchanged — that is the acceptance test for D7's codec against the real data path.
20. Delete `src/preload/index.ts` and `IPC.port` from `src/shared/protocol/ipc.ts`. Update
    `src/renderer/env.d.ts` only if `KiraApi` changed (it should not, beyond `AppInfo`'s two fields).

### Stage 5 — build, shell, docs

21. `vite.config.ts` (renderer only, keeping `base: './'`, `root: 'src/renderer'` and the existing
    aliases) plus `scripts/build-app.sh`: esbuild `src/main/index.ts` → `out/app/index.js`,
    `src/engine/index.ts` → `out/app/engine.js`, `src/bridge/index.ts` → `out/bridge/kira-bridge.js`
    (`--format=iife`), all `--platform=node --bundle --loader:.sql=text` with the same externals
    `scripts/run-ipc-backend.sh` already uses (`@confluentinc/kafka-javascript`, `ssh2`,
    `cpu-features`). Delete `electron.vite.config.ts`. Update `package.json`'s `dev`/`build`/`start`.
22. `scripts/build-neutralino-shell.sh`: keep P51's copy-and-inject, and add copying `out/app/` to
    `neutralino/app/` and `out/bridge/kira-bridge.js` into `neutralino/resources/`; inject
    `<script src="./kira-bridge.js"></script>` in place of P51's `kira-stub.js` tag; keep it
    idempotent. Delete `neutralino/kira-stub.js` — it is superseded, and leaving a fake platform
    surface in the tree beside a real one invites the wrong one being loaded.
23. `docs/ARCHITECTURE.md`: rewrite the Process model section (new diagram, and **delete** the
    "Bulk data skips the main process" invariant — D15) and the Renderer security surface section
    (replace the Chromium capability table with what Neutralino's model is and what was lost — D11).
    One sentence establishing that "main" now means the app process (D13).
24. Append an **Outcome** section to this file and one implementation paragraph to SPEC §10's P52
    row, P48/P49/P50/P51 style.

---

## 4. Explicitly out of scope — and what each would actually take

- **OS keychain / credential storage.** Unchanged from P51 §4 and now load-bearing: without it, a
  password-bearing connection cannot be saved at all (D12, §0.9), which is most of them. The three
  routes P51 named (a native extension with Keychain bindings; a C++ Neutralino fork; shelling out to
  `security add-generic-password`) all still stand, and one of them is now the **highest-priority
  follow-on** — this phase leaves the app functional only for passwordless connections.
- **Packaging, signing, notarization.** P51 §0.6 item 2: `neu build --macos-bundle` is
  `fs.renameSync(binary, binary + '.app')` and nothing more. On top of everything P51 listed, P52
  adds a hard new requirement: the extension is launched by a **shell command**
  (`node ${NL_PATH}/app/index.js`), so a distributed `.app` must **vendor a real Node runtime** and
  use `commandDarwin` to point at it. That is the same conclusion the parallel Wails spike reached
  independently, and it is also what makes `electron-builder.yml`'s `electronFuses` reasoning
  (S6/S7 — "not usable as a general-purpose Node runtime") apply *more* strongly, not less.
- **An E2E harness.** P51 §4, unchanged: Playwright has an Electron driver and a browser driver and
  no Neutralino driver; WebKitGTK/WKWebView do not speak CDP. This phase's concrete new consequence
  is that `tests/e2e/` and the `tests/ipc/` frontend half stop running (D14, §9 Q3).
- **Progressive rendering of a chunked page.** The measurements make it possible — TTFB drops from
  ~1.7 s to ~27 ms at 22 MB (§0.4) — and the relay's chunk framing is exactly what a progressive
  grid would consume. It is not built: `bridge/port.ts` reassembles and resolves one promise,
  because that is what keeps `bridge/data.ts` and all 177 renderer files unchanged (D9).
- **A second, control-only extension process.** §0.5 quantifies what it would buy (control latency
  back at the ~30–50 ms idle baseline during a bulk transfer, instead of ~317–349 ms p50). D2 keeps
  one app process because that is the decided architecture and because 317 ms is not a broken cancel
  button. §9 Q2.
- **Re-measuring `docs/PERF.md`.** No number is edited, no budget relaxed. §2.1's interaction budgets
  were measured under a design where bulk data bypassed the hub process, which D15 deletes — that is
  recorded as a fact about those budgets, not acted on. §2.2's Electron figures must stay comparable
  to themselves (P51 D8's reasoning, unchanged), and §0.4's Linux figures do not go there.
- **`app.getAppMetrics()`'s replacement.** `IPC.appMetrics` and the status bar's CPU/memory readout
  have no Neutralino analogue (reality #8). The channel and its `AppMetricsSample` stay; the app
  process fills them from `process.memoryUsage().rss` plus the engine child's, and **the WebKit
  helper processes are simply not counted**. The status bar therefore under-reports. This is
  recorded, not fixed — a correct number needs a process-table walk (P51 §9.1 had to do exactly that
  by spawn-timestamp correlation) and belongs with the perf phase, not here.
- **A recommendation for or against migrating.** P51 established the frontend renders; P52
  establishes the engine can reach it with real data. Neither establishes that the migration is a
  good idea, and §8 lists what would still have to be true.

---

## 5. Target tree

```
src/main/                                 the app process (D2, D13 — name kept, meaning changed)
  index.ts                          MOD   Neutralino boot; no app/BrowserWindow/Menu/session
  neutralino/host.ts                NEW   stdin handshake, WS, nativeCall/broadcast/on, whenWindowReady
  relay.ts                          NEW   chunked outbound stream, 256 KB frames, 1 MB hard cap (D6)
  engine-host.ts                    MOD   child_process.fork + serialization:'advanced' (D3)
  window.ts                         MOD   Neutralino window.* ; page-reported resize (reality #9)
  menu.ts                           MOD   WindowMenu + mainMenuItemClicked
  secret-cipher.ts                  MOD   unavailable on every platform (D12)
  env.ts                            MOD   no electron `app`
  security.ts                       DEL   no Neutralino equivalent; audit moves to docs (D11)
  ipc/registry.ts, ipc/*.ts (12)    MOD   host.handle / host.onFireAndForget, 41 sites
  ipc/files.ts                      MOD   os.showSaveDialog / os.showOpenDialog
  connections.ts, tree-service.ts,
    oplog.ts, engine-config.ts,
    log.ts, preconnect.ts            --   UNCHANGED (import no electron)
  storage/** (22 files)              --   UNCHANGED (node:sqlite; imports no electron)
src/bridge/                         NEW   replaces src/preload — classic script, real window.kira (D8)
  index.ts                          NEW
src/preload/index.ts                DEL   contextBridge has no Neutralino equivalent
src/shared/protocol/
  relay.ts                          NEW   typed-array <-> JSON+blob codec, chunk constants (D7)
  ipc.ts                            MOD   remove `port`; AppInfo.electron/chrome -> neutralino/webview
  port.ts                            --   UNCHANGED (already transport-agnostic, reality #3)
  page.ts                            --   UNCHANGED
src/engine/
  index.ts                          MOD   process.on('message') ; no MessagePortMain, no attach-port
  rpc.ts                            MOD   delete the now-unreachable `transfer` pass-through
  adapters/** (10 adapters)          --   UNCHANGED (D1 — the whole point)
src/renderer/
  bridge/port.ts                    MOD   chunk reassembly + rehydration behind the same 3 exports (D9)
  everything else (177 files)        --   UNCHANGED
neutralino/
  neutralino.config.json            MOD   enableExtensions, extensions[], wider nativeAllowList
  kira-stub.js                      DEL   superseded by the real bridge (D8)
  app/                             (ign)  copied out/app/ — the app process + engine bundles
  resources/                       (ign)  copied out/renderer/ + kira-bridge.js
scripts/
  build-app.sh                      NEW   esbuild: app process, engine, bridge (D16)
  build-neutralino-shell.sh         MOD   also copies out/app/ and the bridge script
  run-ipc-backend.sh                MOD   ELECTRON_RUN_AS_NODE=1 electron -> node (§0.9)
  verify-packaging.sh                --   UNCHANGED and dead (packaging out of scope)
vite.config.ts                      NEW   renderer only (D16)
electron.vite.config.ts             DEL
electron-builder.yml                 --   UNCHANGED and dead
tests/unit/security.spec.ts         DEL   with its module (D11)
tests/unit/menu.spec.ts             MOD   Neutralino WindowMenu shape (D14)
tests/unit/relay-codec.spec.ts      NEW   round-trip vs assertPageStructure (D7)
tests/db/**, tests/ipc/**/*.backend  --   UNCHANGED and still runnable
tests/e2e/**, tests/ipc frontend     --   UNCHANGED and NOT runnable (D14, §9 Q3)
docs/ARCHITECTURE.md                MOD   Process model + Renderer security surface (D11, D15)
docs/PERF.md                         --   UNCHANGED (§4)
docs/v1/plans/P52-…md               MOD   this file + an Outcome section
docs/v1/SPEC.md                     MOD   §10 P52 row: one appended implementation paragraph
```

---

## 6. Acceptance checklist

- [ ] The app process's log shows the §0.1 handshake — four keys on stdin, then `ws open` — and the
      process exits by itself when the window is closed (no orphan `node` after quit).
- [ ] `src/main/neutralino/host.ts` is the **only** file in `src/` containing the strings
      `app.broadcast`, `accessToken` or `nlToken`.
- [ ] `grep -rn "from 'electron'" src/` returns **nothing**.
- [ ] `grep -rn "utilityProcess\|MessagePortMain\|contextBridge\|ipcRenderer\|ipcMain" src/` returns
      **nothing**.
- [ ] `src/main/engine-host.ts` passes `serialization: 'advanced'`, with a comment naming the
      default's cost (§0.6). A read of a 10 000-row SQLite page completes in well under a second;
      if it takes seconds, the serializer is wrong.
- [ ] `tests/unit/relay-codec.spec.ts` round-trips a real `TabularPage` and `assertPageStructure`
      passes on the decoded copy, including a case whose `data` length is not a multiple of 4.
- [ ] The relay refuses to send a frame over `MAX_FRAME_BYTES` (a unit test or a deliberate
      oversized send that throws rather than closing the socket) — §0.3.
- [ ] A 10 000-row SQLite page arrives **chunked**: the app process's log shows > 1 frame, the
      renderer reassembles it, and the grid renders the same rows the same query returns under
      `bun test tests/db/sqlite.spec.ts`.
- [ ] **Two tabs reading large pages at once both complete**, and neither is starved (the relay
      round-robins). This is the one designed-for behaviour §0 did not measure.
- [ ] The stop button cancels a long-running query mid-flight, and the op log records
      `status: 'cancelled'` — i.e. the `AbortController` path (reality #7) still works end to end.
- [ ] Window bounds persist across a restart, driven by the page's own `onresize` (reality #9), and
      the app does **not** call any `window.*` method before `appClientConnect` (D5 — the failure
      mode is a segfault, not an exception).
- [ ] The application menu appears and **at least one keyboard shortcut actually fires** its
      `kira:menu:*` channel (the accelerator format differs from Electron's — step 14).
- [ ] Saving a connection **with** a password fails visibly with the `SecretStorageStatus` reason
      text, and saving one **without** succeeds (D12) — the honest expression of "no keychain".
- [ ] `bun run test:unit` and `bun run test:db` pass. `sh scripts/run-ipc-backend.sh` passes under
      plain `node` after its one-word change.
- [ ] `bun run lint` and `bun run typecheck` pass (`typecheck:node`'s tsconfig may need the
      `electron` types dropped).
- [ ] A run with `enableInspector: true` produces **no** `CONSOLE JS ERROR` and no
      `CONSOLE SECURITY ERROR` line, and `enableInspector` is back to `false` in the committed config.
- [ ] `docs/ARCHITECTURE.md` no longer contains the sentence "Bulk data skips the main process"
      (D15), and `git diff docs/PERF.md` is empty (§4).
- [ ] `neutralino/neutralino.config.json` still pins `binaryVersion`/`clientVersion` to `"6.9.0"`
      and `npx neu update` runs with **no** `WARN … Using nightly releases` line (P51 D6).
- [ ] The Outcome section records exact commands and output, and labels every timing as a Linux
      observation (P51 D8).

---

## 7. Verification plan — which adapters, and why these

The constraint that decides this is §0.9: with no credential storage, only a connection whose
`password` is `null` can be saved at all. Four `tests/db/support/*.ts` fixtures qualify — `sqlite`,
`kafka`, `s3`, `sqs` — and these three are picked because each proves something the others cannot.

1. **SQLite — the primary, and the only one that must pass for the phase to be considered done.**
   No Docker, no container, no native binary, no credentials; `tests/db/support/sqlite.ts` seeds
   `BIG_ROWS = 1_000_000`, so a real 10 000-row page — **the exact worst case §0.3 and §0.4 were
   built around** — is reachable in this sandbox in seconds. It is the `tabular` page kind (the one
   `assertPageStructure` exercises hardest: one `TextColumnChunk` per column). AGENTS.md already
   establishes it as fully runnable here. Smoke path: create the connection, connect, expand the
   tree, open a table, page through at 10 000 rows, sort, filter, run a console query, cancel a
   long one, close the tab.
2. **Kafka — because it is the adapter whose *cost* the migration changes.** Passwordless
   (`username: null, password: null` in `tests/db/support/kafka.ts`), a **non-SQL** adapter, and the
   `stream` page kind, whose page carries **five** `TextColumnChunk`s (`keys`, `headers`, `attrs`,
   `timestamps`, `bodies`) — a genuinely different shape through D7's codec than SQLite's. Decisively:
   `@confluentinc/kafka-javascript` is an ABI-specific native addon that today needs
   `scripts/native-electron-build.sh` to rebuild it for **Electron's** ABI before anything can load it
   (AGENTS.md's Native Kafka driver section, and the `CKJS_LINKING=dynamic` workaround this sandbox
   needs). Under a plain-Node app process it runs on the **Node ABI binary `bun install` already
   ships** — so if this works, the migration *removes* a whole build step rather than adding one, and
   that is a real signal about the migration worth having. Needs Docker (`mirror.gcr.io` recipe,
   AGENTS.md).
3. **S3 (LocalStack) — the control case that proves the relay is scoped correctly.** Passwordless,
   the `keyvalue` page kind, and — the reason it is here — it owns `DATA_OP.objectDownload`, the one
   data op that **deliberately never returns bytes over the port**: the engine streams the object
   straight to a local file (`src/engine/adapters/s3/transfer.ts`). It must still do exactly that
   after the migration, with the chunked relay carrying only the small completion response. An
   implementation that accidentally routes object bytes through the relay would pass every other
   check here and fail this one.

**Not picked, and why:** postgres, mysql, mariadb, mongo, redis, rabbitmq and clickhouse all set a
password in their fixtures, so none of them can even be saved as a connection under D12 — picking one
would mean editing `tests/db/support/*.ts`, which P50 D1 forbids. sqs is passwordless and a fine
fourth, but it is the same `stream` page kind as Kafka with none of Kafka's native-addon signal.

---

## 8. What this phase does not answer

1. **Does any of it work on macOS?** Nothing in §0 ran on WKWebView. The wire protocol and the 32 MB
   ceiling are platform-independent (§0.10); the milliseconds are not. P51 §9.1 established a real
   Apple Silicon Mac exists and the shell renders there.
2. **Is the app usable without a keychain?** No, not really — most connections carry a password
   (§0.9, D12). This phase proves the bridge; it does not produce a usable application.
3. **Is 317 ms of control latency during a bulk transfer acceptable?** §0.5 says it is the app
   process's own event loop, not the relay, and quantifies the fix. Whether a stop button that
   responds in ~317 ms p50 / ~626 ms p95 while a 22 MB page streams is acceptable is a product
   judgement nobody has made.
4. **Does the runtime hold up under real load?** §0's payloads are synthetic base64 with no engine,
   no driver and no grid behind them. The 10 000-row virtualized grid, CodeMirror 6, and the scroll
   behaviour P29/P47 tuned against **Chromium's** frame scheduling are all still unexercised on
   WebKit with real data flowing.
5. **Is there an E2E story?** Still none (P51 §4, §7 item 3). This phase makes it worse by breaking
   the two suites that exist (D14).
6. **What the app lost.** D11 deletes an audited list of deliberately-disabled Chromium capabilities
   because there is no Chromium. Neutralino's own posture — `nativeAllowList`, `tokenSecurity`, a
   localhost HTTP server and WebSocket the page talks to, and (§0.7) a static file server with no
   authentication on reads — is a different model that has **not** been audited. That audit is a
   phase.
7. **The macOS 14 floor** (P51 D9/§8 Q1) is unchanged and still unanswered.

---

## 9. Open questions for the user

1. **The static-server sideband (§0.7) measured ~1.6× faster than the chunked relay, with no base64,
   no 32 MB ceiling, and control latency at the idle baseline — but it publishes query results on an
   unauthenticated localhost HTTP server. Keep the chunked design, or revisit?** The chunked design
   is what this plan builds, per the decision already made. The numbers are recorded here so the
   decision can be re-made deliberately rather than rediscovered later. If it were revisited, the
   security objection is the whole question: the relay keeps result bytes inside processes the app
   owns; the sideband does not.
2. **§0.5 shows the residual control latency during a bulk transfer is the app process's own event
   loop, not Neutralino's relay — a second, control-only extension process would restore it to
   ~30–50 ms. Worth a second process?** It is a real cost either way: two Node processes instead of
   one, two handshakes, and control/data state split across them. This phase does not do it.
3. **`tests/e2e/` (11 specs) and the `tests/ipc/` frontend half stop being runnable (D14). Delete
   them on this branch, or leave them in place, red, until an E2E phase?** Leaving them keeps the
   record of what the app is supposed to do and breaks `bun run test:e2e`. Deleting them loses the
   record. There is no third option that is not a fake.
4. **Should §0.4/§0.5 be re-run on the Mac before or after the implementation?** The wire protocol
   and the frame ceiling transfer by construction; the chunking numbers are WebKitGTK-under-Xvfb.
   Re-running the two probe scaffolds on the Mac is maybe an hour and would move the chunk-size
   decision (D6) from "measured on the wrong engine" to "measured".
5. **After P52, is a keychain phase the next one?** §0.9/D12 make it the thing standing between this
   branch and an app anyone could use. The three routes are named in P51 §4 and none of them is
   small.

---

## 10. Outcome

*(To be appended by the implementing session: exact versions, exact commands and their output, what
worked, what did not, which of §7's three adapters actually round-tripped real data, and every
timing labelled as a Linux observation per P51 D8.)*
