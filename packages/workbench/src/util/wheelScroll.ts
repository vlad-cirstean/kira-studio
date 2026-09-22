// P42 F3/D7: a plain mouse produces only a vertical wheel axis (deltaY); a horizontally
// overflowing strip needs its own wheel->scroll translation to be reachable by wheel rather than
// only trackpad or drag. Lives at the renderer root (format.ts/clipboard.ts/fonts.ts's own
// precedent, P24 D35) because both workbench/ and views/console/ need it, and workbench/ ->
// views/ and views/ -> workbench/ are both forbidden (biome.json).

/** Translates a vertical wheel gesture into horizontal scroll on an overflowing element — a
 *  no-op when the element doesn't overflow, so it never fights ordinary page scroll. Returns
 *  true when it consumed the event, so the caller knows to preventDefault(). */
export function wheelToHorizontal(el: HTMLElement | null, e: WheelEvent): boolean {
  if (!el || e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return false;
  el.scrollLeft += e.deltaY;
  return true;
}
