import { z } from 'zod';
import { IPC } from '../../shared/protocol/ipc';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const treeArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  refresh: z.boolean().optional(),
});
const invalidateArgsSchema = z.object({ connectionId: z.string(), path: z.string().optional() });

export function registerTreeHandlers(deps: IpcDeps): void {
  const { tree } = deps;

  handle(IPC.treeChildren, (_event, payload) => {
    const { connectionId, path, refresh } = treeArgsSchema.parse(payload);
    return tree.children(connectionId, path, refresh ?? false);
  });
  handle(IPC.treeDescribe, (_event, payload) => {
    const { connectionId, path, refresh } = treeArgsSchema.parse(payload);
    return tree.describe(connectionId, path, refresh ?? false);
  });
  handle(IPC.treeInvalidate, (_event, payload) => {
    const { connectionId, path } = invalidateArgsSchema.parse(payload);
    return tree.invalidate(connectionId, path);
  });
}
