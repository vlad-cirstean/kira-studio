# P18 — history correctness and retention, gRPC parity, mode-button alignment, and environment colour

> **What this phase is.** `docs/v1.2/SPEC.md`'s P18 row: a fourth user-driven batch of five items,
> two of which (1 and 4) are named there as regressions/gaps against this chapter's own recent work
> and must be root-caused against what actually shipped rather than treated as fresh features.
>
> **The SPEC row's own factual premises, checked against the tree — three of them are wrong, and
> the corrections change what this phase builds.** The row was written from chat, before anyone
> read the code; §1 is the audit, and these are its headline results:
>
> 1. *"whatever store/watch wiring `packages/api-core`'s history module and its consuming panel
>    share"* — **there is no history module in `packages/api-core`.** The store is
>    `apps/kira-studio/frontend/src/api/state/history.ts` (P12 D12's shared factory), consumed by
>    `views/httprequest/history.ts` and `views/grpcrequest/history.ts`. `packages/api-core` is
>    app-free, DOM-free logic and holds no reactive state at all (P12 D16(e)). F1.
> 2. *"history currently grows unbounded"* — **it does not.** P8 D6 shipped three caps and P11 D11
>    shipped four; both tables have carried a per-scope count cap of **20** since they landed
>    (`response_history.go:19`, `grpc_history.go:19`). The real work in item 2 is therefore *raising*
>    20 → 30, giving the cap a name the renderer can also read, and adding the truncation message —
>    not inventing eviction. F6, F9.
> 3. *"keep storing the full raw request/response alongside each entry … this phase's own
>    investigation must confirm the request side and gRPC's `grpc_history.go` get the same
>    treatment"* — the investigation was asked for and it found two real defects, one of them
>    serious: HTTP stores the request and caps it, but **nothing in the app has ever rendered a
>    stored entry's request**, and its `requestBodyStorageTruncated` flag has had no reader since P8
>    (F7, F8); gRPC stores its request message **with no per-entry cap at all** (F9), which also
>    breaks the invariant the global byte sweep is built on — one oversized request message empties
>    the entire `grpc_call_history` table (F9a).
>
> **The live-update bug has a single, provable root cause, and it is a gap rather than a
> regression.** `createHistoryStore`'s refresh policy has two branches; the lazy one sets
> `rt.stale = true` and **nothing has ever read that flag** — not in the current tree, and not in
> any commit since P8 landed it (`git log -S` evidence in F2). D1.
>
> **Base commit.** Read against `c4bb908` (branch `claude/feature-v1-2`), i.e. P17 landed and its
> row is marked implemented. Every file:line citation points at that commit.
>
> **The precedents this matches.** `docs/v1.2/plans/P16-sql-grid-consistency-search.md` (a
> multi-scope user-driven batch whose row deliberately under-specified three things, resolved in the
> plan rather than in the implementation), `docs/v1.2/plans/P15-request-builder-ux.md` and
> `docs/v1.2/plans/P15b-request-builder-editor-behavior.md` (the two phases item 3 is a parity pass
> over), `docs/v1.2/plans/P8-response-history.md` (the storage policy items 1 and 2 both extend), and
> v1.1's P42 D34-D36 plus `docs/design/kira-design-system`'s LAW 07 (the colour convention item 5 is
> a deliberate cross-reference to, not a new scheme).

---

## 0. Scope

### 0.1 The five items, and where each lands

| # | Item (SPEC row wording, abbreviated) | Findings | Decisions | Commits |
|---|---|---|---|---|
| 1 | The response-history list does not refresh as new requests are sent — a real live-update bug in the store/watch wiring the history module and its consuming panel share | F1-F5 | D1, D2, D3 | S1, S2 |
| 2 | Cap history at 30 per request, oldest evicted first; keep storing the full raw request/response; show "only the last 30 are kept" at the bottom of a truncated list | F6-F10 | D4, D5, D6, D7, D8 | S3, S4, S5, S6, S15 |
| 3 | A parity pass applying P15/P15b's request-builder UX and editor-behaviour fixes to `GrpcRequestView.vue` | F11-F17 | D9, D10, D11, D12, D13, D14 | S7, S8, S9, S10 |
| 4 | The Studio/Api mode-switch buttons' icon and label are misaligned | F18 | D15 | S11 |
| 5 | Environments get the same colour-coding treatment Studio gives DB connections, wherever the active environment is surfaced | F19-F22 | D16, D17, D18, D19 | S12, S13, S14 |

### 0.2 Files this phase touches

**Go — storage and bridge**

- `internal/storage/repos/response_history.go` — the per-scope cap becomes 30 and gains an exported
  name (D4); no other rule changes.
- `internal/storage/repos/grpc_history.go` — same cap raise, plus the missing per-entry cap on the
  **request** message (D7) and the flag that records it.
- `internal/storage/repos/response_history_test.go`, `grpc_history_test.go`,
  `grpc_history_internal_test.go` — the cap cases restated at 30, plus D7's new case.
- `internal/storage/model/grpc.go` — `GrpcCallSnapshot.RequestMessageTruncated`.
- `internal/storage/model/variables.go` — `Environment.Color`.
- `internal/storage/model/connection.go` — `ValidConnectionColor` gains a palette-neutral name and
  keeps the old one as an alias (D18).
- `internal/storage/repos/variables.go` — `color` in the five environment statements (D18).
- `internal/storage/migrations/0012_p18_environment_color.sql` — one `ALTER TABLE … ADD COLUMN`.
- `internal/bridge/variables.go` — `Color` on `VariablesCreateEnvironmentArgs` /
  `VariablesUpdateEnvironmentArgs`, validated.

**`packages/shared`**

- `domain/response-history.ts` — `HISTORY_PER_SCOPE_LIMIT`.
- `domain/grpc-history.ts` — `GRPC_HISTORY_PER_SCOPE_LIMIT`, `requestMessageTruncated`.
- `domain/grpc.ts` — `grpcCodeHint()` (D13).
- `domain/color.ts` (new) — the palette enum, with `connection.ts` re-exporting its existing names
  as aliases (D18).
- `domain/variables.ts` — `ApiEnvironment.color`.

**`packages/api-core`**

- `src/grpc/metadata.ts` (new) + `src/index.ts` — `WELL_KNOWN_REQUEST_METADATA` (D12).

**Frontend — Api module**

- `api/state/history.ts` — D1's `ensureFresh`, D2's proxy fix, D3's `viewing` reset.
- `api/state/variableCompletion.ts` (moved from `views/httprequest/`) — D11.
- `api/EnvironmentSelect.vue` — app-drawn, colour-carrying (D19).
- `api/VariableSetView.vue`, `api/EnvironmentsDialog.vue` — the colour picker and the row dot (D19).
- `api/VariablesOverviewPanel.vue` — the environment dot beside its footer action (D19).
- `api/state/variables.ts`, `bridge/apiControl.ts` — `color` through create/update.

**Frontend — views**

- `views/httprequest/history.ts`, `ResponseHistoryList.vue`, `ResponsePane.vue`,
  `RawExchangePane.vue` — items 1, 2 (and D8's reader).
- `views/grpcrequest/history.ts`, `CallHistoryList.vue`, `ResponsePane.vue`,
  `GrpcRequestView.vue`, `MetadataTable.vue` — items 1, 2, 3.
- `views/httprequest/{FieldRowsTable,FormDataTable,RequestBodyPane,RequestHeadersTable,QueryParamsTable,UrlEncodedTable,HttpRequestView}.vue`
  — one import line each, from D11's move.

**Frontend — shared theme / workbench**

- `theme/primitives/ColorPicker.vue` (moved from `project/`) — D18.
- `theme/primitives/ViewChrome.vue`, `ViewHeader.vue` — an optional rail/dot colour that does not
  come from a connection (D19).
- `workbench/TitleBar.vue` — item 4 (D15).

**Tests** — `tests/ui/{http-history,grpc-request,api-ui-consistency,mode-switch}.spec.ts`,
`tests/unit/{history-runtime-reactivity,go-ts-vocabulary-parity}.spec.ts`, and the Go tests above.

### 0.3 Not in scope

- **Any P16 or P17 parity item for gRPC.** Item 3 says *P15/P15b*. The gRPC method select is still a
  native `<select>` while HTTP's is app-drawn (P17 D18) and the gRPC response pane has no find bar
  (P16 D11); both are real inconsistencies and both are deliberately left (§5).
- **A second reveal surface, or any change to secret handling.** The stored request is stage-1 text
  with a secret still spelled `{{name}}` (F7) and stays that way — D8's new reader renders exactly
  what is stored and adds no reveal.
- **A retention setting.** P8 D6 declined an Advanced setting on `internal/logging/sweep.go`'s
  precedent; raising 20 → 30 is a constant, not a preference (D4).
- **Colouring collections, requests, or Studio-side anything.** Item 5 is environments only.
- **A colour on a history row.** A stored entry keeps an environment *name*, not an id (F6) — §5.
- **P19/P20 work.** No Studio-mode fix, no connection-dialog sizing, no Mongo console change.

---

## 1. Findings

Every finding below was read from the tree at `c4bb908`.

### F1 — Where the history store actually lives, and what it is

`apps/kira-studio/frontend/src/api/state/history.ts` — `createHistoryStore<Entry, Snapshot, Extra>`,
P12 D12's extraction of the runtime the two protocols shared byte for byte. It owns
`runtime = reactive({} as Record<string, Runtime>)` (`:33`) and seven functions; the two protocol
modules are thin factory calls (`views/httprequest/history.ts:19-36`,
`views/grpcrequest/history.ts:10-25`). The runtime record is
`{entries, loading, stale, viewing, error}` plus HTTP's `selected: string[]` (`:11-17`).

`packages/api-core` holds `http/` and `grpc/` pure logic only (`saved.ts`, `substitute.ts`,
`body.ts`, `curl/`, `raw/`, `dynamic/`, `transforms.ts`, `dotenv.ts`, `url.ts`, `headers.ts`,
`escape.ts`) — no Vue import anywhere, by P12 D16(e). The SPEC row's location is wrong; every
citation in this plan uses the real one.

### F2 — `stale` is written by one caller and read by nobody, and always has been

`createHistoryStore`'s refresh policy (`api/state/history.ts:88-98`):

```ts
function noteRecorded(tabId: string): void {
  const tab = opts.findTab(tabId);
  const rt = ensure(tabId);
  if (tab?.state.responsePane === 'history') void load(tabId);
  else rt.stale = true;
}
```

`load()` clears it (`:71`). Those two lines, plus the field's declaration (`:14`) and its
initialiser (`:41`), are **every** occurrence of `stale` in the Api module. A repo-wide grep for a
reader turns up only unrelated `stale` uses (the grid's count staleness, `views/shared/viewOp.ts`
comments). `git log -S "historyRt.value.stale"` returns nothing, and
`git log -S ".stale" -- views/httprequest/ResponseHistoryList.vue` returns nothing: **no commit in
this repository has ever read the flag.** The three commits that touch it at all are P8's own
`a4a33fb`, P12's `c34cd33` (the factory extraction) and `bf1d486` (the Http → Api rename).

P8's plan states the intended policy in D11 — *"eager when the pane is showing, lazy otherwise …
otherwise just sets `stale`"* — and its §4 verification plan has no case for the lazy branch. So
this is a **gap present since P8 landed**, not a regression: half a policy was written down,
implemented halfway, and never tested.

### F3 — The exact repro, and why the eager branch masks it

- **Pane on History, user sends** → `noteRecorded` takes the eager branch → `load()` → the list
  updates. This is the path P8's own `http-history.spec.ts` exercises, which is why the defect
  survived a test suite.
- **Pane on Body (the default, and where a user is after every send), user sends** → `stale = true`
  → nothing. Switching to History mounts `ResponseHistoryList.vue`, whose `onMounted` calls
  `ensureHistoryLoaded` (`:34-36`), which is guarded on `rt.entries === null`
  (`api/state/history.ts:85`) — already non-null, so it returns without fetching. **The user sees
  the list as it was at the last fetch, indefinitely.** Every subsequent send makes it staler.

The same two lines exist for gRPC (`views/grpcrequest/CallHistoryList.vue:35`,
`views/grpcrequest/ResponsePane.vue:26`), so the defect is identical in both protocols.

Two secondary surfaces read the same runtime and go stale with it: the response pane's empty-state
link *"N past responses · View history"* (`views/httprequest/ResponsePane.vue:69-70`, 393-401) and
its gRPC twin (`views/grpcrequest/ResponsePane.vue:42-44`).

### F4 — `ensure()` hands out the raw object on the call that creates it

```ts
function ensure(tabId: string): Runtime {
  let rt = runtime[tabId];
  if (!rt) { rt = { …defaults }; runtime[tabId] = rt; }
  return rt;                       // ← the raw literal, not runtime[tabId]
}
```

`runtime` is a deep `reactive()`. Reading `runtime[tabId]` returns a proxy; the creating call
returns the **target**. Writes through the target mutate the right memory and trigger no effect, so
a component holding `computed(() => historyRuntime[tab.id])` never re-renders for them.

Today this is latent rather than live: every path that writes calls `ensure()` twice in the same
tick (`ensureLoaded` → `load` → `ensure`; `noteRecorded` → `ensure` → `load` → `ensure`), and the
second call returns the proxy. But `noteRecorded`'s own `rt.stale = true` can land on the raw object
(first-ever call for a tab), and D1's fix makes `stale` a rendered-decision input, so the hazard
stops being theoretical. One line fixes it permanently (D2).

### F5 — A send does not clear the `viewing` pointer

`viewing` is the "you are looking at a stored entry" pointer (`api/state/history.ts:15`), and
`ResponsePane.vue:66-67` resolves the displayed response as
`viewing?.snapshot.response ?? rt.response ?? null`. Nothing clears it on send. So: click a history
row (which also switches the pane back to Body, `ResponseHistoryList.vue:66-69`), press Send, and the
pane keeps rendering the **old** response while the new one sits unshown in `rt.response`. The band
says *"Viewing the response from HH:MM:SS"* and the button says *"Back to latest"*, so it is not
silent — but it is still "I sent a request and the panel did not update", which is the same sentence
the SPEC row uses for item 1. D3.

### F6 — HTTP retention today: three caps, and where each lives

`internal/storage/repos/response_history.go`:

| Cap | Value | Bounds | Where |
|---|---|---|---|
| per-entry body | `maxHistoryBodyBytes = 256 * 1024` (`:18`) | one entry, applied once to the response body (`:77-86`) and once to the request body (`:68`, `capBody` `:166-180`) | `Record` |
| per-scope count | `historyPerScopeLimit = 20` (`:19`) | one request's history, insert-then-trim (`:129-139`) | `Record` |
| table byte budget | `historyByteBudget = 128 MiB` (`:27`) | the whole table, oldest-first across scopes via one window-function `DELETE` (`:144-154`) | `Record` |

All three run inside `Record`'s single transaction, deliberately in the repo rather than the bridge
(P8 §0.3: `Record` is the only writer, so the caps cannot be bypassed). `List` is `≤ limit` by
construction and orders `sent_at DESC, rowid DESC` (`:204-229`).

The stored `environment` is the environment's **name**, resolved at write time (`:59-66`) — there is
no environment id on the row.

### F7 — The HTTP request side *is* stored, and it is stage-1 text

`storedSnapshot` (`:36-42`) carries `Request model.ResponseHistoryRequest` — method, URL, headers,
body — beside the response. `bridge/http.go:119-133` records **from `args`, never from `resolved`**,
which P8 D2 chose deliberately: a secret is still spelled `{{name}}` in a stored entry, and
`packages/shared/domain/response-history.ts:28-34` states that invariant on the type. Nothing in
this phase may weaken it.

`capBody` (`:166-180`) applies `maxHistoryBodyBytes` to the `raw` and `code` modes only;
`urlencoded`/`formdata` are structured field lists and `file` carries a path — P8's stated
reasoning, unchanged here. Request **headers** are uncapped; in practice a header list is bounded by
what a user typed into a table, and no cap is proposed.

### F8 — `requestBodyStorageTruncated` has never had a reader, and neither has the stored request

The flag crosses the bridge (`domain/response-history.ts:42`) and appears in seven test fixtures —
and in no component. Grepping `snapshot.request` across the frontend returns nothing at all:
`ResponsePane.vue` renders only `snapshot.response`, and `RawExchangePane.vue` renders
`response.wire`, which P8 nulls out before persisting (`response_history.go:74`, on P9 D7's
reasoning that storing rendered text would double a snapshot). **A stored history entry therefore
cannot show what was sent, even though what was sent is sitting in the row.** D8.

### F9 — gRPC retention today, and the one cap that is missing

`internal/storage/repos/grpc_history.go` (P11 D11's four caps): `maxGrpcMessageBytes = 64 KiB` per
response message, `maxGrpcStoredMessages = 100` messages, `grpcHistoryPerScopeCap = 20`,
`grpcHistoryByteBudget = 32 MiB` (`:16-27`) — the same insert-then-trim (`:126-135`) and the same
window-function sweep (`:139-149`) as HTTP.

The **request** side is stored (`storedGrpcSnapshot.Target/Method/Streaming/Message/Metadata`,
`:36-46`) from `args` exactly as HTTP does (`bridge/grpc.go:279-299`, whose comment restates P8 D2
verbatim) — but `snap.Message = rec.Message` is written **with no cap** (`:90-95`). Neither
`Record` nor `model.GrpcCallHistoryRecord.Validate` (`model/grpc.go:126-137`) bounds it. A pasted
2 MiB request message is stored whole, in every one of that scope's entries.

#### F9a — And that uncapped field breaks the global sweep's safety property

Both sweeps are safe only because *no single row can exceed the budget* — `response_history.go:141-143`
says so explicitly. The sweep keeps rows whose running `SUM(stored_bytes)` (newest first) is `<=`
the budget. If the newest row alone exceeds it, **no row qualifies and the `DELETE` empties the
table** — including the row just inserted. With HTTP's caps a row is bounded at roughly
2 × 256 KiB + headers, four hundred times under its budget. With gRPC's uncapped request message, a
single 32 MiB paste silently wipes every gRPC history entry in the workspace. D7 closes this by
giving the request message the cap every other free-form string in both tables already has.

### F10 — The bounded-list precedents this repo already follows

`repos/filter_history.go:14` (`historyLimit = 20`, per connection+path) and `repos/variables.go:18`
(`variableHistoryLimit = 20`, per variable) both use the identical insert-then-trim SQL
(`DELETE … WHERE scope = ? AND id NOT IN (SELECT id … ORDER BY … LIMIT ?)`); `repos/ops.go:13` is
the only sweep-shaped one (a global row cap plus an age cut, run at launch). P8 D6 followed the
first shape deliberately. **Write-time trim, per scope, is this codebase's established answer**, and
D5 keeps it.

### F11 — What gRPC has *already* received from P15/P15b

Checked file by file, not assumed:

- **P15 item 4** (fields fill their cells) — landed: `MetadataTable.vue:189-195` has the
  `.metadata-cell { flex: 1; min-width: 0 }` + `:deep(.p-input) { width: 100% }` idiom. P15's own
  commit M3 named `views/grpcrequest/MetadataTable.vue` in its file list.
- **P15 item 5** (the Checkbox primitive) — landed: `MetadataTable.vue:137-142`. P15 M2 was app-wide.
- **P15b item 12** (arrow-key navigation) — landed: `MetadataTable.vue:65-126`, a literal copy of
  `FieldRowsTable.vue:95-160`, with P15b D6's own comment explaining why it is a copy.
- **P15b item 11(b)** (auto-closing pairs in plain fields) — landed *by inheritance*: the behaviour
  lives in the primitives (`theme/primitives/TextField.vue:11-12`,
  `AutocompleteField.vue:202-203`), so every gRPC `TextField` — the target and both metadata cells —
  already auto-closes.

The SPEC row's premise that `GrpcRequestView.vue` "was not itself in either phase's file list" is
right about that file; it is not right about the module.

### F12 — P15 D1: gRPC's response pane still appears only after a first call

`views/grpcrequest/ResponsePane.vue` wraps **the status row, the pane switcher and every strip** in
`<template v-if="hasResult || hasHistory">`, with a bare `<EmptyState v-else>` as the whole
alternative. That is exactly the shape P15 D1 removed from HTTP's pane (P15 M4: *"one `v-if` moves,
one dead `EmptyState` goes"*). A freshly-opened gRPC tab shows no Messages/Metadata/History
switcher at all.

### F13 — P15 D2: gRPC has no code-meaning line, and its status message is the truncatable caption

HTTP renders `statusHint(status)` on its own always-visible line
(`views/httprequest/ResponsePane.vue:136`, `:308`), from a per-code table with class-level fallbacks
(`domain/http.ts:340-386`). gRPC has `GRPC_CODE_NAMES` and `grpcCodeClass` (`domain/grpc.ts:83-110`)
and **no hint table**; what sits in the row is the server's own `statusMessage`, styled
`.status-hint` with `overflow:hidden; text-overflow: ellipsis` — i.e. the truncatable caption P15 D2
was about, and not even the same kind of fact (a server string, not the code's meaning). D13.

### F14 — P15 D4/D7: gRPC's toolbar carries Save, and its target field has P15 F3's exact defect

`GrpcRequestView.vue:258-302` puts target · TLS · method-select · **Save** · **Call** in one
`#toolbar` row, while HTTP moved Save into the view head beside the name (P15 D7,
`HttpRequestView.vue:301-309`) and gave the URL field a real wrapper (P15 D4, `:318-330` +
`.url-field` CSS `:453-459`).

And the gRPC target field is still written

```html
<TextField … style="flex: 1" data-testid="grpc-target" />
```

(`:259-266`) — the *literal* construct P15 F3 identified as a no-op: `TextField` sets
`inheritAttrs: false`, so a call-site `style` lands on the inner `<input>` (already `flex: 1`) and
never on the `.p-input` box that sizes it. **The gRPC target field has never grown with the
window**, for the same reason the URL field didn't before P15.

### F15 — P15b D4 is entirely absent from gRPC, and its module is out of reach

`GrpcRequestView.vue` never imports `variableSupport`, and nothing in `views/grpcrequest/` passes
`rangeHighlights`/`hoverAt`/`candidates`. So gRPC has no `{{variable}}` colouring, no hover, and no
completion — in the target field, in the metadata value cells, or in the message editor — even
though the view already computes `unresolvedRefs` from the same `mergedValuesAndSecrets`
(`:157-174`) and therefore already knows every fact the colouring needs.

The blocker is structural: `views/httprequest/variableCompletion.ts` cannot be imported from
`views/grpcrequest/**` — `biome.json`'s per-directory `noRestrictedImports` bans
`../httprequest/**` outright (*"views/&lt;kind&gt;/\* must not import another views/&lt;kind&gt;/\*"*).
D11 moves it.

### F16 — P15b D5(a): only the message editor is missing auto-close

`CodeMirrorHost.vue:71-78` exposes `autoCloseBrackets?: boolean`, default false;
`RequestBodyPane.vue` passes it on both editors. `GrpcRequestView.vue:347-354` mounts a
`language="json"`, writable `CodeMirrorHost` for the request message and does not — the single most
JSON-shaped editor in the Api module has no bracket completion. One attribute.

### F17 — P15 D8 already ruled gRPC out of the body badge

`state/tabKinds.ts:256-262`: *"gRPC is deliberately left out (a call always has a message body, so
the mark would be on every tab always, which is not information; §8 OQ-3)"*. Not a gap; do not
"fix" it.

### F18 — The mode tab: the icon is unboxed and the label is an anonymous flex item

`TitleBar.vue:20-32` renders each mode tab as

```html
<button class="p-tab mode-tab">
  <CodiconIcon :name="MODES[mode].icon" :size="13" />
  {{ MODES[mode].label }}
</button>
```

Two flex items: a bare `<i class="codicon codicon-database">` and an **anonymous** item wrapping the
label text (a bare text run in a flex container becomes one, per CSS Flexbox). `.p-tab`
(`primitives.css:470-483`) centres those two *boxes* — `display:inline-flex; align-items:center;
gap: --kira-s-2`. `.mode-tab` (`:123-134`) only changes padding and restates the gap.

Every other icon+label control in this app boxes the icon: `AppButton.vue:29` renders
`<span class="icon-box"><CodiconIcon :size="13" /></span>`, with the component's own comment stating
the rule — *"the icon, when given, always sits in an icon-box (LAW: icons never float unboxed next
to text)"* — and `.icon-box` is a 16 × 16 flex-centred square (`primitives.css:25-32`,
`--kira-icon-box: 16px`). `MethodSelect.vue:65-67` (P17, last phase) follows it; the context menu
follows it; `TabStrip.vue` at least gives its label a real `<span class="tab-title">`. The mode tab
does neither.

**What that costs, measured rather than asserted.** From the installed font
(`@vscode/codicons@0.0.46-24`, `codicon.ttf`, parsed directly): `unitsPerEm = 300`, `hhea` ascender
`300`, descender `0` — the em box is entirely above the baseline. Glyph bounding boxes:
`database` (U+EACE) `x ∈ [0, 244]`, `y ∈ [0, 282]`; `globe` (U+EB01) `x ∈ [0, 282]`,
`y ∈ [0, 282]`; advance `300` for both.

1. **Horizontal — the defect the icon law exists to prevent.** Unboxed, the icon item's width is the
   glyph's advance (13 px at `:size="13"`), but its *ink* is 244/300 = 10.57 px for `database` and
   282/300 = 12.22 px for `globe`. The right side bearing is therefore **2.4 px on the Studio tab and
   0.8 px on the Api tab**: the two adjacent buttons render a visibly different gap between icon and
   label, and neither is the declared 4 px. Inside a 16 px `.icon-box` the *advance* is centred, so
   the slot is glyph-independent — which is the whole point of the law.
2. **Vertical.** With `font: … 13px/1 codicon` the icon item's box is exactly 13 px with the baseline
   at its bottom edge, and the ink spans `y ∈ [0, 282]/300` — so the ink's centre sits **0.39 px
   below the box centre**. The label item's box is `line-height` (Tailwind preflight's 1.5 → 16.5 px)
   and its ink is Menlo's caps (`--kira-font-family: Menlo, monospace`, `tokens.css:75`, at
   `--kira-t-sm: 11px`), whose centre sits ≈0.11 px *above* its box centre. Net ≈**0.5 px, icon low**
   — one device pixel at 2×.
