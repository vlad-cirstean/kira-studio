import dagre from '@dagrejs/dagre';
import type { PipelineStep, Stage, StepResult, Workflow } from '../wire';
import { DEFAULT_LOOP_MAX, defaultRoute, MAX_LOOP_MAX } from './stepResults';
import { newStep } from './workflowForm';

// Pure model behind the graph workflow editor (P247): the workflow as nodes and edges, the auto-layout,
// and every edit the canvas and the inspector make. All edits return a new workflow. Routes live in
// `StepResult.next`; a loop edge is one with `max > 0`, which the parser demands exactly when the target
// is the step itself or an earlier one.

type EdgeTone = 'ok' | 'fail' | 'neutral';

export const NODE_W = 256;
export const NODE_H = 104;
export const RANK_SEP = 64;
const NODE_SEP = 56;
const EDGE_SEP = 24;
const STAGE_GAP = 48;
const GROUP_PAD = 20;
const GROUP_HEAD = 36;
const LOOP_LANE = 20;
const SPINE_WEIGHT = 8;

const endNodeId = (stageId: string): string => `end:${stageId}`;
const stageNodeId = (stageId: string): string => `stage:${stageId}`;
const stepNodeId = (stageId: string, stepId: string): string => `step:${stageId}:${stepId}`;
export const resultHandleId = (resultId: string): string => `r:${resultId}`;

