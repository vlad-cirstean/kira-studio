import type { editor } from 'monaco-editor';
import { type ComputedRef, computed, ref } from 'vue';

type DiffEditor = editor.IStandaloneDiffEditor;

export interface DiffNavigation {
  /** Whether a change lies beyond the current one in this file. */
  readonly canNext: ComputedRef<boolean>;
  readonly canPrevious: ComputedRef<boolean>;
  /** Move to the adjacent change; false when this file has none further that way. */
  next(): boolean;
  previous(): boolean;
  /** Go to the first or last change once the diff is computed, and again on each recompute until
   *  `settle()`: other layers move the cursor while they load. */
  land(at: 'first' | 'last'): void;
  settle(): void;
  dispose(): void;
}

// Own change index instead of Monaco's goToDiff: that wraps around and cannot report "no further
// change", which crossing into the next file needs. The index is independent of the cursor, which
// review comment loading moves through the API.
export function attachDiffNavigation(diffEditor: DiffEditor): DiffNavigation {
  const modifiedEditor = diffEditor.getModifiedEditor();
  const anchors = ref<number[]>([]);
  const index = ref(-1);
  let pending: 'first' | 'last' | null = null;

  function refresh(): void {
    // A pure deletion reports modifiedEndLineNumber 0; its start is the line above.
    anchors.value = (diffEditor.getLineChanges() ?? []).map((c) =>
      Math.max(1, c.modifiedStartLineNumber),
    );
    if (index.value >= anchors.value.length) index.value = anchors.value.length - 1;
  }

  function reveal(at: number): void {
    index.value = at;
    const line = anchors.value[at];
    if (line === undefined) return;
    modifiedEditor.setPosition({ lineNumber: line, column: 1 });
    modifiedEditor.revealLineInCenter(line);
  }

  function applyPending(): void {
    if (pending === null || anchors.value.length === 0) return;
    reveal(pending === 'first' ? 0 : anchors.value.length - 1);
  }

  const updateDisposable = diffEditor.onDidUpdateDiff(() => {
    refresh();
    applyPending();
  });
  // A user cursor move resyncs the index to the last change at or above the cursor.
  const cursorDisposable = modifiedEditor.onDidChangeCursorPosition((e) => {
    if (e.source !== 'mouse' && e.source !== 'keyboard') return;
    pending = null;
    let at = -1;
    anchors.value.forEach((line, i) => {
      if (line <= e.position.lineNumber) at = i;
    });
    index.value = at;
  });
  refresh();

  return {
    canNext: computed(() => index.value < anchors.value.length - 1),
    canPrevious: computed(() => index.value > 0),
    next(): boolean {
      if (index.value >= anchors.value.length - 1) return false;
      pending = null;
      reveal(index.value + 1);
      return true;
    },
    previous(): boolean {
      if (index.value <= 0) return false;
      pending = null;
      reveal(index.value - 1);
      return true;
    },
    land(at): void {
      pending = at;
      applyPending();
    },
    settle(): void {
      applyPending();
      pending = null;
    },
    dispose(): void {
      updateDisposable.dispose();
      cursorDisposable.dispose();
    },
  };
}
