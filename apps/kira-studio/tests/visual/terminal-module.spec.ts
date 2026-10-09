import { expect, test } from '../ui/fixtures';
import { modeTab } from '../ui/support/apiMode';

// P133 §5.2: the moved successor of settings.spec.ts's own dropped Scripts-pane baseline --
// full script editing now lives in ScriptDialog.vue, opened from the Terminal module.

test('quick commands dialog, empty state (P133)', async ({ kira }) => {
  const { window } = kira;
  await modeTab(window, 'terminal').click();
  await window.click('[data-testid="quick-commands-add"]');
  await expect(window.locator('[data-testid="quick-commands-dialog"]')).toBeVisible();
  await expect(window.locator('[data-testid="quick-commands-dialog"]')).toHaveScreenshot(
    'quick-commands-dialog.png',
  );
});
