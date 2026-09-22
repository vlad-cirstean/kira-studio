import type { PaletteColor } from '@shared/domain/color';
import { canonicalPath } from '@shared/domain/path';
import type { TerminalLaunchKind, TerminalTabState } from '@shared/domain/tabs';

// P103 Part 2 (§5.2/§4.3): `state/terminalTabs.ts`'s only real divergence between the two apps was
// the workspace-key type (`AppMode` in Kira Studio, `WorkspaceKey` in Kira Space) — everything
// else, including the doc comments, was already identical. Each app now instantiates this once in
// its own thin `state/terminalTabs.ts`.

/** What a non-plain launch (Claude Code, or a custom script) seeds a terminal tab with. `kind` is
 *  the tab's own launchKind — always given explicitly by the one caller that constructs one, never
 *  left to infer from `command`. */
export interface TerminalLaunch {
  command: string;
  label: string;
  color: PaletteColor;
  kind: TerminalLaunchKind;
}

export interface OpenTerminalTabOpts<K extends string> {
  workspaceId: K;
  cwd: string;
  codeRepoId?: string;
  launch?: TerminalLaunch;
}

export interface OpenTerminalTabResult {
  id: string;
  reused: boolean;
}

interface TerminalTabsStore<K extends string> {
  openTab(
    kind: 'terminal',
    connectionId: null,
    path: string,
    makeState: () => TerminalTabState,
    opts: { reuse: boolean; workspaceId: K },
  ): OpenTerminalTabResult;
}

/** Opens a terminal tab in `opts.workspaceId`, generic over the workspace-key type `K` — pass the
 *  app's own `useTabsStore`. */
export function createOpenTerminalTab<K extends string>(useTabsStore: () => TerminalTabsStore<K>) {
  return function openTerminalTab(opts: OpenTerminalTabOpts<K>): OpenTerminalTabResult {
    return useTabsStore().openTab(
      'terminal',
      null,
      opts.cwd,
      () => ({
        cwd: canonicalPath(opts.cwd),
        codeRepoId: opts.codeRepoId ?? '',
        command: opts.launch?.command ?? '',
        label: opts.launch?.label ?? '',
        color: opts.launch?.color ?? 'none',
        launchKind: opts.launch?.kind ?? 'shell',
      }),
      { reuse: false, workspaceId: opts.workspaceId },
    );
  };
}
