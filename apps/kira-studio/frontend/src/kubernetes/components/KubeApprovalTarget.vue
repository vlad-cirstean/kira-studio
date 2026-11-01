<script setup lang="ts">
import type { DbMcpApproval } from '@shared/domain/dbmcp';
import { Badge } from '@theme/components/ui/badge';
import { Card } from '@theme/components/ui/card';
import { type MessageKey, t } from '@theme/i18n';
import ClusterIcon from './ClusterIcon.vue';

type Cluster = NonNullable<DbMcpApproval['cluster']>;
defineProps<{ cluster: Cluster }>();

const OPERATION_LABEL: Record<Cluster['operation'], MessageKey> = {
  discover: 'kubernetes.mcp.discover.label',
  list: 'kubernetes.mcp.list.label',
  describe: 'kubernetes.detail.tab.describe.label',
  logs: 'docker.tab.logs.label',
};
</script>

<template>
  <Card
    class="shrink-0 gap-1 border-l-4"
    :aria-label="t('studio.dbMcp.approval.kube.target.aria')"
    data-testid="db-mcp-approval-kube"
  >
    <div class="flex items-start justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5 break-words text-kira-xl font-medium">
        <ClusterIcon :size="16" />
        <span data-testid="db-mcp-approval-kube-context">{{ cluster.context }}</span>
      </span>
      <Badge data-testid="db-mcp-approval-kube-operation">{{
        t(OPERATION_LABEL[cluster.operation])
      }}</Badge>
    </div>
    <span
      class="min-w-0 break-all font-data text-kira-sm text-muted-foreground"
      data-testid="db-mcp-approval-kube-server"
      >{{
        cluster.server
      }}</span
    >
    <span class="font-data text-kira-lg" data-testid="db-mcp-approval-kube-namespace">{{
      cluster.namespace || t('kubernetes.namespace.all.option')
    }}</span>
  </Card>
</template>
