# P218 plan: speech to text without a C++ build

Base: `7f626e91a` (P217 close-out), branch `v2.0`.

## Ask (user's words, condensed)

The whisper.cpp C++ build must go, whatever the measurement says. whisper.cpp is not a fallback.
Replace it with an engine that needs no C/C++ compile on our side: prebuilt official libraries or the
ONNX Runtime the app already bundles. Delete everything that existed only for the build. Keep
user-facing dictation behaviour, malgo mic capture, worker isolation, model store with pinned SHA-256,
and the 400 MB RSS ceiling.

"No C/C++ compile on our side" means no CMake, no third-party source build, no static archive we
produce. cgo compiling a Go binding's own preamble against a prebuilt shared library is allowed: malgo
and `onnxruntime_go` already do that, and no Go binding to a native library avoids it.

Two steps, strictly in order. Step 2 starts only after step 1's decision is committed.

## What exists today (verified on disk)

- `internal/memory/stt`: `engine.go` (interface: `vad`, `resetVAD`, `transcribe(samples, final,
  prompt)`, `close`), `engine_whisper.go` (`//go:build whisper && cgo`, own cgo glue, static
  `-lwhisper -lggml…`, Metal on darwin arm64), `engine_stub.go` (`!(whisper && cgo)`, `Built=false`),
  `spec.go` (`WhisperCommit`, ggml model plus Silero v6.2.0 ggml VAD, id
  `whisper-small.en-q5_1-5359861`), `stream.go` (VAD gate, partials, LocalAgreement-2, pause commit,
  12 s window cap; `prompt()` builds the glossary plus committed-tail prompt), `worker.go`, `client.go`
  (`Status` returns `off` when `!Built`), `dictation.go`, `capture*.go` (malgo), `protocol.go`,
  `transcript/`, `smoke_test.go` (`whisper && sttsmoke`, reads `jfk.wav` from the fetched whisper.cpp
  tree, asserts the quote, VmHWM under 400 MB, idle exit).
- `stream.go` uses `Word.EndMS` only as a `pickCut` fallback, and tolerates 0.
- `client.go` `finalTimeout` is 30 s. `docs/ARCHITECTURE.md` says "killed 2 s after a stop request":
  stale, fix in step 2.
- Build-only artefacts: `scripts/fetch-whisper.sh`; `apps/kira-space/build/darwin/Taskfile.yml`
  (`fetch:whisper` task and dep, `EXTRA_TAGS: whisper…`, `-I/-L build/whisper/…` cgo flags);
  `apps/kira-space/.gitignore` `build/whisper`; `scripts/verify-packaging.sh` S10 comment and S13
  commit/tag checks; `docs/pending-changes/.github__workflows__pr.yml.patch` (only the P216 tagged
  build step); `apps/kira-space/main.go:67` comment; docs in `ARCHITECTURE.md` (Stack row, "Memory MCP
  server and module" speech bullets, Known open items), `DEV_ENVIRONMENT.md` (speech bullet),
  `PACKAGING.md` (whisper.cpp paragraph).
- `packages/workbench/src/memory/dictation/MicButton.vue:80` hard-codes "182 MB download, about 340
  MB RAM".
- `NOTICES.md` has no whisper.cpp or Silero entry today (P216 gap). Nothing to delete there; the new
  engine gets a proper entry.
- PR CI `checks` job runs on `macos-15` and runs `go build ./...` with cgo on. An untagged cgo engine is
  therefore compiled on darwin by the existing step; the pending patch becomes unnecessary.

## Candidate research (done while planning; step 1 re-checks at run time)

sherpa-onnx (k2-fsa, Apache-2.0). Go module `github.com/k2-fsa/sherpa-onnx-go` v1.13.8 (2026-09-11)
re-exports `sherpa-onnx-go-linux` / `-macos` / `-windows` v1.13.8. Each platform module ships the
prebuilt libs inside the module zip, linked through cgo with `-lsherpa-onnx-c-api -lonnxruntime
-Wl,-rpath,${SRCDIR}/lib/<triple>`:

- linux: `lib/x86_64-unknown-linux-gnu/{libsherpa-onnx-c-api.so 5.1 MB, libonnxruntime.so 27 MB}`
  (also aarch64, armhf).
- macos: `lib/aarch64-apple-darwin/{libsherpa-onnx-c-api.dylib 4.2 MB, libonnxruntime.dylib 29 MB}`
  plus `x86_64-apple-darwin`. Install names are `@rpath/libsherpa-onnx-c-api.dylib` and
  `@rpath/libonnxruntime.dylib`.
- Bundled ONNX Runtime is 1.28.2. The app's embed worker uses Microsoft ORT 1.29.1 (arm64 only,
  dlopen). Two different ORT copies is a packaging fact step 1 must settle (M-link below).
