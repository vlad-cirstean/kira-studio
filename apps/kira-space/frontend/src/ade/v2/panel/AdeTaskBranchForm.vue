<script setup lang="ts">
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { matchesQuery } from '@workbench/behaviour/match';
import { errorText } from '@workbench/bridge/codedError';
import { computed, ref, watch } from 'vue';
import AdeCandidateRow from '../AdeCandidateRow.vue';
import { useCandidates, useSetTaskBranch, useUpdateTaskRepo } from '../queries';
import type { Branch, CandidateBranch, Repo } from '../wire';

// Popover of one task row: pick the row's branch (an existing one or a new name) or its repo.
// P398 swaps the lists below for the shared branch and project pickers.
const props = defineProps<{
  branch: Branch;
  mode: 'branch' | 'repo';
  /** Repos the task does not use yet. */
  repos: readonly Repo[];
  repoLabel: string;
}>();
const open = defineModel<boolean>('open', { required: true });

const tab = ref('existing');
const tabs = computed(() => [
  {
    value: 'existing',
    label: t('space.ade.taskTab.branchForm.existing.label'),
    testid: 'ade-branch-form-existing',
  },
  {
    value: 'new',
    label: t('space.ade.taskTab.branchForm.new.label'),
    testid: 'ade-branch-form-new',
  },
]);
const q = ref('');
const name = ref('');
const error = ref('');

watch(open, (o) => {
  if (!o) return;
  tab.value = 'existing';
  q.value = '';
  name.value = '';
  error.value = '';
});

const candidates = useCandidates(() => open.value && props.mode === 'branch');
const shown = computed<CandidateBranch[]>(() =>
  (candidates.data.value?.branches ?? []).filter(
    (b) =>
      b.codeRepoId === props.branch.codeRepoId && matchesQuery(`${b.name} ${b.author}`, q.value),
  ),
);

const setBranch = useSetTaskBranch();
const setRepo = useUpdateTaskRepo();
const busy = computed(() => setBranch.isPending.value || setRepo.isPending.value);

async function submitBranch(branchName: string, existing: boolean): Promise<void> {
  error.value = '';
  try {
    await setBranch.mutateAsync({ branchId: props.branch.id, name: branchName, existing });
    open.value = false;
  } catch (err) {
    error.value = errorText(err);
  }
}

async function submitRepo(value: unknown): Promise<void> {
  const id = String(value ?? '');
  if (!id) return;
  error.value = '';
  try {
    await setRepo.mutateAsync({ branchId: props.branch.id, codeRepoId: id });
    open.value = false;
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverAnchor as-child><slot /></PopoverAnchor>
    <PopoverContent
      align="end"
      class="w-96 gap-0 overflow-hidden p-0"
      data-testid="ade-branch-form"
    >
      <template v-if="mode === 'branch'">
        <div class="border-b border-border p-1">
          <SecondaryTabs v-model="tab" :items="tabs" size="kira-lg" class="w-full" />
        </div>
        <div v-if="tab === 'existing'">
          <div class="border-b border-border p-1">
            <SearchField
              v-model="q"
              size="kira-lg"
              :placeholder="t('space.ade.add.searchBranches.placeholder')"
              :aria-label="t('space.ade.add.searchBranches.placeholder')"
              data-testid="ade-branch-form-search"
            />
          </div>
          <div class="max-h-60 overflow-auto p-1">
            <AdeCandidateRow
              v-for="b in shown"
              :key="b.name"
              :branch="b"
              :repo="repoLabel"
              @select="submitBranch(b.name, true)"
            />
            <div v-if="shown.length === 0" class="p-2 text-kira-md text-muted-foreground">{{
              t('space.common.noBranches.empty')
            }}</div>
          </div>
        </div>
        <form
          v-else
          class="flex items-center gap-2 p-2"
          @submit.prevent="submitBranch(name.trim(), false)"
        >
          <Input
            v-model="name"
            :placeholder="t('git.dialog.worktree.newBranch.label')"
            :aria-label="t('git.dialog.worktree.newBranch.label')"
            data-testid="ade-branch-form-name"
          />
          <Button
            type="submit"
            variant="dialog-primary"
            size="kira-lg"
            :disabled="name.trim() === ''"
            :pending="busy"
            data-testid="ade-branch-form-create"
          >
            {{ t('common.action.create.label') }}
          </Button>
        </form>
      </template>
      <div v-else class="p-2">
        <NativeSelect
          model-value=""
          variant="default"
          class="w-full"
          :aria-label="t('space.ade.taskTab.branchForm.repo.aria')"
          :disabled="busy"
          data-testid="ade-branch-form-repo"
          @update:model-value="submitRepo"
        >
          <option value="">{{ t('common.action.choose.label') }}</option>
          <option v-for="r in repos" :key="r.codeRepoId" :value="r.codeRepoId">
            {{ r.nickname || r.name }}
            · {{ r.name }}
          </option>
        </NativeSelect>
      </div>
      <div v-if="error" class="m-2 mt-0">
        <Alert variant="error" data-testid="ade-branch-form-error"
          ><AlertDescription>{{ error }}</AlertDescription></Alert
        >
      </div>
    </PopoverContent>
  </Popover>
</template>
