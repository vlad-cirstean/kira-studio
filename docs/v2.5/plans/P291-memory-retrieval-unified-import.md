# P291 plan: memory retrieval, unified import and telegraphic memory output

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

User direction added after the first plan (final): memory module and `distill` produce TELEGRAPHIC
output. Only words that carry meaning survive. Keep negations (not, never, no, only, except), numbers,
units, names and exact technical terms. Apply `CLAUDE.md` Communication style: cut articles, hedges and
pleasantries; fragments fine; no invented abbreviations; no arrow connectors; clarity wins. User sees
much more room than P285 Part 2/3 and P289 got. Scope: memory module only. That means the extract,
gate, reconcile, finalize, verify and distill prompts as they shape stored or returned text, plus
stored fact text, reason text and distill output. Other prompts and the MCP/tool texts stay out of
scope. P289's landed work stays as is. Goal order unchanged. One system, not two.

Base: `v2.0` at `45df3cfa0` (P290 close-out). P289 is not on `v2.0` yet: branch `p289` holds Steps 0-5
and 7, Step 6 pending. P291 runs after P289 lands (table order). Step 0 re-checks every fact below
that names a file P289 touches.

Discovery ran through `codegraph_explore`. First pass (11 calls): `Distiller.Distill`/`distillCall`/
`cleanLines`, `mcpserver.addDistillTool`, `bridge.MemoryService` (`service`, `importer`, `Search`,
`watch`), `importer.Engine`, `store` (db.go: `claimVerify`, `claimFinalize`, `loadExtracted`,
`storeDoc`), `ClaudeAgent.Extract`/`Verify`/`Finalize`, `cleanFacts`, `Questionable`,
`RenderDoc`/`writeDocFile`, `Agent`/`Fact`/`FinalFact`, `Service.Search`/`semanticPool`/`candidates`/
`prepare`/`commit`/`vectorFor`/`embedDoc`/`backfillOnce`/`ApplyDoc`/`applyDocFact`, `rank.go` (all),
`embed.Spec`/`Default`/`Client`/`NewClient`/`RunWorker`, `vectors.go` (all), `memfmt` (`Doc`, `Fact`,
`FormatDoc`, `ParseDoc`), `appwire.RunArgvShim`, registry memory entries, `ranking_test.go`. Telegraphic
revision (8 calls): registry `MemoryGateSystem`, `MemoryDistillSystem`, `MemoryImportFinalizeSystem`,
`MemoryImportVerifySystem`, `MemoryReconcileSystem`, `MemoryDataHygiene`; `entry.go` (`KindFragment`,
`define`, `RequiredFragments`); `gate.go` (`runGate`, `validateGate`, `cleanKeywords`); `match.go`
(`stopwords`, `matchTerms`, `BuildMatch`, `factHash`); `store.searchFTSRows`; `rank.coverage`/
`keywordPart`; `hybrid.Search`/`semanticPool`; `embeddings.embedDoc`/`vectorFor`/`backfillOnce`;
`embed.Client.Embed`, `ortEncoder.embed` (CLS pooling). Bash only where CodeGraph does not reach: the
eval harness (`apps/kira-space/tests/claude`, not indexed), `git show 5866fd5e1`, branch `p289`
(`promptsizes/tokens.go`, `checkprompts/style.go`, `budget.tsv`, P289 results), P285 run ledgers and
judge files, docs.

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
Step 0 re-checks). `memories_fts` indexes fact, keywords, reason (bm25 10, 6, 3); tokenizer
`porter unicode61 remove_diacritics 2`.

Distill (`importer/distill.go`): `Distiller.Distill` chunks like import, runs `distillCall` per chunk
(`memory.distill.system`, schema `lines[{text, unresolved}]`, max 40 lines), 3 workers, 2 USD cap. Shared
by MCP `distill` (`mcpserver/distill.go`) and Space `MemoryDistillService` (`bridge/memorydistill.go`).
Import does not use it (P285 Part 2 fallback).

Who writes stored and returned text, and its style today:
- Gate step 1 is the last writer of every stored fact on every path (MCP, UI, import): "shortest plain
  form ... drop articles only where meaning stays clear", keep negations, numbers, units, names,
  identifiers, paths, error strings, ids. Step 2: reason "in the same short plain style"; a
  `Stated in` locator stays verbatim. So a telegraphic extract alone does not reach the store: the
  gate rewrites it back to plain style unless the gate carries the same style.
- Reconcile: an update's fact and reason "use the short plain style of stored facts".
- Finalize step 4: item fact standalone, inline rationale only when not obvious. Verify: a "rewritten"
  fact is a "corrected standalone sentence".
- Distill: "Terse: cut articles, filler, hedges, pleasantries. Fragments fine. ... No invented
  abbreviations, no arrows." plus a "Keep verbatim" line. Closest to telegraphic today; output is
  returned, not stored.
- Extract: "one complete sentence of at most 300 characters".
- The style wording is duplicated across five prompts, each slightly different. No shared fragment.
  `memory.dataHygiene` (`KindFragment`, `RequiredFragments`) is the existing shared-fragment pattern.

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

Keyword path and style: `matchTerms` drops query stopwords (articles, pronouns, and also `no` and
`not`), so articles in a fact never match a query and negations never help a keyword match. `coverage`
counts query terms that prefix-match fact or keyword tokens: dropping articles changes nothing there.
bm25 normalizes by document length: a shorter fact scores higher for the same matched terms, so in a
store mixing styles telegraphic facts get a rank lift. `factHash` normalizes case and whitespace only:
a telegraphic rewrite of an existing fact is a new hash, so the hash noop misses and reconcile decides.

Embedder: `embed.Default` = arctic-embed-s int8 ONNX, 384 dims, CLS pooling, local worker subprocess
(`<exe> memory-embed`, `embed.RunWorker`), `ClientOptions.Command` replaceable. Trained on natural
sentences; fragment text is out of its usual input shape (risk measured, not assumed). Embeds the `fact`
text only (`embedDoc`, `vectorFor`, `backfillOnce`); query gets the spec prefix. Vectors live in
`memory_embeddings` (`seq` PK, `model` text; a new model key overwrites by `INSERT OR REPLACE`).
Local and free: the only network use is the one-time 35 MB model download from Hugging Face (proxy
reachable here); `scripts/fetch-onnxruntime.sh linux-x64` plus `KIRA_ORT_LIB` enable it in this sandbox.

Free store seeding: `Service.ApplyDoc` stores a parsed doc's facts as they are (no gate, no reconcile,
no Claude), keeping each fact's reason verbatim, with the doc-level keywords, then kicks the backfill.
A one-fact doc per stored fact reproduces fact, reason and per-fact keywords exactly.

