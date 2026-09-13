// P21 round 2 architecture/security finding 5: every transient "revealed secret plaintext" map in
// this chapter must re-mask itself once the reveal grace it came from has actually expired, not
// only when the dialog/popover that populated it happens to close. variables.ts's own
// revealedValues was the first of three such maps and originally carried its own hand-rolled
// timer bookkeeping (scheduleRevealExpiry/revealExpiryTimers) inline; that logic is lifted out
// here so revealedHistoryValues (variables.ts) and copyAsCurlDialogState.revealedSecretValues
// (curl.ts) — both of which used to be cleared only by their own dialog's close path, with no
// expiry at all — inherit the same grace instead of re-deriving it by hand.

/** Mirrors internal/localauth.GraceWindow: the reveal gate's own grace is fixed rather than
 *  sliding "so a long editing session can't hold one authentication open indefinitely". Keep in
 *  sync with GraceWindow by hand; there is no shared constant to import across the Go/TS boundary
 *  for a time.Duration. */
export const REVEAL_GRACE_WINDOW_MS = 5 * 60 * 1000;

/** A keyed expiry scheduler over one reactive `Record<string, string>` map: `schedule(key)` arms
 *  (or re-arms) a timer that deletes `map[key]` after the grace window; `clear(key)` cancels one
 *  entry's timer without touching the map itself (used when the caller is about to delete the key
 *  itself, e.g. a whole-map reset, so the delayed callback can't fire against a map a later reveal
 *  has since repopulated); `clearAll()` cancels every outstanding timer for this map. One instance
 *  per map — the timers are keyed by the same string keys the map itself uses, and are entirely
 *  private to the instance, so two different reveal maps never share or clobber each other's
 *  timers even if they happen to use overlapping key spaces (variable id vs. history id vs.
 *  secret name). */
export function createRevealExpiry(map: Record<string, string>) {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};

  function clear(key: string): void {
    clearTimeout(timers[key]);
    delete timers[key];
  }

  function schedule(key: string): void {
    clear(key);
    timers[key] = setTimeout(() => {
      delete timers[key];
      delete map[key];
    }, REVEAL_GRACE_WINDOW_MS);
  }

  function clearAll(): void {
    for (const key of Object.keys(timers)) clear(key);
  }

  return { schedule, clear, clearAll };
}
