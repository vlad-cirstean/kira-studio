# P41 — Redis/S3 tree navigation, and the sticky ancestor-band fix

> **A single-pass phase.** One Opus plan, one Sonnet implementation pass — the same shape as P40,
> not P39's three iterations. The branch tip when this plan was written is `6e3b59d` on
> `feature/kickoff`; `git status --porcelain` over the repo is empty.
>
> **Scope is the user's own request, verbatim, and nothing else:** *"Redis and S3 connections
> currently expand their full key/object tree inline in the project panel; this phase keeps only
> the top-level containers (buckets for S3, databases for Redis) in the connection tree and adds a
> dedicated panel for the actual — potentially infinitely nested — key/object navigation. Also
> fixes the sticky ancestor-band header (P28's `stickyBand.ts`): the top band does not stick on
> scroll while a bottom one incorrectly does and duplicates rows."* Nothing is added to that and
> nothing is dropped from it.
>
> **This phase changes behavior, deliberately.** The discipline that replaces "zero behavior
> change" is P40's: every behavior change is a named decision in §3, every Playwright/`tests/db`
> assertion the change invalidates is named with its line number in F21 and edited **in the same
> commit** that changes the behavior, and nothing outside the two items moves.
>
> **The sticky bug is not in `stickyBand.ts`.** The user pointed at P28's geometry module; the
> geometry module is correct. The defect is one line of markup placement in
> `theme/primitives/VirtualList.vue` — the overlay slot is the **last** child of the scroll
> content, and `position: sticky; top: 0` can never pin a box that is already at the end of the
> content (F1). That is also exactly why the symptom reads as "a *bottom* band that sticks and
> duplicates rows" (F2). This is called out here because the fix is a two-line move in a file the
> request never names, and a plan that sent the implementer into `stickyBand.ts` would waste a day.

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read at `6e3b59d`.** Where a claim depends on CSS
  semantics rather than this repo's code, the mechanism is spelled out rather than asserted.
- **P39's layering rules stand** (`biome.json`'s seven `overrides`, re-read in full for this plan —
  `biome.json:60-208`). Every import this phase adds is `views/browse/* → views/shared/*`,
  `views/browse/* → state/*`, `views/browse/* → bridge/*`, `views/browse/* → theme/*`, or
  `state/* → state/*`. Nothing under `src/renderer/project/**` gains a `views/` import; nothing
  under `src/renderer/views/**` gains a `workbench/`, sibling-view or `project/` import. No
  override is weakened, and one new `state/viewCommands.ts` registry entry is added rather than a
  direct edge (D14).
- **No new dependency, no new build step, no migration, no new IPC channel.** The Browse panel
  runs entirely on `kira:tree:children`, the channel `ProjectTree.vue` and `StreamView.vue` already
  call. `tabs.kind` is a plain `text` column (`src/main/storage/schema/tabs.ts:7`), so a new tab
  kind needs no migration.
