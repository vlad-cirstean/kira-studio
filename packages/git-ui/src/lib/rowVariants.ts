import { cva } from 'class-variance-authority';

/**
 * P131 Part 2 §3.3: git-ui's own copy of kira-ui's `kuiRowVariants` (`packages/kira-ui/src/
 * rowVariants.ts`), retokened onto this package's own `@theme` names (`packages/git-ui/src/theme/
 * tailwind.css`) instead of kira-ui's `--kui-*` bridge — every renamed pair resolves to the same
 * `--kv-*` value (`theme/kui-bridge.css`/`theme/tailwind.css`), so the output is pixel-identical.
 * A list row (`TagList`/`StashRows`/`BranchPicker`/`FileTree`/`SearchResults`) composes this
 * directly on a plain `<button>` — a row is not a `Button` primitive (§0).
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
// No exported `RowVariants` type: unlike kira-ui's own `KuiRowVariants` (re-exported from a
// package entry point, `@kira/kira-ui`'s index.ts, so knip treats it as a real external surface),
// nothing in this package imports the variant-props type yet. Export it if/when a caller needs it.
