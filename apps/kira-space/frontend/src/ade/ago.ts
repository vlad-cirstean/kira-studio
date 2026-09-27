import type { UseTimeAgoOptions } from '@vueuse/core';

// P129 Part 5 §0.20: the `useTimeAgo` options object, shared by every "time ago" label in `ade` —
// moved out of `AdeProjectHeader.vue`, which owned the first (Refresh timestamp) of the module's
// three call sites (an agent's `lastActiveAt`, a session tooltip, joining it here). Also holds
// `historySpanText` (§0.8), a small, unrelated but equally shared history-bar label helper.

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" — the mockup's own `ago()` thresholds (line 1343:
 *  <60min, <1440min, else), plus "just now" for the first minute. */
export const adeAgoOptions: UseTimeAgoOptions<false, 'minute' | 'hour' | 'day'> = {
  messages: {
    justNow: 'just now',
    past: (n: string) => `${n} ago`,
    future: (n: string) => `${n} ago`,
    invalid: '',
    minute: (n: number) => `${n}m`,
    hour: (n: number) => `${n}h`,
    day: (n: number) => `${n}d`,
  },
  units: [
    { max: 3_600_000, value: 60_000, name: 'minute' },
    { max: 86_400_000, value: 3_600_000, name: 'hour' },
    { max: Number.POSITIVE_INFINITY, value: 86_400_000, name: 'day' },
  ],
};

/** History bar span text (§0.8): `week` for 7, `N weeks` when evenly divisible, else `N days` —
 *  the mockup hardcodes `the last 2 weeks`; `historyDays` (1-365) is a real setting. */
export function historySpanText(days: number): string {
  if (days === 7) return 'week';
  if (days % 7 === 0) return `${days / 7} weeks`;
  return `${days} days`;
}