- **One wire-schema field is added** — `Caps.keyBrowser` (D6). It crosses engine→main→renderer on
  connect and is validated by `capsSchema`; both sides always ship from the same build, and it is
  never persisted, so there is no restore-compatibility question (contrast
  `consoleTabStateSchema.newResultSet`'s `.default(false)` in P40, which *was* persisted).
- **`data-testid`s are added, never removed or renamed.** Every existing `tree-*`, `keyvalue-*`,
  `upload-*` and `menu-item-*` testid still exists after this phase and still identifies the same
  thing. New ones follow the `browse-<thing>` convention.
- Comments per AGENTS.md: only where the code cannot say it for itself. Five existing comments
  become false as a result of this phase and are rewritten in the same commits
  (`VirtualList.vue:150-154`, `project/grouping.ts:67-69` and `:114-121`,
  `redis/catalog.ts:45-47`, `s3/index.ts:24-27`).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. The sticky ancestor band

**F1 — the overlay slot is the last child of the scroll content, so `position: sticky; top: 0`
can never engage.** `theme/primitives/VirtualList.vue:136-159` renders, in order: the optional
`#header` (in flow, real height), the top spacer, the visible rows, the bottom spacer, and *then*
the sticky overlay:

```html
    <div :style="{ height: `${bottomSpacer}px` }" />
    <div v-if="$slots.sticky" class="virtual-list-sticky" data-testid="virtual-list-sticky">
      <slot name="sticky" />
    </div>
  </div>
```

with `VirtualList.vue:173-178`:

```css
.virtual-list-sticky { position: sticky; top: 0; height: 0; z-index: 2; }
```

A sticky box with a `top` constraint is only ever offset **downward**: the box is shifted by the
minimum amount needed to keep its top border edge at least `top` px from the scrollport's top edge,
and no shift is applied when it already is. A zero-height box whose flow position is the very end
of the content is never above the scrollport top — its viewport-relative top is
`contentHeight − scrollTop`, which stays `≥ viewportHeight` for every reachable `scrollTop`. So the
offset is always zero and the band renders **at the end of the content**, not pinned. (`bottom: 0`
is what pins a box to the *bottom* of a scrollport; `top: 0` on a last-in-flow element pins
nothing. `.virtual-list-header:167-171` works precisely because it is *first*.)

**F2 — the band's rows are absolutely positioned inside that never-pinned box, which is why the
duplicates are reachable at the bottom of the list rather than merely clipped.**
`ProjectTree.vue:203-219` puts each pinned row inside the slot, and `ProjectTree.vue:245-255`:

```css
.sticky-row { position: absolute; left: 0; right: 0; background: var(--kira-bg); z-index: 1; }
```

`.virtual-list-sticky` is `position: sticky`, therefore *positioned*, therefore the containing
block for those absolute rows. `stickyBand()` gives them `top` values of `0`, `H`, `2H`
(`stickyBand.ts:65-67`), so they render up to three row heights **past the end of the content** —
and an absolutely positioned descendant contributes to its scroll container's scrollable overflow.
The container's `scrollHeight` therefore grows by up to `3 × rowHeight`, and scrolling into that
extra region shows one to three ancestor rows sitting at the bottom of the viewport, apparently
pinned there, duplicating rows that are also visible above. That is the user's report, exactly:
"the top band does not stick on scroll while a bottom one incorrectly does and duplicates rows."

**F3 — `stickyBand.ts` itself is correct and needs no change.** Its inputs are the flat row array,
`scrollTop` and `rowHeight` (`stickyBand.ts:69-118`); its outputs are row/index/top triples. Every
part of the reported symptom is explained by where the slot sits in the DOM (F1/F2); none of it is
explained by the chain selection (`ancestorsOf`, `:48-63`), the cap (`STICKY_MAX_ROWS`, `:24`), the
handoff (`slotTopFor`, `:65-67`) or the kept-prefix loop (`:99-116`). `stickyInsetFor` (`:123-132`)
is equally unaffected.

**F4 — no existing assertion could have caught it, which is why it survived from P28 to here.**
`tests/ui/tree.spec.ts:302-360` is a thorough band suite — counts, `data-path`, `data-depth`,
twisty behaviour, the two-connection handoff, and even `Number.parseFloat(el.style.top)` at
`:452-454` — but it never once compares a sticky row's **viewport box** to the scrollport's.
`tests/ui/support/tree.ts:57-91`'s `clearStickyBand` measures the band's *height* (from its
children's rects, relative to the band itself) and then assumes it occludes `containerBox.y` — so
it also never reads the band's own position, and it keeps working unchanged after the fix.

**F5 — the defect is original to P28, not a later regression.**
`git log -L 150,160:src/renderer/theme/primitives/VirtualList.vue` returns exactly one commit,
`36e185d` ("feat(workbench): publish scroll state and a sticky overlay slot from VirtualList
(P28 step 2)"), which introduced the block in its current position; the only later commit touching
the file is `987758c`, the P39 move into `theme/primitives/`.

### B. What Redis and S3 render in the tree today

**F6 — Redis: `database` → recursively nested `namespace` levels split on `:` → `key` leaves whose
name is the complete key.** `redis/catalog.ts:13-37` lists one `database` node per
`INFO keyspace` line with `hasChildren: true` (`:31`) and a `"N keys"` detail (`:32`).
`redis/catalog.ts:48-105`'s `listNamespaceChildren` SCANs `<prefix>*`, splits the remainder on the
first `:`, and emits a `namespace` node per distinct first segment (`hasChildren: true`, `:95`) plus
a `key` node per un-split remainder (`hasChildren: false`, `:81`) whose `name` is the **whole** key,
not the local segment (`:74`, the D3 rule its own comment records). `redis/index.ts:62-84` accepts
`database` followed by any number of `namespace` segments, so the nesting is unbounded.

**F7 — S3: `bucket` → recursively nested `prefix` levels split on `/` → `object` leaves whose name
is the full bucket-relative key.** `s3/catalog.ts:22-54` lists buckets (`hasChildren: true` at
`:34` for the single-bucket-scoped case and `:51` for the general one).
`s3/catalog.ts:61-132`'s `listPrefixChildren` issues `ListObjectsV2` with `Delimiter: '/'`, mapping
`CommonPrefixes` to `prefix` nodes (`hasChildren: true`, `:106`) and `Contents` to `object` nodes
(`hasChildren: false`, `:122`) whose `name` is the full key (`:120`, with `:113-119` recording the
same reasoning Redis's leaves use). `s3/index.ts:62-91` accepts `bucket` followed by any number of
`prefix` segments — again unbounded. The user's summary of the current shape is accurate for both
engines; the only thing it understates is that the leaf *labels* are full keys, which matters for
D9.

**F8 — both listings are round-capped and truncate silently, and nothing in the protocol can say
so.** `redis/catalog.ts:10-11` (`SCAN_COUNT = 1000`, `MAX_SCAN_ROUNDS = 200`) and
`s3/catalog.ts:15` (`MAX_LIST_ROUNDS = 20`) each stop the loop early and return what they have —
the comments call this "degrades to *not everything shown yet under this prefix*". `TreeNode`
(`shared/domain/tree.ts:75-83`) has no truncation field and `TreeChildrenResult`
(`main/tree-service.ts:21-24`) carries only `{ nodes, source }`. This is pre-existing behavior, not
something this phase introduces — see D15 for why it stays pre-existing.

**F9 — every level a user expands is retained for the connection's lifetime.**
`project/state/tree.ts:47-59` keeps `children: Record<string, TreeNode[]>` keyed by
`${connectionId}|${path}`; `collapse()` (`:153-155`) deletes only the *expanded* flag, and
`expand()` (`:149`) explicitly returns early when `treeState.children[k]` is populated. The only
eviction is `dropConnectionState()` (`:223-243`), driven by connection deletion. So browsing a
100k-key Redis namespace tree leaves every visited level resident until the connection is deleted.
That is the scalability half of the user's complaint, stated in code.

**F10 — the tree's search never covered unexpanded key levels anyway.**
`project/state/tree.ts:306` sets `stats.incomplete` and `:312` only recurses into
`treeState.children[k]` — §8.3's own "filters the tree over **cached nodes only** … the panel says
so rather than silently under-reporting" (SPEC.md:400-402). A Redis key was findable by search only
if you had already hand-expanded its namespace. The cut therefore removes far less search coverage
than the tree's shape suggests (D8's honesty argument).

### C. The precedent for cutting a level out of the tree

**F11 — P23 already did exactly this, for Kafka topics, and its shape is four parts.**
(a) the adapter reports `hasChildren: false` on the container — `kafka/catalog.ts:33-41`, whose
comment reads *"P23 D3: a topic no longer expands in the tree — its partitions moved into the
definition view. `detail` keeps the count as the tree's at-a-glance summary."*;
(b) the adapter **keeps** enumerating the level — `kafka/index.ts:68-74`:

> *"P23 D4: a topic path still enumerates its partitions here — the tree no longer expands a topic
> (D3), but StreamView.vue's partition filter popover is a second, live caller of this same call
> … Deleting this the way P19's D5 deleted column enumeration would break that filter; the two
> cases differ precisely because this one still has a caller."*

(c) the renderer keeps a stale-cache guard — `project/grouping.ts:114-121`'s `isLeafKind`, whose
comment names the reason (an L1 payload cached before the phase can still carry
`hasChildren: true`); (d) a dedicated non-tree consumer calls the same IPC — `StreamView.vue:275-300`
calls `control.treeChildren(connectionId, props.tab.path, false)` on popover open. SPEC.md:407-412
records the whole arrangement. **P41's Redis/S3 cut is this shape, unchanged, at a level that
happens to be recursive.**

**F12 — the renderer guard is not redundant with the adapter flag, because the metadata cache is on
disk.** `main/tree-service.ts:59-80` is a cache-aside over `storage/repos/metadata-cache`, i.e. a
table in `~/.kira-studio/kira.sqlite`. A user who upgrades into this phase still has yesterday's
`hasChildren: true` bucket listing cached until a refresh or reconnect, so without the guard the
first launch after the upgrade shows twisties that expand into nothing.

**F13 — `isLeafKind` is keyed on `NodeKind` alone, and `database` is shared by six engines.**
`project/grouping.ts:119-121` takes only a kind; `shared/domain/tree.ts:3-26` has one `database`
member, reused by postgres/mysql-family/sqlite/clickhouse/mongo (as a real database), by redis (as
a db index, `redis/catalog.ts:28`) and by rabbitmq (as a vhost, `grouping.ts:50-52`). `bucket` is
S3-only, but `database` cannot be made a leaf globally. This is precisely why the cut needs a
per-connection signal (D6) rather than one more entry in that function.

### D. Where a dedicated panel can live

**F14 — the layering rules, read in full.** `biome.json:184-208` forbids `**/views/**` from
anything under `src/renderer/project/**` ("dispatch through `state/viewCommands.ts` instead");
`biome.json:64-104` forbids `**/workbench/**` and every sibling `views/<kind>/**` from anything
under `src/renderer/views/**`. SPEC.md:1150-1160 states the third edge that has no lint rule but is
equally binding: *"`renderer/state/` exists so `views/*` are siblings that depend downward on shared
state, never sideways on each other, upward into `workbench/`, or (P39 iter3) into `project/`"*.
So a panel under `views/` may not reuse `project/TreeRow.vue`, `project/stickyBand.ts` or
`project/state/tree.ts` — a real constraint on the panel's design, and the direct input to D8.

**F15 — this app's own answer to "browse something big or deep separately from the connection tree"
is a tab kind, every time.** P19 moved a table's columns out of the tree into the **definition**
tab (SPEC.md:407-412); P23 moved a topic's partitions into the same tab and gave the stream view its
own live re-fetch; P27 built `views/documents/DocumentTree.vue` for one document's arbitrarily
nested structure *inside* a tab; the query console is a tab. There is no second sidebar anywhere in
the app: `shared/domain/layout.ts:19-27` has exactly three panels (project, operations, cellEditor)
and `WorkbenchShell.vue:77-83`'s grid has exactly four areas. Adding a fourth panel means a layout
schema field, a `layoutState` patcher, a status-bar toggle, a splitter, and a persisted size — for a
surface that would be a singleton and would have to be driven by "the currently selected tree row",
a coupling this app has never had.

**F16 — adding a tab kind costs six touch points and no migration.** `shared/domain/tabs.ts` needs
`tabKindSchema` (`:5-13`), `RENDERABLE_TAB_KINDS` (`:19-26`), a state schema + `default*State()` +
`as*Tab()` and one `tabRecordSchema` variant (`:142-149`); `state/tabs.ts` needs an `open*Tab`
(`:210-296` are five near-identical ones over the shared `openTab` helper at `:168-205`) and a
`duplicateTab` branch (`:299-372`); `MainView.vue:66-92` and `TabStrip.vue:26-41` need a dispatch
and an icon. `storage/repos/tabs.ts:1-55` parses with Zod and drops unknown kinds with a `warn` —
`tabs.kind` is untyped `text` (`storage/schema/tabs.ts:7`), so nothing in `storage/migrations/`
changes.

**F17 — `state/viewCommands.ts` is the only legal `project/ → views/` dispatch, and it already
carries three registries** (`viewCommands.ts:13-27` reload, `:31-42` count, `:46-61` data query
commands). Its doc comment (`:3-10`) records why an unregistered kind *throws* rather than no-ops:
every view's `state.ts` registers at module scope and is reached by a static import chain from
`main.ts` → `App.vue` → `WorkbenchShell.vue` → `MainView.vue` → each view's `*View.vue` → `./state`.
A new view added to `MainView.vue` inherits that guarantee unchanged.

**F18 — everything a new view needs is already shared, with no new edge.**
`views/shared/viewOp.ts:18-53` (`classifyLoadError`, `stopOp`, `createRuntimeStore`),
`views/shared/useConnectionGate.ts:13-44` (§8.4's reconnect gate),
`theme/primitives/ViewChrome.vue:1-90` (header + rail + toolbar + Refresh/Stop),
`theme/primitives/VirtualList.vue`, `theme/icons.ts:29-31` (`nodeIcon`, which already has entries
for `namespace`/`key`/`prefix`/`object` at `:14-22`), `state/contextMenu.ts`,
`state/objectStore.ts:28-100` (upload dialog, download, delete) and `bridge/control.ts:98-102`
(`treeChildren`). `views/keyvalue/state.ts:1-174` is the exact template for a view state module —
runtime store, `registerTabRuntimeCleanup`, `registerTabReload` at the bottom.

### E. What the cut breaks

**F19 — four menu builders in `project/menus.ts` become unreachable, and one shared helper has
call sites on both sides of the cut.** `menuForRow`'s `namespace`/`prefix`/`key`/`bucket`/`object`
cases are `menus.ts:76-85`; the bodies are `namespaceMenu` (`:501-519`), `prefixMenu` (`:524-526`),
`keyMenu` (`:531-561`) and `objectMenu` (`:567-630`). `uploadMenuItem` (`:295-308`) is called by
`bucketMenu` (`:312-314`, which stays a tree row) **and** `prefixMenu` (`:525`, which does not) —
and the Browse panel needs the same item for its own prefix rows. SPEC §8.10's table rows at
SPEC.md:631, :633 and :634 describe these menus as tree menus.

**F20 — `revealPath` would silently reveal nothing for a Redis key or S3 object tab.**
`project/state/tree.ts:196-211` expands every ancestor segment in order and then sets
`pendingScrollKey` to the leaf's own row key; `ProjectTree.vue:68-79` looks that key up in
`visibleRows` and returns early when `findIndex` is `-1`. After the cut, a
`database:db0/namespace:user/key:user:1:name` path expands three nodes the tree does not render and
scrolls to a row that does not exist — a no-op with no feedback. `TabStrip.vue:98-105` is the one
caller ("Reveal in project panel", SPEC.md:639).

**F21 — the assertions this phase invalidates, with line numbers.**

| File | Lines | What it asserts that stops being true |
|---|---|---|
| `tests/ui/redis.spec.ts` | `:89-104`, `:123`, `:137` | `expandRow(DB0_PATH)`, `expandRow(USER_NS_PATH)`, `expandRow(USER_1_NS_PATH)`, `expandRow(QUEUE_NS_PATH)`, `expandRow(SESSION_NS_PATH)` and `data-kind="namespace"`/`"key"` tree rows |
| `tests/ui/s3.spec.ts` | `:151-201` | `expandRow(EMPTY_BUCKET_PATH)`, the "expands to zero children" check, `expandRow(MAIN_BUCKET_PATH)`, `data-kind="prefix"`/`"object"` rows, the prefix context menu (`:180-184`), the object context menu (`:196-200`) |
| `tests/ui/s3.spec.ts` | `:281-283`, `:310-312`, `:358-361`, `:390-393`, `:468-469`, `:492-495` | five more `expandRow(bucket/prefix)` + `findRow(object)` sequences, and `openRowMenu(DELETE_TARGET_PATH)` → `menu-item-delete-object` |
| `tests/ui/s3.spec.ts` | `:455-457` | "the tree row exists too" after an upload into an empty bucket |
| `tests/ui/memory.spec.ts` | `:54-57`, `:278-282` | `expandRow(REDIS_DB0_PATH)`, `expandRow(SESSION_NS_PATH)`, `findRow(key)` |
| `tests/db/s3.spec.ts` | `:171` | `root.every(n => n.kind === 'bucket' && n.hasChildren === true)` |
| `tests/db/redis.spec.ts` | `:131-141` | cap-honesty list (gains `keyBrowser`; nothing here becomes false) |
| `tests/db/s3.spec.ts` | `:150-163` | cap-honesty list (same) |

`tests/db/redis.spec.ts:115` asserts only `kind === 'database'`, never `hasChildren`, so it needs no
edit. No other spec references a Redis/S3 tree path: `grep -rln "key:\|object:\|bucket:"
tests/ui/*.spec.ts` matches `budgets`, `connections`, `console` and `secrets` only through unrelated
TypeScript index signatures and local variables.

**F22 — `UploadObjectDialog.vue` refreshes a tree level the tree will no longer render.**
`workbench/UploadObjectDialog.vue:7` imports `refresh` from `project/state/tree` and `:60` calls
`refresh(connectionId, uploadDialogState.containerPath)` before opening the uploaded object's tab
(`:62`). For a bucket that still repopulates main's L1 cache (useful — the Browse panel reads the
same cache); for a prefix it writes into `treeState.children` under a path with no row.

**F23 — the leak hook needs no change, and the Browse panel is a net win for §2.2.**
`renderer/main.ts:47-53` sums the five **page** stores' byte-packed buffers. A Browse tab holds a
`TreeNode[]` for exactly one level, which is the same class of data `treeState.children` already
holds uncounted, and it is freed by `registerTabRuntimeCleanup` (the mechanism
`views/keyvalue/state.ts:43-46` uses) when the tab closes. Against F9, this phase *reduces* steady
-state retention: the tree keeps only databases/buckets, and the deep levels live one-per-open-tab
with a real free path.

**F24 — P28's filter dialog derives from the same cache, so its Redis/S3 content shrinks with the
tree.** `project/filterTree.ts:1-10` builds its rows from `treeState.children` and calls
`isLeafKind` (`:6`); after the cut, a Redis or S3 connection's **Objects** section is its
databases/buckets and nothing deeper, and its **Object types** section lists only the kinds still
present. `filterTree.ts` is therefore a required call-site edit for D4's signature change, not just
a consequence.

---

## 2. Shapes introduced in this plan

**`shared/caps.ts` — one new flag, placed with the other shape flags:**

```ts
  // ---- shape: what view the UI reaches for, and what a page looks like
  tabular: boolean;
  documents: boolean;
  keyValue: boolean;
  stream: boolean;
  /** P41: this engine's containers hold an arbitrarily nested, unbounded key space. The project
   *  tree shows the containers only (a redis `database`, an s3 `bucket`); the space itself is
   *  navigated in a Browse tab (§8.18). True for redis and s3, false for the other nine. */
  keyBrowser: boolean;
  defaultPageKind: PageKind;
```

plus the matching `keyBrowser: z.boolean()` line in `capsSchema` (`caps.ts:72-90`).

**`shared/domain/tabs.ts` — one new tab kind and its state:**

```ts
// The level currently shown, as an encoded path. '' means the tab's own `path` — the container it
// was opened on — so a freshly opened tab and a tab restored at its root are the same record.
export const browseTabStateSchema = z.object({ levelPath: z.string().default('') });
export type BrowseTabState = z.infer<typeof browseTabStateSchema>;
```

`'browse'` joins `tabKindSchema`, `RENDERABLE_TAB_KINDS` and `tabRecordSchema`;
`defaultBrowseTabState()`, `asBrowseTab()` and `BrowseTabRecord` follow the five existing shapes
verbatim. `tabTitle()` needs no branch — `pathTail('bucket:photos').name` is `photos` and
`pathTail('database:db0').name` is `db0`.

**`project/grouping.ts` — `isLeafKind` gains one boolean:**

```ts
export function isLeafKind(kind: NodeKind, keyBrowser = false): boolean {
  // P41: a redis `database` / s3 `bucket` is a leaf in the *tree* — its key space is browsed in a
  // Browse tab (§8.18). The adapters already report hasChildren: false; this is the same
  // stale-L1-payload guard P19/P23 kept for tables and topics (F12).
  if (keyBrowser && (kind === 'database' || kind === 'bucket')) return true;
  return kind === 'table' || kind === 'view' || kind === 'matview' || kind === 'topic';
}
```

**`project/state/tree.ts` — one per-connection view object instead of a seventh positional
parameter.** `searchResult` already computes `sets` once per connection (`:409`); it computes
`keyBrowser` beside it and passes both through:

```ts
interface ConnectionView { sets: VisibilitySets; keyBrowser: boolean }
```

replacing the `sets: VisibilitySets` parameter of `buildRows` (`:347-356`) and `buildNodeRow`
(`:288-296`), both of which already take six arguments.

**`views/browse/state.ts` — the runtime, mirroring `views/keyvalue/state.ts`:**

```ts
export interface BrowseViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: { code: string; message: string } | null;
  /** The level currently loaded — one `children()` listing, never a tree. */
  nodes: TreeNode[];
  /** Substring filter over `nodes`, runtime-only (grid/state.ts's `searchOpen` precedent). */
  filter: string;
  /** The row that holds the list's roving tab stop, by path. */
  selected: string | null;
}
```

with `load(tabId, opts?: { refresh?: boolean })`, `reload(tabId)`, `descend(tabId, path)`,
`ascend(tabId)`, `goToLevel(tabId, path)`, `invalidateLevel(connectionId, path)`, and, at the
bottom, `registerTabReload('browse', reload)` + `registerBrowseInvalidate(invalidateLevel)`.

**`state/viewCommands.ts` — one new registry, in the file's existing style:**

```ts
export type CommandTabKind = 'data' | 'document' | 'keyvalue' | 'stream' | 'browse';

// P41: an S3 upload lands in a container the project tree no longer renders, so the dialog can no
// longer reach for project/state/tree.ts's refresh(). The Browse view owns that level now.
let browseInvalidateFn: ((connectionId: string, path: string) => Promise<void>) | null = null;
export function registerBrowseInvalidate(fn: (c: string, p: string) => Promise<void>): void;
export function browseInvalidate(connectionId: string, path: string): void; // fire-and-forget
```

**`state/objectStore.ts` — `uploadMenuItem` moves here from `project/menus.ts`,
connection-and-path shaped instead of row shaped:**

```ts
/** P33 D3's gate (fileTransfer + canInsert + not read-only), now shared by the tree's bucket row
 *  (project/menus.ts) and the Browse panel's bucket/prefix rows (views/browse/menu.ts) — the two
 *  live on opposite sides of the project/→views/ layering rule, so the item itself lives here. */
export function uploadMenuItem(connectionId: string, containerPath: string): MenuItem[]
```

**`views/browse/BrowseView.vue` — the panel, sketched:**

```
[ViewChrome: icon · "S3 / photos" · connection dot + rail]
[toolbar: ↻ ⏹(disabled) │ ↑Up │ photos / reports / 2024 │ [filter…] │ Upload file…   17 items]
[VirtualList
   ▸ 2023                     (prefix — descends)
   ▸ 2024                     (prefix — descends)
     reports/summary.json     (object — opens a keyvalue tab)
]
```

Testids: `browse-view` (with `data-path` = the tab's container and `data-level` = the current
level), `browse-up`, `browse-crumb`, `browse-filter`, `browse-upload`, `browse-count`,
`browse-row` (with `data-path`, `data-kind`), `browse-empty`, `browse-error`.

---

## 3. Decisions

### The sticky ancestor band

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Move the `#sticky` slot wrapper to be the first child of `.virtual-list`**, before `#header` and the top spacer. Nothing else changes — same class, same zero height, same `top: 0`, same `z-index: 2`. | F1. A zero-height sticky box at flow position 0 has viewport-relative top `−scrollTop`, which violates `top: 0` for every `scrollTop > 0`, so it is shifted down by exactly `scrollTop` and lands on the scrollport's top edge — which is what the band has always been drawing against. It still contributes no layout, so `topSpacer`/`bottomSpacer`/`startIndex`/`endIndex` keep their exact meanings and `VirtualList.vue:150-154`'s comment stays true apart from the word "above", which is rewritten. As a bonus, F2's scrollable-overflow inflation disappears: a sticky box's overflow contribution is computed from its *unshifted* position, which is now 0, so the band's rows fall inside the content instead of past its end. |
| D2 | **Not** a JS-positioned absolute overlay (`top: scrollTop` written from the `scrollstate` emit), and **not** `bottom: 0`. | The first re-introduces a per-frame write on the panel's hottest path and makes the band lag the rows it stands in for by one tick — P28 D2's whole point was that the pinning is pure CSS and the geometry module is DOM-free. The second pins to the wrong edge. The one-line placement fix is strictly smaller than either. |
| D3 | **The band keeps a negative `top` during handoff and stays clipped by the scroll container**, unchanged. | `stickyBand.ts:65-67` deliberately pushes an outgoing header above the scrollport (`slotTopFor` can return a negative). With the wrapper at flow position 0, that draws above the content's start edge, where `overflow: auto` clips it and no scroll position can reach it — exactly the "slides out, no flicker, no gap" behavior SPEC.md:393-399 describes, and what `tree.spec.ts:449-454` already asserts via `el.style.top`. |
| D4 | **The regression guard is geometric and lands in two specs**: `tree.spec.ts` (thorough, Docker-gated) and `sqlite.spec.ts` (short, runs unconditionally in this sandbox). The sqlite one opens the operations panel first so the tree's overflow is deterministic rather than dependent on the default window height. | F4 — the existing suite proved that DOM-level assertions cannot see this bug, so the new assertion must compare `boundingBox()` values: the first pinned row's `y` equals the scrollport's `y` (±1px), and the band's bottom never exceeds the scrollport's bottom. The sqlite fixture has 16 tables + a Views folder (`tests/db/fixtures/0009_sqlite_seed.sql`), so `database:main` expanded is ~19 rows ≈ 532px against a ~290px viewport with `toggle-operations-panel` on — comfortably overflowing, and restored by clicking the same toggle again. |

### The cut

| # | Decision | Rationale |
|---|----------|-----------|
| D5 | **The cut is adapter-declared: `redis/catalog.ts:31` and `s3/catalog.ts:34,51` flip to `hasChildren: false`.** The renderer's `isLeafKind` guard (D7) backs it up for stale caches. | F11(a)/F12. This is where the boundary belongs: the adapter is the thing that knows what a `database`/`bucket` node promises, and Adapter rule 5 (`adapter.ts:47-49`) makes `hasChildren` exactly that promise. It is also a *real* change in the shipped tree data rather than a renderer toggle over unchanged data — the tree stops rendering a twisty because the node stops claiming children, not because the UI hides one. |
| D6 | **A new `Caps.keyBrowser` boolean, true for redis and s3.** Not a `connection.kind` check, and not a `defaultPageKind === 'keyvalue'` proxy. | ARCHITECTURE.md:19-22 — *"the UI reads only `Caps`, never a `connection.kind` check, to decide what to show."* F13 shows why a per-kind rule cannot work (`database` is shared by six engines). `defaultPageKind === 'keyvalue'` happens to select exactly redis and s3 today, but it answers a different question ("what view does an item open in") and would silently mis-answer this one the day a keyvalue-shaped engine with a flat container arrives. P33 added `fileTransfer` the same way, for the same reason, and its comment (`caps.ts:60-65`) is the model for the new one. Cost: eleven one-line edits in `engine/adapters/*/caps.ts`, one interface line, one Zod line. |
| D7 | **`isLeafKind(kind, keyBrowser = false)`** — kind plus one boolean, defaulted so no existing call changes meaning. `project/state/tree.ts` and `project/filterTree.ts` pass `caps?.keyBrowser === true`. | F12/F13/F24. Keeps `grouping.ts` pure (it still imports nothing from `state/`), keeps the guard in the one place P19 and P23 already put theirs, and covers the on-disk-cache case those two phases both had to cover. |
| D8 | **Redis's and S3's `children()` implementations are not touched.** They keep enumerating namespaces/keys and prefixes/objects. | F11(b), verbatim. The Browse panel is the second, live caller — precisely the distinction `kafka/index.ts:68-73` draws between a level with no caller left (P19's columns, deleted) and one with a caller (P23's partitions, kept). Deleting them would mean inventing a second listing API for data the adapter already returns. |
| D9 | **`revealPath` truncates to the deepest ancestor the tree actually renders**, selecting and scrolling to that row instead of a row that does not exist. | F20. "Reveal in project panel" names the panel; revealing the Redis database or S3 bucket an item lives in is the honest answer once the panel stops holding the item. The truncation reuses `isLeafKind` rather than hard-coding kinds, so it stays correct for any future cut. |
| D10 | **The four dead tree menus (`namespaceMenu`, `prefixMenu`, `keyMenu`, `objectMenu`) are deleted from `project/menus.ts` and rebuilt in `views/browse/menu.ts`; `uploadMenuItem` moves to `state/objectStore.ts` and is shared.** | F19 + AGENTS.md's "scope left out of a phase is left out entirely, not half-implemented" — leaving unreachable menu builders behind would be exactly the dead code P39 spent three iterations removing. The one genuinely shared piece is `uploadMenuItem`, whose two call sites now sit on opposite sides of the `project/ → views/` rule (F14); `state/objectStore.ts` already owns `openUploadDialog` and already exists *because* `project/menus.ts` needed to reach S3 actions without importing `views/` (SPEC.md:1121-1124), so it is the file that rule already chose for this. |

### The dedicated panel

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | **The dedicated panel is a new tab kind, `browse`, under `src/renderer/views/browse/`** — not a second sidebar, not a pane inside the project panel, not a folder under `project/`. | F15/F16. A tab is this app's unit for "a view onto one thing in one connection," and it comes with everything this panel needs for free: independent per-instance state (two buckets open at once, §8.4's identity rule), session restore with the Reconnect gate, connection tinting, the tab strip, `ViewChrome`, `useConnectionGate`, `createRuntimeStore` and per-tab cleanup. A fourth workbench panel would need a layout schema field, a patcher, a status-bar toggle, a splitter and a persisted size (F15) to produce a *singleton* surface coupled to tree selection. Placing it under `project/` was considered and rejected: `MainView.vue` may import `project/` (workbench→project is an existing edge), so it would lint clean, but it would make `project/` the only folder in the renderer that owns both a sidebar and a tab view, and it would put a tab view somewhere no reviewer looks for one. The user's word "panel" is read as "a dedicated surface of its own", which is what this is; the app's own vocabulary calls that surface a view in a tab. |
| D12 | **The panel shows one level at a time with a breadcrumb, not a second tree.** Containers descend on double-click/Enter; the breadcrumb and an Up button go back; leaves open the existing `keyvalue` tab. | Four reasons, in order of weight. (1) It maps 1:1 onto `children(path)` — one call, one level, no expansion state to invent. (2) Bounded memory: one `TreeNode[]` per open tab, freed on close (F23), against F9's unbounded retention — which is the scalability complaint the user actually filed. (3) It needs no row-tree machinery, so it never wants `project/TreeRow.vue` or `project/stickyBand.ts` and never tempts the `views/ → project/` edge F14 forbids. (4) It is what the AWS S3 console and every Redis client do for the same problem, so it needs no explaining. A second tree inside the tab would reproduce the retention problem one level down and would need its own sticky band. |
| D13 | **A leaf row shows the node's `name` verbatim — the full Redis key / full bucket-relative S3 key — exactly as the tree does today.** Container rows show their local segment, also as today. | F6/F7. The alternative (stripping the current level's prefix to show a local label) needs the engine's own separator — `:` for Redis, `/` for S3 — reconstructed in the renderer, or a new label field on `TreeNode`. The first is engine-specific string surgery in a layer that has none; the second widens the tree protocol, which D15 declines for a better reason. Showing the full key is also what a user copies, and the breadcrumb supplies the context the label would have duplicated. |
| D14 | **A Browse tab's identity is its container** (`path` = `database:db0` / `bucket:photos`); **the current level is per-tab session state** (`browseTabStateSchema.levelPath`, `''` meaning "the tab's own path"). Upload/delete invalidation reaches the panel through a new `state/viewCommands.ts` registry entry, never a direct import. | Identity-by-container makes "Browse keys" on the same database reuse one tab (`openTab`'s `reuse` path, `tabs.ts:175-183`) while "open in new tab" still gives a second with independent state — §8.4's rule, unchanged. Persisting `levelPath` puts a restored tab back where it was, the same class of session state as `documentTabStateSchema.expanded`. The registry entry replaces F22's `UploadObjectDialog.vue:60` call into `project/state/tree.ts`, and it is the pattern F17 established for exactly this shape of cross-module call. |
| D15 | **No paging and no truncation reporting in this phase.** F8's silent truncation is carried forward unchanged. | Reporting it honestly means `Adapter.children()` returning `{ nodes, truncated }` instead of `TreeNode[]` — and `adapter.ts:138-141` gates that: *"A later phase that widens `Adapter` again does so by amending `docs/v1/plans/P1-connections-and-tree.md` §4b first."* Widening the contract across eleven adapters, `tree-service.ts`, the L1 cache payload and the IPC schema is its own phase's worth of work, and the user asked for navigation, not for a listing-protocol change. §6 records it as out of scope and §8 hands it forward, rather than half-implementing a "load more" the adapter cannot support. |
| D16 | **A level load has no Stop button and no `RunState`.** `ViewChrome` is mounted with `:can-stop="false"`. | `kira:tree:children` is not an engine op with an `opId` — `main/ipc/tree.ts:20-23` calls `tree.children()` directly, and only `describe`/`definition` accept the `tabId` that tags an op-log row (`ipc/tree.ts:10-13`). The tree's own expansion has no stop button either; a disabled one is the honest rendering, and inventing a cancellable tree op is a `scheduler/` change nobody asked for. |
| D17 | **Entry points: double-click, Enter, and a first-position context-menu item on a `keyBrowser` container row.** The item's id is `browse`; its label is `'Browse objects'` for a `bucket` and `'Browse keys'` otherwise. | Those rows do nothing on double-click today and will do nothing after D5 (`ProjectTree.vue:129`'s `if (!row.hasChildren) return`), so the gesture is free and matches every other openable row. The label switch is on `NodeKind`, not on `connection.kind` — `menus.ts` is a per-`NodeKind` switch from top to bottom (`:61-100`), so this is the file's own vocabulary, while the *gate* stays `caps.keyBrowser` (D6). One stable id keeps `menu-item-browse` a single testid. |
| D18 | **The Browse panel's filter is a plain substring match over the loaded level**, with the count strip reading `M of N` while it is active. | The same honesty §8.3 already states for tree search (F10): it filters what is loaded, and it says how much that is. A server-side `SCAN MATCH` / `ListObjectsV2 Prefix` search across a whole key space is a real feature with real cost (and D15's protocol problem), listed in §6. |

