# P210 plan: memory embedding search

Base: `origin/v2.0` at `8e7bd7dab`. Stream A (P210, then P211 on same subsystem).

Discovery: `codegraph_explore` over `internal/memory` (`Store`, `Service`, `BuildMatch`, `prepare`,
`reconcile`), `internal/memory/mcpserver`, `memorycli`, `internal/sqlitex` migrations,
`apps/kira-space/internal/bridge/memory.go`, `apps/kira-space/main.go` (`runArgvShim`),
`packages/workbench/src/memory/*`, `apps/kira-space/frontend/src/bridge/memoryControl.ts`,
`packages/shared/domain/memory.ts`. Read `docs/ARCHITECTURE.md` "Memory MCP server and module",
Stack table, Known open items; `docs/DEV_ENVIRONMENT.md` (Memory MCP, server-tag recipe, shadcn-vue,
cgo/cross-compile notes); `docs/PACKAGING.md` §7 S10, §8; `apps/kira-space/build/darwin/Taskfile.yml`.

## 1. Ask, mapped

| User's words (SPEC row + requirement) | Where it lands |
|---|---|
| search over embeddings too | hybrid search in `Service.Search` (§6), MCP + module unchanged entry points |
| SQLite | `memory_embeddings` table in `memory.db`, float32 BLOB, brute-force cosine in Go (§5) |
| local model | Snowflake arctic-embed-s int8 ONNX, run by ONNX Runtime in a local worker process (§3, §4) |
| best under 500 MB RAM, less if possible | measured ~95 MB loaded, ~137 MB peak (§2) |
| recall-first, more results over fewer (existing contract) | RRF over the union of FTS and vector lists, no score cutoff (§6) |

## 2. Research and measurements

Probe: `go build` throwaway programs in scratchpad, Linux x86_64, 4 cores, ORT CPU EP, 2 intra-op
threads, arena off. RSS from `/proc/self/status` (VmRSS at load, VmHWM peak). "long" = ~250 tokens.
macOS arm64 not measured here (no Mac): §12 lists the Mac check.

### 2.1 Runtimes

| Option | Result | Verdict |
|---|---|---|
| `knights-analytics/hugot` v0.8.2 Go backend (pure Go, GoMLX `simplego`) | bge-small: 458 MB after load, 1.05 GB peak (batch 32), 1.2 GB HWM; 200 ms short, 2.5 s long | declined: fails RAM bar, 40x slower than ORT |
| hugot ORT backend (`-tags ORT`) | bge-small fp32 230/250 MB, 10 ms short, 60 ms long; binary 25.8 MB (GoMLX always linked) | works; declined for footprint: drags GoMLX, go-xla, ortgenai into `go.mod` for one pipeline we use |
| `yalue/onnxruntime_go` v1.36.0 + `gomlx/go-huggingface` v0.4.13 `tokenizers/hftokenizer` | arctic-s int8 95/137 MB, 4 ms short, 30-40 ms long; binary 5.2 MB vs 1.4 MB hello (+3.8 MB) | **chosen** |
| llama.cpp bindings (GGUF) | cgo + per-platform static lib build; Go bindings unmaintained or purego-loaded libllama | declined: second native toolchain for no quality gain at this size |
| `microsoft/onnxruntime/go` (official) | only pseudo-versions, no tags | declined: yalue is tagged, stable, same cgo+dlopen shape |

Both ORT paths are cgo with `dlopen` of `libonnxruntime` at runtime. Tokenizer is pure Go in both.
ORT pin: **1.29.1** (yalue v1.36.0 ships ORT C API 29 headers). Probe ran 1.29.1 linux-x64 and 1.30.0
with identical numbers.

### 2.2 Models (licence from HF API `cardData.license`; BEIR nDCG@10 from mdbr-leaf-ir model card table)

