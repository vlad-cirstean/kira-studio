# P57 — Revisiting D16: a real-backend e2e tier is possible after all

> Written on branch `claude/wails-native-shell-p57-328wa1`, against the tree at `4c9d45e`, while
> M5's `tests/ui/` ports were still in progress. Its subject is one decision: **D16**
> (`P57-cutover.md:609`) — *"`tests/e2e/` is deleted, not ported, and three specs' coverage is
> written off explicitly."*
>
> The question put to this investigation was whether Playwright could drive a *real* Wails app for
> a few genuinely end-to-end tests by pointing an ordinary browser at the **dev server's** HTTP
> port. **That specific idea is dead, and stays dead** (§2 — P51 part 3's finding holds, and this
> repo's Taskfile makes it doubly dead on Linux). But asking it turned up a different door that is
> wide open, and that nobody in P51–P57 appears to have looked at: **Wails v3 beta.15 ships a
> first-class `server` build tag** that serves the *whole* bound-call surface and the data-plane
> stream over a real TCP listener, to any browser, with no native window anywhere.
>
> Every Wails claim below was read out of
> `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/` — the version
> `shell/go.mod` pins — with `file:line` citations, the standard P55 §1.1/P56 §1/P57 §1 set.
> Every behavioural claim was **executed** in this session, in Claude Code's Linux web container,
> and the commands and their real output are reproduced verbatim.

---

## 0. Verdict

**D16 should be amended, not reversed.** The mocked `tests/ui/` tier stays exactly as planned and
absorbs everything currently in flight. On top of it, **two** real-backend specs are worth building
and a **third** is worth building only if the ops-panel/download contract is judged worth a live
LocalStack container. Nothing else comes back.

| | |
|---|---|
| **Can a plain browser tab reach real Wails bindings?** | **Yes** — via a `go build -tags server` build of `shell/`, which needed **zero source changes** to compile and run. Not via `wails3 task dev`. |
| **Control plane (bound calls)?** | **Yes.** `POST /wails/runtime` over plain HTTP. Real Go services, real SQLite app-storage, real secrets. |
| **Data plane (bulk stream)?** | **Yes.** A real `WebSocket` at `/wails/stream/ws`. Real `bridge/port.ts`, real `JSONStream("engine")`, real vendored-Node engine child, real adapter, real rows in the grid. |
| **Real database round-trip?** | **Yes.** Real SQLite file (`SQLite 3.50.4`) *and* a real Postgres container (`PostgreSQL 17.11`), both connected and introspected through the real Go bridge from a Chromium tab. |
| **Cost?** | **~1 s** to a serving port; the whole SQLite scenario runs in **2.1 s** wall clock. `wails3 task dev`'s first build is ~60 s and does not work on Linux at all. |
| **What still cannot be covered** | Native window chrome, menus, real save/open dialogs, lifecycle (quit/Dock reopen), and WKWebView-specific rendering. Unchanged from §6/§7 — this proposal takes none of that back. |

**The one honest caveat, and it is a real one:** server mode delivers Go-emitted events on an
*independent WebSocket*, so a bound call's HTTP response and an event it triggered can arrive in the
opposite order from the desktop transport. This is not theoretical — it reproduces on every run and
it exposed a latent non-idempotent optimistic update in `src/renderer/state/connections.ts` (§5).
A real-backend tier must be written knowing its event/call interleaving is *a* valid ordering, not
*the* production ordering.

---

## 1. What `-tags server` actually is, read from the source

`wails3` v3.0.0-beta.15 contains a complete, non-GUI application backend selected by a build tag.
It is not a test hook and not a hack; it is a supported build mode with its own platform
implementation, its own window type, and its own stream transport.

- `pkg/application/application_server.go:26` — `type serverApp struct` implements `platformApp`,
  guarded by `//go:build server`. Its doc comment: *"Server mode is enabled by building with the
  `server` build tag: `go build -tags server`."*
- `pkg/application/application_server.go:203-230` — `createHandler()` builds the mux:

  ```go
  mux.HandleFunc("/health", ...)                              // :207
  mux.HandleFunc("/wails/custom.js", ...)                     // :214
  mux.Handle("/wails/events", h.broadcaster)                  // :221
  mux.HandleFunc("/wails/stream/ws", h.app.serveStreamWS)     // :225
  mux.Handle("/", h.app.assets)                               // :228
  ```

  Line **228** is the whole finding. `h.app.assets` is the same asset server the native webview is
  served by, with the same middleware chain — so everything that chain handles is now behind a real
  TCP listener:
  - `application.go:134` — `strings.HasPrefix(path, streamPath)` → `serveStream` (`/wails/stream/`)
  - `application.go:139` — `case "/wails/runtime.js"` → the runtime bundle
  - `transport_http.go:153-160` — `HTTPTransport.Handler()`'s `case "/wails/runtime"` → **every
    bound method call**
- `pkg/application/linux_cgo.go` (`//go:build linux && cgo && ... && !server`) — the `wails://`
  scheme registration that P51 part 3 correctly identified as the reason `curl` cannot reach a
  *desktop* build **is compiled out of a server build entirely**. There is no scheme interception
  in server mode because there is no webview.
- `pkg/application/stream_prelude_server.go` — server builds prepend a prelude to `runtime.js` that
  sets `window._wails.streamFactory` to return a native `WebSocket` pointed at
  `/wails/stream/ws?name=…`. The desktop build's held-poll transport is not used at all.
- `internal/runtime/desktop/@wailsio/runtime/src/stream.ts:518-590` — `JSONStream()` has an
  explicit branch for exactly this: *"Server builds get a native WebSocket, whose dispatch never
  consults `_decode`. Patch both listener styles on this instance so JSONStream means the same
  thing on either transport, which is the point of the shared API."* (`:529-532`).

That last point matters more than it looks: **`src/renderer/bridge/port.ts` needs no change and no
awareness of any of this.** It calls `JSONStream("engine")`; the runtime hands it a socket whose
observable contract is identical on both transports. The bridge code under test is the real
shipping code, byte for byte.

**D1 — the mechanism is `go build -tags server`, not `wails3 task dev`.** The dev server was never
the door; the server build tag is.

---

## 2. The dev-server idea, closed out for good

Two independent walls, either one sufficient.

**2a. P51 part 3's finding holds.** A *desktop* build (dev or otherwise) loads through
`webkit_web_context_register_uri_scheme(webContext, "wails://", ...)` in `linux_cgo.go`, intercepted
inside the Go process. The `devServerURL` in the log is the asset server's own *upstream* for Vite
content, not the address `/wails/runtime` travels over. Nothing was found in this session to
contradict it, and reading `application_server.go` explains *why* it is true — the desktop build
simply has no listener; the server build is where one gets created.

**2b. `wails3 task dev` cannot run on Linux for this repo at all**, independently of 2a.
`shell/Taskfile.yml`'s `build`/`run` tasks both delegate to `darwin:*`, and `shell/build/` contains
only `darwin/` — there is no Linux Taskfile. Run for real:

```
$ cd shell && timeout 90 wails3 task dev
...
task: [darwin:common:frontend:run:npm] npm run build:dev -q
npm error Missing script: "build:dev"
  ERROR  task: Failed to run task "build": exit status 1
  ERR blocking process failed exec="wails3 build DEV=true" err="exit status 1"
  ERROR  task: Failed to run task "dev": exit status 1
exit=1
```

(It also rewrites `shell/build/darwin/icons.icns` and drops a stray root `package-lock.json` as a
side effect — both were reverted; worth knowing before anyone runs it here casually.)

**D2 — no harness is to be built on `wails3 task dev`.** Even on macOS, where it runs, it costs
~60 s of first build and still cannot serve `/wails/runtime` to a browser. A server-mode binary
serves in ~1 s and is the only route considered further.

---

## 3. The proof, run for real

### 3.1 It builds with zero source changes

```
$ cd shell && go build -tags server -o /tmp/.../kira-server .
go: downloading github.com/coder/websocket v1.8.14
EXIT=0
```

Nothing under `shell/` or `src/` was edited to make this work. `main.go`'s whole startup order —
`config.EnsureLayout` → `logging` → `storage.Open` → `secrets.New` → `repos.New` → `resolveEngine`
→ `enginehost.Start` → `preconnect`/`connections`/`tree`/`oplog`/`metrics` → `application.New` —
runs unchanged; only the platform layer differs.

One operational note: `resolveEngine()` looks for the vendored Node runtime at
`<exe-dir>/runtime/node/bin/node` and `runtime/node/bin/node` (cwd-relative), so the binary must be
run with `cwd=shell/` (or placed in `shell/`) or it exits with
`resolve engine: vendored node runtime not found`.

### 3.2 The whole surface answers plain HTTP

Started with `KIRA_HOME` pointed at a scratch dir, `WAILS_SERVER_HOST=127.0.0.1`,
`WAILS_SERVER_PORT=9411`, no Xvfb, no display, no GTK:

```
UP after 1s
===== /health =====
HTTP/1.1 200 OK
===== GET / =====
HTTP/1.1 200 OK
<!doctype html>
<html lang="en" class="dark">
    <title>Kira Studio</title>
    <script type="module" crossorigin src="./assets/index-CCceXq9L.js"></script>
===== GET /wails/runtime.js =====
status=200 size=516218
(function(){
	window._wails = window._wails || {};
	window._wails.streamFactory = function(name) {
		var p = location.protocol === 'https:' ? 'wss:' : 'ws:';
		var sock = new WebSocket(p + '//' + location.host + '/wails/stream/ws?name=' + ...);
===== POST /wails/runtime AppService.Info =====
HTTP/1.1 200 OK
{"appVersion":"0.0.0","go":"go1.25.0","wails":"v3.0.0-beta.15","node":"v22.20.0","kiraHome":"/tmp/.../home1"}
===== POST /wails/runtime ConnectionsService.List =====
HTTP/1.1 200 OK
[]
===== ps: is a node engine child running? =====
16042 16033 node  runtime/node/bin/node --max-old-space-size=512 runtime/engine/engine.cjs
```

`AppService.Info` returning the real `go1.25.0` / `v22.20.0` / real `kiraHome`, and a real vendored
Node engine child in the process table, are the two lines that settle it. The wire shape is
`runtime.ts:133-165`'s: `POST /wails/runtime`, header `x-wails-client-id`, body
`{object:0, method:0, args:{"call-id":…, methodName:…, args:[…]}}` (`calls.ts:86`,
`ByName` at `:126`).

### 3.3 A real browser tab, a real SQLite database, real rows in the grid

A Playwright **chromium** tab against that port, driving the real UI: create a connection through
the real dialog, connect, expand the tree, open a table. The SQLite file was seeded from this
repo's own `tests/db/fixtures/0009_sqlite_seed.sql`.

```
ENGINE PILL: ok
UI CONNECTION ROW COUNT: 2
BACKEND ConnectionsService.List COUNT: 1
BACKEND ConnectionsService.List: [{"id":"f026ca74-…","name":"Probe SQLite","kind":"sqlite",…,
  "database":"/tmp/kira-probe-sqlite-q9gUdL/kira_test.sqlite",…}]
SERVER VERSION TOOLTIP: SQLite 3.50.4
TREE PATHS: ["","database:main","database:main/table:big_rows","database:main/table:composite_pk",
  "database:main/table:customers","database:main/table:employees","database:main/table:fts_docs",
  "database:main/table:generated_cols","database:main/table:nested_json",
  "database:main/table:no_pk_rowid","database:main/table:nulls_and_unicode",
  "database:main/table:Order%20Items","database:main/table:order_items",
  "database:main/table:orders","database:main/table:products","database:main/table:regions",
  "database:main/table:weird%22name","database:main/table:wide_table",
  "database:main/table:without_rowid","database:main#view", …]
FIRST ROW id CELL: 1
GRID ROW COUNT: 3
CONSOLE ERRORS: []
  ✓  1 … › real backend through a plain browser tab: boot, connect, tree, rows (916ms)
  1 passed (2.1s)
```

Everything load-bearing is in there:

- **`ENGINE PILL: ok`** — this is P56's own named symptom (AGENTS.md: *"the status bar stuck on
  'engine connecting' forever"*). It can only turn `ok` if `bridge/port.ts` opened
  `JSONStream("engine")` over the WebSocket, framed a `ping`, reached the Node engine through
  `bridge/stream.go` → `enginehost`, and got a reply. **The data plane is real.**
- **`SQLite 3.50.4`** — a real `adapter:connect` through the real engine to a real file.
- The tree paths are real introspection output, including `Order%20Items` and `weird%22name` —
  the seed's deliberate encoding edge cases, produced by the real adapter, not a fixture.
- **3 grid rows with a real first cell** — a real `DATA_OP` page over the bulk stream, through the
  real `reviveChunks` path P57 added.
- **`CONSOLE ERRORS: []`** — including no 422 noise, since nothing failed.

Note the run also surfaced a real adapter error before the fixture was completed, which is itself
evidence the chain is live rather than mocked:

```
4:29PM ERR Binding call failed: Bound method returned an error:
  {"code":"E_QUERY","message":"no such table: sqlite_stat1"}
```

The SQLite adapter's tree-children query joins `sqlite_stat1`; `tests/db/support/sqlite.ts` creates
it via `ANALYZE big_rows` (`:75`). A canned fixture would never have produced that error, and a
mocked tier can never produce it.

### 3.4 A real *network* adapter, in a real container

Same harness, `postgres:17-alpine` via Testcontainers (pulled through `mirror.gcr.io` and re-tagged
per AGENTS.md), host/port typed into the real connection dialog:

```
POSTGRES CONTAINER UP: localhost 32796
PG SERVER VERSION TOOLTIP: PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc
  (Alpine 15.2.0) 15.2.0, 64-bit
CONSOLE ERRORS: []
  ✓  1 … › real Postgres container round-trips through the real Go bridge (1.1s)
  1 passed (6.9s)
```

The container fixture must be driven under **plain Node**, not Bun — AGENTS.md's existing
`@testcontainers/postgresql`-hangs-under-Bun finding applies verbatim. Invoke as
`node node_modules/@playwright/test/cli.js test …`, not `bunx playwright test`.

### 3.5 Isolation and parallelism

Two instances, distinct `KIRA_HOME`s and ports, started together:

```
both up after 1s
A info: {…,"kiraHome":"/tmp/.../homeA"}
B info: {…,"kiraHome":"/tmp/.../homeB"}
engine child processes: 2
```

**D3 — per-spec isolation is `KIRA_HOME` + `WAILS_SERVER_PORT`, and it is sufficient.** Each
instance gets its own SQLite app-storage, its own logs, its own secrets file and its own engine
child. Parallel workers are safe; the tier does not need `workers: 1` the way `tests/e2e/` did.

### 3.6 Selective interception still works — the hybrid seam

Server mode has no dialogs (`application_server.go:394,408` — `errors.New("file dialogs not
available in server mode")`, confirmed live: `FilesService.ChooseSave` returns HTTP 422 with
`{"code":"E_INTERNAL","message":"file dialogs not available in server mode"}` and the process stays
up). But a `page.route('**/wails/runtime')` can fake **exactly that one method** and let every other
call reach the real backend:

```
REAL AppService.Info THROUGH THE ROUTE: {…,"node":"v22.20.0","kiraHome":"/tmp/kira-probe4-home-4XaZDx"}
INTERCEPTED ChooseSave: {"status":200,"body":{"canceled":false,"filePath":"/tmp/kira-probe-download-target.txt"}}
DISTINCT METHODS SEEN BY THE ROUTE: [LayoutService.GetAll, SettingsService.GetAll,
  ConnectionsService.List, ConnectionsService.States, ConnectionsService.SecretsStatus,
  OpsService.Recent, TabsService.List, AppService.Info, FilesService.ChooseSave]
  ✓  1 … › selective bound-call interception: fake the dialog, keep everything else real (397ms)
```

This is the direct analogue of what `tests/e2e/s3.spec.ts:326-329` already did — it stubbed
`dialog.showSaveDialog` in the Electron main process. **The old test never exercised a real dialog
either.** So intercepting `ChooseSave` here loses nothing that D16 had not already written off, and
recovers the part that mattered.

**D4 — the same `page.route` machinery `tests/ui/support/mockRuntime.ts` already implements is
reused here, inverted: default-passthrough with a named allowlist of faked methods, instead of
default-fake.** It should be a separate, much smaller module; sharing `CHANNEL_TO_FQN` with
`mockRuntime.ts` is fine and desirable.

---

## 4. What this does **not** buy

Stated plainly so nobody reads §3 as broader than it is. All of these remain exactly as
`P57-cutover.md` §6/§7 already accepted, and this proposal claims none of them back:

- **The native window** — chrome, bounds persistence, minimum size, title bar.
- **The application menu and accelerators** — server mode's `setApplicationMenu` is a documented
  no-op (`application_server.go:243-246`).
- **The real save/open panels** — §3.6 fakes the *call*, exactly as the Electron test faked it.
  The AppKit panel itself stays a manual check (§6's table row is unchanged).
- **Lifecycle** — `Cmd+Q`, the quit handshake, Dock reopen, single-instance.
- **WKWebView itself.** This runs Chromium (or WebKit, if the tier is pointed at it). It is a test
  of *this app's* wiring, not of the embedded webview. `tests/ui/` already runs `browserName:
  'webkit'` and is the closer proxy for rendering; the real-backend tier's value is the *backend*,
  so chromium is the right default for it (faster, and already installed in every environment here).
- **`hardening.spec.ts`, `startup.spec.ts`** — unchanged, no subject, still gone (D16).

**D5 — the real-backend tier is a *wiring* tier, not a UI-fidelity tier.** Where a scenario's
value is in rendering or interaction, it belongs in `tests/ui/`. Where its value is "the real
bytes made it all the way there and back", it belongs here. That line is what keeps the tier at
two or three specs instead of creeping back to twenty-three.

---

## 5. The one real fidelity divergence, characterised precisely

The SQLite run shows **2 connection rows in the UI but 1 record in the backend** (§3.3). This was
chased down rather than waved at.

It is **not** double event delivery. Instrumenting `window._wails.dispatchWailsEvent` and creating
one connection:

```
ROWS AFTER CREATE: 2
EVENT COUNTS DURING CREATE: {"kira:connections:changed":1}
EVENT LOG: ["454.9 EVENT kira:connections:changed"]
```

Exactly one event. And after a reload the UI shows **1** row (hydration is a plain
`ConnectionsService.List` call), so nothing is persisted wrong.

The cause is ordering. `src/renderer/state/connections.ts`:

```ts
// :66
unsubscribeListChanged = control.onConnectionsChanged((records) => {
  connectionsState.records = records;      // full replace
});
// :141-142  (saveDialog, mode === 'create')
saved = await control.connectionsCreate(draft);
connectionsState.records.push(saved);      // optimistic append, NOT idempotent
```

In server mode the event rides an independent WebSocket and lands *before* the create call's HTTP
response resolves: the full replace happens first (`records = [created]`), then the awaited `push`
appends the same record again. On the desktop transport the event is delivered by `ExecJS` into the
same webview and happens to land after, so the replace overwrites the duplicate and it is invisible.

Two honest readings, and both should be recorded:

1. **As a harness caveat.** Event/call interleaving in server mode is *a* valid ordering, not the
   production one. Any real-backend spec must not depend on the desktop ordering, and should assert
   backend state (`ConnectionsService.List`) rather than UI row counts where the two can diverge.
2. **As a latent app bug.** Nothing in the desktop transport actually *guarantees* the ordering
   either — `Events.Emit` → `ExecJS` and the bound-call response are independently scheduled. The
   fix is one line's worth of idempotence (append only if `records.find(r => r.id === saved.id)` is
   absent, or drop the optimistic push entirely and let the event be the single source of truth).

**D6 — the duplicate is reported as a finding, not fixed in this document**, and the fix is not a
precondition for the tier. But it is exactly the class of bug the mocked tier structurally cannot
find, which is itself an argument for §6's specs existing.

---

## 6. The recommendation: two specs, and a conditional third

Deliberately small. Everything not listed here stays on the `tests/ui/` path already in flight —
this is an addition of two or three files, not a revival of a tier.

Each candidate has to clear one bar: **would a canned fixture make this assertion vacuous?** If the
test would still "pass" against a mock that the test itself authored, it does not belong here.

### E1 — `sqlite-real.spec.ts` (build first; Docker-free, ~2 s)

The Docker-free anchor, and the smallest possible thing that proves the entire stack is wired.
Essentially §3.3 as run: create a SQLite connection through the real dialog → connect → assert the
version string starts `SQLite 3.` → expand to `database:main` → open `order_items` → assert real
rows and a real cell value → assert the engine pill reached `ok` → assert no unexpected console
errors.

**Why it earns its slot:** it is the only automated proof that `bridge/control.ts`'s generated
bindings, `bridge/port.ts`'s `JSONStream` + `reviveChunks`, `bridge/stream.go`, `enginehost`'s
stdio framing, `stdio-main.ts` and a real adapter all still agree on the wire. Every one of those is
a seam P57 rewrote, and every one is stubbed out in `tests/ui/`. It runs in ~2 s with no container
in any environment this repo runs in — the same universality that made `tests/e2e/sqlite.spec.ts`
the chosen Docker-free anchor in the first place (P50 §4.1).

**Port cost from `tests/e2e/sqlite.spec.ts`:** small, and it is a *shrink*, not a port. Drop
`_electron.launch()` (fixtures become spawn-a-binary + poll `/health`), drop everything about
selection edges, context-menu keyboard nav, the cell editor's format picker, sticky bands, column
virtualisation and word wrap — all of that is pure UI and is `tests/ui/`'s job. What remains is
maybe 60 lines of the original 614.

### E2 — `postgres-real.spec.ts` (build second; needs a container, ~7 s)

The network-adapter counterpart, proven working in §3.4. A real container, real credentials typed
into the real dialog, a real TCP connect, real introspection, and one real page of rows.

**Why it earns its slot and E1 does not cover it:** SQLite is a file opened in-process. Postgres
exercises the parts of the chain that only a network adapter has — credentials travelling through
`internal/secrets` and back out through `resolve()` into a real driver, a real connection pool, a
real server-version handshake, and a real host/port that is *not* localhost-with-no-auth. It is
also the engine most of this app's users actually use.

**Alternative considered and rejected: Mongo.** `tests/e2e/mongo.spec.ts`'s two scenarios are
overwhelmingly document-*rendering* (page-size-1000 render tripwires, truncated fallback,
go-to-match — `mongo.spec.ts:342`). That is `tests/ui/` work against a captured fixture, and P27's
own design decisions are UI decisions. Mongo's adapter behaviour is already covered by
`tests/db/mongo.spec.ts` (913 lines). Postgres gives a strictly better wiring proof for the same
container cost.

### E3 — `s3-download-real.spec.ts` (**conditional**; needs LocalStack)

The costliest single loss D16 names (§7: *"`s3.spec.ts` is the costliest single loss"*), and §3.6
shows it is recoverable — the native panel was already stubbed in the Electron original, so
intercepting `FilesService.ChooseSave` loses nothing that was ever covered. The assertion that comes
back is the real one: **`DATA_OP.objectDownload` makes the engine write the file itself**, and the
ops panel reports the transfer.

Scope it to `tests/e2e/s3.spec.ts:316`'s single scenario — connect, open the object, click download,
poll the destination path until its bytes equal the object body, assert one `op-row` with
`data-status="ok"` containing `GetObject s3://…`. Nothing else from that 746-line file.

**Why conditional:** it is the only one of the three whose value depends on a judgement call — a
live LocalStack container for one file-write assertion. If that is judged not worth it, the §6 table
row stays a manual check and nothing is lost relative to the current plan. **Recommend building E1
and E2 first and deciding E3 afterwards**, on evidence about how much the tier actually costs in
practice.

### Explicitly *not* recommended

- **`tests/e2e/sqlite.spec.ts`'s second scenario** (`:484` — failed commit reports the server error
  verbatim, filter change invalidates the count, disconnect regates the tab, commit reloads a
  sibling tab). Tempting, because it is genuinely about real backend errors reaching the UI. But the
  *error surfaces* are already covered by `tests/db/sqlite.spec.ts` cases 22/23/24/26/28, and the
  *tab regating and sibling reload* are UI state machines that a canned error response drives just
  as faithfully — `tests/ui/support/mockRuntime.ts`'s `ControlSnapshot.error` field (P57's own
  addition) exists precisely for this. Split it: the UI half goes to `tests/ui/`, the adapter half
  is already done.
