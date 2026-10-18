import type { DistillArgs, DistillProgress } from '@shared/domain/memoryDistill';
import { useIsMutating, useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed } from 'vue';
import { useMemoryModule } from '../module';
import { useDistillUiStore } from './distillStore';

// P285 Part 4: server state for distill. The progress push carries a payload, so it writes the
// store directly instead of invalidating a query.
const DISTILL_KEY = ['memory', 'distill'] as const;

export function useDistillLimits() {
  const { control } = useMemoryModule();
  return useQuery(
    {
      queryKey: [...DISTILL_KEY, 'limits'] as const,
      queryFn: () => control.memoryDistillLimits(),
    },
    queryClient,
  );
}

export function useDistill() {
  const { control } = useMemoryModule();
  const ui = useDistillUiStore();
  return useMutation(
    {
      mutationKey: [...DISTILL_KEY, 'run'],
      mutationFn: (vars: { args: DistillArgs; signal: AbortSignal; source: string }) =>
        control.memoryDistill(vars.args, vars.signal),
      onSuccess: (result, vars) => ui.setResult(result, vars.source),
    },
    queryClient,
  );
}

/** True while a distill runs, also after the view remounts mid-call. */
export function useDistillRunning() {
  const running = useIsMutating({ mutationKey: [...DISTILL_KEY, 'run'] }, queryClient);
  return computed(() => running.value > 0);
}

/** Picks a file natively; resolves to its path, or null if the user canceled. */
export function useChooseDistillFile() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...DISTILL_KEY, 'choose'],
      mutationFn: async () => {
        const choice = await control.memoryDistillChoose();
        return choice.canceled ? null : choice.path;
      },
    },
    queryClient,
  );
}

export function useDistillToImport() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...DISTILL_KEY, 'toImport'],
      mutationFn: (vars: { lines: string[]; source: string }) =>
        control.memoryDistillToImport(vars.lines, vars.source),
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['memory', 'import'] }),
    },
    queryClient,
  );
}

/** Mirrors the running call's progress into the store; other requests' pushes are ignored. */
export function useDistillProgress(): void {
  const { control } = useMemoryModule();
  const ui = useDistillUiStore();
  const off = control.onMemoryDistill((p: DistillProgress) => {
    if (p.requestId !== ui.requestId) return;
    ui.progress = { stage: p.stage, done: p.done, total: p.total, costUsd: p.costUsd };
  });
  tryOnScopeDispose(off);
}
