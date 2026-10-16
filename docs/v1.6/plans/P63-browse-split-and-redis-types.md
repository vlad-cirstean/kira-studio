# P63 — Browse panels: vertical split, relocated back-navigation, Redis type differentiation

> **What this phase is.** `docs/v1.6/SPEC.md`'s P63 row, turned into concrete steps from direct
> reads of the real tree. Every file, line number, symbol and icon name below was opened and
> checked in this worktree, never recalled. Where SPEC guessed at current state, the guess is
> corrected in §0 rather than carried forward.

## 0. What SPEC left open, and how each is resolved

SPEC's P63 row names four things this planning pass had to establish. Three of its own premises
turned out to be wrong; each correction is stated before the design that depends on it.

**1. "Locations not yet confirmed … likely under `views/keyvalue/` for Redis and a to-be-located
S3 equivalent."** Wrong shape. There is **no S3 panel and no Redis panel**. There is **one**
browse panel — `views/browse/BrowseView.vue` (358 lines) — that serves both engines, because both
engines' trees stop at their top container and hand the unbounded key space to the same Browse tab
(`redis/catalog.go:99` and `s3/catalog.go:30` both set `HasChildren: false` with the same stated
reason). `views/keyvalue/KeyValueView.vue` (1040 lines) is not a panel at all — it is the **data
view**, opened as a **separate tab**. So "both panels" is one component, and "the data view" is a
second component in a different tab. §2 is therefore about joining two existing components, not
re-laying-out two similar ones.

**2. "The current back/up-navigation control (today apparently a labeled button positioned at the
top of the panel)."** Wrong twice. It is already an **icon** button, not labeled, and it is
`arrow-up` ("Up one level"), not a back control — `BrowseView.vue:158-164`. The real change is
therefore smaller than SPEC implies in one way (no label to remove) and larger in another: the
icon it should become is **not** `arrow-left`, because this app already spends `arrow-left` on
pagination. §3.

**3. "Check whether an existing split-pane/panel-shell primitive … (`PanelShell` and its kin) is
the right vehicle."** `PanelShell` is **not** the right vehicle — checked, not assumed.
`PanelShell.vue` is the *sidebar* shell (34px title bar, search reveal, type-ahead redirect); its
callers are `workbench/panels/ProjectPanel.vue`, `api/CollectionsPanel.vue`, `repo/RepoPanel.vue`
— every one a left-rail panel, none a main-tab view. The right vehicles already exist and are
used by main-tab views: **`ViewChrome.vue`** (header/toolbar/strips, which BrowseView already
uses) and **`PanelSplitter.vue`**. §2.1.

**4. "This phase's own planning pass names which reference client(s) it modeled the design on and
why."** **RedisInsight** (Redis Ltd.'s own client), for the split and for per-key type display.
§4.1 states what was taken and what was deliberately not.

---

## 1. Confirmed current state

### 1.1 The browse panel — `views/browse/BrowseView.vue`

