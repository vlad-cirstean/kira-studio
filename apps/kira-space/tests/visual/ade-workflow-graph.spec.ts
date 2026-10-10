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
  await window.setViewportSize({ width: 1400, height: 1750 });
  await window.locator('[data-testid="ade-tab-workflows"]').click();
  await window.locator('[data-testid="ade-wf-node"][data-step-id="tests"]').click();
  await expect(window.locator('[data-testid="ade-wf-result"]')).toHaveCount(3);
  await expect(window.locator('[data-testid="ade-wf-editor"]')).toHaveScreenshot(
    'workflow-graph.png',
  );
});

// P255: the locked top-to-bottom layout with a diamond fan-out, a forward skip to the end of the stage
// and two nested loops.
test('workflow graph editor branches, skips and nested loops', async ({ relaunch }) => {
  const fx = adeFixture<Fx>('workflows');
  const steps = fx.workflows[0]?.workflow.stages[1]?.steps;
  const route = (id: string, results: [string, boolean, string, number][]): void => {
    const step = steps?.find((s) => s.id === id);
    if (step)
      step.results = results.map(([rid, ok, next, max]) => ({
        id: rid,
        ok,
        description: '',
        next,
        max,
      }));
  };
  route('plan', [
    ['left', true, 'impl', 0],
    ['right', true, 'tests', 0],
    ['skip', true, 'end', 0],
  ]);
  route('impl', [
    ['done', true, 'ci', 0],
    ['retry', false, 'impl', 2],
  ]);
  route('tests', [['done', true, 'ci', 0]]);
  route('ci', [
    ['done', true, 'pr', 0],
    ['failed', false, 'impl', 3],
  ]);
  route('pr', [
    ['done', true, 'end', 0],
    ['failed', false, 'plan', 2],
  ]);
  const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskWorkflows, response: fx }]);
  await window.setViewportSize({ width: 1400, height: 1750 });
  await window.locator('[data-testid="ade-tab-workflows"]').click();
  await window.locator('[data-testid="ade-wf-node"][data-step-id="plan"]').click();
  await expect(window.locator('[data-testid="ade-wf-editor"]')).toHaveScreenshot(
    'workflow-graph-branches.png',
  );
});
