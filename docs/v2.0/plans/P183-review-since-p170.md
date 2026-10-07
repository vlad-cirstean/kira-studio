# P183 review: everything since P170

Report-only code review. One Opus pass over three dimensions: architecture/security,
functional correctness, performance.

- Base: `06cbb98` (P170 close-out, last review session).
- Head: `157f673` (`v2.0`, P182 result).
- Scope: `git diff 06cbb98..157f673`, 337 files, 107 commits. Covers P172, P173, P174, P175, P176,
  P177, P178, P179, P181, P182. Fixer commits in these files count as unreviewed.
- Discovery used `codegraph_explore` for owned files and one-hop callers per area.

Open: F8 (low). Parked: D2 (user wants it configurable in the UI; tracked as a SPEC row).

## Clean areas

Checked against current source, nothing real found:

- P172 peer credentials (`gitsock/peer*.go`, `handleConn`): fails closed on lookup error, UID check,
  pre-handshake 64 KiB read cap, post-admission revocation re-check. Token binding stays an
  existing Known open item.
- P172/P178 `refuseSpaceOnly`: `credential.provide` and `repoSettings.set` refused on `git.sock`.
  No stream method reaches either. Prepare-script leaf refused in `handleRepoSettingsSet` for
  every connection.
- P173 frame cap: Go `maxFrameBytes`, `maxGitStreamFrameBytes` and TS `MAX_FRAME_BYTES` all 32 MiB.
  `rpcstream.sendResult`/`sendChunk` answer `E_FRAME_TOO_LARGE` instead of a silent drop.
- P173 auto-fetch backoff (`nextAutoFetchDelay` shift clamp, cap, stop/rearm), `graph.reportFailure`
  (message composed server-side, never client text).
- Contract bump: Go `ContractVersion = 45`, TS `CONTRACT_VERSION = 45`, both history comments agree.
  No stale literal in fixtures.
- P174 SQL/Mongo/ClickHouse console caps: `Next` before the cap check makes `truncated` mean "more
  existed". Redis bounded forms (`planIndexRange`, `planLimit`, `planCount`, `runScan` dedupe).
  `dbmcp` `Truncated` now also honours the page flag. Binary marker (`page.BytesCell`).
- P174 PK-keyed staged edits (`pendingChanges.ts`): partial key refused while meta is known; the
  meta-not-loaded window still hits server `AssertKeyIsPrimaryKey`, no wrong-row write.
- P175 cookiejar fork: BSD LICENSE kept, upstream header, additions isolated in `entries.go`; a named
  requirement (stdlib jar exposes no entries/delete). Cookie query cancel-then-set ordering.
  `dotenv.ts` serialize/parse round trip, `mergeRawHeaders`.
- P176 deleted-connection guard, textarea cell editor, native clipboard in text controls.
- P178 relay (`gitcred.Relay`) ordering and withdraw; `gitCredential` store sync; extension trust.
  The relay queue is unbounded, but each prompt needs a live git op holding its repo's remote slot,
  so growth is bounded by open repos. `peerExe` costs one process lookup per accepted connection.
- P179 renames: values preserved (`SingleRowMaxBytes` = old `DocumentTruncateBytesSingle`).
- P181 storage: repo never selects `uri`, `SecretWrite`, duplicate copies ciphertext, reveal gated
  through `localauth.Gated`, Copy URI gated. Create/Test normalize (see F2 for Update).
- P182 sticky header/gutter: scroll hot path untouched; `getBoundingClientRect` shim is read only by
  SlickGrid's resize/drag measurements.
- Standing rules: every new/changed SFC is `<script setup lang="ts">`, no `<style>` block, no
  `defineComponent`. New Pinia stores stay one concern.

## Tests against the unit-test bar

### F8. `gitcred/relay_test.go` keeps tests that restate short function bodies

- File: `apps/kira-space/internal/gitcred/relay_test.go:50` (`TestAnswerReachesAsk`), `:66`
  (`TestDismissalReturnsFalse`), `:102` (`TestDoubleProvideIsNoOp`), `:121`
  (`TestSnapshotOrderIsFIFO`), `:164` (`TestOnAddedFiresOncePerEntry`).
- Severity: low.
- Summary: CLAUDE.md's bar keeps tests only for genuinely hard logic. These five each restate a
  few-line branch of `Ask`/`Provide` or `PendingQueue`'s FIFO (already covered by `notify`).
  `TestCtxCancelWithdrawsAndEmits` and `TestConcurrentAsksAllResolve` guard real concurrency and stay.
- Failure scenario: none at runtime; maintenance cost and a precedent against the standing rule.
- Suggested fix: delete the five; keep the two concurrency tests.

## Parked: DESIGN-DECISION, needs user input

### D2. Read-only SQS visibility timeout

SQS has no peek. A 1 s timeout keeps messages visible to real consumers but forces dedupe and risks
multiple receives per poll. A timeout equal to the poll's own duration (a few seconds) gives at
most one receive per message per poll but hides messages from consumers that long. User call on
which side read-only browse should favour. The poll already stops at the first batch holding a repeat.
