import type { ModeRegistry } from '@workbench/modes';
import { defineAsyncComponent } from 'vue';
import GitNewTab from '../repo/GitNewTab.vue';
import GitPanel from '../repo/GitPanel.vue';
import GitStart from '../repo/GitStart.vue';
import type { SpaceMode } from '../state/mode';

// P128 §2.6/§2.7: this app's own module list — mirrors Kira Studio's own workbench/modes.ts. One
// file lists a module; MODE_ORDER/MODES both widen as each module lands (git alone at step 6,
// terminal here at step 7, ade at step 8).
export const MODE_ORDER: SpaceMode[] = ['git', 'terminal'];

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
};
