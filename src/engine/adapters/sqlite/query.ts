import type { StatementSync } from 'node:sqlite';
import type { OpCtx } from '../adapter';
import { AdapterError, assertNotCancelled } from '../errors';
import type { SqliteHandle } from './client';
import { mapError } from './errors';

export type SqliteParam = string | number | bigint | null | Uint8Array;

// F9/D9: `prepare()` silently keeps only the first statement of a multi-statement string, with no
// error — `stmt.sourceSQL` is exactly the substring of `sql` that was actually compiled (verified:
// includes the original leading whitespace, excludes everything after the first statement's own
// trailing `;`), so whatever remains is the dropped tail. Whitespace, one trailing `;`, and SQL
// comments are the only things tolerated there; anything else means a second statement would have
// silently vanished, so this refuses instead — the console's own contract (§8.14) is one page per
// statement, and a dropped tail would mean a page that quietly describes half of what was asked.
function assertSingleStatement(sql: string, stmt: StatementSync): void {
  const remainder = sql
    .slice(stmt.sourceSQL.length)
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\s;]/g, '');
  if (remainder !== '') {
    throw new AdapterError(
      'E_QUERY',
      'multiple statements are not supported in a single statement',
    );
  }
}

// D3: a *user's own table data* statement gets setReadBigInts(true) — an INTEGER outside
// Number.MAX_SAFE_INTEGER otherwise throws ERR_OUT_OF_RANGE instead of just losing precision, and
// that would crash a whole page over one out-of-range value in one row. Catalog/pragma queries
// deliberately do NOT opt in: every integer field a pragma reports (cid, pk, seq, notnull,
// hidden, wr, unique, ...) is a small counter, and BigInt-ifying it would break the plain-number
// comparisons and JSON serialization catalog.ts's code relies on for no benefit — node:sqlite's
// own default (`readBigInts: false`) is already correct for those, so they simply don't ask.
export function prepareOne(
  h: SqliteHandle,
  sql: string,
  opts?: { readBigInts?: boolean },
): StatementSync {
  let stmt: StatementSync;
  try {
    stmt = h.db.prepare(sql);
  } catch (err) {
    throw mapError(err);
  }
  assertSingleStatement(sql, stmt);
  if (opts?.readBigInts) stmt.setReadBigInts(true);
  return stmt;
}

export interface QueryOptions {
  rowsAsArray?: boolean;
  logParams?: boolean;
  /** D3: set only by the read path's own row-fetching query — see prepareOne's own comment. */
  readBigInts?: boolean;
}

// The read/catalog path: SELECT-shaped, bounded (read.ts's own LIMIT pageSize+1), so `.all()`
// rather than the streaming `iterate()` console.ts uses for a user's own unbounded statement (D5).
export function runQuery<R = unknown>(
  h: SqliteHandle,
  sql: string,
  params: SqliteParam[],
  ctx: OpCtx,
  opts?: QueryOptions,
): R[] {
  ctx.setCommand(
    opts?.logParams && params.length > 0 ? `${sql} -- params: ${JSON.stringify(params)}` : sql,
  );
  assertNotCancelled(ctx);
  const stmt = prepareOne(h, sql, { readBigInts: opts?.readBigInts });
  if (opts?.rowsAsArray) stmt.setReturnArrays(true);
  try {
    return stmt.all(...params) as R[];
  } catch (err) {
    throw mapError(err);
  }
}

export interface CommandOptions {
  /** setCommand() was already called once for the whole batch (mutate.ts, P5 D9's precedent) —
   *  do not call it again per statement. */
  suppressCommand?: boolean;
}

// mutate.ts's counterpart to runQuery — INSERT/UPDATE/DELETE, never SELECT.
export function runCommand(
  h: SqliteHandle,
  sql: string,
  params: SqliteParam[],
  ctx: OpCtx,
  opts?: CommandOptions,
): { affectedRows: number } {
  if (!opts?.suppressCommand) ctx.setCommand(sql);
  assertNotCancelled(ctx);
  const stmt = prepareOne(h, sql);
  try {
    const result = stmt.run(...params);
    return { affectedRows: Number(result.changes) };
  } catch (err) {
    throw mapError(err);
  }
}

// mutate.ts's transaction control (BEGIN IMMEDIATE/COMMIT/ROLLBACK) — fixed adapter-internal
// literals, never user SQL, so they bypass prepareOne's single-statement guard (which would have
// nothing to guard against here) and go straight through exec().
export function execLiteral(h: SqliteHandle, sql: string): void {
  try {
    h.db.exec(sql);
  } catch (err) {
    throw mapError(err);
  }
}
