import type { ConnectionDdl } from '@shared/domain/schema';
import { reactive } from 'vue';
import { control } from '../bridge/control';

// P18 (v1.1) D2/D4: the renderer-side store for each connection's pasted DDL document — app-wide
// like connections/settings/layout (docs/ARCHITECTURE.md's Multi-window section), keyed by
// connectionId. A connection with no saved document simply has no entry, matching D2's "absent
// until the user writes one" (never an error, never a placeholder row).
export const schemasState = reactive({
  byConnection: {} as Record<string, string>, // connectionId -> raw DDL text
});

export const schemaDialogState = reactive({
  open: false,
  connectionId: null as string | null,
});

export function openSchemaDialog(connectionId: string): void {
  schemaDialogState.open = true;
  schemaDialogState.connectionId = connectionId;
}

export function closeSchemaDialog(): void {
  schemaDialogState.open = false;
  schemaDialogState.connectionId = null;
}

const pendingLoads = new Map<string, Promise<string>>();

// Memoised per connectionId (D3's dialog and C5's completion source both call this) — a fetch
// only ever happens once per connection per session; a Save (below) and a remote broadcast both
// write straight into `byConnection` without going through this again.
export async function ensureDdl(connectionId: string): Promise<string> {
  const cached = schemasState.byConnection[connectionId];
  if (cached !== undefined) return cached;
  let pending = pendingLoads.get(connectionId);
  if (!pending) {
    pending = control.schemaGet(connectionId).then((r) => r.ddl);
    pendingLoads.set(connectionId, pending);
  }
  const ddl = await pending;
  pendingLoads.delete(connectionId);
  schemasState.byConnection[connectionId] = ddl;
  return ddl;
}

export async function saveDdl(connectionId: string, ddl: string): Promise<void> {
  const result = await control.schemaSet(connectionId, ddl);
  schemasState.byConnection[connectionId] = result.ddl;
}

function applyRemote(ddl: ConnectionDdl): void {
  schemasState.byConnection[ddl.connectionId] = ddl.ddl;
}

let unsubscribeChanged: (() => void) | null = null;
let unsubscribeConnectionsChanged: (() => void) | null = null;

// D2/D4: a document lives as long as its connection does (not tree-cache-like — nothing here
// evicts on disconnect, unlike project/state/tree.ts's own dropConnectionState), so the only
// cleanup this module owns is dropping a deleted connection's entry.
export function initSchemaSync(): void {
  unsubscribeChanged?.();
  unsubscribeChanged = control.onSchemaChanged(applyRemote);

  unsubscribeConnectionsChanged?.();
  unsubscribeConnectionsChanged = control.onConnectionsChanged((records) => {
    const liveIds = new Set(records.map((r) => r.id));
    for (const id of Object.keys(schemasState.byConnection)) {
      if (!liveIds.has(id)) delete schemasState.byConnection[id];
    }
  });
}
