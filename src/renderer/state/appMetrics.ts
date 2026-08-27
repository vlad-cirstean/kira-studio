import type { AppMetricsSample } from '@shared/protocol/ipc';
import { reactive } from 'vue';
import { control } from '../bridge/control';

export const appMetricsState = reactive({
  // Stays null until the main process's first tick — the status bar readout is hidden until
  // then, same convention as cacheStats.ts's own stats field.
  sample: null as AppMetricsSample | null,
});

let unsubscribe: (() => void) | null = null;

export function initAppMetrics(): void {
  if (unsubscribe) return;
  unsubscribe = control.onAppMetrics((sample) => {
    appMetricsState.sample = sample;
  });
}
