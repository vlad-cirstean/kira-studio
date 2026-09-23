import type { Page } from '@playwright/test';

// P107 I2-25: installClipboardSpy/lastClipboardWrite were copied, byte-identically, across 3
// spec files. One copy here, imported everywhere.

export async function installClipboardSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __clipboard: string[] }).__clipboard = [];
    navigator.clipboard.writeText = (text: string) => {
      (window as unknown as { __clipboard: string[] }).__clipboard.push(text);
      return Promise.resolve();
    };
  });
}

export async function lastClipboardWrite(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __clipboard: string[] }).__clipboard.at(-1) ?? '',
  );
}
