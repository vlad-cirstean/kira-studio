# P168 Part 18 findings: `git-core` and `git-ui` logic

Plan: `P168-part18-git-ui-logic.md`. Base `c9e3647`; HEAD reviewed `6882b22` (plan commit only on
top). Reviewer reports only; no source edited. Paths as in plan: `GC` = `packages/git-core/src`,
`GU` = `packages/git-ui/src`, `IPC` = `packages/git-ipc/src`.

## Checks (at `6882b22`)

- `bun test packages/git-core/src packages/git-ui/src/state packages/git-ui/src/graph`: 375 pass,
  0 fail, 33 files, 4.0 s.
- `bun run typecheck:git`: clean.
- `KIRA_GIT_DIFFERENTIAL=1 go test -count=1 -v -run 'Conformance|Differential'
  ./apps/kira-space/internal/gitsearch/`: `TestConformanceCorpus_NonEmpty`,
  `TestConformanceCorpus_AgreesWithCompileAndMatchFields`, `TestDifferential` (0.74 s) all PASS.
- Probes: throwaway `GU/state/zzprobe*.test.ts`, deleted before each commit.

## Block status

- Block 1 (bridge, Part 17 consumers): done.
- Block 2 (graph data and layout): done.
- Block 3 (graph and review session state): done.
- Block 4 (search): done.
- Block 5 (ops and side state): done.
- Block 6 (`git-core` models, preflight, settings, util, ports): done.
- Block 7 (tests and conventions): done. Review complete.

## Findings

(Severity order within each block; ids are stable once committed.)

### Block 1: bridge and Part 17 consumers

Nothing real in `GU/bridge/client.ts`, `latestRequest.ts`, `repoScopedReload.ts`,
`pendingSlot.ts`, `bootstrap.ts`. Ops-side error exits found while checking candidate 6 are
reported under block 5.

### Block 2: graph data and layout

**F1 (medium): grouped graph paints lanes from the previous layout for one worker round trip
after every plan rebuild.** `GU/state/graphView.ts:462-466` publishes `plan.value` before
`#layoutClient.submit` resolves (`:477`); `layout` is replaced only at `:495-497`.
`CommitGrid.vue:1041-1043` (Part 19) watches `plan` and calls `grid.invalidate()` at once, so the
formatter repaints with the new plan and the old `LayoutStore`. `readSlice`
(`GU/graph/graphColumn.ts:40-58`) guards only `row >= layout.rowCount`; every other row reads
`layout.laneOf(row)`/`segmentsInRow(row)` keyed to the OLD display rows. Scenario: grouped mode
(App passes a `GraphOrderState`), a page lands or auto-refresh adds a commit to group 0; every
display row below the insertion point shifts by one, so each visible row briefly shows the lane,
colour and edges of the commit that used to sit there. Collapse toggle and tip changes
(`rebuildOrder`, `:512-516`) do the same; `rebuildOrder`'s own doc comment names the stale paint
but only repaints after it. Duration is one full-store worker pass (O(rows); hundreds of ms on a
200k-row repo). Identity mode is unaffected (rows never move). Code-read.
Fix: record which plan a layout was built for and draw no lanes on a mismatch. E.g. a
`layoutPlan` field on `GraphViewState` set in the same synchronous block as
`layout.clear()/append()` (`:495-497`); `createGraphFormatter` takes a `layoutPlan` accessor and
`readSlice` returns the `lane: undefined` slice when `layoutPlan() !== plan()`. Text stays
first-paint; lanes fill in when the matching layout lands (the drain/`rebuildOrder` listeners
already repaint then). Touches `CommitGrid.vue` call site (`needs-other-part-file:
packages/git-ui/src/components/CommitGrid.vue (Part 19)`, Stream B, editable).

