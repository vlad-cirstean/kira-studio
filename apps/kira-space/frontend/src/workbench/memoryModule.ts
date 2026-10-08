import type { MemoryModuleContext } from '@workbench/memory/module';
import { control } from '../bridge/control';
import { useSettingsStore } from '../state/settings';

// P201: this app's Memory module context, provided once in App.vue. The control is the shared
// `control` object's memory methods; setup lives in the Memory settings section.
export function createMemoryModule(): MemoryModuleContext {
  return { control, openSettings: () => useSettingsStore().openSettingsAt('Memory') };
}
