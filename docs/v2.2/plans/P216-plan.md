# P216 plan: memory speech to text

Base: `dadcc59b8` (v2.0). Machine: Linux x86_64, 4 vCPU Xeon 2.1 GHz (AVX2, AVX-512), 16 GB, no GPU.
Measurements below ran in this sandbox; macOS figures are not measured.

Ask (SPEC row and user): English-only Whisper small.en q5_1 (whisper.cpp ggml), subprocess worker
started on demand and stopped when idle like `memory-embed`, mic dictation in the Memory module with
live text in the input, user sends manually, model download on click with pinned SHA-256.

Surfaces: Add memory dialog free-text box (`AddMemoryDialog.vue`) and the Memory search box
(`MemoryPanel.vue`, an `InputGroup` that already takes an inline-end addon, so it fits). Challenge
answer boxes: not in scope (D2).

## Facts this plan rests on (checked)

- Kira Space ships macOS only: `release.yml` packages on `macos-15`, `build:universal` lipos arm64 and
  amd64. Linux is dev and CI only (`-tags server` builds, mocked-bridge Playwright). No Windows build,
  so WebView2 needs nothing.
- `codesign:adhoc` signs with `--sign -` and no `--options runtime`: no hardened runtime, no sandbox.
  Mic access then needs `NSMicrophoneUsageDescription` in `Info.plist` and `Info.dev.plist`; no
  entitlement (`com.apple.security.device.audio-input` matters only with hardened runtime or sandbox).
- Embed worker pattern (`internal/memory/embed`): `runArgvShim` in `apps/kira-space/main.go` runs
  `memory-embed` before Wails; `Client` spawns `os.Executable() memory-embed --model-dir`, NDJSON
  on stdin/stdout, hello line, 30 s hello timeout, one request in flight, 5 min idle stop by closing
  stdin, 60 s spawn backoff, kill on ctx cancel, stderr tail in errors. `Install` downloads via
  `go-huggingface` `hub` with byte progress, verifies size and SHA-256, writes `installed.json` last.
  Model dir `$KIRA_MEMORY_HOME/models/<id>/`. No Settings toggle: the download click is the opt-in
  (`SemanticStatus.vue`). Bridge: `MemoryService.InstallSemanticModel` (cancellable bound call),
  payload-less `kira:memory:semantic` event, UI refetches status through TanStack Query.
- Wails v3 beta.21 named streams: `app.HandleStream(name, func(*application.StreamConn))`, binary or
  JSON frames both ways, `StreamConn.Context()` cancelled on close. Kira Space uses it for `git`
  (`appshell/stream.go`, `bridge/gitstream.go`, TS `Stream('git')`). Playwright mocks streams through
  `window._wails.streamFactory` (`tests/ui/support/gitStreamMock.ts`).
- Wails has no WKWebView media-capture delegate (`grep requestMediaCapturePermission` over the
  module: nothing). WebKitGTK allows `getUserMedia` by default (`permissions_linux.go`).

## Real checks run for this plan

| Check | Result |
|---|---|
| HF `ggerganov/whisper.cpp` rev `5359861c739e955e79d9a303bcbc70fb988958b1`, `ggml-small.en-q5_1.bin` | 190098681 bytes, SHA-256 `bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30` (LFS oid from `paths-info`, then downloaded and `sha256sum` matched). Licence MIT |
| HF `ggml-org/whisper-vad` rev `9ffd54a1e1ee413ddf265af9913beaf518d1639b`, `ggml-silero-v6.2.0.bin` | 885098 bytes, SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` (downloaded, matched). MIT |
| whisper.cpp latest tag | `v1.9.5`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`, MIT. Release tarball blocked by this sandbox's proxy (GitHub API and codeload refused); git clone works |
| Static build (`BUILD_SHARED_LIBS=OFF GGML_OPENMP=OFF`, examples off), 4 cores | 41 s cold. `libwhisper.a` 0.9 MB, `libggml-cpu.a` 1.7 MB, `libggml-base.a` 1.4 MB. `whisper-cli` complete static binary 3.25 MB |
| Own cgo glue against `whisper.h` + static libs | builds in 6 s; `whisper_init_from_file_with_params` (use_gpu off), streaming `whisper_vad_detect_speech_no_reset`, `whisper_full` with prompt all work |
| `jfk.wav` (11 s), whisper defaults (beam 5) | peak RSS 474 MB, 6.0 s |
| greedy | 353 MB, 4.9 s (encode 4.0 s: full 30 s window) |
| greedy, flash attn, `audio_ctx 640` | 321 to 331 MB, 2.4 to 2.7 s, text correct |
| same plus Silero VAD loaded, 5 passes | peak 337 MB, 2.2 to 2.4 s per pass |
| `audio_ctx` changed per pass | 444 MB (buffers reallocate), no faster: use a fixed value |
| partials on growing buffer | 2.8 s: "And so my fellow Americans"; 5.5 s: "... ask not why"; 11 s: correct. Partial tails are wrong: needs agreement before showing as stable |
| Silero streaming chunks | 1600-sample chunks: 35 of 440 frames speech (zero-padded windows). 1536-sample (3 x 512) chunks: 230 of 342. Feed multiples of 512 |
| `gen2brain/malgo` v0.11.26 (miniaudio, Unlicense / public domain) | builds from source by cgo in 10 s cold, no external lib; enumerates capture devices here |
| `k2-fsa/sherpa-onnx-go-macos` v1.13.8 | `#cgo LDFLAGS: -lsherpa-onnx-c-api -lonnxruntime -Wl,-rpath,...`: dynamic link of its own ORT dylibs (68 MB) |

