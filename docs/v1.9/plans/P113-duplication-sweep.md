# P113 — Second duplication sweep: findings + plan

Opus planning pass. Findings and plan only — nothing here is implemented yet. Base: `f20298d1`
(chapter head after P114 result). Sites are `file:line` against that commit. The implementer
re-reads each site before editing — line numbers drift as earlier findings land.

Path shorthands: `A/` = `apps/kira-studio/internal/adapters/`, `KS/` = `apps/kira-space/`,
`ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`, `GU/` = `packages/git-ui/src/`.

## §0 Goal, method, acceptance

**Goal.** Find duplication P107 missed or that P108–P112 introduced. Fix every real finding. Make
jscpd (TS/Vue) and dupl (Go) permanent repo tooling. Re-judge P107 iteration 1's 12 declines.

**Method.** P107 §0's S1–S4, re-run over CodeGraph's SQLite index (nodes, `calls` edges,
`unresolved_refs`) at `f20298d1`, plus both new tools:

- S1 body hash, exact and identifier-blind: 121 exact / 283 blind groups. All exact groups are
  tests, one-line delegates or already-declined shapes.
- S2 name collisions (same name, body line-set ratio ≥0.6): 459 pairs, triaged by hand.
- S3 callee-fingerprint LCS, **widened** (below).
- S4 comment-blind file-pair diff: 826 pairs, cross-checked against jscpd/dupl file pairs.
- jscpd 5.3.2 over `apps` + `packages` (TS + Vue) in four modes: default, `--min-tokens 30
  --min-lines 4`, `--ignore-identifiers --ignore-literals`, `--similarity 0.85`.
- dupl v1.1.0 over 906 non-generated Go files at `-t 100`, `-t 75`, `-t 50`.

**S3 widening.** The old cutoff was LCS/max ≥0.7, ≥6 resolved callees. It misses short helpers,
and misses bodies whose calls mostly go to stdlib or external packages (unresolved in the graph).
New cutoff:

- LCS/max ≥**0.6**.
- ≥**4** callees, counting resolved **plus unresolved** call refs. The unresolved refs catch
  `sync.Mutex`/`exec.Cmd`/`sql.Row` shapes the old run was blind to.
- Both nodes ≥4 lines. This drops interface-method stubs, which dominated the raw wide output.
- Triage filter: identifier-blind body similarity ≥0.5, non-test pairs only.

Result: raw wide S3 gave 9,045 pairs (3,083 on resolved callees only), against 1,741 under the old
cutoff. The triaged set holds 891 pairs: 56 the old cutoff also found, 835 surfaced only by the
widening. The widening produced G1, G3, G8, G9, G10 and G12. Each is a family of short bodies over
unresolved stdlib calls that ≥6 resolved callees could never reach. Going below 0.6/4 was not tried. At
0.6/4 the triaged set is already 891 pairs to read by hand, and jscpd/dupl cover the shorter
token-level tail.

**Acceptance.**

1. jscpd and dupl are installed as permanent dev tooling with `dedup:ts`/`dedup:go` scripts (§1).
2. Every finding in §2–§3 lands as its own `refactor:`/`fix:` commit. Fast checks (build,
   typecheck, lint) pass per commit.
3. §4's flip (#4, as G3) and partial flips (#5 as G11/G12, #12 as G14/F10) land. The 9 holds
   stay untouched.
4. The §6 closing run is green. Re-running `dedup:ts`/`dedup:go` no longer reports the targeted
   pairs.
5. No bound Wails method signature changes. Frontend bindings do not regenerate from this phase.

## §1 jscpd / dupl adoption

### License evidence

Read from the actual files, not from memory:

- **jscpd**: `https://raw.githubusercontent.com/kucherenko/jscpd/master/LICENSE` begins "The MIT
  License (MIT) / Copyright (c) 2013-2024 Andrey Kucherenko".
  - The installed `jscpd@5.3.2` `package.json` says `"license": "MIT"`.
  - The installed platform binary packages (`jscpd-linux-x64-gnu`, `jscpd-linux-x64-musl`, both
    5.3.2) also say `"license": "MIT"`.
  - 5.x is a Rust engine shipped as npm `optionalDependencies`, one package per platform
    (darwin-arm64/x64, linux gnu/musl ×2 archs, windows ×2).
  - It has no paid or Enterprise tier. The features used (token clones, `--ignore`, console/json
    reporters) are all in the MIT package.
- **dupl**: `https://raw.githubusercontent.com/mibk/dupl/master/LICENSE` begins "The MIT License
  (MIT) / Copyright (c) 2015 Michal Bohuslávek". That is MIT, as the SPEC row says.
  - v1.1.0's `go.mod` (from `proxy.golang.org`) is `module github.com/mibk/dupl / go 1.14`. It has
    zero dependencies, so adopting it adds one `require` line and one `tool` line.
