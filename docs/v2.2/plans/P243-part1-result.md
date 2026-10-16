# P243 Part 1 result

Plan: `P243-part1-plan-iter2.md`. Branch `p243a-H`, base `v2.0` at `8aeb419d1`. Tests, one harness
helper and docs only. Nothing deleted: `git diff --diff-filter=D` against the base is empty. No product source,
`gitsock`, extension, `package.json` or lockfile change.

## Delivered

- `flowharness/stream.go`: `GitStream.Fire` (send without waiting, returns a cancel closure).
- `flows/gitflow`: `graphstream_test.go` (resume from cache, ranged resume, private walks, credit backpressure,
  stored page size), `matrix_test.go` (M1 to M4 flows, undo slot attribution, branch-delete undo, merge parent
  selector, detail cache, disconnect during write, remote op and credential prompt), `remote_guard_test.go`
  (force-push lease, push refusals, pull refusals, stored pull strategy, stale askpass directory),
  `perf_test.go` (`TestGraphStreamPerf`, `TestG8PerfBaseline`), `fixture_test.go` (golden graph chunk frame).
- `flows/reviewflow`: `comments_test.go`, `incremental_test.go`, `ranged_test.go`, `helpers_test.go`.
- `packages/git-ipc`: `streamChannel.test.ts` decodes the golden frame; `testdata/graphChunkFrame.{bin,json}`
  regenerated.
- Space `ui` specs (38 tests): `repo-graph-columns` (9), `repo-graph-refresh` (6), `repo-commit-meta` (2),
  `repo-file-tree` (3), `repo-branch-picker` (4), `repo-review-interaction` (8), `repo-graph-branch-order` (3),
  `repo-floating-geometry` (3). Support: `gitStreamMock.ts` (`gitStreamEmit`, `gitStreamRelease`,
  `gitStreamParams`, `graphStreamHoldAfter`), new `gitUiPortFixtures.ts`.
- `docs/DEV_ENVIRONMENT.md`: perf command line.
- Plan section 10 filled (also below).

## Checks (run once at the end)

- `go test` gitflow, reviewflow, coverage, gitsock: green. `bun run test:flows:space`: green.
- Gate-gap script: prints nothing. `exempt.txt`: empty.
- Fixture regeneration (`KIRA_GIT_FIXTURES=write`) changes the repo id (temp dir) and JSON layout only; the
  committed files stay. The non-write test passes. `bun test` streamChannel + socketChannel: 25 pass.
- Perf (`KIRA_GIT_PERF=1`): 20000 rows, 10 chunks, first chunk about 275 ms, total about 276 ms.
- Space UI: new specs plus `repo-*`, `git-panel-tab`, `ade-v2-review*`: 97 passed.
- `go test ./apps/kira-space/internal/gitsock/` and `bun run test:webview`: still green.

## Deviations and findings

- Audit tables were committed after the first ports, not before (the plan wanted them first). Rows were
  refined while porting.
- The first port commit (`66cc35172`) was staged with `git add -A` and carries a few extra files from the
  same work (fixture, perf test, DEV_ENVIRONMENT); the history was not rewritten.
- The golden fixture was regenerated: harness dates and identity are pinned, so the bytes differ from the
  old git.sock capture.
- Spawn-count assertions in the gitsock tests do not port: the native stream shares no per-connection
  process. Replaced by behavioural assertions (no git process under the repos, goroutine count settles).
- Credential prompts on the native stream arrive as `credential.request` events answered by
  `credential.provide`, not via `app.W.GitCredential`; the disconnect test uses that path.
- Finding (Space): a click, arrow key or double click on a commit-detail file row activates the new diff tab, so
  the graph view is hidden before a second gesture lands. A pinned open from the same tree cannot follow a
  preview in one flow. The UI test dispatches `dblclick` alone. Not a bug fix target for Part 1 (product
  source out of scope); worth a look when the git restyle starts.
- Finding (Space): in `reuseOrOpenRepoDiffTab`, a non-pinned reopen of an already pinned diff tab calls
  `evictPreviewCohort(..., existing.id)`, which makes that pinned tab the preview tab again. Not
  asserted by any test; recorded for a follow-up.
- `review.target` push race (`review-target-race`) does not port as written: Space answers `repo.list` in the
  host with no await window, and `review.target` is a local emit. Replaced by a Space-native test of the same
  cold-mount target hand-off (Review branch changes from the picker).
- UI ports total 38 tests, above the plan's guide of about 25. Each covers one distinct behaviour; rows
  folded together where one test proves several webview titles.
- `TestIntegration_UndoBranchDeleteRestoresTracking` had no native-stream twin (`gitsession` covers capture
  only): added `TestUndoBranchDeleteRestoresTracking`.
- Part 2 inherits one `p` row: `TestRecovery_SecondInstanceDoesNotListenOrUnlink` becomes an `AcquireLock` test
  in `apps/kira-space/internal/config/lock_test.go`.
