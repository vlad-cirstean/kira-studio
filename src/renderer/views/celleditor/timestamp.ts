import type { CellFormat } from './formats';

// P24 D17: everything timestamp-shaped moved out of detect.ts, which is about *detection* and
// carried 130 lines of unrelated date math. detect.ts keeps ISO8601_RE (for detectIso8601) and
// describeValue; everything below is new to this module or moved here verbatim.

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

/** P24 D16: the spelling a value already used, so re-encoding is byte-shape-preserving. */
export interface TimestampShape {
  kind: 'epochSeconds' | 'epochMillis' | 'iso8601';
  /** iso8601 only: ' ' or 'T' — Postgres emits a space, JSON emits 'T'. */
  separator: ' ' | 'T';
  /** iso8601 only: how the original spelled its offset. 'none' = a bare local/UTC clock time. */
  offset: 'none' | 'Z' | '+HH' | '+HH:MM' | '+HHMM';
  /** iso8601 only: the offset's own minutes from UTC, so re-encoding keeps the original zone. */
  offsetMinutes: number;
  /** iso8601 only: digits of sub-second precision in the original (0-9). */
  fractionDigits: number;
  /** iso8601 only: the original fraction's exact digits (may exceed `Date`'s ms precision — see
   *  encodeTimestamp's own note on why this is carried separately from `fractionDigits`). '' when
   *  `fractionDigits` is 0. */
  fractionRaw: string;
  /** iso8601 only: true when the original had no time part at all (a `date` column). */
  dateOnly: boolean;
}

/** A plain, unremarkable shape for a format with no existing value to preserve the spelling of. */
export function defaultShapeFor(kind: TimestampShape['kind']): TimestampShape {
  return {
    kind,
    separator: 'T',
    offset: kind === 'iso8601' ? 'Z' : 'none',
    offsetMinutes: 0,
    fractionDigits: 0,
    fractionRaw: '',
    dateOnly: false,
  };
}

function parseOffsetPart(raw: string | undefined): {
  style: TimestampShape['offset'];
  minutes: number;
} {
  if (!raw) return { style: 'none', minutes: 0 };
  if (raw === 'Z') return { style: 'Z', minutes: 0 };
  const m = /^([+-])(\d{2})(:?)(\d{2})?$/.exec(raw);
  if (!m) return { style: 'none', minutes: 0 }; // unreachable given ISO_PARTS_RE, kept total
  const sign = m[1] === '-' ? -1 : 1;
  const hh = Number(m[2]);
  const mm = m[4] ? Number(m[4]) : 0;
  const style: TimestampShape['offset'] = !m[4] ? '+HH' : m[3] ? '+HH:MM' : '+HHMM';
  return { style, minutes: sign * (hh * 60 + mm) };
}

// Same date/time/offset grammar as detect.ts's ISO8601_RE (the space separator is not optional —
// Postgres renders `timestamptz` as `2024-01-15 10:23:45.123456+00`), but with capture groups:
// this one decomposes a value into its exact spelling instead of only gating on its shape.
const ISO_PARTS_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function parseIso8601Shaped(text: string): { date: Date; shape: TimestampShape } | null {
  const m = ISO_PARTS_RE.exec(text.trim());
  if (!m) return null;
  const [, y, mo, day, sep, h, mi, s, frac, offsetRaw] = m;
  const monthN = Number(mo);
  const dayN = Number(day);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  const dateOnly = sep === undefined;
  if (!dateOnly) {
    const hN = Number(h);
    const miN = Number(mi);
    const sN = s ? Number(s) : 0;
    if (hN > 23 || miN > 59 || sN > 60) return null; // 60: tolerate a leap-second text
  }
  const { style: offset, minutes: offsetMinutes } = parseOffsetPart(offsetRaw);
  const fractionDigits = frac ? frac.length : 0;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  const utcMs =
    Date.UTC(
      Number(y),
      monthN - 1,
      dayN,
      dateOnly ? 0 : Number(h),
      dateOnly ? 0 : Number(mi),
      dateOnly ? 0 : s ? Number(s) : 0,
      ms,
    ) -
    offsetMinutes * 60_000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date,
    shape: {
      kind: 'iso8601',
      separator: dateOnly ? 'T' : (sep as ' ' | 'T'),
      offset,
      offsetMinutes,
      fractionDigits,
      fractionRaw: frac ?? '',
      dateOnly,
    },
  };
}

