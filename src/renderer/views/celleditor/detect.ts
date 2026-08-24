import type { TypeClass } from '@shared/protocol/page';
import { scanJson, scanXml } from './beautify';
import { CELL_FORMATS, type CellFormat } from './formats';

export interface DetectInput {
  text: string;
  typeClass: TypeClass; // from the ColumnDescriptor (§0 note 7)
  dataType: string; // the server's verbatim type name
  columnName: string; // used only by the epoch detectors' name hint (§5b)
}

export interface FormatGuess {
  format: CellFormat;
  /** 0..1. `text` is always present as the 0.10 floor, so the list is never empty. */
  score: number;
  /** One short phrase, shown as the `Auto` option's title. */
  reason: string;
}

// §5a: eligibility is a gate applied BEFORE any detector runs, not a score adjustment
// afterwards — an int4 column holding `12345678` must come back `text`, never `hex`, because
// `hex`'s detector is never even invoked for a `number` column.
const ELIGIBLE_BY_TYPE_CLASS: Record<TypeClass, readonly CellFormat[]> = {
  json: ['json', 'text'],
  temporal: ['iso8601', 'text'],
  number: ['epochSeconds', 'epochMillis', 'text'],
  binary: ['hex', 'base64', 'text'],
  boolean: ['text'],
  text: CELL_FORMATS,
  other: CELL_FORMATS,
};

// §5c: equal-score ties break on this order, highest first.
const PRECEDENCE: readonly CellFormat[] = [
  'json',
  'xml',
  'sql',
  'uuid',
  'iso8601',
  'url',
  'epochMillis',
  'epochSeconds',
  'hex',
  'base64',
  'csv',
  'text',
];

function trimmed(input: DetectInput): string {
  return input.text.replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, '');
}

function detectJson(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (t.length === 0) return null;
  // Gated on the opening character only, not a matching close: a value truncated at
  // MAX_CELL_BYTES (§0 note 9) will almost never coincidentally end on the right bracket, and
  // §6a's truncated-JSON case must still land in the 0.35 bucket below, not fall through to
  // plain text. The scanner is what actually decides valid vs merely JSON-shaped.
  const isObject = t[0] === '{';
  const isArray = t[0] === '[';
  if (!isObject && !isArray) return null;
  const scan = scanJson(t);
  if (scan.ok) {
    return {
      format: 'json',
      score: input.typeClass === 'json' ? 1.0 : 0.95,
      reason: `valid JSON ${isObject ? 'object' : 'array'}`,
    };
  }
  return {
    format: 'json',
    score: 0.35,
    reason: `looks like JSON, invalid at offset ${scan.offset}`,
  };
}

function detectXml(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (t.length === 0) return null;
  if (t[0] !== '<' || t[t.length - 1] !== '>') return null;
  const hasDeclPrefix = /^<\?xml/i.test(t) || /^<!doctype/i.test(t);
  const scan = scanXml(t);
  if (scan.ok) {
    return {
      format: 'xml',
      score: hasDeclPrefix ? 0.95 : 0.9,
      reason: hasDeclPrefix ? 'XML document with a declaration' : 'balanced XML/HTML tags',
    };
  }
  return { format: 'xml', score: 0.3, reason: 'looks like XML/HTML, tags do not balance' };
}

const SQL_LEADING = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'with',
  'create',
  'alter',
  'drop',
  'truncate',
  'explain',
  'begin',
  'commit',
  'rollback',
  'grant',
  'revoke',
  'merge',
]);
const SQL_SECONDARY = new Set([
  'from',
  'where',
  'join',
  'values',
  'set',
  'into',
  'group',
  'order',
  'limit',
  'returning',
  'union',
  'having',
  'on',
  'as',
]);
const WORD_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;

function detectSql(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  const firstMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(t);
  const first = firstMatch?.[0].toLowerCase();
  if (!first || !SQL_LEADING.has(first)) return null;
  WORD_RE.lastIndex = 0;
  const words: string[] = [];
  for (let m = WORD_RE.exec(t); m; m = WORD_RE.exec(t)) words.push(m[0].toLowerCase());
  const hasSecondary = words.slice(1).some((w) => SQL_SECONDARY.has(w));
  return hasSecondary
    ? { format: 'sql', score: 0.7, reason: 'multiple SQL clauses' }
    : { format: 'sql', score: 0.45, reason: 'leading SQL keyword' };
}

const UUID_RE = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

