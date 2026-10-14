# P291 plan: memory retrieval and unified import investigation

Ask (SPEC row P291, last phase of v2.5, after P290). User ranks memory goals: (1) find the right memory
when needed; (2) extract as many facts as possible; (3) storage size secondary, but stored text stays
smaller than the source. Test, not assume, that "keep only the meaning" cuts size to about half.
Investigate together: (b1) unified pipeline, `distill` as the core of import with memory built on top
(P285 Part 2 round p2-02, commit `5866fd5e1`, reverted by `16d4e5ed9` only for "`C_fact` not worse");
(b2) retrieval structure: explicit subject, aspect (and keywords), embedding text, atomic facts grouped
at read time vs merged facts, merge-by-key vs model-judged sameness. (c) First build a retrieval eval:
questions with known answer facts per corpus source, hit@k and MRR through the real search path with the
embedder on, keyword and vector, calibrated against P275 (0.55/0.70). Compare variants on retrieval,
`R_ess`, `R_all`, `P`, `C_fact` together. "`C_fact` not worse" is replaced by "stored text below source
size, retrieval not worse". (d) Spend cap 20 USD for the phase, ledger under the runs folder, stop and
report at the cap. (e) Report under `plans/` with measured numbers; adopt the winner in code only if it
beats the current pipeline on retrieval without stored text exceeding source size; else ARCHITECTURE
Known open items with the numbers.

Base: `v2.0` at `2bed9cefc` (P289 plan). P286-P290 land before P291 runs, so the implementer re-checks
every fact below that names a file P289 touches (Step 0).

Discovery ran through `codegraph_explore` (11 calls): `Distiller.Distill`/`distillCall`/`cleanLines`,
`mcpserver.addDistillTool`, `bridge.MemoryService` (`service`, `importer`, `Search`, `watch`),
`importer.Engine`, `store` (db.go: `claimVerify`, `claimFinalize`, `loadExtracted`, `storeDoc`),
`ClaudeAgent.Extract`/`Verify`/`Finalize`, `cleanFacts`, `Questionable`, `RenderDoc`/`writeDocFile`,
`Agent`/`Fact`/`FinalFact`, `Service.Search`/`semanticPool`/`candidates`/`prepare`/`commit`/`vectorFor`/
`embedDoc`/`backfillOnce`/`ApplyDoc`/`applyDocFact`, `rank.go` (all), `embed.Spec`/`Default`/`Client`/
`NewClient`/`RunWorker`, `vectors.go` (all), `memfmt` (`Doc`, `Fact`, `FormatDoc`, `ParseDoc`),
`appwire.RunArgvShim`, registry memory entries, `ranking_test.go`. Bash only where CodeGraph does not
reach: the eval harness (`apps/kira-space/tests/claude`, not indexed), `git show 5866fd5e1`, P285 run
ledgers and judge files, docs.

## 1. Current state (re-read from the tree)

Pipeline, import (`internal/memory/importer`):
- `Engine` (control, writes job rows) plus `Runner` (detached `memory-ingest` process, one per
  `memory.db`). Per file: chunk (`chunkFile`, `DefaultBudget{3000, 4000, 1500, 750, 200}`), then
  `ClaudeAgent.Extract` per chunk (Sonnet, `memory.import.extract.system`, schema `fact`, `evidence`,
  `section`, `unresolved`; max 40 facts, evidence 200 chars, `cleanFacts`).
- `loadExtracted` flags a fact questionable when `unresolved` is set or its evidence quote is not in
  the chunk (`questionableIn`). `Verify` (Read/Grep agent over a source copy) judges questionable facts.
- `Finalize` (one Sonnet agent per file, `memory.import.finalize.system`, kira-memory MCP in import
  mode): merges duplicates and "facts about the same subject and the same aspect" up to 300 chars, drops,
  resolves, then calls `store_memory` (max 20 items per call). `FinalFact.Reason` is the code-built
  locator `Stated in <path>, <section>`; import mode pins it (`work.pinned`).
- Write-back: `RenderDoc` (memfmt v2) beside the source; a locator reason becomes the `## section`
  heading, any other reason an indented line.

Store (`internal/memory`): `Service.Store` = validate, gate (Sonnet, splits facts, 3-10 keywords per
fact, challenges), `prepare` (hash noop; candidates = FTS top 10 plus up to 5 vectors with doc cosine
>= `DocFloor` 0.85), reconcile (Sonnet; "same subject" decides update vs add), `commit` per fact with
revision check. Migrations `0001`-`0007` (latest `0007_p281_verify_pending.sql`; P286-P290 may add one,
Step 0 re-checks). `memories_fts` indexes fact, keywords, reason (bm25 10, 6, 3).

Distill (`importer/distill.go`): `Distiller.Distill` chunks like import, runs `distillCall` per chunk
(`memory.distill.system`, schema `lines[{text, unresolved}]`, max 40 lines), 3 workers, 2 USD cap. Shared
by MCP `distill` (`mcpserver/distill.go`) and Space `MemoryDistillService` (`bridge/memorydistill.go`).
Import does not use it (P285 Part 2 fallback).

