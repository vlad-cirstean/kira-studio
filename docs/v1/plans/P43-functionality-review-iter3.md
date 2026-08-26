# P43 (iteration 3) — Functionality review: the deferred four, load ordering, and the tests this box can actually run

> **Iteration 3 of three — the last round of this phase.** AGENTS.md's multi-pass convention: Opus
> researches and writes a plan, Sonnet implements it, three times, each round written against the
> tree the previous round actually left behind. Iteration 1 is complete (`d78429a`…`ad3377c`,
> eleven commits, `docs/v1/plans/P43-functionality-review.md`). Iteration 2 is complete
> (`2881f95`…`78fc6d5`, twelve commits, `docs/v1/plans/P43-functionality-review-iter2.md`). This
> file is round three.
>
> **The phase, in the user's own words** (SPEC.md:1063): *"an in-depth review of the app's actual
> behavior (data handling, panel-to-panel communication, whether a state change is reflected
> everywhere it should be, error handling and how errors reach the user), frontend or
> engine/main, followed by real fixes"* and *"practically anything that could be a bug should be
> found and fixed no matter if it be FE or in between."*
>
> **This round pays four overdue debts and stops deferring them.** P42's own §8 handed forward two
> items — the document tree's unreadable scalar values (§8 item 1) and `ContextMenu.vue`'s missing
> keyboard navigation (§8 item 3) — and P43 iterations 1 *and* 2 both passed them along again. Both
> are fixed here (commits 7 and 8). The whole-row/whole-column selection's missing end caps, listed
> in iteration 2's §6 as *"cosmetic"* and in its §8 item 5 as *"recorded so it is decided rather
> than rediscovered"*, is decided here: it is a visible hole in a P42 affordance, it costs four
> lines, and `tests/ui/sqlite.spec.ts` can prove it in this sandbox (commit 9). The fourth debt is
> iteration 2's §8 item 1 (page-size honesty across the clamping adapters), which is **settled by a
> measurement rather than a fix**: `PagePosition.pageSize` is read by nothing in `src/` or
> `tests/` — the "requested or served?" question has no observable answer — and the one genuinely
> user-visible half of it is a page-size picker offering sizes a RabbitMQ poll can never serve
> (commit 10).
>
> **Three of iteration 2's twelve commits shipped with no executable verification anywhere.** Its
> §5 said so plainly and its §8 item 6 asked this round to check each one's *actual* dependencies
> rather than assume all three needed Docker. That was done, by writing the specs and **running
> them**, not by reading:
>
> - **`repos/metadata-cache.ts`'s `MAX_ROWS_PER_CONNECTION` (commit 5) is unit-testable here.**
>   `bun:sqlite` + `drizzle-orm/sqlite-proxy` reproduces `db.ts`'s own proxy in eleven lines, and
>   `putCached` is a plain function over a `KiraDb`. Written and run in this sandbox: 260 `putCached`
>   calls leave exactly **200 rows**, `p0` is gone, `p259` reads back. Also probed adversarially
>   for the one thing that could go wrong — a `fetched_at` tie evicting the row just written —
>   across 400 writes: **zero** losses, largest tie two rows.
> - **`state/runState.ts`'s `useRunState` (commit 4) is unit-testable here.** It needs a four-line
>   `globalThis.window` stub (`bridge/control.ts:33` reads `window.kira` at module scope) and one
>   line added to `tests/db/tsconfig.json`'s `include`. Written, typechecked (`tsgo -p
>   tests/db/tsconfig.json`, exit 0) and run in this sandbox: passes.
> - **`kafka/read.ts`'s EOF clamp (commit 3) is genuinely Docker-and-native-ABI-only.** The clamp is
>   three lines inside `readTopic`'s 120-line body between `consumer.assign()` and
>   `builder.finish()`; there is no seam to test it through without a live `KafkaConsumer`. It was
>   instead **re-read adversarially** (§1 F34) against the two ways it could lose messages, and it
>   is correct. It still needs one real run on a box with Docker.
>
> **Nine verified findings, five verified *non*-findings.** Every `file:line` below was opened and
> read at `78fc6d5`. The non-findings are written up in as much detail as the findings, because
> three of them are questions iteration 2 explicitly handed here and a silent absence would just
> get re-asked in P44.
>
> **Branch tip when this plan was written: `78fc6d5` on `feature/kickoff`;
> `git status --porcelain` over the repo is empty apart from this file.** Re-grep before editing.

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read in the tree at `78fc6d5`.** Not one line number below
  was copied from iteration 2's plan — every citation iteration 2 also made was re-opened and
  re-confirmed against the current file, because iteration 2's twelve commits moved several of
  them. Where a claim is about *absence* (nothing reads X, nothing clears Y) it was produced by a
  repo-wide grep over `src/` **and** `tests/`, and the grep and its actual output are pasted.
- **A fix, not a workaround.** This phase may change behavior, so a finding is answered by making
  the code do the right thing — not by hiding a symptom, greying out a control, or adding a comment
  describing the defect.
- **Every behavior change carries its own spec edit in the same commit.** This round is unusually
  well served: **five of its ten commits are executable in this sandbox for real** (three of them
  through the new Docker-free `bun test` route commits 1–3 establish, two through
  `tests/ui/sqlite.spec.ts`). §5 says exactly which, and is blunt about the other five.
- **P39's layering rules stand.** `biome.json`'s seven `overrides` are unchanged by this phase
  (`python3 -c "…json.load…"` over `biome.json` → `overrides: 7`; none of the seven restricts
  `tests/**`). Every import added below is `views/* → state/*`, `views/* → views/shared/*`,
  `views/shared/* → <renderer root>` (the edge `views/shared/document/rows.ts:7`'s
  `'../../../format'` already has), or engine/main-internal. No `views/ → workbench/`, no
  `views/ → views/<sibling>/`, no `project/ → views/`.
- **No new dependency, no new build step, no new npm script, no migration, no new IPC channel.**
  **One** new wire-schema field, called out loudly: `maxPageSize` on `Caps` (D46). It is
  `z.number().int().positive().optional()`, so nothing stored or in flight becomes unparseable, and
  exactly one adapter sets it. One build-config line changes: `tests/db/tsconfig.json`'s `include`
  gains `"../../src/renderer/env.d.ts"` (commit 2, D37) — a type-resolution fix, not a new project.
- **`data-testid`s are added, never removed or renamed.** New ones follow each surface's existing
  prefix convention (`grid-header-select`, `document-tree-line`'s existing one reused).
- Comments per AGENTS.md: only where the code cannot say it for itself. **Three existing comments
  are already false in the tree and are rewritten in the commits that touch their code**
  (`DocumentView.vue:763-767`'s claim that the row click publishes to the cell editor,
  `SearchToolbar.vue:96-102`'s claim about which transition D34's reset covers, and
  `redis/read.ts:86-88`'s "which is fine for a browse-only view" once F37 names what it is not fine
  for).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db — all four, via `bun run
  typecheck`) and `bunx electron-vite build` stay green after **every** commit. Conventional
  Commits, one per step of §4.

---

## 1. Findings

F-numbers continue from iteration 2, which ended at **F27**. Decisions continue from **D35**.

### A. The five things iteration 2 explicitly handed to this round

**F28 — the page-size-honesty question has no observable answer, because `PagePosition.pageSize` is
read by nothing.** Iteration 2's §8 item 1 asked this round to *"settle whether
`PagePosition.pageSize` means requested or served"* across the three adapters that answer it
differently. The question was traced to its consumers first, and it has none:

```
$ grep -rn "position\.pageSize" src/ tests/
(no output; exit 1)
```

`PagePosition.pageSize` is declared at `shared/protocol/page.ts:58` and validated at `:67`, and every
adapter writes it — but the four renderer state modules that consume a `PagePosition` read exactly
three fields from it and never this one (`views/grid/state.ts:132-141`,
`views/documents/state.ts:105-107`, `views/keyvalue/state.ts:97-99`,
`views/stream/state.ts:121-123` — `hasMore`, `nextToken`, `prevToken`, plus the grid's `strategy`).
The one other reader in the tree is `views/keyvalue/KeyValueView.vue:110`, and it reads
`position.strategy`. `engine/cache/pages.ts:24` writes `pageSize: req.pageSize` into the *cache
key*, which is `req`'s value, not the page's.

So the honest answer is not "requested" or "served" — it is **write-only**, and three adapters
disagreeing about a field nobody reads is a documentation problem, not a behavior one. Iteration 2
was right that `redis/read.ts`'s deleted `LIST_WINDOW` had to go (it *lost rows*), and right that
what remains does not. D47 records the field's actual status in its own declaration rather than
churning ten adapters to agree about something invisible.

**F29 — the one genuinely user-visible half: the stream page-size picker offers a RabbitMQ tab two
sizes a poll can never serve.** `views/shared/page/sizes.ts:8-13` returns the same four options for
every view, and `views/stream/StreamView.vue:509-514` renders all four for every stream engine:

```html
<SegmentedControl
  :model-value="tab.state.pageSize"
  :options="PAGE_SIZE_OPTIONS"
  data-testid="stream-page-size-picker"
  @update:model-value="onPageSize"
/>
```

`engine/adapters/rabbitmq/read.ts:88` then clamps:

```ts
  const count = Math.min(req.pageSize, MAX_POLL_MESSAGES);
```

with `MAX_POLL_MESSAGES = 500` (`:15`) and a real protocol reason its own comment states (`:12-14`:
every message in a `basic.get` batch is held unacked until the batch finishes). So picking **1k** or
**10k** on a RabbitMQ queue changes nothing at all: `onPageSize` persists the number, the next Poll
still fetches 500, and `:126`'s `position(req.pageSize)` reports the unclamped figure into the field
F28 just proved nobody reads. The user gets a control with two settings that do nothing.

It is not that the cap is hidden — `StreamView.vue:678-684`'s RabbitMQ-only strip says *"Each poll
fetches up to 500 messages through the management API"* in as many words. It is that the picker
beside it offers sizes that contradict it. This is the "dead guarantee" shape P40 F22 complained
about, applied to a control instead of a promise.

**Deliberately narrow:** SQS is *not* included. `sqs/read.ts:70-74`'s own comment records that
`pollQueue` loops `ReceiveMessageCommand` `ceil(pageSize/10)` times, so SQS genuinely honours every
size in the picker; only RabbitMQ's single-request `basic.get` has a hard ceiling.

**F30 — `DataGrid.vue`'s `matchIndex` is not a hot path, and iteration 2's own arithmetic overstated
it.** Handed here by iteration 2's §6 and §8 item 2, which asked for a decision *"on evidence rather
than re-deriving it."* Here is the evidence, and the answer is **do not fix it**.

`views/grid/DataGrid.vue:558-566`, unchanged since P42:

```ts
const matchIndex = computed(() => {
  const entry = searchState[props.tabId];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});
```

Three facts settle it:

1. **The rebuild is once per animation frame, not once per row.** `views/shared/page/scan.ts:19`'s
   `CHUNK_ROWS = 2000` and `:86`'s single `onProgress(...)` call per `step()` mean one publication
   per frame regardless of page size. A 200 000-row page is ~100 publications total, not 200 000.
2. **It is a `computed`, so it costs nothing on a frame nothing reads it.** `isSearchMatch`/
   `isCurrentSearchMatch` (`:568-580`) are the only readers, called from `rowVms` (`:1036-1037`),
   which only recomputes when the visible window or the page changes. A scan frame that renders no
   new rows re-runs the scan chunk and **not** the Set.
3. **It is never the dominant term.** The publication that triggers it —
   `SearchToolbar.vue:105`'s `props.api.searchState[props.tabId] = { matches: [...soFar], … }` —
   already copies the same array on the same frame. An O(M) copy and an O(M) Set build are the same
   order; removing one of them halves a constant on a path that also just scanned 2 000 rows across
   every column.

The only regime where any of this matters is M in the high hundreds of thousands, which needs a
query matching a large fraction of a fetch-more'd page. `tests/ui/budgets.spec.ts` already guards
the frame budget there. **Recorded as a non-finding so P44 does not re-open it a third time.**

**F31 — a scalar value inside an expanded document is clipped with no way to read the rest of it, in
both surfaces that render one.** Handed here by P42's own §8 item 1, restated by P43 iteration 1 and
again by iteration 2's §8 item 3, untouched three times. **Confirmed still true, and the blocker
iteration 2 named turns out not to be the one that matters.**

`views/shared/document/DocumentTree.vue:105-108`:

```css
.tree-value {
  overflow: hidden;
  text-overflow: ellipsis;
}
```

over a line that cannot wrap (`:72-79`, `.tree-line { height: var(--kira-h-xs); … white-space:
nowrap; }`), inside a body that clips in both hosts —
`views/documents/DocumentView.vue:1060-1068` (`.doc-body { … overflow: hidden; }`) and
`views/console/ConsoleResultGrid.vue:640-646` (`.doc-body-tree { … overflow: hidden; }`). So a
10 KB string field renders as `"Lorem ipsum dolor sit a…"` and there is no gesture — no scroll, no
wrap, no tooltip, no copy — that reveals the rest.

**What the user has instead, and why it isn't enough.** `views/documents/menu.ts:40-56` offers
*Copy document* and *Copy _id* on the row's context menu; there is nothing at the level of one
field. The console's own row click publishes the **whole document body** into the cell editor
(`ConsoleResultGrid.vue:251-269`) — so a console user can at least read the raw EJSON of the whole
document in a CodeMirror panel — and the Mongo data tab does not even have that: it mounts no dock
at all (`state/cellSelection.ts:31-32` records the rule, *"`views/documents/` publishes nothing at
all … and mounts no dock"*).

**F31a — and the comment that says otherwise is false.** `views/documents/DocumentView.vue:763-767`
introduces the row's click target with:

> *"Publishes the whole document to the cell editor (see the `watch` above)."*

There is no such watch and no such publication. `onRowClick` (`:464-466`) calls `selectRow`, which
is `views/documents/state.ts:263-265`'s two-line highlight setter, whose *own* comment (`:259-262`)
says the opposite in as many words: *"this view has no cell editor dock to publish a selection
into."* A repo-wide grep confirms which of the two is right:

```
$ grep -rn "publishSelectedCell\|CellEditorDock" src/renderer/views/documents/
(no output; exit 1)
```

**The blocker iteration 2 named is real but avoidable.** `views/shared/document/rows.ts:207-222`'s
`rowHeight()` returns `HEAD_H + lines * LINE_H + BODY_PADDING_V` with no measurement, and
`VirtualList.vue`'s `offsets` (`:59-66`) is a prefix sum over exactly those numbers — so anything
that makes a line taller (wrapping) or steals vertical space (a horizontal scrollbar; `base.css:72-75`
gives every scroller a **12 px** classic one, not an overlay one) breaks the exact-height contract.
That rules out wrapping and rules out a scroller on `.doc-body`. It does **not** rule out a
horizontal scroller with no chrome at all, which is an idiom this codebase already uses twice
(`workbench/panels/TabStrip.vue:194-201` and `views/console/ConsoleView.vue:449-455`, both
`scrollbar-width: none` + a hidden `::-webkit-scrollbar`, both driven by
`renderer/wheelScroll.ts:10-14`'s `wheelToHorizontal`). D42 takes that route: zero height change,
zero new mechanism.

**F32 — `ContextMenu.vue` has no keyboard navigation, for any menu in the app, and after P42 D27 one
of its callers is a keyboard regression.** Handed here by P42's own §8 item 3 and iteration 2's §8
item 4, which declined it as *"an accessibility feature, not a bug in behavior."* That reading is
too generous now. `src/renderer/workbench/ContextMenu.vue:40-42` is the whole keyboard surface:

```ts
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu();
}
```

```
$ grep -n "ArrowDown\|ArrowUp\|ArrowRight\|ArrowLeft\|'Enter'\|tabindex\|\.focus()" src/renderer/workbench/ContextMenu.vue
(no output; exit 1)
```

Rows are plain `<div class="p-row row">` with `@click` and `@mouseenter` only (`:87-95`, `:115`,
`:125-131`); nothing carries a `tabindex`, nothing takes focus, and there is no active-row concept
at all.

**Why it is behavior and not only a11y.** `openContextMenu` has **eleven** call sites across nine
files (`grep -rn "openContextMenu" src/renderer` → `DataGrid.vue` ×4, `ProjectTree.vue` ×2,
`BrowseView.vue`, `KeyValueView.vue`, `StreamView.vue`, `DocumentView.vue`, `ConsoleView.vue`,
`ColumnsSection.vue`, `OperationsPanel.vue`, `TabStrip.vue`, `CellEditorView.vue`), and one of them
is not a context menu at all: `views/shared/celleditor/CellEditorView.vue:308`'s `openContextMenu(e,
rows)` is the **format picker**, a left-click dropdown of `1 + FORMAT_GROUPS` entries built at
`:285-307`. P42 D27 replaced a native `<select>` with it. A native `<select>` is arrow-navigable,
type-ahead-searchable and Enter-committable in every browser; the surface that replaced it is
mouse-only. That is a capability the app used to have and lost — a regression, not a missing
nicety.

The absence also has a second, current cost: `ContextMenu.vue` is where `state/contextMenu.ts:50-65`'s
`runMenuShortcut` sends P21's printed keyboard shortcuts, so the app already tells users these menus
are keyboard-adjacent while offering no way to *walk* one.

**F33 — a whole-row or whole-column selection draws no end caps, so its outline is open at both
ends.** Iteration 2 listed this in §6 and asked in §8 item 5 for it to be *"decided rather than
rediscovered."* Decided: it is a real visible hole in a P42 affordance and it is four lines.

`views/grid/DataGrid.vue:1029-1035` computes the four perimeter flags by probing the neighbour:

```ts
          selEdgeTop: selected && !isSelected(row - 1, c),
          selEdgeRight: selected && !isSelected(row, c + 1),
          selEdgeBottom: selected && !isSelected(row + 1, c),
          selEdgeLeft: selected && !isSelected(row, c - 1),
```

and `isSelected` (`:481-493`) answers a `row` selection **without looking at the column at all**:

```ts
  if (sel.kind === 'row') return sel.rows.includes(row);
  if (sel.kind === 'column') return sel.cols.includes(displayCol);
```

So for `{ kind: 'row', rows: [3] }` — what `onGutterClick` (`:807-828`) produces from a click on
`grid-gutter-cell` — `isSelected(3, -1)` and `isSelected(3, columnCount)` are both **true**, and the
first and last cells of the row draw no `sel-l` / `sel-r`. The mirror holds for
`{ kind: 'column', cols: [c] }` from `onHeaderSelectClick` (`:829-852`): `isSelected(-1, c)` and
`isSelected(rowCount, c)` are true, so the column's top and bottom cells draw no `sel-t` / `sel-b`.
The result is a selection whose border runs off both edges of the block it is supposed to enclose —
next to a `range` selection (`onSelectAll`, `:854-873`) that closes correctly, because a range's own
bounds check does look at both axes (`:485-489`).

`tests/ui/sqlite.spec.ts:166-190` already asserts the range case in detail (`sel-t`/`sel-l` on the
top-left, `sel-b`/`sel-r` on the bottom-right, none on the middle). The row/column cases were simply
never driven — the same "correct at one shape and only at one shape" gap iteration 1's F1a recorded
for the S3 upload prefix.

**F34 — of iteration 2's three unverified commits, two are testable in this sandbox today; Kafka's
is not, and its diff is correct on re-reading.** Iteration 2's §5 named commits 3, 4 and 5 as having
no executable assertion anywhere, and its §8 item 6 asked this round to check each one's actual
dependencies. Done, by writing and running, not by reading:

- **Commit 5, `repos/metadata-cache.ts` — testable, and correct.** `openDb()` (`main/storage/db.ts:49-68`)
  does hard-code `dbPath()`, which is what iteration 2's §5 said blocked this. But `putCached`
  (`repos/metadata-cache.ts:57-116`) does not take an `OpenedDb` — it takes a `KiraDb`, which is
  `ReturnType<typeof drizzle>` from `drizzle-orm/sqlite-proxy` (`db.ts:41`), and a `sqlite-proxy`
  instance can be built over **any** driver, `bun:sqlite` included, in the same fifteen lines
  `db.ts:71-85` already writes. The result runs here:

  ```
  $ bun test tests/db/<scratch>.spec.ts
  rows = 200
  p0 = null   p259 = [{"i":259}]
   1 pass  0 fail
  ```

  and the one thing that could actually be wrong with D20's eviction — the `ORDER BY fetched_at
  DESC` tie-breaking arbitrarily and evicting the row `putCached` just wrote — was probed
  adversarially across 400 consecutive writes with a read-back after each: **0 losses**, largest
  observed `fetched_at` tie **2 rows** (≈1.5 ms per write at ms timestamp resolution). D20 is
  correct; commit 1 makes that a permanent, runnable assertion instead of a paragraph.

- **Commit 4, `state/runState.ts` — testable.** `useRunState` (`:34-55`) is a `computed` over
  `opsState.records`, and `opsState` (`state/ops.ts:8-12`) is a plain `reactive()`. The only
  obstacle is `state/ops.ts:3`'s `import { control } from '../bridge/control'`, and
  `bridge/control.ts:33`'s `const kira = window.kira;` at module scope — which a four-line
  `globalThis.window` stub before a dynamic `import()` satisfies. Written, typechecked and run in
  this sandbox: `tsgo --noEmit -p tests/db/tsconfig.json` → exit 0 (after the one-line `include`
  addition D37 describes), `bun test` → 1 pass. This is the *"cheapest possible unit test in the
  whole app"* iteration 2's §8 item 8 handed to P44; it turns out to need nothing P44 has to build
  first.

- **Commit 3, `kafka/read.ts` — genuinely Docker-and-ABI-only, and correct.** The clamp is
  `read.ts:306-308`, three lines wedged between `consumer.assign()` (`:254`) and
  `builder.finish()` (`:312`) inside `readTopic`'s single 120-line body. There is no injectable
  seam: the loop's inputs are a live `KafkaConsumer`, a `partition.eof` event stream (`:231-233`)
  and `consumeBatch` (`:177-184`). Extracting one would be the refactor §0 forbids. It was instead
  re-read against the two ways a `w.next = w.end` clamp could lose messages, and **neither is
  reachable**:
  - *Messages discarded by the page-full break.* `:276`'s `if (collected >= req.pageSize) break;`
    would strand undelivered offsets below `w.end`. It cannot fire with anything left: `:268` asks
    `consumeBatch(consumer, req.pageSize - collected)` for **exactly** the remaining count, and
    `:280`'s out-of-window `continue` only makes `collected` grow *slower* than the batch — so
    `collected` reaches `req.pageSize` on the batch's last element, never before it.
  - *EOF raised while messages are still queued.* `enable.partition.eof` (`:224`) delivers
    `partition.eof` in queue order behind that partition's last message, so every message below the
    watermark has already reached `:281`'s `builder.push` and advanced `w.next` before the event
    fires.

  So D26 is right, and this commit still needs one run on a box with Docker *and* a matching-ABI
  native build. §8 hands that forward as the one thing this phase cannot close itself.

### B. Independently found this round

**F35 — `views/browse/state.ts`'s `load()` has no supersession guard, so a slow level's listing
paints over the level the user has already moved to.** Every other view's `load()` in this app mints
an `opId`, stores it on the runtime and re-checks it after the await —
`views/grid/state.ts:104-122`, `views/documents/state.ts:78-96`, `views/keyvalue/state.ts:70-88`,
`views/stream/state.ts:77-112`, all four with the same `if (rt.opId !== opId) return; // superseded`
line. Browse has none. `views/browse/state.ts:63-87`, in full:

```ts
export async function load(tabId: string, opts?: { refresh?: boolean }): Promise<void> {
  const tab = findBrowseTab(tabId);
  if (!tab?.connectionId) return;
  const level = currentLevel(tabId);
  if (level === null) return;
  const rt = ensureRuntime(tabId);
  rt.status = 'loading';
  rt.error = null;
  rt.actionError = null;
  try {
    const result = await control.treeChildren(tab.connectionId, level, opts?.refresh ?? false);
    rt.nodes = result.nodes;
    rt.truncated = result.truncated;
    rt.status = 'idle';
  } catch (err) {
    …
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}
```

`level` is captured before the await and then **never consulted again** — the result is written to
`rt.nodes` unconditionally, no matter which level the tab is showing by the time it lands.

**Four concurrent callers make this reachable, not theoretical.** `load` is reached from `setLevel`
(`:95-100`, itself reached from `descend` `:103-105`, `ascend` `:108-115` and `goToLevel`
`:118-120`), from `reload` (`:89-91`, the ↻ button and `registerTabReload('browse', reload)`
at `:144`), and from `invalidateLevel` (`:135-142`) — which is fired **in the background** by
`state/viewCommands.ts:80-82`'s `browseInvalidate`, called by `views/keyvalue/mutations.ts:59` and
`:88` after every Redis key delete/add and by `state/objectStore.ts` after an S3 upload. None of
those are gated on any other being in flight.

And the levels this panel renders are exactly the slow ones. `redis/catalog.ts`'s
`listNamespaceChildren` runs up to `MAX_SCAN_ROUNDS = 200` SCAN round trips and `s3/catalog.ts`'s
`listPrefixChildren` up to `MAX_LIST_ROUNDS = 20` `ListObjectsV2` calls (both cited by iteration 2's
F16 and both re-confirmed present at `redis/catalog.ts:11` and `s3/catalog.ts:15`). A deep prefix
takes seconds; pressing ⬆ during one is the ordinary thing a user does. What lands is:

| t | event | tab's `levelPath` | `rt.nodes` |
|---|---|---|---|
| 0 | descend into a 200-round namespace | `…/prefix:big` | (previous) |
| 1 | user presses ⬆ (fast — the parent is cached) | `…/` | parent's nodes ✓ |
| 2 | the t=0 call finally resolves | `…/` | **`prefix:big`'s nodes** ✗ |

The breadcrumb, the Up button and the row menus all read `currentLevel`/`tab.state.levelPath`, so at
t=2 the panel says one level and lists another — and `descend` on any row then builds a child path
under the *wrong* parent. `rt.truncated` (`:75`) and `rt.status`/`rt.error` (`:76`, `:84-85`) drift
the same way: a stale failure can redden a level that loaded fine a moment ago.

**F35a — `rt.truncated` is also never cleared when a load starts.** `:69-71` resets `status`, `error`
and `actionError` and leaves `truncated` alone, so `BrowseView.vue`'s `browse-truncated` strip
(iteration 2's D23) stays up across a navigation into a complete level until that level's own result
lands, and stays up **permanently** if the next load errors. Same three lines fix both.

**F36 — the match a user reached during a scan is thrown away the moment the scan finishes, and the
viewport is scrolled back to the first match.** A direct follow-on from iteration 2's own D34, which
fixed exactly half of this. `views/shared/page/SearchToolbar.vue:115-120`:

```ts
  thisHandle.done.then((matches) => {
    if (handle !== thisHandle) return;
    scanning.value = false;
    props.api.searchState[props.tabId] = { matches, index: matches.length > 0 ? 0 : -1 };
    if (autoScroll && matches.length > 0) emit('goToMatch', matches[0]);
  });
```

D34 made an Enter press survive the *ticks* of a running scan (`:96-105`'s `previousIndex`
carry-forward, which works — verified by reading it against `scan.ts:86` and `:104`). The completion
handler then discards it: `index` is reset to `0` unconditionally, and `:119` re-emits
`goToMatch(matches[0])`, which is `DataGrid.vue`/`DocumentView.vue`/`KeyValueView.vue`'s
scroll-into-view. So on any page big enough for a scan to span more than one frame — `scan.ts:19`'s
`CHUNK_ROWS = 2000`, i.e. any fetch-more'd page — the sequence is:

1. type a query; the scan starts and publishes partial matches every frame;
2. press Enter three times to walk to match 3 (D34 keeps it there, correctly);
3. the scan finishes ~1.6 s later on a 200 000-row page;
4. **the current match snaps back to match 1 and the grid scrolls to the top.**

The page moves under the user's hands, which is the exact failure D23 was written to prevent
(`SearchToolbar.vue:59-61`'s own comment: *"jumping the viewport because a background refresh landed
would move the page under the user … unlike a query edit which is the user's own action"* — an Enter
press is no less the user's own action than the query edit that preceded it).

**F36a — and a fresh scan inherits the previous query's match index for its first frame.**
`startSearch` (`:62-121`) never resets `searchState[tabId]` when a new query begins — only the
empty-query branch clears it (`:65-69`). So `:103`'s `previousIndex` read on the **first** tick of a
new scan returns whatever index the *previous, completed* query was left on. It survives on the
grid and the document view by accident, because both pass a priority window
(`views/grid/search.ts:50-52`, `views/documents/search.ts:56-57`) and `:104`'s `rowsScanned === 0`
resets the index on that first priority tick. `views/keyvalue/search.ts:55-59` passes none — its own
comment says so: *"KeyValueView.vue renders every loaded row directly (no VirtualList), so nothing
ever calls setVisibleRows for this tab and this always resolves to `undefined`."* So on a key/value
page, the first tick of every new query publishes `{ matches: <a few>, index: <the old query's> }`,
and `SearchToolbar.vue`'s counter renders `{{ entry.index + 1 }} of {{ entry.matches.length }}` —
a reading like *"7 of 2"* — until the next frame corrects it. Same three-line fix as F36.

**F37 — a Refresh on a SCAN-paged Redis key silently serves page one while the pager keeps
counting.** `views/keyvalue/state.ts:66-69` builds the fallback cursor from the tab's pager
position, exactly as the grid and document views do:

```ts
  const effectiveCursor: PageCursor = cursor ?? {
    mode: 'offset',
    offset: tab.state.pageIndex * tab.state.pageSize,
  };
```

For a **list** key that is right — `redis/read.ts:216-266`'s `readList` is offset-addressable and
iteration 2's D25 made it honour the page size. For a **hash, set, zset or stream** key it is not,
because those four are cursor-paged and their readers ignore an offset cursor entirely.
`readScanFamily` (`:89-139`) accepts three cursor modes and reads only one:

```ts
  if (req.cursor.mode === 'before') { throw … 'forward-only' }
  let cursor = '0';
  if (req.cursor.mode === 'after') {
    [cursor] = decodePageToken(req.cursor.token, fingerprint);
  }
```

An `offset` cursor is neither rejected nor honoured — it falls through and the scan restarts from
cursor `'0'`, i.e. **page one**. `readStream` (`:268-320`) does the same at `:282-286` (`startId`
stays `'-'`).

So on a hash with 5 000 fields: ⏵ ⏵ to page 3, then press ↻ Refresh (or have a sibling tab's
mutation fire `reloadTabsForTarget`, or `KeyValueView.vue:348`'s post-Save reload). `reload`
(`state.ts:117-122`) calls `load(tabId)` with no cursor, the fallback sends `offset: 200`, redis
serves page one, and `tab.state.pageIndex` is left at 2. `rt.nextToken` is then page one's token, so
the next ⏵ shows page two under a pager that has advanced to page four. The user silently loses two
pages and nothing on screen says so — `KeyValueView.vue:530-538`'s `statusLine` prints
*"N loaded · M total"* and no page number, which is precisely why this has gone unnoticed.

The view already knows this class of key cannot seek: `KeyValueView.vue:106-111` disables ◀ for
exactly these four types, with the right reason —

```ts
// A cursor-strategy page (hash/set/zset/stream — SCAN-family) is forward-only: there is no
// reliable way to seek a SCAN cursor backward, so "Prev" only ever applies to a list key's plain
// LRANGE offset strategy.
const prevDisabled = computed(
  () => props.tab.state.pageIndex === 0 || page.value?.position.strategy !== 'offset',
);
```

— and then the reload path sends a seek anyway. D40 makes the two halves agree.

**F38 — a truncated refresh leaves the stale listing it could not replace sitting in the cache, and
serves it back with no truncation strip.** Iteration 2's D22 got the important half right (*"a
truncated listing is not a cheaper copy of the right answer"*) and stopped one step short.
`src/main/tree-service.ts:80-100`:

```ts
      await requireConnected(connectionId);
      const nodePath = decodePath(connectionId, path);
      const result = await engineHost.call<{ nodes: TreeNode[]; truncated?: boolean }>(…);
      if (!result.truncated) await putCached(db, connectionId, path, 'children', result.nodes);
      return { nodes: result.nodes, source: 'server', truncated: !!result.truncated };
```

`putCached` is skipped, so nothing wrong is *written*. But this is a cache-aside read-through over a
row that may already exist: `putCached` (`repos/metadata-cache.ts:57-116`) upserts one row per
`(connection_id, path)`, and `getCached` (`:47-54`) reads it back on any non-`refresh` visit. So:

1. Monday: the level lists cleanly (say 40 000 keys inside the budget) and is cached.
2. The namespace grows past `MAX_SCAN_ROUNDS`'s reach.
3. The user presses ↻ Refresh on that level. `refresh: true` skips `:82`'s read, the engine returns
   `truncated: true`, `:98` correctly declines to cache it, `:99` returns `truncated: true` and
   `BrowseView.vue` shows the strip. Correct, so far.
4. The user navigates away and back — an ordinary `load()` with `refresh: false`. `:82`'s
   `getCached` hits **Monday's row**, `:85` returns it with `source: 'cache'` and
   `truncated: false`, and the strip disappears.

The user is now looking at a months-old listing, presented as complete, on a level the app was told
minutes ago is too big to list. That survives an app restart — this is on-disk SQLite, not memory —
and only P1 D11's connect-time `dropCached` (`main/connections.ts`) ever clears it.

The fix is one branch and the file already has the idiom three lines away: `:86`, `:108` and `:128`
each call `await dropCached(db, connectionId, path)` when a cached payload turns out not to be
usable. A truncated refresh is the same situation — the cached answer cannot be trusted and there is
nothing to replace it with.

### C. Verified non-findings, recorded so P44 does not re-open them

**F39 — `redis/read.ts`'s SCAN-family page *overshoot* is structural and loses nothing.** Iteration 2
listed it in §6 and its §8 item 1 asked whether it should be settled. It should be settled as
"leave it", and here is why, from the code rather than from the earlier write-up.
`readScanFamily`'s loop (`:117-127`) accumulates **whole SCAN rounds**:

```ts
  do {
    …
    const [nextCursor, elements] = await scanOnce(cursor);
    cursor = nextCursor;
    for (let i = 0; i < elements.length; i += pairSize) { … rowCount++; }
    if (cursor === '0') exhausted = true;
  } while (rowCount < req.pageSize && !exhausted);
```

with `SCAN_COUNT = 1000` (`:13`). So a `pageSize: 10` request on a large hash returns up to ~1 000
rows. Three things make this correct rather than merely tolerated:

- **Nothing is lost.** The continuation token is minted from the round boundary (`:134`,
  `encodePageToken([cursor], …)`), so the next page resumes exactly where the last round ended.
  Slicing to `pageSize` instead would strand every element between the slice point and the round
  boundary, because a SCAN cursor is not addressable inside a round. That is precisely the class of
  bug iteration 2's F18 found in `readList` — the fix there was to stop clamping, and the same
  reasoning forbids clamping here.
- **The loop cannot spin.** `COUNT` is 1 000 with no `MATCH`, so every round returns elements, and
  `cursor === '0'` terminates.
- **The overshoot is bounded** by one round (~1 000 rows / ~2 000 rows for a `pairSize: 2` type),
  not by the key's size.

The overshoot's only consequence is a page larger than asked for, reported in the field F28 proved
nobody reads. `:86-88`'s comment gets one clause added (D48) naming what it *is* and is not, and
nothing else changes.

**F40 — D34's priority-tick reset is placed one tick earlier than its own comment claims, and it
does not matter.** `SearchToolbar.vue:96-105`'s comment says the reset covers the transition where
*"the main pass takes over and replaces `matches` wholesale"* — but `rowsScanned === 0` fires on the
**priority** tick, before that replacement, not on the first main-pass tick after it. An Enter press
landing in the window between them would carry an index built against `priorityMatches` into the
ascending `matches` array and silently point at a different match. That window is exactly one
animation frame: `scan.ts:105` calls `runMainPass()` synchronously at the end of the priority frame
and `:90` schedules `step` for the next one. Not reachable by a human. Recorded as checked, with
`:96-102`'s comment corrected in commit 6 to describe the tick it actually fires on.

**F41 — `views/definition/state.ts` deliberately has no supersession guard, and that is still
correct.** Read because F35 found the same absence next door. `:36-38` states the argument outright:
*"there is no op-id bookkeeping and no supersession guard. The only two callers are the view's
onMounted and the toolbar's Refresh — no pager, no filter to race against."* Re-verified against the
current tree: `registerTabReload` has no `'definition'` entry (`CommandTabKind` at
`state/viewCommands.ts:12` is `'data' | 'document' | 'keyvalue' | 'stream' | 'browse'`), and
`reloadTabsForTarget` (`:93-108`) reloads four kinds, none of them `definition`. So nothing
background-fires a definition load. The distinction between this file and browse's is real: browse
has four callers, one of which is a background invalidation.

---

## 2. Shapes introduced in this plan

**`src/shared/caps.ts` — `Caps` gains one optional number (D46). This is the plan's one
wire-facing change.**

```ts
  /** P43 iter3 D46: the largest page this engine can actually serve in one read, when that is
   *  below the picker's own ceiling. Absent means "every size the picker offers works" — ten of
   *  the eleven adapters. Only rabbitmq sets it (a basic.get batch is one request, capped at
   *  read.ts's MAX_POLL_MESSAGES, and every message in it is held unacked until the batch
   *  finishes), so the stream toolbar can stop offering two sizes a poll can never serve. */
  maxPageSize?: number;