Apple Silicon speed is unmeasured. whisper.cpp's Metal backend is the documented fast path there;
expect a pass well under 1 s, to be checked by a human (Known open items).

## 1. Inference binding

Chosen: whisper.cpp v1.9.5 C library, statically linked, called through a small cgo file of our own
in the worker package, behind build tag `whisper`.

- sherpa-onnx (Apache-2.0): declined. It cannot load the decided ggml file (ONNX whisper exports
  only), and its Go packages link prebuilt `libsherpa-onnx-c-api` plus its own `libonnxruntime`
  at process load. That would make the whole Kira Space binary depend on a second ORT dylib next to
  the pinned 1.29.1 one P210 `dlopen`s.
- Official Go bindings (`github.com/ggerganov/whisper.cpp/bindings/go`, MIT, pseudo-version
  `v0.0.0-20261006141035-d1be6fde11ac`): declined. `Whisper_init` hard-codes
  `whisper_context_default_params()` (no `use_gpu` per arch), no `whisper_vad_*` streaming API,
  no `suppress_nst`, and fixed `#cgo darwin LDFLAGS`. Using it would still need our own cgo for VAD
  plus an `unsafe` cast between two packages' C types. Our glue is a thin call layer over the
  library's public C API, about 150 lines; the C compiler checks every field name against the pinned
  header, unlike a purego ABI mirror.
- purego `dlopen` of a shared libwhisper: declined. `whisper_full_params` is a large by-value struct
  with callbacks; mirroring its layout in Go is brittle hand-rolling.
- `whisper-cli`/`whisper-server` as a separate binary: declined. Breaks the re-exec pattern, needs a
  second signed universal binary, and has no streaming session protocol.
- Licences: whisper.cpp MIT, both model files MIT, malgo/miniaudio public domain. All fully open.

Build impact:

- `scripts/fetch-whisper.sh <darwin-arm64|darwin-amd64|linux-x64>`: `git clone --depth 1 --branch
  v1.9.5` into gitignored `apps/kira-space/build/whisper/src`, refuse unless `git rev-parse HEAD` is
  the pinned `d1be6fde11ac6e0407606b4e42fe72d34add8037`, then CMake static build into
  `apps/kira-space/build/whisper/<platform>/` with a stamp (idempotent). Flags: `BUILD_SHARED_LIBS=OFF
  GGML_OPENMP=OFF WHISPER_BUILD_EXAMPLES=OFF WHISPER_BUILD_TESTS=OFF WHISPER_BUILD_SERVER=OFF
  CMAKE_BUILD_TYPE=Release`. darwin: `CMAKE_OSX_DEPLOYMENT_TARGET=14.0`, `GGML_METAL=ON
  GGML_METAL_EMBED_LIBRARY=ON GGML_BLAS=ON` (Accelerate), `GGML_NATIVE=OFF`; amd64 adds `GGML_AVX2=ON
  GGML_FMA=ON GGML_F16C=ON` (macOS 14 Intel Macs all have AVX2). Metal is built for amd64 too so link
  flags stay one set; the worker sets `use_gpu` only on darwin/arm64. linux-x64 (dev only):
  `GGML_NATIVE=ON`, no Metal. Prints `CGO_CFLAGS`/`CGO_LDFLAGS` lines to export. Lives in `scripts/`
  (S10 allows downloads there only). Default pin is the commit SHA, since the tarball hash could not
  be fetched here (open item O1).
