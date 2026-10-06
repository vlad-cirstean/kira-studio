# P168 Part 17 findings: Space git RPC, socket server, `git-ipc` contract

Plan: `P168-part17-git-rpc.md`. Base `30ec62f` (plan survey), HEAD reviewed `0bc3592`
(`p168-stream-b`). One Opus reviewer, report only. Paths repo-relative; `GR`/`GK`/`GV`/`IPC` as in
the plan.

Block status: 1 done.

## Block 1: error mapping

### F1 (low) TS `createRpcServer` rewrites every forwarded Go error code to `RpcError`

- `packages/git-ipc/src/rpc.ts:101-109` (`toWireError`), used at `:419` and `:466`.
- Scenario: VS Code webview sends `commit.detail` for an unopened repo. `proxyHandlers.ts`
  `forward('commit.detail')` rejects with the Go `RpcError{code:'E_BAD_REQUEST'}`. `toWireError`
  posts `{code: error.name}` = `'RpcError'`. The webview sees `code: 'RpcError'`, never
  `E_BAD_REQUEST`. A missing handler key answers `code: 'TypeError'` ("handler is not a
  function"), not `E_UNKNOWN_METHOD` as the Go side and vscode comments name it. One contract, two
  code vocabularies, depending on which surface (Space native: Go codes; VS Code webview: JS class
  names). No consumer branches on a code today (§4 grep confirmed), so impact is latent; the first
  consumer that does (§9 #1) breaks on VS Code only.
- Fix: in `toWireError`, pass `code`/`kind` through when the error carries a string `code`
  (`RpcError`, `TransportError`); in `handleRequest`/`handleOpen`, answer a missing handler with
  `{code: 'E_UNKNOWN_METHOD'}` explicitly.

### F2 (low) `WireError.kind` is a dead contract field on every Go path

- `internal/rpcstream/frame.go:84-90` never sets `Kind`; `packages/git-ipc/src/rpc.ts:47-56,59-69`
  documents `kind` as the `GitErrorKind` and stores it on `RpcError.kind`. `git grep` finds no
  reader of `RpcError.kind` outside `IPC` tests. `mapGitError` (`GR/handlers.go:419-423`) folds
  the kind into the code (`E_GIT_<KIND>`), so `kind` is always `undefined` from Go, and only the TS
  server (F1) can ever fill it.
- Also no document both halves read lists the code vocabulary (`E_BAD_REQUEST`, `E_INTERNAL`,
  `E_GIT_{NOT_A_REPOSITORY,PERMISSION_DENIED,CANCELLED,TIMEOUT,UNKNOWN,UNAVAILABLE}`,
  `E_FRAME_TOO_LARGE`, `E_UNKNOWN_METHOD`, `E_READ_ONLY`); `contract.ts` has none.
- Fix: drop `kind` from `WireError`/`RpcError` and the rpcstream struct comment, or set it in
  `wireErrorFrom`; add an exported `WireErrorCode` union in `contract.ts` listing the codes above,
  with a Go-side comment pointing at it. `needs-other-part-file: internal/rpcstream/frame.go
  (Part 8)` only if the Go struct field is removed.

### F3 (low) Stale doc: `ErrRepoTornDown` comment says it maps to `E_INTERNAL`

- `apps/kira-space/internal/gitsession/entry.go:18-22` says "gitrpc's default mapGitError arm
  maps it to E_INTERNAL". Since `11f097d` it maps to `E_BAD_REQUEST` (`GR/handlers.go:410-413`).
  Also `GR/graph.go:83-91` `mapConnError` is now a strict subset of `mapGitError` (same message,
  same code); its 4 callers (`detail.go:50`, `graph.go:166,263`, `search.go:61`) only ever pass
  `ErrRepoNotHeld` (`Conn.Walk` returns nothing else, `gitsession/conn.go:385-430`), so no
  behaviour gap, just two mappers for one sentinel.
- Fix: correct the comment (Stream B file, Part 16: `gitsession/entry.go`); delete
  `mapConnError` and call `mapGitError` at its 4 sites.

### Block 1 candidate fates

- §9 #1 dropped as a finding: no TS consumer reads a server code (confirmed), but no client path
  was found that needs to: `ErrRepoTornDown` is reachable only at `Registry.Close` or linger
  expiry with `refs == 0` (`gitsession/registry.go:223-234,290-302`), when no connection holds the
  repo; `ErrRepoNotHeld` after a client's own `repo.close` hits callers that already aborted their
  controllers. Latent concern recorded in F1/F2.
- §9 #2 folded into F3 (duplicate, not a gap: `ErrRepoTornDown` never reaches `mapConnError`).
- §9 #3 dropped: non-`gitclient` errors fold to `E_INTERNAL` with `err.Error()` by design
  (`mapGitError` default arm). Texts reachable are gitsession sentinels/fmt errors and
  `gitclient.Error` summaries (argv plus first stderr line, never full stderr). No remote URL is
  placed in argv by `GR` handlers (remote names only, `validRefArg`). The peer is the same local
  user, so a path in a message is not a disclosure.
- §9 #4 reported as F2. §9 #5 reported as F1.
- `E_GIT_UNAVAILABLE` collision: no `gitclient` kind `unavailable` exists (kinds:
  `notARepository`, `permissionDenied`, `cancelled`, `timeout`, `unknown`). The code predates
  `11f097d` (discovery not ok, `graph.go:156,259`, `search.go:53`); the store-closed arm reuses it
  on purpose. Not a finding.
