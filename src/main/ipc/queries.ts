import { z } from 'zod';
import { consoleBodySchema, filterBodySchema, sortSpecSchema } from '../../shared/domain/queries';
import { IPC } from '../../shared/protocol/ipc';
import { listFilterHistory, recordFilterUse } from '../storage/repos/filter-history';
import {
  deleteSavedQuery,
  listSavedConsoleQueries,
  listSavedFilters,
  saveConsoleQuery,
  saveFilter,
  touchSavedQuery,
  updateSavedQuery,
} from '../storage/repos/saved-queries';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const listArgsSchema = z.object({ connectionId: z.string(), path: z.string() });
const saveArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  name: z.string(),
  body: filterBodySchema,
  pinned: z.boolean(),
});
const saveConsoleArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  name: z.string(),
  body: consoleBodySchema,
  pinned: z.boolean(),
});
const updateArgsSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  pinned: z.boolean().optional(),
});
const idArgsSchema = z.object({ id: z.string() });
const historyListArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  limit: z.number().int().min(1).max(100),
});
const historyRecordArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  where: z.string().nullable(),
  orderBy: sortSpecSchema.nullable(),
});

export function registerQueriesHandlers(deps: IpcDeps): void {
  handle(IPC.queriesList, (_event, payload) => {
    const { connectionId, path } = listArgsSchema.parse(payload);
    return listSavedFilters(deps.db, connectionId, path);
  });
  handle(IPC.queriesSave, (_event, payload) => {
    const args = saveArgsSchema.parse(payload);
    return saveFilter(deps.db, args);
  });
  handle(IPC.queriesListConsole, (_event, payload) => {
    const { connectionId, path } = listArgsSchema.parse(payload);
    return listSavedConsoleQueries(deps.db, connectionId, path);
  });
  handle(IPC.queriesSaveConsole, (_event, payload) => {
    const args = saveConsoleArgsSchema.parse(payload);
    return saveConsoleQuery(deps.db, args);
  });
  handle(IPC.queriesUpdate, (_event, payload) => {
    const { id, ...patch } = updateArgsSchema.parse(payload);
    return updateSavedQuery(deps.db, id, patch);
  });
  handle(IPC.queriesDelete, async (_event, payload) => {
    const { id } = idArgsSchema.parse(payload);
    await deleteSavedQuery(deps.db, id);
  });
  handle(IPC.queriesTouch, async (_event, payload) => {
    const { id } = idArgsSchema.parse(payload);
    await touchSavedQuery(deps.db, id);
  });
  handle(IPC.queriesHistoryList, (_event, payload) => {
    const { connectionId, path, limit } = historyListArgsSchema.parse(payload);
    return listFilterHistory(deps.db, connectionId, path, limit);
  });
  handle(IPC.queriesHistoryRecord, async (_event, payload) => {
    const args = historyRecordArgsSchema.parse(payload);
    await recordFilterUse(deps.db, args);
  });
}
