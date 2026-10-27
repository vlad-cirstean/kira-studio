<script setup lang="ts">
import KeyValueList from '@theme/components/KeyValueList.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import AdeChip from '../AdeChip.vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import AdeTip from '../AdeTip.vue';
import { tagLabel } from '../board/actions';
import { integrationChips } from '../board/labels';
import { statusWhy, taskPatch } from '../board/panelFacts';
import { useHostLabels } from '../hostLabels';
import { type CardModel, usePlanModel } from '../plan/usePlanModel';
import { useAddTaskRepo, useUpdateTask } from '../queries';
import { useAdeAddUiStore } from '../state/adeAddUi';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { TaskPatch } from '../wire';
import AdeEstimateField from './AdeEstimateField.vue';
import AdeLinkRow from './AdeLinkRow.vue';
import AdeStatusPicker from './AdeStatusPicker.vue';
import AdeWorkflowBlock from './AdeWorkflowBlock.vue';
import { useLinkFields } from './useLinkFields';

// Task tab: the editable fields, then the branches.
const props = defineProps<{ card: CardModel }>();
const { liveNow } = usePlanModel();

const ui = useAdeBoardUiStore();
const addUi = useAdeAddUiStore();
const update = useUpdateTask();
const addRepo = useAddTaskRepo();
const repos = useRepos();

const task = computed(() => props.card.task);
const review = computed(() => props.card.review);
const fieldError = ref('');
const estError = ref<string | null>(null);

async function write(patch: Partial<TaskPatch>): Promise<boolean> {
  fieldError.value = '';
  try {
    await update.mutateAsync({ taskId: task.value.id, patch: taskPatch(patch) });
    return true;
  } catch (err) {
    fieldError.value = errorText(err);
    return false;
  }
}

// ---- status
const why = computed(() =>
  statusWhy(task.value, props.card.status, props.card.blocked, props.card.progress),
);

// ---- links
const jira = computed(() => task.value.jira);
const links = useLinkFields(
  () => task.value.hostLink,
  async (patch) => ((await write(patch)) ? null : fieldError.value),
);
const hostLink = computed(() => task.value.hostLink);
const hostLabels = useHostLabels();

// ---- estimate
async function saveEst(value: string): Promise<void> {
  estError.value = null;
  try {
    await update.mutateAsync({ taskId: task.value.id, patch: taskPatch({ est: value }) });
  } catch (err) {
    estError.value = errorText(err);
  }
}
const spanDays = computed(() => props.card.entry.span);

// ---- branches
const lackedRepos = computed(() => {
  const used = new Set(props.card.rows.map((r) => r.branch.codeRepoId));
  return (repos.data.value?.repos ?? []).filter((r) => !used.has(r.codeRepoId));
});
const addRepoValue = ref('');
async function onAddRepo(value: unknown): Promise<void> {
  const id = String(value ?? '');
  addRepoValue.value = '';
  if (!id) return;
  fieldError.value = '';
  try {
    await addRepo.mutateAsync({ taskId: task.value.id, codeRepoId: id, base: null });
  } catch (err) {
    fieldError.value = errorText(err);
  }
}

function branchLabel(row: CardModel['rows'][number]): string {
  return row.draft ? row.context : row.name;
}