- **Anything from `budgets`/`perf`/`leaks`.** Real-backend timing in a server-mode process on a
  shared CI box is noise, not signal. D16's plan for these is unchanged.
- **A general "port the anchors" instinct.** The three anchors are 1 772 lines. The recommendation
  above is roughly 150.

---

## 7. What belongs in `tests/db/`, not in any e2e tier

Asked for explicitly, and worth answering carefully, because the honest answer is mostly
*"already there"*.

`tests/db/` is large and current: `sqlite.spec.ts` alone is **1 638 lines / 38+ cases** covering
connect/disconnect and its three distinct failure modes (`E_NOT_FOUND` for a missing path,
`E_CONNECT` for a non-database file, `E_CONNECT` for a directory), quoting, `describe`, row
estimates, cancel, projection, filter/sort, **fidelity**, `int64` fidelity on both read and console
paths, dynamic typing, keyset paging by rowid, generated columns, "read cannot write" including
filter-injection, mutation error surfaces (unknown column → `E_NOT_FOUND`, read-only →
`E_UNSUPPORTED`, row-count conflict rolls back the batch, no primary key → `E_UNSUPPORTED`),
`execute` semantics, and "the file is not modified by a read session". `mongo.spec.ts` is 913 lines
and `s3.spec.ts` 710.

