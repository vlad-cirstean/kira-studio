import type { OpRecord } from '@shared/domain/ops';
import { computed, markRaw, reactive } from 'vue';
import { control } from '../bridge/control';

const MAX_RECORDS = 500;
const HYDRATE_LIMIT = 200;

export const opsState = reactive({
  records: [] as OpRecord[], // newest first
  filterText: '',
  statusFilter: 'all' as 'all' | 'running' | 'error',
});

let unsubscribe: (() => void) | null = null;

export async function hydrateOps(): Promise<void> {
  // P21 round 3 performance finding 13: every op emits op:start then op:end, and each used to run
  // an O(500) findIndex scan of this deep-reactive array — pure bookkeeping, but each comparison
  // was a proxy trap, since a plain object read out of a reactive array/state is wrapped in its
  // own nested reactive proxy the moment it's accessed. markRaw (the same argument round 2 used
  // for the gRPC message buffer) marks these immutable wire records so Vue never wraps them: every
  // `.id`/`.status` read anywhere they're accessed (this findIndex, visibleOps/runningCount's own
  // filters) becomes a plain property read instead of a trap.
  opsState.records = (await control.opsRecent(HYDRATE_LIMIT)).map((r) => markRaw(r));
  unsubscribe?.();
  unsubscribe = control.onOpUpdate((record) => {
    const raw = markRaw(record);
    const idx = opsState.records.findIndex((r) => r.id === raw.id);
    if (idx >= 0) {
      opsState.records[idx] = raw; // a 'running' row replaced by its finished self
    } else {
      opsState.records.unshift(raw);
      if (opsState.records.length > MAX_RECORDS) opsState.records.length = MAX_RECORDS;
    }
  });
}

// Clears the in-memory ring only — op_log retention on disk is automatic (Step 10b's button
// title says so, so the user knows this isn't deleting history).
export function clearOps(): void {
  opsState.records = [];
}

export const visibleOps = computed<OpRecord[]>(() => {
  const text = opsState.filterText.trim().toLowerCase();
  return opsState.records.filter((record) => {
    if (opsState.statusFilter === 'running' && record.status !== 'running') return false;
    if (opsState.statusFilter === 'error' && record.status !== 'error') return false;
    if (text) {
      const haystack = `${record.command ?? ''} ${record.kind} ${record.error ?? ''}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
});

export const runningCount = computed(
  () => opsState.records.filter((record) => record.status === 'running').length,
);
