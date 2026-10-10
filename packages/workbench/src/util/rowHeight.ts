import { useCssVar } from '@vueuse/core';
import { computed } from 'vue';

const DEFAULT_ROW_HEIGHT = 28;
const DOUBLE_EXTRA = 16;

/** Row heights in px from `--kira-row-height` (Appearance density); `double` is a two-line row. */
export function useRowHeight() {
  const raw = useCssVar('--kira-row-height', document.documentElement, { observe: true });
  const single = computed(() => {
    const n = Number.parseFloat(raw.value ?? '');
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROW_HEIGHT;
  });
  return { single, double: computed(() => single.value + DOUBLE_EXTRA) };
}
