import type { HttpRequestTabState } from '@shared/domain/http';

// P9 D10: the raw editor is generated for these four modes only — `formdata`/`file` have no text
// form that can be edited and parsed back (a file part is bytes on disk, not text). The caller
// (HttpRequestView.vue's toolbar button, http.editRaw's command) disables Edit as raw HTTP for the
// other two rather than generating an elided body the parser would take literally.
export const RAW_EDITABLE_BODY_MODES = ['none', 'raw', 'code', 'urlencoded'] as const;
export type RawEditableBodyMode = (typeof RAW_EDITABLE_BODY_MODES)[number];

export function canEditAsRaw(bodyMode: HttpRequestTabState['bodyMode']): boolean {
  return (RAW_EDITABLE_BODY_MODES as readonly string[]).includes(bodyMode);
}

/** F13/body.go's `url.QueryEscape`, matched byte-for-byte — the identical helper http/curl/
 *  generate.ts already hand-rolls as its own private `goQueryEscape`, duplicated rather than
 *  shared: P12's module merge (F16) is where http/raw/ and http/curl/ become one directory and
 *  this can be factored into one place. */
function goQueryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
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
 * http/curl/generate.ts's own `toCurl` — F16: computed by the caller, a views/ file, via
 * defaultContentTypeFor, since http/** may not import views/**): emitted only when the user set no
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
