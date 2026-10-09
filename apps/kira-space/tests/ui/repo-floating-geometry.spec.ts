import { expect, test } from './fixtures';
import { openReviewListing, SHA_A } from './support/gitUiPortFixtures';

// One geometry case per floating mechanism the shared git-ui stack uses (tooltip, dropdown menu,
// popover), run over real review content inside Space. Ported from the VS Code webview suite.

async function expandedRow(relaunch: Parameters<typeof openReviewListing>[0]) {
  const page = await openReviewListing(relaunch);
  const row = page.locator(`[data-testid="review-row-${SHA_A}"]`);
  await row.locator('.kv-review-row-header').click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  return page;
}

test('a tooltip flips above a trigger with no room below', async ({ relaunch }) => {
  const page = await expandedRow(relaunch);
  const { height } = page.viewportSize() ?? { height: 720 };

  const tree = page.locator('[data-testid="file-tree"] [role="tree"]');
  await expect(tree).toBeVisible();
  await tree.evaluate((container, top) => {
    const btn = document.createElement('button');
    btn.id = 'geometry-tooltip-trigger';
    btn.textContent = 'x';
    btn.setAttribute('data-kira-tip', 'Geometry test tooltip');
    Object.assign(btn.style, {
      position: 'fixed',
      top: `${top}px`,
      left: '400px',
      width: '20px',
      height: '20px',
    });
    container.appendChild(btn);
  }, height - 24);

  const trigger = page.locator('#geometry-tooltip-trigger');
  await trigger.focus();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toBeVisible();

  const tipBox = await tip.boundingBox();
  const triggerBox = await trigger.boundingBox();
  if (!tipBox || !triggerBox) throw new Error('tooltip or trigger has no box');
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
  expect(tipBox.y).toBeGreaterThanOrEqual(0);
});

test('a dropdown menu flips above the click point with no room below', async ({ relaunch }) => {
  const page = await expandedRow(relaunch);
  const fileRow = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
    hasText: 'example.ts',
  });
  await expect(fileRow).toBeVisible();
  const rowBox = await fileRow.boundingBox();
  if (!rowBox) throw new Error('file row has no box');
  const clickY = rowBox.y + rowBox.height / 2;

  const width = page.viewportSize()?.width ?? 1280;
  await page.setViewportSize({ width, height: Math.ceil(clickY + 10) });
  await fileRow.click({ button: 'right', position: { x: 10, y: rowBox.height / 2 } });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('menu has no box');
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(clickY + 1);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
});

test('the base selector popover shifts back on-screen near the right edge', async ({
  relaunch,
}) => {
  const page = await openReviewListing(relaunch);
  const trigger = page.locator('[data-testid="base-selector-trigger"]');
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  if (!box) throw new Error('base-selector-trigger has no box');

  await page.setViewportSize({ width: Math.ceil(box.x + box.width + 20), height: 700 });
  await trigger.click();
  const panel = page.locator('[role="dialog"][aria-label="Choose a comparison base"]');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  if (!panelBox) throw new Error('base selector panel has no box');
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewportWidth);
});