function detectUuid(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (!UUID_RE.test(t)) return null;
  const score = input.dataType.toLowerCase().includes('uuid') ? 1.0 : 0.95;
  return { format: 'uuid', score, reason: 'UUID shape' };
}

const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+$/;

function detectUrl(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (t.length === 0 || t.length > 4096 || !URL_RE.test(t)) return null;
  return { format: 'url', score: 0.9, reason: 'URL with a scheme' };
}

const HEX_RE = /^(0x)?([0-9a-fA-F]{2})+$/;

function detectHex(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (t.length === 0 || !HEX_RE.test(t)) return null;
  const hasPrefix = t.startsWith('0x');
  const digits = hasPrefix ? t.slice(2) : t;
  if (digits.length < 16) return null;
  const hasLetter = /[a-fA-F]/.test(digits);
  if (!hasPrefix && !hasLetter && input.typeClass !== 'binary') return null;
  const score = hasPrefix || input.typeClass === 'binary' ? 1.0 : 0.6;
  return { format: 'hex', score, reason: 'hex-encoded bytes' };
}

export const BASE64_STD_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const BASE64_URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;
// §5b's own worked example (`SGVsbG8sIFdvcmxkIQ==`, the base64 of "Hello, World!") is 20
// characters — shorter than the ≥ 24 the prose states. The concrete, scored, tested example
// (also asserted end-to-end in Step 7 against a real `app.formats` row) is treated as
// authoritative over the prose figure; 20 is the reconciled floor.
const BASE64_MIN_LENGTH = 20;

export function base64ToStd(t: string, isUrlSafe: boolean): string {
  return isUrlSafe ? t.replace(/-/g, '+').replace(/_/g, '/') : t;
}

function detectBase64(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  const isStd = BASE64_STD_RE.test(t);
  const isUrlSafe = !isStd && BASE64_URL_RE.test(t);
  if (!isStd && !isUrlSafe) return null;
  if (t.length % 4 !== 0 || t.length < BASE64_MIN_LENGTH) return null;
  if (!/[^0-9a-fA-F]/.test(t)) return null; // purely hex-shaped — let hex win the overlap
  const hasSpecial = /[+/=_-]/.test(t);
  const hasMixedCase = /[A-Z]/.test(t) && /[a-z]/.test(t) && /[0-9]/.test(t);
  if (!hasSpecial && !hasMixedCase) return null;
  try {
    atob(base64ToStd(t, isUrlSafe));
  } catch {
    return null;
  }
  const padded = t.endsWith('=');
  const hasPlusSlash = /[+/]/.test(t);
  const score = padded || hasPlusSlash ? 0.85 : 0.75;
  return { format: 'base64', score, reason: 'base64-shaped' };
}

const EPOCH_SECONDS_RE = /^-?\d{9,11}$/;
const EPOCH_MILLIS_RE = /^-?\d{12,14}$/;
const TIME_COLUMN_RE = /(_at|_time|_ts|timestamp|date)$/i;

function detectEpochSeconds(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (!EPOCH_SECONDS_RE.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1e8 || n > 4.1e9) return null;
  const bonus = TIME_COLUMN_RE.test(input.columnName) ? 0.1 : 0;
  return {
    format: 'epochSeconds',
    score: Math.min(0.8, 0.7 + bonus),
    reason: 'epoch-seconds range',
  };
}

function detectEpochMillis(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (!EPOCH_MILLIS_RE.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1e11 || n > 4.1e12) return null;
  const bonus = TIME_COLUMN_RE.test(input.columnName) ? 0.1 : 0;
  return {
    format: 'epochMillis',
    score: Math.min(0.8, 0.7 + bonus),
    reason: 'epoch-milliseconds range',
  };
}

// The space separator is not optional: Postgres renders `timestamptz` as
// `2024-01-15 10:23:45.123456+00`, so a detector that insists on `T` fails on the app's single
// most common temporal value (§5b).
const ISO8601_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

function detectIso8601(input: DetectInput): FormatGuess | null {
  const t = trimmed(input);
  if (!ISO8601_RE.test(t)) return null;
  const score = input.typeClass === 'temporal' ? 0.95 : 0.85;
  return { format: 'iso8601', score, reason: 'ISO-8601 timestamp' };
}

