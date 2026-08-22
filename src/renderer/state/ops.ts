import type { OpRecord } from '@shared/domain/ops';
import { computed, reactive } from 'vue';
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
  opsState.records = await control.opsRecent(HYDRATE_LIMIT);
  unsubscribe?.();
  unsubscribe = control.onOpUpdate((record) => {
    const idx = opsState.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      opsState.records[idx] = record; // a 'running' row replaced by its finished self
    } else {
      opsState.records.unshift(record);
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
