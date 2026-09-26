import type { ModeRegistry } from '@workbench/modes';
import { defineAsyncComponent } from 'vue';
import AdePanel from '../ade/AdePanel.vue';
import AdeStart from '../ade/AdeStart.vue';
import GitNewTab from '../repo/GitNewTab.vue';
import GitPanel from '../repo/GitPanel.vue';
import GitStart from '../repo/GitStart.vue';
import type { SpaceMode } from '../state/mode';

// P128 §2.6/§2.7/§2.8: this app's own module list — mirrors Kira Studio's own workbench/modes.ts.
// One file lists a module; MODE_ORDER/MODES both widened as each module landed (git at step 6,
// terminal at step 7, ade here at step 8).
export const MODE_ORDER: SpaceMode[] = ['git', 'terminal', 'ade'];

export const MODES: ModeRegistry<SpaceMode> = {
  git: {
    label: 'Git',
    icon: 'source-control',
    panel: GitPanel,
    start: GitStart,
    newTab: GitNewTab,
  },
  // P128 §2.4/§2.7: a peer module, lazy the same reason Kira Studio's own copy is — nothing in a
  // git-only session should pay for the terminal panel's own launch chunk.
  terminal: {
    label: 'Terminal',
    icon: 'terminal-bash',
    panel: defineAsyncComponent(() => import('@workbench/terminal/TerminalPanel.vue')),
    start: defineAsyncComponent(() => import('@workbench/terminal/TerminalStart.vue')),
    newTab: defineAsyncComponent(() => import('@workbench/terminal/TerminalNewTab.vue')),
  },
  // P128 §2.7: a placeholder module — no Go, no store, no bridge — reserving this app's own
  // "Agents" slot ahead of a later chapter's real surface. No `newTab`: nothing to open yet.
  ade: { label: 'Agents', icon: 'robot', panel: AdePanel, start: AdeStart },
};
