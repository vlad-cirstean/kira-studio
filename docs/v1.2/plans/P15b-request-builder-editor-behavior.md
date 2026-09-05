# P15b — request-builder UX, part 2: input and editor behaviour

> **What this phase is.** The second half of `docs/v1.2/SPEC.md`'s P15 row — the four items that
> are editor behaviour rather than presentation: header-name autocomplete (7), `{{variable}}`
> colouring + hover value + autocomplete (10), auto-closing bracket/quote pairs (11), and arrow-key
> navigation across the request tables (12). Part 1
> (`docs/v1.2/plans/P15-request-builder-ux.md`) covers the other eight and §0.3 there records why
> the batch is split.
>
> **The SPEC row hands this file one question by name**: whether the `{{variable}}` work *"extends
> `AutocompleteField.vue`'s existing overlay mechanism … or a different one is warranted."* §2 D3
> answers it: **it extends it**, and the two things the overlay genuinely cannot do (a resolved
> *value*, and a per-token hover inside a native `<input>`) get the two smallest mechanisms that
> close them — one new pure classifier in `@kira/api-core`, and one field-local floating tooltip
> built on `theme/floatingPosition.ts`'s existing `pointReference`. No second editor, no
> re-architecture of the substitution pipeline.
>
> **Base commit.** Read against `a4c8e4d` (branch `claude/feature-v1-2`), the same base part 1 uses.
> Every file:line citation points at that commit. **This phase is planned against part 1 having
> landed** — part 1's M3 (`:deep(.p-input) { width: 100% }` in the row tables) and M7 (the URL
> field's wrapper) are assumed present; nothing else from part 1 is a prerequisite.
>
> **The precedent this matches.** `docs/v1.1/plans/P18-sql-language-server-explain.md` (this app's
> only prior "real editor behaviour" phase — completion sources, hover sources and diagnostics
> plugged into `CodeMirrorHost` through pure text-in/data-out props, never an `EditorView` at the
> call site), plus `P13-api-ui-check.md`'s finding→decision→commit shape.

---

## 0. Scope

### 0.1 The four items

| # | Item | Commit |
|---|---|---|
| 7 | Header-name autocomplete over the well-known HTTP header vocabulary | N4 |
| 10 | `{{variable}}` resolved/unresolved colouring, hover showing the resolved value, autocomplete over known names | N1, N2, N3 |
| 11 | Auto-closing bracket/quote pairs | N5 |
| 12 | Arrow-key navigation across headers/params/form-data rows | N6 |

### 0.2 Files this phase touches

| File | Items |
|---|---|
| `packages/api-core/src/http/substitute.ts` | 10 (spans grow offsets; one shared classifier) |
| `packages/api-core/src/http/headers.ts` *(new)* | 7 |
| `packages/api-core/src/index.ts` | 7, 10 (exports) |
| `apps/kira-studio/frontend/src/editor/variableHighlight.ts` *(new)* | 10 |
| `editor/CodeMirrorHost.vue` | 10 (`rangeHighlights` prop, `posAtCoords` expose), 11 (`autoCloseBrackets` prop) |
| `editor/theme.ts` | 10 (three `.cm-kira-var-*` rules) |
| `theme/primitives/completion.ts` | 7, 10 (two pure tokenizers) |
| `theme/primitives/AutocompleteField.vue` | 7, 10 (highlight passthrough, pluggable tokenizer, token hover) |
| `theme/primitives/VariableTooltip.vue` *(new, or a block inside `AutocompleteField`)* | 10 |
| `theme/wrapSelection.ts` | 11 (auto-close with a collapsed caret) |
| `views/httprequest/variableCompletion.ts` *(new)* | 10 |
| `views/httprequest/HttpRequestView.vue` | 10 (URL field) |
| `views/httprequest/FieldRowsTable.vue` | 7, 10, 12 |
| `views/httprequest/RequestHeadersTable.vue` | 7 |
| `views/httprequest/RequestBodyPane.vue` | 10, 11 |
| `views/grpcrequest/MetadataTable.vue` | 12 |
| `apps/kira-studio/tests/ui/*.spec.ts`, `packages/api-core/test/*` | §4 |

### 0.3 Out of scope, explicitly

- **Everything in part 1.** The two plans touch disjoint files with two exceptions
  (`FieldRowsTable.vue` and `HttpRequestView.vue`), and in both the parts are disjoint too — part 1
  edits their `<style>` and slot placement, this phase their handlers and props.
- **A second CodeMirror instance replacing any `<input>`.** `AutocompleteField.vue:14-26` records
  the reason at length (`locator.fill()` only works on a real `input`/`textarea`/`contenteditable`,
  and every SQL/Mongo engine spec depends on it). That reasoning applies verbatim to the URL and
  header fields, which `http-curl.spec.ts`, `http-dynamic-values.spec.ts` and `collections.spec.ts`
  all `page.fill()` today.
- **Changing the substitution engine's grammar, precedence or classification rules.**
  `packages/api-core/src/http/substitute.ts` is pinned to Go's `internal/apivars/resolve.go` by a
  shared corpus (`internal/apivars/testdata/substitution.json`, read by both a Go test and
  `http-substitution.spec.ts`). N1 adds two fields and one function; it changes no rule.
- **Revealing a secret's value anywhere.** F5 is explicit: a secret's plaintext never enters the
  renderer (P5 D5/D6), so the hover for a secret reference says *what will happen*, never a value.
- **Auto-close inside the SQL/Mongo/Redis console.** `editor/wrapSelection.ts:5-11` declined
  `closeBrackets()` for a specific, still-valid reason (D5 restates it); this phase enables it only
  where that reason does not apply.
- **gRPC's message editor and metadata autocomplete.** Item 12's arrow navigation reaches
  `MetadataTable.vue` because it is a literal copy of the table being fixed; nothing else about the
  gRPC view changes.

---

## 1. Findings

