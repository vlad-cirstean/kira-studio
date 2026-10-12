import type { ScriptSchedule } from '@shared/domain/scripts';
import { t } from '@theme/i18n';
import { formatZonedWeekdayClock, localTimezone } from '@workbench/behaviour/format';

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

/** "09:00" in the zone, for a row's `next` text. */
export function clockText(ms: number, timezone: string): string {
  const full = formatZonedWeekdayClock(ms, timezone);
  return full.replace(/^\S+\s/, '');
}