const chipClass = (t: 'muted' | 'stale' | 'unknown'): string =>
  t === 'stale' ? 'text-tone-amber' : 'text-muted-foreground';
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 pt-3 text-kira-md"
    data-testid="ade-task-tab"
  >
    <KeyValueList class="items-center">
      <dt>{{ t('common.field.status.label') }}</dt>
      <dd class="flex min-h-row items-center gap-2">
        <AdeStatusPicker :card="card" />
        <AdeChip
          v-if="card.blocked"
          :label="t('space.common.status.blocked.status')"
          tone="red"
          data-testid="ade-task-blocked"
        />
        <span class="text-kira-sm text-subtle" data-testid="ade-task-status-why">{{ why }}</span>
      </dd>
      <AdeLinkRow
        id="ade-task-jira"
        :label="t('common.product.jira.label')"
        chip=""
        :text="jira?.key ?? ''"
        :url="jira?.url ?? ''"
        :placeholder="t('space.ade.taskTab.jiraPlaceholder.placeholder')"
        :error="links.jiraError.value"
        @save="links.saveJira"
        @clear="links.clearJira"
      />
      <AdeLinkRow
        id="ade-task-host"
        :label="hostLabels.labels.value"
        :chip="hostLabels.chipOf(hostLink)"
        :text="hostLink?.ref ?? ''"
        :url="hostLink ? task.hostUrl : ''"
        :placeholder="t('space.ade.taskTab.linkPlaceholder.placeholder', {
            labels: hostLabels.labels.value,
            shorts: hostLabels.shorts.value,
          })"
        :error="links.hostError.value"
        @save="links.saveHost"
        @clear="links.clearHost"
      />
      <dt>{{ t('space.ade.estimate.field.label') }}</dt>
      <dd
        ><AdeEstimateField :est="task.est" :days="spanDays" :error="estError" @save="saveEst" /></dd
      >
      <template v-if="!review">
        <dt />
        <dd class="flex min-h-row items-center gap-2">
          <Switch
            id="ade-task-parked"
            :model-value="card.parked"
            data-testid="ade-task-parked"
            @update:model-value="(v: boolean) => write({ kind: v ? 'parked' : 'task' })"
          />
          <Label for="ade-task-parked" class="text-kira-md">{{
            t('space.ade.board.notMerging.label')
          }}</Label>
          <span class="text-kira-sm text-subtle">{{ t('space.ade.taskTab.notMerging.hint') }}</span>
        </dd>
      </template>
    </KeyValueList>
    <Alert v-if="fieldError" variant="error" data-testid="ade-task-error"
      ><AlertDescription>{{ fieldError }}</AlertDescription></Alert
    >

    <AdeWorkflowBlock v-if="!review && !card.parked" :card="card" />

    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-2 pb-0.5">
        <span class="text-kira-sm text-subtle">{{ t('common.module.branches.label') }}</span>
        <span class="flex-1" />
        <template v-if="!review">
          <Label for="ade-add-repo" class="sr-only">{{
            t('space.ade.taskTab.addRepo.aria')
          }}</Label>
          <NativeSelect
            id="ade-add-repo"
            :model-value="addRepoValue"
            variant="default"
            class="max-w-50"
            :title="t('space.ade.taskTab.addRepo.tooltip')"
            data-testid="ade-add-repo"
            @update:model-value="onAddRepo"
          >
            <option value="">{{ t('space.ade.taskTab.addRepo.option') }}</option>
            <option v-for="r in lackedRepos" :key="r.codeRepoId" :value="r.codeRepoId">
              {{ r.nickname || r.name }}
              · {{ r.name }}
            </option>
          </NativeSelect>
        </template>
        <Button
          variant="dialog"
          size="kira"
          data-testid="ade-add-branch"
          @click="addUi.openAttach(task.id, card.title)"
        >
          {{ t('space.ade.taskTab.addBranch.label') }}
        </Button>
      </div>
      <Button
        size="kira"
        v-for="row in card.rows"
        :key="row.id"
        variant="toolbar"
        class="min-h-row w-full justify-start gap-2 bg-elevated px-1.5 text-left text-fg"
        data-testid="ade-task-branch"
        :data-branch-id="row.id"
        @click="ui.selectBranch(task.id, row.id)"
      >
        <AdeChip :label="tagLabel(row.tag, liveNow.getTime())" :tone="row.tag.tone" wide />
        <AdeRepoTag :code-repo-id="row.branch.codeRepoId" :label="row.repo" />
        <AdeTip v-for="c in integrationChips(row.branch)" :key="c.label" :text="c.tip">
          <span class="shrink-0 text-kira-sm font-medium" :class="chipClass(c.tone)">{{
            c.label
          }}</span>
        </AdeTip>
        <span
          class="min-w-0 flex-1 truncate font-data text-kira-md"
          :class="row.draft ? 'text-muted-foreground' : ''"
          >{{
            branchLabel(row)
          }}</span
        >
      </Button>
    </div>
  </div>
</template>
