# P39 (iteration 2) — Code modularity, reusability and overall cleanliness

> **Iteration 2 of three.** The user asked for this phase to run **three full rounds** — research
> (an Opus-written plan), then fix (a Sonnet implementation), repeated three times, each round
> finding further improvements beyond the last. Iteration 1 is
> `docs/v1/plans/P39-modularity-and-cleanliness.md`: 28 findings, 27 decisions, 18 commits, all
> landed on `feature/kickoff` (`c0b09b3`..`5d5ce14`), lint/typecheck/build green throughout, zero
> behavior change. This is the second round. Iteration 3 gets its own plan after this one ships.
>
> **What iteration 1 left on the table, and what this round is for.** Iteration 1's own §6 named
> five areas it deliberately refused to enter: adapter internals beyond the meta-level (D15/D19),
> the `@shared/*` alias (§9.3), a lint mechanism for §11's layering rule (D6), `DataGrid.vue`'s
> internals (D13), and anything in `main/`. The user's instruction for this round names three of
> those specifically — the adapter internals, the alias, and the enforcement mechanism — and asks
> that they be **investigated for real** rather than deferred a second time. All three were, in this
> box, against `node_modules` that now exists. §1D and §1E carry the verdicts, with the commands and
> outputs behind them.
>
> **Iteration 1's own predictions were checked, not assumed.** Two held (D15's "four dialect type
> systems stays four functions" — re-verified by diffing all four, §1C F17; D25's "`runCount` stays
> four separate functions" — re-verified, §3's non-change table). **One did not**: F22 predicted
> `DocumentView.vue`/`StreamView.vue`/`KeyValueView.vue` "do not need splitting on their own once
> §1B's shared modules exist." Measured against `c0b09b3` (the commit before iteration 1 started),
> `DocumentView.vue` went 1083 → **1088** lines. It grew. §1B F6 has the numbers and the reason.
>
> **This iteration changes no runtime behavior either**, with one bounded and deliberate exception
> that is *not* runtime: §1D's alias work and §1E's lint rule are **build-configuration** changes.
> They are argued on their merits in D18/D22, their effect on the emitted bundle is measured
> byte-for-byte in §1D F19, and neither is smuggled into a commit that claims to be a pure
> refactor — each gets its own step.

---

## 0. Ground rules for this phase

- **No behavior change, and that is still the acceptance criterion.** Every touched call site must
  produce identical output, identical DOM (including every `data-testid`), identical IPC traffic and
  identical persisted state before and after. The two build-configuration steps (12–16) change no
  runtime code path; F19 measures exactly what does and does not change in the emitted bundle, and
  says so rather than asserting "no change" and hoping.
- **Every finding below was read in the tree, and each carries a `file:line`.** Unlike iteration 1,
  **this box has `node_modules`** (`ls node_modules` → present; `node_modules/.bin/biome --version` →
  `2.5.9`), so claims that could be *run* were run. Where a claim came from an actual execution it
  says so and quotes the output. Where it is a source claim it says that too.
- **Verification was done in a throwaway copy, never in the repo.** Every experiment in §1D/§1E ran
  against a `tar`-copied tree in the session scratchpad with `node_modules` symlinked in — so this
  authoring session modified no file under `/home/user/kira-studio` except this plan.
- **Move before merge; merge only where the duplication is real.** §3's table carries **thirteen
  explicit non-changes**, six of them re-verifications of an iteration-1 decision that turned out to
  be right. A category that turned up nothing says so (§1D F21, §1B F10) rather than manufacturing a
  finding to fill a quota.
- **Extend the homes this codebase already has.** `views/shared/` (P31 D12/D16, P39 D3/D7–D11),
  `renderer/state/`, `engine/adapters/sql-text.ts` and `engine/adapters/errors.ts` (both commissioned
  by iteration 1 for exactly this) are the destinations for every merge below. **One new concept
  appears in this phase**: a `views/shared/useConnectionGate.ts` composable — and `views/shared/`
  already holds one composable of exactly that shape (`useEditBuffer.ts`, P27), so it is a second
  instance of an established pattern, not a new one.
- **No half-migrations (AGENTS.md).** A helper that is hoisted leaves **no** copy behind; an alias
  that is adopted is adopted everywhere it applies in the same step.
- **No new dependency.** One new build-config entry (`resolve.alias` for `main`/`preload`), one new
  `tsconfig.json` `paths` block, one new `biome.json` override. Nothing added to `package.json`.
- Comments per AGENTS.md: only where the code cannot say it for itself. Steps that delete a stale
  comment (§1A F5) delete it rather than rewriting it into something equally decorative.
- `bun run lint`, `bun run typecheck` (node, web, db) and `bun run build` stay green after **every**
  commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. What iteration 1's own merges left behind

Iteration 1 collapsed five page stores, three scanners and three toolbars. Each collapse left a
residue in the callers — the exact question this round was asked to check.

**F1 — the three factory-backed page modules each hand-copy the same eight-line re-export block,
and `dropForTab` is now a pure alias in four of the five stores.** `views/documents/page.ts:9-17`,
`views/keyvalue/page.ts:6-14` and `views/stream/page.ts:6-14` are byte-identical:

```ts
export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;

export function dropForTab(tabId: string): void {
  drop(tabId);
}
```

The five-line re-export is the price of `createPageStore()` returning an object while the callers
expose named exports — real, but the cheaper half. The `dropForTab` wrapper is the finding:
iteration 1's D22 rewrote `views/grid/page.ts`'s `dropForTab` to "the same body as its siblings" but
**left the function**, so today `grid/page.ts:37`, `documents/page.ts:15`, `keyvalue/page.ts:12` and
`stream/page.ts:12` are all `{ drop(tabId); }` — a one-line alias for an export that already exists
beside it. **Only `views/console/resultPages.ts:34` still has a real body**, and it needs one: the
console keys pages `${tabId}:${...}` per result set, so its prefix scan (`resultPages.ts:35-43`) is
the one place the distinction between "drop this key" and "drop this tab" is meaningful.
`state/tabs.ts:28-33` imports all five under five aliased names; four of those five aliases can
simply name `drop`.

**F2 — the three search modules each hand-copy the same `pageSearchApi` literal and the same
`createSearchState` destructure.** The literal is byte-identical in all three —
`views/grid/search.ts:65-72`, `views/documents/search.ts:68-75`, `views/keyvalue/search.ts:65-72`:

```ts
export const pageSearchApi: PageSearchApi<Match> = {
  runSearch, clearSearchState, searchState, matchedRows, pageVersion,
  loadedRowCount: (tabId) => getPage(tabId)?.rowCount ?? 0,
};
```

so is the line above it (`grid/search.ts:25`, `documents/search.ts:20`, `keyvalue/search.ts:24`) and
the re-export beneath it (`:27`, `:22`, `:26`). Every one of the six ingredients is either produced
by `createSearchState()` or is the module's own `runSearch`/`getPage`/`pageVersion`. This is
iteration 1's D9 stopping one level short: it made the *toolbar* generic over the API but left every
view to assemble the API by hand.

**F3 — the zero-width-match inner loop is written out three times, with the same one-line
correctness invariant in each.** `views/grid/search.ts:50-56`, `views/documents/search.ts:54-60`,
`views/keyvalue/search.ts:48-54`:

```ts
pattern.lastIndex = 0;
let m = pattern.exec(text);
while (m) {
  out.push({ row, /* …per-view fields… */ start: m.index, end: m.index + m[0].length });
  if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
  m = pattern.exec(text);
}
```

The comment is byte-identical in all three. A `/(?:)/` or `/x*/` pattern that hangs the renderer is
the kind of bug that gets fixed in one copy and not the others — this is precisely the class of
duplication `pageScan.ts` was created to hold, and it was left outside it.

**F4 — `compilePattern` is exported for nobody, and its own doc comment misdescribes it.**
`views/shared/pageScan.ts:31` exports it; the only reference anywhere in `src/` or `tests/` is
`pageScan.ts:46`, inside `runChunkedScan` (verified by `grep -rnw compilePattern src tests` → two
hits, both in that file). Its comment (`pageScan.ts:29-30`) claims it is *"the contract every search
toolbar depends on to show the error inline rather than as a rejected scan"* — but no toolbar calls
it. `PageSearchToolbar.vue` calls `api.runSearch`, which calls `runChunkedScan`, which calls
`compilePattern`; the synchronous `SyntaxError` still surfaces, but through `runSearch`, not through
this export. The behavior is right; the export and the sentence describing it are not. This one was
created by iteration 1 itself — its §2 shape block listed `compilePattern` as public API before any
caller existed.

**F5 — three stragglers from iteration 1's rename step (step 17 / D24).**

| Straggler | Site | Why it is one |
|---|---|---|
| `views/shared/searchFilter.ts:8` cites `SearchToolbar.vue` | *"so its public shape (and DataGrid.vue/SearchToolbar.vue) is untouched by the move"* | `grid/SearchToolbar.vue` was **deleted** by iteration 1 step 8. The comment now names a file that does not exist. |
| `runStreamSearch` | `views/stream/search.ts:30`, called from `StreamSearchToolbar.vue:13,44,55` | D24 un-prefixed `streamSearchState`→`searchState` and `clearStreamSearchState`→`clearSearchState` in this very file, and stopped there. The other three folders export `runSearch` (`grid/search.ts:29`, `documents/search.ts:38`, `keyvalue/search.ts:30`); this one alone still says the folder's name twice. |
| `documentMenu` / `keyValueMenu` / `streamMenu` | `documents/menu.ts:8`, `keyvalue/menu.ts:12`, `stream/menu.ts:7` | D24 renamed the *files* to `menu.ts` and left the *exports* folder-prefixed — F28's complaint one level down. All three are the per-row context menu, called from an `onRowContextMenu` handler (`DocumentView.vue:442`, `KeyValueView.vue:404`, `StreamView.vue:133`), and `grid/menu.ts:271` already calls that concept **`rowMenu`**. |

