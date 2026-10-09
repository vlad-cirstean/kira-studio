import fs from 'node:fs';
import path from 'node:path';
import type { Branch, Plan, Run, Stage, Task } from '../../../frontend/src/ade/v2/wire';

// Builders for the pure-logic specs: every field defaulted, a spec overrides only what it asserts on.

export function mkBranch(over: Partial<Branch> & Pick<Branch, 'id' | 'taskId'>): Branch {
  return {
    codeRepoId: 'repo-web',
    name: `feat/${over.id}`,
    kind: 'mine',
    owner: '',
    base: 'main',
    baseBranchId: '',
    baseOwner: '',
    tip: 'aaaaaaa',
    ahead: 1,
    behind: 0,
    upstream: '',
    upstreamAhead: 0,
    upstreamBehind: 0,
    mergedIntoMain: false,
    mergedAt: null,
    worktree: '',
    setup: null,
    integration: [],
    deployments: [],
    conflictsIfRebased: [],
    conflictCheck: 'done',
    conflictCheckReason: '',
    files: [],
    commits: [],
    commitCount: 1,
    dirty: [],
    lastCommitAt: null,
    addedAt: 0,
    origin: '',
    baseMissing: false,
    basePendingFrom: '',
    rebaseInProgress: false,
    ...over,
  };
}

export function mkTask(over: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    kind: 'task',
    title: '',
    owner: '',
    jira: null,
    githubUrl: '',
    workflowId: '',
    stageId: '',
    currentStage: null,
    workflow: null,
    workflowOutdated: false,
    est: '',
    notes: '',
    color: 0,
    branchIds: [],
    runs: [],
    createdAt: 0,
    ...over,
  };
}

export function mkRun(
  over: Partial<Run> & Pick<Run, 'taskId' | 'stageId' | 'stepId' | 'branchId'>,
): Run {
  return {
    id: `${over.taskId}:${over.stepId}:${over.branchId}:${over.attempt ?? 1}`,
    attempt: 1,
    state: 'pending',
    loops: 0,
    note: '',
    summary: '',
    sessionId: '',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    purpose: '',
    ...over,
  };
}

export function mkPlan(over: Partial<Plan> = {}): Plan {
  return { day: {}, order: [], queuedAfter: {}, unpushed: {}, ...over };
}

export function mkStage(over: Partial<Stage> & Pick<Stage, 'id'>): Stage {
  return {
    name: over.id,
    kind: 'user',
    status: 'In progress',
    skip: false,
    session: false,
    prompt: '',
    steps: [],
    command: '',
    runsOn: '',
    onFailure: '',
    timeout: '',
    ...over,
  };
}

/** Loads `tests/fixtures/ade-v2/<name>.json` typed as its wire shape. JSON imports widen string
 *  unions, so the cast lives here; the Go decode test already guards the shape. */
export function loadFixture<T>(name: string): T {
  const file = path.join(import.meta.dir, '../../fixtures/ade-v2', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
