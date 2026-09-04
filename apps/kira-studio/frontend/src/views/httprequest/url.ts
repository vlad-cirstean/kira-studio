// D9: pure, DOM-free URL helpers — no URLSearchParams. URLSearchParams.toString() encodes a
// space as '+', so any round trip through the Params table would silently rewrite a user's %20;
// these hand-written functions never do. The rule this file exists to make testable: typing in
// the URL field updates the Params table and never rewrites the URL; editing the table rewrites
// the URL (HttpRequestView.vue owns that direction — this module only splits/builds strings).

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
}

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
      return { name: decodeComponent(rawName), value: decodeComponent(rawValue) };
    });
}

/** encodeURIComponent each half — never URLSearchParams.toString(), which encodes a space as
 *  '+' instead of '%20' and would silently rewrite what the user typed. */
export function buildQuery(pairs: readonly QueryPair[]): string {
  return pairs.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
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
