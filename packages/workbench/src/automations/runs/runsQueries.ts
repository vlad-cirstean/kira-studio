import type { ScriptRun, ScriptRunLogChunk, ScriptRunLogPage } from '@shared/domain/scriptRuns';
import type { ScriptDir } from '@shared/domain/scripts';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { compareNatural } from '@workbench/behaviour/match';
import { usePersistedState } from '@workbench/behaviour/persisted';
import { queryClient } from '@workbench/state/queryClient';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useAutomationsModule } from '../module';
import { keyOf, useScriptTabs } from '../scriptTabs';
import { mirrorRuns } from './runStates';

// P242: server state for Automations runs. Keys are flat [domain, ...ids] tuples.
const RUNS_KEY = ['scriptRuns', 'list'] as const;
const LIST_LIMIT = 200;

function upsert(runs: readonly ScriptRun[], run: ScriptRun): ScriptRun[] {
  const rest = runs.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => b.createdAt - a.createdAt || compareNatural(a.id, b.id));
}

let feeds = 0;
let stopFeed: (() => void) | null = null;

/** One push subscription shared by every live run list in the window. */
function useRunsFeed(): void {
  const { runs } = useAutomationsModule();
  if (feeds++ === 0) {
    stopFeed = runs.onChanged((run) => {
      mirrorRuns([run]);
      queryClient.setQueryData<ScriptRun[]>(RUNS_KEY, (old) => upsert(old ?? [], run));
    });
  }
  tryOnScopeDispose(() => {
    if (--feeds === 0) {
      stopFeed?.();
      stopFeed = null;
    }
  });
}

/** The run list, kept live by the push channel: each event replaces its run in the cache. */
export function useScriptRuns() {
  const { runs } = useAutomationsModule();
  useRunsFeed();
  return useQuery(
    {
      queryKey: RUNS_KEY,
      queryFn: async () => {
        const list = await runs.list(LIST_LIMIT);
        mirrorRuns(list);
        return list;
      },
    },
    queryClient,
  );
}

/** The newest running run of each script. */
export function useLiveRunByScript() {
  const { data } = useScriptRuns();
  return computed(() => {
    const m = new Map<string, ScriptRun>();
    for (const r of data.value ?? [])
      if (r.state === 'running' && !m.has(r.scriptId)) m.set(r.scriptId, r);
    return m;
  });
}

/** The runs of one ADE task, kept live by the same push channel. */
export function useTaskScriptRuns(taskId: MaybeRefOrGetter<string>) {
  const { runs } = useAutomationsModule();
  const key = () => ['scriptRuns', 'task', toValue(taskId)] as const;
  const off = runs.onChanged((run) => {
    if (run.taskId !== toValue(taskId)) return;
    queryClient.setQueryData<ScriptRun[]>(key(), (old) => upsert(old ?? [], run));
  });
  tryOnScopeDispose(off);
  return useQuery(
    {
      queryKey: computed(key),
      queryFn: () => runs.list(LIST_LIMIT, toValue(taskId)),
      enabled: computed(() => toValue(taskId) !== ''),
    },
    queryClient,
  );
}

const SEEN_LIMIT = 200;

/** Run ids the person has opened; an ended run not in it still wants a look. Per-viewer, so local. */
export function useSeenRuns() {
  const seen = usePersistedState<string[]>('kira.automations.seenRuns', []);
  return {
    seen,
    markSeen(id: string): void {
      if (seen.value.includes(id)) return;
      seen.value = [...seen.value, id].slice(-SEEN_LIMIT);
    },
  };
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

/** Resumes an interrupted smart run and opens the new run's tab. */
export function useResumeScriptRun() {
  const { runs } = useAutomationsModule();
  const tabs = useScriptTabs();
  return useMutation(
    {
      mutationKey: ['scriptRuns', 'resume'],
      mutationFn: async (run: ScriptRun) => ({ run, started: await runs.resume(run.id) }),
      onSuccess: ({ run, started }) => {
        if (started.runId)
          tabs.openRun({ ...keyOf(run), runId: started.runId, label: run.scriptName });
      },
    },
    queryClient,
  );
}

export function useResolveDir() {
  const { runs } = useAutomationsModule();
  return (scriptId: string): Promise<ScriptDir> => runs.resolveDir(scriptId);
}

/** One run from the live list. */
export function useScriptRun(id: MaybeRefOrGetter<string>) {
  const query = useScriptRuns();
  return {
    query,
    run: computed(() => query.data.value?.find((r) => r.id === toValue(id)) ?? null),
  };
}

function appendChunks(
  page: ScriptRunLogPage,
  chunks: readonly ScriptRunLogChunk[],
): ScriptRunLogPage {
  const last = page.chunks.at(-1)?.seq ?? -1;
  const fresh = chunks.filter((c) => c.seq > last);
  return fresh.length === 0 ? page : { ...page, chunks: [...page.chunks, ...fresh] };
}

/** A smart run's log: the first page by ReadLog, then pushed chunks appended into the cache. */
export function useRunLog(id: MaybeRefOrGetter<string>) {
  const { runs } = useAutomationsModule();
  const key = () => ['scriptRuns', 'log', toValue(id)] as const;
  const off = runs.onLog((push) => {
    if (push.runId !== toValue(id)) return;
    const old = queryClient.getQueryData<ScriptRunLogPage>(key());
    if (old) queryClient.setQueryData<ScriptRunLogPage>(key(), appendChunks(old, push.chunks));
    else void queryClient.invalidateQueries({ queryKey: key() });
  });
  tryOnScopeDispose(off);
  return useQuery(
    {
      queryKey: computed(key),
      queryFn: () => runs.readLog(toValue(id), 0),
    },
    queryClient,
  );
}
