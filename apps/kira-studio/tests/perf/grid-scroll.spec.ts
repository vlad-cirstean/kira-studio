import type { ColumnDescriptor, TypeClass } from '@shared/protocol/page';
import {
  attachResults,
  FLICK_LADDER,
  type FlickResult,
  measureFlick,
  RssSampler,
} from '@workbench/testing/ui/perfProbe';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from '../ui/fixtures';
import { connectAndExpand, connectionCreateArgs } from '../ui/support/connect';
import { gridScroller } from '../ui/support/grid';
import { IPC } from '../ui/support/ipcChannels';
import {
  BIG_ROWS_PATH,
  bigRowsFixture,
  bigRowsHugePage,
  postgresConnectionSummary,
} from '../ui/support/postgresFixture';
import { findRow } from '../ui/support/tree';

// Data grid: a 10 000-row page, momentum flicks down and up. Run `bun run perf:probe:studio`.
// NCOLS (default 2, the stock `big_rows` shape) above 2 swaps in a wide page of mixed types.

const NCOLS = Number(process.env.NCOLS ?? 2);
const ROWS = 10_000;

const WIDE_TEMPLATE: {
  name: string;
  dataType: string;
  typeClass: TypeClass;
  cell: (i: number) => string | null;
}[] = [
  { name: 'id', dataType: 'integer', typeClass: 'number', cell: (i) => String(i) },
  {
    name: 'uuid',
    dataType: 'uuid',
    typeClass: 'text',
    cell: (i) =>
      `${i.toString(16).padStart(8, '0')}-0000-4000-8000-${(i * 7919).toString(16).padStart(12, '0')}`,
  },
  {
    name: 'name',
    dataType: 'varchar(80)',
    typeClass: 'text',
    cell: (i) => `Customer number ${i} Ltd`,
  },
  {
    name: 'email',
    dataType: 'text',
    typeClass: 'text',
    cell: (i) => (i % 13 === 0 ? null : `user${i}@example-mail.com`),
  },
  { name: 'qty', dataType: 'smallint', typeClass: 'number', cell: (i) => String(i % 900) },
  {
    name: 'big',
    dataType: 'bigint',
    typeClass: 'number',
    cell: (i) => String(9_000_000_000_000 + i * 31),
  },
  {
    name: 'price',
    dataType: 'numeric(20,6)',
    typeClass: 'number',
    cell: (i) => ((i * 37) / 1000).toFixed(6),
  },
  {
    name: 'ratio',
    dataType: 'double precision',
    typeClass: 'number',
    cell: (i) => String(Math.sin(i) * 1000),
  },
  {
    name: 'active',
    dataType: 'boolean',
    typeClass: 'boolean',
    cell: (i) => (i % 2 === 0 ? 'true' : 'false'),
  },
  {
    name: 'created_at',
    dataType: 'timestamptz',
    typeClass: 'temporal',
    cell: (i) => new Date(1_704_067_200_000 + i * 60_000).toISOString(),
  },
  {
    name: 'born',
    dataType: 'date',
    typeClass: 'temporal',
    cell: (i) => new Date(631_152_000_000 + i * 86_400_000).toISOString().slice(0, 10),
  },
  {
    name: 'payload',
    dataType: 'jsonb',
    typeClass: 'json',
    cell: (i) => JSON.stringify({ id: i, tags: ['a', 'b'], nested: { k: i % 5 } }),
  },
  {
    name: 'blob',
    dataType: 'bytea',
    typeClass: 'binary',
    cell: (i) => `0x${(i * 2654435761).toString(16).padStart(16, '0')}`,
  },
  {
    name: 'notes',
    dataType: 'text',
    typeClass: 'text',
    cell: (i) => `Note ${i}: ${'lorem ipsum dolor sit amet '.repeat(3 + (i % 4))}`,
  },
  {
    name: 'country',
    dataType: 'char(2)',
    typeClass: 'text',
    cell: (i) => ['US', 'DE', 'RO', 'JP', 'BR'][i % 5],
  },
  {
    name: 'ip',
    dataType: 'inet',
    typeClass: 'other',
    cell: (i) => `10.${(i >> 8) & 255}.${i & 255}.1`,
  },
  { name: 'score', dataType: 'real', typeClass: 'number', cell: (i) => String((i % 1000) / 7) },
  {
    name: 'status',
    dataType: 'text',
    typeClass: 'text',
    cell: (i) => ['new', 'open', 'closed', 'archived'][i % 4],
  },
  {
    name: 'updated_at',
    dataType: 'timestamp',
    typeClass: 'temporal',
    cell: (i) =>
      new Date(1_714_067_200_000 + i * 90_000).toISOString().replace('T', ' ').slice(0, 19),
  },
  {
    name: 'address',
    dataType: 'text',
    typeClass: 'text',
    cell: (i) => (i % 9 === 0 ? null : `${i} Long Street Name Avenue, Springfield ${i % 99}`),
  },
];

function widePage(connectionId: string): PortSnapshot {
  const cols = WIDE_TEMPLATE.slice(0, NCOLS);
  const columns: ColumnDescriptor[] = cols.map((c, idx) => ({
    name: c.name,
    dataType: c.dataType,
    typeClass: c.typeClass,
    nullable: idx !== 0,
    isPrimaryKey: idx === 0,
    generated: false,
  }));
  const rows = Array.from({ length: ROWS }, (_, i) => cols.map((c) => c.cell(i + 1)));
  const base = bigRowsHugePage(connectionId);
  const response = base.response as unknown as { page: Record<string, unknown> };
  return {
    ...base,
    response: { ...response, page: { ...response.page, columns, rows } },
  } as PortSnapshot;
}

const CONNECTION_ID = 'conn-perf-grid';
const FIXTURE = bigRowsFixture(CONNECTION_ID);
const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: connectionCreateArgs('Perf DB', 'cyan'),
    response: postgresConnectionSummary(CONNECTION_ID, 'Perf DB', 'cyan'),
  },
  ...FIXTURE.control,
];
const PORT: PortSnapshot[] = [
  ...FIXTURE.port,
  NCOLS > 2 ? widePage(CONNECTION_ID) : bigRowsHugePage(CONNECTION_ID),
];

test('perf: data grid, 10k rows, momentum flicks', async ({ relaunch }, info) => {
  test.setTimeout(180_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndExpand(page, 'Perf DB', 'cyan');
  await (await findRow(page, BIG_ROWS_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-10000"]');
  const viewport = gridScroller(page);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(200_000);

  const box = await viewport.boundingBox();
  if (!box) throw new Error('grid viewport has no box');
  await page.mouse.move(box.x + 200, box.y + 200);

  const rss = new RssSampler();
  rss.start();
  const results: FlickResult[] = [];
  for (const { label, opts } of FLICK_LADDER) {
    results.push(await measureFlick(page, rss, label, opts));
  }
  rss.stop();
  await attachResults(info, results);
});
