# P31 — Cross-cutting polish and bug-fix batch (sixteen items)

> Not an original SPEC.md §10 deliverable line in spirit — P31 is user-directed, reported against
> shipped work, and batched exactly the way **P16** batched its own post-P15 fixes: *"Not a planned
> deliverable — a batch of user-directed fixes surfaced after P15 shipped, grouped into one phase
> rather than reopening P1/P9/P10/P11/P14."* The same reasoning applies here against P16, P18, P21,
> P22, P23 and P24. The sixteen asks, verbatim:
>
> 1. *"I have this issue error: describe is not supported for kafka and describe is not supported
>    for sqs in the logs, but they seem to show data. I hope it s not mocked"*
> 2. *"Tabs can t be scrolled and they should"*
> 3. *"Changing fonts doesnt work"*
> 4. *"Add a little bit of space between the panels themselvs and app border (left, right and up),
>    just a tiny bit"*
> 5. *"add the date picker option in the kafka view for the iso timestamp"*
> 6. *"add search highligh and the show only filtered in kafka and sqs and mongo too."*
> 7. *"The search bar doesn t update properly when the underlying data changes, another page or
>    fetch more or less items."*
> 8. *"drop the tooltip for expand collapse in the connections panel"*
> 9. *"When adding connections, the no collor one looks like dark, it should be clarly show
>    transparent or smth"*
> 10. *"Add info for all column types"*
> 11. *"In the saved and recent filters, when i keep click over it show the tooltip with the rest of
>     the content, now it s a bit short"*
> 12. *"The deleted rows should have red in the left where others have yelow and green. make delete
>     keyboard shortcut work and add the delete in the right click menu too"*
> 13. *"when ordering from columns, remove that from headers label"*
> 14. *"In query console, I can t navigate with arrow up or down the autocomplete suggestions."*
> 15. *"The columns pannel activated label is still broken and overlaps over the icon. drop it and
>     only add an indicator over that icon to show it s activated"*
> 16. *"The preview sql should add a blank line between each command to be easy to read"*
>
> **Why one phase and not sixteen.** None of these is phase-sized; several land on the same file or
> the same primitive (items 6 and 7 both rewrite all four in-page search toolbars; 10, 12, 13 and 15
> are all the SQL grid; 8, 9 and 11 are all the project panel and its dialogs), and batching means
> **one** `test:ui` regression pass instead of sixteen. Nothing here touches the wire protocol,
> storage schema, migrations or a tab's persisted shape except item 1's one added `Caps` flag.

---

## 0. Ground rules for this phase

- **Every finding below was read in the tree, and four were verified by running the built app**
  (`out/main/index.js` under `_electron.launch`, a throwaway `KIRA_HOME`): item 1's data provenance,
  item 2's computed `overflow-x`, item 3's whole settings→CSS-variable path, and the font-availability
  API question in F13. Where a claim came from a live run it says so; nothing here is inferred from
  the symptom alone.
- **Item 1 is answered with evidence, not reassurance.** The verdict (F1–F6) is: the data is real and
  live; the log line is a second, unrelated call the definition view makes unconditionally. It is
  fixed at the cause, not silenced.
- **Extend, never re-invent.** Item 6 extends P24's `matchedRows`/`isSearchFiltering` shape, not a
  second filter mechanism. Item 5 reuses P24's `DateTimePicker.vue` verbatim. Item 15 reuses
  `IconButton`'s existing corner slot rather than a new badge style. Item 12's red rail reuses the
  gutter's existing `::before` rail idiom. A new component appears in exactly two places in this
  phase, both because §11 forbids a sideways `views/*` → `views/*` import.
- **No half-implementations (AGENTS.md).** A fix applies to every occurrence of its problem —
  item 15's overlapping count badge is on *two* toolbars, item 7's staleness is in *four* search
  toolbars, item 6's toggle goes to every in-page search toolbar that lacks it — or it is named in
  §6 and left entirely alone.
- **Search still never issues a query** (LAW 16, P24 D13). Every item-6/7 change is client-side over
  the already-loaded page; item 7's re-scan is triggered *by* a page the view already fetched, never
  the other way round.
- **No new dependency.** Every item is solvable with what is already in `package.json`.
- Comments per AGENTS.md: only where the code cannot say it for itself. Each `D` that encodes a
  non-obvious constraint gets one line at its site.
- `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` stay green after every
  commit. `xvfb-run -a bun run test:ui` for the four container-free specs (`smoke`, `startup`,
  `workbench`, `connections`) is runnable anywhere; everything else needs Docker/Colima (AGENTS.md).
- Conventional Commits, one per step of §4.

---

## 1. Findings

### Item 1 — "describe is not supported for kafka / for sqs"

**F1 — the log line is real, and it is not the definition data's source.** `kafka/index.ts:87-90`
and `sqs/index.ts:81-84` implement `describe()` as an unconditional
`throw new AdapterError('E_UNSUPPORTED', 'describe is not supported for kafka')` — with a comment
(`kafka/index.ts:88`) asserting it is *"never reached by a 'stream' tab"*. That comment is accurate
about the stream tab and wrong about the **definition** tab, which P23 gave these two engines.

**F2 — the definition view calls `describe()` on every open and every refresh, for every engine.**
`views/definition/state.ts:61-64` issues both loads together:
`Promise.allSettled([control.treeDefinition(...), control.treeDescribe(...)])`, with a comment (`:57-60`)
recording that P23 made the *failure* survivable (`meta` stays null) — but the call itself was never
gated. `caps.definition` is `true` for Kafka (`kafka/caps.ts`) and SQS (`sqs/caps.ts`), so opening a
topic/queue/consumer-group definition tab reliably fires one describe that can only ever fail.

**F3 — the data on screen is real, live and un-mocked.** A topic's Structure comes from
`kafka/definition.ts:18-92`: `admin.fetchTopicMetadata` for the Partitions section and
`admin.describeConfigs` for Configuration (sensitive values masked, `:57`), both against the live
`Admin` client from `connect()` (`kafka/index.ts:39-57`). A consumer group comes from
`admin.describeGroups` + `admin.fetchOffsets` (`:94-171`). A queue comes from one
`GetQueueAttributesCommand({ AttributeNames: ['All'] })` (`sqs/definition.ts:25-40`). There is no
fixture, stub or sample payload anywhere in `engine/adapters/kafka/` or `sqs/`. **Verdict: nothing is
mocked.** The only staleness risk is the ordinary L1 one — `definition()` results are cached in
`metadata_cache` with **no TTL** (SPEC §7), refreshed on reconnect or an explicit Refresh, exactly
like a Postgres table's DDL.

**F4 — where the message actually surfaces, and why it repeats forever.** The throw travels
`engine/control.ts:90-98` → `runOp`'s catch (`engine/scheduler/ops.ts:76-84`), which emits
`op:end` with `status: 'error'` and the message; `main/oplog.ts:64-93` persists it to `op_log` and
broadcasts it, so it lands as a red row in the Operations panel (kind `describe`) and in the log
file. `tree-service.ts:96-114` calls `putCached` **only after a successful** engine call, so the
failure is never cached: it re-fires on every open of every Kafka/SQS definition tab, and again on
every Refresh. That is the "error in the logs while data shows" the user reported, in one sentence.

**F5 — the renderer has no way to know an adapter cannot describe.** `Caps` (`shared/caps.ts:22-58`)
models `definition`, `sql`, `projection`, `foreignKeys`, `cancel` … but nothing for `describe()`.
Four adapters throw on it: Kafka (`:89`), SQS (`:83`), Redis (`redis/index.ts:93`) and S3
(`s3/index.ts:98`). Redis/S3 have `definition: false` so they never reach F2's call — but that is a
coincidence of two unrelated flags, not a guarantee.

**F6 — the grid's own describe call is not affected.** `views/grid/state.ts:75` calls `treeDescribe`
for `data` tabs only, which exist only for `tabular` adapters (Postgres, MariaDB), all of which
implement it. No other caller exists (`grep treeDescribe`: definition/state.ts, grid/state.ts).

### Item 2 — the tab strip cannot scroll

