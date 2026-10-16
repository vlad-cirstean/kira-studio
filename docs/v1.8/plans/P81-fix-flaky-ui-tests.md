# P81 — Fix flaky UI tests

`docs/v1.8/SPEC.md`'s P81 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `41399152`, P71-P80 landed); line numbers are from
that tree, and from `@playwright/test@1.63.0` / `github.com/wailsapp/wails/v3@v3.0.0-beta.21` as
pinned in `package.json` and `go.mod`.

Four tests, four different root causes. None is "CI is slow, raise the number". Three are test-side
defects — a wall-clock proxy for a structural property, an absence assertion racing a real 150ms
timer, a fixed sleep standing in for a convergence the same file elsewhere proves takes ~10 frames.
The fourth is a genuine harness bug, reproduced deterministically in this session: two Playwright
workers run the same Vite build into the same `outDir` with `emptyOutDir: true`, and one wipes the
files the other is serving.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is `cell-editor.spec.ts`'s `elapsed < 250` CI slowness or an app race | **Neither.** The app behaviour is correct and the assertion is a wall-clock proxy for a structural property the test's own comment names ("someone re-creates the EditorView per cell"). The property is directly assertable | §2 |
| Is a wider tolerance acceptable for it | **No, and none is taken.** The timing term is removed entirely, not widened | §2.3 |
| Is `grpc-request.spec.ts`'s zero-call assertion a fixture leak | **No.** It races a real 150ms debounce restarted per keystroke. 20 `keyboard.type` keystrokes is 20 CDP round trips; one gap past 150ms fires the timer correctly, mid-typing | §3.2 |
| Is `slick-grid.spec.ts`'s mutation counter seeing another test's teardown | **No** — `page.evaluate`, own page, own observer, scoped to one viewport element. It sees *this* test's own still-converging catch-up renders, left over from the 5000px jump 2 lines above | §4.2 |
| Is any of the three a genuine app-level race | **No.** All three exercise correct app code. `commit-meta-clamp.spec.ts` is the only genuine defect, and it is in test infrastructure, not in `CommitMeta.vue` | §5 |
| What the fourth one actually is | Measured, not inferred: concurrent `viteBuild` into one shared `dist/` with `emptyOutDir: true`, one per worker. 42 of 62 requests for `/harness.js` returned **404** while a second build ran | §5.2 |
| Do sibling assertions in the same files share the defect | Yes, three of them, named and fixed here; two more inspected and deliberately left, with reasons | §6 |
| What counts as "fixed" for an already-intermittently-passing test | Deterministic failure repro first, then the fix under the *same* conditions, then a mutation check proving the rewritten assertion still fails when the regression it guards is reintroduced | §1 |
| Any `playwright.config.ts` change | **None.** P27's `ui`/`ui-timing` split stays exactly as it is; §2.3 explains why relocating a test there is the wrong fix here | §8 |

---

## 1. Method: what counts as fixed

These tests already pass most of the time. Re-running until green proves nothing, and the SPEC row
says so. Every fix carries three obligations, in order.

**(a) Deterministic repro of the failure, before the fix.** Not "run it under load and hope" — an
edit or a flag that makes the current test fail every time by supplying, deterministically, the
condition load supplies at random. Each section below names its own.

**(b) The fix passes under that same condition**, unchanged. If the repro's knob has to be turned
back down for the fix to pass, the fix is a tolerance change wearing a disguise.

**(c) A mutation check.** Removing a timing term removes the thing that made the assertion fail, so
"it stops failing" is worthless as evidence on its own. Instead, reintroduce the regression the
assertion exists to guard — in application code, temporarily — and confirm the rewritten assertion
still fails. Revert immediately; nothing from (a) or (c) is committed. Each section names its own
mutation.

Record the actual observed numbers in the commit messages (failure counts before and after), not a
claim that it was checked.

---

## 2. Flake 1 — `cell-editor.spec.ts`, the populate latency tripwire

### 2.1 What it does now

