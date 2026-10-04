import type { UseTimeAgoOptions } from '@vueuse/core';

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago": mockup `ago()` thresholds (<60min, <1440min, else). */
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
