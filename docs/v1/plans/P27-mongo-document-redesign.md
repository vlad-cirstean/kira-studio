# P27 — The Mongo document view: primary-key previews, first-layer expansion, BSON types, and the render-speed fix

> SPEC.md §10's **P27** row, from a single user sweep. The ask, verbatim:
>
> 1. *"In the mongo view the previews shold be only the primary key, by default all expanded, and
>    the actual expanded thing to be spaced properly but only the first layer of keys expanded. so
>    there will be next the edit button also an expand/colaps button and the delete one."*
> 2. *"The cell editor should be hidden by default but it s functionality moved into the main edit
>    area when the doc is expanded. by features I mean json beautify, the bytes count and the
>    revert button."*
> 3. *"Also in the filters bar I should be able to use objectid. and can the objectId object be
>    parsed in the actual document as well? if nit actual ObjectId obj, maybe just a string. See
>    how othe mongo clients handle this thing"*
> 4. *"Then fix the rendering speed for mongo, is very slow."*
>
> **Why one phase and not four.** All four land inside one 899-line component and the two leaf
> modules under it. (1) and (4) are the *same edit*: the reason the view is slow is that every
> expanded document mounts a CodeMirror `EditorView` (F2) and every collapsed one re-scans its full
> body on each render (F3) — so "expand everything by default" is impossible to ship *without*
> replacing the row renderer, and replacing the row renderer is the performance fix. (3) is where
> the new renderer gets its scalars from: the body arrives as **canonical** extended JSON (F5), so
> the same parse that produces "first layer of keys" also produces the `{"$oid": …}` node that has
> to become an `ObjectId`. (2) is the other half of (1): the ask is to move three controls out of a
> panel and into the row, which only means anything once the row has an edit area worth putting
> them in. Splitting these would mean writing the document-row renderer twice.
>
> **Hard dependency: P26 lands first.** P26 moves the cell-editor panel from a workbench-global
> singleton (`workbench/panels/CellEditorPanel.vue`, gated by `WorkbenchShell.vue:23`) to a
> per-view-owned component, and its SPEC row states outright that *"a view kind can opt out of it
> entirely (Mongo's document view has no real use for it in its current form, see P27)"*. **§4's
> step 8 is that opt-out and must not land before P26.** Every other step here is independent of
> P26 and can proceed in parallel with it: nothing else in this plan touches
> `state/cellSelection.ts`, `WorkbenchShell.vue` or `CellEditorPanel.vue`. If P26 slips, steps 1–7
> and 9–11 still ship a correct phase; step 8 is then the first commit of the P26 follow-up rather
> than a partial implementation left behind here.

## 0. Ground rules for this phase

- **The renderer never gets a second copy of a page.** §2.2's rule holds exactly as `docPage.ts`
  already applies it: the `DocumentPage` is frozen (`docPage.ts:17-21`), rows are decoded lazily
  into a plain non-reactive `Map`, and the version counter is the only reactive thing. The parsed
  document trees this phase adds live in **that same non-reactive cache**, keyed by row, dropped
  with the page — never in a `reactive()`/`ref()` (D21).
- **Rendering a document must not instantiate an editor.** CodeMirror is for editing. A read-only
  document body is data, and §2.1's *"No DOM node per cell for off-screen rows"* plus SPEC §2.1's
  own *"Long lists (tree, log panel, **document view**) are virtualized too"* apply to it.
- **One implementation, not two similar ones.** P24's design-cohesion rule. The three cell-editor
  features the ask names are extracted into shared modules that both surfaces consume (D25–D27),
  never copied; the virtualizer is the app's existing `workbench/VirtualList.vue`, widened, never a
  second one (D18).
- **No sideways view imports.** §11: *"`views/*` are siblings that depend downward on shared state,
  never sideways on each other."* This is why `beautify.ts` moves to the renderer root rather than
  `views/documents/` importing `views/celleditor/` (D25).
- **No new dependency.** `bson`'s `EJSON` is already in the engine; the renderer parses with
  `JSON.parse` and recognises the extended-JSON wrappers by shape. No `bson` in the renderer — it
  would put a driver-adjacent library in the process §2.1 forbids one in.
- **A filter that the app itself hands you must work.** F14 is the concrete bug behind ask (3): the
  string *Copy `_id`* puts on the clipboard is the one spelling the filter box cannot execute.
  Fixing the display without fixing that round trip would be a half-implementation.
- **Every value stays losslessly editable.** Canonical extended JSON is what makes an int32 come
  back as an int32. Nothing in this phase silently downgrades a type on the way through the editor
  (D14, D16).
- Comments per AGENTS.md: only where the code cannot say it for itself. Every `D` below that
  encodes a non-obvious constraint gets one line at its implementation site.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every step;
  `xvfb-run -a bun run test:ui` from step 5 on, and `bun run test:db` on step 4 (the only step that
  changes an adapter). Per `AGENTS.md`, container-backed suites cannot run in Claude Code's Linux
  web container — they must be run on the macOS/Colima box before this phase is called done.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings (verified against the tree, not assumed)

### Rendering and performance

**F1 — the document list is not virtualized, and it is the only long list in the app that isn't.**
`DocumentView.vue:640-723` renders `.list-body` as a plain `overflow-y: auto` div (`:803-807`) with
`v-for="i in rowIndices"` (`:648`), where `rowIndices` (`:289-292`) is
`Array.from({ length: rt.rowCount })`. Every row of the page is a live DOM subtree. The default
page size is **100** (`shared/domain/tabs.ts:195-197`) and the toolbar's own picker offers **10 000**
(`DocumentView.vue:203-209`). Every sibling list goes through `workbench/VirtualList.vue`:
`ProjectTree.vue:167`, `OperationsPanel.vue:201` (`row-height: 18`), and — decisively —
`ConsoleResultGrid.vue:197-208`, which virtualizes a **document** result list at `row-height: 96`
with a plain `<pre>` per row. SPEC §2.1 names this view by name: *"Long lists (tree, log panel,
document view) are virtualized too."*

**F2 — every expanded document mounts a full CodeMirror `EditorView`, and this is the dominant
cost.** `DocumentView.vue:689-713` puts `<CodeMirrorHost … :read-only="true">` inside `.doc-body`,
which `:878-884` fixes at `height: 220px`. `CodeMirrorHost.vue:131-154` constructs, per instance,
an `EditorState` carrying `lineNumbers()`, `highlightSpecialChars()`, `EditorView.lineWrapping`,
`keymap.of(defaultKeymap)`, `syntaxHighlighting(kiraHighlightStyle)`, the JSON Lezer grammar
(`editor/languages.ts`) and four `Compartment`s, then `new EditorView(...)`. It is the heaviest
per-instance component in the app, and today it is instantiated **once per expanded row**. The ask
is that every document be expanded by default — which against today's code means 100 `EditorView`s
on first paint at the default page size, and 10 000 at the largest.

**F3 — the collapsed preview re-scans the entire body, per row, on every render.** `previewLine`
(`DocumentView.vue:313-316`) is `body.replace(/\s+/g, ' ').trim()` over the whole EJSON body,
*then* sliced to 200 characters, and it is called from the template (`:675`) — so it is not
memoized by anything. Any reactive tick that re-renders the list re-runs it for all rows: expanding
one document (`toggleExpanded` replaces `tab.state.expanded` wholesale, `state.ts:241-246`),
selecting one (`rt.selectedRow`), or a page load bumping `pageVersion.n`. A body may be up to
`MAX_CELL_BYTES` = 64 KB (`shared/protocol/page.ts:145,148`), so a single expand click can churn
several megabytes of string allocation before a frame lands.

**F4 — the template resolves each row through a function call, roughly a dozen times per row.**
`rowAt` (`DocumentView.vue:301-304`) reads `pageVersion.n` and performs two `Map` lookups per call.
The row markup calls it at `:649, :651, :653, :654 (×2), :666, :667, :670, :674, :675, :683 (×2),
:689, :710, :715`, and `isExpanded(rowAt(i)?.id ?? '')` four more times (`:651, :666, :670, :689`).
Nothing is destructured into a per-row value first.

**F5 — the wire bodies are *canonical* extended JSON, the most verbose EJSON dialect there is, and
the app's two Mongo surfaces disagree about which dialect the user reads.** `read.ts:123` is
`EJSON.stringify(doc, { relaxed: false })` and `read.ts:22`'s `idText` the same, so an `_id`
arrives as `{"$oid":"507f…"}`, an int32 as `{"$numberInt":"5"}`, and a date as
`{"$date":{"$numberLong":"1700000000000"}}`. `console.ts:74-75,92` matches. But
`definition.ts:14` renders the definition view's Source pane with `{ relaxed: true }` — so the same
collection's creation options and its documents are spelled differently two tabs apart.

