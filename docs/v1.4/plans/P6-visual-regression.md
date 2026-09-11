# P6 — Visual regression testing across pages and modules

> **What this phase is.** `docs/v1.4/SPEC.md`'s P6 row, turned into concrete steps from direct
> research against the real tree (Playwright configs, CI matrix, font/animation inventory, the
> existing ink-measurement precedent) plus this session's own real `bun run test:ui` timing run.
> **Session override, this chapter only** (same as P1/P3/P4/P5): plan and implementation both done
> by the orchestrating session directly, not a Sonnet implementer subagent.

## 0. Tool decision: Playwright's own `toHaveScreenshot`

**Confirmed: zero pixel comparison exists anywhere in this repo today.** `grep -rn
"toHaveScreenshot|toMatchSnapshot|snapshotPathTemplate"` returns only SPEC's own P6 row and two
prior plans' doc comments. Exactly two raw `.screenshot()` calls exist: `smoke.spec.ts:39` (written
to `test-results/`, gitignored, never compared) and `mode-switch.spec.ts`'s own ink-bounds
measurement (P22 D5) — which explicitly declined pixel-diffing in favor of an in-page canvas
measurement specifically to avoid a new dependency. `toHaveScreenshot` costs nothing on that same
axis: `@playwright/test` 1.62.1 is already a dependency, and the API (`animations`, `caret`,
`stylePath`, `mask`, `maxDiffPixelRatio`) exists in the installed version.

**AGENTS.md's "fully open-source" rule** (its own §92-96) is, read literally, a *library license*
policy ("Applies to every new dependency") — it does not name services or CI infrastructure, so it
does not strictly forbid a hosted visual-diff SaaS the way it forbids an Enterprise-gated npm
package. The sharper, directly-applicable reason to decline one anyway: **`AGENTS.md`'s own
"`.github/workflows/` changes can't be pushed from here" section** — this session's push credential
has no `workflow` scope, so any CI wiring a hosted service needs (a new job, a repo secret, an
upload step) cannot be committed directly; it has to ship as a `docs/pending-changes/*.patch` file
for the user to apply by hand (§7 below). A hosted service would need that same patch-and-wait cycle
**plus** a separately-provisioned account/API key/secret the user must also set up out of band —
two rounds of external dependency where the in-repo approach needs one (the CI patch alone, and
only for the "gate it in CI" half — the tier itself works with zero CI change, §1). Baselines staying
in-repo (git-diffable PNGs, no external account, no network call in CI) is also the more direct
continuation of `mode-switch.spec.ts`'s own precedent, and of this repo's total absence of any
outbound telemetry/third-party service dependency anywhere else in the stack.

One more standing statement worth addressing rather than leaving for a reviewer to find:
`AGENTS.md`'s Wails section states `//go:build server` is "preferred over `xvfb`/`xdotool`/
screenshot techniques" for **sandbox boot proofs** — a different problem (proving a GUI app boots
in a session with no display) than a CI-side pixel-diff test tier running against a real, installed
WebKit. Not in tension with this phase.

**Decision: `expect(page).toHaveScreenshot()`, in a new Playwright project, no new dependency.**

**Suite cost, measured, not estimated** (AGENTS.md's own "measure when there's a real, concrete
question" bar — "how expensive is the tier this phase sits after" is exactly that question, and
P1 itself left it unmeasured): `bun run test:ui` (`ui` + `ui-timing`, 252 tests) runs in **5m4s**
wall clock in this container (4 cores, no Docker, real WebKit) — measured live during this phase's
own planning pass, filling the gap P1's own §5 left open ("no working frontend build in this
container to run Playwright against"), now recorded in `docs/PERF.md` §5. Five new `visual` boots
(§3) each paying one more full-app launch on top of that is a small, known addition to a known
number, not a step into the dark.

## 1. A new project, `visual` — not folded into `ui`

