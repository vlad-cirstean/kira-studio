# P231 findings, Stream B

## B-1 attaching a remote-only branch leaves no worktree
- Test: adeflow TestTaskBranches/remote-only_branch (skipped "P231 finding B-1")
- Failure: `remote-only branch has no worktree, setup = &{State:failed ...}`
- Repro: bare remote, clone has `remote-topic` on origin only (local branch deleted, `git fetch` done).
  `CandidateBranches` lists it `remoteOnly`. `AddExistingBranch{Name:"remote-topic"}` succeeds, board branch has `Worktree == ""`, setup failed.
- Suspected cause: `ade/setup.go` `ensureWorktree` uses mode `existingBranch` for a named branch with no local ref;
  `gitsession/worktree.go:178-189` preflight then runs `resolveCommit("remote-topic")`, which git does not resolve to `refs/remotes/origin/remote-topic` (`git rev-parse remote-topic` exits 1; plain `git worktree add path remote-topic` DWIMs fine). Blocker `unknownStartPoint`.
  Found by read, git checked by hand.
- Class: product bug. Fix idea: for a remote-only branch use `newBranch` mode with StartPoint `<remote>/<name>`, or resolve the remote-tracking ref in the preflight.

## Harness notes (not product bugs)
- `WithoutGh` hides gh from PATH only. `ghclient.NewPlatformLocator` also probes `/opt/homebrew/bin/gh` and `/usr/local/bin/gh`, so a host install still answers. `TestGitHubWithoutGh` accepts `ghMissing`, `unauthenticated` or `unavailable`. Fix idea: harness-level locator seam.
- Archive closes review windows through `appwire` `closeTaskReviewWindows` on the real `shell.WindowRegistry`, not the `WindowManager` recorder. The recorder cannot see it. `TestArchiveRisk` asserts the review window row is gone (`ReviewWindowTarget` nil) instead.
- Tracker grace window is 30s and not configurable from the harness. A taken-over or launched TUI session reads `stopped` only 30s after spawn. `TestInteractiveSessions` waits up to 50s per stop (about 60s total). Fix idea: expose `Grace` in `appwire.Options`.
