# P161: Documents view dropped frames on the fastest flick

Source: SPEC row P161 (`docs/v2.0/SPEC.md:93`). User measurement (WebKit, 5 000 documents, ~160 px
rows, 800 000 px list): fastest wheel flick frame p95 103 ms, max 136 ms, 45 of 82 frames over
50 ms; standard momentum ladder ~55 fps. Rule from the row: profile first, no fix without a profile
naming the cause. Base: `v2.0` at `32d54572`. App: `apps/kira-studio`. Paths relative to it unless
rooted.

Also in scope (CLAUDE.md pre-existing-failure rule): `tests/ui/budgets.spec.ts` `interaction
budgets` grid scroll assertion fails on the pre-phase tree (P160 result: p50 13 vs 12 ms, max 51 vs
50 ms; pre-phase 54 vs 50). Step 1 below.

Single sequential implementer. Step 1 (grid budget) and steps 2-6 (documents) touch disjoint files,
but step 1 is small and both need the same quiet-machine window; a split buys nothing.

## 0. Probe status

The row names `tests/perf/documents-scroll.spec.ts`. It does not exist: not in the tree, not in any
commit (`git log --all -- '**/documents-scroll*'` empty). It lives on the user's other VM, like
P160's probe did. P160 committed the shared pieces: Playwright project `perf`
(`playwright.config.ts:126-135`, `testDir: './tests/perf'`, WebKit, serial, 1 worker) and
`tests/perf/perfProbe.ts` (`load1`, `RssSampler`, `median`, HTTP-shaped `runLine`/`summaryLine`).
This phase writes `documents-scroll.spec.ts` (step 2) and measures "before" with it. Numbers will
not equal the user's (other machine, other flick parameters); before/after from the same probe on
the same machine is the evidence.

## 1. Current tree (CodeGraph + reads)

Documents list (`frontend/src/views/documents/DocumentView.vue`):
- `:487-493` `useVirtualRows({ count, rowHeight: 26, rowHeights, scrollElement })`
  (`packages/workbench/src/util/virtualRows.ts`, `@tanstack/vue-virtual`, overscan 8). No
  `getItemKey`: keys are virtual indices. Heights are known, never measured (`estimateSize` reads
  `rowHeights[index]`); no `measureElement`.
- `:468-483` `rowHeights` computed: one entry per page row (5 000), recomputed on `pageVersion` or
  `rowsVersion` only. Each entry decodes the row id (`documentRow`) and calls `rowHeight`
  (`views/shared/document/rows.ts:294-312`), which caches line counts in `lineCounts` (never pruned).
- `:509-518` `watch(virtualItems)`: every virtual-items change (every scroll frame) calls
  `setVisibleRows`, `setVisibleWindow` (prunes the page decode cache, `page.ts`) and
  `documentRowsStore.pruneRows` (`rows.ts:225-234`: deletes every `parseCache` entry outside the
  rendered window). A row leaving the window and coming back is decoded and parsed again
  (`parseRow` -> `parseDocument`).
- Template `:1001-1090`: per virtual item, `rowAt(rows[vi.index])` is called ~12 times
  (`v-if`, `view`, `expanded`, toggle, edit, delete, preview, body `v-if`, tree `v-else-if`).
  `rowAt` (`:378-383`) allocates a fresh entry; `rowView` (`rows.ts:140-154`) allocates a fresh
  `DocumentRowView` per call. So `DocumentRow`'s `view` prop changes identity on every parent
  render: every rendered row re-renders on every scroll frame, changed or not.
- Per row: `DocumentRow.vue` (head, 2-3 `Badge`, optional `Tooltip`), 2 `TooltipIconButton`
  (reka-ui tooltip each) in `#actions`, and `DocumentTree.vue` (expanded by default, P27 D2): one
  flex line per visible node (`visibleLines` walk, `:key="line.node.path"`), wrapped in an
  `overflow-x-auto` scroller (one scroll container per row).
- Fixture shape: `tests/ui/support/mongoFixture.ts` `WIDGETS_BODIES` (7 top-level fields). Expanded
  height 26 + 7 x 18 + 8 = 160 px: matches the row's "~160 px rows".

