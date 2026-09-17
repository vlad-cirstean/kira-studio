// P86: the TypeScript mirrors of Go's terminal.AgentSession/agenthooks.Event wire shapes.
// grpc-history.ts's own precedent — types, not guards: neither crosses a storage boundary or gets
// restored, so nothing here earns a Zod-parse boundary. control.ts `trust<T>()`s them like every
// other bound result.

// terminal.AgentSession's own wire projection (bridge/terminal.go's AgentSessionWire) — one live
// Claude Code tab, across every window (§11: the count's authority is Go).
export interface AgentSession {
  terminalId: string;
  cwd: string;
}

// ChannelAgentSessions' own payload (bridge/terminal.go's AgentSessionsEvent) — a list, not a bare
// count: a bare count would leave the status-bar tooltip unable to say *which* sessions (§11).
export interface AgentSessionsEvent {
  sessions: AgentSession[];
}

// agenthooks.Event's own wire projection, ChannelAgentEvent's payload (§6) — one hook firing for
// one tab. Every field the listener kept; everything else (tool_input, tool_response,
// transcript_path, ...) was already dropped server-side and never reaches here.
export interface AgentEvent {
  terminalId: string;
  event: string; // hook_event_name: SessionStart, PreToolUse, PostToolUse, Notification, Stop, SessionEnd
  sessionId: string;
  cwd: string;
  toolName: string;
  toolUseId: string;
  notificationType: string;
  message: string; // bounded server-side (§6.1)
  source: string; // SessionStart
  reason: string; // SessionEnd
}

// §13's own reducer output — one Claude Code tab's current activity, derived from the AgentEvent
// stream by state/agentSessions.ts's reduceAgentActivity.
export type AgentPhase = 'idle' | 'working' | 'attention';

export interface AgentActivity {
  phase: AgentPhase;
  runningTools: string[]; // tool_use_id, insertion-ordered, capped at MAX_RUNNING_TOOLS
  toolName: string | null; // most recent PreToolUse's tool, for the tooltip
  message: string | null; // Notification text, when phase is 'attention'
  sessionId: string | null;
}
