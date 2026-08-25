import { AdapterError } from '../errors';

// F16: the management plugin's own error envelope — {"error": "bad_request", "reason": "..."} at
// 400/404/401. `reason` is the human sentence (e.g. "queue_not_found", "Access refused."); `error`
// is the short machine tag. Prefer `reason` when both are present.
export interface RabbitApiErrorBody {
  error?: string;
  reason?: string;
}

// D5/F16: turns one non-2xx HTTP response into the closed AdapterError code set, keeping the
// broker's own `reason` verbatim (Adapter rule 4) rather than composing a message around it.
// A 404 is ambiguous by construction — "this queue doesn't exist" and "there is no management API
// at this address" share a status code — so callers that can distinguish (the connect probe, D5)
// pass a more specific fallback message via `notFoundHint`.
export function mapHttpError(
  status: number,
  body: RabbitApiErrorBody | null,
  notFoundHint?: string,
): AdapterError {
  const serverMessage = body?.reason ?? body?.error;
  if (status === 401) {
    return new AdapterError('E_AUTH', serverMessage ?? 'Access refused.');
  }
  if (status === 404) {
    return new AdapterError('E_NOT_FOUND', serverMessage ?? notFoundHint ?? 'not found');
  }
  return new AdapterError('E_QUERY', serverMessage ?? `HTTP ${status}`);
}

// D9: fetch's own error shapes for a signal-driven timeout vs. a genuine user cancel are already
// distinct DOMException names (verified empirically against this runtime's undici) — no need to
// consult ctx.signal.aborted separately.
export function mapNetworkError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'AbortError') return new AdapterError('E_CANCELLED', 'operation was cancelled', err);
  if (name === 'TimeoutError') return new AdapterError('E_TIMEOUT', message, err);
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code ?? (err as { code?: string } | undefined)?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return new AdapterError('E_CONNECT', message, err);
  }
  if (code === 'ETIMEDOUT') return new AdapterError('E_TIMEOUT', message, err);
  // A non-JSON body (a plain HTML error page, or nothing at all) at the port the app tried is the
  // signature of a node with no management plugin listening there (F17) — surfaced during the
  // connect probe (client.ts) with that specific wording; every other call site falls back here.
  return new AdapterError('E_CONNECT', message, err);
}
