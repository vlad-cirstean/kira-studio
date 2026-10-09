# P243 Part 1 plan, iter2: carry coverage off the extension and git.sock

SPEC row P243 Part 1. User's words for P243: "drop the VS Code extension, and the git server it uses
to connect, etc." Part 1 is prep only: move every test whose behaviour Space keeps off the extension
and off `internal/gitsock`, so Part 2's deletion loses no coverage. **Nothing is deleted in Part 1.**
Part 2 (removal) gets its own iter2 plan before it starts; section 8 refreshes its inventory against
the current tree. P245 (git restyle) is out of scope; iter1 §7 still lists its leftovers.

Baseline: `P243-plan.md` (iter1). This file replaces iter1 §4, §6 (Part 1 half), §8, §9 (Part 1
half) and §10. Iter1 §2, §3, §5, §7 stay Part 2's baseline, with section 8's deltas.

Base: `v2.0` at `c05e1971d`. Landed: P236 (flows, coverage gate), P237, P238, P239, P240, P244.
In flight: P242 Part 1 in `/home/user/kira-sG` (branch `p242a-G`, plan `P242-part1-plan-iter2.md`).

Discovery: `codegraph_explore` over the coverage gate (`internal/flowtest/coverage.go`
`CheckCoverage`, `BoundMethods`, `isBoundName`) and `internal/rpcstream/session.go` (`Handlers`,
`MaxFrameBytes`, the gitsock-only comments). `apps/kira-space/**` Go and `apps/kira-space-vscode`
are not in the CodeGraph index (same gap iter1 and P242 name), so read directly:
`flows/coverage/{coverage_test.go,exempt.txt}`, `gitrpc/handlers.go` (dispatch table),
`bridge/gitstream.go` (allowlist), `flowharness/stream.go` (`OpenGitStream`, `readLoop`, `Chunk`),
every `gitsock/*_test.go` name, every `flows/{gitflow,reviewflow}` test, `gitsession`/`gitrpc` test
names, `gitsock/graphstream_test.go` (`TestFixtures_CaptureGraphChunkFrame`, `TestGraphStreamPerf`),
`gitsock/perf_test.go`, `packages/git-ipc/src/{socketChannel,streamChannel}.test.ts`, every
`apps/kira-space-vscode/tests/{interaction,layout}` spec title, `apps/kira-space/tests/ui/support/
gitStreamMock.ts`, Space `repo-*`/`git-panel-tab` spec titles, `docs/DEV_ENVIRONMENT.md`, root
`package.json`, `.github/workflows/{pr,release}.yml`; `p242a-G` diff against `c05e1971d`.

## 0. What changed vs iter1

1. **Gate facts verified, zero gaps today.** P236's gate (`flows/coverage/coverage_test.go`) checks
   every Wails-bound method plus every git request name parsed from `gitrpc/handlers.go`
   (`requestHandlers` keys and `Stream` cases, 58 names). `exempt.txt` is empty (0 exemptions). A
   scripted pass over all 58 names found **none** referenced only from `flows/editorflow`: every git
   request already has a native-stream flow reference. So Part 2's deletion of `editorflow` loses no
   gate coverage for git requests. Part 1 keeps that true (section 3.6).
2. **Counts are larger.** gitsock: 136 `func Test*` across 23 test files (iter1 said ≈120); 3 are
   helpers or `TestMain`, not behaviour. Webview: 62 `test(` call sites across 14 files; several are
   parameterised loops (`row ${row}`, layout viewports), so the runtime count is higher. The audit
   classifies per runtime title (`playwright test --list`).
3. **Pre-classification given.** Iter1 left all classification to the implementer. Section 4 gives
   each gitsock file and webview spec a likely class and the native test to check first. The
   implementer still confirms each row by reading both tests.
4. **Raw-frame tap needed.** `flowharness.GitStream.readLoop` strips the blob-frame header and keeps
   only `Chunk{JSON,Blob}`; the golden fixture needs the exact frame body. Part 1 adds a small tap.
5. **UI event push needed.** `gitStreamMock.ts` answers requests and streams but cannot push an
   `evt` frame. Ports of `refsChanged`/`worktreeChanged`/`autoFetch.changed`/`review.target` cases
   need a `gitStreamEmit(page, method, payload)` helper.