memfmt v2: doc `---`/`kira-memory: 2` front matter (`group`, `title`, `from`, `origin`, `source`,
`scope`, `project`, `session`, `keywords`, `updated`), body `## heading`, `- km_<id> <fact>`, optional
indented reason. Comment block `<marker> kira-memory origin=… scope=…`, `<marker> km_<id> <fact>`,
indented reason. `kira-memory: 1` parses to one "retired format" problem, no facts. No per-fact keywords
in either format (Known open item).

Subject and aspect: wording only, in registry prompts: gate step 1 ("values, fields, cases or limits of
one subject is one claim"), reconcile ("same subject"), extract ("subject certain"), distill ("Name the
subject"), finalize step 1 ("same subject and the same aspect"), verify ("subject or a reference stays
open"). No Go code reads either (grep of `internal/memory` non-test code: zero hits).

Search (`Service.Search`, `rank.go`, P275): pools `clamp(4 x limit, 100, 400)` per source; keyword part
`0.7 bm25/best + 0.3 coverage`; semantic part cosine mapped between `QueryFloor` 0.55 and `QueryCeil`
0.70; fusion `0.45 kw + 0.45 sem + 0.10 min`; boosts grade, scope, recency, history, group (document,
thread, task, request groups). Only a semantic-only row at or below the floor is dropped.

Embedder: `embed.Default` = arctic-embed-s int8 ONNX, 384 dims, local worker subprocess
(`<exe> memory-embed`, `embed.RunWorker`), `ClientOptions.Command` replaceable. Embeds the `fact` text
only (`embedDoc`, `vectorFor`, `backfillOnce`); query gets the spec prefix. Vectors live in
`memory_embeddings` (`seq` PK, `model` text; a new model key overwrites by `INSERT OR REPLACE`).
Local and free: the only network use is the one-time 35 MB model download from Hugging Face (proxy
reachable here); `scripts/fetch-onnxruntime.sh linux-x64` plus `KIRA_ORT_LIB` enable it in this sandbox.

Free store seeding: `Service.ApplyDoc` stores a parsed doc's facts as they are (no gate, no reconcile,
no Claude), keeping each fact's reason verbatim, with the doc-level keywords, then kicks the backfill.
A one-fact doc per stored fact reproduces fact, reason and per-fact keywords exactly.

Eval harness (`apps/kira-space/tests/claude/memory_eval*_test.go`, `bun run eval:memory`,
`KIRA_MEMORY_EVAL=1`): modes `prepare`, `golden`, `run`, `footprint`. A run ingests each source into a
fresh store (embedder off), records `facts.jsonl` (stored fact, reason, keywords; extracted facts;
stages), judges with frozen Opus prompts into `judge/<source>.json` (per golden fact `covered` and
`by`: the stored fact ids that state it), writes `scores.json` (`R_ess`, `R_all`, `P`, atomic,
standalone, unsupported, duplicate, `C_fact`, `C_rec`, `C_doc`). Ledger per part via
`KIRA_EVAL_LEDGER`; run cap `KIRA_EVAL_CAP_USD`, phase cap `KIRA_EVAL_PHASE_CAP_USD` (stops starting
work at cap minus 2). Runs dir fixed to `P285-runs`. `judgeCall` hard-codes `--model opus`.

What it lacks for retrieval: questions, a combined store, the embedder, search calls, rank metrics. All
22 P285 rounds keep `facts.jsonl` plus judge `by`, so retrieval over them is free once questions exist.

Corpus: 15 sources pinned at `9ed83ae85`, 10 tuning, 5 hold-out. Golden 585 facts, 372 essential (283
tuning, 89 hold-out).

Spend per run, from the ledgers: tuning round 3.8-4.7 USD (pipeline 1.4-1.7, gate 0.7-1.2, judge
1.6-2.1); unified p2-02 4.50; all 15 sources 5.7-6.4; hold-out 1.25-1.33; golden authoring 1.63 for 15
sources (Opus).

Reference numbers (tuning aggregate):

| round | tree | `R_ess` | `R_all` | `P` | atomic | `C_fact` | `C_rec` | stored |
|---|---|---|---|---|---|---|---|---|
| round-final | Part 1, extract, atomic | 0.883 | 0.713 | 0.895 | 0.937 | 0.497 | 1.062 | (all 15) 446 |
| round-p2-02 | unified distill, atomic | 0.924 | 0.836 | 0.865 | 0.918 | 0.549 | 1.236 | 414 |
| round-p2-03 | unified, distill override | 0.920 | 0.836 | 0.861 | - | 0.552 | - | - |
| round-p3-01 | Part 3, extract, merged (current) | 0.885 | 0.689 | 0.737 | 0.746 | 0.434 | 0.863 | 209 |

Bands (P285 Part 1, identical code): `R_ess` 0.020, `R_all` 0.020, `P` 0.065, unsupported 0.010,
`C_fact` 0.029, `C_doc` 0.103. Golden essential facts alone are 0.47 of source chars, all golden 0.71.

Identical-code round pairs (free noise source for retrieval): `round-00a`/`round-00b`; `round-02`/
`round-final` (tuning subset); `round-p2-01`/`round-p2-01b`.