| Model | Licence | Params | Lang | BEIR | ONNX file | RSS load/peak | short/long |
|---|---|---|---|---|---|---|---|
| **snowflake-arctic-embed-s int8** | Apache-2.0 | 33M | en | 51.98 | `onnx/model_int8.onnx` 34 MB | **95 / 137 MB** | 4 / 35 ms |
| arctic-embed-s fp32 | Apache-2.0 | 33M | en | 51.98 | 133 MB | 227 / 259 MB | 9 / 64 ms |
| bge-small-en-v1.5 fp32 | MIT | 33M | en | 51.65 | 133 MB (no int8 published) | 230 / 250 MB | 10 / 60 ms |
| all-MiniLM-L6-v2 fp32 | Apache-2.0 | 23M | en | 41.95 | 90 MB | 184 / 189 MB | 3 / 36 ms |
| nomic-embed-text-v1.5 int8 | Apache-2.0 | 137M | en | ~53 | 137 MB | 255 / 334 MB | 18 / 90 ms |
| multilingual-e5-small int8 | MIT | 118M | multi | below e5-small-v2's 49.04 on en | 118 MB | 323 / 362 MB | 5 / 65 ms |
| multilingual-e5-small fp32 | MIT | 118M | multi | same | 470 MB | 688 / 886 MB | over budget |
| snowflake-arctic-embed-m-v2.0 int8 | Apache-2.0 | 305M | multi | ~55 (card) | 311 MB | 549 / 592 MB | over budget |
| mdbr-leaf-ir | Apache-2.0 | 23M | en | 53.55 | external-data ONNX, needs `2_Dense` 384->768 projection outside graph | n/a | declined: projection layer in safetensors outside ONNX; +1.6 BEIR not worth custom graph glue |
| granite-embedding-small-english-r2 | Apache-2.0 | 47M | en | 50.87 | no ONNX published | n/a | declined |
| EmbeddingGemma-300M | Gemma Terms of Use | 300M | multi | | | | declined: not open-source licence |
| Qwen3-Embedding-0.6B | Apache-2.0 | 600M | multi | | GGUF/safetensors only | ~1 GB+ fp32, ~640 MB Q8 | declined: over budget, decoder, needs llama.cpp |
| jina-embeddings-v3 | CC-BY-NC-4.0 | | | | | | declined: non-commercial |

Decision: **arctic-embed-s int8**. Highest BEIR among models under 150 MB RSS; Apache-2.0; official
int8 file; CLS pooling, 384 dims, query prefix `Represent this sentence for searching relevant
passages: `, documents unprefixed. Pinned revision `e596f507467533e48a2e17c007f0e1dacc837b33`.

Quality probe (10 facts, 10 paraphrased queries with no shared words, prefixed): top-1 correct
9/10 (miss: "communication preferences"). FTS finds 0/10 of those queries. Cosine range is
compressed (related 0.52-0.76, unrelated 0.39-0.58), so an absolute search floor is unreliable;
ranks only. Doc-to-doc: paraphrases 0.89-0.94, max unrelated pair 0.82.

Multilingual: FTS already uses an English `porter` stemmer and the gate writes English keywords.
English-only model keeps the system consistent. A multilingual model under 500 MB exists
(multilingual-e5-small int8, 362 MB peak) but scores lower on English retrieval. Deferred decision D1.

### 2.3 Vector storage

- `sqlite-vec`: C extension. `modernc.org/sqlite` (this repo's driver everywhere, pure Go,
  transpiled) cannot load native extensions; switching to a cgo or WASM driver for one table is out of
  scope. sqlite-vec's `vec0` KNN is itself brute force at this scale. Declined.
- Chosen: float32 little-endian BLOB per memory version, L2-normalised at write, dot product in Go.
- Size: 384 x 4 = 1,536 B per row. 1k memories 1.5 MB, 10k 15 MB, 50k 77 MB.
- Realistic count: P201 store is one user's facts (hundreds); P211 bulk import may add thousands.
  Plan for 10k. Per search: one SQL scan of 15 MB from page cache plus 3.8 M multiply-adds, estimate
  20-40 ms. No in-process vector cache: 50k+ is where to revisit (int8 vectors or cache); not an open
  item now.

### 2.4 Licences (fully open-source check, package and feature level)

| Component | Licence | Used feature |
|---|---|---|
| arctic-embed-s weights | Apache-2.0 | int8 ONNX file |
| ONNX Runtime 1.29.1 (`onnxruntime-osx-arm64-1.29.1.tgz`, GitHub release) | MIT, ThirdPartyNotices shipped with it | CPU EP only |
| `github.com/yalue/onnxruntime_go` v1.36.0 | MIT | `DynamicAdvancedSession`, tensors |
| `github.com/gomlx/go-huggingface` v0.4.13 | Apache-2.0 | `tokenizers/hftokenizer`, `hub` download manager |
| linked transitive: `pkg/errors` BSD-2, `gofrs/flock` BSD-3, `google/uuid` BSD-3, `gomlx/compute/support/humanize` Apache-2.0, `x/text` BSD-3 | | |

No paid tier, no non-commercial clause.

## 3. Decisions

- **D-runtime.** ORT through `yalue/onnxruntime_go`, hftokenizer for WordPiece. Requirement named for
  declining hugot: RAM (pure-Go backend) and dependency weight (ORT backend). No hand-rolled
  inference or tokenizer: glue only (tensor build, CLS slice, normalise).
