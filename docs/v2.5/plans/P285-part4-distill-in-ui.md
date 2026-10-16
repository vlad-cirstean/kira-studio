# P285 Part 4 plan: distill in the UI

Ask (SPEC row P285 Part 4, decisions final there): Part 2 `distill` also available in Kira Space UI. Paste
text or pick a file or selection; get terse atomic lines back; copy them; optionally send them to import or
store through the normal memory path. Read-only by itself. Shows cost and size before and after (chars,
runes/3 tokens). Same core as the MCP tool through a bridge service. Cancellable. Error states in the
catalog. shadcn-vue, Tailwind, TanStack Query; placed with the memory panel. Tests split at the IPC
boundary: Go flow test, UI spec, visual baseline (sandbox-recorded), one real-`claude` row. Site memory
page updated. Opus plan, Sonnet implementer, serial test-and-fix, close-out. Spend: verification only,
cap 1 USD.

SPEC names the plan `plans/P285-part4-distill-ui.md`; this file is the plan. Close-out corrects the SPEC
row's plan path to `plans/P285-part4-distill-in-ui.md`.

Base: `v2.0` at `3dd4a9441` (P285 Part 3 close-out). Discovery ran through `codegraph_explore`:
`importer.Distiller`/`Distill`/`DistillRequest`/`DistillResult`/`distillSource`/`distillMode`/limits,
`mcpserver` `addDistillTool`/`Distiller`/`Options`/`Build`, `memory.Service`/`Store`/`Prepare`,
`MemoryPanel`/`MemoryStart`/`ImportView`/`ImportMenu`/`ImportStatus`/`AddMemoryDialog`,
`useMemoryUiStore`/`useImportUiStore`, `queries.ts`/`importQueries.ts`, `MemoryControl`/`useMemoryModule`,
`PanelHeader`/`usePanelHeaderSearch`, `errorText`/`toCodedError`/`ipcerr`, `createModeStore`,
`SemanticModelSection`/`useModelDownloadsStore`, `askReviewAgent`. Targeted reads (not indexed, or not
code): `apps/kira-space/internal/bridge/{memory,memoryimport,files,events}.go`, `appwire.go`,
`appshell/dialogs.go`, `flowharness/shellfakes.go`, `memoryflow/distill_test.go`, `tests/claude/memory_test.go`,
`frontend/src/bridge/memoryControl.ts`, `views/repo/RepoFileView.vue`, `tests/visual/settings.spec.ts`,
`playwright.config.ts`, `fakeagent.PromptRule`, `memory/claude.go` `claudeArgs`, `importer/tokens.go`,
`en.json` memory keys, ARCHITECTURE distill bullet, DEV_ENVIRONMENT real-`claude` and contract sections,
site `space/memory.mdx`.

## 1. Facts the design rests on

- Core: `importer.Distiller{Runner, Prompts}.Distill(ctx, DistillRequest{Text, Path, Mode})` returns
  `DistillResult{Lines, CostUSD, Chunks, InRunes, OutRunes}`. Cancellable through ctx (errgroup ctx feeds
  every `distillCall`). Limits: `MaxDistillRunes` 120 000 (exported), `maxDistillChunks` 16,
  `distillSpendCapUSD` 2.00 (unexported). Errors: `invalid(...)` wraps `memory.ErrInvalid` with English
  text; spend cap is a plain `fmt.Errorf`. No progress hook. `memorycli.Run` builds the MCP one.
- Bridge: `MemoryService` owns `prompts`, the lazy `memory.Service`, `importer()` engine. Wails cancels a
  bound call's ctx on `call.cancel()`; `memoryControl.memoryStore` wires `AbortSignal` that way.
  `MemoryImportService` is a separate bound service ("one concern"); same split fits distill.
  `Dialogs` has `OpenDirectory`, `OpenFiles` only; `internal/shell.Dialogs` already has `OpenFile`.
- Errors: `ipcerr.T(code, key, vars)` resolves a `backend.*` catalog key in Go; `errorText` shows
  `message`. Codes `E_CONFLICT`, `E_CANCELLED` exist.