### Tests and documentation

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | **Every spec F21 names is edited in the commit that changes the behavior it asserts**, not in the later test commit. `tests/db/s3.spec.ts:171` flips with the adapter; the three UI specs are rewritten with the tree cut; the two cap-honesty tests gain `keyBrowser` with the caps commit. The dedicated *new* Browse scenarios are the separate test commit. | P40's own rule, and this repo's discipline: no commit leaves the suite red. |
| D20 | **Docs land last, in one commit**: SPEC §5.1 (the Redis and S3 tree-levels cells, `SPEC.md:218,221`), §8.3 (`:375-412`, the cut and what the tree still shows), §8.4 (`:417`, the tab-kinds list), §8.8 (`:559-596`, a pointer to §8.18 for how an object/key is reached), §8.10 (`:631,633,634`, the three menu rows move from tree targets to Browse-panel targets), a new **§8.18 Browse panel**, §10's P41 row, §11's tree (`views/browse/`, plus the `state/objectStore.ts` and `state/viewCommands.ts` notes); and `ARCHITECTURE.md`'s adapter-contract paragraph (`:15-24`, `keyBrowser`) and MongoDB/Redis + S3 sections (`:129-134`, `:171-175`). | ARCHITECTURE.md:5-8 — SPEC is authoritative for behavior, ARCHITECTURE is the current-state cut; both currently describe a tree that will no longer exist. |

