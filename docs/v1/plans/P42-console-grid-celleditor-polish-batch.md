# P42 — Console, grid and cell-editor polish batch (twenty-two items)

> **A single-pass phase.** One Opus plan, one Sonnet implementation pass — the shape of P40 and
> P41, not P39's iterations. The branch tip when this plan was written is `2948b83` on
> `feature/kickoff`; `git status --porcelain` over the repo is empty apart from this file.
>
> **Not a SPEC §10 deliverable in spirit** — P42 is user-directed, reported against shipped work,
> and batched exactly the way **P31** batched its own sixteen post-P24 fixes and **P16** its own
> post-P15 ones. SPEC.md:993 already carries the row. The twenty-two asks, grouped by area:
>
> **Query console** — (1) the P40 new-result-vs-reuse toggle defaults flipped so a run opens a
> **new** result tab; (2) the result-tab strip restyled closer to `TabStrip.vue`'s own chrome while
> staying smaller; (3) a right-click menu on a result tab — Close · Close others · Close to the
> right.
> **Mongo console** — (4) a Mongo statement's result renders like the Mongo document view, but
> read-only; (5) JSON/argument validation in the Mongo console's own editor (*"I want to know my
> json is broken"*).
> **Code editors** — (6) word wrap *"like code editors have."*
> **Grid selection and chrome** — (7) click-and-drag across cells extends the selection; (8) the
> top-left corner cell selects the whole grid; (9) the column-header tooltip needs real visual
> hierarchy; (10) two adjacent selected cells draw a doubled border where they touch; (11) the
> grid's bottom-right corner renders white in every theme.
> **Cell editor's format picker** — (12) drop UUID and URL, which do nothing when picked;
> (13) rename the ISO format to **"Time (ISO…)"**; (14) every remaining format validates for real
> and says so when it fails; (15) reorder common-first; (16) hovering a format explains it, from
> one shared source; (17) *"Generate UUID"* becomes a small generators panel; (18) the byte size is
> shown twice and should be shown once.
> **Date/time picker** — (19) an easier month/year jump than prev/next arrows; (20) a numeric
> stepper's controls render outside their own button box.
> **Connection colours** — (21) the palette's hues sit too close together; trim it.
> **Find/search performance** — (22) in-page find scans the whole loaded dataset before showing
> anything; highlight the viewport first.
>
> **Three of the twenty-two do not say what the user thinks they say, and this plan says so rather
> than manufacturing the reported fix.**
>
> - **Item 6's premise is contradicted by the code.** `EditorView.lineWrapping` is already in
>   `CodeMirrorHost.vue`'s *unconditional* base extension array (`:156`), so **every** CodeMirror
>   surface in the app already wraps — query console, Mongo console, cell editor, definition
>   viewer, op-log detail, preview panel. Nothing is missing; what is missing is any way to turn it
>   *off*. §3's D14 says what is built instead and why.
> - **Item 4's diagnosis is off by one layer.** A Mongo console result is *not* rendered by the
>   tabular grid — `ConsoleResultGrid.vue:275-298` already has its own `page.kind === 'document'`
>   branch. That branch is just crude: a raw `<pre>` blob at a fixed 96 px, no `_id` label, no field
>   count, no expand/collapse, no BSON colouring. The ask is real; the fix is an upgrade of an
>   existing branch, not a re-route of a tabular one.
> - **Item 12's "just delete them" has a trap.** Deleting `detectUuid` alone makes a dashed UUID
>   detect as **base64** (36 chars, `%4 === 0`, matches `BASE64_URL_RE`, `atob`-decodable) and open
>   a decoded-text pane full of garbage. F19 shows the arithmetic; D24 keeps a one-line guard.
>
> **Two items carry a real correctness risk that is handled, not hand-waved:** item 21's palette
> trim would *delete already-saved connections* if done the obvious way (F27/D34), and item 1's
> default flip changes what a restored tab does — but not symmetrically (F1/D5).

---

## 0. Ground rules for this phase

- **Every finding carries a `file:line` read at `2948b83`.** Where a claim depends on library or
  browser semantics rather than this repo's code, the mechanism is spelled out (F16 quotes
  `@vscode/codicons/dist/codicon.css`; F17 names Chromium's own `::-webkit-scrollbar-corner`
  default).
- **Behavior changes are declared, not discovered.** Fourteen of the twenty-two items change
  behavior by construction. The discipline that replaces "zero behavior change" is P40's and
  P41's: §3 names each one, §4 puts the spec edit it invalidates **in the same commit**, and §7 is
  the phase's own acceptance test.
- **Where the code contradicts the report, the plan says so and stops** rather than inventing a
  bug to fix (item 6, item 4's routing, item 12's supposed simplicity). AGENTS.md's multi-pass note
  is explicit that a pass should "say plainly when a pass turns up nothing real"; the same applies
  to a single item inside a pass.