- Go module zips are checksum-pinned by `go.sum` and the Go checksum database. That is the pin; no
  fetch script is needed for the library.
- Go API facts: `OfflineWhisperModelConfig` has no prompt and no temperature fallback;
  `EnableTokenTimestamps` exists. Hotwords exist for transducer models only. The Silero VAD API is
  segment based (`AcceptWaveform`, `IsSpeech`, `Front/Pop`, `Reset`); there is no per-frame
  probability getter.

Models (Hugging Face, pinned by revision; sizes from the HF API):

| Id | Model | Licence | Download | Notes |
|---|---|---|---|---|
| C1 | `csukuangfj/sherpa-onnx-whisper-small.en` @`d9533f69` int8 encoder+decoder+tokens | MIT (OpenAI weights) | 375 MB | primary; no prompt |
| C2 | `csukuangfj/sherpa-onnx-whisper-distil-small.en` @`0492324b` int8 | MIT | 299 MB | no prompt |
| C3 | `csukuangfj/sherpa-onnx-moonshine-base-en-int8` @`052b0798` | MIT (Useful Sensors) | 287 MB | variable-length input, no 30 s pad; no timestamps |
| C4 | Moonshine v2 streaming small/medium English, sherpa layout | MIT claimed for English | ~200 to 350 MB | include only if v1.13.8's Go binding loads it and the model card states MIT; else record "unavailable" |
| C5 | `csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26` @`672fbf1b` int8 | Apache-2.0 | 73 MB | hotwords (glossary biasing); LibriSpeech-only training; upper case, no punctuation |
| VAD | `onnx-community/silero-vad` @`e71cae96` `onnx/model.onnx` (MIT) or `csukuangfj/vad` @`fba88cd2` `silero_vad_v5.onnx` | MIT | 2 MB | step 1 picks the one sherpa's VAD loads |

Screened out (no measurement; it would not change the decision):

- Parakeet TDT 0.6b v2/v3, Canary: CC-BY-4.0 weights, not an OSI licence; 660 MB int8 encoder alone.
- Qwen3-ASR 0.6B, FunASR-nano: LLM decoder, well over 400 MB RSS at 0.6B params.
- Vosk: second native runtime, English accuracy below Whisper small at any size under 400 MB.
- Whisper via the already-bundled ORT 1.29.1 with our own log-mel, decoder loop and tokenizer: a
  hand-rolled inference stack where a maintained library (sherpa-onnx) exists. Library rule declines
  it. Revisit only if every sherpa candidate fails on packaging alone (M-link), never on accuracy.
- whisper.cpp in any form: user decision.

## Step 1: measurement (Sonnet, Linux x86_64)

Goal: one winner, or a documented "none passes". Output: `docs/v2.2/plans/P218-measurement.md`,
committed before step 2.

### 1.1 Harness (commit it; step 2 deletes it)

- `internal/memory/stt/bench_test.go`, `//go:build whisper && sttbench`. Baseline needs the
  `whisper` tag, so run `sh scripts/fetch-whisper.sh linux-x64` first (still present in step 1).
- Add `github.com/k2-fsa/sherpa-onnx-go v1.13.8` to `go.mod` in this commit (step 2 keeps it).
- Test-only engines implementing `engine`: `benchWhisperOnnx` (C1, C2), `benchMoonshine` (C3, C4),
  `benchZipformer` (C5, online recognizer fed one window, `InputFinished`, decode; per-stream
  hotwords from the glossary with `modified_beam_search`). Common VAD adapter: feed 512-sample frames
  to sherpa's Silero VAD, report `IsSpeech()` as 1 or 0 per frame (`MinSilenceDuration` and
  `MinSpeechDuration` at one frame, threshold 0.5), drain segments with `Pop` so the detector never
  grows. Baseline uses the existing `whisperEngine` unchanged.
