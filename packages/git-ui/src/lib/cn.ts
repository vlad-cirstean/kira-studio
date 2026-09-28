import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * P110 A2: this package's own `cn()` — every `cva` variant in this package (`rowVariants.ts`, a
 * component's own local variants) merges through this, not the plain `twMerge(clsx())` a caller
 * might reach for by habit, so a `props.class` override correctly conflicts with (and replaces)
 * the matching part of the base classes instead of leaving both in the DOM (CLAUDE.md's "through
 * cn()" rule, §1.3).
 *
 * `prefix: 'kv'` matches `theme/tailwind.css` — every class merged through this `cn()` is
 * `kv:`-prefixed.
 *
 * `extend.theme` registers every custom (non-default-scale) key `theme/tailwind.css`'s own
 * `@theme` mapping introduces, so tailwind-merge recognises e.g. `kv:h-control` as a spacing-scale
 * value that conflicts with `kv:h-8`, rather than treating the unrecognised suffix as an arbitrary
 * one-off it can't merge against anything. Radius t-shirt names (`sm`/`lg`), and every
 * `bg-*`/`text-*`/`border-*` COLOUR name need no entry here: tailwind-merge's own default config
 * already accepts a real Tailwind t-shirt size for the former and any suffix for colour
 * (`color: [isAny]`), so the collision the audit found in `packages/theme`'s `cn()` (a custom size
 * *name* like `kira-sm` read as a colour) can't recur for `text-xs/sm/base/lg`, which reuse the
 * real t-shirt names. `codicon` (`--text-codicon`) is a font-size but not a t-shirt name, so it
 * needs its own `text` entry below — without it, tailwind-merge would file it under the (default,
 * catch-all) colour group instead and could wrongly cancel a real text colour utility placed next
 * to it.
 *
 * P131 Part 3 §6.4: every `kui-*` registration (kira-ui's own theme partial, gone along with the
 * `Kui*` components that were its only consumer) is dropped — nothing left in this package's own
 * `theme/tailwind.css` uses that vocabulary.
 */
const twMergeKv = extendTailwindMerge<'spacing' | 'shadow' | 'text'>({
  prefix: 'kv',
  extend: {
    theme: {
      spacing: [
        'control',
        'control-lg',
        'control-sm',
        'control-inline',
        'bar',
        'icon-box',
        'row',
        'row-compact',
        'row-comfortable',
        'tree-indent',
      ],
      // P131 Part 3 §6.3/§6.4: `widget` (`--shadow-widget`) was never registered here --
      // check-class-conflicts.ts's registration self-check, retargeted at this file's own
      // theme/tailwind.css, caught the gap.
      shadow: ['float', 'widget'],
      // P110 I2-28: `codicon` is a font-size name, not a t-shirt step.
      text: ['codicon'],
    },
  },
});

/** Same shape as `packages/theme`'s own `cn()` — `clsx` first (conditional/array/object class
 *  inputs), then the prefix-aware merge above. */
export function cn(...inputs: ClassValue[]): string {
  return twMergeKv(clsx(inputs));
}