| Line | What is there |
| --- | --- |
| `144` | root `.browse-view`, `data-testid="browse-view"` |
| `145-156` | `<ViewChrome>` — icon/path/name header, Refresh wired to `onReload` |
| `158-164` | `<IconButton icon="arrow-up" data-testid="browse-up" :disabled="atRoot" v-tooltip="'Up one level'">` — **in the `#toolbar` slot** |
| `165-178` | breadcrumb, one `<button class="crumb" data-testid="browse-crumb">` per segment, also in `#toolbar` |
| `180-193` | filter toggle (`browse-filter-toggle`), upload (`browse-upload`) |
| `194` | `browse-count` status text |
| `197-216` | `#strips`: filter box, load error, action error, truncation warning |
| `222-227` | `<ReconnectGate>` replaces **only the body** (Item 4's own fix) |
| `228-259` | body: `.p-panel.body-panel` wrapping one full-width `<VirtualList>` |
| `240-258` | `browse-row` — icon-box, `.row-name`, optional `.row-detail` |
| `98-111` | `onRowClick` → `selectRow`; `onRowOpen` → `descend` for a container, else `openKeyValueTab` |

**Today's layout is a single pane.** There is no split, no value preview, no second column.

### 1.2 The data view — `views/keyvalue/KeyValueView.vue`

Opened as its own tab. Structure: `ViewChrome` (`605-620`) → `#badges` (`621-639`: type badge
`keyvalue-type`, TTL chip, memory, read-only) → `#toolbar` (`641-...`: pager, page size, count,
add/edit/delete, search) → body (`866-...`: `.p-thead` with field/value columns, then a
`VirtualList` of `kv-row`) → `CellEditorDock`.

Two facts that shape §2:

- **`arrow-left` is already taken here.** `KeyValueView.vue:650` is the pager's Previous page.
  `views/shared/page/PagerControls.vue:75` is the same. Putting an `arrow-left` back-control into
  the browse panel would place two identical glyphs with unrelated meanings side by side once the
  two views share one tab.
- **Its state is bound to a real tab record.** `keyvalue/state.ts` resolves the tab on every
  operation: `findKeyValueTab` at `state.ts:73` (`load`), `:137` (`reload`), `:144` (`runCount`),
  `:176` (`goNext`), `:189` (`goPrev`), `:208` (`setPageSize`), plus `mutations.ts:51` (`addKey`) —
  7 production sites. It writes back through `patchKeyValueTabState` at `state.ts:92`, `:131`,
  `:184`, `:197`, `:212` — 5 sites, all inside `state.ts`. Counted with the repo-map server's
  `find_references`, not estimated. §2.2 turns exactly these 12 into the seam.

### 1.3 Session state

`packages/shared/domain/tabs.ts:201-204`:

```ts
export const browseTabStateSchema = /*#__PURE__*/ z.object({
  levelPath: z.string().default(''),
});
```

One field. `defaultBrowseTabState()` at `:487`. Selection and filter are deliberately **runtime
only** — `browse/state.ts:26-30` — and `setLevel` (`:118-131`) clears both on every level change,
because P21 round 3 finding 14 found that carrying them across a level change silently hid rows
and left `selected` pointing into a different level. §5 does not undo that.

### 1.4 Redis type: not in the tree, at all

`redis/catalog.go:158-162` emits a leaf key as exactly:

```go
keyNodes[key] = model.TreeNode{
    Kind: "key", Name: key, Path: model.EncodePath(segments), HasChildren: false,
}
```

No `Detail`, no `Badges`. `treeNodeSchema` (`packages/shared/domain/tree.ts:88-95`) has both
fields and both are optional; the SCAN walk sets neither. The same is true of S3 objects
(`s3/catalog.go:104-…`, no `Detail`).

So **every Redis key in the browse list renders identically today**: one `tag` glyph
(`theme/icons.ts:16`, `key: 'tag'`) and a name. The type exists only once a key is *opened* — as
`KeyValuePage.redisType`, surfaced at `KeyValueView.vue:623`. **Clearer type differentiation in
the key list is therefore a backend change, not a CSS change.** §4.3.

Level size bound, which §4.3 must respect: `redis/catalog.go:20-21` — `scanCount = 1000`,
`maxScanRounds = 200`, so one level is capped at **200 000 keys**.

### 1.5 Splitter precedent

`theme/primitives/PanelSplitter.vue` — props `orientation: 'col' | 'row'`, `size`, `min`, `max`,
`reverse`, `divider`; emits `resize: [size]`. It is a pure drag track: the **caller** owns the
size and persists it.

Callers: `WorkbenchShell.vue:44` (`col`), `:59` (`row`); `CellEditorDock.vue:22` (`row`);
`HttpRequestView.vue:551` (`row`); `GrpcRequestView.vue`. The persistence idiom to copy is
`HttpRequestView.vue:330-337`:

```ts
const DEFAULT_REQUEST_PANE_HEIGHT = 260;
const requestPaneHeight = computed(
  () => props.tab.state.requestPaneHeight || DEFAULT_REQUEST_PANE_HEIGHT,
);
function onResizeRequestPane(size: number): void {
  patchHttpRequestTabState(props.tab.id, { requestPaneHeight: size });
}
```

`0` means "the default" so a tab saved before the field existed restores correctly.

`divider` must be **on** here: `PanelSplitter.vue:9-15` says a splitter inside a view has no gap
band behind it and so must draw its own hairline. Both request views set it; WorkbenchShell does
not.

### 1.6 `VirtualList` already reports its window

`theme/primitives/VirtualList.vue:28` emits `'visible-range': [{ start: number; end: number }]`,
fired from a `watch` on `[startIndex, endIndex]` (`:102`). `KeyValueView.vue:901` already consumes
it. §4.3 needs exactly this and adds no new mechanism.

---

## 2. The vertical split

### 2.1 Geometry and vehicle

**"Vertical split" = a vertical divider, panes side by side** — list **left**, value **right**.
This is the editor sense of the phrase (VS Code's "Split Editor Right") and it is what the
reference client does (§4.1). In `PanelSplitter` terms that is `orientation="col"`, matching
`WorkbenchShell.vue:47`, whose splitter separates the project rail from the editor area — the same
navigator/detail relationship.

Not `PanelShell` (§0.3). The body of BrowseView's existing `ViewChrome` becomes a three-child flex
row:

```
ViewChrome (unchanged header; toolbar loses Up + breadcrumb, keeps filter/upload/count/refresh)
└─ .browse-body (display:flex; flex-direction:row; min-height:0)
   ├─ .list-pane   (width: listWidth px; min-width 0)
   │   ├─ .list-head   ← §3: back control + breadcrumb + count
   │   └─ VirtualList  ← today's rows, unchanged
   ├─ PanelSplitter orientation="col" divider
   └─ .detail-pane (flex:1; min-width:0)
```

`min={220}`, `max={900}`, `DEFAULT_LIST_WIDTH = 320`. `ReconnectGate` keeps replacing **only**
`.browse-body`, never the chrome — Item 4's fix at `BrowseView.vue:218-227` stays intact.

The splitter is the **only** new geometry. Nothing in `ViewChrome`, `PanelSplitter` or
`VirtualList` is modified.

### 2.2 What the right pane renders — the one real refactor

The right pane must show a selected key's/object's value. That is `KeyValueView.vue`'s body, which
today cannot render outside a `KeyValueTabRecord` (§1.2).

**Decision: extract the body into `views/keyvalue/KeyValuePane.vue` and give `keyvalue/state.ts` a
host seam. Do not build a second, lighter preview component.**

A parallel read-only preview would duplicate value rendering, the row table, search, the cell
editor and every type-specific header — and would diverge the moment either side changed. CLAUDE.md
forbids the half-implementation that invites ("scope left out of a phase stays out entirely, never
half-implemented"), and the duplication is the larger cost of the two.

The seam, concretely:

1. New `views/keyvalue/host.ts`:

   ```ts
   export interface KeyValueHost {
     connectionId: string | null;
     path: string;
     pageIndex: number;
     pageSize: PageSize;
     patch(p: { pageIndex?: number; pageSize?: PageSize }): void;
   }
   export function registerKeyValueHost(viewKey: string, host: () => KeyValueHost | null): void;
   export function unregisterKeyValueHost(viewKey: string): void;
   export function keyValueHost(viewKey: string): KeyValueHost | null;
   ```

2. `keyvalue/state.ts`: replace the 7 `findKeyValueTab(tabId)` reads with `keyValueHost(viewKey)`
   and the 5 `patchKeyValueTabState(...)` writes with `host.patch(...)`. The parameter keeps its
   name `tabId` nowhere — rename to `viewKey` throughout so the widened meaning is visible.
   `mutations.ts:51` likewise.

3. A tab-backed host is registered once, centrally, so every existing KeyValue tab behaves
   exactly as today: `connectionId`/`path`/`state.pageIndex`/`state.pageSize` read off
   `findKeyValueTab(id)`, `patch` calling `patchKeyValueTabState(id, …)`.

4. `KeyValueView.vue` becomes `ViewChrome` + `<KeyValuePane view-key="tab.id">`. Its `#badges`
   and `#toolbar` content move into `KeyValuePane` as named slots it re-exposes, so the tab keeps
   today's chrome and the split pane can render the same controls in its own header band.

5. `BrowseView.vue` registers a **preview host** keyed `` `${tab.id}::preview` ``, backed by new
   runtime fields (§5), and renders `<KeyValuePane :view-key="previewKey">` in `.detail-pane`.

**Cleanup, easy to miss:** `keyvalue/state.ts:54` and `page.ts` register
`registerTabRuntimeCleanup((tabId) => delete runtime[tabId])`. A browse tab's `::preview` entry is
keyed by a string that is *not* a tab id, so that callback must also drop
`` `${tabId}::preview` `` — in `keyvalue/state.ts`, `keyvalue/page.ts`, and the search/filter
stores keyed the same way (`shared/page/search.ts`, `searchFilter.ts`, `visibleRows.ts`). Leaking
one of these leaks a whole page buffer per closed browse tab.

**One thing to verify during implementation, not assumed here:** `data.read({ tabId, … })`
(`keyvalue/state.ts:100-109`) forwards `tabId` to the server, where it tags the op-log row. Confirm
a non-tab string is accepted and merely tagged (read `internal/` op-log handling) before relying on
`::preview`; if it is validated against live tabs, pass the real browse `tab.id` for the op tag and
keep `viewKey` client-side only.

### 2.3 Selection, open, and the eight existing call sites

- **Single click** selects a row (`selectRow`, unchanged) **and**, for a leaf, loads it into the
  right pane. This is the reference client's behaviour (§4.1).
- **Double click** keeps today's meaning exactly: a container descends; a leaf calls
  `openKeyValueTab` — a standalone tab, as now (`BrowseView.vue:104-111`).
- The row menu's **Open** / **Open in new tab** (`browse/menu.ts:44-63` for keys, `:82-100` for
  objects) are untouched.

`find_references` puts `openKeyValueTab` at **13 sites, 8 of them production** (`ProjectTree.vue:113`,
`browse/menu.ts:52,61,89,98`, `BrowseView.vue:110`, `keyvalue/mutations.ts:75`,
`UploadObjectDialog.vue:72`, `StudioStart.vue:49`). None changes. The split **adds** a way to see a
value; it removes none.

- Selecting a **container** row, or having nothing selected, renders `<EmptyState>` in the right
  pane ("Select a key to view its value" / "Select an object to view it"). `EmptyState.vue` already
  exists and `KeyValueView.vue:879` already uses it.
- A level change clears selection (`setLevel`, §1.3) and so empties the right pane. That is
  correct and is the existing P21 guard, not new behaviour.

---

## 3. Back-navigation

### 3.1 Icon: `chevron-left`, not `arrow-left`

SPEC says "a left-arrow icon". Implemented literally that collides, twice over:

- `arrow-left` is this app's **Previous page**, in both pagers — `KeyValueView.vue:650`,
  `PagerControls.vue:75`. After §2 the KeyValue pager sits in the same tab, a few hundred pixels
  right of this control.
- This app already spells **Back** as `chevron-left`: `ConnectionDialog.vue:416` is literally
  `<AppButton icon="chevron-left">Back</AppButton>`. `DateTimePicker.vue:240` uses the same glyph
  for "go back one month".

So: **`chevron-left`**, tooltip **"Back"**, `data-testid` stays **`browse-up`** (renaming it would
churn every existing UI test for no user-visible gain; the test id is an identity, not a label).
Both codicon names were verified present in the shipped font
(`@vscode/codicons/dist/codicon.css`) — `chevron-left` and `arrow-left` both exist; the choice is
semantic, not availability.

This is a deliberate, narrow deviation from SPEC's wording, taken because SPEC's own stated intent
("consistent in placement with an inline back-navigation affordance") is about consistency, and
`arrow-left` is the *inconsistent* choice in this codebase.

### 3.2 Placement: into the list pane, with the breadcrumb

Move **both** the control and the breadcrumb out of `ViewChrome`'s `#toolbar` and into a new
`.list-head` band at the top of the left pane (§2.1). Moving the button alone would divorce it
from the crumb trail it acts on.

```
.list-head:  [chevron-left]  crumb / crumb / crumb            12 items
```

`ViewChrome`'s toolbar keeps what is view-scoped rather than navigator-scoped: the filter toggle,
Upload, and Refresh (in the header). `browse-count` moves to `.list-head`'s right edge, where it
describes the list it counts.

Behaviour is unchanged: `@click="onUp"` → `ascend` (`browse/state.ts:139-146`), `:disabled="atRoot"`,
crumbs still call `goToLevel`. No state, no new function.

`.list-head` reuses the existing `.p-toolbar` band styling rather than inventing a header — it is
the same 26px in-view band, and `PanelSplitter.vue:74` names `.p-toolbar` as one of the surfaces
whose border weight the design system already fixes.

---

## 4. Redis type differentiation

### 4.1 Reference client: RedisInsight, and what was taken from it

**RedisInsight** — Redis Ltd.'s own GUI — is the model, chosen because it is the reference
implementation maintained by the people who define the types, so its type vocabulary is
authoritative rather than one vendor's interpretation.

Taken:

- **Split**: key list left, key details right, details shown on selecting a key. Confirmed from
  the project's own architecture documentation (the Browser's `KeyList` component and a `Key
  Details` component shown "when a key is selected"), plus its published browsing guide.
- **Per-key type shown in the list row**, with the type vocabulary `String, Hash, List, Set, ZSet,
  Stream` (RedisInsight adds `ReJSON`; this app has no JSON-module support and does not add one).
- **Details carry type + TTL + size** — which `KeyValueView.vue:621-637` already does, unchanged.

Deliberately **not** taken:

- **RedisInsight's type dropdown filter.** Filtering by type requires the type of *every* key in
  the level, not just the visible ones — the opposite of §4.3's windowed fetch — and SPEC asks for
  differentiation, not filtering. Out of scope (§7).
- **Its flat glob-pattern key list.** This app's browse panel is hierarchical (`:` namespaces, `/`
  prefixes) and that is a deliberate earlier decision (P9/P17/P41), not something P63 revisits.

