import { reactive } from 'vue';
import { control } from '../bridge/control';

// appMetrics.ts's own shape, pull instead of push: Go decides cadence (an hourly poll here is a
// ceiling, not the real interval — UpdateService.Status's own 6h cache floor, §3.3, is what
// decides whether any given call actually reaches the network).
export const appUpdateState = reactive({
  available: false,
  currentVersion: '',
  latestVersion: '',
});

const POLL_MS = 60 * 60 * 1000; // hourly; Go's own 6h floor decides what actually fetches

let started = false;

async function poll(): Promise<void> {
  try {
    const status = await control.updateStatus();
    appUpdateState.available = status.updateAvailable;
    appUpdateState.currentVersion = status.currentVersion;
    appUpdateState.latestVersion = status.latestVersion;
  } catch {
    // A failed check is silence, not a UI event (§3.3) — leave the previous state as-is.
  }
}

export function initAppUpdate(): void {
  if (started) return;
  started = true;
  void poll();
  setInterval(() => void poll(), POLL_MS);
}
