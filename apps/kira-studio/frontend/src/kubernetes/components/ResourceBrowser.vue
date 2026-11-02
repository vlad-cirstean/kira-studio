<script setup lang="ts">
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { ResizeHandle } from '@theme/components/ui/resizable';
import { t } from '@theme/i18n';
import { toCodedError } from '@workbench/bridge/codedError';
import QueryState from '@workbench/components/QueryState.vue';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, ref, watch } from 'vue';
import { useKinds, useNamespaces, useResourceList } from '../queries';
import { useKubernetesUiStore } from '../state';
import type { KubeCluster } from '../wire';
import NamespacePicker from './NamespacePicker.vue';
import ResourceDetail from './ResourceDetail.vue';
import ResourceTable from './ResourceTable.vue';

const props = defineProps<{ cluster: KubeCluster }>();

const ui = useKubernetesUiStore();
const kinds = useKinds(() => props.cluster.id);
const kind = computed(() => kinds.data.value?.kinds.find((k) => k.key === ui.kind));
const namespaced = computed(() => kind.value?.namespaced === true);
const namespaces = useNamespaces(
  () => props.cluster.id,
  () => namespaced.value,
);

// Unset: the context's namespace, else all. A restricted account falls back to the namespace the
// server allows.
const namespace = computed(() => {
  if (!namespaced.value) return '';
  if (ui.namespace !== null) return ui.namespace;
  if (namespaces.data.value?.restricted) return namespaces.data.value.fallback;
  return props.cluster.namespace;
});

const list = useResourceList({
  clusterId: () => props.cluster.id,
  kind: () => ui.kind,
  namespace,
  labelSelector: () => ui.labelSelector,
  enabled: () => kind.value !== undefined && (!namespaced.value || !namespaces.isPending.value),
});

const selector = ref(ui.labelSelector);
watch(
  () => ui.labelSelector,
  (v) => {
    selector.value = v;
  },
);
function applySelector(): void {
  ui.labelSelector = selector.value.trim();
}

const badSelector = computed(() => {
  const err = list.error.value;
  return err && toCodedError(err).code === 'E_BAD_REQUEST' ? toCodedError(err).message : '';
});

const hasDetail = computed(() => ui.selected !== null && kind.value !== undefined);
const shownCount = computed(() => list.data.value?.rows.length ?? 0);

const liveHeight = ref<number | null>(null);
const detailHeight = computed(() => liveHeight.value ?? ui.detailSize);
function commitHeight(size: number): void {
  ui.detailSize = size;
  liveHeight.value = null;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="kube-browser">
    <ViewToolbar class="flex-wrap">
      <span class="font-medium" data-testid="kube-kind-title">{{ kind?.kind }}</span>
      <NamespacePicker
        v-if="namespaced"
        :value="namespace"
        :data="namespaces.data.value"
        @change="ui.setNamespace($event)"
      />
      <Input
        v-model="selector"
        class="w-56"
        :placeholder="t('kubernetes.list.labelSelector.placeholder')"
        :aria-label="t('kubernetes.list.labelSelector.label')"
        :aria-invalid="badSelector !== ''"
        data-testid="kube-label-selector"
        @change="applySelector"
      />
      <SearchField
        v-model="ui.listFilter"
        class="w-48"
        :placeholder="t('kubernetes.list.filter.placeholder')"
        data-testid="kube-list-filter"
      />
      <span class="ml-auto text-kira-sm text-muted-foreground" data-testid="kube-count">{{
        t('kubernetes.list.count.status', { count: shownCount })
      }}</span>
      <TooltipIconButton
        icon="refresh"
        :label="t('common.action.refresh.label')"
        data-testid="kube-list-refresh"
        @click="list.refetch()"
      />
    </ViewToolbar>
    <FieldError v-if="badSelector" class="px-2" data-testid="kube-selector-error">{{
      badSelector
    }}</FieldError>
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col">
        <QueryState v-if="!badSelector" :query="list" :is-empty="() => false">
          <template #default="{ data }"><ResourceTable :data="data" /></template>
        </QueryState>
      </div>
      <template v-if="hasDetail && ui.selected && kind">
        <ResizeHandle
          axis="y"
          direction="reverse"
          line
          :label="t('kubernetes.detail.resize.label')"
          :size="detailHeight"
          :min="140"
          @live="liveHeight = $event"
          @commit="commitHeight"
          @cancel="liveHeight = null"
        />
        <div class="shrink-0" :style="{ height: `${detailHeight}px` }">
          <ResourceDetail
            :key="`${ui.selected.namespace}/${ui.selected.name}`"
            :cluster-id="cluster.id"
            :kind="kind"
            :namespace="ui.selected.namespace"
            :name="ui.selected.name"
          />
        </div>
      </template>
    </div>
  </div>
</template>
