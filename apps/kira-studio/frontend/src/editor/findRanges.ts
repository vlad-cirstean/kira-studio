import type { RangeHighlight } from './variableHighlight';

// P16 D11: the response find bar's own "find" — a plain case-insensitive substring walk, not
// @codemirror/search (that package is not a dependency, and the requirement here — this app's own
// toolbar chrome and its own --kira-search-match token pair, not a re-skinned vendor panel — is
// exactly what a ~20-line indexOf walk already meets). Returns ranges in the shape
// rangeHighlightPlugin already consumes, so a find bar is just another `rangeHighlights` source.

/** Every case-insensitive occurrence of `query` in `doc`, as `{from, to, class}` ranges — empty
 *  query (or no match) returns `[]`. `currentIndex`, when it names one of this document's own
 *  matches (0-based), gets `'cm-kira-find-match-current'` instead of the plain match class — the
 *  caller (ResponseFindBar.vue) numbers matches across every target document it searches and only
 *  ever passes the index that lands in *this* document. */
export function findRanges(
  doc: string,
  query: string,
  currentIndex?: number,
): readonly RangeHighlight[] {
  if (!query) return [];
  const haystack = doc.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: RangeHighlight[] = [];
  let from = haystack.indexOf(needle);
  let index = 0;
  while (from !== -1) {
    const to = from + needle.length;
    ranges.push({
      from,
      to,
      class: index === currentIndex ? 'cm-kira-find-match-current' : 'cm-kira-find-match',
    });
    index += 1;
    from = haystack.indexOf(needle, to);
  }
  return ranges;
}
