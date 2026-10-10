import { describe, expect, test } from 'bun:test';
import {
  branchProgress,
  buildTaskProgress,
  type ProgressInput,
} from '../../frontend/src/ade/v2/board/progress';
import { deriveStatus } from '../../frontend/src/ade/v2/board/status';
import type { Branch, Run, Stage, Task, Workflow } from '../../frontend/src/ade/v2/wire';
import { mkBranch, mkRun, mkStage, mkTask } from './support/adeV2Fixtures';

const step = (
  id: string,
  runsOn: Stage['steps'][number]['runsOn'] = 'each repo',
  before: 'auto' | 'approval' = 'auto',
) => ({
  id,
  name: id,
  runsOn,
  before,
  onFailure: 'stop' as const,
  timeout: '1h',
  prompt: 'p',
  allowedTools: [],
  smartScript: '',
  params: {},
});

const impl = mkStage({
  id: 'impl',
  name: 'Implement',
  kind: 'agent',
  steps: [step('plan', 'once'), step('code'), step('pr', 'each repo', 'approval')],
});
const spec = mkStage({ id: 'spec', name: 'Spec', kind: 'user', status: 'In progress' });
const release = mkStage({
  id: 'release',
  name: 'Release',
  kind: 'script',
  runsOn: 'each repo',
  status: 'In review',
});
const workflow: Workflow = {
  id: 'wf',
  name: 'Feature',
  kiraSpaceMcp: false,
  stages: [spec, impl, release],
};

const NICK: Record<string, string> = { 'repo-api': 'api', 'repo-web': 'web-app' };
const branches: Branch[] = [
  mkBranch({ id: 'b_api', taskId: 'T', codeRepoId: 'repo-api' }),
  mkBranch({ id: 'b_web', taskId: 'T', codeRepoId: 'repo-web' }),
];

function input(runs: Run[], over: Partial<Task> = {}): ProgressInput {
  const task = mkTask({
    id: 'T',
    workflowId: 'wf',
    stageId: 'impl',
    currentStage: impl,
    branchIds: ['b_api', 'b_web'],
    runs,
    ...over,
  });
  return {
    task,
    workflow,
    branch: (id) => branches.find((b) => b.id === id),
    repoNick: (id) => NICK[id] ?? id,
  };
}

const run = (stepId: string, branchId: string, over: Partial<Run> = {}): Run =>
  mkRun({ taskId: 'T', stageId: 'impl', stepId, branchId, ...over });

describe('step targets and percent', () => {
  test('averages done runs as 1 and others as 0, over steps and repos', () => {
    const p = buildTaskProgress(
      input([
        run('plan', 'b_api', { state: 'done' }),
        run('code', 'b_api', { state: 'done' }),
        run('code', 'b_web', { state: 'running' }),
      ]),
    );
    // plan (once -> b_api): 1, code: (1 + 0) / 2, pr: no runs started -> 0
    expect(p.steps.map((s) => s.frac)).toEqual([1, 0.5, 0]);
    expect(p.percent).toBe(50);
    expect(p.label).toBe('Implement 1/3');
    expect(p.barTip).toBe(
      '1. plan: api ✓\n2. code: api ✓, web-app running\n3. pr: api pending, web-app pending',
    );
  });

  test('once targets the first mine branch; only <repo> matches the nickname; unmatched only has none', () => {
    const only = mkStage({
      id: 'impl',
      kind: 'agent',
      steps: [step('a', 'only web-app'), step('b', 'only nope')],
    });
    const p = buildTaskProgress(input([], { currentStage: only }));
    expect(p.steps[0]?.runs.map((r) => r.branchId)).toEqual(['b_web']);
    expect(p.steps[1]?.runs).toEqual([]);
    expect(p.steps[1]?.state).toBe('pending');
    expect(p.steps[1]?.frac).toBe(0);
    const once = buildTaskProgress(input([]));
    expect(once.steps[0]?.runs.map((r) => r.branchId)).toEqual(['b_api']);
  });

  test('review branches are never targets', () => {
    const i = input([]);
    branches[1] = mkBranch({ id: 'b_web', taskId: 'T', codeRepoId: 'repo-web', kind: 'review' });
    expect(buildTaskProgress(i).steps[1]?.runs.map((r) => r.branchId)).toEqual(['b_api']);
    branches[1] = mkBranch({ id: 'b_web', taskId: 'T', codeRepoId: 'repo-web' });
  });
});

describe('latest attempt and worst-of', () => {
  test('the highest attempt wins per (step, branch)', () => {
    const p = buildTaskProgress(
      input([
        run('code', 'b_api', { attempt: 1, state: 'failed' }),
        run('code', 'b_api', { attempt: 2, state: 'running' }),
        run('code', 'b_web', { attempt: 1, state: 'done' }),
      ]),
    );
    expect(p.steps[1]?.runs.map((r) => [r.state, r.runId.endsWith(':2')])).toEqual([
      ['running', true],
      ['done', false],
    ]);
    expect(p.steps[1]?.state).toBe('running');
    expect(p.bad).toBe(false);
  });

  test.each([
    [['done', 'stuck'], 'stuck'],
    [['failed', 'stuck'], 'stuck'],
    [['running', 'failed'], 'failed'],
    [['back', 'pending'], 'running'],
    [['running', 'done'], 'running'],
    [['done', 'pending'], 'pending'],
    [['done', 'done'], 'done'],
  ] as const)('runs %j aggregate to %s', (states, expected) => {
    const p = buildTaskProgress(
      input([
        run('code', 'b_api', { state: states[0] }),
        run('code', 'b_web', { state: states[1] }),
      ]),
    );
    expect(p.steps[1]?.state).toBe(expected);
  });

  test('stuck or failed turns the current segment red and the bar tone red', () => {
    const p = buildTaskProgress(input([run('code', 'b_web', { state: 'stuck' })]));
    expect(p.bad).toBe(true);
    expect(p.tone).toBe('red');
    expect(p.segments.map((s) => s.state)).toEqual(['done', 'blocked', 'todo']);
  });
});

