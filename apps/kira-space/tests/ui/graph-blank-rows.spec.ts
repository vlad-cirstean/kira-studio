import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freezeClock, runCoalesceWindow } from './support/clock';
import {
  gitStreamDelivered,
  gitStreamEmit,
  gitStreamRelease,
  gitStreamRequests,
  installGitStreamMock,
} from './support/gitStreamMock';
import { BASE_RESULTS, PORT_CONTROL, PORT_REPO, type Relaunch } from './support/gitUiPortFixtures';
import {
  HEAD_NEXT_SHA,
  HISTORY_ROWS,
  historyRows,
  historySha,
  PAGE_SIZE,
  pageChunks,
  refsList,
  rewalkRows,
} from './support/graphBranchHistoryFixture';
import type { GraphStreamChunkFixture } from './support/graphStreamFixture';
import {
  armAfterLayout,
  installLayoutWorkerProbe,
  layoutReplies,
  raceSubject,
} from './support/layoutWorkerProbe';
import { trackErrors } from './support/pageErrors';

// Commits must never go blank, and the list must never collapse to a few placeholder rows, while the
// user scrolls, clicks, loads more, or the graph refreshes behind them. Needs the real layout
// worker, SlickGrid and paint; the history is branchy so the collapsed plan has many groups.

const GRID = '[data-testid="commit-grid"]';
const HOST = '[data-testid="grid-host"]';
const VIEWPORT = `${HOST} .slick-viewport-top.slick-viewport-left`;
const HISTORY = historyRows(0, HISTORY_ROWS);

const loadButton = (p: Page) =>
  p.locator('[data-testid="repo-graph-host"]').getByRole('button', { name: /^Load / });
const refreshButton = (p: Page) =>
  p.locator('[data-testid="repo-graph-host"]').getByRole('button', { name: 'Refresh' });
const subjectOf = (p: Page, row: number) =>
  p.locator(`${GRID} .slick-row[data-row="${row}"] [data-testid="message-subject"]`);

interface OpenOptions {
  readonly opens: readonly (readonly GraphStreamChunkFixture[])[];
  readonly refs?: unknown;
  readonly holdAfter?: number;
  readonly holdOpen?: number;
}

async function openGraph(relaunch: Relaunch, options: OpenOptions): Promise<Page> {
  const { window: page } = await relaunch({ control: PORT_CONTROL });
  await installLayoutWorkerProbe(page);
  await installGitStreamMock(
    page,
    PORT_REPO.repoId,
    {
      ...BASE_RESULTS,
      'refs.list': options.refs ?? refsList(historySha(0)),
      'graph.loadMore': { started: true },
    },
    undefined,
    options.opens,
    options.holdAfter,
    options.holdOpen,
  );
  await page.locator(`[data-testid="repo-row"][data-repo-id="${PORT_REPO.id}"]`).click();
  await expect(subjectOf(page, 0)).toHaveText('commit 0');
  await expect(loadButton(page)).toBeVisible();
  return page;
}

const frames = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/** Problems with the painted grid, empty when healthy: a viewport row without text or lanes, too
 *  few rows for the viewport, a grid host taller than the SlickGrid viewport, a wrong row count. */
async function gridProblems(p: Page, rowCount?: number): Promise<string[]> {
  return p.evaluate(
    ({ rows }) => {
      const host = document.querySelector<HTMLElement>('[data-testid="grid-host"]');
      const viewport = host?.querySelector<HTMLElement>('.slick-viewport-top.slick-viewport-left');
      if (!host || !viewport) return ['no grid'];
      const view = viewport.getBoundingClientRect();
      const probe = document.createElement('div');
      probe.style.height = 'var(--kira-graph-row-h)';
      host.parentElement?.appendChild(probe);
      const rowHeight = probe.getBoundingClientRect().height;
      probe.remove();
      const total = Number(host.getAttribute('aria-rowcount') ?? 0);

      const problems: string[] = [];
      let visible = 0;
      for (const row of host.querySelectorAll<HTMLElement>('.slick-row[data-row]')) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= view.top + 1 || rect.top >= view.bottom - 1) continue;
        visible++;
        const index = row.dataset.row;
        const text =
          row.querySelector('[data-testid="message-subject"]')?.textContent ??
          row.querySelector('[data-testid="graph-collapsed-row"]')?.textContent ??
          '';
        if (text.trim() === '') problems.push(`row ${index}: no text`);
        const svg = row.querySelector('svg[data-testid="graph-svg"]');
        if (!svg || svg.childElementCount === 0) problems.push(`row ${index}: no graph`);
      }
      const wanted = Math.min(total, Math.floor(view.height / rowHeight) - 1);
      if (visible < wanted) {
        problems.push(
          `only ${visible} rows visible, wanted ${wanted}; scrollTop ${viewport.scrollTop}, rowcount ${total}`,
        );
      }
      const gap = host.getBoundingClientRect().bottom - view.bottom;
      if (Math.abs(gap) > 2) problems.push(`host bottom is ${gap}px below the viewport bottom`);
      if (rows !== undefined && total !== rows) problems.push(`rowcount ${total}, wanted ${rows}`);
      return problems;
    },
    { rows: rowCount },
  );
}

