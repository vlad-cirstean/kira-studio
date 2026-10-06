import type { AgentActivity } from '@shared/domain/agent';
import type { Session } from './wire';

export type ActivityKind = 'input' | 'working' | 'waiting' | 'idle' | 'stopped';

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  input: 'needs input',
  working: 'working',
  waiting: 'waiting on monitor',
  idle: 'idle',
  stopped: 'stopped',
};

/** Urgency order of the All sessions list: input first. */
export const ACTIVITY_RANK: Record<ActivityKind, number> = {
  input: 0,
  working: 1,
  waiting: 2,
  idle: 3,
  stopped: 4,
};

/** First four characters of the record id: the `claude 9ab0` / `TUI · 9ab0` label. */
export function shortId(id: string): string {
  return id.slice(0, 4);
}

const PHASE: Record<AgentActivity['phase'], Session['activity']> = {
  attention: 'input',
  working: 'working',
  waiting: 'waiting',
  idle: 'idle',
};

/** The server reports no activity for a TUI session: it comes from the agent-hook store, keyed by
 *  terminal id. A running TUI session with no hook seen yet reads `idle`. */
export function withTuiActivity(
  sessions: readonly Session[],
  activity: ReadonlyMap<string, Pick<AgentActivity, 'phase'>>,
): Session[] {
  return sessions.map((s) => {
    if (s.mode !== 'tui' || s.state !== 'running') return s;
    const phase = activity.get(s.terminalId)?.phase;
    return { ...s, activity: phase ? PHASE[phase] : 'idle' };
  });
}

export function activityKind(s: Session): ActivityKind {
  if (s.state !== 'running') return 'stopped';
  return s.activity === '' ? 'idle' : s.activity;
}
