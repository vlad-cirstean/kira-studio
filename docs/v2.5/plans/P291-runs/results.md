# P291 results

Ledger: `spend-p291.jsonl`. Phase cap 20 USD.

## Step 0 preflight

- P289 landed (`e9c6697b5` on v2.0, base `d071287d9`). `budget.tsv`, `promptsizes -compare/-allowed`, `checkprompts` style rule present.
- ORT: `scripts/fetch-onnxruntime.sh linux-x64` ok, `KIRA_ORT_LIB=apps/kira-space/build/onnxruntime/linux-x64/libonnxruntime.so.1.29.1`.
- Memory-pipeline changes since `9c09012fe`: `929fdb787` (P289 terse memory prompts, measured by `round-p289-01`, inside bands), `1744fd9a3` (distill progress, no prompt text). Budget lines match section 1 sizes (gate 3316, extract 1950, distill 1763, finalize 2615, reconcile 1344, verify 1355, dataHygiene 177).
- B0 decision (D15): skipped. No unmeasured memory-pipeline change. Base stays `round-p3-01` (tuning), `round-p3-holdout`.
- Latest migration: `0007_p281_verify_pending.sql`. Next free: `0008`.
- Section 1 facts unmoved. Snapshot `before.json` written (31537 chars, 10550 tokens).

## Spend

| item | USD | phase total |
|---|---|---|
| questions (Opus) | 1.136 | 1.136 |
| keys (Sonnet) | 0.403 | 1.539 |
| telegraph (Sonnet) | 1.038 | 2.577 |
| TJ score judge (Opus) | 1.645 | 4.223 |

## Bands (D9, identical-code pairs, hybrid/keyword on tuning, end-to-end)

| pair | delta MRR hybrid | delta MRR keyword | token recall delta |
|---|---|---|---|
| round-00a / 00b | -0.026 | -0.020 | 0.023 |
| round-02 / final | +0.005 | +0.007 | 0.016 |
| round-p2-01 / 01b | -0.003 | -0.010 | 0.024 |

`band_R` = 0.026, `band_Rk` = 0.020 (floor), `band_tok` = 0.024.
Thresholds as numbers (base `round-p3-01` hybrid MRR 0.886, keyword 0.863, `R_ess` 0.885, token recall 0.607):
- A1 (D10): hybrid MRR > 0.912; keyword >= 0.843; `R_ess` >= 0.865; unsupported <= 0.020; token recall >= 0.583; `C_fact`, `C_store`, `C_doc` < 1.0.
- A4 (D10 non-inferior form): hybrid MRR >= 0.860; keyword >= 0.843; `R_ess` >= 0.865; token recall >= 0.583; `C_store` < base 0.661.
- D26 same-facts: D11 non-inferiority CI lower bound > -0.026 (hybrid), > -0.020 (keyword); residual token loss <= 1 % of facts; `R_ess(tele)` >= `R_ess(full)` - 0.020.

## Rounds

### Step 2 questions

372 essential golden facts, 15 sources, Opus, 744 inputs (372 questions, 372 queries). Leak guard (D3, 4 consecutive content words) flagged 43 of 744 (per item in `P291-corpus/questions.jsonl`: `questionLeak`, `queryLeak`); 26 of those fall in tuning (540 of 566 tuning queries run), 17 in hold-out (161 of 178). Run USD 1.136 of cap 2.5 (est 2.0). Phase total 1.136.
### Step 3 free retrieval baseline

Setup deviations from D6/D7, recorded: tuning stores add the `round-p3-holdout` facts as fixed distractors (otherwise a 209-fact store saturates: conditional hit@10 0.998 on every round, cannot separate variants); hold-out stores add the paired tuning round. Hybrid = real `Service.Search` (limit 10) with the arctic-embed-s worker, backfill done. Keyword = same store, no embedder. Semantic = cosine ranking by the same client. Query set: 540 tuning (270 question, 270 query form), 161 hold-out.

Sanity rule: conditional hybrid hit@10 is 0.998 on `round-p3-01`, above the 0.99 stop line. Not a harness bug: a negative control (answers rotated to the next golden fact of the same source) drops it to 0.578 (hit@10 0.556 end-to-end). The cause is store size (200-480 facts, specific questions). Absolute numbers overstate difficulty at scale; MRR and hit@1 keep room (0.89 and 0.84).

