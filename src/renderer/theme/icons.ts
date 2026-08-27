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

type ColumnTypeCategory =
  | 'numeric'
  | 'boolean'
  | 'datetime'
  | 'json'
  | 'array'
  | 'uuid'
  | 'binary'
  | 'string'
  | 'other';

function columnTypeCategory(dataType: string): ColumnTypeCategory {
  let type = dataType.toLowerCase().trim();
  // Item 3 (regression pass, task batch P46-2): ClickHouse reports a real type wrapped —
  // `Nullable(Int32)`, `LowCardinality(String)`, sometimes nested (`LowCardinality(Nullable(...))`)
  // — nullability/low-cardinality say nothing about what *kind* of value the column holds, so
  // every wrapper is stripped (in a loop, for nesting) before classifying what's inside.
  let unwrapped = type.match(/^(?:nullable|lowcardinality)\((.+)\)$/);
  while (unwrapped) {
    type = unwrapped[1];
    unwrapped = type.match(/^(?:nullable|lowcardinality)\((.+)\)$/);
  }
  // mysql-family/read.ts's own typeClassFor() checks this exact pattern first, ahead of its
  // general number match, with the identical reasoning stated there: tinyint(1) is how
  // MySQL/MariaDB spells boolean (a plain `BOOLEAN` column declaration reports back as exactly
  // this in COLUMN_TYPE) — every other tinyint width is a genuine small integer.
  if (/^tinyint\(1\)/.test(type)) return 'boolean';
  // `u?int` catches ClickHouse's UInt8/16/32/64 alongside plain int/bigint/smallint; `tinyint`/
  // `mediumint` are MySQL/MariaDB's own.
  if (
    /^(u?int|numeric|float|double|real|decimal|serial|bigint|smallint|tinyint|mediumint)/.test(type)
  )
    return 'numeric';
  if (/^bool/.test(type)) return 'boolean';
  if (/^(date|time|timestamp|year)\b/.test(type)) return 'datetime';
  if (/^jsonb?/.test(type)) return 'json';
  // Postgres/MariaDB spell an array type `int[]`; ClickHouse spells it `Array(Int32)`.
  if (type.includes('[]') || /^array\(/.test(type)) return 'array';
  if (/^uuid/.test(type)) return 'uuid';
  // Item 3 (regression pass, task batch P46-5): a blob/bytea/bit-string is categorically neither
  // text nor a number — mysql-family/read.ts's own typeClassFor() already carries this exact
  // 'binary' bucket separately from its 'text' one (and postgres/read.ts, sqlite/read.ts,
  // clickhouse/read.ts each have their own typeClassFor mirroring it), so a plain fallthrough to
  // 'string' below was the bug: every blob/binary/bytea column was drawn exactly like a real
  // string column instead of getting no colour at all.
  if (/^(bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|bit)\b/.test(type))
    return 'binary';
  // Only the patterns a value is unambiguously textual under get 'string' — everything else
  // (money, interval, geometry/geography, enum/set, xml, network/range types, an unrecognised
  // custom type name) falls through to 'other' rather than being *assumed* to be a string just
  // because it wasn't recognised as anything else. This mirrors the user's own framing: a type
  // only earns a colour when it is clearly one of the four everyday scalar classes; every other
  // class, known or not, stays the plain foreground colour.
  if (
    /^(char|varchar|character|nchar|nvarchar|text|ntext|clob|string|citext|fixedstring)\b/.test(
      type,
    )
  )
    return 'string';
  return 'other';
}

const CATEGORY_ICON: Record<ColumnTypeCategory, string> = {
  numeric: 'symbol-numeric',
  boolean: 'symbol-boolean',
  datetime: 'calendar',
  json: 'symbol-object',
  array: 'symbol-array',
  uuid: 'symbol-key',
  binary: 'file-binary',
  string: 'symbol-string',
  other: 'symbol-misc',
};

export function columnTypeIcon(dataType: string): string {
  return CATEGORY_ICON[columnTypeCategory(dataType)];
}

// Item 3 (regression pass, task batch P46-5): the four everyday scalar classes now reuse
// CodeMirror's own VS Code Dark Modern syntax colours (theme/tokens.css's --kira-syntax-*, the
// exact hex values VS Code's own Dark Modern theme ships) instead of the connection-colour
// picker's palette — the user asked for these to be "the exact same hues used in vscode", and
// tokens.css already carries that palette verbatim for the editor surfaces. number/string/boolean
// map onto the token VS Code itself gives that literal kind (a numeric literal, a string literal,
// `true`/`false`/`null`'s keyword colour); there's no dedicated "date" token in any editor's
// grammar, so datetime takes the one Dark Modern hue nothing else here claims (control-keyword
// magenta) rather than reusing another class's colour and making the two indistinguishable.
// Every other class — json/array/uuid/binary/other alike — stays the plain foreground colour, per
// the user's own scoping: a badge only earns a colour when it is unambiguously one of these four.
const CATEGORY_COLOR: Record<ColumnTypeCategory, string> = {
  numeric: 'var(--kira-syntax-number)',
  boolean: 'var(--kira-syntax-keyword)',
  datetime: 'var(--kira-syntax-control)',
  json: 'var(--kira-fg)',
  array: 'var(--kira-fg)',
  uuid: 'var(--kira-fg)',
  binary: 'var(--kira-fg)',
  string: 'var(--kira-syntax-string)',
  other: 'var(--kira-fg)',
};

export function columnTypeColor(dataType: string): string {
  return CATEGORY_COLOR[columnTypeCategory(dataType)];
}
