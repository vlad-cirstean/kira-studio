import type { CodedError } from '@workbench/bridge/codedError';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { getJson, postJson } from '../api/http';

interface MobileMe {
  permissions: { write: boolean; agentInput: boolean };
  agentInputGlobal: boolean;
}

type AuthPhase =
  | 'checking'
  | 'unpaired'
  | 'requesting'
  | 'denied'
  | 'timedOut'
  | 'revoked'
  | 'expired'
  | 'paired'
  | 'unreachable';

// Rejection sampling keeps all 10000 codes equally likely.
function fourDigitCode(): string {
  const limit = 0x100000000 - (0x100000000 % 10000);
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while ((buf[0] as number) >= limit);
  return String((buf[0] as number) % 10000).padStart(4, '0');
}

export const useAuthStore = defineStore('mobileAuth', () => {
  const state = reactive({
    phase: 'checking' as AuthPhase,
    /** Shown on the phone and in the desktop prompt so the user can match the request. */
    code: '',
    message: '',
    /** What the desktop allows this phone; agentInput already folds in the global switch. */
    permissions: { write: false, agentInput: false },
    /** The desktop's global agent input switch, so a hint can say which switch is off. */
    agentInputGlobal: false,
  });
  let pairing: AbortController | null = null;

  function onUnauthorized(code: string): void {
    state.phase = code === 'E_REVOKED' ? 'revoked' : code === 'E_EXPIRED' ? 'expired' : 'unpaired';
  }

  async function check(): Promise<void> {
    state.phase = 'checking';
    try {
      applyMe(await getJson<MobileMe>('/api/me'));
      state.phase = 'paired';
    } catch {
      // A 401 already set the phase through onUnauthorized; any other failure means unreachable.
      if (state.phase === 'checking') state.phase = 'unreachable';
    }
  }

  function applyMe(me: MobileMe): void {
    state.permissions = me.permissions;
    state.agentInputGlobal = me.agentInputGlobal;
  }

  /** Re-reads the permissions: the desktop can change them while the app is open. */
  async function refreshMe(): Promise<void> {
    try {
      applyMe(await getJson<MobileMe>('/api/me'));
    } catch {
      // a 401 already moved the phase; any other failure keeps the last known permissions
    }
  }

  async function requestAccess(label: string): Promise<void> {
    pairing?.abort();
    pairing = new AbortController();
    state.code = fourDigitCode();
    state.message = '';
    state.phase = 'requesting';
    try {
      await postJson('/api/pair', { label, code: state.code }, { signal: pairing.signal });
      state.phase = 'paired';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const coded = err as CodedError;
      state.message = coded.message;
      if (coded.code === 'E_PAIRING_DENIED')
        state.phase = coded.details === 'timeout' ? 'timedOut' : 'denied';
      else state.phase = coded.code === 'E_NETWORK' ? 'unreachable' : 'unpaired';
    }
  }

  function cancelRequest(): void {
    pairing?.abort();
    state.phase = 'unpaired';
  }

  return { ...toRefs(state), check, refreshMe, requestAccess, cancelRequest, onUnauthorized };
});
