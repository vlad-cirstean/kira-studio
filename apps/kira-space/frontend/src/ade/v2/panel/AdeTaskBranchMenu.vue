<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import { atRisk } from '../dialog/compose';
import { blockedReason } from '../dialog/flow';
import type { BranchRowModel } from '../plan/usePlanModel';
import { useRemoveTaskBranch, useRemoveTaskRepo, useTaskBranchRisk } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { BranchRisk } from '../wire';
import AdeTaskBranchForm from './AdeTaskBranchForm.vue';

// Row menu of the Task tab: add or change the branch, change or remove the repo (P397).
const props = defineProps<{
  row: BranchRowModel;
  /** Repos the task already uses, `row`'s included. */
  usedRepoIds: readonly string[];
}>();
const emit = defineEmits<{ error: [message: string] }>();

const ui = useAdeBoardUiStore();
const confirm = useConfirmDialogStore();
const repos = useRepos();
const riskM = useTaskBranchRisk();
const removeBranch = useRemoveTaskBranch();
const removeRepo = useRemoveTaskRepo();

const formOpen = ref(false);
const mode = ref<'branch' | 'repo'>('branch');
const lacked = computed(() => {
  const used = new Set(props.usedRepoIds);
  return (repos.data.value?.repos ?? []).filter((r) => !used.has(r.codeRepoId));
});
const label = computed(() => props.row.name || props.row.repo);

function openForm(next: 'branch' | 'repo'): void {
  mode.value = next;
  formOpen.value = true;
}

function riskText(risk: BranchRisk): string {
  return [
    risk.dirty.length
      ? t('space.ade.agentDialog.riskUncommitted.label', { count: risk.dirty.length })
      : '',
    risk.unmerged ? t('space.ade.agentDialog.riskUnmerged.label', { count: risk.unmerged }) : '',
  ]
    .filter(Boolean)
    .join(', ');
}

async function remove(what: 'branch' | 'repo'): Promise<void> {
  emit('error', '');
  const branchId = props.row.id;
  const run = async (): Promise<void> => {
    await (what === 'branch' ? removeBranch : removeRepo).mutateAsync({ branchId });
    if (ui.selectedBranchId === branchId) ui.select(props.row.branch.taskId);
  };
  try {
    const risk = await riskM.mutateAsync({ branchId });
    if (risk.blocked !== '') {
      emit(
        'error',
        t('space.ade.taskTab.branchMenu.blocked.error', {
          name: label.value,
          reason: blockedReason(risk.blocked),
        }),
      );
      return;
    }
    if (!atRisk(risk)) {
      await run();
      return;
    }
    await confirm.confirm({
      tone: 'danger',
      title:
        what === 'branch'
          ? t('space.ade.taskTab.branchMenu.removeBranchConfirm.title')
          : t('space.ade.taskTab.branchMenu.removeRepoConfirm.title'),
      message: t('space.ade.taskTab.branchMenu.removeConfirm.body', {
        name: label.value,
        risk: [riskText(risk), ...risk.dirty.map((d) => d.path)].join(' · '),
      }),
      confirmLabel: t('common.action.remove.label'),
      run,
    });
  } catch (err) {
    emit('error', errorText(err));
  }
}
</script>

<template>
  <AdeTaskBranchForm
    v-model:open="formOpen"
    :branch="row.branch"
    :mode="mode"
    :repos="lacked"
    :repo-label="row.repo"
  >
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="toolbar"
          size="kira-icon"
          class="size-5 shrink-0"
          :aria-label="t('space.ade.taskTab.branchMenu.trigger.aria')"
          data-testid="ade-task-branch-menu"
          :data-branch-id="row.id"
        >
          <CodiconIcon name="ellipsis" :size="13" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-testid="ade-task-branch-menu-content"
        @close-auto-focus.prevent
      >
        <template v-if="row.draft">
          <DropdownMenuItem data-testid="ade-task-branch-add" @select="openForm('branch')">{{
            t('space.ade.taskTab.branchMenu.addBranch.label')
          }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="ade-task-repo-change" @select="openForm('repo')">{{
            t('space.ade.taskTab.branchMenu.changeRepo.label')
          }}</DropdownMenuItem>
        </template>
        <template v-else>
          <DropdownMenuItem data-testid="ade-task-branch-change" @select="openForm('branch')">{{
            t('space.ade.taskTab.branchMenu.changeBranch.label')
          }}</DropdownMenuItem>
          <DropdownMenuItem data-testid="ade-task-branch-remove" @select="remove('branch')">{{
            t('space.ade.taskTab.branchMenu.removeBranch.label')
          }}</DropdownMenuItem>
        </template>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="ade-task-repo-remove" @select="remove('repo')">{{
          t('space.ade.taskTab.branchMenu.removeRepo.label')
        }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </AdeTaskBranchForm>
</template>
