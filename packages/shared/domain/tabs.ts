import { z } from 'zod';
import { grpcRequestTabStateSchema } from './grpc';
import { httpRequestTabStateSchema } from './http';
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
  // P2: the first Api-mode kind (§2 F1) — four vocabularies join it, this one plus
  // RENDERABLE_TAB_KINDS/TAB_KIND_MODE below and Go's model.RenderableTabKinds (the one silent
  // failure mode of the four, D10).
  'http-request',
  // P11 D2: the second kind inside the 'api' mode — a protocol AND a surface, following
  // 'http-request''s own naming reasoning verbatim.
  'grpc-request',
  // P17 D16: the third kind inside the 'api' mode — one collection's or one environment's
  // variable set, opened as a tab rather than a dialog. One kind, not two: a collection's
  // variable set and an environment's are the same table over the same rows differing only in
  // `scope` (VariablesRepo itself is one repo for both, not two).
  'variable-set',
  // P28 D16(c): the fourth kind inside the 'api' mode — the environment *list*, where an
  // environment is created, renamed, duplicated, deleted and reordered. Distinct from
  // 'variable-set' rather than folded into it with an empty ownerId: that kind is "the rows of one
  // owner", this one is "the owners", and one tab of each can be open at the same time.
  'environments',
  // C5 §6.2: the permanently pinned, unclosable first tab every repo workspace reserves for the
  // git graph — an honest placeholder view here, replaced by C9's own mount (one TAB_VIEWS line).
  'repo-graph',
  // C5 §8: one opened repository file, read-only, rendered by Monaco (§9).
  'repo-file',
  // C6 §7/§8.1: a HEAD-vs-worktree diff, opened from the tree's own "Open changes" action —
  // read-only, rendered by Monaco's diff editor.
  'repo-diff',
]);
export type TabKind = z.infer<typeof tabKindSchema>;

// 'data' and 'definition' (P19, was 'ddl') are renderable as of P4 (D18); 'console' joins them in
// P5.5, 'document' in P8, 'keyvalue' in P9, 'stream' in P10, 'browse' in P41, 'http-request' in
// P2, 'grpc-request' in P11. The restore path drops rows of any other kind with a `warn` — a
// closed vocabulary decided once, same discipline as P1's Caps/connectionKind.
export const RENDERABLE_TAB_KINDS: readonly TabKind[] = [
  'data',
  'definition',
  'console',
  'document',
  'keyvalue',
  'stream',
  'browse',
  'http-request',
  'grpc-request',
  'variable-set',
  'environments',
  'repo-graph',
  'repo-file',
  'repo-diff',
];

// C5 D2/§4.1: TAB_KIND_MODE's value type widens from AppMode to TabScope — 'repo' is a sentinel
// meaning "this kind's workspace comes from the record's own workspaceId, never from the kind",
// since two repositories share the exact same two repo kinds (a mode, unlike a workspace, can
// never be per-instance). tabsForMode(mode: AppMode) compares for equality against an AppMode, so
// a repo tab can never match a mode's strip — the isolation is enforced by the value, not only by
// a filter someone has to remember to write.
export type TabScope = AppMode | 'repo';