P289 (branch `p289`, lands before P291): memory-pipeline prompts -1.1% chars (gate -2.0%, extract -3.7%;
5 others already terse). `round-p289-01` (5 tuning sources) passed every band against `00a`/`00b`. A
bolder extract rewrite (-9.7%) lost precision: `01c` `P` 0.541, `01d` 0.596, mean 0.568 under floor
0.570; reverted. P noise between `00a` and `00b` was 0.106, above the P285 band 0.065. Tools it adds:
`promptsizes -snapshot/-compare/-allowed` with a protected-token loss check (`lost()` in
`cmd/promptsizes/tokens.go`: numbers, backtick spans, double-quoted spans, dotted/underscored/camelCase
identifiers, template actions, schema fields, negation counts); `checkprompts` filler style rule
(outside quotes and backticks) and `internal/llmprompts/testdata/budget.tsv` (per-entry rune ratchet;
memory lines: gate 3316, extract 1950, distill 1763, finalize 2615, reconcile 1344, verify 1355,
dataHygiene 177).

Eval harness (`apps/kira-space/tests/claude/memory_eval*_test.go`, `bun run eval:memory`,
`KIRA_MEMORY_EVAL=1`): modes `prepare`, `golden`, `run`, `footprint`. A run ingests each source into a
fresh store (embedder off), records `facts.jsonl` (stored fact, reason, keywords; extracted facts;
stages), judges with frozen Opus prompts into `judge/<source>.json` (per golden fact `covered` full 1,
partial 0.5, none 0, and `by`: the stored fact ids that state it), writes `scores.json` (`R_ess`,
`R_all`, `P`, atomic, standalone, unsupported, duplicate, `C_fact`, `C_rec`, `C_doc`). Ledger per part
via `KIRA_EVAL_LEDGER`; run cap `KIRA_EVAL_CAP_USD`, phase cap `KIRA_EVAL_PHASE_CAP_USD` (stops starting
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

Retrieval eval (unchanged from the first plan except where marked):

- D1. Retrieval eval reuses the P285 harness and corpus. New modes `questions` (paid, once), `keys`
  (paid), `telegraph` (paid, new), `retrieval` (free). Why: one harness, frozen corpus and judge,
  comparable rounds.
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
  `R_ess`, `R_all`, `P`, atomic, standalone, unsupported; new token recall (D27). `C_store` = fact +
  non-locator reason + keywords (+ subject and aspect when present) chars over source chars; a
  code-built `Stated in` locator is metadata, stored once per section in the doc. `C_distill` = the
  pipeline's pre-finalize lines over source chars.
- D9. Retrieval band `band_R` = max `|delta MRR@10|` (hybrid, tuning, end-to-end) over the three
  identical-code pairs, floor 0.02; `band_Rk` the same for `keyword`; `band_tok` (new) the same for token
  recall (D27), floor 0.01. Computed in Step 3 and written to `results.md` before any paid pipeline run.
  Why: P285 method (bands from identical code), now free.

Gates (D10, D11, D12, D13, D14, D15 updated for the telegraphic arm):

- D10. Cross-pipeline gate (different fact sets: V1T or XT vs base). Adopt the unified pipeline (A1)
  iff all hold on tuning: `MRR_hybrid(V) - MRR_hybrid(base) > band_R`;
  `MRR_keyword(V) >= MRR_keyword(base) - band_Rk`; `R_ess(V) >= R_ess(base) - 0.020`; unsupported
  <= 0.020; token recall `>= base - band_tok`; `C_fact < 1.0`, `C_store < 1.0`, `C_doc < 1.0`.
  Telegraphic style (A4) on a run needs the non-inferior form instead of "beats":
  `MRR_hybrid(V) >= MRR_hybrid(base) - band_R`, the same keyword, `R_ess`, unsupported, token-recall and
  size rules, plus `C_store(V) < C_store(base)`, plus the same-facts telegraph gate D26 passed. Marginal
  A1 (`band_R < delta <= 1.5 band_R`): one confirmation rerun when the cap allows (section 4), mean of
  both decides; not affordable means not adopted. After adoption, hold-out:
  `MRR_hybrid(V, hold-out) >= MRR_hybrid(base hold-out) - band_R`, else revert. `P`, `R_all`, atomic,
  standalone, `reason ok` reported, not gated. Why: the row's adopt rule for A1; the user's rule for
  telegraphic output is "not lose retrieval beyond the noise band", not "beat it"; `P`, atomic and
  standalone move by design with merging and by judge style bias (D28); unsupported guards invention.
- D11. Same-facts gate (recipes, keys, grouping, constants, style on one fact set): paired bootstrap over
  queries (2000 resamples, fixed seed) of per-query reciprocal-rank difference. An improvement variant
  (recipe, keys, constants) is adopted iff the 95% CI lower bound > 0 and mean delta >= 0.02 on two
  bases. A size variant (telegraphic style) passes iff the 95% CI lower bound > `-band_R` on two bases
  (non-inferiority). Bases: `round-p3-01` and `round-p2-02`; the adopted pipeline's round replaces
  `round-p2-02` when one is adopted. Why: same facts remove pipeline noise; two bases guard against one
  fact set's quirks; non-inferiority is the right test for a change whose win is size.
- D12. Calibration: per recipe and per style, query-to-answer cosine (positives) and
  query-to-other-source cosine (negatives), p10/p50/p90 each; doc-to-doc cosine of paraphrase pairs
  (stored facts covering the same golden fact in two rounds of different code) vs unrelated pairs. Style
  pairs (new): cosine of each full fact with its own telegraphic rewrite (same meaning, D25), p10/p50
  against `DocFloor` 0.85. P275 method: `QueryFloor` = negative p90, `QueryCeil` = positive max of
  paraphrase-like pairs, `DocFloor` between paraphrase p10 and unrelated p99. New constants are a
  same-facts variant (D11) and must not drop hold-out MRR beyond `band_R`. Why: answers "calibrate
  against 0.55/0.70/0.85" with data per style; a style-pair p10 under 0.85 means reconcile misses
  vector candidates between old full facts and new telegraphic ones (FTS candidates still apply).
- D13. Stored-size rule replaces the `C_fact` targets: `C_fact`, `C_store`, `C_doc` each < 1.0 on the
  tuning aggregate; per-source values over 1.0 are reported, not gated. The 0.30 `C_fact` target and the
  "`C_fact` not worse" rule are retired. Telegraphic style adds one rule: `C_store` strictly below the
  full-style value on the same pipeline. Why: the user's rule; dense sources (doc-arch-prompts near 1.0)
  are fact lists already and would fail on noise; a style that does not shrink has no reason to exist.
- D14. "Half" test: report `C_distill`, `C_fact`, `C_store`, `C_doc` per variant and style, per source,
  per category and aggregate, next to the golden floors (0.47 essential, 0.71 all), `C_fact / R_all`
  (chars per recalled share) and the style-only ratio (telegraphic chars over full chars on identical
  facts). The report states how close each variant gets to 0.5, per source and aggregate, and at what
  recall. Estimate before measuring: telegraphic cuts fact chars 15-30% against today's gate-trimmed
  facts (articles about 8% of words, copulas and auxiliaries about 5%, the rest already cut), so
  `round-p3-01` `C_fact` 0.434 lands near 0.31-0.37; `C_store` stays higher because keywords are not
  restyled (priced by `nokw`). Why: the expectation is testable from run data at no extra cost.
- D15. Baseline: `round-p3-01` (tuning) and `round-p3-holdout` (hold-out). A fresh B0 round runs only
  when Step 0 finds a memory-pipeline change since `9c09012fe` that no passing eval round measured.
  Changed: the first plan ran B0 whenever P289 touched extract or gate. P289's `round-p289-01` passed
  every band with those two edits, and its bolder edit was reverted. Why: P289 measured its own memory
  edits; the 4.2 USD funds the telegraphic arm instead; the report names the tree difference.
- D16. Pipeline embedder stays off during paid runs; only the retrieval store has it on. Why: keeps
  paid rounds comparable to every P285 round; per-source fresh stores give reconcile almost no vector
  candidates anyway (noted as caveat).

Keys and recipes (unchanged; key rounds renamed to the new base and V1T):

- D17. Keys pass K: Sonnet (`--model sonnet`, the production extractor model), one call per source per
  round over its stored facts, frozen prompt and schema in `P291-corpus/keys.md`, `keys.schema.json`:
  per fact `subject` (1-5 words, the source's own name for the thing) and `aspect` (1-3 words, which
  property: default, limit, reason, behavior, owner, format, ...). Rounds: the base, `round-p2-02`,
  later V1T. Why: isolates the value of explicit keys on identical facts; cheaper than a pipeline run.
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

Telegraphic output (new):

- D24. One style, one fragment. New registry fragment `memory.factStyle` (`KindFragment`, `spaceApp`,
  `NextCall`, catalog keys `llmPrompts.entry.memoryFactStyle.*`), carried by `{{template}}` plus
  `RequiredFragments` in every memory prompt that writes stored or returned text: distill (replaces its
  "Terse" and "Keep verbatim" lines), gate (replaces the step 1 style sentence and step 2's "same short
  plain style"), finalize (step 4 item fact), reconcile (the "short plain style of stored facts" clause),
  verify (the "rewritten" fact), and extract while it exists. Draft text; the implementer may only
  tighten it under the same rules: "Telegraphic: keep only words that carry meaning. Cut articles,
  copulas and auxiliaries where meaning stays clear, filler, hedges, pleasantries. Fragments fine. Keep
  verbatim: negations (not, never, no, only, except), numbers, units, names, code identifiers, paths,
  ids, quoted text, error strings. Keep every qualifier: conditions, exceptions, limits. Never invent
  abbreviations; never replace a word with an arrow or symbol. A pronoun only when its referent is
  named in the same fact. When a shorter form could change the meaning, keep the words." It names no
  hedge word outside double quotes (the `checkprompts` filler rule). Applies to fact and reason text; a
  `Stated in` locator and keywords stay as they are. Why: the gate is the last writer of every stored
  fact, so one shared text is the only way every path writes the same style (one system); one place for
  a user override; a fragment is the existing pattern (`memory.dataHygiene`).
- D25. Two ways to produce telegraphic text, both measured, one adopted:
  - `tele` post-pass (measurement only): `KIRA_EVAL_MODE=telegraph` rewrites the stored facts of an
    existing round. Sonnet, one call per source per round, frozen prompt `P291-corpus/telegraph.md` =
    the D24 fragment text verbatim plus a wrapper ("rewrite each fact; same id; exactly one output per
    input; never merge, split, add or drop a fact; non-locator reasons too"), schema
    `telegraph.schema.json` `{facts:[{id, fact, reason}]}`. Keywords, ids, locator reasons and the judge
    `by` lists carry over unchanged. Rounds: the base, `round-p2-02`, `round-p3-holdout`. Writes
    `P291-runs/telegraph/<round>/<source>.json` (resume: present files skipped). Why: identical facts
    and an identical answer key isolate the style's retrieval effect for about 0.05 USD per call; D11
    applies directly.
  - Prompt level (adopted form): the D24 fragment in the registry, measured by the paid V1T run (D20).
    Why: the product writes the style once, at gate and distill time; a post-pass would be a second LLM
    call per fact and a second system.
  The post-pass is never adopted as a production step, and existing stored memories are never
  rewritten. Why: cost per store, two systems, and a silent rewrite of user facts.
- D26. Same-facts telegraph gate (free after the post-pass and TJ): on the base and `round-p2-02`,
  `tele` vs `full`: D11 non-inferiority on `hybrid` with `band_R` and on `keyword` with `band_Rk`; token
  check (D27) residual loss <= 0.01 of facts after one retry; TJ (D28) `R_ess(tele) >= R_ess(full) -
  0.020` and unsupported `<= full + 0.010`; `C_store(tele) < C_store(full)`. Variant `tele-guard`
  (failing facts keep their full text, free) is measured alongside; when only `tele` fails the token
  rule, `tele-guard` decides. Verdict goes to `results.md` before V1T starts. Why: the user's adopt rule
  (no retrieval loss beyond noise, token-preservation check passes) on the cleanest comparison.
- D27. Token-preservation check, deterministic code. `lost()` moves from
  `internal/llmprompts/cmd/promptsizes/tokens.go` into new package `internal/textloss`
  (`Lost(old, cur string, fields []string) []string`); `promptsizes` calls it with unchanged behavior.
  Classes: P289's (numbers, backtick spans, double-quoted spans, dotted/underscored/camelCase
  identifiers, template actions, schema fields, negation counts for not, never, no, only, except, n't)
  plus two for memory text: paths (tokens holding `/`) and names (capitalized words other than the
  text's first word, and all-caps words of 2+ letters). Matching is case-sensitive except negations.
  Two uses:
  - Pairwise (`tele` post-pass): each full fact against its rewrite. A failing fact is re-asked once in
    one follow-up call per source that names the lost tokens; still failing counts as residual loss and
    is listed per id in `P291-runs/telegraph/<round>/losses.tsv`.
  - Golden-anchored token recall (any round, free): per golden fact with `covered` full or partial,
    share of its protected tokens present in the union of its `by` facts; aggregate over tuning. Works
    across pipelines where merge and split break one-to-one pairs. Compared against `band_tok` (D9).
  No runtime check in production. Why: at write time no full text exists to compare against, and a hard
  refusal would drop facts (goal 2); a residual loss above zero becomes a Known open item with the rate.
  One implementation serves prompts and facts, never a second copy.
- D28. Judge bias control. The frozen Opus judge rates atomic, standalone, unsupported and covered.
  Fragments may read as less standalone or less clear with no meaning lost. Control: TJ re-judges the
  base's `tele` facts (tuning) with the same frozen prompts (`score` judge only; golden unchanged).
  Style effect on the judge = TJ minus the original judge file on identical meaning. Gate on coverage
  (`R_ess`), unsupported, token recall and retrieval only; standalone, atomic and `P` deltas are
  reported as the judge's style bias and used to read V1T's numbers. Judge prompts stay frozen. Why:
  retrieval and coverage are what the user ranks; a frozen judge keeps rounds comparable; one re-judge
  measures the bias instead of guessing it.
- D29. Retrieval effects of the style, all measured free in `retrieval` mode, per style `full`, `tele`,
  `tele-guard`:
  - Embedding text: style x recipe (`fact`, `fact-kw`, `sec-fact`, best key recipe). The style changes
    only the fact part of a recipe.
  - Keyword: no query change (stopwords already drop articles and negations); report the bm25 length
    effect.
  - Mixed store: one store with `tele` facts for odd sources and `full` for even, and the swap; MRR per
    style within the store. Why: real users keep their full-style memories (D25), so new telegraphic
    facts compete with old ones; a style rank bias (bm25 length or embedding shape) shows here.
  - Calibration per style (D12), including style pairs against `DocFloor`.
  - Standalone-ness: TJ standalone (D28) plus the subject-cut count: `tele` facts that keep no name,
    identifier or noun phrase of their full text (code check, reported).
- D30. Distill output follows the same fragment. `C_distill` (V1T import lines) and MCP `distill` output
  share it by construction. The `instructions` mode keeps its own rule line (short imperatives, "must",
  "never" and "only" force, template variables) after the fragment. Why: distill is the base of import
  (D20); one style for both.

Pipeline variant and adoption:

- D20. V1T = unified pipeline ported onto the current tree (distill per chunk, code-built locator, no
  evidence, salient-token questionable rule, evidence-free verify) plus the D24 fragment. Merge setting
  chosen before the paid run from free data: if `mean(MRR p2-02, p2-03) - MRR(base) > band_R`, V1T is
  atomic (finalize step 1 merges duplicates and near-duplicates only); else V1T keeps the current
  finalize merge rule. Changed: the first plan's V1 had no style change. Why: one paid run measures the
  system the user describes (unified plus telegraphic); the unified effect alone reads from
  `round-p2-02`/`round-p2-03` (free retrieval) and the style effect alone from D26; a style-free V1 run
  does not fit beside the telegraphic arm.
- D21. V1T lands as two measurement commits on the chapter branch (6a unified, 6b style), each reverted
  on its own with `revert(memory): …` when its gate fails (P285 Part 2 precedent `16d4e5ed9`). Why: the
  real pipeline must run to be measured; two commits keep the two decisions separable in history.
- D31. V1T outcome (tuning first, then hold-out):
  - Passes D10 for A1 and for A4: keep 6a and 6b; hold-out; K on V1T.
  - Marginal A1: confirmation rerun when the cap allows; else treat as the next case.
  - Else: revert 6b and 6a. If D26 passed, run XT when the cap allows: the current extract pipeline
    plus the fragment (also in `memory.import.extract.system`). XT adopts A4 alone iff the A4 form of
    D10 holds against the base. If D26 failed, the style stays measurement-only.
  Why: A1 needs "beats"; A4 needs "not worse plus smaller"; XT is the only way to adopt A4 when A1
  fails.
- D22. Adoption scope per winner:
  - A1 unified pipeline: keep commit 6a (section 3, Step 6).
  - A2 embed recipe or constants: `internal/memory/embeddings.go` builds the document text through one
    `embedText(fact, keywords)` used by `embedDoc`, `vectorFor`, `backfillOnce` (backfill query reads
    keywords); vector model key `embed.Default.ID + "/" + recipe` (no migration: `INSERT OR REPLACE` on
    `seq`, backfill re-embeds). Recipe-calibrated `QueryFloor`/`QueryCeil`/`DocFloor` (D12) replace the
    spec values when they differ beyond 0.01. Model directory and `SemanticStatus.Model` stay
    `spec.ID`. A recipe is chosen on the adopted style's facts.
  - A3 explicit keys (only if D11 holds against the best A2 recipe, not just against `fact`, and the
    budget covers its verification round): gate schema adds `subject` and `aspect` per fact (the one
    writer every path shares: MCP, UI, import); migration `0008_p291_subject_aspect.sql` (or next free
    number) adds both columns `NOT NULL DEFAULT ''` and rebuilds `memories_fts` with a `subject` column
    holding "subject aspect" (bm25 weight 6); embed recipe from D18; `Memory` JSON gains `subject`,
    `aspect` (omitempty). memfmt stays v2: keys are DB-only like per-fact keywords; `ApplyDoc` leaves
    them empty. Write-time merge-by-key is not adopted.
  - A4 telegraphic style (code, commit 6b or the XT commit): `internal/llmprompts/registry.go` fragment
    `memory.factStyle` and its use in distill, gate, finalize, reconcile, verify (extract only under
    XT); replaced sentences removed, never duplicated. `packages/theme/src/i18n/en.json`
    `llmPrompts.entry.memoryFactStyle.{title,description,usedBy.body}` (copy rules apply).
    `internal/llmprompts/testdata/budget.tsv`: a line for the fragment; each edited prompt's line set
    to its new size (a prompt that grows because it renders the fragment says so in the commit body).
    `checkprompts` style rule green. `promptsizes -compare docs/v2.5/plans/P291-runs/before.json
    -allowed docs/v2.5/plans/P291-runs/allowed-losses.tsv` exits 0, every intended loss listed with why
    (a sentence moved into the fragment counts as kept only when the fragment holds its tokens).
    Goldens under `internal/llmprompts/testdata/golden` regenerated (P289 D11 `-update`),
    prompt-count assertions +1, fakeagent keys still substrings, contract goldens that embed prompt
    text. Tests split at the IPC boundary: Go flow test in
    `apps/kira-space/internal/flows/memoryflow/llmprompts_test.go` (the registry lists
    `memory.factStyle`; an override of it reaches the gate system text) and the UI half in
    `settings-llm-prompts` (Settings lists the fragment with its catalog copy; an override round-trips).
    `internal/textloss` lands in Step 1 (harness and `promptsizes` both use it).
  - Measurement only, never adopted here: the post-pass, the `tele-guard` fallback, a runtime token
    check, rewriting stored memories, read-time grouping (it changes the search result shape across MCP
    text, bridge, UI and contract; a separate phase if it wins).
- D23. Real `claude` rows are counted in the ledger as kind `real-rows` from the suite's printed
  `claude -p` spend (estimate 1.0 USD). Why: the cap is for the whole phase.

## 3. Steps (one Sonnet implementer)

Each step is one commit group, Conventional Commits, trailers on separate lines. Hooks pass normally.
Fast checks per code commit: `go build ./...`, `go vet` of touched packages, `bun run lint`,
`bun run lint:go`, `bun run typecheck`; nested module: `cd apps/kira-space/tests/claude && go vet ./...
&& go test -count=1 -run TestMemoryIngestEval ./...` (skips without `KIRA_MEMORY_EVAL`). Paid steps run
the cap check of section 4 first. Every round appends to `P291-runs/results.md` and commits before the
next round starts.

Measurement-only: Steps 0, 2-5, 7 (paid runs), 11. Code: Step 1's `internal/textloss` refactor (always),
Steps 8, 9 and kept Step 6/XT commits (only after their gates). Step 6 and XT commits are measurement
commits, reverted on failure (D21, D31).

Step 0. Preflight. Fetch `origin/v2.0`; confirm the P289 row is Done and `budget.tsv`,
`promptsizes -compare/-allowed` and the `checkprompts` style rule are on `v2.0` (else stop: P291 runs
after P289). `sh scripts/fetch-onnxruntime.sh linux-x64`, export `KIRA_ORT_LIB`. The Step 2 smoke
proves the `claude` CLI works. Re-read what P286-P290 touched among section 1's files:
`git diff --stat 9c09012fe..HEAD -- internal/memory internal/llmprompts/registry.go
apps/kira-space/tests/claude`. Record the B0 decision (D15), the latest migration number and any
section 1 fact that moved in `P291-runs/results.md` (create it: header, spend table, bands table empty).
`go run ./internal/llmprompts/cmd/promptsizes -snapshot docs/v2.5/plans/P291-runs/before.json`. Commit
`test(memory): P291 runs ledger and preflight`.

Step 1. Harness.
- `internal/textloss/textloss.go` (new): `Lost` with the D27 classes. `internal/llmprompts/cmd/
  promptsizes` calls it; its `tokens.go` goes. `internal/textloss/textloss_test.go`: one table test
  (several interacting token classes and count-based negations: earns a test under `CLAUDE.md`).
  `promptsizes -compare` against `before.json` still exits 0. Commit
  `refactor(llmprompts): share the protected-token check`.
- Rest in `apps/kira-space/tests/claude`, commit `test(memory): P291 retrieval and telegraph eval
  harness`:
- `memory_eval_corpus_test.go`: `evalRunsDir` reads `KIRA_EVAL_RUNS_DIR` (relative to
  `docs/v2.5/plans`, default `P285-runs`); `evalPlansDir()`; a round reference `<runs dir>/<round>`
  resolves under it.
- `memory_eval_judge_test.go`: `judgeCall` takes the model (`opus` for golden, score, questions;
  `sonnet` for keys and telegraph). Ledger path follows `KIRA_EVAL_RUNS_DIR`. Score mode accepts
  `KIRA_EVAL_STYLE=tele` to judge a round's telegraph files instead of its stored facts, writing
  `judge-tele/<source>.json` and `scores-tele.json` (TJ).
- `main_test.go`: `KIRA_EVAL_EMBED_WORKER=1` re-exec runs `embed.RunWorker(os.Args[2:])`.
- `memory_eval_retrieval_test.go` (new): modes `questions`, `keys`, `telegraph`, `retrieval`, `compare`.
  - `questions`: per source, Opus with `P291-corpus/questions.md` and `questions.schema.json` (input:
    source text, essential golden facts with id, fact, quote; output per golden id `question` (one
    sentence, at most 20 words, how a developer asks when they need it, own words) and `query` (3-6
    words an agent types into search)). D3 leak guard in code. Appends to
    `P291-corpus/questions.jsonl` (resume: sources present are skipped); ledger kind `questions`.
  - `keys`: per round in `KIRA_EVAL_ROUNDS`, per source, Sonnet with `P291-corpus/keys.md` and
    `keys.schema.json` over that round's stored facts; output to `P291-runs/keys/<round>/<source>.json`
    (resume: present files skipped); ledger kind `keys`.
  - `telegraph`: per round, per source, Sonnet with `P291-corpus/telegraph.md` and
    `telegraph.schema.json` (D25); code checks the id set (a missing or extra id fails the source, one
    retry); `textloss.Lost` per fact (D27), one retry call per source for failing facts; writes
    `P291-runs/telegraph/<round>/<source>.json` and `losses.tsv`; ledger kind `telegraph`.
  - `retrieval`: per round in `KIRA_EVAL_ROUNDS` (and `KIRA_EVAL_SET`): seed the store (D6), wait
    until `SemanticStatus` is `ready` with done = total (timeout 10 min), run every query in the D7
    modes for each recipe, FTS variant, grouping (D18, D19) and style (`KIRA_EVAL_STYLES`: `full`,
    `tele`, `tele-guard`, `mixed`, `mixed-swap`; style files must exist). `KIRA_EVAL_RECIPES` defaults
    to all whose inputs exist; key recipes need the keys files. Recipes run through an `Embedder`
    wrapper around the real client: document texts map to the recipe text, query texts pass through,
    `Spec().ID` gets the recipe suffix. FTS variants change the seeded keywords; styles change the
    seeded fact and reason. Writes `P291-runs/retrieval/<runs dir>__<round>.json` (per query: id, form,
    source, golden id, answer ids, rank per variant; aggregates per variant, form, source; returned
    chars at 5; calibration cosines per recipe and style; style-pair cosines). No Claude, no ledger
    rows.
  - `compare`: `KIRA_EVAL_ROUNDS=<a,b>` (two rounds) or `KIRA_EVAL_VARIANTS=<x,y>` (two variants of one
    round), free: paired bootstrap (D11, both forms) and bands (D9); writes
    `P291-runs/compare/<a>__<b>.json`.
- `memory_eval_footprint_test.go`: adds `C_store`, `C_distill` and token recall (D27) to `footprintRow`
  (ParseLocator decides locator reasons; `C_distill` from `extracted` in `facts.jsonl`); with
  `KIRA_EVAL_STYLE=tele`, the same row for the telegraph files plus the style-only ratio and the
  subject-cut count (D29).
- `memory_eval_test.go`: mode switch and knob comment list (`KIRA_EVAL_RUNS_DIR`,
  `KIRA_EVAL_MODEL_HOME`, `KIRA_EVAL_RECIPES`, `KIRA_EVAL_STYLES`, `KIRA_EVAL_STYLE`,
  `KIRA_EVAL_VARIANTS`, modes `questions`, `keys`, `telegraph`, `retrieval`, `compare`).
- Prompt and schema files: `docs/v2.5/plans/P291-corpus/{questions.md,questions.schema.json,keys.md,
  keys.schema.json,telegraph.md,telegraph.schema.json}`. Terse, `CLAUDE.md` style, data-hygiene sentence
  as in `judge-score.md`. `telegraph.md` holds the D24 fragment text verbatim; Step 6b copies it into the
  registry unchanged. A later wording change is a new measurement, not an edit.
No unit tests for harness code (it is test code; outputs are checked by Step 3's sanity rule).

Step 2. Questions (paid, est. 2.0, cap 2.5). Smoke first: `KIRA_EVAL_ONLY=json-ade-errors`
`KIRA_EVAL_MODE=questions`; check output and leak count, then all 15 sources. Env:
`KIRA_EVAL_RUNS_DIR=P291-runs KIRA_EVAL_LEDGER=spend-p291.jsonl KIRA_EVAL_PHASE_CAP_USD=20`. Commit
`test(memory): P291 retrieval questions` with `questions.jsonl`, ledger, results row.

Step 3. Free retrieval baseline (0 USD). `KIRA_EVAL_MODE=retrieval` on `P285-runs/`: `round-00a`,
`round-00b`, `round-02`, `round-final`, `round-p2-01`, `round-p2-01b`, `round-p2-02`, `round-p2-03`,
`round-p2-final`, `round-p3-01`, plus hold-out pairs (`round-p3-holdout` with `round-p3-01`;
`round-final` and `round-p2-final` hold-out subsets). `footprint` mode for the same rounds (token recall
included). `compare` for the three identical-code pairs gives `band_R`, `band_Rk`, `band_tok` (D9).
Sanity rule: `round-p3-01` conditional hit@10 below 0.5 or above 0.99 on hybrid means a harness bug; stop
and fix before going on. Record in `results.md`: bands, D10 and D26 thresholds as numbers, recipe and FTS
tables, grouping, calibration, the atomic-vs-merged reading (extract atomic `round-02`/`round-final` vs
`round-p3-01`; unified atomic `round-p2-02`/`round-p2-03`), the D20 merge-setting input. Commit
`test(memory): P291 free retrieval baseline and bands`.

Step 4. B0 (paid, est. 4.2, only per D15; not expected). `KIRA_EVAL_MODE=run
KIRA_EVAL_ROUND=round-p291-b0 KIRA_EVAL_SET=tuning KIRA_EVAL_CAP_USD=6`, then retrieval and footprint on
it; it then replaces `round-p3-01` as base everywhere. Commit `test(memory): P291 baseline round`.
Skipped: one `results.md` line with the D15 evidence.

Step 5. Keys and telegraph post-pass (paid), then free analysis.
- Keys (est. 0.8, cap 1.2): `KIRA_EVAL_MODE=keys` on the base and `P285-runs/round-p2-02`. Retrieval with
  key variants (D18) on both, drift and merge-by-key proxy. `compare` per D11 against the best key-free
  recipe. Commit `test(memory): P291 keys pass`.
- Telegraph (est. 1.2, cap 1.6): `KIRA_EVAL_MODE=telegraph` on the base, `round-p2-02` and
  `round-p3-holdout`. Smoke one source first; read five rewrites against D24 before the rest. Then free:
  retrieval with styles `full`, `tele`, `tele-guard`, `mixed`, `mixed-swap` on both tuning bases and
  the hold-out store; footprint with `KIRA_EVAL_STYLE=tele`; `compare` `full` vs `tele` (and
  `tele-guard`) per D11 non-inferiority. Commit `test(memory): P291 telegraph post-pass`.
- TJ (est. 1.9, cap 2.4): score judge on the base's `tele` files (D28). Write the D26 verdict, the
  judge-bias deltas and the per-source and aggregate size table (D14) to `results.md`. Commit
  `test(memory): P291 telegraph judge and verdict`.

Step 6. V1T port (measurement commits, D20, D21). Decide the merge setting from Step 3 data and record
it first. Port `5866fd5e1` by hand onto the current tree (no cherry-pick: Part 3, Part 4 and P289 moved
the same files).
- 6a, `feat(memory)!: import distills each chunk`:
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
    and finalize texts evidence-free (keep P289's terse wording, drop only evidence clauses); finalize
    step 1 per the merge setting. `budget.tsv`: drop the extract line, set edited lines.
    `packages/theme/src/i18n/en.json`: drop the `memoryImportExtractSystem` entry.
  - Tests: `importer/engine_test.go`, `runner_test.go` (fake agent `Distill`), `verify_test.go` (salient
    rule cases: several interacting rules, so a unit test earns its keep), flow tests
    `apps/kira-space/internal/flows/memoryflow/{import_test,ingest_test,llmprompts_test}.go`,
    testdata `extract-*.md.json` to `distill-*.md.json`, contract golden
    `apps/kira-space/tests/contract/memory-import.json`, prompt-count assertions,
    `go run ./internal/llmprompts/cmd/checkprompts` (part of `bun run lint`).
  - Harness: `recAgent.Extract` becomes `Distill` (records lines as facts; `extracted` keeps
    `C_distill`).
  - Footer `BREAKING CHANGE: memory.import.extract.system is gone; an override of it no longer
    applies.` Fast checks plus `go test ./internal/memory/... ./internal/llmprompts/...
    ./apps/kira-space/internal/flows/memoryflow/...`.
- 6b, `feat(memory): telegraphic memory fact style`: the A4 file list of D22 (fragment text from
  `telegraph.md`). Same checks plus `promptsizes -compare` (D22) and the `settings-llm-prompts` UI spec.

Step 7. V1T measurement (paid). `round-p291-v1t` tuning (est. 4.5), retrieval, footprint (token recall,
sizes per source), keys on it (est. 0.4, only if the size rule holds). Apply D10 (A1 and A4 forms)
against the base; write the verdict with every number to `results.md`, commit
`test(memory): P291 V1T round`. Then per D31:
- Pass: hold-out `round-p291-v1t-holdout` (est. 1.3), retrieval with `round-p291-v1t` distractors; D10
  hold-out rule; the style's hold-out reading from the `round-p3-holdout` post-pass (D11
  non-inferiority, one base).
- Marginal A1: `round-p291-v1t-b` (est. 4.5) if the cap allows; mean decides.
- Fail: `git revert` 6b then 6a as `revert(memory): telegraphic style, P291 gate failed` and
  `revert(memory): import back to extract, P291 gate failed`; keep the harness `recAgent` compiling.
  If D26 passed and the cap allows: XT. Commit `feat(memory): telegraphic memory fact style` again,
  with the fragment also in `memory.import.extract.system` (A4 file list); run `round-p291-xt` tuning
  (est. 4.2), retrieval, footprint; D10 A4 form against the base; fail reverts it.
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
`round-p291-kv` tuning (est. 4.5), retrieval, D10 against the pre-Step 9 tree; fail reverts Step 9.
Commit `feat(memory)!: P291 subject and aspect keys` with `BREAKING CHANGE:` naming the gate schema
change.

Step 10. Docs, `docs(memory): P291 retrieval eval and results`:
- `docs/ARCHITECTURE.md`: "Memory ingest eval (P285)" gains the P291 retrieval and telegraph eval
  (modes, files, knobs, answer key, bands, token recall); Memory section updated for any adopted change
  (pipeline text, stored fact style and the `memory.factStyle` fragment, embedding text, constants,
  keys, `internal/textloss`). Known open items: rewrite "Memory import is not unified with `distill`"
  and "Memory ingest compression target not met" with P291 numbers (or delete them when resolved); add
  an item for each measured-not-adopted winner (for example read-time grouping, keys over budget,
  telegraphic style not adopted, residual token loss) with numbers.
- `docs/DEV_ENVIRONMENT.md`: eval row adds `questions`, `keys`, `telegraph`, `retrieval`, `compare`, the
  `KIRA_ORT_LIB` need, P291 spend and ledger; env var table adds `KIRA_EVAL_RUNS_DIR`,
  `KIRA_EVAL_MODEL_HOME`, `KIRA_EVAL_RECIPES`, `KIRA_EVAL_STYLES`, `KIRA_EVAL_STYLE`,
  `KIRA_EVAL_VARIANTS`, `KIRA_EVAL_EMBED_WORKER`; real `claude` rows row for memory import names the
  distill path if A1 landed.
- `site/src/content/docs/docs/space/memory.mdx` (import wording, stored fact style if A4, search wording
  if A2/A3), `site/src/content/docs/docs/reference/prompts.md` only if it lists fragments,
  `reference/mcp-tools.md` only if MCP texts changed (out of scope: expected no change),
  `reference/memory-formats.md` only if a format changed (D22 keeps v2: expected no change). Site pages
  follow the `CLAUDE.md` Communication style. `bun run site:check`; `bun run lint` runs
  `site/scripts/check-docs.ts`.

Step 11. Close-out (measurement plus checks). Full suites once: `bun run lint`, `lint:go`, `typecheck`,
`test:unit`, `test:go`, `test:ui:space` (memory specs: `memory-import`, `memory-ingest`,
`memory-distill`, `memory-module`, `memory-ranking`, `settings-llm-prompts`, `copy-coverage`,
`copy-wording`), `test:visual:space` only if a memory screen changed. Real `claude` rows (opt-in, ledger D23):
`bun run test:claude:space -run 'TestMemoryGate|TestMemoryImport|TestMemoryIngest|TestMemoryMcpThroughClaude|TestMemoryMcpFollowsDocs|TestMemoryInstallRegisters|TestMemoryDistill|TestMemoryDistillBridge'`.
A row that asserts on stored fact wording and fails only on style gets its assertion checked against
meaning (a name, number or identifier); the fragment is never reverted for a wording assertion. Report
`docs/v2.5/plans/P291-report.md`: one section per question of section 6, numbers from `results.md` and
the JSON files, every decision with its gate arithmetic, spend table, deviations. Close-out updates the
SPEC P291 row status. Commit `docs: P291 report and close-out`.

## 4. Spend (cap 20 USD, ledger `P291-runs/spend-p291.jsonl`)

| item | est. USD | when |
|---|---|---|
| Q questions, 15 sources, Opus | 2.0 (cap 2.5) | always |
| K keys, base and p2-02 | 0.8 (cap 1.2) | always |
| T telegraph post-pass, base, p2-02, p3-holdout | 1.2 (cap 1.6) | always |
| TJ judge of the base's telegraph facts | 1.9 (cap 2.4) | always |
| V1T tuning (unified plus fragment) | 4.5 | always |
| K keys on V1T | 0.4 | V1T meets the size rule |
| V1T hold-out | 1.3 | V1T passes tuning |
| real `claude` rows | 1.0 | after any adoption |
| expected total | 13.1 | |
| B0 baseline tuning | 4.2 | only per D15 (not expected) |
| XT extract pipeline plus fragment | 4.2 | V1T fails A1, D26 passed |
| V1T confirmation rerun | 4.5 | marginal A1 |
| KV keys verification | 4.5 | A3 candidate |

Changed from the first plan (expected 14.2): B0 (4.2) becomes conditional (D15); V1 becomes V1T at the
same cost (D20); T (1.2) and TJ (1.9) are new; XT is a new optional run. Dropped to fit: a style-free V1
run beside V1T, TJ on a second base, a post-pass on more rounds.

Free: every `retrieval`, `compare` and `footprint` run, all embeddings (local worker; one-time model
download only), mixed stores, token checks.

Cap check before each paid run: `ledger total + run estimate + reserve <= 20`, reserve = 1.0 (real rows)
plus 1.3 while a hold-out is still owed. A run that fails the check is not started; `results.md` records
why. After the required items (13.1), one optional run of 4.2-4.5 fits (17.6 at most); a second does not
(about 22). With B0 needed (17.3), no other optional run fits. Priority when more than one qualifies: XT,
then V1T confirmation, then KV. Harness env for every paid run: `KIRA_EVAL_PHASE_CAP_USD=20
KIRA_EVAL_CAP_USD=<estimate + 1.5>` (post-pass and TJ: their cap column). At the cap: stop, write the
report with what was measured.

## 5. Resumability

- Every round writes its own files before the next starts: `P291-runs/<round>/` (`facts.jsonl`,
  `judge/`, `judge-tele/`, `scores.json`, `scores-tele.json`, `footprint-v2.json`),
  `P291-runs/retrieval/*.json`, `P291-runs/keys/<round>/`, `P291-runs/telegraph/<round>/`,
  `P291-runs/compare/*.json`, and a row in `P291-runs/results.md` (round, change, metrics, run USD,
  phase USD, verdict). Committed per step.
- Ledger appended per Claude call (harness `evalSpend`), so a crash loses no spend record.
- Harness resume: `questions.jsonl` skips done sources; keys and telegraph skip present files; TJ skips
  present `judge-tele` files; a run round reuses `facts.jsonl` records and judge files; retrieval and
  compare are pure functions of files.
- The last commit names the step. Commits 6a, 6b, XT and Step 9 stand alone; a revert names the round
  that failed. Thresholds of D9-D11 and D26 live in `results.md` before the run they judge.
- Cap check reads the ledger file, never memory.

## 6. Questions the report answers

1. Retrieval today: hit@1/5/10 and MRR, hybrid vs keyword vs semantic, end-to-end vs conditional,
   per category and per form.
2. Noise: `band_R`, `band_Rk`, `band_tok` from identical code.
3. Calibration: query and doc cosine distributions vs 0.55/0.70/0.85, per style.
4. Unified pipeline (V1T, p2-02, p2-03) vs current on retrieval, `R_ess`, `R_all`, `P`, sizes.
5. Atomic vs merged; read-time grouping by section and by subject.
6. Explicit subject and aspect: retrieval gain over keywords and over the best key-free recipe; extra
   output tokens (chars per fact, runes/3); key drift; merge-by-key proxy vs model merge.
7. Embedding text: `fact`, `fact-kw`, `sec-fact`, `sec-fact-kw`, `sa-fact`, `sa-fact-kw`, per style.
8. Value of gate keywords (`nokw`) on retrieval vs their `C_store` cost.
9. "Half" expectation (D14): measured ratios at measured recall, per source and aggregate, per style.
10. Telegraphic style: retrieval on identical facts (hybrid, keyword, semantic), token loss before and
    after retry, `tele-guard` vs `tele`, judge style bias (standalone, atomic, `P`), mixed-store rank
    bias, style-pair cosine vs `DocFloor`, subject-cut count, prompt-level result in V1T or XT.
11. What was adopted, what was not, with the gate arithmetic; spend.

## 7. Risks

- Judge `by` noise feeds the answer key; bands from identical code absorb it, and same-facts comparisons
  share one key.
- Small stores (200-400 facts) make retrieval easier than a real 10k store; relative comparisons hold
  better than absolute numbers (caveat in the report).
- One-fact `ApplyDoc` docs give each fact its own request group; import groups up to 20. Group boost
  differs slightly; document groups dominate.
- Base from the pre-P289 tree (D15): P289's own rounds show its memory edits within bands; the report
  names the tree difference.
- The port of `5866fd5e1` meets moved code; it is a hand port with the same behavior, not a cherry-pick.
- The embed worker under the test binary needs `KIRA_ORT_LIB`; without it `retrieval` fails fast with a
  clear message instead of silently going keyword-only.
- Telegraphic text and embeddings: arctic-embed-s saw natural sentences; fragments may land off its
  usual input shape and move cosines. D12 per style and D26 measure it; cosine floors move only on D12
  data.
- Telegraphic text and keyword search: shorter facts gain bm25 rank in a mixed store; the mixed-store
  run measures the bias. Negations are query stopwords, so keyword search never sees them either way.
- Over-compression: a cut preposition can move a qualifier ("timeout 30 s per call" vs "per file"), or
  the cut can drop the subject that made a fact standalone. The token check catches numbers, names,
  identifiers, paths and negations only; TJ coverage and the subject-cut count catch part of the rest.
- Judge bias: a frozen judge may mark fragments less standalone or less atomic with no meaning lost;
  D28 measures it, and the gate does not use those metrics.
- Precedent: P289's bolder extract rewrite lost precision (`P` 0.568 vs floor 0.570), and P285 Part 2's
  restructured terse gate lost `R_all` (0.658 vs 0.693). Both changed how the model selects facts, not
  only their wording. The fragment changes wording rules only and leaves selection rules alone; V1T
  still measures recall and `P`. P noise between identical rounds reached 0.106, so `P` stays ungated.
- The gate restyles every stored fact; a style missing from the gate never reaches the store (D24).
- Budget: one optional 4.2-4.5 USD run fits, not two; B0 needed leaves none.

## 8. Out of scope

Chunk budget change (pending user decision since P285); judge and golden prompts (frozen); read-time
grouping in search output; write-time merge-by-key; memfmt v3; ranking fusion weights and boosts other
than D12 constants; reconcile behavior beyond the D22 recipe floor; the Artifact page (not asked);
multilingual embeddings. User scope for the telegraphic revision: every prompt outside the memory
pipeline and distill; the memory MCP instructions, tool and argument texts,
`memory.mcp.remember.message` and tool results (P289's texts stay); keyword style; a production
post-pass; rewriting existing stored memories or docs.

## 9. Open items for the final message

- If V1T wins on recall but not on retrieval beyond `band_R`, D10 keeps the current pipeline for A1: the
  user may still want unified for recall (goal 2) and for one system.
- If V1T fails and D26 passed but XT is not affordable, telegraphic style stays measurement-only; the
  numbers go to Known open items and the user decides on a follow-up phase.
- Unified alone (V1 without the fragment) is not run; its effect reads from `round-p2-02`/`round-p2-03`
  on the older tree. A 4.5 USD run would settle it if the user wants one.
- MCP texts are out of scope: agents still send plain-style items through `store_memory` and
  `remember`; the gate restyles them, so stored text follows the fragment anyway.
- Existing stored memories keep their full style; mixed stores rank with the measured bias until a
  re-import.
- No runtime token-preservation check; a residual post-pass loss rate above 0 is listed with ids.
- Read-time grouping is never adopted here; if it wins, it needs a phase for the result-shape change.
- A3 keys adoption depends on a 4.5 USD verification round; if the cap blocks it, the numbers go to
  Known open items and the user decides on a follow-up phase.
- The SPEC P291 row does not name the telegraphic direction yet; the orchestrator adds it as a user
  decision so verification checks against it.
- Retrieval on 10-source stores understates difficulty at scale.
