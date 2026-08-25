# P39 (iteration 3) — Code modularity, reusability and overall cleanliness

> **Iteration 3 of three — the last one.** The user asked for this phase to run **three full
> rounds**: Opus researches and writes a plan, Sonnet implements it, repeated three times, each
> round working against the tree the previous round actually left behind. Iteration 1 is
> `docs/v1/plans/P39-modularity-and-cleanliness.md` (28 findings, 27 decisions, 18 commits);
> iteration 2 is `docs/v1/plans/P39-modularity-and-cleanliness-iter2.md` (27 findings, 30
> decisions, 17 commits). Both landed on `feature/kickoff`; the branch tip when this plan was
> written is `e8b5b3b`. There is no iteration 4 — §8 says plainly what is left and who owns it.
>
> **What this round was asked to settle.** Iteration 2's §8 queued five items: the
> `project/ ↔ views/` bidirectional dependency (its F22/D24), ClickHouse's missing NUL guard,
> `views/shared/`'s folder size, whether the Biome layering rule should extend beyond `views/*`,
> and two behavior questions it deliberately handed to P40. All five were re-opened for real —
> and every one of them was **measured in this box against `node_modules`, not reasoned about**:
> the layering-rule extension was written, run, and probed with deliberate violations (§1E), and
> that experiment turned up a trap that would have silently disabled the rule iteration 2 added.
>
> **Prior rounds' own claims were re-verified, not trusted.** Two held (iteration 2's F11 "the
> remaining per-view scaffolding is genuinely per-view" — re-checked, §1B F12; its F21 "`main/`
> yields no finding" — re-read a third time, §1D F19, and it still yields none, stated plainly
> rather than padded). **Two did not.** Iteration 2's D18 asserted the SQL `mutate.ts` files
> differ by "real dialect differences"; diffed line by line, three of them differ by **a
> placeholder string and one type parameter** (§1D F15). And its D3 promised `createSearchState`
> would "stop being exported from `pageScan.ts`" — it is still exported, and it has to be,
> because its caller is a different module (§1A F4).
>
> **This iteration changes no runtime behavior.** One step (§4.10–11) has real behavior *surface*
> — it changes which module calls which at runtime — and it is declared as such, given its own
> two commits, and pinned to named specs rather than folded into a cleanliness commit. One
> genuinely behavior-changing item was found and is **excluded**: ClickHouse's missing NUL-byte
> guard belongs to P40 (§6), and this plan does not smuggle it anywhere.

---

## 0. Ground rules for this phase

- **No behavior change, and that is still the acceptance criterion.** Every touched call site must
  produce identical output, identical DOM (including every `data-testid`), identical IPC traffic
  and identical persisted state before and after. Where a step changes *who calls what* rather than
  *what happens* (§4.10–11), it says so in its own decision and §5 names the specs that prove the
  outcome is unchanged.
- **Every finding below was read in the tree, and each carries a `file:line`** taken from
  `e8b5b3b`. This box has `node_modules` (`node_modules/.bin/biome --version` → `2.5.9`), so every
  claim that could be *executed* was executed and its output quoted (§1E in particular).
- **Verification ran in a throwaway copy, never in the repo.** Every experiment below ran against a
  `git ls-files`-copied tree in the session scratchpad with `node_modules` symlinked in;
  `git status --porcelain` over `/home/user/kira-studio` is empty apart from this plan file.
- **Move before merge; merge only where the duplication is real.** §3 carries **eleven explicit
  non-changes**, five of them re-verifications of an earlier iteration's decision that turned out
  to be right. Categories that turned up nothing say so (§1D F19 on `main/`, §1B F12 on the view
  components) instead of manufacturing a finding.
- **Extend the homes this codebase already has.** `engine/adapters/sql-text.ts`,
  `engine/adapters/sql-mutate.ts`, `engine/adapters/errors.ts`, `views/shared/` and
  `renderer/state/` are the destinations for every merge below. The one genuinely new concept is a
  **command registry in `renderer/state/`** — and `state/tabRuntime.ts:1-6` and
  `shortcuts/commands.ts:1-4` are two existing instances of exactly that inversion, so it is a
  third instance of an established pattern, not a new one.
- **No half-migrations (AGENTS.md).** A helper that is hoisted leaves no copy behind; a module that
  moves takes every importer and every comment that names it in the same commit.
- **No new dependency, no new build step.** One new `renderer/state/` module, one new
  `views/definition/` module, one new `views/shared/page/` folder, four new `biome.json` overrides.
  Nothing added to `package.json`.
- **`tests/db/` is not touched at all this round.** Iterations 1 and 2 each made exactly one
  NUL-escape fix there; there is nothing of that kind left (`file $(git ls-files 'src/*'
  'tests/*')` reports no non-text file anywhere in the repo — re-verified). No new tests, no
  restructuring, in `tests/db/` or anywhere else.
- Comments per AGENTS.md: only where the code cannot say it for itself. §4.13 **deletes or
  corrects** eighteen comments that name files which no longer exist, rather than rewriting them
  into something equally decorative.
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. What iterations 1 and 2's own moves left behind

**F1 — eighteen comments name five files or folders that no longer exist, and three of the five
were moved by P39 itself.** Produced by extracting every `path/name.ts|.vue` token from `src/` and
testing each against the tree:

| Dead path | Where it went | References |
|---|---|---|
| `grid/SearchToolbar.vue` | **deleted** by iteration 1 step 8 (D9) | `views/stream/StreamSearchToolbar.vue:21,28,38,91,97,117` |
| `grid/FilterHistoryMenu.vue` | `views/shared/FilterHistoryMenu.vue` (P31) | `views/shared/SavedListMenu.vue:6`, `views/stream/streamFilterHistory.ts:3`, `views/stream/StreamFilterHistoryMenu.vue:12,84`, `views/console/ConsoleSavedMenu.vue:13,115` |
| `views/celleditor/` | `views/shared/celleditor/` (**iteration 1 D3**) | `state/cellSelection.ts:4,22` |
| `views/grid/columns.ts` | `views/shared/columns.ts` (**iteration 1 D3**) | `state/settings.ts:13,16` |
| `shared/shortcuts.ts` | `shared/domain/shortcuts.ts` (**iteration 1 D5**) | `shortcuts/keys.ts:49`, `state/contextMenu.ts:15` |

Iteration 2's D6 fixed exactly this class of straggler — but only the single instance it happened
to trip over (`views/shared/searchFilter.ts:8`'s reference to the deleted `SearchToolbar.vue`).
Eighteen more survived in nine files, and six of them are in one file. A comment that points at a
path a reader cannot open is worse than no comment (AGENTS.md), and these are the ones a future
session will follow first.

**F2 — `views/grid/search.ts`'s re-export block is two-thirds dead, and the live third makes the
grid the only view that reaches the shared toggle indirectly.** `search.ts:4` imports
`isSearchFiltering`, `searchFilterState` and `setSearchFiltering` from `../shared/searchFilter`
purely to re-export them at `:11`. Repo-wide, per name:

- `searchFilterState` — **no importer at all** outside `views/shared/searchFilter.ts` itself.
- `isSearchFiltering` — imported from `../shared/searchFilter` by `PageSearchToolbar.vue:8`,
  `StreamSearchToolbar.vue:6` and `stream/search.ts:3`; from `./search`, by nobody.
- `setSearchFiltering` — imported from `../shared/searchFilter` by `KeyValueView.vue:30`,
  `StreamView.vue:25`, `DocumentView.vue:28`, `PageSearchToolbar.vue:8`,
  `StreamSearchToolbar.vue:6` — and from `./search` by exactly one file, `DataGrid.vue:49`.

So four view components import the toggle from its home and a fifth routes through its own search
module. The re-export's own stated purpose (`search.ts:8-10`: *"so this module's own public shape,
and every existing importer, is unchanged"*) was a P31 migration aid; the migration is three phases
old.

**F3 — the same module re-exports two types nobody imports, three times over.**
`export type { SearchHandle, SearchQuery };` at `views/grid/search.ts:7`,
`views/documents/search.ts:5` and `views/keyvalue/search.ts:6`. Every consumer of those two types
imports them from `views/shared/pageScan` directly — `PageSearchToolbar.vue:6` and
`views/shared/pageSearch.ts:1` are the only ones (verified by grepping both names across `src/` and
`tests/`). Iteration 1 created these lines when the types lived in each view's own module; the
types moved in the same commit and the re-exports did not follow.

**F4 — `createSearchState` is still exported from `pageScan.ts`, and iteration 2's D3 promised it
would not be.** D3: *"`createSearchState` stops being exported from `pageScan.ts` (it gains exactly
one caller: `createPageSearch`)."* It is exported at `pageScan.ts:96` and imported at
`pageSearch.ts:1`. The promise was not merely unkept — as stated it was **impossible**, because the
one caller lives in a different module. The honest version of D3's intent is a *move*, not an
un-export: `createSearchState` is about per-tab search *state* (a reactive record, a
`registerTabRuntimeCleanup`, a `matchedRowsOf` delegation), not about scanning, and it is the only
thing in `pageScan.ts` that is not the scanner. Moving it into `pageSearch.ts` — beside
`createPageSearch`, its only caller — makes it module-private and leaves `pageScan.ts` as exactly
one concern.

**F5 — seven exported constants have no importer anywhere in `src/` or `tests/`.** Iteration 2's
F26 caught twelve such *functions* ("the `export` keyword is the finding"); its scan did not cover
`export const`. Verified per name with a word-boundary grep over `src` and `tests`, each returning
its declaration plus intra-module uses only:

