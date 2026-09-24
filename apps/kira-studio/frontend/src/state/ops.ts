import type { OpRecord } from '@shared/domain/ops';
import { defineStore } from 'pinia';
import { computed, markRaw, reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { useConnectionsStore } from './connections';

const MAX_RECORDS = 500;
const HYDRATE_LIMIT = 200;

export const useOpsStore = defineStore('ops', () => {
  const state = reactive({
    records: [] as OpRecord[], // newest first
    filterText: '',
    statusFilter: 'all' as 'all' | 'running' | 'error',
  });

  let unsubscribe: (() => void) | null = null;

  // Shared by the live post-hydration path below and hydrateOps' own buffer replay (F7) — a
  // 'running' row replaced by its finished self, or a brand-new op unshifted newest-first.
  function applyUpdate(records: OpRecord[], raw: OpRecord): void {
    const idx = records.findIndex((r) => r.id === raw.id);
    if (idx >= 0) {
      records[idx] = raw;
    } else {
      records.unshift(raw);
      if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    }
  }

  async function hydrateOps(): Promise<void> {
    // P21 round 3 performance finding 13: every op emits op:start then op:end, and each used to run
    // an O(500) findIndex scan of this deep-reactive array — pure bookkeeping, but each comparison
    // was a proxy trap, since a plain object read out of a reactive array/state is wrapped in its
    // own nested reactive proxy the moment it's accessed. markRaw (the same argument round 2 used
    // for the gRPC message buffer) marks these immutable wire records so Vue never wraps them: every
    // `.id`/`.status` read anywhere they're accessed (this findIndex, visibleOps/runningCount's own
    // filters) becomes a plain property read instead of a trap.
    //
    // P108 Part 12 F7: subscribe BEFORE the opsRecent await, not after — an op that both started and
    // finished in that gap used to leave a permanently 'running' row in the snapshot, since the old
    // subscribe (below the await) never saw its update at all. Every update arriving before the
    // snapshot lands is buffered here (by id, so a start-then-finish pair for the same op collapses
    // to just its final state) instead of touching state.records; replayed over the snapshot once it
    // resolves, in arrival order, matching applyUpdate's own newest-first unshift for an id the
    // snapshot never had. `hydrated` flips the handler over to applying live from then on.
    let hydrated = false;
    const buffered = new Map<string, OpRecord>();
    unsubscribe?.();
    unsubscribe = control.onOpUpdate((record) => {
      const raw = markRaw(record);
      if (!hydrated) {
        buffered.set(raw.id, raw);
        return;
      }
      applyUpdate(state.records, raw);
    });

    const records = (await control.opsRecent(HYDRATE_LIMIT)).map((r) => markRaw(r));
    for (const raw of buffered.values()) applyUpdate(records, raw);
    state.records = records;
    hydrated = true;
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
        const connName = useConnectionsStore().connectionRecord(record.connectionId)?.name ?? '';
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