- cgo directives in the tagged file: `-lwhisper -lggml -lggml-base -lggml-cpu -lm -lstdc++`; darwin
  adds `-lggml-metal -lggml-blas -framework Accelerate -framework Metal -framework Foundation`
  (add `-framework MetalKit` only if the link asks for it). Include and lib dirs come from env set by
  the Taskfile, never hard-coded paths.
- Taskfile (`apps/kira-space/build/darwin/Taskfile.yml`): `fetch:whisper` per arch, a dependency of
  `build` when packaging (same place as `fetch:onnxruntime`); `build` passes `EXTRA_TAGS` `whisper`
  and appends the per-arch `-I`/`-L` to `CGO_CFLAGS`/`CGO_LDFLAGS`. `build:universal` builds each arch
  against its own libs, then lipo as today. Release needs no workflow edit: `macos-15` has git and
  cmake, and the release job already runs the package task.
- Untagged builds (`go build ./...`, `go test ./...`, `lint:go`, CI, pre-push) compile a stub decoder:
  speech status `off`, mic button hidden. They never need the C library. `CGO_ENABLED=0` builds a
  stub capture too.
- Binary size: about 3 MB native code on Linux (whisper-cli total 3.25 MB); macOS adds the embedded
  Metal library (unmeasured). malgo about 1 MB.
- Re-exec carries over: `runArgvShim` gains `memory-stt`, `stt.RunWorker(args)`. Same executable, so
  nothing new to sign. `verify-packaging.sh` gains S13: `fetch-whisper.sh` pins the same commit and
  model SHA-256s as `internal/memory/stt/spec.go`, the darwin `build` task passes tag `whisper`, and
  both plists carry `NSMicrophoneUsageDescription`.
- Tagged code is not in default lint. The implementer runs `golangci-lint run --build-tags whisper
  ./internal/memory/stt/...` after `fetch-whisper.sh linux-x64` and fixes everything. CI coverage:
  write `docs/pending-changes/.github__workflows__pr.yml.patch` adding, to `checks`, `sh
  scripts/fetch-whisper.sh darwin-arm64` plus `go build -tags whisper ./apps/kira-space/...` with the
  printed env (`.github/workflows/` cannot be pushed from here; DEV_ENVIRONMENT.md workaround).

## 2. Live text

Whisper is not streaming. Design: VAD-gated chunks, repeated decodes of a bounded window, agreement
before text is shown as stable, finals at pauses.

Worker state per session: `buf` (uncommitted audio, 16 kHz float32), VAD probabilities per 32 ms
frame aligned to `buf`, `committed` (final text, immutable), last hypothesis words.

- VAD: Silero v6.2.0 through `whisper_vad_detect_speech_no_reset`, fed in multiples of 512 samples
  (remainder carried); `whisper_vad_reset_state` after each final. Speech when prob ≥ 0.5.
- Partial pass: when `buf` holds ≥ 300 ms speech and ≥ 400 ms new audio since the last pass, decode
  all of `buf`. Passes run back to back, never queued: each starts on the latest audio, so the update
  rate adapts to the machine (2.2 s here, Apple Silicon faster). Params: greedy, temperature 0, no
  fallback (`temperature_inc 0`), `audio_ctx 640` fixed (12.8 s), flash attention (default),
  `no_context`, `suppress_nst`, `language en`, `token_timestamps`, `n_threads min(4, NumCPU)`.
- Stable prefix (LocalAgreement-2): stable words = longest common prefix, by normalised word
  (lowercase, edge punctuation stripped), of the previous and current hypothesis. Stable count never
  shrinks within a segment. Displayed text = committed + stable + rest of current hypothesis.
- Final at a pause: VAD silence ≥ 600 ms after speech. Decode `buf` up to speech end + 200 ms with
  temperature fallback on (`temperature_inc 0.2`, default thresholds), append via merge, drop that
  audio.
