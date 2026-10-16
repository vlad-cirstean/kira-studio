# P67c — Monaco highlighting and widget theming, app-wide checkbox fix, markdown reading view

> **What this phase is.** `docs/v1.6/SPEC.md`'s P67c row, turned into concrete steps from direct
> reads of the real tree and of the pinned `monaco-editor@0.56.0` inside `node_modules`. Every file,
> line number, CSS selector and upstream API below was opened and checked, never recalled. Two of
> the four items turned out to have a *different* root cause than the symptom suggests; §0 states
> both corrections before anything is designed on top of them.

---

## 0. The brief, corrected

### 0.1 This app has no light theme

The planning brief says "doesn't match the app's own dark/light theme". There is no light theme.
Checked: `grep -rln "prefers-color-scheme\|data-theme" --include=*.css --include=*.ts --include=*.vue
apps/kira-studio/frontend/src` returns nothing, and `editor/monaco.ts:44-46` says so in its own
words — *"this app has one fixed (dark) visual design with no light/dark toggle today"*, which is
why `defineKiraTheme` hard-codes `base: 'vs-dark'`.

Consequence for this plan: every fix below targets **one** palette. No `@media
(prefers-color-scheme)` block, no second theme registration, no light-mode markdown stylesheet.
`packages/git-ui`'s own `vscode-tokens.css:198` does carry a light block (it also ships into a VS
Code extension host, which does have themes) — that file is not this app's concern and is not
touched.

### 0.2 "Transparent with black text" is not the context menu's own bug

The report reads as one complaint about right-click. Read against the tree it is two different
failures with two different causes, and only one of them is about the context menu:

- **Transparent background, unstyled text** is real, proven, and belongs to the **suggest / hover /
  parameter-hint widgets**, not the menu. `editor/monaco.ts:81-88` reparents every one of them into
  a `document.body`-level `<div class="kira-editor-overflow-widgets">`, and that div carries none of
  the three class names Monaco scopes its entire CSS-variable palette to. §3.1 proves this.
- **"Not themed like this app, very out of place"** is the context menu (and the find widget, the
  suggest rows, the peek view). Those render on `vs-dark`'s own built-in literals because
  `defineKiraTheme` supplies only 16 colour keys out of the ~40 those widgets read. §3.2.

Both fixes are needed, they are independent, and together they cover the menu whichever of the two
is actually producing the transparency the user saw. §3.5 states plainly what this container could
not verify and what the implementer must check live.

### 0.3 `package.json` and TS decorators are two unrelated bugs

Not one "highlighting is flaky" problem. JSON is *deliberately* coloured by the JavaScript grammar
(§2.1) and TypeScript's `@` genuinely tokenizes as `invalid` — **red** (§2.2). Both are exact,
reproducible, and fixed separately.

---

## 1. Confirmed current state

### 1.1 The Monaco bootstrap, end to end

| File | Role |
| --- | --- |
| `frontend/src/views/repo/monacoEntry.ts` | The sole `import` of `monaco-editor`. Re-exports `editor/editor.api.js`, pulls `features/register.all.js`, registers 19 languages + `json` + `kira-mongo` + `kira-redis`, exports the one worker. |
| `frontend/src/editor/monaco.ts` | `loadMonaco()` (memoised dynamic import), `wireWorker`, `cssVar`/`normalizeColor`, `overflowWidgetsContainer()`, `KIRA_EDITOR_THEME`. |
| `frontend/src/editor/monacoTheme.ts` | `defineKiraTheme(mod)` — one `editor.defineTheme` call: 23 token rules + 16 colour keys. |
| `frontend/src/editor/MonacoHost.vue` | The generic host (console, HTTP/gRPC bodies, cell editor, …). `applyBaseOptions()` at `:353-387`; `editor.create` at `:397-401`. |
| `frontend/src/views/repo/RepoFileView.vue` | The repo workspace's file viewer. Own `editor.create` at `:71-91`. No `MonacoHost`. |
| `frontend/src/views/repo/RepoDiffView.vue` | Same shape, diff editor. |
| `frontend/src/views/repo/language.ts` | `monacoLanguageFor(path)` — the extension→language-id table. |

Note the asymmetry that matters twice below: **only `MonacoHost.vue` passes
`overflowWidgetsDomNode`** (`:369`, the single call site — confirmed with `find_references` on
`overflowWidgetsContainer`). `RepoFileView.vue` and `RepoDiffView.vue` do not, so their widgets stay
inside `.monaco-editor` and are themed. That is exactly the user's "broken in **most** places".

### 1.2 What `monaco-editor@0.56.0` actually ships

- `esm/vs/languages/definitions/` holds **84** language definitions. `monacoEntry.ts:27-45`
  imports **19** of them.
- **There is no `json` definition** (`ls .../definitions/json*` → no such file). `monacoEntry.ts:52-57`
  therefore registers `json` by hand and points its tokenizer factory at
  `languages/definitions/javascript/javascript.js`.
- **But there is a worker-free JSON tokenizer**:
  `esm/vs/languages/features/json/tokenization.js` exports `createTokenizationSupport(supportComments)`.
  Its only import is `../../../../external/jsonc-parser/lib/esm/main.js` (present at
  `esm/external/jsonc-parser`). It does **not** touch `jsonMode.js`, `workerManager.js` or
  `json.worker.js`. §2.1 depends on this.
- `javascript.js:67` is `tokenizer: language$1.tokenizer` — JavaScript and TypeScript share **one
  tokenizer object**. One patch covers both (§2.2).
- All 84 `register.js` modules together are **20,111 bytes** of source; the 19 currently imported
  are **4,944 bytes** (`cat */register.js | wc -c`). Each is a 7-line `registerLanguage({id,
  extensions, aliases, loader: () => import('./x.js')})` — every grammar body stays behind its own
  lazy `import()`. The delta for registering all 84 is ~15 KB raw, comfortably under 5 KB gzipped,
  inside a chunk that is already lazy. §2.3 spends it.

### 1.3 How a theme colour reaches a widget — the one selector that decides everything

`esm/vs/editor/standalone/browser/standaloneThemeService.js:332-339`:

```js
const colorVariables = [];
for (const item of colorRegistry.getColors()) {
    const color = this._theme.getColor(item.id, true);
    if (color) { colorVariables.push(`${asCssVariableName(item.id)}: ${color.toString()};`); }
}
ruleCollector.addRule(`.monaco-editor, .monaco-diff-editor, .monaco-component { ${colorVariables.join('\n')} }`);
```

