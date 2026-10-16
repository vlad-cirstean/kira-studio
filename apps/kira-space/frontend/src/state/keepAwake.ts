import { createKeepAwakeStore } from '@workbench/state/createKeepAwakeStore';
import { control } from '../bridge/control';

// P116 G5: body hoisted to createKeepAwakeStore.ts (H6). P188: the agent-aware leaf saves through
// the Settings dialog, so `extend` adds nothing.
export const useKeepAwakeStore = createKeepAwakeStore(control, () => ({}));