**F2 (low): `LayoutStore.#collectLongSegments` scans every long edge above the row, per rendered
row.** `GU/graph/layoutStore.ts:410-422` walks `#longEdges[0, upperBound)`; entries whose edge
closed long ago are skipped one by one. Every rebuild is now one full-store chunk
(`graphView.ts:474,495-496`), so `#applyPatches`/`#demoteIfNowShort` never run on this caller and
the "hundreds, not thousands" bound (`:52-59`) rests only on history shape. Probe (verified): a
200k-row synthetic history with one 80-row second-parent edge every 20 commits gives 9,996 long
edges; `segmentsInRow` for 60 rows costs 6.9 ms at the bottom of history vs 0.24 ms at the top
(one viewport render; half a 60 Hz frame on scroll near the bottom of a large monorepo).
Fix: index long edges by row block at `append` time (e.g. `LONG_EDGE_ROWS`-sized blocks, each
holding the refs of long edges that cover it; an unresolved edge registers to `rowCount`), so a
row query scans only its block. Memory is sum(span)/64 refs. Keep `segmentsInWindow` equality.

**F3 (low): literal NUL byte in `GC/graph/rowPlan.ts:108`.** `const OTHER_KEY = '<0x00>other'`
holds a raw `0x00` (`od -c` shows `'\0other'`). Git classifies the whole file as binary:
`git log -p -- packages/git-core/src/graph/rowPlan.ts` prints "Binary files ... differ", so
`git diff`, review tooling and `git grep` skip the file's text. Verified. Fix: write
`'\u0000other'` (same runtime value).

**F4 (low): a layout worker that fails to load leaves every later `submit()` pending forever.**
`GU/graph/layoutClient.ts:161-163` rejects the pending submits on `onerror`, but a module worker
whose script fails to load (CSP `worker-src` drift, chunk 404 after an extension update while a
webview stays open) is dead; later `postMessage` calls get no reply. `#drainLayoutRebuilds`
(`graphView.ts:560-579`) then awaits forever with `#layoutDraining = true`, so no later chunk
starts a drain and the graph column stays blank for the session with only one console line. The
synchronous `SecurityError` case already falls back (`:106-112`); the asynchronous load failure
does not. Code-read.
Fix: in `onerror`, if no response has ever arrived, terminate the worker and swap in
`createMainThreadWorker()` (re-post the still-pending requests, or reject them and let the next
rebuild submit to the fallback).

**F5 (low): dead code on the graph path.**
- `GC/graph/stashRows.ts` (`buildStashRowFilter`, `applyStashRowFilter`, exported at
  `GC/index.ts:18-19`): no caller anywhere in the repo (`git grep`), no test.
- `LayoutStore.segmentsInWindow` (`GU/graph/layoutStore.ts:227-242`): doc says it is
  `segmentsInRow`'s test oracle; no test or caller uses it.
- The frontier/resume path: `#rebuildLayout` calls `#layoutClient.reset()` before every `submit`
  (`graphView.ts:474`), so `frontier` is always `undefined` on submit and
  `LayoutStore.#applyPatches`/`#demoteIfNowShort` never see a patch in production.
  `layoutClient.ts:1-26` ("a page's layout resumes because this file threads the previous
  response's frontier") and `layoutStore.ts:115-124` still describe incremental paging.
  `layoutAppend`'s incremental contract stays covered by `lanes.test.ts`, so keep it.
Code-read. Fix: delete `stashRows.ts` and its two exports, and `segmentsInWindow`; drop the
`frontier` tracking from `createLayoutClient` (keep `reset()` as the stale marker) and rewrite the
two doc comments to the full-relayout model.

### Block 3: graph and review session state

**F6 (medium): `ReviewCommentsState.pending` latches true when the target changes mid-request.**
`GU/state/reviewComments.ts:91-110` (`remove`) and `:121-141` (`clear`) clear `pending` only
when `this.#target === target` still holds; `setTarget` (`:50-57`) never resets it. Scenario:
user clicks Remove on a comment; before the reply, the session retargets (base override, stale
banner acknowledged, branch switch, `review.target` push). The reply lands, the guard fails,
`pending` stays true; `ReviewCommentsPane.vue:95,148` disable Remove and Clear for the rest of the
view's life. Same defect G30 #6 fixed in `reviewFiles.ts:102-110`. Verified (probe: remove in
flight, `setTarget` to another branch, resolve: `pending` reads `true`).
Fix: `this.pending.value = false` in `setTarget`, mirroring `reviewFiles.ts:110`.

