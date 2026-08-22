import { eq } from 'drizzle-orm';
import type { KiraDb } from '../db';
import { connections } from '../schema/connections';

export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

// The only file in the codebase that reads or writes `connections.password` (D8). §1 defers
// credential encryption; the intended replacement is Electron's `safeStorage.encryptString`
// (Keychain-derived, no new dependency) — swapping it in only touches this file.
export function createSecretStore(db: KiraDb): SecretStore {
  return {
    async get(connectionId) {
      const rows = await db
        .select({ password: connections.password })
        .from(connections)
        .where(eq(connections.id, connectionId));
      return rows[0]?.password ?? null;
    },
    async set(connectionId, secret) {
      await db
        .update(connections)
        .set({ password: secret })
        .where(eq(connections.id, connectionId));
    },
    async delete(connectionId) {
      await db.update(connections).set({ password: null }).where(eq(connections.id, connectionId));
    },
  };
}
