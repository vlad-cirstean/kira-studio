// P12 D7/P9 F16: F13/body.go's `url.QueryEscape`, matched byte-for-byte — encodeURIComponent's own
// leftover set (`! * ' ( )`) is smaller than Go's unreserved set, so those five are escaped on top
// of it; a space becomes '+', matching buildURLEncoded's own both-halves encoding. curl/generate.ts
// and raw/generate.ts each hand-rolled this identically as a private `goQueryEscape` — living in
// two separate directories (http/curl/, http/raw/) was the reason they were never merged; now that
// both are one package's src/http/ tree, this is the one exported copy.
import { splitTemplateSpans } from './substitute';

// P17 D7: exported (was file-local `escapeLiteral`) so `transforms.ts`'s `urlencode` transform can
// reuse this repo's own byte-for-byte match of Go's `url.QueryEscape` rather than re-deriving it —
// the whole reason that transform is cheap to get right.
export function goQueryEscapeLiteral(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

// Finding 16: url.ts's buildQuery own twin bug — a urlencoded field's name/value can still carry a
// literal `{{name}}` reference (a deferred secret in a Copy-as-curl/Raw export, say), which this
// used to escape whole into a form neither substitution engine recognises any more. A reference
// span is left untouched; only the literal spans around it are escaped.
export function goQueryEscape(s: string): string {
  return splitTemplateSpans(s)
    .map((span) => (span.isReference ? span.text : goQueryEscapeLiteral(span.text)))
    .join('');
}
