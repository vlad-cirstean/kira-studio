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

## B-2 ADE refresh of an already-open repo ignores a changed git path
- Test: appflow TestGitPathSettingEverywhere/refresh_of_an_open_repo_follows_the_setting (skipped "P231 finding B-2")
- Failure: `refresh row 0 reports no error with an unusable git`
- Repro: import a repo with a remote, create a task, `Refresh` once (repo now open). Set `git.gitPath` to an executable that is not git.
  Git stream `app.init` reports `unusable` and `ImportRepo` fails `E_GIT_UNAVAILABLE`, but `AdeTask.Refresh` returns a row with no error and fetches with the old binary.
  Without the earlier `Refresh`, the same sequence returns the classified row error.
- Suspected cause: `ade/board.go:268-276` `openRepo` returns the cached `conn.Entry`; `gitsession/registry.go:169` `gitclient.NewRepo(summary, runner, gitPath)` bakes the path at open time, so settings never reach an open repo. Found by read, confirmed by the test.
- Class: product bug. Fix idea: resolve the path per call (Repo reads the live setting), or drop open entries when `git.gitPath` changes.

## B-3 changing the port does not restart a server stopped by a busy port
- Test: mobileflow TestEnableTrustPort/a_new_port_starts_a_server_stopped_by_a_busy_one (skipped "P231 finding B-3")
- Failure: `SetPort off a busy port = {Enabled:true Running:false ... Error:mobileweb: port 38987 is in use ...}, want running with no error`
- Repro: enabled and trusted; `SetPort` to a port another process holds (server stops, `Error` set); `SetPort` to a free port.
  Status stays stopped with the stale in-use error naming the old port. Only the next supervisor poll (10s) or an off/on toggle starts it.
- Suspected cause: `bridge/mobile.go` `SetPort` calls `reconcile` only `if s.embedded.Status().Running`; a server that failed to bind is not running, so the new port is never tried. Found by read, confirmed by the test.
- Class: product bug. Fix idea: call `reconcile` whenever the supervisor is active, not only when running.

## B-4 phone sessions endpoint leaks the working directory
- Test: mobileflow TestPhoneReadsRealAde/sessions_carry_no_cwd (skipped "P231 finding B-4")
- Failure: `GET /api/ade/sessions leaks a cwd: {"sessions":[{... "cwd":"/tmp/.../home/wt/api/api-work","cwdMissing":false ...`
- Repro: a task branch with a worktree, one finished headless run, one interactive session; paired phone `GET /api/ade/sessions`.
  `/api/agent/sessions` strips `cwd` (`withoutCwd`), the ADE `sessions` route returns `adewire.Session` as is, `cwd` on every row. Board and the SSE channels carry no `cwd` key (the events are signals).
- Suspected cause: `mobileweb/routes.go` `read("/api/ade/sessions", readJSON(s, "sessions", false, s.cfg.Reader.Sessions))` has no projection; `server.go` strips only on the agent route and the event table. Found by read, confirmed by the test.
- Class: product bug. Fix idea: wrap the sessions reader in `withoutCwd` like the agent route. Open question for the fixer: board `branches[].worktree` is also a local path.

## Harness notes (not product bugs)
- `WithoutGh` hides gh from PATH only. `ghclient.NewPlatformLocator` also probes `/opt/homebrew/bin/gh` and `/usr/local/bin/gh`, so a host install still answers. `TestGitHubWithoutGh` accepts `ghMissing`, `unauthenticated` or `unavailable`. Fix idea: harness-level locator seam.
- Archive closes review windows through `appwire` `closeTaskReviewWindows` on the real `shell.WindowRegistry`, not the `WindowManager` recorder. The recorder cannot see it. `TestArchiveRisk` asserts the review window row is gone (`ReviewWindowTarget` nil) instead.
- Tracker grace window is 30s and not configurable from the harness. A taken-over or launched TUI session reads `stopped` only 30s after spawn. `TestInteractiveSessions` waits up to 50s per stop (about 60s total). Fix idea: expose `Grace` in `appwire.Options`.
- Fake claude prints a stream-json `init` line for every `-p` call and reads `--mcp-config` as a file path. `memory.CLIRunner` (`--output-format json`) parses stdout as one document and the importer passes the MCP config inline, so the fake cannot serve memory flows as is. `memoryflow` fronts it with a test-local bash shim (`shim_test.go`) that drops the init line, writes the inline config to a file and answers gate, reconcile and extract calls from canned files. Fix idea: fake suppresses `init` when `--output-format json` is present and accepts inline `--mcp-config`.
- Search without a model on disk reports `notInstalled`, not `unavailable`. `unavailable` needs an installed model and a missing ONNX runtime. `TestSemanticUnavailable` asserts `notInstalled`.
- Host `pathLocator` falls back to PATH when the configured git path is missing, so a missing file does not yield `notFound` listing the path on Linux. `TestGitPathSettingEverywhere` uses an executable non-git script (`unusable`) as the bad path.
- `appearance.dateFormat` reaches git only through `app.init` (`dateFormat`), not `commit.detail`. `TestDateFormatReachesGit` asserts `app.init`.
- `appwire.Options.MobilePoll` is not reachable from `flowharness.New`; the supervisor polls every 10s. Tests drive state changes through the bound calls instead.
- e2e-real `kira` fixture lacks the login-shell profile the Go harness writes. ADE run shells are login shells that reorder PATH, so a run picked the host `claude` (real model, "stuck") instead of the fake. `support/ade.ts` `fakeClaudeOnLoginPath` writes `.bash_profile`/`.zprofile`/`.profile` per test. Fix idea: fixture writes them.
- e2e-real fake `claude` has the same JSON-mode gap as the Go harness. `support/memoryGate.ts` replaces `<root>/bin/claude` with a bash front that answers the gate prompt from one canned accept answer. Fix idea: same fake change as above.
- git-ui reads `app.init` git status only when a repo opens: the Git module with no repo open shows `No repository open` even with an unusable git path. `settings-git-path-real` opens a repo to see the blocked panel.