3. **The icon reads oversized.** Its ink is 12.2 px tall against a cap height of ≈7.9 px: 1.55×.

Point 2 is shared with every other icon+label pairing in the app and is *not* the mode tab's own
bug; point 1 is unique to it. P15 §4 explicitly declined to verify this on hardware (*"a real macOS
render of the title bar … If M9 reads wrong on real hardware, the fix is `--kira-h-lg`, not a token
edit"*, OQ-4) — this item is that unverified render coming back as a report. D15 fixes the
structural divergence and, just as importantly, makes the result **measurable**: an anonymous flex
item has no element for a test to measure, which is why no test could have caught this.

### F19 — How Studio colours a connection, and what the design system permits

- **The palette.** Twelve values plus `'none'`, `oklch(0.72 0.09 h)` — one lightness, one chroma
  (`tokens.css:106-117`, `--kira-conn-red` … `--kira-conn-grey`). `connectionColorSchema`
  (`domain/connection.ts:51-68`) is the **storable** set; `CONNECTION_COLOR_CHOICES` (`:77-86`) is
  the picker's trimmed subset — six hues plus `none` and `grey`, chosen in v1.1 P42 D34/D35 for a
  42° minimum adjacent hue gap, with the retired hues deliberately still storable (P42 F27: trimming
  the stored set would delete rows).
- **It is user-assigned, never derived.** `ColorPicker.vue` is a swatch radiogroup; `'none'` is a
  real stored value and the default. The design system says so in as many words: *"There is one
  palette and no intensity setting. No colour is the default; the 2px rail slot is reserved either
  way, so assigning one moves nothing."*
- **Where it may appear — LAW 07.** *"It appears as a rail (tree group, tab, and a cap on the view's
  toolbar — not the panel …) and a dot (view header, operations row) — nowhere else."*
  (`docs/design/kira-design-system/README.md`, restated at `primitives.css:702-737` over
  `.p-toolbar-rail`, `.p-conn-dot`, `.p-tab-rail`, `.p-tree-rail`, all reading `--kira-rail`.)
