import { z } from 'zod';
import { sortSpecSchema } from './queries';
import { pathTail } from './tree';

export const tabKindSchema = z.enum(['data', 'ddl', 'document', 'keyvalue', 'stream', 'console']);
export type TabKind = z.infer<typeof tabKindSchema>;

// 'data' and 'ddl' are renderable as of P4 (D18). The restore path drops rows of any other kind
// with a `warn` — a closed vocabulary decided once, same discipline as P1's Caps/connectionKind.
export const RENDERABLE_TAB_KINDS: readonly TabKind[] = ['data', 'ddl'];

const pageSizeSchema = z.union([z.literal(10), z.literal(100), z.literal(1000), z.literal(10000)]);
export type PageSize = z.infer<typeof pageSizeSchema>;

export const dataTabStateSchema = z.object({
  pageSize: pageSizeSchema,
  pageIndex: z.number().int().min(0), // what the pager shows; offset = pageIndex * pageSize
  filter: z.string().nullable(),
  sort: sortSpecSchema.nullable(),
  projection: z.array(z.string()).nullable(),
  columnWidths: z.record(z.string(), z.number()),
  columnOrder: z.array(z.string()).nullable(),
  scrollTop: z.number(),
  scrollLeft: z.number(),
});
export type DataTabState = z.infer<typeof dataTabStateSchema>;

export const ddlTabStateSchema = z.object({}); // D4: nothing to remember
export type DdlTabState = z.infer<typeof ddlTabStateSchema>;

const tabRecordBase = {
  id: z.string(),
  connectionId: z.string().nullable(),
  path: z.string(), // encoded NodePath, '' for a connection-scoped tab
  order: z.number().int(),
  active: z.boolean(),
};

export const tabRecordSchema = z.discriminatedUnion('kind', [
  z.object({ ...tabRecordBase, kind: z.literal('data'), state: dataTabStateSchema }),
  z.object({ ...tabRecordBase, kind: z.literal('ddl'), state: ddlTabStateSchema }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
export type DataTabRecord = Extract<TabRecord, { kind: 'data' }>;
export type DdlTabRecord = Extract<TabRecord, { kind: 'ddl' }>;

export function asDataTab(tab: TabRecord | null | undefined): DataTabRecord | null {
  return tab && tab.kind === 'data' ? tab : null;
}

export function defaultDataTabState(pageSize: PageSize): DataTabState {
  return {
    pageSize,
    pageIndex: 0,
    filter: null,
    sort: null,
    projection: null,
    columnWidths: {},
    columnOrder: null,
    scrollTop: 0,
    scrollLeft: 0,
  };
}

export function defaultDdlTabState(): DdlTabState {
  return {};
}

/** 'order_items' — the path tail's name; the connection name is rendered separately. */
export function tabTitle(record: TabRecord): string {
  const tail = pathTail(record.path);
  return tail?.name ?? record.path;
}
