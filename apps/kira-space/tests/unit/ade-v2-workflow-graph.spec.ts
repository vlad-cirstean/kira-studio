import { describe, expect, test } from 'bun:test';
import { implicitResults } from '../../frontend/src/ade/v2/board/stepResults';
import {
  addStep,
  aggregateEdges,
  clearRoute,
  layoutWorkflow,
  moveStage,
  normalizeOrder,
  removeStep,
  setRoute,
  setStart,
} from '../../frontend/src/ade/v2/board/workflowGraph';
import type { PipelineStep, StepResult, Workflow } from '../../frontend/src/ade/v2/wire';
import { mkStage } from './support/adeV2Fixtures';

const res = (id: string, ok: boolean, next = ok ? 'next' : 'stop', max = 0): StepResult => ({
  id,
  ok,
  description: '',
  next,
  max,
});
const step = (id: string, results: StepResult[] = implicitResults(id, 'stop')): PipelineStep => ({
  id,
  name: id,
  runsOn: 'once',
  before: 'auto',
  onFailure: '',
  results,
  timeout: '1h',
  prompt: '',
  allowedTools: [],
  smartScript: '',
  params: {},
});
const wfOf = (steps: PipelineStep[]): Workflow => ({
  id: 'w',
  name: 'w',
  kiraSpaceMcp: false,
  stages: [mkStage({ id: 's', kind: 'agent', steps })],
});
const stepsOf = (wf: Workflow): PipelineStep[] => wf.stages[0]?.steps ?? [];
const next = (wf: Workflow, step: string, result: string): string =>
  stepsOf(wf)
    .find((s) => s.id === step)
    ?.results.find((r) => r.id === result)?.next ?? '';
const order = (wf: Workflow): string[] => stepsOf(wf).map((s) => s.id);

describe('aggregateEdges', () => {
  test('groups results by target and tones the edge by their ok flags', () => {
    const steps = [
      step('a', [
        res('good', true, 'b'),
        res('fine', true, 'b'),
        res('bad', false, 'b'),
        res('stop', false),
      ]),
      step('b'),
    ];
    const [e, ...rest] = aggregateEdges('s', steps, 0);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({ tone: 'neutral', results: ['good', 'fine', 'bad'], loop: false });
  });

  test('all ok is ok, all not ok is fail; stop draws no edge', () => {
    const steps = [step('a', [res('p', true, 'next'), res('q', false, 'end')]), step('b')];
    const edges = aggregateEdges('s', steps, 0);
    expect(edges.map((e) => [e.target, e.tone])).toEqual([
      ['step:s:b', 'ok'],
      ['end:s', 'fail'],
    ]);
  });

  test('an earlier or own target is a loop with its budget', () => {
    const steps = [
      step('a'),
      step('b', [res('ok', true), res('again', false, 'a', 2), res('self', false, 'b', 5)]),
    ];
    const loops = aggregateEdges('s', steps, 1).filter((e) => e.loop);
    expect(loops.map((e) => [e.target, e.max])).toEqual([
      ['step:s:a', 2],
      ['step:s:b', 5],
    ]);
  });
});

describe('setRoute', () => {
  test('an earlier target already reached forward becomes a loop edge', () => {
    const wf = setRoute(wfOf([step('a'), step('b')]), 's', 'b', 'failed', 'a');
    expect(order(wf)).toEqual(['a', 'b']);
    const r = stepsOf(wf)[1]?.results[1];
    expect([r?.next, r?.max]).toEqual(['a', 3]);
  });

  test('an earlier target that cannot reach the source moves after it', () => {
    const base = wfOf([
      step('a', [res('done', true, 'end'), res('failed', false)]),
      step('b', [res('done', true, 'end'), res('failed', false)]),
      step('c'),
    ]);
    const wf = setRoute(base, 's', 'c', 'done', 'b');
    expect(order(wf)).toEqual(['a', 'c', 'b']);
    expect(next(wf, 'c', 'done')).toBe('next');
    expect(stepsOf(wf)[1]?.results[0]?.max).toBe(0);
  });

  test('a forward target past the next step keeps its id; the following step collapses to next', () => {
    const wf = setRoute(wfOf([step('a'), step('b'), step('c')]), 's', 'a', 'done', 'c');
    expect(next(wf, 'a', 'done')).toBe('c');
    expect(next(setRoute(wf, 's', 'a', 'done', 'b'), 'a', 'done')).toBe('next');
  });

  test('self route is a loop edge', () => {
    const wf = setRoute(wfOf([step('a')]), 's', 'a', 'failed', 'a');
    expect(stepsOf(wf)[0]?.results[1]).toMatchObject({ next: 'a', max: 3 });
  });
});