`apps/kira-studio/tests/ui/cell-editor.spec.ts:769`-`779`, scenario 11 of the test "cell editor —
autodetect, beautify, override, NULL/empty/truncated, read-only":

```ts
const t0 = Date.now();
await selectCell(page, 3, 'sample');
await expect.poll(async () => (await panel.getAttribute('data-cell-key')) ?? '').toBe(`${tabId}:3:sample`);
const elapsed = Date.now() - t0;
expect(elapsed).toBeLessThan(250);
```

Observed under full-suite load: 286-350ms. The comment above it states the intent outright —
"Deliberately far looser than §2.1's 50ms budget ... this catches 'someone re-creates the
EditorView per cell', not the budget itself — the real measurement is P12's."

### 2.2 Root cause

The measured interval is a Node-side `Date.now()` delta spanning a `click()` round trip plus an
`expect.poll` loop whose own polling interval (Playwright's default backoff, 100ms after the first
retries) is itself part of the number. Under `workers: '100%'` (`apps/kira-studio/playwright.config.
ts:34`) with every core busy, that delta exceeds 250ms while the application does exactly the right
thing. It is a wall-clock assertion sitting in the parallel `ui` project, which is precisely the
arrangement P27 split `ui-timing` out to prevent (`playwright.config.ts:53`-`68`).

The property it stands in for is not timing at all, and is an invariant of the current code:

- `DataView.vue:318` mounts `<CellEditorDock :tab-id="tab.id" />` — keyed by tab, never by cell.
- `CellEditorDock.vue:21`/`:38` gate on `v-if="cell"` and pass `:cell` down; selecting another cell
  in the same tab keeps `cell` truthy, so `CellEditorView` is not re-created.
- `CellEditorView.vue:582`-`592` mounts `<MonacoHost>` with no `:key`.
- `MonacoHost.vue` creates the editor once in `onMounted` and disposes it in `onUnmounted`
  (`:426`-`441`). Every prop change is handled by `updateOptions` / `setModelLanguage` / a model
  edit (`:479`-`583`) — nothing in it ever re-creates the editor.

So "the editor instance survives a cell switch" is true by construction today, is exactly what the
tripwire is guarding, and is directly observable.

### 2.3 Why not a wider tolerance, and why not `ui-timing`

A wider tolerance is rejected: the assertion's intent is structural, so *any* number is arbitrary,
and a number large enough to survive a loaded 16-core container is large enough that a genuine
per-cell editor rebuild would slip under it. Widening would keep the flake's cause and discard its
value.

Moving the test into the serial `ui-timing` project is rejected too. `ui-timing` selects by title
(`playwright.config.ts:9`), and this title covers a ~400-line, 12-scenario test whose other 11
scenarios are pure DOM work that gains nothing from running alone — the same reasoning that config's
own comment gives for pulling out `slick-grid.spec.ts` by title rather than by file, applied in the
other direction. It would also leave a wall-clock proxy in place for a non-timing property.

### 2.4 The fix

Replace the timing term with an identity term. Before selecting row 3, mark the live Monaco root;
after the switch, require the marked node to still be there.

```ts
// --- scenario 11: the editor instance is reused across cells, never re-created ---------------
// P81: this was a `Date.now()` budget standing in for "someone re-creates the EditorView per
// cell" (see git history). MonacoHost creates its editor once in onMounted and disposes it in
// onUnmounted, so a re-create means a new `.monaco-editor` subtree — the marker below cannot
// survive one. The real latency measurement is P12's; this never was one.
const monacoRoot = panel.locator('[data-testid="cell-editor-encoded"] .monaco-editor');
await monacoRoot.evaluate((el) => el.setAttribute('data-kira-p81-instance', 'pinned'));
await selectCell(page, 3, 'sample');
await expect.poll(async () => (await panel.getAttribute('data-cell-key')) ?? '').toBe(`${tabId}:3:sample`);
await expect(
  panel.locator('[data-testid="cell-editor-encoded"] .monaco-editor[data-kira-p81-instance="pinned"]'),
).toHaveCount(1);
// Reused *and* repopulated — the opposite failure mode a bare identity check would miss.
expect(await editorText(page)).toBe(await cellText(page, 3, 'sample'));
```

