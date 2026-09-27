import { createAgentSessionsStore } from '@workbench/state/createAgentSessionsStore';
import { control } from '../../bridge/control';

// P129 Part 3 §0.20: this app's own instance of P127's shared agent-activity store factory — a
// separate store from `adeUi` (one concern each, per the working agreement's own Pinia rule).
// `control` already satisfies `AgentSessionsControl` structurally (bridge/index.ts's own
// `terminalAgentSessions`/`onAgentSessions`/`onAgentEvent`).
export const useAgentSessionsStore = createAgentSessionsStore(control);