- **The resolver.** `theme/connColor.ts` — `connColorVar(c)` returns `var(--kira-conn-${c})` or
  `undefined` for `'none'`, typed `string` on purpose so loosely-typed call sites can use it.
- **Go.** `Environment`/`Connection` colours are plain `string` columns;
  `model.ValidConnectionColor` (`model/connection.go:59-73`) mirrors the TS enum, and
  `repos/connections.go:53` *drops* a row whose colour is unrecognised — a posture D18 deliberately
  does not copy for environments.
- **The one thing that blocks reuse:** `ColorPicker.vue` lives in `project/`, and `biome.json` bans
  `api/**` from importing `**/project/**` (P1 D7). It must be promoted, exactly as P15 promoted the
  Checkbox.

### F20 — Where the active environment is surfaced today (post-P17)

1. `api/EnvironmentSelect.vue` — a native `<select class="p-select bordered p-push">` listing "No
   environment", every environment, and "Manage environments…", mounted in **both** request views'
   `#toolbar-2` (`HttpRequestView.vue:392`, `GrpcRequestView.vue:342`).
2. `api/VariablesOverviewPanel.vue` — P17 D20's unified panel, which names the environment
   (`:46-48`), chips each row's scope (`:105-111`) and offers *"Edit environment variables…"*
   (`:128-136`).
