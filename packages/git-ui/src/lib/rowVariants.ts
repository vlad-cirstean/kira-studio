import { cva } from 'class-variance-authority';

/**
 * P131 Part 2 §3.3: git-ui's own row-variant primitive, on the app's own unprefixed utilities (P229). Originally a copy of kira-ui's own
 * `kuiRowVariants`, now the sole survivor: kira-ui's copy and its kui-prefixed token bridge are
 * gone (P131 Part 3 §6.1). A list row (`TagList`/`StashRows`/`BranchPicker`/`FileTree`/
 * `SearchResults`) composes this directly on a plain `<button>` — a row is not a `Button`
 * primitive (§0).
 */
export const rowVariants = cva(
  'flex items-center text-fg whitespace-nowrap focus-visible:outline-none',
  {
    variants: {
      // P229: `menu` = `DropdownMenuItem`'s recipe (popover pickers); `tree` = the app's tree row
      // (panes). `kv:text-base` on `tree` keeps Settings > Git graph font size reaching data rows.
      layout: {
        menu: 'gap-1.5 rounded-kira-sm px-1.5 py-1 text-kira-md cursor-pointer focus-visible:bg-hover',
        tree: 'relative gap-1 pr-2 min-h-row kv:text-base select-none cursor-default',
      },
      selected: {
        true: '',
        false: '',
      },
      disabled: {
        true: 'text-muted-foreground cursor-default',
        false: '',
      },
      danger: {
        true: 'text-error',
        false: '',
      },
    },
    compoundVariants: [
      { layout: 'menu', selected: false, class: 'hover:bg-hover' },
      { layout: 'menu', selected: true, class: 'bg-hover' },
      { layout: 'tree', selected: false, class: 'hover:bg-hover' },
      { layout: 'tree', selected: true, class: 'bg-select' },
      { disabled: true, class: 'hover:bg-transparent' },
    ],
    defaultVariants: { layout: 'menu', selected: false, disabled: false, danger: false },
  },
);
// No exported `RowVariants` type: nothing in this package imports the variant-props type yet.
// Export it if/when a caller needs it.