```

```ts
// capsSchema — optional, so nothing already stored or in flight becomes unparseable.
  maxPageSize: z.number().int().positive().optional(),
```

**`src/renderer/views/shared/page/sizes.ts` — one optional argument (D46):**

```ts
export function pageSizeOptions(
  testidPrefix: '' | 'document-' | 'keyvalue-' | 'stream-',
  maxPageSize?: number | null,
): { value: PageSize; label: string; testid: string }[];
```

filtering the existing four-entry list to `value <= maxPageSize`. Omitting the argument is
byte-for-byte today's behaviour, which is what the three unchanged call sites
(`views/grid/DataToolbar.vue`, `views/documents/DocumentView.vue`, `views/keyvalue/KeyValueView.vue`)
rely on.

**`src/renderer/workbench/ContextMenu.vue` — one ref, one derived list, one class (D43/D44):**

```ts
/** The roving active row, as an index into `navigable` below — -1 until the first arrow key, so a
 *  menu opened by mouse looks exactly as it does today until the keyboard is used. */
const activeIndex = ref(-1);

/** Every row a keyboard can land on, in render order: enabled `item`s and every `submenu`
 *  trigger. Separators and disabled items are skipped rather than landed-on-and-refused. */
const navigable = computed<{ item: MenuItem; sub: MenuItem | null }[]>(…);
```

with `:class="{ 'is-active': … }"` on the three row templates, reusing `.p-row`'s existing hover
background — no new visual vocabulary.

**`src/renderer/views/shared/document/DocumentTree.vue` — the scroller (D42):**

```css
/* P43 iter3 D42: a long scalar value is revealed by scrolling this list sideways, not by wrapping
   it — rows.ts's rowHeight() is exact and measurement-free (one LINE_H per visible node), so a
   wrapped line or a 12px classic scrollbar (base.css) would both break the VirtualList prefix sum
   that depends on it. Chrome-less horizontal scrolling, the same idiom TabStrip.vue and
   ConsoleView.vue's result strip already use, costs zero height. */
