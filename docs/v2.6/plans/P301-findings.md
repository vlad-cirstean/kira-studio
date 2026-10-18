# P301 code review findings

One Opus round, three dimensions: (1) architecture, structure, maintainability, security; (2) functional correctness; (3) performance and resources.

## Base and scope

Base: `7c3b0a66f` ("docs: drop P292 round 2 findings"), the last commit of P292, the last review session.
HEAD: `cc2fcf3e` on v2.6.
The base is not an ancestor of HEAD: v2.0 was squash-merged as `bd0c2246`, whose tree equals v2.0 tip `ec1cbd039`.
So `git diff 7c3b0a66f HEAD` is exactly the post-review work: v2.0 commits after the base (P293 flat steps, P294 test and CI speed), then v2.6 (P295 to P300).

Pathspec: `-- . ':!docs' ':!*.md'`, plus the workflow patch `docs/pending-changes/.github__workflows__release.yml.patch`.
Diff size: 944 files, +225613 / -9086.
Of that, 509 files (+213961) are data: eval runs and corpus under `tests/claude/testdata/`, contract and fixture JSON, PNG baselines, site `.mdx` docs.
Code, tests, scripts and config: 435 files, +11652 / -8928.

## Areas covered

- Memory (P296 to P298): `internal/memory/` (importer distill, merge, chunk tables, verify, db; memfmt doc format 3; memcheck; gate, reconcile, store kind; migration 0008), `mcpserver` ingest distill, `llmprompts/registry.go`, bridge `memorydistill.go`, workbench memory UI, shared domain schemas.
- ADE flat steps (P293): `internal/ade/` (runs, steps, route, launches, reviewstep, taskwf, board, tracker, agenttools), `adeflow` parse and writer, `adewire`, storage model, repos and migration 0038, mobileweb, bridge `adetask.go`, frontend `ade/v2` (progress, actions, status, stepMoves, workflowGraph, workflowForm, inspector), mobile task actions.
- CI and tooling (P294, P295): `.githooks/`, `scripts/hook-scope.sh`, `go-test-split.sh`, `pull-test-images.sh`, `release-ci-gate.sh`, `lib.sh` `pull_images`, `test-matrix.sh`, `db-compat.sh`, `prepare-ui-tests.sh`, `.github/workflows/pr.yml`, `pages.yml`, `.github/actions/setup`, the pending release.yml patch, `testsupport` images.
- `scripts/docshistory/` (P299, P300).
- Small changes: terminal SIGHUP, agentsandbox tests, fakeagent, claudeheadless wire, 1-line doc-path repoints across both apps.
- Tests: skimmed for wrong assertions only; per CLAUDE.md, no coverage audit.

No area skipped.

## Findings

### Group 1: workflow routes to steps that never run (adeflow, editor, route engine)

**1.1 Medium: a loop route to a manual or skipped step validates, then always stops the run.**
- `apps/kira-space/internal/adeflow/parse.go:720-728` (`resolveStepRoutes`) accepts any step id as a loop target. That includes a `kind: manual` step and a `skip: true` step.
- `apps/kira-space/frontend/src/ade/v2/workflows/inspector/AdeStepResults.vue:93` offers every step as a route target, manual and skipped steps included.
- At runtime, `apps/kira-space/internal/ade/route.go:145-150` (`decideLoop`) looks up the target's last run. A manual or skipped step has none, so the step is marked failed with "cannot send back: X did not run on B".
- Scenario: steps `[design (manual), impl (agent), tests (agent)]`. Set the `tests` result `failed` to route to `design`. The file saves. The first failing test run then stops instead of returning.
- Fix: refuse a loop target that is manual or skipped in `resolveStepRoutes`, and filter those steps out of the route options when the route would be a return.

**1.2 Low: editor edits leave `review.implementer` dangling, and the save is then refused.**
- `removeStep` (`apps/kira-space/frontend/src/ade/v2/board/workflowGraph.ts:485`) clears routes to the removed step but not a review step's `review.implementer`.
- `moveStep`/`canMove` (`workflowGraph.ts:511-530`) check only result routes, so a review step can move above its implementer.
- `withKind` (`apps/kira-space/frontend/src/ade/v2/board/workflowForm.ts:87`) can turn the implementer into a non-agent step.
- Each case makes the next save fail with `implementer must be an earlier agent step` (`apps/kira-space/internal/adeflow/parse.go:506`). The user must find the review block by hand.
- Fix: clear `review.implementer` when its target is removed, moved after the review step, or no longer an agent prompt step. Alternatively, block the move.

### Group 2: scoped git hooks skip checks they still need (P294)