Every `--vscode-*` custom property Monaco defines lives **only** under those three class names.
Outside them the properties do not exist, and any `background-color: var(--vscode-menu-background)`
falls back to its initial value.

The three consumers this matters for:

- Monaco's context view sets its own class: `base/browser/ui/contextview/contextview.js:122` —
  `this.view.className = 'context-view monaco-component'`. So a context menu **is** inside the
  scope.
- The suggest widget's stylesheet
  (`editor/contrib/suggest/browser/media/suggest.css`) reads
  `--vscode-editorSuggestWidget-{background,foreground,border,highlightForeground,focusHighlightForeground,selectedForeground,selectedIconForeground}`.
- The menu widget has **no `.css` file at all** — `base/browser/ui/menu/` contains only `menu.js`,
  which generates its CSS at runtime (`getMenuWidgetCSS`, `:750+`) from `defaultMenuStyles`
  (`platform/theme/browser/defaultStyles.js:180-194`), every value of which is
  `var(--vscode-menu-*)` / `var(--vscode-list-*)`.

### 1.4 `vscode-bridge.css` already declares `--vscode-*` at `:root`

`frontend/src/theme/vscode-bridge.css` (imported from `theme/base.css:11`) defines ~35 `--vscode-*`
names on bare `:root` so `packages/git-ui` renders in Kira's palette. Its own header says why.

This is a **partial** set — it has `--vscode-list-hoverBackground`, `--vscode-focusBorder`,
`--vscode-input-background`, `--vscode-editor-background` and so on; it has **no**
`--vscode-editorSuggestWidget-*` and **no** `--vscode-menu-*`. That asymmetry is what turns "no
theme" into "half a theme" in §3.1, and it is why the widget looks *partly* painted rather than
plainly unstyled.

`:root` and `.monaco-component` have identical specificity (0,1,0), so inside Monaco's own scope the
winner is document order. Monaco's stylesheet is created at runtime (`_registerRegularEditorContainer`,
`standaloneThemeService.js:228-236`) and appended to `document.head` after the bundled CSS, so Monaco
wins today. §3.3 treats that as a live hazard, not a guarantee.

### 1.5 The checkbox surfaces

- The app's own primitive: `theme/primitives/Checkbox.vue` + `.p-check` in
  `theme/primitives.css:283-323` (the `margin-top` at `:290`). A real `<input type="checkbox">` with `appearance: none`, drawn
  border/background, and a `CodiconIcon` glyph overlay. Used by 11 files.
- **`packages/git-ui` uses 14 raw, completely unstyled `<input type="checkbox">`** across 9 dialogs
  (`RepoSettingsDialog` ×4, `StashDialog` ×2, `TagDialog` ×2, `BranchDialog`, `RevertDialog`,
  `WorktreeDialog`, `CherryPickDialog`, `ForcePushDialog`, `ResetDialog`). `grep -rn "checkbox\|accent-color"
  packages/git-ui/src --include=*.css` returns **nothing**. There is no checkbox styling in that
  package at all. §4.1.
- SlickGrid's theme (`views/shared/slick/slickTheme.css`) contains no checkbox rule and the grid
  uses none — not a surface here.

### 1.6 The repo file view has no chrome

`RepoFileView.vue`'s template (`:190-212`) is a bare `<div ref="container" class="monaco-host">`
filling 100% height, plus four `EmptyState` branches. There is no toolbar, header or slot. Item 4's
toggle therefore needs new chrome, built from existing primitives (§5.2).

### 1.7 There is no renderer-supplied-URL opener, deliberately

`internal/bridge/update.go:46-48` — `OpenReleasePage()` is **nullary**, and its own comment says
*"never a renderer-supplied URL"*. `internal/appupdate/checker.go:171-174` explains why:
*"BrowserManager.OpenURL (pkg/application) validates nothing at all, and macOS `open` will act on
any scheme it recognises."* This decides §5.4 and §9.

---

## 2. Item 1 — syntax highlighting

### 2.1 D1 — JSON: use Monaco's own worker-free JSON tokenizer

**What is wrong.** `monacoEntry.ts:52-57` colours `.json`/`.jsonc` with the JavaScript Monarch
grammar. That grammar has one `string` rule, so in

```json
{ "name": "kira-studio", "private": true }
```