.document-tree {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.document-tree::-webkit-scrollbar { display: none; }
.tree-line { width: max-content; min-width: 100%; }
```

**`src/renderer/views/browse/state.ts` — one runtime field (D39):**

```ts
  /** D39: monotonic per tab. `load()` captures it before its await and drops its own result if a
   *  newer load has started since — the same supersession guard grid/documents/keyvalue/stream
   *  all keep as `opId`, expressed as a counter because `kira:tree:children` is not a cancellable
   *  engine op and has no op id to compare (this module's own :8-10 note). */
  loadSeq: number;
```

**Two new Docker-free `bun:test` specs (D36/D37).** Both live beside
`tests/db/preconnect.spec.ts`, the existing precedent for a `tests/db/` spec with no container:

```
tests/db/metadata-cache.spec.ts   # src/main/storage/repos/metadata-cache.ts over bun:sqlite
tests/db/run-state.spec.ts        # src/renderer/state/runState.ts over a stubbed window
```

and one line in `tests/db/tsconfig.json`:

```json
  "include": ["**/*.ts", "../../src/renderer/env.d.ts"]
```

---

## 3. Decisions

D-numbers continue from iteration 2, which ended at **D35**.

### The two Docker-free test routes

| # | Decision | Rationale |
|---|----------|-----------|
| D36 | **`repos/metadata-cache.ts` gets a real `bun:test` spec, built on a `drizzle-orm/sqlite-proxy` instance over `bun:sqlite`**, in `tests/db/metadata-cache.spec.ts`. It creates `connections` + `metadata_cache` with `0001_init.sql`'s own DDL, not a migration runner. | F34. `preconnect.spec.ts` already establishes that `tests/db/` is not synonymous with "needs Docker"; this is the second such spec and the first over `src/main/storage/`. Building the proxy by hand rather than calling `openDb()` is deliberate: `openDb()` hard-codes `dbPath()` **and** requires `node:sqlite`, which this box's Bun lacks (AGENTS.md's SQLite section) — `bun:sqlite` is always present and the proxy in `db.ts:71-85` is the only thing the repo functions actually depend on. Restating the two tables' DDL inline rather than importing `migrations/index.ts` avoids `?raw` (a Vite transform `bun test` has no loader for) and keeps the spec readable; the schema is pinned by the `metadataCache` Drizzle table the repo imports either way, so a drift between them is a type error, not a silent pass. |
| D37 | **`state/runState.ts` gets a real `bun:test` spec** in `tests/db/run-state.spec.ts`, stubbing `globalThis.window` before a dynamic `import()` of `state/ops` and `state/runState`; `tests/db/tsconfig.json`'s `include` gains `"../../src/renderer/env.d.ts"`. | F34. The stub is four lines and is honest about why it exists (`bridge/control.ts:33` reads `window.kira` at module scope, and `bridge/port.ts:29` registers a `window` listener) — this is not a mock of the code under test, which never touches either. The `tsconfig` line is the smaller of the two ways to make `window.kira` resolve under the `tests/db` project; the alternative — a fifth typecheck project with its own `package.json` script — is the new build step §0 forbids. Verified in this sandbox, not assumed: `tsgo --noEmit -p tests/db/tsconfig.json` exits 0 with the spec present, and `bun test` passes. Rejected: waiting for P44's "sparse unit tests" phase. Iteration 2 handed this to P44 on the assumption that a harness had to be built first; there is no harness to build, and a phase whose §5 had to write *"no spec, anywhere"* twice should not end without closing the two it can. |
| D38 | **A truncated `children` refresh drops the connection+path row it declined to replace**, by calling the `dropCached` that `tree-service.ts:86`/`:108`/`:128` already call for an unusable cached payload. | F38. The alternative — leaving the stale row — makes iteration 2's D22 self-defeating: D22 refuses to *write* a short answer precisely so the app never serves one it knows is wrong, and then serves an older one it also knows is wrong, without even the strip. Dropping is the honest operation and costs one round trip on a level the user has just been told is incomplete. Dropping the whole row (rather than only its `children` key) matches every other drop in the file and matches the table's own shape — the unique index is `(connection_id, path)` and `describe`/`definition` share the row (`repos/metadata-cache.ts:8-10`); a partial-key delete would be a new operation for one caller. Rejected: caching the truncated list *with* a stored `truncated` flag — iteration 2's D22 argued that down already (it would put a field in a payload `treeNodeArraySchema` has no place for), and nothing found this round changes it. |

### The load-ordering and pager findings

| # | Decision | Rationale |
|---|----------|-----------|
| D39 | **`views/browse/state.ts` gains a per-tab `loadSeq` and drops any result whose sequence has been superseded**, guarding the success path *and* both failure paths; `rt.truncated` is reset to `false` alongside `error`/`actionError` when a load starts. | F35/F35a. A counter rather than an `opId` because `kira:tree:children` is genuinely not a cancellable engine op (the module's own `:8-10` note, P41 D16) and has no id to compare — inventing one would imply a Stop button this panel does not and should not have. The guard covers the catch as well as the try: a stale *failure* reddening a level that loaded fine is the same bug wearing the other hat, and iteration 1's F-series established that a failed load must not blank a good page. Rejected: comparing `currentLevel(tabId)` after the await instead of a counter — it would let a *second* load of the **same** level (a Refresh landing after a background `invalidateLevel`) still clobber the newer result, and it silently does nothing on the `refresh` axis. |
| D40 | **A key/value tab whose current page is cursor-paged reloads from the start of the scan, and says so by returning `pageIndex` to 0** — `load()`'s fallback cursor becomes `offset: 0` and `patchKeyValueTabState(tabId, { pageIndex: 0 })` runs alongside it, both gated on the loaded page's own `position.strategy !== 'offset'`. | F37. There is no third option: a SCAN cursor cannot be resumed after the page that minted it is gone, so a reload on page 3 of a hash *must* return to page 1 — the only question is whether the pager admits it. Today it does not, and the tab drifts a page further from the truth on every refresh. Reading `getPage(tabId)?.position.strategy` rather than adding a `lastStrategy` field mirrors `KeyValueView.vue:109-111`'s own `prevDisabled`, which already answers exactly this question from exactly this source — one vocabulary, not two. Rejected: making `readScanFamily`/`readStream` throw `E_UNSUPPORTED` on an offset cursor. It is the more literal reading of the adapter contract, but it would turn every ordinary Refresh on a hash key into a red error strip, and the renderer is the side that knows a reload is not a seek. |
| D41 | **The find toolbar keeps the match the user navigated to when its scan completes**, and only auto-scrolls when the user has not navigated. It also seeds an empty pending record when a search starts, so a new query never inherits the old one's index. | F36/F36a, and it is a correctness argument rather than a preference: during the main pass `soFar` **is** `matches` (`scan.ts:84` appends into the same array `:88` resolves with), strictly ascending and append-only, so an index into the partial list identifies the same match in the final list — the clamp `navigated < matches.length` is belt-and-braces for F36a's inherited case, not the mechanism. Suppressing the auto-scroll when `navigated >= 0` is the other half: `goToMatch` exists to move the viewport on the user's behalf, and a user who has already moved it themselves has answered that question. The seed also removes a one-frame window where a new query's highlights are the old query's. Rejected: not resolving `done` at all on a completed-but-navigated scan, and rejected: a separate `userNavigated` flag — `index >= 0` on a `pending` record already means exactly that and D34 already maintains it. |

### The four overdue items

| # | Decision | Rationale |
|---|----------|-----------|
| D42 | **A document tree scrolls sideways to reveal a long value, with no scrollbar chrome and no height change**: `.document-tree` becomes an `overflow-x: auto` scroller with `scrollbar-width: none` + a hidden `::-webkit-scrollbar`, `.tree-line` becomes `width: max-content; min-width: 100%`, `.tree-value` loses `overflow: hidden`/`text-overflow: ellipsis`, and a `@wheel` handler routes a plain vertical wheel through `wheelScroll.ts`'s existing `wheelToHorizontal`. | F31. This is the only shape that fits the exact-height contract `rows.ts:207-222` and `VirtualList.vue:59-66` depend on: the line stays one `LINE_H` tall (nothing wraps), and a chrome-less scroller occupies zero vertical space, so `rowHeight()` is not touched and no measurement is introduced. It is also not a new mechanism — `TabStrip.vue:194-201` and `ConsoleView.vue:449-455` are the same three CSS declarations plus the same `wheelToHorizontal` call, and `wheelScroll.ts:1-6` exists at the renderer root **specifically** so a second family of callers could reach it. Fixing it inside `DocumentTree.vue` fixes both hosts at once, which is why neither `DocumentView.vue:1067`'s nor `ConsoleResultGrid.vue:645`'s `overflow: hidden` needs to change. Rejected: wrapping long values (breaks `rowHeight`); rejected: an `overflow-x: auto` scroller on `.doc-body` (a 12 px classic scrollbar, per `base.css:72-75`, would clip the last line of every expanded document); rejected: publishing the clicked scalar into a cell editor dock (the Mongo data tab mounts none, deliberately — `cellSelection.ts:31-32` — and mounting one is a design change, not a bug fix). |
| D43 | **`ContextMenu.vue` gains roving keyboard navigation on the listener it already owns**: `ArrowDown`/`ArrowUp` move an `activeIndex` over the navigable rows (wrapping, skipping separators and disabled items), `Enter` runs the active item, and each of those four keys calls `preventDefault()`. `Escape` is unchanged. Hovering a row syncs `activeIndex` so the mouse and the keyboard never disagree about which row is live. | F32. No focus management is needed and none is added: `:46` already registers `onKeydown` on `document`, and the menu is already modal in practice (`:37-39` closes it on any outside mousedown, `:47-48` on scroll or window blur), so the keys are already arriving — the component simply throws them away today. `preventDefault` is what stops the arrows from also scrolling whatever is behind the menu. Skipping disabled rows rather than landing on them and refusing matches what the rows already do to the mouse (`:69`'s early return, `.row.is-disabled:hover { background: transparent }` at `:188-190`). Reusing `.p-row`'s hover background for `.is-active` keeps this out of the design system's way — an active row and a hovered row are the same state to the user. |
| D44 | **Submenus are reachable too, minimally**: `ArrowRight` on a submenu trigger opens it and moves into its first item; `ArrowLeft` closes it and returns to the trigger; `Enter` on a trigger does what `ArrowRight` does. The 150 ms hover delay (`:60-65`) is untouched and applies only to the mouse. | F32. Stopping at the top level would leave `ProjectTree.vue`'s Color submenu and `DataGrid.vue`'s "Copy row(s)" submenu keyboard-dead while the rows above them work, which is a worse state than either extreme. Right/Left is the platform convention on both macOS and Windows and needs no new state beyond the `openSubmenuId` ref that already exists (`:11`) plus one index for the row inside it. Deliberately **not** included: type-ahead search, `Home`/`End`, and roving `tabindex`/`aria-activedescendant` — each is a real accessibility feature and none of them is what P42 D27 took away. |
| D45 | **The perimeter probe is bounded by the grid's own extents**: `selEdge*` treats a neighbour outside `[0, rowCount)` × `[0, columnOrder.length)` as unselected, so the outermost cells of a `row` or `column` selection draw their caps. `isSelected` is left exactly as it is. | F33. Fixing it at the probe rather than inside `isSelected` is what keeps the change to four lines and keeps `isSelected`'s meaning intact — it answers *"is this cell in the selection"*, and `(3, -1)` is not a cell, so teaching it to say "no" would be teaching it about geometry it has no other use for (and would cost a bounds check on every one of the O(rows × cols) calls `rowVms` makes, which P42's own F14a note is careful about). The probe already runs only for a selected cell (`:1029-1031`'s comment), so the added comparisons are on the narrow path. |
| D46 | **`Caps` gains an optional `maxPageSize`; rabbitmq sets it to `MAX_POLL_MESSAGES`; `pageSizeOptions` takes an optional ceiling and `StreamView.vue` passes it.** A tab whose persisted `pageSize` is above the ceiling is corrected to the largest offered size on mount. | F29. The ceiling belongs to the adapter, not to the view: hard-coding `500` in `StreamView.vue` would put one engine's protocol constant in a component that renders three engines, and would drift the first time `MAX_POLL_MESSAGES` changes. `Caps` is already the channel for exactly this kind of per-engine fact (it carries `pagination`, `exactCount`, `canInsert`/`canUpdate`/`canDelete` for the same reason) and it already reaches the renderer on connect. Optional so ten adapters say nothing rather than restating the picker's own ceiling ten times. The mount-time correction is required, not cosmetic: `PageSize` is a closed union (`shared/domain/tabs.ts`) and a `SegmentedControl` whose `model-value` is not among its options renders nothing selected. Rejected: adding a `500` option (it would widen the persisted `PageSize` union for one engine); rejected: disabling rather than removing the two options (`SegmentedControl` has no per-option disabled state, and adding one is a design-system change for one caller). |
| D47 | **`PagePosition.pageSize`'s declaration records that it is informational and unread**, in one comment at `shared/protocol/page.ts:58`. No adapter changes, and the field is not removed. | F28. Two phases have now asked what it means; the answer is that the question is unanswerable from the consumer side because there is no consumer. Writing that down at the declaration is what stops a fourth phase from asking. Not removing it: it is on a validated wire schema (`:67`) and on every page every adapter builds, so deleting it is an eleven-adapter change plus a schema change to delete something harmless — the exact gold-plating §0 forbids. |
| D48 | **`redis/read.ts:86-88`'s comment gains the clause it is missing** — that the overshoot is bounded by one SCAN round and that slicing would strand a round's tail, which is why it is not clamped. No code change. | F39. The existing comment says the overshoot *"is fine for a browse-only view"*, which reads as a shrug; after iteration 2 deleted `LIST_WINDOW` for clamping in the other direction, the next reader deserves the actual reason the two cases resolve opposite ways. |

---

## 4. Implementation order

Ten commits. Each is one sitting, independently reviewable, leaves `lint` / `typecheck` (node, web,
db, electron-db) / `bunx electron-vite build` green, and carries the spec edits for the behavior *it*
changes. Ordering: the three test/main-side commits first (they close iteration 2's own open
verification debt and unlock the route commit 3 uses), then the two load-ordering fixes, then the
four overdue items, then the page-size picker. No commit depends on another except **3 on 1** (it
reuses the `bun:sqlite` + `sqlite-proxy` harness commit 1 introduces).

1. **`test(storage): the metadata cache's per-connection cap has a Docker-free spec`** — D36.
   New `tests/db/metadata-cache.spec.ts` only; **no `src/` change at all**. Scenarios, in
   `preconnect.spec.ts`'s numbered style: (1) 260 `putCached` calls for one connection leave exactly
   `MAX_ROWS_PER_CONNECTION` rows, the oldest paths are gone and the newest reads back through
   `getCached`; (2) the row just written is never the one evicted, asserted after **every** one of
   400 consecutive writes (the `fetched_at`-tie probe); (3) two connections do not evict each other
   — 250 rows under `c1` leaves `c2`'s 5 rows untouched (D20's per-connection claim); (4) a payload
   over `MAX_PAYLOAD_BYTES` is refused without disturbing the rows already there (the guard that
   the early return at `:79-85` and the eviction pass at `:96-113` do not interact). **Runs for real
   in this sandbox** — `bun test tests/db/metadata-cache.spec.ts`.
