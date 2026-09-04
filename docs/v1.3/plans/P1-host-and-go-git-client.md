# P1 — Kira Studio host: the Wails transport, the Go git client foundation, and the harness

> **What this phase is.** The first phase of v1.3 (`docs/v1.3/SPEC.md`'s P1 row), and the one that
> proves the chapter's whole premise: that a **Go/Wails backend can be a host for the
> `git-core`/`git-ipc`/`git-ui` architecture without any of those three packages changing.** Three
> halves, and none of them is verifiable without the other two — which is why they are one phase
> rather than the source project's separate "git driver" (its P1) and "host bridge" (its P3):
>
> 1. **Go** — `internal/gitclient`: spawn discipline, cancellation, discovery behind a named
>    per-platform strategy, the 2.38 version floor, capability probing, typed error classification.
> 2. **Bridge** — a bound `bridge.GitService` and a second named Wails stream, plus the frontend
>    `Transport` implementation over them that satisfies `git-ipc`'s interface unchanged.
> 3. **Shell + harness** — `'git'` as a third `AppMode` with its own mode tab, and `git-ui` mounted
>    against a mock `Transport` with no Wails present, so host-agnostic UI behaviour is testable
>    hermetically from here on.
>
> **What does not land here.** The porcelain parsers and the paged `git log` walk (P2 — so P1 opens
> a repo and reports its identity, but renders no commits); the SlickGrid grid, the SVG graph
> column and the design-system token retarget (P3); the detail pane and diff (P4); every operation
> and its pre-flight (P5–P8); search (P9). Nothing here is half-built toward those
> (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from prose.** Base: branch
> `claude/feature-v1-3` at `2f7579a` (the three kickoff packages landed and green). File:line
> citations point at that content. The source project is read from
> `origin/import/kira-version-vscode-kickoff` — **reference material only, never merged or
> rebased**; this branch's history stays a plain fork off `claude/feature-v1-2`'s tip.
>
> **The one-sentence design.** One more bound service and one more named Wails stream, behind a
> `MessageChannelLike` adapter that `git-ipc`'s existing `createRpcClient` turns into a
> `Transport` — so the frontend gets correlation, credits and cancellation for free, and Go owns
> every process the way it already owns every database connection.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/gitclient/exec.go` | **new** — the one spawn path: env hygiene, argv discipline, `context` cancellation, stdout streaming |
| `apps/kira-studio/internal/gitclient/discovery.go` | **new** — locate git, probe version, enforce the 2.38 floor, per-platform strategy |
| `apps/kira-studio/internal/gitclient/capabilities.go` | **new** — per-repo facts: commit-graph present, sparse worktree, linked worktree |
| `apps/kira-studio/internal/gitclient/errors.go` | **new** — exit code + stderr → typed error kind |
| `apps/kira-studio/internal/gitclient/repo.go` | **new** — `rev-parse` identity, open/close, the per-repo registry and its write queue |
| `apps/kira-studio/internal/gitclient/*_test.go` | **new** — discovery, spawn hygiene, error classification |
| `apps/kira-studio/internal/bridge/git.go` | **new** — the bound `GitService` |
| `apps/kira-studio/internal/bridge/gitstream.go` | **new** — `GitStreamName` and `ServeGitStream` |
| `apps/kira-studio/internal/shell/app.go` | `RegisterGitStream`, beside `RegisterEngineStream` (`:115-119`) |
| `apps/kira-studio/main.go` | one more `application.NewService(...)` row (`:190-206`), one more stream registration (`:236`) |
| `packages/shared/domain/mode.ts` | `AppMode` gains `'git'` |
| `packages/shared/domain/tabs.ts` | `'git-graph'` joins `tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE` |
| `apps/kira-studio/internal/storage/model/tabs.go` | `RenderableTabKinds` gains the same entry (the Go/TS parity pair) |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `activeIdByMode`'s literal (`:79`) gains a `git` key |
| `apps/kira-studio/frontend/src/workbench/modes.ts` | the `git` registry entry |
| `apps/kira-studio/frontend/src/workbench/TitleBar.vue` | `MODE_ORDER` (`:10`) gains `'git'` |
| `apps/kira-studio/frontend/src/git/` | **new** — `GitPanel.vue`, `GitStart.vue`, `transport.ts`, `viewStateStore.ts`, `GitGraphView.vue` |
| `apps/kira-studio/frontend/vite.config.ts` | a `@kira/git-*` resolve alias, if workspace resolution alone proves insufficient |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts`, `mockRuntime.ts` | the `GitService` channels and their FQNs |
| `apps/kira-studio/tests/ui/git/` | **new** — the harness specs, folder-separated from Studio's and Api's |
| `docs/ARCHITECTURE.md` | the Git mode, `internal/gitclient`, the second named stream |

### 0.2 Out of scope, explicitly

- **P2–P9's own rows**, listed in the header blockquote. In particular: **no porcelain parser of
  any kind** lands here. P1 runs `git --version` and `git rev-parse`, both of which are read with
  `strings.Fields`/`strings.Split` on output whose shape is fixed and trivial — if a file under
  `internal/gitclient` in this phase's diff looks like a parser, the phase has overrun into P2.
- **The design-system token retarget.** `git-ui/src/theme/tokens.css` keeps its `--vscode-*` chains
  and their literal fallbacks; those fallbacks are exactly what makes it render standalone, which
  is what the harness needs. P3 owns the retarget.
- **Any change to `git-core`, `git-ipc` or `git-ui`.** This is not merely "unlikely" — it is the
  phase's own acceptance criterion (§7). Anything that seems to require one is a finding to record
  and discuss, not a change to make quietly.
- **A per-repo cache, eviction, or rehydration.** `git-ipc`'s `graph.stream` chunk already carries
  `source: 'git' | 'cache'`, and P1 always answers `'git'`. The cache is P2's, with the paging it
  exists to serve.
- **Any settings-surface integration.** `git-core`'s `SETTINGS` stays self-contained; §6 OQ-2
  carries the question of how `git.*` keys join `packages/shared/domain/settings` forward.

### 0.3 Ground rules

- **Studio's and Api's rendered output do not change.** Adding a third mode is additive at every
  seam it touches; the existing `tests/ui` suite is the guard.
- **Go owns every process.** No `child_process`, no `fs.watch`, no Node anywhere in the shipped
  path. This is not a preference — the source's `packages/git` is deliberately not ported as
  JavaScript (`docs/v1.3/SPEC.md`, "What deliberately does not come across").
- **Git-specific frontend code lives under `frontend/src/git/`**, and its tests under
  `tests/ui/git/`, per the module-boundary rule. `biome.json` already carries per-directory
  `noRestrictedImports` overrides for `project/**` (`:106-125`) and `http/**` (`:126-148`); `git/**`
  gets the same treatment.

---

## 1. What the tree does today

### 1.1 The three packages exist, compile, and are wired into nothing

`packages/git-core`, `packages/git-ipc` and `packages/git-ui` are real workspace members —
`bun pm ls` lists all three alongside `@kira/kira-studio-frontend`. `typecheck:packages` runs
`tsgo` over the first two and `vue-tsc` over the third; `test:unit` runs their 134 tests alongside
the app's own 252. **Nothing in `apps/kira-studio` imports any of them yet.** That is P1's job.

`git-ui`'s entire host-facing surface is one function
(`packages/git-ui/src/main.ts`): `mount(container, { transport, viewState, host })`. A host
supplies exactly three things — a `Transport`, a `ViewStateStore`, and a `HostKind`. There is no
other seam to satisfy, and no other seam to get wrong.

### 1.2 The bound-service (control-plane) path

Sixteen services are registered in `main.go:190-206`, each a plain struct embedding `appcore.Deps`
or carrying its own narrow interface field. A method is
`func (s *XService) M(ctx context.Context, args XArgs) (XResult, error)`, its error an
`*ipcerr.Error` whose `Error()` is the JSON `{"code","message"}` that `control.ts`'s `unwrap`
(`:52-79`) turns back into `err.code`/`err.message`. Bindings are generated per Go package, so a
non-`bridge` package's types get their own generated models module — meaning **`internal/gitclient`
can own its own wire types** and `bridge/git.go` can reference them rather than restating them,
exactly as `bridge/http.go` already does with `httpclient.Request`/`Response`.

Adding a service is: one file under `internal/bridge`, one row in `main.go`, one
`wails3 task common:generate:bindings`, and one import in `control.ts`. `AGENTS.md` is explicit
that `-names` is load-bearing in that regeneration; the task already passes it.

### 1.3 The data-plane (stream) path, and the fact that decides §3's transport

`shell/app.go:115-119` registers **one** named stream:

```go
func RegisterEngineStream(app *application.App, router *adapterhost.Router) {
	app.HandleStream(bridge.StreamName, func(c *application.StreamConn) {
		bridge.ServeEngineStream(router, c)
	})
}
```

`bridge.StreamName` is `"engine"` (`bridge/stream.go:27`), and `frontend/src/bridge/port.ts:33`
opens it with `Stream('engine')`.

**Wails keys stream handlers by name.** Read directly from the pinned module
(`v3@v3.0.0-beta.16/pkg/application/stream.go:719-726`):

```go
func (a *App) HandleStream(name string, handler StreamHandler) {
	...
	a.streams.handlers[name] = handler
}
```

`handlers` is a map. **A second named stream is supported, costs nothing, and needs no change to
the first** — which is what makes §3's decision cheap rather than a trade.

`bridge.StreamSession` (`stream.go:12-16`) is a two-method interface (`Send([]byte) error`,
`Receive() ([]byte, error)`) that `*application.StreamConn` satisfies structurally, which is how
`internal/bridge` still imports no Wails. Git's stream reuses that shape verbatim.

### 1.4 The mode seam P1 of v1.2 built, and what a third mode costs

`state/mode.ts` is the whole mode mechanism: `modeState.active`, `setMode`, and `tabsForMode` as a
filter over the one tab list. Its own comment is the important part — *"mode is a derived view over
the one tab list, not a second state tree … switching mode touches no TabRecord, schedules no save,
issues no IPC."* A third mode therefore costs no migration and no storage change.

The concrete edits are five, and one of them has teeth:

1. `AppMode` (`packages/shared/domain/mode.ts:3`) — a two-member union today.
2. `MODES` (`workbench/modes.ts:20-23`) — a `Record<AppMode, ModeDef>`, so **adding to the union
   without adding here is a type error**, not a runtime surprise.
3. `MODE_ORDER` (`TitleBar.vue:10`) — a plain array, and the one edit the type system will *not*
   force. A `git` mode absent from it is a mode with no tab.
4. `activeIdByMode` (`state/tabs.ts:79`) — the object literal
   `{ studio: null, http: null } as Record<AppMode, string | null>`. **The `as` cast is what makes
   this the second silent failure**: adding `'git'` to `AppMode` leaves this literal type-correct
   while `activeIdByMode.git` is `undefined` at runtime. It must be edited by hand.
5. `TAB_KIND_MODE` (`packages/shared/domain/tabs.ts:42+`) — a `Record<TabKind, AppMode>`, total, so
   a new tab kind is forced to declare its mode.

`tabs.ts:16-17`'s own comment names the Go-side parity trap: `RENDERABLE_TAB_KINDS`,
`TAB_KIND_MODE` and Go's `model.RenderableTabKinds` must move together, and the Go one is *"the one
silent failure mode of the four"*. `tests/unit/go-ts-vocabulary-parity.spec.ts` exists to catch it.

### 1.5 The harness mechanism already exists and is not a mock of Wails

`tests/ui/support/mockRuntime.ts` serves **the real Wails runtime bundle** — resolved from the
pinned module via `go list -m -f '{{.Dir}}'` and read out of
`internal/assetserver/bundledassets/runtime.js` (`:14-31`) — under `/wails/`, then intercepts
outbound bound calls by their `$Call.ByName` FQN through `FQN_SUFFIX_BY_IPC_KEY` (`:37+`).
`mockStream.ts` does the equivalent for the `engine` stream, injecting pre-encoded frames.

**This is a stronger harness than the source project's**, and it is worth saying why rather than
treating it as merely equivalent: the source's `apps/harness` mounted `packages/ui` against a
hand-written mock `Transport`, which proves the UI needs no host but exercises none of the real
transport code. This repo's mechanism runs the app's *real* runtime, *real* bindings and *real*
frame codec against scripted responses. P1 wants **both**, for different jobs — see §4 D5.

---

## 2. Findings that shaped this plan

**F1 — The ports layer really did have no UI consumer.** Re-checked directly against the source
before dropping it: `packages/ui` and `apps/harness` together import exactly eleven symbols from
`core` (`CommitRecord`, `CommitStore`, `DEFAULT_PALETTE_SIZE`, `DecorationRef`, `LayoutRequest`,
`LayoutResponse`, `SETTINGS`, `UNRESOLVED_ROW`, `defaultSettings`, `layoutAppend`,
`layoutTransferList`) and **zero** ports. So collapsing `ProcessRunner`/`FileWatcher`/`Dialogs`/
`Storage`/`Theme`/`WorkspaceRoots`/`Logger` into Go interfaces costs the UI nothing, and the
capability seam survives — in Go, where the capabilities now live.

**F2 — `git-ui` genuinely bundles, not just typechecks.** A throwaway Vite lib build over
`packages/git-ui/src/index.ts` transformed 72 modules, emitted `layout.worker` as its own chunk,
and resolved `@vscode/codicons`' CSS. The module worker uses Vite's documented
`new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })` form
(`graph/layoutClient.ts:69`), which this repo's Vite 8 build handles natively. **The open risk is
not bundling but CSP** — see F3.

**F3 — the worker's CSP clearance does not transfer, and this is the phase's real technical risk.**
`layoutClient.ts`'s comment originally claimed a module worker was confirmed to load under a VS
Code webview's `worker-src` directive. That is a fact about a different webview. This app is
Wails/WKWebView with its own asset server; the comment was rewritten at kickoff to say the
confirmation must be re-established here, and **this phase is where it gets established.** The
mitigation is already designed in and needs no new structure: `createLayoutClient` takes a
`workerFactory` parameter precisely so a main-thread chunked fallback is a one-file change. §5 C7
schedules the check early enough that discovering a problem does not strand the phase.

**F4 — this repo and the source agree on versions to an unusual degree.** `slickgrid@5.20.0`,
`@vscode/codicons@0.0.46-24`, `vite@8.2.2`, `vue-tsc@3.3.11` and `typescript@6.0.3` are already
pinned here at exactly what the source used. So P3's retarget is a token-mapping exercise rather
than a component migration, and P1 inherits no version-skew work at all.

**F5 — Go 1.27, and `os/exec` cancellation has the shape this needs.** `go.mod` pins `go 1.27.0`.
`exec.CommandContext` kills the process when the context is cancelled, and `Cmd.Cancel`/
`Cmd.WaitDelay` allow a graceful-then-forceful stop — which is what a long-lived `git log` needs at
P2. P1 establishes the pattern; P2 leans on it.

**F6 — `internal/httpclient` is the right structural model, and `internal/postman` the right
testing model.** `httpclient` is five files, zero non-stdlib dependencies, `client.go` +
`errors.go` + `body.go` with colocated tests — the same shape `gitclient` should take.
`internal/postman` is where the repo established building a Go test corpus from real captured
material, which is exactly what P2 does with the source's ~43 porcelain fixtures. Neither is a new
paradigm to invent.

---

## 3. The transport: a second named stream, not a widened first one

Three options were considered for how `git-ipc`'s `Transport` reaches Go.

**Option A — reuse the `engine` stream with new frame kinds.** Rejected. It couples Git's data
plane to Studio's `adapterhost.Router` and its FlatBuffers page codec, both of which are about
database result pages and neither of which Git needs. It is also precisely the coupling
`docs/v1.3/SPEC.md`'s module-boundary section exists to prevent: "if this app were ever split into
two apps, pulling Git out would be a mechanical move".

**Option B — bound-service requests plus `Events` for stream chunks.** Rejected, though it is the
cheapest to write. Wails' event bus is a broadcast channel with no backpressure, and
`git-ipc`'s stream contract is explicitly credit-based (`rpc.ts`'s `INITIAL_STREAM_CREDIT = 2`,
"never so much that a slow consumer lets a 100k walk queue unbounded buffers into it"). Building
Git's graph stream on a mechanism that cannot express backpressure would discard the one property
the streaming design exists for, at exactly the scale it matters.

**Option C — a second named Wails stream, `"git"`. Chosen.** §1.3 establishes it costs nothing:
`HandleStream` is a map insert, `bridge.StreamSession` is a two-method interface Git can reuse
verbatim, and `shell.RegisterGitStream` sits beside `RegisterEngineStream` as a sibling rather than
a modification. Git's stream carries `git-ipc`'s own frames, so:

- **Go implements the server half of `git-ipc`'s frame protocol** — `req`/`res`/`evt`/`open`/
  `chunk`/`end`/`credit`/`cancel`, wrapped in the versioned envelope. This is genuinely new Go
  code, and it is the honest cost of choosing C over B.
- **The frontend implements a ~30-line `MessageChannelLike`** over `Stream('git')` and hands it to
  `git-ipc`'s existing `createRpcClient`, which returns a `Transport`. Correlation, credit
  accounting, cancellation and ordering all come for free from code that is already tested
  (`packages/git-ipc/src/rpc.test.ts`, 426 lines). **The frontend writes no protocol logic.**

**The one thing C costs that A and B do not**, and it must be stated plainly rather than
discovered: `git-ipc`'s codec uses `ArrayBuffer` transfer lists, which are a structured-clone
concept. A Wails stream carries bytes. So the packed commit chunk cannot be *transferred* across
this boundary the way it is between a worker and the main thread — it arrives as bytes and is
adopted into typed-array views over the received buffer. That is the same shape this repo's own
FlatBuffers data plane already uses (`port.ts:35`'s `binaryType = 'arraybuffer'`, decoded as views
over the received bytes), so it is a known-good pattern here, not a compromise. **The
worker-boundary transfer inside the renderer — which is the one §5.5 of the source spec actually
budgets for — is unaffected.** P2, which is the first phase to send a real chunk, is where the
byte framing for `PackedCommitChunk` gets designed; P1 defines the envelope and proves a
request/response and an event cross.

`app.init` reports `host: 'kira-studio'`, which is why that `HostKind` member exists.

---

## 4. Decisions

**D1 — `internal/gitclient` owns its own wire types; `bridge/git.go` is a thin adapter.** Following
`bridge/http.go`'s precedent exactly: the service struct embeds `appcore.Deps`, validates its args,
maps errors to `ipcerr`, and delegates. Bindings generate `gitclient`'s types into their own models
module, so nothing is restated.

**D2 — the capability seam moves to Go interfaces, and is written as interfaces from the first
commit.** The source's ports are not being deleted so much as relocated: `gitclient` declares
`Runner` (spawn), `Watcher` (filesystem notification) and `Clock` as small interfaces, with one real
implementation each and a fake for tests. This is what makes discovery, spawn hygiene and error
classification unit-testable without a real repository, and it matches how `internal/adapters`
already expresses its own contract. Writing them as interfaces later, after concrete calls have
spread, is the refactor this avoids.

**D3 — discovery keeps the named-per-platform-strategy shape, with only macOS implemented.**
Inherited scope, confirmed rather than assumed (`docs/v1.3/SPEC.md`). In Go this is an interface
with a `darwin` implementation selected on `runtime.GOOS`, and Windows/Linux as explicit cases
returning a "platform not supported yet" error. The macOS probe order is `git.path` setting →
`PATH` → `/opt/homebrew/bin` → `/usr/local/bin` → `/usr/bin/git`, and the last one carries the trap
worth restating: **running `/usr/bin/git` when Command Line Tools are not installed pops a system
install dialog**, so probe `xcode-select -p` first and never spawn the shim blind. Note the source's
resolution order had a second entry, "VS Code's own `git.path` setting" — that has no analogue here
and is dropped, not replaced.

**D4 — the 2.38 floor is a blocking state, not a degraded mode.** `git-ui` already renders it:
`components/GitBlockedPanel.vue` and `gitBlockedCopy.ts` handle `notFound`/`tooOld`/`unusable` and
name the detected version, the required version and the platform's upgrade command. Go's job is
only to produce the right `GitStatus` discriminant. **This is the phase's cheapest and most
visible proof that the port worked** — a UI written for a different host renders a real Go-produced
state with no change to it.

**D5 — two test tiers, because they prove different things.** Both, not one:
- **`tests/ui/git/` against the real runtime** (`mockRuntime.ts` + a `mockGitStream.ts` sibling) —
  proves the *host* works: real bindings, real FQN dispatch, real frame codec.
- **A mock-`Transport` harness** — mounts `git-ui` with a hand-written `Transport` and no Wails at
  all, proving the *package boundary* is real. This is the source project's `apps/harness` property,
  and per `docs/v1.3/SPEC.md` it is why these are packages. It is ~50 lines given `mount()`'s
  three-argument surface, and it is the tier P3–P9 will actually live in, since inducing an error,
  an auth failure or a conflicted repository is trivial against a mock and painful for real.

Where they live is one decision to make at implementation time, not two mechanisms: prefer a
`scenario` query parameter on the existing `build:test` bundle over a second Vite app, if that
proves sufficient — see §6 OQ-1.

**D6 — the Git tab kind is `'git-graph'`, one kind, renderable.** Git mode needs exactly one tab
kind in P1. Naming it for the surface rather than the mode leaves room for `'git-diff'` or
`'git-search'` later without a rename, and keeps the `TAB_KIND_MODE` mapping honest.

**D7 — `git-ui`'s `ViewStateStore` is backed by this app's existing per-window layout storage, not
by a new table.** `git-ui` defines the interface and ships `InMemoryViewStateStore`; the host
supplies the persistent one. `LayoutService`/`TabsService` already persist per-window UI state into
`kira.sqlite`, so Git's view state joins that rather than inventing storage — consistent with
v1.2's P4 decision to keep collections in the existing database rather than add a paradigm.

**D8 — no `scripts/gen-lane-palette.ts` port.** The source generated its lane-colour block into the
token CSS and checked it in CI. The generated block is already present in
`packages/git-ui/src/theme/tokens.css`, and the generator's inputs (contrast against the *host's*
editor background) change completely under P3's retarget. Porting it now would mean porting it
twice. P3 decides whether it is worth having at all.

---

## 5. Implementation order

Commits land incrementally. Fast checks (`typecheck`, `lint`, `go build`) run per commit; the
expensive `test:ui` suite runs once near the end, per `AGENTS.md`.

| # | Commit | Why here |
|---|---|---|
| **C1** | `internal/gitclient`: `Runner` interface, the real `os/exec` implementation, env hygiene and argv discipline, plus its unit tests | The bottom of the stack and the only part with no dependency on anything else. Env hygiene is the thing that is invisible when wrong: `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `-c core.quotepath=false`, `--no-optional-locks` on reads. A test asserting the exact env and argv of a spawn is worth more than it looks — every later phase inherits it |
| **C2** | `internal/gitclient`: discovery, the version probe, the 2.38 floor, the macOS strategy, `GitStatus` | Depends on C1's runner and on nothing else; fakeable end to end. Produces the first thing the UI can actually render |
| **C3** | `internal/gitclient`: `errors.go` — exit code + stderr → typed kind; `repo.go` — `rev-parse` identity, open/close, the per-repo registry and write queue | Error classification before any operation exists is deliberate: retrofitting a typed error union after call sites have grown their own string matching is the refactor this avoids |
| **C4** | `bridge/git.go` (the bound service) + `main.go` registration + bindings regeneration | The first point anything is reachable from the renderer. Regenerate with `wails3 task common:generate:bindings`, never a hand-typed flag list — `-names` is load-bearing for `mockRuntime.ts`'s FQN interception |
| **C5** | `bridge/gitstream.go` + `shell.RegisterGitStream` + the Go half of `git-ipc`'s frame protocol | §3's real cost, isolated in its own commit so it can be reviewed as protocol code rather than buried in wiring |
| **C6** | `frontend/src/git/transport.ts`: the `MessageChannelLike` over `Stream('git')`, handed to `createRpcClient` | The renderer half of C5. Small by construction — if this file grows protocol logic, something has gone wrong upstream of it |
| **C7** | Mount `git-ui` in a bare `GitGraphView.vue` behind a dev-only route, and **confirm the module worker loads under this app's CSP** (F3) | Scheduled here, before the shell wiring, precisely because it is the phase's real technical risk. Confirming it after the mode tab, the panel and the tests are built would mean discovering a fallback is needed with the phase already spent |
| **C8** | The mode seam: `AppMode`, `MODES`, `MODE_ORDER`, `activeIdByMode`, `TAB_KIND_MODE`, Go's `RenderableTabKinds`, and the parity test | One commit because §1.4's five edits are one change — and two of them (`MODE_ORDER`, `activeIdByMode`'s cast) are not type-enforced, so splitting them across commits creates a window where the tree is silently half-moded |
| **C9** | `frontend/src/git/`: `GitPanel.vue` and `GitStart.vue`, the real view-state store (D7), the `biome.json` `git/**` boundary override | The mode becomes real: a tab, a left panel, a start state |
| **C10** | The mock-`Transport` harness (D5) and `tests/ui/git/` | Last, so it tests what exists rather than what was planned |
| **C11** | `docs/ARCHITECTURE.md`: Git mode, `internal/gitclient`, the second named stream | The tree is authoritative; the doc follows it |

---

## 6. Open questions, carried forward rather than guessed

- **OQ-1 — where the mock-`Transport` harness lives.** A `?scenario=` parameter on the existing
  `build:test` bundle is cheapest and adds no build target; a separate Vite entry is closer to the
  source's `apps/harness` and keeps harness-only code out of the shipped bundle. Decide at C10
  against what the specs actually need, not now.
- **OQ-2 — how `git-core`'s `SETTINGS` joins this app's settings surface.** `packages/shared/domain/settings`
  is Zod-schema'd and persisted in `kira.sqlite`; `git-core`'s schema is deliberately independent of
  it. Options: mirror the `git.*` keys into the shared schema, or have `SettingsService` treat them
  as a namespaced sub-object. Not needed until a Git setting is user-editable, which is P3 at the
  earliest.
- **OQ-3 — whether `PackedCommitChunk` crosses as FlatBuffers or as a hand-framed byte layout.**
  This repo has FlatBuffers machinery and a precedent for it (v1.1 P11); the source packs plain
  typed arrays. P2 owns this, and should weigh it against the existing codec rather than default to
  either.
- **OQ-4 — residual `§`/`W`-prefixed cross-references in the ported packages.** Comments carried
  over from the source cite its own SPEC sections and work-item numbers, which resolve to nothing
  in this repository. Every reference that named a *file path* was fixed at kickoff; the
  section-number prose was not, since the annotations are still meaningful as history and rewriting
  ~4.5k LOC of comments would obscure the port diff. Sweep them in P10 or P11, alongside the passes
  already reading every one of these files.

---

## 7. Exit criteria

Verified by running them, not by inspection:

- [x] `go build ./apps/kira-studio/...` and `go test ./apps/kira-studio/internal/gitclient/...`
      green (also `go vet`, and every other `internal/...` package's own tests, unaffected).
- [x] `bun run typecheck`, `bun run lint`, `bun run test:unit` green (386 tests, up from 252 studio
      + 134 packages).
- [x] `bun run test:ui` green — Studio's and Api's existing specs unchanged (one spec,
      `mode-switch.spec.ts`, needed its own hardcoded "two mode tabs" count updated to three — an
      intentional, documented consequence of the third mode existing, not a behaviour change to
      Studio or Http), plus `tests/ui/git/` (9 specs, both tiers). Full suite: 113 passed, 2 failed
      on unrelated pre-existing sandbox timing flakiness (`budgets.spec.ts`/`perf.spec.ts`'s own
      cross-worker-contention caveat, already documented in those specs' own comments) — both pass
      cleanly in isolation, confirmed by rerunning them alone.
- [x] A real repository opens through the real bridge and reports its identity (root, git dir,
      common dir, bare, linked-worktree, HEAD) in Git mode — proven at two levels: `gitclient`'s
      own tests run `identify()` against real `git init`-produced repos in every shape (ordinary,
      unborn, detached, bare, linked worktree); `bridge`'s own tests
      (`TestGitStream_GraphStream_OpenRepoThenStreamEndsCleanly`) drive a real `repo.open` through
      the real frame protocol (`gitstream.go`) against a real repository end to end. No automated
      test in this sandbox drives the full real-git + real-UI stack together in one process (that
      would need `-tags server` e2e tooling this plan's own file list never named for P1) — the Go
      tests prove the backend against real git, the UI tests (both tiers) prove the frontend
      against a scripted backend; together they cover every seam, not one seam twice.
- [x] A git older than 2.38, and a machine with no git on `PATH`, each produce their blocking state
      in the UI rather than a broken panel — **driven entirely by `git-ui` code this phase did not
      touch** (D4). Covered at three levels: `discovery_test.go` (faked locator/runner, Go-only),
      `tests/ui/git/harness.spec.ts` (`git-too-old`/`git-not-found` scenarios, no Wails present),
      `tests/ui/git/real-runtime.spec.ts` (the same discriminants through the real stream).
- [x] `git-ui` mounts against the mock `Transport` with no Wails present, and the harness spec
      passes — 6 specs, one asserting zero `/wails/*` requests were even possible.
- [x] The module-worker CSP question (F3) is answered either way, in writing, with the fallback
      taken if needed. **Answered: yes, cleanly, no fallback needed** — see §8's own finding below.
- [x] **`git diff --stat` shows zero changes under `packages/git-core/`, `packages/git-ipc/` and
      `packages/git-ui/`.** Checked directly (`git status --short packages` — empty) after every
      commit that could plausibly have touched them, not assumed. No change was ever made or found
      necessary to any of the three.

---

## 8. Findings

**F3 (the module-worker CSP question) — answered: yes, cleanly, no fallback needed.** Built
`git-dev.html`/`frontend/src/git/harness/` (also C7/C10's own dev-only route and D5's harness) via
`bun run build:test` (which does emit `layout.worker.ts` as its own chunk under this app's real
Vite config, confirming F2 again) and drove it with both real webkit (the actual packaged target —
WKWebView on macOS, WebKitGTK on Linux) and chromium through Playwright: zero console errors, zero
page errors, exactly one `page.workers().length` entry in both, for any scenario that reaches
`GraphViewState`'s default `LayoutClient` construction (every scenario does, since `App.vue`
constructs it unconditionally at mount, not gated behind a repo being open). A negative control —
the identical page under a deliberately tightened `script-src 'none'` — reproduced the real
"Refused to load … because it does not appear in the script-src directive of the Content Security
Policy" violation and zero workers, which is what confirms the positive result is a genuine pass
rather than a silent detection gap. `createLayoutClient`'s `workerFactory` fallback (a main-thread
chunked pass) is therefore not needed as of P1.

**OQ-1 (where the mock-`Transport` harness lives) — resolved: the cheaper option.** A `?scenario=`
query parameter on the existing `build:test` bundle (`git-dev.html?scenario=<name>`,
`frontend/src/git/harness/{scenarios,mockTransport,main}.ts`), not a second Vite app — this also
subsumed C7's own `devMountStub.ts` (deleted at C10), since any scenario mounting `git-ui` answers
F3's own question too; there was never a reason to keep two separate dev-only mount points once the
harness existed. Six named scenarios (`git-not-found`/`git-too-old`/`git-unusable`/`no-repository`/
`repo-open-unborn`/`repo-open-branch`) cover every `GitStatus` discriminant plus both reachable
`RepoOpenResult.ok` head shapes; `tests/ui/git/harness.spec.ts` drives all six.

**`packages/git-core`/`git-ipc`/`git-ui` diff stat: zero changes, confirmed by running `git status
--short packages` after every commit that could plausibly have touched them** — the phase's own
headline claim, and it held throughout without needing a single exception.

**Deviations from the plan as written, each with its own reasoning:**

1. **§0.1's file list anticipated `tests/ui/support/ipcChannels.ts`/`mockRuntime.ts` gaining
   `GitService`'s bound-call FQNs — they were left unchanged.** `bridge.GitService`'s methods are
   real, bound, and reachable via `$Call.ByName` (registered in `main.go`, real generated
   bindings) — but the frontend never actually calls them that way: `frontend/src/git/
   transport.ts` talks exclusively over `Stream('git')`, and `bridge/gitstream.go`'s frame
   dispatcher calls the same Go methods directly, in-process, to fulfil each contract request. So
   nothing in the shipped path ever issues a bound call to `GitService`, and adding FQN entries no
   test would ever exercise would be dead registry entries, not real coverage. This is a design
   decision made at the keyboard while writing C4/C5 (§3's own "the frontend writes no protocol
   logic" already implied it, but the plan's file list hadn't caught up) — recorded here rather
   than silently deviated from.
2. **C8 and C9 landed as one commit, not two.** `workbench/modes.ts`'s `MODES` is a total
   `Record<AppMode, ModeDef>`, so C8's own mode-seam edits cannot type-check without real `panel`/
   `start` components for `'git'` to reference — `GitPanel.vue`/`GitStart.vue` (C9's own file
   list) are a compile-time requirement of C8, not an optional follow-up. Splitting them would
   have meant either a broken intermediate commit or a placeholder component thrown away one
   commit later; landing them together is the same reasoning §5 already gives for keeping C8's own
   five edits in one commit (a type-enforced dependency, not a stylistic choice).
3. **`internal/gitclient`'s three D2 interfaces (`Runner`/`Watcher`/`Clock`) all ship with a real
   implementation from C1, but `Watcher`'s real implementation (`os.Stat` polling) has no
   production caller in P1.** D2 says "one real implementation each" without saying every one
   needs a P1 consumer, and SPEC.md's own phasing table is explicit that debouncing a real watch
   into `repo.changed` is P2's row, not P1's — building the interface (and a real, if simple,
   implementation) now is what P2's first real write has somewhere to go without a refactor,
   matching D2's own stated reason for writing these as interfaces from the first commit rather
   than after the fact. `fsnotify` was considered and declined for this same reason: nothing in
   P1 depends on the watcher's latency or CPU cost, so reaching for a kernel-notification library
   against a requirement nothing in this phase states would be exactly the "hand-rolling against a
   requirement no library meets" AGENTS.md warns against — inverted (a library *without* a stated
   requirement). P2, the first real consumer, is free to replace the polling implementation
   outright once it knows what the debounce latency actually needs to be.
4. **`Repo`'s write-queue/read-pool mechanism (repo.go) is not literally "a write queue plus a
   read pool" as two independent structures — it is one reader-writer gate.** A first design (two
   separate token channels, one of size 1 for writes and one of size `maxConcurrentReads` for
   reads) was written, unit-tested, and found to have no way to make a `Write` mutually exclusive
   with a concurrent `Read` without either deadlocking (two writers each acquiring some but not
   all of a shared N-slot pool) or adding a second layer of locking on top. The shipped design — a
   `sync.Mutex`-guarded `{writing, readers}` pair with a broadcast-and-recheck channel waiters
   retry against — satisfies the same requirement (bounded concurrent reads, exclusive writes,
   ctx-cancellable) without that hazard; `repo_test.go`'s own concurrency tests are what surfaced
   the deadlock risk in the first design before it shipped.

No other deviation from the plan's own decisions (D1–D8) or implementation order (C1–C11) was
found necessary. Later phases read this section as part of the context they inherit.