- UI: Memory module lives in `packages/workbench/src/memory`, mounted by Space only (`App.vue` provides
  `memoryModuleKey`). Main area switches on `useImportUiStore().view` (`'memory' | 'imports'`), set from 5
  sites. Header actions: Add (`memory-add`), `ImportMenu`. `ImportConfirmDialog` mounts in `MemoryPanel`
  on `importUi.confirmJobId`. `AddMemoryDialog` stores one textarea item with `MANUAL_REASON` through
  `useStoreMemory`, challenge/resubmit flow, `MAX_TEXT` 1000. `memory.MaxItems` 20.
- Abort handle precedent: `useModelDownloadsStore` holds the `AbortController` so a remount can cancel.
- Monaco action precedent: `attachAskReviewAgent` (`addAction`, selection, teardown).
- Tokens: `importer.EstimateTokens(s) = (runes+2)/3`.
- Tests: flow harness fake `claude` (`fakeagent.PromptRule{System, WaitFile, Emit}`), `app.Contract`
  fixtures read by UI specs, coverage gate fails on a bound method with no flow call; visual project is
  WebKit with `pin-fonts.css`; real row `TestMemoryDistill` already covers the MCP tool.

## 2. Decisions (final)

- D1. New bound service `bridge.MemoryDistillService` in `apps/kira-space/internal/bridge/memorydistill.go`,
  built from `*MemoryService` plus `Dialogs`, registered in `appwire` (`w.MemoryDistill`). Why: one bound
  service per concern, same as `MemoryImportService`; shares prompts and engine.
- D2. Core stays `importer.Distiller`; bridge builds `importer.Distiller{Runner: memory.NewCLIRunner(),
  Prompts: mem.prompts}` per call. Why: SPEC "same core"; no second pipeline.
- D3. Core gains `DistillRequest.Progress func(DistillProgress)` (`DistillProgress{Done, Total int; CostUSD
  float64}`), called once after chunking (`Done` 0) and once per finished chunk under the existing mutex.
  nil for MCP. Why: progress needs
  chunk granularity only the core sees; optional field keeps the MCP path unchanged.
- D4. Core gains `*DistillError{Reason string; Vars map[string]string; msg string}` for `tooLong`,
  `tooManyParts`, `unreadable`, `spendCap`; `Error()` returns today's exact English text; `Unwrap` returns
  `memory.ErrInvalid` (not for `spendCap`, as today). Export `MaxDistillChunks`, `DistillSpendCapUSD`.
  Why: bridge maps reasons to catalog keys without parsing text; MCP output and `TestMcpDistill` unchanged.
- D5. Bridge API (Wails methods; JSON camelCase):
  - `Distill(ctx, MemoryDistillArgs{RequestID, Text, Path, Mode}) (MemoryDistillResult, error)`. Exactly
    one of `Text`/`Path` (else `ipcerr.Contract`); `Path` absolute; `RequestID` non-empty, at most 64 chars.
    Result `{lines, costUsd, chunks, inChars, outChars, inTokens, outTokens}`: `inChars` = core `InRunes`,
    `outChars` = runes of `strings.Join(lines, "\n")` (what Copy puts on the clipboard), tokens via
    `importer.EstimateTokens` on the same strings. `lines` never nil.
  - `Limits() MemoryDistillLimits{maxChars, maxParts, spendCapUsd, storeMaxLines}` from the exported core
    constants and `memory.MaxItems`. Why: UI shows and pre-checks limits without copying constants.
  - `Choose() (MemoryDistillChoice{canceled, path}, error)`: native single-file picker,
    `Dialogs.OpenFile` (new seam method; appshell adapts `shell.Dialogs.OpenFile`; flow fake gets a `file`
    queue), filter `importFilter`, title `backend.dialog.distillFile.title`. Why: same document kinds as
    import; code text reaches distill through selection or paste.
  - `ToImport(MemoryDistillImportArgs{lines, source}) (importer.Job, error)`: writes
    `<memory.Home()>/distilled/distilled-<UTC 20060102-150405>-<4 hex>.md` (dir 0700, file 0600):
    `# Distilled from <source>` (or `# Distilled text` when source empty), blank line, one `- line` per line;
    then `engine.Create(importer.CreateArgs{Paths: [file]})`. 1 to 640 lines (16 x 40), each non-empty;
    else contract error. Why: the normal import path (scan, confirm, provenance, job list) with no new
    engine API; the file stays as the job's source for retry and provenance.
