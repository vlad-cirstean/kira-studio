# P89 — FK preview action layout, SQL format-button regression

`docs/v1.8/SPEC.md`'s P89 row (`:163`), turned into concrete steps. Everything below was read in the
current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `ba769986`, P71-P88 landed); every line
number is from that tree.

Two unrelated bugs, two independent commits. Nothing shared between them — no ordering constraint,
no shared file.

No new dependency. No Go change, no contract change, no migration, no new settings leaf.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is the `formatNote` comparison stale? | **No.** `originalText` is captured synchronously at press time and is correct. The stale thing is the **editor**: a format result equal to the last value written to `localDoc` never reaches Monaco, so the document keeps the user's unformatted text while the store holds formatted text. The *next* press then compares formatted against formatted and legitimately reports "already formatted" | §5 |
| Is `formatConsoleText`/`splitSqlStatements` treating re-indented input as normalized? | **No.** `format.ts` is pure, memoises only the dynamic `import()` (`:18`-`:22`), and returns its input verbatim only for whitespace-only/zero-statement documents. It is not the bug | §5.4 |
| Does dropping "Edit this record" orphan `editReferencedRow`? | **No.** `menu.ts:127` stays exported and stays called by `fkEditItem` (`menu.ts:186`), the cell context menu's "Edit referenced row" item. Only the popover's import, handler, button and one stale comment go | §2 |
| Sticky header, or flex header + scrolling body? | **Flex.** `.fk-preview` stops scrolling; `.fk-preview-body` scrolls. No new pattern, no sticky/opaque-background hazard | §3 |
| Any unit test? | **None.** Both fixes are Vue reactivity/DOM layout, which `CLAUDE.md`'s bar excludes and a `bun test` harness cannot reach. Coverage goes in the existing Playwright UI specs | §7 |
| Does the existing "Format twice" test still hold? | **Yes.** After the fix a second press on genuinely-formatted text is still a byte-identical no-op and still shows the note | §6.2 |

---

# Part A — FK preview popover layout

## 1. What the popover looks like now

`apps/kira-studio/frontend/src/views/grid/FkPreviewPopover.vue`, one root panel with three stacked
children (`:146`-`:204`):

1. `.fk-preview-header` — qualified table name plus an optional "N of many matching rows" chip.
2. `.fk-preview-body` — spinner, error chip, "No matching row", or the previewed row as a
   two-column `<table>`.
3. `.fk-preview-actions` — "Open in new tab" and "Edit this record".

`.fk-preview` itself carries `overflow-y: auto` (`:221`) plus `max-height: var(--kira-float-max-h)`
(`:219`), so **the whole panel scrolls as one**. A wide row with many columns pushes the action row
past the fold, which is the reported bug.

`--kira-float-max-h` / `--kira-float-max-w` are inline styles written onto this element by
`theme/floatingPosition.ts`'s `size()` middleware (`:81`-`:82`); `.p-float` already sets
`overflow: hidden` (`theme/primitives.css:712`).

## 2. Delete "Edit this record"

Popover-side, all in `FkPreviewPopover.vue`:

- `:10`-`:15` — drop `editReferencedRow` from the `./menu` import. `FkNavContext`,
  `foreignKeyValueFilter` and `qualifiedNameForPath` stay (all three still used).
- `:114`-`:117` — delete `onEditClick()` whole.
- `:196`-`:203` — delete the `AppButton` with `data-testid="fk-preview-edit"`, including its
  `v-if="!(state.status === 'ready' && state.rows.length === 0)"` guard. Nothing else reads
  `state.rows.length === 0` for this purpose; the `fk-preview-empty` strip (`:163`-`:168`) has its
  own independent condition and stays.

Ancestors: **nothing to remove.** The popover takes `openInNewTab` as a prop (`:38`) but reached
Edit by calling `editReferencedRow` directly, so there is no emit, prop or parent handler to
unwire. `SlickGridHost.vue` passes no edit-related prop.

One stale comment to correct, not delete — `views/grid/menu.ts:173`-`:175`:

```
// P67 §5.1: mirrors fkNavItem above one for one (same disabled predicate, same id convention) so
// the cell menu's mirror action and the preview popover's own "Edit this record" can never
// disagree about what's editable.
```

Reword so it no longer claims a popover counterpart — the item is now the *only* edit entry point,
and `fkNavItem` is still what it mirrors structurally. Keep it to one or two lines.

`menu.ts:127`'s `editReferencedRow` and `fkEditItem` (`:176`-`:188`) are otherwise untouched.

## 3. "Open in new tab" always visible

