import { registerAppHandlers } from './app';
import { registerConnectionsHandlers } from './connections';
import type { IpcDeps } from './deps';
import { registerEngineHandlers } from './engine';
import { registerFilesHandlers } from './files';
import { registerFiltersHandlers } from './filters';
import { registerLayoutHandlers } from './layout';
import { registerOpsHandlers } from './ops';
import { registerQueriesHandlers } from './queries';
import { registerSettingsHandlers } from './settings';
import { registerTabsHandlers } from './tabs';
import { registerTreeHandlers } from './tree';

export type { IpcDeps } from './deps';

export function registerIpc(deps: IpcDeps): void {
  registerAppHandlers();
  registerFilesHandlers();
  registerSettingsHandlers(deps);
  registerLayoutHandlers(deps);
  registerEngineHandlers(deps);
  registerConnectionsHandlers(deps);
  registerTreeHandlers(deps);
  registerFiltersHandlers(deps);
  registerOpsHandlers(deps);
  registerTabsHandlers(deps);
  registerQueriesHandlers(deps);
}
