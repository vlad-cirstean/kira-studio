// A short human-readable description for a column/field data type. P31 D28 widened this from
// "just the exotica" to every type the app can show: the numeric family, the char/varchar/text/
// blob families, the temporal family, boolean, serial/identity, arrays, plus MariaDB's own
// spellings and the BSON type names $jsonSchema uses for Mongo's Validation section — the earlier
// "obvious types need no gloss" rationale didn't survive contact with catalog spellings like
// int2/int8/float8/bpchar/timestamptz, which are not obvious at all. Genuinely self-explanatory
// container/primitive names (string, array, object, null) are still left uncovered on purpose —
// the definition view's Columns section only shows an info icon when there is actually something
// to explain (D30).
const DESCRIPTIONS: readonly { test: RegExp; text: string }[] = [
  // --- temporal family -------------------------------------------------------------------
  {
    test: /^tsrange$/,
    text: 'A range of timestamps (without time zone), e.g. [2024-01-01, 2024-02-01).',
  },
  { test: /^tstzrange$/, text: 'A range of timestamps with time zone.' },
  { test: /^daterange$/, text: 'A range of dates.' },
  { test: /^interval$/, text: 'A span of time (e.g. "3 days 04:00:00"), not a point in time.' },
  { test: /^date$/, text: 'A calendar date, with no time-of-day or time zone.' },
  { test: /^time(\s+without\s+time\s+zone)?$/, text: 'A time of day, with no date or time zone.' },
  {
    test: /^(timetz|time\s+with\s+time\s+zone)$/,
    text: 'A time of day with a UTC offset, no date.',
  },
  {
    // "timestamp" alone means without-time-zone in both Postgres and MariaDB's own DATETIME-like
    // reading here — distinguished from timestamptz below, per the ask's own explicit callout.
    test: /^(timestamp(\s+without\s+time\s+zone)?|datetime)$/,
    text: 'A date and time with no time zone — stored and compared as the literal wall-clock value written.',
  },
  {
    test: /^(timestamptz|timestamp\s+with\s+time\s+zone)$/,
    text: 'A date and time normalized to UTC on write and converted to the session’s time zone on read.',
  },
  { test: /^year$/, text: 'A calendar year, stored as a 2- or 4-digit value (MariaDB).' },

  // --- numeric family ----------------------------------------------------------------------
  { test: /^int4range$/, text: 'A range of 32-bit integers.' },
  { test: /^int8range$/, text: 'A range of 64-bit integers.' },
  { test: /^numrange$/, text: 'A range of arbitrary-precision numbers.' },
  { test: /^(tinyint)(\s+unsigned)?(\s+zerofill)?$/, text: 'An 8-bit integer (MariaDB).' },
  {
    test: /^(smallint|int2)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'A 16-bit integer.',
  },
  { test: /^mediumint(\s+unsigned)?(\s+zerofill)?$/, text: 'A 24-bit integer (MariaDB).' },
  {
    test: /^(integer|int|int4)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'A 32-bit integer.',
  },
  {
    // "long" is BSON's own name for a 64-bit integer ($jsonSchema's bsonType) — grouped with
    // bigint/int8 rather than with int/integer above, unlike its similar spelling.
    test: /^(bigint|int8|long)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'A 64-bit integer.',
  },
  {
    test: /^(decimal|numeric)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'An exact, arbitrary-precision number — no binary rounding, unlike float/double.',
  },
  {
    test: /^(real|float4|float)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'A 32-bit (single-precision) floating-point number.',
  },
  {
    test: /^(double(\s+precision)?|float8)(\s+unsigned)?(\s+zerofill)?$/,
    text: 'A 64-bit (double-precision) floating-point number.',
  },
  { test: /^money$/, text: 'A fixed-precision currency amount.' },

  // --- serial / identity ---------------------------------------------------------------------
  {
    test: /^(smallserial|serial2)$/,
    text: 'A 16-bit integer that auto-increments from a sequence — the column itself is a plain smallint.',
  },
  {
    test: /^(serial|serial4)$/,
    text: 'A 32-bit integer that auto-increments from a sequence — the column itself is a plain integer.',
  },
  {
    test: /^(bigserial|serial8)$/,
    text: 'A 64-bit integer that auto-increments from a sequence — the column itself is a plain bigint.',
  },

  // --- boolean -------------------------------------------------------------------------------
  { test: /^bool(ean)?$/, text: 'A true/false value.' },

  // --- char/varchar/text/blob families ---------------------------------------------------------
  {
    test: /^(character|char|bpchar)$/,
    text: 'Fixed-length text, padded with spaces out to its declared length.',
  },
  {
    test: /^(character\s+varying|varchar)$/,
    text: 'Variable-length text, up to a declared maximum length.',
  },
  { test: /^text$/, text: 'Variable-length text with no declared maximum.' },
  { test: /^tinytext$/, text: 'Variable-length text, up to 255 bytes (MariaDB).' },
  { test: /^mediumtext$/, text: 'Variable-length text, up to ~16 MB (MariaDB).' },
  { test: /^longtext$/, text: 'Variable-length text, up to ~4 GB (MariaDB).' },
  { test: /^bytea$/, text: 'Raw binary data.' },
  { test: /^binary$/, text: 'Fixed-length raw binary data (MariaDB).' },
  {
    test: /^varbinary$/,
    text: 'Variable-length raw binary data, up to a declared maximum (MariaDB).',
  },
  { test: /^tinyblob$/, text: 'Raw binary data, up to 255 bytes (MariaDB).' },
  {
    // P35 D31: "blob" alone is no longer a MariaDB-only spelling — it's also SQLite's own native
    // blob type (F21), which has no such size cap, so a single hard number would be wrong for one
    // of the two engines this entry now has to describe.
    test: /^blob$/,
    text: "Raw binary data — MariaDB/MySQL's own blob type caps it at 64 KB; SQLite's BLOB (its only blob type) has no declared size limit.",
  },
  { test: /^mediumblob$/, text: 'Raw binary data, up to ~16 MB (MariaDB).' },
  { test: /^longblob$/, text: 'Raw binary data, up to ~4 GB (MariaDB).' },

  // --- identifiers, structured/exotic types ---------------------------------------------------
  { test: /^uuid$/, text: 'A 128-bit universally unique identifier.' },
  {
    test: /^jsonb?$/,
    text: 'A JSON document. "jsonb" stores it in a parsed binary form; plain "json" stores the exact text.',
  },
  { test: /^inet$/, text: 'An IPv4 or IPv6 host address, optionally with a subnet.' },
  {
    test: /^cidr$/,
    text: 'An IPv4 or IPv6 network specification (address + subnet, host bits must be zero).',
  },
  { test: /^macaddr8?$/, text: 'A MAC (hardware) address.' },
  { test: /^xml$/, text: 'An XML document.' },
  { test: /^(point|line|lseg|box|path|polygon|circle)$/, text: 'A 2D geometric shape.' },
  { test: /^(var)?bit$/, text: 'A fixed- or variable-length bit string.' },
  { test: /^tsvector$/, text: 'Preprocessed text, indexed for full-text search.' },
  { test: /^tsquery$/, text: 'A parsed full-text search query.' },
  {
    test: /^oid$/,
    text: 'An internal Postgres object identifier — not usually meaningful application data.',
  },
  { test: /^enum$/, text: 'A fixed set of named values defined by this database.' },
  {
    // Was `/^set\(/` before D28 introduced normalize()'s qualifier-stripping below — the
    // "('a','b')" list is a qualifier like any other now, so this matches the same way
    // varchar/numeric's own qualifiers do rather than relying on the paren surviving.
    test: /^set$/,
    text: "MariaDB/MySQL's SET type: any combination of a fixed list of string values, stored as one field.",
  },
  { test: /^geometry|geography/, text: 'A spatial (GIS) value.' },
  {
    // P35 D21/D31: SQLite's own STRICT-table type — the one declared type with no affinity rule
    // at all (F21), so a value here can genuinely be any SQLite storage class.
    test: /^any$/,
    text: 'SQLite STRICT-table type: accepts a value of any storage class, with no affinity applied.',
  },

  // --- Mongo BSON type names (a $jsonSchema validator's own "bsonType" spellings) -------------
  // Genuinely self-explanatory ones (string, array, object, null) are left uncovered, same
  // reasoning as the SQL side. "int"/"long"/"bool"/"decimal" reuse the SQL entries above — the
  // meaning (32-bit int, 64-bit int, true/false, exact arbitrary-precision) is identical.
  { test: /^objectid$/, text: "MongoDB's 12-byte document identifier type." },
  { test: /^bindata$/, text: 'Raw binary data (BSON binData).' },
  {
    test: /^javascript$/,
    text: 'A stored JavaScript function (BSON code) — rarely used in modern schemas.',
  },
  { test: /^regex$/, text: 'A regular expression pattern (BSON regex type).' },
  {
    test: /^minkey$/,
    text: "BSON's own always-lowest comparison value — a sentinel, not real data.",
  },
  {
    test: /^maxkey$/,
    text: "BSON's own always-highest comparison value — a sentinel, not real data.",
  },
];

