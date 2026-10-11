import { t } from '@theme/i18n';
import type { Settings, SettingsPatch } from '../../../state/settingsDomain';
import { type Calendar, isWeekend, LATER, offsetToIso } from './calendar';

export interface DayMenu {
  label: string;
  patch: SettingsPatch['ade'];
  /** Marking a worked weekday off, with tasks starting that day: offer to move them. */
  confirm: boolean;
}

/** Day context menu, mockup v2 lines 1315-1332. `null` on Later and past days; off > weekend > weekday. */
export function dayMenuFor(
  cal: Calendar,
  settings: Settings['ade'],
  today: string,
  day: number,
  startCount: number,
): DayMenu | null {
  if (day === LATER || day < 0) return null;
  const iso = offsetToIso(today, day);
  if (cal.offDays.has(day)) {
    return {
      label: t('space.ade.board.dayMenu.workingDay.label'),
      patch: { offDays: settings.offDays.filter((d) => d !== iso) },
      confirm: false,
    };
  }
  if (isWeekend(cal, day)) {
    return cal.workWeekend.has(day)
      ? {
          label: t('space.ade.board.dayMenu.weekend.label'),
          patch: { workWeekendDays: settings.workWeekendDays.filter((d) => d !== iso) },
          confirm: false,
        }
      : {
          label: t('space.ade.board.dayMenu.workThisDay.label'),
          patch: { workWeekendDays: [...settings.workWeekendDays, iso] },
          confirm: false,
        };
  }
  return {
    label: t('space.ade.board.dayMenu.dayOff.label'),
    patch: { offDays: [...settings.offDays.filter((d) => d >= today), iso] },
    confirm: startCount > 0,
  };
}
