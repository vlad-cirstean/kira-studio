import { createAgentSessionsStore } from '@workbench/state/createAgentSessionsStore';
import { httpAgentControl } from '../api/agentControl';

export const useAgentSessionsStore = createAgentSessionsStore(httpAgentControl);