Candidate causes (hypotheses for the profile to confirm or refute; none is assumed):
- H1 row churn: at fastest flick the window jumps past every rendered row each frame. Index keys
  change wholesale, so Vue unmounts and mounts every row: `DocumentRow`, 2 reka tooltips,
  `DocumentTree` lines, each frame.
- H2 parse churn: `pruneRows` strict window means every incoming row re-decodes and re-parses.
- H3 re-render fan-out: fresh `view` identity re-renders every rendered row per frame, plus ~12
  `rowAt` calls per row per render.
- H4 layout/style: ~22 absolutely positioned rows, each with its own horizontal scroll container;
  WebKit style recalc, layout and layer work per mount.
- H5 virtualizer bookkeeping: `getVirtualItems` over 5 000 known sizes, `watch(virtualItems)` side
  effects. Expected small; measured anyway.

Grid budget (`tests/ui/budgets.spec.ts:406-440`): `measureScrollResponses` (`tests/ui/support/
measure.ts:117`) sets `scrollTop` 20 times on `big_rows` at page size 10 000; "work" runs from the
`__kiraGridScrollWorkStart` mark (top of `KiraSlickGrid.render()`) to the next DOM mutation.
Budget p50 <= 12 ms, max <= 50 ms (P139: measured p50 6-8 ms quiet and under load). No grid render
code changed since `058623df` (P139 Part 2 restored these bounds): `git log 058623df..HEAD --
apps/kira-studio/frontend/src/views/shared/slick/ apps/kira-studio/frontend/src/views/grid/` is
empty. Shared deps (Vue, workbench, `main.ts`, `package.json`/lockfile) may still have moved.

## 2. Decisions

