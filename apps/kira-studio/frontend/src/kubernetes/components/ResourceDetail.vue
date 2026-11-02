<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { useDescribe } from '../queries';
import { type KubeDetailTab, useKubernetesUiStore } from '../state';
import type { KubeKind } from '../wire';
import DescribeView from './DescribeView.vue';
import LogsView from './LogsView.vue';

const props = defineProps<{
  clusterId: string;
  kind: KubeKind;
  namespace: string;
  name: string;
}>();

const ui = useKubernetesUiStore();
const describe = useDescribe({
  clusterId: () => props.clusterId,
  kind: () => props.kind.key,
  namespace: () => props.namespace,
  name: () => props.name,
});

const tabs = computed(() => [
  {
    value: 'describe',
    label: t('kubernetes.detail.tab.describe.label'),
    testid: 'kube-detail-tab-describe',
  },
  ...(props.kind.logs
    ? [
        {
          value: 'logs',
          label: t('docker.tab.logs.label'),
          testid: 'kube-detail-tab-logs',
        },
      ]
    : []),
]);
const tab = computed(() => (ui.detailTab === 'logs' && props.kind.logs ? 'logs' : 'describe'));
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col"
    :aria-label="name"
    data-testid="kube-detail"
    @keydown.esc="ui.selectRow(null)"
  >
    <div class="flex h-bar shrink-0 items-center gap-2 border-b border-border px-2">
      <span class="truncate font-medium" data-testid="kube-detail-title">{{ name }}</span>
      <SecondaryTabs
        :model-value="tab"
        :items="tabs"
        @update:model-value="(v) => (ui.detailTab = v as KubeDetailTab)"
      />
      <TooltipIconButton
        class="ml-auto"
        icon="close"
        :label="t('kubernetes.detail.close.label')"
        data-testid="kube-detail-close"
        @click="ui.selectRow(null)"
      />
    </div>
    <div class="min-h-0 flex-1">
      <LogsView
        v-if="tab === 'logs' && describe.data.value"
        :key="`${clusterId}/${namespace}/${name}`"
        :cluster-id="clusterId"
        :namespace="namespace"
        :pod="name"
        :containers="describe.data.value.containers"
      />
      <DescribeView
        v-else-if="tab === 'describe'"
        :cluster-id="clusterId"
        :kind="kind.key"
        :namespace="namespace"
        :name="name"
      />
    </div>
  </section>
</template>
