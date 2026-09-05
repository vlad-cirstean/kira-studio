import type { EditorLanguageId } from '@kira/shared/domain/editor';
import {
  CONTENT_TYPE_BY_CODE_LANGUAGE,
  type HttpBodyMode,
  type HttpCodeLanguage,
  type HttpHeaderState,
  type HttpRequestTabState,
} from '@kira/shared/domain/http';

// C5/D9: the five body-mode labels, in the builder's own order. `title` is the tooltip F12 leans
// on instead of widening SegmentedControl for this one caller's label widths.
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
    title: 'Plain text',
    testid: 'http-body-mode-raw',
  },
  {
    value: 'code',
    label: 'Code',
    title: 'JavaScript, JSON, HTML or XML',
    testid: 'http-body-mode-code',
  },
  {
    value: 'file',
    label: 'binary',
    title: "One local file, sent as the request's entire body",
    testid: 'http-body-mode-file',
  },
];

// The `code` mode's sub-selector, in the same order raw's own sub-selector used to list them
// (minus Text, which is what plain `raw` now means).
export const CODE_LANGUAGE_OPTIONS: readonly { value: HttpCodeLanguage; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
];

// Which CodeMirror grammar a code sub-language renders with — only json/xml have a real grammar
// in this app (languages.ts); javascript/html render unhighlighted, exactly as they did as raw
// sub-languages before the split (no requirement beyond colour for either).
const CODE_LANGUAGE_TO_EDITOR: Readonly<Record<HttpCodeLanguage, EditorLanguageId>> = {
  javascript: 'plain',
  json: 'json',
  html: 'plain',
  xml: 'xml',
};

export function editorLanguageForCode(codeLanguage: HttpCodeLanguage): EditorLanguageId {
  return CODE_LANGUAGE_TO_EDITOR[codeLanguage];
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
export function defaultContentTypeFor(mode: HttpBodyMode, codeLanguage: HttpCodeLanguage): string {
  switch (mode) {
    case 'none':
    case 'file':
      return '';
    case 'raw':
      return 'text/plain';
    case 'code':
      return CONTENT_TYPE_BY_CODE_LANGUAGE[codeLanguage];
    case 'urlencoded':
      return 'application/x-www-form-urlencoded';
    case 'formdata':
      return 'multipart/form-data; boundary=…';
  }
}

/** D9's caption: exactly what Content-Type the send will actually carry — a hand-set header wins
 *  (D7's precedence), binary gets the explicit "no Content-Type" sentence (F3: Postman sets none
 *  either), and 'none' has nothing to caption. */
export function contentTypeCaption(
  mode: HttpBodyMode,
  codeLanguage: HttpCodeLanguage,
  userContentType: string | undefined,
): string {
  const trimmed = (userContentType ?? '').trim();
  if (trimmed !== '') return `Content-Type: ${trimmed} (from your header)`;
  if (mode === 'none') return '';
  if (mode === 'file') return 'No Content-Type (binary)';
  return `Content-Type: ${defaultContentTypeFor(mode, codeLanguage)} (auto)`;
}

/** D9: the Body segment's own count badge — mirrors REQUEST_PANE_OPTIONS's existing
 *  "bake the count into the label" technique for Params/Headers (HttpRequestView.vue). */
export function bodyBadgeLabel(state: HttpRequestTabState): string {
  switch (state.bodyMode) {
    case 'none':
      return 'Body';
    case 'raw':
      return 'Body (raw)';
    case 'code':
      return 'Body (code)';
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
  }
}
