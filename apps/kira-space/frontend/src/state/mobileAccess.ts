import type { MobileDevice, MobilePairingSnapshot, MobileStatus } from '@shared/domain/mobile';
import { hydrateThenSubscribe } from '@workbench/state/hydrateThenSubscribe';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

const DEFAULT_STATUS: MobileStatus = {
  enabled: false,
  running: false,
  port: 7790,
  appUrl: '',
  agentInput: false,
  error: '',
  stopReason: '',
  stopDetail: '',
  current: null,
  trusted: null,
  trustedAt: 0,
};

// P212: the Mobile access pane and the phone pairing prompt share this store. The pending
// request already exists server-side at boot; hydrate only renders it.
export const useMobileAccessStore = defineStore('mobileAccess', () => {
  const state = reactive({
    status: DEFAULT_STATUS as MobileStatus,
    devices: [] as MobileDevice[],
    pending: null as MobilePairingSnapshot['pending'],
    queued: 0,
  });

  const unsubscribers: Array<() => void> = [];

  async function hydrateMobileAccess(): Promise<void> {
    for (const off of unsubscribers.splice(0)) off();
    const results = await Promise.all([
      hydrateThenSubscribe({
        snapshot: () => control.mobileStatus(),
        subscribe: (cb) => control.onMobileStatusChanged(cb),
        apply: (status) => {
          state.status = status;
        },
      }).catch((err) => err as Error),
      hydrateThenSubscribe({
        snapshot: () => control.mobileDevices(),
        subscribe: (cb) => control.onMobileDevicesChanged(cb),
        apply: (list) => {
          state.devices = list;
        },
      }).catch((err) => err as Error),
      hydrateThenSubscribe({
        snapshot: () => control.mobilePairingPending(),
        subscribe: (cb) => control.onMobilePairingChanged(cb),
        apply: (snap) => {
          state.pending = snap.pending;
          state.queued = snap.queued;
        },
      }).catch((err) => err as Error),
    ]);
    for (const r of results) if (typeof r === 'function') unsubscribers.push(r);
    for (const r of results) if (r instanceof Error) throw r;
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    state.status = await control.mobileSetEnabled(enabled);
  }

  async function setPort(port: number): Promise<void> {
    state.status = await control.mobileSetPort(port);
  }

  async function trustNetwork(): Promise<void> {
    state.status = await control.mobileTrustNetwork();
  }

  async function forgetNetwork(): Promise<void> {
    state.status = await control.mobileForgetNetwork();
  }

  async function setAgentInput(enabled: boolean): Promise<void> {
    state.status = await control.mobileSetAgentInput(enabled);
  }

  async function setDevicePermissions(
    id: string,
    permissions: { write: boolean; agentInput: boolean },
  ): Promise<void> {
    await control.mobileSetDevicePermissions(id, permissions.write, permissions.agentInput);
  }

  async function revoke(id: string): Promise<void> {
    await control.mobileRevoke(id);
  }

  // The emitted pairing event clears `pending`, whichever window's click won.
  async function approve(requestId: string): Promise<void> {
    await control.mobilePairingApprove(requestId);
  }

  async function deny(requestId: string): Promise<void> {
    await control.mobilePairingDeny(requestId);
  }

  return {
    ...toRefs(state),
    hydrateMobileAccess,
    setEnabled,
    setPort,
    trustNetwork,
    forgetNetwork,
    setAgentInput,
    setDevicePermissions,
    revoke,
    approve,
    deny,
  };
});
