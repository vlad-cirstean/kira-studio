import { expect, test } from '@playwright/test';
import {
  buildFakeHostInitScript,
  FAKE_BRANCH,
  FAKE_FILE_PATH,
  FAKE_REPO_ID,
  FAKE_SHA,
} from './support/fakeReviewHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G20 D9/§4.2, §7 item 4: one representative geometry case per `packages/kira-ui` positioning
 * mechanism — `KuiTooltip`, `KuiContextMenu`, `KuiPopoverPanel` — over the review sidebar's
 * existing fake-transport fixture (`fakeReviewHost.ts`), rather than one per call site. F10's own
 * finding that `webview-layout`'s dead-transport harness renders nothing beyond `.kv-app`'s empty
 * shell (re-confirmed directly against the current tree: the graph panel's pre-connect DOM has no
 * toolbar, no tooltip-carrying element at all — `AppToolbar` sits behind `v-if="repoState"`, which
 * a dead transport never resolves) is why every case below lives here instead, against real
 * rendered content, as F10's own fallback already allowed.
 */
test.describe('kira-ui floating primitives — geometry', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer({
      reviewTarget: { repoId: FAKE_REPO_ID, branch: FAKE_BRANCH },
    });
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function bootReview(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(buildFakeHostInitScript());
    await page.goto(`${server.url}/review`);
    await expect(page.locator(`[data-testid="review-row-${FAKE_SHA}"]`)).toBeVisible();
  }

  // D3/D6: KuiTooltip against a synthetic trigger carrying the same `data-kui-tip` attribute
  // `v-kui-tooltip` itself writes (tooltip.ts's own `TIP_ATTR`) — not a mock of the controller,
  // just a trigger whose position is set directly rather than inferred from the current review
  // header's layout, so this stays correct as that layout changes. Mirrors
  // apps/kira-studio/tests/ui/tooltips.spec.ts's own two new cases; one representative case here
  // is enough to prove packages/kira-ui's own, independently-implemented mechanism specifically
  // (not merely re-exercising the app-side one under a different name).
  test('KuiTooltip flips above a trigger with no room below', async ({ page }) => {
    await bootReview(page);
    await page.setViewportSize({ width: 1000, height: 400 });

    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'g20-kui-tooltip-trigger';
      btn.textContent = 'x';
      btn.setAttribute('data-kui-tip', 'Geometry test tooltip');
      Object.assign(btn.style, {
        position: 'fixed',
        top: '376px',
        left: '400px',
        width: '20px',
        height: '20px',
      });
      document.body.appendChild(btn);
    });

    const trigger = page.locator('#g20-kui-tooltip-trigger');
    await trigger.focus();
    const tip = page.locator('[data-testid="kui-tooltip"]');
    await expect(tip).toBeVisible({ timeout: 1_000 });

    const tipBox = await tip.boundingBox();
    const triggerBox = await trigger.boundingBox();
    if (!tipBox || !triggerBox) throw new Error('tooltip or trigger has no box');

    expect(
      tipBox.y + tipBox.height,
      'flip: the tooltip renders above the trigger, not merely clamped on-screen below it',
    ).toBeLessThanOrEqual(triggerBox.y + 1);
    expect(tipBox.y, 'the flipped tooltip must itself stay on-screen').toBeGreaterThanOrEqual(0);
  });

  // D3, §7 item 1 (resolved: flip: true): right-clicking a file row near the bottom of a short
  // viewport must open the menu *above* the click point (its own bottom edge <= the click's y),
  // proving flip actually fires — not merely that shift kept the menu on-screen either way, which
  // a flip:false design would also satisfy.
  test('KuiContextMenu flips above the click point with no room below', async ({ page }) => {
    await bootReview(page);

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await row.locator('.kv-review-row-header').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');

    const fileRow = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
      hasText: FAKE_FILE_PATH.split('/').pop(),
    });
    await expect(fileRow).toBeVisible();
    const rowBox = await fileRow.boundingBox();
    if (!rowBox) throw new Error('file row has no box');
    const clickY = rowBox.y + rowBox.height / 2;

    // Just enough room below the click point for a sliver, plenty of room above (the click sits
    // well down the page, under the header/tab bar/expanded row) — the menu's natural
    // below-the-click placement cannot fit, so flip() must open it above instead.
    await page.setViewportSize({ width: 1000, height: Math.ceil(clickY + 20) });

    await fileRow.click({ button: 'right', position: { x: 10, y: rowBox.height / 2 } });
    // The file row's own contextmenu handler (FileTree.vue's onRowContextMenu) calls only
    // preventDefault(), not stopPropagation() — a pre-existing bubbling quirk outside this
    // phase's own positioning-only scope (not fixed here) that also opens the row's "Commit
    // actions" menu underneath. Scoped to the one this case actually cares about.
    const menu = page.getByRole('menu', { name: 'File actions' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error('menu has no box');

    expect(
      menuBox.y + menuBox.height,
      'flip: the menu renders above the click point, not merely clamped on-screen below it',
    ).toBeLessThanOrEqual(clickY + 1);
    expect(menuBox.y, 'the flipped menu must itself stay on-screen').toBeGreaterThanOrEqual(0);
  });

  // D5: opening BaseSelector's dropdown near the right edge of a narrow viewport must keep the
  // whole panel on-screen — proving KuiPopoverPanel's shift, the mechanism every one of the 7
  // migrated dropdowns shares.
  test('KuiPopoverPanel shifts back on-screen near a horizontal viewport edge', async ({
    page,
  }) => {
    await bootReview(page);

    const trigger = page.locator('[data-testid="base-selector-trigger"]');
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error('base-selector-trigger has no box');

    // Just enough room to the trigger's right for a sliver — KuiPopoverPanel's default
    // placement ('bottom-start') grows rightward from the trigger's own left edge, forcing real
    // overflow past a narrow viewport's right edge without shift().
    await page.setViewportSize({
      width: Math.ceil(triggerBox.x + triggerBox.width + 20),
      height: 700,
    });

    await trigger.click();
    const panel = page.locator('[role="dialog"][aria-label="Choose a comparison base"]');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    if (!panelBox) throw new Error('base selector panel has no box');
    const viewportWidth = await page.evaluate(() => window.innerWidth);

    expect(panelBox.x, 'shift: the panel stays on-screen (left edge)').toBeGreaterThanOrEqual(0);
    expect(
      panelBox.x + panelBox.width,
      'shift: the panel stays on-screen (right edge)',
    ).toBeLessThanOrEqual(viewportWidth);
  });
});