`"name"` and `"kira-studio"` both emit `string` and get `--kira-syntax-string` (#ce9178). Every key
and every value is the same orange. That is precisely "a package json isn't highlighted properly" —
VS Code paints keys `--kira-syntax-property` (#9cdcfe) and values orange.

**The fix.** `languages/features/json/tokenization.js` (§1.2) already distinguishes them:
`TOKEN_PROPERTY_NAME = "string.key.json"` vs `TOKEN_VALUE_STRING = "string.value.json"`, plus
`keyword.json` for `true`/`false`/`null`, `number.json`, `delimiter.{bracket,array,colon,comma}.json`
and `comment.{line,block}.json`. It is a real `TokensProvider` (`getInitialState` + `tokenize`), and
`monaco.d.ts:6965-6967` declares `TokensProviderFactory.create(): ProviderResult<TokensProvider |
EncodedTokensProvider | IMonarchLanguage>` — so it drops straight into the existing lazy-factory
registration with no shape change.

Replace `monacoEntry.ts:46-57` (the D9 comment block and the registration it explains) with:

```ts
// D9's JavaScript-grammar fallback is no longer needed. 0.56.0 ships no `languages/definitions/
// json`, but it does ship a standalone JSON tokenizer under `languages/features/json` whose only
// dependency is the bundled jsonc-parser scanner — no `jsonMode`, no `workerManager`, no
// `json.worker`, so D7's one-worker guard is untouched. Unlike the JavaScript Monarch it tells a
// property name (`string.key.json`) apart from a string value (`string.value.json`), which is the
// whole of what a package.json looked wrong for.
languages.register({ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON', 'json'] });
languages.registerTokensProviderFactory('json', {
  // `true` = tolerate comments: `.jsonc` shares this id, and a commented tsconfig.json is
  // ordinary. Strict JSON is unaffected — the scanner only ever *additionally* recognises them.
  create: async () =>
    (await import('monaco-editor/languages/features/json/tokenization.js')).createTokenizationSupport(
      true,
    ),
});
```

**Verify the import path resolves** before anything else: `monaco-editor`'s `exports` map is
`{"./*.js": "./esm/vs/*.js"}`, so `monaco-editor/languages/features/json/tokenization.js` →
`node_modules/monaco-editor/esm/vs/languages/features/json/tokenization.js`. That file exists.

**No worker is added.** This is the D7 constraint `editor/monaco.ts:16-24` enforces at runtime
(``wireWorker` (`editor/monaco.ts:16-24`) throws on any label but `editorWorkerService`). Importing
`languages/features/json/register.js` instead **would** pull the worker and trip that guard — do not.

### 2.2 D2 — TypeScript/JavaScript decorators tokenize as `invalid` (red)

**What is wrong.** Walk `typescript.js`'s `common` rule list (`:209-260`) against the character `@`:

| Rule | Matches `@`? |
| --- | --- |
| `/#?[a-z_$][\w$]*/` | no |
| `/[A-Z][\w\$]*/` | no |
| `@whitespace`, the regexp lookahead, `/[()\[\]]/`, `/[<>](?!@symbols)/`, `/!(?=([^=]\|$))/` | no |
| `/@symbols/` where `symbols: /[=><!~?:&\|+\-*\/\^%]+/` | **no** — `@` is not in that class |
| numbers, `/[;,.]/`, the three string openers | no |

Nothing matches, so Monarch falls through to `defaultToken` — and `typescript.js:67` sets
`defaultToken: "invalid"`. `monacoTheme.ts:54` maps `invalid` to `--kira-syntax-invalid` (#f14c4c).
**`@Component` therefore renders as a red `@` followed by a `type.identifier` `Component`.** (The
`operators` array does list `"@"`, but `operators` is only consulted *inside* the `@symbols` case,
which `@` never reaches.)

**The fix.** Prepend one rule emitting a `annotation` token, matching how Monaco's own Java grammar
already does it (`java/java.js:172-173` — `[/@\s*[a-zA-Z_\$][\w\$]*/, "annotation"]`). Python is
already fine (`python/python.js:210` — `[/@[a-zA-Z_]\w*/, "tag"]`), so this is genuinely a TS/JS-only
gap.

New file `frontend/src/views/repo/monarch/decorators.ts`:

```ts
type MonarchLanguage = import('monaco-editor').languages.IMonarchLanguage;

// 0.56.0's TypeScript Monarch has no rule for `@` at all — not in `common`, and not in `symbols`
// (`/[=><!~?:&|+\-*\/\^%]+/`), so a decorator falls through to `defaultToken: "invalid"` and paints
// red. Java's own grammar already uses the `annotation` token for `@Foo`, so this reuses that name
// rather than inventing one. Returns a shallow clone: `javascript.js` is `tokenizer:
// language.tokenizer` — the *same object* as TypeScript's — so mutating in place would edit a
// module-level export shared by both registrations.
export function withDecorators(language: MonarchLanguage): MonarchLanguage {
  const common = language.tokenizer?.common as unknown[] | undefined;
  if (!common) return language; // upstream restructured the grammar — leave it alone, never throw
  return {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      common: [[/@[a-zA-Z_$][\w$]*/, 'annotation'], ...common],
    },
  };
}
```

`monacoEntry.ts` then stops relying on `definitions/typescript/register.js` and
`definitions/javascript/register.js` for these two ids, and registers them itself with the wrapped
grammar — same lazy-factory shape as `json` and `kira-mongo` above it, so nothing loads earlier than
it does today:

```ts
languages.register({
  id: 'typescript',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  aliases: ['TypeScript', 'ts', 'typescript'],
});
languages.registerTokensProviderFactory('typescript', {
  create: async () =>
    withDecorators(
      (await import('monaco-editor/languages/definitions/typescript/typescript.js')).language,
    ),
});
// javascript: same, with extensions ['.js','.jsx','.mjs','.cjs'] and `javascript/javascript.js`.
```

Both must also keep the language **configuration** (brackets, comments, auto-closing pairs) that
`register.js` would have set — `languages.setLanguageConfiguration(id, conf)` with the `conf` export
from the same module, inside the same lazy `import()`. Read `definitions/typescript/register.js` and
mirror exactly what it does; do not guess.

**Theme rule.** `monacoTheme.ts`'s `tokenRules()` gains
`{ token: 'annotation', foreground: bare(fn) }` — `--kira-syntax-function` (#dcdcaa), which is what
VS Code Dark+ paints a decorator. This also fixes Java `@Override`, which today has no rule at all
and falls back to `editor.foreground`.

### 2.3 D3 — the third gap: 19 registered languages against 84 shipped

SPEC's row asks for *every* registration gap, not the two reported. This is the big one: a `.c`,
`.cpp`, `.cs`, `.rb`, `.php`, `.kt`, `.swift`, `.lua`, `.ps1`, `.bat`, `.dart`, `.scala`, `.ex`,
`.clj`, `.hs`, `.r`, `.jl`, `.tf`, `.sol`, `.pug`, `.hbs`, `.m`, `.pl`, `.tcl`, `.vb`, `.fs`, `.st`,
`.sv`, `.wgsl`, `.bicep`, `.mdx`, `.rst` file opens today as **`plaintext`** — genuinely
unhighlighted. That, not a subtle mis-colour, is most of "syntax highlighting is hit or miss".

Two edits, both mechanical:

1. **`monacoEntry.ts`**: replace the 19 individual
   `import 'monaco-editor/languages/definitions/<x>/register.js'` lines with
   `import 'monaco-editor/languages/definitions/register.all.js'` — upstream's own bundle. Cost
   measured in §1.2: ~15 KB raw added to an already-lazy chunk, with every grammar body still behind
   its own `loader: () => import()`. The two hand-registered ids (`typescript`, `javascript`, §2.2)
   must be registered **before** this import so the first registration wins; verify that ordering
   holds in a real run (`languages.getEncodedLanguageId`/`getLanguages()` in the console) rather than
   assuming it.
   - `register.all.js` also registers upstream's own `redis`, `mysql`, `pgsql`, `redshift`. None
     collides with this app's `kira-redis`/`kira-mongo` — which is the exact reason `monacoEntry.ts:64-72`
     prefixed them.
2. **`views/repo/language.ts`**: extend `EXTENSION_LANGUAGE` with one entry per newly-available
   grammar. Keep the file's own stated invariant ("one file, one vocabulary" — its header comment,
   shared with `tabKinds.ts`'s `repoFileIcon` at `state/tabKinds.ts:176-182`), and keep the two
   deliberate overrides its comment records (`vue`/`svelte` → `html`, `toml` → `ini`; Monaco ships
   no grammar for any of the three — verified against the 84-entry listing).

   Take each id's real extension list from that language's own `register.js` (`extensions: [...]`),
   not from memory.

**Considered and declined: derive the table from `mod.languages.getLanguages()` at runtime.** It
would be drift-proof, and `RepoFileView.vue:58`/`RepoDiffView.vue` already hold `mod` before they
need the id. But `language.ts`'s second consumer, `state/tabKinds.ts:177` `repoFileIcon`, is a
**synchronous** tab-strip icon function that must never await or import Monaco — so a runtime
registry would fork the one vocabulary into two, which is the exact thing this file exists to
prevent. A static table also has to resolve extension collisions (`.m`, `.h`, `.pl`, `.st`)
deliberately rather than by registration order. Declined on that basis, not because the static table
already works.

### 2.4 D4 — the theme rules the new tokens need

`monacoTheme.ts`'s `tokenRules()` matches by dotted prefix, so today's `{ token: 'string' }` swallows
`string.key.json`. Add, in this order (later rules win in Monaco's theme trie, and the more specific
scope must come after the general one):

| token | `--kira-syntax-*` | why |
| --- | --- | --- |
| `string.key` | `property` (#9cdcfe) | §2.1 — the whole point of the JSON change |
| `string.value` | `string` (#ce9178) | explicit, so it can never inherit `string.key` |
| `annotation` | `function` (#dcdcaa) | §2.2, plus Java `@Override` |
| `type.identifier` | `keyword` (#569cd6) | TS/JS emit this for any `[A-Z]…` identifier; today it matches the existing `type` rule already — **verify** before adding, and drop this row if it is redundant |

The existing `{ token: 'key' }` rule (`monacoTheme.ts:42`) is dead once `string.key` exists — check
with `grep -rn "'key'" node_modules/monaco-editor/esm/vs/languages/definitions/` whether any
registered grammar still emits a bare `key` token, and delete the rule only if none does.

### 2.5 What is **not** wrong (checked, so a later pass does not re-investigate)

- `vue`/`svelte` → `html` and `toml` → `ini`: deliberate, and still correct — the 84-entry listing
  has no grammar for any of the three.
- Python and Java decorators/annotations: already handled by their own grammars (§2.2).
- `internal/codeworkspace/files.go:177-229`'s `languageFor` mirrors the same table — but
  `FileContent.Language` has **no consumer**: `RepoFileView.vue:65` computes its own via
  `monacoLanguageFor(props.tab.path)` and ignores `content.language`, and a repo-wide grep finds no
  other reader. Left untouched; see OQ-3.

---

## 3. Item 2 — the context menu and the autocomplete widget

### 3.1 Root cause A (proven) — the overflow container sits outside every theme selector

```ts
// editor/monaco.ts:80-88
export function overflowWidgetsContainer(): HTMLElement {
  if (!overflowContainer) {
    overflowContainer = document.createElement('div');
    overflowContainer.className = 'kira-editor-overflow-widgets';
    document.body.appendChild(overflowContainer);
  }
  return overflowContainer;
}
```

That class is not `monaco-editor`, `monaco-diff-editor` or `monaco-component`, so by §1.3 **not one
`--vscode-*` property Monaco emits exists inside this container.** Every widget `MonacoHost.vue:369`
reparents there — suggest, hover, parameter hints, sticky widgets — loses its whole palette.

What survives is exactly `vscode-bridge.css`'s `:root` subset (§1.4): the suggest list's *rows* still
get `--vscode-list-hoverBackground` / `--vscode-list-activeSelectionBackground`, while
`--vscode-editorSuggestWidget-background` and `-foreground` resolve to nothing — the widget box is
transparent and its text falls back to inherited colour. A half-painted popup, which is what
"transparent with black text" describes.

That `MonacoHost` is the only call site (§1.1) is also why the repo file view's own suggest widget
looks fine — "broken in most places", not all.

**Upstream's own convention confirms the fix.** `editor/browser/widget/multiDiffEditor/multiDiffEditorWidgetImpl.js:54`
builds its overflow node as `h('div.monaco-editor@overflowWidgetsDomNode', {})` — i.e. Monaco itself
puts `monaco-editor` on the element it passes to `overflowWidgetsDomNode`.

**D5.** `overflowWidgetsContainer()` sets `className = 'monaco-editor kira-editor-overflow-widgets'`,
with a comment naming `standaloneThemeService.js:339` as the reason and `multiDiffEditorWidgetImpl.js:54`
as the precedent. The app-owned class stays — `MonacoHost.vue`'s `:global(.monaco-hover …)` /
`:global(.suggest-widget …)` rules (`:674-693`) are keyed off the widget classes, not this one, so
they are unaffected; re-read them after the change and delete any that the theme now covers.

### 3.2 Root cause B (proven) — 16 colour keys where ~40 are read

`defineKiraTheme` (`editor/monacoTheme.ts:61-90`) supplies `editor.*`, `editorWidget.*`,
`editorHoverWidget.*`, `editorError/Warning`, `focusBorder` and four `editorSuggestWidget.*` keys.
Everything else resolves from `base: 'vs-dark'`'s own literals. So:

- the **context menu** paints `menu.background` → `dropdown.background` → vs-dark `#3C3C3C`, against
  an app whose elevated surface is `--kira-bg-elevated` `#202020`;
- the **suggest widget** has no `editorSuggestWidget.foreground` at all, so its text is vs-dark's
  `editor.foreground` rather than `--kira-fg`;
- the **list rows inside it**, the **find widget**, the **peek view** and the **scrollbars** are all
  vs-dark.

That is the "very out of place" half, verbatim.

**D6.** Extend `defineKiraTheme`'s `colors` map. The key set below is not invented — each name was
read out of the stylesheet or default-style object that consumes it (§1.3). Map each from an existing
`--kira-*` token; invent no new token and no new literal, following `vscode-bridge.css`'s own rule.

| Monaco colour key | source token |
| --- | --- |
| `menu.background`, `menu.selectionBackground`, `menu.selectionForeground`, `menu.foreground`, `menu.separatorBackground`, `menu.border` | `--kira-bg-elevated`, `--kira-hover`, `--kira-fg`, `--kira-fg`, `--kira-border`, `--kira-border-strong` |
| `editorSuggestWidget.foreground`, `.selectedForeground`, `.focusHighlightForeground`, `.selectedIconForeground` | `--kira-fg`, `--kira-fg`, `--kira-syntax-function`, `--kira-fg-muted` |
| `editorSuggestWidgetStatus.foreground` | `--kira-fg-muted` |
| `list.hoverBackground`, `list.hoverForeground`, `list.activeSelectionBackground`, `list.activeSelectionForeground`, `list.focusBackground`, `list.focusOutline`, `list.highlightForeground` | `--kira-hover`, `--kira-fg`, `--kira-select`, `--kira-accent-fg`, `--kira-select`, `--kira-focus`, `--kira-syntax-function` |
| `dropdown.background`, `dropdown.foreground`, `dropdown.border` | `--kira-bg-input`, `--kira-fg`, `--kira-border` |
| `input.background`, `input.foreground`, `input.border` | `--kira-bg-input`, `--kira-fg`, `--kira-border` |
| `editorWidget.foreground` | `--kira-fg` |
| `widget.border`, `widget.shadow` | `--kira-border-strong`, *see the alpha note below* |
| `scrollbarSlider.background`, `.hoverBackground`, `.activeBackground` | `--kira-scrollbar` (×3) — *alpha note* |
| `peekViewEditor.background`, `peekViewResult.background`, `peekViewTitle.background` | `--kira-bg`, `--kira-bg-elevated`, `--kira-bg-chrome` |
| `editor.findMatchBackground`, `editor.findMatchHighlightBackground` | `--kira-search-match-current`, `--kira-search-match` — *alpha note* |
| `textLink.foreground`, `textLink.activeForeground` | `--kira-info`, `--kira-info` |

**The alpha trap — this will silently paint things red if missed.** `defineTheme`'s `colors` values
go through `Color.fromHex` (`StandaloneTheme.getColors()`, `standaloneThemeService.js:70-86`), which accepts only `#RGB` / `#RGBA` /
`#RRGGBB` / `#RRGGBBAA` and returns **red** (not an exception) on anything else. `cssVar()`
normalizes through a canvas `fillStyle`, which returns `#rrggbb` for an opaque colour but
`rgba(r, g, b, a)` for a translucent one. Three of the tokens above are translucent —
`--kira-scrollbar: #79797966`, `--kira-search-match` and `--kira-search-match-current` (both
`color-mix(… transparent)` — `tokens.css:30-31`). No existing key hits this, which is why it has
never bitten.

So `editor/monaco.ts`'s `normalizeColor` gains an `rgba()` → `#RRGGBBAA` branch (a few lines, beside
the existing canvas normalizer at `editor/monaco.ts:52-62` and its C6/P60a comment), and `defineKiraTheme` may then map
translucent tokens safely. Do not work around it by dropping those keys.

### 3.3 Risk C — `:root`-scoped `--vscode-*` ties with Monaco's own scope

§1.4: `vscode-bridge.css` declares ~35 `--vscode-*` names at `:root` at the same specificity as
Monaco's `.monaco-editor, .monaco-diff-editor, .monaco-component` rule; only document order
separates them, and Monaco's sheet is appended at runtime so Monaco currently wins. After D5 the
overflow container joins that scope, so the tie starts applying to every reparented widget too.

Once D6 lands, the two sides agree by construction on every overlapping name (both derive from the
same `--kira-*` tokens), so a flip in order becomes cosmetically harmless. **Do not** restructure
`vscode-bridge.css` in this phase — moving those declarations off `:root` is a `packages/git-ui`
contract change with its own blast radius. Record it instead: one line under
`docs/ARCHITECTURE.md`'s "Known open items", stating the tie and why it is currently benign.

### 3.4 D7 — where the fixes live

| Change | File |
| --- | --- |
| D5 — class the overflow container | `frontend/src/editor/monaco.ts:81-88` |
| alpha-aware `normalizeColor` | `frontend/src/editor/monaco.ts:52-62` |
| D6 — the colour map | `frontend/src/editor/monacoTheme.ts:66-89` |
| D4 — the token rules | `frontend/src/editor/monacoTheme.ts:11-56` |
| prune any now-redundant `:global()` override | `frontend/src/editor/MonacoHost.vue:674-693` |

No new file, no new CSS file, no hand-rolled override fighting Monaco's DOM. That is the whole point
of using the theme API the app already calls.

### 3.5 What this container could not verify, and what the implementer must do

There is no browser in this planning container (`~/.cache/ms-playwright` is empty), so the *visual*
claim "the context menu specifically is transparent" could not be reproduced. What is proven is the
mechanism (§1.3), the unclassed container (§3.1) and the missing keys (§3.2).

Before closing the phase, in a real run of the app:

1. Right-click inside an HTTP request body editor (a `MonacoHost`) and in a repo file tab.
   `getComputedStyle($0).getPropertyValue('--vscode-menu-background')` on the
   `.context-view.monaco-component` element must be non-empty and equal `--kira-bg-elevated`.
2. Trigger autocomplete in the console. Same check for `--vscode-editorSuggestWidget-background` on
   `.suggest-widget`, and confirm its DOM ancestor `.kira-editor-overflow-widgets` now also carries
   `monaco-editor`.
3. If the menu is *still* unpainted after both fixes, the remaining suspect is CSS load order
   (§3.3) — check whether `theme/vscode-bridge.css` is being injected *after* Monaco's
   `<style class="monaco-colors">` in that build mode before designing anything else.

---

## 4. Item 3 — checkboxes

### 4.1 Root cause — 14 unstyled native checkboxes in `packages/git-ui`

§1.5. The app's own `.p-check` is styled; git-ui's nine dialogs render bare
`<input type="checkbox">` inside `<label class="kv-dialog-field kv-dialog-field--inline">`, e.g.
`RepoSettingsDialog.vue:221`. A native checkbox draws the platform's own light widget, at the
platform's own size, with the platform's own baseline — visibly foreign in a #1f1f1f app, in exactly
the module the user has been dogfooding all phase. That is "the checkboxes style all across the app
are broken".

Each of the nine dialogs declares its own **scoped** `.kv-dialog-field` block, so a per-dialog fix
would be nine near-identical edits — the opposite of what SPEC's row asks for ("fixes it in one
place").

### 4.2 D8 — one rule in git-ui's own shared stylesheet, in `--kv-*` vocabulary

`packages/git-ui/src/theme/app-shell.css` is already the package's one document-level stylesheet
(imported once from `src/main.ts:10`) and already owns exactly this kind of unscoped,
whole-package rule. Add a checkbox block there.

Constraints, all load-bearing:

- **Use git-ui's own token vocabulary, never `--kira-*`.** The package renders in two hosts (this
  app and the VS Code extension) and reads `--kv-*` / `--vscode-*`. The tokens needed already exist:
  `--kv-input-bg` (`vscode-tokens.css:21`), `--kv-input-border` (`:22`), plus
  `--vscode-button-background` / `--vscode-button-foreground` / `--vscode-focusBorder` for the
  checked fill, glyph and focus ring.
- **Visual parity with `.p-check`, not a second design**: 14px box (git-ui has no
  `--kira-control-inline-h` equivalent — use a literal with a comment naming `.p-check` as the
  source), 3px radius, 1px border, `appearance: none`.
- **The check glyph comes from the codicon font, not a sibling element** — git-ui already imports
  the upstream stylesheet wholesale (`packages/git-ui/src/icons/codicon.css`), so
  `input[type="checkbox"]:checked::after { font-family: codicon; content: "\eab2"; }` works
  (`@vscode/codicons/dist/codicon.css:216` is `.codicon-check:before { content: "\eab2" }`). This is
  what lets the fix be CSS-only against the existing raw inputs, with no component and no markup
  churn across nine files.
- **Scope it to the package's own root** (`.kv-app input[type="checkbox"]`, or whichever class
  `main.ts`'s mount root actually carries — read it, do not assume) rather than a bare
  `input[type="checkbox"]`, so the rule can never reach into the host app's `.p-check`.
- Cover `:checked`, `:disabled`, `:focus-visible`. No `:indeterminate` — no git-ui checkbox uses it.

### 4.3 D9 — the one real defect in `.p-check` itself

`primitives.css:290` — `.p-check { margin-top: var(--kira-s-1); }` (2px). Its comment says this
exists so *"a checkbox beside a wrapped label sits flush with the label's first line"*, which is
correct in an `align-items: flex-start` row and wrong in an `align-items: center` one, where it
pushes the box 2px below its label.

Audit the 11 `<Checkbox>` call sites; if the flex-start case no longer exists, delete the
`margin-top` and its comment. If it does, move the 2px onto that call site instead of keeping it as
a default every other site has to fight. **Do not delete it unverified** — the comment names a real
layout, and this is a two-line change either way.

Nothing else about `.p-check` is broken: `appearance: none` plus explicit `border`/`background`
outranks Tailwind v4's preflight (element-selector specificity), and `primitives.css` is unlayered
while preflight sits in `@layer base`, so the cascade is not in question.

---

## 5. Item 4 — the markdown reading view

### 5.1 D10 — `markdown-it`, pinned, with `html: false`

CLAUDE.md's library-first rule is unambiguous here; a Markdown parser is the textbook case. Two
candidates were compared at the package level **and at the feature level**:

| | `markdown-it@15.0.2` | `marked@18.0.13` |
| --- | --- | --- |
| licence | MIT | MIT |
| paid/Enterprise tier | none | none |
| raw HTML in source, **by default** | **escaped** (`html: false`) | **passed through** |
| bundled types | yes — `dist/markdown-it.d.mts` | yes |

The third row decides it. This view renders files straight off the user's disk inside a WKWebView
that hosts the app's own privileged bridge; a `README.md` containing `<img src=x onerror=…>` must
not execute. `markdown-it`'s default escapes it with no second dependency, so **no DOMPurify, no
sanitizer to configure, no sanitizer to get wrong**. `marked` would need one bolted on — more
surface for the same result.

Add `"markdown-it": "15.0.2"` to the **root** `package.json` `dependencies` (exact version, matching
every existing pin there). No `@types/markdown-it` — 15.0.2 ships its own. Import it dynamically, the
same way `sql-formatter` and Monaco already are, so a session that never opens a markdown file never
downloads it.

Configuration: `{ html: false, linkify: true, typographer: false, breaks: false }`. `linkify: true`
is safe because §5.4 neutralises every anchor anyway.

### 5.2 D11 — where it mounts

`RepoFileView.vue` gains a toolbar and a second pane, both rendered **only** when
`monacoLanguageFor(props.tab.path) === 'markdown'`. Every other file type renders byte-identically to
today — no toolbar, no wrapper, no layout change.

```
<div class="repo-file">                        <!-- new: column flex, only for markdown -->
  <div class="p-toolbar last" v-if="isMarkdown">   <!-- existing primitive, primitives.css:751 -->
    <SegmentedControl v-model="view" :options="[{value:'source',…},{value:'reading',…}]" />
  </div>
  <div v-show="view === 'source'" ref="container" class="monaco-host" data-testid="repo-file-editor" />
  <div v-if="view === 'reading'" class="md-reading" data-testid="repo-file-markdown" v-html="renderedHtml" />
</div>
```

Three things about that sketch are deliberate:

- **`v-show`, not `v-if`, on the Monaco container.** `v-if` would unmount the div, disposing the
  editor widget and losing scroll position, selection and the find widget every time the user
  toggles. `v-show` keeps it mounted and hidden. `automaticLayout: true` is already set
  (`RepoFileView.vue:76`), so the editor re-measures itself when shown again — confirm that in the
  live check, and call `editor.layout()` on the toggle if it does not.
- **`.p-toolbar.last`** — the existing 34px toolbar law (`primitives.css:751-762`); `.last` drops the
  bottom border since the pane below has its own surface. Uses `SegmentedControl.vue`, which is the
  app's existing two-state switch primitive, not a bespoke `IconButton` pair.
- **`v-html` is acceptable here and nowhere else** — `markdown-it` with `html: false` emits no raw
  HTML from the source document (§5.1). Say so in a comment at the call site, naming the option, so
  a later reader does not have to re-derive it.

The render itself is a plain computed over the file text the view already holds — keep `content.text` (read at `:48`, consumed at `:66`)
on a `ref` instead of only handing it to the model, and render lazily on first switch to
`reading` so a markdown file opened and never toggled costs nothing.

### 5.3 D12 — the toggle's state

Extend `repoFileTabStateSchema` (`packages/shared/domain/tabs.ts:274-276`) with
`markdownReading: z.boolean().default(false)`, and `defaultRepoFileTabState` (`:499-501`)
correspondingly. `.default(false)` keeps every tab saved before this field exists restorable —
the exact discipline that file's own comment states and `revealLine` already follows.

Persist through the existing `patchRepoFileTabState` (already imported at `RepoFileView.vue:12` and
used at `:153`). Source stays the default: a markdown file opens as code, as it does today.

### 5.4 D13 — links must not navigate, and must not open a browser either

An `<a href="./CONTRIBUTING.md">` or `<a href="https://…">` clicked inside the webview navigates the
SPA document away. There is no chrome, no back button and no address bar — the app white-screens
until it is restarted. This is a correctness requirement, not polish.

The whole handling is one delegated listener on the reading pane:

- `event.preventDefault()` on **every** anchor click, unconditionally.
- `href` starting `#` → find the matching heading and `scrollIntoView`. (Give headings ids; a
  `markdown-it` `renderer.rules.heading_open` override of ~6 lines, or the slug the anchor already
  implies.)
- Anything else → do nothing, and surface the target so the link is not simply dead: set `title` to
  the href at render time (a `renderer.rules.link_open` override), so a hover shows where it would
  have gone.

**Opening external links is out of scope**, and §1.7 is why: `internal/bridge/update.go`'s own
comment records the deliberate decision that the renderer never supplies a URL to `OpenURL`, and
`appupdate/checker.go:171-174` records that `OpenURL` validates nothing. Accepting an arbitrary URL
out of a file on disk is a security decision with its own design (scheme allow-list, validation
layer, probably a confirmation) — a phase of its own, not a sub-bullet of a reading view. See OQ-1.

### 5.5 D14 — the stylesheet

One scoped `.md-reading` block in `RepoFileView.vue`. Every value from an existing `--kira-*` token:
`--kira-font-ui` for prose and `--kira-font-data` for `code`/`pre`, `--kira-fg` / `--kira-fg-muted`,
`--kira-bg` for the pane and `--kira-bg-input` for code blocks, `--kira-border` for `hr`, `thead`
and blockquote rules, `--kira-info` for links, `--kira-radius-sm` on code blocks. A readable measure
(`max-width: 72ch`) and its own `overflow: auto`.

Because Tailwind preflight zeroes `margin`/`padding` on `*` and `list-style` on lists, the block must
restate them for `h1-h6`, `p`, `ul/ol/li`, `blockquote`, `table`, `pre`. That is expected, not a
workaround — check it in the live run rather than assuming any default survives.

**No syntax highlighting inside fenced code blocks.** `markdown-it`'s `highlight` hook plus Monaco's
`editor.colorize()` would do it, but `colorize` is async per block and this is a reading view, not a
second editor. Explicitly out of scope (§9); a fenced block renders as themed monospace on
`--kira-bg-input`.

### 5.6 Does any of this earn a unit test?

**No.** Measured against CLAUDE.md's bar: the pipeline is one library call with a fixed options
object, one `title`/heading-id renderer override, and a click handler with a single `#` branch. There
is no parser, no boundary arithmetic, no cache and no concurrency — `markdown-it` owns all of it, and
a test here would mostly restate a short function body. The one genuinely security-shaped property
(raw HTML is escaped) is a *library default we selected for*, and a test asserting it would be
testing `markdown-it`, not this app. Covered instead by the UI spec in §8.

---

## 6. Files

**Modified**

| File | Change |
| --- | --- |
| `apps/kira-studio/frontend/src/views/repo/monacoEntry.ts` | D1 JSON tokenizer; D2 ts/js registration; D3 `register.all.js` |
| `apps/kira-studio/frontend/src/views/repo/language.ts` | D3 extension table |
| `apps/kira-studio/frontend/src/editor/monacoTheme.ts` | D4 token rules; D6 colour map |
| `apps/kira-studio/frontend/src/editor/monaco.ts` | D5 container class; alpha-aware `normalizeColor` |
| `apps/kira-studio/frontend/src/editor/MonacoHost.vue` | prune `:global()` overrides D6 now covers |
| `apps/kira-studio/frontend/src/theme/primitives.css` | D9 `.p-check` margin (only if §4.3's audit says so) |
| `packages/git-ui/src/theme/app-shell.css` | D8 checkbox block |
| `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue` | D11/D12/D13/D14 |
| `packages/shared/domain/tabs.ts` | D12 `markdownReading` |
| `package.json` (root) | `markdown-it: 15.0.2` |
| `docs/ARCHITECTURE.md` | §7 |

**Added**

| File | Why |
| --- | --- |
| `apps/kira-studio/frontend/src/views/repo/monarch/decorators.ts` | D2 — beside the two existing Monarch files |

---

## 7. Documentation

`docs/ARCHITECTURE.md` only:

- The Monaco section: JSON now uses Monaco's own worker-free tokenizer (and that the one-worker
  guard is intact); all 84 basic languages are registered lazily; TS/JS decorators are patched in and
  why.
- The theme section: `defineKiraTheme` now covers menu/list/suggest/input/peek, and the overflow
  container carries `monaco-editor` so those variables reach reparented widgets.
- The repo-workspace section: a markdown file has a Source/Reading toggle, persisted per tab.
- **Known open items**, one entry: §3.3's `:root` / `.monaco-component` specificity tie in
  `vscode-bridge.css`. Delete it the moment it is resolved; do not mark it done in place.

No `CLAUDE.md` edit — nothing here is a standing rule about how the team works.

---

## 8. Testing

Per CLAUDE.md: implement the whole plan, run the expensive suite once near the end, land fixes as
follow-ups. Typecheck / lint / build per commit.

**New UI coverage** — one spec, `apps/kira-studio/tests/ui/markdown-reading.spec.ts`:

1. Open a `.md` file in a repo tab → the toolbar exists, Source is selected, `repo-file-editor` is
   visible.
2. Click Reading → `repo-file-markdown` is visible and contains a real `<h1>`/`<ul>`; the Monaco
   container is hidden but still in the DOM (D11's `v-show`).
3. Toggle back → the editor is visible again and its scroll position survived.
4. A fixture containing `<script>alert(1)</script>` renders as **text**, and
   `page.locator('.md-reading script')` has count 0.
5. A fixture with an external link: clicking it leaves `page.url()` unchanged.
6. Open a `.ts` file → no toolbar (`repo-file-markdown` count 0), layout unchanged.

**Existing suites to re-run**, because they touch what moved: `tree.spec.ts`,
`datagrip-import.spec.ts`, `tooltips.spec.ts` (all assert on `input[type="checkbox"]` — D8/D9 must
not move them), plus every spec that drives Monaco autocomplete or the repo file view.

No new unit test (§5.6). No adapter-suite change — nothing here touches an adapter.

---

## 9. Explicitly out of scope

- **Opening external links** from the reading view (§5.4/§1.7). Needs its own validated bridge
  method; not started here, not half-implemented.
- **Resolving relative markdown links to repo file tabs.** Plausible next step, unrelated to the
  reported symptom.
- **Syntax highlighting inside fenced code blocks** (§5.5).
- **A markdown reading view anywhere but the repo file tab** — not in the diff view, not in
  `MonacoHost`, not in the API module.
- **Restructuring `vscode-bridge.css`** (§3.3) — recorded as a known open item instead.
- **Editing markdown.** The repo file view is `readOnly: true` (`RepoFileView.vue:74-75`); a reading
  view does not change that.
- **A light theme** (§0.1).
- **A TextMate/`shiki` grammar pipeline.** It was the brief's suggested alternative for §2.2 and is
  declined on proportion: both reported symptoms have exact, one-rule causes inside Monaco's own
  grammars (§2.1, §2.2), and TextMate would add an oniguruma WASM binary plus per-language grammar
  JSON to a desktop bundle to fix what two lines fix. Revisit only if embedded languages (a `.vue`
  `<script>` block, fenced code in markdown) become a real requirement.
- **`internal/codeworkspace/files.go`'s `languageFor`** (§2.5 / OQ-3).
- **`packages/git-ui`'s own light-theme block** (§0.1).

---

## 10. Sequencing — keep all four together

One Sonnet subagent, one sequential pass, four items. They share no code: `monacoEntry.ts` +
`language.ts` (item 1), `monaco.ts` + `monacoTheme.ts` (item 2), `app-shell.css` + `primitives.css`
(item 3), `RepoFileView.vue` + `tabs.ts` (item 4). Each is bounded UI work with a named root cause
and no architecture change. **No split is warranted** — unlike P67b, where the planning pass found a
whole second subsystem (the read-only boundary) hiding behind one line of the report, nothing here
grew past its brief.

Land as four Conventional Commits in this order, each independently verifiable:

1. `fix(editor): color JSON with Monaco's own tokenizer and TypeScript decorators as annotations`
2. `fix(editor): theme Monaco's menu, suggest and list widgets from the Kira palette`
3. `fix(git-ui): style the raw checkboxes in the git dialogs`
4. `feat(repo): add a rendered reading view for markdown files`

Item 1 before item 2 (item 2's §2.4 token rules are easier to eyeball once JSON emits the new
tokens). Items 3 and 4 are order-free.

---

## 11. Verification

### 11.1 Mechanical

- `bun run typecheck`, `bun run lint`, `bun run build` clean.
- `bun run build` output: confirm no `json.worker` / `ts.worker` / `css.worker` / `html.worker` chunk
  appeared. The runtime guard (`editor/monaco.ts:16-24`) throws on one, but a silent extra chunk
  should not ship either.
- Confirm the Monaco chunk grew by roughly the ~15 KB raw §1.2 predicts and not by a grammar body —
  if it jumped by hundreds of KB, a `loader` got eagerly imported.
- `markdown-it` appears only in a lazily-imported chunk, never the boot bundle.

### 11.2 Manual, in a real run

1. Open `package.json` in a repo tab: keys blue (`#9cdcfe`), string values orange (`#ce9178`),
   `true`/`false`/`null` keyword-coloured, numbers green.
2. Open a `.ts` file with a decorator: `@Component` is **not red**; `@` and the name both render
   `#dcdcaa`.
3. Open a `.rb`, `.cpp` and `.ps1` file: coloured, not flat plaintext.
4. §3.5's three checks, verbatim.
5. Open the git module → Repository settings, Stash, Tag dialogs: checkboxes are 14px dark boxes with
   an accent fill and a codicon tick, aligned with their labels; keyboard focus shows the ring; a
   disabled one is dimmed.
6. Open a `README.md`: toolbar present, Source default. Toggle to Reading, scroll, toggle back —
   the editor's own scroll position survived. Close the tab, reopen: still on Source. Toggle, close,
   reopen: still on Reading.
7. Open a `.ts` file: no toolbar at all, layout identical to before the phase.

### 11.3 Checklist

- [ ] `package.json` keys and values are different colours
- [ ] a TS decorator is not red
- [ ] a previously-plaintext language (`.rb`/`.cpp`/`.ps1`) is coloured
- [ ] `.vue`/`.svelte`/`.toml` still colour exactly as before
- [ ] context menu and suggest widget both read Kira's palette, in a `MonacoHost` **and** in a repo file tab
- [ ] `.kira-editor-overflow-widgets` also carries `monaco-editor`
- [ ] no new Monaco worker chunk
- [ ] all 14 git-ui checkboxes styled; the 11 `<Checkbox>` sites unchanged visually except §4.3
- [ ] markdown toggle renders, persists, and does not exist for non-markdown files
- [ ] a `<script>` in a markdown source renders as text; `.md-reading script` count is 0
- [ ] clicking any link in the reading view does not navigate the app
- [ ] `docs/ARCHITECTURE.md` updated, including the one Known open item

---

## 12. Open questions, with a recommendation for each

**OQ-1 — should an external link in the reading view be clickable at all?**
Recommendation: **no, this phase.** Render it, style it as a link, put the URL in its `title`, and
swallow the click (§5.4). `internal/bridge/update.go`'s own comment already establishes that this
codebase does not hand renderer-supplied URLs to `OpenURL`, and reversing that for markdown content
is a security design, not a polish item. If the user wants it, it is a small follow-up phase with a
scheme allow-list.

**OQ-2 — `.p-check`'s 2px `margin-top` (§4.3): delete or relocate?**
Recommendation: **audit the 11 call sites, then delete if no `align-items: flex-start` row remains.**
The comment names a real layout, so a blind deletion is a guess. This is the only part of item 3 that
could regress an existing screen, and it is two lines either way.

**OQ-3 — `internal/codeworkspace/files.go`'s `languageFor` has no consumer.**
`FileContent.Language` is set at `files.go:126` and `diff.go:53` and read nowhere — `RepoFileView.vue`
computes its own. Recommendation: **leave it untouched this phase** and do not duplicate §2.3's
40-odd new extensions into it. Maintaining a second table nobody reads is the gold-plating CLAUDE.md
warns about. If it is still unread at the end of v1.6, delete the field rather than sync it.

**OQ-4 — does `register.all.js` change which language wins an ambiguous extension?**
Several upstream grammars claim overlapping extensions (`.m`, `.h`, `.pl`, `.st`). This app never
asks Monaco to resolve a path — `language.ts` hands it an explicit id — so registration order cannot
affect colouring. Recommendation: **no action**, but state it in `language.ts`'s header comment so the
next reader does not re-derive it.

**OQ-5 — should the Reading view be the default for markdown?**
Recommendation: **no.** This is a code workspace; a file tab opening as source is the invariant every
other file type holds, and D12's persistence means one click sticks per tab. Worth asking the user
once, since they requested the feature and may have expected the opposite default.
