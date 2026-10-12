// P60b §3.3: the per-dialect keyword/type vocabularies `sql-tokens.ts`'s scanner classifies a
// word against. Curated, not exhaustive — the same "most likely to collide" judgement
// `views/shared/sqlIdent.ts`'s own `COMMON_RESERVED` set already makes for this app (D8's own
// rationale), and the one `editor/languages.ts`'s now-removed `ClickHouseDialect` string already
// made for ClickHouse specifically. Exhaustive (lang-sql's own Postgres list runs 763 words) would
// classify far more identifiers as `Keyword`, which every consumer already tolerates in a name
// position (`isNameNode`) but which widens accidental `END_FROM`/`joinStart`-style matches for a
// column or table that happens to share a word with some obscure clause keyword.
//
// Not `SqlDialect` from `views/shared/sqlIdent.ts` — this package (`packages/shared/domain`) is
// imported by more than this app's renderer (D9's own precedent, `ddl.ts`'s header comment) and
// must not depend on a frontend-only module. The four members below are structurally identical to
// that app-level type, so passing one of its values in here needs no import, no cast.
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse';

// The union every dialect's set must contain, regardless of curation — a word missing here
// silently changes what `sql-tokens.ts`'s grouping/consumers see as a `Keyword` vs. a plain
// `Identifier` (§3.3's own worked example: without `primary`, `PRIMARY KEY (a, b)` parses as a
// *column* named `PRIMARY`, the exact phantom `ddl.ts`'s `TABLE_CONSTRAINT_LEADING` exists to
// prevent). Assembled from every consumer that branches on `name === 'Keyword'`:
// `ddl.ts`'s `TABLE_CONSTRAINT_LEADING`/`TYPE_STOP_WORDS`, `sqlRefs.ts`'s `END_FROM`/`joinStart`,
// plus the statement/clause words the walkers themselves consume.
// P107 I2-41: exported so `sql-keywords.spec.ts` asserts against this set directly, rather than
// keeping its own duplicated copy that could drift from it silently.
export const REQUIRED_MINIMUM = new Set([
  // TABLE_CONSTRAINT_LEADING (ddl.ts)
  'primary',
  'unique',
  'foreign',
  'constraint',
  'key',
  'check',
  'index',
  'fulltext',
  'spatial',
  // TYPE_STOP_WORDS (ddl.ts)
  'not',
  'default',
  'references',
  'collate',
  'generated',
  'auto_increment',
  'autoincrement',
  'comment',
  'materialized',
  'alias',
  'codec',
  'ttl',
  // END_FROM (sqlRefs.ts)
  'where',
  'group',
  'having',
  'order',
  'union',
  'intersect',
  'except',
  'all',
  'distinct',
  'limit',
  'offset',
  'fetch',
  'for',
  // joinStart (sqlRefs.ts)
  'join',
  'left',
  'right',
  'inner',
  'full',
  'cross',
  'natural',
  // statement/clause words the walkers themselves consume
  'create',
  'or',
  'replace',
  'table',
  'view',
  'alter',
  'add',
  'column',
  'on',
  'is',
  'if',
  'exists',
  'as',
  'with',
  'recursive',
  'from',
  'using',
  'set',
  'values',
  'insert',
  'update',
  'delete',
  'select',
]);

// A wider, still-curated common-SQL vocabulary — standard clauses/operators this app's own
// completion and highlighting should recognise even though no walker branches on them by name.
const COMMON_SQL = new Set([
  'by',
  'asc',
  'desc',
  'into',
  'grant',
  'revoke',
  'to',
  'begin',
  'commit',
  'rollback',
  'transaction',
  'database',
  'schema',
  'function',
  'procedure',
  'trigger',
  'sequence',
  'and',
  'or',
  'not',
  'null',
  'in',
  'like',
  'between',
  'case',
  'when',
  'then',
  'else',
  'end',
  'cascade',
  'restrict',
  'true',
  'false',
  'drop',
  'returning',
  'only',
  'lateral',
  'do',
  'nothing',
  'conflict',
  'temporary',
  'temp',
  'unlogged',
  'serial',
  'bigserial',
  'smallserial',
  'identity',
  'always',
  'ilike',
  'similar',
  'array',
  'current_timestamp',
  'current_date',
  'current_time',
  'current_user',
  'session_user',
  'cast',
  'extract',
  'over',
  'partition',
  'row',
  'rows',
  'range',
  'preceding',
  'following',
  'unbounded',
  'current',
  'first',
  'last',
  'nulls',
  'filter',
  'within',
  'window',
  'explain',
  'analyze',
  'vacuum',
  'truncate',
  'cascade',
]);

const POSTGRES_ONLY = new Set([
  'returning',
  'jsonb',
  'bytea',
  'uuid',
  'cidr',
  'inet',
  'macaddr',
  'money',
  'point',
  'box',
  'circle',
  'line',
  'path',
  'polygon',
  'tsquery',
  'tsvector',
  'xml',
  'inherits',
  'tablespace',
  'concurrently',
]);

