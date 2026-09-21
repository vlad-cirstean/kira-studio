import type { PingPayload } from '@shared/protocol/port';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { ready, request } from '../../bridge/port';

export type EngineConnectionStatus = 'connecting' | 'ok' | 'down';

export const useEngineStore = defineStore('engine', () => {
  const state = reactive({
    status: 'connecting' as EngineConnectionStatus,
    pid: null as number | null,
    lastPingMs: null as number | null,
  });

  async function initEngineState(): Promise<void> {
    state.status = 'connecting';
    try {
      await ready;
      const start = performance.now();
      const pong = (await request('ping')) as PingPayload;
      state.status = 'ok';
      state.pid = pong.enginePid;
      state.lastPingMs = Math.round(performance.now() - start);
    } catch {
      state.status = 'down';
    }
  }

  return { ...toRefs(state), initEngineState };
});