3. `api/VariableSetView.vue` — P17 D16's environment tab, whose `.env-fields` row holds name,
   description and Duplicate.
4. `api/EnvironmentsDialog.vue` — the manage list (radio · name · description · Edit variables… ·
   Duplicate · Delete).
5. Both history lists' rows show `entry.environment` — the environment's **name**, denormalised at
   write time (F6).
6. `ViewChrome.vue:65` renders `.p-toolbar-rail` for every view, resolving its colour from
   `tab.connectionId` — which is empty for every Api tab, so **the rail slot is reserved and empty
   in Api mode today**. `ViewHeader.vue` takes `connColor` for the dot on the same terms.

Surface 6 is the direct LAW 07 analogue of *"a query console's connection"* the SPEC row asks for.

### F21 — Migration and wire precedents for adding one column

`migrations/0011_p17_variable_description.sql` is the exact shape: two
`ALTER TABLE … ADD COLUMN <x> TEXT NOT NULL DEFAULT ''` statements with a comment explaining why
non-null-with-default (SQLite treats it as a metadata change, no table rewrite). P17 also
established that renaming and describing an environment is **one** row update
(`bridge/variables.go:43-59`, `apiControl.ts:198-200`) — colour joins that call rather than adding a
second.

### F22 — How a Go constant is pinned to a TS one

`tests/unit/go-ts-vocabulary-parity.spec.ts` reads the Go **source text** and compares the extracted
vocabulary against the TS schema, on P2 D10's stated reasoning (*generating one side from the other
is too much machinery for two short lists*). `packages/api-core/test/go-ts-api-parity.spec.ts` does
the same for the Api module's own vocabularies. D4's two new constants use this technique.

---

## 2. Decisions

### D1 — The lazy branch gets its reader: `ensureFresh`, and `stale` becomes a precondition (item 1)

The bug is not a missing watcher on a component; it is a store whose "the list needs refetching"
signal has no consumer (F2). Fix it in the store, once, for both protocols:

```ts
/** The one refetch a tab's history ever gets unprompted: on the pane's own mount, and whenever
 *  the pane becomes visible again. Fetches when the list has never loaded (entries === null) OR
 *  when a send/call happened while this pane was not showing (stale). Idempotent via the loading
 *  guard, so two callers mounting in the same tick pay one fetch. */
function ensureFresh(tabId: string): void {
  const rt = ensure(tabId);
  if ((rt.entries === null || rt.stale) && !rt.loading) void load(tabId);
}
```

`ensureLoaded` is **renamed** to `ensureFresh` rather than joined by a sibling: every existing call
site wants the new behaviour, and leaving a same-shaped `ensureLoaded` beside it is how a future
caller re-introduces this exact bug. The exported names follow
(`ensureHistoryLoaded` → `ensureHistoryFresh`, `ensureGrpcHistoryLoaded` → `ensureGrpcHistoryFresh`).

**Where it is called, and why that is sufficient rather than a watch on the pane:**

| Call site | When it fires | Covers |
|---|---|---|
| `ResponseHistoryList.vue` / `CallHistoryList.vue` `onMounted` | every time the History segment is selected (the component is `v-if`'d on the pane, F3) | the reported bug, exactly |
| Both `ResponsePane.vue` `onMounted` | tab open / restore | P8 D11's original "does this tab have any history at all" fetch |
| Both `ResponsePane.vue`'s existing `watch(() => tab.state.itemId)` | Save as… adopts a scratch tab's history | P8 D14, unchanged (it still nulls `entries` first) |

No new watcher on `tab.state.responsePane` is added: the list component's own mount **is** that
event, one-to-one, and a watch would fire a second, redundant load for the same pane change. The
`loading` guard makes the double-mount case free either way.

**What stays lazy.** A send with the pane closed still performs no IPC — P8 D11's whole point, and
the reason the flag exists rather than an unconditional refetch. The count in the response pane's
empty state (F3) is refreshed by the same `ensureFresh` the moment anything mounts over it; it is
not worth an eager fetch per send on its own (§6 OQ-1).

### D2 — `ensure()` returns the proxy, always (item 1)

```ts
function ensure(tabId: string): Runtime {
  if (!runtime[tabId]) runtime[tabId] = { …defaults } as Runtime;
  return runtime[tabId] as Runtime;
}
```

Three lines, no behaviour change today, and it removes the class of bug F4 describes permanently:
after this, **no caller can hold an untracked copy of a runtime record.** Guarded by a real unit
test (§4, `tests/unit/history-runtime-reactivity.spec.ts`), on `tree-state.spec.ts`'s established
precedent of asserting reactivity with `effect()` from `vue` in a Bun unit test.

### D3 — A send clears the viewing pointer (item 1, F5)

`noteRecorded` sets `rt.viewing = null` before its eager/lazy branch. A user who presses Send is
asking for *this* response; leaving a stored one on screen is the same complaint as a stale list.
This narrows P8 D10 deliberately — the pointer survives everything else (pane switches, tab
restore, delete of a *different* entry) and "Back to latest" still exists for the other direction —
and it is the one and only place `viewing` is cleared implicitly.

The stored entry is not lost: it is one click away in the list, which is now correct (D1).

### D4 — Thirty, named once per table, mirrored into TS, and pinned by a parity test (item 2)

`historyPerScopeLimit` and `grpcHistoryPerScopeCap` both become **30**. Nothing else about either
table's rules changes.

The renderer needs the same number (D6), and a second hand-written `30` in a `.vue` file is exactly
the drift P8's own `ResponseHistoryList.vue:23` comment already demonstrates — it still says
*"capped at 20 by construction"* in a tree where that is the truth only by luck. So:

- `packages/shared/domain/response-history.ts` gains
  `export const HISTORY_PER_SCOPE_LIMIT = 30;`
- `packages/shared/domain/grpc-history.ts` gains
  `export const GRPC_HISTORY_PER_SCOPE_LIMIT = 30;`
- `tests/unit/go-ts-vocabulary-parity.spec.ts` gains two cases that read the Go source and assert
  the constant literals match (F22's technique: a `const … = <n>` regex over
  `response_history.go` / `grpc_history.go`, failing loudly if either side moves alone).

**Why 30 and not a setting.** The SPEC row names the number; P8 D6 already declined a retention
preference on `internal/logging/sweep.go`'s precedent, and nothing here changes that argument.

**The arithmetic P8 D6 stated, restated at 30.** Worst case per scope: 30 × (256 KiB response +
256 KiB request) ≈ 15 MiB, against a 128 MiB table budget — so the budget starts evicting across
scopes at ~8 saturated requests, exactly as before (it was ~12 at 20). The budget is what bounds the
database; the count cap is what the user experiences. Neither number moves except the count.

**No migration.** Raising a cap deletes nothing and back-fills nothing: an existing scope simply
grows from 20 towards 30 from its next send.

### D5 — Eviction stays where it is: write-time, per scope, inside `Record`'s transaction (item 2)

The SPEC row asks for "oldest evicted first" and leaves write-time-vs-sweep open. It stays
**write-time**, unchanged, because:

- it is already implemented and already correct (`ORDER BY sent_at DESC, rowid DESC LIMIT ?`, F6),
- it is this codebase's established pattern for a bounded per-scope list (F10: `filter_history`,
  `http_variable_history`, both 20, both this SQL),
- a periodic sweep would let a scope exceed its cap *between* sweeps, which makes the "only the last
  30 are kept" message (D6) intermittently false, and
- `Record` is the only writer, so the cap cannot be bypassed (P8 §0.3).

The only change to either statement is the constant.

### D6 — The truncation message is a UI-level statement about the cap, not a stored eviction count (item 2)

At the **bottom** of a history list that has reached the cap, both lists render one muted line:

```
Only the last 30 are kept — older responses are removed automatically.
```

(gRPC: *"older calls"*.) `data-testid="http-history-cap-note"` / `"grpc-history-cap-note"`, styled
like the list's existing `.p-xs dim` captions, rendered when
`entries.length >= HISTORY_PER_SCOPE_LIMIT` and **not** suppressed by an active filter (the note
describes the stored list, not the filtered view — it sits below the rows either way).

**Why this predicate, and what was rejected.** The honest alternatives were (a) a
`Record`-returned "evicted this time" count, or (b) a persisted per-scope "has ever evicted" flag or
a `COUNT(*)` before the trim. Both were rejected: `List` is `≤ 30` by construction, so a count can
never tell the caller more than "the list is full"; the only extra fact either would buy is *"an
eviction has actually happened at least once"*, which needs a new column and a new write path to
answer a question no user asks. At exactly 30 entries the sentence is true and predictive — the next
send *will* evict — which is precisely when the user should read it.

