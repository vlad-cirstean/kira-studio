import { expect, test } from "@playwright/test";

const THEME_KINDS = [
  "vscode-dark",
  "vscode-light",
  "vscode-high-contrast",
  "vscode-high-contrast-light",
] as const;

declare global {
  interface Window {
    __kiraHarness: {
      setTheme(kind: (typeof THEME_KINDS)[number]): void;
      readTokens(): Record<string, string>;
    };
  }
}

test.describe("app shell", () => {
  test("renders its regions and reports a connected bridge", async ({ page }) => {
    await page.goto("/?scenario=clean");
    await expect(page.getByTestId("graph-region")).toBeVisible();
    await expect(page.getByTestId("detail-region")).toBeVisible();
    await expect(page.getByTestId("connection-state")).toHaveText("connected");
    await expect(page.locator(".codicon-refresh")).toBeVisible();
    await expect(page.locator(".codicon-search")).toBeVisible();
  });
});

test.describe("theming", () => {
  // P4 W1 narrowed `readTokens()` to the one thing JavaScript still needs as a number
  // (`--kv-row-height`, §6.1) — every colour token is now consumed purely through CSS classes
  // (W1, §3.4), so there is nothing left for readTokens() to report that a theme switch would
  // change; that claim moved to the visual baselines below instead. This just checks the bridge
  // itself reports what the cascade actually resolved, independent of theme.
  test("readTokens reports the live computed value of --kv-row-height", async ({ page }) => {
    await page.goto("/?scenario=clean&theme=vscode-dark");

    const readComputed = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--kv-row-height").trim(),
      );
    const readFromReader = () =>
      page.evaluate(() => window.__kiraHarness.readTokens()["--kv-row-height"]);

    expect(await readFromReader()).toBe(await readComputed());
  });

  for (const kind of THEME_KINDS) {
    test(`visual baseline: ${kind}`, async ({ page }) => {
      await page.goto(`/?scenario=clean&theme=${kind}`);
      await page.waitForSelector('[data-testid="connection-state"]');
      await expect(page).toHaveScreenshot(`shell-${kind}.png`);
    });
  }
});
