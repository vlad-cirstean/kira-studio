import { t } from '@theme/i18n';
import { useDistillUiStore } from '@workbench/memory/distill/distillStore';
import { useMemoryUiStore } from '@workbench/memory/store';
import { useModeStore } from '../../state/mode';

type CodeEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

/** Adds the `Distill selection` context-menu action to a file view: the selected text opens in the
 *  Memory module's distill view, with its path and line range as origin. Returns the teardown. */
export function attachDistillSelection(editor: CodeEditor, path: string): () => void {
  const action = editor.addAction({
    id: 'memory.distillSelection',
    label: t('memory.distill.selection.label'),
    precondition: 'editorHasSelection',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    run: () => {
      const sel = editor.getSelection();
      const text = sel ? (editor.getModel()?.getValueInRange(sel) ?? '') : '';
      if (!sel || text.trim() === '') return;
      // A selection ending at column 1 of a later line does not include that line.
      const end =
        sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber
          ? sel.endLineNumber - 1
          : sel.endLineNumber;
      useDistillUiStore().openWith({ text, origin: { path, start: sel.startLineNumber, end } });
      useMemoryUiStore().view = 'distill';
      useModeStore().setMode('memory');
    },
  });
  return () => action.dispose();
}
