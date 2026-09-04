// P5 D17: the `{{name}}` substitution engine — a two-token grammar (find `{{`, find the next
// `}}`), one pass, no expression language, no nesting. D1 declines a template engine (handlebars/
// mustache HTML-escape by default, which would corrupt a substituted `&`/`<`/`"`; their contract
// is "render or fail", not the classified per-reference report D16 needs; and Postman variable
// names — `{{base url}}`, `{{x-api-key}}` — are not identifiers, so a path-expression grammar would
// be the wrong shape entirely).
//
// Implemented identically in Go (internal/httpvars/resolve.go's Resolve) and pinned to that
// file's behaviour by one shared corpus (internal/httpvars/testdata/substitution.json, D18) read
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
 * caller simply never puts one in `values`) and leaving anything else — an unknown name, a
 * `$`-prefixed dynamic reference, an unterminated `{{`, an empty `{{}}` — verbatim.
 *
 * The grammar (D17), in full: scan for `{{`; from there scan for the next `}}`; no `}}` ⇒ the
 * rest of the string is literal and the scan ends. The name is the text between, trimmed; an
 * empty name is not a reference. Nesting is not a thing — `{{a{{b}}}}` takes `a{{b` as the name,
 * finds nothing, and passes through literally. One pass only: a resolved value that itself
 * contains `{{other}}` is never re-expanded.
 */
export function resolve(
  text: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
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
      refs.push({ name, kind: 'dynamic' });
      out += span;
      continue;
    }
    if (secrets.has(name)) {
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
    out += span;
  }

  return { text: out, refs };
}