// A `"` opens a field that ends at the next unescaped `"`; `""` inside a quoted field is a
// literal quote. Returns null on malformed quoting (unterminated, or trailing content after a
// closing quote before the delimiter).
function splitCsvLine(line: string, delim: string): string[] | null {
  const fields: string[] = [];
  const n = line.length;
  let i = 0;
  for (;;) {
    let field: string;
    if (line[i] === '"') {
      i++;
      let buf = '';
      let closed = false;
      while (i < n) {
        const c = line[i];
        if (c === '"') {
          if (line[i + 1] === '"') {
            buf += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        buf += c;
        i++;
      }
      if (!closed) return null;
      field = buf;
      if (i < n && line[i] !== delim) return null;
    } else {
      const start = i;
      while (i < n && line[i] !== delim) i++;
      field = line.slice(start, i);
    }
    fields.push(field);
    if (i >= n) break;
    i++;
  }
  return fields;
}

function pickCsvShape(lines: string[]): { delim: string; fieldCount: number } | null {
  for (const delim of [',', '\t', ';']) {
    const rows = lines.map((l) => splitCsvLine(l, delim));
    if (rows.some((r) => r === null)) continue;
    const counts = (rows as string[][]).map((r) => r.length);
    const first = counts[0];
    if (first < 2) continue;
    if (counts.every((c) => c === first)) return { delim, fieldCount: first };
  }
  return null;
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim().length > 0);
}

function detectCsv(input: DetectInput): FormatGuess | null {
  const lines = nonEmptyLines(input.text);
  if (lines.length < 2) return null; // a single line is never CSV
  const shape = pickCsvShape(lines);
  if (!shape) return null;
  const score = lines.length >= 3 ? 0.75 : 0.6;
  return { format: 'csv', score, reason: `${lines.length} rows × ${shape.fieldCount} columns` };
}

function detectText(): FormatGuess {
  return { format: 'text', score: 0.1, reason: 'no distinguishing shape' };
}

const DETECTORS: Record<CellFormat, (input: DetectInput) => FormatGuess | null> = {
  json: detectJson,
  xml: detectXml,
  sql: detectSql,
  base64: detectBase64,
  hex: detectHex,
  epochSeconds: detectEpochSeconds,
  epochMillis: detectEpochMillis,
  iso8601: detectIso8601,
  uuid: detectUuid,
  url: detectUrl,
  csv: detectCsv,
  text: detectText,
};

/**
 * Pure, synchronous and allocation-light — on the 50 ms selection path (§2.1), against up to
 * 64 KB. Sorted by score desc, then §5c's precedence order. Never empty: `text` is always
 * eligible and its detector always matches.
 */
export function detectFormat(input: DetectInput): FormatGuess[] {
  if (input.text === '') return [{ format: 'text', score: 1.0, reason: 'empty value' }];

  const eligible = ELIGIBLE_BY_TYPE_CLASS[input.typeClass];
  const guesses: FormatGuess[] = [];
  for (const format of eligible) {
    const guess = DETECTORS[format](input);
    if (guess) guesses.push(guess);
  }
  guesses.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return PRECEDENCE.indexOf(a.format) - PRECEDENCE.indexOf(b.format);
  });
  return guesses;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

const MONTH_ABBR = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

/** A decoded timestamp reading, local first (D15 revised — its own row, not the status badge). */
export interface TimestampReading {
  local: string;
  utc: string;
}

