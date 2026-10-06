# P168 Part 10: review findings, Studio API client UI

Plan: `P168-part10-studio-api-ui.md`. Base commit `8a008bd` (plan surveyed), HEAD reviewed `6a7fde1`
(`p168-stream-c`, plan commit only on top). Reviewer: one Opus agent, report only.

## Checks

- `bun test` over 13 own unit specs: 38 pass, 0 fail.
- `bun run typecheck` (all nine projects): pass.
- `bunx biome check` over `SF/api`, `SF/views/httprequest`, `SF/views/grpcrequest`: 59 files, clean.

Probes: `bun test` harnesses in session scratchpad (Pinia store, stubbed `control`), never in tree.

## Findings (block 1, data layer; ranked within block)

### F1 medium, verified: Copy as curl reveal loop keeps revealing after dialog close or reopen

- `SF/api/state/curl.ts:268-291` (`revealSecretValues`), `:211-226` (`closeCopyAsCurlDialog`).
- Loop captures `deferredNames`, `collectionId`, `environmentId` once, then awaits per name. Close
  clears both maps, but nothing stops the loop. Each later iteration still calls `revealVariable`
  (OS auth or confirm prompt with no dialog on screen) and writes plaintext into
  `state.revealedSecretValues` and `useVariableSetStore().revealedValues`.
- Probe: two deferred secrets, close while first reveal pending. After close: `calls ["va","vb"]`,
  curl map `{"A":"plain-va","B":"plain-vb"}`, variable-set map `{"va":…,"vb":…}`. Both held 5 min.
- Reopen for another request: openCopyAsCurlDialog clears the map, then old loop writes old-scope
  values keyed by name. New dialog's command then substitutes another environment's secret for a
  same-named `{{A}}`. Copy copies it.
- Fix: per-open generation token (`openSeq`). Bump in open and close. Loop checks token after each
  await; on mismatch, stop and write nothing. Same check before `revealVariable` so no prompt fires
  after close. Guard via unit spec (cancellation race qualifies under CLAUDE.md bar).

### F2 low, code-read: history `view()` has no supersession

- `SF/api/state/history.ts:490-500`. Two quick clicks on entries A then B: if `get(A)` resolves
  last, `viewing` shows A while B is selected. A `get` resolving after `noteRecorded` (which clears
  `viewing` for a fresh send, D3) re-shows the old snapshot over the new response.
- Fix: per-tab view sequence (or compare against a `requestedViewId`), bumped by `view`,
  `backToLatest` and `noteRecorded`; commit only on match.

### F3 low, code-read: `del`/`clearAll` resurrect a closed tab's runtime

- `SF/api/state/history.ts:508-522`. After `await opts.remove/clear`, both call `load(tabId)`,
  which calls `ensure(tabId)` and `bumpSeq` before any `findTab` check. Tab closed during the
  await: runtime and `latestSeq` entry recreated, never cleaned (cleanup already ran).
- Fix: `if (!opts.findTab(tabId)) return;` after the await in both, or move `ensure`/`bumpSeq`
  in `load` behind a `findTab` check.

### F4 low, code-read: `openHistoryMenu` failure unhandled and silent

- `SF/api/state/variables.ts:732`; caller `SF/api/VariableSetView.vue:456` uses `void`.
- `control.variablesHistory` rejection becomes an unhandled rejection. Popover stays open with
  empty entries, reads as "no history".
- Fix: try/catch; on error `setVariableSetError(tabId, message)` when `variableId` still matches.

### F5 low, code-read: export clears `busy` under a running import

- `SF/api/state/collections.ts:700-728` vs `:644-680`. `exportCollection` never checks `busy` and
  its `finally` sets `busy = false`. Export started (row menu) during an import ends first and
  re-opens import's P28 D18 re-entry guard while the import still runs.
- Fix: export returns early when `busy`, like import.

### F6 low, code-read: any saved-request read failure is cached as a permanent orphan

- `SF/api/state/apiQueries.ts:67-94`. `queryFn` maps every error (transient bridge/DB error, or a
  Zod parse failure from schema drift) to `null`, the confirmed-orphan marker, with
  `staleTime: Infinity`. Only a later `savedRequest` broadcast for that id clears it. The tab
  reads unsaved/orphan for the session (block 3 notes what Save then does).
- Fix: return `null` only for Go's not-found outcome. Rethrow other errors so the query is in
  error state and retries on next read. Needs Go to return a typed not-found from
  `GetRequest`/`GetGrpcRequest` (today `ipcerr.InternalResult` wraps all errors alike).
  `needs-other-part-file: apps/kira-studio/internal/bridge/collections.go (Part 6)`.

### Refuted in block 1

- `apiIdsForTab` reading observer-backed computeds (`collectionIdFor`, `environmentIdForTab`)
  right after `loadCollectionsTree`/`loadEnvironments`: probe at boot and during a broadcast
  refresh both returned fresh ids. No lag observed.
- `REVEAL_GRACE_WINDOW_MS` (5 min) matches `internal/localauth.GraceWindow`.
- Go emits `ApiDataChanged` for every mutation the renderer refreshes locally (tree, savedRequest
  on save, variables on upsert/delete/reorder/bulk, environments on all env CRUD, collection
  delete adds its variables scope). Key set and kinds agree.
- `findSecretVariableId` precedence (environment then collection, first-wins) matches
  `mergeVariableRows`.

## Coverage

- Block 1 reviewed in full: `apiQueries.ts`, `collections.ts`, `variables.ts`, `draftMerge.ts`,
  `history.ts`, `revealExpiry.ts`, `reveal.ts`, `curl.ts`, `variableCompletion.ts`, `raw.ts`,
  `saveRequestDialog.ts`, `dynamicValues.ts`, `api/tabs.ts`, `api/menus.ts`. Go contract read:
  `SI/bridge/{apidata,collections,variables}.go` emission sites.
- Blocks 2-5: pending.
