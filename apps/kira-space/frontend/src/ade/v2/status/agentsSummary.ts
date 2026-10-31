import { ACTIVITY_RANK, type ActivityKind, activityKind } from '../activity';
import type { Session } from '../wire';

export interface AgentsSummary {
  total: number;
  byKind: Record<ActivityKind, number>;
  /** The most urgent kind present; `idle` when none run. */
  top: ActivityKind;
}

/** Counts the running sessions by activity. Sessions already carry their TUI activity. */
export function agentsSummary(sessions: readonly Session[]): AgentsSummary {
  const byKind: Record<ActivityKind, number> = {
    input: 0,
    working: 0,
    waiting: 0,
    idle: 0,
    stopped: 0,
  };
  for (const s of sessions) if (s.state === 'running') byKind[activityKind(s)]++;
  const kinds = (Object.keys(byKind) as ActivityKind[])
    .filter((k) => byKind[k] > 0)
    .sort((a, b) => ACTIVITY_RANK[a] - ACTIVITY_RANK[b]);
  return {
    total: kinds.reduce((n, k) => n + byKind[k], 0),
    byKind,
    top: kinds[0] ?? 'idle',
  };
}
