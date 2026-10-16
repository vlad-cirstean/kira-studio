import type { Page } from '@playwright/test';
import { AUTO_REFRESH_COALESCE_MS } from '../../../../../packages/git-ui/src/state/refreshTiming';

/** Installs the fake clock after boot, then freezes it: app timers fire only when advanced.
 *  The git transport double keeps the real timers, so its replies still flow. */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 10_000);
}

/** Runs out the auto-refresh coalesce window. */
export async function runCoalesceWindow(page: Page): Promise<void> {
  await page.clock.runFor(AUTO_REFRESH_COALESCE_MS);
}
