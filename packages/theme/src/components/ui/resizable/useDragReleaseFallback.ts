import { useEventListener } from '@vueuse/core';
import type { Ref } from 'vue';

type Release = 'mouseup' | 'pointerup';

// A drag listens for its release on `window`, yet some releases never arrive there: outside a
// WKWebView window, swallowed by the native window layer, or after focus moves away. While
// `dragging`, replay the release from the signals that do arrive.
export function useDragReleaseFallback(dragging: Readonly<Ref<boolean>>, release: Release): void {
  function replay(e: { clientX: number; clientY: number }): void {
    if (!dragging.value) return;
    window.dispatchEvent(
      new (release === 'mouseup' ? MouseEvent : PointerEvent)(release, {
        bubbles: true,
        clientX: e.clientX,
        clientY: e.clientY,
      }),
    );
  }
  if (release === 'mouseup') {
    useEventListener(window, ['pointerup', 'pointercancel'], replay, { capture: true });
  }
  useEventListener(window, 'blur', () => replay({ clientX: 0, clientY: 0 }));
  useEventListener(
    window,
    'pointermove',
    (e: PointerEvent) => {
      if (e.buttons === 0) replay(e);
    },
    { capture: true },
  );
}
