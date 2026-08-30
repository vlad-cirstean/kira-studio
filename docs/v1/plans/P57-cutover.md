# P57 — Cutover: the renderer on Wails, `src/main`/`src/preload` deleted, Electron removed

> Sequences P52 §4.4 / §5.3 / §7.1 / §7.2 / §10 / §12 / §14 against the tree as it stands after
> P53–P56. P52 §4–§10 are settled and are not reopened here; where this plan departs from P52 it is
> because reading the actual tree or the actual `wailsapp/wails/v3@v3.0.0-beta.15` source disproved
> or refined something, and each such case is called out with its evidence. P52 §15: **G1 was the
> only gate in this migration and it passed at 261.7 MB.** No gate here — but §0.3 defines a hard
> **checkpoint C1** that the deletion milestones must not start before, which is a different thing
> from a gate and is the whole reason this plan is sequenced the way it is.
>
> Every Wails claim below was read out of
> `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/` — the exact version
> `shell/go.mod` pins — with `file:line` citations, the same standard P55 §1.1 and P56 §1 set. The
> JS runtime claims come from that module's own
> `internal/runtime/desktop/@wailsio/runtime/src/*.ts`, which is the source the `-b` bundled runtime
> is built from; **`@wailsio/runtime` is not installed in `node_modules`** (checked), so there was no
> npm `dist/` to read and the module cache is the only source. Two facts were additionally
> **executed** (§1.6, §1.12); those are marked *probed*. `wails.io`/`v3.wails.io` remain 403-blocked
> from both of this project's environments (AGENTS.md, P51).

## 0. What this phase is, and what it is not

### 0.1 The three bodies of work

P52's phasing table (line 73) assigns P57: *"**Cutover**: renderer bridge rewritten,
`src/main`/`src/preload` deleted, Electron removed, packaging + test-suite cutover — Yes,
extensively [`src/` changes]"*. Read for this plan and confirmed. Concretely:

1. **The renderer bridge, rewritten.** `src/renderer/bridge/{control,port}.ts` stop talking to
   Electron's `window.kira` / `MessagePort` and start talking to the generated Wails bindings and
   the named `engine` Stream that P56 already built and tested on the Go side. `bridge/data.ts` is
   **not** rewritten — §1.1 establishes why, and that is the single most useful finding in this
   document for keeping the phase's blast radius honest.
2. **The Electron runtime, removed.** `src/main/` (50 files / 3 406 lines) and `src/preload/`
   (161 lines) deleted; `src/engine/index.ts` deleted; `electron`, `electron-builder`,
   `electron-vite`, `electron-log`, `@electron/rebuild` removed from `package.json`;
   `electron.vite.config.ts`, `electron-builder.yml`, `scripts/native-electron-build.sh` deleted;
   every `*:mac` / `dev` / `build` script that names them deleted or rewritten.
3. **Everything that pointed at Electron, re-pointed.** The test suite (§4.9–§4.12), the packaging
   scripts (§4.13), the CI workflows (§4.14 — **not** in P52 §14's list, and they will fail on the
   first push if missed), and the docs (§4.15).

### 0.2 Not in this phase

- **No new Go behaviour.** `shell/internal/**` gains nothing except the bundle-identity change of
  §4.8. P56 completed the Go bridge surface: 40 bound methods across **12** services (counted for
  this plan, §1.9), the `engine` Stream, the menu, the window, the quit handshake. This phase
  consumes that surface; it does not extend it.
- **No adapter, engine or view change.** `src/engine/**` loses exactly one file (`index.ts`);
  nothing else under it is touched. `src/renderer/views/**`, `src/renderer/state/**`,
  `src/renderer/workbench/**` and every `.vue` file are untouched, which §1.1 shows is achievable
  rather than merely hoped for.
- **No re-measurement gate.** `docs/PERF.md` §2.1's interaction budgets and cold start are
  **recorded** here (P52 §11 owes both), not gated. A scroll regression is a bug to fix, not a
  reason to stop.
- **No new UI test scenarios.** The webkit tier ports the specs that exist; it does not grow.

### 0.3 What "irreversible" actually means here, and the sequencing rule it forces

P52 §0.3 calls P57 "the only irreversible phase". That is true in exactly one sense: once
`src/main/` and the `electron*` dependencies are gone, `bun run build` cannot produce a working
Electron app again without a revert. It is **not** true in the sense of "unrecoverable" — this is a
git repository on a branch, and every deletion is one `git revert` away.

The real risk is subtler and worth naming precisely: **a half-finished cutover can leave the repo
bootable in neither mode.** Delete `src/preload/index.ts` before `control.ts` stops reading
`window.kira`, and the Electron build is dead while the Wails build has never been proven; the
session is then debugging a renderer rewrite with no working reference implementation to compare
against, which is the single most expensive state this phase can reach.

**The rule this plan enforces, and the reason §9's milestones are ordered as they are:**

> **C1 — the Wails-only boot proof.** Before any deletion milestone starts, the Wails app must
> boot with the rewritten bridge and demonstrate, in one run: the renderer hydrating from real Go
> services, the engine status pill leaving `'connecting'` (AGENTS.md's P56 finding — the specific
> symptom this phase exists to clear), a real connect, a table opening with rows over the `engine`
> Stream, and a quit that acks inside the 2 s window. **The Electron app is still whole and
> buildable at that moment**, so a failure at C1 costs three renderer files and nothing else.

M0–M4 (§9) are the rewrite and end at C1. M5 onward are the deletions. Nothing in M5+ is
reversible-by-rebuild, and nothing in M5+ starts before C1 is recorded. This is the same shape P52
§0.2 used for G1 ("stopping there costs a scaffold and nothing under `src/`"), applied one phase
later to a different kind of failure.

One corollary worth stating because it is counter-intuitive: **`src/preload/index.ts` is deleted in
the same milestone as `src/main/`, not earlier.** It is tempting to delete it in M1 alongside the
`window.kira` removal, since it is "the Electron half of the thing being replaced". Don't — it is
`electron.vite.config.ts`'s `preload` entry point, so removing it breaks `bun run build` (and
therefore the Electron reference implementation) before C1.

## 1. What reading the current tree and the real Wails runtime found

### 1.1 The renderer bridge's real blast radius is three files, and `data.ts` is not one of them

Grepped for this plan, against the current tree:

- **`window.kira` has exactly one reader in `src/`**: `src/renderer/bridge/control.ts:34`
  (`const kira = window.kira;`). Nothing else under `src/renderer/` touches it. (`tests/` has four
  more — §1.10.)
- **`src/renderer/bridge/port.ts` has exactly two importers**: `src/renderer/bridge/data.ts:19`
  (`onPortEvent`, `request`) and `src/renderer/workbench/state/engine.ts:3` (`ready`, `request`).
  Nothing else in the tree imports it.
- **`src/renderer/bridge/data.ts` has thirteen importers** (`main.ts`, `state/cacheStats.ts`,
  `state/objectStore.ts`, `workbench/SettingsDialog.vue`, and nine `views/**` modules), and every
  one of them consumes the `data` object's methods, never `port.ts` directly.