- **D-process.** Inference runs in a **worker subprocess**, `<Kira Space executable> memory-embed`,
  spawned lazily by whichever process needs vectors (Kira Space app, each `memory-mcp`).
  Requirements: (1) true unload: probe shows in-process `Session.Destroy` + `DestroyEnvironment`
  leaves RSS at 131-137 MB on Linux (allocator keeps pages); process exit returns all of it.
  (2) Crash isolation: a native abort inside ORT must not kill Kira Space windows/terminals or the
  MCP server mid-session. (3) cgo stays confined to one code path. Cost: ~300 ms spawn+load on
  first use after idle.
- **D-idle.** Worker exits after **5 min** idle (client closes its stdin). Constant `idleTimeout`.
- **D-ort-ship.** ORT dylib is **bundled** in `Kira Space.app/Contents/Frameworks/`, signed by the
  existing deep ad-hoc codesign. Native code is never downloaded at runtime. Cost: +43 MB in the
  bundle (dylib as shipped in the tgz).
- **D-model-ship.** Model files are **downloaded on an explicit click** in the Memory module
  (34 MB + 0.7 MB tokenizer), SHA-256 pinned, to `$KIRA_MEMORY_HOME/models/<model id>/`. Shared by
  app and MCP processes. Deferred decision D2 offers bundling instead.
- **D-platform.** Kira Space ships macOS arm64 only (PACKAGING §8). ORT 1.29.1 publishes no
  osx-x86_64/universal2 build, so the x86_64 slice of `darwin:package:universal` gets status
  `unavailable` ("no embedding runtime for this architecture"); FTS keeps working. Linux: dev/test
  via `KIRA_ORT_LIB`. Windows: code is portable (yalue has `LoadLibrary`), no packaging exists; not in
  scope. `CGO_ENABLED=0` builds compile a stub worker: status `unavailable`.
- **D-what-to-embed.** The `fact` text only. Reason and keywords stay FTS-weighted (bm25 2/4).
  Facts are atomic and ≤1000 chars (< 512 tokens).
- **D-fusion.** Reciprocal rank fusion, `k = 60`, over the **union** of FTS top-N and vector top-N
  (N = clamped limit). No score floor on the search vector list (existing "no score cutoff" rule;
  measured scores compressed anyway). Result truncated to the limit.
- **D-reconcile.** Reconcile candidates become FTS top 10 ∪ vector top 5 with doc-to-doc cosine
  ≥ **0.85** (measured: paraphrase 0.89-0.94, unrelated ≤ 0.82). Without a floor, every store would
  have candidates and always pay the Sonnet reconcile call. Deferred decision D3 (cost).
- **D-no-revision.** Embedding writes do not bump `memory_revision`: they do not change memory
  content, so reconcile's optimistic check is unaffected.
- **D-fallback.** Embedder missing, not installed, crashed, or timed out: search returns FTS
  results unchanged, state is visible (UI status row, MCP output note). Store never fails for lack
  of a vector; backfill fills it later.

## 4. Embedding package `internal/memory/embed` (new, leaf package; imports no `memory`)

Files:

- `spec.go`: `type File struct{ Name, URL, SHA256 string; Size int64 }`, `type Spec struct{ ID string; Dim int;
  QueryPrefix string; MaxTokens int; Files []File; DocFloor float32 }`. `var Default = Spec{ID:
  "arctic-embed-s-int8-e596f50", Dim: 384, MaxTokens: 512, DocFloor: 0.85, ...}`. Files:
  - `model.onnx` from `https://huggingface.co/Snowflake/snowflake-arctic-embed-s/resolve/e596f507467533e48a2e17c007f0e1dacc837b33/onnx/model_int8.onnx`,
    size 34015111, sha256 `f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14`.
  - `tokenizer.json` from `.../resolve/e596f50.../tokenizer.json`, size 711649, sha256
    `91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854`.
    Implementer re-verifies both hashes against the pinned-revision URL before committing.
- `vector.go`: `Encode([]float32) []byte`, `Decode([]byte, dim int) ([]float32, error)`,
  `Dot(a, b []float32) float32`. LE float32.
- `paths.go`: `ModelDir(home string, s Spec) string` (`<home>/models/<id>`);
  `RuntimeLib() (string, error)`: `KIRA_ORT_LIB` env, else darwin
  `<dir of os.Executable, symlinks resolved>/../Frameworks/libonnxruntime.1.29.1.dylib`, else
  `ErrNoRuntime`.
- `install.go`: `Installed(dir string, s Spec) bool` (manifest `installed.json` present, names and sizes
  match; no rehash). `Install(ctx, dir string, s Spec, progress func(done, total int64)) error`:
  per file `hub.New(repo).GetDownloadManager().Download(ctx, url, tmp, cb)` (writes `.part`, honours
  proxy env via default transport), SHA-256 verify, `fsync`, rename into `dir`, write manifest last
  (atomic temp+rename). Mismatch deletes the file and returns `ErrChecksum`. Progress sums across files.
  S10 (`verify-packaging.sh`) stays green: URLs contain `resolve/`, not `releases/download`.