### 4.2 The mark: icon + text badge, no colour

**Decision: differentiate by a per-type codicon plus the existing lowercase text badge. Do not
introduce per-type colours.**

Colour was the obvious first answer and is wrong here, for a reason written into this codebase.
`theme/icons.ts` already had to answer "may a type badge carry a colour?" for SQL column types, and
`icons.ts:166-180` records where that landed: colour is reserved for "the everyday scalar classes"
(number, boolean, datetime), while `json`, `array`, `binary`, `uuid`, `string` and `other` all map
to plain `var(--kira-fg)` — and P9 *removed* colour from string and uuid on the user's own request
that string-typed values stop standing out. Redis's six types are container/structure classes, the
exact family that precedent paints plain.

There is also nothing to paint them with. `tokens.css:23-26` carries four semantic hues —
`--kira-error`, `--kira-warn`, `--kira-ok`, `--kira-info` — each already meaning something
(failure, warning, success, information); spending "red" on `set` would make a neutral fact read as
an error. The only categorical palette in the app is `--kira-syntax-*` (`tokens.css:208-221`),
which is VS Code Dark Modern's grammar palette, reused *because* number/boolean/keyword map onto
real grammar tokens — Redis container types have no grammar counterpart, so the mapping would be
arbitrary. And P16's colour LAW (quoted at `KeyValueView.vue:81-82`) reserves colour in a view for
connection identity: "never a tint or a full border".

