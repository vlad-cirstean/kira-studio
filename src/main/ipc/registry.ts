import { registerAppHandlers } from './app';
import { registerConnectionsHandlers } from './connections';
import type { IpcDeps } from './deps';
import { registerEngineHandlers } from './engine';
import { registerFiltersHandlers } from './filters';
import { registerLayoutHandlers } from './layout';
import { registerOpsHandlers } from './ops';
import { registerSettingsHandlers } from './settings';
import { registerTreeHandlers } from './tree';

export type { IpcDeps } from './deps';

export function registerIpc(deps: IpcDeps): void {
  registerAppHandlers();
  registerSettingsHandlers(deps);
  registerLayoutHandlers(deps);
  registerEngineHandlers(deps);
  registerConnectionsHandlers(deps);
  registerTreeHandlers(deps);
  registerFiltersHandlers(deps);
  registerOpsHandlers(deps);
}
