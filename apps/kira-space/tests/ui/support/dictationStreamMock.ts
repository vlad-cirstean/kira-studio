import type { Page } from '@playwright/test';

// P216: a stand-in for the `dictation` Wails stream (window._wails.streamFactory), like
// gitStreamMock.ts is for `git`. It records every client frame and lets a spec push server frames,
// so the mic button, live insertion and error handling run with no microphone or model.

export interface DictationMockHandle {
  /** Client frames sent so far, parsed (`{ type: 'stop' }`). */
  sent(): Promise<Array<Record<string, unknown>>>;
  /** How many streams the page opened. */
  opened(): Promise<number>;
  /** Delivers a server frame to the newest open stream. */
  emit(frame: Record<string, unknown>): Promise<void>;
  /** Closes the newest stream from the server side, as the real handler does when a session ends. */
  closeFromServer(): Promise<void>;
}

interface MockWindow {
  _wails?: { streamFactory?: (name: string) => unknown };
  __kiraDictation?: {
    sent: string[];
    sockets: MockSocket[];
  };
}

interface MockSocket {
  binaryType: string;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

function installInBrowser(): void {
  const w = window as unknown as MockWindow;
  w._wails = w._wails ?? {};
  const wails = w._wails;
  const existing = wails.streamFactory;
  const state = { sent: [] as string[], sockets: [] as MockSocket[] };
  w.__kiraDictation = state;

  wails.streamFactory = (name: string) => {
    if (name !== 'dictation') return existing?.(name);
    const socket: MockSocket = {
      binaryType: 'arraybuffer',
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string) {
        if (socket.readyState === 0) {
          throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
        }
        state.sent.push(data);
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        socket.onclose?.({});
      },
    };
    state.sockets.push(socket);
    setTimeout(() => {
      socket.readyState = 1;
      socket.onopen?.({});
    }, 0);
    return socket;
  };
}

export async function installDictationStreamMock(page: Page): Promise<DictationMockHandle> {
  await page.evaluate(installInBrowser);
  return {
    sent: () =>
      page.evaluate(() =>
        ((window as unknown as MockWindow).__kiraDictation?.sent ?? []).map(
          (s) => JSON.parse(s) as Record<string, unknown>,
        ),
      ),
    opened: () =>
      page.evaluate(() => (window as unknown as MockWindow).__kiraDictation?.sockets.length ?? 0),
    emit: (frame) =>
      page.evaluate((f) => {
        const sockets = (window as unknown as MockWindow).__kiraDictation?.sockets ?? [];
        const socket = sockets[sockets.length - 1];
        const bytes = new TextEncoder().encode(JSON.stringify(f));
        socket?.onmessage?.({ data: bytes.buffer });
      }, frame),
    closeFromServer: () =>
      page.evaluate(() => {
        const sockets = (window as unknown as MockWindow).__kiraDictation?.sockets ?? [];
        sockets[sockets.length - 1]?.close();
      }),
  };
}
