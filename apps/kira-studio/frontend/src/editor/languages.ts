import { json } from '@codemirror/lang-json';
import { MySQL, PostgreSQL, SQLDialect, SQLite, sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage, type StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import type { SqlDialect } from '../views/shared/sqlIdent';

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

// P36 D30: a third shape in this file, beside "map to a vendored @codemirror/lang-sql dialect"
// (postgres/mysql/sqlite above) and "hand-write a StreamLanguage" (mongo/redis above) — ClickHouse
// has no vendored dialect, but its grammar is close enough to standard SQL that SQLDialect.define
// still fits; only a StandardSQL-shaped config, not a bespoke tokenizer, is needed. Curated, not
// exhaustive — the same "most likely to collide" judgement sqlIdent.ts's own COMMON_RESERVED set
// makes, not a transcription of ClickHouse's full grammar.
const ClickHouseDialect = /*@__PURE__*/ SQLDialect.define({
  // F27: string literals use backslash escapes (verified empirically, mutate.ts's own D6 note).
  backslashEscapes: true,
  // ClickHouse accepts both `--` (StandardSQL default) and `#`/`#!` as a line comment.
  hashComments: true,
  // Double quotes quote an *identifier* here (like Postgres), never a string — the opposite of
  // MySQL's own doubleQuotedStrings: true above; identifierQuotes below adds backtick alongside it
  // (F28: create_table_query's own output backtick-quotes, D29).
  doubleQuotedStrings: false,
  identifierQuotes: '`"',
  keywords:
    'select from where group by order having limit offset with as distinct into values ' +
    'insert update delete alter create drop table database view materialized dictionary ' +
    'engine order primary key partition sample ttl settings format prewhere final sample ' +
    'array join left right inner full cross global any all asof using on and or not in is ' +
    'null between like exists case when then else end union all describe desc show exists ' +
    'attach detach optimize truncate rename kill system cluster replace if not exists ' +
    'with fill step interpolate limit by offset settings',
  types:
    'string fixedstring uint8 uint16 uint32 uint64 uint128 uint256 int8 int16 int32 int64 ' +
    'int128 int256 float32 float64 decimal decimal32 decimal64 decimal128 decimal256 bool ' +
    'boolean date date32 datetime datetime64 time time64 uuid ipv4 ipv6 enum enum8 enum16 ' +
    'array tuple map nested lowcardinality nullable json dynamic variant point ring polygon ' +
    'multipolygon aggregatefunction simpleaggregatefunction',
});

// P18 (v1.1) C1: the one place a SqlDialect id becomes lang-sql's own SQLDialect object — pulled
// out of languageExtension's own ternary chain so the DDL extractor and the schema completion
// source (sqlLanguageService.ts) share this exact mapping rather than re-deriving it. Pure move,
// no behaviour change.
export function dialectObjectFor(dialect: SqlDialect | undefined): SQLDialect | undefined {
  switch (dialect) {
    case 'postgres':
      return PostgreSQL;
    case 'mysql':
      return MySQL;
    case 'sqlite':
      return SQLite;
    case 'clickhouse':
      return ClickHouseDialect;
    default:
      return undefined;
  }
}

/**
 * Static imports, not dynamic — the grammars are small, and an `await import()` in the
 * middle of the 50 ms selection path (SPEC §2.1) would buy nothing and would race two rapid
 * cell clicks against each other.
 */
export function languageExtension(id: EditorLanguageId, dialect?: SqlDialect): Extension {
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
      return sql({ dialect: dialectObjectFor(dialect), upperCaseKeywords: true });
    case 'mongo':
      return mongoLanguage.extension;
    case 'redis':
      return redisLanguage.extension;
    case 'plain':
      return [];
  }
}
