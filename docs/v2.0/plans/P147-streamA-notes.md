# P147 Stream A notes

Base 7f40cbb5, branch v2.0-p147-a. Not pushed.

## Commits

- 25af5e48 per-run stop, StopRun, restart recovery
- 7fc787af send-back rounds, `claude -p --resume`
- 4d71c7c5 v2 TUI sessions in tracker
- 5f36fde8 Take over, LaunchStage, StartBranch
- 941975c8 archive, worktree + setup on AddExistingBranch
- 9d82ff0d AdeTaskService methods, open-session channel (47 methods = 47 index.ts entries)
- ac3a4e14 engine tests
- 9cddd714 lint fixes (main.go wiring moved into wireAdeTask, test index guard), waitUntil 10s to 45s (race runs)

## Deviations

- Tests in new `runengine_wave4_test.go`, not appended to `runengine_test.go`.
- `Tracker.Close` does not mark records stopped, so `OnStopped` fires from Reconcile only.
- Held fix runs lose `runOpts` across restart: they launch as a plain fresh attempt.
- LaunchStage: unborn or non-mine branches are read-only root lines; cwd prefers first created mine worktree.
- v2 resume of a missing cwd returns ErrInvalidInput; no directory recreation.
- `Recover`, `SetStoppedHandler` and `Start` run inside `wireAdeTask` (gocognit limit on `main`).
- `waitUntil` timeout raised in `workflows_test.go`: multi-process chains exceed 10s under `-race`.

## Checks

- `go test ./apps/kira-space/...` pass.
- `go test -race` ade, adeagent, adeflow pass.
- `bun run lint:go` 0 issues; `bun run lint:dead` exit 0.
- `go mod tidy` no diff; go.mod, go.sum, package.json, bun.lock unchanged vs base.
- codegraph_explore calls: 1.

## Real claude smoke (claude 2.1.289, authenticated)

Two-step stage impl then tests (`back:impl`), allowed_tools Write and Bash(touch *). Scratch test deleted.

- impl#1 run b0aa7ab0 done, claude id 056fe39f, no marker created.
- tests#1 run e7f4730c `back`, note "fixed marker missing → back to impl (1 of 3)".
- impl#2 run 7dbb3de6 done, loops 1, same claude id 056fe39f (resumed), created `.ade-fixed`.
- tests#2 run 6ee8fc03 done, loops 1.
