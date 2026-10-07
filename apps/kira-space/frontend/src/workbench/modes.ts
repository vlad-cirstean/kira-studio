import type { ModeRegistry } from '@workbench/modes';
import { defineAsyncComponent } from 'vue';
import AdeView from '../ade/AdeView.vue';
import GitNewTab from '../repo/GitNewTab.vue';
import GitPanel from '../repo/GitPanel.vue';
import GitStart from '../repo/GitStart.vue';
import type { SpaceMode } from '../state/mode';

// P128 §2.6/§2.7/§2.8: this app's own module list — mirrors Kira Studio's own workbench/modes.ts.
// One file lists a module; MODE_ORDER/MODES both widened as each module landed (git at step 6,
// terminal at step 7, ade here at step 8).
export const MODE_ORDER: SpaceMode[] = ['git', 'ade', 'terminal', 'memory'];

// P129 Part 3 §0.12: the base `ModeDef` union, not `ModeRegistry<SpaceMode, PanelModeDef>` — `ade`
// below is the app's first `layout: 'full'` module. Kira Studio's own `MODES` stays pinned to
// `PanelModeDef` (its shell still reads `.panel`/`.start` unconditionally); this app's shell now
// branches on `layout` instead (`workbench/WorkbenchShell.vue`'s own `isFull` computed).
export const MODES: ModeRegistry<SpaceMode> = {
  git: {
    label: 'Git',
    icon: 'source-control',
    panel: GitPanel,
    start: GitStart,
    newTab: GitNewTab,
  },
  // P129 Part 3 §0.12/§2.1: the module's own real surface — a full-area view, no left panel, no
  // tab strip, no tabs of its own (P128's own placeholder deleted in this commit).
  ade: { label: 'Agents', icon: 'robot', layout: 'full', view: AdeView },
  // P128 §2.4/§2.7: a peer module, lazy the same reason Kira Studio's own copy is — nothing in a
  // git-only session should pay for the terminal panel's own launch chunk.
  terminal: {
    label: 'Terminal',
    icon: 'terminal-bash',
    panel: defineAsyncComponent(() => import('@workbench/terminal/TerminalPanel.vue')),
    start: defineAsyncComponent(() => import('@workbench/terminal/TerminalStart.vue')),
    newTab: defineAsyncComponent(() => import('@workbench/terminal/TerminalNewTab.vue')),
  },
  // P201 Part 2: a panel module that opens no tabs; the detail view is its main area.
  memory: {
    label: 'Memory',
    icon: 'lightbulb',
    panel: defineAsyncComponent(() => import('@workbench/memory/MemoryPanel.vue')),
    start: defineAsyncComponent(() => import('@workbench/memory/MemoryStart.vue')),
  },
};
