import { z } from 'zod';

// P2 D5: the wire shapes live in Go (`internal/httpclient`) and are mirrored, not re-validated,
// here — `control.ts`'s `httpSend` `trust<T>()`s the bound call's result exactly as every other
// bound call does. These types exist so the renderer has something to type against, not to guard
// input Go already produced.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const httpMethodSchema = /*#__PURE__*/ z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

export interface HttpHeaderWire {
  name: string;
  value: string;
}

export interface HttpRedirectHop {
  status: number;
  url: string;
}

// The wire's own mode spelling — httpclient.BodyMode's values. Kept distinct from the state
// schema's own httpBodyModeSchema below (same five values) — the wire never carries P2's legacy
// 'json' alias, only what Go actually understands; state.ts's send() has already resolved the
// alias by the time it builds this.
export type HttpBodyModeWire = 'none' | 'raw' | 'code' | 'urlencoded' | 'formdata' | 'file';

// httpclient.Field — one urlencoded row.
export interface HttpFieldWire {
  name: string;
  value: string;
}

// httpclient.FormField — one form-data row. `kind === 'file'` means `path` is an absolute local
// path and `value` is ignored (D4: a file's bytes never cross this bridge, only its path does).
export interface HttpFormFieldWire {
  name: string;
  kind: 'text' | 'file';
  value: string;
  path: string;
  contentType: string;
}

// httpclient.Body — a tagged union: `mode` selects which member is meaningful, every other member
// is ignored (P3 D5), replacing P2's `body: string; hasBody: boolean` pair. `raw` is the plain-text
// buffer (raw mode only); `code`/`codeLanguage` are the syntax-highlighted buffer and its language
// (code mode only, one of CODE_LANGUAGES below) — two separate buffers so switching between the two
// modes never loses either one's text (D8's "every mode keeps its own buffer" rule).
export interface HttpBodyWire {
  mode: HttpBodyModeWire;
  raw: string;
  code: string;
  codeLanguage: string;
  urlEncoded: HttpFieldWire[];
  formData: HttpFormFieldWire[];
  file: string;
}

// httpclient.Request — what `HttpService.Send` sends to Go.
export interface HttpRequestWire {
  method: HttpMethod;
  url: string;
  headers: HttpHeaderWire[];
  body: HttpBodyWire;
}

// httpclient.Response — what comes back. `body`'s meaning depends on `bodyEncoding`: 'utf8' is the
// text itself, 'base64' is the raw bytes so a binary response never gets corrupted round-tripping
// through Go's `encoding/json` (D4).
export interface HttpResponseWire {
  status: number;
  statusText: string;
  proto: string;
  headers: HttpHeaderWire[];
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  bodyBytes: number;
  bodyTruncated: boolean;
  elapsedMs: number;
  finalUrl: string;
  redirects: HttpRedirectHop[];
}

// D6: the tab's own persisted headers table — `enabled` has no wire counterpart (a disabled
// header is simply never sent), it exists only so the builder can keep an unchecked row around
// instead of deleting it.
export const httpHeaderSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
});
export type HttpHeaderState = z.infer<typeof httpHeaderSchema>;

// The request body's mode vocabulary. P3 originally spelled this after Postman's own Collection
// v2.1 `body.mode` enum verbatim (`'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql'`,
// with `raw` carrying a `rawLanguage` sub-selector for Text/JavaScript/JSON/HTML/XML) specifically
// so a future Postman import/export phase would not need a rename table. This app's own product
// decision since then split that sub-selector in two: `raw` is plain text only, and JavaScript/
// JSON/HTML/XML became their own top-level `code` mode (its own `codeLanguage` field, below).
// GraphQL bodies are dropped entirely — not deprecated, removed.
//
// BREADCRUMB for whoever builds Postman collection import/export: this vocabulary no longer maps
// 1:1 onto Postman's own `body.mode`. Postman still has one `raw` mode with a `language` sub-field
// covering all five; this app now has two separate modes (`raw` == Postman raw·text, `code` ==
// Postman raw·{javascript,json,html,xml}) and no `graphql` mode at all. A real translation belongs
// at that import/export boundary — e.g. a Postman `raw` body with `language: 'json'` becomes this
// app's `code` mode with `codeLanguage: 'json'` on import, and the reverse on export, and a
// Postman `graphql` body has nowhere to land and needs its own explicit decision (refuse the mode,
// or import it as `code`/json against the GraphQL-over-HTTP envelope). This is not implemented here
// — just flagged so it is not rediscovered as a silent data-loss bug.
export const HTTP_BODY_MODES = ['none', 'raw', 'code', 'urlencoded', 'formdata', 'file'] as const;
export type HttpBodyMode = (typeof HTTP_BODY_MODES)[number];
export const httpBodyModeSchema = /*#__PURE__*/ z.enum(HTTP_BODY_MODES);

