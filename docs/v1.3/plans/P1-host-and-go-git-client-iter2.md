# P1 iter2 — extracting the shared RPC/stream infrastructure out of the Git module

> **What this pass is.** A second planning pass over v1.3's P1 (`plans/P1-host-and-go-git-client.md`,
> shipped in 10 commits), triggered by `docs/v1.3/SPEC.md`'s "Studio / Api / Git module boundary"
> section as amended at `4d74962`. P1 correctly built a real correlated-RPC-with-credits frame
> protocol server in Go (`internal/bridge/gitstream.go`, 418 lines) because nothing in this
> codebase had one — Studio's `engine` stream (`internal/bridge/stream.go`, 43 lines) is a
> DB-specific page multiplexer with no correlation, credit or cancellation concept at all. That was
> new capability, not duplication. What the SPEC now rules out is building *that same generic
> capability* a second time when v1.2's own P12 (or any later module) wants request/response-plus-
> streaming semantics: **the protocol-generic pieces get a shared home from the point a second
> consumer is foreseeable — not duplicated, and not deferred until it arrives.**
>
> **This is a pure internal refactor. No new capability, no wire-format change, no behaviour
> change.** The bytes on the "git" stream after this pass are byte-for-byte what they are before it.
> Two things move; nothing else does.
>
> 1. **Go** — the frame-protocol machinery moves out of `internal/bridge/gitstream.go` into
>    `internal/bridge/rpcstream`, a module-agnostic package. `gitstream.go` shrinks to the adapter
>    that wires `GitService`'s methods into it.
> 2. **TypeScript** — `packages/git-ipc`'s generic halves (`rpc.ts`, `transport.ts`, `codec.ts`, and
>    the contract-independent half of `validate.ts`) move into a new `packages/ipc-core`, leaving
>    `git-ipc` holding Git's contract and the wiring that instantiates the generic layer for it.
>
> **Every claim below was re-read against the tree, not inherited from P1's prose.** Base: branch
> `claude/feature-v1-3` at `4d74962`. Line:byte citations point at that content. The central finding
> (F1) contradicts the SPEC's own summary of what `rpc.ts` is today, which is exactly why this pass
> re-read the source rather than trusting it.
>
> **The one-sentence design.** On both sides, the protocol machinery loses its knowledge of *what a
> method means* — in Go by taking two dispatch closures instead of consulting a Git handler table,
> in TypeScript by taking the contract as a type parameter and the version/vocabulary as an
> endpoint config — and each module keeps its own thin file that supplies exactly those.
>
> **§3.12 shows every seam as a diff against the real files.** The decisions in §3 are prose; §3.12
> is the same decisions rendered as before/after code, so the implementing agent transcribes them
> rather than re-deriving them from a description.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `apps/kira-studio/internal/bridge/rpcstream/frame.go` | **new** — the frame union, the versioned envelope, the wire error |
| `apps/kira-studio/internal/bridge/rpcstream/credit.go` | **new** — the credit gate |
| `apps/kira-studio/internal/bridge/rpcstream/session.go` | **new** — `Conn`, `Handlers`, `Serve`, and the per-connection session |
| `apps/kira-studio/internal/bridge/rpcstream/session_test.go` | **moved** from `bridge/gitstream_internal_test.go` |
| `apps/kira-studio/internal/bridge/gitstream.go` | 418 lines → ~115: the request table, the stream case, and `ServeGitStream` |
| `apps/kira-studio/internal/bridge/gitstream_internal_test.go` | **deleted** (its whole content moves, see above) |
| `packages/ipc-core/` | **new package** — `codec.ts`, `envelope.ts`, `shape.ts`, `contractShape.ts`, `transport.ts`, `rpc.ts`, `index.ts`, `package.json`, `tsconfig.json`, plus four moved test files (`codec`, `envelope`, `shape`, `rpc`) |
| `packages/git-ipc/src/validate.ts` | 109 → ~45 lines: `CONTRACT_VERSION`, the three key sets, and the wiring |
| `packages/git-ipc/src/endpoint.ts` | **new** — the concrete instantiation of the generic layer for `Contract` |
| `packages/git-ipc/src/index.ts` | rewritten as a barrel over `contract.ts` / `validate.ts` / `endpoint.ts` |
| `packages/git-ipc/src/contract.test.ts` | **new file, moved content** — the Git-contract half of today's `codec.test.ts` |
| `packages/git-ipc/src/{rpc,transport,codec}.ts`, `src/{rpc,codec}.test.ts` | **deleted** — content moved to `ipc-core` |
| `packages/git-ipc/package.json` | gains `"@kira/ipc-core": "workspace:*"` |
| `package.json` | `typecheck:packages` and `test:unit` gain `packages/ipc-core` |
| `biome.json` | one `packages/ipc-core/**` `noRestrictedImports` override (D10) |
| `docs/ARCHITECTURE.md` | the Git-module chapter's `gitstream.go` bullet; the package list |
| `docs/v1.3/SPEC.md` | the package-architecture table only (a `git-ipc` row rescope + an `ipc-core` row) |

### 0.2 Out of scope, explicitly

- **Any change to the wire.** The envelope, the frame union, the field names, the JSON encoding, the
  contract version (`3`), the stream name (`"git"`) — all unchanged. A frame captured before this
  pass and replayed after it must behave identically.
- **The `PackedCommitChunk` byte framing.** P1's OQ-3 was resolved after P1 landed (FlatBuffers,
  `docs/ARCHITECTURE.md`) and belongs to **P2**, which is the first phase to send a real chunk.
  Nothing here touches it.
- **Git's domain logic.** `internal/gitclient` and `packages/git-core` are not opened at all. Nor is
  `internal/bridge/git.go` — `GitService`'s method set is exactly what it was.
- **A producer for the credit gate.** `gitstream.go:136-139`'s own comment records that P1's
  `graph.stream` handler never calls `acquire` (it has nothing to walk yet, P1 §0.2). This pass
  moves the gate; it does **not** add an `emit` closure to `Handlers.Stream`, because that is new
  capability and P2's row. See F10 / OQ-1.
- **Exporting the session so a future phase can `Emit` events.** Unreachable from outside today,
  unreachable from outside after. Same reasoning; OQ-2.
- **A second consumer.** Nothing about `internal/httpclient`, `bridge/http.go` or v1.2's P12 is
  built here. This pass makes the shared layer *exist and be importable*; P12 imports it.

### 0.3 Ground rules

- **Move code, do not rewrite it.** Where a function crosses a package boundary unchanged, it
  crosses unchanged — same body, same comments (with a stale cross-reference repointed, never
  reworded for taste). The reviewable property of this diff is that almost all of it is a move.
- **No re-export shims for the old names.** `packages/git-ipc/src/rpc.ts` is *deleted*, not left
  behind re-exporting `@kira/ipc-core`. Nothing outside this repository consumes these packages, so
  there is nobody to be compatible with (`AGENTS.md`: no shortcuts). The one thing that is *not* a
  shim is `git-ipc`'s own barrel re-exporting the surface it instantiates — see D7, which draws that
  line explicitly.
- **Every existing test still passes, ideally with no edit but its import path.** Where a test file
  genuinely straddles the seam this pass introduces, §5.2 names it, names which assertions go where,
  and states the invariant: **no assertion is deleted and no assertion changes meaning.** A test
  that needs a *logic* change is a signal the split is wrong — §5.2 also says which one that would
  be, so the implementing agent can tell the two apart.
- **The module-boundary rule is unchanged and this does not weaken it.** `docs/v1.3/SPEC.md`:
  *"Module separation does not mean reimplementing infrastructure per module."* Git's contract,
  Git's domain logic and Git's UI stay exactly as separate from Studio's and Api's as they are
  today; only the transport plumbing underneath becomes shared.

---

## 1. What the tree does today

### 1.1 Go — `internal/bridge/gitstream.go`, 418 lines / 15,464 bytes

One file, one package (`bridge`), no sub-structure. Measured region by region:

