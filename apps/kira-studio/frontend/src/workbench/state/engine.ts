import type { PingPayload } from '@shared/protocol/port';
import { reactive } from 'vue';
import { ready, request } from '../../bridge/port';

export type EngineConnectionStatus = 'connecting' | 'ok' | 'down';

export const engineState = reactive({
  status: 'connecting' as EngineConnectionStatus,
  pid: null as number | null,
  lastPingMs: null as number | null,
});

export async function initEngineState(): Promise<void> {
  engineState.status = 'connecting';
  try {
    await ready;
    const start = performance.now();
    const pong = (await request('ping')) as PingPayload;
    engineState.status = 'ok';
    engineState.pid = pong.enginePid;
    engineState.lastPingMs = Math.round(performance.now() - start);
  } catch {
    engineState.status = 'down';
  }
}