**F6 — the expand map is persisted to SQLite, keyed by that same verbose id.**
`documentTabStateSchema.expanded` is `z.record(z.string(), z.boolean())`
(`shared/domain/tabs.ts:66-75`); `toggleExpanded` and `setAllExpanded` (`state.ts:241-252`) write it
through `patchDocumentTabState` → `saveDebounced()` (`state/tabs.ts:567-572`, a 1 s debounce onto
`control.tabsSave(tabsState.tabs)`). *Expand all* on a 10 000-row page therefore writes 10 000 keys
of ~35 characters each into that tab's `state_json` row.

### Row affordances

**F7 — the row head has expand and Edit, but no Delete.** `DocumentView.vue:661-686` is
`.doc-head`: `expand-toggle` (`:662-673`), `.doc-id` (`:674`), `.doc-preview` (`:675`), then one
`IconButton icon="edit"` (`:678-684`). Delete exists only on the row's context menu
(`documentMenu.ts:46-56`), behind a `window.confirm`. The toolbar records the asymmetry in its own
comment: *"this collection has no delete affordance in the toolbar (deletion lives on the row's own
context menu)"* (`DocumentView.vue:545-546`).

**F8 — the collapsed row shows the whole document and spells `_id` raw; the design mockup shows
neither.** `.doc-id` renders `documentRow().id` verbatim — i.e. `{"$oid":"507f…"}` — beside a
200-character body snippet. `docs/v1/design/kira-design-system/parts/bodies/Documents.html`'s
`.doc-row` rows show `<span class="doc-id">65f2a10c4b1e</span>`, a `<span class="p-badge">7
fields</span>` and one edit button — and its **expanded** body renders
`ObjectId("65f2a10c4b1f")` and `ISODate("2026-08-23T07:58:41Z")`, shell form, not `$oid`/`$date`.
The mockup has been describing ask (1) and half of ask (3) since before either was raised.

**F9 — expansion is one boolean per document; there is no notion of a layer or a path inside one.**
`isExpanded(id)` (`DocumentView.vue:306-308`) reads `tab.state.expanded[id]`. "Only the first layer
of keys expanded" has nowhere to live in the current model, and neither does "expand this nested
object further".

**F10 — `onGoToMatch` finds its row with a DOM query, which virtualization breaks.**
`DocumentView.vue:279-287` expands the matched document, then
`listBodyRef.value?.querySelector('[data-id="…"]')` and `el?.scrollIntoView(…)`. Once off-screen
rows are not in the DOM, that selector returns `null` and Go-to-match silently does nothing.

**F11 — `isIdNull` is imported and never used** (`DocumentView.vue:27`). `docPage.ts:69-73` exports
it for a caller that does not exist. Verified `bunx biome check src/renderer/views/documents/DocumentView.vue`
is clean, so lint will not catch it.

### The cell editor

**F12 — the panel is global, selection-gated, and for Mongo it is a second read-only JSON viewer
under the first one.** `CellEditorPanel.vue` mounts `CellEditorView` unconditionally;
`WorkbenchShell.vue:23` gates its height on `cellSelectionState.current !== null`.
`DocumentView.vue:371-400` publishes the *whole document body* into that slot on every
`selectedRow`/`pageVersion` change, with a synthetic `ColumnDescriptor`
(`name: 'document'`, `typeClass: 'json'`, `isPrimaryKey: true`) and **no** `onEdit`/`onRevert` — and
`cellSelection.ts:27-33` says exactly what that means: *"the panel forces read-only whenever this is
absent"*. So a Mongo user gets a panel that can display the document and change nothing about it,
below a list that already displays it.

**F13 — beautify, byte count and revert are three pieces of `CellEditorView.vue` and nothing else
can reach them.** The buffer state is `doc`/`beautifyFailure`/`formattedMode`/`formattedForDoc` and
the derived `formatted` (`CellEditorView.vue:99-112`); `applyBeautify` is `:249-262`; `resetBuffer`
is `:271-280`; `isDirty` is `:283`; the byte count lives inside `statusLine` (`:342-354`) via the
module-scoped `statusEncoder` (`:26-27`) and `formatBytes` (`src/renderer/format.ts`). None of it is
exported. `beautify.ts` itself is already pure and reusable — its only obstacle is
`beautify.ts:1`'s `import type { CellFormat } from './formats'`, a dispatch dependency on the cell
editor's own format vocabulary; `beautifyJson` (`:243`) and `beautifyXml` (`:504`) are already
standalone module-private functions.

### ObjectId and BSON types

**F14 — the filter bar already accepts `ObjectId("…")`, nothing tells the user so, and the string
the app hands them to filter by is the one spelling it cannot execute.** `literal.ts:99-106`
registers `ObjectId`, `ISODate`, `Date`, `NumberLong`, `NumberInt` and `NumberDecimal` as
constructor literals, and every filter runs through `parseFilterObject` (`:256-266`) —
`state.ts:83` sends the box's text verbatim. So `{ _id: ObjectId('507f…') }` works **today**. But:
`mongoFilterCandidates` (`filterCompletion.ts`) offers only field names and `MONGO_QUERY_OPERATORS`
(`views/shared/mongoVocabulary.ts:5-25`) — no constructor is in the vocabulary; nothing in the UI
mentions one; and `grep -rn ObjectId tests/` matches only `tests/db/fixtures/0003_mongo_seed.ts`'s
own seed import, so no test exercises it. Meanwhile `documentMenu.ts:38-44`'s *Copy `_id`* copies
`documentRow().id`, i.e. `{"$oid":"507f…"}`; pasting that back as `{ _id: {"$oid": "507f…"} }`
*parses* (it is a legal object literal) and then fails server-side, because `parseJson5Literal`
produces a plain `{ $oid: … }` object and Mongo rejects `$oid` as an unknown operator.

**F15 — the same view has two Mongo literal grammars, and the document editor has the stricter
one.** `mutate.ts:96-101` (replace) and `:138-143` (insert) parse the edited body with bare
`EJSON.parse`, and `parseIdKey` (`:33-45`) does the same for the key. So a user who types into the
document editor the exact `ObjectId("…")` the filter box two rows above accepts gets
`malformed document JSON`.

**F16 — how the established clients resolve this, since the ask says to check.** MongoDB Compass
displays documents in extended JSON and, because its editor runs in *strict* mode, **cannot** use
the `ObjectId` constructor there — you must write `{"$oid": "…"}`. Its **query bar** is the
opposite: the docs state plainly that *"MongoDB does not allow you to query using extended JSON"*
and that the query must be `{"_id": ObjectId('…')}`. That split is precisely F14, shipped as a
documented product behaviour. Studio 3T's Tree View and NoSQLBooster's tree/JSON views take the
other road: a typed tree where a value renders in shell form with its BSON type shown alongside,
and NoSQLBooster 10.1 specifically *"improves how ObjectId fields are displayed in the treegrid and
document viewers"* by adding type/`generation_time` information to the ObjectId's tooltip. This
app's own design system already picked the second road (F8's mockup renders `ObjectId(…)` and
`ISODate(…)`), so the decision below is to follow it and to close Compass's split rather than
reproduce it (D11–D16).

