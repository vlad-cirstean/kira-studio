# P60a — `MonacoHost.vue`, every non-SQL-service surface, and the merge view

## 0. This phase was split during its own planning pass

SPEC's P60 row names two CodeMirror surfaces ("the SQL query console and `project/SchemaDialog.vue`")
and one unlocated merge view. Reading the tree directly found **17 mount components / 25 mount
instances**, nine `editor/` support modules, ~1 137 lines of SQL analysis built on a **Lezer parse
tree**, and **23 UI spec files plus 4 unit specs** keyed to CodeMirror's DOM. That is not one
implementation pass.

Split along the one real seam — *does this surface need the SQL language service?*:

| Phase | Scope | Ends with |
| --- | --- | --- |
| **P60a** (this plan) | `MonacoHost.vue` and its support modules; the 15 mount components that need no SQL language service; `AutocompleteField.vue`'s paint-only overlay; the merge view | Monaco everywhere except the SQL console and the DDL editor. `@codemirror/merge` deleted |
| **P60b** | Replace the Lezer parse tree; SQL completion/hover/diagnostics/DDL extraction on Monaco; `ConsoleView.vue` + `SchemaDialog.vue`; purge the remaining nine `@codemirror/*` and `@lezer/highlight` | No `@codemirror/*` anywhere |

Why this seam and not another: every surface in P60a is *"same features, different engine"* —
mechanical, verifiable one mount at a time. P60b is the only part that needs a **new parser**, which
is the single largest risk in the migration and deserves its own plan against the tree P60a leaves.
The same reasoning C5/C6 used (v1.5): ship the shell and the mechanical surfaces first, then the
piece with real unknowns.

Both phases land on branch `v1.6`. P60a leaves `CodeMirrorHost.vue` alive and mounted by exactly two
components; that coexistence is deliberate and bounded to one phase.

---

## 1. The complete inventory

Found by `grep -rl "CodeMirrorHost\|@codemirror" apps/kira-studio/frontend/src` plus reading every
hit in full. **Every mount site**, its props, and who owns it:

| # | Component | Mounts | Props used | P60a? |
| --- | --- | --- | --- | --- |
| 1 | `views/console/ConsoleView.vue:700` | 1 | doc, language, sqlDialect, readOnly, autocomplete, **completionSources**, **lintSource**, **hoverSource**, keepSelectionOnExternalSync, update:doc, update:cursor; exposes `focus`/`setCursor` | **no — P60b** |
| 2 | `project/SchemaDialog.vue:135` | 1 | doc, language=sql, sqlDialect, readOnly=false, autocomplete | **no — P60b** |
| 3 | `theme/primitives/AutocompleteField.vue:387` | 1 | doc, language, sqlDialect, readOnly, **singleLine**, rangeHighlights; exposes `posAtCoords` | yes |
| 4 | `views/shared/celleditor/CellEditorView.vue:577,597` | 2 | doc, language, sqlDialect, readOnly, **lintSource** (`cellLintSource`, :347), rangeHighlights, update:doc | yes |
| 5 | `views/httprequest/RequestBodyPane.vue:190,203` | 2 | doc, language, readOnly=false, rangeHighlights, hoverSource, autocomplete, completionSources, **autoCloseBrackets** | yes |
| 6 | `views/httprequest/ResponsePane.vue:425` | 1 | doc, language, readOnly, rangeHighlights; exposes `scrollRangeIntoView` | yes |
| 7 | `views/httprequest/RawExchangePane.vue:177,201,248,272` | 4 | doc, language, readOnly | yes |
| 8 | `views/grpcrequest/GrpcRequestView.vue:410` | 1 | doc, language=json, rangeHighlights, hoverSource, autocomplete, completionSources, autoCloseBrackets | yes |
| 9 | `views/grpcrequest/ResponsePane.vue:361` | 1 | doc, language=json, readOnly, rangeHighlights | yes |
| 10 | `views/definition/DefinitionView.vue:312` | 1 | doc, language, sqlDialect, readOnly, rangeHighlights (`docHighlights`, :157) | yes |
| 11 | `views/documents/DocumentView.vue:835,949,969` | 3 | doc, language=json, readOnly | yes |
| 12 | `views/grid/PreviewCommandPanel.vue:74` | 1 | doc, language=sql, sqlDialect, readOnly | yes |
| 13 | `views/console/ExplainResultView.vue:164` | 1 | doc, language, readOnly, autocomplete=false | yes |
| 14 | `workbench/GenerateDataDialog.vue:324` | 1 | doc, language=sql, sqlDialect, readOnly | yes |
| 15 | `workbench/panels/OperationsPanel.vue:252,264` | 2 | doc, language, readOnly | yes |
| 16 | `api/BulkVariablesEditor.vue:120` | 1 | doc, language=plain, readOnly=false | yes |
| 17 | `api/EditRawRequestDialog.vue:77` | 1 | doc, language=plain, readOnly=false | yes |
| 18 | `views/httprequest/ResponseDiffDialog.vue:176` | — | `MergeView` direct, not the host | yes |

**The merge view, located.** `@codemirror/merge`'s one consumer is
`views/httprequest/ResponseDiffDialog.vue` — the response-history **Compare** action, reached through
`views/httprequest/mergeEntry.ts`'s one-line dynamic import. Config (`:176-183`):
`highlightChanges: true`, `gutter: true`, `collapseUnchanged: {}`, both sides read-only, both
carrying `languageExtension(commonFormat)` + `kiraHighlightStyle` + `kiraEditorTheme`.

### 1.1 Support modules (`editor/`)

| File | Lines | CodeMirror-bound? | Fate in P60a |
| --- | --- | --- | --- |
| `CodeMirrorHost.vue` | 475 | yes | stays until P60b; `MonacoHost.vue` added beside it |
| `theme.ts` | 283 | yes (`EditorView.theme`, `HighlightStyle`, `@lezer/highlight` tags) | `monacoTheme.ts` added beside it |
| `languages.ts` | 185 | yes (`lang-json`/`lang-sql`/`lang-xml`, two `StreamLanguage`s, `ClickHouseDialect`) | `monacoLanguages.ts` added; `dialectObjectFor` stays for P60b |
| `hover.ts` | 86 | yes (`HoverTooltipSource`, `syntaxTree`) | `ConsoleHoverInfo` + `formatHoverValue` kept verbatim; the `buildHoverSource` glue moves to Monaco |
| `variableHighlight.ts` | 59 | yes (`ViewPlugin`, `Decoration`, `RangeSetBuilder`) | `RangeHighlight` interface kept verbatim; the plugin replaced by a decorations collection |
| `wrapSelection.ts` | 46 | yes (`EditorView.inputHandler`) | deleted — Monaco's `autoSurround` is native (§4.6) |
| `diagnostics.ts` | 9 | **no** | unchanged |
| `findRanges.ts` | 110 | **no** (type-only import of `RangeHighlight`) | unchanged |
| `searchPattern.ts` | 28 | **no** | unchanged |

