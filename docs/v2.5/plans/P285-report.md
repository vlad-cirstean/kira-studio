# P285 report: memory ingest quality

Eval of the memory ingest pipeline on real repo text: plans, specs, docs, comments, JSON, JSONL. Harness: `bun run eval:memory`. Raw data: `docs/v2.5/plans/P285-runs/` (per round `facts.jsonl`, `scores.json`, `judge/`), `P285-corpus/` (manifest, golden facts, judge prompts).

## 1. Summary

Targets were set on the tuning set (10 files, 67 K chars). Baseline = mean of two runs. Final = `round-final`, defaults after two kept prompt changes.

| metric | baseline | final | target | met |
|---|---|---|---|---|
| essential recall `R_ess` | 0.833 | 0.883 | >= 0.90 | no |
| precision `P` | 0.879 | 0.895 | >= 0.90 | no (0.005 short) |
| compression `C_fact` (stored fact chars / source chars) | 0.458 | 0.497 | <= 0.30 | no |

Verdict: targets not met. Essential recall rose 0.05 and sits at 0.88; precision and unsupported claims are near target; compression did not improve and stays near 0.5 of the source. Two kept changes (extract prompt). Six rejected rounds, stopped by the 60 USD spend cap (56.9 USD used).

What the numbers say:

- Recall and compression pull against each other. Smaller chunks (target 1500 tokens) lifted `R_ess` to 0.898 and `R_all` to 0.733 but pushed `C_fact` to 0.519. A prompt rule that skips detail cut `C_fact` 0.03 but lost 0.05 `R_all`.
- The yardstick explains part of the gap. The golden essential facts alone, one sentence each, are 0.47 of the source chars; all golden facts are 0.71. A pipeline at 0.30 cannot keep 0.90 of that. The 0.30 target was set before any measurement and did not account for this.
- Run-to-run noise is large. The final run has the same code as round 2, yet `R_ess` differs 0.03 and `C_fact` 0.024. Judge and extractor variance (bands in section 2) is as big as most single changes.
- Hold-out tracks tuning: `R_ess` 0.798 > 0.826, `C_fact` 0.420 > 0.479, `P` 0.894 > 0.892. No sign of overfitting; the hold-out misses its targets as tuning does.
- Unsupported or distorted claims are 0.000 in the final run, duplicates 0, not-valuable 0. Facts stay faithful. The failure is lost detail, not invention.

## 2. Method

- Pipeline under test: chunk, extract (Sonnet, no tools), cross-check of doubtful facts, one finalize agent per file calling `store_memory` (the gate splits and shortens each fact; reconcile runs per fact). Origin `agent`, scope `project`, write-back on, fresh store per source.
- Corpus: 15 files pinned to commit `9ed83ae85`, read by `git show`, so later edits never change it. 10 tuning (66 980 bytes), 5 hold-out (21 K). One hold-out per category.
- Golden: Opus (`claude-opus-5-5`) wrote 585 reference facts (372 essential, 213 minor) from the source text alone, before any pipeline run. A quote check dropped none. Frozen at baseline.
- Judge: the same Opus model grades each run against golden and grades every stored fact. Full coverage 1, partial 0.5. Aggregates sum counts over sources.
- Noise bands: two baseline runs of identical code; band = absolute difference, at least 0.02 (0.01 for unsupported). Round decisions compare against the last kept round using these bands. The plan's floor `R_ess >= 0.85` could not apply to round 1 (baseline was below it); I required no drop beyond the band instead.
- Spend: the user lowered the cap to 8 USD per run and 60 USD for the phase. Ledger 56.93 USD (plus about 0.3 USD of smoke tests before it): golden 1.63, pipeline 19.82, store gate 12.83, judge 22.65. A tuning run costs about 4.2 USD and takes 8 to 10 min.
- Token numbers use the repo estimate `ceil(runes/3)`, not a tokenizer. Final tuning stored facts: 11174 estimated tokens.

