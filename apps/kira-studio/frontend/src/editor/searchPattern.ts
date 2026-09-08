// P28 D11: the one place this app turns "some text plus three toggles" into a RegExp.
//
// It lived in `views/shared/page/scan.ts` (the data views' chunked row scanner) until the
// request/response find bar needed the identical three options. Hoisted here rather than imported
// across, because `editor/` sits *below* `views/` — a find bar reaching up into the grid's scanner
// would invert the layering, while the scanner reaching down here does not. Nothing about the
// semantics changed in the move: this is scan.ts's own `escapeRegExp`/`compilePattern` verbatim.

/** The three independent toggles every search surface in this app offers. */
export interface SearchPatternOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Throws SyntaxError synchronously for an invalid regex, before any scan starts — callers either
 *  surface it (the data views' toolbar) or treat it as zero matches plus an invalid input (the
 *  find bar, where a half-typed `[` is a normal intermediate state rather than an error). */
export function compileSearchPattern(text: string, o: SearchPatternOptions): RegExp {
  const flags = o.matchCase ? 'g' : 'gi';
  return o.regex
    ? new RegExp(text, flags)
    : new RegExp(o.wholeWord ? `\\b${escapeRegExp(text)}\\b` : escapeRegExp(text), flags);
}