6. **New class `p` (port in Part 2).** `gitsock.AcquireLock` guards Space's single instance
   (`main.go:222`, `app.lock`); its only tests are gitsock's recovery tests. It moves to
   `internal/config` in Part 2, so its test moves there with it, not in Part 1.
7. **Concurrency with P242 Part 1.** Iter1 said "runs alone after P242 Part 3". Part 1 touches no
   product file and shares no file with P242 Part 1 (section 6), so it can run beside it. Part 2
   cannot (section 8.3). Row order change needs the user's approval (section 9).

## 1. Current tree (verified)

- Extension `apps/kira-space-vscode`: 14 spec files under `tests/interaction` (13) and
  `tests/layout` (1); harness servers in `tests/{interaction,layout}/support` and
  `tests/support/webviewServer.ts`; run by `bun run test:webview` (builds the bundle first).
- `internal/gitsock`: 8903 test lines. Golden fixture `TestFixtures_CaptureGraphChunkFrame`
  (`KIRA_GIT_FIXTURES=write`) writes `packages/git-ipc/testdata/graphChunkFrame.{bin,json}`; its TS
  half is the D16 test in `packages/git-ipc/src/socketChannel.test.ts` (`createSocketChannel`, re-adds
  the 4-byte length prefix). Perf: `TestG8PerfBaseline` (`perf_test.go`) and `TestGraphStreamPerf`
  (`KIRA_GIT_PERF=1`); command in `docs/DEV_ENVIRONMENT.md:179`.
- Native stream: `bridge.ServeGitStream(router, conn)` serves `gitrpc.Router` through `rpcstream`
  behind `gitstream.go`'s allowlist (`worktree.prepare*` refused with `E_READ_ONLY`).
  `flowharness.App.OpenGitStream()` gives an in-memory connection per call (several per app work,
  which is how `TestTwoConnectionsShareRepo` runs); `Request`, `Stream(method, params, credit)`,
  `StreamCall.{Credit,Cancel,Next,Drain}`, `Events`, `WaitEvent`, `Close`.
- Native Go flows today: `gitflow` (15 files, incl. graph paging/refresh, detail, ops, stash,
  worktree, remote, credential, cancel, restack, search, settings-to-stream, two connections) and
  `reviewflow/review_test.go` (`TestReviewSessionRoundTrip`: fileDiff, snapshot, mark, comment
  add/list/clear). Unit coverage in `gitsession/*_test.go` (anchors, file deltas, registry, conn,
  remote slot, credentials, ops table, undo guard) and `gitrpc/*_test.go` (dispatch, settings
  fan-out, prepare-script refusal, stack, stash, worktree).
- Space UI specs: `repo-graph-{failures,lifecycle,lines,paging,pr-badge,rewalk}`, `repo-workspace`,
  `git-panel-tab`, `git-credential-relay`, `ade-v2-review*`, with `support/{gitStreamMock,
  graphStreamFixture,graphPagingFixture}.ts`.

## 2. Classes

| Class | Meaning | Row must name |
|---|---|---|
| a | transport- or extension-only; dies in Part 2 | what makes it extension-only |
| b | behaviour already proven by an existing test | that test (`file:TestName` or spec title) |
| c | uncovered; ported in Part 1 | the new test |
| p | covered only by gitsock; ported in Part 2 beside the code it tests | Part 2 target file |

A row is `b` only when the named test asserts the same outcome, not just calls the same method.
Unit-level proof (`gitsession`, `gitrpc`) counts: the native stream's transport is proven once by
`gitflow`, so each handler's semantics need not be re-proven over the stream.

## 3. Work

### 3.1 Audit tables first (resumability)

Fill section 10 with one row per gitsock `Test*` and per webview runtime test title, class and
evidence. Commit the tables before any port (`docs(v2.2): P243 Part 1 coverage audit tables`), with
`c` rows naming their planned test. Update rows as ports land.

### 3.2 Go ports to the native stream

