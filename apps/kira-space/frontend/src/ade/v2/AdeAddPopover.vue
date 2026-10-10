<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { Textarea } from '@theme/components/ui/textarea';
import { Toggle } from '@theme/components/ui/toggle';
import { computed, ref, watch } from 'vue';
import { useRepoLinksStore } from '../../repo/state/repoLinks';
import { useRepos } from '../../repo/state/reposQueries';
import { repoTint } from '../../state/coderepos';
import AdeBasePicker from './AdeBasePicker.vue';
import AdeCandidateRow from './AdeCandidateRow.vue';
import { parseJira } from './jira';
import { useAddExistingBranch, useCandidates, useCreateTask } from './queries';
import { useAdeAddUiStore } from './state/adeAddUi';
import { useAdeBoardUiStore } from './state/adeBoardUi';
import type { BaseChoice, CandidateBranch } from './wire';

// Add: a new task (lands in Later, branchless) or an existing branch of any repo.
const ui = useAdeBoardUiStore();
const addUi = useAdeAddUiStore();
const open = computed({
  get: () => addUi.addOpen,
  set: (v) => {
    addUi.addOpen = v;
  },
});
const attachTo = computed(() => addUi.attachTo);
const tab = ref('new');
const tabItems = computed(() => [
  ...(addUi.attachTo ? [] : [{ value: 'new', label: 'New task', testid: 'ade-add-tab-new' }]),
  { value: 'branch', label: 'Existing branch', testid: 'ade-add-tab-branch' },
]);
const error = ref('');

const repos = useRepos();
const repoLinks = useRepoLinksStore();
const tintOf = (id: string) => repoTint(repoLinks.repoColorOf(id), true);
const repoLabel = (id: string): string => {
  const r = repos.data.value?.repos.find((x) => x.codeRepoId === id);
  return r?.nickname || r?.name || id;
};

const title = ref('');
const jira = ref('');
const notes = ref('');
const picked = ref<string[]>([]);
/** Per repo; a repo without an entry starts from its main. */
const bases = ref<Record<string, BaseChoice>>({});
const MAIN: BaseChoice = { ref: '', branchId: '' };
const createTask = useCreateTask();

watch(open, (o) => {
  if (!o) {
    addUi.attachTo = null;
    return;
  }
  error.value = '';
  if (addUi.attachTo) tab.value = 'branch';
  if (picked.value.length === 0) {
    const first = repos.data.value?.repos[0];
    if (first) picked.value = [first.codeRepoId];
  }
});

function toggleRepo(id: string): void {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id];
  bases.value = Object.fromEntries(Object.entries(bases.value).filter(([k]) => picked.value.includes(k)));
}

const cantAdd = computed(
  () => title.value.trim() === '' || picked.value.length === 0 || createTask.isPending.value,
);

