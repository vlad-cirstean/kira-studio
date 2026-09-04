import { defineConfig, devices } from "@playwright/test";

/**
 * Two projects: `harness` drives `apps/harness` in a plain browser tab against a mock bridge
 * (fast, runs on every commit); `vscode` drives a downloaded VS Code build with the extension
 * installed (§8.4). A third project drove our own standalone desktop shell through P3 and was
 * retired along with it — see `docs/plans/P4b-remove-electron.md`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    viewport: { width: 1000, height: 500 },
    // Screenshot comparison needs a stable environment (W8); reduced motion removes the
    // ~100ms transitions VS Code itself uses (§6.1) from the render.
    reducedMotion: "reduce",
    launchOptions: {
      // Unset by default: `bunx playwright install` puts the browser where Playwright
      // expects it. Only set this if you're pointing at a browser installed out-of-band
      // (e.g. a shared cache whose revision doesn't match this pinned Playwright version).
      executablePath: process.env.KIRA_PLAYWRIGHT_CHROMIUM_PATH,
    },
  },
  expect: {
    toHaveScreenshot: {
      // Tolerant enough to absorb font rasterisation differences between machines, not to
      // hide a real regression.
      maxDiffPixelRatio: 0.02,
    },
  },
  projects: [
    {
      name: "harness",
      // Glob (relative to testDir), not a substring regex: this repo's own directory name
      // contains "vscode", which a naive /vscode\/.../ regex against absolute paths would
      // false-positive-match — every harness spec would also run under the vscode project.
      testMatch: "harness/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
    },
    // From P3: Playwright driving a downloaded VS Code build with the extension installed.
    {
      name: "vscode",
      testMatch: "vscode/**/*.spec.ts",
    },
  ],
  // Stays at the config root rather than under the `harness` project: `@playwright/test@1.62.1`
  // (the version this repo pins) only declares `webServer` on the top-level `TestConfig`, not on
  // `TestProject` — confirmed by reading its own shipped `types/test.d.ts`, which has no
  // `webServer` member on any project-shaped interface. It only ever starts a server the
  // `vscode` project doesn't reach (it doesn't load `http://localhost:5173`), so this is the
  // closest correct equivalent to W15's "move it under harness" instruction until a Playwright
  // version that supports per-project `webServer` is pinned.
  webServer: {
    command: "bun run --filter '@kira-version/harness' dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
