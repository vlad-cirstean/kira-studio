import { treeVisibilitySchema } from '@shared/domain/tree-filter';
import { IPC } from '@shared/protocol/ipc';
import { z } from 'zod';
import { listVisibility, replaceVisibility } from '../storage/repos/filters';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const listArgsSchema = z.object({ connectionId: z.string() });
const replaceArgsSchema = z.object({
  connectionId: z.string(),
  visibility: treeVisibilitySchema,
});

export function registerFiltersHandlers(deps: IpcDeps): void {
  handle(IPC.filtersList, (_event, payload) => {
    const { connectionId } = listArgsSchema.parse(payload);
    return listVisibility(deps.db, connectionId);
  });
  handle(IPC.filtersReplace, (_event, payload) => {
    const { connectionId, visibility } = replaceArgsSchema.parse(payload);
    return replaceVisibility(deps.db, connectionId, visibility);
  });
}
