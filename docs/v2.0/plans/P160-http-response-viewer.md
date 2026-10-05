# P160: HTTP response viewer freeze on large bodies; default max response 5 MB

Source: SPEC row P160 (`docs/v2.0/SPEC.md:92`). User measurements (WebKit): 2.4 MB JSON shows in
1.9 s, main thread blocked 1.7 s, RSS +500 MB; 12 MB shows in 13.7 s, nothing paints, RSS peak
~2.7 GB. Profile: Monaco `_createConfiguration`/`measureReferenceDomElement`. User decision
(final): default `api.maxResponseMb` 50 -> 5. Base: `v2.0` at `de291795`. App: `apps/kira-studio`.
Paths relative to it unless rooted.

## 0. Probe status

The row names `tests/perf/http-response.spec.ts` and `perfProbe.ts`. Neither exists: not in the
tree, not in any commit (`git log --all -- '**/perfProbe*' '**/http-response.spec.ts'` empty), not
on this machine (`find /` empty). It lives on the user's other VM, never committed. This phase
writes a minimal replacement first (step 1) and measures "before" with it. Numbers will not equal
the user's (other machine); before/after from the same probe on the same machine is the evidence.

## 1. Current tree (CodeGraph + reads)

Response path:
- `views/httprequest/state.ts:186-210`: `control.httpSend` result lands in `rt.response`. Response
  stays across sends; first response flips `ResponsePane`'s `v-if="response"` and mounts a fresh
  `MonacoHost`; later responses go through `MonacoHost`'s `doc` watcher.
- `views/httprequest/ResponsePane.vue:145-155` `prettyFormat`: full `beautifyJson(body,'indented')`
  only to read `.ok` (then XML try). `:188-196` `bodyText`: second full `beautifyJson` for `.text`
  in pretty view. Two full parses per receive (row: ~1.1 s each at 12 MB). The split exists for
  P21 finding 7: never retain pretty text outside pretty view. Default `responseView` is `pretty`
  (`packages/shared/domain/http.ts:420`).
- `ResponsePane.vue:493-500`: `<MonacoHost :doc="bodyText" :language="prettyFormat ?? 'plain'"
  :read-only="true" :range-highlights="bodyHighlights">`. `findTargets` (`:254`) reads `bodyText`
  only while find is open.
- `beautify.ts` (+ `views/shared/document/rawTree.ts`, zero imports): pure, lossless scanner, no
  DOM. Safe to run in a worker.

`editor/MonacoHost.vue` (32 mount sites):
- Template `:620-631`: while `pending`, a `<pre class="... whitespace-pre-wrap">{{ doc }}</pre>`
  renders the **full** doc inside `rootRef`.
- `onMounted` `:407-441`: `await loadMonaco()`, then `createModel(props.doc, …)`, then
  `editor.create(rootRef, …)`, then `pending = false`.
- `editor.create` -> `codeEditorWidget.js:198` `_createConfiguration` -> `ElementSizeObserver`
  `measureReferenceDomElement` (`elementSizeObserver.js:84-93`, monaco 0.56.0) reads
  `rootRef.clientWidth/clientHeight`. That forces a synchronous layout of `rootRef`, which still
  holds the full-doc `<pre>` (pre-wrap: every line wrapped). **This is the profiled hot spot**: the
  forced layout of megabytes of wrapped text, not Monaco's own config code. It also explains "nothing
  paints" at 12 MB and much of the RSS (WebKit line boxes for the whole text).
- `applyExternalDoc` `:500-523`: guard `doc === model.getValue()` (allocates the whole doc each
  call); write via `pushEditOperations` on full range. On a read-only host this keeps the previous
  body in the undo stack (one more full copy per response) for no use.
- `updateDebugHook` `:462-465`: `data-kira-editor-text` = full doc, test builds only
  (`KIRA_DEBUG_HOOKS=1`, `frontend/package.json` `build:test`).
- `wordWrap` follows `appearance.wordWrap` (default on): Monaco computes line breaks for every line
  on model attach. Secondary cost, measured, not assumed (step 6 rule).

Settings (`api.maxResponseMb`, 0 = unlimited, bounds 0..2048):
- `frontend/src/state/settingsDomain.ts:102-107` (`.default(50)`), `:150-158` (section default),
  `:196-204` (`defaultSettings`).
- `internal/storage/model/settings.go:83-93` (`DefaultSettings`, comment names the 50 MB change),
  `:175` bounds; `internal/storage/repos/settings.go:52` read (`LeafValid … InRange(0, 2048)`),
  `:99` upsert.