So the concern behind the question — *"real SQL generation, real error messages, real encoding and
type handling are about to be lost"* — **is not actually at risk.** That coverage does not live in
`tests/e2e/` and never did; it lives in `tests/db/`, which is unaffected by the Electron→Wails
migration and keeps running.

Two genuine gaps were found where a deleted e2e file was the only place an *adapter-level* fact was
asserted, and both should become `tests/db/` cases rather than competing for an e2e slot:

1. **`sqlite_stat1` is a hard dependency of the SQLite tree-children query.** Surfaced live in §3.3
   as `{"code":"E_QUERY","message":"no such table: sqlite_stat1"}` on a database that had never been
   `ANALYZE`d. `tests/db/sqlite.spec.ts:259` ("6. row estimate") asserts a *null* estimate for an
   un-analyzed table, which is the adjacent-but-different fact; nothing asserts that **tree
   enumeration itself survives** a database with no `sqlite_stat1` at all. Since every real user's
   database starts that way, this is a real hole. **A new `tests/db/sqlite.spec.ts` case should
   assert that `children()` on a freshly-created, never-`ANALYZE`d database returns the table list
   without error** — not that it returns an estimate.
2. **`DATA_OP.objectDownload` writes the file itself.** `tests/db/s3.spec.ts` covers the S3 adapter,
   but the "the engine, not the renderer, performs the write to a caller-supplied path" contract was
   only ever asserted through `tests/e2e/s3.spec.ts:316`. **A `tests/db/s3.spec.ts` case should call
   the download op directly against a temp path and assert the file's bytes**, independent of any
   UI. If that case is written, E3's marginal value drops to "the ops panel reports it", and E3
   should probably be dropped — which is a good outcome, and is the strongest argument for writing
   this `tests/db/` case *first*.

