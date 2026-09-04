import {
  HTTP_METHODS,
  type HttpBinaryFileState,
  type HttpCodeLanguage,
  type HttpFormDataFieldState,
  type HttpHeaderState,
  type HttpRequestTabState,
  type HttpUrlEncodedFieldState,
} from '@shared/domain/http';
import { type CurlFlagId, expandShortCluster, type FlagSpec, lookupFlag } from './flags';
import { CURL_WARNING_KINDS, type CurlWarning, type CurlWarningKind, tokenize } from './tokenize';

// P7 D4-D9: argv → this app's own request-state vocabulary. Re-exported here (rather than only in
// tokenize.ts) so every consumer of parseCurl's public surface — the corpus test, the import
// dialog — imports one module for both the result shape and its warning vocabulary.
export { CURL_WARNING_KINDS, type CurlWarning, type CurlWarningKind };

export interface ParsedCurl {
  /** Only the fields a curl command can express — everything else keeps its default (the caller
   *  patches a freshly opened tab, D12). */
  state: Pick<
    HttpRequestTabState,
    | 'method'
    | 'url'
    | 'headers'
    | 'bodyMode'
    | 'body'
    | 'code'
    | 'codeLanguage'
    | 'urlEncoded'
    | 'formData'
    | 'binaryFile'
  >;
  warnings: CurlWarning[];
}

interface RawDataPiece {
  id: 'data' | 'data-raw' | 'data-binary' | 'data-urlencode';
  text: string;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** D7's "parses as k=v" test: a non-empty name before the first '='. */
function parseAsKeyValue(piece: string): { name: string; value: string } | null {
  const eq = piece.indexOf('=');
  if (eq <= 0) return null;
  return { name: piece.slice(0, eq), value: piece.slice(eq + 1) };
}

/** F11: which of this app's CODE_LANGUAGES a Content-Type's subtype maps onto, or null when the
 *  type belongs in `raw` instead (D7 step 1). */
function codeLanguageForContentType(contentType: string): HttpCodeLanguage | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml')) return 'xml';
  if (type === 'text/html') return 'html';
  if (type === 'application/javascript' || type === 'text/javascript') return 'javascript';
  return null;
}

function explicitContentType(headers: readonly HttpHeaderState[]): string | undefined {
  let value: string | undefined;
  for (const h of headers) {
    if (h.name.trim().toLowerCase() === 'content-type') value = h.value;
  }
  return value;
}

/** D8: the three file-referencing --data-urlencode spellings — `@path`, `=@path`, `name@path`. */
function dataUrlencodeIsFile(value: string): boolean {
  if (value.startsWith('@') || value.startsWith('=@')) return true;
  const eq = value.indexOf('=');
  const at = value.indexOf('@');
  return at !== -1 && (eq === -1 || at < eq);
}

/**
 * D4-D9: turns pasted curl text into a state patch plus a warning list — never throws; an
 * unparseable command comes back as `{error}` (D3's tokenizer error, verbatim).
 */
