import type { AgentEvent, AgentSessionsEvent } from '@shared/domain/agent';
import { CHANNEL } from '@shared/protocol/events';
import type { AgentSessionsControl } from '@workbench/state/createAgentSessionsStore';
import { onChannel } from './events';
import { getJson } from './http';

export const httpAgentControl: AgentSessionsControl = {
  terminalAgentSessions: () => getJson<AgentSessionsEvent>('/api/agent/sessions'),
  onAgentSessions: (cb) => onChannel(CHANNEL.agentSessions, (d) => cb(d as AgentSessionsEvent)),
  onAgentEvent: (cb) => onChannel(CHANNEL.agentEvent, (d) => cb(d as AgentEvent)),
};