### B. The four large view components — F22's prediction, falsified

**F6 — the three non-grid view components did not shrink; one grew.** Measured with
`git show c0b09b3:<file> | wc -l` (the commit immediately before iteration 1's first code step)
against today:

| File | Before P39 | Today | Δ |
|---|---|---|---|
| `views/documents/DocumentView.vue` | 1083 | **1088** | **+5** |
| `views/stream/StreamView.vue` | 1014 | 1010 | −4 |
| `views/keyvalue/KeyValueView.vue` | 962 | 960 | −2 |
| `views/grid/DataGrid.vue` | 1795 | 1758 | −37 (D13's three extractions) |
| `state/tabs.ts` | 627 | 557 | −70 (D12) |

F22 said these three *"do not need splitting on their own once §1B's shared modules exist."* The
shared modules exist; the files did not move. The reason is visible in the diff: iteration 1 removed
a page-size array (F14) and a toolbar mount (F11) from each, and each gave back roughly the same
number of lines in `PageSearchApi` wiring, extra imports (`DocumentView.vue:27-29` and its two
siblings) and the `searchState as docSearchState` re-aliasing at `DocumentView.vue:40`. The
duplication left in these files is **not** the toolbar/page-size kind iteration 1 removed — it is
the per-view scaffolding below.

**F7 — the connection gate is written out six times, and two of the copies say so.**
`connectionStatus` is byte-identical in all six view components:

```ts
const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);
```

at `grid/DataView.vue:25`, `documents/DocumentView.vue:69`, `keyvalue/KeyValueView.vue:41`,
`stream/StreamView.vue:49`, `definition/DefinitionView.vue:35`, `console/ConsoleView.vue:27`.
`needsReconnect` is byte-identical in the same six (`:32`, `:75`, `:47`, `:55`, `:42`, `:34`), and
two of them carry a comment admitting the copy: *"§8.4's gate, copied literally from DataView.vue"*
(`DefinitionView.vue:41`) and *"§8.4's gate, copied literally from DefinitionView.vue"*
(`ConsoleView.vue:33`). `onReconnectAndLoad` is byte-identical in **four** (`DataView.vue:93-100`,
`DocumentView.vue:79-86`, `KeyValueView.vue:51-58`, `DefinitionView.vue:49-56`) and differs in
exactly one line in the other two: `StreamView.vue:104` reads `if (!isBatch.value) await
load(props.tab.id)` (SQS/RabbitMQ never auto-load, `StreamView.vue:85`), and `ConsoleView.vue:38-44`
omits the load entirely. That is a one-argument difference — an optional `onLoad` callback covers
all six exactly.

**F8 — `connectionsState.records.find((r) => r.id === …)` appears twenty-six times, and
`state/connections.ts` offers no accessor.** Twenty-two in `renderer/` outside the store
(`views/shared/celleditor/CellEditorView.vue:64`, `celleditor/state.ts:40`,
`keyvalue/KeyValueView.vue:72`, `definition/DefinitionView.vue:115,135`, `grid/DataView.vue:40`,
`grid/DataGrid.vue:183,208`, `grid/DataToolbar.vue:56`, `grid/FilterToolbar.vue:31`,
`grid/PreviewCommandPanel.vue:25`, `stream/StreamView.vue:70`, `documents/DocumentView.vue:126,136`,
`console/ConsoleView.vue:53`, `workbench/panels/OperationsPanel.vue:55`, `panels/MainView.vue:28`,
`panels/TabStrip.vue:23`, `project/TreeRow.vue:42,49`, `project/FiltersDialog.vue:132`,
`project/filterTree.ts:40`, `project/state/tree.ts:366`), four inside `project/menus.ts`
(`:123,251,299,571`), and four inside `state/connections.ts` itself (`:100,138,171,196`). The
predicate is the same every time; only the `?.color` / `?.kind` / `?.name` tail differs. Nothing in
`state/connections.ts` (204 lines, read in full) exposes a lookup — the store publishes the raw
array and every consumer re-derives the same scan.

**F9 — `state/connections.ts`'s two field patchers are the same function twice.**
`setConnectionColor` (`:167-183`) and `setConnectionReadOnly` (`:185-203`) share a
find-existing → strip `id`/`sortOrder`/`createdAt`/`updatedAt` → `connectionsUpdate({...fields,
<one field>, password: null})` → splice-back body, differing in the overridden field and in
`setConnectionReadOnly`'s reconnect tail (`:198-202`). The same four-field strip appears a third
time in `openEditDialog` (`:103-109`), where it feeds the dialog draft rather than an update.

**F10 — the documents view's own sort-term parser stayed in the component while the grid's was
extracted.** Iteration 1's D13 moved `parseTextSortTerms` out of `DataGrid.vue` into
`views/grid/sortTerms.ts:8` on the grounds that it is *"a function of its arguments with no reactive
or DOM dependency."* `DocumentView.vue:174-197` holds `sortSpecToText`, `SORT_TERM_RE` and
`parseSortText` — a matching pair of pure serializer/parser functions over `SortSpec`, with a
24-line comment block explaining Mongo's sort-document grammar, no reactive or DOM dependency, and a
round-trip contract the comment states explicitly (`:171`: *"must round-trip each other exactly"*).
Same class of code, same folder shape available (`views/documents/` already has `documentRows.ts`,
`ejson.ts`, `filterCompletion.ts` for exactly this kind of module), opposite treatment.

**F11 — the rest of the per-view scaffolding is genuinely per-view, and is not a finding.** Checked
and rejected, so a future round does not re-open them:

- `pathPrefix` — four copies (`DataView.vue:70`, `DocumentView.vue:133`, `KeyValueView.vue:98`,
  `StreamView.vue:77`) that compute **three different strings**: the grid/documents walk every path
  segment, the stream uses the connection name alone, key/value interposes its own `dbLabel`
  (`KeyValueView.vue:82-96`). Three answers, not one repeated three times.
- `iconColor` — four copies with **two different fallbacks**: `var(--kira-fg-muted)` in three
  (`DataView.vue:50`, `DocumentView.vue:129`, `StreamView.vue:73`) and `var(--kira-info)` in
  key/value (`KeyValueView.vue:79`). Merging would change a rendered colour.
- `onToggleSearch`/`onCloseSearch` — three lines each, four copies. A shared helper would take the
  runtime record and return a pair of closures: more machinery than the code.
- The pager block (`DocumentView.vue:245-259` vs `DataToolbar.vue:76-122`) — two copies only, and
  the grid's reads `tab.value` (a nullable computed from a store) where the document's reads
  `props.tab`. Two is the threshold at which this plan stops.

**F12 — `project/menus.ts`, second look: nothing beyond `columnsSectionMenu`.** Read in full (856
lines). It is thirteen `*Menu(row: TreeRowVm)` builders plus a `menuForRow` dispatch (`:63`), three
shared item-builders (`consoleMenuItem:106`, `setAsDefaultMenuItem:250`, `uploadMenuItem:297`), a
`qualifiedNameFor` helper (`:55`), `savedFiltersSubmenu` (`:723`) and `emptyBackgroundMenu` (`:833`).
Every builder is a distinct §8.10 row shape; the near-pairs its own comments flag
(`collectionMenu:405` *"near-copy of relationMenu"*, `prefixMenu:526` vs `namespaceMenu:503`,
`bucketMenu:314` vs `containerMenu:265`) differ in which items they include and in which order §8.10
specifies — collapsing them behind a options-bag builder would replace thirteen readable literals
with one function taking eight booleans. **D23 stands, and so does the rest of the file.** Its one
real structural problem is not internal to it — see F18.

### C. `engine/adapters/` internals — the area iteration 1 excluded

Iteration 1's §6 excluded *"error-classification logic, `typeClassFor`, catalog SQL, pagination
strategy, `caps` literals, or any adapter's folder contents beyond D14/D16/D17/D18."* Re-entered.

**F13 — `stripOneTrailingSemicolon` is byte-identical in four adapters.**
`clickhouse/definition.ts:13`, `mysql-family/definition.ts:92`, `postgres/definition.ts:66`,
`sqlite/definition.ts:18`:

```ts
function stripOneTrailingSemicolon(text: string): string {
  const match = /;\s*$/.exec(text);
  return match ? text.slice(0, text.length - match[0].length) : text;
}
```

Not one character differs, and not one character of it is dialect-shaped — a `;` terminates a
statement in every SQL dialect this app speaks. `sql-text.ts:5-7`'s charter (*"the genuinely shared,
driver-agnostic glue … kept out of the adapter folders because duplicating it would guarantee they
drift"*) names this exactly.

**F14 — `singleStatusPage` is four copies of a 24-line function that differ in one string.**
`postgres/console.ts:80`, `mysql-family/console.ts:109`, `sqlite/console.ts:32`,
`clickhouse/console.ts:26`. Identical column descriptor, identical `createTabularPageBuilder` +
`appendRow` + `PagePosition` literal + `finish`. The only difference is `dataType`: `'text'` in
three, `'String'` in ClickHouse (`clickhouse/console.ts:31`) — which is correct, since that string
reaches the grid's type tooltip and ClickHouse's type vocabulary really does spell it `String`. One
parameter.

**F15 — the read-only refusal is written out ten times, byte-for-byte.** This is F18's sentence
shape, missed by iteration 1 because F18 inventoried only `describe`/`definition`/`downloadObject`/
`execute`:

```ts
if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');
```

`postgres/mutate.ts:127`, `mysql-family/mutate.ts:125`, `sqlite/mutate.ts:129`,
`clickhouse/mutate.ts:109`, `mongo/mutate.ts:81`, `redis/mutate.ts:96`, `s3/mutate.ts:214`,
`sqs/mutate.ts:89`, `rabbitmq/mutate.ts:126`, `kafka/produce.ts:63` — every write-capable adapter,
one line each, identical message. `adapter.ts:111` documents the contract in the interface
(*"Throws `E_UNSUPPORTED` if the connection is read-only"*), which is what makes this a single
concern with ten implementations rather than ten independent decisions.

**F16 — three mutation guards are byte-identical across the SQL adapters.**

| Guard | Sites | Difference |
|---|---|---|
| `assertColumnsKnown` | `postgres/mutate.ts:87`, `mysql-family/mutate.ts:85`, `sqlite/mutate.ts:86`, `clickhouse/mutate.ts:93` | **none** — all four read only `target.columns`, exactly as `resolveProjection` did before D17 hoisted it |
| `assertAffectedExactlyOne` | `postgres/mutate.ts:113`, `mysql-family/mutate.ts:111`, `sqlite/mutate.ts:114` | **none** |
| `orderedOps` + its `KIND_RANK` | `postgres/mutate.ts:59-62`, `mysql-family/mutate.ts:57-60`, `sqlite/mutate.ts:58-61` | **none** — `{ delete: 0, update: 1, insert: 2 }` in all three, and the ordering is a P5 semantic rule, not a dialect one |

A fourth, `assertKeyIsPrimaryKey` (`postgres/mutate.ts:96`, `mysql-family/mutate.ts:94`,
`sqlite/mutate.ts:97`), is identical **except** the `E_UNSUPPORTED` message's qualified-name
spelling — `${schema}.${relation}` / `${database}.${table}` / `${schema}.${table}`. That is a real,
user-visible string difference, and it is parameterizable the same way D16's `unsupported(kind,
what)` parameterized its sentence: one extra argument carrying the already-built display name.

**F17 — D15's `typeClassFor` claim re-verified by diffing all four, and it is correct.** Iteration 1
asserted without diffing that these are *"four dialect type systems … stays four functions."* They
are:

| Adapter | Site | Why it cannot be shared |
|---|---|---|
| `postgres` | `read.ts:31` | `int2`/`int4`/`int8`/`float4`/`float8`/`money`, `_`-prefix and `[]`-suffix array detection, `bytea`, `jsonb`; falls back to `'text'` |
| `mysql-family` | `read.ts:32` | `tinyint(1)` → `boolean` **before** the numeric test (a MySQL-specific idiom), `mediumint`, `bit`, `year`, the blob family, `geometry`; falls back to `'text'` |
| `clickhouse` | `read.ts:74` | operates on `unwrapType()`/`baseTypeName()` output (`Nullable(T)`, `LowCardinality(T)`), matches `Int|UInt|Float|Decimal` by prefix and three `Set`s by exact name; falls back to `'other'` |
| `sqlite` | `read.ts:37` | affinity rules, not type names — `includes('INT')`, `includes('CHAR')`, `'ANY'` → `'other'`; takes `string \| null` where the other three take `string`; falls back to `'number'` (the NUMERIC catch-all, `read.ts:47`) |

Four different input vocabularies, two different input types, and **four different fallbacks**. A
shared function would be a switch on dialect wearing a helper's clothes. Confirmed, no change.

**F18 — the one thing found while diffing `read.ts` that is *not* a cleanliness item, and is
therefore not fixed here.** `quoteIdent` is byte-identical in `postgres/read.ts:24` and
`sqlite/read.ts:26`, and `mysql-family/read.ts:25` differs only in the quote character — all three
open with `if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL
byte');`. **`clickhouse/read.ts:18` has no such guard.** Whether that is a real gap or a
deliberate omission is a *behavior* question about a security-adjacent input check, and answering it
either way changes what ClickHouse does with a NUL-bearing identifier. It is recorded for **P40**
(§8), not touched by a phase whose contract is "no behavior change."

### D. Layering, organization, and the `@shared/*` alias

**F19 — `@shared/*` in `engine/`/`main/`: the alias is broken there today, the failure mode is
silent, and the fix is two config lines. Verified by running the build, not by reading it.**

Iteration 1's §6 declined this as *"a build-configuration change with a real chance of breaking
`test:db`."* Every step of that worry was reproduced and then resolved, in a scratchpad copy of the
tree with `node_modules` symlinked in.

*Step 1 — the current state is a trap, not merely an inconsistency.* `tsconfig.node.json:11-14`
declares `"@shared/*": ["./src/shared/*"]` and includes `src/main`, `src/preload`, `src/engine`.
`electron.vite.config.ts` declares `resolve.alias` **only inside the `renderer` block** (`:37-42`);
`main` and `preload` have none, and electron-vite adds no default (`grep -n alias
node_modules/electron-vite/dist/chunks/lib-*.js` → one unrelated hit, `chunkAlias`). So writing
`@shared/...` in engine code **typechecks clean and fails at build**. Reproduced:

```
$ sed -i "s|'../shared/protocol/engine-ops'|'@shared/protocol/engine-ops'|" src/engine/control.ts
$ bun run typecheck:node        # passes, silently
$ bun run build
[vite]: Rollup failed to resolve import "@shared/protocol/engine-ops" from ".../src/engine/control.ts"
```

That is worse than an inconsistency: `typecheck` is the fast loop, so the wrong half of the codebase
looks like it accepts the alias.

*Step 2 — `test:db` was the real risk, and it is real.* Bun resolves `paths` from the nearest
`tsconfig.json` above the **importing** file. Walking up from `src/engine/` reaches the root
`tsconfig.json`, which is solution-style (`"files": []`, references only) with **no**
`compilerOptions` at all — so a `@shared/*` import inside an engine file is unresolvable to Bun even
though `tests/db/tsconfig.json` maps it fine for the spec files themselves. Reproduced:

```
$ bun test tests/db/postgres.spec.ts
error: Cannot find module '@shared/protocol/engine-ops' from '.../src/engine/scheduler/ops.ts'
```

*Step 3 — both are fixed by config, and the fix was run end to end.* Adding
`{"compilerOptions": {"paths": {"@shared/*": ["./src/shared/*"]}}}` to the root `tsconfig.json`
(harmless to `tsc`/`tsgo`, which compile nothing there — `"files": []`) and a three-line
`resolve.alias` to the `main` and `preload` blocks of `electron.vite.config.ts`. Then **all 254
relative shared-imports across 116 files in `src/engine`, `src/main` and `src/preload`** were
rewritten to `@shared/*` and everything was run:

| Command | Result |
|---|---|
| `bun run typecheck` (node + web + db + electron-db) | green |
| `bun run build` | green |
| `bun run lint` | 62 errors, **all** `assist/source/organizeImports` — `biome check --write` fixes every one, then `bun run lint` is clean |
| `bun test tests/db` | **12 pass / 10 fail**, zero `Cannot find module`; identical to the unmodified repo's own `12 pass / 10 fail`, failing only at `isDockerAvailable()` and `node:sqlite` — the two documented sandbox gates (AGENTS.md) |
| `bunx esbuild tests/electron-db/kafka.spec.ts --bundle …` (the `test:db:kafka` build step) | green, 9.9mb bundle |

*Step 4 — what the emitted bundle actually does, measured.* `out/` was diffed against a baseline
build of the untouched repo:

- `out/renderer/**` — **byte-for-byte identical**, including the `index-Cq10Phfx.js` content hash.
- `out/main/index.js`, `out/preload/index.js` — byte-for-byte identical.
- `out/main/engine.js` — same byte size (28 823), and **zero** diff lines once chunk filenames are
  normalized (the file references chunks whose hashes moved).
- `out/main/chunks/*` — 11 of 16 byte-identical. The other 5 differ by **exactly one moved line
  each**: e.g. `const mariadb = require("mariadb");` swapping places with an adjacent `require`,
  because `biome check --write`'s `organizeImports` re-sorts `@shared/...` differently from
  `../../shared/...`. No statement is added, removed or altered; the reordered specifiers are a bare
  npm package and a Zod-schema module with no dependency on each other.

That last bullet is why this is stated as *measured* rather than as "no change." It is the honest
extent of the difference, and it is inert.

**F20 — `@renderer/*` is declared in three places and used zero times.**
`tsconfig.node.json:13`, `tsconfig.web.json:14` and `electron.vite.config.ts:40` all map it;
`grep -rn '@renderer/' src tests scripts` → **0 hits**. `tsconfig.node.json`'s copy is doubly inert:
that project does not even include `src/renderer`. Three lines of configuration that can only ever
mislead — the next session that sees `@renderer` in a tsconfig will reasonably assume the renderer
uses it, and it does not (135 `@shared/` imports, 0 `@renderer/`).

**F21 — `main/`, `engine/scheduler/`, `engine/cache/` and `workbench/state/` were re-examined
against the "does a reviewer already know where X lives" test, and none yields a finding.** Stated
plainly rather than padded into one:

- **`main/`** — 9 root modules + `ipc/` (14 files, ≤87 lines each, one per domain plus
  `registry.ts:1-28` and a shared `errors.ts` wrapper at `main/ipc/errors.ts:18-27`) + `storage/`
  (`db.ts`, `migrate.ts`, `migrations/`, `schema/`, `repos/`) — exactly §11's diagram, and
  `main/window.ts`'s single-file shape is §11's own documented exception. No duplication found; the
  largest file is `connections.ts` at 409 lines and it is one cohesive service.
- **`engine/scheduler/`** holds one file (`ops.ts`, 106 lines) — a one-file folder, which normally
  reads as a level that carries no information. But §11 argues for it explicitly (*"pulled apart
  because they are genuinely different lifecycles … keeping them separate now avoids a forced split
  later when Kafka/SQS streaming ops need scheduler changes"*), and `engine/cache/` beside it has
  four. Deliberate, documented, left alone.
- **`workbench/state/`** — iteration 1's D1 left `tooltip.ts` and `engine.ts` there and claimed each
  has three importers rooted in `workbench/`. Re-verified: `tooltip.ts` ← `workbench/AppTooltip.vue:6`
  (relative `./state/tooltip`), `App.vue:16`, `main.ts:18`; `engine.ts` ← `workbench/StatusBar.vue:9`,
  `App.vue:15`. Both have their real consumer inside `workbench/`. D1 stands.
- **`project/state/`** holds one file too (`tree.ts`, 447 lines). Same shape as `engine/scheduler/`
  and, unlike it, undocumented — but the alternative (a flat `project/tree.ts` beside
  `project/filterTree.ts` and `project/filter.ts`) is worse, not better: the folder is what
  distinguishes the reactive store from the two pure helpers that operate on it.

**F22 — `project/` and `views/` depend on each other, in both directions, and iteration 1 never
looked.** Iteration 1 drove `views/* → workbench/*` and `views/* → views/*` to zero (re-verified:
`grep -rn "workbench/" src/renderer/views` → nothing). It did not measure the `project/` edge:

- **`project/ → views/`, six edges** — `project/ProjectTree.vue:8-11` imports `reload` from all four
  data-view state modules; `project/menus.ts:31-32` imports `runCount` from `views/documents/state`
  and `runCount`/`setFilter`/`setProjection`/`setSort` from `views/grid/state`.
- **`views/ → project/`, two edges** — `views/definition/ColumnsSection.vue:3` imports
  `columnsSectionMenu` from `project/menus`; `views/console/completion.ts:4` imports
  `rowKey`/`treeState` from `project/state/tree`.

There is no *module*-level cycle today (`views/grid/state.ts` imports nothing from `project/`), so
nothing is broken. But D23's rationale for leaving `columnsSectionMenu` in `project/menus.ts` was
that it *"would trade a `views → project` edge (which §11 does not forbid) for a `views/definition →
views/grid` edge (which §11 does forbid)"* — and that argument rests on `views → project` being the
cheap direction, which the six edges going the other way make untrue. §3 D14 records this and
declines to restructure it, with reasons.

**F23 — §11's `shared/protocol/` line is still short two files, which is the unaddressed half of
iteration 1's own F8.** F8 observed: *"§11's listing is also silently short two protocol files that
do exist: `protocol/data-ops.ts` and `protocol/page.ts`."* D5 moved `port.ts` into the folder and D27
rewrote the §11 tree — but `SPEC.md:1008`'s protocol line still reads `ipc.ts, port.ts,
engine-ops.ts`, while the folder holds five files, one of which (`page.ts`, 611 lines) is the largest
module in `src/shared/`. A finding this phase raised and then only half-fixed is worse than one it
never raised.

### E. Enforcement — can Biome actually hold §11's layering rule?

**F24 — yes. Biome 2.5.9's `noRestrictedImports` matches relative specifiers with gitignore-style
globs, works inside `.vue` `<script setup>`, scopes correctly through `overrides.includes`, and
produces zero false positives on today's tree. Every clause verified by running it.**

Iteration 1's D6 declined the rule because *"the exact capability of Biome 2.5.9's
`noRestrictedImports` for relative-path globs is unconfirmed"* (that box had no `node_modules`). This
one does. `node_modules/.bin/biome explain noRestrictedImports` documents `patterns[].group` as
*"gitignore-style patterns"*, **since v2.2.0** — this project is on 2.5.9 (`biome --version`).

Tested in the scratchpad copy, with this override appended to `biome.json`:

```json
{
  "includes": ["src/renderer/views/**"],
  "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": { "patterns": [
    { "group": ["**/workbench/**"], "message": "SPEC §11: views/* must not import from workbench/* …" },
    { "group": ["../grid/**", "../documents/**", "../keyvalue/**", "../stream/**", "../console/**",
                "../definition/**", "../../grid/**", "../../documents/**", "../../keyvalue/**",
                "../../stream/**", "../../console/**", "../../definition/**"],
      "message": "SPEC §11: views/<kind>/* must not import another views/<kind>/* — use views/shared/ …" }
  ] } } } } }
