import type { ConnectionKind } from '@shared/domain/connection';
import type { ConnectionDdl } from '@shared/domain/schema';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { dialectObjectFor } from '../editor/languages';
import { type DdlSchema, EMPTY_DDL_SCHEMA, parseDdl } from '../views/console/ddl';
import { type SqlDialect, sqlDialectFor } from '../views/shared/sqlIdent';

// P18 (v1.1) D2/D4: the renderer-side store for each connection's pasted DDL document — app-wide
// like connections/settings/layout (docs/ARCHITECTURE.md's Multi-window section), keyed by
// connectionId. A connection with no saved document simply has no entry, matching D2's "absent
// until the user writes one" (never an error, never a placeholder row).
export const schemasState = reactive({
  byConnection: {} as Record<string, string>, // connectionId -> raw DDL text
});

export const schemaDialogState = reactive({
  open: false,
  connectionId: null as string | null,
});

export function openSchemaDialog(connectionId: string): void {
  schemaDialogState.open = true;
  schemaDialogState.connectionId = connectionId;
}

export function closeSchemaDialog(): void {
  schemaDialogState.open = false;
  schemaDialogState.connectionId = null;
}

const pendingLoads = new Map<string, Promise<string>>();

// Memoised per connectionId (D3's dialog and C5's completion source both call this) — a fetch
// only ever happens once per connection per session; a Save (below) and a remote broadcast both
// write straight into `byConnection` without going through this again.
export async function ensureDdl(connectionId: string): Promise<string> {
  const cached = schemasState.byConnection[connectionId];
  if (cached !== undefined) return cached;
  let pending = pendingLoads.get(connectionId);
  if (!pending) {
    pending = control.schemaGet(connectionId).then((r) => r.ddl);
    pendingLoads.set(connectionId, pending);
  }
  const ddl = await pending;
  pendingLoads.delete(connectionId);
  schemasState.byConnection[connectionId] = ddl;
  return ddl;
}

export async function saveDdl(connectionId: string, ddl: string): Promise<void> {
  const result = await control.schemaSet(connectionId, ddl);
  schemasState.byConnection[connectionId] = result.ddl;
}

// C3's plan comment: memoised per (connectionId, textHash) so a keystroke in the console never
// re-parses the DDL — keyed here by the raw text itself rather than a hash, since the whole point
// is a cheap `===` check against the one string this module already holds per connection.
const parsedCache = new Map<string, { text: string; schema: DdlSchema }>();

/** The parsed DdlSchema for `connectionId`'s current DDL text, empty when there is none (D5) or
 *  when `dialect` is undefined (a non-SQL console never calls this). */
export function ddlSchemaFor(connectionId: string, dialect: SqlDialect | undefined): DdlSchema {
  const text = schemasState.byConnection[connectionId];
  const dialectObject = dialect && dialectObjectFor(dialect);
  if (!text || !dialectObject) return EMPTY_DDL_SCHEMA;
  const cached = parsedCache.get(connectionId);
  if (cached?.text === text) return cached.schema;
  const schema = parseDdl(dialectObject, text);
  parsedCache.set(connectionId, { text, schema });
  return schema;
}

// SPEC §11: project/ (SchemaDialog.vue, menus.ts) must not import views/ directly — these three
// wrappers are its one dispatch point into the SQL surface (views/shared/sqlIdent.ts,
// views/console/ddl.ts), mirroring state/viewCommands.ts's own role for other project/ callers.

/** undefined for a kind with no SQL surface — SchemaDialog.vue's own guard for whether a
 *  connection even has a DDL document to edit, and CodeMirrorHost.vue's `sql-dialect` prop. */
export function schemaDialectFor(kind: ConnectionKind | undefined): SqlDialect | undefined {
  return sqlDialectFor(kind);
}

/** D3's live parse summary — "N tables, M columns", or an explanatory line when nothing was
 *  recognised; null while there's nothing to summarise yet (empty text, or no SQL dialect). */
export function ddlParseSummary(kind: ConnectionKind | undefined, text: string): string | null {
  if (!text.trim()) return null;
  const dialect = sqlDialectFor(kind);
  const dialectObject = dialect && dialectObjectFor(dialect);
  if (!dialectObject) return null;
  const schema = parseDdl(dialectObject, text);
  if (schema.tables.length === 0) return 'No tables recognised in this text — check the paste';
  const columns = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  const tableWord = schema.tables.length === 1 ? 'table' : 'tables';
  const columnWord = columns === 1 ? 'column' : 'columns';
  return `${schema.tables.length} ${tableWord}, ${columns} ${columnWord}`;
}

function applyRemote(ddl: ConnectionDdl): void {
  schemasState.byConnection[ddl.connectionId] = ddl.ddl;
}

let unsubscribeChanged: (() => void) | null = null;
let unsubscribeConnectionsChanged: (() => void) | null = null;

// D2/D4: a document lives as long as its connection does (not tree-cache-like — nothing here
// evicts on disconnect, unlike project/state/tree.ts's own dropConnectionState), so the only
// cleanup this module owns is dropping a deleted connection's entry.
export function initSchemaSync(): void {
  unsubscribeChanged?.();
  unsubscribeChanged = control.onSchemaChanged(applyRemote);

  unsubscribeConnectionsChanged?.();
  unsubscribeConnectionsChanged = control.onConnectionsChanged((records) => {
    const liveIds = new Set(records.map((r) => r.id));
    for (const id of Object.keys(schemasState.byConnection)) {
      if (!liveIds.has(id)) delete schemasState.byConnection[id];
    }
  });
}