Target: `apps/kira-space/internal/flows/gitflow/` (graph, ops, remote, detail, matrix) and
`flows/reviewflow/` (review, comments, incremental), new files only plus `helpers_test.go` additions
in those two packages. Use `flowharness.GitStream`; two windows = two `OpenGitStream`; disconnect =
`GitStream.Close()` mid-call. One Go test per distinct behaviour; near-duplicates merge into `t.Run`
cases (CLAUDE.md test bar). Default settings, real `git`, temp repos (P231 rule).

Suggested files: `gitflow/graphstream_test.go` (cache resume, ranged resume, private walks per
connection, credit backpressure, stored page size), `gitflow/matrix_test.go` (two-connection and
disconnect-mid-op cases), `gitflow/remote_guard_test.go` (force-push lease and stale tip, hook
message, protected-branch typed name, pull branch-changed, stored pull strategy, second remote op),
`reviewflow/comments_test.go`, `reviewflow/incremental_test.go`, `reviewflow/ranged_test.go`.
Names follow the behaviour, not the gitsock test name.

### 3.3 Golden graph-chunk fixture over the native stream

1. `flowharness/stream.go`: add `StreamCall.NextRaw() ([]byte, bool, error)` (or a `GitStream`
   raw-frame tap) returning the frame body exactly as `ServeGitStream` sent it. No change to
   `readLoop`'s decoding for other callers.
2. `gitflow/fixture_test.go`: `TestFixtures_CaptureGraphChunkFrame`, same gate
   (`KIRA_GIT_FIXTURES=write`), same repo shape (3 commits), same JSON fixture schema; writes
   `packages/git-ipc/testdata/graphChunkFrame.{bin,json}`.
3. Move the D16 decode test from `socketChannel.test.ts` into `streamChannel.test.ts`, feeding the
   `.bin` through `createStreamChannel` (no length prefix: the Wails stream carries whole frames).
   Shared decoration helpers move with it. Leave `socketChannel.test.ts`'s copy in place until
   Part 2 deletes the file (nothing deleted in Part 1); both read the same fixture.
4. Proof: run the capture, then `git diff --exit-code packages/git-ipc/testdata/`. The body bytes
   should be transport-agnostic (same `rpcstream` encoder). If they differ, commit the regenerated
   files and state the cause in the result; both TS tests must still pass.

### 3.4 Perf tests

Port `TestG8PerfBaseline` and `TestGraphStreamPerf` to `gitflow/perf_test.go` over
`OpenGitStream`, gated `KIRA_GIT_PERF=1`, numbers logged, nothing asserted (as today). Update
`docs/DEV_ENVIRONMENT.md:179` to
`KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline' ./apps/kira-space/internal/flows/gitflow/ -v`
and say the gitsock copy goes in Part 2. `docs/PERF.md` keeps its numbers; Part 2 rewords its
gitsock wording.

### 3.5 Webview specs to Space UI specs

Port `c` rows into new `apps/kira-space/tests/ui/*.spec.ts` files driving the Space git module
through `installGitStreamMock`. Suggested grouping: `repo-branch-picker.spec.ts`,
`repo-commit-meta.spec.ts`, `repo-file-tree.spec.ts`, `repo-graph-columns.spec.ts`,
`repo-graph-refresh.spec.ts` (event-driven refresh, context menu on refresh, initial scroll row),
`repo-review-interaction.spec.ts` (expanded commit, mark checkbox, back button, commit list cap,
`review.target` race), `repo-floating-geometry.spec.ts`. One spec per behaviour; merge parameterised
duplicates.

Support changes, `gitStreamMock.ts` only: `gitStreamEmit(page, method, payload)` pushing an `evt`
frame on the open socket; extra fixtures in a new `support/gitUiPortFixtures.ts` if
`graphStreamFixture.ts` would grow a second concern. Do not edit `ipcChannels.ts`,
`mockRuntime.ts`, `bootSnapshots.ts`, `fixtures.ts` or any existing spec (P242 Part 1 owns or edits
several; section 6). If a port truly needs one of them, stop and record it in the audit row as `c`
deferred to Part 2, not a silent skip.

`floating-geometry` cases test shared shadcn-vue/reka positioning in git-ui; port them only if no
Space spec or `packages/git-ui` test already asserts the flip (likely `b` or one small spec).

### 3.6 Gate stays green, zero exemptions