- `internal/httpclient/options.go:61-66` `normalize` default `50 * 1024 * 1024`; comment requires it
  equal `model.DefaultSettings().Api` field for field.
- Storage is one row per leaf; `GetAll` overlays stored rows on `DefaultSettings()`.
  `SettingsRepo.Set` writes only patched leaves, and the dialog patches only changed leaves
  (`tests/ui/settings-apply-on-save.spec.ts:194-200`: patch is exactly `{api:{maxResponseMb:10}}`).
  So a row for `api.maxResponseMb` exists only if the user changed it.
- Per-request override: `packages/shared/domain/http.ts:340` nullable, `null` = inherit
  (`bridge/http.go:178` `orGlobal`). `RequestSettingsPane.vue:193` shows "Global: N MB".
- No test asserts 50 (`grep` over `tests/`, `internal/**/_test.go`).

Test infra: `tests/ui/fixtures.ts` `relaunch({control})` opens a fresh WebKit page (1440x960) on
the static `frontend/dist`, control plane mocked by `page.route`; `IPC.httpSend` snapshot answers
the send (`tests/ui/http-request.spec.ts:14-40`, `support/apiMode.ts` `httpResponse`,
`openHttpModeAndNewRequest`). Playwright projects: `ui`, `ui-timing`, `ipc-frontend`, `visual`,
`e2e-real`; every root script passes `--project` explicitly (no script or workflow runs the config
unscoped), so a new project runs only when named.

## 2. Decisions

