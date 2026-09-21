import type { ConnectionKind } from '@shared/domain/connection';
import type { ConnectionDdl } from '@shared/domain/schema';
import { useMutation } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import type { EditorCompletionSource } from '../editor/completion';
import { type DdlSchema, EMPTY_DDL_SCHEMA, parseDdl } from '../views/console/ddl';
import { sqlKeywordCompletionSource } from '../views/console/sqlKeywordCompletion';
import { type SqlDialect, sqlDialectFor } from '../views/shared/sqlIdent';
import { queryClient } from './queryClient';

// P18 (v1.1) D2/D4: each connection's own pasted DDL document — app-wide like
// connections/settings/layout (docs/ARCHITECTURE.md's Multi-window section), keyed by
// connectionId. A connection with no saved document simply has no entry, matching D2's "absent
// until the user writes one" (never an error, never a placeholder row).
//
// P99 §5.5: the text itself lives in TanStack Query's cache under this key, not in a reactive —
// ensureQueryData's own in-flight dedupe replaces the old hand-written pendingLoads map, and its
// cache replaces the old byConnection. A rejection is not cached, matching the old `finally` evict.
export function schemaQueryKey(connectionId: string): readonly ['schema', string] {
  return ['schema', connectionId] as const;
}

export function schemaQueryOptions(connectionId: string): {
  queryKey: readonly ['schema', string];
  queryFn: () => Promise<string>;
  staleTime: number;
} {
  return {
    queryKey: schemaQueryKey(connectionId),
    // P12 round 2 finding #14, carried over: whichever caller's fetch resolves (ensureDdl below,
    // or useQuery's own auto-fetch in a component), TanStack Query commits this function's return
    // value to the cache unconditionally — there is no hook to skip that commit short of
    // cancelling the fetch, and cancelling rejects every caller currently awaiting it (verified
    // empirically; see saveDdl's own comment), which is not what a caller of ensureDdl expects.
    // Returning whatever is already cached, once fetched, instead of the fetched text itself, is
    // what makes that unconditional commit safe: a saveDdl or a remote onSchemaChanged write that
    // landed while this was in flight is picked up here and effectively re-committed (a no-op),
    // rather than clobbered by the now-stale fetch result.
    queryFn: async () => {
      const ddl = await control.schemaGet(connectionId).then((r) => r.ddl);
      return queryClient.getQueryData<string>(schemaQueryKey(connectionId)) ?? ddl;
    },
    staleTime: Number.POSITIVE_INFINITY, // the Go side pushes onSchemaChanged — never stale silently
  };
}

/** Memoised per connectionId (D3's dialog and C5's completion source both call this) — Query's own
 *  in-flight dedupe means a fetch only ever happens once per connection per session, shared with
 *  any component's own `useQuery` for the same key (schemaQueryOptions above). */
export function ensureDdl(connectionId: string): Promise<string> {
  return queryClient.ensureQueryData(schemaQueryOptions(connectionId));
}

/** SchemaDialog.vue's own Save — writes the saved text straight into the same query cache entry
 *  ensureDdl reads, which is what schemaQueryOptions's own queryFn comment above protects: a save
 *  landing while a fetch is still in flight is picked up by that fetch's own resolution instead of
 *  being clobbered by it. A plain function (not just a `useMutation` `mutationFn`) so it stays
 *  directly callable/testable outside a component, the same way `ensureDdl` already is. */
export async function saveDdl(connectionId: string, ddl: string): Promise<string> {
  const result = await control.schemaSet(connectionId, ddl);
  queryClient.setQueryData(schemaQueryKey(connectionId), result.ddl);
  return result.ddl;
}

export function useSaveDdlMutation() {
  return useMutation({
    mutationFn: ({ connectionId, ddl }: { connectionId: string; ddl: string }) =>
      saveDdl(connectionId, ddl),
  });
}

export const useSchemaDialogStore = defineStore('schemaDialog', () => {
  const dialog = reactive({
    open: false,
    connectionId: null as string | null,
  });

  function openSchemaDialog(connectionId: string): void {
    dialog.open = true;
    dialog.connectionId = connectionId;
  }

  function closeSchemaDialog(): void {
    dialog.open = false;
    dialog.connectionId = null;
  }

  return { ...toRefs(dialog), openSchemaDialog, closeSchemaDialog };
});

