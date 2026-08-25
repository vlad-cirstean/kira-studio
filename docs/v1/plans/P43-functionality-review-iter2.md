# P43 (iteration 2) — Functionality review: pagination edges, cache lifetimes, and P42's own landing

> **Iteration 2 of three.** AGENTS.md's multi-pass convention: Opus researches and writes a plan,
> Sonnet implements it, three times, each round written against the tree the previous round
> actually left behind. Iteration 1 is complete, implemented, committed and pushed (eleven
> commits, `d78429a`…`ad3377c`); its plan is `docs/v1/plans/P43-functionality-review.md`. This file
> is round two. `-iter3.md` follows, written against what this round lands.
>
> **The phase, in the user's own words** (SPEC.md:1063): *"an in-depth review of the app's actual
> behavior (data handling, panel-to-panel communication, whether a state change is reflected
> everywhere it should be, error handling and how errors reach the user), frontend or
> engine/main, followed by real fixes"* and *"practically anything that could be a bug should be
> found and fixed no matter if it be FE or in between."*
>
> **This round corrects iteration 1's own imbalance, deliberately.** Iteration 1's §8 item 4 said
> plainly that *"the engine, `main/`, and the adapters' `read.ts` pagination edges got a lighter
> pass than the renderer this round"* — twelve of its thirteen findings were renderer-side — and
> handed iteration 2 the instruction to start there. It did. Every `read.ts` under
> `src/engine/adapters/` was read end to end against its own renderer caller, and three real
> pagination defects came out of it (F17/F18/F19), one of which silently returns the wrong page of
> data on the app's default Mongo view. The four SQL adapters were read the same way and are
> **clean**, which is recorded as a verified non-finding (F27) rather than left as an absence.
>
> **P42 landed between iteration 1's plan and this one.** `docs/v1/plans/P42-console-grid-celleditor-polish-batch.md`,
> seventeen commits (`7a787ac`…`8805fc9`), touching exactly the files iteration 1 warned it would.
> Iteration 1's §8 item 5 said *"iteration 2 is the first round that can review that work, and
> should."* It did: F20–F26 are seven findings in P42's own landing — including one shipped
> generator that does not produce what its label says (F22, arithmetic verified by running it) and
> one validation path that reddens a value the engine itself truncated (F21).
>
> **Thirteen verified findings and one verified *non*-finding.** Every one was confirmed by opening
> the file and reading the function at `ad3377c` — nothing here is "might be an issue." Candidates
> that did not survive that check are named in §6 with the reason, so iteration 3 does not re-open
> them. Iteration 1's own §6 list is **not** re-opened here either.
>
> **This plan asks for one wire-schema field, and says so loudly.** D21 widens
> `Adapter.children()` — the one thing `src/engine/adapters/adapter.ts:137-141`'s own roadmap
> comment says must be preceded by amending P1's plan §4b. That amendment ships in the same commit
> (commit 6). It is the only new field on any wire in this round, and §3's D21 carries the argument
> for why it is necessary rather than convenient.
>
> **Branch tip when this plan was written: `ad3377c` on `feature/kickoff`;
> `git status --porcelain` over the repo is empty apart from this file.** Every `file:line` below
> was read at that commit. Re-grep before editing; iteration 1 and P42 both moved things, and
> iteration 1's own line numbers are already stale.

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read in the tree at `ad3377c`.** Where a claim is about
  *absence* (nothing calls X, nothing clears Y) it was produced by a repo-wide grep over `src/`
  **and** `tests/`, and the grep and its actual output are pasted, not paraphrased.
- **A fix, not a workaround.** This phase may change behavior, so a finding is answered by making
  the code do the right thing — not by hiding a symptom, greying out a control, or adding a
  comment describing the defect.
- **Every behavior change carries its own spec edit in the same commit.** `tests/ui/sqlite.spec.ts`
  is the one DB-backed UI spec that runs for real in this sandbox (AGENTS.md's SQLite section), and
  four of this round's twelve commits are observable through it — those get **real, executed**
  coverage here rather than Docker-gated coverage nobody in this box can run. §5 says exactly
  which, and is blunt about the rest.
- **P39's layering rules stand.** `biome.json`'s seven `overrides` are unchanged by this phase
  (`python3 -c "…json.load…"` over `biome.json` → `overrides: 7`). Every import added below is
  `views/* → state/*`, `views/* → views/shared/*`, `views/shared/* → state/*` (the edge
  `views/shared/page/search.ts:2` already has) or engine-internal. No `views/ → project/`, no
  `views/ → views/<sibling>/`, no `project/ → views/`.
- **No new dependency, no new build step, no migration, no new IPC channel.** **One** new
  wire-schema field, called out loudly: `truncated` on `ENGINE_OP.children`'s result and on
  `TreeChildrenResult` (D21). It is `z.boolean().optional()`, so nothing stored or in flight
  becomes unparseable, and no `metadata_cache` row shape changes — the flag is deliberately never
  persisted (D22).
- **`data-testid`s are added, never removed or renamed.** New ones follow each view's existing
  prefix convention (`browse-truncated`, `cell-editor-generate-ulid` already exists, …).
- Comments per AGENTS.md: only where the code cannot say it for itself. Four existing comments
  become false as a result of this phase and are rewritten in the same commits that falsify them
  (`redis/read.ts:14`'s *"mirrors MAX_PAGE_SIZE discipline"*, `documents/state.ts:69-73`'s claim
  about what a bare `load()` re-fetches, `generate.ts:12-13`'s *"the same rule every Crockford
  base32 encoder … uses"*, `SearchToolbar.vue:240-243`'s claim that the branch order alone fixed
  the *"0 of N"* reading).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

F-numbers continue from iteration 1, which ended at **F13**. Decisions continue from **D18**.

### A. The three items iteration 1 explicitly handed to this round

**F14 — `state/runState.ts:38`'s newest-record-wins lookup makes the toolbar's ring read *idle*
while a slower op on the same tab is still running.** Iteration 1 named it in its own §6 and §8
item 1 and declined to change it on reading alone, asking for *"a genuine two-op race"*. Here is
that race, traced through the code rather than asserted.

`opsState.records` is **newest-started first**: `state/ops.ts:9` declares it so, `:24`'s
`unshift(record)` puts a newly started op at index 0, and `:22`'s `records[idx] = record` replaces a
running row **in place** when it finishes, so finish order never re-orders the array.
`state/runState.ts:38` then takes the *first* record whose `tabId` matches:

```ts
const record = opsState.records.find((r) => r.tabId === id);
```

Two ops for the same tab are trivially reachable and are not a contrived case:
`views/grid/DataToolbar.vue:110-112`'s `onCount` fires `void runCount(tab.id)` and `:103-105`'s
`onNext` fires `void goNext(tab.id)`, neither gated on the other being in flight, and both requests
carry the same `tabId` to the engine (`views/grid/state.ts:113` and `:198`, consumed by
`engine/data.ts:52` and `:97`). Trace a Σ on a large table followed by a page click:

| t | event | `records` (newest first) | `useRunState` reads |
|---|---|---|---|
| 0 | Σ starts (slow `count(*)`) | `[A running]` | A → **running** ✓ |
| 1 | ⏵ starts (fast page read) | `[B running, A running]` | B → running ✓ |
| 2 | B finishes | `[B done, A running]` | B → **idle**, elapsed = B's duration ✗ |

At t=2 the count is still running, and the toolbar's ring is off. Worse, the same toolbar
contradicts itself in the reverse ordering (a slow *load* plus a fast *count*): `toolbar-stop`'s
`:disabled="!rt?.opId"` (`DataToolbar.vue:249`) reads the load's own `rt.opId`, so Stop stays
enabled and tinted `is-live` red (`:246`) beside a `RunState` that says idle. The ticker itself is
not the problem — `runState.ts:11`'s `records.some(r => r.status === 'running')` keeps running, so
the shared interval is alive with nothing to drive. The bug is the *selection*, not the clock.

**F15 — `metadata_cache` has no row cap, no TTL and no per-connection budget; the only eviction is a
whole-connection wipe at connect time, and the SQLite file it lives in never shrinks.** Handed here
by P41 §8 item 2, restated by iteration 1's §8 item 2, untouched at the end of iteration 1.
**Confirmed real, with the blast radius established rather than assumed.**

Every level a Browse tab visits is written: `views/browse/state.ts:61`'s
`control.treeChildren(tab.connectionId, level, …)` is called by `load()`, and `load()` is reached
from `descend` (`:90-92`), `ascend` (`:95-102`) and `goToLevel` (`:105-107`) — i.e. once per level
navigated. That lands at `src/main/tree-service.ts:92`:

```ts
await putCached(db, connectionId, path, 'children', result.nodes);
```

`putCached` (`main/storage/repos/metadata-cache.ts:49-88`) upserts one row per
`(connection_id, path)` — the table's only unique index (`schema/metadata-cache.ts:16`) — capping
only the **per-row** payload at `MAX_PAYLOAD_BYTES = 4 * 1024 * 1024` (`:17`, `:71-78`). There is no
row count limit and no age check:

```
$ grep -n "limit\|count\|prune\|evict\|MAX_" src/main/storage/repos/metadata-cache.ts
17:const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
71:    if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
```

Eviction, in full — `grep -rn "putCached\|dropCached" src/main --include=*.ts` returns exactly two
non-declaration writers and three droppers, and only two of the droppers are automatic:
`main/connections.ts:215`'s `await dropCached(db, id)` on every **successful connect** (P1 D11's
metadata refresh), and the schema's `onDelete: 'cascade'` (`schema/metadata-cache.ts:9`) when the
connection record itself is deleted. So the honest statement — sharper than P41's own — is:
**bounded across sessions, unbounded within one.** A single connected session that browses a deep
S3 bucket or a wide Redis keyspace writes one row per level visited, each up to 4 MB, with nothing
reclaiming any of them until the next connect. And `main/storage/db.ts:64-67` sets `journal_mode`,
`synchronous`, `foreign_keys` and `busy_timeout` and **nothing else** — no `auto_vacuum`, and
`grep -rn "VACUUM" src/main` is empty — so even after the next connect deletes those rows, the
user's `kira.db` stays the size the browse grew it to, permanently.

The precedent for what is missing is in the same directory twice over:
`main/storage/repos/ops.ts:83-96`'s `pruneOps` (a retention window **plus** a `HARD_CAP_ROWS`
keep-newest-N delete) and `main/storage/db.ts:15`'s `STMT_CACHE_MAX = 200`, whose own comment reads
*"an uncapped cache would itself be an unbounded map."*

**F16 — a browsed level still truncates silently, and the truncated list is then written to disk and
served from there.** Handed here by P41 §8 item 1, restated by iteration 1's §8 item 3.
**Confirmed real, and worse than either write-up says.**

