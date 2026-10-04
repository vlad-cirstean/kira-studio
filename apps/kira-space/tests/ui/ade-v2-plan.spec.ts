import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, bandOf, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// The ade v2 Plan on the committed board fixture, anchored to Tue 2026-09-22.

interface BoardFx {
  plan: { order: string[]; day: Record<string, string>; unpushed: Record<string, boolean> };
  branches: { id: string; conflictCheck: string; conflictCheckReason: string }[];
}

const card = (page: Page, taskId: string) =>
  page.locator(`[data-testid="ade-card"][data-task-id="${taskId}"]`);

test('shows the first 10 items, loads all and collapses back', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const tasks = page.locator('[data-testid="ade-task"]');
  await expect(tasks).toHaveCount(10);
  await page.locator('[data-testid="ade-load-all"]').click();
  await expect(tasks).toHaveCount(13);
  await expect(page.locator('[data-testid="ade-load-all"]')).toHaveCount(0);
  await page.locator('[data-testid="ade-collapse"]').click();
  await expect(tasks).toHaveCount(10);
  await expect(page.locator('[data-testid="ade-load-all"]')).toContainText(
    'Load all items · 3 more',
  );
});

test('loads the archived history into the day bands', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const load = page.locator('[data-testid="ade-load-history"]');
  await expect(load).toContainText('Load history · 5 archived tasks in the last 2 weeks');
  await load.click();
  await expect(page.locator('[data-testid="ade-history-row"]')).toHaveCount(5);
  await expect(load).toHaveCount(0);
});

test('a card shows its stage, progress, span and clamped title', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const search = card(page, 'T_search');
  await expect(search.locator('[data-testid="ade-stage-label"]')).toHaveText('Implement 3/5');
  await expect(search).toContainText('67%');
  await expect(search.locator('[data-testid="ade-card-meta"]')).toHaveText(
    '3d → Mon 28 · SRCH-41 · web-app',
  );
  await expect(search.locator('[data-testid="ade-card-title"]')).toHaveText('Search v2');
  const clamp = await card(page, 'T_push')
    .locator('[data-testid="ade-card-title"]')
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { clamp: s.webkitLineClamp, overflow: s.overflow };
    });
  expect(clamp).toEqual({ clamp: '2', overflow: 'hidden' });
});

test('branch rows show base markers and the derived branch tags', async ({ relaunch }) => {
  const board = adeFixture<BoardFx>('board');
  const deps = board.branches.find((b) => b.id === 'b_deps');
  if (!deps) throw new Error('fixture lost b_deps');
  deps.conflictCheck = 'failed';
  deps.conflictCheckReason = 'merge-tree exited 128';
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);

  const markers = await page.locator('[data-testid="ade-base-marker"]').allInnerTexts();
  expect(markers).toContain('⑂ search-schema');
  const tags = await page.locator('[data-testid="ade-tag"]').allInnerTexts();
  expect(tags).toContain('↓3 main');
  expect(tags).toContain('checking…');
  expect(tags).toContain('conflict check failed');
  expect(tags).toContain('✕ setup failed');
});

test('a repo chip hides and shows its branches', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const push = card(page, 'T_notif');
  await expect(push).toBeVisible();
  const toggle = page.locator(
    '[data-testid="ade-repo-chip"][data-repo-id="repo-web-app"] [data-testid="ade-repo-toggle"]',
  );
  await toggle.click();
  await expect(push).toHaveCount(0);
  await toggle.click();
  await expect(push).toBeVisible();
});

test('Refresh all and a repo chip refresh send their repo ids', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskRefresh, response: adeFixture('refresh') },
  ]);
  const calls = () => control.log().filter((e) => e.channel === IPC.adeTaskRefresh);
  await page.locator('[data-testid="ade-refresh-all"]').click();
  await expect.poll(() => calls().length).toBe(1);
  expect(calls()[0]?.args).toEqual({ codeRepoIds: [] });
  await page
    .locator(
      '[data-testid="ade-repo-chip"][data-repo-id="repo-api"] [data-testid="ade-repo-refresh"]',
    )
    .click();
  await expect.poll(() => calls().length).toBe(2);
  expect(calls()[1]?.args).toEqual({ codeRepoIds: ['repo-api'] });
});

test('a credential prompt is answered through the v2 broker', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskProvideCredential, response: true },
  ]);
  await emitWailsEvent(page, IPC.adeTaskCredential, adeFixture('event-credential'));
  await expect(page.locator('[data-testid="git-credential-prompt"]')).toContainText(
    'Password for https://github.com/acme/api.git',
  );
  await page.locator('[data-testid="git-credential-input"]').fill('s3cret');
  await page.locator('[data-testid="git-credential-submit"]').click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.adeTaskProvideCredential))
    .toHaveLength(1);
  expect(control.log().find((e) => e.channel === IPC.adeTaskProvideCredential)?.args).toEqual({
    requestId: 'cred-1',
    secret: 's3cret',
  });
});

test('dragging a card to another day writes the plan once, with no dialog', async ({
  relaunch,
}) => {
  const board = adeFixture<BoardFx>('board');
  const { window: page, control } = await openPlan(relaunch);
  await page.setViewportSize({ width: 1440, height: 2400 });
  const from = await card(page, 'T_deps').boundingBox();
  const to = await bandOf(page, 6).locator('[data-testid="ade-band-drop"]').boundingBox();
  if (!from || !to) throw new Error('drag geometry missing');
  await page.mouse.move(from.x + 40, from.y + 30);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 50, { steps: 4 });
  await page.mouse.move(to.x + 200, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  const calls = () => control.log().filter((e) => e.channel === IPC.adeTaskSetPlan);
  await expect.poll(() => calls().length).toBe(1);
  expect(calls()[0]?.args).toEqual({
    order: [...board.plan.order.filter((id) => id !== 'T_deps'), 'T_deps'],
    days: { T_deps: '2026-09-28' },
  });
  await expect(page.locator('[data-testid="ade-confirm-dialog"]')).toHaveCount(0);
});

test('a card is a 10px rounded box with a 4px task edge, a 68px header and 10px gaps', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  const box = card(page, 'T_search');
  const style = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderTopLeftRadius,
      top: s.borderTopWidth,
      left: s.borderLeftWidth,
    };
  });
  expect(style).toEqual({ radius: '10px', top: '1px', left: '4px' });
  const head = await box.locator('[data-testid="ade-card-head"]').boundingBox();
  expect(head?.height).toBe(68);

  const rects = await bandOf(page, 3)
    .locator('[data-testid="ade-card"]')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })),
    );
  expect(rects.length).toBeGreaterThanOrEqual(2);
  expect((rects[1]?.top ?? 0) - (rects[0]?.bottom ?? 0)).toBe(10);
});
