import { defineConfig } from '@playwright/test';

// Perf probes: report numbers, assert nothing. Own config so no normal tier ever runs them.
// `bun run perf:probe:studio`; docs/DEV_ENVIRONMENT.md "Perf probes".
export default defineConfig({
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  outputDir: 'test-results-perf',
  projects: [
    {
      name: 'perf',
      testDir: './tests/perf',
      use: { browserName: 'webkit', headless: !process.env.PERF_HEADED },
    },
  ],
});
