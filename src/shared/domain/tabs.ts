import { z } from 'zod';
import { sortSpecSchema } from './queries';
import { pathTail } from './tree';

export const tabKindSchema = z.enum(['data', 'ddl', 'document', 'keyvalue', 'stream', 'console']);
export type TabKind = z.infer<typeof tabKindSchema>;

// 'data' and 'ddl' are renderable as of P4 (D18); 'console' joins them in P5.5. The restore path
// drops rows of any other kind with a `warn` — a closed vocabulary decided once, same discipline
// as P1's Caps/connectionKind.
export const RENDERABLE_TAB_KINDS: readonly TabKind[] = ['data', 'ddl', 'console'];

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

// Only the editor's own text is session state (§8.4) — the last run's results are runtime-only,
// like `views/ddl/state.ts`'s `ddl` field, and never round-trip through `tabs.save`.
export const consoleTabStateSchema = z.object({
  text: z.string(),
});
export type ConsoleTabState = z.infer<typeof consoleTabStateSchema>;

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
  z.object({ ...tabRecordBase, kind: z.literal('console'), state: consoleTabStateSchema }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
export type DataTabRecord = Extract<TabRecord, { kind: 'data' }>;
export type DdlTabRecord = Extract<TabRecord, { kind: 'ddl' }>;
export type ConsoleTabRecord = Extract<TabRecord, { kind: 'console' }>;

export function asDataTab(tab: TabRecord | null | undefined): DataTabRecord | null {
  return tab && tab.kind === 'data' ? tab : null;
}

export function asConsoleTab(tab: TabRecord | null | undefined): ConsoleTabRecord | null {
  return tab && tab.kind === 'console' ? tab : null;
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

export function defaultConsoleTabState(): ConsoleTabState {
  return { text: '' };
}

/** 'order_items' — the path tail's name; the connection name is rendered separately. */
export function tabTitle(record: TabRecord): string {
  const tail = pathTail(record.path);
  // A console tab's path is often a container (connection root, database, schema) with no tail
  // name worth showing — 'Console' names the tab itself, same as a bare browser new-tab title.
  if (record.kind === 'console') return tail?.name ?? 'Console';
  return tail?.name ?? record.path;
}
