import { useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useAutomationsModule } from '../module';

// Server state for the schedule editor and rows. Keys are flat [domain, ...ids] tuples.

/** Upcoming fire instants (unix ms) of a cron; an invalid cron or zone is the query's error. */
export function useNextFires(
  cron: MaybeRefOrGetter<string>,
  timezone: MaybeRefOrGetter<string>,
  count: number,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { runs } = useAutomationsModule();
  return useQuery(
    {
      queryKey: computed(() => [
        'scriptRuns',
        'nextFires',
        toValue(cron),
        toValue(timezone),
        count,
      ]),
      queryFn: () => runs.nextFires(toValue(cron), toValue(timezone), count),
      enabled: computed(() => toValue(enabled) && toValue(cron).trim() !== ''),
      retry: false,
      staleTime: 0,
      // Re-ask just after the first instant passes, so a row's `next` moves on by itself.
      refetchInterval: (q) => {
        const next = q.state.data?.[0];
        return next === undefined ? false : Math.max(1000, next - Date.now() + 1000);
      },
    },
    queryClient,
  );
}
