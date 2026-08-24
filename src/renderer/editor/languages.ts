import { json } from '@codemirror/lang-json';
import { MySQL, PostgreSQL, sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage, type StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

/** The six grammars an editor surface can request. `formats.ts` maps CellFormat onto the first
 *  four; `mongo`/`redis` are the addendum's console-only highlighting modes (D23). */
export type EditorLanguageId = 'json' | 'xml' | 'sql' | 'mongo' | 'redis' | 'plain';

// P18 addendum D23: highlighting only, no completion language data — the console's own
// `completionSources` prop (CodeMirrorHost.vue) carries the tab-specific source instead, so
// neither mode needs redefining when the tree loads or a tab switches.

// db.<collection>.<method>(<args>) — engine/adapters/mongo/console.ts's own grammar (F4),
// tokenized loosely enough to color it, not to validate it (validation stays server-side, D24).
interface MongoTokenState {
  afterDot: boolean;
}

function mongoToken(stream: StringStream, state: MongoTokenState): string | null {
  if (stream.match('//')) {
    stream.skipToEnd();
    return 'comment';
  }
  if (stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
    state.afterDot = false;
    return 'string';
  }
  if (stream.match(/^\d+(\.\d+)?/)) {
    state.afterDot = false;
    return 'number';
  }
  if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) {
    state.afterDot = false;
    return 'operator';
  }
  if (stream.match('.')) {
    state.afterDot = true;
    return 'punctuation';
  }
  if (stream.match(/^[([{}\])]/)) {
    state.afterDot = false;
    return 'bracket';
  }
  if (stream.match(/^[,:]/)) {
    state.afterDot = false;
    return 'punctuation';
  }
  if (stream.match(/^db\b/) && !state.afterDot) {
    return 'keyword';
  }
  if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
    const wasAfterDot = state.afterDot;
    state.afterDot = false;
    return wasAfterDot ? 'propertyName' : 'variableName';
  }
  if (stream.eatSpace()) return null;
  stream.next();
  return null;
}

const mongoLanguage = StreamLanguage.define<MongoTokenState>({
  name: 'mongo',
  startState: () => ({ afterDot: false }),
  token: mongoToken,
});

// A flat `conn.call(command, ...args)` console (F4) — only the first token of a statement reads
// as a command; everything else is an argument (D22 restricts completion the same way).
interface RedisTokenState {
  atCommand: boolean;
}

function redisToken(stream: StringStream, state: RedisTokenState): string | null {
  if (stream.sol()) state.atCommand = true;
  if (stream.eatSpace()) return null;
  if (stream.match(';')) {
    state.atCommand = true;
    return 'punctuation';
  }
  if (stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
    state.atCommand = false;
    return 'string';
  }
  if (stream.match(/^\d+(\.\d+)?/)) {
    state.atCommand = false;
    return 'number';
  }
  if (stream.match(/^[^\s'";]+/)) {
    const wasCommand = state.atCommand;
    state.atCommand = false;
    return wasCommand ? 'keyword' : null;
  }
  stream.next();
  return null;
}

const redisLanguage = StreamLanguage.define<RedisTokenState>({
  name: 'redis',
  startState: () => ({ atCommand: true }),
  token: redisToken,
});

/**
 * Static imports, not dynamic — the grammars are small, and an `await import()` in the
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
      // P18 addendum D19: uppercases keywords, type names and builtins (VARCHAR, NOW) alike —
      // conventional SQL house style and consistent with the WHERE/ORDER BY boxes' own curated
      // vocabularies (filterCompletion.ts), which are uppercase by construction. FuzzyMatcher
      // case-folds, so typing `sel` still matches `SELECT`.
      return sql({
        dialect: dialect === 'postgres' ? PostgreSQL : dialect === 'mariadb' ? MySQL : undefined,
        upperCaseKeywords: true,
      });
    case 'mongo':
      return mongoLanguage.extension;
    case 'redis':
      return redisLanguage.extension;
    case 'plain':
      return [];
  }
}