So the icon carries the distinction, matching `columnTypeIcon()`'s own shape at `icons.ts:150-164`.

New in `theme/icons.ts`, beside `columnTypeIcon`:

```ts
const REDIS_TYPE_ICON: Record<string, string> = {
  string: 'symbol-string',   // same glyph CATEGORY_ICON.string uses
  hash:   'symbol-object',   // a field→value map; CATEGORY_ICON.json's glyph
  list:   'list-ordered',    // ordered, index-addressed — the 'sequence' kind's own glyph
  set:    'symbol-enum',     // unordered members
  zset:   'sort-precedence', // members ordered by score
  stream: 'pulse',           // an append-only event log
};

/** Falls back to the generic key glyph — a row whose type has not arrived yet (§4.3) must look
 *  exactly like today's row, never like a wrong type. */
export function redisTypeIcon(type: string | null): string {
  return (type && REDIS_TYPE_ICON[type]) || KIND_ICON.key;
}
```

All six names, plus `chevron-left`, were verified present in
`packages/git-ui/node_modules/@vscode/codicons/dist/codicon.css`. `stream` takes `pulse` rather
than `broadcast` on purpose: `broadcast` is already "a Kafka topic" (`icons.ts:17`) and this app
keeps one glyph per concept.

**In the row** (`BrowseView.vue:253-255`), for a `key` node whose type is known: the icon-box glyph
becomes `redisTypeIcon(type)`, and the free `.row-detail` slot — nil for every Redis key today
(§1.4) — carries the type as a `p-badge`, lowercase, the *same* spelling
`KeyValueView.vue:623` renders. One term per concept: the list and the detail header must never
disagree.

