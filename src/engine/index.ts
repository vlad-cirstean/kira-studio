import type { MessagePortMain } from 'electron';
import type { PortRequest, PortResponse } from '../shared/port';
import { handleFrame } from './control';
import { dispatch, setPortEmitter } from './rpc';

let activePort: MessagePortMain | null = null;

// Two channels reach the engine:
//   - the renderer↔engine MessagePort (attach-port), which P1 keeps to `ping`;
//   - the main↔engine control channel over process.parentPort, which carries `{ kind: 'req', … }`
//     frames dispatched to control.ts.
process.parentPort.on('message', (e) => {
  const data = e.data as { kind: string };
  if (data.kind === 'attach-port') {
    activePort?.close();
    const port = e.ports[0];
    if (!port) return;
    activePort = port;
    setPortEmitter((topic, payload) => activePort?.postMessage({ kind: 'evt', topic, payload }));
    port.start();
    port.on('message', (portEvent) => {
      handleRequest(port, portEvent.data as PortRequest);
    });
  } else {
    void handleFrame(data as PortRequest);
  }
});

function handleRequest(port: MessagePortMain, request: PortRequest): void {
  dispatch(request)
    .then((response) => port.postMessage(response))
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
