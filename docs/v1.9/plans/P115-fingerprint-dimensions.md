# P115 — Third duplication pass: fingerprint dimensions beyond call-sequence LCS

Opus planning pass. Findings and plan only; nothing here is implemented. Base: `a45a1e7`, the
chapter head on `claude/unimplemented-items-xjrz4c`. Sites are `file:line` against that commit.

P113 is being implemented concurrently in its own worktrees. None of its fixes are on this branch
yet. This pass read only the committed tree, never those worktrees. Where a site overlaps a P113
finding, this doc cites the G- or F-number instead of re-describing it. The implementer re-reads
each site after P113 lands, because line numbers will drift.

Path shorthands: `A/` = `apps/kira-studio/internal/adapters/`, `KS/` = `apps/kira-space/`,
`ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KF/` = `apps/kira-space/frontend/src/`, `GU/` = `packages/git-ui/src/`,
`SD/` = `packages/shared/domain/`.

## §0 Goal, method, acceptance

**Goal.** Test whether fingerprint dimensions other than callee-sequence LCS find real duplication
that P107/P113's S1–S4 cannot see. Fix every real finding in a later implementation pass.

**Method.** Each scan is a custom script over CodeGraph's SQLite index (`.codegraph/codegraph.db`:
`nodes`, `calls` edges, `unresolved_refs`), matching P113's precedent. The index has no struct-field
nodes and no per-node AST features. Each script therefore joins graph nodes by (file, start line) to
features extracted from the node's own source span: a Go `go/ast` pass and a TS/Vue
TypeScript-compiler pass. Scan units are graph nodes (function, method, component, struct,
interface, type alias). Anonymous TS callbacks are not graph nodes, so no dimension sees them. This
limitation is the same one S1–S4 have.

Shared filters: non-generated files, non-test files. Single-symbol questions during triage went
through `codegraph_explore`.

**"Invisible to P113".** A pair counts as new only if it fails P113's widened S3 test, reproduced
exactly:
- LCS/max ≥0.6.
- ≥4 callees, resolved plus unresolved (tail names).
- Both nodes ≥4 lines.

Each pair was also checked against:
- P113 §3's "Assessed and not findings".
- P113 §4's 9 holds.
- G1–G14 and F1–F10.

A pair already covered by any of these is not re-reported.

**Triage filter.** Identifier-blind line similarity: identifiers other than keywords and strings
are collapsed to one token each, then lines are compared. Thresholds are given per dimension.

**Acceptance (for the later fix pass).**

1. Every finding in §1 lands as its own `refactor:`/`fix:` commit (H4 is `fix:`). Fast checks
   (build, typecheck, lint) pass per commit.
2. Error text and behavior stay byte-identical except where a finding says otherwise. No bound
   Wails method signature changes.
3. The §4 closing run is green.
4. The fix pass runs only after P113 has landed on the chapter branch (§3 explains why).

## §1 Findings

### Dimension results

Numbers are raw hits, then hits invisible to P113's S3, then the hand-triaged real findings.

**D1: type/interface-signature grouping.**
- Method: bucket functions by their sorted, normalized parameter and result types. Require ≥2
  types, ≥5 lines, and a bucket of ≤60 units. Then compare bodies by token similarity within each
  bucket.
- Go: 2,823 units, 238 buckets, 5,102 pairs.
  - 1,589 pairs have body similarity ≥0.6; 1,442 of them are invisible to P113.
  - At ≥0.75: 735 pairs, 610 invisible.
- TS: 2,546 units, 162 buckets, 3,475 pairs.
  - 324 pairs have body similarity ≥0.6; 295 of them are invisible.
  - At ≥0.75: 123 pairs, 97 invisible.
- Triage narrowing: blind ≥0.7 and ≥6 lines leaves 284 pairs. ≥8 lines leaves 158. Of those 158,
  86 are gitrpc handlers, already on `handleRepoCall` (P113 §3).
