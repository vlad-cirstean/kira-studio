import type { OpRecord } from '@shared/ops';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';

// Operations ring buffer (Step 10a, D19): newest first, hard-capped at 500 in memory, hydrated from
// op_log at startup, upserted by kira:op:update.

const CAP = 500;

export const opsState = reactive({
  records: [] as OpRecord[],
  filterText: '',
  statusFilter: 'all' as 'all' | 'running' | 'error',
  expandedId: null as string | null,
});

export async function hydrateOps(): Promise<void> {
  opsState.records = await control.opsRecent({ limit: 200 });
  control.onOpUpdate((record) => {
    upsert(record);
  });
}

function upsert(record: OpRecord): void {
  const index = opsState.records.findIndex((r) => r.id === record.id);
  if (index >= 0) opsState.records.splice(index, 1);
  opsState.records.unshift(record);
  if (opsState.records.length > CAP) opsState.records.length = CAP;
}

export function clearOps(): void {
  opsState.records = [];
}

export async function cancelOp(opId: string): Promise<void> {
  await control.opsCancel({ opId });
}

export const visibleOps = computed<OpRecord[]>(() => {
  const text = opsState.filterText.trim().toLowerCase();
  return opsState.records.filter((r) => {
    if (opsState.statusFilter === 'running' && r.status !== 'running') return false;
    if (opsState.statusFilter === 'error' && r.status !== 'error') return false;
    if (text) {
      const haystack = `${r.command ?? ''} ${r.error ?? ''} ${r.kind}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
});

export const runningCount = computed(
  () => opsState.records.filter((r) => r.status === 'running').length,
);
