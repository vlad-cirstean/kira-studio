import type { AgentActivity, AgentEvent } from '@shared/domain/agent';

export const MAX_RUNNING_TOOLS = 64;

function emptyActivity(sessionId: string | null): AgentActivity {
  return { phase: 'idle', runningTools: [], toolName: null, message: null, sessionId };
}

// P86 §13: the one piece here with real interacting rules, fed by an out-of-order external
// producer — each hook is its own `curl` process, so a PostToolUse can legitimately arrive before
// its own PreToolUse. Pure: (prev, event) => next. createAgentSessionsStore applies it below; the
// unit test (agent-activity-reducer.spec.ts, colocated) calls it directly.
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