Mirrors the repo's own precedent for "a different measurement contract than `ui`'s own DOM/geometry
assertions earns its own project" — `ui-timing` was already split out of `ui` for exactly this
reason (real-millisecond wall-clock assertions need CPU contention control `ui`'s own 100%-worker
parallelism would break). A pixel-diff test has a different contract again: it doesn't care about
CPU contention (screenshot comparison isn't a timing assertion), but it does need its own directory
(new baselines shouldn't live beside `ui`'s DOM-assertion specs) and its own default `expect`
config (§2). New `testDir: './tests/visual'`, new spec files, reusing `tests/ui/support/*`'s
existing fixtures/mock harness by import (the built bundle and the two mocked wire planes are
identical infrastructure — no duplication, `tests/visual/fixtures.ts` re-exports `tests/ui/
fixtures.ts`'s `test`/`expect` with the added screenshot defaults from §2). `browserName: 'webkit'`,
matching `ui`'s own choice (the real target renderer, WKWebView on macOS / WebKitGTK on Linux) —
`tests/e2e-real`'s Chromium choice is for a different reason (D5's "a wiring tier, not a
UI-fidelity one") that does not apply here. `fullyParallel: true` — no `dependencies: ['ui']` edge:
unlike `ui-timing`, nothing about a screenshot comparison degrades under contention.

## 2. Containment — three measures, each addressing SPEC's own named risk directly

**(a) CI-Linux-only baseline authority — the load-bearing one.** Confirmed from `ci.yml`: `tests/
ui/` already runs on exactly one CI platform, `ubuntu-latest` (the `ui` job); the macOS jobs
(`checks`, `package-smoke`) run zero browser tests. So a single Linux baseline set already gates
everything CI runs today — this is not a new constraint P6 invents, it is already true of `ui`, and
`visual` inherits it for free. The one new rule this phase adds: **a baseline PNG is only ever
captured or updated from the `ui` job's own environment** (`ubuntu-latest`, the exact
`bunx playwright install webkit` + apt-package set `ci.yml:88-91` already installs) — never from a
developer's local `bun run test:visual -- --update-snapshots` on macOS (WKWebView renders different
glyph hinting/antialiasing than WebKitGTK, independent of font choice). Documented as a doc comment
on the new `visual` project entry and in `tests/visual/README.md` (§6), the same "policy stated
where the next person will actually read it" convention `runner_test.go`'s own doc comments already
follow elsewhere in this codebase.