export interface GraphNode {
  id: string;
  kind: 'stage' | 'step' | 'end' | 'leaf';
  stageId: string;
  stepId?: string;
  parent?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stage frame only: x of the spine column inside the frame, where its handles sit. */
  spineX?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Handle of the first result on the edge; stage-to-stage edges have none. */
  sourceHandle?: string;
  stageId: string;
  stepId?: string;
  results: string[];
  tone: EdgeTone;
  loop: boolean;
  max: number;
  /** On the main success path: drawn straight. */
  spine?: boolean;
  /** Absolute route of a forward edge that skips ranks. */
  points?: Point[];
  /** Loop edge: gutter lane index and its absolute x. */
  lane?: number;
  laneX?: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Index of the step a result goes to; `steps.length` for the end of the stage, -1 for stop. */
function routeIndex(steps: readonly PipelineStep[], i: number, next: string): number {
  if (next === 'next') return i + 1;
  if (next === 'end') return steps.length;
  if (next === 'stop') return -1;
  return steps.findIndex((s) => s.id === next);
}

/** The step's results grouped by where they go: one edge per target, toned by the results on it. */
export function aggregateEdges(
  stageId: string,
  steps: readonly PipelineStep[],
  i: number,
): GraphEdge[] {
  const step = steps[i];
  if (!step) return [];
  const byTarget = new Map<number, StepResult[]>();
  for (const r of step.results) {
    const t = routeIndex(steps, i, r.next);
    if (t < 0) continue;
    byTarget.set(t, [...(byTarget.get(t) ?? []), r]);
  }
  return [...byTarget].map(([t, rs]) => {
    const target = steps[t];
    const oks = rs.filter((r) => r.ok).length;
    return {
      id: `e:${stageId}:${step.id}:${t}`,
      source: stepNodeId(stageId, step.id),
      target: target ? stepNodeId(stageId, target.id) : endNodeId(stageId),
      sourceHandle: resultHandleId((rs[0] as StepResult).id),
      stageId,
      stepId: step.id,
      results: rs.map((r) => r.id),
      tone: oks === rs.length ? 'ok' : oks === 0 ? 'fail' : 'neutral',
      loop: t <= i,
      max: Math.max(...rs.map((r) => r.max)),
    } satisfies GraphEdge;
  });
}

/** The main success path: from the start step, the first `ok` forward result each step; ends at `end`. */
function spineIds(stage: Stage): Set<string> {
  const out = new Set<string>();
  const steps = stage.steps;
  let i = 0;
  while (i >= 0 && i < steps.length) {
    const step = steps[i] as PipelineStep;
    if (out.has(stepNodeId(stage.id, step.id))) break;
    out.add(stepNodeId(stage.id, step.id));
    const r = step.results.find((x) => x.ok && routeIndex(steps, i, x.next) > i);
    i = r ? routeIndex(steps, i, r.next) : -1;
  }
  if (i === steps.length) out.add(endNodeId(stage.id));
  return out;
}

/** Lane per loop edge: intervals over the step rows, inner loops nearest the nodes. */
function loopLanes(
  loops: readonly GraphEdge[],
  rowOf: (nodeId: string) => number,
): { lanes: Map<string, number>; count: number } {
  const span = (e: GraphEdge): [number, number] => [rowOf(e.target), rowOf(e.source)];
  const sorted = [...loops].sort((a, b) => {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    return a1 - a0 - (b1 - b0) || a1 - b1;
  });
  const taken: [number, number][][] = [];
  const lanes = new Map<string, number>();
  for (const e of sorted) {
    const [lo, hi] = span(e);
    let k = taken.findIndex((l) => l.every(([a, b]) => hi < a || lo > b));
    if (k < 0) {
      taken.push([]);
      k = taken.length - 1;
    }
    (taken[k] as [number, number][]).push([lo, hi]);
    lanes.set(e.id, k);
  }
  return { lanes, count: taken.length };
}

/**
 * Dagre centres a parent between its children, which bends the main path. Pin each spine node on the
 * start step's column and push the other nodes and edge waypoints of its rank outward to keep their gaps.
 */
function snapSpine(
  node: (id: string) => Point,
  ids: readonly string[],
  spine: ReadonlySet<string>,
  waypoints: Point[],
): void {
  interface Item {
    x: number;
    node: boolean;
    target: { x: number };
  }
  const column = node(ids[0] as string).x;
  const layers = new Map<number, { items: Item[]; pin?: Item }>();
  const layer = (y: number): { items: Item[]; pin?: Item } => {
    const k = Math.round(y * 10);
    const l = layers.get(k) ?? { items: [] };
    layers.set(k, l);
    return l;
  };
  for (const id of ids) {
    const n = node(id);
    const item: Item = { x: n.x, node: true, target: n };
    const l = layer(n.y);
    l.items.push(item);
    if (spine.has(id)) l.pin = item;
  }
  for (const q of waypoints) layer(q.y).items.push({ x: q.x, node: false, target: q });
  const gap = (a: Item, b: Item): number =>
    (a.node ? NODE_W / 2 : 0) +
    (b.node ? NODE_W / 2 : 0) +
    (a.node && b.node ? NODE_SEP : EDGE_SEP);
  for (const { items, pin } of layers.values()) {
    if (!pin) continue;
    items.sort((a, b) => a.x - b.x);
    const at = items.indexOf(pin);
    pin.target.x = column;
    let prev = pin;
    let px = column;
    for (const it of items.slice(at + 1)) {
      px = Math.max(it.x, px + gap(prev, it));
      it.target.x = px;
      prev = it;
    }
    prev = pin;
    px = column;
    for (const it of items.slice(0, at).reverse()) {
      px = Math.min(it.x, px - gap(it, prev));
      it.target.x = px;
      prev = it;
    }
  }
}

interface AgentLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Inner content size, without padding or gutter. */
  innerW: number;
  innerH: number;
  spineX: number;
  lanes: number;
}

