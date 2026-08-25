import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';
import { expandRow, findRow, openRowMenu } from './support/tree';

// A tripwire, not a benchmark. §2.1's real interaction-budget measurements live in
// budgets.spec.ts, §2.2's total-RSS budget in memory.spec.ts, and cold start in startup.spec.ts
// (all P12) — this spec's four assertions (rAF tripwire, DOM cell bound, retained-bytes
// open/close symmetry, L2-usage-vs-budget) are cheap, single-container, and kept unchanged
// alongside them (P12 D7).
// Inverse of format.ts's formatBytes ("<number> bytes|KB|MB") — converts to MB so it's directly
// comparable to the budget field, which is a plain number (no unit) in the same units.
function parseFormattedMb(text: string): number {
  const match = /^([\d.]+)\s*(bytes|KB|MB)$/.exec(text);
  if (!match) return NaN;
  const n = Number(match[1]);
  if (match[2] === 'bytes') return n / (1024 * 1024);
  if (match[2] === 'KB') return n / 1024;
  return n;
}

test.describe.configure({ timeout: 180_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  pg = await startPostgres();
});

test.afterAll(async () => {
  await pg?.stop();
});

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
const BIG_ROWS_PATH = `${APP_PATH}/table:big_rows`;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function retainedBytes(page: Page): Promise<number> {
  return page.evaluate(() => window.__kiraGridRetainedBytes?.() ?? -1);
}

// Same race openRowMenu() guards against, but against the tab strip's own scroll: the active tab
// auto-scrolls into view (TabStrip.vue), which can leave the first (leftmost) tab off-screen —
// settle any pending scroll before the right-click's own actionability scroll can deliver its
// 'scroll' event late, right after the menu opens.
async function closeAllTabs(page: Page): Promise<void> {
  const firstTab = page.locator('[data-testid="tab"]').first();
  await firstTab.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await firstTab.click({ button: 'right' });
  await page.click('[data-testid="menu-item-close-all"]');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
}

test('perf tripwires — scroll frame time, DOM cell bound, retained bytes, L2 budget', async ({
  kira,
}) => {
  test.setTimeout(180_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const connectionId = await page.evaluate(
    (cfg) =>
      window.kira
        .connectionsCreate({
          name: 'Perf DB',
          kind: 'postgres',
          color: 'grey',
          mode: 'fields',
          readOnly: false,
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          username: cfg.username,
          password: cfg.password,
          uri: null,
          options: {},
          preconnect: null,
          preconnectSidecar: false,
        })
        .then((c) => c.id),
    {
      host: pg.config.host,
      port: pg.config.port,
      database: pg.config.database,
      username: pg.config.username,
      password: pg.config.password,
    },
  );
  void connectionId;

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });

  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  const bigRowsRow = await findRow(page, BIG_ROWS_PATH);

  // --- scroll perf: 10 000-row page, ~20 steps, sampled rAF deltas + DOM cell count -------
  await bigRowsRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await page.click('[data-testid="page-size-10000"]');
  await expect
    .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const { deltas, cellCounts } = await grid.evaluate((el) => {
    const STEPS = 20;
    const total = Math.max(0, el.scrollHeight - el.clientHeight);
    const deltas: number[] = [];
    const cellCounts: number[] = [];
    let last = performance.now();
    let sampling = true;
    function sample(now: number): void {
      deltas.push(now - last);
      last = now;
      if (sampling) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);

    return (async () => {
      for (let i = 0; i <= STEPS; i++) {
        el.scrollTop = Math.round((total * i) / STEPS);
        cellCounts.push(document.querySelectorAll('[data-testid="grid-cell"]').length);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      sampling = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { deltas, cellCounts };
    })();
  });

  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  console.log(`perf.spec.ts scroll frame time: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
  // Deliberately looser than §2.1's 8 ms budget: this is an instrumented, unoptimised Playwright
  // build. It catches "someone made the grid re-render every row per frame"; it does not certify
  // the budget — §2.1's real measurement is P12's job.
  expect(p95).toBeLessThan(24);
  expect(Math.max(...cellCounts)).toBeLessThan(1500);

  // --- retained bytes: closing ten tabs frees exactly what opening them retained ----------
  await closeAllTabs(page);
  const baseline = await retainedBytes(page);

  for (let i = 0; i < 10; i++) {
    await openRowMenu(page, BIG_ROWS_PATH);
    await page.click('[data-testid="menu-item-open-data-new-tab"]');
    await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  }
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(10);
  const afterOpen = await retainedBytes(page);
  expect(afterOpen).toBeGreaterThan(baseline);

  await closeAllTabs(page);
  const afterClose = await retainedBytes(page);
  expect(afterClose).toBe(baseline);

  // --- L2 budget: never exceeded after loading twenty distinct pages ----------------------
  await bigRowsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-1000"]');
  for (let i = 0; i < 20; i++) {
    await page.fill('[data-testid="pager-page-input"]', String(i + 1));
    await page.press('[data-testid="pager-page-input"]', 'Tab');
    await expect
      .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  }

  await page.click('[data-testid="open-settings"]');
  await page.click('[data-testid="settings-section-Cache"]');
  const budgetText = (
    await page.locator('[data-testid="settings-cache-budget"]').inputValue()
  ).trim();
  const budgetMb = Number(budgetText);
  const currentUsageInput = page
    .locator('.section-pane .field', { hasText: 'Current usage' })
    .locator('input');
  const usageValue = (await currentUsageInput.inputValue()).trim();
  // Mirrors format.ts's formatBytes: "<number> bytes|KB|MB", not a bare number — the field reads
  // e.g. "12.3 MB / 100.0 MB".
  const usedMb = parseFormattedMb(usageValue.split('/')[0]?.trim() ?? '');
  expect(Number.isFinite(usedMb)).toBe(true);
  expect(usedMb).toBeLessThanOrEqual(budgetMb);
  await page.click('[data-testid="settings-close"]');
});
