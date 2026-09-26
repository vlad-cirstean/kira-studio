import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import type { KeepAwakeStatus } from '../bridge/createCoreControl';

// P116 H6: hoisted from Kira Studio's own state/keepAwake.ts — the shared half (hydrate, subscribe,
// the manual toggle). Kira Studio's own agent-aware Settings leaf (setKeepAwakeAgentAware) is not
// shared — Kira Space has no agent-aware reason to set — so it stays app-side via `extend`,
// createLayoutStore.ts's own pattern applied here: this window's own toggle must never lag its own
// click, and a later broadcast arrival (this window's own echo, or another window's) reapplies the
// identical value, a harmless no-op.

export interface KeepAwakeControl {
  keepAwakeStatus(): Promise<KeepAwakeStatus>;
  keepAwakeSetManual(enabled: boolean): Promise<KeepAwakeStatus>;
  onKeepAwakeChanged(cb: (status: KeepAwakeStatus) => void): () => void;
}

export interface KeepAwakeStoreActions {
  state: { status: KeepAwakeStatus };
  setKeepAwakeManual(on: boolean): Promise<void>;
}

const DEFAULT_STATUS: KeepAwakeStatus = { manual: false, supported: false, error: '' };

// `extend` is required, even for a caller with nothing to add (`() => ({})`) — see
// createLayoutStore.ts's own doc comment for why a call that leaves `E` uninferred breaks Pinia's
// action/state extraction for the whole store.
export function createKeepAwakeStore<E extends Record<string, unknown> = Record<string, never>>(
  control: KeepAwakeControl,
  extend: (actions: KeepAwakeStoreActions) => E,
) {
  return defineStore('keepAwake', () => {
    const state = reactive({ status: DEFAULT_STATUS as KeepAwakeStatus });

    let unsubscribeKeepAwake: (() => void) | null = null;

    // initKeepAwake both hydrates and subscribes — a window opened after another window toggled
    // keep-awake must not render stale (SetManual is process-wide, not window-scoped).
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

    const extra = extend({ state, setKeepAwakeManual });

    return { ...toRefs(state), initKeepAwake, setKeepAwakeManual, ...extra };
  });
}