Move the action row **above** the body and make the body the only scroller. Standard flex column,
same shape `PopoverPanel.vue` and `ContextMenu.vue` already use for a float that can overflow — no
`position: sticky` (which here would need an opaque background over `.p-float`'s elevated surface to
avoid the scrolled row bleeding through, and buys nothing over flex).

Template (`:146`-`:204`) — reorder to header, actions, body. The actions block becomes:

```html
<div class="fk-preview-actions">
  <AppButton data-testid="fk-preview-open" icon="arrow-right" @click="onOpenClick">
    Open in new tab
  </AppButton>
</div>
```

CSS:

- `.fk-preview` (`:216`-`:224`) — **delete** `overflow-y: auto;`. `.p-float`'s own
  `overflow: hidden` then applies, which is what keeps the rounded corners clipping the scrolling
  body. Leave `max-height`/`max-width`/`display: flex`/`flex-direction: column` as they are.
- `.fk-preview-header` (`:226`-`:233`) — add `flex: 0 0 auto;`.
- `.fk-preview-actions` (`:290`-`:295`) — add `flex: 0 0 auto;` and change `border-top` to
  `border-bottom` (it now sits above the body, not below it).
- `.fk-preview-body` (`:242`-`:245`) — add `flex: 1 1 auto; min-height: 0; overflow-y: auto;`.
  `min-height: 0` is load-bearing: without it a flex child refuses to shrink below its content
  height and the panel overflows its own `max-height` instead of scrolling.

Positioning is unaffected. `computeFloatPosition` measures the panel's border box, whose natural
height (header + actions + body content, clamped by `max-height`) is what it was before; the
`watch(state, () => void position())` re-measure at `:94` still runs when content lands.

Verify by hand (§7): a `products` preview with enough columns to overflow shows the button pinned
under the header while the row scrolls beneath it.

---

# Part B — the Format regression

## 4. The two-source-of-truth setup (not itself a bug)

`views/console/ConsoleView.vue`, P18 D20 (`:281`-`:288`):

- `localDoc` — a `shallowRef` bound to `MonacoHost`'s `:doc` prop (`:700`). It is **only** written on
  an *external* text replacement; deliberately not on a keystroke, because the template reads it, so
  writing it per keystroke re-runs this view's whole render effect (toolbar, strips, status line,
  every mounted `ConsoleResultGrid`) — the regression D20 removed.
- `lastEmitted` — a plain (non-reactive) variable holding the text Monaco last emitted, used to tell
  a self-echo from a genuine external write.

Keystroke path: `onDocChange` (`:304`-`:308`) sets `lastEmitted`, calls `setText`, resets the
strips. It does **not** touch `localDoc`.

External path: the `props.tab.state.text` watcher (`:310`-`:317`) skips the echo
(`text === lastEmitted`) and otherwise assigns `localDoc.value = text`, which `MonacoHost`'s own
`props.doc` watcher (`editor/MonacoHost.vue:479`-`:503`) turns into a guarded, undo-bracketed
`pushEditOperations` write.

So far so good. Note what the setup implies: **`localDoc` holds the last externally-written text,
not the editor's current content.** After any format, those two differ the moment the user types.

## 5. Root cause

`localDoc` is a `shallowRef<string>`. Vue triggers on `hasChanged` (`Object.is`), so assigning a
string equal to the ref's current value is a **no-op — no dep trigger, so `MonacoHost`'s `doc`
watcher never runs and the editor is never written.** That is the whole bug: the store advances,
the editor does not.

### 5.1 Deterministic repro (format, undo, format)

| Step | editor | `localDoc` | `lastEmitted` | `tab.state.text` |
|---|---|---|---|---|
| type `select a,b from t` (= `P`) | `P` | initial | `P` | `P` |
| press Format | `F` | `F` | `P` | `F` |
| Ctrl+Z (Monaco emits, `onDocChange`) | `P` | `F` | `P` | `P` |
| press Format | **`P`** | `F` | `P` | `F` |
| press Format again | **`P`** | `F` | `P` | `F` |

Row 4: `onFormat` computes `result.text = F`, calls `setText(F)`. The watcher fires (`F !==
lastEmitted`), assigns `localDoc.value = F` — **already `F`, no trigger** — so Monaco keeps showing
`P`. Format looks dead.

Row 5: the user presses again. `originalText = props.tab.state.text = F`, the formatter is
idempotent, `result.text === originalText` → the note fires, while the editor visibly shows
unformatted text. Every subsequent press repeats it until the user types another character.

### 5.2 Why the user hits this constantly

