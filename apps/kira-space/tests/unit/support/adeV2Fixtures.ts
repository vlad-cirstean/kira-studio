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
    todo: null,
    loops: 0,
    note: '',
    summary: '',
    sessionId: '',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
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