A marker attribute, not an `ElementHandle` comparison: no handle lifetime to manage, the assertion
auto-retries like every other one in the file, and a detached-then-rebuilt subtree fails it by
`toHaveCount(0)` rather than by a thrown null. `data-kira-p81-instance` is set by the test on a
Monaco-owned node; Monaco never enumerates or clears unknown attributes on its root.

The added `editorText` line matters: identity alone would also hold if the panel stopped updating,
so it pins both halves of "reuse, correctly".

### 2.5 Repro and mutation check

- **(a) Repro:** the failure is a pure function of machine speed, so reproduce it by making the
  budget unreachable — temporarily `expect(elapsed).toBeLessThan(1)`. Fails 100%. That demonstrates
  the assertion is wall-clock-bound, which is the claim; it is not evidence about the app.
- **(b)** After the fix there is no timing term left, so (b) is discharged by inspection: run the
  test under a saturating background CPU load (§9) and confirm it passes.
- **(c) Mutation check:** add `:key="cellKey(selectedCell)"` to `<MonacoHost>` in
  `CellEditorView.vue:582` — that is literally "re-create the EditorView per cell". The new
  assertion must fail (`toHaveCount(0)`). Revert. If it passes with the mutation in place, the
  assertion is not guarding what it claims and must be reworked before landing.

### 2.6 Same-file sweep

`cell-editor.spec.ts` has exactly one wall-clock assertion (grep: one `Date.now()`, one
`toBeLessThan`). Its four `waitForTimeout` calls are settle waits ahead of auto-retrying assertions,
not one-shot budgets — left alone.

---

## 3. Flake 2 — `grpc-request.spec.ts`, the debounce window

### 3.1 What it does now

`apps/kira-studio/tests/ui/grpc-request.spec.ts:207`-`225`:

```ts
await page.keyboard.type('demo.example.com:443');
// Nothing has fired yet — still inside the debounce window.
expect(control.log().filter((e) => e.channel === IPC.grpcDescribe)).toHaveLength(0);
await expect.poll(() => control.log().filter((e) => e.channel === IPC.grpcDescribe).length).toBe(1);
```

### 3.2 Root cause

Not a fixture leak. `GrpcRequestView.vue:115`-`129`:

```ts
const SCHEMA_LOAD_DEBOUNCE_MS = 150;
...
clearTimeout(schemaLoadTimer);
...
schemaLoadTimer = setTimeout(() => { void loadSchema(props.tab.id); }, SCHEMA_LOAD_DEBOUNCE_MS);
```

The timer restarts on every keystroke, so the window is 150ms after the **last** character, not
after the first. `page.keyboard.type` with no `delay` still issues one CDP round trip per character
— 20 of them here. On a contended machine a single inter-keystroke gap can exceed 150ms, at which
point the debounce fires **correctly**, mid-word, against a partial target. One `grpcDescribe` is
already in the log when line 218 reads it.

The application is right; the test asserts an absence whose truth depends on how fast the harness
can type. Note the knock-on: once that happens, the poll on line 220 can settle at 1 while that 1 is
the *partial-target* call, and line 224's `toMatchObject` then fails instead — the same root cause
with a second face.

### 3.3 The fix — deterministic timer control

Playwright 1.63 ships `page.clock`. Nothing in this repo uses it yet; this phase introduces it.
Install it **after** boot, immediately before the assertion block, never before `relaunch()`:
`relaunch()` navigates internally (`fixtures.ts:85`-`86`) and waits for `[data-testid="status-bar"]`,
so freezing time across boot risks stalling the boot path the fixture waits on.

Safe for the mock transport, checked rather than assumed: control answers are `page.route` network
fulfills (`support/mockRuntime.ts:508`-`633`), not timer-driven, and the bundled Wails runtime's only
`setInterval` is a boot-time flags-retry loop that has long since cleared itself by the time a test
types anything; its `setTimeout` uses are call-cancel/timeout/sleep paths, none of which a Call takes
unless a timeout option is passed.