| round | set | facts | hybrid MRR | h@1 | h@10 | cond h@10 | keyword MRR | semantic MRR | hybrid nokw MRR | chars@5 |
|---|---|---|---|---|---|---|---|---|---|---|
| round-00a | tuning | 383 | 0.864 | 0.813 | 0.939 | 0.998 | 0.846 | 0.812 | 0.848 | 765 |
| round-00b | tuning | 415 | 0.838 | 0.787 | 0.917 | 0.996 | 0.826 | 0.799 | 0.816 | 721 |
| round-02 | tuning | 408 | 0.863 | 0.813 | 0.935 | 0.994 | 0.846 | 0.817 | 0.847 | 782 |
| round-final | tuning | 408 | 0.868 | 0.811 | 0.956 | 0.994 | 0.853 | 0.834 | 0.857 | 796 |
| round-final | holdout | 446 | 0.814 | 0.764 | 0.882 | 1.000 | 0.814 | 0.765 | 0.800 | 755 |
| round-p2-01 | tuning | 390 | 0.874 | 0.822 | 0.954 | 0.992 | 0.864 | 0.825 | 0.859 | 812 |
| round-p2-01b | tuning | 399 | 0.870 | 0.819 | 0.944 | 0.992 | 0.854 | 0.818 | 0.847 | 832 |
| round-p2-02 | tuning | 478 | 0.899 | 0.843 | 0.980 | 0.992 | 0.883 | 0.836 | 0.877 | 771 |
| round-p2-03 | tuning | 460 | 0.904 | 0.852 | 0.985 | 0.993 | 0.897 | 0.848 | 0.877 | 850 |
| round-p2-final | tuning | 387 | 0.869 | 0.822 | 0.941 | 0.994 | 0.850 | 0.830 | 0.849 | 837 |
| round-p2-final | holdout | 416 | 0.851 | 0.820 | 0.894 | 1.000 | 0.839 | 0.798 | 0.833 | 818 |
| round-p3-01 | tuning | 273 | 0.886 | 0.843 | 0.957 | 0.998 | 0.863 | 0.823 | 0.874 | 1100 |
| round-p3-holdout | holdout | 273 | 0.873 | 0.832 | 0.932 | 1.000 | 0.854 | 0.825 | 0.864 | 1032 |

Reading:
- Q1 retrieval today (`round-p3-01`, hybrid): MRR 0.886, hit@1 0.843, hit@5 0.944, hit@10 0.957; conditional (answer stored) MRR 0.923, hit@10 0.998. Keyword MRR 0.863, semantic 0.823. Hybrid beats keyword by 0.023 and semantic by 0.063. Question form 0.847, query form 0.925 (hybrid MRR). Category MRR: Playwright spec 1.00, comments 0.95, Go test spec 0.91, doc 0.91, plan 0.85, JSON 0.57 (14 queries).
- Gate keywords (`nokw`, Q8): hybrid MRR 0.886 -> 0.874 (-0.012), keyword 0.863 -> 0.846 (-0.017). On other rounds -0.011 to -0.027. Keywords are worth about 0.01-0.02 MRR, near the noise band; their `C_store` price is in the footprint rows below.
- Embedding recipes (Q7, `round-p3-01`): fact 0.886, fact-kw 0.891, sec-fact 0.887, sec-fact-kw 0.890. All inside +0.005 of `fact`. On `round-p2-02`: 0.899 / 0.902 / 0.899 / -. No recipe passes D11 (mean delta >= 0.02) yet; D11 test runs in Step 5.
- Atomic vs merged (Q5, free reading): atomic `round-02`/`round-final` hybrid MRR 0.863/0.868, merged `round-p3-01` 0.886 (smaller distractor store, not comparable at 0.02). Unified atomic `round-p2-02`/`p2-03` 0.899/0.904. `mean(p2-02, p2-03) - p3-01` = +0.0155, under `band_R` 0.026. D20: V1T keeps the current finalize merge rule.
- Read-time grouping (Q5/A5): section grouping over 30 results raises hybrid MRR 0.886 -> 0.935 (`round-p3-01`) and 0.899 -> 0.973 (`round-p2-02`), but returned chars at 5 rise from 1100 to 4548 (4.1x) and 770 to about 3850. D22 A5 needs chars at 5 not higher: fails by construction (a group shows every member). Not adopted. Group-level hit@k is easier by design (fewer slots).
- Calibration (Q3, `round-p3-01`, fact recipe): query-to-answer cosine p10/p50/p90 0.641/0.725/0.790; query-to-other-source p10/p50/p90/p99 0.459/0.521/0.579/0.629. `QueryFloor` 0.55 sits 0.03 under negative p90; `QueryCeil` 0.70 sits under positive p50. Doc-to-doc paraphrase pairs (203 pairs, `p3-01` vs `p2-02`) p10/p50/p90 0.848/0.924/0.982; unrelated p50/p90/p99 0.704/0.765/0.819. `DocFloor` 0.85 equals paraphrase p10 and is above unrelated p99. Current constants fit the data; no change (D12: a change needs a >0.01 shift in a same-facts win).
- Hold-out base: `round-p3-holdout` hybrid MRR 0.873, keyword 0.854, hit@10 0.932.

Footprint (free; tuning aggregate; `C_store` = fact + non-locator reason + keywords; token recall = protected tokens of covered golden facts found in answering stored facts):

