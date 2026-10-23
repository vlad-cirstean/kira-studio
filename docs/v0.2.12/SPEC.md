# v0.2.12

First `P`: P330 (highest in `docs/HISTORY.md` is P329). Branch: `chapter/v0.2.12`. Tag: `v0.2.12`.

Decisions (user, 2026-10-23):

- CI runs on `pull_request` only. No `push: main` trigger.
- No tokens or PATs. Merge job dispatches `release.yml` via `workflow_dispatch`.
- `ci-gate` job and `scripts/release-ci-gate.sh` are dropped.
- Chapter branch is `chapter/v<semver>`; tag is the same name without `chapter/`.
- Workflow files can't be pushed from a Linux sandbox. Ship them as `docs/pending-changes/` and `docs/pending-workflows/` per `docs/DEV_ENVIRONMENT.md`.

| Phase | Title | Status |
|---|---|---|
| P330 | Branch naming, PR automation, release on merge | Done |
| P331 | Fix the release workflow | Done |
| P332 | Kira Space as default app for code and data files | Todo |
| P333 | DB MCP: prominent target database and response preview | Todo |
| P334 | Docker: restore running containers after an engine/VM restart | Todo |
| P335 | SQL grid: context-menu "Copy as" with multiple rows selected | Todo |
| P336 | Code review round 1 | Todo |
| P337 | Code review round 2 | Todo |

## P330: Branch naming, PR automation, release on merge

- Rename remote branches `v0.2.10`, `v2.0`, `v2.6`, `v2.8` to `chapter/<same name>`. Verify nothing references the old names.
- Add a `.githooks/pre-push` check: pushing a branch not named `main` or `chapter/v<semver>` fails with a clear message. Tag pushes pass. Decide how `claude/*` session branches are handled and state it plainly.
- `pr.yml`: drop `push: main`.
- New workflow: on PR opened or reopened, `gh pr merge --auto --squash`.
- New workflow: on `workflow_run` of `pr.yml` with conclusion `failure`, `gh run rerun --failed` while `run_attempt < 3`. Never retry `cancelled`.
- New workflow, on PR merged into `main` from `chapter/v<semver>`: derive tag from head ref, fail if tag exists, create tag at the merge SHA, dispatch `release.yml` with a `tag` input. `release.yml` keeps the manual tag-push trigger.
- `release.yml`: add `workflow_dispatch` with `tag` input; build/publish use that tag, not `GITHUB_REF_NAME`.
- Cache warming on `main` replaces the plan's D3 (release-saved caches): after each merge to `main`, a small job on `main` restores or builds the shared caches (Go modules and build caches per job kind, bun, wails3, bindings, tsbuildinfo, Playwright browsers) and saves them under `main`, so every PR restores from there. Dependency installs and compiles only, no tests. Started from the release-on-merge flow (a `GITHUB_TOKEN` merge starts no workflows, so it needs the same triggers).
- Document the GitHub settings the user must apply: allow auto-merge, ruleset on `main` requiring the `pr.yml` checks, ruleset restricting branch names.
- `CLAUDE.md`: chapter branch `chapter/v<version>`; user gives version at chapter start, else last tag with patch plus 1; chapter close phase also opens the PR; replace "No per-phase PRs" accordingly.
- `docs/DEV_ENVIRONMENT.md` and `docs/PACKAGING.md` §7: release flow.

Result: Remote branches `v0.2.10`, `v2.0`, `v2.6`, `v2.8` copied to `chapter/<name>` at identical shas. Rename API and branch delete return 403 through the session proxy, so the four old names remain on the remote; delete them by hand. `.githooks/pre-push` runs `scripts/check-push-refs.sh` first and refuses any branch but `main` and `chapter/vX.Y.Z` (no `claude/*` exemption); hook table passes and a `--dry-run` push to a bogus branch is refused. `scripts/release-on-merge.sh` added, `scripts/release-ci-gate.sh` deleted. Workflows staged: patches for `pr.yml` (drop push; also SC2046 fix) and `release.yml` (tag input, `tag` job, no `ci-gate`), new `pr-auto-merge.yml`, `pr-rerun-flaky.yml`, `release-on-merge.yml`, `cache-warm.yml` under `docs/pending-workflows/`. actionlint 1.7.7 clean on the applied result; shellcheck clean on both scripts; `cache-warm.yml` cache keys match `pr.yml` and the setup action. `CLAUDE.md`, `DEV_ENVIRONMENT.md`, `PACKAGING.md` §7 and `ARCHITECTURE.md` updated. User still applies the staged files and the GitHub settings in `docs/PACKAGING.md` §7 "Repository settings"; first-use checks (bot rerun raising `workflow_run`, tag creation on a workflow-changing commit, docker tar size) stay open until the v0.2.12 merge.

## P331: Fix the release workflow