- `encoder_cgo.go` (`//go:build cgo`): `type encoder struct{ tk *hftokenizer.Tokenizer; sess
  *ort.DynamicAdvancedSession; inNames []string }`. `newEncoder(libPath, dir string, s Spec)`:
  `ort.SetSharedLibraryPath`, `ort.InitializeEnvironment`, `ort.GetInputOutputInfo` for input names
  (`input_ids`, `attention_mask`, `token_type_ids`), session options: intra-op 2, inter-op 1,
  `SetCpuMemArena(false)`, `SetMemPattern(false)`, config entry
  `session.intra_op.allow_spinning=0` (no idle CPU burn). `embed(texts []string) ([][]float32, error)`:
  tokenizer `With(EncodeOptions{AddSpecialTokens: true, MaxLen: s.MaxTokens})`, pad batch to longest,
  attention mask 0 on pads, output `last_hidden_state`, CLS slice (token 0), L2 normalise.
- `encoder_nocgo.go` (`//go:build !cgo`): `newEncoder` returns `ErrNoRuntime`.
- `worker.go`: `RunWorker(args []string) int`, the `memory-embed` body. Flags: `--model-dir`.
  Loads encoder; on failure writes one line `{"error": "..."}` to stdout and exits 2. On success writes
  `{"ready": true, "model": id, "dim": 384}`. Then NDJSON loop over stdin: request
  `{"id": n, "texts": [...]}` (≤ 32 texts), reply `{"id": n, "vectors": ["<base64 LE float32>", ...]}` or
  `{"id": n, "error": "..."}`. Exits 0 on stdin EOF (parent death closes the pipe, so no orphan).
  Diagnostics on stderr only.
- `client.go`: `type Client struct` with `NewClient(ClientOptions{Spec, Home string; Command
  func(ctx context.Context, modelDir string) *exec.Cmd; IdleTimeout time.Duration; OnState func()})`.
  Default `Command`: `os.Executable()` (symlinks resolved) + `memory-embed --model-dir <dir>`, env
  inherited. Methods:
  - `Embed(ctx, texts []string, query bool) ([][]float32, error)`: adds `QueryPrefix` when `query`;
    serialised by a mutex (one request in flight per worker); lazy spawn + hello read (30 s timeout);
    resets idle timer; ctx cancel kills the worker (cannot interrupt ORT mid-run) and returns
    `ctx.Err()`.
  - `Status() Status` with `State` in `notInstalled | unavailable | ready` and `Message`.
    `notInstalled` when `!Installed`; `unavailable` after spawn/hello/crash failure (message = worker
    error or exit status); `ready` otherwise (worker may or may not be running).
  - Failure backoff: after a failed spawn, further spawns are refused for 60 s (returns the last
    error immediately), so a search per keystroke cannot spawn-storm. `Reset()` clears it (called
    after install).
  - `Close()`: stops idle timer, closes stdin, waits up to 2 s, then kills.
  - `OnState` fires on every state transition.

## 5. Storage (`internal/memory`)

### 5.1 Migration `internal/memory/migrations/0002_embeddings.sql` (register Version 2 in `embed.go`)

```sql
CREATE TABLE memory_embeddings (
  seq        INTEGER PRIMARY KEY REFERENCES memories(seq),
  model      TEXT NOT NULL,
  vec        BLOB NOT NULL CHECK (length(vec) > 0 AND length(vec) % 4 = 0),
  created_at TEXT NOT NULL
);
```

One row per memory version (superseded versions too, for `includeHistory`). One model at a time:
a model change overwrites rows via `INSERT OR REPLACE`; search filters `model = ?`. No trigger
bumps `memory_revision`. Existing rows get vectors through backfill (§6.4); the migration itself
is schema only (embedding needs the model, which migration time cannot assume).

Downgrade: an older binary meets `schema_version 2` and refuses with `SchemaTooNewError` (existing
behaviour; app and `memory-mcp` are one binary, so they move together).

### 5.2 `store.go` changes

- Rename `Search` to `searchFTS` (unexported; all callers move to `Service.Search`). Body unchanged.
  Return per-row rank order (already ordered).
- `insertMemory` gains `vec []byte, model string`: after the `INSERT INTO memories`, take
  `LastInsertId()` (= `seq`) and, when `vec != nil`, `INSERT INTO memory_embeddings` in the same tx.
  `commitInput` gains `Vec []byte; Model string`.
