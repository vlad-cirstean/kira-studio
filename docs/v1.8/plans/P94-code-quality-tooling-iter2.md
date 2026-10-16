# P94 pass 2 — Go complexity: `gocognit`/`gocyclo` at 30, and the 49 refactors that get there

Pass 1's plan (`P94-code-quality-tooling.md`) sketched this pass in its §11. That sketch is a
starting point, not a brief: everything below was **re-measured against the current tree**
(`claude/v1-8-p82-p83-implementation-ocpvj1` at `cb7c5aca`, pass 1 landed), and two of §11's own
claims turned out to be wrong. Corrections are in §0 and §2.

Every count here is a real number from a real run in this container. Every one of the 49 functions
was read in full before its strategy was written.

Scope: add `gocognit` and `gocyclo` to `.golangci.yml` at `min-complexity: 30`, `_test.go` exempt,
and drive both to zero findings in the same pass. Nothing else.

## 0. What pass 1 left open, and what re-measurement changed

| Open / found | Resolution | Where |
|---|---|---|
| §11 says "47 + 4 non-test functions" | **Wrong. It is 49 distinct non-test functions**: 46 `gocognit`, 22 `gocyclo`, 19 flagged by both. Pass 1's number came from a capped/deduplicated run | §1 |
| §11 says "pass 1's `gocritic` fixes will have moved some scores" | **They moved nothing.** Measured at pass 1's own base commit (`f7b51382`, via a throwaway worktree) and at `cb7c5aca`: byte-identical finding sets, same 49 functions, same scores. `unused`/`prealloc`/`gocritic`/`copyloopvar` fixes do not touch branch counts. Do not re-measure hoping for a discount | §2 |
| — | **`golangci-lint` v2 defaults `issues.uniq-by-line: true`**, which drops a finding whose file+line another linter already reported. `gocyclo` reads **4** findings under the default and **32** with it off: 28 were hidden behind a `gocognit` finding on the same `func` line. This is a second truncation trap on top of pass 1's `max-issues-per-linter`/`max-same-issues` one, and it bites exactly this pass, because both new linters report on the same line by construction. Config sets it `false` | §1, §3 |
| Does the `_test.go` exemption matter, or is it cosmetic? | **It matters.** 24 `gocognit` + 10 `gocyclo` findings live in `_test.go` files. Without the exclusion this pass grows by a third, into table-driven test bodies the whole point of the exemption is to leave alone | §1, §3 |
| Threshold | **30**, not re-argued. Pass 1 §4.2 settled it | §3 |
| Do any findings only appear on macOS? CI's `checks` job runs there | **No.** A `GOOS=darwin` run returns the identical 49 functions with identical scores. No build-tag-split file is over threshold on either platform | §10 |
| Does pass 2 touch anything pass 1 deferred? | **No.** Confirmed explicitly in §12 | §12 |
| One subagent or several? | **One sequential Sonnet subagent.** Reasoned in §8, including why the one plausible split is still the wrong call | §8 |
| Do the 19 both-flagged functions need two separate fixes? | **No, but they need two checks.** Cognitive and cyclomatic weight nesting differently, so an extraction that clears one can leave the other at 30+. Every one of the 19 must be verified against both linters, not just the one that was louder | §4 |

---

# 1. The measured scope

