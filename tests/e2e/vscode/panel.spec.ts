import { resolve } from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";
import { linear } from "../support/generateRepo.ts";

/**
 * P3 W15 — the real VS Code host: a downloaded VS Code build launched with this repo's
 * extension loaded via `--extensionDevelopmentPath`, driven through Playwright the same way
 * `electron/shell.spec.ts` drives the Electron host, since VS Code is itself an Electron app.
 *
 * There is no repo-picker UI yet (P4+), and unlike Electron's static HTML, `html.ts` rebuilds
 * its bootstrap island fresh on every `resolveWebviewView` — so `KIRA_REPO` is threaded through
 * there instead of `loadFile`'s `query` option (`html.ts`'s own doc comment explains the split).
 *
 * `kiraVersion.theme.kind` is Electron-only (`packages/core/src/settings/schema.ts`'s
 * `hosts: ["electron"]`) — `toVsCodeConfiguration()` excludes it from this host's contributed
 * configuration entirely, so there is nothing to set from a VS Code settings command. What VS
 * Code genuinely owns is its own built-in colour theme, which `vscode-tokens.css` (W12) keys the
 * whole palette off — this file's theme test exercises exactly that, via
 * `workbench.action.selectTheme`, the same UI a person would use.
 *
 * **Environment reality (W15's own text, D27's macOS-only-e2e precedent).** `downloadAndUnzipVSCode()`
 * fetches a real VS Code build from `update.code.visualstudio.com`, which this sandbox's network
 * policy blocks (confirmed by direct probe: 403 through the proxy, the same shape as P0's V3).
 * This spec is written and committed regardless, per W15's own "written and committed
 * regardless" rule; run it for real on a macOS machine with:
 *
 *   bun run build && bunx playwright test --project=vscode
 *
 * `EXTENSION_DEVELOPMENT_PATH` resolves off `process.cwd()`, not `import.meta.url`: the pinned
 * `@playwright/test@1.62.1`'s own test-file transform cannot load a spec that references
 * `import.meta` at all (confirmed with a one-line repro file, independently of any binary being
 * reachable) — the same finding `electron/shell.spec.ts` documents. `playwright.config.ts`'s
 * `testDir` is already root-relative, so Playwright always runs from the repo root.
 */

const EXTENSION_DEVELOPMENT_PATH = resolve(process.cwd(), "packages", "host-vscode");

/** `resolveCliArgsFromVSCodeExecutablePath` returns a plain `string[]` (the CLI binary's own
 *  path is just its first element), so destructuring leaves `cliPath` typed as possibly
 *  `undefined` under this repo's `exactOptionalPropertyTypes` — which it never is in practice. */
function resolveCli(vscodeExecutablePath: string): { cliPath: string; cliArgs: string[] } {
  const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  if (!cliPath) throw new Error("panel.spec: resolveCliArgsFromVSCodeExecutablePath returned []");
  return { cliPath, cliArgs };
}

/** Drives VS Code's command palette exactly as a person would: open it, type a command's
 *  title, and accept the top (exact) match — there is no scriptable command-execution API from
 *  outside the extension host, so this is the only way in from a Playwright-driven window. */
async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget input");
  await input.waitFor({ state: "visible" });
  await input.fill(`>${title}`);
  await page.locator(".quick-input-widget .monaco-list-row").first().waitFor();
  await page.keyboard.press("Enter");
}

/** VS Code nests a webview view's document two `iframe`s deep: the outer `iframe.webview.ready`
 *  (one per view, sandboxed) and, inside it, `#active-frame` (the document `html.ts` renders).
 *  Re-locating both on every call is deliberate — `resolveWebviewView` runs again on every
 *  hide/reveal (§2.1, no `retainContextWhenHidden`), which replaces both iframes' contents. */
function graphFrame(page: Page) {
  return page.frameLocator("iframe.webview.ready").frameLocator("#active-frame");
}

async function openPanel(page: Page): Promise<void> {
  await runCommand(page, "View: Toggle Panel");
  await runCommand(page, "Kira Version: Focus Graph");
  await graphFrame(page).getByTestId("connection-state").waitFor();
}

