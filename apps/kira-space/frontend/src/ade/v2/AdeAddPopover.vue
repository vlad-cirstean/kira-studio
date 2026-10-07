<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, watch } from 'vue';
import AdeCandidateRow from './AdeCandidateRow.vue';
import { parseJira } from './jira';
import { repoColor } from './palette';
import { useAddExistingBranch, useCandidates, useCreateTask, useRepos } from './queries';
import { useAdeAddUiStore } from './state/adeAddUi';
import { useAdeBoardUiStore } from './state/adeBoardUi';
import type { CandidateBranch } from './wire';

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
const error = ref('');

const repos = useRepos();
const repoLabel = (id: string): string => {
  const r = repos.data.value?.repos.find((x) => x.codeRepoId === id);
  return r?.nickname || r?.name || id;
};

const title = ref('');
const jira = ref('');
const notes = ref('');
const picked = ref<string[]>([]);
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
    });
    ui.select(task.id);
    title.value = '';
    jira.value = '';
    notes.value = '';
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

const tabClass =
  'h-9 cursor-pointer border-b-2 border-transparent px-2.5 text-kira-md text-muted-foreground data-[state=active]:border-b-fg data-[state=active]:font-semibold data-[state=active]:text-fg';
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="dialog" size="xs" class="gap-1.5 rounded-kira px-2.5" data-testid="ade-add">
        <CodiconIcon name="add" :size="12" />
        Add task
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-[460px] gap-0 overflow-hidden rounded-[10px] p-0" data-testid="ade-add-popover">
      <Tabs v-model="tab" class="gap-0">
        <TabsList class="w-full gap-0.5 border-b border-border px-2">
          <TabsTrigger v-if="!attachTo" value="new" :class="tabClass" data-testid="ade-add-tab-new">New task</TabsTrigger>
          <TabsTrigger value="branch" :class="tabClass" data-testid="ade-add-tab-branch">Existing branch</TabsTrigger>
        </TabsList>
      </Tabs>
      <div v-if="tab === 'new'" class="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 p-3 text-kira-md">
        <label for="ade-nw-title" class="text-muted-foreground">Title</label>
        <Input id="ade-nw-title" v-model="title" placeholder="What needs doing" data-testid="ade-nw-title" />
        <label for="ade-nw-jira" class="text-muted-foreground">Jira</label>
        <Input
          id="ade-nw-jira"
          v-model="jira"
          placeholder="paste link or key (optional)"
          class="font-data"
          data-testid="ade-nw-jira"
        />
        <span class="text-muted-foreground">Repos</span>
        <fieldset aria-label="Repos" class="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <button
            v-for="r in repos.data.value?.repos ?? []"
            :key="r.codeRepoId"
            type="button"
            class="h-6 cursor-pointer rounded-kira-sm border px-2 font-data text-kira-sm font-semibold"
            :class="picked.includes(r.codeRepoId) ? '' : 'border-border-strong bg-transparent text-muted-foreground'"
            :style="
              picked.includes(r.codeRepoId)
                ? { background: `${repoColor(r.codeRepoId)}1f`, color: repoColor(r.codeRepoId), borderColor: repoColor(r.codeRepoId) }
                : undefined
            "
            :aria-pressed="picked.includes(r.codeRepoId)"
            data-testid="ade-nw-repo"
            @click="toggleRepo(r.codeRepoId)"
          >
            {{ r.nickname || r.name }}
          </button>
        </fieldset>
        <label for="ade-nw-notes" class="self-start pt-1.5 text-muted-foreground">Notes</label>
        <Textarea
          id="ade-nw-notes"
          v-model="notes"
          placeholder="Context for Claude (optional)"
          class="resize-y"
          data-testid="ade-nw-notes"
        />
        <span />
        <div class="flex items-center gap-2.5">
          <Button variant="dialog-primary" size="xs" class="px-3" :disabled="cantAdd" data-testid="ade-nw-add" @click="addNew">
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
          adding to: <span class="font-semibold text-fg">{{ attachTo.title }}</span>
        </p>
        <label for="ade-branch-search" class="sr-only">Search branches</label>
        <Input
          id="ade-branch-search"
          v-model="q"
          placeholder="Search branches in all repos…"
          class="h-9 w-full rounded-none border-0 border-b border-border bg-transparent px-3"
          data-testid="ade-branch-search"
        />
        <div class="max-h-[280px] overflow-auto p-1">
          <AdeCandidateRow v-for="b in shown" :key="`${b.codeRepoId}/${b.name}`" :branch="b" :repo="repoLabel(b.codeRepoId)" @pick="pick(b)" />
          <div v-if="shown.length === 0" class="p-2.5 text-kira-md text-muted-foreground">No branches</div>
        </div>
      </div>
      <p v-if="error" class="px-3 pb-2 text-kira-sm text-error" data-testid="ade-add-error">{{ error }}</p>
    </PopoverContent>
  </Popover>
</template>
