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
| P330 | Branch naming, PR automation, release on merge | Todo |
| P331 | Fix the release workflow | Todo |

## P330: Branch naming, PR automation, release on merge

- Rename remote branches `v0.2.10`, `v2.0`, `v2.6`, `v2.8` to `chapter/<same name>`. Verify nothing references the old names.
- Add a `.githooks/pre-push` check: pushing a branch not named `main` or `chapter/v<semver>` fails with a clear message. Tag pushes pass. Decide how `claude/*` session branches are handled and state it plainly.
- `pr.yml`: drop `push: main`.
- New workflow: on PR opened or reopened, `gh pr merge --auto --squash`.
- New workflow: on `workflow_run` of `pr.yml` with conclusion `failure`, `gh run rerun --failed` while `run_attempt < 3`. Never retry `cancelled`.
- New workflow, on PR merged into `main` from `chapter/v<semver>`: derive tag from head ref, fail if tag exists, create tag at the merge SHA, dispatch `release.yml` with a `tag` input. `release.yml` keeps the manual tag-push trigger.
- `release.yml`: add `workflow_dispatch` with `tag` input; build/publish use that tag, not `GITHUB_REF_NAME`.
- Document the GitHub settings the user must apply: allow auto-merge, ruleset on `main` requiring the `pr.yml` checks, ruleset restricting branch names.
- `CLAUDE.md`: chapter branch `chapter/v<version>`; user gives version at chapter start, else last tag with patch plus 1; chapter close phase also opens the PR; replace "No per-phase PRs" accordingly.
- `docs/DEV_ENVIRONMENT.md` and `docs/PACKAGING.md` §7: release flow.

## P331: Fix the release workflow

Release failed repeatedly on 2026-10-23 (v0.2.11: 4 attempts; ci-gate timed out at 2400s). Earlier failures: v0.2.7, v0.2.8 first run, v0.2.1, plus the mongo kernel 6.19 gate (closed PR #5). Planner reads those run logs and root-causes each. After P330, the ci-gate cause is gone; confirm no other cause remains.