```

| Claim | How it was tested | Result |
|---|---|---|
| matches a relative specifier | temp `views/grid/__probe.ts` with `from '../../workbench/state/tooltip'` | **flagged**, `lint/style/noRestrictedImports` |
| works inside a `.vue` SFC | same import injected into `views/grid/DataView.vue`'s `<script setup>` | **flagged**, at `DataView.vue:2:39` |
| depth-independent | `**/workbench/**` vs both `../../workbench/…` and a deeper caller | **flagged** at both depths |
| catches sideways imports at both depths | `views/documents/__p1.ts` (`../grid/page`) and `views/shared/celleditor/__p2.ts` (`../../grid/page`) | **both flagged** |
| does **not** catch legal downward imports | `views/stream/__p3.ts` with `../shared/columns` | **not flagged** |
| zero false positives today | probes removed, `biome check src/renderer/views` | *"Checked 80 files … No fixes applied."* |
| whole repo still clean with the rule in place | `bun run lint` on the full tree | clean |
| fails the build | `level: "error"` | `bun run lint` exits 1 on a violation |

This is the guard iteration 1's §9.1 asked the user about, at the moment it named as the cheapest —
*"after this phase the count is zero — which is the cheapest moment to add a guard."* The count is
still zero.

### F. Leftovers

**F25 — `tests/db/rabbitmq.spec.ts` is not a text file, for the same reason
`views/celleditor/state.ts` wasn't.** `file tests/db/rabbitmq.spec.ts` reports `data`, not text.
Line 719 holds two **raw NUL bytes**:

```ts
expect(cmd).not.toContain(fixture.config.password ?? '<NUL>never-empty-guard<NUL>');
```

Iteration 1's F25/D21 fixed exactly this in `src/renderer/views/celleditor/state.ts` and its
acceptance checklist scoped the guarantee to *"no file under `src/` is reported as binary"* — so the
one in `tests/` survived. It has the same cost: `grep`/`ripgrep` classify the file as binary and skip
it, so every repo-wide search silently omits it. It bit this very investigation twice — `grep -rn
"@shared/" tests` printed `grep: tests/db/rabbitmq.spec.ts: binary file matches` instead of that
file's three `@shared` imports, and the same happened enumerating which `src/` modules `tests/db`
imports. A `\0` escape produces a byte-identical string at runtime. Full sweep of `src` + `tests`
confirms this is the **only** remaining non-text source file.

**F26 — twelve exported functions and constants have no importer anywhere in `src/` or `tests/`.**
Distinct from iteration 1's F24 (six *unreachable* exports, deleted): every one of these **is
called**, but only from inside its own module. The `export` keyword is the finding — it makes each
module's public surface claim something the codebase does not use. Verified per name with
`grep -rnw <name> src tests --include=*.ts --include=*.vue`, each returning exactly its declaration
plus its intra-module call sites:

| Symbol | Site | Internal caller(s) |
|---|---|---|
| `compilePattern` | `views/shared/pageScan.ts:31` | `:46` (and F4's wrong comment) |
| `openPalette` | `shortcuts/state.ts:40` | `:51` |
| `loadVisibility` | `project/state/tree.ts:112` | `:147` |
| `dropConnectionState` | `project/state/tree.ts:223` | `:276` |
| `relativeTime` | `views/shared/celleditor/timestamp.ts:233` | `:249` |
| `isPathExpanded` | `views/documents/documentRows.ts:103` | `:117` |
| `referencedByMenuItems` | `views/grid/menu.ts:124` | `:171` |
| `buildPlan` | `views/grid/pendingChanges.ts:184` | `:207`, `:217` |
| `defaultDraft` | `state/connections.ts:63` | `:87` |
| `applyAppearance` | `state/settings.ts:19` | `:37`, `:55`, `:61` |
| `primaryKeyFromColumns` | `engine/adapters/sqlite/catalog.ts:160` | `:335` |
| `typeClassForField` | `engine/adapters/mysql-family/console.ts:47` | `:142` |

**F27 — every `tests/db/*.spec.ts` mixes both spellings of a shared import in the same file.** All
ten specs (plus `s3.spec.ts` twice) import some shared modules through `@shared/…` and one through
`../../src/shared/protocol/page`: `postgres.spec.ts:2-4` vs `:13`, `mariadb.spec.ts:2-3` vs `:10`,
`mysql.spec.ts:10`, `clickhouse.spec.ts:8`, `sqlite.spec.ts:9`, `mongo.spec.ts:9`,
`redis.spec.ts:7`, `s3.spec.ts:11,12`, `sqs.spec.ts:8`, `rabbitmq.spec.ts` (invisible to grep until
F25 is fixed). `tests/db/tsconfig.json:12` already maps `@shared/*`, so the relative spelling is a
leftover, not a workaround.

---

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/shared/pageStore.ts — MOD. F1: the three callers stop hand-copying the
// re-export block, and `dropForTab` stops existing where it is an alias for `drop`.
// No signature changes; `createPageStore` already returns everything needed.
```

```ts
// src/renderer/views/shared/pageSearch.ts — MOD (F2/F3). The API literal every view assembled
// by hand becomes one factory; the scan-a-string inner loop becomes one function.

/** Walks every match of `pattern` in `text`, guarding the zero-width case exactly as the three
 *  copies do today. `emit` receives the offsets; the caller adds its own per-view fields. */
