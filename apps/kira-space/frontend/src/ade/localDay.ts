// P129 Part 5 §0.5: the one place that reads the local calendar day — everything downstream
// (`useQueue`'s own calendar arithmetic) stays UTC-day math on the resulting ISO string (Part 3
// §0.6's own "local, never UTC" audit grep never sees a `Date` constructor outside here).

/** Local `YYYY-MM-DD` for a `Date` — moved out of `AdeRepoView`'s own `today` computed so
 *  `localIsoOfMs` can share it exactly. */
export function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A history entry's `archivedAt` (epoch ms) as its own local day — `useQueue`'s
 *  `QueueInput.localDayOf`, so an evening archive lands on the local band, not a UTC one. */
export function localIsoOfMs(ms: number): string {
  return localIso(new Date(ms));
}
