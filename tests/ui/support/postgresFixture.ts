import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import { IPC } from '@shared/protocol/ipc';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type { ControlSnapshot, PortSnapshot } from '../../ipc/support/types';

// Real captures against a real Postgres container, seeded with tests/db/fixtures/0001_seed.sql —
// via scripts/capture-postgres-tree.ts, not hand-written (P50 D5's discipline: a hand-written tree
// node once used the wrong `path` shape and was silently rendered rather than rejected). Shared
// across the remaining tests/e2e/*.spec.ts ports that all open the same connect -> expand ->
// table-open path against `app.order_items` (a small, 3-row, 4-column table with two FKs and two
// indexes — enough surface for tree/definition/data-view assertions without a huge fixture).

export const ROOT_CHILDREN = [
  {
    kind: 'database',
    name: 'kira_test',
    path: 'database:kira_test',
    hasChildren: true,
    detail: 'connected',
  },
  { kind: 'database', name: 'postgres', path: 'database:postgres', hasChildren: true },
];

export const DB_CHILDREN = [
  {
    kind: 'schema',
    name: 'analytics',
    path: 'database:kira_test/schema:analytics',
    hasChildren: true,
  },
  { kind: 'schema', name: 'app', path: 'database:kira_test/schema:app', hasChildren: true },
];

const ORDER_ITEMS_COLUMNS: ColumnDescriptor[] = [
  {
    name: 'id',
    dataType: 'integer',
    typeClass: 'number',
    nullable: false,
    isPrimaryKey: true,
    generated: false,
  },
  {
    name: 'order_id',
    dataType: 'integer',
    typeClass: 'number',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  },
  {
    name: 'product_id',
    dataType: 'integer',
    typeClass: 'number',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  },
  {
    name: 'quantity',
    dataType: 'integer',
    typeClass: 'number',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  },
];
const ORDER_ITEMS_ROWS = [
  ['1', '1', '1', '2'],
  ['2', '1', '2', '1'],
  ['3', '2', '1', '5'],
];

export const DB_PATH = 'database:kira_test';
export const APP_PATH = `${DB_PATH}/schema:app`;
export const ORDER_ITEMS_PATH = `${APP_PATH}/table:order_items`;

function orderItemsPage(pageSize: 100 | 1000) {
  return {
    kind: 'tabular' as const,
    columns: ORDER_ITEMS_COLUMNS,
    rows: ORDER_ITEMS_ROWS,
    position: {
      offset: 0,
      pageSize,
      hasMore: false,
      nextToken: null,
      prevToken: null,
      strategy: 'keyset' as const,
    },
    truncatedCells: 0,
  };
}

