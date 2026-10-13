# P275 plan: memory ranking: real scoring, full-text and vector fusion, recall bias

Ask (SPEC row P275, user requirement): more advanced scoring; combine full-text and vector results
meaningfully; bias to return more, not less. Normalised scores per source, per-field weights,
agreement bonus, origin grade weight, scope and current-project boost, recency, history handling.
Wider candidate pools, generous default limit, no hard cutoff on a plausible match, group expansion
decided here. Results expose score parts to agents and the Memory module. Fixed evaluation set over
a seeded store (keyword-only, paraphrase, mixed, project-scoped); unit tests for fusion arithmetic.

Base: `v2.0` at `d3c8b8c8d`. Discovery ran through `codegraph_explore`: `Service.Search`, `fuse`,
`rrfK`, `semanticHits`, `Store.searchFTS`, `vectorTopK`, `memoriesBySeq`, `clampLimit`,
`SearchArgs`/`scopeKey`, `BuildMatch`, `Memory`, `GradeOf`, `embed.Spec`/`Default`, `kickBackfill`,
`runGate`, `candidates` (reconcile), `mcpserver.Build`/`searchInput`/`writeMemory`/`semanticNote`,
`memorycli.detectProject`, `DetectProject`, `MemoryControl`, `useMemorySearch`, `MemoryPanel.vue`.
Targeted reads: `0001_memories.sql` (FTS table), `0004_p272_provenance.sql` (indexes),
`apps/kira-space/internal/bridge/memory.go` (`Search`, `memoryUIListLimit`), `hybrid_test.go`,
registry `search_memories` entries, `llmpromptsflow` count, P272-P274 plans.

Out of scope (decided): full rewrite of MCP instructions and tool descriptions (P276; P275 adds only
the new argument entries and a one-line score note); ANN index or new vector library (see 2.9);
schema migration (none needed: every change is query time).

## 1. Today (line numbers at base)

- `hybrid.go:87` `Search`: `clampLimit` (default 25, max 100, `store.go:21-28`), `searchFTS` top
  `limit`, `semanticHits` top `limit`, `fuse` by RRF `rrfK = 60` (`hybrid.go:18`). Ranks only;
  bm25 values and cosines are thrown away (`collect(rows, true)` scans `rank` and drops it,
  `store.go:137`; `vectorTopK` returns `scored` but `semanticHits` keeps only `seq`).
- `searchFTS` (`store.go:169`): `bm25(memories_fts, 10.0, 2.0, 4.0)` = fact 10, reason 2,
  keywords 4. `BuildMatch` (`match.go:31`): OR of quoted prefix terms plus whole phrase; stopwords
  dropped; max 32 terms. Tokenizer `porter unicode61`.
- `vectorTopK` (`vectors.go:38`): exact scan of every vector of the model, min-heap top k, dot
  product of L2-normalised vectors (cosine). No floor on search; reconcile uses `DocFloor` 0.85.
- `Memory.Match` keyword|semantic|both; no score. MCP `writeMemory` meta line (`server.go:342`):
  `vN origin= source= scope= project= match= historical`. P273 says P275 appends score parts.
- Project and scope are not used by search. The MCP server knows its project (`Options.Project`,
  `memorycli.detectProject` of cwd). The UI has no current project; `Projects()` lists keys.
- Callers of `Service.Search`: MCP `search_memories`, `runGate` (`gate.go:68`, limit 10 related
  facts for the gate), Space bridge `MemoryService.Search` (limit `memoryUIListLimit` 100).
  Reconcile `candidates` calls `searchFTS` and `vectorTopK` directly, scope-filtered.
- UI (`MemoryPanel.vue`): rows show a `semantic` badge only for semantic-only matches; no score.
- Tests: `hybrid_test.go` `TestFuse` (RRF arithmetic), `service_test.go`
  `TestHybridSearchUnionsKeywordAndSemantic` (fake 3-dim embedder).

## 2. Design (all decisions final)

### 2.1 Pipeline

1. Validate args, build the FTS match (`BuildMatch`; no usable term and no semantic: empty result,
   as today).
2. Candidate pools: `pool = clamp(4 × limit, 100, 400)` from each source. Why: fusion can only
   rank what it sees; a fact at keyword rank 60 and semantic rank 30 is a strong joint hit that a
   top-`limit` cut loses.