/** The Date a timestamp-shaped cell's text represents, alongside the shape it was spelled in. */
export function parseTimestamp(
  format: CellFormat,
  text: string,
): { date: Date; shape: TimestampShape } | null {
  const t = text.trim();
  if (format === 'epochSeconds' || format === 'epochMillis') {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    const date = new Date(format === 'epochSeconds' ? n * 1000 : n);
    if (Number.isNaN(date.getTime())) return null;
    return { date, shape: defaultShapeFor(format) };
  }
  if (format === 'iso8601') return parseIso8601Shaped(t);
  return null;
}

/**
 * Exact inverse of parseTimestamp for every shape it can produce (P24 D16) — re-encoding a value
 * the cell already held reproduces its original separator, offset spelling and sub-second
 * precision, changing only the digits a genuine edit actually changed.
 */
export function encodeTimestamp(shape: TimestampShape, date: Date): string {
  if (shape.kind === 'epochSeconds') return String(Math.round(date.getTime() / 1000));
  if (shape.kind === 'epochMillis') return String(date.getTime());

  // iso8601: shift by the shape's own offset first, then read wall-clock components off the
  // shifted instant via the UTC getters — this is what makes the printed digits correct for
  // whatever zone the original spelled, without touching the runtime's own local timezone.
  const shifted = new Date(date.getTime() + shape.offsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  if (shape.dateOnly) return `${y}-${mo}-${d}`;

  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());
  let text = `${y}-${mo}-${d}${shape.separator}${h}:${mi}:${s}`;
  if (shape.fractionDigits > 0) {
    // `Date` only holds millisecond precision, so a microsecond-or-finer original (Postgres's
    // default) can't be regenerated purely from `shifted` — reuse the original digits verbatim
    // whenever the millisecond-level value is unchanged (true for every edit this app's UI can
    // make, since none of them touch sub-second precision directly); only actually round when the
    // instant's own millisecond value moved, which is the genuinely unrepresentable case.
    const msNow = String(shifted.getUTCMilliseconds()).padStart(3, '0');
    // Rounded the same way parseIso8601Shaped built the original `Date`'s own ms field (line ~95)
    // — truncating fractionRaw's first 3 digits instead would desync from that rounding whenever
    // the 4th+ digit rolls the ms value up (".901743" rounds to Date ms 902, but truncates to
    // "901"), making this comparison spuriously see a change and round away real precision on
    // every edit that didn't actually touch the sub-second value.
    const msOriginal = shape.fractionRaw
      ? String(Math.round(Number(`0.${shape.fractionRaw}`) * 1000)).padStart(3, '0')
      : '000';
    const fraction =
      msNow === msOriginal
        ? shape.fractionRaw
        : msNow.padEnd(shape.fractionDigits, '0').slice(0, shape.fractionDigits);
    text += `.${fraction}`;
  }
  if (shape.offset === 'Z') {
    text += 'Z';
  } else if (shape.offset !== 'none') {
    const sign = shape.offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(shape.offsetMinutes);
    const oh = pad(Math.floor(abs / 60));
    const om = pad(abs % 60);
    text +=
      shape.offset === '+HH'
        ? `${sign}${oh}`
        : shape.offset === '+HHMM'
          ? `${sign}${oh}${om}`
          : `${sign}${oh}:${om}`;
  }
  return text;
}

/** A decoded timestamp reading: local first, then UTC, then a relative phrase ("3 days ago"). */
export interface TimestampReading {
  local: string;
  utc: string;
  relative: string;
}

