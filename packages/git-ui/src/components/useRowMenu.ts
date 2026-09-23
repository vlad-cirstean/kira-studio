import { type ShallowRef, shallowRef } from 'vue';

/**
 * I2-21: `TagList.vue`'s and `BranchPicker.vue`'s own ref-scoped context menu — open state, open
 * (right-click) and open-from-button (the row's own "More actions" button) were byte-identical;
 * only what the menu's own sections/dispatch do with `row` genuinely differs per caller (a tag
 * row's own action set is a subset of a branch row's), so this composable owns positioning only.
 */
interface RowMenuState<T> {
  readonly row: T;
  readonly x: number;
  readonly y: number;
}

export interface RowMenu<T> {
  readonly menu: ShallowRef<RowMenuState<T> | undefined>;
  open(row: T, event: MouseEvent): void;
  openFromButton(row: T, event: MouseEvent): void;
}

export function useRowMenu<T>(): RowMenu<T> {
  // shallowRef, not ref: T is caller-supplied (RefRow/StashEntry) and never itself reactive —
  // deep unwrapping (Vue's UnwrapRef<T>) both serves no purpose here and is what a generic ref()
  // can't type-check against an arbitrary T.
  const menu = shallowRef<RowMenuState<T> | undefined>(undefined);

  function open(row: T, event: MouseEvent): void {
    event.preventDefault();
    menu.value = { row, x: event.clientX, y: event.clientY };
  }

  function openFromButton(row: T, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.value = { row, x: rect.left, y: rect.bottom };
  }

  return { menu, open, openFromButton };
}