/** Inner layout relative to the content origin (left of the leftmost node, top of the first rank). */
function layoutAgent(stage: Stage): AgentLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const end = endNodeId(stage.id);
  const ids = [...stage.steps.map((s) => stepNodeId(stage.id, s.id)), end];
  for (const id of ids) g.setNode(id, { width: NODE_W, height: NODE_H });
  const spine = spineIds(stage);
  const edges = stage.steps.flatMap((_, i) => aggregateEdges(stage.id, stage.steps, i));
  for (const e of edges) {
    if (e.loop) continue;
    e.spine = spine.has(e.source) && spine.has(e.target);
    g.setEdge(e.source, e.target, { weight: e.spine ? SPINE_WEIGHT : 1, minlen: 1 });
  }
  dagre.layout(g);

  const forward = edges.filter((e) => !e.loop);
  const route = (e: GraphEdge): Point[] => {
    const src = g.node(e.source);
    const dst = g.node(e.target);
    return (g.edge(e.source, e.target)?.points ?? []).filter(
      (q: Point) => q.y > src.y + NODE_H / 2 + 0.5 && q.y < dst.y - NODE_H / 2 - 0.5,
    );
  };
  const via = new Map(forward.map((e) => [e.id, route(e)]));
  snapSpine(
    (id) => g.node(id),
    ids,
    spine,
    forward.flatMap((e) => via.get(e.id) ?? []),
  );

  const centre = (id: string): Point => {
    const p = g.node(id);
    return { x: p.x, y: p.y };
  };
  const pts = [...via.values()].flat();
  const minX = Math.min(...ids.map((id) => centre(id).x - NODE_W / 2), ...pts.map((p) => p.x));
  const maxX = Math.max(...ids.map((id) => centre(id).x + NODE_W / 2), ...pts.map((p) => p.x));
  const maxY = Math.max(...ids.map((id) => centre(id).y + NODE_H / 2));
  const rowOf = (id: string): number => (id === end ? stage.steps.length : ids.indexOf(id));
  const { lanes, count } = loopLanes(
    edges.filter((e) => e.loop),
    rowOf,
  );
  const startId = ids[0] as string;
  const nodes: GraphNode[] = ids.map((id) => {
    const c = centre(id);
    const stepId = id === end ? undefined : stage.steps[ids.indexOf(id)]?.id;
    return {
      id,
      kind: id === end ? 'end' : 'step',
      stageId: stage.id,
      stepId,
      parent: stageNodeId(stage.id),
      x: c.x - NODE_W / 2 - minX,
      y: c.y - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
    };
  });
  for (const e of edges) {
    if (e.loop) e.lane = lanes.get(e.id);
    else {
      const p = via.get(e.id) ?? [];
      if (p.length > 0) e.points = p.map((q: Point) => ({ x: q.x - minX, y: q.y }));
    }
  }
  return {
    nodes,
    edges,
    innerW: maxX - minX,
    innerH: maxY,
    spineX: centre(startId).x - minX,
    lanes: count,
  };
}

/**
 * Stages stacked top to bottom, steps ranked top to bottom inside each; every stage's spine sits on one
 * column, loop edges run in a left gutter and do not rank.
 */
export function layoutWorkflow(wf: Workflow): Graph {
  const parts = wf.stages.map((stage) => ({
    stage,
    agent: stage.kind === 'agent' ? layoutAgent(stage) : null,
  }));
  const gutter = (l: AgentLayout | null): number => (l ? l.lanes * LOOP_LANE : 0);
  const spineOf = (l: AgentLayout | null): number => (l ? l.spineX : NODE_W / 2);
  const widthOf = (l: AgentLayout | null): number => (l ? l.innerW : NODE_W);
  const column = Math.max(
    GROUP_PAD + NODE_W / 2,
    ...parts.map((p) => GROUP_PAD + gutter(p.agent) + spineOf(p.agent)),
  );
  const frameW = Math.max(
    column + NODE_W / 2 + GROUP_PAD,
    ...parts.map((p) => column - spineOf(p.agent) + widthOf(p.agent) + GROUP_PAD),
  );
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let y = 0;
  let prev: string | null = null;
  for (const { stage, agent } of parts) {
    const id = stageNodeId(stage.id);
    let h = NODE_H;
    if (agent) {
      h = GROUP_HEAD + GROUP_PAD * 2 + agent.innerH;
      const ox = column - agent.spineX;
      nodes.push({
        id,
        kind: 'stage',
        stageId: stage.id,
        x: 0,
        y,
        w: frameW,
        h,
        spineX: column,
      });
      for (const n of agent.nodes)
        nodes.push({ ...n, x: ox + n.x, y: GROUP_HEAD + GROUP_PAD + n.y });
      const abs = (p: Point): Point => ({ x: ox + p.x, y: y + GROUP_HEAD + GROUP_PAD + p.y });
      for (const e of agent.edges)
        edges.push({
          ...e,
          points: e.points?.map(abs),
          laneX: e.lane === undefined ? undefined : ox - (e.lane + 1) * LOOP_LANE,
        });
    } else {
      nodes.push({ id, kind: 'leaf', stageId: stage.id, x: column - NODE_W / 2, y, w: NODE_W, h });
    }
    if (prev)
      edges.push({
        id: `s:${prev}:${id}`,
        source: prev,
        target: id,
        stageId: stage.id,
        results: [],
        tone: 'neutral',
        loop: false,
        max: 0,
        spine: true,
      });
    prev = id;
    y += h + STAGE_GAP;
  }
  return { nodes, edges, width: frameW, height: Math.max(0, y - STAGE_GAP) };
}

