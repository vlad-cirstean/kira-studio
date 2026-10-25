import type { Page } from '@playwright/test';

/** Collects page errors and console errors from now on; assert the array is empty at the end. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  // Benign browser notice when a layout settles mid-observation; fires nondeterministically.
  const benign = (text: string) => text.includes('ResizeObserver loop');
  page.on('pageerror', (err) => {
    if (!benign(String(err))) errors.push(String(err));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !benign(msg.text())) errors.push(msg.text());
  });
  return errors;
}