- D6. Progress push: channel `kira:memory:distill` (`bridge.ChannelMemoryDistill`, `CHANNEL.memoryDistill`),
  `Emit` app-wide, payload `{requestId, done, total, costUsd}`; first event `{done: 0, total: chunks}`
  before any call starts (D3). The UI filters on its own `requestId`. At most 17 events per call, so no coalescer.
  Why: payload-bearing event avoids a status query for a short-lived call; requestId separates windows.
- D7. One distill at a time app-wide: `distilling sync.Mutex` `TryLock`, else `ipcerr.T(CodeConflict,
  "backend.space.memory.distill.busy.body")`. Why: spend control; UI shows the busy error.
- D8. Error mapping in the bridge, in order: `ctx.Err() != nil` -> `ipcerr.T(CodeCancelled,
  "backend.space.memory.distill.cancelled.body")`; `*DistillError` -> `ipcerr.T(CodeBadRequest,
  "backend.space.memory.distill.<reason>.body", Vars)`; else existing `memoryErr` (Claude CLI sentinels keep
  their English text, as Add memory and import show them). Vars: `tooLong{count,max}`,
  `tooManyParts{count,max}`, `unreadable{path,reason}`, `spendCap{spent,cap}` (2 decimals).
- D9. Read-only: Distill writes nothing to `memory.db`, emits no `ChannelMemoryChanged`. Only `ToImport`
  creates a job, and only on the user's click; storing goes through `MemoryService.Store` (gate).
- D10. Main-area view moves from `useImportUiStore` to `useMemoryUiStore`: `view: 'memory' | 'imports' |
  'distill'`; the 5 call sites update. Why: the main-area switch is module UI state, not import state;
  adding `distill` to the import store would give it a second concern (CLAUDE.md one store, one concern).
- D11. New Pinia store `useDistillUiStore` (`packages/workbench/src/memory/distill/distillStore.ts`):
  draft `source: 'text' | 'file'`, `text`, `path`, `origin` (`{path, start, end} | null` for a selection),
  `mode: 'facts' | 'instructions'`, `requestId`, `progress`, `result` (`MemoryDistillResult | null`),
  `selected` (`Set` of line indexes; default all on a new result), plus `begin()/cancel()/end()` holding the
  `AbortController` (non-reactive), `openWith({text, origin})`. Why: draft and result must survive a mode
  switch (MemoryStart unmounts); the abort handle follows `useModelDownloadsStore`.
- D12. Server state through TanStack Query (`distill/distillQueries.ts`, key `['memory', 'distill', ...]`):
  `useDistillLimits()` query (`staleTime: Infinity`); mutations `useDistill()` (vars carry `signal`;
  `onSuccess` writes the store result), `useChooseDistillFile()`, `useDistillToImport()` (`onSettled`
  invalidates `['memory', 'import']`); `useDistillProgress()` subscribes `onMemoryDistill` with
  `tryOnScopeDispose`, writes `progress` when `requestId` matches. Why: CLAUDE.md TanStack for bridge calls.
- D13. `MemoryControl` gains `memoryDistill(args, signal?)`, `memoryDistillLimits()`, `memoryDistillChoose()`,
  `memoryDistillToImport(lines, source)`, `onMemoryDistill(cb)`. Zod schemas in
  `packages/shared/domain/memoryDistill.ts`; `memoryControl.ts` parses at the edge and wires `signal` to
  `call.cancel()` as `memoryStore` does.
- D14. Placement: `DistillView.vue` renders in the Memory main area when `view === 'distill'` (MemoryStart
  branch beside `ImportView`). Entry: panel header `TooltipIconButton` (`memory-distill`, codicon
  `sparkle`, verify the name exists in the codicon set; label `memory.distill.open.label`) between Add and
  `ImportMenu`; selecting a memory sets `view = 'memory'` as today. Why: follows `ImportView` (main area,
  Back button, panel stays for search).
- D15. Selection: Space `RepoFileView` Monaco action `Distill selection` (`views/repo/distillSelection.ts`,
  shaped like `attachAskReviewAgent`; `precondition: 'editorHasSelection'`, `contextMenuGroupId:
  'navigation'`). Run: `getModel().getValueInRange(selection)`, `distillUi.openWith({text, origin: {path,
  start, end}})`, `memoryUi.view = 'distill'`, `useModeStore().setMode('memory')`. Diff views get no
  action. Why: the file view is the one place Space shows selectable source text; diffs mix two versions.