`keywordCase: 'preserve'` (`format.ts:49`-`:55`) means Format only ever rewrites whitespace. So the
edits a user makes *in order to press Format again* — re-indenting, joining lines, undoing the last
format — are exactly the edits whose formatted form equals the previous format result, i.e. equals
`localDoc`. Loading the same saved query twice around an edit (`ConsoleSavedMenu.vue:65`, the other
`setText` caller) has the identical failure mode.

### 5.3 Second, latent defect on the same line

`onFormat` never updates `lastEmitted` after `setText(result.text)` (`:384`), and neither does the
watcher. After a format, `lastEmitted` describes text the editor no longer holds. Today that is
benign (it is what lets the watcher proceed at all), but it makes the echo guard describe the wrong
document. The fix below moves the update into the watcher, where it belongs: right after the write
that puts that exact text into the editor.

### 5.4 What is *not* wrong

- `originalText` (`ConsoleView.vue:372`) is read synchronously at press time. Correct.
- `formatConsoleText` is pure. Its module-level `sqlFormatterModule` (`format.ts:18`) memoises the
  dynamic `import()`, never a result.
- `splitSqlStatements` re-splits the text it is given each call.
- The note's condition is right; it just fires on a document the user cannot see.

## 6. The fix

### 6.1 `editor/MonacoHost.vue` — an imperative external write

Factor the `props.doc` watcher body (`:479`-`:503`) into a named function and expose it, so a caller
can push text that the prop-diff alone would swallow. Monaco's own `doc === model.getValue()` guard
stays inside it, so both entry points are idempotent and only one undo boundary is ever pushed.

```ts
// The prop alone cannot express "write this again": `doc` is a string, so a value equal to the one
// already bound triggers no watcher, and the editor keeps text the owner has since replaced
// (P89 §5). `setDoc` is that same write, reachable imperatively.
function applyExternalDoc(doc: string): void {
  if (!editor || !model) return;
  if (doc === model.getValue()) return;
  /* ...existing watcher body verbatim, from `const currentPosition` to the else branch... */
}
```

- Watcher becomes `watch(() => props.doc, (doc) => applyExternalDoc(doc));`.
- `defineExpose` (the object closing at `:477`) gains `setDoc: applyExternalDoc,` alongside
  `setCursor`. The `if (!editor || !model) return` guard is what makes a pre-mount call safe: the
  model is created from `props.doc` at mount (`:396`), which is still correct.

No other `MonacoHost` consumer changes — this is an addition.

### 6.2 `views/console/ConsoleView.vue` — push through it

- `:271` — widen the `editorHost` ref's type to
  `{ focus: () => void; setCursor: (pos: number) => void; setDoc: (text: string) => void } | null`.
- `:310`-`:317` — the watcher becomes:

```ts
watch(
  () => props.tab.state.text,
  (text) => {
    if (text === lastEmitted) return;
    // The editor is about to hold exactly this, so the echo guard must say so — otherwise the next
    // keystroke is compared against text the editor no longer has.
    lastEmitted = text;
    // Keeps the prop honest for a remount/the pending <pre>; may be a no-op when this text was
    // already pushed once, which is exactly why the write below cannot be left to it (P89 §5).
    localDoc.value = text;
    editorHost.value?.setDoc(text);
    resetStalePreviewState();
  },
);
```

Ordering note, deliberate: `setDoc` runs synchronously, so it applies the edit before the (`pre`
flush) `localDoc` watcher inside `MonacoHost` gets scheduled; that watcher then finds
`doc === model.getValue()` and returns. One write, one undo boundary — the
"Format immediately after typing, then undo" test (`tests/ui/console-format.spec.ts:497`-`:530`)
keeps passing for the same reason it passes today.

`onFormat` (`:364`-`:414`) needs **no change**: `setText` now genuinely reaches the editor, the
caret-by-index remap at `:385`-`:389` still runs on the next tick after the write, and
`result.text === originalText` now only holds when the visible document really is already formatted.

### 6.3 The note's wording

`ConsoleView.vue:409`-`:410` ends with "(ClickHouse identifiers)" on every SQL console, including
Postgres/MySQL/SQLite/MariaDB, where it names a database the user is not connected to. One line,
zero risk, and it is the exact string this phase is here about. Make the parenthetical
ClickHouse-only:

```ts
formatNote.value =
  kind === 'clickhouse'
    ? 'Already formatted — indentation only; keywords keep the case you typed (ClickHouse identifiers).'
    : 'Already formatted — indentation only; keywords keep the case you typed.';
```