---

## 4. Implementation order

Seven commits. Each is one sitting, independently reviewable, leaves `lint`/`typecheck` (node,
web, db, electron-db)/`build` green, and carries the spec edits for the behavior *it* changes. The
sticky fix comes first because it is independent of everything else and is the one item that is
purely a bug. The Browse panel is built and made reachable **before** the tree is cut, so the
reviewer of commit 5 can compare the two navigations side by side and the tree is never cut with
nowhere to go.

1. **`fix(workbench): the sticky ancestor band pins to the top of the scrollport`** — D1/D2/D3/D4.
   `theme/primitives/VirtualList.vue`: move the `v-if="$slots.sticky"` block from after the bottom
   spacer to before `.virtual-list-header`, and rewrite its comment (the "topSpacer/bottomSpacer
   **above**" wording becomes "below", and the reason `top: 0` needs flow position 0 is stated in
   one sentence — this is the exact fact whose absence cost this bug three phases).
   `tests/ui/tree.spec.ts`: extend the existing band block after `:321` with the two `boundingBox()`
   assertions, plus a scroll-to-`scrollHeight` check that no `tree-sticky-row` sits below the
   scrollport. `tests/ui/sqlite.spec.ts`: a short block after `:83` — toggle the operations panel,
   scroll `3 × 28`px, assert two sticky rows pinned at the scrollport's top edge, toggle it back.
   No other file changes.