// C3's plan comment: memoised per (connectionId, textHash) so a keystroke in the console never
// re-parses the DDL — keyed here by the raw text itself rather than a hash, since the whole point
// is a cheap `===` check against the one string per connection the caller already holds (its own
// `useQuery`/`ensureDdl` result).
const parsedCache = new Map<string, { text: string; schema: DdlSchema }>();

/** The parsed DdlSchema for `connectionId`'s current DDL `text`, empty when there is none (D5) or
 *  when `dialect` is undefined (a non-SQL console never calls this). Takes `text` directly (the
 *  caller's own query cache read) rather than looking it up itself, so this stays a plain
 *  memoised parse with no TanStack Query dependency of its own. */
export function ddlSchemaFor(
  connectionId: string,
  text: string | undefined,
  dialect: SqlDialect | undefined,
): DdlSchema {
  if (!text || !dialect) return EMPTY_DDL_SCHEMA;
  const cached = parsedCache.get(connectionId);
  if (cached?.text === text) return cached.schema;
  const schema = parseDdl(dialect, text);
  parsedCache.set(connectionId, { text, schema });
  return schema;
}

// SPEC §11: project/ (SchemaDialog.vue, menus.ts) must not import views/ directly — these four
// wrappers are its one dispatch point into the SQL surface (views/shared/sqlIdent.ts,
// views/console/ddl.ts, views/console/sqlKeywordCompletion.ts), mirroring state/viewCommands.ts's
// own role for other project/ callers.

/** undefined for a kind with no SQL surface — SchemaDialog.vue's own guard for whether a
 *  connection even has a DDL document to edit, and MonacoHost.vue's `sql-dialect` prop. */
export function schemaDialectFor(kind: ConnectionKind | undefined): SqlDialect | undefined {
  return sqlDialectFor(kind);
}

/** P60b §6.2: SchemaDialog.vue passes `:autocomplete="true"` with no `completionSources` and used
 *  to rely on lang-sql's own implicit language-data keyword source (its own now-stale comment at
 *  the mount site said so). `MonacoHost.vue`'s `override`-shaped `completionSources` prop has no
 *  such implicit fallback, so this is that keyword/type source, made explicit — undefined for a
 *  kind with no SQL surface, matching `schemaDialectFor`. */
export function sqlKeywordCompletionSourceFor(
  kind: ConnectionKind | undefined,
): EditorCompletionSource | undefined {
  const dialect = sqlDialectFor(kind);
  return dialect && sqlKeywordCompletionSource(dialect);
}

/** D3's live parse summary — "N tables, M columns", or an explanatory line when nothing was
 *  recognised; null while there's nothing to summarise yet (empty text, or no SQL dialect). */
export function ddlParseSummary(kind: ConnectionKind | undefined, text: string): string | null {
  if (!text.trim()) return null;
  const dialect = sqlDialectFor(kind);
  if (!dialect) return null;
  const schema = parseDdl(dialect, text);
  if (schema.tables.length === 0) return 'No tables recognised in this text — check the paste';
  const columns = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  const tableWord = schema.tables.length === 1 ? 'table' : 'tables';
  const columnWord = columns === 1 ? 'column' : 'columns';
  return `${schema.tables.length} ${tableWord}, ${columns} ${columnWord}`;
}

function applyRemote(ddl: ConnectionDdl): void {
  // P99 §5.4: a broadcast invalidating TanStack Query data invalidates rather than writing a
  // reactive field directly — an active observer (an open SchemaDialog on this connection)
  // refetches; an inactive one just drops its stale cache entry.
  queryClient.invalidateQueries({ queryKey: schemaQueryKey(ddl.connectionId) });
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
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ['schema'] })) {
      const id = query.queryKey[1] as string;
      if (!liveIds.has(id)) {
        // P12 round 1 finding #11: parsedCache is keyed on connectionId too, and this module's
        // own comment above claims dropping a deleted connection's entry is the only cleanup it
        // owns — measured ~521 KiB per stale entry left behind without this.
        queryClient.removeQueries({ queryKey: query.queryKey });
        parsedCache.delete(id);
      }
    }
  });
}
