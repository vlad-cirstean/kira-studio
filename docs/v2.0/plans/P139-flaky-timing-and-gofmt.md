# P139 — Studio `ui-timing` root causes, `gofmt`, Space stability: plan

Plan for `docs/v2.0/SPEC.md`'s **P139** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `e2a9f28f`. Line numbers are at that commit.

**Status: plan complete, ready to implement.**

**Discovery method, disclosed.** Worktree-local `.codegraph/` index built via
`scripts/codegraph-setup.sh` (the shared index pointed at another worktree). `codegraph_explore`
ran before `Read`/`grep` for: `measureClickToDom`/`measureScrollResponses` and `budgets.spec.ts`;
`__kiraGridScrollWorkStart`/`onViewportScroll`/`KiraSlickGrid.render`; `TabStrip.vue` tab click
wiring; `onSelectAll`/`onSelectedRangesChanged`/`refreshSelEdges`/`selectionFromRanges`;
`useRepoSearchStore`/`startRepoSearch`/`handleCodeSearchEvent`; `mockRuntime.ts` control snapshots.
Measurements come from temporary probes (instrumented builds, probe specs, prototype fixes), all
reverted; none committed. Environment: 4 vCPU, 15 GB, Playwright WebKit, `performance.now()`
resolution measured at **1 ms** (100 000-sample min step). "Under load" below means 4 busy-loop
shell processes pinned alongside the run (load average 10-16).

---

## 0. Open points (for the orchestrator/user)

1. **Budget drift hides a cached-tab-switch regression. Recommend a follow-up, not P139 scope.**
   `budgets.spec.ts` section headers still say `p95 <= 50ms` (`:732`, `:775`, `:811`) and
   `p50 <= 50ms` (`:829`), matching `docs/PERF.md` §2.1's table. The assertions themselves are
   `<= 1000` (`:773`, `:809`, `:827`, `:853-854`). No comment or doc records why. Git history
   cannot say: the file first appears whole in `bcf7be70`. With `:797`'s selector fixed (§2.2),
   measured numbers against the 50 ms budget PERF.md claims:
   - cell -> editor p95 23-33 ms: inside 50.
   - cached tree expand p95 21-43 ms: inside 50.
   - **cached tab switch p50 292-357 ms, p95 353-510 ms: 7-10x over 50.** PERF.md's P57 M5 row
     recorded ~48 ms p50, ~85 ms p95.

   That is a real regression. The 1000 ms bound hides it; the broken selector hid it further (the
   test never measured a real switch). Restoring the 50 ms bounds is a budget change backed by
   evidence, and tab switch then fails until its regression is root-caused. That root cause is
   new investigation (tab activation path, likely grid remount on the wide table), not a flaky
   timing test. P139 fixes the selector so the number is measured and logged, and keeps the
   bound. Recommend a SPEC row (split per CLAUDE.md: `P139 Part 2: cached tab switch regression;
   restore PERF.md §2.1 bounds in budgets.spec.ts`), or the user widens P139. User's call.
2. **`gofmt` drift is 26 files, not the row's 4.** P139 fixes all 26 (§2.5). No scope question;
   noted because the row names only 4. Earlier `gofmt` runs already corrupted 12 comment lines
   in 9 files (`''` became `”`); P139 repairs those too (§3.4).
3. **`ade-panel.spec.ts:430` does not reproduce** (0 of 160 repeats, quiet and under load, §1.4).
   The plan still tightens its last assertion (§3.7). The existing check counts reads as writes, a
   latent race. Drop §3.7 if the orchestrator prefers no change without a reproduction.

---

## 1. Measured current state

### 1.1 `ui-timing` alone, quiet machine (baseline, unmodified `e2a9f28f`)

`bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps
--repeat-each=5` (nothing else running): **6 failed, 14 passed.**

| Spec | Result (5 repeats) | Numbers |
|---|---|---|
| `budgets.spec.ts:356` | **5/5 fail** | 3x `:432` scroll work p50 = 15, 15, 13 ms (bound 12); 2x `:797` `measureClickToDom: timed out waiting for [data-testid="grid-header-cell"][data-column="int_a"]` (the two runs whose p50 was 12 ms) |
| `perf.spec.ts:119` | 5/5 pass | rAF frame p50 37-45 ms, p95 45-69 ms (bound p95 < 80) |
| `slick-grid.spec.ts:896` | 1/5 fail (first repeat) | wide select-all 295 ms (bound 150) |
| `slick-grid.spec.ts:1002` | 5/5 pass | — |

`budgets.spec.ts` fails with **no contention at all**. The failure is not scheduling.

### 1.2 `ui-timing` scheduling

