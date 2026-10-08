# P222 plan: Repositories dialog restyle, per-repo colour, environments explained

Base: `776abcbc3` (P219-P222 user fixes), branch `v22-fix-D`.

## Ask (user's words)

"for adding repos the dialog looks quite different than the design of the app, fix it. Also i should
be able to choose the color per repo like in other places. Then i don t understand how that add env
works there. It should allow me to add a script or what?"

Out of scope: Mobile access pane (`MobileAccessPane.vue`); P223 owns it. Do not touch it.

One sequential Sonnet implementer. No stream split: parts A-C share `RepoConfigForm.vue`,
`ReposDialog.vue` and the `repos-dialog.spec.ts` file.

## What exists today (verified on disk)

The "add-repo dialog" is Kira Space's **Repositories dialog**:
`apps/kira-space/frontend/src/repo/ReposDialog.vue`, opened by `useReposDialogStore().show()` from
`GitStart.vue` ("Manage repositories…"), `GitPanel.vue` (header button `manage-repos`, repo row menu)
and `ade/AdeView.vue` (`ade-import`). The right pane is `repo/RepoConfigForm.vue`; one environment row
is `repo/RepoEnvRow.vue`. It is not in `packages/git-ui` (that package's `RepoSettingsDialog.vue` is the
VS Code graph's own per-repo settings, untouched here).

How it differs from the app's dialog design (`packages/workbench/src/components/SettingsShell.vue`,
`packages/workbench/src/memory/AddMemoryDialog.vue`, `packages/workbench/src/terminal/QuickCommandsDialog.vue`):

- `:show-close-button="true"`: shadcn's absolute `XIcon` corner button. Every app dialog uses
  `:show-close-button="false"` plus a `DialogClose` ghost `size="icon-sm"` button with
  `CodiconIcon name="close"` inside `DialogHeader`, `ml-auto`.
- `DialogHeader class="border-b-0 pb-0"` overrides the shared header border and padding; no leading
  codicon (SettingsShell has one).
- Top `Tabs` strip with `tabChipVariants` chips ("Repositories" / "Scan folders"). No other dialog
  uses chip tabs; SettingsShell uses a left `nav` of `h-5.5 px-1.5 rounded-kira-sm text-kira-md`
  buttons, `bg-select text-fg` active, `text-muted-foreground hover:bg-hover` idle.
- `h-4/5 max-w-5xl` (up to 1024 px wide); app dialogs use a fixed px width/height (`width: 680`,
  `height: 520` for Settings; `w-150` for Add memory / quick commands).
- Pane padding `p-4`, form `gap-5`; app panes use `p-3` and `gap-2`/`gap-3`.
- "Import repository…" sits in a `h-bar` strip above the list, "Remove repository" (`dialog-danger`)
  in a `h-bar` strip above the form. No `DialogFooter` at all; every other dialog has one.
- `DialogDescription class="sr-only"`: keep (a11y).

Repo colour today: `ade/v2/palette.ts` `repoColor(codeRepoId)` hashes the id into the 20-slot hex
work palette. Users cannot choose it. Callers (all ADE): `AdeRepoTag.vue`, `AdeCandidateRow.vue`,
`AdeAddPopover.vue`, `plan/AdeRepoChip.vue`, `plan/AdeBranchRow.vue`, `panel/AdeTaskTab.vue`
(`AdeRepoTag` itself is used by `ReposDialog.vue`, `dialog/AdeClaudeDialog.vue`,
`review/AdeReviewHeader.vue`, `run/AdeRunDialog.vue`, `panel/AdeStageBlock.vue`). Git panel repo rows
(`GitPanel.vue` ~l.402) and repo tabs (`state/tabKinds.ts` `railColor: () => undefined`) show no colour.