| Item | Decision |
|---|---|
| Profile before fix | Step 3 produces a per-frame breakdown that names the cause with numbers. Step 4 fixes only what step 3 named. A hypothesis the profile does not support gets no change. |
| Profile tools | WebKit is the target, but Playwright WebKit has no CPU profiler. Two sources: (a) WebKit split of each flick frame into Vue patch time vs the rest (style, layout, paint), via temporary, uncommitted `performance.now` accumulators (step 3); (b) Chromium CPU profile of the same case (CDP `Profiler` through `page.context().newCDPSession`) to name JS functions. Chromium is a pointer to JS hot spots, never the before/after evidence. |
| Diagnostic A/B | Allowed in step 3, uncommitted: e.g. stub `pruneRows`, cache `rowView`, drop `#actions`. Each toggle's frame-p95 delta goes in `## Result`. They attribute cost; they are not the fix. |
| Fix shape (by cause) | H1: stop mount/unmount churn first, cheapest first: lighter per-row tree (no per-row reka tooltip instance: one shared tooltip or `title`-free icon buttons with a single delegated tooltip), then slot-recycled keys (key = position in the rendered window, so Vue patches instead of remounts) if still over target. H2: keep a bounded parse cache with headroom around the window (LRU, e.g. window + 2x overscan, sized in the plan's Result), not the strict window; memory delta stays well under P5's 15.56 MB all-rows figure. H3: one `computed` list of rendered entries (`{ key, start, size, row, view, body, expanded, ... }`) built once per frame; `rowView` memoized per parsed row so identity is stable. H4/H5: only with numbers. |
| Placeholder rows while scrolling | Not planned. TanStack's `isScrolling` would let rows render head-only during a flick, but it changes what the user sees. Only if every structural fix leaves frame p95 over target, and then it needs the user's call: record it in `## Result` and ask, do not build. |
| Library rule | Stay on `@tanstack/vue-virtual` and VueUse. No new dependency. A hand-rolled LRU is ~15 lines over `Map` insertion order, below the "non-trivial infrastructure" bar. |
| Target | Fastest flick: frame p95 <= 50 ms and frames over 50 ms <= 10 % of frames, measured by step 2's probe. Ladder: no regression (fps within 5 % of before). If the first fix misses the target, re-profile (step 3 again on the new tree) and fix the next named cause. Stop when target met or a profile names nothing more this view controls; say which in `## Result`. |
| Out of scope | Console result grid (`ConsoleResultGrid.vue`) shares `DocumentRow`, `DocumentTree`, `rows.ts`: a change there must keep it working (its UI specs pass) but is not tuned for it. Grid views (P162 row, untouched). Search, edit, expand behaviour: unchanged. |
| Unit tests | `tests/unit/document-row-height-cache.spec.ts` already covers `pruneRows`; update it if prune semantics change (bounded LRU eviction with interacting window rules qualifies under CLAUDE.md). No other new unit test. |

## 3. Steps

### Step 1: grid scroll budget root cause (pre-existing failure)

1. Quiet gate (`load1 <= 1.0`, `/proc/loadavg`). Pre-phase tree. Run the case alone 5 times:
   `playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing -g
   "interaction budgets"` (after `build:test:studio`). Record each run's `scroll response (work)`
   p50/p95 and max.
2. Fails when quiet: real regression. `git bisect run` between `058623df` (good if it passes there:
   check first) and `HEAD`, 3 runs per point, median verdict. Root-cause the culprit commit, fix
   the code. Never widen the bound to hide it.
3. Passes when quiet, fails only under load: find what the max/p50 covers under load (one step's
   work delta includes a GC, a throttle wait, or scheduler starvation). If the cause is in-repo
   (e.g. a step that measures more than `render()`, a GC from earlier steps' garbage), fix it. If
   the evidence shows the code is within budget and only CPU starvation pushes it over, a wider
   bound needs P139's standard: measured evidence the budget, not the code, is wrong, documented
   in the spec comment and `docs/PERF.md` §2.1. If neither applies and the fix needs test-infra
   work outside this phase (CPU isolation for `ui-timing`, scheduling the timing project apart from
   other sessions), add a named follow-up row at the end of `SPEC.md` (next free `P` number after
   re-scanning every chapter's `SPEC.md`) and say so in `## Result`.
4. Acceptance: `ui-timing` passes on 3 consecutive full `bun run test:ui:studio` runs at quiet
   gate, or the follow-up row exists with the evidence.

### Step 2: probe

Files:
- New `tests/perf/documents-scroll.spec.ts`.
- `tests/perf/perfProbe.ts`: add frame helpers (`FrameMetrics`, `frameStats`, `frameRunLine`,
  `frameSummaryLine`) beside the HTTP ones; HTTP probe output unchanged. Move `median` to a shared
  export if both need it.
- Root `package.json`: `"perf:documents:studio": "bun run build:studio && playwright test
  --config=apps/kira-studio/playwright.config.ts --project=perf documents-scroll"`. The existing
  `perf:http:studio` gets the matching file filter (`http-response`) so each script runs only its
  own spec.

Fixture: Mongo connection via `mongoFixture.ts` (`connectAndExpandControl`), collection
`widgets`-shaped: 5 000 documents generated from `WIDGETS_BODIES[0]`'s shape with unique `_id` and
varied values (same 7 fields, so expanded height 160 px). Read snapshots: page size 100 (initial
open) and 10 000 (probe clicks `page-size-10000`, `hasMore: false`, 5 000 rows). Wait until
`[data-testid="virtual-list"]` `scrollHeight` >= 790 000 before measuring.

Driver: real wheel input, `page.mouse.wheel(0, dy)` with the pointer over the list, one event per
iteration, no sleep. In-page recorder (installed via `page.evaluate` before the gesture): a rAF
loop logging timestamps and `scrollTop`, plus rendered-band coverage per frame (viewport px not
covered by mounted `[data-testid="document-row"]`), stopped 500 ms after the last wheel event.

Cases (`KIRA_PERF_CASES` narrows, `KIRA_PERF_RUNS` default 3, scroll reset to 0 between runs, one
warm-up gesture first and discarded):
- `ladder`: momentum decay, `dy` from 1 600 px x 0.92 per event until < 20 px.
- `flick`: fastest, 80 events of `dy = 9 600` px (~60 rows each), down from the top: covers ~96 %
  of the list.
- `flick-up`: same, upward from the bottom (the parse/decode caches see the other direction).
Parameters are constants at the top of the spec, overridable by env, printed in each run line.

Per-run line: `case`, `run`, `load1`, `frames`, `fps`, `frameP50Ms`, `frameP95Ms`, `frameMaxMs`,
`over50`, `over33`, `uncoveredMaxPx`. Summary line: medians across runs plus `load1` min..max.
Asserts nothing.

Wiring note: `DEV_ENVIRONMENT.md` perf probe bullet extended with the new script, cases, gate.

### Step 3: profile (before any fix)

On the step 2 tree, quiet gate, production build:
1. Before numbers: full probe, 3 runs per case. Record in `## Result`.
2. WebKit split (temporary, uncommitted): in `DocumentView.vue`, `onBeforeUpdate`/`onUpdated`
   accumulate patch time per rAF frame onto `window.__kiraDocPerf`; wrap `rowAt`, `parseRow`,
   `rowHeights` getter, `watch(virtualItems)` callback and `pruneRows` with `performance.now`
   accumulators and call counts; count `DocumentRow`/`DocumentTree` mounts and unmounts per frame
   (`onMounted`/`onUnmounted` counters). The probe reads `__kiraDocPerf` after the flick when
   present. Table per case: per-frame median and p95 of patch ms, mounts, parses, rest-of-frame
   (frame minus patch).
3. Chromium pointer: same `flick` case under Chromium with CDP `Profiler.start`/`stop` on a build
   with readable function names (sourcemap or `minify: false`, state which). Top 15 self-time
   functions into `## Result`.
4. Diagnostic A/B toggles (section 2), each one run of `flick`.
5. Verdict paragraph: which H (or new cause) owns how many ms of the p95 frame. Commit only the
   Result section update; revert all instrumentation (`git diff` on `frontend/` empty).

### Step 4: fix the named cause

Per section 2 "Fix shape", only for causes step 3 named, cheapest first. Rules:
- Tailwind classes, shadcn-vue/reka primitives, `<script setup lang="ts">`, no scoped styles.
- Search highlight, edit (`MonacoHost` row), expand/collapse, nested path toggle, context menu,
  Expand all/Collapse all, go-to-match scroll: behaviour unchanged. Existing UI specs cover them.
- `ConsoleResultGrid.vue` keeps working if a shared file changes.
- Comments only for a non-obvious why (e.g. why the parse cache keeps headroom).
After each fix, rerun `flick` (1 run) to confirm the delta before moving on.

### Step 5: re-profile loop

If the target (section 2) is not met: step 3 items 2 and 4 on the new tree, fix the next named
cause. Each round's numbers go in `## Result`. Stop per section 2 "Target".

### Step 6: verify

- After numbers: full probe, 3 runs per case, back to back with a before run from a temp worktree
  at the probe commit (removed after), same gate.
- `bun run lint:all`, typecheck, `test:unit`, `test:ui:studio` (incl. `ui-timing`, step 1's
  acceptance), `test:visual:studio` (re-capture only a baseline this phase changed on purpose,
  with the pixel reason).
- Docs: `docs/ARCHITECTURE.md` (documents list rendering/cache rule if changed), `docs/PERF.md`
  (documents flick before/after; grid budget finding from step 1), `docs/DEV_ENVIRONMENT.md`
  (probe script).

## 4. Commits (expected; one per logical group)

1. `fix(test): …` or `perf(grid): …` or `docs(v2.0): …` (step 1, shape depends on cause).
2. `test(perf): documents scroll probe` (step 2).
3. `docs(v2.0): P161 profile` (step 3, Result section only).
4. `perf(documents): …` one per named cause fixed (step 4/5).
5. `docs: P161 architecture, perf and dev environment notes`.
6. `docs(v2.0): P161 result` (Result filled, SPEC row status Done with headline numbers).

## 5. Measurement rules

- Gate: start a measurement window only at `load1 <= 1.0` (`/proc/loadavg`). The probe's own
  browser adds ~1.0 (`docs/DEV_ENVIRONMENT.md`), so a per-run reading up to ~2 is normal; above
  that, discard the run and wait. Record the gate reading and per-run range in `## Result`.
- Same machine, same build kind (production `build:studio`), back to back for before/after.
- Medians of 3 runs; one warm-up gesture discarded per run.
- No other heavy process started by this session during a window (no parallel `test:ui:studio`,
  no build).
- A number that cannot be reproduced at the gate is not evidence; say so rather than report it.

## Result

Filled by the implementer: commits, step 1 verdict with numbers, profile tables (WebKit split,
Chromium top functions, A/B deltas), cause verdict, before -> after table per case
(`fps`, `frameP50Ms`, `frameP95Ms`, `frameMaxMs`, `over50`, `uncoveredMaxPx`), gate readings,
deviations, verification.
