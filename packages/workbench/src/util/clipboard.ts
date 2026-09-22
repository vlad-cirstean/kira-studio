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
