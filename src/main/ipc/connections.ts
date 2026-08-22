import { z } from 'zod';
import { connectionInputSchema } from '../../shared/domain/connection';
import { IPC } from '../../shared/protocol/ipc';
import type { IpcDeps } from './deps';
import { handle } from './errors';

const idArgsSchema = z.object({ id: z.string() });
const updateArgsSchema = z.object({ id: z.string(), input: connectionInputSchema });
const reorderArgsSchema = z.object({ ids: z.array(z.string()) });
const testArgsSchema = z.object({ input: connectionInputSchema });

export function registerConnectionsHandlers(deps: IpcDeps): void {
  const { connections } = deps;

  handle(IPC.connectionsList, () => connections.list());
  handle(IPC.connectionsCreate, (_event, payload) =>
    connections.create(connectionInputSchema.parse(payload)),
  );
  handle(IPC.connectionsUpdate, (_event, payload) => {
    const { id, input } = updateArgsSchema.parse(payload);
    return connections.update(id, input);
  });
  handle(IPC.connectionsDuplicate, (_event, payload) =>
    connections.duplicate(idArgsSchema.parse(payload).id),
  );
  handle(IPC.connectionsDelete, (_event, payload) =>
    connections.remove(idArgsSchema.parse(payload).id),
  );
  handle(IPC.connectionsReorder, (_event, payload) =>
    connections.reorder(reorderArgsSchema.parse(payload).ids),
  );
  handle(IPC.connectionsReveal, (_event, payload) =>
    connections.reveal(idArgsSchema.parse(payload).id),
  );
  handle(IPC.connectionsTest, (_event, payload) =>
    connections.test(testArgsSchema.parse(payload).input),
  );
  handle(IPC.connectionsConnect, (_event, payload) =>
    connections.connect(idArgsSchema.parse(payload).id),
  );
  handle(IPC.connectionsDisconnect, (_event, payload) =>
    connections.disconnect(idArgsSchema.parse(payload).id),
  );
  handle(IPC.connectionsStates, () => connections.states());
}
