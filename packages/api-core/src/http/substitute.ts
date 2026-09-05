// P5 D17: the `{{name}}` substitution engine — a two-token grammar (find `{{`, find the next
// `}}`), one pass, no expression language, no nesting. D1 declines a template engine (handlebars/
// mustache HTML-escape by default, which would corrupt a substituted `&`/`<`/`"`; their contract
// is "render or fail", not the classified per-reference report D16 needs; and Postman variable
// names — `{{base url}}`, `{{x-api-key}}` — are not identifiers, so a path-expression grammar would
// be the wrong shape entirely).
//
// Implemented identically in Go (internal/apivars/resolve.go's Resolve) and pinned to that
// file's behaviour by one shared corpus (internal/apivars/testdata/substitution.json, D18) read
// by both a Go test and tests/unit/http-substitution.spec.ts.
//
// Pure and dependency-free by design — no Vue, no DOM, no `@shared` import — which is what makes
// the corpus test a plain import (D17).

export type ReferenceKind = 'resolved' | 'deferred' | 'dynamic' | 'unknown';

export interface Reference {
  name: string;
  kind: ReferenceKind;
}

export interface SubstitutionResult {
  text: string;
  refs: Reference[];
}

/**
 * Resolves every `{{name}}` reference in `text` against `values`, deferring any name in
 * `secretNames` (D6: a secret's plaintext never reaches this function on the renderer side — the
 * caller simply never puts one in `values`) and leaving anything else — an unknown name, an
 * unrecognised `$`-prefixed dynamic reference, an unterminated `{{`, an empty `{{}}` — verbatim.
 *
 * The grammar (D17), in full: scan for `{{`; from there scan for the next `}}`; no `}}` ⇒ the
 * rest of the string is literal and the scan ends. The name is the text between, trimmed; an
 * empty name is not a reference. Nesting is not a thing — `{{a{{b}}}}` takes `a{{b` as the name,
 * finds nothing, and passes through literally. One pass only: a resolved value that itself
 * contains `{{other}}` is never re-expanded.
 *
 * P6 D2: `dynamic`, when supplied, is consulted for every `$`-prefixed name — once per occurrence
 * (D3: two `{{$guid}}` references call it twice, matching Postman's own per-occurrence behaviour,
 * F7), during this same walk, so a generated value is never re-scanned for `{{`. A `null` return
 * (an uncatalogued name, D13) behaves exactly as if `dynamic` had not been supplied at all: the
 * span is left verbatim and classified `dynamic`. Omitting the argument entirely — as every call
 * site but send() does, most importantly HttpRequestView.vue's live preview (F2) — must never
 * generate anything, which is why this is the *only* place `dynamic` is consulted rather than a
 * capability the engine always has.
 *
 * Finding 6 (v1.2 P14 round 2): `sanitizeUnresolved`, when supplied, is applied to a reference
 * span that is left literal because it will *never* be resolved by anyone downstream — `unknown`
 * (no such name anywhere) and `dynamic` (an uncatalogued generator) — before it is written to
 * `out`. A `deferred` span (a secret) is never sanitized here even when supplied: Go's own
 * apivars.Resolve still has to find it by its exact, untouched name. This is how a caller
 * embedding the result in a URL (state.ts's own `resolveTabState`) keeps a genuinely-terminal
 * `{{name with spaces}}` from injecting a raw space/`&`/`#`/`=` into `url.Parse`'s RawQuery or the
 * request line itself, without corrupting a name a later pass still needs to match.
 */