S3 `object` rows are untouched — `file`, no badge.

### 4.3 Where the type comes from: windowed, not eager

A level holds up to 200 000 keys (§1.4) and the viewport shows ~30. Fetching `TYPE` for the whole
level would issue up to 200 000 commands to populate a few dozen badges.

**Decision: fetch types for the rows the user can actually see, driven by `VirtualList`'s existing
`visible-range` event, pipelined server-side.** This is what the reference client does — its list
is SCAN-paginated and types arrive with the page, not with the keyspace.

Rejected alternatives, with reasons:

- *Pipeline `TYPE` inside `listNamespaceChildren`* — simplest diff, no new IPC, but pays the full
  200 000-command worst case on every level load, including levels the user immediately leaves.
- *The same, capped at the first N keys* — turns the cap into a visible inconsistency: badges on
  the first N rows, none below, with nothing in the UI explaining the boundary.
- *One `treeDescribe` per key on scroll* — a round trip per row.

Wiring, in the app's existing shapes:

1. **`adapters.Caps`** gains `KeyTypes bool` (`internal/adapters/caps.go`). `caps.go`'s own header
   comment requires field order to mirror `shared/caps.ts` exactly — add it in the same position
   on both sides, and to `capsSchema`.
2. **`adapters.Adapter`** (`adapter.go:33-94`) gains, following `DownloadObject`'s precedent of an
   interface method gated by a cap:

   ```go
   // KeyTypes answers each path's engine-level value type, in the order given. Gated by
   // Caps().KeyTypes; every adapter with that flag false returns E_UNSUPPORTED.
   KeyTypes(ctx context.Context, paths []model.NodePath, op *OpCtx) ([]string, error)
   ```

   The nine non-Redis adapters return `adapters.Unsupported(a.Kind(), "key types")` — the helper
   at `errors.go:57`, whose parameters are `(kind, what)` in that order.
