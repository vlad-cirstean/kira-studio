import type { ScriptRun } from '@shared/domain/scriptRuns';

const STATE_LABEL: Record<ScriptRun['state'], string> = {
  running: 'Running',
  done: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  blocked: 'Needs you',
  waiting: 'Waiting for you',
  skipped: 'Skipped',
};

export function stateLabel(state: ScriptRun['state']): string {
  return STATE_LABEL[state];
}

/** "0.12 USD". */
export function costText(usd: number): string {
  return `${usd.toFixed(2)} USD`;
}

/** "12s", "2m 03s", "1h 02m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Elapsed for a run at `now`: live while running, fixed once finished. */
export function runElapsedMs(run: ScriptRun, now: number): number | null {
  const start = run.startedAt ?? run.createdAt;
  const end = run.finishedAt ?? (run.state === 'running' ? now : null);
  return end === null ? null : end - start;
}

/** Plain-text report a person pastes to an agent. `tail` is the last terminal lines, if any. */
export function runReportText(run: ScriptRun, tail: string): string {
  const out = run.outcome;
  const smart = run.kind === 'smart';
  const lines = [
    `Script: ${run.scriptName}`,
    smart ? `Model: ${run.model}` : `Command: ${run.command}`,
    `Folder: ${run.cwd}`,
    `Result: ${stateLabel(run.state)}${out?.reason ? ` - ${out.reason}` : ''}`,
  ];
  if (out?.summary) lines.push(`Summary: ${out.summary}`);
  if (out?.costUsd !== undefined) lines.push(`Cost: ${costText(out.costUsd)}`);
  if (out?.permissionDenials?.length)
    lines.push(`Denied tools: ${out.permissionDenials.join(', ')}`);
  if (out?.exitCode !== undefined) lines.push(`Exit code: ${out.exitCode}`);
  if (out?.lastError) lines.push(`Last error: ${out.lastError}`);
  if (tail !== '') lines.push('', 'Last output:', tail);
  return lines.join('\n');
}
