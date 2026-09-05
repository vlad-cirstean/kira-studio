// P12 D7/P9 F16: F13/body.go's `url.QueryEscape`, matched byte-for-byte — encodeURIComponent's own
// leftover set (`! * ' ( )`) is smaller than Go's unreserved set, so those five are escaped on top
// of it; a space becomes '+', matching buildURLEncoded's own both-halves encoding. curl/generate.ts
// and raw/generate.ts each hand-rolled this identically as a private `goQueryEscape` — living in
// two separate directories (http/curl/, http/raw/) was the reason they were never merged; now that
// both are one package's src/http/ tree, this is the one exported copy.
export function goQueryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}