## 2. Decisions (final)

- D1. Retrieval eval reuses the P285 harness and corpus. New modes `questions` (paid, once), `keys`
  (paid), `retrieval` (free). Why: one harness, frozen corpus and judge, comparable rounds.
- D2. Questions: one natural question and one keyword query per essential golden fact, all 15 sources
  (about 744 queries: 566 tuning, 178 hold-out). Opus writes them from the source and the golden fact
  only, never from pipeline output. Why: essential facts are what a developer must find; minor-fact
  questions would re-measure recall; no variant's wording can leak in.
- D3. Leak guard: code drops a query sharing any 4 consecutive content words (stopwords removed,
  lowercased) with its golden fact or quote; names and identifiers alone are fine. Dropped count is
  reported, no regeneration. Why: copied wording inflates keyword search unrealistically.
- D4. Overfit guard: decisions use tuning questions only; hold-out questions confirm the final adopted
  tree once. Search constants are never tuned on tuning alone (D12). Why: same split as P285.
- D5. Answer key: a stored fact answers a golden fact when the round's judge lists it in `by` with
  `covered` full or partial. End-to-end metrics count golden facts with `covered` none as misses;
  conditional metrics skip them. Gate on end-to-end. Why: goal 1 is finding the fact; a fact never
  stored cannot be found, so recall loss must show in retrieval.
- D6. Retrieval store per round: one fresh `memory.db` holding every source of the round's set, seeded
  by `Service.ApplyDoc` with one one-fact doc per stored fact (fact, reason and keywords verbatim, one
  `kg_` group per source, origin `agent`, scope `project`, the eval project). Hold-out store = hold-out
  facts plus the paired tuning round's facts as distractors. Why: real store, real FTS, real ranking,
  no Claude; per-source document groups as an import makes them.
- D7. Search: `Service.Search` with the real `embed.Client` (worker re-exec of the test binary,
  `KIRA_ORT_LIB`, model under `KIRA_EVAL_MODEL_HOME`), limit 10, project set. Modes: `hybrid` (real
  path, model ready, backfill done), `keyword` (real path, no embedder), `semantic` (diagnostic: cosine
  rank by the same client). Gate on `hybrid`; `keyword` must not regress beyond its band. Why: hybrid is
  the product with the model installed; keyword-only is what users without the download get.
- D8. Metrics: hit@1, hit@3, hit@5, hit@10, MRR@10 (end-to-end and conditional), per form, per source;
  returned chars at k=5 (reading cost); `C_fact`, new `C_store`, `C_doc` (v2 render), new `C_distill`;
  `R_ess`, `R_all`, `P`, atomic, unsupported. `C_store` = fact + non-locator reason + keywords (+ subject
  and aspect when present) chars over source chars; a code-built `Stated in` locator is metadata, stored
  once per section in the doc. `C_distill` = the pipeline's pre-finalize lines over source chars.
- D9. Retrieval band `band_R` = max `|delta MRR@10|` (hybrid, tuning, end-to-end) over the three
  identical-code pairs, floor 0.02; `band_Rk` the same for `keyword`. Computed in Step 3 and written to
  `results.md` before any paid pipeline run. Why: P285 method (bands from identical code), now free.
- D10. Cross-pipeline gate (different fact sets: V1 vs baseline). Adopt iff all hold on tuning:
  `MRR_hybrid(V) - MRR_hybrid(base) > band_R`; `MRR_keyword(V) >= MRR_keyword(base) - band_Rk`;
  `R_ess(V) >= R_ess(base) - 0.020`; unsupported <= 0.020; `C_fact < 1.0`, `C_store < 1.0`,
  `C_doc < 1.0`. Marginal (`band_R < delta <= 1.5 band_R`): one confirmation rerun when the cap allows
  (section 4), mean of both decides; not affordable means not adopted. After adoption, hold-out:
  `MRR_hybrid(V, hold-out) >= MRR_hybrid(base hold-out) - band_R`, else revert. `P`, `R_all`, atomic,
  `reason ok` reported, not gated. Why: the row's adopt rule; `P` and atomic move by design with merging,
  unsupported guards invention.
- D11. Same-facts gate (recipes, keys, grouping, constants on one fact set): paired bootstrap over
  queries (2000 resamples, fixed seed) of per-query reciprocal-rank difference; adopt iff the 95% CI
  lower bound > 0 and mean delta >= 0.02 on two bases (the baseline round and the adopted pipeline's
  round, or `round-p2-02` when nothing else is adopted). Why: same facts remove pipeline noise; two bases
  guard against one fact set's quirks.
- D12. Calibration: per recipe, query-to-answer cosine (positives) and query-to-other-source cosine
  (negatives), p10/p50/p90 each; doc-to-doc cosine of paraphrase pairs (stored facts covering the same
  golden fact in two rounds of different code) vs unrelated pairs. P275 method: `QueryFloor` = negative
  p90, `QueryCeil` = positive max of paraphrase-like pairs, `DocFloor` between paraphrase p10 and
  unrelated p99. New constants are a same-facts variant (D11) and must not drop hold-out MRR beyond
  `band_R`. Why: answers "calibrate against 0.55/0.70" with data and keeps constants honest.
