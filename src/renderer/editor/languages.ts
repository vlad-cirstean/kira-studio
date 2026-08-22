import { json } from '@codemirror/lang-json';
import { MySQL, PostgreSQL, sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import type { Extension } from '@codemirror/state';

/** The four grammars an editor surface can request. `formats.ts` maps CellFormat onto this. */
export type EditorLanguageId = 'json' | 'xml' | 'sql' | 'plain';

/**
 * Static imports, not dynamic — the three grammars are small, and an `await import()` in the
 * middle of the 50 ms selection path (SPEC §2.1) would buy nothing and would race two rapid
 * cell clicks against each other.
 */
export function languageExtension(
  id: EditorLanguageId,
  dialect?: 'postgres' | 'mariadb',
): Extension {
  switch (id) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'sql':
      return sql({
        dialect: dialect === 'postgres' ? PostgreSQL : dialect === 'mariadb' ? MySQL : undefined,
      });
    case 'plain':
      return [];
  }
}
