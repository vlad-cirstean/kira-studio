import { expect, test } from '../ui/fixtures';
import { adeFixture, openPlan } from '../ui/support/adeV2';
import { IPC } from '../ui/support/ipcChannels';

// P247: the graph workflow editor with a branching step: a review that loops back, a trivial exit to
// the end of the stage, and the inspector open on it.
interface Fx {
  workflows: { workflow: { stages: { steps: { id: string; results: unknown[] }[] }[] } }[];
}

test('workflow graph editor with branching results', async ({ relaunch }) => {
  const fx = adeFixture<Fx>('workflows');
  const tests = fx.workflows[0]?.workflow.stages[1]?.steps.find((s) => s.id === 'tests');
  if (tests)
    tests.results = [
      { id: 'passed', ok: true, description: 'Tests pass.', next: 'next', max: 0 },
      { id: 'changes', ok: false, description: 'Needs work.', next: 'impl', max: 3 },
      { id: 'trivial', ok: true, description: 'Nothing to test.', next: 'end', max: 0 },
    ];
  const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskWorkflows, response: fx }]);
  await window.locator('[data-testid="ade-tab-workflows"]').click();
  await window.locator('[data-testid="ade-wf-node"][data-step-id="tests"]').click();
  await expect(window.locator('[data-testid="ade-wf-result"]')).toHaveCount(3);
  await expect(window.locator('[data-testid="ade-wf-editor"]')).toHaveScreenshot(
    'workflow-graph.png',
  );
});
