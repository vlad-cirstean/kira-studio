import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { adeFixture, bandOf, FIXED_NOW, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// The ade v2 Plan on the committed board fixture, anchored to Tue 2026-09-22.

interface BoardFx {
  plan: { order: string[]; day: Record<string, string>; unpushed: Record<string, boolean> };
  branches: { id: string; conflictCheck: string; conflictCheckReason: string }[];
  repos: { codeRepoId: string }[];
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

test('a card shows its step, progress, span and clamped title', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const search = card(page, 'T_search');
  await expect(search.locator('[data-testid="ade-step-label"]')).toHaveText('Make CI green 3/6');
  await expect(search).toContainText('50.0%');
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
  expect(markers.map((m) => m.replace(/\s+/g, ''))).toContain('search-schema');
  const tags = await page.locator('[data-testid="ade-tag"]').allInnerTexts();
  expect(tags).toContain('3 behind main');
  expect(tags).toContain('Checking…');
  expect(tags).toContain('Conflict check failed');
  expect(tags).toContain('Setup failed');
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

test('Refresh all sends every repo the plan shows; a chip sends its own', async ({ relaunch }) => {
  const { window: page, control } = await openPlan(relaunch, [
    { channel: IPC.adeTaskRefresh, response: adeFixture('refresh') },
  ]);
  const calls = () => control.log().filter((e) => e.channel === IPC.adeTaskRefresh);
  await page.locator('[data-testid="ade-refresh-all"]').click();
  await expect.poll(() => calls().length).toBe(1);
  expect(calls()[0]?.args).toEqual({
    codeRepoIds: adeFixture<BoardFx>('board').repos.map((r) => r.codeRepoId),
  });
  await page
    .locator(
      '[data-testid="ade-repo-chip"][data-repo-id="repo-api"] [data-testid="ade-repo-refresh"]',
    )
    .click();
  await expect.poll(() => calls().length).toBe(2);
  expect(calls()[1]?.args).toEqual({ codeRepoIds: ['repo-api'] });
});

test('a repo without a remote reads no remote, never an error', async ({ relaunch }) => {
  const board = adeFixture<{
    repos: { codeRepoId: string; remote: string; lastFetchAt: number | null }[];
  }>('board');
  const mobile = board.repos.find((r) => r.codeRepoId === 'repo-mobile');
  if (!mobile) throw new Error('fixture lost repo-mobile');
  mobile.remote = '';
  mobile.lastFetchAt = null;
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
    {
      channel: IPC.adeTaskRefresh,
      response: {
        repos: [{ codeRepoId: 'repo-mobile', refsChanged: 0, mergedInto: [], error: null }],
      },
    },
  ]);
  const chip = page.locator('[data-testid="ade-repo-chip"][data-repo-id="repo-mobile"]');
  const note = chip.locator('[data-testid="ade-repo-note"]');
  await expect(note).toHaveText('No remote');
  await chip.locator('[data-testid="ade-repo-refresh"]').click();
  await expect(note).toHaveText('No remote · No changes');
  await expect(note).not.toHaveClass(/text-tone-red/);
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

test('dragging a review card to another day pins it', async ({ relaunch }) => {
  const board = adeFixture<BoardFx>('board');
  const { window: page, control } = await openPlan(relaunch);
  await page.setViewportSize({ width: 1440, height: 3200 });
  await page.locator('[data-testid="ade-load-all"]').click();
  await card(page, 'R_sara').scrollIntoViewIfNeeded();
  const drop = bandOf(page, 6).locator('[data-testid="ade-band-drop"]');
  const geometry = async () =>
    JSON.stringify([await card(page, 'R_sara').boundingBox(), await drop.boundingBox()]);
  let last = '';
  await expect
    .poll(async () => {
      const now = await geometry();
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
  const [from, to] = JSON.parse(last) as [DOMRect | null, DOMRect | null];
  if (!from || !to) throw new Error('drag geometry missing');
  await page.mouse.move(from.x + 40, from.y + 30);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 50, { steps: 4 });
  await page.mouse.move(to.x + 200, to.y + to.height / 2, { steps: 12 });
  // The drop target is hit-tested per animation frame: let it catch up with the pointer.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.mouse.up();

  const calls = () => control.log().filter((e) => e.channel === IPC.adeTaskSetPlan);
  await expect.poll(() => calls().length).toBe(1);
  expect(calls()[0]?.args).toEqual({
    order: [...board.plan.order.filter((id) => id !== 'R_sara'), 'R_sara'],
    days: { R_sara: '2026-09-28' },
  });
});

test('a review with a plan day sits on that day', async ({ relaunch }) => {
  const board = adeFixture<BoardFx>('board');
  board.plan.day.R_sara = '2026-09-28';
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: board },
  ]);
  await page.locator('[data-testid="ade-load-all"]').click();
  await expect(
    bandOf(page, 6).locator('[data-testid="ade-card"][data-task-id="R_sara"]'),
  ).toBeVisible();
});

test('the day-off confirm says what moves, offers Cancel and Escape leaves the plan alone', async ({
  relaunch,
}) => {
  const { window: page, control } = await openPlan(relaunch);
  await page.setViewportSize({ width: 1440, height: 2400 });
  // Today (Tue 22) has T_bill planned on it, so marking it a day off asks to move that task.
  await bandOf(page, 0).locator('[data-testid="ade-band-label"]').click({ button: 'right' });
  await page.locator('[data-testid="menu-item-ade-day-toggle"]').click();
  const dialog = page.locator('[data-testid="ade-confirm-dialog"]');
  await expect(dialog).toContainText('Move tasks?');
  await expect(dialog.locator('[data-testid="ade-confirm-no"]')).toHaveText('Cancel');
  await expect(dialog.locator('[data-testid="ade-confirm-yes"]')).toHaveText('Move');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(control.log().filter((e) => e.channel === IPC.adeTaskSetPlan)).toHaveLength(0);
});

test('a card is a 6px rounded box with a task-colour left edge on the terminal ground, 16px from its same-day neighbour', async ({
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
      leftColor: s.borderLeftColor,
      bg: s.backgroundColor,
    };
  });
  expect({ radius: style.radius, top: style.top, left: style.left }).toEqual({
    radius: '6px',
    top: '1px',
    left: '3px',
  });
  const dot = await box
    .locator('[data-testid="ade-card-dot"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(style.leftColor).toBe(dot);
  const [chrome, plan] = await Promise.all([
    page.evaluate(() => {
      const span = document.createElement('span');
      span.style.color = 'var(--kira-bg-chrome)';
      document.body.appendChild(span);
      const color = getComputedStyle(span).color;
      span.remove();
      return color;
    }),
    page.locator('[data-testid="ade-plan"]').evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(plan).toBe(chrome);
  expect(style.bg).not.toBe(plan);
  const head = await box.locator('[data-testid="ade-card-head"]').boundingBox();
  expect(head?.height).toBe(68);

  const band = bandOf(page, 3);
  await expect(band.locator('[data-testid="ade-task-separator"]')).toHaveCount(0);
  const rects = await band
    .locator('[data-testid="ade-card"]')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })),
    );
  expect(rects.length).toBeGreaterThanOrEqual(2);
  expect((rects[1]?.top ?? 0) - (rects[0]?.bottom ?? 0)).toBe(16);
});