describe('normalizeOrder', () => {
  test('keeps the start first and puts forward targets after their sources, stable otherwise', () => {
    const steps = [
      step('a', [res('done', true, 'c'), res('failed', false)]),
      step('b', [res('done', true, 'end'), res('failed', false)]),
      step('c', [res('done', true, 'b'), res('failed', false)]),
    ];
    expect(normalizeOrder(steps).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  test('does not mutate its input and keeps the meaning of next', () => {
    const steps = [step('a'), step('b'), step('c')];
    const before = JSON.stringify(steps);
    const out = normalizeOrder(steps);
    expect(JSON.stringify(steps)).toBe(before);
    expect(out.map((s) => s.results[0]?.next)).toEqual(['next', 'next', 'next']);
  });
});

describe('edits', () => {
  test('setStart turns the routes that led into the new start into loop edges', () => {
    const wf = setStart(wfOf([step('a'), step('b')]), 's', 'b');
    expect(order(wf)).toEqual(['b', 'a']);
    expect(stepsOf(wf)[0]?.results[0]?.next).toBe('end');
    expect(stepsOf(wf)[1]?.results[0]).toMatchObject({ next: 'b', max: 3 });
  });

  test('removeStep resets routes into it to their defaults', () => {
    const base = wfOf([
      step('a', [res('done', true, 'c'), res('failed', false, 'b', 2)]),
      step('b'),
      step('c'),
    ]);
    const wf = removeStep(base, 's', 'b');
    expect(next(wf, 'a', 'failed')).toBe('stop');
    expect(stepsOf(wf)[0]?.results[1]?.max).toBe(0);
  });

  test('clearRoute restores the default of each result', () => {
    const base = wfOf([step('a', [res('done', true, 'end'), res('failed', false, 'a', 2)])]);
    const wf = clearRoute(base, 's', 'a', ['done', 'failed']);
    expect(stepsOf(wf)[0]?.results.map((r) => [r.next, r.max])).toEqual([
      ['next', 0],
      ['stop', 0],
    ]);
  });

  test('addStep inserts after the given step and gets implicit results', () => {
    const { wf, stepId } = addStep(wfOf([step('a'), step('b')]), 's', 'a');
    expect(order(wf)[1]).toBe(stepId);
    expect(stepsOf(wf)[1]?.results.map((r) => r.id)).toEqual(['done', 'failed']);
  });

  test('moveStage reorders and ignores out-of-range indexes', () => {
    const wf: Workflow = { ...wfOf([]), stages: ['x', 'y', 'z'].map((id) => mkStage({ id })) };
    expect(moveStage(wf, 0, 2).stages.map((s) => s.id)).toEqual(['y', 'z', 'x']);
    expect(moveStage(wf, 0, 9)).toBe(wf);
  });
});

describe('layoutWorkflow', () => {
  test('ranks a stage top to bottom, ends it with the end node, lays stages left to right', () => {
    const wf = wfOf([step('a'), step('b')]);
    wf.stages.push(mkStage({ id: 't', kind: 'user' }));
    const { nodes, edges } = layoutWorkflow(wf);
    const y = (id: string): number => nodes.find((n) => n.id === id)?.y ?? -1;
    expect(y('step:s:a')).toBeLessThan(y('step:s:b'));
    expect(y('step:s:b')).toBeLessThan(y('end:s'));
    expect(
      (nodes.find((n) => n.id === 'stage:t')?.x ?? 0) >
        (nodes.find((n) => n.id === 'stage:s')?.x ?? 0),
    ).toBe(true);
    expect(edges.some((e) => e.source === 'stage:s' && e.target === 'stage:t')).toBe(true);
  });
});
