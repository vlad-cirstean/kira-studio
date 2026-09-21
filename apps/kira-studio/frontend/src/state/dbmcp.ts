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

  // approveQuery/denyQuery apply the returned snapshot directly (bridge/dbmcp.go's own contract: the
  // current snapshot, not an action-result enum) so the clicking window updates immediately, without
  // waiting for its own broadcast to arrive — the broadcast still arrives and reapplies the same
  // value, a harmless no-op.
  async function approveQuery(requestId: string): Promise<void> {
    applyApprovalSnapshot(await control.dbMcpApproveQuery(requestId));
  }

  async function denyQuery(requestId: string): Promise<void> {
    applyApprovalSnapshot(await control.dbMcpDenyQuery(requestId));
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
