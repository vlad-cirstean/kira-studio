import type { Redis } from 'ioredis';

// Redis has no .sql-file seeding path either (mirrors 0003_mongo_seed.ts's own JS/TS seed
// function) — run once against the primary db by support/redis.ts.
//
// Fixed shapes across all six renderer types (§8.8) plus a multi-level `:`-namespace tree, so
// catalog.ts's SCAN-splitting and read.ts's per-type dispatch both have something real to walk.
export const LIST_LENGTH = 30; // > one PAGE_SIZE's worth, so offset pagination genuinely pages
export const SET_MEMBERS = ['red', 'green', 'blue'];
export const ZSET_MEMBERS: Array<[member: string, score: number]> = [
  ['alice', 10],
  ['bob', 20],
  ['carol', 30],
];
export const HASH_FIELDS: Record<string, string> = { age: '30', city: 'NYC' };
export const STREAM_ENTRY_COUNT = 5;
export const LIST_KEY = 'queue:jobs';
export const SET_KEY = 'tags:featured';
export const ZSET_KEY = 'leaderboard';
export const STREAM_KEY = 'events:log';
export const HASH_KEY = 'user:1:profile';
export const TTL_KEY = 'session:abc';

export async function seedRedis(conn: Redis): Promise<void> {
  // A root-level key with no ':' — namespace splitting must still surface it as a 'key' leaf
  // directly under the db, not swallow it while walking namespaces (P9's D3/D4).
  await conn.set('counter', '42');

  await conn.set(TTL_KEY, 'token-abc');
  await conn.expire(TTL_KEY, 10_000);

  // A two-level 'user:1:*' namespace with siblings at both the leaf and namespace level, plus a
  // 'user:2:*' sibling namespace — exercises catalog.ts's namespace/key split at more than one
  // depth.
  await conn.set('user:1:name', 'Alice');
  await conn.set('user:1:email', 'alice@example.com');
  await conn.hset(HASH_KEY, HASH_FIELDS);
  await conn.set('user:2:name', 'Bob');

  const jobs = Array.from({ length: LIST_LENGTH }, (_, i) => `job-${i}`);
  await conn.rpush(LIST_KEY, ...jobs);

  await conn.sadd(SET_KEY, ...SET_MEMBERS);

  await conn.zadd(ZSET_KEY, ...ZSET_MEMBERS.flatMap(([member, score]) => [score, member]));

  for (let i = 0; i < STREAM_ENTRY_COUNT; i++) {
    await conn.xadd(STREAM_KEY, '*', 'type', 'click', 'seq', String(i));
  }
}
