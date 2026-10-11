import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue';

/**
 * A long list shown `step` rows at a time. `visible` is the capped slice, `hiddenCount` what the
 * "Show N more" button (`ShowMoreButton`) would reveal, `showMore` raises the cap by `step`, and
 * `reset` returns to the first page (a new filter, a new panel-open).
 */
export function useCappedList<T>(rows: MaybeRefOrGetter<readonly T[]>, step: number) {
  const cap = ref(step);
  const visible = computed(() => toValue(rows).slice(0, cap.value));
  const hiddenCount = computed(() => Math.max(0, toValue(rows).length - cap.value));
  function showMore(): void {
    cap.value += step;
  }
  function reset(): void {
    cap.value = step;
  }
  return { visible, hiddenCount, showMore, reset, step };
}
