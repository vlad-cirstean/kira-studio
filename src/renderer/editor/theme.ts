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
      fontFamily: 'var(--kira-font-family)',
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
