import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Dark Modern's own chrome tokens, plus { dark: true } so anything this theme does not name
// (e.g. the default selection halo) still falls back to CodeMirror's built-in dark defaults.
export const kiraEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--kira-bg)',
      color: 'var(--kira-fg)',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'var(--kira-font-data)',
      fontSize: 'var(--kira-font-size)',
      lineHeight: '1.5',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '8px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--kira-bg)',
      color: 'var(--kira-fg-disabled)',
      border: 'none',
      borderRight: 'var(--kira-border-width) solid var(--kira-border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--kira-select)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--kira-select)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--kira-fg)',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: 'var(--kira-scrollbar)',
    },
    // P18 D12: every other CodeMirror surface in the app is themed from these tokens — an
    // unthemed, library-default completion popup would be the only piece of un-themed chrome in
    // the editor, and would ignore the Settings font entirely. Reuses primitives.css's own
    // `.p-float` values (background/border/radius/shadow) so the popup matches every other
    // floating panel in the app, not just other CodeMirror chrome.
    //
    // P22 D8: the five rules below (through .cm-completionIcon-class) mirror primitives.css's
    // `.p-completion*` classes onto CodeMirror's own tooltip DOM — CodeMirror draws its own
    // <ul>/<li> with no seam to hand it a Vue component (F14), so this is the same specification
    // expressed a second time rather than shared. Change one, change the other.
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--kira-bg-elevated)',
      border: 'var(--kira-border-width) solid var(--kira-border-strong)',
      borderRadius: 'var(--kira-radius)',
      boxShadow: 'var(--kira-shadow-dialog)',
      overflow: 'hidden',
    },
    // The library's own size caps/scrolling/padding live on the inner `ul`, not the outer tooltip
    // div above (which carries no sizing of its own) — matching `.p-completion`'s values here,
    // where they actually take effect, rather than on the div its properties are conceptually
    // listed against in primitives.css's own comment.
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--kira-font-data)',
      fontSize: 'var(--kira-t-sm)',
      padding: 'var(--kira-s-1)',
      minWidth: '200px',
      maxWidth: 'min(480px, 90vw)',
      maxHeight: '240px',
      overflowY: 'auto',
    },
    // The library's own default (`.cm-tooltip.cm-tooltip-autocomplete > ul > li`, style-mod's
    // nested-selector form) carries the same specificity as this — matched here rather than
    // exceeded, so this still wins on declaration order without an !important escape hatch.
    '.cm-tooltip.cm-tooltip-autocomplete ul li': {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--kira-s-2)',
      padding: 'var(--kira-s-2) var(--kira-s-3)',
      borderRadius: 'var(--kira-radius-sm)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--kira-select)',
      color: 'var(--kira-fg)',
    },
    // Unstyled, CodeMirror falls back to its own default glyphs (ƒ, ○, 𝑥, 🔑 …) regardless of
    // theme (F13) — sized/coloured to match the plain popup's own `sugg-icon` (13px codicon,
    // --kira-fg-muted), with a per-type glyph override below for every `type` this app's own
    // completion sources actually set (views/console/completion.ts, sqlLanguageService.ts).
    '.cm-completionIcon': {
      fontFamily: 'codicon',
      fontSize: '13px',
      color: 'var(--kira-fg-muted)',
      width: '16px',
      textAlign: 'center',
      paddingRight: '0',
      opacity: '1',
      boxSizing: 'content-box',
    },
    // Codepoints confirmed against the installed @vscode/codicons version's own codicon.css
    // (symbol-variable/-method/-function/-class/-keyword), not from memory — primitives.css's own
    // disclosure marker states the same rule. method and function share one glyph in the codicon
    // set itself (both \ea8c), matching this library's own default ƒ-for-both convention.
    '.cm-completionIcon-variable:after': { content: '"\\ea88"' },
    '.cm-completionIcon-method:after': { content: '"\\ea8c"' },
    '.cm-completionIcon-function:after': { content: '"\\ea8c"' },
    '.cm-completionIcon-class:after': { content: '"\\eb5b"' },
    '.cm-completionIcon-keyword:after': { content: '"\\eb62"' },
    '.cm-completionDetail': {
      color: 'var(--kira-fg-muted)',
      fontStyle: 'normal',
      marginLeft: 'auto',
      paddingLeft: 'var(--kira-s-3)',
    },
    '.cm-completionMatchedText': {
      color: 'var(--kira-syntax-function)',
      textDecoration: 'none',
    },
    // P18 addendum D24/D25: the console's lint diagnostics — an underline plus this hover
    // tooltip is the entire lint UI (no gutter, no panel). The library's own squiggle is a
    // hard-coded raster SVG regardless of theme; replacing it with a themed wavy underline is the
    // same "no un-themed chrome" reasoning D12 already applied to the completion popup above.
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--kira-error)',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--kira-warn)',
    },
    '.cm-tooltip-lint': {
      backgroundColor: 'var(--kira-bg-elevated)',
      border: 'var(--kira-border-width) solid var(--kira-border-strong)',
      borderRadius: 'var(--kira-radius)',
      boxShadow: 'var(--kira-shadow-dialog)',
      fontFamily: 'var(--kira-font-data)',
      fontSize: 'var(--kira-t-sm)',
      overflow: 'hidden',
    },
    '.cm-diagnostic': {
      color: 'var(--kira-fg)',
    },
    '.cm-diagnostic-error': {
      borderLeft: '3px solid var(--kira-error)',
    },
    '.cm-diagnostic-warning': {
      borderLeft: '3px solid var(--kira-warn)',
    },
    // P18 (v1.1) D8: the SQL hover tooltip (editor/hover.ts) — the same ".cm-tooltip-lint" chrome
    // reused rather than a new floating-panel style, plain text lines rather than a markdown
    // renderer (§0.4's "no new primitive where one exists").
    '.cm-kira-hover': {
      backgroundColor: 'var(--kira-bg-elevated)',
      border: 'var(--kira-border-width) solid var(--kira-border-strong)',
      borderRadius: 'var(--kira-radius)',
      boxShadow: 'var(--kira-shadow-dialog)',
      fontFamily: 'var(--kira-font-data)',
      fontSize: 'var(--kira-t-sm)',
      color: 'var(--kira-fg)',
      padding: '6px 8px',
      maxWidth: '360px',
      overflow: 'hidden',
    },
    '.cm-kira-hover-line': {
      whiteSpace: 'pre',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    // P15b D2: `{{variable}}` colouring — painted by the `rangeHighlights` seam
    // (variableHighlight.ts), never by a grammar (F1's own finding: resolved/unresolved is a
    // property of the text *and* the current variable set, not something a StreamLanguage could
    // express honestly).
    // P22b D4: a resolved reference now has a colour of its own (--kira-var-resolved) rather than
    // reusing --kira-syntax-name — that token is byte-identical to --kira-syntax-property, so in a
    // JSON body a resolved reference was indistinguishable from the keys around it.
    '.cm-kira-var': {
      color: 'var(--kira-var-resolved)',
    },
    '.cm-kira-var-secret': {
      color: 'var(--kira-var-resolved)',
      textDecoration: 'underline dotted var(--kira-syntax-meta)',
    },
    // --kira-warn rather than --kira-error deliberately: an unresolved reference is not an error —
    // it may be about to be typed (HttpRequestView.vue already renders it as a `p-chip warn`).
    // Unchanged by P22b D4: the "resolved" half of the binary moved off the syntax palette; the
    // "unresolved" half staying on --kira-warn is correct as-is (it genuinely is a warning).
    '.cm-kira-var-unknown': {
      color: 'var(--kira-warn)',
      textDecoration: 'underline wavy var(--kira-warn)',
    },
    // P16 D11: ResponseFindBar's own matches, painted through the same `rangeHighlights` seam
    // (editor/findRanges.ts) — the exact match-tint + solid-current-match token pair every other
    // search surface in the app already uses (DocumentRow, KeyValueView, StreamView,
    // ConsoleResultGrid, CollectionRow, TreeRow). No new token.
    '.cm-kira-find-match': {
      background: 'var(--kira-search-match)',
    },
    '.cm-kira-find-match-current': {
      background: 'var(--kira-search-match-current)',
    },
  },
  { dark: true },
);

export const kiraHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--kira-syntax-comment)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--kira-syntax-string)' },
  { tag: tags.number, color: 'var(--kira-syntax-number)' },
  {
    tag: [tags.bool, tags.null, tags.keyword, tags.typeName, tags.atom],
    color: 'var(--kira-syntax-keyword)',
  },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--kira-syntax-control)' },
  { tag: tags.propertyName, color: 'var(--kira-syntax-property)' },
  { tag: [tags.variableName, tags.labelName], color: 'var(--kira-syntax-name)' },
  { tag: tags.function(tags.variableName), color: 'var(--kira-syntax-function)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--kira-syntax-tag)' },
  { tag: tags.attributeName, color: 'var(--kira-syntax-attribute)' },
  {
    tag: [tags.operator, tags.compareOperator, tags.logicOperator],
    color: 'var(--kira-syntax-operator)',
  },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket],
    color: 'var(--kira-syntax-punctuation)',
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.documentMeta],
    color: 'var(--kira-syntax-meta)',
  },
  { tag: tags.invalid, color: 'var(--kira-syntax-invalid)' },
]);
