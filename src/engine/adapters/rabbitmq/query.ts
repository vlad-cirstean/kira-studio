import type { OpCtx } from '../adapter';
import { assertNotCancelled } from '../errors';
import type { RabbitHandle } from './client';
import { mapHttpError, mapNetworkError } from './errors';

// D9: fetch has no timeout of its own — without a ceiling, a request against an
// unreachable-but-not-refusing host would hang until the OS gave up. Two constants because the
// connect probe (D5) needs to fail fast while an ordinary poll can legitimately take longer.
export const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

// D8/F8: the default vhost is literally *named* '/' — a single un-encoded segment would turn
// '/api/queues//' into a different endpoint (or a 404). Every path segment goes through this one
// function; no call site hand-builds a URL.
export function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export interface RequestOptions {
  method: 'GET' | 'POST';
  /** Path segments AFTER /api, each encoded by encodeSegment — never pre-encoded by the caller. */
  segments: string[];
  query?: Record<string, string>;
  body?: unknown;
  /** What lands in op_log.command (F40). Defaults to `METHOD /api/<encoded path>` — the body is
   *  never included here even when it carries no secret, and the base URL never carries one at
   *  all (D6), so this string can never leak a credential. */
  command?: string;
  /** Overrides REQUEST_TIMEOUT_MS — set to CONNECT_TIMEOUT_MS by the connect probe only. */
  timeoutMs?: number;
}

function encodedPath(segments: string[]): string {
  return segments.map(encodeSegment).join('/');
}

function buildUrl(h: RabbitHandle, opts: RequestOptions): string {
  const url = new URL(`${h.baseUrl}/api/${encodedPath(opts.segments)}`);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) url.searchParams.set(key, value);
  }
  return url.toString();
}

interface RabbitApiErrorBody {
  error?: string;
  reason?: string;
}

// D8: the ONE fetch call site in the adapter. Every caller — catalog, read, mutate, definition,
// the connect probe — goes through this, so D7's signal wiring, D6's Authorization header, F16's
// error envelope and F40's command text are each written exactly once.
export async function request<T>(h: RabbitHandle, ctx: OpCtx, opts: RequestOptions): Promise<T> {
  assertNotCancelled(ctx);
  const url = buildUrl(h, opts);
  ctx.setCommand(opts.command ?? `${opts.method} /api/${encodedPath(opts.segments)}`);
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);

  const headers: Record<string, string> = {};
  if (h.authorization) headers.Authorization = h.authorization;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (err) {
    throw mapNetworkError(err);
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body (an HTML error page, or nothing parseable) is the signature of a node
      // with no management plugin listening at this address (F17) — mapHttpError below folds
      // this into a legible E_CONNECT/E_QUERY rather than throwing a raw parse error.
      parsed = null;
    }
  }

  if (!res.ok) {
    throw mapHttpError(res.status, parsed as RabbitApiErrorBody | null);
  }
  return parsed as T;
}

interface PageEnvelope<T> {
  items: T[];
  page: number;
  page_count: number;
}

// D8/F9: follows the management API's own page/page_size pagination to the end, 500 per page (the
// documented maximum) — used only for the endpoints that actually paginate (queues, exchanges);
// GET /api/vhosts is not paginated by the API (D18) and is fetched with a plain request() instead.
export async function requestAll<T>(
  h: RabbitHandle,
  ctx: OpCtx,
  opts: RequestOptions,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const query = { ...(opts.query ?? {}), page: String(page), page_size: '500' };
    const result = await request<PageEnvelope<T>>(h, ctx, { ...opts, query });
    const items = result.items ?? [];
    out.push(...items);
    if (items.length === 0 || page >= (result.page_count ?? page)) break;
    page++;
  }
  return out;
}