- D16. View layout (Tailwind utilities, shadcn-vue only; no scoped `<style>`):
  - `PanelBar`: Back (`distill-back`, existing `memory.import.back.label` "Back to memories"), source
    `SecondaryTabs` segmented Text | File, mode segmented Facts | Instructions (mode description as hint).
  - Input: Text -> `Textarea` (`distill-input`), live size line `{chars} characters · about {tokens}
    tokens` computed client-side with the same `(runes+2)/3` formula in `distill/size.ts` (comment names the
    Go source), red hint when over `limits.maxChars`; origin badge when from a selection
    (`{path} lines {start}-{end}`, clears on edit). File -> `Choose file…` button and chosen path
    (`TruncatedText`); sizes appear with the result (no pre-read). Why: one read, result is authoritative.
  - Run: `Distill` (`distill-run`, disabled while empty, over limit or busy); while running a `Spinner`,
    `Part {done} of {total} · {cost}` and `Cancel` (`distill-cancel`).
  - Result (`distill-result`): summary line `{inChars} -> {outChars} characters ({percent}) · {inTokens}
    -> {outTokens} tokens · {cost} · {parts}`; lines as rows with `Checkbox` (`distill-line-<i>`), select
    all; actions `Copy` (`distill-copy`, `copyAndAnnounce` of selected lines joined by `\n`), `Store…`
    (`distill-store`, disabled above `storeMaxLines` with hint), `Import as document…` (`distill-import`).
    Empty result -> `EmptyState` `memory.distill.result.empty`.
  - Errors: `Alert variant="error"` (`distill-error`) with `errorText`; cancel shows
    `memory.distill.cancelled.status` with the cost of finished parts, not an error.
- D17. Store path: `AddMemoryDialog` gains optional props `lines?: string[]` and `source?: string`. With
  `lines`, the textarea is replaced by a read-only list; items = one per line, reason
  `Distilled by the user from {source} in the Memory module.` (English constant beside `MANUAL_REASON`,
  stored data, not UI); scope field, challenge and resubmit unchanged. Why: reuses the gate flow and the
  challenge UI; no second store dialog.
- D18. Import path: `Import as document…` calls `ToImport(selected lines, source)`, then sets
  `importUi.confirmJobId = job.id`; the existing `ImportConfirmDialog` takes over (origin, scope, write
  doc, start). `source` = file path, `path:start-end` for a selection, empty for pasted text.
- D19. Catalog (`packages/theme/src/i18n/en.json`): UI keys under `memory.distill.*` (open, source
  tabs, mode labels and descriptions, input placeholder, size, over-limit, origin, choose file, run,
  progress, cancel, cancelled, result summary, empty, select all, copy, copied announce, store, store limit
  hint, import); backend keys `backend.space.memory.distill.{busy,cancelled,tooLong,tooManyParts,unreadable,
  spendCap}.body`, `backend.dialog.distillFile.title`. Follow the existing suffix rules; the catalog checks
  must stay green.
- D20. No change to the distill prompt, the MCP tool, limits or spend cap. Why: Part 4 is UI only.

Out of scope: Kira Studio (no Memory module), phone app, DocShot screenshots, cleanup of
`<memory home>/distilled/` files (documented, kept as import sources).

## 3. Tests (split at the IPC boundary)

Go flow, `apps/kira-space/internal/flows/memoryflow/distill_test.go` (new tests beside the MCP ones; reuse
`distillAnswer`, `sections`, `distillFiles`):

- `TestBridgeDistill`: text in -> 2 lines, `costUsd`, `chunks` 1, chars and tokens; progress events on
  `kira:memory:distill` with the request id (`done` 0 then 1, `total` 1); no `ChannelMemoryChanged`,
  `Recent` empty. Path from `Choose` (fake `file` queue) -> two-chunk result in source order. `Limits`
  values. Errors: over limit -> `E_BAD_REQUEST` with the catalog text; text and path both -> contract;
  relative path -> contract; second concurrent call (first held by `WaitFile`) -> `E_CONFLICT`.
  Contracts `memory-distill`: `MemoryDistillService.Distill#done`, `MemoryDistillService.Limits`, progress
  payload `kira:memory:distill#progress`.
