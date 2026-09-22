import type { MonacoModule } from './monaco';
import { cssVar, KIRA_EDITOR_THEME } from './monaco';

// P60a §4.1: `theme.ts`'s 283 CodeMirror lines split three ways. This file carries the first two —
// editor chrome colours and token colours — as one Monaco `defineTheme` call. The third
// (app-owned `.cm-kira-*` classes) becomes plain scoped CSS on `MonacoHost.vue` itself, renamed
// `.kira-ed-*`.

// §4.1 token-colour table — Lezer tag group -> Monarch scope, both keyed by the same
// `--kira-syntax-*` custom property `theme.ts`'s `kiraHighlightStyle` already reads.
function tokenRules(): { token: string; foreground: string }[] {
  const comment = cssVar('--kira-syntax-comment', '#6a9955');
  const string = cssVar('--kira-syntax-string', '#ce9178');
  const number = cssVar('--kira-syntax-number', '#b5cea8');
  const keyword = cssVar('--kira-syntax-keyword', '#569cd6');
  const control = cssVar('--kira-syntax-control', '#c586c0');
  const property = cssVar('--kira-syntax-property', '#9cdcfe');
  const name = cssVar('--kira-syntax-name', '#9cdcfe');
  const fn = cssVar('--kira-syntax-function', '#dcdcaa');
  const tag = cssVar('--kira-syntax-tag', '#569cd6');
  const attribute = cssVar('--kira-syntax-attribute', '#9cdcfe');
  const operator = cssVar('--kira-syntax-operator', '#d4d4d4');
  const punctuation = cssVar('--kira-syntax-punctuation', '#d4d4d4');
  const meta = cssVar('--kira-syntax-meta', '#569cd6');
  const invalid = cssVar('--kira-syntax-invalid', '#f44747');

  // `foreground` strips a leading '#' — Monaco's `editor.IStandaloneThemeData['rules']` wants the
  // bare hex, unlike `colors` below which wants the full `#RRGGBB` string.
  const bare = (hex: string): string => hex.replace(/^#/, '');

  return [
    { token: 'comment', foreground: bare(comment) },
    { token: 'string', foreground: bare(string) },
    { token: 'string.sql', foreground: bare(string) },
    { token: 'string.escape', foreground: bare(string) },
    { token: 'number', foreground: bare(number) },
    { token: 'keyword', foreground: bare(keyword) },
    // D4 checked and declined a separate `type.identifier` row (TS/JS emit it for any `[A-Z]…`
    // identifier): `ThemeTrieElement.match` (tokenization.js) walks the dotted scope by segment and
    // falls back to the nearest registered ancestor, so `type.identifier` already resolves to this
    // `type` rule with no extra entry needed.
    { token: 'type', foreground: bare(keyword) },
    { token: 'constant', foreground: bare(keyword) },
    { token: 'keyword.control', foreground: bare(control) },
    { token: 'variable.name', foreground: bare(property) },
    // Not dead: `ini.js` (`key=value`), `less.js`, `lua.js`, `julia.js`, `scala.js`, `abap.js` and
    // `clojure.js` all still emit a bare `key` token — several only reachable since D3 registered
    // their grammars at all (verified with a grep across every `languages/definitions/*/*.js`).
    { token: 'key', foreground: bare(property) },
    // D1/D4: Monaco's own JSON tokenizer (`languages/features/json/tokenization.js`) emits
    // `string.key.json` for an object key and `string.value.json` for a string value — distinct
    // scopes so a package.json's keys and values no longer share one color. `string.value` is
    // explicit (not left to inherit `string`'s own rule) so it can never accidentally pick up
    // `string.key`'s color if the trie shape ever changes upstream.
    { token: 'string.key', foreground: bare(property) },
    { token: 'string.value', foreground: bare(string) },
    // D2: the decorator/annotation token `withDecorators` (monarch/decorators.ts) prepends for
    // TypeScript/JavaScript — also what Java's own grammar already emits for `@Override`, which
    // had no rule before this and fell back to plain `editor.foreground`.
    { token: 'annotation', foreground: bare(fn) },
    { token: 'attribute.name', foreground: bare(attribute) },
    { token: 'identifier', foreground: bare(name) },
    { token: 'variable', foreground: bare(name) },
    { token: 'entity.name.function', foreground: bare(fn) },
    { token: 'predefined', foreground: bare(fn) },
    { token: 'tag', foreground: bare(tag) },
    { token: 'operator', foreground: bare(operator) },
    { token: 'delimiter', foreground: bare(punctuation) },
    { token: 'delimiter.parenthesis', foreground: bare(punctuation) },
    { token: 'delimiter.bracket', foreground: bare(punctuation) },
    { token: 'metatag', foreground: bare(meta) },
    { token: 'invalid', foreground: bare(invalid) },
  ];
}

/** Defines `KIRA_EDITOR_THEME` — every editor surface in the app (repo view/diff, and every
 *  `MonacoHost.vue` mount) applies this one theme. Idempotent: `defineTheme` under the same name
 *  simply redefines it, safe to call once per `loadMonaco()` resolution. */
export function defineKiraTheme(mod: MonacoModule): void {
  mod.editor.defineTheme(KIRA_EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: tokenRules(),
    colors: {
      'editor.background': cssVar('--kira-bg', '#1f1f1f'),
      'editor.foreground': cssVar('--kira-fg', '#cccccc'),
      'editorWidget.background': cssVar('--kira-bg-elevated', '#202020'),
      'editorWidget.border': cssVar('--kira-border-strong', '#313131'),
      'editor.selectionBackground': cssVar('--kira-select', '#04395e'),
      'editor.lineHighlightBackground': cssVar('--kira-hover', '#2a2d2e'),
      'editorLineNumber.foreground': cssVar('--kira-fg-muted', '#9d9d9d'),
      'editorCursor.foreground': cssVar('--kira-fg', '#cccccc'),
      'editorGutter.background': cssVar('--kira-bg', '#1f1f1f'),
      focusBorder: cssVar('--kira-focus', '#0078d4'),
      // §4.5: the themed wavy underline replacing CodeMirror's hard-coded raster squiggle.
      'editorError.foreground': cssVar('--kira-error', '#f14c4c'),
      'editorWarning.foreground': cssVar('--kira-warn', '#cca700'),
      // §4.4: `.cm-tooltip-lint`'s chrome, reused for Monaco's own hover widget.
      'editorHoverWidget.background': cssVar('--kira-bg-elevated', '#202020'),
      'editorHoverWidget.border': cssVar('--kira-border-strong', '#313131'),
      // §4.8: the completion popup's chrome — primitives.css's own floating-panel tokens.
      'editorSuggestWidget.background': cssVar('--kira-bg-elevated', '#202020'),
      'editorSuggestWidget.border': cssVar('--kira-border-strong', '#313131'),
      'editorSuggestWidget.selectedBackground': cssVar('--kira-select', '#04395e'),
      'editorSuggestWidget.highlightForeground': cssVar('--kira-syntax-function', '#dcdcaa'),

      // D6 (P67c §3.2): the ~16 keys above cover the editor surface itself; the context menu, the
      // rest of the suggest widget, the find/peek widgets and every reparented list read from a
      // ~40-key set `base: 'vs-dark'` otherwise answers with its own hardcoded literals (e.g. the
      // menu's `#3C3C3C` against this app's `--kira-bg-elevated` `#202020`) — visibly a different
      // palette. Every key below was read out of the Monaco stylesheet or default-style object that
      // actually consumes it (`base/browser/ui/menu/menu.js`'s `getMenuWidgetCSS`,
      // `editor/contrib/suggest/browser/media/suggest.css`, `platform/theme/common/colors/
      // listColors.js`), mapped from an existing `--kira-*` token — no new token, no new literal.
      'menu.background': cssVar('--kira-bg-elevated', '#202020'),
      'menu.foreground': cssVar('--kira-fg', '#cccccc'),
      'menu.selectionBackground': cssVar('--kira-hover', '#2a2d2e'),
      'menu.selectionForeground': cssVar('--kira-fg', '#cccccc'),
      'menu.separatorBackground': cssVar('--kira-border', '#2b2b2b'),
      'menu.border': cssVar('--kira-border-strong', '#313131'),

      'editorSuggestWidget.foreground': cssVar('--kira-fg', '#cccccc'),
      'editorSuggestWidget.selectedForeground': cssVar('--kira-fg', '#cccccc'),
      'editorSuggestWidget.focusHighlightForeground': cssVar('--kira-syntax-function', '#dcdcaa'),
      'editorSuggestWidget.selectedIconForeground': cssVar('--kira-fg-muted', '#9d9d9d'),
      'editorSuggestWidgetStatus.foreground': cssVar('--kira-fg-muted', '#9d9d9d'),

      'list.hoverBackground': cssVar('--kira-hover', '#2a2d2e'),
      'list.hoverForeground': cssVar('--kira-fg', '#cccccc'),
      'list.activeSelectionBackground': cssVar('--kira-select', '#04395e'),
      'list.activeSelectionForeground': cssVar('--kira-accent-fg', '#ffffff'),
      'list.focusBackground': cssVar('--kira-select', '#04395e'),
      'list.focusOutline': cssVar('--kira-focus', '#0078d4'),
      'list.highlightForeground': cssVar('--kira-syntax-function', '#dcdcaa'),

      'dropdown.background': cssVar('--kira-bg-input', '#313131'),
      'dropdown.foreground': cssVar('--kira-fg', '#cccccc'),
      'dropdown.border': cssVar('--kira-border', '#2b2b2b'),

      'input.background': cssVar('--kira-bg-input', '#313131'),
      'input.foreground': cssVar('--kira-fg', '#cccccc'),
      'input.border': cssVar('--kira-border', '#2b2b2b'),

      'editorWidget.foreground': cssVar('--kira-fg', '#cccccc'),
      'widget.border': cssVar('--kira-border-strong', '#313131'),
      // No plain-colour shadow token exists in the palette — `--kira-shadow`/`--kira-shadow-dialog`
      // are full `box-shadow` shorthands (`0 2px 8px rgb(0 0 0 / 0.32)`), not a `<color>`, so they
      // cannot feed `Color.fromHex` the way this key needs. `--kira-border-strong` (the existing
      // elevated-surface boundary colour) stands in rather than inventing a new literal.
      'widget.shadow': cssVar('--kira-border-strong', '#313131'),

      // `--kira-scrollbar` is `#79797966` — 40% alpha — so `cssVar` normalizes it through the
      // rgba()-to-#RRGGBBAA branch in `monaco.ts`'s `normalizeColor`; without that branch this would
      // silently paint the scrollbar thumb bright red (`Color.fromHex`'s own failure mode).
      'scrollbarSlider.background': cssVar('--kira-scrollbar', '#79797966'),
      'scrollbarSlider.hoverBackground': cssVar('--kira-scrollbar', '#79797966'),
      'scrollbarSlider.activeBackground': cssVar('--kira-scrollbar', '#79797966'),

      'peekViewEditor.background': cssVar('--kira-bg', '#1f1f1f'),
      'peekViewResult.background': cssVar('--kira-bg-elevated', '#202020'),
      'peekViewTitle.background': cssVar('--kira-bg-chrome', '#181818'),

      // `--kira-search-match` is a translucent `color-mix(… transparent)` token — same alpha branch
      // as the scrollbar above. `--kira-search-match-current` resolves to an opaque `--kira-warn`
      // and needs no conversion, but is routed through the same `cssVar` call for consistency.
      'editor.findMatchBackground': cssVar('--kira-search-match-current', '#cca700'),
      'editor.findMatchHighlightBackground': cssVar('--kira-search-match', '#cca70040'),

      'textLink.foreground': cssVar('--kira-info', '#3794ff'),
      'textLink.activeForeground': cssVar('--kira-info', '#3794ff'),
    },
  });
}
