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

/** Mockup line 663-670's own label set — `AdeActivityIcon.vue`'s tooltip and, per P129 Part 4
 *  §0.10, the dialog's busy-row text (`<branch> · claude <sid> · <label>`). */
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  input: 'needs input',
  working: 'working',
  waiting: 'waiting on monitor',
  idle: 'idle',
  stopped: 'stopped',
};

/** `claude <id>` template rung (§0.3): the Claude session id's first UUID group, unchanged for the
 *  mockup's own 4-hex ids. */
export function sessionLabel(session: AdeSession): string {
  return `claude ${session.claudeSessionId.slice(0, 8)}`;
}

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

/** P129 Part 7 §0.4: mockup `actSummary` (lines 674-678) — running sessions only, the three
 *  "agent needs you" kinds; `idle` and `stopped` never show up in the aggregated line. */
export function activitySummary(
  sessions: readonly AdeSession[],
  activity: ReadonlyMap<string, AgentActivity>,
): { input: number; working: number; waiting: number } {
  const out = { input: 0, working: 0, waiting: 0 };
  for (const session of sessions) {
    const kind = activityKind(session, activity);
    if (kind === 'input') out.input += 1;
    else if (kind === 'working') out.working += 1;
    else if (kind === 'waiting') out.waiting += 1;
  }
  return out;
}

/** §0.6: `useQueue.ts`'s own sort order for an item's `acts`/`agents` — moved here so
 *  `allAgents.ts`'s row sort (urgency) and `useQueue.ts` share one ranking, never two. */
export function actRank(a: ActivityKind): number {
  switch (a) {
    case 'input':
      return 0;
    case 'working':
      return 1;
    case 'waiting':
      return 2;
    case 'idle':
      return 3;
    default:
      return 4;
  }
}

/** Shared empty activity map: `useQueue` runs without activity (see `queueActivity.ts`). */
export const NO_ACTIVITY: ReadonlyMap<string, AgentActivity> = new Map();

/** terminalId -> kind for the running sessions given. Pass the previous result as `prev` to get it
 *  back unchanged when no kind moved, so a computed keyed on it only fires on a real phase change. */
export function activityKindsByTerminal(
  sessions: readonly AdeSession[],
  activity: ReadonlyMap<string, AgentActivity>,
  prev?: ReadonlyMap<string, ActivityKind>,
): ReadonlyMap<string, ActivityKind> {
  const next = new Map<string, ActivityKind>();
  for (const s of sessions) {
    if (s.state === 'running') next.set(s.terminalId, activityKind(s, activity));
  }
  if (prev && prev.size === next.size) {
    let same = true;
    for (const [k, v] of next) {
      if (prev.get(k) !== v) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }
  return next;
}
