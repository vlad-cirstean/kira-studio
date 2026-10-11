# P265 Stream C findings

## Stream C result

Branch `p265-c`, base `51527fd7e`. All chunks hook-green with a normal hook. Typecheck and lint ran
per commit; no UI, visual, e2e or unit suite ran.

### Commits

| Chunk | Commit |
|---|---|
| C1 git shell and lists | `4fdbc079d` |
| C2 git lists and dialogs | `f1fffde2a` |
| C3 git dialogs, review, state | `5f9d93fa0` |
| C4a Docker | `c73df4c8a` |
| C4b Docker | `fd11e2349` |
| C5 Automations | `96bec73e2` |
| C6 workbench shared components | `73ffe590d` |
| C7 sweep | `d5bcda4ad` |
| Four §4.3 specs | `0d9afa666` |

### Done

- Every owned file moved to the catalog under `git`, `docker`, `automations`, `workbench`.
- C7 sweep covered helper and model `.ts` files that `check-copy` misses: row accessibility,
  search results, stash, stack and ref list models, review files, run script, force push empty tip.
- Setup-time `t()` constants became `computed` so they follow locale switches: operations log
  status filter, runs filter, script dialog tabs, schedule presets, row density items.
- Unit tests updated for changed strings: `stackListModel.test.ts`, `reviewFiles.test.ts`.
- Studio specs updated in C5 for reworded automations text.

### Allowlist remaining

`scripts/copy-allowlist/stream-c.txt` holds only permanent lines:

- U64 `automations/run/RunPreview.vue`: `--tools` and `--allowedTools` are claude CLI flag names shown as the command line.
- U64 `automations/smart/ToolsField.vue`: `--allowedTools` is a claude CLI flag name shown as the command line.

### Deviations

- Container delete confirm has no flow in the app. The spec pins the recreate confirm instead
  (`Recreate container?`, `Recreate now`).
- Branch row menu pins `Rename`, not `Rename…`: the shared `common.action.rename.label` has no
  ellipsis and renaming from the picker is an inline field.
- No delete branch dialog exists. The spec pins the force delete prompt (`“name” is not fully
  merged.`, `Force delete`).
- Force push body gets a second message when the remote has no tip, replacing the literal
  `nothing yet`.
- Search field labels, ref decoration labels and stack counts are now capitalised catalog text,
  reusing `common.field.name.label`, `git.commit.committer.label`, `git.toolbar.stash.label` and
  `git.review.commits.count.label` where text matched.
- `Apply here (from {origin})` keeps its wording.

### Specs written, not run

- Studio `apps/kira-studio/tests/ui/copy-wording-docker-automations.spec.ts`
- Studio `apps/kira-studio/tests/ui/copy-coverage-docker-automations.spec.ts`
- Space `apps/kira-space/tests/ui/copy-wording-git.spec.ts`
- Space `apps/kira-space/tests/ui/copy-coverage-git.spec.ts`

All four typecheck and lint clean. Expect tuning when the serial test agent runs them:

- Coverage `allow` patterns for fixture data may need widening.
- Git dialog triggers rely on mocked preflight shapes (`preflight.*`, `remote.pushPreflight`,
  `remote.pullPreflight`, `repoSettings.get`); a shape mismatch shows as a missing dialog.
- Load failure spec forces the boot error with `'app.init': null`.
- Pseudo-locale is set after the surface mounts; a surface that caches `t()` at setup would fail.

### Needs from non-owned files

None.
