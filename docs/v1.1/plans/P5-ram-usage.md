# P5 — RAM usage

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P5 row): *"Audit where the app's own
> RAM usage can be reduced, and fix what is found. The frontend (the Vue/WebView side) is the main
> place to look for improvement, not the Go backend."* Why: *"`docs/PERF.md` records a real,
> measured memory story but the app has never had a dedicated sweep asking specifically 'where is
> RAM used that doesn't need to be' the way P13 did for v1's own nonfunctional debt."*
>
> **The headline, in one line: the renderer has no memory budget of any kind, and the three page
> views that never learned to prune are where that shows up — a 5 000-document Mongo tab costs
> 15.6 MB of JS heap for 2.0 MB of data (7.6x), measured in the real built bundle.**
>
> **The single largest finding is `DocumentView.vue`'s `rows` computed (`:284-295`), which
> materialises the *entire* page.** It loops `0..rowCount`, and for every row calls `documentRow()`
> (decoding the id and body into permanently-cached UTF-16 strings) and `rowView()` (parsing the
> whole EJSON body into a `DocNode` tree, permanently cached in `views/shared/document/rows.ts`'s
> `parseCache`). `rowHeights` (`:358-371`) then maps over all of them again. The list underneath is
> a `VirtualList` rendering about thirty rows. Measured in-app (Chromium/V8, CDP heap, real bundle,
> `tests/ui` mock tier): **+1.64 MB for 100 documents, +4.23 MB for 1 000, +15.56 MB for 5 000** —
> against page byte sizes of 41 KB, 416 KB and 2.09 MB respectively. The same page opened in a
> *tabular* view costs 0.7x its own bytes, because the grid prunes and the document view does not.
>
> **The second finding is structural and explains the first: `views/shared/page/store.ts`'s
> visible-window pruning is wired up in exactly two of the five views that use it.** The file's own
> header comment says so (`:3-7`), and `grep setVisibleWindow` confirms it: `views/grid/page.ts` and
> `views/console/resultPages.ts` export and call it; `views/documents/page.ts`,
> `views/keyvalue/page.ts` and `views/stream/page.ts` do not export it at all. Every row those three
> views ever render leaves a decoded string and a memoised row object behind for the tab's lifetime.
> Measured cost of that cache alone (Bun/JSC bench, 24-char cells): **~205 B/cell at 12 subkeys,
> ~577 B/cell at 2** — 11.0 MB for a 10 000-row key/value page, 23.5 MB for a 10 000x12 grid page.
> Two of the three views already compute the exact window they would need to pass; the third
> (`StreamView.vue`) does not emit `visible-range` at all.
>
> **The third is that a find has no bound.** `runChunkedScan` (`scan.ts:65-120`) accumulates every
> match into one unbounded array; `createMatchIndex` (`search.ts:106-131`) then builds a parallel
> `Map<number, Set<C>>` over the whole thing. Measured at **~101 bytes retained per match** across
> both structures: a one-character find over a 10 000 x 40 page is **~38.8 MB**, and a common
> substring reaching a million matches is **~96 MB** — held in `searchState[tabId]` until the find
> is cleared or the tab closes.
>
> **And one that is pure waste: `packages/shared` constructs 135 zod schemas at module scope, and
> the renderer calls `safeParse` on exactly two of them.** `connectionInputSchema` (ConnectionDialog)
> and `nodeKindSchema` (`domain/tree.ts`'s `decodePath`/`pathTail`). Everything else is `z.infer`
> types — but `z.object(...)` is a call expression, so Rollup cannot prove it pure and keeps the
> lot. Measured by A/B build: zod is **70 103 bytes, 6.7% of the 1 049 840-byte production chunk**,
> which is a single un-split chunk with no code splitting at all.
>
> **What is *not* broken, and should not be re-litigated:** tab-close symmetry (P13 F4/F5, still
> exact — `leaks.spec.ts` proves it), the console's own 50-result cap and `releaseResult` path
> (P2 R1), the grid's `renderRows`/`WeakMap` memoisation (P29 D5, P2 R1), every `document`/`window`
> listener in the tree (all paired with a removal), and `opsState`'s 500-record ring. This tree has
> been through several review rounds and has no listener leaks; what it has is **retention that was
> designed for one view and never generalised to the other four**.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `de3b794` (`docs(v1.1): restore P11 FlatBuffers row, renumber code review to P12`),
branch `claude/feature-v1-1-p5-onwards-2isfzt`. P1-P4 and P11 have landed; P11 replaced the
JSON+base64 data plane with zero-copy FlatBuffers frames, which changes the *shape* of what the
renderer retains and is why P11's own OQ-1 named P5 as the owner of the follow-up.

`docs/PERF.md` is the standing record and this phase adds to it rather than rewriting it. Three of
its statements matter here and all three survive:

- **§2.2's 350 MB total-RSS budget is not this phase's target.** That budget failed on
  Chromium/Electron process overhead present with zero connections open, `tests/e2e/memory.spec.ts`
  was removed, and §2.4 then measured the shipped WKWebView build at **261.7 MB** total for the
  whole 5-process set. Total RSS is dominated by the webview framework, not by app allocations.
  This phase measures **the renderer's own JS heap and its retained structures**, which is the part
  the app actually controls, and which §2.2's own lever L-B put at 18-43 MB across ten tabs.
- **§4 item 2 (lever L-B, "renderer page retention for cold tabs") was answered *no*, twice, on
  purpose** — evicting an inactive tab's page trades the ≤ 50 ms cached-tab-switch budget for
  single-digit megabytes. **Nothing in this plan reopens that.** Every fix below is about memory a
  tab holds that *nothing* is reading, not about pages a cold tab might still need.
- **The L2/L3 caches are Go-side, byte-budgeted, and already tested** (`internal/enginecache`,
  `lru_test.go`). Not touched.

### 0.2 Scope

1. Build a **deterministic renderer-retention probe** (§5 C1) — the P5 analogue of
   `cmd/g1measure`, in the shape this repo already uses (`window.__kiraRetainedBytes`), because RSS
   sampling was already found unusable here (§2.2) and `tests/ui` runs WebKit, which has no
   `performance.memory`.
2. Fix the five renderer findings in §2 that have a measured cost and a contained fix.
3. Answer P4 OQ-3 (`adapterhost.Session`'s queue bounds) and P4 OQ-5 (control-plane bulk payloads)
   with a measurement and a stated verdict, since P4 handed both to this phase by name.
4. Answer P11 OQ-1 (one FlatBuffers frame retains every page it carried) with a measurement and,
   if it is real, a contained fix.
5. Record everything in `docs/PERF.md` §2.9 and repoint `docs/ARCHITECTURE.md` where a fix changes
   a fact that file states.

### 0.3 Not in this phase

- **Total-RSS budgets, the process model, or anything §2.2 already closed as non-app-controllable.**
- **Evicting a cold tab's page** (§0.1, L-B/D21 — declined twice, still declined).
- **Any Go-side cache tuning.** `internal/enginecache` is not edited (P11 D9 stands).
- **Vue Vapor mode.** That is P6, and it changes the rendering model; nothing here anticipates it.
- **The `internal/metrics` readout itself.** That is P7 — this phase must not "fix" the status-bar
  figure on the way past, even where its numbers look wrong.
- **Any wire-format change.** Requests stay JSON, responses stay FlatBuffers (P11 D3/D5). C7's
  buffer-copy fix is a *decode-side* change; not one byte on the wire moves.
- **`.github/workflows/*.yml`** — same `workflow`-scope constraint P1 D10, P3 D15, P4 §0.3 and P11
  record, and `AGENTS.md`'s one Known-open-item.
- **Editing P4's or P11's plan docs.** `docs/v1.1/README.md`: plans are never retro-edited.
  `docs/ARCHITECTURE.md` and `docs/PERF.md` are what get repointed.

### 0.4 Ground rules

- **Every decision in §4 cites a finding; every finding cites a file and line read here, or a
  number measured here.** No generic advice.
- **Nothing lands without a before/after from C1's probe**, or a stated reason the probe cannot see
  it (bundle size is the one such case; it has its own `du`/build-output measurement).
- `AGENTS.md`'s standing rules: no stubs, no `TODO`, no half-implemented scope. Comments only where
  the code cannot say it itself. **Unit tests only for genuinely complex logic** — of everything
  below, exactly one change clears that bar (C4's cap interacting with the priority-window pass),
  and it is named explicitly.
- **A fix that trades an interaction budget for memory is not a fix.** `tests/ui/budgets.spec.ts`
  and `tests/ui/perf.spec.ts` gate every commit (§6).

---

## 1. The instrument, and the baseline it produced

### F1 — What could and could not be measured in this environment

**Could not:** a real RSS number for the shipped app. No macOS hardware; `docs/PERF.md` §2.3
already established that this sandbox's WebKitGTK is a structurally different webview from
WKWebView and that its numbers are not a stand-in. §3's packaged-RSS procedure stays unrun.

**Could not:** `tests/ui`'s own WebKit tier as a heap instrument. WebKit exposes no
`performance.memory` and Playwright's WebKit has no CDP heap domain.

**Could:** the **real production bundle**, booted in **Chromium** against `tests/ui`'s own mock
tier (its fixtures are browser-agnostic — `fixtures.ts` takes `browser` from the project), with the
JS heap read over CDP: `HeapProfiler.enable` → `HeapProfiler.collectGarbage` twice →
`Runtime.getHeapUsage`. This is V8, not the JavaScriptCore the app ships on, and is stated as a
proxy throughout — the same framing `docs/PERF.md` §2.6/§2.7 already use for their Bun/JSC decode
numbers. It measures the app's own allocations against the app's own real code, which is the axis
this phase is about.

**Could:** bundle composition, exactly, from a sourcemap build (per-source generated-byte
attribution) and from A/B builds with a dependency aliased out.

**Could:** per-structure costs, isolated, under Bun/JSC and under node/V8.

The temporary harnesses used for all of the above were deleted; nothing measurement-only is
committed (the `docs/PERF.md` §2.5 convention). §5 C1 replaces them with a permanent, deterministic
probe that does not depend on any engine's heap API.

### F2 — The measured baseline (Chromium/V8, real built bundle, `tests/ui` mock tier)

| Scenario | JS heap (`Runtime.getHeapUsage`, after 2 forced GCs) | `__kiraRetainedBytes()` |
|---|---|---|
| Boot: one connection listed, nothing open | **5.25 MB** | 0 |
| + connect, expand two tree levels | 5.75 MB | 0 |
| + a 10 000 x 12 tabular console result | 8.26 MB (**+2.51 MB**) | 3.50 MB |
| + that grid scrolled end to end | 8.61 MB (**+0.35 MB**) | 3.50 MB |
| Mongo document tab, 100 docs (40 KB) | **+1.64 MB** (40.7x wire) | 41 KB |
| Mongo document tab, 1 000 docs (408 KB) | **+4.23 MB** (10.4x wire) | 416 KB |
| Mongo document tab, 5 000 docs (2.05 MB) | **+15.56 MB** (7.6x wire) | 2.09 MB |

Two things to read off this table:

1. **The tabular path is fine.** A 3.50 MB page costs 2.51 MB of extra heap to open and **0.35 MB**
   more to scroll from top to bottom — because `ConsoleResultGrid.vue` calls `setVisibleWindow` on
   every scroll (`:186`, `:194`) and the cache never accumulates. That number is the control this
   whole plan is measured against.
2. **The document path is not.** 7.6x the page's own bytes at 5 000 documents, before the user has
   scrolled at all, and `__kiraRetainedBytes()` reports **none of it** — it sums `page.byteSize`
   only (`store.ts:101-105`), which is the wire buffers, not the derived structures. The app's own
   retention accounting is blind to the largest thing the renderer retains.

### F3 — The production bundle, measured

`bun run build` (Vite 7.3.6), `apps/kira-studio/frontend/dist`:

| Asset | Bytes | gzip |
|---|---|---|
| `index-*.js` — **one chunk, no code splitting** | 1 049 840 | 333 240 |
| `index-*.css` | 117 120 | 21 450 |
| 8 x `*.woff2` (JetBrains Mono x4, DejaVu Sans Mono x4) | 885 974 | — |
| `codicon-*.ttf` | 149 510 | — |

Composition of the JS chunk, by sourcemap attribution (1 048 620 of 1 049 840 bytes mapped):

| Group | Bytes | Share |
|---|---|---|
| **CodeMirror + Lezer** (`view` 180 396, `state` 46 689, `autocomplete` 30 846, `language` 23 943, `commands` 23 171, `lang-sql` 22 473, `lint` 11 709, `lang-xml` 5 977; `@lezer/lr` 26 109, `common` 20 415, `xml` 8 544, `highlight` 7 197) | **407 469** | **38.9%** |
| app `src/views/**` | 240 688 | 23.0% |
| **`zod`** | **72 521** | **6.9%** |
| Vue runtime (`runtime-core` + `reactivity` + `runtime-dom` + `shared`) | 70 419 | 6.7% |
| `packages/shared` | 52 517 | 5.0% |
| app `src/project/**` | 45 319 | 4.3% |
| app `src/workbench/**` | 34 719 | 3.3% |
| app `src/theme/**` | 27 615 | 2.6% |
| `@tanstack/virtual-core` | 22 499 | 2.1% |
| `simple-icons` (8 marks, tree-shaken from a package of thousands) | 17 065 | 1.6% |

`vite.config.ts` sets no `manualChunks` and the app uses no dynamic `import()`, so the entire
1.05 MB — CodeMirror included — is fetched, parsed and compiled before the first paint, on every
launch, whether or not the user ever opens an editor.

---

## 2. Findings

### F4 — `DocumentView.vue` materialises every row of the page, and caches the result forever

`apps/kira-studio/frontend/src/views/documents/DocumentView.vue:284-295`:

```ts
const rows = computed<DocumentRowEntry[]>(() => {
  void pageVersion.n;
  const indices = displayRows.value ?? Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
  const out: DocumentRowEntry[] = [];
  for (const i of indices) {
    const doc = documentRow(props.tab.id, i);
    const view = rowView(props.tab.id, i);
    ...
```

Three separate costs, all per *page* row rather than per *visible* row:

1. `documentRow` (`views/documents/page.ts:22-34`) decodes the row's id and body into JS strings
   and memoises both in the page store's `decodeCache`, plus the assembled object in `viewCache`.
2. `rowView` (`views/shared/document/rows.ts:115-129`) calls `parseRow` (`:95-113`), which runs
   `parseDocument(doc.body)` and stores the resulting `DocNode` tree in `parseCache`, keyed by row.
   `DocNode` (`ejson.ts:33-49`) is one object per field per document, each carrying `key`, `path`,
   `kind`, `text`, `token`, `bsonType`, `children` and `summary`.
3. `rowHeights` (`:358-371`) then maps over the same array again, and its `rowHeight`
   (`rows.ts:216-231`) calls `documentRow(tabId, row)` for **every** row purely to compare
   `doc.id === editingId` — a full id *and* body decode to answer "is this the row being edited",
   for a row that is almost always neither edited nor expanded.

Measured cost of (2) alone, in isolation (Bun/JSC, a representative 371-byte canonical-EJSON
document):

| Documents | Wire bytes | `parseDocument` trees | Ratio | Per doc |
|---|---|---|---|---|
| 100 | 36 460 | 703 KB | 19.7x | 7 201 B |
| 1 000 | 368 560 | 2 892 KB | 8.0x | 2 962 B |
| 5 000 | 1 856 120 | 26 379 KB | 14.6x | 5 402 B |
| 10 000 | 3 715 570 | **51 887 KB** | 14.3x | 5 313 B |

And end to end, in the real app (F2's table): **+15.56 MB for a 5 000-document page**, linear from
there — a 10 000-document page (a page size the UI offers, `views/shared/page/sizes.ts:12-17`) is
on the order of **30 MB of derived structures for 4 MB of data**, none of it visible, none of it
counted by `__kiraRetainedBytes()`.

`views/keyvalue/KeyValueView.vue:124` and `views/stream/StreamView.vue:110` do **not** have this
problem: both pass a plain `rowIndices` number array to `VirtualList` and resolve the row inside
the rendered slot. `DocumentView.vue` is the only one of the five that resolves eagerly, and it
does so because `rowHeights` needs a height for every row (`VirtualList.vue:59-66` builds prefix
sums over the whole array). That requirement is real; needing a *parse* to satisfy it is not — a
collapsed, unedited, unmatched row's height is the constant `HEAD_H` (`rows.ts:226`).

### F5 — Three of the five page stores never prune their decode caches

`views/shared/page/store.ts:3-7`, the file's own header:

> *"…visible-window pruning — while documents/keyvalue/stream never got either. Both are folded in
> here: the three views that never call `setVisibleWindow` simply never prune, which is today's
> behaviour for them unchanged."*

Confirmed by grep: `setVisibleWindow` is exported by `views/grid/page.ts:14` and
`views/console/resultPages.ts:27` and called from `DataGrid.vue:442` and
`ConsoleResultGrid.vue:186,194`. `views/documents/page.ts`, `views/keyvalue/page.ts` and
`views/stream/page.ts` do not export it, and nothing calls it for those scopes.

What accumulates, per row, once a row has been rendered even once:

| View | `decodeCache` subkeys per row | `viewCache` entries per row |
|---|---|---|
| documents | `id`, `body` | `row` |
| keyvalue | `field`, `value` | `row` |
| stream | `key`, `headers`, `attrs`, `timestamp`, `body` | `row` |

Measured overhead of the two-level `Map<number, Map<string, …>>` plus the memoised row object, over
the real `createPageStore`, 24-character cell text (Bun/JSC):

| Rows | Subkeys | Retained | Per cell |
|---|---|---|---|
| 10 000 | 2 (key/value) | **11.0 MB** | 577 B |
| 1 000 | 12 | 2.2 MB | 189 B |
| 10 000 | 12 | **23.5 MB** | 205 B |

The cache overhead is roughly **4x the cell's own text** at a 24-byte cell, and for the three
unpruned views it is monotonic for the tab's lifetime: scroll a 10 000-row Redis hash or Kafka
topic top to bottom and none of it comes back until the page is replaced or the tab closes. The
grid's own control number (F2, +0.35 MB across a full 10 000-row scroll) is what pruning buys.

Two of the three views already compute exactly the window `setVisibleWindow` wants and hand it to a
*different* consumer: `DocumentView.vue:302-308` and `KeyValueView.vue:543-548` resolve
`VirtualList`'s `visible-range` into page-row bounds for `setVisibleRows`
(`views/shared/page/visibleRows.ts` — search priority, deliberately a different concern, F31a).
`StreamView.vue` binds no `@visible-range` at all (`:860`), so it needs the handler added.

### F6 — A find's match set is unbounded, and is stored twice

`views/shared/page/scan.ts:65-120`. `const matches: M[] = []` (`:74`) grows for the whole scan with
no cap; `runChunkedScan` resolves it and `SearchToolbar` stores it in
`searchState[tabId] = { matches, index }` (`search.ts:26`, `:46`). The grid's `Match` is
`{ row, col, start, end }` (`views/grid/search.ts:12-17`) and `tabularRowScanner`
(`scan.ts:131-146`) emits one per match per cell across every column of every row.

`createMatchIndex` (`search.ts:106-131`) then builds a **second** structure over the same data — a
`Map<number, Set<C>>` — inside a `computed`, i.e. retained alongside the array, not instead of it.
(That is a deliberate P2 R1 improvement over the previous `Set<string>` of `${row}:${col}` keys; it
removed the string allocations, not the second copy.)

Measured (Bun/JSC), array + index together:

| Matches | Array | Match index | Total | Per match |
|---|---|---|---|---|
| 100 000 | 4.5 MB | 5.5 MB | **9.9 MB** | 104 B |
| 400 000 | 10.0 MB | 28.8 MB | **38.8 MB** | 102 B |
| 1 000 000 | 21.6 MB | 74.7 MB | **96.2 MB** | 101 B |

A 10 000 x 40 page is 400 000 cells. Typing a single common character into the find box — which
`SearchToolbar` runs incrementally as the user types — reaches the 400 000 row of that table. There
is no guard anywhere: not a match cap, not a "too many matches" message, not a minimum query
length. `docs/v1/SPEC.md` §8.5's own scope statement is that find searches the loaded page only;
nothing says it must materialise every hit.

### F7 — `packages/shared` builds 135 zod schemas at import; the renderer parses with two of them

`grep -o 'z\.object(' packages/shared` → **73**; the other combinators (`z.enum`, `z.union`,
`z.discriminatedUnion`, `z.array`, `z.record`) → **62**. All at module scope, in the 18 modules the
renderer imports.

Every runtime `safeParse`/`parse` reachable from the renderer:

- `project/ConnectionDialog.vue:199` and `:222` — `connectionInputSchema.safeParse(draft)`.
- `packages/shared/domain/tree.ts:48` (`decodePath`) and `:67` (`pathTail`) —
  `nodeKindSchema.safeParse(kind)`.

That is the complete list. Everything else in those 18 modules exists for `z.infer<>` — a
compile-time construct that costs nothing at runtime — but `z.object(...)` is a call expression, so
Rollup cannot treat it as side-effect-free and keeps all 135 initialisers plus the zod runtime they
need.

Measured:

- **Bundle:** an A/B build with `zod` aliased to a chainable no-op stub produces a **979 737**-byte
  chunk against the real **1 049 840** — zod is **70 103 bytes, 6.7%**. (The stubbed app does not
  boot, which is expected and is the point: two schemas are genuinely needed. The number is a
  bundle-size measurement, not a proposal to delete zod.)
- **Heap, in isolation:** importing the 18 modules bundled costs **6.86 MB** under node/V8, of
  which **3.13 MB** is zod's own library-plus-one-schema floor, leaving **~3.7 MB** for the 135
  schema graphs. Under Bun/JSC the same split is 0.79 MB + **2.79 MB**. **Both figures overstate
  the in-app share** — they are unminified bundles whose heap delta includes compiled code objects
  for ~500 KB of source, against an app whose measured *whole* boot heap is 5.25 MB (F2). The
  honest claim is: the schemas are a real, non-trivial share of a 5.25 MB boot heap, and the exact
  share must be measured properly (§6.3) before the fix is credited with a number.
- **Hot path:** `decodePath` costs **1 443 ns/call** (three segments, three `safeParse`s);
  `pathTail` **488 ns/call**. Both are called from render paths — `project/ProjectTree.vue`'s row
  building, `MainView.vue:37`'s per-entry icon choice, `DataGrid.vue:255`'s `qualifiedName()` — to
  answer a question that is membership in a fixed 18-element set of literals.

### F8 — One FlatBuffers frame retains every page it carried (P11 OQ-1, now with the mechanism)

`packages/shared/protocol/wire/chunk.ts:35-38` (generated):

```ts
dataArray():Uint8Array|null {
  const offset = this.bb!.__offset(this.bb_pos, 4);
  return offset ? new Uint8Array(this.bb!.bytes().buffer, ... ) : null;
}
```

`new Uint8Array(buffer, byteOffset, length)` is a **view over the whole received `ArrayBuffer`**,
and `frame.ts:31-40`'s `decodeChunk` stores those views straight into the `TextColumnChunk` the
page keeps. For `data:read` — one page per frame — that is strictly better than the pre-P11 decode
(one buffer instead of N fresh typed arrays), exactly as P11 D4/D5 intended.

For `data:execute`, which answers with `pages[]` (`frame.ts:308-319`), it means **holding any one
result page keeps every page of that run alive**. `views/console/state.ts` does the right thing at
the object level — `releaseResult` (`:126-131`) drops the page, the document parse cache and the
expanded-id entries, and `evictOldestResults` (`:144-149`) caps a tab at
`MAX_RESULTS_PER_TAB = 50` — but dropping 49 of 50 pages from one `Run all` frees no bytes at all
if the 50th still views that frame's buffer. `totalRetainedBytes()` reports them as freed, because
it sums `page.byteSize` (`store.ts:101-105`), which is per-page and unaffected. P11 OQ-1 predicted
exactly this and said "there is no *observed* leak"; the observation it was missing is that the
console's own release path is the thing the sharing defeats.

Related, and worth stating because it is the same accounting gap: **`MAX_RESULTS_PER_TAB` is a
count, not a byte budget.** Fifty results of a 10 000-row page each is ~175 MB of page bytes inside
a bound that reads as if it were protective. The Go side budgets L2 in bytes (64 MB, `> budget/2`
refusal rule); the renderer budgets nothing in bytes anywhere.

### F9 — A connection's cached tree metadata is never released except on deletion

`project/state/tree.ts:58-70` holds `treeState.children: Record<rowKey, TreeNode[]>` — every level
ever expanded, for every connection, for the process lifetime. `collapse` (`:168-170`) and
`collapseAll` (`:204-206`) touch only `treeState.expanded`; the nodes stay. `dropConnectionState`
(`:252-272`) is the only purge and it is wired solely to `onConnectionsChanged`
(`:302-307`) — i.e. to a connection being **deleted**.

**Disconnecting frees nothing.** That is a pure loss, because the same data is already durable
elsewhere: `docs/ARCHITECTURE.md`'s Caching section says L1 metadata is persisted in
`metadata_cache`, survives restart, and *"the whole connection's metadata is refreshed on every
reconnect."* So the renderer's copy of a disconnected connection's tree is neither authoritative
nor reused — reconnecting re-fetches it regardless. The `:141-146` comment defending the
skip-the-round-trip early return in `expand()` is about a *connected* connection and stays true.

This is also P4 OQ-5's subject arriving from the other side: OQ-5 asked what
`TreeService.Children`'s bulk payloads cost and named a schema with thousands of tables as the
unmeasured case. The renderer-side answer is that whatever they cost, they are retained per
expanded level per connection with no release path short of deleting the connection.

### F10 — `simple-icons`, the fonts, and `streamFilterHistory` — small, and named so they are not re-found

- **`simple-icons`: 17 065 bytes for 8 marks.** `theme/EngineIcon.vue:3-12` imports eight named
  exports from a package of thousands; tree-shaking works (the whole package is far larger), and
  ~2 KB per SVG path is what those marks cost. **No action.**
- **Fonts: 885 974 bytes across 8 faces**, all declared in `theme/fonts.css`, `font-display: swap`,
  so each is fetched only when first matched. The four DejaVu faces exist for glyph coverage
  JetBrains Mono lacks (that file's own comment), and the two DejaVu oblique faces are the fallback
  the browser resolves `font-style: italic` to when JetBrains Mono's italic is not selected. Real
  bytes, but demand-loaded and each one has a stated reason. **No action** beyond recording the
  figure.
- **`views/stream/streamFilterHistory.ts:30`** — `reactive(new Map<key, entry[]>())` keyed by
  `connectionId\0path`, entries capped at 20 per key (`:26`), but **the key set is never pruned**:
  no connection-delete purge, no tab-close cleanup. Bounded in practice (20 small objects per
  distinct topic/queue ever filtered) and genuinely session-only. **Recorded, not fixed** — fixing
  it means registering a `tabRuntime` cleanup for a keying that is deliberately *not* per-tab
  (`:31-32`), which is a correctness change dressed as a memory one.

---

## 3. Checked, and not fired

Stated explicitly so a later pass does not re-derive them. Each was read, not assumed.

| Checked | Verdict |
|---|---|
| **Event-listener leaks.** Every `document`/`window` `addEventListener` in `frontend/src` | **Clean.** All 21 are paired with a removal in `onUnmounted` (`ErrorPopover.vue:55-60`, `AppTooltip.vue:45-46`, `ContextMenu.vue:148-150`, `PopoverPanel.vue`, `DialogFrame.vue`, `AutocompleteField.vue`, `tooltip.ts:221-227`) or registered `{ once: true }` (`DataGrid.vue:1014`, `:1036`). `DataGrid.vue:353-361` also cancels its scroll rAF and its 300 ms save timer on unmount. |
| **Tab-close symmetry** | **Clean and asserted.** `state/tabs.ts:59-62` → `dropPageStoresForTab` + `cleanupTabRuntime`; `leaks.spec.ts:279-308` proves `__kiraRetainedBytes()` returns to its exact baseline after opening and closing 20 tabs. P13 F4/F5, still holding. |
| **Non-virtualised lists** | **None.** Every list is virtualised: the grid and console via `@tanstack/vue-virtual`, and documents/keyvalue/stream/browse/tree/ops via `theme/primitives/VirtualList.vue`. `perf.spec.ts`'s < 1500 DOM-cell bound guards the grid. |
| **Duplicated in-memory copies of a page** | **None found.** `DataGrid.vue`'s `renderRows` (`:1250-1320`) builds view models for the *visible* window only; `columns.ts` memoises `initialWidths` and the name→index map in `WeakMap`s keyed by the frozen page (`:54`, `:173`). |
| **Deep reactivity over bulk data** | **Already addressed.** `treeState.children` is `shallowReactive` (`tree.ts:59`, P2 R1), `searchState` is `shallowReactive` (`search.ts:46`, P2 R1), `rows.ts` is explicitly non-reactive with one `rowsVersion` counter (`:1-6`), pages are `Object.freeze`d (`store.ts:69`). |
| **Op-log growth** | **Bounded.** `state/ops.ts:5` `MAX_RECORDS = 500`, enforced at `:25`. |
| **Recent-tables list** | **Bounded.** `state/tabs.ts:81,94` — 20 entries. |
| **`port.ts`'s pending-request map** | **Clean.** Every path deletes its entry: success/error (`:63-73`), timeout (`:132`), open-failure (`:146`), close (`:39-45`). Data ops use `timeoutMs: null` deliberately (D25) and are ended by cancellation, which arrives as a normal error frame. |
| **Console result retention** | **Already fixed, in P2 R1.** `MAX_RESULTS_PER_TAB = 50` plus a single `releaseResult` path behind every removal (`console/state.ts:122-149`). The only gap left is F8's shared buffer, which is a decode-side issue, not a console one. |
| **Cell-editor state** | **Bounded.** One `SelectedCell` per tab (`state/cellSelection.ts:43`), value capped at `MAX_CELL_BYTES` server-side; `celleditor/state.ts:19`'s format overrides are one enum per column ever overridden. |
| **`assertPageStructure`** | **Cheap.** `packages/shared/protocol/page.ts` — length comparisons only, no zod, no per-cell walk. |

---

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **Build the deterministic retention probe first (C1), and make every later commit report a before/after through it.** It reports counts and bytes for the structures §2 names — page-store entries, decode/view-cache rows, document parse-cache rows and nodes, search matches, and distinct retained frame `ArrayBuffer`s — not an engine heap figure. | F1: `tests/ui` is WebKit and has no heap API, and `docs/PERF.md` §2.2 already retired RSS sampling here as unusable. The repo's own precedent is deterministic accounting (`__kiraRetainedBytes`), and F2 showed that hook is blind to the biggest thing the renderer retains. |
| **D2** | **`DocumentView.vue` resolves rows lazily.** `rows` becomes an index list; the rendered slot resolves `rowView` per visible row. `rowHeight` stops calling `documentRow` for the editing check and stops parsing a collapsed row. | F4: +15.56 MB for a 5 000-document page, none of it visible. `KeyValueView.vue:124` and `StreamView.vue:110` already do exactly this with `rowIndices`; this is bringing the fifth view in line, not inventing a pattern. |
| **D3** | **Wire `setVisibleWindow` into documents, keyvalue and stream.** Export it from all three page modules and call it from the same `visible-range` resolution that already feeds `setVisibleRows`; add the `@visible-range` binding `StreamView.vue` lacks. For documents, pruning also prunes `rows.ts`'s `parseCache` for the same window. | F5: 11.0-23.5 MB of unpruned cache at a 10 000-row page, against a measured +0.35 MB for the same scroll on a view that prunes. The window is already computed at both remaining call sites. |
| **D4** | **Bound a find's match set** at a named constant, with the toolbar saying plainly that the count is capped. The priority-window pass (`scan.ts:95-108`) counts against the same cap. | F6: ~101 B/match, 38.8 MB at 400 000 matches and 96.2 MB at a million, retained until cleared. A user cannot act on a million highlights; the first N plus an honest "more matches not shown" is the whole of what the feature delivers. |
| **D5** | **Annotate every module-scope schema initialiser in `packages/shared` `/*#__PURE__*/`** so Rollup drops the ones the renderer never references, and **replace `nodeKindSchema.safeParse` in `decodePath`/`pathTail` with a plain `Set` membership check** over the same literal list the schema is built from. Schemas stay exported and unchanged for the test tiers that do use them. | F7: 135 constructions, two of them ever parsed with; 70 103 bytes of bundle; 1 443 ns per `decodePath` on render paths. A pure annotation changes no semantics and no export, and the `Set` check answers the identical question the schema does. |
| **D6** | **Release a connection's cached tree state on *disconnect*, not only on delete** — reuse `dropConnectionState` unchanged, called from the disconnect path as well. | F9: the data is persisted in `metadata_cache` and re-fetched on every reconnect regardless (`docs/ARCHITECTURE.md`, Caching), so the renderer's copy for a disconnected connection can never be read again. `expand()`'s connected-case early return (`tree.ts:141-146`) is untouched. |
| **D7** | **Copy each page's chunk buffers into their own `ArrayBuffer`s in `decodePayload`'s `ExecuteResponse` branch, and only when `pagesLength() > 1`.** `ReadResponse` and single-page executes keep the zero-copy view. | F8: a multi-page frame defeats `console/state.ts`'s own `releaseResult`/`evictOldestResults`, and `totalRetainedBytes()` reports the bytes as freed when they are not. One `slice()` per chunk on console runs only; `data:read` — the hot path P11 was taken for, and the one every budget in `docs/PERF.md` §2.1 measures — is not touched. |
| **D8** | **Split the CodeMirror editor stack into its own async chunk**, behind `defineAsyncComponent` at `editor/CodeMirrorHost.vue`'s consumers — **only if C8's measurement shows a boot-heap win**; otherwise land nothing and record the number. | F3: 407 469 bytes, 38.9% of a single un-split chunk, parsed at boot whether or not an editor is ever mounted. But `AutocompleteField.vue` (the grid's filter box) and `OperationsPanel.vue` both mount it, so the deferral may end at the first tab open rather than at boot — which is a measurement, not a guess. This is the one step in the plan gated on its own measurement, and it is last for that reason. |
| **D9** | **Do not change `sessionQueueBytes`/`sessionQueueFrames` without a high-water measurement** (P4 OQ-3). Instrument `Session.queuedBytes`' peak under a worst case, record it, and change the constant only if the peak justifies it. | P4 D8 declined it for want of a measurement and handed it here. `session.go:28-45`'s 32 MiB budget sits in front of Wails' own 8 MiB one, so the difference is retained Go bytes — but `sessionMaxInFlightOps` and the renderer's own drain rate may mean the queue never holds more than a frame or two, in which case the constant is a ceiling nothing approaches and changing it buys nothing real. |
| **D10** | **Do not evict a cold tab's page, do not add a renderer-side byte budget with eviction, and do not touch `internal/enginecache`.** | §0.1: L-B/D21 was answered *no* twice on a stated interaction-budget trade, and nothing measured here changes that trade. Every fix above frees memory **nothing is reading**; a byte budget with eviction would free memory something is about to read, which is the thing that was declined. |
| **D11** | **Record the numbers in `docs/PERF.md` §2.9 and repoint `docs/ARCHITECTURE.md`'s Caching and UI-architecture sections** where D2/D3/D7 change a fact those files state. Do not rewrite §2.2 or §2.4. | `AGENTS.md`: app facts live in `docs/ARCHITECTURE.md`; `docs/PERF.md` is the living measurement record and §2.6/§2.7 are the standing precedent for a before/after section. §2.2/§2.4 measure a different thing (total RSS) and stay as they are. |

---

## 5. Implementation order

One Sonnet subagent, sequential. The order is deliberate: the instrument first, then the two
largest wins, then the rest, then docs. Each commit is independently green.

### C1 — `test(ui): a deterministic renderer-retention probe`

Extend `apps/kira-studio/frontend/src/main.ts`'s existing hook block (`:21-58`) with one new
Playwright-only global, alongside `__kiraRetainedBytes` (which stays exactly as it is — three specs
assert on it):

```ts
window.__kiraRetention = () => ({ /* per-store, per-structure counts and bytes */ });
```

It must report, without depending on any engine heap API:

- per page store: entry count, summed `page.byteSize`, `decodeCache` row count, summed decoded
  string length, `viewCache` row count;
- `views/shared/document/rows.ts`: `tabRows` scope count, `parseCache` row count, and total
  `DocNode` count across cached trees;
- each view's `searchState`: match count per tab;
- **distinct retained frame buffers**: the set of `chunk.data.buffer` identities across every held
  page, and their summed `byteLength` — this is the number F8 is about, and the one
  `totalRetainedBytes()` structurally cannot see.

The store needs a small read-only accessor to expose its internals (`store.ts`); keep it a plain
exported function, not a widening of `PageStore`'s public surface that view code could reach for.

Then extend `apps/kira-studio/tests/ui/leaks.spec.ts` with a new scenario asserting the probe
returns to its exact baseline after the existing open-20-tabs/close-all cycle — the same shape and
the same rigour as the `__kiraRetainedBytes` assertion at `:294-308`, over the structures that
assertion cannot see.

**Verify:** `bun run test:ui` green; the new assertion fails if either D2's or D3's change is
reverted (check this by hand during implementation — a probe that cannot fail is not a probe).

### C2 — `perf(documents): resolve a page's rows lazily instead of materialising all of them`

`views/documents/DocumentView.vue` and `views/shared/document/rows.ts`.

1. `rows` (`:284-295`) returns page-row indices, not `DocumentRowEntry` objects. The `v-for` slot
   resolves `rowView`/`documentRow` for the row it is actually rendering. Keep `body` reachable for
   Edit / context menu / cell-editor publish — those already run per selected row, not per row.
2. `rowHeight` (`rows.ts:216-231`): the editing check compares by **row index**, not by decoding
   the row's id — `editingId` is already resolved from a row the view knows. A collapsed, unedited,
   non-preview row returns `HEAD_H` with **no `documentRow` and no `parseRow` call at all**.
3. `rowHeights` (`:358-371`) therefore no longer decodes or parses anything for the common row.
4. `onVisibleRange` (`:302-308`) keeps working: it resolves positions through the same ascending
   index array.
5. `fieldNamesOnPage` (`documents/page.ts:47-59`) genuinely does walk every row — it is the
   projection picker's candidate list and there is no smaller correct answer. Leave it, but it must
   now be the *only* thing that parses a whole page, and it runs on menu open, not on load.

**Verify:** `apps/kira-studio/tests/ui/` document scenarios green (`data-view.spec.ts`,
`cell-editor.spec.ts`, `mutations.spec.ts`, `interaction.spec.ts`); `budgets.spec.ts` and
`perf.spec.ts` green; C1's probe shows `parseCache` row count bounded by the rendered window plus
`VirtualList`'s overscan (8, `VirtualList.vue:16`) rather than equal to `rowCount`.

### C3 — `perf(page): prune the decode cache in the document, key/value and stream views`

1. Export `setVisibleWindow` from `views/documents/page.ts`, `views/keyvalue/page.ts` and
   `views/stream/page.ts`, mirroring `views/grid/page.ts:14`.
2. Call it from the same handler that already resolves the window: `DocumentView.vue:302-308`,
   `KeyValueView.vue:543-548`. Add an `@visible-range` binding and handler to `StreamView.vue`'s
   `VirtualList` (`:860`), resolving `rowIndices` positions to page rows exactly as
   `KeyValueView.vue` does.
3. For documents, prune `rows.ts`'s `parseCache` (and `expandedPaths` for rows outside the window
   — but **only for rows with no expansion set**, so a user's expansion state is never silently
   discarded; a row the user expanded keeps its entry) to the same window. Add a `pruneRows(scope,
   start, end)` next to `resetRows`/`dropRows`.
4. Widen the window by the same overscan `VirtualList` renders with, so a fling never prunes a row
   that is about to be re-rendered — `store.ts:137-149` already no-ops when the window is unchanged.

**Verify:** all three views' `tests/ui` scenarios green; C1's probe shows `decodeCache`/`viewCache`
row counts bounded by the window after a full-page scroll in each of the three views; and — the
regression this step can plausibly cause — expanding a document, scrolling far away, and scrolling
back must show it still expanded (add this to the document scenario if it is not already covered).

### C4 — `perf(search): bound a find's match set`

`views/shared/page/scan.ts` and `views/shared/page/SearchToolbar.vue`.

1. `runChunkedScan` takes a cap (a module constant — pick a number that is generous for a human and
   bounded for a machine; **50 000** is ~5 MB by F6's own per-match figure and is two orders of
   magnitude past what anyone navigates) and stops appending once reached, while **continuing to
   count** so the toolbar can say how many exist.
2. The priority-window pass (`:95-108`) counts against the same cap; its own `priorityMatches`
   array is separate and must be capped too.
3. `onProgress`'s `found` becomes the true count; the toolbar renders `N of M (first K shown)`
   when capped. Prev/next and the filter toggle operate over the retained set.
4. `matchedRowsOf` and `createMatchIndex` need no change — they read whatever array they are given.

**This is the one change in the plan that earns a unit test** (`AGENTS.md`'s bar: "cursor/pagination
arithmetic with real boundary cases" — here, a cap interacting with a two-pass scanner whose second
pass rebuilds from row 0 and whose contract is that the final array is strictly ascending). One
`tests/unit/` spec over `runChunkedScan` covering: cap reached inside the priority window; cap
reached mid-main-pass with a priority window that already found matches; cap exactly equal to the
match count; and the ascending-order contract holding in each. Nothing else here gets a test.

**Verify:** `bun run test:unit`; the find scenarios in `data-view.spec.ts` / `console.spec.ts` /
`interaction.spec.ts` green; C1's probe shows the match count capped after a one-character find on
a large page.

### C5 — `perf(shared): let the renderer drop the schemas it never parses with`

1. Prefix every module-scope schema initialiser in `packages/shared/**` with `/*#__PURE__*/`. This
   is mechanical, changes no runtime behaviour, and leaves every export in place for
   `tests/unit/`, `tests/ipc/` and `tests/ui/support/` (all of which do use them).
2. `packages/shared/domain/tree.ts`: `decodePath` (`:41-53`) and `pathTail` (`:63-71`) resolve a
   node kind through a `Set<string>` built from the same literal list `nodeKindSchema` is built
   from — one source of truth, no second spelling of the kind list. The schema itself stays
   exported and unchanged.
3. Re-measure the built chunk. Report the delta in the commit message.

**Verify:** `bun run typecheck` (all three projects), `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`; `tree.spec.ts` in particular, since malformed-path handling is what
`decodePath`'s `safeParse` was doing. The bundle number from §6.2.

### C6 — `perf(tree): release a connection's cached tree state on disconnect`

`project/state/tree.ts`. `dropConnectionState` (`:252-272`) is already exactly the right operation;
call it from the disconnect path as well as the delete path. Find the disconnect signal the same
way `initTreeSync` (`:295-308`) finds the others — via `control`'s own subscription, not by reaching
into `state/connections.ts`'s local state (the `:249-251` comment records why that distinction
matters).

**Careful:** `treeState.visibility[connectionId]` is the user's checkbox filter set, re-fetched by
`loadVisibility` on the next `expand()` (`:127-130`) — dropping it is correct but costs one control
round trip on reconnect. `treeState.savedQueries` is already never memoised (`:76-77`). Neither is
a behaviour change a user can see; say so in the commit message rather than leaving it implied.

**Verify:** `tree.spec.ts`, `connections.spec.ts` and `leaks.spec.ts` green;
`window.__kiraTreeConnectionIds()` no longer contains a disconnected connection's id (this is the
existing hook, `main.ts:58` — the assertion `leaks.spec.ts:347` already makes for deletion,
now also for disconnect).

### C7 — `fix(protocol): stop one execute frame from pinning every page it carried`

`packages/shared/protocol/frame.ts`. In the `Payload.ExecuteResponse` branch (`:308-319`) only, and
only when `r.pagesLength() > 1`, copy each decoded chunk's four buffers into their own storage
(`.slice()`) so each page owns its bytes. `ReadResponse` (`:267-277`) is untouched.

Keep the copy in one small helper next to `decodeChunk` (`:31-40`) with a one-line comment naming
*why* — this is precisely the case `AGENTS.md` says a comment is for, because the code cannot say
"the alternative pins the whole frame."

**Verify:** `console.spec.ts` (multi-statement `Run all`) green; C1's probe shows the distinct
retained frame-buffer bytes falling to the surviving results' own bytes after
`closeOtherResults`, where before it stayed at the whole frame. Confirm the single-page `data:read`
path still reports **one** shared buffer per page, i.e. that the zero-copy property P11 was taken
for is intact.

### C8 — the two gated measurements, then `docs(perf): the P5 renderer-memory measurements`

Run, record, and only then decide:

1. **D8's bundle split.** Measure boot heap and first-editor-mount heap with and without
   `defineAsyncComponent` around `CodeMirrorHost.vue`'s consumers. If the boot-heap delta is real,
   land the split as its own commit *before* the docs commit; if `AutocompleteField.vue` /
   `OperationsPanel.vue` pull it in at first tab open anyway, land nothing and record that.
2. **D9's queue high-water** (P4 OQ-3). Instrument `Session.queuedBytes`' peak (temporarily —
   nothing measurement-only is committed) under the worst case available here: `tests/e2e-real`'s
   sqlite project reading the largest page size it can produce, repeatedly. Record the peak against
   `sessionQueueBytes`' 32 MiB and Wails' own 8 MiB, and state the verdict.

Then write `docs/PERF.md` **§2.9 — P5: the renderer's own memory**, in §2.6/§2.7's shape: method
(including the engine-proxy caveat, stated as plainly as §2.7 states its own), the F2 baseline
table, a before/after row per commit taken from C1's probe, the bundle numbers, and the two gated
verdicts. Re-measure on the finished tree; do not copy this plan's numbers.

### C9 — `docs: what the renderer retains, and what prunes it`

`docs/ARCHITECTURE.md` only, and only where a fact changed:

- **Caching section**: it describes three tiers, all Go-side. Add the renderer's own retention as
  what it is — five page stores, per-tab, released on tab close, with a visible-window decode cache
  that now prunes in all five (C3) — and say plainly that it has **no byte budget**, which is a
  deliberate consequence of §0.1's L-B decision, not an oversight.
- **UI architecture section**: `:569-571` names `views/shared/page/store.ts` as the one page-cache
  implementation behind all five page modules. After C3 that sentence becomes true of the pruning
  too; today it is true only of the code.
- Point at `docs/v1.1/plans/P5-ram-usage.md` for the measurements, the same way the Caching and
  Process-model sections already point at P4's and P11's plans.

---

## 6. Verification

### 6.1 After every commit

```
bun run lint
bun run typecheck
bun run test:unit
bun run test:ui
bun run test:ipc:fe
go build ./apps/kira-studio/internal/... && go test ./apps/kira-studio/internal/...
```

`bun run test:ui` needs a built bundle (its own script does `bun run build` first) and a WebKit
binary — `bunx playwright install webkit` plus the system libs its post-install warning names
(`libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav`), confirmed
installable here. Generating bindings first is mandatory and takes ~75 s: `apt-get update` then
`apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`, `go install
github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.15`, then `wails3 generate bindings -b -i -ts
-names` from `apps/kira-studio/`. Without `apt-get update` first the GTK install 404s.

**`tests/ui/budgets.spec.ts` and `tests/ui/perf.spec.ts` are the hard gate on every one of these
commits**, not just the ones that touch the grid: C2 and C3 change what happens on scroll, and D10's
whole premise is that memory is not being bought with latency.

### 6.2 Bundle measurement (C5, C8)

`cd apps/kira-studio/frontend && bun run build`, and read Vite's own asset table. Baseline to beat:
**1 049 840 B raw / 333 240 B gzip** for the single `index-*.js`. For composition, build once with
`sourcemap: true` into a scratch `outDir` and attribute generated bytes per source — that is how §F3's
table was produced, and it is the only way to tell a 6.9% dependency from a 6.9% guess.

### 6.3 The heap cross-check (C1, C2, C3, C8)

C1's probe is the gate. The Chromium heap figure is the **cross-check**, and it is worth taking
because F2 is the only measurement in this plan that exercises the real bundle end to end: a
temporary Playwright config with `browserName: 'chromium'` over `tests/ui`'s own fixtures, plus
`HeapProfiler.enable` → `collectGarbage` twice → `Runtime.getHeapUsage`. Delete the harness
afterwards. State the V8-vs-JSC caveat wherever the number is quoted, exactly as `docs/PERF.md`
§2.7 states its own Bun/JSC caveat.

### 6.4 The document-view proof (C2, C3)

The measurement that motivated this phase, re-run on the finished tree: a Mongo document tab at
100 / 1 000 / 5 000 documents, heap delta on open, against F2's 1.64 / 4.23 / 15.56 MB. This is the
number `docs/PERF.md` §2.9 leads with, and the one that says whether the phase worked.

### 6.5 What must not regress

- `leaks.spec.ts`'s existing `__kiraRetainedBytes` baseline equality after 20 open/close cycles.
- `perf.spec.ts`'s DOM-cell bound (< 1500) and rAF tripwire.
- `budgets.spec.ts`'s seven interaction budgets, in particular **cached tab switch** (p95 ≤ 50 ms,
  already tight at ~48 ms on this tier) — C3's pruning must not make a tab switch re-decode a page.
- The zero-copy property for `data:read` (C7): one shared buffer per page, not four copies.

---

## 7. Acceptance checklist

1. `docs/v1.1/plans/P5-ram-usage.md` exists and is unedited after the fact (`docs/v1.1/README.md`).
2. `window.__kiraRetention` exists, is asserted in `leaks.spec.ts`, and reports every structure §5 C1
   names — including distinct frame-buffer bytes.
3. `grep -n "rowView(props.tab.id" apps/kira-studio/frontend/src/views/documents/DocumentView.vue`
   no longer matches inside a loop over `rowCount`.
4. `grep -rn "setVisibleWindow" apps/kira-studio/frontend/src/views/*/page.ts
   apps/kira-studio/frontend/src/views/console/resultPages.ts` matches **five** files, not two.
5. `StreamView.vue` binds `@visible-range`.
6. `runChunkedScan` has a cap, the toolbar surfaces it, and `tests/unit/` covers the four boundary
   cases §5 C4 names.
7. `grep -c "/\*#__PURE__\*/" packages/shared -r` is at least 135; `nodeKindSchema.safeParse` no
   longer appears in `decodePath`/`pathTail`; the schema itself is still exported.
8. `dropConnectionState` is reachable from the disconnect path, and
   `__kiraTreeConnectionIds()` drops a disconnected connection's id.
9. `frame.ts`'s per-page copy is inside the `ExecuteResponse` branch, guarded by
   `pagesLength() > 1`, and `ReadResponse` is byte-for-byte unchanged.
10. `docs/PERF.md` has a `### 2.9` measured on the finished tree (not copied from here), including
    the two gated verdicts (D8, D9) whichever way they went.
11. `docs/ARCHITECTURE.md`'s Caching and UI-architecture sections match the tree, and neither
    `docs/PERF.md` §2.2 nor §2.4 was rewritten.
12. All of §6.1 green; `git status --porcelain` clean; no `.github/workflows/` file in the diff;
    `docs/v1.1/plans/P4-*.md` and `docs/v1.1/plans/P11-*.md` unchanged.

---

## 8. Open questions, handed forward

**OQ-1 — every heap number in this plan is V8 or JSC-via-Bun, and the app ships on WKWebView.**
F1. The *ratios* (7.6x for a document page, ~101 B per match, ~205 B per cached cell) are
structural and will carry; the absolute megabytes will not. The first session with real macOS
hardware should re-run §6.4's document-view measurement inside the packaged app and record it
alongside `docs/PERF.md` §3's still-unrun packaged-RSS procedure. **Owner: the first macOS run**
— the same one §3 has been waiting on since P52.

**OQ-2 — the renderer has no byte budget, and D10 says that is correct today.** Five page stores,
a 50-*count* console cap (F8), and no bytes anywhere — against a Go side that budgets L2 at 64 MB
with a `> budget/2` refusal rule. D10 declines to add one because every fix here frees memory
nothing is reading, and a budget with eviction would free memory something is about to read (the
L-B trade, declined twice). That reasoning stops holding the moment someone opens ten tabs of
10 000-row pages: 35 MB of page bytes with no ceiling and no user-visible number. The honest
follow-up is not eviction but **visibility** — surfacing the renderer's own retained bytes next to
the cache figure the status bar already shows. **Owner: P7 (CPU/memory status readout), which is
the phase already rewriting that readout.**

**OQ-3 — `views/stream/streamFilterHistory.ts`'s key set is never pruned** (F10). Bounded and
small, and fixing it means giving a deliberately connection+path-keyed store a tab-lifecycle
cleanup, which is a correctness decision rather than a memory one. **Owner: P12's review round
three, as a correctness item, or nobody.**

**OQ-4 — P4 OQ-5 is only half answered.** F9 answers the renderer side (tree metadata retained per
expanded level, released only on delete — now also on disconnect). The Go side OQ-5 actually asked
about — what `TreeService.Children` and `Describe`/`Definition` cost over Wails' chunked JSON
transport for a schema with thousands of tables, and what `internal/tree`'s cache-aside stores —
is still unmeasured, and it is a **control-plane** question that none of this phase's data-plane
instruments touch. Cheap to measure with `tests/e2e-real`'s postgres fixture. **Owner: a later
performance pass, or P12's performance-dimension reviewer.**

**OQ-5 — nothing here measures what a *long* session costs.** Every number in §1 is a
single-action delta on a fresh boot. The retention shapes §2 found are the ones that would compound
over hours of use, and after C2-C7 they should not — but nobody has run the app for an hour and
looked. A soak scenario (open, load, scroll, search, close, repeat, for a few hundred cycles, with
C1's probe sampled throughout) is the natural successor to this plan's own instrument and is the
one thing that would turn "no leak found by reading" into "no leak found by running". **Owner:
whoever next has real hardware and an hour.**
