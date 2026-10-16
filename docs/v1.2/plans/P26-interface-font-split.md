# P26 — separating the interface font from the data font

> **What this phase is.** `docs/v1.2/SPEC.md`'s P26 row, in the user's own words: *"Use another font
> for the interface than what's used for data. It's not customisable and use the same vscode uses."*
> One token (`--kira-font-family`) currently serves two jobs; this phase gives each job its own
> named role, points chrome at a fixed VS Code UI stack, and leaves the data font exactly as
> customizable as it is today.
>
> **Base commit.** Read against `f56b353` (branch `claude/feature-v1-2`) — P25's DataGrip import
> landed, P22's three parts are in. Every `file:line` citation below points at that commit; every
> `microsoft/vscode` citation points at `17c5935aa72fa5bfb3ea2c6f07c49280cc276a3c` (`main`, read via
> `raw.githubusercontent.com` from this worktree).
>
> **This phase is smaller than it looks, and it is not new design work.** The two-role split this
> row asks for is already written down in this repo — `docs/design/kira-design-system/parts/_style.css:29-30`
> declares `--font-ui` and `--font-mono` under the heading *"type — TWO roles, FOUR steps"*, and
> **LAW 08** states the classification rule verbatim (F1). The app collapsed both roles into one
> token when the design system was translated into `theme/tokens.css`, and `docs/v1/plans/P31-polish-bugfix-batch.md:185-190`
> already recorded that divergence and deliberately left it standing. P26 closes it.
>
> **Precedents this matches.** `docs/v1.2/plans/P22-shared-primitives-and-tokens.md` — the closest
> and most directly relevant: its D1 introduced a *role* layer (`--kira-control-h*`) over an existing
> *scale* (`--kira-h-*`) and swapped every consumer in one render-identical commit, and it made
> `--kira-t-xs/-sm/-lg` real offsets from `--kira-font-size`. This phase uses the same shape for
> the font family, and §2 D6 works out its interaction with that type-scale change rather than
> ignoring it. `docs/v1.2/plans/P19-…md` supplies the premise-correction discipline §0.3 follows.

---

## 0. Scope

### 0.1 The one sentence this phase implements

`body` stops being monospace. Everything that is genuinely *data* keeps the monospace font the
Settings dialog already calls **Data font**, and keeps every bit of its customizability. Everything
else — the tree, the tab strip, toolbars, dialogs, buttons, menus, labels, the title bar, the status
bar — renders in a fixed system-UI sans stack taken verbatim from VS Code's own workbench, with no
Settings entry of any kind.

### 0.2 The items this document owns

| # | Item | Findings | Decisions | Commits |
|---|---|---|---|---|
| A | Two font roles instead of one token | F1, F2, F3 | D1, D2 | T1, T2 |
| B | The exact VS Code UI stack, and the fallback chain it needs on this app's real target | F4, F5 | D3 | T1 |
| C | A full inventory of every `--kira-font-family` / `--kira-font-size` consumer, each classified | F6, F7, F8 | D4 | T2, T3 |
| D | The app's existing `.p-input.ui` opt-out, which is the interface half already half-built | F9 | D5 | T3 |
| E | `--kira-font-size`: does chrome get its own size too? | F10, F11 | D6 | — (no change, deliberately) |
| F | Settings dialog copy | F12 | D7 | — (no change, deliberately) |
| G | `fonts.ts`'s availability probing against the new font | F13 | D8 | — (no change, deliberately) |
| H | Two just-landed guarantees this change can silently break | F14, F15 | D9, D10 | T4, T5 |

### 0.3 Corrections this investigation makes to the row's own premises

Stated here and mirrored into the SPEC row, the way P19's and P22's rows record theirs.

1. **"the app has exactly one font token … applied to every surface" — true of the token set, not
   of the rendered app.** `theme/primitives.css:158-160` already carries `.p-input.ui`, which
   hard-codes `-apple-system, "SF Pro Text", system-ui, "Segoe UI", sans-serif` and has **four live
   consumers** today (F9). So a sans-serif interface font is already rendering in this app, in four
   inputs, from a hard-coded literal that is the only font stack in the repo not behind a token.
   D5 folds it into the new token instead of adding a second one beside it.
2. **This is not a new design decision; it is a reversion of one.** The design system this app's
   `primitives.css` was ported from has always had two roles and a stated law for choosing between
   them (F1: LAW 08, *"Mono is for data … If the app wrote it, it is UI"*). v1's SPEC §8.2 wrote the
   collapse down as intentional — *"one font family + size for the whole app (UI, grid and editors
   alike)"* (`docs/v1/SPEC.md:366`) — and P31 F14 flagged the resulting `.p-input.ui` divergence and
   left it. **P26 supersedes that §8.2 sentence.** The classification rule this plan uses is LAW
   08's, not one invented here.
3. **The Settings dialog needs no copy change at all** (F12). It already reads **"Data font"** with
   the helper text *"Grid cells, editors, anything that came out of a database."*
   (`SettingsDialog.vue:278`, `:328`) and **"Data font size"** (`:333`) — copied verbatim from the
   design-system artboard (`docs/design/kira-design-system/parts/bodies/SettingsDialog.html:41,45`),
   which was drawn for the post-split world. The dialog has been describing this phase's outcome
   since before the phase existed.
4. **The row's proposed stack is close but is not what VS Code ships** (F4). The row quotes
   `-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "Ubuntu", "Droid Sans", sans-serif`;
   VS Code's own platform-agnostic spelling of the same list includes `system-ui` between
   `"Segoe UI"` and `"Ubuntu"`, and its per-platform CSS is three separate, shorter stacks. D3 ships
   a verbatim VS Code string and says which one and why.
5. **The row is silent on `--kira-font-size`, and the honest answer is "don't touch it"** (F10, F11,
   D6) — not because size is out of scope by fiat, but because the investigation found the type
   scale is *not* role-split the way P22's own investigation suggested, and because P22 D1 landed
   the coupling deliberately one phase ago.

### 0.4 Not in scope

- **Any Settings control for the interface font.** The user's sentence is explicit — *"It's not
  customisable"* — and it overrides the design-system artboard, which does draw an **Interface font**
  picker (`parts/bodies/SettingsDialog.html:37`, *"Menus, toolbars, tree, labels."*). D3 records the
  divergence rather than quietly following the artboard.
- **Changing the data font's default** (`Menlo, monospace`) or `FONT_CHOICES`' fifteen stacks. The
  design system's own `--font-mono` is `"SF Mono", ui-monospace, Menlo, Consolas, monospace`, which
  is a different value from the app's default; re-picking it is not this row.
- **Changing which inputs are UI and which are data.** D5 rewires the existing `.p-input.ui`
  opt-out onto the new token and leaves its four consumers exactly as they are; OQ-1 carries the
  general question.
- **A second size token for chrome** (D6, OQ-2).
- **Light mode, Windows or Linux support.** `README.md:15,142` — macOS 14+, Apple Silicon, dark
  only. That constrains D3's fallback chain (F5) and nothing else.

---

## 1. Findings

### F1 — The two roles, and the rule for choosing between them, are already written in this repo (item A)

