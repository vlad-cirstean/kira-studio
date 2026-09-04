# P2 — HTTP request/response core

> **What this phase is.** The first phase of v1.2 with real user-facing HTTP functionality
> (`docs/v1.2/SPEC.md`'s P2 row): a **request builder** (method, URL, query params, headers, JSON
> body), **real requests sent by Go** — never the webview's own `fetch` — a **response viewer**
> (status, headers, body) with JSON syntax highlighting and a beautify action, and **status-code
> hint text beside the response status**.
>
> **What does not land here.** Postman's full body-mode set (P3), collections and their storage or
> Postman-format import/export (P4), curl parse/generate (P5), response history (P6), the raw
> byte-level inspector and raw editor (P7), the DNS/connect/TLS/TTFB timeline (P8, so P2 reports
> exactly one elapsed-ms figure), gRPC (P9). Nothing here is half-built toward those
> (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from `P1-shared-ui-shell.md`'s
> prose.** Base: branch `claude/feature-v1-2` at `94521a5`. File:line citations point at that
> content.
>
> **The one-sentence design.** One new tab kind slots into P1's registries, one new bound service
> hands a single request to a dependency-free `net/http` client behind the op scheduler the DB
> adapters already use — so the response viewer's ring, elapsed time, Stop button and Operations-panel
> row all work with no second scheduler, no second cancel path, no migration, and no new dependency.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `packages/shared/domain/http.ts` | **new** — method/header/tab-state Zod schemas, the wire types, the status-hint table |
| `packages/shared/domain/tabs.ts` | `'http-request'` joins `tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE`, `tabRecordSchema` |
| `packages/shared/domain/ops.ts` | `'http'` joins `opKindSchema` |
| `apps/kira-studio/internal/httpclient/` | **new** — `client.go`, `errors.go`, `client_test.go`: the whole outbound HTTP path |
| `apps/kira-studio/internal/bridge/http.go` | **new** — the `HttpService` bound service |
| `apps/kira-studio/internal/storage/model/tabs.go` | `RenderableTabKinds` gains one entry |
| `apps/kira-studio/internal/storage/model/ops.go` | `opKinds` gains one entry |
| `apps/kira-studio/main.go` | one more `application.NewService(...)` row |
| `apps/kira-studio/frontend/src/bridge/control.ts` | `httpSend` |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | the `'http-request'` registry entry |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `openHttpRequestTab()`; `openTab`'s `connectionId` widens to `string \| null` |
| `apps/kira-studio/frontend/src/workbench/tabViews.ts` | the `'http-request'` view entry |
| `apps/kira-studio/frontend/src/views/httprequest/` | **new** — `HttpRequestView.vue`, `state.ts`, `url.ts`, `RequestHeadersTable.vue`, `QueryParamsTable.vue`, `ResponsePane.vue` |
| `apps/kira-studio/frontend/src/http/{HttpStart,CollectionsPanel}.vue` | a **New request** action each |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | a `New request` palette entry |
| `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue` | registry-driven tab title; a non-SQL op's command is not highlighted as SQL |
| `apps/kira-studio/frontend/src/theme/primitives/ViewChrome.vue` | no connection dot for a connectionless tab |
| `apps/kira-studio/tests/ui/support/{ipcChannels,mockRuntime}.ts` | one channel, one FQN |
| `apps/kira-studio/tests/ui/http-request.spec.ts` | **new** |
| `apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts` | **new** — closes P1 §8 OQ-6 |
| `docs/ARCHITECTURE.md` | the outbound-HTTP path, the op-log widening, the new tab kind |

### 0.2 Out of scope, explicitly

- **P3–P9's own rows**, listed in the header blockquote above. In particular the request body has
  exactly two modes in P2, `none` and `json` (§4 D6), and the response reports one `elapsedMs`
  number and no phase breakdown (§4 D5).
- **A cookie jar.** `net/http`'s `Client.Jar` stays nil, so a `Set-Cookie` is shown and never
  replayed. A jar is per-collection/per-environment state and has nowhere to live before P4.
- **Any auth tab.** No Basic/Bearer/OAuth helper UI. A user types `Authorization:` by hand in P2;
  §8 OQ-5 hands the question forward.
- **Any per-request "disable TLS verification" toggle** (§4 D4, §8 OQ-4).
- **Any new dependency**, TypeScript or Go (§4 D1).
- **Any migration.** §2 F9/F10 establish why none is needed rather than deferring one.
- **Any menu change.** No File → New Request item, no mode-switch accelerator; §8 OQ-7 carries
  P1's own OQ-3 forward with one more entry.

### 0.3 Ground rules

- **Studio's rendered output does not change.** C4 is the one commit that touches shared Studio
  chrome, and it is a pure correctness refactor guarded by the existing suite.
- **`http/**` may not import `project/**` or `views/**`** (`biome.json:124-147`, P1 D7). §4 D7
  decides where each new file goes *from that rule*, not from taste.
- **Go owns the network.** `docs/ARCHITECTURE.md:82-88` — *"The renderer loads no remote content …
  under Wails only the second half still holds — the renderer contains no such call, but there is
  no navigation policy left to stop one"*. §4 D3 is that invariant applied, not a preference.

---

## 1. What the code does today

### 1.1 Http mode is two empty states and nothing else

`http/HttpStart.vue:11-13` is a bare `EmptyState` labelled *"Http mode arrives in a later phase"*
behind `data-testid="http-start"`; `http/CollectionsPanel.vue:12-19` mounts `LeftPanel` with
`empty` hardcoded true, titled *"Collections"*, with an `EmptyState` reading *"Collections arrive in
a later phase"*. Neither has an action of any kind. `workbench/modes.ts:20-23` is the whole mode
registry: `http: { label: 'Http', icon: 'globe', panel: CollectionsPanel, start: HttpStart }`.

There are **zero** Http tab kinds: `tabKindSchema` (`packages/shared/domain/tabs.ts:6-14`) and
`TAB_KIND_MODE` (`:36-44`) both list the same seven Studio kinds, so `tabsForMode('http')`
(`state/mode.ts:17-19`) is permanently empty and `TabStrip.vue`'s `tabs` computed (`:97`) renders
the empty strip.

### 1.2 What P1 left ready for a new kind

`state/tabKinds.ts:46-60` declares `TabKindDef<K>` with eight members — `mode`, `title(tab)`,
`icon(tab)`, `railColor(tab)`, `defaultState()`, `duplicateState(tab)`, `dropResources(tabId)`,
`menuExtras(tab)` — and `TAB_KINDS` (`:92-171`) is typed `{ [K in TabKind]: TabKindDef<K> }`, a
**total** map. `workbench/tabViews.ts:15-23` is the component half, `Record<TabKind, Component>`,
also total, statically imported. `TabStrip.vue` reads all three of icon/title/rail through the
registry (`:25`, `:29`, `:33`) and appends `menuExtras` to six generic items (`:92`);
`MainView.vue:13-14` is one `<component :is="TAB_VIEWS[activeTab.kind]">` plus the mode's start
fallback. **Adding a kind is two registry entries and a view component**, exactly as
`docs/ARCHITECTURE.md:594-596` claims.

### 1.3 The bound-service (control-plane) path

Fourteen services are registered in `main.go:190-204`, each a plain struct embedding
`appcore.Deps` (or carrying its own narrow interface field, `bridge/files.go:53-55`,
`bridge/ops.go:22-27`). A method is `func (s *XService) M(args XArgs) (XResult, error)` and its
error is an `*ipcerr.Error` whose `Error()` is the JSON `{"code","message"}`
(`bridge/ipcerr/errors.go`) that `control.ts`'s `unwrap` (`:52-79`) turns back into
`err.code`/`err.message`. `control.ts` calls the generated binding and `trust<T>()`s the result
(`:88-93`) rather than re-validating a shape Go produced.

Bindings are generated per Go package: `TreeService.Children` returns `tree.ChildrenResult` and the
generated `treeservice.ts:10` imports `tree$0 from "../tree/models.js"` — **a non-`bridge` package's
types get their own generated models module**, so a new `internal/httpclient` can own the wire
structs directly.

`tests/ui` mocks this plane by FQN: `mockRuntime.ts:39-83`'s `FQN_SUFFIX_BY_IPC_KEY` maps a legacy
channel string (`support/ipcChannels.ts`) onto `<bridge pkg>.<Service>.<Method>`, and
`CHANNEL_TO_FQN` (`:91-98`) is what `page.route('**/wails/runtime')` keys on.

### 1.4 The op scheduler, the op log, and the Stop button

`adapterhost.Host.RunOp` (`internal/adapterhost/host.go:123-194`) is the whole scheduler: mint-or-accept
an op id, refuse a duplicate, derive a cancellable context and register it, gate on the connection's
throttle, emit `op:start`, run `fn` behind `safeRun`'s `recover()` (`:200-211`), then emit `op:end`
with a status derived from `derived.Err() == context.Canceled` (`:179-181`), a duration, and
`op.Rows()`/`op.Command()` off the `*adapters.OpCtx` the callee wrote into (`adapters/adapter.go:151-177`).
`OpSpec` is four fields — `ConnectionID *string`, `Kind string`, `OpID string`, `TabID *string`
(`host.go:26-31`).

`CancelOp` (`:226-241`) cancels the derived context and *then* asks the live adapter to kill it
server-side — but only `if op.connectionID != nil` (`:235`). `Router.Cancel` (`router.go:221-223`)
is a bare forward, and `bridge.OpsService.Cancel` is a bare forward to that (`bridge/ops.go:47-53`).

`oplog.Wiring` turns those two events into `op_log` rows and a live `onOpUpdate` broadcast;
`state/ops.ts:19-27` keeps a 500-record ring from it, and `state/runState.ts:34-55`'s `useRunState(tabId)`
derives the toolbar ring and elapsed-time readout **entirely from that ring**, preferring a running
record over a newer finished one (`:45-47`). `ViewChrome.vue:88` mounts `<RunState>` from it
unconditionally, and its Stop button (`:71-78`) is gated on a `canStop` prop the view supplies.
Every view's `stop()` is `stopOp(rt)` → `control.opsCancel(rt.opId)` (`views/shared/viewOp.ts:38-40`)
against an op id the *renderer* minted in `beginOp` (`:107-114`).

### 1.5 CodeMirror, JSON, and beautify

`editor/CodeMirrorHost.vue` is the one editor host: `doc`/`language`/`readOnly` plus optional
autocomplete/lint/hover/singleLine props (`:28-56`), `update:doc` emitted only for real user typing
(`:66`, `:205-213`), a `readOnly` compartment that also flips `EditorView.editable` (`:106-121`),
and word-wrap driven from settings (`:91-94`). `editor/languages.ts:10` declares
`EditorLanguageId = 'json' | 'xml' | 'sql' | 'mongo' | 'redis' | 'plain'`, and `:164-165` returns
`@codemirror/lang-json`'s `json()` for `'json'`. Nothing needs adding for JSON.

`frontend/src/beautify.ts` already ships **exactly the beautify P2 needs**: `beautifyJson(text, 'indented' | 'compact')`
(`:241-248`) over a lossless scanner whose header comment (`:11-15`) states its own rule —
*"Never JSON.parse/JSON.stringify: a number is reproduced from its exact raw slice"* — plus
`scanJson(text)` (`:176-180`) as the one "is this JSON" gate in the app. `views/shared/celleditor/formats.ts:94-96`
is its existing caller.

### 1.6 The security posture, and what it says about outbound HTTP

`shell.Harden()` (`internal/shell/security.go:15-28`) is four things: deny microphone/camera/
geolocation/notifications, allow clipboard reads, and set `JavaScriptCanOpenWindowsAutomatically:
Disabled`. It constrains the **webview**, never the Go process, and
`docs/ARCHITECTURE.md:1024` records that the `Permissions` map is *inert on macOS* anyway
(`resolvePermission` has no darwin implementation in `v3.0.0-beta.16`).

The load-bearing row is `:1026`: **navigation lock has "no analogue — a real loss, already known"**
under Wails on darwin. There is no `decidePolicy` delegate, so nothing in the shell would stop a
renderer-issued `fetch()` to an arbitrary host, and nothing would confine it to the request the user
authored either.

---

## 2. Findings

### F1 — A new tab kind costs **four** hand-edited vocabularies, not two
`tabKindSchema` (`packages/shared/domain/tabs.ts:6-14`), `RENDERABLE_TAB_KINDS` (`:21-29`),
`TAB_KIND_MODE` (`:36-44`) and Go's `model.RenderableTabKinds` (`internal/storage/model/tabs.go:26-29`).
TypeScript's exhaustiveness catches three of them (the two total maps in §1.2 plus
`tabRecordSchema`'s discriminated union at `:176-208`); **only the Go list is silent** — a kind
missing there is dropped on read with a `warn` (`repos/tabs.go:57-60`) and the tab simply vanishes
on the next launch. This is P1 §8 OQ-6, now with a subject; §4 D10 resolves it.

### F2 — `model.TabRecord.Validate` **requires a non-empty `path`**, and a failure loses the whole window's tabs
`model/tabs.go:55-57` returns `path is required`, and `TabsRepo.Save` validates **every** record up
front before opening its transaction (`repos/tabs.go:84-88`), so one bad record fails the entire
window's save. An HTTP request tab addresses no tree node, so it must still carry *some* non-empty
`path` — this is the single hardest constraint on the new kind's record shape, and it is invisible
from the TypeScript side (`tabRecordBase.path` is a plain `z.string()`, `tabs.ts:171`).

### F3 — `openTab` cannot open a connectionless tab
`state/tabs.ts:221-227` types `connectionId: string`, and `:262` passes it to `recordRecent`. Every
one of the six public openers (`:270-370`) supplies a real connection id. An HTTP tab has none
(P1 F17 proved a `null` `connectionId` round-trips end to end; nothing has ever exercised it).

### F4 — `pathTail` is safe for a non-node path; `decodePath` is not
`pathTail` returns `null` for an unknown segment kind or a missing `:` (`packages/shared/domain/tree.ts:82-84`),
so any opaque string is safe there. `decodePath` **throws** on both (`:62`, `:65`) — but its six
callers (`state/objectStore.ts:123`, `project/menus.ts:56`, `views/keyvalue/mutations.ts:67`,
`views/grid/menu.ts:27`, `views/shared/targetPath.ts:10`) are all reached only from a Studio tab or
a Studio tree row. Nothing generic ever decodes a tab's path.

### F5 — `state/viewCommands.ts`'s `reloadTab` cannot be reached by a new kind, and needs no escape hatch
P1 §8 OQ-7 flagged the throw at `:26`. Re-read: `CommandTabKind` is a **closed five-member union**
(`:12`) that a new kind is not a member of, so `reloadTab('http-request', …)` is a *type* error, not
a runtime one; its only callers are `ProjectTree.vue:102-122`'s five literal-kind calls; and
`reloadTabsForTarget`'s switch has `default: break` (`:105-106`) and is additionally unreachable for
a tab whose `connectionId` is `null` (`:96` compares against a `string`). **No `reloadable: false`
flag is needed** — OQ-7 is closed by reading, not by building (§3).

### F6 — `TabStrip.vue` is fully registry-driven and reads no `tab.path`
`colorFor`/`iconFor`/`titleFor` are three one-line registry lookups (`:24-34`); the context menu is
six generic items plus `menuExtras` (`:53-93`); *Copy name* copies `titleFor(tab)` (`:90`). Grepping
the file for `path` finds nothing. So a new kind's strip appearance is entirely decided by its own
registry entry — P1's C4 delivered exactly what it promised.

### F7 — `OperationsPanel.vue` does **not** use the registry, and would print a raw path for an HTTP op
`:74` is `tabTitle(tab)` — `packages/shared/domain/tabs.ts:287-293`, which falls back to
`record.path` when `pathTail` yields nothing (F4). For an HTTP tab that renders the opaque path
string in the panel's Tab column. Two smaller siblings in the same file: the expanded command detail
row is hardcoded to `language="sql"` with a per-connection dialect (`:243-250`), and *Re-run*'s
`canSql` gate (`:110`) already reads `false` for a null connection id, which is correct.

### F8 — `ViewChrome` renders a "no colour" connection dot for a connectionless tab
`ViewChrome.vue:40` computes `connection` from `connectionRecord(props.tab.connectionId)` —
`undefined` for a null id (`state/connections.ts`'s own contract, P1 F17) — and passes
`:conn-color="connection?.color ?? null"` (`:51`). `ViewHeader.vue:33` renders the dot whenever
`connColor !== undefined`, so `null` renders it with the `.none` class. Correct for a connection
with no colour assigned; wrong for a tab that has no connection at all.

### F9 — *Verified safe*: `op_log` already accepts a connectionless row
`0001_init.sql:69-80`: `connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL` with no
`NOT NULL`, and `tab_id TEXT` with **no** foreign key at all. `model.OpRecord.ConnectionID`/`TabID`
are both `*string` (`model/ops.go:6-16`), and `OperationsPanel.vue:219` already renders
`connectionFor(record)?.name ?? '—'`. **An HTTP op logs with no migration and no repo change.**

### F10 — *Verified safe*: `RunOp` already tolerates `ConnectionID: nil`
Both connection-dependent branches are guarded: the throttle gate is `if spec.ConnectionID != nil && throttledKinds[spec.Kind]`
(`host.go:150`), and `CancelOp`'s live-adapter kill is `if op.connectionID != nil` (`:235`). Everything
else — id minting, duplicate refusal, the derived cancellable context, both events, the `recover()`
boundary, the running map — is connection-agnostic. `spec.Kind` is a plain `string` validated only
downstream, by `oplog/wire.go:134`'s `model.ValidOpKind`.

### F11 — Cancellation for a bound call has **two** working mechanisms in the pinned Wails, and one of them is already this app's convention
Read from the installed module rather than the (403-blocked) docs site:
`messageprocessor_call.go:60` derives a per-call `context.WithCancel`, registers it under the call's
`call-id` (`:77-92`) and `processCallCancelMethod` (`:19-37`) cancels it — reachable from the
generated `$CancellablePromise`. Separately, `bindings.go:202`/`:271` set `needsContext` when a bound
method's **first parameter is `context.Context`**, and `BoundMethod.Call` injects it (`:308`,
`:341`). So a bound method can be genuinely cancellable and genuinely window-scoped
(`CancelWindowCalls`, `messageprocessor.go:210`).
The app's own convention is the other one: `stopOp(rt)` → `control.opsCancel(rt.opId)` → `Router.Cancel`
→ `Host.CancelOp`. §4 D3 uses that one and explains why.

### F12 — A long-held bound call cannot block the control plane, and the shipping design already proves it
`transport_http.go:325` reaches `HandleRuntimeCallWithIDs` from inside an ordinary
`http.Handler`, and the data plane already holds a `GET /wails/stream/poll` open **for up to 20 s**
over that same asset-server transport in the desktop build (`docs/ARCHITECTURE.md:796-805`) while
every bound call keeps working. A 30-second HTTP send is the same shape.

### F13 — `beautify.ts` is already the right answer, and it is better than `JSON.stringify`
F1.5 above: `beautifyJson` is lossless by construction (`:11-15`) — a `numeric(20,6)`-shaped literal
survives byte-identical, which `JSON.parse`/`JSON.stringify` would silently round through a JS
`number`. An HTTP API returning a 19-digit id is the *common* case, not an exotic one. Hand-rolling
or `JSON.stringify`-ing here would be a regression against code already in the tree.

### F14 — `useEditBuffer`/`EditBufferActions` are the wrong shape for both P2 surfaces
`useEditBuffer` (`views/shared/useEditBuffer.ts:42-108`) is a dirty/revert buffer over a *stored
value* with an `isDirty`/`reset()`/`reseed()` lifecycle, and `EditBufferActions.vue:10-25` takes an
`EditBuffer` prop. The request body has no stored-vs-buffer split (it writes straight through to
`state_json`, the way the console's `text` does) and the response body is read-only with nothing to
revert to. Only `beautifyJson` itself is reusable.

### F15 — `view.run` (⌘Return) is free, unconditional, and already routed
`SHORTCUTS['view.run']` is `{key:'Return', cmdOrCtrl:true, global:true}` (`packages/shared/domain/shortcuts.ts:32`);
`menutemplate.go:80` emits it unconditionally as *Run Statement*; `App.vue:48` turns it into
`runCommand('view.run')`; `shortcuts/commands.ts:7-18` is a per-id registry the mounted view
registers into, with `runCommand` a documented no-op when nothing is registered. `ConsoleView.vue:345`
is the existing subscriber. **Send needs no new channel, no new accelerator, no Go change.** The same
holds for `view.refresh` (F5, `App.vue:47`) as Resend.

### F16 — `tests/ui` can mock a channel whose args are never stable, but only one snapshot per channel per test
`mockRuntime.ts:353` is `const snap = list.length === 1 ? list[0] : findSnapWithRefreshFallback(callArgs)`
— a channel with exactly one snapshot answers regardless of args, which is the documented reason
`opsCancel`'s client-minted op id works there (`:325-327`). A renderer-minted op id in the send args
therefore costs one test-per-response-shape, not a mock rewrite.

### F17 — `.p-chip` already has the four status colours P2 needs
`primitives.css:426-452`: `.p-chip` plus `.ok` / `.warn` / `.err` / `.info` variants over
`--kira-ok` / `--kira-warn` / `--kira-error` / `--kira-info` (`tokens.css:19-22`). A status badge
and a method chip need **zero new CSS**.

### F18 — `PanelSplitter.vue` is fully generic and layout-store-free
`:2-13`: `orientation`/`size`/`min`/`max`/`reverse` in, a pixel `resize` out. Unlike the three
`WorkbenchShell` splitters it has no coupling to `layoutState`, so a fourth split inside one view
costs nothing at the schema layer (which is what P1 F15/F20 said adding a fourth *panel* would cost).

### F19 — Go's `http.Response.Header` is an order-losing, key-canonicalising map
`net/http` gives back `map[string][]string` with `textproto.CanonicalMIMEHeaderKey` applied. There
is no stdlib access to the bytes as received. So P2 cannot show received header order or original
casing; P7's raw inspector is the phase that can. §4 D4 makes this a stated limitation with a
deterministic substitute, not a silent one.

### F20 — Two `net/http` behaviours will look like bugs if not handled explicitly
(a) `req.Header.Set("Host", …)` is **ignored** — `net/http` writes `req.Host`/`req.URL.Host`
instead, so a user-typed `Host:` header silently does nothing unless assigned to `req.Host`.
(b) The transport adds `Accept-Encoding: gzip` and transparently decompresses **only when the caller
did not set that header itself**; a hand-set `Accept-Encoding` yields a compressed body the client
must not pretend to have decoded.

---

## 3. Checked, and not fired

- **No migration, no `TabsRepo` change, no `OpsRepo` change, no new column.** F9 (op log accepts a
  null connection and has no `tab_id` FK) + F2 (the one real constraint, satisfied by D2's constant
  `path`) + `state_json` staying opaque to Go by design (`model/tabs.go:8-12`).
- **No `reloadable: false` escape hatch, and no `state/viewCommands.ts` change at all.** F5. P1's
  own OQ-7 is closed by reading the union's type, not by adding a flag whose only purpose would be
  to guard a call that cannot compile.
- **No new `adapters.ErrorCode` member.** That set's own comment forbids it without a matching
  renderer change (`adapters/errors.go:9-12`), and `views/shared/viewOp.ts:21`'s
  `DISCONNECTED_CODES` would misclassify an HTTP connection refusal as *"the database connection is
  gone"* and pop a Reconnect gate over a tab with nothing to reconnect. §4 D8 gives `httpclient` its
  own code vocabulary in the `ipcerr` family instead.
- **No second op scheduler, no second op log, no second cancel path.** F10 + §4 D3. P1 §8 OQ-5 is
  answered *yes*, and §4 D3 states the concrete consequence that decides it.
- **No new dependency.** §4 D1 states the check rather than asserting the conclusion; `NOTICES.md`
  is untouched.
- **No `beautify.ts` change and no `editor/languages.ts` change.** F13 + §1.5: `beautifyJson`,
  `scanJson` and the `'json'` language id are all already exactly right.
- **No `layoutSchema` change for the request/response split.** F18: `PanelSplitter` needs no store,
  and the ratio persists in the tab's own `state_json` like `DataTabState.columnWidths` already does.
- **No `theme/primitives/` addition.** F17 (chips), F18 (splitter), `EmptyState.vue:17`'s action
  slot, `SegmentedControl.vue`, `TextField.vue`, `AppButton.vue`, `IconButton.vue`, `ViewChrome.vue`
  cover every surface P2 draws.
- **`state/mode.ts`, `workbench/modes.ts`, `TabStrip.vue`, `MainView.vue`, `LeftPanel.vue` and
  `WorkbenchShell.vue` are untouched.** F6 + §1.2. If a commit in §5 seems to need one of them,
  re-read §2.

---

## 4. Decisions

### D1 — No new library, and here is the check rather than the assertion
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one.

- **A Go HTTP client library** (`resty`, `req`, `heimdall`). Declined on requirements, not licence.
  Every candidate exists to make *writing many similar requests* ergonomic — fluent builders,
  automatic JSON marshal/unmarshal into typed structs, retry/backoff, middleware. P2 needs the exact
  opposite: one request whose method/URL/headers/body are user-authored strings that must go out
  **unmodified**, and one response whose bytes must come back unmodified. Every ergonomic layer here
  is a layer that can silently rewrite what the user asked for — and each of them ultimately calls
  `net/http` anyway, which this repo has already shipped a production adapter on top of (the
  ClickHouse adapter carries *no driver dependency at all*, `docs/ARCHITECTURE.md:217-223`).
  `net/http` is also the only client that can give P8 its timeline, via `httptrace` in the stdlib.
- **A retry/backoff library.** No subject: P2 issues exactly one request and never retries. Retries
  belong to a phase that has a reason to want them, and would need a UI to disclose them.
- **A URL-parsing/building library** on the frontend (`whatwg-url`, `query-string`). Declined:
  `URLSearchParams` is a platform builtin the webview already has, and the one thing it does wrong
  for this surface — `toString()` encodes a space as `+` — is precisely why P2 hand-builds the query
  string with `encodeURIComponent` instead (D9). Fifteen lines that never rewrite a user's URL beat
  a dependency that sometimes does.
- **A JSON pretty-printer.** Declined against code already in the tree: `beautifyJson`
  (`beautify.ts:241-248`) is lossless where `JSON.stringify` is not (F13).
- **A syntax highlighter.** No subject: `@codemirror/lang-json` is already a dependency and
  `editor/languages.ts:164-165` already routes to it.

### D2 — The kind is `'http-request'`; its identity is its `id`; its `path` is the constant `'request'`

**Name.** Every existing kind is a single lowercase token because every existing kind names a *page
shape* within one mode. `'http-request'` names a protocol **and** a surface, which is what this
vocabulary now has to do: P9 adds gRPC to the *same* mode (`docs/v1.2/SPEC.md`'s P9 row), so a kind
spelled `'http'` inside a mode spelled `'http'` would make `TAB_KIND_MODE.http === 'http'` read as
if kind and mode were one axis — which is the exact confusion P1 D5 exists to prevent. Nothing in
the app derives an identifier from a kind string (F6: every consumer is a total map or a
`z.literal`), so the hyphen costs quoted object keys and nothing else. The view directory is
`views/httprequest/`, no separator, matching `views/keyvalue/`'s own precedent for a two-word name.

**Identity.** `docs/ARCHITECTURE.md:549-556` — *"Tab identity is the tab's `id`, never its `path`"*.
For every Studio kind `path` additionally names a real target; an unsaved HTTP request has no target
outside its own editable state. So `path` is the literal constant `'request'` — non-empty (F2),
carrying no false uniqueness, safe through `pathTail` (F4), and never reached by `decodePath` (F4).
Two consequences worth stating plainly: `duplicateTab` (`state/tabs.ts:376-399`) copies `path`
verbatim, which is *correct* here because the constant claims nothing; and P4 is free to replace it
with a real `collection:<id>/request:<id>` path the day a request has somewhere to live, with no
change to anything else.

**The registry entry**, all eight members:

| Member | Value |
|---|---|
| `mode` | `TAB_KIND_MODE['http-request']` = `'http'` — the first non-`'studio'` entry |
| `title` | `httpRequestTitle(tab.state)` — the URL's path, else its host, else the raw text, else `'New request'` (D9) |
| `icon` | `'globe'`, matching `MODES.http.icon` (`workbench/modes.ts:22`) |
| `railColor` | `undefined` — no connection, so no rail (P1 F17: `TabStrip`'s rail already resolves to `transparent`) |
| `defaultState` | `defaultHttpRequestTabState()` |
| `duplicateState` | a **copy of the source's request**, not a blank one — see below |
| `dropResources` | `noDrop` (`state/tabKinds.ts:88-90`); the response lives in the view's runtime store, freed by `cleanupTabRuntime` |
| `menuExtras` | `[]` — there is no project panel to reveal into (`state/tabKinds.ts:72-73` anticipated exactly this) |

`duplicateState` deliberately breaks with `TabKindDef`'s own *"same target, fresh default state"*
doc (`:53-55`): for every Studio kind the state is a *view* of a target that lives elsewhere, so
"fresh" is right; for an HTTP request the state **is** the request, and duplicating a tab to try a
variant is the only reason anyone would. It returns a structural copy (headers deep-copied, since
they are objects in an array), and the entry carries a comment saying so.

### D3 — HTTP requests are real ops on the **existing** op log, run through `Host.RunOp` — P1 OQ-5, answered
P1 §8 OQ-5 asked whether HTTP requests join the same op log or get their own. **The same one**, and
the deciding argument is concrete rather than aesthetic:

`ViewChrome` is the chrome every non-grid view opens with, and it mounts `<RunState :status :elapsed-ms>`
from `useRunState(tabId)` (`ViewChrome.vue:42`, `:88`), which reads **only** `opsState`
(`state/runState.ts:45-47`), which is fed **only** by `control.onOpUpdate` (`state/ops.ts:19-27`),
which is fed **only** by `oplog.Wiring` off `Host`'s `op:start`/`op:end`. A separate HTTP log would
therefore mean either a dead progress ring on every HTTP tab, or a second `useRunState` and a second
ops store — which is exactly the "two implementations, two places for the same bug" outcome P1
exists to prevent. The same argument holds twice more: `docs/ARCHITECTURE.md:70`'s invariant
(*"Every operation that can exceed ~150 ms shows progress and a working stop button"*) is satisfied
for free, and the Operations panel's own per-row **Cancel** (`OperationsPanel.vue:145-150`) reaches
`OpsService.Cancel` → `Router.Cancel` → `Host.CancelOp` — an HTTP row that appeared in that panel
with a Cancel item that did nothing would be a lie in the UI.

Cost, measured against F10: **`RunOp` needs no change at all.** `HttpService.Send` calls
`s.Deps.Router.Host().RunOp(ctx, adapterhost.OpSpec{ConnectionID: nil, Kind: "http", OpID: args.OpID, TabID: &args.TabID}, fn)`.
Both connection-dependent branches self-guard (`host.go:150`, `:235`); throttling is skipped (a
per-connection rate limit has no subject); the panic boundary, the duplicate-id refusal and the
cancelled-status derivation all apply unchanged. What the phase actually adds is **one string in
two lists** — `'http'` in `opKindSchema` (`packages/shared/domain/ops.ts:3-16`) and in `opKinds`
(`model/ops.go:38-42`) — the identical shape P33's `'transfer'` addition took, and the same
`op_log` row F9 proved already fits.

Three deliberate details:

- **A non-2xx response is `status: 'ok'`.** The op is the *exchange*, and testing a 404 endpoint is
  the point of an HTTP client; a red ring for a deliberate 404 would be actively wrong. Only a
  transport failure, a timeout or a cancel is `'error'`/`'cancelled'`.
- **The outcome rides in `command`.** `op.SetCommand` is mutex-guarded, callable more than once, and
  read by `RunOp` only *after* `fn` returns (`host.go:186-188`), so the handler writes
  `GET https://api.example.com/users` before the send and overwrites it with
  `GET https://api.example.com/users → 404 Not Found` after. This is a narrow, documented widening
  of `command`'s meaning for one op kind, chosen over a schema change for one cosmetic column: the
  panel row becomes legible with no migration and no new field to keep in sync.
- **`rows` stays nil** (`'—'` in the panel). An HTTP response has no rows, and putting a byte count
  or a status code under a column headed *Rows* would be worse than an em dash.

**The cancel path is the app's existing one, not Wails'.** F11 found that
`$CancellablePromise.cancel()` would also work. It is declined *for the view's Stop button* because
it would be a second cancellation mechanism the Operations panel could not reach, and consistency
with `stopOp(rt)` (`views/shared/viewOp.ts:38-40`) is worth more than the marginally nicer test
ergonomics (F16). The op id is therefore **renderer-minted** and travels in the call args, exactly
as every data-plane op's already does (`beginOp`, `viewOp.ts:107-114`).

**`Send` does take `ctx context.Context` as its first parameter** (F11, `bindings.go:271`), so a
window closing mid-request aborts it (`CancelWindowCalls`) instead of leaving a goroutine holding a
socket for 30 s. That is a first for this repo's bound services, which is why §6.1 makes
"regenerate bindings and confirm the generated `Send(args)` signature omits `ctx`" an explicit
verification step with a named one-line fallback (`context.Background()`), rather than an assumption.

### D4 — The Go client: one `net/http` client, explicit about every default it takes
`internal/httpclient` is a self-contained package with no dependency on `adapters`, `adapterhost`,
`storage` or Wails — one exported `Send(ctx, Request) (Response, error)`, drivable from a plain
`httptest` server. Its defaults, each a named constant with a stated reason:

| Knob | P2 value | Why |
|---|---|---|
| Timeout | `defaultTimeout = 30s`, applied as `context.WithTimeout` on the caller's ctx, **not** `Client.Timeout` | one mechanism for timeout *and* cancel, so both abort the body read too; Insomnia's own default, and a backstop behind the Stop button rather than the primary control. Postman defaults to no timeout at all, which for a desktop app means a request that hangs forever with nothing in the log |
| Redirects | followed, capped at `maxRedirects = 10`, and **every hop recorded** and surfaced | Postman follows by default and so should this; what it must not do is *silently* — a `301` rendered as a `200` from a different origin, with no explanation, is the exact misleading outcome the phase brief calls out. `CheckRedirect` captures `{status, url}` per hop into the `Response.Redirects` list, and the view prints `2 redirects → <finalUrl>` beside the status |
| TLS verification | **always on**; no per-request opt-out exists in P2 | a verification toggle is a security footgun that needs a persistent, visible badge and a per-request home to live in; neither exists yet (§8 OQ-4) |
| Proxy | `http.ProxyFromEnvironment` (the `DefaultTransport` default), kept | matches every other outbound path in the app and the sandbox's own `HTTPS_PROXY` |
| Cookies | `Client.Jar` nil | §0.2 |
| `User-Agent` | `Kira Studio/<version>`, overridable by a user-supplied header | Go's default `Go-http-client/1.1` misrepresents the app; an HTTP client tool that lies about who it is makes server-side debugging harder |
| Scheme | a URL with no scheme is resolved to `https://`, and the resolved URL comes back as `Response.FinalURL` | fails safe (an http-only server errors loudly rather than the request quietly going out in the clear), done once in Go so P5's curl parser and P9 inherit it |
| Connection reuse | one package-level `*http.Client` over one `*http.Transport` | keep-alive across sends is what makes a second request to the same host fast; there is nothing per-request to isolate in P2 |

Two `net/http` traps from F20 are handled explicitly and commented: a user-supplied `Host` header is
assigned to `req.Host` (not just the header map), and a user-supplied `Accept-Encoding` is detected
so the response is reported as-received rather than as-if-decoded.

**The body.** Read through `io.LimitReader(resp.Body, maxResponseBytes+1)` with
`maxResponseBytes = 10 MiB`; over that, `BodyTruncated: true` and the view shows a strip saying so.
The bytes are returned as `Body string` with `BodyEncoding: "utf8"` when `utf8.Valid`, else base64
with `BodyEncoding: "base64"` — because Go's `encoding/json` replaces invalid UTF-8 with U+FFFD, so
a naive string field would silently corrupt any binary response. In P2 the viewer renders `"utf8"`
and prints *"N bytes of binary data"* for `"base64"`; P7 is the phase that renders it.

**Headers** come back as an ordered `[]Header{Name, Value}` sorted by name, one entry per value so
duplicates survive — F19's honest substitute for received order, with the limitation stated in the
struct's own doc comment and in `docs/ARCHITECTURE.md`.

### D5 — The wire shapes live in Go and are mirrored, not re-validated, in TypeScript
`httpclient.Request` / `httpclient.Response` are the wire types; §1.3 confirmed the generator emits
`bindings/.../internal/httpclient/models.ts` for them. `control.ts`'s `httpSend` `trust<T>()`s the
result into `packages/shared/domain/http.ts`'s hand-written mirror, exactly as every other bound
call does (`control.ts:88-93`) — **no Zod parse of a Go-produced value**, matching
`docs/ARCHITECTURE.md:33`'s division of labour.

```
Request  { method, url, headers: Header[], body: string, hasBody: bool }
Header   { name, value }
Response { status, statusText, proto,
           headers: Header[],
           body, bodyEncoding: 'utf8'|'base64', bodyBytes, bodyTruncated,
           elapsedMs, finalUrl, redirects: { status, url }[] }
```

`elapsedMs` is one number, measured around send-plus-read. P8 is the phase that breaks it down; P2
deliberately ships no field it would have to reinterpret then.

### D6 — The tab state is small, URL-authoritative, and forward-shaped for P3
`packages/shared/domain/http.ts`, validated by Zod on restore the way every other tab state is
(`tabRecordSchema`, `tabs.ts:176-208`); Go keeps validating only the envelope (`model/tabs.go:8-12`),
so **there is no Go mirror of this schema at all**.

```
method              'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS'   .default('GET')
url                 string                                                 .default('')
headers             { name, value, enabled: bool .default(true) }[]        .default([])
bodyMode            'none' | 'json'                                        .default('none')
body                string                                                 .default('')
requestPane         'params' | 'headers' | 'body'                          .default('params')
responsePane        'body' | 'headers'                                     .default('body')
responseView        'pretty' | 'raw'                                       .default('pretty')
requestPaneHeight   int >= 0   (0 = "the default half")                    .default(0)
```

Every field carries `.default()`, so a tab saved by P2 still restores once P3 widens `bodyMode` —
the same discipline `keyValueTabStateSchema`'s own comment records (`tabs.ts:118-121`), and it
matters more here than anywhere else because `repos/tabs.go` drops a row outright on a failed parse.

**There is no `params` array.** The URL is the single source of truth for the query string, and the
Params table is a two-way *derived editor* over it (D9). One persisted field instead of two means
the URL and the table cannot disagree — a real Postman annoyance — and it means P2 stores nothing it
would have to migrate when P3/P4 arrive. The cost is that a P2 query param has no `enabled`
checkbox; §8 OQ-1 hands that forward with the shape it would take.

**The response is never persisted.** It lives in the view's own per-tab runtime record, exactly as
`consoleTabStateSchema`'s comment demands of a console's results (`tabs.ts:76-77`) and as
`docs/ARCHITECTURE.md:526-536` describes the renderer's fourth cache tier. Persisting a response is
P6's job, into its own storage, not into `state_json`.

**A restored HTTP tab shows no Reconnect gate.** `hydrateTabs` leaves `tabsState.hydrated` empty on
purpose (`state/tabs.ts:191-192`); every Studio view consults it and renders `ReconnectGate`. The
HTTP view simply never consults it — there is nothing to reconnect — so a restored tab renders its
builder immediately with an empty response pane. That is a property to assert (§6.2), not code to
write.

### D7 — Where each new file goes is decided by `biome.json`, not by taste
`biome.json:124-147` forbids `http/** → project/**` and `http/** → views/**`. P1 D7's own wording
(*"Http's UI is neither `project/` … nor `views/<kind>/` (a tab view), so it gets `http/`"*) already
implies the split this phase needs:

- **`views/httprequest/`** — the tab view and its state. It is a tab view, so it belongs where every
  tab view belongs, and being there is what lets it use `views/shared/` (`createRuntimeStore`,
  `stopOp`, `classifyLoadError`) and `theme/primitives/` (`ViewChrome`, `PanelSplitter`,
  `SegmentedControl`) instead of growing private copies. `workbench/tabViews.ts` importing it is the
  same `workbench/ → views/` edge the other seven entries already use.
- **`http/`** — Http mode's non-tab chrome only: the existing `CollectionsPanel.vue` and
  `HttpStart.vue`. Both gain a *New request* action, which calls `state/tabs.ts`'s
  `openHttpRequestTab()` — a `http/ → state/` edge, permitted, and the same shape
  `ProjectPanel.vue:6` already uses for `openCreateDialog`.

`biome.json`'s `views/**` cross-kind rule (`:79-94`) is an explicit list of sibling directories; C5
adds `httprequest` to it in both the relative-`../` and `../../` halves, so the new view can neither
reach into another kind's module nor be reached from one.

### D8 — `httpclient` owns its own error vocabulary, in the `ipcerr` family
`adapters.ErrorCode` is a closed set whose own comment forbids additions without a matching renderer
change (`adapters/errors.go:9-12`), and reusing `E_CONNECT` for a refused TCP connection would make
`views/shared/viewOp.ts:21`'s `DISCONNECTED_CODES` classify it as *"the database connection is gone"*
and call `unmarkHydrated` on a tab that has no connection (§3). So `httpclient` exports its own
`*httpclient.Error{Code, Message, Cause}` with `errors.As` classification — the same shape
`adapters.Error`/`adapters.CodeOf` has, in the package that owns the domain — over four codes:

| Code | Cause |
|---|---|
| `E_BAD_REQUEST` | unparseable URL, non-`http(s)` scheme, missing host, unknown method — refused before anything is sent |
| `E_CANCELLED` | `ctx.Err() == context.Canceled` — the Stop button, or the window closing |
| `E_TIMEOUT` | `context.DeadlineExceeded` |
| `E_HTTP_TRANSPORT` | everything else: DNS failure, refused connection, TLS handshake failure, a truncated response |

`bridge/http.go` maps them straight through to `ipcerr.New(code, message)` — one line — joining the
`ipcerr` family (`E_INTERNAL`, `E_BAD_REQUEST`, `E_DISCONNECTED`, `E_SECRET_STORE`) rather than the
adapter one. The view branches on `E_CANCELLED` (silent, `status: 'cancelled'`) and renders
everything else in the response pane as a failure card with the code and message; it never calls
`applyLoadFailure`, so it can never touch `hydrated`.

### D9 — The URL is authoritative; the Params table is a derived editor that only ever writes on its own edits
`views/httprequest/url.ts` is pure and DOM-free, in the spirit of `theme/primitives/stickyBand.ts:1-4`:

- `splitUrl(text)` → `{ base, query, hash }`, two `indexOf`s on the first `?` and `#`. It must work
  on a half-typed URL (`api.exa`), which `new URL()` cannot.
- `parseQuery(query)` → `{name, value}[]`, split on `&` then the first `=`, `decodeURIComponent` each
  half (tolerating a malformed escape by passing the raw text through).
- `buildQuery(pairs)` → a string, `encodeURIComponent` each half.
- `httpRequestTitle(state)` → the tab strip / view header title.

`buildQuery` is hand-written rather than `URLSearchParams.toString()` for one concrete reason:
`URLSearchParams` encodes a space as `+`, so any interaction with the Params table would silently
rewrite a user's `%20`. Fifteen controlled lines beat a builtin that is wrong in exactly the case
this surface exists for.

**The rule, stated so it can be tested:** typing in the URL field updates the table and never
rewrites the URL; editing the table rewrites the URL. `HttpRequestView.vue` implements this by
computing the table from `state.url` and writing back only from a table `@change`.

### D10 — P1 OQ-6 is closed by a parity test, not by codegen
F1: four vocabularies, one of them (Go's) silent. Generating the Go list from the TypeScript source
would add a build step and a generated file to a repo whose only generated Go artefacts today are
FlatBuffers types and Wails bindings — too much machinery for two lists of eight strings. Instead,
`tests/unit/go-ts-vocabulary-parity.spec.ts` reads `internal/storage/model/{tabs,ops}.go` as text and
asserts `RenderableTabKinds`' keys equal `RENDERABLE_TAB_KINDS` and `opKinds`' keys equal
`opKindSchema`'s members. This is the same technique `mockRuntime.spec.ts` already uses against the
generated bindings (`mockRuntime.ts:85-90`), so it is a precedented shape, not a new one. It clears
`AGENTS.md`'s unit-test bar on its own terms: a cross-language invariant whose failure mode is
*silent* (a row dropped with a `warn` nobody reads, `repos/tabs.go:57-60`), not a CRUD round-trip.

### D11 — Status-code hints: one shared table, rendered inline, coloured by class
`packages/shared/domain/http.ts` exports `STATUS_HINTS: Readonly<Record<number, string>>` (a
one-line plain-English meaning per code — *"404 — the server has no resource at this URL"*),
`statusHint(status)` falling back to a class-level sentence for an unlisted code, and
`statusClass(status)` → `'info' | 'ok' | 'warn' | 'err'`. It lives in `packages/shared/domain/`
because that is where this repo's closed vocabularies live (`MIN_SERVER_VERSION`,
`connection.ts`), so a future backend consumer needs no move. **No Go mirror is written** — nothing
on the Go side consults it, and writing one would be scope left out of a phase but half-implemented
anyway.

Rendering: `statusClass` feeds `.p-chip`'s existing variants (F17, `primitives.css:437-452`), and
the hint is **always shown inline** beside the badge as a muted caption — `404 Not Found · the
server has no resource at this URL` — truncated with the full text as a `v-tooltip`. Inline rather
than tooltip-only because the spec's own wording is *"status-code hint text shown alongside it"*, and
because the case that matters (4xx/5xx) is exactly the case where the user should not have to
discover a hover. The same row carries `elapsedMs`, `formatBytes(bodyBytes)` (`format.ts:8-12`) and,
when `redirects.length > 0`, the redirect count and final URL (D4).

### D12 — The view: `ViewChrome` on top, a splitter between request and response
`views/httprequest/HttpRequestView.vue` mounts `ViewChrome` like every other non-grid view
(`docs/ARCHITECTURE.md:640-642`):

- `icon="globe"`, `:name="httpRequestTitle(tab.state)"`, no `path`.
- `#badges`: the method chip — `.p-chip` with `info`/`ok`/`warn`/`err` by method family (GET, POST,
  PUT/PATCH, DELETE), zero new CSS (F17).
- `@refresh` → resend, `@stop` → `stopOp(rt)`, `:can-stop="rt.status === 'running'"` — driven by the
  view's own runtime, not `opsState`, matching `ConsoleView.vue`. (The ring and elapsed time *do*
  come from `opsState` and therefore stay idle under `tests/ui`, where op events are backend-produced
  — an honest limitation of that tier that every existing view already shares.)
- `#toolbar`: the method select, the URL `TextField` (`flex: 1`), and a primary **Send** button.
- `#toolbar-2`: a `SegmentedControl` — Params · Headers · Body — each with a count badge.

Below: the request pane and the response pane, split by `PanelSplitter orientation="row"` bound to
`state.requestPaneHeight` (F18, D6). The response pane has its own `SegmentedControl` (Body ·
Headers) and, for a body CodeMirror judges JSON via `scanJson`, a Pretty · Raw toggle.

Both body surfaces are `CodeMirrorHost`: the request body `language="json"` `:read-only="false"`
writing through to `patchHttpRequestTabState(tab.id, { body })`; the response body
`language="json"` when `scanJson(body).ok` else `'plain'`, `:read-only="true"`.

**Beautify is two different actions, deliberately.** On the *request* body it is an edit — an
`IconButton icon="expand-all"` (the same icon and tooltip vocabulary `EditBufferActions.vue:57-64`
already established) that rewrites `state.body` via `beautifyJson(text, 'indented')`, with a
`result.reason` caption on failure. On the *response* it is a **view toggle**, not an edit: Pretty
renders `beautifyJson(raw, 'indented')` and Raw renders the bytes as received. A read-only viewer
must never claim the server sent what it is showing. `useEditBuffer`/`EditBufferActions` are not
reused for either, per F14 — the wrong model, not the wrong location.

### D13 — Creating a request: three affordances, no menu change
Collections do not exist until P4, so there is no tree to open a request from. The minimum viable
set, each landing where the equivalent Studio affordance already is:

1. **`HttpStart.vue`** gains the `StudioStart.vue:64-76` first-run shape verbatim — mark, title
   *"No request open"*, one line of copy, and one `p-dlgbtn primary` **New request** button. This is
   the mode's front door and it currently has none.
2. **`CollectionsPanel.vue`** gains an `IconButton icon="add"` in `LeftPanel`'s `#actions` slot,
   `data-testid="new-request"`, exactly where `ProjectPanel.vue:22-30` puts *Add connection*, plus
   the same button inside its `#empty` `EmptyState` slot (`EmptyState.vue:17`). The panel stays
   collections-free per P4's scope — a create action in the panel header is the mode's primary
   action, not a collections tree.
3. **A command-palette entry** `{ id: 'http.newRequest', label: 'New request', run: openHttpRequestTab }`
   in `shortcuts/state.ts`'s list. It is a one-click action worth a name, which is that list's own
   stated bar (`:16-19`).

**No `menutemplate.go` change and no new accelerator.** `⌘N` is *New connection*
(`shortcuts.ts:26`), and a mode-aware `⌘N` would need a Go-side notion of the focused window's
current mode, which does not exist and which P1 D5 deliberately did not build. §8 OQ-7 carries it
forward together with P1's own OQ-3. **Send needs no menu work either** — F15: the view registers
`view.run` and `view.refresh` and inherits ⌘Return and F5 for free.

### D14 — Two shared-chrome corrections, landed before the kind exists
Both are pure correctness against a *connectionless* tab, and both are invisible to Studio because
every Studio tab has a live connection record (a tab whose connection is deleted is closed outright,
`state/tabs.ts:150-156`):

- `OperationsPanel.vue:72-75`'s `tabTitleFor` switches from `tabTitle(tab)`
  (`packages/shared/domain/tabs.ts:287-293`) to `TAB_KINDS[tab.kind].title(tab)` — the registry P1
  D4 made the per-kind source of truth (F7). `workbench/ → state/` is an established edge
  (`TabStrip.vue:7`). The expanded command row's editor language becomes
  `record.kind === 'http' ? 'plain' : 'sql'`, so a URL is not highlighted as SQL.
- `ViewChrome.vue:51` passes `connection ? (connection.color ?? null) : undefined`, so
  `ViewHeader.vue:33`'s `connColor !== undefined` guard renders **no dot at all** for a tab that has
  no connection, instead of a "no colour assigned" dot (F8).

---

## 5. Implementation order

Ten commits. C1–C4 add capability with nothing yet mounted (each typechecks and builds on its own);
C5 is the one that makes the feature exist; C6–C8 are additive layers on a working feature; C9–C10
are the test and the docs. Per `AGENTS.md`, run the fast checks (`lint`, `typecheck`, `build`) per
commit and the expensive suites once at the end.

### C1 — `feat(shared): the HTTP request/response domain`
`packages/shared/domain/http.ts`: the method enum, `httpHeaderSchema`, `httpRequestTabStateSchema` +
`defaultHttpRequestTabState()` (D6), the `Request`/`Response`/`Header`/`RedirectHop` TS mirrors (D5),
and `STATUS_HINTS`/`statusHint`/`statusClass` (D11). Pure addition — no tab kind yet, so no total
map breaks.

### C2 — `feat(httpclient): a net/http client that sends exactly what it was given`
`internal/httpclient/{client.go,errors.go}` per D4 and D8, plus `client_test.go` (§6.3). No wiring,
no caller, no bridge — `go test ./apps/kira-studio/internal/httpclient/...` is the whole proof.

### C3 — `feat(bridge): HttpService.Send, on the same op scheduler the adapters use`
`internal/bridge/http.go` (`Send(ctx, HttpSendArgs) (httpclient.Response, error)`, `RunOp` per D3,
error mapping per D8), the `main.go:190-204` registration, `'http'` added to `opKindSchema`
(`packages/shared/domain/ops.ts`) and `opKinds` (`model/ops.go`), `control.ts`'s `httpSend`, the
`IPC.httpSend`/`FQN_SUFFIX_BY_IPC_KEY.httpSend` pair in `tests/ui/support/`, and a bindings
regeneration (`wails3 task common:generate:bindings` via `scripts/setup.sh` — **never** a hand-typed
flag list, `AGENTS.md`'s `-names` warning has a real subject this phase). The frontend has a callable
`control.httpSend` with no caller yet.

### C4 — `refactor(workbench): shared chrome stops assuming a tab has a connection`
D14's two corrections. **Guard:** the existing suite with no spec edits — `tests/ui/tabs.spec.ts`,
`data-view.spec.ts`, `console*.spec.ts`, `workbench.spec.ts`. A spec edit here is a signal the
refactor changed Studio behaviour.

### C5 — `feat(http): an HTTP request tab — builder, send, response`
The phase's centre, atomic because `TAB_KINDS` and `TAB_VIEWS` are total maps (§1.2):
`'http-request'` into `tabKindSchema`/`RENDERABLE_TAB_KINDS`/`TAB_KIND_MODE`/`tabRecordSchema` and
into Go's `RenderableTabKinds`; the `state/tabKinds.ts` entry (D2's eight members) and the
`workbench/tabViews.ts` entry; `openTab`'s `connectionId` widened to `string | null` with
`recordRecent` staying behind its existing `opts.recentKind` gate (F3), plus `openHttpRequestTab()`
and `patchHttpRequestTabState()`; `views/httprequest/{url.ts,state.ts,HttpRequestView.vue,QueryParamsTable.vue,RequestHeadersTable.vue,ResponsePane.vue}`
per D9/D12; `httprequest` added to `biome.json`'s cross-`views/<kind>` list (D7). Ships a working
send with status, headers and a **raw** body — complete on its own terms.

### C6 — `feat(http): JSON highlighting and beautify, in the request body and the response`
The request body's `CodeMirrorHost language="json"` plus its Beautify action, and the response's
Pretty · Raw toggle over `scanJson`/`beautifyJson` (D12). No new module.

### C7 — `feat(http): status-code hints beside the response status`
C1's table wired into the response header row per D11, with `elapsedMs`, `formatBytes(bodyBytes)`,
the truncation strip and the redirect caption.

### C8 — `feat(http): a way to create a request`
D13's three affordances: `HttpStart.vue`, `CollectionsPanel.vue`, the palette entry, and the view's
`registerCommand('view.run', send)` / `registerCommand('view.refresh', send)` pair (F15).

### C9 — `test: the HTTP request tab, and the Go/TS vocabulary parity guard`
`tests/ui/http-request.spec.ts` (§6.2) and `tests/unit/go-ts-vocabulary-parity.spec.ts` (D10).

### C10 — `docs(architecture): outbound HTTP, and the op log's first non-adapter op`
`docs/ARCHITECTURE.md`: a Stack-table row for the outbound HTTP client (`net/http`, no dependency —
beside the ClickHouse adapter's existing precedent at `:217-223`); a UI-architecture paragraph for
the `'http-request'` kind and its constant `path`; a Process-model paragraph stating that the op log
now records a connectionless op kind and *why* (D3's `useRunState` argument, in one sentence); and
F19's header-order limitation recorded as a known property, not a bug.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`scripts/setup.sh` first in a fresh container — **mandatory this phase, not optional**: C3 changes a
bound service's method set, so `apps/kira-studio/frontend/bindings/**` must be regenerated or the
Vite build fails on an unresolvable import.

Two bindings-specific checks, both from `AGENTS.md`'s own warnings and F11:

1. The regenerated `httpservice.ts` must call `$Call.ByName("…bridge.HttpService.Send", …)`, not
   `$Call.ByID(<n>, …)` — a `-names`-less regeneration silently breaks **every** `tests/ui` spec at
   the first bound call of boot, surfacing as a `status-bar` selector timeout with a page-level
   `no CHANNEL_TO_FQN entry for undefined`, and nothing about the failure points at bindings.
2. The generated `Send` must take **one** argument. `bindings.go:271` sets `needsContext` from the Go
   signature and the generator is expected to omit it from the TypeScript side; if it does not, the
   fallback is one line — drop the parameter and pass `context.Background()` to `RunOp`, losing only
   the window-close abort (D3).

### 6.2 The new UI spec — `tests/ui/http-request.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked
(`docs/ARCHITECTURE.md:1192-1207`). Per F16 a channel answers args-blind only when it has exactly
one snapshot, so this is **three tests**, one `httpSend` snapshot each:

1. **Send and read a JSON response.** From Http mode, click **New request**; assert a tab appears in
   the Http strip and `[data-testid="http-request-view"]` mounts. Fill the URL, click Send. Assert
   `[data-testid="http-status"]` reads `200`, carries `.ok`, and that the body pane shows the
   pretty-printed JSON (indented) while **Raw** shows the compact bytes exactly as the fixture sent
   them. Switch to the Headers pane and assert a known header row. Assert `IPC.tabsSave` was called
   (opening a tab persists) and that the request's own args carried the method, URL and headers the
   builder shows.
2. **A 404 shows its hint.** Same flow with a `404` snapshot: `[data-testid="http-status"]` reads
   `404`, carries `.err`, and `[data-testid="http-status-hint"]` contains the table's own sentence.
3. **Restore.** Seed `IPC.tabsList` with an `http-request` tab whose `state_json` carries a method,
   URL, one header and a JSON body. Assert on boot that Http mode is active (`hydrateTabs`'s boot
   mode derives from the restored active tab's kind, `state/tabs.ts:189-190` — a property P1 built
   and P2 is the first phase that can actually observe), that the builder shows all four values, and
   that **no reconnect gate and no response pane content** are rendered (D6).

Also assert in test 1 that a Params-table edit rewrites the URL and that typing in the URL updates
the table without rewriting it (D9's rule).

### 6.3 The Go test, and what it deliberately does not cover
`internal/httpclient/client_test.go` against `net/http/httptest`. It exists because `Send` is a
decision structure with several interacting rules over a real protocol — `AGENTS.md`'s own
"parser/splitter with several interacting rules" category — not because it is a CRUD round-trip.
Five cases, one per rule that is genuinely easy to get wrong:

1. a `301`→`302`→`200` chain: the body is the final one, `Redirects` has two hops with their real
   statuses and URLs, and `FinalURL` is the last;
2. a response larger than the cap: `BodyTruncated` is true, `BodyBytes` reports what was read, and
   the reader is not left open;
3. a body of invalid UTF-8: `BodyEncoding == "base64"` and the bytes decode back byte-identical;
4. a server that never responds: the context deadline fires as `E_TIMEOUT`, and a cancelled context
   as `E_CANCELLED` — the two that must not be conflated, since one is a failure and one is the user;
5. a user-supplied `Host` header actually reaches the server as the request's `Host` (F20a).

**Explicitly not tested:** that a GET returns 200, that the status-hint table maps 404 to its own
string, that the method enum rejects an unknown method. Each is a lookup or a one-condition guard —
`AGENTS.md`'s "everything else gets nothing".

### 6.4 What only a real Mac and a real network can settle
1. A real request to a real host over the shipping desktop transport (the custom URI scheme, not
   `-tags server`) — F12 argues from the 20-second held stream poll that a 30-second bound call
   cannot block the control plane, but the argument is from the design, not from a measurement.
2. **Stop, mid-flight, against a genuinely slow endpoint**: the op-log row flips to `cancelled`, the
   ring clears, and no goroutine is left holding the socket.
3. The Operations panel's own **Cancel** on an `http` row does the same thing (D3's second cancel
   path, which `tests/ui` cannot exercise because it produces no op events).
4. Closing a window mid-request aborts it (F11's `CancelWindowCalls`, only reachable with a real
   Wails window).
5. A `https://` URL with a bad certificate is refused, visibly, with a legible message (D4).
6. `HTTPS_PROXY` in the environment is honoured (D4's `ProxyFromEnvironment`).

### 6.5 What must not regress
- **Studio renders identically.** C4's two corrections are the only edits to shared chrome, and
  their guard is the existing suite passing **with no spec edits**.
- **`tests/ui/mode-switch.spec.ts` passes unedited.** It asserts `http-start` is visible and the
  panel contains *"Collections"* (`:113-115`); C8 adds buttons to both without removing either.
- **The bundle keeps exactly two dynamic chunks** (`docs/ARCHITECTURE.md:28`). `TAB_VIEWS` is a
  static map and `@codemirror/lang-json` is already in the main chunk.
- **`bun run test:ipc:fe` passes unedited.** No data-plane frame, adapter or fixture changes;
  `git diff` must touch nothing under `internal/adapterhost/`, `internal/adapters/`,
  `internal/page/`, `internal/storage/migrations/` or `packages/shared/protocol/`.
- **No file under `views/**` imports `workbench/**`, no file under `http/**` imports `project/**` or
  `views/**`, and no file under `views/httprequest/**` imports another `views/<kind>/**`** —
  `bun run lint` is the check (`biome.json:66-147` plus C5's addition).
- **`docs/PERF.md` gains no budget and needs none**: an HTTP send's elapsed time is the network's,
  not the app's, and nothing here touches a budgeted path.
- **`NOTICES.md` is unchanged** — D1.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — `packages/shared/domain/http.ts`: state schema with `.default()` on every field, the
      wire mirrors, the status-hint table.
- [ ] C2 — `internal/httpclient` sends, follows-and-records redirects, truncates at the cap,
      base64s a non-UTF-8 body, and classifies its four error codes; `client_test.go`'s five cases
      green.
- [ ] C3 — `HttpService.Send` registered; `'http'` in both op-kind lists; `control.httpSend`;
      bindings regenerated via `scripts/setup.sh` with `$Call.ByName` confirmed and `Send`'s
      generated arity confirmed (§6.1).
- [ ] C4 — `OperationsPanel` reads `TAB_KINDS[...].title`; a non-SQL op's command is not SQL-highlighted;
      `ViewChrome` renders no dot for a connectionless tab; existing suite green with **no spec edits**.
- [ ] C5 — the kind in all four vocabularies; both registry entries; `openHttpRequestTab`; the view
      sends and renders status/headers/raw body; `biome.json`'s cross-kind list extended and the rule
      proven by a deliberate, reverted violation.
- [ ] C6 — JSON highlighting in both editors; request-body Beautify; response Pretty · Raw, with Raw
      byte-identical to what came back.
- [ ] C7 — the hint, the elapsed figure, the byte figure, the truncation strip and the redirect
      caption, all in the response header row.
- [ ] C8 — New request from `HttpStart`, from the panel header, and from the palette; ⌘Return and
      F5 both send, with no menu or accelerator change.
- [ ] C9 — `tests/ui/http-request.spec.ts` (three tests) and
      `tests/unit/go-ts-vocabulary-parity.spec.ts`, each passing twice in a row.
- [ ] C10 — `docs/ARCHITECTURE.md` updated (Stack row, the new tab kind, the op log's first
      connectionless op kind, F19's header-order limitation).
- [ ] §6.1's full command set green.
- [ ] §6.4's six real-hardware steps — run, or recorded as unrunnable here with what was read
      instead, in the same shape P1's own §6.3 checklist line took.

---

## 8. Open questions, handed forward

**OQ-1 — Disabled query params.** D6 makes the URL the single source of truth, which is what
removes the sync bug — and it is also why a param cannot carry an `enabled` checkbox, since a
disabled param has no representation in a URL. Postman's parity shape is a persisted
`params: {name, value, enabled}[]` alongside the URL, with an explicit merge rule. That is a real
feature with a real state-machine cost, and it belongs to whichever of P3/P4 first needs a request
serialised in full (curl generation in P5 will want it too). Recorded so it is chosen, not drifted
into.

**OQ-2 — The response body's render ceiling.** D4 caps the *transferred* body at 10 MiB. There is no
second ceiling on what `CodeMirrorHost` is asked to render, and a 10 MiB JSON document in a single
CodeMirror doc is not obviously fine. Nothing in P2 measures it; the honest fix if it bites is a
"show anyway" threshold in the response pane, not a smaller transfer cap. Related: the renderer's own
fourth cache tier is deliberately unbudgeted (`docs/ARCHITECTURE.md:526-536`), and an open HTTP tab's
response now joins it.

**OQ-3 — Binary and non-UTF-8 responses are reported, not rendered.** D4 returns them faithfully as
base64 with a byte count, and P2's viewer says so rather than showing mojibake. P7's raw inspector is
the phase that renders them; charset decoding from `Content-Type` (a `charset=iso-8859-1` body that
is *not* UTF-8 but is perfectly decodable) is the narrower sub-question, and it belongs with P7 too.

**OQ-4 — Per-request TLS-verification opt-out.** Deliberately absent (D4). Adding it needs three
things P2 has nowhere to put: a persisted per-request flag, a permanently visible badge on any
response fetched without verification, and a decision about whether it can be set globally at all.
Worth doing in the phase that has a request-settings surface; worth *not* doing before then.

**OQ-5 — Auth.** Postman's Auth tab (Basic, Bearer, API key, OAuth) is not in `docs/v1.2/SPEC.md`'s
phase table at all, though P5's row assumes a curl command's auth maps onto *something*. P2 leaves
users typing `Authorization:` by hand, which is honest but not parity. Whether auth is P3's (it is a
request-composition concern) or P4's (a credential wants to live on a collection, and its secret
wants `internal/secrets`) should be settled by whichever plan is written first — it is the one gap in
the chapter's decomposition that this phase actually noticed.

**OQ-6 — `adapterhost` now schedules an op that has no adapter.** D3 is right about the behaviour
and slightly wrong about the name: `Host`'s own doc calls it *"the scheduler and the panic boundary"*
(`host.go:73-75`), which is protocol-neutral, but it lives in a package named for database adapters
and `RunOp`'s callback still takes an `*adapters.OpCtx`. Extracting the scheduler into its own
package (`internal/opsched`) with `adapterhost.Host` embedding it is mechanical and would touch every
`RunOp` call site — real churn on the DB paths for zero behaviour change, which is the wrong trade
inside P2. Worth doing once P9 makes it three protocols instead of two.

**OQ-7 — Menu and palette wording, and a mode-aware ⌘N.** P1's own OQ-3 flagged *"Toggle Project
Panel"* (`menutemplate.go:74`) and the palette's *"Toggle project panel"*
(`shortcuts/state.ts:22`). P2 adds one more: the View menu's **Run Statement**
(`menutemplate.go:80`) and its palette twin (`shortcuts/state.ts:26`) now also drive Send in Http
mode, where the word *statement* is wrong. All three are one-word renames (*Left Panel*, *Run*) that
belong in a single deliberate pass, together with the mode-switch accelerator P1 deferred and a
mode-aware ⌘N — which is the one that is genuinely not free, since it needs a Go-side notion of the
focused window's current mode that P1 D5 deliberately did not build.

**OQ-8 — `tests/ui` cannot mock two responses on one channel in one test.** F16: a channel with more
than one snapshot matches on args, and the send's renderer-minted op id makes those args unmatchable.
P2 lives with one `httpSend` snapshot per test (§6.2), which is fine for three tests and will not be
for P6's history. The contained fix when it bites is a per-snapshot `matchIgnoreKeys: ['opId']` in
`mockRuntime.ts`'s `findSnap`, not a change to how the app mints op ids.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/frontend/src/state/tabKinds.ts`
- `/home/user/kira-studio/packages/shared/domain/tabs.ts`
- `/home/user/kira-studio/apps/kira-studio/internal/adapterhost/host.go`
- `/home/user/kira-studio/apps/kira-studio/internal/bridge/ops.go`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/theme/primitives/ViewChrome.vue`
