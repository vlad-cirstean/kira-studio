# P145 Stream A notes

Branch `v2.0-p145-a`, base B0 `13e99974`. Go backend only. Not pushed.

## Commits

- `f4e71040` feat: ade facts migration and repo config writes (0009, models, repos)
- `23146654` feat: ade workflow YAML writer, import and new
- `269f3816` feat: watch the ade workflows folder
- `fcfc536a` refactor: share code repo import
- `56ba7e58` feat: per-repo prepare script timeout
- `dc00befa` feat: ade folders import and watch
- `f87ebe79` feat: integration merged and stale facts
- `b5ea4ac8` feat: deployment facts from environment scripts
- `b69f1dcf` feat: AdeTaskService P145 methods and channels
- `8b590f43` fix: lint findings in ade writer, watcher and repo config
- test commit: workflow file writes and external edits (engine smoke)
- this notes commit

## Checks

- `go test ./apps/kira-space/...`: all packages ok except `gitsock` (P152, below).
- `go test -race ./apps/kira-space/internal/{ade,adeflow,gitsession}/...`: ok.
- `bun run lint:go`: 0 issues (fixed 10: 2 gocognit via extraction, 4 gocritic, 3 unconvert, 1 unused).
- `bun run lint:dead`: exit 0, no finding in touched files.
- `go mod tidy`: no diff. `git diff B0 -- go.mod go.sum package.json bun.lock`: empty.
- `go build -tags server ./apps/kira-space/...` ok. `bun run typecheck:space-web` ok.
- Migration 0009 on a v8 DB with a seeded repo and config row: row kept, `prepare_timeout`
  dropped, `ade_branch_marks` and `ade_env_state` created.
- Server-tag smoke (§3.8) covered by engine tests instead of a booted server: `TestWorkflows_writesAndExternalEdits`
  (NewWorkflow creates `workflows/`, external edit emits, broken edit keeps last valid),
  `TestAddFolder_importsRealReposOnly` (two repos, linked worktree skipped),
  `TestFolderWatch_importsNewRepo`, `TestIntegration_*` (squash merge reports merged),
  `TestDeployment_scriptStates`.
- Acceptance greps: 31 `AdeTaskService` methods and 31 `adeTask*` entries; `recorded` true only in
  `ade/integration.go` RecordMerge; no go-git; `PrepareTimeout` const gone from gitprepare, read via
  `gitsession.prepareTimeout`; `MkdirAll` for `workflows/` only in `adeflow/writer.go`; contract
  paths diff empty.
- gitsock (P152): `TestIntegration_DeletedFileCanBeMarkedReviewed` failed once in the first full run
  with `review.mark` error response; alone 30/30 pass. Package runs: 4 pass of 6 compiled-binary
  runs, the 2 others exceeded 150s (normal 30-45s); one earlier `go test` package run hit the 600s
  timeout. Failure shape matches the known flake; hangs not seen in other packages. B0 comparison
  not done (a scratch B0 worktree fails the package for environment reasons); left for the wave-end
  step.

## Licenses

None new. No go.mod, go.sum, package.json or bun.lock change.

## Deviations

- Added `gitrpc.Router.SetRepoSettings` so the ADE prepare leaf write fans out `repoSettings.changed`
  to git-ui clients (small gitrpc change outside the ownership table; no wire change).
- Prepare timeout migrates by dropping `ade_repo_config.prepare_timeout`; stored per-repo values are
  not copied to `git_repo_settings` (column existed one phase, default 15m applies).
- `Spec.Timeout` in gitprepare is now required (> 0); all callers pass it.
- Deploy scripts run at startup, on environment change and at the start of each repo refresh; the
  hook sits in `refreshRepo`, outside the repo mutex.
- Bridge guards (YAML 1 MiB, script 64 KiB, path 4096) sit above engine limits (env script 4 KiB).
- Bindings regenerated locally with `wails3 generate bindings` (gitignored).
