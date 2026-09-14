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
    { token: 'type', foreground: bare(keyword) },
    { token: 'constant', foreground: bare(keyword) },
    { token: 'keyword.control', foreground: bare(control) },
    { token: 'variable.name', foreground: bare(property) },
    { token: 'key', foreground: bare(property) },
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
    },
  });
}
