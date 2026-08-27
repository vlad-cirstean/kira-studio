import type { MutationPlan, MutationResult, MutationRowOp } from '@shared/domain/mutations';
import { encodePath } from '@shared/domain/tree';
import type { Redis } from 'ioredis';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable, throwIfCancelled } from '../errors';
import { mapError } from './errors';

// The reserved sentinels for redis mutations, expressed through the existing relational-shaped
// MutationRowOp rather than widening the shared mutation schema — mirrors mongo/mutate.ts's
// `$document` precedent. `_key` names the target redis key: `plan.path` only ever resolves to a
// database (never a specific key, unlike a SQL table row or a Mongo `_id`), so every op has to
// carry its own key name — including `insert`, which by definition has no existing key a path
// could point at yet. `$value` carries a string SET's new value; `$` can never start a real
// redis key's *field* name inside a hash and `_key` is never a field name at all here (every op
// this module accepts has exactly one field, one of these two), so neither can collide with
// genuine data.
const KEY_SENTINEL = '_key';
const VALUE_SENTINEL = '$value';

function resolveDatabaseSegment(path: MutationPlan['path']): string {
  const [databaseSegment] = path.segments;
  if (databaseSegment?.kind !== 'database') {
    throw new AdapterError(
      'E_NOT_FOUND',
      `mutate requires a database-rooted path, got: ${encodePath(path.segments)}`,
    );
  }
  return databaseSegment.name;
}

function keyNameFrom(values: Record<string, string | null>, label: string): string {
  const raw = values[KEY_SENTINEL];
  if (typeof raw !== 'string' || raw === '') {
    throw new AdapterError(
      'E_QUERY',
      `a redis ${label} mutation requires a non-empty ${KEY_SENTINEL}`,
    );
  }
  return raw;
}

function valueFrom(values: Record<string, string | null>, label: string): string {
  const raw = values[VALUE_SENTINEL];
  if (typeof raw !== 'string') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `a redis ${label} mutation requires a ${VALUE_SENTINEL}`,
    );
  }
  return raw;
}

function renderOpText(op: MutationRowOp): string {
  if (op.kind === 'update')
    return `SET ${keyNameFrom(op.key, 'update')} ${valueFrom(op.changes, 'update')}`;
  if (op.kind === 'delete') return `DEL ${keyNameFrom(op.key, 'delete')}`;
  return `SET ${keyNameFrom(op.values, 'insert')} ${valueFrom(op.values, 'insert')} NX`;
}

// Synchronous (Adapter rule 3): no network, no TYPE lookup — trusts the plan's shape as given,
// same discipline as mongo/mutate.ts's preview().
export function preview(plan: MutationPlan): string[] {
  resolveDatabaseSegment(plan.path);
  return plan.ops.map(renderOpText);
}

// Edit is scoped to string-type keys only in this version (documented scope decision, mirrors
// how P8 scoped Mongo's insert out and P4 scoped DDL's structured metadata out): a hash/list/
// set/zset/stream each has its own per-element mutation semantics (HSET a field, LSET an index,
// SADD/SREM, ZADD, XADD) that are a materially bigger job than a single SET. The UI already
// disables the edit action for those types; this TYPE check enforces it server-side too (§8.12's
// standard — never only greyed out).
async function assertEditableType(conn: Redis, key: string): Promise<void> {
  let rawType: string;
  try {
    rawType = await conn.type(key);
  } catch (err) {
    throw mapError(err);
  }
  if (rawType !== 'none' && rawType !== 'string') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `only string-type keys are editable in this version, ${key} is ${rawType}`,
    );
  }
}

export async function mutate(
  conn: Redis,
  ctx: OpCtx,
  readOnly: boolean,
  plan: MutationPlan,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (mirrors mongo/mariadb/
  // mutate.ts).
  assertWritable(readOnly);
  resolveDatabaseSegment(plan.path);
  ctx.setCommand(preview(plan).join(';\n'));

  let affectedRows = 0;
  try {
    for (const op of plan.ops) {
      throwIfCancelled(ctx);
      if (op.kind === 'update') {
        const key = keyNameFrom(op.key, 'update');
        const value = valueFrom(op.changes, 'update');
        await assertEditableType(conn, key);
        await conn.set(key, value);
        affectedRows += 1;
      } else if (op.kind === 'delete') {
        // DEL is type-agnostic — works for any of the six redis types alike.
        const key = keyNameFrom(op.key, 'delete');
        const deleted = await conn.del(key);
        affectedRows += deleted;
      } else {
        // NX: creating a brand-new key must never silently overwrite an existing one — that's
        // what `update` (a plain SET) is for. A collision surfaces as a query-time condition,
        // not a connection failure (mirrors read.ts's "key no longer exists" precedent).
        const key = keyNameFrom(op.values, 'insert');
        const value = valueFrom(op.values, 'insert');
        const created = await conn.set(key, value, 'NX');
        if (created !== 'OK') throw new AdapterError('E_QUERY', `key already exists: ${key}`);
        affectedRows += 1;
      }
    }
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw mapError(err);
  }

  return { affectedRows };
}
