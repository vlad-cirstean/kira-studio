# P168 Part 17 findings: Space git RPC, socket server, `git-ipc` contract

Plan: `P168-part17-git-rpc.md`. Base `30ec62f` (plan survey), HEAD reviewed `0bc3592`
(`p168-stream-b`). One Opus reviewer, report only. Paths repo-relative; `GR`/`GK`/`GV`/`IPC` as in
the plan.

Block status: 1-5 done.

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

## Block 2: router and read handlers

### F4 (low) Several read results have no size guard below the 8 MiB frame cap

- `GR/detail.go:69-88` (`commit.detail`: full changed-file list), `GR/refs.go:13-29`
  (`refs.list`: every ref), `GR/refs.go:31-47` (`status.get`), `GR/detail.go:217-233`
  (`working.detail`), `GR/search.go:46-49` (`search.run`: `limit` taken from the client with no
  upper bound). Only `commit.fileDiff`/`file.read` (`MaxResultBytes`, `wire.go:168`) and
  `review.snapshot` truncate.
- Scenario: `commit.detail` on a vendoring commit touching ~70k files (about 120 bytes per
  `FileChange` JSON), or `refs.list` on a monorepo with ~60k remote branches/tags. The encoded
  result passes 8 MiB; `rpcstream.sendResult` (`internal/rpcstream/session.go:148-152`) answers
  `E_FRAME_TOO_LARGE`. The client shows an error and cannot open that commit or list any ref at
  all, where a truncated list would work. A raw socket client sending `search.run {limit: 1e7}`
  with a one-letter query makes the server build every hit in memory before the same refusal.
- Fix: clamp `search.run` `limit` to a server max (e.g. `gitsearch.DefaultLimit * 10`); give
  `commit.detail` and `refs.list` a count cap with a `truncated` flag (additive contract field,
  `CONTRACT_VERSION` bump, git-ui display in Parts 18-19). The cap values need a product call;
  the `limit` clamp does not.

### Block 2 candidate fates and notes

- §9 #6 (method sets drift): dropped. Diffed `requestHandlers` (57) against `validate.ts`
  `REQUEST_KEY_MAP` (72): every Go method has a TS key; the 15 TS-only keys
  (`clipboard.write`, `editor.*` x7, `graph.revealCommit`, `link.openExternal`, `pr.openExternal`,
  `repo.list`, `review.open`, `review.session.{load,save}`, `worktree.openWindow`) are each
  answered in Space `hostHandlers.ts` (grep, all 15 present) and in vscode `proxyHandlers.ts`
  (total `ServerHandlers` map, enforced by typecheck). Stream keys: `graph.stream` only, both
  sides. A pinning test would guard a set comparison, not complex logic (`CLAUDE.md` bar).
- §9 #11 reported as F4.
- `search.run` calls `c.Walk` with the repo's default spec (`search.go:55-62`), which can replace
  a graph walk opened with an explicit `scope`. git-ui never sends `scope` on `graph.stream` or
  `graph.loadMore` (`graphView.ts:174-178,206`), so both resolve to the same spec and share one
  walk. Not a finding today.
- `ContractVersion` 42 (`contract.go:168`, `validate.ts:164`) and `Protocol` 1 (`contract.go:172`,
  vscode `connection.ts:36`) agree.
- `ForConn` settings mailbox and its two goroutines exit on `c.Done()` (`handlers.go:119-132`);
  `GK/server.go` closes `gconn` on every exit path (block 4).

## Block 3: write handlers and validation

### F5 (medium, DESIGN-DECISION) A paired socket client can store and run any shell command; the documented approval gate does not exist

- `GR/settings.go:92-111` (`repoSettings.set` writes `kiraSpace.worktree.prepareScript` for any
  `repoId`, held or not), `GR/worktree.go:88-105` and `gitsession/worktree.go:461-482`
  (`RunPrepare` runs the stored script when the caller echoes its sha256), `GR/settings.go:134-153`
  (`settings.setGitPath` points every future git spawn at any executable).
- The only gate in `RunPrepare` is "does the client's `scriptSha256` match the stored script",
  which the same client just wrote. `contract.go:76-81` and `contract.ts:84-91` both describe a
  "sha256-pinned approval" key `prepareScriptApprovedSha`; `git grep` finds no such key in code
  (only those two comments plus `bridge/gitstream.go:105-108`, which says it does not exist).
