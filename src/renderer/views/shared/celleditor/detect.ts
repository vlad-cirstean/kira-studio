import type { TypeClass } from '@shared/protocol/page';
import { scanJson, scanXml } from '../../../beautify';
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

// §5c: equal-score ties break on this order, highest first. P42 D23: uuid/url removed — every
// remaining format here still has an entry (Array.indexOf returns -1, and -1 sorts first, for
// anything missing one).
const PRECEDENCE: readonly CellFormat[] = [
  'json',
  'xml',
  'sql',
  'iso8601',
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

// P42 D23/D24: uuid and url are gone as formats (F19 — both inert on selection), but this regex
// survives as a guard: a dashed v4 UUID is 36 chars, 36 % 4 === 0, ≥ BASE64_MIN_LENGTH, matches
// BASE64_URL_RE ('-' is in the URL-safe alphabet) and atob()-decodes — without this guard every
// UUID column in the app would start detecting as base64 and open a decoded-text pane of
// mojibake. `detectUrl` needed no such guard: a URL's ':' and '.' are outside both base64
// alphabets and HEX_RE, and one line is never CSV, so it already falls through to `text` on its
// own with nothing deleted here.
const UUID_RE = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

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
  if (UUID_RE.test(t)) return null; // a dashed UUID is base64-shaped too (P42 D24) — let it stay text
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
