// P24 D35: sibling of clipboard.ts — a small renderer-root utility module. One byte-formatting
// convention app-wide, replacing three near-identical formatters (StatusBar.vue/SettingsDialog.vue's
// MB-only division, KeyValueView.vue's B/KiB/MiB) and the cell editor's bare `${n} bytes`.

/** '842 bytes' / '1.2 KB' / '3.4 MB'. Decimal-looking KB/MB (divided by 1024, per this app's own
 *  existing convention); under 1024 the word stays "bytes" — it reads as a count there, not a
 *  unit. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