### D7 — gRPC's request message gets the cap every other free-form string already has (item 2, F9/F9a)

In `grpc_history.go`'s `Record`:

```go
message := rec.Message
requestMessageTruncated := false
if len(message) > maxHistoryBodyBytes {          // 256 KiB — response_history.go's own constant,
    message = message[:maxHistoryBodyBytes]      // same package, one number for "a request body"
    requestMessageTruncated = true
}
```

- **256 KiB, not 64 KiB.** `maxGrpcMessageBytes` (64 KiB) is per *response* message and exists
  because a call can store a hundred of them (P11 D11); a request message is exactly one per entry,
  and the honest sibling is HTTP's own request-body cap. Reusing `maxHistoryBodyBytes` across the
  two files in the same package is deliberate: "the request body a user typed" is one policy, not
  two.
- `storedGrpcSnapshot` gains `RequestMessageTruncated bool`, surfaced through
  `model.GrpcCallSnapshot` and `domain/grpc-history.ts`, and rendered as a `MessageStrip tone="note"`
  in gRPC's response pane while a stored entry is being viewed — mirroring HTTP's
  `http-history-truncated` strip (`views/httprequest/ResponsePane.vue:321-323`).
- **The sweep's invariant is restored** and gets a comment saying so: with this cap, no gRPC row can
  exceed the 32 MiB budget, so F9a's table-wipe is unreachable. A Go test asserts it directly
  (§4).

`rec.Metadata` stays uncapped, for F7's stated reason: it is a structured key/value list a user
typed, not free-form bytes.

### D8 — The stored request finally gets a reader: the Raw pane reconstructs it (item 2, F7/F8)

This is the one place this plan reads the SPEC row's *"keep storing the full raw request/response
alongside each entry"* as an obligation rather than a constraint, and the reasoning is F8: the row
is stored, the truncation flag is stored, and **nothing can see either**. "The full raw request is
kept" is not true from the user's side until something renders it.

`RawExchangePane.vue` already computes `viewingStored` (`:33`) and already falls back to
`response.wire`, which is `null` for a stored entry — so today the Raw segment is empty exactly when
a history entry is selected. It gains a stored branch:

- **request document** — generated from `snapshot.request` (method, URL, headers, body) by the same
  `@kira/api-core` generator the Edit-as-raw dialog uses (`raw/generate.ts:59`,
  `generateRawRequest`), given the stored `request` rather than a tab state (a small adapter in
  `api-core`, taking the four fields it actually reads — not a second generator).
- **response document** — status line + headers + body from `snapshot.response`, the same assembly
  the live wire has, in ten lines in the pane.
- **an honest fidelity strip.** P9 D3's three `HttpWireFidelity` values describe *bytes this app
  wrote*; a reconstruction is none of them. Rather than widening the wire enum (which is Go's), the
  pane renders its own `tone="note"` strip while viewing a stored entry: *"Reconstructed from what
  this request was recorded as — not the exact bytes on the wire."* Plus
  `requestBodyStorageTruncated`'s own note, at last.
- **No new storage, no secrets.** The stored request is stage-1 text (F7), so a secret is spelled
  `{{name}}` here exactly as it is in the request builder. This adds no reveal surface and nothing
  new to `kira.sqlite` — which is precisely why P9 D7's objection (storing rendered text would
  double a snapshot) does not apply: nothing is stored, the text is computed in the renderer from
  what is already there.

This is sequenced **last** (S15) and is the one commit that can be dropped without disturbing any
other item, if the phase runs long (§6 OQ-4).

### D9 — The gRPC parity list, item by item (item 3)

The SPEC row asks for a decision per item rather than assumed 1:1 parity. Twelve items across
P15 (eight) and P15b (four):

| P15/P15b item | State in gRPC | Decision |
|---|---|---|
| P15 #1 — response panel present from tab open | **Missing** (F12): the whole pane is behind `v-if="hasResult \|\| hasHistory"` | **Fix** — D14 |
| P15 #2 — the status code's meaning on its own always-visible line | **Missing** (F13): no hint table; the row shows the server's `statusMessage` as a truncatable caption | **Fix** — D13, and the server message moves to its own line beside it |
| P15 #3 — mode-switch buttons | n/a — that is this phase's item 4 | — |
| P15 #4 — table fields fill their cells | **Landed** (F11) | none |
| P15 #5 — the Checkbox primitive | **Landed** (F11) | none |
| P15 #6 — JSON as a top-level body mode | **Does not apply**: a gRPC request message is always JSON. There is no body-mode vocabulary to promote a segment into, and inventing one would be a worse UI, not a more consistent one | none, stated |
| P15 #8 — a body-present tab badge | **Does not apply**, and P15 D8 said so itself (F17): every gRPC call has a message, so the mark would be on every tab always | none |
| P15 #9 — Save in the view head; the input takes the toolbar row | **Missing** (F14), *and* the target field carries P15 F3's exact no-op `style="flex: 1"` | **Fix** — D14 |
| P15b #7 — name-cell autocomplete over a curated vocabulary | **Missing**: metadata names are plain `TextField`s | **Fix**, with a gRPC-specific vocabulary — D12 |
| P15b #10 — `{{variable}}` colouring, hover and completion | **Missing everywhere** (F15): target, metadata values, message editor | **Fix** — D10, D11 |
| P15b #11 — auto-closing pairs | **Landed for the fields** by inheritance (F11); **missing for the message editor** (F16) | **Fix** the editor only — one attribute |
| P15b #12 — arrow-key navigation across row tables | **Landed** (F11) | none |

Five fixes, four already-landed, three deliberate non-applications.

### D10 — gRPC's three `{{variable}}` surfaces, and the one that is genuinely different (item 3)

`GrpcRequestView.vue` gains the same one-line computed HTTP has
(`const variables = computed(() => variableSupport(collectionId.value, activeEnvironmentId.value))`,
`HttpRequestView.vue:164`), over the collection/environment watch it **already** runs (`:149-156`):

1. **The target field** — `TextField` → `AutocompleteField` with `:token-at="templateToken"` and the
   three `variables` props, exactly as the URL field (`HttpRequestView.vue:318-330`). Its
   `data-testid="grpc-target"` stays on the real `<input>` (`inheritAttrs: false`), so
   `grpc-request.spec.ts`'s five `page.fill()` calls keep working — the same guarantee P15b D3 gave
   for the URL field, and the reason that decision kept these fields as real inputs at all.
2. **Metadata value cells** — `MetadataTable.vue`'s value `TextField` → `AutocompleteField`, wired
   from a new optional `variables?: VariableSupport` prop passed down from the view. Metadata values
   carry `{{token}}` references constantly (an Authorization bearer is the canonical case), so this
   is the highest-value one of the three.
3. **The message editor** — `CodeMirrorHost` gains `:range-highlights="variables.rangeHighlights"`
   and `auto-close-brackets`, mirroring `RequestBodyPane.vue:154`/`:163`. It does **not** get
   `hoverAt`: P15b D3's hover is a field-local panel on `AutocompleteField`'s overlay, not a
   CodeMirror extension, and the body editor has no hover in HTTP either — parity here means
   matching what HTTP's editor has, not exceeding it.

### D11 — `variableCompletion.ts` moves to `api/state/`, on P12 D12's precedent (item 3, F15)

`views/httprequest/variableCompletion.ts` → `api/state/variableCompletion.ts`, unchanged except its
own header comment. This is exactly the move P12 D12 made when gRPC needed the history runtime HTTP
had (`api/state/history.ts`), and it is legal in the direction that matters: `api/**` may not import
`views/**`/`project/**`/`workbench/**`, and this module imports none of them — only `@kira/api-core`,
`api/state/variables.ts`, `editor/variableHighlight.ts` (a type) and `theme/primitives/completion.ts`.

Seven import lines change (`HttpRequestView`, `FieldRowsTable`, `FormDataTable`, `RequestBodyPane`,
`RequestHeadersTable`, `QueryParamsTable`, `UrlEncodedTable`), all type-only except the first. No
re-export shim is left behind: a shim is how two import paths for one module survive for a year.

### D12 — A gRPC metadata vocabulary, in `api-core`, beside the header one (item 3, P15b #7)

`packages/api-core/src/grpc/metadata.ts`, exporting `WELL_KNOWN_REQUEST_METADATA` in
`WELL_KNOWN_REQUEST_HEADERS`' shape (`http/headers.ts:10-31`: a structural `HeaderCompletion`, no
app import, `icon: 'symbol-field'`, a one-word `detail`). Wired into `MetadataTable.vue`'s **name**
cell with `wholeFieldToken`, for P15b D7/F1's reason verbatim (the default word-run tokenizer has no
`-`, so `grpc-tim` would tokenize as `tim`).

The list is **not** HTTP's. gRPC metadata keys are lowercase by wire rule (the table's own
placeholder already says *"key (lowercase, - _ . only)"*), and the two sets barely overlap:

- *auth* — `authorization`, `x-api-key`, `cookie`
- *call* — `grpc-timeout`, `grpc-encoding`, `grpc-accept-encoding`, `grpc-message-type`
- *tracing* — `x-request-id`, `traceparent`, `tracestate`, `user-agent`

Deliberately excluded, with a comment saying why: the HTTP/2 pseudo-headers (`:authority`, `:path`,
`:method`, `:scheme`) and `te`/`content-type`, which the client sets itself and a user must not; and
`grpc-status`/`grpc-message`, which are trailer-only — the same "this feeds the *request* table,
never a response viewer" rule `WELL_KNOWN_REQUEST_HEADERS` states for `Set-Cookie` and friends.

### D13 — `grpcCodeHint()`, beside `grpcCodeClass` (item 3, P15b's sibling of P15 D2)