`playwright.config.ts`: `ui-timing` already has `workers: 1`, `fullyParallel: false`,
`dependencies: ['ui']`. `bun run test:ui:studio` selects only `ui` and `ui-timing`. So
`ui-timing` already starts only after every `ui` test ends and runs its four tests serially,
alone. Serial-pool contention with other projects cannot occur inside one
`bun run test:ui:studio` run. Contention can only come from outside the run (another session or
build in the same container, as P131/P133 results record). Isolating the project further buys
nothing; the fixes below target code and measurement.

### 1.3 `ui-timing` with all §3.1-§3.3 prototypes applied

Prototype = §3.1 mark move + §3.2 selector + §3.3 bypass (background CSS only, gutter selector
wrong, see §3.3). Reverted after measuring.

| Run | Result | scroll work p50 / p95 | select-all wide / tall / T7 | perf p95 |
|---|---|---|---|---|
| quiet, `--repeat-each=4` | **16/16 pass** | 6-7 / 9-22 ms | 4-6 / 3-5 / 19-32 ms | 41-66 ms |
| under load, `--repeat-each=3` | **12/12 pass** | 6-8 / 14-20 ms | 4-12 / 7-27 / 29-36 ms | 60-73 ms |

Other `budgets.spec.ts` metrics, same runs: horizontal work p50 4 ms; wide vertical work p50 1 ms;
cell -> editor p95 23-33 ms; cached tree expand p95 21-43 ms; cached tab switch p95 353-435 ms
(§0 item 1).

Not yet measured: 3 consecutive full `bun run test:ui:studio` runs. A full run is ~45 min; the
container restart killed the planning pass's baseline runs. That is the implementer's acceptance
gate (§6), not a planning input: nothing inside a full run can reach `ui-timing` (§1.2).

### 1.4 Kira Space stability specs (baseline `e2a9f28f`)

`bun run build:test:space`, then `bunx playwright test --config=apps/kira-space/playwright.config.ts
--project=ui <spec> --repeat-each=N`:

| Spec | Run | Result |
|---|---|---|
| `repo-workspace.spec.ts:228` | quiet, 30x, `--workers=4` | **4 failed**: `toHaveCount(1)` on `repo-search-file-row`, received 0 (`:272`) |
| `repo-workspace.spec.ts:228` | under load, 30x, `--workers=4` | 30/30 pass |
| `repo-workspace.spec.ts:228` | §3.6 prototype, quiet, 60x, `--workers=4` | **60/60 pass** |
| `ade-panel.spec.ts:430` | quiet, 30x, `--workers=4` | 30/30 pass |
| `ade-panel.spec.ts:430` | under load, 30x, `--workers=4` | 30/30 pass |
| `ade-panel.spec.ts:430` | quiet, 100x, `--workers=8` | 100/100 pass |
| both files whole | under load, 5x, `--workers=4` | 195/195 pass |

`repo-workspace.spec.ts:228` reproduces at ~13 % (race window, §2.5). Load shifts timing so the
window closes; a quiet machine exposes it. **`ade-panel.spec.ts:430` does not reproduce: 0 of
160.**

---

## 2. Root cause per spec

### 2.1 `budgets.spec.ts:432` — scroll-response "work" window includes SlickGrid's render throttle

`measureScrollResponses` (`tests/ui/support/measure.ts:116-174`) times "work" from
`window.__kiraGridScrollWorkStart` to the first `MutationObserver` callback. The mark sits in
`SlickGridHost.vue:779` `onViewportScroll`. Each step jumps `total/20` px (> 10 000 px on the
10 000-row page), always more than one viewport height.

SlickGrid 5.20 `_handleScroll` (`dist/esm/index.js:10581`): a jump with `dy >= viewportH` does not
render in place; it calls `scrollThrottle.enqueue()` (`actionThrottle`, `:9424`,
`scrollRenderThrottling: 10`). The throttle's 10 ms unblock `setTimeout` is armed by the previous
step's render.

Instrumented build (per-step log of SlickGrid `handleScroll`, host listener, `setTimeout(…, 10)`
arm/fire, `render()` start/duration), 6 runs x 20 steps:

- Steps 3-20: order is `handleScroll` (0-1 ms, throttle blocked, render queued) -> host mark ->
  throttle unblock timer fires -> `render()`. The previous step's 10 ms unblock timer fires only
  **after** this step's scroll event, 17-25 ms after it was armed. WebKit runs the due timer after
  the next rendering update.
- So "work" = throttle wait (2-10 ms) + `render()` (6-8 ms warm, 7-10 ms first run in a page).
  First run p50 12-17 ms; later runs in the same page 7-9 ms. The budget test measures only the
  first run in a fresh page.
