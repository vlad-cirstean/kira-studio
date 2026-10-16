import type { Page } from '@playwright/test';

// P107 I2-25: installClipboardSpy/lastClipboardWrite were copied, byte-identically, across 3
// spec files. One copy here, imported everywhere.

/**
 * `lazy` also captures `clipboard.write` of ClipboardItems (console "Copy all"). Off by default:
 * Monaco's own copy calls `write` too and fails on the stub.
 */
export async function installClipboardSpy(
  page: Page,
  opts: { lazy?: boolean } = {},
): Promise<void> {
  await page.evaluate((lazy) => {
    const w = window as unknown as { __clipboard: string[] };
    w.__clipboard = [];
    navigator.clipboard.writeText = (text: string) => {
      w.__clipboard.push(text);
      return Promise.resolve();
    };
    if (lazy) {
      navigator.clipboard.write = async (items: ClipboardItem[]) => {
        for (const item of items) {
          const blob = await item.getType('text/plain');
          w.__clipboard.push(await blob.text());
        }
      };
    }
  }, opts.lazy ?? false);
}

export async function lastClipboardWrite(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __clipboard: string[] }).__clipboard.at(-1) ?? '',
  );
}

/** Replaces `navigator.clipboard` with an in-memory stub (WebKit refuses an ungestured
 *  `readText()` even with the permission granted). Install before the page loads. */
export const CLIPBOARD_SHIM = `(() => {
  let text = '';
  const clip = {
    writeText: (t) => { text = String(t); return Promise.resolve(); },
    readText: () => Promise.resolve(text),
  };
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
})();`;

export async function installClipboardShim(page: Page): Promise<void> {
  await page.addInitScript(CLIPBOARD_SHIM);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
}
