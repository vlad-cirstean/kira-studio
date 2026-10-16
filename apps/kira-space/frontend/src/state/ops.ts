import { createOpLogStore } from '@workbench/state/createOpLogStore';
import { control } from '../bridge/control';
import type { SpaceOpRecord } from './opsDomain';

// P132 Part 2: the shared op-log store over Kira Space's in-memory Go ring. The filter also
// matches the repo name and the origin.
export const useOpsStore = createOpLogStore<SpaceOpRecord>({
  control: {
    recent: (limit) => control.opsRecent(limit),
    onUpdate: (cb) => control.onOpUpdate(cb),
    cancel: (id) => control.opsCancel(id),
  },
  searchText: (r) => `${r.repoName} ${r.source}`,
});