- Step 1: throttle idle, so `render()` runs synchronously inside SlickGrid's own `scroll`
  listener, registered before the host's (`SlickGridHost.vue:2152`). The observer fires before the
  host mark; `workStart` stays 0 and "work" falls back to the full end-to-end delta (12-28 ms).
- `render()` itself: 6-8 ms. docs/PERF.md §2.1 defines the metric as "the app's own scroll-work
  mark to DOM committed", excluding scheduling hops. The throttle wait is a library scheduling
  hop, not render work. It entered the window at P22 (SlickGrid migration): the mark stayed in
  the host listener, which now runs before a deferred render.

**Cause: measurement point, not budget, not app regression.** Moving the mark to
`KiraSlickGrid.render()` entry gives work p50 **6-8 ms on every run, quiet and under load**
(§1.3), under the 12 ms bound with 4 ms margin. Budget stays 12 ms.

### 2.2 `budgets.spec.ts:797` — cached tab switch clicks a `<div>` with no handler

`measureClickToDom` calls `el.click()` on `[data-testid="tab"][data-tab-id=…]`. Since P105 §11
(`packages/workbench/src/components/TabStrip.vue:311-336`), a scrolling tab's `data-testid="tab"`
is a `<div>`; `@click="onClick(tab)"` lives on its inner `<button>`. A synthetic `click()` on the
div dispatches on the div and bubbles up, never down to the button. The tab never activates; the
5000 ms timeout fires. `page.click()` (`:791`) passes because it clicks the element's centre,
which hits the inner button.

**Cause: test selector, deterministic.** Failed 2/2 runs that reached it. Before this, `:432`
failed first in most runs, masking it. Prototype selector
`[data-testid="tab"][data-tab-id="…"] > button:not([data-testid="tab-close"])`: passes every run
(§1.3). The switch it now measures is slow (§0 item 1).

### 2.3 `slick-grid.spec.ts:896` — select-all runs 80-150 ms of real work against a 150 ms gate

Single-sample gate: `corner.click()` duration, first select-all in a fresh page. Alone, 8
repeats: wide (1 000 x 61) **92-148 ms**, tall (10 000 x 2) 85-113 ms. Failures: 154, 157, 295 ms.

Instrumented `onSelectAll`, wide, first click then 3 repeat clicks in the same page:

| Part | ms |
|---|---|
| Total `setSelectedRanges(full range)` | 102-111 first, 78-132 repeat |
| `setCellCssStyles('kira-cell-selected')` | 7-30 |
| `refreshSelEdges()` (4 perimeter layers) | 25-50 |
| Rest: SlickGrid `handleSelectedRangesChanged` O(rows x cols) hash plus per-cell `canCellBeSelected` | ~50-70 |

Repeat clicks cost as much as the first: not cold start. The cost is P22 Pass B's own F2 (the
O(area) hash SlickGrid builds for `selectedCellCssClass`). `docs/v1.1/plans/P22-slickgrid-pass-b.md`
§5 D6 names the fix if the gate fails: `onSelectAll` sets `rt().selection` directly, pushes no
range into the model, and a `.kira-select-all` host class paints every cell. `onSelectAll`'s own
comment (`SlickGridHost.vue:1300-1308`) and the spec's (`slick-grid.spec.ts:889-895`) say the
same. Prototype: wide 4-12 ms, tall 3-27 ms, T7 19-36 ms, quiet and under load (§1.3).

**Cause: code cost at 60-100 % of the gate on a quiet machine; any noise crosses it.** Fix: D6's
bypass, as designed. Budget stays 150 ms.

### 2.4 `perf.spec.ts:119` — passes; cadence-bound, no code cause

Never failed in any planning run: p95 41-69 ms quiet, 60-73 ms under load (bound 80). It measures
raw rAF-to-rAF deltas while scrolling (`perf.spec.ts:163-187`), so it carries the WebKit frame
pump's own cadence: ~35 ms/frame idle in this sandbox, as its comment (`:197-205`) and PERF.md
§2.1 already record. Load outside the run stretches every frame, not app work. The failures
P136-P138 saw came with other sessions building in the same container (§1.2).

**Cause: external CPU load on the frame pump. No code cause, no budget change.** The budget has
~10 ms margin over the worst synthetic-load p95. Mitigation is procedural: the §6 verification
runs happen with no other container load, and record `uptime` load average beside each run.

### 2.5 `gofmt` — no gate runs it; drift is 26 files, not 4

Go 1.27.1 (`go.mod:3`, `/usr/local/go/bin/gofmt`). Re-run at `e2a9f28f`: `gofmt -l apps/` lists
**24 files**, not the row's 4; `gofmt -l .` adds 2 under `internal/` (26 total). Nothing in the
hooks runs `gofmt`: `.githooks/pre-commit` runs `bun run lint`/`typecheck` (no Go),
`.githooks/pre-push` runs `bun run lint:go` (`golangci-lint run`), and `.golangci.yml` enables
linters only, no `formatters:` block. So drift lands silently.

