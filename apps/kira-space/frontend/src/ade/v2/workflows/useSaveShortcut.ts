import { useEventListener } from '@vueuse/core';
import type { Ref } from 'vue';

/** Cmd/Ctrl+S inside `root` runs `save` instead of the browser's own save. */
export function useSaveShortcut(root: Ref<HTMLElement | null>, save: () => void): void {
  useEventListener(root, 'keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
}
