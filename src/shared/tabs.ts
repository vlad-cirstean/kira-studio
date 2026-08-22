import { z } from 'zod';
import { pageCursorSchema } from './data';

// Tab and per-tab state (P2 §3.4, D16). A tab is `{ id, connectionId, path, kind, state }`; identity
// is the tab's `id`, never the path — the same table opens any number of times with independent
// paging, projection, sort, filter and scroll state. Persisted to the `tabs` table (D15) and
// Zod-parsed on read-back so a corrupt row fails loudly instead of bricking the strip.

export const dataTabStateSchema = z.object({
  projection: z.array(z.string()).nullable().default(null),
  where: z.string().default(''),
  orderBy: z.string().default(''),
  pageSize: z.number().int().default(500),
  cursor: pageCursorSchema.default({ kind: 'offset', offset: 0 }),
  /** 1-based, for the pager display; derived from `cursor.offset` when it is an offset cursor. */
  pageIndex: z.number().int().min(1).default(1),
  totalRows: z.number().int().nullable().default(null),
  totalExact: z.boolean().default(false),
  columnWidths: z.record(z.string(), z.number()).default({}),
  columnOrder: z.array(z.string()).default([]),
  scrollTop: z.number().default(0),
  scrollLeft: z.number().default(0),
});
export type DataTabState = z.infer<typeof dataTabStateSchema>;

// D1: the DDL tab kind is `ddl`, not `object` (§8.4 lists `data`, `ddl`, `document`, `keyvalue`,
// `stream`, `console`). `tabRecordSchema` is a discriminated union on `kind`; each later phase
// (P5.5 console, P8 document, P9 keyvalue) adds one arm, not a migration. The `data` arm is
// byte-identical to the pre-union schema, so persisted rows parse unchanged.
export const ddlTabStateSchema = z.object({
  scrollTop: z.number().default(0),
  /** Index into SourceText.statements, for the outline highlight. null ⇒ no selection. */
  selectedStatement: z.number().int().nullable().default(null),
});
export type DdlTabState = z.infer<typeof ddlTabStateSchema>;

const tabBaseSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  order: z.number().int(),
  active: z.boolean(),
});

export const dataTabRecordSchema = tabBaseSchema.extend({
  kind: z.literal('data'),
  state: dataTabStateSchema,
});
export type DataTabRecord = z.infer<typeof dataTabRecordSchema>;

export const ddlTabRecordSchema = tabBaseSchema.extend({
  kind: z.literal('ddl'),
  state: ddlTabStateSchema,
});
export type DdlTabRecord = z.infer<typeof ddlTabRecordSchema>;

export const tabRecordSchema = z.discriminatedUnion('kind', [
  dataTabRecordSchema,
  ddlTabRecordSchema,
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;

// Selection and the search-toolbar state are NOT in DataTabState — they are runtime-only and never
// persisted (restoring a highlighted cell into a tab whose data has not loaded is meaningless).
// This is the P3 handshake: the cell editor reads `activeTab.selection.focus` plus
// `pageView.cell(row, col)` and needs nothing else.
export type SelectionMode = 'cell' | 'row' | 'column';

export interface Selection {
  mode: SelectionMode;
  anchor: { row: number; col: number };
  focus: { row: number; col: number };
}