| Symbol | Site | Internal uses |
|---|---|---|
| `TIP_ATTR` | `workbench/state/tooltip.ts:18` | `:68,117,134,139,208,216,236` |
| `pendingState` | `views/grid/pendingChanges.ts:27` | eleven, `:30`–`:185` |
| `FILTER_ROW_CAP` | `project/filterTree.ts:67` | `:126` |
| `REQUEST_TIMEOUT_MS` | `engine/adapters/rabbitmq/query.ts:10` | `:59` |
| `MAX_POLL_MESSAGES` | `engine/adapters/rabbitmq/read.ts:15` | `:88` |
| `PRECONNECT_SETTLE_MS` | `main/preconnect.ts:41` | `:152` |
| `PRECONNECT_KILL_GRACE_MS` | `main/preconnect.ts:42` | `:98` |

`pendingState` is the sharp one: it is a `reactive()` store whose exported name invites a second
writer, while every one of its eleven uses goes through the accessor functions beside it.

**F6 — `searchFilter.ts:7-9`'s comment is still wrong after iteration 2 corrected it.** D6 fixed
the half that named a deleted file; the sentence now reads *"`views/grid/search.ts` keeps its own
`isSearchFiltering`/`setSearchFiltering`/`matchedRows` as thin re-exports so its public shape (and
`DataGrid.vue`/`PageSearchToolbar.vue`) is untouched by the move."* `views/grid/search.ts` does
**not** re-export `matchedRows` from here — its `matchedRows` comes from `createPageSearch`
(`grid/search.ts:49-59`), and `searchFilter.ts` exports `matchedRowsOf`, a different name with a
different signature. A comment corrected once and still describing a relationship the code does not
have is the argument for deleting it with F2's re-export block rather than editing it a third time.

### B. The renderer's remaining structural edge

**F7 — `project/ ↔ views/` measured again, and the codebase already contains a written decision
that the `project/ → views/` half is a violation.** The edges are exactly the ones iteration 2's
F22 found, unchanged:

- **`project/ → views/`, six edges** — `project/ProjectTree.vue:8-11` imports `reload` from
  `views/documents/state`, `views/grid/state`, `views/keyvalue/state` and `views/stream/state`
  (used at `:112,117,122,127`); `project/menus.ts:32` imports `runCount` from
  `views/documents/state` (used at `:471`) and `:33` imports `runCount`/`setFilter`/`setProjection`/
  `setSort` from `views/grid/state` (used at `:389`, `:743-744`, `:813`, `:823`).
- **`views/ → project/`, two edges** — `views/definition/ColumnsSection.vue:3` imports
  `columnsSectionMenu` from `project/menus`; `views/console/completion.ts:4` imports
  `rowKey`/`treeState` from `project/state/tree`.

What iteration 2 did not find is that **P33 already decided this question the other way, in a
comment, and then P39's own iterations left the contradiction standing.**
`state/objectStore.ts:11-13`: *"P33 D17: lives in `state/` (not `views/keyvalue/`) because
`project/menus.ts` must be able to open the upload dialog **without importing a `views/` module
sideways** (§11's dependency rule, F17)."* A whole module was relocated to avoid one
`project/menus.ts → views/` import, while two such imports sit at `menus.ts:32-33`. Either P33 D17
was wrong or those two lines are; they cannot both be right.

The other half of iteration 1's D23 is undermined too. D23 kept `columnsSectionMenu` in
`project/menus.ts` because moving it into `views/definition/` *"would trade a `views → project`
edge (which §11 does not forbid) for a `views/definition → views/grid` edge (which §11 does
forbid)"* — but the three actions it needs (`setProjection`, `setSort`, and `openDataTab`, which
already lives in `state/tabs.ts`) do not have to be reached by import at all.

**Load order was checked, because the fix depends on it.** Every one of the four view state
modules is reached by a chain of *static* ESM imports from the app entry:
`main.ts:3 → App.vue:18 → WorkbenchShell.vue:5 → MainView.vue:16-21 → {DataView.vue:18,
DocumentView.vue:65, KeyValueView.vue:36, StreamView.vue:45, ConsoleView.vue:22,
DefinitionView.vue:23} → ./state`. No `defineAsyncComponent`, no dynamic `import()` anywhere on
that path. Every view state module is therefore evaluated before the first render, let alone before
a tree row can be double-clicked — which is what makes a module-scope registry safe here in a way
`shortcuts/commands.ts`'s mount-scoped one would not be.

**F8 — `state/tabs.ts` and `main.ts` also import `views/`, and this is checked and **not** the
same finding.** Stated explicitly so a reader does not conclude it was missed.
`state/tabs.ts:28-33` imports five page modules (`views/console/resultPages`'s `dropForTab` plus
`drop` from `views/{documents,grid,keyvalue,stream}/page`) and `views/grid/pendingChanges`'s
`clearPending`; `main.ts:13-17` imports the same five stores' `totalRetainedBytes`. Three facts
separate these from F7:

1. **There is no back-edge.** Every one of those page modules imports only `@shared/protocol/page`,
   `vue`, `views/shared/pageStore` and (documents only) `./documentRows` — nothing from `state/`,
   nothing from `project/`. The `project/ ↔ views/` pair is answered in *both* directions; this one
   is not.
2. **One of `main.ts`'s five is irreducible.** `main.ts:48` exposes
   `window.__kiraGridRetainedBytes = totalRetainedBytes` — the grid store *specifically*, whose
   *"Grid-only, kept as-is so that assertion's meaning is unchanged"* note (`main.ts:24`) is what
   `perf.spec.ts:55` depends on. A registry cannot express "the grid's, by itself".
3. **`state/tabs.ts`'s explicit list is a documented decision** (`tabs.ts:37-42`: *"a plain no-op
   lookup miss for the stores a tab's own kind never touches"*). Replacing a compile-time-complete
   list with a registration-order-dependent one buys nothing here and loses the compiler's check
   that no store was forgotten.

`main.ts` is the composition root; wiring the parts together is what it is for. Left alone (D9).

**F9 — `views/shared/` is 17 files plus `celleditor/`, and seven of the seventeen are one
cluster.** Iteration 2's §8.4 flagged the size and asked iteration 3 to look deliberately.
Measured:

| Group | Files |
|---|---|
| **Paged-data-view plumbing** | `pageStore.ts` (65), `pageScan.ts` (112), `pageSearch.ts` (48), `pageSizes.ts` (14), `searchFilter.ts` (45), `columns.ts` (152), `PageSearchToolbar.vue` (301) |
| Vocabularies | `mongoVocabulary.ts`, `sqlIdent.ts`, `typeGlossary.ts` |
| Widgets | `DateTimePicker.vue`, `FilterHistoryMenu.vue`, `SavedListMenu.vue` |
| The edit-buffer pair | `useEditBuffer.ts`, `EditBufferActions.vue` |
| Composable / helpers | `useConnectionGate.ts`, `viewOp.ts` |
| Folder | `celleditor/` (8 files) |

The first group is not "seven files that happen to start with `page`" — it is a closed unit with
exactly one client set (`views/{grid,documents,keyvalue,stream,console}`), and its members import
each other (`pageSearch.ts:1 → pageScan`, `pageScan.ts:3 → searchFilter`,
`PageSearchToolbar.vue:6-8 → pageScan/pageSearch/searchFilter`). Iteration 1's D26 kept the folder
flat on the grounds that a `page/` subfolder *"would also want `searchFilter.ts` and `columns.ts`
moved into it"* — which is true, and is an argument for moving them, not against. Thirty-one import
lines across sixteen files reference these seven modules.

**F10 — `ensureRuntime` is written six times and its non-obvious invariant is written once.**
`views/{grid,documents,keyvalue,stream,console,definition}/state.ts` each declare
`const runtime = reactive({} as Record<string, XRuntime>)` and:

```ts
function ensureRuntime(tabId: string): XRuntime {
  if (!runtime[tabId]) runtime[tabId] = defaultRuntime();
  return runtime[tabId];
}
```

