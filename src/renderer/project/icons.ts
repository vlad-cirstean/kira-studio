import type { NodeKind } from '@shared/domain/tree';

const KIND_ICON: Record<NodeKind, string> = {
  connection: 'plug',
  database: 'database',
  schema: 'symbol-namespace',
  table: 'table',
  view: 'eye',
  matview: 'symbol-structure',
  sequence: 'list-ordered',
  function: 'symbol-method',
  column: 'symbol-string', // overridden by columnTypeIcon() when the data type is known
};

export function nodeIcon(kind: NodeKind): string {
  return KIND_ICON[kind];
}

export function columnTypeIcon(dataType: string): string {
  const type = dataType.toLowerCase();
  if (/^(int|numeric|float|double|real|decimal|serial|bigint|smallint)/.test(type))
    return 'symbol-numeric';
  if (/^bool/.test(type)) return 'symbol-boolean';
  if (/^(date|time|timestamp)/.test(type)) return 'calendar';
  if (/^jsonb?/.test(type)) return 'symbol-object';
  if (type.includes('[]')) return 'symbol-array';
  if (/^uuid/.test(type)) return 'symbol-key';
  return 'symbol-string';
}
