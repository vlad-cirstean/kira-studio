// Extracted from what used to be three separate copy-paste-identical definitions
// (project/menus.ts, TabStrip.vue) — a fourth and fifth (grid, ops panel) made a shared module
// worth having (P6 realities #3).
export function copyText(text: string): void {
  void navigator.clipboard.writeText(text);
}