2. **`test(state): a running op wins the toolbar's ring over a newer finished one`** — D37.
   New `tests/db/run-state.spec.ts`; `tests/db/tsconfig.json`'s `include` gains
   `"../../src/renderer/env.d.ts"`. Scenarios: (1) F14's exact race — `[B done, A running]`, both
   `tabId: 't1'` — reads `running`; (2) with no running record, the newest finished one still
   supplies the idle slot's `durationMs` (LAW 12, the guard that D19 changed nothing else);
   (3) an `error` record is reported as `error`, not `idle`; (4) a tab with no records at all reads
   `IDLE`; (5) another tab's running op does not light this tab's ring. **Runs for real in this
   sandbox.**
3. **`fix(storage): a truncated level drops the stale listing it could not replace`** — D38/F38.
   `src/main/tree-service.ts:98` (the `if (!result.truncated)` branch gains its `else`), and `:24-26`'s
   `TreeChildrenResult.truncated` doc comment gains the sentence that makes it true end to end.
   **Spec edits in this commit:** `tests/db/metadata-cache.spec.ts` gains a `createTreeService`
   block — the service takes `db`, `engineHost` and `connections` as constructor arguments
   (`tree-service.ts:66-70`), so a stub `engineHost.call` returning `{ nodes, truncated: true }` and
   a stub `connections.stateOf` returning `{ status: 'connected' }` drive the whole path over
   commit 1's `bun:sqlite` harness: cache a complete level, refresh it into a truncated one, assert
   the row is **gone** and that the next `children(…, refresh: false)` goes back to the engine
   rather than serving the stale list. **Runs for real in this sandbox.**