// No query, no round trip: the local half is read straight from the runtime's own timezone
// (Intl/Date already know it), so this is pure client-side math against a value already sitting
// in the buffer — never something that needs asking the server. Only the zone abbreviation
// (e.g. "GMT+2") comes from Intl; the digits themselves use the Date object's own local getters
// so both halves are built the same way, just against UTC vs. local getters.
function formatUtcAndLocal(d: Date): TimestampReading {
  const utc = `${MONTH_ABBR[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  const zoneName =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const local = `${MONTH_ABBR[d.getMonth()]} ${pad(d.getDate())} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zoneName}`;
  return { local, utc };
}

// Matches detectIso8601's own ISO8601_RE offset group exactly (the minutes half is optional) —
// Postgres's default text output for a whole-hour UTC offset is just "+00", not "+00:00"/"+0000",
// so a stricter pattern here (requiring the minutes digits) missed that extremely common case,
// silently breaking decoding for the majority of real timestamptz values.
const ISO8601_OFFSET_RE = /(Z|[+-]\d{2}(:?\d{2})?)$/;
const ISO8601_HAS_TIME_RE = /[T ]\d{2}:\d{2}/;

// An ISO-8601-shaped value with no explicit offset (Postgres's `timestamp without time zone`,
// e.g. "2024-01-15 10:23:45") is genuinely ambiguous — JS's own Date constructor would silently
// read it as *local* time instead, which is wrong far more often than right for a DB timestamp.
// Treat a bare clock time as UTC (the common backend convention) rather than guess local.
//
// A value that already states its offset is left with its ORIGINAL separator, not normalized to
// 'T' — V8's date parser runs two different grammars depending on that separator: with 'T' it's
// strict ISO-8601, which requires a full ±HH:MM/±HHMM offset and rejects a bare 2-digit "+00";
// with a space it falls back to a lenient legacy parser that accepts exactly that shape. Since
// Postgres's own text output *is* space-separated with a bare "+00" for a whole-hour UTC offset,
// converting the separator here would take an already-parseable value and make V8 reject it
// (verified against this app's actual runtime, not assumed from spec reading).
//
// A date-only value (no time part at all, e.g. a `date` column) is left untouched too — the
// "YYYY-MM-DD" form is already specified as UTC by Date.parse itself.
function parseIso8601(t: string): Date | null {
  const hasOffset = ISO8601_OFFSET_RE.test(t);
  const hasTime = ISO8601_HAS_TIME_RE.test(t);
  const normalized = !hasTime || hasOffset ? t : `${t.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The Date a timestamp-shaped cell's text represents, or null if it doesn't parse — shared by
// describeTimestamp's reading and the datetime-local picker's initial value (CellEditorView.vue),
// so the picker can never show a moment describeTimestamp itself couldn't decode.
export function parseTimestampValue(format: CellFormat, text: string): Date | null {
  const t = text.trim();
  try {
    if (format === 'epochSeconds' || format === 'epochMillis') {
      const n = Number(t);
      if (!Number.isFinite(n)) return null;
      const d = new Date(format === 'epochSeconds' ? n * 1000 : n);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (format === 'iso8601') return parseIso8601(t);
    return null;
  } catch {
    return null;
  }
}

// D15 revised: a decoded timestamp gets its own row under the header (too long to share the
// status badge with the byte count) — CellEditorView calls this separately from describeValue.
export function describeTimestamp(format: CellFormat, text: string): TimestampReading | null {
  const d = parseTimestampValue(format, text);
  return d ? formatUtcAndLocal(d) : null;
}

// The inverse of parseTimestampValue — encodes a Date picked from the cell editor's
// datetime-local input back into the cell's own timestamp shape, so picking a date is exactly as
// reversible as typing one by hand. `null` for any non-timestamp format (the caller only ever
// calls this when parseTimestampValue's own format check already passed).
export function encodeTimestamp(format: CellFormat, d: Date): string | null {
  if (format === 'epochSeconds') return String(Math.round(d.getTime() / 1000));
  if (format === 'epochMillis') return String(d.getTime());
  if (format === 'iso8601') return d.toISOString();
  return null;
}

// `<input type="datetime-local">`'s own value shape: local wall-clock time, no offset — built from
// the same local getters formatUtcAndLocal already uses for the local half of its reading.
export function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// Parses a datetime-local input's value from its components, not via `new Date(str)` — a bare
// "YYYY-MM-DDTHH:mm:ss" string is ambiguous across engines (UTC vs. local), the same class of
// problem parseIso8601's own comment documents for an offset-less ISO string. Constructing from
// components pins it to local time unambiguously, matching what the picker's own clock face shows.
export function fromDatetimeLocalValue(value: string): Date | null {
  const m = DATETIME_LOCAL_RE.exec(value);
  if (!m) return null;
  const [, y, mo, day, h, mi, s] = m;
  const d = new Date(
    Number(y),
    Number(mo) - 1,
    Number(day),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** D15's one-line reading, or null when the format implies no decoding. Must never throw. */
export function describeValue(format: CellFormat, text: string): string | null {
  const t = text.trim();
  try {
    if (format === 'base64') {
      const isUrlSafe = !BASE64_STD_RE.test(t) && BASE64_URL_RE.test(t);
      const bytes = atob(base64ToStd(t, isUrlSafe)).length;
      return bytes > 0 ? `${bytes} bytes decoded` : null;
    }
    if (format === 'hex') {
      const digits = t.startsWith('0x') ? t.slice(2) : t;
      const bytes = Math.floor(digits.length / 2);
      return bytes > 0 ? `${bytes} bytes` : null;
    }
    if (format === 'csv') {
      const lines = nonEmptyLines(text);
      const shape = pickCsvShape(lines);
      return shape ? `${lines.length} rows × ${shape.fieldCount} columns` : null;
    }
    return null;
  } catch {
    return null;
  }
}