- SPEC row says "Runs after P242 Part 3". Part 1 ran beside P242 Part 1 (disjoint files). Rewording the
  ordering clause is the user's call; not changed.

## Coverage audit, final classification

Classes: a transport- or extension-only, b already covered, c ported in Part 1, p ported in Part 2. Counts:
gitsock 136 rows (a 46, b 30, c 59, p 1); webview 64 titles (a 5, b 7, c 52). Evidence paths for gitsock
rows are under `apps/kira-space/internal/`.

### gitsock Go tests

| test | file | class | evidence |
|---|---|---|---|
| TestIntegration_AddThenListRoundTrips | comments_test.go | b | flows/reviewflow/review_test.go:TestReviewSessionRoundTrip |
| TestIntegration_CommentsAreOrderedByFileThenLine | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentsOrderedByFileThenLine |
| TestIntegration_CommentAnchorsProjectForward | comments_test.go | b | gitsession/comments_test.go:TestAnchorOne_ProjectedWhenLinesShiftAbove |
| TestIntegration_CommentSurvivesAnAmendAsStale | comments_test.go | b | gitsession/comments_test.go:TestAnchorOne_StaleAfterAmend |
| TestIntegration_ListAtAnExplicitRevision | comments_test.go | b | gitsession/comments_test.go:TestAnchorOne_ExactAtExplicitOlderRevision |
| TestIntegration_ExportIsExactlyThisText | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentExportText |
| TestIntegration_ExportIsEmptyWithNoComments | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentExportText (empty case) |
| TestIntegration_RemoveIsScopedAndIdempotent | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentRemoveScopedAndIdempotent |
| TestIntegration_ClearRemovesOnlyComments | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentClearKeepsMarks |
| TestIntegration_CommentRefusals | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentAddRefusals |
| TestIntegration_TwoConnectionsShareComments | comments_test.go | c | flows/reviewflow/comments_test.go:TestCommentsSharedAcrossConnections |
| TestIntegration_RefsChangedDoesNotDropComments | comments_test.go | c | flows/reviewflow/comments_test.go:TestRefsChangedKeepsComments |
| TestIntegration_CommitDetailAndFileTree | detail_test.go | b | flows/gitflow/detail_test.go:TestCommitDetailAndDiff |
| TestIntegration_CommitDetailMergeParentSelector | detail_test.go | c | flows/gitflow/matrix_test.go:TestCommitDetailMergeParentSelector |
| TestIntegration_FileDiffShapes | detail_test.go | b | flows/gitflow/detail_test.go:TestCommitDetailAndDiff (file diff hunks, binary diff) |
| TestIntegration_FileReadBranches | detail_test.go | b | flows/gitflow/detail_test.go:TestCommitDetailAndDiff (file.read equals git show) |
| TestIntegration_GoToTargetBranches | detail_test.go | b | flows/gitflow/detail_test.go:TestCommitDetailAndDiff (file.goToTarget) |
| TestIntegration_DetailCacheDropsOnRefsChanged | detail_test.go | c | flows/gitflow/matrix_test.go:TestDetailCacheDropsForEveryWindowOnRefsChanged |
| TestFrame_ZeroLengthBody | frame_test.go | a | socket framing; git.sock only |
| TestFrame_OneByteUnderMax | frame_test.go | a | socket framing; git.sock only |
| TestFrame_OneByteOverMax_WriteRefused | frame_test.go | a | socket framing; git.sock only |
| TestFrame_OneByteOverLimit_ReadRefusedBeforeBody | frame_test.go | a | socket framing; git.sock only |
| TestFrame_TruncatedNeverBlocksForever | frame_test.go | a | socket framing; git.sock only |
| TestFrame_TwoFramesInOneWrite | frame_test.go | a | socket framing; git.sock only |
| TestFrame_SplitAcrossThreeReads | frame_test.go | a | socket framing; git.sock only |
| TestIntegration_GraphStreamRendersAPage | graphstream_test.go | b | flows/gitflow/graph_test.go:TestGraphFirstPage |
| TestIntegration_GraphStreamResumesFromCache | graphstream_test.go | c | flows/gitflow/graphstream_test.go:TestGraphStreamResumesFromCache |
| TestIntegration_RangedGraphStreamResumesFromCache | graphstream_test.go | c | flows/gitflow/graphstream_test.go:TestRangedGraphStreamResumesFromCache |
| TestIntegration_WalksArePrivatePerConnection | graphstream_test.go | c | flows/gitflow/graphstream_test.go:TestGraphWalksArePrivatePerConnection |
| TestIntegration_CreditsApplyBackpressure | graphstream_test.go | c | flows/gitflow/graphstream_test.go:TestGraphStreamCreditBackpressure |
| TestFixtures_CaptureGraphChunkFrame | graphstream_test.go | c | flows/gitflow/fixture_test.go:TestFixtures_CaptureGraphChunkFrame (golden frame over the native stream) |
| TestGraphStreamPerf | graphstream_test.go | c | flows/gitflow/perf_test.go:TestGraphStreamPerf |
| TestIntegration_GraphLoadMoreHonorsRepoStoredPageSize | graphstream_test.go | c | flows/gitflow/graphstream_test.go:TestGraphLoadMoreHonorsStoredPageSize |
| TestHandshake_Row1_MalformedFrame_ClosesSilently | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row1_EmptyClientID_ClosesSilently | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row1_OversizedClientID_ClosesSilently | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row2_ProtocolMismatch | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row3_ContractVersionMismatch | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row4_ValidToken_Ready | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row5_TokenRejected_NoRow | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row5_TokenRejected_RevokedRow | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row6_NoTokenInCooldown_DeniedImmediately | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row7_PairingApproved_Ready | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row7_PairingDenied | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row7_PairingTimeout | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestHandshake_Row7_DisconnectDuringWaitCancelsEntry | handshake_test.go | a | pairing handshake over git.sock; the native stream has no handshake |
| TestIntegration_ReviewFilesIsTheThreeDotRange | incremental_test.go | b | flows/gitflow/misc_test.go:TestReviewSession (review.files equals git diff main...feat) |
| TestIntegration_MarkThenNothingChangesTakesTheUnchangedPath | incremental_test.go | b | gitsession/incremental_test.go:TestFileDelta_UnchangedAfterUnrelatedCommits |
| TestIntegration_MarkThenEditTakesTheFastPath | incremental_test.go | b | gitsession/incremental_test.go:TestFileDelta_FastAfterANormalEdit |
| TestIntegration_MarkThenAmendTakesTheSlowPath | incremental_test.go | b | gitsession/incremental_test.go:TestFileDelta_SlowAfterAmend |
| TestIntegration_MarkThenPruneStillTakesTheSlowPath | incremental_test.go | b | gitsession/incremental_test.go:TestFileDelta_SlowAfterPrune |
| TestIntegration_PartialRangesSurviveAnInsertion | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestPartialRangesSurviveAnInsertion |
| TestIntegration_UnmarkingPartOfAFullFileDemotesIt | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestUnmarkingPartOfAFullFileDemotesIt |
| TestIntegration_BinarySnapshotDegradesHonestly | incremental_test.go | b | gitsession/incremental_test.go:TestFileDelta_SnapshotUnavailableForRewrittenBinary |
| TestIntegration_DeletedFileCanBeMarkedReviewed | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestMarkFilesWithoutLines (deleted) |
| TestIntegration_TwoConnectionsShareReviewState | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestReviewStateSharedAcrossConnections |
| TestIntegration_ReviewRefusalsAreBadRequests | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestReviewRefusals |
| TestIntegration_ReviewMarkRejectsInvalidRanges | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestReviewRefusals (ranges) |
| TestIntegration_RefsChangedDoesNotDropReviewState | incremental_test.go | c | flows/reviewflow/incremental_test.go:TestRefsChangedKeepsReviewState |
| TestIntegration_FullPairingAndRPCLifecycle | integration_test.go | a | pairing lifecycle over git.sock |
| TestIntegration_RepoChangedReachesEveryHolder | integration_test.go | b | flows/gitflow/misc_test.go:TestTwoConnectionsShareRepo |
| TestIntegration_RefcountAndDisconnectTeardown | integration_test.go | b | gitsession/registry_test.go:TestRegistry_ReleaseToZeroArmsLingerNotImmediateTeardown; gitsession/conn_test.go:TestConn_CloseReleasesEveryHoldAndUnsubscribes |
| TestIntegration_RevokeThenRepairReachesReady | integration_test.go | a | revoke then re-pair over git.sock |
| TestServer_Close_ReturnsPromptlyWithAPendingPairingRequest | integration_test.go | a | git.sock close with pending pairing |
| TestServer_Close_ReturnsPromptlyWithASilentConnection | integration_test.go | a | git.sock close with silent connection |
| TestIntegration_PairingRequestCarriesKernelReportedPeer | integration_test.go | a | kernel peer credentials of the unix socket |
| TestMain | main_test.go | a | helper, not behaviour |
| TestMatrix_M1_WriteInOneWindowIsVisibleInTheOther | matrix_test.go | b | flows/gitflow/misc_test.go:TestTwoConnectionsShareRepo |
| TestMatrix_M1_UndoSlotAttributionBothWays | matrix_test.go | c | flows/gitflow/matrix_test.go:TestUndoSlotIsSharedAndAttributed |
| TestMatrix_M1_DetailCacheIsSharedAndDroppedForBoth | matrix_test.go | c | flows/gitflow/matrix_test.go:TestDetailCacheDropsForEveryWindowOnRefsChanged |
| TestMatrix_M1_StreamStalledOnCreditsBlocksOnlyItsOwnConnection | matrix_test.go | c | flows/gitflow/matrix_test.go:TestStalledStreamBlocksOnlyItsOwnConnection |
| TestMatrix_M2_SimultaneousRemoteRunsAdmitExactlyOne | matrix_test.go | c | flows/gitflow/matrix_test.go:TestSimultaneousRemoteRunsAdmitExactlyOne |
| TestMatrix_M2_LocalOpAndRemoteOpAreNotMutuallyExclusive | matrix_test.go | c | flows/gitflow/matrix_test.go:TestLocalWriteAndRemoteOpAreNotMutuallyExclusive |
| TestMatrix_M3_FullIndependence | matrix_test.go | c | flows/gitflow/matrix_test.go:TestTwoRepositoriesShareNothing |
| TestMatrix_M3_NoGoroutineOrProcessGrowth | matrix_test.go | c | flows/gitflow/matrix_test.go:TestConnectionCyclesLeakNothing |
| TestMatrix_M4_DisconnectDuringRepoOpen | matrix_test.go | c | flows/gitflow/matrix_test.go:TestConnectionCyclesLeakNothing (open then close) |
| TestMatrix_M4_DisconnectDuringAWrite | matrix_test.go | c | flows/gitflow/matrix_test.go:TestWriteSurvivesCancelAndDisconnect (disconnect) |
| TestMatrix_M4_DisconnectWithAStreamOpen | matrix_test.go | c | flows/gitflow/matrix_test.go:TestConnectionCyclesLeakNothing (stream cancelled, connection closed) |
| TestMatrix_M4_DisconnectDuringARemoteOp | matrix_test.go | c | flows/gitflow/matrix_test.go:TestDisconnectDuringRemoteOpKeepsTheSlotUntilItEnds |
| TestMatrix_M4_DisconnectDuringACredentialPrompt | matrix_test.go | c | flows/gitflow/matrix_test.go:TestDisconnectDuringCredentialPromptFreesTheSlot |
| TestIntegration_RefsList | ops_test.go | b | flows/gitflow/concurrency_test.go:TestParallelOpsOneRepo (refs.list asserted); flows/gitflow/helpers_test.go refs() |
| TestIntegration_StatusAndInProgressBanner | ops_test.go | b | flows/gitflow/worktree_state_test.go:TestWorkingTreeStates |
| TestIntegration_CheckoutPreflightAndRun | ops_test.go | b | flows/gitflow/ops_local_test.go:TestCheckoutDirtyAutostash |
| TestIntegration_RevertPreflightAndConflict | ops_test.go | b | flows/gitflow/ops_local_test.go:TestCherryPickRevertConflict |
| TestIntegration_UndoBranchDeleteRestoresTracking | ops_test.go | c | flows/gitflow/matrix_test.go:TestUndoBranchDeleteRestoresTracking (added for this row; gitsession covers capture only) |
| TestIntegration_UndoSlotIsSharedAndAttributed | ops_test.go | c | flows/gitflow/matrix_test.go:TestUndoSlotIsSharedAndAttributed |
| TestIntegration_UnservedOpKindIsRefused | ops_test.go | c | flows/gitflow/matrix_test.go:TestUnservedOpKindIsRefused |
| TestIntegration_WriteSurvivesClientCancel | ops_test.go | c | flows/gitflow/matrix_test.go:TestWriteSurvivesCancelAndDisconnect |
| TestG8PerfBaseline | perf_test.go | c | flows/gitflow/perf_test.go:TestG8PerfBaseline |
| TestHelperProcess_GitsockServer | recovery_support_test.go | a | helper, not behaviour |
| TestRecovery_AfterSIGKILLWithRepositoriesOpen | recovery_test.go | a | socket file and lock recovery after SIGKILL; no socket on the native stream |
| TestRecovery_SecondInstanceDoesNotListenOrUnlink | recovery_test.go | p | Part 2: apps/kira-space/internal/config/lock_test.go (AcquireLock: second refused, release then reacquire) |
| TestRecovery_StaleAskpassDirectoryIsInert | recovery_test.go | c | flows/gitflow/remote_guard_test.go:TestFetchIgnoresStaleAskpassDirectory |
| TestRecovery_NoOrphanedGitChildren | recovery_test.go | c | flows/gitflow/matrix_test.go:TestConnectionCyclesLeakNothing (no git process under either repo after the cycles) |
| TestAskpassHelperProcessForGitsock | remote_test.go | a | helper, not behaviour |
| TestIntegration_FetchUpdatesRefsAndReportsProgress | remote_test.go | b | flows/gitflow/remote_test.go:TestRemoteFetchPullPush |
| TestIntegration_PushSetsUpstreamAndReportsUpdates | remote_test.go | b | flows/gitflow/remote_test.go:TestRemoteFetchPullPush |
| TestIntegration_PushNonFastForwardIsClassified | remote_test.go | b | flows/gitflow/errors_test.go:TestPushRejectedNonFastForward |
| TestIntegration_ForcePushLeaseViolation | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestForcePushLeaseGuards |
| TestIntegration_ForcePushStaleExpectedTipIsRefusedBeforeSpawning | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestForcePushLeaseGuards (stale expected tip) |
| TestIntegration_HookRejectionCarriesTheHooksOwnMessage | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestPushRefusals (hook rejection) |
| TestIntegration_ProtectedBranchNeedsTheTypedName | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestPushRefusals (protected branch) |
| TestIntegration_PullDecomposesAndAConflictLandsInTheBanner | remote_test.go | b | flows/gitflow/remote_test.go:TestRemoteFetchPullPush (pull conflict, continue) |
| TestIntegration_PullRefusesWhenBranchCheckedOutChanged | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestPullRefusedWhenAnotherBranchIsCheckedOut |
| TestIntegration_CredentialRelayAnswersAndNeverHangs | remote_test.go | b | flows/gitflow/complete_test.go:TestCredentialPrompt; flows/gitflow/credential_test.go:TestHTTPRemoteCredentialPrompt |
| TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest | remote_test.go | c | flows/gitflow/matrix_test.go:TestSimultaneousRemoteRunsAdmitExactlyOne; cancel: flows/gitflow/complete_test.go:TestRemoteCancel |
| TestIntegration_PullPreflightHonorsRepoStoredStrategy | remote_test.go | c | flows/gitflow/remote_guard_test.go:TestPullPreflightHonorsStoredStrategy |
| TestIntegration_SocketClientCannotAnswerCredentials | remote_test.go | a | git.sock gate; credentials answer over the native stream by design (credential.provide) |
| TestIntegration_ResolveBaseFourOutcomes | review_test.go | c | flows/reviewflow/ranged_test.go:TestResolveBaseFourOutcomes (TestReviewSession asserts one outcome only) |
| TestIntegration_ResolveBaseReasonsAndCandidates | review_test.go | c | flows/reviewflow/ranged_test.go:TestResolveBaseReasonsAndCandidates |
| TestIntegration_ResolveBaseHonoursRequestBaseCandidates | review_test.go | a | extension-injected baseCandidates request field, removed in Part 2 |
| TestIntegration_ResolveBaseHonoursRepoStoredBaseCandidates | review_test.go | c | flows/reviewflow/ranged_test.go:TestResolveBaseUsesStoredCandidates |
| TestIntegration_RangedWalkMatchesGitLog | review_test.go | c | flows/reviewflow/ranged_test.go:TestRangedWalkMatchesGitLog |
| TestIntegration_RangedWalkDoesNotDisturbTheGraph | review_test.go | c | flows/reviewflow/ranged_test.go:TestRangedWalkLeavesTheGraphAlone |
| TestIntegration_RangedLoadMoreAndStatus | review_test.go | c | flows/reviewflow/ranged_test.go:TestRangedLoadMoreAndStatus |
| TestIntegration_ReviewWalkResetsAfterRefsChange | review_test.go | c | flows/reviewflow/ranged_test.go:TestReviewWalkResetsAfterRefsChange |
| TestIntegration_TwoConnectionsReviewIndependently | review_test.go | c | flows/reviewflow/ranged_test.go:TestTwoConnectionsReviewIndependently |
| TestIntegration_RangedRefusalsAreBadRequests | review_test.go | c | flows/reviewflow/ranged_test.go:TestRangedRefusals |
| TestRevoke_WhileIdle | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_WhileHoldingAGraphWalk | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_WhileHoldingAReviewSession | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_WhileARemoteOpIsRunning | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_WhileACredentialPromptIsPending | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_DoesNotDisturbAnotherClient | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestRevoke_TOCTOU_ClosesAConnectionAdmittedWithASinceRevokedToken | revoke_test.go | a | token revocation; the native stream has no tokens (teardown mid-op is covered by the matrix M4 tests) |
| TestServer_TrackConn_RefusesAfterClose | server_test.go | a | git.sock listener tracking |
| TestIntegration_RepoSettingsWriteFansOutAndIsPerRepo | settings_test.go | b | gitrpc/settings_test.go:TestRepoSettings_ChangedEventReachesEveryConnection; TestRepoSettings_GraphScopeIsScopedAcrossRepos |
| TestIntegration_SocketClientCannotSetRepoSettings | settings_test.go | a | git.sock gate; no such gate on the native stream |
| TestIntegration_SocketClientCannotStorePrepareScript | settings_test.go | a | git.sock gate; native twin gitrpc/settings_test.go:TestRepoSettings_PrepareScriptIsRefusedFromTheWire |
| TestIntegration_StashListShowAndCleanOps | stash_test.go | b | flows/gitflow/ops_local_test.go:TestStashFlows |
| TestIntegration_StashPopConflictOverTheWire | stash_test.go | b | flows/gitflow/ops_local_test.go:TestStashFlows (conflicting pop is a StashConflict, stash kept) |
| TestToken_MintThenVerify_Succeeds | token_test.go | a | git.sock token store; the native stream has no tokens |
| TestToken_VerifyAgainstDifferentSalt_Fails | token_test.go | a | git.sock token store; the native stream has no tokens |
| TestToken_VerifyWrongToken_Fails | token_test.go | a | git.sock token store; the native stream has no tokens |
| TestToken_VerifyMalformedPresented_DoesNotPanic | token_test.go | a | git.sock token store; the native stream has no tokens |
| TestToken_DummyComparison_NeverPanics | token_test.go | a | git.sock token store; the native stream has no tokens |