- Scenario: a VS Code webview (git-ui renders commit subjects, branch names, PR titles, review
  comments) is made to run script. `proxyHandlers.ts:614` forwards `repoSettings.set` verbatim,
  incl. both restricted leaves; `:585` forwards `worktree.prepare` with no host check
  (`runPrepareScript: isWorkspaceTrusted()` at `:242` is a client-side capability flag only). Two
  requests give a shell as the user, from a workspace VS Code marks untrusted. The Space native
  surface refuses exactly these fields and methods for this reason (`bridge/gitstream.go:96-108,
  181-190`); the socket surface does not.
- Decision needed: is pairing consent to full shell control? Options: (a) refuse
  `worktreePrepareScript`/`worktreeBasePath` writes and `settings.setGitPath` on the socket except
  from the extension host (needs a per-request origin the proxy sets, or a host-only method), plus
  host-side enforcement in `proxyHandlers.ts` (strip both leaves from webview `repoSettings.set`,
  refuse `worktree.prepare` when the workspace is untrusted); (b) implement the documented
  approval sha written only by an app-side confirm dialog. Either way, correct the two contract
  comments now: they claim a control that does not exist. `needs-other-part-file:
  apps/kira-space-vscode/src/proxyHandlers.ts (Part 23)` for the host-side half.

### F6 (low) `review.snapshot` marshals its result twice; `review.fileDiff` `tooLarge.bytes` reports JSON size

- `GR/incremental.go:127-153`: marshals `res` to measure it, then returns `res` (not
  `json.RawMessage(raw)`), so `rpcstream` marshals up to 6 MiB again. `commit.fileDiff`/`file.read`
  return the raw bytes (`detail.go:126,164`).
- `GR/incremental.go:80-83`: `tooLarge.bytes = len(raw)` (encoded JSON, escapes included) while
  `commit.fileDiff` sends the raw patch size (`detail.go:119-120`, comment: "never re-derived from
  the encoded bytes"). One contract field (`contract.ts:192`), two meanings; the UI label
  "N bytes" differs for the same patch on the two surfaces.
- Fix: return `json.RawMessage(raw)` from the `review.snapshot` success path; use
  `result.RawPatchBytes` (or the gitsession equivalent) for `review.fileDiff`.

### Block 3 candidate fates and notes

- §9 #12 reported as F5.
- Validation map, per client string reaching argv: `validRefArg` on every rev/branch/remote that
  `GR` passes as a bare token (`commit.detail`, `commit.fileDiff`, `file.read`, `file.goToTarget`,
  `preflight.{checkout,revert,cherryPick,stashPop}`, `remote.*`, `review.*`, graph `range`).
  Handlers without a `GR` check are guarded below: `preflight.reset` target
  (`gitsession/preflight.go:279-282` refuses a leading `-`), `op.run` args (`validOpArg`,
  Part 16), restack/stash-branch `branch` (lookup keys only, never argv:
  `gitsession/stack.go:246-290`, `preflight.go:654-700`), `review.resolveBase` `baseCandidates`
  (matched against the refs snapshot, never spawned). `commit.resolvePr` `sha` is unvalidated but
  `url.PathEscape`d (`ghclient/pr.go:111-122`); a `..` sha reshapes the GET to `/pulls` of the same
  repo (read-only, own repo). Not reported.
- §7 contract checks: `OpResult`/`OpError` json tags unchanged; every Go `OpError.Kind` literal in
  `gitsession`/`gitpreflight` (`BranchChanged`, `ConfirmationRequired`, `NothingToStash`,
  `StackCycle`, `WorktreeLocked`, `Unknown`, `DirtyWorktree`, ...) is a member of `contract.ts`
  `OpErrorKind`. Undo refusal on moved refs (F11) crosses as `OpResult{ok:false, kind:'Unknown'}`;
  `reset --keep` refusal as `DirtyWorktree` (Part 15 `61774dd`). Both modelled.
- `repoSettings.set` maps every storage error to `E_BAD_REQUEST` (`settings.go:107-109`): an IO
  failure reads as a client mistake. Cosmetic, no consumer branches on it. Not reported.

## Block 4: socket server

### F7 (medium, DESIGN-DECISION) Pairing identity is wholly client-asserted, and one Approve admits every queued sibling with the same client id

- `GK/handshake.go:111-159` takes `clientID` and `label` from `hello` unverified;
  `GK/server.go:94-131` never reads the peer's credentials (no `SO_PEERCRED`/`LOCAL_PEERPID`
  anywhere in the tree, `git grep`); `GK/pairing.go:243-259,273-289` (`answer`) resolves every
  other queued request with the head's `clientID` as Approved and hands each the same token
  (guarded by `pairing_test.go:421`).
