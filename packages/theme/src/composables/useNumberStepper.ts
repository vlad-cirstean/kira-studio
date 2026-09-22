import type { Ref } from 'vue';

// P104 §2 TextField -> ui/input-group: keeps TextField.vue's original stepUp/stepDown + synthetic
// input/change dispatch (app keystroke behaviour, not primitive, so it moves with the call sites
// rather than living in a deleted primitive). `container` is a ref to the InputGroup's own root --
// InputGroupInput forwards no DOM ref of its own, so the live <input> is queried directly, same as
// TextField.vue's own inputRef did before the swap.
export function useNumberStepper(container: Ref<HTMLElement | null>): {
  stepBy: (dir: 1 | -1) => void;
} {
  function stepBy(dir: 1 | -1): void {
    const el = container.value?.querySelector('input');
    if (!el || el.disabled) return;
    if (dir > 0) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { stepBy };
}
