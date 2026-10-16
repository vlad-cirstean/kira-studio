# P144 Stream A notes

Base B0 = 8dd60e10. Branch v2.0-p144-a.

## Commits

- 3f8a02c7 feat: task store migration 0008 and repos
- 17842497 feat: workflow YAML reader (adeflow)
- f39b8600 refactor: share rangeFacts between queue engines
- 390dbe55 feat: merge-tree rebase-conflict check
- a40b37cb feat: task board snapshot and refresh
- b21ce5b7 feat: task, plan and backlog writes
- 1bb41bc2 feat: AdeTaskService bridge and wiring (20 methods, 3 channels, index.ts entries)
- 78a7a344 fix: split computeBranch (gocognit 33 > 30, only caught by `bun run lint:go`)

## End checks

- `go test ./apps/kira-space/...`: all ok.
- `go test -race ./apps/kira-space/internal/ade/...`: ok.
- `bun run lint:go`: `0 issues.` after 78a7a344.
- `bun run lint:dead`: exit 0; 7 duplicate-export lines and 9 knip config hints all in files outside Stream A (packages/shared, git-core, git-ui, kira-studio frontend, knip.json), pre-existing and untouched.
- `go mod tidy`: only change vs B0 is go.yaml.in/yaml/v3 moved from indirect to direct.
- Migration 0008: copied /root/.kira-space/kira.db, dropped the 11 v2 tables, set schema_version 7, added one v1 ade_sessions row. `storage.OpenAt` result: `version=8 v1_sessions=1`, all 11 v2 tables count 0. A full GUI launch was not possible in the container; Open + migrate is the same path main uses.
- `git diff B0 -- go.sum`: empty, no new module. go.yaml.in/yaml/v3 (Apache-2.0/MIT) was already an indirect dependency.
- Conflict states, via Go tests `TestTaskBoard_snapshotAssembly` (checking then conflicting after Refresh), `TestRebaseChecker_realRepos` (real clean and conflicting repos), `TestTaskBoard_notCreatedAndTooOldGit` and `TestRebaseChecker_cacheKeyFailureAndVersionGate` (GitStatus forced tooOld: failed, reason "git X is older than 2.38", no spawn).
- Acceptance greps: 20 `adeTask*` methods in index.ts and 20 bound Go methods; channels emitted from adetask.go; no `standard.yaml` in apps/kira-space; no go-git; wire.ts, fixtures, packages/shared, knip.json and SPEC.md unchanged vs B0.

## Deviations

- layeringtest: added `RunAllowing` (repo-root internal/layeringtest) and the Space layering test allows `/internal/bridge/adewire`; domain packages ade and adeflow must return the frozen adewire types.
- queue.go: besides rangeFacts, computeAncestry, computePairFacts and forcePushRemote became package funcs so TaskBoard shares them.
- Color slot assigned in the repo's SQL tx (SQL twin of ade.colorSlot); storage/repos is a leaf package.
- Branch owner is "" for the user's own commits (matches fixtures; plan said tip author name).
- Workflow syntax errors carry no "✕" prefix; the line goes in the `line` field.
- Arg validation lives in bridge/adetask.go as functions, since methods cannot be added to adewire types from another package.
- lastCommitAt = CommitterUnix * 1000 (ms). v1 passes seconds; looks like a v1 quirk, left alone.
- UpdateTask syncs branch kinds on a task<->parked change (mine<->parked).
- Credential event: Conn payload (git repo id) re-keyed to adewire.CredentialRequest (codeRepoId) in TaskBoard.credentialRequest.
- Push channel names in index.ts are string literals; CHANNEL lives in packages/shared (off limits for Stream A).
- Regenerated Wails bindings (untracked) via scripts/setup.sh to typecheck index.ts.