2. **`feat(caps): a keyBrowser capability for engines with a browsable key space`** — D6.
   `shared/caps.ts` (interface + `capsSchema` + the §5.1 doc table's new column is *not* added —
   that table is prose and D20 owns it), eleven `engine/adapters/*/caps.ts` literals (`redis`/`s3`
   true, the other nine false, each with no comment except redis's and s3's one-liner),
   `tests/db/redis.spec.ts:131-141` and `tests/db/s3.spec.ts:150-163` gain one assertion each.
   **No behavior change** — nothing reads the flag yet.
3. **`feat(browse): a browse tab kind over one lazy key/object level`** — D11/D12/D13/D14/D16/D17.
   `shared/domain/tabs.ts` (kind, `RENDERABLE_TAB_KINDS`, `browseTabStateSchema`,
   `defaultBrowseTabState`, `asBrowseTab`, record variant); `state/tabs.ts` (`openBrowseTab`, the
   `duplicateTab` branch — note `dropAllPagesForTab` needs no new call, F23);
   `state/viewCommands.ts` (`CommandTabKind` gains `'browse'`); `views/browse/state.ts` and
   `views/browse/BrowseView.vue`; `workbench/panels/MainView.vue` (dispatch) and
   `workbench/panels/TabStrip.vue` (`iconFor` gains `list-tree`); `project/ProjectTree.vue` and
   `project/menus.ts` gain the entry points (D17) — `ProjectTree.vue` picks up its first
   `state/connections` import for the `caps.keyBrowser` check. At the end of this commit **both**
   navigations work: a Redis database still expands *and* opens a Browse tab.