function mapStage(
  wf: Workflow,
  stageId: string,
  f: (steps: PipelineStep[]) => PipelineStep[],
): Workflow {
  return {
    ...wf,
    stages: wf.stages.map((s) => (s.id === stageId ? { ...s, steps: f(clone(s.steps)) } : s)),
  };
}

/** Every `next` made explicit: `next` becomes the following step's id, or `end` after the last. */
function expand(steps: PipelineStep[]): void {
  steps.forEach((s, i) => {
    for (const r of s.results) if (r.next === 'next') r.next = steps[i + 1]?.id ?? 'end';
  });
}

function reclassify(steps: PipelineStep[]): void {
  const at = new Map(steps.map((s, i) => [s.id, i]));
  steps.forEach((s, i) => {
    for (const r of s.results) {
      const t = at.get(r.next);
      if (t === undefined) r.max = 0;
      else if (t <= i) r.max = r.max > 0 ? r.max : DEFAULT_LOOP_MAX;
      else r.max = 0;
    }
  });
}

/** Back to the short form: a route to the following step is `next`; `end` after the last step too. */
function collapse(steps: PipelineStep[]): void {
  steps.forEach((s, i) => {
    for (const r of s.results) {
      const following = steps[i + 1]?.id;
      if (
        (following !== undefined && r.next === following) ||
        (following === undefined && r.next === 'end')
      )
        r.next = 'next';
    }
  });
}

/** Whether a forward path (`next` chain and forward ids, never a loop) leads from `from` to `to`. */
function reaches(steps: readonly PipelineStep[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === to) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const i = steps.findIndex((s) => s.id === id);
    const s = steps[i];
    if (!s) return false;
    return s.results.some((r) => {
      if (r.max > 0 || r.next === 'end' || r.next === 'stop') return false;
      const t = r.next === 'next' ? steps[i + 1]?.id : r.next;
      return t !== undefined && walk(t);
    });
  };
  return walk(from);
}

/**
 * Order the steps: the first step stays the start, the rest follow a stable topological order of the
 * forward routes, so a forward route always points later. Loop routes are re-derived from the result.
 */
export function normalizeOrder(steps: readonly PipelineStep[]): PipelineStep[] {
  const out = clone([...steps]);
  expand(out);
  const start = out[0];
  if (!start) return out;
  const ids = new Set(out.map((s) => s.id));
  const incoming = new Map<string, Set<string>>(out.map((s) => [s.id, new Set()]));
  for (const s of out)
    for (const r of s.results)
      if (r.max === 0 && ids.has(r.next) && r.next !== start.id && r.next !== s.id)
        incoming.get(r.next)?.add(s.id);
  const order: PipelineStep[] = [start];
  const done = new Set([start.id]);
  const rest = out.slice(1);
  while (rest.length > 0) {
    const k = rest.findIndex((s) => [...(incoming.get(s.id) ?? [])].every((p) => done.has(p)));
    const [pick] = rest.splice(k < 0 ? 0 : k, 1) as [PipelineStep];
    order.push(pick);
    done.add(pick.id);
  }
  reclassify(order);
  collapse(order);
  return order;
}

/**
 * Point a result at `target` (`next`, `end`, `stop` or a step id of the stage). A step the target
 * already leads back to makes a loop edge; any other earlier target is moved after the source.
 */
export function setRoute(
  wf: Workflow,
  stageId: string,
  stepId: string,
  resultId: string,
  target: string,
): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const step = steps.find((s) => s.id === stepId);
    const r = step?.results.find((x) => x.id === resultId);
    if (!step || !r) return steps;
    const si = steps.indexOf(step);
    const ti = steps.findIndex((s) => s.id === target);
    r.next = target;
    if (ti < 0) {
      r.max = 0;
      return normalizeOrder(steps);
    }
    const loop = ti <= si && (ti === si || reaches(steps, target, stepId));
    r.max = loop ? clampMax(r.max || DEFAULT_LOOP_MAX) : 0;
    return normalizeOrder(steps);
  });
}

const clampMax = (n: number): number => Math.min(MAX_LOOP_MAX, Math.max(1, Math.trunc(n) || 1));

