import type { RangeHighlight } from './variableHighlight';

// P16 D11: the response find bar's own "find" — a plain case-insensitive substring walk, not
// @codemirror/search (that package is not a dependency, and the requirement here — this app's own
// toolbar chrome and its own --kira-search-match token pair, not a re-skinned vendor panel — is
// exactly what a ~20-line indexOf walk already meets). Returns ranges in the shape
// rangeHighlightPlugin already consumes, so a find bar is just another `rangeHighlights` source.

interface MatchPosition {
  from: number;
  to: number;
}

// P21 round 3 performance finding 2: on one keystroke, ResponseFindBar.vue's own matchCounts calls
// this once per target (1-2), scrollToCurrent calls it again for the target the current match
// lands in, and ResponsePane.vue's perTargetHighlighters calls it again per target just to derive a
// running cursor — every one of those for the *same* (doc, query) pair, and every call re-allocated
// a full lowercase copy of the document plus re-walked the whole thing. `doc` is an immutable
// string reference each render (ResponsePane.vue never mutates a body in place), so the actual
// match *positions* for a given (doc, query) never change between those calls — only `currentIndex`
// (which range gets the "current" class) does, and that's a cheap O(matches) relabelling once the
// positions are known. A tiny bounded cache (never more than the 1-2 documents a find bar ever has
// open at once — Body view has one target, Raw view two) turns 4-5 full-document walks per
// keystroke into at most one per distinct document.
const POSITION_CACHE_SIZE = 4;
const positionCache: { doc: string; query: string; positions: MatchPosition[] }[] = [];

function matchPositions(doc: string, query: string): readonly MatchPosition[] {
  const cached = positionCache.find((e) => e.doc === doc && e.query === query);
  if (cached) return cached.positions;

  const haystack = doc.toLowerCase();
  const needle = query.toLowerCase();
  const positions: MatchPosition[] = [];
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    const to = from + needle.length;
    positions.push({ from, to });
    from = haystack.indexOf(needle, to);
  }

  positionCache.push({ doc, query, positions });
  if (positionCache.length > POSITION_CACHE_SIZE) positionCache.shift();
  return positions;
}

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
  return matchPositions(doc, query).map((p, index) => ({
    from: p.from,
    to: p.to,
    class: index === currentIndex ? 'cm-kira-find-match-current' : 'cm-kira-find-match',
  }));
}
