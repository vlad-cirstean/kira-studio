import type { AppMetricsSample } from '@shared/protocol/events';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// P116 H6: hoisted from Kira Studio's own state/appMetrics.ts, unchanged — both apps' own status
// bar reads the identical shape (one process's CPU/memory sample), so this needs no `extend` seam.

export interface AppMetricsControl {
  onAppMetrics(cb: (sample: AppMetricsSample) => void): () => void;
}

export function createAppMetricsStore(control: AppMetricsControl) {
  return defineStore('appMetrics', () => {
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
}
