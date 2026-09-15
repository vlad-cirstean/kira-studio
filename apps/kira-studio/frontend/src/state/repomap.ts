import type { RepoMapInstallResult, RepoMapStatus } from '@shared/domain/repomap';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { settingsState } from './settings';

// C3 §7.4/P67d §7.3: the Code intelligence tab's own store — the shape gitClientsState already
// established for a status-plus-last-action pair, hydrated at boot alongside it (main.ts).
const DEFAULT_STATUS: RepoMapStatus = {
  running: false,
  url: '',
  command: '',
  claudeAvailable: false,
  probed: [],
  expiresAt: '',
  error: '',
  repos: [],
};

export const repoMapState = reactive({
  status: DEFAULT_STATUS as RepoMapStatus,
  installResult: null as RepoMapInstallResult | null,
});

export async function hydrateRepoMap(): Promise<void> {
  repoMapState.status = await control.repoMapStatus();
}

// D7/§7.1: the toggle applies immediately, bypassing the dialog's draft/Save flow entirely —
// onRevokeGitClient/onInstallVsCodeIntegration's own posture, since SetEnabled both persists the
// leaf and starts/stops the embedded instance in one call. settingsState.codeIntel.mcpServerEnabled
// is set directly from the confirmed `enabled` argument rather than waited-for-through the
// separate kira:settings:changed broadcast SetEnabled also emits server-side — this window's own
// toggle must never lag its own click, and a later broadcast arrival (this window's own echo, or
// another window's) reapplies the identical value, a harmless no-op.
export async function setRepoMapEnabled(enabled: boolean): Promise<void> {
  repoMapState.status = await control.repoMapSetEnabled(enabled);
  settingsState.codeIntel.mcpServerEnabled = enabled;
  // A fresh enable/disable makes any previous install outcome stale.
  repoMapState.installResult = null;
}

// §0 D8: covers the app-restart-with-no-plaintext-held case — the Code intelligence tab shows this
// action in place of the command whenever status.running is true but status.command is empty.
export async function regenerateRepoMapToken(): Promise<void> {
  repoMapState.status = await control.repoMapRegenerate();
}

// P67d §7.3/§7.4: the "Repository access" list's own per-row grant/revoke — no settingsState write,
// since the grant lives in code_repos, not in settings; installResult is left alone, since a grant
// change never invalidates an existing registration (the same token, the same URL).
export async function setRepoMapRepoEnabled(id: string, enabled: boolean): Promise<void> {
  repoMapState.status = await control.repoMapSetRepoEnabled(id, enabled);
}

export async function installRepoMapClaudeCode(): Promise<void> {
  repoMapState.installResult = await control.repoMapInstallClaudeCode();
}