| Kind | Files | `gofmt -w` safe? |
|---|---|---|
| Import sort (`internal/ipcerr` placed between `apps/…` imports) | 18: `apps/kira-space/internal/bridge/gitclients.go`; Studio `internal/bridge/{collections,connections,customscripts,datagrip,filters,grpchistory,http,http_test,layout,maskrules,ops,queries,responsehistory,schema,tree,variables}.go`; `internal/dbmcp/render.go` | yes |
| Alignment / blank line / indent | 5: `apps/kira-space/internal/gitpreflight/{stack_test,stash_test}.go` (map/struct key alignment), `apps/kira-studio/internal/httpclient/options.go` and `internal/shell/window.go` (double blank line), `apps/kira-studio/internal/adapters/postgres/client.go:304-310` (closure body over-indented one tab) | yes |
| Doc-comment `''` rewrite | 3: `apps/kira-space/internal/gitaskpass/broker.go:121` (`'\''`), `apps/kira-studio/internal/adapters/errors.go:173` (`r[i] == '\''`), `internal/terminal/session.go:35` (`` `trap '' HUP` ``) | **no** |

The third kind is a trap. Go 1.19+ doc-comment reformatting turns `''` into `”` (U+201D).
`gofmt -w` would print `'\”` where the comment documents the shell idiom `'\''`: wrong content.
Fix by rewording so no `''` pair sits in doc-comment prose (§3.4), then `gofmt -w`.

**`golangci-lint`:** `bun run lint:go` (v2.13.2 built with go1.27.1, cache cleaned): **0 issues**.
Enabling `formatters: enable: [gofmt]` in `.golangci.yml` (probe, reverted) reports exactly the 26
files as `gofmt` issues. That block is the regression guard: `pre-push` already runs `lint:go`.

### 2.6 Kira Space stability specs

**`repo-workspace.spec.ts:228`** (`repo-search-file-row` not rendered). **Reproduced (§1.4). Real
race, in the app, exposed by the test.** `useRepoSearchStore.startRepoSearch`
(`apps/kira-space/frontend/src/repo/state/search.ts:183-210`) registers
`repoBySearchId.set(searchId, repoId)` only after `await control.codeWorkspaceStartSearch(…)`
resolves. `handleCodeSearchEvent` (`:150-154`) drops any event whose `searchId` is not registered
yet. The test emits its first `codeSearch` batch right after `press('Enter')`. When the mock's
HTTP reply lands after the emitted event, the batch is dropped and the row never renders.

The app has the same window. Go `CodeWorkspaceService.StartSearch`
(`apps/kira-space/internal/bridge/codeworkspace.go:507-560`) starts the scan goroutine before it
returns the handle, and `searchCoalescer.finish` emits the terminal event immediately on
completion. A small worktree can finish before the bound call's reply reaches JS: every batch
plus `done` dropped, the panel stuck `running`. Nothing orders a Wails event behind a bound-call
reply. Precedent for the fix shape: `packages/workbench/src/state/createOpLogStore.ts:66-97`
(P108 Part 12 F7) buffers updates that arrive before its own snapshot call resolves.

Prototype (§3.6 minus the test change), quiet, 60x: 60/60 pass, against 4/30 fail baseline.

**`ade-panel.spec.ts:430`** (name: Esc reverts without a write). **Does not reproduce: 0 of 160
repeats (§1.4).** One latent race exists in the last assertion.
`expect(control.log().length).toBe(writesBefore)` (`:492-496`) counts every bound call, not writes
(`packages/workbench/src/testing/ui/mockRuntime.ts:302` logs each call). `writesBefore` is read
once `adeUpdateNewWork` shows in the log. The follow-up snapshot refresh
(`adeRepoSnapshot`/`adeRepoPrs`, `snapshotControl(renamedSnap)` at `:454`) lands after that write
resolves. If the refresh lands after `writesBefore` is read, the count grows with no write. The
test's own title says what it guards: "without a write". Assert that directly (§3.7).

---

## 3. Fix design

### 3.1 Scroll-work mark at render entry

- `apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts:549-553` `render()`: after
  `const start = performance.now();` add `window.__kiraGridScrollWorkStart?.(start);`. One mark
  source, at the start of the work it names. `measure.ts:143-145` overwrites `workStart` on each
  call and disarms on the first mutation, so the render that commits DOM is the one timed.
