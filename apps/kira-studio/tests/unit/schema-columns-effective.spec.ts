// P22c D4/D6/§4.3: effectiveSchema is the merge rule three console providers (completion,
// diagnostics, hover) all depend on to agree with each other — a hand-authored document wins
// wholesale the moment it has any tables; otherwise the cache fills in; both empty is the empty
// schema. Three cases, no more: the precedence is never a per-table merge (see the module's own
// doc comment for why).
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { DdlSchema } from '../../frontend/src/views/console/ddl';

const { schemaColumnsState, effectiveSchema } = await import(
  '../../frontend/src/state/schemaColumns'
);

const CACHED_RELATIONS = [
  {
    name: 'order_items',
    kind: 'table' as const,
    columns: [
      {
        name: 'id',
        position: 1,
        dataType: 'integer',
        nullable: false,
        defaultExpr: null,
        isPrimaryKey: true,
        comment: null,
      },
    ],
  },
];

const DOCUMENT_SCHEMA: DdlSchema = {
  tables: [{ name: 'widgets', columns: [{ name: 'label', type: 'text' }] }],
};

const EMPTY_DOCUMENT: DdlSchema = { tables: [] };

describe('state/schemaColumns.ts — effectiveSchema (P22c D4/D6)', () => {
  test('a hand-authored document with tables wins wholesale over the cache', () => {
    const key = 'conn-doc-wins|database:app/schema:pub';
    schemaColumnsState.byContainer[key] = CACHED_RELATIONS;
    const schema = effectiveSchema('conn-doc-wins', 'database:app/schema:pub', DOCUMENT_SCHEMA);
    expect(schema).toBe(DOCUMENT_SCHEMA);
    expect(schema.tables.map((t) => t.name)).toEqual(['widgets']);
  });

  test('with no document, the cache fills in as a DdlSchema', () => {
    const key = 'conn-cache-fills|database:app/schema:pub';
    schemaColumnsState.byContainer[key] = CACHED_RELATIONS;
    const schema = effectiveSchema('conn-cache-fills', 'database:app/schema:pub', EMPTY_DOCUMENT);
    expect(schema.tables).toHaveLength(1);
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.name).toBe('order_items');
    expect(table.isView).toBeUndefined();
    expect(table.columns).toEqual([
      { name: 'id', type: 'integer', primaryKey: true, notNull: true, description: undefined },
    ]);
  });

  test('both empty yields the empty schema', () => {
    delete schemaColumnsState.byContainer['conn-both-empty|database:app/schema:pub'];
    const schema = effectiveSchema('conn-both-empty', 'database:app/schema:pub', EMPTY_DOCUMENT);
    expect(schema.tables).toEqual([]);
  });

  test('a view relation is marked isView, a table is not', () => {
    const key = 'conn-view-kind|database:app/schema:pub';
    schemaColumnsState.byContainer[key] = [
      { name: 'order_summary', kind: 'view', columns: [] },
      ...CACHED_RELATIONS,
    ];
    const schema = effectiveSchema('conn-view-kind', 'database:app/schema:pub', EMPTY_DOCUMENT);
    const byName = Object.fromEntries(schema.tables.map((t) => [t.name, t]));
    expect(byName.order_summary?.isView).toBe(true);
    expect(byName.order_items?.isView).toBeUndefined();
  });
});
