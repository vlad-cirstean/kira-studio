import { log } from '../log';
import type { RawDb } from './db';
import { migrations } from './migrations';

export function migrate(db: RawDb): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.get('SELECT version FROM schema_version LIMIT 1') as
    | { version: number }
    | undefined;
  if (!row) {
    db.run('INSERT INTO schema_version (version) VALUES (0)');
  }
  let current = row?.version ?? 0;

  const maxVersion = migrations[migrations.length - 1]?.version ?? 0;
  if (current > maxVersion) {
    throw new Error(
      `Database schema_version (${current}) is newer than this build knows about ` +
        `(${maxVersion}) — refusing to run against a downgraded app.`,
    );
  }

  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run('UPDATE schema_version SET version = ?', [m.version]);
    });
    log('info', 'migrate', `applied ${m.name} (version ${m.version})`);
    current = m.version;
  }
}