### Baseline noise (tuning)

| metric | 00a | 00b | mean | band |
|---|---|---|---|---|
| R_ess | 0.830 | 0.836 | 0.833 | 0.020 |
| R_all | 0.659 | 0.675 | 0.667 | 0.020 |
| P | 0.846 | 0.912 | 0.879 | 0.065 |
| atomic | 0.925 | 0.969 | 0.947 | 0.044 |
| standalone | 0.915 | 0.946 | 0.931 | 0.031 |
| unsupported+distorted | 0.009 | 0.000 | 0.005 | 0.010 |
| duplicate | 0.000 | 0.000 | 0.000 | 0.020 |
| not valuable | 0.000 | 0.003 | 0.001 | 0.020 |
| reason ok | 0.969 | 0.917 | 0.943 | 0.051 |
| C_fact | 0.444 | 0.473 | 0.458 | 0.029 |
| C_rec | 0.967 | 1.033 | 1.000 | 0.066 |


Targets (tuning): `R_ess` >= 0.90, `R_all` >= 0.75, `P` >= 0.90, atomic and standalone >= 0.95, unsupported <= 0.02, duplicate <= 0.03, not valuable <= 0.05, reason ok >= 0.95, `C_fact` <= 0.30 and every source <= 0.50.

### Final vs baseline, all metrics (tuning)

| metric | 00a | 00b | final | target |
|---|---|---|---|---|
| R_ess | 0.830 | 0.836 | 0.883 | 0.90 |
| R_all | 0.659 | 0.675 | 0.713 | 0.75 |
| P | 0.846 | 0.912 | 0.895 | 0.90 |
| atomic | 0.925 | 0.969 | 0.924 | 0.95 |
| standalone | 0.915 | 0.946 | 0.965 | 0.95 |
| unsupported+distorted | 0.009 | 0.000 | 0.000 | 0.02 |
| duplicate | 0.000 | 0.000 | 0.000 | 0.03 |
| not valuable | 0.000 | 0.003 | 0.000 | 0.05 |
| reason ok | 0.969 | 0.917 | 0.985 | 0.95 |
| C_fact | 0.444 | 0.473 | 0.497 | 0.30 |
| C_rec (fact + reason + keywords) | 0.967 | 1.033 | 1.062 | reported |
| essential misses lost at extract / at finalize | 12 / 5 | 16 / 7 | 8 / 4 | reported |

`C_rec` above 1.0: the stored record (fact, reason, keywords) is longer than the source. Reason and keywords grow with every kept fact. `C_doc` (the `.memory.md` text) is not reported: the harness read the file before write-back finished at baseline; after the fix it is still empty for 9 of 15 sources in the final run (cause not found, section 7).

## 3. Results per source

Cells read baseline (`round-00a`; hold-out: `round-00-holdout`) > final.

Tuning:

