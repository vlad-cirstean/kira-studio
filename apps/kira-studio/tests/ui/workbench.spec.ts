import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// Ported from tests/e2e/workbench.spec.ts (P57 D16). Five of its seven scenarios asserted real
// persistence across a relaunch (panel visibility, settings appearance/Advanced sections, word
// wrap, a narrowed-patch write leaving other sections untouched) — real writes surviving a real
// process restart, backed by src/main's own storage. This tier's `relaunch()` has no backing
// store at all (a fresh page + fresh mocks every time, tests/ui/fixtures.ts's own doc comment),
// so those five scenarios have no equivalent here and are not ported; they are also not covered
// by tests/e2e/sqlite.spec.ts (the one full-stack anchor D16 keeps, and D16's own rule is that
// its assertions do not grow to cover what this port drops), so this is a real, acknowledged
// coverage loss — see docs/CLAUDE.md's P57 findings (M8) and P57-cutover.md §7. Only the two
// scenarios below asserted pure rendering with no relaunch-persistence claim.

test('the workbench is inset from the window edge on two sides, none from the title bar (P31 D8)', async ({
  kira,
}) => {
  const { window } = kira;
  const shell = window.locator('.workbench-shell');
  const padding = await shell.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft,
    };
  });
  // No top inset any more: a title-bar-height session fix moved that 6px into
  // --kira-titlebar-h instead, since a gap here between the title bar and this shell's own
  // content read as the bar's content being off-centre relative to the panel right below it.
  expect(padding.top).toBe('0px');
  expect(padding.right).toBe('6px');
  expect(padding.left).toBe('6px');
  expect(padding.bottom).toBe('2px');

  const [shellBox, projectBox] = await Promise.all([
    shell.boundingBox(),
    window.locator('[data-testid="project-panel"]').boundingBox(),
  ]);
  if (!shellBox || !projectBox) throw new Error('bounding boxes not found');
  expect(projectBox.x - shellBox.x).toBeGreaterThanOrEqual(6);
});

// P42 F17: Chromium's own unstyled default for this pseudo-element is opaque white, which
// survives every theme (it uses none of this app's own tokens) until base.css overrides it.
test("the scrollbar corner is not left at Chromium's opaque-white default (P42 F17)", async ({
  kira,
}) => {
  const { window } = kira;
  const corner = await window.evaluate(
    () => getComputedStyle(document.documentElement, '::-webkit-scrollbar-corner').backgroundColor,
  );
  expect(corner).not.toBe('rgb(255, 255, 255)');
});

// P92 item 3: the title bar's own action button for shell.BuildMenu's ItemNewWindow, previously
// reachable only from the native menu — nothing in the renderer could reach it before.
test('the title bar has a New window button, before the project-panel toggle, that calls WindowsService.OpenNew once per click', async ({
  relaunch,
}) => {
  const { window, control } = await relaunch({
    control: [{ channel: IPC.windowsOpenNew, response: null }],
  });
  const newWindow = window.locator('[data-testid="new-window"]');
  await expect(newWindow).toBeVisible();
  await expect(newWindow).toContainText('New window');

  // DOM order: New window before the project-panel toggle (both in `.title-bar-actions`).
  const testIds = await window
    .locator('[data-testid="new-window"], [data-testid="toggle-project-panel"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  expect(testIds).toEqual(['new-window', 'toggle-project-panel']);

  const openNewCalls = () => control.log().filter((e) => e.channel === IPC.windowsOpenNew);
  expect(openNewCalls()).toHaveLength(0);
  await newWindow.click();
  await expect.poll(() => openNewCalls().length).toBe(1);
});