3. **Redis** implements it in `catalog.go` with a single `goredis` pipeline of `TYPE`, resolving
   each path through the existing `resolveKeyTarget` (`adapter.go:147`) so the db index is honoured.
   Cap `true` only in `redis/caps.go`. A key deleted between SCAN and `TYPE` reports `none`;
   `redisTypeIcon` falls back to the generic glyph for it (§4.2) rather than erroring the batch.
4. **`TreeService.KeyTypes`** in `internal/bridge/tree.go`, mirroring `Children` (`:19-24`):
   `connectionId` required → `ipcerr.BadRequest`, then straight through to `Deps.Tree`.
5. **Frontend** `bridge/index.ts` gains `treeKeyTypes(connectionId, paths)` beside `treeChildren`
   (`:198`), same `unwrap`/`trust` shape.
6. **`browse/state.ts`** gains `keyTypes: Map<string, string>` in `BrowseViewRuntime` and
   `ensureKeyTypes(tabId, paths)` — dedupes against what is already known and against an in-flight
   request, batches, and writes results in. Cleared by `setLevel` alongside `filter`/`selected`
   (`:126-128`), for exactly the reason stated there: a path from the previous level must never
   colour a row in this one.
7. **`BrowseView.vue`** binds `@visible-range` on its `VirtualList` and calls `ensureKeyTypes` with
   the `key`-kind paths in the window — **only when** `caps.keyTypes` is true, so an S3 browse tab
   never issues the call.

Guards to implement, not discover later: batch size capped (**200** paths per call, well under any
viewport); the request tagged with `loadSeq` and dropped if superseded, the same supersession guard
`load()` already applies at `browse/state.ts:74/81`; a failed batch is **silent** — rows keep the
generic glyph — because a decorative badge must never raise the error strip that a failed *listing*
owns.

`runtime.keyTypes` must be a plain `Map` held outside the deep `reactive()` where possible, or kept
small by construction: `browse/state.ts:82-91` records that a level's nodes are `markRaw`'d
precisely because 200 000 reactive proxies cost real time. A `Map` bounded by what has been
*scrolled past* is far smaller, but the same discipline applies — do not hand it a whole level.

---

## 5. Session state

`browseTabStateSchema` (§1.3) gains exactly one field:

```ts
export const browseTabStateSchema = /*#__PURE__*/ z.object({
  levelPath: z.string().default(''),
  /** P63: the split's left-pane width in px. 0 means "the default" (DEFAULT_LIST_WIDTH), so a
   *  tab saved before this field existed restores unchanged. */
  listWidth: z.number().default(0),
});
```

`defaultBrowseTabState()` (`tabs.ts:487`) returns `listWidth: 0`. `.default()` is mandatory here,
not stylistic — `storage/repos/tabs.ts` drops a tab row outright on a failed parse, as the comment
above `browseTabStateSchema` already warns.