**F7 (medium): expanded branch groups re-collapse after every restart-at-zero re-walk.**
`GU/state/graphOrder.ts:86-96` prunes `#expandedKeys` to keys with at least one row in the plan
just built. After `graph.refresh` (manual or the auto-refresh every `refsChanged` schedules,
`graphView.ts:136-141`), the re-opened stream restarts at row 0 (`packedStream.ts:74-77` resets
the store), and the first `#rebuildLayout` runs with only the first chunk(s) loaded. A group whose
rows all sit past that point (an older branch) has no row in that plan, so its key is deleted;
when the rest of the rows land, the group is collapsed again. Scenario: user expands
`feature/old`, then commits on any branch or a fetch moves a ref; the auto-refresh re-collapses
`feature/old`. Verified (probe: expand `b`, rebuild on a 4-row partial store, rebuild on the full
store: plan length 13, not the expanded 15).
Fix: prune against the tip list, not the loaded rows: keep a key while some `#tips[i].key`
matches it (or it is the `other` key). That still drops dead branch names (the stated purpose)
without depending on how much history has streamed in.

**F8 (low): a deterministic corrupt chunk re-opens the stream forever.**
`GU/state/packedStream.ts:79-88` hands every `appendPacked` failure to `onCorrupted`;
`graphView.ts:521-527` and `review.ts:404-413` re-open from row 0 with no attempt limit. When the
server sends the same bad chunk every time (a `dictionaryBase` or row-offset bug, a malformed
packed buffer), the client loops: each pass re-walks history server-side and nests one more
`await` inside the previous stream's `onChunk`. A failure of the recovery stream itself rejects
into the old stream's queue, which is already `done`, so `rpc.ts:224-226` drops it: no error ever
reaches the user. Verified (probe: transport that always emits a chunk with a wrong
`dictionaryBase`, delivered by macrotask: 38 re-opens in 50 ms, unbounded; delivered by microtask
it starves the event loop).
Fix: count consecutive corruptions per open in `PackedStreamState` (reset on a successful
`applyChunk`); after one retry, stop re-opening and surface an error state (`GraphViewState`
announcement / `ReviewSessionState.phase = 'error'` with the assert message). Run the re-open
outside the old `onChunk` (`queueMicrotask`/`void`) so its failure is not swallowed.

**F9 (low): a second review mark while one is in flight is dropped silently.**
`GU/state/reviewFiles.ts:250-253` returns at once while `pending` is true. `FileTree.vue:622,750`
(Part 19) checkboxes are not disabled on `pending`, and the window spans the mark request plus
the `#loadDiff` re-fetch (`:268`). Scenario: tick file A, then tick file B within that window; B's
`mark` returns with no request, no `markError`, no announcement; B's checkbox snaps back. The
`pending` comment (`:67-69`) assumes only the two header buttons call `mark`. Code-read.
Fix: queue marks instead of dropping them (chain each `mark` onto the previous one's promise,
dropping only an identical same-path/same-state duplicate), keeping `pending` true until the queue
drains; or disable the tree checkboxes on `pending` (`needs-other-part-file:
packages/git-ui/src/components/FileTree.vue (Part 19)`).

### Block 4: search

