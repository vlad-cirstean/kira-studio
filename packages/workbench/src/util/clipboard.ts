// Extracted from what used to be three separate copy-paste-identical definitions
// (project/menus.ts, TabStrip.vue) — a fourth and fifth (grid, ops panel) made a shared module
// worth having (P6 realities #3).
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
    onError(err instanceof Error ? err.message : String(err));
  }
}
