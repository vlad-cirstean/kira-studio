import { type Ref, watch } from 'vue';

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * G21 D2: moved **verbatim** from `packages/git-ui/src/components/dialogs/modalFocus.ts` — it
 * imports nothing but `vue` and was already correct, exactly the way G19 D3b moved
 * `RowContextMenu`'s ARIA logic. `KuiDialog.vue` is now its one caller; `packages/git-ui`'s own
 * copy re-exports this one for any straggler import.
 *
 * `docs/plans/P6.md` W15: the one focus-trap-plus-return-focus behaviour every dialog shares
 * ("focus is trapped and returns to the invoking control on close" — W15's own "Done when").
 * `active` is a dialog's own `computed(() => open.value)` (or `pending.value !== undefined`);
 * this captures whatever had focus the instant it flips true and restores it the instant it
 * flips back to false, so a dialog driven entirely by a reactive ref — no imperative
 * `open()`/`close()` call site — still gets the same guarantee a modal opened by a direct method
 * call would.
 */
export function useModalFocus(
  active: Ref<boolean>,
  rootEl: Ref<HTMLElement | null>,
): { onKeydown(event: KeyboardEvent): void } {
  let invoker: HTMLElement | null = null;

  watch(active, (isActive) => {
    if (isActive) {
      invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        rootEl.value?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      });
    } else {
      invoker?.focus();
      invoker = null;
    }
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !rootEl.value) return;
    const focusables = [...rootEl.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { onKeydown };
}
