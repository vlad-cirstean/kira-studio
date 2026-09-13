/**
 * P5's own terse relative-age formatter for the status-bar blame widget (`blameWidget.ts`'s own
 * `<author>, <age>` render). Deliberately a small local copy, not an import of `@kira/git-ui`'s own
 * `formatRelativeDate` (`packages/git-ui/src/components/dateFormat.ts`) — that package's
 * `package.json` exposes only `"exports": {".": "./src/index.ts"}` (no subpath), and its barrel
 * pulls in Vue/webview-only code no extension-**host** file has ever imported (`@kira/git-ui` is
 * imported from exactly one file in this package today, `src/webview/main.ts`, a separate esbuild
 * target from this file's own host bundle). Imports nothing from `vscode`, the same
 * `memoizedSetter.ts` split that lets this run under plain `bun test`.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** A terse relative age (`"now"`, `"2h"`, `"5d"`, `"3mo"`, `"1y"`), matching `@kira/git-ui`'s own
 *  `formatRelativeDate` shape. A timestamp in the future (clock skew) clamps to `"now"` rather than
 *  printing a negative duration. `nowMs` defaults to `Date.now()` but is a parameter precisely so a
 *  fixed-clock test can assert an exact string instead of a moving target. */
export function blameAge(timestampSeconds: number, nowMs: number = Date.now()): string {
  const deltaSeconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds);
  if (deltaSeconds < MINUTE) return 'now';
  if (deltaSeconds < HOUR) return `${Math.floor(deltaSeconds / MINUTE)}m`;
  if (deltaSeconds < DAY) return `${Math.floor(deltaSeconds / HOUR)}h`;
  if (deltaSeconds < MONTH) return `${Math.floor(deltaSeconds / DAY)}d`;
  if (deltaSeconds < YEAR) return `${Math.floor(deltaSeconds / MONTH)}mo`;
  return `${Math.floor(deltaSeconds / YEAR)}y`;
}
