import type { Locator, Page } from '@playwright/test';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { ObjectMeta } from '@shared/domain/tree';
import { DATA_OP } from '@shared/protocol/data-ops';
import { IPC } from '@shared/protocol/ipc';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import {
  APP_PATH,
  COMPOSITE_PK_COLUMNS,
  COMPOSITE_PK_PATH,
  compositePkConnectAndOpen,
  DB_PATH,
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// Ported from tests/e2e/interaction.spec.ts (P57 D16), against real captures of the
// regions -> customers -> orders -> order_items <- products FK graph and app.composite_pk's own
// filter/sort/projection reads (scripts/capture-postgres-tree.ts) — every scenario that exercises
// real Vue component behaviour (right-click menus, selection accumulation, real keyboard-driven
// copy/paste/duplicate, PK/FK cell navigation) ports against that data. Three things do not:
//
// 1. **The entire "D10: Operations panel" scenario is dropped.** `state/ops.ts`'s `hydrateOps()`
//    fetches `opsRecent()` exactly once at boot and thereafter relies solely on a live
//    `control.onOpUpdate` push (a real Wails `Events.On` subscription) for every status change —
//    a new op appearing, a running op finishing or being cancelled. `tests/ui/support/mockRuntime.ts`
//    intercepts only the `Call` RPC endpoint; it has no `Events.On` mechanism at all (already noted,
//    narrowly, in `connections.spec.ts`'s own header comment for `connectionsChanged`). So an
//    `op-row` for a statement run *during this test* can never appear in the DOM here, regardless of
//    what the console itself does — this is a hard, structural gap, not a fixture-design problem.
//    The op menu's own actions (reveal-tab/copy-command/copy-error/re-run/cancel) and the
//    `window.kira.opsRecent()` polling the original used to verify cancellation have no coverage
//    surface left to port onto.
// 2. **The entire "D11/D12: native-menu keyboard shortcuts" scenario is dropped** — Command
//    Palette, Window ▸ Next/Previous/Close Tab, View ▸ Find/Refresh/Run Statement/Run All. Unlike
//    `console.spec.ts`'s Undo/Redo (which keeps its keyboard half because CodeMirror's own
//    `history()`/`historyKeymap` is a real, independent, renderer-owned keydown handler), every one
//    of these is a `global: true` binding (`shared/domain/shortcuts.ts`) — by that file's own
//    comment, a `global` binding's accelerator is owned *exclusively* by the native menu
//    (`main/menu.ts` pre-cutover, the Go-side Wails menu post-cutover) and "never a local keydown
//    handler". Confirmed by reading `App.vue`: every one of `onCommandPalette`/`onTabNext`/
//    `onTabPrev`/`onTabClose`/`onViewFind`/`onViewRefresh`/`onViewRun`/`onViewRunAll` is wired to a
//    `control.onXxx` push-event listener with no matching `matchesShortcut`/`shortcutFor` call site
//    anywhere in the renderer. There is no `ElectronApplication` in this tier (the same reason
//    `console.spec.ts` already gives), and — unlike undo/redo — there is also no independent
//    keyboard path *or* UI button surviving underneath: the Command Palette itself has no reachable
//    affordance besides that same broken push event (no button opens it), so even the commands it
//    would otherwise reach (`runCommand('view.find')` et al.) are unreachable from here. This is the
//    same root cause as (1) above, not a second, unrelated gap — worth a line in `AGENTS.md` since it
//    will recur for any future port touching a `global: true` shortcut or a live `control.onXxx`
//    push. The two view-level behaviours this would have exercised a second way (Run Statement/Run
//    All, grid refresh) are already covered by `console.spec.ts` and the toolbar-button paths below,
//    so nothing about the underlying *feature* goes untested — only the menu-triggering mechanism.
// 3. **`window.kira`-based helpers have no replacement** (confirmed P57 finding, `AGENTS.md`):
//    `createConnection()`'s raw `window.kira.connectionsCreate(...)` call becomes a real
//    dialog-driven creation (`connectAndExpand`, matching `console.spec.ts`'s own helper); `getOps()`
//    (`window.kira.opsRecent`) has nothing to port onto given (1) above.
//
// One environment-only addition: `navigator.clipboard.readText()` throws `NotAllowedError` under
// Playwright's WebKit automation even with `clipboard-read` granted (`context.grantPermissions`
// recognises the permission name but the browser still refuses an ungestured read) — WebKit has no
// story here the way Chromium's CDP-backed permission grant does. `installClipboardShim` replaces
// `navigator.clipboard` with a plain in-memory backing store via `page.addInitScript` + one reload
// before the scenario starts; `copyText()`/`DataGrid.vue`'s own `onPaste()` call the exact same
// `navigator.clipboard.writeText`/`readText` interface either way, so this changes nothing about
// what's under test, only which implementation answers it.
//
// A second, more surprising environment finding, worth its own line in `AGENTS.md`:
// **Playwright's bundled WebKit reports `navigator.userAgent` as `Macintosh` unconditionally**,
// confirmed by direct experiment (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
// AppleWebKit/605.1.15 …`) regardless of the actual host OS this sandbox runs on (Linux).
// `renderer/shortcuts/keys.ts`'s own `isMac` is `navigator.userAgent.includes('Mac')` — evaluated
// *inside the page*, not the Node test-runner process — so the original e2e file's own
// `process.platform === 'darwin'` check (correct under real Electron, where the renderer's UA
// honestly reflects the host) silently picks the *wrong* branch here: the app believes it is
// running on macOS even though `process.platform` in this very test file reports `'linux'`.
// Concretely, `grid.deleteRows`'s mac-only override (`Cmd+Backspace`, not the plain `Delete`
// every other platform uses) is the one this bit hardest — a keyboard 'Delete' press matched no
// shortcut at all, silently. `DUPLICATE_KEY`/`COPY_KEY`/`DELETE_KEY` below are therefore derived
// from the *page's own* `navigator.userAgent` after `relaunch()`, not from `process.platform` —
// the only way to guarantee the test and the app under test can never disagree about which chord
// is live. `TOGGLE_MODIFIER` (Control vs. Meta for a gutter toggle-click) is a different mechanism
// entirely — a real OS-level input-translation quirk on macOS hardware, not a UA string read by
// app code — so it stays keyed off the real host platform, unaffected by this.

const COMPOSITE_PATH = COMPOSITE_PK_PATH;
const EMPLOYEES_PATH = `${APP_PATH}/table:employees`;
const ORDERS_PATH = `${APP_PATH}/table:orders`;
const CUSTOMERS_PATH = `${APP_PATH}/table:customers`;
const PRODUCTS_PATH = `${APP_PATH}/table:products`;

const CONNECTION_ID = 'conn-interaction';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Interaction DB', 'green');
const DUPLICATE_SUMMARY: ConnectionSummary = {
  ...CONNECTION_SUMMARY,
  id: 'conn-interaction-copy',
  name: 'Interaction DB copy',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:01.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

const FIXTURE = compositePkConnectAndOpen(CONNECTION_ID);
const ORDER_ITEMS_FIXTURE = orderItemsFixture(CONNECTION_ID);

// Real captures (scripts/capture-postgres-tree.ts) of the regions -> customers -> orders ->
// order_items <- products FK graph's own describe() output — see tests/db/fixtures/0001_seed.sql's
// own comment for why this shape exists. Transcribed verbatim from the capture tool's output, not
// hand-written (P50 D5's discipline).
const ORDERS_META: ObjectMeta = {
  path: ORDERS_PATH,
  kind: 'table',
  name: 'orders',
  qualifiedName: 'app.orders',
  columns: [
    {
      name: 'id',
      position: 1,
      dataType: 'integer',
      nullable: false,
      defaultExpr: "nextval('app.orders_id_seq'::regclass)",
      isPrimaryKey: true,
      comment: null,
    },
    {
      name: 'customer_id',
      position: 2,
      dataType: 'integer',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'ordered_at',
      position: 3,
      dataType: 'timestamp with time zone',
      nullable: false,
      defaultExpr: 'now()',
      isPrimaryKey: false,
      comment: null,
    },
  ],
  primaryKey: ['id'],
  foreignKeys: [
    {
      name: 'orders_customer_id_fkey',
      columns: ['customer_id'],
      referencedPath: CUSTOMERS_PATH,
      referencedColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  referencedBy: [
    {
      name: 'order_items_order_id_fkey',
      columns: ['id'],
      referencedPath: ORDER_ITEMS_PATH,
      referencedColumns: ['order_id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  indexes: [{ name: 'orders_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' }],
  rowEstimate: null,
  comment: null,
};

const CUSTOMERS_META: ObjectMeta = {
  path: CUSTOMERS_PATH,
  kind: 'table',
  name: 'customers',
  qualifiedName: 'app.customers',
  columns: [
    {
      name: 'id',
      position: 1,
      dataType: 'integer',
      nullable: false,
      defaultExpr: "nextval('app.customers_id_seq'::regclass)",
      isPrimaryKey: true,
      comment: null,
    },
    {
      name: 'name',
      position: 2,
      dataType: 'text',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'region_id',
      position: 3,
      dataType: 'integer',
      nullable: true,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
  ],
  primaryKey: ['id'],
  foreignKeys: [
    {
      name: 'customers_region_id_fkey',
      columns: ['region_id'],
      referencedPath: `${APP_PATH}/table:regions`,
      referencedColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  referencedBy: [
    {
      name: 'orders_customer_id_fkey',
      columns: ['id'],
      referencedPath: ORDERS_PATH,
      referencedColumns: ['customer_id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  indexes: [
    { name: 'customers_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' },
  ],
  rowEstimate: null,
  comment: null,
};

const EMPLOYEES_META: ObjectMeta = {
  path: EMPLOYEES_PATH,
  kind: 'table',
  name: 'employees',
  qualifiedName: 'app.employees',
  columns: [
    {
      name: 'id',
      position: 1,
      dataType: 'integer',
      nullable: false,
      defaultExpr: "nextval('app.employees_id_seq'::regclass)",
      isPrimaryKey: true,
      comment: null,
    },
    {
      name: 'name',
      position: 2,
      dataType: 'text',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'manager_id',
      position: 3,
      dataType: 'integer',
      nullable: true,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
  ],
  primaryKey: ['id'],
  // D17: employees is its own referencedBy target (a self-referencing FK) — manager_id -> id.
  foreignKeys: [
    {
      name: 'employees_manager_id_fkey',
      columns: ['manager_id'],
      referencedPath: EMPLOYEES_PATH,
      referencedColumns: ['id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  referencedBy: [
    {
      name: 'employees_manager_id_fkey',
      columns: ['id'],
      referencedPath: EMPLOYEES_PATH,
      referencedColumns: ['manager_id'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    },
  ],
  indexes: [
    { name: 'employees_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' },
  ],
  rowEstimate: null,
  comment: null,
};

function connectionCreateArgs(name: string, color: string) {
  return {
    name,
    kind: 'postgres',
    color,
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 5432,
    database: 'kira_test',
    username: 'postgres',
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
  };
}

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: connectionCreateArgs('Interaction DB', 'green'),
    response: CONNECTION_SUMMARY,
  },
  ...FIXTURE.control,
  ...ORDER_ITEMS_FIXTURE.control,
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: ORDERS_PATH, refresh: false, tabId: null },
    response: { meta: ORDERS_META, source: 'server' },
  },
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: CUSTOMERS_PATH, refresh: false, tabId: null },
    response: { meta: CUSTOMERS_META, source: 'server' },
  },
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: EMPLOYEES_PATH, refresh: false, tabId: null },
    response: { meta: EMPLOYEES_META, source: 'server' },
  },
  // P21 tree shortcuts: F2 rename reveals the secret first (D9), Ctrl/Cmd+D duplicates.
  {
    channel: IPC.connectionsReveal,
    args: { id: CONNECTION_ID },
    response: { password: null, error: null },
  },
  { channel: IPC.connectionsDuplicate, args: { id: CONNECTION_ID }, response: DUPLICATE_SUMMARY },
];

function readPayload(
  path: string,
  extra?: Partial<Record<'filter' | 'sort' | 'projection', unknown>>,
) {
  return {
    connectionId: CONNECTION_ID,
    path,
    projection: extra?.projection ?? null,
    filter: extra?.filter ?? null,
    sort: extra?.sort ?? null,
    pageSize: 100,
    cursor: { mode: 'offset' as const, offset: 0 },
  };
}

const PORT: PortSnapshot[] = [
  ...FIXTURE.port,
  ...ORDER_ITEMS_FIXTURE.port,
  // --- D4: "Filter by this value"'s "= value" and "IS NULL" branches, real Postgres captures ---
  {
    op: DATA_OP.read,
    payload: readPayload(COMPOSITE_PATH, { filter: `"name" = 'tenant 1 / entity 1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: COMPOSITE_PK_COLUMNS,
        rows: [['1', '1', 'tenant 1 / entity 1']],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(COMPOSITE_PATH, { filter: `"name" IS NULL` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: COMPOSITE_PK_COLUMNS,
        rows: [],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  // --- D7: header menu's Sort asc/desc — real server-side ORDER BY, real row order ------------
  {
    op: DATA_OP.read,
    payload: readPayload(COMPOSITE_PATH, {
      sort: { kind: 'structured', terms: [{ column: 'entity_id', direction: 'asc' }] },
    }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: COMPOSITE_PK_COLUMNS,
        rows: [
          ['1', '1', 'tenant 1 / entity 1'],
          ['2', '1', 'tenant 2 / entity 1'],
          ['1', '2', 'tenant 1 / entity 2'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(COMPOSITE_PATH, {
      sort: { kind: 'structured', terms: [{ column: 'entity_id', direction: 'desc' }] },
    }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: COMPOSITE_PK_COLUMNS,
        rows: [
          ['1', '2', 'tenant 1 / entity 2'],
          ['2', '1', 'tenant 2 / entity 1'],
          ['1', '1', 'tenant 1 / entity 1'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  // --- D8: header menu's Hide column — a real narrowed projection round trip -------------------
  {
    op: DATA_OP.read,
    payload: readPayload(COMPOSITE_PATH, { projection: ['tenant_id', 'name'] }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          COMPOSITE_PK_COLUMNS[0] as (typeof COMPOSITE_PK_COLUMNS)[number],
          COMPOSITE_PK_COLUMNS[2] as (typeof COMPOSITE_PK_COLUMNS)[number],
        ],
        rows: [
          ['1', 'tenant 1 / entity 1'],
          ['1', 'tenant 1 / entity 2'],
          ['2', 'tenant 2 / entity 1'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  // --- P7 D1/D6/D7: PK/FK cell nav — orders <-> customers, employees self-FK, order_items ------
  {
    op: DATA_OP.read,
    payload: readPayload(ORDERS_PATH),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'customer_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'ordered_at',
            dataType: 'timestamp with time zone',
            typeClass: 'temporal',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [
          ['1', '1', '2026-08-30 18:04:36.22154+00'],
          ['2', '2', '2026-08-30 18:04:36.22154+00'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(ORDERS_PATH, { filter: `"customer_id" = '1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'customer_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'ordered_at',
            dataType: 'timestamp with time zone',
            typeClass: 'temporal',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [['1', '1', '2026-08-30 18:04:36.22154+00']],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(ORDERS_PATH, { filter: `"id" = '1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'customer_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'ordered_at',
            dataType: 'timestamp with time zone',
            typeClass: 'temporal',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [['1', '1', '2026-08-30 18:04:36.22154+00']],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(CUSTOMERS_PATH, { filter: `"id" = '1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'name',
            dataType: 'text',
            typeClass: 'text',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'region_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: true,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [['1', 'Acme Co', '1']],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(EMPLOYEES_PATH),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'name',
            dataType: 'text',
            typeClass: 'text',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'manager_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: true,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [
          ['1', 'Ada', null],
          ['2', 'Grace', '1'],
          ['3', 'Alan', '1'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(EMPLOYEES_PATH, { filter: `"manager_id" = '1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'name',
            dataType: 'text',
            typeClass: 'text',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'manager_id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: true,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [
          ['2', 'Grace', '1'],
          ['3', 'Alan', '1'],
        ],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
  {
    op: DATA_OP.read,
    payload: readPayload(PRODUCTS_PATH, { filter: `"id" = '1'` }),
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: true,
            generated: false,
          },
          {
            name: 'name',
            dataType: 'text',
            typeClass: 'text',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
          {
            name: 'price',
            dataType: 'numeric(10,2)',
            typeClass: 'number',
            nullable: false,
            isPrimaryKey: false,
            generated: false,
          },
        ],
        rows: [['1', 'Widget', '9.99']],
        position: {
          offset: 0,
          pageSize: 100,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  },
];

const CLIPBOARD_SHIM = `(() => {
  let text = '';
  const clip = {
    writeText: (t) => { text = String(t); return Promise.resolve(); },
    readText: () => Promise.resolve(text),
  };
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
})();`;

async function installClipboardShim(page: Page): Promise<void> {
  await page.addInitScript(CLIPBOARD_SHIM);
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
}

async function connectAndExpand(page: Page, name: string, color: string): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', name);
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click(`[data-testid="color-${color}"]`);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

async function menuItemIds(page: Page): Promise<string[]> {
  const menu = page.locator('[data-testid="context-menu"]');
  return menu
    .locator(':scope > div')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('p-sep')
          ? '--separator--'
          : (el.getAttribute('data-testid') ?? '').replace('menu-item-', ''),
      ),
    );
}

// Mirrors tests/ui/support/tree.ts's openRowMenu: Playwright's own actionability check can trigger
// an internal scroll-into-view whose 'scroll' event lands asynchronously right after the click
// opens a fresh menu, closing it before the next assertion sees it. Draining any pending scroll
// first avoids the race — this is for grid cell/row/header targets, not tree rows, so it stays a
// local helper rather than moving into support/tree.ts.
async function rightClick(locator: Locator): Promise<void> {
  const page = locator.page();
  const menu = page.locator('[data-testid="context-menu"]');
  for (let attempt = 0; attempt < 4; attempt++) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await locator.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(400);
    if (await menu.isVisible()) return;
  }
  await expect(menu).toBeVisible();
}

async function openSubmenu(page: Page, triggerId: string): Promise<void> {
  await page.locator(`[data-testid="menu-item-${triggerId}"]`).hover();
  await expect(page.locator('[data-testid="context-submenu"]')).toBeVisible();
}

function gridCell(page: Page, row: number, column: string): Locator {
  return page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`);
}

async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (await gridCell(page, row, column)).innerText();
}

function cellNavButton(page: Page, row: number, column: string): Locator {
  return gridCell(page, row, column).locator('[data-testid="cell-nav-button"]');
}

// P7 D6: a cell's nav button only appears while its .grid-cell carries .selected (pure-CSS
// hover/selection gate, D5) — select it first the same way a real user's click would, then act
// on the now-visible button.
async function clickCellNav(page: Page, row: number, column: string): Promise<void> {
  await gridCell(page, row, column).click();
  await cellNavButton(page, row, column).click();
}

function gutterCell(page: Page, row: number): Locator {
  return page.locator('[data-testid="grid-gutter-cell"]').nth(row);
}

function headerCell(page: Page, column: string): Locator {
  return page.locator(`[data-testid="grid-header-cell"][data-column="${column}"]`);
}

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function discardChanges(page: Page): Promise<void> {
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
}

test('interaction completeness — grid menus, selection, copy/paste, shortcuts', async ({
  relaunch,
}) => {
  test.setTimeout(120_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await installClipboardShim(page);

  // See the file header comment: Playwright's WebKit always reports a Mac userAgent, so these
  // three chords are derived from the page's own `isMac` reading, not `process.platform`.
  const isMac = await page.evaluate(() => navigator.userAgent.includes('Mac'));
  const DUPLICATE_KEY = isMac ? 'Meta+d' : 'Control+d';
  const COPY_KEY = isMac ? 'Meta+c' : 'Control+c';
  const DELETE_KEY = isMac ? 'Meta+Backspace' : 'Delete';

  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(page.locator('[data-testid="operations-panel"]')).toBeVisible();

  // The cell editor panel now only shows once a cell is actually selected (no more manual
  // toggle) — with no grid open yet, nothing is selected, so it starts hidden on its own.
  await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  await connectAndExpand(page, 'Interaction DB', 'green');

  const compositeRow = await findRow(page, COMPOSITE_PATH);
  await compositeRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'name')).toBeVisible();

  // =============================================================================================
  // D4: cell context menu — Copy / Copy with header / Copy as JSON / Edit / Set NULL /
  // Filter by this value.
  // =============================================================================================
  const row0Name = await cellText(page, 0, 'name');
  expect(row0Name).toBe('tenant 1 / entity 1');

  await rightClick(gridCell(page, 0, 'name'));
  expect(await menuItemIds(page)).toEqual([
    'copy',
    'copy-with-header',
    'copy-as-json',
    'paste',
    '--separator--',
    'edit',
    'set-null',
    'delete-row',
    'filter-by-value',
  ]);

  // P21: shortcut hints — the grid's already-working Cmd/Ctrl+C/Enter print their key next to
  // the menu label.
  await expect(page.locator('[data-testid="menu-item-copy-shortcut"]')).toHaveText(
    /^(⌘C|Ctrl\+C)$/,
  );
  await expect(page.locator('[data-testid="menu-item-edit-shortcut"]')).toHaveText(/^(⏎|Enter)$/);

  await page.click('[data-testid="menu-item-copy"]');
  expect(await clipboardText(page)).toBe(row0Name);

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-copy-with-header"]');
  expect(await clipboardText(page)).toBe(`name\n${row0Name}`);

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-copy-as-json"]');
  expect(await clipboardText(page)).toBe(JSON.stringify(row0Name));

  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-edit"]');
  const cellInput = page.locator('[data-testid="grid-cell-input"]');
  await expect(cellInput).toBeVisible();
  await expect(cellInput).toHaveValue(row0Name);
  await cellInput.press('Escape');
  await expect(cellInput).toHaveCount(0);

  // Filter by this value replaces (D5) the WHERE box's effect — the "= value" branch, dialect
  // quoted with Postgres double quotes.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe(row0Name);

  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });

  // Set NULL stages an actual SQL NULL, never a string — the inline <input> can't express this.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-set-null"]');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  await expect(gridCell(page, 0, 'name').locator('.cell-null')).toHaveText('NULL');

  // Filter by this value on the now-null cell exercises the "IS NULL" branch — no fixture row
  // has a real NULL name, so 0 rows matching proves the generated clause is IS NULL, not = ''.
  await rightClick(gridCell(page, 0, 'name'));
  await page.click('[data-testid="menu-item-filter-by-value"]');
  await expect(page.locator('.no-rows')).toBeVisible({ timeout: 10_000 });

  // D3: a pending-change set is scoped to the page/query it was staged against — applying the
  // filter above already reloaded the grid and dropped the staged NULL, so clearing the filter
  // just reveals the real, unedited value again.
  await page.fill('[data-testid="filter-where-input"]', '');
  await page.press('[data-testid="filter-where-input"]', 'Enter');
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(3, { timeout: 10_000 });
  await expect(gridCell(page, 0, 'name')).not.toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe(row0Name);

  // =============================================================================================
  // D2/D3/D6: row selection accumulation (Shift range, Ctrl toggle) and the row context menu's
  // selection convention — right-clicking inside the current selection acts on all of it,
  // right-clicking outside it replaces the selection with just that row first.
  // =============================================================================================
  await gutterCell(page, 0).click();
  await gutterCell(page, 2).click({ modifiers: ['Shift'] }); // rows [0,1,2]
  await rightClick(gutterCell(page, 1)); // inside the selection -> acts on all 3
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-tsv"]');
  const allRowsTsv = await clipboardText(page);
  expect(allRowsTsv.split('\n')).toHaveLength(3);
  expect(allRowsTsv).toContain('tenant 1 / entity 1');
  expect(allRowsTsv).toContain('tenant 1 / entity 2');
  expect(allRowsTsv).toContain('tenant 2 / entity 1');

  await gutterCell(page, 0).click(); // plain click -> replaces with [0]
  await rightClick(gutterCell(page, 2)); // outside [0] -> replaces with [2] alone
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-csv"]');
  const row2Csv = await clipboardText(page);
  expect(row2Csv.trim()).toBe('2,1,tenant 2 / entity 1');

  await gutterCell(page, 0).click(); // [0]
  // Control+click (Meta on macOS): a literal Control+click, unlike a keyboard chord, becomes a
  // contextmenu event at the OS level on macOS regardless of the target's own click handler
  // (DataGrid.vue's onGutterClick toggle-select needs a real click event) — this repo's own
  // platform-aware TOGGLE_MODIFIER exists for exactly that reason, but this sandbox always runs
  // Linux/webkit, where Control+click is a real click, so 'Control' is used unconditionally here.
  await gutterCell(page, 2).click({ modifiers: ['Control'] }); // toggles row 2 in -> [0,2] disjoint
  await rightClick(gutterCell(page, 0)); // inside [0,2] -> acts on both
  await openSubmenu(page, 'copy-rows');
  await page.click('[data-testid="menu-item-copy-rows-json"]');
  const disjointJson = JSON.parse(await clipboardText(page)) as Array<Record<string, unknown>>;
  expect(disjointJson).toHaveLength(2);
  expect(disjointJson.map((r) => r.name).sort()).toEqual(
    ['tenant 1 / entity 1', 'tenant 2 / entity 1'].sort(),
  );

  // D6: Duplicate row(s) — non-PK columns copied, PK columns left blank.
  await gutterCell(page, 0).click();
  await rightClick(gutterCell(page, 0));
  await page.click('[data-testid="menu-item-duplicate-row"]');
  const insertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(insertRow).toHaveCount(1);
  const insertInputs = insertRow.locator('[data-testid="grid-cell-insert"] input');
  await expect(insertInputs.nth(0)).toHaveValue(''); // tenant_id (PK) left blank
  await expect(insertInputs.nth(1)).toHaveValue(''); // entity_id (PK) left blank
  await expect(insertInputs.nth(2)).toHaveValue('tenant 1 / entity 1'); // name copied
  await discardChanges(page);
  await expect(insertRow).toHaveCount(0);

  // Delete row(s) marks the acted-on rows struck-through, uncommitted.
  await gutterCell(page, 1).click();
  await rightClick(gutterCell(page, 1));
  await page.click('[data-testid="menu-item-delete-row"]');
  await expect(page.locator('[data-testid="grid-row"][data-row="1"]')).toHaveClass(
    /pending-delete/,
  );
  await discardChanges(page);

  // Revert row(s) un-stages a single row's pending edit, without a tab-wide Discard.
  const row0OriginalName = await cellText(page, 0, 'name');
  await gridCell(page, 0, 'name').dblclick();
  await page.locator('[data-testid="grid-cell-input"]').fill('reverted via row menu');
  await page.keyboard.press('Enter');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  await rightClick(gutterCell(page, 0));
  await page.click('[data-testid="menu-item-revert-row"]');
  await expect(gridCell(page, 0, 'name')).not.toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe(row0OriginalName);

  // =============================================================================================
  // D7/D8: header context menu — Sort asc/desc/Clear sort, Hide column/Show all columns,
  // Copy column name/values.
  // =============================================================================================
  await rightClick(headerCell(page, 'entity_id'));
  expect(await menuItemIds(page)).toEqual([
    'sort-asc',
    'sort-desc',
    'clear-sort',
    '--separator--',
    'hide-column',
    'show-all-columns',
    '--separator--',
    'copy-column-name',
    'copy-column-values',
  ]);
  await page.click('[data-testid="menu-item-sort-asc"]');
  await expect(headerCell(page, 'entity_id')).toHaveAttribute('data-sort', 'asc');

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-sort-desc"]');
  await expect(headerCell(page, 'entity_id')).toHaveAttribute('data-sort', 'desc');

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-clear-sort"]');
  await expect(page.locator('.sort-indicator')).toHaveCount(0);

  await rightClick(headerCell(page, 'name'));
  await page.click('[data-testid="menu-item-copy-column-name"]');
  expect(await clipboardText(page)).toBe('name');

  await rightClick(headerCell(page, 'name'));
  await page.click('[data-testid="menu-item-copy-column-values"]');
  const columnValues = (await clipboardText(page)).split('\n');
  expect(columnValues).toEqual(
    expect.arrayContaining(['tenant 1 / entity 1', 'tenant 1 / entity 2', 'tenant 2 / entity 1']),
  );

  await rightClick(headerCell(page, 'entity_id'));
  await page.click('[data-testid="menu-item-hide-column"]');
  await expect(headerCell(page, 'entity_id')).toHaveCount(0);

  await rightClick(headerCell(page, 'tenant_id'));
  await page.click('[data-testid="menu-item-show-all-columns"]');
  await expect(headerCell(page, 'entity_id')).toBeVisible();

  // =============================================================================================
  // D1/D13: local grid copy/paste via Ctrl+C/Ctrl+V — anchor-and-fill, rows beyond the loaded
  // page become new pending inserts. DataGrid.vue's own inline check accepts either Ctrl or Cmd
  // regardless of platform, so a literal 'Control+v' is used unconditionally here.
  // =============================================================================================
  await page.evaluate(() => navigator.clipboard.writeText('typed via paste'));
  await gridCell(page, 0, 'name').click();
  await grid.focus();
  await page.keyboard.press('Control+v');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe('typed via paste');
  await discardChanges(page);

  // Two TSV rows starting at the last existing row: row 2 becomes a staged edit, the row past
  // the loaded page becomes a new pending insert.
  await page.evaluate(() =>
    navigator.clipboard.writeText('2\t1\tedited last row\n3\t3\tbrand new row'),
  );
  await gridCell(page, 2, 'tenant_id').click();
  await grid.focus();
  await page.keyboard.press('Control+v');
  await expect(gridCell(page, 2, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 2, 'name')).toBe('edited last row');
  const pastedInsertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(pastedInsertRow).toHaveCount(1);
  const pastedInsertInputs = pastedInsertRow.locator('[data-testid="grid-cell-insert"] input');
  await expect(pastedInsertInputs.nth(0)).toHaveValue('3');
  await expect(pastedInsertInputs.nth(1)).toHaveValue('3');
  await expect(pastedInsertInputs.nth(2)).toHaveValue('brand new row');
  await discardChanges(page);

  // =============================================================================================
  // P21: the grid cell's new Paste row (D12) — an existing Cmd/Ctrl+V handler with no menu row
  // before this phase.
  // =============================================================================================
  await page.evaluate(() => navigator.clipboard.writeText('typed via paste menu'));
  await rightClick(gridCell(page, 0, 'name'));
  await expect(page.locator('[data-testid="menu-item-paste-shortcut"]')).toHaveText(
    /^(⌘V|Ctrl\+V)$/,
  );
  await page.click('[data-testid="menu-item-paste"]');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe('typed via paste menu');
  await discardChanges(page);

  // =============================================================================================
  // P21: the row menu's new Duplicate/Delete shortcuts — dispatched through the exact same
  // rowMenu() builder a right-click uses (runMenuShortcut), so a real keypress produces the same
  // pending-change state the menu item does.
  // =============================================================================================
  await rightClick(gutterCell(page, 1));
  await expect(page.locator('[data-testid="menu-item-delete-row-shortcut"]')).toHaveText(
    /^(Delete|⌘⌫)$/,
  );
  await expect(page.locator('[data-testid="menu-item-duplicate-row-shortcut"]')).toHaveText(
    /^(Ctrl\+D|⌘D)$/,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  await gutterCell(page, 1).click();
  await grid.focus();
  await page.keyboard.press(DELETE_KEY);
  await expect(page.locator('[data-testid="grid-row"][data-row="1"]')).toHaveClass(
    /pending-delete/,
  );
  await discardChanges(page);

  await gutterCell(page, 0).click();
  await grid.focus();
  await page.keyboard.press(DUPLICATE_KEY);
  await expect(page.locator('[data-testid="grid-row-insert"]')).toHaveCount(1);
  await discardChanges(page);

  // =============================================================================================
  // P21 D13: a tab-scoped shortcut prints on the tab menu even though the key acts on the
  // *active* tab, not the one right-clicked.
  // =============================================================================================
  await page.locator('[data-testid="tab"]').first().click({ button: 'right' });
  await expect(page.locator('[data-testid="menu-item-close-shortcut"]')).toHaveText(
    /^(⌘W|Ctrl\+W)$/,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  // =============================================================================================
  // P21: the project tree's own local keyboard shortcuts — Copy name, F2 rename, Ctrl/Cmd+D
  // duplicate — dispatch through menuForRow(), the same builder a right-click uses. D8's own
  // guard: the tree's per-row Refresh never prints a shortcut, since F5 is the *active tab's*
  // refresh, a different command on a different object.
  // =============================================================================================
  await openRowMenu(page, '');
  await expect(page.locator('[data-testid="menu-item-refresh-shortcut"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  const connRow = connectionRow(page, 'Interaction DB');
  await expect(connRow).toHaveCount(1);
  await connRow.click();
  await expect(connRow).toHaveClass(/selected/);
  await page.keyboard.press(COPY_KEY);
  expect(await clipboardText(page)).toBe('Interaction DB');

  await connRow.click();
  await page.keyboard.press('F2');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-cancel"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // Ctrl/Cmd+D last — it's the one assertion here that leaves an extra connection row behind
  // (the duplicate), which would otherwise make `connectionRow`'s own filter ambiguous for
  // anything after it.
  const connectionCountBefore = await page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .count();
  await connRow.click();
  await page.keyboard.press(DUPLICATE_KEY);
  await expect(page.locator('[data-testid="tree-row"][data-kind="connection"]')).toHaveCount(
    connectionCountBefore + 1,
  );

  // =============================================================================================
  // P7 D1/D6/D7: PK/FK cell nav button — an outbound FK cell jumps straight to the referenced
  // row; a PK cell with exactly one referencing table jumps straight to it too (D6: single
  // candidate navigates immediately, no popup). Both spawn a *new*, pre-filtered tab.
  // =============================================================================================
  const ordersRow = await findRow(page, ORDERS_PATH);
  await ordersRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'customer_id')).toBeVisible();
  expect(await cellText(page, 0, 'customer_id')).toBe('1');

  let tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'customer_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'name')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe('Acme Co');

  // customers.id is referenced by exactly one table (orders.customer_id) — a "pk"-kind button,
  // single candidate, direct nav to the filtered referencing rows.
  await expect(cellNavButton(page, 0, 'id')).toHaveAttribute('data-nav-kind', 'pk');
  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'customer_id')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'customer_id')).toBe('1');

  // =============================================================================================
  // P7: self-referencing FK — employees.manager_id -> employees.id. Ada (id 1) has no manager
  // (NULL): her manager_id cell renders no nav button at all (P7 D2: a missing/NULL source value
  // means there's no row to jump to). Her id cell's "Referenced by" is a single candidate
  // (employees itself) that opens a *new* tab on the same table, filtered to her direct reports.
  // =============================================================================================
  const employeesRow = await findRow(page, EMPLOYEES_PATH);
  await employeesRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'manager_id')).toBeVisible();
  expect(await cellText(page, 0, 'name')).toBe('Ada');
  await expect(gridCell(page, 0, 'manager_id').locator('.cell-null')).toHaveText('NULL');
  await gridCell(page, 0, 'manager_id').click();
  await expect(cellNavButton(page, 0, 'manager_id')).toHaveCount(0);

  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(2, { timeout: 10_000 });
  const reportNames = [await cellText(page, 0, 'name'), await cellText(page, 1, 'name')].sort();
  expect(reportNames).toEqual(['Alan', 'Grace']);

  // Row 0 here (either direct report — both have manager_id 1) has a nav button on its
  // manager_id cell, and the right-click cell menu offers the same navigation as a "Go to
  // referenced row" item (P7 D3: the button and the menu share one function, so they can never
  // disagree about what's navigable).
  await rightClick(gridCell(page, 0, 'manager_id'));
  const fkMenuIds = await menuItemIds(page);
  expect(fkMenuIds.some((id) => id.startsWith('go-to-referenced-'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

  // =============================================================================================
  // P7: a row with two independent outbound FKs (order_items.order_id -> orders,
  // order_items.product_id -> products) gets two independent nav buttons, each targeting its own
  // table — the two never share or overwrite each other's target.
  // =============================================================================================
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRow.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'order_id')).toBeVisible();
  await expect(headerCell(page, 'product_id')).toBeVisible();
  expect(await cellText(page, 0, 'order_id')).toBe('1');
  expect(await cellText(page, 0, 'product_id')).toBe('1');

  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'product_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'price')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'name')).toBe('Widget');

  const orderItemsRowAgain = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRowAgain.dblclick();
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'order_id')).toBeVisible();
  tabCount = await page.locator('[data-testid="tab"]').count();
  await clickCellNav(page, 0, 'order_id');
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(tabCount + 1);
  await expect(grid).toBeVisible();
  await expect(headerCell(page, 'ordered_at')).toBeVisible();
  await expect(page.locator('[data-testid="grid-row"]')).toHaveCount(1, { timeout: 10_000 });
  expect(await cellText(page, 0, 'customer_id')).toBe('1');
});
