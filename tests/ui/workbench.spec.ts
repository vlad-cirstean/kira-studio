import { expect, test } from './fixtures';

// Ported from tests/e2e/workbench.spec.ts (P57 D16). Five of its seven scenarios asserted real
// persistence across a relaunch (panel visibility, settings appearance/Advanced sections, word
// wrap, a narrowed-patch write leaving other sections untouched) — real writes surviving a real
// process restart, backed by src/main's own storage. This tier's `relaunch()` has no backing
// store at all (a fresh page + fresh mocks every time, tests/ui/fixtures.ts's own doc comment),
// so those five scenarios have no equivalent here and are not ported; they are also not covered
// by tests/e2e/sqlite.spec.ts (the one full-stack anchor D16 keeps, and D16's own rule is that
// its assertions do not grow to cover what this port drops), so this is a real, acknowledged
// coverage loss — see docs/AGENTS.md's P57 findings (M8) and P57-cutover.md §7. Only the two
// scenarios below asserted pure rendering with no relaunch-persistence claim.

test('the workbench is inset from the window edge on three sides (P31 D8)', async ({ kira }) => {
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
  expect(padding.top).toBe('6px');
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
