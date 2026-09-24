import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// P110 B1: tailwind-merge's default config has no notion of base.css's kira-* scale steps, so it
// misreads e.g. `text-kira-sm` as a text *colour* utility and never dedupes it against a real
// colour class, or against `text-kira-md` from the same scale. Registering the real groups here
// (names taken from base.css's `@theme`) fixes both: kira-scale classes merge against their own
// scale, and stop masquerading as an unrelated group.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['kira-xs', 'kira-sm', 'kira-md', 'kira-lg', 'kira-xl'],
      spacing: [
        'control',
        'control-lg',
        'control-sm',
        'row',
        'bar',
        // P110 B6
        'titlebar',
        'tabbar',
        'statusbar',
        'titlebar-inset',
      ],
      radius: ['kira-sm', 'kira', 'kira-lg', 'kira-pill'],
      shadow: ['kira', 'kira-dialog'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
