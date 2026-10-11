import type { QueryClient, QueryKey } from '@tanstack/vue-query';

interface OptimisticContext<TData> {
  prev: TData | undefined;
}

/**
 * The cancel, snapshot, patch, roll back, invalidate block of an optimistic mutation. Spread the
 * result into `useMutation`: `onMutate` patches the cached value at `key` with `patch(prev, vars)`;
 * `onError` restores the snapshot and invalidates `key`. With `invalidate: 'settled'` the key is
 * invalidated after success too (a client with no push channel); the default relies on the push
 * that already invalidates the key.
 */
export function optimisticUpdate<TData, TVars>(
  qc: QueryClient,
  key: QueryKey,
  patch: (prev: TData, vars: TVars) => TData,
  opts: { invalidate?: 'error' | 'settled' } = {},
) {
  const restore = (ctx: OptimisticContext<TData> | undefined): void => {
    if (ctx?.prev) qc.setQueryData<TData>(key, ctx.prev);
  };
  return {
    onMutate: async (vars: TVars): Promise<OptimisticContext<TData>> => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const prev = qc.getQueryData<TData>(key);
      if (prev) qc.setQueryData<TData>(key, patch(prev, vars));
      return { prev };
    },
    onError: (_err: unknown, _vars: TVars, ctx: OptimisticContext<TData> | undefined): void => {
      restore(ctx);
      void qc.invalidateQueries({ queryKey: key, exact: true });
    },
    onSettled: (): void => {
      if (opts.invalidate === 'settled') void qc.invalidateQueries({ queryKey: key, exact: true });
    },
  };
}
