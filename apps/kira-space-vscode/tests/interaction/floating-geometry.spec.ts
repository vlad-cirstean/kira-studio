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
 * G20 D9/§4.2, §7 item 4 / P131 Part 2: one representative geometry case per floating
 * mechanism this package uses over the review sidebar's existing fake-transport fixture
 * (`fakeReviewHost.ts`), rather than one per call site. The Tooltip and DropdownMenu cases now
 * exercise shadcn-vue's own reka-ui-backed components (`AttributeTooltip.vue`/`RowContextMenu.vue`
 * — converted off `packages/kira-ui`'s `KuiTooltip`/`KuiContextMenu` in P131 Part 2); the
 * BaseSelector case still exercises `KuiPopoverPanel`, unconverted until Part 3. F10's own finding
 * that `webview-layout`'s dead-transport harness renders nothing beyond `.kv-app`'s empty shell
 * (re-confirmed directly against the current tree: the graph panel's pre-connect DOM has no
 * toolbar, no tooltip-carrying element at all — `AppToolbar` sits behind `v-if="repoState"`, which
 * a dead transport never resolves) is why every case below lives here instead, against real
 * rendered content, as F10's own fallback already allowed.
 */
test.describe('floating primitives — geometry', () => {
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

  // P131 Part 2 §3.2: the tooltip mechanism is now AttributeTooltip.vue's single hoisted
  // Tooltip/TooltipContent pair, driven off any `[data-kira-tip]` element inside its own
  // `container` (here, FileTree.vue's own `[role="tree"]` root) — not a mock of the controller,
  // a synthetic trigger appended into that same container so this stays correct as the file
  // tree's own layout changes. Mirrors apps/kira-studio/tests/ui/tooltips.spec.ts's own cases;
  // one representative case here is enough to prove this package's own floating stack
  // specifically (not merely re-exercising the app-side one under a different name).
  test('Tooltip flips above a trigger with no room below', async ({ page }) => {
    await bootReview(page);
    await page.setViewportSize({ width: 1000, height: 400 });

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await row.locator('.kv-review-row-header').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');

    const tree = page.locator('[data-testid="file-tree"] [role="tree"]');
    await expect(tree).toBeVisible();

    await tree.evaluate((container) => {
      const btn = document.createElement('button');
      btn.id = 'p131-tooltip-trigger';
      btn.textContent = 'x';
      btn.setAttribute('data-kira-tip', 'Geometry test tooltip');
      Object.assign(btn.style, {
        position: 'fixed',
        top: '376px',
        left: '400px',
        width: '20px',
        height: '20px',
      });
      container.appendChild(btn);
    });

    const trigger = page.locator('#p131-tooltip-trigger');
    await trigger.focus();
    const tip = page.locator('[data-slot="tooltip-content"]');
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
  // a flip:false design would also satisfy. P131 Part 2 §3.6: the menu is now RowContextMenu.vue's
  // point-anchored shadcn DropdownMenu (reka's own `role="menu"`, unchanged from before).
  test('DropdownMenu flips above the click point with no room below', async ({ page }) => {
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
    // below-the-click placement cannot fit, so flip() must open it above instead. P131 Part 2: 10px
    // (not the old KuiContextMenu fixture's 20px) — this fixture's single "Copy path" item renders
    // at ~19.5px in the shadcn DropdownMenuItem's own more compact sizing, so 20px of slack no
    // longer forces genuine overflow the way it did against KuiContextMenu's taller row.
    await page.setViewportSize({ width: 1000, height: Math.ceil(clickY + 10) });

    await fileRow.click({ button: 'right', position: { x: 10, y: rowBox.height / 2 } });
    // G34 D17: FileTree.vue's own contextmenu handler (onRowContextMenu) now calls
    // stopPropagation() as well as preventDefault(), so the row's ancestor "Commit actions" menu
    // never also opens underneath — exactly one menu, no name filter needed to pick it out.
    const menu = page.getByRole('menu');
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
  // migrated dropdowns shares. Unconverted until Part 3 (BaseSelector.vue still owns this).
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