- **hashicorp/golang-lru/v2** v2.0.7 (used by G9): LICENSE reads "Copyright IBM Corp. 2014, 2026 /
  Mozilla Public License, version 2.0".
  - MPL-2.0 is file-level copyleft, OSS, with no tiers. It only obliges changes to its own files.
  - It is already in `go.sum:148-149` as a transitive dependency. G9 promotes it to a direct
    `require`.

### Install and config

- **TS/Vue.** Run `bun add -d jscpd@5.3.2` at the repo root. It resolves the host platform's binary
  package and updates `bun.lock`.
- Add a repo-root `.jscpd.json`, tested verbatim in the sandbox as a `-c` config. It gave the same
  924 clones as the equivalent CLI flags. `path` resolves relative to the config file.

```json
{
  "path": ["apps", "packages"],
  "format": ["typescript", "vue"],
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/generated/**",
    "**/protocol/wire/**",
    "**/bindings/**",
    "**/*.d.ts"
  ],
  "reporters": ["console"],
  "noTips": true
}
```

- **Go.** Run `go get -tool github.com/mibk/dupl@v1.1.0`. Go 1.24+ tool directive; repo is on
  `go 1.27.1`. Run it with `go tool dupl`, with no GOPATH install step.
  - The sandbox refused `go get` in a scratch module (its git-isolation guard), so this exact
    command has not been run here. The implementer runs it and confirms `go.mod` gains
    `tool github.com/mibk/dupl`.
  - The binary itself was built and timed here (below).
- dupl has no exclude flag, so the script feeds `-files` a filtered list.
- Generated Go excluded: `apps/kira-studio/internal/page/wire/` (26 files) and
  `apps/kira-space/internal/gitwire/` (5 files), both FlatBuffers output.

### Scripts (root `package.json`)

```json
"dedup:ts": "jscpd -c .jscpd.json",
"dedup:go": "git ls-files '*.go' | grep -v -e /page/wire/ -e /gitwire/ | go tool dupl -files -t 100"
```