- New Go tests only add references; the gate cannot fail from Part 1.
- Before finishing, re-run the scripted check (section 7) proving every git request in
  `handlers.go` is referenced in a flow test outside `flows/editorflow`. Today: 0 gaps.
- `exempt.txt` stays empty.

## 4. Pre-classification (implementer confirms each row)

gitsock, by file (`n` = tests):

| File (n) | Likely class | Check first |
|---|---|---|
| `frame_test` (7), `handshake_test` (13), `token_test` (5), `revoke_test` (7), `server_test` (1) | a | socket framing, pairing handshake, token store, revocation, listener tracking |
| `integration_test` (7) | a for pairing lifecycle, revoke-then-repair, close with pending pairing or silent conn, kernel peer; b for `RepoChangedReachesEveryHolder` (`gitflow/misc_test:TestTwoConnectionsShareRepo`) and `RefcountAndDisconnectTeardown` (`gitsession/{conn,registry}_test`) | |
| `main_test` `TestMain`, `recovery_support_test` `TestHelperProcess_GitsockServer`, `remote_test` `TestAskpassHelperProcessForGitsock` | a | helpers, not behaviour |
| `settings_test` (3) | `SocketClientCannot*` a (git.sock gate; native twin `gitrpc/settings_test:RepoSettings_PrepareScriptIsRefusedFromTheWire`); `RepoSettingsWriteFansOutAndIsPerRepo` b (`RepoSettings_ChangedEventReachesEveryConnection`, `RepoSettings_GraphScopeIsScopedAcrossRepos`) | |
| `graphstream_test` (8) | c: resume from cache, ranged resume, private walks per connection, credit backpressure, stored page size; `RendersAPage` b (`gitflow/graph_test:TestGraphFirstPage`); fixture and perf: 3.3, 3.4 | |
| `comments_test` (12) | b: add/list round trip, clear (`reviewflow`), anchors and stale after amend, explicit revision (`gitsession/comments_test:AnchorOne_*`); c: file-then-line order, export exact text and empty export, remove scoped and idempotent, refusals, two connections share, refs change keeps comments | |
| `incremental_test` (13) | b: unchanged/fast/slow paths, prune, binary snapshot (`gitsession/incremental_test:FileDelta_*`), three-dot range (`gitflow/misc_test:TestReviewSession`); c: partial ranges survive insertion, unmark demotes full file, deleted file markable, two connections share state, refusals, invalid ranges, refs change keeps state | |
| `review_test` (10) | a: `ResolveBaseHonoursRequestBaseCandidates` (extension-injected `baseCandidates`, removed in Part 2); b: four outcomes (`TestReviewSession` `review.resolveBase`) if it asserts each outcome, else c; c: reasons and candidates, stored base candidates, ranged walk equals `git log`, ranged walk leaves graph alone (unit twin `gitsession/conn_test:Conn_ReviewWalkDoesNotDisturbTheGraphWalk` may make it b), ranged load-more and status, walk reset on refs change, two connections independent, ranged refusals | |
| `detail_test` (6) | b: detail and file tree, diff shapes, file read, go-to target (`gitflow/detail_test:TestCommitDetailAndDiff` subtests); c: merge parent selector, detail cache dropped on refs change | |
| `ops_test` (8) | b: refs list, status banner, checkout preflight and run, revert conflict, undo (`gitflow/ops_local_test`, `worktree_state_test`); c: undo branch delete restores tracking (unless `gitsession/undo_guard_test` covers), undo slot shared and attributed, unserved op kind refused, write survives client cancel | |
| `remote_test` (14) | b: fetch, push upstream, non-fast-forward (`gitflow/{remote,errors}_test`), credential relay (`gitflow/{complete,credential}_test`), second op and cancel (`TestRemoteCancel`), pull conflict banner; check `gitsession/remote_test` for branch-changed and protected gates; c for the rest; `SocketClientCannotAnswerCredentials` a | |
| `stash_test` (2) | b: list/show/clean (`TestStashFlows`); pop conflict b if `gitsession/ops_test:RunOp_StashPopConflict_Reclassifies` asserts the wire result, else c | |
| `matrix_test` (13) | M1 write visible in other window b (`TestTwoConnectionsShareRepo`); undo slot attribution, shared detail cache, credit stall isolated, M2 one remote op admitted, local and remote ops not exclusive (`gitsession/concurrency_test` may cover some), M3 independence and no goroutine or process growth, M4 disconnect during open, write, stream, remote op, credential prompt: c | |
| `recovery_test` (4) | `SecondInstanceDoesNotListenOrUnlink` p (`apps/kira-space/internal/config/lock_test.go`, two acquires, second refused, release then reacquire); `AfterSIGKILLWithRepositoriesOpen` a (socket file and lock recovery); `StaleAskpassDirectoryIsInert` c to `gitaskpass` package test only if no test there covers it; `NoOrphanedGitChildren` c as M4-style "close mid remote op leaves no git child" in `gitflow/matrix_test.go` | |
| `perf_test` (1), `graphstream_test` `TestGraphStreamPerf`, `TestFixtures_CaptureGraphChunkFrame` | c | 3.3, 3.4 |

