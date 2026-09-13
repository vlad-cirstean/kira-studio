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

/** 'just now' / '5m ago' / '3h ago' / 'yesterday' / '2d ago'. Sibling of formatBytes: one
 *  relative-time convention app-wide, replacing three copies (StudioStart, ResponseHistoryList,
 *  VariableHistoryMenu) that had already drifted into two spellings. The no-space form wins —
 *  two of the three copies already used it, and it fits ResponseHistoryList's own fixed-width
 *  time column. Accepts either an epoch number (StudioStart's openedAt) or an ISO string (both
 *  Api callers), so every site collapses onto this without a per-caller adapter. */
export function formatRelative(at: number | string): string {
  const then = typeof at === 'number' ? at : new Date(at).getTime();
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
