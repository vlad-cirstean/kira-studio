import type { OpRecord } from '@shared/domain/ops';
import { defineStore } from 'pinia';
import { computed, markRaw, reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { connectionRecord } from './connections';

const MAX_RECORDS = 500;
const HYDRATE_LIMIT = 200;

export const useOpsStore = defineStore('ops', () => {
  const state = reactive({
    records: [] as OpRecord[], // newest first
    filterText: '',
    statusFilter: 'all' as 'all' | 'running' | 'error',
  });

  let unsubscribe: (() => void) | null = null;

  async function hydrateOps(): Promise<void> {
    // P21 round 3 performance finding 13: every op emits op:start then op:end, and each used to run
    // an O(500) findIndex scan of this deep-reactive array — pure bookkeeping, but each comparison
    // was a proxy trap, since a plain object read out of a reactive array/state is wrapped in its
    // own nested reactive proxy the moment it's accessed. markRaw (the same argument round 2 used
    // for the gRPC message buffer) marks these immutable wire records so Vue never wraps them: every
    // `.id`/`.status` read anywhere they're accessed (this findIndex, visibleOps/runningCount's own
    // filters) becomes a plain property read instead of a trap.
    state.records = (await control.opsRecent(HYDRATE_LIMIT)).map((r) => markRaw(r));
    unsubscribe?.();
    unsubscribe = control.onOpUpdate((record) => {
      const raw = markRaw(record);
      const idx = state.records.findIndex((r) => r.id === raw.id);
      if (idx >= 0) {
        state.records[idx] = raw; // a 'running' row replaced by its finished self
      } else {
        state.records.unshift(raw);
        if (state.records.length > MAX_RECORDS) state.records.length = MAX_RECORDS;
      }
    });
  }

  // Clears the in-memory ring only — op_log retention on disk is automatic (Step 10b's button
  // title says so, so the user knows this isn't deleting history).
  function clearOps(): void {
    state.records = [];
  }

  const visibleOps = computed<OpRecord[]>(() => {
    const text = state.filterText.trim().toLowerCase();
    return state.records.filter((record) => {
      if (state.statusFilter === 'running' && record.status !== 'running') return false;
      if (state.statusFilter === 'error' && record.status !== 'error') return false;
      if (text) {
        // P22b D14: this filter already existed (F21's own grep for icon="search"/PanelSearchBox
        // missed it — it's an always-visible TextField with icon="filter") and already matched
        // command/kind/error. The one real gap the row's "op label and its connection name" asks
        // for was the connection's own name — added here rather than duplicating the box with a
        // second, toggle-based one.
        const connName = connectionRecord(record.connectionId)?.name ?? '';
        const haystack =
          `${record.command ?? ''} ${record.kind} ${record.error ?? ''} ${connName}`.toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
  });

  const runningCount = computed(
    () => state.records.filter((record) => record.status === 'running').length,
  );

  return { ...toRefs(state), hydrateOps, clearOps, visibleOps, runningCount };
});
