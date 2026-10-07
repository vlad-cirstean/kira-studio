import { defineStore } from 'pinia';
import { ref } from 'vue';

// P201: Memory module UI state that must survive a mode switch.
export const useMemoryUiStore = defineStore('memoryUi', () => {
  const query = ref('');
  const includeHistory = ref(false);
  const selectedId = ref<string | null>(null);
  const addOpen = ref(false);
  const connectOpen = ref(false);
  return { query, includeHistory, selectedId, addOpen, connectOpen };
});
