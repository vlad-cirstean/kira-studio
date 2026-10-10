# P259 result

Plan `P259-hide-git-repos.md`, defaults D1-D14 taken. Facts live in `docs/ARCHITECTURE.md`
("Repository list (P190)").

## Commits

1. `feat(space): hidden flag for repos and scan folders` — migration 0032, model, storage, `ImportOptions.Hidden`, `importFolder`.
2. `feat(space): bound SetRepoHidden and SetFolderHidden` — bridge, adewire, `TaskBoard`, D10 re-import, bindings use, `wire.ts`, fixtures, flow tests, contract `repos-hidden`.
3. `feat(space): hide repos in the Git panel` — `repoVisibility` store, `GitPanel`, `repoHeads`, `coderepos` helpers.
4. `feat(space): remove and hide in the repository head` — `ReposDialog`, folder Hide all, `useSetFolderHidden`.
5. `test: clear the three biome warnings`, `test(space): hidden repo UI specs and repos dialog baseline`.
6. `style(space): gofmt adewire` — `lint:go` caught it after commit 2.
7. `docs: P259 architecture and result`.

## Verified

- Flow: `TestHideRepo`, `TestHideFolder`; coverage gate; all Space flow packages pass.
- UI (Space `ui` project): `repos-dialog`, `git-panel-hidden`, `git-panel-tab`, `color-rails`, every `repo-*`, `git-*`, `ade-v2-*`, `automations-editor`, `mode-switch`: 305 pass. Studio `automations-editor`: 7 pass.
- Visual: `test:visual:space` compare (no update), 13 pass.
- `lint`, `lint:go`, `lint:dead`, full `typecheck` clean.

## Baselines

New only: `git-repos-dialog-visual-linux.png` (dialog with the repo head and one hidden nav row).

## Deviations

- `confirmRemoveCodeRepo(id, name)` takes no `source` argument: it reads the repo's scan folder from the cached `AdeTask.Repos` query, so the Git panel row menu needs no ADE query of its own.
- `repoVisibility.listed` filters top-level repos only through `repoLinks`; `refreshRepoHeads()` with no ids now sends the listed ids (hidden excluded, no call when empty).
- Mock wiring (ipc channels, FQN map, push mapping, fixtures `hidden`) landed in commit 2 so its typecheck passed; plan put it in group 5.
- No interpolated variables surface in this feature, so no `VarText` use. The unused `preview` contract in both `automations-editor.spec.ts` now drives the `[data-var]` assertion instead of being deleted.
- `TestRebaseRun` (adeflow, ade rebase, unrelated to P259) times out on 20 s waits when the full package runs under machine load (load average ~20); it fails identically on the base commit `874a2e6b0`, passes alone and with `-parallel 2`. Not changed here.