- `vectorTopK(ctx, model string, q []float32, includeHistory bool, k int) ([]scored, error)`:
  `SELECT e.seq, e.vec FROM memory_embeddings e JOIN memories m ON m.seq = e.seq WHERE e.model = ?1
  AND (?2 OR m.status = 'current')`; decode into one reused buffer; bounded min-heap of size k
  (`container/heap`); rows whose length ≠ dim*4 are skipped and logged once.
- `memoriesBySeq(ctx, seqs []int64) (map[int64]Memory, error)`: `memoryColumns` with `m.seq IN (...)`,
  also scan `m.seq` (add to a variant scanner; do not change `memoryColumns` order for other callers).
  `searchFTS` must return `seq` too: add `m.seq` to its select via the same variant.
- `missingEmbeddings(ctx, model string, n int) ([]pendingEmbed, error)`: `SELECT m.seq, m.fact FROM
  memories m LEFT JOIN memory_embeddings e ON e.seq = m.seq AND e.model = ?1 WHERE e.seq IS NULL
  ORDER BY (m.status = 'current') DESC, m.seq DESC LIMIT ?2`.
- `putEmbeddings(ctx, model string, rows []pendingEmbed)`: one tx, `INSERT OR REPLACE`.
- `embeddingCounts(ctx, model string) (have, total int64, error)`.

`Memory` gains `Match string \`json:"match,omitempty"\`` (`keyword | semantic | both`), set only by
search.

## 6. Service (`internal/memory`)

### 6.1 Wiring

`NewService(store *Store, runner Runner, opts ServiceOptions) *Service`, `ServiceOptions{Embedder
Embedder; OnChange func(); OnSemantic func()}`. Callers: `bridge.MemoryService.service`,
`memorycli.Run`, tests, smoke test.

```go
// Embedder is embed.Client's seam; nil means semantic search is off.
type Embedder interface {
    Spec() embed.Spec
    Embed(ctx context.Context, texts []string, query bool) ([][]float32, error)
    Status() embed.Status
}
```

`Service.Close()` cancels the backfill context and calls the embedder's `Close` when it has one
(type-assert `io.Closer`).

### 6.2 `hybrid.go` (new)

- `func fuse(fts, vec []hit, limit int) []hit` where `hit{seq int64}`. RRF score
  `Σ 1/(60 + rank)` (rank 1-based per list). Sort: score desc, then better FTS rank, then seq desc.
  `Match` = `both` / `keyword` / `semantic`. Truncate to `limit`.
- `Service.Search(ctx, a SearchArgs) ([]Memory, error)`:
  1. `BuildMatch` false: return `[]` (unchanged contract; bridge still routes empty to `Recent`).
  2. FTS list: `store.searchFTS(limit)`.
  3. If `Embedder != nil && Status().State == ready && store has ≥1 vector for model`: embed query
     (`query=true`, 5 s timeout); on error log at `slog.Debug` and keep FTS only.
  4. Vector list: `vectorTopK(k = limit)`.
  5. `fuse`, then `memoriesBySeq` for the vector-only seqs, keep fused order, set `Match`.
  6. `s.kickBackfill()` (non-blocking).

### 6.3 Store path

- `prepare(ctx, w)`: after the hash short-circuit, `w.vec` = doc embedding of `w.Fact` (best effort,
  10 s timeout incl. cold spawn; nil on any error). Candidates = `searchFTS(limit 10)` ∪
  `vectorTopK(k 5)` filtered by `Dot ≥ Spec().DocFloor`, deduped by id, FTS first. The
  "no candidates → add without model call" rule stays.
- `commit`: decision fact equals `w.Fact` (add) → reuse `w.vec`; update with a merged fact → embed
  the merged fact (best effort). Encode and pass `Vec/Model` into `commitFact`.
- After commits: `kickBackfill()`.

### 6.4 Backfill

`kickBackfill()`: single-flight via `atomic.Bool`; goroutine on the service context; loop:
`missingEmbeddings(32)` → `Embed` → `putEmbeddings` → `OnSemantic()`; stop when empty, on embed
error (status shows it), or on context cancel. Triggers: `Search`, `Store`, Service creation when
the model is installed (Kira Space), install completion. Two processes racing write identical rows
(`INSERT OR REPLACE`); only compute is duplicated. Batches commit independently, so an MCP process
ending mid-backfill loses nothing.

### 6.5 Status

`Service.SemanticStatus(ctx) (SemanticStatus, error)`:
`SemanticStatus{State string; Message string; Model string; Done, Total int64}`. State:
`off` (no embedder), `notInstalled`, `unavailable`, `indexing` (ready but `have < total`; Done/Total
are row counts), `ready`. The bridge overlays `downloading` (Done/Total bytes) while an install runs.

