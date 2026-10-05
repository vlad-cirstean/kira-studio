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
  /** Strip tab: `repo · claude 9ab0` / `run · Implement · repo`. */
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
  const tabName = review
    ? 'Review agent'
    : headless
      ? `run · ${step}${repo ? ` · ${repo}` : ''}`
      : `${repo || 'spec'} · claude ${id}${s.resumes ? ' (resumed)' : ''}`;
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
      : `${headless ? `run · ${step}` : 'TUI'} · ${scope} · ${id}`,
    allLabel: review
      ? 'TUI · review agent'
      : headless
        ? `claude -p · ${step}`
        : s.branchId
          ? 'TUI · interactive'
          : 'TUI · spec session',
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
