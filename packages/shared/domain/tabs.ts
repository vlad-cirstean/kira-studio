import { z } from 'zod';
import type { AppMode } from './mode';
import { sortSpecSchema } from './queries';
import { pathTail } from './tree';

export const tabKindSchema = /*#__PURE__*/ z.enum([
  'data',
  'definition',
  'document',
  'keyvalue',
  'stream',
  'console',
  'browse',
]);
export type TabKind = z.infer<typeof tabKindSchema>;

// 'data' and 'definition' (P19, was 'ddl') are renderable as of P4 (D18); 'console' joins them in
// P5.5, 'document' in P8, 'keyvalue' in P9, 'stream' in P10, 'browse' in P41. The restore path
// drops rows of any other kind with a `warn` — a closed vocabulary decided once, same discipline
// as P1's Caps/connectionKind.
export const RENDERABLE_TAB_KINDS: readonly TabKind[] = [
  'data',
  'definition',
  'console',
  'document',
  'keyvalue',
  'stream',
  'browse',
];

// P1 D5: a tab's mode is a total function of its kind — no mode column, no migration. This lives
// in shared/domain/ (not state/tabKinds.ts) because it must be importable with no Vue-state side
// effects: `state/mode.ts`'s tabsForMode filter needs only this mapping, never the rest of the
// per-kind registry (components, page stores, menu builders). All seven kinds are Studio's own
// today; P2's first Http tab kind is the first entry that maps to 'http'.
export const TAB_KIND_MODE: Record<TabKind, AppMode> = {
  data: 'studio',
  definition: 'studio',
  console: 'studio',
  document: 'studio',
  keyvalue: 'studio',
  stream: 'studio',
  browse: 'studio',
};

const pageSizeSchema = /*#__PURE__*/ z.union([
  z.literal(10),
  z.literal(100),
  z.literal(1000),
  z.literal(10000),
]);
export type PageSize = z.infer<typeof pageSizeSchema>;

export const dataTabStateSchema = /*#__PURE__*/ z.object({
  pageSize: pageSizeSchema,
  pageIndex: z.number().int().min(0), // what the pager shows; offset = pageIndex * pageSize
  filter: z.string().nullable(),
  sort: sortSpecSchema.nullable(),
  projection: /*#__PURE__*/ z.array(z.string()).nullable(),
  columnWidths: /*#__PURE__*/ z.record(z.string(), z.number()),
  columnOrder: /*#__PURE__*/ z.array(z.string()).nullable(),
  scrollTop: z.number(),
  scrollLeft: z.number(),
});
export type DataTabState = z.infer<typeof dataTabStateSchema>;

// P19 D7: which pane (Structure/Source) the tab was last showing — the one thing this tab now
// has worth remembering. `.default('structure')` keeps a tab saved under the old empty `{}` shape
// (D4: "nothing to remember", true while there was only one pane) restorable, the same discipline
// keyValueTabStateSchema's own `pageSize` comment records.
export const definitionTabStateSchema = /*#__PURE__*/ z.object({
  pane: /*#__PURE__*/ z.enum(['structure', 'source']).default('structure'),
});
export type DefinitionTabState = z.infer<typeof definitionTabStateSchema>;

// Only the editor's own text is session state (§8.4) — the last run's results are runtime-only,
// like `views/definition/state.ts`'s `definition` field, and never round-trip through `tabs.save`.
// `newResultSet` (P40 D6, re-flipped back on P46-2): the toolbar toggle deciding whether a run
// appends a new result set (stacking) or replaces the current one with a fresh single result.
// `.default(true)` only ever fires for an *absent* key, so a tab saved before this field existed
// restores to the same "stack a new result per run" behavior a brand-new tab gets — the toggle is
// opt-in to *replacing*, not opt-in to stacking (pressed/activated means "off").
export const consoleTabStateSchema = /*#__PURE__*/ z.object({
  text: z.string(),
  newResultSet: z.boolean().default(true),
});
export type ConsoleTabState = z.infer<typeof consoleTabStateSchema>;

