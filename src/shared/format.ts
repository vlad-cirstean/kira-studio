// Item 7: a table's row-estimate badge in the tree (`~1,234,567 rows`) reads as a wall of digits
// for anything past a few hundred thousand rows — the common abbreviated shape (10K, 1M, ...)
// reads at a glance instead. One decimal place below 10 of a unit (1.2K) and none at or above
// (12K, 999K) keeps it short without collapsing distinct counts onto the same string.
const UNITS: readonly [threshold: number, suffix: string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

export function abbreviateCount(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  for (const [threshold, suffix] of UNITS) {
    if (abs < threshold) continue;
    const scaled = abs / threshold;
    const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
    return `${sign}${text}${suffix}`;
  }
  return `${sign}${abs.toLocaleString()}`;
}