- Both scripts are **report-only**: neither gates a commit or CI.
  - Neither run is at zero today. Test files carry deliberate per-adapter conformance duplication
    (`CLAUDE.md`'s own exemption), and a gate would fail on it.
  - Gating was not asked for.
- A sweep passes looser thresholds through, e.g. `bun run dedup:ts --min-tokens 30` or
  `... dupl -files -t 50`.
- Run `lint:dead` (knip) after adding them. knip counts a binary used in a `package.json` script as
  used, so `jscpd` should not be flagged. If it is, fix the knip config, never the script.

### Timing (measured in this sandbox, `f20298d1`)

- jscpd default over 1,563 files: 259–282ms (the config-file run was 281ms). The other modes ran
  297ms (k30), 317ms (renamed) and 378ms (ast).
- dupl over the 906-file filtered list: 1,862ms (`-t 100`), 1,846ms (`-t 75`), 1,963ms (`-t 50`).
  Over `apps/kira-space` alone: 684ms. Over the whole repo unfiltered: 1,933ms.
- The SPEC row's earlier figures (171ms / 526 files, 282ms / kira-space) came from a smaller tree
  and a different machine. Both tools are still well under the cost of a typecheck.

### Raw tool output (for scale, not all real)

- jscpd default: 924 clones, 13,525 duplicated lines (5.68%), 169 non-test file pairs.
  - k30: 2,914 clones, 579 non-test pairs.
  - renamed: 4,000 clones, mostly structurally similar Vue templates.
  - ast 0.85: 1,133 clones.
- dupl non-test file pairs: 17 at `-t 100`, 36 at `-t 75`, 101 at `-t 50`.
- Most output is tests, adapter conformance suites, declarative tables, or pairs already on a
  shared helper with only argument lists repeating. §2–§3 list only what survived a manual read of
  both sides.

## §2 Findings: widened S3 (Go-heavy)

Each finding gives sites, then consolidation shape, then commit. "Keep" notes behavior that must
survive.

### G1 Adapter connection-state guards: all 9 adapters (R1 widened)

- Every adapter hand-writes mutex-guarded accessors (`getX`/`setConnected`/`clearConnected`/
  `getReadOnly`/`requireClient`) around its own field set:
  - `A/redis/adapter.go:33-70`, `A/sqs/adapter.go:79-97`, `A/postgres/adapter.go:42-91`
  - `A/sqlite/adapter.go:56-73`, `A/mysqlfamily/adapter.go:41-82`, `A/kafka/adapter.go:40-80`
  - `A/mongo/adapter.go:63-99,174`, `A/clickhouse/adapter.go:40-66`, `A/s3/adapter.go:40-70,105`
- Postgres and mysqlfamily are byte-identical across this block (pg 33-91 / mysql 30-86). Also
  identical between them:
  - `Disconnect` (pg 140-154 / mysql 156-169).
  - The Mutate/Execute read-only dispatch (pg 402-427 / mysql 388-413).
  - The pkColumns mark loop (pg 276-285 / mysql 267-276).
  - The read-only console transaction block (`A/postgres/console.go:198-217` /
    `A/mysqlfamily/console.go:166-178`).
- Shape:
  - `adapters.Guarded[T any]` (mutex plus value; `Load() T`, `Update(func(*T))`).
  - Each adapter declares one `connState` struct holding the fields it guards today. Every getter
    becomes `a.state.Load().field`.
  - pg and mysql share `relational.ConnState[S]` (connSet, cfg, primaryDatabase, readOnly) and a
    shared `relational.Disconnect` body.
  - Add `adapters.MarkPrimaryKey(cols, pk)` and a shared read-only console transaction helper for
    the two SQL consoles.
- Keep:
  - `clearConnected` deliberately leaves `readOnly` set (every adapter).
  - Postgres assigns `connSet` before the probe (P13 D1, `setConnSet` doc).
  - No lock is held across network calls.
- Commits: one per adapter (9), then one each for the relational pair and the two helpers. Run that
  adapter's conformance suite per commit (`go test ./apps/kira-studio/internal/adapters/<kind>/...`).
  These are fast, no container needed for the unit-level suites.

### G2 Adapter path-shape guards (~15 sites)

- The fixed-depth `"<op> requires a database/…/table path, got …"` checks:
  - `A/mysqlfamily/adapter.go:229-235,308-310,341-348`
  - `A/mongo/adapter.go:233-239`, `A/mongo/mutate.go:21-28`
  - `A/postgres/adapter.go:233,300,346`, `A/postgres/mutate.go:20-27`
  - `A/sqlite/adapter.go:294,348`, `A/clickhouse/adapter.go:192-198,245`
  - `A/sqlmutate.go:358-363` (`ResolveDatabaseTablePath`)
  - `A/kafka/adapter.go:183-199`, `A/redis/mutate.go:19-24`, `A/s3/mutate.go:29`,
    `A/sqs/adapter.go:165`
- Error text drifts ("got depth N" vs "got: <path>").
- Shape: `adapters.RequirePath(path, op string, kinds ...string) ([]model.PathSegment, error)`,
  checking depth and per-segment kind, with one message format.
- Before unifying the text, grep `_test.go`, `tests/` and the frontend for the old strings. None
  pinned it at `f20298d1`; re-confirm.
- Variable-depth shapes (redis `…/key`, s3 `…/object` prefixes) stay hand-written.
- Commits: helper plus adapters, one commit per adapter or two.

### G3 Bridge `ipcerr.Internal(err.Error())` pass-throughs (flips decline #4)

- 101 production sites across ~30 bridge files repeat
  `v, err := svc.X(...); if err != nil { return zero, ipcerr.Internal(err.Error()) }; return v, nil`.
  Examples:
  - `ST/internal/bridge/queries.go:20-119` (whole file)
  - `ST/internal/bridge/collections.go:61-125`, `ST/internal/bridge/variables.go`
  - `ST/internal/bridge/ops.go:32-41`
  - the grpchistory/responsehistory bridge pair
- Shape, in `internal/ipcerr/errors.go`:
  - `InternalResult[T any](v T, err error) (T, error)`, so a call site reads
    `return ipcerr.InternalResult(svc.X(...))`.
  - `InternalErr(err error) error` (nil-safe) for error-only returns.
- Semantics are exactly `Internal(err.Error())`, **not** `Wrap`'s. The frontend's error-code
  handling sees no difference.
- Five lines collapse to one at every site, so the helper is shorter than the pattern. That is why
  #4 flips (§4).
- The 94 `ipcerr.BadRequest("x is required")` guards stay. A helper would not be shorter.
- Bound method signatures are unchanged.
- Commits: helper, then one per bridge file group (~6–8 commits).

### G4 Bridge tab-list + window check: cross-app identical

- `KS/internal/bridge/tabs.go:19-50` == `ST/internal/bridge/tabs.go:19-50`.
- Shape: `appstorage.ListWindowTabs(...)` and `appstorage.CheckWindow(...)` in
  `internal/appstorage/tabs.go` beside `SaveWindowTabs`. Both bound methods keep their signatures
  and delegate.

### G5 Layout repo residue (I2-1 remainder)

- `GetAll` and the leaf upsert loop repeat across apps:
  `KS/internal/storage/repos/layout.go:33-48,67-86` vs
  `ST/internal/storage/repos/layout.go:65-80,98-120`.
- Shape: `appstorage.QueryLeaves` / `appstorage.UpsertLeafList` in `internal/appstorage/leaves.go`.
  The per-app model types stay.

### G6 saved_queries save/decode

- `ST/internal/storage/repos/saved_queries.go`: `SaveFilter` 137-153 == `SaveConsole` 155-171. The
  strict-decode arms repeat at 43-63.
- Shape: a private `save(kind, body any)` and a generic `decodeStrict[T]`.

### G7 tree service cache-aside ×3

- `ST/internal/tree/service.go`: `Describe` 214-236, `Definition` 239-261, `SchemaColumns`
  267-292. Each does check cache, miss, call the adapter, then store.
- Shape: generic `cacheAside[T](s, key, load func() (T, error))`. `Children` keeps its own logic
  (paging plus partial invalidation).

### G8 gitsession parallel numstat + name-status

- The same two-command fan-out and merge appears 5 times:
  - `KS/internal/gitsession/working.go:37-79` (44-57 / 58-71)
  - `KS/internal/gitsession/queries.go:195-228`
  - `KS/internal/gitsession/incremental.go:521-560`
  - `KS/internal/gitsession/stash.go:198-251`
  - `KS/internal/gitsession/preflight.go:585-640`
- The untracked `ls-tree` block is duplicated at `stash.go:231-250` / `preflight.go:618-637`.
- `runOne` followed by `allRecords` repeats ×14 across the package.
- Shape:
  - `(e *RepoEntry) runRecords(ctx, args)`.
  - `fileChanges(ctx, numstatArgs, nameStatusArgs)` over `golang.org/x/sync/errgroup` (already a
    dependency).
  - `stashUntrackedPaths(ctx, ...)`.
- Keep today's error precedence (which command's error wins) if any gitsession test pins it. Read
  `*_test.go` first.
