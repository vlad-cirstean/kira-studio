import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';

// Board view state: what the Plan shows. The three toggles persist per window profile; the
// selection is in memory only.
export const useAdeBoardUiStore = defineStore('adeBoardUi', () => {
  const selectedTaskId = ref<string | null>(null);
  const showAllItems = useLocalStorage('kira.ade.showAllItems', false);
  const showHistory = useLocalStorage('kira.ade.showHistory', false);
  const hiddenRepoIds = useLocalStorage<string[]>('kira.ade.hiddenRepoIds', []);

  function select(taskId: string | null): void {
    selectedTaskId.value = taskId;
  }

  function toggleRepo(codeRepoId: string): void {
    hiddenRepoIds.value = hiddenRepoIds.value.includes(codeRepoId)
      ? hiddenRepoIds.value.filter((id) => id !== codeRepoId)
      : [...hiddenRepoIds.value, codeRepoId];
  }

  return { selectedTaskId, showAllItems, showHistory, hiddenRepoIds, select, toggleRepo };
});
