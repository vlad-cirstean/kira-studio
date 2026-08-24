import { eq } from 'drizzle-orm';
import { log } from '../../log';
import type { SecretCipher } from '../../secret-cipher';
import type { KiraDb } from '../db';
import { connections } from '../schema/connections';

export interface SecretStore {
  get(connectionId: string): Promise<string | null>;
  set(connectionId: string, secret: string | null): Promise<void>;
  /** Copies the stored column value verbatim — no decrypt, no re-encrypt (P25 D11). */
  copy(fromConnectionId: string, toConnectionId: string): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

// The only file in the codebase that reads or writes `connections.password` (P1 D8). Encryption
// (P25) is delegated to the injected SecretCipher — this file never imports `safeStorage` itself
// (P25 D1), it only calls the cipher's encrypt/decrypt.
export function createSecretStore(db: KiraDb, cipher: SecretCipher): SecretStore {
  return {
    async get(connectionId) {
      const rows = await db
        .select({ password: connections.password })
        .from(connections)
        .where(eq(connections.id, connectionId));
      const stored = rows[0]?.password ?? null;
      return stored === null ? null : cipher.decrypt(stored);
    },
    async set(connectionId, secret) {
      const stored = secret === null ? null : cipher.encrypt(secret);
      await db
        .update(connections)
        .set({ password: stored })
        .where(eq(connections.id, connectionId));
    },
    async copy(fromConnectionId, toConnectionId) {
      const rows = await db
        .select({ password: connections.password })
        .from(connections)
        .where(eq(connections.id, fromConnectionId));
      await db
        .update(connections)
        .set({ password: rows[0]?.password ?? null })
        .where(eq(connections.id, toConnectionId));
    },
    async delete(connectionId) {
      await db.update(connections).set({ password: null }).where(eq(connections.id, connectionId));
    },
  };
}

// One-shot, idempotent upgrade of rows written before P25 (D10). Not a migration file — the
// migration runner is SQL-only and SQL cannot call `safeStorage` (F3). `SecretStore.get()`'s own
// passthrough for a non-enveloped value is the belt to this upgrade's braces, not a substitute
// for it: this is what protects every row on the very next launch, not only the ones a user
// happens to open.
export async function upgradeLegacySecrets(db: KiraDb, cipher: SecretCipher): Promise<number> {
  if (!cipher.status.available) {
    log(
      'warn',
      'storage/secrets',
      'secret storage unavailable at startup — skipping legacy plaintext password upgrade',
    );
    return 0;
  }
  const rows = await db
    .select({ id: connections.id, password: connections.password })
    .from(connections);
  const legacy = rows.filter(
    (row): row is { id: string; password: string } =>
      typeof row.password === 'string' && row.password !== '' && !cipher.isEnveloped(row.password),
  );
  if (legacy.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const row of legacy) {
      await tx
        .update(connections)
        .set({ password: cipher.encrypt(row.password) })
        .where(eq(connections.id, row.id));
    }
  });
  log('info', 'storage/secrets', `upgraded ${legacy.length} legacy plaintext password(s)`);
  return legacy.length;
}
