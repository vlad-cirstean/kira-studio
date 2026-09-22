import { createTerminalsStore } from '@workbench/state/createTerminalsStore';
import { control } from '../bridge/control';

// P83 §5: the terminal registry — session state by tab id, plus output routing. Lives in
// `state/`, not `repo/state/`: biome.json forbids `repo/**` importing `views/**` and `views/**`
// importing `workbench/**`, so `state/` is the one layer GitPanel.vue (§11's indicator),
// TabStrip.vue (§9's "+"), state/tabKinds.ts (dropResources) and views/repo/ (the renderer) can
// all reach.
//
// P103 Part 2 (§5.3): the shared skeleton (byte-identical to Kira Studio's own state/terminals.ts)
// now lives in packages/workbench/src/state/createTerminalsStore.ts. This file is just the
// `control` wiring.

export const useTerminalsStore = createTerminalsStore(control);
