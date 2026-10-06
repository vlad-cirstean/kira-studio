# P168 Part 17: review plan, Space git RPC, socket server and `git-ipc` contract

Chunk B4, Stream B position 4 of 10 (pre-plan `P168-prep-plan.md` §5.16). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§10).
Tree surveyed: `30ec62f` (`p168-stream-b`, on `v2.0` with Part 16 fixes landed).

Paths repo-relative. `PI` = `apps/kira-space/internal`, `GR` = `PI/gitrpc`, `GK` = `PI/gitsock`,
`GV` = `PI/gitvsix`, `IPC` = `packages/git-ipc`. Line numbers are as of `30ec62f`; re-read before
citing.

SPEC row and orchestrator agree on this file name (`P168-part17-git-rpc.md`).

## 0. Gates waived, and the routing tag

User decision for this stream: gates G0 and G1 (pre-plan §3.2) stay **waived**. The orchestrator
also **waives G2** (Part 17 starts only after Part 9, the shared frontend base, landed) for Stream
B. Part 8 (shared Go base) and Part 9 are not yet reviewed. Consequences:

- `IPC` production code imports no `@workbench` module. The only `@workbench` import is a test
  helper (`rpc.test.ts`: `@workbench/testing/unit/async`). So the G2 waiver leaves no production
  `IPC` path on an unreviewed base. TS callers in `git-ui` and Space `frontend` do use `@workbench`;
  they are read only as far as a wire-contract claim goes.
- Root `internal/*` callees (`rpcstream`, `ipcerr`, `notify`, `tokenauth`, `toolexec`, `testx`)
  are **unreviewed callees**. Read them as far as a Part 17 contract depends on them. A bug inside
  them is a valid finding when it breaks a Part 17 caller.
- **Any finding whose fix needs a file owned by another Part** carries
  `needs-other-part-file: <path> (Part N)`. The orchestrator routes it.
  - Stream A file (Parts 2-9: root `internal/**`, `scripts/**` except the two VS Code scripts, root
    config, `packages/{workbench,theme,kira-ui,shared,api-core}`) or Stream C file (Parts 10-13):
    the Stream B fixer never edits it. The orchestrator appends it to
    `docs/v2.0/plans/P168-routed-from-streamB.md` (same entry shape as
    `P168-routed-to-stream-a.md`).
  - Stream B file (Parts 14-16 closed, 18-23 later): same stream, sequential. The fixer may edit it
    when a Part 17 fix requires it, and names each such file in the commit body. The tag still
    names it. Typical: `git-ui` error display (Parts 18-19), `bridge/gitstream.go` and `main.go`
    (Part 22), `vscode/src/{connection,proxyHandlers}.ts` (Part 23), `gitsession` sentinels
    (Part 16).

