import type { HttpBodyWire, HttpHeaderWire, HttpRequestTabState } from '@kira/shared/domain/http';
import { goQueryEscape } from '../escape';

// P9 D10: the raw editor is generated for these four modes only — `formdata`/`file` have no text
// form that can be edited and parsed back (a file part is bytes on disk, not text). The caller
// (HttpRequestView.vue's toolbar button, http.editRaw's command) disables Edit as raw HTTP for the
// other two rather than generating an elided body the parser would take literally.
const RAW_EDITABLE_BODY_MODES = ['none', 'raw', 'code', 'urlencoded'] as const;

export function canEditAsRaw(bodyMode: HttpRequestTabState['bodyMode']): boolean {
  return (RAW_EDITABLE_BODY_MODES as readonly string[]).includes(bodyMode);
}

/** The active mode's own text, pre-substitution — `{{name}}` references are never touched (D9's
 *  whole point). `urlencoded` renders the *encoded* string, mirroring D4's Go rendering and
 *  toCurl's own `--data-raw` emission for the same mode: that is what the body will actually
 *  become the moment this is parsed back and sent, so the editor shows exactly that. */
function bodyTextFor(state: HttpRequestTabState): string {
  switch (state.bodyMode) {
    case 'none':
      return '';
    case 'raw':
      return state.body;
    case 'code':
      return state.code;
    case 'urlencoded':
      return state.urlEncoded
        .filter((f) => f.enabled && f.name.trim() !== '')
        .map((f) => `${goQueryEscape(f.name)}=${goQueryEscape(f.value)}`)
        .join('&');
    default:
      // formdata/file — never reached (canEditAsRaw gates the caller), '' is the safe fallback.
      return '';
  }
}

function hasUserContentType(state: HttpRequestTabState): boolean {
  return state.headers.some((h) => h.enabled && h.name.trim().toLowerCase() === 'content-type');
}

/**
 * P9 D9: tab state → raw HTTP/1.1 text, generated pre-substitution — `{{base_url}}`, `{{token}}`
 * and `{{$guid}}` all appear literally, verbatim, exactly as the tab's own fields hold them. A
 * post-substitution buffer would not be editable at all (applying it would write today's resolved
 * values back into the tab and destroy every variable reference). Only enabled, named header rows
 * are emitted — the same filter send() itself applies — since a disabled header sends nothing and
 * has no place in a request about to be sent.
 *
 * `defaultContentType` mirrors D7's own precedent (client.go's Content-Type default, and
 * curl/generate.ts's own `toCurl` — computed by the caller via body.ts's own defaultContentTypeFor
 * rather than recomputed here): emitted only when the user set no
 * Content-Type header of their own. Without this, a no-edit round trip through the dialog (D11's
 * own Content-Type → mode table has nothing to map from) would silently apply-and-send a `code`
 * body with `raw`'s text/plain default instead of the mode's real one — a wire-level change, not a
 * cosmetic one.
 *
 * Never called for a `formdata`/`file` body (D10) — the caller refuses those before this runs.
 */
export function generateRawRequest(state: HttpRequestTabState, defaultContentType: string): string {
  const lines = [`${state.method} ${state.url} HTTP/1.1`];
  for (const h of state.headers) {
    if (h.enabled && h.name.trim() !== '') lines.push(`${h.name}: ${h.value}`);
  }
  if (state.bodyMode !== 'none' && defaultContentType && !hasUserContentType(state)) {
    lines.push(`Content-Type: ${defaultContentType}`);
  }
  const body = bodyTextFor(state);
  return `${lines.join('\n')}\n\n${body}`;
}

/** P18 D8: a stored history entry's Raw pane reader — the same rendering as `generateRawRequest`
 *  above, given the four fields a `ResponseHistorySnapshot.request` actually carries (method, url,
 *  headers, body) rather than a live tab's `HttpRequestTabState`. A small adapter, not a second
 *  generator: the stored request is already the "as sent" projection (headers/urlEncoded rows are
 *  the enabled, named ones only — the wire shape, not the builder's row list with its own
 *  `enabled` flags), so this needs no filtering `generateRawRequest`'s own loop does. */
export function generateRawRequestFromStored(
  request: { method: string; url: string; headers: HttpHeaderWire[]; body: HttpBodyWire },
  defaultContentType: string,
): string {
  const lines = [`${request.method} ${request.url} HTTP/1.1`];
  for (const h of request.headers) lines.push(`${h.name}: ${h.value}`);
  const hasContentType = request.headers.some(
    (h) => h.name.trim().toLowerCase() === 'content-type',
  );
  if (request.body.mode !== 'none' && defaultContentType && !hasContentType) {
    lines.push(`Content-Type: ${defaultContentType}`);
  }
  return `${lines.join('\n')}\n\n${storedBodyTextFor(request.body)}`;
}

/** `bodyTextFor`'s own switch, over the wire's `HttpBodyWire` shape (`mode`/`raw`/`urlEncoded`)
 *  rather than the builder's `bodyMode`/`body`/`urlEncoded` — same four editable modes (D10),
 *  `formdata`/`file` never reached since a stored entry's request is always one of the other four
 *  or empty. */
function storedBodyTextFor(body: HttpBodyWire): string {
  switch (body.mode) {
    case 'none':
      return '';
    case 'raw':
      return body.raw;
    case 'code':
      return body.code;
    case 'urlencoded':
      return body.urlEncoded
        .map((f) => `${goQueryEscape(f.name)}=${goQueryEscape(f.value)}`)
        .join('&');
    default:
      return '';
  }
}