### 1.2 The capability list — the acceptance bar

"Make sure all the features still work" resolves to exactly these. Every one is a checklist item in
§12.

**Owned by P60a:**

1. Syntax colouring for `json`, `xml`, `plain` (and `sql` as *paint only*, no language service).
2. Syntax colouring for the two console-only modes `mongo` and `redis` (`languages.ts:68,104`,
   hand-written `StreamLanguage`s — the *console* tabs move in P60b, but `mongo` colouring is also
   reachable from `AutocompleteField`'s overlay on a Mongo filter field, so the Monarch must exist
   in P60a).
3. Editable vs read-only, switchable at runtime (`CellEditorView`'s D27 truncated-value case flips
   `readOnly` on a live host).
4. `update:doc` on user typing only — never on an external write (`externalSync` annotation,
   `CodeMirrorHost.vue:110`).
5. `update:cursor` on typing **and** on a bare selection move.
6. Undo/redo with run-of-keystrokes grouping (`newGroupDelay: 500`, `:152`).
7. **A hard undo boundary around an external write** (`isolateHistory.of('full')`, `:347`) — v1.4's
   own fix for Format-then-undo wiping the whole query. Must not regress; §4.7.
8. Selection-preserving external sync (`keepSelectionOnExternalSync`, `:330`) + `setCursor`.
9. Wrap-selection-on-type over a non-empty, non-whole-document selection (`wrapSelection.ts:30`).
10. Optional auto-close brackets (`autoCloseBrackets`, request body + gRPC message only).
11. Lint squiggles + hover text from a `(doc) => ConsoleDiagnostic[]` source, 400 ms debounced
    (`cellLintSource` is P60a's only caller; the console's is P60b).
12. Hover tooltips from a pure text-in source (`variableHoverSource`, `variableCompletion.ts:288`),
    with the value/caption split (`hover.ts:70-81`).
13. Completion popup from app-supplied sources (`variableCompletionSource`, `:319`) — Tab accepts,
    **Enter stays a newline** (`CONSOLE_COMPLETION_KEYMAP`, `:159`), zero debounce, ≤25 rendered.
14. Painted ranges from a `(doc) => RangeHighlight[]` source — `{{variable}}` colouring
    (`.cm-kira-var`/`-secret`/`-unknown`) and find-bar matches (`.cm-kira-find-match`/`-current`).
15. `scrollRangeIntoView(from, to)` for the find bar.
16. `posAtCoords(x, y)` for `AutocompleteField`'s hover hit-test.
17. `focus()`.
18. Word wrap driven by `settingsState.appearance.wordWrap`; re-measure on a font-family/size change.
19. Single-line mode: no gutter, no wrap, height sized to one line, zero horizontal padding, and a
    scroller whose `scrollLeft` a host can drive (`AutocompleteField.onInputScroll`, `:105`).
20. Tooltips escaping every `overflow: hidden` ancestor, at `--kira-z-tooltip` (`theme.ts:63`).
21. The merge view: scroll-locked, line-aligned, intra-line-highlighted, collapse-unchanged,
    both sides read-only.

**Deferred to P60b** (listed so nothing is assumed done here): SQL keyword/schema/column completion
over live metadata, DDL-document parsing, SQL hover, DDL diagnostics, multi-statement Run all /
Format caret mapping.

### 1.3 What is *not* touched

`sql-formatter` is a separate dependency and **stays** — `views/console/format.ts` and
`sqlFormatterEntry.ts` contain zero CodeMirror imports. It is re-wired in P60b only where
`ConsoleView.onFormat` (`:366`) calls `editorHost.setCursor`.

`@shared/domain/sql-split.ts` and `sql-lint.ts` are CodeMirror-free and unchanged.

---

## 2. How Monaco is wired today, and what it already gives us

Read in full: `views/repo/monaco.ts` (196), `monacoEntry.ts` (61), `language.ts` (70),
`RepoDiffView.vue` (250), `editors.ts` (126).

- **Lazy bootstrap.** `loadMonaco()` (`monaco.ts:75`) memoises one `import('./monacoEntry')`, wires
  the single `editorWorkerService` worker (`:14`), and defines theme `kira-repo` from `tokens.css`
  via `getComputedStyle` — including `expandHexShorthand` (`:41`), a real WebKit fix that must be
  preserved.
- **`sql` is already a registered Monarch language** (`monacoEntry.ts:41`), as are `xml` (`:39`) and
  `json` (registered by hand at `:52`, colouring with the JavaScript Monarch). `plain` maps to
  `plaintext`. So of the six `EditorLanguageId` values, only **`mongo` and `redis` need new
  Monarch definitions**.
- **Every API this migration needs exists in the pinned 0.56.0**, verified against
  `node_modules/monaco-editor/monaco.d.ts`: `editor.setModelMarkers` (:1319), `colorize` (:1388),
  `tokenize` (:1398), `languages.registerCompletionItemProvider` (:7118),
  `registerHoverProvider` (:7053), `createDecorationsCollection` (:3156) with `inlineClassName`
  (:2069), `model.pushStackElement` (:2622) / `pushEditOperations` (:2636),
  `getOffsetAt`/`getPositionAt` (:2439/:2446), `getTargetAtClientPoint` (:6699),
  `fixedOverflowWidgets` (:3653), `autoSurround` (:3970), `autoClosingBrackets` (:3947),
  `wordWrap` (:3773), `hideUnchangedRegions` (diff).
- **License.** `monaco-editor` 0.56.0 is MIT (registry + `node_modules/monaco-editor/LICENSE`), no
  paid tier, no Enterprise-gated feature. Already a `dependencies` entry. **P60a adds no new
  dependency at all.**

### 2.1 The bundle boundary — measured, not assumed

`workbench/tabViews.ts:6` imports `ConsoleView.vue` **statically**; so does every other tab view
(its own comment at `:19` says so deliberately). CodeMirror is therefore in the **eager** chunk
today, while Monaco is behind `loadMonaco()`'s dynamic import.

Measured now (`bun run build`, this tree, before any change):

| Chunk | raw | gzip |
| --- | --- | --- |
| `index-*.js` (eager) | 1 723.09 kB | **520.66 kB** |
| `monacoEntry-*.js` (lazy) | 3 807.04 kB | 972.31 kB |
| `monacoEntry-*.css` (lazy) | 161.81 kB | 24.56 kB |
| `dist-*.js` (`@codemirror/merge`, lazy) | 28.99 kB | 10.09 kB |
| `sqlFormatterEntry-*.js` (lazy) | 130.21 kB | 37.10 kB |

