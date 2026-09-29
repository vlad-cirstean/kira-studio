<script setup lang="ts">
import OpLogPanel from '@workbench/components/OpLogPanel.vue';
import type { OpLogColumn } from '@workbench/components/opLog';
import { useOpsStore } from '../state/ops';
import type { SpaceOpRecord } from '../state/opsDomain';

// P132 Part 2: the shared OpLogPanel over Kira Space's git op log. Copy command/Copy error/Cancel
// come from the panel's default menu; only the repo and source cells are this app's own.
const opsStore = useOpsStore();

const columns: OpLogColumn[] = [
  { id: 'time', label: 'Time', width: '90px' },
  { id: 'repo', label: 'Repository', width: '140px' },
  { id: 'source', label: 'Source', width: '120px' },
  { id: 'kind', label: 'Kind', width: '120px' },
  { id: 'status', label: 'Status', width: '90px' },
  { id: 'duration', label: 'Duration', width: '70px' },
  { id: 'command', label: 'Command', width: '1fr' },
];

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
    clear-hint="Clears this window's list only — the log resets when Kira Space quits"
    :can-cancel="canCancel"
    @clear="opsStore.clearOps"
    @cancel="(record) => opsStore.cancelOp(record.id)"
  >
    <template #cell="{ column, record }">
      <span v-if="column.id === 'repo'" class="truncate min-w-0" :title="record.repoRoot">{{ record.repoName }}</span>
      <span v-else-if="column.id === 'source'" class="truncate min-w-0">{{ record.source }}</span>
    </template>
  </OpLogPanel>
</template>
