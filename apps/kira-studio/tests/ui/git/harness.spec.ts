import { expect, test } from '@playwright/test';
import { startServer, type UiServer } from '../../ui/support/server';

// D5's second test tier: git-ui mounted against a hand-written Transport (frontend/src/git/
// harness/mockTransport.ts) with NO Wails present at all — no `/wails/*` request of any kind is
// even possible from this page (git-dev.html imports no Wails runtime), which is the actual proof
// that `packages/git-core`/`packages/git-ipc`/`packages/git-ui` depend on nothing this app-specific
// (docs/v1.3/SPEC.md's module-boundary rule, and P1's own §7 exit criterion for this tier).
//
// Deliberately its own tiny fixture (not tests/ui/support/fixtures.ts's `relaunch`): that fixture
// installs mockRuntime.ts/mockStream.ts, which intercept `/wails/*` — using it here would prove
// only that our own mocks work, not that git-ui needs no host at all.

let server: UiServer;
test.beforeAll(async () => {
  server = await startServer();
});
test.afterAll(async () => {
  await server.close();
});

test('a page with no /wails/* request even possible still renders the blocking state (git not found)', async ({
  page,
}) => {
  const wailsRequests: string[] = [];
  await page.route('**/wails/**', (route) => {
    wailsRequests.push(route.request().url());
    return route.abort();
  });

  await page.goto(`${server.url}git-dev.html?scenario=git-not-found`);
  const panel = page.locator('[data-testid="git-blocked-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Git was not found');
  await expect(panel).toContainText('/opt/homebrew/bin/git');

  // The whole point of this tier: nothing ever tried to reach a Wails endpoint.
  expect(wailsRequests).toEqual([]);
});

test('git too old shows the detected/required versions and the settingId', async ({ page }) => {
  await page.goto(`${server.url}git-dev.html?scenario=git-too-old`);
  const panel = page.locator('[data-testid="git-blocked-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Git is too old');
  await expect(panel).toContainText('2.10.1');
  await expect(panel).toContainText('2.38.0');
  await expect(panel).toContainText('git.path');
});

test('git unusable shows the path and the reason', async ({ page }) => {
  await page.goto(`${server.url}git-dev.html?scenario=git-unusable`);
  const panel = page.locator('[data-testid="git-blocked-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Git is not usable');
  await expect(panel).toContainText('permission denied');
});

test('git ok with no repository open shows the repo picker, not the blocked panel', async ({
  page,
}) => {
  await page.goto(`${server.url}git-dev.html?scenario=no-repository`);
  await expect(page.locator('[data-testid="git-blocked-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="no-repository-panel"]')).toBeVisible();
});

test('a candidate from repo.list opens through repo.open, reaching a real branch head', async ({
  page,
}) => {
  await page.goto(`${server.url}git-dev.html?scenario=repo-open-branch`);
  const candidate = page.locator('.kv-no-repo-candidate', { hasText: 'harness-repo-2' });
  await expect(candidate).toBeVisible();
  await candidate.click();
  // repo-open-branch's own repoOpen answer has head.kind 'branch' (not 'unborn'), so the toolbar
  // and the (empty, zero-chunk) graph region render — connection-state flips to 'connected' only
  // once app.init resolves, which candidate-click already waited behind.
  await expect(page.locator('[data-connection-state="connected"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="graph-region"]')).toBeVisible();
});

test('an unborn HEAD (no commits yet) shows the empty-repository state, naming the branch', async ({
  page,
}) => {
  await page.goto(`${server.url}git-dev.html?scenario=repo-open-unborn`);
  const candidate = page.locator('.kv-no-repo-candidate', { hasText: 'harness-repo' });
  await candidate.click();
  const empty = page.locator('[data-testid="empty-repository-panel"]');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('main');
});
