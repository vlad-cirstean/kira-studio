// P94 pass 3 §4.3, shape 3 + shape 4 first pattern: ContextMenu.vue's onKeydown's six key
// branches, each re-checking activeSubIndex.value >= 0 and clearing submenuTimer, as one
// key-handler table instead. `ContextMenuKeyContext` carries the SFC's own refs/computed refs
// directly (never a snapshot of their `.value`) — a handler reads `.value` exactly when the
// inline code did, including ArrowRight/Enter's own re-read of `navigableSub` right after
// `openSubmenuId` changes underneath it (§4.2: passing the Ref itself, not the reactive read
// outside its own moment, is what keeps that ordering identical).
import type { ComputedRef, Ref } from 'vue';
import type { MenuItem } from '../state/contextMenu';

export interface ContextMenuKeyContext {
  activeIndex: Ref<number>;
  activeSubIndex: Ref<number>;
  openSubmenuId: Ref<string | null>;
  navigable: ComputedRef<MenuItem[]>;
  navigableSub: ComputedRef<MenuItem[]>;
  activeTopItem: ComputedRef<MenuItem | null>;
  activeSubItem: ComputedRef<MenuItem | null>;
  clearSubmenuTimer: () => void;
  onItemClick: (item: MenuItem) => void | Promise<void>;
}

export type ContextMenuKeyHandler = (ctx: ContextMenuKeyContext) => void;

/** Wraps in both directions; from -1 (nothing active yet), Down lands on the first row and Up on
 *  the last — the ordinary "nothing selected yet" convention, not the generic wrap formula's own
 *  off-by-one from -1. */
function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}

function handleArrowVertical(delta: 1 | -1): ContextMenuKeyHandler {
  return (ctx) => {
    if (ctx.activeSubIndex.value >= 0) {
      ctx.activeSubIndex.value = stepIndex(
        ctx.activeSubIndex.value,
        delta,
        ctx.navigableSub.value.length,
      );
      return;
    }
    ctx.activeIndex.value = stepIndex(ctx.activeIndex.value, delta, ctx.navigable.value.length);
    // Arrow-navigating past a hover-opened submenu trigger must not leave it open behind the
    // newly active row — the same thing hovering a non-submenu row already does (onRowEnter).
    ctx.clearSubmenuTimer();
    ctx.openSubmenuId.value = null;
  };
}

function handleArrowRight(ctx: ContextMenuKeyContext): void {
  if (ctx.activeSubIndex.value >= 0) return; // already as deep as this menu goes
  const current = ctx.activeTopItem.value;
  if (current?.type !== 'submenu') return;
  ctx.clearSubmenuTimer();
  ctx.openSubmenuId.value = current.id;
  ctx.activeSubIndex.value = ctx.navigableSub.value.length > 0 ? 0 : -1;
}

function handleArrowLeft(ctx: ContextMenuKeyContext): void {
  if (ctx.activeSubIndex.value < 0) return; // already at the top level
  ctx.openSubmenuId.value = null;
  ctx.activeSubIndex.value = -1;
}

function handleEnter(ctx: ContextMenuKeyContext): void {
  if (ctx.activeSubIndex.value >= 0) {
    const sub = ctx.activeSubItem.value;
    if (sub?.type === 'item') void ctx.onItemClick(sub);
    return;
  }
  const current = ctx.activeTopItem.value;
  if (!current) return;
  if (current.type === 'submenu') {
    ctx.clearSubmenuTimer();
    ctx.openSubmenuId.value = current.id;
    ctx.activeSubIndex.value = ctx.navigableSub.value.length > 0 ? 0 : -1;
    return;
  }
  void ctx.onItemClick(current);
}

/** Every key `onKeydown` acts on once the menu is open — Escape and an unhandled key stay the
 *  SFC's own job (the open guard and the lookup miss). */
export const CONTEXT_MENU_KEY_HANDLERS: Readonly<Record<string, ContextMenuKeyHandler>> = {
  ArrowDown: handleArrowVertical(1),
  ArrowUp: handleArrowVertical(-1),
  ArrowRight: handleArrowRight,
  ArrowLeft: handleArrowLeft,
  Enter: handleEnter,
};
