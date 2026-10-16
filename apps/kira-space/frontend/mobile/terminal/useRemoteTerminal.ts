import { type MessageKey, t } from '@theme/i18n';
import { useTimeoutFn, useWebSocket } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { readonly, ref } from 'vue';

// Close codes the server sends when it ends a hold on purpose; the phone must not reconnect.
const END_REASON: Record<number, MessageKey> = {
  4000: 'mobile.terminal.end.released.description',
  4001: 'mobile.terminal.end.tookBack.description',
  4002: 'mobile.terminal.end.otherConnection.description',
  4003: 'mobile.terminal.end.sessionEnded.description',
  4004: 'mobile.terminal.end.timedOut.description',
  4005: 'mobile.terminal.end.accessOff.description',
};

export type RemoteStatus = 'connecting' | 'live' | 'reconnecting' | 'ended';

interface ControlFrame {
  type: string;
  offset?: number;
  reset?: boolean;
}

interface Handlers {
  size(): { cols: number; rows: number };
  write(bytes: Uint8Array): void;
  /** The server restarted the stream from `offset`: clear the screen first. */
  reset(): void;
}

const encoder = new TextEncoder();

/** One phone terminal socket: ordered binary frames both ways, resume from the last byte seen. */
export function useRemoteTerminal(sessionId: string, handlers: Handlers) {
  const status = ref<RemoteStatus>('connecting');
  const endReason = ref('');
  const notice = ref('');
  let offset = 0;
  let known = false;
  const hideNotice = useTimeoutFn(
    () => {
      notice.value = '';
    },
    TIMING.copiedFeedback,
    { immediate: false },
  );

  // A getter, not a computed: every reconnect must read the latest offset.
  const url = () => {
    const { cols, rows } = handlers.size();
    const query = new URLSearchParams({ cols: String(cols), rows: String(rows) });
    if (known) query.set('from', String(offset));
    return `ws://${location.host}/api/agent/sessions/${encodeURIComponent(sessionId)}/terminal?${query}`;
  };

  const socket = useWebSocket(url, {
    immediate: false,
    autoConnect: false,
    autoReconnect: {
      retries: 10,
      delay: (n) => Math.min(500 * 2 ** (n - 1), 8000),
      onFailed: () => {
        status.value = 'ended';
        endReason.value = t('mobile.terminal.end.unreachable.error');
      },
    },
    heartbeat: false,
    onConnected: (ws) => {
      ws.binaryType = 'arraybuffer';
      status.value = 'live';
    },
    onDisconnected: (_ws, ev) => {
      const reason = END_REASON[ev.code];
      if (reason) {
        endReason.value = t(reason);
        status.value = 'ended';
        socket.close();
      } else if (status.value !== 'ended') {
        status.value = 'reconnecting';
      }
    },
    onMessage: (_ws, ev) => {
      if (typeof ev.data !== 'string') {
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        offset += bytes.length;
        handlers.write(bytes);
        return;
      }
      let frame: ControlFrame;
      try {
        frame = JSON.parse(ev.data) as ControlFrame;
      } catch {
        return;
      }
      if (frame.type === 'hello' || frame.type === 'reset') {
        if (frame.type === 'reset' || frame.reset || !known) handlers.reset();
        offset = frame.offset ?? 0;
        known = true;
      } else if (frame.type === 'throttled') {
        notice.value = t('mobile.terminal.throttled.hint');
        hideNotice.start();
      }
    },
  });

  function connect(): void {
    status.value = 'connecting';
    endReason.value = '';
    socket.open();
  }

  /** Input is dropped while offline: replaying stale keystrokes after a reconnect is unsafe. */
  function sendInput(bytes: Uint8Array): void {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    socket.send(copy as ArrayBuffer, false);
  }

  function sendText(text: string): void {
    sendInput(encoder.encode(text));
  }

  function sendResize(cols: number, rows: number): void {
    socket.send(JSON.stringify({ type: 'resize', cols, rows }), false);
  }

  /** Tells the server the phone is done so the computer gets the terminal back at once. */
  function release(): void {
    if (status.value === 'live') socket.send(JSON.stringify({ type: 'release' }), false);
    socket.close();
  }

  return {
    status: readonly(status),
    endReason: readonly(endReason),
    notice: readonly(notice),
    connect,
    sendInput,
    sendText,
    sendResize,
    release,
  };
}
