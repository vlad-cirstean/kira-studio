import type { StatementSync } from 'node:sqlite';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
} from '../../../shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { singleStatusPage } from '../sql-text';
import type { SqliteHandle } from './client';
import { mapError } from './errors';
import { checkNotCancelled, prepareOne } from './query';
import { toCellText, typeClassFor } from './read';

// F5: `StatementSync.columns()` reports each column's *declared* origin type ('INTEGER', 'TEXT',
// null for an expression or an untyped column) — the same vocabulary `pragma_table_xinfo` uses,
// unlike MariaDB's own wire-type vocabulary (mysql-family/console.ts). `typeClassFor` is exactly
// the read path's function, reused unchanged.
function columnsFor(stmt: StatementSync): ColumnDescriptor[] {
  return stmt.columns().map((c) => ({
    name: c.name,
    dataType: c.type ?? '',
    typeClass: typeClassFor(c.type),
    // execute() never consults the catalog — nullability/PK-ness are unknowable here; console
    // results are always read-only regardless (mirrors mysql-family/console.ts's own note).
    nullable: true,
    isPrimaryKey: false,
    generated: false,
  }));
}

// F5: `columns().length === 0` is exactly how a non-row-returning statement (INSERT/UPDATE/DELETE/
// DDL/pragma) is told apart from a SELECT — verified against node:sqlite directly, not assumed.
function runOneStatement(stmt: StatementSync): TabularPage {
  const descriptors = columnsFor(stmt);
  try {
    if (descriptors.length === 0) {
      const result = stmt.run();
      return singleStatusPage(`${result.changes} row(s) affected`, 'text');
    }

    // D5: `.iterate()`, not `.all()` — a user's own console statement is unbounded, unlike the
    // read path's own `LIMIT pageSize + 1`, and streaming avoids holding a second full copy of
    // the result alongside the page builder's own buffers.
    stmt.setReturnArrays(true);
    const builder = createTabularPageBuilder(descriptors);
    let rowCount = 0;
    for (const row of stmt.iterate() as Iterable<unknown[]>) {
      builder.appendRow(row.map(toCellText));
      rowCount++;
    }
    const position: PagePosition = {
      offset: 0,
      pageSize: rowCount,
      hasMore: false,
      nextToken: null,
      prevToken: null,
      strategy: 'offset',
    };
    return builder.finish(position);
  } catch (err) {
    throw mapError(err);
  }
}

export function execute(h: SqliteHandle, ctx: OpCtx, statements: string[]): TabularPage[] {
  if (statements.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  // One op-log row for the whole batch (P5 D9's precedent), not one per statement.
  ctx.setCommand(statements.join(';\n'));

  const pages: TabularPage[] = [];
  for (const sql of statements) {
    checkNotCancelled(ctx);
    // D3: a user's own console statement can touch real table data just as easily as the read
    // path can.
    const stmt = prepareOne(h, sql, { readBigInts: true });
    pages.push(runOneStatement(stmt));
  }
  return pages;
}