**F7 — its computed `overflow-x` is `hidden`, so it is not a scroll container at all — verified
live.** Two different components both name their element `.tab-strip`:
`WorkbenchShell.vue:57` (`<div class="tab-strip" data-testid="tab-strip">`, styled `:146-163` with
`overflow: hidden`) and `TabStrip.vue:134`/`:168` (its own root, styled `:172-187` with
`overflow-x: auto; overflow-y: hidden; scrollbar-width: none` and the comment *"Scrolls with too many
tabs open"*). **A child component's root node carries its parent's scope id as well as its own**, so
WorkbenchShell's `.tab-strip[data-v-8afacf7f]` also matches TabStrip's root — same specificity, later
in the stylesheet, so `overflow: hidden` wins. Measured in the running app:

```
inner: attrs [data-v-190f08c9, data-v-8afacf7f], class "tab-strip is-empty", overflowX: "hidden",
       matched rules: .tab-strip[data-v-190f08c9] {…overflow-x:auto…}
                      .tab-strip[data-v-8afacf7f] {height:34px; overflow:hidden; …}
```

with `scrollWidth 3666` vs `clientWidth 728` after injecting 30 tab-width children, and
`scrollLeft === 0` after both a vertical and a horizontal `mouse.wheel`. The tabs past the right
edge are clipped and unreachable by any pointer gesture. (`scrollIntoView` still works — a
`overflow: hidden` box is programmatically scrollable — which is why `TabStrip.vue:119-130`'s
"scroll the newly active tab into view" watch appears to work while manual scrolling does not.)

**F8 — tabs genuinely overflow rather than shrinking**: `.p-tab` is `flex-shrink: 0; max-width: 210px`
(`primitives.css:319-332`), so the strip's content width grows without bound as tabs are opened.

**F9 — even once it scrolls, there is no affordance.** `scrollbar-width: none` +
`::-webkit-scrollbar { display: none }` (`TabStrip.vue:182-187`) hide the scrollbar deliberately, and
nothing translates a vertical wheel (the only wheel axis a plain mouse produces) into `scrollLeft`.

### Item 3 — "changing fonts doesn't work"

**F10 — the setting itself works end to end. Verified live, three ways.** In the built app: typing a
family and committing sets `--kira-font-family` on `:root` (`state/settings.ts:12-20`'s
`applyAppearance`), `getComputedStyle(document.body).fontFamily` follows it (`theme/base.css:56-58`),
and the value survives a relaunch (`settings` rows via `storage/repos/settings.ts`). Pressing Escape
to close the dialog does **not** lose it either — Chromium fires `change` when the focused input is
removed. So the report is not "the plumbing is broken"; it is one of F11–F14.

**F11 — an unavailable font family is applied silently and looks like nothing happened.** The field
is free text with a four-option `<datalist>` (`SettingsDialog.vue:138-149`). Type `Fira Code`,
`Inter`, or any family not installed and the app stores it, sets the variable, and renders in the
fallback — with no message, no validation and no preview. This is the single most likely cause of the
report. Measured in-app: `document.fonts.check('12px "NoSuchFontXyz"')` returns **`true`** (it is
useless for this), while a canvas `measureText` comparison against two different generic families
detects the fallback exactly (bogus family measured 462.375 px, identical to `monospace`; `serif`
measured 549.28 px).

**F12 — the commit trigger silently reverted a P16 decision.** P16 §6 changed the family field from
`@change` to `@input` precisely so a value could not be lost; commit `7641dd6` ("Fix mock-fidelity
issues…") changed it back to `@change` while converting the field to `<TextField>`
(`SettingsDialog.vue:141-145`), with no note. The revert is defensible on its merits (F10 shows the
loss P16 feared does not occur, and per-keystroke commits repaint the whole app's font for every
partial family name) — but it is undocumented drift, and it means the field gives **zero** feedback
until it is left.

**F13 — grid column widths are measured once, with whatever font was active then, and never again.**
`views/grid/columns.ts:9-22` memoizes the measuring canvas in module state
(`if (measureCtx) return measureCtx`), reading `--kira-font-family`/`--kira-font-size` on first use
only. `initialWidths` (`:25`, called from `DataGrid.vue:99` and `ConsoleResultGrid.vue:39`) therefore
keeps sizing columns for the *old* font for the rest of the session — after switching to a wider
family every unstored column is too narrow and clips. Nothing else in the app has this problem:
`CodeMirrorHost.vue:216-221` explicitly watches both appearance settings and calls
`view.requestMeasure()`.

**F14 — four inputs never follow the setting by design.** `.p-input.ui`
(`primitives.css:143-146`) hard-codes `-apple-system, "SF Pro Text", system-ui, …`; its four call
sites are `CommandPalette.vue:61`, `SearchBox.vue:12`, `ConnectionDialog.vue:263` and `:299`. SPEC
§8.2 says *"one font family + size for the whole app (UI, grid and editors alike)"*, so this is a
real divergence — recorded here, deliberately **not** changed (§6).

### Item 4 — window inset

**F15 — the workbench is inset from the window by exactly 2px on all four sides.**
`WorkbenchShell.vue:106-124` sets `padding: var(--kira-gap)` and `gap: var(--kira-gap)` from one
token, `--kira-gap: 2px` (`tokens.css:36`), whose own comment says it drives *both* the inter-panel
whitespace **and** the splitter track width. Raising the token would thicken every splitter; the
outer inset therefore needs its own token.

### Item 5 — Kafka's ISO timestamp field

**F16 — the "since" filter is a bare text field with no picker and no validation.**
`StreamView.vue:574-583`: `<TextField v-model="timestampText" prefix="since" placeholder="ISO
timestamp" @enter="onApplyFilter" @blur="onApplyFilter" />`. P24's app-owned calendar exists two
folders away (`views/celleditor/DateTimePicker.vue`, props `{ modelValue: Date; zone: 'local'|'utc' }`)
and its trigger pattern — an `IconButton icon="calendar"` inside a `PopoverPanel` — is already
written in `views/celleditor/TimestampPane.vue:117-134`.

**F17 — an unparseable entry is silently discarded rather than reported.**
`views/stream/state.ts:79-83` builds the filter with `Date.parse(tab.state.timestampFilter)`, which
returns `NaN` for junk. `isEmptyKafkaStreamFilter` (`shared/domain/streamFilter.ts:25-27`) sees
`NaN !== null` and keeps the filter, then `JSON.stringify` turns `NaN` into `null`
(`:29-32`) — so the engine receives a filter that says "no timestamp", the browse silently starts at
the low watermark, and the field keeps showing the text the user typed as if it had been applied.

**F18 — §11's dependency rule blocks the obvious import.** `views/*` are siblings that may not import
each other (SPEC §11: *"never sideways on each other"*); `views/shared/` is the established home for
a component two views need (`SavedListMenu.vue`, `FilterHistoryMenu.vue` already live there).
`DateTimePicker.vue` has no cell-editor coupling at all — its props are a `Date` and a zone — so it
can move as-is. `celleditor/timestamp.ts` cannot: it is typed against `CellFormat`
(`celleditor/formats.ts`), which is genuinely cell-editor vocabulary.

### Items 6 and 7 — search across the four views

**F19 — the filter toggle exists only in the grid, exactly as P24 D12 scoped it.**
`views/grid/search.ts:37-75` owns `searchFilterState`, `isSearchFiltering`, `setSearchFiltering` and
`matchedRows`; `SearchToolbar.vue:186-199` renders the toggle. P24 §6 named the follow-up in so many
words: *"The filter toggle in the document, key/value and stream search toolbars… makes each a
five-line follow-up."*

**F20 — three of the four search modules already share one match shape.**
`grid/search.ts:6-11` (`{row,col,start,end}`), `documents/docSearch.ts:5-9` (`{row,start,end}`) and
`keyvalue/kvSearch.ts:10-15` (`{row, col:'field'|'value', start,end}`) all store
`Record<tabId, { matches: Match[]; index: number }>`; `stream/streamSearch.ts:13-19` stores
`{ query, matches: number[], index }`. Every one of them can produce an ascending de-duplicated row
list in one pass, exactly as `matchedRows` already does.

**F21 — Mongo's document view highlights nothing at all.** `DocumentView.vue:622-627` mounts
`DocumentSearchToolbar` and `:276-286`'s `onGoToMatch` expands + scrolls to a hit, but the row
markup (`:640-651`) binds only `open` and `selected` — there is no `search-match` class, and
`docSearch`'s `searchState` is never read by the view. A search in Mongo moves the viewport and shows
a count; nothing on screen says *which* document matched.

**F22 — the stream view highlights, but with a different visual language.**
`StreamView.vue:322-326` builds `matchSet`/`currentMatchRow`, `:684-687` binds
`search-match`/`search-match-current`, and `:787-793` styles them as
`box-shadow: inset 2px 0 0 var(--kira-warn)` + a plain hover-grey for the current match. The grid
(`DataGrid.vue:1461-1469`) and key/value (`KeyValueView.vue:693-700`) both use
`color-mix(in srgb, var(--kira-warn) 25%, transparent)` for a match and a solid warn fill for the
current one. Same concept, three-quarters of the app agreeing, stream the odd one out.

**F23 — no search toolbar reacts to its page being replaced.** All four scan on
`watch([query, matchCase, wholeWord, regex], startSearch)` (`SearchToolbar.vue:88`,
`DocumentSearchToolbar.vue:68`, `KeyValueSearchToolbar.vue`, and `StreamSearchToolbar.vue:30-34`'s
`watch(query, …)`) and on nothing else. Paging, Fetch more, a page-size change, Refresh, a `WHERE`
re-run or a poll all call `setPage` (`grid/page.ts:18-24`, `stream/streamPage.ts:15-20`,
`documents/docPage.ts:15-20`, `keyvalue/kvPage.ts:15-20`), which replaces the page and bumps
`pageVersion.n` — while `searchState[tabId].matches` keeps row indices into the *previous* page.
The grid then highlights `row:col` pairs that now hold unrelated values (`DataGrid.vue:514-527`), the
counter keeps reporting the old total, and prev/next scrolls to arbitrary rows.

**F24 — the scope label is not merely stale, it has no reactive dependency at all.**
`const loadedRowCount = computed(() => getPage(props.tabId)?.rowCount ?? 0)` —
`SearchToolbar.vue:21`, `DocumentSearchToolbar.vue:13`, `StreamSearchToolbar.vue:20`,
`KeyValueSearchToolbar.vue`'s equivalent. `getPage` reads a **plain `Map`** (`page.ts:12`, *"NOT
reactive"*), so "in the N loaded rows" is frozen at whatever the count was when the toolbar mounted.
Every other page consumer takes `void pageVersion.n` as an explicit dependency
(`DocumentView.vue:287-289`, `DataGrid.vue:467`) — the toolbars are the ones that forgot.

### Items 8–11 — project panel, connection dialog, history menu

**F25 — the tree twisty's tooltip.** `TreeRow.vue:91-102`: the expand/collapse button carries both
`v-tooltip="row.expanded ? 'Collapse' : 'Expand'"` and an identical `:aria-label`. It is the one
tooltip in the app that describes a control whose entire meaning is already drawn by the chevron
direction, and it fires on the single most-hovered control in the panel. No spec asserts it
(`grep data-kira-tip tests/ui` — nine sites, none in the tree except `.status-dot`).

**F26 — "no colour" is drawn as a hollow ring, which on a dark surface reads as a dark swatch.**
`ColorPicker.vue:63-66`: `.swatch.none { border: 1.5px solid var(--kira-fg-disabled); background:
transparent; }` — a 16px circle whose fill is the dialog's own background, outlined in the app's
*disabled* grey. Beside twelve saturated 16px discs it reads as "a very dark thirteenth colour",
which is the report. `.p-conn-dot.none` (`primitives.css:529-532`) has the same shape at 5px, where
it works because it is a status dot, not a choice.

**F27 — the filter history menu truncates with no way to see the rest.**
`SavedListMenu.vue:118-125` styles the caller-slotted `.entry-name` with
`overflow:hidden; text-overflow: ellipsis; white-space: nowrap` inside a 320px `PopoverPanel`
(`:56`), and the callers render the full text into it —
`FilterHistoryMenu.vue:156-159` (`summarize()` = `WHERE … / ORDER BY …`, `:81-87`),
`StreamFilterHistoryMenu.vue:84`, `ConsoleSavedMenu.vue:115`. **No `v-tooltip` is bound on any entry
row or entry name in any of the three.** The app's tooltip is already the right size for this:
`AppTooltip.vue:70-75` is `max-width: 320px; white-space: pre-wrap`, i.e. it wraps rather than
truncating.

### Item 10 — column type info

**F28 — the glossary exists but is deliberately partial.** `project/typeGlossary.ts:1-49`:
*"Returns null for the common/obvious ones (int, text, boolean, …) — the definition view's Columns
section only shows an info icon when there is actually something to explain."* Twenty-three patterns,
all Postgres/MariaDB exotica. `ColumnsSection.vue:70-77` renders the info icon only when
`typeDescription()` is non-null, so most rows in a typical table have none.

**F29 — the grid header's hover text carries the type but never explains it.**
`DataGrid.vue:86-93`'s `headerTitleFor` returns `dataType` plus the DB comment when there is one,
bound at `:1084`. The header is where a type is actually read while working; the definition tab is
where the glossary lives.

### Item 12 — pending deletes

**F30 — the gutter has yellow and green rails and no red one.** `DataGrid.vue:1388-1420`:
`.gutter-cell.dirty::before` is a 2px `var(--kira-warn)` rail, `.gutter-cell.inserted::before` a 2px
`var(--kira-ok)` rail. A pending delete gets **neither** — `isDirtyRow` (`:150-153`) returns true for
`p.edits.has(row) || p.deletes.has(row)`, so a deleted row currently paints the *edited* yellow, and
the only delete-specific cue is `.grid-row.pending-delete { text-decoration: line-through; opacity:
.5 }` (`:1519-1522`).

**F31 — the Delete shortcut only fires for a row selection.** `DataGrid.vue:974-989` dispatches
`grid.deleteRows`/`grid.duplicateRows` through `rowMenu()` *"only [when] a row selection has a
rowMenu to dispatch into"*, with its own comment recording that a cell/range selection leaves them
inert. A row selection requires clicking the gutter; clicking a cell — the ordinary way to pick a
row — leaves `Delete`/`⌘⌫` doing nothing. The binding itself is fine
(`shared/shortcuts.ts:43-47`: `Delete`, mac `Cmd+Backspace`, `global: false`).

**F32 — the cell context menu has no Delete row.** `gridMenu.ts:155-235`'s `cellMenu` ends at
*Filter by this value* + FK items; `Delete row(s)` (`:316-324`) is in `rowMenu` only, which is opened
from `onGutterContextMenu` (`DataGrid.vue:769-791`) — the gutter, not the cell
(`onCellContextMenu`, `:792-812`). SPEC §8.10's "Grid cell" row likewise has no Delete.

### Item 13 — sort indicator in the header

**F33 — the direction is a text character in the label flow.** `DataGrid.vue:1092-1104`: the header
cell renders `header-label`, then `header-key`, then
`<span class="sort-chevron">{{ dir === 'asc' ? '▲' : '▼' }}</span>`, then a `sort-order` number badge
when more than one sort term is active (`:396-400`). Both are text (`:1314-1332`, `font-size:
var(--kira-t-xs)`), rendered in the user's **data font** — so their size, weight and even glyph
shape change with item 3's setting — and both sit inline after the name, so on a narrow column they
consume the space the column name needs and the name ellipsises instead. Every other state indicator
in the app is a codicon (LAW 02: *"Every icon occupies a 16px box with a 13px glyph"*).

### Item 14 — console autocomplete arrow keys

**F34 — a keymap precedence inversion; the library's own answer is one wrapper this file drops.**
`CodeMirrorHost.vue:131-140` builds the extension array in this order:

```ts
keymap.of(defaultKeymap),                                  // :136
autocompleteCompartment.of(resolveAutocomplete()),         // :137
```

and `resolveAutocomplete` (`:96-107`) passes `defaultKeymap: false` to `autocompletion()` and adds
its own `keymap.of(CONSOLE_COMPLETION_KEYMAP)` (`:83-87`, `completionKeymap` minus Enter, plus Tab)
at **default precedence**. In CodeMirror 6 an earlier extension wins, so `defaultKeymap`'s
`ArrowUp`/`ArrowDown` (`cursorLineUp`/`cursorLineDown`) handle the key first and return `true`;
`moveCompletionSelection` never runs. The library itself does not rely on ordering — it wraps the
same bindings in `Prec.highest`: `@codemirror/autocomplete/dist/index.js:2074`,
`const completionKeymapExt = Prec.highest(keymap.computeN([completionConfig], …))`. Turning
`defaultKeymap: false` on without reproducing that wrapper is what broke it. Tab still works because
`defaultKeymap` binds no `Tab`, which is why P18's addendum looked correct at the time. `PageUp`/
`PageDown` (`moveCompletionSelection` by page) are shadowed by the same mechanism.

### Items 15 and 16 — toolbar indicator, preview spacing

**F35 — the Columns "activated" badge is a two-token text label positioned outside the button.**
`DataToolbar.vue:135-146`'s `columnsBadge` returns `columnCountLabel` (`"5 / 12"`, `:128-133`) when a
projection is set and `'•'` when only the order changed; `:305-312` passes it as `IconButton`'s
`count`. `IconButton.vue:38-62` renders that as `.corner-count`, absolutely positioned at
`right: -6px`, vertically centred over the button — the file's own comments record two previous
bug-fix rounds on this same badge ("indicator floats above the toolbar", "Columns button is
vertical"). A four-character label in a 22px button's corner cannot not overlap. `DocumentView.vue:520`
passes the identical `"N / M"` count to the Mongo fields button — the same bug, second site.

**F36 — the preview panel joins statements with a single newline.**
`PreviewCommandPanel.vue:18`: `statements.value.join(';\n') + (statements.value.length ? ';' : '')`.
A multi-statement preview (an UPDATE plus two DELETEs, each of which may itself wrap) reads as one
block.

---

## 2. Shapes introduced in this plan

```ts
// src/shared/caps.ts — one field, mirroring how `definition`/`sql` already gate a UI affordance.
export interface Caps {
  // …
  /** The adapter implements describe(); gates the definition view's second, metadata load.
   *  false for kafka/sqs/redis/s3 — a stream or a key has no column/PK/FK metadata to describe. */
  describe: boolean;
}
```

```ts
// src/renderer/views/shared/searchFilter.ts — NEW. P24 D2's per-tab toggle, hoisted so the four
// in-page search toolbars share one implementation instead of four copies. Tab ids are globally
// unique, so one map is safe across view kinds.
export const searchFilterState: Record<string, boolean>;
export function isSearchFiltering(tabId: string): boolean;
export function setSearchFiltering(tabId: string, on: boolean): void;
/** Ascending, de-duplicated row indices — accepts either match shape in the app
 *  ({row:number}[] for grid/documents/keyvalue, number[] for stream). One pass, no sort, no Set:
 *  every scanner already emits in ascending row order (P24 F1). */
export function matchedRowsOf(matches: readonly { row: number }[] | readonly number[]): number[];
```

```ts
// src/renderer/views/grid/columns.ts — additions only.
/** Drops the memoized measuring context so the next initialWidths() re-reads the appearance
 *  tokens. Called from applyAppearance() (F13). */
export function resetMeasureCtx(): void;
```

```ts
// src/renderer/state/settings.ts — additions only.
/** Bumped by applyAppearance(); a component that measures text (the grid's column widths) takes
 *  this as a reactive dependency so a font change re-measures instead of reusing stale widths. */
export const appearanceVersion: { n: number };
```

```ts
// src/renderer/fonts.ts — NEW, sibling of format.ts/clipboard.ts (P24 D35's precedent).
/** True when at least one family in `stack` actually resolves. Canvas-measures the stack against
 *  two different generic fallbacks: document.fonts.check() returns true for a nonexistent family
 *  (measured in the built app, F11) and cannot be used. */
export function fontStackAvailable(stack: string): boolean;
```

```vue
<!-- src/renderer/views/shared/DateTimePicker.vue — MOVED verbatim from views/celleditor/.
     Two views need it now (the cell editor's TimestampPane and Kafka's stream filter) and §11
     forbids a sideways views/* import (F18). Props and emits unchanged:
     { modelValue: Date; zone: 'local' | 'utc' } / 'update:modelValue'. -->
```

```vue
<!-- src/renderer/theme/primitives/IconButton.vue — one prop added beside `count`:
     indicator?: boolean — a 5px accent dot drawn INSIDE the button's own box (top-right),
     for "this control is currently doing something" where a number would not fit (D26). -->
```

```css
/* tokens.css */
--kira-window-inset: 6px;   /* app chrome ↔ window edge (D8); deliberately not --kira-gap, which
                               also sets the splitter track width */

/* primitives.css */
.p-iconbtn.has-indicator::after { /* 5px accent dot, top: 2px; right: 2px; pointer-events: none */ }
.swatch.none { /* diagonal-slash gradient over a transparent fill (D18) */ }
```

---

## 3. Decisions

### Item 1 — the stale describe

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Answer the question in the plan and in the commit message: the Kafka/SQS definition data is real, live and un-mocked** (F3), and the log line is an unrelated second call (F1/F2). | The user's actual worry is "is what I'm looking at fake". F3 answers it from the adapter source: three live admin/SDK calls, no fixture anywhere in the two adapter folders. Everything below is the fix for the *log line*, which is a separate, smaller problem. |
| D2 | **Add `describe: boolean` to `Caps`** — `true` for postgres/mariadb/mongo, `false` for kafka/sqs/redis/s3 — and gate `views/definition/state.ts`'s `treeDescribe` call on it. | F5: the renderer cannot currently distinguish "this adapter has no describe" from "this describe failed", and P23 taught it to swallow both. A capability flag is how this codebase already expresses exactly that (`definition`, `sql`, `projection`, `cancel`), it is validated at the boundary by `capsSchema`, and it makes the guarantee structural: no caller can ask an adapter for something it has declared it cannot do. |
| D3 | **The adapters keep throwing `E_UNSUPPORTED` from `describe()`.** Their comments are corrected to say *"unreachable while `caps.describe` is false"* rather than *"never reached by a 'stream' tab"*. | The throw is the contract's own backstop and costs nothing; it was never the bug. What was wrong was a comment asserting a reachability claim that P23 had already invalidated — the exact class of drift these plans exist to catch. |
| D4 | **When `caps.describe` is false the definition view skips the load entirely** — `rt.meta` stays `null` and the Structure body renders from `sections` alone, exactly as it does today after the failure. No user-visible change, no new empty state. | P23 D8 already made `meta: null` a first-class state (`state.ts:57-60`); this only removes the round trip and the error that produced it. Rendering must be byte-identical before and after, which is what §5's regression assertion pins. |
| D5 | **`Promise.allSettled` stays** even though only one promise can now reject. | The definition load can still fail on its own (a denied `describeConfigs`, a dropped connection), and the settled shape is what keeps a failed *describe* on a Postgres table from blanking the tab — P23's own D8 guarantee, which nothing here should quietly withdraw. |

### Item 2 — scrollable tabs

| # | Decision | Rationale |
|---|----------|-----------|
| D6 | **Rename WorkbenchShell's wrapper class from `.tab-strip` to `.tab-strip-slot`** (its `data-testid="tab-strip"` is unchanged — six specs use it). | F7 is a class-name collision made invisible by scoped CSS's root-node rule. Renaming the *outer* one is the smaller, safer half: the inner name is what `TabStrip.vue`'s own rules, and its `is-empty` modifier, are written against. Fixing it by raising specificity or `!important` would leave the trap armed for the next component that names its root after its parent's slot. |
| D7 | **Give the strip a real affordance, not just the ability to scroll**: a `wheel` handler translating `deltaY` into `scrollLeft` when the strip overflows (a mouse produces no `deltaX`), plus a thin auto-hiding horizontal scrollbar (`scrollbar-width: thin` with the app's own `--kira-scrollbar` thumb) instead of `scrollbar-width: none`. The active-tab `scrollIntoView` watch (`TabStrip.vue:119-130`) is unchanged. | Without the wheel handler the fix is only reachable by trackpad; without a visible track there is nothing on screen saying more tabs exist, which is half the complaint. `base.css:73-86` already styles the app's scrollbars, so "thin" means the app's own, not the OS default. Overflow chevron buttons (VS Code's other answer) are rejected in §6 — two more always-present controls in a 34px strip, for a gesture the wheel already covers. |

### Item 4 — window inset

| # | Decision | Rationale |
|---|----------|-----------|
| D8 | **New `--kira-window-inset: 6px`; `WorkbenchShell.vue`'s padding becomes `var(--kira-window-inset) var(--kira-window-inset) var(--kira-gap)`** (top/right/left inset, bottom stays 2px). `--kira-gap` and every splitter are untouched. | F15: the two measurements are conflated in one token whose own comment says it also sizes the splitter track — raising it would thicken every resize bar, which was explicitly tuned down once already. 6px is `--kira-s-3`, on the space scale, and "just a tiny bit" more than the current 2. Bottom is left alone because the user named three edges and because the status bar reads as seated on the window edge, like VS Code's. |

### Item 3 — fonts

| # | Decision | Rationale |
|---|----------|-----------|
| D9 | **Tell the user when the family will not render**: on `input`, `fontStackAvailable()` (canvas measurement, F11) marks the field with the existing `.p-input.is-invalid` rule (P24 D36 made it a real rule) and shows a helper line — `Not installed on this Mac — text falls back to <resolved family>`. Saving is never blocked. | The setting works (F10); what does not work is knowing it did nothing. `document.fonts.check()` is measurably useless here (returns `true` for a bogus family, verified in-app), so the measurement is the only honest test. Blocking the save would be wrong — the value is the user's, and a family may be installed later. |
| D10 | **Add a live preview line under the field**, rendered in the candidate family as typed (`@input`), and keep the **commit** on `@change` as it is today. This supersedes P16 §6's `@input` decision, on the record. | This gets P16's real goal — immediate feedback — without repainting the entire app's font on every partial family name (`M`, `Me`, `Men`, …). F10's live run shows the loss P16 feared (Escape before blur) does not occur in this Electron build. Recording the supersession is the point: `7641dd6` reverted P16 silently, and an undocumented revert is how a fixed bug comes back. |
| D11 | **`applyAppearance()` calls `resetMeasureCtx()` and bumps `appearanceVersion.n`; `DataGrid.vue`'s `widths` computed takes that as a dependency.** | F13: without it, changing the font resizes the text inside columns measured for the old font, so a wider family clips in every already-open grid — the most visible way "changing fonts doesn't work" can be literally true. The counter is one integer and only re-measures when appearance actually changes; explicitly stored per-column widths still win, as they do today. |

### Item 5 — the Kafka date picker

| # | Decision | Rationale |
|---|----------|-----------|
| D12 | **Move `DateTimePicker.vue` from `views/celleditor/` to `views/shared/`, unchanged**, and update the two importers. `timestamp.ts` stays in `views/celleditor/`. | F18: two views need the picker and §11 forbids importing sideways; `views/shared/` is where this codebase already puts exactly that (`SavedListMenu.vue`). The picker's props are a `Date` and a zone — nothing cell-editor-shaped. `timestamp.ts` genuinely is cell-editor vocabulary (it is typed on `CellFormat`), and the stream filter needs none of it. |
| D13 | **The stream filter's field gains a calendar `IconButton` + `PopoverPanel` + `DateTimePicker`, copying `TimestampPane.vue:117-134`'s trigger arrangement.** Picking a moment writes `date.toISOString()` into `timestampText` and applies the filter, exactly as typing + blur does today. | The ask, literally. `toISOString()` (not P24's shape-preserving `encodeTimestamp`) is correct here because this field is an *input to a query*, not a round trip of a stored value: `views/stream/state.ts:82` parses it with `Date.parse`, and Kafka's `fetchTopicOffsetsByTimestamp` wants epoch ms. There is no original spelling to preserve. |
| D14 | **An unparseable timestamp is reported, not swallowed**: `StreamView.vue` validates on apply, marks the field `.is-invalid` with the reason, and does not issue the read. `views/stream/state.ts` additionally treats a `NaN` parse as `null` so no caller can smuggle one through. | F17 is a silent-wrong-answer path: today the browse quietly ignores the filter, starts at the low watermark, and leaves the invalid text sitting in the field looking applied. Both halves are needed — the view's message is what the user sees, the state guard is what makes the wire payload honest regardless of caller. |
| D15 | **The message list's `timestamp` column is left exactly as it is.** | Clicking it already publishes to the cell editor (`StreamView.vue:136-160`), which since P24 shows the ISO value in the timestamp translate pane with both readings and a calendar — read-only, because a Kafka message's timestamp is not editable. There is nothing to add and nothing to duplicate. |

### Items 6 and 7 — search parity and freshness

| # | Decision | Rationale |
|---|----------|-----------|
| D16 | **Hoist the toggle state into `views/shared/searchFilter.ts` (F20's `matchedRowsOf` included); `views/grid/search.ts` keeps `matchedRows(tabId)` as a thin wrapper over it.** | Four copies of an eight-line reactive record is exactly the drift P24's own F5 documented in these same four files. One module, one cleanup registration, one semantic. The grid's public shape does not change, so `DataGrid.vue`, `SearchToolbar.vue` and `data-view.spec.ts` are untouched by the move. |
| D17 | **The toggle goes into all four toolbars — stream, documents, key/value included — with identical icon (`filter`), testid suffix (`-search-filter-rows`), tooltip wording and placement.** | The ask names Kafka/SQS/Mongo; key/value is the fourth instance of the same widget and already has full matcher parity, so leaving it out would make "does this view's find widget filter?" a lottery. It is genuinely the five-line change P24 §6 predicted: each view renders a plain `v-for` over an index array, so the filter is one `.filter()` on that array. |
| D18 | **Filtered views keep each row's real number** (`i + 1` in `StreamView.vue:692`, the document list's own ordering), the pending-insert exemption has no analogue here, and closing/unmounting the toolbar clears the toggle. | P24 D4/D7 verbatim: a jump in the numbers is the affordance that says rows are hidden, and a closed toolbar must never leave rows hidden with no visible cause. Reusing the decisions rather than re-deciding them is the whole reason the state module is shared. |
| D19 | **Zero matches while filtering shows `EmptyState icon="search" label="No matching rows"` with the *Show all rows* action** — the slot P24 D8 added to `EmptyState.vue` — in each of the three views. | LAW 15, and the exact case P24 built the slot for. Without it, a filtered stream view with no hits renders as an empty message list, indistinguishable from an empty topic. |
| D20 | **Mongo gets real match highlighting**: the matched document row takes `.search-match`, the current one `.search-match-current`, using the same `color-mix(... warn 25% ...)` / solid-warn pair the grid and key/value use — and the matched substring inside the collapsed preview line is wrapped in `<mark>` using `docSearch`'s `start`/`end` offsets, which are already computed against exactly that string (`docSearch.ts:43-45`, `:82`). | F21: today a Mongo search says "3 of 7" and shows nothing. The substring wrap is free because `previewLineFor` is shared between the scanner and the renderer by construction — the offsets cannot disagree. Expanded document bodies are **not** highlighted (§6). |
| D21 | **Stream match highlighting adopts the app's own two rules** (`color-mix` tint + solid current), replacing the inset 2px bar. | F22: three views agree, one does not, and the odd one is the one whose left edge is otherwise unused. Row-level, not per-cell: `streamSearch` matches on a concatenated haystack (`streamSearch.ts:41`) and genuinely does not know which column hit. |
| D22 | **Every search toolbar takes `pageVersion.n` as an explicit dependency and re-scans when the page is replaced**: the scope-label computed reads it (fixing F24), and a `watch(() => pageVersion.n)` clears `searchState[tabId]` immediately and restarts the scan if the query is non-empty. | F23/F24. Clearing *before* rescanning is not optional: between a page swap and a completed scan, the old match list points at rows that now hold different data, and both the grid's cell highlight and prev/next act on it. Only the active tab's toolbar is ever mounted (`MainView.vue:67-92` renders `activeTab` alone), so watching the module-global counter costs at most one redundant rescan and needs no per-tab counter. |
| D23 | **The re-scan resets `index` to the first match (or −1), and never auto-scrolls.** | Restoring "match 4 of 9" on a page that no longer has nine matches is a guess; jumping the viewport because a background refresh landed would move the page under the user's hands. First-match-selected-but-not-scrolled is the same state a fresh scan produces, minus the scroll. |
| D24 | **Still zero server interaction, zero op-log rows.** The filter and the re-scan both read only the page the view already holds. | LAW 16 / P24 D13. §5 asserts it the same way P24 did: capture the op-log length across the whole sequence and require it unchanged. |

### Items 8–11 — panel and dialog papercuts

| # | Decision | Rationale |
|---|----------|-----------|
| D25 | **Delete the twisty's `v-tooltip`; keep its `:aria-label`.** | F25, and the ask. The label must stay: P22's directive mirrors a tooltip into `aria-label` only when the control has no accessible name, so dropping both would leave a nameless button. This is the one place the app's tooltip explains an icon that already says the same thing by pointing. |
| D26 | **"No colour" becomes an outlined swatch with a diagonal slash** — a `linear-gradient` bar corner-to-corner in `--kira-fg-muted` over a transparent fill, ring brightened from `--kira-fg-disabled` to `--kira-fg-muted`, tooltip/`aria-label` reworded to `No colour`. `.p-conn-dot.none` (the 5px rail dot) is left alone. | F26: the universal "none" mark in every colour picker, unmistakable at 16px, and it stays a *swatch* rather than becoming an icon button. A checkerboard was considered and rejected — at 16px inside a circle it reads as noise, and this app has no other checkerboard. The rail dot is not a choice affordance and has no ambiguity to fix. |
| D27 | **Every saved/recent entry name gets `v-tooltip` with its full, untruncated text** in all three menus (`FilterHistoryMenu.vue`, `StreamFilterHistoryMenu.vue`, `ConsoleSavedMenu.vue`); a saved entry's tip is `name` + the summary it stands for, a recent entry's is the summary. `SavedListMenu.vue` is unchanged. | F27: the popover is 320px and the content is a full `WHERE … / ORDER BY …`, so truncation is structural, not a sizing accident — widening the popover only moves the cut. `AppTooltip` is already `max-width: 320px; white-space: pre-wrap`, so a long clause wraps to as many lines as it needs. Binding in the callers (which own the text) rather than adding a `tipFor` prop to the shell keeps the shell free of business logic, as its own doc comment requires. |

### Item 10 — type info

| # | Decision | Rationale |
|---|----------|-----------|
| D28 | **`typeDescription()` answers for every type the app can show**, not just the exotica: the numeric family, char/varchar/text/blob families, the temporal family (with the `timestamp` vs `timestamptz` distinction spelled out), boolean, serial/identity, array (`type[]`), plus MariaDB's own spellings and Mongo's BSON type names for the Validation section. Length/precision qualifiers (`varchar(64)`, `numeric(10,2)`) are normalised before lookup. | The ask is "all column types", and the current file's rationale — obvious types need no gloss — does not survive contact with `int2`/`int8`/`float8`/`bpchar`/`timestamptz`, which are the catalog's actual spellings and are not obvious at all. Normalising the qualifier is required or `varchar(64)` matches nothing today. |
| D29 | **The grid header's tooltip carries the same description**: `headerTitleFor` becomes `name`, then `dataType`, then the description, then the DB comment, on separate lines (`AppTooltip` is `pre-wrap`). | F29: the header is where a type is read while working. One glossary, two surfaces, no second vocabulary. |
| D30 | **The info icon in the Columns section stays conditional on there being a description** — which, after D28, is nearly always — rather than becoming an unconditional decoration. | The rendering rule does not need to change to satisfy the ask; the data does. Keeping the guard means an unrecognised vendor type still renders cleanly instead of showing an icon with an empty tip. |

### Item 12 — deletes

| # | Decision | Rationale |
|---|----------|-----------|
| D31 | **`isDirtyRow` narrows to `edits` only; a new `isDeletedRow` drives a `deleted` gutter class with a 2px `var(--kira-error)` rail**, mutually exclusive with `dirty` (delete wins when a row is both edited and deleted). The strike-through and 50% opacity stay. | F30, and the ask names the convention it should join. Delete-wins is the honest ordering: a row staged for deletion will not have its edits applied, so painting it "edited" yellow describes an outcome that will not happen. |
| D32 | **`Delete`/`⌘⌫` works from a cell or range selection too** — the handler derives the target rows from whichever selection exists (`{rows}` for a row selection, `[row]` for a cell, the range's row span for a range) and dispatches through `rowMenu()` exactly as it does now. | F31: clicking a cell is how a row gets picked, and a shortcut that only fires after a gutter click is a shortcut most users will never see fire. Dispatching through `rowMenu()` (P21 D5) is what keeps the printed key and the executed action from drifting, and it inherits `disabled: !canEdit` for free. |
| D33 | **`cellMenu` gains `Delete row` with the same `shortcut: 'grid.deleteRows'`, `danger: true`, `disabled: !canEdit`, placed after *Set NULL* and before *Filter by this value*.** SPEC §8.10's Grid-cell row is updated to match. | F32. Singular "row" (not "row(s)") because a cell selection is one row by construction — `rowMenu`'s plural label is correct for its own multi-row case and would be a lie here. |

### Item 13 — the header's sort indicator

| # | Decision | Rationale |
|---|----------|-----------|
| D34 | **Drop the `▲`/`▼` characters. The direction becomes a 13px codicon (`arrow-up`/`arrow-down`) pinned to the header cell's right edge, out of the label's flow** (`margin-left: auto`, `flex-shrink: 0`), and the multi-sort order number rides beside it. The header's `data-sort` attribute (asc/desc/absent) is added so tests and the context menu read state from one place. | F33, and both readings of the ask are satisfied at once: the redundant text glyph is gone from the label, and what remains is the icon indicator. It also fixes a real defect the ask only implies — the glyphs render in the *data font* (item 3's setting), so today a font change resizes and reshapes the app's sort indicator. LAW 02 says every indicator is a 13px codicon; this was the last text-drawn one in the grid. |
| D35 | **Nothing else about sorting changes** — click-to-cycle, the ORDER BY mirroring (`DataGrid.vue:403-411`), the header menu's Sort asc/desc/Clear all stay exactly as they are. | The ask is about what the header *shows*, not what clicking it does. Touching `setSort` would put a filter-toolbar behaviour change inside a cosmetic commit. |

### Item 14 — console autocomplete

| # | Decision | Rationale |
|---|----------|-----------|
| D36 | **Wrap the console completion keymap in `Prec.highest`**, mirroring `@codemirror/autocomplete`'s own `completionKeymapExt` (`dist/index.js:2074`), rather than reordering the extension array. | F34. Reordering would work today and silently break the next time an extension is inserted above it; `Prec.highest` states the requirement rather than depending on array position, and it is precisely what the library does with the same bindings when `defaultKeymap` is left on. Every one of these bindings is a no-op when no completion is active (they return `false`), so ordinary cursor movement is unaffected — which is why the library is comfortable putting them at the highest precedence. |
| D37 | **Enter stays a newline and Tab stays accept** (P18 addendum D18), and the keymap keeps being built by filtering `completionKeymap` rather than being hand-listed. | The multi-line console needs Enter; filtering the library's own list means ArrowUp/ArrowDown/PageUp/PageDown/Escape/Ctrl-Space keep coming from the library, so this fix cannot go stale against a future version of it. |

### Items 15 and 16

| # | Decision | Rationale |
|---|----------|-----------|
| D38 | **The Columns button drops the `"N / M"` count and takes `indicator` — a 5px accent dot inside the button's top-right corner** — whenever the tab deviates from the default column set (projection set, or order changed). The counts move into the tooltip, which already carries them (`DataToolbar.vue:310`). The button also binds `:active="columnsOpen"`, the pressed state P24 D38 gave Search. `DocumentView.vue:520`'s identical badge changes the same way. | F35: a four-character label in a 22px button's corner is unsolvable by nudging, which two prior rounds of comments in `IconButton.vue:38-62` already demonstrate. A dot answers the only question the badge was asked ("is this filtering?"); the exact numbers belong in the hover text, which is where every other detail in this icon-only toolbar lives. Fixing one of the two sites would leave the same overlap one view away. |
| D39 | **`IconButton`'s `count` prop stays** for genuinely numeric badges. | It is a working primitive with other potential callers; the bug was using a text label as an activation indicator, not the badge's existence. |
| D40 | **`PreviewCommandPanel`'s join becomes `';\n\n'`**, with the trailing `;` unchanged. | F36, the ask exactly. `CodeMirrorHost` renders the string verbatim, so this is the whole change. |
| D41 | **SPEC.md is edited by the implementing session, not by this plan** (standing practice, P19/P21/P22/P24 D41): §5's `Caps` block gains `describe`; §8.1 gains the window inset; §8.2 the font-availability feedback; §8.5 the sort-indicator, cell-menu Delete, columns indicator and preview spacing; §8.7/§8.9 the search filter + highlighting; §8.10's Grid-cell row gains Delete row; §8.16 notes Delete fires from a cell selection; §11's tree moves `DateTimePicker.vue` to `views/shared/` and adds `views/shared/searchFilter.ts` and `renderer/fonts.ts`. The §10 P31 row is marked implemented, and the status line at the top updated, only once the phase lands. | The phasing table is a record of what shipped. P31 already has a row (written when the batch was scoped); only its "Implemented per…" note is added at the end. |

---

## 4. Implementation order

Ten commits. Each is independently reviewable, leaves `lint`/`typecheck`/`build` green, and carries
its own test changes. The order puts the two commits that touch shared infrastructure (5 and 6)
adjacent, and everything else is independent — no commit here blocks another.

1. **`fix(definition): stop asking stream adapters to describe`** — D2/D3/D4/D5. `shared/caps.ts`
   (+`capsSchema`), the seven `adapters/*/caps.ts` literals, the four adapters' corrected comments,
   `views/definition/state.ts`'s gate. Tests: `kafka.spec.ts`/`sqs.spec.ts` assert no error op;
   `definition.spec.ts` unchanged and green (the regression guard that Postgres/MariaDB/Mongo
   definition tabs moved by nothing).
2. **`fix(console): let arrow keys reach the completion popup`** — D36/D37, one wrapper in
   `CodeMirrorHost.vue`. Smallest, most self-contained fix in the batch; landing it early keeps it
   out of the way of everything else.
3. **`fix(workbench): make the tab strip scrollable and inset the app chrome`** — D6/D7/D8.
   `WorkbenchShell.vue` (class rename + padding), `TabStrip.vue` (wheel handler, thin scrollbar),
   `tokens.css` (`--kira-window-inset`).
4. **`fix(settings): report an unavailable font and re-measure the grid`** — D9/D10/D11.
   `renderer/fonts.ts` (new), `SettingsDialog.vue`, `state/settings.ts`, `views/grid/columns.ts`,
   `DataGrid.vue`'s `widths` dependency.
5. **`fix(search): keep match state in step with the loaded page`** — D22/D23/D24. All four search
   toolbars: the `pageVersion` dependency in the scope label, the re-scan watch, the index reset.
   No new UI. Lands before step 6 so the parity work builds on a correct base.
6. **`feat(views): search filtering and match highlighting in every in-page find widget`** —
   D16–D21. `views/shared/searchFilter.ts` (new), `views/grid/search.ts` (delegates), the three
   toolbars' toggle, `StreamView.vue`/`DocumentView.vue`/`KeyValueView.vue` row filtering, Mongo's
   highlight + `<mark>`, stream's highlight restyle, the three no-matching-rows empty states.
7. **`feat(stream): a date picker for Kafka's since-timestamp filter`** — D12/D13/D14/D15. The
   `DateTimePicker.vue` move (and the celleditor import update) is the first hunk; `StreamView.vue`'s
   trigger and validation the second; `views/stream/state.ts`'s `NaN` guard the third.
8. **`fix(grid): red rail for pending deletes, Delete from a cell selection and the cell menu`** —
   D31/D32/D33.
9. **`fix(grid): an icon sort indicator, an indicator dot for Columns, spaced preview statements`** —
   D34/D35/D38/D39/D40, plus `DocumentView.vue`'s twin badge. Three unrelated one-file changes that
   share one spec file and one screenshot pass.
10. **`fix(project): type descriptions everywhere, honest no-colour swatch, readable history tips,
    quieter twisty`** — D25/D26/D27/D28/D29/D30. `typeGlossary.ts`, `DataGrid.vue`'s
    `headerTitleFor`, `ColorPicker.vue`, the three history menus, `TreeRow.vue`.
11. **`docs: SPEC.md for P31`** — D41's edits, and this plan if it is not already committed.

---

## 5. Tests

`tests/db/` is untouched: no adapter behaviour, SQL, protocol or engine change exists in this phase
apart from item 1's `caps` literal, which `tests/db/*.spec.ts` does not assert on. Per AGENTS.md,
only `smoke`, `startup`, `workbench` and `connections` can run without Docker — everything else must
be run in the macOS/Colima environment or CI before this phase is called done.

### Per item

| Item | Spec | Scenario |
|---|---|---|
| 1 | `tests/ui/kafka.spec.ts`, `sqs.spec.ts` | Open a topic's / a queue's / a consumer group's definition tab; assert the Partitions/Configuration/Attributes sections render **and** that the operations panel gains **no** row with `status="error"` and no row of kind `describe` for that tab. Refresh the tab and assert the same again (the failure used to re-fire every time, F4). |
| 1 | `tests/ui/definition.spec.ts` | Unchanged, re-run green: Postgres/MariaDB/Mongo definition tabs still show Columns/Indexes/Constraints from `describe()` — D2 must not have gated a describe that was working. |
| 2 | `tests/ui/tabs.spec.ts` | With ~12 tabs open in a 900px-wide window: assert the strip's computed `overflow-x` is not `hidden`, that `scrollWidth > clientWidth`, that `mouse.wheel(0, 300)` over the strip increases `scrollLeft`, and that activating the first tab again scrolls it back into view. |
| 3 | `tests/ui/workbench.spec.ts` (no Docker) | Set the family to `Georgia, serif`: assert `--kira-font-family` and `getComputedStyle(document.body).fontFamily` follow, and that it survives a relaunch. Then type a family that cannot resolve: assert the field carries `is-invalid` and the helper line names the fallback, and that the value is still saved. Extend the existing font-size test rather than adding a file. |
| 3 | `tests/ui/data-view.spec.ts` | Open a table, record a column's width, change the font family to a much wider one, assert the width changes (D11's re-measure) — the assertion that fails against today's memoized canvas. |
| 4 | `tests/ui/workbench.spec.ts` (no Docker) | Assert the shell's computed `padding-top`/`-left`/`-right` are `6px` and `padding-bottom` is `2px`, and that the project panel's bounding box starts at least 6px from the window's left edge. |
| 5 | `tests/ui/kafka.spec.ts` | Open the since-field's calendar, page a month, pick a day: assert the field holds a parseable ISO-8601 string, that applying it issues exactly one read, and that `input[type="datetime-local"]` has zero matches anywhere (P24's guarantee, extended to this surface). Then type `not a date` and apply: assert the field is `is-invalid`, the message names the problem, and **no** read op was issued (F17). |
| 6 | `tests/ui/kafka.spec.ts`, `sqs.spec.ts` | Search for a string present in a subset of messages: assert matched rows carry `.search-match` with the shared tint; toggle `stream-search-filter-rows`; assert the row count drops to the matched set, the gutter numbers stay non-contiguous and true, the count is unchanged, and prev/next still cycle everything. Toggle off, assert every row returns. |
| 6 | `tests/ui/mongo.spec.ts` | Same sequence for documents, plus: assert the matched substring inside a collapsed preview line is wrapped in `<mark>`, and that a query matching nothing shows `No matching rows` with a working *Show all rows* button. |
| 6 | `tests/ui/redis.spec.ts` | The key/value toggle (D17), abbreviated: filter on, row count drops; filter off, restored. |
| 6 | `tests/ui/data-view.spec.ts` | Unchanged, re-run green — D16's hoist must not change the grid's own behaviour or testids. |
| 7 | `tests/ui/data-view.spec.ts` | Search on page 1 with a known hit count; press Next page; assert the scope label's "loaded rows" number updates (F24), the match count is recomputed for the new page, no cell on screen carries `.search-match` for a value that does not match, and the op-log grew by exactly the one read the pager issued. Repeat with the filter toggle on: the visible row set must be the new page's matches, not the old page's indices. |
| 7 | `tests/ui/mongo.spec.ts`, `kafka.spec.ts` | The same page-changes-under-search assertion for a Fetch-more/poll (stream) and a page change (documents). |
| 8 | `tests/ui/tooltips.spec.ts` | Hover a tree row's twisty for longer than the 400ms open delay: assert no `app-tooltip` appears, and that the button still exposes an accessible name (`aria-label`). |
| 9 | `tests/ui/connections.spec.ts` (no Docker) | Assert `[data-testid="color-none"]` renders the slash marker (a non-empty `background-image`) and is distinguishable from `color-grey`; screenshot the dialog into `test-results/screenshots/`. |
| 10 | `tests/ui/definition.spec.ts` | For a Postgres table's Columns section, assert **every** row has an info icon with a non-empty `data-kira-tip` — including `int4`, `text` and `bool` rows, which have none today. |
| 10 | `tests/ui/data-view.spec.ts` | Assert a grid header's `data-kira-tip` contains the column name, its data type and the type's description. |
| 11 | `tests/ui/data-view.spec.ts` | Open the filter history menu; assert a recent entry's `data-kira-tip` equals the full `WHERE … / ORDER BY …` summary (longer than the rendered, ellipsised text). |
| 11 | `tests/ui/console.spec.ts` | The same for a saved console query's entry. |
| 12 | `tests/ui/mutations.spec.ts` | Stage a delete: assert the row's gutter cell carries `deleted` and **not** `dirty`, and that its rail colour differs from an edited row's. Select a **cell** in another row, press Delete, assert that row is now staged for deletion (fails today, F31). Right-click a cell, assert the menu has `delete-row`, click it, assert the same. |
| 13 | `tests/ui/data-view.spec.ts` | Click a header to sort: assert the cell carries `data-sort="asc"`, that a codicon indicator is present, and that the header's text content contains **no** `▲`/`▼`. |
| 14 | `tests/ui/console.spec.ts` (or `autocomplete.spec.ts`, wherever the console completion block lives) | Type a prefix that opens the popup; press ArrowDown twice; assert the `[aria-selected="true"]` option moved from the first to the third entry; press Tab and assert the third option's text was inserted. Assert Enter still inserts a newline while the popup is open (P18 D18's guarantee, which D36 must not disturb). |
| 15 | `tests/ui/data-view.spec.ts` | Apply a projection: assert the Columns button has the indicator dot, that its text content contains no `/`, and that its `data-kira-tip` carries `N / M`. |
| 15 | `tests/ui/mongo.spec.ts` | The same for the fields button. |
| 16 | `tests/ui/mutations.spec.ts` | With two or more pending changes staged, assert the preview text matches `/;\n\s*\n/` — i.e. a blank line between statements. |

### Existing specs that must change

| Spec | Why | Change |
|---|---|---|
| `tests/ui/*.spec.ts` (six files using `[data-testid="tab-strip"]`) | D6 renames the CSS class only. | **None** — the testid is deliberately preserved. Verify, do not assume. |
| `tests/ui/data-view.spec.ts`'s search block | D16 moves the toggle's state module. | No assertion changes; `search-filter-rows` and every P24 scenario stay verbatim. This is the regression guard for the hoist. |
| `tests/ui/budgets.spec.ts` | D11 adds a dependency to the grid's `widths`, D34 changes header markup, D31 adds one class. | **No source change**, but re-run and shown green rather than assumed — the appearance counter only changes when appearance changes, so the scroll budget is unchanged by construction. |
| `tests/ui/tooltips.spec.ts` | D25 removes one tooltip; D27 adds three. | The disabled-control, delay, popover and `pointer-events` scenarios are untouched; the twisty assertion is added per the table above. |

---

## 6. Explicitly out of scope

- **Consolidating the four search toolbars into one component.** P24 §6 considered and rejected it
  for reasons that still hold (three different match shapes, four different page stores); D16 shares
  the one piece that genuinely is identical — the toggle's state — and nothing else.
- **Bringing `StreamSearchToolbar.vue` up to case/word/regex parity** (P24 F5). Item 6 asks for the
  filter and the highlight; a matcher-options upgrade is a feature, and it would change what a Kafka
  search *finds*, which nothing here should do silently.
- **Highlighting inside an expanded Mongo document's body, or inside a stream message body.**
  `docSearch`/`streamSearch` scan the preview line and a concatenated haystack respectively; marking
  offsets inside a CodeMirror-rendered body is a different feature with its own scanner.
- **`.p-input.ui`'s hard-coded UI font stack** (F14). It diverges from SPEC §8.2's "one font family
  for the whole app", but it is four fields and a deliberate-looking choice; changing it is a design
  decision, not a bug fix, and it is not what the user reported. §9 asks about it.
- **A font *picker* enumerating installed families.** `queryLocalFonts()` exists in this Chromium but
  needs a permission handler in main and a user gesture; D9's availability check gives the honest
  feedback that was missing without adding a permission surface. §9 asks whether the picker is wanted.
- **Overflow chevron buttons on the tab strip** (D7), tab drag-reordering, or tab overflow menus.
- **Raising `--kira-gap`, changing any splitter width, or any other layout measurement** beyond D8's
  new outer inset.
- **Changing what clicking a header does** (D35), the `WHERE`/`ORDER BY` toolbar, `filter_history`,
  or `saved_queries`.
- **Kafka message-timestamp editing** (D15) — a produced message's timestamp is not editable, and the
  read-only translate pane already renders it.
- **Any Mongo/Redis/S3 mutation, any new adapter capability beyond D2's `describe` flag, any
  migration, any change to a persisted tab's `state_json` shape.**
- **`docs/design/kira-design-system/`** — the mockups are compared against, never edited.

---

## 7. Target tree at the end of P31

```
src/
  shared/
    caps.ts                          MOD  Caps.describe + capsSchema (D2)
  engine/adapters/
    postgres/caps.ts mariadb/caps.ts mongo/caps.ts       MOD  describe: true (D2)
    kafka/caps.ts sqs/caps.ts redis/caps.ts s3/caps.ts   MOD  describe: false (D2)
    kafka/index.ts sqs/index.ts redis/index.ts s3/index.ts  MOD  corrected comment only (D3)
  renderer/
    fonts.ts                         NEW  fontStackAvailable (D9)
    state/settings.ts                MOD  resetMeasureCtx + appearanceVersion (D11)
    theme/
      tokens.css                     MOD  --kira-window-inset (D8)
      primitives.css                 MOD  .p-iconbtn.has-indicator (D38)
      primitives/IconButton.vue      MOD  `indicator` prop (D38)
    workbench/
      WorkbenchShell.vue             MOD  .tab-strip-slot rename (D6); window inset (D8)
      SettingsDialog.vue             MOD  availability check + preview line (D9/D10)
      panels/TabStrip.vue            MOD  wheel-to-horizontal, thin scrollbar (D7)
    editor/CodeMirrorHost.vue        MOD  Prec.highest around the completion keymap (D36)
    project/
      TreeRow.vue                    MOD  twisty tooltip removed (D25)
      ColorPicker.vue                MOD  no-colour slash swatch (D26)
      typeGlossary.ts                MOD  every type described; qualifier normalisation (D28)
    views/
      shared/
        searchFilter.ts              NEW  shared toggle state + matchedRowsOf (D16)
        DateTimePicker.vue           MOVED from views/celleditor/ (D12)
        FilterHistoryMenu.vue        MOD  full-text tooltip per entry (D27)
        SavedListMenu.vue             --  UNCHANGED (D27)
      celleditor/
        TimestampPane.vue            MOD  import path only (D12)
      grid/
        search.ts                    MOD  delegates to views/shared/searchFilter (D16)
        SearchToolbar.vue            MOD  pageVersion dependency + re-scan (D22/D23)
        DataGrid.vue                 MOD  deleted gutter rail (D31); Delete from a cell/range
                                          selection (D32); icon sort indicator (D34); header tip
                                          with the type description (D29); widths re-measure (D11)
        DataToolbar.vue              MOD  Columns indicator + :active (D38)
        gridMenu.ts                  MOD  cellMenu gains Delete row (D33)
        columns.ts                   MOD  resetMeasureCtx (D11)
        PreviewCommandPanel.vue      MOD  blank line between statements (D40)
      definition/
        state.ts                     MOD  describe gated on caps.describe (D4)
        ColumnsSection.vue            --  UNCHANGED (D30)
      documents/
        DocumentView.vue             MOD  filter, row highlight, <mark>, empty state (D19/D20);
                                          fields-button indicator (D38)
        DocumentSearchToolbar.vue    MOD  toggle (D17); page dependency + re-scan (D22)
      stream/
        StreamView.vue               MOD  filter + highlight restyle (D19/D21); calendar trigger
                                          and invalid-timestamp reporting (D13/D14)
        StreamSearchToolbar.vue      MOD  toggle (D17); page dependency + re-scan (D22)
        StreamFilterHistoryMenu.vue  MOD  full-text tooltip (D27)
        state.ts                     MOD  NaN timestamp guard (D14)
      keyvalue/
        KeyValueView.vue             MOD  filter + empty state (D17/D19)
        KeyValueSearchToolbar.vue    MOD  toggle (D17); page dependency + re-scan (D22)
      console/
        ConsoleSavedMenu.vue         MOD  full-text tooltip (D27)
tests/ui/
  workbench.spec.ts connections.spec.ts                    MOD  items 3, 4, 9 (Docker-free)
  tabs.spec.ts data-view.spec.ts mutations.spec.ts         MOD  items 2, 3, 6, 7, 10-13, 15, 16
  definition.spec.ts kafka.spec.ts sqs.spec.ts             MOD  items 1, 5, 6, 7, 10
  mongo.spec.ts redis.spec.ts console.spec.ts              MOD  items 6, 7, 11, 14, 15
  tooltips.spec.ts                                         MOD  item 8
  budgets.spec.ts                                           --  UNCHANGED (re-run, §5)
docs/
  v1/SPEC.md                                               MOD  D41's sections; §10 row on landing
  v1/plans/P31-polish-bugfix-batch.md                      NEW  this document
```

---

## 8. Acceptance checklist

- [ ] **(1)** Opening or refreshing a Kafka topic, consumer group or SQS queue definition tab
      produces **no** `describe` op and **no** error row in the operations panel or the log, while
      the Partitions/Configuration/Group/Members/Offsets/Attributes sections render exactly as
      before. Postgres/MariaDB/Mongo definition tabs still show Columns/Indexes/Constraints.
- [ ] **(1)** The plan and the commit message both record the verdict: the data is live adapter
      output (`fetchTopicMetadata`/`describeConfigs`/`describeGroups`/`fetchOffsets`/
      `GetQueueAttributes`), never mocked.
- [ ] **(2)** With more tabs open than fit, the strip scrolls by wheel and by trackpad, shows a thin
      scrollbar while scrolling, and still auto-scrolls the newly active tab into view.
- [ ] **(3)** Choosing an installed font changes the whole app — including already-open grids, whose
      column widths re-measure — and survives a relaunch. Typing a family that is not installed marks
      the field invalid and names the fallback instead of silently doing nothing.
- [ ] **(4)** There is a 6px gap between the window's left, right and top edges and the panels, the
      splitters are no thicker than before, and the status bar still sits on the bottom edge.
- [ ] **(5)** Kafka's since-timestamp field opens the app-owned calendar, writes a valid ISO-8601
      value, and reports an unparseable entry instead of quietly browsing from the beginning. No
      `<input type="datetime-local">` exists anywhere in `src/renderer`.
- [ ] **(6)** Kafka, SQS, Mongo **and** Redis find widgets highlight their matches in the app's one
      match style and can hide every non-matching row, with real row numbers, a *No matching rows*
      state with a way back, and zero operations logged.
- [ ] **(7)** Paging, fetching more, changing the page size, refreshing or re-running a filter while
      a search is open recomputes the match count, the highlights and the "in the N loaded rows"
      label against the new page — in all four views — and never highlights a stale row.
- [ ] **(8)** The connections panel's expand/collapse control shows no tooltip and keeps its
      accessible name.
- [ ] **(9)** The "no colour" swatch is unmistakably "none", not a thirteenth dark colour.
- [ ] **(10)** Every column type in the definition view's Columns section and every grid header's
      hover text explains what the type is.
- [ ] **(11)** Hovering a saved or recent filter (and a saved console query) shows its full text,
      wrapped, not the truncated line.
- [ ] **(12)** A pending-delete row shows a red left rail beside the yellow-edited and green-added
      ones; `Delete`/`⌘⌫` stages a delete from a cell or range selection as well as a row selection;
      the cell right-click menu offers *Delete row* with its key printed.
- [ ] **(13)** A sorted column shows an icon indicator at the header's right edge and no `▲`/`▼`
      character anywhere in its label.
- [ ] **(14)** ArrowUp/ArrowDown (and PageUp/PageDown) move through the query console's completion
      list in every console kind; Tab still accepts; Enter still inserts a newline.
- [ ] **(15)** The Columns button (and Mongo's fields button) shows a dot when a projection or a
      custom order is active, with no text overlapping the icon, and looks pressed while its menu is
      open; the counts are in the tooltip.
- [ ] **(16)** The SQL preview separates every statement with a blank line.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db) and `bun run build` clean after every
      commit; `xvfb-run -a bun run test:ui` green for the four container-free specs here, and the
      full suite green in the macOS/Colima environment before the phase is called done.

---

## 9. Open questions for the user

1. **Item 13 — is the multi-sort order badge wanted at all?** D34 keeps the `1`/`2` number beside the
   new icon (it only appears with two or more sort terms, which today only the ORDER BY box can
   produce). If "remove that from headers label" meant the number as well as the glyph, it is a
   one-line deletion — but then a two-key sort shows two identical chevrons with no way to tell which
   is primary, so the plan keeps it.
2. **Item 3 — should the app offer a list of installed fonts instead of a text field?**
   `queryLocalFonts()` is available in this Chromium and would turn the field into a real picker, at
   the cost of a `local-fonts` permission handler in main and a user gesture. D9 deliberately does the
   smaller thing (tell the truth about what you typed). Say the word and it becomes a D.
3. **Item 3 — should `.p-input.ui`'s four fields follow the font setting too?** SPEC §8.2 promises one
   font "for the whole app", and the command palette, tree search box and two connection-dialog fields
   deliberately opt out into the system UI stack (F14). Either the spec sentence or those four fields
   is wrong; §6 leaves them alone rather than guessing which.
4. **Item 6 — should the filter toggle survive closing and reopening the find widget?** P24's own D7
   turns it off on close (a closed toolbar must never leave rows hidden) and P24 §9 flagged this as
   the one genuine preference in that phase. The three new toolbars inherit whatever the grid does, so
   this is now one answer for four views rather than one.
5. **Item 12 — should `Delete` with a *range* selection delete every row the range touches, or only
   the anchor row?** D32 says every row in the range, matching how Copy already treats a range; the
   conservative alternative is to require an explicit row selection for multi-row deletes.
