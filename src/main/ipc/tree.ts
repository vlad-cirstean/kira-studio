import { z } from 'zod';
import { IPC } from '../../shared/protocol/ipc';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const treeArgsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  refresh: z.boolean().optional(),
  // Set by the definition view specifically, so its RunState can find its own op-log row
  // (state/runState.ts) — omitted by callers with no tab of their own (e.g. the grid's metadata
  // fetch), which is why children()/describe() stay untagged elsewhere.
  tabId: z.string().optional(),
});
const invalidateArgsSchema = z.object({ connectionId: z.string(), path: z.string().optional() });

export function registerTreeHandlers(deps: IpcDeps): void {
  const { tree } = deps;

  handle(IPC.treeChildren, (_event, payload) => {
    const { connectionId, path, refresh } = treeArgsSchema.parse(payload);
    return tree.children(connectionId, path, refresh ?? false);
  });
  handle(IPC.treeDescribe, (_event, payload) => {
    const { connectionId, path, refresh, tabId } = treeArgsSchema.parse(payload);
    return tree.describe(connectionId, path, refresh ?? false, tabId ?? null);
  });
  handle(IPC.treeDefinition, (_event, payload) => {
    const { connectionId, path, refresh, tabId } = treeArgsSchema.parse(payload);
    return tree.definition(connectionId, path, refresh ?? false, tabId ?? null);
  });
  handle(IPC.treeInvalidate, (_event, payload) => {
    const { connectionId, path } = invalidateArgsSchema.parse(payload);
    return tree.invalidate(connectionId, path);
  });
}