**Design decision (D1): every editor surface loads Monaco through the same memoised
`loadMonaco()`; nothing becomes eager.** This *shrinks* the eager chunk (CodeMirror leaves it) and
costs a first-mount `await` on surfaces that previously rendered synchronously. That trade is right:
a studio/api session that never opens an editor now downloads neither engine, and a session that
opens one pays a single 972 kB gzip fetch once.

Consequence, stated plainly rather than discovered later: **a DB-focused user who opens a SQL
console but never a repo workspace now fetches the Monaco chunk.** That is the cost of a single
engine, and it is the point of the phase. The mitigations are (a) one shared memoised chunk for
*all* surfaces, (b) `MonacoHost` renders the document as inert pre-formatted text while the import
is in flight, so no surface ever shows an empty box (§3.3).

`monaco.ts` currently lives under `views/repo/` and its identifiers are repo-shaped
(`REPO_THEME_NAME`, `repoFileUri*`). **D2: move the engine-generic half to `editor/monaco.ts`**
(`loadMonaco`, `MonacoModule`, theme definition) and leave the repo-specific URI/model helpers in
`views/repo/monaco.ts`, re-exporting `loadMonaco` so `RepoFileView`/`RepoDiffView`/`navigation.ts`
need no edit. Rename `REPO_THEME_NAME` → `KIRA_EDITOR_THEME` with the old name re-exported as an
alias for one phase.

---

## 3. `editor/MonacoHost.vue`

A drop-in for `CodeMirrorHost.vue`: **same prop names, same emits, same exposed methods**, so every
mount site in §1 changes only its import and its tag name. This is the single most important
constraint in the plan — it is what makes 15 components migrate as one mechanical edit rather than
15 redesigns.

### 3.1 Props — unchanged surface

`doc`, `language`, `sqlDialect`, `readOnly`, `autocomplete`, `completionSources`, `lintSource`,
`hoverSource`, `singleLine`, `rangeHighlights`, `autoCloseBrackets`, `keepSelectionOnExternalSync`.

Two prop **types** change, because their current types are CodeMirror types:

- `completionSources?: readonly CompletionSource[]` → `readonly EditorCompletionSource[]`, where
  `EditorCompletionSource = (ctx: { doc: string; offset: number; explicit: boolean }) =>
  EditorCompletionResult | null` and `EditorCompletionResult = { from: number; options:
  readonly EditorCompletion[] }`, `EditorCompletion = { label: string; insert?: string; detail?:
  string; type?: 'variable' | 'method' | 'function' | 'class' | 'keyword' | 'property'; boost?:
  number }`. Declared in a new `editor/completion.ts`. This is the same pure-data shape the existing
  sources already produce; only `context.matchBefore`/`context.state.sliceDoc` calls change into
  plain string work on `ctx.doc`/`ctx.offset`.
- `hoverSource?: HoverTooltipSource` → `hoverSource?: (doc: string, offset: number) =>
  ConsoleHoverInfo | null`. **Simpler than today**: `hover.ts`'s `buildHoverSource` exists only to
  turn a pure lookup into a CodeMirror object, so the seam collapses into the pure lookup itself.
  `ConsoleHoverInfo` and `formatHoverValue` (`hover.ts:10,36`) are kept byte-for-byte.

`lintSource` and `rangeHighlights` keep their exact current signatures — both are already pure
`(doc: string) => …`.

### 3.2 Instance options

```
theme: KIRA_EDITOR_THEME,
automaticLayout: true,
readOnly / domReadOnly: props.readOnly,        // both, per views/repo/RepoFileView.vue:69
lineNumbers: props.singleLine ? 'off' : 'on',
minimap: { enabled: false },
scrollBeyondLastLine: false,
renderLineHighlight: 'none',                   // theme.ts:29 '.cm-activeLine: transparent'
folding: false,
glyphMargin: false,
fixedOverflowWidgets: true,                    // capability 20
wordWrap: resolveWordWrap(),
autoSurround: 'quotes' | 'brackets' → 'languageDefined',   // capability 9, §4.6
autoClosingBrackets: props.autoCloseBrackets ? 'languageDefined' : 'never',
quickSuggestions: props.autocomplete,
suggestOnTriggerCharacters: props.autocomplete,
occurrencesHighlight: 'off',
```

`view` stays a plain `let`, never a `ref`/`shallowRef`/`reactive` — `CodeMirrorHost.vue:101`'s
no-reactivity rule applies identically and for the same reason (Monaco's internals would be proxied
on every keystroke). Restate that comment in the new file.

### 3.3 Lifecycle

`onMounted` is `async`: `await loadMonaco()`, then create the model and editor. Two guards:

1. If the component unmounted while the import was in flight, dispose nothing and return (the same
   `if (!container.value) return` guard `RepoDiffView.vue:125` already uses).
2. Until resolved, the template renders `<pre class="monaco-host-pending">{{ doc }}</pre>` — real
   text, in the data font, not a spinner. On a warm module this is one microtask; on a cold one it
   is the chunk fetch. **No surface ever renders empty.**

`onUnmounted`: dispose the decorations collection, every registered provider disposable, the editor,
then the model. P60a's hosts own their models outright (no URI cache) — `views/repo/monaco.ts`'s
`modelCache` exists for *tab-scoped* repo files and must not be reused here, or two panes showing
the same JSON body would share one model.

### 3.4 Watchers — one per prop, as today

`doc` (with the identical `doc === current` echo guard, `:329`), `[language, sqlDialect]`
(`editor.setModelLanguage`), `readOnly` (`updateOptions`), `[autocomplete, completionSources]`
(dispose + re-register the provider), `lintSource` (re-run the debounced linter), `hoverSource`
(dispose + re-register), `rangeHighlights` (recompute the decorations collection),
`autoCloseBrackets` (`updateOptions`), `settingsState.appearance.wordWrap` (`updateOptions`),
`[fontFamily, fontSize]` (`editor.layout()` — the `requestMeasure()` equivalent, `:427`).

---

## 4. Capability-by-capability mapping

### 4.1 Theme (`editor/monacoTheme.ts`)

`theme.ts`'s 283 lines split three ways:

- **Editor chrome** (background, foreground, gutter, selection, cursor) → `defineTheme` `colors`,
  extending the existing `monaco.ts` map with `editor.selectionBackground`,
  `editorCursor.foreground`, `editorGutter.background`, `editorSuggestWidget.*`,
  `editorHoverWidget.*`. Reuses `cssVar`/`expandHexShorthand` unchanged.
