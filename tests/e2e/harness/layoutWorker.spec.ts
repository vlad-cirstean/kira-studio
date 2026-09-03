import { expect, test } from "@playwright/test";

// `Window.__kiraHarness`'s ambient type is declared once, project-wide, in `shell.spec.ts` —
// `declare global` merges across every file in the program, and TypeScript rejects two
// declarations of the same global property with different types, so this file relies on that
// one declaration rather than repeating (and risking diverging from) it.

/**
 * P4 W4's own "Done when": drives the real module worker (`layout.worker.ts`, constructed via
 * `createLayoutClient()` with no `workerFactory` override) through a couple of pages and
 * compares its output row for row against a synchronous `layoutAppend` call — a check that
 * needs a real browser (a module worker is not constructible under Bun), so it runs through the
 * harness rather than as a `bun:test` unit test. `tests/unit/ui/layoutClient.test.ts` already
 * covers `layoutClient.ts`'s own request/response bookkeeping against a stubbed worker; this is
 * the one place a *real* `Worker` — and, incidentally, the CSP `worker-src` directive V1 checks
 * on a real VS Code webview — actually gets exercised.
 */
test.describe("layout worker", () => {
  test("matches a synchronous layoutAppend call, page for page", async ({ page }) => {
    await page.goto("/?scenario=clean");
    await page.waitForSelector('[data-testid="connection-state"]');

    const matches = await page.evaluate(() => window.__kiraHarness.checkLayoutWorker());

    expect(matches).toBe(true);
  });
});
