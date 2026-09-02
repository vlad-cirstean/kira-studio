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

/** D5: the console's completion source for a SQL kind — undefined when there is no DDL document
 *  for this connection, which leaves lang-sql's own language-data keyword source in charge
 *  (byte-for-byte today's behaviour, before this phase). This is deliberate, not a gap to patch
 *  by falling back to the tree's own live metadata cache (`runtime[tabId].meta`): the SPEC row
 *  forbids schema introspection over a real connection, and a silent fallback here would make the
 *  DDL surface look broken whenever it's simply empty. */
export function sqlCompletionSources(
  dialect: SqlDialect,
  schema: DdlSchema,
  database: string | null | undefined,
): readonly CompletionSource[] | undefined {
  if (schema.tables.length === 0) return undefined;
  const dialectObject = dialectObjectFor(dialect);
  if (!dialectObject) return undefined;
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
  ];
}
