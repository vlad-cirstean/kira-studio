// P127: the reducer and the store factory moved to packages/workbench (shared home, used by no app
// after this phase — Kira Space becomes the app that spawns Claude Code agents, P129). This file is
// now only the wiring: Studio's own control object plugged into the shared factory.
import { createAgentSessionsStore } from '@workbench/state/createAgentSessionsStore';
import { control } from '../bridge/control';

export const useAgentSessionsStore = createAgentSessionsStore(control);
