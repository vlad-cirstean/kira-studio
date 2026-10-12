import { type MaybeElementRef, unrefElement, useFocus } from '@vueuse/core';
import { nextTick, onMounted } from 'vue';

/** Scroll `el` into view, nearest edge by default: the one `scrollIntoView` recipe. */
export function revealElement(el: Element, opts: { block?: ScrollLogicalPosition } = {}): void {
  el.scrollIntoView({ block: opts.block ?? 'nearest', inline: 'nearest' });
}

/** Focus `target` (an element or a component instance) as soon as it mounts. `select` also selects
 *  the text of an input. */
export function useFocusOnMount(target: MaybeElementRef, opts: { select?: boolean } = {}): void {
  useFocus(target, { initialValue: true });
  if (!opts.select) return;
  onMounted(() =>
    nextTick(() => {
      const el = unrefElement(target);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
    }),
  );
}

/** Remember the focused element when a surface opens and give focus back when it closes, if that
 *  element is still in the document. `fallback` runs otherwise (a virtual row that scrolled away). */
export function useFocusReturn(): {
  capture: () => void;
  restore: (fallback?: () => void) => void;
} {
  let invoker: HTMLElement | null = null;
  return {
    capture(): void {
      const active = document.activeElement;
      invoker = active instanceof HTMLElement && active !== document.body ? active : null;
    },
    restore(fallback): void {
      const target = invoker;
      invoker = null;
      if (target?.isConnected) target.focus();
      else fallback?.();
    },
  };
}