4. **`feat(browse): row actions — open, upload, download and delete`** — D10's second half.
   `state/objectStore.ts` gains `uploadMenuItem` (moved verbatim from `project/menus.ts:295-308`,
   re-signatured); `project/menus.ts`'s `bucketMenu` calls the moved one; `views/browse/menu.ts` is
   new and carries the container-row menu (Refresh, Copy name, Upload file…) and the leaf-row menu
   (Open, Open in new tab, Copy name, Download…, Delete) — the bodies of `keyMenu`/`objectMenu`,
   moved, with `refresh(parent)` replaced by a local level reload; `BrowseView.vue` wires
   `openContextMenu`. `UploadObjectDialog.vue:7,60` switches from `project/state/tree`'s `refresh`
   to `browseInvalidate` (F22/D14).
5. **`feat(project): redis databases and s3 buckets stop expanding in the tree`** — D5/D7/D9/D10's
   first half. `redis/catalog.ts:31` and `s3/catalog.ts:34,51` flip to `hasChildren: false`, each
   with a one-line comment naming §8.18 the way `kafka/catalog.ts:36-38` names the definition view;
   `redis/catalog.ts:45-47`'s and `s3/index.ts:24-27`'s comments are corrected (both still describe
   an inline tree). `project/grouping.ts`'s `isLeafKind` + comment; `project/state/tree.ts`'s
   `ConnectionView` threading and `revealPath` truncation; `project/filterTree.ts`'s call site;
   `project/menus.ts` loses the four builders and their `menuForRow` cases. **Spec edits in this
   commit:** `tests/db/s3.spec.ts:171`; `tests/ui/redis.spec.ts:89-140`;
   `tests/ui/s3.spec.ts:151-201,281-283,310-312,358-361,390-393,432-458,468-495`;
   `tests/ui/memory.spec.ts:54-57,278-282` — every `expandRow(namespace|prefix|bucket|db)` becomes
   "open the Browse tab, descend, act". **This is the phase's largest behavior change.**