3. Keyword pool: `searchFTS` returns each row with its raw bm25 (no longer dropped).
4. Semantic pool: `vectorTopK` returns cosines; filters (2.6) pushed into its SQL.
5. Union by `seq`, load missing rows (`memoriesBySeq`), compute parts (2.2-2.5), drop implausible
   (2.7), sort, cut to `limit`.
6. Group cohesion and context counts: one aggregate SQL over the cut list's lineages (2.5).

Ordering: score desc, then relevance desc, then keyword part desc, then `seq` desc. Why:
deterministic; equal scores favour the more relevant, then the newer row.

### 2.2 Per-source scores, each in [0, 1]

Keyword `kw`:

- bm25 column weights change to fact 10, keywords 6, reason 3. Why: keywords are gate-curated
  search aids (P273), closer to the fact than its reason; the reason still counts.
- `b = -bm25` (SQLite bm25 is negative, lower better). `bnorm = b / max(b in pool)`. Why: bm25
  scale varies by query length and corpus; dividing by the pool best keeps the top keyword hit at 1
  and every other match above 0 (min-max would zero the weakest real match).
- Coverage `cov`: kept query terms (`BuildMatch` terms after stopwords) that prefix-match a token
  of fact or keywords, divided by kept terms. Go-side over loaded rows, reusing `splitTerms`. Why:
  the OR match lets one rare term outrank a fact matching every term; coverage restores that order.
- `kw = 0.7 × bnorm + 0.3 × cov`; `kw = 0` when the row is not in the keyword pool.

Semantic `sem`:

- `sem = clamp((cos - QueryFloor) / (QueryCeil - QueryFloor), 0, 1)`; `sem = 0` when not in the
  vector pool.
- `embed.Spec` gains `QueryFloor` and `QueryCeil` (query-to-fact cosine of an unrelated pair and of
  a near-certain match for that model). Defaults for `arctic-embed-s-int8`: `QueryFloor 0.20`,
  `QueryCeil 0.60`, replaced by step 0's measured values (3.1). Why absolute, not per-query:
  cosine is comparable across queries; a query with no good semantic hit must not inflate its best
  weak hit to 1.
- The fake test embedder's spec sets `QueryFloor 0`, `QueryCeil 1`.

### 2.3 Fusion: weighted relative score fusion

- Both sources available: `rel = 0.45 × kw + 0.45 × sem + 0.10 × min(kw, sem)`. Range [0, 1].
- Semantic unavailable (off, not installed, indexing with 0 vectors, embed failure): `rel = kw`.
- `match` stays keyword|semantic|both, from which pools held the row.
- RRF and `rrfK` are removed. Why weighted over RRF: RRF keeps rank only, so a weak rank-1 hit
  equals a strong one, and its sum cannot be explained per part; normalised scores keep magnitude
  and explain themselves. Equal weights: neither source is known better for this corpus, and the
  evaluation set (2.10) guards the choice.
- Agreement term `0.10 × min(kw, sem)`: a fact both sources find is the strongest evidence; `min`
  rewards real agreement, not one strong side.

### 2.4 Boosts (multipliers on `rel`)

`score = rel × grade × scope × recency × history × group`. All multipliers stay near 1, so
relevance decides and provenance breaks near-ties. Why multiplicative: an irrelevant fact stays
irrelevant whatever its provenance.

- `grade`: user 1.10, external 1.05, agent 1.00 (`GradeOf` order). Why: P272 grade meaning; small,
  because agent facts remain useful reference.
- `scope`, given a target project `P` (2.6): fact project = `P` 1.15; company 1.05; personal 1.00;
  another project 0.85. No `P`: all 1.00. Why: the current project's facts matter most; company
  rules apply everywhere; other projects stay visible (recall), just lower.
- `recency`: `1 + 0.05 × 2^(-ageDays / 90)`, age from the version's `created_at`. Why: facts age
  slowly; recency only breaks ties.
- `history`: superseded version 0.60, current 1.00. Why: with `includeHistory` the current version
  ranks first, old versions stay listed.
