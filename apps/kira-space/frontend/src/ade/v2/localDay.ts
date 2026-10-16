/** Local `YYYY-MM-DD` for a `Date`; the one place the plan reads the local calendar day. */
export function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** A history entry's `archivedAt` (epoch ms) as its own local day. */
export function localIsoOfMs(ms: number): string {
  return localIso(new Date(ms));
}
