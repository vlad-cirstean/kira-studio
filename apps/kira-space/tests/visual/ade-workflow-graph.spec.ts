import { expect, test } from '../ui/fixtures';
import { adeFixture, openPlan } from '../ui/support/adeV2';
import { IPC } from '../ui/support/ipcChannels';

// P247: the graph workflow editor with a branching step: a review that loops back, a trivial exit to
// the end of the workflow, and the inspector open on it.
interface Fx {
  workflows: { workflow: { steps: { id: string; results: unknown[] }[] } }[];
}

test('workflow graph editor with branching results', async ({ relaunch }) => {
  const fx = adeFixture<Fx>('workflows');
  const tests = fx.workflows[0]?.workflow.steps.find((s) => s.id === 'tests');
  if (tests)
    tests.results = [
      { id: 'passed', ok: true, description: 'Tests pass.', next: 'next', loop: false },
      { id: 'changes', ok: false, description: 'Needs work.', next: 'impl', loop: true },
      { id: 'trivial', ok: true, description: 'Nothing to test.', next: 'end', loop: false },
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

// P255: the locked top-to-bottom layout with a diamond fan-out, a forward skip to the end of the workflow
// and two nested loops.
test('workflow graph editor branches, skips and nested loops', async ({ relaunch }) => {
  const fx = adeFixture<Fx>('workflows');
  const steps = fx.workflows[0]?.workflow.steps;
  const route = (id: string, results: [string, boolean, string, boolean][]): void => {
    const step = steps?.find((s) => s.id === id);
    if (step)
      step.results = results.map(([rid, ok, next, loop]) => ({
        id: rid,
        ok,
        description: '',
        next,
        loop,
      }));
  };
  route('plan', [
    ['left', true, 'impl', false],
    ['right', true, 'tests', false],
    ['skip', true, 'end', false],
  ]);
  route('impl', [
    ['done', true, 'ci', false],
    ['retry', false, 'impl', true],
  ]);
  route('tests', [['done', true, 'ci', false]]);
  route('ci', [
    ['done', true, 'pr', false],
    ['failed', false, 'impl', true],
  ]);
  route('pr', [
    ['done', true, 'end', false],
    ['failed', false, 'plan', true],
  ]);
  const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskWorkflows, response: fx }]);
  await window.setViewportSize({ width: 1400, height: 1750 });
  await window.locator('[data-testid="ade-tab-workflows"]').click();
  await window.locator('[data-testid="ade-wf-node"][data-step-id="plan"]').click();
  await expect(window.locator('[data-testid="ade-wf-editor"]')).toHaveScreenshot(
    'workflow-graph-branches.png',
  );
});

for (const [kind, step, shot] of [
  ['manual', 'spec', 'workflow-graph-manual.png'],
  ['script', 'release', 'workflow-graph-script.png'],
] as const) {
  test(`workflow graph editor with a ${kind} step selected`, async ({ relaunch }) => {
    const fx = adeFixture<Fx>('workflows');
    const { window } = await openPlan(relaunch, [{ channel: IPC.adeTaskWorkflows, response: fx }]);
    await window.setViewportSize({ width: 1400, height: 1750 });
    await window.locator('[data-testid="ade-tab-workflows"]').click();
    await window.locator(`[data-testid="ade-wf-node"][data-step-id="${step}"]`).click();
    await expect(window.locator('[data-testid="ade-wf-editor"]')).toHaveScreenshot(shot);
  });
}
