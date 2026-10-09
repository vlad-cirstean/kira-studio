import type { ScriptRun } from '@shared/domain/scriptRuns';
import type { ScriptDir } from '@shared/domain/scripts';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useAutomationsModule } from '../module';

// P242: server state for Automations runs. Keys are flat [domain, ...ids] tuples.
const RUNS_KEY = ['scriptRuns', 'list'] as const;
const LIST_LIMIT = 200;

function upsert(runs: readonly ScriptRun[], run: ScriptRun): ScriptRun[] {
  const rest = runs.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => b.createdAt - a.createdAt);
}

/** The run list, kept live by the push channel: each event replaces its run in the cache. */
export function useScriptRuns() {
  const { runs } = useAutomationsModule();
  const off = runs.onChanged((run) => {
    queryClient.setQueryData<ScriptRun[]>(RUNS_KEY, (old) => upsert(old ?? [], run));
  });
  tryOnScopeDispose(off);
  return useQuery(
    {
      queryKey: RUNS_KEY,
      queryFn: () => runs.list(LIST_LIMIT),
      staleTime: Number.POSITIVE_INFINITY,
    },
    queryClient,
  );
}

/** The run a terminal tab belongs to; the tab id is the terminal id. */
export function useScriptRunByTerminal(terminalId: MaybeRefOrGetter<string>) {
  const query = useScriptRuns();
  const run = computed(
    () => query.data.value?.find((r) => r.terminalId === toValue(terminalId)) ?? null,
  );
  return run;
}

export function useStopScriptRun() {
  const { runs } = useAutomationsModule();
  return useMutation(
    { mutationKey: ['scriptRuns', 'stop'], mutationFn: (id: string) => runs.stop(id) },
    queryClient,
  );
}

export function useResolveDir() {
  const { runs } = useAutomationsModule();
  return (scriptId: string): Promise<ScriptDir> => runs.resolveDir(scriptId);
}
