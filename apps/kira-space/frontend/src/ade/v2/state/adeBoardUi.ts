import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';

// Board view state: which page is open and what the panel shows. The three Plan toggles persist
// per window profile; selection and the last refresh summaries are in memory only.
export const useAdeBoardUiStore = defineStore('adeBoardUi', () => {
  const view = ref<'plan' | 'backlog' | 'workflows' | 'repos'>('plan');
  const selectedTaskId = ref<string | null>(null);
  const selectedBranchId = ref<string | null>(null);
  /** Workflows page: selected file name (`null` = first listed) and editor mode. */
  const workflowFile = ref<string | null>(null);
  const workflowMode = ref<'form' | 'yaml'>('form');
  /** Repos page: selected repo (`null` = first listed). */
  const repoId = ref<string | null>(null);
  /** Days of history shown beyond the settings window after a Go to; in memory only. */
  const historyReach = ref<number | null>(null);
  /** The Add popover: open state, and the task it attaches an existing branch to (else a new task). */
  const addOpen = ref(false);
  const attachTo = ref<{ taskId: string; title: string } | null>(null);
  /** Per repo: what the last fetch changed, shown on its chip until the next fetch. */
  const refreshSummary = ref<Record<string, string>>({});
  const showAllItems = useLocalStorage('kira.ade.showAllItems', false);
  const showHistory = useLocalStorage('kira.ade.showHistory', false);
  const hiddenRepoIds = useLocalStorage<string[]>('kira.ade.hiddenRepoIds', []);

  function select(taskId: string | null): void {
    selectedTaskId.value = taskId;
    selectedBranchId.value = null;
  }

  function selectBranch(taskId: string, branchId: string): void {
    selectedTaskId.value = taskId;
    selectedBranchId.value = branchId;
  }

  /** Opens the Plan with `taskId` selected. */
  function openTask(taskId: string): void {
    view.value = 'plan';
    select(taskId);
  }

  /** Opens the Workflows page on `fileName`. */
  function openWorkflow(fileName: string | null): void {
    workflowFile.value = fileName;
    view.value = 'workflows';
  }

  function openAttach(taskId: string, title: string): void {
    attachTo.value = { taskId, title };
    addOpen.value = true;
  }

  function toggleRepo(codeRepoId: string): void {
    hiddenRepoIds.value = hiddenRepoIds.value.includes(codeRepoId)
      ? hiddenRepoIds.value.filter((id) => id !== codeRepoId)
      : [...hiddenRepoIds.value, codeRepoId];
  }

  return {
    view,
    selectedTaskId,
    selectedBranchId,
    workflowFile,
    workflowMode,
    repoId,
    historyReach,
    addOpen,
    attachTo,
    refreshSummary,
    showAllItems,
    showHistory,
    hiddenRepoIds,
    select,
    selectBranch,
    openTask,
    openWorkflow,
    openAttach,
    toggleRepo,
  };
});
