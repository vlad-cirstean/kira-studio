import { expect, test } from '../ui/fixtures';
import { openSettings } from '../ui/support/settings';

// P110 I2-1b: one baseline per settings pane. Pre-approved re-record: the run-state/error/dialog
// colour and spinner-speed disclosures (§1.4) never touch these panes. I2-26's own fieldVariants()
// -> Field/FieldLabel conversion is measured pixel-identical (§3.6.4), so these baselines must pass
// unchanged through I2-26.
const sections = [
  'Appearance',
  'Data',
  'Cache',
  'Api',
  'Scripts',
  'Claude Code',
  'Database MCP',
  'Advanced',
] as const;

for (const section of sections) {
  test(`settings dialog: ${section} pane (P110 I2-1b)`, async ({ kira }) => {
    const { window } = kira;
    await openSettings(window);
    if (section !== 'Appearance') {
      await window.click(`[data-testid="settings-section-${section}"]`);
    }
    await expect(window.locator('[data-testid="settings-dialog"]')).toBeVisible();
    await expect(window.locator('[data-testid="settings-dialog"]')).toHaveScreenshot(
      `settings-${section.toLowerCase().replace(/\s+/g, '-')}.png`,
    );
  });
}
