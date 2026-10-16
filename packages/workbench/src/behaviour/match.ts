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

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Splits `text` around case-insensitive occurrences of `needle` (already lower-cased). */
export function splitMatches(text: string, needle: string): HighlightPart[] {
  if (needle === '') return [{ text, match: false }];
  const lower = text.toLowerCase();
  const out: HighlightPart[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) out.push({ text: text.slice(at, i), match: false });
    out.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}
