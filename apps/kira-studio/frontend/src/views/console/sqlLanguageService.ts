import type { RelationColumns } from '@shared/domain/tree';
import type { EditorCompletion, EditorCompletionSource } from '../../editor/completion';
import { identNeedsQuoting, quoteIdent, type SqlDialect } from '../shared/sqlIdent';
import { type DdlSchema, namespaceFromCached, toSqlNamespace } from './ddl';
import { sqlKeywordCompletionSource } from './sqlKeywordCompletion';
import { sqlSchemaCompletionSource } from './sqlSchemaCompletion';

// P18 (v1.1) D1 — why this is a "language service", not a language server.
//
// The SPEC row asks for "a SQL language server (completions, diagnostics, hovers)". Those three
// verbs are textDocument/completion, textDocument/publishDiagnostics and textDocument/hover — and
// this app's own `MonacoHost.vue` already exposes each one directly as a `completionSources`
// prop, a `lintSource` prop and a `hoverSource` prop (P60a §3.1). What an LSP actually buys a
// general-purpose editor is process isolation and editor-independence: one server binary serving
// many editors, keeping a heavy analysis off the UI thread. This app has exactly one editor, one
// renderer, and an analysis whose entire state is one parsed object — and P58f M10 deleted the
// vendored Node runtime an LSP child process would need, while the shipped build deliberately
// opens no local TCP port for another process to reach (docs/ARCHITECTURE.md's Process model). So:
// three providers over one DdlSchema, composed through props the console already had
// (completionSources, lintSource, hoverSource) — the same providers an LSP would run, in-process,
// with none of the machinery a real one exists for. Don't re-litigate this from the SPEC's wording
// alone.

// P19 D14: fires only at a relation position — right after FROM/JOIN/UPDATE/INTO/TABLE — the same
// "look at the text before the word" technique mongoCompletionSource (completion.ts) uses for its
// own `db.` and `db.<collection>.` positions. Deliberately narrow: offering table names at a bare
// identifier position (a column list, a WHERE clause) would flood it with irrelevant noise, and
// bare identifiers are exactly what the keyword/schema sources already cover.
const RELATION_POSITION_RE = /\b(from|join|update|into|table)\s+$/i;

// P4: a relation name needing quotes (case-sensitive, a reserved word) gets `insert` set to its
// quoted form, the same identNeedsQuoting/quoteIdent rule namespaceFromCached (ddl.ts) and
// views/grid/filterCompletion.ts's own column completions already follow — `label` stays bare so
// matching/highlighting still works against the plain name.
function relationCompletionSource(
  relations: readonly string[],
  dialect: SqlDialect,
): EditorCompletionSource {
  return ({ doc, offset }) => {
    if (relations.length === 0) return null;
    const word = /[\w."]*$/.exec(doc.slice(0, offset));
    const from = word ? offset - word[0].length : offset;
    const before = doc.slice(0, from);
    if (!RELATION_POSITION_RE.test(before)) return null;
    return {
      from,
      options: relations.map((label): EditorCompletion => {
        const completion: EditorCompletion = { label, type: 'class' };
        return identNeedsQuoting(dialect, label)
          ? { ...completion, insert: quoteIdent(dialect, label) }
          : completion;
      }),
    };
  };
}

/** P19 D14, widened by P22c D4 and P4: layered, not all-or-nothing. A DDL document (`schema`) still
 *  wins wholesale when one has any tables — today's schema+keyword pair, now with the relation
 *  source ranked after them so a document's own real column-aware completions are never shadowed
 *  by a bare table name. With no document, `cached` (P22c: the metadata cache's own columns for
 *  this console's container, state/schemaColumns.ts's cachedRelationsFor) fills in the identical
 *  schema-aware completion — table names, `table.` column completion, alias resolution — with no
 *  manual step, ALSO paired with `relations` (P4): a root-opened console's cached container and its
 *  wider set of tree-loaded relation names (completion.ts's own root branch) don't have to be the
 *  same container, so a name the cache doesn't cover but the tree already does is not discarded.
 *  Only once BOTH `schema` and `cached` are empty does `relations` (consoleRelationNames —
 *  completion.ts's own tree-cache read, mirroring mongoCompletionSource's identical technique for
 *  collections) carry the whole load alone, paired with an explicit keyword source the same reason
 *  D5/F3 already gives (`override` replaces language-data sources wholesale). All three empty is
 *  exactly today's `undefined` — deliberate, not a gap to patch by having the language service
 *  query the database itself: D5 keeps the "no introspection from the language layer" rule, and
 *  this file's diagnostics/hover providers read the same effective schema (D6), so completion never
 *  disagrees with them about what the console knows. */
export function sqlCompletionSources(
  dialect: SqlDialect,
  schema: DdlSchema,
  relations: readonly string[] = [],
  cached: readonly RelationColumns[] = [],
): readonly EditorCompletionSource[] | undefined {
  if (schema.tables.length > 0) {
    return [
      sqlSchemaCompletionSource(dialect, toSqlNamespace(schema)),
      sqlKeywordCompletionSource(dialect),
      relationCompletionSource(relations, dialect),
    ];
  }
  if (cached.length > 0) {
    return [
      sqlSchemaCompletionSource(dialect, namespaceFromCached(cached, dialect)),
      sqlKeywordCompletionSource(dialect),
      // P4: was missing here with no stated reason — relations from a container OTHER than the
      // cached one (the common shape for a root-opened console, completion.ts's own root branch)
      // were silently discarded even though the document branch above already offers this.
      relationCompletionSource(relations, dialect),
    ];
  }
  if (relations.length > 0) {
    return [relationCompletionSource(relations, dialect), sqlKeywordCompletionSource(dialect)];
  }
  return undefined;
}