**Selection is deliberately not persisted.** It stays runtime-only, cleared on level change.
Persisting it would reintroduce exactly what P21 round 3 finding 14 fixed (a `selected` path
outliving the level it belongs to) and would make tab restore issue a value read nobody asked for.
A restored browse tab opens with an empty right pane.

The preview pane's own pager position (`pageIndex`/`pageSize`) lives in `BrowseViewRuntime`, not
session state — same reasoning: it belongs to a selection that itself does not survive restore.

---

## 6. Work order

One Sonnet subagent, sequential — the parts are order-dependent (the seam in §2.2 must land before
anything renders in the right pane, and the type fetch has a Go→IPC→frontend chain). Commits land
incrementally; typecheck/lint/build per commit, the UI suite once near the end (CLAUDE.md's own
rule).

| # | Commit | Contents |
| --- | --- | --- |
| 1 | `refactor(keyvalue): host seam for the key/value view state` | `host.ts`; `state.ts`/`mutations.ts` `tabId`→`viewKey` (12 sites, §1.2); tab-backed host registered; cleanup widened to `::preview` (§2.2). No behaviour change. |
| 2 | `refactor(keyvalue): extract KeyValuePane from KeyValueView` | `KeyValuePane.vue` + slot re-exposure; `KeyValueView.vue` reduced to chrome + pane. No behaviour change. |
| 3 | `feat(browse): vertical split with the value pane` | `.browse-body` flex row, `PanelSplitter orientation="col" divider`, `listWidth` in `browseTabStateSchema` + default, detail pane + empty states, single-click loads (§2.3). |
| 4 | `feat(browse): move back-navigation and breadcrumb into the list pane` | §3 — `chevron-left`, `.list-head`, count relocated. |
| 5 | `feat(redis): report key types for a batch of paths` | §4.3 steps 1-4 — `Caps.KeyTypes` both sides, `Adapter.KeyTypes` + 9 unsupported stubs, redis pipeline, `TreeService.KeyTypes`. |
| 6 | `feat(browse): per-type icons and badges for redis keys` | §4.3 steps 5-7 + §4.2 — `redisTypeIcon`, bridge call, `keyTypes` runtime + `ensureKeyTypes`, row rendering. |

Each of 1 and 2 must leave the existing KeyValue tab behaving identically — that is the check that
the seam is right, and it is cheap to verify before anything depends on it.

## 7. Tests

Per CLAUDE.md's bar, **no new unit tests for the view code** — a split layout, an icon swap and a
lookup table are not "advanced, complex or deeply nested logic".

Two places do earn coverage:

- **`redis`'s `KeyTypes`**, in `internal/adapters/redis/*_test.go` — the adapter conformance suites
  are explicitly exempt from that bar, and this is a new per-capability behaviour. Cover: order
  preserved against the input paths, a deleted key reporting `none`, db index honoured. The
  existing `scanner`-style fake (`catalog.go:118-121`) is the precedent for driving it without a
  live server.
- **`ensureKeyTypes`'s dedupe/supersede logic** in `browse/state.ts` — interacting rules over an
  in-flight set plus a `loadSeq` guard, which is the "cache invalidation with interacting rules"
  case the bar names. One test, not a suite.

Existing UI tests to re-run and expect to touch: anything asserting `browse-up`'s tooltip or its
position inside the toolbar, and anything asserting a single-pane `browse-view` body. The test id
itself is kept (§3.1) to hold that churn down.

## 8. Out of scope

Stated so a later pass does not read these as oversights:

- **Type filtering** of the key list (§4.1) — needs whole-level types.
- **S3 object size in the list.** `ListObjectsV2` already returns `obj.Size` in the same response
  (`s3/catalog.go:100-104`), so it would be free — but SPEC scopes this row's type work to Redis,
  and "scope left out of a phase stays out entirely".
- **Editing non-string Redis types.** `KeyValueView.vue:168-172` documents why edit is string-only;
  the split does not change it.
- **A horizontal (stacked) split option**, or persisting collapse state for either pane.
- **`MEMORY USAGE` per key in the list** — a second per-key command, and the detail pane already
  shows size.

## 9. Open question for the implementer

One, named rather than guessed: whether `data.read`'s `tabId` accepts a non-tab string (§2.2).
Read the op-log handling in `internal/` and take the stated fallback if it does not. Everything
else in this plan was checked against the tree.
