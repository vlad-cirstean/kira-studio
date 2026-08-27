import type { OpCtx } from './adapter';
import { AdapterError } from './errors';

// P48 F22: the abort/settle race the two callback-style drivers (pg, mariadb) each wrote out
// three times — a `settled` latch, an abort listener that rejects E_CANCELLED, and a
// then/catch pair that removes the listener, releases the query tracker, and resolves or maps
// the error. Every other adapter uses AbortSignal natively, so this stays a two-driver helper.
// `start()` is the driver call; `release` is the query tracker's own release, run on every exit;
// `mapError` is the calling adapter's own. Resolves the driver's raw result — each caller does
// its own narrowing at the call site, the same as before this helper existed.
export function withAbortRace<T>(
  ctx: OpCtx,
  start: () => Promise<T>,
  opts: { release?: () => void; mapError: (err: unknown) => unknown },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      opts.release?.();
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    start()
      .then((result) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        opts.release?.();
        resolve(result);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        opts.release?.();
        reject(opts.mapError(err));
      });
  });
}
