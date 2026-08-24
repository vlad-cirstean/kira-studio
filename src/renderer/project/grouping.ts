// P19 D2/D3: renderer-only tree grouping — no adapter changes, no new NodeKind, no path segment.
// A pure transform over an already-fetched child list (project/state/tree.ts's buildRows() is the
// one caller), so it costs no round trip and survives a cached listing unchanged.
import type { ConnectionKind } from '@shared/domain/connection';
import type { NodeKind, TreeNode } from '@shared/domain/tree';

// The complete, curated list of kinds that get their own folder, in render order. Any kind not
// named here is never grouped and keeps its position — which is what leaves redis namespaces/keys
// and s3 prefixes/objects exactly as they are today.
export const GROUPED_KINDS: readonly {
  kind: NodeKind;
  label: string;
  /** Per-connection-kind override. One entry today: MariaDB's `function` nodes include stored
   *  procedures, and §5.1 calls that level "routines". */
  labelFor?: Partial<Record<ConnectionKind, string>>;
}[] = [
  { kind: 'view', label: 'Views' },
  { kind: 'matview', label: 'Materialized views' },
  { kind: 'sequence', label: 'Sequences' },
  { kind: 'function', label: 'Functions', labelFor: { mariadb: 'Routines' } },
  // P23 D1/D2: kafka's whole root is foldered, not just "other kinds" — a lone Consumer groups
  // folder trailing several hundred topic rows would not be findable.
  { kind: 'topic', label: 'Topics' },
  { kind: 'consumerGroup', label: 'Consumer groups' },
];

const GROUPED_KIND_SET = new Set(GROUPED_KINDS.map((g) => g.kind));

export function labelForGroup(kind: NodeKind, connectionKind: ConnectionKind): string {
  const entry = GROUPED_KINDS.find((g) => g.kind === kind);
  return entry?.labelFor?.[connectionKind] ?? entry?.label ?? kind;
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
