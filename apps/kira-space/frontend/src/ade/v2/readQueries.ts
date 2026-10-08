import { useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { useAdeReader } from './reader';
import type { LogKind } from './wire';

// Read side of the ADE queries, transport-agnostic (`useAdeReader`). Push-driven: every query is
// `staleTime: Infinity` and the signals installed per app (`installAdeReadSignals`) invalidate.

export const boardKey = ['adetask', 'board'] as const;
export const prsKey = ['adetask', 'prs'] as const;
export const workflowsKey = ['adetask', 'workflows'] as const;
export const logKey = (kind: LogKind, id: string) => ['adetask', 'log', kind, id] as const;
export const backlogKey = ['adetask', 'backlog'] as const;
export const sessionsKey = ['adetask', 'sessions'] as const;
export const repoNamesKey = ['adetask', 'repoNames'] as const;

export function useBoard() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: boardKey,
    queryFn: () => reader.board(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function usePrs() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: prsKey,
    queryFn: () => reader.prs(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useWorkflows() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: workflowsKey,
    queryFn: () => reader.workflows(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSessions() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => reader.sessions(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useBacklog() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: backlogKey,
    queryFn: () => reader.backlog(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Repo names for read-only clients; the desktop reads the full repo settings elsewhere. */
export function useRepoNames() {
  const reader = useAdeReader();
  return useQuery({
    queryKey: repoNamesKey,
    queryFn: () => reader.repos(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** One log from its first chunk; the log push appends to this cache. */
export function useLog(kind: MaybeRefOrGetter<LogKind>, id: MaybeRefOrGetter<string>) {
  const reader = useAdeReader();
  return useQuery(() => ({
    queryKey: logKey(toValue(kind), toValue(id)),
    queryFn: () => reader.readLog({ kind: toValue(kind), id: toValue(id), afterSeq: 0 }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30_000,
  }));
}
