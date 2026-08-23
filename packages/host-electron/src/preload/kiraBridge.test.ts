import { describe, expect, test } from "bun:test";
import {
  type ContextBridgeApi,
  type IpcPortEvent,
  type IpcRendererApi,
  installKiraBridge,
  type KiraBridge,
  type MessagePortLike,
} from "./kiraBridge.ts";

class FakeMessagePort implements MessagePortLike {
  posted: Array<{ message: unknown; transfer: readonly Transferable[] | undefined }> = [];
  started = false;
  // biome-ignore lint/suspicious/noExplicitAny: matches MessagePortLike's own onmessage type.
  onmessage: ((event: any) => void) | null = null;

  postMessage(message: unknown, transfer?: readonly Transferable[]): void {
    this.posted.push({ message, transfer });
  }

  start(): void {
    this.started = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeIpcRenderer implements IpcRendererApi {
  #listener: ((event: IpcPortEvent) => void) | undefined;

  on(_channel: "kira:port", listener: (event: IpcPortEvent) => void): void {
    this.#listener = listener;
  }

  deliverPort(port: MessagePortLike): void {
    this.#listener?.({ ports: [port] });
  }
}

class FakeContextBridge implements ContextBridgeApi {
  exposed = new Map<string, unknown>();

  exposeInMainWorld(apiKey: string, api: unknown): void {
    this.exposed.set(apiKey, api);
  }
}

describe("installKiraBridge", () => {
  test("exposes exactly the kiraBridge object under contextBridge", () => {
    const contextBridge = new FakeContextBridge();
    const bridge = installKiraBridge(new FakeIpcRenderer(), contextBridge);

    expect(contextBridge.exposed.get("kiraBridge")).toBe(bridge);
    expect(contextBridge.exposed.size).toBe(1);
  });

  test("onPort fires immediately if the port already arrived", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());
    ipcRenderer.deliverPort(new FakeMessagePort());

    let fired = false;
    bridge.onPort(() => {
      fired = true;
    });

    expect(fired).toBe(true);
  });

  test("onPort fires once the port arrives, for a callback registered before it did", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());

    let fired = false;
    bridge.onPort(() => {
      fired = true;
    });
    expect(fired).toBe(false);

    ipcRenderer.deliverPort(new FakeMessagePort());
    expect(fired).toBe(true);
  });

  test("postMessage before the port arrives is buffered and flushed on attach, in order", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge: KiraBridge = installKiraBridge(ipcRenderer, new FakeContextBridge());

    bridge.postMessage("first");
    bridge.postMessage("second");

    const port = new FakeMessagePort();
    ipcRenderer.deliverPort(port);

    expect(port.posted.map((entry) => entry.message)).toEqual(["first", "second"]);
    expect(port.started).toBe(true);
  });

  test("postMessage after the port arrives goes straight to the port", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());
    const port = new FakeMessagePort();
    ipcRenderer.deliverPort(port);

    bridge.postMessage("direct", []);

    expect(port.posted).toEqual([{ message: "direct", transfer: [] }]);
  });

  test("onMessage delivers data arriving on the port, to every subscriber", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());
    const port = new FakeMessagePort();
    ipcRenderer.deliverPort(port);

    const first: unknown[] = [];
    const second: unknown[] = [];
    bridge.onMessage((message) => first.push(message));
    bridge.onMessage((message) => second.push(message));

    port.emit({ hello: "world" });

    expect(first).toEqual([{ hello: "world" }]);
    expect(second).toEqual([{ hello: "world" }]);
  });

  test("the unsubscribe function returned by onMessage stops delivery to that handler only", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());
    const port = new FakeMessagePort();
    ipcRenderer.deliverPort(port);

    const kept: unknown[] = [];
    const removed: unknown[] = [];
    bridge.onMessage((message) => kept.push(message));
    const unsubscribe = bridge.onMessage((message) => removed.push(message));

    unsubscribe();
    port.emit("data");

    expect(kept).toEqual(["data"]);
    expect(removed).toEqual([]);
  });

  test("a second delivered port replaces the first as the active one", () => {
    const ipcRenderer = new FakeIpcRenderer();
    const bridge = installKiraBridge(ipcRenderer, new FakeContextBridge());
    const first = new FakeMessagePort();
    const second = new FakeMessagePort();

    ipcRenderer.deliverPort(first);
    ipcRenderer.deliverPort(second);
    bridge.postMessage("hi");

    expect(first.posted).toEqual([]);
    expect(second.posted).toEqual([{ message: "hi", transfer: [] }]);
  });
});
