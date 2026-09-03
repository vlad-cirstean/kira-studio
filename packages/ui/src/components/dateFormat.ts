/**
 * The date column's two renderings (`docs/plans/P4.md` W6, §6.2: "clicking toggles relative/
 * absolute for every row and persists"). Pure functions, no `Date.now()` baked in — `nowMs` is a
 * parameter precisely so a fixed-clock test (the plan's own W13 note: "a deterministic clock for
 * the date column ... fixed relative to the mock's commit timestamps") can assert an exact
 * string instead of a moving target, and so `columns.ts`'s formatter can pass the same `now`
 * across an entire render pass rather than each row computing its own.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A terse relative age (`"now"`, `"2h"`, `"5d"`, `"3mo"`, `"1y"`) sized for the date column's
 * 52 px default width and matching §6.2's mockup (`alice 2h`, `bob 3h`). A timestamp in the
 * future (clock skew between the machine that made the commit and this one) clamps to `"now"`
 * rather than printing a negative duration.
 */
export function formatRelativeDate(timestampSeconds: number, nowMs: number = Date.now()): string {
  const deltaSeconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds);
  if (deltaSeconds < MINUTE) return "now";
  if (deltaSeconds < HOUR) return `${Math.floor(deltaSeconds / MINUTE)}m`;
  if (deltaSeconds < DAY) return `${Math.floor(deltaSeconds / HOUR)}h`;
  if (deltaSeconds < MONTH) return `${Math.floor(deltaSeconds / DAY)}d`;
  if (deltaSeconds < YEAR) return `${Math.floor(deltaSeconds / MONTH)}mo`;
  return `${Math.floor(deltaSeconds / YEAR)}y`;
}

/** UTC formatter fixed to `en-CA` (which happens to render `YYYY-MM-DD`) rather than the host
 *  locale or timezone — a "date column" whose absolute form changes with the viewer's timezone
 *  would render two different strings for the same commit across the same team, and UTC keeps
 *  W13's baselines and this file's own unit tests independent of the machine running them. */
const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `"2024-03-14 09:41"` (UTC) — see `ABSOLUTE_FORMATTER`'s own doc comment for why UTC. */
export function formatAbsoluteDate(timestampSeconds: number): string {
  const parts = ABSOLUTE_FORMATTER.formatToParts(new Date(timestampSeconds * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
