import dagre from '@dagrejs/dagre';
import type { PipelineStep, Stage, StepResult, Workflow } from '../wire';
import { DEFAULT_LOOP_MAX, defaultRoute, MAX_LOOP_MAX } from './stepResults';
import { newStep } from './workflowForm';

// Pure model behind the graph workflow editor (P247): the workflow as nodes and edges, the auto-layout,
// and every edit the canvas and the inspector make. All edits return a new workflow. Routes live in
// `StepResult.next`; a loop edge is one with `max > 0`, which the parser demands exactly when the target
// is the step itself or an earlier one.

type EdgeTone = 'ok' | 'fail' | 'neutral';

const NODE_W = 248;
const STEP_H = 112;
const LEAF_H = 72;
const END_W = 112;
const END_H = 32;
const GROUP_PAD = 16;
const GROUP_HEAD = 40;
const STAGE_GAP = 72;
const RANK_SEP = 56;

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
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
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

function layoutAgent(
  stage: Stage,
  offsetX: number,
): { nodes: GraphNode[]; edges: GraphEdge[]; w: number } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ranksep: RANK_SEP, nodesep: 40, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const end = endNodeId(stage.id);
  for (const s of stage.steps)
    g.setNode(stepNodeId(stage.id, s.id), { width: NODE_W, height: STEP_H });
  g.setNode(end, { width: END_W, height: END_H });
  const edges = stage.steps.flatMap((_, i) => aggregateEdges(stage.id, stage.steps, i));
  for (const e of edges) if (!e.loop) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const graph = g.graph();
  const innerW = Math.max(NODE_W, graph.width ?? NODE_W);
  const innerH = graph.height ?? STEP_H;
  const gid = stageNodeId(stage.id);
  const nodes: GraphNode[] = [
    {
      id: gid,
      kind: 'stage',
      stageId: stage.id,
      x: offsetX,
      y: 0,
      w: innerW + GROUP_PAD * 2,
      h: GROUP_HEAD + GROUP_PAD * 2 + innerH,
    },
  ];
  const place = (id: string, kind: 'step' | 'end', stepId?: string): void => {
    const p = g.node(id);
    nodes.push({
      id,
      kind,
      stageId: stage.id,
      stepId,
      parent: gid,
      x: GROUP_PAD + p.x - p.width / 2,
      y: GROUP_HEAD + GROUP_PAD + p.y - p.height / 2,
      w: p.width,
      h: p.height,
    });
  };
  for (const s of stage.steps) place(stepNodeId(stage.id, s.id), 'step', s.id);
  place(end, 'end');
  return { nodes, edges, w: innerW + GROUP_PAD * 2 };
}

/** Stage groups left to right, steps ranked top to bottom inside each; loop edges do not rank. */
export function layoutWorkflow(wf: Workflow): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let x = 0;
  let prev: string | null = null;
  for (const stage of wf.stages) {
    const id = stageNodeId(stage.id);
    let w = NODE_W;
    if (stage.kind === 'agent') {
      const l = layoutAgent(stage, x);
      nodes.push(...l.nodes);
      edges.push(...l.edges);
      w = l.w;
    } else {
      nodes.push({ id, kind: 'leaf', stageId: stage.id, x, y: 0, w, h: LEAF_H });
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
      });
    prev = id;
    x += w + STAGE_GAP;
  }
  return { nodes, edges };
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
}
export interface EdgeData {
  tone: EdgeTone;
  loop: boolean;
  max: number;
  results: string[];
  selected: boolean;
  /** Stage-to-stage edge: no label, never editable. */
  stage: boolean;
}
