# P168 Part 13 findings: Studio shell, project tree, state stores, UI-test harness

Plan: `P168-part13-studio-shell.md`. Base `844e132`; HEAD reviewed `62c0fdb` (`p168-stream-c`).
Reviewer reports only; fixes nothing. Each finding: severity, `file:line` (at `62c0fdb`), scenario,
fix, "verified" (scratch probe or run) or "code-read".

## Checks (reviewer baseline, `62c0fdb`)

- `bun test` over the 9 own unit specs together: 29 pass, 0 fail. `tabs-save-serialized`,
  `tree-state`, `run-state` alone: green.
- `typecheck:web:studio`, `typecheck:tests:studio`, `typecheck:unit:studio`: clean.
- `bunx biome check` over own dirs (287 files): clean.
- Machine shared with other agents (Go lint/builds seen; load average 13-16 at start).

## Block 1: state stores and shared domain

### F1 (low, routed Part 4 F20, must fix): `caps.ts` capability table contradicts Go

- `packages/shared/caps.ts:119-135`. Table rows disagree with `SI/adapters/*/caps.go`, the source
  of truth (`SI/adapters/caps.go:17`):
  - exactCount: redis "no (DBSIZE)" vs Go `true`; kafka "yes (end-begin)" vs Go `false`
    (`kafka/caps.go:30`); s3 "no" vs Go `true`.
  - definition: kafka and sqs "no" vs Go `true`; redis "no" matches.
  - cancel mechanism: sqlite "none" vs Go `Cancel: true` (`sqlite/caps.go:7`); redis/s3/sqs
    mechanisms describe the deleted TypeScript engine (AbortSignal, CLIENT KILL).
  - tree levels: redis and s3 list key namespaces/prefixes; P41 `keyBrowser` stops the tree at the
    container (`caps.ts:28-31` says so itself). Mongo "(+ indexes)" vs P19 D5 collection leaf.
  - "Only the postgres row is implemented in P1" is stale: all ten kinds ship.
- Redis `Cancel: true` vs `Cancel()` returning `false` (`redis/adapter.go:323`): not a caps lie.
  Go defines the flag as "a cancel stops the op" (ctx + `CheckCancelled` between SCAN rounds,
  `redis/caps.go:9-10`; kafka the same, `kafka/adapter.go:255`). No consumer reads `caps.cancel`
  in Go or the renderer (git grep), nor `caps.exactCount` in the renderer. No routed Part 3/4 item.
  But `caps.ts:74`'s comment ("can forward a cancel to the server") is the old meaning.
- `capsSchema` field set and order match Go `Caps` (23 fields, verified by read).
- Kafka's inexact count reaches the UI through `CountResponse.exact` (`read.go:603` returns
  `Exact: false`); `StreamView.vue:290` prints `~`. Two stale comments remain:
  `views/stream/StreamView.vue:282` cites "kafka.spec.ts's exact-count assertion" (no kafka spec
  reads `stream-status`; only `sqs.frontend.spec.ts:129` does), and Go `kafka/read.go:572` says
  "exact via high/low watermark subtraction" above code returning `Exact: false`.
  `kafka.frontend.spec.ts` asserts no count (git grep): nothing to route there.
- Fix: replace the table with a short pointer ("per-engine values: `SI/adapters/<kind>/caps.go`";
  keep only facts Go cannot state, or nothing). Reword `caps.ts:74` to "a cancel stops the
  in-flight op (server-side or by ctx)". Drop the kafka clause from `StreamView.vue:282` (Part 12
  file, Stream C may edit; state why). Route the Go comment.
  `needs-other-part-file: apps/kira-studio/internal/adapters/kafka/read.go (Part 4)`.
- Code-read (Go values by grep of every `caps.go`).

### F2 (low): browse preview viewKey escapes the tab lifecycle (disconnect and close)

- `state/tabs.ts:146-150` (`onClosed`), `:183-190` (disconnect), `state/tabKinds.ts:216`
  (`browse.dropResources: noDrop`).
