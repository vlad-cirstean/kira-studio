<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Switch } from '@theme/components/ui/switch';
import { computed, ref, watch } from 'vue';
import { useRepoLinksStore } from '../../../repo/state/repoLinks';
import { useRepos } from '../../../repo/state/reposQueries';
import { repoTint } from '../../../state/coderepos';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import { STATUS_TONE, tagLabel } from '../board/actions';
import { integrationChips } from '../board/labels';
import { statusWhy, taskPatch } from '../board/panelFacts';
import { type CardModel, usePlanModel } from '../plan/usePlanModel';
import { useAddTaskRepo, useUpdateTask } from '../queries';
import { useAdeAddUiStore } from '../state/adeAddUi';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { TaskPatch } from '../wire';
import AdeEstimateField from './AdeEstimateField.vue';
import AdeLinkRow from './AdeLinkRow.vue';
import AdeWorkflowBlock from './AdeWorkflowBlock.vue';
import { useLinkFields } from './useLinkFields';

// Task tab: the editable fields, then the branches. Status is read-only (D10).
const props = defineProps<{ card: CardModel }>();
const { liveNow } = usePlanModel();

const ui = useAdeBoardUiStore();
const addUi = useAdeAddUiStore();
const update = useUpdateTask();
const addRepo = useAddTaskRepo();
const repos = useRepos();
const repoLinks = useRepoLinksStore();
const tintOf = (id: string) => repoTint(repoLinks.repoColorOf(id));

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
    fieldError.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

// ---- name
const name = ref(task.value.title);
watch(
  () => [task.value.id, task.value.title] as const,
  () => {
    name.value = task.value.title;
  },
);
function commitName(): void {
  const next = name.value.trim();
  if (next !== task.value.title) void write({ title: next });
}

// ---- status
const statusTone = computed(() =>
  props.card.parked ? 'grey' : STATUS_TONE[props.card.status],
);
const statusLabel = computed(() => (props.card.parked ? 'not merging' : props.card.status));
const why = computed(() => statusWhy(task.value, props.card.status, props.card.progress));

// ---- links
const jira = computed(() => task.value.jira);
const links = useLinkFields(
  () => task.value.githubUrl,
  async (patch) => ((await write(patch)) ? null : fieldError.value),
);
const github = links.github;

// ---- estimate
async function saveEst(value: string): Promise<void> {
  estError.value = null;
  try {
    await update.mutateAsync({ taskId: task.value.id, patch: taskPatch({ est: value }) });
  } catch (err) {
    estError.value = err instanceof Error ? err.message : String(err);
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
    await addRepo.mutateAsync({ taskId: task.value.id, codeRepoId: id });
  } catch (err) {
    fieldError.value = err instanceof Error ? err.message : String(err);
  }
}

function branchLabel(row: CardModel['rows'][number]): string {
  return row.draft ? `new branch · ${row.context.replace(/^no branch yet · /, '')}` : row.name;
}

const chipClass = (t: 'muted' | 'stale' | 'unknown'): string => (t === 'stale' ? 'text-tone-amber' : 'text-muted-foreground');
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 pt-3 text-kira-md"
    data-testid="ade-task-tab"
  >
    <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5">
      <label for="ade-task-name" class="text-kira-sm text-muted-foreground">Name</label>
      <Input
        id="ade-task-name"
        v-model="name"
        :placeholder="card.defaultTitle"
        size="kira-lg" class="font-semibold"
        data-testid="ade-task-name"
        @blur="commitName"
        @keydown.enter="commitName"
      />
      <span class="text-kira-sm text-muted-foreground">Status</span>
      <div class="flex h-7 items-center gap-2">
        <AdeChip :label="statusLabel" :tone="statusTone" />
        <span class="text-kira-sm text-subtle" data-testid="ade-task-status-why">follows the workflow: {{ why }}</span>
      </div>
      <AdeLinkRow
        id="ade-task-jira"
        label="Jira"
        chip=""
        :text="jira?.key ?? ''"
        :url="jira?.url ?? ''"
        placeholder="paste Jira link or key"
        :error="links.jiraError.value"
        @save="links.saveJira"
        @clear="links.clearJira"
      />
      <AdeLinkRow
        id="ade-task-github"
        label="GitHub"
        :chip="github?.kind ?? ''"
        :text="github?.ref ?? ''"
        :url="github ? task.githubUrl : ''"
        placeholder="paste GitHub issue or PR link"
        :error="links.githubError.value"
        @save="links.saveGithub"
        @clear="links.clearGithub"
      />
      <span class="text-kira-sm text-muted-foreground">Estimate</span>
      <AdeEstimateField :est="task.est" :days="spanDays" :error="estError" @save="saveEst" />
      <template v-if="!review">
        <span />
        <div class="flex h-7 items-center gap-2">
          <Switch
            id="ade-task-parked"
            :model-value="card.parked"
            data-testid="ade-task-parked"
            @update:model-value="(v: boolean) => write({ kind: v ? 'parked' : 'task' })"
          />
          <label for="ade-task-parked" class="text-kira-md">Not merging</label>
          <span class="text-kira-sm text-subtle">stays on the plan, never merged</span>
        </div>
      </template>
    </div>
    <p v-if="fieldError" class="text-kira-sm text-error" data-testid="ade-task-error">{{ fieldError }}</p>

    <AdeWorkflowBlock v-if="!review && !card.parked" :card="card" />

    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-2 pb-0.5">
        <span class="text-kira-sm text-muted-foreground">Branches</span>
        <span class="flex-1" />
        <template v-if="!review">
          <label for="ade-add-repo" class="sr-only">Add a repo to this task</label>
          <NativeSelect
            id="ade-add-repo"
            :model-value="addRepoValue"
            variant="default"
            class="max-w-50 border border-dashed border-border-strong"
            title="Add a new branch in this repo (created when work starts)"
            data-testid="ade-add-repo"
            @update:model-value="onAddRepo"
          >
            <option value="">+ Add repo…</option>
            <option v-for="r in lackedRepos" :key="r.codeRepoId" :value="r.codeRepoId">
              {{ r.nickname || r.name }} · {{ r.name }}
            </option>
          </NativeSelect>
        </template>
        <Button
          variant="dialog"
          size="kira"
          data-testid="ade-add-branch"
          @click="addUi.openAttach(task.id, card.title)"
        >
          + Add branch
        </Button>
      </div>
      <Button
        v-for="row in card.rows"
        :key="row.id"
        variant="ghost"
        class="h-8 w-full justify-start gap-2 bg-elevated px-1.5 text-left text-fg"
        data-testid="ade-task-branch"
        :data-branch-id="row.id"
        @click="ui.selectBranch(task.id, row.id)"
      >
        <AdeChip :label="tagLabel(row.tag, liveNow.getTime())" :tone="row.tag.tone" wide />
        <span
          class="shrink-0 rounded-kira-xs px-1.25 py-px text-kira-sm font-semibold"
          :class="tintOf(row.branch.codeRepoId).class"
          :style="tintOf(row.branch.codeRepoId).style"
          >{{ row.repo }}</span
        >
        <AdeTip v-for="c in integrationChips(row.branch)" :key="c.label" :text="c.tip">
          <span class="shrink-0 text-kira-sm font-semibold" :class="chipClass(c.tone)">{{ c.label }}</span>
        </AdeTip>
        <span
          class="min-w-0 flex-1 truncate font-data text-kira-md"
          :class="row.draft ? 'italic text-muted-foreground' : ''"
          >{{ branchLabel(row) }}</span
        >
      </Button>
    </div>
  </div>
</template>
