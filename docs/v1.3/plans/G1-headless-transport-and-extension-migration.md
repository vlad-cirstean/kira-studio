# G1 — Socket transport, pairing, trust store, and the extension migration

> **What this phase is.** The first phase of `docs/v1.3/SPEC.md`'s headless-git chapter: the whole
> transport between Kira Studio and an external VS Code extension, end to end, plus the extension's
> physical migration into this repo. Nothing about *git itself* beyond what `app.init` and
> `repo.open`/`repo.close` genuinely need.
>
> **In one line: Kira Studio grows a Unix-socket server at `${KIRA_HOME}/git.sock` speaking
> length-prefixed JSON — handshake, pairing-with-approval, salted-hash trust store, `rpcstream`
> over `net.Conn` — a *Connected editors* settings pane that approves and revokes, and the upstream
> extension moves into `apps/kira-studio-vscode/` + `packages/git-{ipc,core,ui}/` with `extension.ts`
> rewritten to dial that socket instead of constructing an in-process `RepoService`.**
>
> **The SPEC is authoritative and is not re-litigated here.** The transport (Unix socket, fixed
> path, no discovery), the auth model (no pre-shared file, pairing prompt in Kira Studio's own
> window, salted hash only), the version policy (hard lockstep), the package layout, and the
> phasing table are all settled in `docs/v1.3/SPEC.md` §3–§7. This plan is the *how*: the exact
> files, the exact wire bytes, the exact commit sequence, and the exact proof.
>
> **Two places where a literal reading of the SPEC collides with something else the SPEC says are
> called out and resolved explicitly, with evidence** — the `git-core` trim (§2 F16 / D14) and how
> much of the git driver `repo.open` genuinely needs (§2 F12 / D10). Neither is a deviation from a
> settled decision; both are a phase boundary the chapter spec did not draw, drawn here.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`89e911d6`, one commit
past `origin/claude/feature-v1-2`, adding `docs/v1.3/SPEC.md` and nothing else). Every claim below
was checked against source read in this container, never against prose.

| Claim | Evidence |
|---|---|
| `internal/bridge/rpcstream` **does not exist on this branch** | `ls apps/kira-studio/internal/bridge/` → 25 files, no `rpcstream/`. `git ls-tree -r --name-only <ref> \| grep -c rpcstream` is `0` for `claude/feature-v1-3-headless-git`, `origin/claude/feature-v1-2`, `main`, and every other ref **except** `origin/claude/feature-v1-3`, where it is `4` |
| `internal/gitclient` likewise exists only on `origin/claude/feature-v1-3` | same command; 19 files there, absent everywhere else |
| The four `rpcstream` files are small | `credit.go` 51 lines, `frame.go` 54, `session.go` 239, `session_test.go` 118 |
| `rpcstream`'s channel seam is exactly the two methods SPEC §2 promises | `session.go:22-25` — `type Conn interface { Send(frame []byte) error; Receive() ([]byte, error) }` |
| `rpcstream` will not compile if copied byte-for-byte | `frame.go:7` imports `…/internal/bridge/ipcerr`; on this branch that package is `…/internal/ipcerr` (`internal/ipcerr/errors.go` exists; `internal/layering_test.go:5` records the move and exists to prevent it drifting back) |
| Storage is SQLite at `${KIRA_HOME}/kira.db`, migrated forward-only | `internal/config/paths.go:11,31,41`; `internal/storage/migrate.go:12`; `internal/storage/migrations/embed.go:26-46`, whose `names` table currently ends at `{15, "p23_op_log_bytes", …}` |
| `EnsureLayout` owns a 0700 `${KIRA_HOME}` and creates only it and `logs/` | `config/paths.go:41-51` |
| Bound services are registered as a flat list in `main.go` | `main.go:215-237` — 21 `application.NewService(&bridge.XService{Deps: deps})` entries |
| Startup order is fixed and documented | `main.go:54-61` comment + `:65` `EnsureLayout` → `:68` `logging.Init` → `:73` `storage.Open` → `:78-81` `secrets.New`/`localauth.New` → `:83` `repos.New` → `:208` `application.New` |
| There is a working approval-flow precedent | `internal/localauth/localauth.go` (`Authorizer.Authorize`, a grace deadline under a mutex, injected `now`/`evaluate`/`available` seams) and `internal/connections/service.go:432` `Reveal`, which **never errors** — every outcome is a value on `RevealResult` (`:66-79`) |
| Go→renderer push is one interface, three delivery shapes | `internal/appcore/deps.go:24-27` — `Emit` (broadcast), `EmitTo(windowKey,…)`, `EmitFocused` |
| Push producers are wired once, at startup, through one `Sources` struct | `internal/bridge/events.go:52-64` and `:79-95`; channel names are the string constants at `:12-42` |
| A generic pub-sub already exists for exactly this | `internal/notify/notify.go` — `Emitter[T]` with `Subscribe(fn) (unsubscribe func())` |
| The renderer subscribes with one helper | `frontend/src/bridge/rpc.ts:64-66` — `on<T>(name, cb)` over `Events.On` from `/wails/runtime.js` |
| Settings UI is one dialog with a hard-coded section list and a draft/Save model | `workbench/SettingsDialog.vue:81` (`const sections = ['Appearance','Data','Cache','Advanced'] as const`), `:47-48` (frozen `baseline` + reactive `draft`), `:66-79` (`pendingPatch`/`isDirty`) |
| Global dialogs mount in `App.vue`, not inside a view | `App.vue:68-73` — six `v-if`-gated dialog components at the template root, incl. an always-mounted `<ConfirmDialog />` |
| The window registry can answer "is any window open", but only on the native shell | `internal/shell/registry.go:57` `Any()`, `:69` `Keys()` — populated by `main.go`'s window-creation paths only |
| A `-tags server` build serves the whole bound surface + data stream over real TCP, no window | `AGENTS.md`'s Wails section; `tests/e2e-real/fixtures.ts:66-72` (`go build -tags server`), `:133-160` (per-test `KIRA_HOME` under `tmpdir()`, per-test free port, `WAILS_SERVER_HOST=127.0.0.1`) |
| The e2e tier already isolates `KIRA_HOME` per test and refuses to run outside `tmpdir()` | `tests/e2e-real/fixtures.ts:121-126` and `:135-139` |
| Go-side layering is enforced by a test that auto-enumerates packages | `internal/layering_test.go:29-33` — every `internal/*` package must not import `internal/bridge`, except the four named composition/transport packages |
| Root workspaces are three globs, not `packages/*` | `package.json:8-12` — `["apps/*/frontend", "packages/shared", "packages/api-core"]` |
| There is **no** `tsconfig.base.json` in this repo | `ls tsconfig.base.json` → absent. Root `tsconfig.json` is a 4-line solution file (`files: []`, one reference). Each package carries a standalone `tsconfig.json` (`packages/api-core/tsconfig.json` is 13 lines, extends nothing) |
| Module boundaries are biome `noRestrictedImports` overrides, one block per directory | `biome.json:53-245` — seven override blocks; `:207` and `:227` are the two package-level ones (`packages/api-core`, `packages/shared`) |
| `flatbuffers` is already a dependency on both sides | `package.json:78` (`"flatbuffers": "25.9.23"`), `go.mod:14` (`github.com/google/flatbuffers v25.9.23+incompatible`); `scripts/generate-wire.sh` + `package.json:37` `generate:wire` already exist |
| The container's git clears the 2.38 floor | `git --version` → `2.43.0` |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`, HEAD
`0ea4cfe` "Merge P11: Search"):

| Claim | Evidence |
|---|---|
| `packages/ipc` is 13 files and depends on exactly one npm package | `packages/ipc/package.json` → `{"flatbuffers": "25.9.23"}`; sources are `contract.ts`, `rpc.ts`, `transport.ts`, `codec.ts`, `validate.ts`, `graphChunkCodec.ts`, `index.ts`, `generated/graphChunk.ts`, plus `schema/graphChunk.fbs`, two tests and a `tsconfig.json` |
| `CONTRACT_VERSION` is a single TS constant and the sole compatibility authority | `packages/ipc/src/validate.ts:7` → `export const CONTRACT_VERSION = 12;`, used by `wrapVersioned`/`unwrapVersioned` (`:32-39`) |
| The contract is 33 requests, 4 events, 1 stream | `validate.ts:59-103` — `REQUEST_KEY_MAP`, `EVENT_KEY_MAP`, `STREAM_KEY_MAP`, each a `Record<Key,true>` so a *missing* key is a compile error |
| `MessageChannelLike` is the only thing a host implements | `rpc.ts:42-47` — `{ readonly bufferEncoding; post(message, transfer?); onMessage(handler): () => void; close(): void }` |
| The frame union is exactly `rpcstream`'s | `rpc.ts:74-93` — `req/res/evt/open/chunk/end/credit/cancel`, all wrapped by `wrapVersioned` into `{version, body}` |
| The existing VS Code channel is 17 lines over `webview.postMessage` | `packages/host-vscode/src/transport.ts:30-46` |
| That channel declares base64 buffers because a `WebviewView` cannot carry an `ArrayBuffer` | `codec.ts:23-29`, `transport.ts:9-18` |
| `extension.ts` today constructs an in-process `RepoService` and two webview providers | `extension.ts:86-92` (`RepoService.create({runner, fileWatcher, logger, settings, configuredGitCandidates})`), `:102-134` (`KiraGraphViewProvider`, `KiraReviewViewProvider`, `registerWebviewViewProvider` ×2) |
| The webview seam is `createRpcServer(createWebviewChannel(webview), createRepoHandlers({service, …}))` | `panelView.ts:63-76` |
| `app.init` is answered by the host today, composing five fields | `packages/git/src/rpcHandlers.ts:256-267`; result shape at `packages/ipc/src/contract.ts:848-866` (`host`, `contractVersion`, `settings`, `git`, `capabilities{openInEditor,goToFile,clipboard,resolveConflict}`) |
| `repo.open`/`repo.close` are four lines each and delegate to `RepoService` | `rpcHandlers.ts:278-287`; result union `RepoOpenResult` at `contract.ts:732-735` (`ok`/`notARepository`/`gitUnavailable`), `RepoSummary` at `:53-61` |
| `packages/ui` depends on `core` + `ipc` only — **never** on `@kira-version/git` | `packages/ui/package.json` dependencies: `@kira-version/core`, `@kira-version/ipc`, `@vscode/codicons`, `slickgrid`, `vue` |
| `packages/core` has **no** dependencies at all | `packages/core/package.json` — no `dependencies` key |
| The extension bundles with `Bun.build`, not esbuild | `scripts/build.ts:34-41` — one `BunTarget` (`entry: packages/host-vscode/src/extension.ts`, `external: ["vscode"]`, `format: "esm"`, `target: "node"`) plus a Vite build for the UI |
| Upstream's root config is `workspaces: ["packages/*","apps/*"]` + a real `tsconfig.base.json` with project references | root `package.json:6-9`; `tsconfig.base.json` (`composite: true`, `emitDeclarationOnly: true`, `allowImportingTsExtensions`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |

### 0.2 Scope

1. Port `internal/bridge/rpcstream` from `origin/claude/feature-v1-3` (§3.4).
2. Port the read-only subset of `internal/gitclient` from the same branch — the part `app.init` and
   `repo.open` provably need, and no more (§3.2, D10).
3. Build `internal/gitsock`: listener, lock + stale-socket recovery, framing, the `rpcstream.Conn`
   adapter, the handshake state machine, the pairing broker, the live-connection registry (§3.1).
4. Add the `git_clients` table (migration 16), its repo, and salted-hash token mint/verify (§3.5).
5. Build `internal/gitrpc`: a three-entry method table (`app.init`, `repo.open`, `repo.close`) and
   the wire types (§3.3).
6. Bind `bridge.GitClientsService` and wire the *Connected editors* settings pane plus the pairing
   prompt dialog (§3.6, §4).
7. Migrate the extension: `apps/kira-studio-vscode/`, `packages/git-ipc/`, `packages/git-core/`,
   `packages/git-ui/`, plus every root-config change that makes them build, typecheck and lint
   (§5).
