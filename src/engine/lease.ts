import { randomUUID } from 'node:crypto';
import { AdapterError } from './adapters/errors';

// Exclusive physical-connection leasing (P2 D11). Adapters can run several ops concurrently on one
// connection (read + prefetch + count), and both cancel mechanisms (`pg_cancel_backend`,
// `KILL QUERY`) target whatever the backend is CURRENTLY running — so concurrent ops on a shared
// client could cancel the wrong statement. Leases make that impossible: an op holds an exclusive
// connection whose backend pid/threadId is known and recorded against the opId. FIFO waiters; an
// `acquire` that is aborted while queued rejects with E_CANCELLED (the "dropped locally" case of
// D11 — the op never reached the server, so reporting success to the user is correct).

export interface Lease<T> {
  value: T;
  id: string;
  release(): void;
}

interface Waiter<T> {
  signal?: AbortSignal;
  resolve: (lease: Lease<T>) => void;
  reject: (err: Error) => void;
}

export class LeasePool<T> {
  private idle: T[] = [];
  private waiters: Array<Waiter<T>> = [];
  private live = 0;
  private closed = false;

  constructor(
    private readonly opts: {
      max: number;
      open: () => Promise<T>;
      close: (v: T) => Promise<void>;
    },
  ) {}

  acquire(signal?: AbortSignal): Promise<Lease<T>> {
    if (this.closed) return Promise.reject(new AdapterError('E_DISCONNECTED', 'connection closed'));
    const idle = this.idle.pop();
    if (idle !== undefined) return Promise.resolve(this.wrap(idle));

    if (this.live < this.opts.max) {
      this.live += 1;
      return this.opts.open().then(
        (value) => this.wrap(value),
        (err) => {
          this.live -= 1;
          throw err;
        },
      );
    }

    return new Promise<Lease<T>>((resolve, reject) => {
      const waiter: Waiter<T> = { signal, resolve, reject };
      if (signal) {
        if (signal.aborted) {
          reject(new AdapterError('E_CANCELLED', 'cancelled'));
          return;
        }
        signal.addEventListener('abort', () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            waiter.reject(new AdapterError('E_CANCELLED', 'cancelled'));
          }
        }, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private wrap(value: T): Lease<T> {
    return {
      value,
      id: randomUUID(),
      release: () => {
        if (this.closed) {
          void this.opts.close(value).catch(() => {});
          return;
        }
        const next = this.waiters.shift();
        if (next) {
          next.resolve(this.wrap(value));
          return;
        }
        this.idle.push(value);
      },
    };
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const err = new AdapterError('E_DISCONNECTED', 'connection closed');
    for (const waiter of this.waiters) waiter.reject(err);
    this.waiters.length = 0;
    const all = this.idle;
    this.idle = [];
    await Promise.all(all.map((v) => this.opts.close(v).catch(() => {})));
  }
}