interface Snapshot {
  readonly rowCount: string | null;
  readonly scrollTop: number;
  readonly subjects: readonly string[];
}

async function snapshot(p: Page): Promise<Snapshot> {
  return p.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid="grid-host"]');
    const viewport = host?.querySelector<HTMLElement>('.slick-viewport-top.slick-viewport-left');
    if (!host || !viewport) throw new Error('no grid');
    const view = viewport.getBoundingClientRect();
    const rows = [...host.querySelectorAll<HTMLElement>('.slick-row[data-row]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > view.top + 1 && rect.top < view.bottom - 1;
      })
      .sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row));
    return {
      rowCount: host.getAttribute('aria-rowcount'),
      scrollTop: viewport.scrollTop,
      subjects: rows.map(
        (row) =>
          row.querySelector('[data-testid="message-subject"]')?.textContent ??
          row.querySelector('[data-testid="graph-collapsed-row"]')?.textContent ??
          '',
      ),
    };
  });
}

async function setScrollTop(p: Page, top: number | 'end'): Promise<void> {
  await p.locator(VIEWPORT).evaluate((viewport, to) => {
    viewport.scrollTop = to === 'end' ? viewport.scrollHeight : to;
  }, top);
  await frames(p);
}

/** Scrolls from the top until a collapsed placeholder is rendered. Collapsed runs sit inside the
 *  history in date order, and a click expands every run of its group. */
async function scrollToCollapsedRow(p: Page): Promise<void> {
  const collapsed = p.locator(`${GRID} [data-testid="graph-collapsed-row"]`);
  const step = await p.locator(VIEWPORT).evaluate((viewport) => viewport.clientHeight);
  for (let top = 0; top < 40 * step; top += step) {
    await setScrollTop(p, top);
    if ((await collapsed.count()) > 0) return;
  }
  throw new Error('no collapsed row rendered in the first 40 viewports');
}

async function wheel(p: Page, steps: number, deltaY: number): Promise<void> {
  const box = (await p.locator(VIEWPORT).boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) await p.mouse.wheel(0, deltaY);
  await frames(p);
}

/** The subject of the selected row, scrolling the list until that row is rendered. */
async function selectedSubject(p: Page): Promise<string | null> {
  return p.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="grid-host"] .slick-viewport-top.slick-viewport-left',
    );
    if (!viewport) return null;
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const find = () =>
      document.querySelector(
        '[data-testid="grid-host"] .slick-row[aria-selected="true"] [data-testid="message-subject"]',
      )?.textContent ?? null;
    const first = find();
    if (first !== null) return first;
    for (let top = 0; top <= viewport.scrollHeight; top += viewport.clientHeight) {
      viewport.scrollTop = top;
      await frame();
      await frame();
      const found = find();
      if (found !== null) return found;
    }
    return null;
  });
}

const refsRequests = async (p: Page) =>
  (await gitStreamRequests(p)).filter((m) => m === 'refs.list').length;

