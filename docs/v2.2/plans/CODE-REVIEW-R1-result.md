# Code review R1 result (P236-P261)

Base `071eba1e1`. 15 findings fixed (5 med, 10 low). Findings doc deleted per CLAUDE.md.

## Commits

- `817ff2d00` #1 repoTabs: reuse of permanent diff tab as preview only activates it; cohort evicted only for a preview member. `repo-tab-slots.spec.ts` rewritten (old P79 test asserted the bug).
- `95e9aa2ae` #2 Space `lastRepoKey` persisted per window (`kira.space.lastRepo.<window>`), boot activates it when still in `openRepos`. UI spec `repo-last-active`.
- `7a7122795` #3 review list virtualized (`useVirtualRows`, measured rows, `top` not `transform` so row context menu `position: fixed` still anchors). Cap and "Show more" removed. 600-commit spec now asserts few mounted rows plus End key reaches the last.
- `87572298d` #4 scheduler waits capped at 30 s, wall clock re-read on wake. Stalled-timer test (`stallClock`).
- `f113d94dc` #5 rebase agent: explicit git subcommand allowlist, `--disallowedTools` for `git -c`, `git config`, `rebase --exec`; `git push --force-with-lease` allowed only when the spec pushes, else `git push` denied. `claudeheadless.Spec.DisallowedTools` added.
- `06f560780` #6 `handleChunkLayout` invalidates only rendered rows in range; comment fixed. #7 hollow ring uses inline `fill: none`.
- `46b9b9ec3` #8 weight guard covers `views/repo`; `RepoFileView.vue` heading `font-medium`.
- `3074bbfdc` #9 contract.go history trimmed.
- `aef005789` #10 disk usage cache keeps newest 5 scopes.
- `c85e057c1` #11 alias reconnect failure re-attaches original endpoint, `restored` in error details. Test with fake engine (`edit_reattach_test.go`); a real engine cannot be made to fail the connect deterministically.
- `21c07edcc` #12 `SetHidden`/`SetColor` on missing row return `E_NOT_FOUND` (flow test); folder scan re-applies the folder flag when it flipped mid-scan.
- `c05dc1b27` #13, #14 five trivial test files deleted.
- `296236ddf` pre-existing failure fixed: Studio `mockRuntime` lacked 5 bound Docker methods (`mock-runtime-bindings.spec.ts`).
- `cd51f214a` #15 `WorkflowEntry.hash` (sha256 of file text) and `SaveWorkflowArgs.baseHash`; mismatch returns `E_CONFLICT`; editor offers Reload / Overwrite. Flow test and UI spec.

## Declined

None.

## Notes

- #12 scan race: the re-apply after the import loop closes it; the scan is not serialised against `SetFolderHidden`, so a hide issued mid-scan takes effect when the scan ends. No deterministic test (timing race).
- #15 covers the graph editor only. `SaveWorkflowYaml` still writes the text as given.
- `rebaseGitDenied` blocks known exec-capable forms. A prefix rule cannot cover every flag order; the allowlist is the main control.

## Verified

`bun run test:unit` all pass; Go tests for scriptruns, claudeheadless, docker, adeflow, storage, repoflow, termflow pass (`TestRebaseRun` flaked once under load, passes alone); Space `ui` project 455 pass; Space visual `git-module` 7 pass; Studio `docker` ui 26 pass.