### F1 — `AutocompleteField.vue` already is the mechanism, minus three things

`theme/primitives/AutocompleteField.vue` (421 lines, read in full) is a `.p-input`-shaped
drop-in for `TextField` that owns a real `<input>` and adds:

- **a read-only `CodeMirrorHost` painted behind that input** (`:258-267`), `pointer-events: none`,
  `inset: 0`, with the real input's text made `color: transparent` and only its caret/selection
  visible (`:363-373`). `:328-333` states the one property the trick depends on: *"`kira-font-family`
  is a monospace stack (tokens.css), so the overlay's character grid lines up with the native
  input's own character-for-character."* Scroll is mirrored from the input onto `.cm-scroller`
  (`:203-213`);
- **a hand-rolled completion popup** — `position: fixed`, positioned from the input's own rect
  (`:106-111`, with `:102-105` explaining why not Teleport/absolute), ranked by
  `rankCandidates` (`completion.ts:39-51`), Tab always accepts, Enter only after an explicit arrow
  (`:75-81`), Ctrl/Cmd-Space lists everything (`:161-171`), closes on blur/resize/scroll
  (`:215-241`);
- **selection-wrapping on a typed bracket/quote** (`:154-160` → `theme/wrapSelection.ts`).

Three gaps between that and item 10:

1. **Colour comes from a *grammar*, not from data.** The overlay's colours come from
   `languageExtension(id)` (`editor/languages.ts:166-185`) + `kiraHighlightStyle`. "Resolved vs
   unresolved" is not a property of the text — it is a property of the text *and* the current
   collection/environment variable set. No `EditorLanguageId` can express it, and adding a
   `StreamLanguage` that closes over a mutable module-level variable set would be a grammar lying
   about what it is.
2. **The completion token is a fixed rule.** `completion.ts:25-31`: `WORD_CHAR_RE =
   /[A-Za-z0-9_$.]/`, walking back from the caret. It has no `-`, so in a header-name field typing
   `Content-T` yields the token `T` starting *after* the hyphen — accepting `Content-Type` would
   produce `Content-Content-Type`. It also has no `{`, so inside `{{ba` the token is `ba`, which
   happens to be usable but cannot tell "inside a reference" from "ordinary text".
3. **There is no hover at all.** The overlay is `pointer-events: none` by construction, so
   CodeMirror's own `hoverTooltip` can never fire on it — every pointer event belongs to the real
   input sitting on top.

### F2 — `CodeMirrorHost` already has the seam for two of the three, and none for the third

