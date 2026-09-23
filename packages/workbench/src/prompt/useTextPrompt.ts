import { ref } from 'vue';

interface TextPromptState {
  title: string;
  value: string;
  resolve: (v: string | null) => void;
}

/** P107 T2-19: the in-app substitute for window.prompt() (Electron's renderer implements
 *  alert/confirm natively but not prompt) — was hand-copied across GitPanel.vue,
 *  FilterHistoryMenu.vue and ConsoleSavedMenu.vue. `open` resolves the awaited Promise a caller's
 *  own trim/empty-check already expects (`const name = await open(...); if (!name...) return;`),
 *  so every call site keeps that exact shape. Pair with TextPromptDialog.vue, which renders
 *  `prompt.value` and calls `submit`/`cancel`. */
export function useTextPrompt() {
  const prompt = ref<TextPromptState | null>(null);

  function open(title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      prompt.value = { title, value: initial, resolve };
    });
  }

  function submit(): void {
    if (!prompt.value) return;
    const { value, resolve } = prompt.value;
    prompt.value = null;
    resolve(value);
  }

  function cancel(): void {
    if (!prompt.value) return;
    const { resolve } = prompt.value;
    prompt.value = null;
    resolve(null);
  }

  return { prompt, open, submit, cancel };
}
