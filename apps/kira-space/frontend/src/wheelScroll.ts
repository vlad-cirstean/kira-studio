// Kira Studio's own wheelScroll.ts, ported verbatim — a plain mouse produces only a vertical
// wheel axis (deltaY); a horizontally overflowing tab strip needs its own wheel->scroll
// translation to be reachable by wheel rather than only trackpad or drag.

/** Translates a vertical wheel gesture into horizontal scroll on an overflowing element — a
 *  no-op when the element doesn't overflow, so it never fights ordinary page scroll. Returns
 *  true when it consumed the event, so the caller knows to preventDefault(). */
export function wheelToHorizontal(el: HTMLElement | null, e: WheelEvent): boolean {
  if (!el || e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return false;
  el.scrollLeft += e.deltaY;
  return true;
}
