import type {
  AgentActivity,
  AgentEvent,
  AgentSession,
  AgentSessionsEvent,
} from '@shared/domain/agent';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { reduceAgentActivity } from './agentActivity';
import { hydrateThenSubscribe } from './hydrateThenSubscribe';

// P127 §2.2: the control seam a host implements over its own bound terminal/agent-hooks surface —
// method names match Kira Studio's existing bridge/control.ts members, so a host's control object
// typechecks structurally with no adapter layer.
export interface AgentSessionsControl {
  terminalAgentSessions(): Promise<AgentSessionsEvent>;
  onAgentSessions(cb: (event: AgentSessionsEvent) => void): () => void;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
}

// P86 §12: the running-agent-sessions widget's own store — state/cacheStats.ts's pushed-from-Go
// shape (a reactive store, one subscription, nothing else): the only writer here is Go, pushing
// over the host's own agent-sessions/agent-event channels, so nothing needs arbitrating between two
// same-window writers. createAppMetricsStore's own shape: no `extend` seam — nothing app-specific
// to add.
export function createAgentSessionsStore(control: AgentSessionsControl) {
  return defineStore('agentSessions', () => {
    const state = reactive({
      sessions: [] as AgentSession[],
      // Keyed by terminalId. §13's reducer above is the only writer that ever adds an entry;
      // applySessions only prunes it, so a killed tab's activity disappears even when SessionEnd
      // never arrived (rule 5).
      activity: new Map<string, AgentActivity>(),
    });

    // Replaces the session list wholesale and prunes activity of every terminal id no longer
    // listed — what makes a killed tab's activity disappear even when SessionEnd never arrived
    // (§13 rule 5).
    function applySessions(event: AgentSessionsEvent): void {
      state.sessions = event.sessions;
      const live = new Set(event.sessions.map((s) => s.terminalId));
      for (const terminalId of state.activity.keys()) {
        if (!live.has(terminalId)) state.activity.delete(terminalId);
      }
    }

    function agentActivityFor(terminalId: string): AgentActivity | undefined {
      return state.activity.get(terminalId);
    }

    // SessionEnd drops the entry outright rather than going through reduceAgentActivity — nothing
    // in AgentActivity's own shape can express "no entry", so the map write happens here.
    function applyEvent(event: AgentEvent): void {
      if (event.event === 'SessionEnd') {
        state.activity.delete(event.terminalId);
        return;
      }
      state.activity.set(
        event.terminalId,
        reduceAgentActivity(state.activity.get(event.terminalId), event, Date.now()),
      );
    }

    let unsubscribeSessions: (() => void) | null = null;
    let unsubscribeEvent: (() => void) | null = null;

    // A host's own boot Promise.all: a window opened after every currently-live session already
    // started needs a snapshot, since the sessions channel only fires on change — dbmcp.ts's
    // hydrateDbMcp precedent. onAgentEvent has no boot-time hydrate of its own: activity is
    // runtime-only, and a session already in progress simply renders with no activity until its
    // next hook fires.
    async function initAgentSessions(): Promise<void> {
      unsubscribeSessions?.();
      unsubscribeEvent?.();
      unsubscribeSessions = null;
      unsubscribeEvent = null;
      unsubscribeSessions = await hydrateThenSubscribe({
        snapshot: () => control.terminalAgentSessions(),
        subscribe: (cb) => control.onAgentSessions(cb),
        apply: applySessions,
      });
      unsubscribeEvent = control.onAgentEvent(applyEvent);
    }

    return { ...toRefs(state), agentActivityFor, initAgentSessions };
  });
}