at `grid/state.ts:58`, `documents/state.ts:51`, `keyvalue/state.ts:46`, `stream/state.ts:58`,
`console/state.ts:34`, `definition/state.ts:37` — identical but for the return type. **Only the
grid's copy carries the seven-line comment explaining why the last line re-reads through the proxy
instead of returning the local object** (`grid/state.ts:59-65`: *"Returning the just-created local
object directly … would hand `load()` an unwrapped reference: every mutation this same `load()`
makes afterward … would bypass the proxy's `set` trap entirely, so no dependent render … would ever
be notified"*). Five modules silently depend on an invariant documented in the sixth. This is the
shape iteration 2's D4 already accepted for `eachMatch`: *"a one-line invariant with a subtle
failure mode written out three times with an identical comment. One copy is how it stays correct in
all three."* Here it is six, and the comment exists in one. `defaultRuntime()` genuinely differs
per view (six different runtime shapes) and stays six functions.

**F11 — `views/console/resultPages.ts` writes the same decode-memo five times in one 124-line
file.** `cell()` (`:77-82`), `documentRow()` (`:91-97` and `:98-102`) and `keyValueRow()`
(`:111-117` and `:118-122`) each open with `let x = entry.decodeCache.get(k); if (x === undefined)
{ x = cellText(...); entry.decodeCache.set(k, x); }`. `views/shared/pageStore.ts:54-63` is the
exact same body, once, behind a `cached(tabId, key, decode)` method — but the console's store
cannot use the factory (D7 of iteration 1: it holds a `Page` union and a `windowKey`, and its
`setVisibleWindow` clears the whole cache rather than pruning it). A module-private `cached(entry,
key, decode)` inside `resultPages.ts` collapses all five to one line each.

**F12 — the four large view components, re-measured, and iteration 2's D11 confirmed.** Line counts
at three points (`git show <rev>:<file> | wc -l`), where `c0b09b3` is the commit before iteration 1
started and `648bbc3` is the end of iteration 1:

| File | Pre-P39 | End of iter 1 | Today |
|---|---|---|---|
| `views/grid/DataGrid.vue` | 1795 | 1758 | **1752** |
| `views/documents/DocumentView.vue` | 1083 | 1088 | **1038** |
| `views/stream/StreamView.vue` | 1014 | 1010 | **993** |
| `views/keyvalue/KeyValueView.vue` | 962 | 960 | **942** |
| `views/grid/DataView.vue` | 231 | 235 | **214** |
| `views/console/ConsoleView.vue` | 350 | 350 | **334** |
| `views/definition/DefinitionView.vue` | 316 | 316 | **291** |
| `state/tabs.ts` | 627 | 557 | **557** |

Iteration 2's D7 (the connection gate) and D10 (the sort-document parser) did what iteration 1's
F22 predicted and iteration 1 itself failed to deliver — every view component is smaller than it
was pre-P39. What remains was re-checked candidate by candidate and each still fails on merit:

- `matchIndex` — the `Set` of `` `${row}:${col}` `` computed is byte-identical in
  `DataGrid.vue:540-546` and `KeyValueView.vue:479-489`; `DocumentView.vue:298-308` builds a
  `Map`-by-row instead (a document Match has no `col`). Two copies is where iteration 2's F11 set
  the threshold, and `isSearchMatch`/`isCurrentSearchMatch` on top of them genuinely differ (the
  grid maps display column → page column through `pageColumnIndexFor`, `DataGrid.vue:550,556`).
- The pager block — still exactly two sites (`DocumentView.vue:487,522` vs
  `DataToolbar.vue:96,105`), reading different tab sources.
- `pathPrefix`, `iconColor`, `onToggleSearch`/`onCloseSearch` — unchanged from iteration 2's F11;
  re-read, still three different strings, still two different colour fallbacks, still three lines.

No finding. These components are large because a data view is large.

### C. `src/preload/` — a folder neither prior iteration opened

**F13 — `preload/index.ts` writes the same subscribe/unsubscribe block nineteen times, in two
shapes, across a 218-line file.** Thirteen zero-argument signals:

```ts
onOpenSettings: (cb: () => void) => {
  const listener = (): void => cb();
  ipcRenderer.on(IPC.openSettings, listener);
  return () => ipcRenderer.off(IPC.openSettings, listener);
},
```

at `:48-52, :53-57, :58-62, :63-67, :68-72, :73-77, :78-82, :83-87, :88-92, :93-97, :98-102,
:103-107, :108-112`, and six payload-carrying ones with the same body plus a typed second
parameter at `:35-38, :43-46, :136-139, :141-146, :147-152, :171-175`. That is roughly **76 of the
file's 218 lines** spent restating one four-line pattern; the `.off()` line in each must name the
same channel and the same closure as the `.on()` line above it, and nothing but reading checks that
it does. The twentieth `ipcRenderer.on` (`:216`) is the MessagePort relay and is a genuinely
different thing — it postMessages `event.ports` and never unsubscribes.

`renderer/bridge/control.ts` was read for the same class of problem and has none: it is one line
per method, a deliberate typed passthrough over `window.kira` with a single `plain()` helper
(`control.ts:34-40`) already factored out.

### D. `engine/adapters/` — third pass

**F14 — `computeEffectiveOrder` is three copies of a ~50-line function, and one of the copies'
comments admits it while citing a rationale iteration 1 already overturned.**
`mysql-family/read.ts:56`, `postgres/read.ts:66`, `sqlite/read.ts:80`, each preceded by its own
`interface EffectiveOrder` (`:47`, `:56`, `:70`). Diffed as text over the whole function plus its
interface: **postgres and mysql-family are byte-identical**, and sqlite differs in **one
expression** — its tiebreaker chain appends the implicit rowid:

```ts
// postgres/read.ts:94, mysql-family/read.ts:84
const tiebreaker = target.primaryKey ?? target.uniqueKeys[0] ?? null;
// sqlite/read.ts:108-109
const tiebreaker =
  target.primaryKey ?? target.uniqueKeys[0] ?? (target.rowidColumn ? [target.rowidColumn] : null);
```

`mysql-family/read.ts:54-55` states the reason for the copy outright: *"identical logic to
`postgres/read.ts`'s `computeEffectiveOrder` — kept as a sibling copy rather than a shared helper
because it depends on each adapter's own `ReadTarget` shape."* That is word-for-word the argument
iteration 1's D17 rejected when it hoisted `resolveProjection`: *"Takes the column list rather than
each adapter's own `ReadTarget` — this reads only `ColumnMeta.name`/`.position`, and the four
`ReadTargets` genuinely differ otherwise."* `computeEffectiveOrder` reads `target.columns` and the
tiebreaker chain and nothing else; hand it `ColumnMeta[]` and an already-resolved
`string[] | null`, and all three copies collapse with one call site each
(`mysql-family/read.ts:113`, `postgres/read.ts:123`, `sqlite/read.ts:137`).

**F15 — the SQL row-op renderer is three copies of a 47-line block, and iteration 2's D18 said it
was not.** D18 diffed `mutate.ts` "pairwise" and concluded *"real dialect differences (placeholder
syntax `$n` vs `?`, `SqliteParam` vs `unknown[]`, a 3-segment vs 2-segment path shape)"*. Those are
the only differences, and two of the three are already parameterized elsewhere in this same
codebase. Diffing `postgres/mutate.ts:16-62` against `mysql-family/mutate.ts:14-60` and
`sqlite/mutate.ts:15-61` as text:

| vs postgres | Differences, complete |
|---|---|
| `mysql-family` | the comment block, and `return '?'` where postgres returns `` `$${params.length}` `` |
| `sqlite` | the comment block, `return '?'`, and `SqliteParam[]` where postgres writes `unknown[]` (four occurrences) |

`type ValueRenderer`, `literalRenderer`, `whereFromKey` and `renderRowOp`
(`postgres/mutate.ts:19,21,31,43` and the two mirrors) are otherwise character-for-character
identical, including the `IS NULL` handling, the `SET` clause join and the `INSERT INTO … VALUES`
shape — and each already takes `quoteIdent` implicitly from its own folder's `read.ts`, which is
one more parameter. **`sql-text.ts:29-40`'s `buildKeysetPredicate` already takes a
`placeholder: (i: number) => string` argument for exactly this reason**, so the pattern for
absorbing the one real difference is established, not invented. Two of the three copies'
own comments say what they are: *"Mirrors `postgres/mutate.ts`'s renderer exactly"*
(`mysql-family/mutate.ts:15`), *"Mirrors `mysql-family/mutate.ts`'s renderer exactly … one design
used by every SQL adapter"* (`sqlite/mutate.ts:16-17`).

ClickHouse is **not** in this set: `clickhouse/mutate.ts` renders insert-only batches through its
own `renderInsert`/`literalFor` (`mutate.ts:81-96`), which is a different statement shape, not a
different dialect of the same one.

**F16 — `resolveTablePath` is three identical copies that differ only in the name of a returned
property.** `mysql-family/mutate.ts:62`, `sqlite/mutate.ts:63`, `clickhouse/mutate.ts:27` are
character-for-character the same two-segment `database`/`table` path check with the same
`E_NOT_FOUND` message (`` `mutate requires a database/table path, got: ${encodePath(...)}` ``),
returning `{ database, table }` in one and `{ schema, table }` in the other two — a private
destructuring name, not a behavior. `postgres/mutate.ts:64` is genuinely different (three segments,
a real `schema` kind, its own message) and stays.

**F17 — the pre-flight cancellation guard is written nine times across six adapters, and two of
them have already named it.** Byte-identical everywhere:

```ts
if (ctx.signal.aborted) {
  throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
}
```

Named `checkNotCancelled` and exported at `clickhouse/query.ts:17` (used `:72,116,146`) and
`sqlite/query.ts:9` (used `:78,103` and `sqlite/console.ts:74`); inlined at
`postgres/query.ts:45`, `postgres/console.ts:39`, `mysql-family/query.ts:65`,
`mysql-family/query.ts:134`, `mysql-family/console.ts:76` and `rabbitmq/query.ts:54`. This is
Adapter rule 2's contract (`adapter.ts:38-39`: *"Every method that talks to the server takes an
`OpCtx` and honours `ctx.signal`"*) implemented nine times — the same shape as iteration 2's F15,
which found the read-only refusal ten times and answered it with `assertWritable()` in
`adapters/errors.ts`. `adapter.ts` imports only `@shared/*` types, so `errors.ts` can take a
type-only `OpCtx` import from it with no cycle.

**F18 — ClickHouse's `quoteIdent` still has no NUL-byte guard, and that is still not this phase's
call.** `postgres/read.ts:15-18`, `mysql-family/read.ts:16-19` and `sqlite/read.ts:17-20` each open
with `if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL
byte');`; `clickhouse/read.ts:9-11` does not. Re-confirmed unchanged from iteration 2's F18. Adding
the guard changes what ClickHouse does with a NUL-bearing identifier; removing the other three
changes what Postgres/MySQL/SQLite do. Either is a **behavior change** to a security-adjacent input
check, and this phase's contract is zero behavior change. Handed to **P40** (§6, §8) — the same
disposition iteration 2's D17 chose, for the same reason, restated here because it is the one item
in this plan a reader might expect to see fixed.