// No query, no round trip: the local half is read straight from the runtime's own timezone
// (Intl/Date already know it), so this is pure client-side math against a value already sitting
// in the buffer — never something that needs asking the server. Only the zone abbreviation
// (e.g. "GMT+2") comes from Intl; the digits themselves use the Date object's own local getters
// so both halves are built the same way, just against UTC vs. local getters.
function formatUtcAndLocal(d: Date): { local: string; utc: string } {
  const utc = `${MONTH_ABBR[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  const zoneName =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const local = `${MONTH_ABBR[d.getMonth()]} ${pad(d.getDate())} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zoneName}`;
  return { local, utc };
}

const RELATIVE_STEPS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365.25 * 86_400_000 },
  { unit: 'month', ms: 30.44 * 86_400_000 },
  { unit: 'week', ms: 7 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 days ago" / "in 2 hours" / "just now" — Intl.RelativeTimeFormat, no dependency (D18). */
export function relativeTime(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  if (Math.abs(diffMs) < 45_000) return 'just now';
  for (const { unit, ms } of RELATIVE_STEPS) {
    if (Math.abs(diffMs) >= ms || unit === 'minute') {
      return relativeFormatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return relativeFormatter.format(Math.round(diffMs / 60_000), 'minute'); // unreachable, kept total
}

/** D15's translate-pane reading — CellEditorView calls this separately from describeValue. */
export function describeTimestamp(format: CellFormat, text: string): TimestampReading | null {
  const parsed = parseTimestamp(format, text);
  if (!parsed) return null;
  const { local, utc } = formatUtcAndLocal(parsed.date);
  return { local, utc, relative: relativeTime(parsed.date, new Date()) };
}

/** 'YYYY-MM-DD HH:mm:ss[.fff]' in the chosen zone — the translate pane's editable field text. */
export function toEditableText(date: Date, zone: 'local' | 'utc', fractionDigits: number): string {
  const y = zone === 'utc' ? date.getUTCFullYear() : date.getFullYear();
  const mo = pad((zone === 'utc' ? date.getUTCMonth() : date.getMonth()) + 1);
  const d = pad(zone === 'utc' ? date.getUTCDate() : date.getDate());
  const h = pad(zone === 'utc' ? date.getUTCHours() : date.getHours());
  const mi = pad(zone === 'utc' ? date.getUTCMinutes() : date.getMinutes());
  const s = pad(zone === 'utc' ? date.getUTCSeconds() : date.getSeconds());
  let text = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  if (fractionDigits > 0) {
    const ms = String(zone === 'utc' ? date.getUTCMilliseconds() : date.getMilliseconds()).padStart(
      3,
      '0',
    );
    text += `.${ms.padEnd(fractionDigits, '0').slice(0, fractionDigits)}`;
  }
  return text;
}

const EDITABLE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** Inverse of toEditableText; `null` for anything that isn't a complete, in-range datetime. */
export function fromEditableText(text: string, zone: 'local' | 'utc'): Date | null {
  const m = EDITABLE_RE.exec(text.trim());
  if (!m) return null;
  const [, y, mo, day, h, mi, s, frac] = m;
  const monthN = Number(mo);
  const dayN = Number(day);
  const hN = Number(h);
  const miN = Number(mi);
  const sN = s ? Number(s) : 0;
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31 || hN > 23 || miN > 59 || sN > 60) {
    return null;
  }
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  const d =
    zone === 'utc'
      ? new Date(Date.UTC(Number(y), monthN - 1, dayN, hN, miN, sN, ms))
      : new Date(Number(y), monthN - 1, dayN, hN, miN, sN, ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- kept for the transitional native <input type="datetime-local"> path (deleted in P24
//     step 6, when TimestampPane/DateTimePicker replace it) --------------------------------

/** The Date a timestamp-shaped cell's text represents, or null if it doesn't parse. */
export function parseTimestampValue(format: CellFormat, text: string): Date | null {
  return parseTimestamp(format, text)?.date ?? null;
}

// `<input type="datetime-local">`'s own value shape: local wall-clock time, no offset.
export function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// Parses a datetime-local input's value from its components, not via `new Date(str)` — a bare
// "YYYY-MM-DDTHH:mm:ss" string is ambiguous across engines (UTC vs. local). Constructing from
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
