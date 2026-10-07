import { type ActivityKind, activityKind, shortId } from '../activity';
import type { Branch, Run, Session, Task, Workflow } from '../wire';

// A session as the Sessions tab and All sessions list show it (mockup `termFor` / `agents`). Pure:
// the lookups come in as data, so a session of an archived task, which the board no longer lists,
// degrades to its ids instead of failing.

export interface SessionLookup {
  task: (id: string) => Task | undefined;
  branch: (id: string) => Branch | undefined;
  repoLabel: (codeRepoId: string) => string;
  workflow: (id: string) => Workflow | undefined;
}

export interface SessionView {
  session: Session;
  kind: ActivityKind;
  headless: boolean;
  /** Repo nickname; `''` for a task-level (spec) session. */
  repo: string;
  /** Branch name; `''` for a task-level session. */
  branch: string;
  worktree: string;
  step: string;
  run: Run | null;
  /** Strip tab: `Implement · repo` / `Implement · Create PR · repo`; `Review agent` for the review agent. */
  tabName: string;
  badge: 'TUI' | 'claude -p';
  /** Finished / stopped row: `run · Create PR · repo · branch · c81a` / `TUI · spec · 3c3c`. */
  stoppedLabel: string;
  /** All sessions kind column: `claude -p · <step>` / `TUI · interactive` / `TUI · spec session`. */
  allLabel: string;
}

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

function stepNameOf(workflow: Workflow | undefined, stepId: string): string {
  for (const stage of workflow?.stages ?? []) {
    for (const step of stage.steps) if (step.id === stepId) return step.name;
  }
  return stepId;
}

/** The session's own stage, by name: the task's workflow first, then its current-stage snapshot. */
function stageNameOf(
  workflow: Workflow | undefined,
  task: Task | undefined,
  stageId: string,
): string {
  if (!stageId) return '';
  const hit = workflow?.stages.find((st) => st.id === stageId);
  if (hit) return hit.name;
  return task?.currentStage?.id === stageId ? task.currentStage.name : stageId;
}

export function sessionView(s: Session, look: SessionLookup): SessionView {
  const task = look.task(s.taskId);
  const branch = s.branchId ? look.branch(s.branchId) : undefined;
  const headless = s.mode === 'headless';
  const repo = branch ? look.repoLabel(branch.codeRepoId) : '';
  const branchName = branch?.name ?? '';
  const step = headless ? stepNameOf(look.workflow(task?.workflowId ?? ''), s.stepId) : '';
  const run = task?.runs.find((r) => r.id === s.runId) ?? null;
  const scope = branch ? `${repo} · ${branchName}` : s.branchId ? basename(s.cwd) : 'spec';
  const id = shortId(s.id);
  const review = s.purpose === 'review';
  const stage = stageNameOf(look.workflow(task?.workflowId ?? ''), task, s.stageId);
  const named = (...parts: string[]): string => parts.filter(Boolean).join(' · ');
  const tabName = review
    ? 'Review agent'
    : headless
      ? named(stage, step, repo)
      : named(stage || `claude ${id}`, repo || 'spec') + (s.resumes ? ' (resumed)' : '');
  return {
    session: s,
    kind: activityKind(s),
    headless,
    repo,
    branch: branchName,
    worktree: branch?.worktree || s.cwd,
    step,
    run,
    tabName,
    badge: headless ? 'claude -p' : 'TUI',
    stoppedLabel: review
      ? `TUI · review agent · ${id}`
      : `${headless ? named(stage, step) : named('TUI', stage)} · ${scope} · ${id}`,
    allLabel: review
      ? 'TUI · review agent'
      : headless
        ? named('claude -p', stage, step)
        : s.branchId
          ? named('TUI', stage, 'interactive')
          : named('TUI', stage, 'spec session'),
  };
}

/** Running sessions: interactive first, then the most recently active. */
export function byRunningOrder(a: Session, b: Session): number {
  const mode = Number(a.mode === 'headless') - Number(b.mode === 'headless');
  return mode || b.lastActiveAt - a.lastActiveAt;
}

export function byRecent(a: Session, b: Session): number {
  return b.lastActiveAt - a.lastActiveAt;
}