**F19 — `main/` reviewed a third time; still nothing.** Stated plainly rather than padded into a
finding, per iteration 2's own standard. Re-read in full: 12 root modules (largest
`connections.ts` at 409 lines, one cohesive service), `ipc/` (13 domain files ≤87 lines plus
`registry.ts:16-28`'s eleven-line wiring function and `errors.ts:19-27`'s single `handle()`
wrapper), `storage/` (`db.ts`, `migrate.ts`, `paths.ts`, `migrations/`, `schema/` 1:1 with the
migrations, `repos/` one per table). A repeated-symbol scan over every function declared in
`src/main` and `src/preload` returns **zero** names declared more than once. Every `ipc/*.ts`
exports exactly one `register*Handlers(deps?)`. The only `main/` change this phase makes is F5's
two `export` keywords in `preconnect.ts` and F13's work in `preload/`, which is a sibling folder,
not `main/`.

### E. Enforcement — extending the layering rule, and the trap in doing so

Iteration 2's §8.3 asked whether the `biome.json` `noRestrictedImports` mechanism should also pin
the four structural claims §11 makes in prose. All four were tested by writing the config, running
`biome check`, and probing with deliberate violations. **Two of the four claims are false as SPEC
states them**, one is not expressible with this mechanism at all, and extending the rule naively
**silently disables the rule iteration 2 added**.

**F20 — the four claims, checked against the tree.**

| §11's claim | Reality |
|---|---|
| *"`db.ts` … the only file that imports `node:sqlite` (D2)"* (`SPEC.md:918`) | **False as written.** `engine/adapters/sqlite/{client.ts:2,59,61, query.ts:1, console.ts:1}` import it too, correctly — P35 added a whole SQLite adapter after that sentence was written. True when scoped to `src/main/**`. |
| *"`repos/` … the only files that import the Drizzle instance"* (`SPEC.md:922-923`) | **True.** `drizzle-orm*` appears only in `main/storage/db.ts:2` and the eight `main/storage/repos/*.ts`. |
| *"`bridge/` … the only files that touch `ipcRenderer`/`MessagePort`"* (`SPEC.md:1040`) | **True** — zero hits for `ipcRenderer`, `MessagePort` or `window.kira` under `src/renderer` outside `bridge/`. But it is **not an import rule**: the renderer reaches preload through the `window.kira` global, and `MessagePort` is a DOM global. `noRestrictedImports` cannot express it. |
| *"`transfer.ts` … the only file in the adapter that imports `node:fs`"* (`SPEC.md:975`) | **True as scoped** (within `s3/`). Repo-wide it is not: `engine/adapters/sqlite/client.ts:1` imports `statSync` legitimately. A rule must therefore be scoped to `src/engine/adapters/s3/**`, which overlaps the adapters-wide rule below — see F21. |

A fifth claim is worth pinning and is not in §11 but in the code: **Adapter rule 1**
(`adapter.ts:34-36`) — *"An adapter imports nothing from `electron`. It is a plain Node module —
this is what makes `tests/db/` able to import it directly."* Zero violations today
(`src/engine/index.ts:3`'s `import type { MessagePortMain } from 'electron'` is the engine *host*,
outside `adapters/`). This is the claim whose breakage would be most expensive — it would break
`tests/db/` — and nothing checks it.

**F21 — Biome's `overrides` do not merge `noRestrictedImports` options: the last matching override
wins, and a broad override placed after a narrow one silently deletes the narrow one's rules.**
Discovered by running it, not by reading docs. In the scratchpad copy, appending an override with
`"includes": ["src/**", "!src/main/storage/**"]` after the existing
`"includes": ["src/renderer/views/**"]` block and then probing:

| Probe | Result |
|---|---|
| `src/renderer/views/grid/__g.ts` importing `../../workbench/state/tooltip` | **not flagged** — iteration 2's layering rule was gone |
| `src/engine/adapters/__p5.ts` importing `drizzle-orm`, with an `src/engine/adapters/**` override *after* it | **not flagged** — the narrow override deleted the broad one's patterns for those files |
| the same two, with override order reversed | both flagged |

`bun run lint` stays green in both arrangements. That is the whole problem: a well-meant "extend
the rule" commit can pass every check while removing the guard the previous iteration added, and
nothing in the output says so. The fix is a construction rule — **every override's `includes` must
be disjoint from every other's, or the narrower one must repeat the broader one's patterns** — plus
a probe per rule in the commit that adds it.

**The construction that was verified end to end.** Four new overrides, each `includes` disjoint
from the existing `src/renderer/views/**` block and from each other except the deliberate
`s3/` nesting, which repeats the pattern it would otherwise mask:

```
src/main/**, !src/main/storage/**              →  drizzle-orm*, node:sqlite
src/main/storage/**, !src/main/storage/db.ts   →  node:sqlite
src/engine/adapters/**                          →  electron
src/engine/adapters/s3/**, !.../transfer.ts     →  electron (repeated), node:fs*
```

plus, after §4.10–11 makes it true, `src/renderer/project/** → **/views/**`.

| Check | Result |
|---|---|
| `biome check src` on the untouched tree with all four active | *"Checked 354 files … No fixes applied."* — zero false positives |
| `electron` in `adapters/postgres/`, and separately in `adapters/s3/` | both flagged |
| `node:fs` in `adapters/s3/` | flagged |
| `drizzle-orm` in `main/ipc/`; `node:sqlite` in `main/ipc/` and in `main/storage/repos/` | all three flagged |
| controls: `main/storage/db.ts`, `main/storage/repos/connections.ts`, `adapters/s3/transfer.ts`, `adapters/sqlite/client.ts` | all clean |
| iteration 2's own two rules, re-probed with the new overrides in place | both still flagged (`views/grid` → `workbench`, `views/documents` → `../grid/page`) |
| `src/renderer/project/**` → `**/views/**`, run against the tree **as it is today** | flags exactly `ProjectTree.vue:8,9,10,11` and `menus.ts:32,33` and nothing else in the folder |

### F. Documentation drift

**F22 — §11's "fixed internal shape" bullet is stale in three ways, and one of them is a claim
iteration 1's own D27 introduced.** `SPEC.md:1090-1091`: *"Adapters keep one fixed internal shape
(`index.ts`/`client.ts`/`query.ts`/`definition.ts`/`read.ts`, and — every adapter but RabbitMQ,
P39 — `errors.ts` exporting one `mapError`)."* Against the tree:

1. The five-file list has been short since P5. Every adapter also has `caps.ts` (11 of 12) and most
   have `catalog.ts` (9), `mutate.ts` (9) and `console.ts` (6) — `postgres/` alone holds ten files,
   not five.
2. *"every adapter but RabbitMQ … `errors.ts`"* is wrong in both directions: **RabbitMQ has
   `errors.ts`** (it exports two mappers rather than one), and **`mariadb/` and `mysql/` have
   none** — they are re-export profiles over `mysql-family/` (P34 D7-D10), which owns the mapper.
3. `SPEC.md:936` still describes `postgres/` as *"index.ts (Adapter impl), client.ts, query.ts,
   definition.ts, read.ts"*.

§11 is billed as *"the tree as built"* (`SPEC.md:907`), and F1 is the direct evidence for why that
matters: a description that stops matching the tree is the thing a later reader follows first.

---

## 2. Shapes introduced in this plan

```ts
// src/renderer/state/viewCommands.ts — NEW (F7). The leaf-registry inversion state/tabRuntime.ts
// already uses, applied to the six project/ → views/ edges. Registration happens at module scope
// in each view's own state.ts, and every one of those modules is reached by a chain of static
// imports from main.ts (F7's trace), so the registry is populated before the first render.
export type CommandTabKind = 'data' | 'document' | 'keyvalue' | 'stream';

/** Each view state module registers its own `reload` here; project/ dispatches by tab kind. */
export function registerTabReload(kind: CommandTabKind, fn: (tabId: string) => Promise<void>): void;
/** Fire-and-forget, matching today's `void reloadDataTab(id)` exactly. Throws — loudly, not
 *  silently — if nothing is registered for `kind`: unlike shortcuts/commands.ts's deliberate
 *  no-op (mount-scoped, legitimately empty), an unregistered kind here can only mean the static
 *  import chain broke, and a silent no-op would hide it. */
export function reloadTab(kind: CommandTabKind, tabId: string): void;

/** Only the data and document views have a Σ count reachable from the tree menu (§8.10). */
export function registerTabCount(kind: 'data' | 'document', fn: (tabId: string) => Promise<void>): void;
export function countTab(kind: 'data' | 'document', tabId: string): void;

/** The three views/grid/state.ts operations reached from outside the grid: project/menus.ts's
 *  saved-filter items, and views/definition/columnsMenu.ts's Add-to-projection / Sort-by. */
export interface DataQueryCommands {
  setFilter(tabId: string, filter: string | null): Promise<void>;
  setSort(tabId: string, sort: SortSpec | null): Promise<void>;
  setProjection(tabId: string, projection: string[] | null): Promise<void>;
}
export function registerDataQueryCommands(cmds: DataQueryCommands): void;
export function dataQueryCommands(): DataQueryCommands;   // throws if unregistered, as above
```