test('the task open in the panel is marked on its card, spans and branch rows', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  const marked = page.locator('[data-testid="ade-card"][aria-current="true"]');
  const [focusColor, badgeColor] = await page.evaluate(() =>
    ['--kira-focus', '--kira-badge'].map((v) => {
      const span = document.createElement('span');
      span.style.color = `var(${v})`;
      document.body.appendChild(span);
      const color = getComputedStyle(span).color;
      span.remove();
      return color;
    }),
  );

  await card(page, 'T_search').locator('[data-testid="ade-card-head"]').click();
  await expect(card(page, 'T_search')).toHaveAttribute('aria-current', 'true');
  await expect(marked).toHaveCount(1);
  expect(await card(page, 'T_search').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    focusColor,
  );

  await card(page, 'T_push').locator('[data-testid="ade-card-head"]').click();
  await expect(card(page, 'T_push')).toHaveAttribute('aria-current', 'true');
  expect(await card(page, 'T_search').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    badgeColor,
  );
  await expect(card(page, 'T_search')).not.toHaveAttribute('aria-current', 'true');

  const row = card(page, 'T_push').locator('[data-testid="ade-branch-row"]').first();
  await row.click();
  await expect(card(page, 'T_push')).toHaveAttribute('aria-current', 'true');
  await expect(row).toHaveAttribute('data-selected', 'true');

  const span = page.locator('[data-testid="ade-span-row"]').first();
  const taskId = await span.getAttribute('data-task-id');
  await span.click();
  await expect(card(page, taskId ?? '')).toHaveAttribute('aria-current', 'true');
  await expect(span).toHaveAttribute('data-selected', 'true');
});

test('plan cards use colour only for task edge, status, problems and the repo badge', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  await expect(page.locator('[data-testid="ade-action-cell"] [class*="-solid"]')).toHaveCount(0);
  await expect(card(page, 'T_search').locator('[data-testid="ade-step-label"]')).not.toHaveClass(
    /tone-amber|tone-green/,
  );
  const repoBadges = page.locator('[data-testid="ade-branch-repo"]');
  await expect(repoBadges.first()).toHaveAttribute('style', /--repo: var\(--kira-conn-/);
  await expect(page.locator('[data-testid="ade-branch-repo"]:not([style*="--repo"])')).toHaveCount(
    0,
  );
});

test('the Plan scrolls inside the window instead of growing it', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.setViewportSize({ width: 1440, height: 900 });
  const m = await page
    .locator('[data-testid="ade-plan"]')
    .evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, win: innerHeight }));
  expect(m.client).toBeLessThan(m.win);
  expect(m.scroll).toBeGreaterThan(m.client);
});

