const COUNT_FORMAT = new Intl.NumberFormat();

/** A count with the locale's digit grouping: '12,345'. */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

const SCORE_FORMAT = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A score or multiplier with two decimals: '0.82', '1.10'. */
export function formatScore(n: number): string {
  return SCORE_FORMAT.format(n);
}
