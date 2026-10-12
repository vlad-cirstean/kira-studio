import type { ShortcutId } from '@shared/domain/shortcuts';
import { useEventListener } from '@vueuse/core';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { isEditableTarget } from '../behaviour/dom';
import { shortcutFor } from './keys';

/** The one local keydown handler for a `SHORTCUTS` chord. Listens on `target` (an element, a ref,
 *  or `window`), skips IME composition, skips events from a text field when `ignoreTextFields` is set, and `preventDefault`s on a match before calling `handler`.
 *  `capture` runs before the focused child sees the key, for a chord an embedded editor (Monaco's
 *  Cmd+Enter) would claim and `preventDefault` first.
 *  Global chords stay Go menu accelerators plus `registerCommand`; this is for chords that only
 *  mean something while a surface has focus. */
export function useShortcut(
  target: Parameters<typeof useEventListener>[0],
  ids: readonly ShortcutId[],
  handler: (id: ShortcutId, event: KeyboardEvent) => void,
  opts: { when?: MaybeRefOrGetter<boolean>; ignoreTextFields?: boolean; capture?: boolean } = {},
): () => void {
  return useEventListener(
    target as Window,
    'keydown',
    (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (opts.when !== undefined && !toValue(opts.when)) return;
      const id = shortcutFor(e, ids);
      if (id === null) return;
      if (opts.ignoreTextFields && isEditableTarget(e.target)) return;
      e.preventDefault();
      handler(id, e);
    },
    { capture: opts.capture },
  );
}
