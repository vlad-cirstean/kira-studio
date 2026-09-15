import type { DbMcpInstallResult, DbMcpStatus } from '@shared/domain/dbmcp';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { settingsState } from './settings';

// M1 §6.2: the Database MCP section's own store — repomap.ts's own status-plus-last-action shape,
// hydrated at boot alongside it (main.ts).
const DEFAULT_STATUS: DbMcpStatus = {
  running: false,
  command: '',
  claudeAvailable: false,
  probed: [],
  expiresAt: '',
  error: '',
};

export const dbMcpState = reactive({
  status: DEFAULT_STATUS as DbMcpStatus,
  installResult: null as DbMcpInstallResult | null,
});

export async function hydrateDbMcp(): Promise<void> {
  dbMcpState.status = await control.dbMcpStatus();
}

// repomap.ts's own D7/§7.1 rationale applies verbatim: the toggle applies immediately, bypassing
// the dialog's draft/Save flow entirely, since SetEnabled both persists the leaf and starts/stops
// the embedded instance in one call. settingsState.dbMcp.serverEnabled is set directly from the
// confirmed `enabled` argument rather than waited-for through the separate kira:settings:changed
// broadcast SetEnabled also emits server-side — this window's own toggle must never lag its own
// click, and a later broadcast arrival (this window's own echo, or another window's) reapplies the
// identical value, a harmless no-op.
export async function setDbMcpEnabled(enabled: boolean): Promise<void> {
  dbMcpState.status = await control.dbMcpSetEnabled(enabled);
  settingsState.dbMcp.serverEnabled = enabled;
  // A fresh enable/disable makes any previous install outcome stale.
  dbMcpState.installResult = null;
}

// Covers the app-restart-with-no-plaintext-held case — the Database MCP section shows this action
// in place of the command whenever status.running is true but status.command is empty.
export async function regenerateDbMcpToken(): Promise<void> {
  dbMcpState.status = await control.dbMcpRegenerate();
}

export async function installDbMcpClaudeCode(): Promise<void> {
  dbMcpState.installResult = await control.dbMcpInstallClaudeCode();
}