The consequence, and it shapes the whole phase: **if `port.ts` keeps its exported surface
(`ready`, `request`, `onPortEvent`) and `control.ts` keeps its exported surface (the `control`
object's ~55 properties), then `data.ts` and all thirteen of its importers, plus `engine.ts`, need
no edit at all.** The rewrite is a transport swap behind two unchanged module interfaces, not a
renderer-wide refactor. D1 makes this a rule rather than a happy accident.

`bridge/data.ts` is therefore listed as **UNCHANGED** in §3, and §5.2 gives the test that proves it
(a diff assertion, not a claim).

### 1.2 `WailsSocket` has two traps that today's `port.ts` shape walks straight into

Read from `internal/runtime/desktop/@wailsio/runtime/src/stream.ts` (974 lines):

1. **`Stream(name)` returns a socket in `CONNECTING`, and `send()` on a `CONNECTING` socket
   *throws*.** `Stream()` (`:443-454`) constructs a `WailsSocket` and returns immediately; the
   constructor only *queues* the open frame (`:261-265`) and the ack arrives later as an open frame
   on the poll loop, which is what moves `readyState` to `OPEN` (`:384-388`). `send()` throws
   `new DOMException("Still in CONNECTING state.", "InvalidStateError")` when
   `readyState === CONNECTING` (`:275-278`), and — worse — **silently returns, dropping the frame,
   for any other non-`OPEN` state** (`:279-281`).

   Today's `port.ts` guards with `if (!port) return Promise.reject(...)` (`:82`), a null check that
   has no equivalent here: the socket object exists from the first line. A naïve port that swaps
   `port.postMessage(req)` for `socket.send(...)` produces a throw on every request issued before
   the open ack, and a silent black hole after a close. D3 handles both.

2. **`binaryType` defaults to `"arraybuffer"`, deliberately** (`:214`, and the class doc at
   `:190-193`: *"binaryType defaults to `"arraybuffer"` rather than `"blob"`, because stream frames
   are always binary and a Blob would force an extra async hop"*). So `ev.data` in `onmessage` is an
   `ArrayBuffer`, not a string and not an object. The renderer must `TextDecoder().decode()` then
   `JSON.parse()`. Today's `port.ts` receives a structured-cloned object from `MessagePort` and
   parses nothing (`:39-40`).

Two further facts, both useful:

- **`close`/`error` are real, ordered events.** A transport failure calls `_fail` (`:407-416`),
  which dispatches `error` and then closes with code `1006`; a clean close dispatches `close` with
  `{code, reason, wasClean}` (`:419-433`). This is a strictly better signal than the `MessagePort`
  had — today's `port.ts` can only learn that its port died by a request timing out.
- **Session supersede is real and automatic**, exactly as P52 §7.2 banked on: `_closed` removes the
  connection from the module-global registry and aborts the poll when the last one goes (`:424-425`).
  Combined with `bridge/stream.go`'s `AttachStream` generation on the Go side, `src/main/index.ts`'s
  hand-rolled `generation` counter has no successor and needs none.

### 1.3 `JSONStream` exists and is byte-for-byte equivalent to `Stream` + manual JSON

P52 §7.2 mandates `Stream()`, **not** `JSONStream()`, on the grounds that the raw-bytes variant
avoids "an extra async hop". Read for this plan, that reasoning does not survive contact with the
source: `JSONStream(name)` (`:518-595`) calls `Stream(name)`, then sets `socket._decode` to
`JSON.parse(new TextDecoder().decode(payload))` (`:520-527`) and wraps `send` as
`send(JSON.stringify(value))` (`:591-592`). `send(string)` encodes via `textEncoder.encode` (`:600`).
There is **no extra hop and no Blob anywhere** — the "extra async hop" the P52 note is thinking of
is `binaryType: "blob"`, which neither variant uses.

So the two are the same bytes and the same number of turns. The difference is error behaviour: a
frame that is not valid JSON raises an `error` event and is dropped inside `_message`'s try/catch
(`:394-399`) rather than throwing where the caller can see it. D2 chooses on that basis, not on the
performance basis P52 assumed.

### 1.4 `_wails.streamFactory` is an official test seam, and it is the answer for the data plane

`Stream()` checks, before constructing anything:

```ts
// stream.ts:447-452
if (hasDOM) {
    const factory = (window as any)._wails?.streamFactory;
    if (typeof factory === "function") {
        return factory(name);
    }
}
return new WailsSocket(name);
```

Its comment says this exists so server builds can return a real `WebSocket`. It is equally a
supported injection point: a Playwright `page.addInitScript` that sets `window._wails.streamFactory`
before any app module evaluates gives the whole renderer a fake socket, with the **real**
`port.ts` — real framing, real pending map, real timeouts, real `ready` gating — running above it.

This matters because the alternative is unattractive: the stream's HTTP protocol is a genuine
long-poll with session/generation headers (`:830-838`), a binary batch codec (`postBatch`'s
`count u32, then count × (len u32 | payload)`, `:706-709`), 429-backpressure retries (`:683-703`)
and a frame decoder that fails the whole connection on a framing mismatch (`:867-875`).
Reimplementing that in a test harness would be a large, fragile mock of a beta protocol. The
factory seam skips all of it. D14.

### 1.5 `Events.On` is exactly what the shim already assumes

`events.ts:150-152`: `On(eventName, callback)` delegates to `OnMultiple(..., -1)` (`:135-141`),
which returns `() => listenerOff(thisListener)` — an unsubscribe function, matching every
`control.ts` `on*` method's `(): () => void` contract. The callback receives a `WailsEvent` with
`.name`, `.data`, and an optional `.sender` (`:61-84`); `data` is `null` when the emitter sent no
payload (`:82`), which is precisely P56 D6's `Emit(name, nil)` shape. `shell/frontend/shim/kira-bridge.ts:51-53`'s
`(ev: {data: T}) => cb(ev.data)` adapter is correct and transfers verbatim into `control.ts`.

### 1.6 The bound-call error path, traced end to end — and P52 §5.3's open question answered *(probed)*

P52 §5.3 designed `ipcerr.Error` to fold `{code, message}` into the message string, and left as
explicitly unverified *"whether Wails' error `cause` propagation works as part 2 read it"*, noting
the design deliberately does not depend on it. Traced in full for this plan, the answer is: **it
works, and the design should now depend on it, because the message-string path is actively bad.**

The chain, with citations:

1. A bound method returning a non-nil error is collected into
   `&CallError{Message: errors.Join(errorOutputs...).Error(), Cause: <marshalled>, Kind: RuntimeError}`
   (`pkg/application/bindings.go:423-438`).
2. `Cause` is `b.marshalError(err)`, which defaults to `defaultMarshalError` —
   literally `json.Marshal(&err)` on the `error` interface value (`bindings.go:466-473`).
3. `messageprocessor_call.go:140-147` wraps that `*CallError` in a `BindingCallFailed` error.
4. `transport_http.go`'s `httpError` does `errors.As(err, &cerr)` — **unwrapping back to the
   `*CallError`** — and writes `json.Marshal(cerr)` with `Content-Type: application/json` and status
   422 (`:376-397`). So the wrapper in step 3 never reaches the wire.
5. The renderer's `runtime.ts:165-177` parses that body and builds
   `err = new RuntimeError(json.message)` then `err.cause = json.cause`.

*Probed* (a throwaway `go run` against a struct identical to `shell/internal/bridge/ipcerr.Error`,
which carries `json:"code"` / `json:"message"` tags):

| Expression | Result |
|---|---|
| `json.Marshal(&err)` where `err` holds `*ipcerr.Error` | `{"code":"E_DISCONNECTED","message":"PG is not connected"}` |
| `errors.Join(err).Error()` | `"{\"code\":\"E_DISCONNECTED\",\"message\":\"PG is not connected\"}"` |
| `json.Marshal(&err)` where `err` is a bare `errors.New("boom")` | `{}` |

Three consequences, in descending order of importance:

1. **`err.cause` is a real structured object, no parsing needed.** `{code, message}` arrives as JS
   data. The renderer's rebuild step is a property read, not a `JSON.parse` in a try/catch.
2. **`err.message` is the JSON string, which is user-visible if nothing unwraps it.** Because
   `ipcerr.Error.Error()` returns the JSON encoding (`ipcerr/errors.go:17-25`) and `CallError.Message`
   is built from `Error()`, a renderer that displays `err.message` raw shows the user
   `{"code":"E_QUERY","message":"relation does not exist"}`. P52 §5.3 sold the folding's retirement
   partly as *"displayed errors lose the `[E_QUERY] ` prefix"* — that improvement is real but it is
   **not free**: it depends on the unwrap step existing. The unwrap is mandatory, not a nicety. D5.
3. **A non-`ipcerr` error marshals to `{}`, not to `undefined`.** So "does `cause` exist" is the
   wrong test — `cause` exists and is an empty object. The unwrap must test for a `string`-typed
   `code` property. A bare `errors.New` reaching the boundary is a bug (P52 §5.3: *"so a bare
   `errors.New` never reaches the boundary"*), but the renderer must degrade legibly when one does,
   rather than producing `{code: undefined}`.

`ServiceOptions.MarshalError` (`bindings.go:140`) would allow a per-service custom marshaller. It is
not needed — the default already produces exactly the right shape — and D5 does not use it.

### 1.7 The generated bindings call by numeric ID, and `-names` is a real, supported alternative

`shell/frontend/bindings/.../layoutservice.ts`, generated by the pinned CLI, emits:

```ts
import { Call as $Call, CancellablePromise as $CancellablePromise } from "/wails/runtime.js";
export function GetAll(): $CancellablePromise<model$0.Layout> { return $Call.ByID(4229262106); }
export function Set(args: $models.LayoutSetArgs): $CancellablePromise<model$0.Layout> {
    return $Call.ByID(3971097499, args);
}
```

`wails3 generate bindings -help` (run against the pinned `$(go env GOPATH)/bin/wails3`, which
reports `v3.0.0-beta.15`) lists **`-names   Use names instead of IDs for the binding calls`**. The
generator's own template confirms the emitted shape —
`internal/generator/render/templates/service.ts.tmpl:64` is `return $Call.ByName("{{js .FQN}}"` —
and `calls.ts:126-128` shows `ByName(methodName, ...args)` puts that FQN into the request body as
`args.methodName`. Committed generator golden files show the exact form, e.g.
`$Call.ByName("github.com/wailsapp/wails/v3/internal/generator/testcases/complex_expressions/config.Service7.TestMethod")`.

Two things follow. First, `CancellablePromise<T> extends Promise<T>` (`cancellable.ts:147`), so
`control.ts`'s declared `Promise<T>` return types stay valid with no cast — a small relief given
~40 of them. Second, the ID-vs-name choice is not cosmetic: it decides whether the frontend test
tier can mock the control plane at the HTTP boundary in readable terms. D13.

### 1.8 The `/wails/runtime.js` import is a typecheck trap that has been invisible until now

The generated bindings import from the bare path `"/wails/runtime.js"` — a path Wails' own asset
server resolves inside a real webview, and which `vite.wails.config.ts:76` already marks
`external: [/^\/wails\//]` so Rollup leaves it literal (AGENTS.md's P52 finding).

**TypeScript cannot resolve it.** Today that costs nothing, because the only importer is
`shell/frontend/shim/kira-bridge.ts`, and `shell/` is in **no** tsconfig: `tsconfig.node.json`
includes `src/main`, `src/preload`, `src/engine`, `src/shared`, the configs and `tests/`;
`tsconfig.web.json` includes only `src/renderer/**` and `src/shared/**`. Neither reaches `shell/`.

The moment `src/renderer/bridge/control.ts` imports the bindings, `bun run typecheck:web`
(`vue-tsc -p tsconfig.web.json`) follows the import graph into them and fails on the unresolvable
module — and `verbatimModuleSyntax: true` plus `skipLibCheck: true` do not rescue it, because this
is a module-resolution failure in a first-party file, not a `.d.ts` body. This will bite in M1 and
it will look like a Vite problem when it is a tsconfig problem. D8 resolves it.

Worth recording precisely: the module cache's copy of the runtime ships `src/` only. Its
`package.json` declares `"types": "types/index.d.ts"` and `"default": "./dist/index.js"`, and
**neither `types/` nor `dist/` exists in the Go module** — they are npm publish artifacts. So the
types can come from the npm package `@wailsio/runtime@3.0.0-beta.15` (the version string in that
same `package.json`, exactly matching `go.mod`) or from a hand-written ambient declaration, and
from nowhere else. D8 weighs those two.

### 1.9 The bridge surface P56 actually landed, counted

Counted directly out of `shell/internal/bridge/*.go` for this plan rather than trusting P56's prose:
**40 bound methods across 12 service structs** — 39 request/response plus `LifecycleService.Flushed`
(fire-and-forget), which is exactly P52 §7.1's split. Two corrections to the record:

- **There are 12 services, not 13.** P56 §4.9 and its acceptance criterion 2 both say "thirteen";
  `shell/main.go:159-172` registers twelve, and P52 §4.2's own text ("Eleven modules become twelve
  services") agrees with the tree. The twelve are App, Settings, Layout, Tabs, Connections, Tree,
  Engine, Ops, Filters, Files, Queries, Lifecycle. This is a doc miscount, not a missing service —
  every channel is accounted for.
- **Three Go method names differ from their TS counterparts.** `ConnectionsService.Remove` ↔
  `connectionsDelete`, `OpsService.Recent` ↔ `opsRecent`, `EngineService.Status` ↔ `engineStatus`.
  Only the first is a genuine rename (`Delete` is not a Go keyword, but `Remove` was chosen); the
  wrapper in §4.2 must not assume a mechanical `lowerCamel(GoName)` mapping. Read the Go file.

Channel disposition after P56, which is what P57 acts on:

| Group | Count | P57 action |
|---|---:|---|
| Request/response, bound | 39 | `control.ts` calls the generated binding |
| Fire-and-forget (`appFlushed`) | 1 | `control.ts` calls `LifecycleService.Flushed()` |
| Go→renderer push, emitted | 19 | `control.ts` subscribes via `Events.On` |
| Go→renderer push, **dead** (`kira:engine:state`) | 1 | **Deleted** from `ipc.ts` and from `control.ts` (D6) |
| `MessagePort` transfer (`kira:port`) | 1 | **Deleted**; replaced by the `engine` Stream (D3) |
| | **61** | |

`kira:engine:state` is the channel P56 D5 deliberately gave no emitter. Re-verified here: zero
emitters in `src/main`, and its only renderer-side subscriber is `control.ts:52`'s `onEngineState`
pass-through wrapper, which nothing calls. `shell/frontend/shim/kira-bridge.ts:61` subscribes to it
too, and that file is being retired anyway. Nothing observes its removal.

### 1.10 `control.ts`'s and `data.ts`'s `plain()` helpers lose their subject

Both files carry an identical `plain<T>(value) { return JSON.parse(JSON.stringify(value)) }` helper
(`control.ts:40-42`, `data.ts:28-30`), each with a comment naming a **structured-clone** constraint:
contextBridge cannot clone Vue `reactive()` Proxy wrappers, and neither can `MessagePort.postMessage`.

Under Wails, both transports are JSON:

- Bound calls: `runtime.ts:158` is `const bodyStr = JSON.stringify(body)` over `{object, method, args}`.
- Stream frames: `send(JSON.stringify(req))` per §1.3, or `JSONStream`'s own `JSON.stringify`
  (`stream.ts:592`).

`JSON.stringify` traverses a Proxy transparently — that is the whole reason `plain()` works today.
So the pre-serialisation is now a **redundant extra full copy of every request payload**, on the hot
path (`data.ts`'s `read`/`count`/`execute` payloads carry filters, projections and cursors on every
scroll). Both helpers and all ~20 of their call sites retire. D4.

This is not a micro-optimisation dressed up as cleanup: `data.ts`'s `plain()` runs on every page
request, and removing it is one of the few places this migration makes the hot path shorter rather
than longer. It is also the one edit `data.ts` does take, which §3 records honestly against §1.1's
"unchanged" claim.

### 1.11 The frontend test tier's mocking mechanism has no Wails analogue at all

This is the largest genuinely-unsolved problem P52 §12 left, and P52 §12.3 underestimates it.

`tests/ipc/support/mockControl.ts` mocks the control channel by
`app.evaluate(({ipcMain}) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, ...) })` —
i.e. **inside the Electron main process**. Its own doc comment says why it must live there:
*"never in the renderer, because `window.kira` is deeply frozen and non-configurable, and
`renderer/bridge/control.ts` binds it at module scope regardless (F4)"*.

There is no Wails equivalent of `ElectronApplication.evaluate`. Playwright cannot execute code
inside the Go process. So this mechanism does not port — it has to be replaced, and P52 §12.3's
sketch ("`window.kira` — a hand-written object with the same method names") replaces it with
something **weaker** than what exists: a renderer-side fake sits *in front* of the bridge, so a
frontend spec would no longer cross the real serialisation boundary, and P50 D3's explicit design
property would be lost in the port.

§1.4 and §1.7 together provide a better answer — intercept the two real HTTP transports
(`page.route` on `/wails/runtime` for control, `_wails.streamFactory` for the stream), which puts
the mock *behind* the real bridge exactly as `ipcMain` did. D13/D14.

`mockPort.ts` is the easier half: it already installs itself through the renderer's own
`{__kira:'port'}` door (`mockPort.ts:207`), so only the door changes.

### 1.12 The `tests/ipc` backend harness imports five `src/main` modules, and one of them generates fixtures

`tests/ipc/support/harness.ts` dynamically imports `src/main/storage/db`, `src/main/storage/migrate`,
`src/main/storage/paths`, `src/main/tree-service` and `src/main/storage/repos/connections`
(`:68-72`), plus two `src/main` types (`:97`, `:115`). Deleting `src/main` breaks all seven
backend specs, exactly as P52 §12.2 predicted ("they keep the engine half and drop the `TreeService`
half").

But P52 §12.2 then makes a claim that does **not** survive reading the specs:

> *"`tests/ipc/**/<adapter>.fixture.ts` — kept verbatim, and this is the single most fortunate thing
> about this migration's test story … they describe *engine* responses, and the engine is not
> changing."*

They do not all describe engine responses. `redis.backend.spec.ts:150-195` (and its six siblings)
build `controlSnapshots` entries for `IPC.treeChildren` whose `response` is the return value of
`harness.children(...)` — i.e. of the **real `src/main/tree-service.ts`**, including its
`source: 'server' | 'cache'` and `truncated` fields, which are TreeService's own contribution, not
the engine's. Delete `src/main` and those snapshots become unregenerable frozen data, and the
anti-drift guarantee that justifies the whole two-tier split lapses for the tree half.

Two mitigating facts, both checked:

- **TreeService's cache-miss path is thin.** `src/main/tree-service.ts:93-107`: call the engine op,
  then `return {nodes: result.nodes, source: 'server', truncated: !!result.truncated}`. Every field
  in the snapshot except the two literals comes straight from the engine.
- **Only one backend assertion depends on the cache half.** Grepped: `mariadb.backend.spec.ts:103`
  (`assert.equal(dbChildrenSecond.source, 'cache')`) is the sole tree-cache assertion across all
  seven specs. (`mariadb:161`'s `countSecond.source === 'cache'` is the *engine's* L1/L2 count cache,
  which is unaffected.)
- **The cache behaviour itself is already covered in Go.** `shell/internal/tree/service_test.go`
  exists (P55), covering hit/miss/refresh/schema-mismatch/truncation per P52 §13's `tree` row.

D15 turns this into a ~20-line harness shim rather than a lost tier.

### 1.13 Packaging: the script P52 §10.1 named does not exist, and the app still has the spike identity

Three findings from the tree, all of which P57 owes:

1. **`scripts/sign-bundle.sh` is absent.** `package.json:44`'s `package:wails` is
   `cd shell && wails3 task darwin:package && sh scripts/sign-bundle.sh` — the second half has never
   been written. P52 §10.1 specifies its four `codesign` lines exactly. So `bun run package:wails`
   fails today, and nothing has noticed because nothing runs it. §4.13.
2. **The app still carries the coexistence identity.** `shell/build/darwin/Info.plist` has
   `CFBundleIdentifier com.kirathecat.kira-studio-shell` and `CFBundleName kira-studio-shell`;
   `shell/Taskfile.yml:4` sets `APP_NAME: "kira-studio-shell"`; `shell/main.go:157` sets
   `Name: "Kira Studio Shell"` with a `Description` reading *"(Wails/Go spike shell)"*. P52 §3.1 is
   explicit that this was deliberate — *"the two apps must be distinguishable in Activity Monitor
   and in the Keychain during coexistence; P57 changes it to `com.kirathecat.kira-studio`"*. §4.8.
3. **The Keychain service name is the coexistence one too**, by the same P52 §6.2 design ("`Kira
   Studio Safe Storage`", distinct from the Electron build's item). Unlike the bundle id, this one
   **must not change** — D12 explains why, and it is the one place where "finish the cutover" is the
   wrong instinct.

### 1.14 CI references five Electron-only scripts, and P52 §14 does not mention CI at all

`.github/workflows/ci.yml` runs `bun run build` (`:29`), `bun run verify:packaging` (`:30`, `:94`),
`bun run test:e2e` (`:51`) and `bun run package:mac:dir` (`:83`), and asserts against
`dist/mac-arm64/Kira Studio.app/Contents/Resources/app.asar.unpacked/out/main/engine.js` and
`CFBundleIdentifier == com.kirathecat.kira-studio` (`:84-93`). `release.yml` runs `bun run build`,
`bun run package:mac` and `bun run verify:packaging` (`:39-50`). The `e2e-smoke` job additionally
builds a macOS keychain for `safeStorage` (`:42-50`), which has no subject once `secret-cipher.ts`
is gone.

P52 §14's documentation list names ARCHITECTURE, PERF, PACKAGING, AGENTS and SPEC — **not the
workflows**. Every one of the scripts above is deleted or renamed by this phase, so both workflows
break on the first push after M5. §4.14.

### 1.15 The complete Electron-reference inventory

Grepped across `src/`, so the deletion milestones have a checklist rather than a memory:

| Location | References | Fate |
|---|---|---|
| `src/main/**` (50 files, 3 406 lines) | 14 files import `electron` | **Deleted** (M6) |
| `src/preload/index.ts` (161 lines) | `contextBridge`, `ipcRenderer` | **Deleted** (M6) |
| `src/engine/index.ts` (56 lines) | `import type { MessagePortMain }` — the **only** `electron` reference under `src/engine/`, and type-only | **Deleted** (M6); `stdio-main.ts` is its replacement (P54) |
| `src/renderer/bridge/{control,port}.ts` | `window.kira`, `MessagePort` | **Rewritten** (M1–M2) |
| `src/renderer/env.d.ts:10-16` | `declare global { interface Window { kira: KiraApi } }` | **Deleted** (M1) |
| `src/shared/protocol/ipc.ts` (263 lines) | `IPC` const + `KiraApi` + 8 result interfaces | **Reduced** (D7) |
| `src/renderer/shortcuts/keys.ts:6` | `navigator.userAgent.includes('Mac')` | **Kept** — a UA sniff, not an Electron API; works under WKWebView |

`src/shared/domain/**` and `src/shared/protocol/{page,port,data-ops,engine-ops}.ts` contain no
Electron reference and are untouched.

## 2. Decisions

**D1 — `control.ts` and `port.ts` keep their exported surfaces byte-compatible; only their bodies
change.** §1.1 is the evidence: this is what keeps `data.ts`'s thirteen importers,
`workbench/state/engine.ts`, and every `.vue` file out of the diff. Concretely: `port.ts` still
exports `ready: Promise<void>`, `request(op, payload?, opts?)` and `onPortEvent(topic, cb)` with
identical signatures; `control.ts` still exports a `control` object whose every property keeps its
name, arity and return type. The one exception is `control.onEngineState`, deleted by D6 because it
has no callers. A named alternative — collapsing `control.ts` into per-domain modules while we are
in here — is **rejected**: it would mix a transport swap with a refactor in the phase least able to
afford an ambiguous failure.

**D2 — `port.ts` uses `JSONStream("engine")`, not `Stream("engine")`.** This departs from P52 §7.2's
literal instruction, on evidence P52 did not have: §1.3 shows the two produce identical bytes and
identical hops, so the performance reasoning P52 gave does not distinguish them. What does
distinguish them is that `JSONStream` puts the decode inside `_decode`, where a malformed frame
raises an `error` event and is dropped (`stream.ts:394-399`), instead of throwing inside our
`onmessage` where it would propagate into the runtime's poll dispatch. The renderer's own code gets
smaller (no `TextDecoder`, no `JSON.parse`, no try/catch) and the failure mode gets better. The Go
side is unaffected — `bridge/stream.go` sends and receives opaque bytes either way, and
`ServeEngineStream` never unmarshals.

**D3 — `port.ts`'s `ready` promise is resolved by the socket's `open` event, and `request()` awaits
it before sending.** §1.2's first trap: `send()` on a `CONNECTING` socket throws, and today's
`request()` sends synchronously. The fix is to make `request()` `await ready` before its `send`,
which is a change no caller can observe: `data.ts` already awaits every `request()`, and
`workbench/state/engine.ts:16-18` already awaits `ready` explicitly before its first call. On
`close`, `ready` is replaced with a rejected-state flag and every pending request is rejected —
`port.ts:21-27`'s `rejectAllPending` survives, driven by the `close` event instead of by the
`{__kira:'port'}` message.

**D4 — both `plain()` helpers are deleted.** §1.10. `JSON.stringify` at the transport already
handles Vue's Proxies; keeping a hand-rolled pre-copy would be a redundant full clone of every
payload on the data hot path, retained for a constraint that no longer exists. Their comments are
deleted with them rather than reworded — a comment explaining a structured-clone workaround in a
codebase with no structured clone is worse than no comment.

**D5 — one unwrap point, and it reads `cause` first, `message` second, and tests for a `code`
string.** §1.6 is the evidence, including the probe. `control.ts` gains a single
`unwrap<T>(p: Promise<T>): Promise<T>` that catches, inspects, and rethrows an `Error` whose
`.message` is the human message and whose `.code` is set. Order: if `err.cause` is an object with a
string `code`, use `{code, message}` from it; else if `err.message` parses as JSON with a string
`code`, use that (belt and braces against a future Wails change to `cause`); else
`{code: 'E_INTERNAL', message: err.message}`. The empty-object case from §1.6's probe falls through
to the last branch, which is the correct answer for it. This is the one place P52 §5.3's
"two-line change" clause is spent, and it is spent in the direction §5.3 hoped for.

**D6 — `kira:engine:state` and `control.onEngineState` are deleted, not carried.** §1.9. P56 D5
recorded it for exactly this phase. Deleting a channel with no emitter and no subscriber is not a
behaviour change; keeping it would preserve a dead entry in a file whose whole purpose is being
rewritten.

**D7 — `src/shared/protocol/ipc.ts` is reduced to `src/shared/protocol/events.ts`, and the wire
types come from the generated bindings.** P52 §7.1 says the file "is deleted at P57 — its `IPC`
const survives only as the event-name strings, which move to a small
`src/shared/protocol/events.ts`". Refined by reading the file: `ipc.ts` also holds `KiraApi` (which
dies with `window.kira`) and **ten result interfaces** (`AppInfo`, `EngineStatus`,
`AppMetricsSample`, `ConnectionTestResult`, `TreeChildrenResult`, `TreeDescribeResult`,
`TreeDefinitionResult`, `FilesChooseSaveResult`, `FilesChooseOpenResult`, `FilesChooseOpenArgs`) that
`control.ts` and renderer state modules import as types. Those become the generated bindings' own
model types, per P52 §7.1's "generated types become the single source of truth" — which is the
point of generating them. `events.ts` keeps the 19 live push-channel strings and nothing else.
`AppInfo` is a special case: `shell/internal/bridge/app.go:14-20` already replaced
`electron`/`chrome` with `go`/`wails`, and its own comment records that nothing in the renderer reads
the fields — re-verified here, `control.appInfo` has **zero callers** in `src/renderer`. So the
shape difference costs nothing and needs no compatibility layer.

**D8 — `@wailsio/runtime@3.0.0-beta.15` is added as a devDependency purely for types, and
`tsconfig.web.json` maps `/wails/runtime.js` onto it.** §1.8. The alternative — a hand-written
`declare module "/wails/runtime.js"` ambient declaration — is smaller but has to be maintained by
hand against a beta runtime whose `Call`, `Events` and `Stream` signatures this renderer now depends
on, and a stale hand-written declaration fails silently (it type-checks against a lie). The npm
package's version string is pinned in the module's own `package.json` and matches `go.mod` exactly,
so the two cannot skew without someone noticing. Nothing changes at runtime: `vite.wails.config.ts`
already externalises `/wails/`, so the bundled runtime is still what executes, and the npm package
is never bundled. **Named fallback**, if the npm package proves unfetchable in this environment: the
ambient declaration, hand-written from the module cache's `src/*.ts`, with a comment naming the
source file and version it was transcribed from.

**D9 — `shell/frontend/shim/kira-bridge.ts` is deleted, and so is `vite.wails.config.ts`'s
`injectKiraShim` plugin and its `shim` rollup input.** The shim's own header says it exists *"so the
real, unmodified src/renderer can boot inside a real Wails webview without src/ ever being
touched"*. P57 touches `src/`, so the reason is spent. Deleting it removes the whole
`transformIndexHtml` mechanism AGENTS.md's P52 findings describe as fragile (inline module scripts
silently not bundled; CSP `script-src 'self'` blocking srcless scripts), which is a real
simplification and not merely a tidy-up. Checked: nothing else imports it.

**D10 — `vite.wails.config.ts` is renamed to `vite.config.ts` and becomes the only Vite config.**
Once `electron.vite.config.ts` is gone there is one renderer build, and a config named for a
coexistence that has ended is a stale signpost. The `-c` flag disappears from
`package.json`'s `build:wails`, which becomes plain `build`. Keeping the `:wails` suffix on scripts
that are now the *only* build is the same stale-signpost problem one level up, so the script names
collapse too (§4.7).

**D11 — the bundle identity becomes the shipping identity in one milestone, all four places at
once.** §1.13. `Info.plist`'s `CFBundleIdentifier`/`CFBundleName`, `Taskfile.yml`'s `APP_NAME`,
`main.go`'s `Name`/`Description`. Splitting these across milestones would produce a bundle whose
plist and Taskfile disagree, which AGENTS.md's P52 findings already record as a real
code-signing-breaking failure mode (*"a `CFBundleExecutable` mismatch breaking code signing"*).

**D12 — the Keychain service name does **not** change.** It stays `Kira Studio Safe Storage`
(P52 §6.2). This looks like an oversight to fix and is not: the name is what the OS uses to find the
item, so renaming it at cutover would orphan the encryption key of every user who ran a P52–P56
build, turning every stored password into an undecryptable `kira:v2:` blob. The name being "distinct
from the Electron build's own item" is a permanent property of this design, not a coexistence
artifact — the Electron build's `safeStorage` item is a *different item under a different service
name owned by Chromium*, and it is never read again either way (P52 §5.1's fresh-database rule).
Changing the bundle identifier (D11) is safe for the same reason it is necessary: the item is
looked up by service and account, not by bundle id.

**D13 — the frontend tier mocks the control plane with `page.route('**/wails/runtime')`, and
bindings are generated with `-names`.** §1.7 and §1.11. This preserves P50 D3's explicit design
property — the mock sits *behind* the real bridge, so the spec exercises the real `Call` path, the
real `fetch`, the real JSON boundary and the real error decoding, which a renderer-side
`window.kira` fake would all bypass. `-names` is what makes it legible: the intercepted body carries
`args.methodName` as `github.com/kirathecat/kira-studio/shell/internal/bridge.ConnectionsService.List`
rather than `4229262106`, so the harness's `channel → FQN` table is readable and a mismatch produces
a diagnosable failure. The cost of `-names` is a slightly larger request body on every call, which
is irrelevant next to the payloads these calls carry. A fixture miss returns a real 422 with a
`CallError` body, which additionally exercises D5's unwrap for free.

**D14 — the frontend tier mocks the data plane with `window._wails.streamFactory`.** §1.4. It is an
official seam in the runtime, it leaves the real `port.ts` running above it (framing, pending map,
timeouts, `ready` gating all exercised), and it avoids reimplementing the long-poll/batch/backoff
protocol of `stream.ts:648-901`, which would be a large mock of a beta wire format. `mockPort.ts`'s
existing snapshot-matching logic (`matchKey`, the per-key cursor, `delayMs`) ports verbatim; only
the door changes, from `window.postMessage({__kira:'port'}, ...)` to a fake socket object.

**D15 — `tests/ipc/support/harness.ts` keeps its tree half via a ~20-line in-harness cache-aside,
not via `src/main` and not by dropping it.** §1.12. Three options were weighed:

- *Drop the tree half entirely.* Loses `treeChildren` fixture generation, which seven frontend specs
  consume, and forces regenerating seven fixture files — each of which needs Docker and a real
  container, so the change could not land in an environment without them.
- *Return `source:'server'` unconditionally.* Same fixture-regeneration problem, plus it breaks
  `mariadb.backend.spec.ts:103`.
- *Keep a `Map`-backed cache-aside in the harness.* The fixtures stay **byte-identical**, no
  regeneration is needed, no Docker is needed to land the change, and all seven specs keep passing
  unmodified. The persistence behaviour it stands in for is covered for real in Go
  (`shell/internal/tree/service_test.go`).

The third wins, with the honesty requirement that the harness's own doc comment must say plainly
that it is a test-local stand-in for `internal/tree.Service`'s cache-aside, that it exists to keep
fixture generation reproducible, and that the real cache semantics are asserted in Go — not let a
reader believe the tier still covers TreeService.

**D16 — `tests/e2e/` is deleted, not ported, and three specs' coverage is written off explicitly.**
P52 §12.1/§12.3 already decided the tier moves to webkit. Refined by reading the specs: 23 spec
files, of which the pure-UI majority port into `tests/ui/`, `budgets`/`perf`/`leaks` re-create
against renderer-owned instrumentation (`__kiraGridRetainedBytes`, `__kiraGridScrollWorkStart`,
which are renderer globals in `src/renderer/main.ts:21-58` and survive untouched), and **five** do
not port: `hardening.spec.ts` (no `webPreferences`, no fuses, no Chromium permissions — no subject),
`startup.spec.ts` (no `app.evaluate(() => process.uptime())` analogue), and the three full-stack
anchors `sqlite`/`mongo`/`s3`. `s3.spec.ts` is the costliest single loss and is named as such in §7:
it is the only spec exercising the real save/open dialogs and `DATA_OP.objectDownload`'s "the engine
writes the file itself" contract, which no mock can honestly stand in for.

> **Amended, not reversed (`docs/v1/plans/P57-e2e-revisit.md`, written after M5 was already in
> progress).** `tests/e2e/` is still deleted and 20 of its 23 specs are still written off exactly as
> below. But a real-backend tier turned out to be possible after all, through a mechanism nobody in
> P51-P57 had looked at: Wails v3 beta.15's `-tags server` build mode serves the whole bound-call
> surface and the data-plane stream over a real TCP listener, with zero source changes and no native
> window — so a plain Playwright browser tab can drive the real Go backend, the real embedded
> engine, and a real database adapter. Verified empirically (real SQLite and real Postgres
> round-trips, 2-7s, no Xvfb). Two new specs recover the *wiring* value of the three retired anchors
> at roughly 150 lines total: `tests/e2e-real/sqlite-real.spec.ts` (Docker-free) and
> `tests/e2e-real/postgres-real.spec.ts` (a real container). A third, `s3-download-real.spec.ts`, is
> conditional on whether a `tests/db/s3.spec.ts` case for the same file-write contract (see below)
> makes it redundant. None of this claims back native window chrome, menus, real save/open dialogs,
> or lifecycle — see `P57-e2e-revisit.md` §4 for the unchanged list of what stays lost.

**D17 — `tests/electron-db/kafka.spec.ts` moves to `tests/db/kafka.spec.ts` and runs under the
vendored Node.** P52 §12.2, unchanged, and P51 part 4 already proved the addon loads under a stock
Node. The `tests/electron-db/` directory and its tsconfig go away, and `typecheck:db` loses its
second project.

**D18 — `docs/ARCHITECTURE.md`'s "bulk data skips the main process" invariant is rewritten, not
quietly dropped.** P52 §7.2 owes this and states the replacement text: bulk data **passes through
the Go process without being parsed, copied or re-encoded**. `bridge/stream.go`'s implementation is
the proof — `ServeEngineStream` forwards `conn.Receive()`'s bytes to `host.SendData` verbatim and
attaches `conn` directly as the `enginehost.Sink`, so neither direction is unmarshalled. Weakening a
documented invariant silently is the failure mode this decision exists to prevent.

## 3. Target tree

```
src/renderer/bridge/
  control.ts            REWRITTEN  generated bindings + Events.On; unwrap(); plain() gone (D1,D4,D5,D6)
  port.ts               REWRITTEN  JSONStream("engine"); ready on open; same exports (D1,D2,D3)
  data.ts               EDITED     plain() and its comment removed; everything else identical (D4)
src/renderer/
  env.d.ts              EDITED     the `window.kira` global declaration removed (§1.15)
  workbench/state/engine.ts        UNCHANGED — proof of D1
src/shared/protocol/
  events.ts             NEW        the 19 live push-channel strings (D7)
  ipc.ts                DELETED    (D7)
src/main/                DELETED   50 files / 3 406 lines
src/preload/             DELETED   161 lines
src/engine/index.ts      DELETED   (stdio-main.ts is its replacement, P54)

shell/frontend/shim/kira-bridge.ts   DELETED  (D9)
shell/main.go                        EDITED   Name/Description -> shipping identity (D11)
shell/Taskfile.yml                   EDITED   APP_NAME (D11)
shell/build/darwin/Info.plist        EDITED   CFBundleIdentifier/CFBundleName (D11)

vite.config.ts           RENAMED   from vite.wails.config.ts; injectKiraShim + shim input removed (D9,D10)
electron.vite.config.ts  DELETED
electron-builder.yml     DELETED
package.json             EDITED    5 electron deps out, @wailsio/runtime in, scripts collapsed (D8,D10)
tsconfig.node.json       EDITED    src/main + src/preload + tests/e2e out; electron types out
tsconfig.web.json        EDITED    paths mapping for /wails/runtime.js (D8)
playwright.config.ts     EDITED    e2e project -> ui project

scripts/sign-bundle.sh          NEW      the four codesign lines P52 §10.1 specifies (§1.13)
scripts/verify-packaging.sh     REWRITTEN per P52 §10.2's mapping
scripts/native-electron-build.sh DELETED
scripts/run-ipc-backend.sh      EDITED   vendored node instead of ELECTRON_RUN_AS_NODE=1 electron

tests/e2e/                      DELETED  23 specs + fixtures.ts + support/ (D16)
tests/electron-db/              DELETED  moved to tests/db/kafka.spec.ts (D17)
tests/ui/                       NEW      the webkit tier (D13, D14)
  support/server.ts             NEW      static file server over shell/frontend/dist
  support/mockRuntime.ts        NEW      page.route on /wails/runtime, channel -> FQN (D13)
  support/mockStream.ts         NEW      window._wails.streamFactory fake socket (D14)
  <ported specs>
tests/ipc/support/harness.ts    EDITED   src/main imports out; Map-backed cache-aside in (D15)
tests/ipc/support/mockControl.ts REPLACED by tests/ui/support/mockRuntime.ts (D13)
tests/ipc/support/mockPort.ts   EDITED   same matching logic, new door (D14)
tests/ipc/**/*.fixture.ts       UNCHANGED — byte-identical, the point of D15
tests/unit/menu.spec.ts         DELETED  subject is Go (shell/internal/shell/menutemplate_test.go)
tests/unit/security.spec.ts     DELETED  subject is Go (shell/internal/shell/security_test.go)
tests/unit/support/window.ts    REPLACED by a bindings module mock (§5.3)

.github/workflows/ci.yml        EDITED   (§1.14)
.github/workflows/release.yml   EDITED   (§1.14)
docs/ARCHITECTURE.md            EDITED   Stack, Invariants, Process model, Storage, Security, Testing
docs/PACKAGING.md               REWRITTEN
docs/PERF.md                    EDITED   §2.1 re-measured, §3 procedures, L-D app size
AGENTS.md                       EDITED   P57 findings; Electron/Kafka/secrets sections rewritten
docs/v1/SPEC.md                 EDITED   P52-P57 rows
```

**No Go dependency change.** `shell/go.mod` and `go.sum` are untouched.

## 4. Designs

### 4.1 `src/renderer/bridge/port.ts` — the transport swap

The whole file, sketched to implementation depth. Exports are unchanged from today (D1); the pending
map, the timeout policy and `onPortEvent` are today's logic, moved.

```ts
import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';
import { JSONStream } from '/wails/runtime.js';

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error & { code?: string }) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

let nextId = 1;
const pending = new Map<number, PendingRequest>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

// P52 §7.2 / P56: one named stream, matching bridge/stream.go's StreamName. Wails supersedes an
// older page generation's session itself (stream.ts:424-425 + AttachStream's generation), which is
// what retires src/main/index.ts's own `generation` counter — nothing here re-implements it.
const socket = JSONStream('engine');

let closed = false;
let resolveReady!: () => void;
let rejectReady!: (err: Error) => void;
export const ready = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// The stream is opened at module scope and `ready` may reject before any caller attaches a
// handler; without this, a failed open is an unhandled rejection in the console rather than the
// error `initEngineState`'s own catch is about to report.
void ready.catch(() => {});

socket.onopen = () => resolveReady();

socket.onmessage = (ev: MessageEvent) => {
  // JSONStream decodes for us (stream.ts:520-527) — ev.data is the parsed frame, and a frame that
  // is not valid JSON raised `error` and never reached here (D2).
  handleMessage(ev.data as PortResponse | PortEvent);
};

socket.onclose = () => {
  closed = true;
  rejectReady(new Error('engine stream closed'));
  rejectAllPending('engine stream closed before this request answered');
};
socket.onerror = () => {
  // `error` is always followed by `close` (stream.ts:412-415), so the teardown lives in onclose
  // alone rather than being duplicated and having to be made idempotent.
};
```

`handleMessage`, `rejectAllPending` and `onPortEvent` are copied from today's file unchanged
(`port.ts:21-27`, `:44-70`) — they operate on the decoded frame and know nothing about the
transport.

`request()` changes in exactly two ways: it awaits `ready` before sending, and it sends an object
rather than posting a message.

```ts
export function request(
  op: string,
  payload: unknown = null,
  opts?: { timeoutMs?: number | null },
): Promise<unknown> {
  if (closed) return Promise.reject(new Error('engine stream is closed'));
  const id = nextId++;
  const timeoutMs = opts?.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  return new Promise((resolve, reject) => {
    const timer = timeoutMs === null ? null : setTimeout(() => {
      pending.delete(id);
      reject(new Error(`engine request "${op}" timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const req: PortRequest = { kind: 'req', id, op, payload };
    // D3: send() throws on a CONNECTING socket (stream.ts:275-278) and silently drops on a closed
    // one (:279-281), so the send is gated on the open ack rather than fired synchronously. The
    // timer starts now, not after the ack — a request issued during a slow open must still time
    // out on the caller's schedule, which is the behaviour today's null-port rejection approximates.
    ready.then(
      () => { if (!closed) socket.send(req); },
      (err) => { pending.delete(id); if (timer) clearTimeout(timer); reject(err as Error); },
    );
  });
}
```

The `timeoutMs: null` contract (`port.ts:72-76` — no client-side timeout for data ops, cancellation
is the only escape hatch, D25) is preserved exactly.

**What is deliberately not carried over:** the `window.addEventListener('message', ...)` handshake
(`port.ts:29-42`) and the `{__kira:'port'}` protocol. Its two jobs — receiving a transferred port,
and rejecting everything pending on a replaced one — are now the runtime's `open` event and the
`close` event respectively.

### 4.2 `src/renderer/bridge/control.ts` — bindings and events

Shape, with the three representative cases; the other ~50 properties follow one of them mechanically.

```ts
import { Events } from '/wails/runtime.js';
import * as AppService from '@bindings/.../appservice';
import * as ConnectionsService from '@bindings/.../connectionsservice';
/* ...ten more service imports... */
import { CHANNEL } from '@shared/protocol/events';

// D5. Wails delivers a bound method's error as a RuntimeError whose .message is ipcerr.Error's own
// JSON encoding and whose .cause is that same {code, message} as an object
// (bindings.go:423-438 + :466-473, transport_http.go:376-397, runtime.ts:165-177). Unwrapped once,
// here, so every consumer keeps reading `err.message` for display and `err.code` for branching —
// which is what views/shared/viewOp.ts's classifyLoadError already does for the data channel.
function unwrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    const e = err as { message?: string; cause?: unknown };
    const cause = e.cause as { code?: unknown; message?: unknown } | undefined;
    let code = 'E_INTERNAL';
    let message = e.message ?? String(err);
    if (cause && typeof cause === 'object' && typeof cause.code === 'string') {
      code = cause.code;
      message = typeof cause.message === 'string' ? cause.message : message;
    } else {
      // Belt and braces: a Wails change that stops populating `cause` still leaves the same JSON
      // in `.message`, because ipcerr.Error.Error() is what CallError.Message is built from.
      try {
        const parsed = JSON.parse(message) as { code?: unknown; message?: unknown };
        if (typeof parsed.code === 'string') {
          code = parsed.code;
          if (typeof parsed.message === 'string') message = parsed.message;
        }
      } catch { /* not our JSON — E_INTERNAL with the raw text is the right answer */ }
    }
    const out: Error & { code?: string } = new Error(message);
    out.code = code;
    throw out;
  });
}