`packages/shared/domain/grpc.ts` gains a per-code sentence table over the seventeen codes, in
`statusHint`'s exact shape and register (`domain/http.ts:340-386` — lowercase, no trailing period,
a sentence a person can act on):

```
0  OK                 the call completed
3  InvalidArgument    the server rejected the request message itself
4  DeadlineExceeded   the call ran past its deadline before the server answered
5  NotFound           the server has no such method or resource
7  PermissionDenied   the caller is authenticated but not allowed to make this call
12 Unimplemented      the server does not implement this method
14 Unavailable        the server could not be reached, or is not accepting calls right now
16 Unauthenticated    the call carried no valid credentials
…
```

with a fallback for an unrecognised integer (a code is a wire integer; a server may send one outside
the table). Rendered on its own always-visible line under the status row —
`data-testid="grpc-status-hint"`, the P15 D2 shape — with the server's own `statusMessage` on the
line below it (`data-testid="grpc-status-message"`, testid preserved), where it is free to wrap
instead of being ellipsised inside a toolbar.

`grpcCodeHint` lives in `packages/shared/domain/`, not in the view, for `grpcCodeClass`'s own stated
reason: `http/**` may not import `views/**`, and the collections tree already needs code vocabulary.

### D14 — gRPC's chrome and toolbar take HTTP's shape (item 3, P15 D1/D4/D7)

`views/grpcrequest/ResponsePane.vue`:

- The `v-if="hasResult || hasHistory"` wrapper is removed. The status row, the pane switcher and the
  strips render from tab-open; only the response-dependent *contents* stay conditional — P15 D1's
  exact split, with the `v-else` EmptyState becoming the Messages pane's own empty state (which
  already exists at `:267-278`, complete with the "N past calls · View history" link, and is
  currently unreachable before a first call).

`views/grpcrequest/GrpcRequestView.vue`:

- **Save moves into `#badges`**, beside the request name and after the dirty mark — same
  `AppButton icon="save"`, same `data-testid="grpc-save"`, same disabled rule and tooltip
  (P15 D7's own "the first control ever placed in a view head" note already covers the LAW 09
  exception; this is its second instance, not a new precedent).
- **The target field gets the wrapper it never had**: `style="flex: 1"` deleted,
  `<div class="grpc-target-field">` around it with `flex: 1; min-width: 0` and
  `:deep(.p-input) { width: 100% }` — P15 D4 verbatim (F14). The row becomes
  refresh · stop · **target (all remaining space)** · TLS · method · Call.

### D15 — The mode tab follows the app's own icon law, and becomes measurable (item 4, F18)

`TitleBar.vue`:

```html
<button class="p-tab mode-tab" …>
  <span class="icon-box"><CodiconIcon :name="MODES[mode].icon" :size="13" /></span>
  <span class="mode-label">{{ MODES[mode].label }}</span>
</button>
```

```css
.mode-tab { padding: 0 var(--kira-s-5); gap: var(--kira-s-2); }
.mode-tab .mode-label { line-height: 1; }
```

Three changes, each with its own justification:

1. **`.icon-box`** — the app's stated law (`AppButton.vue:29`, `MethodSelect.vue:65`,
   `primitives.css:25-32`), and mechanically the fix for F18's point 1: a 16 px flex-centred square
   centres the glyph's *advance*, so `database`'s 2.4 px right bearing and `globe`'s 0.8 px stop
   leaking into the gap between icon and label. This is the one measured, unique-to-this-button
   defect, and it is why the two tabs currently look inconsistent with each other.
2. **A real `<span>` for the label** — `TabStrip.vue`'s own shape, and the thing that makes the
   result testable at all: an anonymous flex item has no element, no class and no rect. `line-height: 1`
   gives it a box tight to its text rather than Tailwind preflight's inherited 1.5, so both flex
   items are ink-tight boxes centred on one axis.
