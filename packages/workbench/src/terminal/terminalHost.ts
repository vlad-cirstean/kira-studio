import type { TerminalTabState } from '@shared/domain/tabs';
import type { TerminalRendererDeps } from './terminalRenderer';
import type { TerminalMountSession } from './useTerminalMount';

// P128 §2.4: split out of TerminalHostView.vue so a plain .ts file (module.ts) can import these
// types too. tsgo's own `.vue` handling (unlike vue-tsc's SFC-aware resolution) falls back to
// env.d.ts's generic `declare module '*.vue'` shim for any import from a `.vue` path, which
// exposes only the default export — a `.ts` file importing a named type straight from a `.vue`
// file fails there even though vue-tsc resolves it fine.
export type TerminalHostTabState = Pick<
  TerminalTabState,
  'codeRepoId' | 'cwd' | 'command' | 'launchKind'
> & { scriptId?: string };

export interface TerminalHostDeps {
  rendererDeps: TerminalRendererDeps;
  terminalSession: (tabId: string) => TerminalMountSession | undefined;
  openTerminalSession: (
    tabId: string,
    codeRepoId: string,
    cwd: string,
    cols: number,
    rows: number,
    command: string,
    launchKind: TerminalHostTabState['launchKind'],
    scriptId: string,
  ) => Promise<void>;
  resizeTerminal: (tabId: string, cols: number, rows: number) => void;
}