"Other places" that let the user choose a colour: Studio connections (`ConnectionDialog.vue`, plus a
Colour submenu in `project/menus.ts:189`), API environments (`VariableSetView.vue`), terminal quick
commands (`QuickCommandsDialog.vue`, `CustomScript.color`). All three store a `PaletteColor`
(`packages/shared/domain/color.ts` `paletteColorSchema`), offer `PALETTE_COLOR_CHOICES`, and render
each swatch with the shared `packages/theme/src/SwatchRadio.vue` inside a `fieldset` +
`Tooltip`. There is no shared picker component on purpose: P104 §3 inlined the old `ColorPicker`.
Follow that: inline the same `SwatchRadio` loop, do not resurrect a picker component. Paint goes
through `packages/theme/src/connColor.ts` (`connColorVar`, `connBgClass`, `connTextClass`); the
TabStrip rail already reads `host.railColorFor(tab)` through `connColorVar`.

Go palette validation exists twice: `internal/quickcommands/quickcommands.go` (`paletteColors`,
private) and `apps/kira-studio/internal/storage/model/connection.go` (`ValidPaletteColor`). Kira Space
storage has none.

Where repo identity lives: `code_repos` (`0001_init.sql`: id, name, root, repo_id, sort_order,
created_at), Go `model.CodeRepo` (`internal/storage/model/coderepos.go`), `CodeReposRepo`
(`internal/storage/repos/coderepos.go`: List/Get/Create/Rename/Reorder), bound via
`internal/bridge/codeworkspace.go` (`ImportRepo`, `RenameRepo`, `ReorderRepos`, each calling
`s.reposChanged()`), TS `RepoSummary` (`packages/shared/domain/repo.ts`), Pinia
`state/coderepos.ts` (`records`, live via `control.onAdeTaskRepos` push, used by GitPanel, tabKinds,
ReposDialog). `ade_repo_config` (nickname, source) is ADE config keyed by code_repo_id and travels on
the P143-frozen `adewire.Repo` contract.

### What "Add environment" does (plain answer for the user)

It is **deployment tracking**, not worktree setup and not env vars. Each environment is a name
(`staging`, `prod`) plus a shell command that prints the commit SHA currently deployed there, for
example `curl -s https://staging.example.com/version`. Kira runs each command in the repo root
(`ade/deploy.go` `runEnvScript`, 60 s cap, first stdout line matching `^[0-9a-f]{7,40}$`) on board
refresh (`workflows.go:139` `RunAllEnvScripts`) and after the list changes (`refreshEnvScripts`).
The result marks branches `▲staging ✓` (deployed), `▲staging ⚠` (stale) or `▲staging ?` (script
failed) in `board/labels.ts`, and fills the environment rows of `panel/AdeBranchPanel.vue`.

