import { t } from '@theme/i18n';
import { type UseTimeAgoOptions, useTimeAgo } from '@vueuse/core';
import type { MaybeRefOrGetter } from 'vue';

// The one place app code turns a number or instant into text. Anything shown to a user as a size,
// a count, a duration, an age, a date-time or a missing value comes from here.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** '0 B' / '842 B' / '1.2 KB' / '341 MB': 1024 steps, one decimal under 100, none above. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (unit < BYTE_UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const text = value.toFixed(value < 99.95 ? 1 : 0);
  if (text === '1024' && unit < BYTE_UNITS.length - 1) return `1.0 ${BYTE_UNITS[unit + 1]}`;
  return `${text} ${BYTE_UNITS[unit]}`;
}

/** One decimal under 100%, whole numbers above (multi-core CPU can pass 100%). */
export function formatPercent(n: number): string {
  return n >= 100 ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;
}

const COUNT_FORMAT = new Intl.NumberFormat();

/** A count with the locale's digit grouping: '12,345'. */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n);
}

/** A finished duration: '240 ms' / '3.4 s' / '2m 5s' / '1h 2m'. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return t('format.duration.ms', { value: Math.round(ms) });
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return t('format.duration.seconds', { value: tenths.toFixed(1) });
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return t('format.duration.minutesSeconds', { minutes, seconds: totalSeconds % 60 });
  }
  return t('format.duration.hoursMinutes', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/** A running clock: 'm:ss', or 'h:mm:ss' from the first hour. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

type Instant = number | string | Date;

function toMillis(at: Instant): number {
  return at instanceof Date ? at.getTime() : typeof at === 'number' ? at : new Date(at).getTime();
}

/** 'just now' / '5m ago' / '3h ago' / '2d ago'. */
export function formatRelative(at: Instant, now: number = Date.now()): string {
  const minutes = Math.floor((now - toMillis(at)) / 60000);
  if (minutes < 1) return t('format.relative.justNow');
  if (minutes < 60) return t('format.relative.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('format.relative.hours', { count: hours });
  return t('format.relative.days', { count: Math.floor(hours / 24) });
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** 'Oct 11, 2026, 4:29 AM' in the user's locale. */
export function formatDateTime(at: Instant): string {
  return DATE_TIME_FORMAT.format(toMillis(at));
}

const WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** A date without a time, with its weekday: 'Tue, 14 Oct' in the user's locale. */
export function formatWeekdayDate(at: Instant): string {
  return WEEKDAY_DATE_FORMAT.format(toMillis(at));
}

/** '04:29:57.123' in local time. */
export function formatClockTime(at: Instant): string {
  const d = new Date(toMillis(at));
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** The placeholder for a missing value: an em dash, never an empty cell or '-'. */
export function displayValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

// `justNow` is a plain string in VueUse, so the options resolve per call, not at module load.
function relativeOptions(): UseTimeAgoOptions<false, 'minute' | 'hour' | 'day'> {
  return {
    messages: {
      justNow: t('format.relative.justNow'),
      past: (n: string) => t('format.relative.past', { time: n }),
      future: (n: string) => t('format.relative.future', { time: n }),
      invalid: '',
      minute: (n: number) => t('format.relative.unitMinute', { count: n }),
      hour: (n: number) => t('format.relative.unitHour', { count: n }),
      day: (n: number) => t('format.relative.unitDay', { count: n }),
    },
    units: [
      { max: 3_600_000, value: 60_000, name: 'minute' },
      { max: 86_400_000, value: 3_600_000, name: 'hour' },
      { max: Number.POSITIVE_INFINITY, value: 86_400_000, name: 'day' },
    ],
  };
}

/** A reactive `formatRelative`: the same words, kept current as time passes. */
export function useRelativeTime(at: MaybeRefOrGetter<Date | number | string>) {
  return useTimeAgo(at, relativeOptions());
}