- `SlickGridHost.vue:779`: delete `window.__kiraGridScrollWorkStart?.(now);`. Rewrite the comment
  at `:764-769` (it still cites `DataGrid.vue`'s `markScrollWork`) to say the scroll-work mark
  lives in `KiraSlickGrid.render()`, and why (SlickGrid's `scrollRenderThrottling` defers a
  far-jump render past this listener).
- `main.ts:170` Window augmentation stays; no type change.
- `tests/ui/support/measure.ts:79` and `:103-110`: replace "DataGrid.vue's own
  __kiraGridScrollWorkStart mark … called from the top of onScroll's rAF callback" with the real
  site, `KiraSlickGrid.render()` entry.
- `tests/ui/budgets.spec.ts:420-431`: rewrite the comment. It blames cross-file worker
  contention, which §1.2 rules out. State the P139 finding in 2-3 lines: the mark sat before
  SlickGrid's render throttle; moved to `render()`; measured p50 6-8 ms. Keep the 12 ms bound
  (margin for this tier's WebKit) and say so.
- `docs/PERF.md`: row at `:23` (`DataGrid.vue's own scroll-work mark`) and prose at `:121-122`
  and the P57 M5 table: name `KiraSlickGrid.render()` as the mark site. Add one P139 line under
  the M5 table with §1.3's numbers.

### 3.2 Tab-switch selector

`tests/ui/budgets.spec.ts:798`: `click:` becomes
`` `[data-testid="tab"][data-tab-id="${…}"] > button:not([data-testid="tab-close"])` ``. One-line
comment: `measureClickToDom` uses a synthetic `el.click()`, which never reaches the inner button
that owns `@click` (TabStrip.vue). The `<= 1000` bound is untouched (§0 item 1).

### 3.3 Select-all bypass (P22 Pass B §5 D6)

`SlickGridHost.vue`:

- New `const selectAllActive = ref(false);` beside the selection-model state (`ref` is already
  imported). Declare it before `onSelectAll`.
- `onSelectAll` (`:1309-1321`) body after the existing guards:
  1. `selectionModel.setSelectedRanges([])`. It fires `onSelectedRangesChanged`, which clears the
     model's ranges, SlickGrid's `kira-cell-selected` hash and `rt().selection`.
  2. `const all = selectionFromRanges([new SlickRange(0, 1, displayRowCount - 1, colCount)],
     false, null)`. Reuses the one existing range-to-`Selection` translation (a `range` kind).
  3. `const entry = rt(); if (!entry || !all) return;`
     `entry.selection = toPageRowSelection(all); selectAllActive.value = true; refreshSelEdges();`
  Copy (`onCopy`, `:1749`), paste and delete read `rt().selection`, so they keep working
  unchanged. `refreshSelEdges` computes perimeter classes from `rt().selection` over the rendered
  band only.
- `onSelectedRangesChanged` (`:1447-1457`): first line after the `runtimeEntry` guard,
  `selectAllActive.value = false;`. Any real selection change (click, drag end, keyboard,
  header-zone push, filter-change re-push at `:1436`) ends select-all. The call inside step 1
  clears it before step 3 sets it.
- `onCellRangeSelecting` (the drag-preview handler, ~`:880-901`): also set
  `selectAllActive.value = false;`, or a drag after select-all previews over a fully-painted grid
  until drag end.
- Template root (`:2636-2640`): add `'kira-select-all': selectAllActive` to the `:class` object.
- Rewrite `onSelectAll`'s comment (`:1300-1308`): the bypass is now built, why (P139 §2.3
  measurements), and that `rt().selection` owns meaning while the model holds no range.

`apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` (the existing global stylesheet
for SlickGrid's own generated DOM; Tailwind utilities cannot reach cells SlickGrid builds as HTML
strings, same reason every rule in this file exists):

- Fill (`:486`): add selector `.slick-grid-host.kira-select-all :where(.slick-cell:not(.kira-gutter))`.
  **Gutter class is `kira-gutter`** (`gridHostShared.ts` `cssClass`); `grid-gutter-cell` is only
  its `data-testid`. The planning prototype used the wrong one and painted the gutter. `:where()`
  pins specificity to (0,2,0), equal to `.slick-grid-host .kira-cell-selected`. Same position in
  the file, so D6's cascade priority (staged/search layers declared later win) holds unchanged.
- Edges (`:495-517`): extend each of the five rules with the same
  `.slick-grid-host.kira-select-all :where(.slick-cell:not(.kira-gutter))` twin (plus `.sel-t` /
  `.sel-r` / `.sel-b` / `.sel-l` inside the `:where()` for the four side rules). Without this the
  perimeter classes `refreshSelEdges` sets draw nothing, since they key on `.kira-cell-selected`.
- Hover (`:217`): `.slick-grid-host:not(.kira-select-all) .slick-row:hover .slick-cell:not(.kira-cell-selected)`,
  so hover does not blank the select-all fill.

Tests, `apps/kira-studio/tests/ui/slick-grid.spec.ts`: four post-conditions poll
`.kira-cell-selected` count > 0 (`:913`, `:991`, `:1094`, `:1201`). Under the bypass no cell gets
that class. Replace each with `await expect(<page-or-locator>.locator('.slick-grid-host.kira-select-all')).toHaveCount(1);`
Rewrite the C6 header comment (`:889-895`): the bypass is built; the gate now times it. The copy
test at `~:1201` keeps its clipboard assertions, which prove `rt().selection` still drives copy.

### 3.4 Doc-comment rewording (before `gofmt -w`)

Reword so no `''` pair sits in doc-comment prose:

- `apps/kira-space/internal/gitaskpass/broker.go:121`: move the idiom to its own indented line (a
  doc-comment code block, kept verbatim):
  ```go
  // shellQuoteSingle wraps s in single quotes, escaping each embedded single quote as
  //
  //	'\''
  //
  // — close the quote, emit a backslash-escaped literal quote outside it, reopen the quote …
  ```
- `apps/kira-studio/internal/adapters/errors.go:173`: "Requires r[i] to be a single quote and the
  immediately preceding rune …".
- `internal/terminal/session.go:35`: `` `trap "" HUP` `` (shell-equivalent, no `''` pair).

Then `gofmt -d` on each of the three must show no `”`.

**Already corrupted: 12 comment lines in 9 files.** Earlier `gofmt -w` runs already applied the
same rewrite, so `gofmt -l` no longer lists them. `rg -n '[“”]' --glob '*.go' apps/ internal/` at
`e2a9f28f`:

| Site | Meant | Reword to |
|---|---|---|
| `apps/kira-studio/internal/mcpinstall/install.go:161` | `('\'' — close…` | code-block line, as `broker.go` |
| `apps/kira-studio/internal/adapters/errors.go:127`, `:243` | a backtick (was a double-backtick code span), and the doubled forms of each quote | name them in words ("a backtick", "a doubled quote of the same kind") |
| `apps/kira-space/internal/storage/model/adequeue.go:111` | `CHECK (title <> '' OR jira_key <> '')` | code-block line |
| `apps/kira-space/internal/gitsession/incremental.go:160-161` | `''` (empty string) | "the empty string" |
| `apps/kira-studio/internal/adapters/clickhouse/query.go:29` | `''` | "an empty string" |
| `apps/kira-studio/internal/adapters/mysqlfamily/catalog.go:181` | `''` | "empty" |
| `apps/kira-studio/internal/storage/repos/maskkeys.go:31`, `:60` | `''`; `` `WHERE mask_correlation_key = ''` `` | "empty string"; code-block line |
| `apps/kira-studio/internal/storage/repos/connections.go:295` | `DEFAULT ''` | code-block line or "an empty-string default" |
| `apps/kira-studio/internal/storage/model/variables.go:29` | `''` | "the empty string" |

Same commit as the three above. After it, `rg '[“”]' --glob '*.go' apps/ internal/` is empty.

### 3.5 `gofmt -w` and the guard

- `gofmt -w` on the 26 files `gofmt -l .` lists (excluding `node_modules`). Import-sort files get
  `internal/ipcerr` moved into the sorted block; no semantic change.
- `.golangci.yml`: add a top-level block
  ```yaml
  formatters:
    enable:
      - gofmt
  ```
  `pre-push` already runs `bun run lint:go`, so new drift fails push. No new dependency.

### 3.6 Space search: hold events that overtake `StartSearch`'s reply

`apps/kira-space/frontend/src/repo/state/search.ts`, inside the store:

- `const earlyEvents: CodeSearchEvent[] = []; let startsInFlight = 0;` with a two-line comment:
  a Wails event can overtake the bound call's reply; held until the start resolves (same shape as
  `createOpLogStore`'s F7 buffer).
- `handleCodeSearchEvent`: when `repoBySearchId` has no entry, push to `earlyEvents` if
  `startsInFlight > 0`, else drop (unchanged superseded/finished behaviour).
- `startRepoSearch`: `startsInFlight++` right before the `try`; add
  `finally { startsInFlight--; for (const held of earlyEvents.splice(0)) handleCodeSearchEvent(held); }`.
  Replay goes back through the handler: an event for the just-registered id applies in arrival
  order; one for a superseded id drops; one for another still-pending start re-buffers. Buffer
  lives only while a start is in flight, so it is bounded by that window.

`apps/kira-space/tests/ui/repo-workspace.spec.ts:228-272`: make the race deterministic instead of
timing-dependent. Mark the start snapshot `hold: true` (`:236`; P108 Part 12 F4's mock seam,
`mockRuntime.ts:25-29`). Take `control` from `relaunch`. Emit the `seq: 0` batch (`:249`), then
`control.release(IPC.codeWorkspaceStartSearch)`, then the existing `toHaveCount(1)`. That pins the
exact order that failed: event before reply. It fails 100 % without the store fix. No separate
unit test: this spec already covers the ordering.

### 3.7 Space ade-panel: assert "no write", not "no call"

`apps/kira-space/tests/ui/ade-panel.spec.ts:492-496`: replace `control.log().length` with a count
of write channels only:
```ts
const writes = () =>
  control.log().filter((e) => e.channel === IPC.adeSetBranchMeta || e.channel === IPC.adeUpdateNewWork).length;
const writesBefore = writes();
…
expect(writes()).toBe(writesBefore);
```
Not reproduced (§1.4); this removes the read-counting race, and the title already names writes.

### 3.8 `perf.spec.ts`: no change

§2.4. No code cause; the budget has measured margin. Verification protocol carries the load
condition.

---

## 4. File ownership (one sequential implementer)

No split: every Studio change lands in `SlickGridHost.vue` or specs that one full
`test:ui:studio` run verifies together, and the Space/Go items are small.

| File | Change | Step |
|---|---|---|
| `apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts` | mark at `render()` entry | 1 |
| `apps/kira-studio/frontend/src/views/grid/SlickGridHost.vue` | remove mark + comment (step 1); bypass, ref, class, comments (step 3) | 1, 3 |
| `apps/kira-studio/tests/ui/support/measure.ts` | doc comments | 1 |
| `apps/kira-studio/tests/ui/budgets.spec.ts` | `:420-431` comment (step 1); `:798` selector (step 2) | 1, 2 |
| `docs/PERF.md` | mark site, P139 numbers | 1 |
| `apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css` | fill, edges, hover | 3 |
| `apps/kira-studio/tests/ui/slick-grid.spec.ts` | 4 post-conditions, C6 comment | 3 |
| `apps/kira-space/internal/gitaskpass/broker.go`, `apps/kira-studio/internal/adapters/errors.go`, `internal/terminal/session.go`, plus the 8 other already-corrupted files (§3.4 table) | reword | 4 |
| 26 Go files from `gofmt -l .` (§2.5 table) | `gofmt -w` | 5 |
| `.golangci.yml` | `formatters` block | 6 |
| `apps/kira-space/frontend/src/repo/state/search.ts` | early-event buffer | 7 |
| `apps/kira-space/tests/ui/repo-workspace.spec.ts` | hold/release ordering | 7 |
| `apps/kira-space/tests/ui/ade-panel.spec.ts` | write-only count | 8 |
| `docs/v2.0/plans/P139-flaky-timing-and-gofmt.md` | result section | 9 |

## 5. Ordered commit steps

Each commit passes the pre-commit hook normally; never `--no-verify`. Fast checks per commit
(`bun run lint`, `bun run typecheck`, `go build ./...` for Go steps). Expensive runs once, at §6.

1. `fix(studio): time scroll work from KiraSlickGrid.render entry` — §3.1.
2. `test(studio): tab-switch budget clicks the tab's inner button` — §3.2.
3. `perf(studio): select-all bypasses the selection model (P22 D6)` — §3.3. Before committing, run
   `slick-grid.spec.ts` select-all tests plus `--grep "select-all"` in `ui` once to catch a CSS or
   copy break early.
4. `docs(go): reword doc comments that gofmt would corrupt` — §3.4.
5. `style(go): gofmt -w` — §3.5 first bullet. Confirm `gofmt -l .` empty (excluding
   `node_modules`).
6. `chore(lint): enable gofmt formatter in golangci-lint` — §3.5 second bullet. `bun run lint:go`
   0 issues.
7. `fix(space): hold code-search events that overtake StartSearch's reply` — §3.6, store and spec
   together (the spec fails without the store fix).
8. `test(space): ade name Esc check counts writes only` — §3.7.
9. Verification (§6), then `docs(v2.0): P139 result` — result section in this file with every
   run's numbers. Fix commits for anything §6 finds land before this one.

## 6. Verification

Run with no other session, build or test in the container. Record `uptime` before each run.

1. Studio `ui-timing`, **3 consecutive full runs**, each must pass all four `ui-timing` tests:
   ```sh
   bun run test:ui:studio 2>&1 | tee /tmp/p139-full-1.log   # then -2, -3
   ```
   A run is ~45 min: run in the background with a log, poll it; never let a container restart
   pass for a green run. Any `ui-timing` failure resets the count to 0. Record per run: scroll
   work p50/p95, select-all wide/tall/T7 ms, perf p95, tab switch p50/p95. Any `ui` failure gets
   fixed (CLAUDE.md), then the count restarts.
2. `ui-timing` alone, quiet then loaded, as a quick pre-check before step 1:
   `bunx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing --no-deps --repeat-each=4`.
3. Go:
   ```sh
   gofmt -l apps/          # empty
   gofmt -l internal/      # empty
   bun run lint:go         # 0 issues, gofmt formatter enabled
   go build ./...
   ```
4. Space:
   ```sh
   bun run build:test:space
   bunx playwright test --config=apps/kira-space/playwright.config.ts --project=ui \
     repo-workspace.spec.ts:228 ade-panel.spec.ts:430 --repeat-each=60 --workers=4
   ```
   Once quiet, once under 4 busy loops. 0 failures both times. Then full `bun run test:ui:space`
   once.
5. Full `bun run test:ui:studio` covers every other select-all/grid spec (the bypass's blast
   radius).

## 7. Closing audit

```sh
rg -n '__kiraGridScrollWorkStart' apps/ docs/PERF.md     # callers: kiraSlickGrid.ts + measure.ts + main.ts type only; no SlickGridHost.vue
rg -n 'DataGrid\.vue' apps/kira-studio/tests/ui/support/measure.ts   # empty
rg -n "kira-cell-selected'\)\.count" apps/kira-studio/tests/ui/slick-grid.spec.ts   # empty
rg -n 'kira-select-all' apps/kira-studio/frontend/src                # SlickGridHost.vue class + slickTheme.css rules
rg -n 'grid-gutter-cell' apps/kira-studio/frontend/src/views/shared/slick/slickTheme.css  # empty
rg -n '\] > button:not' apps/kira-studio/tests/ui/budgets.spec.ts    # the tab-switch selector
gofmt -l apps/ internal/                                              # empty
rg -n '[“”]' --glob '*.go' apps/ internal/                            # empty (12 lines at e2a9f28f, §3.4)
rg -n -A3 '^formatters:' .golangci.yml                                # gofmt enabled
rg -n 'earlyEvents|startsInFlight' apps/kira-space/frontend/src/repo/state/search.ts
rg -n 'hold: true' apps/kira-space/tests/ui/repo-workspace.spec.ts
rg -n 'log\(\)\.length' apps/kira-space/tests/ui/ade-panel.spec.ts  # no hit at the Esc check
rg -n 'toBeLessThan\(150\)|toBeLessThanOrEqual\(12\)|toBeLessThan\(80\)' apps/kira-studio/tests/ui  # budgets unchanged
git diff e2a9f28f --stat -- apps/kira-studio/tests/ui/perf.spec.ts   # empty
```

## 8. Risks

- **Mark move changes the metric.** It now excludes SlickGrid's throttle wait, which PERF.md's own
  definition already excludes. A render that commits no DOM then a later one that does: the later
  call overwrites `workStart`, so still timed right. Horizontal scroll also goes through
  `render()` (measured 4 ms p50).
- **Select-all semantics.** Shift+arrow after select-all now extends from the active cell, not the
  whole range: SlickGrid's model holds no range. Same as clicking the corner then a cell today.
  Filter change re-pushes `rt().selection` as ranges (`:1402-1441`), which takes the slow path
  once and clears the flag: correct paint, cost only on that rare path.
- **CSS cascade.** `:where()` keeps specificity equal to the existing fill rule. Check visually
  that staged-edit and search-hit colours still win over the fill after select-all
  (`tests/visual` has no select-all baseline; check by one screenshot in the implementer's run).
- **T7 (`:1002`) under load reached 36 ms.** Its search-highlight layer still refreshes. Far under
  150.
- **`perf.spec.ts` stays load-sensitive.** 73 ms measured under synthetic load against 80. A run
  alongside another build can still fail it. §6 requires a quiet container; a failure under
  recorded load average > 4 is re-run, not counted, and recorded in the result.
- **Space buffer.** Unbounded only while one start call is in flight; a start that never settles
  would hold events. `control` calls reject on bridge error, so `finally` always runs.

## 9. Acceptance

- `ui-timing` passes on 3 consecutive full `bun run test:ui:studio` runs, numbers recorded.
- Budgets unchanged: scroll work p50 <= 12 ms, select-all < 150 ms, perf p95 < 80 ms.
- `gofmt -l apps/` empty (and `internal/`); `bun run lint:go` 0 issues with the `gofmt`
  formatter enabled.
- `repo-workspace.spec.ts:228` and `ade-panel.spec.ts:430` pass `--repeat-each=60`, quiet and
  under load; the search spec pins event-before-reply order via `hold`.
- §7 audit clean. §0 item 1 raised to the orchestrator/user.
