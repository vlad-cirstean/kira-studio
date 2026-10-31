<script setup lang="ts">
import { Toggle } from '@theme/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { copyAndAnnounce } from '@workbench/behaviour/clipboard';
import { formatDuration } from '@workbench/behaviour/format';
import OpLogPanel from '@workbench/components/OpLogPanel.vue';
import { type OpLogColumn, type OpLogDetailLine, opLogMenuItems } from '@workbench/lib/opLog';
import type { MenuItem } from '@workbench/state/contextMenu';
import { computed } from 'vue';
import { useOpsStore } from '../state/ops';
import type { SpaceOpRecord, SpaceOpStep } from '../state/opsDomain';

// P415: the shared OpLogPanel over Kira Space's op log: git spawns from every module, agent
// sessions and in-app MCP calls. Copy command/Copy error/Cancel come from the panel's default
// menu; the module, subject and source cells, the steps and Copy details are this app's own.
const opsStore = useOpsStore();

const columns = computed<OpLogColumn[]>(() => [
  { id: 'time', label: t('common.field.time.label'), width: '90px' },
  { id: 'module', label: t('space.operations.module.label'), width: '60px' },
  { id: 'source', label: t('common.field.source.label'), width: '150px' },
  { id: 'subject', label: t('git.search.field.subject.label'), width: '140px' },
  { id: 'kind', label: t('common.field.kind.label'), width: '120px' },
  { id: 'status', label: t('common.field.status.label'), width: '110px' },
  { id: 'duration', label: t('common.field.duration.label'), width: '70px' },
  { id: 'command', label: t('common.field.command.label'), width: '1fr' },
]);

const byId = computed(() => new Map(opsStore.records.map((r) => [r.id, r])));

function canCancel(record: SpaceOpRecord): boolean {
  return record.cancellable;
}

function parentTool(record: SpaceOpRecord): string | null {
  return record.parentId ? (byId.value.get(record.parentId)?.kind ?? null) : null;
}

function statusNote(record: SpaceOpRecord): string | null {
  return record.repeat > 1 ? t('space.operations.repeat.label', { count: record.repeat }) : null;
}

function stepText(step: SpaceOpStep): string {
  const duration = step.durationMs === null ? '' : formatDuration(step.durationMs);
  return step.exitCode === null
    ? t('common.dotPair.label', { first: step.argv, second: duration })
    : t('space.operations.step.label', { argv: step.argv, exit: step.exitCode, duration });
}

function detailLines(record: SpaceOpRecord): OpLogDetailLine[] {
  return record.steps.flatMap((step) => {
    const lines: OpLogDetailLine[] = [
      { text: stepText(step), tone: step.status === 'error' ? 'error' : undefined },
    ];
    if (step.status === 'error' && step.stderr) lines.push({ text: step.stderr, tone: 'error' });
    return lines;
  });
}

function detailsText(record: SpaceOpRecord): string {
  const parts = [record.command ?? '', ...record.steps.map(stepText)];
  for (const step of record.steps) if (step.stderr) parts.push(step.stderr);
  if (record.error) parts.push(record.error);
  return parts.filter(Boolean).join('\n');
}

function menuFor(record: SpaceOpRecord): MenuItem[] {
  return [
    ...opLogMenuItems(record, () => void opsStore.cancelOp(record.id), canCancel(record)),
    {
      type: 'item',
      id: 'copy-details',
      label: t('space.operations.copyDetails.label'),
      icon: 'copy',
      run: () =>
        void copyAndAnnounce(detailsText(record), t('space.operations.copiedDetails.announce')),
    },
  ];
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
    :menu-for="menuFor"
    :status-note="statusNote"
    :detail-lines="detailLines"
    @clear="opsStore.clearOps"
    @cancel="(record) => opsStore.cancelOp(record.id)"
  >
    <template #toolbar>
      <Toggle
        v-model="opsStore.showBackground"
        variant="outline"
        size="kira"
        data-testid="ops-background"
      >
        {{ t('space.operations.background.label') }}
      </Toggle>
    </template>
    <template #cell="{ column, record }">
      <span v-if="column.id === 'module'" class="truncate min-w-0">{{ record.module }}</span>
      <span v-else-if="column.id === 'source'" class="truncate min-w-0">
        {{ record.source }}
        <span v-if="parentTool(record)" class="text-muted-foreground">{{
          t('space.operations.via.label', { tool: parentTool(record) ?? '' })
        }}</span>
      </span>
      <Tooltip v-else-if="column.id === 'subject'">
        <TooltipTrigger as-child>
          <span class="truncate min-w-0">{{ record.subject || record.repoName }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ record.repoRoot || record.subject }}</TooltipContent>
      </Tooltip>
    </template>
  </OpLogPanel>
</template>