| source | category | src chars | R_ess | R_all | P | C_fact | stored facts | fact chars |
|---|---|---|---|---|---|---|---|---|
| plan-p257 | plan | 11916 | 0.73 > 0.78 | 0.52 > 0.56 | 0.89 > 0.81 | 0.28 > 0.33 | 35 > 36 | 3331 > 3873 |
| plan-p169 | plan | 13374 | 0.84 > 0.91 | 0.75 > 0.84 | 0.85 > 0.93 | 0.50 > 0.56 | 61 > 71 | 6659 > 7478 |
| plan-p153 | plan | 7109 | 0.82 > 0.88 | 0.52 > 0.61 | 0.48 > 0.75 | 0.40 > 0.47 | 23 > 24 | 2850 > 3308 |
| spec-chunk-go | spec (Go test) | 5253 | 0.81 > 0.75 | 0.79 > 0.74 | 0.94 > 0.94 | 0.24 > 0.25 | 18 > 16 | 1241 > 1310 |
| spec-ade-resume | spec (Playwright) | 3706 | 0.93 > 0.93 | 0.73 > 0.73 | 0.90 > 0.89 | 0.26 > 0.24 | 10 > 9 | 967 > 878 |
| doc-arch-prompts | doc | 4213 | 0.95 > 1.00 | 0.90 > 0.91 | 0.74 > 0.77 | 1.00 > 1.03 | 47 > 47 | 4206 > 4341 |
| doc-readme | doc | 14568 | 0.79 > 0.88 | 0.55 > 0.62 | 0.95 > 0.99 | 0.43 > 0.52 | 77 > 92 | 6274 > 7592 |
| cmt-claude-go | comments | 1908 | 0.87 > 0.93 | 0.85 > 0.90 | 0.88 > 1.00 | 0.75 > 0.85 | 17 > 18 | 1436 > 1620 |
| cmt-runner-go | comments | 4078 | 0.85 > 0.92 | 0.69 > 0.75 | 0.85 > 0.86 | 0.55 > 0.58 | 27 > 28 | 2257 > 2374 |
| json-ade-errors | JSON | 855 | 0.79 > 0.79 | 0.46 > 0.50 | 1.00 > 1.00 | 0.52 > 0.48 | 4 > 3 | 446 > 409 |

Hold-out:

| source | category | src chars | R_ess | R_all | P | C_fact | stored facts | fact chars |
|---|---|---|---|---|---|---|---|---|
| plan-p155 | plan | 8077 | 0.76 > 0.67 | 0.45 > 0.44 | 0.92 > 0.75 | 0.28 > 0.33 | 24 > 28 | 2283 > 2659 |
| spec-memory-ingest | spec (Playwright) | 2104 | 0.86 > 0.82 | 0.75 > 0.69 | 0.73 > 1.00 | 0.51 > 0.41 | 11 > 10 | 1064 > 860 |
| doc-devenv-claude | doc | 5484 | 0.88 > 0.97 | 0.72 > 0.82 | 0.95 > 0.95 | 0.60 > 0.80 | 37 > 42 | 3285 > 4381 |
| cmt-plan-model-ts | comments | 2763 | 0.88 > 0.97 | 0.88 > 0.97 | 0.86 > 0.91 | 0.84 > 0.83 | 22 > 22 | 2310 > 2286 |
| jsonl-taskcreate | JSONL | 2880 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0.00 > 0.00 | 0 > 0 | 0 > 0 |

Hold-out aggregate: `R_ess` 0.798 > 0.826, `R_all` 0.592 > 0.628, `P` 0.894 > 0.892, `C_fact` 0.420 > 0.479 (targets 0.85, 0.70, 0.85, 0.35). Sources over `C_fact` 0.50 in the final run: plan-p169, doc-arch-prompts, doc-readme, cmt-claude-go, cmt-runner-go, doc-devenv-claude, cmt-plan-model-ts. The JSONL source stores 0 facts both times (a tool-use trace; golden lists 12).

## 4. Iteration log

