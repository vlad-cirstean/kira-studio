import { describe, expect, test } from 'bun:test';
import { implicitResults } from '../../frontend/src/ade/v2/board/stepResults';
import {
  addStep,
  aggregateEdges,
  clearRoute,
  type Graph,
  type GraphNode,
  layoutWorkflow,
  moveStage,
  NODE_H,
  NODE_W,
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
  const abs = (g: Graph, id: string): { x: number; y: number } => {
    const n = g.nodes.find((x) => x.id === id) as GraphNode;
    const parent = g.nodes.find((x) => x.id === n.parent);
    return { x: n.x + (parent?.x ?? 0), y: n.y + (parent?.y ?? 0) };
  };
  const cx = (g: Graph, id: string): number => abs(g, id).x + NODE_W / 2;
  const stepGraph = (steps: PipelineStep[]): Graph => layoutWorkflow(wfOf(steps));

  test('stages stack top to bottom on one spine column; step, leaf and end nodes share one size', () => {
    const wf = wfOf([step('a'), step('b')]);
    wf.stages.push(
      mkStage({ id: 't', kind: 'user' }),
      mkStage({ id: 'u', kind: 'agent', steps: [step('c')] }),
    );
    const g = layoutWorkflow(wf);
    const frames = g.nodes.filter((n) => n.kind === 'stage');
    expect(new Set(frames.map((n) => n.w)).size).toBe(1);
    const order = ['stage:s', 'stage:t', 'stage:u'].map(
      (id) => g.nodes.find((n) => n.id === id) as GraphNode,
    );
    expect(order[0]?.y).toBeLessThan(order[1]?.y ?? 0);
    expect(order[1]?.y).toBeLessThan(order[2]?.y ?? 0);
    expect((order[0]?.y ?? 0) + (order[0]?.h ?? 0)).toBeLessThan(order[1]?.y ?? 0);
    for (const n of g.nodes.filter((x) => x.kind !== 'stage'))
      expect([n.w, n.h]).toEqual([NODE_W, NODE_H]);
    const column = [
      cx(g, 'step:s:a'),
      cx(g, 'step:s:b'),
      cx(g, 'end:s'),
      cx(g, 'stage:t'),
      cx(g, 'step:u:c'),
    ];
    expect(new Set(column).size).toBe(1);
    expect(frames[0]?.spineX).toBe(column[0]);
    expect(g.height).toBeGreaterThan(0);
  });

  test('a linear stage ends with the end node, strictly downward', () => {
    const g = stepGraph([step('a'), step('b')]);
    const y = (id: string): number => abs(g, id).y;
    expect(y('step:s:a')).toBeLessThan(y('step:s:b'));
    expect(y('step:s:b')).toBeLessThan(y('end:s'));
    expect(g.edges.some((e) => e.id === 's:x')).toBe(false);
  });

  test('a diamond fans out: branches share a rank, the join stays on the spine, nothing points up', () => {
    const g = stepGraph([
      step('a', [res('left', true, 'b'), res('right', false, 'c')]),
      step('b', [res('done', true, 'd'), res('failed', false)]),
      step('c', [res('done', true, 'd'), res('failed', false)]),
      step('d'),
    ]);
    const p = (id: string): { x: number; y: number } => abs(g, `step:s:${id}`);
    expect(p('b').y).toBe(p('c').y);
    expect(p('b').x).not.toBe(p('c').x);
    expect(p('d').y).toBeGreaterThan(p('b').y);
    expect(cx(g, 'step:s:a')).toBe(cx(g, 'step:s:b'));
    expect(cx(g, 'step:s:b')).toBe(cx(g, 'step:s:d'));
    for (const e of g.edges.filter((x) => !x.loop && x.results.length > 0))
      expect(abs(g, e.target).y).toBeGreaterThan(abs(g, e.source).y);
  });

  test('a forward edge that skips a rank carries a route around the nodes between', () => {
    const g = stepGraph([step('a', [res('done', true), res('skip', false, 'end')]), step('b')]);
    const skip = g.edges.find((e) => e.target === 'end:s' && e.source === 'step:s:a');
    expect(skip?.points?.length).toBeGreaterThan(0);
  });

  test('nested and overlapping loops get distinct lanes, disjoint loops share one, no loop has a route', () => {
    const g = stepGraph([
      step('a', [res('done', true), res('redo', false, 'a', 2)]),
      step('b', [res('done', true), res('redo', false, 'b', 2)]),
      step('c', [res('done', true), res('redo', false, 'b', 2)]),
      step('d', [res('done', true), res('redo', false, 'b', 2), res('all', false, 'a', 2)]),
    ]);
    const lane = (source: string, target: string): number | undefined =>
      g.edges.find(
        (e) => e.loop && e.source === `step:s:${source}` && e.target === `step:s:${target}`,
      )?.lane;
    expect(lane('a', 'a')).toBe(lane('b', 'b'));
    expect(lane('c', 'b')).not.toBe(lane('b', 'b'));
    expect(lane('d', 'b')).not.toBe(lane('c', 'b'));
    expect(lane('d', 'a')).not.toBe(lane('d', 'b'));
    expect(lane('d', 'a')).toBeDefined();
    const loops = g.edges.filter((e) => e.loop);
    expect(loops.every((e) => e.points === undefined && e.laneX !== undefined)).toBe(true);
    const left = Math.min(...g.nodes.filter((n) => n.kind === 'step').map((n) => abs(g, n.id).x));
    expect(loops.every((e) => (e.laneX ?? left) < left)).toBe(true);
  });
});
