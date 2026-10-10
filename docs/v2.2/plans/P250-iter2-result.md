# P250 iter2 result

Plan `plans/P250-iter2-gaps-P252-P260.md`. Base `v2.0` at `b15b8e52c`; branch `p250b-impl`. Ten items
now have a Go flow half and a UI half tied by a contract fixture.

## Commits

1. `test(studio)` docker edit stale, managed, stopped, auto-remove (D1-D3).
2. `test(studio)` image registry and open-external (R1).
3. `test(studio)` schedule off through the script editor (A1).
4. `test(space)` schedule off through the script editor (A2).
5. `test(space)` workflow layout reads the backend workflow (W1).
6. `test(space)` name-status detail, Changes tab, view head (G1-G3).
7. This file.

## Fixture keys

- `docker-edit`: `DockerService.UpdateContainer#stale`, `ContainerEditSpec#managed`, `#stopped`, `#auto-remove`,
  `args:DockerService.UpdateContainer#stopped`, `DockerService.UpdateContainer#stopped`, `RecreateContainer#auto-remove`.
- `docker-registry` (new): `DockerService.Images#registry`, `DockerService.InspectContainer#registry`.
- `link-open` (new): `args:LinkService.OpenExternal`.
- `script-editor` (both apps): `args:CustomScriptsService.Update#schedule-off`, `CustomScriptsService.Update#schedule-off`.
- `git-commit-detail`: `git:commit.detail#binary-mode`. `git-view-head` (new): `git:status.get#cherry-pick`.
- W1 reads `ade-branching`, G2 reads `ade-review-open`, G3 also reads `git-remote`: existing keys.
- Both `exempt.txt` stay empty.

## Verification run

- Flow, Docker running, `KIRA_FLOW_DOCKER=require`, `KIRA_CONTRACT=write` then `-count=2` without it:
  `TestUpdateContainerRejects`, `TestUpdateStoppedContainer`, `TestImageRegistryURL`, `TestRecreateRefusals`
  (`KIRA_FLOW_COMPLETE=1`), `TestOpenExternal`, `TestScriptEditorSave` (both apps), `TestCommitDetailAndDiff`,
  `TestCherryPickRevertConflict`: pass, no drift (`git diff --exit-code -- apps/*/tests/contract/` clean).
- Coverage gates (both apps): pass. `lint:go`: 0 issues. Commit hook (biome, typecheck) passed on every commit.
- UI Studio: `docker-edit` 7 and `docker-module` 15 pass; `automations-editor` 8 pass.
- UI Space: `automations-editor` 8, `ade-v2-workflow-layout` 7, `repo-commit-detail` 4, `ade-v2-panel` 24,
  `repo-commit-meta` 4 pass.

## Deviations

- A1/A2 flow half asserts the stored schedule (cron and confirm kept, `enabled` false) through `Update` and `List`.
  The scheduler exposes no next-fire seam; `TestScheduleConfirm` already covers retiring a waiting run on turn-off.
- UI A1/A2 push the post-save list through `customScriptsChanged`, since mocked control responses are static.
- `InspectContainer#registry` and `Images#registry` use the wire key `registryUrl` (plan wrote `registryURL`).
- The three pre-existing biome warnings (unused `preview` in both `automations-editor.spec.ts`, template-curly in
  `autocomplete-tokenizers.spec.ts:116`) are untouched here; the parallel P259 implementer fixes them.

## Open

- `ui-timing` quiet rerun not done: load average stayed 9-22 (other agents). `--project=ui-timing` also pulled
  in the whole ui project (425 pass). Two timing tests failed under that load: `perf.spec.ts` p95 84 vs 80 limit
  and `budgets.spec.ts` interaction budgets. No source on those paths changed. Rerun on an idle machine.
