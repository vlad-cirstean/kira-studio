// P15b D7 (item 7): a header-name vocabulary for the request builder's Headers table — F6's own
// finding that nothing in the repo enumerates header names today (`userContentTypeHeader`,
// body.ts, looks for exactly one).

/** Structurally identical to `theme/primitives/completion.ts`'s own `Completion` (label, optional
 *  insert/detail/icon/caretOffsetFromEnd) — declared independently rather than imported, since
 *  `packages/api-core` is app-free, DOM-free logic (P12 D16(e)) and may not import anything under
 *  `apps/**`. TypeScript's structural typing makes `WELL_KNOWN_REQUEST_HEADERS` directly usable
 *  anywhere a `Completion[]` is expected, with no cast at the call site. */
export interface HeaderCompletion {
  label: string;
  insert?: string;
  detail?: string;
  icon?: string;
}

function header(label: string, detail: string): HeaderCompletion {
  // icon: 'symbol-field' on every entry, matching the existing filter vocabularies' own use of
  // theme/icons.ts's symbol set (F6) — a header name is exactly the "field" a column-name
  // completion already draws this icon for.
  return { label, detail, icon: 'symbol-field' };
}

/** Request headers a person actually types into a request builder — RFC 9110's own set plus the
 *  conventional non-standard ones. Response-only headers (`Set-Cookie`, `Location`, `Server`, …)
 *  are deliberately absent: this feeds the *request* headers table, never a response viewer.
 *  `detail` is the one-word category the completion popup right-aligns (theme/primitives/
 *  AutocompleteField.vue's own `sugg-detail`). Canonical Train-Case spelling for `label` — matches
 *  what the header would render as on the wire, and `rankCandidates` already case-folds
 *  (completion.ts:36-38), so typing `content-t` still matches `Content-Type`. */
export const WELL_KNOWN_REQUEST_HEADERS: readonly HeaderCompletion[] = [
  // content
  header('Content-Type', 'content'),
  header('Content-Length', 'content'),
  header('Content-Encoding', 'content'),
  header('Content-Language', 'content'),
  header('Content-Disposition', 'content'),
  header('Content-Location', 'content'),
  header('Content-Range', 'content'),
  header('Content-MD5', 'content'),

  // negotiation
  header('Accept', 'negotiation'),
  header('Accept-Encoding', 'negotiation'),
  header('Accept-Language', 'negotiation'),
  header('Accept-Charset', 'negotiation'),
  header('Accept-Datetime', 'negotiation'),
  header('Prefer', 'negotiation'),

  // auth
  header('Authorization', 'auth'),
  header('Proxy-Authorization', 'auth'),
  header('Cookie', 'auth'),
  header('X-Api-Key', 'auth'),
  header('X-CSRF-Token', 'auth'),

  // caching
  header('Cache-Control', 'caching'),
  header('Pragma', 'caching'),
  header('If-Match', 'caching'),
  header('If-None-Match', 'caching'),
  header('If-Modified-Since', 'caching'),
  header('If-Unmodified-Since', 'caching'),
  header('If-Range', 'caching'),
  header('ETag', 'caching'),

  // connection
  header('Connection', 'connection'),
  header('Keep-Alive', 'connection'),
  header('Upgrade', 'connection'),
  header('TE', 'connection'),
  header('Transfer-Encoding', 'connection'),
  header('Trailer', 'connection'),
  header('Expect', 'connection'),
  header('Host', 'connection'),
  header('Via', 'connection'),
  header('Max-Forwards', 'connection'),

  // cors
  header('Origin', 'cors'),
  header('Access-Control-Request-Method', 'cors'),
  header('Access-Control-Request-Headers', 'cors'),
  header('Sec-Fetch-Mode', 'cors'),
  header('Sec-Fetch-Site', 'cors'),
  header('Sec-Fetch-Dest', 'cors'),
  header('Sec-Fetch-User', 'cors'),

  // client
  header('User-Agent', 'client'),
  header('Referer', 'client'),
  header('From', 'client'),
  header('Date', 'client'),
  header('DNT', 'client'),
  header('Range', 'client'),

  // proxy/tracing
  header('Forwarded', 'proxy/tracing'),
  header('X-Forwarded-For', 'proxy/tracing'),
  header('X-Forwarded-Host', 'proxy/tracing'),
  header('X-Forwarded-Proto', 'proxy/tracing'),
  header('X-Request-ID', 'proxy/tracing'),
  header('X-Correlation-ID', 'proxy/tracing'),
  header('X-Requested-With', 'proxy/tracing'),
  header('Idempotency-Key', 'proxy/tracing'),
  header('Link', 'proxy/tracing'),
] as const;

function value(label: string): HeaderCompletion {
  return { label, icon: 'symbol-value' };
}

function prefix(label: string): HeaderCompletion {
  // `insert` is the label itself (already ends with the trailing space) and caretOffsetFromEnd
  // defaults to 0, so acceptance lands the caret right after the space — ready for a
  // {{variable}} completion to take over for the credential itself.
  return { label, insert: label, icon: 'symbol-value' };
}

const CONTENT_TYPES: readonly HeaderCompletion[] = [
  value('application/json'),
  value('application/x-www-form-urlencoded'),
  value('multipart/form-data'),
  value('text/plain'),
  value('text/html'),
  value('application/xml'),
  value('text/xml'),
  value('application/octet-stream'),
  value('application/graphql-response+json'),
  value('text/csv'),
  value('application/pdf'),
];

/** P22b D2: the value vocabulary, keyed by the header's own canonical name (lookup case-folds, so
 *  a user's `content-type` matches). Two entry kinds, distinguished by `insert`:
 *   - a complete value (`application/json`) — accepting it replaces the field;
 *   - a prefix (`Bearer `, with caretOffsetFromEnd 0) — accepting it leaves the caret after the
 *     space so the {{variable}} source takes over for the credential itself.
 *  `Completion`-shaped (HeaderCompletion), for the same api-core-may-not-import-apps reason
 *  WELL_KNOWN_REQUEST_HEADERS is. */
export function headerValueCompletions(name: string): readonly HeaderCompletion[] {
  switch (name.trim().toLowerCase()) {
    case 'content-type':
      return CONTENT_TYPES;
    case 'accept':
      return [...CONTENT_TYPES, value('*/*'), value('application/json, text/plain, */*')];
    case 'accept-encoding':
      return [value('gzip, deflate, br'), value('gzip'), value('identity')];
    case 'accept-language':
      return [value('en-US,en;q=0.9'), value('*')];
    case 'cache-control':
      return [value('no-cache'), value('no-store'), value('max-age=0'), value('must-revalidate')];
    case 'connection':
      return [value('keep-alive'), value('close')];
    case 'content-encoding':
      return [value('gzip'), value('deflate'), value('br')];
    case 'transfer-encoding':
      return [value('chunked')];
    case 'x-requested-with':
      return [value('XMLHttpRequest')];
    case 'authorization':
      return [
        prefix('Bearer '),
        prefix('Basic '),
        prefix('Digest '),
        prefix('Token '),
        prefix('ApiKey '),
      ];
    case 'prefer':
      return [value('return=representation'), value('return=minimal')];
    default:
      return [];
  }
}
