import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * P110 A2: this package's own `cn()` — every `Kui*` component's `cva` variants merge through
 * this, not the plain `twMerge(clsx())` a caller might reach for by habit, so a `props.class`
 * override correctly conflicts with (and replaces) the matching part of the component's own base
 * classes instead of leaving both in the DOM (CLAUDE.md's "through cn()" rule, §1.3).
 *
 * `prefix: 'kv'` matches `theme/tailwind.css` (A1, git-ui) and `theme/tailwind-theme.css` (A2,
 * this file) — every class merged through this `cn()` is `kv:`-prefixed.
 *
 * `extend.theme` registers every custom (non-default-scale) key either theme file's `@theme`
 * mappings introduce, so tailwind-merge recognises e.g. `kv:h-control`/`kv:h-kui-control` as
 * spacing-scale values that conflict with `kv:h-8`, rather than treating the unrecognised suffix
 * as an arbitrary one-off it can't merge against anything. Radius t-shirt names (`sm`/`lg`), and
 * every `bg-*`/`text-*`/`border-*` COLOUR name need no entry here: tailwind-merge's own default
 * config already accepts a real Tailwind t-shirt size for the former and any suffix for colour
 * (`color: [isAny]`), so the collision the audit found in `packages/theme`'s `cn()` (a custom size
 * *name* like `kira-sm` read as a colour) can't recur for `text-xs/sm/base/lg`, which reuse the
 * real t-shirt names. `kui-icon` (A3, `--text-kui-icon`) is a font-size but not a t-shirt name, so
 * it needs its own `text` entry below — without it, tailwind-merge would file it under the
 * (default, catch-all) colour group instead and could wrongly cancel a real text colour utility
 * placed next to it.
 */
const twMergeKv = extendTailwindMerge<'spacing' | 'radius' | 'shadow' | 'text' | 'leading'>({
  prefix: 'kv',
  extend: {
    theme: {
      spacing: [
        // git-ui's own theme/tailwind.css (A1, §6.1) — a class prop passed down from git-ui into
        // a Kui* component (e.g. BranchPicker's height override) can carry either vocabulary.
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
        // This package's own theme/tailwind-theme.css (A2). P110 I2-29: `kui-1..6` dropped --
        // retired in favour of the default spacing scale (same values, real Tailwind steps).
        'kui-control',
        'kui-control-sm',
        'kui-icon-box',
      ],
      radius: ['kui', 'kui-float'],
      shadow: ['float', 'kui-float'],
      // P110 I2-2: M1 -- `kv:text-kui-sm`/`-base` (kuiRowVariants, KuiTextInput) read as
      // colour utilities without these, and drop a static `kv:text-kui-fg`/`-selected-fg` colour
      // on the same element as a false same-group conflict. P110 I2-28: `codicon`
      // (GU/theme/tailwind.css's `--text-codicon`) is the same shape -- a font-size name, not a
      // t-shirt step.
      text: ['kui-icon', 'kui-sm', 'kui-base', 'codicon'],
      // P110 I2-28: `kv:leading-kui-control-sm` (KuiSegmented.vue), the same design-seam pattern
      // as the spacing names above.
      leading: ['kui-control-sm'],
    },
  },
});

/** Same shape as `packages/theme`'s own `cn()` — `clsx` first (conditional/array/object class
 *  inputs), then the prefix-aware merge above. */
export function cn(...inputs: ClassValue[]): string {
  return twMergeKv(clsx(inputs));
}