function on<T>(name: string, cb: (payload: T) => void): () => void {
  return Events.On(name, (ev: { data: T }) => cb(ev.data));
}

export const control = {
  appInfo: () => unwrap(AppService.Info()),
  // Go-side name is Remove, not Delete (§1.9) — read the .go file, do not assume lowerCamel.
  connectionsDelete: (id: string) => unwrap(ConnectionsService.Remove({ id })),
  onConnectionState: (cb: (s: ConnectionState) => void) => on(CHANNEL.connectionState, cb),
  /* ... */
};
```

Three rules the implementer must hold to, each with a reason:

1. **Every bound call is wrapped in `unwrap`.** A single unwrapped call is a path where the user sees
   raw JSON (§1.6, consequence 2). §5.4 has the test that pins this.
2. **`plain()` is gone from every call site** (D4) — `connectionsCreate: (input) => unwrap(Create(input))`,
   not `unwrap(Create(plain(input)))`.
3. **`onEngineState` is deleted** (D6), and so is `engineStatus`'s neighbour comment about it.

The `@bindings/*` alias is a `vite.config.ts` `resolve.alias` plus a matching `tsconfig.web.json`
`paths` entry — a bare `../../../shell/frontend/bindings/github.com/kirathecat/...` specifier
repeated 12 times would be unreadable and would break if either tree moves.

### 4.3 `src/renderer/bridge/data.ts` and `workbench/state/engine.ts`

`data.ts`: delete `plain` (`:28-30`) and its comment (`:25-27`), and unwrap its ten call sites
(`plain(req)` → `req`). Nothing else changes — the `DATA_OP` constants, `assertPageStructure`, the
`NO_TIMEOUT` policy and `onCacheStats` are all transport-agnostic.

`workbench/state/engine.ts`: **unchanged**. `await ready` then `await request('ping')` works exactly
as written against the new `port.ts` (D1/D3). This file is the one AGENTS.md's P56 findings call out
as stuck on `'connecting'` forever; it is fixed by the transport underneath it, with no edit — which
is the cleanest possible demonstration that D1 held.

### 4.4 `src/shared/protocol/events.ts`

```ts
/** The Go→renderer push channels (P56 bridge/events.go's constants, verbatim). Formerly the push
 *  half of ipc.ts's IPC const; the request/response half retired with window.kira, and the wire
 *  types now come from the generated bindings (P57 D7). */