Both catalogs stop early and return what they have, with no signal of any kind:

- `engine/adapters/redis/catalog.ts:11` — `const MAX_SCAN_ROUNDS = 200;`, enforced at `:102`'s
  `} while (cursor !== '0' && rounds < MAX_SCAN_ROUNDS);`, after which `:104-107` simply returns
  the sorted partial list.
- `engine/adapters/s3/catalog.ts:15` — `const MAX_LIST_ROUNDS = 20;`, enforced at `:129`'s
  `} while (continuationToken && rounds < MAX_LIST_ROUNDS);`, then `:131-134` returns the partial
  list.

`TreeNode` has no field to carry it, and neither does the `Adapter` contract:

```
$ grep -rn "MAX_SCAN_ROUNDS\|MAX_LIST_ROUNDS\|truncated" src/shared/domain/tree.ts src/engine/adapters/adapter.ts
(no output; exit 1)
```

`treeNodeSchema` (`shared/domain/tree.ts:75-82`) is `kind`/`name`/`path`/`hasChildren`/`detail`/
`badges`, and `Adapter.children` (`adapter.ts:80`) is
`children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]>`.

**The compounding half neither previous write-up noticed:** the partial list does not just get
rendered once — it gets **persisted**. `main/tree-service.ts:78-93` is cache-aside, so the first
visit truncates, `:92` writes the truncated array into `metadata_cache`, and every later visit to
that level (including after an app restart — this is on-disk SQLite, not memory) serves the same
truncated list from `:79`'s `getCached` with no round trip at all. It stays that way until the user
happens to press Refresh on that exact level (`browse/state.ts:76-78`'s `reload` → `refresh: true`)
or reconnects the connection (F15's `dropCached`). A user who browses a 250 000-key Redis namespace
once sees a permanently short list and is given nothing that says so.

**P41 §6's stated blocker was re-read, in full, and it still stands** — but it is a *procedure*, not
a prohibition. `src/engine/adapters/adapter.ts:137-141`:

> *"Adapter roadmap (normative, D3). … A later phase that widens `Adapter` again does so by amending
> docs/v1/plans/P1-connections-and-tree.md §4b first, same discipline as this line."*

Two phases have now deferred this on that sentence. D21 does the amendment instead.

### B. The adapters' `read.ts` pagination edges (iteration 1's §8 item 4 — the underserved area)

Every `read.ts` under `src/engine/adapters/` was read end to end against the renderer state module
that drives it. Three defects, all in the non-SQL adapters, all silent.

**F17 — `mongo/read.ts` never applies `skip`, so every page jump, Last-page and post-reload page
restore on the app's *default* Mongo view silently re-fetches page one while the pager claims page
N.** The sharpest finding of this round. `engine/adapters/mongo/read.ts:96-98`:

```ts
  if (!idOnlySort && req.cursor.mode === 'offset') {
    findOptions.skip = safeInt(req.cursor.offset, 'offset');
  }
```

`idOnlySort` is defined at `:35-36` as *"no sort terms at all, or exactly one term on `_id`"* — i.e.
**the default state of every freshly opened Mongo document tab** (`defaultDocumentTabState`
(`shared/domain/tabs.ts:220-222`) sets `sort: null`). So on the common path the `skip` is skipped:
the query runs with `sort: { _id: 1 }`, `limit: pageSize + 1` and **no offset**, returning the first
page of the collection.

The renderer sends exactly that cursor, from four places in `views/documents/state.ts`:

- `goToPage` (`:206-212`) — `{ mode: 'offset', offset: index * pageSize }`;
- `goLast` (`:196-204`) — the same, at `(pageCount - 1) * pageSize`;
- `goNext`/`goPrev` (`:162-184`) whenever `rt.nextToken`/`rt.prevToken` is null — which is exactly
  what iteration 1's own D11 `resetTokens` (`:220-224`) *deliberately* leaves them as after any
  search/sort/projection/page-size change;
- **`load(tabId)` with no cursor at all** (`:74-77`), which is what `reload()` (`:125-130`) and
  therefore ↻ Refresh, the post-mutation reload and P43 iteration 1's own `reloadTabsForTarget`
  (`state/viewCommands.ts:93-108`) all call.

That last one makes `views/documents/state.ts:69-73`'s comment false in the case it was written
for. It claims the `pageIndex * pageSize` fallback *"is what keeps a bare `load(tabId)` (reload, or
any setter below) re-fetching the page the user is actually on instead of silently snapping back to
page one."* For a real (non-`_id`) sort it does. For the default `_id` view — the majority case —
`mongo/read.ts:96` throws the offset away and the tab snaps to page one anyway.

It compounds twice more inside the same function. `:137` still reports
`offset: req.cursor.offset` in the page position, so the page *claims* to start at row 500 while
holding rows 0–99. And `:126-131`'s `hasBackward` is `req.cursor.offset > 0`, so `:133` mints a
`prevToken` from `displayDocs[0]` — **the first `_id` in the whole collection** — meaning ◀ from
there asks for documents *before* the first one and returns an empty page.

`tests/db/mongo.spec.ts` could not have caught it:
`grep -n "mode: 'offset'" tests/db/mongo.spec.ts` returns only offset-`0` cursors, and
`tests/ui/mongo.spec.ts` never drives the page-jump input on a collection larger than one page.

**F18 — a Redis list page silently drops rows at every page boundary whenever the tab's page size
exceeds 500.** `engine/adapters/redis/read.ts:14`:

```ts
const LIST_WINDOW = 500; // LRANGE window cap, mirrors MAX_PAGE_SIZE discipline
```

used at `:228`: `const limit = Math.min(req.pageSize, LIST_WINDOW);`, then `:231`'s
`conn.lrange(key, offset, offset + limit - 1)`. The comment's claim is backwards: `req.pageSize` is
already bounded by the wire schema to `10 | 100 | 1000 | 10000`
(`shared/protocol/data-ops.ts:44`), and *every other adapter honours it* — this one clamps
**below** the caller's request and then reports the unclamped number back:
`:254-261` sets `pageSize: req.pageSize`, not `limit`.

The renderer advances by its own page size, not by what came back —
`views/keyvalue/state.ts:149-159`'s `goNext`:

```ts
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
```

and a list page mints no token at all (`redis/read.ts:258`, `nextToken: null`, `strategy: 'offset'`).
So on a 3 000-element list at page size 1 000:

| page | requested offset | LRANGE window | elements shown | elements skipped |
|---|---|---|---|---|
| 1 | 0 | 0–499 | 0–499 | — |
| 2 | 1 000 | 1 000–1 499 | 1 000–1 499 | **500–999** |
| 3 | 2 000 | 2 000–2 499 | 2 000–2 499 | **1 500–1 999** |

Half the list is unreachable, with no gap in the row numbers to hint at it (`:249-251` labels each
row `String(offset + i)`, so the gutter jumps from 1 499 straight to 2 000 — which is the *only*
visible trace, and reads as if the list itself has holes). At page size 10 000 it is 95 % of the
list. `hasMore` (`:253`) stays true throughout, so ⏵ keeps offering more.

The two page sizes above the clamp are both in the picker every key/value toolbar renders
(`views/shared/page/sizes.ts:8-13`, `1k` and `10k`).

**F19 — a Kafka browse that ended because every partition reached its end still reports `hasMore`
forever, so ⏵ serves empty pages indefinitely.** `engine/adapters/kafka/read.ts:300`:

```ts
    const hasMore = nextWindows.some((w) => BigInt(w.next) < BigInt(w.end));
```

`end` is the high watermark frozen at browse start (`:14-15`, `:142`), and `next` only advances past
offsets the consumer actually **delivered** (`:293`, `w.next = String(offset + 1n)`). The loop at
`:266` exits on any of four conditions, and two of them mean *"nothing more will ever arrive for
these windows"* without `next` having reached `end`:

- `allEof()` (`:264`) — every remaining partition raised `partition.eof`, which with
  `'enable.partition.eof': true` (`:224`) means the consumer's position **is** the high watermark;
- `emptyPolls >= MAX_EMPTY_POLLS` (`:270-272`) — D21's own *"a browse whose windows can never be
  filled."*

Both are reachable on entirely ordinary topics, because a Kafka partition's high watermark counts
offsets the consumer never receives: transaction commit/abort markers (any topic written by a
transactional or exactly-once producer), offsets removed by log compaction, and offsets aged out
mid-browse by retention. In every one of those cases the last real message sits below `end - 1`.

D21's detection machinery therefore works and its *conclusion* is thrown away: the loop stops, but
`:300` still says there is more, `:62` mints a `nextToken` from windows that can never advance, and
`views/stream/state.ts:179-183`'s `goNext` — gated only on `rt.nextToken` — happily sends it. The
next browse re-assigns the same partitions, gets EOF immediately, returns zero rows, and reports
`hasMore` again. The user gets an enabled ⏵ that produces an empty page every time, forever.

### C. P42's own landing (iteration 1's §8 item 5)

**F20 — three of the four cell-editor publishers never invalidate the cell they published when the
page under it changes; only the grid does.** The seam is `state/cellSelection.ts` (P26 D2/D3, one
`SelectedCell` record per tab). `DataGrid.vue:509-518` guards it properly, with `pageVersion.n` in
the watch's own dependency list and its own comment saying why:

```ts
watch(
  [() => rt()?.selection, () => pageVersion.n, () => props.tabId],
  () => {
    …
    if (!p || !t || !target || target.row < 0 || target.row >= p.rowCount) {
      clearSelectedCellFor(props.tabId);
```

The other three publishers have no equivalent:

```
$ grep -rn "clearSelectedCellFor" src/renderer/views/console src/renderer/views/keyvalue src/renderer/views/stream
(no output; exit 1)
```

Each publishes only from its own click handler and never again —
`views/console/ConsoleResultGrid.vue:202-208` (`publish`), `views/keyvalue/KeyValueView.vue:481`,
`views/stream/StreamView.vue:156`. Three concrete, reachable consequences:

- **Console.** `ConsoleView.vue:386-392` mounts one `ConsoleResultGrid` with `:page-key="rt.activeKey"`
  and **no `:key`**, so switching result chips swaps the prop on the same component instance.
  Neither the local highlight ref (`ConsoleResultGrid.vue:170`, `selected`) nor the published cell
  is reset — click a cell in Result 1, click Result 2's chip, and the dock still shows Result 1's
  value, over a grid that is now showing something else. Closing the result outright is the same
  story: `views/console/state.ts:91-102`'s `closeResult` drops the page
  (`resultPages.ts:65-67`) and leaves the dock rendering a cell from a page that no longer exists.
- **Key/value.** `KeyValueView.vue:307-310` already has exactly the right watch — for a *different*
  piece of state (`objectDraft`), with a comment that states the general rule: *"A reload (this
  Save, a manual Refresh, a relaunch) means the row this draft was staged against no longer
  necessarily matches what's on screen."* The published cell is left out of it, so after ⏵/◀ or a
  Refresh the dock shows the previous page's row value against the new page's rows.