- In the same package, `runWriteArgv` vs `runWriteArgvList` (`ops.go:1104-1157`): the single form
  calls the list form with one argv.

### G9 gitsession caches

- `KS/internal/gitsession/cache.go`:
  - `detailCache` 18-87 and `mergeBaseCache` 163-244 are identical count-capped slice LRUs.
    Replace both with `github.com/hashicorp/golang-lru/v2` `lru.New[K, V](n)`, keeping each
    current capacity.
  - `refsCache` 89-123 and `stackCache` 125-160 are identical single-value caches. Replace both
    with a generic `valueCache[T]`.
- Library chosen over a hand-rolled generic LRU per `CLAUDE.md`'s library-first rule. License in §1.
- Stays:
  - `diffCache` (byte-capped, `container/list`). golang-lru counts entries, not bytes.
  - `ST/internal/enginecache/lru.go` `ByteLru` (byte budget).
  - `A/connset.go` (acquire/release refcount, not an LRU).
- Keep invalidation call sites and their locking unchanged. Existing gitsession cache tests must
  pass unmodified.

### G10 Process-group kill + graceful cancel ×4

- The `killGroup` var is byte-identical ×4:
  - `KS/internal/gitclient/runner.go:286`
  - `KS/internal/ghclient/runner.go:106`
  - `KS/internal/gitprepare/runner.go:70`
  - `internal/toolexec/exec.go:90`
- SIGTERM, then `time.AfterFunc(gracefulStopDelay, SIGKILL)` plus `cmd.WaitDelay` and
  escalate-stop wiring, appears ×4 (`gitclient:331-344`, `ghclient:133-150`, `gitprepare:100-133`,
  `toolexec:117-130`). The gitclient `Close` paths repeat it ×2 more (`runner.go:534-541`,
  `597-608`).
- `gracefulStopDelay` vars ×3; also `internal/startupfail/alert.go:13`.
- Shape: new repo-root `internal/procgroup`:
  - `Kill(pid int, sig syscall.Signal) error`
  - `GracefulCancel(cmd *exec.Cmd, delay time.Duration, kill func(int, syscall.Signal) error) (stop func())`
- Each package keeps its own test-seam vars (`killGroup`, `gracefulStopDelay`) and passes them in.
  Existing seam tests stay valid.
- Do not add a new unit test. The existing runner tests already exercise escalation through those
  seams.

### G11 connections Insert ×3 (I2-9 residue)

- `ST/internal/storage/repos/connections.go`: `Insert` 197-234, `InsertWithSecret` 270-307,
  `InsertDuplicateWithSecret` 331-373.
- All three share: begin tx, next sort order, insert, commit, then Get after insert.
- Shape: one private `insertTx(ctx, row, secret)`, used by all three.
- `Insert` has one production caller (`ipcfixture/harness.go:151`, test support) plus tests. It
  becomes `InsertWithSecret(..., nil)`.

### G12 sqlite repo mechanics (partial flip of decline #5)

- Get-by-id mapping `sql.ErrNoRows` to `(nil, nil)`, ×6:
  - `ST/internal/storage/repos/maskrules.go:80,143`
  - `ST/internal/storage/repos/customscripts.go:45`
  - `ST/internal/storage/repos/connections.go:186`
  - `ST/internal/storage/repos/maskkeys.go:35`
  - `KS/internal/storage/repos/coderepos.go:40`
- Next-sort-order query ×12, in 3 spellings:
  - `ST/internal/storage/repos/variables.go:91,160,522,1219`
  - `ST/internal/storage/repos/collections.go:178,296,554`
  - `ST/internal/storage/repos/connections.go:210,283,344`
  - `ST/internal/storage/repos/customscripts.go:62`
  - `KS/internal/storage/repos/coderepos.go:58`
- Shape, in `internal/sqlitex/query.go` beside the existing `QueryAll`:
  - `QueryOne[T](ctx, q, scan, query, args...) (*T, error)`, with ErrNoRows mapping to nil.
  - `NextSortOrder(ctx, q, table, where string, args...) (int, error)`.