## 7. MCP server (`internal/memory/mcpserver/server.go`, `memorycli/run.go`)

- `memorycli.Run`: `embed.NewClient(...)` with `Home: memory.Home()`; pass as `ServiceOptions.Embedder`;
  `defer svc.Close()`.
- `search_memories`: description says keyword and semantic matching; `searchInput.Query` jsonschema
  "free text; matched by words (prefixes, word forms) and by meaning". `searchOutput` gains
  `Semantic string json:"semantic"` (state). `renderMemories` appends ` [semantic]` for
  `Match == "semantic"`. When state is not `ready`/`indexing`, the text ends with
  `Note: semantic search is <state>: <message>. Results are keyword matches only.` For
  `notInstalled`: `Enable it in Kira Space, Memory, Download model.`
- `instructions`: one sentence that search matches meaning as well as words.
- MCP never downloads.

## 8. Kira Space

### 8.1 Argv shim (`apps/kira-space/main.go`)

`runArgvShim`: `case "memory-embed": return embed.RunWorker(args[2:]), true`. Update the startup-order
comment.

### 8.2 Bridge (`apps/kira-space/internal/bridge/memory.go`)

- `service()`: build `embed.NewClient` (`OnState: s.emitSemantic`), `ServiceOptions{Embedder, OnChange:
  s.emitChanged, OnSemantic: s.emitSemantic}`; when model installed, `kickBackfill` via a new exported
  `Service.StartBackfill()`.
- `const ChannelMemorySemantic = "kira:memory:semantic"`; `emitSemantic` throttled to one per 250 ms
  (`time.AfterFunc` coalescing; the payload is empty, the UI refetches status).
- `SemanticStatus(ctx) (memory.SemanticStatus, error)`: service status, overlaid with `downloading`
  and byte progress while an install runs.
- `InstallSemanticModel(ctx) error`: one install at a time (mutex; second call returns
  `ipcerr.BadRequest("already downloading")`); `embed.Install` with progress into a guarded field +
  `emitSemantic`; on success `client.Reset()`, `StartBackfill()`. Cancel = Wails call cancel (same
  as `Store`). Errors map through `memoryErr` (add `embed.ErrChecksum` → BadRequest; network errors
  → Internal with message).
- `RetrySemantic()`: `client.Reset()`, `emitSemantic`, `StartBackfill()`.
- `CloseMemory`: `svc.Close()` before `store.Close()`.

### 8.3 Frontend

- `packages/shared/domain/memory.ts`: `memorySchema.match: z.enum(['keyword','semantic','both']).optional()`;
  `memorySemanticStatusSchema` (`state` enum `off|notInstalled|downloading|unavailable|indexing|ready`,
  `message`, `model`, `done`, `total`).
- `packages/shared/protocol/events.ts`: `memorySemantic: 'kira:memory:semantic'`.
- `packages/workbench/src/memory/module.ts` `MemoryControl`: `memorySemanticStatus()`,
  `memorySemanticInstall(signal?: AbortSignal)`, `memorySemanticRetry()`, `onMemorySemantic(cb)`.
- `apps/kira-space/frontend/src/bridge/memoryControl.ts`: bind `SemanticStatus`,
  `InstallSemanticModel` (abort calls `call.cancel()`), `RetrySemantic`, `on(CHANNEL.memorySemantic, cb)`.
- `queries.ts`: `useMemorySemanticStatus()` (TanStack Query, key `['memory','semantic']`, invalidated
  by `onMemorySemantic`); `useInstallSemanticModel()` mutation; `useMemoryChangeSync` unchanged (it
  already invalidates the `memory` prefix, which covers semantic status after writes).
- `SemanticStatus.vue` (new, `<script setup lang="ts">`, Tailwind only), mounted in `MemoryPanel.vue`
  below the history switch, `data-testid="memory-semantic"`:
  - `notInstalled`: "Semantic search off" + shadcn `Button` "Download model (35 MB)".
  - `downloading`: shadcn `Progress` + "12 / 35 MB" + Cancel (aborts the mutation signal).
  - `indexing`: "Indexing 120 / 800" + `Progress`.
  - `unavailable`: message + Retry (bridge `RetrySemantic()`).
  - `ready`: one muted line "Semantic search on". `off` renders nothing.
- `MemoryPanel.vue`: row badge `<Badge v-if="memory.match === 'semantic'">semantic</Badge>`.
- shadcn-vue `progress`: add per `docs/DEV_ENVIRONMENT.md` "shadcn-vue — adding a component set"
  into `packages/theme/src/components/ui/progress/` (Reka UI `ProgressRoot`, already a dependency).
- No Pinia change: all of it is server state.

## 9. Build and packaging

