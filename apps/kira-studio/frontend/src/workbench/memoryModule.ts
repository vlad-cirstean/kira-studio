import type { MemoryModuleContext } from '@workbench/memory/module';
import { control } from '../bridge/control';

// P201: this app's Memory module context, provided once in App.vue. The control is the shared
// `control` object's memory methods.
export function createMemoryModule(): MemoryModuleContext {
  return { control };
}
