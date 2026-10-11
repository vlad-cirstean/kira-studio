import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as ResizableHandle } from '@theme/components/ui/resizable/ResizableHandle.vue';
export { default as ResizablePanel } from '@theme/components/ui/resizable/ResizablePanel.vue';
export { default as ResizablePanelGroup } from '@theme/components/ui/resizable/ResizablePanelGroup.vue';

// P263 §2.9: the one pane-resize-handle look, bound by every handle component. A 2px bar, hit area
// +-4px (+-8px coarse), `bg-focus` on hover, keyboard focus and drag (`data-[state=drag]`; the bar is
// the focus ring). `axis` x is a vertical bar (ew-resize, the cursor reka sets globally), y a horizontal one (ns-resize); `auto`
// reads reka's own `data-orientation`. `line` draws the 1px divider between flat panes. `hit`
// before: the hit area is a `::before` (hand-rolled handles); none: reka's `hitAreaMargins` owns it.
export const resizeHandleVariants = cva(
  'relative shrink-0 bg-transparent hover:bg-focus focus-visible:bg-focus focus-visible:outline-none data-[state=drag]:bg-focus',
  {
    variants: {
      axis: {
        x: 'w-0.5 cursor-ew-resize',
        y: 'h-0.5 cursor-ns-resize',
        auto: 'data-[orientation=horizontal]:w-0.5 data-[orientation=horizontal]:cursor-ew-resize data-[orientation=vertical]:h-0.5 data-[orientation=vertical]:cursor-ns-resize',
      },
      line: { true: '', false: '' },
      hit: { before: 'before:absolute', none: '' },
    },
    compoundVariants: [
      {
        hit: 'before',
        axis: 'x',
        class: 'before:inset-y-0 before:-inset-x-1 pointer-coarse:before:-inset-x-2',
      },
      {
        hit: 'before',
        axis: 'y',
        class: 'before:inset-x-0 before:-inset-y-1 pointer-coarse:before:-inset-y-2',
      },
      {
        axis: 'x',
        line: true,
        class:
          'shadow-[inset_calc(var(--kira-border-width)*-1)_0_0_0_var(--kira-border)] hover:shadow-none focus-visible:shadow-none data-[state=drag]:shadow-none',
      },
      {
        axis: 'y',
        line: true,
        class:
          'shadow-[inset_0_calc(var(--kira-border-width)*-1)_0_0_var(--kira-border)] hover:shadow-none focus-visible:shadow-none data-[state=drag]:shadow-none',
      },
      {
        axis: 'auto',
        line: true,
        class:
          'data-[orientation=horizontal]:shadow-[inset_calc(var(--kira-border-width)*-1)_0_0_0_var(--kira-border)] data-[orientation=vertical]:shadow-[inset_0_calc(var(--kira-border-width)*-1)_0_0_var(--kira-border)] hover:shadow-none focus-visible:shadow-none data-[state=drag]:shadow-none',
      },
    ],
    defaultVariants: { axis: 'x', line: false, hit: 'before' },
  },
);

export type ResizeHandleVariants = VariantProps<typeof resizeHandleVariants>;

/** Pixels one arrow key moves a px-sized handle; Home/End jump to min/max. */
export const RESIZE_KEY_STEP = 10;
