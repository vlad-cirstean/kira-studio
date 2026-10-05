# P163: Shared parse worker and chunker for large payloads

Source: SPEC row P163 (`docs/v2.0/SPEC.md:95`). User scope (decided, not relitigated here):
parsing stays in the frontend; Go-side formatting is out, no Go-vs-worker comparison. P160 built
one dedicated worker (`prettyBody*`, `85a15512`) and one chunked editor fill (`MonacoHost`,
`b60c35de`); this phase turns both into shared infrastructure and migrates every caller whose
measured cost earns it. Base at plan time: `v2.0` at `f54cb106`. App: `apps/kira-studio`. Paths
relative to `apps/kira-studio/frontend/src` unless rooted.

## 0. Sequencing with P161 (read first)

P161 (Documents flick) is being implemented in the main checkout and may change Documents view
files. **P163 implementation starts only after P161 lands** on `v2.0` (its `docs(v2.0): P161
result` commit). Table order also puts P162 before P163; P162's grid files do not overlap this
plan (grid caller `rowsToJson` is "no change", section 1). Plan against the tree after P161:
at implement time, re-read every overlap file and re-run the step 1 inventory, never trust the line
numbers below for them.

Overlap files (P161 may touch; P163 reads or edits):
- `views/documents/DocumentView.vue` (`fieldNamesOnPage` callers `:200,204,216,299`; `useEditBuffer`)
- `views/shared/document/rows.ts` (`parseRow` -> `parseDocument`, parse cache, `pruneRows`)
- `views/documents/DocumentRow.vue`, `views/shared/document/DocumentTree.vue` (read only here)
- `views/documents/page.ts` (`fieldNamesOnPage`, decode cache, `setVisibleWindow`)
- `views/console/ConsoleResultGrid.vue` (shares rows/tree; `allBodies` copy-all thunk)
- `apps/kira-studio/tests/perf/perfProbe.ts` (P161 adds frame helpers), root `package.json`
  (P161 adds `perf:documents:studio`, narrows `perf:http:studio` to its spec),
  `apps/kira-studio/tests/unit/document-row-height-cache.spec.ts`
- `docs/PERF.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`

If P161's profile named parse churn (its H2) and fixed it with a bounded cache, `parseDocument`
stays as P161 left it (section 1 row); do not move it into the worker on top.

## 1. Current tree (CodeGraph + reads + microbench)

Microbench: `bun` 1.3.14 (JavaScriptCore, same engine family as WebKit, no DOM), real source files
from this tree, median of 5, load1 0.30..0.64. Indicative only: it orders candidates; the step 2
probe in WebKit is the evidence. Inputs: JSON array of 120-byte objects, XML of 80-byte
`<item>`s, Mongo EJSON docs (7 fields + padding), 2 000-statement SQL script.

Shared pure code (no DOM, worker-safe): `beautify.ts` (`beautifyJson`, `beautifyXml`, `scanJson`,
`scanXml`), `views/shared/document/rawTree.ts` (`tryParse`, `beautifyWith`, renderers),
`views/shared/document/ejson.ts` (`parseDocument`, `toRelaxedText`, `toPlainJson`,
`toShellText`, `beautifyShellText`, `tryParseShellText`), `views/httprequest/prettyBodyCore.ts`
(`formatBody`), `sql-formatter` 15.8.2 (lazy chunk `views/console/sqlFormatterEntry.ts`).