- Per-table SQL and row scanners stay. That part of decline #5 holds.
- G11 lands first, so G12 edits `connections.go` after its insert paths are already merged.

### G13 Small Go items

- `KS/internal/gitsession/opslot.go`: `claim` 24-32 vs `claimAlways` 37-45 become one
  `claim(kind, cancel, killable bool)`.
- `KS/internal/gitrpc/comments.go` 79-92 / 161-174: the branch+`at` scope validator is duplicated.
  Shape: `validReviewScope(...)`.
- `ST/internal/postman/body.go:132-146` vs `ST/internal/postman/parse.go:352-367`: `SavedField` and
  `SavedHeader` have identical fields, so a Go conversion works. Shape: one shared
  `importKeyValueRows`.

### G14 queryplan MySQL/MariaDB same-language residue (partial flip of decline #12)

- `ST/internal/queryplan/mysql.go:74-86` `mysqlTableLabel` == `ST/internal/queryplan/mariadb.go:55-67`
  `mariadbTableLabel`.
- The D15 full-scan and unused-index issue blocks are identical: `mysql.go:124-137` /
  `mariadb.go:99-112`.
- Shape: `tableLabel(name, accessType *string)` and
  `pushIndexIssues(node *Node, relation, accessType, possibleKeys, key)` in
  `ST/internal/queryplan/issues.go`, beside `pushWideScanIssue`.
- The raw schemas (`mysqlRawTable` vs `mariadbRawTable`) stay separate; they are genuinely
  different (F13).

## §3 Findings: jscpd/dupl-only (TS/Vue-heavy)

Only jscpd found these. CodeGraph's call graph does not model template markup.

### F1 SlickGrid host residue (T2-17 remainder)

- `SF/views/console/ConsoleSlickGrid.vue` (897 lines) vs `SF/views/grid/SlickGridHost.vue` (2,730
  lines). jscpd reports 164 duplicated lines in 12 blocks by default, 216 at k30.
- Pieces:
  - `computeCellFillHash` (console 374-394 / host 892-917)
  - gutter column def (176-192 / 471-496)
  - `onGridRendered` visible-band computation (315-331 / 1013-1022)
  - `onCellRangeSelecting` (399-405 / 939-945)
  - rowHeight watch (833-839 / 2403-2409)
  - the shared event-subscription block
- Shape, into existing `SF/views/shared/slick/` (beside `selectionEdges.ts`):
  - `gutterColumn(testid)`
  - `computeCellFillHash(sel, bounds, rowAt, fieldAt)`
  - `renderedPageRowBand(grid, ds)`
  - `subscribeRangeSelecting(grid, ...)`
- Hosts keep their own differing handlers (the console is read-only).

### F2 Tooltip-wrapped icon buttons: 152 blocks, 52 files

- Pattern: `Tooltip > TooltipTrigger as-child > [TooltipDisabledTrigger] > Button > CodiconIcon` +
  `TooltipContent`. Each is 13–16 lines of template.
- Counted by a template regex over all `.vue` under `apps` and `packages`.
- Top files: `KeyValuePane.vue` 10, `HttpRequestView.vue` 9, `DocumentView.vue` 8,
  `StreamView.vue` 8.
- Shape: `packages/theme/src/components/TooltipIconButton.vue`:
  - Composed from theme's own shadcn-vue `Button`, `Tooltip*` and `CodiconIcon`, not a new
    primitive.
  - Props: `icon`, `label` (tooltip text plus `aria-label`), `disabledTrigger?`, `variant?`,
    `size?`.
  - Attrs (`data-testid`, `@click`, `disabled`, classes) fall through to the `Button`.
- Migrate file by file, several files per commit.
- Keep every `data-testid` and `aria-label` exactly, because UI tests select on them.
- Blocks whose Button carries extra children (text, a badge) stay as they are.

### F3 Search option toggles ×3

- Match-case / whole-word / regex toggle trio:
  - `SF/views/shared/page/SearchToolbar.vue`
  - `SF/views/shared/ResponseFindBar.vue:160-200`
  - `KS/frontend/src/repo/RepoSearchView.vue`
- Shape: `packages/workbench/src/components/SearchOptionToggles.vue`, with three `v-model`s. Keep
  each site's testids through a `testidPrefix` prop.

### F4 Paged view runtime residue (T2-16 / I2-14 remainder)

- The `*ViewRuntime` base fields and `defaultRuntime()` repeat in:
  - `SF/views/documents/state.ts:21-60`, `SF/views/shared/keyvalue/state.ts:20-56`
  - `SF/views/grid/state.ts`, `SF/views/stream/state.ts`
- The `apply` page-position block repeats: documents 113-121 / keyvalue 131-139.
- `SF/views/stream/state.ts` still hand-rolls its load. `SF/views/shared/page/load.ts` carries
  P108 F20's note that it should adopt `runPagedLoad`.
