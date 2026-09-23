import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

// `[data-slot="tooltip-content"]` is `ui/tooltip`'s own TooltipContent.vue marker (P104 §6.5),
// not tied to any one call site's DOM — AttributeTooltip.vue's grid-header bridge renders through
// this exact same component.
export const tooltipContent = (page: Page): Locator =>
  page.locator('[data-slot="tooltip-content"]');

/** Hovers `trigger` and asserts the real tooltip becomes visible with `text`, well within
 *  TooltipProvider's 400 ms delayDuration. toContainText, not toHaveText: reka's own
 *  TooltipContent renders a visually-hidden a11y mirror span alongside the visible text, so a
 *  bare .textContent read sees the text doubled. `timeoutMs` covers the content match, for a
 *  tooltip whose text depends on data that is still loading (e.g. an async row count). */
export async function assertTooltipShows(
  page: Page,
  trigger: Locator,
  text: string | RegExp,
  timeoutMs = 1_000,
): Promise<void> {
  await trigger.hover();
  await expect(tooltipContent(page)).toBeVisible({ timeout: timeoutMs });
  await expect(tooltipContent(page)).toContainText(text, { timeout: timeoutMs });
}