```ts
// src/renderer/views/definition/columnsMenu.ts — NEW (F7). project/menus.ts:773-838's
// columnsSectionMenu + its private targetTabForTable, moved to the one view that opens them —
// where iteration 1's D23 said the intent pointed and only the import direction prevented it.
// Every ingredient now comes from below: MenuItem from state/contextMenu, copyText from
// renderer/clipboard, activeTab/findDataTab/openDataTab from state/tabs, and the two grid
// operations from state/viewCommands. Item ids, labels, icons and order are unchanged.
export function columnsSectionMenu(connectionId: string, tablePath: string, columnName: string): MenuItem[];
```

```ts
// src/renderer/views/shared/viewOp.ts — additions only (F10).
/** The per-tab runtime record every view state module keeps, plus the one accessor that creates
 *  it. `ensureRuntime` re-reads through the reactive proxy rather than returning the object it
 *  just created — grid/state.ts:59-65's invariant, now stated once for all six. */
export function createRuntimeStore<R>(makeDefault: () => R): {
  runtime: Record<string, R>;
  ensureRuntime(tabId: string): R;
};
```

```
src/renderer/views/shared/page/   — NEW folder (F9). Seven modules move in and drop the `page`
                                    prefix the folder now carries, exactly as iteration 1's D24
                                    un-prefixed docPage.ts/kvPage.ts inside views/documents/ etc.
  store.ts          <- pageStore.ts
  scan.ts           <- pageScan.ts          (createSearchState leaves it, F4)
  search.ts         <- pageSearch.ts        (gains createSearchState)
  searchFilter.ts   <- searchFilter.ts      (name kept: it is the row-filter toggle, not a scanner)
  sizes.ts          <- pageSizes.ts
  columns.ts        <- columns.ts
  SearchToolbar.vue <- PageSearchToolbar.vue
```

```ts
// src/preload/index.ts — two module-private helpers (F13), replacing nineteen copies of one
// four-line pattern. Identical listener semantics: same channel, same closure passed to .off().
function onSignal(channel: string, cb: () => void): () => void;
function onEvent<T>(channel: string, cb: (payload: T) => void): () => void;
```

```ts
// src/engine/adapters/errors.ts — additions only (F17).
/** Adapter rule 2's pre-flight check, once. Message preserved byte-for-byte:
 *  'operation was cancelled before it started'. Type-only OpCtx import from ./adapter, which
 *  imports nothing from here. */
export function assertNotCancelled(ctx: OpCtx): void;
```

```ts
// src/engine/adapters/sql-text.ts — additions only (F14).
export interface EffectiveOrder {
  terms: { column: string; direction: SortDirection }[];
  keysetEligible: boolean;
  keysetColumns: string[];
  keysetDirection: SortDirection;
}
/** D7's keyset eligibility rule, shared by postgres/mysql-family/sqlite. Takes the column list
 *  and the caller's already-resolved tiebreaker rather than each adapter's own ReadTarget —
 *  D17's precedent, and the one thing sqlite genuinely does differently (its implicit rowid,
 *  F23/D22) stays in sqlite/read.ts where the ReadTarget field it reads lives. */
export function computeEffectiveOrder(
  sort: SortSpec | null, columns: ColumnMeta[], tiebreaker: string[] | null,
): EffectiveOrder;
```

```ts
// src/engine/adapters/sql-mutate.ts — additions only (F15/F16).
export type ValueRenderer<P> = (value: string | null, params: P[]) => string;

/** preview()'s renderer (D6: never executes) — an escaped SQL literal, no params touched. */
export function literalRenderer(value: string | null): string;

/** mutate()'s renderer — pushes onto `params` and returns the dialect's placeholder for the
 *  position it landed at. `placeholder` is the one thing the three copies disagreed on
 *  (`$n` vs `?`); sql-text.ts's buildKeysetPredicate already takes exactly this argument. */
export function createParamRenderer<P>(placeholder: (n: number) => string): ValueRenderer<P>;

/** UPDATE/DELETE/INSERT text for one row op, with the WHERE built from the row key. `quote` is
 *  the caller's own quoteIdent, so every emitted string is byte-identical to today's. */
export function renderRowOp<P>(
  relationSql: string, op: MutationRowOp, render: ValueRenderer<P>, params: P[],
  quote: (name: string) => string,
): string;

/** The two-segment database/table path check clickhouse, mysql-family and sqlite each wrote out
 *  identically, message included. postgres keeps its own (three segments, a real `schema`). */
export function resolveDatabaseTablePath(
  path: MutationPlan['path'],
): { database: string; table: string };
```

```jsonc
// biome.json — four new overrides (F20/F21), each `includes` disjoint from every other's except
// the s3 pair, where the narrower one repeats `electron` so the broader rule is not masked.
// ORDER IS LOAD-BEARING: overrides do not merge noRestrictedImports options — the last matching
// override wins (F21). A fifth override lands with §4.10-11:
//   { "includes": ["src/renderer/project/**"], … "group": ["**/views/**"] }
```

---

## 3. Decisions

### What iterations 1 and 2 left behind

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The eighteen stale path references of F1 are corrected to the file's current path, or deleted where the sentence no longer says anything.** Nine files, five dead paths. | F1. Three of the five paths were moved by P39 itself, so this is the phase cleaning up after its own two rounds — and iteration 2's D6 already set the precedent by fixing the one instance it happened to hit. A comment naming a file a reader cannot open is worse than no comment (AGENTS.md); `StreamSearchToolbar.vue`'s six references to a component iteration 1 *deleted* are the sharpest case, because the sentences ("same placement law as…", "identical ref/onMounted pair") are still true of `views/shared/page/SearchToolbar.vue`. |
| D2 | **`views/grid/search.ts` drops its `export { isSearchFiltering, searchFilterState, setSearchFiltering }` block and the import that feeds it; `DataGrid.vue:49` imports `setSearchFiltering` from `../shared/page/searchFilter` like its four siblings.** The three `export type { SearchHandle, SearchQuery }` lines go with it. | F2/F3/F6. Two of the three re-exported values have no importer at all, and the third makes the grid the only view reaching the shared toggle through an intermediary — a P31 migration aid that outlived its migration by three phases. Removing the block also removes the last thing `searchFilter.ts:7-9`'s comment describes incorrectly, so that comment is deleted rather than corrected a third time. Five lines of diff, `typecheck` is the proof. |
| D3 | **`createSearchState` moves from `pageScan.ts` into `pageSearch.ts` and stops being exported.** | F4, and iteration 2's D3's actual intent. As an un-export it was impossible (its caller is another module); as a move it is right on the merits — `pageScan.ts` is the rAF-chunked scanner and `createSearchState` is a reactive per-tab record with a tab-close cleanup registration, which is `pageSearch.ts`'s subject. After the move `pageScan.ts` exports exactly `SearchQuery`, `SearchHandle`, `eachMatch` and `runChunkedScan` — one concern. |
| D4 | **The seven F5 constants lose their `export` keyword.** Types and Zod schemas are **not** touched. | F5, and iteration 2's D27 one level down: its scan covered `export function` and missed `export const`. Each is used only inside its own module; dropping `export` is proven safe by `typecheck` and stops `pendingState` in particular from advertising a writable reactive store that every one of its own eleven uses reaches through an accessor. Zod schemas in `shared/` are excluded deliberately — a schema is a published shape like a type, and unexporting forty of them would be churn dressed as tidiness (§6). |

### The renderer's structural edge

