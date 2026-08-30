/**
 * A controllable stand-in for the `JSONSocket` `JSONStream("engine")` returns
 * (`@wailsio/runtime`'s `stream.ts`), used directly here by `bridge-port.spec.ts` and reused
 * (P57 §5.4: "shared, not duplicated") by `tests/ui/support/mockStream.ts`'s
 * `window._wails.streamFactory` injection once that milestone lands. Deliberately dependency-free
 * — no imports beyond built-ins — so it can be inlined into a Playwright `addInitScript` body
 * exactly as `tests/ipc/support/mockPort.ts`'s `page.evaluate` closures already have to be.
 *
 * Mirrors the real socket's three states relevant to `port.ts`: CONNECTING at construction (no
 * `send` yet observed by the caller — this fake simply queues nothing and lets the test decide
 * when to fire `open`), OPEN once `__open()` is called, CLOSED once `__close()` is called. It does
 * not model the real socket's throw-on-CONNECTING / drop-after-CLOSED `send()` behaviour (P57
 * §1.2) because `port.ts` itself is what guards against ever calling `send` in those states —
 * this fake exists to drive `port.ts`'s state machine, not to re-verify the runtime's.
 */
export interface FakeSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(value: unknown): void;
  close(): void;
  /** Every value passed to `send`, in order — what the test asserts requests against. */
  sent: unknown[];
  /** Test control: moves to OPEN and fires `onopen`. */
  __open(): void;
  /** Test control: delivers a decoded frame as if it arrived from Go. */
  __message(data: unknown): void;
  /** Test control: moves to CLOSED and fires `onclose`. */
  __close(): void;
}

export function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 0, // CONNECTING
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    sent: [],
    send(value: unknown) {
      socket.sent.push(value);
    },
    close() {
      socket.__close();
    },
    __open() {
      socket.readyState = 1; // OPEN
      socket.onopen?.();
    },
    __message(data: unknown) {
      socket.onmessage?.({ data });
    },
    __close() {
      socket.readyState = 3; // CLOSED
      socket.onclose?.();
    },
  };
  return socket;
}