- The VS Code client id is `kira-vscode:<vscode.env.machineId>` (`connection.ts:113-124`) and the
  label is `<appName> — <hostname>` (`:128-130`); both are derivable by any same-user process.
- Scenario: a same-user process (the adversary the pairing gate exists for; the token in VS Code
  `context.secrets` is otherwise out of its reach on a keychain-ACL platform) polls for the moment
  VS Code opens a pairing request, or simply connects first, with `hello.client.id =
  "kira-vscode:<machineId>"`. The user sees one genuine "Visual Studio Code — host" prompt (the
  dialog shows only the head and a count, `PairingSnapshot`), approves it, and the impostor's
  queued sibling receives the same token. From then on it holds every git write, and with F5 a
  shell. The same spoofed id also lets it trigger a 60 s cooldown on the real editor by being
  denied (`pairing.go:244-246`), and fill the 200-slot queue (`maxQueueLen`) so real requests abort.
- Decision needed: what pairing binds to. Options: capture peer pid and executable from the
  socket's peer credentials at accept, show them in the prompt, and resolve a sibling only when its
  peer executable matches the head's (keeps F6's multi-window intent); or drop sibling fan-out and
  let each window pair (cost: one prompt per window). `needs-other-part-file`: the pairing dialog
  and `bridge/gitclients.go` projection (Part 22) if the prompt shows peer data.

### Block 4 candidate fates and notes

- §9 #8 (allocate-before-read, no post-handshake deadline): dropped. Pre-handshake reads are
  bounded by the 10 s deadline (`handshake.go:84-86`); post-handshake reads need a paired token.
  A same-user process that can open the 0600 socket in the 0700 home can equally SIGKILL the app,
  so memory pressure from declared-length frames adds no capability. `writeFrame`/`readFrame`
  (`frame.go`) cap at 8 MiB both ways, reject cap+1 before allocating, and `bufio` handles split
  and coalesced reads (guarded by `frame_test.go`).
- §9 #13 folded into F7.
- §9 #14 dropped: `Server.Close` waits only on `handleConn` goroutines (`server.go:345`);
  `rpcstream.Serve` returns on the closed conn without joining dispatched handlers
  (`internal/rpcstream/session.go`, `Serve`/`handleRaw`), so a long `op.run`/`worktree.prepare`
  (both `context.WithoutCancel`) cannot block `wg.Wait`. Side effect, not a hang: such a write keeps
  running after `Close` and after `main.go:225` `gitRegistry.Close()` tears its entry down; the
  entry's later reads return `ErrRepoTornDown` and the process exits. Shutdown semantics of a
  detached op are Part 16/22 territory, not a Part 17 defect.
- Revocation: DB write precedes conn close (`server.go:281-295`); post-admission re-check holds
  (`server.go:225-234`; no delete path exists in `GitClientsRepo`, so `!found` after a verified
  token cannot happen). A revoked client's in-flight detached write completes; acceptable.
- Token at rest: `tokenauth` sha256(salt||token), 32-byte token, 16-byte salt, constant-time
  compare, dummy pair on miss and on lookup error (`token.go`, `handshake.go:278-296`). No log line
  carries a token.
- Socket file: stale socket removed only after the flock is won (`server.go:95-107`), chmod 0600
  after listen, parent 0700. `AcquireLock` is `LOCK_EX|LOCK_NB` on a 0600 file.