| round | hypothesis | change | R_ess | R_all | P | unsupp | dup | C_fact | run USD | phase USD | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 00a | baseline | none | 0.830 | 0.659 | 0.846 | 0.009 | 0.000 | 0.444 | 4.1 (+4.1 wasted first attempt, harness bug) | 10.0 | baseline |
| 00b | baseline repeat | none | 0.836 | 0.675 | 0.912 | 0.000 | 0.000 | 0.473 | 4.2 | 14.2 | baseline |
| 00-holdout | baseline hold-out | none | 0.798 | 0.592 | 0.894 | 0.000 | 0.000 | 0.420 | 1.3 | 15.6 | baseline |
| 01 | extract: keep qualifiers, decision reasons, rejected alternatives | extract prompt, 2 bullets (registry.go) | 0.860 | 0.662 | 0.900 | 0.009 | 0.000 | 0.472 | 4.2 | 19.8 | kept: R_ess +0.027 beyond band 0.020, no regression |
| 02 | extract: skip process chatter and code mechanics | extract prompt Skip bullet (registry.go) | 0.853 | 0.684 | 0.892 | 0.015 | 0.000 | 0.473 | 4.7 | 24.5 | kept (marginal): R_all +0.021 vs band 0.020, no regression; C_fact unchanged so the compression mechanism is refuted |
| 03 | extract: keep a fact only if losing it loses a decision, rule, constraint, reason, name or behavior | extract prompt, one bullet (override only) | 0.841 | 0.632 | 0.878 | 0.006 | 0.003 | 0.441 | 4.0 | 28.5 | rejected: R_all -0.052 and standalone -0.034 beyond band; C_fact -0.032 only just beyond band 0.029 |
| 04 | finalize: keep every number, name, condition and quoted string; merge only entailing facts | finalize prompt, one sentence (override only) | 0.845 | 0.690 | 0.893 | 0.005 | 0.003 | 0.487 | 5.1 | 33.7 | rejected: no metric improved beyond band (R_ess -0.009, C_fact +0.014) |
| 05 | chunk: smaller chunks (recall) | KIRA_EVAL_BUDGET 1500,2500,700,400,200 (budget.json, override only) | 0.898 | 0.733 | 0.888 | 0.010 | 0.003 | 0.519 | 4.5 | 38.2 | rejected by rule: C_fact +0.046 beyond band 0.029, although R_ess +0.044 (0.898) and R_all +0.050 (0.733) improved |
| 06 | chunk: mid-size chunks (2250/3000/1100/550/200) | KIRA_EVAL_BUDGET (budget.json, override only) | 0.869 | 0.680 | 0.877 | 0.003 | 0.000 | 0.469 | 4.1 | 42.3 | rejected: no metric beyond band (R_ess +0.016 vs band 0.020, C_fact flat) |
| 07 | extract: name the subject in every fact, use the code: line, split joined claims | extract prompt, one bullet (override only) | 0.867 | 0.690 | 0.887 | 0.003 | 0.000 | 0.482 | 4.6 | 47.0 | rejected: reason ok -0.138 beyond band 0.051; R_ess +0.014, P and standalone flat |
| 08 | chunk: Target 1800 (between rounds 5 and 6) | KIRA_EVAL_BUDGET 1800,2800,900,450,200 (budget.json, override only) | 0.873 | 0.698 | 0.921 | 0.006 | 0.000 | 0.489 | 4.2 | 51.2 | rejected: nothing beyond band (R_ess +0.019 vs band 0.020, P +0.029 vs 0.065, C_fact +0.017); phase budget ends the loop |
| final | final run, all 15 sources, committed defaults | none (defaults = kept rounds 1 and 2) | 0.870 | 0.692 | 0.895 | 0.000 | 0.000 | 0.492 | 5.7 | 56.9 | final (tuning-only numbers in section 1) |

Spend override from the user: 8 USD per run, 60 USD phase total (plan said 10 and 120). Round 00a ran twice: the first attempt had a harness bug (extracted facts not captured), 4.1 USD wasted, kept in the ledger. Rounds 5, 6, 8 used `KIRA_EVAL_BUDGET` (`budget.json` in the round dir); rounds 3, 4, 7 used `prompts.json`.

## 5. What changed and why

Kept, in `internal/llmprompts/registry.go` (`memory.import.extract.system`):

1. Round 1 (commit `e3bd06b93`): two bullet edits. Each fact keeps its qualifiers (numbers, units, names, negations, conditions, exceptions, limits). Durable knowledge names decisions with their reasons and rejected alternatives with why. `R_ess` +0.027 (0.833 to 0.860). Baseline misses were mostly partial: the stored fact kept the claim but dropped the reason or a qualifier.
2. Round 2 (commit `869e41d75`): the Skip bullet also names process chatter (who ran what, commit and phase lists, run results, spend) and code mechanics with no behavioral meaning (selectors, local variable names, fixture values). `R_all` +0.021, barely over the band; `C_fact` did not move, so it does not compress. Kept by the rule, harmless.

