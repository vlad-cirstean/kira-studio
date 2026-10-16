/**
 * P107 I2-27: `deferred`/`sleep` (or a `tick(ms)` alias of the same body) were hand-rolled in
 * every file that needed to settle a fake request from outside its own call, or wait out a real
 * timer (a debounce, a `setTimeout`-based retry) before asserting.
 */

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/** A promise plus its own external `resolve`/`reject` — the "make a promise I can settle from
 *  outside" seam every async race/ordering test in this repo's unit and state-test suites needs.
 *  A caller that never rejects simply never calls `.reject`. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A real `setTimeout` wait — `ms` defaults to `0` for "let one macrotask pass" (a fire-and-forget
 *  call settle, a pending microtask chain drain) and takes a real duration for a debounce/retry
 *  timer a test needs to actually elapse. */
export function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