So yes, it already takes a script, but the UI never says what for. Worse, it is broken: `addEnv()`
in `RepoConfigForm.vue` immediately writes `{ name: 'new-env', deployedShaScript: '' }`, and
`validateEnvironments` (`ade/repoconfig.go:201`) rejects an empty script ("environment "new-env"
needs a script"). Clicking "Add environment" always fails with an error and adds nothing.

The script the user likely wants for setup already exists in the same form: **Prepare worktree**
(`kiraSpace.worktree.prepareScript`, runs in every new worktree before an agent starts, with its own
timeout). Code evidence gives no per-repo "terminal setup" or env-var hook beyond that, so no new
setup-script feature is planned (see Deferred). The fix is UX: name and explain both scripts, and
make Add work.

## Design decisions

D1. **Colour lives on `code_repos`, written through `CodeWorkspaceService`.** It is repo identity like
`name`, read by GitPanel, tabs, ReposDialog and ADE through one live Pinia store. Putting it on
`ade_repo_config` would force a P143 wire-contract change and give non-ADE surfaces no reactive path
(TanStack `useRepos()` cannot be read from `tabKinds.ts`). New bound method `SetRepoColor`, mirroring
`RenameRepo`.

D2. **Stored value is always a `PaletteColor` name, never empty.** Migration backfills existing rows
with a rotation over six offered hues; `Create` assigns the next hue by `sort_order`. `'none'` means
"no colour" exactly as for connections. No "automatic" state to special-case anywhere, and the picker
always shows the real current value.

Rotation (offered, non-grey, adjacent-contrast order): `blue, amber, magenta, green, red, cyan`.

D3. **Retire `repoColor()` hashing; all repo paint goes through `--kira-conn-*` tokens.** Users see
every repo's colour change once (20 hex hues to 6-8 tokens). Accepted: a chosen colour must look the
same in ADE, Git panel and tabs, and only the token palette is shared with the rest of the app.
`taskColor()` and the 20-slot `PALETTE` stay (task work colours), so `scripts/check-ade-colours.sh`'s
allowlist is unchanged.

Tint recipe (Tailwind, no hex alpha concat): set `style="{ '--repo': connColorVar(color) }"` and use
`bg-(--repo)/12 text-(--repo)` (border: `border-(--repo)`). For `'none'` (`connColorVar` returns
undefined) use neutral classes `bg-hover text-muted-foreground`. Same `--var` pattern TabStrip already
uses (`bg-(--kira-rail)`).

D4. **One shared Go palette.** New `internal/palette` package: `Valid(name string) bool` (full
storable 13-name set, mirrors `paletteColorSchema`) and `AutoRepoColor(n int) string` (the D2 rotation).
`internal/quickcommands` drops its private `paletteColors` map and calls `palette.Valid`. Studio's
`model.ValidPaletteColor` stays (different module path ownership; out of scope, not a duplicate this
phase introduces).

D5. **Restyle = SettingsShell's shape, not a new pattern.** Header icon + title + ghost close;
left nav; right pane `p-3`; footer. Repos and "Scan folders" both become nav entries. Fields keep
autosave-on-blur (`useCommitField`), so the footer carries Close, not Save/Cancel.

D6. **Environments: fix Add, explain both scripts.** Add creates a local draft row; it is written
only when name and command are both non-empty. Copy states what the command must print and when it
runs.


## Part A: per-repo colour, backend

1. `internal/palette/palette.go` (new): D4. Doc comment says it mirrors
   `packages/shared/domain/color.ts`.
2. `internal/quickcommands/quickcommands.go`: delete `paletteColors`; `Validate` uses `palette.Valid`.
3. `apps/kira-space/internal/storage/migrations/0023_p222_code_repo_color.sql` (new):
   ```sql
   ALTER TABLE code_repos ADD COLUMN color TEXT NOT NULL DEFAULT 'none';
   UPDATE code_repos SET color = CASE sort_order % 6
     WHEN 0 THEN 'blue' WHEN 1 THEN 'amber' WHEN 2 THEN 'magenta'
     WHEN 3 THEN 'green' WHEN 4 THEN 'red' ELSE 'cyan' END;
   ```
   Check `migrations/embed_test.go` for a count/list assertion and update it.
4. `internal/storage/model/coderepos.go`: `Color string \`json:"color"\``; `Validate` rejects a value
   `palette.Valid` refuses.
5. `internal/storage/repos/coderepos.go`: add `color` to `codeReposSelectColumns`, scan, and the
   `Create` insert (`rec.Color = palette.AutoRepoColor(sortOrder)` when empty). New
   `SetColor(id, color string) (model.CodeRepo, error)`, shaped like `Rename` (validate, update, re-get,
   not-found error).
6. `internal/bridge/codeworkspace.go`: `CodeWorkspaceSetColorArgs{ID, Color}`; `SetRepoColor` method:
   `BadRequest` on empty id or `!palette.Valid`, call `SetColor`, `s.reposChanged()` on success,
   `ipcerr.InternalResult`. Regenerate Wails bindings (untracked, build regenerates).
7. Every Go test or fixture that builds or compares a `model.CodeRepo` (grep `model.CodeRepo{` under
   `apps/kira-space`) gets the field. No new Go unit test: `SetColor` is a one-condition CRUD path
   (CLAUDE.md test bar).

Commit: `feat(space): per-repo colour stored on code repos`.

## Part B: per-repo colour, frontend

1. `packages/shared/domain/repo.ts`: `color: paletteColorSchema` on `repoSummarySchema`.
2. `apps/kira-space/frontend/src/bridge/index.ts`: `codeWorkspaceSetRepoColor(id, color)` next to
   `codeWorkspaceRenameRepo`.
3. `state/coderepos.ts`: `setCodeRepoColor(id, color)` (upserts the returned record, same as rename)
   and getter `colorOf(id): PaletteColor` returning `codeRepoRecord(id)?.color ?? 'none'`.
4. `ade/v2/palette.ts`: delete `repoColor`. Each former caller reads
   `useCodeReposStore().colorOf(codeRepoId)` and applies the D3 recipe:
   `AdeRepoTag.vue`, `AdeCandidateRow.vue` (text only: `text-(--repo)`), `AdeAddPopover.vue`
   (tint + border), `plan/AdeRepoChip.vue`, `plan/AdeBranchRow.vue`, `panel/AdeTaskTab.vue`.
   Put the style/class pair in one place: a `repoTint(color)` helper next to `colorOf` in
   `state/coderepos.ts` returning `{ style, class }`, so six components do not each re-derive it.
5. `repo/GitPanel.vue` repo row: the `source-control` icon takes `connTextClass(color)` when the colour
   is not `'none'` (Studio's `StudioStart.vue` `iconColorClass` precedent), else today's
   open/closed muted classes. Repo row context menu (`onRepoContextMenu`) gains a "Colour" submenu
   built exactly like Studio's `project/menus.ts:189` (`PALETTE_COLOR_CHOICES`, `swatch`), selecting
   calls `setCodeRepoColor`.
6. `state/tabKinds.ts`: repo-graph, repo-file, repo-diff, repo-multi-diff `railColor` return the
   tab's repo colour (same `codeRepoRecord(tab.workspaceId)` lookup the repo-graph `title` uses;
   undefined for `'none'`). Terminal kind unchanged. The graph tab's rail is the graph header colour;
   `packages/git-ui` (shared with the VS Code extension) is not touched.
7. Colour picker in the Repositories dialog: Part C step 4.

Commit: `feat(space): choose and show each repository's colour`.

## Part C: Repositories dialog restyle and environments

`repo/ReposDialog.vue`:

1. `DialogContent :show-close-button="false" class="flex flex-col gap-0 p-0"` with a fixed size
   `w-190 h-140 max-w-[90vw] max-h-[85vh]` (760x560; Settings is 680x520, this has a list plus a long
   form). Keep `data-testid="repos-dialog"`.
2. `DialogHeader` (no overrides): `CodiconIcon name="repo"` in the same `size-4 text-muted-foreground`
   span SettingsShell uses, `DialogTitle` "Repositories", `DialogDescription class="sr-only"`,
   `DialogClose as-child` ghost `icon-sm` button `data-testid="repos-dialog-close"`.
3. Body `flex flex-1 min-h-0`:
   - Left `nav` `w-52 shrink-0 flex flex-col border-r border-border`: scrolling list
     (`flex-1 overflow-y-auto py-1.5 px-1 gap-px`, `role="listbox"` kept) of repo buttons styled as
     SettingsShell nav items, each with a `size-2 rounded-full` dot (`connBgClass(color)`, hidden for
     `'none'`), nickname-or-name, `title=root`. Keep `data-testid="repos-dialog-repo"` and
     `data-repo-id`. Below a `border-t`, one nav item "Scan folders" with `CodiconIcon folder`, keep
     `data-testid="repos-dialog-tab-folders"`; active when `dialog.tab === 'folders'`. Clicking a
     repo sets `dialog.tab = 'repos'` and `selectedRepoId`. Bottom of the nav: `Import repository…`
     (`variant="dialog" size="kira-lg" class="m-1.5"`, keep `repos-dialog-import`).
   - Remove `Tabs`/`TabsList`/`TabsTrigger`/`tabChipVariants` and the `repos-dialog-tab-repos`
     chip. `ReposDialogTab` and `show({ tab })` stay.
   - Right `section class="flex-1 min-w-0 overflow-y-auto p-3 flex flex-col gap-3"`: the error
     `Alert` at its top; repos pane = `RepoConfigForm`; folders pane = today's folder rows, same test
     ids, `p-3` spacing.
4. `DialogFooter`: left, when a repo is selected and `tab === 'repos'`, the `dialog-danger`
   "Remove repository" button (keep `repos-dialog-repo-remove`); right (`ml-auto`), `Close`
   (`variant="dialog"`, `DialogClose as-child`). Folder note text (`repos-dialog-note`) moves to the
   footer's left when the folders pane is shown.

`repo/RepoConfigForm.vue`, grouped into headed sections (`h3 class="text-kira-lg"`, GitPane's style),
`gap-3` inside, outer `gap-4`, drop `max-w-4xl`:

1. **Repository**: Nickname (unchanged), then **Colour**: a `fieldset` of `SwatchRadio` over
   `PALETTE_COLOR_CHOICES` with `Tooltip`s, copied from `QuickCommandsDialog.vue`'s colour block
   (`name="repo-color"`, `aria-label="Colour"`, `data-testid="repo-color"` on the fieldset; the
   radios' own `color-<name>` test ids come from `SwatchRadio`). Change calls
   `codeRepos.setCodeRepoColor(codeRepoId, color)`; a rejection shows `FieldError`
   `repo-color-error`. Current value from `codeRepos.colorOf`. Then the existing `dl` (Repo, Path,
   Source).
2. **Worktrees**: Prepare worktree (copy: "Setup script. Runs in the root of every new worktree of
   this repo, before any agent starts; for example `pnpm install`. A non-zero exit marks setup as
   failed."), Timeout, Worktree base path. Unchanged behaviour.
3. **Branches**: Integration branches, unchanged.
4. **Deployment environments** (rename from "Environments"). Description: "Track which commit each
   environment runs. For each one, give a command that prints the deployed commit SHA, for example
   `curl -s https://staging.example.com/version`. Kira runs it in the repo root when the board
   refreshes and marks branches deployed there." Empty state line when there are none.
   - Column labels above the rows ("Name", "Command that prints the deployed SHA"), visible, not
     `sr-only`; inputs keep their `sr-only` labels per row for a11y ids.
   - Placeholders: name `staging`, command `curl -s https://…/version`.
   - **Add fix**: `addEnv()` no longer writes. It appends a local draft
     (`drafts: Ref<Array<{ key, name, deployedShaScript }>>`) rendered after the persisted rows with
     the same `RepoEnvRow`, name input focused (`useTemplateRef` + `focus()` on next tick). A draft
     row's `save` puts the field into the draft and, only once both trimmed fields are non-empty,
     writes `[...repo.environments, draft]`; on success the draft is dropped (the persisted list now
     carries it, key handed over so the row keeps its DOM). Removing a draft is local only. A failed
     write keeps the draft and shows `repo-env-error`.
   - "Add environment" disabled while a draft is still incomplete (one draft at a time).
5. `repo/RepoEnvRow.vue`: accept `autofocus?: boolean`; nothing else structural.

Commits: `feat(space): Repositories dialog matches the app's dialog design` (ReposDialog + form
layout), `fix(space): Add environment no longer saves an empty script` (draft flow + copy).

## Tests

UI specs only (CLAUDE.md test bar; no new unit tests).

- `apps/kira-space/tests/ui/repos-dialog.spec.ts`:
  - `openFolders` keeps working (nav item keeps `repos-dialog-tab-folders`).
  - New: picking a swatch sends `SetRepoColor` with `{ id, color }`; the nav dot and a mocked push
    re-read show it. Add the channel to `tests/ui/support/ipcChannels.ts` and a default mock in
    `support/mockRuntime.ts`/`adeV2.ts` as those files already do for `RenameRepo`.
  - New: "Add environment" sends nothing until name and command are filled; then one patch whose
    `environments` ends with the new entry.
  - Existing "each field sends a one-leaf patch" and remove/import tests updated only for moved
    controls.
- `codeWorkspaceListRepos` fixtures (`tests/fixtures/ade-v2/*.json` where they carry repo records,
  `tests/ui/support/*`, `tests/unit/support/adeV2Fixtures.ts`) gain `color`. Fixture files are
  P143-frozen for the `adewire` contract only; `RepoSummary` is not that contract, but if a frozen
  fixture holds `RepoSummary` rows, adding `color` there is the needed change: note it in the commit.
- ADE specs touching repo tags (`ade-v2-*.spec.ts`) must still pass; none asserts `repoColor` hex.

Visual baselines: `apps/kira-space/tests/visual/settings.spec.ts` covers Appearance, Git, Connected
editors, Advanced only. No
shared dialog primitive changes, so the four baselines must not move. Run `bun run test:visual:space`
once to prove it; a diff there is a bug in this phase, not a re-record. No new baseline for the
Repositories dialog.

## Verification (once, near phase end)

1. `go build ./... && go test ./internal/palette/... ./internal/quickcommands/... ./apps/kira-space/...`
2. `bun run typecheck && bun run lint` (lint includes `check-ade-colours.sh`; confirm `repoColor` is
   gone: `grep -rn "repoColor" apps/kira-space/frontend/src` returns nothing).
3. `bun run test:ui:space` (full; ADE specs render repo tags) and `bun run test:visual:space`.
4. Real checks the orchestrator repeats: `grep -rn "SwatchRadio" apps/kira-space/frontend/src/repo`
   (picker exists), `grep -n "show-close-button=\"false\"" apps/kira-space/frontend/src/repo/ReposDialog.vue`,
   `grep -n "tabChipVariants" apps/kira-space/frontend/src/repo/ReposDialog.vue` (none),
   `grep -n "railColor" apps/kira-space/frontend/src/state/tabKinds.ts` (repo kinds no longer
   `() => undefined`), `grep -rn "palette.Valid" internal/quickcommands apps/kira-space/internal`.
5. Manual (`bun run dev:space`): open Repositories from Git panel; compare side by side with
   Settings and Add memory; pick a colour, see it on the nav dot, Git panel icon, repo tab rail and
   ADE repo tags; add an environment with `echo $(git rev-parse HEAD)`, refresh the board, see the
   `▲name ✓` chip.

## Docs

- `docs/ARCHITECTURE.md` Kira Space section: `code_repos.color` (PaletteColor, auto rotation at
  import, written by `CodeWorkspaceService.SetRepoColor`, painted through `--kira-conn-*` on every
  repo surface; ADE work palette now tasks only). One line explaining deployment environments
  (command prints deployed SHA, run on refresh) next to the `ade_repo_envs` mention.
- `docs/v2.2/SPEC.md`: P222 result section and status row at the end, by the implementer.

Commit: `docs: P222 result`.

## Deferred decisions

1. **Per-repo setup script beyond Prepare worktree.** No code evidence for a separate terminal/env
   setup hook; Prepare worktree already is the per-repo setup script. Not built. If the user wants
   one for plain terminals (not worktrees), that is a new phase.
2. **"Test" button per environment** that runs the command and shows the SHA or error inline. Needs a
   new bound method and a wire change; better feedback, but the board chips already report failures.
   Ask the user.
3. **Studio `model.ValidPaletteColor` onto `internal/palette`.** Same duplication, different app;
   fold in at the next review round if wanted.
4. **Repo colour in the mobile web app.** It shows no repo colours today; not added.
