import type { AppMetricsSample } from '@shared/protocol/events';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

export const useAppMetricsStore = defineStore('appMetrics', () => {
  const state = reactive({
    // Stays null until the main process's first tick — the status bar readout is hidden until
    // then, same convention as cacheStats.ts's own stats field.
    sample: null as AppMetricsSample | null,
  });

  let unsubscribe: (() => void) | null = null;

  function initAppMetrics(): void {
    if (unsubscribe) return;
    unsubscribe = control.onAppMetrics((sample) => {
      state.sample = sample;
    });
  }

  return { ...toRefs(state), initAppMetrics };
});
