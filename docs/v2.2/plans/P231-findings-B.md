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
