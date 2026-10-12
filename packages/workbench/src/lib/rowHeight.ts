import type { RowDensity } from '@shared/domain/settings';
import { useCssVar } from '@vueuse/core';
import { computed } from 'vue';

/** Row height in px per Appearance density: the source of `--kira-row-height`. */
export const ROW_HEIGHT_PX: Record<RowDensity, number> = { compact: 22, comfortable: 28 };

const DOUBLE_EXTRA = 16;

/** Row heights in px from `--kira-row-height` (Appearance density); `double` is a two-line row. */
export function useRowHeight() {
  const raw = useCssVar('--kira-row-height', document.documentElement, { observe: true });
  const single = computed(() => {
    const n = Number.parseFloat(raw.value ?? '');
    return Number.isFinite(n) && n > 0 ? n : ROW_HEIGHT_PX.comfortable;
  });
  return { single, double: computed(() => single.value + DOUBLE_EXTRA) };
}
