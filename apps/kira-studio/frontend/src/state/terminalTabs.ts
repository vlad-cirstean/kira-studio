import type { PaletteColor } from '@shared/domain/color';
import type { TerminalLaunchKind } from '@shared/domain/tabs';
import type { WorkspaceKey } from '@shared/domain/workspace';
import { canonicalPath } from './coderepos';
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

// P91 §6: opens a terminal tab in `opts.workspaceId` — repoTabs.ts's openRepoTerminalTab's own
// body (minus its openRepoWorkspace(codeRepoId) first line), generalised to any WorkspaceKey.
// Deliberately does NOT open a repo workspace as a side effect: that is exactly wrong for a
// Terminal-module launch, which must stay in the Terminal module's own workspace ('terminal',
// carried as opts.workspaceId), not silently switch the active module to Git.
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
