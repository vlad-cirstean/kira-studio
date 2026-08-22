import type { NodeKind } from '@shared/tree';

// NodeKind / column data-type → codicon name (§8.5). Every icon renders through Codicon.vue, never
// a raw `codicon-*` class (P0 Step 5c standing rule).

const KIND_ICON: Record<NodeKind, string> = {
  connection: 'plug',
  database: 'database',
  schema: 'symbol-namespace',
  table: 'table',
  view: 'eye',
  matview: 'symbol-structure',
  sequence: 'list-ordered',
  function: 'symbol-method',
  routine: 'symbol-method',
  column: 'symbol-field',
};

export function iconForKind(kind: NodeKind): string {
  return KIND_ICON[kind];
}

// Column nodes carry their type in `detail` ("int NOT NULL"), so the type-specific icon is derived
// from that string rather than a dedicated field on TreeNode.
export function iconForColumn(detail: string): string {
  const type = detail.replace(/ NOT NULL$/, '').toLowerCase();
  if (/\b(int|bigint|smallint|serial|numeric|decimal|real|double|float|money)\b/.test(type)) {
    return 'symbol-numeric';
  }
  if (/\bbool(ean)?\b/.test(type)) return 'symbol-boolean';
  if (/\b(date|time|timestamp|interval)\b/.test(type)) return 'calendar';
  if (type.includes('json')) return 'symbol-object';
  if (type.includes('[]') || type.includes('array')) return 'symbol-array';
  if (type.includes('uuid')) return 'symbol-key';
  return 'symbol-string';
}
