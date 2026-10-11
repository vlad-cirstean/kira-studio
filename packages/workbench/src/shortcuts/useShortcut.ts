import type { ShortcutId } from '@shared/domain/shortcuts';
import { useEventListener } from '@vueuse/core';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { shortcutFor } from './keys';

/** The one local keydown handler for a `SHORTCUTS` chord. Listens on `target` (an element, a ref,
 *  or `window`), skips IME composition, and `preventDefault`s on a match before calling `handler`.
 *  Global chords stay Go menu accelerators plus `registerCommand`; this is for chords that only
 *  mean something while a surface has focus. */
export function useShortcut(
  target: Parameters<typeof useEventListener>[0],
  ids: readonly ShortcutId[],
  handler: (id: ShortcutId, event: KeyboardEvent) => void,
  opts: { when?: MaybeRefOrGetter<boolean> } = {},
): () => void {
  return useEventListener(target as Window, 'keydown', (e: KeyboardEvent) => {
    if (e.isComposing || e.defaultPrevented) return;
    if (opts.when !== undefined && !toValue(opts.when)) return;
    const id = shortcutFor(e, ids);
    if (id === null) return;
    e.preventDefault();
    handler(id, e);
  });
}
