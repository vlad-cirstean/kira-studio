# P108 Part 17 — review plan: Space git RPC, socket server and `git-ipc` contract

Chunk B5, stream B position 5 (pre-plan §5.16). Parts 13-16 landed first. One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `e5fbcdd`.

Paths repo-relative. `PI` = `apps/kira-space/internal`. `PF` = `apps/kira-space/frontend/src`.
`vscode` = `apps/kira-space-vscode`. `B4` = Part 16 (`gitsession`, closed). `A1` = Part 2
(`internal/*`, closed, owned by stream A).

## 0. Method

- **`codegraph_explore`**, four survey calls: RPC dispatch (`Router`, `ForConn`, `Handlers`,
  `handleRepoCall`, `requireNonEmpty`, `requestHandlers`); socket lifecycle (`Server.handleConn`,
  `runHandshake`, `Broker`, `acquireLock`, `rpcstream.NewSession`); argv guard parity
  (`validRefArg`, `validOpArg`, `handlePreflightCheckout`/`Revert`); TS contract side
  (`createRpcClient`, `createRpcServer`, `SocketChannel`, `StreamChannel`, `assertContractShape`,
  `createProxyHandlers`). More calls during review for blast radius.
- **`git grep` of import lines** for the exact importer set (§2). CodeGraph's TS resolution
  over-links (pre-plan §0), so import lines decide.
- **Method-table diff.** Extract every key of Go's `requestHandlers` map and every key of
  `validate.ts`'s `REQUEST_KEY_MAP`/`EVENT_KEY_MAP`/`STREAM_KEY_MAP` and every Go `Emit` method
  literal; diff mechanically. Same for `ContractVersion`/`Protocol` constants on both sides.
- **Params/result parity by field.** For each Go `*Params` struct in `gitrpc/contract.go` +
  `wire.go`, compare JSON tags and optionality (pointer vs value, `omitempty`) against the matching
  `contract.ts` type. Required-field checks in Go against TS optional markers.
- **Real probes** (scratch dir) only where a claim rests on runtime behavior: frame parsing,
  handshake over `net.Pipe`, git argv behavior.
- **Part 16 F1 re-verified.** `b064fde`'s gitrpc half (`refs.go`, `reset.go`, `stash.go`) confirmed
  present at `e5fbcdd`. Review sweeps every other handler for the same bare-argv shape.

## 1. Own file set

Production (tests read only where they pin a questioned contract):

- `PI/gitrpc/` (3,000 lines prod): `comments.go`, `contract.go`, `detail.go`, `gh.go`, `graph.go`,
  `handle.go`, `handlers.go`, `incremental.go`, `ops.go`, `refs.go`, `remote.go`, `reset.go`,
  `review.go`, `search.go`, `settings.go`, `stack.go`, `stash.go`, `wire.go`, `worktree.go`.
- `PI/gitsock/`: `clients.go`, `frame.go`, `handshake.go`, `lock.go`, `pairing.go`, `server.go`,
  `token.go`.
- `PI/gitvsix/`: `exec.go`, `install.go`.
- `packages/git-ipc/`: `src/{blobFrame,codec,contract,graphChunkCodec,index,rpc,socketChannel,
  streamChannel,transport,validate}.ts`, `schema/gitwire.fbs`, `package.json`. `src/generated/`
  is boundary only: not reviewed, but its consumers (`codec.ts`, `graphChunkCodec.ts`) are.

## 2. One hop: callers

Go, from import lines (production):

- `PI/bridge/gitstream.go` `ServeGitStream`: Router `ForConn` over a Wails stream, second
  `rpcstream.NewSession` host besides gitsock.
- `PI/appshell/stream.go`: stream endpoint wiring for the desktop webview.
- `PI/bridge/gitclients.go`: `GitSock.Revoke`, `GitBroker.Approve`/`Deny`/`Pending`, `GitVsix`.
- `apps/kira-space/main.go` `wireGit`: `gitrpc.New(Deps)`, `gitsock.New`/`Start`/`Close`,
  `gitvsix` wiring.

TS, from `@kira/git-ipc` import lines (production):

- `vscode/src` (13 files): `connection.ts` (`createSocketChannel`, handshake, reconnect),
  `proxyHandlers.ts` (`ServerHandlers`: forwards every request key), `extension.ts`,
  `webviewProviderBase.ts` (`createRpcServer`).
- `PF/repo/git/{transport,hostHandlers,gitUiModule}.ts` (`createStreamChannel`,
  `createNativeGitTransport`), `PF/repo/state/*`, `PF/bridge`, `PF/views/repo`.
- `packages/git-ui/src/{state,bridge,components}`: type consumers of `contract.ts`; runtime
  consumer of `Transport`. Reviewed only as far as a contract field's meaning they depend on.
- `packages/git-core/src/{model,detail,search,settings,worktree}`: type consumers only.

