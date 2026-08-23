import { describe, expect, test } from "bun:test";
import { createMainChannel } from "./channel.ts";

/**
 * `createMainChannel` only ever calls `on("message", ...)` / `off("message", ...)` /
 * `postMessage` / `start` / `close` on the port it's given — this fake covers exactly that
 * surface, structurally matching `Electron.MessagePortMain` without ever importing `electron`
 * (banned in `*.test.ts`, B1). `createMainChannel`'s own parameter type is the ambient
 * `Electron.MessagePortMain` type, which is only checked at compile time, so a structurally
 * compatible plain object satisfies it at the type level too.
 */
class FakePort {
  started = false;
  closed = false;
  posted: unknown[] = [];
  readonly #listeners = new Set<(event: { data: unknown }) => void>();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  on(_event: "message", listener: (event: { data: unknown }) => void): void {
    this.#listeners.add(listener);
  }

  off(_event: "message", listener: (event: { data: unknown }) => void): void {
    this.#listeners.delete(listener);
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    for (const listener of this.#listeners) listener({ data });
  }
}

describe("createMainChannel", () => {
  test("post forwards the message to the port with no transfer list", () => {
    const port = new FakePort();
    const channel = createMainChannel(port as never);

    channel.post({ kind: "request" });

    expect(port.posted).toEqual([{ kind: "request" }]);
  });

  test("onMessage starts the port on first subscription, not again on a second", () => {
    const port = new FakePort();
    const channel = createMainChannel(port as never);

    channel.onMessage(() => {});
    expect(port.started).toBe(true);
    port.started = false;

    channel.onMessage(() => {});
    expect(port.started).toBe(false);
  });

  test("onMessage delivers the event's data to the handler", () => {
    const port = new FakePort();
    const channel = createMainChannel(port as never);
    const received: unknown[] = [];

    channel.onMessage((message) => received.push(message));
    port.emit({ hello: "world" });

    expect(received).toEqual([{ hello: "world" }]);
  });

  test("the unsubscribe function returned by onMessage stops delivery", () => {
    const port = new FakePort();
    const channel = createMainChannel(port as never);
    const received: unknown[] = [];

    const unsubscribe = channel.onMessage((message) => received.push(message));
    unsubscribe();
    port.emit("ignored");

    expect(received).toEqual([]);
  });

  test("close closes the port", () => {
    const port = new FakePort();
    const channel = createMainChannel(port as never);

    channel.close();

    expect(port.closed).toBe(true);
  });
});
