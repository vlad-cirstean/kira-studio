import type { ModeRegistry } from '@workbench/modes';
import GitNewTab from '../repo/GitNewTab.vue';
import GitPanel from '../repo/GitPanel.vue';
import GitStart from '../repo/GitStart.vue';
import type { SpaceMode } from '../state/mode';

// P128 §2.6: this app's own module list — mirrors Kira Studio's own workbench/modes.ts. One file
// lists a module; MODE_ORDER/MODES both widen as each module lands (git alone at step 6, terminal
// at step 7, ade at step 8).
export const MODE_ORDER: SpaceMode[] = ['git'];

export const MODES: ModeRegistry<SpaceMode> = {
  git: {
    label: 'Git',
    icon: 'source-control',
    panel: GitPanel,
    start: GitStart,
    newTab: GitNewTab,
  },
};