**F10 (low): `matchCount` reports an exact count in two incomplete cases.**
`GU/state/search.ts:285-307`:
- Loaded cap: `n` adds `loaded.hits.length` (capped at `LOADED_HIT_LIMIT` 500, `:20`), and
  `loadedExact` checks only `loaded.complete` (`:297`), not `loaded.truncated`. Scenario: 3,000
  loaded commits match `fix`, tail skipped (small exhausted repo) or not yet back: `SearchBox.vue`
  shows "1 of 500" with no `+`. The `LOADED_HIT_LIMIT` doc ("`matchCount` stays exact regardless
  (`LoadedScanResult.total` keeps counting past it)") describes code that does not exist.
- Tail failure: `#runTail` swallows every non-cancel rejection (`:486-491`) and leaves `tail`
  `undefined`, which `tailExact` (`:302-305`) counts as exact. Scenario: `search.run` fails
  (`E_GIT_UNAVAILABLE`, repo released, socket drop): results show only loaded hits, count exact, no
  notice that the unloaded history was never searched.
Code-read. Fix: `loadedExact = loaded === undefined || (loaded.complete && !loaded.truncated)`;
record a tail failure (e.g. `tailError: ShallowRef<string | undefined>`, cleared on the next run)
and treat it as inexact; surface it through `searchResultsModel.ts`'s existing `tailNotice`
(`needs-other-part-file: packages/git-ui/src/components/searchResultsModel.ts (Part 19)`, Stream
B, editable). Fix the `LOADED_HIT_LIMIT` comment.

**F11 (low): Go answers `invalidPattern` for patterns JS accepts; the client then claims an exact
count.** RE2 caps repeat counts at 1000; JS does not. Verified: `Compile({Text: "a{1001}", Regex:
true})` returns `ErrInvalidPattern` ("invalid repeat count"), while `new RegExp('a{1001}','i')`
compiles. `gitrpc/search.go:79-80` maps it to `{kind: "invalidPattern"}`; `search.ts:302-305`
counts `invalidPattern` as exact because "the client never sends a request for" one, and
`searchResultsModel.ts:148` shows a notice only for `unsupportedPattern`. Result: the unloaded
history is silently unsearched under an exact count. `gitsearch/query.go:33-37` calls this path
unreachable from the webview. Fix: in `gitsearch.Compile`, return `ErrUnsupportedPattern` (wrapped
with RE2's message) for a `regexp.Compile` failure after a clean translation, since the client
already proved the pattern valid JS; keep `ErrInvalidPattern` only for non-client callers if
needed, and correct the comment. Add a corpus row (`a{1001}`, `supported: false`).
`needs-other-part-file: apps/kira-space/internal/gitsearch/query.go (Part 15)` (Stream B,
editable).

**F12 (low, DESIGN-DECISION): residual JS non-`u` vs RE2 dialect gaps in regex mode.** Verified
with a throwaway Go test against `Compile`/`matchText` and `bun` against `new RegExp`:
- Case folding: regex mode prepends `(?i)` (`query.go:84-86`), which folds Unicode orbits. JS
  non-`u` `i` canonicalizes by `toUpperCase` and refuses a non-ASCII to ASCII mapping. `k` vs
  KELVIN SIGN U+212A: Go true, JS false; `s` vs LONG S U+017F: Go true, JS false; `[a-z]x` vs
  `U+212Ax`: Go true, JS false (also expected: `å` vs ANGSTROM SIGN U+212B, `ß` vs U+1E9E).
  Literal mode already matches JS (`literal.go` `foldRune`).
- Astral characters: JS non-`u` sees UTF-16 units, Go sees runes. `^.$` on an emoji: Go true, JS
  false; `^..$`: Go false, JS true. RE2 cannot express half a surrogate pair, so this one cannot
  be closed in the translator.
Effect: a hit counted by the git tail but not by the loaded scan (or the reverse) for these rare
inputs. Decision needed: emulate JS canonicalization in the translator (expand literal runes and
class ranges into explicit JS-equivalence classes and drop `(?i)`), or accept and document the
gap (the corpus would then need a per-engine expectation, which its schema lacks today).

### Block 5: ops and side state

**F13 (high): the `kiraSpace.checkout.autoStash` setting is never honored; checkout always
auto-stashes.** `OpsState` reads the setting only through its optional `#repoSettings`
(`GU/state/ops.ts:293,310,464-466`, `?? true`). The only production construction,
`App.vue:163` (`new OpsState(bridge, refsState, stackState)`), passes no `RepoSettingsState`
(`git grep 'new OpsState('`: one non-test hit). So `#resolveAutoCheckoutRoute` always sees `true`.
Scenario: user turns the setting off (its description, `GC/settings/schema.ts:171-180`: "Off
restores the old dialog"), then switches branch with a dirty tree: the client still re-issues the
checkout with `autoStash: true` and stashes the changes without asking. The user's explicit
opt-out of an automatic repository write is ignored. The comment at `ops.ts:289-292` calls the
`true` fallback "the fail-safe direction ... never an unexpected write", which is the reverse of
what `true` does. `ops.test.ts` passes a `RepoSettingsState` explicitly, so tests stay green.
Code-read (construction site and fallback are both unambiguous).
Fix: make `repoSettings` a required constructor parameter (drop `| undefined` and the `?? true`
fallback to the schema default read from the live snapshot), and pass `repoSettingsState` at
`App.vue:163`, constructing `RepoSettingsState` first (`needs-other-part-file:
packages/git-ui/src/App.vue (Part 19)`, Stream B, editable). Fix the `:289-292` comment.

**F14 (medium): an `OpsState` request that throws is never announced, and every caller drops the
rejection.** Each op announces only `OpResult`/`RemoteOpResult` failures. A rejected request
(preflight or `op.run`/`remote.run`/`undo.run`: `E_GIT_UNAVAILABLE`, `E_BAD_REQUEST` after a
reconnect race, socket drop) propagates out of `runCheckout`/`runRevert`/`runReset`/
`runCherryPick`/`#runStashPopLike`/`#runSimple`/`#runRemote`/`runPull`/`runPush`/`runForcePush`/
`undo` with `busy` cleared but `announcement` untouched; `#runSimple` also throws "another operation
is already running" (`ops.ts:1801`). Part 19 callers do not catch: `App.vue:1132-1214` call
`void opsState.runRevert(...)`, `continueOp`, `abortOp`, `skipOp`, `undo`, `runReset`,
`runCherryPick`, `runCheckout` bare; `AppToolbar.vue:184-204`, `BranchPicker.vue`, `TagList.vue`,
`StashList.vue`, `ConflictBanner.vue` `await` them in click handlers; `main.ts` sets no
`errorHandler` (`App.vue:304-309` says so). Result: the click does nothing visible; the error is an
unhandled rejection. Two stash routes make it worse:
- `#stashAndCarry` (`ops.ts:1346`): if `runMiddle` (checkout/pull) throws after the stash push
  succeeded, the user's changes are now in the stash with no announcement at all; the
  `!middle.ok` branch (`:1356-1358`) tells the user "Your changes are stashed", the throw path
  does not.
- `runReset` with `stashFirst` (`ops.ts:770-801`): if the reset itself fails (`!result.ok`), the
  announcement is only "Reset failed — ..."; the tree is now clean and the changes sit in a
  stash nobody mentioned.
Code-read. Fix: one `try/catch` per public op (or in a shared wrapper around each method body)
that sets `announcement` to `${action} failed — ${message}` for a non-cancel rejection and does
not rethrow (callers already treat these as fire-and-forget); in `#stashAndCarry` catch the
`runMiddle` throw and append the "Your changes are stashed" sentence; in `runReset` append the
same sentence when `route.stashFirst` ran and the reset failed. Make `#runSimple`'s busy case an
announcement instead of a throw.

**F15 (medium): op failure text drops the server's message, including a push hook's own
explanation.** `composeOpFailureAnnouncement` (`GU/state/liveAnnouncements.ts:205-211`) maps
`error.kind` to fixed text and discards `error.message`; `RemoteOpResult.error.remoteMessage`
(`IPC/contract.ts:882-887`, "the hook's own remote:-prefixed output") is read nowhere in `GU`
(`git grep remoteMessage packages/git-ui/src`: no hit). Scenario: a pre-receive hook rejects a
push with "commit message must reference a ticket"; the user hears/sees only "Push failed — a
hook rejected it." `Unknown` likewise reduces every unclassified git failure to "an unexpected
error occurred", with the only diagnostic dropped. Code-read.
Fix: append `remoteMessage` for `HookRejected` and `message` for `Unknown` (trimmed, first line or
a length cap) in `composeOpFailureAnnouncement`, taking the error shape as
`{kind, message, remoteMessage?}`; `#runRemote` passes `result.error` through unchanged.

**F16 (low): a repeated identical announcement is not re-announced.** `OpsState.announcement`,
`DetailState.announcement`, `GraphViewState.announcement` are plain `shallowRef<string>`;
assigning the same text again does not trigger, so `App.vue:545-551` never forwards it, and the
`role="status"` region keeps unchanged text. Scenario: Fetch fails with "Fetch failed — a network
error occurred.", user retries, it fails the same way: the screen reader hears nothing the second
time. Same for "Checkout cancelled." twice. Code-read.
Fix: announce through a helper that sets the text and calls `triggerRef` (or carry a sequence
number), and in `App.vue` clear `liveAnnouncement` before setting it on the next tick so the DOM
text actually changes (`needs-other-part-file: packages/git-ui/src/App.vue (Part 19)`, Stream B,
editable).

### Block 6: `git-core` models, preflight, settings, util, ports

**F17 (low): `git-core` exports logic that only its own tests reach.** `git grep -w` over
`packages` and `apps`, excluding `packages/git-core` and test files, finds no consumer for:
- `resolveBase` (`GC/model/review.ts:104-166`, 63 lines; test `review.test.ts`): base resolution
  runs in Go (`apps/kira-space/internal/gitreview/resolve.go`); the vscode `reviewMarking.ts`
  `resolveBase` is an unrelated local function that calls `review.resolveBase` over the wire.
- `util/nulSplit.ts` (`splitRecords`, `splitLimitedFields`, `RemainderOverflowError`, 124 lines;
  test 93): the git parsing it served moved to Go.
- `toVsCodeConfiguration` (`GC/settings/schema.ts:313-340`): its doc names
  `scripts/gen-settings.ts`, which does not exist; every `SETTINGS` entry now carries a `source`,
  so it returns `{}` (verified by running it) and the extension's `package.json` contributes no
  configuration.
- `subtractRanges`, `unionRanges` (`GC/model/reviewRanges.ts`), `splitTrailerBlock`
  (`GC/model/diff.ts`), `packedTransferList` (`GC/store/commitStore.ts:126`), `assertNever`
  (`GC/util/assert.ts:25`): exported, used by tests only or not at all.
Together with F5's graph-side items this is dead weight the next reader must keep consistent with
Go by hand (e.g. `resolveBase` vs `gitreview/resolve.go`). Code-read. Fix: delete each item, its
`GC/index.ts` export and the tests that only exercise it (keep a helper that another live export
calls internally, e.g. `normalizeRanges`); drop the `gen-settings.ts` references.

Nothing else real in this block. Checked: `classifyInProgress` (`operation.ts:104-215`, consumed by
`ConflictBanner.vue` types and mirrored in Go `gitpreflight/operation.go`) handles `git am` (F3),
merge, cherry-pick, revert, a bare sequencer, bisect and unmerged-only in a coherent precedence;
`dateFormat.ts` clamps future timestamps to `now` and formats absolute dates in UTC by documented
design; `coerceSettings` reports unknown keys and type failures without throwing;
`findChangeInDetail` returns `undefined` (not a throw) on a miss with an out-of-range
`parentIndex` mapping to `null`; `testing/packedChunk.ts` has no production importer (only
`apps/kira-space/tsconfig.tests.json` and test files).

### Block 7: tests and conventions

**F18 (low): stale comments.** Each describes code or layout that has changed:
- `GU/state/graphView.ts:161-162` ("matching W2's own supersede-on-reopen rule for the transport
  underneath") and `:522-523` ("W2's supersede-on-reopen rule"): Part 17 `c83845d` removed the
  per-method supersede; the instance's own `#abortController` is what supersedes.
- `GC/search/conformance.test.ts:10`, `GC/search/differentialRunner.ts:3`,
  `GC/search/matcher.ts:8`, `packages/git-core/testdata/searchConformance.json:2` (`_comment`):
  name `apps/kira-studio/internal/gitsearch`; the package is `apps/kira-space/internal/gitsearch`.
- `GC/model/operation.ts:119-121`: "Part 17's own boundary, not yet reviewed"; Part 17 is reviewed
  and closed.
- `GC/model/reviewRanges.ts:3`: "Imports only types from `@kira/git-ipc`"; it imports only
  `./diff.ts` and `./review.ts` (B3 forbids the wire package here).
(F5, F10, F13 and F17 each fix their own stale comment.) Code-read. Fix: reword each to the
current fact or delete it.

Tests against the `CLAUDE.md` bar. Qualifying specs still drive current code (`lanes.test`,
`rowPlan.test`, `layoutStore.test`, `reviewRanges.test`, `buildCommitHits.test`, `stack.test`,
`pr.test`, `ops.test`, `refs.test`/`repo.test` reply-ordering races, `reviewFiles.test`
supersede). `tag.test.ts` (restates two one-line functions) and most of `working.test.ts`
(CRUD-shaped select/refresh) sit below the bar; `CLAUDE.md` makes the bar forward-only, so they are
not reported. Guards a fix should add: F7 (prune-on-partial-store sequence, `graphView.test.ts` or
a `graphOrder` case), F8 (bounded retry, `graphView.test.ts` has the scriptable transport), F1
(plan/layout identity, pure `readSlice` check); F11 adds a corpus row, not a test file. F6, F13,
F16 are single-condition fixes: no test.

Conventions: no `.vue` file is owned. `GU` state uses plain classes, not Pinia/TanStack Query
(P99 scoped `packages/git-ui` out); F6, F9 and F10's tail-error case are hand-rolled
request-lifecycle defects of the kind TanStack Query would own, but each has a local fix, so no
library migration is proposed here. No finding needs a Stream A or Stream C file, so nothing goes
to `P168-routed-from-streamB.md`; every `needs-other-part-file` tag names a Stream B file
(Part 15 or Part 19).

## Candidate fates (plan §9)

1. Dropped. Webview-side cancel is local: the webview's own `createRpcClient` rejects with a
   local `TransportError('cancelled')` and posts `cancel`; `createRpcServer`'s `cancel` handler
   deletes `activeWork` first, so no `res` is ever posted (`IPC/rpc.ts:403-405,466-472`). The
   extension never aborts an upstream call except on webview cancel or server dispose (webview
   gone). A forwarded `transport-closed` (extension socket drop mid-request) arrives as
   `RpcError`; announcing it is correct, since the view is alive and the request failed. The
   `transport-closed` skip in `App.vue:312`/`ReviewView.vue:126` exists only for the view's own
   dispose, which is still a local `TransportError`. Code-read.
2. Dropped as its own finding. No path needs to branch on an `E_*` code: reconnect re-opens via
   `onReconnect`; `E_FRAME_TOO_LARGE` is parked (§6.7). Raw-message exits are covered by the
   OpsState error-exit finding (block 5).
3. Reported in F18.
4. Folded into F8. The re-open itself is safe: `openStream` aborts the old controller, and
   `createRpcClient`'s abort listener marks the old entry `done` and RESOLVES (`rpc.ts:323-333`),
   so the old credit gate blocks nothing. (Plan §6.3's premise that a superseded `openStream`
   awaiter gets `TransportError('cancelled')` does not hold: abort resolves; no caller sees a
   cancel.) Only the swallowed recovery error is real, reported in F8.
5. Dropped. `undo()` routes through `#applyResult` (`ops.ts:1497`), whose first line is the repo
   guard (`:1828`). Only the announcement is unguarded, same as every other op; not worth a finding.
6. Confirmed and widened into F14: the preflight rejection propagates (busy is not yet set, so it
   cannot stick), but no caller catches it and nothing is announced. During `runPull`'s blocker
   dialog `busy` is deliberately unset (`ops.ts:1582-1592`), so no stuck state either.
7. Dropped. Every class that subscribes (`bridge.on`, `watch`, timers) has `dispose()`, and
   `App.vue:1695-1714` / `ReviewView.vue:176-179,483-488` call each of them. `DetailState`
   (`App.vue:147`) is not disposed but holds only an abortable request; `SelectionState` and
   `GraphOrderState` hold no subscription.
8. Reported as F1.
9. Confirmed as dead code, reported inside F5. The O(rows) relayout per rebuild is the P93 §5.1
   design (rows scatter into groups), bounded in count by F11 coalescing; not re-reported.
10. Reported as F2 (probe numbers there).
11. Reported as F3.
12. Reported as F8 (verified).
13. Reported as F12 (DESIGN-DECISION) plus F11 (repeat-count cap). `\w`, `\b`, `\d` agree (ASCII in
    both); `.` vs line terminators is already rewritten (`dialect.go:147-150`) and pinned by a corpus row.
14. Reported in F18.
15. Dropped, verified. A throwaway type probe in `GU` asserted mutual assignability of all 48 type
    names exported by both `@kira/git-core` and `@kira/git-ipc/contract.ts` (incl. `OpRequest`,
    `OpResult`, `OpErrorKind`, `RemoteOpResult`, `InProgressOperation`, `HostKind`, `LineRange`,
    `PackedCommitChunk`, every preflight type); `vue-tsc` passed them all (a sentinel mismatch line
    failed as expected, proving the file was checked). No drift today. A committed one-line-per-type
    `satisfies` guard would be cheap but is a convention choice, not a defect; not reported.
16. Reported as F9.
17. Dropped. Both stores persist JSON (VS Code `getState`, Space `viewStateStore.ts`), which cannot
    carry `NaN`/`Infinity` (they serialize to `null` and fail the `typeof` gate). `loadedRows` is
    never read on restore (`App.vue:1320-1329` reads `columnWidths`, `detailWidth`, `scrollRow`);
    rehydration replays the host cache instead. `scrollRow` bounds belong to `CommitGrid.vue`
    (Part 19).
19. Reported in F18 (both comments confirmed stale).
18. Dropped. Lanes past 12 clamp to the twelfth column by documented design (`rowSvg.ts:76-83`,
    `hitTest.ts:18-30`); `graphColumnWidth` and `laneAt` agree on the clamp.

## Summary

18 findings: 1 high (F13), 5 medium (F1, F6, F7, F14, F15), 12 low (F2, F3, F4, F5, F8, F9,
F10, F11, F12, F16, F17, F18). F12 is DESIGN-DECISION.

## Coverage (126 owned files)

- Block 1, reviewed: `GU/bridge/client.ts`, `GU/state/{latestRequest,repoScopedReload,pendingSlot,
  bootstrap}.ts`; every `TransportError` check in `GU` (own and Part 19, read); `IPC/rpc.ts`
  client/server (read); Space `transport.ts` stream wrapper (read).
- Block 2, reviewed: `GC/graph/{rowPlan,edges,layout,stashRows,colors,types}.ts`,
  `GC/store/{commitStore,shaTable}.ts`, `GC/testing/packedChunk.ts`,
  `GU/graph/{layoutClient,layout.worker,layoutStore,graphColumn,rowSvg,geometry,hitTest}.ts`,
  `GU/graphVisibility.ts`. Skimmed: `GC/graph/lanes.ts` and `GC/store/intern.ts` (algorithm and
  interner covered by `lanes.test`/`intern.test`; read for the frontier/patch contract only),
  `GU/graph/palette.ts` (class-name table).
- Block 3, reviewed: `GU/state/{graphView,packedStream,graphOrder,selection,review,reviewFiles,
  reviewComments,viewState}.ts`, `GC/model/review.ts`. Skimmed: `GC/model/reviewRanges.ts`
  (296-line spec drives it; checked imports and exports).
- Block 4, reviewed: `GC/search/{query,matcher,differentialRunner,conformance.test}.ts`,
  `testdata/searchConformance.json` (comment and coverage), `GU/state/search.ts`; Go
  `gitsearch/{query,dialect,literal}.go` (read, plus a throwaway probe).
- Block 5, reviewed: `GU/state/{ops,refs,stack,stash,worktrees,pr,repoSettings,repo,settings,
  detail,detailActions,working,fileListCursor,clipboardActions}.ts`,
  `GU/state/liveAnnouncements.ts` (failure text, stash and op sentences; other compose helpers
  skimmed as string builders).
- Block 6, reviewed: `GC/model/{operation,remote,stash,ref,commit,conflict,repo,tag}.ts` (types
  checked by the assignability probe), `GC/settings/schema.ts`, `GC/util/{dateFormat,assert,
  nfcPath,typed}.ts`, `GC/detail/find.ts`, `GC/worktree/label.ts`, `GC/index.ts`, `GU/index.ts`.
  Skimmed: `GC/model/{status,diff}.ts` (parsers no longer on a production path except
  `mapLineAcrossDiff`, which `diff.test` drives), `GC/util/nulSplit.ts` (dead, F17),
  `GC/preflight/{reset,tag,types}.ts` (decision tables pinned by `reset.test`/`tag.test`; Go
  `gitpreflight` owns the live preflight), `GC/ports/*` (interfaces only),
  `GU/shims-vue.d.ts`, `GC/../package.json`, `GC/../tsconfig.json`.
- Block 7: all 33 spec files read for what they guard (names and assertions); judged above.
- Not reached: none. Parked items (plan §6.7): `DetailState` and `RefsState` would need a
  `truncated` path; `SearchState`'s ref arm reads `RefsState`. Today an `E_FRAME_TOO_LARGE` on
  `commit.detail` lands in `DetailState.error` as the raw message; on `refs.list` it is logged by
  `fireAndForget` and the lists stay empty with nothing shown (same silent-reload shape as the
  other `RepoScopedReload` classes).
