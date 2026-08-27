export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface AnchoredPositionOptions {
  /** px gap between the anchor and the panel. Default 4. */
  gap?: number;
  /** Which edge of the anchor rect the panel's own left edge aligns to. Default 'left'. */
  align?: 'left' | 'right';
  /** 'menu' (PopoverPanel): clamps both axes into the viewport unconditionally, and picks
   *  whichever side of the anchor has more room. 'callout' (AppTooltip/ErrorPopover, the
   *  default): starts below-left of the anchor and only pulls back on an actual overflow —
   *  reduced left only if it would run past the right edge, flipped above only if it would
   *  run past the bottom edge. */
  strategy?: 'menu' | 'callout';
}

// P49 F16/D12: PopoverPanel.vue, AppTooltip.vue and ErrorPopover.vue each hand-rolled their own
// flip/clamp arithmetic for an anchor-relative floating panel, and had already drifted from one
// another (AppTooltip/ErrorPopover are a near-exact copy of each other; PopoverPanel's own
// "which side has more room" decision is a different, and more thorough, rule). Pure arithmetic
// over plain rects/sizes — no DOM reads inside — the same reason columnRangeExtractor (P47 D16)
// is a plain function rather than a component method.
export function anchoredPosition(
  anchor: AnchorRect,
  panel: PanelSize,
  viewport: PanelSize,
  opts: AnchoredPositionOptions = {},
): { left: number; top: number } {
  const gap = opts.gap ?? 4;
  const align = opts.align ?? 'left';
  const strategy = opts.strategy ?? 'callout';
  const naturalLeft = align === 'left' ? anchor.left : anchor.right - panel.width;

  let left: number;
  if (strategy === 'menu') {
    const maxLeft = Math.max(gap, viewport.width - gap - panel.width);
    left = Math.min(Math.max(naturalLeft, gap), maxLeft);
  } else {
    left = naturalLeft;
    if (left + panel.width > viewport.width)
      left = Math.max(gap, viewport.width - panel.width - gap);
  }

  let top: number;
  if (strategy === 'menu') {
    const spaceBelow = viewport.height - anchor.bottom - gap;
    const spaceAbove = anchor.top - gap;
    const opensUpward = panel.height > spaceBelow && spaceAbove > spaceBelow;
    const naturalTop = opensUpward ? anchor.top - gap - panel.height : anchor.bottom + gap;
    const maxTop = Math.max(gap, viewport.height - gap - panel.height);
    top = Math.min(Math.max(naturalTop, gap), maxTop);
  } else {
    top = anchor.bottom + gap;
    if (top + panel.height > viewport.height) top = Math.max(gap, anchor.top - panel.height - gap);
  }

  return { left, top };
}
