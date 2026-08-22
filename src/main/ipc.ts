import { app, ipcMain } from 'electron';
import type { ConnectionInput } from '../shared/connection';
import { ENGINE_OP } from '../shared/engine-ops';
import {
  type SavedQueryIdPayload,
  type SavedQueryListPayload,
  type SavedQueryPrunePayload,
  type SavedQueryUpsertPayload,
  type FiltersReplacePayload,
  type IdPayload,
  IPC,
  type OpsCancelPayload,
  type OpsRecentPayload,
  type ReorderPayload,
  type TreeChildrenPayload,
  type TreeDescribePayload,
  type TreeDdlPayload,
  type TreeInvalidatePayload,
  type UpdateConnectionPayload,
} from '../shared/ipc';
import type { LayoutPatch } from '../shared/layout';
import type { Settings, SettingsPatch } from '../shared/settings';
import { tabRecordSchema } from '../shared/tabs';
import { type ConnectionsService, createConnectionsService } from './connections';
import type { EngineHost } from './engine-host';
import type { Db } from './storage/db';
import { listFilters, replaceFilters } from './storage/filters';
import { getAllLayout, setLayout } from './storage/layout';
import { recentOps } from './storage/oplog';
import { kiraHome } from './storage/paths';
import {
  deleteSavedQuery,
  listSavedQueries,
  pruneHistory,
  touchSavedQuery,
  upsertSavedQuery,
} from './storage/saved-queries';
import { createSecretStore } from './storage/secrets';
import { getAllSettings, setSettings } from './storage/settings';
import { getAllTabs, replaceTabs } from './storage/tabs';
import { createTreeService, type TreeService } from './tree-service';
import { broadcast } from './window';

// Pushes the current cache settings into the engine (D25/D26). Called at startup and whenever a
// cache setting changes — the engine owns L2/L3, so this is the only way it learns the budget.
export function pushCacheConfigToEngine(engineHost: EngineHost, settings: Settings): void {
  void engineHost.call(ENGINE_OP.configure, {
    l2BudgetBytes: settings.cache.l2BudgetMb * 1024 * 1024,
    l3TtlSeconds: settings.cache.l3TtlSeconds,
  });
}

// Every handler parses/delegates and converts thrown AdapterErrors into a rejected invoke whose
// message is the server's verbatim text with the code prefixed as `[E_QUERY] …`, so the renderer
// can branch on the code without a separate error envelope (Step 6e).

export interface RegisteredServices {
  connections: ConnectionsService;
  tree: TreeService;
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, (_event, ...args: A) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((err: unknown) => {
        const code = (err as { code?: string }).code;
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(code ? `[${code}] ${message}` : message);
      }),
  );
}

export function registerIpc(db: Db, engineHost: EngineHost): RegisteredServices {
  const connections = createConnectionsService(db, engineHost, createSecretStore(db), broadcast);
  const tree = createTreeService(db, engineHost, connections, broadcast);

  ipcMain.handle(IPC.appInfo, () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    kiraHome: kiraHome(),
  }));

  ipcMain.handle(IPC.settingsGetAll, () => getAllSettings(db));
  ipcMain.handle(IPC.settingsSet, async (_event, patch: SettingsPatch) => {
    const updated = await setSettings(db, patch);
    pushCacheConfigToEngine(engineHost, updated);
    return updated;
  });

  ipcMain.handle(IPC.layoutGetAll, () => getAllLayout(db));
  ipcMain.handle(IPC.layoutSet, (_event, patch: LayoutPatch) => setLayout(db, patch));

  ipcMain.handle(IPC.engineStatus, () => engineHost.status());

  handle(IPC.connectionsList, () => connections.list());
  handle(IPC.connectionsCreate, (input: ConnectionInput) => connections.create(input));
  handle(IPC.connectionsUpdate, (payload: UpdateConnectionPayload) =>
    connections.update(payload.id, payload.input),
  );
  handle(IPC.connectionsDuplicate, (payload: IdPayload) => connections.duplicate(payload.id));
  handle(IPC.connectionsDelete, (payload: IdPayload) => connections.remove(payload.id));
  handle(IPC.connectionsReorder, (payload: ReorderPayload) => connections.reorder(payload.ids));
  handle(IPC.connectionsReveal, (payload: IdPayload) => connections.reveal(payload.id));
  handle(IPC.connectionsTest, (input: ConnectionInput) => connections.test(input));
  handle(IPC.connectionsConnect, (payload: IdPayload) => connections.connect(payload.id));
  handle(IPC.connectionsDisconnect, (payload: IdPayload) => connections.disconnect(payload.id));
  handle(IPC.connectionsStates, () => connections.states());

  handle(IPC.treeChildren, (payload: TreeChildrenPayload) =>
    tree.children(payload.connectionId, payload.path, payload.refresh),
  );
  handle(IPC.treeDescribe, (payload: TreeDescribePayload) =>
    tree.describe(payload.connectionId, payload.path, payload.refresh),
  );
  handle(IPC.treeDdl, (payload: TreeDdlPayload) =>
    tree.ddl(payload.connectionId, payload.path, payload.refresh),
  );
  handle(IPC.treeInvalidate, (payload: TreeInvalidatePayload) =>
    tree.invalidate(payload.connectionId, payload.path),
  );

  handle(IPC.filtersList, (payload: IdPayload) => listFilters(db, payload.id));
  handle(IPC.filtersReplace, (payload: FiltersReplacePayload) =>
    replaceFilters(db, payload.connectionId, payload.filters),
  );

  handle(IPC.tabsGetAll, () => getAllTabs(db));
  handle(IPC.tabsReplace, (tabs: unknown) => {
    // The renderer sends the full set; main validates each before persisting.
    const records = (tabs as unknown[]).map((r) => tabRecordSchema.parse(r));
    return replaceTabs(db, records);
  });
  handle(IPC.savedQueriesList, (payload: SavedQueryListPayload) =>
    listSavedQueries(db, payload),
  );
  handle(IPC.savedQueriesUpsert, (payload: SavedQueryUpsertPayload) =>
    upsertSavedQuery(db, payload),
  );
  handle(IPC.savedQueriesDelete, (payload: SavedQueryIdPayload) =>
    deleteSavedQuery(db, payload.id),
  );
  handle(IPC.savedQueriesTouch, (payload: SavedQueryIdPayload) =>
    touchSavedQuery(db, payload.id),
  );
  handle(IPC.savedQueriesPrune, (payload: SavedQueryPrunePayload) =>
    pruneHistory(db, payload.connectionId, payload.path),
  );

  handle(IPC.opsRecent, (payload: OpsRecentPayload) => recentOps(db, payload.limit));
  handle(IPC.opsCancel, (payload: OpsCancelPayload) =>
    engineHost.call(ENGINE_OP.cancel, { opId: payload.opId }),
  );

  return { connections, tree };
}
