import { encodePath, type TreeNode } from '@shared/domain/tree';
import type { Redis } from 'ioredis';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { mapError } from './errors';

// Never an unbudgeted SCAN (ground rules): a fixed COUNT hint per round-trip, and a hard cap on
// how many rounds one children() call will run — a call degrades to "not everything shown yet
// under this prefix" rather than turning into a full-keyspace crawl.
const SCAN_COUNT = 1000;
const MAX_SCAN_ROUNDS = 200;

export async function listDatabases(primary: Redis): Promise<TreeNode[]> {
  let info: string;
  try {
    info = await primary.info('keyspace');
  } catch (err) {
    throw mapError(err);
  }
  const nodes: TreeNode[] = [];
  for (const line of info.split(/\r?\n/)) {
    const m = /^db(\d+):keys=(\d+)/.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    const keys = Number(m[2]);
    const name = `db${index}`;
    nodes.push({
      kind: 'database',
      name,
      path: encodePath([{ kind: 'database', name }]),
      // P41 D5: a db index's key namespace is unbounded — the tree stops here; the space itself
      // is navigated in a Browse tab (§8.18, gated on caps.keyBrowser), reached via
      // listNamespaceChildren below, which still enumerates it for that second, live caller.
      hasChildren: false,
      detail: `${keys} key${keys === 1 ? '' : 's'}`,
    });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return nodes;
}

export function dbIndexFromName(name: string): number {
  const m = /^db(\d+)$/.exec(name);
  if (!m) throw new AdapterError('E_NOT_FOUND', `not a redis database node: ${name}`);
  return Number(m[1]);
}

// §8.8: namespace tree from SCAN with ':' splitting. `namespaceSegments` is just the local
// segments collected while descending the tree (P9's D3/D4) — joined back into a scan prefix
// here, never reconstructed from a leaf.
export async function listNamespaceChildren(
  conn: Redis,
  dbName: string,
  namespaceSegments: string[],
  ctx: OpCtx,
): Promise<TreeNode[]> {
  const prefix = namespaceSegments.length > 0 ? `${namespaceSegments.join(':')}:` : '';
  const namespaceNodes = new Map<string, TreeNode>();
  const keyNodes = new Map<string, TreeNode>();
  let cursor = '0';
  let rounds = 0;

  do {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    let result: [string, string[]];
    try {
      result = await conn.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', SCAN_COUNT);
    } catch (err) {
      throw mapError(err);
    }
    cursor = result[0];
    for (const key of result[1]) {
      const rest = key.slice(prefix.length);
      const sep = rest.indexOf(':');
      if (sep < 0) {
        keyNodes.set(key, {
          kind: 'key',
          name: key,
          path: encodePath([
            { kind: 'database', name: dbName },
            ...namespaceSegments.map((s) => ({ kind: 'namespace' as const, name: s })),
            { kind: 'key', name: key },
          ]),
          hasChildren: false,
        });
        continue;
      }
      const segment = rest.slice(0, sep);
      if (namespaceNodes.has(segment)) continue;
      const segments = [...namespaceSegments, segment];
      namespaceNodes.set(segment, {
        kind: 'namespace',
        name: segment,
        path: encodePath([
          { kind: 'database', name: dbName },
          ...segments.map((s) => ({ kind: 'namespace' as const, name: s })),
        ]),
        hasChildren: true,
      });
    }
    rounds++;
  } while (cursor !== '0' && rounds < MAX_SCAN_ROUNDS);

  return [
    ...[...namespaceNodes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...[...keyNodes.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ];
}