`golangci-lint` v2.13.2 (pass 1's `scripts/install-golangci-lint.sh` binary, `built with go1.27.1`),
both linters at `min-complexity: 30`, `--max-issues-per-linter=0 --max-same-issues=0`,
`uniq-by-line: false`, against `cb7c5aca`:

| Linter | Total | Non-test | `_test.go` |
|---|---|---|---|
| `gocognit` | 70 | **46** | 24 |
| `gocyclo` | 32 | **22** | 10 |
| Distinct non-test functions (union) | — | **49** | — |

Overlap, non-test: **19** functions flagged by both, **27** by `gocognit` only, **3** by `gocyclo`
only (`(*Router).ForConn`, `ClassifyOpError`, `StripSQLComments` — all three are flat dispatch, wide
but shallow, which is exactly the shape cyclomatic punishes and cognitive does not).

Total body size of the 49: **6,218 lines**. This is the pass.

By package, non-test:

| Count | Package |
|---|---|
| 4 | `internal/adapters/mongo`, `internal/adapters/mysqlfamily`, `internal/codegraph`, `internal/storage/repos` |
| 3 | `internal/adapters/postgres`, `internal/adapters/redis`, `internal/adapters/sqlite` |
| 2 | `internal/adapters`, `internal/adapters/kafka`, `internal/gitsearch`, `internal/grpcclient` |
| 1 | `main.go`, `internal/adapters/clickhouse`, `internal/adapters/testsupport`, `internal/connections`, `internal/datagrip`, `internal/dbmcp`, `internal/gitclient/logsession`, `internal/gitops`, `internal/gitprepare`, `internal/gitreview`, `internal/gitrpc`, `internal/gitsession`, `internal/httpclient`, `internal/ipcfixture`, `internal/queryplan`, `internal/storage/model` |

Every function, worst first. `cog`/`cyc` are the measured scores; `-` means that linter did not
flag it. §5 carries the strategy for each.

| cog | cyc | Function | Location |
|---|---|---|---|
| 144 | 69 | `(*SettingsRepo).Set` | `internal/storage/repos/settings.go:87` |
| 134 | 58 | `MaskContinuationTokens` | `internal/ipcfixture/frozen.go:328` |
| 107 | 57 | `runStatement` | `internal/adapters/mongo/console.go:217` |
| 91 | 40 | `(*VariablesRepo).ApplyBulk` | `internal/storage/repos/variables.go:687` |
| 89 | 52 | `main` | `main.go:80` |
| 76 | 55 | `readPage` | `internal/adapters/mongo/read.go:54` |
| 72 | 41 | `readTopic` | `internal/adapters/kafka/read.go:280` |
| 67 | 36 | `tokenize` | `internal/adapters/mongo/literal.go:84` |
| - | 65 | `(*Router).ForConn` | `internal/gitrpc/handlers.go:93` |
| 64 | 34 | `buildDefinition` | `internal/adapters/postgres/definition.go:64` |
| 61 | - | `mutateDB` | `internal/adapters/mongo/mutate.go:87` |
| 59 | 32 | `(*Graph).ReferencesTo` | `internal/codegraph/references.go:94` |
| 55 | - | `RunMatrix` | `internal/adapters/testsupport/matrix.go:87` |
| 52 | 38 | `(*Graph).resolveName` | `internal/codegraph/resolve.go:308` |
| 49 | 35 | `translate` | `internal/gitsearch/dialect.go:24` |
| 47 | - | `(*Session).ReadPage` | `internal/gitclient/logsession/session.go:122` |
| - | 46 | `ClassifyOpError` | `internal/gitops/errors.go:15` |
| 45 | 33 | `readPage` | `internal/adapters/postgres/read.go:77` |
| 44 | 33 | `Send` | `internal/httpclient/client.go:208` |
| 43 | 33 | `(Input).Validate` | `internal/connections/input.go:41` |
| 42 | - | `freshWindows` | `internal/adapters/kafka/read.go:136` |
| 42 | 31 | `firstTopLevelSemicolon` | `internal/adapters/sqlite/query.go:30` |
| 42 | - | `BuildConfig` | `internal/adapters/mysqlfamily/client.go:29` |
| 41 | - | `mutateDB` | `internal/adapters/redis/mutate.go:110` |
| 40 | - | `Scan` | `internal/gitsearch/scan.go:82` |
| 40 | 32 | `readPage` | `internal/adapters/sqlite/read.go:103` |
| 39 | - | `readPage` | `internal/adapters/mysqlfamily/read.go:79` |
| 38 | 34 | `(SettingsPatch).Validate` | `internal/storage/model/settings.go:276` |
| 36 | 32 | `(*Server).runQuery` | `internal/dbmcp/tools.go:175` |
| 36 | - | `resolveReflection` | `internal/grpcclient/reflect.go:177` |
| 35 | - | `mutate` | `internal/adapters/postgres/mutate.go:67` |
| 35 | - | `mutate` | `internal/adapters/sqlite/mutate.go:63` |
| 35 | - | `mutate` | `internal/adapters/mysqlfamily/mutate.go:62` |
| 35 | - | `(*RepoEntry).RunRestack` | `internal/gitsession/stack.go:716` |
| 35 | - | `listNamespaceChildren` | `internal/adapters/redis/catalog.go:143` |
| 35 | - | `readScanFamily` | `internal/adapters/redis/read.go:90` |
| 35 | - | `(*Graph).containmentImplementationsOf` | `internal/codegraph/implementations.go:112` |
| 35 | - | `ServerStream` | `internal/grpcclient/call.go:163` |
| 34 | - | `ParseProject` | `internal/datagrip/datasources.go:99` |
| 34 | - | `stripANSI` | `internal/gitprepare/output.go:80` |
| 33 | - | `(*GitRepoSettingsRepo).Set` | `internal/storage/repos/gitreposettings.go:87` |
| 33 | - | `(*VariablesRepo).Upsert` | `internal/storage/repos/variables.go:384` |
| 33 | - | `(*Graph).goInterfacesSatisfiedBy` | `internal/codegraph/methodsets.go:379` |
| - | 32 | `StripSQLComments` | `internal/adapters/errors.go:247` |
| 31 | - | `listConstraints` | `internal/adapters/mysqlfamily/definition.go:19` |
| 31 | - | `resolveTarget` | `internal/adapters/clickhouse/client.go:59` |
| 31 | - | `BuildKeysetPosition` | `internal/adapters/sqltext.go:444` |
| 31 | - | `ResolveBase` | `internal/gitreview/resolve.go:142` |
| 31 | - | `chBuildNode` | `internal/queryplan/clickhouse.go:91` |

---

# 2. What pass 1 actually moved: nothing

§11 told this pass to re-measure because pass 1's fixes "will have moved some scores". They did not.

Method: a throwaway `git worktree` at `f7b51382` (pass 1's base), same binary, same config, same
flags. Both runs produce the same 49 non-test functions with the same scores, file for file, line
for line. That is the expected result in hindsight — `unused` deletes whole symbols, `prealloc`
changes a `make` call, `unconvert` drops a cast, `copyloopvar` deletes a shadow line, and
`gocritic`'s performance tag rewrites expressions. None of them adds or removes a branch.

Consequence for the implementer: **the 49 in §1 are the work.** There is no shrinkage to wait for,
and no reason to re-run the measurement before starting. Re-run it *after* each commit instead
(§10).

---

# 3. The config diff

`.golangci.yml`, three hunks. Exactly this, verified with `golangci-lint config verify` (exit 0):

```diff
 linters:
   default: none
   enable:
     - bodyclose      # perf/leak: an unclosed HTTP body holds a connection. 0 findings — keeps it so.
     - copyloopvar    # Go 1.22+ made the loop-var copy redundant. 5.
+    - gocognit       # SonarSource cognitive complexity, threshold 30. 46 non-test at pass 2 start.
     - gocritic       # perf tag only, minus hugeParam + rangeValCopy. 34.
+    - gocyclo        # cyclomatic complexity, same threshold. 22 non-test at pass 2 start.
     - govet          # already run standalone; free here, and catches the same set.
     - ineffassign    # dead stores — dead code, statement level. 1.
     - makezero       # make([]T, n) then append. 0 findings — keeps it so.
     - prealloc       # perf: a growable slice with a known length. 4 (non-test).
     - unconvert      # redundant conversions. 1.
     - unused         # SPEC's Go dead-code answer, staticcheck-based. 11.
   settings:
+    gocognit:
+      min-complexity: 30
+    gocyclo:
+      min-complexity: 30
     gocritic:
       enabled-tags:
         - performance
       disabled-checks:
         - hugeParam
         - rangeValCopy
   exclusions:
     generated: lax
     rules:
       - path: _test\.go
-        linters: [prealloc]
+        linters: [gocognit, gocyclo, prealloc]
 
 issues:
   # golangci-lint truncates at 50 per linter / 3 per message by default and still
   # prints a tidy total. That hid 507 of gocritic's 541 findings on the first run
   # for this plan. Never leave these at their defaults.
   max-issues-per-linter: 0
   max-same-issues: 0
+  # Same trap, second mechanism: the default drops a finding whose file+line another
+  # linter already reported, which hid 28 of gocyclo's 32 behind gocognit's own
+  # finding on the same func line. Both metrics must always report independently.
+  uniq-by-line: false
```

Eleven linters after this, which is what pass 1 §4.1 committed to for the phase.

**Landing order.** The two linters go into `enable:` **only in the commit after the last refactor**
(§7 commit 27), the same discipline pass 1 used: a linter is enabled in the commit that empties it,
never before, so every committed state is green under its own committed config. While the refactors
are in flight, measure with a scratch config outside the repo:

```
~/go/bin/golangci-lint run -c /tmp/.../measure.yml ./...
```

carrying `default: none`, only `gocognit`+`gocyclo`, both at 30, the `_test.go` exclusion,
`max-issues-per-linter: 0`, `max-same-issues: 0`, `uniq-by-line: false`.

---

# 4. The five shapes, and what each extraction must preserve

Reading all 49 bodies, they fall into five structural patterns. Naming them here keeps 49 refactors
consistent under one subagent instead of 49 ad-hoc judgements.

**(a) Optional-field patch chain.** A long run of `if patch.X != nil { … }` blocks, each independent
(`(*SettingsRepo).Set` 144, `(*GitRepoSettingsRepo).Set` 33, `(SettingsPatch).Validate` 38).
Extraction: one helper per settings *section*, taking the transaction/accumulator and that
section's pointer, returning `error`. The caller becomes a flat list of guarded calls. This is the
highest-yield, lowest-risk shape in the pass — pure mechanical redistribution, no control flow
changes at all.

**(b) Flat dispatch switch.** One `switch` with many single-purpose arms (`runStatement` 107,
`ClassifyOpError` cyc 46, `(*Router).ForConn` cyc 65). Extraction: a package-level table
(`map[string]handlerFunc`, or an ordered `[]rule` where match order is load-bearing) plus one small
function per arm. Both linters score a table lookup as 1. **Order is semantics** for
`ClassifyOpError` — its comment says eight rows were deliberately prepended so a broad pattern
cannot swallow a narrow one — so it must become an ordered slice, never a map.

**(c) Character/state-machine loop.** A `for` over runes with a state `switch` and nested
lookahead (`tokenize` 67, `translate` 49, `firstTopLevelSemicolon` 42, `stripANSI` 34,
`StripSQLComments` cyc 32). Extraction: one function per state, each returning the next index (and
state where relevant). The loop becomes a dispatch. These functions are pure and string-in/string-
out, so they are cheap to verify — but they are also where an off-by-one silently corrupts SQL
splitting, so each one gets its existing tests run before and after, and a table-driven test only
where none exists (§9).

**(d) Near-identical siblings across adapters.** Three SQL `readPage`, three SQL `mutate`, two
document-store `mutateDB`. Extraction: hoist the genuinely shared prologue into `internal/adapters`
once, consume it three times. This is the only shape that changes more than one package, and it is
why commit 1 comes first (§7).

**(e) One long linear procedure.** No repetition, just length and many small guards (`main` 89,
`Send` 44, `buildDefinition` 64, `ParseProject` 34, `resolveReflection` 36, `ResolveBase` 31).
Extraction: split at the natural phase boundaries the existing comments already mark, each phase
returning a small struct. Preserve statement order exactly — several of these have comments
explaining *why* a line sits where it does.

**For all 19 both-flagged functions:** re-measure against `gocognit` **and** `gocyclo` after the
edit. Cognitive complexity weights nesting (a `switch` inside a loop inside an `if` costs far more
than the same arms flattened), cyclomatic weights raw branch count. Flattening nesting can clear
cognitive while leaving cyclomatic untouched; the standard failure mode on this pass is declaring a
function done on the metric that was louder.

---

# 5. Function by function

Grouped by the commit that lands it (§7). Scores repeat from §1 as `cog/cyc`.

## Commit 1 — `internal/adapters` (shared)

- **`StripSQLComments`** (`errors.go:247`, `-/32`). Shape (c). One `for` with an eight-arm `switch`
  on quote/dollar-quote/line-comment/exec-comment/nested-block-comment state. Extract one function
  per arm, each `(r []rune, i int, …) (next int)`, and keep `depth`/`execComment` as explicit
  parameters/returns rather than closure state, so each arm is independently testable. Nested
  `/* */` depth counting is the subtle part — preserve it exactly.
- **`BuildKeysetPosition`** (`sqltext.go:444`, `31/-`). Shape (e). Extract the `keysetValuesOf`
  closure to a package-level func taking `KeysetPositionArgs`, and split the `switch` on
  `Cursor.Mode` (`before`/`after`/default) into one `nextPrevTokens` helper returning both pointers.
  The `hasMore`/`offset` tails stay inline.
- **New, consumed by commits 2-4:** `PlanRelationalPage(args) (relationalPagePlan, error)` covering
  the prologue that postgres/mysqlfamily/sqlite `readPage` share verbatim — `ResolveProjection`,
  tiebreaker selection, `ComputeEffectiveOrder`, `AssertKeysetSupported`, `ResolveFetchColumns`,
  `[]page.ColumnDescriptor` construction, `RequestFingerprint`, `reverseRows`, `BuildScanOrderBy`.
  Parameterize the three real differences: an extra tiebreaker candidate (sqlite's `RowidColumn`,
  its third fallback), the optional fetch-columns callback (sqlite passes one, the others `nil`),
  and `quoteIdent`. SQL text assembly, parameter binding and row streaming stay in each adapter —
  those genuinely differ (`$N` vs `?`, `[]*string` vs `[]any`, three different `streamArrayQuery`
  signatures) and forcing them into one helper would trade complexity for indirection.
- **New, consumed by commits 2-4:** `ValidateMutationOps` and `CompileMutationOps` covering the
  other verbatim-shared block — the `switch rowOp.Kind` validation loop (`update`/`delete`/insert
  default) and the `OrderedOps` → `compiledOp` + `previewParts` loop. Placeholder rendering is
  already parameterized through `NewParamRenderer`, so this hoists cleanly.

## Commit 2 — `internal/adapters/postgres`

- **`buildDefinition`** (`definition.go:64`, `64/34`). Shape (e). Five sequential catalog queries
  (relation metadata, columns, constraints, indexes, comments) each with its own `pgx.Rows`
  callback, wrapped in one `if objectKind == "table"` / `else` fork. Extract one function per query
  — `fetchRelationMeta`, `fetchColumns`, `fetchConstraints`, `fetchIndexes`, `fetchComments` —
  each returning its own slice plus `error`. `buildDefinition` becomes the sequence plus the
  table/non-table fork. Statement assembly order drives the emitted DDL text, so keep the append
  order identical.
- **`readPage`** (`read.go:77`, `45/33`). Shape (d). Replace the prologue with commit 1's
  `PlanRelationalPage`; extract the keyset-`WHERE` construction (the 22-line `if wantsKeyset` block
  that calls `addParam`) into `buildKeysetWhere`, and the `sqlParts` assembly into `buildPageSQL`.
  The streaming callback stays.
- **`mutate`** (`mutate.go:67`, `35/-`). Shape (d). Replace the validation loop and the compile loop
  with commit 1's two helpers. What remains is transaction control: `BEGIN`, the `committed`/
  `defer` rollback guard, the exec loop, `COMMIT`. **Do not move the `defer` into a helper** — its
  comment records a real bug (a cancelled ctx leaving the pinned connection inside an open
  transaction) and it must stay lexically in the function that owns the transaction.

## Commit 3 — `internal/adapters/mysqlfamily`

- **`BuildConfig`** (`client.go:29`, `42/-`). Shape (e). Three phases: the fixed `mysql.Config`
  field block, the URI-vs-fields options merge, and the `sslmode` `switch`. Extract
  `applyFixedDefaults`, `resolveOptions` (returning `map[string]any`), and `applyTLS`. The comment
  block on `ClientFoundRows` explains a real MySQL/MariaDB semantic difference — carry it with the
  field, do not orphan it.
- **`readPage`** (`read.go:79`, `39/-`) and **`mutate`** (`mutate.go:62`, `35/-`). Shape (d),
  identical treatment to commit 2's pair, over commit 1's helpers. `mutate` additionally threads
  `threadID` through `execFor` — keep that in the adapter, not the shared helper.
- **`listConstraints`** (`definition.go:19`, `31/-`). Shape (e). Two queries then a 38-line
  correlation loop turning `constraintRow` + `keyColumnRow` into `[]model.ConstraintMeta`. Extract
  the correlation loop body into `constraintMetaFor(c constraintRow, cols []keyColumnRow)`.

## Commit 4 — `internal/adapters/sqlite`

- **`firstTopLevelSemicolon`** (`query.go:30`, `42/31`). Shape (c). Already an explicit state
  machine (`normal`/`lineComment`/`blockComment`/`single`/`double`/`backtick`) — one function per
  state, each returning `(nextIndex int, nextState int, found bool)`. Purest mechanical case in the
  pass. Both metrics must be re-checked (it is a both-flagged function).
- **`readPage`** (`read.go:103`, `40/32`) and **`mutate`** (`mutate.go:63`, `35/-`). Shape (d). As
  commit 2, with sqlite's own two differences passed into `PlanRelationalPage`: the `RowidColumn`
  third tiebreaker case, and the fetch-columns callback. `mutate` uses `execLiteral` rather than an
  `execCommand` closure and `BEGIN IMMEDIATE` rather than `BEGIN` — both stay.

## Commit 5 — `internal/adapters/mongo`

- **`runStatement`** (`console.go:217`, `107/57`). Shape (b), the cleanest table candidate in the
  pass: ten arms (`find`, `findOne`, `insertOne`, `insertMany`, `updateOne`, `updateMany`,
  `deleteOne`, `deleteMany`, `countDocuments`, `aggregate`) plus a default error. Each arm becomes
  `func(ctx, *mongodriver.Collection, parsedStatement, *adapters.OpCtx) (result, error)`, registered
  in a package-level `map[string]statementRunner`. The default arm becomes the map miss.
- **`readPage`** (`read.go:54`, `76/55`). Shape (e), long. Phases already marked by comments:
  sort/keyset eligibility resolution, keyset filter construction (the 22-line `if idOnlySort &&
  wantsKeyset` block), find-options assembly (projection, sort, skip), execution, then the
  reverse/probe/token tail. Extract four helpers along those lines. The `_id`-only-sort rule and the
  `reverseRows` handling are what make `before` cursors correct — extract them whole, do not
  restructure.
- **`tokenize`** (`literal.go:84`, `67/36`). Shape (c). An 89-line rune loop. One function per token
  class (string, number, identifier/keyword, punctuation, operator), each returning the consumed
  width and a `token`. Both-flagged: check both metrics.
- **`mutateDB`** (`mutate.go:87`, `61/-`). Shape (b)+(d). The per-op `switch` has three arms
  (`update`, `delete`, insert-by-default) with 30/20/25-line bodies. Extract `applyUpdate`,
  `applyDelete`, `applyInsert`, each returning `(affected int, err error)`. The `$document`
  sentinel the insert and update arms share must stay one constant, referenced by both.

## Commit 6 — `internal/adapters/redis`

- **`mutateDB`** (`mutate.go:110`, `41/-`). Same three-arm extraction as mongo's, with redis's own
  `NX` semantics on insert (the comment explains why a brand-new key must not silently overwrite —
  keep it on the extracted function).
- **`listNamespaceChildren`** (`catalog.go:143`, `35/-`). Shape (e). A `SCAN` round loop (65 lines)
  then a sort/assemble tail. Extract the round body into `scanRound` and the assembly into
  `buildNamespaceNodes`. The `cursor != 0 && rounds >= maxScanRounds` truncation test is a recorded
  fix (P43 iter2 F16/D21) — it stays in the caller, where both values are in scope.
- **`readScanFamily`** (`read.go:90`, `35/-`). Shape (e). Extract the cursor-decode block
  (`req.Cursor.Mode == "after"`, 32 lines) and the scan loop body. `pairSize == 1` vs `2` changes
  row accounting; keep that branch in the caller.

## Commit 7 — `internal/adapters/kafka` — **high risk, see §6**

- **`readTopic`** (`read.go:280`, `72/41`). Shape (e), concurrency-adjacent. Extract:
  `prepareWindows` (the `after`-cursor vs fresh fork, plus `remaining` filtering),
  `openBrowseClient`, and the 66-line poll-round body as `pollRound`. `exhaustedByEmptyPolls` and
  the post-loop clamp must remain in `readTopic` — their 12-line comment records exactly why the
  latch and the clamp sit where they do (P21 round 3 finding 3). Extracting the loop body is fine;
  extracting the latch is not.
- **`freshWindows`** (`read.go:136`, `42/-`). Shape (e). Extract the partition filter block (21
  lines) and the `switch` on `filter.TimestampMs`/`filter.Offset` into
  `resolveStartOffsets`. Every `ListedOffsets.Error()` check must survive — the comment notes a
  nonexistent topic surfaces only there.

## Commit 8 — `internal/adapters/clickhouse`

- **`resolveTarget`** (`client.go:59`, `31/-`). Shape (e). Extract the URI-parse branch (31 lines)
  as `targetFromURI` and the fields branch as `targetFromFields`, both returning the same five
  pointers; keep the `sslmode` `switch` as `resolveScheme`. Defaults (`8123`, `default`) stay in the
  caller so there is one place they are applied.

## Commit 9 — `internal/adapters/testsupport` — **elevated care, see §6**

- **`RunMatrix`** (`matrix.go:87`, `55/-`). Shape (e). One 63-line `for _, c := range cases` body
  containing the whole per-case harness. Extract the body into `runMatrixCase(t, …)`. `t.Helper()`
  must be called in the extracted function as well as the caller, or every conformance failure
  starts reporting `matrix.go`'s line instead of the real assertion's.

## Commit 10 — `internal/storage/repos` + `internal/storage/model`

- **`(*SettingsRepo).Set`** (`settings.go:87`, `144/69`). Shape (a), the worst score in the repo and
  the easiest fix. Nine independent section blocks (`Appearance`, `Data`, `Cache`, `Advanced`,
  `Git`, `Api`, `CodeIntel`, `DbMcp`, `ClaudeCode`). One `upsertXSection(tx, *X) error` each; `Set`
  becomes `Begin` → nine guarded calls → `Commit` → `GetAll`. Keep the `defer tx.Rollback()
  //nolint:errcheck` exactly as-is.
- **`(SettingsPatch).Validate`** (`model/settings.go:276`, `38/34`). Shape (a), mirror of the above
  and in the same commit deliberately: the two functions enumerate the same sections, and splitting
  them across commits invites divergent section naming. One `validateX(*X) error` per section.
- **`(*GitRepoSettingsRepo).Set`** (`gitreposettings.go:87`, `33/-`). Shape (a). Ten single-leaf
  `if patch.X != nil` blocks, each four lines. A `[]leafUpsert{name, has, value}` table plus one
  loop is the natural form here, since every block is literally the same three statements.
- **`(*VariablesRepo).ApplyBulk`** (`variables.go:687`, `91/40`). Shape (e), the hardest in this
  commit. Five phases the comments already name (load existing, per-entry apply, delete
  unreferenced, detect reorder-only, renumber `sort_order`). Extract one function per phase, with
  the per-entry loop body (85 lines) as its own `applyBulkEntry`. D22 rules 4 and 5 are cited by
  name in the comments — carry those citations onto the extracted functions.
- **`(*VariablesRepo).Upsert`** (`variables.go:384`, `33/-`). Shape (e). Extract the insert branch
  (`id == ""`, 30 lines) as `insertVariable` and the secret-transition history purge as
  `purgePlaintextHistory`. The Finding-1 comment on that purge is a security note — keep it verbatim
  with the code it explains.

## Commit 11 — `internal/codegraph`

- **`(*Graph).ReferencesTo`** (`references.go:94`, `59/32`). Shape (e). The 69-line `for _, r :=
  range refRows` body is the whole problem. Extract it as `classifyRefRow`, with `groupTargets`
  memoization passed in as a small struct rather than three separate maps. The `IncludeDefinition`
  tail extracts cleanly too.
- **`(*Graph).resolveName`** (`resolve.go:308`, `52/38`). Shape (e). Extract candidate construction
  (the 24-line row loop), the `read`-kind locality clamp, the Go unexported-name clamp, and the
  same-receiver marking — each is already a commented, self-contained rule. P69b and P79 both cite
  this function; preserve the ordering (`filterTier` before receiver marking, for the reason the
  comment gives).
- **`(*Graph).containmentImplementationsOf`** (`implementations.go:112`, `35/-`). Forward and
  reverse halves are independent; one function each, sharing the `add`/`seen` dedupe closure passed
  as a parameter.
- **`(*Graph).goInterfacesSatisfiedBy`** (`methodsets.go:379`, `33/-`). Extract the 38-line
  per-method-name body as `interfacesForMethod`. Deterministic ordering (`sort.Strings(names)`)
  stays in the caller.

## Commit 12 — `internal/gitrpc` — **high risk, see §6**

- **`(*Router).ForConn`** (`handlers.go:93`, `-/65`). Shape (b). Nothing here is deeply nested —
  it is one 127-line `Handlers{…}` literal of closures, which is why only `gocyclo` fires. Strategy:
  introduce an unexported `connHandlers struct { r *Router; c *gitsession.Conn; … }`, move each
  closure body to a method on it, and build the literal from method values. `ForConn` keeps the
  subscription, the drop-oldest `select`, both goroutines and the unsubscribe wiring, and ends with
  a `Handlers{…}` of one-line method references.
  **Preserve exactly:** the `settingsQueue` capacity and the `default:` drop arm, the number of
  goroutines, and the guarantee that `unsubscribeRepoSettings` is called exactly once. Any closure
  that today captures a per-call local rather than `r`/`c` must keep capturing that local — check
  each one individually rather than assuming the struct can hold it.

## Commit 13 — `internal/gitops`

- **`ClassifyOpError`** (`errors.go:15`, `-/46`). Shape (b), 24-arm `switch` of
  `strings.Contains(lower, …)` tests. Convert to a package-level **ordered** `[]classifyRule{match
  func(string) bool, kind string, message func(string) string}` and a 4-line loop. Order is
  load-bearing and documented (eight G7 D14/F18 rows prepended so "not found" cannot swallow
  `RemoteNotFound`) — a map would break it silently. The `_ = exitCode` line and its comment stay.

## Commit 14 — `internal/gitsearch`

- **`translate`** (`dialect.go:24`, `49/35`). Shape (c). Six-arm `switch` inside the rune loop
  (escape, `.`, `(`, `[`, `]`, default) with `inClass` state. One function per arm returning the
  next index. Both-flagged: check both.
- **`Scan`** (`scan.go:82`, `40/-`). Shape (e). The 76-line `for {}` body is the whole score.
  Extract as `scanRound`, returning whether to continue. Budget/deadline checks stay in the caller.

## Commit 15 — `internal/gitclient/logsession` — **elevated care, see §6**

- **`(*Session).ReadPage`** (`session.go:122`, `47/-`). Shape (e), stateful under a held mutex.
  Extract `drainPendingLocked` (the first loop) and `fillLocked` (the 41-line lookahead loop),
  **both named with the `Locked` suffix** the file already uses, and both called with `s.mu` still
  held by `ReadPage`. Do not move `s.mu.Lock()`/`defer s.mu.Unlock()` or
  `disarmReclaimLocked()` out of `ReadPage`. The `!s.eof` condition on the respawn guard and the
  lookahead's exit condition are G16 D6/F5/F6 fixes — copy them verbatim.

## Commit 16 — `internal/gitsession` — **elevated care, see §6**

- **`(*RepoEntry).RunRestack`** (`stack.go:716`, `35/-`). Shape (e). Extract `restackPrepare`
  (preflight + refs snapshot + config + HEAD, returning one struct), the 39-line per-entry rebase
  loop body, and `restoreHead`. **The three `defer`s stay in `RunRestack`**: the `restack.claim`
  release, `invalidateAfterWrite`, and the cancel. Moving any of them into a helper changes when it
  runs. `e.undo.Set(undo)` must still happen after the HEAD restore and before the result is built.

## Commit 17 — `internal/gitprepare`

- **`stripANSI`** (`output.go:80`, `34/-`). Shape (c). A 44-line byte loop recognising CSI/OSC/
  two-byte escapes. One function per escape class returning the consumed width. The
  `!strings.ContainsRune(s, 0x1b)` fast path stays first.

## Commit 18 — `internal/gitreview`

- **`ResolveBase`** (`resolve.go:142`, `31/-`). Shape (e). Two halves: base resolution (upstream,
  then the 18-line fallback chain) and candidate collection (the `push` closure plus four append
  loops). Extract `resolveBaseRef` and `collectCandidates`. `Reason` values are surfaced in the UI
  — each branch must keep producing the same one.

## Commit 19 — `internal/httpclient`

- **`Send`** (`client.go:208`, `44/33`). Shape (e), heavily commented, every comment load-bearing.
  Extract `prepareRequest` (URL, timeout ctx, timeline, context values, body/boundary resolution),
  `applyHeaders` (the user-header loop, the `Host` special case, the User-Agent default, the
  Content-Type `switch`), and `readResponseBody` (limit reader, truncation, UTF-8 detection).
  **Order is the correctness property here:** the `httputil.DumpRequestOut` call must stay strictly
  between header application and `httptrace.WithClientTrace` — the comment explains that attaching
  the trace earlier records the dump's fake connection as a real one. Keep those three statements
  adjacent in `Send` itself.

## Commit 20 — `internal/connections`

- **`(Input).Validate`** (`input.go:41`, `43/33`). Shape (a). Ten independent guards then a
  `fields`/`uri` mode fork. Group into `validateIdentity`, `validateLimits`, `validateMcp`, and
  `validateMode`. Every error string is asserted somewhere — do not reword any of them.

## Commit 21 — `internal/dbmcp`

- **`(*Server).runQuery`** (`tools.go:175`, `36/32`). Shape (e). Extract `resolveVerdict` (modes,
  classification, the verdict `switch`), `maybeExplain` (the auto-explain block), and
  `awaitApproval` (the four-arm approval `switch`). The "at most one approval prompt per call" rule
  and the `ApprovalReasonPermission` precedence are §5.2/§6.2 decisions — they live in
  `awaitApproval`, with the comment.

## Commit 22 — `internal/grpcclient` — **`ServerStream` elevated care, see §6**

- **`resolveReflection`** (`reflect.go:177`, `36/-`). Shape (e). The recursive `link` closure (34
  lines) becomes a method on a small `linker` struct holding `reg`/`known`/`linked`. That alone
  clears it.
- **`ServerStream`** (`call.go:163`, `35/-`). Shape (e). Extract `openStream` (dial, metadata,
  request unmarshal, `NewStream`, `SendMsg`, `CloseSend`) and the 42-line recv loop as `recvLoop`.
  **Partial results must survive an error**: several arms today return a populated `CallResult`
  alongside a non-nil error. `recvLoop` must return the accumulated messages and counts on every
  path, not just the clean one.

## Commit 23 — `internal/ipcfixture` — **elevated care, see §6**

- **`MaskContinuationTokens`** (`frozen.go:328`, `134/58`). Shape (b), disguised. One
  `switch v.(type)` with a 157-line `map[string]any` arm that is really a long list of
  field-name-specific masking rules plus recursion. Convert to a package-level table of
  `{key string, mask func(any) any}` (or `{match func(string) bool, …}` where a rule is
  prefix/suffix based) and a short recursive walk over map and slice. **Byte-identical output is
  the acceptance test** — the frozen fixtures are compared literally, so key iteration order,
  which keys get masked, and the replacement values must all be unchanged.

## Commit 24 — `internal/datagrip`

- **`ParseProject`** (`datasources.go:99`, `34/-`). Shape (e). Extract `readSharedDoc`,
  `readLocalDoc` (including the `localByUUID`/`createdIn` build) and the 18-line component loop as
  `dataSourcesFrom`. The `filepath.Dir(ideaDir)` comment explains a real macro-expansion bug — keep
  it on the line it describes.

## Commit 25 — `internal/queryplan`

- **`chBuildNode`** (`clickhouse.go:91`, `31/-`). Shape (e). The 33-line
  `if nodeType == "ReadFromMergeTree"` block is the score. Extract as `chMergeTreeIssues`. Recursion
  over `typed.Plans` stays in the caller.

## Commit 26 — `main.go` — **high risk, see §6**

- **`main`** (`main.go:80`, `89/52`). Shape (e), 633 lines of wiring. Extract along the boundaries
  the existing comments already draw, each returning a struct of what it built:
  `openCore` (config layout, logging, DB, cipher, authorizer, repos), `wireGit` (runner, discovery,
  registry, settings closure, askpass broker, router, socket), `wireAdapters` (adapter deps, cache,
  router, connections, tree, oplog, sweeps, maintenance, metrics), `wireEmbeddedServices` (repo-map,
  DB MCP, code workspace, agent hooks, keep-awake, terminal), `wireWindows` (window registry, close
  flush, teardown/quitter, the three window closures).
  **Construction order is load-bearing and documented at nearly every step** — the askpass shim
  must return before anything Wails-related runs; `gitRouter` is hoisted so the native stream shares
  one handler table; the deferred emitter/dialogs/browser exist because `application.New` needs the
  services that need the `*App`; `primaryWorkArea` must be resolved per call, not captured. Move
  statements, never reorder them. If a phase boundary would force a reorder, move the boundary.

---

# 6. The functions that are genuinely risky

Most of the 49 are mechanical. Seven are not, and they get named here so the implementing subagent
treats them differently rather than at the same pace as an `if`-chain split.

**Concurrency / lifecycle:**

1. **`(*Router).ForConn`** (gitrpc, commit 12) — two goroutines, a `Subscribe` whose unsubscribe
   must fire exactly once, and a bounded channel with an explicit drop-oldest `default:` arm. Moving
   closure bodies to methods changes what each one captures. Verify per closure, not in bulk.
2. **`readTopic`** (kafka, commit 7) — a poll loop whose empty-poll latch and post-loop clamp encode
   a specific bug fix (P21 round 3 finding 3): a partition whose remaining gap is all non-data
   offsets otherwise latches `hasMore` true forever. Extract the round body; leave the latch.
3. **`(*Session).ReadPage`** (logsession, commit 15) — every statement runs under a held mutex, and
   the lookahead loop's exit condition is the fix for a page that fills exactly at the walk's last
   record. `Locked`-suffixed helpers, mutex stays in the caller.
4. **`(*RepoEntry).RunRestack`** (gitsession, commit 16) — a cancellation claim, three `defer`s
   whose timing matters, and an undo slot written at one specific point. Defers stay put.
5. **`ServerStream`** (grpcclient, commit 22) — partial results are returned *with* errors on
   several paths. An extracted recv loop that returns `nil, err` on failure silently changes what
   the UI shows for a stream that failed halfway.

**Behaviour-preservation is subtle:**

6. **`MaskContinuationTokens`** (ipcfixture, commit 23) — the frozen IPC fixtures are compared
   literally. A rule table that masks one extra key, or one fewer, fails as a diff far from the
   change. Run the fixture tests before and after and diff the generated fixtures, not just the
   test result.
7. **`main`** (commit 26) — the highest blast radius in the pass and the lowest payoff. Nothing
   catches a reordering here except the app failing to boot, which the Go test suite does not
   exercise. Build and launch once after this commit.

**Also elevated, for a different reason: `RunMatrix`** (testsupport, commit 9). It is a non-test
file, so it is in scope, but it is the harness `CLAUDE.md` explicitly protects — the adapter
conformance suites are the sole successor to the deleted `db-fixtures` specs. A wrong `t.Helper()`
chain does not fail anything; it just makes every future conformance failure point at the harness
instead of the assertion. Check the reported line on a deliberately failing case.

For all seven plus `RunMatrix`: **run that package's own tests immediately after the commit**, not
only in the end-of-pass sweep. They are cheap (`go test ./internal/gitrpc/...` and friends), and a
regression found three commits later costs far more than the 20 seconds.

---

# 7. Order of work — 28 commits

Rules: each commit is one package or one tightly coupled pair; the tree builds and tests pass at
every commit; the shared extraction lands before its three consumers; the linters are enabled only
once their findings are zero; `main.go` goes last among the refactors because it touches every
constructor the earlier commits may have moved.

| # | Commit | Funcs |
|---|---|---|
| 1 | `refactor(adapters): extract shared relational page and mutation helpers` | 2 + new helpers |
| 2 | `refactor(postgres): split readPage, mutate and buildDefinition` | 3 |
| 3 | `refactor(mysqlfamily): split readPage, mutate, BuildConfig and listConstraints` | 4 |
| 4 | `refactor(sqlite): split readPage, mutate and the statement splitter` | 3 |
| 5 | `refactor(mongo): table-dispatch runStatement, split readPage, tokenize and mutateDB` | 4 |
| 6 | `refactor(redis): split mutateDB, listNamespaceChildren and readScanFamily` | 3 |
| 7 | `refactor(kafka): extract the poll round and window resolution` | 2 |
| 8 | `refactor(clickhouse): split target resolution` | 1 |
| 9 | `refactor(testsupport): extract the per-case matrix body` | 1 |
| 10 | `refactor(storage): split the settings and variables write paths` | 5 |
| 11 | `refactor(codegraph): extract the reference and resolution loop bodies` | 4 |
| 12 | `refactor(gitrpc): move the per-connection handlers onto a struct` | 1 |
| 13 | `refactor(gitops): turn the error classifier into an ordered rule table` | 1 |
| 14 | `refactor(gitsearch): split the pattern translator and the scan loop` | 2 |
| 15 | `refactor(logsession): split the page drain and lookahead loops` | 1 |
| 16 | `refactor(gitsession): split the restack preflight, loop and head restore` | 1 |
| 17 | `refactor(gitprepare): split the ANSI stripper's escape handling` | 1 |
| 18 | `refactor(gitreview): split base resolution from candidate collection` | 1 |
| 19 | `refactor(httpclient): split request preparation, headers and body read` | 1 |
| 20 | `refactor(connections): group the input validation rules` | 1 |
| 21 | `refactor(dbmcp): split verdict, explain and approval from runQuery` | 1 |
| 22 | `refactor(grpcclient): extract the descriptor linker and the stream recv loop` | 2 |
| 23 | `refactor(ipcfixture): turn continuation-token masking into a rule table` | 1 |
| 24 | `refactor(datagrip): split project XML parsing` | 1 |
| 25 | `refactor(queryplan): extract the MergeTree issue checks` | 1 |
| 26 | `refactor(main): split app startup into wiring phases` | 1 |
| 27 | `chore: enable gocognit and gocyclo at min-complexity 30` | §3's diff |
| 28 | `docs(v1.8): record P94 pass 2` | §11's text |

26 refactor commits, 49 functions. Conventional Commits; each message ends with the two attribution
lines this session uses.

A commit whose diff gets unreadable (commits 5, 10 and 26 are the candidates) may split further —
several small commits are better than one large one, and the numbering above is an order, not a
quota. Never merge two of them, though: one package per commit is what keeps `git log` legible when
someone later asks why a function moved.

---

# 8. One subagent or several

**One sequential Sonnet subagent.** `CLAUDE.md` allows parallel subagents only when the work is
genuinely independent, and asks for the reasoning either way. Here is the reasoning.

The case *for* splitting is real but thin: commits 12-26 (git subsystems, codegraph, httpclient,
grpcclient, ipcfixture, datagrip, queryplan) share no file with commits 1-11 (adapters, storage).
Two agents could in principle run those two groups concurrently.

Four reasons not to:

1. **Commit 1's helpers are consumed by commits 2, 3 and 4.** That is a hard order dependency inside
   the adapters group, and it is exactly the case `CLAUDE.md` describes — a shared helper extracted
   from one function, reused when refactoring a related one. Splitting the adapters group is
   therefore off the table regardless, which removes most of the volume a split would buy.
2. **49 refactors of the same kind need one judgement about extraction granularity.** §4's five
   shapes exist to keep naming, helper size and "what stays in the caller" consistent. Two agents
   working from the same prose still diverge — one extracts three helpers where the other extracts
   one, and the tree ends up with two dialects of the same refactor. That is a maintainability cost
   this phase is specifically supposed to reduce.
3. **`.golangci.yml` is one file, and commit 27's green state is one global fact.** Two agents both
   reaching "zero findings" independently still need a join before the linters can be enabled, and
   whoever lands second must re-verify the whole tree anyway.
4. **`main.go` (commit 26) references constructors in nearly every package the other group touched.**
   It can only run after both halves, so a parallel split still ends in a sequential tail.

The measured volume does not force the issue either: 6,218 lines of function bodies across 26
commits, most of them mechanical. One subagent doing this in order is the right shape.

**If a split is ever forced** (context exhaustion, not speed), the only defensible seam is
commits 1-11 vs commits 12-25, with commit 26 (`main.go`) and commit 27 (`.golangci.yml`) reserved
for whichever runs last. Never split within the adapters group, and never split a single commit.

---

# 9. Tests

**No new unit tests for most of this pass.** `CLAUDE.md`'s bar is explicit and this is pure
behaviour-preserving extraction: a helper carved out of a function it is still the only caller of
does not become independently complex by moving. The existing tests are the check, and the real
proof is that they pass **unedited**.

**If a test needs editing to pass, the refactor is wrong.** Fix the code, never the test. The one
legitimate exception is a test that asserts on an unexported symbol this pass renames — then the
rename is what changes, not the assertion.

**Three functions do clear the bar and get a table-driven test if none exists**, because they are
exactly `CLAUDE.md`'s named case (a parser/splitter with several interacting rules) and this pass
rewrites their control flow into per-state functions:

- `firstTopLevelSemicolon` (sqlite) — quote, comment and backtick states interacting.
- `StripSQLComments` (`internal/adapters`) — nested block comments, dollar quoting, exec comments.
- `tokenize` (mongo literal parser).

Check first: each may already be covered. Add a test only where one genuinely is not, and only for
the state interactions, not for the trivial cases.

**`translate` and `stripANSI`** are the same shape but already have their own tests — extend those
rather than adding files.

**The adapter conformance suites** (`internal/adapters/*/*_test.go`) are the real safety net for
commits 1-9. They are exempt from the unit-test bar by `CLAUDE.md` and they exercise each adapter
capability by capability, which is precisely what a shared-helper hoist could break. Run them per
adapter commit, not only at the end.

---

# 10. Verification

**Per commit (cheap):** `go build ./...`, that package's own `go test`, and
`golangci-lint run -c <scratch measure.yml> ./<that package>/...` showing the commit's functions
gone from the list. `bun run lint` and `bun run typecheck` still run in the pre-commit hook; each
commit must be a **normal, non-bypassed** commit. A red hook gets root-caused and fixed —
`--no-verify` buys time inside an investigation and never ends one.

**For the eight functions in §6:** that package's full `go test` immediately after the commit, plus
the specific check named there (fixture diff for `MaskContinuationTokens`; a deliberately failing
conformance case for `RunMatrix`; a real app launch after commit 26).

**Once, near the end:**

- `golangci-lint` with the real committed `.golangci.yml` (all 11 linters): **0 findings**. Then the
  same run with `uniq-by-line: false` — it is already in the config, but confirm the count is
  genuinely 0 and not 0-after-deduplication.
- `GOOS=darwin golangci-lint run ./...` — CI's `checks` job is macOS. The pre-pass measurement found
  no darwin-only findings; confirm none were introduced.
- `go build ./...`, `go vet ./...`, `go test ./...`.
- `bun run lint:all` (all three tools), `bun run build`, `bun run build:vscode`.
- `bun run test:unit` — expect **1538 passed, 0 failed** (pass 1's recorded count). Any change is
  this pass's doing and gets fixed here.
- `bun run test:webview` — expect **55 passed, 0 failed**.
- `bun run test:ui` — expect pass 1's recorded result (316 tests, 4 workers: 310 passed, 2 failed,
  4 did not run). The two failures are `http-request-body.spec.ts`'s 500-byte threshold and
  `tree.spec.ts`'s 120s worker-contention timeout, both already recorded as pre-existing. **Do not
  fix them here** — pass 4 owns the flake sweep, and fixing them before pass 3's refactors land
  means doing it twice. A *new* failure is this pass's and gets fixed.
- `internal/grpcclient`'s reflection test has a known port race and commit 22 touches that package.
  If it flakes, confirm it is the recorded race (a port bind, not a descriptor-linking change)
  before attributing it to pass 4.

**Checks specific to this pass's own risk:**

1. Re-measure the full 49 after the last refactor commit and before commit 27. If any function is
   still listed, commit 27 does not land yet.
2. For each of the 19 both-flagged functions, confirm it is absent from **both** linters' output,
   not just the one that was louder.
3. `git diff --stat cb7c5aca..HEAD -- '*_test.go'` should be nearly empty — a few new table-driven
   tests from §9 and nothing else. A large test diff means tests were bent to fit.

---

# 11. `SPEC.md`'s P94 result section

Pass 1's result section stays; append a pass-2 block to it (not a new `## P94 pass 2 result`
heading — the phase is one row). Text to write, with the bracketed values filled from the real run:

> **Pass 2 — Go complexity (`docs/v1.8/plans/P94-code-quality-tooling-iter2.md`), [N] commits.**
> `gocognit` and `gocyclo` enabled at `min-complexity: 30` with `_test.go` excluded, bringing
> `.golangci.yml` to the 11 linters pass 1 scoped for the phase. Re-measured against `cb7c5aca`
> rather than trusting pass 1's §11: **49 distinct non-test functions** over threshold (46
> `gocognit`, 22 `gocyclo`, 19 both), not the 47 + 4 §11 stated — pass 1's number was taken under
> `golangci-lint` v2's `issues.uniq-by-line: true` default, which hid 28 of `gocyclo`'s 32 findings
> behind a `gocognit` finding on the same `func` line. `uniq-by-line: false` is now set in the
> config with that reason recorded inline, beside pass 1's own `max-issues-per-linter` note. Also
> re-measured at pass 1's base commit (`f7b51382`): **pass 1's fixes moved zero complexity scores**
> — identical finding sets — so §11's "pass 1's gocritic fixes will have moved some scores" was
> wrong; `unused`/`prealloc`/`gocritic`/`copyloopvar` do not add or remove branches. All 49
> refactored, one commit per package, worst first, shared relational read/mutate helpers hoisted
> into `internal/adapters` first so the three SQL adapters consume one copy. [Risk notes for
> whichever of §6's eight needed them.] Verification: `golangci-lint` 0 findings across all 11
> linters, `GOOS=darwin` likewise; `go build`/`go vet`/`go test ./...` clean; `bun run lint:all`
> clean; `test:unit` [N] passed, `test:webview` [N] passed, `test:ui` [N]. None of pass 1's
> deferred items touched: no `errcheck`/`staticcheck` (P95 owns them), no Biome complexity rule, no
> `knip` `exports`/`types`, none of §11's named pass-4 flakes.

No `ARCHITECTURE.md` change: this pass adds no app behaviour and no new limitation. No "Known open
items" entry — pass 2 leaves nothing open that is not already a named later pass.

No new `SPEC.md` row. Pass 2 defers nothing new, so there is nothing to open as its own phase.

---

# 12. Out of scope — confirmed, not forgotten

Pass 1 deferred five things by name. **Pass 2 touches none of them**, and the check is explicit
rather than assumed:

- **`errcheck` (220 findings) and `staticcheck` (49).** Already opened as `P95` with its own SPEC
  row and reason. Not enabled here, not partially fixed here.
- **Biome's `noExcessiveCognitiveComplexity`** and the TS/Vue side generally. Pass 3 (`-iter3.md`).
  This pass is Go only — no `biome.json` change at all.
- **`knip`'s `exports`/`types` findings** and dropping `--include` from `lint:dead`. Pass 3.
- **The named test flakes** (`cell-editor`, `grpc-request`, `sql-schema`, `http-request-body`,
  `repo-workspace`, `scroll-trace`, the Monaco timeout, `internal/grpcclient`'s port race) and the
  two long-standing Biome warnings. Pass 4 (`-iter4.md`). §10 says to record what fails, not fix it.
- **Lowering the threshold below 30.** Pass 1 §4.2 settled the number; a later phase may ratchet it.
  This pass enforces 30 with zero findings, which is complete, not partial.

Two more, specific to this pass:

- **No behaviour changes.** Every one of the 49 is an extraction. A bug noticed while reading one of
  these functions gets recorded, not fixed inline — it is a different change with a different risk
  profile, and burying it in a 6,000-line refactor pass makes it invisible in review. If it is
  serious, it becomes its own named phase per `CLAUDE.md`.
- **No test-file complexity work.** 24 `gocognit` + 10 `gocyclo` findings live in `_test.go` files
  and stay excluded. Table-driven test bodies are supposed to be long and flat.