- `go.mod`: `github.com/yalue/onnxruntime_go v1.36.0`, `github.com/gomlx/go-huggingface v0.4.13`.
- `scripts/fetch-onnxruntime.sh <platform>` (`osx-arm64` default, `linux-x64` for dev): downloads
  `https://github.com/microsoft/onnxruntime/releases/download/v1.29.1/onnxruntime-<platform>-1.29.1.tgz`,
  verifies sha256 (osx-arm64 `c845ad2f4340669dc454c0ae092ccef7270d5bf858281890aef3c9bbf7da41e9`,
  linux-x64 `a28d7d65acafc06fb0f416cb409998773f5314c7eebf77caf907812831cdfc67`), extracts `lib/libonnxruntime*.<ext>`,
  `LICENSE`, `ThirdPartyNotices.txt` into `apps/kira-space/build/onnxruntime/<platform>/`
  (gitignored). Idempotent: skips when the extracted dylib's sha matches. Lives in `scripts/`, the
  S10-sanctioned place for downloaders.
- `apps/kira-space/build/darwin/Taskfile.yml`: task `fetch:onnxruntime` (runs the script); `package`
  and `package:universal` depend on it; `create:app:bundle` creates `Contents/Frameworks/`, copies
  `libonnxruntime.1.29.1.dylib` and `Resources/onnxruntime-LICENSE.txt` +
  `Resources/onnxruntime-ThirdPartyNotices.txt` **before** `codesign:adhoc`, failing loudly if the
  dylib is missing (same pattern as the `.vsix`). `run` copies it conditionally into `.dev.app`.
- `scripts/verify-packaging.sh`: new check S12 — `create:app:bundle` references
  `libonnxruntime.1.29.1.dylib` and the version in `internal/memory/embed/paths.go` matches the
  script's pinned version (static, Linux-runnable).
- No `.github/workflows/` change: release builds run `package:space`, which now pulls the fetch task.

## 10. Commits (in order; each passes the pre-commit hook)

1. `feat(memory): embeddings table and vector storage` — `0002_embeddings.sql`, migration list,
   `embed/vector.go`, `embed/spec.go`, store functions §5.2, `Memory.Match`. `Service.Search` and
   `prepare` call `searchFTS` until commit 3 replaces them.
2. `feat(memory): ONNX embedding worker and client` — `go.mod`, `embed/{paths,encoder_cgo,encoder_nocgo,
   worker,client}.go`, `client_test.go`, `memory-embed` argv shim.
3. `feat(memory): hybrid recall search and embed on store` — `ServiceOptions`, `hybrid.go` +
   `hybrid_test.go`, `Service.Search`, `prepare`/`commit` vectors, backfill, `SemanticStatus`,
   `Close`; update `NewService` callers (bridge, memorycli, tests); `service_test.go` hybrid test.
4. `feat(memory): model download with pinned checksums` — `embed/install.go`.
5. `feat(memory): semantic matches in kira-memory tools` — §7.
6. `feat(space): semantic search status and model download in Memory module` — §8.2, §8.3, shadcn
   `progress`.
7. `build(space): bundle ONNX Runtime 1.29.1` — §9 script, Taskfile, `.gitignore`, S12.
8. `test(memory): real-model embedding smoke` — `embed/smoke_test.go` (`//go:build embedsmoke`).
9. `docs: P210 memory semantic search` — §13.

## 11. Tests (CLAUDE.md bar)

- `embed/client_test.go` — concurrency/lifecycle, qualifies. Fake worker = the test binary
  re-executed (`TestMain` checks `KIRA_EMBED_FAKE_WORKER=1`, then serves the NDJSON protocol with
  hash-derived vectors; modes via env: `crash-after=N`, `hello-error`, `slow`). Cases:
  serialisation under parallel `Embed` calls; idle timeout closes the worker and next call
  respawns; crash mid-request returns an error and next call respawns; hello error → `unavailable`
  + 60 s backoff refuses respawn, `Reset` clears it; ctx cancel kills a slow request.
- `hybrid_test.go` — one table test for `fuse`: both-list boost, alternation of keyword-only and
  semantic-only, tie-break, truncation to limit, `Match` labels.
- `service_test.go` — one `TestHybridSearchUnionsKeywordAndSemantic` with a fake `Embedder` (map
  text → fixed vector): a keyword-only hit, a semantic-only hit (no shared word), both returned,
  `Match` correct; FTS-only result when the fake returns an error.
- No tests for: vector encode/decode, migration, `missingEmbeddings`/`putEmbeddings`, installer
  checksum mismatch (single bad input), bridge methods, UI status rendering.