3. **Nothing else.** `--wails-draggable: none` and the `:hover` rule stay (both load-bearing, per
   the file's own comments); no token changes; the height stays `--kira-h-md`, because P15 D9's
   arithmetic (26 px inside 38 px) is not what this report is about and `tokens.css:76-88` records
   two prior wrong guesses at title-bar sizes.

**What this does not claim.** F18's point 2 — the ≈0.5 px optical offset from the codicon em box
being ascent-only against Menlo's cap metrics — is shared by every icon+label control in this app
and is **not** corrected here. Correcting it means a sub-pixel `translateY` on `.icon-box`
app-wide, which is a design-system change affecting several dozen call sites on the strength of
arithmetic no one has yet seen rendered — exactly the move P15 §4 declined once already. If the
report survives this fix, that is the next step and it belongs in its own pass (§6 OQ-3).

**The guard** is a measurement, not a screenshot: a `mode-switch.spec.ts` case that reads both
elements' `getBoundingClientRect()` and asserts (a) the vertical centres of the icon box and the
label agree within 1 px, and (b) the icon-box→label gap is **the same on both tabs** — the property
that is false today and cannot be asserted at all before this change.

### D16 — Environment colour is user-assigned, from the one palette, and never derived (item 5)

Per F19, and matching the SPEC row's own framing (*"the same colour-coding treatment Studio already
gives DB connections"*, *"a deliberate cross-reference … rather than a new colour scheme invented
from scratch"*):

- The stored set is the **same twelve values plus `'none'`**; the offered set is the same
  `CONNECTION_COLOR_CHOICES` subset (six hues + grey + none), for P42 D34/D35's hue-gap reason,
  which applies identically to a 2 px rail and a 5 px dot regardless of what the rail belongs to.
- **`'none'` is the default.** No environment is auto-coloured. A hash-of-the-name scheme was
  considered and rejected on three grounds: the design system says *"No colour is the default"* in
  as many words; a derived colour cannot be changed by a user who dislikes it; and two workspaces
  would colour the same "Production" differently, which is the opposite of the recognisability the
  feature is for.
- **No new tokens, no second palette.** P17 D19 already set the precedent for *reusing* this palette
  through an indirection (`--kira-method-get: var(--kira-conn-blue)`); an environment does not even
  need the indirection, because it is a user choice from the same list, not a fixed mapping.

### D17 — The colour appears as a rail and a dot, and nowhere else (item 5, LAW 07)

| Surface | Treatment | Why |
|---|---|---|
| `EnvironmentSelect` closed state | a 5 px `.p-conn-dot` before the name | LAW 07's "dot"; this is the control the SPEC row means by *"wherever the active environment is surfaced in the request panel"* |
| `EnvironmentSelect` open list | a dot per row, including "No environment" (rendered `.p-conn-dot.none`) | the chooser shows what it is choosing between |
| Both request views' toolbar cap | `.p-toolbar-rail` takes the active environment's colour | **the exact analogue the SPEC row asks for**: LAW 07's "a cap on the view's toolbar" is how a query console shows its connection, and the slot is reserved and empty in Api mode today (F20 #6) |
| Both request views' head | `ViewHeader`'s dot | LAW 07's "dot (view header)" |
| `VariableSetView` (an environment's own tab) | rail + head dot, and the `ColorPicker` in `.env-fields` | this is where the colour is *assigned*, beside name and description — the ConnectionDialog's own name+colour arrangement |
| `EnvironmentsDialog` rows | a dot at the row head | the manage list, where a user compares environments |
| `VariablesOverviewPanel` | a dot beside *"Edit environment variables…"* | P17 D20's panel already names the environment there |

**Deliberately not coloured:**

- **History rows.** A stored entry carries the environment's *name*, denormalised at write time
  (F6) — no id, and the environment may since have been renamed, recoloured or deleted. Painting a
  colour there would mean a name-based join that is wrong exactly when it matters.
- **The tab strip.** Studio's tab rail is the tab's *own* connection (`TabStrip.vue:174`), stable
  for the life of the tab. The active environment is app-global: a rail there would repaint every
  Api tab at once on every environment switch, which is motion without information. The rail slot
  stays reserved and empty for Api tabs, exactly as today.
- **The collections tree.** A collection is not an environment; nothing to colour.

### D18 — `ColorPicker` is promoted to the shared theme layer, and the palette gets a neutral name (item 5)

- **`project/ColorPicker.vue` → `theme/primitives/ColorPicker.vue`.** `api/**` may not import
  `project/**` (F19), and this is the same promotion P15 D5 made for the Checkbox, on the same
  stated grounds (primitives live in the shared theme layer; `AppButton`/`TextField`/
  `SegmentedControl` are the precedent). `ConnectionDialog.vue`'s import line changes; the component
  itself changes only its `aria-label` (from "Connection color" to a `label` prop) and its prop type.
- **`packages/shared/domain/color.ts`** (new) holds `paletteColorSchema`, `PaletteColor` and
  `PALETTE_COLOR_CHOICES`; `domain/connection.ts` keeps `connectionColorSchema`, `ConnectionColor`
  and `CONNECTION_COLOR_CHOICES` as re-exported aliases of them, with its existing comments intact.
  Zero call-site churn in Studio, an honest name for the shared thing, and one palette *by
  construction* rather than by two lists that happen to match.
- **Go:** `model.ValidPaletteColor` is the new name, `ValidConnectionColor` kept as a one-line alias
  so `repos/connections.go` and the connection bridge are untouched.
- **Unrecognised colours are coerced, not dropped.** `repos/connections.go:53` drops a connection row
  whose colour it does not recognise; `ListEnvironments` must **not** copy that: an environment owns
  variables (and a collection's requests reference it), so losing one over a cosmetic column is a
  data-loss bug waiting for a hand-edited database. An unrecognised value is read as `'none'` with
  the same `slog.Warn`.

### D19 — The storage and wire path for one column (item 5)

- **Migration** `0012_p18_environment_color.sql`:
  `ALTER TABLE api_environments ADD COLUMN color TEXT NOT NULL DEFAULT 'none';` — F21's shape, with
  the same "metadata change, not a table rewrite" note, and `'none'` (not `''`) as the default so
  every existing row is already a valid palette value.
- **Go:** `model.Environment.Color string`; `color` added to the five statements in
  `repos/variables.go` that read or write an environment (`ListEnvironments` `:45`,
  `CreateEnvironment` `:80`, `UpdateEnvironment` `:96`, `DuplicateEnvironment`'s source read `:131`
  and its insert `:149` — **a duplicate inherits the original's colour**, which is what "clone"
  means and what P17 D17 does for name and description).
- **Bridge:** `Color` on `VariablesCreateEnvironmentArgs` and `VariablesUpdateEnvironmentArgs`,
  rejected with `ipcerr.BadRequest` if `!model.ValidPaletteColor(args.Color)` — P17's
  "renaming and describing are one row update" extended to three fields, not a second IPC call for a
  swatch click.
- **TS:** `ApiEnvironment.color: PaletteColor`; `variablesCreateEnvironment` /
  `variablesUpdateEnvironment` gain the parameter; `api/state/variables.ts`'s
  `updateEnvironment(id, name, description)` becomes `(id, name, description, color)` and its two
  call sites (the dialog's blur handler, the tab's `onEnvFieldBlur`) pass it.
- **`EnvironmentSelect` becomes app-drawn**, on P17 D18's precedent and for its exact reason: a
  native `<option>`'s per-row colour is `option`-level styling that lands only under
  `appearance: base-select` where the engine implements it. It becomes a `.p-select.bordered`
  `<button>` + `PopoverPanel`, copied from `MethodSelect.vue:32-71` — so the **closed state's
  height, border and padding do not change at all** (P16 D6's rule, which
  `api-ui-consistency.spec.ts:424` already guards for the method select and which §4 extends to this
  one). "Manage environments…" stays as the list's last row.

---

## 3. Commit sequence

Shared/domain and Go first (what the rest consumes), then the Api surfaces, then workbench chrome,
then tests. Per `AGENTS.md`: `bun run lint`, `bun run typecheck` and `bun run build` per commit;
`bun run test:go` after each Go commit; `tests/ui` runs **once** at the end (§4), with fixes as
follow-up commits.

| # | Commit | Item | Touches | Risk |
|---|---|---|---|---|
| S1 | `fix(api): the history list refreshes after a send it did not see` | 1 | `api/state/history.ts`, `views/httprequest/history.ts`, `views/grpcrequest/history.ts`, the four consuming components' call sites | low — one renamed export, one new predicate |
| S2 | `fix(api): a history runtime record is always the reactive proxy` | 1 | `api/state/history.ts` (3 lines) | trivial; must follow S1 (same file) |
| S3 | `feat(storage): response history keeps thirty entries per request` | 2 | `repos/response_history.go`, its two test files, `domain/response-history.ts` | low |
| S4 | `feat(storage): gRPC call history keeps thirty, and caps the request message` | 2 | `repos/grpc_history.go`, its three test files, `model/grpc.go`, `domain/grpc-history.ts` | medium — D7 changes a stored shape; the snapshot decode must tolerate rows written before it |
| S5 | `test(storage): the per-scope caps are one number on both sides` | 2 | `tests/unit/go-ts-vocabulary-parity.spec.ts` | trivial |
| S6 | `feat(api): a history list that is full says so` | 2 | `ResponseHistoryList.vue`, `CallHistoryList.vue` | trivial |
| S7 | `refactor(api): variable completion moves beside the state it reads` | 3 | `api/state/variableCompletion.ts` (moved), 7 import lines | low — a move plus imports |
| S8 | `feat(api): the gRPC request view colours and completes its {{variables}}` | 3 | `GrpcRequestView.vue`, `MetadataTable.vue`, `packages/api-core/src/grpc/metadata.ts` + `index.ts` | medium — the target field changes element (testids preserved, D10) |
| S9 | `fix(api): the gRPC response pane is a panel from the moment a tab opens` | 3 | `views/grpcrequest/ResponsePane.vue`, `domain/grpc.ts` (`grpcCodeHint`) | low |
| S10 | `fix(api): gRPC's Save sits with the request's name; the target takes the row` | 3 | `GrpcRequestView.vue` | low; must follow S8 (same file) |
| S11 | `fix(workbench): the mode tabs box their icon and name their label` | 4 | `workbench/TitleBar.vue` | low — Studio-visible |
| S12 | `refactor(theme): the colour picker and the palette are shared, not Studio's` | 5 | `theme/primitives/ColorPicker.vue` (moved), `domain/color.ts` (new), `domain/connection.ts`, `model/connection.go`, `project/ConnectionDialog.vue` | medium — touches Studio; `connections.spec.ts` is the guard |
| S13 | `feat(api): an environment carries a colour` | 5 | migration `0012`, `model/variables.go`, `repos/variables.go`, `bridge/variables.go`, `domain/variables.ts`, `bridge/apiControl.ts`, `api/state/variables.ts` | medium — one migration |
| S14 | `feat(api): the active environment is visible by colour` | 5 | `EnvironmentSelect.vue` (app-drawn), `VariableSetView.vue`, `EnvironmentsDialog.vue`, `VariablesOverviewPanel.vue`, `ViewChrome.vue`, `ViewHeader.vue`, both request views | medium — a control changes element; must follow S13 |
| S15 | `feat(api): a stored response can show what was sent` | 2 | `RawExchangePane.vue`, `views/httprequest/ResponsePane.vue`, `packages/api-core/src/http/raw/generate.ts` | medium — D8, droppable (§6 OQ-4) |
| S16 | `test(p18): the specs §4 enumerates` | — | `tests/ui/*.spec.ts`, `tests/unit/history-runtime-reactivity.spec.ts` | low |

**Ordering constraints:** S2 after S1; S5 after S3/S4; S10 after S8; S14 after S13; S12 before S13.
Everything else is independent — S7-S10 (item 3), S11 (item 4) and S12-S14 (item 5) do not touch
each other's files and may be implemented in parallel if the implementer is split that way.

---

## 4. Verification plan

### 4.1 Unit (`bun run test:unit`)

1. **`tests/unit/history-runtime-reactivity.spec.ts` (new)** — the D1/D2 guard, in
   `tree-state.spec.ts`'s established style (`effect()` from `vue`, no DOM):
   - a write through the record returned by the *first* `ensure()` call triggers an effect that read
     it through the store (D2 — this test fails on the current `return rt`);
   - `noteRecorded` with the pane not on History sets `stale` and performs **no** list call;
   - `ensureFresh` on a stale, already-loaded runtime performs exactly **one** list call, and clears
     `stale`;
   - `ensureFresh` on a fresh, already-loaded runtime performs **none** (the laziness P8 D11 bought
     is still bought);
   - two `ensureFresh` calls in one tick perform one call (the `loading` guard);
   - `noteRecorded` clears `viewing` (D3).
2. **`tests/unit/go-ts-vocabulary-parity.spec.ts`** — two new cases (D4): the `historyPerScopeLimit`
   and `grpcHistoryPerScopeCap` literals in the Go sources equal `HISTORY_PER_SCOPE_LIMIT` and
   `GRPC_HISTORY_PER_SCOPE_LIMIT`.

### 4.2 Go (`bun run test:go`)

3. **`repos/response_history_test.go`** — the existing per-scope case restated: 35 recorded against
   one `item_id` leaves **30**, and they are the 30 newest; three independent scopes keep 30 each.
4. **`repos/grpc_history_test.go`** — the same at 30, plus **D7**: a 1 MiB request message is stored
   at 256 KiB with `RequestMessageTruncated` true and every other field intact; a 64 KiB one is
   stored whole with the flag false.
5. **`repos/grpc_history_internal_test.go`** — **F9a, directly**: with the budget shrunk via
   `SetGrpcHistoryByteBudgetForTest`, recording an entry whose request message is far larger than
   the budget leaves the table non-empty (it fails on the current code, which empties it) and leaves
   the just-inserted row present.
6. **`repos/variables_test.go`** — colour round-trips through create/update/list; a duplicate
   inherits it; an unrecognised stored value reads back as `'none'` **without** dropping the row
   (D18).
7. **`migrations/migrate_rename_test.go`** — a database seeded before `0012` migrates with every
   environment at `'none'`.

### 4.3 UI (`bun run test:ui`) — the cases this phase owes

8. **`http-history.spec.ts` — "the list refreshes after a send made while another pane was
   showing"**: open a request, send once, stay on Body, send a second time with a different mocked
   status, switch to History → **two** rows, newest first. This is the reported bug, and it fails on
   `c4bb908`.
9. **`http-history.spec.ts` — "sending while viewing a stored response shows the new one"** (D3):
   click a history row, send, assert the viewing band is gone and the new status is on screen.
10. **`http-history.spec.ts` — "a full list says only the last thirty are kept"** (D6): mock a list
    of 30 → the note is present; 29 → absent.
11. **`grpc-request.spec.ts` — the same two history cases** for the gRPC list.
12. **`grpc-request.spec.ts` — "a freshly opened gRPC tab shows the response pane switcher before
    any call"** (D14), the direct sibling of `api-ui-consistency.spec.ts:152`.
13. **`grpc-request.spec.ts` — "a non-OK status shows what the code means and what the server
    said"** (D13): both lines, distinct testids.
14. **`grpc-request.spec.ts` — "the target field fills the toolbar row"** (D14): its box width is
    within a few pixels of the row's free space, the assertion P15 used for the URL field.
15. **`api-ui-consistency.spec.ts` — "the gRPC target paints a resolved reference and an unknown one
    differently"** and **"a metadata name cell suggests `grpc-timeout`"** (D10, D12), mirroring the
    existing URL-field and header-name cases at `:300` and `:357`.
16. **`mode-switch.spec.ts` — "a mode tab's icon and label share a centre line, and both tabs
    measure the same gap"** (D15's guard, F18's point 1).
17. **`api-ui-consistency.spec.ts` — "the environment select opens an app-drawn menu carrying each
    environment's colour, and its closed height matches the controls beside it"** (D19), extending
    the D6 height case at `:424` and the method-menu case at `:690`.
18. **`api-ui-consistency.spec.ts` — "an environment's colour reaches the request view's toolbar cap
    and head dot, and changes when the active environment changes"** (D17).
19. **`http-history.spec.ts` — "a stored entry's Raw view shows what was sent"** (D8, with S15).

### 4.4 What is deliberately not verified automatically

- **A real macOS render of the title bar.** Still declined, for P15 §4's reason and P18's own: the
  claim this phase makes is geometric (F18 point 1) and case 16 measures exactly it. The ≈0.5 px
  optical residual (F18 point 2) is explicitly *not* claimed fixed, so there is nothing to assert.
- **A pixel diff of the colour surfaces.** No such harness exists (P13 §7, P15 §4). Cases 17/18
  assert the CSS custom property and the element's presence, which is the property that can be
  wrong.

---

## 5. What this phase deliberately does not do

- **Give gRPC P16's response find bar or P17's app-drawn method select.** Item 3 is a P15/P15b
  parity pass, and widening it to "every phase's Api work" would make the batch unbounded. Both are
  real gaps; both should be their own row if the user reports them.
- **Colour a history row, a tab, or a collection** — D17 states the reasoning for each.
- **Correct the app-wide icon/text optical offset** (F18 point 2) — D15 states why, and §6 OQ-3
  records what would trigger it.
- **Add a retention preference, a "restore evicted entry" affordance, or an export** — P8 D6's
  posture, unchanged.
- **Change what a stored entry contains.** D7 adds a cap and a flag; D8 adds a *reader*. Neither
  stores anything new, and the stage-1 (secret-free) invariant of F7 is untouched.
- **Deduplicate `MetadataTable.vue` against `FieldRowsTable.vue`.** P11 F18 and P15b D6 both
  accepted the copy deliberately, against the `views/<kind>` import ban; D10 adds one prop to each
  rather than reopening that trade at the end of a five-item batch (§6 OQ-2).

---

## 6. Open questions, with their resolutions

**OQ-1 — Should the response pane's "N past responses" count refresh eagerly after every send,
rather than at the next mount?**
*Resolved: no.* It is only visible when there is no live response to show, which after a send there
always is. D1's `ensureFresh` refreshes it the moment anything mounts over it, and an eager refetch
per send would spend the IPC P8 D11 explicitly declined to spend, for a number nobody is looking at.

**OQ-2 — Should `MetadataTable.vue` and `FieldRowsTable.vue` finally become one component, now that
a third and fourth shared behaviour (variable support, name completion) is being copied into both?**
*Resolved: not in this phase.* The blocker is `biome.json`'s `views/<kind>` ban, so unifying means a
new shared home under `views/shared/` for a generic row table — a real refactor with its own risk,
landing in the middle of a five-item user-driven batch. P11 F18 and P15b D6 both wrote the trade
down and took the copy; D10's additions are one prop and one element swap each. Recorded here as the
third consecutive phase to pay this tax — if a fourth arrives, the refactor is overdue and should be
its own row.

**OQ-3 — Is the ≈0.5 px optical offset between a codicon glyph and its label (F18 point 2) worth an
app-wide correction?**
*Resolved: not on arithmetic alone.* It is real and it is measurable from the font, but it is
uniform across every icon+label control in the app, so it cannot be what makes the mode tabs look
wrong relative to their neighbours. D15 fixes the part that is unique to them. If the user still
reports misalignment after S11 ships, the fix is a single `transform: translateY(-0.5px)` inside
`.icon-box` in `primitives.css` — one line, one place, app-wide — and it wants a real render before
it lands, not another round of arithmetic.

**OQ-4 — Is D8 (a reader for the stored request) in this phase's scope, or a new feature?**
*Resolved: in scope, sequenced last.* The SPEC row says *"keep storing the full raw request/response
alongside each entry"*; F8 found the storage is real and has no reader, which makes the sentence
untrue in the only sense a user can check. It costs one branch in a pane that already computes
`viewingStored`, stores nothing new, and adds no reveal surface. It is S15 — the last commit — so
that if the batch runs long it can be dropped without touching any other item, and it becomes its
own row.

**OQ-5 — Should the truncation note be suppressed while a filter is active?**
*Resolved: no.* The note is about what is *stored*, not what is shown; the filter's own "N matches"
affordance (P16 D15) already describes the view. Hiding a fact about storage because a lens is open
is how P24 D7's "a closed toolbar must never leave rows hidden with no visible cause" bug class
starts.

**OQ-6 — Should the environment colour also mark a *saved request* that belongs to a collection with
an environment?**
*Resolved: no, and the question is malformed.* A request belongs to a collection; an environment is
app-global and orthogonal (P5 D3 — `is_active` is a column on the environment row, not a per-request
binding). There is nothing per-request to colour.

---

## Checklist

- [ ] S1 `fix(api): the history list refreshes after a send it did not see`
- [ ] S2 `fix(api): a history runtime record is always the reactive proxy`
- [ ] S3 `feat(storage): response history keeps thirty entries per request`
- [ ] S4 `feat(storage): gRPC call history keeps thirty, and caps the request message`
- [ ] S5 `test(storage): the per-scope caps are one number on both sides`
- [ ] S6 `feat(api): a history list that is full says so`
- [ ] S7 `refactor(api): variable completion moves beside the state it reads`
- [ ] S8 `feat(api): the gRPC request view colours and completes its {{variables}}`
- [ ] S9 `fix(api): the gRPC response pane is a panel from the moment a tab opens`
- [ ] S10 `fix(api): gRPC's Save sits with the request's name; the target takes the row`
- [ ] S11 `fix(workbench): the mode tabs box their icon and name their label`
- [ ] S12 `refactor(theme): the colour picker and the palette are shared, not Studio's`
- [ ] S13 `feat(api): an environment carries a colour`
- [ ] S14 `feat(api): the active environment is visible by colour`
- [ ] S15 `feat(api): a stored response can show what was sent`
- [ ] S16 `test(p18): the specs §4 enumerates`
- [ ] `bun run lint`, `bun run typecheck`, `bun run build` clean
- [ ] `bun run test:unit`, `bun run test:go` green
- [ ] `bun run test:ui` run once at the end; failures fixed as follow-up commits
- [ ] `docs/v1.2/SPEC.md`'s P18 row marked implemented

---

## 7. Sources

**Read at `c4bb908`.** Frontend: `api/state/history.ts`, `api/state/variables.ts`,
`api/EnvironmentSelect.vue`, `api/MethodSelect.vue`, `api/VariablesOverviewPanel.vue`,
`api/VariableSetView.vue`, `api/EnvironmentsDialog.vue`, `views/httprequest/{history,state,
variableCompletion}.ts`, `views/httprequest/{HttpRequestView,ResponsePane,ResponseHistoryList,
FieldRowsTable,RawExchangePane}.vue`, `views/grpcrequest/{history,state}.ts`,
`views/grpcrequest/{GrpcRequestView,ResponsePane,MetadataTable,CallHistoryList}.vue`,
`theme/primitives/{AppButton,TextField,AutocompleteField,ViewChrome,ViewHeader}.vue`,
`theme/{connColor.ts,CodiconIcon.vue,primitives.css,tokens.css,base.css}`,
`project/ColorPicker.vue`, `workbench/{TitleBar,modes.ts}`, `workbench/panels/TabStrip.vue`,
`state/tabKinds.ts`, `editor/CodeMirrorHost.vue`, `bridge/apiControl.ts`, `biome.json`.
Go: `internal/storage/repos/{response_history,grpc_history,variables,filter_history,connections}.go`,
`internal/storage/model/{responsehistory,grpc,variables,connection}.go`,
`internal/bridge/{http,grpc,variables}.go`, `internal/storage/migrations/`.
Shared: `packages/shared/domain/{http,grpc,response-history,grpc-history,variables,connection}.ts`,
`packages/api-core/src/http/headers.ts`, `packages/api-core/src/http/raw/generate.ts`.
Tests: `tests/ui/{http-history,grpc-request,api-ui-consistency,mode-switch}.spec.ts`,
`tests/unit/{go-ts-vocabulary-parity,tree-state}.spec.ts`.
Docs: `docs/v1.2/SPEC.md`, `docs/v1.2/plans/{P8,P15,P15b,P16,P17}*.md`,
`docs/design/kira-design-system/README.md` and `parts/_style.css`, `AGENTS.md`.

**Measured, not assumed.** `@vscode/codicons@0.0.46-24`'s `codicon.ttf` was parsed directly
(`head`, `hhea`, `OS/2`, `cmap`, `loca`, `glyf`) for F18's numbers: `unitsPerEm 300`, `hhea`
ascender `300` / descender `0`, `database` (U+EACE) bbox `x ∈ [0,244] y ∈ [0,282]`, `globe`
(U+EB01) bbox `x ∈ [0,282] y ∈ [0,282]`, advance `300` for both.

**Git history.** `git log -S` over `stale` and its would-be readers, establishing F2 (the flag has
had no reader in any commit since P8's `a4a33fb`), and `git log -- workbench/TitleBar.vue`
establishing P15's `9b4ccce` as the change item 4 reports against.
