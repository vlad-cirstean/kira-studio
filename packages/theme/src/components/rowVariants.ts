import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

// P262 §2.7: the one row recipe for side panels, pickers and in-dialog navs. `menu` is git-ui's
// popover-picker row; `tree` single-line, `double` two-line; `nav` is the SettingsShell nav item.
export const rowVariants = cva('', {
  variants: {
    layout: {
      menu: 'flex items-center text-fg whitespace-nowrap focus-visible:outline-none h-control gap-1 rounded-kira-sm px-1.5 text-kira-md cursor-pointer focus-visible:bg-hover',
      tree: 'relative flex items-center gap-1 min-h-row pr-1.5 text-kira-md whitespace-nowrap select-none cursor-default outline-none focus-visible:focus-ring',
      double:
        'relative flex items-start gap-1 min-h-row py-1 pr-1.5 text-kira-md whitespace-nowrap select-none cursor-default outline-none focus-visible:focus-ring',
      nav: 'h-control-lg px-2 rounded-kira-sm text-kira-md',
    },
    selected: { true: '', false: '' },
    muted: { true: 'text-muted-foreground', false: '' },
    disabled: { true: 'text-muted-foreground cursor-default', false: '' },
    danger: { true: 'text-error', false: '' },
    data: { true: 'text-graph-md', false: '' },
  },
  compoundVariants: [
    { layout: 'menu', selected: false, class: 'hover:bg-hover' },
    { layout: 'menu', selected: true, class: 'bg-hover' },
    { layout: ['tree', 'double'], selected: false, class: 'hover:bg-hover' },
    { layout: ['tree', 'double'], selected: true, class: 'bg-select text-fg' },
    { layout: ['tree', 'double'], selected: false, muted: false, class: 'text-fg' },
    { layout: 'nav', selected: true, class: 'bg-select text-fg' },
    {
      layout: 'nav',
      selected: false,
      class: 'bg-transparent text-muted-foreground hover:bg-hover',
    },
    { disabled: true, class: 'hover:bg-transparent' },
  ],
  defaultVariants: {
    layout: 'menu',
    selected: false,
    muted: false,
    disabled: false,
    danger: false,
    data: false,
  },
});

export type RowVariants = VariantProps<typeof rowVariants>;

/** Row indent: depth 0 lines up with `PanelHeader`/`SectionHeading` `px-1.5` (6px). */
export function rowIndent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${6 + depth * 14}px` };
}
