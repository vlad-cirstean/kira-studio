import { createSettingsStore } from '@workbench/state/createSettingsStore';
import { control } from '../bridge/control';

// P100 Part 2: Kira Studio's own state/settings.ts, ported. Settings itself stays the one shared
// schema (@shared/domain/settings) — every section still round-trips through this store even
// though SettingsDialog.vue here (a small rewrite, not a port) surfaces only Appearance/Git/
// Connected editors/Advanced's own gitLogLevel leaf; the sections list below is this app's own
// dialog surface, not the full Settings shape.
export const sections = ['Appearance', 'Git', 'Connected editors', 'Advanced'] as const;
export type Section = (typeof sections)[number];

// P103 Part 2 (§5.3): the shared skeleton now lives in
// packages/workbench/src/state/createSettingsStore.ts — this app has nothing to add, so this
// store's own public surface is unchanged from before this phase.
export const useSettingsStore = createSettingsStore<Section>()(control, () => ({ extra: {} }));
