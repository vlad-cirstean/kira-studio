import {
  CONTENT_TYPE_BY_RAW_LANGUAGE,
  type HttpBodyMode,
  type HttpHeaderState,
  type HttpRawLanguage,
  type HttpRequestTabState,
} from '@shared/domain/http';
import type { EditorLanguageId } from '../../editor/languages';

// P3 C5/D9: Postman's own six body-mode labels, in Postman's own order — F2's UI-label column,
// not the wire's `mode` spelling (D2 keeps those two spellings deliberately distinct; BODY_MODE_OPTIONS
// pairs the wire value with the label a human reads). `title` is the tooltip F12 leans on instead
// of widening SegmentedControl for this one caller's label widths.
export const BODY_MODE_OPTIONS: readonly {
  value: HttpBodyMode;
  label: string;
  title: string;
  testid: string;
}[] = [
  { value: 'none', label: 'none', title: 'No request body', testid: 'http-body-mode-none' },
  {
    value: 'formdata',
    label: 'form-data',
    title: 'Multipart fields, including real files',
    testid: 'http-body-mode-formdata',
  },
  {
    value: 'urlencoded',
    label: 'x-www-form-urlencoded',
    title: 'URL-encoded form fields',
    testid: 'http-body-mode-urlencoded',
  },
  {
    value: 'raw',
    label: 'raw',
    title: 'Text, JavaScript, JSON, HTML or XML',
    testid: 'http-body-mode-raw',
  },
  {
    value: 'file',
    label: 'binary',
    title: "One local file, sent as the request's entire body",
    testid: 'http-body-mode-file',
  },
  {
    value: 'graphql',
    label: 'GraphQL',
    title: 'A GraphQL query and variables',
    testid: 'http-body-mode-graphql',
  },
];

// D2/F2: Postman's raw sub-selector, in its own dropdown order.
export const RAW_LANGUAGE_OPTIONS: readonly { value: HttpRawLanguage; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
];

// C5: which CodeMirror grammar a raw sub-language renders with — only json/xml have a real
// grammar in this app (languages.ts); text/javascript/html render unhighlighted (D1 declined a
// JS/HTML grammar for this one raw sub-language each — no requirement beyond colour, unlike
// GraphQL's D10).
const RAW_LANGUAGE_TO_EDITOR: Readonly<Record<HttpRawLanguage, EditorLanguageId>> = {
  text: 'plain',
  javascript: 'plain',
  json: 'json',
  html: 'plain',
  xml: 'xml',
};

export function editorLanguageForRaw(rawLanguage: HttpRawLanguage): EditorLanguageId {
  return RAW_LANGUAGE_TO_EDITOR[rawLanguage];
}

/** The user's own Content-Type header value, if any enabled row sets one — case-insensitive,
 *  last one wins (mirrors client.go's own headerValue). */
export function userContentTypeHeader(headers: readonly HttpHeaderState[]): string | undefined {
  let value: string | undefined;
  for (const h of headers) {
    if (h.enabled && h.name.trim().toLowerCase() === 'content-type') value = h.value;
  }
  return value;
}

/** D7: the Content-Type Go's own default would apply for this mode — "" when the mode sends none
 *  at all (none, binary). Mirrors internal/httpclient/client.go's own Send precedence, read-only:
 *  this never talks to Go, it only states what D7 documents Go will do. */
export function defaultContentTypeFor(mode: HttpBodyMode, rawLanguage: HttpRawLanguage): string {
  switch (mode) {
    case 'none':
    case 'file':
      return '';
    case 'raw':
      return CONTENT_TYPE_BY_RAW_LANGUAGE[rawLanguage];
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    case 'formdata':
      return 'multipart/form-data; boundary=…';
    case 'graphql':
      return 'application/json';
  }
}

/** D9's caption: exactly what Content-Type the send will actually carry — a hand-set header wins
 *  (D7's precedence), binary gets the explicit "no Content-Type" sentence (F3: Postman sets none
 *  either), and 'none' has nothing to caption. */
export function contentTypeCaption(
  mode: HttpBodyMode,
  rawLanguage: HttpRawLanguage,
  userContentType: string | undefined,
): string {
  const trimmed = (userContentType ?? '').trim();
  if (trimmed !== '') return `Content-Type: ${trimmed} (from your header)`;
  if (mode === 'none') return '';
  if (mode === 'file') return 'No Content-Type (binary)';
  return `Content-Type: ${defaultContentTypeFor(mode, rawLanguage)} (auto)`;
}

/** D9: the Body segment's own count badge — mirrors REQUEST_PANE_OPTIONS's existing
 *  "bake the count into the label" technique for Params/Headers (HttpRequestView.vue). */
export function bodyBadgeLabel(state: HttpRequestTabState): string {
  switch (state.bodyMode) {
    case 'none':
      return 'Body';
    case 'raw':
      return 'Body (raw)';
    case 'urlencoded': {
      const n = state.urlEncoded.filter((f) => f.enabled && f.name.trim() !== '').length;
      return n > 0 ? `Body (${n})` : 'Body';
    }
    case 'formdata': {
      const n = state.formData.filter((f) => f.enabled && f.name.trim() !== '').length;
      return n > 0 ? `Body (${n})` : 'Body';
    }
    case 'file':
      return state.binaryFile ? 'Body (1 file)' : 'Body';
    case 'graphql':
      return 'Body (GraphQL)';
  }
}
