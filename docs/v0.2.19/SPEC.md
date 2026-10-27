# v0.2.19

First phase `P365` (highest in `HISTORY.md` is `P364`). Branch `chapter/v0.2.19`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P365 | CI resilience. Bound the apt step in `.github/actions/setup/action.yml` (`-o Acquire::Retries=3 -o Acquire::http::Timeout=30`, step timeout) after `ui (Linux, shard 4/4)` hung twice on a `libwebkitgtk-6.0-4` download (PR #13). Retry every transient fault that a later run could clear: network fetches in setup and test steps (apt, bun/npm install, Go module download, Playwright browser download), and rerun `cancelled` runs caused by a timeout in `pr-rerun-flaky.yml` (still never a superseded run; the head-SHA guard covers that). Workflow files cannot be pushed from this session: use `docs/pending-changes/` / `docs/pending-workflows/` per `docs/DEV_ENVIRONMENT.md`. | Done |
| P366 | ADE page design pass. Too many textures, patterns and fonts; make surfaces, type and spacing uniform. Redo the branch tooltips, still ugly, using the plan's color coding. | Done |
| P367 | SQL diff broken: output almost entirely truncated. Root-cause and fix. | Done |
| P368 | Move reviews between columns on the planning board. | Pending |
| P369 | Review window header: merge title bar and second bar into one title bar. Remove the sync-to-GitHub button and its functionality entirely (frontend, bridge, backend, docs). | Pending |
| P370 | Review window: dropdown with GitHub's review actions (approve, comment, request changes), like the GitHub VS Code extension. Add PR-level comments, sent to the PR. | Pending |
| P371 | Review comment dialog resizes and fits the available space. Hunk checkmark must not move when the add-comment mark appears on hover. | Pending |
| P372 | Code review, 1 round, over the full diff since the base (see CLAUDE.md). | Pending |
| P373 | Close chapter, open PR. | Pending |

## P365 Result

Plan: `plans/P365.md`. Direct: `retry` in `scripts/lib.sh` (used by `pull_images`, `setup.sh`, `install-golangci-lint.sh`, `pull-test-images.sh`), `scripts/retry.sh`, `scripts/ci-apt-install.sh` (apt conf with retries and timeouts, per-attempt `timeout`, drops the first mirror between rounds), `.github/actions/setup/action.yml` (apt via the script, retried `go mod download` on cache miss), `docs/PACKAGING.md` section 7.

Pending patches in `docs/pending-changes/` (apply from a Mac session, then delete): `.github__workflows__pr.yml.patch` (step timeouts, retried Playwright install), `.github__workflows__pr-rerun-flaky.yml.patch` (reruns a cancelled run only when a job hit its timeout; newest-run guard), `.github__workflows__pages.yml.patch` (job timeouts).

Checked: `sh -n` on all scripts, `yq` parse, `git apply --check` on all three patches, local `retry.sh` runs (exit 0, 124 on timeout, 1 after 3 attempts). `ci-apt-install.sh` verified by CI only.

## P366 Result

Plan: `plans/P366.md`. Scope: shell top bar, Plan tab, four panel spots; Backlog, Needs and Workflows editor untouched.

Uniform set: flat token surfaces (card is `Card` `section`, `bg-chrome` only for weekend and day off), no textures, shadows, dashed borders or tint washes, no italic or extrabold, `font-medium` on entity names only, density-scale spacing, codicons instead of glyph icons, state by rail, border, outline or chip colour. Step label and tag use `AdeChip`.

Branch tooltip: new `TooltipContent` `surface` variant and `AdeBranchTip`, one per branch row and tag chip, in the plan colours (work-colour dot, repo chip, tag chip in tone, base marker with parent colour, progress, merged and deployed). Default tooltips render branch chips neutral (`data-chip="branch"`). `BaseMarker.color` and `TextPart` branch `variant` added.

Labels lost leading glyphs (`en.json`); five duplicate ADE keys deleted in favour of existing ones. Guards: U105 bans repeating gradients, U11 covers extrabold and black, ADE U88 exemptions removed. Docs: `ARCHITECTURE.md` density, tooltip and Plan lines.

Baselines: `plan-branches-stacked`, `-review`, `-pending`, `branch-panel-details` (label text changed), new `plan-branch-tip`, `plan-branch-plain-tip`; space screenshots and site visual baselines refreshed (git-graph, memory and studio shots also drifted). Checked: unit 1957 pass, space `ui` 695 pass, space `visual` 20 pass, screenshots rerun clean, `site:check` green after baseline refresh, lint, lint:dead, typecheck via hooks.

## P367 Result

Plan: `plans/P367.md`. Diff is the SQL data view's pending-changes diff (`PreviewCommandPanel` Changes view, `MonacoDiff`). Data was whole; rendering collapsed.

Root cause: `MonacoDiff` root is `h-full min-h-40`; the caller's `h-60` lost to `h-full`, and `h-full` under a parent with only `max-height` is `auto`, so Monaco's `height: 100%` diff root measured 0 px.

Fix: `MonacoDiff.vue` mounts Monaco on an inner `absolute inset-0` host; `PreviewCommandPanel.vue` sizes it with an `h-60` wrapper; `ARCHITECTURE.md` fact. `mutations.spec.ts` scenario 1b asserts the modified line is visible and `.monaco-diff-editor` is taller than 200 px (failed with 0 before the fix).

Checked: studio `ui` `mutations.spec.ts` and `cell-editor.spec.ts` pass, `build:test:space` builds, lint:dead, typecheck and lint via hooks. No Space spec or visual baseline covers `MonacoDiff`.
