/**
 * A controllable stand-in for the `JSONSocket` `JSONStream("engine")` returns
 * (`@wailsio/runtime`'s `stream.js`), used directly here by `bridge-port.spec.ts` and reused
 * (P57 §5.4: "shared, not duplicated") by `tests/ui/support/mockStream.ts`'s
 * `window._wails.streamFactory` injection. Deliberately dependency-free — no imports beyond
 * built-ins — so it can be inlined into a Playwright `addInitScript` body exactly as
 * `tests/ipc/support/mockPort.ts`'s `page.evaluate` closures already have to be.
 *
 * A real `EventTarget`, not a plain object with bare `on*` fields: here in `tests/unit/`, port.ts
 * never reaches the real `JSONStream` at all (`wailsRuntime.ts` mocks the whole module), so a bare
 * object would be enough — but `tests/ui/support/mockStream.ts` hands this same factory's socket
 * to the *real* `@wailsio/runtime`'s `JSONStream`, whose non-`WailsSocket` branch immediately does
 * `native.addEventListener.bind(native)` and later redefines `onmessage` itself via
 * `Object.defineProperty` (stream.js's own JSONStream — the "native WebSocket" path, taken for
 * anything that isn't `instanceof WailsSocket`). A plain `{onopen: null, ...}` object throws there
 * (`addEventListener is not a function`) the moment `JSONStream` wraps it — this class exists so
 * one fake satisfies both call sites, mirroring the real `WailsSocket`'s own
 * `defineHandlerProperty` pattern (a getter/setter that also threads through `addEventListener`)
 * for `onopen`/`onmessage`/`onclose`/`onerror`.
 *
 * Mirrors the real socket's three states relevant to `port.ts`: CONNECTING at construction (no
 * `send` yet observed by the caller — this fake simply queues nothing and lets the test decide
 * when to fire `open`), OPEN once `__open()` is called, CLOSED once `__close()` is called. It does
 * not model the real socket's throw-on-CONNECTING / drop-after-CLOSED `send()` behaviour (P57
 * §1.2) because `port.ts` itself is what guards against ever calling `send` in those states —
 * this fake exists to drive `port.ts`'s state machine, not to re-verify the runtime's.
 */
export interface FakeSocket extends EventTarget {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(value: unknown): void;
  close(): void;
  /** Every value passed to `send`, in order — what the test asserts requests against. Under the
   *  real `JSONStream` (tests/ui/), this is the already-stringified JSON frame (`stream.js` wraps
   *  `send` before this socket ever sees it); under `tests/unit/`'s fully-mocked `JSONStream`
   *  (`wailsRuntime.ts`), it is the raw request object port.ts passed in. */
  sent: unknown[];
  /** Test control: moves to OPEN and fires `onopen`. */
  __open(): void;
  /** Test control: delivers a decoded frame as if it arrived from Go. */
  __message(data: unknown): void;
  /** Test control: moves to CLOSED and fires `onclose`. */
  __close(): void;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

// Mirrors stream.js's own `defineHandlerProperty`: an `on<type>` accessor that registers through
// `addEventListener` rather than holding a bare field, so a listener attached either way (direct
// assignment, as port.ts does; `addEventListener`, as the real JSONStream's wrapping does) is
// visible through both.
function defineHandlerProperty(target: EventTarget, type: string): void {
  let current: EventListener | null = null;
  Object.defineProperty(target, `on${type}`, {
    get: () => current,
    set(fn: unknown) {
      if (current) target.removeEventListener(type, current);
      current = typeof fn === 'function' ? (fn as EventListener) : null;
      if (current) target.addEventListener(type, current);
    },
    configurable: true,
    enumerable: true,
  });
}

class FakeSocketImpl extends EventTarget {
  readyState = CONNECTING;
  sent: unknown[] = [];
  declare onopen: (() => void) | null;
  declare onmessage: ((ev: MessageEvent) => void) | null;
  declare onclose: (() => void) | null;
  declare onerror: (() => void) | null;

  constructor() {
    super();
    for (const type of ['open', 'message', 'close', 'error']) {
      defineHandlerProperty(this, type);
    }
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(): void {
    this.__close();
  }

  __open(): void {
    this.readyState = OPEN;
    this.dispatchEvent(new Event('open'));
  }

  __message(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  __close(): void {
    this.readyState = CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

export function createFakeSocket(): FakeSocket {
  return new FakeSocketImpl() as unknown as FakeSocket;
}
