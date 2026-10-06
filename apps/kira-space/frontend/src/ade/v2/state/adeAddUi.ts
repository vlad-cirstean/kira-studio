import { defineStore } from 'pinia';
import { ref } from 'vue';

// The Add popover: open state, and the task it attaches an existing branch to (else a new task).
export const useAdeAddUiStore = defineStore('adeAddUi', () => {
  const addOpen = ref(false);
  const attachTo = ref<{ taskId: string; title: string } | null>(null);

  function openAttach(taskId: string, title: string): void {
    attachTo.value = { taskId, title };
    addOpen.value = true;
  }

  return { addOpen, attachTo, openAttach };
});