// Per-_id expand/collapse memory, the search text, and (mirroring DataTabState) the sort,
// projection and pageSize the toolbar's own controls set are session state (§8.7) — the loaded
// documents themselves stay runtime-only, like the grid's own rows, and never round-trip through
// `tabs.save`. `.default()` on the four added fields keeps a tab saved before they existed
// parsing successfully on restore, rather than being dropped by tabRecordSchema's safeParse.
// `pageIndex` mirrors DataTabState's own field (D7's literal wording there): a real (non-`_id`)
// sort forces mongo/read.ts's skip/limit fallback (D6), which — unlike the `_id`-keyset
// strategy — hands back no next/prev token, so goNext/goPrev must track the page position
// themselves the same way the grid does, or paging past page one silently collapses back to it.
export const documentTabStateSchema = /*#__PURE__*/ z.object({
  expanded: /*#__PURE__*/ z.record(z.string(), z.boolean()),
  search: z.string(),
  sort: sortSpecSchema.nullable().default(null),
  projection: /*#__PURE__*/ z.array(z.string()).nullable().default(null),
  pageSize: pageSizeSchema.default(100),
  pageIndex: z.number().int().min(0).default(0),
});
export type DocumentTabState = z.infer<typeof documentTabStateSchema>;

// `pageIndex` is the offset-strategy fallback's own position (mirrors DataTabState's field,
// grid/state.ts's goNext/goPrev) — needed because a redis list key's pagination has no id/cursor
// token to advance by (P9's read.ts uses plain LRANGE offsets for lists). `pageSize` mirrors
// DataTabState's own field (same `pageSizeSchema` literal set — the wire request already accepts
// it for every engine, so this is pure renderer state). Edits/deletes/inserts mutate immediately
// (documents/mutations.ts's precedent, extended to keyvalue) rather than staging anything, so
// there is still no edit/expand memory to persist beyond these two fields.
export const keyValueTabStateSchema = /*#__PURE__*/ z.object({
  pageIndex: z.number().int().min(0),
  // `.default(100)` (unlike DataTabState's required field): a keyvalue tab saved before this
  // field existed has no `pageSize` in its stored JSON at all, and storage/repos/tabs.ts drops a
  // tab row outright on a failed parse — this keeps every already-saved tab restorable instead
  // of silently discarding it.
  pageSize: pageSizeSchema.default(100),
});
export type KeyValueTabState = z.infer<typeof keyValueTabStateSchema>;

// Read-only view (mirrors keyValueTabStateSchema's D2 precedent) — no edit memory to persist.
// Unlike KeyValueTabState, there is no offset-fallback position to remember either: Kafka's
// offsetWindow strategy is always token-driven (no list-key-style plain-offset case), and SQS's
// batch strategy has no position at all (D11). Whether the user has clicked Poll yet (SQS's D10
// gate) is runtime-only state — like `status` in views/keyvalue/state.ts's runtime — since a
// restored tab has no loaded page to show either way, so nothing belongs in session state here.
// `pageSize` mirrors DataTabState/KeyValueTabState/DocumentTabState's own field (`.default(100)`
// for the same already-saved-tab-restores discipline as keyValueTabStateSchema's own comment).
// The filter fields are Kafka-only positioning knobs (SQS shows none of them — no matching
// concept, per its own read.ts): `offsetFilter`/`partitions` restrict a fresh browse's
// starting windows (kafka/read.ts), `timestampFilter` seeks via the client's
// `fetchTopicOffsetsByTimestamp` — all persisted per tab like DataTabState's own `filter`,
// but kept structured (independent fields) rather than one WHERE-style free-text field,
// since Kafka has no predicate language to parse. Recent-filter *history* is deliberately NOT
// here (views/stream/streamFilterHistory.ts) — same discipline as the SQL grid's own filter
// history, kept out of `tabs.state_json`/SQLite entirely (session-only, never round-trips).
// `partitions` (task #61) widened the old single `partitionFilter: string | null` free-text field
// into a multiselect array — `.default([])` keeps a tab saved under the old shape restorable
// (storage/repos/tabs.ts drops a tab row outright on a failed parse) rather than reviving the
// old value, which is an acceptable loss for a browse convenience like this one.
// P41: a Browse tab's identity is its container (`path` = `database:db0` / `bucket:photos`,
// §8.4's rule); the level currently shown is per-tab session state. `''` means "the tab's own
// `path`", so a freshly opened tab and one restored at its root parse to the same record —
// `.default('')` keeps a tab saved before this field existed restorable, the same discipline
// every other tab-state schema's own added field follows.
export const browseTabStateSchema = /*#__PURE__*/ z.object({
  levelPath: z.string().default(''),
});
export type BrowseTabState = z.infer<typeof browseTabStateSchema>;

