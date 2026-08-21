import type { PingPayload, PortRequest, PortResponse } from '../shared/port';

type Handler = (payload: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  ping: async () => {
    const payload: PingPayload = { pong: true, enginePid: process.pid, at: Date.now() };
    return payload;
  },
};

export async function dispatch(request: PortRequest): Promise<PortResponse> {
  const handler = handlers[request.op];
  if (!handler) {
    return {
      kind: 'res',
      id: request.id,
      ok: false,
      error: { message: `unknown op: ${request.op}`, code: 'UNKNOWN_OP' },
    };
  }
  try {
    const payload = await handler(request.payload);
    return { kind: 'res', id: request.id, ok: true, payload };
  } catch (err) {
    return {
      kind: 'res',
      id: request.id,
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}