| Lines | What | Size | Generic? |
|---|---|---|---|
| 1-30 | package, imports, `GitStreamName`, the file doc comment, `gitContractVersion` | 30 / 1,471 B | mixed |
| 32-39 | `gitWireError` | 8 / 349 B | **generic** |
| 41-64 | `gitFrame`, `gitEnvelope`, `boolPtr` | 24 / 1,054 B | **generic** |
| 66-76 | `toGitWireError` | 11 / 584 B | **generic** (it maps `*ipcerr.Error`, and every bound service in this repo returns one — nothing about it is Git's) |
| 78-133 | `gitRequestHandler` + the 8-entry `gitRequestHandlers` table | 56 / 2,679 B | **Git-specific** |
| 135-178 | `creditGate` (`grant`, `acquire`) | 44 / 1,308 B | **generic** |
| 180-234 | `gitStreamSession` struct, constructor, `writeLoop`, `send` | 55 / 1,735 B | **generic** |
| 236-247 | `Emit` | 12 / 660 B | **generic** |
| 249-261 | `removeActiveWork` | 13 / 575 B | **generic** |
| 263-291 | `handleRequest` | 29 / 846 B | **generic**, except the 7-line handler lookup at 270-276 (197 B) |
| 293-298 | `gitGraphStreamParams` | 6 / 339 B | **Git-specific** |
| 300-343 | `handleOpen` | 44 / 1,642 B | **generic**, except the 19-line `switch method` at 311-329 (868 B) |
| 345-365 | `handleCredit`, `handleCancel` | 21 / 350 B | **generic** |
| 367-392 | `handleRaw` (envelope decode, version guard, frame dispatch) | 26 / 1,065 B | **generic** |
| 394-403 | `close` | 10 / 249 B | **generic** |
| 405-418 | `ServeGitStream` (construct session, receive loop) | 14 / 445 B | **generic** loop, Git-named entry point |

Two supporting facts the split leans on:

- **`bridge.StreamSession` (`stream.go:13-16`) is a two-method structural interface** — `Send([]byte)
  error`, `Receive() ([]byte, error)` — that `*application.StreamConn` satisfies without
  `internal/bridge` importing Wails at all (P56 D1). `stream.go:7-12` records that the same method
  set is *independently declared* by `adapterhost.StreamSession` and that passing one where the
  other is wanted works, because Go matches interfaces structurally. A third independent declaration
  in `rpcstream` costs nothing and inherits that property.
- **`gitstream_test.go` (340 lines, package `bridge_test`) drives the wire, not the structs.** Its
  own comment (`:47-49`): *"a private mirror of gitstream.go's own unexported types … bytes in,
  bytes out, never gitstream.go's internal structs directly."* It calls exactly one symbol,
  `bridge.ServeGitStream`, plus `bridge.GitContractVersion`.
- **`gitstream_internal_test.go` (118 lines / 3,565 bytes, package `bridge`) drives the internals.**
  Three tests: `TestGitStreamSession_Emit_EventCrosses` (constructs `newGitStreamSession` directly),
  `TestCreditGate_GrantUnblocksAcquire`, `TestCreditGate_AcquireRespectsCancellation`.

### 1.2 TypeScript — `packages/git-ipc`, 8 source files / 54,377 bytes

| File | Size | What it actually is |
|---|---|---|
| `src/contract.ts` | 193 / 7,998 B | Git's contract: `HostKind`, the structural copies of `git-core`'s wire types, `GitStatus`/`RepoOpenResult`, the `Contract` map (8 requests, 2 events, 1 stream), and the eight `…Of<K>` aliases over it |
| `src/rpc.ts` | 465 / 16,128 B | `MessageChannelLike`, `WireError`/`RpcError`, the `Frame` union, `CreditGate`, `createRpcClient`, `createRpcServer` |
| `src/transport.ts` | 52 / 1,349 B | `TransportError` and the `Transport` interface |
| `src/codec.ts` | 60 / 2,188 B | `encode`/`decode`/`dedupeTransferList` and the transferable walk |
| `src/validate.ts` | 109 / 3,762 B | `CONTRACT_VERSION = 3`, the versioned envelope, and `assertContractShape` over three hardcoded key sets |
| `src/index.ts` | 43 / 979 B | the barrel |
| `src/rpc.test.ts` | 426 / 12,938 B | 9 tests over `createRpcClient`/`createRpcServer` |
| `src/codec.test.ts` | 172 / 5,942 B | 13 tests: 5 codec, 8 validate |
| `tests/wireConformance.test.ts` | 68 / 3,093 B | 3 compile-time assignability checks against `git-core`'s types by relative path |

Consumers, all of them (`grep` over the tree, `docs/` excluded — 12 import sites in 12 files):

- `packages/git-ui/src/`: `App.vue`, `main.ts`, `bridge/client.ts`, `state/repo.ts`,
  `state/settings.ts`, `state/graphView.ts`, `components/GitBlockedPanel.vue`,
  `components/gitBlockedCopy.ts`, `components/NoRepositoryPanel.vue`, `components/RepoPicker.vue`.
- `apps/kira-studio/frontend/src/git/`: `transport.ts`, `harness/mockTransport.ts`,
  `harness/scenarios.ts` (and `viewStateStore.ts` names `@kira/git-ui`, not `git-ipc`).

Every one of those is `import type` except **one**: `state/graphView.ts:3`,
`import { TransportError } from '@kira/git-ipc'`.

`apps/kira-studio/tests/ui/**` imports nothing from any of these packages. `mockGitStreamBrowser.js`
hardcodes `var CONTRACT_VERSION = 3` (`:49`) and hand-builds frame object literals; `tests/ui/git/
harness.spec.ts` and `real-runtime.spec.ts` import only `@playwright/test` and local support files.

---

## 2. Findings that shaped this plan

**F1 — `rpc.ts` is not Git-agnostic today, and this is the plan's central finding.** The SPEC's
package table calls `git-ipc` "the codec … and the one generic RPC endpoint", and the module-boundary
paragraph calls `rpc.ts`/`codec.ts`/`transport.ts` "already-generic". Read against the files, that is
true of **runtime behaviour** and true of `codec.ts` outright, but **false of the types**:

- `rpc.ts:9-18` imports eight names from `./contract` (`EventKey`, `EventPayload`, `ParamsOf`,
  `RequestKey`, `ResultOf`, `StreamChunkOf`, `StreamKey`, `StreamParamsOf`), and `rpc.ts:20-25`
  imports `assertContractShape` from `./validate`.
- `transport.ts:1-10` imports the same eight; `Transport` is declared directly over them.
- `validate.ts:1` imports three of them, and `validate.ts:48-59` **hardcodes Git's method
  vocabulary** — `'app.init'`, `'repo.list'`, `'repo.pick'`, `'repo.open'`, `'repo.close'`,
  `'graph.status'`, `'graph.loadMore'`, `'graph.refresh'`, `'repo.changed'`, `'settings.changed'`,
  `'graph.stream'`.

So the TypeScript half is **not** a file move. The contract has to become a type parameter, and the
version plus the vocabulary have to become injected values, before any of these files can compile
outside a package that knows about Git. Everything in D5/D6 exists because of this finding, and the
SPEC's summary should be read as a statement of intent rather than a description of the tree.

**F2 — `codec.ts` is the one file that moves byte-for-byte.** 60 lines / 2,188 bytes, zero imports,
zero contract knowledge, and its `collectTransferables` walk is structural. It is the whole of the
"already-generic" claim that survives inspection intact.

**F3 — the Go generic/Git split is clean and measurable.** From §1.1's table: the generic candidate
regions total **300 lines / 10,278 bytes**; subtracting the two Git-specific inner bodies that stay
behind inside otherwise-generic functions (`handleRequest:270-276`, 7 lines / 197 B;
`handleOpen:311-329`, 19 lines / 868 B) leaves **274 lines / 9,213 bytes** that move unchanged. What
stays is 103 lines / 5,073 bytes of header, `toGitWireError`, the request table and
`gitGraphStreamParams` — minus `toGitWireError`, which moves too (F3a).

**F3a — `toGitWireError` is misnamed, not Git-specific.** `gitstream.go:70-76` maps
`*ipcerr.Error` → `{code, message}` and folds everything else to `E_INTERNAL`. `ipcerr` is
`internal/bridge`'s universal IPC error type — the seventeen services `main.go` registers reference
it across 134 lines of `internal/bridge/*.go`, and none of that is Git's. So this function is
bridge-generic and moves into `rpcstream` (which therefore imports
`internal/bridge/ipcerr` — a sibling subpackage, no cycle) rather than being duplicated by the next
module. This is a small real dedup rather than a relocation.

**F4 — `gitstream_test.go` needs zero edits, and that is the strongest verification signal
available.** 340 lines of black-box wire conformance — request/response, unknown method, bad params,
stream open/end with and without error, cancel — driven entirely through `bridge.ServeGitStream` and
raw bytes (§1.1). If the Go move is correct, that file passes untouched; if a single frame's shape,
ordering or error code drifted, it fails. The acceptance checklist (§6) makes "not one line of
`gitstream_test.go` changed" an explicit item, not an incidental outcome.

**F5 — `gitstream_internal_test.go` must move wholesale.** All three of its tests target symbols
leaving the package (`newGitStreamSession`/`Emit`, `newCreditGate`/`grant`/`acquire`). It is the
only Go test file this pass edits, and the edits are: the file's location, the constructor call, the
contract-version constant it asserts against, and the event method name (D9).

**F6 — the frontend and `git-ui` can need zero import changes.** All 12 consumer import sites name
`@kira/git-ipc`, all but one are type-only, and every symbol they name (`Transport`, `HostKind`,
`GitStatus`, `RepoCandidate`, `RepoOpenResult`, `RepoSummary`, `SettingsSnapshot`, `StreamChunkOf`,
`RequestKey`, `EventKey`, `StreamKey`, `ParamsOf`, `ResultOf`, `EventPayload`, `StreamParamsOf`,
`TransportError`, `createRpcClient`, `MessageChannelLike`) is either Git's own or an instantiation
`git-ipc` can keep exporting (D7). `frontend/src/git/transport.ts:61`'s
`createRpcClient(openGitChannel())` keeps its one-argument call signature. **This is a design
constraint on the split, not a lucky outcome**: a split that forced `git-ui` to import
`@kira/ipc-core` would break the SPEC's own "`git-ui` depends on those two and on nothing else"
statement and turn a transport refactor into a UI-package change.

**F7 — `tests/ui/` is insulated by construction.** `mockGitStreamBrowser.js:49` hardcodes the
contract version and builds frames as object literals; the two `tests/ui/git/` specs import only
Playwright and local support modules; `mockRuntime.ts`/`ipcChannels.ts` carry no `GitService` FQN
entries at all (P1 §8 deviation 1). So no file under `apps/kira-studio/tests/` is touched by this
pass, and their continued passing is a real regression check rather than a tautology.

**F8 — `validate.ts:47` names a file that does not exist.** Its comment claims *"`contract.test.ts`
fails if a key here and a key in `Contract` ever drift apart"*. There is no `contract.test.ts` in
this repository (a residual of the same class P1's OQ-4 recorded), and nothing else enforces the
claim either: `ReadonlySet<RequestKey>` rejects a key that is *not* in the contract, but nothing
requires every contract key to be *listed*. The split does create a real
`git-ipc/src/contract.test.ts` (D9) — but it holds contract round-trips, not a drift guard, so the
comment must be **corrected** where it moves, to say what is actually true, rather than left
pointing at a file that now exists and still does not do what it claims. The real gap is carried as
OQ-3 rather than quietly closed inside a refactor pass.

**F9 — the naming conventions to conform to.** Go: every package under `apps/kira-studio/internal/`
is one lowercase word or a closed compound — `adapterhost`, `appcore`, `buildinfo`, `enginecache`,
`gitclient`, `httpclient`, `ipcerr`, `ipcfixture`, `localauth`, `oplog`, `preconnect` — no
underscores, no hyphens; and `internal/bridge/ipcerr` establishes that bridge-scoped infrastructure
lives as a bridge subpackage. TypeScript: `packages/git-core` / `git-ipc` / `git-ui` are
`<module>-<layer>`, where `-core` specifically means *pure, no I/O, no DOM, no framework, no host*.

**F10 — the credit gate has no producer and gains none here.** `gitstream.go:136-139` states it
plainly, and `handleOpen` creates, registers and tears down the gate without any code path reaching
`acquire`. Adding an `emit` closure would be the one genuinely new capability available in this
neighbourhood, and it is P2's (`docs/v1.3/SPEC.md`'s P2 row: chunks streaming over "`git-ipc`'s
existing stream mechanism"). Keeping it out is what makes this pass provably behaviour-preserving.

---

## 3. Decisions

### D1 — the Go package is `apps/kira-studio/internal/bridge/rpcstream`

**Name.** `rpcstream` — "a correlated RPC endpoint carried over a byte stream", which is precisely
what it is and precisely what distinguishes it from the other stream in this repo. Considered and
rejected:

- **`wailsrpc` — rejected outright.** `internal/bridge` deliberately imports no Wails
  (`stream.go:7-12`, P56 D1); its connection type is a structural two-method interface, and the
  harness/test callers that satisfy it are not Wails at all. Naming the package after a dependency
  it must never acquire would be actively misleading.
- **`ipcstream` — rejected, narrowly.** It matches the `ipcerr`/`ipcfixture`/`tests/ipc/` family
  (F9), which is a real point in its favour. But Studio's `engine` stream is also "IPC over a
  stream" and is emphatically *not* this protocol; `rpc` is the word that separates them.
- **`framerpc`, `streamrpc` — rejected** as sounding like the same thing with the words swapped, with
  no gain over `rpcstream`.

**Location.** As a subpackage of `internal/bridge`, following `internal/bridge/ipcerr`, because every
foreseeable consumer *is* a bound bridge service: Api's own stream server, if v1.2 P12 wants one,
would be `internal/bridge/httpstream.go` sitting exactly where `gitstream.go` sits. Promoting it to
`internal/rpcstream` would claim a generality (usable outside the bridge) that nothing needs. No
import cycle: `bridge` → `bridge/rpcstream` → `bridge/ipcerr`, and `ipcerr` imports neither.

### D2 — `rpcstream` exports exactly three names

`Conn`, `Handlers`, `Serve`. Everything else — the frame union, the envelope, the wire error, the
credit gate, the session and all its methods — stays unexported. Two reasons, and both are
checkable: a consumer that cannot construct a frame cannot bypass the protocol, and a three-name
surface makes "is this package generic?" answerable by reading its exported declarations rather than
its bodies.

```go
// Conn is the whole of what this protocol needs from one renderer connection. Declared here rather
// than imported so this package depends on nothing in bridge; bridge.StreamSession (and
// *application.StreamConn behind it) satisfies it structurally, the same way
// adapterhost.StreamSession and bridge.StreamSession already satisfy each other.
type Conn interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}

// Handlers is everything a module supplies to speak this protocol over its own vocabulary. The
// protocol never learns what a method means: it decodes, correlates, gates and encodes, and asks
// these two functions to do the rest.
type Handlers struct {
	ContractVersion int
	Request         func(ctx context.Context, method string, params json.RawMessage) (any, error)
	Stream          func(ctx context.Context, method string, params json.RawMessage) error
}

// Serve runs for the life of one connection and returns when the peer's side closes.
func Serve(conn Conn, h Handlers) { … }
```

`Handlers.Stream` takes no `emit` (F10 / D11). `ContractVersion` is a field rather than a package
constant because it belongs to the module's contract, not to the protocol.

### D3 — `toGitWireError` is deleted, not moved

Per F3a, `rpcstream` imports `internal/bridge/ipcerr` and owns the one `error` → wire-error mapping
(`*ipcerr.Error` straight across, everything else `E_INTERNAL` + `err.Error()`). Its behaviour is
byte-identical to today's, so `TestGitStream_UnknownRequestMethod` and
`TestGitStream_RepoOpen_MissingPathIsBadRequest` keep asserting exactly what they assert now. The
adapter keeps producing `*ipcerr.Error` values (`ipcerr.BadRequest`, `ipcerr.New`) exactly as it does
today; only the mapping to the wire moves.

### D4 — the TypeScript package is `@kira/ipc-core` at `packages/ipc-core`

**Name.** `ipc-core`. Per F9, `-core` in this repo already means *pure logic, no I/O, no DOM, no
framework, no host* — which is exactly what this package is (the channel is injected; it performs no
I/O of its own). Dropping the module prefix is the point: `git-core`/`git-ipc`/`git-ui` and a future
`api-core`/`api-ui` name modules; a package with no module prefix is not a module. And `ipc-core`
states its relationship to its first consumer in one glance: **`git-ipc` = `ipc-core` + Git's
contract.** Considered and rejected:

- **`rpc-core`** — narrower than the contents. This package holds the codec and the versioned
  envelope as well as the RPC endpoint; `ipc` is the boundary, `rpc` is one thing crossing it. It
  would also read oddly beside `git-ipc`, whose generic half it *is*.
- **`transport-core`** — `Transport` is one exported interface inside it, not the whole.
- **`@kira/wails-ipc` or any host-named variant** — the harness's channel is not Wails, the source
  project's was `postMessage`, and `ipc-core` must stay able to run under both. Same reasoning as
  D1's rejection of `wailsrpc`.

**Dependencies: none.** `packages/ipc-core/package.json` declares no `dependencies` at all, which is
the manifest-level statement of the dependency direction that `tests/wireConformance.test.ts:8-13`
already names as this repo's cheapest enforcement point.

### D5 — the contract becomes a type parameter

`ipc-core/src/contractShape.ts` declares the shape every module's contract satisfies, plus the
generic key/param algebra `git-ipc`'s `…Of<K>` aliases are currently written directly against:

```ts
export interface ContractShape {
  readonly requests: Record<string, { readonly params: unknown; readonly result: unknown }>;
  readonly events: Record<string, unknown>;
  readonly streams: Record<string, { readonly params: unknown; readonly chunk: unknown }>;
}

export type RequestKey<C extends ContractShape> = keyof C['requests'] & string;
export type EventKey<C extends ContractShape> = keyof C['events'] & string;
export type StreamKey<C extends ContractShape> = keyof C['streams'] & string;
export type ParamsOf<C extends ContractShape, K extends RequestKey<C>> = C['requests'][K]['params'];
export type ResultOf<C extends ContractShape, K extends RequestKey<C>> = C['requests'][K]['result'];
export type EventPayload<C extends ContractShape, K extends EventKey<C>> = C['events'][K];
export type StreamParamsOf<C extends ContractShape, K extends StreamKey<C>> = C['streams'][K]['params'];
export type StreamChunkOf<C extends ContractShape, K extends StreamKey<C>> = C['streams'][K]['chunk'];
```

`Transport<C>`, `Frame<C>`, `RequestHandler<C, K>`, `StreamHandler<C, K>`, `ServerHandlers<C>`,
`RpcServer<C>`, `createRpcClient<C>` and `createRpcServer<C>` all become generic over `C`. Every
function *body* in `rpc.ts` is unchanged by this: the parameterization is entirely in the signatures
and the type aliases. That is the property that keeps the move reviewable.

Git's own contract already satisfies `ContractShape` structurally as written — `contract.ts` needs
no edit whatsoever (verified by reading it: `requests` is a map of `{params, result}`, `events` a map
of payloads, `streams` a map of `{params, chunk}`).

### D6 — the version and the vocabulary become an injected endpoint config

`validate.ts`'s two responsibilities separate cleanly along the seam F1 exposes:

- **Generic (`ipc-core/src/envelope.ts`)** — `VersionedEnvelope<T>`,
  `ContractVersionMismatchError`, and version-taking `validateVersion(expected, received)`,
  `wrapVersioned(version, body)`, `unwrapVersioned(version, envelope)`. The thrown message string is
  unchanged (`ipc contract version mismatch: this build expects N, received M`).
- **Generic (`ipc-core/src/shape.ts`)** — `ContractChannel`, `ContractShapeError`, and
  `createContractShapeAsserter({ requests, events, streams })`, which returns exactly today's
  `assertContractShape` function over the key sets it is handed. The body (unknown-method check,
  non-object check, non-string-`kind` check) and every message string are unchanged.
- **Git (`git-ipc/src/validate.ts`, ~45 lines)** — `CONTRACT_VERSION = 3`, the three key sets
  verbatim from `validate.ts:48-59`, the asserter built from them, and one-argument
  `validateVersion`/`wrapVersioned`/`unwrapVersioned` bound to `CONTRACT_VERSION` so every existing
  caller's call signature is unchanged.

`createRpcClient`/`createRpcServer` take that pair as one config argument:

```ts
// declared in ipc-core/src/rpc.ts, alongside the two factories that take it
export interface EndpointConfig {
  readonly contractVersion: number;
  readonly assertShape: (channel: ContractChannel, method: string, payload: unknown) => void;
}
```

### D7 — `git-ipc` instantiates and re-exports; no consumer import changes

`git-ipc/src/endpoint.ts` (new) holds the instantiation and nothing else:

```ts
const GIT_ENDPOINT: EndpointConfig = { contractVersion: CONTRACT_VERSION, assertShape: assertContractShape };

export type Transport = CoreTransport<Contract>;
export type RequestHandler<K extends RequestKey> = CoreRequestHandler<Contract, K>;
export type StreamHandler<K extends StreamKey> = CoreStreamHandler<Contract, K>;
export type ServerHandlers = CoreServerHandlers<Contract>;
export type RpcServer = CoreRpcServer<Contract>;

export function createRpcClient(channel: MessageChannelLike): Transport {
  return coreCreateRpcClient<Contract>(channel, GIT_ENDPOINT);
}
export function createRpcServer(channel: MessageChannelLike, handlers: ServerHandlers): RpcServer {
  return coreCreateRpcServer<Contract>(channel, handlers, GIT_ENDPOINT);
}
```

**`contract.ts`'s own eight `…Of<K>` aliases are not restated here.** `RequestKey`, `EventKey`,
`StreamKey`, `ParamsOf<K>`, `ResultOf<K>`, `EventPayload<K>`, `StreamParamsOf<K>` and
`StreamChunkOf<K>` (`contract.ts:185-193`) are already written directly over `Contract` and are
structurally identical to `ipc-core`'s generic forms applied to it, so they keep working untouched
and `contract.ts` stays a zero-line diff (D8). Only the five names above, which genuinely *are*
instantiations of generic machinery, are declared in `endpoint.ts`.

`src/index.ts` stays a pure barrel over `contract.ts`, `validate.ts` and `endpoint.ts`, and — this is
the deliberate part — **keeps exporting `MessageChannelLike`, `WireError`, `RpcError`,
`TransportError`, `TransportErrorCode`, `EncodedMessage`, `encode`, `decode`, `dedupeTransferList`,
`VersionedEnvelope`, `ContractChannel`, `ContractShapeError`, `ContractVersionMismatchError`** by
re-exporting them from `@kira/ipc-core`. Result: F6's twelve consumer files change by **zero lines**,
including `frontend/src/git/transport.ts`'s `createRpcClient(openGitChannel())`.

**Why this is not the re-export shim §0.3 forbids.** A shim is a file that exists only so an old
import path keeps resolving, with no reason to exist once callers move. `git-ipc/src/index.ts` is a
module facade: `git-ipc`'s job is *"everything Git's IPC boundary is"*, and the generic pieces it
instantiates are part of that boundary. Making `git-ui` import `TransportError` from `@kira/ipc-core`
directly would add a second package to `git-ui`'s dependency list and contradict the SPEC's own
"`git-ui` depends on those two and on nothing else". The forbidden thing is
`packages/git-ipc/src/rpc.ts` surviving as a re-export file — and it does not survive at all.

### D8 — the file-by-file split

**Go.** `gitstream.go` (418) → `rpcstream/` (3 files) + `gitstream.go` (~115).

| From `gitstream.go` | To | Notes |
|---|---|---|
| `gitWireError` (32-39), `gitFrame`/`gitEnvelope`/`boolPtr` (41-64), `toGitWireError` (66-76) | `rpcstream/frame.go` | renamed `wireError`/`frame`/`envelope`/`wireErrorFrom`; imports `ipcerr` (D3) |
| `creditGate` + `newCreditGate`/`grant`/`acquire` (135-178) | `rpcstream/credit.go` | verbatim |
| session struct/ctor/`writeLoop`/`send` (180-234), `Emit` (236-247), `removeActiveWork` (249-261), `handleRequest` (263-291) less 270-276, `handleOpen` (300-343) less 311-329, `handleCredit`/`handleCancel` (345-365), `handleRaw` (367-392), `close` (394-403), the receive loop (408-418) | `rpcstream/session.go` | `gitStreamSession` → `session`; `s.svc` field replaced by `s.h Handlers`; `gitContractVersion` → `s.h.ContractVersion`; `handleRequest`/`handleOpen` call `s.h.Request`/`s.h.Stream` |
| `GitStreamName` (16), `gitRequestHandler`+table (78-133), `gitGraphStreamParams` (293-298), the `graph.stream` case body (313-325), `ServeGitStream` (408-410) | `gitstream.go` | unchanged bodies; `ServeGitStream` becomes `rpcstream.Serve(conn, rpcstream.Handlers{…})` |

Net: **274 lines / 9,213 bytes move**; `toGitWireError`'s 11 lines / 584 bytes move-and-merge;
`gitstream.go` retains ~115 lines. `ServeGitStream(svc *GitService, conn StreamSession)` keeps its
exact signature — `shell/app.go:138` and `gitstream_test.go:161` are untouched.

**TypeScript.** `packages/git-ipc` (6 source + 2 colocated test files, plus `tests/`) →
`packages/ipc-core` (7 source + 4 test) + `packages/git-ipc` (4 source + 1 colocated test, plus
`tests/` unchanged).

| From | To | Change |
|---|---|---|
| `git-ipc/src/codec.ts` | `ipc-core/src/codec.ts` | **byte-for-byte** (F2) |
| `git-ipc/src/transport.ts` | `ipc-core/src/transport.ts` | `Transport` → `Transport<C>`; the `./contract` import becomes `./contractShape` |
| `git-ipc/src/rpc.ts` | `ipc-core/src/rpc.ts` | signatures generic over `C`; `post`/`receive` take `EndpointConfig`; bodies unchanged |
| `git-ipc/src/validate.ts` envelope half (7-39) | `ipc-core/src/envelope.ts` | version becomes a parameter (D6) |
| `git-ipc/src/validate.ts` shape half (61-109) | `ipc-core/src/shape.ts` | key sets become a factory argument (D6) |
| — | `ipc-core/src/contractShape.ts` | **new**, D5's type algebra (~20 lines) |
| — | `ipc-core/src/index.ts` | **new** barrel |
| `git-ipc/src/validate.ts` Git half (7, 48-59) | `git-ipc/src/validate.ts` | ~45 lines: version, key sets, wiring |
| — | `git-ipc/src/endpoint.ts` | **new**, D7's instantiation: five type aliases and two factories (~40 lines, shown in full at 3.12) |
| `git-ipc/src/contract.ts` | *stays, unchanged* | 193 lines, not opened |
| `git-ipc/tests/wireConformance.test.ts` | *stays, unchanged* | 68 lines, not opened |
| `git-ipc/src/index.ts` | rewritten | barrel over contract/validate/endpoint + the D7 re-exports |

### D9 — where each existing test lands

Twenty-five tests exist across three files today (13 + 9 + 3, counted). Every one survives; three
test files become six, because the two `describe`-block seams in `codec.test.ts` and the one split in
D9's table each fall on a package boundary.

| Test (file › describe › name) | Destination | Edit |
|---|---|---|
| `rpc.test.ts` — all 9 tests, all helpers | `ipc-core/src/rpc.test.ts` | the `./contract` import replaced by a file-local `TestContract`; Git method names renamed to neutral ones; **every `expect` unchanged** |
| `codec.test.ts` › ipc codec › round-trips app.init request/result | `git-ipc/src/contract.test.ts` | import path only |
| `codec.test.ts` › ipc codec › round-trips repo.open request/result | `git-ipc/src/contract.test.ts` | import path only |
| `codec.test.ts` › ipc codec › round-trips repo.changed event | `git-ipc/src/contract.test.ts` | import path only |
| `codec.test.ts` › ipc codec › round-trips graph.stream chunk and transfers every buffer | **splits**: transfer-semantics half → `ipc-core/src/codec.test.ts` on a neutral 7-buffer fixture; contract-typed round-trip half → `git-ipc/src/contract.test.ts` | see below |
| `codec.test.ts` › ipc codec › dedupeTransferList throws on a buffer listed twice | `ipc-core/src/codec.test.ts` | verbatim |
| `codec.test.ts` › ipc validate › accepts a matching version / throws loudly on a version mismatch / wrap-unwrap round-trips | `ipc-core/src/envelope.test.ts` | version passed explicitly instead of read from `CONTRACT_VERSION` |
| `codec.test.ts` › ipc validate › the five `assertContractShape` tests | `ipc-core/src/shape.test.ts` | built over a neutral key set; method-name renames only |
| `tests/wireConformance.test.ts` — all 3 | unchanged, unmoved | none |

Resulting counts, which §5.1 checks: `ipc-core/src/codec.test.ts` 2, `envelope.test.ts` 3,
`shape.test.ts` 5, `rpc.test.ts` 9; `git-ipc/src/contract.test.ts` 4,
`git-ipc/tests/wireConformance.test.ts` 3. **26 = 25 + the one split.**

**The allocation rule, stated once so the table is derivable rather than memorised:** a test goes
where its subject's *behaviour* is defined, and an instantiation gets no duplicate test of its own.
That is why the five `assertContractShape` tests move wholesale to `ipc-core` rather than being
mirrored in `git-ipc` — `git-ipc/src/validate.ts` is a factory call over unchanged behaviour, and a
copy of those five assertions pointed at Git's keys would restate a short function body, which is
exactly what `AGENTS.md`'s unit-test bar rules out.

**The one deliberate split**, spelled out because §0.3 says a test needing real change is a red flag:
today's `graph.stream` transfer test does two jobs in one — it proves the codec collects seven nested
`ArrayBuffer`s and really transfers them (generic), *and* it proves `StreamChunkOf<'graph.stream'>`
survives the trip (Git). Those two jobs now live on opposite sides of a package boundary, so the test
becomes two, each keeping its own half of the existing assertions. **No assertion is deleted and none
changes meaning.** If the implementing agent finds any *other* test needing more than an import path,
a fixture's type annotation or a method-name rename — in particular if any `expect(...)` has to
change what it expects — that is the signal D5/D6 got the seam wrong, and it is a finding to record
in §8, not a cost to absorb.

**Why the neutral renames rather than keeping `repo.open`/`graph.stream` in `ipc-core`'s tests.**
Keeping them would produce a smaller diff, and it is tempting for exactly that reason. It would also
plant Git's vocabulary inside the shared package's test suite, where the next module's author reads
it as the template — the same mistake in miniature that this whole pass exists to undo.

### D10 — one lint override, in the direction that can actually go wrong

`packages/ipc-core`'s empty `dependencies` already states the rule at the manifest level, which is
where `tests/wireConformance.test.ts:8-13` says this repo enforces it. The gap that leaves is a
*relative* import (`../git-ipc/src/contract`) — precisely what `wireConformance.test.ts` itself does
in the other direction, so it is a live idiom in this tree, not a hypothetical. A `biome.json`
override for `packages/ipc-core/**` forbidding `@kira/*` and `**/git-*/**` closes it in ~14 lines and
matches the existing `frontend/src/{project,http,git}/**` override precedent exactly.

### D11 — no behaviour change, stated as a constraint rather than an aspiration

No `emit` on `Handlers.Stream` (F10). No exported session (OQ-2). No new frame kind, no new field, no
changed error code, no changed ordering, no changed goroutine discipline (one writer per session,
`req`/`open` each on their own goroutine, `credit`/`cancel` inline). No `git-core`, `git-ui`,
`gitclient`, `bridge/git.go`, `main.go`, `shell/app.go` or `frontend/src/` edit. The verification in
§5 is built around making that claim falsifiable rather than asserted.

---

### 3.12 The split, concretely

Everything above is checkable against the real files. This subsection shows the seams as diffs
against `4d74962`'s actual content, so the implementing agent transcribes rather than re-derives.
It is **not** a complete diff — the many regions that move with no edit at all are listed rather than
reproduced, precisely because "no edit at all" is the claim being made about them.

#### 3.12.1 Go — what moves untouched

These regions of `gitstream.go` arrive in `rpcstream` with **no change but their new file and the
type renames in 3.12.2's table** (`gitFrame`→`frame`, `gitEnvelope`→`envelope`,
`gitWireError`→`wireError`, `gitStreamSession`→`session`):

`creditGate`/`newCreditGate`/`grant`/`acquire` (135-178) · the session struct's `sendCh`/`done`/
`stop`/`mu`/`activeWork`/`creditGates` fields and `writeLoop`/`send` (180-234) · `Emit` (236-247) ·
`removeActiveWork` (249-261) · `handleCredit`/`handleCancel` (345-365) · `close` (394-403) ·
`handleRaw`'s decode-guard-dispatch body (367-392), except its version comparison. Their comments
travel with them; the only comment edited is `send`'s *"every gitFrame value this file ever
constructs"* → *"every frame value this package ever constructs"*.

#### 3.12.2 Go — the renames, in full

| Today (`bridge`) | In `rpcstream` | Exported? |
|---|---|---|
| `gitWireError` | `wireError` | no |
| `gitFrame` | `frame` | no |
| `gitEnvelope` | `envelope` | no |
| `toGitWireError` | `wireErrorFrom` | no |
| `creditGate` / `newCreditGate` | unchanged | no |
| `gitStreamSession` / `newGitStreamSession` | `session` / `newSession` | no |
| `gitContractVersion` (const) | `session.h.ContractVersion` (field) | — |
| `StreamSession` (imported from `bridge`) | `Conn` (declared locally) | **yes** |
| — | `Handlers` | **yes** |
| `ServeGitStream`'s receive loop | `Serve` | **yes** |

#### 3.12.3 Go — `handleRequest`, the request seam

```diff
-func (s *gitStreamSession) handleRequest(id int, method string, params json.RawMessage) {
+func (s *session) handleRequest(id int, method string, params json.RawMessage) {
 	ctx, cancel := context.WithCancel(context.Background())
 	s.mu.Lock()
 	s.activeWork[id] = cancel
 	s.mu.Unlock()
 
-	var result any
-	var err error
-	if handler, ok := gitRequestHandlers[method]; ok {
-		result, err = handler(ctx, s.svc, params)
-	} else {
-		err = ipcerr.BadRequest("unknown request method: " + method)
-	}
+	result, err := s.h.Request(ctx, method, params)
 	cancel()
 
 	if !s.removeActiveWork(id) {
 		return
 	}
 	if err != nil {
-		s.send(gitFrame{T: "res", ID: id, OK: boolPtr(false), Error: toGitWireError(err)})
+		s.send(frame{T: "res", ID: id, OK: boolPtr(false), Error: wireErrorFrom(err)})
 		return
 	}
 	resultBytes, merr := json.Marshal(result)
 	if merr != nil {
-		s.send(gitFrame{T: "res", ID: id, OK: boolPtr(false), Error: &gitWireError{Code: "E_INTERNAL", Message: merr.Error()}})
+		s.send(frame{T: "res", ID: id, OK: boolPtr(false), Error: &wireError{Code: "E_INTERNAL", Message: merr.Error()}})
 		return
 	}
-	s.send(gitFrame{T: "res", ID: id, OK: boolPtr(true), Result: resultBytes})
+	s.send(frame{T: "res", ID: id, OK: boolPtr(true), Result: resultBytes})
 }
```

The seven deleted lines reappear verbatim in `gitstream.go`'s `Handlers.Request` closure (3.12.6) —
including the exact `"unknown request method: "` string `TestGitStream_UnknownRequestMethod` matches
through.

#### 3.12.4 Go — `handleOpen`, the stream seam

```diff
-func (s *gitStreamSession) handleOpen(id int, method string, params json.RawMessage) {
-	// P1's own stream handler (graph.stream) does no asynchronous work that would ever consult
-	// ctx.Done() — it resolves synchronously below — so only cancel is kept; P2, the first stream
-	// handler with a real emit loop to cancel, is what starts reading ctx itself.
-	_, cancel := context.WithCancel(context.Background())
+func (s *session) handleOpen(id int, method string, params json.RawMessage) {
+	ctx, cancel := context.WithCancel(context.Background())
 	gate := newCreditGate()
 	s.mu.Lock()
 	s.activeWork[id] = cancel
 	s.creditGates[id] = gate
 	s.mu.Unlock()
 
-	var streamErr error
-	switch method {
-	case "graph.stream":
-		var args gitGraphStreamParams
-		if uerr := json.Unmarshal(params, &args); uerr != nil {
-			streamErr = ipcerr.BadRequest("invalid params: " + uerr.Error())
-		} else if args.RepoID == "" {
-			streamErr = ipcerr.BadRequest("repoId is required")
-		} else if _, ok := s.svc.Client.Registry.Get(args.RepoID); !ok {
-			streamErr = ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
-		}
-		// A valid open has nothing to walk yet (§0.2 …) — it falls straight through to a clean
-		// 'end' below with zero chunks emitted …
-	default:
-		streamErr = ipcerr.BadRequest("unknown stream method: " + method)
-	}
+	streamErr := s.h.Stream(ctx, method, params)
 
 	cancel()
 	s.mu.Lock()
 	delete(s.creditGates, id)
 	s.mu.Unlock()
 
 	if !s.removeActiveWork(id) {
 		return
 	}
 	if streamErr != nil {
-		s.send(gitFrame{T: "end", ID: id, Error: toGitWireError(streamErr)})
+		s.send(frame{T: "end", ID: id, Error: wireErrorFrom(streamErr)})
 		return
 	}
-	s.send(gitFrame{T: "end", ID: id})
+	s.send(frame{T: "end", ID: id})
 }
```

**One deliberate non-cosmetic change, called out rather than buried:** today the context is
discarded (`_, cancel := …`) because P1's own handler never consults it. The generic form must hand
it to `Handlers.Stream`, so it becomes `ctx`. Behaviour is identical — Git's handler still ignores
it — and the comment explaining the discard is deleted rather than moved, because it no longer
describes anything. This is the one place where the generic layer is strictly more capable than what
it replaces, and it is capability the *caller* already had and threw away, not new machinery (D11).

#### 3.12.5 Go — `handleRaw`'s version guard, and `wireErrorFrom`

```diff
-	if env.Version != gitContractVersion {
+	if env.Version != s.h.ContractVersion {
 		return // a stale build talking to a fresh one (validate.ts's own guard) …
 	}
```

```diff
-// toGitWireError maps a Go error into the wire shape — *ipcerr.Error (what every GitService
-// method already returns on failure) carries its Code/Message straight across …
-func toGitWireError(err error) *gitWireError {
+// wireErrorFrom maps a Go error into the wire shape — *ipcerr.Error (what every bound service in
+// this repo already returns on failure) carries its Code/Message straight across; anything else
+// folds to E_INTERNAL.
+func wireErrorFrom(err error) *wireError {
 	var ierr *ipcerr.Error
 	if errors.As(err, &ierr) {
-		return &gitWireError{Code: ierr.Code, Message: ierr.Message}
+		return &wireError{Code: ierr.Code, Message: ierr.Message}
 	}
-	return &gitWireError{Code: "E_INTERNAL", Message: err.Error()}
+	return &wireError{Code: "E_INTERNAL", Message: err.Error()}
 }
```

#### 3.12.6 Go — `rpcstream.Serve`, and the whole of what stays in `gitstream.go`

`rpcstream/session.go`, the loop lifted straight out of `ServeGitStream`:

```go
func Serve(conn Conn, h Handlers) {
	s := newSession(conn, h)
	defer s.close()
	for {
		raw, err := conn.Receive()
		if err != nil {
			return
		}
		s.handleRaw(raw)
	}
}
```

`gitstream.go` after — `GitStreamName`, the 8-entry `gitRequestHandlers` table (78-133, **unchanged
byte for byte**), `gitGraphStreamParams` (293-298, unchanged), and this:

```go
// ServeGitStream runs for the life of one connection: rpcstream owns the frame protocol
// (correlation, credits, cancellation, the versioned envelope); this file owns only the mapping
// from a contract method name to a GitService call.
func ServeGitStream(svc *GitService, conn StreamSession) {
	rpcstream.Serve(conn, rpcstream.Handlers{
		ContractVersion: GitContractVersion,
		Request: func(ctx context.Context, method string, params json.RawMessage) (any, error) {
			handler, ok := gitRequestHandlers[method]
			if !ok {
				return nil, ipcerr.BadRequest("unknown request method: " + method)
			}
			return handler(ctx, svc, params)
		},
		Stream: func(_ context.Context, method string, params json.RawMessage) error {
			if method != "graph.stream" {
				return ipcerr.BadRequest("unknown stream method: " + method)
			}
			var args gitGraphStreamParams
			if err := json.Unmarshal(params, &args); err != nil {
				return ipcerr.BadRequest("invalid params: " + err.Error())
			}
			if args.RepoID == "" {
				return ipcerr.BadRequest("repoId is required")
			}
			if _, ok := svc.Client.Registry.Get(args.RepoID); !ok {
				return ipcerr.New("E_NOT_FOUND", "no such open repository: "+args.RepoID)
			}
			// A valid open has nothing to walk yet (P1 §0.2: no porcelain parser, no paged
			// `git log`) — a nil return is the clean 'end' with zero chunks that tells
			// graphView's own store "0 rows, exhausted" rather than leaving it waiting.
			return nil
		},
	})
}
```

`ServeGitStream`'s signature is byte-identical to today's, which is why `shell/app.go:136-140` and
`gitstream_test.go:161` need no edit. `StreamSession` (a `bridge` interface) is passed where
`rpcstream.Conn` is wanted, which Go accepts because the method sets match — the same structural
substitution `stream.go:7-12` already documents between `bridge.StreamSession` and
`adapterhost.StreamSession`.

#### 3.12.7 TS — `codec.ts` moves with a zero-line diff

The only file on either side with no edit at all. `git diff --stat` for the move must show
`packages/git-ipc/src/codec.ts` deleted (60 lines) and `packages/ipc-core/src/codec.ts` added (60
lines), with the two byte-identical (`cmp` them, or `git show` the rename detection).

#### 3.12.8 TS — `rpc.ts`, the parameterization

Header:

```diff
 import { dedupeTransferList, encode } from './codec';
 import type {
+  ContractShape,
   EventKey,
   EventPayload,
   ParamsOf,
   RequestKey,
   ResultOf,
   StreamChunkOf,
   StreamKey,
   StreamParamsOf,
-} from './contract';
+} from './contractShape';
 import { type Transport, TransportError } from './transport';
-import {
-  assertContractShape,
-  unwrapVersioned,
-  type VersionedEnvelope,
-  wrapVersioned,
-} from './validate';
+import { unwrapVersioned, type VersionedEnvelope, wrapVersioned } from './envelope';
+import type { ContractChannel } from './shape';
```

The frame union, and the two helpers every frame goes through:

```diff
-type Frame =
+type Frame<C extends ContractShape> =
   | {
       readonly t: 'req';
       readonly id: number;
-      readonly method: RequestKey;
+      readonly method: RequestKey<C>;
       readonly params: unknown;
     }
   …
-  | { readonly t: 'evt'; readonly method: EventKey; readonly payload: unknown }
+  | { readonly t: 'evt'; readonly method: EventKey<C>; readonly payload: unknown }
   …
-      readonly method: StreamKey;
+      readonly method: StreamKey<C>;
```

```diff
-function post(channel: MessageChannelLike, frame: Frame): void {
-  const envelope = wrapVersioned(frame);
+function post<C extends ContractShape>(
+  channel: MessageChannelLike,
+  config: EndpointConfig,
+  frame: Frame<C>,
+): void {
+  const envelope = wrapVersioned(config.contractVersion, frame);
   const { payload, transfer } = encode(envelope);
   channel.post(payload, dedupeTransferList(transfer));
 }
 
-function receive(channel: MessageChannelLike, handleFrame: (frame: Frame) => void): () => void {
+function receive<C extends ContractShape>(
+  channel: MessageChannelLike,
+  config: EndpointConfig,
+  handleFrame: (frame: Frame<C>) => void,
+): () => void {
   return channel.onMessage((raw) => {
-    const envelope = raw as VersionedEnvelope<Frame>;
-    handleFrame(unwrapVersioned(envelope));
+    const envelope = raw as VersionedEnvelope<Frame<C>>;
+    handleFrame(unwrapVersioned(config.contractVersion, envelope));
   });
 }
```

The two factories, and the three call sites inside them that name the contract:

```diff
-export function createRpcClient(channel: MessageChannelLike): Transport {
+export function createRpcClient<C extends ContractShape>(
+  channel: MessageChannelLike,
+  config: EndpointConfig,
+): Transport<C> {
```
```diff
       case 'evt': {
-        assertContractShape('event', frame.method, frame.payload);
+        config.assertShape('event', frame.method, frame.payload);
```
```diff
-          channel.post(wrapVersioned<Frame>({ t: 'credit', id: frame.id, n: 1 }));
+          channel.post(
+            wrapVersioned<Frame<C>>(config.contractVersion, { t: 'credit', id: frame.id, n: 1 }),
+          );
```
```diff
-export function createRpcServer(channel: MessageChannelLike, handlers: ServerHandlers): RpcServer {
+export function createRpcServer<C extends ContractShape>(
+  channel: MessageChannelLike,
+  handlers: ServerHandlers<C>,
+  config: EndpointConfig,
+): RpcServer<C> {
```

Plus the mechanical `K extends RequestKey` → `K extends RequestKey<C>` / `ParamsOf<K>` →
`ParamsOf<C, K>` sweep across `PendingStream`, `RequestHandler`, `StreamHandler`, `ServerHandlers`,
`RpcServer` and the three `Transport` methods. **Every function body is otherwise untouched** —
`CreditGate`, `finishStream`, `handleFrame`'s five cases, the abort listeners, the supersede rule,
`dispose`. That is the property that makes this a move: `git diff --word-diff` over `rpc.ts` should
show type positions and `config.`/`<C>` insertions, and nothing else.

#### 3.12.9 TS — `transport.ts`

```diff
 import type {
+  ContractShape,
   EventKey,
   …
-} from './contract';
+} from './contractShape';
 …
-export interface Transport {
-  request<K extends RequestKey>(
-    method: K,
-    params: ParamsOf<K>,
-    signal?: AbortSignal,
-  ): Promise<ResultOf<K>>;
-
-  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void;
-
-  stream<K extends StreamKey>(
-    method: K,
-    params: StreamParamsOf<K>,
-    onChunk: (chunk: StreamChunkOf<K>) => void,
-    signal?: AbortSignal,
-  ): Promise<void>;
-
+export interface Transport<C extends ContractShape> {
+  request<K extends RequestKey<C>>(
+    method: K,
+    params: ParamsOf<C, K>,
+    signal?: AbortSignal,
+  ): Promise<ResultOf<C, K>>;
+
+  on<K extends EventKey<C>>(method: K, handler: (payload: EventPayload<C, K>) => void): () => void;
+
+  stream<K extends StreamKey<C>>(
+    method: K,
+    params: StreamParamsOf<C, K>,
+    onChunk: (chunk: StreamChunkOf<C, K>) => void,
+    signal?: AbortSignal,
+  ): Promise<void>;
+
   dispose(): void;
 }
```

`TransportError`/`TransportErrorCode` move with a zero-line diff. The doc comment above `Transport`
keeps its meaning but loses its Git examples: *"Kira Studio's host … and the harness's mock bridge
both satisfy it"* becomes a statement about hosts in general, with the Git instance named in
`git-ipc/src/endpoint.ts` instead.

#### 3.12.10 TS — `validate.ts` becomes three files

`ipc-core/src/envelope.ts` — the version stops being a constant:

```diff
-export const CONTRACT_VERSION = 3;
-
 export class ContractVersionMismatchError extends Error {
   readonly received: number;
+  readonly expected: number;
 
-  constructor(received: number) {
+  constructor(expected: number, received: number) {
     super(
-      `ipc contract version mismatch: this build expects ${CONTRACT_VERSION}, received ${received}`,
+      `ipc contract version mismatch: this build expects ${expected}, received ${received}`,
     );
     this.name = 'ContractVersionMismatchError';
     this.received = received;
+    this.expected = expected;
   }
 }
 
-export function validateVersion(received: number): void {
-  if (received !== CONTRACT_VERSION) {
-    throw new ContractVersionMismatchError(received);
+export function validateVersion(expected: number, received: number): void {
+  if (received !== expected) {
+    throw new ContractVersionMismatchError(expected, received);
   }
 }
```
(`wrapVersioned`/`unwrapVersioned` take the version the same way; `VersionedEnvelope<T>` is
unchanged.)

`ipc-core/src/shape.ts` — the key sets stop being literals:

```diff
-const REQUEST_KEYS: ReadonlySet<RequestKey> = new Set([ 'app.init', … 'graph.refresh' ]);
-const EVENT_KEYS: ReadonlySet<EventKey> = new Set(['repo.changed', 'settings.changed']);
-const STREAM_KEYS: ReadonlySet<StreamKey> = new Set(['graph.stream']);
+export interface ContractKeys {
+  readonly requests: ReadonlySet<string>;
+  readonly events: ReadonlySet<string>;
+  readonly streams: ReadonlySet<string>;
+}
 
-function keysForChannel(channel: ContractChannel): ReadonlySet<string> {
+function keysForChannel(keys: ContractKeys, channel: ContractChannel): ReadonlySet<string> {
   switch (channel) {
-    case 'request': return REQUEST_KEYS;
-    case 'event':   return EVENT_KEYS;
-    case 'stream':  return STREAM_KEYS;
+    case 'request': return keys.requests;
+    case 'event':   return keys.events;
+    case 'stream':  return keys.streams;
   }
 }
 
-export function assertContractShape(channel: ContractChannel, method: string, payload: unknown): void {
-  if (!keysForChannel(channel).has(method)) {
-    throw new ContractShapeError(channel, method, `unknown ${channel} method`);
-  }
-  …
-}
+export function createContractShapeAsserter(keys: ContractKeys) {
+  return (channel: ContractChannel, method: string, payload: unknown): void => {
+    if (!keysForChannel(keys, channel).has(method)) {
+      throw new ContractShapeError(channel, method, `unknown ${channel} method`);
+    }
+    …  // the remaining two checks and all three message strings, unchanged
+  };
+}
```

`git-ipc/src/validate.ts` after — the whole file, ~45 lines:

```ts
import {
  createContractShapeAsserter,
  unwrapVersioned as unwrapAtVersion,
  validateVersion as validateAtVersion,
  type VersionedEnvelope,
  wrapVersioned as wrapAtVersion,
} from '@kira/ipc-core';
import type { EventKey, RequestKey, StreamKey } from './contract';

/** Bumped whenever the frame union or a contract entry changes; bridge/git.go's
 *  GitContractVersion mirrors it, and internal/bridge/rpcstream carries it as a Handlers field. */
export const CONTRACT_VERSION = 3;

export const validateVersion = (received: number): void =>
  validateAtVersion(CONTRACT_VERSION, received);
export const wrapVersioned = <T>(body: T): VersionedEnvelope<T> =>
  wrapAtVersion(CONTRACT_VERSION, body);
export const unwrapVersioned = <T>(envelope: VersionedEnvelope<T>): T =>
  unwrapAtVersion(CONTRACT_VERSION, envelope);

// The complete method-name lists, mirroring Contract's keys — the runtime half of a guarantee
// TypeScript cannot make across a wire. NOTE (F8): the ReadonlySet<RequestKey> annotation rejects a
// key that is not in Contract, but nothing here requires every Contract key to be listed; OQ-3
// carries that gap.
const REQUEST_KEYS: ReadonlySet<RequestKey> = new Set([
  'app.init', 'repo.list', 'repo.pick', 'repo.open',
  'repo.close', 'graph.status', 'graph.loadMore', 'graph.refresh',
]);
const EVENT_KEYS: ReadonlySet<EventKey> = new Set(['repo.changed', 'settings.changed']);
const STREAM_KEYS: ReadonlySet<StreamKey> = new Set(['graph.stream']);

export const assertContractShape = createContractShapeAsserter({
  requests: REQUEST_KEYS,
  events: EVENT_KEYS,
  streams: STREAM_KEYS,
});
```

Every existing caller of `wrapVersioned(x)` / `unwrapVersioned(e)` / `validateVersion(n)` /
`assertContractShape(c, m, p)` keeps its exact call signature — which is what lets `rpc.test.ts`'s
`wrapVersioned({ t: 'res', … })` and `codec.test.ts`'s `validateVersion(CONTRACT_VERSION)` move
without an argument-list edit.

#### 3.12.11 TS — `git-ipc/src/index.ts`, before and after

Before (43 lines, everything sourced locally):

```ts
export type { EncodedMessage } from './codec';
export { decode, dedupeTransferList, encode } from './codec';
export type { Contract, DecorationRef, /* … 18 more … */ } from './contract';
export type { MessageChannelLike, RequestHandler, RpcServer, ServerHandlers, StreamHandler, WireError } from './rpc';
export { createRpcClient, createRpcServer, RpcError } from './rpc';
export type { Transport, TransportErrorCode } from './transport';
export { TransportError } from './transport';
export type { ContractChannel, VersionedEnvelope } from './validate';
export { assertContractShape, CONTRACT_VERSION, /* … */ } from './validate';
```

After — the same public surface, sourced from three places instead of four:

```ts
// Git's own contract — the only thing in this package that is about Git. This line is unchanged
// from today's, all 20 names included: contract.ts is a zero-line diff (D8).
export type { Contract, DecorationRef, /* … the same 20 names, unchanged … */ } from './contract';
export {
  assertContractShape, CONTRACT_VERSION, unwrapVersioned, validateVersion, wrapVersioned,
} from './validate';

// The five names that genuinely are instantiations of the generic machinery (D7).
export type { RequestHandler, RpcServer, ServerHandlers, StreamHandler, Transport } from './endpoint';
export { createRpcClient, createRpcServer } from './endpoint';

// Contract-independent machinery, re-exported so `git-ui` still depends on exactly two packages
// (docs/v1.3/SPEC.md). Not a compatibility shim — see D7: the files themselves are gone, this is
// the module facade naming what its own IPC surface includes.
export type {
  ContractChannel, EncodedMessage, MessageChannelLike, TransportErrorCode, VersionedEnvelope,
  WireError,
} from '@kira/ipc-core';
export {
  ContractShapeError, ContractVersionMismatchError, decode, dedupeTransferList, encode, RpcError,
  TransportError,
} from '@kira/ipc-core';
```

Checkable claim, and the last thing to verify before committing C2: **the set of names
`packages/git-ipc/src/index.ts` exports after this pass is exactly the set it exports today** —
same names, same value-vs-type split, only the source module differs for eleven of them. Diff the
two export lists mechanically; a name that vanished is a consumer that will fail to resolve, and a
name that appeared is scope creep.

---

## 4. Implementation order

Commits land incrementally; fast checks (`go build`, `go vet`, `bun run typecheck`, `bun run lint`)
run per commit, and the expensive `test:ui` suite runs once near the end, per `AGENTS.md`.

| # | Commit | Why here, and why not smaller |
|---|---|---|
| **C1** | `refactor(bridge): extract the generic frame protocol into internal/bridge/rpcstream` — create `rpcstream/{frame,credit,session}.go` from D8's table, rewrite `gitstream.go` as the adapter, move `gitstream_internal_test.go` → `rpcstream/session_test.go`. `gitstream_test.go` untouched | The Go half is one atomic move: leaving the old code in place for a commit would mean two live implementations of the same protocol, which is the exact thing this pass exists to prevent. Landing it first also means the cheapest, most self-contained half is verifiable (`go test ./apps/kira-studio/internal/bridge/...`) before any TypeScript moves |
| **C2** | `refactor(ipc): extract the generic RPC endpoint into packages/ipc-core` — create the package (D8's TS table), reduce `git-ipc` to contract + validate + endpoint + barrel, move the tests per D9, add `@kira/ipc-core` to `git-ipc`'s manifest, add `packages/ipc-core` to root `typecheck:packages` and `test:unit`, add D10's `biome.json` override, run `bun install` for the workspace symlink | Also atomic, and for the same reason plus a stronger one: `git-ipc/src/rpc.ts` cannot be deleted before `ipc-core/src/rpc.ts` exists, and cannot survive alongside it without being the forbidden shim. The colocated `*.test.ts` files move with their subjects by construction |
| **C3** | `refactor(git): confirm consumers need no import changes` — **expected to be an empty diff.** If it is not empty, F6/D7 were wrong somewhere and the fix lands here with the reason recorded in §8 | Deliberately a named step rather than an assumption. §5's checks make the empty case provable; a non-empty case is a finding, and a finding wants its own commit and its own explanation |
| **C4** | `docs: the shared RPC layer in ARCHITECTURE.md and the SPEC's package table` — `docs/ARCHITECTURE.md`'s Git-module chapter (the `gitstream.go` bullet at `:908-915` now names `rpcstream` as the shared layer and `gitstream.go` as the adapter; the package paragraph at `:840-854` gains `ipc-core`), and `docs/v1.3/SPEC.md`'s package-architecture table (the `git-ipc` row loses "the codec … and the one generic RPC endpoint", a new `ipc-core` row gains it) | The tree is authoritative and the docs follow it, exactly as P1's own C11 did. `docs/v1.3/SPEC.md`'s module-boundary *paragraph* needs no edit — it already names this plan file and describes this outcome |

Not a commit: the full-suite verification pass (§5), run once after C4.

---

## 5. Verification

### 5.1 Commands, all of which must pass

| Check | Expectation |
|---|---|
| `go build ./apps/kira-studio/...` | green |
| `go vet ./apps/kira-studio/...` | green |
| `go test ./apps/kira-studio/internal/bridge/...` | green — **and `gitstream_test.go`'s 7 tests pass with the file unedited** (F4) |
| `go test ./apps/kira-studio/internal/...` | green, unchanged count elsewhere |
| `bun install` | adds the `@kira/ipc-core` workspace symlink; `bun pm ls` lists four `@kira/*` packages |
| `bun run typecheck` | green — all four projects, including the new `packages/ipc-core/tsconfig.json` |
| `bun run lint` | green, including D10's new override |
| `bun run test:unit` | green — **25 `test(...)` calls in `packages/git-ipc` before (13 + 9 + 3, counted); 26 across `packages/ipc-core` + `packages/git-ipc` after**, the +1 being D9's one deliberate split. Any other delta is a deleted or invented test and must be explained in §8 |
| `bun run build` and `bun run build:test` | green; `layout.worker` still emitted as its own chunk |
| `bun run test:ui` | green — Studio's, Api's and Git's specs all unchanged. `budgets.spec.ts`/`perf.spec.ts` retain P1 §7's documented sandbox-contention caveat; rerun those alone if they flake |

### 5.2 The test-file audit, stated explicitly

This is the section the implementing agent fills in honestly rather than skips.

- **Unedited, and must stay unedited:** `apps/kira-studio/internal/bridge/gitstream_test.go` (340
  lines), `packages/git-ipc/tests/wireConformance.test.ts` (68 lines), every file under
  `apps/kira-studio/tests/` (F7), `packages/git-core/**` and `packages/git-ui/**`.
- **Moved with mechanical edits only:** `gitstream_internal_test.go` → `rpcstream/session_test.go`
  (constructor call, version constant, event method name); `rpc.test.ts` → `ipc-core/src/rpc.test.ts`
  (file-local `TestContract`, method-name renames); the codec/envelope/shape test blocks per D9.
- **Split, once, deliberately:** the `graph.stream` transfer test (D9's "one deliberate split").
- **The red-flag condition:** any `expect(...)` whose expected value, matcher or count changes. If
  that happens, stop and record it — §0.3.

### 5.3 The behaviour-preservation checks that are not just "tests pass"

- **Frame-level:** `gitstream_test.go` covers `req`→`res` ok, `req`→`res` error, unknown method,
  bad params, `open`+`credit`→`end` clean, `open`→`end` with `E_NOT_FOUND`, and `cancel`. Passing it
  unedited is a byte-level statement about the wire.
- **`git-ui` is untouched, and P1's own exit criterion still holds:** `git status --short packages/
  git-core packages/git-ui` must be empty for the whole pass. (`packages/git-ipc` *does* change here,
  for the first time since kickoff — that is this pass's one deliberate exception to P1's "zero
  changes under all three", and it is why the exception is stated rather than discovered.)
- **The dev-only `git-ui` route and the frontend `Transport` adapter are unaffected — verify, do not
  assume.** `frontend/src/git/transport.ts` is expected to be byte-identical (F6);
  `git-dev.html?scenario=<name>`'s six scenarios must still mount and render
  (`tests/ui/git/harness.spec.ts`), and `tests/ui/git/real-runtime.spec.ts` must still drive real
  frames over the real stream. Both are `test:ui` specs, so §5.1's run covers them — the requirement
  here is that **neither spec file is edited** to make them pass.
- **A grep-level check worth running once:** no file under `packages/ipc-core/` contains the strings
  `git`, `repo.`, `graph.` or `@kira/` outside a comment. D10's lint rule covers imports; this covers
  vocabulary that leaked into a type name or a test fixture.

---

## 6. Acceptance checklist

For the implementing agent to fill in, by running each item rather than inspecting for it.

- [ ] `internal/bridge/rpcstream` exists with exactly three exported names (`Conn`, `Handlers`,
      `Serve`) — checked with `go doc ./apps/kira-studio/internal/bridge/rpcstream`.
- [ ] `rpcstream` imports only `context`, `encoding/json`, `errors`, `sync` and
      `internal/bridge/ipcerr` — no `gitclient`, no `bridge`, no Wails.
- [ ] `gitstream.go` is under 130 lines and contains no frame, envelope, credit, correlation or
      cancellation logic — only `GitStreamName`, the request table, the stream case and
      `ServeGitStream`.
- [ ] `ServeGitStream`'s signature is unchanged; `shell/app.go` and `main.go` are unedited.
- [ ] `apps/kira-studio/internal/bridge/gitstream_test.go` shows **zero** lines changed in
      `git diff` across the whole pass, and its tests pass.
- [ ] `packages/ipc-core/package.json` declares no `dependencies`.
- [ ] `packages/git-ipc/src/` contains exactly `contract.ts`, `validate.ts`, `endpoint.ts`,
      `index.ts`, `contract.test.ts` — no `rpc.ts`, no `transport.ts`, no `codec.ts`, and no file
      whose body is only re-exports of `@kira/ipc-core` (§0.3).
- [ ] `packages/git-ipc/src/contract.ts` and `packages/git-ipc/tests/wireConformance.test.ts` show
      zero changed lines.
- [ ] `packages/ipc-core/src/codec.ts` is byte-identical to the deleted
      `packages/git-ipc/src/codec.ts` (3.12.7 — `cmp` them against `4d74962`).
- [ ] The set of names exported by `packages/git-ipc/src/index.ts` is unchanged — same names, same
      type-vs-value split, only the source module differs (3.12.11).
- [ ] `git diff --stat packages/git-core packages/git-ui apps/kira-studio/frontend/src
      apps/kira-studio/tests` is empty across the whole pass (C3's expected-empty commit).
- [ ] `bun pm ls` lists `@kira/ipc-core`; `bun run typecheck`, `bun run lint`, `bun run test:unit`,
      `bun run build`, `bun run build:test` all green.
- [ ] `go build ./apps/kira-studio/...`, `go vet ./apps/kira-studio/...`,
      `go test ./apps/kira-studio/internal/...` all green.
- [ ] `bun run test:ui` green, with no spec file edited (P1's own `budgets`/`perf` sandbox caveat
      still allowed, rerun in isolation to confirm).
- [ ] §5.3's grep check over `packages/ipc-core/` returns nothing.
- [ ] `docs/ARCHITECTURE.md` and `docs/v1.3/SPEC.md`'s package table describe the two-layer shape;
      the SPEC's module-boundary paragraph is unedited.
- [ ] §8 below records every deviation from D1-D11 and C1-C4, with its reasoning, or states plainly
      that there was none.

---

## 7. Open questions, carried forward rather than guessed

- **OQ-1 — where `emit` lands when P2 needs it.** `Handlers.Stream` deliberately takes no emit
  closure (F10/D11). P2 has two shapes available: add
  `emit func(ctx context.Context, chunk any) error` as a third argument to `Handlers.Stream` (the
  gate is already there, and it mirrors `rpc.ts`'s `StreamHandler` ctx exactly), or hand the handler
  a small `Stream` value carrying `Emit`. The second reads better once a handler needs both `emit`
  and the stream id; the first is a smaller change. **P2 decides, against its real emit loop** — not
  now, on a guess about what a paged `git log` walk will want.
- **OQ-2 — how a future phase reaches `Emit` to send `repo.changed`.** The session is unexported
  today and stays unexported; `bridge/git.go` has no way to emit an event onto a live stream.
  Whichever phase first wires `gitclient.Watcher` into `repo.changed` (P2's row) needs `Serve` to
  hand back a handle, or `Handlers` to receive an emitter callback at construction. Deferring this is
  what keeps the present pass a pure move; it is a real gap, not a resolved one.
- **OQ-3 — key-set totality is still unenforced.** F8: `validate.ts`'s key sets are checked for
  *validity* by their `ReadonlySet<RequestKey>` annotation but not for *totality*, and the comment
  claiming otherwise now at least names a file that exists. A compile-time totality check is a few
  lines of mapped type, but adding it inside a refactor pass would mix a behaviour change into a
  move. Belongs to P2 (which adds the first new contract keys since kickoff) or to P11's review.
- **OQ-4 — whether Api's split should also produce a `packages/api-ipc`.** v1.2's P12 splits Api into
  workspace packages and "may well want the same request/response-plus-streaming shape"
  (`docs/v1.3/SPEC.md`). If it does, the symmetric answer is an `api-ipc` holding Api's contract and
  depending on `ipc-core`, plus an `internal/bridge/httpstream.go` adapter over `rpcstream` — but
  whether Api's HTTP/gRPC surface actually needs a *stream* at all, rather than only bound calls, is
  P12's question to answer against its own requirements. This pass makes that choice cheap; it does
  not make it.
- **OQ-5 — whether the Go and TS halves should be conformance-checked against each other.**
  `rpcstream` and `ipc-core` are two implementations of one protocol kept in step by reading them
  side by side (`gitstream.go:18-24`'s own stated discipline, which moves with the code). A parity
  test in the spirit of `tests/unit/go-ts-vocabulary-parity.spec.ts` is now *possible* for the first
  time, since both halves are single-purpose packages rather than module-embedded files. Whether it
  earns its keep against `AGENTS.md`'s unit-test bar is a question for P11's review, once there is a
  second consumer to make drift more than hypothetical.

---

## 8. Findings

*(To be filled in by the implementing agent: deviations from D1-D11 or C1-C4 with their reasoning,
anything §5.2's red-flag condition caught, and the final measured line/byte counts against §1.1's
and D8's predictions. A pass that finds nothing real should say so plainly rather than manufacture a
finding.)*
