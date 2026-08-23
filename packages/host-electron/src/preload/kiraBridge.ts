/**
 * The `contextBridge` surface's actual logic (P3 W11), split out of `preload/index.ts` so a
 * unit test can drive it with fake `ipcRenderer`/`contextBridge` objects without ever loading
 * the real `electron` module (banned in `*.test.ts`, B1). `preload/index.ts` itself is a
 * two-line wire-up: nothing here imports `electron`.
 *
 * Exactly three members cross `contextBridge`: `onPort`, `postMessage`, `onMessage`. The raw
 * `MessagePort` `main/index.ts` sends over `webContents.postMessage("kira:port", null, [port2])`
 * never itself crosses `contextBridge` — Electron's isolated-world marshalling does not support
 * it — so it is captured here, in the preload's own context, and only these three plain
 * functions (which *can* cross) are exposed. `onPort` signals readiness rather than handing
 * back the port object for the same reason; `postMessage` buffers until the port arrives so a
 * caller never has to sequence itself around exactly when `"kira:port"` shows up.
 */

export interface MessagePortLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  start(): void;
  /** Typed `any` rather than a narrow `{ data: unknown }` shape so the real DOM `MessagePort`
   *  (whose `onmessage` setter takes a full `MessageEvent`) stays structurally assignable to
   *  this interface — function *properties* (unlike method shorthand) are checked
   *  contravariantly on their parameter, and `{ data: unknown }` is not a `MessageEvent`. */
  // biome-ignore lint/suspicious/noExplicitAny: the real DOM MessagePort's onmessage setter takes a full MessageEvent, which this property's parameter must accept contravariantly.
  onmessage: ((event: any) => void) | null;
}

export interface IpcPortEvent {
  readonly ports: readonly MessagePortLike[];
}

export interface IpcRendererApi {
  on(channel: "kira:port", listener: (event: IpcPortEvent) => void): void;
}

export interface ContextBridgeApi {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

export interface KiraBridge {
  onPort(cb: () => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  onMessage(cb: (message: unknown) => void): () => void;
}

/** Builds the `kiraBridge` object and exposes it via `contextBridge.exposeInMainWorld` —
 *  returned too, purely so a test can drive it directly instead of reaching through the fake
 *  `contextBridge`'s captured call. */
export function installKiraBridge(
  ipcRenderer: IpcRendererApi,
  contextBridge: ContextBridgeApi,
): KiraBridge {
  let port: MessagePortLike | undefined;
  const pendingOutgoing: Array<{ message: unknown; transfer: readonly Transferable[] }> = [];
  const messageHandlers = new Set<(message: unknown) => void>();
  const portReadyListeners = new Set<() => void>();

  function attachPort(received: MessagePortLike): void {
    port = received;
    port.onmessage = (event): void => {
      for (const handler of messageHandlers) handler(event.data);
    };
    port.start();
    for (const pending of pendingOutgoing.splice(0)) {
      port.postMessage(pending.message, pending.transfer);
    }
    for (const listener of portReadyListeners) listener();
  }

  ipcRenderer.on("kira:port", (event) => {
    const [received] = event.ports;
    if (received) attachPort(received);
  });

  const bridge: KiraBridge = {
    onPort(cb: () => void): void {
      if (port) cb();
      else portReadyListeners.add(cb);
    },
    postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
      if (port) port.postMessage(message, transfer);
      else pendingOutgoing.push({ message, transfer });
    },
    onMessage(cb: (message: unknown) => void): () => void {
      messageHandlers.add(cb);
      return () => messageHandlers.delete(cb);
    },
  };

  contextBridge.exposeInMainWorld("kiraBridge", bridge);
  return bridge;
}
