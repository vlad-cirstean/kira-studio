import { computed, type Ref, ref, watch } from 'vue';

export interface ActiveDescendantOptions<T> {
  items: () => readonly T[];
  /** DOM id of one option; the listbox points `aria-activedescendant` at it. */
  optionId: (item: T, index: number) => string;
  /** Enter on the active option. */
  onSelect: (item: T, index: number) => void;
  /** Escape while the list is open. Return `true` when it consumed the key. */
  onEscape?: () => boolean | undefined;
  /** Runs after the active index changes (scroll the option into view). */
  onActive?: (item: T, index: number) => void;
  /** Disabled for the key rules when false (list closed). Default: always on. */
  when?: () => boolean;
}

/**
 * Keyboard model for a combobox whose focus stays in the input: ArrowUp/ArrowDown move the active
 * option (wrapping), Enter selects it, Escape closes. The input binds `aria-activedescendant` and
 * `onKeydown`; options bind their id from `optionId`.
 */
export function useActiveDescendant<T>(opts: ActiveDescendantOptions<T>): {
  activeIndex: Ref<number>;
  activeId: Readonly<Ref<string | undefined>>;
  onKeydown: (e: KeyboardEvent) => boolean;
  reset: () => void;
} {
  const activeIndex = ref(-1);
  const activeId = computed(() => {
    const item = opts.items()[activeIndex.value];
    return item === undefined ? undefined : opts.optionId(item, activeIndex.value);
  });

  watch(
    () => opts.items().length,
    (length) => {
      if (activeIndex.value >= length) activeIndex.value = length - 1;
    },
  );
  watch(activeIndex, (index) => {
    const item = opts.items()[index];
    if (item !== undefined) opts.onActive?.(item, index);
  });

  function move(step: 1 | -1): void {
    const count = opts.items().length;
    if (count === 0) return;
    const from = activeIndex.value;
    activeIndex.value = from < 0 ? (step === 1 ? 0 : count - 1) : (from + step + count) % count;
  }

  /** Returns `true` when the key was consumed (and `preventDefault`ed). */
  function onKeydown(e: KeyboardEvent): boolean {
    if (e.isComposing || (opts.when && !opts.when())) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (opts.items().length === 0) return false;
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (e.key === 'Enter') {
      const item = opts.items()[activeIndex.value];
      if (item === undefined) return false;
      e.preventDefault();
      opts.onSelect(item, activeIndex.value);
      return true;
    }
    if (e.key === 'Escape' && opts.onEscape?.()) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  return {
    activeIndex,
    activeId,
    onKeydown,
    reset(): void {
      activeIndex.value = -1;
    },
  };
}
