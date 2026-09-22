import type { PaletteColor } from '@shared/domain/color';
import type { AppMode } from '@shared/domain/mode';
import { canonicalPath } from '@shared/domain/path';
import type { TerminalLaunchKind } from '@shared/domain/tabs';
import { type OpenTabResult, useTabsStore } from './tabs';

// P85 §5.3: what a non-plain launch (Claude Code, or a custom script) seeds a terminal tab with.
// P86 §4: `kind` is the tab's own launchKind — always given explicitly by the one caller that
// constructs a TerminalLaunch (TabStrip.vue), never left to infer from `command`.
//
// P91 §6: moved out of state/repoTabs.ts so this module can use it with no dependency on the
// repo-specific opener — repoTabs.ts re-exports it, so no importer breaks.
export interface TerminalLaunch {
  command: string;
  label: string;
  color: PaletteColor;
  kind: TerminalLaunchKind;
}

// P91 §6: opens a terminal tab in `opts.workspaceId`, generalised to any AppMode — in practice
// always 'terminal' (this app's own Terminal module, every caller below). P100 Part 2: this
// module's own doc comment used to also cite state/repoTabs.ts's openRepoTerminalTab, whose own
// body this generalises, and its own re-export of TerminalLaunch/openTerminalTab — both moved to
// apps/kira-space wholesale along with the repo workspace itself. `codeRepoId` stays on the
// options shape below (TerminalTabState's own field, @shared/domain/tabs) even though nothing in
// this app ever passes it any more — a plain string, not a live coderepos.ts reference, so it
// costs this app nothing to keep passing through unchanged.
export function openTerminalTab(opts: {
  workspaceId: AppMode;
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
