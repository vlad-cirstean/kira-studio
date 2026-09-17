import type { AgentActivity, AgentSession, AgentSessionsEvent } from '@shared/domain/agent';
import { reactive } from 'vue';
import { control } from '../bridge/control';

// P86 §12: the running-agent-sessions widget's own store — state/cacheStats.ts's pushed-from-Go
// shape (a reactive store, one subscription, nothing else), not state/blameStatus.ts's owner
// token: the only writer here is Go, pushing over ChannelAgentSessions, so nothing needs
// arbitrating between two same-window writers.
export const agentSessionsState = reactive({
  sessions: [] as AgentSession[],
  // Keyed by terminalId. §13's reducer (a later phase commit) is the only writer that ever adds
  // an entry; this commit only prunes it, so the map stays empty until hooks are enabled and a
  // session fires its first event.
  activity: new Map<string, AgentActivity>(),
});

// Replaces the session list wholesale and prunes activity of every terminal id no longer listed —
// what makes a killed tab's activity disappear even when SessionEnd never arrived (§13 rule 5).
function applySessions(event: AgentSessionsEvent): void {
  agentSessionsState.sessions = event.sessions;
  const live = new Set(event.sessions.map((s) => s.terminalId));
  for (const terminalId of agentSessionsState.activity.keys()) {
    if (!live.has(terminalId)) agentSessionsState.activity.delete(terminalId);
  }
}

let unsubscribe: (() => void) | null = null;

// main.ts's boot Promise.all: a window opened after every currently-live session already started
// needs a snapshot, since ChannelAgentSessions only fires on change — dbmcp.ts's hydrateDbMcp
// precedent.
export async function initAgentSessions(): Promise<void> {
  applySessions(await control.terminalAgentSessions());
  unsubscribe?.();
  unsubscribe = control.onAgentSessions(applySessions);
}