export function parseCurl(text: string): ParsedCurl | { error: string } {
  const tokenized = tokenize(text);
  if (!tokenized.ok) return { error: tokenized.error };

  const warnings: CurlWarning[] = [...tokenized.warnings];
  const argv = tokenized.argv;

  let requestFlagValue: string | undefined;
  let headFlag = false;
  let uploadFilePath: string | undefined;
  let getFlag = false;
  let urlFlagValue: string | undefined;
  const headerRows: HttpHeaderState[] = [];
  const nonFlagArgs: string[] = [];
  const rawDataPieces: RawDataPiece[] = [];
  const formFields: HttpFormDataFieldState[] = [];

  function pushHeader(name: string, value: string): void {
    headerRows.push({ name, value, enabled: true });
  }

  function handleHeaderFlag(raw: string): void {
    const colon = raw.indexOf(':');
    if (colon !== -1) {
      const name = raw.slice(0, colon).trim();
      const value = raw.slice(colon + 1).replace(/^ /, '');
      if (name === '') {
        warnings.push({
          kind: 'header-malformed',
          detail: `'-H ${raw}' has no header name — dropped.`,
        });
      } else {
        pushHeader(name, value);
      }
      return;
    }
    // F12: curl's documented `Name;` form sends an empty-valued header.
    if (raw.endsWith(';')) {
      pushHeader(raw.slice(0, -1).trim(), '');
      return;
    }
    warnings.push({
      kind: 'header-malformed',
      detail: `'-H ${raw}' has no ':' and no trailing ';' — dropped.`,
    });
  }

  function handleFormFlag(id: 'form' | 'form-string', raw: string): void {
    const eq = raw.indexOf('=');
    if (eq === -1) {
      formFields.push({
        name: raw,
        kind: 'text',
        value: '',
        path: '',
        fileName: '',
        fileSize: 0,
        contentType: '',
        enabled: true,
      });
      return;
    }
    const name = raw.slice(0, eq);
    const rest = raw.slice(eq + 1);

    // F10/D16: --form-string never gives '@'/'<'/';type='/';filename=' any special meaning — the
    // whole remainder is the literal text value, exactly what D15 generates it from.
    if (id === 'form-string') {
      formFields.push({
        name,
        kind: 'text',
        value: rest,
        path: '',
        fileName: '',
        fileSize: 0,
        contentType: '',
        enabled: true,
      });
      return;
    }

    const segments = rest.split(';');
    const content = segments[0];
    let contentType = '';
    let hasFilenameOverride = false;
    for (const segment of segments.slice(1)) {
      const segEq = segment.indexOf('=');
      if (segEq === -1) continue;
      const key = segment.slice(0, segEq).trim();
      const value = segment.slice(segEq + 1);
      if (key === 'type') contentType = value;
      else if (key === 'filename') hasFilenameOverride = true;
    }

    if (content.startsWith('@')) {
      const path = content.slice(1);
      formFields.push({
        name,
        kind: 'file',
        value: '',
        path,
        fileName: basename(path),
        fileSize: 0,
        contentType,
        enabled: true,
      });
    } else if (content.startsWith('<')) {
      warnings.push({
        kind: 'form-file-content',
        detail: `-F '${raw}' takes its value from a local file's contents — this app cannot read files here, so the field was dropped.`,
      });
      return;
    } else {
      formFields.push({
        name,
        kind: 'text',
        value: content,
        path: '',
        fileName: '',
        fileSize: 0,
        contentType,
        enabled: true,
      });
    }
    if (hasFilenameOverride) {
      warnings.push({
        kind: 'form-filename',
        detail: `-F '${raw}' sets a per-part filename override — this app has no field for it, so the row keeps its own default instead.`,
      });
    }
  }

  function handle(spec: FlagSpec, raw: string, value: string | undefined): void {
    if (spec.category === 'ignored') return;
    if (spec.category === 'warned') {
      warnings.push({
        kind: 'unsupported-flag',
        detail: `${raw} changes how the request behaves and has no equivalent here — the generated request will not behave identically.`,
      });
      return;
    }
    const id = spec.id as CurlFlagId;
    const v = value ?? '';
    switch (id) {
      case 'request':
        requestFlagValue = v;
        return;
      case 'head':
        headFlag = true;
        return;
      case 'upload-file':
        uploadFilePath = v;
        return;
      case 'get':
        getFlag = true;
        return;
      case 'url':
        urlFlagValue = v;
        return;
      case 'header':
        handleHeaderFlag(v);
        return;
      case 'user-agent':
        pushHeader('User-Agent', v);
        return;
      case 'referer':
        pushHeader('Referer', v);
        return;
      case 'cookie':
        if (v.includes('=')) {
          pushHeader('Cookie', v);
        } else {
          warnings.push({
            kind: 'unsupported-flag',
            detail: `-b/--cookie '${v}' names a cookie-jar file — reading it would be a filesystem read this app does not do.`,
          });
        }
        return;
      case 'user':
        pushHeader('Authorization', `Basic ${btoa(v)}`);
        warnings.push({
          kind: 'credential-in-command',
          detail:
            '-u/--user stores this credential in the tab’s state in plain text — the app’s place for a credential is a secret variable.',
        });
        return;
      case 'oauth2-bearer':
        pushHeader('Authorization', `Bearer ${v}`);
        warnings.push({
          kind: 'credential-in-command',
          detail:
            '--oauth2-bearer stores this credential in the tab’s state in plain text — the app’s place for a credential is a secret variable.',
        });
        return;
      case 'json':
        pushHeader('Content-Type', 'application/json');
        pushHeader('Accept', 'application/json');
        rawDataPieces.push({ id: 'data-raw', text: v });
        return;
      case 'data':
      case 'data-raw':
      case 'data-binary':
      case 'data-urlencode':
        rawDataPieces.push({ id, text: v });
        return;
      case 'form':
      case 'form-string':
        handleFormFlag(id, v);
        return;
    }
  }

  let i = 0;
  while (i < argv.length) {
    const raw = argv[i];
    if (raw.length === 0 || raw[0] !== '-' || raw === '-') {
      nonFlagArgs.push(raw);
      i += 1;
      continue;
    }

    let token = raw;
    let inlineValue: string | undefined;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        inlineValue = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
    }

    const spec = lookupFlag(token);
    if (!spec) {
      const cluster = !token.startsWith('--') ? expandShortCluster(token) : null;
      if (cluster) {
        for (const flag of cluster) {
          const clusterSpec = lookupFlag(flag);
          if (clusterSpec) handle(clusterSpec, flag, undefined);
        }
        i += 1;
        continue;
      }
      // D6: an unknown flag is assumed to take no value — the alternative (assume it takes one)
      // eats the URL, F6's exact failure mode.
      warnings.push({
        kind: 'unknown-flag',
        detail: `${raw} is not a recognised curl flag — ignored, assumed to take no value.`,
      });
      i += 1;
      continue;
    }

    if (spec.arity === 0) {
      handle(spec, raw, undefined);
      i += 1;
      continue;
    }
    if (inlineValue !== undefined) {
      handle(spec, raw, inlineValue);
      i += 1;
    } else {
      handle(spec, raw, argv[i + 1]);
      i += 2;
    }
  }

  // ---- D5: method ----
  let method = 'GET';
  if (requestFlagValue !== undefined) {
    const upper = requestFlagValue.toUpperCase();
    if ((HTTP_METHODS as readonly string[]).includes(upper)) {
      method = upper;
    } else {
      method = 'GET';
      warnings.push({
        kind: 'method-coerced',
        detail: `'-X ${requestFlagValue}' is not one of this app's seven supported methods — coerced to GET.`,
      });
    }
  } else if (headFlag) {
    method = 'HEAD';
  } else if (uploadFilePath !== undefined) {
    method = 'PUT';
  } else if (getFlag) {
    method = 'GET';
  } else if (rawDataPieces.length > 0 || formFields.length > 0) {
    method = 'POST';
  }

  // ---- D5: URL ----
  let url = urlFlagValue ?? nonFlagArgs[0] ?? '';
  const extraCount =
    urlFlagValue !== undefined ? nonFlagArgs.length : Math.max(0, nonFlagArgs.length - 1);
  if (extraCount > 0) {
    warnings.push({
      kind: 'multiple-urls',
      detail: `${extraCount} extra URL-shaped argument(s) were dropped — a request tab is one request.`,
    });
  }
  if (url === '') {
    warnings.push({ kind: 'no-url', detail: 'No URL was found in the command.' });
  }

  // F13: -G appends the -d-family data verbatim to the query string rather than sending it as a
  // body — measured: curl never re-encodes it, so neither does this.
  if (getFlag && rawDataPieces.length > 0) {
    const queryText = rawDataPieces.map((p) => p.text).join('&');
    url += (url.includes('?') ? '&' : '?') + queryText;
    rawDataPieces.length = 0;
  }

  // ---- D7/D8: body mode ----
  let bodyMode: HttpRequestTabState['bodyMode'] = 'none';
  let bodyRaw = '';
  let bodyCode = '';
  let codeLanguage: HttpCodeLanguage = 'json';
  let urlEncodedRows: HttpUrlEncodedFieldState[] = [];
  let binaryFile: HttpBinaryFileState = null;

  // D8: `--data-binary @path` as the *only* data piece is "one local file as the whole body" —
  // exactly what `file` mode is.
  const onlyBinaryFile =
    rawDataPieces.length === 1 &&
    formFields.length === 0 &&
    rawDataPieces[0].id === 'data-binary' &&
    rawDataPieces[0].text.startsWith('@');

  if (formFields.length > 0) {
    // D7 item 3: formdata wins regardless of any stated Content-Type header — curl mints its own
    // boundary, so a stated one cannot be honoured (dropped silently, the same way it would be
    // overridden on the real wire).
    bodyMode = 'formdata';
  } else if (onlyBinaryFile) {
    const path = rawDataPieces[0].text.slice(1);
    bodyMode = 'file';
    binaryFile = { path, name: basename(path), size: 0 };
  } else if (rawDataPieces.length > 0) {
    const literalPieces: string[] = [];
    for (const piece of rawDataPieces) {
      if (piece.id === 'data' && piece.text.startsWith('@')) {
        warnings.push({
          kind: 'data-file-inline',
          detail: `-d '${piece.text}' would inline a local file's contents (with newlines stripped) — this app cannot read files here, so it was dropped.`,
        });
        continue;
      }
      if (piece.id === 'data-binary' && piece.text.startsWith('@')) {
        warnings.push({
          kind: 'data-file-inline',
          detail: `--data-binary '${piece.text}' would inline a local file's contents — this app cannot read files here, so it was dropped.`,
        });
        continue;
      }
      if (piece.id === 'data-urlencode' && dataUrlencodeIsFile(piece.text)) {
        warnings.push({
          kind: 'data-file-inline',
          detail: `--data-urlencode '${piece.text}' would inline a local file's contents — this app cannot read files here, so it was dropped.`,
        });
        continue;
      }
      literalPieces.push(piece.text);
    }

    if (literalPieces.length === 0) {
      bodyMode = 'none';
    } else {
      const contentType = explicitContentType(headerRows);
      const allKeyValue = literalPieces.every((p) => parseAsKeyValue(p) !== null);
      if (contentType !== undefined) {
        if (
          contentType.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded' &&
          allKeyValue
        ) {
          bodyMode = 'urlencoded';
          urlEncodedRows = literalPieces.map((p) => {
            const kv = parseAsKeyValue(p);
            return { name: kv?.name ?? '', value: kv?.value ?? '', enabled: true };
          });
        } else {
          const lang = codeLanguageForContentType(contentType);
          if (lang) {
            bodyMode = 'code';
            codeLanguage = lang;
            bodyCode = literalPieces.join('&');
          } else {
            bodyMode = 'raw';
            bodyRaw = literalPieces.join('&');
          }
        }
      } else if (allKeyValue) {
        bodyMode = 'urlencoded';
        urlEncodedRows = literalPieces.map((p) => {
          const kv = parseAsKeyValue(p);
          return { name: kv?.name ?? '', value: kv?.value ?? '', enabled: true };
        });
      } else {
        // F11: no Content-Type header means curl would have sent this as urlencoded regardless —
        // raw's own default is text/plain (§1.6), so an explicit header is added and named.
        bodyMode = 'raw';
        bodyRaw = literalPieces.join('&');
        pushHeader('Content-Type', 'application/x-www-form-urlencoded');
        warnings.push({
          kind: 'implied-content-type',
          detail:
            'curl would have sent this body as application/x-www-form-urlencoded (its own default for -d with no Content-Type header) — an explicit header was added so this app sends the same thing.',
        });
      }
    }
  } else if (uploadFilePath !== undefined) {
    bodyMode = 'file';
    binaryFile = { path: uploadFilePath, name: basename(uploadFilePath), size: 0 };
  }

  return {
    state: {
      method: method as HttpRequestTabState['method'],
      url,
      headers: headerRows,
      bodyMode,
      body: bodyMode === 'raw' ? bodyRaw : '',
      code: bodyMode === 'code' ? bodyCode : '',
      codeLanguage,
      urlEncoded: bodyMode === 'urlencoded' ? urlEncodedRows : [],
      formData: bodyMode === 'formdata' ? formFields : [],
      binaryFile,
    },
    warnings,
  };
}
