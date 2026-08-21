import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { connections } from './schema';

// D8: the single place that touches `connections.password`. Nothing else in the codebase may
// reference that column. P1 stores credentials in plain text per §1/§6 (encryption is deferred);
// the intended future swap is Electron's `safeStorage.encryptString`, which is Keychain-derived
// and dependency-free — a one-file change inside this indirection, not an API break.
export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

class PlaintextColumnSecretStore implements SecretStore {
  constructor(private readonly db: Db) {}

  async get(connectionId: string): Promise<string | null> {
    const row = await this.db
      .select({ password: connections.password })
      .from(connections)
      .where(eq(connections.id, connectionId))
      .get();
    return row ? (row.password ?? null) : null;
  }

  async set(connectionId: string, secret: string | null): Promise<void> {
    await this.db
      .update(connections)
      .set({ password: secret })
      .where(eq(connections.id, connectionId));
  }

  async delete(connectionId: string): Promise<void> {
    await this.db
      .update(connections)
      .set({ password: null })
      .where(eq(connections.id, connectionId));
  }
}

export function createSecretStore(db: Db): SecretStore {
  return new PlaintextColumnSecretStore(db);
}