**(b) Animation freeze — Playwright's own built-in, not new machinery.** Full inventory of
`infinite` animations found (`p-spin`/`ops-spin`/`spin`/`pulse`/two `kv-*-spin` rules/one imported
`codicon-spin`) — all state-gated (a running query, an in-flight op, a connecting status dot), never
unconditionally on at rest, but real: a `visual` spec that happens to render one of those states
mid-transition would capture a moving target. `toHaveScreenshot`'s own `animations: 'disabled'`
option (present in 1.62.1) freezes every CSS animation/transition to its terminal frame before
capture — set as the new project's default (`expect: { toHaveScreenshot: { animations: 'disabled'
} }`), not per call site, so no spec has to remember to set it. Zero new CSS, zero new
`prefers-reduced-motion` plumbing (confirmed absent from the app entirely) — this is Playwright
doing the job already built for it.

**(c) Font-stack collapse — a small test-side stylesheet, not a build flag.** Confirmed: two font
stacks diverge cross-platform, not the one SPEC names — `--kira-font-ui` (`-apple-system,
BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif`) *and*
`--kira-font-data` (`Menlo, monospace` — the schema default `tests/ui/support/bootSnapshots.ts`'s
mocked settings response already answers with, and Menlo does not exist on the Ubuntu runner, so it
already silently falls through to fontconfig's own monospace substitution today). Given (a) already
makes the baseline authority a single, real, consistent CI image, the actual remaining risk isn't
"two different real machines disagree" (that's what (a) removes) — it's **that same CI image's own
fontconfig resolving a multi-hop fallback chain non-deterministically run to run** (a genuine, if
lower-probability, risk a two-or-more-candidate cascade can have that a single named face doesn't).
Cheapest fix that matches this codebase's own "the mocking of the wire planes is entirely test-side,
never build-side" precedent (`tests/ui/support/mockRuntime.ts`/`mockStream.ts` — no
`VITE_TEST_MODE`, no build-time branch exists anywhere in `frontend/src` today, confirmed): a small
`tests/visual/support/pin-fonts.css` collapsing both custom properties to their own trailing generic
keyword only —

```css
:root {
  --kira-font-ui: sans-serif;
  --kira-font-family: monospace; /* --kira-font-data is var(--kira-font-family), tokens.css:123 */
}
```

— loaded via `toHaveScreenshot`'s own `stylePath` option, scoped to the `visual` project only (never
touches `ui`'s own font-role assertions, `font-roles.spec.ts`, which specifically wants to see the
*real* configured stacks resolve, not a collapsed one). No new binary font asset, no `@font-face`,
no vite/build change — confirm `stylePath`'s exact accepted shape (per-call array vs. project-level
`expect` default) against the installed 1.62.1 docs at implementation time; either shape reaches the
same file.

**Explicitly not done, and why (§9 states this is the deliberate "measure, don't ritual" call):** a
bundled/self-hosted pinned web font. (a) already makes the baseline machine one real, known image;
(c) already removes the multi-hop-fallback ambiguity within that image. A bundled font would only
buy more visual fidelity to what a real user's Mac renders, which is not this tier's job (`ui`'s own
DOM/geometry assertions plus `font-roles.spec.ts`'s custom-property-resolution check already cover
"is the right *token* wired up"; `visual`'s job is "did this pixel state regress since last time",
which needs stability, not source fidelity). Revisit only if real flakiness is observed in practice.

**Viewport**: no new decision — `tests/ui/fixtures.ts`'s existing `setViewportSize({width: 1440,
height: 960})` already runs on every boot every `visual` spec reuses via the shared fixture (§1).

**Diff threshold**: left at Playwright's own default (`maxDiffPixelRatio`/`threshold` unset) for
this landing — tuning it preemptively with no observed false-positive rate would be exactly the
"measure … not as a default ritual" AGENTS.md warns against. If CI produces a real flaky diff once
this runs for real, that failure is the concrete question to measure against, and the fix (a looser
ratio, or narrowing a spec's own capture region with `clip`) lands then.

## 3. Which surfaces get baselines — a bounded first set, not "every page"

SPEC's own title says "across pages and modules"; its own body immediately narrows that to "the
exact failure class a visual tier catches has already bitten this repo once" (G16's collapsed graph
panel) — the deliverable is catching *that* class cheaply, not exhaustive per-surface coverage on
day one. Five specs, one canonical at-rest screenshot each, chosen from the survey below:

1. **`tests/visual/workbench.spec.ts`** — the full workbench shell at rest, every chrome region
   visible (tree, tab strip, status bar, operations panel collapsed). Converts `smoke.spec.ts:39`'s
   existing uncompared screenshot into the first real baseline — that call already proves the
   harness can capture a stable full-page shot; this phase is where it starts being compared.
2. **`tests/visual/data-view.spec.ts`** — the data grid at rest on a representative table (a handful
   of rows, mixed column types, no scroll/edit in progress) — SlickGrid's own canvas-adjacent
   rendering is exactly the class of thing `slick-grid.spec.ts`'s DOM/geometry assertions can prove
   *present* without proving *correct-looking*.
3. **`tests/visual/console.spec.ts`** — the SQL console at rest with syntax-highlighted content
   (CodeMirror's decoration/theme layer — no existing spec asserts what a colored token actually
   renders as, only that completion/format/explain *behave* correctly).
4. **`tests/visual/connection-dialog.spec.ts`** — the three-tab connection dialog at rest — the
   densest single "form" surface with the most token/spacing/icon-alignment surface area per pixel.
5. **`tests/visual/schema-dialog.spec.ts`** — the Schema (DDL) editor at rest — P3/P4 both touched
   this surface's own formatting/completion this chapter; a pixel baseline is cheap insurance against
   a future phase's edit to the same file regressing its layout silently.

**Explicitly deferred, not attempted** (§9): the Api-mode surfaces (`collections`/`http-*`/
`grpc-request`, 12+ spec files) — each is a form-shaped surface the same geometry assertions already
cover adequately, and none has a G16-class "renders wrong but every check passes" history the way
the grid/console/dialogs do; `api-ui-consistency.spec.ts`'s own 32 tests — flagged in research as
"the single best candidate for wholesale reinforcement by pixels," genuinely true, but a 32-test
survey is a follow-up phase's scope, not this bounded landing's; the boot-consolidation cluster P1
§7 already named (`control-sizing`/`font-roles`/`workbench`/`row-coloring`/`tooltips`, 14 tests/14
boots) — real overlap with `visual`'s own workbench baseline, but *merging* those five files is P1's
own deferred item, not this phase's to absorb.

## 4. The extension tier (`apps/kira-studio-vscode`) — out of scope for this phase

Two independent reasons, either alone sufficient: **no CI job runs `apps/kira-studio-vscode/tests/`
at all today** (confirmed — `test:webview` appears in zero `.github/workflows/ci.yml` steps), so a
baseline set there would have no CI gate to run against, the same "unguarded tier" problem (a) above
exists specifically to avoid; and the webview's own theming is fundamentally different —
`packages/git-ui/src/theme/vscode-tokens.css` derives its whole palette from `var(--vscode-*,
<fallback>)`, meaning a Playwright-harness baseline (no real VS Code host setting those custom
properties) only ever captures the **fallback** theme, never a real user's actual VS Code theme —
a materially different problem (which theme to baseline against) than the main app's single
hard-coded dark palette (§9's own confirmation: no theme toggle exists, `index.html`'s `class="dark"`
is static, P38's five-theme plan was explicitly skipped). Candidate for its own later phase, once a
CI job exists for `test:webview` and a theme-fixture strategy is decided — neither is this phase's
job to invent speculatively.

## 5. Package scripts

```json
"test:visual": "bun run build:test && playwright test --config=apps/kira-studio/playwright.config.ts --project=visual",
"test:visual:update": "bun run build:test && playwright test --config=apps/kira-studio/playwright.config.ts --project=visual --update-snapshots"
```

Mirrors `test:ui`'s own two-step shape exactly (build the test bundle, then run Playwright against
it) — no new build target, `build:test` is already the right one (§0 confirmed no build-time
branch is needed for anything in §2).

## 6. `tests/visual/README.md` — the policy doc-comment §2(a) promises

One short file, the same job `docs/v1.4/plans/`'s own discipline serves at a smaller scope: states
in one place, for whoever next touches this tier, that a baseline is regenerated only via
`bun run test:visual:update` run inside the `ui` CI job's own environment (or a container that
matches its `ubuntu-latest` image and installed package set byte-for-byte) — never from a local
macOS `bun run test:visual:update` — and that a failing `visual` run's `test-results/` directory
(actual/expected/diff PNGs, Playwright's own default on a screenshot mismatch) is the first thing to
look at, before assuming a genuine regression.

## 7. CI wiring — staged as a patch, never committed directly

`AGENTS.md`'s own "`.github/workflows/` changes can't be pushed from here" rule: this session's push
credential lacks the `workflow` scope, so `.github/workflows/ci.yml` cannot be edited directly from
here. Per that section's own documented mechanism, write the intended diff as
`docs/pending-changes/.github__workflows__ci.yml.patch` — a minimal addition to the existing `ui`
job (same runner, same already-installed WebKit/apt packages, no new job needed): one more step,
`bun run test:visual`, placed after the existing `bun run test:ui` step, and widening the existing
`playwright-report/` failure-artifact upload (`ci.yml:95-99`) to also capture `test-results/` (where
a screenshot mismatch's actual/expected/diff PNGs land) — `path: |\n  playwright-report/\n
test-results/`. One-line note at the top of the patch file explaining why (the same convention
AGENTS.md's own example shows), and this phase's own commit message says explicitly that a
`docs/pending-changes/` entry still needs the user to apply it — this phase's own git history is the
record, not a separate tracking note.

## 8. `docs/ARCHITECTURE.md` corrections while in this territory

Confirmed stale, both real defects per `docs/v1.4/README.md`'s "authoritative for current behavior"
rule, not housekeeping: the `## Testing` section's `tests/ui/` paragraph states "72 tests across 25
spec files" (real count today: ~266 across 47 files) and its own closing **Parallelism** paragraph
says `playwright.config.ts` runs three projects (real count: four — `ui-timing` was added at P27,
after that paragraph was last touched). Correct both numbers in the same pass, and add one line for
the new `visual` project alongside `ui`/`ui-timing`/`ipc-frontend`/`e2e-real`'s own existing
one-liners.

