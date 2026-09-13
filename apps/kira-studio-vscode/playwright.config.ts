import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// `apps/kira-studio-vscode/package.json` declares `"type": "module"`, so this file runs as real
// ESM under Node/Playwright's loader — no `__dirname` global, hence the `import.meta.url` detour.
const __dirname = dirname(fileURLToPath(import.meta.url));

// This container pre-installs Chromium at a fixed path outside Playwright's own managed browser
// cache (`/opt/pw-browsers`, via `PLAYWRIGHT_BROWSERS_PATH`) and pins a version that can drift
// from whatever `@playwright/test` itself expects by default — pinning `executablePath` here
// sidesteps that drift without an install step. Falls through to Playwright's own default
// resolution (`executablePath: undefined`) wherever that path does not exist, so this config
// still works on a machine that installed its browsers the ordinary way.
const containerChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(containerChromium) ? containerChromium : undefined;

/**
 * G16 D10: the extension's own Playwright project — the webview-layout tier that measures real
 * rendered box geometry (`getBoundingClientRect()`), the one thing G14's own `aria-rowcount`
 * check could not see while the panel was visually collapsed to ~75px. A second config file
 * rather than a fifth project inside `apps/kira-studio/playwright.config.ts`, per SPEC's own
 * module-boundary rule for this chapter: git-specific frontend code lives under its own
 * directories, and no phase merges git and studio/api code into a shared file where a per-module
 * one would do.
 *
 * `browserName: 'chromium'`, not `webkit`: VS Code is Electron, so a real webview is a Chromium
 * iframe — `apps/kira-studio/playwright.config.ts`'s `webkit` choice is right for *its* own
 * target (WKWebView in a packaged Wails app) and wrong for this one. Both browsers are already
 * installed in this container (`PLAYWRIGHT_BROWSERS_PATH`); `executablePath` below pins the exact
 * bundled Chromium binary rather than relying on whatever this `@playwright/test` version's own
 * default resolution finds, since the two can drift independently of each other.
 */
export default defineConfig({
  reporter: [['list']],
  // Written under the repo-root test-results/, in its own subdirectory, so this project never
  // fights apps/kira-studio/playwright.config.ts's own outputDir/playwright-report writers.
  outputDir: resolve(__dirname, '../../test-results/webview-layout'),
  projects: [
    {
      name: 'webview-layout',
      testDir: './tests/layout',
      fullyParallel: true,
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath },
      },
    },
    // G19 §4.2: the narrowly-scoped fake-transport tier — D4's message-clamp geometry, D10's
    // click-bubbling regression, and D11a's back-button case. A second project (not folded into
    // `webview-layout`) since it drives real interaction over scripted data, not a dead
    // transport's own pre-connect geometry (that project's own doc comment on why it stops there).
    {
      name: 'webview-interaction',
      testDir: './tests/interaction',
      fullyParallel: true,
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath },
      },
    },
  ],
});
