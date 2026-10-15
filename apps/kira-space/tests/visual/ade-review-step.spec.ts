import { expect, reviewTest, test } from '../ui/fixtures';
import { openWindow, t } from '../ui/support/adeReviewStep';
import { adeFixture, openPlan } from '../ui/support/adeV2';
import { IPC } from '../ui/support/ipcChannels';

// P286: the review window's Workflow review tab after an agent round, and the workflow graph with a
// review step.

reviewTest('review window workflow tab after a round', async ({ relaunch }) => {
  const { page } = await openWindow(relaunch, 'answered');
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.locator(t('ade-review-comment'))).toHaveCount(3);
  await expect(page.locator(t('ade-review-right'))).toHaveScreenshot('review-step-panel.png');
});

interface Fx {
  workflows: { workflow: { stages: { steps: Record<string, unknown>[] }[] } }[];
}

test('workflow graph with a review step', async ({ relaunch }) => {
  const fx = adeFixture<Fx>('workflows');
  const steps = fx.workflows[0]?.workflow.stages[1]?.steps ?? [];
  const tests = steps.find((s) => s.id === 'tests');
  if (tests) {
    tests.prompt = '';
    tests.review = { sendTo: 'implementer', implementer: '' };
    tests.results = [
      { id: 'approved', ok: true, description: '', next: 'next', loop: false },
      { id: 'rejected', ok: false, description: '', next: 'stop', loop: false },
    ];
  }
  const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskWorkflows, response: fx }]);
  await window.setViewportSize({ width: 1400, height: 1750 });
  await window.locator(t('ade-tab-workflows')).click();
  await window.locator('[data-testid="ade-wf-node"][data-step-id="tests"]').click();
  await expect(window.locator(t('ade-wf-step-review'))).toBeVisible();
  await expect(window.locator(t('ade-wf-editor'))).toHaveScreenshot('workflow-graph-review.png');
});
