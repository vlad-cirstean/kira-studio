import type { MessageKey } from '@theme/i18n';
import type { Branch, Session } from '../wire';

export interface Gate {
  disabled: boolean;
  reason: MessageKey | null;
}

/** One named branch of a task: where a terminal or an ad hoc agent session can open. */
export interface LaunchTarget {
  branchId: string;
  codeRepoId: string;
  repo: string;
  branch: string;
  worktree: string;
  terminal: Gate;
  agent: Gate;
}

const OPEN: Gate = { disabled: false, reason: null };
const off = (reason: MessageKey): Gate => ({ disabled: true, reason });

/** A target per named branch. Both kinds need a worktree; the agent also needs setup done and no
 *  running TUI on the branch. The terminal stays on while setup runs, to watch it. */
export function launchTargets(
  rows: readonly { branch: Branch; repo: string }[],
  sessions: readonly Session[],
): LaunchTarget[] {
  return rows
    .filter((r) => r.branch.name !== '')
    .map(({ branch: b, repo }) => {
      let terminal = OPEN;
      let agent = OPEN;
      if (b.worktree === '') {
        terminal = off('space.ade.taskLaunch.reason.noWorktree.label');
        agent = terminal;
      } else if (b.setup?.state === 'running') {
        agent = off('space.ade.board.setup.running.title');
      } else if (b.setup?.state === 'failed') {
        agent = off('space.ade.needs.kind.setupFailed.label');
      } else if (
        sessions.some((s) => s.mode === 'tui' && s.state === 'running' && s.branchId === b.id)
      ) {
        agent = off('space.ade.taskLaunch.reason.sessionOpen.label');
      }
      return {
        branchId: b.id,
        codeRepoId: b.codeRepoId,
        repo,
        branch: b.name,
        worktree: b.worktree,
        terminal,
        agent,
      };
    });
}