`kind` is already in scope (`:365`). The existing assertion uses `toContainText` on the prefix
(`console-format.spec.ts:334`-`:336`) and stays green. If the implementing agent finds any test
asserting the full string exactly, keep the string as-is and drop this sub-item — it is a wording
correction, not part of the fix.

---

## 7. Tests

### 7.1 `tests/ui/interaction.spec.ts` — FK preview

- `:1649`-`:1682` ("P67 §7 case 3") currently drives the deleted button at `:1656`. **Do not delete
  the coverage** — `editReferencedRow` still ships behind the cell menu. Re-point the block at that
  entry point: `await rightClick(gridCell(page, 0, 'product_id'));` then click
  `[data-testid="menu-item-edit-referenced-<fk name>"]`. The id prefix is `edit-referenced-` plus
  the FK's own `name` (`menu.ts:180`); `:1629`-`:1632` in this same test already asserts such an id
  exists via `menuItemIds(page)`, so read the name from there rather than hard-coding it. Everything
  after the click (new tab, caret on `name`, the staged `"Deluxe Widget"` edit) is unchanged. Update
  the block's comment to say the cell menu, not "Edit this record".
- `:1710`-`:1711` — the empty-preview case asserts `fk-preview-edit` has count 0. Delete that line
  (vacuous now) and keep the `fk-preview-open` count assertion at `:1712`.
- `:1574` and `:1689` drive `fk-preview-open` and are unaffected.

### 7.2 `tests/ui/console-format.spec.ts` — the regression

Add one test next to the existing undo test (`:497`-`:530`), reusing its fixture/connection shape
with a fresh `CONNECTION_ID`. It fails on the current tree at the first `expect.poll` and passes
after §6:

```
type 'SELECT a,b FROM t WHERE a=1'
click console-format          -> poll consoleText matches /^SELECT\n/
click .view-lines, Ctrl+Z     -> poll consoleText toBe the original one-liner
click console-format          -> poll consoleText matches /^SELECT\n/   (the bug: stays one-line)
                              -> expect console-format-note toHaveCount(0)
```

`consoleText`, `typeInto` and `openConsoleFromMenu` are already imported in that file. Head the test
with a two-line comment naming the cause (an external write equal to the last one written to
`localDoc` never reached Monaco), in this repo's style.

Leave `:302`-`:337` ("Format twice") alone — it types once, formats twice with no edit between, so
both presses behave exactly as before.

### 7.3 Nothing else

No unit test (`CLAUDE.md`'s bar — reactivity wiring and CSS, neither reachable from `bun test`). No
visual snapshot: `tests/visual/console.spec.ts` asserts behaviour only (`:10`), and no visual spec
covers the FK popover.

## 8. Commits

Two, in either order, each self-contained:

1. `fix(grid): pin the FK preview's open action above the scrolling row, drop its edit action`
   — Part A plus §7.1.
2. `fix(console): make Format reach the editor when the result repeats the last external write`
   — Part B plus §7.2.

Conventional Commits, and each message ends with the two attribution lines this session uses.

## 9. Verification

Per commit (fast, cheap):

- `bun run typecheck`
- `bun run lint`
- `bun run build`

Once, near the end of the phase (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `bun run build:test`, then the two touched specs only, e.g.
  `playwright test --config=apps/kira-studio/playwright.config.ts --project=ui -g "Format"` and the
  interaction spec's FK test by name. The `ui` project runs **webkit**
  (`playwright.config.ts:49`), which this container does not preinstall — see
  `docs/DEV_ENVIRONMENT.md:336`-`:341` for `bunx playwright install webkit` plus the exact system
  libraries to install. Run the full `bun run test:ui` if time allows; the two specs are the ones
  that can regress.
- Manual, in `bun run dev`, for the two things Playwright does not assert:
  1. Open a FK preview on a row with enough columns to overflow the popover's max height. "Open in
     new tab" stays visible under the header while the row scrolls; no clipped corner, no double
     scrollbar.
  2. In a SQL console: type an unformatted query, Format, mangle the indentation by hand, Format
     again — the document re-indents and no note appears. Then press Format once more with no edit —
     the note appears. Check the caret still lands in the statement it was in.

Do not commit a screenshot or a findings document; the commit log is the record.

## 10. Out of scope

- `formatConsoleText`'s own behaviour, `keywordCase`/`identifierCase`, the terminator handling
  (P22b D12) — all correct, all untouched.
- The `localDoc`/`lastEmitted` split itself. §6 fixes the write path; collapsing the two sources into
  one would reintroduce the per-keystroke render D20 measured and removed.
- Any other `MonacoHost` consumer, the cell editor, and the FK preview's fetch/positioning paths.
