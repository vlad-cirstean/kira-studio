import { type Ref, ref, watch } from 'vue';

/** A text field that commits on blur or Enter. While it holds uncommitted edits a push never
 *  replaces it; a failed commit keeps the text and the error. */
export function useCommitField(
  source: () => string,
  commit: (text: string) => Promise<void>,
): {
  text: Ref<string>;
  error: Ref<string>;
  onInput: (v: string | number) => void;
  onCommit: () => Promise<void>;
} {
  const text = ref(source());
  const error = ref('');
  const dirty = ref(false);
  watch(source, (v) => {
    if (!dirty.value) text.value = v;
  });
  function onInput(v: string | number): void {
    text.value = String(v);
    dirty.value = true;
  }
  async function onCommit(): Promise<void> {
    if (!dirty.value) return;
    if (text.value === source()) {
      dirty.value = false;
      return;
    }
    try {
      await commit(text.value);
      error.value = '';
      dirty.value = false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }
  return { text, error, onInput, onCommit };
}