Routed files: `P168-routed-from-streamA.md`, `P168-routed-from-streamC.md` and
`P168-routed-to-stream-a.md` hold no item owned by Part 17 (checked at `30ec62f`).

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Call `mcp__codegraph__codegraph_explore` with
  `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. If the tool is not listed, load it with `ToolSearch "codegraph"`. The
  orchestrator greps the run's tool log for real calls. Index: run `sh scripts/codegraph-setup.sh`
  in the worktree if `.codegraph/` is missing or older than HEAD (present at `30ec62f`). Seeds per
  block (§10):
  1. Error mapping: `mapGitError`, `mapConnError`, `mapDetailError`, `mapStashError`,
     `camelToSnake`, `handleRepoCall`, `handleCall`, `requireNonEmpty`, `rpcstream.wireErrorFrom`,
     `wireError`, `ipcerr.New`/`BadRequest`; TS `RpcError`, `toWireError`, `TransportError`,
     `workbench/bridge/rpc.ts` `unwrap` (contrast only).
  2. Router and handlers: `Router`, `New`, `ForConn`, `requestHandlers`, `handleAppInit`,
     `handleRepoOpen`, `handleRepoClose`, `graph.go` (`walkSpecFrom`, `rangedWalkSpecFrom`,
     `resolveWalkRequest`, `handleGraphStatus`/`LoadMore`/`Refresh`/`Stream`), `detail.go`,
     `refs.go`, `search.go`, `gh.go`, `wire.go` (`MarshalJSON`, `ghStatusFrom`, `prRecordFrom`).
  3. Write handlers and validation: `ops.go`, `reset.go`, `stash.go` (`validStashScope`),
     `remote.go` (`validPullStrategy`, `handleCredentialProvide`), `stack.go`, `worktree.go`,
     `review.go` (`validRefArg`), `comments.go` (`validObjectID`, `validReviewScope`,
     `normalizeCommentBody`), `incremental.go`, `settings.go` (`setRepoSettings`,
     `SetRepoSettings`, `toModel`, `handleSettingsSetGitPath`).
  4. Socket server: `Server` (`Start`, `acceptLoop`, `trackConn`, `untrackConn`, `handleConn`,
     `addConn`, `removeConn`, `Revoke`, `Close`, `expireLoop`), `runHandshake`, `watchDisconnect`,
     `finishPairing`, `verifyClientToken`, `clampLabel`, `Broker` (`Request`, `Approve`, `Deny`,
     `answer`, `Cancel`, `TakeApprovedToken`, `ExpireOverdue`, `Shutdown`), `AcquireLock`,
     `readFrame`/`writeFrame`, `conn`, `mintToken`/`verifyToken`, `tokenauth.Mint`/`Verify`;
     callers `bridge/gitclients.go`, `main.go` (`wireGit`, shutdown).
  5. TS transport: `createRpcClient`, `createRpcServer`, `CreditGate`, `finishStream`,
     `handleFrame` (both sides), `createSocketChannel` (`drainFrames`, `deliverFrame`,
     `deliverBlobFrame`, `MAX_PENDING_FRAMES`), `createStreamChannel` (`decodeFrame`),
     `parseBlobFrameBody`, `substituteBlobRoot`, `codec.ts` (`encode`, `decode`,
     `encodeBuffers`, `decodeBuffers`, `dedupeTransferList`, `encodeStreamPayload`,
     `decodeStreamPayload`), `validate.ts` (`wrapVersioned`, `unwrapVersioned`,
     `assertContractShape`, key maps), `graphChunkCodec.ts` (`toWire`, `fromWire`); Go side
     `rpcstream.Session` (`handleRequest`, `handleOpen`, credit, `Emit`), `bridge.ServeGitStream`.
  6. Contract parity: `contract.ts` (2,384 lines) against `GR/wire.go` (806), `contract.go`,
     `requestHandlers`; `gitwire.fbs` against generated `IPC/src/generated` and `PI/gitwire`.
  7. VSIX: `Installer` (`Install`, `Status`, `vsixPath`, `locateCode`, `locateOpen`,
     `detailFor`), `exec.go`, `toolexec`; caller `bridge/gitclients.go`.
- **CodeGraph over-links names.** `Status`, `Install`, `Close`, `Server`, `Request`, `Handlers`,
  `Frame`, `RpcError`, `BadRequest`, `Error` also exist in Studio (`grpcclient`, `mcpinstall`,
  `page/wire`), `ghclient`, `gitclient`, `appupdate`, `shared/protocol/wire`. Confirm every
  cross-package claim with `git grep` of Go import lines (Go's `internal/` rule makes those
  authoritative) and of TS `from '@kira/git-ipc'` lines.
- **Real git 2.43.0 probes** (`/usr/bin/git`) only where a handler claim turns on git's behaviour.
  Run with `HOME` and `GIT_CONFIG_GLOBAL` pointed at the scratchpad (P154 isolation).
- **Wire probes** as throwaway `_test.go` in `GK` (real socket via existing `pairAndReady*`
  helpers) or throwaway `.test.ts` in `IPC`, deleted before the findings commit, never committed.
  Prefer a probe over prose for every framing, back-pressure or race claim. Run Go probes with
  `-race`.
- **Checks:** `go vet` and `go test -race -count=1` over
  `./apps/kira-space/internal/{gitrpc,gitsock,gitvsix}/...` (clean at `30ec62f`: gitrpc 6.3 s,
  gitsock 82.1 s, gitvsix 1.0 s); `bun test packages/git-ipc/src` (58 pass, 0 fail);
  `bun run typecheck:git`. If a finding touches a caller, also
  `./apps/kira-space/internal/bridge/...`. If missing deps or bindings fail a check:
  `bun install --frozen-lockfile` and `bun run setup` (or `sh scripts/prepare-worktree.sh`). A red
  check is a finding.

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `30ec62f`.

**Part 17 drift: 85 files (unchanged), 23,577 to 23,594 code lines (tests 14,003 unchanged).**
Cause: one commit since `f40cd35` touches Part 17 files, Part 16 fixer `11f097d` (`GR/graph.go`
+5/-1, `GR/handlers.go` +13). Detail in §7.

Drift elsewhere since Part 16's plan (`088fd66`):
- Part 16: 52 to 53 files, 18,911 to 19,279 (tests 8,769 to 8,994). Part 16 fixes.
- Part 15: 15,595 to 15,641 (`61774dd`, `gitops/errors.go`).
- Parts 2-4, 10, 13: Stream A/C fixes landed on `v2.0` (Part 3 27,825; Part 4 16,747; Part 10
  23,917; Part 13 26,779).
- Totals: streams A 257,676, B 183,492; 2,887 owned, 0 orphans, 3,524 tracked (docs 484).

## 3. Own file set (85 files)

39 production code files (9,591 lines), 41 test files (14,003), plus `package.json`,
`tsconfig.json`, two `testdata` files and one test key (non-code).

- **`GR`** (19 prod, 3,496; 13 tests, 2,820): `wire` 806, `handlers` 444, `graph` 278, `detail`
  233, `comments` 197, `contract` 172, `remote` 154, `incremental` 153, `settings` 153, `stash` 144,
  `worktree` 119, `refs` 100, `handle` 98, `search` 97, `stack` 92, `ops` 82, `gh` 64, `reset` 57,
  `review` 53. Tests: `settings_test` 416, `stack_test` 373, `handlers_test` 369, `reset_test` 321,
  `stash_test` 236, `gh_test` 222, `detail_test` 214, `worktree_test` 193, `search_test` 174,
  `remote_test` 112, `graph_test` 102, `smoketest_test` 78, `main_test` 10. No test for `ops.go`,
  `refs.go`, `comments.go`, `incremental.go`, `review.go`, `handle.go` (covered from `GK`).
- **`GK`** (7 prod, 1,231; 23 tests, 9,213): `pairing` 399, `server` 356, `handshake` 305, `frame`
  86, `lock` 35, `token` 29, `clients` 21. Tests: `remote_test` 991, `integration_test` 862,
  `matrix_test` 767, `graphstream_test` 760, `ops_test` 701, `incremental_test` 647, `review_test`
  524, `pairing_test` 490, `comments_test` 488, `handshake_test` 484, `detail_test` 459,
  `revoke_test` 407, `perf_test` 402, `stash_test` 283, `recovery_test` 215,
  `recovery_support_test` 202, `frame_test` 141, `matrix_support_test` 112, `settings_test` 83,
  `token_test` 67, `fixture_scaffold_test` 57, `server_test` 48, `main_test` 23. Plus
  `testdata/keys/fixtureSigningKey`.
- **`GV`** (2 prod, 249; 1 test, 276): `install` 237, `exec` 12; `install_test` 276.
- **`IPC`** (11 prod incl. schema, 4,615; 4 tests, 1,694): `src/contract.ts` 2,384, `rpc.ts` 514,
  `validate.ts` 357, `codec.ts` 328, `graphChunkCodec.ts` 294, `socketChannel.ts` 236,
  `streamChannel.ts` 173, `index.ts` 137, `blobFrame.ts` 90, `schema/gitwire.fbs` 52,
  `transport.ts` 50. Tests: `rpc.test` 645, `socketChannel.test` 473, `codec.test` 366,
  `streamChannel.test` 210. `testdata/graphChunkFrame.{bin,json}`. No test for `validate.ts`,
  `blobFrame.ts`, `graphChunkCodec.ts` directly (mirror fixture via `codec.test`).
- Excluded: `IPC/src/generated/**` and `PI/gitwire/**` (generated from `gitwire.fbs`).

## 4. One hop: callers (git grep of import lines)

Go production importers, symbol level:

- **`GR`**: `GK/server.go` (`Router.ForConn`, `ContractVersion`), `GK/handshake.go`
  (`Protocol`, `ContractVersion`); `bridge/gitstream.go` (Part 22: `ServeGitStream` wraps
  `ForConn` handlers in `guardRepoSettingsSet(allowedRequest(...))`, `allowedStream`);
  `appshell/stream.go:11` (Part 22, `RegisterGitStream(app, *gitrpc.Router)`; pre-plan omits it);
  `main.go:578` (`gitrpc.New(Deps{...})`), `main.go:473` (`git.router.SetRepoSettings` handed to
  ADE `TaskBoard` deps; consumer `ade/repoconfig.go:66`, Part 20). Tests:
  `bridge/gitstream_classification_coverage_test.go` parses every non-test `GR` file for the
  dispatch set; 17 `GK` test files.
- **`GK`**: `main.go` (`New`, `Deps`, `Server`, `AcquireLock` at `main.go:381` for `app.lock`),
  `bridge/gitclients.go` (`PairingSnapshot`, `PairingRequest`, `PairingActionResult`,
  `PairingActionResolved`/`Expired`, `Server` via `GitSock`/`GitBroker` interfaces). Shutdown:
  `main.go:216` `adeTaskBoard.Close()`, `:218` `gitSock.Close()`, `:226` `gitRegistry.Close()`.
- **`GV`**: `main.go:134` (`gitvsix.New(gitvsix.Deps{})`), `bridge/gitclients.go` (`GitVsix`
  interface: `Status`, `Install`, `Result`).

TS importers of `@kira/git-ipc` (production unless noted):

- `packages/git-ui` 79 files (Parts 18-19): `state/**` 31, `components/**` 44, `App.vue`, `main.ts`,
  `bridge/**`, `testing/**`.
- `packages/git-core` 8 files (Part 18): `detail/find.ts`, `model/{remote,review,reviewRanges}.ts`,
  `search/matcher.ts`, `settings/schema.ts`, `worktree/label.ts`, `testing/packedChunk.ts`. Pre-plan
  §5.16 omits `git-core` as a caller.
- Space `frontend/src` (Part 22): `bridge/index.ts`, `repo/GitPanel.vue`,
  `repo/git/{hostHandlers,transport}.ts` (`createStreamChannel`, `createRpcClient`),
  `repo/state/{repoHeads,worktrees}.ts`, `state/repoOpenHold.ts`,
  `views/repo/{ReviewThread.vue,blameLine.ts,reviewDecorations.ts}`; test
  `tests/ui/support/graphStreamFixture.ts`.
- VS Code `apps/kira-space-vscode` (Part 23): 15 `src` files incl. `connection.ts` (socket
  handshake client), `transport.ts`, `proxyHandlers.ts` (implements `ServerHandlers`),
  `webview/main.ts` (`createRpcClient` with `VSCODE_WEBVIEW_BUFFER_ENCODING`), `html.ts`
  (`CONTRACT_VERSION`); 4 test support files.
- **Server error codes in TS:** `git grep` finds **no TS consumer branching on any server
  `E_*` code** in `IPC`, `git-ui`, `git-core`, Space `frontend/src/{repo,views/repo}` or vscode
  `src`. Every `.code ===` check there tests a `TransportError` code (`'transport-closed'`,
  `'cancelled'`). `RpcError.code` is carried (`rpc.ts:59-69`) but unread. See §6.4 and §9.

## 5. One hop: callees

- **Part 16 (closed):** `gitsession` from 18 `GR` files (`Conn`, `RepoEntry`, result and param
  types, sentinels `ErrRepoNotHeld`, `ErrRepoTornDown`, `ErrParentIndexOutOfRange`,
  `ErrFileNotInCommit`, `ErrPathEscapesRoot`, `ErrBranchNotFound`, `ErrUnrelatedHistories`,
  `ErrRangedMarkOnNonText`, `ErrCommentNotText`, `ErrCommentRangeOutOfFile`,
  `ErrInvalidResetMode`, `ErrInvalidOpArg`, `ErrUnservedOpKind`, `ErrStashNotFound`) and
  `GK/server.go:241` (`NewConn`, `SetEmit`, `Close`).
- **Part 15 (closed):** `gitpreflight` (7 `GR` files), `gitreview` (3: incl. `ErrStoreClosed` in
  `handlers.go`), `gitsearch` (`search.go`), `gitstore` (`graph.go`: `EncodeChunkFrame`).
- **Part 14 (closed):** `gitclient` (`KindOf`, `KindNotARepository`), `catfile.ErrInvalidRev`,
  `logsession`, `porcelain` (4 files), `gitpath` (`CleanNFC`, 6 files), `gitaskpass`, `ghclient`.
- **Part 20 (later, same stream):** `storage/model` (`GR` 2 files, `GK` 2), `storage/repos`
  (`GK`: `GitClientsRepo` as `TrustStore`). Pre-plan §5.16 names `storage` generically.
- **Root `internal/*` (Part 8, unreviewed):** `ipcerr` (17 `GR` files), `notify` (`GR` 1,
  `GK` 2), `rpcstream` (`GK/server.go`), `tokenauth` (`GK/token.go`), `toolexec` (`GV`; pre-plan
  omits it), `testx` (tests).
- External: `github.com/google/uuid` (`GK`), `flatbuffers` 25.9.23 (`IPC`), `node:net` (`IPC`
  socket channel), the user's `code` CLI and `open` (`GV`).
- **Drift from pre-plan §5.16:** callers add `appshell/stream.go`, `git-core`, ADE via
  `SetRepoSettings`; callees add `toolexec`, `storage/repos`, Parts 14-15 packages explicitly.

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. This chunk is the trust boundary:
`GK` admits a same-user local process to every git write, and `IPC` is the one contract two
independently built halves (Go server, TS clients in the app, webview and VS Code) must agree on.

### 6.1 RPC framing (Go `GK/frame.go`, TS `socketChannel.ts`, `streamChannel.ts`, `blobFrame.ts`)

- 4-byte big-endian prefix, 8 MiB cap on both sides (`GK/frame.go:20`,
  `socketChannel.ts:47`, `bridge/gitstream.go:30` copy). A zero-length frame, a prefix of exactly
  the cap, a cap+1 prefix, a prefix split across reads, two frames in one chunk.
- `readFrame` allocates `n` bytes before reading (`frame.go:55`): a client declaring 8 MiB and
  trickling bytes holds the buffer; the handshake has a 10 s deadline (`handshake.go:28`), but
  post-handshake `rpcstream` reads have none. Weigh against "same-user process".
- `socketChannel` `'data'` handler concatenates `recvBuffer` per chunk (`Buffer.concat`):
  quadratic copy on a large frame arriving in small chunks. `MAX_PENDING_FRAMES` 64 destroys the
  socket when no handler is subscribed (`:171-188`).
- `socketChannel.post` ignores `socket.write`'s return (`:211`): no client-side back-pressure.
- `streamChannel.decodeFrame` (`:78`): no size cap on the Wails stream path; blob discriminant
  `0x00` versus JSON text whose first byte is never `0x00`; a malformed blob frame
  (`MalformedBlobFrameError`) closes the channel (F3 comment) and every pending request rejects.
- Blob frames: `$blob` marker substitution count (`substituteBlob` `seen`), more than one marker,
  zero markers, header length past body end (`parseBlobFrameBody:70`).
- JSON: `JSON.stringify` of a payload with a lone surrogate (commit subject, path) versus Go's
  `encoding/json` replacing invalid UTF-8 with U+FFFD: does a round trip change a path the client
  then sends back as a key?

### 6.2 Socket auth, pairing, token (`GK/handshake.go`, `pairing.go`, `token.go`, `tokenauth`)

- Handshake rows 1-7 against SPEC §3.3: malformed hello closes silently; protocol and contract
  version mismatch; token verify (constant time, dummy hash for a missing row, revoked row),
  `tokenLookupFailed` closes without a frame (F10). Client id clamp 256 bytes, label clamp 200
  bytes on a rune boundary.
- Pairing: cooldown after Deny, queue cap (`maxQueueLen`), `pairingTimeout` expiry,
  `ExpireOverdue` tick, `TakeApprovedToken` keyed by request id (F6), a requester disconnecting
  mid-wait (`watchDisconnect`, F12), two connections with one client id pairing at once, Approve
  racing expiry, `Shutdown` racing `Request` (F4(b)).
- Socket file: permissions (`0o600`? the listener's own mode and the directory's), stale socket
  after a crash, flock on `git.sock.lock` versus `app.lock` (`AcquireLock`, P108 Part 20 F7), a
  second instance that does not listen. Peer credential check: does anything verify the peer uid,
  or does trust rest on the socket's file mode alone?
- Revocation: DB write before closing conns (D18), post-admission re-check (F5), revoking a
  client mid-op (in-flight `op.run` keeps running after `nc.Close()`?), revoked client's held
  repos released via `gconn.Close()`.
- `Server.Close` (`server.go:300`) versus mid-handshake conns (`allConns`, G32 r3 #1),
  `trackConn` after close (F4(a)), `wg.Wait` blocked by a conn stuck in a handler that ignores
  ctx (a long `op.run` or `worktree.prepare`).
- Token at rest: sha256(salt‖token) (`tokenauth`), never logged; `bridge/gitclients.go` list
  projection never returns hash or salt.

### 6.3 Streaming, cancellation, back-pressure (`rpc.ts`, `rpcstream`, `graph.go`)

- Credit: client opens with `INITIAL_STREAM_CREDIT` 2 (`rpc.ts:99`), grants 1 per processed chunk.
  Go `rpcstream` credit gate (Part 8): does Go start with the same 2, and what if the client
  sends `credit` for an unknown or finished id?
- One open stream per method per client (`openStreamIdByMethod`): a second `graph.stream` for
  another repo on the same transport supersedes or races the first?
- `cancel` frame: client resolves locally and sends `cancel`; server must send nothing after
  (`removeActiveWork`, F8). A chunk already in flight after cancel is dropped (`entry.done`).
- `handleGraphStream` (`graph.go:263-277`) emits under `Walk.Stream`'s `w.mu` (Part 16 D13): a
  client that never grants credit blocks this conn's other `graph.*` calls and `Conn.Close`
  (Part 16 noted). Confirm disconnect unblocks it (ctx cancel through `emit`).
- Event ordering: `repo.changed`, `repoSettings.changed`, `remote.progress`, `worktree.progress`,
  `credential.request` share `rpcstream` `sendCh` with responses. `ForConn` settings mailbox
  drop-oldest (cap 8, G32 r3 #5) and its two goroutines per conn exit on `c.Done()`.
- `rawStreamChunks` (vscode proxy relay): chunk passed opaque, re-encoded downstream; credit still
  granted per chunk so the relay cannot over-buffer?
- TS server `createRpcServer` (used by vscode `proxyHandlers.ts` to serve the webview): handler
  rejection posts `toWireError` with `code = error.name` (`rpc.ts:101-109`), not an `E_*` code:
  two error vocabularies on one contract (§6.4).

### 6.4 Error mapping parity, Go to TS

- **Part 16 fixer changed this (`11f097d`, §7).** `mapGitError` (`handlers.go:408-424`) now maps
  `ErrRepoNotHeld`/`ErrRepoTornDown` to `E_BAD_REQUEST`, `catfile.ErrInvalidRev` to
  `E_BAD_REQUEST`, `gitreview.ErrStoreClosed` to `E_GIT_UNAVAILABLE`; `graph.stream`'s
  `w.Stream` error now goes through it. **Left unverified by that fixer: whether TS handles the
  codes.** Planning grep (§4): no TS code reads any server `E_*` code. Reviewer confirms and
  judges:
  - Does any client path need to tell "repository closed under you" from a fault (reopen, silent
    drop, retry)? E.g. `git-ui` graph state on `graph.loadMore` after a concurrent `repo.close`,
    vscode blame on a closed repo. If yes and nothing distinguishes it, that is a finding.
  - `E_GIT_UNAVAILABLE` collides in spelling with the `E_GIT_<KIND>` family `camelToSnake`
    produces from `gitclient` kinds: is there a `gitclient` kind `unavailable`? Name collision or
    an intended reuse? Check against `gitclient` kinds and `ghclient` statuses.
  - `mapConnError` (`graph.go:86`) now duplicates a subset of `mapGitError` and misses
    `ErrRepoTornDown`; callers `detail.go:50`, `graph.go:166,263`, `search.go:61`.
- Every handler's error exit: list paths that return a raw Go error not wrapped by
  `mapGitError`/`ipcerr` (folds to `E_INTERNAL` with `err.Error()` text: may carry absolute paths,
  git stderr, remote URLs with tokens to the client). `handleRepoCall`/`handleCall`
  (`handle.go:22,50`) central wrapping.
- `rpcstream.wireErrorFrom` (`internal/rpcstream/frame.go:84-90`) never sets `Kind`, though
  `wireError` has the field and `RpcError.kind` and `rpc.test.ts:213` assume it: dead contract
  field on the Go path, or a missing classification? (`needs-other-part-file` Part 8 if the fix is
  in `rpcstream`.)
- `bridge/gitstream.go` adds `E_READ_ONLY`; vscode comments name `E_UNKNOWN_METHOD`. Is the code
  vocabulary written down anywhere both halves read (`contract.ts` has none)?

### 6.5 Contract shape parity and generated code drift

- `contract.ts` request/event/stream keys versus `requestHandlers` (57 entries) and `ForConn`
  stream switch: a TS key with no Go handler answers `E_UNKNOWN_METHOD` (vscode comments say some
  are host-answered on purpose); a Go handler with no TS key is unreachable. No test pins the Go
  method set to `validate.ts` `REQUEST_KEY_MAP` (only `bridge` classification coverage on the Go
  side). Diff the two sets.
- Per-method params and results: `wire.go` and handler param structs (json tags,
  `omitempty`, nil slice to `null`) against `contract.ts` types. Weight methods changed recently:
  `review.snapshot` (P150), `repoSettings.set`, `op.run`/`undo.run` results after Part 16 F6/F8/F11
  (partial-op undo kept, undo refusal when refs moved since: what crosses, `OpResult` error or Go
  error, and does `contract.ts` model it?), `remote.run` on a torn-down entry (Part 16 F13).
- `ContractVersion` 42 equal on both sides (`contract.go:168`, `validate.ts:164`); `Protocol` 1.
  `unwrapVersioned` throws on mismatch inside `receive`: a mismatched frame mid-session throws in
  the channel's message handler, not a clean close?
- `assertContractShape` checks only key membership and `kind` type on events: a hostile or stale
  peer's payload reaches `git-ui` state unvalidated. Proportionate for same-machine peers?
- **Generated code drift:** `gitwire.fbs` (52 lines) to `IPC/src/generated/gitwire*` and
  `PI/gitwire/*.go` via `scripts/generate-wire.sh` (pinned flatc 25.9.23). No hook or CI step
  regenerates and diffs. Required check: run `sh scripts/generate-wire.sh` in a scratch copy (or
  with `FLATC` set) and `git diff --exit-code` on both generated trees; report drift. Mirror:
  `graphChunkCodec.ts` `toWire`/`fromWire` against `gitstore/encode.go` (Part 15 reviewed the Go
  half) and `testdata/graphChunkFrame.{bin,json}` regenerated by P166/P167.
- `codec.ts` base64 path (`VSCODE_WEBVIEW_BUFFER_ENCODING`): `encodeBuffers`/`decodeBuffers` on
  an object key named like the encoded-buffer marker; `dedupeTransferList` with a shared buffer.

### 6.6 Request validation (write handlers)

- Every client string reaching `gitsession` argv or a path: `validRefArg`, `validObjectID`,
  `validStashScope`, `validPullStrategy`, `validReviewScope`, `requireNonEmpty`,
  `gitpath.CleanNFC`. Map per handler; Part 16 `validOpArg` is the second line. A field validated
  in one handler but not its twin (e.g. `review.snapshot` `path`, `file.read` path, worktree path,
  `settings.setGitPath` executable path: arbitrary binary run as git?).
- `settings.setGitPath` and `repoSettings.set` from a paired VS Code client: a client can point
  git at any executable and set a prepare script (`worktree.prepare` runs a shell). gitstream
  restricts these fields for the native surface (`guardRepoSettingsSet`); the socket path does not.
  Weigh: pairing is consent to full control, or should these stay app-only?
- `credential.provide` request id from another connection (cross-conn answer), secret in logs.
- `MaxResultBytes` truncation (`review.snapshot` `tooLarge`) versus the 8 MiB frame cap: any result
  that can exceed the frame cap without a guard (`commit.detail` on a huge merge, `refs.list` on
  100k refs, `stash.list`), which `rpcstream` answers with a frame-too-large error.

### 6.7 VSIX install (`GV`)

- `vsixPath` beside the running executable (`os.Executable`, symlinks resolved?), `locateCode`
  probe order (PATH from a GUI app lacks shell PATH), `--install-extension <path> --force` with a
  path holding spaces (no shell: fine) or a leading `-` (impossible from `os.Executable`?).
- `spawnTimeout` 60 s; `detailFor` text to the renderer; `open -R` on Linux (not shipped: confirm
  dead path is harmless). Packaging (`scripts/{build,package}-vscode.ts`) is Part 23; check only
  that the file name `GV` expects (`vsixFileName`) matches what the bundle step copies.

### 6.8 Test isolation (required check)

- **Part 16 F15 left this to Part 17.** `GR/main_test.go` and `GK/main_test.go` call only
  `testx.RunWithTempHomes` (sets `KIRA_HOME`, `KIRA_SPACE_HOME`). Fixture `git` calls in tests
  pass `GIT_CONFIG_GLOBAL=/dev/null` per call, but the server under test spawns git through
  `gitclient` with the process env, so it reads the developer's `~/.gitconfig` and
  `/etc/gitconfig` (`commit.gpgsign`, `core.hooksPath`, `pull.rebase`, `rebase.autoStash`,
  `init.defaultBranch`). 10 `GR` and 15 `GK` test files spawn real git. Report as a finding with
  the `GS/main_test.go` fix (`60901a8`) as the model, unless a probe shows every server spawn is
  already isolated. Probe: set a hostile global config (`commit.gpgsign=true` with a missing key,
  `core.hooksPath` to a failing hook) under the scratchpad `HOME` and run both packages.
- `GK` `isolatedRegistry` keeps `review.db` under the temp home; confirm no `GK` test reaches
  `gitreview.DefaultPath()` through a plain `gitsession.NewRegistry`.

### 6.9 Pre-plan watch items (§5.16)

`gitsock` handshake, pairing, flock, `Close` against mid-handshake conns, revocation (§6.2);
per-connection mailbox caps (§6.3, `ForConn`, `MAX_PENDING_FRAMES`); `streamChannel` and
`socketChannel` ordering and late close (§6.1, §6.3); codec validation of hostile frames (§6.1,
§6.5).

## 7. Earlier contract changes Part 17 must handle

- **Part 16 fixer in `GR` (`11f097d`, P168 Part 16 F5):** `handlers.go:409-418` new `switch` in
  `mapGitError` (imports `errors`, `catfile`, `gitreview`); `graph.go:266-277` `w.Stream` result
  through `mapGitError`. No test added for the new arms. No TS change. Review: completeness (every
  handler reaches the mapper), the code choices (§6.4), and the `mapConnError` overlap.
- **Part 16 gitsession fixes consumed here:** `5251f2b` (`diffCache` keyed by resolved sha;
  `FileDiffResult.SHA` may still echo the request), `e09e6fa` (F6 partial ops keep undo and name
  what landed; F8 `UndoRun` validates before `Take`; F9 read-back error degrades to last-known head;
  F11 undo refuses when a ref moved since; F13 `RunRemote` refuses on a torn-down entry),
  `ffe53e7`, `869dd9c`, `7809a9e`. No `json:` tag changed in `gitsession` since `73c7f40` (grep);
  check result semantics `GR` and `contract.ts` expose.
- **Part 15 `61774dd`:** `reset --keep` refusal now `DirtyWorktree`; crosses as an `OpResult`
  error kind, not an `E_*` code. Confirm `contract.ts` lists the kind.
- **Part 14:** `catfile.ErrInvalidRev`, stricter `ResolveHead`, NUL framing: read via Part 16 only.

## 8. What earlier fixes already changed (do not re-report)

- **P166/P167 scope (`git diff 743af03 HEAD`, 28 files, +348/-289):** `review.snapshot` (P150:
  `incremental.go` `handleReviewSnapshot`, `wire.go` params/result, `handlers.go` table entry,
  `contract.ts`, `validate.ts`, `CONTRACT_VERSION` 41 to 42); `settings.go` `setRepoSettings` and
  exported `SetRepoSettings` (ADE prepare-timeout leaf); `GR/main_test.go` and `GK/main_test.go`
  (P154 temp homes, `isolatedRegistry`); `GK` test churn (`integration`, `matrix`, `review`,
  `incremental`, `ops`, `remote`, `pairing`, `recovery`, `revoke`, `settings`);
  `testdata/graphChunkFrame.{bin,json}`. New code is in scope; report a real failure scenario
  only. (`743af03` sits behind the shallow boundary for `git log`; `git diff 743af03 HEAD` works.)
- **Parts 14-15 fixes edited no Part 17 file.** `git log f40cd35..HEAD` on the four paths shows only
  `11f097d`.
- **Part 16 fixes:** `11f097d` (§7). Do not re-report the mapping it added; a remaining gap is
  reportable. Part 16 F15 (`GS` isolation) is fixed in `GS` only; the `GR`/`GK` half is §6.8's
  required check, not a re-report.
- **P108 Part 17 fixes in code (comments name them):** F4(a) `trackConn` refuses after `Close`
  (`server_test.go:8`), F4(b) broker `Request` after `Shutdown` aborted (`pairing_test.go:200`),
  F5 post-admission revocation re-check (`server.go:218-234`, `revoke_test.go:340`), F7 review
  mark range validation (`incremental_test.go:588`), F8 decomposed repo id settings
  (`settings_test.go:109`), F9 `SetEmit` mutex (`server.go:236`, `handlers.go:78`). Handshake F10
  (`tokenLookupFailed`), F11 (Aborted versus Denied), F12 (disconnect watcher), F13 (client id clamp,
  first-read deadline). G32 round-3 #1 (`allConns`), #5 (settings mailbox cap), G31 round-2 #4
  (`repo.close` NFC), #6 (pairing snapshot emit), P108 Part 20 F7 (`AcquireLock` exported), P108
  Part 20 F3 (native transport onClose identity, Part 22 file). TS F2/F3 comments in `rpc.ts`,
  `streamChannel.ts`, `socketChannel.ts`. Verify they hold; do not re-report them as new.
- `docs/v2.0/plans/P16{6,7}-code-review.md` are gone (fixed). Nothing to skip.

## 9. Unverified candidates

Leads from planning, **not findings**. Each needs a real scenario, a probe or a code read before
it is reported. Drop any that does not hold; say so in the coverage notes.

1. No TS consumer distinguishes `E_BAD_REQUEST` (repo closed under you) or `E_GIT_UNAVAILABLE` from
   any other failure; a client that should reopen or stay silent shows an error instead
   (`handlers.go:409-418`; consumers Parts 18-19, 22, 23).
2. `mapConnError` duplicates part of `mapGitError` and misses `ErrRepoTornDown`
   (`graph.go:86`, `detail.go:50`, `search.go:61`).
3. A handler error path bypassing `mapGitError`/`ipcerr` leaks raw `err.Error()` (paths, stderr,
   URL userinfo) as `E_INTERNAL`.
4. `rpcstream.wireErrorFrom` drops `Kind`; `RpcError.kind` is always undefined from Go
   (`internal/rpcstream/frame.go:84`, Part 8).
5. TS `createRpcServer` reports `code = error.name` while Go reports `E_*`: vscode-proxied
   webview errors use a different vocabulary (`rpc.ts:101-109`).
6. Go method set and `validate.ts` key maps drift with no test pinning them (§6.5).
7. Generated `gitwire` code drifted from `gitwire.fbs` (no regeneration check).
8. `readFrame` allocates the declared length before reading; post-handshake reads have no
   deadline (`GK/frame.go:46-60`).
9. `socketChannel` quadratic `Buffer.concat` and ignored `socket.write` back-pressure
   (`socketChannel.ts:190-211`).
10. `streamChannel` has no frame size cap (`streamChannel.ts:78-91`).
11. A result larger than 8 MiB with no `MaxResultBytes` guard fails as frame-too-large instead of a
    typed truncation.
12. `settings.setGitPath`/`repoSettings.set` let a paired socket client choose the git binary or a
    prepare script (`settings.go`; design-decision candidate).
13. Socket trust rests on file mode only; no peer uid check (`server.go` `Start`).
14. `Server.Close` waits on a handler stuck in a long op that ignores ctx (`server.go:300-356`).
15. `gitrpc`/`gitsock` tests read the developer's global git config (§6.8; Part 16 F15 handoff).
16. `unwrapVersioned` mismatch thrown inside a channel message handler mid-session is not a clean
    close (`rpc.ts:117-122`).
17. Two `graph.stream` opens on one transport (`openStreamIdByMethod`) cross-cancel or leak.
18. `vsixFileName` disagrees with what `scripts/package-vscode.ts` copies into the bundle.

## 10. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (error contract first, since every later block
  judges handler exits against it). About 9.6k production lines plus 14.0k test lines; read tests
  where they are the sole guard of a claim.
  1. **Error mapping:** `GR/handlers.go` (`mapGitError`), `graph.go` (`mapConnError`),
     `detail.go` (`mapDetailError`), `stash.go` (`mapStashError`), `handle.go`;
     `internal/rpcstream/frame.go` (read); `IPC/src/{rpc,transport}.ts` error types; TS consumers
     by `git grep`. §6.4, §7.
  2. **Router and read handlers:** `handlers.go`, `graph.go`, `detail.go`, `refs.go`, `search.go`,
     `gh.go`, `wire.go`, `contract.go`; caller `bridge/gitstream.go`, `appshell/stream.go`.
     §6.3, §6.5, §6.6.
  3. **Write handlers and validation:** `ops.go`, `reset.go`, `stash.go`, `remote.go`, `stack.go`,
     `worktree.go`, `review.go`, `comments.go`, `incremental.go`, `settings.go`; ADE
     `SetRepoSettings` caller. §6.6, §7.
  4. **Socket server:** `GK/{server,handshake,pairing,frame,lock,token,clients}.go`; callers
     `bridge/gitclients.go`, `main.go` (`wireGit`, shutdown `:209-238`), vscode `connection.ts`
     (handshake client, read). Wire probes. §6.1, §6.2, §6.3.
  5. **TS transport:** `IPC/src/{rpc,socketChannel,streamChannel,blobFrame,codec,transport,
     index}.ts`; consumers Space `repo/git/transport.ts`, vscode `transport.ts`,
     `webview/main.ts`, `proxyHandlers.ts` (read). §6.1, §6.3.
  6. **Contract parity and generated code:** `contract.ts`, `validate.ts`, `graphChunkCodec.ts`,
     `schema/gitwire.fbs`, generated trees, `testdata/*`; Go `wire.go`, `requestHandlers`. Run the
     regeneration diff. §6.5.
  7. **VSIX:** `GV/{install,exec}.go`, `install_test.go`; caller `bridge/gitclients.go`;
     `scripts/package-vscode.ts` file name only. §6.7.
  8. **Tests and §7:** the §6.8 isolation check (required, with probe); confirm guard claims cited
     in findings and every §7 contract check; report a test that no longer guards what its name
     says, or a missing guard for a genuinely complex rule (`CLAUDE.md` unit-test bar: framing,
     credit and cancellation races, handshake decision table qualify; a four-arm error switch does
     not on its own).
- **Resumable:** write `docs/v2.0/plans/P168-part17-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 17 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). An interrupted run reads the file, resumes at the first block
  not marked done, and never re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome), and a proposed fix. Tag
  `needs-other-part-file: <path> (Part N)` when the fix needs another Part's file (§0). Tag
  `design-decision` when it needs one; the fixer turns it into its own `SPEC.md` phase.
- The findings file states base commit, HEAD reviewed, checks run and results (incl. the
  regeneration diff and the §6.8 probe), findings, the fate of each §9 candidate (reported as
  `F<n>` or dropped with reason), then coverage per block: reviewed, skimmed (with reason), not
  reached. No unexplained gap. A chunk with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 17 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 17`, under §0's
  routing (Stream B files editable when required, each named in the commit body; Stream A/C files
  never, routed by the orchestrator to `P168-routed-from-streamB.md`). A fix re-runs
  `go build ./apps/kira-space/...`, `go vet` and `go test -race` over `gitrpc`, `gitsock`,
  `gitvsix`, plus `bridge` when a caller changed; `bun test packages/git-ipc/src` and
  `bun run typecheck:git` (plus `typecheck:space-web` when a Space frontend caller changed) when
  TS changed; `bun run lint` on TS edits. A `gitwire.fbs` change regenerates both trees with
  `scripts/generate-wire.sh` and commits them together. It deletes the findings file when done.
  Chunk lands per pre-plan §3.4 before Part 18's plan starts.

## 11. Out of scope

- Parts 14-16 packages (closed): report only a Part 17-visible break, tagged.
- `git-core` and `git-ui` logic (Parts 18-19): read only to confirm how a wire error or shape is
  consumed.
- `bridge`, `appshell`, `appcore`, `main.go` beyond Part 17 wiring and shutdown order (Part 22).
- VS Code extension logic beyond the handshake client and transport adapters (Part 23);
  `scripts/{build,package}-vscode.ts` beyond the VSIX file name.
- ADE (Part 20) beyond the `SetRepoSettings` call.
- Root `internal/*` (`rpcstream`, `ipcerr`, `notify`, `tokenauth`, `toolexec`, `testx`) beyond the
  contract Part 17 depends on (Part 8, §0 tag rule).
- Generated `IPC/src/generated/**` and `PI/gitwire/**` (reviewed only through the regeneration
  diff), docs, excluded files (pre-plan §6).