// The `code` mode's sub-selector — what used to be four of raw's five sub-languages (everything
// but Text, which is what plain `raw` now means).
export const CODE_LANGUAGES = ['javascript', 'json', 'html', 'xml'] as const;
export type HttpCodeLanguage = (typeof CODE_LANGUAGES)[number];
export const httpCodeLanguageSchema = /*#__PURE__*/ z.enum(CODE_LANGUAGES);

// The default Content-Type per code sub-language — mirrors Go's contentTypeByCodeLanguage
// map[string]string literal (internal/httpclient/body.go) exactly; plain `raw` always sends
// text/plain and needs no table. tests/unit/go-ts-vocabulary-parity.spec.ts guards the two Content-
// Type tables from drifting apart.
export const CONTENT_TYPE_BY_CODE_LANGUAGE: Readonly<Record<HttpCodeLanguage, string>> = {
  javascript: 'application/javascript',
  json: 'application/json',
  html: 'text/html',
  xml: 'application/xml',
};

// One urlencoded row. `enabled` is builder state only, never wire state (P2 D6's rule for
// headers, reused here) — a disabled row is simply filtered out before the send args are built.
export const httpUrlEncodedFieldSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
});
export type HttpUrlEncodedFieldState = z.infer<typeof httpUrlEncodedFieldSchema>;

// One form-data row — a text row uses `value`, a file row uses `path` (D4: never bytes) plus
// `fileName`/`fileSize` so the builder can render `report.csv (1.2 MB)` with no round trip back to
// disk. `contentType` is the row's own per-part override; blank means the mode's default (D6/D7:
// the row's own Content type field when set, else application/octet-stream for a file).
export const httpFormDataFieldSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  kind: /*#__PURE__*/ z.enum(['text', 'file']).default('text'),
  value: z.string().default(''),
  path: z.string().default(''),
  fileName: z.string().default(''),
  fileSize: z.number().default(0),
  contentType: z.string().default(''),
  enabled: z.boolean().default(true),
});
export type HttpFormDataFieldState = z.infer<typeof httpFormDataFieldSchema>;

// The binary (Postman `file`) body's one chosen file — path only, never bytes.
export const httpBinaryFileSchema = /*#__PURE__*/ z
  .object({ path: z.string(), name: z.string(), size: z.number() })
  .nullable()
  .default(null);
export type HttpBinaryFileState = z.infer<typeof httpBinaryFileSchema>;

export const httpRequestPaneSchema = /*#__PURE__*/ z.enum(['params', 'headers', 'body']);
export type HttpRequestPane = z.infer<typeof httpRequestPaneSchema>;

export const httpResponsePaneSchema = /*#__PURE__*/ z.enum(['body', 'headers']);
export type HttpResponsePane = z.infer<typeof httpResponsePaneSchema>;

export const httpResponseViewSchema = /*#__PURE__*/ z.enum(['pretty', 'raw']);
export type HttpResponseView = z.infer<typeof httpResponseViewSchema>;

// D6: every field carries `.default()` so a tab saved by an older version still restores once a
// later phase widens `bodyMode` or adds a field — the same discipline `keyValueTabStateSchema`'s
// own comment records (tabs.ts), and it matters more here than anywhere else because
// `repos/tabs.go` drops a row outright on a failed parse (P3 C3 fixed the restore path so these
// defaults actually fire, `state/tabKinds.ts`'s `parseState`). There is deliberately no `params`
// array: the URL is the single source of truth for the query string (D9), and the Params table is
// a derived editor over it.
//
// Every body mode keeps its own buffer (flat siblings, not one nullable per-mode object) —
// switching between modes must not lose any of their text, and flat keeps every field individually
// `.default()`-able, which is what the restore-through-schema normalization (C3) relies on.
const httpRequestTabStateShape = /*#__PURE__*/ z.object({
  method: httpMethodSchema.default('GET'),
  url: z.string().default(''),
  headers: /*#__PURE__*/ z.array(httpHeaderSchema).default([]),
  bodyMode: httpBodyModeSchema.default('none'),
  body: z.string().default(''),
  code: z.string().default(''),
  codeLanguage: httpCodeLanguageSchema.default('json'),
  urlEncoded: /*#__PURE__*/ z.array(httpUrlEncodedFieldSchema).default([]),
  formData: /*#__PURE__*/ z.array(httpFormDataFieldSchema).default([]),
  binaryFile: httpBinaryFileSchema,
  // P4 D14: a saved request's identity and its name, both `.default()`ed like every other field
  // so a tab saved before P4 restores unchanged. `itemId` is the http_items row this tab is bound
  // to (null = a scratch request that has never been saved); it lives here rather than in the
  // tab's `path` because duplicateTab copies `path` verbatim while duplicateState clears the id,
  // which would leave two disagreeing sources of one fact and make openTab's reuse lookup
  // activate the *duplicate* when the user opened the original (F13). `name` is what keeps
  // httpRequestTitle pure: without it a saved request called "Create order" would show as
  // /v2/orders everywhere, and the alternative is teaching every title consumer about collections.
  itemId: z.string().nullable().default(null),
  name: z.string().default(''),
  requestPane: httpRequestPaneSchema.default('params'),
  responsePane: httpResponsePaneSchema.default('body'),
  responseView: httpResponseViewSchema.default('pretty'),
  // 0 = "the default half" — PanelSplitter's own convention for "no explicit size saved yet".
  requestPaneHeight: z.number().int().min(0).default(0),
});