8. Rewrite `extension.ts` around `socketChannel.ts`: dial → handshake → `context.secrets` →
   reconnect with backoff (§5.3, §5.4).
9. Prove it (§8).

### 0.3 Not in this phase

- **Any porcelain parsing.** No `--porcelain=v2`, no `for-each-ref`, no NUL/`%x1f` record splitting,
  no golden corpus. `gitclient`'s `rev-parse`/`symbolic-ref` calls are single trimmed lines from
  queries whose shape git fixes — that is deliberately not a parser, and `gitclient/porcelain` is
  not created (G3).
- **The paged log walk, `cat-file --batch`, the commit store, `graph.stream`.** G3.
- **FlatBuffers payloads and `internal/gitwire`.** No `.fbs`, no `flatc` invocation, no generated
  git wire code (D1, §6). G3.
- **`gitclient`'s `runner.go` rewrite.** SPEC §2 states it is rewritten (not reused) because paging
  needs a `Start()` returning a live pipe. Nothing in G1 pages, so G1 ports today's buffering
  runner unchanged and G2 rewrites it (D10).
- **`fsnotify`, `repo.changed`, the refcounted `gitsession.Registry`, `RepoEntry`, `Walk`.** G2.
  G1 uses `gitclient.Registry`'s plain map as-is.
- **The seven host-capability methods answered locally by the extension** (folder pickers,
  diff-open, clipboard, "open externally", …). SPEC §5 item 2 describes them; the phasing table
  puts them in **G4** ("the seven host-capability methods wired client-side"). G1 forwards
  everything (D12).
- **The askpass credential relay.** SPEC §5 item 4; phasing table row G7.
- **Registering the two webview view providers.** Migrated, compiling, not wired into `activate()`
  until there is a graph to render (D13). G3.