// P1 D5: a tab's mode is a total function of its kind — no mode column, no migration. This lives
// in shared/domain/ (not state/tabKinds.ts) because it must be importable with no Vue-state side
// effects: `state/mode.ts`'s tabsForMode filter needs only this mapping, never the rest of the
// per-kind registry (components, page stores, menu builders). All seven Studio kinds map to
// 'studio'; 'http-request' (P2) and 'grpc-request' (P11 D2) both map to 'api' (P12 D2: renamed
// from 'http') — the SPEC's "hosted through the same shell" is satisfied by a second kind inside
// the existing mode, not a third mode.
export const TAB_KIND_MODE: Record<TabKind, TabScope> = {
  data: 'studio',
  definition: 'studio',
  console: 'studio',
  document: 'studio',
  keyvalue: 'studio',
  stream: 'studio',
  browse: 'studio',
  'http-request': 'api',
  'grpc-request': 'api',
  'variable-set': 'api',
  environments: 'api',
  'repo-graph': 'repo',
  'repo-file': 'repo',
  'repo-diff': 'repo',
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
  /** P63: the split's list-pane width in px. `0` means "the default"
   *  (BrowseView.vue's own DEFAULT_LIST_WIDTH), so a tab saved before this field existed restores
   *  unchanged — same `.default(0)` discipline requestPaneHeight/cellEditor height already use. */
  listWidth: z.number().default(0),
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

// P17 D16: a variable-set tab's identity is `path` (`variables:collection:<id>` /
// `variables:environment:<id>`, openTab's own `reuse: true` target) — `scope`/`ownerId` here are
// what the view itself needs to query VariablesRepo, duplicated from `path` rather than parsed
// back out of it. `name` is the owner's last-known name (mirrors HttpRequestTabState's own field):
// the tab's title before the list has loaded after a restore, and what renameVariableSetTabs
// patches on a collection/environment rename. Deliberately NOT here: the filter query and the
// bulk-mode flag (P16 §8 OQ-8's "a lens, not a setting" rule, plus the specific hazard that
// persisting bulk mode would restore a tab into an editor holding an unapplied buffer that no
// longer matches the rows) — both stay component-local.
export const variableSetTabStateSchema = /*#__PURE__*/ z.object({
  scope: /*#__PURE__*/ z.enum(['collection', 'environment']),
  ownerId: z.string(),
  name: z.string().default(''),
});
export type VariableSetTabState = z.infer<typeof variableSetTabStateSchema>;

// P28 D16(c): the environments tab carries no state of its own — its whole content is
// api/state/variables.ts's own environment list, which every other Api surface already reads, and
// its identity is its fixed `path` ('environments'), so openTab's `reuse: true` gives exactly one.
// An empty object rather than no schema at all, so the record shape stays uniform with every other
// kind and parseState has something to validate against.
export const environmentsTabStateSchema = /*#__PURE__*/ z.object({});
export type EnvironmentsTabState = z.infer<typeof environmentsTabStateSchema>;

// C5 §6.2: the pinned graph placeholder carried no state of its own at first — an empty object,
// like EnvironmentsTabState above. C10 §8 replaces the placeholder with the real mounted graph,
// which needs to persist across a tab switch (C5's tab views unmount on switch — a cold remount
// would re-walk the graph and lose scroll/selection): `viewState` holds git-ui's own
// `PersistedViewState` (version-6 shape: repoId, loadedRows, detailOpen, scrollRow, selectedSha,
// columnWidths, dateFormat, detailWidth, fileListMode, four search toggles, searchOpen). A
// permissive passthrough rather than re-deriving that shape here — git-ui's own
// `parsePersistedViewState` (already shipped, `index.ts`) is the sole validator, so this schema
// does not become a second, drift-prone implementation of the same version-6 contract.
// C11 §8.3: reviewSession is a second opaque blob of the same shape as viewState above — the
// pinned graph tab is the only per-repo-workspace state that survives a tab switch/app restart, so
// it also hosts the review sidebar's own "back to branch selection" resume point
// (`ReviewSessionSnapshot`, G19 D11b), stored and read back through `review.session.save/.load`'s
// native host answer (`repo/git/reviewSession.ts`). Opaque to the host for the same reason
// `viewState` is: `ReviewView.vue`/`state/review.ts` define and validate their own shape; this file
// only persists it. `null` is "no resume point" — the same value `review.session.save` writes when
// asked to clear one.
export const repoGraphTabStateSchema = /*#__PURE__*/ z.object({
  viewState: z.unknown().nullable().default(null),
  reviewSession: z.unknown().nullable().default(null),
});
export type RepoGraphTabState = z.infer<typeof repoGraphTabStateSchema>;

// C5 §9.3/§12: revealLine is the one thing worth remembering across a restore — which line Monaco
// was showing — restored on mount and re-patched (debounced) as the user scrolls, mirroring
// DataTabState's own scrollTop. `.default(null)` keeps a tab saved before this field existed
// restorable, the same discipline every other added tab-state field follows.
// P67c D12: source is the default for every file type this app opens, markdown included — a
// reading view is opt-in per tab, not the other way round. `.default(false)` follows revealLine's
// own discipline: a tab saved before this field existed restores as 'source', same as today.
export const repoFileTabStateSchema = /*#__PURE__*/ z.object({
  revealLine: z.number().int().min(1).nullable().default(null),
  markdownReading: z.boolean().default(false),
});
export type RepoFileTabState = z.infer<typeof repoFileTabStateSchema>;

// C6 §8.1/D10: a diff tab carried no session state at first — a restored tab re-read both sides
// and opened at Monaco's own first change. C10 §6.1 extends this, rather than forking a second
// diff-tab kind, to also address a *commit* diff: the revision pair. Both null (the default) is
// C6's own HEAD-vs-worktree comparison, unchanged; a commit diff's `RepoDiffView.vue` branch reads
// `left`/`right` as the two revisions and `leftLabel`/`rightLabel` as their short-sha display text.
// `.default(null)` on every field keeps a tab saved before this phase restorable — the same
// discipline `repoFileTabStateSchema`'s own `revealLine` already follows.
// C11 §7.5: review turns on the gutter/comment-thread layer (`views/repo/reviewDecorations.ts`)
// over the same left/right pair rather than forking a third tab kind — `left`/`right` already
// carry `leftRev`/`branchTip` for a review diff exactly as they do for a plain commit diff, so
// `file.read` needs no new request shape. `null` (the default) is C6/C10 behaviour, byte-identical.
export const repoDiffTabStateSchema = /*#__PURE__*/ z.object({
  left: z.string().nullable().default(null),
  right: z.string().nullable().default(null),
  leftLabel: z.string().nullable().default(null),
  rightLabel: z.string().nullable().default(null),
  review: /*#__PURE__*/ z
    .object({
      branch: z.string(),
      branchTip: z.string(),
      leftLabel: z.string(),
    })
    .nullable()
    .default(null),
});
export type RepoDiffTabState = z.infer<typeof repoDiffTabStateSchema>;

const tabRecordBase = {
  id: z.string(),
  connectionId: z.string().nullable(),
  path: z.string(), // encoded NodePath, '' for a connection-scoped tab
  order: z.number().int(),
  active: z.boolean(),
  // C5 D2/§4.2: null for every studio/api tab (workspaceKeyOf's own `??` fallback derives the
  // workspace from `kind` instead, exactly as before this field existed) — 'repo:<code_repos.id>'
  // for a tab scoped to that repository's own workspace. One line here so every union member
  // carries it, rather than repeating it on the two repo kinds alone.
  workspaceId: z.string().nullable().default(null),
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
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('http-request'),
    state: httpRequestTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('grpc-request'),
    state: grpcRequestTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('variable-set'),
    state: variableSetTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('environments'),
    state: environmentsTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-graph'),
    state: repoGraphTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-file'),
    state: repoFileTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-diff'),
    state: repoDiffTabStateSchema,
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
export type HttpRequestTabRecord = Extract<TabRecord, { kind: 'http-request' }>;
export type GrpcRequestTabRecord = Extract<TabRecord, { kind: 'grpc-request' }>;
export type VariableSetTabRecord = Extract<TabRecord, { kind: 'variable-set' }>;
export type EnvironmentsTabRecord = Extract<TabRecord, { kind: 'environments' }>;
export type RepoGraphTabRecord = Extract<TabRecord, { kind: 'repo-graph' }>;
export type RepoFileTabRecord = Extract<TabRecord, { kind: 'repo-file' }>;
export type RepoDiffTabRecord = Extract<TabRecord, { kind: 'repo-diff' }>;

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

export function asHttpRequestTab(tab: TabRecord | null | undefined): HttpRequestTabRecord | null {
  return tab && tab.kind === 'http-request' ? tab : null;
}

export function asGrpcRequestTab(tab: TabRecord | null | undefined): GrpcRequestTabRecord | null {
  return tab && tab.kind === 'grpc-request' ? tab : null;
}

export function asVariableSetTab(tab: TabRecord | null | undefined): VariableSetTabRecord | null {
  return tab && tab.kind === 'variable-set' ? tab : null;
}

export function asRepoGraphTab(tab: TabRecord | null | undefined): RepoGraphTabRecord | null {
  return tab && tab.kind === 'repo-graph' ? tab : null;
}

export function asRepoFileTab(tab: TabRecord | null | undefined): RepoFileTabRecord | null {
  return tab && tab.kind === 'repo-file' ? tab : null;
}

export function asRepoDiffTab(tab: TabRecord | null | undefined): RepoDiffTabRecord | null {
  return tab && tab.kind === 'repo-diff' ? tab : null;
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
  return { levelPath: '', listWidth: 0 };
}

export function defaultRepoGraphTabState(): RepoGraphTabState {
  return { viewState: null, reviewSession: null };
}

export function defaultRepoFileTabState(revealLine: number | null = null): RepoFileTabState {
  return { revealLine, markdownReading: false };
}

/**
 * With no arguments, C6's own HEAD-vs-worktree comparison (every field null) — every existing
 * caller of `defaultRepoDiffTabState()` is unaffected. C10's `openRepoCommitDiffTab` is one caller
 * that supplies the revision pair; C11's `openRepoReviewDiffTab` (S8) is the one caller that also
 * supplies `review`.
 */
export function defaultRepoDiffTabState(
  revision?: {
    left: string;
    right: string;
    leftLabel: string;
    rightLabel: string;
  },
  review?: { branch: string; branchTip: string; leftLabel: string },
): RepoDiffTabState {
  return {
    left: revision?.left ?? null,
    right: revision?.right ?? null,
    leftLabel: revision?.leftLabel ?? null,
    rightLabel: revision?.rightLabel ?? null,
    review: review ?? null,
  };
}

/** 'order_items' — the path tail's name; the connection name is rendered separately. */
export function tabTitle(record: TabRecord): string {
  const tail = pathTail(record.path);
  // A console tab's path is often a container (connection root, database, schema) with no tail
  // name worth showing — 'Console' names the tab itself, same as a bare browser new-tab title.
  if (record.kind === 'console') return tail?.name ?? 'Console';
  return tail?.name ?? record.path;
}