- Worker re-exec like `smoke_test.go`: `init` reads `KIRA_STT_BENCH_WORKER=<engine>:<modelDir>`,
  builds that engine and calls `serve` directly. The test drives `Client.Dictate` with a fake mic, so
  every candidate runs the real `stream` pipeline (VAD gate, partials, commits, `transcript.Merge`).
- Each run appends one JSON line per fixture to `$KIRA_STT_BENCH_OUT`: engine, fixture, final text,
  text-frame timestamps, stop-to-final latency, worker VmHWM, decode wall time.
- Model download through `modelstore.Install` with each candidate's pinned SHA-256 (LFS oid from the
  HF API, or sha256 of the downloaded small files). This also proves the store entry works.
- Fixture prep: `internal/memory/stt/testdata/bench/prepare.py` (run with `python3 -I` in a scratch
  venv; `pip install sherpa-onnx soundfile pyarrow`). Audio lands in `$KIRA_STT_BENCH_DIR`, never in
  git. Reference transcripts and the technical-vocabulary texts live in the harness source.
- Threads: `min(4, NumCPU)` for every engine, same as baseline.

### 1.2 Fixtures

- F1 `jfk.wav`, the P216 smoke fixture (from the fetched whisper.cpp tree). Quote must match.
- F2 `test_wavs/0.wav`, `1.wav` from C1's HF repo with `trans.txt` (LibriSpeech).
- F3 first 30 utterances of `hf-internal-testing/librispeech_asr_dummy` @`5be91486` (CC-BY-4.0,
  about 6 min). WER set.
- F4 technical vocabulary: 15 sentences carrying 30 glossary terms from this repo's own domain
  (PostgreSQL, ClickHouse, Kubernetes, gRPC, OAuth, Pinia, TanStack Query, Wails, SQLite, Redis,
  Kafka, MongoDB, shadcn, Tailwind, Vue, TypeScript, golangci-lint, CodeGraph, sherpa-onnx, ONNX,
  Monaco, SlickGrid, Playwright, Zod, Docker, MCP, worktree, rebase, Opus, Sonnet). Synthesized with
  sherpa-onnx offline TTS (Kokoro English, Apache-2.0, two voices), resampled to 16 kHz mono s16.
  Synthetic speech; the real-voice check is deferred (below).
- F5 continuous 60 s: F3 utterances concatenated without pauses longer than 300 ms, to hit the 12 s
  window cap, `pickCut` and the longest-buffer memory peak.
- Pass the F4 glossary to `Dictate` for every engine. Baseline also runs once with an empty glossary,
  so the doc shows what the whisper prompt is worth.

### 1.3 Metrics

- Peak RSS: worker `VmHWM` after the F5 session (largest window) and after the full fixture run.
- Speed: decode real-time factor (decode wall time / audio duration) over F3; stop-to-final latency
  on F1 and F5 at 1x real time; median gap between `text` frames during speech (live partial cadence)
  on F1 and F5 at 1x; model load time to hello.
- Accuracy: F1 quote match; WER on F2+F3 (lowercase, strip punctuation, numbers left as words);
  F4 WER and glossary-term recall (term counted when it appears, case-insensitive, with internal
  punctuation and spacing normalised); casing and punctuation present (yes/no).
- Size and licence: total download bytes; licence of binding, runtime, model, VAD, read from the
  upstream files at the pinned revision, not from search snippets.
