import type { OpLogRecord, OpStatus } from '@shared/domain/ops';
import type { ScriptRun, ScriptRunState } from '@shared/domain/scriptRuns';
import { runElapsedMs } from './runText';

// A finished or live Automations run as an Operations panel row. A projection of `script_runs`,
// never a row in `op_log`.
export interface AutomationOp extends OpLogRecord {
  kind: 'automation';
  run: ScriptRun;
}

export const AUTOMATION_KIND = 'automation';
const ID_PREFIX = 'run:';

const STATUS: Record<ScriptRunState, OpStatus> = {
  running: 'running',
  waiting: 'running',
  done: 'ok',
  failed: 'error',
  blocked: 'error',
  cancelled: 'cancelled',
  skipped: 'cancelled',
};

export function isAutomationOp(r: OpLogRecord): r is AutomationOp {
  return r.kind === AUTOMATION_KIND && r.id.startsWith(ID_PREFIX) && 'run' in r;
}

export function isLiveRun(run: ScriptRun): boolean {
  return run.state === 'running' || run.state === 'waiting';
}

export function runStartedAt(run: ScriptRun): number {
  return run.startedAt ?? run.createdAt;
}

export function automationOp(run: ScriptRun): AutomationOp {
  const status = STATUS[run.state];
  const reason = run.outcome?.reason ?? '';
  const error =
    status === 'error' ? [reason, run.outcome?.lastError ?? ''].filter(Boolean).join(' · ') : '';
  return {
    id: `${ID_PREFIX}${run.id}`,
    startedAt: new Date(runStartedAt(run)).toISOString(),
    durationMs: isLiveRun(run) ? null : runElapsedMs(run, 0),
    kind: AUTOMATION_KIND,
    status,
    command: (run.kind === 'smart' ? run.prompt : run.command) || null,
    error: error || null,
    run,
  };
}