// P2's own legacy alias, kept working: P2 shipped `bodyMode: 'json'` with its text in `body`. P3
// mapped that mode value onto `raw` + `rawLanguage: 'json'`, since `raw` used to carry a language
// sub-selector. Now that `raw` means plain text only, the equivalent mode is `code` with
// `codeLanguage: 'json'` — and because `raw` and `code` are separate buffers, the legacy text has
// to move from `body` into `code`, not just have its mode value renamed. That is the one thing a
// per-field enum preprocess (mapping just `bodyMode`) cannot do, so this preprocesses the whole
// object instead, only for exactly this legacy shape; every other value passes through untouched.
// Works only because a restored tab's state is normalized through this schema at all
// (`state/tabKinds.ts`'s `parseState`) — nothing parsed the restore path before that landed.
export const httpRequestTabStateSchema = /*#__PURE__*/ z.preprocess((v) => {
  if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).bodyMode === 'json') {
    const obj = v as Record<string, unknown>;
    const legacyBody = typeof obj.body === 'string' ? obj.body : '';
    return { ...obj, bodyMode: 'code', code: legacyBody, codeLanguage: 'json' };
  }
  return v;
}, httpRequestTabStateShape);
export type HttpRequestTabState = z.infer<typeof httpRequestTabStateSchema>;

export function defaultHttpRequestTabState(): HttpRequestTabState {
  return httpRequestTabStateSchema.parse({});
}

// D11: one shared table, rendered inline beside the status chip rather than tooltip-only — the
// case that matters (4xx/5xx) is exactly the case where a hover shouldn't be required to see it.
// No Go mirror: nothing on the Go side consults this.
export const STATUS_HINTS: Readonly<Record<number, string>> = {
  200: 'the request succeeded',
  201: 'the request succeeded and a resource was created',
  202: 'the request was accepted for processing, but not yet completed',
  204: 'the request succeeded and there is no response body',
  301: 'the resource has permanently moved to a new URL',
  302: 'the resource is temporarily at a different URL',
  304: 'the cached response is still valid — nothing new to transfer',
  400: 'the server could not understand the request as sent',
  401: 'authentication is required, or has failed',
  403: 'the server understood the request but refuses to authorize it',
  404: 'the server has no resource at this URL',
  405: 'the URL exists, but not for this method',
  408: 'the server gave up waiting for the rest of the request',
  409: 'the request conflicts with the resource’s current state',
  413: 'the request body is larger than the server will accept',
  415: 'the server does not support the request body’s content type',
  422: 'the request was well-formed but semantically invalid',
  429: 'too many requests — the client is being rate-limited',
  500: 'the server encountered an unexpected error',
  501: 'the server does not support the functionality required',
  502: 'a gateway received an invalid response from an upstream server',
  503: 'the server is temporarily unable to handle the request',
  504: 'a gateway timed out waiting for an upstream server',
};

/** A per-code sentence, falling back to a class-level one for a code not in the table. */
export function statusHint(status: number): string {
  const known = STATUS_HINTS[status];
  if (known) return known;
  if (status >= 100 && status < 200) return 'informational — the exchange is not yet complete';
  if (status >= 200 && status < 300) return 'the request succeeded';
  if (status >= 300 && status < 400) return 'the request was redirected';
  if (status >= 400 && status < 500) return 'the client request was rejected';
  if (status >= 500 && status < 600) return 'the server failed to fulfil a valid request';
  return 'unrecognised status code';
}

export function statusClass(status: number): 'info' | 'ok' | 'warn' | 'err' {
  if (status >= 100 && status < 200) return 'info';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'warn';
  return 'err';
}

// P4 D16: statusClass's exact sibling, in its exact home. Two surfaces need the same map — the
// request view's own method chip and the collections tree's per-row chip — and `http/**` may not
// import `views/**` (biome.json), so it lives here rather than being copied into both.
//
// Takes a plain `string`, not HttpMethod: an imported PROPFIND (F4) has to have a colour rather
// than throw. The eight enum members and every custom method this app's builder cannot show fall
// through to 'info', which is the same neutral family GET already uses.
const METHOD_CLASS: Readonly<Record<string, 'info' | 'ok' | 'warn' | 'err'>> = {
  GET: 'info',
  HEAD: 'info',
  OPTIONS: 'info',
  POST: 'ok',
  PUT: 'warn',
  PATCH: 'warn',
  DELETE: 'err',
};

export function httpMethodClass(method: string): 'info' | 'ok' | 'warn' | 'err' {
  return METHOD_CLASS[method.toUpperCase()] ?? 'info';
}