- `Close` versus mid-handshake conns (G32 r3 #1), `trackConn` after close (F4(a)), broker
  `Shutdown` racing `Request` (F4(b)), disconnect watcher (F12): each holds on a read of the code
  and its cited test.

## Block 5: TS transport

### F8 (medium) One open stream per method per transport: the Space review panel and graph tab cancel each other's `graph.stream`

- `packages/git-ipc/src/rpc.ts:300-311` (`stream`: any prior open stream of the same method is
  finished, sent `cancel`, and **resolved**, not rejected), `:183,337` (`openStreamIdByMethod`
  keyed by method only). Guarded as intended behaviour by `rpc.test.ts:370`.
- Space shares one `createRpcClient` per repo workspace (`repo/git/transport.ts:46-51`,
  `gitTransportFor`), used by both `views/repo/RepoGraphView.vue:68` (git-ui `GraphViewState`,
  plain `graph.stream`) and `repo/RepoReviewView.vue:38` (git-ui `ReviewSessionState.#open`,
  ranged `graph.stream`, `review.ts:372-391`). GitPanel keeps the review view mounted once
  activated (`GitPanel.vue:589-598`, `v-show`), so both coexist.
- Scenario: graph tab open on a large repo, first stream in progress (one 5,000-row page in 500-row
  chunks at credit 2). User opens the Review tab for a branch. `ReviewSessionState` opens a ranged
  `graph.stream`; the client cancels the graph's stream and resolves its promise.
  `GraphViewState.openStream`'s `finally` sets `loading` to `idle` with a partial row set and no
  error (`graphView.ts:179-184`). The reverse also happens: a graph `loadMore` (which re-opens
  `graph.stream`, `graphView.ts:186-196`) or a `repo.changed` re-stream silently truncates a review
  list mid-load. Both callers already abort their own previous stream via `AbortController`, so
  the per-method rule only ever bites the other caller. The Go side keeps the two walks in separate
  slots (`gitsession/conn.go:404-407`), so the server is fine; only the client cross-cancels.
- Fix: drop the per-method supersede from `createRpcClient` (callers own supersession through
  `signal`), or key it by caller-supplied identity (`method` + `repoId` + `range`). Update
  `rpc.test.ts:370` to the new rule and add a case for two concurrent `graph.stream`s on one
  client completing independently.

### F9 (low) `socketChannel` re-copies the receive buffer on every chunk of a large frame

- `packages/git-ipc/src/socketChannel.ts:190-196`: `Buffer.concat([recvBuffer, chunk])` per
  `'data'` event, so a frame of N bytes in k chunks costs O(N*k/2) copying.
- Probe (throwaway bun test over a fake socket, deleted): one 6 MiB JSON frame delivered whole:
  11.4 ms; in 64 KiB chunks: 72.4 ms; in 16 KiB chunks: 173.5 ms (JSON.parse included in all).
  The extension host pays this on every large `commit.fileDiff`/`file.read` result (up to
  `MaxResultBytes` 6 MiB).
- Fix: once the header is known, preallocate `Buffer.allocUnsafe(declaredLength)` and copy chunks
  into it at an offset (or keep a chunk list and concat once when the frame completes).

### Block 5 candidate fates and notes

- §9 #9: concat half reported as F9. Back-pressure half dropped: client to server frames are
  requests, credits and cancels (bytes each); `socket.write` buffering them cannot grow.
- §9 #10 dropped: `streamChannel`'s peer is this process's own Go stream, capped at 8 MiB per frame
  by `rpcstream` (`bridge/gitstream.go:30,224`); Wails delivers whole messages.
- §9 #16 dropped: a throw inside a channel handler (incl. `ContractVersionMismatchError`) is
  caught and destroys the connection in `socketChannel` (`deliverFrame`, `:117-128`) and
  `streamChannel` (`:113-126`), rejecting every pending request via the owner's `onClose`. The
  webview pair (`vscode/src/transport.ts`, `webview/main.ts:94-98`) has no catch, but both halves
  ship in one VSIX and share one `CONTRACT_VERSION`, and the socket half is gated by the
  handshake's contract check (`handshake.go:103-108`).
- §9 #17 reported as F8.
- Blob frames: `substituteBlobRoot` rejects zero and multiple `$blob` markers; header length past
  the end throws (`blobFrame.ts:52-89`). Non-blob frames are never substituted, so a user string
  cannot become a marker. `codec.ts` base64 marker `$buf:'b64'` could only collide with a record
  keyed by user data whose value is the string `'b64'`; no such contract shape exists.
- F2/F3 comments in `rpc.ts` (chunk queue never rejects), `streamChannel.ts` (decode and delivery
  share one try), `socketChannel.ts` (delivery errors destroy, pending queue capped at 64) hold.