- Native-library shape (M-link), measured once with the best-scoring candidate's engine:
  - Two ORTs coexisting: build a test binary that links sherpa (1.28.2, load time) and run the P210
    embed smoke test (`KIRA_ORT_LIB` at fetch-onnxruntime's 1.29.1 `linux-x64`) in it. Pass when
    it succeeds and vectors equal a run without sherpa linked (cosine 1.0 within 1e-6).
  - Load-time link cost: `go build -tags server ./apps/kira-space` with and without the sherpa
    engine; median wall time of 50 `memory-mcp --help`-class shim execs (pick a subcommand that exits
    at once) and that process's VmHWM.
  - Bundle delta: bytes added per darwin arch (dylibs from the module zip).
- VAD equivalence: on F1 and F5, commit boundaries (pause cuts) of each candidate vs baseline. Record;
  it explains WER differences and is not a separate gate.

### 1.4 Gates (all hard; fixed before any number is seen)

- G1 build-free: only prebuilt shared libs and Go modules; no CMake, no compiler beyond cgo's binding
  preamble.
- G2 licences: OSI licence (MIT, Apache-2.0, BSD) for binding, runtime, model and VAD.
- G3 platforms: prebuilt darwin-arm64 and linux-x64 libs in the pinned release (already true for
  sherpa-onnx v1.13.8; re-check the pinned zip).
- G4 memory: worker VmHWM at most 400 MB over every fixture, F5 included. Under 370 MB is "comfortable";
  370 to 400 passes but is flagged, since the Mac footprint is unmeasured.
- G5 accuracy, "not materially worse than baseline":
  - F1 quote matches.
  - F2+F3 WER at most baseline + 1.0 percentage point (absolute).
  - F4 WER at most baseline + 2.0 points, and glossary-term recall at least baseline (with glossary
    prompt) minus 10 points (3 of 30 terms).
- G6 responsiveness on the 4-vCPU sandbox: F1 stop-to-final at most 3.0 s; F5 stop-to-final at most
  5.0 s; median partial gap at most 1.5 s. If the baseline itself misses a G6 bound, that bound
  becomes baseline x 1.25.
- G7 output form: final text has normal casing and sentence punctuation, as today. C5 passes only
  with an OSI-licensed English casing-and-punctuation model sherpa's Go binding runs in the same
  worker, its RSS counted under G4. If none exists, record C5 as failing G7 and skip its timing runs.

### 1.5 Decision rules

- Winner: among candidates passing G1 to G7, lowest combined WER over F2+F3+F4. Within 0.5 points,
  prefer lower F5 VmHWM, then smaller download.
- M-link: same executable, load-time link (shape A, like `memory-embed`) when the two-ORT check passes,
  the shim exec median grows by at most 20 ms and its VmHWM by at most 15 MB. Otherwise shape B: a
  separate helper executable `kira-space-stt` (its own `main` package, only it imports sherpa). Shape
  A's known cost: a missing or unsigned dylib stops the whole app launching, not only dictation; S13
  (step 2) guards the bundle contents.
- ORT copies: the stt engine uses sherpa's own `libonnxruntime.dylib` (1.28.2, arm64 and x86_64);
  embed keeps Microsoft 1.29.1 (arm64 only). Unifying on one ORT is out of scope: 1.29.1 has no x86_64
  macOS build and would break the universal bundle's x86_64 slice under shape A.
- No candidate passes: write the per-gate failures to `P218-measurement.md`, commit, and stop. The
  orchestrator takes the finding to the user. Step 2 does not run and whisper.cpp stays only until the
  user decides; it is not proposed as the answer.

### 1.6 Output and commits

1. `test(stt): P218 engine comparison harness` (harness, `prepare.py`, `go.mod`/`go.sum`). Hooks must
   pass; the harness is tag-gated, so untagged lint and build are unaffected, and golangci-lint also
   runs with `--build-tags whisper,sttbench`.
2. `docs(plans): P218 measurement` adding `docs/v2.2/plans/P218-measurement.md`: environment (CPU,
   RAM, Go, sherpa-onnx and model revisions), one table per metric with every candidate and the
   baseline, gate verdicts, M-link numbers and choice, winner (or "none"), the winner's exact model
   files with URL, revision, size and SHA-256, the VAD file chosen, and the numbers step 2 puts in the
   UI copy (download MB, RAM MB). List deferred verifications (below).

Resume point: harness commit present, measurement doc absent means re-run the harness; JSON lines
are cheap to regenerate.

## Step 2: migration (Sonnet; only after a winner is committed)

Written for C1 (sherpa-onnx Whisper small.en int8). For another winner, only the engine body and
the spec values change; every deletion and packaging item is the same. Read `P218-measurement.md`
first and take every number, URL and hash from it.

### 2.1 Go code

- `internal/memory/stt/engine.go`: interface and comments name no engine. Drop the `transcribe`
  parameters the winner cannot use. C1, C2, C3 and C4 take no prompt and no temperature flag:
  `transcribe(samples []float32) ([]transcript.Word, error)`. C5 takes hotwords instead of a prompt.
  Move `appendToken` here (engine-neutral) when the winner returns tokens.
- `internal/memory/stt/engine_sherpa.go` (new, `//go:build cgo`): `const Built = true`; `newEngine`
  builds `sherpa.OfflineRecognizer` (Whisper encoder, decoder, tokens; `Language "en"`, `Task
  "transcribe"`, `EnableTokenTimestamps 1`, `NumThreads min(4, NumCPU)`, `Provider "cpu"`) and the
  Silero VAD exactly as the harness's adapter did. `vad` feeds 512-sample frames and returns 1 or 0
  per frame, popping segments; `resetVAD` calls `Reset`; `transcribe` uses one `OfflineStream` per
  call, deleted after `Decode`; tokens plus timestamps become `transcript.Word` through `appendToken`.
  `close` deletes recognizer and VAD.
- `engine_whisper.go`: delete. `engine_stub.go`: rename to `engine_nocgo.go`, `//go:build !cgo`
  (embed's own `encoder_nocgo.go` pattern), comment updated.
- `stream.go`: delete `prompt()`, `promptTailRunes` and the prompt arguments when unused; the package
  comment says "the model" instead of Whisper specifics where they no longer hold (no `audio_ctx`, no
  temperature fallback). `glossary` stays: `transcript.Merge` uses it for casing.
- `spec.go`: delete `WhisperCommit`, `whisperRevision`, `vadRevision`, the ggml file names. New
  constants for the model revision, file names (encoder, decoder, tokens, VAD), and `SherpaVersion =
  "1.13.8"` (S13 compares it with `go.mod`). `Default.ID` e.g. `sherpa-whisper-small.en-int8-d9533f6`.
  Package doc names sherpa-onnx.
- Model store entry: every file in `Default.Files` with `https://huggingface.co/<repo>/resolve/<rev>/<file>`,
  size and SHA-256 from the measurement doc. C1 reference values from the HF API: encoder
  `small.en-encoder.int8.onnx` 112442483 bytes, SHA-256
  `8bdac288f369aa94ee2194059238c465ed82ea9d47ee8fa4a8c0a891873e462f`; decoder
  `small.en-decoder.int8.onnx` 262223042 bytes,
  `710ccf890e10f3faa15f51ec346081a2723c9f3adb6e4da81c6573a5a6f877fb`; `small.en-tokens.txt` 835554
  bytes (hash computed from the download). Confirm all against a fresh download before committing.
- Old install dir `models/whisper-small.en-q5_1-5359861`: if `git tag --contains 26ec93700` (P216)
  lists a release tag, `NewClient` removes that one legacy directory once (users would otherwise keep
  191 MB of dead weights). If P216 never shipped, no cleanup code.
- `client.go`, `worker.go`, `dictation.go`, `capture*.go`, `protocol.go`, `transcript/`: no behaviour
  change. Update any comment naming whisper.cpp. `transcript.go` package doc: "model hypotheses".
- `smoke_test.go`: `//go:build cgo && sttsmoke`; comment drops fetch-whisper and CGO flags; fixture
  moves to committed `internal/memory/stt/testdata/jfk.wav` (copied once from the whisper.cpp tree
  before deleting it; JFK's 1961 address is a US government work in the public domain). Same
  assertions: quote, live text frames, VmHWM at most 400 MB, idle exit.
- `bench_test.go` and `testdata/bench/`: delete. The measurement doc is the record.
- Shape B only: `apps/kira-space/cmd/kira-space-stt/main.go` calling `stt.RunWorker`; `defaultCommand`
  execs the sibling helper; `main.go` drops the `memory-stt` shim case.
- `apps/kira-space/main.go:67`: comment says "speech-to-text worker".

### 2.2 Library fetch and bundle

- Library: `go.mod` pins `github.com/k2-fsa/sherpa-onnx-go v1.13.8`; `go.sum` holds the module and
  platform-module hashes, checked against sum.golang.org. No fetch script. Linux dev and tests link
  from the module cache through the binding's own rpath; nothing to download by hand.
- `apps/kira-space/build/darwin/Taskfile.yml`:
  - `build`: drop the `fetch:whisper` dep and the `whisper` tag. `EXTRA_TAGS` passes through
    unchanged.
  - `build:native` env: `CGO_CFLAGS: -mmacosx-version-min=14.0`; `CGO_LDFLAGS: -mmacosx-version-min=14.0
    -Wl,-rpath,@executable_path/../Frameworks`.
  - Delete the `fetch:whisper` task.
  - `create:app:bundle`: resolve `SHERPA=$(go list -m -f '{{.Dir}}' github.com/k2-fsa/sherpa-onnx-go-macos)`;
    copy `libsherpa-onnx-c-api.dylib` and `libonnxruntime.dylib` into `Contents/Frameworks/`. For a
    universal build, `lipo -create` the `aarch64-apple-darwin` and `x86_64-apple-darwin` copies; for a
    single-arch build copy that arch only. Fail loudly when missing (same style as the ORT block).
    `install_name_tool -delete_rpath "$SHERPA/lib/<triple>"` on the app binary (or helper in shape
    B), so no build-machine path ships. All before `codesign:adhoc`. Copy sherpa-onnx `LICENSE` to
    `Contents/Resources/sherpa-onnx-LICENSE.txt`.
  - `run`: same copies into the `.dev.app`, conditional like the ORT block.
  - Shape B adds a `go build` of the helper next to the main binary, and `lipo` for universal.
- `apps/kira-space/.gitignore`: delete `build/whisper`.
- ORT notices for sherpa's 1.28.2 copy: confirm in step 2 that it is an official Microsoft build
  (version strings, `ORT_API_VERSION`). Ship the matching `ThirdPartyNotices.txt` as
  `Contents/Resources/onnxruntime-1.28.2-ThirdPartyNotices.txt`, committed under
  `apps/kira-space/build/darwin/notices/` from the `v1.28.2` onnxruntime tag. Record its SHA-256 in
  the commit message.

### 2.3 Packaging checks

- `scripts/verify-packaging.sh`: S10 comment drops the whisper.cpp checkout reason, and the
  `--exclude-dir=build` stays only if something else still needs it (check; remove when nothing does).
- S13 rewritten: `SherpaVersion` in `internal/memory/stt/spec.go` equals the
  `github.com/k2-fsa/sherpa-onnx-go` version in `go.mod`; `create:app:bundle` references
  `libsherpa-onnx-c-api.dylib` and `libonnxruntime.dylib`; `CGO_LDFLAGS` carries
  `@executable_path/../Frameworks`; both plists keep `NSMicrophoneUsageDescription`; no
  `fetch-whisper`, `whisper{{` or `build/whisper` string remains in the Taskfile or `scripts/`.
- `docs/PACKAGING.md`: add S13 to the S-check list (missing since P216) with the new wording.

### 2.4 CI

- Delete `docs/pending-changes/.github__workflows__pr.yml.patch` (its only hunk is the whisper
  build). The `macos-15` `checks` job's `go build ./...` now compiles the cgo engine with no extra
  step. Linux jobs build and test with the module's linux libs. Confirm by reading `.github/workflows/`
  that no job sets `CGO_ENABLED=0` for packages importing `stt`; if one does, the `!cgo` stub covers it.
- golangci-lint: untagged run only; drop the `--build-tags whisper` instruction everywhere.

### 2.5 Licences

- `NOTICES.md`: new section "sherpa-onnx and the speech models": sherpa-onnx (Apache-2.0) C API
  library and Go binding, its ONNX Runtime 1.28.2 copy (MIT) with notices file, the model (C1:
  OpenAI Whisper small.en weights, MIT, converted by k2-fsa), Silero VAD (MIT), malgo and miniaudio
  (MIT / public domain, missing since P216). Models download on click and are not bundled.
- Check the pinned sherpa-onnx tag for a `NOTICE` file. Ship it beside the licence if present.

### 2.6 Frontend

- `MicButton.vue:80`: download MB and RAM MB from the measurement doc. No other UI change: status
  states (`off`, `notInstalled`, `downloading`, `unavailable`, `ready`) and stream frames are
  unchanged.

### 2.7 Docs

- `docs/ARCHITECTURE.md`: Stack row "Local speech to text" (sherpa-onnx v1.13.8 prebuilt via Go
  module, model, VAD, declined: whisper.cpp (C++ build, user decision), Parakeet (CC-BY-4.0), hand-rolled
  ORT Whisper (library rule), plus any measured loser with its failing gate). Speech bullets in "Memory
  MCP server and module": model files and hashes, no source build, `Built` keyed on cgo, the 30 s
  final timeout (fixing the stale 2 s), prompt removal, VAD per-frame booleans. Known open items:
  rewrite the Mac item (dylib load from Frameworks, rpath, codesign, CPU speed on Apple Silicon,
  real mic, TCC) and add the deferred real-voice accuracy check.
- `docs/DEV_ENVIRONMENT.md`: speech bullet without fetch script and CGO flags; smoke command
  `go test -tags sttsmoke ./internal/memory/stt/ -run Smoke -v`.
- `docs/PACKAGING.md`: replace the whisper.cpp paragraph with the sherpa-onnx bundle paragraph
  (files, lipo, rpath, notices, bundle delta, human Mac checks).
- `docs/v2.2/SPEC.md`: P218 result section; status Done.
- `git grep -n -i -E 'whisper\.cpp|fetch-whisper|ggml|-tags whisper|whisper &&|build/whisper'` outside
  `docs/v1*`, `docs/v2.0`, `docs/v2.1`, `docs/v2.2/SPEC.md` result history and `P218-*` plan files:
  zero hits. "Whisper" as the model name stays where the winner is a Whisper model.

### 2.8 Verification (once, near the end)

- `go build ./...`; `CGO_ENABLED=0 go build ./internal/memory/...`; `go build -tags server
  ./apps/kira-space`; `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/`;
  golangci-lint; `bun run typecheck`, `lint`, `lint:dead`.
- Smoke: `go test -tags sttsmoke ./internal/memory/stt/ -run Smoke -v` (quote, VmHWM at most 400 MB,
  idle exit). Embed smoke still green with sherpa linked (shape A).
- Playwright `memory-dictation` and `memory-module`.
- `sh scripts/verify-packaging.sh` S13 green (S-items that need macOS stay unrun, as documented).
- The grep in 2.7 returns nothing.
- `rm -rf apps/kira-space/build/whisper` locally after `jfk.wav` is committed.

### 2.9 Commits (each hook-green; no `--no-verify`)

1. `feat(stt)!: sherpa-onnx engine replaces whisper.cpp` (engine files, interface, stream, spec,
   smoke test, fixture, bench removal; `BREAKING CHANGE:` footer: model re-download, new id).
2. `build(space): bundle sherpa-onnx libs, drop whisper.cpp build` (Taskfile, .gitignore,
   fetch-whisper.sh deletion, verify-packaging S10/S13, pending patch deletion, notices file).
3. `fix(workbench): dictation size and RAM copy`.
4. `docs: P218 speech engine` (NOTICES, ARCHITECTURE, DEV_ENVIRONMENT, PACKAGING, SPEC result).

Resume: each commit is self-contained; on restart, `git log` shows which landed.

## Deferred verifications and decisions

- Real-voice accuracy with the user's own recording (cannot be obtained here). F4 is synthetic.
- Everything macOS: dylib load from `Contents/Frameworks`, rpath, `lipo -info`, `codesign --verify
  --deep --strict`, ORT CPU speed on Apple Silicon (whisper.cpp had Metal; sherpa's `coreml` provider
  is not evaluated), mic prompt, worker footprint in Activity Monitor.
- Shape A accepts that a broken Frameworks dylib stops the app launching. The user may prefer shape
  B regardless of the M-link numbers.
- One ORT for embed and stt (unify on a single version, gain x86_64 embeddings) is a separate phase if
  wanted.
- If no candidate passes: the user picks between relaxing a gate, a larger RAM ceiling, or a
  different approach. whisper.cpp is not offered.
