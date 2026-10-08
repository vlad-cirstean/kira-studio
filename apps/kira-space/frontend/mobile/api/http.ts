import { type CodedError, toCodedError } from '@workbench/bridge/codedError';

// The phone's one transport: same-origin fetch with the device cookie. A 401 reports to the
// registered handler so the app can return to the pairing screen from anywhere.

type UnauthorizedHandler = (code: string) => void;
let onUnauthorized: UnauthorizedHandler = () => {};

export function setUnauthorizedHandler(fn: UnauthorizedHandler): void {
  onUnauthorized = fn;
}

function networkError(): CodedError {
  const err: CodedError = new Error('Cannot reach Kira Space');
  err.code = 'E_NETWORK';
  return err;
}

async function failure(res: Response): Promise<CodedError> {
  let body: { code?: string; message?: string; reason?: string } = {};
  try {
    body = await res.json();
  } catch {
    // not JSON (a proxy or the guard's plain-text 403): fall through to the status text
  }
  // `reason` rides in `details`, where toCodedError carries a structured extra.
  const err = toCodedError({
    message: body.message ?? res.statusText,
    cause: {
      code: body.code ?? `E_HTTP_${res.status}`,
      message: body.message,
      details: body.reason,
    },
  });
  if (res.status === 401) onUnauthorized(err.code ?? '');
  return err;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: 'same-origin' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw networkError();
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export function getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`
    : '';
  return request<T>(path + query, { headers: { Accept: 'application/json' } });
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
