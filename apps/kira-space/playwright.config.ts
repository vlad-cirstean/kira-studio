import { defineConfig } from '@playwright/test';

// P100 Part 2: Kira Studio's own playwright.config.ts, trimmed to the one project this app's own
// tests/ui/ tier needs — no `ui-timing` (no wall-clock-budget spec moved here), no `ipc-frontend`
// (this app has no tests/ipc/ tier — the plan never asked for one), no `e2e-real` (no
// real-Go-backend tier built for this app). `fullyParallel`/`browserName: 'webkit'` match Kira
// Studio's own `ui` project for the same reason theirs does: a packaged build actually embeds
// WebKit (WKWebView/WebKitGTK), and this tier has none of the wall-clock/Docker contention that
// forced Studio's own `e2e` tier to serialize.
//
// P110 I2-1b: `visual` added, mirroring Kira Studio's own project (playwright.config.ts:100-110) —
// same `webkit`/`animations: disabled`/pinned-fonts contract, so this app's own baselines are
// authoritative against the same CI-Linux font/rendering policy (docs/DEV_ENVIRONMENT.md's
// `tests/visual/*` section applies here identically).
export default defineConfig({
  workers: '100%',
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    {
      name: 'ui',
      testDir: './tests/ui',
      use: { browserName: 'webkit' },
      fullyParallel: true,
      workers: '100%',
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      use: { browserName: 'webkit' },
      fullyParallel: true,
      workers: '100%',
      expect: {
        toHaveScreenshot: {
          animations: 'disabled',
          stylePath: './tests/visual/support/pin-fonts.css',
        },
      },
    },
  ],
});
