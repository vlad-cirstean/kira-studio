import { defineStore } from 'pinia';
import { ref } from 'vue';

// P211: bulk-import UI state that must survive a mode switch.
export const useImportUiStore = defineStore('memoryImportUi', () => {
  const view = ref<'memory' | 'imports'>('memory');
  const selectedJobId = ref<string | null>(null);
  // The freshly scanned job awaiting the user's confirmation.
  const confirmJobId = ref<string | null>(null);
  const selectedFileId = ref<string | null>(null);
  return { view, selectedJobId, confirmJobId, selectedFileId };
});