- `TestBridgeDistillCancel`: fake `claude` blocks on `WaitFile`; cancel ctx after the `.args` file appears;
  `E_CANCELLED`; no further `claude` calls; lock released (next call succeeds).
- `TestBridgeDistillSpendCap`: 2.50 USD per chunk over 8 sections -> `E_BAD_REQUEST`, spend-cap catalog text.
- `TestBridgeDistillToImport`: file written under `<memory home>/distilled/` with heading and bullets; job
  created (channel ui), reaches awaiting; bad input (0 lines, empty line) -> contract. Contract
  `MemoryDistillService.ToImport#job`.
- Coverage gate: every new bound method has a flow call; no exemption.

UI spec, `apps/kira-space/tests/ui/memory-distill.spec.ts` (mocks from the contracts above):

- Open from header; paste text; size line; run; progress push shows `Part 1 of 1`; result summary, lines;
  Copy puts selected lines on the clipboard (follow an existing clipboard-reading spec).
- Cancel: Distill call held; Cancel -> call cancelled (assert the mock saw the cancel), cancelled status.
- Error: over-limit button state from `Limits`; mocked `E_BAD_REQUEST` -> `distill-error` text.
- Store: select 2 lines -> `Store…` -> dialog lists 2 items -> `MemoryService.Store` called with 2 items
  and the distilled reason. Import: `Import as document…` -> `ToImport` args -> confirm dialog opens.
- File: `Choose` mock -> path shown -> `Distill` sent with `path`.
- Selection: in the repo file view fixture, select lines, run `Distill selection` -> Memory mode, distill
  view, text and origin badge. Reuse the existing repo-file mock setup; if none can open a file view,
  cover the store's `openWith` path through the header instead and say so in the result section.
- Back returns to the memory view; `view` survives a mode switch.

Visual: `apps/kira-space/tests/visual/memory.spec.ts`, baseline `memory-distill-result.png` (distill view
with a mocked result, two lines selected). Record in the sandbox with `--update-snapshots`; commit the PNG.

Real `claude` (one row): `TestMemoryDistillBridge` in `apps/kira-space/tests/claude/memory_test.go`:
`app.W.MemoryDistill.Distill` on a 4-sentence text (the `deploy.md` text of `TestMemoryDistill`); lines
non-empty, `costUsd` above 0 and at most 0.50, `chunks` 1, nothing stored, no memory-changed event.
DEV_ENVIRONMENT: add `apps/kira-space/internal/bridge/memorydistill.go` to the Memory MCP row and
`TestMemoryDistillBridge` to that row, the import/ingest row and the prompt-registry superset.

## 4. Commits (one sequential Sonnet implementer; each commit passes hooks)

1. `refactor(memory): main-area view in the memory UI store` (D10). Typecheck, lint, existing memory UI
   specs (`memory-module`, `memory-import`) since testids are unchanged.
2. `feat(memory): distill progress and typed limit errors` (D3, D4). `importer/distill.go`; MCP texts
   unchanged; `go test ./internal/memory/...` and `TestMcpDistill*` green.
3. `feat(space): memory distill bridge service` (D1, D2, D5 to D9, D19 backend keys). `memorydistill.go`,
   `Dialogs.OpenFile` (bridge, appshell, flow fake), appwire, channel constant (Go and
   `packages/shared/protocol/events.ts`), bindings via `wails3 task common:generate:bindings`, flow tests and
   contracts (`KIRA_CONTRACT=write`, then rerun `-count=2`).
4. `feat(memory): distill view in the Memory module` (D11 to D14, D16 to D19 UI keys). Domain schema,
   control, queries, store, `DistillView.vue` (split into `DistillInput.vue`/`DistillResult.vue` only if it
   passes about 250 lines), header button, `AddMemoryDialog` lines mode, Space `memoryControl.ts`,
   `ipcChannels.ts`/`mockRuntime.ts` entries.
5. `feat(space): distill selection from the file view` (D15).
6. `test(space): distill UI spec and visual baseline`.
7. `test(space): real claude distill bridge row` (compile check `bun run lint:claude`, no spend yet).
8. `docs: distill in the Memory module` (section 5).
9. Verification (section 6), fixes as `fix(...)` commits, then `docs: P285 part 4 close-out`: result
   section in this file, SPEC row status and plan path, spend.