export function eachMatch(pattern: RegExp, text: string, emit: (start: number, end: number) => void): void;

/** F2: builds the searchState/clearSearchState/matchedRows trio AND the PageSearchApi literal
 *  the three view folders each wrote out identically. `runSearch` and the page module's
 *  pageVersion/getPage are the only per-view ingredients. */
export function createPageSearch<M extends { row: number }>(opts: {
  runSearch: PageSearchApi<M>['runSearch'];
  pageVersion: { n: number };
  loadedRowCount(tabId: string): number;
}): {
  searchState: Record<string, { matches: M[]; index: number }>;
  clearSearchState(tabId: string): void;
  matchedRows(tabId: string): number[] | null;
  api: PageSearchApi<M>;
};
```

```ts
// src/renderer/views/shared/useConnectionGate.ts — NEW (F7). The §8.4 reconnect gate, once.
// A composable in views/shared/, exactly as useEditBuffer.ts (P27) already is.
export function useConnectionGate(
  tab: () => { id: string; connectionId: string | null },
  /** Each view's own load; StreamView passes a closure carrying its `isBatch` check, and
   *  ConsoleView passes nothing (it hydrates without loading). Today's six bodies, unchanged. */
  onLoad?: () => Promise<void> | void,
): {
  connectionStatus: ComputedRef<ConnectionStatus>;
  needsReconnect: ComputedRef<boolean>;
  onReconnectAndLoad(): Promise<void>;
};
```

```ts
// src/renderer/state/connections.ts — additions only (F8/F9).
/** The `records.find(r => r.id === id)` twenty-six call sites re-derive. Returns undefined for a
 *  null/undefined id so every existing `props.tab.connectionId ? … : undefined` ternary collapses. */
