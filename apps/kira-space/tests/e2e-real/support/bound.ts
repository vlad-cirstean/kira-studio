const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge';

export class BoundError extends Error {
  constructor(
    readonly service: string,
    readonly method: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${service}.${method} -> ${status}: ${body}`);
  }
}

/**
 * Calls a bound service method on the real server over POST /wails/runtime, the same wire the
 * renderer's generated bindings use. `object: 0` is the Wails Call object, `method: 0` its only
 * method.
 */
export async function bound<T>(
  baseURL: string,
  service: string,
  method: string,
  args?: unknown,
): Promise<T> {
  const res = await fetch(`${baseURL}/wails/runtime`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-window-id': '0' },
    body: JSON.stringify({
      object: 0,
      method: 0,
      args: {
        'call-id': crypto.randomUUID(),
        methodName: `${BRIDGE_PKG}.${service}.${method}`,
        args: args === undefined ? [] : [args],
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new BoundError(service, method, res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}