6. **`test(ui): the browse panel for redis keys and s3 objects`** — the *new* scenarios only (each
   earlier commit already carries its own edits): in `redis.spec.ts`, a Browse tab opened from the
   `db0` row descends `user` → `1`, filters, opens a key into a keyvalue tab, and Up returns to the
   container; in `s3.spec.ts`, the same over `reports/2024`, plus Upload from a prefix row and
   Delete from an object row inside the panel, plus the tree assertion that a bucket row has **no**
   twisty (`.twisty.invisible`) and that no `data-kind="prefix"` row exists anywhere.
7. **`docs: SPEC §5.1/§8.3/§8.4/§8.8/§8.10/§8.18/§10/§11 and ARCHITECTURE for P41`** — D20,
   including this plan file if it is not already committed.

---

## 5. Verification

**Say plainly what this box can and cannot do.** Per AGENTS.md: `bun run lint`, `bun run typecheck`
and `bun run build` all run here. Playwright runs here **only after** the Electron binary is
installed by hand with `curl` (AGENTS.md's "Electron binary" section), and it must be invoked
**directly** — `bun run test:ui` fires `pretest:ui` → `scripts/native-electron-build.sh`, which
cannot fetch Electron's C++ headers through this environment's proxy (AGENTS.md F20) and fails
before a single spec runs. The working invocation here is:

```
bun run build && xvfb-run -a bunx playwright test tests/ui/sqlite.spec.ts
```

Every Docker-backed spec self-skips, because image pulls return `403` through this environment's
proxy. Concretely for this phase:

| Spec | Runs in this sandbox? |
|---|---|
| `tests/ui/sqlite.spec.ts` | **Yes, for real, unconditionally.** It is the only spec that exercises the project tree with real data here, which is exactly why D4 puts the sticky-band geometry assertion in it. It does **not** cover Redis or S3. |
| `smoke`, `startup`, `workbench`, `connections`, `secrets` | Yes (no DB). `startup.spec.ts` is what exercises the new tab kind's restore path. |
| `tree.spec.ts`, `redis.spec.ts`, `s3.spec.ts`, `memory.spec.ts`, and every other engine spec | **No** — Postgres/Redis/LocalStack containers; they `test.skip()` cleanly rather than fail. |
| `tests/db/redis.spec.ts`, `tests/db/s3.spec.ts` | **No** — Testcontainers, same `403`. |

**Be blunt about the consequence: this phase's own Redis/S3 behavior cannot be verified here.**
The sticky-band fix *can* be (sqlite, for real). The tree cut, the Browse panel, and every spec
edit in commits 4–6 are verifiable in this sandbox only by `typecheck`/`lint`/`build` plus careful
reading. **The phase is not done until the full `test:ui` suite and `bun test tests/db` have been
run green on a box that can run them** (the macOS/Colima machine or CI) — before the phase is
called finished, not step by step.

| Step | What must be re-run green | What it pins |
|---|---|---|
| 1 | `typecheck` + `sqlite.spec.ts` **here, for real**; `tree.spec.ts`, `workbench.spec.ts`, `console.spec.ts`, `data-view.spec.ts`, `budgets.spec.ts` elsewhere | The band pins to the scrollport's top edge and no longer duplicates rows at the bottom — and the *other* three `VirtualList` callers (operations panel, both console result-grid branches, the document view's `rowHeights` path) are untouched by the slot move, which is what proves D1 is a placement fix and not a behavior change. `budgets.spec.ts`'s scroll-response budget is the guard that the move costs nothing per frame. |
| 2 | `typecheck` (all four) + `tests/db/redis.spec.ts`, `tests/db/s3.spec.ts` | Eleven caps literals still satisfy `Caps`, and `capsSchema` still parses what the engine sends on connect (any missed literal is a compile error, not a runtime one). |
| 3 | `startup.spec.ts` **here**; `redis.spec.ts`, `s3.spec.ts` elsewhere | A Browse tab opens, lists a level, descends and restores; a tab row of the new kind survives `RENDERABLE_TAB_KINDS` on restore (`storage/repos/tabs.ts:42-49` drops what it does not recognise — this is the assertion that the vocabulary was updated in all three places). |
| 4 | `s3.spec.ts` (its upload/download/delete tests) | Upload from a Browse prefix row still lands, still opens the object's tab, and the panel refreshes — the `browseInvalidate` path replacing `project/state/tree.ts`'s `refresh` (F22). |
| 5 | `redis.spec.ts`, `s3.spec.ts`, `memory.spec.ts`, `tree.spec.ts`, `tests/db/redis.spec.ts`, `tests/db/s3.spec.ts`, `leaks.spec.ts` | **The sharpest step in the phase.** No Redis/S3 tree row deeper than the container; every rewritten spec passes; `tree.spec.ts` (Postgres) is *unchanged* by the `isLeafKind` signature change, which is what proves the default argument kept every other engine's tree identical; `leaks.spec.ts`'s `__kiraTreeConnectionIds` still empties on connection delete. |
| 6 | the two edited specs | The new coverage itself. |
| 7 | read against the tree | §8.18 describes the panel that exists; §5.1's two cells describe the tree that exists. |

**Manual click-through afterwards (a human or an agent on a box with a real Redis and a real S3 or
LocalStack)** — headless coverage cannot see pinning, and half this phase is layout:

1. Expand a Postgres connection with a tall schema and scroll: the connection/database/schema
   headers pin **at the top**, slide out cleanly at each boundary, and there is **nothing** stuck at
   the bottom of the list. Scroll to the very end: the last real row is the last thing visible — no
   duplicated ancestor rows below it, and `scrollHeight` no longer has three phantom rows on it.
2. Click a pinned row's twisty and its label: it still selects, toggles and right-clicks (P28 D7's
   "a pinned row is a real row").
3. Shrink the window until the panel is only a few rows tall: the band clamps
   (`ProjectTree.vue:57-59`) instead of eating the list.
4. Expand a Redis connection: databases, each with its `"N keys"` detail and **no twisty**.
   Double-click one → a Browse tab. Descend two namespace levels, filter, open a key → the same
   keyvalue tab as before. Up, Up, back at the container.
5. The same for an S3 bucket, including Upload file… from a nested prefix row and Delete from an
   object row — both inside the panel now.
6. Right-click a Redis database and an S3 bucket: **Browse keys** / **Browse objects** first, then
   the container menu that was already there (and Upload file… on the bucket).
7. Open a keyvalue tab for a deep key, then tab-menu → **Reveal in project panel**: the *container*
   row is selected and scrolled into view (D9), not a silent no-op.
8. Open the Filters… dialog on a Redis connection: the Objects section lists databases only, and the
   Object types section lists only the kinds still in the tree (F24) — expected, not a bug.
9. Open two Browse tabs on two different buckets: independent levels, independent filters. Close
   both, reopen the app: they restore at their own levels behind Reconnect & load.

---

## 6. Explicitly out of scope

- **Paging, "load more", or any truncation reporting for a browsed level** (D15/F8). The Redis
  200-round SCAN cap and the S3 20-round list cap keep their current silent behavior. Doing it
  honestly means widening `Adapter.children()`, which `adapter.ts:138-141` gates behind amending
  P1's plan §4b first. §8.
- **Server-side key search** (`SCAN MATCH`, `ListObjectsV2 Prefix`) from the Browse panel or the
  tree (D18). The panel filters the level it has loaded and says how much that is.
