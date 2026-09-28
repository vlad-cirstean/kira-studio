<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { Textarea } from '@theme/components/ui/textarea';
import { formatTimeAgo } from '@vueuse/core';
import { computed, ref } from 'vue';
import { adeAgoOptions } from './ago';
import { parseJira } from './jira';
import { useAdeCandidates } from './queries';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import type { QueueItem } from './useQueue';

// P129 Part 5 §0.19: the Add popover (mockup 100-155/1341-1378), mounted in `AdeMainLine`'s own
// default slot. Two tabs, each ending in its own queue write (`AddNewWork`/`AddBranch`) then
// selecting the new item and closing — neither writes a plan day (§5.2: a freshly queued item sits
// in Later until the user drags/moves it, same as any other undated item).
const props = defineProps<{
  codeRepoId: string;
  /** Start-from options (§0.19: `main` plus every non-draft, non-parked queue item) — the caller's
   *  own `view.items`; this component stays ignorant of `useQueue` beyond the plain `QueueItem`
   *  shape, same discipline `AdeStackBlock`/`AdeDayBand` already hold to. */
  items: readonly QueueItem[];
}>();

const adeActionsStore = useAdeActionsStore();
const adeUiStore = useAdeUiStore();

const open = ref(false);
const activeTab = ref<'new' | 'existing' | 'dependency'>('new');

function onOpenChange(value: boolean): void {
  open.value = value;
  if (value) {
    activeTab.value = 'new';
    resetDependency();
  }
}

// --- New work tab (mockup 1357) ------------------------------------------------------------------

const title = ref('');
const jira = ref('');
const startFrom = ref('main');
const notes = ref('');
const addingNewWork = ref(false);

const startFromOptions = computed(() => [
  { value: 'main', label: 'main' },
  ...props.items
    .filter((it) => !it.draft && it.kind !== 'parked' && it.kind !== 'dependency')
    .map((it) => ({ value: it.branch, label: it.title })),
]);

const jiraParsed = computed(() => parseJira(jira.value));
const canAddNewWork = computed(() => title.value.trim() !== '' || jiraParsed.value.key !== '');

function resetNewWork(): void {
  title.value = '';
  jira.value = '';
  startFrom.value = 'main';
  notes.value = '';
}

async function submitNewWork(): Promise<void> {
  if (!canAddNewWork.value || addingNewWork.value) return;
  addingNewWork.value = true;
  try {
    const parsed = jiraParsed.value;
    const id = await adeActionsStore.addNewWork(props.codeRepoId, {
      title: title.value.trim(),
      jiraKey: parsed.key,
      jiraUrl: parsed.url,
      startFrom: startFrom.value,
      notes: notes.value,
      est: '',
    });
    adeUiStore.select(props.codeRepoId, id);
    resetNewWork();
    open.value = false;
  } finally {
    addingNewWork.value = false;
  }
}

// --- Existing branch tab ---------------------------------------------------------------------

// `enabled: open` — the query only ever runs while this popover is on screen (§0.19).
const candidatesQuery = useAdeCandidates(
  () => props.codeRepoId,
  () => open.value,
);
const pickingBranch = ref<string | null>(null);

function agoOf(lastCommitAt: number): string {
  return formatTimeAgo(new Date(lastCommitAt), adeAgoOptions);
}

async function pick(branch: string): Promise<void> {
  if (pickingBranch.value) return;
  pickingBranch.value = branch;
  try {
    const id = await adeActionsStore.addBranch(props.codeRepoId, branch);
    adeUiStore.select(props.codeRepoId, id);
    open.value = false;
  } finally {
    pickingBranch.value = null;
  }
}

// --- Dependency tab (P135 §4.8) ----------------------------------------------------------------

const depTitle = ref('');
const depWaitingOn = ref('');
const depExpectedBy = ref('');
const depBlocks = ref('');
const addingDependency = ref(false);

/** Live `mine`/`parked` branches and new work — `checkBlockable`'s own repo-side rule (never
 *  `review`, never another `dependency`). */
const blockOptions = computed(() =>
  props.items.filter((it) => it.kind === 'mine' || it.kind === 'parked'),
);

function resetDependency(): void {
  depTitle.value = '';
  depWaitingOn.value = '';
  depExpectedBy.value = '';
  const selected = adeUiStore.selectedByRepo[props.codeRepoId];
  depBlocks.value = selected && blockOptions.value.some((it) => it.id === selected) ? selected : '';
}

const canAddDependency = computed(() => depTitle.value.trim() !== '');