const MYSQL_ONLY = new Set([
  'engine',
  'charset',
  'character',
  'collate',
  'unsigned',
  'zerofill',
  'auto_increment',
  'ignore',
  'low_priority',
  'delayed',
  'algorithm',
  'lock',
  'inplace',
  'copy',
  'instant',
  'year',
  'mediumint',
  'tinyint',
  'binary',
  'varbinary',
]);

const SQLITE_ONLY = new Set([
  'autoincrement',
  'without',
  'rowid',
  'virtual',
  'glob',
  'regexp',
  'pragma',
  'attach',
  'detach',
  'vacuum',
]);

// P36 D30: moved here verbatim from `editor/languages.ts`'s now-removed `ClickHouseDialect` —
// same curated string, split on whitespace — widened by REQUIRED_MINIMUM below (this repo's own
// pre-P60b list did not cover `unique`/`foreign`/`references`/`column`/`add`/`recursive`/…, which
// §3.3 requires for every dialect now that lang-sql's own broader keyword set is gone).
const CLICKHOUSE_CURATED =
  'select from where group by order having limit offset with as distinct into values ' +
  'insert update delete alter create drop table database view materialized dictionary ' +
  'engine order primary key partition sample ttl settings format prewhere final sample ' +
  'array join left right inner full cross global any all asof using on and or not in is ' +
  'null between like exists case when then else end union all describe desc show exists ' +
  'attach detach optimize truncate rename kill system cluster replace if not exists ' +
  'with fill step interpolate limit by offset settings';

const CLICKHOUSE_TYPES =
  'string fixedstring uint8 uint16 uint32 uint64 uint128 uint256 int8 int16 int32 int64 ' +
  'int128 int256 float32 float64 decimal decimal32 decimal64 decimal128 decimal256 bool ' +
  'boolean date date32 datetime datetime64 time time64 uuid ipv4 ipv6 enum enum8 enum16 ' +
  'array tuple map nested lowcardinality nullable json dynamic variant point ring polygon ' +
  'multipolygon aggregatefunction simpleaggregatefunction';

const STANDARD_TYPES = new Set([
  'int',
  'integer',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'varchar',
  'char',
  'character',
  'text',
  'boolean',
  'bool',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'datetime',
  'json',
  'jsonb',
  'uuid',
  'blob',
  'bytea',
  'serial',
  'bigserial',
  'array',
  'enum',
  'money',
  'interval',
  'bit',
  'xml',
  'binary',
  'varbinary',
]);

const keywordCache = new Map<SqlDialect, ReadonlySet<string>>();
const typeCache = new Map<SqlDialect, ReadonlySet<string>>();

function buildKeywords(dialect: SqlDialect): ReadonlySet<string> {
  const words = new Set([...REQUIRED_MINIMUM, ...COMMON_SQL]);
  switch (dialect) {
    case 'postgres':
      for (const w of POSTGRES_ONLY) words.add(w);
      break;
    case 'mysql':
      for (const w of MYSQL_ONLY) words.add(w);
      break;
    case 'sqlite':
      for (const w of SQLITE_ONLY) words.add(w);
      break;
    case 'clickhouse':
      for (const w of CLICKHOUSE_CURATED.split(/\s+/)) words.add(w);
      break;
  }
  return words;
}

function buildTypes(dialect: SqlDialect): ReadonlySet<string> {
  if (dialect === 'clickhouse') return new Set(CLICKHOUSE_TYPES.split(/\s+/));
  const types = new Set(STANDARD_TYPES);
  if (dialect === 'mysql') {
    for (const w of ['year', 'mediumint', 'longtext', 'mediumtext', 'tinytext', 'set']) {
      types.add(w);
    }
  }
  if (dialect === 'postgres') {
    for (const w of ['cidr', 'inet', 'macaddr', 'point', 'box', 'circle', 'line', 'path']) {
      types.add(w);
    }
  }
  return types;
}

/** The full keyword vocabulary for `dialect` — every word `sql-tokens.ts`'s scanner classifies as
 *  a `Keyword` node rather than a plain `Identifier`. Memoised: the same `ReadonlySet` reference
 *  comes back for a given dialect every call, which is what lets `sql-tokens.ts`'s own tokenize
 *  memo (D2) compare `SqlTokenOptions` by reference. */
export function keywordsFor(dialect: SqlDialect): ReadonlySet<string> {
  let cached = keywordCache.get(dialect);
  if (!cached) {
    cached = buildKeywords(dialect);
    keywordCache.set(dialect, cached);
  }
  return cached;
}

/** Type names for `dialect`, uppercased at the completion boundary (`sqlKeywordCompletion.ts`) —
 *  not classified as `Keyword` by the scanner itself (a declared column type is an ordinary
 *  `Identifier` in `ddl.ts`'s own type-slice reading, F5.2's own comment), only offered as
 *  completion vocabulary. */
export function typesFor(dialect: SqlDialect): ReadonlySet<string> {
  let cached = typeCache.get(dialect);
  if (!cached) {
    cached = buildTypes(dialect);
    typeCache.set(dialect, cached);
  }
  return cached;
}
