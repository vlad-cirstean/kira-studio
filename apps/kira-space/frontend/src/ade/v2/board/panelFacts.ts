import type { BacklogPatch, RepoRefresh, Task, TaskPatch } from '../wire';
import type { TaskProgress } from './progress';
import type { DerivedStatus } from './status';

export interface GithubLink {
  /** `PR` or `issue`. */
  kind: 'PR' | 'issue';
  /** `repo#<n>`. */
  ref: string;
}

const GITHUB_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/;

/** `null` when the text is not a GitHub issue or PR link. */
export function parseGithub(url: string): GithubLink | null {
  const m = url.trim().match(GITHUB_RE);
  if (!m) return null;
  return { kind: m[3] === 'pull' ? 'PR' : 'issue', ref: `${m[2]}#${m[4]}` };
}

/** Why the status chip reads as it does (D10: status follows the workflow). */
export function statusWhy(task: Task, status: DerivedStatus, progress: TaskProgress): string {
  if (task.kind === 'review') return 'someone else’s branch';
  if (task.kind === 'parked') return 'not merging';
  if (progress.finished) return 'workflow finished';
  if (status === 'Blocked') return 'a step is stuck or failed';
  if (status === 'To do') return 'not started';
  return progress.stage ? `${progress.stage.name} stage` : '';
}

/** `Today–Wed 23 · 3 branches in api, web-app · 1/5 steps`. */
export function taskFacts(i: {
  span: string;
  branches: number;
  repos: string[];
  doneSteps: number;
  steps: number;
}): string {
  const parts = [
    i.span,
    `${i.branches} ${i.branches === 1 ? 'branch' : 'branches'}${i.repos.length ? ` in ${i.repos.join(', ')}` : ''}`,
  ];
  if (i.steps > 0) parts.push(`${i.doneSteps}/${i.steps} steps`);
  return parts.join(' · ');
}

/** `3 refs changed · 1 merged into develop`; `no changes` when the fetch moved nothing. */
export function refreshNote(r: RepoRefresh): string {
  const byTarget = new Map<string, number>();
  for (const m of r.mergedInto) byTarget.set(m.target, (byTarget.get(m.target) ?? 0) + 1);
  if (r.refsChanged === 0 && byTarget.size === 0) return 'no changes';
  const parts = [`${r.refsChanged} ${r.refsChanged === 1 ? 'ref' : 'refs'} changed`];
  for (const [target, n] of byTarget) parts.push(`${n} merged into ${target}`);
  return parts.join(' · ');
}

/** A patch that changes nothing; spread the fields to write over it (null = unchanged). */
export function taskPatch(over: Partial<TaskPatch>): TaskPatch {
  return {
    title: null,
    jira: null,
    clearJira: false,
    githubUrl: null,
    est: null,
    notes: null,
    color: null,
    kind: null,
    ...over,
  };
}

export function backlogPatch(over: Partial<BacklogPatch>): BacklogPatch {
  return { text: null, jira: null, clearJira: false, githubUrl: null, notes: null, ...over };
}