// --- ClickHouse's own type family -------------------------------------------------------------
// P36 D33: matched case-sensitively against the *un-normalized* text, before normalize()'s
// lowercasing — ClickHouse's own catalog always spells these in exact PascalCase (F24), which is
// what lets "Int8" (an 8-bit signed integer here) resolve to its own entry instead of colliding
// with the generic DESCRIPTIONS list's lowercase "int8" (Postgres/MariaDB's own shorthand for a
// 64-bit bigint, a completely different width) — the two vocabularies use the same six characters
// for unrelated meanings, and only case tells them apart.
const CLICKHOUSE_DESCRIPTIONS: readonly { test: RegExp; text: string }[] = [
  { test: /^UInt8$/, text: 'An 8-bit unsigned integer (0 to 255).' },
  { test: /^UInt16$/, text: 'A 16-bit unsigned integer.' },
  { test: /^UInt32$/, text: 'A 32-bit unsigned integer.' },
  { test: /^UInt64$/, text: 'A 64-bit unsigned integer.' },
  { test: /^UInt(128|256)$/, text: 'A 128- or 256-bit unsigned integer.' },
  { test: /^Int8$/, text: 'An 8-bit signed integer (-128 to 127).' },
  { test: /^Int16$/, text: 'A 16-bit signed integer.' },
  { test: /^Int32$/, text: 'A 32-bit signed integer.' },
  { test: /^Int64$/, text: 'A 64-bit signed integer.' },
  { test: /^Int(128|256)$/, text: 'A 128- or 256-bit signed integer.' },
  { test: /^Float32$/, text: 'A 32-bit (single-precision) floating-point number.' },
  { test: /^Float64$/, text: 'A 64-bit (double-precision) floating-point number.' },
  {
    test: /^Decimal(32|64|128|256)?$/,
    text: 'An exact, fixed-precision decimal number — no binary rounding.',
  },
  { test: /^Bool$/, text: 'A true/false value, stored as UInt8 under the hood.' },
  { test: /^String$/, text: 'Variable-length text or binary data, with no declared maximum.' },
  {
    test: /^FixedString$/,
    text: 'A fixed-length byte string, padded with zero bytes out to its declared length.',
  },
  { test: /^Date$/, text: 'A calendar date (from 1970), with no time-of-day or time zone.' },
  { test: /^Date32$/, text: 'A calendar date with a wider range than Date (back to 1900).' },
  {
    test: /^DateTime$/,
    text: 'A date and time with second precision, in a fixed named time zone.',
  },
  {
    test: /^DateTime64$/,
    text: 'A date and time with sub-second precision, in a fixed named time zone.',
  },
  { test: /^Time$/, text: 'A time of day, with no date.' },
  { test: /^Time64$/, text: 'A time of day with sub-second precision, no date.' },
  { test: /^UUID$/, text: 'A 128-bit universally unique identifier.' },
  { test: /^IPv4$/, text: 'A 32-bit IPv4 host address.' },
  { test: /^IPv6$/, text: 'A 128-bit IPv6 host address.' },
  {
    test: /^Enum(8|16)?$/,
    text: 'A fixed set of named string values, each backed by a small integer.',
  },
  { test: /^Array$/, text: 'A variable-length list of values of one element type.' },
  { test: /^Tuple$/, text: 'A fixed-length, ordered group of values, possibly of mixed types.' },
  { test: /^Map$/, text: 'A key/value mapping of one key type to one value type.' },
  { test: /^Nested$/, text: 'A table-like group of same-length array columns.' },
  {
    test: /^(Point|Ring|Polygon|MultiPolygon)$/,
    text: 'A geometric shape, built from Array/Tuple of coordinates.',
  },
  { test: /^JSON$/, text: 'A semi-structured document with a dynamically inferred sub-schema.' },
  {
    test: /^(Aggregate|SimpleAggregate)Function$/,
    text: 'An intermediate aggregation state, produced by an aggregate function.',
  },
];

