import { cva, type VariantProps } from 'class-variance-authority';

/**
 * P110 A5: controls.css's `.kui-row`(+`:hover`/`:focus-visible`/`--selected`/`--disabled`/
 * `--danger`) as a cva — G34 D7's own "row inside a floating panel" shape (`.p-row`), exported so
 * any host or `packages/git-ui` file composing a clickable row (`BranchPicker`/`TagList`/
 * `StashRows`/`FileTree`/`SearchResults`/`review/BaseSelector`/`review/ReviewView`'s own rows,
 * `KuiMenuList`'s own item rows below) can call it directly instead of the retired literal
 * `class="kui-row"`.
 *
 * `.kui-row--danger .kui-icon-box`'s own nested colour rule is dropped as redundant here: `color`
 * is an inherited property, and the `danger` variant already sets it on the row itself — any
 * child with no colour of its own already inherits it, no separate selector needed. (`KuiMenuList`
 * is the one real exception — its icon box gets its own unconditional muted colour regardless of
 * danger/disabled, which is menu-item-specific and stays on that component's own template, not
 * here.)
 */
export const kuiRowVariants = cva(
  'kv:flex kv:items-center kv:gap-1 kv:min-h-kui-control kv:px-1.5 kv:rounded-kui kv:text-kui-fg kv:text-kui-base kv:cursor-pointer kv:whitespace-nowrap kv:hover:bg-kui-hover kv:focus-visible:bg-kui-hover kv:focus-visible:outline-none',
  {
    variants: {
      selected: {
        true: 'kv:bg-kui-selected kv:text-kui-selected-fg',
        false: '',
      },
      disabled: {
        true: 'kv:text-kui-fg-muted kv:cursor-default kv:hover:bg-transparent',
        false: '',
      },
      danger: {
        true: 'kv:text-kui-danger-fg',
        false: '',
      },
    },
    defaultVariants: { selected: false, disabled: false, danger: false },
  },
);
export type KuiRowVariants = VariantProps<typeof kuiRowVariants>;
