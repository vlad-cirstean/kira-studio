import type { HttpHeaderState } from '@kira/shared/domain/http';
import { isRawEmittedHeader } from './generate';

/**
 * P175 D6: the raw editor emits only enabled, named header rows and the parser gives every row an
 * empty description, so applying its text verbatim drops disabled/blank rows and descriptions.
 * This merges the parsed rows back onto the tab's `original` rows:
 *  1. a parsed row takes the description of the first unused emitted original with the same
 *     name and value;
 *  2. each non-emitted original is re-inserted after the nearest preceding original that is in the
 *     result (matched emitted, or an already-placed non-emitted), else at the start; an unmatched
 *     emitted original (edited or deleted) is not an anchor;
 *  3. parsed rows with no original keep their parsed position.
 * A no-edit Apply is the identity on `original`.
 */
export function mergeRawHeaders(
  original: HttpHeaderState[],
  parsed: HttpHeaderState[],
): HttpHeaderState[] {
  const unused = original.filter(isRawEmittedHeader);
  const matchOf = new Map<HttpHeaderState, HttpHeaderState>();
  const result = parsed.map((row) => {
    const at = unused.findIndex((o) => o.name === row.name && o.value === row.value);
    if (at === -1) return row;
    const [orig] = unused.splice(at, 1);
    const merged = { ...row, description: orig.description };
    matchOf.set(orig, merged);
    return merged;
  });

  let anchor: HttpHeaderState | null = null;
  for (const orig of original) {
    if (isRawEmittedHeader(orig)) {
      anchor = matchOf.get(orig) ?? anchor;
      continue;
    }
    result.splice(anchor ? result.indexOf(anchor) + 1 : 0, 0, orig);
    anchor = orig;
  }
  return result;
}