Sources: [View Documents in Compass](https://www.mongodb.com/docs/compass/documents/view/) ·
[ObjectId() (mongosh method)](https://www.mongodb.com/docs/manual/reference/method/ObjectId/) ·
[Studio 3T — Tree View](https://studio3t.com/knowledge-base/articles/tree-view/) ·
[NoSQLBooster blog](https://www.nosqlbooster.com/blog/)

### Tests

**F17 — `tests/ui/mongo.spec.ts` asserts the exact shape this phase removes.** It clicks
`document-toggle-expand`, then asserts `document-body .cm-content` is visible and later contains
`widget-1-edited` (`:163-167`, `:181-183`) — i.e. it asserts a CodeMirror instance exists in the
*read* path, which is what D19 deletes. `tests/ui/autocomplete.spec.ts:249-283` also drives the
document view but only through `document-search` and `document-row` counts, so it is unaffected.
`tests/ui/memory.spec.ts:303-311` opens two Mongo document tabs for the RSS budget — this phase must
improve that number, not regress it. `tests/db/mongo.spec.ts`'s 22 scenarios cover filter (`11.`)
and the `$document` replace (`14.`) but nothing with a BSON-typed literal in either.

## 2. Shapes introduced in this plan

```ts
// src/renderer/views/documents/ejson.ts — NEW. Parses one document body (canonical extended JSON,
// F5) into a plain, frozen, NON-REACTIVE node tree, and formats values back out in Mongo shell
// form. No `bson` import: the wrappers are recognised by shape (D13).

export type DocNodeKind = 'object' | 'array' | 'scalar';

/** The BSON type a node resolved to, for the type tooltip and the ObjectId/date affordances.
 *  'json' means a plain JSON scalar with no extended-JSON wrapper around it. */
export type BsonType =
  | 'json' | 'ObjectId' | 'Date' | 'Int32' | 'Int64' | 'Double' | 'Decimal128'
  | 'Binary' | 'Timestamp' | 'RegExp' | 'Code' | 'DBRef' | 'MinKey' | 'MaxKey' | 'UUID';

export interface DocNode {
  /** Field name, or the index as text inside an array. '' for the root. */
  key: string;
  /** Dotted path from the root ('device.os', 'tags.0'); '' for the root. Identity for D9's
   *  per-path expansion set — stable across a re-parse of the same body. */
  path: string;
  kind: DocNodeKind;
  /** scalar only: the rendered text — `ObjectId("507f…")`, `"active"`, `148`, `null`. */
  text: string;
  /** scalar only: which --kira-syntax-* colour the text takes. */
  token: 'string' | 'number' | 'keyword' | 'bson';
  bsonType: BsonType;
  /** object/array only. Frozen. */
  children: readonly DocNode[];
  /** object/array only: '{…} 3 fields' / '[…] 12 items' — what a collapsed container shows. */
  summary: string;
}

/** `null` for a body that is not a parseable JSON object — a truncated one (F3's 64 KB cut) or a
 *  non-object result. The caller falls back to showing the raw text (D22). */
export function parseDocument(body: string): DocNode | null;

/** The one-line label for a document's `_id`, from `DocumentPage.ids`' own EJSON text:
 *  '{"$oid":"507f…"}' -> { text: 'ObjectId("507f…")', bsonType: 'ObjectId' }. */
export function parseIdLabel(idEjson: string): { text: string; bsonType: BsonType };

/** The editable buffer's text: the document re-serialised as indented Mongo shell literal —
 *  `ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`, `NumberDecimal("…")`, `NumberInt(…)` for
 *  the six types literal.ts can construct, and the canonical extended-JSON object verbatim for
 *  every other type, so nothing is ever lossy (D14). */
export function toShellText(body: string): string;

/** ObjectId's own embedded timestamp, for the type tooltip (F16's NoSQLBooster precedent).
 *  `null` when the hex is not a well-formed 24-character ObjectId. */
export function objectIdCreatedAt(hex: string): Date | null;
```

```ts
// src/renderer/views/documents/documentRows.ts — NEW. The row model the virtualized list reads:
// one memoized parse per page row, the per-path expansion set, and the exact row height. Plain
// Maps/Sets keyed by row and by path — never reactive (§0, D21); an explicit version counter
// drives re-render, mirroring docPage.ts's own `pageVersion`.

export interface DocumentRowView {
  index: number;
  id: string;                    // the raw EJSON id text — the mutation key, unchanged
  idLabel: string;               // parseIdLabel().text — what the head shows and Copy _id copies
  idType: BsonType;
  fieldCount: number;            // '7 fields' (F8's mockup badge)
  byteLength: number;            // formatBytes() on the head, replacing the body snippet
  isTruncated: boolean;
  root: DocNode | null;          // null => D22's raw-text fallback
}

export const rowsVersion: { n: number };   // reactive — the only reactive thing in this module

export function rowView(tabId: string, row: number): DocumentRowView | null;

/** Ascending, flattened, exactly what the expanded body renders: the first layer always, plus the
 *  descendants of every path in the expansion set. `depth` drives the indent. */
export interface DocLine { node: DocNode; depth: number; expandable: boolean; expanded: boolean }
export function visibleLines(tabId: string, row: number): readonly DocLine[];

export function isPathExpanded(tabId: string, row: number, path: string): boolean;
export function togglePath(tabId: string, row: number, path: string): void;
/** Called from `setPage` — a new page has new rows; every parse and every path is stale. */
export function resetRows(tabId: string): void;

/** The exact pixel height of row `i`, with no measurement: a head plus, when expanded, one line
 *  per visible node — or the fixed editor height while this row is the one being edited (D20). */
export function rowHeight(tabId: string, row: number, editingId: string | null): number;
```

```vue
<!-- src/renderer/views/documents/DocumentTree.vue — NEW. One expanded document's body, rendered
     as flat indented key/value lines out of visibleLines(). No CodeMirror, no per-node component
     recursion — one `v-for` over an already-flattened array, so the DOM cost is linear in what is
     actually on screen (D19). -->
<!-- props: { tabId: string; row: number }  emits: { 'toggle-path': [path: string] } -->
```

```ts
// src/renderer/beautify.ts — MOVED from views/celleditor/beautify.ts, unchanged except that the
// CellFormat dispatch leaves with it (D25). Renderer-root utility module, the sibling `format.ts`
// and `clipboard.ts` already established (§11).
export function beautifyJson(text: string, mode: BeautifyMode): BeautifyResult;
export function beautifyXml(text: string, mode: BeautifyMode): BeautifyResult;
export function scanJson(text: string): { ok: boolean; offset?: number };
export function scanXml(text: string): { ok: boolean };
// views/celleditor/formats.ts keeps the format-aware dispatch it always owned:
export function beautifyFor(format: CellFormat, text: string, mode: BeautifyMode): BeautifyResult;
```

```ts
// src/renderer/views/shared/useEditBuffer.ts — NEW. The three features ask (2) names, as one
// composable both the cell editor and the document editor mount (D26). Imports downward only
// (../../beautify, ../../format) — never into views/celleditor/.

export interface EditBufferOptions {
  /** The stored value the buffer seeds from and Revert returns to. */
  original: () => string;
  /** `null` when this surface has no lossless formatter for the value in hand. */
  beautifier: () => ((text: string, mode: BeautifyMode) => BeautifyResult) | null;
  /** A surface that also has to un-stage something on Revert (the grid's pending-change set). */
  onRevert?: () => void;
}

export interface EditBuffer {
  doc: Ref<string>;
  isDirty: ComputedRef<boolean>;
  byteLabel: ComputedRef<string>;          // formatBytes(), one convention app-wide (P24 D35)
  formatted: ComputedRef<'none' | 'indented' | 'compact'>;
  beautifyFailure: Ref<string | null>;
  canBeautify: ComputedRef<boolean>;
  applyBeautify(mode: BeautifyMode): void;
  reset(): void;
  /** Re-seed from `original()`; a no-op when the value genuinely did not change (P24's own
   *  "a background page refresh must not silently undo a user's beautify" rule). */
  reseed(): void;
  /** P24 D20's write-guard, unchanged: only writes when the candidate differs. */
  writeDoc(next: string): boolean;
}

export function useEditBuffer(opts: EditBufferOptions): EditBuffer;
```

```vue
<!-- src/renderer/views/shared/EditBufferActions.vue — NEW. The one visual form of those three
     controls: the `modified` chip, the byte badge, Beautify / Minify, Revert. Rendered
     identically by the cell editor's header and by the document row's edit-action row (D27). -->
<!-- props: { buffer: EditBuffer; revertTitle?: string; testidPrefix: string } -->
```

```ts
// src/renderer/workbench/VirtualList.vue — additive prop only (D18). Existing callers untouched.
// rowHeights?: readonly number[]   // when present, prefix-sum offsets + binary search replace the
//                                  // uniform rowHeight math; `rowHeight` remains the estimate
//                                  // used for the container before the first measure.
```

```ts
// src/engine/adapters/mongo/literal.ts — additions only. The tokenizer, CONSTRUCTORS and
// parseFilterObject are unchanged (D15).

/** Recursively replaces every extended-JSON wrapper object ({$oid}, {$date}, {$numberLong},
 *  {$binary}, …) with the BSON value it denotes, by handing that subtree to EJSON.parse. Leaves
 *  every other object alone. This is what makes `{ _id: {"$oid": "507f…"} }` — the exact text
 *  *Copy _id* puts on the clipboard — a working filter (F14). */
export function resolveEjsonWrappers(value: unknown): unknown;

/** The one grammar every Mongo text surface in the app parses with: shell constructors *and*
 *  extended JSON, in the same document. Used by parseFilterObject and by mutate.ts (D15/D16). */
export function parseDocumentLiteral(text: string): Record<string, unknown>;
```

## 3. Decisions

### Topic A — the document row

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **The collapsed row shows the `_id` and two facts, and nothing of the body:** `_id` in shell form, a `N fields` badge, and a `formatBytes(byteLength)` badge. `previewLine` (`DocumentView.vue:313-316`) is **deleted**. | The literal ask — *"the previews shold be only the primary key"* — and the mockup that predates it (F8: `doc-id` + `p-badge` 7 fields). Deleting `previewLine` is also the second-largest perf win in the phase (F3): it is the one function that touched every byte of every body on every render. The two badges keep the collapsed row from being a bare id: field count is the fact the mockup chose, and size is the fact §8.7's own *"a 2 MB document cannot stall a frame"* concern is about. |
| D2 | **A document is expanded by default.** `tab.state.expanded[id] === undefined` now means *expanded*; `toggleExpanded` writes an explicit `false` to collapse. `setAllExpanded(…, true)` **clears** the map rather than writing one `true` per row. | The ask. Two consequences make it cheap rather than a migration: a tab saved under the old semantics has `expanded: {}`, which under the new reading means "all expanded" — exactly the new default, so no Zod change and no migration (F6's schema is unchanged); and clearing rather than filling means *Expand all* on a 10 000-row page writes an empty object to `state_json` instead of 10 000 keys (F6). |
| D3 | **Expanded means the first layer only.** Every top-level key renders as one line; a nested object or array renders as its key plus a collapsed summary (`{…} 3 fields` / `[…] 12 items`) with its own twisty. | The ask, and it is what makes D2 affordable: a document's expanded height becomes proportional to its *top-level* field count, which is small and bounded, instead of its total node count. This is also Studio 3T's and NoSQLBooster's tree behaviour (F16). |
| D4 | **Nested expansion is per `(row, path)` and is runtime-only — never persisted.** A `Set<string>` in `documentRows.ts`, cleared by `resetRows` on every `setPage`. | Persisting it would put an unbounded, per-document, per-path key set into `tabs.state_json` — F6's problem multiplied by the node count. It is also genuinely session-scoped: the row indices it is keyed by are only meaningful for the page currently loaded, and the next page load replaces them. The per-*document* boolean stays persisted, because §8.7 already promises expand state "remembers state per `_id`". |
| D5 | **The row head carries three actions in this order: expand/collapse, edit, delete** — the twisty stays at the leading edge where it is (`DocumentView.vue:662-673`, and where every tree twisty in the app sits), and Edit and Delete are `IconButton`s in the trailing `.doc-row-actions` group. | The ask names three. Putting the twisty back on the right beside the other two would break the one convention `ProjectTree`/`TreeRow` and this view already share — a disclosure control leads its row. F7's asymmetry (Delete menu-only) is what the ask is actually reacting to, and the fix is to give Delete a button, not to move the twisty. |
| D6 | **Edit and Delete are disabled with an explaining tooltip when `caps.canUpdate` / `caps.canDelete` is false**, exactly as the toolbar's Add button already does (`DocumentView.vue:551-552`); Delete keeps the `window.confirm` the context menu already uses (`documentMenu.ts:46-56`) and routes through the same `deleteDocument`. | The narrow-flag gate is this view's own established rule (its `caps` comment at `:76-81`). Reusing `documentMenu`'s confirm means one delete path, not two — and P22's tooltip machinery exists precisely so a disabled control can say why it is disabled. Replacing `window.confirm` with an app-owned dialog is real work with no bearing on this ask; §6 records it. |
| D7 | **The row's context menu is unchanged in shape** (§8.10's Document row: Expand all, Collapse all, Expand/collapse, Copy document, Copy `_id`, Edit, Delete) — only *Copy document* and *Copy `_id`* change what they copy (D12). | §8.10 is a specification of that menu; this phase adds buttons for two items that were already there, it does not redefine the row. |
| D8 | **`onGoToMatch` scrolls through `VirtualList`'s `scrollToIndex(row)`, not `querySelector` + `scrollIntoView`.** | F10: virtualization makes the current implementation silently do nothing for any match outside the rendered window — which, at page size 1000, is nearly all of them. `VirtualList.vue:49-59` already exposes exactly this method (`ProjectTree` is its precedent), and D18 makes it offset-aware. |
| D9 | **Search still scans the full document body, and the toolbar says so.** `docSearch.ts`'s `previewLineFor` (`:38-41`) keeps collapsing whitespace over the whole body; only its comment — which claims to mirror `previewLine` — is corrected. | The comment's claim is about to become false (D1 deletes `previewLine`) but its *behaviour* is already the right one: it never truncated, so it already searches the whole document. Narrowing search to the visible `_id` would make the find widget useless in the exact view it is most needed. Match highlighting in the list is a separate, already-scheduled item (P31 §10's item 6) and is **not** in this phase (§6). |
| D10 | **`isIdNull` and its import are deleted** (F11) — from `DocumentView.vue:27` and, since it has no other caller, from `docPage.ts:69-73`. | Dead code that lint does not catch is worse than dead code that does; it reads as live to the next person. Removing the export too is what makes it stay removed. |

### Topic B — ObjectId and BSON types

| # | Decision | Rationale |
|---|----------|-----------|
| D11 | **The wire body stays canonical extended JSON.** `read.ts:123`'s `{ relaxed: false }` is **not** changed, and neither is `idText` (`:22`). | Canonical EJSON is the only dialect in which an `Int32` comes back an `Int32`. Switching to relaxed would shrink the payload (tempting for F5's verbosity) at the cost of silently rewriting every int32 as a double the first time a user saves a document — an unacceptable trade for a DB client. The verbosity is a *display* problem, and D12 solves it where it belongs. This also means the read path, the L2 cache key and `DocumentPage` are untouched by this phase. |
| D12 | **The renderer renders BSON in Mongo shell form**: `ObjectId("507f…")`, `ISODate("2026-08-23T07:58:41Z")`, `NumberLong("9007199254740993")`, `NumberDecimal("1.10")`, `NumberInt(5)` — recognised by wrapper *shape* in `ejson.ts`, coloured with the existing `--kira-syntax-*` tokens (`theme/tokens.css:89-102`), with the type name and (for an ObjectId) its embedded creation time on the hover tooltip. This is what `.doc-id` shows, what the expanded tree shows, what *Copy `_id`* copies and what *Copy document* copies. | The ask offered two answers (*"if nit actual ObjectId obj, maybe just a string"*) and F16 says which one the field picked: Compass shows `$oid` and pays for it with a query bar that cannot accept its own output; Studio 3T and NoSQLBooster show a typed shell value. This app's own design mockup already drew `ObjectId(…)` and `ISODate(…)` (F8) — so shell form is not a new opinion here, it is the specified one. Making it also the *clipboard* form is what turns it from cosmetics into the fix for F14: what you copy is now what the filter box executes. Diverging from the mockup on one point — it shows a bare `65f2a10c4b1e` — is deliberate: the wrapper is what makes the string paste-able, so it is rendered muted, at badge weight, so the hex still carries the visual emphasis the mockup gives it. |
| D13 | **The renderer recognises wrappers by shape and never imports `bson`.** A single-key object whose key is one of the known `$`-prefixed names, with the value shape EJSON specifies, is that BSON type; anything else is a plain object. | §2.1: the renderer never imports a driver or parses a wire protocol, and `bson` is 200 KB of exactly that. The recognition rule is ten lines against a closed, versioned spec, and everything it fails to recognise degrades to "a plain JSON object", which renders correctly as an object — the worst case is a `{"$binary": {…}}` node drawn as a two-key object rather than a `Binary(…)` chip, which is legible, not wrong. |
| D14 | **The editable buffer is shell text produced by `toShellText`, and it is lossless: the six types `literal.ts` can construct are emitted as constructors, and every other BSON type is emitted as its canonical extended-JSON object verbatim.** | The mockup's expanded code pane is shell text (F8), and it would be incoherent to read `ObjectId("…")` in the tree and have to type `{"$oid": …}` two clicks later — that is precisely Compass's split (F16), which this phase exists partly to avoid reproducing. The verbatim fallback is what keeps it honest: a document containing a `Binary` or a `Timestamp` round-trips byte-identically instead of being mangled by a serializer that has no spelling for it. `literal.ts`'s constructor set (`:99-106`) defines the boundary, so the serializer and the parser can never disagree about which types have a shell form. |
| D15 | **One Mongo literal grammar for the whole app: `parseDocumentLiteral` = the existing JSON5-lite parser plus `resolveEjsonWrappers`.** `parseFilterObject` (`literal.ts:256-266`) routes through it, so the filter box accepts shell constructors *and* extended JSON in the same document. | F14's round trip has two ends and both must close: the app should hand you a filterable spelling (D12), **and** the spelling anyone would naturally paste — `{"$oid": …}`, straight out of a Compass screenshot, a log line or a REST payload — should work. Doing only the first leaves the second failing with `unknown operator $oid`, which is the exact error the user hit. `resolveEjsonWrappers` is a post-pass over an already-parsed tree, so the tokenizer, the `no eval` rule (`literal.ts:4-7`) and every existing filter's behaviour are untouched. |
| D16 | **`mutate.ts` parses a document body with `parseDocumentLiteral`, not `EJSON.parse`** — in the replace branch (`:96-101`), the insert branch (`:138-143`) and `parseIdKey` (`:33-45`). | F15: today the document editor is stricter than the filter box six pixels above it, so the app teaches you a syntax in one field and rejects it in another. Since `parseDocumentLiteral` is a strict superset of what `EJSON.parse` accepted for these inputs, every existing body keeps working — including D14's verbatim canonical-EJSON fallback, which is exactly the case `resolveEjsonWrappers` handles. |
| D17 | **The filter bar's completion vocabulary gains the six BSON constructors**, as `MONGO_VALUE_CONSTRUCTORS` in `views/shared/mongoVocabulary.ts` beside `MONGO_QUERY_OPERATORS`, inserted as `ObjectId('')` with the caret between the quotes. | F14's other half: the capability existed and nothing surfaced it, which is indistinguishable from it not existing. `mongoVocabulary.ts` is already the shared home for exactly this (its own header comment: *"moved here … to gain a second consumer … rather than a second copy that could drift"*), and the Mongo console's completion source is that second consumer, so both surfaces gain it from one edit. |

### Topic C — render speed

| # | Decision | Rationale |
|---|----------|-----------|
| D18 | **`workbench/VirtualList.vue` gains an optional `rowHeights?: readonly number[]`.** With it, a prefix-sum offsets array plus binary search replaces the uniform `scrollTop / rowHeight` math (`:27-44`) and drives `scrollToIndex` (`:49-59`); without it, the file behaves byte-for-byte as it does today. | Document rows have two heights that differ by an order of magnitude (a collapsed head vs. an expanded body), so the uniform virtualizer cannot serve them — and a *second* virtualizer in `views/documents/` is exactly the four-hand-rolled-page-size-pickers mistake P24 D30 spent a commit undoing. Making it additive means `ProjectTree`, `OperationsPanel` and both `ConsoleResultGrid` branches are untouched and act as the regression guard. P29 (grid/cell-view scroll gap) inherits a better primitive rather than a duplicate. |
| D19 | **CodeMirror leaves the document read path entirely.** An expanded, non-editing document renders through `DocumentTree.vue` — one `v-for` over an already-flattened line array. `CodeMirrorHost` survives in the view only for the row being edited and for the new-document panel. | F2 is the bottleneck, and it is not a tuning problem: an `EditorView` per row cannot be made cheap enough for "everything expanded by default". A read-only JSON body needs indentation, colour and a twisty — none of which requires an editor, and all of which `ConsoleResultGrid.vue:197-208` already declines one for. This is also what makes D2 possible at all. |
| D20 | **A row's height is computed, never measured**: `HEAD_H` (`--kira-h-md`, 26px) plus, when expanded, `visibleLines().length × LINE_H` (`--kira-h-xs`, 18px — `OperationsPanel`'s own row height) plus padding — or the fixed editor height while this row is the one being edited. | D3 is what makes this exact rather than an estimate: every visible node is exactly one line, because nested containers collapse to a one-line summary. An exact height model means no measurement pass, no `ResizeObserver` per row, no scroll-position drift, and a `rowHeights` array that is a cheap pure function of state D4 and D2 already track. |
| D21 | **The parsed trees live in `docPage.ts`'s existing non-reactive `Entry`, keyed by row, and are dropped by `setPage`.** `documentRows.ts` exposes a `rowsVersion` counter, mirroring `pageVersion`. | §2.2's rule as `docPage.ts:7-21` already applies it — the page is frozen, the decode cache is a plain `Map`, and a counter is the only reactive surface. A `reactive()` tree would put a Proxy around every node of every document on the page, which is the frame budget. Living in the same `Entry` means one lifetime, one eviction, and no second cache to forget to clear. |
| D22 | **A body that does not parse (truncated at 64 KB, or not an object) falls back to its raw text in a `<pre>`, with the existing `truncated` badge.** | `docPage.ts:83-101`'s `fieldNamesOnPage` already established this exact degradation (*"cut mid-token by MAX_CELL_BYTES truncation — contributes no names"*). The user must still be able to *read* a 2 MB document's first 64 KB; §8.7 requires it. Falling back to text keeps that promise without a tree renderer having to tolerate malformed input. |
| D23 | **The list's `v-for` iterates a `rows` computed of plain per-row view objects, not an index range resolved by a function.** `rowAt`, `allIds` and the twelve per-row `rowAt(i)` calls (F4) go away. | One `Map` lookup and one reactive read per row per render instead of a dozen, and the template stops being a place where a lookup can be added by accident. The objects are plain and frozen — a computed's return value is not deep-proxied, so this costs no reactivity. |
| D24 | **Two perf assertions become tripwires in `tests/ui/mongo.spec.ts`, not prose:** at page size 1000, (a) the rendered `document-row` count stays bounded (≤ 60), and (b) `.cm-editor` count inside `document-list` is **0** while no row is being edited. | "Fix the rendering speed" has to be verifiable by something other than a person's impression, and these two are the *causes* (F1, F2) rather than a timing number that varies by machine — `docs/v1/PERF.md` §2.1's own methodology note is explicit that single-sample timings are not evidence. `tests/ui/perf.spec.ts`'s "DOM cell bound" tripwire is the precedent for this shape of assertion. |

### Topic D — the cell editor's three features

| # | Decision | Rationale |
|---|----------|-----------|
| D25 | **`views/celleditor/beautify.ts` moves to `src/renderer/beautify.ts`, and its `CellFormat` dispatch moves *down* into `views/celleditor/formats.ts` as `beautifyFor()`.** `beautifyJson`/`beautifyXml` (already standalone at `:243`/`:504`) become the exported surface. | The document view must not import from `views/celleditor/` — §11 forbids sideways view imports, and a type-only import is still one. `beautify.ts` has exactly one dependency standing in the way (`:1`'s `CellFormat`) and it is a dispatch concern, not a formatting one. The renderer root is the established home for a shared pure utility: `format.ts` and `clipboard.ts` are both there, and §11 documents `format.ts` as *"used by the status bar, settings dialog and cell editor alike"*. |
| D26 | **The buffer state machine becomes `views/shared/useEditBuffer.ts`, and `CellEditorView.vue` adopts it** — deleting its own `doc`/`formattedMode`/`formattedForDoc`/`formatted`/`beautifyFailure`/`applyBeautify`/`resetBuffer`/`isDirty`/byte-count copies (F13's line list). | The ask is to have these three features in two places; the choice is one implementation or two. P24's whole third topic was undoing the second option after the fact, four times over. `views/shared/` already exists for exactly this (`FilterHistoryMenu.vue`, `mongoVocabulary.ts`, `sqlIdent.ts`) and imports only downward. Adopting it in the cell editor *first*, with `cell-editor.spec.ts` unchanged and green, is what proves the extraction is behaviour-preserving before a second caller depends on it. |
| D27 | **`views/shared/EditBufferActions.vue` renders the controls, and both surfaces mount it**: the `modified` chip, the byte badge, Beautify, Minify, Revert. | Same argument one layer up: the composable alone would still leave two hand-built button rows drifting apart in icon, order, tooltip and disabled rule. The cell editor's current row (`CellEditorView.vue`'s `.format-group` and its `#trailing` chip) *is* the design; this extracts it rather than inventing one. The format `<select>`, the UUID generate button and the timestamp pane stay in the cell editor — they are cell-editor features, not buffer features. |
| D28 | **In the document view those controls live in the row's edit-action row, visible only while that row is being edited**, beside Save and Cancel. The byte badge is the exception: it sits on **every** row's head (D1), editing or not. | The ask says *"moved into the main edit area when the doc is expanded"*. Beautify and Revert have no referent outside an edit — there is no buffer to format and nothing to revert to — so showing them on a read-only expanded row would be three disabled buttons on every row. A document's size, by contrast, is a fact about the document; the mockup's own view header carries `avg 1.4 KB`, and putting it on the head is what frees the `.doc-preview` slot D1 empties. |
| D29 | **The document editor's beautifier is `beautifyJson` over the shell text.** Beautify/Minify reindent the buffer; they do not re-serialise it, and they never change a type. | The buffer is shell text (D14), which `beautifyJson` handles as JSON-with-constructor-calls only if it is taught to — so the honest form is: `toShellText` already emits indented text, Beautify re-runs it through the same indenter and Minify collapses it, both operating on the *parsed* document rather than on the string. `BeautifyResult.ok === false` (with the existing `reason`) covers a hand-edited body that no longer parses, which is exactly the failure surface the cell editor's own beautify already has. |
| D30 | **The cell editor panel is not shown for a document tab at all.** `DocumentView.vue:371-400`'s publish watch and its `clearSelectedCellFor` call (`:416-420`) are deleted; under P26 the view simply does not mount the panel. `rt.selectedRow` and the row's selection rail stay. | F12: for Mongo the panel is a read-only viewer of a document the list is already showing, and `SelectedCell`'s own contract guarantees it can never be anything else here (no `onEdit`). The ask says "hidden by default" and P26's SPEC row says "opt out entirely" — this is the opt-out. The row rail stays because selection is still meaningful for the row's own actions; nothing else in the app reads `cellSelectionState` except `WorkbenchShell.vue:23` and the panel itself, so nothing is lost (verified: the status bar does not read it). |

### Topic E — cross-cutting

| # | Decision | Rationale |
|---|----------|-----------|
| D31 | **No change to `DocumentPage`, `read.ts`, the L2 cache key, `data.read`, or `documentMutations.ts`'s `$document` sentinel.** The only engine file this phase edits is `literal.ts` (+`mutate.ts` adopting it). | The phase is a renderer redesign plus one parser widening. Keeping the wire shape fixed means `tests/db/mongo.spec.ts`'s scenarios 8–13 are an untouched regression guard for everything the perf work rides on, and the L2 cache does not need invalidating on upgrade. |
| D32 | **The toolbar's *Expand all* / *Collapse all* keep their testids and their meaning**, now reading "every document expanded to its first layer" / "every document collapsed to its `_id` line". Nested paths are **not** expanded by Expand all. | Expanding every nested path of every document is the state D3 exists to avoid; it would restore exactly the height explosion this phase removes, from a single click. The two buttons keep their `data-testid`s so existing coverage stays valid. |
| D33 | **`fieldNamesOnPage` (`docPage.ts:83-101`) reuses the memoized parse** instead of its own `JSON.parse` per row. | It already walks every body on the page (for the projection picker and the filter's completion candidates, `filterCompletion.ts`); with D21 the parse is done and cached, so this is one fewer full-page parse per `pageVersion` bump — and it stops being a second, divergent answer to "what are this document's top-level keys". |
| D34 | **SPEC.md is edited by the implementing session, not by this plan**: §8.7 rewritten for the new row (id-only preview, expanded-by-default first layer, the three actions, no cell-editor panel, shell-form BSON), §8.10's Document row reworded where *Copy `_id`* changed meaning, §11's tree gains `renderer/beautify.ts`, `views/shared/useEditBuffer.ts`, `views/shared/EditBufferActions.vue`, `views/documents/ejson.ts`, `documentRows.ts` and `DocumentTree.vue`. The §10 phasing row for P27 is updated **only once the phase is implemented**. | Standing practice (P24 D41, P22 D11, P19, P21). The phasing table is a record of what shipped. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and
`bun run build` green. Steps 1–2 are the shared extraction, 3–4 the BSON work, 5–8 the view rewrite,
9 the filter-bar surfacing, 10–11 tests and docs.

1. **`refactor(renderer): hoist beautify to a renderer-root module`** — move
   `views/celleditor/beautify.ts` → `src/renderer/beautify.ts` unchanged, export `beautifyJson` /
   `beautifyXml`, and add `beautifyFor(format, text, mode)` to `views/celleditor/formats.ts`.
   `detect.ts:2` and `CellEditorView.vue:13` update their imports. Pure move, no behaviour change
   (D25).
2. **`refactor(views): extract the edit-buffer state machine into a shared composable`** —
   `views/shared/useEditBuffer.ts` and `views/shared/EditBufferActions.vue`; `CellEditorView.vue`
   adopts both and deletes F13's copies. **`tests/ui/cell-editor.spec.ts` must pass unchanged** —
   that is the acceptance criterion for this step (D26/D27).
3. **`feat(mongo): parse and format BSON values for the document view`** —
   `views/documents/ejson.ts` (`parseDocument`, `parseIdLabel`, `toShellText`,
   `objectIdCreatedAt`), not yet wired into any component. Reviewable in isolation (D12/D13/D14).
4. **`feat(mongo): one literal grammar for filters, keys and document bodies`** —
   `literal.ts` gains `resolveEjsonWrappers` and `parseDocumentLiteral`; `parseFilterObject` and
   `mutate.ts`'s three parse sites adopt it. Engine-only. `bun run test:db` with §5's new scenarios
   23–24 (D15/D16).
5. **`feat(workbench): variable row heights in VirtualList`** — additive `rowHeights` prop,
   prefix-sum offsets, binary-search `startIndex`/`endIndex`, offset-aware `scrollToIndex`. The four
   existing callers are untouched; `xvfb-run -a bun run test:ui` is the regression guard (D18).
6. **`feat(mongo): render documents as a virtualized first-layer tree`** — the core commit:
   `documentRows.ts` (memoized parse in `docPage.ts`'s `Entry`, per-path expansion set, exact height
   model), `DocumentTree.vue`, and `DocumentView.vue`'s list rewritten onto `VirtualList` with the
   new head — id-only preview, field/size badges, expand/collapse + edit + delete. `state.ts`'s
   expand default inverts; `previewLine`, `rowAt`, `allIds`, `isIdNull` and the read-path
   `CodeMirrorHost` are deleted; `onGoToMatch` moves to `scrollToIndex`; `fieldNamesOnPage` adopts
   the shared parse (D1–D5, D8–D10, D19–D23, D32, D33).
7. **`feat(mongo): the document's edit area owns beautify, byte count and revert`** — the row's
   edit-action row mounts step 2's `EditBufferActions`; the edit buffer seeds from `toShellText`
   and saves through the unchanged `saveDocumentEdit`. The new-document panel adopts the same row
   (D28/D29).
8. **`feat(mongo): the document view opts out of the cell editor panel`** — deletes
   `DocumentView.vue`'s publish watch and `clearSelectedCellFor`. **Requires P26 to have landed**;
   if it has not, this step is deferred to P26's own branch rather than landed partially (D30).
9. **`feat(mongo): offer BSON constructors in the filter bar`** — `MONGO_VALUE_CONSTRUCTORS` in
   `views/shared/mongoVocabulary.ts`, consumed by `filterCompletion.ts` and the Mongo console's
   completion source; *Copy `_id`* / *Copy document* switch to the shell form (D12/D17).
10. **`test(ui): cover the redesigned Mongo document view`** — §5's `mongo.spec.ts` rewrite and its
    two tripwires. `xvfb-run -a bun run test:ui` green.
11. **`docs: SPEC.md §8.7/§8.10/§11 for P27`** — D34's spec edits (not the phasing row), and this
    plan's own commit if it is not already landed.

## 5. Tests

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| `tests/ui/mongo.spec.ts:163-167` | D19 removes CodeMirror from the read path, and D2 expands rows by default, so `document-toggle-expand` no longer needs clicking to see a body. | Drop the expand click before the edit; click `document-edit` on the row directly and target `document-body .cm-content` **only after** entering edit mode, where a CodeMirror instance still exists. |
| `tests/ui/mongo.spec.ts:181-183` | Same: the post-save assertion reads `document-body .cm-content`, which is now a `DocumentTree`, not an editor. | Assert against the tree instead: `[data-testid="document-field"]` whose key is `name` contains `widget-1-edited`. |
| `tests/ui/mongo.spec.ts:186-192` | D5 gives Delete a button; the context-menu path must keep working too. | Keep the context-menu delete verbatim (it is §8.10 coverage) and **add** a button-path delete on a second document, asserting the same confirm dialog and the same row disappearance. |
| `tests/ui/mongo.spec.ts:145-147, :196-198, :218-220` | Row counts are asserted with `toHaveCount(WIDGET_COUNT)` against `document-row`. With D18/D19 only the visible window is in the DOM. | The fixture seeds 25 documents and the viewport holds fewer than 25 expanded rows, so these must become a bounded assertion plus a scroll, or the fixture must be filtered first. Prefer: assert `document-list` reports its total through a `data-row-count` attribute on the list container, and keep `toHaveCount` only where a filter has narrowed the page to 0 or 1 (`:159`, `:174`, `:178`, `:188`, `:192`). |
| `tests/ui/autocomplete.spec.ts:249-283` | Drives `document-search` and counts `document-row` after filtering to exactly one document. | **No change** — one row is always inside the rendered window. This is the guard that D17's added completions did not disturb the field/operator candidates; verify, do not assume. |
| `tests/ui/memory.spec.ts:303-311` | Opens two Mongo document tabs for the RSS budget. | **No source change**, but it must be re-run and shown green — D19 and D21 should move this number down, and a regression here would mean the parse cache (D21) is retaining more than the `EditorView`s it replaced. |
| `tests/ui/cell-editor.spec.ts` | D26/D27 rewire the panel's internals. | **No change permitted.** Passing unchanged is step 2's acceptance criterion; if a testid has to move, the extraction is wrong. |
| `tests/db/mongo.spec.ts:406-431` (`11. read: filter`) | D15 widens `parseFilterObject`. | Unchanged assertions; the new literal scenarios are appended as 23/24 in the same describe so the container and fixture are reused. |
| `tests/db/mongo.spec.ts:483-542` (`14. mutate: $document replace`) | D16 swaps `EJSON.parse` for `parseDocumentLiteral`. | Unchanged — this is the guard that a canonical-EJSON body still replaces exactly as before. |

### New coverage

**`tests/db/mongo.spec.ts`, appended to the existing describe** (the running Mongo container, the
seeded `widgets` collection with its fixed hex `_id`s from `fixtures/0003_mongo_seed.ts`):

- **23. read: a filter with BSON constructor literals.** `{ _id: ObjectId('<seeded hex>') }` returns
  exactly that document; `{ createdAt: { $lt: ISODate('…') } }` narrows as expected;
  `{ n: NumberLong('…') }` matches an int64 field. Proves F14's "already works" claim rather than
  trusting it.
- **24. read/mutate: an extended-JSON wrapper is accepted wherever a constructor is.**
  `{ _id: {"$oid": "<seeded hex>"} }` — the exact clipboard text of D12's *Copy `_id`*, and the
  spelling that fails today — returns the same one document as scenario 23's constructor form. Then
  a `$document` replace whose body mixes both spellings (`ObjectId("…")` for one field, `{"$date":
  …}` for another) round-trips with both types intact, read back through `read()` and compared as
  canonical EJSON. This is the scenario that fails against today's `EJSON.parse` and is the reason
  D15/D16 exist.

**`tests/ui/mongo.spec.ts`, in the existing single test** (same connection, same tab — a second
Mongo container would add minutes for no isolation gain):

- **Documents are expanded to their first layer on load** (D2/D3): with no interaction, the first
  `document-row` shows one `document-field` line per top-level key, and a nested object's line shows
  its `document-field-summary` (`{…} N fields`) rather than its children.
- **A nested object expands on demand and collapses again** (D3/D4): click the nested line's
  twisty, assert its children appear indented one level, click again, assert they are gone.
- **The collapsed row shows the `_id` and nothing of the body** (D1): collapse a document; assert
  `document-id` matches `/^ObjectId\("[0-9a-f]{24}"\)$/`, that a `N fields` badge and a byte badge
  are present, and that the row's text does **not** contain a body field name.
- **`_id` renders and copies in shell form** (D12): assert `document-id`'s text is the
  `ObjectId("…")` form, then run *Copy `_id`* from the context menu and assert the clipboard holds
  the same string — not `{"$oid": …}`.
- **What Copy `_id` puts on the clipboard is a working filter** (D12/D15, the round trip F14
  breaks): paste the copied text into `document-search` as `{ _id: <pasted> }`, press Enter, assert
  exactly one `document-row` and no `document-error`.
- **The `$oid` spelling also filters** (D15): type `{ _id: {"$oid": "<hex>"} }` by hand; assert the
  same single row.
- **`ObjectId` is offered by the filter's completions** (D17): type `Object` into
  `document-search`; assert a suggestion labelled `ObjectId` appears and that accepting it inserts
  `ObjectId('')`.
- **Three row actions, and Delete works from the button** (D5/D6): assert
  `document-toggle-expand`, `document-edit` and `document-delete` are all present on a row; click
  `document-delete`, accept the confirm, assert the row is gone and the op log has one `mutate`.
- **Read-only disables Edit and Delete with a reason** (D6): flip the connection to read-only,
  assert both buttons are `disabled` and carry a non-empty `data-kira-tip`.
- **Beautify, byte count and revert live in the row's edit area** (D28/D29): enter edit mode on a
  document; assert `document-edit-modified` is absent, `document-edit-bytes` reads a `formatBytes`
  string, and `document-edit-beautify-indented` / `-compact` / `-revert` exist. Minify, assert the
  buffer collapsed to one line and the `modified` chip appeared; Revert, assert the buffer is the
  original text and the chip is gone. Leave edit mode and assert **no** pending mutation ran.
- **The edit buffer is shell text and saves losslessly** (D14/D16): in edit mode assert the buffer
  contains `ObjectId("` ; change one string field, Save, and assert the reloaded document still
  shows `ObjectId("<same hex>")` and the untouched fields are unchanged.
- **No cell editor panel for a document tab** (D30): click a document; assert
  `[data-testid="cell-editor-panel"]` has **zero** matches, and that opening a SQL data tab in the
  same window still shows one on a cell click (the guard that D30 removed a publication, not the
  panel).
- **Tripwire: the list is virtualized** (D24/F1): set page size to 1000 against a collection seeded
  past that; assert `document-row` count is `≤ 60` while `document-list`'s `data-row-count` reads
  the full page size, then scroll and assert the rendered ids changed.
- **Tripwire: no editor in the read path** (D24/F2): with every row expanded and nothing being
  edited, assert `[data-testid="document-list"] .cm-editor` has **zero** matches.
- **Go to match scrolls to an off-screen row** (D8): with page size 1000, search for a string in a
  document far down the page and press `search-next`; assert that document's row is rendered and in
  view.
- **A truncated document falls back to raw text** (D22): against a seeded oversized document,
  assert the `truncated` badge is present and the body renders a `document-raw` `<pre>` rather than
  a tree, and that Edit is offered but the save path reports the parse failure rather than writing.

**No new spec file.** Both new areas live in tabs and fixtures `tests/ui/mongo.spec.ts` and
`tests/db/mongo.spec.ts` already start. The seed fixture (`tests/db/fixtures/0003_mongo_seed.ts`)
needs two additions for the scenarios above: a document past `MAX_CELL_BYTES` for the truncation
case, and a collection large enough to exercise page size 1000 for the two tripwires.

## 6. Explicitly out of scope

- **P26's cell-editor ownership change.** This phase depends on it (see the preamble) and its step 8
  consumes it; it does not implement any part of it.
- **Search-match highlighting inside the document list, and the "show only matching rows" toggle.**
  Both are already scheduled as P31 §10's item 6 for Kafka, SQS *and* Mongo together, and P24 D12
  already recorded why the document view was left out of the grid's own filter mode. Doing Mongo's
  half here would fork that work.
- **Relaxed extended JSON on the wire** (D11). The verbosity F5 measures is real and a
  `{ relaxed: true }` read path would roughly halve a typical body — but it is lossy for integer
  widths, and the fix for reading it is the renderer, not the wire.
- **A `Binary` / `Timestamp` / `Code` shell constructor.** D14 emits those as verbatim canonical
  EJSON because `literal.ts:99-106` cannot construct them; widening the constructor set is an
  engine feature with its own round-trip questions.
- **An app-owned confirm dialog for Delete.** D6 keeps `window.confirm`, which is the one piece of
  system chrome P22 did not remove (it removed `title`, not `confirm`). Replacing it is a workbench
  change affecting every destructive action in the app, not a Mongo one.
- **Editing a truncated document** (D22). Readable and copyable, not writable — the same call P24
  D27 made for a truncated cell, for the same reason.
- **Inline per-field editing** (click a value in the tree, change it). Compass offers it; this phase
  keeps whole-document replace, which is what `mutate.ts`'s `$document` sentinel and §8.7's
  immediate-apply model are built on. A per-field patch would need `$set` path generation and a new
  mutation shape.
- **PK/FK navigation from a `DBRef` or an ObjectId.** SPEC §8.5 is explicit: *"Mongo has no FK
  navigation in v1 — no convention inference, no manual mapping."*
- **The filter row's missing *Apply* button.** The mockup shows a primary *Apply* beside *Clear* in
  the document filter row too; P24 §9's open question 3 already owns that decision for both views.
- **Any change to `read.ts`, `DocumentPage`, the L2 cache or the mutation protocol** (D31).
- **`docs/v1/design/kira-design-system/`.** Compared against, never edited.

## 7. Target tree at the end of P27

```
src/renderer/
  beautify.ts                       NEW  moved from views/celleditor/ (D25); beautifyJson/
                                         beautifyXml/scanJson/scanXml, no CellFormat dependency
  format.ts                          --  UNCHANGED (formatBytes, used by D1's size badge)
  workbench/
    VirtualList.vue                 MOD  optional rowHeights: prefix-sum offsets, binary search,
                                         offset-aware scrollToIndex (D18)
    panels/CellEditorPanel.vue       --  UNCHANGED (P26 owns it)
  views/shared/
    useEditBuffer.ts                NEW  dirty/beautify/bytes/revert, one implementation (D26)
    EditBufferActions.vue           NEW  the chip + byte badge + Beautify/Minify/Revert row (D27)
    mongoVocabulary.ts              MOD  + MONGO_VALUE_CONSTRUCTORS (D17)
  views/celleditor/
    beautify.ts                     DEL  moved to the renderer root (D25)
    formats.ts                      MOD  + beautifyFor() — the CellFormat dispatch (D25)
    detect.ts                       MOD  import path only (D25)
    CellEditorView.vue              MOD  adopts useEditBuffer + EditBufferActions; F13's copies
                                         deleted (D26/D27)
  views/documents/
    ejson.ts                        NEW  parseDocument/parseIdLabel/toShellText/objectIdCreatedAt
                                         (D12/D13/D14)
    documentRows.ts                 NEW  memoized row views, per-path expansion, exact heights
                                         (D3/D4/D20/D21/D23)
    DocumentTree.vue                NEW  one expanded document's flattened line list (D19)
    DocumentView.vue                MOD  list on VirtualList; id-only head with field/size badges;
                                         expand/edit/delete actions; edit-action row; read-path
                                         CodeMirror, previewLine, rowAt, allIds and the cell-editor
                                         publication all deleted (D1-D10, D19, D23, D28, D30)
    docPage.ts                      MOD  parse cache in Entry; resetRows on setPage; isIdNull
                                         deleted; fieldNamesOnPage reuses the parse (D21/D33/D10)
    state.ts                        MOD  expand default inverts; setAllExpanded(true) clears (D2)
    docSearch.ts                    MOD  comment only — it already scans the whole body (D9)
    documentMenu.ts                 MOD  Copy _id / Copy document use the shell form (D12)
    documentMutations.ts             --  UNCHANGED (D31)
    filterCompletion.ts             MOD  + the constructor completions (D17)
    ProjectionMenu.vue               --  UNCHANGED
    DocumentSearchToolbar.vue        --  UNCHANGED
src/engine/adapters/mongo/
  literal.ts                        MOD  + resolveEjsonWrappers, parseDocumentLiteral (D15)
  mutate.ts                         MOD  three EJSON.parse sites -> parseDocumentLiteral (D16)
  read.ts / caps.ts / console.ts / definition.ts   --  UNCHANGED (D11/D31)
src/shared/
  domain/tabs.ts                     --  UNCHANGED (D2 needs no schema change)
  protocol/page.ts                   --  UNCHANGED (D31)
tests/
  db/fixtures/0003_mongo_seed.ts    MOD  an oversized document + a >1000-doc collection (§5)
  db/mongo.spec.ts                  MOD  scenarios 23-24: BSON literals and EJSON wrappers (§5)
  ui/mongo.spec.ts                  MOD  rewritten for the new row; the two tripwires (§5)
  ui/autocomplete.spec.ts            --  UNCHANGED (re-run as the completion guard)
  ui/cell-editor.spec.ts             --  UNCHANGED (step 2's acceptance criterion)
  ui/memory.spec.ts                  --  UNCHANGED (re-run, expected to improve)
docs/
  v1/SPEC.md                        MOD  §8.7, §8.10, §11 (D34) — phasing row once implemented
  v1/plans/P27-mongo-document-redesign.md   NEW  this document
```

## 8. Acceptance checklist

**The row**

- [ ] A collapsed document shows its `_id` in `ObjectId("…")` form, a `N fields` badge and a size
      badge — and no part of its body.
- [ ] Opening a collection shows every document already expanded, each to its top-level keys only;
      a nested object or array shows a one-line `{…} N fields` / `[…] N items` summary with its own
      twisty.
- [ ] Expanding a nested path shows its children indented one level; collapsing hides them; the
      state survives scrolling the row out of view and back, and is gone after a page change.
- [ ] Every row carries expand/collapse, Edit and Delete; Delete asks for confirmation and removes
      the document; both write actions are disabled with a reason on a read-only connection.
- [ ] *Expand all* / *Collapse all* still work and do not expand nested paths.
- [ ] Go to match from the find widget scrolls to and reveals a document that was off screen.

**ObjectId and BSON**

- [ ] An `ObjectId` reads as `ObjectId("507f…")` in the `_id` line and everywhere it appears in a
      body; hovering it names the type and its creation time.
- [ ] A date reads as `ISODate("…")`, an int64 as `NumberLong("…")`, a `Decimal128` as
      `NumberDecimal("…")`; a `Binary` or any other type the shell cannot spell still renders and
      still round-trips.
- [ ] *Copy `_id`* puts `ObjectId("…")` on the clipboard, and pasting it into the filter box as
      `{ _id: … }` returns that one document.
- [ ] Typing `{ _id: {"$oid": "…"} }` by hand into the filter box returns the same document — the
      `$oid` spelling no longer fails with `unknown operator`.
- [ ] Typing `Object` into the filter box offers `ObjectId` as a completion.
- [ ] Editing a document and typing `ObjectId("…")` saves; so does a body written entirely in
      canonical extended JSON.
- [ ] A saved document's untouched fields come back with their original BSON types — an int32 is
      still an int32.

**Speed**

- [ ] At page size 1000, the DOM holds ≤ 60 `document-row`s and scrolling changes which ids are
      rendered.
- [ ] With every document expanded and nothing being edited, there is **no** CodeMirror instance
      anywhere in the document list.
- [ ] Expanding or collapsing one document does not re-scan any other document's body.
- [ ] *Expand all* on a large page writes an empty `expanded` object to the tab's session state, not
      one key per document.
- [ ] `tests/ui/memory.spec.ts`'s RSS budget passes, measured — and is no worse than before.

**The cell editor's three features**

- [ ] Opening a document tab shows **no** cell editor panel; opening a SQL data tab and clicking a
      cell still does.
- [ ] Editing a document shows a `modified` chip, a byte count, Beautify, Minify and Revert in the
      row's own edit area, beside Save and Cancel.
- [ ] Revert restores the original body and clears the chip; Save writes the buffer.
- [ ] Every one of those controls is the same component the cell editor renders — `grep -rn
      "formattedForDoc\|beautifyFailure" src/renderer` matches only `views/shared/useEditBuffer.ts`.
- [ ] `grep -rn "views/celleditor" src/renderer/views/documents` returns nothing.
- [ ] `tests/ui/cell-editor.spec.ts` passes unchanged.

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three) and `bun run build` clean.
- [ ] `xvfb-run -a bun run test:ui` and `bun run test:db` green on the macOS/Colima box (per
      `AGENTS.md`, neither can run in Claude Code's Linux web container).
- [ ] SPEC.md §8.7, §8.10 and §11 describe what shipped.

## 9. Open questions for the user

1. **Should the `_id` in the collapsed row show the full `ObjectId("507f1f77bcf86cd799439011")` or
   the mockup's bare short hex (`65f2a10c4b1e`)?** D12 chooses the full shell form because it is the
   string that makes *Copy `_id`* → filter work, and renders the wrapper muted so the hex still
   reads first. The mockup shows the short form, which is easier to scan down a list of 100 rows.
   This is the one place the plan knowingly diverges from `Documents.html`, and it is a preference,
   not a correctness argument.
2. **Should nested expansion be remembered across a page change?** D4 clears it on every `setPage`
   because it is keyed by row index and would otherwise reattach to whatever document happens to
   land at that index next. Keying it by `_id` instead would make it survive paging and refresh, at
   the cost of an unbounded map — reasonable if you routinely page back and forth through the same
   documents with the same nested object open, pointless otherwise.
3. **How deep should *Expand all* go?** D32 keeps it to the first layer, matching D3, so one click
   can never restore the height explosion this phase removes. A second, distinct *Expand
   everything* — with a guard above some node count — is defensible for small collections; it is
   deliberately not in this plan because picking that guard is a guess.
4. **Should the document editor stay a whole-document replace, or is inline per-field editing
   wanted?** §6 keeps whole-document replace, because that is what the `$document` sentinel and
   §8.7's immediate-apply model are built on. Compass offers per-field editing and it is genuinely
   nicer for a one-value change — but it needs `$set` path generation and a new mutation shape, so
   it is a phase, not a decision inside this one.
5. **Is the byte badge on every row wanted, or only in the header?** D28 puts it on each row because
   D1 empties the slot it sits in and a per-document size is the fact §8.7's large-document warning
   is about. The mockup instead puts an `avg 1.4 KB` on the view header, which is quieter. Both are
   one line; say which.
