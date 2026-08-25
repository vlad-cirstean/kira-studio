// P19 D2/D3: renderer-only tree grouping — no adapter changes, no new NodeKind, no path segment.
// A pure transform over an already-fetched child list (project/state/tree.ts's buildRows() is the
// one caller), so it costs no round trip and survives a cached listing unchanged.
import type { ConnectionKind } from '@shared/domain/connection';
import type { NodeKind, TreeNode } from '@shared/domain/tree';

interface KindLabel {
  singular: string;
  plural: string;
}

// P28 D14: the one place a kind gets a human name. Every NodeKind has an entry, not just the five
// that get their own P19 folder — the checkbox filter's Object types section (P28) needs a label
// for every kind present under a connection, and FiltersDialog.vue used to hardcode its own
// three-entry map instead of reusing this one.
const KIND_LABELS: Record<NodeKind, KindLabel> = {
  connection: { singular: 'Connection', plural: 'Connections' },
  database: { singular: 'Database', plural: 'Databases' },
  schema: { singular: 'Schema', plural: 'Schemas' },
  table: { singular: 'Table', plural: 'Tables' },
  view: { singular: 'View', plural: 'Views' },
  matview: { singular: 'Materialized view', plural: 'Materialized views' },
  function: { singular: 'Function', plural: 'Functions' },
  sequence: { singular: 'Sequence', plural: 'Sequences' },
  column: { singular: 'Column', plural: 'Columns' },
  collection: { singular: 'Collection', plural: 'Collections' },
  namespace: { singular: 'Namespace', plural: 'Namespaces' },
  key: { singular: 'Key', plural: 'Keys' },
  topic: { singular: 'Topic', plural: 'Topics' },
  partition: { singular: 'Partition', plural: 'Partitions' },
  consumerGroup: { singular: 'Consumer group', plural: 'Consumer groups' },
  queue: { singular: 'Queue', plural: 'Queues' },
  bucket: { singular: 'Bucket', plural: 'Buckets' },
  prefix: { singular: 'Prefix', plural: 'Prefixes' },
  object: { singular: 'Object', plural: 'Objects' },
};

// Per-connection-kind overrides — one entry today: MariaDB's and MySQL's `function` nodes include
// stored procedures (P34 F21b: MySQL calls them stored routines too, from the same
// information_schema.ROUTINES source), and §5.1 calls that level "routines".
const KIND_LABEL_OVERRIDES: Partial<Record<NodeKind, Partial<Record<ConnectionKind, KindLabel>>>> =
  {
    function: {
      mariadb: { singular: 'Routine', plural: 'Routines' },
      mysql: { singular: 'Routine', plural: 'Routines' },
    },
  };

/** The display label for any node kind, per connection kind. Plural for a folder or a checkbox
 *  row ("Views"), singular where a single object is named. The one place a kind gets a human
 *  name — GROUPED_KINDS' own labels now derive from it rather than duplicating it. */
export function labelForKind(
  kind: NodeKind,
  connectionKind: ConnectionKind,
  form: 'singular' | 'plural' = 'plural',
): string {
  const override = KIND_LABEL_OVERRIDES[kind]?.[connectionKind];
  return (override ?? KIND_LABELS[kind])[form];
}

// The complete, curated list of kinds that get their own folder, in render order. Any kind not
// named here is never grouped and keeps its position — which is what leaves redis namespaces/keys
// and s3 prefixes/objects exactly as they are today.
export const GROUPED_KINDS: readonly { kind: NodeKind }[] = [
  { kind: 'view' },
  { kind: 'matview' },
  { kind: 'sequence' },
  { kind: 'function' },
  // P23 D1 (revised): kafka follows the same rule as SQL — the primary kind (topics) shows first,
  // ungrouped, and only the auxiliary kind (consumer groups) folders. Topics are what a user
  // browses; a folder around them would bury the thing this tree exists to show.
  { kind: 'consumerGroup' },
];

const GROUPED_KIND_SET = new Set(GROUPED_KINDS.map((g) => g.kind));

export function labelForGroup(kind: NodeKind, connectionKind: ConnectionKind): string {
  return labelForKind(kind, connectionKind, 'plural');
}

// Splits an already-filtered child list into [ungrouped, folders] — ungrouped in adapter order
// first, then one folder per non-empty GROUPED_KINDS entry, in table order.
export function partitionChildren(nodes: TreeNode[]): {
  ungrouped: TreeNode[];
  groups: { kind: NodeKind; nodes: TreeNode[] }[];
} {
  const ungrouped: TreeNode[] = [];
  const byKind = new Map<NodeKind, TreeNode[]>();
  for (const node of nodes) {
    if (!GROUPED_KIND_SET.has(node.kind)) {
      ungrouped.push(node);
      continue;
    }
    const bucket = byKind.get(node.kind);
    if (bucket) bucket.push(node);
    else byKind.set(node.kind, [node]);
  }
  const groups = GROUPED_KINDS.map((g) => ({
    kind: g.kind,
    nodes: byKind.get(g.kind) ?? [],
  })).filter((g) => g.nodes.length > 0);
  return { ungrouped, groups };
}

// Kinds whose rows no longer expand in the tree, whatever a cached TreeNode's `hasChildren` says
// (P19 D5) — a table's columns moved into the definition view, and the adapters that produce these
// kinds already stopped emitting column children, but an L1 payload cached before this phase can
// still carry `hasChildren: true` until the connection's next reconnect. P23 D3 adds `topic` for
// the same reason: its partitions moved into the definition view too.
export function isLeafKind(kind: NodeKind): boolean {
  return kind === 'table' || kind === 'view' || kind === 'matview' || kind === 'topic';
}
