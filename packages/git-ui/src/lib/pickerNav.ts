import type { InjectionKey } from 'vue';

/** Provided by `RefsPopover`: makes a picker row the roving stop and focuses it. A child list
 *  calls it before a right-click menu opens (focus-only lists take focus first). */
export const PICKER_FOCUS_ROW: InjectionKey<(rowId: string) => void> = Symbol('pickerFocusRow');
