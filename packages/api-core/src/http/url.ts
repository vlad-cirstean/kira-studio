// D9: pure, DOM-free URL helpers — no URLSearchParams. URLSearchParams.toString() encodes a
// space as '+', so any round trip through the Params table would silently rewrite a user's %20;
// these hand-written functions never do. The rule this file exists to make testable: typing in
// the URL field updates the Params table and never rewrites the URL; editing the table rewrites
// the URL (HttpRequestView.vue owns that direction — this module only splits/builds strings).

import { splitTemplateSpans } from './substitute';

export interface SplitUrl {
  base: string;
  /** Without the leading '?'. */
  query: string;
  /** Without the leading '#'. */
  hash: string;
}

/** Two indexOfs, not new URL() — a half-typed URL ('api.exa') must still split cleanly. */
export function splitUrl(text: string): SplitUrl {
  const hashIdx = text.indexOf('#');
  const beforeHash = hashIdx >= 0 ? text.slice(0, hashIdx) : text;
  const hash = hashIdx >= 0 ? text.slice(hashIdx + 1) : '';
  const queryIdx = beforeHash.indexOf('?');
  const base = queryIdx >= 0 ? beforeHash.slice(0, queryIdx) : beforeHash;
  const query = queryIdx >= 0 ? beforeHash.slice(queryIdx + 1) : '';
  return { base, query, hash };
}

export interface QueryPair {
  name: string;
  value: string;
  /** P21 round 3 functional finding 11: true when the pair's own text had no `=` at all (a bare
   *  `?flag`, not `?flag=`). buildQuery uses this to rebuild a bare flag as `flag` rather than
   *  always appending `=` — without it, any *other* row changing in the same table rewrote the
   *  whole query string (HttpRequestView.vue does this on every edit) and silently turned a
   *  valueless flag the user never touched into `flag=`, a different request for any server that
   *  distinguishes "no value" from "empty value". Optional: a freshly added row (blankParam()) has
   *  no occasion to be bare, and undefined behaves exactly like false. Once `value` becomes
   *  non-empty (the user typed one), the pair is no longer bare regardless of this flag — see
   *  buildQuery below. */
  bare?: boolean;
}

// P21 round 3 functional finding 11: `+` used to be asymmetric — left untouched here on decode
// (deliberately, per this file's own header: a space must round-trip as %20, never silently become
// `+`), but encoded to `%2B` by encodeQueryComponent below (plain encodeURIComponent's own
// behaviour). Any *other* row changing in the same Params table rewrites the whole query string
// (HttpRequestView.vue does this on every edit), so a literal `+` a user typed — `q=hello+world`,
// the overwhelming majority of form-encoded readers' own space encoding — silently became
// `q=hello%2Bworld` the moment an unrelated param changed, a different request for any server that
// treats `+` as a space. Resolved by leaving `+` untouched on *both* sides (this decoder already
// did; encodeQueryComponent now un-encodes the one sequence encodeURIComponent can produce for it)
// rather than adopting `+`-means-space, which is exactly what this file's header comment already
// rejected for the more common %20 case.
function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // A malformed escape (a bare '%' from mid-typing) passes through raw rather than throwing.
    return s;
  }
}

/** Split on '&', then the first '=' of each pair — `parseQuery('a=1&b') → [{a,1},{b,''}]`. */
export function parseQuery(query: string): QueryPair[] {
  if (!query) return [];
  return query
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const rawName = eq >= 0 ? pair.slice(0, eq) : pair;
      const rawValue = eq >= 0 ? pair.slice(eq + 1) : '';
      return { name: decodeComponent(rawName), value: decodeComponent(rawValue), bare: eq < 0 };
    });
}

/** encodeURIComponent each half — never URLSearchParams.toString(), which encodes a space as
 *  '+' instead of '%20' and would silently rewrite what the user typed. Finding 16: a `{{name}}`
 *  reference living inside a name or value is left untouched rather than being encoded into
 *  `%7B%7Bname%7D%7D`, a form neither substitution engine (this package's own `resolve`, nor
 *  internal/apivars/resolve.go) recognises any more. Finding 11 (round 3): `%2B` is un-encoded
 *  back to a literal `+` afterward — the only percent sequence encodeURIComponent can produce for
 *  it, so this is exact and never touches a `+` produced by encoding some other original byte. */
function encodeQueryComponent(s: string): string {
  return splitTemplateSpans(s)
    .map((span) =>
      span.isReference ? span.text : encodeURIComponent(span.text).replace(/%2B/g, '+'),
    )
    .join('');
}

export function buildQuery(pairs: readonly QueryPair[]): string {
  return pairs
    .map((p) =>
      // Finding 11 (round 3): a bare `?flag` (no `=` at all) must rebuild bare — always appending
      // `=` turned a valueless flag into `flag=` the moment any other row's edit rewrote the query
      // string, a different request for a server that distinguishes the two. Once the user has
      // actually typed a value, the pair is no longer bare regardless of how it started.
      p.bare && p.value === ''
        ? encodeQueryComponent(p.name)
        : `${encodeQueryComponent(p.name)}=${encodeQueryComponent(p.value)}`,
    )
    .join('&');
}

function withScheme(base: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(base) ? base : `https://${base}`;
}

/** D2: the URL's path, else its host, else the raw text, else 'New request' — TabKindDef.title
 *  and the view header both call this. P4 D14: a saved request's own name wins over all of it, so
 *  "Create order" stops rendering as /v2/orders — one line here keeps the function pure and keeps
 *  both consumers unchanged, rather than teaching either about collections. */
export function httpRequestTitle(state: { url: string; name?: string }): string {
  if (state.name) return state.name;
  const url = state.url.trim();
  if (!url) return 'New request';
  const { base } = splitUrl(url);
  try {
    const parsed = new URL(withScheme(base));
    if (parsed.pathname.length > 1) return parsed.pathname;
    if (parsed.host) return parsed.host;
  } catch {
    // Not parseable yet (mid-typing) — fall through to the raw text.
  }
  return url;
}
