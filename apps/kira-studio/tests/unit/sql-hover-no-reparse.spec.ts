// P12 round 2 finding #11: sqlHover.ts's resolveHover used to always call
// `dialect.language.parser.parse(doc)` from scratch, redundant with the tree
// `@codemirror/language` already maintains incrementally — measured up to ~51ms on a 191KB
// document, over the app's own 50ms interaction budget, with no debounce (unlike the lint path).
// editor/hover.ts's buildHoverSource now reads `syntaxTree(view.state)` once and hands it to the
// lookup; this proves the dialect's own parser is never invoked when a real EditorView/state (with
// the tree already available) drives the hover.
import { describe, expect, test } from 'bun:test';
import { PostgreSQL } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import type { DdlSchema } from '../../frontend/src/views/console/ddl';
import { sqlHoverSource } from '../../frontend/src/views/console/sqlHover';

const SCHEMA: DdlSchema = {
  tables: [{ name: 'users', columns: [{ name: 'id', type: 'integer' }] }],
};

describe("sqlHover reuses CodeMirror's own syntax tree instead of re-parsing (P12 round 2 F11)", () => {
  test('the dialect parser is never called when the EditorState already has a tree', () => {
    const sql = 'SELECT users.id FROM users';
    const state = EditorState.create({ doc: sql, extensions: [PostgreSQL.language] });

    const parser = PostgreSQL.language.parser;
    const originalParse = parser.parse.bind(parser);
    let parseCalls = 0;
    // Monkeypatching a shared library singleton to count calls, restored in `finally` below.
    parser.parse = ((...args: Parameters<typeof originalParse>) => {
      parseCalls++;
      return originalParse(...args);
    }) as typeof originalParse;

    try {
      const source = sqlHoverSource(PostgreSQL, SCHEMA);
      expect(source).toBeDefined();
      const view = { state } as unknown as Parameters<NonNullable<typeof source>>[0];
      const pos = sql.indexOf('users.id') + 'users.'.length + 1; // inside "id"
      const tooltip = source?.(view, pos, 1);
      expect(tooltip).not.toBeNull(); // sanity: hover actually resolved something
      expect(parseCalls).toBe(0);
    } finally {
      PostgreSQL.language.parser.parse = originalParse;
    }
  });
});
