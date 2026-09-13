/**
 * G19 D15: a small K/M/B formatter for diff-stat counts (F15: both `FileTree.vue` render sites —
 * the directory aggregate and the per-file count — interpolated a raw, unabbreviated number).
 * `§8.3`'s recommendation (add an exact-number tooltip) is the render sites' own job — this
 * module only formats the abbreviated label.
 */
export function formatChangeCount(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs}`;
  if (abs < 1_000_000) return `${sign}${trimmed(abs / 1000)}K`;
  if (abs < 1_000_000_000) return `${sign}${trimmed(abs / 1_000_000)}M`;
  return `${sign}${trimmed(abs / 1_000_000_000)}B`;
}

/** One decimal place, dropped when it would render as `.0` (`1.0K` → `1K`, `1.2K` stays). */
function trimmed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** §8.3's recommendation, taken: the exact number, comma-grouped, for a `title` tooltip
 *  (`"1,234 additions"`) alongside the abbreviated label — never the only way to read the value. */
export function exactCount(n: number): string {
  return n.toLocaleString('en-US');
}