**D7 — write the two `tests/db/` cases above before deciding on E3.** They are cheap, they are the
right tier for what they assert, and one of them may retire E3 entirely.

---

## 8. Harness shape, if E1/E2 are approved

Sketch only — not built, per the brief.

```
tests/e2e-real/
  fixtures.ts            spawn a -tags server binary; per-test KIRA_HOME + port; poll /health;
                         SIGKILL on teardown. Replaces tests/e2e/fixtures.ts's _electron.launch().
  support/passthrough.ts page.route('**/wails/runtime') — default route.continue(), with a named
                         allowlist of faked methods (FilesService.* only). Inverse of
                         tests/ui/support/mockRuntime.ts; reuses its CHANNEL_TO_FQN.
  sqlite-real.spec.ts    E1
  postgres-real.spec.ts  E2
```

`playwright.config.ts` gains one project alongside `ui` and `ipc-frontend`:

```ts
{ name: 'e2e-real', testDir: './tests/e2e-real', use: { browserName: 'chromium' },
  fullyParallel: true, workers: 2 }
```

Build prerequisites, all of which the repo already has scripts for: `bun run build:wails` (frontend
into `shell/frontend/dist`, which `//go:embed all:frontend/dist` picks up), `bun run build:engine`,
`scripts/vendor-node.sh`, `wails3 generate bindings`, then
`go build -tags server -o shell/bin/kira-server-test .`. `scripts/wails-dev-setup.sh` already does
all but the last, idempotently — a `predev`-style hook for this tier is a two-line addition.

