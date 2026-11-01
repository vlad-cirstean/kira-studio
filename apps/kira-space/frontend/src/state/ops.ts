import { createOpLogStore } from '@workbench/state/createOpLogStore';
import { control } from '../bridge/control';
import type { SpaceOpRecord } from './opsDomain';

// P415: the shared op-log store over Kira Space's persisted op log. Background reads arrive batched
// and stay hidden until the toggle. The filter also matches repo, origin, module and subject; the facet dropdown filters by module.
export const useOpsStore = createOpLogStore<SpaceOpRecord>({
  control: {
    recent: (limit) => control.opsRecent(limit),
    onUpdate: (cb) => control.onOpUpdate(cb),
    onBatch: (cb) => control.onOpBatch(cb),
    cancel: (id) => control.opsCancel(id),
  },
  background: (r) => r.background,
  facet: (r) => r.module,
  searchText: (r) => `${r.repoName} ${r.source} ${r.module} ${r.subject}`,
});
