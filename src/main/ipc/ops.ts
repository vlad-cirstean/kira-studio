import { ENGINE_OP } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { z } from 'zod';
import { recentOps } from '../storage/repos/ops';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const recentArgsSchema = z.object({ limit: z.number().int().positive() });
const cancelArgsSchema = z.object({ opId: z.string() });

export function registerOpsHandlers(deps: IpcDeps): void {
  handle(IPC.opsRecent, (_event, payload) => {
    const { limit } = recentArgsSchema.parse(payload);
    return recentOps(deps.db, limit);
  });
  handle(IPC.opsCancel, async (_event, payload) => {
    const { opId } = cancelArgsSchema.parse(payload);
    await deps.engineHost.call(ENGINE_OP.cancel, { opId });
  });
}
