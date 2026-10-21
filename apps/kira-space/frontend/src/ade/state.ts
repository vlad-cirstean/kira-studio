import { createAgentSessionsStore } from '@workbench/state/createAgentSessionsStore';
import { control } from '../bridge/control';

// This app's own instance of the shared agent-activity store factory — a
// separate store from `adeUi` (one concern each, per the working agreement's own Pinia rule).
// `control` already satisfies `AgentSessionsControl` structurally (bridge/index.ts's own
// `terminalAgentSessions`/`onAgentSessions`/`onAgentEvent`).
export const useAgentSessionsStore = createAgentSessionsStore(control);