async function addNew(): Promise<void> {
  error.value = '';
  const j = parseJira(jira.value);
  try {
    const task = await createTask.mutateAsync({
      title: title.value.trim(),
      jira: j.key ? j : null,
      githubUrl: '',
      notes: notes.value,
      codeRepoIds: picked.value,
      workflowId: '',
      bases: bases.value,
    });
    ui.select(task.id);
    title.value = '';
    jira.value = '';
    notes.value = '';
    bases.value = {};
    open.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const q = ref('');
const candidates = useCandidates(() => open.value && tab.value === 'branch');
const addBranch = useAddExistingBranch();
const shown = computed<CandidateBranch[]>(() => {
  const needle = q.value.trim().toLowerCase();
  const all = candidates.data.value?.branches ?? [];
  if (!needle) return all;
  return all.filter((b) =>
    `${b.name} ${repoLabel(b.codeRepoId)} ${b.author}`.toLowerCase().includes(needle),
  );
});

async function pick(b: CandidateBranch): Promise<void> {
  error.value = '';
  try {
    const res = await addBranch.mutateAsync({
      codeRepoId: b.codeRepoId,
      name: b.name,
      taskId: attachTo.value?.taskId ?? '',
    });
    ui.select(res.task.id);
    open.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="dialog" size="kira-lg" data-testid="ade-add">
        <CodiconIcon name="add" :size="12" />
        Add task
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-120 gap-0 overflow-hidden p-0" data-testid="ade-add-popover">
      <div class="border-b border-border p-1">
        <SecondaryTabs v-model="tab" :items="tabItems" size="kira-lg" class="w-full" />
      </div>
      <div v-if="tab === 'new'" class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-3 text-kira-md">
        <Label for="ade-nw-title" class="font-normal text-muted-foreground">Title</Label>
        <Input id="ade-nw-title" v-model="title" placeholder="What needs doing" data-testid="ade-nw-title" />
        <Label for="ade-nw-jira" class="font-normal text-muted-foreground">Jira</Label>
        <Input
          id="ade-nw-jira"
          v-model="jira"
          placeholder="paste link or key (optional)"
          data-testid="ade-nw-jira"
        />
        <span class="text-muted-foreground">Repos</span>
        <fieldset aria-label="Repos" class="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <Toggle
            v-for="r in repos.data.value?.repos ?? []"
            :key="r.codeRepoId"
            variant="outline"
            size="kira"
            class="text-muted-foreground"
            :class="picked.includes(r.codeRepoId) ? tintOf(r.codeRepoId).class : ''"
            :style="picked.includes(r.codeRepoId) ? tintOf(r.codeRepoId).style : undefined"
            :model-value="picked.includes(r.codeRepoId)"
            data-testid="ade-nw-repo"
            @update:model-value="toggleRepo(r.codeRepoId)"
          >
            {{ r.nickname || r.name }}
          </Toggle>
        </fieldset>
        <template v-for="id in picked" :key="id">
          <span class="text-muted-foreground" data-testid="ade-nw-base-label">Base · {{ repoLabel(id) }}</span>
          <div class="min-w-0" :data-repo-id="id" data-testid="ade-nw-base">
            <AdeBasePicker
              :code-repo-id="id"
              :model-value="bases[id] ?? MAIN"
              @update:model-value="(c) => (bases[id] = c)"
            />
          </div>
        </template>
        <Label for="ade-nw-notes" class="font-normal self-start pt-1.5 text-muted-foreground">Notes</Label>
        <Textarea
          id="ade-nw-notes"
          v-model="notes"
          placeholder="Context for Claude (optional)"
          class="resize-y"
          data-testid="ade-nw-notes"
        />
        <span />
        <div class="flex items-center gap-2.5">
          <Button variant="dialog-primary" size="kira-lg" :disabled="cantAdd" data-testid="ade-nw-add" @click="addNew">
            Add to Later
          </Button>
          <span class="text-kira-sm text-subtle">No branches yet. Claude creates one per repo on Start.</span>
        </div>
      </div>
      <div v-else>
        <p
          v-if="attachTo"
          class="truncate border-b border-border px-3 py-1.5 text-kira-sm text-muted-foreground"
          data-testid="ade-add-attach"
        >
          adding to: <span class="font-medium text-fg">{{ attachTo.title }}</span>
        </p>
        <div class="border-b border-border p-1">
          <SearchField
            v-model="q"
            size="kira-lg"
            placeholder="Search branches in all repos…"
            aria-label="Search branches"
            data-testid="ade-branch-search"
          />
        </div>
        <div class="max-h-70 overflow-auto p-1">
          <AdeCandidateRow v-for="b in shown" :key="`${b.codeRepoId}/${b.name}`" :branch="b" :repo="repoLabel(b.codeRepoId)" @pick="pick(b)" />
          <div v-if="shown.length === 0" class="p-2.5 text-kira-md text-muted-foreground">No branches</div>
        </div>
      </div>
      <p v-if="error" class="px-3 pb-2 text-kira-sm text-error" data-testid="ade-add-error">{{ error }}</p>
    </PopoverContent>
  </Popover>
</template>