- `group`: `1 + 0.05 × min(n, 3)`, `n` = other lineages in the cut list sharing a `document`,
  `thread`, `task` or `request` group with this fact. `session` groups excluded. Why: facts from one
  doc or thread that hit together are likely the context asked for; a session mixes topics.

Constants live in one block in `internal/memory/rank.go`, each with a one-line why.

### 2.5 Group expansion: no inline expansion; context hint instead

- Results never pull in non-matching sibling facts. Why: P272 decided context is a second step
  (`memory_context`); inline siblings dilute ranking and cost tokens.
- Each result carries `contextCount` (other current facts across its groups, `session` excluded),
  from the same aggregate query as `group`. MCP meta prints `ctx=N` when `N > 0`. Why: tells the
  agent when `memory_context` is worth a call.

### 2.6 Arguments and filters

`SearchArgs` (Go) gains:

- `Scopes []string` and `Origins []string`: hard filters, empty means all; values from the closed
  sets, else `ErrInvalid`. Pushed into both pool SQLs.
- `Project string`: boost target `P`, not a filter. Validated by `checkProject`.
- `within` (reconcile only) unchanged.

MCP `search_memories` input gains `scopes`, `origins`, `project`. `project` is `*string` in
`searchInput`: absent takes `Options.Project` (server cwd); explicit `""` means no boost. Why: the
agent's cwd is the project it works on; it can still name another or opt out.

Space bridge `MemorySearchArgs` gains `scopes`, `origins`, `project` (plain string; empty = no
boost). Why: the UI has no cwd; the user picks the project.

Gate (`runGate`) passes no filters and `Project` from the first item when its scope is `project`.
Why: related facts of the same project are the likeliest duplicates or conflicts.

### 2.7 Thresholds and limits

- Plausible = `kw > 0` or `sem > 0` (cosine above `QueryFloor`). Implausible rows (semantic-only
  below the floor) are dropped; nothing else is cut by score. Why: today a vector top-k always fills
  with unrelated facts; the floor removes noise only, keeping recall.
- `DefaultSearchLimit` 25 to 40, `MaxSearchLimit` 100 to 200. Why: recall bias; 40 results at about
  60 tokens each stay near 2.5k tokens.
- Space UI list limit (`memoryUIListLimit`) becomes `memory.MaxSearchLimit` (200) for search;
  `Recent` stays 100. Why: the panel already renders a flat list; 200 rows is cheap.
- `gateRelatedLimit` stays 10: the gate prompt budget, not search, sets it.

### 2.8 Explanation in output

- `memory.Score{Total, Relevance, Keyword, Semantic, Grade, Scope, Recency, History, Group float64;
  Boost string}` rounded to 3 decimals; `Memory.Score *Score` (`json:"score,omitempty"`), set only
  by search. `Memory.ContextCount int` (`json:"contextCount,omitempty"`). `Boost` names the scope
  case: `project`, `company`, `personal`, `other-project`, or empty without `P`.
- MCP meta appends, in this order: `score=0.82 kw=0.71 sem=0.64` then non-neutral boosts only
  (`grade=1.10 scope=project:1.15 recent=1.03 hist=0.60 group=1.10`) then `ctx=N`. Why: grep-first
  `key=value` tokens (P273), neutral 1.00 parts omitted to save tokens.
- `search_memories` description gets one sentence: results are best first; `meta` `score` is
  relevance times provenance boosts. Argument entries for `scopes`, `origins`, `project`. P276
  rewrites the rest.
- TS `memorySchema` gains optional `score` (`memoryScoreSchema`) and `contextCount`.
- UI (2.11) shows the total and a breakdown.

### 2.9 Performance on large stores

- Keyword pool: FTS5 bm25 over at most 400 rows; cost is the MATCH, unchanged.
- Vector pool: exact scan stays. Why: exact recall, no new dependency; at 384 dims a scan is about
  1.5 KB per fact. Budget: p50 search ≤ 150 ms at 20k current facts, ≤ 600 ms at 100k, measured
  once (3.2) with a scratch benchmark (fake 384-dim vectors, no model). If 20k misses budget, the
  implementer adds a per-process decoded-vector cache keyed on `(model, max(seq), count)` of
  `memory_embeddings` in the same phase (cheap invalidation; the memory-mcp process lives one
  session). ANN libraries declined: none pure-Go and maintained fits SQLite blobs, and exact scan
  meets the budget at realistic sizes.
