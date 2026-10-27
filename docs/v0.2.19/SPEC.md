# v0.2.19

First phase `P365` (highest in `HISTORY.md` is `P364`). Branch `chapter/v0.2.19`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P365 | CI resilience. Bound the apt step in `.github/actions/setup/action.yml` (`-o Acquire::Retries=3 -o Acquire::http::Timeout=30`, step timeout) after `ui (Linux, shard 4/4)` hung twice on a `libwebkitgtk-6.0-4` download (PR #13). Retry every transient fault that a later run could clear: network fetches in setup and test steps (apt, bun/npm install, Go module download, Playwright browser download), and rerun `cancelled` runs caused by a timeout in `pr-rerun-flaky.yml` (still never a superseded run; the head-SHA guard covers that). Workflow files cannot be pushed from this session: use `docs/pending-changes/` / `docs/pending-workflows/` per `docs/DEV_ENVIRONMENT.md`. | Done |
| P366 | ADE page design pass. Too many textures, patterns and fonts; make surfaces, type and spacing uniform. Redo the branch tooltips, still ugly, using the plan's color coding. | Pending |
| P367 | SQL diff broken: output almost entirely truncated. Root-cause and fix. | Pending |
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