- **P39's layering rules stand** (`biome.json:60-208`, re-read in full). Two of this phase's items
  are blocked by them and are solved by moving a module into `views/shared/`, exactly as P31 D12
  moved `DateTimePicker.vue`: `views/console/*` may not import `views/documents/*`
  (`biome.json`'s second pattern group), which is what forces D8's move. Every other import this
  phase adds is `views/* → views/shared/*`, `views/* → state/*`, `views/* → theme/*`,
  `views/* → <renderer root>`, or `workbench/* → <renderer root>`. No override is weakened.
- **No new dependency, no new build step, no protocol change, no migration.** Two Zod fields, both
  with `.default()` (F1, F13). Nothing under `src/engine/`, `src/main/` or `src/shared/protocol/`
  is touched.
- **`data-testid`s are added, never removed** — with three deliberate exceptions, all named in
  §4 and all with their spec edits in the same commit: `cell-editor-uuid-generate` becomes
  `cell-editor-generate` (D29), `cell-editor-byte-badge` disappears from the *cell editor's* mount
  only (D31, the document view keeps its own), and `cell-editor-format` moves from a `<select>` to
  a `<button>` trigger (D27).
- Comments per AGENTS.md: only where the code cannot say it for itself. Five existing comments
  become false and are rewritten in the same commits that falsify them
  (`CellEditorView.vue:148-153`, `:347-351`, `ConsoleResultGrid.vue:155-159`,
  `shared/domain/tabs.ts:55-60`, `connColor.ts:1-6`).
- `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` stay green
  after **every** commit. Conventional Commits, one per step of §4.

---

## 1. Findings

### A. The query console (items 1–3)

**F1 — the flip is one Zod default plus one literal, and it is not symmetric with "off".**
`shared/domain/tabs.ts:61-64` is `z.object({ text: z.string(), newResultSet: z.boolean().default(false) })`,
and `defaultConsoleTabState()` (`:214-216`) returns `{ text: '', newResultSet: false }`.
`views/console/state.ts:131` is the only consumer: `if (!tab.state.newResultSet) dropResults(tabId)`.
A `.default()` only fires for an **absent** key, so flipping it to `true` means: a console tab saved
*before* P40 (no key at all) restores with the new default **on**, while a tab saved *after* P40
with the toggle explicitly off restores **off** — the stored `false` still wins. That is the correct
behaviour and it is worth stating, because "the default flipped" and "every existing tab flipped"
are different claims and only the first is true.

**F2 — the result strip already uses the same primitive class as the main tab strip; what it lacks
is the strip's own chrome around it.** `ConsoleView.vue:290-313` renders `.result-strip.p-toolbar`
holding one `<button class="p-tab" :class="{'is-active': …}">` per result, with a nested
`.result-close` span. `TabStrip.vue:144-186` renders the same `.p-tab` chips inside its own
`.tab-strip`. Read side by side, the console strip is missing five things the main strip has, and
carries one geometry difference:

| | `TabStrip.vue` | `ConsoleView.vue`'s result strip |
|---|---|---|
| hover | `.p-tab:hover:not(.is-active) { background: var(--kira-hover) }` (`:209-211`) | none |
| close button | `opacity: 0`, revealed on `:hover`/`.is-active` (`:224-238`) | always visible (`:385-394`) |
| leading icon | `iconFor(tab)` codicon (`:169`) | none |
| middle-click closes | `@auxclick.middle` (`:165`) | none |
| overflow | `overflow-x: auto` + `scrollbar-width: none` + `onWheel` deltaY→scrollLeft (`:136-141`, `:189-204`) | none — a `.p-toolbar` clips |
| band height | 34 px slot, chips at `--kira-h-md` (26 px) | 28 px `.p-toolbar`, chips at `--kira-h-md` (26 px) — chips are already the same size as the app's primary tabs |

So "make it look like the tab strip but smaller" resolves into: adopt the five behaviours, and take
the chips *down* a step (`--kira-h-sm`, `--kira-t-xs`), which is the only way the strip reads as
secondary at all. Overflow stops being optional the moment item 1 lands: with new-result-by-default
a working session accumulates chips.

**F3 — the wheel-to-horizontal handler would become a second copy.** `TabStrip.vue:136-141` is
eight lines the console strip needs verbatim. `views/console/` may not import `workbench/`
(`biome.json`'s first pattern group). `src/renderer/format.ts`, `clipboard.ts` and `fonts.ts` are
the established precedent (P24 D35) for a small renderer-root utility both layers may import.

**F4 — the app has exactly one right-click mechanism, and it is already reachable from
`views/console/`.** `state/contextMenu.ts:30-35`'s `openContextMenu(ev, items)` takes a plain
`MouseEvent`; `ConsoleSavedMenu.vue` and `views/console/` already import from `state/`. The three
labels the user asks for are `TabStrip.vue:59-83`'s own first three items verbatim (`close`,
`close-others`, `close-to-the-right`), backed by `state/tabs.ts`'s `closeTab`/`closeOthers`/
`closeToTheRight`. `views/console/state.ts` has `closeResult` (`:68-78`) and needs the other two.
`MenuItem` (`contextMenu.ts:4-21`) has no tooltip field — relevant to item 16, not here (F25).

### B. The Mongo console result and its editor (items 4–5)

**F5 — the console's document result is a separate, cruder branch, not the tabular grid.**
`ConsoleResultGrid.vue:275-298`: a `VirtualList` at a hard-coded `:row-height="96"` whose row is
`<div class="doc-id">{{ id }}</div>` plus `<pre class="doc-body-text">{{ body }}</pre>`
(`:294-295`, styled `:426-452`). It has no expand/collapse, no per-node indenting, no BSON type
colouring, no field count, no byte badge, and a document taller than 96 px is simply cut off with
no scroll of its own. `DocumentView.vue:694-812` — the Mongo *data* tab — renders the same content
as a head row (`_id` label, `N fields`, byte badge, truncated chip) plus, when expanded,
`DocumentTree.vue`'s flat indented line list at a computed exact row height. That is what the user
is comparing against.

**F6 — the pieces that would have to move, and the one dependency that blocks a pure move.**
`views/documents/DocumentTree.vue` (129 lines) imports only `theme/CodiconIcon.vue` and
`./documentRows`. `documentRows.ts` (179 lines) imports `./ejson` and — the blocker —
`documentRow` from `./page` (`documentRows.ts:9`, used at `:61`, `:78`, `:170`).
`ejson.ts` imports nothing from `views/`. Everything else in `documentRows.ts` is already
caller-parameterised on purpose: `rowHeight(tabId, row, editingId, isExpanded, hasSearchPreview)`
(`:163-178`) takes the expansion flag from the caller precisely so it need not import `state.ts`,
and its own comment (`:157-161`) says why.

**F7 — the two `documentRow` accessors already agree on shape.**
`views/documents/page.ts`'s returns `{ id, body, isTruncated }`; `views/console/resultPages.ts:103-110`'s
returns `{ id, body }` keyed by a *result* key rather than a tab id. One optional field apart, they
are the same function — which is what makes a registered row source (D9) a fifteen-line change
rather than a rewrite.

**F8 — `views/console/` may not import `views/documents/`.** `biome.json:73-90` forbids
`../documents/**` and `../../documents/**` from anything under `src/renderer/views/**` with the
message *"views/&lt;kind&gt;/\* must not import another views/&lt;kind&gt;/\* — use views/shared/
instead."* This is the same wall P31 D12 hit with `DateTimePicker.vue` and answered the same way.

**F9 — the Mongo console linter checks brackets, quotes and the statement shape, and never looks
inside the argument.** `views/console/lint.ts:80-109`: `lintMongoBrackets` (`:17-74`) balances
`()[]{}` and reports unterminated strings; `MONGO_STATEMENT_RE` (`:14`) checks
`db.<collection>.<method>(`; `MONGO_CONSOLE_METHODS` checks the method name. Nothing parses the
argument. `db.users.find({ a: 1, })`, `db.users.find({"a" 1})` and `db.users.find({a:})` all pass
every check the linter makes and fail only at the adapter, as a round-trip error. That is exactly
the *"I want to know my json is broken"* gap.

**F10 — the parser that would answer it already exists in the renderer, and it already reports an
offset.** `views/documents/ejson.ts:518-531`'s `tryParseShellText(text)` returns
`{ ok: true; node } | { ok: false; offset }`, built on `parseShellObject`/`parseShellArray`/
`parseShellCall` (`:396-517`) — a Mongo **shell literal** parser, so it accepts unquoted keys,
single quotes and `ObjectId(…)`/`ISODate(…)` constructor calls, which plain `JSON.parse` would
reject on valid input. It is currently module-private and unexported. After D8's move it is one
export away from `lint.ts`.

### C. Code editors (item 6)

**F11 — wrap is already on, everywhere, unconditionally, and there is no way to turn it off.**
`CodeMirrorHost.vue:150-174` builds one `EditorState` whose base array (not a `Compartment`)
contains `EditorView.lineWrapping` at `:156`. Every editable and read-only surface mounts through
this one component — `grep -rn "CodeMirrorHost" src/renderer --include=*.vue` returns
`OperationsPanel.vue:242,250`, `CellEditorView.vue:391,408`, `DefinitionView.vue:223`,
`PreviewCommandPanel.vue:74`, `DocumentView.vue:661,791,811`, `ConsoleView.vue:271` — so all of
them wrap. There are four `Compartment`s (`language`, `readOnly`, `autocomplete`, `lint`,
`:62-65`); wrapping is not one of them. **The reported gap does not exist.** What does not exist is
the toggle: nothing in `settingsState.appearance` (`shared/domain/settings.ts:6-10`:
`fontFamily`, `fontSize`, `rowDensity`) mentions wrapping, and no host prop offers it.

**F11a — the one surface in this phase's neighbourhood that genuinely does not wrap is not a
CodeMirror surface at all.** `DocumentTree.vue:72-79`: `.tree-line { white-space: nowrap }` with
`.tree-value { overflow: hidden; text-overflow: ellipsis }` (`:105-108`) — a long string value in
an expanded Mongo document is truncated with no wrap **and** no horizontal scroll, i.e.
unreadable in place. Recorded because item 4 puts this component in the console too, and because
it is the most plausible thing the user actually saw. It is **not** fixed here (§6): the row's
pixel height is computed line-by-line by `rowHeight()` (F6), so wrapping a line silently breaks
the virtualiser's geometry. It goes to P43 with the arithmetic spelled out.

### D. Grid selection and chrome (items 7–11)

**F12 — there is no pointer-drag path in the grid at all; the only two ways to build a range are
click and shift-click.** `DataGrid.vue:643-662`'s `onCellClick` is the whole cell-selection story:
shift + an existing `cell`/`range` selection extends to a `range`, anything else replaces with a
`cell`. `grep -n "mousedown\|mousemove\|mouseup" src/renderer/views/grid/DataGrid.vue` returns
**nothing** — the only pointer handlers on the grid are `@pointerdown/@pointermove/@pointerup` on
`.resize-handle` (`:1291-1296`, column resizing) and `@click`/`@dblclick`/`@contextmenu` on cells
(`:1342-1344`). `.grid-cell` is already `user-select: none` (`:1633`, D1's own comment), so a drag
gesture has no native text selection to fight.

**F13 — the range primitives a drag needs are already there and are O(1) per cell.**
`isSelected` (`:462-474`) resolves a `range` by two sorted comparisons; `copySelection`
(`:1023-1039`) already reads `sel.anchorRow`/`anchorCol` for a range; `renderRows` (`:840-887`)
builds each cell's flags exactly once per render. A drag therefore has to produce nothing new — it
writes the same `{ kind: 'range', anchorRow, anchorCol, row, col }` shift-click already writes.

**F14 — the corner cell is inert.** `DataGrid.vue:1248`:
`<div class="gutter-cell header-gutter" :style="{ width: … }" />` — no `@click`, no
`@contextmenu`, no `role`, no `data-testid`. Every other intersection in the grid has a select
gesture: the row gutter (`onGutterClick`, `:669-690`), the header's 10 px left strip
(`onHeaderSelectClick`, `:691-714`, `.header-select-zone` `:1514-1521`). The corner is the one that
was left out.

**F14a — a whole-grid selection must be a `range`, not a `row` selection, or it is a performance
trap.** `isSelected` resolves a `row` selection with `sel.rows.includes(row)` (`:471`) — O(rows)
per rendered cell per render. `{ kind: 'row', rows: [0…rowCount-1] }` on a 100 000-row page would
make every frame O(rows × visibleCells). A `range` spanning the whole page is O(1) per cell and is
what copy/paste (`:1023-1039`) and the cell menu already understand.

**F15 — the doubled border is `outline` doing exactly what `outline` does.**
`DataGrid.vue:1650-1656`:

```css
.grid-cell.selected {
  background: var(--kira-select);
  outline: var(--kira-border-width) solid var(--kira-focus);
  outline-offset: -1px;
}
```

Cells are `position: absolute` at `left: offsets[c]`, `width: offsets[c+1] - offsets[c]`
(`:1337-1341`), `box-sizing: border-box` — exactly adjacent, never overlapping. Each selected cell
therefore inks a **complete** 1 px ring inset by 1 px: cell A's right edge and cell B's left edge
are two different 1 px lines, one pixel apart, both in `--kira-focus`. Two adjacent selected cells
show 2 px of focus blue where they touch; a 3×3 selection shows it on four internal seams. The same
declaration is copied verbatim into `ConsoleResultGrid.vue:390-394` (its own comment says so), so
the console result grid has the identical defect wherever two cells could be selected at once —
today it never selects more than one (`selected` is a single `{row,col}` ref, `:94-98`), so it is
latent there, not visible.

**F16 — the stepper's chevrons overflow their own buttons by ~5 px, and the arithmetic is exact.**
`TextField.vue:72-93` renders two `.step-btn`s inside `.stepper`. `primitives.css:184-204`:
`.stepper` is `flex-direction: column; align-self: stretch; margin: 2px 0`, each `.step-btn` is
`flex: 1; width: 16px; line-height: 0`. `.p-input` is `height: var(--kira-h-sm)` = **22 px**
(`:128-140`) with a 1 px border, so the stepper's content box is 22 − 2 − 4 = **16 px**, i.e. each
button is **8 px** tall. The glyph inside is `<CodiconIcon :size="13">`, and
`node_modules/@vscode/codicons/dist/codicon.css:12-23` sets `.codicon[class*='codicon-']` to
`font: normal normal normal 16px/1 codicon; display: inline-block` — `line-height: 1`, so at the
13 px `font-size` `CodiconIcon.vue:9` writes inline the glyph box is **13 px** tall in an 8 px box,
centred, with **no `overflow: hidden` anywhere in the chain**. Each chevron spills ~2.5 px above and
below its button — into its sibling and out of the field. That is item 20, exactly as reported, and
it is in the shared primitive, not in `DateTimePicker.vue`.

**F16a — a second, smaller stepper defect in the same rule.** `.p-input` has
`padding: 0 var(--kira-s-3)` (6 px each side) and no `overflow`, so the stepper — the last flex
child — floats 6 px short of the field's inner right edge, leaving a dead gutter of input
background to its right and putting its `border-left` divider in the middle of the box rather than
at its edge. `.p-input.has-stepper input { padding-right: var(--kira-s-1) }` (`:181-183`) tightens
the *input*'s side of the gap and never the container's.

**F17 — the white corner is Chromium's unstyled `::-webkit-scrollbar-corner`.**
`base.css:72-86` styles `::-webkit-scrollbar` (12 × 12), `::-webkit-scrollbar-thumb`
(`var(--kira-scrollbar)`) and `::-webkit-scrollbar-track` (`transparent`) — and nothing else.
`grep -rn "scrollbar-corner\|::-webkit-resizer" src/renderer` returns **zero hits**. Chromium's own
default for `::-webkit-scrollbar-corner` is opaque **white**, which is why it survives every theme
(P38's Catppuccin variants included — they redefine tokens, and this square uses none).
`.data-grid` is `overflow: auto` (`:1419-1425`) over a `.grid-sizer` wider and taller than the
viewport, so the grid is the app's one surface that routinely shows both scrollbars at once and
therefore the one place the corner is visible. **The fix belongs in `base.css`, not in the grid** —
every scroll container in the app has the same square, the grid is just where it is noticed.

**F18 — the header tooltip is already multi-line; what it has no way to express is hierarchy.**
`DataGrid.vue:101-107`'s `headerTitleFor` returns `[name, dataType, description, comment]` joined
with `\n`, bound at `:1256` through `v-tooltip`. The whole tooltip pipeline is a **single string**:
`tooltip.ts:206-222`'s directive writes it into one attribute (`data-kira-tip`, `:18`) and mirrors
it into `aria-label`; `openFor` (`:67-76`) reads that attribute into `tooltipState.text`;
`AppTooltip.vue:58` renders `{{ tooltipState.text }}` in a box that is `white-space: pre-wrap`
(`:75`). So the newlines *do* render as separate lines — but all four lines are the same size,
weight and colour, and the glossary description (`typeGlossary.ts:273-290`, often two sentences)
wraps into as many more identical lines as it needs. Four indistinguishable lines is the "one
run-on paragraph" the user reports. `data-kira-tip` is also the Playwright handle (P22 D8), and
P31's own header assertion reads it — so the plain-text join has to survive any change.

### E. The cell editor's format picker (items 12–18)

**F19 — UUID and URL really are inert, and removing their detectors has a trap.** Traced through
every consumer of `CellFormat`:

| | `uuid` | `url` |
|---|---|---|
| `canBeautify` (`formats.ts:58-60`) | false | false |
| `FORMAT_LANGUAGE` (`:42-55`) | `plain` | `plain` |
| `describeValue` (`detect.ts:360-382`) | no branch → `null` | no branch → `null` |
| `showDecodedPane` / `isTimestampFormat` (`CellEditorView.vue:165-183`) | false | false |
| validation on override | none exists for any format (F21) | none |
| anything else | `canGenerateUuid` (`CellEditorView.vue:150`) — the **only** behaviour | **nothing** |

So picking `url` changes literally nothing but the label, and picking `uuid` changes nothing but
whether one button is enabled — a button item 17 replaces anyway. The user's reading is correct.
**But**: `detectUuid` (`detect.ts:146-151`) is load-bearing as a *guard*. A dashed v4 UUID is 36
characters, `36 % 4 === 0`, ≥ `BASE64_MIN_LENGTH` (20), matches `BASE64_URL_RE`
(`^[A-Za-z0-9_-]+={0,2}$`, `:176` — `-` is in the URL-safe alphabet), has `hasSpecial` true, and
`atob(base64ToStd(t, true))` succeeds. Today `detectUuid`'s score of 1.0/0.95 beats
`detectBase64`'s 0.85 and hides that. Delete the detector and every UUID column in the app starts
detecting as **base64** and opening a decoded-text pane of mojibake. `detectBase64` already carries
the idiom for exactly this class of overlap — `:193`, *"purely hex-shaped — let hex win the
overlap"*. `detectUrl` has no such trap: `:` and `.` are outside both base64 alphabets and outside
`HEX_RE`, a single line is never CSV (`:312`), so a URL falls through to `text` on its own.

**F20 — the picker's order comes from `CELL_FORMATS`, and that array's order is used nowhere that
matters.** `formats.ts:10-23` declares the tuple; `CellEditorView.vue:344` renders
`v-for="f in CELL_FORMATS"`. Its other two consumers are order-insensitive:
`ELIGIBLE_BY_TYPE_CLASS.text`/`.other` (`detect.ts:29-30`) use it as a *set*, and `detectFormat`
(`:343-357`) iterates it but then sorts by score and by a **separate** `PRECEDENCE` array
(`:34-47`). So reordering the picker is free — provided `PRECEDENCE` is left alone (it is the
tie-break, semantically most-specific-first) and provided it keeps an entry for every remaining
format, since `Array.indexOf` returns −1 for a missing one and −1 sorts *first*.

**F21 — nothing validates an overridden format; the only validity signal in the whole panel is a
detection score nobody renders as an error.** `detectJson` (`detect.ts:53-76`) already runs
`scanJson` and produces `reason: "looks like JSON, invalid at offset N"` at score 0.35 — and that
string is shown only as the `<select>`'s own tooltip via `detectedReason` (`CellEditorView.vue:62`,
bound at `:340`), never as an error, and only for the *detected* format. Override to `json` on a
broken payload and the panel says nothing at all; `beautifyFailure` (`useEditBuffer.ts:74-80`) only
appears if you press Beautify. The validators, though, all exist:
`scanJson`/`scanXml` (`beautify.ts:177`, `:455`), `parseTimestamp` (`timestamp.ts:124`),
`pickCsvShape` (`detect.ts:294-304`, module-private), `decodeToText` (`binary.ts:7`),
`lintSql` (`@shared/domain/sql-lint`, already imported by `views/console/lint.ts:3`).

**F22 — the format control is a native `<select>`, which is why item 16 cannot be done as asked
without replacing it.** `CellEditorView.vue:335-345` is
`<select class="p-select bordered format-select" data-testid="cell-editor-format">` with an
`<option>` per format. A native option list is drawn outside the DOM the app can hit-test:
`tooltip.ts:109-119` resolves its host with `document.elementFromPoint(...).closest('[data-kira-tip]')`,
which can never land on an `<option>` inside an open native popup. The native `title` attribute
*would* work there and is banned app-wide (P22). There is no third way: per-option hover text
requires an app-drawn list.

**F23 — replacing the `<select>` costs four spec lines, not eight.** `grep -n cell-editor-format
tests/ui/cell-editor.spec.ts` → eight hits. Five are `.focus()` (`:435`, `:628`, `:710`, `:734`,
`:750`) whose only purpose is *"blur by moving focus to the format select, still inside the panel
but outside the editor"* (`:434`'s own comment) — any focusable element in the panel serves, so a
`<button>` trigger keeps them working verbatim. The other three are the real edits:
`selectOption(…, 'text')` (`:317`, `:860`), `selectOption(…, 'auto')` (`:355`) and
`toBeDisabled()` (`:365`, the NULL case).

**F24 — the byte size really is printed twice, in the grid's panel, inches apart.**
`CellEditorView.vue:292-302`'s `statusLine` opens with
`formatBytes(statusEncoder.encode(value).length)` and renders at `:330-332` as
`data-testid="cell-editor-status"`. Two elements later, `EditBufferActions.vue:50-52` renders
`buffer.byteLabel` — `formatBytes(byteEncoder.encode(doc.value).length)`
(`useEditBuffer.ts:49`) — as `data-testid="cell-editor-byte-badge"`. Same buffer, same encoder,
same formatter, same header row. P40 D13 already flagged it (*"a duplicate of the status badge
inches away"*) and removed it only from *viewer* mode by hiding the whole `EditBufferActions` row
(`CellEditorView.vue:352-361`); in a data tab both are still on screen. **The duplicate belongs to
this mount, not to the component**: `DocumentView.vue:663` and `:793` mount `EditBufferActions`
with no status badge anywhere near them, so its byte badge is that surface's only byte figure and
must stay (`mongo.spec.ts:152` asserts it).

**F25 — the app's menu row has no hover-hint field.** `contextMenu.ts:4-21`'s `MenuItem` carries
`label`, `icon`, `swatch`, `danger`, `disabled`, `checked`, `shortcut` — no tooltip.
`ContextMenu.vue:84-107` renders the row with no `v-tooltip`. Relevant because D27 builds the new
format picker on the same menu.

**F26 — `crypto.randomUUID()` is the only generator in the app, and it is wired to a permanently
disabled button in half its mounts.** `CellEditorView.vue:150-161`:
`canGenerateUuid = effectiveFormat === 'uuid' && isEditable`, with a disabled tooltip reading
*"Available when the format is UUID."* — which P40 D13 already recorded as a **false statement** on
a console cell whose format is exactly UUID. `grep -rn "randomUUID" src/renderer` → this site plus
`views/console/state.ts:114` (an op id) and `views/grid/pendingChanges.ts` (insert-row ids); no
other generator exists anywhere.

### F. Connection colours (item 21)

**F27 — the stored value is a name, but it is parsed against a closed enum on every read, so
removing an entry deletes connections.** `main/storage/schema/connections.ts:7` is
`color: text('color').notNull()` — a plain string column, no FK, no index. But
`main/storage/repos/connections.ts:44` parses it with `connectionColorSchema`
(`shared/domain/connection.ts:36-52`), and `parseRow` (`:83-94`) **drops any row that fails**, with
only a `log('warn', …)`:

```ts
const result = connectionRowSchema.safeParse(row);
if (!result.success) { log('warn', …, `dropping unparseable connection row: …`); return null; }
```

`listConnections` (`:96-107`) then simply omits it. So narrowing the enum makes every saved
connection whose colour was removed **vanish from the project panel on next launch**, with the only
trace a warning in the log file. That is a data-loss-shaped bug, not a cosmetic one, and it is what
"trim the palette" means if done the obvious way. The picker itself is a *second*, independent
consumer: `ColorPicker.vue:8` (`connectionColorSchema.options`) and `project/menus.ts:195`
(the same, for the tree row's Color submenu).

**F28 — the palette is a perfectly even ring, which is the problem.** `tokens.css:79-93` documents
its own construction: *"softened to oklch(0.72 0.09 h): one lightness and one chroma for all eleven
hues plus a near-neutral grey."* Converting the twelve hexes back to OKLCH confirms it exactly —
every hue is L ≈ 0.719-0.721, C ≈ 0.089-0.091, and the eleven chromatic hues sit at 24.7°, 55.6°,
88.6°, 118.5°, 148.3°, 178.6°, 210.4°, 252.6°, 278.2°, 305.6°, 340.2°: adjacent gaps of **25.6°
(blue→indigo) to 44.5°**, mean 30.5°. At C = 0.09 a 30° hue step is an OKLab chroma-arc of
0.09 × 0.52 ≈ **0.047** — perceptible side by side in a 16 px swatch, and not perceptible at all in
the places the colour is actually *used*: a 2 px `.p-tab-rail` (`primitives.css:533-539`), a 5 px
`.p-conn-dot`, a 2 px `.p-toolbar-rail`. `grey` is a special case worth naming: its hue is 252.1°,
i.e. **the same hue as `blue`**, separated only by chroma (0.012 vs 0.091) — that separation is
larger than any of the hue steps, so grey is safe, but it means "blue" and "grey" are literally the
same hue family.

**F28a — with eleven near-equally-spaced hues, six is the largest subset that can beat 40°.** Six
chosen from eleven ring positions must include one adjacent pair by pigeonhole (six gaps summing to
eleven steps). Brute-forced over all subsets, the best achievable minimum gap is **44.5°**
(`red, amber, green, cyan, indigo, magenta`), with `red, amber, green, cyan, blue, magenta` at
**42.2°** — a 2.3° difference, i.e. none. Five gets 62.0° (`orange, olive, cyan, indigo, magenta`)
at the cost of dropping every familiar name. D35 picks the six.

### G. Find/search performance (item 22)

**F29 — no match is published until the entire loaded dataset has been scanned.**
`SearchToolbar.vue:62-95`: `runSearch` is started, `onProgress` is passed a callback that updates
**only** `foundSoFar` (`:80-82`, a `"N…"` counter), and the match list reaches the view exactly
once, in `handle.done.then` (`:90-94`):
`props.api.searchState[props.tabId] = { matches, index: … }`. Every consumer of highlighting reads
`searchState` — `DataGrid.vue`'s `isSearchMatch`, `ConsoleResultGrid.vue:102-115`'s `matchIndex`,
`DocumentView.vue`'s own — so **nothing on screen changes until the last row has been scanned.**
`runChunkedScan` (`scan.ts:54-88`) walks `CHUNK_ROWS = 2000` rows per `requestAnimationFrame`
strictly ascending from row 0, scanning **every column of every row**
(`grid/search.ts:33-40`: an inner `for col` loop with a `cellText` decode per non-null cell). On a
"fetch more"-grown page of 200 000 wide rows that is 100 frames minimum before the first highlight
appears — and if the user has scrolled to row 150 000, the rows they are looking at are scanned in
frame 75 of 100. The user's description is precise.

**F30 — the ascending order is a load-bearing contract, so a viewport-first scan cannot simply
start in the middle.** `searchFilter.ts:25-43`'s `matchedRowsOf` de-duplicates *in one pass with no
sort and no Set*, and its own comment states the reason: *"Every scanner emits matches in ascending
row order (the outer loop is always `row`)"*. `SearchToolbar.vue`'s prev/next also cycles the array
in index order (`:110-121`), so a wrap-around scan would make "next match" jump backwards through
the page. Any fix must leave the **final** array strictly ascending.

**F31 — the visible row window exists in the grid and can be had cheaply everywhere else.**
`DataGrid.vue:366-377` already computes `visiblePageRowBounds` (`{start, end}` over the rendered
rows, filtering-aware) and watches it. `theme/primitives/VirtualList.vue:75-96` computes
`startIndex`/`endIndex` internally and already emits one event (`scrollstate`, `:23`) — the three
`VirtualList`-based paged views (documents, key/value, console results) have no other way to know
their own window today. `stream/` is out of scope throughout: `stream/search.ts` is a different,
simpler scanner that `scan.ts:4-5` explicitly records as *not* built on the shared driver.

**F31a — `views/{grid,console}/page.ts`'s `setVisibleWindow` is the wrong hook to reuse for this,
and P43 owns it.** `grid/page.ts:43-57` prunes a decode cache; `console/resultPages.ts:74-82`
clears one; the console's has **no caller anywhere**, which P40 F22 recorded and
`docs/v1/plans/P43-functionality-review.md`'s own **F2** has already claimed as its finding. Those
are cache-lifetime concerns keyed by *page*, not search-priority concerns keyed by *tab*. D39
therefore adds a separate two-function registry rather than widening either — and §8 hands P43 the
observation that its F2 can now read that registry instead of adding a third reporting path.

---

## 2. Shapes introduced in this plan

```ts
// src/renderer/wheelScroll.ts — NEW, sibling of format.ts/clipboard.ts/fonts.ts (P24 D35's
// precedent for a small renderer-root utility both workbench/ and views/ may import; F3).
/** Translates a vertical wheel into horizontal scroll on an overflowing strip — a plain mouse
 *  produces no deltaX. A no-op when the element does not overflow, so it never fights page
 *  scroll. Returns true when it consumed the event (the caller preventDefaults on true). */
export function wheelToHorizontal(el: HTMLElement | null, e: WheelEvent): boolean;
```

```ts
// src/renderer/views/console/state.ts — two additions beside closeResult (F4).
export function closeOtherResults(tabId: string, key: string): void;
export function closeResultsToTheRight(tabId: string, key: string): void;
```

```ts
// src/renderer/views/shared/document/rows.ts — MOVED from views/documents/documentRows.ts,
// with one addition (D9). Everything else is unchanged, including rowHeight()'s caller-supplied
// isExpanded/hasSearchPreview flags.
/** Where this scope's rows come from. Registered by the view that owns the scope — the document
 *  tab registers documents/page.ts's documentRow, a console result set registers
 *  console/resultPages.ts's. `scope` is a tab id for the former and a result key for the latter;
 *  this module only ever uses it as a Map key. */
export function registerDocumentRows(
  scope: string,
  source: (row: number) => { id: string; body: string; isTruncated?: boolean } | null,
): void;
export function unregisterDocumentRows(scope: string): void;
```

```ts
// src/renderer/views/shared/document/ejson.ts — MOVED from views/documents/ejson.ts.
// One previously module-private function becomes exported (F10), unchanged in body:
/** Scans one Mongo shell literal — unquoted keys, single quotes, ObjectId(…)/ISODate(…) calls —
 *  and reports where it stops making sense. views/console/lint.ts's argument check (D12). */
export function scanShellText(text: string): { ok: true } | { ok: false; offset: number };
```

```ts
// src/renderer/workbench/state/tooltip.ts — the directive's value widens (D19).
/** A tooltip with structure. `title` is the thing's name, `meta` a short type/format tag beside
 *  it, `body` the prose below. A plain string keeps working and stays the common case. */
export interface TooltipContent { title: string; meta?: string; body?: string }
export const vTooltip: ObjectDirective<HTMLElement, string | TooltipContent | null | undefined>;
// data-kira-tip keeps the newline-joined PLAIN TEXT (aria-label + every existing Playwright
// assertion read it, P22 D8/P31's own header assertion); data-kira-tip-parts carries the JSON,
// read only by AppTooltip.vue. A host with no parts attribute renders exactly as it does today.
export const tooltipState: { text: string; parts: TooltipContent | null; open: boolean; id: string | null };
```

```ts
// src/renderer/views/shared/celleditor/formats.ts — CELL_FORMATS loses two entries, gains an
// order, and gains one map (D23/D25/D26/D28).
export const CELL_FORMATS = [
  'text', 'json', 'xml', 'csv', 'sql',          // read-it-directly formats, commonest first
  'iso8601', 'epochSeconds', 'epochMillis',     // time
  'base64', 'hex',                              // binary encodings (both open a translate pane)
] as const;
export const FORMAT_LABEL: Record<CellFormat, string>;   // iso8601 -> 'Time (ISO…)'  (D25)
/** One sentence per format, the single source both the picker's rows and its trigger read
 *  (D28) — two surfaces, one map, no way to drift. */
export const FORMAT_HELP: Record<CellFormat, string>;
/** Where one group ends and the next begins, for the picker's separators. */
export const FORMAT_GROUPS: readonly (readonly CellFormat[])[];
```

```ts
// src/renderer/views/shared/celleditor/validate.ts — NEW (D26). Pure, synchronous, never throws;
// on the same 50 ms selection path as detect.ts.
export interface FormatProblem { message: string; offset?: number }
/** null when the value is a valid instance of `format`. Every format answers for real:
 *  json/xml via beautify.ts's scanners, csv via detect.ts's pickCsvShape, the three time formats
 *  via timestamp.ts's parseTimestamp, hex/base64 via a shape check plus atob, sql via
 *  @shared/domain/sql-lint's first error, text always valid. */
export function validateFormat(format: CellFormat, text: string): FormatProblem | null;
```

```ts
// src/renderer/views/shared/celleditor/generate.ts — NEW (D29). Pure functions, unit-testable,
// no Vue import — the shape P43's sparse-unit-test phase can pin cheaply.
export interface Generator { id: string; label: string; hint: string; run(format: CellFormat): string }
export const GENERATORS: readonly Generator[]; // uuid · ulid · token · now
```

```ts
// src/renderer/views/shared/page/visibleRows.ts — NEW (D39). Deliberately NOT the page stores'
// own setVisibleWindow, which is decode-cache lifetime keyed by page and is P43 F2's (F31a).
export function setVisibleRows(scope: string, from: number, to: number): void;
export function visibleRowsOf(scope: string): { from: number; to: number } | null;
// registerTabRuntimeCleanup drops a tab's entry, same as searchFilter.ts/search.ts already do.
```

```ts
// src/renderer/views/shared/page/scan.ts — two optional parameters, no behaviour change when
// both are omitted (D37).
export function runChunkedScan<M>(
  totalRows: number,
  scanRow: (row: number, pattern: RegExp, out: M[]) => void,
  q: SearchQuery,
  /** Gains a 4th argument: the matches found so far, ascending, a fresh slice per chunk. */
  onProgress: (found: number, rowsScanned: number, totalRows: number, soFar: readonly M[]) => void,
  opts?: {
    /** Scanned first, in its own frame, and reported through onProgress before the ordinary
     *  ascending pass starts from row 0. The full pass rebuilds the list from scratch, so the
     *  final array is always strictly ascending (F30). */
    priority?: { from: number; to: number };
  },
): SearchHandle<M>;
```

```ts
// src/renderer/views/shared/page/search.ts — one optional field on the per-tab record (D38).
searchState: Record<string, { matches: M[]; index: number; pending?: boolean }>;
// matchedRows() returns null while `pending`: a partial list highlights, but never hides rows.
```

```ts
// src/shared/domain/settings.ts — one field (D14).
export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
  /** P42: word wrap in every code surface. `.default(true)` is today's hard-coded behaviour
   *  (CodeMirrorHost.vue's unconditional EditorView.lineWrapping, F11), so a settings row saved
   *  before this field existed parses and behaves identically. */
  wordWrap: z.boolean().default(true),
});
```

```ts
// src/shared/domain/connection.ts — the enum is UNCHANGED (F27/D34); one list is added beside it.
/** What the picker and the tree's Colour submenu offer. A strict subset of
 *  connectionColorSchema.options: every one of the twelve stays a valid, storable, renderable
 *  ConnectionColor, so a connection saved with a retired colour still parses, still renders its
 *  own rail, and is simply no longer offered. Narrowing the enum itself would make
 *  repos/connections.ts's parseRow drop that connection outright (F27). */
export const CONNECTION_COLOR_CHOICES: readonly ConnectionColor[];
```

```
ConsoleView.vue's results area after this phase (item 2/3):

  .results-body
    .result-strip                     26px band, overflow-x auto, wheel→horizontal
      button.p-tab.result-tab         22px chip: [kind icon] Result N [× on hover/active]
                                      @contextmenu → Close · Close others · Close to the right
      span[data-testid=console-status]
    SearchToolbar                     unchanged
    .result-grid                      one ConsoleResultGrid — tabular | DOCUMENT (new) | keyvalue
```

---

## 3. Decisions

### Items 11 and 20 — two CSS primitives

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **`base.css` gains `::-webkit-scrollbar-corner { background: transparent }` and `::-webkit-resizer { background: transparent }`**, beside the three scrollbar rules already there. Nothing in `views/grid/` changes. | F17: the square is Chromium's own unstyled default, not a grid element — the grid is only where two scrollbars meet often enough to notice. `transparent` (not a token) so the corner takes whatever surface is behind it, exactly as `::-webkit-scrollbar-track` already does one rule above; a fixed `--kira-bg` would be wrong over `.p-toolbar`/`bg-elevated` panels. Fixing it in the grid's own stylesheet would leave the same white square in every other scroll container. |
| D2 | **The stepper is resized to the space it actually has**: `.p-input .step-btn` gains `overflow: hidden` and its codicon is pinned to 9 px (`.p-input .step-btn .codicon { font-size: 9px }`), and `.stepper` loses its `margin: 2px 0` so each button is 10 px rather than 8 px. | F16 is 13 px of glyph in an 8 px box with no clipping anywhere in the chain. Both halves are needed: the size is the actual fix, `overflow: hidden` is the guard that keeps this from silently returning the next time a height token moves. 9 px inside 10 px leaves a hair of breathing room and still reads as a chevron — this is a 16 px-wide control, not an icon button. |
| D3 | **`.p-input.has-stepper` drops the container's right padding** (`padding-right: 0`) and the stepper takes the field's own right corner radius. | F16a: the divider currently floats 6 px inside the box with a dead gutter of input background beyond it, and the hover fill stops short of the rounded edge. This is the same declaration block and the same defect; splitting it into another commit would mean writing these rules twice. |
| D4 | **Both land in one commit.** | Two `theme/*.css` fixes, both purely visual, both covered by the same Docker-free specs (`workbench`, `connections`), and neither is large enough to review alone — P31's own step 9 grouped three unrelated one-file fixes on exactly this reasoning. |

### Items 1–3 — the query console

| # | Decision | Rationale |
|---|----------|-----------|
| D5 | **`consoleTabStateSchema.newResultSet` flips to `.default(true)` and `defaultConsoleTabState()` to `{ text: '', newResultSet: true }`.** The toggle's two tooltips swap sense; nothing else in `run()` changes. | The ask. F1's asymmetry is the point and is written into the field's comment: a tab saved before P40 restores **on** (no key → default), a tab whose owner explicitly turned it off restores **off** (stored `false` wins). That is the right behaviour — an explicit preference outranks a changed default — and it is the difference between "the default flipped" and "everyone's tabs flipped". |
| D6 | **The result strip adopts five of `TabStrip.vue`'s behaviours and goes one size down**: hover background on inactive chips, a close × revealed only on hover/active, a leading codicon per result *kind* (`table`/`json`/`symbol-key`, from the result page's own `kind`), middle-click to close, and `overflow-x: auto` with the wheel handler; chips drop to `--kira-h-sm`/`--kira-t-xs` with `max-width: 140px` in a 26 px band. **No `.p-tab-rail`.** | F2, item by item. The size step down is the whole of "smaller": the chips are currently the *same* `--kira-h-md` as the app's primary tabs, which is why a secondary in-panel strip reads as a second tab bar. The kind icon is not decoration — with a Mongo or Redis console a run can produce result sets of different kinds, and the icon is the only thing that says which. The rail is dropped because it carries a *connection colour* in the main strip and every result set in a console belongs to the same connection; reusing that slot for anything else would make the same 2 px bar mean two things. Overflow is not optional once D5 lands. |
| D7 | **The wheel handler is hoisted to `src/renderer/wheelScroll.ts` and both strips call it.** | F3: `views/console/` may not import `workbench/`, and a second hand-written copy of an eight-line scroll quirk is precisely how P39's F10 duplicates started. `format.ts`/`clipboard.ts`/`fonts.ts` are the established home for this size of thing. |
| D8 | **A result chip's right-click opens `openContextMenu` with exactly three items** — Close, Close others, Close to the right — backed by `closeResult` plus two new siblings in `views/console/state.ts`. **No "Close all"**, no shortcuts printed. | F4, and the user named three. §8.10's Tab row has four because a tab strip has a `tab.close-all` command behind it; a result set has no shortcut binding at all, and `MenuItem.shortcut` names a `ShortcutId` by type (`contextMenu.ts:15-17`) so there is nothing to print. Reusing `openContextMenu` rather than a `PopoverPanel` is the rule this codebase already follows for every right-click surface; a second mechanism is what the ask explicitly warns against. Items are `disabled` rather than hidden when they would be no-ops (one result set open; the clicked chip is the last one), matching `rowMenu`'s own `disabled: !canEdit` idiom. |

### Items 4–5 — the Mongo console

| # | Decision | Rationale |
|---|----------|-----------|
| D9 | **`ejson.ts`, `documentRows.ts` and `DocumentTree.vue` move to `views/shared/document/` (as `ejson.ts`, `rows.ts`, `DocumentTree.vue`), and `rows.ts`'s one hard dependency on `views/documents/page.ts` becomes a registered row source** (`registerDocumentRows(scope, source)`). The move is otherwise byte-for-byte; `DocumentView.vue` registers `documents/page.ts`'s `documentRow` on mount and unregisters on unmount. | F6/F7/F8. §11 forbids `views/console/ → views/documents/`, and `views/shared/` is where this codebase already puts a component two views need — P31 D12 moved `DateTimePicker.vue` for exactly this reason. The registry (rather than a factory, or threading a resolver through eleven call sites) is chosen because `rows.ts` is *already* built this way: `rowHeight()` takes `isExpanded` from its caller and says in its own comment (`:157-161`) that it does so to avoid an import edge. A registered source is the same idea one level down, and it is the shape `state/viewCommands.ts` established and P41 extended. |
| D10 | **This move is its own commit, with zero behaviour change**, landing before anything uses it. | It touches ~800 lines across three files plus five import sites; a reviewer must be able to see that nothing moved but the files. `mongo.spec.ts`'s existing document scenarios re-run green is the regression guard, and it is a real one — `document-tree`, `document-tree-line`, `document-tree-value` and `document-tree-summary` testids are unchanged by construction. |
| D11 | **The console's `page.kind === 'document'` branch is rebuilt on the moved component**: a head row (`_id` label, `N fields`, byte badge, truncated chip) plus, when expanded, `DocumentTree`, with `VirtualList`'s `:row-heights` from `rowHeight(scope, row, null, isExpanded)`. **Documents start collapsed** and per-result expansion state lives in the console runtime. **No Edit button, no Delete button, no editing chip, no `document-new` form** — the console's dock is already `:read-only="true"` (P40 D11). | F5, and "read-only" stated as a diff rather than a mood. The head/tree pair *is* the Mongo document view (`DocumentView.vue:694-812` minus its two action buttons), so this is a reuse, not a lookalike. Collapsed-by-default differs from the data tab (P27 D2 expands by default there) for one honest reason: a console result set is usually a `find()` the user is skimming for shape, and `rowHeight` for an expanded document is `HEAD + lines × 18 + 8` — expanding a 200-document result by default is a tall list nobody asked for. `editingId` is passed as `null` because there is no editor to be in. |
| D12 | **`lintMongoConsole` gains an argument check**: the existing bracket walk also records each top-level argument's span inside the statement's `(…)`, and each non-empty span is run through `scanShellText`; a failure reports `invalid argument at offset N` on that span. Bracket/quote errors still short-circuit first. | F9/F10, and the user's own bar. The shell-literal parser — not `JSON.parse` — is the right validator because the Mongo console's grammar *is* shell literals: `{_id: ObjectId("…")}` is valid input that `JSON.parse` rejects, and a linter that reddens valid statements is worse than one that reddens nothing. Short-circuiting on brackets is already `lintMongoConsole`'s own rule (`:82-83`) and stays: an unbalanced `{` makes every argument span meaningless. Scope is the **Mongo** console only, as asked — the SQL consoles already have `lintSql`, and Redis has its own rules. |
| D13 | **No new lint plumbing.** `CodeMirrorHost`'s `lintSource` prop, its compartment, its 400 ms debounce and `theme.ts`'s underline/hover styling are all already in place (`CodeMirrorHost.vue:129-148`, `ConsoleView.vue:78`). | The console has had a linter since P18's addendum; item 5 is a missing *rule*, not a missing mechanism. Stated so the implementing session does not go looking for a diagnostics pipeline to build. |

### Item 6 — word wrap

| # | Decision | Rationale |
|---|----------|-----------|
| D14 | **Say plainly that wrap is already on everywhere (F11), and build the control that is genuinely missing: one app-wide Appearance setting, `wordWrap`, defaulting to `true`, driven into `CodeMirrorHost` through a fifth `Compartment`.** `SettingsDialog.vue` gains one checkbox in the Appearance section. No per-surface toggle, no per-surface prop. | The report and the code disagree, and §0 says the plan resolves that by reading the code. But "add wrap … like code editors have" does name a real absence: a code editor's wrap is a *setting you can see and change*, and this app's is a hard-coded line in a component. One app-wide switch is the honest smallest version — it is where `fontFamily`/`fontSize`/`rowDensity` already live, it needs no new prop threaded through seven mount sites, and `.default(true)` means every existing settings row parses and behaves exactly as it does today (the same rule `documentTabStateSchema` documents). Rejected: a per-editor toggle button on each of the seven surfaces (six of which are read-only viewers where a toggle is chrome for its own sake), and doing nothing at all (defensible on F11 alone, but it answers a reasonable request with "you're wrong"). |
| D14a | **A `Compartment`, not a rebuild.** `CodeMirrorHost` already reconfigures four compartments from four watchers; wrapping joins them, watched off `settingsState.appearance.wordWrap`. | Recreating the `EditorState` would drop undo history and cursor position on a settings change, in every open editor at once. The file's own pattern is right there. |

### Items 7–8 — grid selection gestures

| # | Decision | Rationale |
|---|----------|-----------|
| D15 | **Drag-select is `mousedown` on a cell → `mouseenter` on cells while held → `mouseup` anywhere.** `mousedown` (primary button, no Shift) sets a drag anchor and a `cell` selection; each `mouseenter` while dragging writes `{ kind: 'range', anchorRow, anchorCol, row, col }`; a document-level `mouseup` ends it. **Shift-click is untouched** — a Shift-modified `mousedown` falls through to `onCellClick`'s existing extend path. | F12/F13. The drag writes exactly the selection shape shift-click already writes, so copy, the cell menu, the cell-editor publication and `isSelected` need no changes at all — which is what keeps this a small commit. Keeping `mousedown` and `click` as separate paths (rather than moving all selection onto pointer events) means the existing keyboard, context-menu and nav-button behaviours are untouched; a guard flag makes `onCellClick` a no-op when a drag actually produced a range, so a real drag can never be clobbered by the trailing `click`. `.grid-cell` is already `user-select: none` (F12), so there is no native text selection to suppress. |
| D16 | **The drag auto-scrolls at the grid's edges**: while dragging, a `requestAnimationFrame` loop scrolls the container when the pointer is within 24 px of an edge, and the extension continues off whichever cell the pointer then enters. | Without it the gesture stops at the viewport, because `mouseenter` only ever fires on rendered rows — a drag-select that cannot reach row 60 of a 40-row viewport is exactly the half-implementation AGENTS.md forbids. The loop exists only while a button is held and stops on `mouseup`, so it costs nothing in the steady state; `budgets.spec.ts`'s scroll-response budget is re-run as the guard (§5). |
| D17 | **The corner cell selects the whole grid as a `range`**, not as a row selection: `{ kind: 'range', anchorRow: 0, anchorCol: 0, row: rowCount - 1, col: columnOrder.length - 1 }`. It gains `role="button"`, `aria-label="Select all cells"`, `data-testid="grid-select-all"` and a pointer cursor. No keyboard shortcut is added. | F14/F14a. The `range` choice is not a style preference: `isSelected` resolves a `row` selection with `Array.includes` (O(rows) per rendered cell per render), so a whole-page row selection would put a 100 000-element scan inside the render loop of every visible cell. A range is two comparisons, and it is the shape copy and the cell menu already understand. No shortcut because `Ctrl/Cmd+A` is a real decision about focus scope (the grid vs. an open inline editor vs. the cell editor's CodeMirror) that the user did not ask for — §6. |
| D18 | **Both land in one commit.** | They are the same selection model in the same file with the same spec block, and item 8's `range` choice is only defensible in the light of item 7's — a reviewer needs to see them together. Everything else about the grid stays put: no drag-select on the gutter or the header (§6). |

### Items 9 and 10 — grid chrome

| # | Decision | Rationale |
|---|----------|-----------|
| D19 | **The tooltip gains structure, and the plain string stays the transport of record.** `v-tooltip` accepts `string \| { title, meta?, body? }`; the directive writes the newline-joined **plain text** into `data-kira-tip` exactly as today (a11y mirror + every Playwright assertion) and the JSON into a second attribute `data-kira-tip-parts`; `AppTooltip.vue` renders `.tip-title` (fg, 600), `.tip-meta` (a muted mono badge on the title's line) and `.tip-body` (muted, below) when parts are present, and `{{ text }}` otherwise. | F18: the pipeline can carry only one string, and hierarchy is not expressible in one string. Widening the directive's value while keeping `data-kira-tip` byte-identical is what makes this a purely additive change — `tooltips.spec.ts`'s delay/disabled/pointer-events scenarios and P31's header assertion are untouched by construction, and every one of the ~120 plain-string call sites keeps working with no edit. Rejected: a second directive (`v-tooltip-rich`) — two directives for one concept is how the app ends up with two tooltip mechanisms; and rendering markup from the string — a tooltip that parses its own text is a bug waiting for a column named `<b>`. |
| D20 | **The grid header is the first caller**: `headerTitleFor` returns `{ title: name, meta: dataType, body: [typeDescription, comment] }`. `ConsoleResultGrid.vue:46-49`'s twin (P40 D16, deliberately the same shape minus the comment) changes with it. | F18, and the ask. Changing one and not the other would re-open exactly the drift P40 D16 closed. The `meta` slot is the type — it is a token, not prose, and rendering it as a badge is what separates "what this column is called" from "what it holds" at a glance. |
| D21 | **Selected cells draw a shared-edge-aware border instead of a per-cell `outline`.** `.grid-cell.selected` keeps `background: var(--kira-select)` and replaces the `outline` with a four-part `inset box-shadow` built from four custom properties, each switched on by an edge class (`sel-t`/`sel-r`/`sel-b`/`sel-l`) that `renderRows` sets by asking `isSelected` about the four neighbours. An internal seam gets no border from either side; the selection's outer perimeter is 1 px, once. | F15, and the fix has to fit the grid's virtualised, absolutely-positioned rows without a rearchitect. Four booleans per **selected** cell, computed inside the loop that already computes eight flags per cell (`renderRows`, `:866-874`), and `isSelected` is O(1) for the two selection kinds a multi-cell selection can be. Custom properties are what make it compose: four separate `box-shadow` declarations would override each other, four separate classes each setting one `--sel-*` do not. Rejected: one absolutely-positioned overlay rectangle around the range (cannot express a disjoint Ctrl-built row/column selection, and breaks when filtering hides rows inside the span); and `border-collapse` (this is not a table). |
| D22 | **`ConsoleResultGrid.vue`'s copy of the rule is left alone**, with a one-line comment recording why. | F15: its `selected` is a single `{row, col}` ref, so two cells there can never be selected at once and the defect is unreachable. Changing it would mean adding edge computation to a grid that has no multi-cell selection to compute it for — dead code carrying the appearance of a guarantee, which is the exact thing P40 F22 complained about. |

### Items 12–18 — the cell editor's format picker

| # | Decision | Rationale |
|---|----------|-----------|
| D23 | **`uuid` and `url` are removed from `CELL_FORMATS`, `FORMAT_LABEL`, `FORMAT_LANGUAGE`, `PRECEDENCE` and `DETECTORS`, and `detectUrl` is deleted.** | F19: both are inert on selection, the user is right, and `PRECEDENCE` must lose them too or `indexOf`'s −1 would sort a missing format first (F20). `detectUrl` deletes cleanly — a URL's `:` and `.` are outside both base64 alphabets and `HEX_RE`, and one line is never CSV, so a URL falls to `text` on its own. |
| D24 | **`detectUuid`'s body survives as a two-line guard inside `detectBase64`**, not as a format: `if (UUID_RE.test(t)) return null;` beside the existing *"purely hex-shaped — let hex win the overlap"* guard, with a comment naming the arithmetic. | F19's trap, in one line. Without it, deleting the UUID format silently converts every UUID column in the app into a base64 cell with a decoded-text pane of mojibake — a strictly worse outcome than the inert format the user asked to remove. Putting the guard in `detectBase64` (rather than keeping a hidden `uuid` format) is what makes "removed entirely" literally true: there is no UUID entry left anywhere in the vocabulary. |
| D25 | **`FORMAT_LABEL.iso8601` becomes `'Time (ISO…)'`. Nothing else about that format changes** — the key stays `iso8601`, `data-format`/`data-detected` still read `iso8601`, `TimestampPane` is untouched. | The ask, and the boundary of it. The key is a stored override value (`celleditor/state.ts`'s override map) and a Playwright attribute; renaming it would be a migration for a label change. |
| D26 | **Every remaining format validates for real, in one pure module** (`validate.ts`), and a failure is surfaced as an error chip beside the status badge (`data-testid="cell-editor-invalid"`) plus `data-invalid` on the panel root and an `is-invalid` mark on the picker's trigger. Validation runs on the **effective** format (auto or override) against the current buffer. | F21 and the user's own bar (*"I want to know my json is broken, or my timestamp wrong"*). Every validator already exists in the tree (F21 lists all six) — what is missing is a single entry point and a place to show the answer. Validating the *effective* format is the right scope: validating every format in the list is what detection already does, and painting nine rows with pass/fail marks would turn a picker into a report. `text` is always valid, by definition, and says so rather than being special-cased at the call site. |
| D27 | **The native `<select>` becomes an app-drawn picker**: an `IconButton`-style trigger keeping `data-testid="cell-editor-format"` (now a `<button>`), opening `openContextMenu` with one row per format, `checked` on the effective one, an `Auto — X` row first, and `FORMAT_GROUPS`' separators. `MenuItem` gains `hint?: string`, rendered by `ContextMenu.vue` as `v-tooltip="item.hint"`. | F22 is the hard constraint: a native `<option>` can never carry an app-owned tooltip, because the popup is drawn outside the DOM `elementFromPoint` can reach, and the one attribute that would work (`title`) is banned app-wide by P22. So item 16 is either "replace the control" or "don't do it". Replacing it costs three spec edits (F23) and buys three things at once: per-format hover text (item 16), the group separators item 15's ordering wants, and a trigger that can carry the invalid mark (D26). `openContextMenu` rather than a bespoke `PopoverPanel` list keeps the app at one menu mechanism; `hint` is one optional field and one directive binding (F25). The cost is honest and recorded: a context menu has no arrow-key navigation, so the picker loses keyboard operability that a native `<select>` had — §6 and §9. |
| D28 | **`FORMAT_HELP` is one exported map, read by both the picker's rows and its trigger's own tooltip.** It is **not** merged with `typeGlossary.ts`. | The ask's real requirement is "one source, two surfaces, no drift", and one map read from two places is that. Merging it with the column-header glossary is refused deliberately and stated plainly: `typeGlossary` describes a **column's SQL type** (`int4`, `timestamptz`) and `FORMAT_HELP` describes a **cell format** (`JSON`, `Base64`) — different vocabularies over different things. Printing "JSON — a structured document…" over a column typed `int4`, or "a 4-byte signed integer" over the Base64 row, would be worse than the drift the shared source is meant to prevent. Both surfaces do now render through D19's structured tooltip, so they *look* like one system, which is the part that was actually missing. |
| D29 | **"Generate UUID" becomes a generators panel**: a `sparkle` trigger (`data-testid="cell-editor-generate"`) opening a small `PopoverPanel` with four entries — **UUID (v4)**, **ULID**, **Random token** (32 hex chars from `crypto.getRandomValues`), **Now** (ISO-8601, or epoch seconds/millis when the effective format is one of those). Enabled whenever the buffer is editable — **never format-gated**. Generators live in a pure `generate.ts`. | F26. Four entries, no inputs, no configuration — the ask says "lightweight utility panel" and every one of these is a value a developer types into a column by hand. Dropping the format gate is the actual fix for P40 D13's complaint: the old button's disabled tooltip (*"Available when the format is UUID"*) was a false statement precisely because the gate was arbitrary — a generator writes into the buffer, and the buffer does not care what format the value is being read as. "Now" is format-aware because that is the one case where the right *text* genuinely differs. Rejected: a random integer with a range (needs a form inside a popover, and "0–999999" would be an arbitrary answer to a question the user didn't ask); anything needing a dependency (ULID is ~15 lines of Crockford base32 over `Date.now()` plus 80 random bits). |
| D30 | **The generator panel is not rendered in viewer mode**, exactly as the UUID button is not today. | P40 D13's rule, unchanged: viewer mode hides everything that exists to stage a write. Nothing to re-decide. |
| D31 | **`EditBufferActions` gains `showBytes?: boolean` (default `true`); the cell editor passes `false`.** The status badge — the one that also carries the decoded reading, the truncation note and the beautify failure — is the survivor. `DocumentView.vue`'s two mounts are untouched. | F24. The duplicate belongs to this mount, not to the component: the document editor's byte badge is that surface's *only* byte figure and `mongo.spec.ts:152` asserts it. Keeping the status badge rather than the byte badge is forced by coverage — the status badge exists in both viewer and edit mode and says four things; the byte badge exists in edit mode only and says one, which the other already says first. |
| D32 | **Split across three commits**: list surgery (12/13/15), then the validating/explaining picker (14/16), then the generators panel and the byte badge (17/18). | The first is a pure vocabulary change with no new UI and a mechanical spec diff; the second replaces a control and rewrites three spec lines; the third changes two testids. Each is one sitting and one reviewable idea. 17 and 18 ride together because both are the same header row in the same file and the same `cell-editor.spec.ts` block. |

### Item 19 — the date/time picker

| # | Decision | Rationale |
|---|----------|-----------|
| D33a | **The month/year label becomes a button cycling three modes** — days (today's grid) → months (a 3×4 grid of the view year's months, with ‹ › paging the year) → years (a 4×4 grid of a 16-year block, with ‹ › paging the block). Picking a month returns to days; picking a year returns to months. The prev/next arrows stay and act on whatever the current mode pages. | The ask, and the interaction every calendar widget the user has met already implements — including the one this component was written to replace (P24 D18's own note that this exists to get rid of `<input type="datetime-local">`). Reusing the same 7-column grid CSS and the same `.dtp-day` chip for month and year cells keeps this inside the component with no new primitive: `.dtp-days` is a `grid-template-columns: repeat(7, 1fr)` block, and the two new grids are the same block at `repeat(4, 1fr)`. New testids: `datetime-picker-mode`, `datetime-picker-month-cell`, `datetime-picker-year-cell`; `datetime-picker-month` keeps its meaning as the label's text. |
| D33b | **Neither picking a month nor picking a year moves the selected value** — only the *view*. | `viewYear`/`viewMonth` are already independent of `selected` with a comment saying why (`DateTimePicker.vue:56-59`: *"paging doesn't move the selection until a day cell is actually clicked"*). The new modes are paging by another name and must obey the same rule, or jumping to April to look would silently restage the cell. |

### Item 21 — connection colours

| # | Decision | Rationale |
|---|----------|-----------|
| D34 | **`connectionColorSchema` is NOT narrowed.** All twelve values stay valid, storable and renderable, and every `--kira-conn-*` token stays in `tokens.css`. A new `CONNECTION_COLOR_CHOICES` list — the subset the *picker* offers — is added beside it, and `ColorPicker.vue:8` and `project/menus.ts:195` read that instead of `connectionColorSchema.options`. | F27, and this is the phase's sharpest correctness point. `repos/connections.ts:83-94`'s `parseRow` **drops** any row that fails `connectionRowSchema`, logging a warning and returning `null`; `listConnections` then omits it. Narrowing the enum would therefore make every connection saved with a retired colour disappear from the project panel on next launch, silently. Splitting "what is a valid colour" from "what the picker offers" costs one exported array and keeps every existing connection intact, rendering its own rail exactly as before — it just stops being offered to new ones. This is also why the stored format was worth checking rather than assuming: it is a name, not an index, so nothing is *mis*-coloured — the failure mode is deletion, not drift. |
| D35 | **The offered set is `none, red, amber, green, cyan, blue, magenta, grey`** (six hues + grey + none). Retired from the picker: `orange`, `olive`, `teal`, `indigo`, `violet`. | F28/F28a. The minimum adjacent hue gap goes from **25.6°** (blue↔indigo) to **42.2°**, at a fixed C = 0.09 — roughly a doubling of the perceptual distance between the two nearest choices, which is what makes a 2 px tab rail readable at all. Six is the largest subset that can beat 40°; the alternative six-set (`indigo` in place of `blue`, 44.5°) is 2.3° better and gives up the most familiar colour name in the list, which is not a trade worth making. `red`/`amber`/`green` surviving together is a deliberate side effect — prod/staging/dev is the commonest thing a connection colour is used for. `grey` stays despite sharing `blue`'s hue (F28): its chroma separation (0.012 vs 0.091) is larger than any hue step in the palette, and it is the "marked but not alarming" choice. |
| D36 | **`connColor.ts` is unchanged**, and its doc comment gains one line recording that a colour may be storable without being offered. | It resolves a name to a token and knows nothing about which names are offered; that is the property that makes D34 work at all, and it deserves to be written down where the next reader will look. |

### Item 22 — viewport-first find

| # | Decision | Rationale |
|---|----------|-----------|
| D37 | **`runChunkedScan` gains a priority window and a partial-results channel.** With `opts.priority = { from, to }` it scans that window first, in its own frame, and reports it through `onProgress`; it then runs the ordinary strictly-ascending pass from row 0, rebuilding the array from scratch and reporting after every chunk. `onProgress` gains a 4th argument: the matches so far, as a fresh ascending slice. Both are optional; omitting them is byte-for-byte today's behaviour. | F29 is two separate problems and this fixes both: nothing is published until the end (the partial channel), and the rows you are looking at are scanned last (the priority window). Rebuilding from row 0 rather than continuing from the window is what keeps F30's contract — `matchedRowsOf` de-duplicates in one pass *with no sort*, on the stated assumption that every scanner emits ascending, and prev/next cycles the array in index order. The priority window's rows are therefore scanned twice; a window is ~40 rows against a page of hundreds of thousands, so that is free. |
| D38 | **A partial publication is marked `pending`, and `matchedRows()` returns `null` while it is set.** The toolbar writes `{ matches: soFar, index: -1, pending: true }` on each progress tick and `{ matches, index: matches.length ? 0 : -1 }` on `done`. The count keeps reading `N…` while scanning (the template's `scanning` branch is moved ahead of its `entry` branch, which today wins and would print a growing "0 of N"). | Highlighting a partial answer is strictly better than an empty screen; *filtering* on one is not — rows would vanish and then reappear as the scan caught up, under a user who is trying to read them. One optional flag on a record the toolbar already owns separates the two, with no second state to keep in step. `index: -1` while pending means Enter/next still works (it jumps to the first match found so far), which is the behaviour someone typing into a find box expects. |
| D39 | **The visible window is reported into a new `views/shared/page/visibleRows.ts`, by `DataGrid.vue` (one line beside its existing `visiblePageRowBounds` watch) and by `VirtualList.vue`'s new `visible-range` emit, forwarded by the document, key/value and console-result views.** Each view's `runSearch` passes `visibleRowsOf(tabId)` as `opts.priority`. **`PageSearchApi` does not change.** | F31: the grid already computes exactly this and the other three cannot know it without `VirtualList` telling them. Keeping it out of `PageSearchApi` matters — that interface is the toolbar's contract, and the toolbar has no business knowing about pixels; the *scanner* is the thing that wants a starting point, and each `runSearch` is already the place where a view's own page module is consulted. `stream/` is untouched (F31, its scanner is not built on this driver). |
| D40 | **`setVisibleWindow` in `views/grid/page.ts` and `views/console/resultPages.ts` is not touched, and the console's still has no caller when this phase ends.** | F31a: those prune decode caches keyed by *page*; this is search priority keyed by *tab*. `docs/v1/plans/P43-functionality-review.md`'s F2 has already claimed the console's dead export, and quietly wiring it here would leave that plan describing a tree that no longer exists. §8 hands P43 the note that its fix can now read `visibleRows.ts` rather than adding a third reporting path. |

### Documentation

| # | Decision | Rationale |
|---|----------|-----------|
| D41 | **SPEC.md is edited by the implementing session, in the final commit**; ARCHITECTURE.md is not touched. §5.1's connection-colour sentence gains the offered-vs-storable split; §8.1 the wrap setting; §8.5 drag-select, select-all, the collapsed selection border and the structured header tooltip; §8.6 the format list, its validation, the picker, the generators panel and the single byte figure; §8.7 the moved document tree; §8.10 gains a "Console result tab" row; §8.12 the trimmed palette; §8.15 the new-result default and the restyled strip; §8.17 structured tooltips; §11's tree gains `renderer/wheelScroll.ts`, `views/shared/document/`, `views/shared/celleditor/{validate,generate}.ts` and `views/shared/page/visibleRows.ts`. §10's P42 row moves from "Not yet planned — queued" to what was built. | Standing practice (P19/P21/P24/P31/P39/P40 D19). ARCHITECTURE.md is *"facts about the app itself — driver/dependency choices, protocol-level constraints, capability quirks"* (its own §1); nothing in this phase is an engine, storage or process fact — the one storage-shaped finding (F27) is a *reason not to change* storage. Said plainly so a reader does not think it was forgotten. |

---

## 4. Implementation order

Seventeen commits. Each is one sitting, independently reviewable, leaves `lint`/`typecheck`
(node, web, db, electron-db)/`build` green, and carries the spec edits for the behaviour **it**
changes. Ordering constraints, and only these: 4 before 5 and 6 (the move must land before anyone
imports it); 10 before 12 (the format picker's hover text renders through the structured tooltip);
11 before 12 and 13 (the vocabulary before the UI over it). Everything else is independent.

1. **`fix(theme): a themed scrollbar corner, and a stepper that stays inside its box`** — D1/D2/D3.
   `theme/base.css` (`::-webkit-scrollbar-corner`, `::-webkit-resizer`), `theme/primitives.css`
   (`.p-input.has-stepper`, `.stepper`, `.step-btn`). No `.vue` file changes.
   Specs: `workbench.spec.ts` (computed corner background is not `rgb(255, 255, 255)`),
   `connections.spec.ts` (a stepper chevron's bounding box is inside its button's).

2. **`feat(console): a run opens a new result tab by default`** — D5.
   `shared/domain/tabs.ts` (`.default(true)`, `defaultConsoleTabState`, the field's comment
   rewritten per F1), `ConsoleView.vue`'s two toggle tooltips.
   **Spec edits, all inverted-toggle, all in this commit:** `console.spec.ts:214-241`
   (scenario 3 — run-statement twice now yields two chips, and `console-status` reads accordingly),
   `console.spec.ts:377-420` (the whole D6 scenario's on/off halves swap),
   `interaction.spec.ts:706-720` (Run Statement then Run All is now three chips, not two),
   `sqlite.spec.ts:143-157` (**runs in this sandbox** — run twice with no click for two chips, then
   click the toggle for reuse). `leaks.spec.ts:158` is unaffected (one grid is still mounted).

3. **`feat(console): tab-strip chrome and a right-click menu on the result strip`** — D6/D7/D8.
   `renderer/wheelScroll.ts` (new), `TabStrip.vue` (uses it — behaviour identical),
   `ConsoleView.vue` (chip markup, kind icon, middle-click, `@contextmenu`, the strip's CSS),
   `views/console/state.ts` (`closeOtherResults`, `closeResultsToTheRight`).
   Specs: `console.spec.ts` gains a right-click block (`menu-item-close-other-results` leaves one
   chip; `menu-item-close-results-to-the-right` from chip 1 of 3 leaves one), `tabs.spec.ts` re-run
   green as the guard that D7's hoist changed nothing in the main strip.

4. **`refactor(views): the Mongo document tree moves to views/shared/`** — D9/D10. Files move to
   `views/shared/document/{ejson.ts,rows.ts,DocumentTree.vue}`; `rows.ts` gains
   `registerDocumentRows`/`unregisterDocumentRows` and loses its `./page` import;
   `DocumentView.vue`, `documents/page.ts`, `documents/menu.ts` update imports and register the
   source. `scanShellText` is exported (unused this commit). **No behaviour change, no testid
   change.** Specs: `mongo.spec.ts` re-run green, unchanged, as the guard.

5. **`feat(console): a Mongo console result renders as a read-only document view`** — D11.
   `ConsoleResultGrid.vue`'s `page.kind === 'document'` branch, the console runtime's per-result
   expansion set, `ConsoleResultGrid.vue:155-159`'s comment corrected. Specs: `mongo.spec.ts:229`'s
   console block asserts `document-tree` lines, an expand toggle, and **zero** `document-edit`/
   `document-delete`.

6. **`feat(console): the Mongo console editor reports a broken argument`** — D12/D13.
   `views/console/lint.ts` only. Specs: `mongo.spec.ts` — type `db.c.find({a:})`, assert a
   `.cm-lintRange-error` appears; type a valid `db.c.find({_id: ObjectId("…")})` and assert none
   (the shell-literal-not-JSON guarantee).

7. **`feat(editor): a word-wrap setting for every code surface`** — D14/D14a.
   `shared/domain/settings.ts` (+`defaultSettings`), `state/settings.ts`, `SettingsDialog.vue`,
   `CodeMirrorHost.vue` (fifth compartment + watcher). Specs: `workbench.spec.ts` (no Docker) —
   toggle it off, assert `.cm-content`'s computed `white-space` changes and survives a relaunch;
   `startup.spec.ts` re-run for the settings-row restore path (`.default(true)`'s claim).

8. **`feat(grid): drag to extend a cell selection; the corner cell selects everything`** —
   D15/D16/D17/D18. `DataGrid.vue` only. Specs: `data-view.spec.ts` — `mouse.down` on one cell,
   `mouse.move` across two columns and three rows, `mouse.up`: assert nine `.selected` cells and
   that Ctrl/Cmd+C copies the 3×3 block; click `grid-select-all` and assert every rendered cell is
   `.selected`; assert shift-click still extends as `interaction.spec.ts:333` already requires.

9. **`fix(grid): adjacent selected cells share one border`** — D21/D22.
   `theme/cellClass.ts` (four flags), `DataGrid.vue` (`renderRows` edge computation + the CSS).
   Specs: `data-view.spec.ts` — with a 2×2 range selected, assert the top-left cell's computed
   `box-shadow` has no right/bottom component and the bottom-right's has no left/top; assert a
   single-cell selection still draws all four.

10. **`feat(workbench): structured tooltips, first used by the grid header`** — D19/D20.
    `workbench/state/tooltip.ts`, `AppTooltip.vue`, `DataGrid.vue`'s `headerTitleFor`,
    `ConsoleResultGrid.vue:46-49`. Specs: `tooltips.spec.ts` — a header hover renders
    `.tip-title`/`.tip-meta`/`.tip-body` as separate elements; `data-kira-tip` still contains the
    name, the type and the description (P31's assertion, unchanged, re-run as the guard); a
    plain-string tooltip elsewhere still renders as one text node.

11. **`refactor(celleditor): drop UUID and URL, rename ISO, reorder common-first`** —
    D23/D24/D25. `formats.ts`, `detect.ts` (`detectUrl` deleted, `detectUuid`'s regex re-homed as
    `detectBase64`'s guard, `PRECEDENCE` trimmed), `CellEditorView.vue`'s
    `canGenerateUuid`/`uuidGenerateTitle` deleted with the button they gated (the generators panel
    lands in step 13; the button is not left orphaned in between — step 11 removes it and step 13
    adds its replacement, so the intermediate tree simply has no generator, which is honest and
    builds). Specs: `cell-editor.spec.ts:589-604` (the UUID scenario) rewritten to assert a UUID
    value now detects as `text` and **not** `base64` — the D24 guard's own regression test —
    and `:317`/`:355`/`:860`'s `selectOption` values re-checked against the new list.

12. **`feat(celleditor): the format picker validates its value and explains every format`** —
    D26/D27/D28. `validate.ts` (new), `formats.ts` (`FORMAT_HELP`, `FORMAT_GROUPS`),
    `contextMenu.ts` (+`hint`), `ContextMenu.vue` (one `v-tooltip`), `CellEditorView.vue` (the
    trigger, the menu, the invalid chip), `detect.ts` (`pickCsvShape` exported).
    Specs: `cell-editor.spec.ts` — the three `selectOption` calls (F23) become
    trigger-click + `menu-item-format-*` click; the five `.focus()` calls are verified unchanged;
    new: override a broken JSON value to `json` and assert `cell-editor-invalid` naming the offset,
    override a non-timestamp to `iso8601` and assert it too, hover a menu row and assert its
    `data-kira-tip` equals `FORMAT_HELP`'s text.

13. **`feat(celleditor): a generators panel, and the byte size shown once`** — D29/D30/D31.
    `generate.ts` (new), `CellEditorView.vue`, `EditBufferActions.vue` (`showBytes`).
    Specs: `cell-editor.spec.ts` — open `cell-editor-generate` on a *non*-UUID cell (proving the
    gate is gone), pick each of the four and assert the buffer matches its shape and stages;
    assert `cell-editor-byte-badge` has count **0** in a data tab while `cell-editor-status` still
    carries a byte figure; `:892-894`'s viewer-mode counts still pass; `mongo.spec.ts:152`'s
    `document-byte-badge` re-run green as the guard that `showBytes`' default held.

14. **`feat(datetime): jump months and years from the calendar's own label`** — D33a/D33b.
    `views/shared/DateTimePicker.vue` only. Specs: `cell-editor.spec.ts`'s timestamp block —
    click the label twice to reach the year grid, pick a year, pick a month, assert the day grid
    returns on that month **and** that nothing staged until a day was clicked (D33b);
    `kafka.spec.ts`'s since-filter calendar re-run green.

15. **`feat(connections): trim the colour palette to perceptually distinct hues`** — D34/D35/D36.
    `shared/domain/connection.ts` (`CONNECTION_COLOR_CHOICES`; the enum untouched),
    `ColorPicker.vue`, `project/menus.ts`, `connColor.ts`'s comment.
    **Spec edits (five files click a now-retired swatch):** `sqlite.spec.ts:62` (`color-violet`,
    **runs here**), `connections.spec.ts:122` (`menu-item-color-teal`, **runs here**),
    `clickhouse.spec.ts:71` (`color-orange`), `rabbitmq.spec.ts:62` (`color-indigo`),
    `mysql.spec.ts:80` (`color-teal`). The many `createConnection({ color: 'orange' })` helper
    calls (`memory`, `mariadb`, `tree`, `kafka`, `leaks`, `autocomplete`, `s3`, `tabs`, and
    `tests/db/support/*`) are **deliberately left alone** — they set the colour programmatically
    and are the standing proof of D34 that a retired colour still stores, parses and renders.
    New: `connections.spec.ts` asserts the picker offers exactly eight swatches and that a
    connection created with a retired colour still lists and still paints its rail.

16. **`perf(search): highlight the visible rows first, then scan the rest in the background`** —
    D37/D38/D39/D40. `views/shared/page/visibleRows.ts` (new), `scan.ts`, `search.ts`,
    `SearchToolbar.vue`, `VirtualList.vue` (one emit), the four `views/*/search.ts` (one argument
    each), `DataGrid.vue` + `DocumentView.vue` + `KeyValueView.vue` + `ConsoleResultGrid.vue` (one
    reporting line each). Specs: `data-view.spec.ts` — on a fetch-more'd page, scroll far down,
    type a term matching a visible row, and assert a `.search-match` appears on screen **before**
    `search-count` stops reading `…`; assert the filter toggle hides nothing until the scan
    completes (D38); assert the completed match list is still ascending by driving next/next/next
    and checking `data-row` increases. `budgets.spec.ts` re-run (D16's drag loop and this commit's
    per-chunk slice are both on the frame budget).

17. **`docs: SPEC §5.1/§8.1/§8.5/§8.6/§8.7/§8.10/§8.12/§8.15/§8.17/§10/§11 for P42`** — D41,
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
bun run build && xvfb-run -a bunx playwright test \
  tests/ui/sqlite.spec.ts tests/ui/startup.spec.ts tests/ui/smoke.spec.ts tests/ui/connections.spec.ts
```

`workbench.spec.ts` and `secrets.spec.ts` also run here (no DB). Every Docker-backed spec
`test.skip()`s cleanly, because image pulls return `403` through this environment's proxy.

| Spec | Runs in this sandbox? |
|---|---|
| `sqlite.spec.ts` | **Yes, for real, unconditionally** — the only console- and grid-touching spec that does. Commits 2 and 15 both have real edits in it, and both are verifiable here. |
| `workbench.spec.ts`, `connections.spec.ts`, `startup.spec.ts`, `smoke.spec.ts`, `secrets.spec.ts` | Yes (no DB). Commits 1, 7 and 15 land their primary coverage here on purpose. |
| `console.spec.ts`, `interaction.spec.ts`, `cell-editor.spec.ts`, `data-view.spec.ts`, `mongo.spec.ts`, `mutations.spec.ts`, `tooltips.spec.ts`, `tabs.spec.ts`, `budgets.spec.ts`, `leaks.spec.ts`, `kafka.spec.ts`, `redis.spec.ts`, `mysql.spec.ts`, `clickhouse.spec.ts`, `rabbitmq.spec.ts` | **No** — Postgres/MySQL/ClickHouse/Mongo/Redis/Kafka containers. |
| `tests/db/**` | **No** — Testcontainers, same `403`. Nothing in this phase touches `src/engine/` anyway. |

**Be blunt about the consequence: the grid, cell-editor, tooltip and Mongo-console work in this
phase cannot be verified here beyond `typecheck`/`lint`/`build` and careful reading.** Commits 1,
2, 7 and 15 can be, for real. **The phase is not done until the full `test:ui` suite has been run
green on a box that can run it** (the macOS/Colima machine or CI) — before the phase is called
finished, not step by step.

| Step | What must be re-run green | What it pins |
|---|---|---|
| 1 | `workbench`, `connections` **here** | The corner is no longer white in either theme; a stepper chevron's box is inside its button's. |
| 2 | `sqlite` **here**; `console`, `interaction`, `leaks` elsewhere | Append-by-default; a pre-P40 tab restores **on** and a tab explicitly turned off restores **off** (F1's asymmetry, the sharpest claim in this commit); one grid is still mounted. |
| 3 | `sqlite` **here**; `console`, `tabs` elsewhere | Three menu items act on the right chip; **`tabs.spec.ts` unchanged** is what proves D7's hoist changed nothing in the main strip. |
| 4 | `typecheck` (all four) + `mongo` | **The sharpest step in the phase.** The move is inert: every `document-*` testid, every expansion, every row height identical, with the row source now arriving through a registration instead of an import. |
| 5 | `mongo`, `console` | A Mongo console result expands, colours and counts like a data tab's — and offers no Edit, no Delete, no new-document form. |
| 6 | `mongo` | A broken argument reddens; a valid shell literal with `ObjectId(…)` does **not** (the not-JSON.parse guarantee). |
| 7 | `workbench` + `startup` **here** | The setting reaches `.cm-content`, survives a relaunch, and a settings row saved before the field existed still parses. |
| 8 | `data-view`, `interaction`, `mutations`, `budgets` | Drag builds the same range shift-click does; the corner selects everything without an O(rows) `includes` in the render loop; shift-click, arrow keys and the cell menu are untouched. |
| 9 | `data-view`, `console` (its result grid) | One border on a shared edge, all four on a lone cell — and `ConsoleResultGrid`'s copy is provably unreached (D22). |
| 10 | `tooltips`, `data-view`, `console` | Structure renders; `data-kira-tip` and `aria-label` are byte-identical to today, which is what keeps ~120 untouched call sites and every existing assertion honest. |
| 11 | `cell-editor` **in full** | UUID and URL are gone from every surface **and** a UUID value does not fall through to base64 (F19's trap — the one assertion that would fail against a naive deletion). |
| 12 | `cell-editor` **in full** | The picker opens, chooses, marks the effective format, explains each row, and reddens a value that does not validate; the five `.focus()`-to-blur paths still blur. |
| 13 | `cell-editor` **in full**, `mongo` | Four generators, none format-gated; exactly one byte figure in the cell editor and still exactly one in the document editor. |
| 14 | `cell-editor`, `kafka` | Two clicks reach a year; picking a month or a year stages nothing. |
| 15 | `connections`, `sqlite` **here**; `clickhouse`, `rabbitmq`, `mysql` elsewhere; `tests/db/support/*` untouched | Eight swatches offered — **and a connection stored with a retired colour still lists and still paints**, which is D34's whole reason for existing. |
| 16 | `data-view`, `mongo`, `redis`, `console`, `budgets` | A visible match highlights before the scan ends; the filter waits for the complete answer; the final list is still ascending. |
| 17 | read against the tree | Every named section describes the app that exists. |

**Manual click-through afterwards (a human or an agent on a box with a real database)** — headless
coverage cannot see colour, spacing or pinning, and nine of these twenty-two items are exactly that:

1. Open a wide table, scroll so both scrollbars are present: the bottom-right square matches the
   theme, in Dark Modern **and** in each Catppuccin variant.
2. Drag from a cell three columns left and four rows up, past the top edge: the grid auto-scrolls,
   the range follows, and one uniform 1 px border rings the whole block with no thick seams inside.
3. Click the corner cell: everything highlights, `⌘C` copies the page.
4. Hover a column header: a bold name, a muted type badge on its line, and the description below as
   its own paragraph.
5. Open a console, run three statements one at a time: three chips, newest active, each with its
   kind icon; hover one — its × appears; right-click it — three items; middle-click another — gone;
   open a dozen and the strip scrolls under the wheel.
6. On a Mongo connection: run a `find()`, expand a document, walk into a nested array — colours and
   indents like the data tab, and nowhere to edit or delete. Then type `db.c.find({a:})` and watch
   the argument redden; fix it and watch the underline go.
7. Open a cell editor on a JSON column, break the JSON by hand: an error chip naming the offset.
   Switch the format to Base64: another. Open the picker: Plain text first, groups separated,
   hover any row for its explanation, no UUID and no URL anywhere.
8. Press the generators button on a plain `text` cell (it is enabled — the old one was not) and try
   all four. Count the byte figures in the header: one.
9. Open the timestamp pane's calendar, click the month label twice, pick 2019, pick March, pick 12.
   Then look hard at the hour/minute/second steppers: two chevrons, each inside its own box, flush
   with the field's right edge.
10. Open the connection dialog: eight swatches, every pair telling itself apart at 16 px — then look
    at the 2 px rail on an open tab, which is where it actually has to work. Open a connection you
    created before this phase with a retired colour: still there, still its own colour.
11. On a table with 100 000+ rows loaded, scroll to the middle and press ⌘F: matches on screen light
    up immediately while the counter is still climbing; the filter button does nothing until the
    counter settles, then hides the rest.

---

## 6. Explicitly out of scope

- **Wrapping `DocumentTree.vue`'s long scalar values** (F11a) — a real defect, and the honest one
  the user may have meant by item 6. Not fixed here because `rows.ts`'s `rowHeight()` computes a
  row's pixel height as `HEAD + lines × 18 + padding` with no measurement (its own D20 comment), so
  a wrapped line silently desynchronises `VirtualList`'s geometry from the DOM. Fixing it means
  either measuring or capping, both of which are their own decision. §8.
- **A per-editor word-wrap toggle**, and turning wrap off for any surface by default (D14).
- **Auto-scroll, drag-select or a right-click menu on the row gutter or the column header**
  (D18) — item 7 names cells, and the gutter/header already have their own Shift/Ctrl gestures.
- **`Ctrl/Cmd+A` as a select-all shortcut** (D17). It is a real decision about focus scope (the
  grid vs. an inline `<input>` vs. the cell editor's CodeMirror, which binds it already), not a
  free addition. §9 asks.
- **Keyboard navigation in the new format picker** (D27). `ContextMenu.vue` has no arrow-key
  handling for *any* menu in the app; giving one menu its own would be the first divergence. The
  regression is real and recorded — a native `<select>` was arrow-navigable — and §9 asks whether
  keyboard support belongs in `ContextMenu.vue` for every menu at once.
- **Merging `FORMAT_HELP` into `typeGlossary.ts`** (D28) — different vocabularies over different
  things; the reasoning is in the decision rather than left implicit.
- **A random-integer or configurable generator** (D29), and any generator needing a dependency.
- **Narrowing `connectionColorSchema`, retiring any `--kira-conn-*` token, or re-colouring an
  existing connection** (D34/F27).
- **Wiring or deleting `views/console/resultPages.ts`'s `setVisibleWindow`** (D40) — P43 F2's.
- **Any change to `stream/`'s search toolbar or scanner** (D39/F31), to `views/shared/page/`'s
  filter semantics, or to what a search *finds*.
- **The console's editor/results split ratio**, `Console.html`'s Messages/Plan tabs, and everything
  else P40 §6 already ruled out and nobody has re-asked for.
- **`src/engine/`, `src/main/`, `src/preload/`, `src/shared/protocol/`, `tests/db/`, `biome.json`,
  and `docs/v1/design/kira-design-system/`.**

---

## 7. Acceptance checklist

- [ ] **(1)** A fresh console run opens a **new** result tab; the toggle now means *reuse*. A tab
      saved before P40 restores appending; a tab whose owner turned the toggle off restores
      reusing.
- [ ] **(2)** The result strip's chips are visibly smaller than the main tab strip's, hover-lit,
      icon-led, closable by × (on hover) and by middle-click, and the strip scrolls under the wheel
      when the chips overflow.
- [ ] **(3)** Right-clicking a result chip offers exactly Close · Close others · Close to the
      right, each acting on the clicked chip and each disabled when it would do nothing.
- [ ] **(4)** A Mongo console result renders as head rows with expandable, indented, BSON-coloured
      trees — and `document-edit`, `document-delete` and any new-document form have **count 0**
      inside `console-view`.
- [ ] **(5)** `db.c.find({a:})` shows an inline error naming an offset;
      `db.c.find({_id: ObjectId("…")})` shows none.
- [ ] **(6)** Appearance has a Word wrap checkbox, on by default; turning it off makes every code
      surface scroll horizontally, and the choice survives a relaunch.
- [ ] **(7)** Press-drag across cells builds a rectangular range, auto-scrolls past the viewport's
      edges, and shift-click still extends exactly as before.
- [ ] **(8)** Clicking the grid's top-left corner selects every cell, and the selection is a
      `range` — `grep -n "kind: 'row', rows: \[" src/renderer/views/grid/DataGrid.vue` shows no
      whole-page row selection anywhere.
- [ ] **(9)** A header tooltip renders a bold name, a muted type badge and a separate description
      paragraph — and its `data-kira-tip` still contains all three as plain text, unchanged.
- [ ] **(10)** No seam between two adjacent selected cells is thicker than the selection's own
      outer edge, at any zoom, for a range, a row selection and a column selection alike.
- [ ] **(11)** The bottom-right corner where the grid's two scrollbars meet is never white.
- [ ] **(12)** `grep -rn "'uuid'\|'url'" src/renderer/views/shared/celleditor/` returns nothing,
      and a dashed UUID value detects as `text` — **not** `base64`.
- [ ] **(13)** The picker reads **Time (ISO…)**; `data-format`/`data-detected` still read
      `iso8601`.
- [ ] **(14)** A broken JSON payload, an unparseable timestamp and a malformed base64 value each
      show a visible error naming the problem, whether the format was detected or chosen.
- [ ] **(15)** The picker opens with Plain text, JSON, XML/HTML, CSV, SQL, then the three time
      formats, then Base64 and Hex, separated into three groups.
- [ ] **(16)** Hovering any format row shows its explanation, and that text comes from exactly one
      exported map (`grep -c FORMAT_HELP` shows one declaration, two readers).
- [ ] **(17)** The generators button is enabled on a plain-text cell, offers four generators, and
      no tooltip anywhere claims a format requirement.
- [ ] **(18)** `cell-editor-byte-badge` has **count 0** in a data tab's cell editor;
      `cell-editor-status` still opens with a byte figure; `document-byte-badge` is untouched.
- [ ] **(19)** Two clicks on the calendar's month label reach a year grid; picking a year and a
      month changes only the view, never the staged value.
- [ ] **(20)** Both stepper chevrons render wholly inside their own buttons, and the stepper is
      flush with the field's right edge.
- [ ] **(21)** The picker offers eight choices; a connection saved with `orange`, `olive`, `teal`,
      `indigo` or `violet` still appears in the project panel after a relaunch and still paints its
      own rail. `connectionColorSchema.options.length` is still **12**.
- [ ] **(22)** On a large loaded page scrolled far from row 0, a find highlights on-screen matches
      before the counter settles; the filter toggle hides nothing until it does; next/next/next
      walks rows in ascending order.
- [ ] **No `data-testid` was removed except the three named in §0**, each with its spec edit in the
      same commit.
- [ ] `bun run lint`, `bun run typecheck` (node, web, db, electron-db) and `bun run build` clean
      after **every** commit; the Docker-free subset green **here** after every commit; full
      `test:ui` green on a box that can run it before the phase is called done.

---

## 8. What is left, and who owns it

**Handed to P43 (functionality review, three iterations):**

1. **`DocumentTree.vue`'s scalar values never wrap and never scroll** (F11a) — a long string in an
   expanded Mongo document is unreadable in place, in the data tab and (after this phase) in the
   console too. The blocker is `rows.ts`'s measurement-free `rowHeight()`; the fix is either a
   measured row height or an explicit cap with an expand-in-place affordance. This is the strongest
   candidate for what item 6 actually meant.
2. **The visible-row registry `views/shared/page/visibleRows.ts` now exists** (D39). P43's own
   **F2** — the console's `setVisibleWindow` having no caller — can be answered by reading it
   rather than adding a third path from the views to a window number. Named here so P43 iteration 2
   does not re-derive the plumbing.
3. **`ContextMenu.vue` has no keyboard navigation, for any menu in the app**, and after D27 one of
   its callers is a control that used to be arrow-navigable (a native `<select>`). Either the menu
   grows arrow/Home/End/type-ahead handling for every caller at once, or the format picker needs
   its own listbox. This phase makes the gap visible; it does not widen it.

**Decided here, not deferred:**

4. **Wrap was never missing** (F11/D14). Recorded so a later reader does not "fix" it again: the
   phase shipped the setting, not the wrapping, because the wrapping was already unconditional.
5. **A colour is storable without being offered** (D34/F27). The enum stays whole on purpose;
   narrowing it deletes connections. Written into `connColor.ts`'s own comment so the next person
   to trim the palette finds the reason before the bug.
6. **A UUID's base64 overlap is guarded inside `detectBase64`** (D24), not by keeping a format
   nobody wanted. The arithmetic is in F19 so the guard is never mistaken for dead code.
7. **The console's document result reuses the Mongo document view rather than resembling it**
   (D9/D11) — the third component this codebase has hoisted into `views/shared/` for exactly the
   reason §11 exists, after `DateTimePicker.vue` (P31) and the seven `page/` modules (P39).

---

## 9. Open questions for the user

1. **Item 8 — should `Ctrl/Cmd+A` also select the whole grid?** D17 adds only the corner click,
   because the chord already means "select all" inside an inline cell editor and inside the cell
   editor's CodeMirror, and deciding which one wins is a focus-scope question, not a grid question.
   One sentence from you turns it into a decision.
2. **Item 16 — is losing keyboard operability on the format picker acceptable?** D27 has to replace
   the native `<select>` for per-format hover text to exist at all (F22), and this app's one menu
   component has no arrow-key handling. The alternatives are: accept it for now (the plan's
   choice, §8 item 3), give `ContextMenu.vue` keyboard navigation for every menu in the app in this
   phase, or drop item 16 and keep the `<select>`.
3. **Item 21 — six hues plus grey, or five with wider spacing?** D35 keeps six at a 42° minimum
   gap; five (`orange, olive, cyan, indigo, magenta`) reaches 62° but gives up red, green and blue
   as names. If connection colours are mostly prod/staging/dev in your own use, six is right; if
   you routinely run more than six connections at once, neither number helps and the answer is a
   second dimension (a shape or a letter on the rail), which is a different feature.
4. **Item 4 — should a console document result start expanded, like the Mongo data tab does?**
   D11 starts collapsed because a `find()` result is usually skimmed for shape and expanding 200
   documents by default is a very tall list. Say the word and it matches the data tab instead.
5. **Item 22 — should the filter toggle apply to a partial scan?** D38 makes it wait for the
   complete answer so rows never vanish and reappear under you. The opposite (filter live, list
   grows as the scan proceeds) is one deleted condition if you would rather see something sooner.
