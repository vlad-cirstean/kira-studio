import type { Page } from '@playwright/test';

/** P136: the main timeline shows the top 5 my-work stacks. Expands the list when it is capped, so
 *  a scenario seeding more stacks sees every row. */
export async function showAllWork(page: Page): Promise<void> {
  await page.locator('[data-testid="ade-timeline"]').waitFor();
  const toggle = page.locator('[data-testid="ade-show-more"]');
  if ((await toggle.count()) > 0 && /^Show \d+ more$/.test((await toggle.innerText()).trim())) {
    await toggle.click();
  }
}