| # | Decision | Rationale |
|---|----------|-----------|
| D5 | **`renderer/state/viewCommands.ts` (new) holds a module-scope command registry; the four data-view state modules register into it; `project/ProjectTree.vue` and `project/menus.ts` dispatch through it. All six `project/ → views/` imports go.** | F7. Iteration 2 declined this and asked iteration 3 to decide; the deciding evidence is `state/objectStore.ts:11-13`, where **P33 moved an entire module into `state/` for the express purpose of keeping `project/menus.ts` from importing `views/` sideways** — while `menus.ts:32-33` does exactly that. The codebase holds both positions at once, and only one of them can be right. The mechanism is not new: `state/tabRuntime.ts:1-6` documents itself as *"a leaf cleanup registry breaking the cycle every view state module would otherwise create"*, which is this cycle. Registration is safe because every view state module is on a chain of static imports from `main.ts` (F7's trace) — verified, not assumed. |
| D6 | **The registry dispatchers throw when nothing is registered, rather than no-opping.** | The one behavioral difference between a direct call and a dispatch is what happens when the target is missing. Today `void reloadDataTab(id)` cannot miss; a silent no-op would turn a broken import chain into "double-click sometimes doesn't refresh", which is the worst possible failure mode for a data tool. `shortcuts/commands.ts:14-15` no-ops for a documented and opposite reason (it is *mount*-scoped, and "Find on a definition tab" is legitimately nothing to do); this registry is module-scoped and complete or broken. |
| D7 | **`columnsSectionMenu` and its private `targetTabForTable` move from `project/menus.ts:773-838` into a new `views/definition/columnsMenu.ts`; `ColumnsSection.vue:3` imports it from `./columnsMenu`.** `menus.ts` also loses its now-unused `activeTab`/`findDataTab` imports. | F7, and iteration 1's D23 finally answered rather than deferred. D23's whole argument was that the move would create a `views/definition → views/grid` edge; through the registry it creates none — the menu reaches `setProjection`/`setSort` through `state/`, and `openDataTab`/`findDataTab`/`activeTab` were always in `state/tabs.ts`. P19 D9 put these items in the tree's menu file when they *were* tree-row affordances; they have belonged to the Columns section since P19 moved the columns there. `definition.spec.ts:194-206` asserts the exact item ids, in order, and clicks one — the guard is already written. |
| D8 | **`views/console/completion.ts:4`'s import of `project/state/tree` stays.** It is the only `views/ → project/` edge left, and no rule is added against it. | F7. `project/state/tree.ts` has twelve importers, seven of them inside `project/` — the opposite of iteration 1's D1 test, so it is not a `state/` module wearing the wrong folder. And the import is a deliberate, documented reuse of a cache the app already has (`completion.ts:26-28`: *"reads the tree's own cache — no new round trip, no new cache"*). After D5/D7 the folder graph has one direction (`views/ → project/ → state/`) and no cycle, which is the property that was missing; making it zero edges would mean either a second Mongo-collection cache or a third registry, both worse than one honest read. |
| D9 | **`state/tabs.ts:28-33`'s six and `main.ts:13-17`'s five imports of `views/` are left exactly as they are.** No page-store registry. | F8. Three reasons, all checked: those page modules import nothing back (no cycle to break); `main.ts:48`'s `__kiraGridRetainedBytes` is grid-specific by design and a registry cannot express it; and `tabs.ts:37-42` already documents the explicit five-way call as deliberate, where a registry would trade a compile-time-complete list for a registration-order-dependent one. Recorded so a fourth reader does not re-open it. |
| D10 | **`views/shared/`'s seven paged-data-view modules move into `views/shared/page/` and drop their `page` prefix.** The other ten files and `celleditor/` stay put. | F9. This is the one change in the plan justified by legibility rather than duplication, and it is argued on the same ground iteration 1's D24 used inside the view folders: *"the folder already says `documents`, so `documents/docPage.ts` says it twice."* `views/shared/pageStore.ts` says it twice for the same reason. The seven are a closed unit with one client set and internal cross-imports; the remaining ten are five unrelated pairs and singletons that a subfolder would only scatter. Thirty-one import lines, all mechanical, all `typecheck`-guarded. §8 records `views/shared/` as settled after this — there is no fourth round to re-open it. |
| D11 | **`views/shared/viewOp.ts` gains `createRuntimeStore(makeDefault)`; the six view state modules call it and delete their own `ensureRuntime`.** `defaultRuntime()` stays six functions. | F10, and iteration 2's D4 verbatim one concern over: a subtle invariant written six times with its explanation written once is how the five undocumented copies drift. The Vue-proxy comment moves into the factory, where it guards every caller instead of one. The six runtime *shapes* genuinely differ (five fields to eleven), so `defaultRuntime` is the parameter, not the thing merged. |
| D12 | **`views/console/resultPages.ts` gains a module-private `cached(entry, key, decode)`; its five inline decode-memos call it.** The console's store is still **not** put on `createPageStore`. | F11. Five copies of a six-line memo inside one 124-line file is the tightest duplication in `src/renderer`, and the helper is the same body `pageStore.ts:54-63` already runs for the other three stores. Not the factory, for iteration 1 D7's unchanged reasons: this store keys by `${tabId}:${...}` rather than `tabId`, holds a `Page` union, and clears its whole cache on a window change instead of pruning. |
| D13 | **Nothing else comes out of `DataGrid.vue`, `DocumentView.vue`, `StreamView.vue` or `KeyValueView.vue`.** | F12. Every component is now smaller than it was before P39 started, and the four remaining candidates were re-checked individually: `matchIndex` is two copies (iteration 2's stated threshold) with genuinely different consumers on top, the pager is two copies over different tab sources, and `pathPrefix`/`iconColor` still compute different strings and different colours. Iteration 1's D13 on the grid's scroll path (P29 tuned it against `budgets.spec.ts`/`perf.spec.ts` with deliberately primitive-valued computeds) is untouched by anything found this round. |

### `src/preload/` and `engine/adapters/`

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **`preload/index.ts` gains two module-private helpers, `onSignal(channel, cb)` and `onEvent<T>(channel, cb)`; the nineteen subscribe blocks become nineteen one-line properties.** The MessagePort relay at `:216` is untouched. | F13. Roughly 76 of 218 lines restating one four-line pattern, in the one file where a mismatch between the `.on()` channel and the `.off()` channel would leak a listener per subscribe/unsubscribe cycle with nothing to catch it. The helpers return the same closure shape `KiraApi` already declares, so no type in `shared/protocol/ipc.ts` moves. Neither prior iteration opened this folder; `renderer/bridge/control.ts` was checked for the same problem and has none. |
| D15 | **`assertNotCancelled(ctx)` joins `unsupported()`/`noQueryConsole()`/`assertWritable()` in `engine/adapters/errors.ts`; the nine sites call it and the two local `checkNotCancelled` definitions are deleted.** Message preserved byte-for-byte. | F17. This is iteration 2's D14 finding one contract over: `adapter.ts:38-39` states the rule in the interface, two adapters already extracted it under one name, and six more inline it. The name matches `assertWritable`'s. `errors.ts` takes a **type-only** `OpCtx` import from `./adapter`, which imports only `@shared/*` — no cycle, verified by reading both files' import lists. |
| D16 | **`computeEffectiveOrder` and `EffectiveOrder` move into `engine/adapters/sql-text.ts`;** the three copies and their three interface declarations are deleted, and the three call sites pass `target.columns` and their own tiebreaker. | F14. `sql-text.ts:12-14`'s charter is *"the genuinely shared, driver-agnostic glue the SQL adapters' `read.ts` modules call — kept out of the adapter folders because duplicating it would guarantee they drift"*, and `resolveProjection` already lives there under exactly this signature transformation. `mysql-family/read.ts:54-55`'s "kept as a sibling copy because it depends on each adapter's own `ReadTarget`" is the argument D17 refuted; keeping the tiebreaker expression at the call site preserves SQLite's rowid fallback (F23/D22) verbatim, in the file that owns the `ReadTarget` field it reads. |
| D17 | **`ValueRenderer`, `literalRenderer`, `createParamRenderer`, `whereFromKey` and `renderRowOp` move into `engine/adapters/sql-mutate.ts`;** postgres, mysql-family and sqlite call them, passing their own `quoteIdent` and their own placeholder. `whereFromKey` becomes module-private there. **ClickHouse is not changed.** | F15, and iteration 2's D18 corrected. Three copies of 47 lines whose *complete* difference is a placeholder string and one type parameter, in a module whose sibling `sql-text.ts:29-40` already takes a `placeholder: (i: number) => string` for the same reason. Generic over the params element type covers `unknown[]` vs `SqliteParam[]` with no cast. Every emitted statement string is byte-identical because `quote` is the caller's own function and the placeholder closure reproduces `$n` and `?` exactly — and `preview()`'s output is asserted verbatim by `mutations.spec.ts`, which is the guard. ClickHouse renders insert-only batches through a different statement shape and stays. |
| D18 | **`resolveDatabaseTablePath` joins `sql-mutate.ts`;** clickhouse, mysql-family and sqlite call it. `postgres/mutate.ts:64` keeps its own. | F16. Three character-identical copies including the `E_NOT_FOUND` message; the only difference is whether the private destructuring names the first segment `database` or `schema`, which no emitted string depends on. Postgres's is a genuinely different path shape (three segments, a `schema` kind) and stays — the same "three of four, not four of four" split D16 makes one file over. |
| D19 | **No other adapter internals change.** Catalog SQL, pagination strategy, `caps` literals, `typeClassFor`, the `mariadb/`↔`mysql/` profile split, every `errors.ts` body, ClickHouse's `mutate.ts`, and each adapter's own `quoteIdent` stay exactly as they are. | Iteration 1's D15 and iteration 2's D16/D18, minus the two claims F15/F16 disproved. `typeClassFor` was diffed again this round by way of F14's read-path pass and remains four dialect vocabularies with four different fallbacks. `preview()` itself (ten copies of four lines, `postgres/mutate.ts:81` and siblings) is left: after D17 each is `resolveTablePath` + `orderedOps` + `renderRowOp`, three calls the adapter must make in its own order with its own quoting. |
| D20 | **`clickhouse/read.ts:9-11`'s missing NUL guard is not touched, and is not smuggled into any commit.** It is written up for **P40**. | F18. Adding the guard changes what ClickHouse does with a NUL-bearing identifier; that is a behavior change to a security-adjacent check, and P39's contract is zero behavior change. P40 is the phase that is allowed to change behavior and to test the change. Same disposition as iteration 2's D17 and iteration 1's D12 on `patchChanged` — naming it and handing it on is the honest move, and this plan states it in §6 and §8 rather than leaving a reader to wonder whether it was forgotten. |

### Enforcement and documentation

| # | Decision | Rationale |
|---|----------|-----------|
| D21 | **`biome.json` gains four overrides — Drizzle and `node:sqlite` scoped to `main/`, `electron` scoped to `engine/adapters/**`, `node:fs` scoped to `s3/**` — plus a fifth, after D5/D7 land, forbidding `project/** → **/views/**`.** All at `error`. | F20/F21, and iteration 2's §8.3 answered. Each clause was executed, not read: zero false positives on the untouched tree, a deliberate violation flagged for every rule, and every control file (`db.ts`, a repo, `s3/transfer.ts`, `sqlite/client.ts`) still clean. The `electron` rule is the most valuable of the five — Adapter rule 1 is what lets `tests/db/` import adapters directly, and nothing checked it. The `project/` rule is what keeps D5's inversion from silently regrowing. |
| D22 | **The overrides are ordered and scoped so that no override's `includes` overlaps another's except the deliberate `s3/` nesting, which repeats the `electron` pattern it would otherwise mask — and the commit that adds them demonstrates each rule with a throwaway violation before removing it.** | F21, which is the real finding here. `noRestrictedImports` options do not merge across overlapping overrides; the last match wins. A naive `"includes": ["src/**"]` block would have silently deleted iteration 2's `views/*` layering rule while leaving `bun run lint` green — a guard removed with no output saying so. Encoding the construction rule in the config's shape, and proving each rule fires once, is the only thing that makes this safe to extend. |
| D23 | **No lint rule is added for §11's `bridge/`-only `ipcRenderer`/`MessagePort` claim.** | F20. The renderer reaches preload through the `window.kira` global and `MessagePort` is a DOM global; neither is an import, so `noRestrictedImports` cannot see them. The property holds today (zero hits outside `bridge/`) and it stays a review-and-`grep` claim. Saying "this one is not expressible" is better than adding a rule that appears to cover it and does not. |
| D24 | **SPEC.md and ARCHITECTURE.md are edited by the implementing session** (standing practice, P19/P21/P24/P31, P39 D27/D30): §10's P39 row gains the iteration-3 paragraph and records the phase as three-of-three complete; §11's tree gains `views/shared/page/`, `state/viewCommands.ts` and `views/definition/columnsMenu.ts`; §11's *"fixed internal shape"* bullet is corrected on all three counts of F22; `SPEC.md:918`'s `node:sqlite` sentence is scoped to `main/`; §11's layering bullet names the four new enforced claims **and** F21's override-ordering rule; §11's `renderer/state/` bullet records the `project/ ↔ views/` inversion; ARCHITECTURE.md's adapter section names `computeEffectiveOrder`, the row-op renderer and `assertNotCancelled`. | F22, and F1 is the evidence for why: a description that stops matching the tree is what a later reader follows first. Correcting the `errors.ts` sentence matters most — it is a claim iteration 1's own D27 introduced and it is wrong in both directions. |

---

## 4. Implementation order

Fifteen commits. Each is one focused sitting, independently reviewable and revertible, leaves
`lint`/`typecheck`/`build` green, and is behavior-identical on its own. The small residue cleanups
(1–5) come first; `preload/` and the adapters (6–9) are self-contained; the structural work (10–12)
comes after, so every earlier diff reads against today's paths; the comment fix (13) comes **after**
the folder move so each comment is written once with its final path; the lint rules (14) come after
every move so they are added to an already-clean tree.

1. **`chore: drop export from the seven module-private constants`** — D4. Seven `export` keywords
   across six files (`tooltip.ts`, `pendingChanges.ts`, `filterTree.ts`, `rabbitmq/query.ts`,
   `rabbitmq/read.ts`, `preconnect.ts`). `bun run typecheck` (all four projects) is the proof.
2. **`refactor(views): the grid stops re-exporting the shared search-filter toggle`** — D2.
   `grid/search.ts` loses lines 4, 7 and 8–11; `DataGrid.vue:49` splits its import;
   `documents/search.ts:5` and `keyvalue/search.ts:6` lose their type re-exports;
   `searchFilter.ts:7-9`'s stale sentence goes.
3. **`refactor(views): createSearchState moves beside the API it builds`** — D3. Out of
   `pageScan.ts`, into `pageSearch.ts`, un-exported.
4. **`refactor(views): one ensureRuntime behind the six view runtimes`** — D11.
   `views/shared/viewOp.ts` gains `createRuntimeStore`; six `state.ts` files lose their copy; the
   Vue-proxy comment moves once.
5. **`refactor(console): one decode memo in the console's page store`** — D12.
   `views/console/resultPages.ts` only.
6. **`refactor(preload): one subscription helper per event shape`** — D14. Two helpers, nineteen
   properties, ~55 lines net. The MessagePort relay untouched.
7. **`refactor(engine): one pre-flight cancellation guard for every adapter`** — D15.
   `assertNotCancelled` in `adapters/errors.ts`; nine call sites; two local definitions deleted;
   `sqlite/console.ts:13`'s import updated. Every message string preserved — diff the strings.
8. **`refactor(engine): hoist computeEffectiveOrder into sql-text.ts`** — D16. Three copies plus
   three `EffectiveOrder` declarations deleted; three call sites gain the tiebreaker argument.
9. **`refactor(engine): the SQL row-op renderer and table-path check move into sql-mutate.ts`** —
   D17/D18. Three ~47-line blocks and three ~15-line `resolveTablePath` copies deleted; postgres,
   mysql-family and sqlite pass their own `quoteIdent` and placeholder. Clickhouse gains only the
   path-check call. **The reviewable claim: no emitted SQL string changes** — `preview()`'s output
   is asserted verbatim by `mutations.spec.ts`.
10. **`refactor(state): a view-command registry so project/ stops importing views/`** — D5/D6.
    `state/viewCommands.ts` (new); four registrations in `views/{grid,documents,keyvalue,stream}/state.ts`;
    `ProjectTree.vue:8-11,112,117,122,127` and `menus.ts:32-33,389,471,743-744` dispatch through it.
    After this commit `grep -rn "views/" src/renderer/project` returns only comment text.
11. **`refactor(definition): the Columns-section menu moves into views/definition/`** — D7.
    `views/definition/columnsMenu.ts` (new, from `menus.ts:773-838`); `ColumnsSection.vue:3` and
    `menus.ts`'s import block updated. Item ids, labels, icons and order unchanged — that is what
    `definition.spec.ts:202` asserts.
12. **`refactor(views): the paged-view plumbing becomes views/shared/page/`** — D10. Seven
    `git mv`s with the prefix dropped, ~31 import lines across sixteen files. Pure moves and
    renames, no content change.
13. **`docs: correct the eighteen source comments naming files that moved`** — D1. Nine files, five
    dead paths, comment text only.
14. **`build(lint): extend the layering rule to project/, main/storage and the adapters`** —
    D21/D22/D23. Five `biome.json` overrides. The commit message carries the probe table from
    §1E F21 — one deliberate violation per rule, flagged, then removed — and the note that override
    order is load-bearing.
15. **`docs: SPEC §10/§11 and ARCHITECTURE for P39 iteration 3`** — D24, including this plan if it
    is not already committed.

---

## 5. Verification

**Nothing in this phase is verified by a new test**, for the reason both prior iterations gave: the
existing suites already assert the behavior these steps must not change, and an assertion written
alongside a refactor proves only that the new code does what the new code does. Sparse unit tests
are their own queued phase (P41), and `tests/db/` is out of scope for it and for this.

Claims marked ▶ were executed in this box and their output is in §1. Per AGENTS.md only `smoke`,
`startup`, `workbench`, `connections`, `secrets` and `sqlite` run without Docker here; everything
else needs the macOS/Colima box or CI. **The phase is not done until the full `test:ui` and
`test:db` suites have been run green in an environment that can run them** — before the phase is
called finished, not step by step.

| Step | Suites / checks that must be re-run green | What they pin |
|---|---|---|
| 1 | `bun run typecheck` (node, web, db, electron-db) | Nothing outside those six modules referenced the seven constants. |
| 2–3 | `data-view.spec.ts` (search block, `search-filter-rows` toggle), `mongo.spec.ts`, `redis.spec.ts` | The grid's "hide non-matching rows" toggle and its "show all rows" button still work from the new import path; match counts, prev/next cycling and the page-replaced re-scan (P31 D22) are unchanged in all three views. |
| 4 | `tabs.spec.ts`, `data-view.spec.ts`, `console.spec.ts`, `definition.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, plus `budgets.spec.ts` | Every view still creates its per-tab runtime on first touch **through the reactive proxy** — the failure mode this step exists to protect against is "a pager button's `disabled` binding stops updating", which the scroll/pager assertions in `data-view.spec.ts` and `budgets.spec.ts` are the ones to catch. |
| 5 | `console.spec.ts`, `mongo.spec.ts` (console scenarios) | A console result set still renders the same cells, documents and key/value rows, and re-renders correctly after a window change clears the cache. |
| 6 | `workbench.spec.ts`, `connections.spec.ts`, `tabs.spec.ts`, `interaction.spec.ts`, `secrets.spec.ts`, plus a real relaunch (`startup.spec.ts`) | Every menu accelerator and main-process-initiated event still reaches the renderer, and every unsubscribe still removes the listener it added — the leak this step must not introduce is a listener surviving a `off()` call, which `leaks.spec.ts` is the backstop for. |
| 7–9 | `bun run test:db` in full (postgres, mariadb, mysql, sqlite, clickhouse, mongo, redis, s3, sqs, rabbitmq) + `bun run test:db:kafka`, plus `mutations.spec.ts` and `data-view.spec.ts` | Cancellation still classifies as `E_CANCELLED` with the same message at every pre-flight point; keyset pagination still resolves the same ORDER BY and the same tiebreaker per dialect (SQLite's rowid fallback included); **every previewed and executed statement string is byte-identical** — `mutations.spec.ts`'s exact-command preview is the assertion that proves it. |
| 10 | `tree.spec.ts`, `data-view.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, `sqs.spec.ts`, `s3.spec.ts`, `tabs.spec.ts` | Double-clicking a tree row whose tab is **already open** still refetches (all four kinds — the `reused` branch at `ProjectTree.vue:112,117,122,127`); the tree menu's "Count rows"/"Count documents" still opens-or-reuses the tab and runs Σ on it; a saved filter applied from the tree still sets both the WHERE and the ORDER BY. **This is the sharpest step in the phase.** |
| 11 | `definition.spec.ts` (`:172-206` — the Columns-section right-click, its exact item-id list, and the Add-to-projection click that must land on the *data* tab, not the definition tab), `data-view.spec.ts` | The menu's three items keep their ids, labels, icons and order, and `targetTabForTable`'s D9 rule (never reuse the definition tab) still holds. |
| 12 | `bun run typecheck` (all four) + full `test:ui` | Moves and renames only — any spec or module importing one of the seven by path is the guard. |
| 13 | ▶ `bun run lint`, `bun run build` | Comment text only; no symbol moves. |
| 14 | ▶ `bun run lint` clean with all five overrides active (verified here on the untouched tree: *"Checked 354 files … No fixes applied."*), ▶ one deliberate violation per rule added and removed, ▶ iteration 2's two existing rules re-probed with the new overrides in place | That the four new claims are held by a check rather than by review, **and** that adding them did not mask the rule iteration 2 added — F21's trap is the specific thing this step must demonstrate it avoided. |
| 15 | Read against the tree | §11 lists the folders that exist and the adapter files that exist. |

---

## 6. Explicitly out of scope

- **`clickhouse/read.ts:9-11`'s missing NUL-byte guard** (D20). Fixing it — or removing the other
  three — changes behavior. **P40** owns it, and §8 carries the write-up. Nothing in this plan
  touches any adapter's `quoteIdent`.
- **`state/tabs.ts`'s `patchChanged` divergence** (iteration 1's F16/D12, still preserved behind
  the `skipUnchanged` flag). Unchanged this round; still **P40**'s.
- **`tests/db/`, entirely.** No new tests anywhere (§5), and no restructuring — there is not even a
  leftover-encoding fix left to make (`file` over every tracked source file reports text).
- **`DataGrid.vue`'s virtualization, selection, inline editor, menus or render VM** (D13),
  unchanged from iteration 1's D13 and iteration 2's D11: P29 tuned that path against
  `budgets.spec.ts`/`perf.spec.ts` with deliberately primitive-valued computeds.
- **Splitting `DocumentView.vue`/`StreamView.vue`/`KeyValueView.vue` further** (D13) — every
  candidate re-checked in F12 and each fails on merit.
- **Merging `runCount` (iteration 2 D28), `stop()` (D29), `preview()` (D19), or `defaultRuntime()`
  (D11)**, and merging `stream/search.ts` or `StreamSearchToolbar.vue` into the shared
  scanner/toolbar (iteration 1's D8/D9 — it would change what a Kafka search finds).
- **Adapter internals beyond D15–D18** (D19): catalog SQL, pagination strategy, `caps` literals,
  `typeClassFor`, ClickHouse's `mutate.ts`, and every `errors.ts` body.
- **Moving `project/state/tree.ts` into `renderer/state/`** (D8) — seven of its twelve importers
  are inside `project/`, the opposite of iteration 1 D1's test.
- **A page-store registry for `state/tabs.ts` and `main.ts`** (D9).
- **Unexporting `shared/`'s Zod schema constants.** A repo-wide scan found ~40 `*Schema` consts in
  `src/shared/**` with no importer outside their own file; they are the published vocabulary those
  files exist to declare, and every one of them is a `z.infer` source or a composition ingredient.
  Applying D4 there would be churn dressed as tidiness.
- **A lint rule for the `bridge/`-only `ipcRenderer`/`MessagePort` claim** (D23) — not expressible
  as an import restriction.
- **Deduplicating scoped CSS across the view components.** The blocks that look alike were read;
  merging them would move declarations between cascade contexts, which is a rendering change, and
  the ground rules exclude theme/design-system work (P38 stays skipped by user direction).
- **New dependencies, any migration, any change to a persisted tab's `state_json` shape or the wire
  protocol**, and **`docs/design/kira-design-system/`**.

---

## 7. Acceptance checklist

- [ ] `grep -rn "views/" src/renderer/project` returns **no import line**, and `bun run lint`
      **fails** if one is added — demonstrated once with a throwaway import, then reverted.
- [ ] `bun run lint` still **fails** on a `views/* → workbench/*` import and on a sideways
      `views/<kind>/* → views/<kind>/*` import, with all five overrides active. (F21: this is the
      one that a careless extension silently removes.)
- [ ] `bun run lint` fails on `electron` in an adapter, `drizzle-orm` outside `main/storage/`,
      `node:sqlite` outside `main/storage/db.ts`, and `node:fs` in `s3/` outside `transfer.ts` —
      and stays clean on `s3/transfer.ts`, `sqlite/client.ts`, `main/storage/db.ts` and every repo.
- [ ] `columnsSectionMenu` lives in `src/renderer/views/definition/`, and `project/menus.ts` no
      longer imports `activeTab` or `findDataTab`.
- [ ] `ensureRuntime` appears **once** in `src/renderer`; `createSearchState` appears **once** and
      is not exported; `searchFilterState` is imported from exactly one module.
- [ ] `computeEffectiveOrder`, `renderRowOp`, `literalRenderer`, `whereFromKey`,
      `'operation was cancelled before it started'` and `'mutate requires a database/table path'`
      each appear **once** in `src/engine`.
- [ ] **No SQL string, no error message and no `data-testid` changed anywhere** — diff the string
      literals across the whole phase, not just the tests; `test:ui` passes with **zero** selector
      edits in `tests/ui/`, and the diff of `tests/` for this phase is **empty**.
- [ ] `const listener =` appears **twice** in `src/preload/index.ts` (the two helpers) plus the
      MessagePort relay's own inline handler.
- [ ] `views/shared/` holds ten files plus `celleditor/` and `page/`; no file under
      `views/shared/page/` repeats `page` in its own name.
- [ ] No comment anywhere under `src/` names a path that does not exist (re-run F1's extract-and-
      test sweep).
- [ ] The seven F5 constants are no longer exported and `bun run typecheck` is clean.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; full `test:ui` and `test:db` green on a box that can run them before
      the phase is called done.
- [ ] SPEC §10's P39 row records three of three iterations complete; §11's tree matches the tree
      that exists; §11's adapter-shape bullet is right about `errors.ts` in both directions; §11's
      `node:sqlite` sentence is scoped to `main/`; §11 names the override-ordering rule.

---

## 8. What is left, and who owns it

This is the last of three iterations; there is no queued fourth round, and nothing below is being
parked for one.

**Handed to P40 (functionality review — the phase allowed to change behavior):**

1. **`clickhouse/read.ts:9-11` has no NUL-byte guard where its three SQL siblings do** (F18/D20).
   Drift or decision? If drift, the fix is one line. It is a security-adjacent input check on an
   identifier that reaches a SQL string, and it is the only item this phase found that it could not
   fix without breaking its own contract.
2. **`state/tabs.ts`'s `patchChanged` divergence** (iteration 1's F16): three tab kinds skip a
   no-op patch, three do not, preserved verbatim behind `skipUnchanged`. Still open, still a
   one-flag answer once someone decides which behavior is right.

**Handed to P41 (unit tests):**

3. **The key/value and stream find widgets still have no coverage for P31 D17's filter toggle** —
   `grep -rl "search-filter-rows" tests/ui` returns `data-view.spec.ts` and `mongo.spec.ts` only.
   Raised by iteration 1 §9.5, repeated by iteration 2 §8.5, and step 2 of this plan touches that
   path again in the grid. Its key/value and stream guarantees still rest on `typecheck` and
   review.
4. **Applying a saved filter from the tree's "Saved filters ▸" submenu is not exercised by any
   spec** — `tree.spec.ts:270` asserts the menu *item exists* and nothing clicks it. Step 10 moves
   that code path onto the registry, so its guarantee this round rests on the `setFilter`/`setSort`
   pair being unchanged plus review. This is the thinnest spot in §5.

**Handed to P42 (docs cleanup):**

5. SPEC §11 is corrected again this phase (D24), for the third time in three rounds, and each time
   the correction was found by reading the tree rather than by anything checking. P42 retires
   SPEC.md as v1 history and moves what is still true into ARCHITECTURE.md; the lesson worth
   carrying over is that the claims §11 makes in prose are worth *either* enforcing (as D21 now
   does for five of them) *or* deleting — the ones that sit in between are the ones that go stale.

**Accepted as permanent structure — decided, not deferred:**

6. **`views/console/completion.ts → project/state/tree`** stays the one `views/ → project/` edge
   (D8). The folder graph after this phase runs one way and has no cycle, which was the actual
   problem; a second Mongo-collection cache to reach zero would be worse.
7. **`state/tabs.ts` and `main.ts` keep their eleven imports of `views/` page modules** (D9). No
   back-edge, no cycle, and one of them (`__kiraGridRetainedBytes`) is irreducibly grid-specific.
8. **`views/shared/` is settled** at ten files plus `celleditor/` and `page/` (D10). Iteration 1
   left it flat at fourteen, iteration 2 flagged it at seventeen, and this round split off the one
   group that is a real unit. The remaining ten are five unrelated pairs and singletons; a second
   split would scatter them, not group them.
9. **The four large view components stay large** (D13). Every one is smaller than it was before
   P39; what remains is a data view's own surface, not copied plumbing.
10. **The `bridge/`-only `ipcRenderer`/`MessagePort` rule stays a review claim** (D23) — it is
    about globals, and no import-based check can see it.