export const CHANNEL = {
  openSettings: 'kira:open-settings',
  newConnection: 'kira:menu:new-connection',
  /* ...the 11 kira:menu:* ... */
  appFlushBeforeClose: 'kira:app:flush-before-close',
  connectionState: 'kira:connection:state',
  connectionMetadataInvalidated: 'kira:connection:metadataInvalidated',
  connectionsChanged: 'kira:connections:changed',
  settingsChanged: 'kira:settings:changed',
  opUpdate: 'kira:op:update',
  appMetrics: 'kira:app:metrics',
} as const;
```

19 keys. `kira:engine:state` is absent (D6); so is `kira:port` (D3); so are the 40 bound-method
channels. §5.4 pins these against `shell/internal/bridge/events.go`'s Go constants, which is the
same anti-drift check `TestChannelConstantsMatchIpcTs`
(`shell/internal/bridge/events_test.go:124`, P56 §5.1) runs from the other side — and after this
phase the file that test names no longer exists, so **it needs its table re-pointed at `events.ts`
and its name changed**, which is easy to forget and is called out in M6. It fails loudly rather
than silently, which is the good case.

### 4.5 `src/renderer/env.d.ts`

Delete lines 10–16 (the `KiraApi` import and the `declare global { interface Window { kira } }`
block). The `*.vue` module declaration and the `vite/client` reference stay.

### 4.6 Deletions: `src/main`, `src/preload`, `src/engine/index.ts`

Mechanical, once nothing imports them. The ordering constraint (§0.3) is the only subtle part.
Before deleting, `grep -rn "src/main\|src/preload" src/ tests/ scripts/ *.ts *.json` must return
nothing but `tests/ipc/support/harness.ts` (fixed in M4 by D15) — this grep is the deletion's own
precondition and belongs in the milestone, not in a reviewer's head.

`src/engine/index.ts` is deleted rather than edited: P52 §4.4 is explicit that `stdio-main.ts` was
built as *"a second, complete entry point"* precisely so that this deletion is a deletion and not a
merge.

### 4.7 `package.json`

Removed from `devDependencies`: `electron`, `electron-builder`, `electron-vite`,
`@electron/rebuild`. Removed from `dependencies`: `electron-log`. Removed from
`trustedDependencies`: `electron`. Added to `devDependencies`: `@wailsio/runtime` at
`3.0.0-beta.15` (D8). `"main": "out/main/index.js"` is deleted — there is no Node entry point.

Scripts, before → after (D10):

| Today | After |
|---|---|
| `predev`, `dev`, `build`, `start` (electron-vite) | `dev` → `bun run build && cd shell && wails3 task dev`; `build` → `vite build` |
| `build:wails`, `dev:wails` | folded into `build` / `dev` |
| `package:mac`, `package:mac:dir`, `prepackage:mac` | `package` → `cd shell && wails3 task darwin:package && sh scripts/sign-bundle.sh` |
| `test:e2e`, `pretest:e2e` | `test:ui` → `bun run build && playwright test --project=ui` |
| `test:ipc:fe` (electron-vite build + playwright) | `bun run build && playwright test --project=ipc-frontend` |
| `test:ipc:be` | unchanged name; `scripts/run-ipc-backend.sh` changes runtime (§4.11) |
| `test:db:kafka`, `pretest:db:kafka` | folded into `test:db`; runs under the vendored node (D17) |
| `typecheck:db` | drops the `tests/electron-db` project |
| `verify:packaging`, `test:go`, `build:engine` | unchanged |

`bun.lock` is regenerated by the dependency change; that is expected and is not a hand edit.

### 4.8 Bundle identity (D11)

| File | From | To |
|---|---|---|
| `shell/build/darwin/Info.plist` | `com.kirathecat.kira-studio-shell` / `kira-studio-shell` | `com.kirathecat.kira-studio` / `Kira Studio` |
| `shell/Taskfile.yml:4` | `APP_NAME: "kira-studio-shell"` | `APP_NAME: "Kira Studio"` |
| `shell/main.go:157-158` | `Name: "Kira Studio Shell"`, Description `"…(Wails/Go spike shell)"` | `Name: "Kira Studio"`, Description without the spike clause |

`main.go`'s `Name` is not cosmetic: `NewQuitMenuItem`/`NewHideMenuItem`/`NewAboutMenuItem` read
`globalApplication.options.Name` for their labels (P56 §1.4), so the app menu's "Quit Kira Studio
Shell" becomes "Quit Kira Studio" as a consequence of this one line. `shell/internal/shell`'s menu
tests take `AppName` as a parameter and are unaffected.

**The one thing that must not move**: `internal/secrets`' Keychain service string (D12). A grep for
`kira-studio-shell` after this milestone should return nothing; a grep for
`Kira Studio Safe Storage` must still return the secrets package.

### 4.9 `playwright.config.ts`

The `e2e` project (`testDir: ./tests/e2e`, `workers: 1`) is replaced by:

```ts
{ name: 'ui', testDir: './tests/ui', use: { browserName: 'webkit' }, fullyParallel: true,
  workers: '50%' },
