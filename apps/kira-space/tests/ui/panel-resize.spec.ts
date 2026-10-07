import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPlan } from './support/adeV2';

// P185: a panel resize must end on every release path. Reka's splitter ends a drag only on a
// `mouseup` that reaches `window`; a release it never sees (outside the viewport, swallowed by
// the native window-drag layer) left the drag attached to the cursor.

const PROJECT_HANDLE = '.workbench-shell [data-slot="resizable-handle"]';
const DOCK_HANDLE = '.workbench-shell [role="separator"][aria-label="Resize operations panel"]';

async function center(handle: Locator): Promise<{ x: number; y: number }> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function expectIdle(page: Page, handle: Locator): Promise<void> {
  await expect(handle).not.toHaveAttribute('data-state', 'drag');
  await expect(page.locator('[data-testid="main-panel"]')).not.toHaveCSS('pointer-events', 'none');
}

async function openDock(page: Page): Promise<void> {
  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();
}

const releases: {
  name: string;
  release: (page: Page, from: { x: number; y: number }, axis: 'x' | 'y') => Promise<void>;
}[] = [
  {
    name: 'press and release in place',
    release: async (page, from) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'drag and release over the page',
    release: async (page, from, axis) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + (axis === 'x' ? 60 : 0), from.y + (axis === 'y' ? -40 : 0), {
        steps: 5,
      });
      await page.mouse.up();
    },
  },
  {
    name: 'drag out of the viewport and release',
    release: async (page, from, axis) => {
      const size = page.viewportSize();
      if (!size) throw new Error('no viewport');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(axis === 'x' ? size.width + 40 : from.x, axis === 'y' ? -40 : from.y, {
        steps: 5,
      });
      await page.mouse.up();
    },
  },
];

for (const { name, release } of releases) {
  test(`project panel handle: ${name}`, async ({ relaunch }) => {
    const { window: page } = await relaunch();
    const handle = page.locator(PROJECT_HANDLE).first();
    const panel = page.locator('[data-testid="project-panel"]');
    await release(page, await center(handle), 'x');
    await expectIdle(page, handle);
    const width = (await panel.boundingBox())?.width;
    const at = await center(handle);
    await page.mouse.move(at.x + 120, at.y);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.move(at.x - 80, at.y, { steps: 4 });
    expect((await panel.boundingBox())?.width).toBe(width);
  });

  test(`operations dock handle: ${name}`, async ({ relaunch }) => {
    const { window: page } = await relaunch();
    await openDock(page);
    const handle = page.locator(DOCK_HANDLE);
    const dock = page.locator('[data-testid="operations-panel"]');
    await release(page, await center(handle), 'y');
    await expectIdle(page, handle);
    const height = (await dock.boundingBox())?.height;
    const at = await center(handle);
    await page.mouse.move(at.x, at.y - 80, { steps: 4 });
    await page.mouse.move(at.x, at.y + 40, { steps: 4 });
    expect((await dock.boundingBox())?.height).toBe(height);
  });
}

test('project panel handle: a release the splitter never sees still ends the drag', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  const handle = page.locator(PROJECT_HANDLE).first();
  const panel = page.locator('[data-testid="project-panel"]');
  const at = await center(handle);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y, { steps: 3 });
  await page.evaluate(() => {
    window.addEventListener('mouseup', (e) => e.stopImmediatePropagation(), {
      capture: true,
      once: true,
    });
  });
  await page.mouse.up();
  await expectIdle(page, handle);
  const width = (await panel.boundingBox())?.width;
  await page.mouse.move(at.x + 150, at.y, { steps: 4 });
  expect((await panel.boundingBox())?.width).toBe(width);
});

test.describe('ade panel handle', () => {
  for (const { name, release } of releases) {
    test(name, async ({ relaunch }) => {
      const { window: page } = await openPlan(relaunch);
      await page
        .locator('[data-testid="ade-card"][data-task-id="T_bill"] [data-testid="ade-card-head"]')
        .click();
      const handle = page.locator('[data-testid="ade-panel-resize-handle"]');
      await expect(handle).toBeVisible();
      await release(page, await center(handle), 'x');
      await expect(handle).not.toHaveAttribute('data-state', 'drag');
      const before = await handle.getAttribute('aria-valuenow');
      const at = await center(handle);
      await page.mouse.move(at.x - 100, at.y, { steps: 4 });
      await page.mouse.move(at.x + 60, at.y, { steps: 4 });
      expect(await handle.getAttribute('aria-valuenow')).toBe(before);
    });
  }
});
