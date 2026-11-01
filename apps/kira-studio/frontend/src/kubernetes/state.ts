import { usePersistedState } from '@workbench/behaviour/persisted';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { z } from 'zod';

export type KubeDetailTab = 'describe' | 'logs';

export interface KubeRowRef {
  namespace: string;
  name: string;
}

interface Remembered {
  clusterId: string;
  perCluster: Record<string, { kind: string; namespace: string | null }>;
}

const EMPTY: Remembered = { clusterId: '', perCluster: {} };

const rememberedSchema = z.object({
  clusterId: z.string(),
  perCluster: z.record(
    z.string(),
    z.object({ kind: z.string(), namespace: z.string().nullable() }),
  ),
});

export const useKubernetesUiStore = defineStore('kubernetesUi', () => {
  const remembered = usePersistedState<Remembered>('kira.kubernetes.selection', EMPTY, {
    schema: rememberedSchema,
  });
  const detailSize = usePersistedState('kira.kubernetes.detailHeight', 280);

  const clusterId = computed(() => remembered.value.clusterId);
  const kind = computed(() => remembered.value.perCluster[clusterId.value]?.kind ?? '');
  /** Null until the user picks one; the browser then falls back to the context's namespace. */
  const namespace = computed(() => remembered.value.perCluster[clusterId.value]?.namespace ?? null);

  const labelSelector = ref('');
  const listFilter = ref('');
  const selected = ref<KubeRowRef | null>(null);
  const detailTab = ref<KubeDetailTab>('describe');
  const expanded = ref<string[]>([]);
  const treeSearch = ref('');

  function remember(id: string, patch: { kind?: string; namespace?: string | null }): void {
    const prev = remembered.value.perCluster[id] ?? { kind: '', namespace: null };
    remembered.value = {
      clusterId: remembered.value.clusterId,
      perCluster: { ...remembered.value.perCluster, [id]: { ...prev, ...patch } },
    };
  }

  function resetView(): void {
    labelSelector.value = '';
    listFilter.value = '';
    selected.value = null;
    detailTab.value = 'describe';
  }

  function selectKind(id: string, nextKind: string): void {
    const changed = id !== clusterId.value || nextKind !== kind.value;
    remember(id, { kind: nextKind });
    remembered.value = { ...remembered.value, clusterId: id };
    if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
    if (changed) resetView();
  }

  function selectCluster(id: string): void {
    const changed = id !== clusterId.value || kind.value !== '';
    remember(id, { kind: '' });
    remembered.value = { ...remembered.value, clusterId: id };
    if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id];
    if (changed) resetView();
  }

  function setNamespace(next: string | null): void {
    if (clusterId.value === '') return;
    remember(clusterId.value, { namespace: next });
    selected.value = null;
  }

  function toggleExpanded(id: string): void {
    expanded.value = expanded.value.includes(id)
      ? expanded.value.filter((x) => x !== id)
      : [...expanded.value, id];
  }

  function selectRow(row: KubeRowRef | null, tab: KubeDetailTab = 'describe'): void {
    selected.value = row;
    detailTab.value = tab;
  }

  return {
    clusterId,
    kind,
    namespace,
    labelSelector,
    listFilter,
    selected,
    detailTab,
    expanded,
    treeSearch,
    detailSize,
    selectCluster,
    selectKind,
    setNamespace,
    toggleExpanded,
    selectRow,
  };
});
