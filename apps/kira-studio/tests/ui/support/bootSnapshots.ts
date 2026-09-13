import { defaultLayout } from '@shared/domain/layout';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import { defaultSettings } from '@shared/domain/settings';
import type { ControlSnapshot } from '../../ipc/support/types';
import { IPC } from './ipcChannels';

const KEYCHAIN_AVAILABLE: SecretStorageStatus = {
  available: true,
  backend: 'keychain',
  insecureFallback: false,
  reason: null,
};

/**
 * The five-call `Promise.all` `apps/kira-studio/frontend/src/main.ts`'s `bootstrap()` fires before `mount()` —
 * `layoutGetAll`/`settingsGetAll`/`connectionsList`+`connectionsStates`+`connectionsSecretsStatus`
 * (`hydrateConnections`)/`opsRecent`/`tabsList` — answered with an empty, healthy app: defaults,
 * no connections, no ops, no tabs. This is what a fresh `KIRA_HOME` gave every `tests/e2e/` spec
 * for free before P57; here it is one array every `tests/ui/` spec's `relaunch()` starts from.
 *
 * `windowsEnsure` (P8) runs sequentially *before* this `Promise.all`, not inside it — always a
 * no-op void call here (`mockRuntime.ts`'s own `WILDCARD_DEFAULTS`, not listed in this array,
 * the same way `tabsSave`/`filtersList` aren't).
 *
 * `engineStatus` is deliberately absent — nothing in the renderer ever calls it (the status pill
 * reads `workbench/state/engine.ts`'s data-plane `ping`, not a control-plane channel), so it has
 * no `CHANNEL_TO_FQN` entry and needs none here.
 */
export const EMPTY_BOOT_SNAPSHOTS: readonly ControlSnapshot[] = [
  { channel: IPC.layoutGetAll, response: defaultLayout },
  { channel: IPC.settingsGetAll, response: defaultSettings },
  { channel: IPC.connectionsList, response: [] },
  { channel: IPC.connectionsStates, response: [] },
  { channel: IPC.connectionsSecretsStatus, response: KEYCHAIN_AVAILABLE },
  { channel: IPC.opsRecent, response: [] },
  { channel: IPC.tabsList, response: [] },
];

/** A spec's own snapshot for a channel replaces the default outright, rather than being appended
 *  after it — `mockRuntime.ts` answers a channel's snapshots in fixture order, so appending would
 *  make the boot-time call consume the (still-empty) default and never reach the spec's data. */
export function mergeBootSnapshots(overrides: readonly ControlSnapshot[]): ControlSnapshot[] {
  const overridden = new Set(overrides.map((s) => s.channel));
  return [...EMPTY_BOOT_SNAPSHOTS.filter((s) => !overridden.has(s.channel)), ...overrides];
}
