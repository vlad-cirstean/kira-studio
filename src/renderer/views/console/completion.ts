import type { CompletionSource } from '@codemirror/autocomplete';
import type { ConnectionKind } from '@shared/domain/connection';
import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import { rowKey, treeState } from '../../project/state/tree';
import { MONGO_QUERY_OPERATORS } from '../shared/mongoVocabulary';

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

/** null/undefined for postgres/mariadb — lang-sql's own language-data source stays in charge
 *  (D23); the console's `autocomplete` prop is what gates SQL completion on those two kinds. */
export function consoleCompletionSources(
  kind: ConnectionKind,
  connectionId: string | null,
  path: string,
): readonly CompletionSource[] | undefined {
  if (kind === 'mongodb' && connectionId) return [mongoCompletionSource(connectionId, path)];
  if (kind === 'redis') return [redisCompletionSource()];
  return undefined;
}
