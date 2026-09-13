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
//
// P17 D3/D6: a pipe (`{{name | transform}}`) is read *after* the scan above, not by it — the scan
// itself (find `{{`, find the next `}}`, one pass, no nesting) is bit-for-bit unchanged. What
// changed is how the already-extracted, already-trimmed text between the delimiters is read:
// `parseReference` below splits it into a bare name and an optional transform pipeline, and the
// three value-producing branches in `resolve` apply the pipeline to the value they would otherwise
// have emitted unchanged. See docs/v1.2/plans/P17-variable-environment-overhaul.md §0.3/§5.
import { applyPipeline, isTransformName, type TransformName } from './transforms';

export type ReferenceKind = 'resolved' | 'deferred' | 'dynamic' | 'unknown';

export interface Reference {
  name: string;
  kind: ReferenceKind;
  /** The transform names, left to right — present only when non-empty (D4), which is what keeps
   *  every existing corpus case and every stored request byte-identical after this phase: a
   *  reference with no pipeline reports exactly what it always has. */
  pipeline?: readonly TransformName[];
}

export interface ParsedReference {
  /** The bare reference name — what classifyReference, the hover, the reveal loop and Go's
   *  stage 2 all key on. Unchanged from today for a reference with no pipeline. */
  name: string;
  /** The transform names, left to right. Empty for today's references. */
  pipeline: readonly TransformName[];
  /** The normalized span text `{{name | a | b}}` — one space either side of each `|`, regardless
   *  of how it was typed. D9's masking placeholder, and nothing else: two spellings of one span
   *  (`{{a|b}}`, `{{ a | b }}`) must not produce two placeholders for identical wire bytes. */
  normalized: string;
}

/**
 * Splits `inner` — the already-extracted, already-trimmed text between `{{` and `}}` (the scanner
 * is not consulted and does not change) — into a bare name and an optional transform pipeline
 * (P17 D3).
 *
 * The rules, in full:
 * 1. No `|` at all ⇒ today's behaviour exactly: `{name: inner, pipeline: [], normalized:
 *    '{{'+inner+'}}'}`, reached by a fast `indexOf('|') === -1` path.
 * 2. Otherwise split on `|` and trim each segment. If the first segment is non-empty and every
 *    segment after it is a member of the closed transform vocabulary, the parse succeeds.
 * 3. Otherwise — an unrecognised segment, or an empty first segment — the whole of `inner` is the
 *    name, exactly as today, pipeline empty. This is the all-or-nothing backward-compatibility
 *    rule: a variable legitimately named `a|b` keeps resolving, and a typo'd
 *    `{{token | base46}}` becomes an `unknown` reference named `token | base46` rather than a
 *    half-parsed pipeline.
 */
export function parseReference(inner: string): ParsedReference {
  if (inner.indexOf('|') === -1) {
    return { name: inner, pipeline: [], normalized: `{{${inner}}}` };
  }
  const segments = inner.split('|').map((s) => s.trim());
  const name = segments[0];
  const rest = segments.slice(1);
  if (name !== '' && rest.every(isTransformName)) {
    const pipeline = rest as TransformName[];
    return { name, pipeline, normalized: `{{${[name, ...pipeline].join(' | ')}}}` };
  }
  return { name: inner, pipeline: [], normalized: `{{${inner}}}` };
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
/** P17 D12: a name is dynamic-shaped if it is `$`-prefixed (Postman's own spelling) or
 *  `fake.`-prefixed (this app's additive, permanent alias namespace — never a migration of the
 *  former, D12) — the one predicate `classifyReference` below and Go's own resolve.go share,
 *  rather than two copies of the same two-prefix check drifting apart. */
export function isDynamicReference(name: string): boolean {
  return name.startsWith('$') || name.startsWith('fake.');
}

/** P15b D1: the classification `resolve` gives a name, extracted from its own branch order
 *  (dynamic-shaped → dynamic, then secret → deferred, then a known value → resolved, else
 *  unknown) so the highlighter (`variableHighlight.ts`), the hover (`variableCompletion.ts`) and
 *  this function itself agree, by construction, about what "unknown" means — `resolve` below
 *  *calls* this rather than duplicating the order, which is the whole point (D1's own doc
 *  comment). A dynamic-shaped name is classified 'dynamic' regardless of `isDynamicName`/
 *  `isFakeName` — whether it is *catalogued* is a presentation detail for the caller
 *  (HttpRequestView.vue already does this, F5), not a fifth kind this function would need to
 *  grow. */
export function classifyReference(
  name: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
): ReferenceKind {
  if (isDynamicReference(name)) return 'dynamic';
  if (secretNames.includes(name)) return 'deferred';
  if (Object.hasOwn(values, name)) return 'resolved';
  return 'unknown';
}

export function resolve(
  text: string,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
  sanitizeUnresolved?: (span: string) => string,
): SubstitutionResult {
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
    const inner = text.slice(open + 2, close).trim();
    const span = text.slice(open, close + 2);
    i = close + 2;

    if (inner === '') {
      out += span;
      continue;
    }
    const { name, pipeline } = parseReference(inner);
    // D4: pipeline is omitted from the reported Reference, not an empty array, when there is
    // none — the property that keeps every existing corpus case deep-equal with no edit.
    const pushRef = (kind: ReferenceKind): void => {
      refs.push(pipeline.length > 0 ? { name, kind, pipeline } : { name, kind });
    };

    const kind = classifyReference(name, values, secretNames);
    if (kind === 'dynamic') {
      // D2: a generated value is, from every consumer's point of view, finished — the text is
      // final and nothing downstream has work to do — which is exactly what 'resolved' already
      // means. No fifth ReferenceKind (Go's union would need one it could never produce).
      //
      // D8: the pipe applies AFTER per-occurrence generation — `dynamic?.(name)` is still called
      // once per occurrence, at this same point in the walk; D6 only wraps its *return value*.
      const generated = dynamic?.(name) ?? null;
      if (generated !== null) {
        const applied = applyPipeline(pipeline, generated);
        if (applied !== null) {
          pushRef('resolved');
          out += applied;
          continue;
        }
        // D5: a transform that cannot be applied leaves the entire span verbatim and classifies
        // the reference unknown — nothing is emitted half-transformed.
        pushRef('unknown');
        out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
        continue;
      }
      pushRef('dynamic');
      out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
      continue;
    }
    if (kind === 'deferred') {
      // Never sanitized, and never transformed here: a downstream pass (Go's apivars.Resolve)
      // still has to find this span by its exact, untouched name and pipeline (D6's load-bearing
      // row) — the plaintext never enters this function on the renderer side (D6/F3), so there is
      // nothing here for a pipeline to transform yet.
      pushRef('deferred');
      out += span;
      continue;
    }
    if (kind === 'resolved') {
      const applied = applyPipeline(pipeline, values[name]);
      if (applied !== null) {
        pushRef('resolved');
        out += applied;
        continue;
      }
      pushRef('unknown');
      out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
      continue;
    }
    pushRef('unknown');
    out += sanitizeUnresolved ? sanitizeUnresolved(span) : span;
  }

  return { text: out, refs };
}