- Window cap (12 s with no pause): cut at the longest VAD silence ≥ 150 ms in the last 6 s; else at
  the end time (`t1`) of the last stable word; else hard cut at 10 s. Final-decode `buf[:cut]`,
  merge, keep `buf[cut:]`.
- Stop: final-decode whatever remains, reply `final`.
- Merge into committed: drop a leading run of up to 3 words equal (normalised) to committed's tail
  (boundary repeats); join with one space; lowercase the first word when committed does not end in
  `.?!` and the word is not all-caps, not `I`, not a glossary term. Drop a decode whose buffer had
  < 200 ms speech (VAD) to stop silence hallucinations.
- Tradeoff: fixed `audio_ctx 640` cuts encode cost about 2x versus the 30 s window (4.0 s to 1.9 s
  here) with identical jfk text; full window and beam 5 add RAM (353 and 474 MB) for little gain on
  short dictation. Partial tails may flicker until agreement; finals at pauses equal offline quality
  for that chunk with prompt context. Latency to stable text is two passes.
- Prompt: `Glossary: <terms>.` plus the last 200 chars of committed text. Terms: the 40 most frequent
  `keywords` over `Recent(ctx, 100)` current memories, read once per session in the host (one SQL
  query). Cheap and local. Risk is prompt words hallucinated on silence; VAD gating and the 200 ms
  speech floor cover it. On by default (D6).

## 3. Audio capture

Chosen: Go-side capture in the host process with `gen2brain/malgo` (miniaudio), default input device,
16 kHz mono float32 requested from miniaudio (its own resampler), period 1536 frames.

- Webview `getUserMedia` declined: on WKWebView Wails implements no media-capture permission delegate,
  so WebKit's own per-load prompt applies on top of TCC, and whether the `wails://` custom scheme
  counts as a secure context for `navigator.mediaDevices` is unverifiable without a Mac. It also
  needs an AudioWorklet resampler and audio frames over the bridge. Go-side has one permission surface
  (TCC prompt naming Kira Space, triggered by the first input start), no secure-context question,
  and audio never crosses into JS.
- Host, not worker: capture starts on click while the worker spawns and loads (0.3 s here, more on a
  cold disk). Host buffers up to 30 s before the worker's hello.
- TCC denied yields all-zero buffers on macOS, not an error: 1 s of exact zeros ends the session with
  "No audio from the microphone. Allow Kira Space in System Settings > Privacy & Security >
  Microphone." Device init failure surfaces miniaudio's error.
- Host to worker: NDJSON like `memory-embed`. `audio` frames carry base64 s16le 100 ms chunks
  (about 4.3 KB each, 10/s): negligible, debuggable.
