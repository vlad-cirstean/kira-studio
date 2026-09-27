import type { AgentActivity } from '@shared/domain/agent';
import type { AdeSession } from './wire';

/** The five activity kinds design §2.0/mockup line 663 name — `useQueue`'s own item `acts` and
 *  `AdeRepoTabs`' needs-input badge both derive from this. A stopped session (`state !== 'running'`)
 *  is always `stopped`, regardless of what the activity map still remembers for its terminal id
 *  (`createAgentSessionsStore`'s own `applySessions` only prunes dead terminal ids on the *next*
 *  sessions push, so a session that just stopped can still have a stale entry for a moment). A
 *  running session with no activity entry yet (no hook has fired since launch) reads `idle`, same
 *  as an explicit `idle` phase. */
export type ActivityKind = 'input' | 'working' | 'waiting' | 'idle' | 'stopped';

export function activityKind(
  session: AdeSession,
  activity: ReadonlyMap<string, AgentActivity>,
): ActivityKind {
  if (session.state !== 'running') return 'stopped';
  const phase = activity.get(session.terminalId)?.phase;
  if (phase === 'attention') return 'input';
  if (phase === 'working') return 'working';
  if (phase === 'waiting') return 'waiting';
  return 'idle';
}

/** §0.15: every running session's own repo counts toward its needs-input badge, not only a queued
 *  item's sessions — real sessions outlive archive, unlike the mockup's own queued-only count. */
export function needsInputByRepo(
  sessions: readonly AdeSession[],
  activity: ReadonlyMap<string, AgentActivity>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const session of sessions) {
    if (activityKind(session, activity) !== 'input') continue;
    out.set(session.codeRepoId, (out.get(session.codeRepoId) ?? 0) + 1);
  }
  return out;
}
