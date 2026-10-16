import { defineStore } from 'pinia';
import { ref } from 'vue';

/** A Run now confirm: this window opened it for one script. */
export interface ScheduleConfirmRequest {
  scriptId: string;
}

// One concern: the Run now confirm popup. Waiting scheduled runs are routed prompts instead.
export const useScheduleConfirmStore = defineStore('scheduleConfirm', () => {
  const request = ref<ScheduleConfirmRequest | null>(null);

  function openNow(scriptId: string): void {
    request.value = { scriptId };
  }

  function close(): void {
    request.value = null;
  }

  return { request, openNow, close };
});
