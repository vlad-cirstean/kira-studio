# P168 Part 12 findings: Studio console, editor, parse worker, per-kind views

Plan: `P168-part12-console.md`. Base `8b20119`; HEAD reviewed `54b5c10` (plan commit only on top).
Reviewer reports only; fixer follows plan §8. Paths as in plan (`SF`, `ST`, `SD`, `PW`, …).

## Checks (baseline at `54b5c10`)

- `bun test` 40 own unit specs together: 310 pass, 0 fail.
- Each spec alone: 39 green, 1 red: `document-console-row-menu-lazy-snapshot.spec.ts` 3 fail
  (`getActivePinia()` from `documents/menu.ts:59`). Reported as a finding (block 7).
- `bun run typecheck:web:studio`: clean. `bun run typecheck:unit:studio`: clean.
- `bunx biome check` over own source paths (124 files): clean.

## Findings

### Block 1: parse worker and editor core

**F1. Aborted in-flight parse job re-runs inline on the main thread after a worker error.** Low.
Verified (scratch probe, fake worker: abort job, then fire worker `error`; handler ran inline once).
`SF/workers/parse/client.ts:71-77` (`onWorkerFailure`), `:49-64` (`settle`/`runInline`).
- Scenario: Copy all on a multi-MB console result posts `ejson.copyAll`; user closes the tab (scope
  abort; `running` stays set, queue empty, worker not killed). The worker then dies (OOM on that
  same input, or any error). `onWorkerFailure` re-queues `running` and runs it inline: the
  multi-MB copy/format runs synchronously on the main thread for a caller that is gone, freezing UI.
  `settle` also runs `run` for a job already aborted before the microtask starts.
- Fix: in `onWorkerFailure` skip jobs with `aborted` (`pending.filter((j) => !j.aborted)`); in
  `settle` check `job.aborted` before calling `run`. Add the abort-then-error case to
  `parse-worker-client.spec.ts` (concurrency ordering: qualifies).

**F2. Deep nesting throws `RangeError` out of the JSON/XML scanners; inline callers crash, worker
callers degrade.** Medium. Verified (scratch probe under Bun/JSC: `'['.repeat(20000)+…` 40 KB
throws from `beautifyJson` and `scanJson`; `<a>` x 100 000 throws from `beautifyXml`; V8 in
WebView2 overflows earlier).
`SF/beautify.ts:73-133` (recursive `parseJsonValue` via `parseContainer`), `:371-380`
(`tryParseXml` rethrows non-`XmlScanError`), `:391-428` (recursive XML render);
`SF/views/shared/document/rawTree.ts:208-224` (`tryParse` rethrows anything not `ErrorClass`).
- Scenario: an HTTP response body `[[[[…]]]]` 20 000 deep (40 KB, under `INLINE_CHARS`) hits
  `useResponseBody.request` inline `parseInline('body.format', …)` with no catch: the watcher throws,
  response pane breaks. Same body above 64 KiB goes to the worker, posts `ok:false`, and degrades to
  `format: null`. Inline vs worker parity broken; cell editor `detect.ts:63,83`/`validate.ts:18,25`
  (`scanJson`/`scanXml`) throw the same way on a JSON/XML DB value. Console Copy all is not
  exposed in practice (Mongo caps document nesting at 100).
- Fix: catch `RangeError` in `tryParse` (Part 11 file, editable in Stream C, state why) and in
  `tryParseXml`, returning `{ ok: false, offset/reason: 'nesting too deep' }`; wrap the XML render
  (`collectXmlIndentedLines`/`renderXmlCompact`) the same way inside `beautifyXml`. One unit test
  over the depth guard (parser edge: qualifies).

**F3. `MonacoHost` `filling` flag stays `true` after a chunked read-only fill is cancelled by the
editable external-write path.** Low. Code-read.
`SF/editor/MonacoHost.vue:439-483` (`fillModel` `finally` resets flags only when
`fillCtrl === ctrl`), `:594-606` (editable `applyExternalDoc`: `cancelFill()` nulls `fillCtrl`,
never resets `filling`), `:505-506` (`onDidChangeContent` returns early while `filling`).
- Scenario: cell editor dock (`CellEditorView.vue:668-676`, `:read-only="!isEditable"`, one host
  instance reused across cells) shows a read-only cell over 256 KiB chars (chunked fill, several
  frames). User selects an editable grid cell inside that window: `doc` and `readOnly` change in the
  same flush, `applyExternalDoc` takes the editable branch, `cancelFill()` aborts the fill, whose
  `finally` sees `fillCtrl !== ctrl` and skips the reset. `filling` stays `true`: every later
  keystroke skips `emit('update:doc')`, lint and range repaint. The edit never reaches the owner
  (Save sees no change).
- Fix: in the editable branch reset `filling = false` after `cancelFill()` (or make `cancelFill`
  reset `filling`/`applyingExternal` itself).

Block 1 otherwise clean:
- `client.ts` abort of running job with empty queue: next `run` kills the worker in `pump`
  (`:100-104`), no blocking. Stale reply (`:84`) cannot strand the queue: only the running job is
  ever posted to a live worker, and replies from a killed worker are dropped by `w !== worker`.
  Dropped suspect.
- `useParseWorker` scope abort and `runLatest` key reuse correct. `AbortSignal.any` available on
  both WebViews.
- Worker in built app: `dist/assets/parse.worker-*.js` is an IIFE with `sql-formatter` inlined (no
  runtime `import()`), so `console.format` works in the worker under `wails://`. Verified by
  inspecting the bundle.
- `chunkedText.ts` boundaries (surrogate, CRLF, line-aligned) correct; `pumpChunks` contract holds.
- `paintOverlayHtml` escapes every text run; class names come only from `mtkN` and internal
  range classes. `hoverInfo.ts` escape and fence correct. `findRanges` regex cap and zero-width
  guard hold; cache is bounded (4).
- `MonacoHost` mount/unmount ordering, provider model scoping, lint timer guard, language/readOnly
  changes during import window: correct. Scoped `<style>` is the named exception.