export const ORDER_ITEMS_META = {
  path: ORDER_ITEMS_PATH,
  kind: 'table' as const,
  name: 'order_items',
  qualifiedName: 'app.order_items',
  columns: [
    {
      name: 'id',
      position: 1,
      dataType: 'integer',
      nullable: false,
      defaultExpr: "nextval('app.order_items_id_seq'::regclass)",
      isPrimaryKey: true,
      comment: null,
    },
    {
      name: 'order_id',
      position: 2,
      dataType: 'integer',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'product_id',
      position: 3,
      dataType: 'integer',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'quantity',
      position: 4,
      dataType: 'integer',
      nullable: false,
      defaultExpr: '1',
      isPrimaryKey: false,
      comment: null,
    },
  ],
  primaryKey: ['id'],
  foreignKeys: [
    {
      name: 'order_items_order_id_fkey',
      columns: ['order_id'],
      referencedPath: `${APP_PATH}/table:orders`,
      referencedColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
    {
      name: 'order_items_product_id_fkey',
      columns: ['product_id'],
      referencedPath: `${APP_PATH}/table:products`,
      referencedColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  referencedBy: [],
  indexes: [
    { name: 'order_items_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' },
    {
      name: 'order_items_order_product_idx',
      columns: ['order_id', 'product_id'],
      unique: true,
      primary: false,
      method: 'btree',
    },
  ],
  rowEstimate: null,
  comment: null,
};

export const POSTGRES_CAPS = {
  tabular: true,
  documents: false,
  keyValue: false,
  stream: false,
  keyBrowser: false,
  defaultPageKind: 'tabular' as const,
  sql: true,
  definition: true,
  describe: true,
  projection: true,
  serverFilter: true,
  exactCount: true,
  pagination: 'keyset' as const,
  foreignKeys: true,
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: true,
  cancel: true,
  fileTransfer: false,
};

const SERVER_VERSION =
  'PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit';

/** A connectable postgres ConnectionSummary, plus the control/data snapshots to connect it, expand
 *  its tree down to `app.order_items`, and open that table at both stock page sizes. Every spec
 *  using this can add its own `connectionsCreate` snapshot (name/color differ per spec) and reuse
 *  everything below unchanged. */
export function orderItemsFixture(connectionId: string): {
  control: ControlSnapshot[];
  port: PortSnapshot[];
} {
  return {
    control: [
      {
        channel: IPC.connectionsConnect,
        args: { id: connectionId },
        response: {
          connectionId,
          status: 'connected',
          serverVersion: SERVER_VERSION,
          error: null,
          since: 1735689600000,
          caps: POSTGRES_CAPS,
        },
      },
      {
        channel: IPC.treeChildren,
        args: { connectionId, path: '', refresh: false },
        response: { nodes: ROOT_CHILDREN, source: 'server', truncated: false },
      },
      {
        channel: IPC.treeChildren,
        args: { connectionId, path: DB_PATH, refresh: false },
        response: { nodes: DB_CHILDREN, source: 'server', truncated: false },
      },
      {
        channel: IPC.treeChildren,
        args: { connectionId, path: APP_PATH, refresh: false },
        response: { nodes: APP_CHILDREN, source: 'server', truncated: false },
      },
      {
        channel: IPC.treeDescribe,
        args: { connectionId, path: ORDER_ITEMS_PATH, refresh: false, tabId: null },
        response: { meta: ORDER_ITEMS_META, source: 'server' },
      },
    ],
    port: [
      {
        op: DATA_OP.read,
        payload: {
          connectionId,
          path: ORDER_ITEMS_PATH,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        response: { kind: 'read', page: orderItemsPage(100), source: 'server' },
      },
      {
        op: DATA_OP.read,
        payload: {
          connectionId,
          path: ORDER_ITEMS_PATH,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 1000,
          cursor: { mode: 'offset', offset: 0 },
        },
        response: { kind: 'read', page: orderItemsPage(1000), source: 'server' },
      },
    ],
  };
}

// database:kira_test/schema:app's own children — the full real capture (every table/view/matview/
// sequence/function `0001_seed.sql` creates), kept here rather than inline in orderItemsFixture()
// so a spec needing to find a *different* table under app (e.g. `composite_pk`) still gets a
// correct, real children list to search rather than one trimmed to what order_items alone needed.
export const APP_CHILDREN = [
  {
    kind: 'table',
    name: 'Order Items',
    path: `${APP_PATH}/table:Order%20Items`,
    hasChildren: false,
  },
  {
    kind: 'table',
    name: 'big_rows',
    path: `${APP_PATH}/table:big_rows`,
    hasChildren: false,
    detail: '~1M rows',
  },
  {
    kind: 'table',
    name: 'composite_pk',
    path: `${APP_PATH}/table:composite_pk`,
    hasChildren: false,
  },
  { kind: 'table', name: 'customers', path: `${APP_PATH}/table:customers`, hasChildren: false },
  { kind: 'table', name: 'employees', path: `${APP_PATH}/table:employees`, hasChildren: false },
  { kind: 'table', name: 'formats', path: `${APP_PATH}/table:formats`, hasChildren: false },
  { kind: 'table', name: 'nested_json', path: `${APP_PATH}/table:nested_json`, hasChildren: false },
  {
    kind: 'table',
    name: 'nulls_and_unicode',
    path: `${APP_PATH}/table:nulls_and_unicode`,
    hasChildren: false,
  },
  { kind: 'table', name: 'order_items', path: ORDER_ITEMS_PATH, hasChildren: false },
  { kind: 'table', name: 'orders', path: `${APP_PATH}/table:orders`, hasChildren: false },
  { kind: 'table', name: 'products', path: `${APP_PATH}/table:products`, hasChildren: false },
  { kind: 'table', name: 'regions', path: `${APP_PATH}/table:regions`, hasChildren: false },
  { kind: 'table', name: 'weird"name', path: `${APP_PATH}/table:weird%22name`, hasChildren: false },
  { kind: 'table', name: 'wide_table', path: `${APP_PATH}/table:wide_table`, hasChildren: false },
  {
    kind: 'view',
    name: 'order_summary',
    path: `${APP_PATH}/view:order_summary`,
    hasChildren: false,
  },
  {
    kind: 'matview',
    name: 'customer_totals',
    path: `${APP_PATH}/matview:customer_totals`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'Order Items_id_seq',
    path: `${APP_PATH}/sequence:Order%20Items_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'customers_id_seq',
    path: `${APP_PATH}/sequence:customers_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'employees_id_seq',
    path: `${APP_PATH}/sequence:employees_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'formats_id_seq',
    path: `${APP_PATH}/sequence:formats_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'invoice_number_seq',
    path: `${APP_PATH}/sequence:invoice_number_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'nested_json_id_seq',
    path: `${APP_PATH}/sequence:nested_json_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'nulls_and_unicode_id_seq',
    path: `${APP_PATH}/sequence:nulls_and_unicode_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'order_items_id_seq',
    path: `${APP_PATH}/sequence:order_items_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'orders_id_seq',
    path: `${APP_PATH}/sequence:orders_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'products_id_seq',
    path: `${APP_PATH}/sequence:products_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'regions_id_seq',
    path: `${APP_PATH}/sequence:regions_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'weird"name_id_seq',
    path: `${APP_PATH}/sequence:weird%22name_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'sequence',
    name: 'wide_table_id_seq',
    path: `${APP_PATH}/sequence:wide_table_id_seq`,
    hasChildren: false,
  },
  {
    kind: 'function',
    name: 'full_name',
    path: `${APP_PATH}/function:full_name`,
    hasChildren: false,
    detail: '(first_name text, last_name text)',
  },
  {
    kind: 'function',
    name: 'noop_procedure',
    path: `${APP_PATH}/function:noop_procedure`,
    hasChildren: false,
    detail: '()',
  },
];

/** A plausible ConnectionSummary for a postgres connection created through the dialog — the
 *  `connectionsCreate` response a spec supplies its own args/name/color for. */
export function postgresConnectionSummary(
  id: string,
  name: string,
  color: ConnectionSummary['color'],
): ConnectionSummary {
  return {
    id,
    name,
    kind: 'postgres',
    color,
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'kira_test',
    username: 'postgres',
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
