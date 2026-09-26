import { createKeepAwakeStore } from '@workbench/state/createKeepAwakeStore';
import { control } from '../bridge/control';

// P116 G5: body hoisted to createKeepAwakeStore.ts (H6) — this app has no agent-aware Settings
// leaf of its own, so `extend` adds nothing, unlike Kira Studio's own copy of this file.
export const useKeepAwakeStore = createKeepAwakeStore(control, () => ({}));