Three constraints the implementing session must not miss:

- **Bind to `127.0.0.1`, always.** Server mode's default host is `localhost`
  (`application_server.go:68-74`) and there is **no authentication of any kind** on
  `/wails/runtime` — `x-wails-client-id` is a nanoid the page generates for itself, not a
  credential. A server-mode binary exposes the entire bound surface, including secrets and file
  services, to anyone who can reach the port. This binary is a **test artifact and must never be
  packaged or shipped**; the tier should assert its own bind address rather than trusting a default.
- **Run the container-backed spec under plain Node**, not `bunx` (§3.4, and AGENTS.md's existing
  Bun/testcontainers finding).
- **`cwd` must be `shell/`** (or the binary must sit beside `runtime/`) for `resolveEngine()`.

---

## 9. What this changes in `P57-cutover.md`

Nothing yet — this document is a recommendation, not an amendment. If accepted, the edits are:

- **D16** gains a clause: `tests/e2e/` is still deleted, and 20 of its 23 specs are still written
  off, but the three full-stack anchors' *wiring* value is recovered by two (or three) new
  `tests/e2e-real/` specs built on the `-tags server` mechanism, at roughly 150 lines total.
- **§6's manual-check table**: the `objectDownload` half of the save/open row becomes automated if
  E3 or D7's `tests/db/` case lands; the AppKit panel itself stays manual.
