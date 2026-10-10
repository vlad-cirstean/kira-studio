import { defineStore } from 'pinia';
import { ref } from 'vue';

/** What the confirm popup shows: a waiting run (`runId`), or a Run now request (null). */
export interface ScheduleConfirmRequest {
  scriptId: string;
  runId: string | null;
}

// One concern: the schedule confirm popup. `request` is one opened by this window (Run now, Review
// and run); a waiting run otherwise shows by itself in the main window until it is dismissed here.
export const useScheduleConfirmStore = defineStore('scheduleConfirm', () => {
  const request = ref<ScheduleConfirmRequest | null>(null);
  const dismissed = ref<string[]>([]);

  function openNow(scriptId: string): void {
    request.value = { scriptId, runId: null };
  }

  function openRun(run: { id: string; scriptId: string }): void {
    dismissed.value = dismissed.value.filter((id) => id !== run.id);
    request.value = { scriptId: run.scriptId, runId: run.id };
  }

  /** Closes the popup; a waiting run stays waiting and hides until reopened. */
  function close(runId: string | null): void {
    request.value = null;
    if (runId) dismiss(runId);
  }

  function dismiss(runId: string): void {
    if (!dismissed.value.includes(runId)) dismissed.value = [...dismissed.value, runId];
  }

  return { request, dismissed, openNow, openRun, close, dismiss };
});
