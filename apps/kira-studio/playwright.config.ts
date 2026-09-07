import { defineConfig } from '@playwright/test';

// P27: titles of every test with a real-millisecond wall-clock assertion — budgets.spec.ts's and
// perf.spec.ts's own single test each, plus slick-grid.spec.ts's two "150ms sandbox gate" tests
// (P22 Pass B C6 and C12 T7). `ui-timing` (below) selects exactly these four by title (grep), not
// by file alone, since slick-grid.spec.ts's testMatch entry would otherwise also pull in its other
// 15 tests, which carry no wall-clock assertion of their own and gain nothing from running
// serially; `ui` excludes them the same way (grepInvert) so nothing runs twice.
const wallClockBudgetTitles = /150ms sandbox gate|interaction budgets|perf tripwires/;

// P57 M5: `tests/e2e/` (the original full-stack tier this file called `e2e`) is retired — every
// pure-UI spec has a verified tests/ui/ port and every full-stack-only spec has a named
// disposition (D16 §5.6/§7; P57-cutover.md §4.5), so both the directory and this project entry
// are gone. `ui` (D16) replaces it for everything that ported: real Vue, real bridge/{control,port}.ts, a
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
  // P27: the actual worker-process pool size — a project's own `workers` (below) can only narrow
  // this, never widen it (testProject.workers' own doc: "Playwright will limit the number of
  // workers used ... however, it cannot increase the total number of workers above the value
  // specified by testConfig.workers"). Left at the default (100% of logical cores) so `ui` and
  // `ipc-frontend` actually get every core; `ui-timing` and `e2e-real` still narrow themselves down
  // via their own explicit `workers`.
  workers: '100%',
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    {
      name: 'ui',
      testDir: './tests/ui',
      testIgnore: ['budgets.spec.ts', 'perf.spec.ts'],
      grepInvert: wallClockBudgetTitles,
      use: { browserName: 'webkit' },
      fullyParallel: true,
      workers: '100%',
    },
    // P27: budgets.spec.ts and perf.spec.ts measure wall-clock latency in real milliseconds, so the
    // number of other browsers contending for the CPU is part of what they measure
    // (budgets.spec.ts's own comment above its scroll-response assertion says so). Raising `ui`
    // to '100%' workers made this file's own p50 fail against its bound under that contention — not
    // a looser bound, but a quieter machine: these two run alone, in their own serial project, after
    // `ui` has finished (`dependencies: ['ui']`), so the rest of the tier gets every core and these
    // two get none of the contention. Measured: the split's own p50 matches or beats the old
    // 2-worker baseline instead of merely avoiding the failure `'100%'` alone caused.
    //
    // slick-grid.spec.ts's own two "150ms sandbox gate" tests (P22 Pass B C6/C12 T7) carry the same
    // kind of real-millisecond wall-clock bound, in a file the plan's own prototype measurement
    // found stable at 4 workers — re-measured directly in this environment, it is not: a 157ms
    // reading against the 150ms bound, on the second of two full `bun run test:ui` runs. Pulled out
    // by title (`grep`/`grepInvert`, not a file move) rather than the whole 110s file, since the
    // other 15 tests in it carry no wall-clock assertion of their own and gain nothing from running
    // serially.
    {
      name: 'ui-timing',
      testDir: './tests/ui',
      testMatch: ['budgets.spec.ts', 'perf.spec.ts', 'slick-grid.spec.ts'],
      grep: wallClockBudgetTitles,
      use: { browserName: 'webkit' },
      fullyParallel: false,
      workers: 1,
      dependencies: ['ui'],
    },
    {
      name: 'ipc-frontend',
      testDir: './tests/ipc',
      testMatch: '**/*.frontend.spec.ts',
      fullyParallel: true,
      workers: '50%',
    },
    // P57-e2e-revisit.md §6/§8: a real Go backend (`go build -tags server`), a real embedded
    // engine and a real database adapter, reached over plain HTTP/WebSocket by a plain Chromium
    // tab — no mock, no native window. A *wiring* tier, not a UI-fidelity one (D5): `chromium`,
    // not `webkit`, is the right default here, since the point is proving the backend is wired,
    // not proxying the packaged app's own webview (`ui`'s job). `fullyParallel`/`workers: 2` is
    // proven safe (§3.5): per-test KIRA_HOME + WAILS_SERVER_PORT gives each instance its own
    // SQLite app-storage, secrets file and engine child.
    {
      name: 'e2e-real',
      testDir: './tests/e2e-real',
      use: { browserName: 'chromium' },
      fullyParallel: true,
      workers: 2,
    },
  ],
});
