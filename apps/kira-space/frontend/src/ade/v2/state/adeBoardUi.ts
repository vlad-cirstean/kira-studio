import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { OpenSessionEvent } from '../wire';

// Board view state: which page is open and what the panel shows. Workflows and the Add
// popover keep their own state in `adeWorkflowsUi` and `adeAddUi`. The three Plan toggles persist
// per window profile; selection and the last refresh summaries are in memory only.
export const useAdeBoardUiStore = defineStore('adeBoardUi', () => {
  const view = ref<'plan' | 'backlog' | 'needs' | 'workflows'>('plan');
  const selectedTaskId = ref<string | null>(null);
  const selectedBranchId = ref<string | null>(null);
  /** Active tab of the task panel and of the branch panel; Sessions is reachable from anywhere. */
  const taskTab = ref('task');
  const branchTab = ref('details');
  /** Session selected in the Sessions tab (`null` = first listed). */
  const sessionId = ref<string | null>(null);
  /** Days of history shown beyond the settings window after a Go to; in memory only. */
  const historyReach = ref<number | null>(null);
  /** A See error click asked the open branch panel to scroll to its Worktree setup block. */
  const focusSetup = ref(false);
  /** Task whose agent Run dialog is open. */
  const runTaskId = ref<string | null>(null);
  /** Last failed stage action per task, shown in the panel header until the next attempt. */
  const actionError = ref<Record<string, string>>({});
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

  /** Selects the task or branch of a session and opens its Sessions tab on it. */
  function openSession(e: OpenSessionEvent): void {
    view.value = 'plan';
    if (e.branchId) selectBranch(e.taskId, e.branchId);
    else select(e.taskId);
    if (e.branchId) branchTab.value = 'sessions';
    else taskTab.value = 'sessions';
    sessionId.value = e.sessionId;
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
    taskTab,
    branchTab,
    sessionId,
    historyReach,
    runTaskId,
    focusSetup,
    actionError,
    refreshSummary,
    showAllItems,
    showHistory,
    hiddenRepoIds,
    select,
    selectBranch,
    openTask,
    openSession,
    toggleRepo,
  };
});
