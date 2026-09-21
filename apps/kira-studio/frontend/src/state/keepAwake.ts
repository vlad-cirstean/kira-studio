import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { useSettingsStore } from './settings';

// P87 §7.1: state/agentHooks.ts's own shape — a reactive status, a hydrate, two setters that write
// the confirmed value straight back rather than waiting for the broadcast echo (agentHooks.ts's own
// :23-:33 comment states the reasoning; it applies here verbatim: this window's own toggle must
// never lag its own click, and a later broadcast arrival — this window's own echo, or another
// window's — reapplies the identical value, a harmless no-op).
type KeepAwakeStatus = Awaited<ReturnType<typeof control.keepAwakeStatus>>;

const DEFAULT_STATUS: KeepAwakeStatus = {
  manual: false,
  supported: false,
  error: '',
};

export const useKeepAwakeStore = defineStore('keepAwake', () => {
  const state = reactive({
    status: DEFAULT_STATUS as KeepAwakeStatus,
  });

  let unsubscribeKeepAwake: (() => void) | null = null;

  // initKeepAwake both hydrates and subscribes — state/agentSessions.ts's own initAgentSessions
  // pattern, needed for the same reason: a window opened after another window toggled keep-awake
  // must not render stale (SetManual/SetAgentAware are process-wide, not window-scoped).
  async function initKeepAwake(): Promise<void> {
    state.status = await control.keepAwakeStatus();
    unsubscribeKeepAwake?.();
    unsubscribeKeepAwake = control.onKeepAwakeChanged((status) => {
      state.status = status;
    });
  }

  async function setKeepAwakeManual(on: boolean): Promise<void> {
    state.status = await control.keepAwakeSetManual(on);
  }

  // setKeepAwakeAgentAware also writes settingsStore.claudeCode.keepAwakeWithAgents directly,
  // mirroring setAgentHooksEnabled's own :32 — this leaf both persists and recomputes the live
  // assertion in one call, bypassing the Settings dialog's draft/Save flow entirely.
  async function setKeepAwakeAgentAware(on: boolean): Promise<void> {
    state.status = await control.keepAwakeSetAgentAware(on);
    useSettingsStore().claudeCode.keepAwakeWithAgents = on;
  }

  return { ...toRefs(state), initKeepAwake, setKeepAwakeManual, setKeepAwakeAgentAware };
});
