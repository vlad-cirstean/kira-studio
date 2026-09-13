// P17 D7/D2: the six-transform closed vocabulary a `{{name | transform}}` pipe may apply — zero
// arguments, byte-identical to internal/apivars/transforms.go (the Go twin every transform is
// pinned against by the shared corpus, F1/D2). Pure and dependency-free beyond `./escape` (which
// is itself pure), matching substitute.ts's own stated reason for being a plain, unit-testable
// import.
//
// Exactly six, closed: the SPEC row names base64 encode/decode, upper/lower and URL encode/decode
// and nothing else. A closed vocabulary is what makes D3 rule 4 safe (an unknown `|`-segment must
// be recognisably not a transform, so parseReference can fall back to treating the whole span as a
// literal name) and what keeps Go/TS parity a finite, testable claim (OQ-2 declines arguments).
import { goQueryEscapeLiteral } from './escape';

export const TRANSFORM_NAMES = [
  'base64',
  'base64decode',
  'upper',
  'lower',
  'urlencode',
  'urldecode',
] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

const TRANSFORM_NAME_SET: ReadonlySet<string> = new Set(TRANSFORM_NAMES);

export function isTransformName(name: string): name is TransformName {
  return TRANSFORM_NAME_SET.has(name);
}

// D7: NOT bare `btoa(s)` — btoa throws on any code point > 255 (it operates on a "binary string",
// one byte per char code), so a non-ASCII value would throw in TS where Go's
// base64.StdEncoding.EncodeToString([]byte(s)) happily encodes its UTF-8 bytes. Converting through
// TextEncoder first is what makes the two agree on every input, not just ASCII ones.
function base64Encode(s: string): string | null {
  try {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  } catch {
    return null;
  }
}

// D7: invalid base64 *or* invalid UTF-8 is a failure (D5) — `TextDecoder('utf-8', {fatal: true})`
// is what makes that agree with Go's `utf8.Valid` check; the default (non-fatal) decoder would
// silently substitute U+FFFD for a malformed byte sequence instead of failing, which Go does not.
function base64Decode(s: string): string | null {
  try {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// D7: the inverse of goQueryEscapeLiteral — '+' back to a space first (QueryEscape's own space
// handling), then decodeURIComponent for the rest. A malformed `%` escape throws a URIError,
// matching url.QueryUnescape's own error (D5's failure rule).
function urlDecode(s: string): string | null {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

// D7's table, byte-for-byte: upper/lower never fail; base64/base64decode/urldecode can, per the
// notes above; urlencode reuses this repo's own byte-for-byte match of Go's url.QueryEscape
// (P12 D7/P9 F16) rather than re-deriving it — a value piped through it is overwhelmingly headed
// for a query string (D7's own stated reason for choosing QueryEscape's space-as-'+' over
// PathEscape's space-as-'%20').
const TRANSFORMS: Readonly<Record<TransformName, (s: string) => string | null>> = {
  base64: base64Encode,
  base64decode: base64Decode,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  urlencode: (s) => goQueryEscapeLiteral(s),
  urldecode: urlDecode,
};

/**
 * Applies `pipeline`'s transforms to `value`, left to right — `{{name | base64 | upper}}` first
 * base64-encodes, then upper-cases the result (D7's chaining rule). Returns `null` the moment any
 * step fails (D5: nothing is emitted half-transformed), rather than a partially-applied string.
 * An empty pipeline returns `value` unchanged.
 */
export function applyPipeline(pipeline: readonly TransformName[], value: string): string | null {
  let out = value;
  for (const name of pipeline) {
    const applied = TRANSFORMS[name](out);
    if (applied === null) return null;
    out = applied;
  }
  return out;
}
