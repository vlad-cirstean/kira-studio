import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useDocumentVisibility } from '@vueuse/core';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { TIMING } from '@workbench/behaviour/timing';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { kubeControl } from './control';
import type { KubeClusters, KubeMcpSettings, KubeStatus } from './wire';

const LIST_POLL = TIMING.pollFast * 2;

export const kubeKeys = {
  clusters: ['kubernetes', 'clusters'] as const,
  cluster: (id: string) => ['kubernetes', id] as const,
  status: (id: string) => ['kubernetes', id, 'status'] as const,
  namespaces: (id: string) => ['kubernetes', id, 'namespaces'] as const,
  kinds: (id: string) => ['kubernetes', id, 'kinds'] as const,
};

export function useClusters() {
  return useQuery({ queryKey: kubeKeys.clusters, queryFn: kubeControl.clusters });
}

const statusOptions = (id: string) => ({
  queryKey: kubeKeys.status(id),
  queryFn: () => kubeControl.status(id, false),
  staleTime: TIMING.pollSlow,
});

const kindsOptions = (id: string) => ({
  queryKey: kubeKeys.kinds(id),
  queryFn: () => kubeControl.kinds(id),
  staleTime: TIMING.pollSlow,
});

/** Probe/discovery for every listed cluster; only the ones in `active` ever connect. */
export function useClusterProbes(
  ids: MaybeRefOrGetter<readonly string[]>,
  active: MaybeRefOrGetter<readonly string[]>,
) {
  const statuses = useQueries({
    queries: computed(() =>
      toValue(ids).map((id) => ({ ...statusOptions(id), enabled: toValue(active).includes(id) })),
    ),
  });
  const kinds = useQueries({
    queries: computed(() =>
      toValue(ids).map((id) => ({ ...kindsOptions(id), enabled: toValue(active).includes(id) })),
    ),
  });
  return { statuses, kinds };
}

export function useClusterStatus(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => kubeKeys.status(toValue(id))),
    queryFn: () => kubeControl.status(toValue(id), false),
    staleTime: TIMING.pollSlow,
    enabled: computed(() => toValue(id) !== ''),
  });
}

export function useKinds(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => kubeKeys.kinds(toValue(id))),
    queryFn: () => kubeControl.kinds(toValue(id)),
    staleTime: TIMING.pollSlow,
    enabled: computed(() => toValue(id) !== ''),
  });
}

export function useNamespaces(id: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: computed(() => kubeKeys.namespaces(toValue(id))),
    queryFn: () => kubeControl.namespaces(toValue(id)),
    staleTime: TIMING.pollSlow,
    enabled: computed(() => toValue(id) !== '' && toValue(enabled)),
  });
}

export function useResourceList(args: {
  clusterId: MaybeRefOrGetter<string>;
  kind: MaybeRefOrGetter<string>;
  namespace: MaybeRefOrGetter<string>;
  labelSelector: MaybeRefOrGetter<string>;
  enabled: MaybeRefOrGetter<boolean>;
}) {
  const visibility = useDocumentVisibility();
  return useQuery({
    queryKey: computed(() => [
      'kubernetes',
      toValue(args.clusterId),
      'list',
      toValue(args.kind),
      toValue(args.namespace),
      toValue(args.labelSelector),
    ]),
    queryFn: () =>
      kubeControl.list(
        toValue(args.clusterId),
        toValue(args.kind),
        toValue(args.namespace),
        toValue(args.labelSelector),
      ),
    refetchInterval: () => (visibility.value === 'visible' ? LIST_POLL : false),
    enabled: computed(() => toValue(args.clusterId) !== '' && toValue(args.enabled)),
  });
}

export function useDescribe(args: {
  clusterId: MaybeRefOrGetter<string>;
  kind: MaybeRefOrGetter<string>;
  namespace: MaybeRefOrGetter<string>;
  name: MaybeRefOrGetter<string>;
}) {
  return useQuery({
    queryKey: computed(() => [
      'kubernetes',
      toValue(args.clusterId),
      'describe',
      toValue(args.kind),
      toValue(args.namespace),
      toValue(args.name),
    ]),
    queryFn: () =>
      kubeControl.describe(
        toValue(args.clusterId),
        toValue(args.kind),
        toValue(args.namespace),
        toValue(args.name),
      ),
  });
}

/** Reconnects one cluster (fresh client) and republishes its status; drops its cached reads. */
export function useRefreshCluster() {
  const qc = useQueryClient();
  return useAsyncAction(async (id: string) => {
    const status = await kubeControl.status(id, true);
    await qc.invalidateQueries({ queryKey: kubeKeys.cluster(id) });
    qc.setQueryData<KubeStatus>(kubeKeys.status(id), status);
  });
}

/** Saves one cluster's MCP settings and patches the clusters cache with what the backend stored. */
export function useSetClusterMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['kubernetes', 'setMcp'],
    mutationFn: (v: { clusterId: string; mcp: KubeMcpSettings }) =>
      kubeControl.setMcp(v.clusterId, v.mcp),
    onSuccess: (mcp, v) => {
      qc.setQueryData<KubeClusters>(kubeKeys.clusters, (old) =>
        old
          ? {
              ...old,
              clusters: old.clusters.map((c) => (c.id === v.clusterId ? { ...c, mcp } : c)),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: kubeKeys.clusters });
    },
  });
}
