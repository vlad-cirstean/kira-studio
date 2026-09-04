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

// P3 D2/D5: Postman's own `mode` spelling — httpclient.BodyMode's wire values. Kept distinct from
// the (still two-mode, until P3 C4) state schema's own httpBodyModeSchema — the wire never carries
// P2's legacy 'json' alias, only what Go actually understands.
export type HttpBodyModeWire = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';

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

// httpclient.GraphQLBody — the user's own query/variables text, carried verbatim.
export interface HttpGraphQlBodyWire {
  query: string;
  variables: string;
}

// httpclient.Body — a tagged union: `mode` selects which member is meaningful, every other member
// is ignored (P3 D5), replacing P2's `body: string; hasBody: boolean` pair.
export interface HttpBodyWire {
  mode: HttpBodyModeWire;
  raw: string;
  rawLanguage: string;
  urlEncoded: HttpFieldWire[];
  formData: HttpFormFieldWire[];
  file: string;
  graphql: HttpGraphQlBodyWire;
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

export const httpBodyModeSchema = /*#__PURE__*/ z.enum(['none', 'json']);
export type HttpBodyMode = z.infer<typeof httpBodyModeSchema>;

export const httpRequestPaneSchema = /*#__PURE__*/ z.enum(['params', 'headers', 'body']);
export type HttpRequestPane = z.infer<typeof httpRequestPaneSchema>;

export const httpResponsePaneSchema = /*#__PURE__*/ z.enum(['body', 'headers']);
export type HttpResponsePane = z.infer<typeof httpResponsePaneSchema>;

export const httpResponseViewSchema = /*#__PURE__*/ z.enum(['pretty', 'raw']);
export type HttpResponseView = z.infer<typeof httpResponseViewSchema>;

// D6: every field carries `.default()` so a tab saved by P2 still restores once a later phase
// widens `bodyMode` or adds a field — the same discipline `keyValueTabStateSchema`'s own comment
// records (tabs.ts), and it matters more here than anywhere else because `repos/tabs.go` drops a
// row outright on a failed parse. There is deliberately no `params` array: the URL is the single
// source of truth for the query string (D9), and the Params table is a derived editor over it.
export const httpRequestTabStateSchema = /*#__PURE__*/ z.object({
  method: httpMethodSchema.default('GET'),
  url: z.string().default(''),
  headers: /*#__PURE__*/ z.array(httpHeaderSchema).default([]),
  bodyMode: httpBodyModeSchema.default('none'),
  body: z.string().default(''),
  requestPane: httpRequestPaneSchema.default('params'),
  responsePane: httpResponsePaneSchema.default('body'),
  responseView: httpResponseViewSchema.default('pretty'),
  // 0 = "the default half" — PanelSplitter's own convention for "no explicit size saved yet".
  requestPaneHeight: z.number().int().min(0).default(0),
});
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