**2.1 Medium: a deletion-only commit or push runs no check, not even `go build`.**
- `.githooks/pre-commit:15-16` and `.githooks/pre-push:30,41` list files with `--diff-filter=ACMR`, then `exit 0` when the list is empty.
- A deleted file is never listed.
- Scenario: a commit that only deletes `foo.ts`, still imported elsewhere, skips lint and typecheck.
- Scenario: a push whose only change deletes a Go file skips `go build ./...`. That contradicts the pre-push header (line 5: "`go build ./...` always runs").
- Fix: include `D` in the filter and map a deleted path the same way as a changed one (or treat any deletion as a full run). Run `go build ./...` before the empty-list exit.

**2.2 Medium: catalog and Go-only changes skip typecheck and `lint:rules`.**
- `typecheck_targets` (`scripts/hook-scope.sh:21-23`) matches only `.ts|.mts|.vue|.js` files.
- The `lint:rules` trigger (`.githooks/pre-commit:27`) matches only `.ts|.mts|.vue|.css|.astro|.js` files and `internal/llmprompts/`.
- But `MessageKey` derives from `packages/theme/src/i18n/en.json` (`packages/theme/src/i18n/types.ts:1`), and `check-catalog --unused` scans `.go` files too (`scripts/copy/check-catalog.ts:24`).
- Scenario: a commit that only removes a key from `en.json` still used in a `.vue` file passes pre-commit. Neither pre-push nor any other local hook catches it; only CI does.
- Scenario: a Go-only commit that drops the last `i18n.T` use of a key passes too.
- Fix: add `packages/theme/src/i18n/` to `FULL_RE` (or map it to a full typecheck). Add `\.go$` and `\.json$` to the `lint:rules` trigger.

### Group 3: CI image cache never restores tags (pr.yml)

**3.1 Medium (performance): the Testcontainers image cache saves images without their tags.**
- `.github/workflows/pr.yml:218` runs `docker save $(docker images -q)`. Saving by image ID drops the repository tags, so `docker load` on the next run restores untagged images (`<none>:<none>`).
- A cache hit skips `pull-test-images.sh` (pr.yml step conditions). Testcontainers then finds no `postgres:…`, `mysql:…` and similar tags, and pulls every image again from Docker Hub.
- So a cache hit costs a multi-GB restore and load, and still pulls every image from Docker Hub: the rate limits the mirror was meant to avoid.
- Fix: save by name, e.g. `docker save $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>')`.

### Group 4: smaller robustness and resource items

**4.1 Low (resources): `memory-check` now reads every tracked file.**
- `internal/memory/memcheck/source.go:67-75` (`readDisk`) and `:127` (staged) dropped the extension filter (`scannable`).
- `memory-check` without `--staged` in a large repository now loads every tracked text file up to 4 MiB into one `[]Source`, all held at once: lockfiles, generated code, fixtures.
- Retired comment blocks can only sit in a file with a comment syntax.
- Fix: keep a cheap filter (doc paths plus the old comment-marker extensions). Or check each file as it is read instead of accumulating all of them.

**4.2 Low: one transient `gh api` error fails the release gate.**
- `scripts/release-ci-gate.sh:35,46` run `gh api` inside `$(...)` under `set -eu`.
- One 5xx or network blip while polling for up to 40 minutes exits the script non-zero, which reads as "PR CI red" and blocks publish.
- Fix: retry `list_runs` a few times (or `|| continue` to the next poll) before failing.

## Nothing found

Checked and clean:

- Memory distill pipeline: stage spend cap, progress locking, verify batching, merge limits and `cleanLines` kind guard.
- Import line cap parity: `maxDistillImportLines` equals `maxMergeLines` (640).
- Chunker table-header repeat: offset tracking, rune versus byte units.
- `applyVerdicts` refactor; verify turn floor; `ErrClaudeMaxTurns` mapping.
- memfmt format 3 writer and parser (category and section rules); writedoc v2 overwrite rule; memcheck kind conflict.
- Gate, reconcile and commit kind handling; migration 0008 trigger rebuild; zod schemas against Go JSON tags.
- ADE pass watermark (`since`): `SetEntryStep(nil)` keeps it; `SetTaskStep` hides the target and later steps; `queueRun` attempt bump; `inPass` guards in decideRoute, review and TUI finish.
- Entry handling: unstarted tasks follow the live first step on both Go (`loadTaskCtx`) and wire (`decorateTask`); loop past the entry re-enters at the target.
- Go and TS parity: `walkPath`/`nextAction` versus `progress.ts`; mobile `currentStepId` versus Go `currentStepID`.
- Migration 0038 delete order; repos column lists; mobileweb and bridge renames; review candidates.
- adeflow writer kind key cleanup and default-results elision.
- Terminal SIGHUP handler; `go-test-split.sh`; `pull-test-images.sh`; `lib.sh` `pull_images`; db-compat and test-matrix mirror mapping.
- Setup action restore-only mode; release.yml patch (draft, verify digests, publish, failure cleanup); `pages.yml`.
- docshistory parse, render, repoint and spend ledger; 1-line doc-path repoints.
