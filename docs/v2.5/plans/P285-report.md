# P285 report: memory ingest quality

Status: in progress. Baseline done. Final sections fill at the end.

## 1. Summary

Pending final run. Baseline (tuning, `round-00a`): `R_ess` 0.830, `P` 0.846, `C_fact` 0.444.

## 2. Method

- Pipeline under test: chunk, extract (Sonnet), cross-check, finalize agent with `store_memory` (gate and reconcile run per fact). Origin `agent`, scope `project`, write-back on, embedder off.
- Corpus: 15 files pinned to `9ed83ae85` (`docs/v2.5/plans/P285-corpus/manifest.json`), 10 tuning (67 K chars), 5 hold-out (21 K chars). Materialised by `git show`, so later edits never change it.
- Golden: Opus (`claude-opus-5-5`) authored 585 reference facts from source text alone, before any pipeline run (`golden.jsonl`). Quote check dropped none. Frozen at baseline.
- Judge: same Opus model grades each run against golden (coverage, atomic, standalone, support, duplicate, valuable, reason). Full 1, partial 0.5. Aggregates sum counts over sources.
- Noise: two baseline runs of the same code. Band per metric is the absolute difference, at least 0.02 (0.01 for the unsupported rate). Reference for a decision is the mean of the two.
- Token numbers use the repo estimate `ceil(runes/3)`, not a tokenizer.
- Harness: `bun run eval:memory` (opt-in, `KIRA_MEMORY_EVAL=1`, never hooks or CI). Spend ledger: `P285-runs/spend.jsonl`.

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

`C_doc` (write-back text size) is not reported for baseline: the harness read the `.memory.md` before write-back finished in most sources. Fixed after baseline (waits for the path); final run reports it.

Hold-out baseline (`round-00-holdout`): `R_ess` 0.798, `R_all` 0.592, `P` 0.894, `C_fact` 0.420. Not read for any decision.

Targets (tuning): `R_ess` >= 0.90, `R_all` >= 0.75, `P` >= 0.90, atomic and standalone >= 0.95, unsupported <= 0.02, duplicate <= 0.03, not valuable <= 0.05, reason ok >= 0.95, `C_fact` <= 0.30 and every source <= 0.50.

## 3. Results per source

(baseline = `round-00a`; final filled at the end)

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

Spend override from the user: 8 USD per run, 60 USD phase total (plan said 10 and 120).

## 5. What changed and why

Nothing yet.

## 6. Examples

Pending.

## 7. Remaining weaknesses and caveats

Pending.