| # | Caller (site) | Input source | Typical / worst | Cost (bun) | Verdict at plan time |
|---|---|---|---|---|---|
| 1 | HTTP response body: `useResponseBody.ts` -> `prettyBody.ts` worker / `formatBody` inline <= 64 K | network | KBs / 5 MB default cap, 2 GB max | `formatBody` 5 MB 246 ms, 16 MB 942 ms | Already off-thread (P160). Fold into shared worker (step 3). |
| 2 | HTTP response find: `ResponsePane.vue:256-258` `findRanges` | response text | as 1 | 5 MB 0.6 ms, 16 MB 7.7 ms (regex text cap `REGEX_SCAN_TEXT_CAP` 10 000) | No change, numbers. |
| 3 | HTTP request body Beautify: `RequestBodyPane.vue:132` `beautifyFor` | user paste | KBs / unbounded | JSON 5 MB 290 ms; XML 5 MB 367 ms | Probe; likely move. |
| 4 | gRPC request Beautify: `GrpcRequestView.vue:257` `beautifyJson` | user paste | KBs / unbounded | as 3 | Probe; likely move. |
| 5 | gRPC response messages: `grpcrequest/ResponsePane.vue:454-460` `MonacoHost :doc="entry.m.json"` | Go `protojson`, no frontend parse | KBs / 16 MiB per message (`grpcclient/call.go` `maxRecvMsgSize`) | no parse; fill is `MonacoHost` (chunked already, read-only) | No parse to move. Chunker reaches it through `MonacoHost`. Probe one 5 MB message to confirm. |
| 6 | Response compare: `ResponseDiffDialog.vue:82-98` `detectAndBeautify` x2 in `computed` | history snapshots | KBs / 256 KiB each (history cap) | 256 KB 15-20 ms each | Probe both sides + diff editor fill. Likely "no change". |
| 7 | Cell editor: `celleditor/detect.ts:336` `detectFormat` (`scanJson`/`scanXml`), `validate.ts:72` `validateFormat`, `formats.ts:94` `beautifyFor` via `useEditBuffer.ts:72` | grid cell | bytes / 64 KiB (`internal/page/chunk.go` `MaxCellBytes`) | `scanJson` 64 KB 1.5 ms, beautify 7.8 ms | No change, numbers (probe once at 64 KiB). |
| 8 | `useEditBuffer.ts:49` `byteLabel` (`TextEncoder.encode` per keystroke) | edit buffer | as 7 / as 7 and Documents edit (64 KiB body cap) | sub-ms at 64 KB | No change, numbers. |
| 9 | Documents rows: `rows.ts:128` `parseRow` -> `parseDocument` | page bodies | ~400 B / 64 KiB per row | 64 KB 0.2 ms; 60-row window 1 ms | No change unless P161 left it hot (section 0). |
| 10 | Documents field names: `page.ts:60` `fieldNamesOnPage` (`JSON.parse` every body), called from 4 computeds in `DocumentView.vue` and `ProjectionMenu.vue:26` | page bodies | 100 rows / 10 000 rows x up to 64 KiB | not isolated; `toPlainJson` x5 000 8 KB 107 ms bounds it | Probe at page size 10 000. Cheapest fix first: memoize per page version (one parse pass, not 4); worker only if the single pass still blocks. |
| 11 | Documents row menu: `documents/menu.ts:13` `prettyJson`, `toPlainJson`/`toRelaxedText`/`toShellText` | one body | <= 64 KiB | < 1 ms | No change, numbers. |
| 12 | Console Mongo result copy-all: `console/resultMenu.ts:316-340` (`toPlainJson`, `compactShellText`, `prettyJson`, `toRelaxedText` over `allBodies()`) | result page | 100 / 10 000 x up to 64 KiB | x5 000 small 20-36 ms; x5 000 8 KB 107 ms | Probe at 10 000 rows; likely move (one batch job). |
| 13 | Console Format: `console/format.ts:209` `formatDialect` per statement; `:95` `beautifyShellText` per Mongo arg | user script | KBs / unbounded (pasted dump) | `formatDialect` 236 KB script 2 160 ms | Probe; strong move candidate (already async). |
| 14 | Console Mongo lint: `console/lint.ts:150` `tryParseShellText`, run by `MonacoHost` `scheduleLint` | user script | KBs / unbounded | `beautifyShellText` 64 KB 0.8 ms | Probe one large script; likely no change (debounced, scan only). |
| 15 | EXPLAIN parse: `console/planParsers/{postgres,mysql,mariadb,clickhouse}.ts` `JSON.parse` | DB plan | KBs / rare MBs | native `JSON.parse` | No change, numbers (probe one 1 MB plan if a fixture exists, else estimate). |
| 16 | Grid copy as JSON: `shared/clipboardFormats.ts:116` `rowsToJson` | grid selection | rows / 10 000 x 20 cols | 24 ms | No change, numbers. |
| 17 | Hover value: `editor/hoverInfo.ts:35` | env variable | bytes | n/a | No change (small by construction). |

Large data pushed into UI/editor (chunker candidates):
- `editor/MonacoHost.vue:434-478` `fillModel`: the only chunked push today. 32 mount sites; read-only
  hosts over `LARGE_DOC_CHARS` (256 KiB) stream line-aligned 256 KiB chunks via `applyEdits`, one
  rAF apart, generation counter cancels. Covers rows 1, 5 and `RawExchangePane`.