async function submitDependency(): Promise<void> {
  if (!canAddDependency.value || addingDependency.value) return;
  addingDependency.value = true;
  try {
    const id = await adeActionsStore.addDependency(props.codeRepoId, {
      title: depTitle.value.trim(),
      waitingOn: depWaitingOn.value,
      expectedBy: depExpectedBy.value,
      blocks: depBlocks.value ? [depBlocks.value] : [],
    });
    adeUiStore.select(props.codeRepoId, id);
    open.value = false;
  } finally {
    addingDependency.value = false;
  }
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Button variant="secondary" size="sm" class="shrink-0" data-testid="ade-add-open">+ Add</Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-[440px] gap-0 p-0" data-testid="ade-add-popover">
      <Tabs
        :model-value="activeTab"
        class="gap-0"
        @update:model-value="(v) => (activeTab = v as 'new' | 'existing' | 'dependency')"
      >
        <TabsList class="w-full p-1">
          <TabsTrigger value="new" class="flex-1" data-testid="ade-add-tab-new">New work</TabsTrigger>
          <TabsTrigger value="existing" class="flex-1" data-testid="ade-add-tab-existing"
            >Existing branch</TabsTrigger
          >
          <TabsTrigger value="dependency" class="flex-1" data-testid="ade-add-tab-dependency"
            >Dependency</TabsTrigger
          >
        </TabsList>
        <TabsContent value="new" class="flex flex-col gap-2 p-2.5">
          <Input v-model="title" placeholder="Title" data-testid="ade-add-title" />
          <Input
            v-model="jira"
            class="font-data"
            placeholder="paste link or key (optional)"
            data-testid="ade-add-jira"
          />
          <NativeSelect v-model="startFrom" data-testid="ade-add-start-from">
            <option v-for="opt in startFromOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </NativeSelect>
          <Textarea v-model="notes" placeholder="Notes (optional)" data-testid="ade-add-notes" />
          <p class="text-kira-sm text-muted-foreground">No branch yet. Claude creates it on Start.</p>
          <Button
            :disabled="!canAddNewWork || addingNewWork"
            data-testid="ade-add-submit-new"
            @click="submitNewWork"
          >
            {{ addingNewWork ? 'Adding…' : 'Add to Later' }}
          </Button>
        </TabsContent>
        <TabsContent value="existing" class="flex flex-col p-0">
          <Command class="rounded-none bg-transparent p-0">
            <CommandInput placeholder="Search branches…" data-testid="ade-add-search" />
            <CommandList class="max-h-72 p-1">
              <CommandEmpty data-testid="ade-add-empty">No branches</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="c in candidatesQuery.data.value ?? []"
                  :key="c.name"
                  :value="c.name"
                  :disabled="pickingBranch !== null"
                  data-testid="ade-add-candidate"
                  :data-branch="c.name"
                  @select="pick(c.name)"
                >
                  <span class="shrink-0 text-kira-sm text-muted-foreground">{{ agoOf(c.lastCommitAt) }}</span>
                  <span class="shrink-0 text-muted-foreground">·</span>
                  <span
                    class="shrink-0 rounded-kira-sm px-1 text-kira-sm"
                    :class="c.mine ? 'bg-[#23252b]' : 'text-[#7aa7ff]'"
                    >{{ c.mine ? 'you' : c.author }}</span
                  >
                  <span class="shrink-0 text-muted-foreground">·</span>
                  <span class="min-w-0 truncate font-data">{{ c.name }}</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </TabsContent>
        <TabsContent value="dependency" class="flex flex-col gap-2 p-2.5">
          <Input v-model="depTitle" placeholder="Title" data-testid="ade-add-dependency-title" />
          <Textarea
            v-model="depWaitingOn"
            placeholder="Waiting on (optional)"
            data-testid="ade-add-dependency-waiting-on"
          />
          <Input
            v-model="depExpectedBy"
            type="date"
            data-testid="ade-add-dependency-expected-by"
          />
          <NativeSelect v-model="depBlocks" data-testid="ade-add-dependency-blocks">
            <option value="">None</option>
            <option v-for="opt in blockOptions" :key="opt.id" :value="opt.id">
              {{ opt.title }}
            </option>
          </NativeSelect>
          <Button
            :disabled="!canAddDependency || addingDependency"
            data-testid="ade-add-dependency-submit"
            @click="submitDependency"
          >
            {{ addingDependency ? 'Adding…' : 'Add dependency' }}
          </Button>
        </TabsContent>
      </Tabs>
    </PopoverContent>
  </Popover>
</template>
