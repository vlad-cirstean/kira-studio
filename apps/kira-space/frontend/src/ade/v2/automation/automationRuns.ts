import type { ScriptRun } from '@shared/domain/scriptRuns';

/** The run a task card's chip shows: the newest running one, else the newest failed or blocked one
 *  the person has not opened yet. */
export function chipRun(
  runs: readonly ScriptRun[],
  taskId: string,
  seen: readonly string[],
): ScriptRun | null {
  const mine = runs.filter((r) => r.taskId === taskId);
  const running = mine.find((r) => r.state === 'running');
  if (running) return running;
  return (
    mine.find((r) => (r.state === 'failed' || r.state === 'blocked') && !seen.includes(r.id)) ??
    null
  );
}

export function runReason(run: ScriptRun): string {
  return run.outcome?.reason || run.outcome?.summary || '';
}