- D13. Stored-size rule replaces the `C_fact` targets: `C_fact`, `C_store`, `C_doc` each < 1.0 on the
  tuning aggregate; per-source values over 1.0 are reported, not gated. The 0.30 `C_fact` target and the
  "`C_fact` not worse" rule are retired. Why: the user's rule; dense sources (doc-arch-prompts near 1.0)
  are fact lists already and would fail on noise.
- D14. "Half" test: report `C_distill`, `C_fact`, `C_store`, `C_doc` per variant and per category,
  next to the golden floors (0.47 essential, 0.71 all) and `C_fact / R_all` (chars per recalled share).
  The report states whether about 0.5 holds and at what recall. Why: the expectation is testable from
  run data at no extra cost.
- D15. Baseline B0: if any memory-pipeline prompt (`memory.*` in `registry.go`) or code under
  `internal/memory/{importer,gate*,reconcile*,service*}.go` changed since `9c09012fe` (round-p3-01), run
  a fresh tuning round of the current tree (expected: P289 rewrites extract and gate). Else
  `round-p3-01` is the baseline. Hold-out baseline: `round-p3-holdout` (tree difference noted). Why:
  P289 changes the extract and gate texts; a full hold-out baseline does not fit the cap.
- D16. Pipeline embedder stays off during paid runs; only the retrieval store has it on. Why: keeps
  paid rounds comparable to every P285 round; per-source fresh stores give reconcile almost no vector
  candidates anyway (noted as caveat).
- D17. Keys pass K: Sonnet (`--model sonnet`, the production extractor model), one call per source per
  round over its stored facts, frozen prompt and schema in `P291-corpus/keys.md`, `keys.schema.json`:
  per fact `subject` (1-5 words, the source's own name for the thing) and `aspect` (1-3 words, which
  property: default, limit, reason, behavior, owner, format, ...). Rounds: baseline, `round-p2-02`,
  later V1. Why: isolates the value of explicit keys on identical facts; cheaper than a pipeline run.