test.describe("vscode panel", () => {
  test("opens the panel and shows the generated repository's live values", async () => {
    const repo = linear(10);
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const { cliPath, cliArgs } = resolveCli(vscodeExecutablePath);
    const app = await electron.launch({
      executablePath: cliPath,
      args: [
        ...cliArgs,
        `--extensionDevelopmentPath=${EXTENSION_DEVELOPMENT_PATH}`,
        "--disable-extensions",
        "--skip-release-notes",
        "--skip-welcome",
        repo.dir,
      ],
      env: { ...process.env, KIRA_REPO: repo.dir },
    });

    try {
      const page = await app.firstWindow();
      await openPanel(page);
      const frame = graphFrame(page);

      await expect(frame.getByTestId("connection-state")).toHaveText("connected");
      // P4 W11 deleted the live-data strip and its `repo-root`/`commit-count` testids — the real
      // list is the replacement (same reasoning as the Electron spec's own update).
      await expect(frame.locator(".slick-row")).toHaveCount(repo.commits.length);
      await expect(frame.locator(".kv-message-subject").first()).not.toBeEmpty();
      // Same reasoning as the Electron spec's first test: nothing is cached before this
      // session's very first stream, so every row this load emits comes from git.
      await expect(frame.getByTestId("chunk-source")).toHaveText("git");
    } finally {
      await app.close();
    }
  });

  test("hiding and revealing the panel rehydrates from cache, not git", async () => {
    const repo = linear(10);
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const { cliPath, cliArgs } = resolveCli(vscodeExecutablePath);
    const app = await electron.launch({
      executablePath: cliPath,
      args: [
        ...cliArgs,
        `--extensionDevelopmentPath=${EXTENSION_DEVELOPMENT_PATH}`,
        "--disable-extensions",
        "--skip-release-notes",
        "--skip-welcome",
        repo.dir,
      ],
      env: { ...process.env, KIRA_REPO: repo.dir },
    });

    try {
      const page = await app.firstWindow();
      await openPanel(page);
      await expect(graphFrame(page).locator(".slick-row")).toHaveCount(repo.commits.length);

      // Closing and reopening the panel disposes and recreates the webview view (panelView.ts's
      // own doc comment: `retainContextWhenHidden` is deliberately off), which is exactly the
      // scenario §5.4's rehydration exists for — the RepoService's row cache outlives the
      // webview, only the webview's own JS heap is lost.
      await runCommand(page, "View: Toggle Panel");
      await runCommand(page, "View: Toggle Panel");
      await runCommand(page, "Kira Version: Focus Graph");
      const frame = graphFrame(page);

      await expect(frame.locator(".slick-row")).toHaveCount(repo.commits.length);
      // The rehydration round trip replays every row the host still has cached — never a fresh
      // git read — so unlike the very first load, `chunk-source` must land on "cache".
      await expect(frame.getByTestId("chunk-source")).toHaveText("cache");
    } finally {
      await app.close();
    }
  });

  test("switching VS Code's own colour theme repaints the webview, with no reload", async () => {
    const repo = linear(3);
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const { cliPath, cliArgs } = resolveCli(vscodeExecutablePath);
    const app = await electron.launch({
      executablePath: cliPath,
      args: [
        ...cliArgs,
        `--extensionDevelopmentPath=${EXTENSION_DEVELOPMENT_PATH}`,
        "--disable-extensions",
        "--skip-release-notes",
        "--skip-welcome",
        repo.dir,
      ],
      env: { ...process.env, KIRA_REPO: repo.dir },
    });

    try {
      const page = await app.firstWindow();
      await openPanel(page);
      const frame = graphFrame(page);
      const readAppBg = () =>
        frame
          .locator(".kv-app")
          .evaluate((el) => getComputedStyle(el).getPropertyValue("--kv-app-bg").trim());

      await runCommand(page, "Preferences: Color Theme");
      await page.keyboard.type("Default Light Modern");
      await page.keyboard.press("Enter");
      const light = await readAppBg();

      await runCommand(page, "Preferences: Color Theme");
      await page.keyboard.type("Default Dark Modern");
      await page.keyboard.press("Enter");

      await expect.poll(readAppBg).not.toBe(light);
      const dark = await readAppBg();
      expect(dark).not.toBe(light);
    } finally {
      await app.close();
    }
  });
});