Rejected (change absent from the tree; inputs in the round dir):

- Round 3: keep a fact only if losing it loses a decision, rule, constraint, reason, name or behavior. `C_fact` -0.032 but `R_all` -0.052 and standalone -0.034.
- Round 4: finalize keeps every number, name, condition, quoted string. Nothing moved.
- Round 5: chunk target 1500 (max 2500, min fill 700, min tail 400). `R_ess` 0.898, `R_all` 0.733, but `C_fact` +0.046 (0.519), over the band.
- Round 6: target 2250. Inside the bands.
- Round 7: name the subject in every fact, use the `code:` line, split joined claims. `reason ok` -0.138.
- Round 8: target 1800. Inside the bands (`R_ess` +0.019 against a 0.020 band).

Round 5 is the best-recall configuration found. It fails the keep rule only on compression. Taking that trade is a product call: one Go constant (`DefaultBudget`) plus `chunk_test.go` expectations that depend on it (not run here).

Not tried (spend cap): gate, reconcile and verify prompts, the questionable rule, `cleanFacts`, fact and evidence limits.

## 6. Examples

Baseline = `round-00a`, final = `round-final`. First stored facts shown.

Plan (`plan-p257`), source excerpt:

> Count render sites (all of them):
> - `packages/git-ui/src/components/FileTree.vue`: 4 sites. Tree-mode and flat-mode directory row (`N files +x -y`, aggregate from `fileTreeModel.ts`), tree-mode and flat-mode file row (`+a -d`, hidden when `isBinary`). FileTree serves commit detail, stash detail, working detail, ...

| baseline | final |
|---|---|
| P257 removes per-file and per-directory added/removed line counts from the git module UI. | P257 removes per-file and per-directory added/removed line counts from the git module UI. |
| P257 stops numstat spawns whose only purpose was line counts. | P257 must keep per-file status indicators: kind letter, rename original path, similarity; they come from --name-status. |
| Line counts render in four sites in packages/git-ui FileTree.vue: tree and flat directory rows, tree and flat file rows. | Line counts render in packages/git-ui FileTree.vue at 4 sites: directory and file rows, in tree and flat modes. |
| AdeChangesTab.vue renders line counts via fileDelta(). | FileTree serves commit detail, stash detail, working detail, review files pane and review commit rows. |

Still missed in final (essential): the reason "because the user found them noisy and useless", that numstat spawns stop, the git 2.43 probe result, the rejected alternatives of D1.

Spec (`spec-chunk-go`, a Go test file):

