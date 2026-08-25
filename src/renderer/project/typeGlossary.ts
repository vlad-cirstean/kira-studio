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
  const type = normalize(dataType);
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
