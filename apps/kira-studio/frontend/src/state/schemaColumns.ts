// P22c D3: the renderer-side store for a container's cached columns — filled on a view's own
// lifecycle hook (a console opening, a table's data tab loading), never from a CompletionSource,
// never on a keystroke (D5: the language layer never fetches). Lives in state/, not views/, for
// the same reason state/schemas.ts does: three different view kinds read it, and views/<kind>/*
// may not import another views/<kind>/* (biome.json).
import {
  type ColumnMeta,
  decodePath,
  encodePath,
  type PathSegment,
  type RelationColumns,
} from '@shared/domain/tree';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { rowKey } from '../project/state/tree';
import {
  type DdlColumn,
  type DdlSchema,
  type DdlTable,
  EMPTY_DDL_SCHEMA,
} from '../views/console/ddl';

const RELATION_CONTAINER_KINDS = new Set(['database', 'schema']);

/** P22c F1: walks a console/table/etc.'s own path back to the last database:/schema: segment —
 *  the exact container completion.ts's own consoleRelationNames already resolves relation names
 *  against, factored out here so the two can never disagree about what "this container" means.
 *  null for a path with no such segment (opened from the connection root). */
export function containerPathFor(connectionId: string, path: string): string | null {
  let segments: PathSegment[];
  try {
    segments = decodePath(connectionId, path).segments;
  } catch {
    return null;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    if (RELATION_CONTAINER_KINDS.has(segments[i]?.kind ?? '')) {
      return encodePath(segments.slice(0, i + 1));
    }
  }
  return null;
}

// Keyed by rowKey(connectionId, containerPath) — the SAME key project/state/tree.ts uses for its
// own children cache, so the two never disagree about what "this container" means.
export const schemaColumnsState = reactive({
  byContainer: {} as Record<string, RelationColumns[]>,
});

const pendingLoads = new Set<string>();

/** Idempotent, single-flight, fire-and-forget. Called on tab activation; never from a
 *  CompletionSource, never on a keystroke (D5). Resolves from the Go-side cache with no
 *  connection when one is cached (P22c F7), and is a no-op when the container is already loaded
 *  or a fetch for it is already in flight. */
export async function ensureSchemaColumns(
  connectionId: string,
  containerPath: string,
): Promise<void> {
  const key = rowKey(connectionId, containerPath);
  if (schemaColumnsState.byContainer[key] || pendingLoads.has(key)) return;
  pendingLoads.add(key);
  try {
    const result = await control.treeSchemaColumns(connectionId, containerPath);
    schemaColumnsState.byContainer[key] = result.relations;
  } catch {
    // Same discipline as views/grid/state.ts's own loadMeta: a nicety that warms completion, not
    // something a failure here should block reading rows or opening a console over.
  } finally {
    pendingLoads.delete(key);
  }
}

/** The raw cached relations for a container — read by ConsoleView.vue to feed
 *  sqlCompletionSources' own `cached` parameter (D4) directly, in the shape lang-sql's
 *  schemaCompletionSource actually wants (via namespaceFromCached), separately from
 *  effectiveSchema's DdlSchema-shaped projection below (D6's lint/hover supply). A plain property
 *  lookup that returns [] on a miss — never a fetch (D5's own guard: nothing exported here can
 *  trigger one). */
export function cachedRelationsFor(
  connectionId: string,
  containerPath: string,
): readonly RelationColumns[] {
  return schemaColumnsState.byContainer[rowKey(connectionId, containerPath)] ?? [];
}

function toDdlColumn(col: ColumnMeta): DdlColumn {
  return {
    name: col.name,
    type: col.dataType,
    primaryKey: col.isPrimaryKey || undefined,
    notNull: col.nullable ? undefined : true,
    description: col.comment ?? undefined,
  };
}

function ddlSchemaFromCached(relations: readonly RelationColumns[]): DdlSchema {
  const tables: DdlTable[] = relations.map((rc) => ({
    name: rc.name,
    isView: rc.kind === 'table' ? undefined : true,
    columns: rc.columns.map(toDdlColumn),
  }));
  return { tables };
}

/** The cached columns projected into the DdlSchema shape the three console language providers
 *  (completion, diagnostics, hover) already share (D6) — so they can never disagree about what
 *  the console knows. D4's precedence: a hand-authored document still wins WHOLESALE the moment
 *  it declares any table — never merged table-by-table with the cache — since a user who pasted
 *  one deliberately (a read replica they can't introspect, a schema they're designing before it
 *  exists) keeps getting exactly what they get today. The cache only fills the case that was
 *  previously empty. */
export function effectiveSchema(
  connectionId: string,
  containerPath: string,
  document: DdlSchema,
): DdlSchema {
  if (document.tables.length > 0) return document;
  const cached = cachedRelationsFor(connectionId, containerPath);
  if (cached.length === 0) return EMPTY_DDL_SCHEMA;
  return ddlSchemaFromCached(cached);
}

let unsubscribeInvalidated: (() => void) | null = null;

/** Rides the same broadcast project/state/tree.ts already listens to for metadata invalidation
 *  (D3) — one subscription, mirroring an existing one, not a second invalidation mechanism. */
export function initSchemaColumnsSync(): void {
  unsubscribeInvalidated?.();
  unsubscribeInvalidated = control.onConnectionMetadataInvalidated((connectionId) => {
    const prefix = rowKey(connectionId, '');
    for (const key of Object.keys(schemaColumnsState.byContainer)) {
      if (key.startsWith(prefix)) delete schemaColumnsState.byContainer[key];
    }
  });
}
