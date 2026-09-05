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
 */
export function resolve(
  text: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
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
