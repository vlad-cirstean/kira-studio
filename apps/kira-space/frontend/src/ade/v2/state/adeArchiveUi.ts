import { defineStore } from 'pinia';
import { ref } from 'vue';

// Archived browsing: the selected task, its panel tab and the list filter. In memory only; the
// Plan's history region opens the same panel through this selection.
export const useAdeArchiveUiStore = defineStore('adeArchiveUi', () => {
  const selectedTaskId = ref<string | null>(null);
  const tab = ref<'task' | 'notes' | 'sessions'>('task');
  const filter = ref('');

  function select(taskId: string | null): void {
    selectedTaskId.value = taskId;
  }

  return { selectedTaskId, tab, filter, select };
});