```

`fullyParallel: true` is a real change from `e2e`'s `workers: 1`, and it is justified rather than
inherited: the serialisation existed because concurrent Electron apps contend over wall-clock/RSS
budgets and Docker containers (the config's own comment, `:3-10`). The webkit tier has neither — no
native app, no container, and the mocks are per-page. This is the same reasoning that already made
`ipc-frontend` fully parallel, applied to the tier that just became mock-backed. If a ported
budget/perf spec proves flaky under parallelism, the honest fix is a per-spec
`test.describe.configure({ mode: 'serial' })`, not re-serialising the tier.

The `ipc-frontend` project keeps its name, `testDir` and settings; only its mocking mechanism moves
(D13/D14).

### 4.10 `tests/ui/support/` — the webkit tier's three new modules

**`server.ts`** — an HTTP static server over `shell/frontend/dist`, started per worker. It must
serve `index.html` for `/`, and it must **not** attempt to serve `/wails/*`: those requests are
intercepted by `mockRuntime` (control) or never issued at all (stream, D14). A `/wails/*` request
reaching the static server is a real bug — a call the mock did not intercept — so it returns 501
with a body naming the path, rather than 404, which would look like a missing asset.

**`mockRuntime.ts`** — `page.route('**/wails/runtime', ...)`:

```ts
// Reads the POSTed body's args.methodName (calls.ts:126-128, generated with -names per D13),
// maps it to a channel via CHANNEL_TO_FQN, and answers from the fixture's controlSnapshots with
// the same grouped-by-key, cursor-per-key sequencing mockControl.ts already used
// (mockControl.ts:58-82) — the semantics that let one channel have several ordered answers.
// A miss answers 422 with {kind:"RuntimeError", message, cause:{code:"E_FIXTURE_MISS", message}},
// the exact shape transport_http.go's httpError writes, so control.ts's unwrap (D5) turns it into
// an Error with .code === 'E_FIXTURE_MISS' — a fixture miss surfaces as a diagnosable app-level
// error rather than a network failure.
```