- The browse split's preview pane keys its page and its selected cell under
  `${tabId}::preview` (`BrowseView.vue:155`, `KeyValuePane.vue:564`).
  - Disconnect: `dropPageStoresForTab(tabId)` calls each kind's dropper with the real tab id; the
    keyvalue store's `drop(tabId)` misses `${tabId}::preview`. The close-only hook
    (`views/shared/keyvalue/page.ts:19`) does not run on disconnect. The preview page's bytes
    outlive the disconnect, against D13 ("page bytes are freed"). Scenario: preview a 4 MB s3
    object, Disconnect; the page stays retained until the tab closes or reloads.
  - Close: `onClosed` clears `selectedCellFor(tabId)`, not `${tabId}::preview`. `KeyValuePane`'s
    own clear (`:405`) runs only on a page change, and the pane unmounts with the tab. The
    published `SelectedCell` (value up to `MAX_CELL_BYTES`, plus `onEdit`/`onRevert` closures over
    the unmounted component's refs for an s3 Body row) stays in `cellSelection.byTab` forever.
    One entry per closed browse tab that had a row selected.
- Fix: browse `dropResources: (id) => dropKeyValuePagesForTab(`${id}::preview`)` (runs on close and
  disconnect, since `dropPageStoresForTab` calls every kind's dropper), and in `onClosed` also
  `clearSelectedCellFor(`${tabId}::preview`)`. Keep the `page.ts:19` hook or drop it as redundant.
- Code-read.

### F3 (medium): `parseConnectionUri` returns the database percent-encoded

- `packages/shared/domain/uri.ts:18`. `url.pathname.slice(1)` is never decoded; username and
  password are (`:26-27`). `formatConnectionUri` (`:42`) sets `url.pathname`, which encodes space,
  `#`, `?` and non-ASCII.
- Verified (scratch probe, `bun`): database `my db` -> `postgresql://u@h:5432/my%20db` -> parsed
  `my%20db`; `a#b` -> `a%23b`; `café` -> `caf%C3%A9`. `sqlite:////Users/me/Application
  Support/x.db` -> `/Users/me/Application%20Support/x.db` and `canRoundTripToFields` says `true`.
- Scenario: an sqlite connection in URI mode with a macOS path under `Application Support`. User
  clicks Fields (`ConnectionDialog.vue:189-201`); `d.database` becomes the `%20` path; Save stores
  a path that does not exist, so Connect fails. Same for a postgres database name with a space.
  Fields -> URI -> Fields also turns `my db` into `my%20db`. The URI note (`:167-170`) shows the
  encoded name.
- Also: `formatConnectionUri` (`:43-45`) drops non-string `options` values (verified: `{tls: true,
  connectTimeout: 5}` vanish). `options` is `z.record(z.string(), z.unknown())`
  (`SD/connection.ts:94`); "Copy URI" (`project/menus.ts:130`) and the Fields -> URI switch lose
  them. Code-read on whether any writer stores a non-string option today.
- Fix: `decodeURIComponent` the database (catch a malformed escape: return null so the dialog stays
  in URI mode); `String(value)` for number/boolean options. Add one unit spec beside
  `mongo-srv-uri.spec.ts`: format/parse round trip for space, `#`, non-ASCII and the sqlite path
  (a format round trip with edge cases qualifies under the test bar).

### F4 (low): `maskRules.ts` correlation-key cache races a regenerate and never drops a deleted connection

- `state/maskRules.ts:96-103`, `:70-73`, `:140-143`.
- `correlationKeyFor` has no in-flight guard: a fetch started before `regenerateMaskKey`'s Go call
  finishes can resolve after its `delete correlationKeys[id]` and write the old key back. The grid
  preview then tags values with a key Go no longer uses until the next regenerate or reload.
  Narrow window (a Privacy-tab regenerate while a preview on the same connection fetches its key).
- No cleanup on connection delete: `correlationKeys[id]`, `['maskRules', id]` and the counts entry
  stay. `schemas.ts:329-346` already does this cleanup for its own cache on `onConnectionsChanged`.
- `hexToBytes` odd-length suspect: dropped. Go always sends `hex.EncodeToString`
  (`SI/maskrules/service.go:205`).
- Fix: a per-connection generation counter bumped by `regenerateMaskKey` and `applyRemote`'s
  `keyRegenerated`; `correlationKeyFor` writes only when the generation it captured still holds.
  In `initMaskRulesSync`, subscribe `onConnectionsChanged` and remove the three entries for ids no
  longer live.
- Code-read.

### Block 1: checked, nothing to report

- `tabs.ts` save path: every structural action calls `saveNow`; `patchTabState` debounces;
  `enqueueSave` coalesces and serialises (Part 9 contract, read). `persistable` drops incognito
  and terminal. Close-time flush: `onFlushBeforeClose`/`onWindowFlushBeforeClose`.
  `useRecentTablesStore` is its own store in the same file: fine under one-store-one-concern.
- `tabDomain.ts`: every later field carries `.default(...)`; base fields (`console.text`,
  `document.expanded/search`, `keyvalue.pageIndex`) were in the first schema. A kind dropped from
  `TAB_KINDS` keeps its raw row (`createTabsStore.ts:265`); `TAB_KINDS` is total over
  `StudioTabKind`.
- `duplicateState` carries no ids or op handles (request kinds clear `itemId`).
- Terminal `dropResources` blind-called on every tab id: guarded (`createTerminalsStore.ts:204`).
- Incognito: flag cleared on close (`tabIncognito.ts:43`), duplicate inherits, toggle saves.
- `schemaColumns.ts`: generation guard, no `[]` memo, sync idempotent. `schemas.ts`: write
  generation, deleted-connection cleanup. `runState.ts`, `cellSelection.ts` (apart from F2),
  `viewCommands.ts`, `objectStore.ts`, `datagripImport.ts`, `dbmcp.ts` (broadcast-only, P108 F2),
  `customScripts.ts`, `settings.ts`, `mode.ts`, the thin factory wrappers: no defect.
- `settingsDomain.ts` defaults equal Go `model.DefaultSettings()` and ranges equal Go validators
  (`SI/storage/model/settings.go:73-97`, `:171-180`).
- `SD/{mode,tree-filter,secrets,datagrip}.ts`: types match their Go mirrors' JSON (read).
- TanStack Query rule: `customScripts`/`dbmcp`/`datagripImport`/`objectStore` are push-updated or
  command-shaped (no cached fetch with loading/error state to own); `schemas` and `maskRules`
  already use `queryClient`. No migration finding.
