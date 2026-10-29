import { expect, type Page } from '@playwright/test';
import type { ScenarioTest } from './env';

// P391: native scrollbar thumbs show only while the pointer is inside the scroller (base.css).
// The probe is injected into the real page, so the real bundled CSS runs. No IPC, no backend half.

const GUTTER = 12;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function addProbe(page: Page, id: string, left: number, nested = false) {
  await page.evaluate(
    ({ id, left, nested }) => {
      const outer = document.createElement('div');
      outer.id = id;
      outer.style.cssText = `position:fixed;z-index:2147483647;top:80px;left:${left}px;width:200px;height:200px;overflow:auto;background:rgb(0, 0, 0)`;
      if (nested) {
        const inner = document.createElement('div');
        inner.id = `${id}-inner`;
        inner.style.cssText = 'width:150px;height:100px;overflow:auto;background:rgb(0, 0, 0)';
        const innerContent = document.createElement('div');
        innerContent.style.cssText = 'width:400px;height:800px';
        inner.append(innerContent);
        outer.append(inner);
      }
      const content = document.createElement('div');
      content.style.cssText = 'width:600px;height:1000px';
      outer.append(content);
      document.body.append(outer);
    },
    { id, left, nested },
  );
  return page.locator(`#${id}`);
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return box;
}

// Count strip pixels whose red channel differs from the black probe background.
async function thumbPixels(page: Page, box: Box, edge: 'right' | 'bottom'): Promise<number> {
  const clip =
    edge === 'right'
      ? { x: box.x + box.width - GUTTER, y: box.y, width: GUTTER, height: box.height - GUTTER }
      : { x: box.x, y: box.y + box.height - GUTTER, width: box.width - GUTTER, height: GUTTER };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 8) count++;
    return count;
  }, png);
}

export function registerScrollbarScenarios(env: { test: ScenarioTest }): void {
  const { test } = env;

  const shown = (page: Page, selector: string, edge: 'right' | 'bottom') =>
    expect
      .poll(async () => thumbPixels(page, await boxOf(page, selector), edge))
      .toBeGreaterThan(0);
  const hidden = (page: Page, selector: string, edge: 'right' | 'bottom') =>
    expect.poll(async () => thumbPixels(page, await boxOf(page, selector), edge)).toBe(0);

  async function centre(page: Page, selector: string) {
    const b = await boxOf(page, selector);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  }

  test('a scrollbar is hidden until the pointer is inside its scroller, and keeps its gutter', async ({
    relaunch,
  }) => {
    const { window: page } = await relaunch();
    const a = await addProbe(page, 'sb-a', 40);
    await addProbe(page, 'sb-b', 300);
    await page.mouse.move(5, 5);
    await hidden(page, '#sb-a', 'right');
    await hidden(page, '#sb-a', 'bottom');
    const size = () => a.evaluate((el) => [el.clientWidth, el.clientHeight]);
    const idle = await size();

    await centre(page, '#sb-a');
    await shown(page, '#sb-a', 'right');
    await shown(page, '#sb-a', 'bottom');
    await hidden(page, '#sb-b', 'right');
    expect(await size()).toEqual(idle);

    await page.mouse.move(5, 5);
    await hidden(page, '#sb-a', 'right');
  });

  test('a nested scroller shows only while the pointer is inside it', async ({ relaunch }) => {
    const { window: page } = await relaunch();
    await addProbe(page, 'sb-n', 300, true);
    await page.mouse.move(5, 5);

    await centre(page, '#sb-n-inner');
    await shown(page, '#sb-n-inner', 'right');
    await shown(page, '#sb-n', 'right');

    const outer = await boxOf(page, '#sb-n');
    await page.mouse.move(outer.x + 60, outer.y + outer.height - 40);
    await shown(page, '#sb-n', 'right');
    await hidden(page, '#sb-n-inner', 'right');
  });

  test('a dragged thumb stays shown after the pointer leaves the scroller', async ({
    relaunch,
  }) => {
    const { window: page } = await relaunch();
    const a = await addProbe(page, 'sb-a', 40);
    await centre(page, '#sb-a');
    await shown(page, '#sb-a', 'right');

    const box = await boxOf(page, '#sb-a');
    const x = box.x + box.width - GUTTER / 2;
    const y = box.y + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 150, { steps: 5 });
    await shown(page, '#sb-a', 'right');
    await expect.poll(() => a.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await page.mouse.up();
    await page.mouse.move(x + 60, y + 160);
    await hidden(page, '#sb-a', 'right');
  });
}