| baseline | final |
|---|---|
| In the importer package, ChunkMarkdown returns chunks and a document title. | ChunkMarkdown returns chunks plus a document title. |
| The importer Budget struct has fields Target, Max, MinFill, MinTail and Context. | The importer chunker's Budget has fields Target, Max, MinFill, MinTail and Context. |
| A markdown heading starts a new chunk only after the current chunk reaches minimum fill. | In ChunkMarkdown, a heading starts a new chunk only after the current chunk reaches the minimum fill; otherwise the heading stays in the current chunk. |
| (none) | In ChunkMarkdown, fenced code blocks (``` and ~~~ fences) are never split across chunks, even with blank lines inside. |

Still missed: the arguments `ChunkMarkdown` and `ChunkText` take, and that the first-level heading is the title.

Doc (`doc-arch-prompts`), source excerpt: "`internal/llmprompts` holds every LLM prompt and LLM-facing instruction both apps send. Not `internal/prompts` (P246 popup router). - **Registry.** `registry.go` is the one file with prompt text. Entry: id, kind, apps, ..."

| baseline | final |
|---|---|
| registry.go in internal/llmprompts is the only file containing prompt text. | registry.go is the only file containing prompt text. |
| Registry entries are accessed through typed handle Prompt[V] with Text(src, vars); NoVars is used for entries without variables. | Each registry entry has id, kind, apps, catalog keys (title, purpose, usedBy), applies-when, default, required fragments and a fixed output schema. |

The baseline joined two claims in one fact (typed handle; NoVars). The judge counts that as not atomic. This dense section stays at 1.0 of its own size: it already is a list of facts.

Comments (`cmt-claude-go`): extracted block "claudeArgs is the isolation contract. Not --bare: it forces ANTHROPIC_API_KEY auth and never reads OAuth/keychain..." followed by the line "code: func claudeArgs(c Call) []string". `R_ess` 0.87 to 0.93, `P` 0.88 to 1.00. The comment text is already short, so `C_fact` is 0.85: a fact list cannot be much shorter than a comment.

JSON (`json-ade-errors`): baseline "AdeTaskService.Run fails to start with status 'failed' when Claude Code CLI is not found, with note 'Install it, then retry.'" (4 facts). Final "AdeTaskService.Run fails to start with outcome status 'failed' (route 'stop', source 'start') when the Claude Code CLI is not found." (3 facts). Missed in both: the exact run note text.

JSONL (`jsonl-taskcreate`, hold-out): 0 facts stored, baseline and final. The file is a Claude Code stream trace; the pipeline finds nothing durable. Golden lists 12 facts (5 essential), so recall is 0.

## 7. Remaining weaknesses and caveats

Weaknesses:

- Compression stays near 0.5. Dense text (doc sections, comments, specs with named behaviors) has no slack; plans reach 0.33 to 0.56. The gate already rewrites each fact tersely; fewer facts is the only lever and it costs recall.
- Reasons and motivation are lost most (the "because ..." of a decision), then exact strings (error texts, run notes). The round 1 change helped but did not close it.
- Partial coverage dominates misses: in the final run 53 of 75 missed essential golden facts are partial, and all 53 were present in the extracted facts. The claim is stored, a qualifier is not.
- The judge and the long golden facts penalise atomic splits: one golden fact spread over several stored facts often scores partial.
- JSONL traces yield nothing.
- Hold-out `R_ess` 0.826 against its target 0.85 and `C_fact` 0.479 against 0.35: both short. The gap to tuning is small (tuning `R_ess` 0.883).

Unverified or caveats:

- Embedder off, as in `TestMemoryImport`: reconcile sees keyword candidates only. Production adds semantic candidates; effect not measured.
- Token numbers are the repo estimate, not a tokenizer.
- Judge variance: one judge call per source per run, no second opinion. The bands come from two runs only; round 2 and round 8 decisions sit at their edge.
- The golden list comes from the same model family that judges, and rewards qualifier-heavy facts. The 0.30 target may be unreachable against it (section 1).
- Intermittent stall: in 4 of 13 runs one source stayed in "scanning" for the whole wait ("job never reached awaiting"). The harness reran that source on a fresh store and it worked each time. Not investigated in the product (suspect a runner start race in the in-process setup); each cost 3 to 12 minutes.
- `C_doc` missing (section 2).
- Job cost excludes the gate; the harness adds the gate cost by wrapping `claude` in the memory MCP child.
- Fast checks only: lint, lint:go, typecheck via commit hooks, `checkprompts`, `go test ./internal/llmprompts/...`. Full suites and real `claude` rows are left to the serial test-and-fix step.

Follow-ups:

- Decide the recall versus compression trade: `DefaultBudget{Target: 1500, Max: 2500, MinFill: 700, MinTail: 400, Context: 200}` gave `R_ess` 0.898 at `C_fact` 0.519.
- Rebase the compression target on what the golden facts allow (about 0.47 for essential facts alone), or measure information instead of chars.
- Gate prompt: terse rewrite that keeps every qualifier (plan's last-resort item, not tried).
- A reasons-first extraction pass and a keep-exact-strings rule for decision text.
- Find why the write-back doc is empty in the harness and why a scan occasionally stalls.
- Artifact page `Memory Ingest Eval` not built in this pass: close-out step.