- `embed/smoke_test.go` (`embedsmoke` tag, not in CI): needs `KIRA_ORT_LIB` and network; installs
  the model into `t.TempDir()`, runs the real worker through `Client`, asserts dim 384, unit norm,
  and the 10-query probe from §2.2 at ≥ 8/10 top-1.

## 12. Verification the orchestrator runs before accepting

- `go build ./...`; `CGO_ENABLED=0 go build ./internal/memory/... ./apps/kira-space/...`
  (stub path compiles); `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./internal/memory/...`.
- `go test ./internal/memory/...`; `bun run typecheck`; `bun run lint`; `bun run test:unit`.
- Real callers, by grep: `embed.NewClient(` in `bridge/memory.go` and `memorycli/run.go`;
  `"memory-embed"` in `runArgvShim`; `fuse(` called from `Service.Search`; `vectorTopK(` from both
  `Search` and `prepare`; `memory_embeddings` in `insertMemory`; `SemanticStatus.vue` imported by
  `MemoryPanel.vue`; `hftokenizer.` and `ort.` used in `encoder_cgo.go`.
- Real run (Linux): `scripts/fetch-onnxruntime.sh linux-x64`, then
  `KIRA_ORT_LIB=… go test -tags embedsmoke ./internal/memory/embed/ -run Smoke -v` passes.
- Server-tag run (DEV_ENVIRONMENT recipe) with `KIRA_ORT_LIB`: Memory module shows Download model,
  progress, Indexing, then "Semantic search on"; a no-shared-word query returns a `semantic` badge
  row; worker process gone ~5 min after last search (`pgrep -f '^.* memory-embed'`).
- MCP path: `claude -p --mcp-config` per DEV_ENVIRONMENT "Memory MCP" with `KIRA_ORT_LIB` in the
  server env: `search_memories` returns a `[semantic]` row.
- Mac (user-run, cannot run here): packaged `.app` has `Contents/Frameworks/libonnxruntime.1.29.1.dylib`,
  `codesign --verify --deep --strict` passes, worker footprint in Activity Monitor ≤ 150 MB. Until
  done, a Known open item (§13).

## 13. Docs

- `docs/ARCHITECTURE.md` Memory section: embeddings table, worker process + idle unload, model id and
  location, hybrid RRF, reconcile floor, status states, fallback. Stack table: one row for local
  embeddings (ORT 1.29.1 via yalue, hftokenizer, arctic-embed-s int8; hugot declined for RAM and
  weight). Known open items: rewrite "Memory has no semantic (embedding) search and no delete" to
  "no delete"; add "Semantic search unverified on a Mac (P210): dylib loading from `Frameworks`,
  int8 kernels on arm64 and worker footprint measured on Linux only. Delete once checked."
- `docs/DEV_ENVIRONMENT.md` Memory section: `KIRA_ORT_LIB`, `fetch-onnxruntime.sh linux-x64`,
  `embedsmoke` command, HF reachable through the proxy here.
- `docs/PACKAGING.md` §7 S10 note (model download is a user-clicked app-code download, URL is a HF
  `resolve/` path, not a release asset); §8 Frameworks dylib, S12.
- `docs/v2.2/SPEC.md`: P210 status and result section; fold this plan into it, then delete the plan
  per `docs/v2.2/README.md`.

## 14. Deferred decisions (user's; recommended default in bold)

- **D1. Language.** **English-only arctic-embed-s int8 (137 MB peak).** Alternative:
  multilingual-e5-small int8 (MIT, 362 MB peak, weaker English retrieval) if memories will be written
  in Romanian or other languages. Best multilingual (arctic-embed-m-v2.0 int8) measured 592 MB, over
  the bar.
- **D2. Model delivery.** **Download on click (35 MB) from Hugging Face, pinned revision and SHA-256.**
  Alternative: bundle the model in the DMG (+35 MB, works fully offline from first launch, no network
  path to test).
- **D3. Semantic candidates in reconcile.** **On, cosine floor 0.85.** Catches paraphrased
  duplicates ("prefers tabs" vs "wants tab indentation") that FTS misses; costs an extra Sonnet
  reconcile call when such a neighbour exists. Off keeps reconcile FTS-only.

## 15. Risks

- Each concurrent Claude Code session that searches spawns its own worker (~95-137 MB each) until
  5 min idle. Three busy sessions plus the app stay under 600 MB total, each process under the bar.
  Sharing one worker across processes (socket to the app) is declined: the MCP server must work
  with the app closed.
- `hftokenizer` WordPiece parity with HF `tokenizers` is unverified beyond the probe's sane scores;
  the smoke test's ranking bar is the guard.
- ORT 1.29.1 x86_64 macOS absent: universal builds lose semantic search on Intel (not shipped).
- Cold first search after idle pays ~300 ms spawn+load (Linux); Mac number unknown until §12 Mac check.
