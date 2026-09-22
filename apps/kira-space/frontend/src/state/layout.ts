import { createLayoutStore } from '@workbench/state/createLayoutStore';
import { control } from '../bridge/control';

// P100 Part 2: Kira Studio's own state/layout.ts, ported unchanged — Layout is the one shared
// schema (@shared/domain/layout); `panel.project` is this app's own left panel (GitPanel.vue's
// repo switcher + Files/Search/Review body), the one leaf this app's UI actually reads or writes.
// `panel.operations`/`panel.cellEditor` have no view here (no ops log, no cell editor) but stay in
// the shared Layout shape and round-trip through this store untouched, the same "state stays fully
// populated even where this app's own UI never surfaces it" posture state/settings.ts takes.
//
// P103 Part 2 (§5.3): the shared skeleton now lives in
// packages/workbench/src/state/createLayoutStore.ts — this app has nothing to add, so this
// store's own public surface is unchanged from before this phase.
export const useLayoutStore = createLayoutStore(control, () => ({}));
