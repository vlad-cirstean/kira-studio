import { createModeStore } from '@workbench/state/createModeStore';
import { control } from '../bridge/control';
import type { SpaceMode } from './modeDomain';

// P128 §2.6: this app's own mode store — mirrors Kira Studio's own state/mode.ts (P128 §2.3's
// shared createModeStore), minus `activeTab`: this app has no per-mode active-tab map of its own
// to derive one from (state/tabs.ts scopes by workspace, not mode — visibleWorkspace(),
// state/workspace.ts, is the bridge between the two). `SpaceMode` itself lives in modeDomain.ts,
// not here (that file's own header comment explains why); re-exported so every existing
// `import { type SpaceMode } from '../state/mode'` keeps working unchanged.
export type { SpaceMode } from './modeDomain';

export const useModeStore = createModeStore<SpaceMode>(control, 'git', () => ({}));
