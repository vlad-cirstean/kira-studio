import type { OpLogRecord } from '@shared/domain/ops';
import { defineStore } from 'pinia';
import { computed, markRaw, reactive, toRefs } from 'vue';
import { usePersistedState } from '../behaviour/persisted';
import { logError } from '../bridge/log';

const MAX_RECORDS = 500;
const MAX_BACKGROUND = 300;
const HYDRATE_LIMIT = 200;

// Studio's own state/ops.ts, generalized so Kira Space's git op log can reuse the same
// hydrate/subscribe/filter logic without a second copy. `control` wraps each app's own bound
// bridge call, and `searchText` is the one app-specific filter extra (Studio's connection-name
// match, state/ops.ts's old line 82).
export interface OpLogControl<R extends OpLogRecord> {
  recent(limit: number): Promise<R[]>;
  onUpdate(cb: (record: R) => void): () => void;
  /** Coalesced pushes (Space's background reads); each record applies like an update. */
  onBatch?(cb: (records: R[]) => void): () => void;
  cancel(id: string): Promise<void>;
}

export interface OpLogStoreOptions<R extends OpLogRecord> {
  control: OpLogControl<R>;
  /** Extra filter text per record, beyond command/kind/error. */
  searchText?: (record: R) => string;
  /** Marks high-volume records: a separate 300-row lane, hidden until `showBackground`. */
  background?: (record: R) => boolean;
}

export function createOpLogStore<R extends OpLogRecord>(options: OpLogStoreOptions<R>) {
  const { control, searchText, background } = options;

  return defineStore('opLog', () => {
    // Vue's own `reactive<T>` return type (`UnwrapNestedRefs<T>`) recomputes a structurally-equal
    // but nominally different type for a generic `R` — this cast restores the plain type below
    // without changing `reactive`'s actual runtime behavior at all (createTabsStore.ts's own
    // identical note).
    const state = reactive({
      records: [] as R[], // newest first
      filterText: '',
      statusFilter: 'all' as 'all' | 'running' | 'error',
    }) as {
      records: R[];
      filterText: string;
      statusFilter: 'all' | 'running' | 'error';
    };

    const showBackground = usePersistedState('kira.ops.showBackground', false);
    let unsubscribe: (() => void) | null = null;
    let unsubscribeBatch: (() => void) | null = null;

    // Shared by the live post-hydration path below and hydrateOps' own buffer replay (F7) — a
    // 'running' row replaced by its finished self, or a brand-new op unshifted newest-first.
    function applyUpdate(records: R[], raw: R): void {
      const idx = records.findIndex((r) => r.id === raw.id);
      if (idx >= 0) {
        records[idx] = raw;
      } else {
        records.unshift(raw);
        trimLane(records, background?.(raw) ?? false);
      }
    }

    // Drops the oldest row of the lane the new record joined.
    function trimLane(records: R[], isBackground: boolean): void {
      const cap = isBackground ? MAX_BACKGROUND : MAX_RECORDS;
      let count = 0;
      for (let i = 0; i < records.length; i++) {
        if ((background?.(records[i] as R) ?? false) !== isBackground) continue;
        if (++count > cap) {
          records.splice(i, 1);
          return;
        }
      }
    }

    async function hydrateOps(): Promise<void> {
      // Every op emits op:start then op:end, and each used to run an O(500) findIndex scan of this
      // deep-reactive array — pure bookkeeping, but each comparison was a proxy trap, since a
      // plain object read out of a reactive array/state is wrapped in its own nested reactive
      // proxy the moment it's accessed. markRaw marks these immutable wire records so Vue never
      // wraps them: every `.id`/`.status` read anywhere they're accessed (this findIndex,
      // visibleOps/runningCount's own filters) becomes a plain property read instead of a trap.
      //
      // Subscribe BEFORE the opsRecent await, not after — an op that both started and finished in
      // that gap used to leave a permanently 'running' row in the snapshot, since the old
      // subscribe (below the await) never saw its update at all. Every update arriving before the
      // snapshot lands is buffered here (by id, so a start-then-finish pair for the same op
      // collapses to just its final state) instead of touching state.records; replayed over the
      // snapshot once it resolves, in arrival order, matching applyUpdate's own newest-first
      // unshift for an id the snapshot never had. `hydrated` flips the handler over to applying
      // live from then on.
      let hydrated = false;
      const buffered = new Map<string, R>();
      unsubscribe?.();
      unsubscribeBatch?.();
      const receive = (record: R): void => {
        const raw = markRaw(record);
        if (!hydrated) {
          buffered.set(raw.id, raw);
          return;
        }
        applyUpdate(state.records, raw);
      };
      unsubscribe = control.onUpdate(receive);
      unsubscribeBatch =
        control.onBatch?.((records) => {
          for (const record of records) receive(record);
        }) ?? null;

      // A rejected snapshot still flips to live: without it the buffer grows forever and no live
      // update ever applies. The caller still sees the failure.
      let records: R[] = [];
      let failure: unknown;
      try {
        records = (await control.recent(HYDRATE_LIMIT)).map((r) => markRaw(r));
      } catch (err) {
        failure = err;
      }
      for (const raw of buffered.values()) applyUpdate(records, raw);
      state.records = records;
      hydrated = true;
      if (failure !== undefined) throw failure;
    }

    // Clears this window's list only — each app's own clear-hint prop states its own retention
    // story.
    function clearOps(): void {
      state.records = [];
    }

    async function cancelOp(id: string): Promise<void> {
      try {
        await control.cancel(id);
      } catch (err) {
        logError('opLog', 'cancel failed', err);
      }
    }

    const visibleOps = computed<R[]>(() => {
      const text = state.filterText.trim().toLowerCase();
      return state.records.filter((record) => {
        if (background?.(record) && !showBackground.value) return false;
        if (state.statusFilter === 'running' && record.status !== 'running') return false;
        if (state.statusFilter === 'error' && record.status !== 'error') return false;
        if (text) {
          const extra = searchText?.(record) ?? '';
          const haystack =
            `${record.command ?? ''} ${record.kind} ${record.error ?? ''} ${extra}`.toLowerCase();
          if (!haystack.includes(text)) return false;
        }
        return true;
      });
    });

    const runningCount = computed(
      () =>
        state.records.filter((record) => record.status === 'running' && !background?.(record))
          .length,
    );

    return {
      ...toRefs(state),
      showBackground,
      hydrateOps,
      clearOps,
      cancelOp,
      visibleOps,
      runningCount,
    };
  });
}
