import type { MessagePortMain } from 'electron';
import type { PortRequest, PortResponse } from '../shared/port';
import { handleFrame } from './control';
import { dispatch } from './rpc';

let activePort: MessagePortMain | null = null;

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
