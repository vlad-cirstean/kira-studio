import type { MobileDevice, MobilePairingSnapshot, MobileStatus } from '@shared/domain/mobile';
import { hydrateThenSubscribe } from '@workbench/state/hydrateThenSubscribe';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

const DEFAULT_STATUS: MobileStatus = {
  enabled: false,
  running: false,
  httpsPort: 7790,
  setupPort: 7791,
  appUrls: [],
  setupUrls: [],
  fingerprint: '',
  leafExpiresAt: 0,
  error: '',
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

  async function setPorts(httpsPort: number, setupPort: number): Promise<void> {
    state.status = await control.mobileSetPorts(httpsPort, setupPort);
  }

  async function resetCertificate(): Promise<void> {
    state.status = await control.mobileResetCertificate();
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
    setPorts,
    resetCertificate,
    revoke,
    approve,
    deny,
  };
});
