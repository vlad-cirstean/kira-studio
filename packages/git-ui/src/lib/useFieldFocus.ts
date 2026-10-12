import { useFocus } from '@vueuse/core';
import { computed, type Ref } from 'vue';

/** Returns a function that moves focus to the `<input>` inside a theme `SearchField` or `Input`
 *  (a component ref). VueUse `useFocus` does the focusing. */
export function useFieldFocus(field: Ref<{ $el?: Element } | null | undefined>): () => void {
  const input = computed<HTMLInputElement | null>(() => {
    const root = field.value?.$el;
    if (root instanceof HTMLInputElement) return root;
    return root?.querySelector('input') ?? null;
  });
  const { focused } = useFocus(input);
  return () => {
    focused.value = true;
  };
}
