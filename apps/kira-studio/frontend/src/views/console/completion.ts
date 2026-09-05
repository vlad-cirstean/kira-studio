import { type CompletionSource, snippet } from '@codemirror/autocomplete';
import type { ConnectionKind } from '@shared/domain/connection';
import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import { decodePath, encodePath, type PathSegment } from '@shared/domain/tree';
import { rowKey, treeState } from '../../project/state/tree';
import {
  MONGO_QUERY_OPERATORS,
  MONGO_VALUE_CONSTRUCTORS,
  type MongoValueConstructor,
} from '../shared/mongoVocabulary';
import { sqlDialectFor } from '../shared/sqlIdent';
import { type DdlSchema, EMPTY_DDL_SCHEMA } from './ddl';
import { sqlCompletionSources } from './sqlLanguageService';

// P27 D17: reuses the same {insert, caretOffsetFromEnd} vocabulary the filter bar's plain
// AutocompleteField consumes — only the caret-positioning mechanism differs, since CodeMirror has
// its own (a `#{}` snippet placeholder) rather than an offset-from-end number.
function toSnippetTemplate(c: MongoValueConstructor): string {
  const pos = c.insert.length - c.caretOffsetFromEnd;
  return `${c.insert.slice(0, pos)}#{}${c.insert.slice(pos)}`;
}

// P18 addendum D21: the first path segment is the database node's own key
// (`database:<name>`, shared/domain/tree.ts's encodePath) — a console opened from a database or
// collection row always carries it; one opened from the connection root does not, and
// mongoCollectionNames degrades to an empty list rather than guessing.
function databaseSegment(path: string): string | null {
  const [first] = path.split('/');
  return first?.startsWith('database:') ? first : null;
}

// F5: reads the tree's own cache — no new round trip, no new cache. Empty (never expanded, or
// opened from the connection root) is the honest degradation the acceptance checklist names, not
// an error: the method/operator positions below don't depend on this at all.
function mongoCollectionNames(connectionId: string, path: string): string[] {
  const segment = databaseSegment(path);
  if (!segment) return [];
  const nodes = treeState.children[rowKey(connectionId, segment)] ?? [];
  return nodes.filter((n) => n.kind === 'collection').map((n) => n.name);
}

const RELATION_CONTAINER_KINDS = new Set(['database', 'schema']);

// P19 D14: mongoCollectionNames' own technique, carried to SQL — reads the tree's own cache, no
// new round trip, no new cache, an empty list is the honest degradation. Walks the console's own
// path back to the last database:/schema: segment (a table/view/matview console keeps its parent
// container in its own path; a console opened on the container itself already ends there) and
// reads whatever that row's own children already are. A console opened from the connection root
// has no such segment and yields []; project/state/tree.ts's own F19 finding means this can never
// see 'column' nodes (they moved into the definition view), only relation names.
export function consoleRelationNames(connectionId: string, path: string): string[] {
  let segments: PathSegment[];
  try {
    segments = decodePath(connectionId, path).segments;
  } catch {
    return [];
  }
  let cut = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (RELATION_CONTAINER_KINDS.has(segments[i]?.kind ?? '')) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return [];
  const containerPath = encodePath(segments.slice(0, cut + 1));
  const nodes = treeState.children[rowKey(connectionId, containerPath)] ?? [];
  return nodes
    .filter((n) => n.kind === 'table' || n.kind === 'view' || n.kind === 'matview')
    .map((n) => n.name);
}

// D21: three contextual positions, each independent of the others — offering a method the engine
// will reject would be worse than offering nothing, so this stays exactly as narrow as
// mongo/console.ts's own grammar (db.<collection>.<method>(<args>)).
function mongoCompletionSource(connectionId: string, path: string): CompletionSource {
  return (context) => {
    // Deliberately not gated on "word non-empty or explicit" the way a generic word-completion
    // source would be: the two `before`-anchored positions below (right after `db.` or
    // `db.<collection>.`) are exactly where the current word is empty — that emptiness is the
    // trigger, not a reason to bail.
    const word = context.matchBefore(/[$\w]*/) ?? { from: context.pos, to: context.pos, text: '' };
    const before = context.state.sliceDoc(0, word.from);

    if (/\bdb\.$/.test(before)) {
      const names = mongoCollectionNames(connectionId, path);
      if (names.length === 0) return null;
      return { from: word.from, options: names.map((label) => ({ label, type: 'variable' })) };
    }
    if (/\bdb\.[A-Za-z_$][\w$]*\.$/.test(before)) {
      return {
        from: word.from,
        options: MONGO_CONSOLE_METHODS.map((label) => ({ label, type: 'method' })),
      };
    }
    if (word.text.startsWith('$')) {
      return {
        from: word.from,
        options: MONGO_QUERY_OPERATORS.map((label) => ({ label, type: 'keyword' })),
      };
    }
    // P27 D17: the six BSON constructors — offered wherever a bare word starts, same as any other
    // identifier completion; CodeMirror's own default matching narrows the list as more is typed.
    if (/^[A-Za-z]/.test(word.text)) {
      return {
        from: word.from,
        options: MONGO_VALUE_CONSTRUCTORS.map((c) => ({
          label: c.name,
          apply: snippet(toSnippetTemplate(c)),
          type: 'function',
        })),
      };
    }
    return null;
  };
}

