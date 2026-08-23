/**
 * The `MessageChannelLike` adapter over a main-process `MessagePortMain` (P3 W11). Split out of
 * `main/index.ts` so a unit test can drive it with a fake port shaped like `MessagePortMain`
 * without ever loading the real `electron` module (banned in `*.test.ts`, B1) — `Electron` is
 * referenced here only as an ambient type, never imported as a value.
 *
 * `MessagePortMain.postMessage`'s transfer list is `MessagePortMain[]`, not `ArrayBuffer[]` —
 * unlike the renderer's standard `MessagePort`, so buffers cross this half of the bridge
 * structured-*cloned*, the same tradeoff `host-vscode/src/transport.ts` documents for
 * `webview.postMessage` (W10; W17 measures the cost rather than assuming it away).
 */
import type { MessageChannelLike } from "@kira-version/ipc";

export function createMainChannel(port: Electron.MessagePortMain): MessageChannelLike {
  let started = false;
  return {
    post(message): void {
      port.postMessage(message);
    },
    onMessage(handler): () => void {
      const listener = (event: Electron.MessageEvent): void => handler(event.data);
      port.on("message", listener);
      if (!started) {
        started = true;
        port.start();
      }
      return () => port.off("message", listener);
    },
    close(): void {
      port.close();
    },
  };
}
