import type {
  AgentActivity,
  AgentEvent,
  AgentSession,
  AgentSessionsEvent,
} from '@shared/domain/agent';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

export const MAX_RUNNING_TOOLS = 64;

function emptyActivity(sessionId: string | null): AgentActivity {
  return { phase: 'idle', runningTools: [], toolName: null, message: null, sessionId };
}

// P86 §13: the one piece here with real interacting rules, fed by an out-of-order external
// producer — each hook is its own `curl` process, so a PostToolUse can legitimately arrive before
// its own PreToolUse. Pure: (prev, event) => next. The store applies it below; the unit test
// (tests/unit/agent-activity-reducer.spec.ts) calls it directly.
export function reduceAgentActivity(
  prev: AgentActivity | undefined,
  event: AgentEvent,
): AgentActivity {
  const base = prev ?? emptyActivity(event.sessionId || null);
  switch (event.event) {
    case 'SessionStart':
      // Resets rather than merges — a user who exits `claude` and reruns it in the same tab
      // starts clean.
      return emptyActivity(event.sessionId || null);
    case 'PreToolUse': {
      const runningTools = base.runningTools.includes(event.toolUseId)
        ? base.runningTools
        : [...base.runningTools, event.toolUseId].slice(-MAX_RUNNING_TOOLS);
      return { ...base, phase: 'working', runningTools, toolName: event.toolName };
    }
    case 'PostToolUse':
      // Pairing is by tool_use_id, never a depth counter — a set is order-insensitive; a counter
      // would go negative and strand the phase. An unmatched id is a no-op, not an error.
      return { ...base, runningTools: base.runningTools.filter((id) => id !== event.toolUseId) };
    case 'Notification':
      // Does not clear runningTools — a permission prompt arrives *during* a tool call; losing
      // the set here would leave the following PostToolUse unmatched too.
      return { ...base, phase: 'attention', message: event.message || null };
    case 'Stop':
      // Clears everything, which is what heals a session that lost a PostToolUse to the
      // listener's own bounds (internal/agenthooks/http.go §6.1).
      return { ...base, phase: 'idle', runningTools: [], message: null };
    default:
      return base;
  }
}

// P86 §12: the running-agent-sessions widget's own store — state/cacheStats.ts's pushed-from-Go
// shape (a reactive store, one subscription, nothing else): the only writer here is Go, pushing
// over ChannelAgentSessions, so nothing needs arbitrating between two same-window writers.
export const useAgentSessionsStore = defineStore('agentSessions', () => {
  const state = reactive({
    sessions: [] as AgentSession[],
    // Keyed by terminalId. §13's reducer above is the only writer that ever adds an entry;
    // applySessions only prunes it, so a killed tab's activity disappears even when SessionEnd
    // never arrived (rule 5).
    activity: new Map<string, AgentActivity>(),
  });

  // Replaces the session list wholesale and prunes activity of every terminal id no longer listed —
  // what makes a killed tab's activity disappear even when SessionEnd never arrived (§13 rule 5).
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

  // SessionEnd drops the entry outright rather than going through reduceAgentActivity — nothing in
  // AgentActivity's own shape can express "no entry", so the map write happens here.
  function applyEvent(event: AgentEvent): void {
    if (event.event === 'SessionEnd') {
      state.activity.delete(event.terminalId);
      return;
    }
    state.activity.set(
      event.terminalId,
      reduceAgentActivity(state.activity.get(event.terminalId), event),
    );
  }

  let unsubscribeSessions: (() => void) | null = null;
  let unsubscribeEvent: (() => void) | null = null;

  // main.ts's boot Promise.all: a window opened after every currently-live session already started
  // needs a snapshot, since ChannelAgentSessions only fires on change — dbmcp.ts's hydrateDbMcp
  // precedent. onAgentEvent has no boot-time hydrate of its own: activity is runtime-only, and a
  // session already in progress simply renders with no activity until its next hook fires.
  async function initAgentSessions(): Promise<void> {
    applySessions(await control.terminalAgentSessions());
    unsubscribeSessions?.();
    unsubscribeEvent?.();
    unsubscribeSessions = control.onAgentSessions(applySessions);
    unsubscribeEvent = control.onAgentEvent(applyEvent);
  }

  return { ...toRefs(state), agentActivityFor, initAgentSessions };
});