- **A local (prefix-stripped) label for a leaf row** (D13) — it needs an engine-specific separator
  in the renderer or a new `TreeNode` field.
- **Turning a level listing into a cancellable engine op with an op-log row and a `RunState`**
  (D16). `kira:tree:children` has never been one, for the tree either.
- **Moving Kafka partitions, Mongo collections or any other engine's levels** out of the tree.
  `caps.keyBrowser` is false for all nine others and nothing about their trees changes.
- **A "Reveal in Browse panel" tab menu item** — D9 truncates the existing "Reveal in project
  panel" instead; opening a Browse tab at a revealed item's own level is a different feature. §8.
- **Bucket lifecycle (create/delete/rename), recursive prefix delete, or Redis namespace-level
  operations** — P33 §6 already declined these and nothing here changes that.
- **Any change to `stickyBand.ts`** (F3) — the geometry module is correct.
- **Any change to `views/shared/page/`'s seven modules**, to the other four `VirtualList` callers,
  or to `project/TreeRow.vue`.
- **A fourth workbench panel, a layout schema field, or a status-bar toggle** (D11/F15).
- **`docs/v1/design/kira-design-system/`**, `biome.json`, `src/main/storage/migrations/`,
  `src/preload/`, `src/shared/protocol/`, and `package.json` dependencies.

---

## 7. Acceptance checklist

- [ ] `grep -n "virtual-list-sticky" src/renderer/theme/primitives/VirtualList.vue` shows the block
      **before** `.virtual-list-header` and the top spacer, and the file's comment states why
      flow position 0 is what makes `top: 0` engage.
- [ ] With a tall tree scrolled, the first `tree-sticky-row`'s `boundingBox().y` equals the
      `.virtual-list` scrollport's `boundingBox().y` within 1px; scrolled to `scrollHeight`, **no**
      `tree-sticky-row` has a box below the scrollport's bottom edge. Asserted in both
      `tree.spec.ts` and `sqlite.spec.ts`.
- [ ] `stickyBand.ts` appears in `git diff` for this phase **only** if a comment changed.
- [ ] A Redis `database` row and an S3 `bucket` row render `.twisty.invisible` — no expander — and
      `[data-testid="tree-row"][data-kind="namespace"]`, `="prefix"`, `="key"` and `="object"` all
      have count 0 anywhere in the project panel, for any connection, at any time.
- [ ] A Postgres/MySQL/SQLite/ClickHouse/Mongo/RabbitMQ `database` row is **unchanged** — twisty,
      children, sticky pinning, filters — which `tree.spec.ts` passing unedited is the proof of.
- [ ] `keyBrowser` exists on `Caps`, `capsSchema` and all eleven `caps.ts` literals; it is `true`
      in exactly `redis` and `s3`. `grep -rn "kind === 'redis'\|kind === 's3'" src/renderer` returns
      nothing new — the gate is the capability, never the engine name.
- [ ] Double-click, `Enter` and `menu-item-browse` on a Redis database / S3 bucket all open the same
      Browse tab; a second invocation reuses it and reloads it.
- [ ] The Browse tab descends and ascends without limit, its breadcrumb reflects the level, `Up` is
      disabled at the container, and `browse-count` reads `M of N` while `browse-filter` is set.
- [ ] A leaf row opens the **existing** `keyvalue` tab, at the same path the tree used to produce —
      `keyvalue-view[data-path=…]` is byte-identical to what `redis.spec.ts`/`s3.spec.ts` asserted
      before this phase.
- [ ] Upload from a Browse prefix row lands, opens the object's tab, and the panel's level refreshes;
      `grep -n "project/state/tree" src/renderer/workbench/UploadObjectDialog.vue` returns nothing.
- [ ] `project/menus.ts` no longer contains `namespaceMenu`, `prefixMenu`, `keyMenu`, `objectMenu`
      or `uploadMenuItem`, and `menuForRow`'s switch has no `namespace`/`prefix`/`key`/`object` case.
- [ ] "Reveal in project panel" on a Redis-key or S3-object tab selects and scrolls to the container
      row — never a silent no-op.
- [ ] Closing a Browse tab frees its runtime (`__kiraTreeConnectionIds` and `__kiraRetainedBytes`
      unchanged in shape; `leaks.spec.ts` green), and no page store gained a new member.
- [ ] `git diff` for this phase touches **no file** under `src/renderer/views/shared/page/`,
      `src/renderer/project/TreeRow.vue`, `src/preload/`, `src/shared/protocol/`,
      `src/main/storage/migrations/`, `biome.json` or `package.json`.
- [ ] **No `data-testid` was removed or renamed anywhere.** Diff the testid strings across the whole
      phase: the set only grows.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; `sqlite.spec.ts` green **in this sandbox**; full `test:ui` and
      `bun test tests/db` green on a box that can run them before the phase is called done.
- [ ] SPEC §5.1's Redis and S3 rows describe a two-level tree and name §8.18; §8.3 says the tree
      stops at the container for a `keyBrowser` engine; §8.10's three menu rows say "Browse panel";
      §8.18 exists; §10's P41 row records what was built; §11 lists `views/browse/`.

---

## 8. What is left, and who owns it

**Handed to P42 (functionality review — three iterations, allowed to change behavior):**

1. **A browsed level still truncates silently** (F8/D15). The Redis SCAN cap and the S3 list cap
   were invisible in a tree and are only slightly less invisible in a panel that shows one level at
   a time. The honest fix is a widened `children()` return — and `adapter.ts:138-141` says the way
   to do that is to amend P1's plan §4b first, which is a decision, not a refactor.
2. **The metadata cache now holds levels nothing renders.** Every level a Browse tab visits is
   written to `metadata_cache` in `kira.sqlite` by `main/tree-service.ts:59-80`, exactly as an
   expanded tree level was — but a Browse tab can visit far more of them, far faster. Whether that
   table needs a size budget or a per-connection cap is a real question this phase does not open.
3. **"Reveal in project panel" is now a container-level answer** (D9). If it turns out users want
   the item itself, the answer is a Browse tab opened at the item's level — a new menu item with a
   new meaning, not a tweak to `revealPath`.

**Handed to P43 (sparse unit tests):**

4. `stickyBand.ts` is the clearest unit-test candidate in the renderer — pure, total, and now
   provably invisible to DOM-level UI assertions (F4). The kept-prefix loop (`:99-116`) and the
   handoff math (`:65-67`) are cheaper to pin with a table of `(rows, scrollTop, rowHeight)` cases
   than with any Playwright scenario, and this phase leaves them covered only end-to-end.
5. `views/browse/state.ts`'s `ascend`/`descend` path arithmetic (clamped at the tab's own container,
   built on `pathParent`) is the same shape of pure function.

**Decided here, not deferred:**

6. **The panel is a tab, not a fourth sidebar** (D11) — the alternatives (a workbench panel, a pane
   under `project/`) were costed against F14/F15 and rejected on layering and singleton-ness, not on
   taste. Recorded so a later reader does not re-open it.
7. **One level at a time with a breadcrumb, not a second tree** (D12) — the tree shape was the
   scalability problem (F9); reproducing it inside a tab would have moved the problem, not fixed it.
8. **The cut is `hasChildren: false` from the adapter plus a renderer stale-cache guard, with
   `children()` untouched** (D5/D7/D8) — P23's shape, applied without modification, three phases
   after `kafka/index.ts:68-73` wrote down exactly when a level's enumeration should be deleted and
   when it should be kept.
9. **The sticky bug was never in `stickyBand.ts`** (F1/F3). Written down at the top of this plan and
   again here, because the request named that file and the next reader will too.