- **Stream.** `views/stream/state.ts:124` sets `rt.selectedRow = null` on every load, with the
  comment *"a fresh page invalidates whatever row index used to be selected"* — and the published
  cell is not cleared alongside it. So after a Poll the row highlight is gone and the dock still
  shows the *previous batch's* message body. The two halves of the same idea disagree inside one
  view.

**F20a — the console's document publisher hard-codes `truncated: false` for a value that can be
truncated.** `ConsoleResultGrid.vue:250-252`:

```ts
    value: doc.body,
    truncated: false,
```

`docRowAt` (`:155-157`) reads `resultPages.ts:122-129`'s `documentRow`, which returns `{ id, body }`
and drops the chunk's truncation state on the floor — even though the shared row model's own
`RowSource` type already carries it (`views/shared/document/rows.ts:15`,
`{ id: string; body: string; isTruncated?: boolean }`) and `views/documents/page.ts:27` supplies it.
A Mongo console result's bodies are cut at `DOCUMENT_TRUNCATE_BYTES` (`shared/protocol/page.ts:156`),
so this is not hypothetical — and F21 turns it into a visible false statement.

**F21 — a value the *engine* truncated is reported to the user as broken data.**
`views/shared/celleditor/CellEditorView.vue:265-267`:

```ts
const formatProblem = computed(() =>
  isNullValue.value ? null : validateFormat(effectiveFormat.value, doc.value),
);
```

`isTruncatedValue` exists three lines' worth above at `:53` and drives its own chip at `:375`
(`cell-editor-badge-truncated`) — and `formatProblem` does not consult it. Every non-`text` branch
of `validateFormat` (`views/shared/celleditor/validate.ts:66-89`) fails on a cut value **by
construction**:

| effective format | what truncation does | what P42 now prints |
|---|---|---|
| `json` | the closing brace was never fetched | *"broken JSON, invalid at offset N"* (`validate.ts:21`) |
| `xml` | the closing tag was never fetched | *"tags do not balance"* (`:26`) |
| `csv` | the last row is short | *"rows have inconsistent column counts"* (`:32`) |
| `base64` | length is no longer `% 4` | *"not a valid base64 value"* (`:49`) |
| `hex` | odd digit count | *"not a valid hex value"* (`:61`) |

And the detection path *routes truncated values straight into it*: `detect.ts:56-77`'s `detectJson`
deliberately returns `{ format: 'json', score: 0.35 }` for a value that opens `{` but does not
scan clean, with its own comment saying this exists so *"§6a's truncated-JSON case must still land
in the 0.35 bucket below, not fall through to plain text"* — and `detectText` (`:314-316`) scores
`0.1`. So 0.35 wins, `effectiveFormat` is `json`, and the panel reddens a value that is perfectly
valid on the server and was cut by `createTabularPageBuilder`'s own `MAX_CELL_BYTES`
(`shared/protocol/page.ts:153`, 64 KB). The user is told their data is broken, next to a chip
saying the app truncated it, with no action available in either direction.

**F21a — a reported offset is measured against a string the user is not looking at.**
`validate.ts:67` trims before validating (`const t = text.trim();`) and `:21`/`:37` then report
`scan.offset`/`first.from` as an offset into `t`. The buffer CodeMirror shows is `doc.value`,
untrimmed. A JSON column whose value begins with a newline and two spaces reports every offset three
characters short.

**F22 — `generate.ts`'s "ULID" is not a ULID: its timestamp field decodes to the wrong instant, off
by a factor of four.** `views/shared/celleditor/generate.ts:42-46` builds the 48-bit timestamp half
by running six big-endian bytes through `toCrockford` (`:14-28`), whose padding rule is
`:26`:

```ts
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
```

48 bits is nine full 5-bit groups plus **3 left over**, so the last character is the remaining three
bits shifted *up* by two — i.e. the value is padded at the **low** end. ULID's own encoding puts the
48-bit timestamp in a 50-bit field, left-padded with two zero bits, and reads MSB-first from the
top. The two disagree by exactly `<< 2`. Run against a fixed instant (`node`, the repo's own
functions copied verbatim):

```
repo   : 06CDKGCR00 (len 10)
canon  : 01K3CW3600
repo decodes to ms = 7024000000000 -> 2192-07-31T07:06:40.000Z
actual ms          = 1756000000000 -> 2025-08-24T01:46:40.000Z
random part len    = 16
```

The 80-bit random half is unaffected (80 is an exact multiple of 5, so `:26`'s branch never runs for
it) and the string is 26 Crockford characters, so it *looks* like a ULID and parses structurally —
which is what makes this worse than an obviously malformed value. Anything downstream that decodes
it as a ULID reads a timestamp 167 years in the future. `generate.ts:12-13`'s claim that this is
*"the same rule every Crockford base32 encoder (ULID's own reference included) uses"* is the false
statement; `:40-41`'s claim that the result is *"sortable by creation time"* happens to survive
(MSB-first with a trailing pad preserves order across equal-length strings), which is why nothing
caught it.

**F23 — a closed console result set never releases its parsed documents, and neither does a closed
document tab.** `views/shared/document/rows.ts:73` holds
`const tabRows = new Map<string, TabRows>();` — one entry per scope, each holding a `parseCache` of
fully-built `DocNode` trees (`:88-102`) plus a per-row `expandedPaths` set. Nothing ever deletes
from it:

```
$ grep -rn "tabRows.delete\|dropRows" src/renderer
(no output; exit 1)

$ grep -rn "resetRows" src/renderer
src/renderer/views/shared/document/rows.ts:165:export function resetRows(tabId: string): void {
src/renderer/views/shared/document/rows.ts:187: * below, for `resetRows`), and one circular edge is enough. …
src/renderer/views/documents/page.ts:2:import { resetRows, rowView } from '../shared/document/rows';
src/renderer/views/documents/page.ts:7:const store = createPageStore<DocumentPage>({ onSet: resetRows });
```

`resetRows` (`:165-172`) `.clear()`s an entry's two maps but never removes the entry itself, and it
is wired to exactly one caller: `documents/page.ts:7`'s `onSet`. The console never calls it at all.
So:

- **A closed console result set.** `console/state.ts:82`/`:97`/`:115`/`:130` each call
  `unregisterDocumentRows(result.key)`, which is only `rowSources.delete(scope)`
  (`rows.ts:25-27`). `tabRows` keeps every parsed document tree from that result for the life of
  the process, keyed under a `resultPageKey` (`console/state.ts:73-75`) that `nextSeq` guarantees is
  never reused — so it is not merely stale, it is unreachable garbage.
- **A closed document tab.** `rows.ts` registers no `registerTabRuntimeCleanup` handler of its own,
  so `state/tabs.ts`'s close path never reaches it either.

`window.__kiraRetainedBytes` cannot see any of it — `renderer/main.ts` sums page `byteSize` only,
the same blind spot iteration 1 recorded for the console decode cache (its §5, commit 2).

**F23a — the same for the console's own expansion set.** `ConsoleViewRuntime.expandedDocIds`
(`console/state.ts:29`) is keyed `${resultKey}:${docId}` and written by `toggleResultDocExpanded`
(`:53-58`). `grep -rn "expandedDocIds" src/renderer` returns five hits, all in that file, and none of
the four close paths touches it: closing a result set leaves one string per document the user ever
expanded in it, permanently, under a key nothing can ever match again.

**F24 — a cancelled scan still resolves, and its stale `.then` runs against the live tab.**
`views/shared/page/scan.ts:78-81` resolves on cancellation:

```ts
        if (cancelled) {
          resolve(matches);
          return;
        }
```

and `SearchToolbar.vue:95-99` registers an unconditional continuation on it:

```ts
  handle.done.then((matches) => {
    scanning.value = false;
    props.api.searchState[props.tabId] = { matches, index: matches.length > 0 ? 0 : -1 };
    if (autoScroll && matches.length > 0) emit('goToMatch', matches[0]);
  });
```

`startSearch` cancels the previous handle (`:63`) and immediately starts a new one, but the old
scan's `resolve` lands on the *next* animation frame — after the new scan is already running — so
the superseded continuation executes. Three real effects, all against the current query:

- `scanning.value = false` **while the new scan is still running.** The count then falls through to
  `SearchToolbar.vue:246-248`'s `entry`-based branch and renders `{{ entry.index + 1 }} of
  {{ entry.matches.length }}` over a partial `index: -1` publication — printing a growing
  *"0 of N"*. That is precisely the reading `:240-243`'s own P42 D38 comment says the branch
  reorder fixed; the reorder fixed the ordinary path and this path still reaches it.
- `emit('goToMatch', matches[0])` scrolls the viewport to a match of the **previous** query — the
  page-moves-under-the-user problem D23 exists to prevent.
- Worst: `close()` (`:128-134`) and `onUnmounted` (`:153-159`) both `cancel()` and then
  `clearSelectedCellFor`-equivalent `clearSearchState(props.tabId)` — and the cancelled scan's
  continuation then **re-populates `searchState[tabId]`** a frame later. `DataGrid.vue:560-566`'s
  `matchIndex` reads that record directly, so a find toolbar that has been closed (or a tab switched
  away from and back) leaves its highlights painted on the grid with nothing on screen explaining
  them and no way to clear them but re-opening find and closing it again at a quieter moment.

**F25 — Enter during a scan never advances past the first match, contradicting D38's own stated
intent.** `SearchToolbar.vue:86` rewrites the whole record on every progress tick:

```ts
        props.api.searchState[props.tabId] = { matches: [...soFar], index: -1, pending: true };