/** The route a result falls back to once its edge is removed. */
export function clearRoute(
  wf: Workflow,
  stageId: string,
  stepId: string,
  resultIds: string[],
): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const step = steps.find((s) => s.id === stepId);
    if (!step) return steps;
    for (const r of step.results)
      if (resultIds.includes(r.id)) {
        r.next = defaultRoute(r.ok);
        r.max = 0;
      }
    return normalizeOrder(steps);
  });
}

function freeResultId(results: readonly StepResult[]): string {
  const taken = new Set(results.map((r) => r.id));
  let n = results.length + 1;
  while (taken.has(`result-${n}`)) n += 1;
  return `result-${n}`;
}

export function addResult(wf: Workflow, stageId: string, stepId: string): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const step = steps.find((s) => s.id === stepId);
    if (step && step.results.length < 12)
      step.results.push({
        id: freeResultId(step.results),
        ok: true,
        description: '',
        next: 'next',
        max: 0,
      });
    return steps;
  });
}

export function removeResult(
  wf: Workflow,
  stageId: string,
  stepId: string,
  resultId: string,
): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const step = steps.find((s) => s.id === stepId);
    if (step && step.results.length > 1)
      step.results = step.results.filter((r) => r.id !== resultId);
    return steps;
  });
}

/** Replaces one result's fields; a route change goes through `setRoute`. */
export function patchResult(
  wf: Workflow,
  stageId: string,
  stepId: string,
  resultId: string,
  patch: Partial<Pick<StepResult, 'id' | 'ok' | 'description' | 'max'>>,
): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const r = steps.find((s) => s.id === stepId)?.results.find((x) => x.id === resultId);
    if (!r) return steps;
    Object.assign(r, patch);
    if (patch.ok !== undefined && r.next === defaultRoute(!patch.ok))
      r.next = defaultRoute(patch.ok);
    if (patch.max !== undefined) r.max = clampMax(patch.max);
    return steps;
  });
}

/** A new step at the end of the stage, or right after `afterStepId`. */
export function addStep(
  wf: Workflow,
  stageId: string,
  afterStepId?: string,
): { wf: Workflow; stepId: string } {
  let stepId = '';
  const next = mapStage(wf, stageId, (steps) => {
    const fresh = newStep(steps);
    stepId = fresh.id;
    const at = afterStepId ? steps.findIndex((s) => s.id === afterStepId) + 1 : steps.length;
    steps.splice(at, 0, fresh);
    return normalizeOrder(steps);
  });
  return { wf: next, stepId };
}

/** Removes a step; routes that went to it fall back to their default. */
export function removeStep(wf: Workflow, stageId: string, stepId: string): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const out = steps.filter((s) => s.id !== stepId);
    for (const s of out)
      for (const r of s.results)
        if (r.next === stepId) {
          r.next = defaultRoute(r.ok);
          r.max = 0;
        }
    return normalizeOrder(out);
  });
}

/** Makes a step the first one, the stage's start. */
export function setStart(wf: Workflow, stageId: string, stepId: string): Workflow {
  return mapStage(wf, stageId, (steps) => {
    const at = steps.findIndex((s) => s.id === stepId);
    if (at <= 0) return steps;
    expand(steps);
    const [step] = steps.splice(at, 1) as [PipelineStep];
    return normalizeOrder([step, ...steps]);
  });
}

export function moveStage(wf: Workflow, from: number, to: number): Workflow {
  if (from === to || from < 0 || to < 0 || from >= wf.stages.length || to >= wf.stages.length)
    return wf;
  const stages = [...wf.stages];
  const [s] = stages.splice(from, 1) as [Stage];
  stages.splice(to, 0, s);
  return { ...wf, stages };
}

/** What a step node shows. */
export interface StepNodeData {
  step: PipelineStep;
  start: boolean;
  selected: boolean;
  w: number;
  h: number;
}
/** What a stage group (agent) or stage node (user, script) shows. */
export interface StageNodeData {
  stage: Stage;
  index: number;
  selected: boolean;
  w: number;
  h: number;
  spineX?: number;
}
export interface EdgeData {
  tone: EdgeTone;
  loop: boolean;
  max: number;
  results: string[];
  selected: boolean;
  spine: boolean;
  points?: Point[];
  lane?: number;
  laneX?: number;
  /** Stage-to-stage edge: no label, never editable. */
  stage: boolean;
}
