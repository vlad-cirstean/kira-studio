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
  collection: 'json', // P8: mongo's table-equivalent, matching TabStrip.vue's document-tab icon
  index: 'symbol-key',
  namespace: 'symbol-namespace', // P9: an intermediate ':'-delimited redis key level
  key: 'tag', // P9: a leaf redis key, matching TabStrip.vue's keyvalue-tab icon
  topic: 'broadcast', // P10: a kafka topic, matching TabStrip.vue's stream-tab icon
  partition: 'symbol-array', // P10: a browse-only leaf under a kafka topic
  consumerGroup: 'organization', // P10: a browse-only, informational leaf under a kafka topic
  queue: 'inbox', // P10: an sqs queue, matching TabStrip.vue's stream-tab icon
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
