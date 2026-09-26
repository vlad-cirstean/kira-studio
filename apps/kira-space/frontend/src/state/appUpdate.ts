import { createAppUpdateStore } from '@workbench/state/createAppUpdateStore';
import { control } from '../bridge/control';

// P119: Kira Studio's own copy of this file, createAppUpdateStore.ts's own per-app-call-site
// precedent (createKeepAwakeStore.ts's identical shape).
export const useAppUpdateStore = createAppUpdateStore(control, 'Kira Space');
