// P94 pass 3 §4.3, shape 4 first pattern: CommitGrid.vue's handleKeyDown (35) — a dozen key
// branches, six of them (the nav keys) each re-checking `length === 0` on their own — moved out
// with everything it needs passed in explicitly (§4.2), never reaching back into the SFC's own
// scope. The nav keys' shared `length === 0` guard is hoisted above their own switch, the biggest
// single contributor to the original score; every other key's own guard is unchanged.
import type { RowPlan } from '@kira/git-core';
import type { Ref } from 'vue';

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export interface GridKeyboardDeps {
  plan: () => RowPlan;
  /** CommitGrid.vue's own `focusedRowIndex` — a plain (non-reactive) module-scope `let`, so this
   *  must be a getter, read fresh on every call, not a value snapshotted once. */
  focusedRowIndex: () => number | null;
  selectionRow: Ref<number>;
  moveSelection: (displayRow: number) => void;
  pageSize: () => number;
  toggleGroup: (displayRow: number) => void;
  openMenuFromKeyboard: (row: number) => void;
  emit: {
    (e: 'toggleDetail'): void;
    (e: 'closeDetail'): void;
    (e: 'refresh'): void;
  };
}

// One of the six nav keys — `undefined` when `event.key` isn't one of them at all (the caller's
// own signal to fall through to handleActionKey), `false`/`true` otherwise.
function handleNavKey(
  event: KeyboardEvent,
  deps: GridKeyboardDeps,
  length: number,
  currentDisplayRow: number,
): boolean | undefined {
  if (!NAV_KEYS.has(event.key)) return undefined;
  if (length === 0) return false;
  event.preventDefault();
  switch (event.key) {
    case 'ArrowUp':
      deps.moveSelection(currentDisplayRow < 0 ? 0 : currentDisplayRow - 1);
      return true;
    case 'ArrowDown':
      deps.moveSelection(currentDisplayRow < 0 ? 0 : currentDisplayRow + 1);
      return true;
    case 'Home':
      deps.moveSelection(0);
      return true;
    case 'End':
      deps.moveSelection(length - 1);
      return true;
    case 'PageUp':
      deps.moveSelection((currentDisplayRow < 0 ? 0 : currentDisplayRow) - deps.pageSize());
      return true;
    case 'PageDown':
      deps.moveSelection((currentDisplayRow < 0 ? 0 : currentDisplayRow) + deps.pageSize());
      return true;
  }
  return undefined; // unreachable — NAV_KEYS.has(event.key) above already matched one of the six.
}

// Every non-nav key handleGridKeyDown claims: Enter/Space (group toggling), Escape/F5/Ctrl+R
// (detail pane and refresh), F10/ContextMenu (the row's own context menu).
function handleActionKey(
  event: KeyboardEvent,
  deps: GridKeyboardDeps,
  currentDisplayRow: number,
  currentStoreRow: number,
): boolean {
  switch (event.key) {
    case 'Enter':
      event.preventDefault();
      // P93 §4.2: "click anywhere on the row, or Enter/Space with it focused, expands the group"
      // — Enter on a focused placeholder expands it instead of toggling the detail pane (there is
      // no commit to show details for).
      if (currentDisplayRow >= 0 && deps.plan().entryAt(currentDisplayRow).kind === 'collapsed') {
        deps.toggleGroup(currentDisplayRow);
      } else {
        deps.emit('toggleDetail');
      }
      return true;
    case ' ':
      // Space has no meaning on an ordinary row today (SPEC never gave it one) — claimed only for
      // a focused placeholder, so an ordinary row's Space still falls through to the browser's own
      // default (e.g. a page-down scroll a plain `<div>` focus target would otherwise get).
      if (currentDisplayRow < 0 || deps.plan().entryAt(currentDisplayRow).kind !== 'collapsed') {
        return false;
      }
      event.preventDefault();
      deps.toggleGroup(currentDisplayRow);
      return true;
    case 'Escape':
      event.preventDefault();
      deps.emit('closeDetail');
      return true;
    case 'F5':
      event.preventDefault();
      deps.emit('refresh');
      return true;
    case 'r':
    case 'R':
      if (!event.ctrlKey && !event.metaKey) return false;
      event.preventDefault();
      deps.emit('refresh');
      return true;
    case 'F10':
      if (!event.shiftKey || currentStoreRow < 0) return false;
      event.preventDefault();
      deps.openMenuFromKeyboard(currentStoreRow);
      return true;
    case 'ContextMenu':
      if (currentStoreRow < 0) return false;
      event.preventDefault();
      deps.openMenuFromKeyboard(currentStoreRow);
      return true;
    default:
      return false;
  }
}

/** §6.6's own keyboard model, moved out of CommitGrid.vue's own scope (P94 pass 3 §4.3) — see
 *  that component's own onKeyDown subscription for why the boolean return matters (`Tab`
 *  specifically). */
export function handleGridKeyDown(event: KeyboardEvent, deps: GridKeyboardDeps): boolean {
  const length = deps.plan().length;
  const currentStoreRow = deps.selectionRow.value;
  const selectionDisplayRow = currentStoreRow < 0 ? -1 : deps.plan().displayRowOf(currentStoreRow);
  // P93 §4.2: arrow/Home/End/Page navigation continues from wherever DOM focus actually is, not
  // from the last *selected* commit — a collapsed placeholder is focusable (`moveSelection`'s own
  // doc comment) but never selected, so `selection.row` alone would strand navigation one row
  // short of it forever. `focusedRowIndex` is exactly "the row the user is actually on" (its own
  // doc comment); falls back to the selection-derived row whenever nothing has focus yet (a fresh
  // mount, before any `focusin`), unchanged from before this existed.
  const focused = deps.focusedRowIndex();
  const currentDisplayRow = focused !== null && focused < length ? focused : selectionDisplayRow;

  const navResult = handleNavKey(event, deps, length, currentDisplayRow);
  if (navResult !== undefined) return navResult;
  return handleActionKey(event, deps, currentDisplayRow, currentStoreRow);
}
