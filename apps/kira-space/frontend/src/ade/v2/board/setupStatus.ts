import type { WorktreeSetup } from '../wire';

const TITLE: Record<WorktreeSetup['state'], string> = {
  running: 'Preparing worktree',
  ready: 'Worktree ready',
  failed: 'Worktree setup failed',
};

/** The `ScriptProgress` props of one branch's setup. */
export function setupStatus(setup: WorktreeSetup, repo: string, branch: string, timeout: string) {
  return {
    state: setup.state,
    title: `${TITLE[setup.state]} · ${repo} ${branch}`,
    startedAt: setup.startedAt,
    finishedAt: setup.finishedAt,
    timeout: timeout || undefined,
    note: setup.note || undefined,
  };
}