export function connectionRecord(id: string | null | undefined): ConnectionSummary | undefined;

/** F9: the find → strip id/sortOrder/createdAt/updatedAt → connectionsUpdate → splice-back body
 *  setConnectionColor and setConnectionReadOnly share. Not exported — the two public functions
 *  keep their names, signatures and (readOnly's reconnect tail included) their exact behavior. */
function patchConnectionFields(id: string, patch: Partial<ConnectionInput>): Promise<void>;
```

```ts
// src/renderer/views/documents/sortDocument.ts — NEW (F10), mirroring views/grid/sortTerms.ts.
export function sortSpecToText(sort: SortSpec | null): string;
export function parseSortText(text: string): SortSpec | null;
```

```ts
// src/engine/adapters/sql-text.ts — additions only (F13/F14).
/** Removes one trailing `;` plus its whitespace, or returns the text unchanged. Four adapters'
 *  definition.ts had this character-for-character; nothing in it is dialect-shaped. */
export function stripOneTrailingSemicolon(text: string): string;

/** The one-column, one-row "status" page a console statement with no result set returns.
 *  `dataType` is the one thing the four copies disagreed on — 'text' for postgres/mysql-family/
 *  sqlite, 'String' for clickhouse, each reaching the grid's type tooltip verbatim. */
export function singleStatusPage(text: string, dataType: string): TabularPage;
```

```ts
// src/engine/adapters/errors.ts — additions only (F15).
/** The tenth-time-identical read-only refusal (adapter.ts:111's own contract sentence).
 *  Message preserved byte-for-byte: 'connection is read-only'. */
export function assertWritable(readOnly: boolean): void;
```

```ts
// src/engine/adapters/sql-mutate.ts — NEW (F16). The SQL adapters' shared mutation guards, kept
// out of sql-text.ts because they are about MutationRowOp/ColumnMeta semantics, not SQL strings.
export function orderedOps(ops: MutationRowOp[]): MutationRowOp[];
export function assertColumnsKnown(columns: ColumnMeta[], names: string[]): void;
export function assertAffectedExactlyOne(kind: string, n: number): void;
/** `qualifiedName` is the already-built display string each adapter spells its own way
 *  (schema.relation / database.table / schema.table) — passed in so all three messages stay
 *  byte-identical to today's (D16's precedent). */
export function assertKeyIsPrimaryKey(
  primaryKey: string[] | null, key: Record<string, string | null>, qualifiedName: string,
): void;
```

```jsonc
// tsconfig.json — the root, solution-style file gains a paths map (F19). It compiles nothing
// ("files": []), so this is inert to tsgo/vue-tsc and is read only by Bun's own resolver, which
// walks up from src/engine/** and today finds no mapping at all.
{ "compilerOptions": { "paths": { "@shared/*": ["./src/shared/*"] } }, "files": [], "references": [ … ] }
```

```ts
// electron.vite.config.ts — the `main` and `preload` blocks gain what `renderer` already has
// (F19). Without this, `@shared/...` in engine/main code typechecks and then fails at Rollup.
resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
```

```jsonc
// biome.json — one override, the §11 layering rule as an actual check (F24, D22).
{ "includes": ["src/renderer/views/**"],
  "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": {
    "patterns": [ { "group": ["**/workbench/**"], "message": "SPEC §11: …" },
                  { "group": ["../grid/**", … , "../../definition/**"], "message": "SPEC §11: …" } ]
  } } } } } }
