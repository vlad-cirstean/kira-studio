import { defineConfig } from '@playwright/test';

// P50/P57: `e2e` is tests/e2e/'s original full-stack tier — kept alive, unchanged, until every one
// of its pure-UI specs has a verified tests/ui/ port and its full-stack-only specs have a named
// disposition (D16 §5.6/§7); it is deleted, and this project entry with it, once that is true.
// `ui` (D16) replaces it for everything that ported: real Vue, real bridge/{control,port}.ts, a
// static server over the built bundle instead of a real Electron process, both wire protocols
// mocked from tests/ui/support/ (D13/D14) instead of a real backend. `fullyParallel: true` is a
// real change from `e2e`'s `workers: 1`, and it is earned, not inherited: the serialisation
// existed because concurrent Electron apps contend over wall-clock/RSS budgets and Docker
// containers — the webkit tier has neither, the same reasoning that already made `ipc-frontend`
// fully parallel. `browserName: 'webkit'` matches what a packaged build actually embeds
// (WKWebView on macOS, WebKitGTK on Linux); a fresh Claude Code Linux container has no WebKit
// binary preinstalled, but `bunx playwright install webkit` plus the system libs its own
// post-install warning names (AGENTS.md) fetches and runs a real one, so `playwright test
// --project=ui` verifies against the genuine target with no chromium override needed.
// `ipc-frontend` keeps its name, `testDir` and settings; only its mocking mechanism moves
// (D13/D14) once its seven specs are re-pointed.
export default defineConfig({
  workers: '50%',
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    { name: 'e2e', testDir: './tests/e2e', fullyParallel: false, workers: 1 },
    {
      name: 'ui',
      testDir: './tests/ui',
      use: { browserName: 'webkit' },
      fullyParallel: true,
      workers: '50%',
    },
    {
      name: 'ipc-frontend',
      testDir: './tests/ipc',
      testMatch: '**/*.frontend.spec.ts',
      fullyParallel: true,
      workers: '50%',
    },
  ],
});
