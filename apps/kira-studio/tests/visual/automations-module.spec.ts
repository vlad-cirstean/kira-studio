import { expect, test } from '../ui/fixtures';
import { modeTab } from '../ui/support/apiMode';

// P133 §5.2: the moved successor of settings.spec.ts's own dropped Scripts-pane baseline --
// full script editing now lives in ScriptDialog.vue, opened from the Automations module.

test('script dialog, empty state (P133)', async ({ kira }) => {
  const { window } = kira;
  await modeTab(window, 'automations').click();
  await window.click('[data-testid="automations-add"]');
  await expect(window.locator('[data-testid="script-dialog"]')).toBeVisible();
  await expect(window.locator('[data-testid="script-dialog"]')).toHaveScreenshot(
    'script-dialog.png',
  );
});
