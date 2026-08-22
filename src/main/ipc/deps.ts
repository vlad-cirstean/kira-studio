import type { ConnectionsService } from '../connections';
import type { EngineHost } from '../engine-host';
import type { KiraDb } from '../storage/db';
import type { TreeService } from '../tree-service';

export interface IpcDeps {
  db: KiraDb;
  engineHost: EngineHost;
  connections: ConnectionsService;
  tree: TreeService;
}