### webview interaction and layout specs

| # | test | spec | class | evidence |
|---|---|---|---|---|
| 1 | webview layout › graph panel at 1400×360 | webview-layout.spec.ts | a | extension HTML document, CSP and body padding; Space panel layout is covered by panel-resize.spec.ts |
| 2 | webview layout › graph panel at 400×300 (no generous viewport assumed) | webview-layout.spec.ts | a | extension HTML document, CSP and body padding; Space panel layout is covered by panel-resize.spec.ts |
| 3 | webview layout › review sidebar at 400×700 | webview-layout.spec.ts | a | extension HTML document, CSP and body padding; Space panel layout is covered by panel-resize.spec.ts; no Space-specific 400x700 fact found, the review host fills its panel (repo-graph-lifecycle.spec.ts) |
| 4 | branch picker › renders five tabs whose badges match the seeded counts | branch-picker.spec.ts | c | apps/kira-space/tests/ui/repo-branch-picker.spec.ts: five tabs show badges that match the seeded counts |
| 5 | branch picker › clicking Stashes swaps the body and relabels the filter | branch-picker.spec.ts | c | apps/kira-space/tests/ui/repo-branch-picker.spec.ts: Stashes swaps the body and relabels the filter |
| 6 | branch picker › a query typed on Branches puts a match badge on Stashes, and the switch keeps it | branch-picker.spec.ts | c | apps/kira-space/tests/ui/repo-branch-picker.spec.ts: a query on Branches badges Stashes and survives the tab switch |
| 7 | branch picker › opening the panel focuses the filter input | branch-picker.spec.ts | c | apps/kira-space/tests/ui/repo-branch-picker.spec.ts: the filter takes focus on open; ArrowDown enters the rows, ArrowUp returns |
| 8 | branch picker › ArrowDown from the filter focuses the first row; ArrowUp returns to the filter | branch-picker.spec.ts | c | apps/kira-space/tests/ui/repo-branch-picker.spec.ts: the filter takes focus on open; ArrowDown enters the rows, ArrowUp returns |
| 9 | CommitMeta message-body clamp › collapsed shows only the title, the date/SHA facts row, and "Open all changes" — the body is hidden, not clamped | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: collapsed, the pane shows the title, a short SHA and Open all changes, and nothing else |
| 10 | CommitMeta message-body clamp › "Show more" reveals the body at its full height, with no clamp applied | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: Show more reveals the full body, trailers, identities and refs, and the pane scrolls |
| 11 | CommitMeta message-body clamp › "Show more" grows the meta pane and makes its content reachable by scroll, not clipped | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: Show more reveals the full body, trailers, identities and refs, and the pane scrolls |
| 12 | CommitMeta message-body clamp › a commit with a ref decoration shows the Refs row after "Show more" | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: Show more reveals the full body, trailers, identities and refs, and the pane scrolls |
| 13 | CommitMeta message-body clamp › trailers and the author line are absent while collapsed, and appear together after Show more | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: Show more reveals the full body, trailers, identities and refs, and the pane scrolls |
| 14 | CommitMeta message-body clamp › the facts row shows a short SHA in both states, with no separate SHA/parent row | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: both tests assert commit-meta-sha |
| 15 | CommitMeta message-body clamp › the file tree occupies at least three quarters of the pane while collapsed | commit-meta-clamp.spec.ts | c | apps/kira-space/tests/ui/repo-commit-meta.spec.ts: collapsed test asserts the file tree >= 75% of the pane |
| 16 | file tree open gestures › a single click opens one preview (unpinned) diff | file-tree-open.spec.ts | c | apps/kira-space/tests/ui/repo-file-tree.spec.ts: a single click opens one preview diff tab |
| 17 | file tree open gestures › a double click opens a preview, then a pinned, diff | file-tree-open.spec.ts | c | apps/kira-space/tests/ui/repo-file-tree.spec.ts: a double click event opens a pinned diff tab (Space activates the diff tab on the first open, so a real click then dblclick cannot land on the tree; dblclick is dispatched alone) |
| 18 | file tree open gestures › Enter on the focused row opens one pinned diff, with no preceding preview | file-tree-open.spec.ts | c | apps/kira-space/tests/ui/repo-file-tree.spec.ts: the double click test; Enter emits the same openFile(pinned) as dblclick (FileTree.vue), and no Space path reaches Enter before a preview |
| 19 | file tree open gestures › two files with different extensions render different seti icons | file-tree-open.spec.ts | b | apps/kira-space/tests/ui/repo-workspace.spec.ts: a repo workspace: file-tree rows carry per-language icons, directories keep their codicon |
| 20 | file tree open gestures › the status letter is smaller than the row | file-tree-open.spec.ts | c | apps/kira-space/tests/ui/repo-file-tree.spec.ts: the status letter is smaller than its row |
| 21 | floating primitives — geometry › Tooltip flips above a trigger with no room below | floating-geometry.spec.ts | c | apps/kira-space/tests/ui/repo-floating-geometry.spec.ts: a tooltip flips above a trigger with no room below |
| 22 | floating primitives — geometry › DropdownMenu flips above the click point with no room below | floating-geometry.spec.ts | c | apps/kira-space/tests/ui/repo-floating-geometry.spec.ts: a dropdown menu flips above the click point with no room below |
| 23 | floating primitives — geometry › BaseSelector Popover shifts back on-screen near a horizontal viewport edge | floating-geometry.spec.ts | c | apps/kira-space/tests/ui/repo-floating-geometry.spec.ts: the base selector popover shifts back on-screen near the right edge |
| 24 | graph branch order and collapse › renders group-major: main first and never collapsed, feature-newer collapsed, feature-older in full | graph-branch-order.spec.ts | b | apps/kira-space/tests/ui/repo-workspace.spec.ts: the default view collapses feature-newer, main and feature-older render in full |
| 25 | graph branch order and collapse › draws exactly two dashed fork stubs, on each feature branch's own oldest row | graph-branch-order.spec.ts | c | apps/kira-space/tests/ui/repo-graph-branch-order.spec.ts: each feature branch draws one dashed fork stub on its oldest row |
| 26 | graph branch order and collapse › a click expands a collapsed group to its full member list, in order | graph-branch-order.spec.ts | b | apps/kira-space/tests/ui/repo-workspace.spec.ts: a manual expand and the toolbar collapse-off choice both survive a tab switch and back; order also in apps/kira-space/tests/ui/repo-graph-branch-order.spec.ts: expanding a collapsed group lists its members in order |
| 27 | graph branch order and collapse › the toolbar toggle off renders every row expanded in group order; toggling back on re-collapses a never-expanded group | graph-branch-order.spec.ts | c | apps/kira-space/tests/ui/repo-graph-branch-order.spec.ts: collapse toggled off keeps group order, moves the stubs and never overlaps rows |
| 28 | graph branch order and collapse › no row overlap and no horizontal scrollbar after toggling collapse off | graph-branch-order.spec.ts | c | apps/kira-space/tests/ui/repo-graph-branch-order.spec.ts: collapse toggled off keeps group order, moves the stubs and never overlaps rows |
| 29 | graph grid columns › renders exactly the four remaining columns, with no SHA cell anywhere | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: the grid has the four columns and no SHA cell, and the date column fits its widest rendering |
| 30 | graph grid columns › the date column is at least as wide as its own widest absolute rendering | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: the grid has the four columns and no SHA cell, and the date column fits its widest rendering |
| 31 | graph grid columns › the one loaded row is the fixture commit | graph-columns.spec.ts | a | fixture self-check of the fake host's one commit; asserts no behaviour |
| 32 | graph grid columns › row height and graph-node alignment (item 1) › an undecorated row is shorter than a row with a ref badge | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a decorated row is taller, and each row graph node sits on its own subject line |
| 33 | graph grid columns › row height and graph-node alignment (item 1) › row 0's graph node is vertically centred on its own subject line | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a decorated row is taller, and each row graph node sits on its own subject line |
| 34 | graph grid columns › row height and graph-node alignment (item 1) › row 1's graph node is vertically centred on its own subject line | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a decorated row is taller, and each row graph node sits on its own subject line |
| 35 | graph grid columns › one click on an unselected row opens the detail pane | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: one click opens the detail pane, a second on the same row closes it |
| 36 | graph grid columns › clicking the already-selected row toggles the pane closed | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: one click opens the detail pane, a second on the same row closes it |
| 37 | graph grid columns › the row and every cell in it, including the date cell, show a pointer cursor | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: every cell shows a pointer cursor, and clicking the date cell leaves its text alone |
| 38 | graph grid columns › clicking the date cell does not change the rendered date text | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: every cell shows a pointer cursor, and clicking the date cell leaves its text alone |
| 39 | graph grid columns › the detail pane open compacts the grid to graph+message, and the message cell takes the whole remaining width | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: with the detail pane open the grid keeps graph and message, and the message takes the rest |
| 40 | graph grid columns › auto-refresh on repo.changed › a refsChanged event for the open repo triggers graph.refresh within 1s, with no click | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: refsChanged for the open repo refreshes the graph; other kinds and other repos do not |
| 41 | graph grid columns › auto-refresh on repo.changed › a worktreeChanged event never triggers graph.refresh | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: refsChanged for the open repo refreshes the graph; other kinds and other repos do not |
| 42 | graph grid columns › auto-refresh on repo.changed › a refsChanged event for a different repoId never triggers graph.refresh | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: refsChanged for the open repo refreshes the graph; other kinds and other repos do not |
| 43 | graph grid columns › auto-refresh on repo.changed › the viewport scroll position is preserved across an auto-refresh | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: a refresh keeps the scroll position |
| 44 | graph grid columns › column rebuild is gated on lane count actually changing › a second chunk at the same lane count does not rebuild the header columns | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a second chunk at the same lane count keeps the header columns |
| 45 | graph grid columns › graph column resize (item 1) › a resize handle exists for the graph column, defaults to <=95px | graph-columns.spec.ts | b | apps/kira-space/tests/ui/repo-graph-paging.spec.ts: columns resized wide never push the graph out of view |
| 46 | graph grid columns › graph column resize (item 1) › dragging the handle narrows the graph column and widens the message column by the same amount, with every graph svg staying inside its own cell | graph-columns.spec.ts | b | apps/kira-space/tests/ui/repo-graph-paging.spec.ts: a resized graph column keeps every node after Load more |
| 47 | graph grid columns › viewport sizing (item 2) › the grid never grows a horizontal scrollbar once a vertical one appears, at the default width and after toggling the detail pane | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a tall grid never grows a horizontal scrollbar, open or closed, and keeps one tabbable row |
| 48 | graph grid columns › keyboard tab stop (P168 Part 19 F8) › a rendered row stays tabbable after the selected row scrolls out of range | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a tall grid never grows a horizontal scrollbar, open or closed, and keeps one tabbable row |
| 49 | graph grid columns › row reposition after a height change (item 4) › a row whose height grows after first render repositions every row below it, with no overlap | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a row that grows after first paint pushes every row below it down, with no overlap |
| 50 | graph grid columns › ref/tag badges render as tinted outlines (item 10) › a tag badge's background is a translucent tint, its border carries the colour, and its icon matches the badge's own text colour | graph-columns.spec.ts | c | apps/kira-space/tests/ui/repo-graph-columns.spec.ts: a tag badge is a translucent tint with a coloured border and a matching icon |
| 51 | commit context menu vs. auto-refresh (P108 F2) › a refresh mid-menu closes the context menu instead of leaving it targeting a stale row | graph-context-menu-refresh.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: a refresh mid-menu closes the commit context menu |
| 52 | create-branch dialog vs. reconnect (P108 F3) › a reconnect while the create-branch dialog is open closes it | graph-dialog-reconnect.spec.ts | a | connection.changed reconnect event; the Space host reports connection state itself and emits no such event |
| 53 | failure banner and auto-fetch marker (P173) › a corrupted graph stream shows a styled banner, text pointer, no Operations button | graph-failures.spec.ts | b | apps/kira-space/tests/ui/repo-graph-failures.spec.ts: a corrupted graph stream shows the banner and Retry re-sends graph.refresh; the "no Operations button" and bundle-CSS assertions are extension-bundle facts (Space shows the Operations shortcut, same file: a failed remote op shows the banner, hint, and an Operations shortcut) |
| 54 | failure banner and auto-fetch marker (P173) › autoFetch.changed shows the stopped marker | graph-failures.spec.ts | b | apps/kira-space/tests/ui/repo-graph-failures.spec.ts: a stopped auto-fetch shows the marker; also apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: an autoFetch.changed event raises and clears the stopped marker |
| 55 | CommitGrid initial scroll row (P108 F1) › a persisted scrollRow: 0 does not crash on a cold boot that mounts before the first chunk lands | graph-initial-scroll-row.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: a restored scrollRow of 0 does not crash a grid that mounts before its first chunk |
| 56 | CommitGrid initial scroll row (P108 F1) › a persisted scrollRow beyond the current history clamps to the last row instead of crashing | graph-initial-scroll-row.spec.ts | c | apps/kira-space/tests/ui/repo-graph-refresh.spec.ts: a restored scrollRow beyond the history clamps to the last row |
| 57 | review commit list render cap › mounts at most the render cap, and "Show more" reveals the rest | review-commit-list-cap.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: 600 commits mount 500 rows; Show more reveals the rest |
| 58 | review sidebar interaction › clicking a file inside an expanded commit does not collapse the row | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: clicking a file inside an expanded commit does not collapse the row |
| 59 | review sidebar interaction › "Open all changes" on a collapsed row sends editor.openAllChanges | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: Open all changes on a collapsed row opens one multi-diff tab and leaves the row collapsed (Space answers editor.openAllChanges locally with a repo-multi-diff tab) |
| 60 | review sidebar interaction › "Open in graph" sends graph.revealCommit with the row's sha | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: Open in graph activates the graph tab on that commit |
| 61 | review sidebar interaction › the Files pane's reviewed control is a checkbox with three states | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: the Files pane reviewed control is a checkbox with three states |
| 62 | review sidebar interaction › Space on the focused reviewed checkbox marks the file | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: Space on the focused reviewed checkbox marks the file |
| 63 | review sidebar interaction › the back button returns to the branch-picker screen | review-interaction.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: the back button returns to branch selection |
| 64 | ReviewView bootstrap vs. a review.target push (P108 F6) › a review.target push during repo.list wins — repoId is never overwritten by the workspace default | review-target-race.spec.ts | c | apps/kira-space/tests/ui/repo-review-interaction.spec.ts: Review branch changes from the picker opens the Review tab on that branch (Space-native cold-mount target hand-off; the extension repo.list race has no await window in Space, whose host answers repo.list locally) |
