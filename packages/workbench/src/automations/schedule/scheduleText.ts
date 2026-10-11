import type { ScriptSchedule } from '@shared/domain/scripts';
import { t } from '@theme/i18n';

export function schedulePresets(): readonly { label: string; cron: string }[] {
  const time = '09:00';
  return [
    { label: t('automations.schedule.everyMinutes.option', { count: 15 }), cron: '*/15 * * * *' },
    { label: t('automations.schedule.everyHour.option'), cron: '0 * * * *' },
    { label: t('automations.schedule.everyDay.option', { time }), cron: '0 9 * * *' },
    { label: t('automations.schedule.weekdays.option', { time }), cron: '0 9 * * 1-5' },
    { label: t('automations.schedule.mondays.option', { time }), cron: '0 9 * * 1' },
  ];
}

/** The window's own IANA zone; "UTC" when the runtime cannot tell. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every IANA zone the runtime knows, with UTC first. */
export function timezones(): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // an older runtime lists none: the picker offers UTC and the window's zone
  }
  return [...new Set(['UTC', localTimezone(), ...zones])];
}

export function newSchedule(): ScriptSchedule {
  return {
    cron: '0 9 * * *',
    timezone: localTimezone(),
    enabled: true,
    confirm: true,
    timeout: '',
    params: {},
    taskId: '',
    branchId: '',
  };
}

/** "Tue 09:00" in the zone; a zone Intl rejects falls back to UTC. */
export function fireText(ms: number, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: timezone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(ms);
  }
}

/** "09:00" in the zone, for a row's `next` text. */
export function clockText(ms: number, timezone: string): string {
  const full = fireText(ms, timezone);
  return full.replace(/^\S+\s/, '');
}