Webview, by spec:

| Spec (sites) | Likely class |
|---|---|
| `graph-dialog-reconnect` (1) | a: `connection.changed`, extension-only |
| `review-target-race` (1) | c: Space emits `review.target` locally (`hostHandlers.ts:379`) |
| `graph-failures` (2) | b: `repo-graph-failures` (corrupt stream banner, stopped auto-fetch marker); confirm "no Operations button" wording, else c |
| `graph-branch-order` (5) | b for default collapse and manual expand (`repo-workspace` collapse tests); c for dashed fork stubs, toggle-off order, no overlap after toggle |
| `graph-columns` (21+) | b for resize and paging (`repo-graph-paging`, `repo-graph-lines`); c for column set, date width, row heights, select/deselect, pointer cursor, compact grid with detail open, event-driven refresh rules (3 cases), scroll kept on refresh, header not rebuilt, no horizontal scrollbar, tabbable row, growing row repositions |
| `graph-context-menu-refresh` (1), `graph-initial-scroll-row` (2) | c |
| `branch-picker` (5), `commit-meta-clamp` (7), `file-tree-open` (5) | c, except seti icon per extension b (`repo-workspace` per-language icons) |
| `floating-geometry` (3) | b or c (3.5 note) |
| `review-commit-list-cap` (1), `review-interaction` (6) | c, except "switching to Review mounts the sidebar" overlap b (`repo-workspace`) |
| `webview-layout` (2+) | a for webview viewport chrome; c only for a layout fact Space's review sidebar must keep at 400×700 |

Webview tests that drive a git-ui capability gate set `false` in Space (resolve in VS Code, open in
new window, prepare, read-only `write === false`) are `a`: Space never renders those branches.

## 5. Files (ownership)

| File | Change |
|---|---|
| `apps/kira-space/internal/flows/gitflow/{graphstream,matrix,remote_guard,fixture,perf}_test.go` | new |
| `apps/kira-space/internal/flows/gitflow/helpers_test.go` | helper additions only |
| `apps/kira-space/internal/flows/reviewflow/{comments,incremental,ranged,helpers}_test.go` | new |
| `apps/kira-space/internal/flowharness/stream.go` | raw-frame tap (3.3) |
| `apps/kira-space/internal/gitaskpass/*_test.go` | only if the stale-askpass row is `c` |
| `packages/git-ipc/src/streamChannel.test.ts` | D16 decode test |
| `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` | regenerated only if bytes differ |
| `apps/kira-space/tests/ui/repo-{branch-picker,commit-meta,file-tree,graph-columns,graph-refresh,review-interaction,floating-geometry}.spec.ts` | new (final set follows the audit) |
| `apps/kira-space/tests/ui/support/gitStreamMock.ts` | `gitStreamEmit` |
| `apps/kira-space/tests/ui/support/gitUiPortFixtures.ts` | new, only if needed |
| `docs/DEV_ENVIRONMENT.md` | perf command line |
| `docs/v2.2/plans/P243-part1-plan-iter2.md` | section 10 tables |
| `docs/v2.2/SPEC.md` | row status and `P243 Part 1 result`, after landing (section 6) |

