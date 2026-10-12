const COUNT_FORMAT = new Intl.NumberFormat();

/** A count with the locale's digit grouping: '12,345'. */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}