- Coverage: term prefix checks over at most 800 loaded rows, linear.
- Group and context counts: one SQL over at most `limit` lineages, using
  `memory_group_members_lineage`.

### 2.10 Evaluation set (deterministic)

- `internal/memory/testdata/ranking/store.json`: about 40 facts with fact, reason, keywords, origin,
  sourceTag, scope, project, groups, `createdAt` offset in days, and an 8-dim topic vector.
  Superseded versions for 2 lineages.
- `internal/memory/testdata/ranking/queries.json`: each case names query, query vector, semantic
  on or off, filters, project, includeHistory, limit, and expectations: `top` (first id),
  `before` (pairs a before b), `within` (id within top N), `absent` (ids not returned),
  `minCount`.
- Categories, at least 2 cases each: keyword-only (semantic off), paraphrase (no shared terms;
  semantic only), mixed (one fact found by both beats single-source hits), project-scoped (same
  relevance, current project first, other project still present), origin tie-break (user before
  agent at equal text), history (current before superseded; superseded absent without
  includeHistory), filters (scopes, origins), noise (semantic-only below floor absent), recall
  (`minCount` larger than the old `limit` 25 behaviour returned), rare-term vs full-coverage.
- Runner `ranking_test.go` `TestRankingFixtures`: seed a temp store through `Store` writes plus
  `putEmbeddings`, fake embedder maps query text to the case vector, run `Service.Search`, check
  expectations, print the full ranked list with score parts on failure.
- Unit `rank_test.go` `TestScore`: table over `bnorm`, coverage, `sem` clamp, fusion with and
  without semantic, each multiplier, rounding, ordering ties. Why: interacting arithmetic rules
  (CLAUDE.md allows it). `TestFuse` and its RRF cases are deleted with `fuse`.

### 2.11 UI (`packages/workbench/src/memory/`)

- `store.ts` (`useMemoryUiStore`) gains `scopes`, `origins` (arrays) and `project` (string), kept
  per viewer with VueUse `useLocalStorage`. Why: one concern (Memory panel UI state), filters
  survive reloads.
- `queries.ts` `useMemorySearch` takes the filter object; query key includes it.
  `MemoryControl.memorySearch(query, includeHistory, filters)`.
- `MemoryPanel.vue` `PanelBar`: a `DropdownMenu` filter button with checkbox items for scope and
  origin, and a project `Popover` + `Command` combobox over `useMemoryProjects()` labelled "Boost
  project" with a clear action. Active filters show a count badge on the button.
- Row: a small score `Badge` (`font-data`, two decimals) with a shadcn `Tooltip` listing keyword,
  semantic, and non-neutral boosts by catalog label; match badge extended to keyword and both.
  Shown only when `memory.score` is set (search, not Recent).
- Tailwind utilities only, shadcn-vue primitives, `<script setup lang="ts">`, catalog keys under
  `memory.panel.*` and `memory.score.*` in `packages/theme/src/i18n/en.json`.
- `data-testid`: `memory-filter`, `memory-filter-scope-<scope>`, `memory-filter-origin-<origin>`,
  `memory-boost-project`, `memory-row-score`, `memory-score-parts`, `memory-match-keyword`,
  `memory-match-both`.

### 2.12 Registry edits (`internal/llmprompts/registry.go` only)

