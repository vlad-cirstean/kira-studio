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
  size,
} from '@floating-ui/dom';

/**
 * G20 D1: `packages/kira-ui`'s own floating-positioning primitive — a fresh reimplementation of
 * `apps/kira-studio/frontend/src/theme/floatingPosition.ts`'s `computeFloatPosition`/
 * `pointReference`, not a cross-app import (the two frontends are separate apps with separate
 * builds). P131 Part 3 §6.2: every `Kui*` consumer (`KuiTooltip`, `KuiPopoverPanel`,
 * `KuiContextMenu`) is gone — the sole consumer left is `packages/workbench`'s own
 * `util/floatingPosition.ts`, which always passes its own `--kira-float-max-` prefix, so
 * `maxVarPrefix` is required rather than defaulting to a kui-prefixed name nothing reads any more.
 */

export interface FloatOptions {
  /** Preferred side/alignment. Default 'bottom-start' (below-left of the anchor). */
  placement?: Placement;
  /** Forwarded to @floating-ui/dom's own `offset()` middleware verbatim. Default `4`. */
  offset?: OffsetOptions;
  /** Whether to flip to the opposite side when the preferred side has no room and the opposite
   *  side has more. Default `true`. */
  flip?: boolean;
  /** `shift()`'s own viewport-clamp padding, in px. Default `4`. */
  padding?: number;
  /** CSS custom-property prefix `size()`'s own middleware writes onto the floating element
   *  (`-w`/`-h` appended) — a consumer opts in by reading the two properties it produces
   *  (`max-height: var(<prefix>h)`); a surface that already fits is unaffected, since these are
   *  only ever a maximum. */
  maxVarPrefix: string;
}

function setIfChanged(el: HTMLElement, prop: string, px: number): void {
  const next = `${Math.max(0, Math.round(px))}px`;
  if (el.style.getPropertyValue(prop) !== next) el.style.setProperty(prop, next);
}

export async function computeFloatPosition(
  reference: ReferenceElement,
  floatingEl: HTMLElement,
  opts: FloatOptions,
): Promise<{ left: number; top: number }> {
  const padding = opts.padding ?? 4;
  const prefix = opts.maxVarPrefix;
  const middleware: Middleware[] = [offset(opts.offset ?? 4)];
  if (opts.flip ?? true) middleware.push(flip());
  middleware.push(shift({ padding }));
  // Last in the chain, after flip/shift have settled which side the surface is on, and sharing
  // their padding so the cap and the clamp agree about where the viewport ends. Write-only-on-
  // change, and rounded to whole px, so a consumer driving reposition through `autoUpdate` (whose
  // ResizeObserver watches the *floating* element) never loops: an unconditional write here would
  // resize the element, firing the observer, which repositions, which writes again.
  middleware.push(
    size({
      padding,
      apply({ availableWidth, availableHeight, elements }) {
        setIfChanged(elements.floating, `${prefix}w`, availableWidth);
        setIfChanged(elements.floating, `${prefix}h`, availableHeight);
      },
    }),
  );

  const { x, y } = await computePosition(reference, floatingEl, {
    strategy: 'fixed',
    placement: opts.placement ?? 'bottom-start',
    middleware,
  });
  return { left: x, top: y };
}

/** A zero-size virtual reference at a fixed viewport point — floating-ui's own escape hatch for
 *  anchoring to a click/mouse point rather than an element
 *  (https://floating-ui.com/docs/virtual-elements). */
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
