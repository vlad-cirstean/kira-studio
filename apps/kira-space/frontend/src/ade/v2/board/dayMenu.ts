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
      label: 'Mark as working day',
      patch: { offDays: settings.offDays.filter((d) => d !== iso) },
      confirm: false,
    };
  }
  if (isWeekend(cal, day)) {
    return cal.workWeekend.has(day)
      ? {
          label: 'Mark as weekend (off)',
          patch: { workWeekendDays: settings.workWeekendDays.filter((d) => d !== iso) },
          confirm: false,
        }
      : {
          label: 'Work this day',
          patch: { workWeekendDays: [...settings.workWeekendDays, iso] },
          confirm: false,
        };
  }
  return {
    label: 'Mark as day off',
    patch: { offDays: [...settings.offDays.filter((d) => d >= today), iso] },
    confirm: startCount > 0,
  };
}
