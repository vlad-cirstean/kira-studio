import { join } from 'node:path';
import { type MessagePortMain, type UtilityProcess, utilityProcess } from 'electron';
import type { PortEvent, PortRequest, PortResponse } from '../shared/port';
import { log } from './log';

// D2: main↔engine gets a real request/response channel over `child.postMessage` with correlation
// ids and timeouts, plus an event stream (op:start / op:end / connection:state). The renderer↔
// engine MessagePort still carries only `ping` in P1.

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

interface PendingCall {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class EngineDownError extends Error {
  readonly code = 'E_ENGINE_DOWN';
  constructor() {
    super('engine process exited');
    this.name = 'EngineDownError';
  }
}

export interface EngineHost {
  status(): { alive: boolean; pid: number | null };
  attachRendererPort(port: MessagePortMain, generation: number): void;
  call<T>(op: string, payload: unknown, timeoutMs?: number): Promise<T>;
  on(event: string, handler: (payload: unknown) => void): () => void;
  onExit(handler: (code: number | null) => void): () => void;
  stop(): void;
}

export function startEngine(): EngineHost {
  let alive = true;
  let nextId = 1;
  const pending = new Map<number, PendingCall>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  const exitHandlers = new Set<(code: number | null) => void>();

  const child: UtilityProcess = utilityProcess.fork(join(__dirname, 'engine.js'), [], {
    serviceName: 'kira-engine',
    stdio: 'pipe',
    execArgv: ['--max-old-space-size=512'],
  });

  child.stdout?.on('data', (chunk: Buffer) => log('info', 'engine', chunk.toString().trimEnd()));
  child.stderr?.on('data', (chunk: Buffer) => log('error', 'engine', chunk.toString().trimEnd()));

  child.on('message', (frame) => {
    const data = frame as { kind: string; id?: number; ok?: boolean; topic?: string };
    if (data.kind === 'res') {
      const id = data.id ?? -1;
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      clearTimeout(call.timer);
      const res = data as unknown as PortResponse;
      if (res.ok) call.resolve(res.payload);
      else call.reject(toError(res.error));
    } else if (data.kind === 'evt') {
      const evt = data as unknown as PortEvent;
      const handlers = eventHandlers.get(evt.topic);
      if (handlers) for (const handler of handlers) handler(evt.payload);
    }
  });

  child.on('exit', (code) => {
    alive = false;
    log('warn', 'engine-host', `engine exited with code ${code}`);
    // Reject every in-flight call so the UI fails loudly instead of hanging forever.
    for (const [id, call] of pending) {
      pending.delete(id);
      clearTimeout(call.timer);
      call.reject(new EngineDownError());
    }
    for (const handler of exitHandlers) handler(code);
  });

  return {
    status: () => ({ alive, pid: alive ? (child.pid ?? null) : null }),
    attachRendererPort(port, generation) {
      child.postMessage({ kind: 'attach-port', generation }, [port]);
    },
    call<T>(op: string, payload: unknown, timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS) {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`engine call "${op}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: resolve as (payload: unknown) => void,
          reject,
          timer,
        });
        const req: PortRequest = { kind: 'req', id, op, payload };
        child.postMessage(req);
      });
    },
    on(event, handler) {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    onExit(handler) {
      exitHandlers.add(handler);
      return () => {
        exitHandlers.delete(handler);
      };
    },
    stop() {
      if (alive) child.kill();
    },
  };
}

function toError(error: { message: string; code?: string }): Error & { code?: string } {
  const err = new Error(error.message) as Error & { code?: string };
  if (error.code) err.code = error.code;
  return err;
}