- D18. Variants measured with K (same facts, free after K): embed recipes `sa-fact` ("<subject>,
  <aspect>: <fact>"), `sa-fact-kw`; FTS `kw-sa` (keywords plus subject and aspect); grouping by
  `subject`. Key drift = share of golden facts covered by 2 or more stored facts whose normalized
  subjects differ. Merge-by-key proxy = facts per normalized (subject, aspect) group on atomic rounds,
  against the model-merged ratio (`round-p3-01` stored vs extracted). Why: covers every b2 option at
  near-zero cost.
- D19. Key-free variants (free, every round): embed recipes `fact` (today), `fact-kw` ("<fact>
  keywords: <k1, k2, ...>"), `sec-fact` ("<section>: <fact>", section from the locator), `sec-fact-kw`;
  FTS `nokw` (keywords emptied) to price the gate keywords; grouping `none` and `section` (results
  collapse by locator section; hit@k over groups, returned chars count every member).
- D20. V1 = unified pipeline ported onto the current tree (distill per chunk, code-built locator, no
  evidence, salient-token questionable rule, evidence-free verify). Merge setting chosen before the paid
  run from free data: if `mean(MRR p2-02, p2-03) - MRR(baseline) > band_R`, V1 is atomic (finalize step 1
  merges duplicates and near-duplicates only); else V1 keeps the current finalize merge rule. Why: one
  paid unified run; free evidence picks its most promising form. A separate atomic V2 run does not fit.
- D21. V1 lands as a measurement commit on the chapter branch and is reverted with
  `revert(memory): …` if D10 fails (P285 Part 2 precedent `16d4e5ed9`). Why: the real pipeline must run
  to be measured; history stays legible.
- D22. Adoption scope per winner:
  - A1 unified pipeline: keep the V1 commit (section 3, Step 6).
  - A2 embed recipe or constants: `internal/memory/embeddings.go` builds the document text through one
    `embedText(fact, keywords)` used by `embedDoc`, `vectorFor`, `backfillOnce` (backfill query reads
    keywords); vector model key `embed.Default.ID + "/" + recipe` (no migration: `INSERT OR REPLACE` on
    `seq`, backfill re-embeds). Recipe-calibrated `QueryFloor`/`QueryCeil`/`DocFloor` (D12) replace the
    spec values when they differ beyond 0.01. Model directory and `SemanticStatus.Model` stay
    `spec.ID`.
  - A3 explicit keys (only if D11 holds against the best A2 recipe, not just against `fact`, and the
    budget covers its verification round): gate schema adds `subject` and `aspect` per fact (the one
    writer every path shares: MCP, UI, import); migration `0008_p291_subject_aspect.sql` (or next free
    number) adds both columns `NOT NULL DEFAULT ''` and rebuilds `memories_fts` with a `subject` column
    holding "subject aspect" (bm25 weight 6); embed recipe from D18; `Memory` JSON gains `subject`,
    `aspect` (omitempty). memfmt stays v2: keys are DB-only like per-fact keywords; `ApplyDoc` leaves
    them empty. Write-time merge-by-key is not adopted.
  - Read-time grouping is measured, never adopted here. Why: it changes the search result shape across
    MCP text, bridge, UI and contract; a separate phase if it wins (open item).
- D23. Real `claude` rows are counted in the ledger as kind `real-rows` from the suite's printed
  `claude -p` spend (estimate 1.0 USD). Why: the cap is for the whole phase.

## 3. Steps (one Sonnet implementer)

Each step is one commit group, Conventional Commits, trailers on separate lines. Hooks pass normally.
Fast checks per code commit: `go build ./...`, `go vet` of touched packages, `bun run lint`,
`bun run lint:go`, `bun run typecheck`; nested module: `cd apps/kira-space/tests/claude && go vet ./...
&& go test -count=1 -run TestMemoryIngestEval ./...` (skips without `KIRA_MEMORY_EVAL`). Paid steps run
the cap check of section 4 first. Every round appends to `P291-runs/results.md` and commits before the
next round starts.

Measurement-only: Steps 0-5, 7 (paid runs), 11. Code adoption, only after the gate: Steps 8, 9 (and
keeping Step 6). Step 6 is a measurement commit, reverted on failure.

Step 0. Preflight. Fetch `origin/v2.0`. `sh scripts/fetch-onnxruntime.sh linux-x64`, export
`KIRA_ORT_LIB`. The Step 2 smoke proves the `claude` CLI works. Re-read what P286-P290 touched among
section 1's files:
`git diff --stat 9c09012fe..HEAD -- internal/memory internal/llmprompts/registry.go
apps/kira-space/tests/claude`. Record the B0 decision (D15), the latest migration number and any
section 1 fact that moved in `P291-runs/results.md` (create it: header, spend table, bands table empty).
Commit `test(memory): P291 runs ledger and preflight`.

Step 1. Harness, `test(memory): P291 retrieval eval harness`. Files, all in `apps/kira-space/tests/claude`:
- `memory_eval_corpus_test.go`: `evalRunsDir` reads `KIRA_EVAL_RUNS_DIR` (relative to
  `docs/v2.5/plans`, default `P285-runs`); `evalPlansDir()`; a round reference `<runs dir>/<round>`
  resolves under it.
- `memory_eval_judge_test.go`: `judgeCall` takes the model (`opus` for golden, score, questions;
  `sonnet` for keys). Ledger path follows `KIRA_EVAL_RUNS_DIR`.
- `main_test.go`: `KIRA_EVAL_EMBED_WORKER=1` re-exec runs `embed.RunWorker(os.Args[2:])`.
- `memory_eval_retrieval_test.go` (new): modes `questions`, `keys`, `retrieval`.
  - `questions`: per source, Opus with `P291-corpus/questions.md` and `questions.schema.json` (input:
    source text, essential golden facts with id, fact, quote; output per golden id `question` (one
    sentence, at most 20 words, how a developer asks when they need it, own words) and `query` (3-6
    words an agent types into search)). D3 leak guard in code. Appends to
    `P291-corpus/questions.jsonl` (resume: sources present are skipped); ledger kind `questions`.
  - `keys`: per round in `KIRA_EVAL_ROUNDS`, per source, Sonnet with `P291-corpus/keys.md` and
    `keys.schema.json` over that round's stored facts; output to `P291-runs/keys/<round>/<source>.json`
    (resume: present files skipped); ledger kind `keys`.
  - `retrieval`: per round in `KIRA_EVAL_ROUNDS` (and `KIRA_EVAL_SET`): seed the store (D6), wait
    until `SemanticStatus` is `ready` with done = total (timeout 10 min), run every query in the D7
    modes for each recipe, FTS variant and grouping of D18/D19 (`KIRA_EVAL_RECIPES`, default all whose
    inputs exist; key recipes need the keys files). Recipes run through an `Embedder` wrapper around the
    real client: document texts map to the recipe text, query texts pass through, `Spec().ID` gets the
    recipe suffix. FTS variants change the seeded keywords. Writes
    `P291-runs/retrieval/<runs dir>__<round>.json` (per query: id, form, source, golden id, answer ids,
    rank per variant; aggregates per variant, form, source; returned chars at 5; calibration cosines).
    No Claude, no ledger rows.
  - Bootstrap (D11) and band (D9) computed by `KIRA_EVAL_MODE=compare KIRA_EVAL_ROUNDS=<a,b>`, free:
    reads two retrieval files, writes `P291-runs/compare/<a>__<b>.json`.
- `memory_eval_footprint_test.go`: adds `C_store` and `C_distill` to `footprintRow` (ParseLocator
  decides locator reasons; `C_distill` from `extracted` in `facts.jsonl`).
- `memory_eval_test.go`: mode switch and knob comment list (`KIRA_EVAL_RUNS_DIR`,
  `KIRA_EVAL_MODEL_HOME`, `KIRA_EVAL_RECIPES`, modes `questions`, `keys`, `retrieval`, `compare`).
- Prompt and schema files: `docs/v2.5/plans/P291-corpus/{questions.md,questions.schema.json,keys.md,
  keys.schema.json}`. Terse, `CLAUDE.md` style, data-hygiene sentence as in `judge-score.md`.
No unit tests for harness code (it is test code; outputs are checked by Step 3's sanity rule).

Step 2. Questions (paid, est. 2.0, cap 2.5). Smoke first: `KIRA_EVAL_ONLY=json-ade-errors`
`KIRA_EVAL_MODE=questions`; check output and leak count, then all 15 sources. Env:
`KIRA_EVAL_RUNS_DIR=P291-runs KIRA_EVAL_LEDGER=spend-p291.jsonl KIRA_EVAL_PHASE_CAP_USD=20`. Commit
`test(memory): P291 retrieval questions` with `questions.jsonl`, ledger, results row.

Step 3. Free retrieval baseline (0 USD). `KIRA_EVAL_MODE=retrieval` on `P285-runs/`: `round-00a`,
`round-00b`, `round-02`, `round-final`, `round-p2-01`, `round-p2-01b`, `round-p2-02`, `round-p2-03`,
`round-p2-final`, `round-p3-01`, plus hold-out pairs (`round-p3-holdout` with `round-p3-01`;
`round-final` and `round-p2-final` hold-out subsets). `footprint` mode for the same rounds. `compare`
for the three identical-code pairs gives `band_R`, `band_Rk` (D9). Sanity rule: `round-p3-01`
conditional hit@10 below 0.5 or above 0.99 on hybrid means a harness bug; stop and fix before going on.
Record in `results.md`: bands, D10 thresholds as numbers, recipe and FTS tables, grouping, calibration,
the atomic-vs-merged reading (extract atomic `round-02`/`round-final` vs `round-p3-01`; unified atomic
`round-p2-02`/`round-p2-03`). Commit `test(memory): P291 free retrieval baseline and bands`.

Step 4. B0 (paid, est. 4.2, only per D15). `KIRA_EVAL_MODE=run KIRA_EVAL_ROUND=round-p291-b0
KIRA_EVAL_SET=tuning KIRA_EVAL_CAP_USD=6`, then retrieval and footprint on it. Commit
`test(memory): P291 baseline round`.

Step 5. Keys (paid, est. 0.8, cap 1.2): `KIRA_EVAL_MODE=keys` on the baseline round and
`P285-runs/round-p2-02`. Then retrieval with key variants (D18) on both, drift and merge-by-key proxy.
`compare` per D11 against the best key-free recipe. Commit `test(memory): P291 keys pass`.

Step 6. V1 port (measurement commit, D20, D21). Decide the merge setting from Step 3 data and record
it first. Port `5866fd5e1` by hand onto the current tree (no cherry-pick: Part 3, Part 4 and P289 moved
the same files):
- `internal/memory/importer/agent.go`: `Agent.Extract` becomes `Distill(ctx, DistillInput)`; `Fact`
  drops `Evidence`, gains code-set `Reason`; `ExtractInput`/`ExtractOutput` go.
- `importer/distill.go`: `ClaudeAgent` and `prompts()` move here; `ClaudeAgent.Distill` calls
  `distillCall`. `importer/extract.go` deleted.
- `importer/runner.go`: `runExtract` becomes `runDistill`; `chunkFacts` builds `Stated in <path>,
  <section>` (`memory.MaxReasonLen` bound) from the chunk.
- `importer/verify.go`: `Verdict`/`VerifyFact` drop evidence; `questionableIn` checks salient tokens
  (`salientTokens`, `salientWord`) against chunk plus context.
- `importer/db.go`: `loadExtracted` reads context too; `applyVerdicts` drops evidence.
- `internal/llmprompts/registry.go`: delete `memory.import.extract.system` and `ExtractVars`; verify
  and finalize texts evidence-free (keep P289's terse wording, drop only evidence clauses); finalize step
  1 per the merge setting. `packages/theme/src/i18n/en.json`: drop the `memoryImportExtractSystem`
  entry.
- Tests: `importer/engine_test.go`, `runner_test.go` (fake agent `Distill`), `verify_test.go` (salient
  rule cases: several interacting rules, so a unit test earns its keep), flow tests
  `apps/kira-space/internal/flows/memoryflow/{import_test,ingest_test,llmprompts_test}.go`,
  testdata `extract-*.md.json` to `distill-*.md.json`, contract golden
  `apps/kira-space/tests/contract/memory-import.json`, prompt-count assertions,
  `go run ./internal/llmprompts/cmd/checkprompts` (part of `bun run lint`).
- Harness: `recAgent.Extract` becomes `Distill` (records lines as facts; `extracted` keeps `C_distill`).
Commit `feat(memory)!: import distills each chunk` with footer `BREAKING CHANGE:
memory.import.extract.system is gone; an override of it no longer applies.` Fast checks plus
`go test ./internal/memory/... ./internal/llmprompts/... ./apps/kira-space/internal/flows/memoryflow/...`.

Step 7. V1 measurement (paid). `round-p291-v1` tuning (est. 4.5), retrieval, footprint, keys on it
(est. 0.4, only if the size rule holds). Apply D10 against the baseline; write the verdict with every
number to `results.md`, commit `test(memory): P291 V1 round`.
- Marginal: `round-p291-v1b` (est. 4.5) if the cap allows; mean decides.
- Pass: hold-out `round-p291-v1-holdout` (est. 1.3), retrieval with `round-p291-v1` distractors; D10
  hold-out rule. Fail of either: `git revert` the Step 6 commit as `revert(memory): import back to
  extract, P291 gate failed`, keep the harness `recAgent` compiling against the reverted agent.
- Commit results before any revert.

Step 8. A2 adoption (code, only if D11 holds for a recipe or constants on both bases). Files:
`internal/memory/embeddings.go` (`embedText`, model key), `internal/memory/vectors.go`
(`missingEmbeddings` returns keywords; model key used by `vectors`, `embeddingCounts`, `putEmbeddings`
callers), `internal/memory/reconcile.go` (`DocFloor` from the recipe constants), `internal/memory/embed/
spec.go` (constants only if D12 changed them, comment with the P291 measurement). Tests:
`internal/memory/service_test.go` (fake embedder keyed on recipe text: a query matching only a keyword
finds the fact semantically), flow test `apps/kira-space/internal/flows/memoryflow/semantic_test.go`
(a store with fact-only vectors re-embeds under the new key after backfill; status counts move from
indexing to ready). No IPC shape change, so no UI spec; state that in the commit body. Commit
`feat(memory): P291 embedding text <recipe>`.

Step 9. A3 adoption (code, only per D22 A3 and only if section 4 leaves 4.5 USD plus reserve). Files:
migration `internal/memory/migrations/0008_p291_subject_aspect.sql` (next free number), `model.go`
(`Memory.Subject`, `Aspect`), `store.go` (`memoryColumns`, `commitInput`, `commitAdd`/`commitUpdate`,
FTS weights in `searchFTSRows`), `gate.go` (schema fields to work), `registry.go` gate text and schema
(one rule: subject and aspect per fact), `embeddings.go` recipe, Wails bindings regenerated, TS memory
types in `packages/workbench/src/memory`, contract goldens. Tests: migration test (rebuilt FTS finds an
old fact by fact text and a new one by subject), Go flow test (store through a fake gate, search by
subject term finds the fact) and UI spec half at the IPC boundary (memory panel mock returns
`subject`/`aspect`; panel renders the fact unchanged; `memory-module.spec.ts`). Verification
`round-p291-kv` tuning (est. 4.5), retrieval, D10 against the
pre-Step 9 tree; fail reverts Step 9. Commit `feat(memory)!: P291 subject and aspect keys` with
`BREAKING CHANGE:` naming the gate schema change.

Step 10. Docs, `docs(memory): P291 retrieval eval and results`:
- `docs/ARCHITECTURE.md`: "Memory ingest eval (P285)" gains the P291 retrieval eval (modes, files,
  knobs, answer key, bands); Memory section updated for any adopted change (pipeline text, embedding
  text, constants, keys). Known open items: rewrite "Memory import is not unified with `distill`" and
  "Memory ingest compression target not met" with P291 numbers (or delete them when resolved); add an
  item for each measured-not-adopted winner (e.g. read-time grouping, keys over budget) with numbers.
- `docs/DEV_ENVIRONMENT.md`: eval row adds `questions`, `keys`, `retrieval`, `compare`, the
  `KIRA_ORT_LIB` need, P291 spend and ledger; env var table adds `KIRA_EVAL_RUNS_DIR`,
  `KIRA_EVAL_MODEL_HOME`, `KIRA_EVAL_RECIPES`, `KIRA_EVAL_EMBED_WORKER`; real `claude` rows row for
  memory import names the distill path if A1 landed.
- `site/src/content/docs/docs/space/memory.mdx` (import wording, search wording if A2/A3),
  `site/src/content/docs/docs/reference/mcp-tools.md` only if MCP texts changed,
  `reference/memory-formats.md` only if a format changed (D22 keeps v2: expected no change). Site pages
  follow the `CLAUDE.md` Communication style. `bun run site:check`; `bun run lint` runs
  `site/scripts/check-docs.ts`.

Step 11. Close-out (measurement plus checks). Full suites once: `bun run lint`, `lint:go`, `typecheck`,
`test:unit`, `test:go`, `test:ui:space` (memory specs: `memory-import`, `memory-ingest`,
`memory-distill`, `memory-module`, `memory-ranking`, `settings-llm-prompts`, `copy-coverage`,
`copy-wording`), `test:visual:space` only if a memory screen changed. Real `claude` rows (opt-in, ledger D23):
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryImport|TestMemoryIngest|TestMemoryMcpThroughClaude|TestMemoryMcpFollowsDocs|TestMemoryInstallRegisters|TestMemoryDistill|TestMemoryDistillBridge'`.
Report `docs/v2.5/plans/P291-report.md`: one section per question of section 6, numbers from
`results.md` and the JSON files, every decision with its gate arithmetic, spend table, deviations.
Close-out updates the SPEC P291 row status. Commit `docs: P291 report and close-out`.

## 4. Spend (cap 20 USD, ledger `P291-runs/spend-p291.jsonl`)

| item | est. USD | when |
|---|---|---|
| Q questions, 15 sources, Opus | 2.0 (cap 2.5) | always |
| B0 baseline tuning | 4.2 | D15 (expected) |
| K keys, baseline and p2-02 | 0.8 (cap 1.2) | always |
| V1 tuning | 4.5 | always |
| K keys on V1 | 0.4 | V1 meets the size rule |
| V1 hold-out | 1.3 | V1 passes tuning |
| real `claude` rows | 1.0 | after any adoption |
| expected total | 14.2 | |
| V1 confirmation rerun | 4.5 | marginal V1, budget allows |
| KV keys verification | 4.5 | A3 candidate, budget allows |

Free: every `retrieval`, `compare` and `footprint` run, all embeddings (local worker; one-time model
download only).

Cap check before each paid run: `ledger total + run estimate + reserve <= 20`, reserve = 1.0 (real rows)
plus 1.3 while a hold-out is still owed. A run that fails the check is not started; `results.md` records
why. Priority when both optional runs qualify: V1 confirmation first, then KV. Harness env for every paid
run: `KIRA_EVAL_PHASE_CAP_USD=20 KIRA_EVAL_CAP_USD=<estimate + 1.5>`. At the cap: stop, write the
report with what was measured.

## 5. Resumability

- Every round writes its own files before the next starts: `P291-runs/<round>/` (`facts.jsonl`,
  `judge/`, `scores.json`, `footprint-v2.json`), `P291-runs/retrieval/*.json`, `P291-runs/keys/<round>/`,
  `P291-runs/compare/*.json`, and a row in `P291-runs/results.md` (round, change, metrics, run USD,
  phase USD, verdict). Committed per step.
- Ledger appended per Claude call (harness `evalSpend`), so a crash loses no spend record.
- Harness resume: `questions.jsonl` skips done sources; keys skip present files; a run round reuses
  `facts.jsonl` records and judge files; retrieval and compare are pure functions of files.
- The last commit names the step. Step 6 and 9 code commits stand alone; a revert names the round that
  failed. Decisions D9-D11 thresholds live in `results.md` before the run they judge.
- Cap check reads the ledger file, never memory.

## 6. Questions the report answers

1. Retrieval today: hit@1/5/10 and MRR, hybrid vs keyword vs semantic, end-to-end vs conditional,
   per category and per form.
2. Noise: `band_R`, `band_Rk` from identical code.
3. Calibration: query and doc cosine distributions vs 0.55/0.70/0.85.
4. Unified pipeline (V1, p2-02, p2-03) vs current on retrieval, `R_ess`, `R_all`, `P`, sizes.
5. Atomic vs merged; read-time grouping by section and by subject.
6. Explicit subject and aspect: retrieval gain over keywords and over the best key-free recipe; extra
   output tokens (chars per fact, runes/3); key drift; merge-by-key proxy vs model merge.
7. Embedding text: `fact`, `fact-kw`, `sec-fact`, `sec-fact-kw`, `sa-fact`, `sa-fact-kw`.
8. Value of gate keywords (`nokw`) on retrieval vs their `C_store` cost.
9. "Half" expectation (D14): measured ratios at measured recall.
10. What was adopted, what was not, with the gate arithmetic; spend.

## 7. Risks

- Judge `by` noise feeds the answer key; bands from identical code absorb it, and same-facts comparisons
  share one key.
- Small stores (200-400 facts) make retrieval easier than a real 10k store; relative comparisons hold
  better than absolute numbers (caveat in the report).
- One-fact `ApplyDoc` docs give each fact its own request group; import groups up to 20. Group boost
  differs slightly; document groups dominate.
- P289 may change extract and gate so B0 differs from `round-p3-01`; D15 covers it, at 4.2 USD.
- The port of `5866fd5e1` meets moved code; it is a hand port with the same behavior, not a cherry-pick.
- The embed worker under the test binary needs `KIRA_ORT_LIB`; without it `retrieval` fails fast with a
  clear message instead of silently going keyword-only.
- Budget: one optional 4.5 USD run fits, not two.

## 8. Out of scope

Chunk budget change (pending user decision since P285); judge and golden prompts (frozen); read-time
grouping in search output; write-time merge-by-key; memfmt v3; ranking fusion weights and boosts other
than D12 constants; reconcile behavior beyond the D22 recipe floor; the Artifact page (not asked);
multilingual embeddings.

## 9. Open items for the final message

- If V1 wins on recall but not on retrieval beyond `band_R`, D10 keeps the current pipeline: the user
  may still want unified for recall (goal 2).
- Read-time grouping is never adopted here; if it wins, it needs a phase for the result-shape change.
- A3 keys adoption depends on a 4.5 USD verification round; if the cap blocks it, the numbers go to
  Known open items and the user decides on a follow-up phase.
- Hold-out baseline is `round-p3-holdout` (pre-P289 tree) unless B0 is skipped.
- Retrieval on 10-source stores understates difficulty at scale.
