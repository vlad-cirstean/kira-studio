// P24 D35: sibling of clipboard.ts — a small renderer-root utility module.
//
// P100 Part 2: Studio's own formatBytes dropped — kira-space has no grid cell editor or
// KeyValueView.vue consumer for it yet (both Studio-only surfaces). Re-add (or pull from a shared
// package, once one exists — it's a plain dedup candidate, no app-specific coupling) alongside its
// first real kira-space caller instead of carrying it unused.

/** 'just now' / '5m ago' / '3h ago' / 'yesterday' / '2d ago'. One
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