Not touched: any product source, `apps/kira-space-vscode/**`, `internal/gitsock/**`, `gitrpc`,
`gitsession`, `bridge`, `appwire`, `main.go`, `flows/{coverage,editorflow,termflow,adeflow,
journeyflow}/**`, `flowharness/harness.go`, `tests/ui/support/{ipcChannels,mockRuntime,
bootSnapshots}.ts`, `tests/ui/fixtures.ts`, existing specs, `package.json`, lockfile, `go.mod`,
`.github/**`, `docs/ARCHITECTURE.md`.

## 6. Overlap with P242 Part 1 (`P242-part1-plan-iter2.md` section 4, plus `p242a-G` diff)

Compared against P242 Part 1's ownership list and the files `p242a-G` has already changed
(`ade/**`, `adewire/wire.go`, `gitsession/worktree.go`, `storage/{migrations,model,repos}`,
`internal/runoutcome`, `packages/shared/domain/runOutcome.ts`, ADE frontend files,
`tests/unit/support/adeV2Fixtures.ts`).

| Area | P242 Part 1 | P243 Part 1 | Verdict |
|---|---|---|---|
| `flows/{termflow,journeyflow,adeflow}` | edits, new | none | disjoint |
| `flows/{gitflow,reviewflow}` | none | new files, helpers | disjoint |
| `flowharness/stream.go` | none (reads `harness.go` only) | tap | disjoint |
| `flows/coverage` | none (adds bound methods, each called in its own flows) | none | disjoint; both keep 0 exemptions |
| `gitsession/worktree.go` | prepare reason via `runoutcome` | none (read-only) | disjoint |
| Space `tests/ui/support/{ipcChannels,mockRuntime}.ts` | edits | not touched | disjoint |
| Space `tests/ui/support/gitStreamMock.ts` | none | `gitStreamEmit` | disjoint |
| Space specs `git-panel-tab`, `repo-workspace` and others | edits (mode key, ids) | not touched; new files only | disjoint |
| `packages/git-ipc/**` | none | test, testdata | disjoint |
| `docs/DEV_ENVIRONMENT.md` | none | one line | disjoint |
| `docs/v2.2/SPEC.md` | row and result (deferred docs commit) | row and result | **shared file, different lines**: each lands its SPEC edit after its code lands on `v2.0`, one at a time |
| `docs/ARCHITECTURE.md` | edits | none | disjoint |

Verdict: **no overlapping file except `docs/v2.2/SPEC.md`**, which both write only in a closing docs
commit, sequenced. No ordering dependency: Part 1 needs nothing P242 Part 1 adds, and P242 Part 1
needs nothing from Part 1. Runtime coupling checked: new UI specs open the Git module, not the
renamed Terminal/Automations module, so P242's mode-key rename does not reach them; if a new spec
needs a mode switch helper, it uses the git mode key only.

Run as a separate stream in its own worktree off `v2.0` (`c05e1971d` or later), per CLAUDE.md
(the pre-commit hook lints and typechecks the whole tree). Streams in flight: P242 Part 1 plus this
one = 2, at the cap. Landing: rebase onto `v2.0` in either order; a conflict outside `SPEC.md` means
this table was wrong.

## 7. Tests and checks

Per commit: hooks (go build, golangci-lint, `bun run typecheck`, `bun run lint`, `bun run
lint:dead`). No `--no-verify`.

Once, at the end:

- `go test ./apps/kira-space/internal/flows/gitflow/ ./apps/kira-space/internal/flows/reviewflow/
  ./apps/kira-space/internal/flows/coverage/` green; `bun run test:flows:space` green.
- `KIRA_GIT_FIXTURES=write go test -run TestFixtures_CaptureGraphChunkFrame
  ./apps/kira-space/internal/flows/gitflow/` then `git diff --exit-code packages/git-ipc/testdata/`
  (or the stated regeneration); `bun test packages/git-ipc/src/streamChannel.test.ts
  packages/git-ipc/src/socketChannel.test.ts`.
- `KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline'
  ./apps/kira-space/internal/flows/gitflow/ -v` runs and logs numbers.
- `bun run test:ui:space` for the new specs plus `repo-*`, `git-panel-tab`, `ade-v2-review*`.
- Still green (nothing removed): `go test ./apps/kira-space/internal/gitsock/`, `bun run
  test:webview`.