Resume rule: on restart, read `git log` from `3dd4a9441`; the last landed commit number above is the
resume point. A half-done commit is redone from its first file, never mixed into the next.

## 5. Docs

- `site/src/content/docs/docs/space/memory.mdx`: section "Condense text with distill" gains the UI: open
  from the header, paste, choose a file or `Distill selection` in a file view, Facts or Instructions, cost
  and sizes, Cancel (finished parts are charged), Copy, Store (up to 20 lines, gate applies), Import as
  document (saved under the memory home, then the normal import confirm). Keep the MCP paragraph. Add
  `packages/workbench/src/memory/distill` and `apps/kira-space/internal/bridge/memorydistill.go` to
  `sources`. "Where data lives" gains `distilled/`.
- `docs/ARCHITECTURE.md`: distill bullet (P285 Part 2) gains a Part 4 sentence block: bridge service and
  methods, progress channel and payload, one-at-a-time lock, error mapping, `ToImport` file location,
  store/import routing, view state in `memoryUi`, Pinia/TanStack split. Memory data-location list gains
  `distilled/`.
- `docs/DEV_ENVIRONMENT.md`: real-`claude` rows (section 3), measured spend of the new row.

## 6. Verification (serial, once near the end)

- Fast per commit: `bun run typecheck`, `bun run lint`, `go build ./...`, `go vet` on touched packages.
- Go flows: `bun run test:flows:space -run 'Distill'`, then the whole `memoryflow` package and the
  coverage package.
- UI: `memory-distill`, `memory-module`, `memory-import`, `memory-provenance` specs (project `ui`); repo
  file view specs touched by D15.
- Visual: `memory.spec.ts` (record), then rerun without update to confirm stable; `settings.spec.ts`
  unaffected.
- Real `claude`, `-count=1`: `bun run test:claude:space -run 'TestMemoryDistill|TestMemoryDistillBridge'`,
  then `-run 'TestMemoryImport|TestMemoryIngest'` (core file touched). Expected about 0.3 USD total. Read the
  printed spend after each run; stop and report before any run that could pass 1 USD in total.
- Site: site build and its link check.

## 7. Implementer prompt notes (for the orchestrator)

- Carry this file, SPEC row P285 Part 4, CLAUDE.md frontend and test rules, and the Part 2 plan section on
  D13 to D16 (distill limits and API).
- Commits per section 4; never `--no-verify` as a finish; fix any red hook on the spot.
- Executing named steps needs no CodeGraph; any open question about callers or blast radius (for example
  the 5 `view` sites, `AddMemoryDialog` callers) goes through `codegraph_explore` first.
- Result section must state: real spend, contract keys written, whether the selection UI test ran against
  the file view, and any deviation from these decisions with its reason.

## 8. Result

- Real spend: 0.0051 USD (`TestMemoryDistill|TestMemoryDistillBridge`) + 0.0055 USD (`TestMemoryImport|TestMemoryIngest`). Under 1 USD cap.
- Contract keys written (`memory-distill.json`): `MemoryDistillService.Distill#done`, `MemoryDistillService.Limits`, `MemoryDistillService.ToImport#job`, `kira:memory:distill#progress`.
- Selection UI test ran against real repo file view (Monaco action via F1 palette, Home then Shift+End).
- Verified: `memoryflow` + `coverage` Go tests; UI specs `memory-distill`, `memory-module`, `memory-import`, `memory-provenance`, `repo-workspace`; visual `memory`, `settings`; site build.
- Deviations:
  - Progress text "Parts done: {done} of {total} · {cost}", not "Part 1 of 1". Reason: total known after chunking, done counts finished parts.
  - Busy `E_CONFLICT` test lives in `TestBridgeDistillCancel` (shares lock-release setup).
  - Result hidden while run in flight. Reason: avoids stale result beside new progress.
  - Selection UI test uses palette, not context menu. Reason: right-click collapses selection in Monaco under WebKit.
  - Extra `DistillProgress.vue`. Reason: U92 forbids Spinner inside Button.
  - Cost via `formatCurrency`, tokens share via `formatPercent`.