// Finding 6's own character set — a space (the HTTP request line's own token delimiter, the one
// that actually turns a send into a 400) plus the query-string's structural delimiters (&, #, =)
// and the other ASCII whitespace bytes that are just as line-breaking as a space. Braces and an
// ordinary reference name's own characters are deliberately not in this table — they pass through
// a plain find-and-replace unchanged, which is what keeps the token recognisable as `{{name}}`.
//
// P17 D11: `|` joins the set — it is not a legal URL character (RFC 3986) and a literal `|` in a
// request line is exactly finding 6's class. This applies to exactly the two kinds it already
// applied to (`unknown`, uncatalogued `dynamic`) and never to `deferred` — a piped secret still
// reaches Go's stage 2 with its `|` intact.
const URL_UNSAFE_PATTERN = /[ \t\r\n&#=|]/g;
const URL_UNSAFE_ENCODED: Readonly<Record<string, string>> = {
  ' ': '%20',
  '\t': '%09',
  '\r': '%0D',
  '\n': '%0A',
  '&': '%26',
  '#': '%23',
  '=': '%3D',
  '|': '%7C',
};

/** `resolve`'s `sanitizeUnresolved` for a URL: percent-encodes only the characters that would
 *  otherwise break `url.Parse`'s RawQuery or the request line itself (finding 6) — everything
 *  else in the span, `{{`/`}}` included, is left exactly as typed. */
export function sanitizeUrlSpan(span: string): string {
  return span.replace(URL_UNSAFE_PATTERN, (c) => URL_UNSAFE_ENCODED[c]);
}

/** One span of splitTemplateSpans' own walk — `text` is the literal run for a non-reference span,
 *  or the whole `{{name}}` (delimiters included) for a reference span. P15b D1: `from`/`to` are
 *  the span's offsets into the original `text` (so `input.slice(from, to) === text` always holds
 *  — the invariant every consumer of the offsets depends on), and `name` is the trimmed reference
 *  name, `''` for a literal span. Additive: every existing caller (`url.ts`'s `buildQuery`,
 *  `escape.ts`'s `goQueryEscape`) reads only `text`/`isReference` and is unaffected. P17 D3/D13:
 *  `name` is the bare name (parseReference's own), and `pipeline` — present only when non-empty,
 *  same convention as `Reference` (D4) — is what the hover's D13(c) chain line reads. */
export interface TemplateSpan {
  text: string;
  isReference: boolean;
  from: number;
  to: number;
  name: string;
  pipeline?: readonly TransformName[];
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
      spans.push({ text: text.slice(i), isReference: false, from: i, to: text.length, name: '' });
      break;
    }
    const close = text.indexOf('}}', open + 2);
    if (close === -1) {
      spans.push({ text: text.slice(i), isReference: false, from: i, to: text.length, name: '' });
      break;
    }
    if (open > i) {
      spans.push({ text: text.slice(i, open), isReference: false, from: i, to: open, name: '' });
    }
    const inner = text.slice(open + 2, close).trim();
    if (inner === '') {
      spans.push({
        text: text.slice(open, close + 2),
        isReference: false,
        from: open,
        to: close + 2,
        name: '',
      });
      i = close + 2;
      continue;
    }
    const { name, pipeline } = parseReference(inner);
    spans.push({
      text: text.slice(open, close + 2),
      isReference: true,
      from: open,
      to: close + 2,
      name,
      ...(pipeline.length > 0 ? { pipeline } : {}),
    });
    i = close + 2;
  }
  return spans;
}
