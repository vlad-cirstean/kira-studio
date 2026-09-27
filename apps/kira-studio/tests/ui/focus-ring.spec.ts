import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P130: guards the shared focus ring (packages/theme/src/base.css) against animating on focus —
// see docs/v2.0/plans/P130-focus-ring-no-animate.md §4.1. Before the fix, `outline-color` (and, on
// `transition-all` elements, `outline-width`/`outline-offset`) interpolated from `currentcolor`/
// `medium`/`0px` over Tailwind's default 150ms transition, so a freshly-focused element showed a
// white-to-blue (or thick-to-thin) flash instead of the ring's resting state on the first frame.

async function resolveFocusColor(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const span = document.createElement('span');
    span.style.color = 'var(--kira-focus)';
    document.body.appendChild(span);
    const color = getComputedStyle(span).color;
    span.remove();
    return color;
  });
}

// Real, trusted Tab keypresses, not a script-invoked el.focus() — WebKit only matches
// `:focus-visible` on a button/toggle when focus arrives from an actual keyboard event; a
// programmatic focus() never does, regardless of what was focused just before (confirmed live
// against this dialog: plan §4.1's own standalone repro page had no prior pointer interaction to
// set that modality, which this real click-driven dialog does). Capped and asserted so a future
// tab-order change fails loudly instead of silently sampling the wrong element.
async function tabUntilTestId(
  page: import('@playwright/test').Page,
  testid: string,
): Promise<void> {
  const cap = 30;
  for (let i = 0; i < cap; i++) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (current === testid) return;
  }
  throw new Error(`tabUntilTestId: never reached [data-testid="${testid}"] within ${cap} tabs`);
}

test('connection dialog Input and Button focus rings never animate', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  // Save must be enabled (reachable in tab order) for the Button assertion below.
  await page.fill('[data-testid="connection-name"]', 'Focus Ring');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');

  const focusColor = await resolveFocusColor(page);

  // Input: the dialog auto-focuses this field, so it's blurred first — a no-op focus() would
  // start no transition and false-pass the pre-fix run.
  const input = page.locator('[data-testid="connection-name"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => input.evaluate((el) => el.getAnimations().length)).toBe(0);
  const inputSample = await input.evaluate((el) => {
    (el as HTMLElement).focus();
    const outlineTransitions: string[] = [];
    for (const animation of el.getAnimations()) {
      const prop = (animation as CSSTransition).transitionProperty;
      if (typeof prop === 'string' && prop.startsWith('outline')) outlineTransitions.push(prop);
    }
    return {
      focusVisible: el.matches(':focus-visible'),
      outlineColor: getComputedStyle(el).outlineColor,
      outlineTransitions,
    };
  });
  expect(inputSample.focusVisible).toBe(true);
  expect(inputSample.outlineColor).toBe(focusColor);
  expect(inputSample.outlineTransitions).toEqual([]);

  // Button.
  await tabUntilTestId(page, 'connection-save');
  const buttonSample = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const outlineTransitions: string[] = [];
    for (const animation of el.getAnimations()) {
      const prop = (animation as CSSTransition).transitionProperty;
      if (typeof prop === 'string' && prop.startsWith('outline')) outlineTransitions.push(prop);
    }
    return {
      focusVisible: el.matches(':focus-visible'),
      outlineColor: getComputedStyle(el).outlineColor,
      outlineTransitions,
    };
  });
  expect(buttonSample.focusVisible).toBe(true);
  expect(buttonSample.outlineColor).toBe(focusColor);
  expect(buttonSample.outlineTransitions).toEqual([]);
});
