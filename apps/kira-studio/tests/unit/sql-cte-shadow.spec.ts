// P12 round 2 finding #7: a CTE named after a real DDL table must resolve to the CTE, not the base
// table it shadows — resolveAliasMap (sqlDiagnostics.ts) and resolveHover's qualifier resolution
// (sqlHover.ts) both used to ignore cteNames and fall straight through to findTable, producing a
// false-positive "unknown column" diagnostic (D7: "a false positive is worse than a missing
// diagnostic") and a wrong hover card for entirely valid SQL.
import { describe, expect, test } from 'bun:test';
import { PostgreSQL } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import type { DdlSchema } from '../../frontend/src/views/console/ddl';
import { ddlDiagnostics } from '../../frontend/src/views/console/sqlDiagnostics';
import { sqlHoverSource } from '../../frontend/src/views/console/sqlHover';

const SCHEMA: DdlSchema = {
  tables: [
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'total', type: 'numeric' },
      ],
    },
  ],
};

describe('a CTE shadowing a DDL table name (P12 round 2 F7)', () => {
  test('ddlDiagnostics reports no false-positive unknown column for a CTE-only column', () => {
    const sql = 'WITH orders AS (SELECT 1 AS n) SELECT orders.n FROM orders';
    const issues = ddlDiagnostics(PostgreSQL, sql, SCHEMA);
    expect(issues).toEqual([]);
  });

  // "id" also exists on the base DDL table — a real column name, chosen so a resolution bug
  // that falls through to the base table produces a *wrong* hover card instead of merely no
  // diagnostic (a column name absent from both wouldn't distinguish "correctly resolved to
  // nothing" from "incorrectly resolved to the base table, which also lacks it").
  const sql = 'WITH orders AS (SELECT 1 AS id) SELECT orders.id FROM orders';

  test('sqlHover resolves the qualifier to nothing (the CTE), not the base table', () => {
    const source = sqlHoverSource(PostgreSQL, SCHEMA);
    expect(source).toBeDefined();
    // +1: findLeafAt's inclusive boundary check picks the preceding "." node at the exact
    // boundary, so land one character inside "id" instead.
    const pos = sql.indexOf('orders.id') + 'orders.'.length + 1;
    // A real EditorState with PostgreSQL's own language installed — buildHoverSource (P12 round 2
    // finding #11) now reads `syntaxTree(view.state)` itself, which needs the language's state
    // field actually present, not just a `.doc.toString()` stub.
    const state = EditorState.create({ doc: sql, extensions: [PostgreSQL.language] });
    const view = { state } as unknown as Parameters<NonNullable<typeof source>>[0];
    const tooltip = source?.(view, pos, 1);
    expect(tooltip).toBeNull();
  });
});
