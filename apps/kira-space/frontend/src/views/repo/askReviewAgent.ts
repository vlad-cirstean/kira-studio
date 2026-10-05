import type { ReviewSelection } from '../../ade/v2/state/adeReviewWindow';

type CodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

interface AskTarget {
  selection: ReviewSelection | null;
  ask: (sel: ReviewSelection) => void;
}

// A diff selection ending at column 1 of a later line does not include that line.
function selectionOf(editor: CodeEditor, path: string): ReviewSelection | null {
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return null;
  const end =
    sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber
      ? sel.endLineNumber - 1
      : sel.endLineNumber;
  return { path, start: sel.startLineNumber, end };
}

/** Tracks the selection of a review window's diff and adds the `Ask review agent` context-menu
 *  action; returns the teardown. */
export function attachAskReviewAgent(
  editor: CodeEditor,
  path: string,
  store: AskTarget,
): () => void {
  const track = editor.onDidChangeCursorSelection(() => {
    store.selection = selectionOf(editor, path);
  });
  const action = editor.addAction({
    id: 'ade.askReviewAgent',
    label: 'Ask review agent',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    run: () => {
      const line = editor.getPosition()?.lineNumber ?? 1;
      store.ask(selectionOf(editor, path) ?? { path, start: line, end: line });
    },
  });
  return () => {
    track.dispose();
    action.dispose();
    store.selection = null;
  };
}
