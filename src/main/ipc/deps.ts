import type { ConnectionsService } from '../connections';
import type { EngineHost } from '../engine-host';
import type { Db } from '../storage/db';
import type { TreeService } from '../tree-service';

export interface IpcDeps {
  db: Db;
  engineHost: EngineHost;
  connections: ConnectionsService;
  tree: TreeService;
}
