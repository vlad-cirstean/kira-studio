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
  DEV_ENVIRONMENT and `## Result

Commits (`6dce6fd6..`):
  0ba95c4b test: update settings Api visual baseline for 5 MB default
  18a5cff5 perf(editor): chunked fill for large read-only docs
  97a6a8bd docs: P160 architecture and dev environment notes
  9520dd86 fix(editor): MonacoHost preview via v-text for lint
  3022d60b feat(api): default max response size 5 MB
  1ec1f7b3 perf(http): format response body once, off the main thread
  c6922518 perf(editor): MonacoHost capped preview, empty create then fill
  7d35e10c test(perf): http response viewer probe

Build: production (`build:studio`); the shell boots under the mocks, no `build:test` fallback. Probe
3 runs per case, median. Before = probe commit `7d35e10c` in a temp worktree (removed), after =
phase tip, run back to back. Gate readings (`/proc/loadavg` 1-min) at start of the window: 0.86
(before), 0.97 (after). Per-run `load1` 0.7..1.7 before, 1.0..1.9 after; the probe's own browser
adds ~1.0, the other chain was idle during the window. An earlier pass (before the chunked fill,
load 0.9..2.2) is superseded.

Before -> after medians:

| case (MB) | firstTextMs | shownMs | longestBlockMs | tbtMs | rssPeakDeltaMb |
|---|---|---|---|---|---|
| json 2.4 | 547 -> 475 | 2703 -> 973 | 2489 -> 316 | 2586 -> 899 | 418 -> 292 |
| json 5 | 1183 -> 786 | 4296 -> 1326 | 3871 -> 410 | 4128 -> 910 | 811 -> 393 |
| json 12 | 2215 -> 1810 | 9005 -> 2396 | 8152 -> 325 | 9001 -> 1011 | 1736 -> 617 |
| text-80col 2.4 | 128 -> 135 | 1517 -> 591 | 1369 -> 303 | 1342 -> 335 | 130 -> 132 |
| text-80col 5 | 298 -> 289 | 2339 -> 752 | 2054 -> 276 | 2097 -> 370 | 163 -> 158 |
| text-80col 12 | 535 -> 571 | 5511 -> 1068 | 4974 -> 309 | 5201 -> 478 | 310 -> 183 |
| text-short-lines 2.4 | 152 -> 155 | 2261 -> 660 | 2092 -> 294 | 2243 -> 750 | 351 -> 223 |
| text-short-lines 5 | 291 -> 332 | 3870 -> 812 | 3552 -> 278 | 3951 -> 876 | 587 -> 216 |
| text-short-lines 12 | 618 -> 624 | 8630 -> 1130 | 7987 -> 299 | 8139 -> 964 | 861 -> 272 |
| text-1line 2.4 | 120 -> 140 | 1988 -> 597 | 1826 -> 232 | 1802 -> 358 | 174 -> 107 |
| text-1line 5 | 199 -> 254 | 3501 -> 693 | 3262 -> 267 | 3235 -> 469 | 283 -> 130 |
| text-1line 12 | 488 -> 527 | 8365 -> 985 | 7826 -> 309 | 7874 -> 586 | 316 -> 145 |

Step 6 verdict: first after-pass 5 MB json longest block 1447 ms, text-short-lines 1065 ms (> 500).
`performance.mark`-style timing showed `model.setValue` of the 8.2 M-char pretty body took 1131 ms
(editor create 143 ms). Built the chunked fill: read-only docs over 256 KiB append line-aligned
256 KiB chunks via `applyEdits`, a frame apart, generation token cancels, `repaintRanges`/lint/
debug hook deferred to the end. Final: every 5 MB case longest block <= 410 ms. `text-1line` needed
no `wordWrap` override.

Deviation: bodies up to 64 K chars format inline on the main thread (`SYNC_BODY_CHARS`), not in the
worker, to avoid a pending flash and keep existing specs synchronous. Larger bodies go to the worker.

Verification: `go build/vet/test ./apps/kira-studio/...` clean; `lint:all` 0; `test:unit` 1764 pass;
`test:ui:studio` 303 pass, 1 fail (`budgets.spec.ts` interaction budgets, grid scroll p50/max, 13 vs 12
and 51 vs 50 ms). It fails the same way on the pre-phase tree (54 vs 50), touches no code this phase
changed, and only misses under this shared box's load. `perf.spec.ts` flaked once at 80-83 vs 80
under load, passes alone (3/3). `test:visual:studio`: settings Api baseline re-captured (14 px, the
"50" -> "5" digit), 14 pass.
