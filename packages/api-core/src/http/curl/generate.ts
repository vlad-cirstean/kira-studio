import type { HttpBodyWire, HttpHeaderWire } from '@kira/shared/domain/http';
import { quote } from 'shlex';
import { goQueryEscape } from '../escape';

export interface CurlRequest {
  method: string;
  url: string;
  headers: readonly HttpHeaderWire[];
  body: HttpBodyWire;
  /** P3 D7's per-mode default, computed by the caller from body.ts's own defaultContentTypeFor —
   *  passed in rather than recomputed here, so there is one table. '' means "this mode sends
   *  none". */
  defaultContentType: string;
}

function contentTypeIsMultipart(value: string): boolean {
  return value.split(';')[0].trim().toLowerCase() === 'multipart/form-data';
}

/**
 * D13-D16: a resolved request → a runnable (or, unrevealed, an honestly non-runnable) curl
 * command string. Pure and synchronous — every `{{ }}` reference the caller could resolve is
 * already text by the time it arrives, and anything left is emitted verbatim (D10: that is what
 * makes the masked form a real, copyable command with `{{token}}` visibly in it).
 */
export function toCurl(req: CurlRequest): string {
  const { method, url, headers, body, defaultContentType } = req;

  // D14: emit -X only when it would change curl's own automatic inference — GET with no data
  // flag, POST with one (every mode D15 emits a data flag for infers POST the same way curl does
  // for a bare -d/-F).
  const inferredMethod = body.mode === 'none' ? 'GET' : 'POST';
  const needsExplicitMethod = method.toUpperCase() !== inferredMethod;

  const headersToEmit =
    body.mode === 'formdata'
      ? headers.filter(
          (h) =>
            !(h.name.trim().toLowerCase() === 'content-type' && contentTypeIsMultipart(h.value)),
        )
      : headers;

  const hasUserContentType = headersToEmit.some(
    (h) => h.name.trim().toLowerCase() === 'content-type',
  );

  const flagUnits: [string, string][] = [];
  for (const h of headersToEmit) flagUnits.push(['-H', `${h.name}: ${h.value}`]);

  if (!hasUserContentType) {
    if (body.mode === 'file') {
      // F11: the empty-value form removes the header curl would otherwise add on its own for a
      // bare --data-binary.
      flagUnits.push(['-H', 'Content-Type:']);
    } else if (body.mode !== 'none' && body.mode !== 'formdata' && defaultContentType) {
      flagUnits.push(['-H', `Content-Type: ${defaultContentType}`]);
    }
  }

  switch (body.mode) {
    case 'none':
      break;
    case 'raw':
      flagUnits.push(['--data-raw', body.raw]);
      break;
    case 'code':
      flagUnits.push(['--data-raw', body.code]);
      break;
    case 'urlencoded': {
      // F13: no --data-urlencode spelling reproduces buildURLEncoded's own both-halves encoding —
      // the already-encoded string is emitted as --data-raw plus the explicit Content-Type.
      const encoded = body.urlEncoded
        .map((f) => `${goQueryEscape(f.name)}=${goQueryEscape(f.value)}`)
        .join('&');
      flagUnits.push(['--data-raw', encoded]);
      break;
    }
    case 'formdata':
      for (const f of body.formData) {
        if (f.kind === 'file') {
          const typeSuffix = f.contentType ? `;type=${f.contentType}` : '';
          flagUnits.push(['-F', `${f.name}=@${f.path}${typeSuffix}`]);
        } else if (f.contentType && !/^[@<]/.test(f.value) && !f.value.includes(';')) {
          // P21 round 2 functional finding 5: internal/httpclient's own formPartHeader sets a
          // per-part Content-Type for a text row whenever the row carries one (body.go), but this
          // generator used to emit every text row as --form-string unconditionally, which has no
          // syntax for a per-part type at all — the generated command was silently not equivalent
          // to what Send actually puts on the wire, and a round trip through Import curl (which
          // *does* parse `;type=`, parse.ts) lost the field. -F does support `;type=`, so a text
          // row with a content type now uses it, mirroring the file branch above — guarded on the
          // value's own first character, since F10's "-F misreads a leading '@'/'<'" hazard
          // applies here too and --form-string remains the only safe spelling for that case (at
          // the cost of the type, same as before, in that narrow combination). P21 round 3
          // functional finding 9: also guarded on the value containing no `;` at all — `;` is
          // `-F`'s own parameter separator, so `-F 'note=Hello; world;type=text/plain'` sends
          // `note=Hello` and leaves ` world` to be misread as a malformed parameter, not part of
          // the value. parse.ts's own importer agrees (it splits `rest` on `;` and keeps only the
          // first segment), so this is the same class of unsafe-character exclusion as `@`/`<`,
          // just for a different metacharacter.
          flagUnits.push(['-F', `${f.name}=${f.value};type=${f.contentType}`]);
        } else {
          // F10: -F refuses (or misreads) a value beginning with '@' or '<' — --form-string never
          // gives either any special meaning, so it is emitted for every text row with no content
          // type (or one that starts with '@'/'<', which cannot safely use -F either way).
          flagUnits.push(['--form-string', `${f.name}=${f.value}`]);
        }
      }
      break;
    case 'file':
      flagUnits.push(['--data-binary', `@${body.file}`]);
      break;
  }

  const firstLineParts = ['curl', '-L'];
  if (needsExplicitMethod) firstLineParts.push('-X', method);
  firstLineParts.push(url);
  const firstLine = firstLineParts.map(quote).join(' ');

  if (flagUnits.length === 0) return firstLine;

  const restLines = flagUnits.map(([flag, value]) => `${flag} ${quote(value)}`);
  return `${firstLine} \\\n  ${restLines.join(' \\\n  ')}`;
}