`docs/design/kira-design-system/parts/_style.css:29-30`, under the comment `/* type — TWO roles,
FOUR steps */`:

```css
--font-ui: -apple-system, "SF Pro Text", system-ui, "Segoe UI", sans-serif;
--font-mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
```

with `body { font-family: var(--font-ui) }` (`:44`) and `.mono { font-family: var(--font-mono) }`
(`:48`) — i.e. the *opposite* default from the app's, plus an explicit opt-in for data.

**LAW 08** (`docs/design/kira-design-system/parts/bodies/System.html:428`), verbatim:

> **Mono is for data.** If a string came out of a database — a value, an identifier, a query, a
> duration — it is mono. If the app wrote it, it is UI.

That is the classification rule §1 F6-F8 apply. It is not a rule this plan invents, and it settles
several call sites that would otherwise be judgement calls (the `RunState` duration, the PK/FK
badge, the type chip in a tooltip).

Two neighbouring laws matter to the inventory too: **LAW 11** (*"`thead`/`th`/`tbody`/`tr`/`td` with
`h-row` rows and **mono cells** serve the grid, key/value fields, stream messages and console
results alike"*) — cells are mono, and the `th` above them is not, which the app already implements
(`primitives.css:930` gives `.p-td` a family and `.p-th` has none). And the artboard's own helper
copy for the interface font — *"Menus, toolbars, **tree**, labels"* — puts the connection tree on
the UI side explicitly, which is the single most visible consequence of this phase (D4's note).

### F2 — The app collapsed both roles into one token, and one class already escapes it (item A)

`theme/tokens.css:109-112`:

```css
/* Appearance tokens: defaults here, overwritten at runtime from `settings` (Step 6). */
--kira-font-family: Menlo, monospace;
--kira-font-size: 12px;
--kira-row-height: 28px;
```

`theme/base.css:57-59` puts it on `body`, and Tailwind v4.3.3's preflight
(`node_modules/tailwindcss/preflight.css:237-252`) gives `button, input, select, optgroup, textarea,
::file-selector-button` a `font: inherit`, so **the body declaration reaches every form control
too** — nothing in the app renders in a font it did not inherit from that one line, except the
explicit declarations F6 enumerates and `.p-input.ui` (F9).

`state/settings.ts:19-28` is the only writer:

```ts
root.setProperty('--kira-font-family', settingsState.appearance.fontFamily);
root.setProperty('--kira-font-size', `${settingsState.appearance.fontSize}px`);
root.setProperty('--kira-row-height', …);
```

### F3 — `scripts/check-tokens.sh` constrains where a new token may be declared, and has a blind spot that matters here (item A)

The guard (run by `bun run lint`) requires every `var(--kira-*)` under `frontend/src` to resolve to
a definition in `theme/{tokens,base,primitives}.css` — so a new token must be declared in
`tokens.css`, not inlined (the same constraint P22 F4 recorded).

Its `grep` is `--include='*.vue' --include='*.css'` only (`scripts/check-tokens.sh:19`). **`.ts` is
not scanned**, and `editor/{theme.ts}` is a real consumer of `--kira-font-family` at four call
sites. A typo in a token name there fails silently — the property just doesn't apply, and the
element inherits. This is why §4.3's editor cases assert a *computed* family rather than trusting
lint.

### F4 — What VS Code actually ships, from its own source (item B)

Three places, all at `microsoft/vscode@17c5935aa72fa5bfb3ea2c6f07c49280cc276a3c`:

**(a) The per-platform value the workbench actually renders in.**
`src/vs/workbench/browser/media/style.css:12,18,25`, under `/* Font Families (with CJK support) */`:

```css
.monaco-workbench.mac     { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.monaco-workbench.windows { font-family: "Segoe WPC", "Segoe UI", sans-serif; }
.monaco-workbench.linux   { font-family: system-ui, "Ubuntu", "Droid Sans", sans-serif; }
```

(plus five `:lang()` variants per platform for CJK, which this app has no equivalent of).

**(b) The same three, as one exported constant.** `src/vs/base/browser/fonts.ts:18`:

```ts
export const DEFAULT_FONT_FAMILY = isWindows ? '"Segoe WPC", "Segoe UI", sans-serif'
  : isMacintosh ? '-apple-system, BlinkMacSystemFont, sans-serif'
  : 'system-ui, "Ubuntu", "Droid Sans", sans-serif';
```

with the doc comment *"The best font-family to be used in CSS based on the platform"*. **This is
the constant that becomes `--vscode-font-family`**, the variable the SPEC row names:
`src/vs/workbench/contrib/webview/browser/themeing.ts:82` sets `'vscode-font-family':
DEFAULT_FONT_FAMILY` alongside `'vscode-font-size': '13px'` — and, two lines down (`:85`),
`'vscode-editor-font-family': editorFontFamily`, a **separate** variable fed from
`EDITOR_FONT_DEFAULTS` (`src/vs/editor/common/config/fontInfo.ts:234-236`), whose macOS value is
`Menlo, Monaco, 'Courier New', monospace` (`:226`). The two-variable split in VS Code's own webview
theming is the exact split this phase is implementing, and it confirms the row's instruction that
the *editor* font is the wrong precedent to copy.

**(c) The platform-agnostic union, for the places VS Code can't branch on a body class.** Where a
single CSS string has to serve every platform, VS Code writes the three stacks concatenated. Two
spellings exist in the tree:

| Spelling | Where |
|---|---|
| `-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "HelveticaNeue-Light", system-ui, "Ubuntu", "Droid Sans", sans-serif` | `src/vs/editor/standalone/browser/standalone-tokens.css:11`, `src/vs/base/browser/ui/contextview/contextview.ts:503` |
| `-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif` | `src/vs/code/browser/workbench/callback.html`, `extensions/github-authentication/media/auth.css`, `extensions/markdown-language-features/media/markdown.css` and that extension's `markdown.preview.fontFamily` default in `package.json` |

They differ only by `"HelveticaNeue-Light"`, a macOS-only face that `-apple-system` already preempts
on the one platform this app ships on. **Neither is the row's quoted string**, which omits
`system-ui` — a real omission, since `system-ui` is the entry that makes the stack behave on a
non-Ubuntu Linux (style.css:24's own comment: *"add `system-ui` as first font and not `Ubuntu` to
allow other distribution pick their standard OS font"*).

### F5 — What the fallback chain has to survive on this app's real targets (item B)

- **The product**: macOS 14+, Apple Silicon only (`README.md:15,142`); Windows/Linux are named
  under *Not shipped* (`README.md:304-305`). So in the shipped app `-apple-system` resolves to SF
  Pro and **every entry after it is inert**.
- **The development and CI environment is Linux**, and it renders the app for real: `tests/ui`
  drives headless Chromium against a static build (`CLAUDE.md`, `apps/kira-studio/tests/ui/`), and
  `tests/e2e-real` drives a `-tags server` binary in a plain Playwright tab. There
  `-apple-system`/`BlinkMacSystemFont`/`Segoe*` all miss and `system-ui` is what catches — which is
  precisely the entry the row's quoted string drops. A stack ending in a bare `sans-serif` can never
  fail to resolve to *something*, so there is no "font not installed" failure mode to design for,
  only a "which sans" one.
- **No `@font-face`, no bundled font file, no network fetch** is involved either way: every entry is
  a locally-installed family name. The one font this app does ship is `@vscode/codicons`
  (`theme/base.css:2`), an icon font, untouched by this phase.

### F6 — Every consumer of `--kira-font-family`, classified (item C)

`grep -rn -- '--kira-font-family' apps packages scripts` at `f56b353`: **43 hits** — one token
definition, four comments/writers, and **38 real consumers** across **25 files**. Every one is
listed. The classification column applies LAW 08 (F1): *did the app write this string, or did it
come out of a database / go out on a wire?*

**Data (36 of 38) — keeps the customizable monospace font:**

| # | Site | What it renders | Why data |
|---|---|---|---|
| 1 | `theme/primitives.css:7-9` `.mono` | 60 call sites (`grep -c 'class="[^"]*\bmono\b"'`) | LAW 08's own marker class — this *is* the data role |
| 2 | `theme/primitives.css:152` `.p-input` | every text field's value | design-system default; `.ui` is the named opt-out (F9) |
| 3 | `theme/primitives.css:265` `.p-textarea` | pre-connect commands, message bodies | ditto |
| 4 | `theme/primitives.css:530` `.p-badge` | counts/labels beside data | design-system `.p-badge` is `--font-mono`; tabular figures |
| 5 | `theme/primitives.css:545` `.p-count` | a tree row's child count | ditto — a column of counts must line up |
| 6 | `theme/primitives.css:830` `.p-run-state` | `9999 ms` | LAW 08 names *"a duration"*; and F14's `7ch` depends on it |
| 7 | `theme/primitives.css:921` `.p-th .key` | the `PK`/`FK` badge | a schema fact |
| 8 | `theme/primitives.css:930` `.p-td` | every non-Slick table cell | LAW 11 (*"mono cells"*) |
| 9 | `views/shared/slick/slickTheme.css:16` `.slick-grid-host` | the whole grid, headers included | LAW 11; header names are DB identifiers (D4 note b) |
| 10 | `editor/theme.ts:15` `.cm-scroller` | every CodeMirror surface | the editor |
| 11 | `editor/theme.ts:69` `.cm-tooltip-autocomplete > ul` | completion items | table/column/keyword identifiers |
| 12 | `editor/theme.ts:141` `.cm-tooltip-lint` | diagnostics on SQL | quotes identifiers; floats over the editor |
| 13 | `editor/theme.ts:162` `.cm-kira-hover` | column/type hovers | schema facts |
| 14 | `theme/primitives/AutocompleteField.vue:486` | the highlight overlay's `.cm-scroller` | **must** equal `.p-input`'s family glyph-for-glyph (F15) |
| 15 | `theme/primitives/AutocompleteField.vue:526` `.var-hover-panel` | a `{{variable}}`'s resolved value | a value |
| 16 | `workbench/AppTooltip.vue:126` `.tip-meta` | a column's data type, coloured by `typeClass` | a schema fact |
| 17 | `workbench/panels/OperationsPanel.vue:369` `.mono` | timestamps and the executed command | a query, a duration |
| 18 | `workbench/SettingsDialog.vue:764` `.mono` | `~/.kira-studio/kira.sqlite` | a path |
| 19 | `workbench/SettingsDialog.vue:801` `.row-preview-cell` | the row-density preview's fake grid | it previews the grid |
| 20 | `views/shared/document/DocumentRow.vue:123` `.doc-id` | a document `_id` | a value |
| 21 | `views/shared/document/DocumentTree.vue:79` | the whole JSON tree | values |
| 22 | `views/definition/DefinitionView.vue:370` `.err-message` | an adapter error, verbatim | server output |
| 23 | `views/grid/DataView.vue:354` `.error-strip` | ditto | ditto |
| 24 | `views/stream/StreamView.vue:1042` `.msg-body` | a Kafka/SQS message body | a value |
| 25 | `views/documents/DocumentView.vue:1046` `.doc-preview-match` | a matched document excerpt | a value |
| 26 | `views/console/ConsoleResultGrid.vue:408` root | console results | LAW 11 |
| 27 | `views/console/ConsoleResultGrid.vue:494` `.doc-body-text` | a returned document | a value |
| 28 | `views/console/ExplainResultView.vue:270` `.plan-label` | `Seq Scan on orders` | planner output |
| 29 | `views/console/ConsoleView.vue:821` `.p-strip.err` | an adapter error, verbatim | server output |
| 30 | `api/MethodSelect.vue:84` `.method-select` | `GET`/`POST` | a literal wire token (D4 note c) |
| 31 | `api/DynamicValuesDialog.vue:134` `.reference` | `{{$randomEmail}}` | a value the user pastes into a request |
| 32 | `project/SchemaDialog.vue:181` `.mono` | `pg_dump --schema-only`, a connection name | commands and identifiers |
| 33 | `project/FiltersDialog.vue:270` `.mono` | a connection name | an identifier |
| 34 | `project/ConnectionDialog.vue:896` `.mono` | URI / database file / pre-connect | values on the wire |
| 35 | `project/ErrorPopover.vue:147` `.error-popover-body` | a connect error, verbatim | server output |
| 36 | `views/shared/page/columns.ts:47` (JS) | the canvas that measures grid column widths | it must measure the font the cells render in |

**Interface (2 of 38) — moves to the fixed UI font:**

| # | Site | What it renders | Why chrome |
|---|---|---|---|
| 37 | `views/shared/celleditor/CellEditorView.vue:665` `.format-select` | `Text` / `JSON` / `Base64` / `Hex` | the app's words, on a control |
| 38 | `views/shared/celleditor/CellEditorView.vue:705` `.generate-item` | menu rows in the generate-value menu | the app's words, on a control |

**Plus three sites that are not a plain `var(--kira-font-family)` reference but belong to the same inventory:**

| Site | Today | After |
|---|---|---|
| `theme/base.css:58` `body` | `var(--kira-font-family)` | **the interface font** — the one edit that moves every chrome surface that has no declaration of its own |
| `theme/primitives.css:158-160` `.p-input.ui` | a hard-coded `-apple-system, "SF Pro Text", …` literal | `var(--kira-font-ui)` (D5) |
| `views/shared/slick/slickTheme.css:659` `.slick-sort-indicator-numbered` | `var(--kira-font-family)` | interface — a multi-sort **order number**, a control's own badge, not a value (this is a third interface site; it sits in a data file, which is why it is listed here rather than above) |

**And one that needs a declaration it does not have today:**

| Site | Today | Why it must change |
|---|---|---|
| `theme/primitives.css:667-673` `.p-completion` / `.p-completion-row` | *no* `font-family` — inherits `body` | F15: today that inheritance makes it match `editor/theme.ts:69` by accident. After `body` moves, the two completion popups P22 D8 unified would silently diverge. It needs an explicit data-font declaration. |

**Net**: 36 sites keep the data font and change only which token names it; 3 sites plus `body` move
to the interface font; 1 site gains a declaration; 1 hard-coded literal becomes a token reference.

### F7 — Everything else is chrome and needs no edit at all (item C)

Because `body` carries the family and preflight makes form controls inherit it (F2), the vast
majority of chrome has **no `font-family` declaration anywhere** and moves with `body` for free:
`.p-btn` (`primitives.css:70-81`), `.p-select` (`:382-394`), `.p-iconbtn`, `.p-tab`, `.p-toolbar`,
`.p-view-head`, `.p-menu-*`, `.p-panel-head`, `.p-th` (the header cell itself — only its `.key`
badge is mono), `.p-chip`, `.p-status`, `DialogFrame`, `TitleBar`, `StatusBar`, `TabStrip`,
`TreeRow`, `ContextMenu`, `CommandPalette`, every `views/*` toolbar. That is the phase's leverage:
**one line in `base.css` does the work, and the inventory above is what stops it from doing too
much.**

### F8 — The classification's two visible consequences, named up front (item C)

Both follow from LAW 08 + the artboard's *"Menus, toolbars, tree, labels"*, and both are what a user
will notice first:

**(a) The connection tree renders database identifiers in a sans face.** `project/TreeRow.vue` has
no `font-family` of its own, so schema/table/collection/key names in the left panel become UI text.
This is deliberate and is what the design system says (*"tree"* is named in the interface font's own
helper copy); it is also what VS Code does with filenames in its Explorer. Named here so it is not
mistaken for an oversight.

**(b) Tab titles too**, for the same reason (`TabStrip.vue` has no declaration). Again VS Code's own
behaviour with editor tabs.

### F9 — The interface half is already half-built, in one hard-coded literal (item D)

`theme/primitives.css:158-160`:

```css
.p-input.ui {
  font-family: -apple-system, "SF Pro Text", system-ui, "Segoe UI", sans-serif;
}
```

— the only font stack in `frontend/src` that is not behind a token, and the design system's own
`--font-ui` value verbatim (`_style.css:29`, `:73`). `TextField.vue:32,72` exposes it as a `ui`
prop. **Four live consumers** at `f56b353`: `shortcuts/CommandPalette.vue:63` (class form),
`theme/primitives/PanelSearchBox.vue:24`, `project/ConnectionDialog.vue:440` and `:513` (the
connection's *name*) — exactly the four P31 F14 counted, still four.

So the app already decided, per-input, which inputs hold app vocabulary and which hold data, and
already ships a sans face in them. What it lacks is the token.

### F10 — The type scale is *not* cleanly role-split, contrary to what P22's investigation suggested (item E)

P22 F2(d) reasoned that `--kira-t-xs/-sm/-lg` size *"every button, input, select, chip and tab
label"* — control chrome — and made them real `calc()` offsets from `--kira-font-size` so that
raising the Appearance size raises them together (`tokens.css:119-128`). Counted at `f56b353`:

| Token | References | Split |
|---|---|---|
| `--kira-t-xs` | 46 | mostly chrome (`.p-badge`, `.p-count`, `.p-status`, `.p-menu-label`) **but also** `.p-th .key` and `.slick-sort-indicator-numbered` |
| `--kira-t-sm` | 57 | mostly chrome **but also** `.p-input`, `.slick-header-column` (`slickTheme.css:147`), `DocumentTree` |
| `--kira-t-md` (`= --kira-font-size` exactly) | 18 | **genuinely mixed**: `slickTheme.css:15` (grid cells), `.p-td`, `DocumentRow`, `ConsoleResultGrid`, `ErrorPopover` on the data side; `StudioStart`, `CommandPalette`, `TreeRow`, `CollectionRow`, `DataGripImportDialog`, `SettingsDialog` on the chrome side |
| `--kira-t-lg` | 5 | all chrome (dialog titles, empty-state heads) |

So P22's premise was right for `-xs`/`-sm`/`-lg` and **wrong for `-md`**, which is simultaneously
the grid cell's size and the tree row's size. There is no clean seam to cut a second size token on.

### F11 — The app already spans both roles with one density setting, and nobody has complained (item E)

`--kira-row-height` (`tokens.css:112`, written from `settings.ts:23-26`) is set by the Settings
"Row height" control, whose own helper text is *"Applies to the tree, the grid and every list."*
(`SettingsDialog.vue:387`) — one control deliberately governing chrome and data together. The
Appearance section is already built on "one density, one size, two roles of *family*", which is
exactly what D6 preserves.

The counter-precedent, stated fairly: **VS Code does decouple them.** `editor.fontSize` changes only
the editor; the workbench's own UI size is a separate, fixed `13px`
(`themeing.ts:84`, `'vscode-font-size': '13px'`) moved only by `window.zoomLevel`. D6 weighs both.

### F12 — The Settings dialog already says "Data font" (item F)

`workbench/SettingsDialog.vue`:

```
:275  <div class="sec-label first">Typography</div>
:278  <span>Data font</span>
:328  <span v-else class="helper-text">Grid cells, editors, anything that came out of a database.</span>
:333  <span>Data font size</span>
```

verbatim from `docs/design/kira-design-system/parts/bodies/SettingsDialog.html:41,45`. The
`data-testid`s (`settings-font-family`, `settings-reset-appearance-fontFamily`) and the settings key
(`appearance.fontFamily`) keep their names; only the human-facing label matters here, and it is
already right.

### F13 — The availability probe only ever sees the data font (item G)

`fonts.ts:33-54` exports `resolveFontFallback` and `fontStackAvailable`. `grep -rn` finds exactly
two call sites, both in `SettingsDialog.vue`:

```ts
:85  const fontFamilyUnavailable = computed(() => !fontStackAvailable(draft.appearance.fontFamily));
:86  const fontFamilyFallback   = computed(() => resolveFontFallback(draft.appearance.fontFamily));
```

Both read `draft.appearance.fontFamily` — the data font, the one thing a user can choose. The
*"Not installed — text falls back to the browser's ___ default"* message
(`SettingsDialog.vue:323-327`, `data-testid="font-unavailable"`) is rendered inside the Data font
field and can never point at the interface font. Nothing to change.

One comment in that file does go stale: `fonts.ts:62-64` explains that every `FONT_CHOICES` stack
ends in `monospace` *"since `--kira-font-family` also drives `body` (theme/base.css), so an
unresolved stack must still land on a monospace face rather than the browser's proportional
default."* After this phase the premise (`body`) is false while the conclusion (end in `monospace`)
stays right for a different reason.

### F14 — One `ch`-based width reservation depends on the data font staying monospace (item H)

`theme/primitives.css:835-838`:

```css
/* LAW 12: the label's width changes as elapsed time ticks up (the widest is
   "9999 ms", 7 characters); reserve that width so it never reflows controls
   to its left. 7ch tracks the monospace font-family above with no token. */
.p-run-state .label { min-width: 7ch; }
```

`ch` is the advance of `0` in the element's own font. If `.p-run-state` moved to a proportional
face, `7ch` would stop bounding `"9999 ms"` and the label could reflow — re-opening LAW 12 and P22
D4's pager fix in one step. F6 row 6 keeps `.p-run-state` on the data font (LAW 08 names durations),
so the reservation stays sound; this finding exists so the implementer does not "tidy" that site.

The other two `ch` reservations, `workbench/StatusBar.vue:113` (`4ch`, `"100%"`) and `:116` (`9ch`,
`"1234.5 MB"`), sit on elements that carry `class="mono"` (`StatusBar.vue:77,79`) and are therefore
already on the data font by F6 row 1 — no change, and no risk.

### F15 — Two just-landed P22 guarantees this change can break silently (item H)

**(a) P22 D8's "every completion popup renders through one uniform style".** `.p-completion`
(`primitives.css:667-673`) declares padding/min-width/max-width/max-height and **no font-family** —
it inherits `body`. `editor/theme.ts:68-72` declares the same four properties *plus* an explicit
`fontFamily: 'var(--kira-font-family)'` on the CodeMirror `ul`. Today both render in the same font
**by coincidence**. Move `body` and the plain-field popup goes sans while the editor popup stays
mono — two popups reachable within two keystrokes of each other in the same request builder, which
is the exact complaint P22 item F was raised for. `tests/ui/autocomplete.spec.ts:575,601-609` asserts
`borderRadius`/`backgroundColor`/`padding`/`maxWidth` and **not** `fontFamily`, so this would land
green.

**(b) P22 D5/D6's mode-tab ink measurement.** `tests/ui/mode-switch.spec.ts:287-317` screenshots each
mode tab and asserts `|iconCentreY − labelCentreY| ≤ 1.5` — a measurement of where the *label's ink*
sits, taken against the monospace face the label renders in today. `.mode-label` has no
`font-family` of its own (`TitleBar.vue:145-147` sets only `line-height`), so it moves with `body`
and its ink centre moves with it. The test may go red. That is not a regression to paper over: P22
D6 built `--kira-icon-optical-y` for precisely this, and it is currently **not declared anywhere** —
`TitleBar.vue:166` reads it as `var(--kira-icon-optical-y, 0px)`, a fallback form
`check-tokens.sh` skips by construction, so today it is 0.

---

## 2. Decisions

### D1 — Two named roles over the one Appearance channel (item A, F1, F2, F3)

`theme/tokens.css` keeps `--kira-font-family` exactly as it is — it stays the channel
`state/settings.ts:21` writes and the key `appearance.fontFamily` maps to, so nothing in storage,
the bridge, the settings schema or the Settings dialog's test ids changes — and gains a role layer
immediately beneath it, in P22 D1's own idiom:

```css
/* Appearance tokens: defaults here, overwritten at runtime from `settings` (Step 6).
   --kira-font-family is the *channel* the Appearance "Data font" control writes; the two roles
   below are what stylesheets reference. (P26) */
--kira-font-family: Menlo, monospace;
--kira-font-size: 12px;
--kira-row-height: 28px;

/* P26: two font roles over the one channel above, restoring the design system's own
   --font-ui / --font-mono pair (docs/design/kira-design-system/parts/_style.css:29-30) that the
   port to this file collapsed into one token. LAW 08 decides which a surface gets: "Mono is for
   data. If a string came out of a database — a value, an identifier, a query, a duration — it is
   mono. If the app wrote it, it is UI."
   --kira-font-data is user-customizable (it is --kira-font-family); --kira-font-ui is FIXED and
   has no Settings control by design — see the plan's D3. */
--kira-font-data: var(--kira-font-family);
--kira-font-ui: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu",
  "Droid Sans", sans-serif;
```

Every one of F6's 36 data sites swaps `var(--kira-font-family)` → `var(--kira-font-data)`. That is a
pure rename with no rendered change, exactly like P22 D1's control-role swap, and it is what makes
`.p-td`'s declaration self-documenting instead of merely present.

*Alternative considered and rejected:* naming the roles `--kira-font-family` (data) and
`--kira-font-ui` (interface) and doing no rename. It is ~30 fewer edits and leaves the more-used
token with the less descriptive name — a reader looking at `.p-td { font-family:
var(--kira-font-family) }` still cannot tell which of the two roles it means, which is the whole
defect this phase exists to fix. P22 D1 faced the same trade and chose the role layer.

*Alternative considered and rejected:* making `--kira-font-ui` a second Appearance-written property
so it *could* be customized later. The user's sentence is explicit and a written-but-never-written-to
channel is dead code.

### D2 — `body` is the interface font; nothing else about `base.css` changes (item A, F2, F7)

`theme/base.css:57-59`:

```css
body {
  font-family: var(--kira-font-ui);
  font-size: var(--kira-font-size);
  …
}
```

One line. Combined with preflight's `font: inherit` on form controls (F2), this moves every chrome
surface that has no declaration of its own — F7's list — in a single edit, and F6's 36 explicit
data declarations are what hold the data surfaces still.

`font-size` is untouched (D6).

### D3 — The exact stack, and why this spelling (item B, F4, F5)

```
-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif
```

**Verbatim** from `microsoft/vscode@17c5935`'s own platform-agnostic spelling
(`src/vs/code/browser/workbench/callback.html`, `extensions/github-authentication/media/auth.css`,
`extensions/markdown-language-features/media/markdown.css` and that extension's
`markdown.preview.fontFamily` default) — the union of the three per-platform stacks VS Code's
workbench actually renders in (F4(a)/(b)), in VS Code's own order.

Four sub-decisions, each recorded so nobody re-derives them:

1. **Not the row's quoted string**, which omits `system-ui`. That entry is load-bearing on Linux by
   VS Code's own comment (`style.css:24`) and is where the dev/CI environment's rendering lands
   (F5). The correction is small and it is the reason the row said *"verify the exact, current
   stack"*.
2. **Not the `"HelveticaNeue-Light"` variant** (`standalone-tokens.css:11`,
   `contextview.ts:503`). It is a macOS-only face `-apple-system` already preempts on the only
   platform this app ships on, so on the target it is unreachable, and the shorter spelling is the
   more common one in VS Code's own tree.
3. **Not three platform-branched rules.** VS Code branches because it ships on three platforms; this
   app ships on one (F5), and a `.mac`/`.windows`/`.linux` body class does not exist here. The union
   collapses to `-apple-system` on the product and degrades through `system-ui` → `sans-serif`
   everywhere the tests run. A bare `sans-serif` terminator means the stack can never fail to
   resolve, so there is no availability question (D8) and no `@font-face` or bundled file.
4. **Not VS Code's editor font.** `EDITOR_FONT_DEFAULTS` (`fontInfo.ts:234-236`, macOS
   `Menlo, Monaco, 'Courier New', monospace`) is the *other* variable in the same webview theming
   block (F4(b)) and is the data-font analogue, not the interface one. The row already says this;
   it is recorded here only because the two constants live four lines apart in VS Code's source and
   are easy to confuse.

**And no Settings control.** The design-system artboard does draw an **Interface font** picker
(`parts/bodies/SettingsDialog.html:37`, *"Menus, toolbars, tree, labels."*, showing *"System (SF Pro
Text)"*). This phase deliberately does not build it: the user's instruction is explicit, and the
picker's only honest option on a macOS-only, single-stack app would be the one value it already has.
Recorded here so a later reader does not treat the artboard as an unimplemented requirement.

### D4 — The inventory is applied site by site, not by folder (item C, F6, F8)

The 36 data sites in F6 change token name only. The three interface sites
(`CellEditorView.vue:665`, `:705`, `slickTheme.css:659`) take `var(--kira-font-ui)`. `.p-completion`
gains `font-family: var(--kira-font-data)` (D9). Three call sites deserve their reasoning on the
record, because each could defensibly have gone the other way:

**(a) `.p-input` stays on the data font.** Its design-system original is `--font-mono` with `.ui` as
the named opt-out (F1, F9), and the app has already exercised that opt-out four times for exactly
the fields that hold app vocabulary. Most of this app's inputs carry a value that goes to a server
verbatim — host, port, database, URI, filter expression, key name, page number, header name/value,
request URL — so the default is right. If the user reports that dialogs still read as monospace, the
inversion is a **one-line** change made cheap by this phase (`.p-input { font-family:
var(--kira-font-ui) }` plus a `.data` opt-in), which is OQ-1.

**(b) The SlickGrid header row stays on the data font.** `.slick-header-column` has no declaration
and inherits `.slick-grid-host` (F6 row 9), so it moves only if the host does. It should not: a
column header is a database identifier, it must share a rhythm with the values directly beneath it,
and `views/shared/page/columns.ts:88-97`'s `headerAwareMinWidth` measures header text through the
same one measuring context the cells use (`:40-52`) — splitting the two would need a second context
keyed by family as well as size, and would invalidate `HeaderChrome.keyBadge`'s own *"`PK`/`FK` at
`--kira-t-xs` in the monospace stack, ~12px"* figure (`columns.ts:77-81`). Note that `.p-th` — the
*other* table head, in KeyValue and Stream — correctly goes the other way, because its labels
(`key`, `timestamp`, `headers`, `body`, `field`, `value`) are the app's words, not the database's.
The two behaving differently looks like an inconsistency and is LAW 08 applied correctly to two
different things.

**(c) `.method-select` stays on the data font.** `GET`/`POST` is the literal token that goes out on
the wire, not a label the app chose, and the control sits inline with the URL field, which is also
data. P22 D7 made it coloured text on a neutral ground; nothing there depends on the family.

### D5 — `.p-input.ui` stops hard-coding a font stack (item D, F9)

`theme/primitives.css:158-160`:

```css
/* P26: was the app's one hard-coded font stack (the design system's --font-ui, verbatim). Now the
   same token every other chrome surface resolves through, so the interface font has exactly one
   definition in the repo. */
.p-input.ui {
  font-family: var(--kira-font-ui);
}
```

Its four consumers (F9) are untouched. On macOS the rendered face does not change: `-apple-system`
is the first entry of both the old literal and the new token, and it always resolves on macOS 14. In
the Linux test environment it changes from `system-ui` (third in the old literal) to `system-ui`
(fifth in the new one) — the same face; the two Segoe entries in between never resolve there.

### D6 — `--kira-font-size` keeps one meaning; the interface gets a family, not a size (item E, F10, F11)

**No change to `--kira-font-size`, to the type scale, or to the Settings "Data font size" control.**
Chrome continues to size from the same scale the data does. The reasoning, with the counter-argument
stated rather than skipped:

- **The row is about family.** *"Use another font for the interface than what's used for data"* — a
  face, not a size, and the user gave no second instruction about size.
- **P22 D1 landed the coupling one phase ago, deliberately, and it is not stale.** Its F2(d)
  identified *"a user who raises Appearance → font size from 12 px to 18 px grows grid cells, tree
  rows and view targets while every button, input, select, chip and tab label stays at 10/11/13 px
  inside a 22/26 px box"* as **"the real gap"**, and closed it by making `--kira-t-xs/-sm/-lg` real
  offsets. Giving chrome a fixed size in P26 would re-open exactly that gap, one phase later, with
  no new complaint behind it.
- **There is no clean seam anyway** (F10). `--kira-t-md` *is* `--kira-font-size`, and its 18
  consumers are genuinely split between the grid cell and the tree row. A second size token would
  have to re-classify a scale that is not classified today, which is materially more work than this
  row asks for and with a much larger blast radius than the family change.
- **The app already accepts one control spanning both roles**, in the same Settings section:
  "Row height" governs *"the tree, the grid and every list"* (F11) and has drawn no complaint.
- **The honest counter-precedent**: VS Code does separate them — its UI size is a fixed `13px`
  (`themeing.ts:84`) that `editor.fontSize` never touches. That is a real argument for a second
  token, and it is the reason OQ-2 exists rather than this being closed outright. What it is not is
  a reason to reverse a decision the previous phase made on purpose, inside a phase the user framed
  as being about the *font*.

If the answer later turns out to be "chrome should not grow with the data size", the change is
one token — `--kira-font-size-ui: var(--kira-font-size)` in `tokens.css`, `--kira-t-*` re-based on
it, `body`'s `font-size` pointed at it — and nothing else moves. That cheapness is why deferring is
safe.

### D7 — The Settings dialog is not edited (item F, F12)

It already reads "Data font" / "Data font size" with the right helper copy (F12), and there is no
Interface font control to label (D3). The only text this phase touches is a **code comment**:
`fonts.ts:62-64`'s justification for every `FONT_CHOICES` stack ending in `monospace` cites `body`,
which stops being true (F13). It is rewritten to cite the surfaces the data font actually drives
after this phase — the grids, the document/key-value views and every CodeMirror editor — so an
unresolved stack still lands on a monospace face there. The list itself does not change.

### D8 — `fontStackAvailable` / `resolveFontFallback` are not run against the interface font (item G, F13)

Nothing changes in `fonts.ts`'s probing machinery beyond D7's comment. Three reasons, all checked:

1. Both functions have exactly two call sites, both reading `draft.appearance.fontFamily` (F13) —
   the data font.
2. The *"Not installed"* message (`SettingsDialog.vue:323-327`) renders inside the Data font field
   and is bound to `fontFamilyUnavailable`, which can only ever be about that value. There is no UI
   anywhere that could now incorrectly claim the interface font is missing.
3. There is nothing to probe: `--kira-font-ui` terminates in `sans-serif` (D3), a CSS generic that
   always resolves. `fontStackAvailable` measures the *primary* family against a bogus name
   (`fonts.ts:47-54`); on the shipped platform `-apple-system` always resolves, and on Linux a
   "missing `-apple-system`" report would be true, useless and unreachable — nobody chose it.

### D9 — `.p-completion` gains the declaration that keeps P22 D8's guarantee true (item H, F15(a))

`theme/primitives.css`, in the `.p-completion` block:

```css
/* P26: explicit, because this block used to get its family from `body` — which was the data font
   until P26 moved `body` to --kira-font-ui. Completion items are identifiers (tables, columns, SQL
   keywords, header names), and the CodeMirror popup this one is required to match
   (editor/theme.ts, P22 D8) names the data font directly. Without this line the two popups would
   silently diverge the moment `body` changed. */
font-family: var(--kira-font-data);
```

and `tests/ui/autocomplete.spec.ts`'s existing parity case gains `fontFamily` to the property list
it already compares (§4.3 case 3), so the coincidence F15(a) describes becomes an assertion.

### D10 — The mode-tab ink test is re-run, and its escape hatch is used only if it fires (item H, F15(b))

`tests/ui/mode-switch.spec.ts:287-317` is **expected to be the one test most likely to go red**, and
it must be run before the phase is called done. The response is already designed:

- If it passes, nothing is added. The sans label's ink centre lands within the existing 1.5 px
  tolerance and P22 D6's `--kira-icon-optical-y` stays undeclared (i.e. 0).
- If it fails, declare `--kira-icon-optical-y` in `tokens.css` with the measured value and a comment
  recording the measurement and the font it was measured against — exactly the mechanism P22 D6
  built it for (`TitleBar.vue:166` already reads it). **Do not widen the test's tolerance**, and do
  not give `.mode-label` a font-family of its own: a mode tab is chrome, and a per-component font
  override would be the first crack in the split this phase exists to make.

The test's own comment (`:306-308`) notes the residual is *"sub-pixel on the two words this app
actually renders ("Studio" has no descender, "Api" does)"* — that reasoning was written about
Menlo's metrics and is what the re-run re-checks.

---

## 3. Commit sequence

Conventional Commits, one concern each. `bun run lint` (including `scripts/check-tokens.sh`),
`bun run typecheck` and `bun run build` per commit; `bun run test:ui` runs once near the end per
`CLAUDE.md`'s cadence rule.

| # | Commit | Covers |
|---|---|---|
| T1 | `refactor(theme): the font family is two named roles over one Appearance channel` | D1, D3 — declares `--kira-font-data` / `--kira-font-ui`; **renders nothing differently** (`--kira-font-ui` has no consumer yet) |
| T2 | `refactor(theme): every data surface names the data font` | D4's 36-site rename to `var(--kira-font-data)`, including `columns.ts`'s JS read. Still render-identical |
| T3 | `feat(theme): the interface renders in VS Code's own UI font` | D2 (`body`), D4's three interface sites, D5 (`.p-input.ui`), D9 (`.p-completion`). **The one commit that changes what a user sees** |
| T4 | `test(theme): the two completion popups render in the same font` | §4.3 case 3 — D9's guard |
| T5 | `test(theme): chrome and data render in different families` | §4.3 cases 1-2 — the phase's own guard |
| T6 | `docs(spec): P26 implemented` | the SPEC row, `fonts.ts`'s stale comment (D7) if not already in T3 |

Ordering notes: T1 → T2 → T3 is required and is the point of the split — T1 and T2 are provably
render-identical (nothing references the new UI token yet), so if anything looks wrong after the
phase, T3 is the only commit that can have caused it, and reverting it restores the previous
appearance in one step. T4/T5 may land in either order after T3. A mode-tab fix, if F15(b) fires,
lands as its own follow-up commit after `test:ui` — not folded into T3.

---

## 4. Verification plan

### 4.1 Unit (`bun run test:unit`)

**None added.** Every change in this phase is a CSS custom-property value or a token rename;
`CLAUDE.md` names exactly this class as "gets nothing". `fonts.ts`'s probing functions are untouched
(D8) and keep whatever coverage they have.

### 4.2 Lint / build

- `scripts/check-tokens.sh` proves `--kira-font-data` and `--kira-font-ui` resolve — but only for
  `.vue`/`.css` references (F3). `editor/theme.ts`'s four references are **not** covered, which is
  why §4.3 case 1 asserts a computed family on a CodeMirror surface rather than trusting lint.
- `bun run build` must stay clean; nothing here is type-level.

### 4.3 UI (`bun run test:ui`) — the cases this phase owes

New file, `tests/ui/font-roles.spec.ts` (cases 1-2), plus one addition to an existing spec:

1. **Data surfaces render in the data font.** Open a data tab; read
   `getComputedStyle(el).fontFamily` for a `.slick-cell`, a `.cm-scroller` (open the console), a
   `.p-td` (open a key/value view) and `[data-testid="operations-…"] .mono`; assert each equals the
   computed value of `--kira-font-data` on `:root`, and that it is **not** the computed
   `--kira-font-ui`. Covers the editor path lint cannot (F3).
2. **Chrome renders in the interface font, and the two are different.** Read the computed
   `fontFamily` of a `.p-btn` in the toolbar, a `TreeRow` label, a tab title in `TabStrip`, a
   `DialogFrame` title (open Settings) and the status bar; assert each equals `--kira-font-ui`;
   assert `--kira-font-ui !== --kira-font-data` on `:root`; and assert `--kira-font-ui`'s computed
   value contains neither `Menlo` nor `monospace` — the one assertion that would catch a token
   accidentally aliased back to the channel.
3. **`autocomplete.spec.ts`** (existing, `:575-609`) — D9: add `fontFamily` to the property set the
   plain-field popup and the CodeMirror popup are compared on, alongside the
   `padding`/`borderRadius`/`maxWidth`/`backgroundColor` it already compares.
4. **`mode-switch.spec.ts`** (existing, `:287-317`) — D10: run it, unmodified. It is the phase's
   canary (F15(b)). A failure is fixed with `--kira-icon-optical-y`, never by relaxing the bound.
5. **`control-sizing.spec.ts`** (existing) — run it unchanged. Every assertion in it is a *height*,
   and heights are token-driven, so it must stay green; a failure there would mean something moved
   that this phase had no business moving.
6. **`settings-apply-on-save.spec.ts`** (existing, `:185-190`) — run it unchanged: the Data font
   select is still 26 px, still writes `appearance.fontFamily`, and still previews in the chosen
   stack (`SettingsDialog.vue:320`'s inline `:style`, which reads the draft value directly and is
   unaffected by any token).

### 4.4 What is deliberately not verified

- **How the sans face actually looks on a real Mac.** This sandbox cannot build or render the app
  (`CLAUDE.md`: no `wails3`, no display); `-apple-system` never resolves here, so every `tests/ui`
  run measures the Linux end of D3's chain. §4.3 case 2's assertions are written to be
  face-independent for exactly that reason — they compare *which token* an element resolved to, not
  which family name came back.
- **The exact glyph width of chrome text.** Chrome gets narrower under a proportional face (more
  tabs fit, labels stop reserving monospace advances). No test pins a chrome text width today and
  none is added; the two `ch` reservations that would have mattered both stay on the data font
  (F14).
- **Locale/CJK behaviour.** VS Code carries five `:lang()` variants per platform (F4(a)); this app
  has no localization layer at all, so there is nothing to mirror.

---

## 5. What this phase deliberately does not do

- **Does not add a Settings control for the interface font** (D3), despite the design-system
  artboard drawing one.
- **Does not change `--kira-font-size`, the `--kira-t-*` scale, or the Row height control** (D6).
- **Does not re-pick the data font's default or `FONT_CHOICES`** — the design system's own
  `--font-mono` differs from the app's default and staying different is not this row's problem.
- **Does not change which four inputs carry `.p-input.ui`** (D5, OQ-1).
- **Does not move the SlickGrid header row, `.p-input`, `.method-select`, `.p-run-state`,
  `.p-badge`/`.p-count` or the type chip in a tooltip** to the interface font — each is argued
  individually in D4/F6 rather than swept by folder.
- **Does not touch the codicon icon font** (`base.css:2`), `.slick-sort-indicator`'s codicon
  content, or `primitives.css:1016`'s `font-family: codicon`.
- **Does not add per-component font overrides.** After this phase there are exactly two font tokens
  and every surface names one of them (D10's own constraint).

---

## 6. Open questions, with their resolutions

**OQ-1 — Should `.p-input`'s default be the interface font, with data as the opt-in?**
*Resolved: not in this phase, and cheap to reverse.* The design system's default is mono with `.ui`
as the opt-out, the app already uses that opt-out in the four places it decided held app vocabulary
(F9), and most of this app's inputs hold values that go to a server verbatim (D4(a)). If the user
reports that dialogs still read as monospace after this phase, the inversion is one rule plus a
`.data` opt-in class, and this phase's tokens are what make it one rule.

**OQ-2 — Should chrome get its own fixed font size, the way VS Code's `13px` is fixed?**
*Resolved: not in this phase; recorded because the counter-precedent is real.* D6 lays out both
sides. The deciding factor is that P22 D1 coupled the type scale to the Appearance size deliberately
one phase ago and nobody has complained about the result; reversing it inside a phase about *family*
would be re-litigating a fresh decision on no evidence. The follow-up, if wanted, is one token
(`--kira-font-size-ui`) and is named in D6.

**OQ-3 — Does the connection tree reading in a sans face need a second look?**
*Resolved: it is the intended outcome, and it is the phase's most visible change.* F8(a): the design
system's own helper copy for the interface font names *"tree"*, and VS Code renders Explorer
filenames in the UI font. Flagged here so that if it comes back as a complaint, the answer is a
deliberate re-classification of `TreeRow` (one declaration, `var(--kira-font-data)`), not a
rediscovery of the whole question.

**OQ-4 — Should `docs/v1/SPEC.md` §8.2's "one font family + size for the whole app" be edited?**
*Resolved: no.* It is a v1 chapter document and an accurate record of what v1 shipped. The v1.2 SPEC
row is where the reversal is recorded (§0.3 correction 2), which is this repo's own convention for
a later chapter superseding an earlier one.

---

## Checklist

- [x] T1 `refactor(theme): the font family is two named roles over one Appearance channel`
- [x] T2 `refactor(theme): every data surface names the data font`
- [x] T3 `feat(theme): the interface renders in VS Code's own UI font`
- [x] T4 `test(theme): the two completion popups render in the same font`
- [x] T5 `test(theme): chrome and data render in different families`
- [x] `bun run lint` / `typecheck` / `build` clean after every commit
- [x] `bun run test:ui` run once at the end; `mode-switch.spec.ts` (D10) and `control-sizing.spec.ts`
      explicitly among them; failures fixed as follow-up commits — `mode-switch.spec.ts` passed
      unchanged after T3, so `--kira-icon-optical-y` was never declared
- [x] `fonts.ts:62-64`'s `body` comment corrected (D7)
- [x] `docs/v1.2/SPEC.md`'s P26 row updated

---

## 7. Sources

**Read in this worktree at `f56b353`** (every `file:line` above points at that commit):
`apps/kira-studio/frontend/src/theme/{tokens,base,primitives}.css`,
`theme/primitives/{TextField,AutocompleteField,PanelSearchBox,DialogFrame}.vue`,
`editor/{theme.ts,CodeMirrorHost.vue}`,
`workbench/{SettingsDialog,AppTooltip,StatusBar,TitleBar}.vue`, `workbench/panels/OperationsPanel.vue`,
`shortcuts/CommandPalette.vue`,
`views/shared/{page/columns.ts,page/PagerControls.vue,slick/slickTheme.css,document/DocumentRow.vue,document/DocumentTree.vue,celleditor/CellEditorView.vue}`,
`views/{grid/DataView,documents/DocumentView,stream/StreamView,definition/DefinitionView,console/ConsoleView,console/ConsoleResultGrid,console/ExplainResultView}.vue`,
`api/{MethodSelect,DynamicValuesDialog}.vue`,
`project/{ConnectionDialog,SchemaDialog,FiltersDialog,ErrorPopover,TreeRow}.vue`,
`state/settings.ts`, `fonts.ts`, `scripts/check-tokens.sh`, `README.md`, `docs/ARCHITECTURE.md`
(searched: it carries no font or type-scale facts, so nothing there needs updating),
`docs/v1/SPEC.md` §8.2, `docs/v1/plans/P31-polish-bugfix-batch.md` (F13/F14),
`docs/design/kira-design-system/parts/_style.css` and `parts/bodies/{System,SettingsDialog}.html`,
`apps/kira-studio/tests/ui/{autocomplete,mode-switch,control-sizing,settings-apply-on-save}.spec.ts`,
and `tailwindcss@4.3.3`'s `preflight.css` (the `font: inherit` on form controls, F2).

**`microsoft/vscode`, read at `17c5935aa72fa5bfb3ea2c6f07c49280cc276a3c`** (`main`; SHA obtained via
`git ls-remote`, files via `raw.githubusercontent.com`, since this session has no GitHub API access
to that repository): `src/vs/base/browser/fonts.ts:18` (`DEFAULT_FONT_FAMILY`),
`src/vs/workbench/browser/media/style.css:10-29` (the per-platform workbench rules),
`src/vs/workbench/contrib/webview/browser/themeing.ts:82-91` (`--vscode-font-family` /
`--vscode-font-size` / `--vscode-editor-font-family`, the split this phase mirrors),
`src/vs/editor/common/config/fontInfo.ts:222-243` (`EDITOR_FONT_DEFAULTS` — the font this phase
deliberately does **not** copy), `src/vs/editor/standalone/browser/standalone-tokens.css:11` and
`src/vs/base/browser/ui/contextview/contextview.ts:503` (the `"HelveticaNeue-Light"` union),
`src/vs/code/browser/workbench/callback.html`, `extensions/github-authentication/media/auth.css`,
`extensions/markdown-language-features/media/markdown.css` (the union D3 ships).

**Not run**: `bun run build`, `bun run lint`, `bun run test:ui`, `bun run test:unit`.
`frontend/bindings/` is generated by `wails3`, which is not installed in this Linux sandbox, and
`node_modules` is not populated in this worktree. Every claim above is a reading of committed source
or of a pinned dependency's own source; §4.4 names what stays unverified, and §4.3 is written so
that the two things a rendering would have settled — that the two roles really do resolve to
different families, and that the two completion popups still match — are settled by a test instead.

**Prior plans**: `docs/v1.2/plans/P22-shared-primitives-and-tokens.md` (D1's role-layer idiom and
its `--kira-t-*` offsets, D5/D6's mode-tab ink test and `--kira-icon-optical-y`, D8's completion-popup
unification — all three interact with this phase and are cited above),
`docs/v1.1/plans/P28-settings-panel-overhaul.md` (the `FONT_CHOICES` dropdown this phase leaves
alone), `docs/v1/plans/P31-polish-bugfix-batch.md` (F13's measuring-context reset, F14's record of
the `.p-input.ui` divergence this phase closes).
