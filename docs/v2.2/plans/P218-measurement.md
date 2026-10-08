# P218 measurement (step 1)

Stopped by user before completion.

No decision. No winner picked. Step 2 not started. C4 incomplete, C5 never ran.

## Environment

- 4 vCPU Xeon 2.8 GHz (AVX512, no VBMI), 16 GB, Go 1.27.1, linux-x64. Shared with other agents.
  Wall times are noisy. Runs used `chrt -r 1`; each run logged non-bench CPU use (p95 under 1.5
  cores unless noted). C3 attempts hit p95 2.4 to 2.7 and are still usable (accuracy, memory).
- sherpa-onnx-go v1.13.8, bundled ONNX Runtime 1.28.2. Models pinned by HF revision in
  `internal/memory/stt/bench_test.go` (SHA-256 verified by `modelstore.Install`).
- Baseline: whisper.cpp libs rebuilt on this host (the stale prebuilt libs SIGILLed: built on a CPU with VBMI).
- Fixtures: F1 jfk 11.0 s, F2 23.3 s, F3 30 utterances 225.7 s (plan said about 6 min), F4 61.3 s synthetic
  (Kokoro v0_19), F5 67.8 s.
- Threads 4 for every engine. Glossary of 30 terms passed to every engine.

## Harness findings

- Baseline `resetVAD` is never called before a worker's first session. On this build the Silero state
  is garbage then: the first session dropped the opening ~6 s of F1. Harness calls `resetVAD` once
  after engine build, for every engine. Latent app bug in code step 2 deletes.
- VAD file: the v5 ONNX files named in the plan (`csukuangfj/vad`, `onnx-community`) load in sherpa
  but gave identical output and missed "ask not" in F1 (onset 128 vs baseline 103), so C1/C3/C4 lost
  words. Used official Silero 6.2 ONNX instead (MIT): `snakers4/silero-vad` tag `v6.2`,
  `src/silero_vad/data/silero_vad.onnx`, 2327524 bytes, SHA-256
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. Onset lag vs baseline: 2 frames.
- C4 as planned (Moonshine v2 streaming small/medium, sherpa layout) does not exist; those HF repos
  are transformers layout. Substitute: `csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27`
  @`8f4d6c58` (MIT per its LICENSE; `.ort` encoder 31.3 MB + merged decoder 109.4 MB).
- C5 punctuation and casing: `Edge-Punct-Casing` CNN-BiLSTM int8 (Apache-2.0 per
  `frankyoujian/Edge-Punct-Casing` card), via mirror `brady-pplx/...-online-punct-en-2024-08-06` @`29a49a07`
  (file hashes equal the k2-fsa release tarball). Never run.
- sherpa Whisper has no prompt option (prompt strings exist only for LLM decoders). C1/C2 run unprimed.
- Go binding exposes hotwords only as recognizer config (`HotwordsBuf`), not per stream. Harness built
  the C5 recognizer with the glossary.

## Results (A = full run, glossary mode; baseline row 2 = empty glossary)

| run | load s | F1 quote | F1 stop-final s | F5 stop-final s | median partial gap s | F2+F3 WER % | F4 WER % | terms /30 | RTF final F3 | VmHWM MB after F1 / F5 / end | cased+punct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 0.3 | yes | 6.68 | 12.62 | 3.62 | 10.41 | 1.46 | 28 | 0.58 | 494 / 513 / 516 | 26/32 |
| baseline, empty glossary | 0.4 | yes | 5.46 | 4.71 | 3.18 | 6.02 | 16.79 | 24 | 0.49 | 341 / 359 / 363 | 27/32 |
| C1 whisper small.en int8 | 3.5 | yes | 5.36 | 7.47 | 4.36 | 6.50 | 18.98 | 25 | 0.79 | 828 / 1019 / 1022 | 23/32 |
| C2 distil-small.en int8 | 1.8 | yes | 2.24 | 1.98 | 1.17 | 7.64 | 30.66 | 19 | 0.25 | 571 / 702 / 715 | 28/32 |
| C3 moonshine base int8 | 2.1 | yes | 0.59 | 0.49 | 0.53 | 7.64 | 26.28 | 21 | 0.08 | 396 / 463 / 465 | 32/32 |
| C4 moonshine base quantized | n/a | yes (F1 only) | 0.40 | 0.39 | n/a | n/a | n/a | n/a | n/a | 366 after F5; run killed after 8 sessions | n/a |
| C5 zipformer + punct | not run | | | | | | | | | | |

C3 numbers are attempt 1 (attempt 2: WER 7.80, F4 26.28, HWM end 468; same verdicts). Baseline
HWM ranges 341 to 516 MB between runs and modes. Baseline (glossary) misses the G6 bounds (3.0, 5.0,
1.5 s), so per the plan its bounds become 8.35 / 15.78 / 4.53 s.

## Gate verdicts (baseline = glossary row)

Limits: F2+F3 WER at most 11.41; F4 WER at most 3.46; terms at least 25; VmHWM at most 400 MB.

| gate | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|
| G1 build-free | pass | pass | pass | pass | pass |
| G2 licences | pass (MIT weights; HF repo has no licence file, derived from openai/whisper MIT) | pass (distil-whisper MIT) | pass (MIT) | pass (MIT) | pass (Apache-2.0, model and punct) |
| G3 platforms | pass | pass | pass | pass | pass |
| G4 memory | FAIL 1022 | FAIL 715 | FAIL 465 | unknown (366 at partial run) | not run |
| G5 accuracy | FAIL F4 WER 18.98 (F1 and F2+F3 pass; terms 25 pass) | FAIL F4 30.66, terms 19 | FAIL F4 26.28, terms 21 | not run | not run |
| G6 responsiveness | pass vs relaxed bounds | pass | pass | F1/F5 pass, gap unmeasured | not run |
| G7 output form | pass | pass | pass | not checked | not run |

G3 shipped libs checked: darwin arm64 `libsherpa-onnx-c-api.dylib` 4178984 B + `libonnxruntime.dylib`
29006384 B; x86_64 4489320 B + 32315856 B. Not run: M-link checks (two ORTs, link cost).

## Viable candidate?

None among completed runs. Every unprimed engine fails F4 by a wide margin (baseline empty-glossary
also scores 16.79, so the gate mostly measures the whisper prompt). C1 and C2 and C3 also fail G4.
C4 (smallest memory, fast) and C5 (only engine with glossary biasing) are the open questions.

## Deferred / unverified

- C4 full run, C5 run, M-link, VAD equivalence table (baseline vs sherpa commit cuts recorded in rows only).
- Real-voice accuracy, everything macOS.
- Latency numbers carry host noise; baseline decode took 3.3 s per call at best.
