<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { Toggle } from '@theme/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { type MessageKey, t } from '@theme/i18n';
import { type AutomationOp, isAutomationOp } from '@workbench/automations/runs/runOps';
import { triggerLabel, useAutomationOps } from '@workbench/automations/runs/useAutomationOps';
import { formatDuration } from '@workbench/behaviour/format';
import OpLogPanel from '@workbench/components/OpLogPanel.vue';
import {
  type OpLogColumn,
  type OpLogDetailLine,
  type OpLogField,
  type OpLogStep,
  opLogMenuItems,
} from '@workbench/lib/opLog';
import type { MenuItem } from '@workbench/state/contextMenu';
import { computed } from 'vue';
import { useOpsStore } from '../state/ops';
import type { SpaceOpRecord, SpaceOpStep } from '../state/opsDomain';

// The shared OpLogPanel over Kira Space's op log: git spawns from every module, agent sessions and
// in-app MCP calls. Origin (module badge + source), subject, fields, steps and the module facet
// are this app's own.
const opsStore = useOpsStore();
const auto = useAutomationOps(opsStore);
const showAutomation = computed(() => opsStore.facetAllows(AUTOMATION_FACET));
const records = computed(() =>
  auto.merge(opsStore.visibleOps).filter((r) => showAutomation.value || !isAutomationOp(r)),
);
const runningCount = computed(() => opsStore.runningCount + auto.runningCount.value);

type Row = SpaceOpRecord | AutomationOp;

const AUTOMATION_FACET = 'automation';

const columns = computed<OpLogColumn[]>(() => [
  { id: 'status', label: t('common.field.status.label'), width: '44px' },
  { id: 'time', label: t('common.field.time.label'), width: '64px', priority: 3 },
  { id: 'origin', label: t('common.field.source.label'), width: '170px', priority: 2 },
  { id: 'subject', label: t('git.search.field.subject.label'), width: '150px', priority: 1 },
  { id: 'kind', label: t('common.field.kind.label'), width: '110px', priority: 4 },
  {
    id: 'duration',
    label: t('common.field.duration.label'),
    width: '64px',
    priority: 3,
    align: 'end',
  },
  { id: 'command', label: t('common.field.command.label'), width: '1fr' },
]);

const MODULE_NAME: Record<string, MessageKey> = {
  git: 'common.module.git.label',
  ade: 'space.operations.moduleName.ade.label',
  files: 'common.module.files.label',
  vscode: 'space.operations.moduleName.vscode.label',
  memory: 'common.module.memory.label',
  app: 'space.operations.moduleName.app.label',
};

function moduleName(id: string): string {
  const key = MODULE_NAME[id];
  return key ? t(key) : id;
}

const facet = computed(() => {
  const modules = [...new Set(opsStore.records.map((r) => r.module))];
  const options = modules.map((id) => ({ value: id, label: moduleName(id) }));
  if (auto.merge([]).length > 0) {
    options.push({ value: AUTOMATION_FACET, label: t('common.module.automations.label') });
  }
  return { label: t('space.operations.module.label'), options };
});

const byId = computed(() => new Map(opsStore.records.map((r) => [r.id, r])));

function canCancel(record: Row): boolean {
  return isAutomationOp(record) ? auto.canCancel(record) : record.cancellable;
}

function onCancel(record: Row): void {
  if (isAutomationOp(record)) auto.cancel(record);
  else void opsStore.cancelOp(record.id);
}

function parentTool(record: SpaceOpRecord): string | null {
  return record.parentId ? (byId.value.get(record.parentId)?.kind ?? null) : null;
}

function runningNote(record: Row): string | null {
  return isAutomationOp(record) ? auto.runningNote(record) : null;
}

function statusNote(record: Row): string | null {
  if (isAutomationOp(record)) return auto.statusNote(record);
  return record.repeat > 1 ? t('space.operations.repeat.label', { count: record.repeat }) : null;
}

function stepText(step: SpaceOpStep): string {
  const duration = step.durationMs === null ? '' : formatDuration(step.durationMs);
  return step.exitCode === null
    ? t('common.dotPair.label', { first: step.argv, second: duration })
    : t('space.operations.step.label', { argv: step.argv, exit: step.exitCode, duration });
}