- **`.vsix` packaging and DMG bundling.** SPEC §9; not a G1 row.
- **Any embedded git UI inside Kira Studio's own Wails frontend** beyond the *Connected editors*
  pane and the pairing prompt. SPEC "Out of scope for v1.3".
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. Everything this plan settles that the SPEC left open is settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md`'s rules apply in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely* — which is why §3.3's method
  table has three entries and no placeholders, and why §5.5's migrated-but-unwired files are
  unwired rather than half-wired.
- **Comments very concise, only where the code cannot say it itself** (`AGENTS.md`).
- **Tests only where the bar is met** (`AGENTS.md`: concurrency/ordering/backpressure/cancellation,
  cache/eviction rules, crypto beyond encrypt-then-decrypt, boundary arithmetic). G1 clears that bar
  in exactly three places — framing boundary arithmetic, the pairing broker's queue/timeout/cooldown
  state machine, and the handshake's branch table — and nowhere else. A CRUD round-trip against
  `git_clients` gets no test.
- **Reach for a library before hand-rolling** (`AGENTS.md`). §2 D3 records where that rule was
  applied and where it declines, with the requirement named.
- Commits are Conventional Commits, granular, landing as work completes.

---

## 1. Findings

### F1 — `rpcstream` is not on this branch and must be ported, not "reused"

SPEC §2's provenance column says `bridge/rpcstream` is *"`feature-v1-3` reused **verbatim**"*. That
is true of its *content* and false of its *location*: the branch this phase builds on does not
contain the package (§0.1, first row). G1 therefore does a real port — `git show
origin/claude/feature-v1-3:<path>` into place — not a no-op.

Exactly one edit is required for it to compile: `frame.go:7` imports
`…/internal/bridge/ipcerr`, which on this branch is `…/internal/ipcerr`. That move is
deliberate and guarded (`internal/layering_test.go:5`), so the import is fixed to the current path
and nothing else changes.

### F2 — `rpcstream`'s `Conn` seam is genuinely transport-free, and the adapter really is ~40 lines

`session.go:22-25` names two methods and nothing else. `Serve(conn Conn, h Handlers)` (`:229-239`)
is a plain `for { raw, err := conn.Receive(); if err != nil { return }; s.handleRaw(raw) }`. Nothing
in the package imports `net`, Wails, or `bridge`. A `net.Conn` adapter needs a length-prefixed
`Receive` and a mutex-free `Send` (the session already funnels every write through one goroutine,
`session.go:68-79`) — §3.1's `frame.go` is 60 lines including the max-frame guard.

### F3 — `rpcstream` has two real gaps that G1 does not need and later phases do

Read against `rpc.ts`, which it transcribes:

1. **`Handlers.Stream` receives no emitter.** `session.go:33` is
   `Stream func(ctx, method string, params json.RawMessage) error` — no `emit`. Upstream's
   equivalent (`rpc.ts:358-366`) passes `{signal, emit}`, and `emit` is where credit-based
   backpressure reaches the producer. `handleOpen` (`session.go:143-166`) constructs the credit gate
   and then never hands it to anyone: `creditGates[id]` is only ever reachable by `handleCredit`.
   **A stream handler in this package currently cannot send a chunk.**
2. **`Emit` is unreachable from production code.** `session.Emit` (`session.go:97-103`) is a method
   on the unexported `session`, and `Serve` returns nothing. Its own comment concedes this
   (`:94-96`: "P1 wires no production caller of this yet … it exists … for `gitstream_test.go`").

Neither blocks G1 (no streams, no events in a three-method request-only table). Both block G2
(`repo.changed`) and G3 (`graph.stream`). Recorded in §11 so the G2/G3 plans do not rediscover them.

### F4 — `ipcerr` is the error vocabulary `rpcstream` already speaks

`frame.go:48-54`'s `wireErrorFrom` maps `*ipcerr.Error` straight onto `{code,message}` and anything
else onto `E_INTERNAL`. `internal/ipcerr/errors.go` provides `New`, `Internal`, `BadRequest`,
`Disconnected`. So `gitrpc`'s handlers return `*ipcerr.Error` and get a correct wire error for free
— no second error taxonomy.

### F5 — `${KIRA_HOME}` is already a 0700 directory with a single owner

`config.EnsureLayout` (`paths.go:41-51`) creates `KiraHome()` and `LogsDir()` at 0700 and
**re-chmods an existing loose directory**, not only on first create. `main.go:65` calls it before
anything else. So `${KIRA_HOME}/git.sock` and `${KIRA_HOME}/git.sock.lock` inherit a 0700 parent
with no new code, and the socket file itself only needs its own 0600.

`KiraHome()` honours `KIRA_HOME` (`paths.go:11-14`), which is what makes the socket per-test
isolatable (F14).

### F6 — Migrations are a hand-ordered embedded list; adding one is two edits

`migrations/embed.go:26-46` is a `names` slice of `{version, name, file}`; `All()` reads and sorts
them; `migrate.go:49-66` applies each unapplied step in its own transaction and refuses a database
newer than the binary (`:42-47`). Adding `git_clients` is: one `.sql` file, one line in `names`.
`0015_p23_op_log_bytes.sql` is the style model — a leading comment block explaining *why*, then the
statements.

### F7 — There is a working "prompt, then act" precedent, and its shape is a value-returning gate

`internal/localauth.Authorizer` holds a `sync.Mutex`, a deadline, and three injected seams
(`now`, `evaluate`, `available`) so the whole decision table is exercised by a plain Linux `go test`
(`localauth.go:6-10` says so explicitly). `connections.Service.Reveal` (`service.go:432-454`)
**never returns an error** — every outcome is a string on `RevealResult` (`:66-79`:
`revealed`/`cancelled`/`confirmation-required`/`error`).

The pairing broker copies both properties: an injected clock, and a result that is a value
(`paired`/`denied`/`timeout`), never a Go error.

### F8 — Push to the renderer is a broadcast by default, and that is what pairing wants

`appcore.Emitter` (`deps.go:24-27`) has `Emit` (every window), `EmitTo` (one window by key), and
`EmitFocused` (the focused window). `bridge/events.go:79-95` shows the wiring shape: `Attach(Sources)`
subscribes to each producer and returns one `detach`.

`EmitFocused` is tempting for "one prompt on screen" but is wrong here: it resolves the *focused*
window, and a pairing request typically arrives while the user is focused on **VS Code**, not on
Kira Studio. So the prompt is broadcast (`Emit`) and the broker resolves it once, first responder
wins (D9).

### F9 — Nothing in the Go side can tell whether a window is open in a `-tags server` build

`shell.WindowRegistry` (`registry.go:57,69`) is populated only by `main.go`'s native window-creation
paths. A `-tags server` binary creates none, so `Keys()` is permanently empty there. Any "hold the
request if no window is open" logic keyed on that registry would (a) be untestable in this
container and (b) couple a domain package to `internal/shell`.

This is decisive for D8: "held when no window open" must fall out of the *queue*, not out of a
window census.

### F10 — The settings dialog's draft/Save model does not fit a live list with immediate actions

`SettingsDialog.vue` builds a frozen `baseline` and a reactive `draft` at creation (`:47-48`),
diffs them per leaf (`:54-64`), and only `pendingPatch` (`:66-77`) ever crosses to Go, on Save. Its
section list is a hard-coded `as const` tuple (`:81`) whose last branch is a bare `<template v-else>`
for Advanced.

A *Connected editors* pane lists rows fetched from the database and revokes one on click. Nothing
about it is a settings leaf: it has no default to reset to, no baseline to diff, and its action must
take effect immediately (a revoke that waited for Save would leave a revoked editor connected). So
it is a section in the same dialog for discoverability, but it bypasses `draft`/`pendingPatch`
entirely (D16).

### F11 — Global, always-available dialogs mount at `App.vue`'s template root

`App.vue:68-73` mounts six dialogs at the root, five `v-if`-gated on a state flag and one
(`<ConfirmDialog />`) mounted unconditionally and driven entirely by its own state module. The
pairing prompt has exactly `ConfirmDialog`'s shape — it must be able to appear without the user
having opened anything — so it follows that precedent (D17), not `SettingsDialog`'s (which only
exists while `settingsOpen` is true, `TitleBar.vue:87`).

### F12 — `repo.open` cannot be answered honestly without a git driver, and the driver already exists on the superseded branch

`repo.open`'s result is `RepoOpenResult` (`contract.ts:732-735`), whose `ok` arm carries a
`RepoSummary` (`contract.ts:53-61`): `repoId`, `root`, `gitDir`, `commonDir`, `isBare`,
`isLinkedWorktree`, `head`. `head` is a three-way union (`branch`/`detached`/`unborn`,
`contract.ts:22-25`).

`origin/claude/feature-v1-3`'s `gitclient.identify` (`repo.go:205-247`) produces every one of those
fields from four `rev-parse` calls and one `symbolic-ref`, and derives `isLinkedWorktree` with no
extra query (`gitDir != commonDir`, `repo.go:245`). `headState` (`repo.go:268-302`) decides the
three-way union from `symbolic-ref --short -q HEAD`'s exit code plus `rev-parse -q --verify HEAD`.
`Client.OpenRepo` (`client.go:43-58`) short-circuits on `GitStatus.Kind != "ok"` before spawning
anything against the path.

Every one of those calls is a **single trimmed line from a query whose shape `rev-parse` fixes** —
`repo.go:203-204` says so, and `revParseLine` (`repo.go:249-256`) is literally
`strings.TrimSpace(string(res.Stdout))`. That is not porcelain parsing, which is what the phasing
table defers to G3.

The alternative — a filesystem-only `repo.open` in G1 (stat `.git`, read the gitfile, read `HEAD`,
resolve `refs/`+`packed-refs`) — would be ~150 lines of genuinely new code that G2 **deletes** the
moment `gitclient` lands. That is throwaway work, and it is strictly worse at the job (it cannot
see `core.worktree`, `GIT_DIR`, an alternate object store, or a `commondir` indirection the way
`rev-parse` can).

### F13 — Discovery is macOS-gated in a way that produces a *correct*, assertable answer on Linux

`discovery.go:130-137`'s `unsupportedLocator` returns `("", ["git discovery is not implemented on
linux yet"], false)`, and `NewPlatformLocator` (`:139-144`) selects it for every non-darwin `GOOS`.
So a `-tags server` binary running in this container answers `app.init` with a real
`GitStatus{kind:"notFound", probed:[…]}` and `repo.open` with a real `{kind:"gitUnavailable"}`.

That is not a degraded mode — it is this platform's true answer, and it round-trips both methods
completely. The `ok` branch is still provable here, because `Discovery` is constructed from an
injected `Locator` (`client.go:27-33` calls `NewDiscovery(NewPlatformLocator(), runner, clock)`, and
`NewDiscovery` is exported): a Go test builds a `Client` over a locator that returns
`exec.LookPath("git")` and gets the real 2.43.0 binary (§0.1, last row).

### F14 — The e2e tier can already give a socket test everything it needs

`tests/e2e-real/fixtures.ts` builds `scripts/setup.sh` → `bun run build:test` →
`go build -tags server` (`:60-72`), then per test: a fresh `mkdtemp` `KIRA_HOME` (`:121-126`) that it
**refuses to run outside `tmpdir()`** (`:135-139`), a free port, and a spawned binary with
`KIRA_HOME`, `KIRA_INSECURE_SECRETS=1`, `WAILS_SERVER_HOST=127.0.0.1` (`:142-156`), then a plain
Playwright page against it (`:186-193`).

Because the socket path is `${KIRA_HOME}/git.sock` (F5), a spec gets a private socket per test with
no new fixture machinery, and can drive it from Node with `net.connect` **while** clicking Approve
in the same test's browser page. That is the full pairing round trip, automated, here (§8.1).

### F15 — `packages/ui` needs `core`, never `git` — so `git-ui` is portable in isolation

`packages/ui/package.json`'s dependencies are `@kira-version/core`, `@kira-version/ipc`,
`@vscode/codicons`, `slickgrid`, `vue`. `packages/core/package.json` has **no** dependencies at all.
So the three migrated packages form a closed graph (`git-ipc` ← `git-core` ← `git-ui`) that never
reaches `@kira-version/git` — the package whose replacement is Go and which is therefore **not**
migrated at all.

The only importer of `@kira-version/git` is `packages/host-vscode` (`extension.ts:13-18`,
`panelView.ts:20-21`, `reviewView.ts`), and those are exactly the files G1 rewrites.

### F16 — `packages/ui` imports from `core/preflight/*`, so "drops `preflight/*`" cannot land in G1

SPEC §5's table says `packages/git-core` **"Drops `preflight/*` and `undo/*` — now server-side"**,
while the row directly below says `packages/git-ui` is **"Unchanged."** Grepping `packages/ui/src`
for `@kira-version/core` imports finds, among others:

- `validateRefName` — four call sites. Exported from `core/src/index.ts:136`, sourced from
  `preflight/tag.ts`.
- `classifyReset` — one call site (`import { canRunOp, classifyReset } from "@kira-version/core"`).
  Exported from `index.ts:133`, sourced from `preflight/reset.ts`.
- `core/src/index.ts:156` re-exports types from `preflight/types.ts`.

So both SPEC statements cannot be true simultaneously today. They are reconcilable — client-side
ref-name validation and a locally-recomputed reset classification are exactly the kind of thing G5/G9
would move or duplicate deliberately — but **G1 has no information with which to make that call**,
and making it wrong breaks `git-ui` at typecheck. D14 resolves it.

`undo/*` has no `packages/ui` importer (only `core/src/index.ts:189-190` re-exports it), so it is
droppable in isolation — but dropping half a pair for no benefit is churn, so it travels with
`preflight/*`.

### F17 — The version handshake needs one number that two languages agree on, and TS already owns it

`CONTRACT_VERSION` is `packages/ipc/src/validate.ts:7`, a plain `export const … = 12`, and
`wrapVersioned`/`unwrapVersioned` (`:32-39`) put it on and take it off every frame. `rpcstream`
already carries the same field (`frame.go:38-41`'s `envelope{Version,Body}`) and drops any frame
whose version disagrees (`session.go:196-200`).

So the wire mechanism exists on both ends already. What does not exist is a way for Go to *know*
the number. There is no codegen path from TS to Go and building one for a single integer is not
proportionate — so the Go side declares its own constant beside a comment naming the TS file, and
the handshake makes a mismatch a loud, named failure rather than a silent drop (D20). This is the
same "structural copy, kept honest by both sides reading one source" convention `contract.ts:6-11`
and `gitclient/settings.go:3-7` already use.

### F18 — Bundling the extension is `Bun.build`, and this repo already has Bun

`scripts/build.ts:34-41,50-58` bundles `extension.ts` with `Bun.build({target:"node",
format:"esm", external:["vscode"]})`, writing `result.outputs` itself. This repo's package manager
*is* Bun (`docs/ARCHITECTURE.md`'s Stack table) and its `scripts/` are `sh` + one `generate-wire.sh`.
So the extension build is a small new script in the same style, not a new toolchain.

---

## 2. Decisions

### D1 — G1's frame body is length-prefixed **JSON**, not FlatBuffers, and that is a decision, not an omission

**4-byte big-endian unsigned length, then that many bytes of UTF-8 JSON.** Max frame 8 MiB in G1;
a longer prefix is a hard connection error, not a truncation.

Justified by F-nothing — justified by *scope*. `docs/v1.3/SPEC.md` §4.2 settles that bulk
response/stream payloads become FlatBuffers with the `"KIG1"` file identifier, and that
request/control frames **stay JSON text**. G1 sends and receives *only* request/control frames: a
handshake exchange, and `req`/`res` for three methods whose largest payload is a `RepoSummary`
(seven short strings). There is no bulk payload in this phase to encode, so introducing `gitwire`,
a `.fbs`, and a `flatc` invocation here would build a decoder with nothing to decode.

Recorded explicitly so no later reader mistakes it for an oversight, and so G3's own plan knows the
framing layer it inherits was designed to carry binary from day one (§6).

### D2 — Big-endian, 4 bytes, over any self-delimiting alternative

Considered and declined: newline-delimited JSON (needs escaping discipline and makes a future
binary payload impossible without a second framing), `netstring` (same length arithmetic, an extra
delimiter to validate), and a varint prefix (saves 3 bytes on a ~200-byte frame and costs a
hand-rolled decoder). A fixed 4-byte big-endian prefix is what `encoding/binary.BigEndian` and
Node's `Buffer.readUInt32BE` both do in one call on each side, and it carries arbitrary bytes
unchanged, which is precisely what §6 needs.

**No library is used for the framing.** `AGENTS.md` requires naming the requirement when declining
one: the requirement is that the *same* framing be implemented twice, once in Go and once in
TypeScript, with byte-identical behaviour and no shared runtime — and there is no single library
present in both dependency graphs that does this. Each side is ~40 lines against `binary.BigEndian`
/ `Buffer.readUInt32BE`, and §8.1's round-trip test is what keeps them identical.

### D3 — `flock` is `syscall.Flock`, not a new dependency

`golang.org/x/sys` is currently an **indirect** dependency (`go.mod:119`). Promoting it to direct
for one call is unnecessary: `syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)` exists on darwin
(the only shipped platform) and on linux (where the tests run), which is the whole set of platforms
this code ever executes on. The lock file handle is held open for the process's lifetime — closing
it releases the lock — so it is stored on the `gitsock.Server` and closed only in shutdown.

### D4 — Port `rpcstream` verbatim except the one import, and do not fix its two gaps here

F1's import fix is mandatory. F3's two gaps (`Stream` has no emitter; `Emit` is unreachable) are
**not** fixed in G1: G1 registers no stream handler and emits no event, so a fix here would be code
with no caller, which `AGENTS.md`'s "scope left out is left out entirely" forbids as squarely as a
stub does. Both are handed to G2/G3 in §11 with the exact shape the fix should take.

`session_test.go` ports with it. Its two credit-gate tests clear `AGENTS.md`'s bar (a counting
semaphore's grant/acquire ordering and its cancellation path); `TestSession_Emit_EventCrosses` is
kept because it is the only thing that exercises the `evt` encode path at all, and deleting it would
leave `Emit` both unreachable *and* unproven.

### D5 — The socket, the lock, and the recovery sequence, exactly

At startup, after `config.EnsureLayout` and `storage.Open`:

1. `os.OpenFile("${KIRA_HOME}/git.sock.lock", O_CREATE|O_RDWR, 0o600)`.
2. `syscall.Flock(fd, LOCK_EX|LOCK_NB)`.
   - **`EWOULDBLOCK` → another instance is serving.** Close the fd, log once at `info`, **do not
     listen**, and continue booting. This is not an error: SPEC §3.2 says "this instance does not
     listen", and a second Kira Studio window/instance is a supported state.
   - **Any other error →** log at `warn`, do not listen, continue booting. The app must never fail
     to start because the git socket could not.
3. Lock held ⇒ any existing `git.sock` is a crash leftover. `os.Remove` it (ignoring
   `os.IsNotExist`), then `net.Listen("unix", path)`.
4. `os.Chmod(path, 0o600)` immediately after `Listen` — Go applies the process umask to the socket
   inode, so the mode is set explicitly rather than assumed. The 0700 parent (F5) is the real
   boundary; this is defence in depth.
5. Accept loop in its own goroutine.

**Unlinking before listening is safe under the lock and only under the lock** — that is the entire
reason the lock exists, and why the lock file is a *separate* path from the socket (a lock on the
socket inode would be destroyed by the very unlink it is meant to guard).

On shutdown: `listener.Close()` (which unlinks the socket, since Go's `net.UnixListener` does so by
default), close every live connection, then close the lock fd.

### D6 — Token: 32 `crypto/rand` bytes, base64url on the wire, `sha256(salt‖token)` at rest

SPEC §3.3 fixes the storage side; this fixes the rest:

- Mint: `crypto/rand.Read(make([]byte, 32))`. A short read or error is a hard failure of the pairing
  request (result `denied`, reason `error`), never a weaker token.
- Wire form: `base64.RawURLEncoding` — JSON-safe, no padding, no escaping, and the same string the
  extension puts into `context.secrets`.
- Salt: a second 16 `crypto/rand` bytes per client.
- At rest: `sha256.Sum256(append(salt, token...))` as `token_hash BLOB`, `salt` as `token_salt BLOB`.
- Verify: recompute and compare with `subtle.ConstantTimeCompare`.
- Client id: the extension supplies it in `hello.client.id`. It is **not** trusted as an
  authenticator — it selects the row, the token proves the claim. A `hello` whose `client.id` has no
  row, or whose token fails `ConstantTimeCompare`, or whose row has a non-null `revoked_at`, all take
  the identical `tokenRejected` path in the identical amount of work: the row lookup happens first,
  and a miss compares the presented token against a fixed dummy hash so a missing client and a wrong
  token are not distinguishable by timing.

This clears `AGENTS.md`'s "crypto beyond encrypt-then-decrypt" test bar, so mint/verify/revoke gets
one focused test (§8.1).

### D7 — Migration 16, `git_clients`, exactly the SPEC's columns

`internal/storage/migrations/0016_g1_git_clients.sql`, plus `{16, "g1_git_clients",
"0016_g1_git_clients.sql"}` appended to `embed.go`'s `names` (F6):

```sql
CREATE TABLE git_clients (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   BLOB NOT NULL,
  token_salt   BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX git_clients_last_seen ON git_clients(last_seen_at DESC);
```

Timestamps are epoch-millisecond integers, matching every other table in this schema. `revoked_at`
is nullable because "not revoked" is genuinely the absence of a revocation, not a sentinel.
`label` is what the *Connected editors* pane shows and comes from `hello.client.label`; it is
**clamped to 200 bytes on write** — the pane renders it, and an unbounded client-supplied string
into a table this app displays is the kind of thing `AGENTS.md`'s "no skipped validation" covers.

### D8 — The pairing broker is a queue with an injected clock; "no window open" is not a state it knows about

The broker owns: a FIFO of pending requests, at most one of which is *presented*; a per-`clientID`
cooldown map; an injected `now func() time.Time`; and a `notify.Emitter[PairingQueue]`.

- `Request(clientID, label) → outcome` blocks the calling connection's goroutine until resolved.
- Enqueue; if this is the head, mark it presented and emit the queue snapshot.
- Each request carries its own 120 s deadline **from the moment it was enqueued**, not from the
  moment it was presented. A request queued behind three others still times out 120 s after it
  arrived — the extension is waiting on a socket the whole time, and stretching its wait because
  other editors are also waiting would be worse, not better.
- Resolution (`paired`, `denied`, or `timeout`) pops the head, starts the next one, and emits again.
- `denied` — and only `denied` — writes `cooldownUntil[clientID] = now + 60s`. A `Request` arriving
  inside a live cooldown is answered `denied` immediately, without enqueueing and without emitting.
  A `timeout` does **not** set a cooldown: the user never expressed an opinion, and punishing a
  reconnect for the user having been away from the machine is the wrong reading of SPEC §3.3's
  "so a reconnecting extension cannot re-prompt in a loop".

**"A request arriving with no Kira Studio window open yet is held, not auto-denied" (SPEC §3.3)
falls out of this with no window census** (F9): the request sits at the head of the queue, presented,
emitting into a channel nobody is listening on, until it is answered or its 120 s expires. A window
that opens later calls `GitClientsService.PendingPairing()` on mount and renders whatever is at the
head. That is both the correct behaviour and the only one testable in a `-tags server` build.

This is the phase's one genuinely intricate piece of state (queue ordering × per-request deadlines ×
cooldown × concurrent resolution) and it gets a real test (§8.1).

### D9 — The prompt broadcasts; the first window to answer wins

`Emit` (broadcast), not `EmitFocused` — F8's reasoning: the user is normally focused on VS Code when
the request arrives, so "the focused window" is frequently no Kira Studio window at all.

Every open window therefore shows the same prompt. `Approve`/`Deny` are idempotent by request id:
the broker resolves a given `requestID` exactly once (guarded by the same mutex that owns the
queue) and a second call returns "already resolved" as a value, not an error. Every window's prompt
then re-renders from the next emitted snapshot — the loser's dialog closes on its own, showing no
error, because nothing went wrong.

### D10 — G1 ports the read-only subset of `internal/gitclient`, and G2 owns the rest plus the runner rewrite

**The tension, stated plainly:** the SPEC's phasing table puts the whole "Driver foundation" in G2,
*and* requires G1 to be "proven end-to-end on `app.init`/`repo.open` alone". F12 shows `repo.open`'s
result cannot be produced honestly without a driver. One of the two rows has to give.

**Resolution: G1 takes exactly the files its own exit criterion provably requires, unchanged, from
`origin/claude/feature-v1-3`** — `clock.go`, `errors.go`, `discovery.go`, `capabilities.go`,
`settings.go`, `runner.go`, `repo.go`, `client.go`, and their existing tests
(`discovery_test.go`, `errors_test.go`, `capabilities_test.go`, `repo_test.go`, `runner_test.go`).
`watcher.go`/`watcher_test.go` are **not** ported: SPEC §6 replaces that file's `os.Stat` polling
with `fsnotify` in G2, so porting it would be porting something already scheduled for deletion.

**What G2 still owns, undiminished:** the `runner.go` rewrite (SPEC §2: *"`runner.go` is rewritten,
not reused — it buffers to `[]byte`; the paged `git log` design needs a `Start()` returning a live
pipe"*), the `fsnotify` watcher and `repo.changed`, `gitsession.Registry`'s refcounting and
`RepoEntry`/`Walk` split, the 2.38 blocked-state surfaced through the extension's UI, and the
per-repo write-queue/read-pool being exercised by an actual write. G1 ports the gate
(`repo.go:84-140`) because `Client.OpenRepo` needs `Repo` to exist; it drives no write through it.

This is the smallest amount of driver that makes G1's stated exit criterion real, and none of it is
work G2 redoes — G2 *replaces* one file (`runner.go`) that the SPEC already promised to replace.

### D11 — The server contract is the webview contract minus the host-capability methods, and `app.init` is a partial

SPEC §2: `gitrpc` is *"Port of `rpcHandlers.ts`, **minus** the seven host-capability methods the
extension now answers locally"*. So there are two contracts, deliberately:

- **The webview contract** — `packages/git-ipc/src/contract.ts`, unchanged, 33 requests. The
  extension host serves it to the webview.
- **The server contract** — what crosses the socket. The webview contract minus the seven, with
  `app.init`'s result narrowed to the fields a server can know.

`app.init` on the socket returns `{contractVersion, serverVersion, git}` — **not** `host`,
`capabilities` or `settings`, all three of which are properties of the *editor*, not of Kira Studio
(SPEC §5 item 3 assigns them to the extension). The extension composes the full
`AppInitResult` from its own ports plus this. In G1 there is no webview to compose *for* (D13), so
G1's extension calls the server's `app.init` and surfaces it through a status command and the log —
which is exactly what "proven end-to-end on `app.init`" means at this phase.

`serverVersion` is `buildinfo.Version`, the same string `main.go:214` already puts in the About
dialog.

### D12 — The method table has three entries and **no** placeholders; an unported method is one uniform error

`gitrpc.Handlers.Request` switches on `method` over exactly `app.init`, `repo.open`, `repo.close`,
with a `default` returning `ipcerr.New("E_UNKNOWN_METHOD", "…")`. There is no entry for
`graph.stream`, `commit.detail`, or the other 30 — not a stub, not a `TODO`, not a
`E_NOT_IMPLEMENTED` per method.

This matters: a 33-entry table where 30 entries return "not implemented" *is* the half-implemented
scope `AGENTS.md` forbids, and it would also have to be re-touched by every one of G2–G10. One
`default` arm is the honest statement "this server does not serve that method", it is the same
answer a genuinely wrong method name gets, and it needs no edit as later phases fill the table in.

`Handlers.Stream` is `func(...) error { return ipcerr.New("E_UNKNOWN_METHOD", …) }` for the same
reason (and because F3 means it could not emit a chunk even if it wanted to).

### D13 — The extension migrates whole; `activate()` registers no webview view until G3

Every file moves in G1 (§5.1) — including `panelView.ts`, `reviewView.ts`, `html.ts`,
`webview/main.ts` and all of `packages/git-ui`. They compile, typecheck and lint. But
`activate()` does **not** call `registerWebviewViewProvider`.

Rejected alternative: register them, and let the graph render an error because `graph.stream` is an
unknown method. That ships a visibly broken panel in a phase whose exit criterion says nothing about
a panel, and there is no designed UI state for "the server does not implement this method" — the
existing blocked-state panel (`GitBlockedPanel.vue`) models *git* being unavailable, not *the
protocol* being incomplete. G3 is the phase that first has a graph to draw; it wires the two
providers as its own first step.

What `activate()` *does* do in G1 is §5.4.

### D14 — `packages/git-core` is copied **whole** in G1; the `preflight`/`undo` drop moves to G5/G9

F16: `packages/ui` imports `validateRefName` (four sites) and `classifyReset` (one site), both from
`core/preflight/*`. Dropping `preflight/*` in G1 breaks `git-ui`, which the same SPEC table requires
to be **unchanged**.

So G1 copies `packages/core` verbatim into `packages/git-core`, and the trim happens in the phase
that has the information to do it correctly:

- **G5** ports `preflight/*` to Go (`gitpreflight`) and is therefore the phase that knows which
  client-side survivors are genuinely still needed. It deletes `preflight/checkout.ts`,
  `cherryPick.ts`, `pull.ts`, `push.ts`, `revert.ts`, `stashPop.ts` and their `core/src/index.ts`
  re-exports, and decides where `validateRefName` and `classifyReset` live — most likely
  `git-core/src/model/`, since a ref-name *validator* and a reset *classifier* the UI runs before
  round-tripping are client concerns, not server ones.
- **G9** completes the undo slot in Go and deletes `undo/slot.ts`.

Named here so the SPEC's end-state table stays true and neither later phase has to rediscover the
list. **The exact deletion list is: `packages/git-core/src/preflight/*` (17 files),
`packages/git-core/src/undo/*` (2 files), and the corresponding re-export lines in
`packages/git-core/src/index.ts` (currently `:128-136`, `:156`, `:189-190`), minus whatever G5
decides to relocate.**

### D15 — Workspace, tsconfig and biome wiring: four new entries, four new tsconfigs, one new biome override block

This repo has no `tsconfig.base.json` and no project references beyond the app (§0.1). G1 does not
introduce upstream's composite-project setup — that is a whole build-graph change with no benefit
to a phase that adds four leaf packages. Instead each new package gets a standalone
`tsconfig.json` in `packages/api-core/tsconfig.json`'s existing 13-line shape, and one new root
`typecheck:git` script runs them.

Exact changes in §5.2.

### D16 — *Connected editors* is a fifth `SettingsDialog` section that bypasses the draft/Save model

F10. `sections` becomes `['Appearance','Data','Cache','Connected editors','Advanced']`, the bare
`<template v-else>` for Advanced becomes an explicit
`v-else-if="activeSection === 'Advanced'"`, and the new branch renders from a **module-level state
store** (`state/gitClients.ts`), not from `draft`. `pendingPatch`/`isDirty`/`diffSection` are not
touched, and the footer's "Unsaved changes" indicator is unaffected because this section never
mutates `draft`.

Rejected alternative: a separate top-level dialog. Declined because there is no menu real estate
for it, and the pane is a preference-adjacent, rarely-visited surface — exactly what the settings
dialog is for.

### D17 — The pairing prompt is a separate, always-mounted dialog at `App.vue`'s root

F11 — `ConfirmDialog`'s precedent, for the same reason: it must be able to appear when the user has
nothing open. `App.vue` gains one line, `<GitPairingDialog />`, and the component renders `null`
unless `gitClientsState.pending` is non-null.

It is **not** rendered inside `SettingsDialog`: a request that only appeared once the user happened
to open Settings would sit unanswered for its whole 120 s, which is a functional failure, not a
styling choice.

### D18 — Revocation closes live connections synchronously, before the call returns

SPEC §3.3: *"revoking sets `revoked_at` and closes every live connection holding that id"*. Order
matters and is fixed here: write `revoked_at` **first**, then close. The reverse order leaves a
window in which a closed connection re-dials, finds no `revoked_at`, and is silently re-admitted on
its still-valid token.

`gitsock.Server` keeps `map[string][]*conn` keyed by client id, guarded by its own mutex.
`Revoke(id)` closes each `net.Conn`; `rpcstream.Serve`'s `Receive` then returns an error and the
session tears itself down (`session.go:232-237`), cancelling every in-flight request for free.

The revoked extension's next `hello` carries a token whose row now has `revoked_at` set →
`tokenRejected` → it clears `context.secrets` and re-dials with `token: null` → a fresh pairing
prompt. That is the loop SPEC §3.3 describes, closed.

### D19 — `bridge.GitClientsService` is one bound service with five methods

```
List()                          → []model.GitClient        (never the hash or the salt)
Revoke(id string)               → error
PendingPairing()                → GitPairingSnapshot        (head request + queue depth, or empty)
Approve(requestID string)       → GitPairingActionResult
Deny(requestID string)          → GitPairingActionResult
```

`Approve`/`Deny` return a value carrying `resolved`/`alreadyResolved`/`expired` (D9), never an
error — `connections.Service.Reveal`'s precedent (F7). `List` returns a projection that **cannot**
carry `token_hash`/`token_salt`: the model struct simply has no such fields, rather than a struct
with fields the mapper is trusted to skip.

Two new event channels in `bridge/events.go`'s constant block:
`ChannelGitPairing = "kira:git:pairing"` and `ChannelGitClientsChanged = "kira:git:clients"`, wired
through `Sources` exactly as the five existing producers are (`events.go:52-95`).

### D20 — `CONTRACT_VERSION` is duplicated as a Go constant with a mismatch that fails loudly

F17. `gitrpc.ContractVersion` is a Go `const` with a comment naming
`packages/git-ipc/src/validate.ts` as its source of truth. A `hello` whose `contractVersion` differs
gets `{kind:"versionMismatch", expected, received, serverVersion}` and the connection closes — the
hard stop SPEC §3.4 requires, with both numbers named so the extension can render its blocking
panel.

Rejected: generating one from the other. A single integer does not justify a codegen step, a
generator script, or a drift check in CI; a mismatch is loud, immediate, and self-describing at the
one moment it can possibly matter. This is the same call `gitclient/settings.go:3-7` and
`contract.ts:6-11` already make for much larger structural copies.

### D21 — The handshake is its own exchange, before `rpcstream` ever sees the connection

Concretely: `gitsock` reads and writes handshake frames directly over the framing layer. Only once
the exchange reaches `ready` does it construct the `rpcstream.Conn` adapter over the same
`net.Conn` and call `rpcstream.Serve`.

Rejected: modelling `hello` as an `rpcstream` method. That would require `Serve` to be running
before the peer is trusted, giving an unauthenticated peer the whole method table for the duration
of the handshake, and it would put an authentication concern inside a package whose entire virtue
(F2) is knowing nothing about what a method means.

Handshake frames are the same length-prefixed JSON as everything else, so there is one framing
implementation, not two.

### D22 — Reconnect backoff: 500 ms → 8 s, ×2, ±20 % jitter, indefinite

The extension reconnects forever — Kira Studio not running is a normal, possibly long state, and a
give-up state would need its own UI and its own manual-retry affordance, neither of which is in
scope. Capped at 8 s so a socket that reappears is picked up within a few seconds. Jitter so N
editor windows do not stampede a just-started Kira Studio in lockstep. Reset to 500 ms on a
successful `ready`.

`versionMismatch` and a *denied* pairing are the two outcomes that **stop** the loop: both are
states a retry cannot improve (the user must install a matching build, or approve in Kira Studio),
and both surface through the extension's status. `tokenRejected` does **not** stop it — it clears
the stored token and immediately re-dials (D18's loop).

**No backoff library.** `AGENTS.md` requires naming the requirement: the two candidate shapes here
are a `setTimeout` loop inside `activate()`'s disposable lifetime, and a dependency. The extension
bundle is shipped inside a DMG and `packages/host-vscode` today has exactly one runtime
dependency-free profile (`external: ["vscode"]`, F18); ~15 lines of `setTimeout` with a jittered
doubling counter, disposed with the extension, does not clear the bar for adding the first one.

### D23 — Nothing in G1 is gated behind a build tag

The socket listener runs in a `-tags server` build exactly as it does in the packaged app — it is
plain `net`, `syscall` and `database/sql` with no Wails dependency. This is deliberate and
load-bearing: it is what makes §8.1's automated end-to-end proof possible in this container (F14).

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/`.

### 3.1 `internal/gitsock/` — new

| File | Contents |
|---|---|
| `server.go` | `Server` (listener, lock fd, live-connection map, broker, deps), `New(Deps) *Server`, `Start() error`, `Close() error`, `Revoke(clientID string)`. `Start` performs D5's five-step sequence and returns nil-with-a-log when the lock is already held. |
| `lock.go` | `acquireLock(path string) (*os.File, bool, error)` — D3's `syscall.Flock`. Returns `(nil, false, nil)` on `EWOULDBLOCK`. |
| `frame.go` | `writeFrame(w io.Writer, b []byte) error`, `readFrame(r *bufio.Reader) ([]byte, error)` — D1/D2's 4-byte BE prefix, `maxFrameBytes = 8 << 20`, `errFrameTooLarge`. Plus `type conn struct{…}` implementing `rpcstream.Conn`'s `Send`/`Receive` over them (F2). |
| `handshake.go` | The `hello`/`ready`/`pairingRequired`/`paired`/`pairingDenied`/`versionMismatch`/`tokenRejected` types and `runHandshake(ctx, c *conn, deps) (clientID string, ok bool)`. §3.1.1. |
| `pairing.go` | `Broker` — D8's queue, cooldown map, injected `now`, `notify.Emitter[Snapshot]`. `Request`, `Approve`, `Deny`, `Pending`, `Subscribe`. |
| `token.go` | D6's `mintToken() (plain string, hash, salt []byte, err error)` and `verifyToken(presented string, hash, salt []byte) bool`. |
| `clients.go` | The `TrustStore` interface `gitsock` needs (`ByID`, `Insert`, `TouchLastSeen`, `Revoke`, `List`) — declared here, satisfied structurally by `repos.GitClientsRepo`, so `gitsock` does not import `storage/repos`. Same shape `rpcstream.Conn` uses and `internal/layering_test.go` rewards. |
| `frame_test.go` | D1's boundary arithmetic: zero-length body, a body one byte under and one byte over `maxFrameBytes`, a prefix that promises more bytes than ever arrive (must return an error, never block forever after EOF), two frames in one `Write`, one frame split across three `Write`s. |
| `pairing_test.go` | D8's state machine: FIFO order under concurrent `Request`s, only the head presented, deadline measured from enqueue not presentation, `Deny` sets a 60 s cooldown and `timeout` does not, a second `Approve` for the same id reports `alreadyResolved`, resolution promotes the next request and emits. Uses an injected clock — no `time.Sleep`. |
| `handshake_test.go` | §3.1.1's branch table, every arm, over an `net.Pipe()`. |

#### 3.1.1 The handshake state machine

One inbound frame, then one or two outbound. Wire shapes are SPEC §3.3's, verbatim.

```
C→S  {"kind":"hello","protocol":1,"contractVersion":N,
      "client":{"id":"…","label":"…","pid":1234,"appVersion":"…"},
      "token":"<base64url>"|null}
```

Server decision order — **first match wins, and the order is load-bearing**:

| # | Condition | Response | Then |
|---|---|---|---|
| 1 | frame is not decodable JSON, or `kind != "hello"`, or `client.id` is empty | *(none)* | close |
| 2 | `protocol != 1` | `{"kind":"versionMismatch","expected":1,"received":P,"serverVersion":V}` | close |
| 3 | `contractVersion != gitrpc.ContractVersion` | `{"kind":"versionMismatch","expected":N,"received":M,"serverVersion":V}` | close |
| 4 | `token != null` and it verifies against a non-revoked row for `client.id` | `{"kind":"ready","contractVersion":N,"serverVersion":V,"sessionId":"…"}` | `TouchLastSeen`, serve |
| 5 | `token != null` and it does not verify (no row / wrong token / revoked) | `{"kind":"tokenRejected"}` | close |
| 6 | `token == null`, and `client.id` is in cooldown | `{"kind":"pairingDenied","reason":"denied"}` | close |
| 7 | `token == null` | `{"kind":"pairingRequired","requestId":"…","expiresInMs":120000}` then §3.1.2 | — |

Rows 2 and 3 are checked **before** any token work so a build skew is reported as a build skew
rather than as an auth failure. Row 5 is checked before row 6/7 so a *revoked* client is told its
token was rejected (which is what makes D18's clear-and-re-dial loop work) rather than being sent
back to pairing with a token it still holds.

`sessionId` is a fresh UUID per accepted connection; it is what G11's multi-client work will use to
name a connection in logs, and it costs nothing to mint now.

#### 3.1.2 After `pairingRequired`

`broker.Request(clientID, label)` blocks. Its three outcomes:

| Outcome | Response | Then |
|---|---|---|
| approved | mint (D6), `Insert` the row, `{"kind":"paired","token":"<base64url>"}` then `{"kind":"ready",…}` | serve |
| denied | `{"kind":"pairingDenied","reason":"denied"}` | close |
| timeout | `{"kind":"pairingDenied","reason":"timeout"}` | close |

The row is inserted **before** `paired` is sent. The reverse order can hand an extension a token
that no row backs — after which every reconnect gets `tokenRejected` and the user is stuck in a
pairing loop with no error to explain it.

If the peer disconnects while its request is queued, the accept-loop goroutine's context is
cancelled and `Request` returns — the entry is removed from the queue and the next one is promoted,
so a dead client cannot hold the single-prompt slot for 120 s.

### 3.2 `internal/gitclient/` — ported (D10)

`git show origin/claude/feature-v1-3:apps/kira-studio/internal/gitclient/<f>` for:
`clock.go`, `errors.go`, `errors_test.go`, `discovery.go`, `discovery_test.go`, `capabilities.go`,
`capabilities_test.go`, `settings.go`, `runner.go`, `runner_test.go`, `repo.go`, `repo_test.go`,
`client.go`.

**Not ported:** `watcher.go`, `watcher_test.go` (D10 — replaced by `fsnotify` in G2).

Expected edits: **none beyond import paths**, and there should be none of those — the package
imports only stdlib. Verify with `go build ./apps/kira-studio/internal/gitclient/` immediately after
the copy; if an import does need fixing, the fix is the current path, not a re-layout.

`settings.go`'s `SettingsSnapshot` is carried across as-is. Note for the implementer: it is
**not** what crosses `app.init` in this design — SPEC §5 item 3 puts `settings` on the extension's
side of the composition (D11) — but `gitclient.Client` takes a configured git path, and
`DefaultSettings().GitPath` is where G1's `""` comes from until G2 gives settings a real home.

### 3.3 `internal/gitrpc/` — new

| File | Contents |
|---|---|
| `contract.go` | `const ContractVersion = 12` (D20, with the comment naming `packages/git-ipc/src/validate.ts:7`), `const Protocol = 1`. |
| `wire.go` | Request/result structs for the three methods. `RepoOpenParams{Path string}`, `RepoCloseParams{RepoID string}`, `AppInitResult{ContractVersion int; ServerVersion string; Git gitclient.GitStatus}`. `repo.open`'s result is `gitclient.RepoOpenResult` directly (`client.go:9-14`) — it is already the wire shape, JSON tags and all. |
| `handlers.go` | `New(deps Deps) rpcstream.Handlers` — D12's three-arm switch plus the uniform `default`. |

```go
// Deps is everything gitrpc needs; nothing more reaches it.
type Deps struct {
    Client        *gitclient.Client
    ServerVersion string
}
```

Handler bodies, in full — this is the whole of G1's git surface:

- **`app.init`** — `AppInitResult{ContractVersion, ServerVersion, Git: deps.Client.Status(ctx, "")}`.
- **`repo.open`** — validate `Path != ""` (`ipcerr.BadRequest`), then `deps.Client.OpenRepo(ctx, "",
  path)`. Its three-arm union already models `ok`/`notARepository`/`gitUnavailable`
  (`client.go:43-58`); a classified error other than "not a repository" comes back as a Go error and
  `wireErrorFrom` (F4) turns it into an `RpcError` on the wire.
- **`repo.close`** — validate `RepoID != ""`, then `deps.Client.CloseRepo(repoID)`; result
  `struct{}{}` (matching `contract.ts:879-882`'s `Record<string, never>`).

**No test.** Three thin dispatch arms over already-tested code is squarely inside `AGENTS.md`'s
"thin pass-through wrappers … single bad-input → single-error paths" exclusion. The behaviour that
matters here is proven end-to-end (§8.1), not in a unit test that restates the switch.

### 3.4 `internal/bridge/rpcstream/` — ported (D4)

Four files verbatim from `origin/claude/feature-v1-3`; `frame.go:7`'s import changed from
`…/internal/bridge/ipcerr` to `…/internal/ipcerr` (F1). Nothing else.

`internal/layering_test.go`'s exempt set (`:29-33`) already contains `internal/bridge`, and its
enumeration is `go list`-driven, so the new subpackage is covered automatically and needs no edit
there. `internal/gitsock`, `internal/gitrpc` and `internal/gitclient` are domain packages that must
**not** import `internal/bridge` — but `gitsock` needs `rpcstream.Conn`/`Serve`, which live under
it. **This is a real layering-test failure the implementer will hit.**

Resolution: `internal/gitsock` is added to `packagesExemptFromBridgeCheck`, with a comment giving
the same reason SPEC §7 gives — `rpcstream` is *"module-agnostic infrastructure two modules already
share … not a boundary violation"*, and `gitsock` is a transport package, the socket-side peer of
`internal/bridge`'s Wails-side transport, not a domain package underneath it. `gitrpc` and
`gitclient` are **not** exempted: they must stay clean, and they are (`gitrpc` imports `rpcstream`
only for the `Handlers` *type*, which is… also under `bridge`).

Simplest correct answer, applied instead: **`gitrpc.New` returns its two functions in a small local
struct and `gitsock` adapts them to `rpcstream.Handlers`.** Then only `gitsock` is exempted, and
`gitrpc` imports nothing under `bridge`. Do it this way.

### 3.5 Storage

- `internal/storage/migrations/0016_g1_git_clients.sql` — D7.
- `internal/storage/migrations/embed.go` — one line appended to `names`.
- `internal/storage/model/gitclient.go` — `GitClient{ID, Label string; CreatedAt, LastSeenAt int64;
  RevokedAt *int64}`. **No hash, no salt** (D19).
- `internal/storage/repos/gitclients.go` — `GitClientsRepo` with `ByID(id) (row, bool, error)`
  (the internal row type *does* carry hash+salt), `Insert`, `TouchLastSeen`, `Revoke`, `List`.
  Registered on `repos.Repos` in `repos.go` alongside the existing repos.
- **No migration test.** `0016` is a bare `CREATE TABLE` + `CREATE INDEX` against a table with no
  prior rows anywhere in the world — nothing like the data-transforming migrations that earned
  `migrate_op_log_bytes_test.go` and its siblings.

### 3.6 `internal/bridge/gitclients.go` — new

`GitClientsService{Deps appcore.Deps; Sock GitSock; Broker GitBroker}` with D19's five methods.
`GitSock` and `GitBroker` are one-method-ish interfaces declared in this file (the `Sources`
precedent, `events.go:52-64`) so `bridge` does not import `gitsock` types beyond what it renders.

`internal/bridge/events.go` gains the two channel constants and a `Git` entry on `Sources` with
`OnPairingChanged(func(gitsock.Snapshot)) func()` and `OnClientsChanged(func([]model.GitClient))
func()`, subscribed in `Attach` and unsubscribed by the returned `detach` exactly as the five
existing producers are.

### 3.7 `main.go` wiring

Inserted into the documented startup order (`main.go:54-61`), after `repos.New` (`:83`) and before
`application.New` (`:208`):

```go
gitCli := gitclient.NewClient(gitclient.NewExecRunner(), gitclient.NewRealClock())
gitSock := gitsock.New(gitsock.Deps{
    SocketPath: filepath.Join(config.KiraHome(), "git.sock"),
    LockPath:   filepath.Join(config.KiraHome(), "git.sock.lock"),
    Clients:    repositories.GitClients,
    Handlers:   gitrpc.New(gitrpc.Deps{Client: gitCli, ServerVersion: buildinfo.Version}),
    Now:        time.Now,
})
if err := gitSock.Start(); err != nil {
    slog.Warn("git socket listener", "scope", "startup", "err", err)
}
```

`Start` returning an error is **logged, never fatal** (D5): the app must boot without the git
socket. `main.go:191-205`'s `teardown` gains `gitSock.Close()`, before `db.Close()`.

The service is appended to `main.go:215-237`'s list as
`application.NewService(&bridge.GitClientsService{Deps: deps, Sock: gitSock, Broker: gitSock.Broker()})`,
and `events.Attach`'s `bridge.Sources` (`main.go:176`) gains `Git: gitSock`.

**Bindings must be regenerated** (`wails3 task common:generate:bindings`, or `scripts/setup.sh`) —
`AGENTS.md` is emphatic that `-names` is load-bearing and that `frontend/bindings/**` are real Vite
import targets, so a missing regeneration fails the frontend build outright.

---

## 4. The frontend (Wails) side

All paths under `apps/kira-studio/frontend/src/`.

### 4.1 `state/gitClients.ts` — new

The single module-level store both surfaces read:

```ts
export const gitClientsState = reactive({
  clients: [] as GitClient[],
  pending: null as GitPairingSnapshot | null,
  queued: 0,
});
```

- `hydrate()` — called once at boot from `main.ts`'s existing bootstrap sequence: `List()` and
  `PendingPairing()` in parallel. `PendingPairing()` at boot is what implements SPEC §3.3's
  "held … with no Kira Studio window open yet" from the renderer's side (D8).
- Two `on(...)` subscriptions via `bridge/rpc.ts:64`'s helper, for `kira:git:pairing` and
  `kira:git:clients`.
- `approve(id)` / `deny(id)` / `revoke(id)` — thin `unwrap`ped bound calls that let the emitted
  event drive the re-render rather than mutating optimistically. A `Approve` that comes back
  `alreadyResolved` is not an error path (D9); the pending snapshot simply clears.

### 4.2 `workbench/GitPairingDialog.vue` — new

D17. Mounted unconditionally at `App.vue`'s template root (one added line beside
`<ConfirmDialog />`, `App.vue:73`); renders nothing while `gitClientsState.pending` is null.

Built on `theme/primitives/DialogFrame.vue` + `AppButton`, the same primitives `SettingsDialog.vue`
uses (`:21-23`). Content: the client label, its pid, its app version, the socket it came from, a
plain sentence saying what approval grants, an **Approve** and a **Deny** button, and — when
`queued > 1` — SPEC §3.3's visible count ("1 of 3 waiting"). A live countdown from `expiresInMs`
so the user can see the request is time-boxed.

**Deny is the default focus.** A trust prompt whose Enter key grants access is the wrong default.

`data-testid` on the dialog root, both buttons and the queue count — §8.1's e2e spec drives them.

### 4.3 `workbench/SettingsDialog.vue` — edited

D16. Three edits and no more:

1. `:81` — `sections` gains `'Connected editors'` between `'Cache'` and `'Advanced'`.
2. The Advanced branch's bare `<template v-else>` becomes
   `<template v-else-if="activeSection === 'Advanced'">`.
3. A new `<template v-else-if="activeSection === 'Connected editors'">` branch rendering
   `gitClientsState.clients`: label, "last seen" relative time (`format.ts` already has the
   helpers), and a **Revoke** `IconButton` per row, plus an empty state ("No editors have been
   paired yet.") and one sentence naming `~/.kira-studio/git.sock`.

Revoke goes through `ConfirmDialog` first — it disconnects a running editor, and it is one click
away from a list the user opened to *look* at.

`pendingPatch`, `diffSection`, `isDirty` and the footer are untouched.

---

## 5. The extension migration

### 5.1 The move, file by file

Source: `/home/user/vlad-cirstean/kira-version-vscode` at `claude/start-p2-gwlgly`. **Copies, not
`git mv`** — the two repos share no history, so `git mv` is not available and a copy + `git add` is
the operation. Line endings and file modes carry across unchanged.

| From (upstream) | To (this repo) | Change |
|---|---|---|
| `packages/ipc/src/{contract,rpc,transport,codec,validate,graphChunkCodec,index}.ts` | `packages/git-ipc/src/` | verbatim |
| `packages/ipc/src/generated/graphChunk.ts` | `packages/git-ipc/src/generated/` | verbatim |
| `packages/ipc/schema/graphChunk.{fbs,fields.json}` | `packages/git-ipc/schema/` | verbatim, **unused in G1** (§6) |
| `packages/ipc/src/{codec,rpc}.test.ts` | `packages/git-ipc/src/` | verbatim |
| `packages/ipc/package.json` | `packages/git-ipc/package.json` | name → `@kira/git-ipc` |
| **new** | `packages/git-ipc/src/socketChannel.ts` | §5.3 |
| `packages/core/src/**` (all 77 files) | `packages/git-core/src/` | verbatim, **whole** (D14) |
| `packages/core/package.json` | `packages/git-core/package.json` | name → `@kira/git-core`; add `"@kira/git-ipc": "workspace:*"` only if the copy actually needs it (it does not today — F15) |
| `packages/ui/src/**` | `packages/git-ui/src/` | verbatim; only the two `@kira-version/*` import specifiers are rewritten to `@kira/git-*` |
| `packages/ui/{package.json,vite.config.ts}` | `packages/git-ui/` | name → `@kira/git-ui`; `vue` pinned to this repo's `3.5.42`, `slickgrid`/`@vscode/codicons` to this repo's existing pins |
| `packages/host-vscode/src/{html,panelView,reviewView,index}.ts` | `apps/kira-studio-vscode/src/` | import specifiers rewritten; handler source swapped (§5.5) |
| `packages/host-vscode/src/ports/*.ts` (8 files: `clipboard`, `credentialPrompt`, `dialogs`, `editorIntegration`, `logger`, `storage`, `theme`, `workspaceRoots`) | `apps/kira-studio-vscode/src/ports/` | verbatim, specifiers rewritten |
| `packages/host-vscode/src/webview/main.ts` | `apps/kira-studio-vscode/src/webview/` | specifiers rewritten |
| `packages/host-vscode/src/{extension,transport}.ts` | — | **rewritten**, §5.3/§5.4 |
| `packages/host-vscode/package.json` | `apps/kira-studio-vscode/package.json` | §5.2 |
| `resources/{icon,review-icon}.svg` | `apps/kira-studio-vscode/resources/` | verbatim |

The specifier rewrite is mechanical and total: `@kira-version/ipc` → `@kira/git-ipc`,
`@kira-version/core` → `@kira/git-core`, `@kira-version/ui` → `@kira/git-ui`, and every
`@kira-version/git` import disappears with the file that held it (F15).

**Not migrated at all:** upstream's `packages/git/**` (its replacement is `internal/gitclient` +
G2–G10's Go packages), `apps/harness/**`, `tests/**`, `docs/**`, `scripts/**`, and upstream's root
config files (this repo has its own — §5.2).

### 5.2 Root-config wiring in this repo

**`package.json`:**
- `workspaces` (`:8-12`) gains `"packages/git-ipc"`, `"packages/git-core"`, `"packages/git-ui"`,
  `"apps/kira-studio-vscode"`. Note the existing first entry is `apps/*/frontend`, which does
  **not** match `apps/kira-studio-vscode` — hence the explicit entry.
- `scripts` gains `"typecheck:git": "tsgo --noEmit -p packages/git-ipc/tsconfig.json && tsgo --noEmit -p packages/git-core/tsconfig.json && tsgo --noEmit -p apps/kira-studio-vscode/tsconfig.json && vue-tsc --noEmit -p packages/git-ui/tsconfig.json"`, and `typecheck` (`:22`) gains `&& bun run typecheck:git`.
- `scripts` gains `"build:vscode": "bun run scripts/build-vscode.ts"` (F18).
- `devDependencies` gains `"@types/vscode": "1.134.0"`.
- `bun install` after; `bun.lock` changes. `bunfig.toml`'s `exact = true` means every version added
  is pinned, no ranges.

**`tsconfig.json` (root, 4 lines):** unchanged. It is a solution file referencing
`./apps/kira-studio` only, and the new packages are typechecked by their own `tsgo -p` invocations
(D15), not through references. Introducing composite project references for four leaf packages is a
build-graph change this phase does not need.

**Four new `tsconfig.json` files**, each in `packages/api-core/tsconfig.json`'s exact 13-line shape
(`target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict`, `noEmit`,
`verbatimModuleSyntax`, `skipLibCheck`) with per-package `include` and `types`
(`["bun-types"]` for `git-ipc`/`git-core`; `["node"]` + `@types/vscode` for the app; the Vue one
adds `jsx`/`.vue` handling from upstream's `packages/ui`).

Note for the implementer: upstream's `tsconfig.base.json` sets `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, which this repo's configs do not. The migrated sources were written
under those flags, so they will typecheck **more** loosely here, not less — no source change is
implied. Do not add the flags: they would apply repo-wide through a shared base this repo does not
have, and turning them on for the migrated packages alone is a decision for whoever owns them
later, not a migration side effect.

**`biome.json`:** one new override block after the `packages/shared` one (`:226-245`), mirroring
SPEC §7's module boundary:

```jsonc
{
  "includes": ["packages/git-ipc/**", "packages/git-core/**", "packages/git-ui/**",
               "apps/kira-studio-vscode/**"],
  "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": {
    "patterns": [
      { "group": ["@kira/shared", "@kira/api-core", "**/apps/kira-studio/**"],
        "message": "SPEC §7: the git module is its own package family — it must not import Studio's or Api's code." }
    ] } } } } }
}
```

And a second, tighter block for `packages/git-ipc/**` + `packages/git-core/**` banning `vscode` and
`vue` (the `packages/api-core` rule at `:207-225` is the model): those two are pure, host-free
logic, exactly as upstream's own B3 rule had it.

`biome.json`'s `files.includes` (`:9-19`) gains `"!packages/git-ipc/src/generated"` — generated
FlatBuffers code, the same exclusion `packages/shared/protocol/wire` already has (`:17-18`).

**`.gitignore`:** already ignores `dist` (`:82`) and `node_modules/` (`:41`), which covers the
extension bundle output. No change.

**`scripts/build-vscode.ts`** — new, ~60 lines, F18's `Bun.build` call plus the Vite build of
`packages/git-ui` for the webview bundle, writing into `apps/kira-studio-vscode/dist/`. It is **not**
wired into `scripts/setup.sh` or `bun run build`: nothing in G1's proof loads the bundle (D13), and
`setup.sh` is on the critical path of every dev/e2e run. G3, the phase that first loads a webview,
wires it in.

### 5.3 `packages/git-ipc/src/socketChannel.ts` — new

The whole point of the migration: a `MessageChannelLike` (`rpc.ts:42-47`) whose channel is a Unix
socket instead of `webview.postMessage`.

```ts
export interface SocketChannel extends MessageChannelLike {
  onClose(handler: (err?: Error) => void): () => void;
}
export function createSocketChannel(socket: net.Socket): SocketChannel;
```

- `bufferEncoding: "native"`. Upstream's `"base64"` exists solely because a VS Code `WebviewView`
  cannot carry an `ArrayBuffer` (`codec.ts:23-29`) — a socket carries bytes by definition, so the
  base64 path is not needed on this channel. `codec.ts` is untouched; the encoding is per-channel by
  design (`rpc.ts:38-41`).
- `post(message)` — `JSON.stringify`, `Buffer.byteLength`, `writeUInt32BE` a 4-byte header, one
  `socket.write` of the concatenation (never two writes; a partial frame on the wire between them
  is a real interleaving hazard once more than one thing can write).
- `onMessage(handler)` — accumulates into a `Buffer`, and drains **every** complete frame present
  after each `data` event, in a loop. Draining only one is the classic bug here: two frames
  delivered in a single TCP/Unix read would leave the second stranded until the next arrival.
- Enforces the same `maxFrameBytes` as Go (D1) and destroys the socket on violation.
- `close()` — `socket.end()`.

`transfer` is accepted and ignored (upstream's `host-vscode/transport.ts:33-35` does the same for
the same reason: interface parity).

**One test** (`socketChannel.test.ts`, `bun test`): a real `net.createServer` on a temp path,
round-tripping (a) an empty object, (b) a 1 MiB payload split by the OS across many reads, (c) three
frames written in one `write`, (d) a frame whose declared length exceeds the cap. This is D1's
boundary arithmetic on the TypeScript side and it is the counterpart of `gitsock/frame_test.go` —
the two implementations must agree byte for byte and nothing else checks that.

### 5.4 `apps/kira-studio-vscode/src/extension.ts` — rewritten

What `activate()` does in G1, and nothing more:

1. Create the output channel and `VsCodeLogger` (unchanged from `extension.ts:73-79`).
2. Read `kiraVersion.*` settings via the existing `coerceSettings`/`readRawSettings`
   (`:36-43`, `:76-78`) — the extension keeps owning settings (D11), and
   `onDidChangeConfiguration` (`:135-147`) keeps re-coercing them. Its two
   `notifySettingsChanged` calls become no-ops in G1 (no provider registered, D13) and are removed
   with them, returning in G3.
3. **Construct the connection manager** (new `src/connection.ts`, ~180 lines): owns the dial /
   handshake / backoff loop and exposes `state`, `onStateChange`, and `request(method, params)`.
   - Socket path: `path.join(process.env.KIRA_HOME ?? path.join(os.homedir(), '.kira-studio'), 'git.sock')` — the same
     `KIRA_HOME` rule `config.KiraHome()` implements (`paths.go:11-14`), so a test harness can point
     both ends at one temp directory.
   - Dial → send `hello` with `token = await context.secrets.get('kira.git.token')` (or `null`) →
     read one frame → branch on `kind` per §3.1.1's table:
     - `ready` → reset backoff, construct `createRpcClient(createSocketChannel(sock))`, state
       `connected`.
     - `paired` → `context.secrets.store('kira.git.token', token)`, then expect `ready`.
     - `tokenRejected` → `context.secrets.delete(...)`, **immediately re-dial with no backoff**
       (D18/D22): this is the revocation loop, and delaying it just delays the pairing prompt.
     - `pairingDenied` → state `denied`, **stop** the loop (D22). A command re-arms it.
     - `versionMismatch` → state `versionMismatch` carrying both numbers, **stop** the loop.
     - anything else / socket error / EOF → schedule a reconnect (D22).
   - On an established connection's close: dispose the RPC client and schedule a reconnect.
4. On reaching `connected`, call the server's `app.init` once, and log the result
   (`git.kind`, `serverVersion`, `contractVersion`). **This is G1's own exit criterion executing in
   the real extension.**
5. Register two commands:
   - `kiraVersion.showConnectionStatus` — an information/warning message naming the current state,
     the socket path, and (for `versionMismatch`) both versions. This is the extension's whole UI in
     G1, and it is the surface a manual macOS check drives (§8.2).
   - `kiraVersion.openRepository` — `vscode.workspace.workspaceFolders?.[0]` (falling back to
     `dialogs.pickFolder`), then `request('repo.open', {path})`, then show the resulting
     `RepoOpenResult`'s kind and, for `ok`, the branch name and git dir. The second half of the
     exit criterion, drivable by hand.
   The two existing commands (`focusGraph`, `reviewBranch`) are removed from
   `package.json#contributes.commands` and from `activate()` along with the views they focus (D13),
   and return in G3.
6. `deactivate()` disposes the connection manager (closing the socket, cancelling the backoff timer).

`package.json#contributes`: `viewsContainers`, `views` and `colors` are **kept verbatim** (they are
declarative and cost nothing while unregistered — and deleting/restoring them across G1→G3 is churn
that risks losing the eight lane colours); `commands` becomes the two above; `configuration` is kept
whole. `main` points at `./dist/extension.js`. `engines.vscode` stays `^1.134.0`. `extensionKind`
stays `["workspace"]` — it must run on the machine with the socket.

### 5.5 Migrated but not wired

`panelView.ts` and `reviewView.ts` currently build their handler set with
`createRepoHandlers({service, roots, dialogs, …})` from `@kira-version/git` (`panelView.ts:64-73`),
which does not exist in this repo. To compile, they take a `ServerHandlers` from a constructor
parameter instead of building one, and their callers (G3) supply it.

That parameter's eventual producer is `createProxyHandlers(connection, ports)` — the composition
SPEC §5 items 2–4 describe. **It is not written in G1**: its interesting content is the seven local
overrides (G4) and the askpass relay (G7), and a version of it that only forwards would be replaced
wholesale by G4. Writing the type-level seam now and the implementation in G3/G4 is what keeps every
file in one place without shipping a class with nothing in it.

The two `service.onChanged`/`service.onOpProgress` subscriptions (`panelView.ts:76-89`) become
`transport.on('repo.changed'|'remote.progress', …)` forwards in G3, when there is a server producing
those events (F3 records why `rpcstream` cannot produce them yet).

---

## 6. Where G3's FlatBuffers slots in, so G1 does not build something G3 tears up

Recorded now because SPEC §4.2 already fixed the design and G1's framing has to be compatible with
it rather than merely adjacent.

- **The framing layer is already binary-clean.** D1/D2's length prefix carries arbitrary bytes; it
  has no JSON-shaped assumption anywhere. G3 changes *what is inside a frame*, never the frame.
- **The seam G3 uses already exists upstream and travels in G1 unused.**
  `codec.ts:269-315`'s `encodeStreamPayload`/`decodeStreamPayload` is keyed on `StreamKey` with a
  `never`-typed default, so adding `graph.stream`'s FlatBuffers wrapper is a change to *that*
  function and to nothing else. `packages/git-ipc/schema/graphChunk.fbs` and
  `src/generated/graphChunk.ts` are migrated in G1 precisely so G3 has them.
- **G3's `.fbs` is a new file, not an edit of an existing one.** SPEC §4.2 names it
  `packages/git-ipc/schema/gitWire.fbs`, with file identifier `"KIG1"` (distinct from the studio
  data plane's `"KIF1"`), generated through the pinned `flatc` `scripts/generate-wire.sh` already
  provisions, into `internal/gitwire` (Go) and `packages/git-ipc/src/generated/` (TS).
- **The one thing G1 must not do, and does not:** assume a frame is JSON anywhere outside the two
  places that parse one. `gitsock/frame.go` hands `[]byte` to `rpcstream`; `rpcstream` is where
  `json.Unmarshal` lives (`session.go:191`), which is exactly where SPEC §4.2 says the JSON control
  plane belongs.
- **`bufferEncoding` stays a per-channel field** (§5.3) — the socket declares `"native"`, and G3's
  binary payloads therefore need no re-plumbing to travel.

---

## 7. Implementation order

Nine commits. `bun run lint`, `bun run typecheck`, `go build ./apps/kira-studio/internal/...` and
`go test ./apps/kira-studio/internal/...` run after **each**; the expensive tier (§8.1's e2e) runs
once at C8, per `AGENTS.md`'s "implement the whole plan first, then test once".

- **C1** `feat(git): port rpcstream and the read-only gitclient subset from the superseded branch`
  — §3.4 + §3.2. Two package copies, one import fix, `watcher.go` deliberately absent, the
  layering-test exemption. Nothing depends on this yet; it must compile and its ported tests must
  pass on their own.
- **C2** `feat(storage): git_clients table, repo and model` — §3.5. Migration 16, `embed.go`,
  model, repo, `repos.go` registration.
- **C3** `feat(gitsock): unix listener, flock recovery, length-prefixed framing` — §3.1's
  `server.go`, `lock.go`, `frame.go` + `frame_test.go`. No handshake yet; the accept loop closes
  every connection immediately, which is a complete and honest intermediate state.
- **C4** `feat(gitsock): pairing broker with queue, timeout and cooldown` — `pairing.go` +
  `pairing_test.go`, `token.go`. Still no handshake.
- **C5** `feat(gitsock): handshake state machine and gitrpc method table` — `handshake.go` +
  `handshake_test.go`, all of §3.3, and `Serve` finally reached. **This is the commit after which
  the Go half is end-to-end drivable by a raw socket client.**
- **C6** `feat(bridge): GitClients service, pairing events and main.go wiring` — §3.6 + §3.7 +
  regenerated bindings.
- **C7** `feat(settings): Connected editors pane and the pairing prompt` — all of §4.
- **C8** `feat(vscode): migrate the extension into this repo` — all of §5.1 and §5.2. Big and
  almost entirely mechanical; it must land as one commit because a half-moved workspace does not
  install, let alone typecheck.
- **C9** `feat(vscode): dial the socket — socketChannel, handshake and reconnect` — §5.3, §5.4,
  §5.5's parameterisation, plus §8.1's two new test files.

C1 before everything (both halves import it). C2 before C4 (the broker inserts rows). C3 before C4
before C5 (each is the previous one's consumer). C6 before C7 (the pane needs bound methods and
generated bindings). C8 before C9 (nothing to rewrite until the files are here).

---

## 8. Exit criteria, and exactly how each is proven

### 8.1 What is proven automatically, in this container

**(a) `apps/kira-studio/internal/gitsock/*_test.go` — plain `go test`, no Docker, no display.**
Covered: framing boundary arithmetic, the broker's queue/timeout/cooldown state machine over an
injected clock, and every arm of §3.1.1's handshake table over `net.Pipe()`. Plus one focused
crypto test (D6): mint → verify succeeds; mint → verify against a *different* salt fails; a
revoked row fails; a client id with no row fails without panicking.

**(b) A Go integration test — the real socket, the real `git`, a real fixture repository.**
`internal/gitsock/integration_test.go`: `t.TempDir()` as `KIRA_HOME`, a real `storage.Open` against
a temp `kira.db`, a real `gitsock.Server.Start()`, and a real `net.Dial("unix", …)` client written
in the test. It drives:

1. `hello` with `token: null` → `pairingRequired`; the test's approver approves → `paired` with a
   token → `ready`.
2. `app.init` over `rpcstream`'s real frames → a `GitStatus` whose `kind` is `"ok"` and whose
   `version` is the container's real `2.43.0`. The `Client` is constructed over a locator returning
   `exec.LookPath("git")` (F13), which is the *only* production-code seam this test uses
   differently from `main.go`.
3. `repo.open` against a repository the test creates with `git init` + one commit → `{kind:"ok"}`
   with a `RepoSummary` whose `head` is `{kind:"branch", …}`, `isBare` false, `isLinkedWorktree`
   false, and `gitDir == commonDir`.
4. `repo.close` → `{}`; a second `repo.close` for the same id → `{}` (idempotent).
5. Reconnect with the stored token → straight to `ready`, **no** `pairingRequired`.
6. `Revoke(clientID)` → the live connection's `Receive` errors; a re-dial with the same token →
   `tokenRejected`; a re-dial with `token: null` → `pairingRequired` again.
7. A second `Server.Start()` against the same `KIRA_HOME` → does not listen, does not error, and
   does not unlink the first one's socket (D5's whole point).

This is the phase's real proof and it runs in `bun run test:go`.

**(c) `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` — the full stack, including a real
approval click.** Uses the existing fixture unchanged (F14): a `-tags server` binary, a per-test
`KIRA_HOME` under `tmpdir()`, and a Playwright page. The spec:

1. `net.connect(join(kiraHome, 'git.sock'))` from the test process, sends `hello` with no token.
2. Waits for `[data-testid="git-pairing-dialog"]` **in the browser page** and clicks
   `[data-testid="git-pairing-approve"]`.
3. Asserts the socket received `paired` then `ready`.
4. Calls `app.init` and asserts `{kind:"notFound"}` with the Linux `probed` line (F13) — the
   platform's true answer — and `repo.open` returning `{kind:"gitUnavailable"}`. Both round trips
   complete; that is what this tier proves. The `ok` branch is (b)'s job.
5. Opens Settings → *Connected editors*, asserts the row is listed, clicks Revoke, confirms, and
   asserts the socket closed.
6. Re-dials with the stored token and asserts `tokenRejected`.

This needs `kiraHome` exposed to the spec body — the fixture already declares it as a fixture
(`fixtures.ts:121`), so no fixture change is required.

**(d) `packages/git-ipc/src/socketChannel.test.ts` — `bun test`.** §5.3's four cases, against a real
`net.createServer` on a temp path. This is the only thing that keeps the TS framing byte-identical
to Go's.

**(e) `bun run lint` / `bun run typecheck` / `bun run test:unit` / `bun run test:go` all clean**,
including the four new tsconfig projects and the migrated packages.

### 8.2 What genuinely cannot be proven here, and the manual script for it

**A real VS Code extension development host is not reachable from this container**: there is no VS
Code, no display, and the product is macOS-only. §8.1(c) proves the *protocol* end to end with a
real approval click, but it does not prove `activate()`, `context.secrets`, or the two commands
running inside a real extension host. That gap is real and is not papered over.

The macOS check, to be run once on real hardware before G1 is called done:

1. `bun run setup && bun run build && bun run build:vscode`.
2. `bun run dev` (Kira Studio, dev build).
3. `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` with any git repository open.
4. Kira Studio raises the pairing prompt naming the VS Code window. **Approve.**
5. Run *Kira Version: Show Connection Status* → connected, both versions shown, `git` reported
   `ok` with the machine's real git version. Run *Kira Version: Open Repository* → `ok` with the
   real branch name and git dir.
6. Reload the VS Code window → reconnects **silently**, no prompt (`context.secrets` reuse).
7. Kira Studio → Settings → *Connected editors* → the window is listed → **Revoke** → the VS Code
   window re-prompts within a second.
8. Quit Kira Studio with the extension connected → the extension reports disconnected and retries;
   relaunch Kira Studio → it reconnects silently.
9. `ls -l ~/.kira-studio/git.sock` → `srw-------`. `kill -9` Kira Studio, relaunch → it starts and
   the stale socket is replaced, not refused.

### 8.3 The checklist

- [ ] `internal/bridge/rpcstream` present, four files, one import changed, its tests passing.
- [ ] `internal/gitclient` present, thirteen files, `watcher.go` deliberately absent, its tests passing.
- [ ] `${KIRA_HOME}/git.sock` exists and is `0600` while the app runs; gone after a clean exit.
- [ ] A second instance does not listen, does not error, and does not unlink the first's socket.
- [ ] A `kill -9`'d leftover socket is recovered on the next start.
- [ ] A frame longer than 8 MiB is refused by both implementations, identically.
- [ ] Handshake: every one of §3.1.1's seven rows reachable and covered.
- [ ] Pairing: FIFO, one presented at a time, 120 s from enqueue, 60 s cooldown on deny only, no
      cooldown on timeout, `alreadyResolved` on a double answer.
- [ ] A pairing request raised while no window is open is still answerable by a window opened later.
- [ ] A token is 32 random bytes; only `sha256(salt‖token)` and the salt are in `kira.db`;
      `subtle.ConstantTimeCompare` is the comparison.
- [ ] `git_clients` is migration 16 and `migrate.go` applies it on an existing database.
- [ ] `bridge.GitClientsService` bound, bindings regenerated with `-names`.
- [ ] *Connected editors* lists paired clients and revokes one; revoke closes the live connection
      **before** the call returns.
- [ ] The pairing prompt appears without Settings being open, defaults focus to Deny, and shows the
      queue count when more than one is waiting.
- [ ] `gitrpc` serves exactly three methods; any other method returns one uniform `E_UNKNOWN_METHOD`.
- [ ] `app.init` returns `{contractVersion, serverVersion, git}` and `repo.open` returns a complete
      `RepoSummary` on a real repository (§8.1(b)).
- [ ] `contractVersion` mismatch closes the connection naming both numbers.
- [ ] The four packages exist, are in `workspaces`, typecheck, and lint under the new biome block.
- [ ] `@kira-version/*` appears **nowhere** in the migrated tree; `@kira-version/git` is not
      migrated at all.
- [ ] `extension.ts` dials, handshakes, stores its token in `context.secrets`, reconnects with
      backoff, and calls `app.init` on connect.
- [ ] `activate()` registers **no** webview view (D13).
- [ ] §8.1(a)–(e) all green; §8.2's nine manual steps all pass on macOS.

---

## 9. Sequencing — one implementer, not two

**Recommendation: one sequential Sonnet subagent for the whole phase.**

The parallel split that looks obvious — Go backend (C1–C7) versus TypeScript extension (C8–C9) —
is genuinely tempting: they share no files, and they meet only at a wire contract. But three things
make it a bad trade here:

1. **The wire contract is not a fixed artefact they can each build against; it is the phase's main
   deliverable.** §3.1.1's decision table, D6's base64url encoding, D1's exact prefix width and cap,
   and the `hello` field names are all *decided in this plan but realised in C3–C5*. A TS agent
   starting from the plan alone would be implementing against prose while the Go agent implements
   against the same prose, and every discrepancy surfaces only at §8.1(c) — the most expensive test
   in the phase, and one neither agent owns.
2. **The TS half is ~85 % mechanical file movement** (§5.1: four package copies and a global
   specifier rewrite) and ~15 % genuinely new code (`socketChannel.ts`, `extension.ts`). Parallelism
   buys wall-clock on the mechanical part and costs correctness on the part that matters.
3. **`AGENTS.md` is explicit**: parallel subagents "only when the plan's work is genuinely
   independent (unrelated adapters, non-overlapping fixes)". A client and a server for one new
   protocol are the textbook case of *not* that.

**If the orchestrator does choose to parallelise anyway**, the only defensible cut is C8 alone —
the pure file move and root-config wiring — run concurrently with C1–C7, with C9 held back until
both have landed. C8 touches no file C1–C7 touch and depends on no decision C1–C7 make. Everything
else stays sequential.

---

## 10. Explicit non-goals for G1

Things that could plausibly be mistaken for this phase's work, with the phase that actually owns
them:

| Not in G1 | Owner |
|---|---|
| Porcelain parsing of any kind; the golden fixture corpus | G3 |
| `runner.go`'s rewrite to a streaming `Start()` | G2 |
| `fsnotify`, `repo.changed`, debounce/fan-out | G2 |
| `gitsession.Registry` refcounting, `RepoEntry`, per-connection `Walk` | G2 (registry), G6 (`Walk`) |
| `repo.list` / `repo.pick` (they need `WorkspaceRoots`/`Dialogs`, i.e. the local-port work) | G4 |
| The seven host-capability methods answered client-side | G4 |
| FlatBuffers payloads, `gitWire.fbs`, `internal/gitwire`, any `flatc` run | G3 |
| Registering the graph/review webview providers; `createProxyHandlers` | G3 |
| Dropping `preflight/*` and `undo/*` from `git-core` | G5 / G9 (D14) |
| The askpass broker and the `credential.request`/`credential.provide` relay | G7 |
| Server-owned settings (`protectedBranches`, `fetch.autoInterval`, `git.path`) | G7 (they are remote-op safety settings; SPEC's Settings-ownership section) |
| `.vsix` packaging, DMG bundling, marketplace anything | SPEC §9, not a G1 row |
| Multi-window/multi-repo hardening, disconnect-teardown matrix, perf re-baseline | G11 |
| Any embedded git UI in Kira Studio's Wails frontend beyond the pane and the prompt | out of scope for v1.3 |

---

## 11. Handed forward

Open items this phase found and deliberately did not close. Each belongs in the named phase's own
plan, not in `AGENTS.md`.

- **`rpcstream.Handlers.Stream` cannot emit a chunk** (F3.1). `session.go:33`'s signature has no
  emitter, and `handleOpen` (`:143-166`) builds a credit gate that only `handleCredit` can reach.
  **G3** must widen the signature to `func(ctx, method, params, emit func(any) error) error`, with
  `emit` doing `gate.acquire(ctx)` then `s.send(frame{T:"chunk", ID:id, Seq:seq, Chunk:…})` — the
  Go transcription of `rpc.ts:403-414`. Until then, no stream can carry data.
- **`session.Emit` is unreachable from production code** (F3.2). `Serve` returns nothing, and `Emit`
  is a method on an unexported type. **G2** needs it for `repo.changed`: `Serve` should return a
  small handle (or take a `func(*Session)` callback) exposing `Emit`.
- **`git-core`'s `preflight`/`undo` trim** (F16/D14) — the exact file list and the two surviving
  client-side symbols (`validateRefName`, `classifyReset`) are recorded in D14 for **G5**/**G9**.
- **`CONTRACT_VERSION` is duplicated across languages by hand** (D20). Deliberate, and cheap to
  keep honest while it is one integer. If the server contract ever grows a second cross-language
  constant, revisit rather than adding a third.
- **Nothing surfaces the 2.38 blocked state to a user yet.** `gitclient` classifies it
  (`discovery.go:18`, `GitStatus{kind:"tooOld"}`) and `app.init` carries it, but G1's extension has
  no UI beyond a status message (D13). **G3**, wiring the webview, gets `GitBlockedPanel.vue` for
  free — it already renders every non-`ok` kind (`discovery.go:26-28` says so).