`editor/CodeMirrorHost.vue` takes capability props and holds each in a `Compartment`, reconfigured
by a watcher: `lintSource` (`:44-45`, *"pure text in, diagnostics out — the host owns
`linter()`/its compartment/its theming, so a caller never imports `@codemirror/lint`"*),
`hoverSource` (`:46-50`, a ready `HoverTooltipSource` built by `editor/hover.ts`'s
`buildHoverSource`), `completionSources` (`:37-41`), plus `singleLine` (`:51-55`) for exactly the
`AutocompleteField` overlay case.

So **hover in a multi-line body editor already works** — `hoverSource` is an existing prop with an
existing builder, and `hover.ts:23-47` is deliberately generic over what it looks up. What has no
seam is **painting arbitrary ranges**: every colour in the host today comes from
`syntaxHighlighting(kiraHighlightStyle)` over a parsed grammar, and there is no way for a caller to
say "paint these character ranges with this class".

### F3 — Auto-close genuinely does not exist, in either implementation, and one of them says why

Both files were read in full:

- **`editor/wrapSelection.ts:21-37`** — an `EditorView.inputHandler` that returns `false` when
  `from === to` (`:22`). Its header comment (`:4-11`) is the load-bearing part:
  > *"Deliberately narrower than `@codemirror/autocomplete`'s own `closeBrackets()`: that extension
  > also auto-closes an empty selection (typing a bare `'` inserts `''`), which silently 'fixes'
  > what the console's own lint (D24, `resolveLint` in CodeMirrorHost.vue) exists to catch — an
  > unterminated string literal never gets a chance to look unterminated."*
- **`theme/wrapSelection.ts:20-40`** — the plain-`<input>` twin, same collapsed-selection bailout
  (`:28`), attached by `TextField.vue:75` and `AutocompleteField.vue:159`.

So the SPEC row's item 11 is real work, not a flag flip — but the reason it was declined is
**console-specific**, and `lintSource` is passed by exactly one caller. `grep -rn "lint-source\|:lintSource"`
across `frontend/src` returns only `views/console/ConsoleView.vue`; the request body editor
(`RequestBodyPane.vue:120-133`) passes none. `@codemirror/autocomplete@6.20.3` is already a
dependency (root `package.json` devDependencies), so `closeBrackets()` costs nothing to adopt where
it is correct — which is `AGENTS.md`'s library-first rule applied literally.

Both files also share one rule worth preserving: a *whole-document/whole-field* selection is a
"replace everything" gesture, not a wrap (`editor/wrapSelection.ts:28`, `theme/wrapSelection.ts:32`,
both citing `mongo.spec.ts`'s select-all-and-retype flow).

### F4 — The four request tables are one component, and nothing in them handles a key

`FieldRowsTable.vue` backs Params, Headers, urlencoded and form-data (`:6-11`); rows are plain
`div.field-row` flex rows (`:58-102`) holding a checkbox, `TextField`s in `.field-cell`s, optional
slotted trailing controls and a remove `IconButton`. There is no `@keydown` anywhere in the file,
and no `tabindex` — Tab already walks the fields in DOM order because they are real inputs.
`views/grpcrequest/MetadataTable.vue` is the same shape, duplicated deliberately (`:9-12`: the
biome rule forbids `views/grpcrequest/**` importing `views/httprequest/**`).

**SlickGrid has nothing transferable here.** Its cell navigation lives inside the grid's own
`SlickGrid` instance (`views/grid/slick/`), keyed to its viewport/row-model; these are six-to-ten
DOM rows of real inputs. The right size of solution is a `keydown` handler on the container, and
the app already has the precedent for exactly that: `api/VariableRow.vue:85-96` handles
Alt+↑/↓ on a row to reorder it (*"a drag-only affordance is unusable from the keyboard"*).

One collision to design around, not discover later: `AutocompleteField`'s popup binds ArrowUp/
ArrowDown while open (`:173-184`) with `e.preventDefault()` and **no** `stopPropagation`, so a
container-level handler will see those events too. `e.defaultPrevented` is the guard.

### F5 — The resolved value is already computed on the renderer side, once per keystroke, and secrets are deliberately absent from it

`HttpRequestView.vue:158-170` already does, for its unresolved-count chip:

```ts
const { values, secretNames } = mergedValuesAndSecrets(collectionId.value, activeEnvironmentId.value);
const refs = resolveTabState(props.tab.state, values, secretNames).refs;
```

- `mergedValuesAndSecrets` (`api/state/variables.ts:219-233`) is **synchronous**, reading the
  environment-over-collection merged cache (`:200-217`), and it returns `values` (plaintext,
  non-secret only) and `secretNames` (names only). `ensureVariablesLoaded` is already fired on
  mount and on collection/environment change by `HttpRequestView.vue:150-157`.
- `resolve` (`packages/api-core/src/http/substitute.ts:57-120`) classifies every reference into
  `resolved | deferred | dynamic | unknown` (`:15`) with a fixed precedence: `$`-prefixed →
  dynamic (generated only when a generator is passed, which the live preview never does —
  `HttpRequestView.vue:144-148`), then secrets → `deferred`, then `values` → `resolved`, else
  `unknown`.
- **A secret's plaintext never reaches the renderer at all** (P5 D5/D6, restated at
  `substitute.ts:28-31` and `variables.ts:245-250`) — `deferred` exists precisely so Go finishes
  the substitution after the reveal gate.

So "the hover needs the resolved value" needs **no** new pipeline: the data is one synchronous call
away in the component that already makes it. What is missing is *positions* — `resolve` returns
`refs: {name, kind}[]` with no offsets, and `splitTemplateSpans` (`:165-185`) returns spans with
text and an `isReference` flag but, again, no offsets. Both walk the identical grammar
(`:69-119` and `:168-184`), so the fix is additive rather than a third walker.

### F6 — There is no header-name vocabulary anywhere in the repo

`grep -rin "user-agent\|cache-control" packages/ apps/kira-studio/frontend/src` finds only
`userContentTypeHeader` (`api-core/src/http/body.ts:76-82`, which looks for one name) and Go's own
canonicalisation. Nothing enumerates header names. `RequestHeadersTable.vue:26` passes
`name-placeholder="Header-Name"` and that is the entire affordance.

The two existing completion vocabularies show the shape to copy:
`views/grid/filterCompletion.ts` and `views/documents/filterCompletion.ts` both build
`Completion[]` (`completion.ts:7-20`: `label`, optional `insert`, `detail`, `icon`,
`caretOffsetFromEnd`) — curated lists, `detail` carrying a one-word category, `icon` from
`theme/icons.ts`'s existing set.

### F7 — The app's tooltip singleton cannot serve a *token-level* hover, for two independent reasons

Recorded because "just use `v-tooltip`" is the obvious first idea and it does not work:

1. **Hit-testing is per element.** `workbench/state/tooltip.ts:157-167`'s `processPointer`
   early-returns when `target === lastPointerTarget` — moving the pointer *within* one input never
   re-resolves a host, so an attribute that appears mid-hover (because the pointer crossed onto a
   `{{ref}}`) is never picked up. And when it does open, `openFor` (`:114-124`) anchors to
   `el.getBoundingClientRect()` — the whole field, not the token.
2. **The import is banned.** `biome.json` forbids `apps/kira-studio/frontend/src/views/**` and
   `api/**` from importing `workbench/**` (SPEC §11 and P12 D16(a)), and `theme/` importing
   `workbench/` would invert the layering (`workbench/` imports `theme/`, not the reverse).
   `SlickGridHost.vue`/`ConsoleSlickGrid.vue`'s existing workaround — writing the
   `data-kira-tip` attribute directly, never importing the module (`tooltip.ts:97-103`) — solves
   only reason 2, not reason 1.

`theme/floatingPosition.ts` is the sanctioned alternative and is already in `theme/`:
`computeFloatPosition(reference, floatingEl, opts)` over `@floating-ui/dom` (`:40-55`) plus
`pointReference(x, y)` (`:60-73`), *"floating-ui's own escape hatch"* for anchoring to a point
rather than an element — which is exactly a character offset inside an input.

---

## 2. Decisions

### D1 — Template spans grow offsets, and one shared classifier lands beside `resolve` (item 10)

In `packages/api-core/src/http/substitute.ts`:

```ts
export interface TemplateSpan {
  text: string;
  isReference: boolean;
  from: number;   // NEW — offset into the input text
  to: number;     // NEW
  name: string;   // NEW — the trimmed name, '' for a literal span
}

/** The classification `resolve` would give this name, without resolving anything — same
 *  precedence, stated once. */
export function classifyReference(
  name: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
): ReferenceKind;
```

`splitTemplateSpans` already walks the grammar and already computes `open`/`close`/`name`
(`:168-184`); the three fields are values it discards today. Existing callers (`url.ts`'s
`buildQuery`, `escape.ts`'s `goQueryEscape`) read only `text`/`isReference` and are unaffected.

`classifyReference` is extracted from `resolve`'s own branch order (`:89-116`) and **called by
`resolve`**, not copied out of it — that is the whole point: the highlighter, the hover and the
send path must agree about what "unknown" means, and `internal/apivars/resolve.go` is pinned to
this file by the shared corpus (`substitute.ts:8-10`). The existing corpus test
(`packages/api-core/test/http-substitution.spec.ts`) passing unchanged is the proof the refactor is
inert.

Both, plus `splitTemplateSpans`, are added to `packages/api-core/src/index.ts` — the package's
public surface, which today exports `resolve`/`sanitizeUrlSpan` but not the span splitter.

**Why not classify in the frontend**: because `packages/api-core` is where `biome.json` says
Api-specific, DOM-free logic lives (P12 D16(e)), and because a second implementation of "is this
name known" is precisely the drift `substitute.ts:160-163`'s own finding-16 comment describes for
the same grammar.

### D2 — `CodeMirrorHost` gains one generic seam: paint these ranges (item 10)

```ts
/** Pure text in, ranges out — the exact shape `lintSource` already keeps (F2). Each range is
 *  painted with `Decoration.mark({class})`. The host never learns what a range means. */
rangeHighlights?: (doc: string) => readonly { from: number; to: number; class: string }[];
```

Implementation, mirroring the four compartments the host already runs:
`rangeCompartment.of(resolveRangeHighlights())`, where the extension is a `ViewPlugin` holding a
`DecorationSet` rebuilt on `update.docChanged` (and at construction), and a watcher on the prop
reconfigures the compartment when the caller's closure identity changes — byte-for-byte the
`lintSource` pattern (`CodeMirrorHost.vue:162-177`, `:273-279`).

Two robustness rules the plugin owns, so no caller has to:

- **ranges are clamped and dropped**: any range with `to > state.doc.length` or `from >= to` is
  skipped rather than thrown on. A caller computing ranges from a *slightly stale* copy of the
  document (the editable body editor, where the parent re-derives on `update:doc`) must degrade to
  "one keystroke of missing colour", never to a `RangeSet` exception;
- ranges are sorted by `from` before building the set, which `RangeSet.of` requires.

Three classes are added to `editor/theme.ts` beside the existing `.cm-lintRange-*` rules
(`theme.ts:79-86`) — no new tokens, per P13's standing "does not change a value in tokens.css":

| class | meaning | style |
|---|---|---|
| `.cm-kira-var` | resolved | `color: var(--kira-syntax-name)` (`#9cdcfe`, the app's own variable-name colour) |
| `.cm-kira-var-secret` | deferred (a secret, resolved by Go at send) | `color: var(--kira-syntax-name)` + `textDecoration: underline dotted var(--kira-syntax-meta)` |
| `.cm-kira-var-unknown` | unknown, or an uncatalogued `{{$dynamic}}` | `color: var(--kira-warn)` + `textDecoration: underline wavy var(--kira-warn)` |

`--kira-warn` rather than `--kira-error` deliberately: `HttpRequestView.vue:259-266` already renders
unresolved references as a `p-chip warn`, and an unresolved reference is not an error — it may be
about to be typed.

### D3 — `AutocompleteField` extends, it is not replaced (item 10 — the SPEC row's own question)

Four additive changes to `theme/primitives/AutocompleteField.vue`, all optional props that leave
both existing call sites (`FilterToolbar`'s WHERE/ORDER BY) byte-identical:

**(a) `rangeHighlights` passthrough.** Forwarded to the overlay `CodeMirrorHost`, and the overlay's
render condition widens from `highlighted` (`:53`) to `highlighted || !!rangeHighlights`, so a
field with no *grammar* still gets an overlay when it has *ranges*. This is the whole colouring
half of item 10 for the URL and header-value fields: no new painting mechanism, the existing
transparent-input trick, one more source of colour.

**(b) A pluggable tokenizer.** `tokenAt?: (text: string, caret: number) => {from, to, word} | null`,
defaulting to today's `tokenAt` (`completion.ts:27-31`). `completion.ts` gains two pure functions
beside it, both trivially testable with no DOM:

- `wholeFieldToken(text, caret)` — the whole trimmed field as one token, for a field that holds
  exactly one identifier. This is what F1's `Content-T` → `Content-Content-Type` bug needs (item 7).
- `templateToken(text, caret)` — the run between the nearest unclosed `{{` at or before the caret
  and the caret, or `null` when the caret is not inside a reference. `null` closes the popup, so a
  variable field only suggests while you are actually inside `{{…}}` (item 10's autocomplete half).

The component's `recompute` (`:93-100`) becomes: run the tokenizer; a `null` result clears the word
and closes the popup. `accept` (`:137-152`) already splices from `wordStart` to the caret, so both
tokenizers work with it unchanged.

**(c) A token hover.** A `hoverAt?: (text: string, offset: number) => string[] | null` prop plus a
small floating panel in this component:

- on `mousemove` over the input, ask the overlay for the character offset under the pointer —
  `CodeMirrorHost` gains `posAtCoords(x, y)` to its `defineExpose` (`:228-230`, which already
  exposes `focus`). This uses CodeMirror's own coordinate hit-testing on the overlay that is
  already painting the same text at the same coordinates, so it is exact and **font-agnostic** —
  notably it does *not* re-assume the monospace grid that `:328-333` depends on for alignment;
- if the offset resolves to a different token than last time, start a 400 ms timer; on fire,
  position a `.p-float` panel with `computeFloatPosition(pointReference(x, top), el, {placement:
  'bottom-start'})` and render the returned lines. Leaving the input, any keystroke, blur, scroll or
  resize closes it — the same close set the completion popup already uses (`:215-241`);
- no hover machinery exists at all when `hoverAt` is absent, which is every current call site.

**(d) `autoClose` (item 11)** — see D5.

**Why not a different mechanism**, since the SPEC row invites the argument: a real CodeMirror editor
in place of these inputs would give colouring, hover and completion for free — and would break
`page.fill()` in five spec files (`AutocompleteField.vue:14-26` documents this for the two fields it
already serves; `http-curl.spec.ts:43`, `:192`, `:246`, `http-dynamic-values.spec.ts:51`, `:112`,
`collections.spec.ts:170` are the request builder's own instances), lose the native caret/IME
behaviour of a one-line field, and duplicate a popup this component already has. The overlay trick
is three years of this repo's own accumulated answer to that trade; item 10 is exactly the case it
was built for.

### D4 — The Api side supplies the data, in one module, from the call already being made (item 10)

New `views/httprequest/variableCompletion.ts` (Api-side, may import `@kira/api-core` and
`api/state/variables.ts`; may not import `workbench/**` — `biome.json`), exporting one factory:

```ts
export function variableSupport(collectionId: string, environmentId: string): {
  rangeHighlights: (doc: string) => readonly {from: number; to: number; class: string}[];
  hoverAt: (text: string, offset: number) => string[] | null;
  candidates: Completion[];
};
```

built over `mergedValuesAndSecrets` (F5) + D1's `splitTemplateSpans`/`classifyReference`, plus
`isDynamicName` (`api-core`'s dynamic catalogue) for the `{{$…}}` cases. Consumed as a `computed`
in `HttpRequestView.vue` (which already computes `collectionId` and watches
`activeEnvironmentId`, `:149-157`) and passed down to the URL field and — via `FieldRowsTable`'s
props — to the header/param/form-data value cells.

The hover's lines, spelled out because this is where the security rule lives:

| kind | line 1 | line 2 |
|---|---|---|
| `resolved` | the value, truncated at 200 chars | `collection variable` / `environment variable` |
| `deferred` (secret) | `secret — resolved when the request is sent` | *(no value, ever — F5)* |
| `dynamic`, catalogued | `generated fresh on every send` | the catalogue's own description |
| `dynamic`, uncatalogued | `unknown dynamic value` | — |
| `unknown` | `not defined in this collection or environment` | — |

**Which scope a resolved name came from** needs one small addition:
`mergedValuesAndSecrets` (`variables.ts:219-233`) currently flattens both scopes into one record.
The hover's second line wants the scope, so the module either re-reads `cachedVariables('environment',
…)` to test membership (three lines, no API change) or `mergedValuesAndSecrets` grows a parallel
`origin: Record<string, 'collection'|'environment'>`. **Take the former** — the call site that needs
it is one, and widening a store function used by `send()` for a tooltip caption is the wrong
direction of dependency.

### D5 — Auto-close lands where the reason it was declined does not apply (item 11)

Two independent halves, matching the two `wrapSelection` implementations:

**(a) The body editor gets the library's own `closeBrackets()`.** `CodeMirrorHost` gains
`autoCloseBrackets?: boolean` (default `false`, so every existing host is untouched), resolving to
`[closeBrackets(), keymap.of(closeBracketsKeymap)]` from `@codemirror/autocomplete` — already a
pinned dependency (F3), and `AGENTS.md`'s library-first rule makes hand-rolling this a decision that
would need defending rather than the default. `RequestBodyPane.vue` passes `auto-close-brackets` on
both of its editor hosts (`:120-133`).

The console keeps `false`, which preserves `editor/wrapSelection.ts:4-11`'s reason verbatim: the
lint that must be allowed to see an unterminated string literal is `lintSource`-driven, and
`ConsoleView.vue` is its only caller (F3). `editor/wrapSelection.ts`'s comment is updated to say
*where* the exception now applies rather than implying it applies everywhere — the comment is the
durable record and leaving it stale would mislead the next reader.

**(b) The plain `<input>` fields get a collapsed-caret path in `theme/wrapSelection.ts`.** A new
exported `autoClosePairsOnType(e)` beside the existing `wrapSelectionOnType`, sharing `WRAP_PAIRS`
(`:6-13`), handling the three behaviours that make auto-close usable rather than annoying:

1. **collapsed caret + opening char** → insert the pair, caret between them;
2. **typing the closing char immediately before an identical auto-inserted one** → step over it
   rather than inserting a second (`{}` + `}` → `{}`, caret after);
3. **Backspace with the caret between an empty pair** → delete both.

State for (2)/(3) is derived from the text around the caret, not remembered — a per-field "which
brackets did I insert" map is the kind of state that goes wrong on paste/undo.

**Why this is right for the URL field specifically**, which sounds wrong until you write it out:
`{{name}}` is *the* reason a brace is typed in these fields, and rule 1 composes into it exactly —
typing `{` gives `{|}`, typing `{` again gives `{{|}}`, which is the reference the user was going to
type, with the caret where the name goes, and D3(b)'s `templateToken` opens the variable popup right
there. That is the whole of item 10's autocomplete ergonomics falling out of item 11.

`TextField.vue:75` and `AutocompleteField.vue:159` call the new handler alongside the existing one
(selection first — a non-empty selection wraps, a collapsed caret auto-closes; the two can never
both fire for one keystroke).

### D6 — Arrow navigation is one container-level handler, in each of the two row tables (item 12)

On `FieldRowsTable.vue`'s `.field-rows-table` root (and `MetadataTable.vue`'s, its deliberate copy):

| Key | Behaviour |
|---|---|
| `ArrowDown` / `ArrowUp` | move focus to the same column's field in the next/previous row, caret preserved at the same offset (clamped to the target's length). No wrap at either end |
| `ArrowLeft` / `ArrowRight` | **native**, except at a field edge: `ArrowRight` at the very end moves to the next field in the row (caret at 0), `ArrowLeft` at offset 0 moves to the previous (caret at end). Anywhere else it is ordinary text movement |
| `Tab` | untouched — already native, already correct |
| everything else | untouched |

Four rules the handler must obey, each from a real hazard in F4:

- **`if (e.defaultPrevented) return;` first.** `AutocompleteField`'s popup consumes ArrowUp/Down
  while open without stopping propagation (`:173-184`); its Escape/Enter branches do the same. This
  one line is what keeps item 7/10's popup and item 12's navigation from fighting.
- **Only `input` elements participate.** Selects and buttons in a row (form-data's kind select,
  Choose file, the remove button) stay Tab-reachable and are skipped by arrow navigation — arrowing
  into a `<select>` would collide with its own native arrow behaviour.
- **Column identity is positional**, resolved by index among the row's inputs, so form-data's
  extra content-type field in the trailing slot does not shift the mapping for rows that lack it.
- **The trailing blank row is a normal target.** Arrowing down into it is how a keyboard user adds a
  row, which is the same affordance the mouse gets by clicking it.

Implemented as a small `theme/rowKeyNav.ts`-shaped pure helper? **No** — kept as a local function in
each of the two components. They are ~35 lines each, `views/grpcrequest/**` may not import
`views/httprequest/**` (`biome.json`), and the alternative is a third shared module for a
duplication `MetadataTable.vue:9-12` already weighed and accepted deliberately. Recorded as OQ-4.

### D7 — The header vocabulary is a curated static list in `api-core` (item 7)

New `packages/api-core/src/http/headers.ts`:

```ts
/** Request headers a person actually types into a request builder — RFC 9110's own set plus the
 *  conventional non-standard ones. Response-only headers are deliberately absent: this feeds the
 *  *request* headers table. `detail` is the one-word category the completion popup right-aligns. */
export const WELL_KNOWN_REQUEST_HEADERS: readonly Completion[] = […];
```

Roughly 55 entries, grouped by the `detail` they carry:

- **content** — `Content-Type`, `Content-Length`, `Content-Encoding`, `Content-Language`,
  `Content-Disposition`, `Content-Location`, `Content-Range`, `Content-MD5`
- **negotiation** — `Accept`, `Accept-Encoding`, `Accept-Language`, `Accept-Charset`,
  `Accept-Datetime`, `Prefer`
- **auth** — `Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key`, `X-CSRF-Token`
- **caching** — `Cache-Control`, `Pragma`, `If-Match`, `If-None-Match`, `If-Modified-Since`,
  `If-Unmodified-Since`, `If-Range`, `ETag`
- **connection** — `Connection`, `Keep-Alive`, `Upgrade`, `TE`, `Transfer-Encoding`, `Trailer`,
  `Expect`, `Host`, `Via`, `Max-Forwards`
- **cors** — `Origin`, `Access-Control-Request-Method`, `Access-Control-Request-Headers`,
  `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `Sec-Fetch-Dest`, `Sec-Fetch-User`
- **client** — `User-Agent`, `Referer`, `From`, `Date`, `DNT`, `Range`
- **proxy/tracing** — `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
  `X-Request-ID`, `X-Correlation-ID`, `X-Requested-With`, `Idempotency-Key`, `Link`

`icon: 'symbol-field'` on every entry, matching the existing filter vocabularies' use of
`theme/icons.ts`'s symbol set (F6). Canonical `Train-Case` spelling for `label` and `insert`;
`rankCandidates` already case-folds (`completion.ts:36-38`), so typing `content-t` still matches.

Wiring: `FieldRowsTable.vue` gains `nameCandidates?: Completion[]` and, when present, renders the
name cell as an `AutocompleteField` (with `wholeFieldToken`) instead of a `TextField`.
`RequestHeadersTable.vue` passes the list; Params/urlencoded/form-data pass nothing and keep a
plain `TextField`. `AutocompleteField` is a documented drop-in for `TextField`'s box, `v-model`,
placeholder and `data-testid` handling (`:14-26`), so `http-header-name`'s existing `page.fill()`
usages are unaffected.

**Not header *values*.** `Content-Type` values are a second vocabulary with different rules, and
the request already tells the user which Content-Type it will send
(`RequestBodyPane.vue:112-114`'s caption). OQ-3.

---

## 3. Commit sequence

Pure data/logic first, then the two shared editor seams, then the surfaces that consume them.
`bun run lint`, `bun run typecheck` and `bun run build` per commit; `tests/ui` once at the end (§4).

| # | Commit | Item | Touches | Risk |
|---|---|---|---|---|
| N1 | `feat(api-core): template spans carry their offsets, and one shared reference classifier` | 10 | `http/substitute.ts`, `index.ts` | low — additive fields; the pinned substitution corpus is the guard |
| N2 | `feat(editor): a range-highlight seam, and {{variable}} colouring in the body editor` | 10 | new `editor/variableHighlight.ts`, `CodeMirrorHost.vue`, `editor/theme.ts`, new `views/httprequest/variableCompletion.ts`, `RequestBodyPane.vue`, `HttpRequestView.vue` | medium — the one commit that adds a decoration plugin; the clamping rule in D2 is what keeps it from throwing |
| N3 | `feat(theme): AutocompleteField paints, hovers and completes {{variable}} references` | 10 | `AutocompleteField.vue`, `completion.ts`, `CodeMirrorHost.vue` (`posAtCoords` expose), `HttpRequestView.vue` (URL field), `FieldRowsTable.vue` (value cells) | **highest** — the hover is new interaction in a shared primitive; every existing `AutocompleteField` call site must be provably untouched |
| N4 | `feat(api): header-name autocomplete over the well-known request headers` | 7 | new `packages/api-core/src/http/headers.ts`, `index.ts`, `FieldRowsTable.vue`, `RequestHeadersTable.vue` | low; needs N3's `tokenAt` prop |
| N5 | `feat(editor): auto-closing pairs in the request body and the request fields` | 11 | `CodeMirrorHost.vue`, `RequestBodyPane.vue`, `theme/wrapSelection.ts`, `editor/wrapSelection.ts` (comment) | medium — a typing-path change; the console must be provably unaffected |
| N6 | `feat(api): arrow-key navigation across the request tables` | 12 | `FieldRowsTable.vue`, `views/grpcrequest/MetadataTable.vue` | low |
| N7 | `test(p15b): the specs §4 enumerates` | — | `apps/kira-studio/tests/ui/*`, `packages/api-core/test/*` | low |

**Ordering that matters**: N1 → N2 → N3 → N4. N5 and N6 are independent of all of them and of each
other, but land after N3 so the three files they share are not being rewritten underneath them.

---

## 4. Verification plan

**Per commit**: `bun run lint`, `bun run typecheck`, `bun run build`.

**`bun run test:unit` after N1 — this is the load-bearing check of the whole phase.**
`packages/api-core/test/http-substitution.spec.ts` runs the corpus
(`internal/apivars/testdata/substitution.json`) that pins this file to Go's `apivars.Resolve`.
D1 refactors `resolve`'s classification branch into a named function; that corpus passing
**unedited** is the proof the refactor changed no rule. `go test ./apps/kira-studio/internal/apivars/...`
reads the same corpus and should be run once alongside it.

**New unit coverage** (`packages/api-core/test/`), held to `AGENTS.md`'s bar — these are a
multi-rule scanner and a precedence table, not CRUD:

1. `splitTemplateSpans` offsets: adjacent references, an unterminated `{{`, an empty `{{}}`, a
   nested `{{a{{b}}}}` (the grammar's own documented oddity, `substitute.ts:35-37`) — every span's
   `text` must equal `input.slice(from, to)`, which is the invariant every consumer depends on;
2. `classifyReference` precedence: `$dynamic` before secret before value before unknown;
3. `templateToken` / `wholeFieldToken` (in `apps/kira-studio/tests/unit/`, since `completion.ts` is
   app-side): caret before/inside/after a reference, caret in a closed reference (must be `null`),
   a hyphenated header name as one token.

Nothing else gets a unit test: the decoration plugin, the hover panel and the key handlers are DOM
behaviour and belong in `tests/ui`.

**`tests/ui`, once at the end.** Specs that must pass **unedited** (the "this phase is additive"
guard):

| Spec | What it proves |
|---|---|
| `autocomplete.spec.ts` | `FilterToolbar`'s WHERE/ORDER BY completion is untouched by N3's four new optional props |
| `console.spec.ts`, `console-format.spec.ts`, `console-explain.spec.ts` | N5 did not enable `closeBrackets()` in the console — typing `'` there still leaves one character |
| `http-curl.spec.ts`, `http-dynamic-values.spec.ts`, `collections.spec.ts` | `page.fill('[data-testid="http-url"]', …)` still works after the URL field becomes an `AutocompleteField` |
| `http-variables.spec.ts` | the unresolved-count chip is unchanged — same classification, now shared |
| `mongo.spec.ts`-style select-all-and-retype flows (`cell-editor.spec.ts`, `data-view.spec.ts`) | N5's collapsed-caret path did not disturb the whole-selection replace rule both `wrapSelection` files protect |

**New coverage in `api-ui-consistency.spec.ts`** (Api-only, per the SPEC's module-boundary rule):

1. typing `{{` in the URL field yields `{{}}` with the caret between (D5(b) rules 1 composing), and
   the completion popup lists a known variable name (D3(b));
2. accepting that suggestion produces `{{base_url}}` — not `{{base_url}}}}` — which is the exact
   interaction between auto-close and accept that a reviewer cannot check by reading;
3. a URL holding one known and one unknown reference paints one `.cm-kira-var` and one
   `.cm-kira-var-unknown` in the field's overlay;
4. hovering a resolved reference shows its value; hovering a **secret** reference shows the
   "resolved when the request is sent" line and **not** the value (asserted as an absence — this is
   the one assertion in this phase that is a security property, not a UX one);
5. typing `cont` in a header-name cell suggests `Content-Type`, and typing `Content-T` then
   accepting yields `Content-Type` (F1's concatenation bug, asserted so it cannot come back);
6. ArrowDown from the first header's name cell focuses the second header's name cell; ArrowDown
   while the completion popup is open moves the *popup* selection and does not move focus (D6's
   `defaultPrevented` rule).

**Not run, and named:**

- **IME composition in the auto-close path.** `keydown` fires during composition on some input
  methods; the handler's `e.metaKey/ctrlKey/altKey` guard (`theme/wrapSelection.ts:21`) does not
  cover `e.isComposing`. N5 adds an `isComposing` bailout by construction, but no CJK IME is
  exercised in this sandbox — recorded, not claimed.
- **A real macOS render of the hover panel.** Placement is `@floating-ui/dom`'s, the same engine
  four other floating surfaces in this app already use; nothing here is measured by hand.

---

## 5. What this phase deliberately does not do

- **Does not replace any `<input>` with a CodeMirror editor** (§0.3, D3).
- **Does not change the substitution grammar, its precedence, or its Go counterpart** — N1 is
  additive and corpus-guarded (§4).
- **Does not surface a secret's value anywhere**, including in a hover that has every other
  reference's value in hand (D4, and §4's assertion 4).
- **Does not enable auto-close in the SQL/Mongo/Redis console**, which is the one place
  `editor/wrapSelection.ts` gave a real reason not to (D5, F3).
- **Does not add a shared row-navigation module** for two 35-line handlers the module boundary
  keeps apart anyway (D6, OQ-4).
- **Does not touch Go, the bindings, `packages/shared`, or any schema.**
- **Does not add header *value* completion**, curl-import-driven header suggestions, or variable
  autocomplete in the body editor's own popup — the body editor has no `autocomplete` today
  (`RequestBodyPane.vue:120-133` passes none) and turning CodeMirror's popup on there is a
  behaviour change of its own. OQ-3, OQ-5.

---

## 6. Open questions

**OQ-1 — the hover's 400 ms delay is a second copy of `TOOLTIP_DELAY_MS`.**
`workbench/state/tooltip.ts:9-11` owns the app's one hover-pause constant and explicitly notes it is
*"shared with the editor's lint tooltip (`CodeMirrorHost.vue`'s `delay: 400`)"* — a second copy
already exists, so this makes three. `theme/` cannot import `workbench/` (F7), so closing this means
hoisting the constant into `theme/` and re-exporting it from `workbench/state/tooltip.ts` — a
three-line refactor of a file this phase otherwise does not touch. Left as a local constant with a
comment pointing at the original; the hoist is right for whoever is next inside that file.

**OQ-2 — should the hover panel anchor to the token or to the field?** D3(c) anchors to the token
via `pointReference`, which is more precise and is what a code editor does. The counter-argument is
that every other tooltip in this app anchors to a whole element, so a panel that moves as the
pointer crosses a field will read as a different species of tooltip. Anchoring to the field's rect is
a one-line change if it reads wrong.

**OQ-3 — header *value* completion, per header name?** `Content-Type: application/json`,
`Accept: */*`, `Authorization: Bearer …` are the obvious three, and the plumbing after N3/N4 would
support them (a per-name candidate list). Declined here as a second vocabulary with its own rules
(a value is not always an identifier, and `Bearer ` wants a caret offset), not because it is wrong.

**OQ-4 — `FieldRowsTable` and `MetadataTable` now duplicate a fifth behaviour.** They already
duplicate the row model, the trailing-blank-row rule, the checkbox column and the remove button
(`MetadataTable.vue:9-12` accepted this deliberately: the biome rule forbids the import and *"the
shape is small enough that duplicating it costs less than the coupling reuse would have created"*).
Arrow navigation is the fifth. At some point the honest move is a `views/shared/` row-table
component both import — which is a refactor with its own risk and its own phase, and P13 §0.2's
"nothing here moves a file" instinct applies. Flagged, not acted on.

**OQ-5 — should the body editor get variable completion in CodeMirror's own popup?** N2 gives the
body colouring and hover but not completion — `RequestBodyPane`'s hosts pass no `autocomplete`, and
turning it on means the JSON body editor sprouts a popup while typing ordinary JSON. A
`completionSources` entry that only activates inside `{{…}}` would be the correct shape
(`CodeMirrorHost.vue:37-41` already supports exactly that). Deferred because "a popup appeared in
my JSON body" is a regression the user did not ask for, and this batch is user-driven.

---

## Checklist

- [ ] **N1** `TemplateSpan` grows `from`/`to`/`name`; `classifyReference` extracted from `resolve`
      and *called by* it; both plus `splitTemplateSpans` exported from `@kira/api-core`; the
      substitution corpus passes unedited *(item 10, foundation)*
- [ ] **N2** `rangeHighlights` prop + `ViewPlugin` + compartment + clamp/sort rules in
      `CodeMirrorHost`; three `.cm-kira-var*` rules in `editor/theme.ts`; `variableCompletion.ts`
      built on `mergedValuesAndSecrets`; body editor coloured *(item 10, body)*
- [ ] **N3** `AutocompleteField` gains `rangeHighlights`, `tokenAt`, `hoverAt`; `posAtCoords`
      exposed by `CodeMirrorHost`; hover panel via `pointReference`; URL field and header/param
      value cells switch to `AutocompleteField`; existing two call sites unchanged *(item 10, fields)*
- [ ] **N4** `WELL_KNOWN_REQUEST_HEADERS` (~55, categorised) in api-core; `nameCandidates` on
      `FieldRowsTable`; headers table wired with `wholeFieldToken` *(item 7)*
- [ ] **N5** `closeBrackets()` behind `autoCloseBrackets` on `CodeMirrorHost`, on for the body
      editor and off for the console; `autoClosePairsOnType` in `theme/wrapSelection.ts` with
      step-over and pair-delete; `isComposing` bailout; `editor/wrapSelection.ts`'s comment updated
      *(item 11)*
- [ ] **N6** arrow navigation in `FieldRowsTable` and `MetadataTable`, `defaultPrevented`-guarded,
      inputs only, positional columns, trailing row included *(item 12)*
- [ ] **N7** unit coverage (§4's three), the six new `api-ui-consistency` cases, and the
      pass-unedited list
- [ ] full `bun run test:ui` once, after N7; fixes land as follow-up commits

---

## 7. Sources

**Read in full at `a4c8e4d`:** `theme/primitives/{AutocompleteField.vue,completion.ts,TextField.vue}`,
`theme/{wrapSelection.ts,floatingPosition.ts}`, `editor/{CodeMirrorHost.vue,wrapSelection.ts,
hover.ts,languages.ts,theme.ts}`, `workbench/state/tooltip.ts`,
`packages/api-core/src/http/{substitute.ts,body.ts}`, `packages/api-core/src/index.ts`,
`views/httprequest/{HttpRequestView.vue,RequestBodyPane.vue,FieldRowsTable.vue,
RequestHeadersTable.vue,QueryParamsTable.vue,FormDataTable.vue,state.ts}`,
`views/grpcrequest/MetadataTable.vue`, `api/state/variables.ts`, `biome.json`.

**Read for a specific claim:** `packages/api-core/test/{go-ts-api-parity,http-substitution}.spec.ts`,
`apps/kira-studio/tests/ui/{http-curl,http-dynamic-values,collections,http-request}.spec.ts`,
root `package.json` (the pinned `@codemirror/*` versions), `theme/tokens.css` (the syntax token set
D2 paints from).

**Prior plans consulted:** `docs/v1.1/plans/P18-sql-language-server-explain.md` (the
completion/hover/lint prop seams this phase extends by one), `docs/v1.2/plans/P13-api-ui-check.md`
(structure, and its OQ-4's "no codepoints from CSS" rule), `docs/v1.2/plans/P12-studio-api-modularization.md`
(the `biome.json` import boundaries §0.2 and D4/D6 are written to), and part 1
(`docs/v1.2/plans/P15-request-builder-ux.md`), whose M3/M7 this phase assumes. `AGENTS.md`'s
library-first rule (D5(a)), unit-test bar (§4) and implement-then-test cadence (§3).