```

---

## 3. Decisions

### What iteration 1's merges left behind

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`dropForTab` is deleted from `views/grid/page.ts`, `documents/page.ts`, `keyvalue/page.ts` and `stream/page.ts`;** `state/tabs.ts:28-33` imports `drop` from each instead. **`views/console/resultPages.ts` keeps its own `dropForTab`** and its own name. | F1. Four of the five are `{ drop(tabId); }` — an alias for the export beside them, kept alive only by an import list. The console's is the one that means something different (`resultPages.ts:35-43`'s prefix scan over `${tabId}:` keys), so it keeps both functions and the distinction stays visible instead of being flattened away. `dropAllPagesForTab` (`tabs.ts:44-50`) keeps its five calls and its comment. |
| D2 | **The three factory-backed page modules keep their five-line re-export block.** | F1's cheaper half, and the alternative is worse: `export * from` would leak the store's internals, and a barrel would hide which module owns which page type. Five `export const x = store.x` lines are the honest cost of "a factory returns an object, a module exports names." Recorded so iteration 3 does not re-open it. |
| D3 | **`views/shared/pageSearch.ts` gains `createPageSearch()`; `grid/search.ts`, `documents/search.ts` and `keyvalue/search.ts` each call it once** and lose their `createSearchState` destructure, their re-export line and their hand-written `pageSearchApi` literal. `createSearchState` stops being exported from `pageScan.ts` (it gains exactly one caller: `createPageSearch`). | F2. D9 made the toolbar generic and left every view to assemble the API by hand — the same six ingredients, in the same order, three times. Putting the assembly beside the interface it satisfies is the point of having declared that interface. |
| D4 | **`views/shared/pageScan.ts` gains `eachMatch(pattern, text, emit)`; the three per-row bodies call it.** | F3. The zero-width-match guard is a one-line invariant with a subtle failure mode (a hung frame loop on `/x*/`) written out three times with an identical comment. One copy is how it stays correct in all three. Each view keeps its own `out.push({...})` — the per-row fields are the only thing that genuinely differs. |
| D5 | **`compilePattern` loses its `export`; its comment is corrected to describe what it does.** | F4. Nothing imports it, and its claim to be *"the contract every search toolbar depends on"* is false — the toolbars depend on `runSearch`. A comment that names a relationship the code does not have is worse than no comment (AGENTS.md). |
| D6 | **The three F5 stragglers are cleared:** `searchFilter.ts:8`'s reference to the deleted `SearchToolbar.vue` is corrected to `PageSearchToolbar.vue`; `runStreamSearch` → `runSearch`; `documentMenu`/`keyValueMenu`/`streamMenu` → `rowMenu`. | F5. D24's own argument, applied to the three places it stopped short of: *"the folder already says `documents`, so `documents/docPage.ts` says it twice."* `documents/menu.ts`'s `documentMenu` says it twice for the same reason, and `grid/menu.ts:271` already established `rowMenu` as this codebase's name for exactly this concept. All three are typecheck-guarded renames across 8 call sites. |

### The view components

| # | Decision | Rationale |
|---|----------|-----------|
| D7 | **`views/shared/useConnectionGate.ts` (new) replaces the `connectionStatus`/`needsReconnect`/`onReconnectAndLoad` trio in all six view components.** Stream passes a closure carrying its `isBatch` check; Console passes no `onLoad`. | F7. Byte-identical in six, six and four files respectively, with two of the copies' own comments admitting the copy (`DefinitionView.vue:41`, `ConsoleView.vue:33`). §8.4's reconnect gate is one rule about one piece of app state, and it currently has six implementations that can drift independently. `views/shared/useEditBuffer.ts` (P27) is the precedent for a composable living here; the composable imports only `state/connections` and `state/tabs`, so the layering stays downward. |
| D8 | **`state/connections.ts` exports `connectionRecord(id)`; the twenty-two call sites outside the store use it.** The four inside `project/menus.ts` and the four inside `connections.ts` itself use it too. | F8. Twenty-six copies of one predicate, in a codebase where `connectionsState.records` is a plain array that a future phase might reasonably make a `Map`. The accessor takes `string \| null \| undefined` so the `connectionId ? … : undefined` ternary at seven of the sites collapses into the call. Purely mechanical; `typecheck` is the proof. |
| D9 | **`setConnectionColor` and `setConnectionReadOnly` share one private `patchConnectionFields(id, patch)`.** Both keep their names, signatures and behavior, `setConnectionReadOnly`'s reconnect tail (`:198-202`) included. | F9. The four-field strip appears three times in one 204-line file and is the kind of thing that silently stops matching `ConnectionInput` when a field is added. Not exported — nothing outside the store patches a connection. |
| D10 | **`sortSpecToText`/`parseSortText`/`SORT_TERM_RE` move out of `DocumentView.vue` into `views/documents/sortDocument.ts`.** | F10, and D13's own test verbatim: *"functions of their arguments with no reactive or DOM dependency."* Iteration 1 applied it to the grid and not to the identical case one folder over. The 24-line grammar comment moves with them, where it documents a module instead of interrupting a component. |
| D11 | **Nothing else comes out of `DocumentView.vue`, `StreamView.vue` or `KeyValueView.vue`, and `DataGrid.vue` is untouched.** These three files stay ~1000 lines each. | F11 checked the four remaining candidates and every one fails: `pathPrefix` computes three different strings, `iconColor` has two different fallbacks (merging would change a rendered colour), `onToggleSearch`/`onCloseSearch` are three lines, and the pager exists in two places with different tab sources. F6's honest conclusion is that these components are large because a data view *is* large, not because of copied plumbing — the copied plumbing was §1B F7's gate, and D7 takes it. D13's reasoning for `DataGrid.vue` (P29 tuned that scroll path against `budgets.spec.ts` with deliberately primitive-valued computeds) is unchanged by anything found this round. |
| D12 | **`project/menus.ts` is not split, and `columnsSectionMenu` still stays.** | F12: read in full, and the thirteen builders are thirteen §8.10 row shapes, not one shape repeated. Its size is the size of the right-click matrix. The near-pairs its own comments flag differ in item membership and order; an options-bag builder would be one function taking eight booleans in place of thirteen readable literals. |

### The adapters

| # | Decision | Rationale |
|---|----------|-----------|
| D13 | **`stripOneTrailingSemicolon` and `singleStatusPage` move into `engine/adapters/sql-text.ts`;** the four (and four) copies are deleted. `singleStatusPage` takes `dataType` as a second argument. | F13/F14, and `sql-text.ts:5-7`'s charter, which iteration 1 quoted while hoisting `resolveProjection`/`safeInt` and then stopped. Neither is dialect-shaped: `;` ends a statement everywhere, and the status page is a `PagePosition` literal plus one `appendRow`. `dataType` is a parameter rather than a constant precisely because ClickHouse's `'String'` reaches the grid's type tooltip and must not become `'text'`. |
| D14 | **`assertWritable(readOnly)` joins `unsupported()`/`noQueryConsole()` in `engine/adapters/errors.ts`;** the ten copies call it. Message text preserved verbatim. | F15. This is D16's own finding, one sentence shape wider — `adapter.ts:111` states the contract in the interface, so ten adapters implementing it ten times is the definition of a shared concern. It is a `void`-returning assertion rather than a `never`-returning throw because it is conditional; the call sites lose the `if` and read `assertWritable(readOnly);`. The message reaches the user through the op log (`main/oplog.ts`), so it is preserved byte-for-byte — a refactor, not a copy edit. |
| D15 | **`engine/adapters/sql-mutate.ts` (new) holds `orderedOps`, `assertColumnsKnown`, `assertAffectedExactlyOne` and `assertKeyIsPrimaryKey`;** postgres, mysql-family, sqlite and (for `assertColumnsKnown`) clickhouse call them. `assertColumnsKnown` takes `ColumnMeta[]`; `assertKeyIsPrimaryKey` takes the already-built qualified name. | F16. Three are byte-identical with zero dialect content, and the fourth differs only in a display string. A **new file** rather than more of `sql-text.ts` because these are about `MutationRowOp`/`ColumnMeta` semantics (P5's op ordering, P5 D1/D2's key rule), not SQL text — `sql-text.ts`'s own header draws that line, and widening it to "anything two SQL adapters share" is how a helper module becomes a junk drawer. `assertColumnsKnown` takes the column list for exactly D17's reason: the four `ReadTarget`s genuinely differ and the guard reads nothing else off them. |
| D16 | **`typeClassFor` stays four functions. D15 (iteration 1) is confirmed, this time by diff.** | F17. Four input vocabularies, two input types (`string` vs `string \| null`), and four different fallbacks (`'text'`, `'text'`, `'other'`, `'number'`). Recorded as a verified re-check so iteration 3 does not spend the same hour. |
| D17 | **`clickhouse/read.ts:18`'s missing NUL guard is not touched.** It is written up in §8 for **P40**. | F18. Adding the guard changes what ClickHouse does with a NUL-bearing identifier; removing the other three changes what Postgres/MySQL/SQLite do. Either is a behavior change, and a phase whose contract is "no behavior change" is the wrong place to decide a security-adjacent question. Naming it and handing it to the phase that is allowed to change behavior is the honest move — the same one iteration 1's D12 made with `state/tabs.ts`'s `patchChanged` divergence. |
| D18 | **No other adapter internals change.** Catalog SQL, pagination strategy, `caps` literals, `mutate.ts`'s per-dialect renderers, the `mariadb/`↔`mysql/` profile split, and every `errors.ts` body stay exactly as they are. | The `mutate.ts` files were diffed pairwise (postgres vs sqlite: placeholder syntax `$n` vs `?`, `SqliteParam` vs `unknown[]`, a 3-segment vs 2-segment path shape) — real dialect differences around the four guards D15 takes. `mariadb/caps.ts` and `mysql/caps.ts` are identical literals **on purpose** (P34 D10: *"stated per engine rather than shared — if MySQL's capabilities ever diverge … this literal is where that gets said"*), which is a decision, not drift. |

### Layering, aliases and enforcement

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | **`@shared/*` becomes usable everywhere: root `tsconfig.json` gains a `paths` map, and `electron.vite.config.ts`'s `main`/`preload` blocks gain `resolve.alias`. Then all 254 relative shared-imports in `src/engine`, `src/main` and `src/preload` — and the twelve in `tests/db/*.spec.ts` — become `@shared/…`.** | F19, and iteration 1's §9.3 asked the user precisely this. The refusal was reasonable in a box with no `node_modules`; in this one every step was executed. What tipped it from "inconsistency" to "worth doing" is not symmetry — it is that the current state is a **trap**: `@shared/…` in engine code typechecks green and fails at `bun run build`, and the fast loop is the one that lies. The `test:db` risk was real (Bun cannot resolve it from `src/engine/**` today) and is closed by the root `paths` map, verified by `bun test tests/db` producing the baseline's exact 12 pass / 10 fail with zero resolution errors. |
| D20 | **The alias work is three commits, not one: config first (inert on its own), then `src/`, then `tests/`.** Each is independently revertable. | The config commit changes no import and therefore cannot change the build — it is the piece that makes the next two possible, and isolating it means a bisect lands on the right half. §5 pins what each owes. |
| D21 | **`@renderer/*` is deleted from `tsconfig.node.json:13`, `tsconfig.web.json:14` and `electron.vite.config.ts:40`.** | F20: zero uses across `src`, `tests` and `scripts`. An alias nobody uses is a claim about the codebase that is false, and `tsconfig.node.json`'s copy points at a directory that project does not even compile. Deleting it costs nothing; if a later phase wants it, adding it back is one line in each file. |
| D22 | **`biome.json` gains one `overrides` entry enforcing §11's two layering rules for `src/renderer/views/**`, at `error` level.** | F24, and the user has now answered §9.1's question by asking for this round. Every clause was executed, not read: relative-specifier globs match, `.vue` `<script setup>` is covered, both depths are caught, `../shared/**` is correctly allowed, and the full tree lints clean with the rule active. **This is the one piece of new machinery in the phase**, and it is declared as such rather than folded into a refactor commit — the eighteen violations iteration 1 found accumulated over ~20 phases because nothing but review caught them, and the count is zero exactly twice: now, and never again if nothing holds it there. |
| D23 | **The rule covers `views/* → workbench/*` and `views/<kind>/* → views/<kind>/*` only. It does not restrict `views/ → project/`, `project/ → views/`, or anything outside `src/renderer/views/`.** | Those are the two rules §11 actually states (`SPEC.md:1074-1078`). Encoding a rule the spec does not make would be this phase inventing architecture, which is not its job. F22's `project/ ↔ views/` edge is a finding, not a settled rule — D24. |
| D24 | **The `project/ ↔ views/` bidirectional dependency is recorded and left alone.** No module moves. | F22. Every available fix trades one problem for a worse one: moving `columnsSectionMenu` into `views/definition/` creates the `views/definition → views/grid` edge §11 explicitly forbids (D23 of iteration 1, still correct); moving it into `views/shared/` would make `views/shared/` — the leaf every view depends on — import `views/grid/state`, inverting the one property that makes `views/shared/` safe. The real fix is a command registry in `renderer/state/` that both `project/` and `views/definition/` dispatch through (the pattern `state/tabRuntime.ts:1-6` already uses to break exactly this class of cycle, by its own comment). That is an architectural change with real behavior surface — it belongs to iteration 3 as a considered proposal, not to a cleanliness commit. §8 carries it. |
| D25 | **`main/`, `engine/scheduler/`, `engine/cache/`, `workbench/state/` and `project/state/` change nothing.** | F21. Each was re-examined against the same test iteration 1 applied to `views/*` and each passed or is documented. Saying "checked, nothing found" is the correct output of a review that finds nothing; inventing a move for symmetry is not. |

### Cleanup

| # | Decision | Rationale |
|---|----------|-----------|
| D26 | **`tests/db/rabbitmq.spec.ts:719`'s two raw NUL bytes become `\0` escapes.** | F25, and D21 of iteration 1 verbatim, one folder over: *"Identical string at runtime, and the file stops being invisible to every `grep`/`rg` invocation in the repo."* It cost this investigation two silently-incomplete searches. The acceptance checklist below widens the guarantee from `src/` to the whole repo so a third instance cannot hide. |
| D27 | **The twelve F26 symbols lose their `export` keyword.** Types and interfaces are **not** touched. | F26. Each is called only from inside its own module; dropping `export` is proven safe by `typecheck` and shrinks twelve modules' claimed public API to what the codebase actually uses. Types/interfaces are excluded deliberately — an exported type documents a shape even with no importer, and stripping them would churn a hundred declarations for nothing. |
| D28 | **`runCount` stays four separate functions. D25 (iteration 1) is confirmed.** | Re-read all four (`grid/state.ts`, `documents/state.ts`, `keyvalue/state.ts`, `stream/state.ts`). They differ in the tab finder, in the `filter` argument (the tab's filter / its trimmed search text / `null` / `null`) and — the grid only — in a `refresh: rt.count?.stale === true` field carrying D18's cache semantics. A shared helper would take a finder, a filter extractor, a runtime and a refresh flag: more parameters than the eleven lines it replaces. `keyvalue` and `stream` are byte-identical to *each other*, which is two, not four. |
| D29 | **`stop()` stays five three-line functions.** | Iteration 1's step 10 already reduced each to `stopOp(runtime[tabId])`. What is left is the per-view `runtime` lookup, which is the only thing that differs and cannot be hoisted without a registry. Three lines × five is the floor here, recorded so it is not re-found. |
| D30 | **SPEC.md and ARCHITECTURE.md are edited by the implementing session** (standing practice): §10 gains a P39-iteration-2 note; §11's `shared/protocol/` line is corrected to list all five files (F23 — iteration 1's own F8, unfinished); §11's `views/shared/` paragraph gains `useConnectionGate.ts`; §11's *"the dependency graph stays a tree"* bullet notes that the rule is now enforced by `biome.json` rather than by review alone; §11's adapter-shape bullet notes `sql-mutate.ts` beside `sql-text.ts` and `errors.ts`; a new §11 note records that `@shared/*` is the one spelling everywhere and that `@renderer/*` no longer exists. | F23 is the direct evidence for why this matters: a phase that changes the tree and not the sentence describing it leaves exactly the drift it was called to remove. |

---

## 4. Implementation order

Seventeen commits. Each is one focused sitting, independently reviewable, leaves `lint`/`typecheck`/
`build` green, and is behavior-identical on its own. The residue cleanups (1–11) come before the
build-configuration work (12–16) so every earlier diff reads against today's import spellings, and
the layering rule (16) comes after every move so it can be added to an already-clean tree.

1. **`fix(tests): the rabbitmq spec's NUL separators become \0 escapes`** — D26. One line
   (`tests/db/rabbitmq.spec.ts:719`), two bytes. `file` must report text afterwards, and
   `grep -c "@shared" tests/db/rabbitmq.spec.ts` must return a number instead of a binary-file
   notice. Done first so every later grep in this phase can see the file.
2. **`refactor(views): the page modules drop their dropForTab aliases`** — D1. Four deletions,
   `state/tabs.ts:28-33`'s import block, `views/console/resultPages.ts` untouched.
3. **`refactor(views): one createPageSearch factory behind the three search modules`** — D3.
   `views/shared/pageSearch.ts` gains the factory; three modules lose ~10 lines each;
   `createSearchState` stops being exported from `pageScan.ts`.
4. **`refactor(views): the match loop's zero-width guard exists once`** — D4/D5. `eachMatch` in
   `pageScan.ts`, three per-row bodies call it, `compilePattern` un-exported and its comment fixed.
5. **`refactor(views): rowMenu across the view folders, runSearch in stream/`** — D6. Three menu
   exports renamed, `runStreamSearch` → `runSearch`, `searchFilter.ts:8`'s dead reference corrected.
   Pure renames plus one comment.
6. **`refactor(views): one connection gate for the six view components`** — D7.
   `views/shared/useConnectionGate.ts` (new); six components lose 12–18 lines each and gain one
   call. The reviewable claim: the six `onReconnectAndLoad` bodies still do exactly what they do
   today, Stream's `isBatch` check and Console's missing `load` included.
7. **`refactor(state): one connectionRecord accessor`** — D8. Twenty-six call sites across
   `views/`, `workbench/`, `project/` and `state/connections.ts` itself.
8. **`refactor(state): one patcher behind the connection field setters`** — D9.
   `state/connections.ts` only.
9. **`refactor(documents): move the sort-document parser out of DocumentView.vue`** — D10.
   `views/documents/sortDocument.ts` (new), two functions plus one regex plus their comment block.
10. **`refactor(engine): hoist stripOneTrailingSemicolon and singleStatusPage into sql-text.ts`** —
    D13. Eight copies deleted; four `singleStatusPage` call sites gain one argument.
11. **`refactor(engine): shared guards for the SQL mutation paths and the read-only refusal`** —
    D14/D15. `adapters/sql-mutate.ts` (new) + `assertWritable` in `adapters/errors.ts`; ten
    read-only guards and thirteen mutation-guard copies removed. Every message string preserved —
    diff the strings, that is the reviewable claim.
12. **`chore: drop export from the module-private helpers`** — D27. Twelve `export` keywords across
    twelve files. `bun run typecheck` (all four projects) is the proof.
13. **`build: make @shared resolvable from main, engine and tests`** — D19/D20, config only. Root
    `tsconfig.json` gains `compilerOptions.paths`; `electron.vite.config.ts`'s `main` and `preload`
    blocks gain `resolve.alias`. **No import changes in this commit** — it is verifiably inert, and
    `bun run build`'s output must be byte-identical to the previous commit's.
14. **`refactor(engine): engine, main and preload import shared through @shared`** — D19. 254
    imports across 116 files. Run `bun run format` in the same commit — Biome's `organizeImports`
    re-sorts the changed import blocks and `lint` fails otherwise (verified: 62 errors, all
    `assist/source/organizeImports`, all auto-fixed). The widest-reaching commit in the phase, kept
    alone for that reason.
15. **`test(db): the db specs import shared through @shared too`** — D19/F27. Twelve imports across
    ten spec files, removing the last mixed-spelling files in the repo.
16. **`build: drop the unused @renderer alias`** — D21. Three lines, three files.
17. **`build(lint): enforce SPEC §11's layering rule with biome`** *and* **`docs: SPEC §11 and
    ARCHITECTURE for P39 iteration 2`** — D22/D30. One `biome.json` override plus the documentation
    edits, including this plan if it is not already committed. The commit message should carry the
    two greps whose output is now guaranteed by a check rather than by review.

---

## 5. Verification

**Nothing in this phase is verified by a new test**, for iteration 1's reason: the existing suites
already assert the behavior these steps must not change, and an assertion written alongside a
refactor proves only that the new code does what the new code does.

Unlike iteration 1, several claims here **were** executed in this box (`node_modules` present) —
those are marked ▶ and their outputs are in §1D/§1E. Per AGENTS.md, only `smoke`, `startup`,
`workbench`, `connections`, `secrets` and `sqlite` run without Docker; everything else needs the
macOS/Colima box or CI. **The phase is not done until the full `test:ui` and `test:db` suites have
been run green in an environment that can run them** — before the phase is called finished, not step
by step.

| Step | Suites / checks that must be re-run green | What they pin |
|---|---|---|
| 1 | `bun run test:db` (rabbitmq scenario 24) ▶ *resolution and parse already confirmed here* | The password-leak guard still compares against the same sentinel string. |
| 2 | `leaks.spec.ts` (`:103`/`:146` read `window.__kiraRetainedBytes`), `memory.spec.ts`, `perf.spec.ts:55`, `tabs.spec.ts` | Closing a tab still frees every store's pages; the five-way retained-bytes sum at `main.ts:49-54` is unchanged. |
| 3–4 | `data-view.spec.ts` (search block), `mongo.spec.ts`, `redis.spec.ts` | Match counts, prev/next cycling, the invalid-regex inline error, the page-replaced re-scan (P31 D22), and the zero-width-pattern case in all three views. |
| 5 | `data-view.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts`, full `typecheck` | Renames only — every right-click surface still opens the same menu; the stream find widget still works. |
| 6 | `tabs.spec.ts`, `data-view.spec.ts`, `console.spec.ts`, `definition.spec.ts`, `mongo.spec.ts`, `redis.spec.ts`, `kafka.spec.ts` | A restored tab still shows only "Reconnect & load"; pressing it reconnects, hydrates and loads — and for a **batch** stream tab (SQS/RabbitMQ) still does **not** load, and for a console tab still hydrates without loading. This is the sharpest step in the phase. |
| 7–8 | `connections.spec.ts`, `tree.spec.ts`, `interaction.spec.ts`, `tooltips.spec.ts`, `mutations.spec.ts` | Connection colours/rails everywhere they render; the read-only toggle still forces a reconnect; the edit dialog still reveals and pre-fills. |
| 9 | `mongo.spec.ts` | The Mongo sort box still round-trips `{ field: 1 }` ↔ `SortSpec`, bare/quoted keys and `asc`/`desc` included. |
| 10–11 | `bun run test:db` in full (postgres, mariadb, mysql, sqlite, clickhouse, mongo, redis, s3, sqs, rabbitmq) + `bun run test:db:kafka` | Every `E_UNSUPPORTED` message identical (the specs assert message text and code — e.g. rabbitmq scenario 25); DDL text still has its trailing semicolon handled identically; a console statement with no result set still returns the same one-row status page with ClickHouse's `'String'` intact; mutation guards still refuse unknown columns, partial keys and multi-row effects with the same messages. |
| 12 | `bun run typecheck` (all four projects) | Nothing outside those twelve modules referenced them. |
| 13 | `bun run build`, then `diff -rq` the previous commit's `out/` against this one's | **Byte-identical.** A config commit that changes an import spelling nowhere must change the bundle nowhere. |
| 14 | ▶ `bun run typecheck` (green), ▶ `bun run build` (green), ▶ `bun run lint` after `format` (clean), ▶ `bun test tests/db` (12 pass / 10 fail — the baseline's exact numbers, zero resolution errors), ▶ the `test:db:kafka` esbuild bundle (green) — then full `test:ui` and `test:db` on a box that can run them | That the alias resolves through **four** independent resolvers: tsgo/vue-tsc (`paths`), Rollup (`resolve.alias`), Bun (root `paths`) and esbuild (root `paths`). §1D F19 records what changes in `out/`: renderer, `main/index.js`, `preload/index.js` and `main/engine.js` byte-identical; 5 of 16 lazily-imported adapter chunks differ by one reordered `require` line each. |
| 15 | ▶ `bun run typecheck:db`, then full `test:db` | The specs still resolve both spellings' worth of modules through one. |
| 16 | `bun run typecheck` (all four), `bun run build` | Nothing was relying on the alias that nothing was using. |
| 17 | ▶ `bun run lint` (clean with the rule active, verified here), plus a deliberate violation added and removed to confirm it fails | The rule catches `views/* → workbench/*` and sideways `views/<kind>/*` imports at both nesting depths, in `.ts` and in `.vue`, and permits `views/*/… → views/shared/…`. |

---

## 6. Explicitly out of scope

- **`DataGrid.vue`'s virtualization, selection, inline editor, menus or render VM** (D11). Unchanged
  from iteration 1's D13: P29 tuned that path against `budgets.spec.ts`/`perf.spec.ts` with
  deliberately primitive-valued computeds, and restructuring it is a performance change wearing a
  refactor's clothes. F6 measured that the file did shrink 37 lines and stopped there on purpose.
- **Splitting `DocumentView.vue`/`StreamView.vue`/`KeyValueView.vue`** beyond D7's gate and D10's
  parser (D11) — F11 checked the four remaining candidates and each fails on merit, not on nerve.
- **Adapter internals beyond D13/D14/D15**: catalog SQL, pagination strategy, `caps` literals, the
  per-dialect `mutate.ts` renderers, `typeClassFor` (D16), and every `errors.ts` body (iteration 1's
  D15, unchanged).
- **`clickhouse/read.ts:18`'s missing NUL guard** (D17) — a behavior question, handed to P40.
- **Restructuring the `project/ ↔ views/` dependency** (D24) — a real finding with no cheap fix;
  §8 hands the proposal to iteration 3.
- **Merging `runCount` (D28) or `stop()` (D29)**, and merging `stream/search.ts` or
  `StreamSearchToolbar.vue` into the shared scanner/toolbar (iteration 1's D8/D9, unchanged — it
  would change what a Kafka search finds).
- **Any change to `main/`'s or `engine/`'s file layout** (D25) beyond step 14's import spellings and
  the two new adapter-level modules.
- **Extending the layering rule beyond §11's two stated rules** (D23), and any lint rule for
  `engine/`, `main/` or `shared/`.
- **New tests** (§5), **new dependencies**, **any migration**, **any change to a persisted tab's
  `state_json` shape or the wire protocol**, **themes** (P38 is still skipped by user direction),
  and **`docs/design/kira-design-system/`**.

---

## 7. Acceptance checklist

- [ ] `file $(git ls-files 'src/**' 'tests/**')` reports **no** non-text source file anywhere in the
      repo, and `grep -r` never prints "binary file matches" over `src/` or `tests/`.
- [ ] `grep -rn "workbench/" src/renderer/views` returns **nothing**, and `bun run lint` **fails**
      if a `views/* → workbench/*` or sideways `views/<kind>/* → views/<kind>/*` import is added —
      demonstrated once with a throwaway import, then reverted.
- [ ] `dropForTab` appears **once** in `src/renderer` (`views/console/resultPages.ts`);
      `pageSearchApi` is constructed **once**; the zero-width-match guard appears **once**;
      `connectionsState.records.find` appears **once**.
- [ ] `connectionStatus`/`needsReconnect`/`onReconnectAndLoad` each appear **once** in
      `src/renderer`, and all six view components still render the same reconnect gate — Stream's
      batch case and Console's no-load case included.
- [ ] `stripOneTrailingSemicolon`, `singleStatusPage`, `orderedOps`, `assertColumnsKnown`,
      `assertAffectedExactlyOne`, `assertKeyIsPrimaryKey` and `'connection is read-only'` each
      appear **once** in `src/engine`.
- [ ] **No `E_UNSUPPORTED` or `E_QUERY` message text changed anywhere** — diff the string literals
      across the phase, not just the tests.
- [ ] `grep -rEn "from '(\.\./)+shared/" src` returns **nothing**; `grep -rn "src/shared/" tests`
      returns **nothing**; `grep -rn "@renderer" .` returns **nothing** outside `docs/`.
- [ ] `bun test tests/db` reports the same pass/fail counts as before the phase, with **zero**
      `Cannot find module` errors, and `bunx esbuild tests/electron-db/kafka.spec.ts --bundle …`
      succeeds.
- [ ] Step 13's commit produces a **byte-identical** `out/`; step 14's differs only as §1D F19
      documents (renderer + `main/index.js` + `preload/index.js` + `main/engine.js` identical, five
      adapter chunks differing by reordered `require` lines only).
- [ ] Every `data-testid` in the app is unchanged: `test:ui` passes with **zero** selector edits in
      `tests/ui/`, and the diff of `tests/` for this phase is import paths and step 1's two bytes.
- [ ] The twelve F26 symbols are no longer exported, and `bun run typecheck` is clean.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db) and `bun run build` clean after **every**
      commit; full `test:ui` and `test:db` green on a box that can run them before the phase is done.
- [ ] SPEC §11's `shared/protocol/` line lists all five files, §11's layering bullet names the check
      that now enforces it, and ARCHITECTURE.md still matches the adapter tree.

---

## 8. Open questions, and what iteration 3 should look at

1. **The `project/ ↔ views/` dependency (F22/D24) is the largest structural finding this round did
   not fix.** Six edges from `project/` into four view state modules, two edges back. The proposal
   for iteration 3: a small command registry in `renderer/state/` — `reloadTabOfKind(kind, id)` and
   the two or three `views/grid/state` operations `project/menus.ts` reaches for — using the same
   leaf-registry inversion `state/tabRuntime.ts:1-6` already documents itself as being. It would
   make `views/` a true leaf of `project/` and would let `columnsSectionMenu` finally live in
   `views/definition/`, which is where P19 D9's intent actually points. It is not a cleanliness
   commit: it changes who calls what at runtime, so it wants its own plan and its own test pass.
2. **`clickhouse/read.ts:18` has no NUL-byte guard where its three siblings do** (F18/D17). Drift or
   a decision? If drift, the fix is one line and belongs in **P40**, where a behavior change is
   allowed and testable.
3. **Should the layering check extend beyond `views/`?** D22 encodes only the two rules §11 states.
   The same mechanism could pin "only `main/storage/repos/**` imports the Drizzle instance"
   (`SPEC.md:900`), "only `main/storage/db.ts` imports `node:sqlite`" (§11 D2), "only
   `renderer/bridge/**` touches `ipcRenderer`/`MessagePort`" (§11) and "only `s3/transfer.ts`
   imports `node:fs`" (§11) — four more claims §11 makes in prose and nothing enforces. Each is one
   `overrides` entry of the exact shape F24 verified. Worth an iteration-3 step if wanted.
4. **`views/shared/` is now 16 files plus `celleditor/`.** Iteration 1's D26 kept it flat when it
   held fourteen, on the grounds that a `page/` subfolder *"would also want `searchFilter.ts` and
   `columns.ts` moved into it."* At 16–17 that is still true and the prefix grouping still works,
   but it is the folder most likely to cross the line in iteration 3 — worth a deliberate re-look
   then rather than a drift into twenty-five.
5. **The key/value and stream find widgets still have no coverage for P31 D17's filter toggle**
   (iteration 1's §9.5, unchanged: `grep -rl "search-filter-rows" tests/ui` → `data-view.spec.ts`,
   `mongo.spec.ts` only). Steps 3 and 4 touch that path in all three views and their key/value
   guarantee still rests on `typecheck` plus review rather than on a spec. Still the first thing the
   queued tests phase should pick up.
6. **`state/tabs.ts`'s `patchChanged` divergence** (iteration 1's F16/§9.2) is still open and still
   preserved verbatim behind D12's `skipUnchanged` flag. Nothing this round changes that; **P40**
   still owns the answer.