Release failed repeatedly on 2026-10-23 (v0.2.11: 4 attempts; ci-gate timed out at 2400s). Earlier failures: v0.2.7, v0.2.8 first run, v0.2.1, plus the mongo kernel 6.19 gate (closed PR #5). Planner reads those run logs and root-causes each. After P330, the ci-gate cause is gone; confirm no other cause remains.

Result: Root causes from run logs. v0.2.1: stale S3/SQS auth test (`d7efbe03f`). v0.2.1 and v0.2.7: timing-dependent Redis and Kafka tests (rewritten in `5d2c3d482`, green since). v0.2.8: `mongo:8.3` refuses kernel 6.19 (pinned to `mongo:7.0.45`, PR #5). v0.2.7, v0.2.8, v0.2.11: `ci-gate` (removed by P330). v0.2.11 gate hung on a slow apt mirror in `pr.yml` setup; that stays out of scope (`pr.yml`/`cache-warm.yml` only, no own row yet). No failure in `build` or `publish`. Three `release.yml` gaps fixed: F1 `tag` refuses a non-prerelease tag whose commit is not on `main` (compare API); F2 `tag` refuses an already-published release before any runner starts; F3 `publish` refuses a tag moved since `tag` resolved it. Staged as one combined `release.yml` patch (P330 plus P331) in `docs/pending-changes/`; `docs/PACKAGING.md` §7 updated. Checks: `git apply --check` passes for both patches; actionlint 1.7.7 clean on the applied tree with `docs/pending-workflows/*`; `ci-gate` count 0 in `release.yml`; `GITHUB_REF_NAME`/`github.sha` hits only in `run-name`, `concurrency`, `tag` env; `check-docs` passes. Guard bodies run against the real repo: `v0.2.11` exits 0, `v0.2.8` exits 1 (published), prerelease skips compare, off-main commit (`behind`) exits 1, moved-tag step exits 1 on a wrong sha and 0 on the real one. User still applies both patches and the pending workflows; `v0.2.11` has a tag and no release (recommend skip, v0.2.12 ships a superset). Also added `docs/pending-changes/delete-old-branches.sh`: run locally to delete remote `v0.2.10`, `v2.0`, `v2.6`, `v2.8` after verifying each matches `chapter/<name>`; delete the script afterwards.

## P332: Kira Space as default app for code and data files

- Kira Space settings: option to make Kira Space the default app for common code and data extensions (planner proposes the extension list and groups).
- A file opened from outside the app (Finder, `open`, double-click) opens in a new window.
- Packaging side (file associations in the bundle `Info.plist`/`build/config.yml`) and the in-app setting (e.g. LaunchServices default handler) are both in scope; planner states what macOS allows without prompts and what it cannot do from a Linux sandbox.

## P333: DB MCP: prominent target database and response preview

- The approval UI shows which database the query will run on as prominently as the query itself: connection name, kind, database, environment/read-only state, large and unmissable.
- New setting: show a response preview. When on, the approval step shows exactly what the AI will receive for the query, as a table, with table masking already applied.
- Scope: `DbMcpApprovalDialog.vue` and the MCP request path in `apps/kira-studio`. Planner decides whether this splits into Part 1 (target prominence) and Part 2 (preview setting); a split keeps the number per `CLAUDE.md`.
- Preview must run the same code path as the real answer, never a parallel reimplementation. Planner states how a preview can run without a double-execution side effect (read-only verdict only, or run once and hold the result for the approved send).

## P334: Docker: restore running containers after an engine/VM restart

- Snapshot the running container set (ID, name, image, Compose project and service, Docker context) while the engine is healthy. Skip ephemeral origins (`testcontainers`, `buildx`, `kind`).
- Detect an engine/VM restart: the `internal/docker/events.go` stream drops (`unavailable`) then recovers (`ok`). Confirm it is a restart, not a socket blip or context switch, via engine boot identity (daemon ID, system time) and container `StartedAt`; planner picks the exact signals.
- Never let the post-restart empty state overwrite the snapshot. Keep "last known running" until the user restores or dismisses.
- After a restart, offer to start the containers the engine did not bring back itself (restart policy `always`/`unless-stopped` already does). Compose projects start together. Also compare snapshot with the running set at app launch for a restart that happened while Kira was closed.
- Deleted containers are listed as gone, not recreated. Boot-time restore (login item/helper) is out of scope.
- Planner decides the DB home of the snapshot, whether restore is click-only or automatic (default click-only unless told otherwise), and tests (`dockerflow` flow test plus UI spec).

## P335: SQL grid: context-menu "Copy as" with multiple rows selected

With several rows selected, the keyboard copy shortcut puts the rows on the clipboard, but right click > "Copy as" puts nothing there. Planner reproduces it first (UI spec, real clipboard read), finds why the menu path differs from the shortcut path, and fixes it so both share one code path. Backend-or-UI split per the new-feature test rule applies only if a bound call is involved.

## P336, P337: Code review rounds

Per `CLAUDE.md` "Code review": one Opus reviewer per round (architecture/security, correctness, performance), findings file under `plans/` committed before any fixer, then one sequential Sonnet fixer committing per logical group. Scope: everything changed since the last review session, base commit stated in the findings file. Round 2 covers the full diff since that same base, including round 1 fixes.