`CHANNEL_TO_FQN` is a hand-written table, one line per channel, colocated here. It is the one piece
of new coupling this design introduces and it is the price of keeping the fixtures byte-identical
(D15's constraint); §5.5 gives it a test that fails if it drifts from the Go service surface.

**`mockStream.ts`** — `page.addInitScript` installing `window._wails.streamFactory` (D14). The fake
socket implements `readyState`, `send`, `close`, `onopen`/`onmessage`/`onclose`/`onerror` and
dispatches `open` on a microtask so `port.ts`'s `ready` resolves. `send(value)` receives the
**already-stringified** frame (`JSONStream` wraps `send` before the factory's socket sees it —
`stream.ts:591-592`), so the fake parses it, matches against `portSnapshots` with `mockPort.ts`'s
existing `matchKey`, and replies by dispatching a `MessageEvent` whose `data` is the response
object. The `__kiraPortSeen` ordered request log (`mockPort.ts:174`, `:206`) ports unchanged — it is
the capability P50 D7 exists for.

### 4.11 `scripts/run-ipc-backend.sh`

One line changes: `ELECTRON_RUN_AS_NODE=1 electron "$bundle"` becomes
`shell/runtime/node/bin/node "$bundle"`. The `--external:electron` esbuild flag goes away with it
(nothing imports `electron` any more once D15 lands). The header comment's stated reason — *"because
`src/main/ipc/*` and `src/engine/{control,rpc}.ts` import `electron`"* — is now false for the first
half and was never true for the second (`src/engine/control.ts` and `rpc.ts` import no `electron`;
only `index.ts` did, and it is deleted). Rewrite the comment to the true reason, which survives:
**Bun cannot load some of the adapters this tier drives** (sqlite needs `node:sqlite`, kafka needs
the native-ABI driver), so a real Node is required — and the vendored one is now the real Node this
repo already ships.

The script must fail with a named message if `shell/runtime/node/bin/node` is absent, pointing at
`scripts/vendor-node.sh`, since `shell/runtime/` is git-ignored and a fresh container will not have
it (AGENTS.md, P56 §10).

### 4.12 `tests/ipc/support/harness.ts` (D15)

Replace the five `src/main` dynamic imports (`:68-72`) and `createTreeService` (`:113-117`) with a
local cache-aside over `engineOp`:

```ts
// A test-local stand-in for shell/internal/tree.Service's cache-aside, not a port of it. It exists
// only so this tier's fixture generation stays reproducible after src/main's deletion (P57 D15):
// the fixtures record `source` and `truncated`, which are TreeService's contribution rather than
// the engine's. The real cache semantics — persistence, the schema-mismatch drop, P43 iter3 D38's
// truncated-refresh rule — are asserted for real in shell/internal/tree/service_test.go, and this
// object deliberately implements none of them beyond hit/miss.
const cache = new Map<string, TreeNode[]>();
async function children(connectionId: string, path: string, refresh = false) {
  const key = `${connectionId} ${path}`;
  if (!refresh && cache.has(key)) {
    return { nodes: cache.get(key)!, source: 'cache' as const, truncated: false };
  }
  const res = await engineOp<{ nodes: TreeNode[]; truncated?: boolean }>(
    ENGINE_OP.children, { connectionId, path });
  // Mirrors tree-service.ts:105 — a truncated listing is never cached.
  if (!res.truncated) cache.set(key, res.nodes);
  return { nodes: res.nodes, source: 'server' as const, truncated: !!res.truncated };
}
```

`describe`/`definition` follow the same two-line shape. The SQLite database, `insertConnection`'s
foreign-key dance (`:123-141`) and the `connectionsStub` all go away with the real TreeService —
the harness stops needing a database at all, which also removes its `mkdtemp`/`rm` `KIRA_HOME`
handling for the DB (the engine's own `KIRA_HOME` use, if any, stays).

**The acceptance condition for this milestone is that all seven `*.fixture.ts` files are unchanged
by `git diff` after a fixture-write run** — which is the whole point of D15 and is directly
checkable wherever Docker is available.

### 4.13 `scripts/sign-bundle.sh` (new) and `scripts/verify-packaging.sh` (rewritten)

`sign-bundle.sh` is P52 §10.1's four lines, made into a real script with `set -eu`, a resolved
`$APP` path, and an explicit failure if the app bundle is absent:

```sh
codesign --force --sign - "$APP/Contents/Resources/engine/node-runtime/bin/node"
codesign --force --sign - "$APP/Contents/Resources/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
```

The nested paths must be **verified against a real packaged bundle**, not copied from P52 — P52 §10.1
wrote them from part 4's macOS session, and `shell/Taskfile.yml`'s packaging layout has changed
since (the resources layout is whatever `create:app:bundle` produces). §6 lists this as a macOS
check.

`verify-packaging.sh` follows P52 §10.2's mapping exactly. Reading the current script for this plan,
its structure is: `fail()` accumulates and every check runs before exit (`:9-10`), static checks
S1–S7, artifact checks A1–A6 gated on `dist/` existing. After the rewrite:

| Check | Fate |
|---|---|
| S1 (no updater dep), S2 (no updater code), S5 (scripts cannot publish) | Survive; S1's grep loses `electron-updater` and gains nothing, S5's target script becomes `package` |
| S3 (`dmg.writeUpdateInfo: false`), S4 (no `publish:` key) | **Deleted** — both read `electron-builder.yml`, which is gone. The *property* they protect (no auto-update) is preserved by S1/S2/S5 |
| S6 (`electronFuses`), S7 (`grantFileProtocolExtraPrivileges`) | **Deleted**; replaced by N1/N2 |
| A1/A2 (`latest*.yml`, `.blockmap`) | **Deleted** — electron-builder artifacts |
| A3 (ad-hoc signature) | Extended to the bundle **and** both nested executables |
| A4 (`engine.js` outside the asar) | Becomes "`engine.cjs`, its `node_modules` and the vendored `node` are present at their expected paths" |
| A5 (`CFBundleIdentifier == com.kirathecat.kira-studio`) | Survives verbatim — and after D11 it passes for the first time against the Wails bundle |
| A6 (Kafka `.node` unpacked, and only there) | Becomes "present beside the engine's `node_modules`, Mach-O arm64, signed" |
| **N1** (new) | The vendored runtime has `bin/node` and **no** `include/` or `lib/node_modules/npm` — P52 §3.1's trim is a build guarantee, not a hope |
| **N2** (new) | `codesign --verify --deep --strict` exits 0 |

The script's own header comment (`:2-7`) names P15's deliverable and `KIRA_STRICT_UPDATE_CHECK`;
the flag loses its subject with A2 and goes.

### 4.14 CI workflows (§1.14)

`ci.yml`:

- `checks`: `bun run build` still works (it is the Vite renderer build after D10); add
  `bun run build:engine` before it, since `vite.config.ts` no longer has anything to do with the
  engine bundle and the packaging job needs it. Add `bun run test:go`. The Go toolchain and — for
  `internal/shell` — the GTK/WebKit headers are needed; on `macos-15` the headers are not (that
  requirement is Linux-only, P56 §10), so `macos-15` needs only Go.
- `e2e-smoke` → `ui`: runs `bun run test:ui` on `ubuntu-latest` rather than `macos-15` (webkit needs
  no macOS), and **the keychain-preparation step is deleted** — its subject (`safeStorage`) is gone,
  and the webkit tier touches no secret backend.
- `package-smoke`: `bun run package:mac:dir` → `bun run package`; the asserted paths change from
  `dist/mac-arm64/Kira Studio.app/…app.asar.unpacked/out/main/engine.js` to the Wails bundle's
  layout; `CFBundleIdentifier` assertion is unchanged and now meaningful (D11). It needs
  `scripts/vendor-node.sh` to have run, which is a new step.

`release.yml`: `bun run package:mac` → `bun run package`; add the vendor-node and build-engine steps.

Both workflows should be read end to end during M7 rather than patched line-by-line from this table —
they are 95 and ~55 lines and this plan has not read `release.yml` in full.

### 4.15 Documentation (P52 §14, plus what reading found)

- **`docs/ARCHITECTURE.md`** (603 lines, 25 Electron references): the **Stack** table; the
  **Invariants** section's "bulk data skips the main process" (D18); the **Process model** section
  and its diagram; **Storage**'s `safeStorage`/`kira:v1:` paragraph (P52 §6); the **Renderer
  security surface** section (P52 §9 as corrected by P56 §1.6 — three rows changed there and the
  ARCHITECTURE text must match the corrected table, not P52's original); and **Testing**.
- **`docs/PACKAGING.md`** (220 lines, 26 references): rewritten for `wails3 task darwin:package` +
  `scripts/sign-bundle.sh`.
- **`docs/PERF.md`** (445 lines): §2.1 re-measured against the webkit tier and recorded pass or fail
  (P52 §11 — *not* gated); §3's manual procedures rewritten for the new bundle, including the
  cold-start read (the `WindowRuntimeReady` log line P56 §1.5 established is the measurement point);
  L-D's app-size row.
- **`AGENTS.md`**: a **"P57 implementation findings"** entry (§8, criterion 10); the **Electron
  binary (for `tests/e2e/`)** section deleted outright; the **`KIRA_INSECURE_SECRETS`** section
  rewritten (its subject moves from `src/main/secret-cipher.ts` to `internal/secrets`, and the
  behaviour is unchanged per P52 §6.5); the **Native Kafka driver** section rewritten (no
  `electron-rebuild`, no ABI matching — a plain `npm install` plus npm's install-script approval,
  P52 §10.1); the **`tests/ipc/`** section's `ELECTRON_RUN_AS_NODE` instructions re-pointed at the
  vendored node.
- **`docs/v1/SPEC.md`**: checked for this plan — there is **no P52 row**, let alone P53–P57. P52 §14
  owed one and it was not written. P57 adds rows for P52–P57 together, and updates P51's row from
  "plan only" to "superseded for implementation by P52".

## 5. Testing plan

The Go suite (`bun run test:go`) is unchanged by this phase except for §4.4's re-pointed channel
table. Everything below is the TS side.

### 5.1 What survives untouched, and why that is the load-bearing claim

- **`tests/db/`** entirely — the adapters are untouched and Bun + Testcontainers is unaffected by the
  shell change. Gains `kafka.spec.ts` (D17).
- **`tests/ipc/**/*.fixture.ts`** — byte-identical, which D15 exists to guarantee and §4.12 makes an
  acceptance condition.
- **`tests/ipc/**/*.backend.spec.ts`** (7 specs) — unmodified. The harness beneath them changes
  (§4.12); the specs do not.
- **`tests/unit/`'s nine renderer specs** — `scan`, `column-range`, `view-state`, `sql-text`,
  `sql-split`, `catalog-listing`, `anchored-position`, `run-state`, `metadata-cache` — modulo §5.3's
  stub swap.

### 5.2 The `data.ts`/`engine.ts` non-change, asserted

§1.1's claim is that the rewrite does not reach past `bridge/`. Rather than assert that in prose,
M2 ends with:

```
git diff --stat src/renderer/ -- ':!src/renderer/bridge' ':!src/renderer/env.d.ts'
```

returning empty. If it is not empty, either D1 was broken or `src/renderer` had a coupling this plan
did not find — and either way the implementer should stop and say so rather than absorb it.
`src/renderer/bridge/data.ts` is the one file inside `bridge/` whose diff should be **only** the
`plain()` removal (D4), which is small enough to eyeball.

### 5.3 `tests/unit/`

`tests/unit/support/window.ts` exists solely because `control.ts` reads `window.kira` at module
scope and `state/tabs.ts` calls `control.onFlushBeforeClose(...)` at *its* module scope, so an empty
stub throws on import (its own comment, `:4-7`). After the rewrite the failure mode is the same but
the subject moves: importing `control.ts` now evaluates `Events.On` from `/wails/runtime.js`, which
does not exist under Bun.

Replacement: a `mock.module`-based preload registering a fake `/wails/runtime.js` exporting `Events`
(with an `On` returning a no-op unsubscribe), `Call`, `JSONStream` and `Stream`. The module-registry
sharing hazard the current file's comment documents (*"Bun's module registry is shared across every
spec file in a single test run … two different inline stubs across two spec files raced"*) is
**identical** for module mocks, so the replacement stays a single shared module imported for its
side effect, exactly as today. That comment is the most valuable thing in the file and should be
carried across, re-pointed.

`tests/unit/menu.spec.ts` and `tests/unit/security.spec.ts` are deleted: their subjects are
`src/main/menu.ts`'s template and `src/main/security.ts`'s option object, both of which are now Go
with Go tests (`shell/internal/shell/menutemplate_test.go`, `security_test.go`, P56 §5.7). Deleting a
test whose subject moved is correct; the thing to check is that the Go test actually covers the same
assertion, which P56 §5.7's `TestPackagedBuildHasNoDevItems`/`TestDevBuildHasBothDevItems` rows
explicitly claim as "spec case 1 / spec case 2".

### 5.4 New unit coverage for the rewrite itself

The two rewritten files carry real logic (D5's unwrap, D3's ready-gating, the pending map), and none
of it needs a browser. Two new specs under `tests/unit/`:

`bridge-unwrap.spec.ts` (`control.ts`'s `unwrap`, exported for test or exercised through one mocked
binding):

| Test | Asserts |
|---|---|
| `structured cause is preferred` | An error with `cause = {code:'E_DISCONNECTED', message:'PG is not connected'}` and `message` = the JSON string yields `{message:'PG is not connected', code:'E_DISCONNECTED'}` — the §1.6 probe's exact values |
| `json message is the fallback` | `cause` absent, `message` = the JSON string → same result (the belt-and-braces branch) |
| `empty cause falls through` | `cause = {}` (the §1.6 probe's plain-`errors.New` case), `message = 'boom'` → `{message:'boom', code:'E_INTERNAL'}` — **not** `{code: undefined}` |
| `unparseable message` | `message = 'network gone'` → `{message:'network gone', code:'E_INTERNAL'}` |
| `every control method is wrapped` | Iterates the `control` object's own properties, drives each through a binding stub that rejects with a `cause`-bearing error, and asserts the surfaced error has a `code` — the guard against one call site being left unwrapped (§4.2 rule 1) |

`bridge-port.spec.ts` (`port.ts` against a fake socket, the same fake `tests/ui/support/mockStream.ts`
installs — shared, not duplicated):

| Test | Asserts |
|---|---|
| `request before open` | A `request()` issued while the socket is `CONNECTING` does not throw and is sent once `open` fires (D3's whole point; a synchronous `send` would throw `InvalidStateError`) |
| `response resolves by id` | Two concurrent requests resolve with their own payloads |
| `error frame carries code` | `{ok:false, error:{message, code}}` rejects with `.code` set — the data channel's own structured-error path, unchanged from today |
| `timeout` | `DEFAULT_TIMEOUT_MS` rejects; `timeoutMs: null` never does (D25) |
| `close rejects pending` | `close` rejects everything outstanding and later `request()`s reject immediately |
| `events fan out by topic` | `onPortEvent` delivers to every subscriber and the unsubscribe works |

The channel-constant parity check (`events.ts` against `shell/internal/bridge/events.go`) lives on
the Go side, where P56 §5.1's `TestChannelConstantsMatchIpcTs` already does it — M6 re-points its
reference file and renames it.

### 5.5 `tests/ipc/**/*.frontend.spec.ts` — the same specs, new mocks

The seven frontend specs' *bodies* should not change: they drive real UI and assert rendering. What
changes is the two `install*` calls in their setup, from `installControlMocks(app, ...)` /
`installMockPort(page, ...)` to the `tests/ui/support` equivalents (D13/D14), and the fixture that
launches them — `_electron.launch()` becomes a page on the static server.

One new test, in `tests/ui/support/`, guards the `CHANNEL_TO_FQN` table §4.10 introduces:

| Test | Asserts |
|---|---|
| `every mapped FQN exists` | Each value in `CHANNEL_TO_FQN` appears in the generated bindings' emitted `$Call.ByName("…")` literals — so a Go method rename that regenerates the bindings fails this table rather than silently missing every fixture at runtime |
| `every fixture channel is mapped` | Every distinct `channel` across the seven `*.fixture.ts` files has an entry |

This is the anti-drift replacement for the property `mockControl.ts` got for free by keying on the
real `ipcMain` channel string.

### 5.6 `tests/ui/` — the ported UI tier

Per D16: the pure-UI `tests/e2e/` specs (`workbench`, `tabs`, `tooltips`, `cell-editor`,
`autocomplete`, `tree`, `interaction`, `data-view`, `connections`, `console`, `definition`,
`mutations`, `smoke`, `preconnect`, `secrets`) port into this tier against the same mocks.
`budgets`/`perf`/`leaks` re-create here — they measure renderer work through renderer-owned
instrumentation (`__kiraGridScrollWorkStart`, `__kiraRetainedBytes`, `__kiraCacheStats`,
`__kiraCount`, all declared in `src/renderer/main.ts:21-58` and untouched by this phase), none of
which is Electron-specific.

**Honest accounting of what does not port**, restated here so it is in the test plan and not only in
§7: `hardening.spec.ts` and `startup.spec.ts` have no subject and no analogue; `sqlite`, `mongo` and
`s3` were kept at P50 specifically as the full-stack anchors and cannot be mock-backed without
becoming something else. `s3.spec.ts` is the sharpest loss (real dialogs, real
`DATA_OP.objectDownload`). §6 converts the two dialog paths into manual macOS checks, which is a
downgrade and is labelled as one.

### 5.7 The boot smoke test (C1's instrument)

There is no devtools or remote-debugging story in this sandbox (AGENTS.md, P52 findings), so the
practical instrument is the one every phase from P52 has used: start `wails3 task dev` under Xvfb
inside **one** Bash invocation, poll rather than sleep, `xdotool search --name` for the window id,
`import -window <id>` a PNG, and read it back. Reading the screenshot is what distinguishes "the app
rendered" from "blank page because JS threw before `mount()`" — and after this phase's bridge
rewrite, "JS threw at module scope" is a realistic failure (an unresolvable `/wails/runtime.js`
import, a binding name typo) whose only cheap symptom is a blank window.

C1's checklist, all in one run:

1. The window renders the real workbench (screenshot).
2. The status pill leaves `'connecting'` — AGENTS.md's P56 finding says it is currently stuck there
   forever and that this is expected until `port.ts` is rewired. It leaving `'connecting'` is the
   single clearest signal that D2/D3 worked.
3. A connect against a real adapter reaches `connected`.
4. Opening a table renders rows — i.e. a `DATA_OP.read` round-tripped the `engine` Stream, the
   1 MiB-class path P56 §5.4 proved Go-side and this proves renderer-side.
5. A menu item's channel reaches the renderer (Cmd+, opens Settings) — `Events.On` in real code
   rather than in the retired shim.
6. Quit acks inside 2 s (the log line, not the wall clock).

Steps 3–4 need a reachable database; a SQLite file connection needs none, which makes it the right
choice for this check.

## 6. The manual and macOS checks this phase owes

P52 §11 leaves two items open for P57 and P56 §6 left five macOS checks that only real hardware can
close. This phase adds four more. As with P55 §10 and P56 §6, the implementing session must record
each result **including "not available in this session"** rather than leaving it implied.

| Check | Why it cannot be closed from Linux | What "pass" looks like |
|---|---|---|
| **`docs/PERF.md` §2.1 interaction budgets under WKWebView** (P52 §11) | The 8 ms p50 scroll budget was measured on Chromium; WebKitGTK is not WKWebView | A recorded number in §2.1, pass or fail — not gated (P52 §11) |
| **Cold start** (P52 §11) | Never measured for a Wails build | A number in §3, read from the `WindowRuntimeReady` log line (P56 §1.5) |
| **`sign-bundle.sh`'s nested paths** (§4.13) | The resource layout is whatever `create:app:bundle` produces on darwin | All four `codesign` lines succeed and `--verify --deep --strict` exits 0 |
| **`verify-packaging.sh`'s A3–A6 + N1/N2 against a real bundle** | Every one reads `dist/`/the `.app` | The script exits 0 on a freshly packaged bundle |
| **The save/open dialogs** (the coverage `s3.spec.ts` took with it, D16 — the AppKit panel itself, not the download; `P57-e2e-revisit.md` §3.6 automates the rest by faking just `FilesService.ChooseSave`, exactly as the old Electron test already stubbed it) | Wails' dialogs are AppKit and need a user | An S3 object downloads to a chosen path; a SQLite file opens through the picker, including the "All files" row P56 D8 translates to *no* filter |
| **`navigator.clipboard` under WKWebView** (P52 §9, P56 §6) | `Permissions` has no darwin implementation at all (P56 §1.6) | Grid copy and paste both work in the packaged build |
| P56 §6's remaining four (Cmd+Q, Dock reopen, bounds persistence, DevTools absent in a packaged build) | Carried forward if P56's session could not run them | As P56 §6 states |

## 7. Scope boundary, and what is genuinely lost

**`src/` changes, enumerated** (this is the first phase with any, so the boundary is a list rather
than a "zero"): `src/renderer/bridge/{control,port,data}.ts`, `src/renderer/env.d.ts`,
`src/shared/protocol/ipc.ts` → `events.ts`, and the deletion of `src/main/`, `src/preload/` and
`src/engine/index.ts`. **Nothing else under `src/renderer/` and nothing else under `src/engine/`**
— §5.2 checks this rather than asserting it.

**What gets worse.** P52 §11 enumerated this for the migration; the items that actually come due
here, with what this plan changes about them:

1. **The full-stack tier is reduced, not gone.** Three anchors retire (D16), but two of their
   *wiring* value is recovered by `tests/e2e-real/` (D16's amendment, `P57-e2e-revisit.md`) — 23
   specs down to 2-3, with native-shell coverage (menus, dialogs, lifecycle, WKWebView rendering)
   genuinely gone and wire-level coverage (real bridge, real engine, real adapter) genuinely kept.
   `s3.spec.ts`'s AppKit save/open panel itself stays a manual check (§6) — a real downgrade from an
   automated assertion to a human remembering — but its `objectDownload` file-write contract either
   gets a `tests/db/s3.spec.ts` case or an `e2e-real` spec of its own (`P57-e2e-revisit.md` §7/§6).
2. **`hardening.spec.ts` loses its subject entirely**, and P56 §1.6 established that more of the
   posture is inert than P52 §9 assumed (`Permissions` has no darwin implementation; there is no
   navigation-policy delegate at all). What replaces it is `security_test.go`, which asserts what
   the *options* say, not what the webview *does*. That is a weaker guarantee and should be
   described as one in ARCHITECTURE.md.
3. **`startup.spec.ts`'s measurement point is gone**; cold start becomes a manual procedure.
4. **The frontend tier gains a hand-written coupling** — `CHANNEL_TO_FQN` (§4.10) — where
   `mockControl.ts` had none, because `ipcMain`'s channel string *was* the key. §5.5's two tests are
   the mitigation, not an elimination.
5. **The `tests/ipc` backend tier's tree half becomes a test-local stand-in** (D15). Honest, tested
   in Go, and clearly labelled — but it is no longer the same object the app runs.

**What gets better**, and is worth recording because most of it lands in this phase specifically:

1. The engine status pill works for the first time since P56 — the migration's most visible
   loose end.
2. `plain()`'s two redundant full-payload copies leave the hot path (D4).
3. Control-plane errors gain a structured `code` end to end (D5), which the control channel never
   had under Electron — `[E_QUERY] ` prefixes stop appearing in user-facing text.
4. `tests/ipc` stops needing Electron at all (§4.11); the Kafka spec stops needing an ABI-matched
   runtime (D17).
5. One Vite config, one build, one packaging path (D10) — the coexistence machinery retires whole.

## 8. Acceptance criteria

1. **C1 is recorded** (§0.3, §5.7) — all six items, with the screenshot, **before** any deletion
   milestone started. The commit message or AGENTS.md entry says so explicitly.
2. `bun run lint`, `bun run typecheck` (all four projects), `bun run test:unit`, `bun run test:go`
   are green.
3. `bun run test:ipc:be` is green under the vendored Node, and **`git diff --stat tests/ipc` shows
   no change to any `*.fixture.ts`** (D15/§4.12) — where Docker is available; where it is not, that
   is stated rather than implied.
4. `bun run test:ipc:fe` and `bun run test:ui` are green under the webkit tier.
5. `grep -rn "electron" src/ tests/ scripts/ package.json *.ts *.yml` returns **nothing** except
   historical references inside comments and docs. Same for `window.kira`, `contextBridge`,
   `ipcRenderer`, `MessagePort`, `kira:port` and `kira:engine:state`.
6. `git diff --stat src/renderer/ -- ':!src/renderer/bridge' ':!src/renderer/env.d.ts'` is empty
   (§5.2).
7. `bun run build && bun run build:engine && bun run package` produces a signed bundle;
   `bun run verify:packaging` exits 0 against it (macOS only — otherwise recorded as unavailable).
8. The bundle's `CFBundleIdentifier` is `com.kirathecat.kira-studio` and
   `grep -rn "kira-studio-shell" shell/` returns nothing (D11); `grep -rn "Kira Studio Safe Storage"
   shell/internal/secrets` still returns a hit (D12).
9. Both CI workflows are updated and reference no deleted script (§4.14). A dry read of each file
   end to end, not a patch from §4.14's table.
10. `AGENTS.md` gains a **"P57 implementation findings"** entry on the P52–P56 pattern. Six things
    are already worth writing down before implementation starts, and should be confirmed or
    corrected there:
    - **`WailsSocket.send()` throws on a `CONNECTING` socket and silently drops on a closed one**
      (`stream.ts:275-281`) — the trap D3 exists for, and a silent-drop failure mode is exactly the
      kind that costs an afternoon.
    - **A bound method's error reaches the renderer twice**: as structured `{code, message}` in
      `err.cause`, and as that same JSON *as a string* in `err.message`. Displaying `err.message`
      unwrapped shows the user raw JSON.
    - **A non-`ipcerr` Go error marshals to `{}`, not `undefined`** — test for a `code` string, not
      for `cause`'s presence.
    - **`JSONStream` is `Stream` + `JSON.stringify`/`JSON.parse` with no extra hop** — P52 §7.2's
      reason for preferring `Stream()` does not hold against the source.
    - **`window._wails.streamFactory` is a supported stream-injection seam** (`stream.ts:447-452`),
      and `page.route('**/wails/runtime')` plus `-names` bindings is the control-plane equivalent.
    - **The generated bindings' `/wails/runtime.js` import is invisible to `tsc` until a file inside
      a tsconfig's `include` imports them** — the failure appears the moment `control.ts` does, and
      looks like a Vite problem.
11. `docs/` and `AGENTS.md` are updated per §4.15, including the **`docs/v1/SPEC.md` rows for
    P52–P57**, which P52 §14 owed for P52 and which were never written.

## 9. Sequencing

Nine milestones. **M0–M4 are reversible and end at C1; M5–M8 are the cutover proper.** The single
hard ordering rule is §0.3's: nothing in M5+ starts until C1 is recorded. Within that, M0 must come
first (everything after it imports the bindings) and M8 last.

- **M0 — bindings, types, and the build seam.** Regenerate with `wails3 generate bindings -b -i -ts
  -names` (D13) using the **pinned** CLI. Add `@wailsio/runtime@3.0.0-beta.15` as a devDependency
  and the `tsconfig.web.json` `paths` mapping plus the `@bindings/*` alias in both the Vite config
  and the tsconfig (D8, §4.2). Ends when a throwaway file under `src/renderer/` can
  `import * as AppService from '@bindings/.../appservice'` and `bun run typecheck:web` passes. This
  milestone exists purely to hit §1.8's trap deliberately, in isolation, before it can be confused
  with a bridge bug.
- **M1 — `port.ts`.** The transport swap (§4.1), plus `bridge-port.spec.ts` (§5.4) and the shared
  fake socket. Wails-side only; `control.ts` still reads `window.kira`, so the app still boots on
  the shim and the *data* plane can be smoke-tested on its own. First because it is the half that
  clears AGENTS.md's stuck-pill finding, and because a working data plane makes M2's failures
  unambiguous.
- **M2 — `control.ts` and `events.ts`.** The bindings rewrite, `unwrap` (D5), `Events.On`, the
  `plain()` removals in both files (D4), `env.d.ts`, `events.ts`, `ipc.ts`'s reduction (D7). Ends
  with `bridge-unwrap.spec.ts` green and §5.2's `git diff --stat` empty.
- **M3 — retire the shim.** Delete `shell/frontend/shim/kira-bridge.ts`, `injectKiraShim` and the
  `shim` rollup input (D9). This is deliberately its own milestone: it is the moment the Wails build
  stops having a fallback `window.kira`, so if M2 missed a method the failure appears here, cleanly,
  rather than mixed into a deletion diff.
- **M4 — C1.** §5.7's six-item boot check under Xvfb, screenshot included. **The Electron app is
  still whole and buildable at this point** — verify that too (`bun run build`), because "both
  builds work" is the property that makes M5 safe and it is cheap to confirm.
- **M5 — the test tier.** `tests/ui/support/{server,mockRuntime,mockStream}.ts` (§4.10), the seven
  frontend specs re-pointed, the `tests/e2e/` ports and deletions (D16), `playwright.config.ts`
  (§4.9), `tests/ipc/support/harness.ts`'s cache-aside (D15/§4.12), `run-ipc-backend.sh` (§4.11),
  `tests/unit`'s stub swap and two deletions (§5.3), `tests/electron-db` → `tests/db` (D17). Ends
  with every suite green **while `src/main` still exists** — which is what proves the harness change
  is complete rather than merely compiling.
- **M6 — the deletions.** `src/main/`, `src/preload/`, `src/engine/index.ts`, after the §4.6
  precondition grep comes back clean. Re-point P56's `TestChannelConstantsMatchIpcTs` at
  `events.ts` and rename it (§4.4) — easy to forget, and it fails loudly, which is the good case.
- **M7 — Electron out of the build.** `package.json` (§4.7), `electron.vite.config.ts` and
  `electron-builder.yml` deleted, `vite.wails.config.ts` → `vite.config.ts` (D10), the tsconfigs,
  `scripts/native-electron-build.sh` deleted, `scripts/sign-bundle.sh` written and
  `verify-packaging.sh` rewritten (§4.13), the bundle identity (D11/§4.8), both CI workflows
  (§4.14). Ends with a packaged, signed bundle passing `verify:packaging` — on macOS, or recorded as
  unavailable.
- **M8 — documentation.** §4.15 in full, including the SPEC rows and the AGENTS findings entry
  (§8 criterion 10). Last, so it describes what actually landed rather than what was planned.

M5 before M6 is the second hard rule after C1: the test tier must be proven against a tree that
still has both implementations, so a green suite means "the new mocks work" rather than "the old
tests are gone".

## 10. Environment notes for the implementing session

- **A fresh container has none of the toolchain** (AGENTS.md, P52 findings). Go, plus
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` for anything that builds
  `internal/shell` or the root `main` package (P56's finding, which retired P53's
  "`./internal/...` needs nothing but the toolchain").
- **Install `wails3` pinned**: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.15`,
  `export PATH=$PATH:$(go env GOPATH)/bin`. AGENTS.md's P55 finding: `@latest` resolved to beta.16
  and skewed the generator against the runtime. In the session that wrote this plan, `wails3
  version` already reported `v3.0.0-beta.15` and **both** beta.15 and beta.16 were present in the
  module cache — so a stale `@latest` install is a live hazard here, not a hypothetical.
- **The `-names` flag changes every generated file** (D13). Regenerating is not optional after that
  decision, and `shell/frontend/bindings` is git-ignored (`shell/.gitignore:4`), so a fresh
  container has no bindings at all until `wails3 generate bindings` runs — and `bun run build` fails
  with an unresolvable-import error, not a stale-bindings warning (AGENTS.md, P53 findings).
- **`shell/runtime/` is git-ignored and must be populated**: `scripts/vendor-node.sh` for
  `runtime/node/bin/node`, `bun run build:engine` for `runtime/engine/engine.cjs`. After P56 D12 the
  app refuses to start without the engine bundle, and after §4.11 the backend test tier refuses to
  run without the node binary.
- **The Wails source is in the module cache** at
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/`, and the **JS runtime
  source** — the thing this phase actually needs — is at
  `internal/runtime/desktop/@wailsio/runtime/src/*.ts` within it. `@wailsio/runtime` is not in
  `node_modules` (checked), and the module cache's copy has no `dist/` or `types/`, so D8's npm
  install is what makes the types readable to `tsc`; the `src/*.ts` files are what make them
  readable to a human.
- **A background process started in one shell invocation cannot be signalled from a later one**
  (AGENTS.md, P51) — start, poll, screenshot and tear down a `wails3 task dev` run inside a single
  Bash invocation with a 120–150 s timeout, since the first build takes ~60 s.
- **Screenshotting the headless WebKitGTK window** (`xdotool search --name`, `import -window <id>`)
  is the only way to tell a rendered app from a blank page in this sandbox, and after M1–M3 a blank
  page is the expected symptom of a module-scope throw. Do not skip it at C1.
- **The Electron app must stay buildable through M4.** `bun run build` is the check; it is cheap and
  it is the difference between a recoverable and an expensive failure at C1.

## 11. Implementation status (as of this session)

M0–M4 are done, committed, and pushed to `wails-native-shell-spike` — C1's six-item boot proof
passed and is recorded (P57 M4 commit). M5 is in progress; this section is the honest state of it,
to resume from rather than re-derive.

### M5 — done

- **D13/D14 — `tests/ui/support/{mockRuntime,mockStream}.ts`.** The mock-backed UI tier's whole
  mechanism, replacing `tests/ipc/support/{mockControl,mockPort}.ts`'s Electron-side approach.
  `mockRuntime.ts` intercepts `/wails/` at the network layer (`page.route`): the real Wails runtime
  bundle itself (read from the pinned Go module's
  `internal/assetserver/bundledassets/runtime.js` — **not** the unbundled `@wailsio/runtime` npm
  package, which collides on the `/wails/runtime.js` URL between the app's own aggregate import and
  `calls.js`'s internal relative import of the same name — a real dead end this session hit and
  documented in the file's own comment) and the one `Call` RPC endpoint, answered from
  `ControlSnapshot` fixtures via a `CHANNEL_TO_FQN` table built off the generated bindings' own
  `$Call.ByName(...)` literals. `mockStream.ts` installs `window._wails.streamFactory` (D14),
  injected as a raw string rather than a typed function — every esbuild-based TS loader this repo's
  tooling runs under (tsx, Playwright's own transform) emits `keepNames()` helper calls that don't
  survive `Function.prototype.toString()`, so the browser-side logic lives in a plain, uncompiled
  `mockStreamBrowser.js` instead, read as text. Both needed a `WILDCARD_DEFAULTS` table for calls
  the pre-P57 mock let fall through to a real (temporary, empty) backend rather than intercepting:
  `filtersList`, `tabsSave`, `layoutSet`/`settingsSet`, `opsCancel`/`queriesHistoryRecord`,
  `treeDescribe`, `queriesList`/`queriesListConsole`/`queriesHistoryList`. `canonical()` also
  normalizes a missing `refresh` key the same as `refresh: false`, and tree channels fall back from
  an uncaptured `refresh:true` snapshot to the matching `refresh:false` one. Proven against real
  Chromium across 27 repeated runs with zero flakes (this sandbox has no WebKit binary and cannot
  reach the download host — `playwright.config.ts`'s own `ui` project still specifies
  `browserName: 'webkit'`, correct for a real target; verification here used
  `--browser=chromium`/an explicit `executablePath` override).
- **`tests/ui/fixtures.ts`, `support/{server,bootSnapshots,tree,dialogs}.ts`.** The tier's harness:
  `relaunch()` opens a fresh page against `server.ts`'s static build server and installs both mocks
  before the one navigation, merging each spec's own control snapshots over
  `EMPTY_BOOT_SNAPSHOTS` (the five-call boot sequence every fresh app fires). `tree.ts`/`dialogs.ts`
  ported byte-identically from `tests/e2e/support/` (nothing in them was Electron-specific).
- **All seven `tests/ipc/**/*.frontend.spec.ts` re-pointed** onto the new mocks — unchanged
  assertions, passing reliably. `redis.frontend.spec.ts`'s row-count read became
  `expect.poll`-based (a real timing gap: `data-level` and the row list update off two separate
  reactive triggers, a gap real Electron IPC latency always outlasted but this tier's faster HTTP
  mock sometimes doesn't).
- **D17 — `tests/electron-db/kafka.spec.ts` → `tests/db/kafka.spec.ts`**, running under the vendored
  Node with no Electron-ABI rebuild step (verified: the `bun install`-built native addon loads
  as-is). Folded into new `scripts/run-db-tests.sh`.
- **§5.3 — `tests/unit`'s stub swap.** `window.ts`'s dead `window.kira` Proxy removed (`control.ts`
  no longer reads it at all post-M2); `menu.spec.ts`/`security.spec.ts` deleted (Go coverage already
  landed in P56).
- **D15 re-verified**: all seven `tests/ipc/**/*.fixture.ts` confirmed byte-identical after a real
  `KIRA_IPC_FIXTURES=write` run against Docker, for all seven adapters — once run through
  `bun run format` (a pre-existing gap in that checklist item this run surfaced but did not
  introduce: `capture.ts`'s raw `JSON.stringify` output was never biome-formatted by the write
  path).
- **`tests/ui/smoke.spec.ts`** (full port) and **`tests/ui/workbench.spec.ts`** (2 of 7 scenarios;
  see the finding below) — the first two `tests/e2e/` ports, proving the mechanism end to end.

Commits: `a6b6e89` (D15/harness), `026cf68` (the mocks + 7 re-pointed specs + D17 + §5.3),
`8c32bcb` (workbench.spec.ts). All pushed to `wails-native-shell-spike`.

### A finding that changes the remaining M5 estimate

§9's M5 bullet and §5.6 list `workbench`, `tabs`, `tooltips`, `cell-editor`, `autocomplete`, `tree`,
`interaction`, `data-view`, `connections`, `console`, `definition`, `mutations`, `preconnect`,
`secrets` as pure-UI specs that "port into this tier against the same mocks" (§5.6's own words).
Reading them individually (not just their names) shows most of that is optimistic:

- **`workbench.spec.ts`**: 5 of 7 scenarios assert real persistence across a `relaunch()` (panel
  visibility, two settings-dialog sections, word wrap, a narrowed-patch write) — a real write
  surviving a real process restart via `src/main`'s own storage. `tests/ui/`'s `relaunch()` has no
  backing store at all (fresh mocks every call, by design), so these have no equivalent here, and
  are not covered by `tests/e2e/sqlite.spec.ts` either (D16 keeps that file's assertions
  unchanged). **Only 2 of 7 scenarios ported**; the other 5 are a real, acknowledged coverage loss,
  flagged in `tests/ui/workbench.spec.ts`'s own header comment.
- **`tabs.spec.ts`, `tooltips.spec.ts`** (read in full) and, by grep, **`autocomplete`,
  `cell-editor`, `console`, `data-view`, `definition`, `interaction`, `mutations`, `preconnect`,
  `tree`, `budgets`, `leaks`, `perf`** all call `startPostgres()`/`isDockerAvailable()` and drive a
  **real Postgres container** through the pre-P57 `window.kira` global (which no longer exists —
  `src/preload` is still present today, since M6 hasn't run, but `control.ts` stopped reading it in
  M2). Porting these is not a mechanical re-point the way the ipc frontend specs were: it means
  designing realistic `ControlSnapshot`/`PortSnapshot` fixture data (tree shape, table contents)
  standing in for whatever each spec's real Postgres schema currently provides, replacing every
  `window.kira.connectionsCreate(...)`-against-a-real-container call, and — same as
  `workbench.spec.ts` — dropping or separately flagging any scenario that specifically asserts
  persistence-across-relaunch (`tabs.spec.ts`'s session-restore scenario is one such case, found
  while reading it). A shared fixture module (one realistic "postgres-like" tree +
  table data set, reused across specs) is very likely the efficient way to do this rather than
  inventing fixture data per file — not yet started.
- **`connections.spec.ts` — read in full (resuming session).** No real adapter needed, confirmed:
  every call is `connectionsCreate`/`Update`/`Duplicate`/`Delete`/`List`/`Reveal` against the local
  store, never `connectionsTest`/`Connect`. The dialog/CRUD/color/duplicate/delete narrative is a
  spec-level fixture, not a shared one — `mockRuntime.ts`'s per-(channel, canonical-args) cursor
  replay already supports the sequence (each `connectionsCreate` call has distinct args, so it
  keys naturally; repeated `connectionsList()` calls need an ordered snapshot sequence reflecting
  each mutation, which is exactly what the cursor was built for). **Two scenarios do not port**:
  the "create, wait, `relaunch()`, still there" and "recolor, wait, `relaunch()`, still cyan"
  checks (lines ~75–77 and ~148–153 of the original) assert real cross-process persistence, which
  `tests/ui/fixtures.ts`'s own header comment already rules out ("there is nothing to persist to")
  — same category as `workbench.spec.ts`'s 5 dropped scenarios. Everything else ports.
- **`secrets.spec.ts` — read in full.** Unlike `connections.spec.ts`, this is not a "pure UI" spec
  once read past its own file-header comment: scenarios 2–4 (7 of the file's 9 substantive checks)
  read the raw on-disk SQLite file directly (`storedPassword`/`noFileContains`, the app's own
  `kira.sqlite`) and assert real encrypt-at-rest, plaintext-upgrade-on-relaunch, and
  idempotent-re-encryption behavior across 2–3 real `relaunch()`s each. None of that has a mock-tier
  equivalent for the same reason `connections.spec.ts`'s two dropped scenarios don't — there is no
  disk and no second process. That guarantee is now covered natively and more directly at the
  layer that actually implements it: `shell/internal/storage/repos/secrets_test.go` exercises a
  real AES-256-GCM round trip against the repo (`TestSecretsSetGetRoundTrip`,
  `TestSecretsGetPropagatesDecryptError`, `TestSecretsCopyIsByteForByteAndTouchesNoCipher`), and
  `shell/internal/connections/service_test.go`'s `TestPasswordThreeStateConvention` covers the
  create/update/reveal three-state convention scenario 2's UI half also exercises. **Also found in
  passing**: the real envelope prefix is `kira:v2:` (`shell/internal/secrets/cipher.go`), not the
  `kira:v1:` scenario 2–4 assert on — a deliberate, already-decided P52 §6.4 break from Chromium
  `safeStorage`'s v1 envelope, not a bug this phase introduces or should paper over by rewriting the
  E2E assertion to match. Scenario 4's "pre-P25 plaintext row upgraded on next launch" premise is
  the sharpest casualty: a `kira:v1:`-prefixed row from a real pre-migration user database now hits
  `cipher.go`'s "not in this app's kira:v2: envelope format" error path instead of being silently
  upgraded — genuinely lost behavior, not a test-porting artifact, and worth a line in P57's own
  §7/M8 documentation rather than being silently absorbed here.
  **What does port**: `connectionsSecretsStatus()`'s three backend shapes
  (`keychain`/`basic_text`/`unavailable`) and `ConnectionDialog.vue`'s `connection-credential-note`
  rendering for each are pure UI, and porting them via canned mock responses is *less* platform-gated
  than the original — the original branches on `process.platform` and only ever exercises the one
  status shape the host OS actually produces (P52 D16), so this sandbox has only ever run the Linux
  branch; a mock-backed version exercises all three unconditionally, in one spec, on any OS. Scenario
  5's failed-save-with-password / succeeded-save-without-password UI behavior (dialog stays open,
  `connection-save-error` shown, no record created vs. record created) also ports on canned
  `connectionsCreate` responses — minus its own two `storedPassword`/`noFileContains` disk
  assertions, which stay a Go-side guarantee. **Net**: a new `tests/ui/secrets.spec.ts` covering only
  the status-shape/credential-note/failed-save UI surface; the on-disk encryption narrative is
  dropped from the E2E tier and is not re-created — it is already covered, more precisely, in Go.
- **`sqlite.spec.ts`, `mongo.spec.ts`, `s3.spec.ts`** are explicitly kept as the three full-stack
  anchors per D16/D10 and are **not** meant to port — no work needed there beyond the header-comment
  addition D16 already calls for.
- **`hardening.spec.ts`, `startup.spec.ts`** have no analogue and are dropped outright per §7 — no
  work needed.

None of this blocks M5's own stated ending condition ("every suite green while `src/main` still
exists") from being reachable — it changes the estimate and the *shape* of the remaining work, from
"re-point N files" to "design shared fixtures, then port or explicitly drop each remaining file's
scenarios one at a time," and it is worth a second look at whether every one of these specs is worth
porting at this fidelity versus consolidating overlapping coverage.

### M5 — not started

- Read `connections.spec.ts` and `secrets.spec.ts` in full to confirm whether they need the
  shared-postgres-fixture treatment or something lighter.
- Design the shared mock fixture data (tree shape + table contents) for the Postgres-backed specs,
  if porting them is still the chosen path after the above.
- Port or explicitly drop, one file at a time: `tabs`, `tooltips`, `autocomplete`, `cell-editor`,
  `console`, `data-view`, `definition`, `interaction`, `mutations`, `preconnect`, `tree`.
  `budgets`/`perf`/`leaks` "re-create" per §5.6 (renderer-owned instrumentation hooks, not
  Electron-specific) rather than port verbatim.
  - **`connections` and `secrets` — done, in a resumed session.** `connections.spec.ts` ported
    almost whole (CRUD/colors/URI-mode/duplicate/delete against a spec-level fixture); its two
    relaunch-persistence checks dropped, and the retired-colour scenario reshaped into a boot-time
    seed rather than a raw `window.kira` injection (see below — `window.kira` no longer exists).
    `secrets.spec.ts` ported only its pure-UI slice (the three `connectionsSecretsStatus` shapes'
    credential-note rendering, plus the failed/succeeded-save behavior when unavailable) — its
    other 7 checks were genuinely storage-layer, not UI, and are covered instead by
    `shell/internal/storage/repos/secrets_test.go` and `connections/service_test.go`. Two real
    environment findings surfaced getting these green, both now in `AGENTS.md`: **WebKit is
    actually installable here** (`bunx playwright install webkit` + a few `apt-get` packages)
    correcting this document's own §5.6/M5-done claim that it isn't — every remaining `tests/ui/`
    spec should be verified against real WebKit, not a Chromium override; and **`window.kira` is
    gone** once M2/M3 have run, so any remaining `tests/e2e/` spec's raw `window.kira.*` calls need
    driving through real UI instead, or dropping if they only re-verify the mock's own fixture.
    `mockRuntime.ts`/`ControlSnapshot` also gained an optional `error` field for simulating a
    genuine backend rejection (distinct from `E_FIXTURE_MISS`), and a real, permanent finding: every
    handled bound-call error is a genuine HTTP 422 under Wails, which Chromium/WebKit's devtools log
    as console noise regardless of whether the app's own JS handles it — a `consoleErrors` assertion
    ported from `tests/e2e/` needs adjusting for that one expected line, not asserting zero.
- `playwright.config.ts`'s `e2e` project stays alongside `ui` until every portable spec has ported
  and every dropped one is accounted for — then it (and `tests/e2e/` itself, minus the three
  full-stack anchors) goes away, per §4.9/D16.
- `tests/unit/security.spec.ts` is already deleted (done above); double-check no other §5.3 item was
  missed.
- M6 (delete `src/main`, `src/preload`, `src/engine/index.ts`), M7 (Electron out of the build), M8
  (documentation) are entirely unstarted, and M5 must finish first (§9's second hard rule: "M5
  before M6 … a green suite means the new mocks work, not that the old tests are gone").
