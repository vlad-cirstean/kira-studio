import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

// P280: presentation screenshots. Not a test helper: nothing here asserts app behaviour.

const ROOT_DIR = resolve(__dirname, '../../../../..');
const OUT_DIR = join(ROOT_DIR, 'screenshots');

/** The apps' minimum window (`minWindowWidth`/`minWindowHeight`, internal/shell/window.go). */
export const WINDOW = { width: 1024, height: 640 } as const;
export const SCALE = 2;
const DETAIL_SIZE = { width: 440, height: 330 } as const;

// Fontsource packages live in the site workspace, so resolve from there.
const siteRequire = createRequire(join(ROOT_DIR, 'site', 'package.json'));

async function fontFile(pkg: string, file: string): Promise<string> {
  const dir = resolve(siteRequire.resolve(`${pkg}/package.json`), '..', 'files');
  return (await readFile(join(dir, file))).toString('base64');
}

/** Pins the UI font to Inter and the data font to JetBrains Mono before any app script runs. The
 *  apps use `-apple-system` and Menlo, which Linux lacks. */
export async function installCaptureFonts(page: Page): Promise<void> {
  const faces = [
    {
      family: 'Inter',
      weight: '100 900',
      data: await fontFile('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'),
    },
    {
      family: 'JetBrains Mono',
      weight: '400',
      data: await fontFile('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'),
    },
    {
      family: 'JetBrains Mono',
      weight: '700',
      data: await fontFile('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff2'),
    },
  ];
  await page.addInitScript((list) => {
    for (const f of list) {
      const face = new FontFace(f.family, `url(data:font/woff2;base64,${f.data})`, {
        weight: f.weight,
      });
      document.fonts.add(face);
      void face.load();
    }
    const apply = () => {
      const style = document.createElement('style');
      // :root:root outranks tokens.css's plain :root, which loads after this script.
      style.textContent =
        ":root:root{--kira-font-ui:'Inter',sans-serif;--kira-font-family:'JetBrains Mono',monospace}";
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.documentElement) {
      apply();
    } else {
      new MutationObserver((_records, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        apply();
      }).observe(document, { childList: true });
    }
  }, faces);
}

/** Pinned wall clock for every shot: Tue 2026-09-22, the day Kira Space's committed ADE fixtures
 *  are anchored to (`FIXED_NOW` in apps/kira-space/tests/ui/support/adeV2.ts). */
export const CAPTURE_NOW = 1_790_070_000_000;

/** The `relaunch()` options every shot shares. */
export const CAPTURE_LAUNCH = {
  viewport: WINDOW,
  deviceScaleFactor: SCALE,
  locale: 'en-US',
  timezoneId: 'UTC',
  clockTime: CAPTURE_NOW,
  prepare: installCaptureFonts,
} as const;

export interface ShotOptions {
  readonly id: string;
  /** Top-left of the 440 x 330 CSS px detail crop, over the feature the shot shows. */
  readonly detail: { readonly x: number; readonly y: number };
  /** The `consoleErrors` fixture of the run. */
  readonly consoleErrors: readonly string[];
}

async function frame(page: Page, raw: Buffer): Promise<Buffer> {
  const lights = await readFile(join(OUT_DIR, 'assets', 'traffic-lights.svg'));
  const shot = await page.context().newPage();
  try {
    await shot.setViewportSize(WINDOW);
    await shot.setContent(`<!doctype html>
<html><body style="margin:0;background:transparent">
<div id="frame" style="position:relative;width:${WINDOW.width}px;height:${WINDOW.height}px;border-radius:10px;overflow:hidden">
<img id="raw" style="display:block;width:100%;height:100%" src="data:image/png;base64,${raw.toString('base64')}">
<div style="position:absolute;inset:0;border-radius:10px;box-shadow:inset 0 0 0 1px rgb(255 255 255 / 0.1)"></div>
<img id="lights" style="position:absolute;left:14px;top:11px;width:52px;height:12px" src="data:image/svg+xml;base64,${lights.toString('base64')}">
</div></body></html>`);
    await shot.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    return await shot
      .locator('#frame')
      .screenshot({ omitBackground: true, animations: 'disabled' });
  } finally {
    await shot.close();
  }
}

/** Writes `screenshots/<id>.png`, `<id>-detail.png` and `framed/<id>.png`. Call once the view shows
 *  its key content: the caller asserts that first. */
export async function captureShot(page: Page, options: ShotOptions): Promise<void> {
  const { id, detail, consoleErrors } = options;
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('13px Inter'))).toBe(true);
  expect(consoleErrors).toEqual([]);

  const capture = { animations: 'disabled', caret: 'hide', scale: 'device' } as const;
  const raw = await page.screenshot(capture);
  const crop = await page.screenshot({ ...capture, clip: { ...detail, ...DETAIL_SIZE } });

  await mkdir(join(OUT_DIR, 'framed'), { recursive: true });
  await writeFile(join(OUT_DIR, `${id}.png`), raw);
  await writeFile(join(OUT_DIR, `${id}-detail.png`), crop);
  await writeFile(join(OUT_DIR, 'framed', `${id}.png`), await frame(page, raw));
}