- Gate gap script (must print nothing):

  ```sh
  cd apps/kira-space/internal
  for n in $(grep -oE '^\s*"[a-zA-Z]+\.[a-zA-Z.]+"\s*:' gitrpc/handlers.go | tr -d ' \t":'; grep -oE 'case "[a-zA-Z.]+"' gitrpc/handlers.go | cut -d'"' -f2); do
    grep -rlq --include='*_test.go' --exclude-dir=editorflow "\"$n\"" flows || echo "$n"
  done
  ```

A failing test or hook found on the way is fixed in this pass (CLAUDE.md), unless it needs work in a
file P242 Part 1 owns: then record it in the result and fix after both land.

Commits (Conventional): `docs(v2.2): P243 Part 1 coverage audit tables`; `test(space): native-stream
graph stream and matrix flows`; `test(space): review comments and incremental flows over the native
stream`; `test(space): remote guard flows over the native stream`; `test(space): graph chunk golden
fixture over the native stream`; `test(space): git stream perf over the native stream`;
`test(space): git-ui interactions ported from the webview suite` (split by area if large); closing
`docs(v2.2): P243 Part 1 result` after landing.

## 8. Part 2 inventory refresh (input for its iter2 plan, not done here)

Iter1 §2 and §5 hold. Deltas found on the current tree:

### 8.1 Additions to iter1's delete/edit list

- Gitflow tests that name dying requests: `gitflow/ops_local_test.go:221` (`worktree.prepare`
  expects `E_READ_ONLY`) and `gitflow/errors_test.go:99` `TestWorktreeCancelPrepare`
  (`worktree.cancelPrepare`). Once the handlers go, these get `E_UNKNOWN_METHOD`: delete them in the
  same commit as the handlers. The gate parses `handlers.go`, so removed names leave the gate; it
  stays green with 0 exemptions as long as no new request lands unreferenced.
- `gitrpc/worktree_test.go` `WorktreePrepare_*`, `WorktreeCancelPrepare_*`;
  `gitsession/concurrency_test.go` `Concurrent_PrepareAndRestackAfterTeardownAreRefused` (prepare
  half); `gitrpc/stash_test.go` `ContractVersion_Is45` (bump to 46).
- `gitrpc/settings_test.go` `RepoSettings_PrepareScriptIsRefusedFromTheWire` stays (native
  security boundary, iter1 §2.2).
- `editorflow/**` deletion takes `GitClientsService.*` out of `BoundMethods`; nothing to exempt.
- `packages/git-ipc/src/socketChannel.test.ts` goes with `socketChannel.ts`; Part 1's
  `streamChannel.test.ts` keeps the fixture check.
- `gitsock/perf_test.go`, `graphstream_test.go` fixture/perf copies go; `docs/PERF.md` rewording.
- `config/lock_test.go` (class `p`) when `AcquireLock` moves.
- Comment-only references to gitsock or gitvsix, reword when touched: `internal/rpcstream/
  {frame,session}.go`, `internal/notify/ordered{,_test}.go`, `internal/startupfail/{alert,classify,
  exec,report,step}.go`, `internal/tokenauth/tokenauth.go`, `internal/kirapaths/paths.go`,
  `internal/toolexec/exec.go`, `internal/pairing/pairing_test.go`, `apps/kira-space/internal/config/
  paths.go`, `gitclient/repo_test.go`, `gitsession/{autofetch_test,conn,conn_test,entry,registry}.go`,
  `packages/git-core/src/util/nfcPath.test.ts`, `packages/git-ipc/src/{streamChannel,validate}.ts`,
  `packages/theme/src/tailwind-core.css` (check: may be P245 styling).
  `rpcstream.Handlers.MaxFrameBytes` has gitsock as its only setter: drop the field or keep it with
  a non-gitsock reason.
- `tests/ui/support/bootSnapshots.ts` git clients entries (iter1 listed only ipcChannels/mockRuntime).

### 8.2 CI, release, scripts, workflows

- `.github/workflows/release.yml:139-141` (`VSCODE_PKG` version stamp and check): release breaks
  once `apps/kira-space-vscode/package.json` is gone. `.github/workflows/pr.yml:198,230`: step names
  cite gitsock (cosmetic; inotify limit still needed by `gitsession`). Cannot push workflow changes
  from this sandbox: write `docs/pending-changes/.github__workflows__release.yml.patch` and
  `.github__workflows__pr.yml.patch` (`docs/DEV_ENVIRONMENT.md` "Git push" section; directory does
  not exist yet). Result section must say the release workflow fails until the user applies the
  release patch. No workflow runs `test:webview` today.
