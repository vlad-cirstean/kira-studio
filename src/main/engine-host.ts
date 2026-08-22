import { join } from 'node:path';
import { type MessagePortMain, type UtilityProcess, utilityProcess } from 'electron';
import type { PortEvent, PortRequest, PortResponse } from '../shared/port';
import { log } from './log';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface EngineHost {
  status(): { alive: boolean; pid: number | null };
  attachRendererPort(port: MessagePortMain, generation: number): void;
  call<T>(op: string, payload: unknown, timeoutMs?: number): Promise<T>;
  on(event: string, handler: (payload: unknown) => void): () => void;
  stop(): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class EngineHostError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EngineHostError';
  }
}

export function startEngine(): EngineHost {
  let alive = true;
  let nextId = 1;
  const pending = new Map<number, PendingCall>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  const child: UtilityProcess = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
    serviceName: 'kira-engine',
    stdio: 'pipe',
    execArgv: ['--max-old-space-size=512'],
  });

  child.stdout?.on('data', (chunk: Buffer) => log('info', 'engine', chunk.toString().trimEnd()));
  child.stderr?.on('data', (chunk: Buffer) => log('error', 'engine', chunk.toString().trimEnd()));

  child.on('message', (message: PortResponse | PortEvent) => {
    if (message.kind === 'res') {
      const req = pending.get(message.id);
      if (!req) return;
      pending.delete(message.id);
      clearTimeout(req.timer);
      if (message.ok) {
        req.resolve(message.payload);
      } else {
        req.reject(new EngineHostError(message.error.message, message.error.code ?? 'E_QUERY'));
      }
      return;
    }
    if (message.kind === 'evt') {
      for (const handler of eventHandlers.get(message.topic) ?? []) handler(message.payload);
    }
  });

  child.on('exit', (code) => {
    alive = false;
    log('warn', 'engine-host', `engine exited with code ${code}`);
    // On engine exit, reject every pending call and let main/connections.ts (subscribed via
    // `on('engine:down', ...)`) synthesise error states for every connection it believes is
    // live — without this the tree hangs forever on a crashed engine. No auto-respawn (§13.2
    // of the P1 plan): the user reconnects manually.
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      req.reject(new EngineHostError('engine process exited', 'E_ENGINE_DOWN'));
      pending.delete(id);
    }
    for (const handler of eventHandlers.get('engine:down') ?? []) handler({});
  });

  return {
    status: () => ({ alive, pid: alive ? (child.pid ?? null) : null }),
    attachRendererPort(port, generation) {
      child.postMessage({ kind: 'attach-port', generation }, [port]);
    },
    call<T>(op: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
      if (!alive) {
        return Promise.reject(
          new EngineHostError('engine process is not running', 'E_ENGINE_DOWN'),
        );
      }
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new EngineHostError(`engine call "${op}" timed out`, 'E_TIMEOUT'));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        const req: PortRequest = { kind: 'req', id, op, payload };
        child.postMessage(req);
      });
    },
    on(event, handler) {
      let handlers = eventHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(event, handlers);
      }
      handlers.add(handler);
      return () => handlers?.delete(handler);
    },
    stop() {
      if (alive) child.kill();
    },
  };
}
