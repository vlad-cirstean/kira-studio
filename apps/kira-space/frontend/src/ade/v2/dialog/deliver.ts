import type { TerminalLaunchKind } from '@shared/domain/tabs';
import type { Launch, LaunchStageArgs, SendArgs, StartBranchArgs } from '../wire';

// One target's delivery: a running TUI session (`Send`) or a fresh launch whose terminal this window
// then opens. Turn watching is the flow's concern; `onArmed` fires at the exact moment it must arm
// `adeTurns.watch`: before `Send` for a running session (terminal id known), after the launch call
// for a new one (the terminal id only exists once the server returns it).

export type DeliverTarget =
  | { kind: 'send'; sessionId: string; terminalId: string; message: string }
  | { kind: 'start'; branchId: string; message: string }
  | { kind: 'stage'; taskId: string; message: string };

export interface LaunchDeps {
  send: (args: SendArgs) => Promise<void>;
  startBranch: (args: StartBranchArgs) => Promise<Launch>;
  launchStage: (args: LaunchStageArgs) => Promise<Launch>;
  openTerminalSession: (
    tabId: string,
    codeRepoId: string,
    cwd: string,
    cols: number,
    rows: number,
    command: string,
    launchKind: TerminalLaunchKind,
  ) => Promise<void>;
  /** Read after `openTerminalSession` settles: that call never throws, a failure lands in the entry. */
  terminalSession: (tabId: string) => { status: string; error: string | null } | undefined;
}

/** Opens a launched session's terminal in this window; throws when the terminal fails to start. */
export async function openLaunch(
  deps: Pick<LaunchDeps, 'openTerminalSession' | 'terminalSession'>,
  launch: Launch,
): Promise<void> {
  await deps.openTerminalSession(
    launch.terminalId,
    '',
    launch.cwd,
    80,
    24,
    launch.command,
    'claude-code',
  );
  const entry = deps.terminalSession(launch.terminalId);
  if (entry?.status === 'failed') throw new Error(entry.error || 'Launch failed');
}

/** Delivers one message; returns the launch for a new session, `null` for a `Send`. */
export async function deliver(
  deps: Pick<LaunchDeps, 'send'>,
  target: Extract<DeliverTarget, { kind: 'send' }>,
  onArmed: (terminalId: string, requireSubmit: boolean) => void,
): Promise<null>;
export async function deliver(
  deps: LaunchDeps,
  target: DeliverTarget,
  onArmed: (terminalId: string, requireSubmit: boolean) => void,
): Promise<Launch | null>;
export async function deliver(
  deps: Pick<LaunchDeps, 'send'> | LaunchDeps,
  target: DeliverTarget,
  onArmed: (terminalId: string, requireSubmit: boolean) => void,
): Promise<Launch | null> {
  if (target.kind === 'send') {
    onArmed(target.terminalId, true);
    await deps.send({ sessionId: target.sessionId, message: target.message });
    return null;
  }
  const full = deps as LaunchDeps;
  const launch =
    target.kind === 'start'
      ? await full.startBranch({ branchId: target.branchId, message: target.message })
      : await full.launchStage({ taskId: target.taskId, message: target.message });
  onArmed(launch.terminalId, false);
  await openLaunch(full, launch);
  return launch;
}