- Shape:
  - `PagedViewRuntime` base interface, `defaultPagedRuntime()` and `applyPagePosition(rt, page)`
    in `SF/views/shared/viewOp.ts`.
  - Stream moves onto `runPagedLoad`.

### F5 Pending-decision dialogs, plus a latent bug (`fix:`)

- `KS/frontend/src/workbench/GitPairingDialog.vue:1-55` vs
  `SF/workbench/DbMcpApprovalDialog.vue:1-62` share:
  - the countdown ticker (`useIntervalFn`)
  - `remainingSeconds`
  - the focus-Deny-on-open watch
- **Bug:** GitPairingDialog watches `pending !== null`, a boolean. When the queue advances from
  request A to request B, the value stays `true`, so the watch never re-fires. Deny focus and the
  countdown reset are skipped for B.
  - P108 Part 12 F2 fixed exactly this in DbMcp by keying on `requestId`.
  - The pairing queue is real (the dialog renders `queued > 1`), so the bug is live.
- Shape: VueUse-based composable `usePendingDecision({ pendingId, expiresAtMs })` in
  `packages/workbench/src/` (both apps already depend on it). It returns `remainingSeconds` plus a
  `denyRef`, and keys on the id.
- Commit as `fix:` (pairing dialog re-arms per request) plus the extraction.

### F6 Cross-app frontend shell residue

- `KS/frontend/src/BootFailure.vue` and `ST/frontend/src/BootFailure.vue` (36 lines) differ only in
  the app name.
- `bootstrap()`: `KS/frontend/src/main.ts:84-100` == `ST/frontend/src/main.ts:380-396`.
- Terminal tab-kind descriptor: `KS/frontend/src/state/tabKinds.ts:161-187` ==
  `ST/frontend/src/state/tabKinds.ts:346-372`, apart from the mode constant.
- `vite.config.ts`: `KS/frontend/` vs `ST/frontend/` differ only in port (9246/9245), the app name
  in bindings paths, and comments.
- Shape, in `packages/workbench`:
  - `components/BootFailure.vue` with an `appName` prop
  - `bootstrapShell(mountShell, appName)`
  - `terminalTabKind(mode)`
  - `defineAppViteConfig({ app, port })` in a config-only module
- If Vite config-time import of a workspace TS file needs an extra `tsconfig`/`exports` entry, add
  it. Do not inline the config back.
- Playwright configs differ substantially. Declined.

### F7 git-ui ref-list scaffolding

- Section header div: ×7 files in `GU/components/`.
- "Show N more (M remaining)" button ×4: `BranchPicker.vue` 704-711, 742-749;
  `TagList.vue` 141-145; `StashRows.vue` 132-137.
- "More actions" icon button ×4: `BranchPicker.vue` 685-693, 732-740; `TagList.vue` 131-139;
  `StashRows.vue`.
- Shape: `RefSectionHeader.vue`, `ShowMoreButton.vue` and `RowActionsButton.vue` in
  `GU/components/`. `RowActionsButton` builds on F2's `TooltipIconButton`, so F2 lands first.

### F8 git-ui state skeletons

- Repo-scoped reload appears in `GU/state/refs.ts:65-110`, `worktrees.ts:38-78`, `stack.ts`,
  `stash.ts`, `ops.ts` and `repoSettings.ts`. Each repeats:
  - `setRepoId`
  - a `bridge.on('repo.changed')` filter
  - a latest-request-wins reload
  - `#logBackgroundError`
- File-list cursor (`selectedFile` / `listMode` / `filter`, plus `selectFile` / `setListMode` /
  `setFilter`) appears in `GU/state/detail.ts:36-102`, `working.ts:25-65` and `stash.ts`.
- Shape: helper classes `RepoScopedReload` and `FileListCursor` in `GU/state/`, composed into
  each state class.
- Composition, not inheritance, because some classes need both helpers.
- Keep the latest-request-wins ordering exactly. It is concurrency logic. Existing git-ui unit tests
  cover it and must pass unmodified.

### F9 git-ui small items

- The `openAllChanges` announce block is identical: `GU/components/CommitMeta.vue:258-275` ==
  `GU/components/review/ReviewCommitRow.vue:140-157`. Shape:
  `openAllChangesAnnounced(actions, target)`.
- The cherry-pick/revert preflight prediction block (`GU/components/dialogs/RevertDialog.vue:94-120`
  vs `CherryPickDialog.vue:128-159`). Shape: `PreflightPrediction.vue`.

### F10 plan parsers: MySQL/MariaDB same-language residue (partial flip of decline #12)

- `SF/views/console/planParsers/mysql.ts:89-104` == `mariadb.ts:67-82`: the D15 full-scan and
  unused-index pushes.
- Shape: `pushIndexIssues(node, table)` in `SF/views/console/planIssues.ts`, beside the existing
  `pushWideScanIssue` / `tableLabel` / `rawFieldMetrics`.
- The raw schemas and MySQL's `cost_info` metric expansion stay per engine.

### Assessed and not findings

Each item below was checked against both sides and holds as is:

