import type { Db } from '../db';

export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

interface PasswordRow {
  password: string | null;
}

// The only file in the codebase that reads or writes `connections.password` (D8). §1 defers
// credential encryption; the intended replacement is Electron's `safeStorage.encryptString`
// (Keychain-derived, no new dependency) — swapping it in only touches this file, which is why
// the interface is async even though this implementation has nothing to await.
export function createSecretStore(db: Db): SecretStore {
  return {
    async get(connectionId) {
      const row = db.get('SELECT password FROM connections WHERE id = ?', [connectionId]) as
        | PasswordRow
        | undefined;
      return row?.password ?? null;
    },
    async set(connectionId, secret) {
      db.run('UPDATE connections SET password = ? WHERE id = ?', [secret, connectionId]);
    },
    async delete(connectionId) {
      db.run('UPDATE connections SET password = NULL WHERE id = ?', [connectionId]);
    },
  };
}
