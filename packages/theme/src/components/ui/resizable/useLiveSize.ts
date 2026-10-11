import { computed, reactive, ref } from 'vue';

/** A pane size that previews live during a drag and settles on release. `bind` spreads onto a
 *  `ResizeHandle` (`v-bind="pane.bind"`: its `size` plus the live, commit and cancel listeners);
 *  `size` sizes the pane; `onCommit` persists. */
export function useLiveSize(committed: () => number, onCommit: (size: number) => void) {
  const live = ref<number | null>(null);
  const size = computed(() => live.value ?? committed());
  const bind = reactive({
    size,
    onLive: (value: number) => {
      live.value = value;
    },
    onCommit: (value: number) => {
      live.value = null;
      onCommit(value);
    },
    onCancel: () => {
      live.value = null;
    },
  });
  return { size, bind };
}
