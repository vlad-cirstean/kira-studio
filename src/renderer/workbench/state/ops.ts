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

// D9: per-tab running-op index, derived from the kira:op:update push. Add on `running`, remove on any
// terminal status. `runningOpId(tabId)` returns the most recent running op for a tab, which is what
// the stop button keys off — no renderer-minted opIds. The version counter is REACTIVE: the Toolbar
// reads it in a computed, and a plain structure would be invisible to Vue (the same trap as the
// page version).
const runningByTab = new Map<string, Set<string>>();
const runningVersion = reactive({ n: 0 });

export function runningOpId(tabId: string): string | null {
  void runningVersion.n; // dependency: re-run the caller's computed when ops change
  const set = runningByTab.get(tabId);
  if (!set || set.size === 0) return null;
  return set.values().next().value ?? null;
}

export function runningOpsVersion(): number {
  return runningVersion.n;
}

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

  // Maintain the running-by-tab index (D9) and bump the reactive version so runningOpId
  // dependencies re-evaluate.
  if (record.tabId) {
    let set = runningByTab.get(record.tabId);
    if (record.status === 'running') {
      if (!set) {
        set = new Set();
        runningByTab.set(record.tabId, set);
      }
      set.add(record.id);
    } else if (set) {
      set.delete(record.id);
      if (set.size === 0) runningByTab.delete(record.tabId);
    }
    runningVersion.n += 1;
  }
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