- **§7's "what gets worse" item 1** ("The full-stack tier is gone") is softened, honestly and
  specifically — it becomes "reduced from 23 specs to 2–3, with native-shell coverage genuinely
  gone and wire-level coverage genuinely kept".
- **AGENTS.md**'s P51 Wails section should gain the `-tags server` finding directly, since its
  current last bullet (*"`curl` or a plain browser tab can never exercise real Wails bindings this
  way, on this platform"*) is true as written but reliably read as broader than it is. The
  correction is one sentence: *that is true of a desktop build; a `-tags server` build serves the
  entire bound surface and the stream over a real listener.*

---

## 10. Reproducing this

Everything above ran in one Claude Code Linux web container, from a fresh worktree:

```
bun install
sh scripts/wails-dev-setup.sh          # wails3 (pinned), bindings, vendored node, engine bundle
bun run build:wails                    # shell/frontend/dist, which main.go embeds
cd shell && go build -tags server -o /tmp/kira-server .
cd shell && KIRA_HOME=$(mktemp -d) KIRA_INSECURE_SECRETS=1 \
  WAILS_SERVER_HOST=127.0.0.1 WAILS_SERVER_PORT=9411 /tmp/kira-server &
curl -s http://127.0.0.1:9411/health
curl -s -X POST http://127.0.0.1:9411/wails/runtime \
  -H 'Content-Type: application/json' -H 'x-wails-client-id: probe0000000000000001' \
  -d '{"object":0,"method":0,"args":{"call-id":"c1","methodName":"github.com/kirathecat/kira-studio/shell/internal/bridge.AppService.Info","args":[]}}'
```

No Xvfb, no GTK runtime, no display, no `wails3 dev`. The probe spec files written to produce §3
were deliberately **not** committed — §8 is the shape they should take if the tier is approved, and
re-deriving them from this document is a few minutes' work.
