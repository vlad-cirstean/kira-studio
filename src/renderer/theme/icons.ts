import type { NodeKind } from '@shared/domain/tree';
import type { TypeClass } from '@shared/protocol/page';

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

// Item (regression pass, task batch P46-7): this is a *fallback* guesser only — every one of
// engine/adapters/{postgres,mysql-family,sqlite,clickhouse}/read.ts already has its own
// authoritative typeClassFor(), used for real (cell-format eligibility) and exercised by
// tests/db/*.spec.ts against a live server; wherever a ColumnDescriptor carrying that verdict is
// already in hand (the grid, its header tooltip, the cell editor, a console result), typeClassFor
// below reads it directly instead of re-deriving one from the raw type string here. The one
// caller left without a ColumnDescriptor — ColumnsSection.vue's Structure tab, which only ever
// sees a DESCRIBE-shaped ColumnMeta (dataType string, no typeClass) — is what this function still
// exists for, so it has to approximate all four engines' own rules at once from the string alone.
function columnTypeCategory(dataType: string): ColumnTypeCategory {
  let type = dataType.toLowerCase().trim();
  // ClickHouse reports a real type wrapped — `Nullable(Int32)`, `LowCardinality(String)`,
  // sometimes nested (`LowCardinality(Nullable(...))`) — nullability/low-cardinality say nothing
  // about what *kind* of value the column holds, so every wrapper is stripped (in a loop, for
  // nesting) before classifying what's inside.
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
  // Every temporal spelling across all four engines: postgres's `timestamptz`/`timetz`/`interval`,
  // MySQL's compound `datetime`/`year`, ClickHouse's `Date32`/`DateTime64`/`Time64`. Checked ahead
  // of the numeric pattern below on purpose — postgres's own `interval` starts with the exact same
  // "int" the numeric pattern matches as a bare prefix, so it would otherwise be read as a number
  // first. No trailing `\b` here either: `datetime` used to fall through to 'other' because `date`
  // matched as far as it could, then failed a trailing boundary (no boundary between "date" and
  // "time" in one unbroken word) with no `datetime` alternative left to backtrack into — and
  // ClickHouse's own `Date32`/`DateTime64(3)` need the same bare-prefix match `int`/`float` etc.
  // already get below, for the identical reason (a digit run glued straight onto the type name).
  if (/^(datetime|timestamptz|timestamp|timetz|time|date|year|interval)/.test(type))
    return 'datetime';
  // `u?int` catches ClickHouse's UInt8/16/32/64/128/256 alongside plain int/bigint/smallint;
  // `tinyint`/`mediumint` are MySQL/MariaDB's own. `money` is postgres's own numeric type (its own
  // typeClassFor lists it right alongside numeric/decimal) — not a fourth, uncoloured mystery.
  if (
    /^(u?int|numeric|float|double|real|decimal|serial|bigint|smallint|tinyint|mediumint|money)/.test(
      type,
    )
  )
    return 'numeric';
  if (/^bool/.test(type)) return 'boolean';
  if (/^jsonb?/.test(type)) return 'json';
  // Postgres/MariaDB spell an array type `int[]`; ClickHouse spells it `Array(Int32)`.
  if (type.includes('[]') || /^array\(/.test(type)) return 'array';
  if (/^uuid/.test(type)) return 'uuid';
  // A blob/bytea/bit-string is categorically neither text nor a number — every engine's own
  // typeClassFor carries this exact 'binary' bucket separately from its 'text' one.
  if (/^(bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|bit)\b/.test(type))
    return 'binary';
  // Every unambiguously textual spelling, MySQL's sized text family included — `longtext`/
  // `mediumtext`/`tinytext` don't *start* with "text" the way `tinyblob`/`longblob` above do
  // start with "blob", so anchoring on `^text` alone missed all three of them (the second
  // reported gap: "longtext not being text"). `enum`/`set` are deliberately included too: neither
  // postgres nor MySQL's own typeClassFor carries a bucket for them, so both engines' real,
  // tested answer is exactly the same catch-all 'text' this returns — and ClickHouse's own
  // typeClassFor puts its own `Enum8`/`Enum16` in its TEXT_TYPES set outright, which needs the
  // same bare-prefix match (no trailing `\b`) as temporal/numeric above: `Enum8(...)`'s digit-plus-
  // parens tail glues straight onto the word with no boundary for one to fail against.
  if (
    /^(char|varchar|character|nchar|nvarchar|n?text|tinytext|mediumtext|longtext|ntext|clob|string|citext|fixedstring|enum|set)/.test(
      type,
    )
  )
    return 'string';
  // What's left — geometry/geography (already caught above for MySQL's own spelling, but
  // postgres's PostGIS types reach here), xml, network/range types (inet/cidr/macaddr/int4range),
  // AggregateFunction/Interval/Nothing (ClickHouse's own 'other' list), an unrecognised custom
  // type name (a postgres user-defined enum, a domain) — none of these get a colour assumed for
  // them; every engine that has an 'other' bucket at all (postgres, sqlite, ClickHouse) agrees an
  // unrecognised type belongs there, not in 'text'.
  return 'other';
}

// Item (regression pass, task batch P46-7): the authoritative path — every one of
// engine/adapters/{postgres,mysql-family,sqlite,clickhouse}/read.ts's own typeClassFor() already
// answered this question server-side (exercised live by tests/db/*.spec.ts), so a ColumnDescriptor
// that already carries it should never be re-guessed from its own dataType string a second time,
// independently, in the renderer — that second guess is exactly how "datetime" and "longtext"
// both fell through to the wrong bucket above. binary/json both fold into the same uncoloured
// 'other' the string guesser's own binary/json cases also resolve to, so the two paths agree.
function categoryForTypeClass(typeClass: TypeClass): ColumnTypeCategory {
  switch (typeClass) {
    case 'number':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'temporal':
      return 'datetime';
    case 'text':
      return 'string';
    case 'binary':
    case 'json':
    case 'other':
      return 'other';
  }
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

/** The authoritative counterpart of columnTypeIcon, for a caller that already has a
 *  ColumnDescriptor's own typeClass in hand rather than just its dataType string. */
export function typeClassIcon(typeClass: TypeClass): string {
  return CATEGORY_ICON[categoryForTypeClass(typeClass)];
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
// json/array/binary/other stay the plain foreground colour, per the user's own scoping: a badge
// only earns a colour when it is unambiguously one of the four everyday scalar classes.
// Item (regression pass, task batch P46-7): uuid colours as string now, not a fifth uncoloured
// class — checked against all four engines' own typeClassFor, not one of them (postgres, MySQL/
// MariaDB, SQLite, ClickHouse's own explicit TEXT_TYPES) treats a UUID column as anything but
// text; a live cross-check against MariaDB's own native UUID column confirmed the grid and cell
// editor (both typeClass-driven, categoryForTypeClass below) already colour it that way — this
// keeps the Structure pane's own string-guessing path from being the one place left disagreeing.
const CATEGORY_COLOR: Record<ColumnTypeCategory, string> = {
  numeric: 'var(--kira-syntax-number)',
  boolean: 'var(--kira-syntax-keyword)',
  datetime: 'var(--kira-syntax-control)',
  json: 'var(--kira-fg)',
  array: 'var(--kira-fg)',
  uuid: 'var(--kira-syntax-string)',
  binary: 'var(--kira-fg)',
  string: 'var(--kira-syntax-string)',
  other: 'var(--kira-fg)',
};

export function columnTypeColor(dataType: string): string {
  return CATEGORY_COLOR[columnTypeCategory(dataType)];
}

/** The authoritative counterpart of columnTypeColor, for a caller that already has a
 *  ColumnDescriptor's own typeClass in hand rather than just its dataType string — the grid, its
 *  header tooltip, the cell editor and a console result all do, and use this instead. */
export function typeClassColor(typeClass: TypeClass): string {
  return CATEGORY_COLOR[categoryForTypeClass(typeClass)];
}