test('rows stay painted through scroll, click and Show more, collapsed or not', async ({
  relaunch,
}) => {
  const page = await openGraph(relaunch, {
    opens: [
      pageChunks(HISTORY, 0, PAGE_SIZE, false),
      pageChunks(HISTORY, PAGE_SIZE, HISTORY_ROWS, true),
    ],
  });
  const errors = trackErrors(page);
  expect(await gridProblems(page)).toEqual([]);

  await page.locator('[data-testid="graph-collapse-toggle"]').click();
  await expect(page.locator(HOST)).toHaveAttribute('aria-rowcount', String(PAGE_SIZE));
  expect(await gridProblems(page, PAGE_SIZE)).toEqual([]);

  await wheel(page, 20, 3000);
  expect(await gridProblems(page, PAGE_SIZE)).toEqual([]);
  await wheel(page, 20, -3000);
  expect(await gridProblems(page, PAGE_SIZE)).toEqual([]);

  await page.locator(`${GRID} .slick-row[data-row="3"] .kira-cell-message`).first().click();
  expect(await gridProblems(page, PAGE_SIZE)).toEqual([]);

  await loadButton(page).click();
  await expect(loadButton(page)).toHaveCount(0);
  await expect(page.locator(HOST)).toHaveAttribute('aria-rowcount', String(HISTORY_ROWS));
  await setScrollTop(page, 'end');
  expect(await gridProblems(page, HISTORY_ROWS)).toEqual([]);

  await setScrollTop(page, 0);
  await page.locator('[data-testid="graph-collapse-toggle"]').click();
  await expect(subjectOf(page, 14)).toHaveText('commit 14');
  for (let row = 0; row < 15; row++) await expect(subjectOf(page, row)).toHaveText(`commit ${row}`);
  expect(await gridProblems(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('refs that run ahead of the graph keep the list, then the refresh adds the new commit', async ({
  relaunch,
}) => {
  const page = await openGraph(relaunch, {
    opens: [
      pageChunks(HISTORY, 0, PAGE_SIZE, false),
      pageChunks(rewalkRows(true, PAGE_SIZE), 0, PAGE_SIZE + 1, false),
    ],
    refs: { __sequence: [refsList(historySha(0)), refsList(HEAD_NEXT_SHA)] },
  });
  const errors = trackErrors(page);
  await setScrollTop(page, 3000);
  await expect.poll(() => snapshot(page).then((s) => s.scrollTop)).toBe(3000);
  await freezeClock(page);
  const before = await snapshot(page);
  expect(await gridProblems(page)).toEqual([]);
  const refsBefore = await refsRequests(page);
  const repliesBefore = await layoutReplies(page);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await expect.poll(() => refsRequests(page)).toBeGreaterThan(refsBefore);
  await expect.poll(() => layoutReplies(page)).toBeGreaterThan(repliesBefore);
  expect(await snapshot(page)).toEqual(before);
  expect(await gridProblems(page)).toEqual([]);

  const refreshesBefore = (await gitStreamRequests(page)).filter(
    (m) => m === 'graph.refresh',
  ).length;
  await runCoalesceWindow(page);
  await expect
    .poll(async () => (await gitStreamRequests(page)).filter((m) => m === 'graph.refresh').length)
    .toBe(refreshesBefore + 1);
  await expect(refreshButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await page.clock.resume();
  const after = await snapshot(page);
  expect(after.rowCount).toBe(String(Number(before.rowCount) + 1));
  expect(after.subjects[0]).toBe(before.subjects[0]);
  await expect.poll(() => gridProblems(page)).toEqual([]);
  await setScrollTop(page, 0);
  await expect(subjectOf(page, 0)).toHaveText('head moved');
  expect(errors).toEqual([]);
});

test('a refresh keeps the list until the re-walked history lands', async ({ relaunch }) => {
  const page = await openGraph(relaunch, {
    opens: [
      pageChunks(HISTORY, 0, PAGE_SIZE, false),
      pageChunks(HISTORY, PAGE_SIZE, HISTORY_ROWS, true),
      pageChunks(HISTORY, 0, HISTORY_ROWS, true),
    ],
    holdOpen: 2,
    holdAfter: 1,
  });
  const errors = trackErrors(page);
  await loadButton(page).click();
  await expect(loadButton(page)).toHaveCount(0);
  await setScrollTop(page, 4000);
  const before = await snapshot(page);
  expect(await gridProblems(page)).toEqual([]);

  await refreshButton(page).click();
  await expect.poll(() => gitStreamDelivered(page, 2)).toBe(1);
  await frames(page);
  expect(await snapshot(page)).toEqual(before);
  expect(await gridProblems(page)).toEqual([]);

  await gitStreamRelease(page);
  await expect(refreshButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await frames(page);
  const after = await snapshot(page);
  expect(after.rowCount).toBe(before.rowCount);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(await gridProblems(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a relayout that races a scroll and a click leaves the rows painted and the click on its row', async ({
  relaunch,
}) => {
  const page = await openGraph(relaunch, { opens: [pageChunks(HISTORY, 0, PAGE_SIZE, false)] });
  const errors = trackErrors(page);
  const toggle = page.locator('[data-testid="graph-collapse-toggle"]');

  async function race(depth: number, trigger: () => Promise<void>): Promise<void> {
    const replies = await layoutReplies(page);
    await armAfterLayout(page, depth, { scrollBy: -400 });
    await trigger();
    await expect.poll(() => layoutReplies(page)).toBeGreaterThan(replies);
    await frames(page);
    expect(await gridProblems(page), `depth ${depth}`).toEqual([]);
    const clicked = await raceSubject(page);
    expect(clicked, `depth ${depth}: the action found a commit row`).toEqual(expect.any(String));
    expect(await selectedSubject(page), `depth ${depth}`).toBe(clicked);
  }

  for (const depth of [0, 1, 2, 3]) {
    await scrollToCollapsedRow(page);
    await race(depth, () =>
      page.locator(`${GRID} [data-testid="graph-collapsed-row"]`).first().click(),
    );
    await setScrollTop(page, 3000);
    await race(depth, () => toggle.click());
    await setScrollTop(page, 3000);
    await race(depth, () => toggle.click());
  }
  expect(errors).toEqual([]);
});
