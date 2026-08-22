import { z } from 'zod';
import { connectionFilterInputSchema } from '../../shared/domain/connection-filter';
import { IPC } from '../../shared/protocol/ipc';
import { listFilters, replaceFilters } from '../storage/repos/filters';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const listArgsSchema = z.object({ connectionId: z.string() });
const replaceArgsSchema = z.object({
  connectionId: z.string(),
  filters: z.array(connectionFilterInputSchema),
});

export function registerFiltersHandlers(deps: IpcDeps): void {
  handle(IPC.filtersList, (_event, payload) => {
    const { connectionId } = listArgsSchema.parse(payload);
    return listFilters(deps.db, connectionId);
  });
  handle(IPC.filtersReplace, (_event, payload) => {
    const { connectionId, filters } = replaceArgsSchema.parse(payload);
    return replaceFilters(deps.db, connectionId, filters);
  });
}
