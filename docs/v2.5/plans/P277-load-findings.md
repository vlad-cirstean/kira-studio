# P277 load findings (Stream B, UI entries of item 2)

Method: plan 2.1. Load: 8 busy loops on 4 CPUs, Playwright `--repeat-each=40 --workers=8`, project `ui`,
WebKit. Stream A's Go runs shared the machine, so measured load average ran 11-41 (note per row). Counts
are failures/runs. Cause types: a wall-clock, b app race, c precondition, d capacity (test or app is
slower than a fixed default wait under load; nothing to fix without a longer wait).

Gaps vs the plan recipe: ambient load from Stream A made load uncontrolled; `workspace` ran 12 repeats
(252 runs), not 40, because 40 repeats of 30 tests exceeds the machine's useful time.

| Entry | Before | Type, cause | Fix |
|---|---|---|---|
| Space `repo-graph-refresh` "refsChanged…other kinds do not" | 0/40 at load 10; 0/40 at recipe load (base copy, 8 loops, 8 workers) | a by code: `waitForTimeout(600)` plus 1 s poll race the 250 ms coalesce window; same mechanism failed the scroll test below, so converted too | `test(space): drive the refresh coalesce window with the fake clock` |
| Space `repo-graph-refresh` "a refresh keeps the scroll position" | 18/40 (load 16-27); 13/40 (4 loops, 4 workers); 0/48 (8 workers, no loops) | d: `row 0` visible within default 5 s (idle: 1.3 s; under load 5-11 s). a: with the first wait raised in a diagnostic copy, 12/16 failed the 1 s poll for the refresh request. Scroll-lost (|delta| 2000) seen 2/6 once at ambient load ~28, then 0/136: unreproduced | a fixed by the fake clock; d stays open |
| Space `repo-graph-paging` drag, `closeDetail` | 11/160: outer-lane 3/40, columns-wide 1/40, resized-column 7/40, all 60 s test timeout; trace shows plain slowness, no stuck step | d for the timeouts. `closeDetail` retry (`toPass`) never exhausted | `closeDetail` waits for `detail-region`, presses Escape once; `diagonalWheel` waits two frames, not 100 ms |
| Space `repo-graph-columns` | 3/400: `row 0` visible, default 5 s | d | none |
| Space `repo-graph-badges` | 0/120 | unreproduced | none |
| Space `repo-workspace` | 4/252: default 5 s waits (editor text, grid row 9) | d | none |
| Space `ade-v2-panel` handle-drag | 0/40 | unreproduced | none |
| Studio `sql-schema` "Schema (DDL)… dialog stages until Save" | 36/40 (load 19-23), 60 s test timeout; trace: `keyboard.type` of 130 characters took 24 s, twice per test | test cost: per-key input scales with load past the 60 s test timeout | `test(studio): paste the DDL in the schema dialog spec` |
| Studio `tooltips` a11y | 20/40: `toHaveCount(0)` after `waitForTimeout(150)` saw the open tooltip | a: wall waits against the 400 ms provider delay | `test(studio): drive tooltip delays with the fake clock` |
| Studio `http-timeline` failed-send | 0/40 | unreproduced | none |
| Studio `grid-commit-in-flight` | 0/80 | unreproduced | none |
| Studio `ui-leftovers` "Close others over a dirty tab" | 0/40 | unreproduced | none |

Remaining `waitForTimeout` in these specs, none a synchroniser:
`sql-schema.spec.ts` (absence of a suggest widget, no event to wait on), `grid-commit-in-flight.spec.ts`
(mid-flight absence window), `ui-leftovers.spec.ts` (pane is hidden at 100 ms, the assertion under test),
`repo-workspace.spec.ts` (500 ms absence window for a debounced `blame.line`).

Left `toPass` (outside the plan's list, no repro, not touched): `repo-graph-badges`, `repo-graph-columns`,
`repo-graph-widths` helpers.

Outside Stream B's row: `apps/kira-studio/tests/ui/support/tooltip.ts` `assertTooltipShows` retries a
hover in a loop; other specs share it. Step C or close-out owns it.

## Fix status

Filled in per fix commit.
