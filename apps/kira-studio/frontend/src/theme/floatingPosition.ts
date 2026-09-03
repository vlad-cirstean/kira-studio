import {
  autoUpdate,
  computePosition,
  flip,
  type Middleware,
  type OffsetOptions,
  offset,
  type Placement,
  type ReferenceElement,
  shift,
} from '@floating-ui/dom';

export interface FloatOptions {
  /** Preferred side/alignment. Default 'bottom-start' (below-left of the anchor) — what every
   *  call site but the context-menu submenu wants. */
  placement?: Placement;
  /** Forwarded to @floating-ui/dom's own `offset()` middleware verbatim. Default `4`: a 4px gap
   *  along the placement's main axis, none on the cross axis. */
  offset?: OffsetOptions;
  /** Whether to flip to the opposite side when the preferred side has no room and the opposite
   *  side has more. Default `true`. The one caller anchored to a mouse point rather than an
   *  element (ContextMenu.vue's own top-level menu) turns this off — a point has no "other side"
   *  to flip to, only edges to stay clear of. */
  flip?: boolean;
  /** `shift()`'s own viewport-clamp padding, in px. Default `4`. */
  padding?: number;
}

// P23: this file replaces the previous anchoredPosition.ts (P49 D12's own consolidation of three
// hand-rolled flip/clamp implementations into one pure-arithmetic function, two named
// "strategies") and ContextMenu.vue's still-separate hand-rolled clamp (menu) plus its entirely
// unhandled submenu placement (`left: 100%; top: -4px`, no flip, no clamp — a live offscreen bug
// near the right/bottom edge). Every one of those turns out to need the same three primitives —
// an offset from the anchor, a same-side/opposite-side flip, and a viewport clamp — just with
// different placements, gaps and flip choices, so one thin wrapper over `@floating-ui/dom`'s
// `computePosition` + `flip`/`shift`/`offset` replaces all of them (docs/v1.1/plans/
// P23-library-adoption.md). `strategy: 'fixed'` matches every consumer's own CSS (`position:
// fixed`) and works cleanly with `Teleport to="body"`, which none of these five renders anywhere
// else.
export async function computeFloatPosition(
  reference: ReferenceElement,
  floatingEl: HTMLElement,
  opts: FloatOptions = {},
): Promise<{ left: number; top: number }> {
  const middleware: Middleware[] = [offset(opts.offset ?? 4)];
  if (opts.flip ?? true) middleware.push(flip());
  middleware.push(shift({ padding: opts.padding ?? 4 }));

  const { x, y } = await computePosition(reference, floatingEl, {
    strategy: 'fixed',
    placement: opts.placement ?? 'bottom-start',
    middleware,
  });
  return { left: x, top: y };
}

/** A zero-size virtual reference at a fixed viewport point. ContextMenu.vue's top-level menu
 *  anchors to the mouse's click point, not to any element — floating-ui's own escape hatch for
 *  exactly this (https://floating-ui.com/docs/virtual-elements). */
export function pointReference(x: number, y: number): ReferenceElement {
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      top: y,
      left: x,
      right: x,
      bottom: y,
      width: 0,
      height: 0,
    }),
  };
}

export type { ReferenceElement };
export { autoUpdate };