function fieldsFor(record: Row): OpLogField[] {
  const fields: OpLogField[] = isAutomationOp(record)
    ? [
        { label: t('common.script.label'), value: record.run.scriptName },
        { label: t('space.operations.field.trigger.label'), value: triggerLabel(record.run) },
        { label: t('space.operations.field.cwd.label'), value: record.run.cwd, code: true },
      ]
    : [
        { label: t('space.operations.module.label'), value: moduleName(record.module) },
        { label: t('space.operations.field.trigger.label'), value: record.trigger },
        { label: t('common.field.source.label'), value: record.source },
        { label: t('space.repo.config.repository.label'), value: record.repoRoot, code: true },
        { label: t('common.task.label'), value: record.subject },
        { label: t('space.operations.field.category.label'), value: record.category },
      ];
  return fields.filter((f) => f.value !== '');
}

function stepsFor(record: Row): readonly OpLogStep[] {
  return isAutomationOp(record) ? [] : record.steps;
}

function detailLines(record: Row): OpLogDetailLine[] {
  if (isAutomationOp(record)) return auto.detailLines(record);
  return record.stepsDropped > 0
    ? [{ text: t('space.operations.stepsDropped.label', { count: record.stepsDropped }) }]
    : [];
}

function detailsText(record: SpaceOpRecord): string {
  const parts = [record.command ?? '', ...record.steps.map(stepText)];
  for (const step of record.steps) if (step.stderr) parts.push(step.stderr);
  if (record.error) parts.push(record.error);
  return parts.filter(Boolean).join('\n');
}

function menuFor(record: Row): MenuItem[] {
  if (isAutomationOp(record)) return auto.menuFor(record);
  return opLogMenuItems(
    record,
    () => void opsStore.cancelOp(record.id),
    canCancel(record),
    undefined,
    detailsText(record),
  );
}
</script>

<template>
  <OpLogPanel
    v-model:filter-text="opsStore.filterText"
    v-model:status-filter="opsStore.statusFilter"
    v-model:facet-values="opsStore.facetValues"
    :records="records"
    :running-count="runningCount"
    :loading="!opsStore.hydrated"
    :columns="columns"
    :clear-hint="t('space.operations.clearHint.hint')"
    :empty-hint="t('space.operations.empty.hint')"
    :can-cancel="canCancel"
    :menu-for="menuFor"
    :kind-label="(record) => (isAutomationOp(record) ? auto.kindLabel() : record.kind)"
    :running-note="runningNote"
    :status-note="statusNote"
    :detail-lines="detailLines"
    :fields-for="fieldsFor"
    :steps-for="stepsFor"
    :parent-of="(record) => (isAutomationOp(record) ? null : record.parentId || null)"
    :facet="facet"
    @clear="opsStore.clearOps"
    @cancel="onCancel"
    @reset-filters="opsStore.resetFilters"
  >
    <template #toolbar>
      <Toggle
        v-model="opsStore.showBackground"
        variant="outline"
        size="kira"
        data-testid="ops-background"
      >
        {{
          opsStore.backgroundCount > 0
            ? t('space.operations.backgroundCount.label', { count: opsStore.backgroundCount })
            : t('space.operations.background.label')
        }}
      </Toggle>
    </template>
    <template #cell="{ column, record, viaParent }">
      <template v-if="isAutomationOp(record)">
        <span v-if="column.id === 'origin'" class="flex min-w-0 items-center gap-1">
          <Badge>{{ auto.kindLabel() }}</Badge>
          <span class="min-w-0 truncate" data-testid="op-source-cell">{{
            triggerLabel(record.run)
          }}</span>
        </span>
        <Tooltip v-else-if="column.id === 'subject'">
          <TooltipTrigger as-child>
            <span class="min-w-0 truncate">{{
              record.run.taskTitle || record.run.scriptName
            }}</span>
          </TooltipTrigger>
          <TooltipContent>{{ record.run.cwd }}</TooltipContent>
        </Tooltip>
      </template>
      <span v-else-if="column.id === 'origin'" class="flex min-w-0 items-center gap-1">
        <Badge>{{ moduleName(record.module) }}</Badge>
        <span class="min-w-0 truncate" data-testid="op-source-cell">{{ record.source }}</span>
        <span v-if="viaParent && parentTool(record)" class="shrink-0 text-muted-foreground">{{
          t('space.operations.via.label', { tool: parentTool(record) ?? '' })
        }}</span>
      </span>
      <Tooltip v-else-if="column.id === 'subject'">
        <TooltipTrigger as-child>
          <span class="min-w-0 truncate">{{ record.subject || record.repoName }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ record.repoRoot || record.subject }}</TooltipContent>
      </Tooltip>
    </template>
  </OpLogPanel>
</template>