## 3. One hop: callees

- `PI/gitsession` (B4, closed): `Conn`, `RepoEntry` methods, `Registry`. Treat as correct except
  where the RPC boundary passes it something its own contract never promised to accept.
- `internal/rpcstream` (A1, closed; stream A owns edits): `Session`, `Handlers`, credit gates,
  `MaxFrameBytes`. A needed fix there is a hand-off per pre-plan §3.3, still reported here.
- `internal/notify` (`Emitter`), `internal/ipcerr` (`BadRequest`, `New`, codes),
  `internal/tokenauth` (token hash/verify). A1, same hand-off rule.
- `PI/storage/repos` (`GitClientsRepo` via gitsock `TrustStore`), `PI/gitclient` (`Discovery`),
  `PI/gitaskpass` (`Broker`), `PI/gitwire` (graph chunk encode).

## 4. Edge cases to weight

1. **Method-table parity.** Every TS `RequestKey` has a Go handler and the reverse; every Go-emitted
   event name is a TS `EventKey`; stream keys match. Contract/protocol version constants match.
   A Go-only method is reachable by any paired client without TS-side typing.
2. **Params parity.** Go required-field checks vs TS optionality: a TS-optional field Go rejects as
   missing (breaks a legal client call), or a TS-required field Go silently defaults (hides a bug).
   Enum-valued fields (`mode`, `scope`, `kind`) validated in Go against the same literal set as the
   TS union. Numeric fields: negative/huge indices, `limit`/`offset` bounds, `int` overflow on
   `json.Number`.
3. **Error-shape parity.** `ipcerr` codes Go emits vs codes TS branches on (`RpcError.code`
   switches in git-ui/vscode). `mapGitError` completeness; a raw Go error string leaking internal
   paths.
4. **Argv injection at the RPC layer.** Every handler field that reaches a git argv as a bare token
   (ref, sha, path, remote, branch, pathspec, message) — sweep all handlers, not just Part 16 F1's
   four. Arrays: every element checked, not just the first. Optional pointer fields checked when
   present. Pathspec fields: `--` separator present downstream, or leading `-`/`:` magic screened.
5. **Socket server lifecycle.** `Start` flock/listen/unlink ordering; stale socket file; `Close`
   against mid-handshake connections (G32 #1), against a pairing wait (Broker `Shutdown`), against
   `acceptLoop`'s `wg.Add` after `Close` started `wg.Wait` (Add-after-Wait race); double `Close`;
   `Revoke` during handshake vs after `addConn`; `removeConn` slice bookkeeping.
6. **Handshake/pairing.** Token compare constant-time; revoked token rejected; cooldown; queue cap
   (`maxQueueLen`) and per-client duplicate requests; approve after the requester disconnected
   (token minted for a dead socket, trust row inserted anyway); `finishPairing` insert-then-send
   ordering; handshake read deadline (a client that never sends hello holds a goroutine forever).
7. **Framing.** `frame.go` length prefix bounds (0, cap, cap+1), partial reads, write atomicity under
   concurrent writers. TS `socketChannel.ts` drain, pending-queue cap, close-handler ordering;
   `streamChannel.ts` connect queue ordering (P67b), close before open, send after close.
8. **Streaming.** `graph.stream` emit backpressure (credit gates both sides), cancel mid-stream,
   one-open-stream-per-method (`openStreamIdByMethod`) replacing an older stream — the older
   stream's pending promise settles. Blob frame decode bounds (`blobFrame.ts`).
9. **Per-connection mailboxes.** `repoSettings.changed` queue cap 8 (drop-oldest), goroutine
   teardown on disconnect, emit into a closed session.
10. **`gitvsix`.** Install command argv (`code --install-extension <path>`): path from where, can it
    be flag-like; CLI discovery; stdout/stderr bounds; timeout.
11. **Pull-strategy contract (P111).** Note anything touching `remote.pullPreflight`/`remote.run`'s
    strategy fields. P111 owns the fix; a finding here only names the overlap.

## 5. Watch items from pre-plan §5.16

- Largest Space churn (`gitrpc` 2,010).
- Handler method table and params against `contract.ts`.
- `gitsock` handshake/pairing, flock, `Close` against mid-handshake connections (G32 #1).
- Revocation. Per-connection `repoSettings.changed` mailbox cap. `streamChannel` connect queue
  ordering (P67b).

## 6. Out of scope

- `src/generated`, `PI/gitwire`'s generated half. B4 internals beyond the boundary.
  `internal/rpcstream` internals except as the callee contract (A1, closed; hand-off rule).
- P111's pull-strategy wire change itself.
- git-ui/vscode component logic (Parts 18-20) except where it pins a contract meaning.
- Style nits. Findings must be real bugs: correctness, security, concurrency, leaks, error
  handling, wire-contract mismatches.
