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
  namespace: 'symbol-namespace', // P9: an intermediate ':'-delimited redis key level
  key: 'tag', // P9: a leaf redis key, matching TabStrip.vue's keyvalue-tab icon
  topic: 'broadcast', // P10: a kafka topic, matching TabStrip.vue's stream-tab icon
  partition: 'symbol-array', // P10: a browse-only leaf under a kafka topic
  consumerGroup: 'organization', // P10: a browse-only, informational leaf under a kafka topic
  queue: 'inbox', // P10: an sqs queue, matching TabStrip.vue's stream-tab icon
  bucket: 'archive', // P17: an s3 bucket
  prefix: 'folder', // P17: an intermediate '/'-delimited s3 key level
  object: 'file', // P17: a leaf s3 object, opened as a key/value tab (redis's own 'key' precedent)
  exchange: 'git-merge', // P37: a rabbitmq exchange — routes one input to many bound destinations
};

// P19: 'group' isn't a real NodeKind (it's a renderer-only synthetic tree row, project/grouping.ts)
// but TreeRowVm.kind carries it alongside every real NodeKind, so callers that pass a row's kind
// straight through (project/menus.ts's per-row-kind menu builders) need this to stay total.
export function nodeIcon(kind: NodeKind | 'group'): string {
  return kind === 'group' ? 'folder' : KIND_ICON[kind];
}

type ColumnTypeCategory = 'numeric' | 'boolean' | 'datetime' | 'json' | 'array' | 'uuid' | 'string';

function columnTypeCategory(dataType: string): ColumnTypeCategory {
  const type = dataType.toLowerCase();
  if (/^(int|numeric|float|double|real|decimal|serial|bigint|smallint)/.test(type))
    return 'numeric';
  if (/^bool/.test(type)) return 'boolean';
  if (/^(date|time|timestamp)/.test(type)) return 'datetime';
  if (/^jsonb?/.test(type)) return 'json';
  if (type.includes('[]')) return 'array';
  if (/^uuid/.test(type)) return 'uuid';
  return 'string';
}

const CATEGORY_ICON: Record<ColumnTypeCategory, string> = {
  numeric: 'symbol-numeric',
  boolean: 'symbol-boolean',
  datetime: 'calendar',
  json: 'symbol-object',
  array: 'symbol-array',
  uuid: 'symbol-key',
  string: 'symbol-string',
};

export function columnTypeIcon(dataType: string): string {
  return CATEGORY_ICON[columnTypeCategory(dataType)];
}

// Reuses the connection-colour picker's own 8-hue palette (--kira-conn-*, D18) instead of
// inventing a second colour system just for data-type badges.
const CATEGORY_COLOR: Record<ColumnTypeCategory, string> = {
  numeric: 'var(--kira-conn-blue)',
  boolean: 'var(--kira-conn-violet)',
  datetime: 'var(--kira-conn-orange)',
  json: 'var(--kira-conn-teal)',
  array: 'var(--kira-conn-amber)',
  uuid: 'var(--kira-conn-red)',
  string: 'var(--kira-conn-green)',
};

export function columnTypeColor(dataType: string): string {
  return CATEGORY_COLOR[columnTypeCategory(dataType)];
}
