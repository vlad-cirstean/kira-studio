# P291 report

Terse per `CLAUDE.md`. Numbers: `P291-runs/results.md`, `P291-runs/retrieval/*.json`, `P291-runs/compare/*.json`. Spend 14.04 of 20 USD (ledger `P291-runs/spend-p291.jsonl`).

## Answers

1. Retrieval today (`round-p3-01`, hybrid, 540 queries, 10 sources plus hold-out facts as distractors): MRR 0.886, hit@1 0.843, hit@5 0.944, hit@10 0.957; conditional MRR 0.923, hit@10 0.998. Keyword 0.863, semantic 0.823. Question form 0.847, query form 0.925. Weakest category JSON (0.57, 14 queries). Hold-out 0.873.
2. Noise: `band_R` 0.026, `band_Rk` 0.020, `band_tok` 0.024 (three identical-code pairs).
3. Calibration: positives p10/p50/p90 0.641/0.725/0.790, negatives p90 0.579, p99 0.629; paraphrase doc pairs p10 0.848 against `DocFloor` 0.85. Constants fit; unchanged. Telegraph style leaves the distributions unchanged (positives p10 0.634 to 0.645).
4. Unified pipeline: V1T `R_ess` 0.977 (base 0.885), `R_all` 0.886 (0.689), `P` 0.717 (0.737), unsupported 0.003, hybrid MRR 0.905 (+0.019, CI [-0.005, +0.043]), keyword 0.891 (+0.028), token recall 0.828 (0.607), `C_fact` 0.597 (0.434), `C_store` 0.908 (0.661), `C_doc` 1.017 (0.734). Older tree `round-p2-02`/`p2-03`: MRR 0.899/0.904.
5. Atomic against merged: `mean(p2-02, p2-03) - p3-01` = +0.0155, under the band; merge rule kept (D20). Read-time grouping: section grouping MRR 0.935 (`p3-01`), 0.973 (`p2-02`), returned chars at 5 rise 4.1x; subject grouping 0.899 to 0.938 with more chars. Not adopted.
6. Subject and aspect keys: `sa-fact-kw` +0.004 (`p3-01`), +0.014 (`p2-02`) over `fact`; +26 chars per fact (19%); 173 distinct subjects over 209 facts. Under the 0.02 floor.
7. Embedding recipes (hybrid MRR delta over `fact`): `fact-kw` +0.005/+0.006, `sec-fact` +0.001/+0.000, `sa-fact-kw` +0.004/+0.014. None passes D11.
8. Gate keywords: `nokw` costs 0.012 hybrid MRR and 0.017 keyword MRR on `p3-01`.
9. "Half" test: `C_distill` 0.502, `C_fact` 0.434, `C_store` 0.661, `C_doc` 0.734 on the base at `R_ess` 0.885. Golden essential facts alone are 0.47 of source chars. Facts alone reach about 0.43 to 0.50 of source; with reasons and keywords stored size is 0.66 to 0.75; the rendered doc is 0.73 to 0.84. Storage is below source in every adopted-or-tested variant except V1T `C_doc`.
10. Telegraph style on identical facts: hybrid MRR delta -0.004/-0.002/-0.000 (`p3-01`/`p2-02`/hold-out), keyword -0.001/+0.001/-0.003, all inside the band. Fact chars -6.9%/-5.8%, `C_store` -4.5%/-3.5%. Token check: 14 of 209 facts fail after retry on `tele` (names and ids repeated in one fact), `tele-guard` fixes them. TJ `R_ess` -0.007, unsupported +0.005; judge bias: standalone 0.981 to 0.957, atomic 0.746 to 0.770. Mixed store (`mixed`) ranks like `full`. Style-pair cosine p10 0.980. Prompt level: V1T and XT both fail D10.
11. Adopted: nothing in code. Harness, `internal/textloss` and docs land. A1 fails (hybrid +0.019 under 0.026; `C_doc` 1.017). A2, A3 fail D11. A4 fails on `C_store(XT) 0.753 > 0.661`. A5 fails the chars rule.

## Decision arithmetic

- D26 (post-pass): MRR lower bounds -0.010/-0.009/-0.009 above -0.026; keyword above -0.020; `tele` token rule fails (14/209 > 0.01), `tele-guard` decides and passes; TJ inside both rules; `C_store` lower. Pass.
- D10 A1 (V1T): `0.905 - 0.886 = 0.019 <= 0.026`. Fail. `C_doc 1.017 >= 1.0`. Fail.
- D10 A4 (XT): MRR 0.891 >= 0.860, keyword 0.872 >= 0.843, `R_ess` 0.949 >= 0.865, unsupported 0.008, token recall 0.761, sizes below 1.0, `C_store` 0.753 not below 0.661. Fail.

## Deviations

Tuning stores add the hold-out facts as distractors (saturation). `kw-sa` and `sa-fact` fall back for distractors without keys. Pipeline, gate and judge costs per run exceeded the plan estimates (V1T 5.31 against 4.5). Step 8, 9, 9b skipped (gates failed). Step 11 full suites and real `claude` rows not run (later test-and-fix agent).
