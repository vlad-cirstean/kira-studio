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

## Bands

(empty until Step 3)

## Rounds

### Step 2 questions

372 essential golden facts, 15 sources, Opus, 744 inputs (372 questions, 372 queries). Leak guard (D3, 4 consecutive content words) dropped 22 of 744 (listed per item in `P291-corpus/questions.jsonl`: `questionLeak`, `queryLeak`). Run USD 1.136 of cap 2.5 (est 2.0). Phase total 1.136.
