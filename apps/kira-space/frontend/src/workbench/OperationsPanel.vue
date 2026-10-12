<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import OpLogPanel from '@workbench/components/OpLogPanel.vue';
import type { OpLogColumn } from '@workbench/lib/opLog';
import { computed } from 'vue';
import { useOpsStore } from '../state/ops';
import type { SpaceOpRecord } from '../state/opsDomain';

// P132 Part 2: the shared OpLogPanel over Kira Space's git op log. Copy command/Copy error/Cancel
// come from the panel's default menu; only the repo and source cells are this app's own.
const opsStore = useOpsStore();

const columns = computed<OpLogColumn[]>(() => [
  { id: 'time', label: t('common.field.time.label'), width: '90px' },
  { id: 'repo', label: t('space.repo.config.repository.label'), width: '140px' },
  { id: 'source', label: t('common.field.source.label'), width: '120px' },
  { id: 'kind', label: t('common.field.kind.label'), width: '120px' },
  { id: 'status', label: t('common.field.status.label'), width: '90px' },
  { id: 'duration', label: t('common.field.duration.label'), width: '70px' },
  { id: 'command', label: t('common.field.command.label'), width: '1fr' },
]);

function canCancel(record: SpaceOpRecord): boolean {
  return record.cancellable;
}
</script>

<template>
  <OpLogPanel
    v-model:filter-text="opsStore.filterText"
    v-model:status-filter="opsStore.statusFilter"
    :records="opsStore.visibleOps"
    :running-count="opsStore.runningCount"
    :columns="columns"
    :clear-hint="t('space.operations.clearHint.hint')"
    :can-cancel="canCancel"
    @clear="opsStore.clearOps"
    @cancel="(record) => opsStore.cancelOp(record.id)"
  >
    <template #cell="{ column, record }">
      <Tooltip v-if="column.id === 'repo'">
        <TooltipTrigger as-child>
          <span class="truncate min-w-0">{{ record.repoName }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ record.repoRoot }}</TooltipContent>
      </Tooltip>
      <span v-else-if="column.id === 'source'" class="truncate min-w-0">{{ record.source }}</span>
    </template>
  </OpLogPanel>
</template>