// P36 D33: strips Nullable(...) and LowCardinality(...) wrappers, recursively, in either nesting
// order — the same two wrappers read.ts's own unwrapType (D17) strips server-side. Without this,
// normalize()'s single, non-nested paren-stripping regex mangles "Nullable(LowCardinality(String))"
// into "nullable)" (it stops at the *first* closing paren, the inner one) instead of reaching the
// wrapped type at all.
function unwrapClickHouseWrappers(dataType: string): string {
  let inner = dataType.trim();
  for (;;) {
    const nullableMatch = /^Nullable\((.*)\)$/s.exec(inner);
    if (nullableMatch?.[1] !== undefined) {
      inner = nullableMatch[1].trim();
      continue;
    }
    const lowCardMatch = /^LowCardinality\((.*)\)$/s.exec(inner);
    if (lowCardMatch?.[1] !== undefined) {
      inner = lowCardMatch[1].trim();
      continue;
    }
    break;
  }
  return inner;
}

// Strips a length/precision qualifier — "varchar(64)" -> "varchar", "numeric(10,2)" -> "numeric"
// — so the lookup above matches on the base type name alone (D28).
function normalize(dataType: string): string {
  return dataType
    .toLowerCase()
    .replace(/\([^)]*\)/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function typeDescription(dataType: string): string | null {
  const unwrapped = unwrapClickHouseWrappers(dataType);
  const chBase = unwrapped.replace(/\(.*$/s, '').trim();
  const chMatch = CLICKHOUSE_DESCRIPTIONS.find((d) => d.test.test(chBase))?.text;
  if (chMatch) return chMatch;

  const type = normalize(unwrapped);
  // Arrays (Postgres's "integer[]", "text[]", …): describe by the element type rather than
  // listing every possible array shape as its own entry.
  const arrayMatch = type.match(/^(.+?)((?:\[\])+)$/);
  if (arrayMatch?.[1]) {
    const elementDescription = typeDescription(arrayMatch[1]);
    return elementDescription
      ? `An array of ${arrayMatch[1]} values. ${elementDescription}`
      : `An array of ${arrayMatch[1]} values.`;
  }
  return DESCRIPTIONS.find((d) => d.test.test(type))?.text ?? null;
}
