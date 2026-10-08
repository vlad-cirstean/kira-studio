import type { ImportAction } from '@shared/domain/memoryImport';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { useMemoryModule } from '../module';

// P211: server state for bulk import. Backend pushes carry no payload, so every push refetches.
const IMPORT_KEY = ['memory', 'import'] as const;

export function useImportJobs() {
  const { control } = useMemoryModule();
  return useQuery(
    { queryKey: [...IMPORT_KEY, 'jobs'] as const, queryFn: () => control.memoryImportJobs() },
    queryClient,
  );
}

export function useImportJob(id: MaybeRefOrGetter<string | null>) {
  const { control } = useMemoryModule();
  return useQuery(() => {
    const jobId = toValue(id);
    return {
      queryKey: [...IMPORT_KEY, 'job', jobId] as const,
      queryFn: () => control.memoryImportJob(jobId ?? ''),
      enabled: jobId !== null,
    };
  }, queryClient);
}

export function useImportChangeSync(): void {
  const { control } = useMemoryModule();
  const off = control.onMemoryImport(() => {
    void queryClient.invalidateQueries({ queryKey: IMPORT_KEY });
  });
  tryOnScopeDispose(off);
}

/** Picks paths natively and scans them; resolves to the new job, or null if the user canceled. */
export function useChooseImport() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...IMPORT_KEY, 'choose'],
      mutationFn: async (kind: 'files' | 'folder') => {
        const choice = await control.memoryImportChoose(kind);
        return choice.canceled ? null : control.memoryImportCreate(choice.paths);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: IMPORT_KEY }),
    },
    queryClient,
  );
}

export function useImportAction() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...IMPORT_KEY, 'action'],
      mutationFn: (vars: { action: ImportAction; id: string }) =>
        control.memoryImportAction(vars.action, vars.id),
      onSettled: () => queryClient.invalidateQueries({ queryKey: IMPORT_KEY }),
    },
    queryClient,
  );
}

export function useRetryImportFile() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...IMPORT_KEY, 'retryFile'],
      mutationFn: (fileId: string) => control.memoryImportRetryFile(fileId),
      onSettled: () => queryClient.invalidateQueries({ queryKey: IMPORT_KEY }),
    },
    queryClient,
  );
}
