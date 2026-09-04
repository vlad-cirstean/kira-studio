import { createRpcClient, type MessageChannelLike, type Transport } from '@kira/git-ipc';
// tsconfig.web.json maps this specifier onto @wailsio/runtime's real types (bridge/port.ts's own
// identical comment explains why the directive below is the suppress-if-present kind).
// biome-ignore lint/suspicious/noTsIgnore: an "unused directive" kind fails where this resolves fine (see bridge/port.ts)
// @ts-ignore
import { Stream } from '/wails/runtime.js';

/**
 * §3's renderer half of the second named stream: a MessageChannelLike over Stream('git'), handed
 * to git-ipc's own createRpcClient. Correlation, stream credits and cancellation are all rpc.ts's
 * job — this file is deliberately the whole of the protocol logic on the frontend (plan §5 C6:
 * "if this file grows protocol logic, something has gone wrong upstream of it").
 */
function openGitChannel(): MessageChannelLike {
  const socket = Stream('git');
  // P11 F4 / bridge/port.ts's own precedent: explicit rather than relying on the 'arraybuffer'
  // default, which removes a silent-Blob failure mode.
  socket.binaryType = 'arraybuffer';

  const decoder = new TextDecoder();
  const listeners = new Set<(message: unknown) => void>();
  let open = false;
  const pending: string[] = [];

  socket.onopen = () => {
    open = true;
    for (const json of pending.splice(0)) socket.send(json);
  };
  socket.onmessage = (ev: MessageEvent<unknown>) => {
    try {
      const message = JSON.parse(decoder.decode(new Uint8Array(ev.data as ArrayBuffer)));
      for (const cb of listeners) cb(message);
    } catch {
      // A corrupt or truncated frame is dropped — bridge/port.ts's own onmessage takes the same
      // stance, for the same reason (no reliably extractable id to reject a specific request with).
    }
  };

  return {
    post(message: unknown): void {
      const json = JSON.stringify(message);
      // send() throws on a CONNECTING socket (bridge/port.ts's own comment) — queued until open
      // rather than dropped, since createRpcClient's very first call (app.init) can race the
      // stream's own open ack. A plain string send, like bridge/port.ts's own request() — Go's
      // Receive() gets its UTF-8 bytes either way.
      if (open) socket.send(json);
      else pending.push(json);
    },
    onMessage(handler: (message: unknown) => void): () => void {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close(): void {
      socket.close();
    },
  };
}

/** The one thing this module exports: a real Transport over the "git" Wails stream. */
export function createGitTransport(): Transport {
  return createRpcClient(openGitChannel());
}
