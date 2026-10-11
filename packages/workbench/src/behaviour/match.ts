/** Trimmed, case-insensitive substring match; an empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || text.toLowerCase().includes(needle);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural order for names: 'item 2' before 'item 10', case and accents ignored. */
export function compareNatural(a: string, b: string): number {
  return collator.compare(a, b);
}
