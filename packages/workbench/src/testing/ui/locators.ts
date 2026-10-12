import type { Locator, Page } from '@playwright/test';

/** The element with `data-testid="<id>"`: the one locator spelling every UI spec uses. */
export function tid(page: Page, id: string): Locator {
  return page.locator(`[data-testid="${id}"]`);
}