- Root `package.json`: workspace `apps/kira-space-vscode`; scripts `build:vscode`, `package:vscode`,
  `test:webview`; `typecheck:git` extension leg; `test:unit` path `apps/kira-space-vscode/src`;
  devDeps `@types/vscode`, `@vscode/vsce` (keep `@vscode/codicons` for P245). `bun.lock` after
  `bun install`.
- `scripts/{build-vscode,package-vscode}.ts`, `scripts/check-tokens.sh` (webview leg),
  `scripts/verify-packaging.sh` (S9, A6), `apps/kira-space/build/Taskfile.yml` (`build:vsix`),
  `apps/kira-space/build/darwin/Taskfile.yml` (vsix copy), `knip.json`, `biome.json`, `.gitignore`,
  `tools/mutation/areas.json`, `packages/workbench/src/testing/ui/server.ts`,
  `packages/git-ui/vite.config.ts`.
- Docs: `docs/ARCHITECTURE.md`, `docs/PACKAGING.md`, `docs/DEV_ENVIRONMENT.md` (webview suite at
  line 209, Part 1's perf line stays), `docs/PERF.md`, root `README.md`, `apps/kira-space/README.md`
  (plus the uninstall line, iter1 §3).

### 8.3 Part 2 cannot run beside P242 Part 1

Shared files: `appwire/{appwire,wire}.go`, `main.go`, `bridge/events.go`, `gitsession/worktree.go`
(P242 rewrites prepare's reason; Part 2 deletes prepare), `storage/migrations` (P242 takes
`0026`; Part 2's `git_clients` drop takes the next free number), `storage/repos/repos.go`,
`frontend/src/{App.vue,main.ts,bridge/index.ts}`, `tests/ui/support/{ipcChannels,mockRuntime}.ts`,
`frontend/bindings/**` (both regenerate), `docs/ARCHITECTURE.md`. Part 2 starts after P242 Part 1
has landed, and its iter2 plan re-reads that tree.

## 9. Decisions for the orchestrator or user

1. **Row order.** SPEC row P243 Part 1 says "Runs after P242 Part 3". Running it now, beside P242
   Part 1, is an order change only the user makes (CLAUDE.md). If approved, the closing docs commit
   rewords the row's ordering clause. Part 2's position is unchanged unless the user moves it too.
2. Class `p` (section 0 item 6): one Part 1 audit row resolved in Part 2. Accept, or ask for an
   `AcquireLock` test now in gitsock (it would die in Part 2).
3. Iter1 O2 stands: if ports exceed ~25 UI tests, one per distinct behaviour.

## 10. Coverage audit tables (filled by the implementer)

Columns: test | file | class (a, b, c, p) | evidence (covering test, new test, or reason). `?` only
while unfinished; Part 1 is not done while one remains.

### 10.1 gitsock Go tests

(empty)

### 10.2 webview interaction and layout specs

(empty)

## 11. Orchestrator verification checklist

- [ ] `git diff --stat c05e1971d..HEAD` (Part 1 branch) touches only section 5 files; `git diff
      --diff-filter=D --name-only` empty.
- [ ] Section 10: `grep -cE '\| \? \|' docs/v2.2/plans/P243-part1-plan-iter2.md` is 0; row count
      equals 136 (133 behaviour tests plus 3 helpers) and the `playwright test --list` count of the
      extension config.
- [ ] Each `c` row's test exists: `git grep -n "func <Name>"` or the spec title.
- [ ] Gate script (section 7) prints nothing; `exempt.txt` empty; coverage test green.
- [ ] Fixture check and both TS fixture tests green; perf command runs.
- [ ] New UI specs green; existing `repo-*`, `git-panel-tab`, `ade-v2-review*` green;
      `test:webview` and gitsock tests still green.
- [ ] Subagent's tool log shows real `codegraph_explore` calls where it did discovery.
- [ ] No commit used `--no-verify`.