- **Real: 2** (H9's `rowMenuModel` and Crockford items).
- Declined (by reason):
  - Thin delegates over a shared helper: `openXTab` ×4 over `openTrackedTab`; `keywordsFor`/`typesFor`.
  - Declarative switches: `ValidPullStrategy`/`ValidLaunchKind`/`ValidLogLevel`.
  - Pairs where the per-adapter call is the content: adapter `Count`/`Read`/`Children`, mongo
    `insertOne`/`insertMany` and `applyUpdate`/`applyDelete`.
  - Pairs where the other difference is the content: `menus.ts` `consoleMenuItem`/`browseMenuItem`,
    stash `List`/`GlobalList`, gitvsix/mcpinstall `New`, panelView/reviewView bootstrap, transport
    stream, gitpreflight `UnmergedPaths`/`StagedNewPaths`.
  - Already declined by P113: `ChooseFolder`, grpcclient reflect, #8, page `search.ts`.
  - Already a P113 finding: G1/G2 (`Disconnect`), G4/G5 (layout), G13 (opslot claim), G14
    (`tableNode`), F1 (`toPageRowSelection`), F4 (documents/grid load), F8 (`setRepoId`).

**D2: control-flow shape.**
- Method: a token sequence of branch/loop/switch/case/defer/go/return/try/throw, each carrying its
  nesting depth, compared by LCS.
- Pure `if err != nil { return }` chains are dropped as Go's error idiom.
- At ≥10 control-flow tokens and ratio 0.85:
  - Go: 425 units, 94 pairs (19 exact), 11 already seen by P113.
  - TS: 415 units, 104 pairs (16 exact), 4 already seen.
  - 183 pairs are invisible.
- At ≥8 tokens and ratio 0.8:
  - Go: 625 units, 588 pairs. TS: 623 units, 723 pairs.
  - 1,268 pairs are invisible. Of those, 96 have blind ≥0.5 and 73 have blind ≥0.6.
- Noise: unrelated switch/case tables dominate, with blind similarity near 0.
- **Real: 1** (H9's JSON/shell scanner residue).
- Declined (by reason):
  - Declarative: encode/decode type switches, worktree/restack blocked-error tables.
  - Already on a shared helper: `reviewComments` `#load` and `reviewFiles` `#loadFiles` use `runLatest`.
  - Differences are the content: `anchorLabel`/`anchorTitle` wording per host; redis/s3
    `renderOpText`; httpclient `buildBody`/`renderRequestBody`.
  - Too small: `reviewComments` remove/clear, 2 instances.
  - Already declined or cross-referenced: `blockerText` (P107 decline #9); git-ui state reloads (F8).
- HTTP `send` vs gRPC `call` was checked separately. Only HTTP has the `findHttpRequestTab` guard
  (P108 F8). This is not a bug: the shared `createHistoryStore` `noteRecorded` already guards on
  `findTab` (`SF/api/state/history.ts:158-165`, traced with `codegraph_explore`).

**D3: literal/format-string.**
- Method: string literals with identifiers kept out of the fingerprint and format verbs normalized.
  Wording families are clustered by word-bigram Jaccard ≥0.6.
- Pass (a), families: 2,050 message-literal occurrences, 1,781 distinct templates, 563 merge edges.
  This gives 22 drifted families and 6 exact repeats spanning ≥3 files.
- Pass (b), function pairs sharing ≥3 rare literals (Jaccard ≥0.5): 75 pairs, 63 invisible to P113.
- Calibration: the scan re-found G2's "requires a database/…/table path" family, including its
  `schemaColumns` variant (8 files, 8 variants). This confirms it reaches the class of thing G2
  found by hand.
- **Real: 8** (H1, H2, H3's sort half, H4, H6, H10, and H9's `copyNameItems` and `repoIdOfTab`
  items).
- Declined (by reason):
  - A helper is not shorter: porcelain `"record has %d fields"` ×12; the "git is unavailable"
    guard ×7 (3 in gitrpc, 4 in codeworkspace; 4 lines stay 4 lines).
  - Log/timeout message wording only: "dropping X row" slog calls; "did not respond within" messages.
  - Kept by P113: "id and name are required" `BadRequest` guards.
  - Already a P113 finding or decline: "full table scan" wording (G14/F10); per-table SQL (#5);
    Go/TS `validateRefName`/`ClassifyReset` mirrors (#12).
  - Declarative: porcelain diff argv lists.
  - Differences are the content: `goToFile` vscode vs `hostHandlers` (the per-host reveal);
    `generateRawRequest` vs `FromStored` (input shapes differ); gitstream
    `allowedRequest`/`allowedStream` (signatures differ); `onPreconnectExit` vs `exitDetail`.
  - Deliberate: the dbmcp plan-issue double cap is documented defense in depth
    (`ST/internal/bridge/dbmcp.go:341`).

**D4: struct/type field shape.**
- Method: order-normalized field name+type sets, ≥3 fields. Exact groups plus near pairs at
  field-set Jaccard ≥0.8, ≥4 fields.
- Go: 668 types, 21 exact groups (48 members), 14 near pairs.
- TS: 502 types, 32 exact groups (66 members), 10 near pairs.
- None of these are visible to S1–S4, which compare bodies only.
- **Real: 6** (H3's `readReq` half, H5, H7, H8, and H9's `ServerAppInitResult` and
  `SettingsPaneProps` items).
- Declined (by reason):
  - P113 decline B3: git-core model vs git-ipc `contract.ts` same-name pairs (~20 groups).
  - Already declined by P113: `RepoSettingsSnapshot`/`Patch` wire vs model.
  - Bound types, decline #3 reasoning: `SavedGrpcMetaRow`, which is a third member beside G13's
    `SavedField`/`SavedHeader` (cross-reference G13); `TerminalResizeArgs`.
  - Already a Go conversion: `SecretStorageStatus`. It is H7's precedent.
  - Distinct packages, distinct meaning: ghclient/gitclient `Result`; catfile/gitsearch `Deps`;
    `ChosenFile`/`SavedFile`; `TreeChildrenArgs`/dbmcp args; `SearchQueryParams`/`Query`.
  - Test fixtures.
  - Documented mutable builder: `LNode`/`MNode`.
  - Structural typing, no converter code: `ConsoleDiagnostic` vs `LintIssue`.
  - Already a P113 finding: `LoadFrameRuntime`/`OpPreambleRuntime` (F4).
  - Small; decline unless revisited: `Match` ×2, `CellView` ×2, `StreamFilterInput` ×2,
    `HighlightRange`.

**D5: import-set pre-filter.** See §2. No real finding.

### H1 sslmode vocabulary switch ×6 (D3)

Each of the six TLS-capable adapters does the same things:
- Re-reads `Options["sslmode"]`.
- Applies the same empty/`disable` check.
- Switches over the mode vocabulary.
- Ends with the fail-loud `<engine>: unknown sslmode "x"` error.

Sites:
- `A/postgres/client.go:91-119`
- `A/mysqlfamily/client.go:144-179` (`applyTLS`)
- `A/redis/client.go:83-103`
- `A/mongo/client.go:48-49,81-93` (`tlsConfigForSslmode`)
- `A/kafka/client.go:36-52` (`resolveTLSOpt`)
- `A/clickhouse/client.go:98-119` (`resolveScheme`)

`docs/ARCHITECTURE.md:418-455` explicitly defers "unifying the six independent switches into one
shared helper (left for a later round)". Kafka and ClickHouse have each drifted from the others
before.

Shape:
- Add `adapters.ParseSSLMode(options map[string]any, engine string, accepted ...string) (mode
  string, enabled bool, err error)`.
- Keep error text byte-identical through the existing engine prefixes: `postgres`, `mysql-family`,
  `redis`, `mongodb`, `kafka`, `clickhouse`.
- Add one policy helper for the verify-everything group (redis, mongo, kafka), where `verify-none`
  and `insecure` skip verification.
- Each adapter keeps its own `tls.Config` construction: the mysql TLS registry, pg `verify-ca`, the
  ClickHouse scheme choice, and redis's `rediss://` implying TLS.
- Semantics stay exactly as they are. ClickHouse rejects `verify-none`/`insecure` today. Raise that
  as a question to the user, not as a change here.
- Update ARCHITECTURE.md's "left for a later round" sentence in the same commit.

Overlap: G1/G2 edit other functions in some of these adapters. No `client.go` function above is a
G-site.

### H2 `adapters.UnexpectedPathKind` bypassed (D3)

The helper already exists at `A/tree.go:18-27` (P107 I2-11), but only relational adapters call it.
Byte-identical depth-0 `Children` messages are still hand-written at five sites:
- `A/redis/adapter.go:144`
- `A/kafka/adapter.go:150-151`
- `A/mongo/adapter.go:203-204`
- `A/clickhouse/adapter.go:169`
- `A/s3/adapter.go:126`

Replace each with `adapters.UnexpectedPathKind(0, kind)`.

Two variable-depth sites, `A/redis/adapter.go:156` and `A/s3/adapter.go:138`, return "unexpected
path segment kind: " without a depth. The helper would add "at depth N" to that text. G2 keeps
variable-depth shapes hand-written. The implementer decides, after grepping tests. No test or TS
file pins either string at `a45a1e7`.

`Mutate` root guards say the same thing without the kind, which is the drifted variant:
- `A/postgres/adapter.go:404-405`
- `A/mysqlfamily/adapter.go:391`
- `A/mongo/adapter.go:339-340`
- `A/redis/adapter.go:253-254`

These overlap G1 (pg/mysql `Mutate` dispatch) and G2 (`RequirePath`). Fold them in on top of
G1/G2 as landed; do not re-do those findings.

### H3 ClickHouse/mongo adapter residue (D3 + D4)

- **Duplicate `readReq`.** `A/clickhouse/read.go:149-155` and `A/mongo/read.go:45-51` each declare
  a `readReq` field-identical to `adapters.ReadReq` (`A/sqltext.go:48-54`). postgres, sqlite and
  mysqlfamily already use `type readReq = adapters.ReadReq`; do the same in both.
  - Redis's own `readReq` (`A/redis/read.go:371`) is a documented two-field subset. It stays.
- **Duplicate sort validation.** `A/clickhouse/read.go:99-120` (`computeOrderBySql`) re-implements
  `adapters.validateRequestedTerms` (`A/sqltext.go:421-431`): same column-exists and direction
  checks, same codes, same text. Its own comment says "identical check".
  - Export the helper, taking a column-name set.
  - ClickHouse calls it. The other callers are unchanged.

### H4 git-ui detail-pane resize handle: third copy of `KuiColumnResizeHandle`, plus a latent bug (`fix:`) (D3)

`GU/App.vue:1670-1715` hand-rolls a resize handle: `startDetailResize`,
`handleDetailHandleKeydown` and `DETAIL_HANDLE_KEY_STEP = 16`, with the handle markup at ~1934-1946.
`packages/kira-ui/src/KuiColumnResizeHandle.vue` is P105 §5.2(a)'s extraction of the same handle
from CommitGrid and StreamView.

**Bug.** The Kui handle has P108 Part 11 F10's primary-button guard (`if (e.button !== 0)
return;`, line 46). App.vue lacks it, so right-clicking starts a detail-pane drag.

Shape:
- Add a `direction?: 'normal' | 'reverse'` prop to `KuiColumnResizeHandle`. `'reverse'` inverts
  both the pointer delta and the arrow keys, because the right-docked pane widens leftward.
- App.vue then uses `<KuiColumnResizeHandle>`: value, min, max, step 16, label "Resize detail pane".
- git-ui already imports `@kira/kira-ui` (CommitGrid), so no dependency change is needed.
- Check unmount mid-drag. App.vue calls `stopDetailResizeDrag` on unmount; the Kui handle relies on
  window-level `lostpointercapture`. Keep the unmount cleanup if the component does not cover it.

### H5 SQL lex options mirrored ×4 types, 3 projections, 5 per-dialect literals (D4)

There are three layers of copies.

**Mirrored types.** Four types in `SD/` hold the same option fields:
- `SqlLexOptions` (`sql-lex.ts:6-30`)
- `LintSqlOptions` (`sql-lint.ts:21-38`)
- `SplitSqlOptions` (`sql-split.ts:20-40`)
- `SqlTokenOptions` (`sql-tokens.ts:20-37`)

**Identical projection blocks.** Three functions copy those option fields into `SqlLexOptions` the
same way:
- `sql-split.ts:41-49`
- `sql-lint.ts:50-58`
- `sql-tokens.ts:323-331`

**Per-dialect literal.** The Studio frontend builds the same per-dialect options literal at 5 sites:
- `SF/workbench/panels/OperationsPanel.vue:165-172`
- `SF/views/console/sqlNodes.ts:128-138`
- `SF/views/console/format.ts:188-196`
- `SF/views/console/lint.ts:31-38`
- `SF/views/console/ConsoleView.vue` ~112

Each literal spreads the same six `SF/views/shared/sqlIdent.ts:60-110` lookups:
- `backslashEscapesFor`
- `dollarQuotingFor`
- `hashCommentsFor`
- `nestedBlockCommentsFor`
- `bracketIdentifiersFor`
- `postgresEscapeStringsFor`

Shape:
- In `sql-lex.ts`, add `export type SqlScanOptions = Partial<SqlLexOptions>` and
  `resolveLexOptions(o?)`, with the existing defaults (the first two default true).
- `LintSqlOptions`/`SplitSqlOptions` become aliases and keep their names.
- `SqlTokenOptions extends SqlLexOptions`.
- Add `lexOptionsFor(dialect)` to `sqlIdent.ts`.
- Callers spread `lexOptionsFor(dialect)`; the mongodb caller adds `slashSlashComments` on top.
- Mind `exactOptionalPropertyTypes`.

### H6 git-ui `DetailActions` built twice (D3)

- `GU/state/detailActions.ts:85-138` `createDetailActions`.
- `GU/state/review.ts:443-476` `#createRowActions` builds the same object.

Shape:
- Parametrize the announce step as `(text) => void`.
- `review.ts` calls the shared factory with `() => repoId`.
- Review never passes `fallbackSha`, which is stash-only, so sharing is safe.

Not in F8/F9's file lists.

### H7 field-identical Go structs copied field by field; use conversions (D4)

Go ignores struct tags in conversions (since Go 1.8). Field-identical structs therefore convert
directly. G13 and the existing `SecretStorageStatus` conversion (`ST/internal/bridge/connections.go:128-129`)
are the precedent.

Sites:
- `ST/internal/bridge/agenthooks.go:88-101` `toWireAgentEvent` becomes `AgentEventWire(ev)`. The
  separate wire type stays, as its doc requires.
- `terminal.OpenArgs{...}` literals become `terminal.OpenArgs(args)`, in both apps' bridge:
  - `KS/internal/bridge/terminal.go:84-87`
  - `ST/internal/bridge/terminal.go:143-146`
- Element copies become conversions:
  - `ST/internal/dbmcp/explain.go:40-41`
  - `ST/internal/bridge/dbmcp.go:375-376`

### H8 `HeadState` builder duplicated (D4)

- `KS/internal/gitsession/status.go:13-24` `headStateFromStatusBranch` mirrors
  `KS/internal/gitpreflight/status.go:46-58` `headStateFromBranch`.
- `gitpreflight.HeadState`'s doc (`status.go:5-7`) says it is kept convertible "with a plain Go type
  conversion at gitsession's own boundary".

Shape:
- Export `gitpreflight.HeadStateFromBranch`.
- The gitsession body becomes `return gitclient.HeadState(gitpreflight.HeadStateFromBranch(b))`.

Touches only `gitsession/status.go`, not G8's `preflight.go:585-640`.

### H9 Small TS items

- **`rowMenuModel` (D1).** `GU/components/rowMenuModel.ts:124-134` `buildReviewRowMenu` and
  `301-311` `buildReadOnlyRowMenu` are verbatim duplicates. Keep one; alias the other or repoint
  its callers. Callers: `ReviewCommitRow.vue:114`, `App.vue:722`, `rowMenuModel.test.ts`. S1 could
  have reached this pair, but it is not in P113's lists.
- **Crockford (D1).** `SF/views/shared/celleditor/generate.ts:10-32` `toCrockford` plus its
  `CROCKFORD` constant duplicate `SD/mask.ts:296-317` `crockfordBase32` plus
  `CROCKFORD_ALPHABET`.
  - For the 10-byte (80-bit) input, the trailing-pad branch never runs, so the output is identical.
  - Export the shared version. `encodeUlidTime` stays.
  - Keep the F22 comment's intent in `generate.ts`.
- **`copyNameItems` (D3).** `SF/project/menuItems.ts:92-113` is hand-copied at:
  - `SF/project/menus.ts:123-130`, `271-278` and `441-459`. `simpleObjectMenu` is exactly
    `copyNameItems(row, true)`.
  - `SF/views/browse/menu.ts:27-34`.
  Call `copyNameItems` at each site.
- **`repoIdOfTab` (D3).** The `props.tab.workspaceId ? repoIdOfWorkspace(props.tab.workspaceId as
  WorkspaceKey) : null` ternary repeats in four views:
  - `KF/views/repo/RepoGraphView.vue:52-54`
  - `RepoDiffView.vue:45-47`
  - `RepoFileView.vue:135-137`
  - `RepoMultiDiffView.vue:36-38`
  Add `repoIdOfTab(tab)` to `KF/state/workspace.ts`. The "This tab has no repository." message also
  repeats ×4; move it beside the helper.
- **`ServerAppInitResult` ×3 (D4).** It is declared at:
  - `apps/kira-space-vscode/src/extension.ts:68`
  - `apps/kira-space-vscode/src/proxyHandlers.ts:55`
  - `KF/repo/git/hostHandlers.ts:116`
  Export it once from `packages/git-ipc`.
- **`SettingsPaneProps` ×2 (D4).** It is identical in both apps' `workbench/settings/types.ts`,
  apart from the `SettingsSections` `Pick`. Make it a generic `SettingsPaneProps<S>` beside
  `packages/workbench/src/components/SettingsShell.vue` (F6-adjacent; land after F6).
- **JSON/shell scanner residue (D2).** `SF/beautify.ts:24-165` and
  `SF/views/shared/document/ejson.ts:519-690` share four pairs of helpers:
  - `Cursor`/`ShellCursor`
  - `isJsonWs`/`isShellWs` and `skipJsonWs`/`skipShellWs`
  - `tryParseJson`/`tryParseShellText`
  - `beautifyJson`/`beautifyShellText`

  They differ only in the value parser, the error class, the key text and the message.

  Shape: move a generic cursor, `skipWs`, `tryParse(text, parseValue, isScanError)` and
  `beautifyWith` into `SF/views/shared/document/rawTree.ts`. That file already holds
  `parseContainer` and the `render*` helpers.

### H10 Go `logBaseArgs` inlined (D3)

`KS/internal/gitclient/porcelain/log.go:114-122` `LogScanArgs` repeats `logBaseArgs`
(`log.go:34-39`) line for line; only the format differs. Make it `logBaseArgs(format string)`, and
have both callers pass their format.

## §2 Dimensions that found nothing real

**D2 is mostly noise.** It found one real item from 1,268 invisible pairs at its loosest setting.
Control-flow shape alone cannot tell copied scaffolding from unrelated switch/case tables: most
matching pairs have identifier-blind similarity near 0. Its one real finding was a scanner pair.
That pair's helpers have different names and callees, which is why S1–S3 missed it. Keep D2 only as
a secondary signal combined with D3.

**D5, the import-set pre-filter, found nothing new.**

Method:
- A "rare" import appears in ≤6 files. File pairs sharing ≥2 rare imports form buckets.
- Same-file pairs are included, since a file shares all its own imports.
- Inside the buckets, run a lowered S3: LCS ≥0.4, ≥3 callees, ≥4 lines. Exclude pairs P113's S3
  already sees.
- Keep pairs with blind similarity ≥0.5.
- Whole-repo volume at the same lowered cutoff is estimated from a uniform 400,000-pair sample
  (seed 115).

Results:
- Go: 2,056 units. 28 bucket file pairs give 8,653 candidate pairs, 756 lowered hits, 166 kept.
  The whole repo has 2,112,540 pairs; the estimate is ~20,845 hits, ~1,088 after the body filter.
- TS: 1,578 units. 149 bucket file pairs give 14,811 candidates, 403 lowered hits, 92 kept. The
  whole repo has 1,244,253 pairs; the estimate is ~3,142 hits, ~180 after the body filter.
- The 258 kept pairs split 232 same-file and 26 cross-file.

Triage:
- Cross-file hits are almost all F4 (documents/grid/keyvalue `load`/`reload`/`runCount`/
  `setSearch`), F1 (`refreshSelEdges`, `buildColumns`), or test-support starters
  (testsupport s3/sqs, db-fixtures mariadb/postgres).
- The rest were read and declined because their differences are the content:
  - `KeyValuePane`/`StreamView` `onRow*FromEvent`: different dataset keys and fields.
  - `RepoSearchRow`/`RepoTreeRow` `onClick`.
  - `EnvironmentsView`/`VariableSetView` `syncDrafts`: already on `mergeDrafts`.
  - `CollectionsTree`/`ProjectTree` `onTreeKeydown`.
  - `ProjectionMenu`/`ColumnsMenu` `toggle`: a 3-line set toggle with different guards.
  - `DocumentView` `commitCreate`/`commitEdit` vs `DataView` `onCommit`: a try/`setActionError`
    shape over different stores and follow-ups. A helper is not shorter.
- Same-file hits are G9 (gitsession caches), G3 (bridge queries), gitrpc handlers (declined), or
  one-line delegates.

Verdict:
- The pre-filter does what the SPEC row asked. It affords a lower threshold, cutting triage volume
  roughly 6x in Go and 2x in TS.
- It does not detect anything new. Rare-import buckets are sparse in Go (28 file pairs), so it
  mostly degenerates to same-file comparison.
- It is worth using only as volume control under some future lowered S3 run.

**D3 and D4 are the productive dimensions.** Between them they produced all but three findings (D1
gave two, D2 one). Both see things S1–S4 cannot: message wording and type declarations, not call
sequences.

## §3 File ownership and implementer call

**A fix phase is warranted.** H1–H10 are real: 17 items in total (H3 holds two, H9 seven). By
dimension: D1 2, D2 1, D3 8, D4 6, D5 0. Register it as
`P115 Part 2` per `CLAUDE.md`'s split rule (this pass then becomes Part 1), unless the orchestrator
or user prefers otherwise.

**It must run after P113 lands.** H1–H3 touch adapter files that G1/G2 edit. H4/H6/H9 touch git-ui
and frontend files near F1/F4/F6/F8. Rebasing onto P113's result, then re-reading each site, is
required.

**Call: two streams**, Stream A (Go) and Stream B (TS/Vue). Both conditions for a split hold:

- **Zero file overlap.** Stream A edits only `*.go` plus `docs/ARCHITECTURE.md` (H1's sentence).
  Stream B edits only `*.ts`/`*.vue`.
- **No ordering dependency between streams.** Nothing in either stream changes a bound Wails
  signature, a wire contract or error text consumed by the other language.

| Owner | Findings | Files |
| --- | --- | --- |
| Stream A — Go | H1, H2, H3, H7, H8, H10 | `A/{postgres,mysqlfamily,redis,mongo,kafka,clickhouse,s3}/{client,adapter,read}.go`, `A/{tree,sqltext}.go`, new `A/sslmode.go`, `ST/internal/bridge/{agenthooks,terminal,dbmcp}.go`, `ST/internal/dbmcp/explain.go`, `KS/internal/bridge/terminal.go`, `KS/internal/{gitsession,gitpreflight}/status.go`, `KS/internal/gitclient/porcelain/log.go`, `docs/ARCHITECTURE.md` |
| Stream B — TS/Vue | H4, H5, H6, H9 | `packages/kira-ui/src/KuiColumnResizeHandle.vue`, `GU/App.vue`, `GU/components/rowMenuModel.ts` (+ its callers and test), `GU/state/{detailActions,review}.ts`, `SD/{sql-lex,sql-lint,sql-split,sql-tokens,mask}.ts`, `SF/views/shared/{sqlIdent,celleditor/generate}.ts`, `SF/views/console/{sqlNodes,format,lint}.ts`, `SF/views/console/ConsoleView.vue`, `SF/workbench/panels/OperationsPanel.vue`, `SF/project/{menuItems,menus}.ts`, `SF/views/browse/menu.ts`, `SF/beautify.ts`, `SF/views/shared/document/{ejson,rawTree}.ts`, `KF/state/workspace.ts`, `KF/views/repo/Repo{Graph,Diff,File,MultiDiff}View.vue`, `KF/repo/git/hostHandlers.ts`, `apps/kira-space-vscode/src/{extension,proxyHandlers}.ts`, `packages/git-ipc/**`, both apps' `workbench/settings/types.ts`, `packages/workbench/src/components/**` |

Order within each stream:
- Stream A: H2, H3, H1, H7, H8, H10. H2/H3 go first because they sit on G1/G2's landed shape.
- Stream B: H4 (`fix:`, a bug), H9 `rowMenuModel`, H6, H5, then the rest of H9.

Landing follows `CLAUDE.md`:
1. Cut each stream's worktree from the chapter head after P113.
2. Verify each stream independently.
3. Rebase each stream onto the chapter branch. A conflict means the ownership table was wrong:
   stop and re-plan.
4. Remove the worktrees, then push.

Fallback: one sequential Sonnet implementer runs Stream A's order, then Stream B's. Nothing depends
on the split.

Commit each finding (or H9 sub-item) on its own as it lands. This doc plus the commit log is the
full resume state.

## §4 Verification

Per commit (fast):
- Stream A: `go build ./...`, `bun run lint:go`, `go test` of the touched package.
- Stream B: `bun run typecheck`, `bun run lint`.

Once near stream end (full):
- **Stream A:**
  - `bun run test:go`, including every touched `A/*/*_test.go` conformance suite.
  - `KS/internal/gitsession` and `gitpreflight` tests.
  - The general real-container adapter suite for the six TLS adapters, where Docker is available
    (`docs/DEV_ENVIRONMENT.md`).
- **Stream B:**
  - `bun run test:unit`.
  - `bun run test:ui:studio` and `bun run test:ui:space`.
  - `bun run test:webview` (git-ui ships in the VS Code webview).
  - `bun run lint:dead`.
  - H4: right-click on the detail-pane handle starts no drag. Arrow keys widen the pane in the
    reverse direction.

After rebase (orchestrator's own checks, not subagent prose):
- Greps (non-test):
  - `unknown sslmode` string literals under `A/`: only in the new shared helper.
  - `unexpected root path segment kind` under `A/`: only `A/tree.go`, plus any variable-depth site
    H2 deliberately left.
  - `type readReq struct` under `A/`: only redis.
  - `interface ServerAppInitResult`: 0 outside `packages/git-ipc`.
  - `function buildReviewRowMenu`/`buildReadOnlyRowMenu`: one body.
  - `props.tab.workspaceId ? repoIdOfWorkspace`: 0.
- `bun run dedup:ts` and `bun run dedup:go` run clean. They must not list the `beautify.ts`/
  `ejson.ts` pair or the three `SD/sql-*.ts` projection blocks.
