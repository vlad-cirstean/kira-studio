import { TransportError } from '@kira/git-ipc';

export type LatestRequestOutcome<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'stale' }
  | { readonly status: 'error'; readonly message: string };

/**
 * "One request in flight, latest wins" — `DetailState`/`WorkingDetailState`'s shared sequencing:
 * a new `run()` aborts whatever is still in flight before starting. Aborting alone is not enough
 * (an abort racing a resolution can still resolve, and nothing here guarantees every state change
 * that should invalidate a request also calls `run()` again) — `isStillCurrent` re-checked right
 * before a response is committed is the caller's own identity check (e.g. "is this still the
 * selected sha, for this repo"), same as before consolidation. `abort()` is exposed separately
 * for the "cancel with nothing new to show" case (closing the pane, disposing the state) where no
 * replacement request follows.
 */
export function createLatestRequest<T>(): {
  run(
    request: (signal: AbortSignal) => Promise<T>,
    isStillCurrent: () => boolean,
  ): Promise<LatestRequestOutcome<T>>;
  abort(): void;
} {
  let controller: AbortController | undefined;

  return {
    async run(request, isStillCurrent) {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      try {
        const value = await request(own.signal);
        if (controller !== own || !isStillCurrent()) return { status: 'stale' };
        return { status: 'ok', value };
      } catch (error) {
        if (error instanceof TransportError && error.code === 'cancelled')
          return { status: 'stale' };
        if (controller !== own || !isStillCurrent()) return { status: 'stale' };
        return { status: 'error', message: error instanceof Error ? error.message : String(error) };
      } finally {
        if (controller === own) controller = undefined;
      }
    },
    abort(): void {
      controller?.abort();
    },
  };
}

export type LatestRequest<T> = ReturnType<typeof createLatestRequest<T>>;

/**
 * P107 I2-22: `reviewFiles.ts`'s `#loadFiles`/`#loadDiff` and `reviewComments.ts`'s `#load` each
 * repeated the same frame around their own ad-hoc `AbortController` field — abort previous, new
 * controller, `loading = true`, request, apply-or-set-error, `finally` reset — instead of using
 * `latest` here. `setLoading` mirrors the original `finally` exactly: only the run that is still
 * current when it settles gets to flip loading back off, so a superseded run's late `finally`
 * never clobbers the loading flag a newer run already set.
 */
export async function runLatest<T>(
  latest: LatestRequest<T>,
  opts: {
    request: (signal: AbortSignal) => Promise<T>;
    stillCurrent: () => boolean;
    onResult: (value: T) => void;
    onError: (message: string) => void;
    setLoading?: (loading: boolean) => void;
  },
): Promise<void> {
  opts.setLoading?.(true);
  try {
    const outcome = await latest.run(opts.request, opts.stillCurrent);
    if (outcome.status === 'ok') opts.onResult(outcome.value);
    else if (outcome.status === 'error') opts.onError(outcome.message);
  } finally {
    if (opts.stillCurrent()) opts.setLoading?.(false);
  }
}