```ts
await openHttpModeAndNewGrpcRequest(page);
await installFakeTimers(page); // support/clock.ts — see §7.1
await page.click('[data-testid="grpc-target"]');
await page.keyboard.type('demo.example.com:443');

const describeCalls = () => control.log().filter((e) => e.channel === IPC.grpcDescribe);
// Time has not moved, so no wall-clock budget is being asserted here: the debounce *cannot*
// have elapsed, however slowly the harness typed.
expect(describeCalls()).toHaveLength(0);
await page.clock.runFor(SCHEMA_LOAD_DEBOUNCE_MS - 1);
expect(describeCalls()).toHaveLength(0);
await page.clock.runFor(2);
await expect.poll(() => describeCalls().length).toBe(1);
expect(describeCalls()[0]?.args).toMatchObject({ target: 'demo.example.com:443' });
// No trailing duplicate: one debounce, one call, not one-per-keystroke arriving late.
await page.clock.runFor(2_000);
expect(describeCalls()).toHaveLength(1);
```

`SCHEMA_LOAD_DEBOUNCE_MS - 1` / `+2` restate the component's own constant; the spec declares its own
`const SCHEMA_LOAD_DEBOUNCE_MS = 150` local with a comment pointing at `GrpcRequestView.vue`, rather
than importing across the web/node tsconfig boundary (this suite's existing convention — see
`global.d.ts:1`-`5`).

This is strictly stronger than what it replaces: the current test never proves the call count stays
at 1, only that it reaches 1. The `poll` after `runFor` stays a poll because the Describe answer
still crosses a real process boundary.

### 3.4 Repro and mutation check

- **(a) Repro:** `page.keyboard.type('demo.example.com:443', { delay: 200 })` — 200 > 150, so the
  debounce fires mid-typing every time. The current test fails 100%; keep the flag on.
- **(b)** Apply the fix and keep `{ delay: 200 }`. It must pass: the fake clock does not advance
  because real time passed. Then remove the delay for the committed version.
- **(c) Mutation check:** in `GrpcRequestView.vue`, replace the `setTimeout` body with a direct
  `void loadSchema(props.tab.id)` — i.e. reintroduce Finding 13's original bug. The rewritten test
  must fail on the first `toHaveLength(0)`. Revert.

### 3.5 Same-file sweep

`grpc-request.spec.ts` has no other absence-inside-a-timer assertion and no `waitForTimeout` at all
(grep: 0). Its other `toBe(0)` assertions are `scrollTop` reads. Two structurally identical
assertions live in *other* files — §6.

---

## 4. Flake 3 — `slick-grid.spec.ts`, the sub-row mutation counter

### 4.1 What it does now

`apps/kira-studio/tests/ui/slick-grid.spec.ts:423`-`439`:

```ts
await rightViewport(page).evaluate((el) => { el.scrollTop = 5000; });
await page.waitForTimeout(300);
const subRowMutations = await rightViewport(page).evaluate(async (el) => {
  let count = 0;
  const observer = new MutationObserver((records) => { count += records.length; });
  observer.observe(el, { childList: true, subtree: true, attributes: true });
  el.scrollTop += 4; // well under a 28px row
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  observer.disconnect();
  return count;
});
expect(subRowMutations).toBe(0);
```

Observed under full-suite load: 24.

### 4.2 Root cause

Not cross-test contamination: the observer is created inside `page.evaluate` on this test's own
page, scoped to one element (`.slick-viewport-top.slick-viewport-right`), armed and disconnected
within a single evaluate. Nothing from another test or another worker can reach it.

