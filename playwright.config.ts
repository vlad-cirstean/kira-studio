import { defineConfig } from '@playwright/test';

// P50: two projects, not two config files (F10 — Playwright honours a per-project `workers`
// limit). `e2e` preserves tests/e2e/'s (renamed from tests/ui/, same phase) exact prior behavior
// byte-for-byte (D2) — full-stack specs asserting wall-clock/RSS budgets
// (budgets/perf/startup/leaks) would flake under concurrent Electron apps, and every Docker-gated
// spec's container is a per-file module memo that assumes one worker. `ipc-frontend` contends over
// nothing — no container, no adapter, no socket (per-test KIRA_HOME, per-KIRA_HOME Chromium
// profile) — so it runs fully parallel (measured: 20/20 pass, zero flakes, four workers × five
// repeats).
export default defineConfig({
  workers: '50%',
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    { name: 'e2e', testDir: './tests/e2e', fullyParallel: false, workers: 1 },
    {
      name: 'ipc-frontend',
      testDir: './tests/ipc',
      testMatch: '**/*.frontend.spec.ts',
      fullyParallel: true,
      workers: '50%',
    },
  ],
});
