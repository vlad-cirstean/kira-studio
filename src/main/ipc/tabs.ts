import { z } from 'zod';
import { tabRecordSchema } from '../../shared/domain/tabs';
import { IPC } from '../../shared/protocol/ipc';
import { listTabs, replaceTabs } from '../storage/repos/tabs';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const saveArgsSchema = z.object({ tabs: z.array(tabRecordSchema) });

export function registerTabsHandlers(deps: IpcDeps): void {
  handle(IPC.tabsList, () => listTabs(deps.db));
  handle(IPC.tabsSave, async (_event, payload) => {
    const { tabs } = saveArgsSchema.parse(payload);
    await replaceTabs(deps.db, tabs);
  });
}