- gitrpc list handlers: already on `handleRepoCall`; the per-method validator closures are the
  content.
- agenthooks/dbmcp `SetEnabled`: `embeddedService` doc keeps it per service by design.
- `dbmcp/tools.go:96-146`: already over `resolveReadGated`/`jsonResult`.
- `KS/internal/gitsock/pairing.go` vs `ST/internal/dbmcp/approval.go` `snapshotLocked` (T2-8
  residue): 7 lines, different types.
- gitsession `opContinue`/`opAbort`/`opSkip`: declarative table.
- enginecache `DropTarget` vs `InvalidateAfterMutation`: differ in one line.
- Cross-app `ChooseFolder` (iter2 decline) and the other bound-type-bearing bridge methods.
- Storage `db.go` cross-app (dupl's largest non-test pair, 101L): 10-line `OpenAt` delegates over
  `appstorage.OpenAt`, each with its own app `config`.
- Settings `upsert*Section` / appsettings `Validate*`: declarative per leaf.
- `grpcclient/reflect.go`: I2-34 landed. Mongo console / redis `readScanFamily`.
- Model `UnmarshalJSON`s, relational `caps.go` literals, adapterhost `router.go`
  Describe/Definition.
- Relational `readPage` (S3's top wide pair, body 0.72–0.76): the shared part is already
  `PlanRelationalPage`; the remainder is engine SQL.
- `wire.go:579-591` vs `model/gitreposettings.go:68-82`: wire vs model, different JSON tags.
- TS: page `search.ts` files (already over `createPageSearch`/`runPageScan`), Playwright configs,
  TitleBar settings button, WorkbenchShell new-tab button, `GlobalStashList` props, git-core model
  vs git-ipc `contract.ts` (iter2 decline B3).

## §4 P107 iteration 1's 12 declines, re-checked

Each decline was re-checked against widened S3, jscpd (all four modes) and dupl (t 100/75/50):

1. **`typeClassFor` ×4** (`A/{postgres,mysqlfamily,sqlite,clickhouse}/read.go`): **holds**.
   - No tool flagged it at any threshold.
   - Rule order is engine-specific, and so are the type names.
2. **`resolveFields`**: **holds**. It is a name collision only; no body-level tool flagged it.
3. **Bound Wails bridge services**: **holds** for the bound types and methods themselves (binding
   generation needs them per app). Their internals are G3/G4.
4. **Bridge thin-wrapper pass-throughs**: **flips**, as G3.
   - The original decline said "a helper is no shorter". A one-line generic `InternalResult` over a
     5-line pattern ×101 is shorter.
   - The widened S3 (unresolved callees) surfaced the family.
5. **Simple CRUD repos**: **partial flip**, as G11 and G12.
   - dupl flags the mechanics in `coderepos` / `customscripts` / `maskrules` Get and List
     (ErrNoRows mapping, next sort order, insert tx).
   - The per-table SQL and scanners still hold.
6. **`buildDSN`** (`A/sqlite/client.go:98-110` vs `sqlitex.BuildDSN`): **holds**.
   - Different pragmas and ro/rw mode.
   - The adapter rejects `?#%` in user paths via `rejectDSNMetacharacters`, rather than escaping
     them. Not a bug; no shared shape.
7. **`embed.go` `All` ×3**: **holds**.
   - dupl `-t 50` flags `gitreview/migrations/embed.go` vs `storage/migrations/embed.go`.
   - `//go:embed` must stay package-local, and `All` is a one-line delegate to
     `sqlitex.LoadMigrations`.
8. **`codeLanguageForContentType`**: **holds**.
   - Now `packages/api-core/src/http/raw/parse.ts:35-42` vs `curl/parse.ts:112-119`.
   - The raw table is deliberately narrower (D10, documented in place).
9. **git-ui `onOpenFile` / `blockerText` / `runRestack`**: **holds**. No tool flagged them.
10. **vscode `asExplicitTarget`** (`diffToolbar.ts:138-150` vs `reviewMarking.ts:132-148`):
    **holds**. The target unions differ.
11. **Generated FlatBuffers**: **holds**. Excluded from both tools' configs (§1).
12. **Cross-language mirrors**: **holds** for Go-vs-TS mirroring; **partial flip** inside each
    language.
    - jscpd reports 63 lines between `planParsers/mariadb.ts` and `mysql.ts`. dupl reports 26
      between `queryplan/mariadb.go` and `mysql.go`.
    - The raw schemas genuinely differ, but the table label and the D15 issue pushes are identical
      within each language. Fixed as G14 and F10.

Tally: **#4 flips. #5 and #12 partially flip. The other 9 hold.** #3 counts as a hold: G3 and G4
touch bridge internals, never the bound surface.

## §5 File ownership and implementer call

**Call: two streams, Stream A (Go) and Stream B (TS/Vue), after a one-commit Step 0.** The rule's
conditions are met:

- **Zero file overlap.** Stream A edits only `*.go`, plus `go.mod`/`go.sum` for G9's golang-lru.
  Stream B edits only `*.ts`/`*.vue`.
- **No ordering dependency between streams.**
  - No finding changes a bound Wails method signature (acceptance 5), so frontend bindings do not
    move.
  - G3 keeps `Internal` semantics byte-for-byte, so frontend error handling is unaffected.
  - The shared files (`package.json`, `bun.lock`, `go.mod`, `.jscpd.json`) all land in Step 0,
    before either worktree is cut.

| Owner | Files |
| --- | --- |
| Step 0 (one short Sonnet pass, one `chore:` commit on chapter branch) | root `package.json` (`dedup:ts`, `dedup:go`, `jscpd` devDependency), `bun.lock`, `.jscpd.json`, `go.mod`/`go.sum` (`tool github.com/mibk/dupl`) |
| Stream A — Go | `apps/kira-studio/internal/{adapters,bridge,storage,tree,postman,queryplan}/**`, `apps/kira-space/internal/{bridge,storage,gitsession,gitclient,ghclient,gitprepare,gitrpc}/**`, `internal/{ipcerr,appstorage,sqlitex,toolexec,startupfail}/**`, new `internal/procgroup/`, `go.mod`/`go.sum` (golang-lru `require` only) |
| Stream B — TS/Vue | `apps/kira-studio/frontend/src/**`, `apps/kira-space/frontend/src/**`, `apps/kira-{studio,space}/frontend/vite.config.ts`, `packages/{theme,workbench,git-ui}/src/**` (plus a `packages/workbench/package.json` `exports` entry, if F6's Vite helper needs one) |

- Stream A order: G3 (widest, mechanical) → G1 → G2 → G14 → G4 → G5 → G11 → G12 → G6 → G7 → G8 → G9
  → G10 → G13. G11 before G12 is required (same file).
- Stream B order: F5 (`fix:`, smallest, bug) → F2 → F7 (needs F2) → F1 → F4 → F3 → F6 → F8 → F9 →
  F10.
- Landing, per `CLAUDE.md`:
  1. Both streams branch off Step 0's commit, each in its own worktree.
  2. Verify each stream independently.
  3. Rebase each onto the chapter branch. A conflict means the ownership table was wrong; stop and
     re-plan.
  4. Remove the worktrees, then push.
- **Fallback:** if the orchestrator prefers one pass, a single sequential Sonnet implementer runs
  Step 0, then Stream A's order, then Stream B's. Nothing in the plan depends on the split.
- Each finding is its own commit (or a small numbered series for G1/G3/F2), as it lands. An
  interrupted stream resumes from its last commit. This doc plus the commit log is the full state.

## §6 Verification

Per commit (fast): the owning stream's build/typecheck/lint.

- **Stream A:** `go build ./...`, `bun run lint:go`, plus `go test` of the touched package(s).
  - G1/G2/G14: that adapter's own `A/<kind>` suite.
  - G8/G9: `KS/internal/gitsession`.
  - G10: gitclient/ghclient/gitprepare/toolexec.
- **Stream B:** `bun run typecheck`, `bun run lint`.

Once near stream end (full):

- **Stream A:**
  - `bun run test:go`, including every `A/*/*_test.go` conformance suite.
  - `go test -race` on `A/...`, `KS/internal/gitsession/...` and `internal/procgroup/...` (G1, G8,
    G9 and G10 touch locking and goroutines).
  - The general real-container adapter suite, where the sandbox has Docker (see
    `docs/DEV_ENVIRONMENT.md`).
- **Stream B:**
  - `bun run test:unit`, `bun run test:ui:studio`, `bun run test:ui:space`, `bun run test:webview`
    (git-ui is shared with the VS Code webview).
  - `bun run lint:dead`.
  - F5: confirm by reading the watch source that it keys on the request id.

After rebase onto the chapter branch (orchestrator's own real checks, not subagent prose):

- `bun run dedup:ts` and `bun run dedup:go` both run clean (exit 0) and no longer list:
  - F1's `ConsoleSlickGrid`/`SlickGridHost` blocks
  - F6's `main.ts`/`BootFailure.vue` pairs
  - F10's `planParsers` pair
  - G4's `tabs.go` pair
  - G5's layout pair
  - G6's `saved_queries` pair
  - G14's `queryplan` pair
- Greps:
  - `ipcerr.Internal(err.Error())` in `**/internal/bridge/*.go` (non-test): 0.
  - `func (a \*Adapter) getReadOnly` under `A/`: 0.
  - `killGroup = func` bodies re-implementing `syscall.Kill(-pid`: 0 outside `internal/procgroup`.
  - `<TooltipTrigger as-child>` directly wrapping a lone `CodiconIcon` `Button`: only the documented
    extra-children exceptions remain.
- `go.mod` shows `tool github.com/mibk/dupl` and a direct `github.com/hashicorp/golang-lru/v2`
  require.
- A closing re-run of widened S3 on the final tree finds no new pair above 0.6/4 with body ≥0.5
  among the touched files. If it does, that is a finding, fixed in this same phase.
