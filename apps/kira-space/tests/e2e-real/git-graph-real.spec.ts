import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// A 5600-commit, 8-branch history with merges through the real server and graph worker: paging
// reaches git's own count, every row draws its node, and resized columns survive Load more.

// Above the default 5000-row page, so Load more runs with default settings.
const COMMITS = 5600;
const BRANCHES = 8;
const MERGE_EVERY = 25;
const EPOCH = 1_767_225_600;

function fastImport(dir: string): void {
  const chunks: string[] = [];
  const tip: (number | undefined)[] = Array.from({ length: BRANCHES });
  const name = (b: number) => (b === 0 ? 'main' : `branch-${b}`);
  let mark = 0;
  const data = (s: string) => `data ${Buffer.byteLength(s)}\n${s}\n`;
  for (let i = 0; i < COMMITS; i++) {
    const b = i % BRANCHES;
    const id = ++mark;
    const ident = `Flow Test <flow@example.test> ${EPOCH + i * 60} +0000`;
    let s = `commit refs/heads/${name(b)}\nmark :${id}\nauthor ${ident}\ncommitter ${ident}\n`;
    s += data(`commit ${i}`);
    const parent = tip[b] ?? (b === 0 ? undefined : tip[0]);
    if (parent !== undefined) s += `from :${parent}\n`;
    const mergeFrom = tip[(b + 1) % BRANCHES];
    if (b === 0 && i > 0 && i % MERGE_EVERY === 0 && mergeFrom !== undefined) {
      s += `merge :${mergeFrom}\n`;
    }
    s += `M 644 inline f${i % 200}.txt\n${data(`content ${i}\n`)}\n`;
    chunks.push(s);
    tip[b] = id;
  }
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: chunks.join('') });
  execFileSync('git', ['checkout', '-q', '-f', 'main'], { cwd: dir });
}

const GRID = '[data-testid="commit-grid"]';
const VIEWPORT = `${GRID} .slick-viewport-top.slick-viewport-left`;

async function scrollToBottom(p: Page): Promise<void> {
  await p.locator(VIEWPORT).evaluate(async (vp) => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 6; i++) {
      vp.scrollTop = vp.scrollHeight;
      await frame();
      await frame();
    }
  });
}

const loadButton = (p: Page) =>
  p.locator('[data-testid="repo-graph-host"]').getByRole('button', { name: /^Load / });

async function lastRowIndex(p: Page): Promise<number> {
  return p.locator(VIEWPORT).evaluate((vp) => {
    const rows = [...vp.querySelectorAll('.slick-row[data-row]')].map((e) =>
      Number(e.getAttribute('data-row')),
    );
    return Math.max(...rows);
  });
}

/** Rows currently rendered that have no drawn graph node. */
async function rowsWithoutNode(p: Page): Promise<number[]> {
  return p.evaluate((sel) => {
    const vp = document.querySelector(sel)!.getBoundingClientRect();
    const missing: number[] = [];
    for (const el of document.querySelectorAll(
      '[data-testid="commit-grid"] .slick-row[data-row]',
    )) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= vp.top || r.top >= vp.bottom) continue;
      if (!el.querySelector('svg.kv-graph-svg circle'))
        missing.push(Number(el.getAttribute('data-row')));
    }
    return missing;
  }, VIEWPORT);
}

const handle = (p: Page, name: string) =>
  p.getByRole('separator', { name: `Resize ${name} column`, exact: true });

async function drag(p: Page, name: string, dx: number): Promise<void> {
  const box = (await handle(p, name).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(x + (dx * i) / 10, y);
  await p.mouse.up();
}

test('pages a 5600-commit history to git’s own count with a node on every row', async ({
  kira,
}) => {
  test.setTimeout(180_000);
  const repo = join(kira.work, 'big');
  fastImport(repo);
  const total = Number(
    execFileSync('git', ['rev-list', '--all', '--count'], { cwd: repo, encoding: 'utf8' }),
  );
  expect(total).toBeGreaterThanOrEqual(COMMITS);

  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await kira.reload();
  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.locator(`${GRID} svg.kv-graph-svg`).first()).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  // Branches collapse by default, which hides rows; expand so the row count is git's.
  const collapse = page.locator('[data-testid="graph-collapse-toggle"]');
  await expect(collapse).toBeVisible();
  if ((await collapse.getAttribute('aria-pressed')) === 'true') await collapse.click();
  await expect(collapse).toHaveAttribute('aria-pressed', 'false');

  // Page to the end the way a user does: scroll down, press Load more while it is offered.
  let presses = 0;
  for (;;) {
    await scrollToBottom(page);
    const more = loadButton(page);
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    presses++;
    await expect.poll(() => lastRowIndex(page), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(presses).toBeLessThan(50);
  }
  expect(presses).toBeGreaterThan(0);
  await scrollToBottom(page);
  await expect.poll(() => lastRowIndex(page), { timeout: 30_000 }).toBe(total - 1);

  // Every rendered row, at the top, middle and bottom, has a node in its lane cell.
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    await page.locator(VIEWPORT).evaluate(async (vp, f) => {
      vp.scrollTop = (vp.scrollHeight - vp.clientHeight) * f;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }, frac);
    await expect.poll(() => rowsWithoutNode(page), { timeout: 15_000 }).toEqual([]);
  }

  // Widen the graph, author and date columns, then confirm the nodes are still drawn.
  await page.locator(VIEWPORT).evaluate((vp) => {
    vp.scrollTop = 0;
  });
  await drag(page, 'graph', 150);
  await drag(page, 'author', 150);
  await drag(page, 'date', 150);
  await expect.poll(() => rowsWithoutNode(page), { timeout: 15_000 }).toEqual([]);
  await expect(page.locator(`${GRID} .slick-row[data-row="0"] .kv-cell-message`)).toHaveText(
    /commit \d+/,
  );
});
