import type { MemoryClarification, MemoryItem } from '@shared/domain/memory';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { useMemoryModule } from './module';

// P201: server state for the Memory module. Keys are flat [domain, ...ids] tuples.
const MEMORY_KEY = ['memory'] as const;

export function useMemorySearch(
  query: MaybeRefOrGetter<string>,
  includeHistory: MaybeRefOrGetter<boolean>,
) {
  const { control } = useMemoryModule();
  return useQuery(() => {
    const q = toValue(query).trim();
    const history = toValue(includeHistory);
    return {
      queryKey: [...MEMORY_KEY, 'search', q, history] as const,
      queryFn: () => (q === '' ? control.memoryRecent() : control.memorySearch(q, history)),
      placeholderData: keepPreviousData,
    };
  }, queryClient);
}

export function useMemoryHistory(id: MaybeRefOrGetter<string | null>) {
  const { control } = useMemoryModule();
  return useQuery(() => {
    const memoryId = toValue(id);
    return {
      queryKey: [...MEMORY_KEY, 'history', memoryId] as const,
      queryFn: () => control.memoryHistory(memoryId ?? ''),
      enabled: memoryId !== null,
    };
  }, queryClient);
}

export interface StoreMemoryVars {
  items: MemoryItem[];
  clarifications: MemoryClarification[];
  signal?: AbortSignal;
}

export function useStoreMemory() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...MEMORY_KEY, 'store'],
      mutationFn: (vars: StoreMemoryVars) =>
        control.memoryStore(vars.items, vars.clarifications, vars.signal),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: MEMORY_KEY }),
    },
    queryClient,
  );
}

export function useMemoryMcpStatus() {
  const { control } = useMemoryModule();
  return useQuery(
    { queryKey: [...MEMORY_KEY, 'mcp'] as const, queryFn: () => control.memoryMcpStatus() },
    queryClient,
  );
}

const SEMANTIC_KEY = [...MEMORY_KEY, 'semantic'] as const;

export function useMemorySemanticStatus() {
  const { control } = useMemoryModule();
  const off = control.onMemorySemantic(() => {
    void queryClient.invalidateQueries({ queryKey: SEMANTIC_KEY });
  });
  tryOnScopeDispose(off);
  return useQuery(
    { queryKey: SEMANTIC_KEY, queryFn: () => control.memorySemanticStatus() },
    queryClient,
  );
}

export function useInstallSemanticModel() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...SEMANTIC_KEY, 'install'],
      mutationFn: (signal?: AbortSignal) => control.memorySemanticInstall(signal),
      onSettled: () => queryClient.invalidateQueries({ queryKey: SEMANTIC_KEY }),
    },
    queryClient,
  );
}

export function useRetrySemantic() {
  const { control } = useMemoryModule();
  return useMutation(
    {
      mutationKey: [...SEMANTIC_KEY, 'retry'],
      mutationFn: () => control.memorySemanticRetry(),
      onSettled: () => queryClient.invalidateQueries({ queryKey: SEMANTIC_KEY }),
    },
    queryClient,
  );
}

/** Refetches memory queries when the backend reports a write, including the MCP server's. */
export function useMemoryChangeSync(): void {
  const { control } = useMemoryModule();
  const off = control.onMemoryChanged(() => {
    void queryClient.invalidateQueries({ queryKey: MEMORY_KEY });
  });
  tryOnScopeDispose(off);
}