The mutations are this test's own, from the jump two lines above. `waitForTimeout(300)` is a fixed
bet that the grid has finished converging after a 5000px scroll into unmounted territory. The same
file disproves that bet 15 lines later: §3a (`:454`-`473`) exists specifically to assert that a jump
of this kind converges *over frames* — it samples the mounted `.slick-cell` count across 10
animation frames and asserts the first is strictly smaller than the last. The mechanism is
`MAX_NEW_CELLS_PER_RENDER = 600` (`views/shared/page/columns.ts:226`) plus the re-arming chase loop
in `kiraSlickGrid.ts:267`-`301`, whose own doc comment records this sandbox measuring p50 29 / p95
58 / max 65ms frames. At 30-60ms per frame, 300ms buys 5-10 frames — the exact horizon §3a measures.
When the machine is loaded, convergence outlives the sleep and its next catch-up render lands inside
the observation window.

So the assertion is right, the app is right, and the precondition is wrong: the test needs "the grid
has stopped mutating", which is what it means, not "300ms have passed", which is what it says.

### 4.3 The fix — wait for quiescence, in-page, in the same evaluate

Add `mutationsForScroll` to `tests/ui/support/grid.ts` (§7.2) and use it for both sites:

```ts
await rightViewport(page).evaluate((el) => { el.scrollTop = 5000; });
const subRowMutations = await mutationsForScroll(rightViewport(page), 4);
expect(subRowMutations).toBe(0);

const crossRowMutations = await mutationsForScroll(rightViewport(page), 3000);
expect(crossRowMutations).toBeGreaterThan(0);
```

The quiet wait and the measurement must live in **one** `page.evaluate`, so no round trip can let a
catch-up render slip in between confirming quiet and arming the observer. `waitForTimeout(300)`
disappears; nothing is loosened — the assertion stays `toBe(0)` exactly.

The `crossRowMutations` site is not currently flaky (it asserts `> 0`, and leftover mutations only
help it) but it is the same shape, and converting it keeps one mechanism in the file rather than
two.

### 4.4 Repro and mutation check

- **(a) Repro:** change `waitForTimeout(300)` to `waitForTimeout(0)`. The grid is then guaranteed
  mid-convergence and `subRowMutations` is non-zero every run — the loaded-machine condition,
  supplied deterministically.
