import { PORT_EVENT } from '@shared/protocol/data-ops';
import type { PortEvent, PortRequest, PortResponse } from '@shared/protocol/port';
import type { MessagePortMain } from 'electron';
import { cache } from './cache';
import { handleFrame } from './control';
import { dispatch } from './rpc';

let activePort: MessagePortMain | null = null;

// A no-op when no port is attached — the engine outlives a renderer reload, and there is
// nothing to emit into between window loads (D16).
function emitPortEvent(topic: string, payload: unknown): void {
  if (!activePort) return;
  const event: PortEvent = { kind: 'evt', topic, payload };
  activePort.postMessage(event);
}

cache.onStatsChanged((stats) => emitPortEvent(PORT_EVENT.cacheStats, stats));

process.parentPort.on('message', (e) => {
  const data = e.data as { kind: string };
  if (data.kind === 'attach-port') {
    activePort?.close();
    const port = e.ports[0];
    if (!port) return;
    activePort = port;
    port.start();
    port.on('message', (portEvent) => {
      handleRequest(port, portEvent.data as PortRequest);
    });
    return;
  }
  if (data.kind === 'req') {
    const request = data as unknown as PortRequest;
    handleFrame(request).then((response) => process.parentPort.postMessage(response));
  }
});

function handleRequest(port: MessagePortMain, request: PortRequest): void {
  dispatch(request)
    .then(({ response, transfer }) => {
      // `transfer` is always undefined today (see rpc.ts's dispatch doc comment) — kept as a
      // typed pass-through so a future platform capability is one line, not a signature change.
      if (transfer) port.postMessage(response, transfer as MessagePortMain[]);
      else port.postMessage(response);
    })
    .catch((err: unknown) => {
      const response: PortResponse = {
        kind: 'res',
        id: request.id,
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
      port.postMessage(response);
    });
}
