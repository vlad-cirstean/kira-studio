import type { HttpBodyWire } from '@kira/shared/domain/http';
import { type Reference, resolve } from './substitute';

// P7 C4: moved verbatim from views/httprequest/state.ts (P5 D7) — a pure walk over HttpBodyWire is
// Http-module logic that happened to be sitting in a view file, and http/state/curl.ts cannot
// import views/** (§0.3), so this had to move rather than be worked around. Behaviour is
// byte-identical: state.ts's own tests/ui specs pass unedited (C4's guard).

/** P5 D7: every substitutable field, and only those — a form-data file row's `path` and the `file`
 *  body's own path are deliberately excluded (D7: a local path is `os.Stat`-checked at send and was
 *  never seen by any picker if it came from a substituted `{{var}}`, so its failure would name a
 *  string the user never typed). */
export function substituteBody(body: HttpBodyWire, sub: (text: string) => string): HttpBodyWire {
  switch (body.mode) {
    case 'raw':
      return { ...body, raw: sub(body.raw) };
    case 'code':
      return { ...body, code: sub(body.code) };
    case 'urlencoded':
      return {
        ...body,
        urlEncoded: body.urlEncoded.map((f) => ({ name: sub(f.name), value: sub(f.value) })),
      };
    case 'formdata':
      return {
        ...body,
        formData: body.formData.map((f) => ({
          ...f,
          name: sub(f.name),
          contentType: sub(f.contentType),
          value: f.kind === 'text' ? sub(f.value) : f.value,
        })),
      };
    default:
      return body;
  }
}

export interface ResolvedRequest {
  url: string;
  headers: { name: string; value: string }[];
  body: HttpBodyWire;
  /** Every reference stage 1 found, across every D7 field — resolved, deferred (a secret, left
   *  for Go), dynamic ($-prefixed, P6), or unknown. */
  refs: Reference[];
}

/**
 * P7 D11: the renderer's own "stage 2" — the twin of `internal/apivars.ResolveRequest`'s own
 * second pass, over an already-resolved request rather than raw tab state. Everything stage 1
 * finished is already text, so this pass can only ever fill in a `deferred` span (a secret) — a
 * frozen `{{$guid}}` is not re-rolled because it is no longer a reference at all by the time this
 * runs, which is the whole reason this exists rather than a second full `resolveTabState` call:
 * that would re-roll every dynamic value (P6 D3 generates per occurrence, per call), changing the
 * UUIDs in a command the user is already looking at.
 */
export function applySecretValues(
  resolved: ResolvedRequest,
  secretValues: Readonly<Record<string, string>>,
): ResolvedRequest {
  const sub = (text: string): string => resolve(text, secretValues, []).text;
  return {
    url: sub(resolved.url),
    headers: resolved.headers.map((h) => ({ name: sub(h.name), value: sub(h.value) })),
    body: substituteBody(resolved.body, sub),
    refs: resolved.refs,
  };
}
