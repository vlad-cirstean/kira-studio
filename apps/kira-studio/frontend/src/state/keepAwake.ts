import { createKeepAwakeStore } from '@workbench/state/createKeepAwakeStore';
import { control } from '../bridge/control';
import { useSettingsStore } from './settings';

// P116 H6: the shared half (hydrate, subscribe, the manual toggle) moved to
// createKeepAwakeStore.ts; the agent-aware Settings leaf stays here via `extend` — Kira Space has
// no agent-aware reason to set.
export const useKeepAwakeStore = createKeepAwakeStore(control, ({ state }) => ({
  // setKeepAwakeAgentAware also writes settingsStore.claudeCode.keepAwakeWithAgents directly,
  // mirroring setAgentHooksEnabled's own reasoning — this leaf both persists and recomputes the
  // live assertion in one call, bypassing the Settings dialog's draft/Save flow entirely.
  async setKeepAwakeAgentAware(on: boolean): Promise<void> {
    state.status = await control.keepAwakeSetAgentAware(on);
    useSettingsStore().claudeCode.keepAwakeWithAgents = on;
  },
}));