test('the Plan has no top bar; Refresh all sits in the repo row', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const plan = page.locator('[data-testid="ade-plan"]');
  await expect(plan.locator('[data-slot="panel-header"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ade-plan-header"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="ade-plan-repos"] [data-testid="ade-refresh-all"]'),
  ).toBeVisible();
});

test('a branch row shows its own progress under the name', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  const row = page.locator('[data-testid="ade-branch-row"][data-branch-id="b_meter"]');
  await expect(row.locator('[data-testid="ade-branch-prog"]')).toHaveText('Implement');
  await expect(
    page.locator(
      '[data-testid="ade-branch-row"][data-branch-id="b_cart"] [data-testid="ade-branch-prog"]',
    ),
  ).toHaveText('Release · failed');
});

test('line 2 shows merged and deployed chips with stale in amber and tooltips', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch);
  const cart = page.locator('[data-testid="ade-branch-row"][data-branch-id="b_cart"]').first();
  await expect(cart.locator('[data-testid="ade-branch-merged"]')).toHaveText(['dev ✓']);
  await expect(cart.locator('[data-testid="ade-branch-deployed"]')).toHaveText([
    '▲staging ✓',
    '▲prod ✓',
  ]);
  const auth = page.locator('[data-testid="ade-branch-row"][data-branch-id="b_auth"]').first();
  const stale = auth.locator('[data-testid="ade-branch-merged"]');
  await expect(stale).toHaveText('dev ⚠');
  await expect(stale).toHaveCSS('color', 'rgb(240, 184, 92)');
  await auth.hover();
  await expect(
    page
      .locator('[data-testid="ade-branch-tip"]')
      .getByText('stale in develop: 2 commits since it was merged')
      .first(),
  ).toBeVisible();
});

test('branch tooltip shows plan colours', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch);
  await page.locator('[data-testid="ade-branch-row"][data-branch-id="b_search"]').first().hover();
  const tip = page.locator('[data-testid="ade-branch-tip"]');
  await expect(tip).toBeVisible();
  await expect(tip.locator('[data-testid="ade-chip"]').first()).toBeVisible();
  await expect(tip.locator('[data-var="base"]').first()).toBeVisible();
});

test('a repo chip reports what the last fetch changed', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskRefresh, response: adeFixture('refresh') },
  ]);
  await page.locator('[data-testid="ade-refresh-all"]').click();
  await expect(
    page.locator(
      '[data-testid="ade-repo-chip"][data-repo-id="repo-web-app"] [data-testid="ade-repo-note"]',
    ),
  ).toContainText('3 refs changed · 1 merged into develop');
});

// Contract ade-board. Backend half: adeflow TestRefreshDefaultSettings (one repo with a remote that
// another clone pushed to, one without). Fixture repos repo-api and repo-mobile take the two states.
function boardWithStates(phase: 'before' | 'after'): BoardFx {
  const board = adeFixture<BoardFx>('board');
  const state = (name: string, id: string) => ({
    ...contract<Record<string, unknown>>('ade-board', `AdeTaskService.Board#repo-${name}-${phase}`),
    codeRepoId: id,
    ...(phase === 'after' && name === 'tracked' ? { lastFetchAt: FIXED_NOW - 30_000 } : {}),
  });
  board.repos = board.repos.map((r) =>
    r.codeRepoId === 'repo-api'
      ? (state('tracked', 'repo-api') as typeof r)
      : r.codeRepoId === 'repo-mobile'
        ? (state('noremote', 'repo-mobile') as typeof r)
        : r,
  );
  return board;
}

const repoNote = (page: Page, id: string) =>
  page.locator(`[data-testid="ade-repo-chip"][data-repo-id="${id}"] [data-testid="ade-repo-note"]`);

test('contract: before a refresh the repo with a remote was never fetched, the other has none', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: boardWithStates('before') },
  ]);
  await expect(repoNote(page, 'repo-api')).toHaveText('Never fetched');
  await expect(repoNote(page, 'repo-mobile')).toHaveText('No remote');
});

test('contract: Refresh all fetches a repo with a remote and rescans one without', async ({
  relaunch,
}) => {
  const refresh = (name: string, id: string) => ({
    ...contract<Record<string, unknown>>('ade-board', `AdeTaskService.Refresh#${name}`),
    codeRepoId: id,
  });
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.adeTaskBoard, response: boardWithStates('after') },
    {
      channel: IPC.adeTaskRefresh,
      response: { repos: [refresh('tracked', 'repo-api'), refresh('noremote', 'repo-mobile')] },
    },
  ]);
  await page.locator('[data-testid="ade-refresh-all"]').click();
  await expect(repoNote(page, 'repo-api')).toContainText('1 ref');
  await expect(repoNote(page, 'repo-mobile')).toHaveText('No remote · No changes');
  await expect(page.locator('[data-testid="ade-repo-note"].text-tone-red')).toHaveCount(0);
});
