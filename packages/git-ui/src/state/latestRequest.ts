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
