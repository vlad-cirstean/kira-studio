import type { PaletteColor } from '@shared/domain/color';
import { canonicalPath } from '@shared/domain/path';
import type { TerminalLaunchKind } from '@shared/domain/tabs';
import { type OpenTabResult, useTabsStore } from './tabs';
import type { WorkspaceKey } from './workspace';

// P100 Part 2: Kira Studio's own state/terminalTabs.ts, ported — generalised there to any
// AppMode, generalised here to any WorkspaceKey instead (this app's own single-workspace-kind
// design, state/workspace.ts's own header comment). What a non-plain launch (Claude Code, or a
// custom script) seeds a terminal tab with; `kind` is the tab's own launchKind, always given
// explicitly by the one caller that constructs a TerminalLaunch (state/repoTabs.ts's
// openRepoTerminalTab).
export interface TerminalLaunch {
  command: string;
  label: string;
  color: PaletteColor;
  kind: TerminalLaunchKind;
}

// Opens a terminal tab in `opts.workspaceId` — in practice always a repo id (state/repoTabs.ts's
// openRepoTerminalTab) or GENERAL_WORKSPACE (an unscoped terminal launch, if this app ever grows
// one outside a repo workspace).
export function openTerminalTab(opts: {
  workspaceId: WorkspaceKey;
  cwd: string;
  codeRepoId?: string;
  launch?: TerminalLaunch;
}): OpenTabResult {
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
}
