import type { Settings } from '../../../state/settingsDomain';

// Calendar arithmetic shared by the ADE queue engines: integer day offsets from `today`, via
// `Date.UTC` / `civilFromDays` (no DST drift, no clock read). Moved verbatim from `useQueue.ts` (P144).

/** Mockup line 934: the sentinel "no day assigned yet" offset. */
export const LATER = 9999;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MO = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;

// -------------------------------------------------------------------------------------------------
// §0.7: estimates from settings, not constants
// -------------------------------------------------------------------------------------------------

/** Cap on a task's span; an older stored estimate can exceed the bound the API now enforces. */
export const MAX_SPAN_DAYS = 60;

export function parseEst(
  raw: string,
  workdayHours: number,
  spanDayShare: number,
): { hours: number; days: number } | null {
  const m = String(raw ?? '')
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/);
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  const unit = m[2];
  if (unit === 'm') return { hours: n / 60, days: 1 };
  if (unit === 'h') {
    return {
      hours: n,
      days: Math.min(MAX_SPAN_DAYS, Math.max(1, Math.ceil(n / workdayHours - 1e-9))),
    };
  }
  if (unit === 'd') {
    const days = Math.min(MAX_SPAN_DAYS, Math.max(1, Math.ceil(n)));
    return {
      hours: days === 1 ? workdayHours : days * workdayHours * spanDayShare,
      days,
    };
  }
  // 'w'
  const days = Math.min(MAX_SPAN_DAYS, Math.max(1, Math.ceil(n * 5)));
  return { hours: days * workdayHours * spanDayShare, days };
}

// -------------------------------------------------------------------------------------------------
// §0.6: calendar arithmetic, integer day offsets from `today` via `Date.UTC` (no DST drift)
// -------------------------------------------------------------------------------------------------

/** Days-since-epoch for an ISO `YYYY-MM-DD`, via `Date.UTC` — immune to the local zone's DST. */
export function isoToDays(iso: string): number {
  const [y, mo, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d) / DAY_MS;
}

/** P129 Part 5 §0.4: a day offset from `today` as its own ISO `YYYY-MM-DD` — not defined for
 *  `LATER`. The inverse of `isoToOffset`, both on the same `isoToDays`/`civilFromDays` arithmetic
 *  (no `Date` constructor, Part 3's own clock-read audit grep). */
export function offsetToIso(today: string, k: number): string {
  const { year, month0, date } = civilFromDays(isoToDays(today) + k);
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** The inverse of `offsetToIso`: an ISO `YYYY-MM-DD`'s own day offset from `today`. */
export function isoToOffset(today: string, iso: string): number {
  return isoToDays(iso) - isoToDays(today);
}

export interface Calendar {
  todayDays: number;
  offDays: ReadonlySet<number>;
  workWeekend: ReadonlySet<number>;
}

export function buildCalendar(today: string, settings: Settings['ade']): Calendar {
  const todayDays = isoToDays(today);
  const toOffsets = (dates: readonly string[]): Set<number> =>
    new Set(dates.map((d) => isoToDays(d) - todayDays));
  return {
    todayDays,
    offDays: toOffsets(settings.offDays),
    workWeekend: toOffsets(settings.workWeekendDays),
  };
}

/** Days-since-epoch → proleptic-Gregorian {year, month0 (0-based), date} — Howard Hinnant's
 *  `civil_from_days`, pure integer arithmetic. Deliberately avoids the JS `Date` constructor: the
 *  closing audit's own clock-read grep matches that constructor's name as a plain substring
 *  regardless of arguments, so building one here — even from a fully deterministic offset, never the
 *  live clock — would leave that check non-empty. */
function civilFromDays(daysSinceEpoch: number): {
  year: number;
  month0: number;
  date: number;
} {
  const z = daysSinceEpoch + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const date = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: y + (m <= 2 ? 1 : 0), month0: m - 1, date };
}

export function dateParts(cal: Calendar, k: number): { dow: number; date: number; month: number } {
  const days = cal.todayDays + k;
  const { month0, date } = civilFromDays(days);
  const dow = ((((days % 7) + 7) % 7) + 4) % 7; // 1970-01-01 (day 0) was a Thursday (index 4).
  return { dow, date, month: month0 };
}

export function isWeekend(cal: Calendar, k: number): boolean {
  const dow = dateParts(cal, k).dow;
  return dow === 0 || dow === 6;
}

export function isDayOff(cal: Calendar, k: number): boolean {
  return cal.offDays.has(k);
}

function isOff(cal: Calendar, k: number): boolean {
  return isDayOff(cal, k) || (isWeekend(cal, k) && !cal.workWeekend.has(k));
}

export function nextWork(cal: Calendar, k: number): number {
  let n = k + 1;
  while (isOff(cal, n)) n++;
  return n;
}

/** Mockup `firstWork` (line 944): `k` itself when it's already a work day, else the next one —
 *  `QueueView.firstWorkDay` is `firstWork(cal, 0)` (today, or the next work day). */
export function firstWork(cal: Calendar, k: number): number {
  return isOff(cal, k) ? nextWork(cal, k) : k;
}

export function dayLabel(cal: Calendar, k: number): string {
  if (k === LATER) return 'Later';
  if (k === 0) return 'Today';
  const p = dateParts(cal, k);
  return `${WD[p.dow]} ${p.date}`;
}

export function spanDays(cal: Calendar, start: number, n: number): number[] {
  const out = [start];
  let k = start;
  while (out.length < n) {
    k = nextWork(cal, k);
    out.push(k);
  }
  return out;
}