export const streamTabStateSchema = /*#__PURE__*/ z.object({
  pageSize: pageSizeSchema.default(100),
  offsetFilter: z.string().nullable().default(null),
  partitions: /*#__PURE__*/ z.array(z.number().int()).default([]),
  timestampFilter: z.string().nullable().default(null),
  // Item 4 (task #61): per-column pixel widths for the message table (key/timestamp/headers/
  // attrs), mirroring DataTabState's own field — `.default({})` for the same already-saved-tab
  // discipline as `partitions`/`pageSize`. The `body` column isn't resizable (it already fills
  // remaining space via `flex: 1`) and so is never a key here.
  columnWidths: /*#__PURE__*/ z.record(z.string(), z.number()).default({}),
});
export type StreamTabState = z.infer<typeof streamTabStateSchema>;

const tabRecordBase = {
  id: z.string(),
  connectionId: z.string().nullable(),
  path: z.string(), // encoded NodePath, '' for a connection-scoped tab
  order: z.number().int(),
  active: z.boolean(),
};

export const tabRecordSchema = /*#__PURE__*/ z.discriminatedUnion('kind', [
  /*#__PURE__*/ z.object({ ...tabRecordBase, kind: z.literal('data'), state: dataTabStateSchema }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('definition'),
    state: definitionTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('console'),
    state: consoleTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('document'),
    state: documentTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('keyvalue'),
    state: keyValueTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('stream'),
    state: streamTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('browse'),
    state: browseTabStateSchema,
  }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
export type DataTabRecord = Extract<TabRecord, { kind: 'data' }>;
export type DefinitionTabRecord = Extract<TabRecord, { kind: 'definition' }>;
export type ConsoleTabRecord = Extract<TabRecord, { kind: 'console' }>;
export type DocumentTabRecord = Extract<TabRecord, { kind: 'document' }>;
export type KeyValueTabRecord = Extract<TabRecord, { kind: 'keyvalue' }>;
export type StreamTabRecord = Extract<TabRecord, { kind: 'stream' }>;
export type BrowseTabRecord = Extract<TabRecord, { kind: 'browse' }>;

export function asDataTab(tab: TabRecord | null | undefined): DataTabRecord | null {
  return tab && tab.kind === 'data' ? tab : null;
}

export function asConsoleTab(tab: TabRecord | null | undefined): ConsoleTabRecord | null {
  return tab && tab.kind === 'console' ? tab : null;
}

export function asDocumentTab(tab: TabRecord | null | undefined): DocumentTabRecord | null {
  return tab && tab.kind === 'document' ? tab : null;
}

export function asKeyValueTab(tab: TabRecord | null | undefined): KeyValueTabRecord | null {
  return tab && tab.kind === 'keyvalue' ? tab : null;
}

export function asStreamTab(tab: TabRecord | null | undefined): StreamTabRecord | null {
  return tab && tab.kind === 'stream' ? tab : null;
}

export function asBrowseTab(tab: TabRecord | null | undefined): BrowseTabRecord | null {
  return tab && tab.kind === 'browse' ? tab : null;
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

export function defaultDefinitionTabState(): DefinitionTabState {
  return { pane: 'structure' };
}

export function defaultConsoleTabState(): ConsoleTabState {
  return { text: '', newResultSet: true };
}

export function defaultDocumentTabState(pageSize: PageSize = 100): DocumentTabState {
  return { expanded: {}, search: '', sort: null, projection: null, pageSize, pageIndex: 0 };
}

export function defaultKeyValueTabState(pageSize: PageSize = 100): KeyValueTabState {
  return { pageIndex: 0, pageSize };
}

export function defaultStreamTabState(pageSize: PageSize = 100): StreamTabState {
  return {
    pageSize,
    offsetFilter: null,
    partitions: [],
    timestampFilter: null,
    columnWidths: {},
  };
}

export function defaultBrowseTabState(): BrowseTabState {
  return { levelPath: '' };
}

/** 'order_items' — the path tail's name; the connection name is rendered separately. */
export function tabTitle(record: TabRecord): string {
  const tail = pathTail(record.path);
  // A console tab's path is often a container (connection root, database, schema) with no tail
  // name worth showing — 'Console' names the tab itself, same as a bare browser new-tab title.
  if (record.kind === 'console') return tail?.name ?? 'Console';
  return tail?.name ?? record.path;
}
