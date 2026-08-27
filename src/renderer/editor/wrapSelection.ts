import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// Item 5 (task batch P46-2): typing a bracket/quote while text is selected wraps the selection in
// that pair instead of replacing it — the "like code editors have" behavior the user asked for.
// Deliberately narrower than @codemirror/autocomplete's own closeBrackets(): that extension also
// auto-closes an *empty* selection (typing a bare `'` inserts `''`), which silently "fixes" what
// the console's own lint (D24, `resolveLint` in CodeMirrorHost.vue) exists to catch — an
// unterminated string literal never gets a chance to look unterminated. This handler only ever
// fires over a real, non-empty selection; a collapsed cursor falls through to the editor's
// ordinary single-character insert, leaving every existing typing/lint behavior untouched.
const WRAP_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  "'": "'",
  '"': '"',
  '`': '`',
};

export const wrapSelectionOnType = EditorView.inputHandler.of((view, from, to, text) => {
  if (from === to) return false;
  // A whole-document selection (Select All, then retype the lot) is a "replace everything" click,
  // not a "wrap everything" one — mongo.spec.ts's own edit flow does exactly this (Cmd+A, then
  // type a full `{"name": ...}` replacement JSON body) and must still plainly replace, the same
  // as every select-all-and-retype editor field in this app (cell editor override, WHERE box, S3
  // object body). Any selection short of the *entire* document still wraps.
  if (from === 0 && to === view.state.doc.length) return false;
  const close = WRAP_PAIRS[text];
  if (!close) return false;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${text}${selected}${close}` },
    selection: EditorSelection.range(from + text.length, to + text.length),
  });
  return true;
});
