import { useTerminalsStore } from '../../../state/terminals';
import { useAdeTerminalsStore } from '../state/adeTerminals';
import type { Launch } from '../wire';
import { type LaunchDeps, openLaunch } from './deliver';

/** The terminal side of a launch: tracks the tab as an ADE terminal and opens it in this window. */
export function useLaunchOpener(): {
  deps: Pick<LaunchDeps, 'openTerminalSession' | 'terminalSession'>;
  open: (launch: Launch) => Promise<void>;
} {
  const terminals = useTerminalsStore();
  const adeTerminals = useAdeTerminalsStore();
  const deps: Pick<LaunchDeps, 'openTerminalSession' | 'terminalSession'> = {
    openTerminalSession: async (tabId, codeRepoId, cwd, cols, rows, command, kind) => {
      adeTerminals.track(tabId);
      await terminals.openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command, kind);
    },
    terminalSession: (id) => terminals.terminalSession(id),
  };
  return { deps, open: (launch) => openLaunch(deps, launch) };
}