| Item | Decision |
|---|---|
| Root cause fix | `MonacoHost` pending `<pre>` shows at most `PENDING_PREVIEW_CHARS = 16_384` chars, never the full doc. |
| Editor creation | Create model empty, create editor, then fill with `model.setValue(doc)` in the same task (row ask). Initial fill never enters undo history (same as today's `createModel(doc)`). |
| Large doc first paint | Doc > `LARGE_DOC_CHARS = 262_144`: after `loadMonaco()`, await one painted frame (double `requestAnimationFrame`) so the capped preview paints before Monaco work; re-check unmount after the await. Small docs: unchanged synchronous path (no flash on 32 mount sites). |
| External writes | Read-only host: `model.setValue` (no undo copy). Editable host: unchanged `pushEditOperations` with both `pushStackElement`s (§4.7). Guard: track `lastAppliedDoc` + `lastAppliedVersionId`; if `model.getVersionId()` still equals it, compare `doc === lastAppliedDoc` (no `getValue()` allocation), else fall back to `model.getValue()`. `keepSelectionOnExternalSync` branch unchanged. |
| Parse once | One worker job per receive returns format and, when pretty view wants it, the pretty text. No second parse. |
| Off main thread | Formatting runs in a dedicated Web Worker (`?worker`, the import form `packages/workbench/src/editor/monacoEntry.ts:134` already uses). No library: one request type over `postMessage` needs no RPC layer (Comlink would add a dependency for ~20 lines). Worker failure falls back to the same pure functions on the main thread, so correctness never depends on the worker. |
| P21 retention rule | Kept: pretty text is held in a `shallowRef` only while pretty view is selected; switching to Raw drops it; switching back re-requests it. |
| Pretty pending UI | In pretty view, `MonacoHost` is not mounted until the format result arrives (no raw-then-pretty double fill). Body area shows a muted "Formatting response…" line only once pending exceeds 200 ms (VueUse `useTimeoutFn`). Raw view mounts immediately with the raw body; the Pretty/Raw toggle appears when the format is known. |
| Chunked/streamed fill | Not built up front. Monaco has no cheaper bulk-load API; `applyEdits` chunks would fire `onDidChangeContent` per chunk (`repaintRanges`/`updateDebugHook` call `getValue()` each time, O(n²)). Built only under the step 6 rule. |
| Default | `api.maxResponseMb` 50 -> 5 in all four places (TS schema `.default`, TS section default, TS `defaultSettings`, Go `DefaultSettings`) plus `httpclient.normalize`. Bounds stay 0..2048. |
| Stored values | Only the default changes. Users with no stored row get 5 on next launch. A stored explicit value (any value, 50 included) keeps: it is a user choice, indistinguishable from a deliberate 50. No migration. |
| Out of scope | `ResponseDiffDialog.vue` (diff editor, explicit click), gRPC pane, `GrpcRequestView` beautify button, `RawExchangePane` (benefits from the `MonacoHost` change for free). Go-side read path (already capped). |

## 3. Probe (step 1)

Files (new):
- `tests/perf/http-response.spec.ts`: the scenarios.
- `tests/perf/perfProbe.ts`: heartbeat, RSS sampler, load average, summary printer.

Wiring:
- `playwright.config.ts`: project `perf` — `testDir: './tests/perf'`, `browserName: 'webkit'`,
  `fullyParallel: false`, `workers: 1`, `timeout: 600_000`. Not in any existing script.
- Root `package.json`: `"perf:http:studio": "bun run build:studio && playwright test
  --config=apps/kira-studio/playwright.config.ts --project=perf"`. Production build (no debug hooks):
  the 12 MB `data-kira-editor-text` attribute is test-only cost users never pay. Check first that
  the shell boots under the mocks on a production build (`relaunch` reaches `status-bar`, a send
  shows a status chip). If it does not, use `build:test:studio`, and say so in the script comment,
  DEV_ENVIRONMENT and `## Result`. Either way before and after use the same build kind.
- `tsconfig.tests.json` `include`: add `"tests/perf/**/*.ts"`.
- Specs import `test`/`expect` from `../ui/fixtures`, `IPC` from `../ui/support/ipcChannels`,
  `httpResponse`/`openHttpModeAndNewRequest` from `../ui/support/apiMode`. No new mock machinery.

Cases (bodies generated in the spec, deterministic; 1 MB = 1_048_576 bytes, the app's own MB):
- `json`: compact array of objects (`{"id":n,"name":"user-n","email":"user-n@example.com",
  "active":true,"score":12.5,"tags":["a","b"]}`), `Content-Type: application/json`.
- `text-80col`: 79 chars + `\n` per line, `text/plain`.
- `text-short-lines`: ~8 chars + `\n` per line (`line 123\n`-style), `text/plain`.
- `text-1line`: one line, words and spaces, no `\n`, `text/plain`.
- Sizes: 2.4, 5 (new default ceiling) and 12 MB each. 12 cases. The mock bypasses the Go cap, so
  12 MB still measures the viewer.

Per run (fresh `relaunch` per run, `KIRA_PERF_RUNS` runs per case, default 3, median reported):
1. `relaunch({ control: [{ channel: IPC.httpSend, response: httpResponse({ … body, bodyBytes,
   headers }) }] })`, `openHttpModeAndNewRequest`, fill `http-url`. Wait for any `.monaco-editor`
   on the page if the request view mounts one (warm Monaco chunk); record `warm: true|false`.
2. Record `/proc/loadavg` 1-min value (`load1`) and baseline RSS.
3. In page: start heartbeat (`setTimeout(0)` chain logging `performance.now()`), install a
   `MutationObserver` on `[data-testid="http-response-pane"]`, then `t0 = performance.now()` and
   click `[data-testid="http-send"]` from inside `page.evaluate` (no actionability waits in the
   timed window).
4. `firstTextMs`: first moment any body text is in the body area (pending `<pre>` or a
   `.view-line`). `shownMs`: first `.response-body .monaco-host .view-lines .view-line` with
   non-empty text, plus one `requestAnimationFrame` (first paint opportunity). Timeout 120 s ->
   record `timeout`.
5. Keep the heartbeat 1 s past `shown`. `longestBlockMs` = largest heartbeat gap in
   `[t0, shown+1s]`; `tbtMs` = sum of `(gap - 50)` over gaps > 50 ms.
6. RSS (Linux): Node-side sampler every 100 ms sums `VmRSS` from `/proc/<pid>/status` over every
   descendant of the test worker process (`process.pid`; walk `/proc/*/stat` ppid), covering the
   WebKit UI, web and network processes. `rssPeakDeltaMb` = peak during the window minus baseline;
   also `rssPeakMb`. Non-Linux: `n/a`.
7. Print one line per run, `key=value` (DEV_ENVIRONMENT's Go perf-probe convention): `case=json
   size=12 run=1 load1=0.42 warm=true firstTextMs=… shownMs=… longestBlockMs=… tbtMs=…
   rssPeakDeltaMb=… rssPeakMb=…`, then a median summary per case.

Asserts nothing (DEV_ENVIRONMENT "perf probes are opt-in and assert nothing").

## 4. Measuring protocol (quiet machine)

Another chain (`/home/user/kira-studio-c2`) runs CPU-heavy loops on this 4-core box; never touch
it. Before **each** probe invocation:
- Read `/proc/loadavg`. Proceed only when `load1 <= 1.0`. Otherwise wait with a Monitor until-loop
  (`until awk '{exit !($1<=1.0)}' /proc/loadavg; do sleep 30; done`), not foreground `sleep`.
- The probe also logs `load1` per run; a run whose `load1 > 1.0` is discarded and re-run.
- Record the gate reading and the per-run `load1` range in `## Result`.

Before/after must be comparable, so measure them back to back in one quiet window:
- "before" = the probe commit (step 1) in a temporary worktree
  (`git worktree add /home/user/kira-studio-p160-before <probe-sha>`, then
  `sh scripts/prepare-worktree.sh` there), "after" = the phase tip in this checkout.
- Run before, then after, same `KIRA_PERF_RUNS`. Remove the temporary worktree afterwards
  (`git worktree remove`).
- If a quiet window comes right after step 1, also take a first "before" pass then (early signal);
  the back-to-back pass is the one recorded as authoritative.
- WebKit for Playwright: `bunx playwright install webkit` plus the system libs (DEV_ENVIRONMENT).

## 5. Steps and commits

1. **`test(perf): http response viewer probe`** — §3 files, project, script, tsconfig include, and
   the DEV_ENVIRONMENT bullet (§7). Run it once on 2.4 MB json to prove it works (any load; this is
   a smoke run, not a measurement). Commit.
2. **`perf(editor): MonacoHost capped preview, empty create then fill`** — `editor/MonacoHost.vue`:
   - `previewDoc` computed: `doc.length > PENDING_PREVIEW_CHARS ? doc.slice(0, PENDING_PREVIEW_CHARS)
     : doc`; the `<pre>` renders `previewDoc`.
   - `onMounted`: after `loadMonaco()`, large-doc frame yield (§2), `createModel('', lang)`,
     `editor.create(…)`, `model.setValue(props.doc)` with `applyingExternal = true` around it (no
     `update:doc` echo), record `lastAppliedDoc`/`lastAppliedVersionId`, then `pending = false`,
     then the existing wiring. Register `onDidChangeContent` after the fill so the fill does not run
     `repaintRanges`/`scheduleLint` twice; call them once explicitly as today.
   - `applyExternalDoc`: guard and write split per §2; update `lastApplied*` after every write.
   - Constants are named, top of script, one-line comment each (why the number).
   - Verify every `readOnly` mount site still behaves (CodeGraph callers of `MonacoHost`; those
     with `keepSelectionOnExternalSync`). Fast checks per commit. Commit.
3. **`perf(http): format response body once, off the main thread`** — new
   `views/httprequest/prettyBody.worker.ts` (message `{id, body, wantText}` -> `{id, format:
   'json'|'xml'|null, text?}`; logic moved verbatim from `prettyFormat`, incl. the `<…>` bracket
   gate), `views/httprequest/prettyBody.ts` (lazy singleton worker, id -> resolver map; worker
   `error` rejects all pending and drops the singleton so the next call recreates it, same shape as
   `loadMonaco`'s reject-then-retry), `views/httprequest/useResponseBody.ts` composable:
   - inputs: `response`, `responseView`; outputs: `format` (`undefined` while pending), `bodyText`,
     `formatting` (delayed flag for the caption).
   - watch `response` (immediate): base64 -> nothing; else request with `wantText = view ===
     'pretty'`. Sequence id per pane; a result for a superseded id is dropped.
   - watch `responseView`: to raw -> drop pretty text; to pretty with a known non-null format and no
     text -> request text.
   - rejection -> same computation synchronously on the main thread.
   - `ResponsePane.vue`: replace `prettyFormat`/`bodyText` with the composable; toggle `v-if` uses
     `format`; `MonacoHost` `v-if` adds "not pending in pretty view"; caption element uses Tailwind
     utilities (`text-kira-sm text-muted-foreground p-1.5`, the binary note's own classes); update
     the P21 comment block to the new shape (short). `findTargets` keeps reading `bodyText`.
   - Typing: if the frontend tsconfig lacks the `WebWorker` lib, type the worker's `self` locally
     (`self as unknown as DedicatedWorkerGlobalScope` needs the lib; otherwise a minimal local
     interface for `postMessage`/`addEventListener`). No `// @ts-ignore`.
   Commit.
4. **`feat(api): default max response size 5 MB`** — the five values in §1 Settings; update the
   `model/settings.go:83-84` comment (P90's "50 MB" -> P160 5 MB) and the `options.go` coupling stays
   true. Repo-wide grep `maxResponseMb.*50|MaxResponseMb: *50|50 \* 1024 \* 1024` over `apps/` and
   `packages/` returns nothing. Commit.
5. **Full verification** (once): `bun run typecheck`, `bun run lint:all`, `bun run test:unit`,
   `go test ./apps/kira-studio/...`, `bun run test:ui:studio` (all HTTP specs exercise the async
   pretty path: `http-request`, `http-history`, `http-request-body`, `http-raw`,
   `api-ui-consistency`, `collections`, `settings-apply-on-save`). Fix failures in follow-up
   commits, root-caused; a spec that read the pretty body synchronously gets an auto-retrying
   assertion, never a sleep.
6. **Measure** (§4) before and after. Rule: if any **5 MB** case after the fix has median
   `longestBlockMs > 500`, find which part blocks (WebKit timeline or `performance.mark` around
   `setValue` vs. render) and fix in this phase:
   - `setValue`/view-model line breaks dominate -> chunked fill for read-only hosts over
     `LARGE_DOC_CHARS`: append line-aligned ~256 KiB chunks via `model.applyEdits` at the model end,
     yielding a frame between chunks, `applyingExternal` held across the whole fill, `repaintRanges`/
     `scheduleLint`/`updateDebugHook` deferred to the end, a fill generation token cancels on a new
     doc or unmount.
   - wrapping of a single huge line dominates (`text-1line`) -> discuss with the user before
     overriding their `wordWrap` setting; record it, do not silently change it.
   Otherwise record "no further work: 5 MB longest block N ms" in `## Result`.
7. **Docs and close-out** (§7), SPEC row -> **Done.**, `## Result` filled. Commit
   `docs(v2.0): P160 result`.

## 6. Tests

- No new unit test. The worker protocol is one request/response; stale-result handling is one id
  compare; the default is a constant. Nothing meets the complex-logic bar.
- No new UI spec. Existing HTTP specs cover pretty/raw/history behaviour through the new async
  path; `settings-apply-on-save.spec.ts` covers the leaf patch shape (unchanged).
- Go: no test change (`client_test.go` passes explicit `MaxResponseMb`).
- The probe is not a test: opt-in, asserts nothing, never in `ui`/`ui-timing`.

## 7. Docs

- `docs/ARCHITECTURE.md`, UI architecture, next to the P8 ResponsePane paragraph (`:1853`): one
  paragraph — response body formatted once per receive in a worker, pretty text retained only in
  pretty view, viewer not mounted until formatted. Next to the Monaco stack row/`MonacoHost`
  facts: pending preview capped at 16 384 chars (full-doc `<pre>` forced a layout of the whole text
  inside `editor.create`'s size measure), model created empty then filled, read-only external
  writes use `setValue` (no undo copy). Api settings default `maxResponseMb` 5 (stored explicit
  values kept, no migration).
- `docs/ARCHITECTURE.md` Testing (`:4251` project list): add `perf` (opt-in, serial, not in any
  suite script) and `tests/perf/` in the suite overview line.
- `docs/DEV_ENVIRONMENT.md`, next to "The perf probes are opt-in and assert nothing" (`:168`): how
  to run (`bun run perf:http:studio`, `KIRA_PERF_RUNS`), which build, the `load1 <= 1.0` gate,
  RSS is Linux-only and sums all browser processes, output format. Note that `build:studio`
  overwrites `frontend/dist`; `test:ui:studio` rebuilds the test bundle itself.
- `docs/v2.0/SPEC.md` P160 row: status **Done.** with a one-line summary, original ask kept
  ("Original ask: …", P158 precedent); drop the "commit it with or before this phase" note.
- No `docs/PERF.md` section: no stated budget; this plan's `## Result` is the record.

## 8. Streams

One sequential implementer. Steps 2 and 3 both decide what `ResponsePane` mounts and when; step 3's
"don't mount while pending" depends on step 2's fill semantics; step 6 depends on all. No
independent split exists.

## 9. End checks (orchestrator)

- `git log` shows steps 1-4 (+ fixes) and the docs commit, all hooks green, no `--no-verify`.
- `tests/perf/http-response.spec.ts` and `tests/perf/perfProbe.ts` committed; `perf` project
  present; `bun run test:ui:studio` does not run it (`--list` check).
- `grep -n "{{ doc }}" frontend/src/editor/MonacoHost.vue` empty; `createModel('',` present;
  `setValue` used for read-only writes.
- `ResponsePane.vue` has no `beautifyJson`/`beautifyXml` import; worker file imports them.
- Default grep (step 4) clean; `DefaultSettings().Api.MaxResponseMb == 5` and
  `normalize` default `5 * 1024 * 1024`.
- `## Result` holds before/after medians for all 12 cases (at least json, text-80col,
  text-short-lines, text-1line at 2.4 and 12 MB, the row's acceptance), load readings, build kind,
  and the step 6 verdict.
- No edit under `/home/user/kira-studio-c2`; temporary before-worktree removed.

## Result

(Implementer fills: commits; build kind; per case before -> after medians of `firstTextMs`,
`shownMs`, `longestBlockMs`, `tbtMs`, `rssPeakDeltaMb`; load1 gate and ranges; step 6 verdict;
verification summary.)
