// A short human-readable description for a data type that isn't self-explanatory from its name
// alone (Postgres/MariaDB column types, surfaced verbatim from the catalog). Returns null for the
// common/obvious ones (int, text, boolean, ...) — the definition view's Columns section only
// shows an info icon when there is actually something to explain.
const DESCRIPTIONS: readonly { test: RegExp; text: string }[] = [
  {
    test: /^tsrange$/,
    text: 'A range of timestamps (without time zone), e.g. [2024-01-01, 2024-02-01).',
  },
  { test: /^tstzrange$/, text: 'A range of timestamps with time zone.' },
  { test: /^daterange$/, text: 'A range of dates.' },
  { test: /^int4range$/, text: 'A range of 32-bit integers.' },
  { test: /^int8range$/, text: 'A range of 64-bit integers.' },
  { test: /^numrange$/, text: 'A range of arbitrary-precision numbers.' },
  { test: /^uuid$/, text: 'A 128-bit universally unique identifier.' },
  {
    test: /^jsonb?$/,
    text: 'A JSON document. "jsonb" stores it in a parsed binary form; plain "json" stores the exact text.',
  },
  { test: /^bytea$/, text: 'Raw binary data.' },
  { test: /^inet$/, text: 'An IPv4 or IPv6 host address, optionally with a subnet.' },
  {
    test: /^cidr$/,
    text: 'An IPv4 or IPv6 network specification (address + subnet, host bits must be zero).',
  },
  { test: /^macaddr8?$/, text: 'A MAC (hardware) address.' },
  { test: /^interval$/, text: 'A span of time (e.g. "3 days 04:00:00"), not a point in time.' },
  { test: /^money$/, text: 'A fixed-precision currency amount.' },
  { test: /^xml$/, text: 'An XML document.' },
  { test: /^(point|line|lseg|box|path|polygon|circle)$/, text: 'A 2D geometric shape.' },
  { test: /^(var)?bit/, text: 'A fixed- or variable-length bit string.' },
  { test: /^tsvector$/, text: 'Preprocessed text, indexed for full-text search.' },
  { test: /^tsquery$/, text: 'A parsed full-text search query.' },
  {
    test: /^oid$/,
    text: 'An internal Postgres object identifier — not usually meaningful application data.',
  },
  { test: /^enum$/, text: 'A fixed set of named values defined by this database.' },
  {
    test: /^set\(/,
    text: "MariaDB's SET type: any combination of a fixed list of string values, stored as one field.",
  },
  { test: /^geometry|geography/, text: 'A spatial (GIS) value.' },
];

export function typeDescription(dataType: string): string | null {
  const type = dataType.toLowerCase();
  return DESCRIPTIONS.find((d) => d.test.test(type))?.text ?? null;
}
