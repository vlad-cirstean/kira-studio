# P139 — Studio `ui-timing` root causes, `gofmt`, Space stability: plan

Plan for `docs/v2.0/SPEC.md`'s **P139** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `e2a9f28f`. Line numbers are at that commit.

**Status: in progress.** Sections land as each measurement completes (resumability rule).

**Discovery method, disclosed.** Worktree-local `.codegraph/` index built via
`scripts/codegraph-setup.sh` (the shared index pointed at another worktree). `codegraph_explore`
ran before `Read`/`grep` for: `measureClickToDom`/`measureScrollResponses` and `budgets.spec.ts`;
`__kiraGridScrollWorkStart`/`onViewportScroll`/`KiraSlickGrid.render`; `TabStrip.vue` tab click
wiring; `onSelectAll`/selection model. Measurements come from temporary probes (instrumented
builds, probe specs), all reverted; none committed. Environment: 4 vCPU, 15 GB, Playwright
WebKit, `performance.now()` resolution measured at **1 ms** (100 000-sample min step).

---

## 1. Measured current state (baseline, unmodified `e2a9f28f`)

### 1.1 `ui-timing` alone, quiet machine

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
`KiraSlickGrid.render()` entry (prototype, §3.1) gives work p50 **7.0 ms on 5/5 runs** (p95 11-18),
horizontal 4-5 ms, wide vertical 1 ms, under the 12 ms bound with 5 ms margin.

### 2.2 `budgets.spec.ts:797` — cached tab switch clicks a `<div>` with no handler

`measureClickToDom` calls `el.click()` on `[data-testid="tab"][data-tab-id=…]`. Since P105 §11
(`packages/workbench/src/components/TabStrip.vue:311-336`), a scrolling tab's `data-testid="tab"`
is a `<div>`; `@click="onClick(tab)"` lives on its inner `<button>`. A synthetic `click()` on the
div dispatches on the div and bubbles up, never down to the button. The tab never activates; the
5000 ms timeout fires. `page.click()` (`:791`) passes because it clicks the element's centre,
which hits the inner button.

**Cause: test selector, deterministic.** Failed 2/2 runs that reached it. Before this, `:432`
failed first in most runs, masking it. Prototype selector
`[data-testid="tab"][data-tab-id="…"] > button:not([data-testid="tab-close"])`: 5/5 pass.

Disclosed, not a P139 failure: with the selector fixed, cached tab switch measures p50 301-357 ms,
p95 383-510 ms (bound p95 <= 1000). PERF.md §2.1's P57 M5 row recorded ~48 ms p50. See §0.

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
range into the model, and a `.kira-select-all` host class paints every cell. Prototype of that
path (no CSS yet): **3-7 ms first click, 1-4 ms repeats**, 3/3 runs.

**Cause: code cost at 60-100 % of the gate on a quiet machine; any noise crosses it.** Fix: D6's
bypass, as designed. Budget stays 150 ms.

### 2.4 `gofmt` — no gate runs it; drift is 26 files, not 4

Go 1.27.1 (`go.mod:3`, `/usr/local/go/bin/gofmt`). `gofmt -l apps/` lists **24 files** today, not
the row's 4; `gofmt -l .` adds 2 under `internal/` (26 total). Nothing in the hooks runs `gofmt`:
`.githooks/pre-commit` runs `bun run lint`/`typecheck` (no Go), `.githooks/pre-push` runs
`bun run lint:go` (`golangci-lint run`), and `.golangci.yml` enables linters only, no
`formatters:` block. So drift lands silently.

| Kind | Files | `gofmt -w` safe? |
|---|---|---|
| Import sort (`internal/ipcerr` placed between `apps/…` imports) | 18: `apps/kira-space/internal/bridge/gitclients.go`; Studio `internal/bridge/{collections,connections,customscripts,datagrip,filters,grpchistory,http,http_test,layout,maskrules,ops,queries,responsehistory,schema,tree,variables}.go`; `internal/dbmcp/render.go` | yes |
| Alignment / blank line / indent | 5: `apps/kira-space/internal/gitpreflight/{stack_test,stash_test}.go` (map/struct key alignment), `apps/kira-studio/internal/httpclient/options.go` and `internal/shell/window.go` (double blank line), `apps/kira-studio/internal/adapters/postgres/client.go:304-310` (closure body over-indented one tab) | yes |
| Doc-comment `''` rewrite | 3: `apps/kira-space/internal/gitaskpass/broker.go:121` (`'\''`), `apps/kira-studio/internal/adapters/errors.go:173` (`r[i] == '\''`), `internal/terminal/session.go:35` (`` `trap '' HUP` ``) | **no** |

The third kind is a trap. Go 1.19+ doc-comment reformatting turns `''` into `”` (U+201D).
`gofmt -w` would print `'\”` where the comment documents the shell idiom `'\''`: wrong content.
Fix by rewording so no `''` pair sits in doc-comment prose: move the literal onto its own indented
line (a doc-comment code block, kept verbatim), then `gofmt -w`.

**`golangci-lint`:** `bun run lint:go` (v2.13.2 built with go1.27.1, cache cleaned): **0 issues**.
Enabling `formatters: enable: [gofmt]` in `.golangci.yml` (probe, reverted) reports exactly the 26
files as `gofmt` issues. That block is the regression guard: `pre-push` already runs `lint:go`.

### 2.5 Kira Space stability specs — code read (measurements in §1.4)

**`repo-workspace.spec.ts:228`** (`repo-search-file-row` not rendered). Real race, app and test.
`useRepoSearchStore.startRepoSearch` (`apps/kira-space/frontend/src/repo/state/search.ts:183-210`)
registers `repoBySearchId.set(searchId, repoId)` only after `await
control.codeWorkspaceStartSearch(…)` resolves. `handleCodeSearchEvent` (`:150-154`) drops any event
whose `searchId` is not registered yet. The test emits its first `codeSearch` batch right after
`press('Enter')`, never waiting for the start call to resolve. When the mock's HTTP response lands
after the emitted event, the batch is dropped and the row never renders.

The app has the same window. Go `CodeWorkspaceService.StartSearch`
(`apps/kira-space/internal/bridge/codeworkspace.go:507-560`) starts the scan goroutine before it
returns the handle, and `searchCoalescer.finish` emits the terminal event immediately on
completion. A small worktree can finish before the bound call's response reaches JS: every batch
plus `done` dropped, the panel stuck `running`. Nothing orders a Wails event behind a bound-call
response.

**`ade-panel.spec.ts:430`** (name: Esc reverts without a write). Suspected race in the last
assertion. `expect(control.log().length).toBe(writesBefore)` counts every bound call, not writes
(`packages/workbench/src/testing/ui/mockRuntime.ts:302` logs each call). `writesBefore` is read
once `adeUpdateNewWork` shows in the log; the follow-up snapshot refresh
(`adeRepoSnapshot`/`adeRepoPrs`, `snapshotControl(renamedSnap)`) lands after that write resolves.
If the refresh lands after `writesBefore` is read, the count grows without any write.