- Host to UI: Wails stream `dictation` (the repo's existing binary/JSON stream mechanism). Opening
  it starts a session; client text frame `{"type":"stop"}` finalises; closing it cancels (page reload
  and window close included, via `StreamConn.Context()`). Server frames:
  `{"type":"state","state":"starting|listening|finishing","level":0..1}` (≤ 10/s, RMS for the mic
  pulse), `{"type":"text","text":"...","committed":<len>}` (whole session text, so the UI only replaces
  one region), `{"type":"final","text":"..."}`, `{"type":"error","code":"busy|notInstalled|mic|worker","message":"..."}`.
- Status and install stay bound calls plus a payload-less `kira:memory:dictation` event, the semantic
  pattern.

## 4. Worker lifecycle

- `stt.Client` (host): lazily spawns `<exe> memory-stt --model-dir <dir>`; hello `{ready, model}`;
  one session at a time process-wide (second open gets `busy`); idle timer 5 min
  (`DefaultIdleTimeout`) armed when a session ends, stopped when one starts; stop by closing stdin,
  kill after 2 s; 60 s spawn backoff with `Reset`; `Close` on app quit.
- Cancel: host stops capture, sends `cancel`; worker abandons the session after the in-flight pass
  (≤ one pass) and stays for reuse.
- Stop: host stops capture, sends `stop`; waits up to 30 s for `final`, else kills the worker and
  returns committed text with an error frame.
- Crash: worker EOF mid-session gives an error frame with the stderr tail; text already in the input
  stays; status `unavailable` with Retry until `Reset` or backoff expiry.
- RAM: measured 337 MB peak (model, VAD, 5 passes, CPU). Ceiling 400 MB, asserted by the smoke test
  on Linux (`VmHWM`). With the embed worker also alive (search while dictating) about 480 MB total.
- Session caps: 10 min, 30 s continuous silence auto-stop (D5), input `maxlength` reached auto-stop.

## 5. Model download

- `stt.Default` spec: id `whisper-small.en-q5_1-5359861`; files above (URLs pinned to the two HF
  revisions, sizes and SHA-256 as measured). Total 190983779 bytes (182 MiB). Stored in
  `$KIRA_MEMORY_HOME/models/<id>/`, same convention as the embedding model.
- Shared code: extract the embed installer into leaf package `internal/memory/modelstore`
  (`File`, `Install`, `Installed`, manifest, `ModelDir`, `ErrChecksum`; error prefix `model:`).
  `embed` and `stt` both call it. Extract `internal/memory/workerproc` (start with stdin/stdout
  pipes, hello decode under timeout, stop with grace, kill, done channel, stderr tail diagnostics)
  and move `embed.Client` onto it; idle and backoff policy stay in each client. Existing
  `embed/client_test.go` must pass unchanged in behaviour.
- Bridge `DictationService` (`apps/kira-space/internal/bridge/dictation.go`): `Status` (state
  `off|notInstalled|downloading|unavailable|ready`, message, done/total bytes while downloading),
  `InstallModel(ctx)` cancellable (one at a time, progress via coalesced event), `Retry`.
  Retry after a failed download is the same button. A checksum failure deletes the part file
  (existing `Install` behaviour). No Settings toggle (the embedding model has none either).
- MCP never downloads or dictates.

## 6. Frontend

- `packages/shared/domain/dictation.ts`: zod schemas for status and stream frames.
- `MemoryControl` gains `dictationStatus`, `dictationInstall(signal)`, `dictationRetry`,
  `onDictation`, `dictationOpen(handlers): { stop(): void; cancel(): void }`. Space implementation in
  `apps/kira-space/frontend/src/bridge/memoryControl.ts` over the bindings and `Stream('dictation')`,
  frames parsed by zod.
- TanStack Query: `useDictationStatus`, `useInstallDictationModel`, `useRetryDictation` in
  `memory/queries.ts` (server state, event-invalidated like semantic).
- Pinia `useDictationStore` (`memory/dictation/store.ts`, one concern): active target id, phase
  (`idle|starting|listening|finishing|error`), level, error. Other mic buttons disable while one runs.
- `MicButton.vue` (`memory/dictation/`), `<script setup lang="ts">`, Tailwind only, shadcn `Button`
  through `TooltipIconButton`, `Popover` for download/progress/error, `Progress`, codicons
  `mic`/`mic-filled`. Props: target id, `v-model` text, input element ref, `maxlength`.
  States: hidden (`off`), download prompt ("Dictation runs a local speech model: 182 MB download,
  about 340 MB RAM while in use"), downloading with Cancel, ready, starting, listening (pulsing by
  level), finishing (spinner), error with Retry.
- Insertion (`useDictationInsert`): snapshot text before and after the caret at start; each `text`
  frame sets value = before + separator + text + after, clamped to `maxlength`; caret after the
  inserted text on `final`. Input read-only while recording (D3). Never submits: the Add button and
  Enter stay the user's. Escape or dialog close cancels; committed text stays.
- Accessibility: `aria-label` "Start dictation"/"Stop dictation", `aria-pressed`, a `role="status"`
  line ("Listening", "Finishing", the error) under the input, focus stays in the input.
- Wiring: `AddMemoryDialog.vue` under the textarea next to the counter; `MemoryPanel.vue` search
  `InputGroupAddon align="inline-end"` before the clear button. Live text in search drives the
  existing 200 ms debounced query.
- VueUse: `useEventListener` for Escape, `tryOnScopeDispose` to cancel on unmount.
- Playwright (`apps/kira-space/tests/ui/memory-dictation.spec.ts`, mocked bridge, stream mock on
  `window._wails.streamFactory` like `gitStreamMock.ts`, no mic or model): status `off` hides the
  button; download prompt, progress, cancel, checksum error with Retry; listening then text frames
  update the textarea live and Add stays disabled until text exists and is never auto-clicked;
  insertion at caret between existing text; stop sends the stop frame and final text stays; busy and
  mic errors show in the status line; search box gets live text and the result list refetches.

## 7. Streams

One sequential implementer. No independent split: the frontend control imports Wails bindings
generated from the new Go service (pre-commit typecheck would fail a frontend-only worktree), and the
`modelstore`/`workerproc` extraction must land before `stt` uses it.

## 8. Unit tests

Only `internal/memory/stt/transcript` (pure Go, untagged): agreement prefix with case and punctuation
drift, stable count never shrinking, boundary repeat removal, join spacing and casing rule, empty and
hallucination-only hypotheses. Nothing else new. Existing `embed` tests stay green after the
extraction. Smoke test behind `//go:build whisper && sttsmoke` (not a unit test): real `Install` into
a temp dir, real worker on `build/whisper/src/samples/jfk.wav` streamed in 100 ms frames, final
contains "ask not what your country can do for you", `VmHWM` < 400 MB, worker gone after a 2 s test
idle timeout.

## Commits (in order)

1. `refactor(memory): shared model store and worker process` (extraction, embed moved onto it).
2. `build(space): pinned whisper.cpp static build` (script, Taskfile, gitignore, S13, plists).
3. `feat(memory): speech worker and transcript merge` (spec, cgo decoder + stub, worker loop,
   transcript tests, `memory-stt` shim).
4. `feat(memory): microphone capture and dictation sessions` (malgo, host client).
5. `feat(space): dictation bridge and stream`.
6. `feat(workbench): dictation mic button in memory inputs`.
7. `test(space): dictation UI specs`.
8. `test(memory): speech smoke` and `docs: P216 speech to text` (ARCHITECTURE memory section, Stack
   table, Known open items; DEV_ENVIRONMENT setup and smoke; PACKAGING whisper section; pending
   workflow patch; SPEC result).

## Verification for the orchestrator

- `rg -n '"memory-stt"' apps/kira-space/main.go`; `rg -n 'whisper_init_from_file_with_params|whisper_vad_detect_speech_no_reset|whisper_full\(' internal/memory/stt`.
- `rg -n 'malgo\.' internal/memory/stt` (real capture caller).
- `rg -n 'modelstore\.Install' internal/memory apps/kira-space/internal/bridge` shows embed and stt paths.
- `rg -n 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30|2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987|d1be6fde11ac6e0407606b4e42fe72d34add8037'` hits spec and script.
- `rg -n NSMicrophoneUsageDescription apps/kira-space/build/darwin` shows both plists.
- `rg -n 'MicButton' packages/workbench/src/memory/AddMemoryDialog.vue packages/workbench/src/memory/MemoryPanel.vue`; no `<style` and only `<script setup lang="ts">` in new `.vue` files.
- `go build ./...`, `go test -race ./internal/memory/... ./apps/kira-space/internal/bridge/`,
  `CGO_ENABLED=0 go build ./internal/memory/...`, `bun run lint`, `typecheck`, `lint:go`, `lint:dead`.
- Tagged: `sh scripts/fetch-whisper.sh linux-x64`, then `go build -tags server,whisper ./apps/kira-space`,
  `golangci-lint run --build-tags whisper ./internal/memory/stt/...`,
  `go test -tags whisper,sttsmoke ./internal/memory/stt/ -run Smoke -v` (passes, RSS printed).
- `bun run test:ui:space -- memory-dictation memory-module` pass.
- `bash scripts/verify-packaging.sh` S13 passes.

## Not verifiable here (human, macOS)

Real mic capture and TCC prompt, Metal speed and footprint (Activity Monitor), darwin cgo static link
and universal lipo, `codesign --verify --deep --strict`, technical dictation accuracy for a
non-native speaker, device switching (Bluetooth headset). Recorded in Known open items.

## Open items

- O1: whisper.cpp source is pinned by commit SHA because the release tarball could not be fetched
  here. The implementer may add the `v1.9.5` tarball SHA-256 if their environment reaches it; never
  invent one.

## Deferred decisions (default in force)

- D1 capture: Go-side malgo (alternative: webview getUserMedia).
- D2 surfaces: free-text box and search box; challenge answer boxes not.
- D3 typing while recording: input read-only during a session.
- D4 finals: greedy with temperature fallback; beam 5 declined for +120 MB.
- D5 auto-stop: 30 s silence, 10 min cap.
- D6 glossary prompt from memory keywords: on, no toggle.
- D7 no Settings toggle and no delete-model UI.
- D8 input device: system default, no picker.
- D9 no spoken punctuation commands ("comma", "new line").