- Diff editor (`ResponseDiffDialog.vue:189-205`: `createModel(bodyTextA/B)` whole, then
  `createDiffEditor`/`setModel`): inputs <= 256 KiB pretty-expanded (~400 KB). Probe decides.
- Editable hosts (request body, gRPC message, console) take a whole-doc `pushEditOperations` on
  Beautify/Format (undo boundary, P160 §4.7). Chunking an editable write would split undo; not a
  chunker user (see decisions).
- Documents/console lists are virtualized (`useVirtualRows`); nothing is bulk-pushed.

## 2. Decisions

| Item | Decision |
|---|---|
| Worker count | One app-wide module worker, lazy-started on the first job over the inline threshold, kept for the app's life. No pool. |
| Location | `workers/parse/`: `handlers.ts` (pure handler table, imported by worker and fallback), `protocol.ts` (request/response types), `parse.worker.ts`, `client.ts` (singleton transport, queue, fallback), `useParseWorker.ts` (composable). Bundled with Vite `?worker` (same form as `prettyBody.ts:1`, `packages/workbench/src/editor/monacoEntry.ts:134`). |
| Typed request set | `ParseJobs` map: `kind -> { input; output }`. `handlers: { [K in keyof ParseJobs]: (input) => output }`. `run<K>(kind: K, input: ParseJobs[K]['input'], opts?: { signal?: AbortSignal }): Promise<ParseJobs[K]['output']>`. Kinds start from P160's `body.format` (`formatBody`) plus `json.beautify`, `xml.beautify` (both `BeautifyMode`), and only the kinds a migrated caller needs (e.g. `sql.format` with dialect key and options, `ejson.copyAll` batch). A kind with no migrated caller is not added. |
| Inline threshold | `INLINE_CHARS = 65_536` exported from `client.ts` (P160's `SYNC_BODY_CHARS`). `parseInline(kind, input)` runs the same handler synchronously. Callers that must apply in the same tick (P160 deviation: no pending flash, specs stay synchronous) branch on it; `run` never resolves synchronously. |
| Fallback | Owned by the client, not callers: if `new Worker` throws, or the worker errors, in-flight and queued jobs run through `handlers` inline and resolve normally. Next job after an error re-creates the worker (P160's reject-then-retry shape). Correctness never depends on the worker. |
| Cancellation | `AbortSignal` (platform, one concept for worker and chunker). Client keeps a FIFO and posts one job at a time. Abort of a queued job removes it before it is posted. Abort of the running job rejects with `AbortError` at once; if other jobs wait, terminate and respawn the worker (hard cancel, a sync parse cannot observe a message); if none wait, let it finish and drop the result. Respawn cost measured in step 3. |
| Composable | `useParseWorker()`: `run`, plus `runLatest(key, kind, input)` that aborts the previous job under the same key (P160's `seq` pattern). Aborts the scope's own jobs on dispose (VueUse `tryOnScopeDispose`). Not a Pinia store: it holds no shared state, only a transport. |
| Transfer | Strings via structured clone. Step 3 measures `postMessage` of a 12 MB string (both directions); only if over 50 ms, transfer an encoded `ArrayBuffer` instead. |
| Library: Comlink | Declined. Apache-2.0 and maintained, but it cannot meet the cancellation requirement: no abort for a call, and terminating the worker under a Comlink proxy leaves pending calls unsettled, so the client would keep its own pending map, queue and inline fallback anyway. What Comlink would replace is ~30 lines of id correlation, under the "non-trivial infrastructure" bar. |
| Library: VueUse `useWebWorkerFn` / `useWebWorker` | Declined. `useWebWorkerFn` builds the worker from the function's source text: handlers cannot import `beautify.ts`, `ejson.ts` or `sql-formatter` as bundled modules, and it spawns one worker per function. `useWebWorker` is scope-bound (terminates on unmount) with one `data` ref, no request/response correlation; the requirement is one app-wide worker shared across components. VueUse is used for scope cleanup (`tryOnScopeDispose`). |
| Chunker | `editor/chunkedText.ts`: `textChunks(text, { chunkChars, lineAligned })` generator (cut after the next `\n` within one more chunk, never inside a surrogate pair or between `\r` and `\n`) and `pumpChunks(chunks, apply, { signal, pace })`, `pace` default one `requestAnimationFrame`. `MonacoHost.fillModel` moves onto it unchanged in behaviour (generation counter becomes an `AbortController`). Other users only where step 2 finds a large push. VueUse `useRafFn` declined for pacing: it is a start/stop loop, the pump needs one awaitable frame per chunk and an abort signal; a rAF promise is one line. |
| Editable hosts | Not chunked: a chunked editable write splits the §4.7 undo boundary into many entries. If step 2 shows an editable Beautify/Format push over 50 ms, record it in `## Result` and ask the user; do not build. |
| Async callers | Migrating a sync caller (Beautify buttons, copy-all, Format) to `run` makes it async. Each guards staleness: drop the result if the buffer or selection changed since the job started (compare input string identity / tab id). Buttons show the existing pending affordance pattern only if the wait exceeds 200 ms (P160's `useTimeoutFn` caption rule); no new UI otherwise. |
| Move threshold | A caller migrates only when the step 2 probe at its realistic worst input shows a main-thread block (`longestBlockMs`) over 50 ms attributable to the call (before-after delta vs an idle baseline). Otherwise it is listed "no change" with its numbers. Cheapest fix first: memoization or dropping a duplicate pass beats a worker move (row 10). |
| P160 fold-in | `views/httprequest/prettyBody.ts`, `prettyBody.worker.ts` deleted; `prettyBodyCore.ts` `formatBody` becomes the `body.format` handler (moved into `workers/parse/handlers.ts` or imported by it; keep one definition); `useResponseBody.ts` uses `useParseWorker` (`runLatest`) and `parseInline`. P21 retention rule and 200 ms caption unchanged. |
| Split | Single sequential implementer. Worker infra and chunker touch disjoint files, but every caller migration depends on step 3, and all probe windows share one quiet machine; a split buys nothing (CLAUDE.md independence rule not met). |
| Unit tests | Two, both meet the CLAUDE.md bar: `tests/unit/parse-worker-client.spec.ts` (queue ordering, abort queued vs running, terminate-and-respawn, fallback after worker error; worker faked) and `tests/unit/chunked-text.spec.ts` (line alignment, no-newline doc, surrogate pair and `\r\n` boundaries, concatenation equals input). No test per handler: handlers are the existing pure functions, already covered. |
| Out of scope | Go-side formatting (user decision). Grid render (P162). Documents scroll (P161). Search behaviour, Beautify output, copy formats: byte-identical to today. |

## 3. Steps

### Step 0: precondition

1. Confirm P161's result commit is on `v2.0`; branch from the chapter tip after it (and after P162
   if landed). Re-read section 0 overlap files.
2. CodeGraph (`codegraph_explore`, mandatory for this discovery) on `beautifyJson beautifyXml
   beautifyShellText tryParseShellText parseDocument fieldNamesOnPage formatDialect toPlainJson
   detectFormat validateFormat useEditBuffer MonacoHost fillModel`: re-confirm section 1 callers on
   the new tree; add any new caller to the inventory table before measuring.

### Step 1: probe

Files:
- `apps/kira-studio/tests/perf/perfProbe.ts`: extract the heartbeat block meter from
  `http-response.spec.ts` (setTimeout-0 gap list, `longestBlockMs`, `tbtMs` over a window) into
  shared in-page helpers (`installBlockMeter` / `readBlockMeter`, injected via `page.evaluate`);
  add `actionLine`/`actionSummaryLine` (`case`, `size`, `run`, `load1`, `actionMs` click to result
  visible, `longestBlockMs`, `tbtMs`, `rssPeakDeltaMb`). `http-response.spec.ts` uses the shared
  meter; its output format unchanged. Keep P161's frame helpers intact.
- New `apps/kira-studio/tests/perf/parse-callers.spec.ts`: one case per inventory row marked
  "Probe" (3, 4, 5, 6, 7, 10, 12, 13, 14, and 15 if a fixture exists), mocks via
  `tests/ui/fixtures.ts` `relaunch({control})` and the existing support helpers (`apiMode.ts`,
  `mongoFixture.ts`, grid/console fixtures). Sizes: realistic worst per row (section 1), plus one
  mid size. `KIRA_PERF_CASES`, `KIRA_PERF_RUNS` (default 3) as in P160. Asserts nothing.
- Root `package.json`: `"perf:parse:studio": "bun run build:studio && playwright test
  --config=apps/kira-studio/playwright.config.ts --project=perf parse-callers"`.

### Step 2: before numbers and verdicts

Quiet gate (section 5). Full `parse-callers` probe, 3 runs per case, plus `perf:http:studio`
`json` and `text-80col` at 5 and 12 MB (baseline for steps 3-4). Fill the inventory table in
`## Result` with measured `longestBlockMs`/`actionMs` per row and the verdict (migrate / no change)
per the move threshold. Commit `docs(v2.0): P163 inventory` (Result only) before any code moves.

### Step 3: shared parse worker

Build `workers/parse/` per section 2. Fold P160's files in (section 2 "P160 fold-in"). Measure
once: worker cold start, respawn, 12 MB string `postMessage` each way; record in `## Result`.
`perf:http:studio` json/text-80col 5 and 12 MB before -> after: no regression beyond run noise
(medians within 10 %). Unit test `parse-worker-client.spec.ts`.

### Step 4: shared chunker

`editor/chunkedText.ts`; `MonacoHost.fillModel` on it, same constants (`LARGE_DOC_CHARS`,
`FILL_CHUNK_CHARS`), same deferral of `repaintRanges`/lint/debug hook to the end. Same http probe
check as step 3. Unit test `chunked-text.spec.ts`. Adopt at any other site step 2 flagged (e.g.
`ResponseDiffDialog.vue`'s diff models) in its own commit with its own before/after.

### Step 5: migrate callers

One commit per caller marked "migrate" in step 2, highest measured cost first. Each commit:
the caller moves to `useParseWorker` (`run`/`runLatest`, `parseInline` under `INLINE_CHARS`),
adds only the handler kind it needs, keeps output byte-identical, guards staleness; then its probe
case before (step 2 number, or a fresh back-to-back run if load drifted) -> after, recorded in
`## Result`. Row 10's memoization fix, if chosen, is its own `perf(documents): …` commit.
Rules: Tailwind classes, shadcn-vue primitives, `<script setup lang="ts">`, no scoped styles,
comments only for a non-obvious why.

### Step 6: verify

- After numbers: full `parse-callers` and `http-response` probes, back to back with a before run
  from a temp worktree at the step 1 probe commit (removed after), same gate.
- `bun run lint:all`, typecheck, `test:unit`, `test:ui:studio` (incl. `ui-timing`),
  `test:visual:studio` (re-capture only a baseline this phase changed on purpose, with the pixel
  reason). A failure gets fixed per CLAUDE.md, pre-existing or not.
- Docs: `docs/ARCHITECTURE.md` (rule: a parse/format of potentially large input goes through
  `workers/parse`; large read-only editor pushes go through `chunkedText`; inline threshold),
  `docs/PERF.md` (inventory table, before -> after), `docs/DEV_ENVIRONMENT.md` (probe script).

## 4. Commits (expected; one per logical group)

1. `test(perf): parse callers probe` (step 1).
2. `docs(v2.0): P163 inventory` (step 2, Result only).
3. `refactor(frontend): shared parse worker; HTTP body formatting on it` (step 3).
4. `refactor(editor): shared chunked text pump; MonacoHost fill on it` (step 4).
5. `perf(<area>): <caller> parse off the main thread` one per migrated caller (step 5), plus
   any chunker adoption (step 4) or memoization fix as its own commit.
6. `docs: P163 architecture, perf and dev environment notes`.
7. `docs(v2.0): P163 result` (Result filled, SPEC row status Done with headline numbers).

## 5. Measurement rules

- Gate: start a window only at `load1 <= 1.0` (`/proc/loadavg`). The probe's own browser adds
  ~1.0, so a per-run reading up to ~2 is normal; above that, discard the run and wait. Record the
  gate reading and per-run range in `## Result`.
- Same machine, production build (`build:studio`), before/after back to back.
- Median of 3 runs per case; one warm-up action discarded per run.
- No other heavy process started by this session during a window (no parallel UI suite, no
  build). Another session's load counts too: wait it out.
- A number not reproducible at the gate is not evidence; say so rather than report it.
- The section 1 `bun` numbers order candidates only; never quote them as before/after.

## Result

Filled by the implementer: commits; inventory table with measured numbers and verdict per row
(migrated or "no change, numbers"); worker cold start, respawn and transfer costs; per-migrated-
caller before -> after (`actionMs`, `longestBlockMs`, `tbtMs`, `rssPeakDeltaMb`); http probe
no-regression table; gate readings; deviations; verification.