interface RedisCommandInfo {
  name: string;
  hint: string;
}

// D22: the arity hint (`detail`) is the part a user actually cannot remember — the command list
// itself is curated, not exhaustive (this app's own convention, P18 D8's rationale applies
// equally here): common data-access commands across every type this app's KeyValueView renders
// (string/hash/list/set/zset) plus the handful of housekeeping commands every session needs.
const REDIS_COMMANDS: readonly RedisCommandInfo[] = [
  { name: 'GET', hint: 'GET key' },
  { name: 'SET', hint: 'SET key value' },
  { name: 'SETEX', hint: 'SETEX key seconds value' },
  { name: 'DEL', hint: 'DEL key [key ...]' },
  { name: 'EXISTS', hint: 'EXISTS key [key ...]' },
  { name: 'EXPIRE', hint: 'EXPIRE key seconds' },
  { name: 'TTL', hint: 'TTL key' },
  { name: 'KEYS', hint: 'KEYS pattern' },
  { name: 'SCAN', hint: 'SCAN cursor [MATCH pattern] [COUNT count]' },
  { name: 'TYPE', hint: 'TYPE key' },
  { name: 'PERSIST', hint: 'PERSIST key' },
  { name: 'RENAME', hint: 'RENAME key newkey' },
  { name: 'INCR', hint: 'INCR key' },
  { name: 'DECR', hint: 'DECR key' },
  { name: 'HGET', hint: 'HGET key field' },
  { name: 'HSET', hint: 'HSET key field value [field value ...]' },
  { name: 'HGETALL', hint: 'HGETALL key' },
  { name: 'HDEL', hint: 'HDEL key field [field ...]' },
  { name: 'LPUSH', hint: 'LPUSH key value [value ...]' },
  { name: 'RPUSH', hint: 'RPUSH key value [value ...]' },
  { name: 'LRANGE', hint: 'LRANGE key start stop' },
  { name: 'SADD', hint: 'SADD key member [member ...]' },
  { name: 'SMEMBERS', hint: 'SMEMBERS key' },
  { name: 'ZADD', hint: 'ZADD key score member [score member ...]' },
  { name: 'ZRANGE', hint: 'ZRANGE key start stop [WITHSCORES]' },
  { name: 'PING', hint: 'PING' },
];

// True only when everything since the start of the statement (or since the last `;`) is
// whitespace — the tokenizer position is derivable straight from the text before the caret, no
// parse needed. No key-name completion, no argument completion (D22, F5).
const REDIS_FIRST_TOKEN_RE = /(^|;)\s*$/;

function redisCompletionSource(): CompletionSource {
  return (context) => {
    const word = context.matchBefore(/[^\s;]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const before = context.state.sliceDoc(0, word.from);
    if (!REDIS_FIRST_TOKEN_RE.test(before)) return null;
    return {
      from: word.from,
      options: REDIS_COMMANDS.map((cmd) => ({
        label: cmd.name,
        detail: cmd.hint,
        type: 'keyword',
      })),
    };
  };
}

/** For the five SQL kinds: undefined with no DDL document for this connection (D5, lang-sql's own
 *  language-data keyword source stays in charge — the console's `autocomplete` prop is what gates
 *  SQL completion generally); P18 (v1.1)'s schema+keyword pair (sqlLanguageService.ts) once one
 *  exists. */
export function consoleCompletionSources(
  kind: ConnectionKind,
  connectionId: string | null,
  path: string,
  schema?: DdlSchema,
  database?: string | null,
): readonly CompletionSource[] | undefined {
  if (kind === 'mongodb' && connectionId) return [mongoCompletionSource(connectionId, path)];
  if (kind === 'redis') return [redisCompletionSource()];
  const dialect = sqlDialectFor(kind);
  if (!dialect) return undefined;
  // P19 D14: layered now, not all-or-nothing — a DDL document (schema) still wins when one
  // exists, but a connection with none still gets table-name completion from the tree's own
  // cache (relations), the same technique mongoCompletionSource already uses for collections.
  const relations = connectionId ? consoleRelationNames(connectionId, path) : [];
  return sqlCompletionSources(dialect, schema ?? EMPTY_DDL_SCHEMA, database, relations);
}