- `memory.mcp.tool.search_memories`: add the score sentence (2.8); `limit` arg `LimitVars{40,
  200}`; new args `scopes` ("only these scopes: company, project, personal"), `origins` ("only
  these origins: user, agent, external"), `project` ("project key whose facts rank first; default:
  this server's working directory project").
- Count rises by 3; implementer recounts and updates `llmpromptsflow` `TestList` (93 to 96).
- Texts follow `CLAUDE.md` "Communication style".

## 3. Execution

One sequential Sonnet implementer, main checkout. Why: SPEC Process says so, and the score type
flows store to service to MCP to IPC to UI in one order-dependent chain. Typecheck and lint per
commit; no expensive suites until 3.2.

### 3.1 Implementer order and commits

0. Calibration probe (scratch, not committed): if `memory.Home()` model install works in the
   sandbox (`embed.Install`, network through the proxy), embed the evaluation facts with real
   phrasings plus 20 unrelated and 20 paraphrase query pairs; set `QueryFloor` to the 90th
   percentile of unrelated cosines and `QueryCeil` to the median paraphrase cosine, rounded to
   0.05. Download blocked: keep defaults 0.20 and 0.60. Record numbers or the block in this plan's
   result section in the final commit.
1. `embed/spec.go` (`QueryFloor`, `QueryCeil`), `rank.go` (constants, `Score`, part functions,
   ordering), `store.go` (`searchFTS` returns bm25, new weights, filter args, pool limit;
   `SearchArgs` fields; limits 40/200), `vectors.go` (`vectorTopK` filters, cosines kept; new
   `groupStats` aggregate), `hybrid.go` (`Search` rewritten, `fuse`/`rrfK` removed), `gate.go`
   (project), `model.go` (`Score`, `ContextCount`), `rank_test.go`, delete `hybrid_test.go`
   `TestFuse`, update `service_test.go` hybrid test to the new parts. Commit
   `feat(memory): score-based hybrid ranking with provenance boosts`.
2. `testdata/ranking/*`, `ranking_test.go`. Tune only constants named in 2.2-2.4 if a case fails,
   and record every changed constant with its why in the result section. Commit
   `test(memory): ranking evaluation fixtures`.
3. `mcpserver/server.go` (`searchInput` fields, project default, meta score parts, `ctx=`),
   `server_test.go`, `registry.go` (2.12), `llmpromptsflow` count. Commit
   `feat(memory-mcp): search filters, project boost and score parts`.
4. Space `bridge/memory.go` (`MemorySearchArgs`, limit), Wails bindings regenerated per
   `docs/DEV_ENVIRONMENT.md`, `packages/shared/domain/memory.ts`, `memoryControl.ts`, `module.ts`,
   `queries.ts`, `tests/ui/support/mockRuntime.ts` defaults. Commit
   `feat(memory): search filters and scores over IPC`.
5. UI (2.11) and catalog keys. Commit `feat(memory-ui): search filters and score breakdown`.
6. Flow tests, contracts, UI spec (section 5), existing spec updates. Commit
   `test(memory): ranking flow and UI spec`.

### 3.2 Serial test-and-fix (one Sonnet, after 3.1)

`bun run lint`, `bun run lint:go`, `bun run typecheck`, `go test ./... -count=1`,
`bun run test:flows:space`, `bun run test:ui:space`, `bun run test:unit`, visual Space if a
baseline covers the memory panel. Scratch benchmark (2.9) at 20k and 100k facts, p50 of 20 runs
each, recorded in the result; cache contingency applied if 20k misses. Then real `claude` rows
(section 6). Fix at cause; commit per group.

### 3.3 Close-out (one Sonnet)

`docs/ARCHITECTURE.md` "Memory MCP server and module": ranking (pools, parts, fusion, boosts,
floor, limits, filters, `ctx`), constants location. Result section here. SPEC P275 Done. Commit
`docs: P275 close-out`.

## 4. File ownership (single implementer)

No streams. Why: one dependency chain (score type, then MCP and IPC, then UI); no split passes the
zero-overlap and no-ordering rule.

| Area | Files |
|---|---|
| Memory core | `internal/memory/{rank,hybrid,store,vectors,gate,model}.go`, `internal/memory/embed/spec.go`, `internal/memory/{rank,ranking,service,hybrid}_test.go`, `internal/memory/testdata/ranking/*` |
| MCP | `internal/memory/mcpserver/{server,server_test}.go` |
| Prompts | `internal/llmprompts/registry.go`, `apps/kira-space/internal/flows/llmpromptsflow/llmprompts_test.go` |
| Space bridge | `apps/kira-space/internal/bridge/memory.go`, Space Wails bindings (`memoryservice.ts` and models) |
| Shared TS | `packages/shared/domain/memory.ts`, `apps/kira-space/frontend/src/bridge/memoryControl.ts`, `packages/workbench/src/memory/{module,queries,store,labels}.ts` |
| UI | `packages/workbench/src/memory/MemoryPanel.vue` (new `MemoryFilters.vue`, `MemoryScore.vue` if the panel grows past one concern), `packages/theme/src/i18n/en.json` |
| Tests | `apps/kira-space/internal/flows/memoryflow/ranking_test.go`, `apps/kira-space/tests/contract/memory.json`, `apps/kira-space/tests/ui/memory-ranking.spec.ts`, `apps/kira-space/tests/ui/{memory-module,memory-provenance}.spec.ts` (search args shape), `apps/kira-space/tests/ui/support/{ipcChannels,mockRuntime}.ts`, `apps/kira-space/tests/claude/{memory_test,memory_gate_test}.go` |

A needed file outside this table: edit it and name it in the commit body.

## 5. Tests

Unit (advanced logic only): `rank_test.go` `TestScore`, `ranking_test.go` `TestRankingFixtures`
(2.10). No unit tests for argument validation (single-condition guards).

New-feature split at the IPC boundary (same scenario, same asserted result; contracts in
`apps/kira-space/tests/contract/memory.json`):

| Scenario | Go flow (`memoryflow/ranking_test.go`) | UI spec (`memory-ranking.spec.ts`) |
|---|---|---|
| Ranked search with project boost and filter | `TestSearchRankedWithBoost`: store (fake runner) 4 facts on one topic: user project `github.com/acme/billing`, agent same project, user project `github.com/acme/web`, external company; `MemoryService.Search{query, scopes:[project, company], project: github.com/acme/billing}` → order billing-user, billing-agent, company, web; every result has `score` with `total`, `keyword`, `boost`; web has `boost` `other-project`; contract `args:MemoryService.Search#ranked` and `MemoryService.Search#ranked` | type the query, set the filter (scope Project and Company), pick boost project `github.com/acme/billing`; sent args equal the contract args; rows in contract order; `memory-row-score` shows the totals; hovering the first shows `memory-score-parts` with keyword and project boost labels |
| Filter excludes | `TestSearchOriginFilter`: same store, `origins:[user]` → only user facts; contract `MemoryService.Search#user` | uncheck Agent and External; sent args `origins:[user]`; only user rows |

Backend-only (no UI state, no spec; P272 grade-guard precedent):

- `TestMcpSearchScoreMeta`: fakeagent drives `memory-mcp` with cwd a temp git repo whose `origin`
  is `github.com/acme/billing`; two facts, one project-scoped there, one company; `search_memories`
  text: project fact first, its meta has `score=`, `kw=`, `scope=project:1.15`; structured result
  has `score.boost` `project`; every non-blank line still matches the P273 search line regex.

Existing `memory-module.spec.ts` and `memory-provenance.spec.ts` move to the new search args shape.

## 6. Real `claude` rows (opt-in, after 3.2)

Changes touch `internal/memory/mcpserver/**`, `gate.go` and `internal/llmprompts/**`, so run the
prompt registry row:
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryMcpThroughClaude|TestMemoryInstallRegisters|TestMemoryImport|TestMemoryIngest|TestAdeHeadlessRun|TestAdeStepResults|TestAdeStageSession|TestAdeRebaseRun|TestSmartScriptRun'`
and `bun run test:claude:studio`.

Test edit: `TestMemoryMcpThroughClaude` search step asserts the returned text has `score=` on every
`meta` line and that claude's call passed no invalid filter (tool error absent). Report spend per
run.

## 7. Verification (orchestrator, real checks)

1. `rg -n 'rrfK|func fuse' internal/memory` → none.
2. `rg -n 'QueryFloor' internal/memory --glob '!*_test.go'` shows a real use in `rank.go` and the
   spec value; `rg -n 'GradeOf' internal/memory/rank.go` shows the grade boost uses it.
3. `rg -n 'bm25\(memories_fts, 10.0, 3.0, 6.0\)' internal/memory/store.go` matches (column order
   fact, reason, keywords).
4. `go test ./internal/memory -run 'TestScore|TestRankingFixtures' -count=1 -v` passes and lists
   every category from 2.10.
5. `rg -n 'Scopes|Origins|Project' apps/kira-space/internal/bridge/memory.go` shows the args passed
   to `svc.Search`; `rg -n 'memory-row-score|memory-filter' packages/workbench/src/memory` shows
   real template use.
6. UI libraries: filter uses shadcn `DropdownMenu`, `Popover`, `Command`, `Tooltip`; store uses
   VueUse `useLocalStorage`; search through TanStack in `queries.ts`; no `<style` in
   `packages/workbench/src/memory/`.
7. Registry count equals `TestList`; `go run ./internal/llmprompts/cmd/checkprompts` passes.
8. Benchmark numbers in the result section, against the 2.9 budget.
9. Suites in 3.2 green; real `claude` rows run and reported.
10. Implementer's tool log shows `codegraph_explore` where it discovered code beyond this plan.

## 8. Decisions log (final)

- Candidate pools 4 × limit, 100 to 400: fusion sees joint hits a top-limit cut loses.
- bm25 kept and max-normalised per pool: magnitude survives, weakest real match stays above 0.
- Field weights fact 10, keywords 6, reason 3: keywords are curated aids, reason is supporting text.
- Coverage 30 % of keyword part: full-term matches beat a single rare term under the OR query.
- Cosine mapped by absolute model floor and ceiling: comparable across queries, no inflated weak hit.
- `QueryFloor`/`QueryCeil` on `embed.Spec`, calibrated by step 0: model-specific numbers live with the model.
- Weighted relative score fusion, RRF removed: keeps magnitude and explains itself.
- Equal source weights plus 10 % agreement on `min`: no source known better; agreement is real evidence.
- Keyword-only fallback `rel = kw`: semantic off must not halve scores.
- Boosts multiplicative, near 1: relevance decides, provenance breaks ties.
- Grade 1.10 / 1.05 / 1.00: P272 grade order, agent facts stay useful.
- Project 1.15, company 1.05, personal 1.00, other project 0.85: current work first, nothing hidden.
- Recency bonus up to 5 %, 90-day half-life: facts age slowly.
- Superseded 0.60: current first under includeHistory.
- Group cohesion up to 15 %, session groups excluded: co-hits from one doc or thread signal context.
- No inline group expansion; `ctx=N` hint: P272 second-step context, fewer tokens.
- Scopes and origins hard filters, project a boost: filters are explicit choices, project is a preference.
- MCP project defaults to server cwd project: the agent works there.
- Gate passes the item project: likeliest duplicates or conflicts.
- Only implausible semantic-only rows dropped: removes noise, keeps recall.
- Limits 40 default, 200 max; UI search 200: recall bias at modest token cost.
- Score parts on `Memory.Score`, rounded, neutral parts omitted in MCP text: explainable, grep-first, cheap.
- UI score badge plus tooltip breakdown, filters in a dropdown, project combobox: shadcn primitives, per-viewer state.
- Exact vector scan kept with a measured budget and a named cache fallback: exact recall, no new dependency.
- Deterministic fixture set with ordering constraints plus `TestScore`: guards ranking without a model.
- No migration: all changes are query time.
- One sequential implementer: one dependency chain, SPEC Process.

## 9. Result

Implementation (3.1) landed; 3.2 serial test-and-fix and 3.3 close-out pending.

Step 0 calibration (real `arctic-embed-s-int8`, 20 fact/query pairs, 380 unrelated pairs): unrelated
cosine p50 0.489, p90 0.550, p99 0.591, max 0.625; paraphrase min 0.545, median 0.602, max 0.698.
The rule (floor p90, ceil median) gives 0.55 / 0.60, a 0.05 band: semantic score turns near-binary.
Decision: `QueryFloor 0.55`, `QueryCeil 0.70` (about the paraphrase max, a near-certain match).

Deviations:

- Fixture store has 72 facts (plan: about 40): 32 same-topic fillers feed the recall case. 20 query
  cases. No ranking constant was tuned; every case passed on first run.
- `searchFTS` keeps its `[]Memory` shape for reconcile; new `searchFTSRows` returns bm25. `vectorTopK`
  takes a `filter` value. `match.go` gains `matchTerms`.
- Flow and UI contracts send canonical scope order (`company`, `project`) and empty arrays, not
  `null`; seed store holds a fifth, personal fact so the scope filter bites.
- Flow contracts regenerated by targeted `KIRA_CONTRACT=write` runs of the four search tests only.
