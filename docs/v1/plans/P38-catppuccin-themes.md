# P38 — The Catppuccin theme family: five palettes, one token set

> SPEC.md §10's **P38** row, verbatim:
>
> *"Add the [Catppuccin](https://github.com/catppuccin/vscode) theme family (Latte/Frappé/Macchiato/Mocha) as selectable app themes, alongside the app's current single fixed dark theme, with a picker in the settings dialog"*, with the rationale *"Not yet planned — queued. The `theme/tokens.css` variable set was designed around one dark palette; how much of it maps cleanly onto four new palettes (including a light one, Latte) is an open question for that plan."*
>
> **This plan answers that question, and the answer is: all of it maps, and the reason is that the token set was never really "designed around one dark palette" — it was designed around VS Code Dark Modern's *colour IDs*.** Every one of `tokens.css`'s twenty chrome tokens carries a VS Code colour ID in its own comment (`editor.background`, `editorWidget.background`, `list.hoverBackground`, `button.background`, …), and the Catppuccin VS Code port publishes a value for each of those same IDs, per flavour (F6, F7). The mapping is therefore not a judgement call token by token — it is a lookup, with **three** documented exceptions where the port's value would invert one of this app's own surface-elevation relationships (D9), and **four** where a token has no VS Code ID behind it at all (the strip foregrounds and the badge foreground, D13).
>
> **The finding the phase turns on, and the one that makes it cheap.** A full audit of `src/renderer` (F10–F14) finds **exactly four hard-coded hex colours and eleven `rgb()`/`rgba()` literals** outside `tokens.css`, in three files. Every other colour in the entire renderer — 79 distinct `--kira-*` reads across every view, every primitive, both CodeMirror surfaces, all twelve connection swatches and all fourteen syntax tokens — already goes through a custom property. There is no canvas painting (F15), no baked-in computed colour (F16), no `prefers-color-scheme` branch (F17) and no Playwright screenshot baseline to invalidate (F18). **Adding a palette is therefore a CSS file, not a refactor** — once those fifteen literals become tokens, which is one commit (§4 step 2) that must be provably a visual no-op.
>
> **The second finding, and the one that decides Latte.** SPEC §1 says "Dark mode only" and lists light mode under "Explicitly deferred". That line was written to defer *work*, and this plan measured what the work actually is: `color-scheme: light` on `:root`, one boolean on CodeMirror's theme (F21), one `BrowserWindow.backgroundColor` (F19), one `nativeTheme.themeSource` (F20), and the fifteen literals above. That is the whole list. What "dark mode only" genuinely bought — no second icon set (the marks are `currentColor`, F22), no OS-appearance following, no `prefers-color-scheme` media queries, no second screenshot baseline — is **all still true after this phase**. So §1's constraint is revised rather than broken: **Latte ships** (D2), and what stays deferred is *automatic light/dark switching that follows the macOS appearance*, which this app still does not and will not do in v1.
>
> **The third finding, and the one that removes the migration question entirely.** `settings` is a per-leaf key/value table, and `getAllSettings` falls back **per leaf** to `defaultSettings` for any key with no row (F23, `repos/settings.ts`'s own comment says so explicitly: *"a P2 build reading a P1-era database simply finds no `data.*`/`cache.*` rows and falls back"*). A new `appearance.theme` leaf therefore needs **no migration file and no schema version bump**: every existing `~/.kira-studio/kira.sqlite` simply has no `appearance.theme` row and resolves to `kira-dark`, which is byte-for-byte the theme it already had. The only real backward-compatibility question is the *forward* one — a row holding a theme id this build does not know — and D33 answers it with a narrow, logged, one-leaf reset rather than the loud whole-settings parse failure the repo's standing rule would otherwise produce.
>
> **The fourth finding, and the one that makes live switching free.** The Vue app does not mount until `hydrateSettings()` has resolved (`renderer/main.ts`'s `bootstrap()` awaits it before `createApp`, F24), so the theme attribute is already on `<html>` before the first component renders. Combined with a `BrowserWindow.backgroundColor` sourced from the same persisted value, there is no frame at any point in startup that paints the wrong palette. **No restart, no reload, no re-measure** — the one thing in the renderer that reads a computed style is `views/grid/columns.ts`, and it reads the *font*, not a colour (F16).

## 0. Ground rules for this phase

- **No new production dependency.** The four flavours are 104 published hex values that have not changed since Catppuccin froze the palette; `@catppuccin/palette` would ship a package to hand us strings that end up inlined into CSS anyway. They are written into CSS by hand, verified against the canonical `palette.json` (F1), and a UI test re-verifies a sample of them at runtime (§5). This is P37's own ground rule reached for a different reason.
- **Catppuccin verbatim, or not at all.** Where upstream publishes a value for a role, that value is used unmodified — including where it measures poorly (F26: Latte's syntax accents run 2.1–3.3 against `base`). A Latte whose accents have been quietly darkened for contrast is a different theme wearing the name, and silently altering a published palette is the same class of dishonesty this repo forbids of an adapter that "helpfully" rewrites a port. Where the app has a token upstream has no equivalent for, the derivation is stated and measured (D11–D14), never guessed.
- **The existing dark theme does not move by one pixel.** Step 2 tokenises fifteen literals; every one of them must resolve to the identical computed colour it has today. The one deliberate exception is named in D15 (`CommandPalette.vue`'s scrim, 0.3 → 0.5) and is recorded in its commit message. `tests/ui/*.spec.ts` are the guard: they run unchanged, and none of them may need touching.
- **A theme is CSS, not JavaScript.** No palette object exists in TS beyond a five-row metadata table (id, label, `isDark`, `windowBackground`) that main needs for the two things CSS cannot reach — the native window background and `nativeTheme` (D20). A UI test asserts the table and the CSS agree, so the one duplication in the phase cannot drift (§5, scenario 12).
- **Every token that exists is set by every theme.** No theme may rely on `:root`'s defaults for a colour token — a partially-defined palette that inherits three greys from the dark theme is the failure mode this whole phase exists to avoid. Step 3's CSS is checked for totality by a test that enumerates the token names and reads all five themes (§5, scenario 11).
- Comments per `AGENTS.md`: only where the code cannot say it for itself — in particular D9's three inversions, D11's olive derivation, D14's Latte strip-foreground rule, D19's `dark` flag on the CodeMirror theme, and D33's one-leaf reset. None of those is re-derivable from the code.
- Run `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` on every commit. **Nothing in this phase needs Docker**: `tests/ui/theme.spec.ts` drives the settings dialog and never opens a connection, so unlike P34–P37 the whole phase — tests included — is executable in Claude Code's Linux web container under `xvfb-run`. There is no verify-on-container list.
- Commits follow Conventional Commits, one per step of §4.

## 1. Findings

F1–F9 are Catppuccin facts, each read from the canonical `catppuccin/palette` and `catppuccin/vscode` trees in this session rather than recalled. F10–F24 are facts about this tree, measured against it. F25–F30 are contrast measurements computed here.

### The palette

**F1 — the four flavours, verified against `catppuccin/palette`'s `palette.json`.** Fetched and printed in this session. Twenty-six named colours per flavour; `latte.dark === false`, the other three `true`. The full table, which step 3 copies verbatim:

| role | latte | frappé | macchiato | mocha |
|---|---|---|---|---|
| rosewater | `#dc8a78` | `#f2d5cf` | `#f4dbd6` | `#f5e0dc` |
| flamingo | `#dd7878` | `#eebebe` | `#f0c6c6` | `#f2cdcd` |
| pink | `#ea76cb` | `#f4b8e4` | `#f5bde6` | `#f5c2e7` |
| mauve | `#8839ef` | `#ca9ee6` | `#c6a0f6` | `#cba6f7` |
| red | `#d20f39` | `#e78284` | `#ed8796` | `#f38ba8` |
| maroon | `#e64553` | `#ea999c` | `#ee99a0` | `#eba0ac` |
| peach | `#fe640b` | `#ef9f76` | `#f5a97f` | `#fab387` |
| yellow | `#df8e1d` | `#e5c890` | `#eed49f` | `#f9e2af` |
| green | `#40a02b` | `#a6d189` | `#a6da95` | `#a6e3a1` |
| teal | `#179299` | `#81c8be` | `#8bd5ca` | `#94e2d5` |
| sky | `#04a5e5` | `#99d1db` | `#91d7e3` | `#89dceb` |
| sapphire | `#209fb5` | `#85c1dc` | `#7dc4e4` | `#74c7ec` |
| blue | `#1e66f5` | `#8caaee` | `#8aadf4` | `#89b4fa` |
| lavender | `#7287fd` | `#babbf1` | `#b7bdf8` | `#b4befe` |
| text | `#4c4f69` | `#c6d0f5` | `#cad3f5` | `#cdd6f4` |
| subtext1 | `#5c5f77` | `#b5bfe2` | `#b8c0e0` | `#bac2de` |
| subtext0 | `#6c6f85` | `#a5adce` | `#a5adcb` | `#a6adc8` |
| overlay2 | `#7c7f93` | `#949cbb` | `#939ab7` | `#9399b2` |
| overlay1 | `#8c8fa1` | `#838ba7` | `#8087a2` | `#7f849c` |
| overlay0 | `#9ca0b0` | `#737994` | `#6e738d` | `#6c7086` |
| surface2 | `#acb0be` | `#626880` | `#5b6078` | `#585b70` |
| surface1 | `#bcc0cc` | `#51576d` | `#494d64` | `#45475a` |
| surface0 | `#ccd0da` | `#414559` | `#363a4f` | `#313244` |
| base | `#eff1f5` | `#303446` | `#24273a` | `#1e1e2e` |
| mantle | `#e6e9ef` | `#292c3c` | `#1e2030` | `#181825` |
| crust | `#dce0e8` | `#232634` | `#181926` | `#11111b` |

**F2 — the tier ordering is inverted between Latte and the dark three, and that is the point.** In frappé/macchiato/mocha the ladder ascends `crust < mantle < base < surface0 < surface1 < surface2 < overlay0…`; in Latte it descends from `base` (`#eff1f5`, the lightest) down through `mantle`, `crust`, then `surface0/1/2` darker still. Any mapping expressed as "which *tier*", not "which lightness", therefore works unchanged for all four (D9).

**F3 — the official style guide's role table**, read from `catppuccin/catppuccin/docs/style-guide.md`. Background Pane → Base; Secondary Panes → Crust/Mantle; Surface Elements → Surface 0/1/2; Overlays → Overlay 0/1/2; Body Copy → Text; Sub-Headlines/Labels → Subtext 0/1; **Subtle → Overlay 1**; **On Accent → Base**; Links/URLs → Blue; **Success → Green; Warnings → Yellow; Errors → Red**; Tags/Pills → Blue; **Selection Background → Overlay 2 at 20–30% opacity**; Cursor → Rosewater; Active Border → Lavender; Inactive Border → Overlay 0.

**F4 — the style guide's syntax table**, same source: Keyword → **Mauve**; Strings → **Green**; Comments → **Overlay 2**; Constants/Numbers → **Peach**; Operators → **Sky**; Braces/Delimiters → **Overlay 2**; Methods/Functions → **Blue**; Parameters → **Maroon**; Builtins → Red/Yellow; Line Numbers → **Overlay 1**; Active Line Number → Lavender; Errors → Red; Information → Teal.

**F5 — the VS Code port's default accent is `mauve`.** `catppuccin-vsc/src/theme/index.ts`'s `defaultOptions` is `{ accent: "mauve", boldKeywords: true, italicComments: true, workbenchMode: "default", bracketMode: "rainbow", … }`, and `compileTheme` sets `type: isLatte ? "light" : "dark"`.

**F6 — the port's value for every VS Code colour ID this app's tokens are named after**, read from `catppuccin-vsc/src/theme/uiColors.ts`:

`focusBorder: accent` · `foreground: text` · `disabledForeground: subtext0` · `descriptionForeground: text` · `errorForeground: red` · `widget.shadow: opacity(mantle, 0.5)` · `selection.background: opacity(accent, 0.4)` · `editor.background: base` · `editor.foreground: text` · `editorWidget.background: mantle` · `editorSuggestWidget.background: mantle` · `editorHoverWidget.background: mantle` · `editorError.foreground: red` · `editorWarning.foreground: peach` · `editorInfo.foreground: blue` · `editorCursor.foreground: rosewater` · `editorLineNumber.foreground: overlay1` · `editor.selectionBackground: opacity(overlay2, isLatte ? 0.3 : 0.25)` · `input.background: surface0` · `dropdown.background: mantle` · `button.background: accent` · `button.foreground: crust` · `badge.background: surface1` · `badge.foreground: text` · `list.activeSelectionBackground: surface0` · `list.hoverBackground: opacity(surface0, 0.5)` · `panel.background: base` · `panel.border: surface2` · `menu.background: base` · `menu.selectionBackground: surface2` · `sideBar.background: mantle` · `sideBarSectionHeader.background: mantle` · `statusBar.background: crust` · `titleBar.activeBackground: crust` · `activityBar.background: crust` · `editorGroupHeader.tabsBackground: crust` · `tab.activeBackground: base` · `tab.inactiveBackground: mantle` · `tab.inactiveForeground: overlay0` · `scrollbarSlider.background: opacity(surface2, 0.5)` · `editorGroup.border: surface2`.

**F7 — the port's TextMate mapping**, read from `catppuccin-vsc/src/theme/tokens/index.ts`: `string` → green · `constant.character.escape` → pink · booleans/constants/numbers → peach · `keyword`/`storage.type`/`storage.modifier` → mauve · `entity.name.tag.documentation` → mauve · `keyword.operator`/`punctuation.accessor`/`punctuation.definition.tag` → teal · parentheses/brackets/braces → overlay2 · comments → overlay2 · `entity.name.function`/`support.function` → blue · classes/enums/types/namespaces → yellow · object properties → teal · **property names (left-hand assignments in json/yaml/css/less) → blue** · `variable.parameter` → maroon · `constant.language`/`support.function.builtin` → red · basic text and variable names → text.

**F8 — the style guide and the port disagree in exactly two places this app cares about.** Operators: style guide says **sky**, the port folds `keyword.operator` into its "Punctuation" group at **teal**. Warnings: style guide says **yellow**, the port's `editorWarning.foreground` is **peach**. Both divergences are resolved explicitly in D10.

**F9 — Latte's "on accent" foreground has two candidate answers and they differ measurably.** The style guide's generic rule is *On Accent → Base*; the port's `button.foreground` is `crust`. Measured against Latte's mauve `#8839ef`: `base` gives **4.79**, `crust` gives **4.09** (F27). For the three dark flavours `crust` gives 6.83/8.09/9.23 and is clearly right.

### The tree as it stands

**F10 — the entire renderer holds exactly four hard-coded hex colours, all in one file.** `grep -rnE '#[0-9a-fA-F]{3,8}\b' src/renderer` excluding `tokens.css` returns four lines, all in `theme/primitives.css`: `:382 color: #f0f0f0` (`.p-count`'s foreground on `--kira-badge`), `:621 color: #f3a3a3` (`.p-strip.err`), `:625 color: #d9c47a` (`.p-strip.warn`), `:629 color: #a8c8ee` (`.p-strip.note`). Nothing in any `.vue` file, anywhere.

**F11 — eleven `rgb()`/`rgba()` literals, in five files, and seven of them are exactly reproducible from an existing token.** `primitives.css:399/403/407/411` are `.p-chip.warn/.err/.ok/.info`'s backgrounds — `rgba(204,167,0,0.16)`, `rgba(241,76,76,0.16)`, `rgba(35,209,139,0.14)`, `rgba(55,148,255,0.16)` — whose RGB triples **are** `--kira-warn`/`--kira-error`/`--kira-ok`/`--kira-info` verbatim. `primitives.css:620/624/628` are the three `.p-strip` backgrounds at 0.10/0.10/0.08, likewise. The remaining four are modal scrims: `CommandPalette.vue:100` `rgba(0,0,0,0.3)`, `FilterHistoryMenu.vue:229`, `ConsoleSavedMenu.vue:162` and `DialogFrame.vue:107` all `rgb(0 0 0 / 0.5)`.

**F12 — `color-mix(in srgb, X, transparent)` is byte-identical to `rgba(X, α)` and the app already uses it.** Seven `color-mix` call sites exist today (`DataGrid.vue:1700/1763`, `KeyValueView.vue:879`, `StreamView.vue:894`, `DocumentView.vue:970`, P31 D21's search-match tint), so the syntax is proven in this Electron build. Converting the seven literals of F11 into `color-mix(in srgb, var(--kira-error) 16%, transparent)` form is therefore a *provable* no-op, not an approximation — which is what makes step 2 auditable.

**F13 — every one of those `color-mix` sites reads its token live**, so a search-match tint, a pending-edit tint and an FK tint all follow a palette change with no code touched. This is the load-bearing reason live switching works at all.

**F14 — 79 distinct `--kira-*` properties are read across `src/renderer`**, enumerated by `grep -rhoE '\-\-kira-[a-z0-9-]+' src/renderer | sort -u`. Of those, 48 carry a colour (20 chrome, 12 `--kira-conn-*`, 14 `--kira-syntax-*`, 2 shadows) and the rest are geometry, type scale, control heights and the two appearance tokens `applyAppearance()` already writes at runtime.

**F15 — nothing in the renderer paints to a canvas.** The only two `getContext('2d')` calls are `views/grid/columns.ts:14` and `fonts.ts`, and both call `measureText` only. The grid, the tree, the document view and the stream view are all DOM.

**F16 — the only `getComputedStyle` read in the app is a font read.** `views/grid/columns.ts:16-18` reads `--kira-font-family` and `--kira-font-size` to size columns; no colour is ever read into JS, cached, or baked into a computed value. `state/settings.ts`'s `applyAppearance()` is the only writer, and it writes three geometry/type properties. **There is no colour anywhere in this app that is resolved once and stored.**

**F17 — there is no `prefers-color-scheme` query and no `color-scheme` declaration anywhere in `src/`.** `grep -rn "color-scheme" src/` returns nothing. That is a gap Latte creates (native scrollbars, `<select>` popups, `input[type=number]` spinners and `window.confirm` — used by Redis and S3 delete — all follow it), not one that exists today.

**F18 — there are no visual baselines to invalidate.** `grep -rn "toHaveScreenshot\|toMatchSnapshot" tests/` returns nothing; `workbench.spec.ts:125` takes a screenshot but never compares it.

**F19 — `main/window.ts:16` hard-codes `backgroundColor: '#1F1F1F'`**, the pre-paint window fill, and `createWindow(db)` already `await`s `getAllLayout(db)` — so it is a function that already reads persisted state before constructing the window. `main/index.ts:75` already computes `const settings = await getAllSettings(db)` **before** `createWindow(db)` is called at `:108`.

**F20 — `nativeTheme` is not imported anywhere in `src/main`.** `titleBarStyle: 'default'`, so AppKit draws the title bar and it follows the OS appearance. Under Latte on a dark-mode Mac that is a dark title bar over a light workbench.

**F21 — `editor/theme.ts` is already 100% custom-property-driven, with exactly one hard-coded fact: `{ dark: true }`.** Every colour in `kiraEditorTheme` (46 declarations) and every entry of `kiraHighlightStyle` (14 tags) is a `var(--kira-*)` reference. The second argument to `EditorView.theme` is the only thing that does not follow the palette; it sets the `cm-dark` class and the `EditorView.darkTheme` facet, which drive CodeMirror's own base-theme fallbacks for anything this theme does not name.

**F22 — the editor host already has four Compartments and a reconfigure pattern to copy.** `CodeMirrorHost.vue:56-59` declares `languageCompartment`/`readOnlyCompartment`/`autocompleteCompartment`/`lintCompartment`; `:141-151` composes them; `:196/204/212/220` each dispatch `X.reconfigure(resolveX())` from a `watch`. A fifth compartment for the theme is the same four lines, not a new mechanism.

**F23 — settings need no migration, by the storage layer's own design.** `repos/settings.ts`'s `sectionFromStore` iterates `Object.keys(defaults)` and takes `stored.get(...) ?? defaults[key]` per leaf; its comment states the intent outright. A new `appearance.theme` key in `defaultSettings` is therefore read back as its default from every existing database, with no `migrations/` file, no `schema_version` bump and no `schema/settings.ts` change (the table is `(key, value)`). `setSettings` writes only the leaves in the patch (D15 of P0), so patching `{ appearance: { theme } }` touches exactly one row.

**F24 — the Vue app does not mount until settings have hydrated.** `renderer/main.ts`'s `bootstrap()` is `await Promise.all([hydrateLayout(), hydrateSettings(), …])` **then** `createApp(App).mount('#app')`. `hydrateSettings` → `applySettings` → `applyAppearance()`, so whatever `applyAppearance()` writes to `<html>` is in place before the first component renders.

**F25 — the settings dialog's Cancel already covers a new appearance leaf for free.** `SettingsDialog.vue:26-32` JSON-clones `settingsState.appearance` (the whole object) into `initialSettings` on open and `onCancel` patches it back. A `theme` key added to `AppearanceSettings` is captured and reverted with no code change.

**F26 — the connection palette is theme-shaped already, and the engine accents ride on it.** `theme/connColor.ts` returns the *string* `var(--kira-conn-${color})` — never a resolved colour — and `connections.color` stores the name (`connectionColorSchema`, twelve options plus `none`). `ConnectionDialog.vue`'s `KIND_ACCENT` maps each of the eleven engines to one of those names. So re-defining the twelve properties per theme re-colours every rail, dot, tab and engine tile with no stored data touched and no TS changed.

### Measured contrast (computed in this session, sRGB WCAG 2.x)

**F27 — Latte's chrome is comfortable and its accents are not.** Against `base` `#eff1f5`: `text` **7.06**, `subtext0` **4.37**, `overlay2` **3.49**, `overlay1` **2.83**. `text` on `surface1` (the input tier) **4.39**. Accent-fg on mauve: `base` **4.79** vs `crust` **4.09** (F9). Syntax accents against `base`: red **4.80**, mauve **4.79**, blue **4.34**, teal **3.31**, green **2.96**, peach **2.64**, sky **2.47**, pink **2.34**, yellow **2.31**.

**F28 — the dark flavours are comfortable throughout.** Mocha against `base`: `text` **11.34**, `subtext0` **7.37**, `overlay2` **5.81**, `overlay1` **4.44**; `crust` on mauve **9.23**.

**F29 — the selection alpha has one value per side that clears AA.** `text` over an accent-tinted selection, computed at three alphas over both `base` and `mantle`: at **0.40** frappé is 3.81 (fails); at **0.35** frappé is 4.17 (fails); at **0.30** frappé is **4.57**, macchiato 5.37, mocha 5.88 (all pass). Latte at 0.30 falls below its 0.25 reading; at **0.25** Latte is **4.92** on `base` and **4.62** on `mantle` (passes).

**F30 — the strip foregrounds split by side.** With a 10%/10%/8% tint over `base`: on the dark flavours the flavour's own red/yellow/blue as the foreground measures 5.97 (mocha err) and up. On Latte the same choice measures red **4.06**, blue **3.92** and yellow **2.13** — the last unusable as 11px body copy. `text` over those same Latte tints measures above 6.4 in all three tones.

## 2. Shapes introduced in this plan

```ts
// src/shared/theme.ts — NEW. The only place a theme exists in TypeScript. Five rows, four
// fields; every colour lives in CSS (D3).

export const themeIdSchema = z.enum([
  'kira-dark',            // the app's original palette — VS Code Dark Modern (§8.1)
  'catppuccin-latte',     // the family's one light flavour (D2)
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
]);
export type ThemeId = z.infer<typeof themeIdSchema>;

export const DEFAULT_THEME_ID: ThemeId = 'kira-dark';

export interface ThemeMeta {
  readonly label: string;
  /** Shown under the label in the picker; one line, never a sentence. */
  readonly note: string;
  /** Drives `color-scheme`, CodeMirror's `dark` flag (D19) and nativeTheme.themeSource (D20). */
  readonly isDark: boolean;
  /**
   * The theme's own --kira-bg-chrome, duplicated here because BrowserWindow.backgroundColor is
   * painted before any stylesheet exists (F19). tests/ui/theme.spec.ts asserts the two agree.
   */
  readonly windowBackground: string;
}

export const THEMES: Readonly<Record<ThemeId, ThemeMeta>>;
export const THEME_IDS: readonly ThemeId[];   // themeIdSchema.options, picker order
```

```css
/* src/renderer/theme/catppuccin.css — NEW. Four blocks, one per flavour, each setting every
   colour token the app has. Written as a bare attribute selector, not `:root[…]`, so a single
   element can scope a whole palette — which is what makes the settings picker's preview tiles
   pure CSS with no palette data in JS (D26). */

[data-kira-theme='catppuccin-mocha'] { color-scheme: dark;  /* … 48 colour tokens … */ }
[data-kira-theme='catppuccin-latte'] { color-scheme: light; /* … 48 colour tokens … */ }
```

```css
/* src/renderer/theme/tokens.css — MODIFIED. The existing palette becomes an explicitly named
   theme that is also the un-attributed default, so an unset attribute can never yield a
   half-themed document. Five new tokens (D13/D15) join it. */

:root,
[data-kira-theme='kira-dark'] {
  color-scheme: dark;
  /* … the 48 existing colour tokens, unchanged … */
  --kira-badge-fg: #f0f0f0;        /* was primitives.css's .p-count literal (F10) */
  --kira-strip-err-fg: #f3a3a3;    /* was primitives.css's .p-strip.err literal */
  --kira-strip-warn-fg: #d9c47a;
  --kira-strip-note-fg: #a8c8ee;
  --kira-scrim: rgb(0 0 0 / 0.5);  /* modal/menu backdrop (D15) */
}
```

```ts
// src/shared/settings.ts — MODIFIED. One leaf, no migration (F23).
export const appearanceSettingsSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  rowDensity: rowDensitySchema,
  theme: themeIdSchema,
});
// defaultSettings.appearance.theme = DEFAULT_THEME_ID
```

```ts
// src/renderer/state/settings.ts — MODIFIED.
export function applyAppearance(): void {
  const root = document.documentElement;
  root.dataset.kiraTheme = settingsState.appearance.theme;   // the whole switch, one line (D17)
  root.style.setProperty('--kira-font-family', …);           // unchanged
  …
}
```

```ts
// src/renderer/editor/theme.ts — MODIFIED. One spec, two instances; the only difference is the
// flag CodeMirror's own base theme reads (D19, F21).
const EDITOR_THEME_SPEC = { /* … the existing 46 declarations, unmoved … */ };
export const kiraEditorThemeDark  = EditorView.theme(EDITOR_THEME_SPEC, { dark: true });
export const kiraEditorThemeLight = EditorView.theme(EDITOR_THEME_SPEC, { dark: false });
export function editorThemeFor(themeId: ThemeId): Extension;
```

```ts
// src/main/theme.ts — NEW. Two lines of native chrome, in one place (D20/D21).
export function applyNativeTheme(themeId: ThemeId): void;   // nativeTheme.themeSource + every
                                                            // open window's backgroundColor
```

## 3. Decisions

### Topic A — scope, and the "dark mode only" question

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Five themes ship: `kira-dark` plus the four Catppuccin flavours. `kira-dark` stays the default and stays byte-for-byte what it is today.** | The SPEC row says "alongside the app's current single fixed dark theme", and the existing palette is the one every screenshot, every plan and the whole design system canvas is drawn in. Making Mocha the default would silently re-skin every existing install on upgrade — a change nobody asked for, delivered by a phase whose job is to *offer* a choice. |
| D2 | **Latte ships, and SPEC §1's "Dark mode only" is revised rather than violated.** The new wording: dark by default, with **Catppuccin Latte** as the one light palette in v1; what remains deferred is **following the macOS appearance automatically** (no `prefers-color-scheme`, no `themeSource: 'system'`, no auto-switch at sunset). | The deferral was a deferral of *work*, and F10–F22 measured the work exactly: four hex literals, eleven `rgb()` literals, one `color-scheme` declaration, one CodeMirror boolean, one window background and one `nativeTheme` call. Everything "dark mode only" actually bought is still true afterwards — the engine marks are `currentColor` (F22 via `_icons.html`'s own header), there is no second icon set, no second screenshot baseline (F18) and no media query anywhere (F17). Deferring Latte instead would mean shipping "the Catppuccin theme family" minus the flavour most often asked for, in a phase whose own SPEC row names it, to protect a sentence that the same SPEC's phasing table already contradicts — and §1's own preamble says *"Where this spec and the tree disagree, the tree is authoritative"*. Deciding it here, in writing, is the whole point of the open question. |
| D3 | **No new dependency. The 104 palette values are written into CSS by hand, verified against `catppuccin/palette`'s `palette.json` (F1), and re-verified at runtime by a UI test.** | The palette is frozen upstream and consumed as CSS regardless; `@catppuccin/palette` would add a package, a lockfile entry and a build-time transform to deliver strings that end up inlined anyway. The runtime test (§5 scenario 10) is what makes the hand-copy safe: it reads six representative properties out of all five themes in the real app and compares them to the table in this document, so a transposed digit fails a test rather than shipping. |
| D4 | **Nothing in `src/engine` or `src/shared/protocol` is touched, and no adapter, view module, page kind or Zod page schema changes.** The complete list of non-CSS source files this phase edits is thirteen, enumerated in §7. | Stated plainly because a "theming phase" is exactly the kind of phase that quietly grows into a repaint of every component. It does not need to: F14 says every view already reads tokens. |

### Topic B — the token mapping (the plan's central question)

| # | Decision | Rationale |
|---|----------|-----------|
| D5 | **The governing rule, in one sentence: for every token whose `tokens.css` comment names a VS Code colour ID, the value is the Catppuccin VS Code port's value for that same ID (F6); for every syntax token, the value is the official style guide's value for that language role (F3/F4); the exceptions are D9's three, D10's two and D11–D14's four, and there are no others.** | This is what makes the mapping checkable rather than a matter of taste. Both sources are canonical Catppuccin, and the split follows the token names' own provenance: the chrome tokens were named after VS Code colour IDs (`--kira-bg-elevated: #202020; /* editorWidget.background */`), so the port — which is a VS Code theme — is the direct translation; the syntax tokens are named after language roles (`--kira-syntax-keyword`, `--kira-syntax-operator`), not TextMate scopes, so the style guide's own role table is the direct translation. A reviewer can re-derive every value in the table below from one of two published documents. |
| D6 | **The chrome mapping, token by token.** | Each row's third column is the source. |

| token | VS Code ID it is named after | Catppuccin role | source |
|---|---|---|---|
| `--kira-bg` | `editor.background` | **base** | F6 |
| `--kira-bg-elevated` | `editorWidget.background` | **mantle** | F6 |
| `--kira-bg-chrome` | sideBar / statusBar / titleBar / panel | **crust** | F6 (`statusBar`/`titleBar`/`activityBar` = crust) + D9 |
| `--kira-bg-input` | `input` + `dropdown` | **surface0** | F6 (`input.background`) + D9 |
| `--kira-fg` | `foreground` | **text** | F6 |
| `--kira-fg-muted` | (label/secondary text) | **subtext0** | F3 ("Sub-Headlines, Labels") |
| `--kira-fg-disabled` | `disabledForeground` | **overlay1** | F3 ("Subtle") + D9 |
| `--kira-border` | `contrastBorder` / `panel.border` | **surface0** | D9 |
| `--kira-border-strong` | `widget.border` | **surface1** | D9 |
| `--kira-focus` | `focusBorder` | **mauve** (the accent) | F6 |
| `--kira-accent` | `button.background` | **mauve** (the accent) | F5/F6 |
| `--kira-accent-fg` | `button.foreground` | **crust** (dark) / **base** (Latte) | F6 / F3 + F9 → D12 |
| `--kira-select` | `list.activeSelectionBackground` | `color-mix(in srgb, mauve 30%, transparent)` (dark) / `25%` (Latte) | F6 (`selection.background: opacity(accent, .4)`) + F29 → D12 |
| `--kira-hover` | `list.hoverBackground` | `color-mix(in srgb, surface0 50%, transparent)` | F6 verbatim |
| `--kira-badge` | `badge.background` | **surface2** | F6 says surface1; D9 |
| `--kira-badge-fg` | `badge.foreground` | **text** | F6 |
| `--kira-scrollbar` | `scrollbarSlider.background` | `color-mix(in srgb, surface2 50%, transparent)` | F6 verbatim |
| `--kira-error` | `editorError.foreground` | **red** | F6 + F3 |
| `--kira-warn` | `editorWarning.foreground` | **yellow** | F3 over F6 → D10 |
| `--kira-ok` | (success) | **green** | F3 |
| `--kira-info` | `editorInfo.foreground` | **blue** | F6 + F3 |
| `--kira-shadow` | — | `0 2px 8px rgb(0 0 0 / 0.32)` (dark) / `/ 0.10` (Latte) | D12 |
| `--kira-shadow-dialog` | — | `0 8px 28px rgb(0 0 0 / 0.45)` (dark) / `/ 0.18` (Latte) | D12 |
| `--kira-scrim` | — | `rgb(0 0 0 / 0.5)` (dark) / `/ 0.28` (Latte) | D12/D15 |
| `--kira-strip-err-fg` | — | `var(--kira-error)` (dark) / `var(--kira-fg)` (Latte) | F30 → D14 |
| `--kira-strip-warn-fg` | — | `var(--kira-warn)` (dark) / `var(--kira-fg)` (Latte) | F30 → D14 |
| `--kira-strip-note-fg` | — | `var(--kira-info)` (dark) / `var(--kira-fg)` (Latte) | F30 → D14 |

| # | Decision | Rationale |
|---|----------|-----------|
| D7 | **The syntax mapping, token by token:** `comment` → **overlay2** · `string` → **green** · `number` → **peach** · `keyword` → **mauve** · `control` → **pink** · `name` → **text** · `property` → **blue** · `function` → **yellow** · `tag` → **mauve** · `attribute` → **teal** · `operator` → **sky** · `punctuation` → **overlay2** · `meta` → **overlay1** · `invalid` → **red**. | Eleven of the fourteen are F3/F4/F7 read straight off. The three that needed a call: **`control`** (the app keeps a keyword/control-flow distinction Dark Modern drew with `#569cd6` vs `#c586c0`; Catppuccin's nearest analogue to that magenta is **pink**, and collapsing control into mauve would lose a cue this app's SQL and Mongo consoles rely on); **`property` → blue** (the port has two rules — object properties → teal, and *"property names (left-hand assignments in json/yaml/css/less)"* → blue — and this app's dominant syntax surface by far is **JSON**, in the cell editor, the document view, the definition view's EJSON pane and the command preview, so the JSON rule is the one that governs); **`function` → yellow** (the port gives `entity.name.function` blue, which `property` has just taken; yellow is the port's own colour for named entities — classes, enums, types, namespaces — and it preserves Dark Modern's yellow-function cue so a user switching themes does not lose it). `attribute` → teal follows for the same reason: an XML attribute *is* an object property, which the port colours teal. |
| D8 | **`kiraHighlightStyle`'s tag→token grouping is frozen. No syntax token is added, split or removed in this phase.** In particular `tags.bool`, `tags.null`, `tags.typeName` and `tags.atom` keep sharing `--kira-syntax-keyword`, and therefore render **mauve** under Catppuccin where upstream would give them peach/yellow/red. | Splitting them would change how the **existing dark theme** renders — the one thing §0 forbids — and it would do so in a phase about adding palettes, where a rendering change to the default theme is indistinguishable from a bug. The approximation is named rather than hidden, and widening the token set is listed in §6 as the follow-up it is. |
| D9 | **Where the port's value for a colour ID would invert one of this app's own surface relationships, the app's grammar wins and the nearest Catppuccin tier in the correct direction is used. This bites in exactly five places, all listed here and nowhere else.** (a) `--kira-bg-chrome` covers `sideBar` *and* `statusBar` *and* `titleBar` *and* the panel gaps, for which the port has two values (mantle, crust); **crust** is chosen because in this app that token paints the surface *behind* every panel, which is the outermost tier. (b) `--kira-border` would be `panel.border` = surface2, a hairline two tiers above `bg` where Dark Modern's is one step; **surface0**. (c) `--kira-border-strong` = `editorGroup.border` = surface2 for the same reason; **surface1** — which also preserves Dark Modern's own `border-strong === bg-input` identity (both `#313131`). (d) `--kira-badge` = surface1 would then collide with `--kira-bg-input`; **surface2**, which restores Dark Modern's badge-lighter-than-input relationship (`#616161` vs `#313131`). (e) `--kira-fg-disabled` = `disabledForeground` = subtext0 would collide with `--kira-fg-muted`; **overlay1**, the style guide's own "Subtle". | The resulting ladder is monotonic on both sides and preserves every ordering Dark Modern had. Mocha: chrome `#11111b` < bg `#1e1e2e` < elevated `#181825`… — note elevated is *below* bg, which is deliberate and is Catppuccin's own grammar, not an accident: the port puts `editorWidget`, `editorSuggestWidget`, `editorHoverWidget`, `sideBar` and `tab.inactiveBackground` all at mantle and `editorGroupHeader.tabsBackground` at crust, i.e. **chrome and floating surfaces recede rather than advance**. A grid header darker than its rows and a menu darker than the page is what Catppuccin looks like in every editor that ships it. Latte inverts the whole ladder in lightness while keeping every relationship (F2), so the same five choices hold there unchanged. |
| D10 | **The two style-guide/port disagreements (F8) are resolved as: `--kira-warn` → yellow (style guide), `--kira-syntax-operator` → sky (style guide).** | `--kira-warn` is a **UI** token in this app, not `editorWarning`: it paints the staged-edit gutter rail, the `warn` chip, the `warn` strip, the PK marker in a grid header and the search-match tint. The style guide's general rule for that role is Warnings → Yellow, and peach would additionally collide with `--kira-conn-orange`'s source colour — a pending-edit rail that reads as an orange connection rail is a real confusion in a grid tinted by connection colour. `operator` → sky keeps operators distinct from `punctuation` (overlay2), which the port's grouping would collapse; the style guide lists them as two separate roles for exactly that reason. |
| D11 | **The twelve connection colours are re-derived per theme from that flavour's own accents:** red→**red**, orange→**peach**, amber→**yellow**, green→**green**, teal→**teal**, cyan→**sky**, blue→**blue**, indigo→**lavender**, violet→**mauve**, magenta→**pink**, grey→**overlay2**, and **olive → `color-mix(in oklab, <yellow> 50%, <green> 50%)`** — approximately `#9e9a25` (latte), `#c7cd8c` (frappé), `#ccd79a` (macchiato), `#d2e3a8` (mocha). | Eleven of the twelve land on a Catppuccin accent at the same hue. The twelfth does not, because **Catppuccin publishes no accent between yellow (~40°) and green (~110°)** — its fourteen accents cluster in the reds and blues. Inventing a hex would be off-palette; reusing green would give the picker two identical swatches and make the stored name `olive` a lie. The oklab midpoint of the flavour's own yellow and its own green *is* olive, is built from nothing but that flavour's palette, and is one self-documenting line. The alternative — freezing `--kira-conn-*` at the existing `oklch(0.72 0.09 h)` values across all five themes — was considered and rejected: those pastels are tuned for a dark ground and a 0.72-lightness rail on Latte's `#eff1f5` base is barely visible, which is a correctness failure, not a taste one. **The cost is named:** within a Catppuccin theme the design system's *"one lightness, one chroma, so no connection shouts louder than another"* law (P16, `System.dc.html` §02) no longer holds, because Catppuccin's accents are not equal-lightness. That is the right trade — Catppuccin's accents are balanced *within* a flavour by their own designers — and `kira-dark` keeps the oklch law untouched, so the law is not lost, only scoped to the theme it was derived for. |
| D12 | **Four values differ between Latte and the three dark flavours, and all four are measured, not judged:** `--kira-accent-fg` (**base** on Latte 4.79, **crust** on dark 6.83–9.23, F9/F27/F28); `--kira-select` (**25%** on Latte 4.92/4.62, **30%** on dark 4.57–6.28, F29); `--kira-shadow`/`--kira-shadow-dialog` (0.10/0.18 on Latte, 0.32/0.45 on dark); `--kira-scrim` (0.28 on Latte, 0.5 on dark). Everything else is the same expression in all four. | The two sources genuinely disagree on `accent-fg` (F9) and the measurement breaks the tie. The selection alpha is the one place where "use the port's `opacity(accent, 0.4)`" fails a real check — frappé's `text` over a 40% mauve tint is 3.81, below AA — so the port's *approach* is kept and its *number* is replaced by the largest value that passes on every flavour. Shadows and scrims are pure black over a light ground; keeping dark-theme alphas would give Latte a heavy, muddy backdrop that no light theme uses. |
| D13 | **Four tokens are added because four colours in the app have no token at all today (F10):** `--kira-badge-fg`, `--kira-strip-err-fg`, `--kira-strip-warn-fg`, `--kira-strip-note-fg`. In `kira-dark` they take exactly the literals they replace (`#f0f0f0`, `#f3a3a3`, `#d9c47a`, `#a8c8ee`), so the dark theme's rendering is unchanged. | These four are the entire reason a second palette was not already possible: `#f0f0f0` on Latte's `surface2` badge and `#d9c47a` on a pale yellow strip are both illegible, and neither is derivable from any existing token. Four tokens, one commit, no new mechanism. |
| D14 | **The strip foreground is the flavour's own accent on the three dark flavours and the flavour's `text` on Latte.** | Measured (F30): on the dark flavours the accents are pastels and read at 5.97+ over their own 10% tint; on Latte the same choice measures 4.06 (red), 3.92 (blue) and **2.13** (yellow) — the last unusable as 11px body copy. On Latte the tint carries the tone and `text` carries the words, at 6.4+. This is the one rule in the phase that differs by side rather than by value, and it is stated in a comment in the CSS because it is not re-derivable from the numbers. |
| D15 | **The seven derivable `rgb()`/`rgba()` literals (F11) become `color-mix(… , transparent)` over their existing token — a provable no-op (F12). The four scrims become one new `--kira-scrim` token.** `CommandPalette.vue`'s scrim deepens from `0.3` to `0.5` in the process: this is the phase's **single acknowledged pixel change to the existing dark theme**, recorded in its commit message. | Shipping two scrim tokens forever so that one of four modal backdrops can stay 0.2 lighter than the other three is worse than unifying them; the palette is the app's, and four backdrops that disagree is the inconsistency the P16 design system exists to remove. Naming it here is what keeps step 2's "provably a no-op" claim honest — it is a no-op *except this*, and a reviewer should be able to find that sentence rather than the diff. |

### Topic C — the mechanism

| # | Decision | Rationale |
|---|----------|-----------|
| D16 | **A theme is a CSS attribute selector, not a JavaScript palette.** Each flavour is a `[data-kira-theme='<id>'] { … }` block; `kira-dark` is `:root, [data-kira-theme='kira-dark']` so an unset attribute is the default theme rather than a half-themed document. Switching is one `dataset` write. | Colours belong in the stylesheet with the rules that consume them: a JS palette table would mean 48 `setProperty` calls per switch, a second place for a token name to be misspelled with no CSS tooling to catch it, and a startup cost on every launch for a value that is static. The attribute selector also buys D26's preview tiles for free. |
| D17 | **`applyAppearance()` gains one line — `root.dataset.kiraTheme = settingsState.appearance.theme` — and is the only writer.** It already runs on hydrate, on every `patchSettings`, and on the `onSettingsChanged` broadcast, so all three paths are covered with nothing added. | The three paths already exist and are already the reason `applyAppearance` is called from `applySettings` rather than from the dialog. Adding a second, theme-specific apply function would create a fourth path that the broadcast handler would eventually forget. |
| D18 | **Switching applies live. There is no restart prompt, no reload, and no re-measure.** | F16 is the whole argument: no colour in this app is ever resolved into JS or baked into a computed value. The three places that *do* need to know are all handled without a reload — CodeMirror by a compartment reconfigure (D19), the native chrome by two Electron calls (D20/D21), and the pre-mount window fill by `backgroundColor` (D21). `views/grid/columns.ts` re-measures on `appearanceVersion` (P31 D11), which a theme change deliberately does **not** bump, because column widths depend on the font and nothing else. |
| D19 | **`editor/theme.ts` exports one spec and two `EditorView.theme` instances differing only in `{ dark }`, plus `editorThemeFor(themeId)`. `CodeMirrorHost.vue` gains a fifth Compartment and a fifth `watch`, following the four already there (F22).** | `{ dark: true }` (F21) is the one fact in that file that is not a custom property, and it is not cosmetic: it sets the `cm-dark` class and the `EditorView.darkTheme` facet, which drive CodeMirror's own base-theme fallbacks for everything `kiraEditorTheme` does not name — the unfocused selection halo, panel chrome, the default `::selection`. Under Latte those would stay dark against a light editor. Two instances of one spec is four lines and no duplication of any colour; the compartment is the pattern the file already uses four times, so the diff reads as a fifth of the same thing rather than a new idea. |
| D20 | **Main sets `nativeTheme.themeSource` to `'light'` for Latte and `'dark'` for the other four — never `'system'` — at startup and on every theme patch.** | `titleBarStyle: 'default'` means AppKit draws the title bar (F20), and it follows the OS unless told otherwise; Latte on a dark-mode Mac would put a dark title bar directly above a `#eff1f5` workbench. `themeSource` is per-application, not system-wide, and it correctly carries the choice to the other native surfaces too — the menu bar, the `kira:files` save/open dialogs (P33), and scrollbars. `'system'` is never used because this app never follows the OS: the theme setting is the single source of truth, and letting the OS override half the chrome would reintroduce exactly the incoherence this decision removes. |
| D21 | **`BrowserWindow.backgroundColor` comes from `THEMES[settings.appearance.theme].windowBackground`, and a live theme change calls `win.setBackgroundColor()` on every open window.** `main/index.ts` already computes `settings` before `createWindow` (F19), so this is an argument, not a new read. | `backgroundColor` is what Chromium paints between window creation and first paint; hard-coded `#1F1F1F` (F19) would flash dark on every Latte launch. Combined with F24 — the Vue app does not mount until settings have hydrated, so the attribute is set before any component renders — **there is no frame in the entire startup path that shows the wrong palette**, which is the property that makes D18's "no restart" claim actually true rather than merely tolerable. `setBackgroundColor` on a live change matters for the same reason: it is what a subsequent resize or minimise/restore repaints with. |
| D22 | **`color-scheme` is declared per theme (`dark` for four, `light` for Latte).** | F17: it is declared nowhere today. It governs the four native surfaces the app does not draw itself — the default scrollbar rendering, `<select>` dropdown popups (the settings dialog's page-size control, the grid's page-size control), `input[type=number]` spinners (four settings fields), and `window.confirm`, which is the delete confirmation for both a Redis key and an S3 object (§8.8). Without it those four render dark-on-light under Latte, and a delete confirmation is not a dialog to get wrong. |
| D23 | **The theme is a leaf of the existing `appearance` section, not a new settings section and not a new IPC channel.** | It is an Appearance setting by every definition the dialog already uses, `settingsPatchSchema`'s `appearance.partial()` makes `{ theme }` a valid patch with no schema work, `SettingsDialog`'s Cancel captures it for free (F25), and the whole persistence path — renderer state, IPC, per-leaf write, broadcast — already exists and is already tested (`workbench.spec.ts`). A new channel would be a second way to change a setting for no gain. |

### Topic D — the picker

| # | Decision | Rationale |
|---|----------|-----------|
| D24 | **The picker is a grid of five preview tiles, not a dropdown**, in a new **Theme** group placed **above** Typography in Appearance. Each tile shows the theme's own four-bar swatch (chrome / bg / elevated / accent), its label, and a one-line note; the current theme is marked with the same outline-not-tint treatment `ColorPicker.vue` uses for a selected swatch. | A theme is chosen by looking at it. A `<select>` of five names makes the user commit before seeing anything, and a dropdown of colour names is the control this app already rejected for connection colours (P16's swatch row). Five is exactly the count that fits a tile grid without scrolling. Theme sits above Typography because it is the coarsest appearance decision on the pane — it changes every other control's own rendering. |
| D25 | **There is no separate preview pane and no hover preview. Clicking a tile applies the theme to the whole app immediately**, as every other Appearance control already does; the dialog's footer already says *"changes apply immediately"*, and Cancel reverts (F25). | The app *is* the preview — a 200×120 mock of a grid would be a second, drifting rendering of the same tokens, and the mock could be wrong in a way the real UI is not. Hover-preview was considered and rejected: repainting the entire workbench on pointer-move over five adjacent tiles is a flicker generator, and it would fight P22's own 400 ms hover discipline. |
| D26 | **The tiles' swatches are pure CSS: each tile element carries `data-kira-theme="<its own id>"` and its four bars are `background: var(--kira-bg-chrome)` / `var(--kira-bg)` / `var(--kira-bg-elevated)` / `var(--kira-accent)`.** No palette data reaches the component. | This is the direct payoff of writing the palettes as bare attribute selectors rather than `:root[…]` (D16). A tile scoped to `catppuccin-latte` inside a Mocha app resolves Latte's own variables locally, so the preview cannot disagree with the theme — they are literally the same declarations. The alternative, a `Record<ThemeId, string[]>` of preview hexes in the `.vue` file, would be a fifth copy of the palette and the first thing to go stale. |
| D27 | **The five ids and their labels, fixed here:** `kira-dark` → "Kira Dark" / *"VS Code Dark Modern — the original"*; `catppuccin-latte` → "Catppuccin Latte" / *"Light"*; `catppuccin-frappe` → "Catppuccin Frappé" / *"Dark, warm"*; `catppuccin-macchiato` → "Catppuccin Macchiato" / *"Dark"*; `catppuccin-mocha` → "Catppuccin Mocha" / *"Darkest"*. Ids are ASCII and match upstream's own flavour keys (`frappe`, not `frappé`); the label carries the accent. | The id is a stored value and a CSS attribute selector — a non-ASCII character there is a needless encoding question in three places. The notes exist because "Frappé" and "Macchiato" say nothing about which is darker to someone who has not used them, and the tile's own swatch answers it only approximately at 12px. |
| D28 | **The tiles carry `data-testid="theme-tile-<id>"`, and `<html>`'s `data-kira-theme` is the assertion surface for every test.** | One stable attribute on the root element makes every theme assertion a one-liner, and it is the same value that is persisted, so a test that reads it after relaunch is testing the whole path end to end rather than a UI mirror of it. |

### Topic E — compatibility and failure modes

| # | Decision | Rationale |
|---|----------|-----------|
| D29 | **No migration file, no `schema_version` bump, no `storage/schema/` change.** An existing database has no `appearance.theme` row and resolves to `kira-dark` through the per-leaf fallback that already exists (F23). | The storage layer was built for exactly this and says so in its own comment. Adding `0006_p38_theme.sql` to insert a default row would be a migration whose only effect is to write the value the code already returns — and it would then have to be kept in sync with `DEFAULT_THEME_ID` forever. |
| D30 | **A user's existing settings row is untouched and their app looks identical after the upgrade.** The first thing they can notice is a new **Theme** group in Settings → Appearance. | D1's default plus D29's fallback. Stated as its own decision because "what happens to a user's existing settings row when this ships" is one of the phase's named open questions and the answer — *nothing at all* — deserves to be findable. |
| D31 | **A stored theme id this build does not recognise resets that one leaf to `kira-dark`, logs a warning, and launches.** Implemented in `repos/settings.ts` as a narrow retry: parse strictly; on failure, if and only if `appearance.theme` is the offending leaf, reset it and re-parse once; if that still fails, throw exactly as today. | This is a deliberate, scoped exception to §6's *"a hand-edited or stale-shape row must fail loudly here"* rule, and the reasoning is that the rule's purpose is to stop `undefined`s propagating into the UI — a page size or a memory cap that is wrong will corrupt a query or blow a budget. A theme id is a pure presentation choice with a safe, correct default, and the realistic way to get an unknown one is **downgrading** a build after trying a future theme. Bricking launch over "you once selected a theme this version has never heard of" is a worse failure than a warning in `~/.kira-studio/logs` and a dark window. The narrowing — one leaf, one retry, otherwise unchanged — is what keeps this from becoming a general "swallow settings errors" behaviour. |
| D32 | **`themeIdSchema` stays strict on the write path.** `settingsPatchSchema` gets no `.catch()`, so a patch carrying an unknown id is rejected at the IPC boundary as it should be. | The only writer is a five-option picker; a bad value arriving there is a bug, and masking it would hide the bug in the one place where failing loudly costs nothing. |
| D33 | **`electron-builder.yml`'s `electronLanguages: ['en']` is unchanged**, and `docs/v1/PACKAGING.md`'s justification for it drops the now-inaccurate "dark-mode-only" clause. | The locale trim was never about the theme; the sentence just happened to bundle two v1 constraints. Fixing the sentence rather than the setting. |

### Topic F — the design system

| # | Decision | Rationale |
|---|----------|-----------|
| D34 | **The sixteen `.dc.html` artboards stay drawn in `kira-dark`. What changes is the `System` sheet, which gains a section 01b — *Theme palettes* — showing all five themes' resolved token values as swatch rows, and the `SettingsDialog` body, which gains the picker row.** `parts/_style.css`'s header comment is corrected to say it mirrors the `kira-dark` theme specifically. `node build.mjs` is re-run, so all sixteen files change. | The canvas documents **layout, primitives and laws**, and re-rendering sixteen 1440×900 screens four more times would quadruple the artefact to say nothing new — every screen would be the identical geometry in different greys. But the System sheet is the design system's own colour reference, and a colour reference that shows one of five palettes is out of date the day this ships. The SettingsDialog artboard is the one screen whose *content* genuinely changes. |
| D35 | **`README.md`'s "Decisions worth knowing" gains a **Themes** bullet** stating the D5 governing rule, D2's Latte position and D11's named exception, so the next person to open that folder finds the mapping rule without reading this plan. | That file is where every other cross-cutting design decision in the system is recorded; a five-palette theme family is exactly that shape of decision. |

## 4. Implementation order

Each step is one commit and must leave `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` green. Steps 1–2 are groundwork, 3–6 the feature, 7 the tests, 8 the docs. **Nothing here needs Docker** — step 7's spec never opens a connection — so the whole phase, tests included, is executable in this environment under `xvfb-run`.

1. **`feat(shared): the theme registry and the theme setting`** — `src/shared/theme.ts` (new: `themeIdSchema`, `DEFAULT_THEME_ID`, `ThemeMeta`, `THEMES`, `THEME_IDS` — D3's five rows, with `windowBackground` holding each theme's `--kira-bg-chrome`), and `src/shared/settings.ts` (`appearanceSettingsSchema` gains `theme: themeIdSchema`; `defaultSettings.appearance.theme = DEFAULT_THEME_ID`) (D23, D27, D29). Deliberately **no** migration file and **no** `storage/schema/settings.ts` change — F23 is why, and the commit message says so. Nothing reads the new setting yet; `getAllSettings` already returns it, defaulted, from every existing database.
2. **`refactor(theme): every colour in the renderer comes from a token`** — the audit fixes, applied to the existing dark theme with **zero** visual change except D15's one named scrim. `theme/tokens.css`: the palette becomes `:root, [data-kira-theme='kira-dark']`, gains `color-scheme: dark` and D13's four tokens plus `--kira-scrim`. `theme/primitives.css`: the four hex literals (F10) become those tokens; the seven `rgba()` literals (F11) become `color-mix(in srgb, var(--kira-…) N%, transparent)` at the identical percentages (F12). `shortcuts/CommandPalette.vue`, `views/shared/FilterHistoryMenu.vue`, `views/console/ConsoleSavedMenu.vue` and `theme/primitives/DialogFrame.vue`: their four scrims become `var(--kira-scrim)`. **This is the commit that makes a second palette possible at all**, and its whole value is that the app renders identically afterwards — `xvfb-run -a bun run test:ui` over `smoke`/`startup`/`workbench`/`connections`/`sqlite` is the guard, and none of those specs may need editing.
3. **`feat(theme): the four Catppuccin palettes`** — `theme/catppuccin.css` (new; four `[data-kira-theme='catppuccin-*']` blocks, each setting all 48 colour tokens plus D13's five plus `color-scheme`, per D5–D14's tables and F1's hexes) and one `@import "./catppuccin.css"` in `theme/base.css` after `tokens.css`. Nothing selects them yet — setting the attribute by hand in devtools is the manual check. The Tailwind `@theme` block in `base.css` is **not touched**: its `--color-*` entries are already indirections through `var(--kira-*)` and follow automatically.
4. **`feat(renderer): the theme applies live`** — `state/settings.ts` (`applyAppearance()`'s one new line, D17), `editor/theme.ts` (the spec/two-instances split plus `editorThemeFor`, D19) and `editor/CodeMirrorHost.vue` (the fifth compartment and its `watch`, following the four at `:56-59`/`:141-151`/`:196-220`). After this commit a theme change made through devtools or a direct IPC call repaints everything, editors included.
5. **`feat(main): the native chrome follows the app theme`** — `main/theme.ts` (new: `applyNativeTheme`, D20/D21), `main/window.ts` (`backgroundColor` from the passed theme instead of the literal), `main/index.ts` (pass it; call `applyNativeTheme` once at startup from the `settings` it already reads at `:75`), `main/ipc/settings.ts` (call `applyNativeTheme(merged.appearance.theme)` when `patch.appearance?.theme !== undefined`, beside the existing `patch.cache?.l2BudgetMb` arm).
6. **`feat(renderer): the theme picker in Settings → Appearance`** — `workbench/SettingsDialog.vue`: a **Theme** group above Typography holding five tiles (D24–D28), each `data-kira-theme`-scoped for its own preview (D26) and calling `patchSettings({ appearance: { theme } })` on click. No new primitive — the tile reuses the `.kind`/`.kind-grid` vocabulary the engine picker already establishes, and the selected-outline treatment `ColorPicker.vue` already establishes.
7. **`test(ui): themes switch, persist and cover every token`** — `tests/ui/theme.spec.ts`, §5's twelve scenarios. Runs without Docker.
8. **`docs: SPEC §1/§3/§6/§8.1/§8.2/§9.2/§11 and the P38 row, the design system, the README and PACKAGING`** — §6's list, plus this plan's own commit if it is not already landed.

## 5. Tests

### Existing specs and what must happen to them

| Spec | Why | Change |
|---|---|---|
| `tests/ui/workbench.spec.ts` | Step 1 adds a leaf to `appearance`; step 6 adds a control to the Appearance pane. | **No change.** It is the regression guard for both: its *"a settings patch to one section leaves the other sections untouched (F15, D15)"* scenario must still pass, which proves the per-leaf write still writes one leaf; its font-size-across-relaunch scenario must still pass, which proves the Appearance pane still works with a new group above it. |
| `tests/ui/smoke.spec.ts`, `startup.spec.ts` | Step 2 rewrites fifteen colour declarations; step 5 changes `BrowserWindow.backgroundColor`. | **No change.** They launch the real app and are the cheapest proof that step 2 broke no stylesheet and step 5 broke no window construction. |
| `tests/ui/connections.spec.ts` | Step 2 touches `DialogFrame.vue`'s scrim and step 6 touches the settings dialog beside it. | **No change.** It drives the full connection-dialog path and runs without Docker, so it is provable green in every environment. |
| `tests/ui/cell-editor.spec.ts`, `console.spec.ts`, `autocomplete.spec.ts`, `definition.spec.ts` | Step 4 restructures `editor/theme.ts` and adds a compartment to the shared CodeMirror host. | **No change**, but the four together are the guard that the editor still mounts, highlights, completes and lints. A failure here means the compartment was composed in the wrong order. |
| `tests/ui/tooltips.spec.ts` | Step 2 touches `primitives.css`, which `AppTooltip.vue` renders through. | **No change.** |
| `tests/ui/memory.spec.ts`, `budgets.spec.ts`, `perf.spec.ts` | Four palettes are ~200 extra CSS declarations. | **No source change**, but re-run: neither the RSS budget nor the frame budget may move. CSS custom-property resolution is not per-frame work and the unused palettes match no element, so any movement here is a real regression worth finding. |

### `tests/ui/theme.spec.ts` — the scenario list

Structured like `workbench.spec.ts` (the same `relaunch` fixture, the same "writes go through async IPC so assert on the post-relaunch read" discipline). No Docker.

1. **the default is the old theme** — a fresh `KIRA_HOME` launches with `<html>` carrying no `data-kira-theme`, or `kira-dark`, and `--kira-bg-chrome` computing to `#181818`. *The scenario that guarantees D1/D30 — nobody's app changes appearance on upgrade.*
2. **the picker shows five tiles, in order, with the current one marked** — `theme-tile-kira-dark` … `theme-tile-catppuccin-mocha`, and the Theme group sits **above** the Typography group in the Appearance pane (D24).
3. **picking a theme applies it live** — clicking `theme-tile-catppuccin-mocha` sets `<html data-kira-theme="catppuccin-mocha">` and `--kira-bg` computes to `rgb(30, 30, 46)` **without a reload** (asserted by checking that a `window`-scoped marker set before the click survives it). *The direct test of D18.*
4. **the theme persists across relaunch** — pick Latte, close the dialog, relaunch: `<html>` still carries `catppuccin-latte` and `--kira-bg` is `rgb(239, 241, 245)`.
5. **Cancel reverts the theme** — open Settings on `kira-dark`, pick Mocha (the app repaints), press Cancel: the attribute is back to `kira-dark`, and after a relaunch it is still `kira-dark`. *The test of F25 — that a new appearance leaf rides the existing Cancel baseline.*
6. **a theme patch touches one settings row** — pick Frappé, then relaunch and assert the font size, row density, page size, cache budget and engine memory cap are all unchanged. Mirrors `workbench.spec.ts`'s own D15 scenario for the new leaf.
7. **Latte flips `color-scheme`** — under `catppuccin-latte` the computed `color-scheme` on `:root` is `light`; under every other theme it is `dark` (D22).
8. **the editor follows the theme** — open a definition or console tab, switch to Latte, and assert the CodeMirror root has **lost** `cm-dark`; switch to Mocha and assert it has it back, and that `.cm-content`'s computed colour equals `--kira-fg`. *The test of D19 — the one thing in the editor that is not a custom property.*
9. **the preview tiles render their own palette, not the active one** — while the app is on `kira-dark`, the `catppuccin-latte` tile's chrome bar computes to Latte's `--kira-bg-chrome` (`rgb(230, 233, 239)`), not the active theme's. *The test of D26, and the thing that catches anyone "simplifying" the attribute-scoped tile into a hard-coded swatch.*
10. **the palettes match the published values** — for all five themes, six representative properties (`--kira-bg`, `--kira-fg`, `--kira-accent`, `--kira-error`, `--kira-syntax-keyword`, `--kira-conn-blue`) are read from the live document and compared to a table inlined in the spec from §1's F1. *The test that makes D3's hand-copy safe.*
11. **every theme defines every colour token** — the spec holds the list of the app's colour-token names (the 48 of F14 plus D13's five); for each of the five themes it asserts every one resolves to a non-empty value **and** that no two themes resolve `--kira-bg` to the same string. *The test of §0's totality rule — a partially-defined palette silently inheriting greys from the default is the failure mode this whole phase exists to avoid.*
12. **the TS metadata and the CSS agree** — for each theme, `getComputedStyle(document.documentElement).getPropertyValue('--kira-bg-chrome')` equals `THEMES[id].windowBackground` (both normalised to `rgb()` form). *The test of D21's one acknowledged duplication — the only place a colour exists twice in this phase.*

### What is deliberately not added

No unit tests (§9's standing rule). No screenshot comparison: introducing a visual baseline in the phase that multiplies the app's palettes by five would create five baselines to regenerate on every future UI change, for a property — "the colours are the published ones" — that scenario 10 asserts directly and far more legibly. No contrast assertion in code: F27–F30's numbers are recorded in this document and in the CSS comments, and asserting them at runtime would encode Catppuccin's own published values as this app's requirements, which D2's "verbatim, or not at all" rule forbids.

## 6. Explicitly out of scope

- **Following the macOS appearance.** No `prefers-color-scheme`, no `nativeTheme.themeSource = 'system'`, no "Auto" option in the picker, no switching at sunset. This is precisely what SPEC §1's deferral now means (D2), and it is a real feature: it needs a sixth picker entry, a `nativeTheme.on('updated')` listener, a rule for which dark flavour "auto-dark" resolves to, and a decision about whether the *stored* setting is the flavour or the pair.
- **Configurable accents.** Upstream's `options.accent` (F5) lets a Catppuccin user pick any of the fourteen accents as the theme's accent; this phase ships mauve, upstream's default, in all four flavours. Making it configurable means a second setting, a second picker and a `--kira-accent`/`--kira-focus`/`--kira-select` triple that is no longer a static CSS value.
- **Re-tuning Latte's accents for contrast.** F27 measures them at 2.31–4.80 against `base` and D2 keeps them verbatim. Deviating would ship something called Latte that is not Latte. If Kira ever wants an accessible light theme, that is its own theme with its own name, not a quiet edit to someone else's palette.
- **Widening the syntax token set.** D8 freezes `kiraHighlightStyle`'s tag grouping, which means `true`/`false`/`null`, type names and atoms all render as keywords (mauve) rather than Catppuccin's peach/yellow/red. Splitting `--kira-syntax-keyword` into keyword/constant/type is a genuine improvement to **all five** themes and belongs in a phase that can measure its effect on the default theme, not one where a rendering change to `kira-dark` is indistinguishable from a bug.
- **Upstream's other workbench options** — `workbenchMode: flat | minimal`, `bracketMode`, `extraBordersEnabled`, `italicComments`/`boldKeywords`, `customUIColors`, `colorOverrides` (F5). All real, all VS Code-shaped, none of them a database client's concern.
- **The other Catppuccin ports' conventions** — the terminal ANSI palette (F3's `color0`–`color17` rows), the icon pack sync, the bracket-pair rainbow. This app has no terminal, no file icons and no bracket-pair colourisation.
- **Per-connection or per-tab themes.** A tab is already tinted by its connection colour (§8.4) and that is the app's answer to "which connection am I looking at"; a second, coarser identity signal would fight it.
- **A user-authored theme format.** Five built-in themes, no JSON loader, no theme directory, no import. That is a distribution and validation problem (a theme file is untrusted input that reaches CSS), not a token-mapping one.
- **Re-rendering the design canvas in four more palettes** (D34) — sixteen artboards × four flavours to say nothing the System sheet's new palette section does not say in one screen.
- **Any change to `src/engine`, `src/shared/protocol`, any adapter, any view module's logic, any page kind or any Zod page schema** (D4). §7 enumerates every file this phase touches.

## 7. Target tree at the end of P38

```
src/shared/
  theme.ts                        NEW  themeIdSchema, DEFAULT_THEME_ID, THEMES (label/note/
                                       isDark/windowBackground), THEME_IDS (D3, D27)
  settings.ts                     MOD  appearance.theme + its default — no migration (D23, D29)
src/main/
  theme.ts                        NEW  applyNativeTheme(): nativeTheme.themeSource + every open
                                       window's setBackgroundColor (D20, D21)
  index.ts                        MOD  applyNativeTheme() at startup from the settings it
                                       already reads; pass the theme into createWindow
  window.ts                       MOD  backgroundColor from THEMES[...].windowBackground (D21)
  ipc/settings.ts                 MOD  + the theme arm beside the existing cache arm (D20)
  storage/migrations/              --  UNCHANGED — no migration; the per-leaf fallback is the
                                       whole mechanism (F23, D29)
  storage/schema/settings.ts       --  UNCHANGED — the table is already (key, value)
  storage/repos/settings.ts       MOD  D31's narrow one-leaf reset on an unknown theme id
src/renderer/
  theme/tokens.css                MOD  :root, [data-kira-theme='kira-dark'] + color-scheme +
                                       --kira-badge-fg / --kira-strip-{err,warn,note}-fg /
                                       --kira-scrim (D13, D15, D16)
  theme/catppuccin.css            NEW  the four flavours, ~200 declarations, D5-D14's mapping
                                       over F1's verified hexes
  theme/base.css                  MOD  one @import; the @theme block untouched (indirections)
  theme/primitives.css            MOD  4 hex + 7 rgba literals -> tokens / color-mix (D15)
  theme/connColor.ts               --  UNCHANGED — it returns var(--kira-conn-X), never a
                                       resolved colour, so D11 reaches every rail for free (F26)
  editor/theme.ts                 MOD  one spec, two EditorView.theme instances, editorThemeFor
                                       (D19) — every colour declaration unmoved
  editor/CodeMirrorHost.vue       MOD  a fifth Compartment + watch, matching the four at :56-59
  state/settings.ts               MOD  applyAppearance() sets dataset.kiraTheme (D17)
  workbench/SettingsDialog.vue    MOD  the Theme group and its five self-scoped tiles (D24-D28)
  shortcuts/CommandPalette.vue    MOD  scrim -> var(--kira-scrim); 0.3 -> 0.5 (D15, the one
                                       acknowledged pixel change to the existing dark theme)
  views/shared/FilterHistoryMenu.vue   MOD  scrim -> var(--kira-scrim)
  views/console/ConsoleSavedMenu.vue   MOD  scrim -> var(--kira-scrim)
  theme/primitives/DialogFrame.vue     MOD  scrim -> var(--kira-scrim)
  views/grid/columns.ts            --  UNCHANGED — it measures the font, never a colour (F16)
  project/ColorPicker.vue          --  UNCHANGED — the swatches are var(--kira-conn-*) already
  main.ts                          --  UNCHANGED — bootstrap() already awaits hydrateSettings()
                                       before createApp, which is what makes D18 flash-free (F24)
tests/
  ui/theme.spec.ts                NEW  §5's twelve scenarios; no Docker
  ui/workbench.spec.ts             --  UNCHANGED — the per-leaf-write and Appearance guards
  ui/{smoke,startup,connections,cell-editor,console,autocomplete,definition,tooltips}.spec.ts
                                   --  UNCHANGED — the step-2 and step-4 regression guards
  ui/{memory,budgets,perf}.spec.ts --  UNCHANGED, re-run; no budget may move
docs/
  v1/SPEC.md                      MOD  §1, §3, §6, §8.1, §8.2, §9.2, §10's P38 row, §11
  v1/PACKAGING.md                 MOD  the electronLanguages justification drops "dark-mode-only"
  v1/design/kira-design-system/
    parts/_style.css              MOD  header comment: mirrors the kira-dark theme (D34)
    parts/bodies/System.html      MOD  + section 01b, Theme palettes (D34)
    parts/bodies/SettingsDialog.html  MOD  + the Theme picker row (D34)
    README.md                     MOD  + the Themes bullet in "Decisions worth knowing" (D35)
    *.dc.html                     MOD  all 16, regenerated by `node build.mjs` (D34)
  v1/plans/P38-catppuccin-themes.md  NEW  this document
README.md                         MOD  the "Dark mode only" status line + the Settings bullet
package.json                       --  UNCHANGED — no dependency, dev or otherwise (D3)
```

## 8. Acceptance checklist

**The dependency that isn't**

- [ ] `git diff package.json bun.lock` is empty.
- [ ] `grep -rn "catppuccin" src/ --include=*.ts --include=*.vue` matches only `shared/theme.ts`'s five ids and the settings dialog's tile keys — every hex lives in CSS.

**The audit closed**

- [ ] `grep -rnE '#[0-9a-fA-F]{3,8}\b' src/renderer --include=*.vue --include=*.ts` matches nothing, and in `--include=*.css` matches only `theme/tokens.css` and `theme/catppuccin.css`.
- [ ] `grep -rnE 'rgba?\(|hsla?\(' src/renderer` matches only those two theme files.
- [ ] Every colour token the app reads (F14's 48 plus D13's five) is set by all five themes — scenario 11.

**The dark theme did not move**

- [ ] After step 2, `xvfb-run -a bun run test:ui` over `smoke`, `startup`, `workbench`, `connections` and `sqlite` is green with **no spec edited**.
- [ ] `--kira-badge-fg`, `--kira-strip-err-fg`, `--kira-strip-warn-fg` and `--kira-strip-note-fg` compute to `#f0f0f0`, `#f3a3a3`, `#d9c47a`, `#a8c8ee` under `kira-dark`.
- [ ] The four chip backgrounds and three strip backgrounds compute to the identical `rgba()` values they had before step 2.
- [ ] The single deliberate exception — `CommandPalette.vue`'s scrim, 0.3 → 0.5 — is named in step 2's commit message and nowhere else in the diff.

**The palettes**

- [ ] All six sampled properties in all five themes match §1's F1 table — scenario 10.
- [ ] Mocha: `--kira-bg-chrome` `#11111b`, `--kira-bg` `#1e1e2e`, `--kira-bg-elevated` `#181825`, `--kira-bg-input` `#313244`, `--kira-border` `#313244`, `--kira-border-strong` `#45475a`, `--kira-badge` `#585b70`, `--kira-fg` `#cdd6f4`, `--kira-fg-muted` `#a6adc8`, `--kira-fg-disabled` `#7f849c`, `--kira-accent` `#cba6f7`, `--kira-accent-fg` `#11111b`.
- [ ] Latte: the same twelve resolve to `#dce0e8` / `#eff1f5` / `#e6e9ef` / `#ccd0da` / `#ccd0da` / `#bcc0cc` / `#acb0be` / `#4c4f69` / `#6c6f85` / `#8c8fa1` / `#8839ef` / `#eff1f5` — note `--kira-accent-fg` is Latte's `base`, not `crust` (D12).
- [ ] `--kira-conn-olive` resolves to a distinct colour from `--kira-conn-green` and `--kira-conn-amber` in every theme (D11).
- [ ] An existing connection coloured `teal` renders teal in all five themes with **no** row in `connections` rewritten.

**The mechanism**

- [ ] Switching from Mocha to Latte and back repaints the workbench, the tree, the grid, every open editor and the settings dialog itself, with **no reload** — scenario 3.
- [ ] Under Latte the CodeMirror root has no `cm-dark` class; under the other four it does — scenario 8.
- [ ] Under Latte `:root`'s `color-scheme` is `light`, and the settings dialog's `<select>` popup, the number-field spinners and a Redis key's `window.confirm` all render light.
- [ ] Launching on Latte shows **no dark frame at any point** — `BrowserWindow.backgroundColor` is Latte's chrome colour and the Vue app mounts only after settings hydrate.
- [ ] On macOS, selecting Latte turns the native title bar and menu bar light, and selecting any other theme turns them dark, without restarting.
- [ ] `THEMES[id].windowBackground` equals the CSS `--kira-bg-chrome` for all five — scenario 12.

**The picker and persistence**

- [ ] The Theme group is the **first** group in Settings → Appearance and holds five tiles in `THEME_IDS` order.
- [ ] Each tile previews its own palette while the app is on a different one — scenario 9.
- [ ] The selection survives relaunch; Cancel reverts it; and patching it leaves every other settings leaf untouched — scenarios 4, 5, 6.
- [ ] A database with no `appearance.theme` row launches on `kira-dark` with no migration run and no `schema_version` change — scenario 1.
- [ ] A database whose `appearance.theme` row holds `"catppuccin-espresso"` launches on `kira-dark`, writes one warning to `~/.kira-studio/logs`, and leaves every other setting intact (D31).

**Overall**

- [ ] `bun run lint`, `bun run typecheck` (all three projects) and `bun run build` clean on every commit.
- [ ] `xvfb-run -a bun run test:ui` — the whole non-Docker set, including the new `theme` spec, green in this environment. **This phase has no verify-on-container list.**
- [ ] `tests/ui/memory.spec.ts`, `budgets.spec.ts` and `perf.spec.ts` re-run with no budget moved.
- [ ] `node docs/v1/design/kira-design-system/build.mjs` runs clean and the sixteen artboards are regenerated.
- [ ] SPEC §1, §3, §6, §8.1, §8.2, §9.2, §10's P38 row and §11, plus `PACKAGING.md`, the design system's `README.md` and the repository `README.md`, all describe what shipped.

### The documentation commit, in detail

This is the last phase in §10's table, so the docs commit is also the point at which the phasing table stops having a "queued" row. Step 8 edits:

- **SPEC §1** — the scope paragraph's *"macOS only. Dark mode only."* becomes *"macOS only. Dark by default, with five selectable themes — the app's own VS Code Dark Modern set plus Catppuccin Latte/Frappé/Macchiato/Mocha (P38); Latte is the one light palette in v1."* The **Explicitly deferred** list's bare *"light mode"* becomes *"automatic light/dark switching that follows the macOS appearance (there is no `prefers-color-scheme` support and no 'Auto' theme; the theme setting is the only source of truth)"*. This is D2, and it is the sentence that must not be left ambiguous.
- **SPEC §3** — the Styling row's *"tokens mirror VS Code Dark Modern"* becomes *"tokens mirror VS Code Dark Modern; four Catppuccin palettes re-map the same token names (P38)"*.
- **SPEC §6** — the `settings(key, value)` comment's *"fonts, sizes, budgets, toggles"* gains *"theme"*, with the one-clause note that P38 needed no migration because the table is per-leaf key/value.
- **SPEC §8.1** — the paragraph beginning *"Theme is a single dark token set derived from VS Code Dark Modern"* is rewritten: five selectable themes over one token set, the D5 governing rule in one sentence, live switching, and the note that the chrome *layout* (rounded/floating panels, the radius tiers, the window inset) is theme-independent.
- **SPEC §8.2** — the Appearance bullet gains **Theme** as its first item, naming the five, the tile picker, live application and the `kira-dark` default.
- **SPEC §9.2** — the Playwright coverage list gains theme switching, persistence, the palette-value check and the every-theme-defines-every-token check.
- **SPEC §10** — the **P38** row's deliverable is rewritten from the queued placeholder to what shipped, and its "Why here" column replaces the open question with its answer: the token set mapped cleanly because it was named after VS Code colour IDs, which Catppuccin's own VS Code port publishes values for; the exceptions were five surface-elevation inversions, two source disagreements and one hue (olive) Catppuccin has no accent at; Latte shipped and §1 was revised to defer OS-appearance-following rather than light palettes.
- **SPEC §11** — `renderer/theme/`'s one-line description (*"tokens, codicons"*) names `tokens.css` (the default `kira-dark` palette), `catppuccin.css` (the four flavours) and `connColor.ts`, and `shared/` gains a `theme.ts` line.
- **`docs/v1/PACKAGING.md:52`** — the `electronLanguages` justification drops *"dark-mode-only"* and keeps *"English-only v1"* (D33).
- **`docs/v1/design/kira-design-system/`** — `parts/_style.css`'s header, `parts/bodies/System.html`'s new section 01b, `parts/bodies/SettingsDialog.html`'s picker row, `README.md`'s Themes bullet, and all sixteen regenerated `.dc.html` files (D34/D35).
- **`README.md`** — line 12's *"Dark mode only"* becomes *"Five themes — Kira Dark plus Catppuccin Latte/Frappé/Macchiato/Mocha; no automatic OS-appearance switching"*, and the Settings bullet's Appearance list gains *theme*.
- **`AGENTS.md`** — **unchanged**. It is process and environment only, and this phase adds no environment step: no container, no driver, no credential, nothing that needs a per-engine section.

## 9. Open questions for the user

The implementing session proceeds on each stated default; none of these blocks a commit.

1. **Should `kira-dark` stay the default, or should a Catppuccin flavour become it?** D1 keeps `kira-dark`, so no existing install changes appearance on upgrade and every screenshot, plan and design artboard stays accurate. The counter-argument is that a user who installs Kira for the first time after this ships gets the theme nobody chose over the four that were curated. One line in `shared/theme.ts` either way — but changing it after release is a visible, unrequested re-skin, so it is cheapest to decide now.
2. **Is `mauve` the right accent, or should it be per-flavour?** D5/F5 take upstream's default, mauve, for all four. It is what a Catppuccin user expects, and it keeps `--kira-accent`/`--kira-focus`/`--kira-select` static CSS. The counter-argument is that Kira's own accent has always been `#0078d4` blue, and a user switching from `kira-dark` to Mocha finds every primary button turn purple. Mapping the accent to each flavour's **blue** instead would preserve the app's identity at the cost of not looking like Catppuccin.
3. **Should the four dark-flavour connection swatches follow Catppuccin's accents (D11) or stay the app's own `oklch(0.72 0.09 h)` set in all five themes?** D11 follows Catppuccin, at the stated cost of the equal-lightness law inside those themes. The counter-argument is that connection colour is a *labelling* system, not part of any theme's identity, and a user's mental map of "the red one is prod" is better served by twelve colours that never move. Latte forces the question either way — the existing pastels are too light for its base — so the fallback position would be "the existing set for all four dark themes, a darker re-derivation for Latte only."
4. **Should `--kira-warn` be yellow (D10, style guide) or peach (the VS Code port's `editorWarning`)?** D10 picks yellow, because in this app that token is UI, not editor, and peach collides with `--kira-conn-orange`'s source. If Catppuccin-port fidelity matters more than that collision, it is one line per flavour.
5. **Is `--kira-syntax-function` → yellow the right call, or should functions be blue and JSON keys teal?** D7 gives property→blue and function→yellow, on the grounds that JSON is this app's dominant syntax surface and that yellow preserves Dark Modern's function cue. The port's own primary rule is function→blue, object-property→teal. Two lines per flavour, and the difference is visible in every console and every cell editor.
6. **Should Latte's own low-contrast syntax accents be shipped verbatim (D2/§6) or darkened?** Verbatim is this plan's position and the reason is stated: a Latte with edited accents is not Latte. The measured numbers are in F27 so the choice is informed. If accessibility outranks fidelity here, the honest form is a **sixth** theme with its own name, not a quiet edit to Latte's.
7. **Should the picker offer an "Auto — follow macOS" entry?** Not proposed (§6): it needs a sixth entry, a `nativeTheme.on('updated')` listener, a rule for which dark flavour auto-dark resolves to, and a decision about whether the stored value is a flavour or a pair. It is the single most likely follow-up request, and it is a small phase rather than a branch of this one.
8. **Should a theme's own font default travel with it?** Not proposed. `appearance.fontFamily` is independent of `appearance.theme` and stays so — but Catppuccin users frequently pair a flavour with a particular face, and "Theme sets a suggested font unless you have overridden it" is a real product idea with a real ambiguity (what counts as "overridden") that deserves its own decision rather than being smuggled in here.

---

### Critical Files for Implementation

- `/home/user/kira-studio/src/renderer/theme/tokens.css` — the 48 colour tokens this phase re-maps; becomes `:root, [data-kira-theme='kira-dark']` and gains D13's five new tokens.
- `/home/user/kira-studio/src/renderer/theme/primitives.css` — holds all four hard-coded hexes (`:382`, `:621`, `:625`, `:629`) and seven of the eleven `rgba()` literals (`:399`, `:403`, `:407`, `:411`, `:620`, `:624`, `:628`); step 2's main subject.
- `/home/user/kira-studio/src/renderer/editor/theme.ts` — already fully custom-property-driven; its only non-token fact is `{ dark: true }` at line 106, which D19 splits into two instances.
- `/home/user/kira-studio/src/renderer/state/settings.ts` — `applyAppearance()` is the single apply path all three settings routes funnel through; the theme switch is one line here.
- `/home/user/kira-studio/src/main/storage/repos/settings.ts` — the per-leaf `sectionFromStore` fallback is why no migration is needed, and the `settingsSchema.parse(candidate)` call is where D31's one-leaf reset goes.
- `/home/user/kira-studio/src/renderer/workbench/SettingsDialog.vue` — the Appearance pane (template lines 149–232) and the `initialSettings`/`onCancel` baseline that already covers a new appearance leaf.
</content>