- **(b)** Apply the fix with no sleep at all before it (the helper's own quiet wait replaces it) and
  it must pass, repeatedly.
- **(c) Mutation check:** change the fixed version's delta from 4 to 40 (past the 28px row height).
  It must report a non-zero count. That proves the observer window is live and would catch a real
  sub-row-mutation regression rather than silently measuring nothing. Revert to 4.

### 4.5 Same-file sweep

- **`:504`, §5 ("at rest, the mounted row band covers the viewport"):** `waitForTimeout(100)` then a
  one-shot lower-bound assertion on coverage. Same defect class — an unfinished convergence makes
  the band too short and the assertion fail. **In scope.** Fix with `expect.poll` on the coverage
  measurement (the idiomatic Playwright answer for a lower bound after a settle), not with the
  mutation helper: the quantity is a bound, not an event count.
- **`:478`-`491`, §4 (cell count stays under 2500 across a velocity ladder):** fixed sleeps too, but
  the assertion is an **upper** bound. Waiting *longer* would mount more cells, so a quiescence
  precondition would make it stricter than it was ever written to be, and the current sleeps are the
  lenient side of the bound. **Deliberately left alone**; changing it would be a new requirement
  smuggled in under a flake fix.
- `:341`'s other `waitForTimeout` calls (`:360`, `:416`) precede auto-retrying `expect`s. Left.
- The two `150ms sandbox gate` tests (`:907`, `:1013`, three `performance.now()` measurements
  between them) are genuine wall-clock assertions and already live in the serial `ui-timing` project
  by title. Out of scope, correctly placed.

---

## 5. Flake 4 — `commit-meta-clamp.spec.ts`, a real harness race

### 5.1 What fails

`apps/kira-studio-vscode/tests/interaction/commit-meta-clamp.spec.ts:30`-`48`, the first test in the
file. Every assertion in it auto-retries, so machine speed alone cannot fail it — which is the clue
that something other than slowness is wrong. ~4/12 full-webview-suite runs under load; confirmed
present on the pre-`eab3047e` baseline, so unrelated to P79.

### 5.2 Root cause — measured, not inferred

`tests/interaction/support/commitMetaHarnessServer.ts` builds the harness with Vite at test time and
serves the result off disk:

- `:18` — `const OUT_DIR = resolve(__dirname, 'dist');` a **fixed, shared** path.
- `:38`-`:39` — `outDir: OUT_DIR, emptyOutDir: true`.
- `:72` — every request is read from that same directory.

`startCommitMetaHarnessServer()` is called from `test.beforeAll` (`:22`-`:24`), and the
`webview-interaction` project sets `fullyParallel: true`
(`apps/kira-studio-vscode/playwright.config.ts:54`-`62`). Under `fullyParallel`, Playwright
distributes the file's six tests across workers, and `beforeAll` runs **once per worker** — so N
workers run N concurrent Vite builds into one directory, each of which empties it first. A worker
whose page is fetching `/harness.js` while a sibling's build is in its wipe-and-write phase gets a
404. The HTML shell loads, the module never does, nothing mounts, and `.kv-meta-subject` never
becomes visible. The first test in the file is the most exposed because builds finish staggered.

Reproduced directly in this session, outside Playwright: start one harness server, poll
`GET /harness.js` in a loop, then start a second server (a second worker's `beforeAll`).

```
{ good: 20, bad: 42, statuses: [ [ 200, 20 ], [ 404, 42 ] ] }
```

42 of 62 requests 404ed while the second build ran. This is the mechanism, and it is a defect in the
harness, not in `CommitMeta.vue` or `DetailPane.vue`.

Only this one server builds at test time. Its sibling (`tests/interaction/support/server.ts:23`)
serves the pre-built `dist/ui` that `bun run build:vscode` produced before the suite started, and is
read-only — so no other spec in either project has this hazard.

### 5.3 The fix — never touch shared disk

Build with `write: false` and serve the Rollup output from memory. That removes the shared resource
rather than partitioning it, is faster (no disk I/O), and leaves nothing behind to be emptied by
anyone:

```ts
const result = await viteBuild({ ...same config..., build: { ...same..., write: false } });
const outputs = Array.isArray(result) ? result[0].output : result.output;   // narrow RollupOutput
const files = new Map<string, string | Uint8Array>();
for (const o of outputs) files.set('/' + o.fileName, o.type === 'chunk' ? o.code : o.source);
// A silent rename in the Vite config must not degrade into a 404 at request time.
for (const required of ['/harness.js', '/harness.css']) {
  if (!files.has(required)) throw new Error(`commit-meta harness build produced no ${required}`);
}
```

The request handler then serves from `files` (404 only for a genuinely unknown path), and `OUT_DIR`,
`emptyOutDir` and the path-containment guard at `:71`-`:76` all go away with the directory. Delete
the now-stale `dist` comment at `:16`-`:17`. The existing `dist/` directory on disk is gitignored
and can be left; the implementer may remove it as a courtesy, in the same commit.

Rejected alternatives, briefly: a per-worker `dist/<TEST_WORKER_INDEX>` subdirectory works but keeps
N concurrent builds writing under one tree for no gain; `test.describe.configure({ mode: 'serial' })`
confines the file to one worker, which hides the hazard instead of removing it and makes the file's
later tests abort on an earlier failure.

### 5.4 Repro and mutation check

- **(a) Repro:** the script above (two concurrent `startCommitMetaHarnessServer()` calls, polling
  `/harness.js` from the first) — it is deterministic and takes seconds. Keep it in the scratchpad,
  do not commit it. End-to-end confirmation:
  `playwright test --config=apps/kira-studio-vscode/playwright.config.ts --project=webview-interaction
  commit-meta-clamp.spec.ts --workers=6 --repeat-each=4`.
- **(b)** Both must be clean after the fix: zero non-200 responses in the script, zero failures in
  the repeated run.
- **(c) Mutation check:** this fix guards infrastructure, not behaviour, so the check is that the
  tests still *can* fail — temporarily break the harness entry's mount (e.g. render nothing) and
  confirm the six tests fail rather than pass vacuously against a stale or empty document. Revert.

**Confidence note, stated plainly.** §5.2's mechanism is measured, but the failure *text* P79
observed was not captured. Before fixing, run (a) and confirm the Playwright failure is the expected
one — a timeout on `.kv-meta-subject` / a 404 for `/harness.js` in the page's console. If it turns
out to be a different assertion failing for a different reason, follow that evidence instead; the
build race is real regardless and its fix still lands, but the phase would then have a fifth item.

### 5.5 Same-file sweep

All six tests in the file share the one `beforeAll` server, so all six carry the same exposure and
all six are fixed by the same change. None of them contains a timing assertion of its own.

---

## 6. Structurally identical assertions in other files

The trap the SPEC row names is fixing one assertion and leaving its twin. Two exist outside the four
named tests, both "assert an absence immediately after an action, inside a live 150ms debounce":

- **`http-curl.spec.ts:133`-`150`** — "the curl preview is debounced, not re-lexed on every
  keystroke": types 35 characters, then `await expect(summary).toHaveText('')`. The debounce is
  `ImportCurlDialog.vue:21`-`28`, 400ms, restarted per keystroke. Same shape as §3, with a wider
  window; `toHaveText('')` auto-retries but the summary never returns to empty once populated, so a
  mid-typing fire fails it outright. **In scope** — same fix, same helper.
- **`mode-switch.spec.ts:185`-`206`** — "switching mode reaches windowsSetMode eventually, never
  synchronously": one click, then `expect(setModeCalls()).toHaveLength(0)` against
  `MODE_WRITE_DEBOUNCE_MS = 150` (`state/mode.ts:26`). Only one action, so the exposure is two CDP
  round trips rather than twenty — much smaller, but the same category, and a loaded click with
  actionability checks can spend 150ms. **In scope**, two lines with the same helper.

Not in scope, checked and left: `sql-schema.spec.ts:501`'s `waitForTimeout(300)` is explicitly "no
debounce to wait out — this is asserting an absence" with no timer racing it;
`autocomplete.spec.ts:1015`-`1017` waits *past* a debounce rather than inside one.

---

## 7. New shared helpers

### 7.1 `apps/kira-studio/tests/ui/support/clock.ts` (new)

One export, `installFakeTimers(page)`, a thin wrapper over `page.clock.install()`. It exists for the
doc comment, so the one non-obvious constraint is written once instead of re-derived at three call
sites: **install after `relaunch()` has booted the page, never before it** — `relaunch()` navigates
and waits for `[data-testid="status-bar"]`, and timers frozen across boot can stall that wait.
Record there too that the control transport is `page.route`-based and so unaffected, and that
already-scheduled native timers keep running on real time (which is what makes a mid-test install
safe).

Callers advance time with `page.clock.runFor(ms)` directly — no wrapper; the Playwright API is the
clearer thing to read at the call site.

### 7.2 `mutationsForScroll` in `apps/kira-studio/tests/ui/support/grid.ts`

```ts
export function mutationsForScroll(
  viewport: Locator,
  deltaPx: number,
  opts?: { quietFrames?: number; timeoutMs?: number },
): Promise<number>
```

One `page.evaluate`, in this order: wait until the element's subtree has produced **no** mutation
records across `quietFrames` consecutive animation frames (default 6 — `LEAD_FRAMES`, the file's own
convergence horizon), throwing a named error after `timeoutMs` (default 10_000); arm a fresh
`MutationObserver` with `{ childList: true, subtree: true, attributes: true }`; apply
`el.scrollTop += deltaPx`; await a double `requestAnimationFrame`; disconnect; return the record
count. Identical counting semantics to the code it replaces, so the assertions are unchanged.

---

## 8. What does not change

`apps/kira-studio/playwright.config.ts` is untouched. After §2 the cell-editor test has no
wall-clock term, so `wallClockBudgetTitles` (`:9`) still names exactly the four tests that do, and
the `ui` / `ui-timing` split stays as P27 built it. `apps/kira-studio-vscode/playwright.config.ts`
is untouched too — §5.3 makes `fullyParallel: true` safe rather than giving it up.

No application code ships in this phase. `CellEditorView.vue`, `GrpcRequestView.vue`,
`kiraSlickGrid.ts` and `CommitMeta.vue` are all edited *temporarily* for the §1(c) mutation checks
and reverted; the diff must contain none of them.

---

## 9. Verification

Per fix, in order: §1(a) repro fails deterministically → fix → same conditions pass → §1(c) mutation
check fails as designed → revert the mutation. Only then move to the next fix.

Then, once all five commits are in:

1. `bun run typecheck` — all 5 TS sub-projects. `biome check .` — expect only the known pre-existing
   `UncommittedChangesStrip.vue` info finding.
2. `bun run test:ui`, **3 consecutive full runs**. The four `ui`-project tests touched here must be
   green in all 3, with no new failures elsewhere. Report counts, not "passed".
3. `bun run test:webview`, **6 consecutive full runs** — the flake rate was ~4/12, so 6 clean runs is
   the minimum that says anything, and the §5.4(a) script is the real evidence.
4. Targeted repetition:
   `playwright test --config=apps/kira-studio/playwright.config.ts --project=ui --repeat-each=10
   -g "cell editor — autodetect|debounces schema loads|eight sandbox-provable|curl preview is
   debounced|reaches windowsSetMode"`.
5. Corroboration, not primary evidence: repeat (2) with every core saturated
   (`for i in $(seq $(nproc)); do (while :; do :; done) & done`, killed after). Stated honestly in
   the phase result as corroboration — a load run that happens to pass proves less than §1's
   deterministic repros, which is exactly why they come first.

---

## 10. Commits

Conventional Commits, one per fix, each landing with its own repro/mutation evidence in the message.

1. `test(ui): assert the cell editor reuses its Monaco instance instead of timing the switch`
   — `cell-editor.spec.ts` (§2.4).
2. `test(ui): drive the gRPC schema-load debounce with a fake clock`
   — new `support/clock.ts` (§7.1) plus `grpc-request.spec.ts` (§3.3).
3. `test(ui): wait for the grid to go quiet before counting sub-row mutations`
   — `support/grid.ts` (§7.2) plus `slick-grid.spec.ts` §3/§3-cross/§5 (§4.3, §4.5).
4. `fix(test): serve the commit-meta harness from memory, not a shared build directory`
   — `commitMetaHarnessServer.ts` (§5.3). `fix(test):` rather than `test:` — this one repairs
   broken infrastructure, it does not change what a test asserts.
5. `test(ui): drive the curl-preview and mode-write debounces with a fake clock`
   — `http-curl.spec.ts`, `mode-switch.spec.ts` (§6).

Commit 2 must precede commit 5 (5 uses 2's helper). The rest are file-disjoint and order-free.

## 11. One pass, one subagent

One sequential Sonnet subagent. The work is five small, file-disjoint edits, but it is not
parallelizable in any useful sense: commits 2 and 5 share `support/clock.ts`, and the §1 discipline
(repro, fix, mutation check, revert) is one continuous loop per fix that a second subagent would
have to be handed wholesale anyway. Expensive verification (§9 steps 2-5) runs once at the end, per
`CLAUDE.md`; steps 1's typecheck/lint are cheap and run per commit through the pre-commit hook.

Size: 6 test/support files, one new 20-line helper file, one harness-server rewrite of ~40 lines, no
application code, no contract bump, no new dependency (`page.clock` ships with the pinned
`@playwright/test`).

## 12. Dogfooding note

The repo-map MCP server's tools were not reachable for this planning pass — the same constraint P75
§10, P76 §14, P77 §19 and P78 §13 each recorded, and `CLAUDE.md`'s own step-3 caveat: this is a
subagent session and the tool manifest is fixed at session start. Navigation was done with
Grep/Glob/Read, plus one throwaway Node script for §5.2's measurement.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.