| round | C_distill | C_fact | C_store | C_rec | C_doc | token recall |
|---|---|---|---|---|---|---|
| round-00a | 0.472 | 0.444 | 0.921 | 0.967 | 0.801 | 0.577 |
| round-00b | 0.473 | 0.473 | 0.999 | 1.033 | 0.846 | 0.601 |
| round-02 | 0.513 | 0.473 | 1.013 | 1.059 | 0.875 | 0.596 |
| round-final | 0.498 | 0.497 | 1.028 | 1.062 | 0.883 | 0.612 |
| round-p2-01 | 0.499 | 0.457 | 0.759 | 1.024 | 0.861 | 0.587 |
| round-p2-01b | 0.519 | 0.478 | 0.797 | 1.070 | 0.889 | 0.611 |
| round-p2-02 | 0.622 | 0.549 | 0.910 | 1.236 | 1.040 | 0.631 |
| round-p2-03 | 0.599 | 0.552 | 0.904 | 1.256 | 1.064 | 0.627 |
| round-p2-final | 0.495 | 0.451 | 0.760 | 1.049 | 0.876 | 0.614 |
| round-p3-01 | 0.502 | 0.434 | 0.661 | 0.863 | 0.734 | 0.607 |

Token recall is low across all rounds (0.58-0.63): golden facts are Opus paraphrases, so capitalized words and numbers in them often have no verbatim twin in stored facts. Only differences between rounds are used. `C_store` differs from `C_rec` because the `Stated in` locator counts in `C_rec` but not in `C_store`; the older rounds stored non-locator reasons, hence `C_store` above 1.0 for rounds 00a-final (Part 1/2 reason text), a size problem the locator-only reason of Part 3 removed.

## Step 5 keys, telegraph, verdicts (free analysis over paid post-pass outputs)

Keys (D18/D11, same facts, hybrid MRR delta vs `fact`, paired bootstrap 95% CI):
- `fact-kw`: `round-p3-01` +0.005 [-0.000, +0.011]; `round-p2-02` +0.006 [-0.003, +0.014]; hold-out -0.006 [-0.022, +0.011].
- `sec-fact`: +0.001 [-0.007, +0.009]; +0.000 [-0.009, +0.010].
- `sa-fact-kw` (subject, aspect keys): 0.890 vs 0.886 on `p3-01` (+0.004); 0.913 vs 0.899 on `p2-02` (+0.014). Under 0.02.
- Verdict: A2 (embedding recipe) and A3 (subject, aspect keys) fail D11 (mean delta >= 0.02 with CI lower bound > 0). Not adopted. Gate keywords already carry the effect (`nokw` costs 0.012). A5 grouping fails chars rule (above).

Telegraph post-pass (D24/D25, `tele` = every fact restyled, `tele-guard` = facts failing the token check keep full text, `mixed` = restyle fact in embed text only):
- Hybrid MRR delta vs `full` (`fact`): `p3-01` -0.004 [-0.010, +0.000] (tele), -0.004 [-0.010, +0.001] (tele-guard); `p2-02` -0.002 [-0.009, +0.003] both; hold-out -0.000 [-0.009, +0.009] both. Non-inferiority margin `band_R` 0.026: lower bounds -0.010, -0.009, -0.009 pass.
- Keyword MRR delta vs `full`: `p3-01` -0.001 [-0.003, +0.000]; `p2-02` +0.001 [-0.001, +0.002]; hold-out -0.003 [-0.009, +0.000]. Margin `band_Rk` 0.020: pass.
- Size (footprint, `KIRA_EVAL_STYLE=tele`): fact chars `p3-01` 28996 -> 27001 (style-only ratio 0.931), `p2-02` 36701 -> 34571 (0.942). `C_fact` 0.434 -> 0.404 and 0.549 -> 0.517; `C_store` 0.661 -> 0.631 and 0.910 -> 0.878. Returned chars at 5: 1100 -> 1045 (`tele`), 1052 (`tele-guard`). The D14 estimate of 15-30% fact cut was too high: measured 6-7%, because gate-trimmed facts are already terse.
- Token recall: 0.607 -> 0.601 (`p3-01`), 0.631 -> 0.630 (`p2-02`); band_tok 0.024: pass.
- Token check (D27): residual losses after one retry in `tele`: 14 of 209 facts on `p3-01`, mostly capitalised names or ids that repeat in one fact (for example `P257 | P257`), above the 0.01 rule. `tele` fails the token rule alone; `tele-guard` decides (failing facts keep full text).
- TJ (Opus score judge over `tele` facts, `p3-01`): `R_ess` 0.885 -> 0.878 (-0.007, rule -0.020), unsupported 0.005 -> 0.010 (+0.005, rule +0.010), `R_all` 0.689 -> 0.681. Judge-bias deltas (reported, not gated): atomic 0.746 -> 0.770, standalone 0.981 -> 0.957, `P` 0.737 -> 0.727, reason ok 0.665 -> 0.699.
- Style-pair cosine of a full fact with its rewrite: p10 0.980 (`p3-01`, 209 pairs) and 0.982 (`p2-02`, 414), none below `DocFloor` 0.85; subject cut in 3 and 1 facts.
- D26 verdict: passes with `tele-guard`. Non-inferior retrieval on two bases and hold-out, `C_store` lower, TJ inside rules, token rule met by the guard. Gain is small (about 7% fact chars, 4.5% `C_store`).