4. **`fix(browse): a superseded level load never paints over the level the user moved to`** —
   D39/F35/F35a. `views/browse/state.ts` only (`loadSeq` on the runtime and in `defaultRuntime`,
   captured before the await and re-checked on all three exit paths; `rt.truncated = false` beside
   `rt.error = null` at `:70`). **Spec edits in this commit:** `tests/ui/redis.spec.ts`'s Browse
   block gains a step that descends into a namespace and immediately presses Up, then asserts the
   breadcrumb and the listed rows agree; `tests/ui/s3.spec.ts` gains the same for a nested prefix.
   Docker-gated — §5.
5. **`fix(keyvalue): a refresh on a cursor-paged key returns the pager to the rows it served`** —
   D40/F37. `views/keyvalue/state.ts` (`load`'s fallback cursor and `reload`); `redis/read.ts:86-88`'s
   comment corrected in the same commit per D48. **Spec edits in this commit:**
   `tests/db/redis.spec.ts` asserts that an `offset` cursor with a non-zero offset on a hash key
   returns the *first* page (pinning the adapter behaviour the renderer now assumes rather than
   guesses); `tests/ui/redis.spec.ts` pages a large hash forward twice, presses ↻, and asserts the
   first row is the hash's own first field again. Docker-gated.
6. **`fix(search): the match a scan was navigated to survives the scan finishing`** — D41/F36/F36a.
   `views/shared/page/SearchToolbar.vue` only (`:115-120`'s completion handler, the pending seed in
   `startSearch`, and `:96-102`'s comment corrected per F40 to name the tick it actually fires on).
   **Spec edits in this commit:** `tests/ui/data-view.spec.ts` — on a fetch-more'd page, type a
   query, press Enter twice while `search-count` still shows the scan running, then wait for it to
   settle and assert the count still reads match 3 (not 1) and that the viewport did not jump.
   Docker-gated — the SQLite seed is three rows and completes in one frame, so there is no in-flight
   scan to navigate; §5 says so rather than pretending.
7. **`fix(documents): a long value in an expanded document can be read to its end`** — D42/F31/F31a.
   `views/shared/document/DocumentTree.vue` (the scroller, the `@wheel` handler, `.tree-value`
   losing its ellipsis, `.tree-line`'s `max-content` width);
   `views/documents/DocumentView.vue:763-767`'s false comment rewritten to say what `onRowClick`
   actually does. No change to either host's `overflow: hidden` and **no change to
   `views/shared/document/rows.ts`** — `git diff --stat src/renderer/views/shared/document/rows.ts`
   must be empty, which is the guard that the exact-height contract was not touched. **Spec edits in
   this commit:** `tests/ui/mongo.spec.ts` expands a document containing a long string field and
   asserts `document-tree-value`'s `scrollWidth` exceeds its `clientWidth` while the row's rendered
   height is unchanged (the two halves of D42's claim); `tests/ui/console.spec.ts` asserts the same
   inside a console `find()` result. Docker-gated.
8. **`feat(menu): a context menu is navigable from the keyboard`** — D43/D44/F32.
   `src/renderer/workbench/ContextMenu.vue` only (`activeIndex`, `navigable`, the extended
   `onKeydown`, the `is-active` class on the three row templates, `onRowEnter` syncing the index,
   `activeIndex` reset in the existing open-watch at `:28-35`). **Spec edits in this commit:** a new
   block in `tests/ui/sqlite.spec.ts` beside the existing right-click at `:135-140` — open the cell
   context menu, press `ArrowDown` until `menu-item-filter-by-value` carries `.is-active`, press
   `Enter`, and assert the filter applied exactly as the mouse path already asserts at `:138-140`;
   plus `ArrowUp` from the first row wrapping to the last, and `Escape` still closing. Then, in the
   same spec's cell-editor block, open `cell-editor-format` and pick a format by keyboard alone.
   **Runs for real in this sandbox.**
9. **`fix(grid): a whole-row or whole-column selection draws its own end caps`** — D45/F33.
   `views/grid/DataGrid.vue:1029-1035` (the four probes bounded by the page's own extents) and one
   `data-testid="grid-header-select"` added to the header select zone at `:1458-1463` so the spec
   can reach it. **Spec edits in this commit:** a new block in `tests/ui/sqlite.spec.ts` beside
   P42's existing perimeter assertions at `:166-190` — click `grid-gutter-cell` for row 0, assert
   the row's first cell has `sel-l` and its last has `sel-r` and neither has the other; click
   `grid-header-select` for `id`, assert the column's first cell has `sel-t` and its last has
   `sel-b`; then re-run P42's own 3×3 range assertions unchanged as the guard that the bound did not
   change the case that already worked. **Runs for real in this sandbox.**
10. **`fix(stream): the page-size picker offers only what a poll can serve`** — D46/D47/F29.
    `shared/caps.ts` (`maxPageSize` on the interface and the schema, plus §5.1's table row for
    rabbitmq); `engine/adapters/rabbitmq/caps.ts` (`maxPageSize: MAX_POLL_MESSAGES`, imported from
    `./read` — or the constant hoisted there, whichever keeps one definition);
    `views/shared/page/sizes.ts` (the optional ceiling); `views/stream/StreamView.vue`
    (`PAGE_SIZE_OPTIONS` becomes a `computed` reading `caps.maxPageSize`, plus the mount-time
    correction for a persisted size above it); `shared/protocol/page.ts:58` gains D47's comment.
    **Spec edits in this commit:** `tests/ui/rabbitmq.spec.ts` asserts `stream-page-size-1000` and
    `stream-page-size-10000` have count **0** on a queue tab while `stream-page-size-100` is
    visible; `tests/ui/sqs.spec.ts` and `tests/ui/kafka.spec.ts` each assert all four are still
    present (the guard that ten adapters are unchanged). Docker-gated.

**Docs are deliberately *not* a commit here — with one exception at the very end of the round.**
SPEC.md's §10 P43 row (SPEC.md:1063, still reading *"Not yet planned — queued"*) and any §8 sentence
this phase falsified are written **once, after commit 10 lands**, as a separate `docs(spec):` commit
outside this plan's implementation order — see §8. **This plan file is the only doc this round's
numbered commits touch.**

---

## 5. Verification

**Say plainly what this box can and cannot do.** Per AGENTS.md: `bun run lint`, `bun run typecheck`
and `bunx electron-vite build` all run here (`bun run typecheck` was run against the tree at
`78fc6d5` while writing this plan — exit 0, all four projects). Playwright runs here **only**
because the Electron binary is installed by hand (`node_modules/electron/dist/electron`; if a fresh
container loses it, re-install with `curl` per AGENTS.md's "Electron binary" section). It must be
invoked **directly** — `bun run test:ui` fires `pretest:ui` → `scripts/native-electron-build.sh`,
which cannot fetch Electron's C++ headers through this environment's proxy and fails before a single
spec runs. The working invocation here is:

```
bunx electron-vite build && xvfb-run -a bunx playwright test \
  tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts tests/ui/smoke.spec.ts \
  tests/ui/connections.spec.ts tests/ui/workbench.spec.ts
```

**This round adds a second executable route, and it is the most useful thing in it.** `bun test
tests/db/<file>.spec.ts` runs a single Docker-free spec here for real. `bun test tests/db` as a
whole still does not go green in this box (`tests/db/sqlite.spec.ts` needs a Bun with `node:sqlite`,
which this one lacks, and every Testcontainers spec self-skips), so commits 1–3 are verified by
naming their files explicitly.

| Spec | Runs in this sandbox? |
|---|---|
| `tests/db/metadata-cache.spec.ts` (new, commits 1 & 3) | **Yes, for real** — `bun:sqlite` + `drizzle-orm/sqlite-proxy`, no Docker, no Electron, no `node:sqlite`. Confirmed by running the scenarios while writing this plan. |
| `tests/db/run-state.spec.ts` (new, commit 2) | **Yes, for real** — a `window` stub and a dynamic import. Confirmed by running it, and by `tsgo -p tests/db/tsconfig.json` exiting 0 with it present. |
| `tests/db/preconnect.spec.ts` | Yes — the existing Docker-free precedent. |
| `tests/ui/sqlite.spec.ts` | **Yes, for real, unconditionally** — a real SQLite connection, a real tree, a real grid, a real cell editor, a real console and a real context menu. Where commits 8 and 9 get executed coverage. |
| `smoke`, `startup`, `connections`, `workbench`, `secrets` | Yes (no DB). |
| `data-view`, `mutations`, `mongo`, `redis`, `s3`, `sqs`, `rabbitmq`, `kafka`, `clickhouse`, `cell-editor`, `console`, `tree`, … | **No** — Postgres/Mongo/Redis/LocalStack/RabbitMQ/ClickHouse containers; they `test.skip()` cleanly rather than fail (image pulls return `403` through this environment's proxy). |
| `tests/db/*` (except `preconnect` and the two new ones) | **No** — Testcontainers, same `403`. `tests/db/sqlite.spec.ts` additionally needs a Bun with `node:sqlite`. |
| `tests/electron-db/kafka.spec.ts` | **No, twice over** — Docker *and* a native addon rebuilt for Electron's ABI. |

**Be blunt about the consequence.** **Five of this round's ten commits (1, 2, 3, 8, 9) are verified
here for real.** That is the highest ratio any round of this phase has managed, and it is the direct
result of F34's finding that two of iteration 2's three "untestable" commits were never actually
untestable. The other five are Docker-gated and typecheck/build-clean here only. **Zero commits in
this round have no executable assertion anywhere** — an improvement on iteration 2's two.

| Commit | What must be re-run green | What it pins |
|---|---|---|
| 1 | `lint` + `typecheck` (db) + `bun test tests/db/metadata-cache.spec.ts` **here, for real** | That iteration 2's D20 does what its comment says: the table holds at most `MAX_ROWS_PER_CONNECTION` rows per connection, the oldest go first, the row just written is never the casualty of its own eviction pass, and one connection cannot evict another's. Scenario 4 is the guard that the payload-cap early return and the eviction pass do not interact — iteration 2's §5 asked for exactly that read and could not assert it. |
| 2 | `lint` + `typecheck` (db, and `web` must stay green — the `include` addition must not change the renderer project) + `bun test tests/db/run-state.spec.ts` **here, for real** | That iteration 2's D19 answers the ring's actual question. Scenario 2 is the guard that the idle slot's `durationMs` is byte-identical to pre-D19 behaviour (LAW 12), which is the half a reading of the diff cannot prove. |
| 3 | `bun test tests/db/metadata-cache.spec.ts` **here, for real** | That a truncated refresh leaves nothing behind — the row is gone, and the next ordinary visit reaches the engine rather than serving Monday's list under `truncated: false`. Also that a *complete* refresh still caches exactly as it did (the negative guard that D38 narrowed nothing). |
| 4 | `typecheck` + `build` here; `tests/ui/redis.spec.ts` + `tests/ui/s3.spec.ts` elsewhere | That the level on the breadcrumb and the level in the list are the same level, after a fast navigation lands during a slow one. The stale-*failure* half has no DOM assertion the suite can make deterministically and is verified by reading the diff against the three exit paths plus the manual click-through's item 2 — stated rather than faked. |
| 5 | `typecheck` here; `tests/db/redis.spec.ts` + `tests/ui/redis.spec.ts` elsewhere | That a Refresh on a hash/set/zset/stream key puts the pager where the rows actually are. The `tests/db` half pins the adapter fact the renderer now depends on (an offset cursor on a SCAN-family key returns page one) so a future adapter change cannot silently re-break the renderer. The list-key path must be **unchanged** — the same spec's existing LRANGE assertions re-run as that guard. |
| 6 | `typecheck` here; `tests/ui/data-view.spec.ts` elsewhere | That Enter during a scan still means something after the scan ends, and that the viewport does not jump back. Needs a page big enough to keep a scan in flight for more than one frame — `data-view.spec.ts`'s fetch-more'd Postgres page, not the SQLite seed's three rows. This is the same honest reason iteration 2's commit 11 gave, and it has not changed. |
| 7 | `typecheck` + `build` here; `tests/ui/mongo.spec.ts` + `tests/ui/console.spec.ts` elsewhere | That a long value is reachable **and** that the row is exactly as tall as it was. `git diff --stat src/renderer/views/shared/document/rows.ts` being empty is the structural half of that guard; the rendered-height assertion is the observable half. `tests/ui/perf.spec.ts`/`budgets.spec.ts` re-run elsewhere are the guard that a `max-content` line did not change the virtualized list's cost. |
| 8 | `sqlite.spec.ts` **here, for real** | That every menu in the app can be walked and committed from the keyboard, including the cell editor's format picker — the control P42 D27 turned from a native `<select>` into a mouse-only surface. The `Escape` assertion re-run unchanged is the guard that D43 did not disturb the one key that already worked. |
| 9 | `sqlite.spec.ts` **here, for real** | That a whole-row and a whole-column selection are closed shapes. P42's own 3×3 range assertions (`sqlite.spec.ts:166-190`) re-run unchanged are the guard that bounding the probe did not double any internal seam — the bug P42 D21 exists to prevent. |
| 10 | `typecheck` (all four — `capsSchema` is on a validated wire) + `build` here; `tests/ui/rabbitmq.spec.ts`, `tests/ui/sqs.spec.ts`, `tests/ui/kafka.spec.ts` elsewhere | That the picker offers only sizes the engine can serve, and that the other ten adapters' pickers are untouched. `tests/db/rabbitmq.spec.ts` re-run elsewhere is the guard that `MAX_POLL_MESSAGES` itself is unchanged — this commit exposes the cap, it does not raise it. |

**Manual click-through afterwards (a human or an agent on a box with real containers)** — five of
this round's ten commits have no assertion runnable here, and two are about what happens *between*
panels, which no single spec sees end to end:

1. Browse a Kafka topic written by a transactional producer all the way to the end: ⏵ greys out
   rather than serving an empty page forever. **(Iteration 2's commit 3 — the one thing this phase
   still cannot verify anywhere. §8 owns it.)**
2. Open a Redis connection, descend into a very large namespace, and press ⬆ before it finishes: the
   breadcrumb and the list agree, and the list is the parent's.
3. Open a Redis hash with several thousand fields. Press ⏵ twice, then ↻: the first field is the
   hash's own first field again, and the pager agrees that you are back at the start.
4. Open a Redis or S3 level too large to list, press ↻ so the truncation strip appears, navigate
   away and back: the strip is still there and the list is still the short one — not a stale
   complete-looking list from a previous session.
5. On a large table, open find, type a term, and press Enter three times while the counter is still
   climbing: when it settles you are still on match 3 and the grid has not scrolled to the top.
6. Expand a Mongo document with a very long string field, in both the data tab and a console
   `find()` result: two-finger swipe (or shift+wheel, or plain wheel) reveals the rest of the value,
   the row is no taller than before, and no scrollbar appears.
7. Right-click any grid cell and drive the menu with the arrow keys and Enter; then open the cell
   editor's format picker and change the format without touching the mouse. Open a menu with a
   submenu (a connection's Color) and reach an entry inside it with ArrowRight.
8. Click a row's gutter number, then a column header's select zone: each selection is enclosed on
   all four sides.
9. Open a RabbitMQ queue: the page-size picker offers 10 and 100 only, and the strip above still
   explains why.

---

## 6. Explicitly out of scope

Iterations 1's and 2's own §6 lists are **not** re-opened here; nothing in this round's reading
produced new evidence against any of them, and iteration 2's F27 (the four SQL adapters' pagination
is clean) was spot-checked rather than re-derived. New to this round:

- **`DataGrid.vue:558-566`'s `matchIndex`.** Not a fix — F30 is a *decision*, with the three
  reasons. It is a computed, it runs once per frame at most, and it is the same order as the array
  copy that triggers it.
- **`PagePosition.pageSize`'s meaning across adapters.** F28: the field has no reader. D47 documents
  it; nothing else changes.
- **`redis/read.ts`'s SCAN-family overshoot.** F39: bounded by one round, loses nothing, and
  clamping it would strand a round's tail — the exact bug iteration 2's F18 fixed in the other
  direction. D48 adds the missing clause to its comment and stops there.
- **`sqs/read.ts:45-56`'s `position(req.pageSize)`.** Iteration 2 flagged it beside rabbitmq's. It
  is not the same case: SQS genuinely serves the size it is asked for by looping
  `ReceiveMessageCommand` (`:70-74`'s own comment), so the reported number is accurate. Commit 10
  deliberately does not touch SQS.
- **Making `views/documents/` mount a cell editor dock** so a scalar field could be published into
  it. `state/cellSelection.ts:31-32` records that this view publishes nothing *by design* (§8.7: a
  document's own row is already the read/write surface); reversing that is a design decision, not a
  bug fix, and D42 solves F31 without it.
- **Type-ahead, `Home`/`End`, and `aria-activedescendant` in `ContextMenu.vue`.** D44 says why: none
  of them is what P42 D27 removed, and each is a real accessibility feature deserving its own
  decision rather than a ride-along.
- **A `500` page size, or a per-option `disabled` state on `SegmentedControl`.** D46 rejects both,
  with reasons.
- **Extracting `kafka/read.ts`'s window/`hasMore` arithmetic into a testable pure function.** It
  would make iteration 2's commit 3 assertable without Docker, and it is exactly the speculative
  refactor §0 forbids — the arithmetic is three lines inside a 120-line function whose every other
  input is a live consumer. F34 re-read it instead and found it correct; §8 hands the one real run
  forward.
- **Candidates checked and discarded as *not* bugs**, recorded so P44 does not spend the time again:
  - **`views/definition/state.ts`'s missing supersession guard** — F41. Deliberate, documented at
    `:36-38`, and still true: nothing background-fires a definition load.
  - **`SearchToolbar.vue`'s D34 reset firing on the priority tick rather than the first main-pass
    tick** — F40. A one-animation-frame window; the comment is corrected in commit 6, the code is
    not.
  - **`ContextMenu.vue`'s `submenuTimer` surviving a close** (`:59-65`, cleared only in
    `onUnmounted` at `:55`). A timer that fires after `closeContextMenu` writes `openSubmenuId` for a
    menu that is not rendered, and `:28-35`'s watch resets it on the next open before anything reads
    it. Harmless in every ordering; not touched.
  - **`views/console/state.ts`'s tab-close cleanup not calling `pruneExpandedDocIds`** (`:78-87`).
    It deletes the whole `runtime[tabId]` record, `expandedDocIds` included. Iteration 2's D32
    landed correctly; re-read end to end.
  - **`views/stream/state.ts`'s `reload()` restarting a Kafka browse from offset 0** (`:142-147`,
    `:76`). Correct: a browse token cannot survive the `data.invalidate` that precedes it, and
    `:177-178`'s comment already says a browse tab has no addressable position to return to.

---

## 7. Acceptance checklist

- [ ] `bun test tests/db/metadata-cache.spec.ts` and `bun test tests/db/run-state.spec.ts` both pass
      **in this sandbox**, and `tests/db/preconnect.spec.ts` still does.
- [ ] `grep -n "include" tests/db/tsconfig.json` shows `../../src/renderer/env.d.ts`; `bun run
      typecheck` is green for all four projects, `web` included.
- [ ] A truncated `children` refresh leaves **no** row for that `(connection_id, path)`;
      `grep -n "dropCached" src/main/tree-service.ts` shows four call sites, not three.
- [ ] `grep -n "loadSeq" src/renderer/views/browse/state.ts` shows the field, its capture before the
      await, and a check on **all three** exit paths; `rt.truncated` is reset where `rt.error` is.
- [ ] A key/value tab on a cursor-strategy page reloads with `offset: 0` **and** `pageIndex: 0`;
      a list key's reload is byte-identical to today.
- [ ] `grep -n "index: matches.length > 0 ? 0 : -1" src/renderer/views/shared/page/SearchToolbar.vue`
      returns nothing; a scan that completes under a navigated index keeps it and does not
      auto-scroll.
- [ ] `grep -n "text-overflow" src/renderer/views/shared/document/DocumentTree.vue` returns nothing;
      `git diff --stat src/renderer/views/shared/document/rows.ts` is **empty**;
      `DocumentView.vue`'s row-click comment no longer claims a publication that does not happen.
- [ ] `grep -n "ArrowDown" src/renderer/workbench/ContextMenu.vue` finds the handler; every menu in
      the app — the cell editor's format picker included — is walkable and committable by keyboard,
      and `Escape` still closes.
- [ ] A `row` selection's first and last cells carry `sel-l`/`sel-r`; a `column` selection's first
      and last carry `sel-t`/`sel-b`; P42's 3×3 range assertions pass unchanged.
- [ ] A RabbitMQ stream tab's picker shows two options; a Kafka or SQS tab's shows four;
      `grep -rn "500" src/renderer/views/stream/StreamView.vue` finds only the existing strip text,
      never a hard-coded ceiling.
- [ ] `git diff` for this round touches **no** file under `src/main/storage/migrations/`,
      `src/preload/`, `biome.json`, or `package.json`, and adds no dependency. It touches
      `src/shared/caps.ts` in exactly two places for exactly one optional number (D46), and that is
      the only wire change in the round.
- [ ] **No `data-testid` was removed or renamed anywhere.** The set only grows
      (`grid-header-select`).
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bunx electron-vite build`
      clean after **every** commit; `sqlite`/`startup`/`smoke`/`connections`/`workbench` green
      **in this sandbox** after every commit; the full `test:ui` suite, `bun test tests/db` and
      `tests/electron-db/kafka.spec.ts` green on a box that can run them before the phase is called
      done.

---

## 8. What is left, and who owns it

**SPEC.md is written once, after this round's tenth commit — not during it, and not by any commit
in §4.** SPEC.md:1063's P43 row still reads *"Not yet planned — queued"*; it is the phase's own
record and it can only be written truthfully once all three iterations have landed. That edit is a
separate `docs(spec): record P43's three iterations` commit at the very end of iteration 3's
implementation, and it must cover:

1. **The §10 P43 row itself** — all three iterations in one row, the way P39's own row records its
   three (SPEC.md:1012 is the model): what each round found, how many commits each landed
   (11 / 12 / 10), and what remains unverified.
2. **Every §8 sentence this phase falsified.** At minimum, the P40 row's handed-forward pair
   (SPEC.md:1060's F14 and F22 — both fixed in iteration 1), the P41 row's `UploadObjectDialog`
   prefix bug (SPEC.md:1061 — fixed in iteration 1), and P42's own §8 items 1 and 3, which this
   round finally closes (commits 7 and 8). Any sentence still reading *"handed to P43"* after this
   phase is either done or must be re-pointed at P44 by name.
3. **The verification caveat, stated once and honestly** — that Docker-backed and Electron-native
   specs across all three iterations were written and typecheck cleanly but were never executed in
   the planning/implementation sandbox, and which ones a CI or macOS/Colima run still owes.

**The one thing this phase cannot close itself:**

4. **Iteration 2's commit 3 (`62a85b3`, the Kafka EOF/high-watermark clamp) has never been executed
   anywhere.** F34 re-read it adversarially and it is correct — the two ways a `w.next = w.end`
   clamp could lose messages are both unreachable, for the reasons written out in §1 — but a
   correct-on-reading diff against a native driver is not a passing test.
   `tests/electron-db/kafka.spec.ts`'s exhaustion scenario needs Docker **and** an
   `electron-rebuild` that can fetch Electron's C++ headers, and neither the plan-writing nor the
   implementation pass has had either in any of the three rounds. **Owner: whoever next runs CI or
   the macOS/Colima box.** It should be run before the phase is called finished, and the result
   recorded in the §10 row above.

**Handed to P44 (sparse unit tests) — this round shortens the list rather than growing it:**

5. Iteration 2 handed P44 four unit-test candidates (its §8 items 7–10). **Two of them are done
   here**: `useRunState` (item 8) is commit 2, and the `bun:sqlite` + `sqlite-proxy` harness commit 1
   builds is the route for anything else in `src/main/storage/repos/`. The remaining two stand:
   `generate.ts`'s `encodeUlidTime`/`toCrockford` (already covered end-to-end by
   `sqlite.spec.ts:215-226`, so this is about speed rather than coverage), and
   `views/shared/page/scan.ts`'s priority/cancel semantics with a fake `requestAnimationFrame` —
   which F36, F36a and F40 all touch and none of which any DOM-level assertion in this repo can
   reach deterministically.
6. **`redis/catalog.ts`'s `listNamespaceChildren` and `s3/catalog.ts`'s `listPrefixChildren` with a
   stubbed cursor**, to drive iteration 2's `truncated` flag without seeding 200 000 keys — still
   open, still the right shape, and now reachable through commit 1's harness pattern (both are plain
   async functions over a client object).
7. **Renderer view-state modules are testable through commit 2's route.** `views/*/state.ts` are
   plain modules over `bridge/data`/`bridge/control`, both of which are `window.kira` wrappers a stub
   can satisfy. F35's supersession guard and F37's cursor-strategy reload are both exactly the kind
   of ordering bug a fake-clock unit test pins and a Playwright test flakes on. Recorded as the
   highest-value thing P44 could build on what commit 2 proves is possible.

**Decided here, not deferred:**

8. **P42's §8 items 1 and 3 are done** (commits 7 and 8), after three rounds of being handed
   forward. Written down so a fourth phase does not inherit them.
9. **The whole-row/whole-column end caps are done** (commit 9), after being called cosmetic once.
   The distinction that changed the answer: it is not a missing polish, it is a P42-introduced
   affordance that is correct for two of its four selection kinds.
10. **The page-size-honesty question is closed by measurement** (F28/D47): the field nobody reads is
    documented as such, and the one thing a user could actually see is fixed (commit 10). No fourth
    phase should re-ask what `PagePosition.pageSize` means.
11. **`matchIndex` is left alone, on evidence** (F30/§6). Iteration 2 asked for a decision rather
    than a reflex; this is the decision, with the three reasons and the grep behind them.
