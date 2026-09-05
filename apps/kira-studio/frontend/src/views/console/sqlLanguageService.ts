import type { CompletionSource } from '@codemirror/autocomplete';
import { keywordCompletionSource, schemaCompletionSource } from '@codemirror/lang-sql';
import { dialectObjectFor } from '../../editor/languages';
import type { SqlDialect } from '../shared/sqlIdent';
import { type DdlSchema, defaultSchemaFor, toSqlNamespace } from './ddl';

// P18 (v1.1) D1 — why this is a "language service", not a language server.
//
// The SPEC row asks for "a SQL language server (completions, diagnostics, hovers)". Those three
// verbs are textDocument/completion, textDocument/publishDiagnostics and textDocument/hover — and
// CodeMirror's own extension model already exposes each one directly as a CompletionSource,
// linter() and hoverTooltip(), two of which this app was already wired for. What an LSP actually
// buys a general-purpose editor is process isolation and editor-independence: one server binary
// serving many editors, keeping a heavy analysis off the UI thread. This app has exactly one
// editor, one renderer, and an analysis whose entire state is one parsed object — and P58f M10
// deleted the vendored Node runtime an LSP child process would need, while the shipped build
// deliberately opens no local TCP port for another process to reach (docs/ARCHITECTURE.md's
// Process model). So: three providers over one DdlSchema, composed through props the console
// already had (completionSources, lintSource) plus one small additive host prop for hovers
// (CodeMirrorHost.vue's hoverSource) — the same providers an LSP would run, in-process, with none
// of the machinery a real one exists for. Don't re-litigate this from the SPEC's wording alone.

// P19 D14: fires only at a relation position — right after FROM/JOIN/UPDATE/INTO/TABLE — the same
// "look at the text before the word" technique mongoCompletionSource (completion.ts) uses for its
// own `db.` and `db.<collection>.` positions. Deliberately narrow: offering table names at a bare
// identifier position (a column list, a WHERE clause) would flood it with irrelevant noise, and
// bare identifiers are exactly what the keyword/schema sources already cover.
const RELATION_POSITION_RE = /\b(from|join|update|into|table)\s+$/i;

function relationCompletionSource(relations: readonly string[]): CompletionSource {
  return (context) => {
    if (relations.length === 0) return null;
    const word = context.matchBefore(/[\w."]*/) ?? { from: context.pos, to: context.pos, text: '' };
    const before = context.state.sliceDoc(0, word.from);
    if (!RELATION_POSITION_RE.test(before)) return null;
    return { from: word.from, options: relations.map((label) => ({ label, type: 'class' })) };
  };
}

/** D14: two layers, not all-or-nothing. A DDL document (`schema`) still wins when one exists —
 *  today's schemaCompletionSource + keyword pair, now with the relation source ranked after them
 *  so a document's own real column-aware completions are never shadowed by a bare table name.
 *  With no document, `relations` (consoleRelationNames — completion.ts's own tree-cache read,
 *  mirroring mongoCompletionSource's identical technique for collections) still gets table names,
 *  paired with an explicit keyword source the same reason D5/F3 already gives (`override`
 *  replaces language-data sources wholesale). Both empty is exactly today's `undefined` — this is
 *  deliberate, not a gap to patch by having the language service query the database itself: the
 *  SPEC row forbids schema introspection over a real connection, and both this file's diagnostics
 *  and hover providers read the exact same `DdlSchema`/tree cache, so completion never disagrees
 *  with them about what the console knows. */
export function sqlCompletionSources(
  dialect: SqlDialect,
  schema: DdlSchema,
  database: string | null | undefined,
  relations: readonly string[] = [],
): readonly CompletionSource[] | undefined {
  const dialectObject = dialectObjectFor(dialect);
  if (!dialectObject) return undefined;
  if (schema.tables.length > 0) {
    return [
      schemaCompletionSource({
        dialect: dialectObject,
        schema: toSqlNamespace(schema),
        defaultSchema: defaultSchemaFor(schema, dialect, database),
      }),
      // D5/F3: schemaCompletionSource's own `override` array replaces language-data sources
      // wholesale, so the keyword source it displaces has to be re-added explicitly — this is
      // exactly today's `upperCaseKeywords: true` behaviour (languages.ts), made explicit rather
      // than implicit.
      keywordCompletionSource(dialectObject, true),
      relationCompletionSource(relations),
    ];
  }
  if (relations.length > 0) {
    return [relationCompletionSource(relations), keywordCompletionSource(dialectObject, true)];
  }
  return undefined;
}
