import { t } from '@theme/i18n';
import { useTimeoutFn } from '@vueuse/core';
import { ref } from 'vue';
import { errorText } from '../bridge/codedError';
import { announceApp } from './liveRegion';
import { TIMING } from './timing';

// Extracted from what used to be three separate copy-paste-identical definitions
// (project/menus.ts, TabStrip.vue) — a fourth and fifth (grid, ops panel) made a shared module
// worth having.
//
// Returns the underlying promise (most call sites still fire-and-forget it, unchanged) so a
// caller that already surfaces action errors — documents/menu.ts's copy-document/copy-id, mirroring
// its own delete-document catch — can await a real rejection (denied permission, an unfocused
// window) instead of it vanishing as an unhandled rejection with nothing on the clipboard and no
// visible error, ContextMenu.vue's `onItemClick` never being awaited by its `@click` binding.
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

// P107 T1-19: two call sites (documents/menu.ts, resultMenu.ts) each defined their own
// copyOrReportError, same try/copyText/catch shape underneath a different error-reporting channel
// (a store field vs. a passed-in callback) — this takes both as parameters instead.
//
// Not built on VueUse's useClipboard: its own copy() swallows a clipboard.write() rejection and
// falls back to a legacy document.execCommand path silently (@vueuse/core's useClipboard/index.ts)
// rather than rejecting — that loses exactly the "denied permission, unfocused window" failure
// this function exists to surface (P43 F6/D7's actionError). copyText's raw
// navigator.clipboard.writeText call above is what actually rejects on failure.
export async function copyOrReportError(
  text: string,
  onError: (message: string) => void,
  onSuccess?: () => void,
): Promise<void> {
  try {
    await copyText(text);
    onSuccess?.();
  } catch (err) {
    onError(errorText(err));
  }
}

/**
 * Copies text that is still being produced (an off-thread encode). The clipboard item holds the
 * pending promise, so the write starts inside the user gesture and WebKit does not reject it
 * once the text arrives late; falls back to awaiting first where ClipboardItem is missing.
 */
export async function copyOrReportErrorLazy(
  text: Promise<string>,
  onError: (message: string) => void,
  onSuccess?: () => void,
): Promise<void> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) {
      await copyText(await text);
    } else {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    }
    onSuccess?.();
  } catch (err) {
    onError(errorText(err));
  }
}

/** Reads clipboard text; throws when the permission is denied or the window is unfocused. */
export function readClipboardText(): Promise<string> {
  return navigator.clipboard.readText();
}

async function copyWithAnnouncement(text: string, message?: string): Promise<string | null> {
  try {
    await copyText(text);
  } catch (err) {
    const detail = errorText(err);
    announceApp(t('common.copy.failed.error', { error: detail }));
    return detail;
  }
  announceApp(message ?? t('common.copy.copied.announce'));
  return null;
}

/** Copy and announce a whole message (`Copied name`) through the app live region, nothing else:
 *  for menu items, which close and have no control to flash. Resolves `false` after announcing a
 *  rejection. */
export async function copyAndAnnounce(text: string, message?: string): Promise<boolean> {
  return (await copyWithAnnouncement(text, message)) === null;
}

/**
 * Copy with feedback. `copy` resolves `true` on success; `copied` stays true for
 * `TIMING.copiedFeedback` (icon buttons swap to `check`, text buttons to "Copied"); a rejection
 * lands in `error`. Both outcomes are announced. Built on `copyText`, not VueUse `useClipboard`,
 * which swallows the `writeText` rejection `copyText` exists to surface.
 */
export function useCopy() {
  const copied = ref(false);
  const error = ref<string | null>(null);
  const { start } = useTimeoutFn(
    () => {
      copied.value = false;
    },
    TIMING.copiedFeedback,
    { immediate: false },
  );
  async function copy(text: string, opts: { message?: string } = {}): Promise<boolean> {
    error.value = await copyWithAnnouncement(text, opts.message);
    copied.value = error.value === null;
    if (copied.value) start();
    return copied.value;
  }
  return { copy, copied, error };
}
