import type { DbMcpApprovalSnapshot, DbMcpInstallResult, DbMcpStatus } from '@shared/domain/dbmcp';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { useSettingsStore } from './settings';

// M1 §6.2: the Database MCP section's own store — a status-plus-last-action shape, hydrated at
// boot (main.ts).
const DEFAULT_STATUS: DbMcpStatus = {
  running: false,
  command: '',
  claudeAvailable: false,
  probed: [],
  expiresAt: '',
  error: '',
};

export const useDbMcpStore = defineStore('dbmcp', () => {
  const state = reactive({
    status: DEFAULT_STATUS as DbMcpStatus,
    installResult: null as DbMcpInstallResult | null,
    // M2 §5: the prompt-mode approval queue — state/gitClients.ts's own pending/queued shape,
    // applied to run_query's approval broker instead of git pairing.
    approval: { pending: null, queued: 0 } as DbMcpApprovalSnapshot,
  });

  async function hydrateDbMcp(): Promise<void> {
    state.status = await control.dbMcpStatus();
  }

  function applyApprovalSnapshot(snap: DbMcpApprovalSnapshot): void {
    state.approval.pending = snap.pending;
    state.approval.queued = snap.queued;
  }

  let unsubscribeApproval: (() => void) | null = null;

  // M2 §5.3: PendingApprovals() is what implements "held with no Kira Studio window open yet" from
  // the renderer's side, gitPairingPending's own precedent — the request already exists server-side;
  // this is only the first render of it.
  async function hydrateDbMcpApprovals(): Promise<void> {
    applyApprovalSnapshot(await control.dbMcpPendingApprovals());
    unsubscribeApproval?.();
    unsubscribeApproval = control.onDbMcpApprovalChanged(applyApprovalSnapshot);
  }

  // P108 Part 12 F2 (minor, same file family): approveQuery/denyQuery used to apply the RPC's own
  // returned snapshot directly, so the clicking window updated without waiting for its own
  // onDbMcpApprovalChanged broadcast to arrive. But the broker emits that broadcast synchronously
  // inside Approve/Deny (internal/dbmcp/approval.go), before the RPC handler even returns its own
  // snapshot — so a second broadcast (e.g. another window's concurrent answer to the next request)
  // could already be in flight and land here *after* this call's own (now older) returned snapshot,
  // overwriting the newer queue state with a stale one until the following change. Ignoring the
  // returned snapshot and relying solely on the broadcast (same source for every window, always
  // freshest-applied last since state/dbmcp.ts subscribes once) removes that ordering hazard
  // entirely; the round trip is local IPC, not worth a race for.
  async function approveQuery(requestId: string): Promise<void> {
    await control.dbMcpApproveQuery(requestId);
  }

  async function denyQuery(requestId: string): Promise<void> {
    await control.dbMcpDenyQuery(requestId);
  }

  // C3 §7.1/D7: the toggle applies immediately, bypassing the dialog's draft/Save flow entirely,
  // since SetEnabled both persists the leaf and starts/stops the embedded instance in one call.
  // settingsStore.dbMcp.serverEnabled is set directly from the
  // confirmed `enabled` argument rather than waited-for through the separate kira:settings:changed
  // broadcast SetEnabled also emits server-side — this window's own toggle must never lag its own
  // click, and a later broadcast arrival (this window's own echo, or another window's) reapplies the
  // identical value, a harmless no-op.
  async function setDbMcpEnabled(enabled: boolean): Promise<void> {
    state.status = await control.dbMcpSetEnabled(enabled);
    useSettingsStore().dbMcp.serverEnabled = enabled;
    // A fresh enable/disable makes any previous install outcome stale.
    state.installResult = null;
  }

  // Covers the app-restart-with-no-plaintext-held case — the Database MCP section shows this action
  // in place of the command whenever status.running is true but status.command is empty.
  async function regenerateDbMcpToken(): Promise<void> {
    state.status = await control.dbMcpRegenerate();
  }

  async function installDbMcpClaudeCode(): Promise<void> {
    state.installResult = await control.dbMcpInstallClaudeCode();
  }

  return {
    ...toRefs(state),
    hydrateDbMcp,
    hydrateDbMcpApprovals,
    approveQuery,
    denyQuery,
    setDbMcpEnabled,
    regenerateDbMcpToken,
    installDbMcpClaudeCode,
  };
});