describe('approval gate', () => {
  test('flags a gated pending step only when the previous step is done', () => {
    const done = (s: string) => [
      run(s, 'b_api', { state: 'done' }),
      run(s, 'b_web', { state: 'done' }),
    ];
    const ready = buildTaskProgress(input([...done('plan'), ...done('code')]));
    expect(ready.steps[2]?.approval).toBe(true);
    const notYet = buildTaskProgress(
      input([...done('plan'), run('code', 'b_api', { state: 'running' })]),
    );
    expect(notYet.steps[2]?.approval).toBe(false);
  });

  test('a gated first step never needs approval', () => {
    const first = mkStage({ id: 'impl', kind: 'agent', steps: [step('a', 'once', 'approval')] });
    expect(buildTaskProgress(input([], { currentStage: first })).steps[0]?.approval).toBe(false);
  });
});

describe('stage view', () => {
  test('finished and user stages carry no bar', () => {
    const fin = buildTaskProgress(input([], { stageId: 'done', currentStage: null }));
    expect([fin.label, fin.showBar, fin.tone]).toEqual(['Done', false, 'green']);
    expect(fin.segments.map((s) => s.state)).toEqual(['done', 'done', 'done']);
    const user = buildTaskProgress(input([], { stageId: 'spec', currentStage: spec }));
    expect([user.label, user.showBar, user.stageIndex]).toEqual(['Spec', false, 0]);
  });

  test('workflow tooltip marks done and current stages', () => {
    expect(buildTaskProgress(input([])).workflowTip).toBe(
      'Feature: ✓ Spec (user) › ▸ Implement (agent) › Release (script)',
    );
  });

  test('a script stage is one step named after the stage', () => {
    const p = buildTaskProgress(
      input(
        [
          mkRun({
            taskId: 'T',
            stageId: 'release',
            stepId: 'release',
            branchId: 'b_api',
            state: 'failed',
          }),
        ],
        {
          stageId: 'release',
          currentStage: release,
        },
      ),
    );
    expect(p.steps.map((s) => [s.id, s.state])).toEqual([['release', 'failed']]);
    expect(p.showBar).toBe(true);
  });
});

describe('branch progress line', () => {
  const lineOf = (runs: Run[], branchId = 'b_web') =>
    branchProgress(buildTaskProgress(input(runs)), branchId);

  test('names the first unfinished step with fix round and state suffix', () => {
    expect(
      lineOf([
        run('plan', 'b_api', { state: 'done' }),
        run('code', 'b_web', { state: 'running', loops: 1 }),
      ])?.label,
    ).toBe('code · fix 1');
    expect(lineOf([run('code', 'b_web', { state: 'stuck' })])?.label).toBe('code · stuck');
    expect(lineOf([run('code', 'b_web', { state: 'back' })])?.label).toBe('code ↩ sent back');
    expect(lineOf([])?.label).toBe('code · waiting');
  });

  test('is done when every step on the branch is done, and absent without a step on it', () => {
    const all = ['code', 'pr'].map((s) => run(s, 'b_web', { state: 'done' }));
    expect(lineOf(all)?.label).toBe('Implement ✓');
    expect(lineOf(all)?.tone).toBe('green');
    const onlyApi = mkStage({ id: 'impl', kind: 'agent', steps: [step('a', 'only api')] });
    expect(
      branchProgress(buildTaskProgress(input([], { currentStage: onlyApi })), 'b_web'),
    ).toBeNull();
  });
});

describe('derived status', () => {
  const status = (runs: Run[], over: Partial<Task> = {}, hasSessions = false, bs = branches) => {
    const i = input(runs, over);
    return deriveStatus({
      task: i.task,
      progress: buildTaskProgress(i),
      branches: bs,
      hasSessions,
    });
  };

  test('workflow states', () => {
    expect(status([], { stageId: 'done', currentStage: null })).toBe('Done');
    expect(status([run('code', 'b_api', { state: 'failed' })])).toBe('Blocked');
    expect(
      status([], {}, false, [
        mkBranch({
          id: 'b_api',
          taskId: 'T',
          setup: { state: 'failed', startedAt: 0, finishedAt: 1, exitCode: 1, note: '' },
        }),
      ]),
    ).toBe('Blocked');
    expect(status([run('code', 'b_api', { state: 'running' })])).toBe('In progress');
  });

  test('first stage with nothing started is To do; a session or a started step is not', () => {
    const first = { stageId: 'spec', currentStage: spec };
    expect(status([], first)).toBe('To do');
    expect(status([], first, true)).toBe('In progress');
    const firstAgent = { stageId: 'impl', currentStage: impl, workflowId: 'wf' };
    const startedFirst = input([run('plan', 'b_api', { state: 'running' })], firstAgent);
    const solo: Workflow = { ...workflow, stages: [impl] };
    const p = buildTaskProgress({ ...startedFirst, workflow: solo });
    expect(
      deriveStatus({ task: startedFirst.task, progress: p, branches, hasSessions: false }),
    ).toBe('In progress');
  });

  test('review and parked tasks ignore the workflow', () => {
    expect(status([], { kind: 'review' })).toBe('In review');
    expect(status([run('code', 'b_api', { state: 'failed' })], { kind: 'parked' })).toBe('To do');
  });
});
