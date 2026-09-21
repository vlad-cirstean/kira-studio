import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { settingsState } from './settings';

// P86 §9.3: the Claude Code settings section's own status store — state/dbmcp.ts's shape, minus
// the approval half (no approval queue here, just running/settingsPath/error).
type AgentHooksStatus = Awaited<ReturnType<typeof control.agentHooksStatus>>;

const DEFAULT_STATUS: AgentHooksStatus = {
  running: false,
  settingsPath: '',
  error: '',
};

export const useAgentHooksStore = defineStore('agentHooks', () => {
  const state = reactive({
    status: DEFAULT_STATUS as AgentHooksStatus,
  });

  async function hydrateAgentHooks(): Promise<void> {
    state.status = await control.agentHooksStatus();
  }

  // dbmcp.ts's own D7/§7.1 rationale applies verbatim: the toggle applies immediately, bypassing
  // the dialog's draft/Save flow entirely, since SetEnabled both persists the leaf and starts/stops
  // the embedded listener in one call. settingsState.claudeCode.hooksEnabled is set directly from
  // the confirmed `enabled` argument rather than waited-for through the separate
  // kira:settings:changed broadcast SetEnabled also emits server-side — this window's own toggle
  // must never lag its own click, and a later broadcast arrival (this window's own echo, or another
  // window's) reapplies the identical value, a harmless no-op.
  async function setAgentHooksEnabled(enabled: boolean): Promise<void> {
    state.status = await control.agentHooksSetEnabled(enabled);
    settingsState.claudeCode.hooksEnabled = enabled;
  }

  return { ...toRefs(state), hydrateAgentHooks, setAgentHooksEnabled };
});
