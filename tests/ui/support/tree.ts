import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

// P28 F6: these five functions were copied, byte-identically or nearly so, into twenty spec
// files — seventeen of them the naive `waitForTimeout(30)` variant `tree.spec.ts`'s own history
// documents as flaky under load. One copy here, imported everywhere, is what makes any future
// change to "how a tree row is reached" (P28's sticky band among them) a one-file edit instead of
// a twenty-file one.

export function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

// Scrolling the tree closes any open context menu (a window-level capture-phase 'scroll'
// listener backs that, correctly, so a menu never floats over content that's moved out from
// under it) — and a programmatic scrollTop write dispatches its 'scroll' event asynchronously,
// on a timer the browser controls. A blind `waitForTimeout` after the write is a guess at that
// timing; under load it guesses wrong and the event fires later, right after a click that opened
// a fresh menu, closing it before the next assertion sees it. So this waits for the 'scroll'
// event itself (falling back to a short timeout for a write that doesn't actually move
// scrollTop, which fires no event at all) before ever proceeding — the row is only found or
// clicked once no scroll event from this helper's own writes can still be in flight.
export async function scrollAndSettle(
  container: Locator,
  mode: 'reset' | 'advance',
): Promise<void> {
  await container.evaluate(
    (el, m) =>
      new Promise<void>((resolve) => {
        const before = el.scrollTop;
        const target = m === 'reset' ? 0 : before + Math.max(200, el.clientHeight);
        if (target === before) {
          resolve();
          return;
        }
        const onScroll = () => {
          el.removeEventListener('scroll', onScroll);
          resolve();
        };
        el.addEventListener('scroll', onScroll);
        el.scrollTop = target;
        // Fallback in case the browser coalesces/suppresses the event unexpectedly.
        setTimeout(() => {
          el.removeEventListener('scroll', onScroll);
          resolve();
        }, 300);
      }),
    mode,
  );
}

// P28 D8: the sticky ancestor band is interactive, so it occludes the real rows scrolled up
// behind it — Playwright's actionability check fails a click whose hit-test lands on the band,
// and (since the row is already inside the scrollport) `scrollIntoViewIfNeeded` is a no-op that
// never fixes it. Scrolling the row clear of the band's own measured height, once, here, is what
// keeps that one fact in one file instead of twenty retry loops.
async function clearStickyBand(page: Page, container: Locator, target: Locator): Promise<void> {
  if ((await target.count()) === 0) return;
  // findRow's fast path (the row is already in the DOM via overscan) skips the scroll-search
  // loop, so `target` can be present yet scrolled fully above the viewport — not just occluded
  // by the band, genuinely out of view. The shortfall math below assumes the row starts inside
  // the scrollport; fed a negative (above-viewport) offset, it computes a shortfall that scrolls
  // even further down, pushing the row out of the overscan window entirely (it vanishes from the
  // DOM, and the caller's subsequent click hangs waiting for a row that will never come back).
  // Bringing it into the natural viewport first is a no-op for the ordinary "in view but under
  // the band" case (already handled below) and a real fix for the above-viewport case.
  await target.scrollIntoViewIfNeeded();
  const band = page.locator('[data-testid="tree-sticky-band"]');
  if ((await band.count()) === 0) return;
  const bandHeight = await band.evaluate((el) => {
    const bandTop = el.getBoundingClientRect().top;
    let bottom = 0;
    for (const child of Array.from(el.children)) {
      bottom = Math.max(bottom, child.getBoundingClientRect().bottom - bandTop);
    }
    return bottom;
  });
  if (bandHeight <= 0) return;
  const [targetBox, containerBox] = await Promise.all([
    target.boundingBox(),
    container.boundingBox(),
  ]);
  if (!targetBox || !containerBox) return;
  const occludedBottom = containerBox.y + bandHeight;
  if (targetBox.y >= occludedBottom) return;
  const shortfall = occludedBottom - targetBox.y;
  await container.evaluate((el, delta) => {
    el.scrollTop += delta;
  }, shortfall);
  await page.waitForTimeout(50);
}

// The project tree is virtualized (VirtualList.vue) — a row not currently scrolled into view
// simply is not in the DOM. Scroll the container down in pages until the target row appears
// (or the bottom is reached) instead of asserting on a DOM query that may just be off-screen.
export async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  if ((await target.count()) > 0) {
    await clearStickyBand(page, container, target);
    return target;
  }
  await scrollAndSettle(container, 'reset');
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) break;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await scrollAndSettle(container, 'advance');
  }
  await clearStickyBand(page, container, target);
  return target;
}

export async function expandRow(page: Page, path: string): Promise<Locator> {
  const row = await findRow(page, path);
  await expect(row).toBeVisible();
  await row.locator('.twisty').click();
  await expect(row.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
  return row;
}

// A right-click on a row that Playwright still considers not-quite-in-view triggers its own
// internal scroll-into-view as part of the click's actionability check — a scroll whose 'scroll'
// event (caught, correctly, by the same window-level listener) can otherwise land asynchronously
// right after the click opens a fresh menu, closing it before the next assertion sees it.
// Scrolling the row fully into view ourselves first, and waiting out any resulting event, means
// the click that follows has nothing left to scroll.
export async function openRowMenu(page: Page, path: string): Promise<void> {
  const row = await findRow(page, path);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

/** The connection row, optionally filtered by its visible name — the panel's own single-column
 *  identity for a connection, matching `connections.spec.ts`'s own `.filter({ hasText: name })`
 *  convention. */
export function connectionRow(page: Page, name?: string): Locator {
  const base = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  return name ? base.filter({ hasText: name }) : base;
}
