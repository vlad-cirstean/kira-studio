import type { SourceText } from '../../../shared/domain/ddl';
import { encodePath, type NodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import type { QueryExecutor } from './catalog';
import { quoteIdent } from './read';

export type RelationLikeKind = 'table' | 'view';

interface TableTypeRow {
  TABLE_TYPE: string;
}

// pg_get_viewdef/SHOW CREATE emit at most one trailing `;` — remove exactly that, untouched
// otherwise. `statements` carries no trailing semicolons and no blank padding (shared/domain/ddl.ts).
function stripOneTrailingSemicolon(text: string): string {
  const match = /;\s*$/.exec(text);
  return match ? text.slice(0, text.length - match[0].length) : text;
}

/**
 * Passes `SHOW CREATE …` through verbatim — MariaDB is asked, never composed. The one identifier
 * that must reach the statement text goes through `quoteIdent`, resolved from
 * `information_schema` (with bound parameters) in this same op — Adapter rule 7.
 */
export async function buildDdl(
  exec: QueryExecutor,
  segments: NodePath['segments'],
  database: string,
  object: { kind: RelationLikeKind; name: string },
): Promise<SourceText> {
  const [resolved] = await exec<TableTypeRow>(
    `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, object.name],
  );
  if (!resolved) {
    throw new AdapterError('E_NOT_FOUND', `relation "${database}"."${object.name}" not found`);
  }

  const qualified = `${quoteIdent(database)}.${quoteIdent(object.name)}`;
  let statement: string;
  let notes: string[];

  if (resolved.TABLE_TYPE === 'BASE TABLE') {
    const [row] = await exec<Record<string, unknown>>(`SHOW CREATE TABLE ${qualified}`, []);
    const raw = row?.['Create Table'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new AdapterError(
        'E_QUERY',
        `SHOW CREATE TABLE returned no definition for "${database}"."${object.name}"`,
      );
    }
    statement = stripOneTrailingSemicolon(raw);
    notes = ['Triggers and grants are not included in SHOW CREATE TABLE.'];
  } else if (resolved.TABLE_TYPE === 'VIEW') {
    const [row] = await exec<Record<string, unknown>>(`SHOW CREATE VIEW ${qualified}`, []);
    const raw = row?.['Create View'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new AdapterError(
        'E_QUERY',
        `SHOW CREATE VIEW returned no definition for "${database}"."${object.name}"`,
      );
    }
    statement = stripOneTrailingSemicolon(raw);
    notes = [
      "This is the server's own SHOW CREATE VIEW text, including its DEFINER and SQL SECURITY clauses.",
    ];
  } else {
    throw new AdapterError('E_UNSUPPORTED', `ddl is not supported for ${resolved.TABLE_TYPE}`);
  }

  return {
    path: encodePath(segments),
    kind: object.kind,
    qualifiedName: `${database}.${object.name}`,
    statements: [statement],
    origin: 'server',
    notes,
    generatedAt: new Date().toISOString(),
  };
}