export function resolve(
  text: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
  sanitizeUnresolved?: (span: string) => string,
): SubstitutionResult {
  const secrets = new Set(secretNames);
  const refs: Reference[] = [];
  let out = '';
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    const close = text.indexOf('}}', open + 2);
    if (close === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const name = text.slice(open + 2, close).trim();
    const span = text.slice(open, close + 2);
    i = close + 2;

    if (name === '') {
      out += span;
      continue;
    }
    if (name.startsWith('$')) {
      // D2: a generated value is, from every consumer's point of view, finished — the text is
      // final and nothing downstream has work to do — which is exactly what 'resolved' already
      // means. No fifth ReferenceKind (Go's union would need one it could never produce).
      const generated = dynamic?.(name) ?? null;
      if (generated !== null) {
        refs.push({ name, kind: 'resolved' });
        out += generated;
        continue;
      }
      refs.push({ name, kind: 'dynamic' });
      out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
      continue;
    }
    if (secrets.has(name)) {
      // Never sanitized: a downstream pass (Go's apivars.Resolve) still has to find this span by
      // its exact, untouched name.
      refs.push({ name, kind: 'deferred' });
      out += span;
      continue;
    }
    if (Object.hasOwn(values, name)) {
      refs.push({ name, kind: 'resolved' });
      out += values[name];
      continue;
    }
    refs.push({ name, kind: 'unknown' });
    out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
  }

  return { text: out, refs };
}

// Finding 6's own character set — a space (the HTTP request line's own token delimiter, the one
// that actually turns a send into a 400) plus the query-string's structural delimiters (&, #, =)
// and the other ASCII whitespace bytes that are just as line-breaking as a space. Braces and an
// ordinary reference name's own characters are deliberately not in this table — they pass through
// a plain find-and-replace unchanged, which is what keeps the token recognisable as `{{name}}`.
const URL_UNSAFE_PATTERN = /[ \t\r\n&#=]/g;
const URL_UNSAFE_ENCODED: Readonly<Record<string, string>> = {
  ' ': '%20',
  '\t': '%09',
  '\r': '%0D',
  '\n': '%0A',
  '&': '%26',
  '#': '%23',
  '=': '%3D',
};

/** `resolve`'s `sanitizeUnresolved` for a URL: percent-encodes only the characters that would
 *  otherwise break `url.Parse`'s RawQuery or the request line itself (finding 6) — everything
 *  else in the span, `{{`/`}}` included, is left exactly as typed. */
export function sanitizeUrlSpan(span: string): string {
  return span.replace(URL_UNSAFE_PATTERN, (c) => URL_UNSAFE_ENCODED[c]);
}

/** One span of splitTemplateSpans' own walk — `text` is the literal run for a non-reference span,
 *  or the whole `{{name}}` (delimiters included) for a reference span. */
export interface TemplateSpan {
  text: string;
  isReference: boolean;
}

/**
 * Splits `text` into alternating literal and `{{...}}` reference spans, using the exact same
 * find-`{{`-then-find-`}}` grammar `resolve` above walks (including its own "an empty `{{}}` is
 * not a reference" rule) — for a caller that needs to transform only the literal parts (URL-
 * encoding a query param or a urlencoded body field, say) without a values/secretNames table to
 * actually resolve anything, and without corrupting a reference — resolved, deferred, or not —
 * into a form the substitution engine can no longer recognise.
 *
 * Finding 16: buildQuery (url.ts) and goQueryEscape (escape.ts) both used to `encodeURIComponent`/
 * escape a query param or urlencoded field whole, including any literal `{{name}}` inside it —
 * turning it into `%7B%7Bname%7D%7D`, which neither this module's `resolve` nor
 * internal/apivars/resolve.go recognises any more.
 */
export function splitTemplateSpans(text: string): TemplateSpan[] {
  const spans: TemplateSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open === -1) {
      spans.push({ text: text.slice(i), isReference: false });
      break;
    }
    const close = text.indexOf('}}', open + 2);
    if (close === -1) {
      spans.push({ text: text.slice(i), isReference: false });
      break;
    }
    if (open > i) spans.push({ text: text.slice(i, open), isReference: false });
    const name = text.slice(open + 2, close).trim();
    spans.push({ text: text.slice(open, close + 2), isReference: name !== '' });
    i = close + 2;
  }
  return spans;
}