## 9. Explicitly out of scope

- **A hosted visual-diff service.** §0's own closing argument — not ruled out by AGENTS.md's literal
  wording, but a strictly worse cost/dependency shape than the in-repo approach for this repo's own
  constraints (the workflow-push restriction applies to CI wiring either way; a hosted service adds
  an external account/secret on top).
- **A bundled/self-hosted pinned web font.** §2(c)'s own closing argument — CI-Linux-only baseline
  authority plus the single-hop generic-keyword collapse already remove the ambiguity SPEC names;
  a bundled font buys fidelity to a real user's Mac, which is not what this tier checks.
- **The `apps/kira-studio-vscode` webview tier.** §4 — no CI job exists for it at all, and its
  VS-Code-theme-following design is a different, unresolved problem (which theme to baseline).
- **Api-mode surfaces and `api-ui-consistency.spec.ts`'s own 32-test survey.** §3's own deferral —
  real value, correctly out of this bounded landing's scope.
- **Tuning `maxDiffPixelRatio`/`threshold` preemptively.** §2's own closing note — no observed flake
  rate exists yet to tune against.
- **Merging the P1 §7 boot-consolidation cluster into `visual`'s own boots.** Real overlap, but a
  distinct, already-tracked deferred item on `docs/v1.4/plans/P1-test-suite-speed.md`'s own phase —
  not this phase's to absorb without re-opening that plan.

## 10. Testing and verification

The tier's own baselines ARE its test coverage — there is no separate "test the visual tests"
layer beyond confirming the harness end to end. In this session: `bun run build:test`, then
`bun run test:visual:update` once against this sandbox's own installed WebKit (the same
`bunx playwright install webkit` + apt package set `ci.yml:88-91` specifies, already present in
this container from earlier phases' own setup) to generate the five initial baseline PNGs, committed
alongside their specs (Playwright's own default co-located `<spec>-snapshots/` directory, confirmed
not gitignored). Then `bun run test:visual` (no `--update-snapshots`) to confirm the just-captured
baselines pass against themselves on a second, independent run — proving the mechanism, the
animation freeze, and the font collapse are all actually wired, not merely present in config.
`bun run typecheck`/`bun run lint` over the new spec/support files, same as every other phase.
State plainly in this phase's own commit/summary that these five baselines were captured in this
sandbox, not the real `ui` CI job — per §2(a)'s own policy, the first real CI run of the staged
patch (§7, once the user applies it) is what actually establishes canonical authority for them; a
mismatch there on first run is expected housekeeping (re-capture from the real job), not a bug in
this phase's own work.
