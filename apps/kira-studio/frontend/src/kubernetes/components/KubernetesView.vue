<script setup lang="ts">
import { t } from '@theme/i18n';
import ModuleStart from '@workbench/components/ModuleStart.vue';
import QueryState from '@workbench/components/QueryState.vue';
import { computed } from 'vue';
import { useClusterStatus, useClusters } from '../queries';
import { useKubernetesUiStore } from '../state';
import ClusterUnavailable from './ClusterUnavailable.vue';
import ResourceBrowser from './ResourceBrowser.vue';

const ui = useKubernetesUiStore();
const clusters = useClusters();
const cluster = computed(() => clusters.data.value?.clusters.find((c) => c.id === ui.clusterId));
const config = computed(() => clusters.data.value?.config);
const missingArgs = (paths: string[]) => ({
  paths: paths.join(', '),
  env: 'KUBECONFIG',
  path: '~/.kube/config',
});
const status = useClusterStatus(() => cluster.value?.id ?? '');
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="kubernetes-view">
    <QueryState :query="clusters" :is-empty="() => false">
      <ModuleStart
        v-if="config?.state === 'missing'"
        icon="type-hierarchy"
        data-testid="kube-config-missing"
        :title="t('kubernetes.config.missing.title')"
        :description="t('kubernetes.config.missing.body', missingArgs(config.paths))"
      />
      <ModuleStart
        v-else-if="config?.state === 'invalid'"
        icon="type-hierarchy"
        data-testid="kube-config-invalid"
        :title="t('kubernetes.config.invalid.title')"
        :description="t('kubernetes.config.invalid.body', { message: config.message })"
      />
      <QueryState v-else-if="cluster" :query="status" :is-empty="() => false">
        <template #default="{ data }">
          <ClusterUnavailable
            v-if="data.state === 'unavailable'"
            :cluster-id="cluster.id"
            :status="data"
          />
          <ResourceBrowser v-else-if="ui.kind" :cluster="cluster" />
          <ModuleStart
            v-else
            icon="type-hierarchy"
            data-testid="kube-start"
            :title="cluster.context"
            :description="t('kubernetes.start.body')"
          />
        </template>
      </QueryState>
      <ModuleStart
        v-else
        icon="type-hierarchy"
        data-testid="kube-start"
        :title="t('kubernetes.start.title')"
        :description="t('kubernetes.start.body')"
      />
    </QueryState>
  </div>
</template>
