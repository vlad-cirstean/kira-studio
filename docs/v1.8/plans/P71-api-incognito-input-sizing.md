# P71 — API module: per-tab incognito mode, 4-row auto-growing inputs

`docs/v1.8/SPEC.md`'s P71 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `6a32be82`, v1.7's tip plus the chapter-opening docs
commit); line numbers are from that tree.

Two unrelated items, one phase, no dependency on any other v1.8 row:

**A. Incognito mode per API tab.** A per-tab toggle. While on, nothing that tab does reaches
SQLite: no tab record, no response/call-history row, no op-log row, no collection write, no active-
environment write. Everything else about the tab — rendering, sending, reading responses, resolving
variables — is unchanged.

**B. 4-row auto-growing inputs.** The API module's single-row request-content cells grow up to four
rows as text is typed or pasted, then scroll internally instead of clipping.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| "how a per-tab flag suppresses these backend writes without a parallel in-memory storage layer duplicating every write path" | Suppress, don't mirror. One in-memory flag, one filter on the single tab-snapshot writer, one guard per remaining write call. The write set is small and closed — §1 enumerates all of it | §2 |
| Where the flag lives | `state/tabIncognito.ts`, a leaf module — not `tabsState`, because `state/tabKinds.ts` needs to read it and `state/tabs.ts` already imports `tabKinds.ts` (a cycle). Same shape as `state/cellSelection.ts`/`state/tabRuntime.ts` | §2.1 |
| Whether the Go side changes | Yes, unavoidably: response history, gRPC call history and the op log are all written in Go, inside the send itself. One `incognito` field per send args, three guards | §4 |
| Whether the op log counts as "persists" | Yes. `op_log.command` stores `POST <url> → 200 OK` and outlives the tab in the Operations panel | §4.3 |
| gRPC request tabs | In scope. Same module, same history table, same three write paths; leaving them out would be the half-implementation `CLAUDE.md` forbids | §1, §3 |
| The active environment (an app-global, persisted row) | Per-tab and in-memory while incognito, not disabled — switching environment is the main reason to open an incognito tab at all | §3.3 |
| The indicator | Icon in the tab strip (beside `is-preview`'s own precedent) plus a chip in the view head. Toggle in the view toolbar and the tab context menu | §5 |
| How a 4-row grow is built | `<textarea>` behind an opt-in `grow` prop on the two field primitives, auto-sized by a CSS grid replica, clamped at 4 rows. No JS height writes, no library | §8 |
| Which inputs grow | The request-content cells of both request views' row tables. The URL/target field and the Monaco-backed body editors are excluded, with reasons | §9 |
| Tests | None new. The one thing worth adding is an extension to an existing UI spec | §11 |
| One Sonnet pass or a split | One. If split, the A/B line is the only seam — the two halves are file-disjoint | §12.2 |

---

# Part A — incognito

## 1. Confirmed current state: every write path an incognito tab can reach

Enumerated by reading `apps/kira-studio/frontend/src/api/**`, `views/httprequest/**`,
`views/grpcrequest/**` and every `control.*` call in them, then following each into Go.

### 1.1 Writes reachable from a request tab

| # | Write | Where | Suppressed by |
|---|---|---|---|
| 1 | The tab record itself — url, headers, body, every keystroke — into `tabs` | `state/tabs.ts:126`-`154` (`saveIfChanged`) and `:179`-`185` (`flushPendingTabState`), via `bridge/index.ts:354` → `TabsService.Save` → `TabsRepo.Save` | §3.1 |
| 2 | A response-history row per send | `internal/bridge/http.go:122`-`133`, inside the `RunOp` closure | §4.1 |
| 3 | A gRPC call-history row per call | `internal/bridge/grpc.go:304` `recordGrpcHistory`, reached from four sites (`:265`, `:276`, `:479`, `:493`) | §4.2 |
| 4 | An `op_log` row per send/call, `command` carrying method + URL (or method + target) | `adapterhost/host.go:184`/`:206` emit, `oplog/wire.go:174` `Append` and `:207`/`:255` `Finish` | §4.3 |
| 5 | Save / Save as… — a collection item, plus `historyAdopt`/`grpcHistoryAdopt` | `api/state/collections.ts:493`-`546` (`submitSaveDialog`), `:549`-`570` (`saveRequest`/`saveGrpcRequest`), invoked from `HttpRequestView.vue:152`-`167` and the gRPC view's own pair | §3.2 |
| 6 | The active environment (`api_environments.is_active`) | `api/state/variables.ts:71`-`75` (`setActiveEnvironment`), reached from `EnvironmentSelect.vue:48`/`:53`, mounted in both request views' `#toolbar-2` | §3.3 |
| 7 | Variable rows, via the overview panel's two "Edit" buttons | `api/VariablesOverviewPanel.vue:60`-`66` — they open a *variable-set* tab, whose own writes are ordinary persisted writes | §3.4 |

### 1.2 What already never persists — and is therefore left alone

- The response, the send status, the op id: `views/httprequest/state.ts:117`-`138` (`runtime`, freed by
  `registerTabRuntimeCleanup`), and its gRPC twin. `state.ts:115`'s own comment already states the rule.
- The per-tab history runtime (`api/state/history.ts:33`) — a cache of rows, not a writer.
- Every find/filter/overview lens (`HttpRequestView.vue:86`, `:303`, `:308`) — component-local by design.
- `revealedValues`/`revealExpiry` — in-memory, timer-expired.
- `variablesReveal`/`variablesRevealHistory` (`internal/bridge/variables.go:251`, `:264`) — reads plus an
  OS auth prompt, no row written.
- `collectionsList`/`collectionsGetRequest`/`variablesList`/`historyList` — reads.

**This is the whole set.** A request tab has no other route to SQLite. That is what makes §2's
approach closed rather than best-effort.

### 1.3 The seams the design lands on

- `TabsService.Save` (`internal/bridge/tabs.go:33`) replaces the window's whole tab set. So omitting a
  tab from the snapshot both keeps it out and removes any row it previously had — no delete call needed.
- `TabStrip.vue:196` already renders `is-preview` straight from `state/tabs.ts`'s `isPreview(tab.id)`,
  not through `TAB_KINDS` — the precedent for a kind-agnostic per-tab visual read.
- `TAB_KINDS[kind].menuExtras(tab)` (`state/tabKinds.ts:311`, `:343`) is the documented seam for
  "whatever the tab's own kind appends" to the tab context menu; both request kinds return `[]` today.
- `registerTabRuntimeCleanup` (`state/tabRuntime.ts:8`) is the leaf cleanup registry `closeTab` already
  drives through `dropAllPagesForTab` — where the flag and the environment override are dropped.

## 2. Mechanism

**One flag, checked at each of the seven writes. No parallel store.**

Justification, since SPEC asked for a decision:

- A parallel non-persisted store branch would have to mirror **reads** as well as writes — and reads are
  what make the tab render. Every read above (collections tree, variable sets, environment list,
  history list) is shared app-wide state that an incognito tab must keep seeing unchanged.
- Everything a request tab holds *at runtime* is already in memory and already non-persisted (§1.2).
  The only persisted thing is the tab record, and one filter removes it.
- The write set is seven call sites, closed and greppable (§1.1), not an ambient sync layer. Guarding
  seven calls is auditable; mirroring a storage layer is not.

Standing rule for later phases, to be written into `tabIncognito.ts`'s own doc comment: **any new
bridge write reachable from a request tab must consult `isIncognito` first.**

### 2.1 `state/tabIncognito.ts` (new)

```ts
export const incognitoState = reactive({ ids: new Set<string>() });
export function isIncognito(tabId: string): boolean;
export function setIncognito(tabId: string, on: boolean): void;
```

- In-memory only, exactly like `tabsState.hydrated` (`state/tabs.ts:79`) and
  `previewIdByWorkspace` (`:81`) — no schema change, and a restored session has nothing to restore
  (an incognito tab was never saved).
- Registers its own `registerTabRuntimeCleanup((id) => incognitoState.ids.delete(id))`, so closing a
  tab drops the flag through the path `closeTab` already runs.
- Its own module rather than a field on `tabsState`: `state/tabKinds.ts` needs to read it for
  §5.2's menu item, and `state/tabs.ts` already imports `tabKinds.ts` — putting it in `tabs.ts` makes
  a cycle. `tabIncognito.ts` imports only `tabRuntime.ts` (which imports nothing), so there is none.

## 3. Renderer suppression

### 3.1 The tab snapshot — `state/tabs.ts`

One helper, used by both writers:

```ts
// An incognito tab is never written: it is left out of the snapshot entirely, and TabsService.Save
// replaces the window's whole set, so a tab switched to incognito mid-session also drops whatever
// row it already had.
function persistableTabs(): TabRecord[] {
  return tabsState.tabs.filter((t) => !isIncognito(t.id));
}
```

- `saveIfChanged` (`:127`) stringifies `persistableTabs()` instead of `tabsState.tabs`. Its existing
  snapshot-equality check then makes typing in an incognito tab issue **no IPC at all** — the
  snapshot never changes — rather than sending a filtered write per keystroke.
- `flushPendingTabState` (`:184`) passes `persistableTabs()`.
- `duplicateTab` (`:530`) carries the flag onto the copy: duplicating an incognito tab to try a
  variant must not silently start persisting it.
- `setIncognito(id, true)` calls `saveNow()` so the tab's existing row disappears immediately rather
  than at whatever unrelated state change saves next.

Deliberate and stated in the toggle's tooltip: incognito is **prospective**. Rows written before it
was switched on (a previously saved tab record, earlier history entries) are not deleted.

### 3.2 Save / Save as…

- `HttpRequestView.vue:152`-`167`: `onSave`/`onSaveAs` return early when incognito; the `#head-trailing`
  Save button is `:disabled` with the tooltip "Saving is off in an incognito tab". The early return also
  covers `registerCommand('api.save', onSave)` (`:349`) and the command palette.
- The gRPC view's own Save pair gets the identical treatment.
- `api/state/collections.ts` itself is **not** guarded: the collections tree's own create/rename/delete
  actions are panel-level, not tab-level, and incognito is a property of a tab.

### 3.3 The active environment

`api/state/variables.ts` gains a per-tab override, consulted only for an incognito tab:

```ts
const incognitoEnvByTab = new Map<string, string>(); // tabId → environment id ('' = none)
export function environmentIdForTab(tabId: string): string;   // override, else activeEnvironmentId
export function environmentColorForTab(tabId: string): PaletteColor;
export function selectEnvironmentForTab(tabId: string, id: string): void; // in-memory when incognito,
                                                                          // else setActiveEnvironment
```

Dropped in the same `registerTabRuntimeCleanup` callback. Call sites to move off the global
(mechanical, all reads):

| File | Lines |
|---|---|
| `views/httprequest/HttpRequestView.vue` | `:186`, `:226`, `:236`, `:241`, `:372` (colour), `:502` |
| `views/httprequest/state.ts` | `:157`, `:238` |
| `views/grpcrequest/GrpcRequestView.vue` | `:157`, `:167`, `:172`, `:270`, `:401` |
| `views/grpcrequest/state.ts` | `:156`, `:178`, `:289` |
| `api/EnvironmentSelect.vue` | `:43`, `:48`, `:53`, `:68`, `:98`, `:117` — gains an optional `tabId` prop |

Each view defines one `const envId = computed(() => environmentIdForTab(props.tab.id))` and uses it;
nothing else changes. An incognito tab inherits the app-wide selection at open time (the override is
absent until the user picks), so the common case is byte-identical to today.

Declined: disabling the selector in an incognito tab. It is the control an incognito tab most needs
(point a scratch request at staging without flipping the app-wide selection), and disabling it would
make the feature worse than not having it.

### 3.4 The variables overview panel

`VariablesOverviewPanel.vue` gains `canEdit?: boolean` (default true); both request views pass
`:can-edit="!incognito"`, which hides the two Edit buttons (`:129`, `:138`). The panel stays fully
readable — it is read-only by design (`:12`) — but offers no route out of the tab into a persisting
editor.

### 3.5 History panes

No suppression needed: with nothing recorded, `historyList` simply returns the empty set (a tab-scoped
send) or the saved request's pre-incognito entries (an itemId-bound tab). Both are reads.

Add one branch to the existing empty state so silence is explained rather than looking broken:
`ResponseHistoryList.vue:123`-`131` (which already branches on `isScratch`) and
`CallHistoryList.vue:92`'s `EmptyState` label — "Responses are not recorded in an incognito tab."

## 4. Go suppression

One new wire field per send path, defaulting to `false` on the zero value — the same optional-on-the-TS-
side shape `itemId` already has (`bridge/apiControl.ts:64`-`75`).

- `bridge/apiControl.ts`: `httpSend` and `grpcCall` args gain `incognito?: boolean`, forwarded as
  `incognito: args.incognito ?? false`.
- `views/httprequest/state.ts:170` and `views/grpcrequest/state.ts:297` pass `isIncognito(tabId)`.
- `internal/bridge/http.go:35`-`49` `HttpSendArgs` and `internal/bridge/grpc.go`'s `GrpcCallArgs` each
  gain `Incognito bool \`json:"incognito"\``.

### 4.1 Response history

`http.go:122`: wrap the `ResponseHistory.Record` call in `if !args.Incognito { … }`. Nothing else in
`Send` writes.

### 4.2 gRPC call history

`grpc.go:304`: one early return at the top of `recordGrpcHistory` — `if args.Incognito { return }`.
One guard covers all four call sites, unary and streaming.

### 4.3 The op log

`op_log.command` holds the resolved-free method + URL and survives the tab, so it is in scope.

- `adapterhost/host.go:26`-`31`: `OpSpec` gains `Incognito bool`; `:118` `opStartPayload` gains
  `Incognito bool \`json:"incognito"\``, set from the spec at `:184`. `http.go:71` and `grpc.go:211`
  set it from `args.Incognito`.
- `oplog/wire.go:55`-`60`: `inFlightOp` gains `incognito bool`, read from the op:start payload
  (`:159`-`172`). `handleOpStart` skips `w.ops.Append` (`:174`) for it.
- `handleOpEnd` (`:187`): **move the `inFlight` lookup above the `w.ops.Finish` call at `:207`** and
  skip `Finish` when `started.incognito`. Consequence to state in the comment: `Finish` is also what
  truncates `patch.Command`/`patch.Error` in place, so an incognito op's live record carries the
  untruncated command with `CommandTruncated` false. That record is in-memory only, which is the point.
- `finishInFlight` (`:243`): skip `Finish` for an incognito entry, still deleting it from the map.

`updates.Emit` is untouched in all three, so the Operations panel still shows an incognito op **while
it runs** — the Stop button, the duration and the error all keep working. Nothing is stored, so it is
gone at the next `Recent()` reload or restart. That is the honest reading of "nothing persists once the
tab closes", and hiding a running op from the panel that exists to show running ops would be worse.

## 5. Indicator and toggle

### 5.1 Indicator

- **Tab strip** — `TabStrip.vue:189`-`235`: `'is-incognito': isIncognito(tab.id)` on the class object
  (`:196`), `:data-incognito` beside `:data-preview` (`:204`) for tests, and a
  `<CodiconIcon name="eye-closed" :size="12" class="tab-incognito">` before `.tab-title`, tooltip
  "Incognito — nothing from this tab is saved". Read straight from `state/tabIncognito.ts`, the way
  `isPreview` is read from `state/tabs.ts` — **not** through `TAB_KINDS.badge`, which `http-request`
  already spends on "this request has a body" (`tabKinds.ts:317`-`320`) and which is per-kind, not
  per-tab.
- **View head** — a `p-chip` in `HttpRequestView.vue`'s `#badges` slot (`:376`-`390`) and the gRPC
  view's own, `data-testid="http-incognito-chip"` / `grpc-incognito-chip`.

### 5.2 Toggle

- **View toolbar** — an `IconButton` (`icon="eye-closed"`, `:active="incognito"`) in `#toolbar-end`
  (`HttpRequestView.vue:441`-`457`), beside Copy as curl / Edit as raw.
- **Tab context menu** — both request kinds' `menuExtras` (`tabKinds.ts:311`, `:343`) return one item,
  label "Incognito" / "Turn off incognito", icon `eye-closed`.

Both call `setIncognito(tab.id, !isIncognito(tab.id))`. Tooltip text on the toolbar button states the
prospective rule (§3.1) in one sentence.

## 6. Deliberately out of scope

Stated so it stays out entirely:

- Deleting rows written before the toggle was switched on (§3.1).
- A session-local history list mirroring the suppressed rows — that is the parallel store §2 declines.
- The native file picker's own last-directory memory (`views/httprequest/files.ts`) and any
  user-initiated Save-to-file: an explicit act on the user's filesystem, not tab session data.
- App settings, window/workspace state, the collections tree's own panel-level actions.
- Incognito for any non-request tab kind (variable-set, environments, and every Studio kind). Those
  are editors of persisted things; an incognito editor of a persisted thing means nothing.
- Making `submitImportCurl` (`api/state/curl.ts:101`) open an incognito tab. The Import-from-curl
  dialog is panel-level and deliberately opens a fresh tab with no tab in mind (`:96`'s own comment).

---

# Part B — 4-row auto-growing inputs

## 7. Confirmed current state

- Both request views' row tables funnel through `views/httprequest/FieldRowsTable.vue` — Params,
  Headers, urlencoded and form-data (`:15`-`20`) — plus `views/grpcrequest/MetadataTable.vue`, that
  file's deliberate literal copy (`FieldRowsTable.vue:171`-`174` records why).
- Every cell is a single-line `<input>`: `TextField.vue:76` and `AutocompleteField.vue:450`. Overflow
  pans horizontally; nothing wraps, nothing grows. This is the clipping the row reports.
- `.p-input` is a fixed-height box — `height: var(--kira-control-h)`, `align-items: center`,
  `padding: 0 var(--kira-s-4)` (`theme/primitives.css:137`-`154`), inner control styled by
  `.p-input input` (`:175`-`183`).
- The **body** is not affected: raw and code modes are `MonacoHost` (`RequestBodyPane.vue:190`, `:203`),
  already multi-line, already internally scrolled, already filling the pane.
- `.p-textarea` (`primitives.css:262`) is the app's plain multiline control, used by the curl
  import/export dialogs and the bulk variables editor — a different control with its own sizing.

## 8. Mechanism

An opt-in `grow` prop on the two field primitives. Off by default, so every other call site in the app
renders byte-identically.

**The control becomes a `<textarea rows="1" wrap="soft">`.** A 4-row-tall `<input>` does not exist.

**Enter keeps meaning Enter.** In both primitives the plain-Enter branch (`TextField.vue:85`,
`AutocompleteField.vue:340`-`343`) additionally calls `preventDefault()` when `grow` is set, so no
newline is ever inserted. The value therefore never contains `\n`: growth comes from soft wrapping
alone, which is exactly what a long header value or query param does. It also keeps `@enter="onSend"`
and every accept/submit contract unchanged.

**Auto-size by CSS, no JS.** A grid replica sized by the same text, clamped to 4 lines; the textarea
stretches into the clamped track and scrolls internally past it.

```css
.p-input.is-grow {
  --grow-lh: 1.45;
  --grow-rows: 4;
  height: auto;
  align-items: flex-start;
  line-height: var(--grow-lh);
  /* One row renders at exactly --kira-control-h and vertically centred, so a filled row sits at the
     same height as every control beside it; each further row adds exactly one line box. max(0px, …)
     because both the font size and the control height are user-settable tokens. */
  padding-block: max(0px, calc((var(--kira-control-h) - 2 * var(--kira-border-width)
                                - var(--grow-lh) * 1em) / 2));
}
.p-input.is-grow .input-wrap { display: grid; }
/* The sizing replica: same text, same font, same wrapping, invisible. Its own max-height is the
   4-row clamp — clamping the replica (not the box) is what keeps the grid track itself at most four
   lines, so the stretched textarea inside it scrolls rather than overflowing. The trailing space
   keeps a value ending in a space from collapsing the last line. */
.p-input.is-grow .input-wrap::after {
  content: attr(data-value) " ";
  grid-area: 1 / 1;
  visibility: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: calc(var(--grow-rows) * var(--grow-lh) * 1em);
  overflow: hidden;
  font: inherit;
}
.p-input.is-grow .input-wrap > textarea {
  grid-area: 1 / 1;
  resize: none;
  overflow-y: auto;
}
```

`.input-wrap` carries `:data-value="modelValue"`. `attr()` yields a plain string into `content`, never
markup — unlike `v-html`, it is not a paint path anything can be injected through.

`.p-input input` (`primitives.css:175`) and `.p-input input::placeholder` (`:184`) gain `textarea` to
their selector lists rather than restating the rules.

**Why not a library.** `field-sizing: content` is the one-line native answer and is Chromium-only —
this app ships on WebKitGTK and WKWebView too, so it cannot be the mechanism. The JS alternatives
(`autosize` and friends) write an inline height per input event, which means a measure/write per
keystroke per cell in a table that routinely holds dozens of rows. The rule above is ~15 lines of CSS
with no JS, no observer and no per-keystroke layout write. `CLAUDE.md`'s bar is "reach for a library
before hand-rolling non-trivial infrastructure" — this is neither non-trivial nor infrastructure, and
the library would be strictly worse here.

### 8.1 `TextField.vue`

A `grow?: boolean` prop; when set, render `<span class="input-wrap" :data-value="modelValue">` around a
`<textarea>` carrying today's `$attrs`/value/placeholder/handler set, and add `is-grow` to `.p-input`.
The existing `<input>` branch is untouched (`v-if`/`v-else`), so `type="password"`/`"number"` and the
stepper are unaffected — they are mutually exclusive with `grow` by construction.

### 8.2 `AutocompleteField.vue`

The `<input>` at `:450` becomes a `<textarea>` under `grow`; `inputRef` widens to
`HTMLInputElement | HTMLTextAreaElement`, as do `recompute`, `onInput`, `onClick`, `onKeyup`, `accept`
and `onKeydown`. Every API they use — `value`, `selectionStart`, `setSelectionRange`, `focus` — exists
identically on both. `theme/wrapSelection.ts:25`/`:65` already accept a textarea, so bracket wrapping
and auto-close need no change.

Three overlay changes, all under `grow` only, so every existing overlay call site keeps today's paint:

- `.highlight-overlay` (`:530`-`545`): `white-space: pre-wrap` + `overflow-wrap: anywhere`, and drop
  the `display: flex; align-items: center` vertical centring for top alignment. The overlay must wrap
  on exactly the same boundaries as the textarea — same font, same width, same two properties.
- `onInputScroll` (`:312`): mirror `scrollTop` as well as `scrollLeft`.
- `positionList` (`:206`) needs nothing: it already anchors to the element's own rect.

`overlayOffsetAtPoint` (`editor/paintSpans.ts:179`) resolves a pointer through
`caretPositionFromPoint` over the overlay's own DOM, so the `{{variable}}` hover keeps working on
wrapped text with no change — verify by hand rather than by assumption.

### 8.3 Row navigation

`FieldRowsTable.vue:181`-`201` (and MetadataTable's copy): `textInputsIn`'s selector becomes
`input:not([type="checkbox"]), textarea`, and the `el instanceof HTMLInputElement` guard widens to
include `HTMLTextAreaElement`.

ArrowUp/ArrowDown keep stepping rows (P15b D6's contract) rather than moving within the cell: no cell
value can contain a newline (§8), so a cell is one logical line, and Home/End/Left/Right already
traverse the whole of it. Preserving the existing behaviour is also what keeps the trailing-blank-row
add affordance reachable by keyboard.

## 9. Call sites

**In**, all request content, all currently clipping:

| Where | Cells |
|---|---|
| `FieldRowsTable.vue:278`-`335` | name (both branches), value (both branches), description — covers Params, Headers, urlencoded and form-data names/descriptions |
| `FormDataTable.vue:95`-`117` | the overridden text-value cell (both branches) |
| `MetadataTable.vue:217`-`253` | name, value, description |

**Out**, each with its reason:

- The URL field (`HttpRequestView.vue:416`) and the gRPC target field. They sit in `.p-toolbar`, which
  is a fixed-height band (`primitives.css:755`-`763`) shared by every view in the app through
  `ViewChrome`. Growing them means making a shared chrome bar auto-height — a disproportionate,
  app-wide geometry change for a row that names body/headers/params.
- Both body editors (`RequestBodyPane.vue:190`, `:203`) — Monaco, already multi-line with internal
  scroll (§7).
- Form-data's Content type cell (`FormDataTable.vue:148`) — one short token; a jittering row height
  for `application/json` is noise.
- `VariableRow.vue:144`'s value cell — it renders `type="password"` for an unrevealed secret
  (`:146`), which a textarea cannot be; growing only the revealed state would make a secret row change
  height on reveal. Its name/description cells are left with it, so the row stays one shape.
- `ImportCurlDialog.vue:52` / `CopyAsCurlDialog.vue:80` / `BulkVariablesEditor.vue` — already
  `.p-textarea` at 6, 10 and full-pane height. Nothing clips.
- `SchemaBrowser.vue`'s filter box and `SaveRequestDialog.vue`'s name box — single short values.

---

## 10. Files

New:

| File | What |
|---|---|
| `apps/kira-studio/frontend/src/state/tabIncognito.ts` | The flag, its accessors, its cleanup registration (§2.1) |

Modified:

| File | Change |
|---|---|
| `frontend/src/state/tabs.ts` | `persistableTabs()`, both writers, `duplicateTab` carry (§3.1) |
| `frontend/src/state/tabKinds.ts` | `menuExtras` on both request kinds (§5.2) |
| `frontend/src/workbench/panels/TabStrip.vue` | Class, `data-incognito`, icon (§5.1) |
| `frontend/src/api/state/variables.ts` | Per-tab environment override (§3.3) |
| `frontend/src/api/EnvironmentSelect.vue` | Optional `tabId`, reads/writes through the override |
| `frontend/src/api/VariablesOverviewPanel.vue` | `canEdit` (§3.4) |
| `frontend/src/bridge/apiControl.ts` | `incognito` on `httpSend`/`grpcCall` args |
| `frontend/src/views/httprequest/HttpRequestView.vue` | Toggle, chip, Save gating, env-id call sites |
| `frontend/src/views/httprequest/state.ts` | `incognito` + env id on send/export |
| `frontend/src/views/httprequest/ResponseHistoryList.vue` | Incognito empty-state branch |
| `frontend/src/views/grpcrequest/GrpcRequestView.vue` `/state.ts` `/CallHistoryList.vue` | The same four changes |
| `internal/bridge/http.go` | `Incognito` arg, `OpSpec`, `Record` guard (§4.1/§4.3) |
| `internal/bridge/grpc.go` | `Incognito` arg, `OpSpec`, `recordGrpcHistory` early return (§4.2/§4.3) |
| `internal/adapterhost/host.go` | `OpSpec.Incognito`, `opStartPayload.Incognito` (§4.3) |
| `internal/oplog/wire.go` | `inFlightOp.incognito`; skip `Append`/`Finish` in three places (§4.3) |
| `frontend/src/theme/primitives.css` | `.p-input.is-grow` block; `textarea` added to two selectors (§8) |
| `frontend/src/theme/primitives/TextField.vue` | `grow` branch (§8.1) |
| `frontend/src/theme/primitives/AutocompleteField.vue` | `grow` branch, element-type widening, overlay (§8.2) |
| `frontend/src/views/httprequest/FieldRowsTable.vue` | `grow` on three cells; nav selector/guard (§8.3, §9) |
| `frontend/src/views/httprequest/FormDataTable.vue` | `grow` on the text-value cell |
| `frontend/src/views/grpcrequest/MetadataTable.vue` | `grow` on three cells; nav selector/guard |

`frontend/bindings/` is gitignored and regenerated by the Wails build.

No migration, no schema change, no new IPC channel — `incognito` is a new optional field on two
existing channels, so `tests/ui/support/ipcChannels.ts` and `mockRuntime.ts` need no entry. Check the
handful of `httpSend`/`grpcCall` snapshots that pin `args` rather than only `response`; an added field
breaks an exact-args match if one exists.

## 11. Tests

`CLAUDE.md`'s default is no dedicated unit test, and **this phase needs none.** Nothing here is a
parser, a boundary arithmetic, a cache invalidation, a crypto path, a concurrency problem, or a
decision structure too large to hold in your head. `persistableTabs` is a one-predicate filter; the
Go guards are single `if`s; the grow behaviour is CSS with no branch in it at all.

The closest thing to a candidate, named and declined: `oplog/wire.go`'s `handleOpEnd` reordering, since
it moves a lookup across a write. It is still one field on one map entry, and `oplog/wire_test.go`
already drives `handleOpStart`/`handleOpEnd` with synthetic events — if that file's existing table
grows one incognito case while the reordering is made, that is an edit to a test whose whole subject
is this function, not a new test earning its own keep. Do that rather than write anything new.

**One UI spec extension is worth it**, the same shape M2 used: add a case to
`apps/kira-studio/tests/ui/http-request.spec.ts` asserting, over the existing mocked-IPC harness, that
after toggling incognito and sending, `control.log()` contains no `tabsSave` carrying that tab and one
`httpSend` with `incognito: true`. The harness already inspects `tabsSave` payloads this way
(`http-request-body.spec.ts:198`), and this is the phase's actual claim, stated as an assertion rather
than as prose.

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun run build`, `go build ./...`,
`go vet ./...`, `go test ./...`. Once near the end: the API UI specs —
`http-request`, `http-request-body`, `http-history`, `http-variables`, `http-curl`, `http-raw`,
`grpc-request`, `collections`, `api-ui-consistency`, `autocomplete`, `control-sizing`. The last two
are the ones Part B can actually break: `autocomplete.spec.ts` drives the popup through a real
element, and `control-sizing.spec.ts` measures `.p-input` heights (§8's padding formula exists so a
one-row grow field still measures `--kira-control-h`).

## 12. Order and sizing

### 12.1 Implementation order

Go first and green before any `.vue` file is touched, M2's own ordering discipline.

1. `state/tabIncognito.ts`; `persistableTabs()` and the two writers; `duplicateTab` carry.
2. Go: `Incognito` on both args structs and `OpSpec`/`opStartPayload`; the `http.go` and `grpc.go`
   guards; `oplog/wire.go`'s three skips and the `handleOpEnd` reordering (plus its existing-table
   test case). `go build ./... && go vet ./... && go test ./...` green.
3. `bridge/apiControl.ts` + both `state.ts` send paths pass the flag.
4. The per-tab environment override and its call-site sweep (§3.3).
5. UI: toggle, tab-strip indicator, head chip, Save gating, overview `canEdit`, both history
   empty-state branches.
6. `primitives.css` + `TextField.vue` + `AutocompleteField.vue` (§8), then the five call-site files
   (§9), then the two nav-handler widenings.
7. The `http-request.spec.ts` extension; full fast checks; the UI specs named in §11.

Commits per numbered step, Conventional Commits: `feat(api):` for 1-5, `feat(theme):` for 6,
`test(api):` for 7.

### 12.2 One pass, one seam

One Sonnet pass. Steps 1-5 are one continuous thread (the flag's shape decides every later call), and
step 6 is small enough that a second cold start would cost more than it saves.

**The only split point is between step 5 and step 6** — Parts A and B share no file: A touches
`state/**`, `TabStrip.vue`, `api/**`, both `*RequestView.vue`, both `state.ts`, both history lists and
the four Go files; B touches `theme/primitives*`, `FieldRowsTable.vue`, `FormDataTable.vue`,
`MetadataTable.vue`. Never split inside Part A, which would leave a tab flagged incognito that still
persists.

Size: 1 new file, ~24 edits, of which about half are one-to-five-line mechanical additions, plus the
environment-id call-site sweep (§3.3's table).

## 13. Dogfooding note

The repo-map MCP server was started per `CLAUDE.md`'s headless steps and called over curl (the native
tool surface does not appear in an agent-harness session). It did real work: `find_references` on
`saveIfChanged` returned both call sites with line numbers instead of re-reading `state/tabs.ts`, and
`search_symbols` on `isPreview` located the kind-agnostic per-tab read this phase's indicator copies.

**Nothing to add to `docs/v1.8/mcp-repo-map-issues.md`** — no wrong result, missing tool or crash in
this pass. The initial-sync latency already logged in v1.7 reproduced (every call inside the first
build window returns the "still building" result); it is known, correct behaviour and not worth a
second entry.