```

`goNext` (`:115-120`) computes `(e.index + 1) % e.matches.length` and writes it back into `e.index`
— and the next `onProgress` tick, one animation frame later, resets it to `-1`. So during a scan
(≈100 frames on a fetch-more'd page, per P42's own F29 arithmetic) every Enter press jumps to match
0. P42 D38's rationale says the opposite in as many words: *"`index: -1` while pending means
Enter/next still works (it jumps to the first match found so far), which is the behaviour someone
typing into a find box expects"* — it works once, and then keeps working *only* once.

**F26 — the grid's inline cell editor is a drag handle.** `DataGrid.vue:1517` binds
`@mousedown="onCellMouseDown(rowVm.row, cellVm.col, $event)"` on `.grid-cell`, and the inline editor
`<input class="cell-input">` inside it (`:1524-1533`) stops `click` — `:1531`'s `@click.stop` — and
**not** `mousedown`. So pressing inside an open inline editor to select its text runs
`onCellMouseDown` (`:783-798`): it replaces the tab's selection with `{ kind: 'cell', … }`, sets
`dragging = true`, attaches a `document` `mousemove` listener and starts the `autoScrollTick` rAF
loop (`:739-765`). Dragging across the text then fires `mouseenter` on the neighbouring cells
(`:801-804`) and builds a `range` behind the open editor, and reaching within
`AUTO_SCROLL_EDGE = 24` px of an edge scrolls the grid out from under the editor the user is typing
in. The value itself is safe (`onEditKeydown` (`:645-653`) stops propagation for every key, so
Ctrl/Cmd+C inside the input never reaches the grid's copy handler), which is why this reads as a
glitch rather than data loss — but it is a P42 D15 regression on a surface that had no pointer
handlers at all before (P42's own F12: *"`grep -n "mousedown\|mousemove\|mouseup"
src/renderer/views/grid/DataGrid.vue` returns **nothing**"*).

### D. One verified non-finding, recorded so iteration 3 does not re-open it

**F27 — the four SQL adapters' pagination is correct, read adversarially, end to end.** Iteration 1
handed this round `read.ts` explicitly, so the negative result is worth as much as the positives and
is written down rather than left as silence. `postgres/read.ts:56-250`,
`mysql-family/read.ts:47-220`, `sqlite/read.ts:70-228` and `clickhouse/read.ts:116-185` were each
traced against `views/grid/state.ts`'s own `goFirst`/`goNext`/`goPrev`/`goLast`/`goToPage`. What was
checked, and what it came out at:

- **The `pageSize + 1` probe and the last page.** `probedExtra`/`keptRows`
  (postgres `:190-191`, mysql `:168-169`, sqlite `:179-180`; clickhouse's streaming equivalent at
  `:166-173`) all cut to `pageSize` and use the extra row only as a boolean. `hasMore` on an exactly-
  full final page is correctly `false`, because the probe row is what proves otherwise.
- **The `before` flip.** `reverseRows` (postgres `:132`, mysql `:111`, sqlite `:127`) inverts every
  `ORDER BY` term, `buildKeysetPredicate` (`sql-text.ts:29-40`) mirrors the operator with
  `(mode === 'after') === (direction === 'asc')`, and both the builder (`builder.reverse()`) and the
  token source array (`displayRows`) are reversed back together — never one without the other.
- **`hasMore` after a backward page.** `rowCount === 0 ? false : mode === 'before' ? true :
  probedExtra` is right in all three branches: you cannot have navigated backward without leaving a
  forward page behind.
- **Cursor reuse across a changed question.** `requestFingerprint`
  (`sql-text.ts:85-87`) binds `{path, projection, filter, sort, pageSize}` into the token, and
  `decodePageToken` (`:65-83`) throws `E_QUERY` with a legible message on a mismatch, so a token
  minted under one `WHERE` can never silently serve rows under another. `computeEffectiveOrder`
  (`:165-215`) refuses keyset eligibility for a text sort, a mixed-direction sort, or a table with
  no tiebreaker, and every caller throws `E_UNSUPPORTED` up front rather than falling back silently
  (postgres `:72-77`, mysql `:63-68`, sqlite `:86-91`, clickhouse `:124-126`).
- **Hidden tiebreaker columns.** All three keyset adapters fetch tiebreaker columns the projection
  omitted and slice them back off before building the page (postgres `:83-96` / `:195`, mysql
  `:72-85` / `:173`, sqlite `:93-102` / `:184`), so a projection change can neither lose a token nor
  leak a column.
- **The one divergence found, and why it is not a bug.** `mongo/read.ts:47-52`'s fingerprint omits
  `projection` where the three SQL adapters include it. A Mongo projection changes neither which
  documents match nor their `_id` order, so a token reused across one still identifies the same
  boundary document; and `views/documents/state.ts:241-245`'s `setProjection` calls `resetTokens`
  regardless. Recorded so iteration 3 does not mistake the asymmetry for the defect.

The only pagination defects in the tree are F17/F18/F19, all in adapters whose paging is hand-rolled
rather than built on `sql-text.ts`. That is the shape of the answer, and it is worth stating.

---

## 2. Shapes introduced in this plan

**`src/engine/adapters/adapter.ts` — `children()`'s return type widens (D21). This is the plan's
one wire-facing change.**

```ts
/** P43 iter2 D21: a level listing plus whether the adapter stopped short of the whole thing.
 *  `truncated` is true only when the adapter hit its *own* round budget (redis/catalog.ts's
 *  MAX_SCAN_ROUNDS, s3/catalog.ts's MAX_LIST_ROUNDS) with more still to come — never for an
 *  ordinary complete listing, and never a guess. Optional so the seven adapters that cannot
 *  truncate say nothing rather than saying `false` eight times. */
export interface TreeChildren {
  nodes: TreeNode[];
  truncated?: boolean;
}

children(path: NodePath, ctx: OpCtx): Promise<TreeChildren>;
```

with the matching one-field widenings, each `optional()` so nothing already stored or in flight
becomes unparseable:

```ts
// src/shared/protocol/engine-ops.ts — engineOpResultSchema[ENGINE_OP.children]
z.object({ nodes: z.array(treeNodeSchema), truncated: z.boolean().optional() })

// src/main/tree-service.ts — TreeChildrenResult
export interface TreeChildrenResult {
  nodes: TreeNode[];
  source: 'cache' | 'server';
  /** D21/D22: never persisted — a cached level is by definition one that was cached, and D22
   *  refuses to cache a truncated one, so a `source: 'cache'` result is always complete. */
  truncated: boolean;
}
```

**`src/renderer/views/browse/state.ts` — one runtime field beside `nodes`:**

```ts
  /** D23: this level's listing stopped at the adapter's own round budget — the panel says so
   *  above the list, and Refresh is the only thing that can try again. */
  truncated: boolean;
```

rendered by `BrowseView.vue` as a third `MessageStrip`, beside the two iteration 1 left there
(`:190-196`):

```html
<MessageStrip v-if="rt?.truncated" tone="warn" icon="warning" data-testid="browse-truncated">
  This level stopped short of the full listing — Refresh to try again.
</MessageStrip>
```

**`src/main/storage/repos/metadata-cache.ts` — one cap and one eviction pass (D20), mirroring
`repos/ops.ts:83-96`'s own `HARD_CAP_ROWS` shape:**

```ts
/** D20: rows per connection. A Browse session walks one level per navigation and each row can be
 *  up to MAX_PAYLOAD_BYTES, so an uncapped table is an unbounded on-disk map — the same reasoning
 *  db.ts's STMT_CACHE_MAX already applies to the statement cache. Newest `fetched_at` wins;
 *  evicting a level only costs the round trip to re-fetch it. */
const MAX_ROWS_PER_CONNECTION = 200;
```

**`src/renderer/views/shared/document/rows.ts` — one export plus one registration (D32):**

```ts
/** Releases everything this module holds for one scope — a closed document tab, or a closed
 *  console result set whose key nothing can ever match again (F23). Distinct from resetRows(),
 *  which keeps the entry because the same scope is about to hold a *new* page. */
export function dropRows(scope: string): void;

registerTabRuntimeCleanup(dropRows); // a document tab's scope is its tab id
```

**`src/renderer/views/console/resultPages.ts` — `documentRow` reports truncation (D28):**

```ts
export function documentRow(
  key: string,
  row: number,
): { id: string; body: string; isTruncated: boolean } | null
```

which is already exactly `rows.ts:15`'s `RowSource` shape and `views/documents/page.ts:21-28`'s own
return type — so this removes a divergence rather than adding a concept.

**`src/renderer/views/shared/celleditor/validate.ts` — one parameter (D29/D30):**

```ts
/** `truncated` short-circuits to null: the value on screen is a prefix the engine cut at
 *  MAX_CELL_BYTES, so "invalid at offset N" would be a statement about the truncation, not the
 *  data, and the user has no way to act on it (the rest was never fetched). D30: a reported
 *  offset is measured against `text` as given, not against its trimmed form. */
export function validateFormat(
  format: CellFormat,
  text: string,
  truncated?: boolean,
): FormatProblem | null;
```

**`src/renderer/views/shared/celleditor/generate.ts` — the timestamp half gets its own encoder
(D31):**

```ts
/** ULID's timestamp field: the 48-bit millisecond value written into a 50-bit, 10-character
 *  Crockford field, MSB-first — i.e. **left**-padded with two zero bits. toCrockford()'s
 *  trailing pad is the wrong rule here and produced a timestamp four times too large (F22). */
