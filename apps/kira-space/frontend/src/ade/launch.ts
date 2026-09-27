import type { TerminalLaunchKind } from '@shared/domain/tabs';
import type { AdeLaunch } from './wire';

// P129 Part 4 §0.14/§2.1: one target's own delivery mechanics — a running session (`Send`) or a
// fresh launch (`PrepareLaunch` then `openTerminalSession`). Turn-watching policy (when to arm,
// `requireSubmit`) is `dialogFlow.ts`'s own concern (§0.15); `onArmed` is the seam that lets it arm
// at the exact right moment per target kind — before `Send` for a running session (terminal id
// already known), before `openTerminalSession` for a launch (terminal id only exists once
// `PrepareLaunch` returns).

interface DeliverRunningTarget {
  kind: 'send';
  /** The `ade_sessions` record id — `AdeSendArgs.sessionId`, never the Claude session id. */
  sessionId: string;
  /** The session's own terminal id, for turn-watching. */
  terminalId: string;
  message: string;
}

interface DeliverLaunchTarget {
  kind: 'launch';
  codeRepoId: string;
  /** Exactly one of `branch`/`newWorkId` is non-empty. */
  branch: string;
  newWorkId: string;
  cwd: string;
  /** An existing session's Claude id to resume, else `''` for a new session. */
  resume: string;
  message: string;
}

export type DeliverTarget = DeliverRunningTarget | DeliverLaunchTarget;

export interface LaunchDeps {
  adeSend: (args: { sessionId: string; message: string }) => Promise<void>;
  adePrepareLaunch: (args: {
    codeRepoId: string;
    branch: string;
    newWorkId: string;
    cwd: string;
    resume: string;
    message: string;
  }) => Promise<AdeLaunch>;
  openTerminalSession: (
    tabId: string,
    codeRepoId: string,
    cwd: string,
    cols: number,
    rows: number,
    command: string,
    launchKind: TerminalLaunchKind,
  ) => Promise<void>;
  /** `terminalsStore.terminalSession` — read after `openTerminalSession` settles, since that call
   *  never itself throws (Part 1 §0: failures land in the entry's own `status`/`error`). */
  terminalSession: (tabId: string) => { status: string; error: string | null } | undefined;
}

/** §0.14: deliver one message to one target, calling `onArmed(terminalId, requireSubmit)` at the
 *  point the caller must arm `adeTurns.watch` (§0.15) — synchronously before the RPC that could
 *  produce the turn's own `Stop`. Throws (Launch `status: 'failed'`) so the caller's own delivery
 *  loop can stop and surface the error; never partially arms without calling `onArmed`. */
export async function deliver(
  deps: LaunchDeps,
  target: DeliverTarget,
  onArmed: (terminalId: string, requireSubmit: boolean) => void,
): Promise<void> {
  if (target.kind === 'send') {
    onArmed(target.terminalId, true);
    await deps.adeSend({ sessionId: target.sessionId, message: target.message });
    return;
  }
  const launch = await deps.adePrepareLaunch({
    codeRepoId: target.codeRepoId,
    branch: target.branch,
    newWorkId: target.newWorkId,
    cwd: target.cwd,
    resume: target.resume,
    message: target.message,
  });
  onArmed(launch.terminalId, false);
  await deps.openTerminalSession(
    launch.terminalId,
    target.codeRepoId,
    target.cwd,
    80,
    24,
    launch.command,
    'claude-code',
  );
  const entry = deps.terminalSession(launch.terminalId);
  if (entry?.status === 'failed') {
    throw new Error(entry.error || 'Launch failed');
  }
}
