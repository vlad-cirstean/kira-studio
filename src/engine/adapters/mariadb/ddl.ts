import { splitSqlStatements, type SourceText } from '../../../shared/ddl';
import { encodePath, type NodePath } from '../../../shared/tree';
import { AdapterError } from '../errors';

// MariaDB DDL (P4 D5). MariaDB HAS SHOW CREATE — every object is byte-exact, including the server's
// own canonical `;`-free form. One SHOW CREATE per kind, parameter-bound database/name; the second
// column of the result set (`Create Table`/`Create View`/…) is the DDL text.
//
// NOTE (P4 seam): the mariadb adapter lands in P2 Step 14. This module is deliberately driver-free —
// it takes a query executor, so it typechecks today and P2's `index.ts` wires `this.clients` in.
// Do not import `mariadb` here.

export interface MariaDbQueryRunner {
  /** Runs one statement and returns its rows as plain objects. */
  query<R extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<R[]>;
}

export interface MariaDbDdlFacade extends MariaDbQueryRunner {
  quoteIdent(name: string): string;
}

type Ctx = { opId: string; signal: AbortSignal; setCommand(text: string): void };

// SHOW CREATE TABLE `db`.`t` — the quoted name is split so the *database* part is fixed by the
// connected database and the object part is parameter-bound. SHOW CREATE cannot take bind
// parameters, so the name is quoted with the adapter's quoteIdent (catalog metadata, D6 rule).
function showCreateSql(kind: 'table' | 'view' | 'procedure' | 'function', quoted: string): string {
  switch (kind) {
    case 'table':
      return `SHOW CREATE TABLE ${quoted}`;
    case 'view':
      return `SHOW CREATE VIEW ${quoted}`;
    case 'procedure':
      return `SHOW CREATE PROCEDURE ${quoted}`;
    case 'function':
      return `SHOW CREATE FUNCTION ${quoted}`;
  }
}

const CREATE_COLUMN: Record<'table' | 'view' | 'procedure' | 'function', string> = {
  table: 'Create Table',
  view: 'Create View',
  procedure: 'Create Procedure',
  function: 'Create Function',
};

// A `routine` node carries no PROCEDURE/FUNCTION distinction in its path, so ask the catalog. The
// row kind decides which SHOW CREATE to run (D5).
async function routineKind(
  facade: MariaDbDdlFacade,
  db: string,
  obj: string,
  ctx: Ctx,
): Promise<'procedure' | 'function' | null> {
  ctx.setCommand('SELECT ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?');
  const rows = await facade.query<{ ROUTINE_TYPE?: unknown }>(
    'SELECT ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?',
    [db, obj],
  );
  const type = rows[0]?.ROUTINE_TYPE;
  if (type === 'PROCEDURE') return 'procedure';
  if (type === 'FUNCTION') return 'function';
  return null;
}

export async function ddlFor(
  facade: MariaDbDdlFacade,
  path: NodePath,
  ctx: Ctx,
): Promise<SourceText> {
  if (path.segments.length < 2) {
    throw new AdapterError('E_NOT_FOUND', 'cannot render DDL for this path');
  }
  const db = path.segments[0].name;
  const obj = path.segments[1].name;
  const kind = path.segments[1].kind;

  const showKind =
    kind === 'table' || kind === 'view'
      ? kind
      : kind === 'routine'
        ? await routineKind(facade, db, obj, ctx)
        : null;
  if (showKind === null) {
    throw new AdapterError('E_UNSUPPORTED', `no DDL for node kind "${kind}"`);
  }

  const qualified = `${facade.quoteIdent(db)}.${facade.quoteIdent(obj)}`;
  const sql = showCreateSql(showKind, qualified);
  ctx.setCommand(sql);

  const rows = await facade.query<Record<string, unknown>>(sql, []);
  if (rows.length === 0) {
    throw new AdapterError('E_NOT_FOUND', `SHOW CREATE returned nothing for ${db}.${obj}`);
  }
  const column = CREATE_COLUMN[showKind];
  const text = rows[0]?.[column];
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new AdapterError('E_NOT_FOUND', `no DDL column "${column}" for ${db}.${obj}`);
  }

  const start = Date.now();
  const statements = splitSqlStatements(text, 'mariadb');
  return {
    kind: 'ddl',
    path: encodePath(path.segments),
    objectKind: kind as 'table' | 'view' | 'routine',
    name: obj,
    qualifiedName: `${db}.${obj}`,
    text,
    statements,
    elapsedMs: Date.now() - start,
    fromCache: false,
  };
}