function encodeUlidTime(ms: number): string;
```

---

## 3. Decisions

D-numbers continue from iteration 1, which ended at **D18**.

### The three inherited items

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | **`useRunState` prefers a *running* record for the tab over any newer finished one**, falling back to the newest record when none is running: `records.find(r => r.tabId === id && r.status === 'running') ?? records.find(r => r.tabId === id)`. | F14. The ring answers one question — *"is this tab waiting on the server?"* — and while any op for the tab is in flight the answer is yes, regardless of which one started last. Two `find`s over a ≤ 500-entry array (`ops.ts:5`) inside a `computed` is not a cost worth optimising, and it keeps the fallback's own semantics (the newest finished op's duration in the idle slot, LAW 12's *"idle keeps the last op's duration in the same slot instead of blanking it"*) byte-identical. Rejected: keeping a separate per-tab running counter — a second source of truth for something `opsState` already streams, and the exact drift `useRunState` exists to avoid. |
| D20 | **`metadata_cache` gains a per-connection row cap with oldest-`fetched_at`-first eviction**, applied inside `putCached`'s existing transaction. No TTL, no migration, no schema change. | F15. `fetched_at` is already on the row (`schema/metadata-cache.ts:13`) and already written on every upsert (`repos/metadata-cache.ts:79`), so the newest-N query needs nothing new. A cap rather than a TTL because staleness is not the problem this solves — P1 D11's connect-time `dropCached` already handles freshness, and a TTL would add a second, competing answer to "when is L1 stale". Per-connection rather than global so one heavily-browsed S3 connection cannot evict a small Postgres connection's whole tree. 200 is the same order as `db.ts:15`'s `STMT_CACHE_MAX` and `repos/ops.ts`'s own hard cap, and an evicted level costs exactly one round trip to get back. |
| D21 | **`Adapter.children()` returns `{ nodes, truncated? }`, and `docs/v1/plans/P1-connections-and-tree.md` §4b is amended in the same commit.** | F16, and the loudest thing in this plan. Two phases have now declined this citing `adapter.ts:137-141` — but that comment prescribes a *procedure* (amend P1's plan first), not a prohibition, and the alternative is to keep shipping a Browse panel that silently lies about what a level contains. There is no cheaper signal path: the truncation is known only inside `listNamespaceChildren`/`listPrefixChildren`, and every other channel out of an adapter is per-node. The cost is honest and bounded: one optional boolean on one engine-op result schema, eight adapters that wrap their existing return in `{ nodes: … }` unchanged, and two that also set the flag. Rejected: a synthetic `TreeNode` marker row (it would flow into `descend`, the filter, the row menus and every `nodes.length` in the panel); and a per-node `truncated` field on `treeNodeSchema` (truncation is a property of the *level*, and putting it on a node would mean writing it into `metadata_cache`, which D22 exists to prevent). |
| D22 | **A truncated level is never written to `metadata_cache`.** `tree-service.ts:92`'s `putCached` is skipped when the engine reports `truncated`; the flag itself is therefore never stored and `TreeChildrenResult.truncated` is always `false` for a `source: 'cache'` result. | F16's compounding half, and the part that actually stops the harm. A truncated listing is not a cheaper copy of the right answer — it is a *different, smaller* answer that today outlives the app restart that produced it. Not caching it means the next visit re-scans and may well succeed (a namespace that shrank, a bucket that was tidied), and the worst case is one extra round trip on a level the user already knows is incomplete. Storing the flag instead and honouring it on read was considered and rejected: it would keep serving a list the app knows is wrong, and it would put a field in `metadata_cache`'s payload that `treeNodeArraySchema` (`tree-service.ts:59`) has no place for. |
| D23 | **The Browse panel says so, once, above the list — a `MessageStrip` with `tone="warn"`, testid `browse-truncated`, naming Refresh as the retry.** The project tree ignores the flag entirely. | F16. The panel is the only surface that renders these levels (P41 D5 cut the tree at the container), and it already has the strip vocabulary for exactly this — iteration 1 added the second one to the same block (`BrowseView.vue:190-196`). `warn`, not `err`: nothing failed, the listing is real, it is just incomplete. The tree is left alone because no tree-rendered level can truncate — `postgres`/`mysql-family`/`sqlite`/`clickhouse`/`mongo`/`kafka`/`sqs`/`rabbitmq` catalogs enumerate bounded sets in one round trip, and Redis/S3 stop at the database/bucket (P41 D5). Adding a tree affordance for a case that cannot arise would be the dead-guarantee problem P40 F22 complained about. |

### The adapters' pagination

| # | Decision | Rationale |
|---|----------|-----------|
| D24 | **`mongo/read.ts` applies `skip` on *any* offset cursor with a non-zero offset**, dropping the `!idOnlySort` guard: `if (req.cursor.mode === 'offset' && req.cursor.offset > 0) findOptions.skip = safeInt(req.cursor.offset, 'offset');`. `views/documents/state.ts:69-73`'s comment is corrected in the same commit. | F17. An `_id`-sorted `find()` with `skip` is exactly as well-defined as an arbitrarily-sorted one — Mongo's own `skip()` has no relationship to which sort is in force — so the guard is not protecting anything; it reads like a leftover from when the keyset path was the only `_id` path. Keeping the `> 0` test means the ordinary first page still issues no `skip` at all, so the hot path is byte-identical. This does **not** change the keyset path: `wantsKeyset` (`:38`) is still the only thing that reads a token, and offset-mode still reports `strategy: 'keyset'` when `idOnlySort` (`:119`), which is correct — the tab *can* page by token from here, it just did not arrive that way. |
| D25 | **`LIST_WINDOW` is deleted; `readList` honours `req.pageSize`.** `:14`'s comment goes with it. | F18. The clamp is not "MAX_PAGE_SIZE discipline" — it *violates* it. `req.pageSize` is already a closed union of four literals validated at the port (`shared/protocol/data-ops.ts:44`), 10 000 is the same ceiling `postgres/read.ts:172`'s `LIMIT $n` and every other adapter accepts, and `LRANGE` over 10 000 elements is one round trip, not a crawl. Rejected: reporting the clamped size back in `position.pageSize` so the renderer could advance by it — the renderer advances by `tab.state.pageSize` (`keyvalue/state.ts:156`) by design across all four views, and making one adapter's page size mean something different from the tab's would be a second, silent vocabulary. Rejected: minting an offset continuation token — `readList` refuses non-offset cursors at `:224-226`, and inventing a token for a strategy that already has a perfectly good addressable position is a mechanism for its own sake. |
| D26 | **A partition that raised `partition.eof` is clamped to its own `end` before `hasMore` is computed.** In the `finally`-adjacent tail of `readTopic`, for each `w` of `cursor.values()` whose partition is in `eofPartitions`, `w.next = w.end`. The `emptyPolls` break is deliberately **not** treated this way. | F19. EOF from librdkafka means the consumer's position reached the partition's high watermark; since `end` was frozen from that same watermark at browse start (`:142`), EOF is a proof — not a heuristic — that nothing between `next` and `end` will ever be delivered. Clamping turns D21's existing detection into the answer it already implies, in three lines, with no new state and no new poll. `emptyPolls` is left alone on purpose: an empty poll without EOF is indistinguishable from a slow broker, and clamping on it would silently end a browse that was merely waiting. That case still ends the *loop* (unchanged) and still reports `hasMore` — which is now honest, because there genuinely may be more. |

### P42's landing

| # | Decision | Rationale |
|---|----------|-----------|
| D27 | **The console, key/value and stream publishers clear their published cell when the page under it changes — they do not re-publish it.** One `watch` each: `ConsoleResultGrid.vue` on `[() => props.pageKey, () => pageVersion.n]` (also resetting its own local `selected` ref), `KeyValueView.vue` folded into the existing `watch(page, …)` at `:307-310`, `StreamView.vue` on `() => pageVersion.n`. | F20. The grid re-publishes because it has a persistent `rt.selection` that survives a page change by design (`DataGrid.vue:505-509`'s own comment: *"the still-highlighted cell republish[es] against a *new* page … so the panel and the grid never disagree"*). These three have no such concept — their "selection" **is** the click, held in a local ref or `rt.selectedRow`, and a row index into a page that has been replaced identifies nothing. Clearing is therefore the honest operation, and it is the one `clearSelectedCellFor`'s own doc comment already names (*"a page whose rows no longer reach the selected index"*). Doing it in the view rather than centrally in `state/tabs.ts` keeps the decision with the code that knows what a page change means for its own surface — the same reasoning D8 used for the mutation catches. |
| D28 | **`resultPages.ts`'s `documentRow` returns `isTruncated`, and `ConsoleResultGrid.vue`'s `selectDocumentRow` publishes it.** | F20a. The field already exists on both sides of this call — `rows.ts:15`'s `RowSource` declares it optional, `views/documents/page.ts:27` supplies it, and only the console's copy drops it — so this closes a divergence between two functions P42 D9's own F7 called *"the same function"* apart from this field. It is also load-bearing for D29: without it, a truncated Mongo console document is the one case where the panel has no way to know. |
| D29 | **`validateFormat` takes `truncated` and returns `null` for a truncated value.** The `cell-editor-badge-truncated` chip is left as the whole statement; no second chip, no softened wording. | F21. The panel must not tell the user their data is broken when the app is the thing that cut it — that is a false statement about the server's contents, and it is unactionable in both directions (the rest was never fetched, and `readOnlyReasonFor`'s `'value-truncated'` branch (`CellEditorView.vue:98-99`) already refuses the write anyway). Suppressing rather than rewording is the right shape because there is nothing honest a validator can say about a prefix: "valid so far" is not a claim `scanJson` makes, and a third state on `FormatProblem` would be a vocabulary for one caller. The truncated chip is already visible and already says exactly what happened. |
| D30 | **A `FormatProblem`'s `offset` is reported against the untrimmed `text`**, by adding back the leading-whitespace length `validate.ts:67` strips. | F21a. The offset's only consumer is the user reading it against the buffer CodeMirror renders, which is `doc.value` verbatim. Keeping the trim (the detectors all trim, and `scanJson`/`lintSql` deserve a clean start) and correcting the reported number is one line and leaves every validator's own behaviour untouched. |
| D31 | **The ULID timestamp gets its own 10-character, 50-bit left-padded encoder; `toCrockford`'s trailing-pad branch is deleted.** `generate.ts:12-13`'s and `:40-41`'s comments are rewritten to state the two encodings' actual rule. | F22. A generator labelled "ULID" that emits a string decoding to the year 2192 is wrong in the way that matters most for a DB client — it is *plausible*, so it gets written into a column and read back by something else. Splitting the two encodings is what makes the fix provable rather than fiddly: the 80-bit random half is an exact multiple of 5 bits and needs no padding at all, so after the split `toCrockford`'s `if (bits > 0)` branch is unreachable, and deleting it removes the rule that caused this rather than leaving it beside the corrected caller. Rejected: a ULID dependency (P42 D29 already refused one, correctly — this is fifteen lines). |
| D32 | **`rows.ts` gains `dropRows(scope)` and registers it as a tab-runtime cleanup; `console/state.ts` calls it beside every existing `unregisterDocumentRows(result.key)`, and prunes that result's `expandedDocIds` entries in the same four places.** | F23/F23a. `unregisterDocumentRows` is deliberately *not* widened to do this: `DocumentView.vue:483-487` calls it on **unmount**, which happens on every tab switch, so folding the drop into it would throw away a document tab's whole parse cache every time the user looks at another tab — trading a leak for a re-parse of the entire page. A separate `dropRows` lets each caller say which it means: the console says "this scope is gone forever", the document tab says nothing (its `registerTabRuntimeCleanup` handles the real close). `expandedDocIds` is pruned by prefix (`${key}:`) rather than rebuilt, because the set is keyed by result and a result's keys are contiguous under one prefix by construction (`resultPageKey`). |
| D33 | **The find toolbar ignores a resolution from a handle it has already replaced**, by capturing the handle in a local and testing identity inside its own `.then`. `scan.ts`'s cancel-resolves-partial contract is left exactly as it is. | F24. The fix belongs in the consumer, not the driver: `runChunkedScan`'s `done` resolving with the partial list on cancel is a *useful* contract (it is how `cancel()` can be awaited at all, and P39 F10 recorded it as one of the semantics the three scanners already shared), and making it never resolve would leave a pending promise for every keystroke. An identity test is three lines, is local to the one place that can know a scan was superseded, and covers all three symptoms at once — including the close/unmount resurrection, where the "newer handle" is simply `null`. Rejected: a global `unhandledrejection`-style guard, and clearing `searchState` again on a timer — both are the workaround-not-a-fix shape §0 forbids. |
| D34 | **A pending publication preserves the match index across main-pass ticks and resets it only for the priority tick**, discriminated on `rowsScanned === 0` (which `scan.ts:104` uses for the priority report and every main-pass chunk reports non-zero for on a non-empty page). | F25, and it is a correctness argument, not a preference: during the main pass `soFar` is strictly append-only and ascending, so an index into it keeps pointing at the same match as it grows; across the priority→main-pass transition the array is *replaced* (`scan.ts:57-59`'s own note), so an index into the priority window's own list is meaningless and must reset. Discriminating on `rowsScanned` uses a value already in `onProgress`'s signature rather than adding a fifth argument or a phase enum. |
| D35 | **The inline cell editor's `<input>` stops `mousedown`**, alongside the `@click.stop` it already carries (`DataGrid.vue:1531`). | F26. One modifier, the same idiom two lines above it, at the exact boundary where the two gestures diverge — pressing inside an open editor is a text selection, pressing on a cell is a drag-select. Rejected: an `if (isEditing(row, col)) return` guard inside `onCellMouseDown` — it would put knowledge of the editor into the drag handler and would still let the press through to the *cell*, replacing the tab's selection under the open editor. `stopPropagation` does not `preventDefault`, so focus and native text selection inside the input are untouched. |

---

## 4. Implementation order

Twelve commits. Each is one sitting, independently reviewable, leaves `lint`/`typecheck` (node,
web, db, electron-db)/`build` green, and carries the spec edits for the behavior *it* changes.
Ordering: the three adapter fixes first (they are the ones iteration 1 asked for and they touch
nothing else), then the two cache/lifetime items, then the truncation widening, then P42's landing.
No commit depends on another except 8 on 7 (D29's suppression reads the `truncated` flag D28 makes
correct for a console document).

1. **`fix(mongo): a page jump on an unsorted collection actually skips`** — D24.
   `engine/adapters/mongo/read.ts:96-98` (the `!idOnlySort` guard replaced by an
   `offset > 0` test); `views/documents/state.ts:69-73`'s comment corrected to say what the
   fallback cursor now actually does. **Spec edits in this commit:** `tests/db/mongo.spec.ts` gains
   a scenario that seeds more than one page, reads `{ mode: 'offset', offset: pageSize }` with
   **no sort**, and asserts the returned `_id`s are the *second* page's — the assertion that fails
   against today's tree; `tests/ui/mongo.spec.ts`'s document-tab block gains a page-jump step
   (type `2` into the pager, assert the first row's `_id` changed). Both Docker-gated — §5.
2. **`fix(redis): a list page honours the page size the user picked`** — D25.
   `engine/adapters/redis/read.ts` (`LIST_WINDOW` and its `:14` comment deleted, `:228`'s
   `limit` becomes `req.pageSize`). **Spec edits in this commit:** `tests/db/redis.spec.ts` — seed a
   list longer than 500 (`fixtures/0004_redis_seed.ts`'s `LIST_LENGTH` raised, or a second longer
   list key added beside it, whichever keeps the existing assertions intact), read page 0 at
   `pageSize: 1000`, assert `rowCount` is the full 1 000 and that the first row of page 1 is element
   1 000, not 500. Docker-gated.
3. **`fix(kafka): a browse that reached every partition's end stops offering a next page`** — D26.
   `engine/adapters/kafka/read.ts:296-301` (EOF partitions clamped to `end` before `hasMore`).
   **Spec edits in this commit:** `tests/electron-db/kafka.spec.ts` gains a scenario that browses a
   topic to exhaustion and asserts the final page's `position.hasMore` is `false` and its
   `nextToken` is `null`. Docker **and** native-driver gated — the one commit in this round that
   cannot be executed anywhere in this sandbox at all (AGENTS.md's Kafka section); §5 says so.
4. **`fix(toolbar): a running op is never masked by a faster sibling on the same tab`** — D19.
   `state/runState.ts:34-46` only. No spec edit — §5 explains why no assertion in this repo can
   observe it deterministically, rather than pretending one can.
5. **`fix(storage): the metadata cache keeps a bounded number of levels per connection`** — D20.
   `main/storage/repos/metadata-cache.ts` (`MAX_ROWS_PER_CONNECTION`, an eviction pass inside
   `putCached`'s existing `db.transaction`). No schema change, no migration —
   `git diff --stat src/main/storage/migrations/` must be empty. No spec edit — §5 is blunt about
   why (there is no IPC channel that can read `metadata_cache`, and `openDb()` hard-codes
   `dbPath()`, so a Docker-free bun:test over it would need a refactor this commit does not do).
6. **`feat(browse): a level that stopped short of the full listing says so`** — D21/D22/D23.
   `engine/adapters/adapter.ts` (`TreeChildren`, the `children()` signature, the roadmap comment
   updated to record that P1 §4b was amended); the ten `children()` implementations
   (`clickhouse:87`, `kafka:55`, `mongo:69`, `mysql-family:101`, `postgres:82`, `rabbitmq:96`,
   `redis:62`, `s3:63`, `sqlite:83`, `sqs:60` — eight wrap their existing return in `{ nodes: … }`
   unchanged; `redis` and `s3` also thread a `truncated` flag out of `listNamespaceChildren`/
   `listPrefixChildren`, which return `{ nodes, truncated }` from the same loop that already counts
   `rounds`); `engine/control.ts:80-88`; `shared/protocol/engine-ops.ts:80`;
   `main/tree-service.ts` (`TreeChildrenResult.truncated`, and `:92`'s `putCached` skipped when
   truncated); `shared/protocol/ipc.ts`'s `TreeChildrenResult` import site needs no edit (it
   re-exports main's type); `views/browse/state.ts` (`truncated` on the runtime, set in `load`);
   `views/browse/BrowseView.vue` (the strip, testid `browse-truncated`);
   `project/state/tree.ts:103` ignores the new field explicitly. **Spec edits in this commit:**
   `docs/v1/plans/P1-connections-and-tree.md` §4b — the amendment `adapter.ts:137-141` requires,
   recording the widening and its reason; `tests/db/redis.spec.ts` and `tests/db/s3.spec.ts` each
   assert `truncated` is absent/false for an ordinary level (the guard that eight adapters and the
   normal path are unchanged); `tests/ui/redis.spec.ts` asserts `browse-truncated` has count 0 on a
   small namespace. Driving a *true* truncation needs 200 000 keys or 20 000 objects and is
   deliberately not seeded — §6.
7. **`fix(celleditor): a page change clears the cell the panel is still showing`** — D27/D28.
   `views/console/ConsoleResultGrid.vue` (the watch, the `selected` reset, `selectDocumentRow`'s
   `truncated`); `views/console/resultPages.ts:122-129` (`documentRow` returns `isTruncated`);
   `views/keyvalue/KeyValueView.vue:307-310` (the existing watch gains `clearSelectedCellFor`);
   `views/stream/StreamView.vue` (a `pageVersion` watch); `state/cellSelection.ts:55-57`'s doc
   comment gains the fourth case it now genuinely has. **Spec edits in this commit:** a new step in
   `tests/ui/sqlite.spec.ts`'s existing console block — run two statements to get two result chips,
   click a cell in the first, assert `cell-editor-panel` is visible, click the second chip, assert
   `cell-editor-panel` has count **0**. **Runs for real in this sandbox.** Plus `tests/ui/redis.spec.ts`
   and `tests/ui/sqs.spec.ts` for the key/value and stream halves (Docker-gated).
8. **`fix(celleditor): a truncated value is not reported as broken`** — D29/D30.
   `views/shared/celleditor/validate.ts` (the `truncated` parameter, the offset correction);
   `views/shared/celleditor/CellEditorView.vue:265-267` (passes `isTruncatedValue.value`).
   **Spec edits in this commit:** a new step in `tests/ui/sqlite.spec.ts`'s console block — run
   `SELECT '{' || hex(zeroblob(40000)) AS big`, click the cell, assert
   `cell-editor-badge-truncated` is visible, `cell-editor-panel` carries `data-format="json"`, and
   `cell-editor-invalid` has count **0**. This needs no fixture change: the expression generates an
   80 001-byte value that the page builder cuts at `MAX_CELL_BYTES` and `detectJson` scores into its
   0.35 bucket, which is exactly F21's path. **Runs for real in this sandbox.**
9. **`fix(celleditor): a generated ULID is a real ULID`** — D31.
   `views/shared/celleditor/generate.ts` (`encodeUlidTime`, `toCrockford`'s trailing-pad branch
   removed, both comments rewritten). **Spec edits in this commit:** a new step in
   `tests/ui/sqlite.spec.ts` — double-click an `order_items` cell to open the cell editor, press
   `cell-editor-generate`, pick `cell-editor-generate-ulid`, read the staged value and assert in the
   test that its first ten Crockford characters decode to a millisecond timestamp within five
   minutes of `Date.now()` (the assertion that fails by a factor of four against today's tree), and
   that the whole string is 26 characters. **Runs for real in this sandbox.**
10. **`fix(views): a closed result set releases its parsed documents`** — D32.
    `views/shared/document/rows.ts` (`dropRows`, the `registerTabRuntimeCleanup` registration);
    `views/console/state.ts` (`dropRows` beside each of the four `unregisterDocumentRows` sites at
    `:82`, `:97`, `:115`, `:130`, plus the `expandedDocIds` prefix prune in the same four places).
    **Spec edits in this commit:** `tests/ui/mongo.spec.ts`'s console block — run a `find()`, expand
    a document, close the result chip, run it again and assert the new result's documents start
    **collapsed** (P42 D11's own default, which a surviving `expandedDocIds` entry cannot violate
    today only because the key changes — the assertion pins the intent). Docker-gated; the leak
    itself is invisible to every DOM assertion the suite can make, and §5 says so plainly.
11. **`fix(search): a superseded scan never publishes, and next keeps its place`** — D33/D34.
    `views/shared/page/SearchToolbar.vue` only (`:62-100`'s handle identity test, `:84-87`'s index
    preservation, `:240-243`'s comment corrected to name the second path that reached the "0 of N"
    branch). **Spec edits in this commit:** `tests/ui/data-view.spec.ts` — on a fetch-more'd page,
    type a query, close the toolbar while `search-count` still reads `…`, and assert
    `.search-match` has count 0 a second later (the resurrection assertion); and press Enter twice
    during a scan and assert the current match moved (D34). Docker-gated — §5 explains why the
    SQLite seed is too small to keep a scan in flight for a frame.
12. **`fix(grid): an open inline editor is not a drag handle`** — D35.
    `views/grid/DataGrid.vue:1531` (`@mousedown.stop` beside the existing `@click.stop`).
    **Spec edits in this commit:** a new step in `tests/ui/sqlite.spec.ts` beside P42's existing
    drag-select block (`:146-165`) — double-click a cell to open the inline editor, `mouse.down`
    inside `grid-cell-input`, `mouse.move` across two cells, `mouse.up`, then assert
    `grid-cell-input` is still visible and `.grid-cell.selected` has count **≤ 1**.
    **Runs for real in this sandbox.**

**Docs are deliberately *not* a commit here.** SPEC.md's §10 P43 row (SPEC.md:1063) and any §8
sentence this phase falsifies are written once, at the end of iteration 3, when the phase's own
outcome is known — the same way P39 recorded all three iterations in one row, and exactly what
iteration 1's own §4 said. **This plan file is the only doc this round commits**, with one named
exception that is not a spec edit but a required amendment: commit 6 also edits
`docs/v1/plans/P1-connections-and-tree.md` §4b, because `adapter.ts:137-141` makes that amendment a
precondition of the change rather than a record of it.

---

## 5. Verification

**Say plainly what this box can and cannot do.** Per AGENTS.md: `bun run lint`, `bun run typecheck`
and `bun run build` all run here. Playwright runs here **only** because the Electron binary is
installed by hand (`node_modules/electron/dist/electron`; if a fresh container loses it, re-install
with `curl` per AGENTS.md's "Electron binary" section). It must be invoked **directly** —
`bun run test:ui` fires `pretest:ui` → `scripts/native-electron-build.sh`, which cannot fetch
Electron's C++ headers through this environment's proxy and fails before a single spec runs. The
working invocation here is:

```
bun run build && xvfb-run -a bunx playwright test \
  tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts tests/ui/smoke.spec.ts tests/ui/connections.spec.ts
```

`workbench.spec.ts` and `secrets.spec.ts` also run clean and are worth adding when a change touches
layout or credentials. Every Docker-backed spec self-skips (image pulls return `403` through this
environment's proxy), and `bun test tests/db` cannot run here — with one nuance worth stating,
because this round has a `main/`-side commit: `tests/db/preconnect.spec.ts` is a **Docker-free**
`bun:test` against `src/main/` and does run, so "tests/db means Docker" is not quite true. It does
not help commit 5 (see below), but iteration 3 should know the door exists.

| Spec | Runs in this sandbox? |
|---|---|
| `tests/ui/sqlite.spec.ts` | **Yes, for real, unconditionally** — a real SQLite connection, a real tree, a real grid, a real cell editor and a real console. It is where commits 7, 8, 9 and 12 get executed coverage. |
| `smoke`, `startup`, `connections`, `workbench`, `secrets` | Yes (no DB). |
| `tests/db/preconnect.spec.ts` | Yes — a Docker-free `bun:test` over `src/main/preconnect.ts`. The only one. |
| `data-view`, `mutations`, `mongo`, `redis`, `s3`, `sqs`, `clickhouse`, `cell-editor`, `console`, `tree`, … | **No** — Postgres/Mongo/Redis/LocalStack/ClickHouse containers; they `test.skip()` cleanly rather than fail. |
| `tests/db/*` (except `preconnect`) | **No** — Testcontainers, same `403`. `tests/db/sqlite.spec.ts` additionally needs a Bun with `node:sqlite`, which this box's Bun lacks (AGENTS.md). |
| `tests/electron-db/kafka.spec.ts` | **No, twice over** — Docker *and* a native addon rebuilt for Electron's ABI, which `electron-rebuild` cannot fetch headers for here (AGENTS.md F20). |

**Be blunt about the consequence.** Four of this round's twelve commits (7, 8, 9, 12) are verifiable
here *for real* against SQLite. Commit 3 is verifiable **nowhere in this sandbox** — not even
partially — and must be run on the macOS/Colima box or CI before the round is called finished.
Commits 4 and 5 have **no executable assertion anywhere in this repo**, for reasons stated per-row
below rather than papered over. The rest are Docker-gated and typecheck-clean here only.

| Commit | What must be re-run green | What it pins |
|---|---|---|
| 1 | `typecheck` (all four) here; `tests/db/mongo.spec.ts` + `tests/ui/mongo.spec.ts` elsewhere | An offset cursor on an **unsorted** collection returns the page it asked for. The new `tests/db` assertion is the one that fails against today's tree — the existing suite's offset cursors are all `0`, which is exactly why this survived. The `> 0` guard means the first page still issues no `skip`, so the hot path is provably unchanged. |
| 2 | `typecheck` here; `tests/db/redis.spec.ts` elsewhere | Page 1 of a >500-element list at `pageSize: 1000` starts at element 1 000, not 500 — i.e. nothing between the pages is lost. Also that a 100-sized page is byte-identical to today (the guard that removing the clamp changed nothing below it). |
| 3 | `typecheck` here — **nothing else is runnable in this sandbox**; `tests/electron-db/kafka.spec.ts` on a box with Docker *and* a matching-ABI native build | A browse that consumed every available message reports `hasMore: false` and mints no token, even when the frozen high watermark sits above the last delivered offset. The `emptyPolls` path still reports `hasMore` — the assertion that D26 stayed narrow. |
| 4 | `typecheck` + `lint` here; **no spec, anywhere** | **Stated rather than faked:** the race needs two ops for one tab overlapping in wall-clock time with a deterministic finish order. Every engine `tests/ui` fixture answers a count and a page read in single-digit milliseconds, so a Playwright test would be a flake generator, and there is no renderer unit-test harness in the repo yet (that is P44). Verified by reading the diff against `state/ops.ts:9,22,24` and by the manual click-through's item 1. Handed to P44 in §8 as the cheapest possible unit test in the whole app: `useRunState` over a hand-built `opsState.records`. |
| 5 | `typecheck` (node) + `lint` here; **no spec, anywhere** | **Stated rather than faked:** no IPC channel exposes `metadata_cache`, and `main/storage/db.ts:50`'s `openDb()` hard-codes `dbPath()`, so even the Docker-free `preconnect.spec.ts` route cannot open a temp `KiraDb` without a refactor this commit deliberately does not do. Verified by reading the diff against `repos/ops.ts:83-96`'s own cap-and-evict shape, and by the manual click-through's item 2. The eviction query and the payload-cap early return must not interact — read them together. |
| 6 | `typecheck` (all four) + `build` here; `tests/db/redis.spec.ts`, `tests/db/s3.spec.ts`, `tests/ui/redis.spec.ts` elsewhere | **The widest commit in the round, so the guards are negative ones:** every one of the ten adapters still returns the same nodes in the same order; `truncated` is absent on every ordinary level; a `source: 'cache'` result is never truncated (D22); and `git diff` touches no file under `src/main/storage/migrations/`. The P1 plan amendment is part of the diff, not a follow-up. |
| 7 | `sqlite.spec.ts` **here, for real**; `redis.spec.ts`, `sqs.spec.ts` elsewhere | Switching console result chips leaves no cell editor open on a page that is gone. The key/value and stream halves are the same assertion after a page change and a Poll respectively. `cell-editor.spec.ts` re-run elsewhere is the guard that the **grid's** publisher — the one that re-publishes rather than clearing — is untouched. |
| 8 | `sqlite.spec.ts` **here, for real**; `cell-editor.spec.ts` elsewhere | A value the engine cut is never called broken. The `data-format="json"` half of the assertion is what proves the *detection* path still routes a truncated JSON value to `json` (P42's own intent) — the fix suppresses the error, not the format. |
| 9 | `sqlite.spec.ts` **here, for real** | The first ten characters decode to now, not to 2192. The 26-character assertion is what proves the random half is unchanged. This is the clearest pure-function candidate this round produces — §8 hands it to P44. |
| 10 | `typecheck` here; `mongo.spec.ts` elsewhere | **No spec can observe the leak directly** — `window.__kiraRetainedBytes` (`renderer/main.ts`) sums page `byteSize`, not parse caches, so a dropped `tabRows` entry and a retained one report the same number, the same blind spot iteration 1 recorded for the console decode cache. Verified by reading, plus the collapsed-by-default assertion as the behavioural guard that the prune did not take live state with it. Stated rather than papered over. |
| 11 | `typecheck` here; `data-view.spec.ts` elsewhere | A closed find toolbar leaves no highlights; Enter twice during a scan lands on match 2. Both need a page big enough to keep a scan in flight for more than one frame, which is `data-view.spec.ts`'s fetch-more'd Postgres page and not the SQLite seed's handful of rows — the honest reason this one is not in `sqlite.spec.ts` with its three siblings. |
| 12 | `sqlite.spec.ts` **here, for real** | Text selection inside an open inline editor builds no grid range and scrolls nothing. P42's own drag-select block (`sqlite.spec.ts:146-165`) re-run unchanged is the guard that the modifier did not break the gesture it was added to protect. |

**Manual click-through afterwards (a human or an agent on a box with real containers)** — five of
this round's twelve commits have no executable assertion at all, and two of the twelve are about
what happens *between* panels, which no single spec sees end to end:

1. On a large table, press Σ and immediately press ⏵. The ring keeps spinning until the count comes
   back — and Stop and the ring never disagree about whether anything is running.
2. Open a Redis or S3 connection and browse deep — twenty levels or more — then quit and relaunch
   and check `kira.db`'s size hasn't grown without bound. Reconnect and browse the same levels: they
   still load.
3. Open a Mongo collection with several thousand documents, no sort. Type `5` into the pager: the
   documents change, and the `_id`s are not the ones on page 1. Press ◀: page 4, not an empty page.
4. Open a Redis list with 3 000 elements at page size 1k, then press ⏵: the gutter runs 1 000, 1 001,
   1 002 — continuous with the page before it, no gap.
5. Browse a Kafka topic written by a transactional producer all the way to the end: ⏵ greys out
   rather than serving an empty page forever.
6. In a console, run two statements, click a cell in Result 1, then click Result 2's chip: the cell
   editor panel is gone, not showing Result 1's value.
7. Open a cell holding a value over 64 KB: a "truncated" chip, and **no** red "broken JSON".
8. Open the generators panel on any cell and pick ULID: paste the result into any ULID decoder — the
   timestamp is now, not the 22nd century.
9. Open a find toolbar on a very large page, type a term, and close the toolbar while the counter is
   still climbing: the highlights go with it and stay gone.
10. Double-click a cell to edit it and drag across its text: the text selects, the grid does not
    scroll, and no block of cells lights up behind the editor.

---

## 6. Explicitly out of scope

Iteration 1's own §6 list is **not** re-opened here; nothing in this round's reading produced new
evidence against any of it. New to this round:

- **Making the six non-transactional adapters' `mutate()` atomic** — iteration 1's D18, unchanged
  and still right. §8.
- **`rabbitmq/read.ts:15`'s `MAX_POLL_MESSAGES = 500` clamp** (`:88`). It looks like F18's twin and
  is not: a RabbitMQ poll is `strategy: 'batch'` with `hasMore: false` and `nextToken: null`
  (`:28-39`), so there is no next page to skip rows into — the user asks for 1 000 and gets 500, once,
  with nothing lost. The clamp also has a real protocol reason its own comment states (every message
  in a `basic.get` batch is held unacked until the batch finishes, F11), which `LRANGE` has no
  equivalent of. The cosmetic half — `position(req.pageSize)` reporting the unclamped number — is
  noted for iteration 3 rather than fixed blind. Same for `sqs/read.ts:45-56`.
- **`redis/read.ts:90-140`'s `readScanFamily` overshooting `req.pageSize`.** Its own comment
  (`:87-89`) declares it: whole SCAN rounds are accumulated rather than sliced, so a `pageSize: 10`
  request can return ~500 rows. Traced: it never *loses* a row (the cursor token resumes exactly
  where the round ended), the loop cannot spin (`COUNT` is 1 000 with no `MATCH`, so every round
  returns elements), and the only cost is a larger-than-asked page. That is a page-size-honesty
  question of the same family as the two above, not a data bug.
- **Seeding a genuinely truncated Redis namespace or S3 prefix** to drive commit 6's `browse-truncated`
  strip end to end. It needs >200 000 keys or >20 000 objects in a fixture every other spec in those
  files pays the setup cost for. The negative assertions (the strip is absent on a normal level, the
  flag is absent on eight adapters) are what commit 6 ships; the positive one is handed to P44 as a
  unit test over `listNamespaceChildren` with a stubbed `scan`.
- **`DataGrid.vue:1032-1035`'s selection-edge flags at the outer boundary of a `row` or `column`
  selection.** `isSelected` (`:481-493`) answers `true` for a `row` selection at any column, so
  `selEdgeLeft`/`selEdgeRight` are false at both ends and a whole-row selection draws no end caps
  (the mirror image for a column selection at the first and last row). P42's own acceptance item 10
  — *no seam is thicker than the outer edge* — is met; this is the opposite, purely cosmetic
  omission, and it is a design-system question rather than a functionality one.
- **`DataGrid.vue:560-566`'s `matchIndex` rebuilding its whole `Set` on every progress tick.** P42's
  partial publications turn one Set build per completed scan into one per animation frame, which for
  a page with M matches scanned in C chunks is O(M·C) inserts instead of O(M). Measured against the
  numbers in P42's own F29 (C ≈ 100 on a 200 000-row page) it is ~100 k inserts per frame at the tail
  — inside the frame budget `budgets.spec.ts` guards, and the fix (throttling publications, or an
  incremental Set) is a real design decision rather than a one-liner. Recorded with the arithmetic so
  iteration 3 can decide it on evidence rather than re-deriving it.
- **Candidates checked and discarded as *not* bugs**, recorded so iteration 3 does not spend the
  time again:
  - **`views/console/lint.ts:148-196`'s Mongo argument check** (P42 D12). Read in full against
    `ejson.ts:427-445`'s `parseShellValue`: bare strings, numbers, arrays, objects, unquoted keys and
    `ObjectId(…)`-style calls all parse, so the linter cannot redden valid console input — the
    failure mode P42's own D12 warned about. Its one real limitation (`MONGO_STATEMENT_RE` has no
    `m` flag, so only the first statement in the editor is checked) matches
    `mongo/console.ts`'s own single-statement grammar and is not a divergence.
  - **`engine/cache/pages.ts:17-33`'s `pageCacheKey` including the cursor verbatim.** Two offset
    cursors that F17 made return identical content produce two L2 entries — a consequence of F17,
    not a second bug, and it disappears with commit 1.
  - **`views/grid/state.ts:174-189`'s `reloadAfterMutation`** (iteration 1's D14/D18). Re-read end to
    end: the `scope: 'pages'` invalidate, the conditional `runCount`, and `reloadTabsForTarget`'s
    `exceptTabId` skip still compose the way iteration 1 argued they do.
  - **`state/tabs.ts`'s `skipUnchanged` split** — iteration 1's F13 settled it. Not re-opened.

---

## 7. Acceptance checklist

- [ ] `grep -n "status === 'running'" src/renderer/state/runState.ts` shows the lookup preferring a
      running record; the ring and `toolbar-stop` can no longer disagree about the same tab.
- [ ] `metadata_cache` holds at most `MAX_ROWS_PER_CONNECTION` rows per connection;
      `git diff --stat src/main/storage/migrations/` is empty.
- [ ] All ten `children()` implementations return `{ nodes, … }`; `redis` and `s3` set `truncated`
      when their own round budget cut the listing; `main/tree-service.ts` does not `putCached` a
      truncated level; `docs/v1/plans/P1-connections-and-tree.md` §4b records the widening, in the
      same commit.
- [ ] `grep -n "idOnlySort" src/engine/adapters/mongo/read.ts` no longer gates the `skip`; a page-2
      offset read on an unsorted collection returns page 2.
- [ ] `grep -n "LIST_WINDOW" src/engine/adapters/redis/read.ts` returns nothing; a list page at
      `pageSize: 1000` returns 1 000 rows and page 1 starts at element 1 000.
- [ ] A Kafka browse that reached every partition's end reports `hasMore: false` and `nextToken: null`.
- [ ] `grep -rn "clearSelectedCellFor" src/renderer/views` shows all four publishers — grid,
      console, key/value, stream.
- [ ] A value carrying `truncated` renders `cell-editor-badge-truncated` and **never**
      `cell-editor-invalid`; a non-truncated broken value still renders `cell-editor-invalid` with
      an offset measured against the untrimmed buffer.
- [ ] A generated ULID is 26 characters and its first ten decode to within minutes of now;
      `grep -n "if (bits > 0)" src/renderer/views/shared/celleditor/generate.ts` returns nothing.
- [ ] `grep -rn "dropRows" src/renderer` shows one definition, one tab-runtime registration and four
      console call sites; `expandedDocIds` is pruned wherever a result set is closed.
- [ ] Closing the find toolbar mid-scan leaves no `.search-match` behind; Enter twice during a scan
      advances.
- [ ] `grep -n "mousedown.stop" src/renderer/views/grid/DataGrid.vue` finds the inline editor's
      input; P42's own drag-select assertions still pass unchanged.
- [ ] `git diff` for this round touches **no** file under `src/main/storage/migrations/`,
      `src/preload/`, `biome.json` or `package.json`, and adds no dependency. It touches
      `src/shared/protocol/engine-ops.ts` in exactly one place, for exactly one optional boolean
      (D21), and that is the only wire change in the round.
- [ ] **No `data-testid` was removed or renamed anywhere.** The set only grows
      (`browse-truncated`).
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; `sqlite`/`startup`/`smoke`/`connections` green **in this sandbox**;
      the full `test:ui` suite, `bun test tests/db` and `tests/electron-db/kafka.spec.ts` green on a
      box that can run them before the round is called done.

---

## 8. What is left, and who owns it

**Iteration 2 does NOT write SPEC.md docs.** Per iteration 1's own plan, SPEC.md's §10 P43 row
(SPEC.md:1063) and any §8 sentence this phase falsifies are written **once, at the end of iteration
3**, when the phase's own outcome is known — the same way P39 recorded all three iterations in one
row. **This plan file is the only doc this round commits**, with the single named exception of
commit 6's amendment to `docs/v1/plans/P1-connections-and-tree.md` §4b, which is a precondition of
the code change rather than a record of it (`src/engine/adapters/adapter.ts:137-141` requires it).

**Handed to iteration 3 (to be re-verified against the tree this round leaves, not taken on trust):**

1. **Page-size honesty across the three clamping adapters.** F18 is fixed because it loses data;
   `rabbitmq/read.ts:88`'s clamp to 500 and `redis/read.ts:90-140`'s SCAN-round *overshoot* both
   leave `position.pageSize` reporting a number the page does not have (§6). Nothing is lost in
   either case, so it is a vocabulary question — but three adapters now answer "what does page size
   mean" three different ways, and iteration 3 is the round to settle whether `PagePosition.pageSize`
   means *requested* or *served*.
2. **`DataGrid.vue`'s `matchIndex` rebuilds its Set once per animation frame** since P42's partial
   search publications (§6, with the arithmetic). Inside the frame budget today; the fix is a real
   design choice (throttle the publications, or make the Set incremental) and deserves a decision
   rather than a reflex.
3. **`views/shared/document/DocumentTree.vue`'s scalar values never wrap and never scroll** — P42's
   own §8 item 1, still untouched. A long string in an expanded Mongo document is unreadable in
   place, now in the console as well as the data tab. The blocker is `rows.ts:190-200`'s
   measurement-free `rowHeight()`; the fix is a measured height or an explicit cap with an
   expand-in-place affordance. This has now been handed forward twice and should either be done or
   be declared out of scope for the phase.
4. **`ContextMenu.vue` has no keyboard navigation, for any menu in the app** — P42's own §8 item 3,
   and after P42 D27 one of its callers is the cell-editor format picker, a control that used to be
   a keyboard-navigable native `<select>`. Untouched here: it is an accessibility feature, not a
   bug in behavior, and this round's remit is the latter.
5. **The whole-row / whole-column selection's missing end caps** (§6) — cosmetic, recorded so it is
   decided rather than rediscovered.
6. **The three commits with no executable coverage anywhere** (3, 4, 5 — see §5). Iteration 3 should
   confirm, on a box that can run them, that commit 3's Kafka assertion actually passes, and should
   re-read commits 4 and 5's diffs rather than assuming a green typecheck meant anything about them.

**Handed to P44 (sparse unit tests) — this round produced four unusually clean candidates:**

7. **`generate.ts`'s `encodeUlidTime`/`toCrockford`** — pure, total, Vue-free by design (P42 D29's
   own stated intent), and F22 is the proof that a DOM-level assertion was never going to catch a
   wrong encoding of a right-looking string.
8. **`state/runState.ts`'s `useRunState`** — the cheapest possible unit test in the app: build an
   `opsState.records` array by hand, assert the ring. §5's commit-4 row explains why no
   integration-level assertion can do this deterministically.
9. **`redis/catalog.ts`'s `listNamespaceChildren` and `s3/catalog.ts`'s `listPrefixChildren` with a
   stubbed cursor**, to drive the truncation flag commit 6 adds without seeding 200 000 keys (§6).
10. **`views/shared/page/scan.ts`'s `runChunkedScan` priority/cancel semantics** — F24 and F25 are
    both frame-timing bugs in a driver that is otherwise pure, and both are trivial to pin with a
    fake `requestAnimationFrame`.

**Decided here, not deferred:**

11. **`Adapter.children()` is widened, and P1's plan is amended to say so** (D21). Two phases
    deferred this on a comment that prescribes a procedure rather than a prohibition; the procedure
    is followed in the same commit as the change. Written down so a fourth phase does not defer it
    again.
12. **A truncated level is not cached** (D22) — the difference between a listing that is short today
    and one that is short until the user thinks to press Refresh months from now.
13. **The four SQL adapters' pagination is clean** (F27). Iteration 1 handed this round `read.ts`
    explicitly; the negative result is recorded in as much detail as the positives, so iteration 3
    spends its adversarial reading somewhere new.
