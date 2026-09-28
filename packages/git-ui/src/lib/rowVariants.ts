import { cva } from 'class-variance-authority';

/**
 * P131 Part 2 §3.3: git-ui's own row-variant primitive, retokened onto this package's own
 * `@theme` names (`packages/git-ui/src/theme/tailwind.css`) — originally a copy of kira-ui's own
 * `kuiRowVariants`, now the sole survivor: kira-ui's copy and its kui-prefixed token bridge are
 * gone (P131 Part 3 §6.1). A list row (`TagList`/`StashRows`/`BranchPicker`/`FileTree`/
 * `SearchResults`) composes this directly on a plain `<button>` — a row is not a `Button`
 * primitive (§0).
 */
export const rowVariants = cva(
  'kv:flex kv:items-center kv:gap-1 kv:min-h-control kv:px-1.5 kv:rounded-sm kv:text-fg kv:text-base kv:cursor-pointer kv:whitespace-nowrap kv:hover:bg-hover kv:focus-visible:bg-hover kv:focus-visible:outline-none',
  {
    variants: {
      selected: {
        true: 'kv:bg-selected kv:text-selected-fg',
        false: '',
      },
      disabled: {
        true: 'kv:text-muted-foreground kv:cursor-default kv:hover:bg-transparent',
        false: '',
      },
      danger: {
        true: 'kv:text-diff-deleted',
        false: '',
      },
    },
    defaultVariants: { selected: false, disabled: false, danger: false },
  },
);
// No exported `RowVariants` type: nothing in this package imports the variant-props type yet.
// Export it if/when a caller needs it.