- **Token colours** (`kiraHighlightStyle`, `:256-283`, 14 `@lezer/highlight` tag groups) →
  `defineTheme` `rules`, keyed by Monarch scope instead of Lezer tag. The mapping is explicit and
  belongs in the plan, not in the implementer's head:

  | `--kira-syntax-*` token | Lezer tag today | Monarch scopes |
  | --- | --- | --- |
  | `comment` | `comment`, `lineComment`, `blockComment` | `comment` |
  | `string` | `string`, `special(string)` | `string`, `string.sql`, `string.escape` |
  | `number` | `number` | `number` |
  | `keyword` | `bool`, `null`, `keyword`, `typeName`, `atom` | `keyword`, `type`, `constant` |
  | `control` | `controlKeyword`, `moduleKeyword` | `keyword.control` |
  | `property` | `propertyName` | `variable.name`, `key`, `attribute.name` (JSON keys colour via the JS Monarch's `string.key` — verify against a real JSON body, §12.1) |
  | `name` | `variableName`, `labelName` | `identifier`, `variable` |
  | `function` | `function(variableName)` | `entity.name.function`, `predefined` |
  | `tag` | `tagName`, `angleBracket` | `tag` |
  | `attribute` | `attributeName` | `attribute.name` |
  | `operator` | `operator`, `compareOperator`, `logicOperator` | `operator` |
  | `punctuation` | `punctuation`, `separator`, `bracket` | `delimiter`, `delimiter.parenthesis`, `delimiter.bracket` |
  | `meta` | `meta`, `processingInstruction`, `documentMeta` | `metatag` |
  | `invalid` | `invalid` | `invalid` |

  `defineTheme` `rules` take literal colours, not `var(--…)` — every value goes through
  `cssVar(…)` at theme-definition time, exactly as the chrome colours already do.
- **App-owned classes** (`.cm-kira-var*`, `.cm-kira-find-match*`, `.cm-kira-hover*`) → plain scoped
  CSS on the new host, renamed `.kira-ed-var*` / `.kira-ed-find-match*` / `.kira-ed-hover*`.
  Values copied verbatim from `theme.ts:176-251`; **only the class prefix changes**, so the visual
  result is byte-identical and the test rename is a pure find-and-replace (§9).

`{ dark: true }` becomes `base: 'vs-dark', inherit: true` — already what `monaco.ts:57` does.

### 4.2 Languages (`editor/monacoLanguages.ts`)

```
export function monacoLanguageIdFor(id: EditorLanguageId): string {
  json → 'json'; xml → 'xml'; sql → 'sql'; plain → 'plaintext';
  mongo → 'kira-mongo'; redis → 'kira-redis';
}
```

`kira-mongo` / `kira-redis` are two new Monarch definitions, registered inside `monacoEntry.ts`
beside the existing 19 and behind the same `registerTokensProviderFactory` lazy shape (`:53`). They
are a **direct transliteration** of `languages.ts:26-108`'s two `StreamLanguage` token functions,
whose rules are already small, explicit regexes:

- `kira-mongo`: `//` line comment; single/double-quoted strings with backslash escapes; numbers;
  `$op` → `operator`; `.` sets an after-dot state so the next identifier is `variable.name` rather
  than `identifier`; `db` at a non-after-dot position → `keyword`; brackets/punctuation.
  Monarch expresses the after-dot state as a second tokenizer state, which is exactly what
  `MongoTokenState.afterDot` (`:22`) already is.
- `kira-redis`: first token of each `;`-separated statement → `keyword`, everything else plain;
  quoted strings; numbers. `RedisTokenState.atCommand` (`:76`) becomes a Monarch state pair.

This is a transliteration of code this repo already owns, not a hand-rolled grammar declined in
favour of a library — no Monaco Monarch for a Mongo shell or a Redis command line exists.

`monaco-sql-languages` (MIT) was checked and **declined**: it supplies MySQL/PostgreSQL/Hive/Spark/
Flink/Trino/Impala only — no SQLite, no ClickHouse, two of this app's five SQL kinds — and drags
`dt-sql-parser`'s ANTLR grammars in for a colouring job Monaco's built-in `sql` Monarch already does.
The full reasoning belongs to P60b §2, where a SQL *parser* is actually needed.

### 4.3 Range highlights → decorations

`variableHighlight.ts`'s `RangeHighlight { from, to, class }` is kept verbatim. The `ViewPlugin`
becomes:

```
const decorations = editor.createDecorationsCollection();
function repaint(text: string): void {
  decorations.set(
    source(text)
      .filter(r => r.from >= 0 && r.from < r.to && r.to <= text.length)   // :28, kept
      .map(r => ({ range: rangeFromOffsets(model, r.from, r.to),
                   options: { inlineClassName: r.class } })));
}
```

Rebuilt on `model.onDidChangeContent` and whenever the `rangeHighlights` prop identity changes —
the same two triggers as today (`:51`). `rangeFromOffsets` uses `model.getPositionAt`. The offset
validity filter stays: `findRanges`'s callers can be one keystroke stale (`:22-25`), and Monaco
throws on an out-of-range position just as `RangeSet.of` did.

`inlineClassName` is applied without `inlineClassNameAffectsLetterSpacing`, so painting a range
cannot shift the glyph grid `AutocompleteField`'s overlay depends on.

### 4.4 Hover

`languages.registerHoverProvider(languageId, { provideHover })` is registered **per host instance**,
scoped by checking `model === ourModel` and returning `null` otherwise — Monaco's provider registry
is global per language, so an unscoped registration would leak one pane's hover into another's.
The disposable is stored and disposed on unmount and on a `hoverSource` prop change.

`provideHover` calls `props.hoverSource(model.getValue(), model.getOffsetAt(position))` and returns
`{ range, contents }`. `ConsoleHoverInfo.value` (the inset, pre-wrapped block) and `lines` (the
caption) render through Monaco's markdown contents:

- `value` → one fenced block, so a pretty-printed JSON value keeps its line breaks. Monaco renders
  markdown with `marked` + `dompurify` (its own declared dependencies) — no new dependency, and the
  value is fenced, never interpolated as markup.
- `lines` → one `MarkdownString` per line with `supportHtml: false`.

The two-register visual split (`.cm-kira-hover-value` inset + muted `.cm-kira-hover-caption`,
`theme.ts:200,213`) is reproduced by styling `.monaco-hover` inside the host's scoped CSS with the
same tokens.

`editorHoverWidget.background`/`.border` in `defineTheme` carry the `--kira-bg-elevated` /
`--kira-border-strong` chrome that `.cm-tooltip-lint` (`:155`) supplied.

**Hover delay.** CodeMirror's `hoverTooltip` default and `workbench/state/tooltip.ts`'s
`TOOLTIP_DELAY_MS` are both 400 ms; Monaco's `hover.delay` default is 300. Set
`hover: { delay: 400, above: true }` so the app keeps one hover delay everywhere.

### 4.5 Diagnostics

`resolveLint` (`:195`) becomes a 400 ms-debounced call to `props.lintSource(model.getValue())` on
`onDidChangeContent`, mapped to `editor.setModelMarkers(model, 'kira', markers)` with
`severity: MarkerSeverity.Error | .Warning`.

**No gutter, no lint panel** (D24/D25 in `theme.ts:143`) — Monaco shows markers as a squiggle plus a
hover, which is exactly the current UI, and `glyphMargin: false` keeps the gutter clean. The themed
wavy underline (`--kira-error` / `--kira-warn`, `:147-154`) maps to `editorError.foreground` /
`editorWarning.foreground` in `defineTheme`, replacing CodeMirror's hard-coded raster squiggle for
the same stated reason.

The debounce stays at 400 ms and the reasoning stays true (`:194`): linting a whole document per
keystroke is not free.

### 4.6 Bracket/quote behaviour

Two distinct behaviours today, and Monaco covers both natively:

- **Wrap a non-empty selection in a typed pair** (`wrapSelection.ts`) → `autoSurround`. Monaco's own
  implementation already leaves a collapsed cursor alone, which is the whole point of the custom
  handler. **`wrapSelection.ts` is deleted, not ported** — this is a hand-rolled input handler whose
  stated reason for existing (`:4-11`) was that `closeBrackets()` also auto-closed an *empty*
  selection; Monaco separates the two options, so the reason is gone.
  - One behaviour to verify, not assume: `wrapSelection.ts:37` refuses to wrap a **whole-document**
    selection (Select-All-then-retype must replace, per `mongo.spec.ts`'s edit flow). Monaco's
    `autoSurround` has no such carve-out. If a real check shows it wraps, add a `beforeinput`-level
    guard on the host restoring exactly that rule. Flagged as **OQ-1**.
- **Auto-close an empty pair** (`autoCloseBrackets` prop, on for the request body and gRPC message
  only) → `autoClosingBrackets: 'languageDefined' | 'never'`, plus
  `autoClosingQuotes` matched to it. The console deliberately keeps this **off** so its lint can see
  an unterminated string (`wrapSelection.ts:8`) — that reason survives into P60b unchanged.

### 4.7 Undo — the regression this phase must not cause

Capability 7 is the one with a known past bug (v1.4 P3: Format, then one ⌘Z wiped the whole query).
Today's fix is `isolateHistory.of('full')` on the external-sync dispatch (`:347`).

Monaco's equivalent, and the required sequence for **every** external write:

```
model.pushStackElement();                    // close whatever group is open
model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: doc }], () => null);
model.pushStackElement();                    // open a fresh one
```

Both calls are mandatory — one alone leaves the write mergeable on one side. `model.setValue()` must
**not** be used: it discards the whole undo stack, which is a different bug (a saved-query load would
make everything before it un-undoable).

Keystroke grouping (`newGroupDelay: 500`) is Monaco's own default behaviour and needs no option.

`keepSelectionOnExternalSync` clamps the current offset into the new document before the edit and
restores it after, exactly as `:335` does.

The `externalSync` annotation (`:110`) becomes a plain `let applyingExternal = true/false` flag read
by the `onDidChangeContent` handler — same job, no annotation machinery.

### 4.8 Completion

`resolveAutocomplete` (`:171`) becomes a per-instance
`languages.registerCompletionItemProvider(languageId, provider)`, model-scoped the same way hover is.

| Today | Monaco |
| --- | --- |
| `override: sources` replaces language-data sources | our provider is the only one registered for `kira-mongo`/`kira-redis`; for `json`/`sql`/`xml` Monaco's Monarch contributes only word-based suggestions, disabled with `wordBasedSuggestions: 'off'` when `completionSources` is present |
| `activateOnTypingDelay: 0`, `interactionDelay: 0` (`:175`) | `quickSuggestions: { other: true, comments: false, strings: true }`, `quickSuggestionsDelay: 0` |
| `maxRenderedOptions: 25` | `suggest.maxVisibleSuggestions` is gone in modern Monaco; the popup is virtualised, so this cap has no equivalent and needs none |
| Enter dropped from the keymap, Tab accepts (`:159`) | `acceptSuggestionOnEnter: 'off'`, `tabCompletion: 'on'` |
| `Completion.type` → `.cm-completionIcon-*` glyphs (`theme.ts:114-132`) | `CompletionItemKind.Variable/Method/Function/Class/Keyword/Property` — Monaco ships codicon glyphs for each, from the same `@vscode/codicons` set this app already bundles |
| `Completion.boost` (PK columns first, `ddl.ts:369`) | `sortText` — a `'0'` prefix for boosted, `'1'` otherwise |
| `Completion.apply` (quoted identifier, `ddl.ts:419`) | `insertText` |
| `snippet('…#{}…')` for the six BSON constructors (`completion.ts:24`) | `insertText` with `$0`, `insertTextRules: InsertAsSnippet` — the `#{}` placeholder maps to `$0` one-for-one |
| `context.matchBefore(re)` | plain regex over `doc.slice(0, offset)` in each source; the `from` each source already returns becomes the replacement `range` |

The popup's chrome (`theme.ts:76-142`) maps to `editorSuggestWidget.background`/`.border`/
`.selectedBackground`/`.highlightForeground` in `defineTheme`.

### 4.9 `posAtCoords`, `scrollRangeIntoView`, `focus`

- `posAtCoords(x, y)` → `editor.getTargetAtClientPoint(x, y)`, then
  `model.getOffsetAt(target.position)`; `null` when the target has no position — matching
  `EditorView.posAtCoords`'s own contract (`:299`). **But see §5**: the overlay does not mount an
  editor at all, so this exposure is only needed if OQ-2 resolves toward a real editor instance.
- `scrollRangeIntoView(from, to)` → `editor.revealRangeInCenter(range)` — scroll only, no selection
  change, as `:304` requires.
- `focus()` → `editor.focus()`.

---

## 5. `AutocompleteField.vue`'s overlay — the one site that should not mount an editor

`AutocompleteField` stacks a **read-only, single-line, paint-only** `CodeMirrorHost` *behind* a real
`<input>` (`:158-169`). Its own doc comment (`:48-55`) states why the input must stay native: every
`locator.fill()` in the SQL/Mongo engine specs needs a real `<input>`.

Mounting a full Monaco editor per filter field — with its own cursor, scrollbars, view zones and
layout loop — to paint one line of text is the wrong shape. **D3: replace the overlay with
token-driven spans**, not an editor:

```
const html = await monaco.editor.colorize(text, monacoLanguageIdFor(language), { tabSize: 2 });
```

`colorize` (`monaco.d.ts:1388`) is Monaco's own standalone tokenize-to-HTML API — a library call,
not a hand-rolled highlighter — and it is `async`, which correctly handles
`registerTokensProviderFactory`'s lazy Monarch load (`monacoEntry.ts:53`). It returns HTML whose
spans carry `mtk*` classes the active theme already styles.

Two capabilities need care:

- **`rangeHighlights` on the overlay** (`{{variable}}` colouring on the URL/header fields — the
  overlay's *only* job when `language` is absent, `:79`). `colorize`'s HTML is offset-opaque, so
  interleaving ranges into it is fragile. Use `monaco.editor.tokenize(text, languageId)`
  (`monaco.d.ts:1398`) instead, which returns `Token[]` with offsets, merge those boundaries with
  the `RangeHighlight` boundaries in one pass, and emit `<span class="mtk… kira-ed-var">`. One pure
  function, `editor/paintSpans.ts`, unit-tested (this is boundary-merge arithmetic over two sorted
  interval lists — it clears CLAUDE.md's bar for a dedicated unit test; nothing else here does).
  `tokenize` is synchronous and returns a single plain-text token if the Monarch has not loaded yet,
  so the module is warmed once via `colorize` (or `languages.getEncodedLanguageId`) before first
  paint, and the overlay simply renders unstyled until then — the same graceful degradation §3.3
  describes.
- **`posAtCoords`** (`:126`, the hover hit-test). With spans instead of an editor, use
  `document.caretPositionFromPoint` / `caretRangeFromPoint` on the overlay and convert the resulting
  text node + offset to a document offset. This is DOM-native, exact, and font-agnostic — the two
  properties `:296-299` says it chose CodeMirror's hit-testing *for*. WebKit implements
  `caretRangeFromPoint`; verify on the real engine (`playwright --project=ui` runs WebKit).

Monaco is still loaded (lazily, shared) for `colorize`/`tokenize`, so a filter field on a fresh
session pulls the chunk. Accepted per D1.

**OQ-2** records the alternative if this proves fiddly: mount a real single-line Monaco with
`lineNumbers: 'off'`, `scrollbar: {vertical:'hidden',horizontal:'hidden'}`, `folding:false`,
`renderLineHighlight:'none'`, `readOnly:true`, `domReadOnly:true`, `contextmenu:false`. Heavier, but
gets `posAtCoords` and range decorations for free.

---

## 6. The merge view → Monaco's diff editor

`ResponseDiffDialog.vue` is the only `@codemirror/merge` consumer. Monaco's diff editor already
serves the identical requirement in this app (`RepoDiffView.vue`, C6), so this is a re-use, not a
new capability.

| `MergeView` option (`:176-183`) | Monaco `createDiffEditor` |
| --- | --- |
| side-by-side, scroll-locked, line-aligned | `renderSideBySide: true` (default; scroll lock and alignment are inherent) |
| `highlightChanges: true` (intra-line) | on by default — Monaco computes character-level diffs in `editor.worker` |
| `gutter: true` | `renderIndicators: true` |
| `collapseUnchanged: {}` | `hideUnchangedRegions: { enabled: true }` — already used at `RepoDiffView.vue`'s mount |
| both sides read-only | `readOnly: true` + `originalEditable: false`, plus `renderMarginRevertIcon: false` / `renderGutterMenu: false` (C6 §11's second layer — a read-only diff must not offer revert/apply widgets) |
| `languageExtension(commonFormat)` | model language `'json'` / `'xml'` / `'plaintext'` |
| `kiraEditorTheme` + `kiraHighlightStyle` | `theme: KIRA_EDITOR_THEME` |

**Nothing `@codemirror/merge` provides is lost.** Monaco's diff editor is a superset here: it also
has inline mode and a navigable change list, neither of which this dialog needs or will enable.

Models are created ad hoc (no URI) and disposed with the dialog, alongside the editor, in
`onUnmounted` — the dialog's existing `mergeView?.destroy()` (`:193`) becomes
`diffEditor?.dispose()` plus two `model.dispose()` calls. `mergeEntry.ts` is deleted;
`loadMonaco()` replaces `loadMerge()`, and `mergeLoading` keeps its existing "Loading the compare
view…" strip (`:291`) unchanged — it now covers a larger fetch, which is exactly what it is for.

The headers table (`:124-152`) is name-keyed and never used `@codemirror/merge`'s diff at all
(`:112-117` says so) — untouched.

---

## 7. Implementation steps

Sequential. One commit per numbered step unless stated.

1. **`editor/monaco.ts`** — move `loadMonaco`/`MonacoModule`/theme definition out of
   `views/repo/monaco.ts`; re-export from the old path so no repo file changes. Rename
   `REPO_THEME_NAME` → `KIRA_EDITOR_THEME`, keep the old export as an alias. `refactor:`.
2. **`editor/monacoTheme.ts`** — the full `defineTheme` colours + token rules from §4.1, applied
   inside `loadMonaco`. Verify the repo file/diff views still render with their existing colours
   (they now get token rules they did not have before — an improvement, but confirm nothing regresses).
3. **`monacoEntry.ts`: register `kira-mongo` + `kira-redis`** Monarch definitions (§4.2), behind
   `registerTokensProviderFactory`. `editor/monacoLanguages.ts` with `monacoLanguageIdFor`.
4. **`editor/completion.ts`** — the `EditorCompletion*` types (§3.1). No behaviour yet.
5. **`editor/MonacoHost.vue`** — the whole host: options, lifecycle, watchers, decorations, hover,
   markers, completion, undo boundaries, the exposed four methods, scoped CSS for
   `.kira-ed-*`/`.monaco-hover`/suggest widget. Largest single step; may land as 2-3 commits
   (skeleton + emits, then providers, then single-line CSS) but stays one continuous piece of work.
6. **Migrate the 11 simple read-only / plain-editable sites**: `RawExchangePane` (4),
   `DocumentView` (3), `OperationsPanel` (2), `ExplainResultView`, `PreviewCommandPanel`,
   `GenerateDataDialog`, `BulkVariablesEditor`, `EditRawRequestDialog`. Import + tag swap only.
7. **Migrate the rangeHighlight sites**: `DefinitionView`, `ResponsePane` (http), `ResponsePane`
   (grpc) — plus `scrollRangeIntoView` on the http one.
8. **Migrate the completion/hover sites**: `RequestBodyPane` (2), `GrpcRequestView`. Port
   `api/state/variableCompletion.ts`'s `variableHoverSource` (:288) and `variableCompletionSource`
   (:319) to the new pure shapes; `completionType` (:301) maps to `CompletionItemKind`.
9. **Migrate `CellEditorView`** (2 mounts, `lintSource` + `rangeHighlights` + runtime `readOnly`
   flip).
10. **`AutocompleteField.vue`** — the span-painting overlay and `caretPositionFromPoint`
    hit-test (§5), plus `editor/paintSpans.ts` and its unit test.
11. **`ResponseDiffDialog.vue`** → Monaco diff editor (§6). Delete `mergeEntry.ts`.
12. **Delete `@codemirror/merge`** from root `package.json`; `bun install`.
13. **Test rework** (§9) — the largest non-production step; land per spec file.
14. **Docs** (§10).

`CodeMirrorHost.vue`, `editor/theme.ts`, `editor/languages.ts`, `editor/hover.ts`,
`editor/variableHighlight.ts`, `editor/wrapSelection.ts` all survive P60a, used only by
`ConsoleView` and `SchemaDialog`. P60b deletes them.

---

## 8. Where the code lives

```
apps/kira-studio/frontend/src/editor/
  MonacoHost.vue          new — the host (§3)
  monaco.ts               new — loadMonaco, MonacoModule, moved from views/repo (§7.1)
  monacoTheme.ts          new — defineTheme colours + token rules (§4.1)
  monacoLanguages.ts      new — monacoLanguageIdFor (§4.2)
  completion.ts           new — EditorCompletion* types (§3.1)
  paintSpans.ts           new — token/range boundary merge for the overlay (§5)
  diagnostics.ts          unchanged
  findRanges.ts           unchanged
  searchPattern.ts        unchanged
  hover.ts                ConsoleHoverInfo + formatHoverValue kept; buildHoverSource deleted in P60b
  variableHighlight.ts    RangeHighlight kept; rangeHighlightPlugin deleted in P60b
  wrapSelection.ts        deleted once the console moves (P60b)
  CodeMirrorHost.vue      deleted in P60b
  theme.ts / languages.ts deleted in P60b
```

---

## 9. Testing

### 9.1 The selector rework

23 UI spec files carry 173 CodeMirror DOM selector occurrences across 169 lines:

| Selector | Count | Monaco equivalent |
| --- | --- | --- |
| `.cm-content` | 102 | `.monaco-editor .view-lines` for reading text; `.monaco-editor textarea.inputarea` for typing/click-to-focus |
| `.cm-tooltip-autocomplete` | 18 | `.suggest-widget.visible` |
| `.cm-lintRange-error` / `-warning` | 14 | `.squiggly-error` / `.squiggly-warning` |
| `.cm-kira-var*` | 12 | `.kira-ed-var*` (rename only) |
| `.cm-kira-hover` | 5 | `.monaco-hover` |
| `.cm-kira-find-match*` | 5 | `.kira-ed-find-match*` (rename only) |
| `.cm-line` | 5 | `.view-line` |
| `.cm-tooltip` (z-index/containment assertions) | 3 | `.monaco-hover` / `.suggest-widget` — the assertion becomes "escapes the pane and paints at `--kira-z-tooltip`", same property |
| `.cm-host` / `.cm-scroller` / `.cm-focused` | 6 | `.monaco-host` / `.monaco-scrollable-element` / `.monaco-editor.focused` |
| `.cm-merge-a` / `-b` | 3 | `.monaco-diff-editor .original` / `.modified` |

**Two real behavioural differences the rework must handle, not paper over:**

1. **Monaco virtualises lines.** `.cm-content` `innerText` returned the *whole* document;
   `.view-lines` returns only rendered lines. Every assertion reading a full document body
   (`http-history.spec.ts:401`, `mutations.spec.ts:269`, `fake-data.spec.ts:256`, …) must read the
   model instead. Add one helper to `tests/ui/support/`:
   `editorText(page, hostSelector)` → `page.evaluate` over `window.monaco.editor.getModels()`, or
   (cleaner, no global) a `data-testid`-addressed host exposing its text via a
   `__KIRA_DEBUG_HOOKS__`-gated attribute, matching `vite.config.ts:14`'s existing debug-hook
   convention. **Decide this once, in step 13, and use it everywhere** — a per-spec workaround here
   would be 23 different ones.
2. **`locator.fill()` does not work on Monaco.** It types into `textarea.inputarea` in some engines
   and silently no-ops in others. Every editor-typing call becomes click-then-`keyboard.type`, or
   sets the model text through the same debug hook. `http-request-body.spec.ts:25` already documents
   a `keyboard.type`-vs-`fill` distinction for CodeMirror; the Monaco rule is stricter.

`AutocompleteField`'s own `<input>` stays native, so every `fill()` on a filter/URL/header field is
**unaffected** — which is exactly why §5 keeps it native.

### 9.2 Unit tests

`tests/unit/find-ranges-memo.spec.ts` and `autocomplete-tokenizers.spec.ts` exercise CodeMirror-free
modules — unchanged. The four SQL-service unit specs (`ddl-schema`, `sql-cte-shadow`,
`sql-hover-no-reparse`, `hover-value-caption`) belong to P60b; only `hover-value-caption.spec.ts`
touches P60a's surface (`formatHoverValue`, kept verbatim) and should keep passing untouched.

**One new unit test**: `editor/paintSpans.ts`'s boundary merge (§5) — two sorted interval lists,
overlapping, with zero-width and out-of-range inputs. Everything else added in P60a is a thin
wrapper over a Monaco API and gets none, per CLAUDE.md.

### 9.3 Budgets

`tests/ui/budgets.spec.ts` measures a 50 ms click-to-DOM budget that explicitly includes
"CodeMirror's local (already-loaded-schema) autocomplete popup" (`:41`). The *console* popup is
P60b's, but the same file's other four scenarios mount editors. Re-run and record real numbers; do
not relax a budget without a stated reason.

---

## 10. Documentation to update

- `docs/ARCHITECTURE.md:32` — the "Text editing / viewing" row literally says *"CodeMirror … keeps
  that role: nothing here migrates to Monaco"*. P60 reverses that; rewrite the row, and line 47's
  "Viewer-only" claim about Monaco.
- `docs/ARCHITECTURE.md:29` — the lazy-chunk inventory: `@codemirror/merge`'s chunk is gone; record
  the measured new eager `index-*.js` size against the 520.66 kB gzip baseline in §2.1.
- `docs/PERF.md` §2.1 — if the budget numbers move.
- `docs/v1.6/mcp-repo-map-issues.md` — anything dogfooding the repo-map server turns up.

---

## 11. Explicitly out of scope

- The SQL console, the DDL editor, and everything in `views/console/*` except `ExplainResultView` —
  P60b.
- `@codemirror/lang-sql`'s Lezer parse tree and the nine remaining `@codemirror/*` packages — P60b.
- Any *new* editor feature (minimap, folding, multi-cursor UI, a command palette inside the editor).
  A migration ships the same features, not more.
- Monaco language *services* (`vs/language/*`). `monacoEntry.ts:60` keeps exactly one worker; that
  invariant is unchanged and must stay unchanged — a JSON or TypeScript service worker appearing in
  the build is a P60a failure.

---

## 12. Verification

### 12.1 Feature checklist — the acceptance bar

Every item from §1.2 that P60a owns, checked in the running app (`bun run dev`), one at a time.
This list *is* the definition of done; a build that passes is not.

**Rendering and colour**
- [ ] JSON body (`DocumentView`, `ResponsePane`) colours: keys, strings, numbers, punctuation — compare against a screenshot of the pre-change build.
- [ ] XML response colours: tags, attribute names, text.
- [ ] SQL preview (`PreviewCommandPanel`, `GenerateDataDialog`) colours keywords/strings/numbers.
- [ ] `plain` renders unstyled, no gutter surprises.
- [ ] Mongo filter field overlay colours `db`, `$op`, strings (via `kira-mongo`).
- [ ] Line-number gutter present on multi-line hosts, absent on `singleLine`.
- [ ] Word wrap follows Settings → Appearance → Word wrap, live, on an already-mounted host.
- [ ] Changing font family/size re-lays out every open editor.

**Editing**
- [ ] Typing in a request body emits `update:doc` once per keystroke; the parent's echo does not reset the caret.
- [ ] A saved/external write (e.g. Beautify) updates the editor without emitting `update:doc`.
- [ ] Caret move alone (click, arrow key) emits `update:cursor`.
- [ ] Read-only hosts refuse keyboard input *and* paste.
- [ ] `CellEditorView`'s truncated-value case flips a live host to read-only and the DOM reflects it.
- [ ] Type `(`/`[`/`{`/`'`/`"`/`` ` `` over a selection → wraps, does not replace.
- [ ] Select All, then type → **replaces** (OQ-1).
- [ ] Request body: typing `{` auto-closes. Elsewhere (cell editor, document view): it does not.
- [ ] Undo groups a run of typed characters into one step.
- [ ] **Beautify, then one ⌘Z → undoes only the beautify, not the typing before it.** (The v1.4 regression.)
- [ ] Redo restores it.

**Ranges, hover, lint, completion**
- [ ] `{{var}}` in a URL field overlay: resolved green, secret dotted-underlined, unknown wavy-warn.
- [ ] `{{var}}` in a request body: same three states.
- [ ] Hovering a resolved `{{var}}` shows the value block + muted caption, JSON pretty-printed.
- [ ] Hover appears after ~400 ms, not instantly.
- [ ] Hover escapes the pane's `overflow: hidden` and paints above every other layer.
- [ ] Typing `{{` in a request body opens the completion popup; ↑/↓ move; **Tab** accepts; **Enter** inserts a newline and does not accept.
- [ ] Popup chrome matches other floating panels (background, border, radius, shadow, data font).
- [ ] Popup icons render (variable/method), not a fallback glyph.
- [ ] Cell editor with an invalid JSON/SQL value: wavy error underline at the right offset, message on hover, no gutter marker, no lint panel.
- [ ] Find bar over a response body: every match tinted, current match solid, `scrollRangeIntoView` brings it into view.
- [ ] Hovering a `{{var}}` in a *filter field* (the span overlay) resolves the right token as the pointer crosses it.

**Merge view**
- [ ] History → select two → **Compare**: side-by-side, scroll-locked, line-aligned.
- [ ] Intra-line character differences highlighted.
- [ ] Unchanged regions collapsed.
- [ ] Both sides read-only; no revert arrow, no gutter menu.
- [ ] Two JSON bodies pretty-print before diffing; a JSON-vs-text pair shows the raw-bytes note and still diffs.
- [ ] Closing the dialog disposes the editor and both models (no leak — `tests/ui/leaks.spec.ts`).

**Lazy loading**
- [ ] A fresh session that opens only a data grid fetches **no** `monacoEntry-*.js`.
- [ ] Opening any editor surface fetches it exactly once; a second surface reuses it.
- [ ] During the first fetch, the surface shows its text as plain pre-formatted content, never an empty box.

### 12.2 Mechanical

```
bun run typecheck       # all five projects
bun run lint            # biome + check-tokens.sh
bun run build           # record index-*.js raw+gzip against 1 723.09 kB / 520.66 kB
bun run test:unit
bun run test:ui         # ui + ui-timing
bun run test:visual     # snapshots WILL move — review every diff, don't blind-update
```

Then: confirm `dist/assets/` contains **no** `dist-*.js` CodeMirror-merge chunk, and still exactly
one `editor.worker-*.js` and no `*.language.worker` / `ts.worker` / `json.worker`.

### 12.3 Manual recipe

1. `bun run dev`. Open a Postgres connection.
2. Data tab → click a cell → cell editor dock: colouring, edit, invalid-value squiggle.
3. Definition tab → Source pane → find bar → step through matches.
4. Api mode → new HTTP request → raw body: type `{{`, accept with Tab, hover the reference, Beautify, ⌘Z.
5. Send → response pane → find bar → History → select two → Compare.
6. gRPC request → message editor: same completion/hover/auto-close checks.
7. Documents tab (Mongo) → edit a document → JSON colouring, Select-All-and-retype.
8. Op log panel → expand a failed operation → detail rows render.
9. Data grid → WHERE field → Mongo/SQL overlay colouring, `{{var}}` hover.
10. DevTools Network: confirm one `monacoEntry` fetch, and none before step 2.

---

## 13. Open questions for a human

**OQ-1 — whole-document `autoSurround`.** `wrapSelection.ts:37` deliberately refuses to wrap a
Select-All selection (so Select-All-then-retype replaces, per `mongo.spec.ts`). Monaco's
`autoSurround` has no equivalent carve-out. Check the real behaviour first; if Monaco wraps, is a
small `beforeinput` guard on the host worth restoring the exact rule, or is the plain Monaco
behaviour acceptable? *Recommendation: restore the rule — an existing spec asserts it.*

**OQ-2 — the `AutocompleteField` overlay.** §5 proposes span painting via
`monaco.editor.tokenize` + `caretPositionFromPoint` rather than a real single-line Monaco instance.
Lighter and keeps the native `<input>` untouched, but it is app-owned paint code where today a
library does the painting. The alternative (a real read-only single-line Monaco per field) is
heavier per field but reuses the library for tokens, decorations *and* hit-testing.
*Recommendation: span painting — the overlay is genuinely paint-only, a full editor per filter field
is a poor fit, and the merge is one small, unit-tested pure function.*

**OQ-3 — the UI-test text-reading mechanism.** §9.1 needs one way to read an editor's **full**
document from Playwright now that lines are virtualised: (a) a `__KIRA_DEBUG_HOOKS__`-gated
per-host attribute/hook, or (b) `page.evaluate` over a `window.monaco` global. (a) matches
`vite.config.ts:14`'s existing convention and keeps production free of the hook; (b) needs Monaco
exposed globally, which it currently is not. *Recommendation: (a).*

**OQ-4 — Monaco for a DB-only session.** D1 accepts that opening a console/cell editor now fetches
~972 kB gzip on a session that may never open a repo workspace. Acceptable, or is a
lighter-weight path wanted for the read-only viewer surfaces (op-log rows, document bodies)?
*Recommendation: accept. Two engines is the cost P60 exists to remove, and the chunk is fetched once
per session, cached thereafter.*
