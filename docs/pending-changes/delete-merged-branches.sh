#!/usr/bin/env bash
# Deletes remote branches confirmed fully merged into (or content-superseded by)
# claude/unimplemented-items-xjrz4c. This session's git push access returns HTTP 403
# on any `git push origin --delete`, single-branch or batched, so it cannot run this
# itself — see docs/DEV_ENVIRONMENT.md's own section on this session's push constraints.
#
# This session's own clone started shallow (2607-commit depth), which made an initial
# pass miscount several old branches as having hundreds of unpushed commits. After
# `git fetch --unshallow`, real history showed most of those are actually fully merged
# (0 unique commits). All 52 below were confirmed with full history, no code reading:
#
# - 47 are direct ancestors by SHA (`git merge-base --is-ancestor` / `ahead=0`).
# - 1 is a true no-op: claude/feature-v1-1-p5-onwards-2isfzt's 2 commits are a doc
#   write immediately followed by its own revert — net diff against its merge-base
#   is completely empty.
# - 4 are content-superseded under a different SHA, individually confirmed:
#     - p122-focus-ring-thickness: same 8 commits already merged, plus one duplicate
#       result commit from before a rebase gave the merged copy a new SHA.
#     - v1.9-p105-plan: its one commit is a plan doc already on trunk as
#       docs/v1.9/plans/P105-a11y-findings.md.
#     - v1.9-p107-iter2-audit: its one commit is a findings doc already on trunk as
#       docs/v1.9/plans/P107-duplication-findings.md.
#     - v1.6-p63-arm-b: the deliberately-discarded baseline arm of P65's A/B test
#       (docs/v1.6/SPEC.md's own P65 row — the MCP-using arm-a shipped as P63's real
#       deliverable, arm-b was always meant to be thrown away after comparison; the
#       repo-map MCP server it measured was later removed entirely in v1.9 P97 anyway).
#
# NOT included here — real, never-merged content, left for a human decision:
#   claude/electron-neutralino-migration-k91kc8  (an explicit, abandoned Wails->Neutralino spike)
#   claude/experiment-regular-table               (an explicit, abandoned alternate grid-engine spike)
#   claude/feature-v1-3                           (an earlier v1.3 attempt, superseded by
#                                                   claude/feature-v1-3-headless-git, which shipped)
#   feature/agent-first-attempt                   (the very first, Electron-based prototype)
#   import/kira-version-vscode-kickoff            (disjoint git history entirely — its own
#                                                   "Initial commit" — likely the original
#                                                   standalone Kira Version VS Code extension
#                                                   repo before it was folded in by file copy,
#                                                   not history-preserving merge; may be the only
#                                                   place that pre-import history still exists)
#
# `main` is also a full ancestor (0 unique commits) but is excluded on purpose — never
# delete a repo's default branch regardless of merge status.
#
# Run from the repo root once you have push access:
#   bash docs/pending-changes/delete-merged-branches.sh
# Safe to re-run: `git push --delete` on an already-gone branch just errors harmlessly
# per branch (this script does not use `set -e`, so it keeps going).

BRANCHES=(
  claude/codegraph-mcp-tools-availability-am3w3u
  claude/codegraph-setup-bash-8a385b
  claude/feature-v1-1-p5-onwards-2isfzt
  claude/feature-v1-2
  claude/feature-v1-3-headless-git
  claude/feature-v1.4
  claude/p1-feature-kickoff-t5cb7c
  claude/p108-v1-9-continue-ijmvko
  claude/p2-implementation-y5jkvl
  claude/p3-start-kdvptk
  claude/p82-p83-implementation-ocpvj1
  claude/phase-16-design-updates-h79179
  claude/phase-only-48-d9mokq
  claude/phases-p4-p12-fnvfqy
  claude/search-editor-dates-design-3hjd7i
  claude/split-ui-tests-be-fe-yrw277
  claude/step-g34-opus-planning-tg91e3
  claude/studio-api-polish-sql-mongo-api
  claude/v1-8-api-git-modules-e2luom
  claude/v1-8-p82-p83-implementation-ocpvj1
  claude/wails-native-shell-p57-328wa1
  feature/kickoff
  feature/v1.1
  p107-work
  p120-git-audit-studio
  p125-readme-refresh
  test-containers
  v1.5
  v1.5-c7-arm-a-round2
  v1.6
  v1.6-p63-arm-a
  v1.7
  v1.8-part3
  v1.9
  v1.9-p104-stream-b
  v1.9-p104-stream-b-cleanup
  v1.9-p105-implement
  v1.9-p106-script-scoping
  v1.9-p107-iter2-addendum
  v1.9-p107-iter2-defer
  v1.9-p107-iter2-stream-a
  v1.9-p107-iter2-stream-b
  v1.9-p107-plan
  v1.9-p107-step6-7
  v1.9-tailwind-approx-fixes-v2
  v1.9-tailwind-declines
  v1.9-tailwind-full-sweep
  wails-native-shell-spike
  p122-focus-ring-thickness
  v1.9-p105-plan
  v1.9-p107-iter2-audit
  v1.6-p63-arm-b
)

for b in "${BRANCHES[@]}"; do
  echo "Deleting origin/$b ..."
  git push origin --delete "$b"
done

echo "Done. This script and this note can be deleted once run."
