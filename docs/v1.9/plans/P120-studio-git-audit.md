# P120 — Kira Studio git-leftover audit and removal: plan

Opus planning pass. Plan only — nothing here is implemented yet. Base: `94e9d961`. Sites are
`file:line` against that commit. The implementer re-reads each site before editing.

Runs after P119 lands (table order). P119 edits `ST/main.go`, `ST/internal/bridge/update.go`,
`WB/bridge/createCoreControl.ts`, both apps' `bridge/index.ts`, both apps'
`tests/ui/support/{mockRuntime,ipcChannels}.ts` and `docs/ARCHITECTURE.md`. Rebase onto P119's
result first; line numbers in those files will drift.

Path shorthands: `ST/` = `apps/kira-studio/`, `SF/` = `apps/kira-studio/frontend/src/`,
`KS/` = `apps/kira-space/`, `KF/` = `apps/kira-space/frontend/src/`, `WB/` =
`packages/workbench/src/`, `AS/` = repo-root `internal/appsettings/`, `SD/` =
`packages/shared/domain/`.

## §0 Goal, method, acceptance

**Goal.** User ask, verbatim: "there are still git related stuf in kira studio, audit and make sure
nothing about git is actually left there in the kira studio app. Check it all not just the settings
page." Kira Studio is a database/API client. After P120, no Studio setting, UI copy, bound service,
test mock, config entry or comment refers to git, repositories, worktrees, blame, the git graph,
VS Code pairing, or deleted git-module files. Shared code Studio pulls in carries no Space-only git
setting either. Kira Space behavior, UI, stored keys and tests stay unchanged.

**Method.**
- CodeGraph `codegraph_explore` (6 calls, see §6) on: a survey of git surface in `ST/`;
  `appsettings.{Git,AdvancedCore,Appearance}` callers; appearance/git/log-level schemas and
  `DateFormatField`; Studio terminal-tab repo fields; `LinkService` callers; custom-script
  `workingDir` default. The index is the main checkout's (the worktree has none); it matched the
  worktree base for every symbol read.
- Grep sweep of all of `ST/` (Go, TS, Vue, JSON, YAML, build files, tests) for `git`
  (case-insensitive) plus a git-vocabulary list (§5.3). Every hit classified in §1 (fix) or §2
  (keep). Settings is one area of many.
- Cross-checked Studio's repo-root imports: `appevent`, `appsettings`, `appstorage`, `appupdate`,
  `ipcerr`, `jsonx`, `keepawake`, `kirapaths`, `kiratime`, `layeringtest`, `localsock`, `logging`,
  `metrics`, `notify`, `shell`, `sqlitex`, `startupfail`, `terminal`, `testx`, `tokenauth`,
  `toolexec`. None is git-specific. No `rpcstream`, `gitsock`, `gitclient` or `packages/git-*`
  import exists. `ST/frontend/package.json` deps are `@kira/api-core`, `@kira/kira-ui`, `zod` only.
- Only `appsettings` carries git surface into Studio (§1.1-§1.4). Fix it at the source (relocate
  Space-only fields into Space), never by hiding them in Studio's UI.

**Acceptance.**
1. Every §1 item fixed as specified, one commit per §4 row, fast checks green per commit.
2. §5.3 greps return exactly the stated counts.
3. Studio DB: migration `0028` renames `advanced.gitLogLevel` and deletes dead git/appearance
   leaves. Space needs no migration: its stored keys and wire shape are unchanged.
4. Full suites green once at phase end (§5.2), both apps.
5. `docs/ARCHITECTURE.md` no longer lists `LinkService` under Studio. Its Known-open-item on
   Studio's `LinkService` is deleted.

## §1 Inventory — leftovers (fix)

### §1.1 Studio Settings `git` section (protectedBranches, fetchAutoIntervalMinutes, gitPath, graphFontSize)

No Studio consumer. Stored keys `git.protectedBranches`, `git.fetchAutoIntervalMinutes`,
`git.path`, `git.graphFontSize`. Not rendered by any Studio pane, but hydrated, validated, saved and
bound over Wails.

| Site | Item |
|---|---|
| `ST/internal/storage/model/settings.go:69` | `Git appsettings.Git` field on `Settings` |
| `ST/internal/storage/model/settings.go:86` | `Git: appsettings.DefaultGit()` |
| `ST/internal/storage/model/settings.go:105-106` | comment on the git field |
| `ST/internal/storage/model/settings.go:151` | `Git *appsettings.GitPatch` on `SettingsPatch` |
| `ST/internal/storage/model/settings.go:253` | `appsettings.ValidateGit` call in `Validate` |
| `ST/internal/storage/repos/settings.go:45` | `result.Git = appsettings.ReadGit(stored)` |
| `ST/internal/storage/repos/settings.go:157` | `appsettings.UpsertGit` block |
| `ST/internal/bridge/settings.go:35-41` | P100 tombstone comment (`git.fetchAutoIntervalMinutes`, `GitRegistry`) |
| `SF/state/settingsDomain.ts:4` | `gitSettingsSchema` import |
| `SF/state/settingsDomain.ts:156-161` | `git:` schema entry |
| `SF/state/settingsDomain.ts:185` | `git:` patch entry |
| `SF/state/settingsDomain.ts:213-218` | `git:` defaults |
| `SF/state/settingsDomain.ts:13-21,126,145` | comments naming the git section |
| `SF/workbench/SettingsDialog.vue:48,56` | `git:` lines |
| `SF/workbench/settings/types.ts:17` | `'git'` in the `Pick<>` |
| `WB/state/createSettingsStore.ts:1,22` | `GitSettings` import; `SettingsShape` requires `git: GitSettings` |
| `WB/state/createSettingsStore.ts:90-95` | sets `--kira-graph-font-size` from `git.graphFontSize` (Space-only CSS var) |

### §1.2 Appearance "Inline blame" checkbox

Git blame "in the repository file viewer". Studio has no file viewer. Only consumer is Space
`KF/views/repo/useInlineBlame.ts`.

| Site | Item |
|---|---|
| `SF/workbench/settings/AppearancePane.vue:46-48` | `onInlineBlameChange` |
| `SF/workbench/settings/AppearancePane.vue:56` | `inlineBlameId` |
| `SF/workbench/settings/AppearancePane.vue:218-246` | FieldGroup, testids `settings-inline-blame`, `settings-reset-appearance-inlineBlame`, copy "repository file viewer" (:233) |
| `SF/state/settingsDomain.ts:199` | `inlineBlame` default |
| `AS/appsettings.go:18-19,62,88` | shared `Appearance.InlineBlame` field, default, patch |
| `AS/repo.go:57,127` | shared read/upsert of `appearance.inlineBlame` |
| `SD/settings.ts:46-49` | shared `inlineBlame` in `appearanceSettingsSchema` |

### §1.3 Appearance "Commit date" (`dateFormat`)

Helper copy: "The git graph's own commit timestamps". No Studio consumer.

| Site | Item |
|---|---|
| `SF/workbench/settings/AppearancePane.vue:8` | `DateFormatField` import |
| `SF/workbench/settings/AppearancePane.vue` (last FieldGroup) | `<DateFormatField>` usage |
| `SF/state/settingsDomain.ts:200` | `dateFormat` default |
| `WB/settings/fields/DateFormatField.vue` | shared field; Space is the only real user |
| `AS/appsettings.go:20-22,63,89,109-111,147-149` | `Appearance.DateFormat`, default, patch, `ValidDateFormat`, validation |
| `AS/repo.go:60,128` | read/upsert of `appearance.dateFormat` |
| `SD/settings.ts:50-55` | shared `dateFormat` in `appearanceSettingsSchema` |

### §1.4 Advanced "Git log level"

Live in Studio: `logging.SetLevel` is process-wide. The setting is real; its name, key, label and
copy are git leftovers. Studio's helper text is wrong: "Verbosity of kira-space's own diagnostic
log, for every repository."

| Site | Item |
|---|---|
| `SF/workbench/settings/AdvancedPane.vue:6,115-117` | `GitLogLevelField` import/usage, copy at :116 |
| `WB/settings/fields/GitLogLevelField.vue` | label "Git log level", testids `settings-git-log-level`, `settings-reset-advanced-gitLogLevel` |
| `ST/internal/storage/model/settings.go:17-27` | `AdvancedSettings` embeds `appsettings.AdvancedCore` (`GitLogLevel`); comment :17-20 |
| `ST/internal/storage/model/settings.go:115-121` | `AdvancedPatch` embeds `AdvancedCorePatch`; comment :115-116 |
| `ST/internal/storage/model/settings.go:211-212` | `GitLogLevel` validation |
| `ST/internal/storage/repos/settings.go:50,89` | key `advanced.gitLogLevel` |
| `ST/main.go:110-111` | comment and `logging.SetLevel(settings.Advanced.GitLogLevel)` |
| `ST/internal/bridge/settings.go:42-46` | comment and `GitLogLevel` live-apply |
| `SF/state/settingsDomain.ts:73-79,154,211` | "the git graph's own diagnostic log" comment, schema, default |
| `SD/settings.ts:59-64` | `gitLogLevelSchema`/`GitLogLevel` names |
| `AS/appsettings.go` (`AdvancedCore`, `AdvancedCorePatch`) | shared struct whose only field is `GitLogLevel` |
| `ST/internal/storage/repos/settings_test.go:15-65` | `TestSettingsRepo_DateFormatAndGitLogLevel{Default,RoundTrip,RejectInvalid}` |
| `ST/tests/ui/settings-apply-on-save.spec.ts:203-216` | asserts `settings-date-format` and `settings-git-log-level` |

### §1.5 `LinkService` (git-ui commit-body link opener)

No live caller in Studio. Space's `KF/repo/git/hostHandlers.ts:428` is the only caller of
`control.linkOpenExternal`, reached through the shared `createCoreControl`.

| Site | Item |
|---|---|
| `ST/internal/bridge/link.go` | whole file |
| `ST/internal/bridge/link_test.go` | whole file (:6 "the git module's bridge files"); `fakeBrowser` used only here |
| `ST/main.go:177` | `application.NewService(&bridge.LinkService{...})` (`browserOpener` stays, `UpdateService` uses it) |
| `SF/bridge/index.ts:13,422` | `LinkService` import, `link: LinkService` |
| `WB/bridge/createCoreControl.ts:11,24` | comments naming `linkOpenExternal`/`LinkService` |
| `WB/bridge/createCoreControl.ts:71` | `CoreBindings.link` |
| `WB/bridge/createCoreControl.ts:110,164` | `CoreControl.linkOpenExternal` type and body |
| `KS/internal/bridge/link.go:5-12` | header says "Kira Studio's own LinkService ... ported" |
| `docs/ARCHITECTURE.md:2210,3555-3562,4078-4087` | Studio listed as having `LinkService`; Known-open-item on it |

### §1.6 Dead push channel `ChannelCodeSearch` and git tombstones in Studio `events.go`

| Site | Item |
|---|---|
| `ST/internal/bridge/events.go:49-52` | `ChannelGitPairing`/`ChannelGitClientsChanged` tombstone, "Connected editors" |
| `ST/internal/bridge/events.go:53-57` | `ChannelCodeSearch` const and comment, unused in Studio |
| `ST/internal/bridge/events.go:59` | "ChannelGitPairing's own shape" |
| `ST/internal/bridge/events.go:62-64` | "exactly like ChannelCodeSearch above" |

### §1.7 Dead Studio test mocks for Space's `CodeWorkspaceService`

No Studio Go service by that name; no Studio spec references these.

| Site | Item |
|---|---|
| `ST/tests/ui/support/mockRuntime.ts:155-167` | 13 `codeWorkspace*` FQN entries |
| `ST/tests/ui/support/mockRuntime.ts:314-317` | comment on them |
| `ST/tests/ui/support/mockRuntime.ts:340-352` | default responses; comments on `hydrateCodeRepos`, "Git module", `repo-workspace.spec.ts` |
| `ST/tests/ui/support/ipcChannels.ts:23` | `quickOpen: 'kira:menu:quick-open'` |
| `ST/tests/ui/support/ipcChannels.ts:149-165` | `codeWorkspace*` entries, `codeSearch` |
| `ST/tests/ui/support/ipcChannels.ts:200-202` | comments referencing `codeSearch` |

### §1.8 tsconfig leftovers

| Site | Item |
|---|---|
| `ST/tsconfig.tests.json:11-17` | P92 comment on `graphStreamFixture.ts`/`@kira/git-ipc` |
| `ST/tsconfig.tests.json:24-25` | `@kira/git-ipc` and `@kira/git-ipc/codec` `paths` (file they served is deleted) |
| `ST/frontend/tsconfig.json:9-11,15-19` | C10 comments citing git-ui/git-ipc/git-core as reason for two flags |
| `ST/tests/unit/tsconfig.json:9-10` | same C10 comment |

The flags themselves stay (§2.6).

### §1.9 Repo-root config scoped to Studio paths

| Site | Item |
|---|---|
| `knip.json:120` | stale path `apps/kira-studio/internal/gitsearch/differential_test.go`; real file is `apps/kira-space/internal/gitsearch/differential_test.go` |
| `biome.json` Studio terminal override (~:200, ~:204) | messages say "mirroring repo/'s own rule"; Studio has no `repo/` |

### §1.10 UI copy: Scripts "Active repository" placeholder

Studio runs an empty-`workingDir` script in `terminal.DefaultCwd()`, the user's home directory
(`ST/internal/bridge/terminal.go:88-93`; `SF/terminal/TerminalPanel.vue:76-78`).

| Site | Item |
|---|---|
| `SF/workbench/settings/ScriptsPane.vue:204,263` | `placeholder="Active repository"` |
| `SD/scripts.ts:13` | comment "'' means the active repo workspace's own worktree directory" (Studio reads it too, and it is wrong for Studio) |

### §1.11 Stale git comments in Studio Go

| Site | Leftover reference |
|---|---|
| `ST/main.go:390` | "not on the git contract" |
| `ST/internal/bridge/terminal.go:13-17` | `gitstream.go`, `worktree.prepare` |
| `ST/internal/bridge/terminal.go:35` | `codeWorkspaceSvc.Shutdown()` |
| `ST/internal/bridge/terminal.go:89-90` | "worktree-cwd resolution" |
| `ST/internal/bridge/dbmcp.go:27,310-311,324,385,424,435-436` | `gitvsix`, `GitPairingRequest`, pairing precedents |
| `ST/internal/appcore/deps.go:44-46` | git-module reference |
| `ST/internal/dbmcp/approval.go:14-16,19,24-25,102-105,160` | `gitsock` `pairingTimeout`, G1 pairing prompt |
| `ST/internal/dbmcp/approval_test.go:77-78,161-162,217` | `gitsock` pairing broker |
| `ST/internal/dbmcp/server.go:105` | git reference |
| `ST/internal/mcpauth/token.go:2-3,45` | git token precedent |
| `ST/internal/agenthooks/shim.go:15`, `agenthooks.go:76`, `config.go:64` | git references |
| `ST/internal/mcpinstall/install.go:4-5,29,48,68,74,97-98,110` | `gitvsix`, `gitclient.NewRunner` precedents |
| `ST/internal/layering_test.go:26-30` | git packages in layering note |
| `ST/internal/storage/model/window.go:29-31` | git reference |
| `ST/internal/storage/model/tabs.go:22-24` | "repo:<code_repos.id>" scope |
| `ST/internal/storage/model/tabs.go:52-56` | "moved the whole repo workspace to Kira Space" tombstone |
| `ST/internal/storage/model/tabs.go:74-78` | repo-tab note |
| `ST/internal/storage/repos/customscripts.go:16,32,56` | `CodeReposRepo` precedents |
| `ST/internal/storage/repos/maskrules.go:15` | `coderepos.go` precedent |
| `ST/internal/storage/repos/repos.go:34` | "CodeRepos's own shape" |
| `ST/internal/storage/repos/connections.go:302` | `CodeReposRepo` precedent |

### §1.12 Stale git comments in Studio frontend and tests

| Site | Leftover reference |
|---|---|
| `SF/workbench/DbMcpApprovalDialog.vue:11-14,19` | `GitPairingDialog.vue`, "pairing's own trust prompt" |
| `SF/workbench/settings/DatabaseMcpPane.vue:17-20,84-89` | "Connected editors" |
| `SF/workbench/settings/ClaudeCodePane.vue:41` | "Connected editors" |
| `SF/workbench/settings/ScriptsPane.vue:21` | "Connected editors" |
| `SF/terminal/TerminalStart.vue:17` | `GitStart.vue` |
| `SF/views/grid/FilterToolbar.vue:117-118` | "GitPanel.vue's promptInput" |
| `SF/views/stream/StreamView.vue:392-393` | same |
| `SF/views/documents/DocumentView.vue:268-269,289-291` | same |
| `SF/views/documents/DocumentView.vue:507` | `RepoFileTree` |
| `SF/views/console/ConsoleView.vue:209-210` | "GitPanel.vue's promptInput" |
| `SF/api/VariableRow.vue:95-96` | same |
| `SF/api/VariableSetView.vue:155` | "a Git restore" |
| `SF/views/browse/BrowseView.vue:198` | `blameAnnotation.ts`'s `DEBOUNCE_MS` |
| `SF/views/grid/focusRequest.ts:1` | `views/repo/reveal.ts` |
| `SF/editor/MonacoHost.vue:28` | `views/repo/editors.ts` |
| `SF/editor/monacoLanguages.ts:6` | `views/repo/monarch/{mongo,redis}.ts` |
| `SF/shortcuts/state.ts:75-78` | tombstone (`GitPanel.vue`, `quickOpen`, repo workspace) |
| `SF/state/settings.ts:12-14` | tombstone ("Connected editors", `git.sock`, Git section) |
| `SF/state/mode.ts:9-12,62-65` | repo-workspace activation |
| `SF/state/terminals.ts:3-7` | `GitPanel.vue`, `views/repo/` |
| `SF/state/dbmcp.ts:22-23,39-40` | git pairing |
| `SF/state/terminalTabs.ts:5-9` | `codeRepoId`, `coderepos.ts` |
| `SF/state/tabKinds.ts:76-79,332-340` | worktree directory |
| `SF/state/customScripts.ts:6-8,14` | `repo/state/`, `hydrateCodeRepos()` |
| `SF/state/agentSessions.ts:55` | `state/blameStatus.ts` |
| `SF/state/tabs.ts:47` | `patchRepoFileTabState` |
| `SF/state/tabs.ts:123` | "Kira Space's dynamic per-repo workspaces" |
| `SF/state/tabDomain.ts:38` | "one worktree's directory" |
| `SF/bridge/index.ts:79-83` | `onQuickOpen` tombstone |
| `SF/main.ts:361-365` | `codeReposStore`, repo workspace, git-clients state |
| `SF/workbench/modes.ts:21-24,28` | `'git'` mode tombstone |
| `SF/workbench/TitleBar.vue:25-26` | Git mode tab |
| `SF/workbench/tabViews.ts:20-23,37-39` | repo-graph/file/diff entries, "repo-worktree" |
| `ST/tests/ui/mode-switch.spec.ts:81-82,302` | Git mode |
| `ST/tests/ui/terminal-module.spec.ts:6,23` | `repo-workspace.spec.ts` |
| `ST/tests/ui/terminal-module.spec.ts:42,87-91` | Git mode, per-repo terminal menu |
| `ST/tests/ui/settings-scripts.spec.ts:6` | "Connected editors" |

### §1.13 Build file tombstone

| Site | Item |
|---|---|
| `ST/build/darwin/Taskfile.yml:162-163` | `.vsix` tombstone comment |

## §2 Keeps (false positives, excluded by name in §5.3)

### §2.1 Substrings, not git

- `digit`/`digits` (many files).
- `legitimate`/`legitimately` (e.g. `ST/internal/datagrip/datasources.go:223`).
- `ST/internal/postman/aliases.go:55` — `$randomLongitude`/`longitude`.
- `ST/internal/bridge/collections_export_atomicity_test.go:141` —
  `…ReplacingIt` (case-insensitive `gIt`).
- `ST/frontend/src/views/shared/celleditor/{validate.ts:72,timestamp.ts:141,CellEditorView.vue:41,74,391}`
  and `ST/tests/unit/timestamp-epoch-fraction.spec.ts:4` — `validateFormat` contains `dateFormat`.
- `ST/tests/ui/tree.spec.ts:164` — English "latency to blame".
- `ST/tests/ui/data-view.spec.ts:1333` ("same pairing") and `ST/internal/tree/service.go:186`
  ("(v, source) pairing") — English "pairing".
- `ProjectTree.vue` references across `SF/project/**`, `SF/api/menus.ts`,
  `SF/workbench/panels/OperationsPanel.vue`, `SF/views/stream/state.ts`,
  `SF/state/viewCommands.ts`, `ST/tests/unit/sqs-mutation-never-polls.spec.ts` — Studio's own
  connection tree, not a repo tree.

### §2.2 GitHub, not git

- `github.com/…` Go import paths, including generated `internal/page/wire/*.go` flatbuffers imports.
- `github.com/keybase/go-keychain` comments in `ST/internal/secrets`.
- `ST/build/darwin/Taskfile.yml:45` — garble URL.
- `ST/internal/adapters/testsupport/matrix.go:79` — "GitHub Actions".
- `ST/tests/visual/README.md:12` — `.github/workflows`.
- `SF/workbench/StatusBar.vue:41` — "Opens GitHub in your browser." (release-page update check).

### §2.3 This repo's own git tooling (VCS and release, not app features)

- `ST/Taskfile.yml:13`, `ST/internal/buildinfo/buildinfo.go:10` — release workflow writes the git tag.
- `ST/build/config.yml:43,50,51,57` — `.git`, `.gitignore`, `.gitkeep`, `git_ignore: true`
  dev-watch excludes.
- `ST/internal/datagrip/datasources.go:19,223` — DataGrip files ".gitignore'd" in user projects.
- Developer-procedure comments: `git stash` in `ST/internal/adapterhost/data_test.go:137`,
  `router_reconnect_race_test.go:155`, `ST/internal/adapters/mongo/read_missingid_internal_test.go:16`,
  `read_internal_test.go:90`; `git show` in `ST/tests/unit/row-range-bounds.spec.ts:15`;
  "see git history" in `SF/views/shared/page/columns.ts:184-185`,
  `ST/tests/ui/cell-editor.spec.ts:751`, `WB/state/createSettingsStore.ts:122`.
- Test fixture path `/tmp/demo-repo/frontend` in `ST/tests/ui/{settings-scripts,terminal-module}.spec.ts`
  — an arbitrary absolute path.

### §2.4 Historical migrations (append-only)

- `ST/internal/storage/migrations/0016_g1_git_clients.sql`, `0017_g18_git_repo_settings.sql`,
  `0018_c5_code_repos.sql`, `0019`, `0024` comment, `0025`, `0026_p100_drop_git_tables.sql`, and
  their `embed.go` entries (:36, :37, :46, …). Editing shipped migrations breaks existing DBs.
- `tabs.workspace_id` column. Studio uses it for terminal tabs (`'terminal'`).

### §2.5 Shared-layer items with no git meaning for Studio

- `SD/tabs.ts:15-17` `TabScope` `'repo'` sentinel; Studio's `SF/state/tabDomain.ts:76`
  `terminal: 'repo'` is that sentinel's scope bucket for terminal tabs. Renaming a shared persisted
  enum is a Space-touching wire change outside this ask.
- `SD` `terminalTabStateSchema.codeRepoId` — shared, Studio passes `''`, Studio Go
  `TerminalOpenArgs` has no repo id. The `SF/state/terminalTabs.ts:5-9` comment about it is fixed
  (§1.12); the field stays.
- `CHANNEL.quickOpen`/`codeSearch` in `packages/shared/protocol/events.ts`, and
  `appevent.ChannelCodeSearch`. Space uses them; Studio no longer references them after §1.6/§1.7.
- Space-example comments in shared packages (e.g. `WB/settings/SettingsShell.vue:96`).
- `FONT_SIZE_RANGE` in `SD/settings.ts` — Studio's `appearance.fontSize` uses it.
- `biome.json` rule forbidding git packages from importing `**/apps/kira-studio/**`, and `knip.json`
  git-package workspaces — guard rails that keep git out of Studio.
- `scripts/verify-packaging.sh:155` — asserts Studio's bundle carries no `.vsix`. A packaging
  check, not a leftover.
- Mentions of "Kira Space" with no git content (e.g. `SF/workbench/TitleBar.vue:19`,
  `SF/workbench/StatusBar.vue:18`, `SF/workbench/SettingsDialog.vue:22`, "moved to apps/kira-space"
  phrasing only where §1 does not already rewrite it).

### §2.6 tsconfig flags that stay

- `allowImportingTsExtensions` (all three Studio tsconfigs): `packages/kira-ui` uses `.ts`
  specifiers, reached from Studio directly and via `WB/util/floatingPosition.ts`.
- `"types": ["bun-types"]` in `ST/frontend/tsconfig.json`: `WB/viteAppConfig.ts` reads
  `process.env`.
- `lib` in `ST/tsconfig.tests.json`.

## §3 Design

### §3.1 Relocate Space-only settings out of the shared layer

Rule: shared `AS/` and `SD/settings.ts` carry only fields both apps use. Space owns its git fields.

**Go, `AS/` to Space.**
- `AS.Git` becomes `model.GitSettings` in `KS/internal/storage/model/settings.go`.
  `AS.GitPatch` becomes `model.GitPatch`. `AS.DefaultGit` becomes `model.DefaultGitSettings`.
- `AS.ValidateGit`, `validFetchAutoIntervalMinutes`, `validGraphFontSize` move to the Space model
  (unexported where only the model calls them).
- `AS.ReadGit`/`AS.UpsertGit` move to `KS/internal/storage/repos/settings.go` as unexported
  `readGit`/`upsertGit`. They keep using exported `AS.LeafValid`/`AS.UpsertOptional`.
- `AS.AdvancedCore`/`AS.AdvancedCorePatch` are deleted. Space `AdvancedSettings` gets
  `GitLogLevel string \`json:"gitLogLevel"\`` directly; Space `AdvancedPatch` gets
  `GitLogLevel *string \`json:"gitLogLevel,omitempty"\``. Validation uses `AS.ValidLogLevel`.
- `AS.Appearance` drops `InlineBlame` and `DateFormat` (field, default, patch, validation, read,
  upsert). `AS.ValidDateFormat` moves to the Space model.
- Space model: `type Appearance struct { appsettings.Appearance; InlineBlame bool
  \`json:"inlineBlame"\`; DateFormat string \`json:"dateFormat"\` }`, plus `AppearancePatch`
  embedding `appsettings.AppearancePatch` with `*bool`/`*string` `omitempty` pointers. Embedding is
  proven flat on the wire by the existing `AdvancedCore` precedent. Defaults: `InlineBlame: true`,
  `DateFormat: "relative"` (today's shared defaults).
- Space repo reads `appearance.inlineBlame`/`appearance.dateFormat` after the shared appearance
  read, and upserts them after the shared upsert. Same keys as today.
- `KS/main.go:360` uses `model.GitPatch`. Callers `s.Git.ProtectedBranches` (`KS/main.go:345`) and
  `settings.Git.GitPath` (`KS/internal/bridge/codeworkspace.go:63`) are unchanged.
  CodeGraph showed no name collision in the Space `model` package.
- Update the `AS` package doc and the `AS.ValidLogLevel` comment to drop git wording.

**TS, `SD/settings.ts` to Space.**
- `gitSettingsSchema`, `GitSettings`, `FETCH_AUTO_INTERVAL_MINUTES_RANGE` move into
  `KF/state/settingsDomain.ts`.
- `appearanceSettingsSchema` drops `inlineBlame`/`dateFormat`. Space's `settingsDomain.ts` uses
  `appearanceSettingsSchema.extend({ inlineBlame: z.boolean().default(true), dateFormat:
  z.enum(['relative', 'absolute']).default('relative') })`, with matching patch/default entries.
- `gitLogLevelSchema`/`GitLogLevel` rename to `logLevelSchema`/`LogLevel` (same enum values).
  Update every Space import.

**`WB/state/createSettingsStore.ts`.**
- Drop `GitSettings` import and `git: GitSettings` from `SettingsShape`.
- Move the `--kira-graph-font-size` block (:90-95) into Space's `KF/state/settings.ts` extend hook
  (`onApplyAppearance`; Space's extend currently returns `{ extra: {} }`). Same variable, same value,
  same trigger.

**`WB/settings/fields/DateFormatField.vue`.** `git mv` to
`KF/workbench/settings/DateFormatField.vue`, typed on Space's `Settings['appearance']`. Testids and
copy unchanged (`KS/tests/ui/window-chrome.spec.ts:154`, `repo-workspace.spec.ts:431-432` use them).

Space wire shape, stored keys, testids and copy are unchanged. No Space migration.

### §3.2 Studio log level

- Studio `AdvancedSettings` drops the `AdvancedCore` embed and gets
  `LogLevel string \`json:"logLevel"\``. `AdvancedPatch` gets
  `LogLevel *string \`json:"logLevel,omitempty"\``. Validate with `AS.ValidLogLevel`.
- Repo: `AS.LeafValid(stored, "advanced.logLevel", &result.Advanced.LogLevel, AS.ValidLogLevel)`
  and `AS.UpsertOptional(tx, "advanced.logLevel", a.LogLevel)`.
- `ST/main.go` and `ST/internal/bridge/settings.go` read `.LogLevel`. Rewrite both comments without
  git wording (keep the P72 §9.2 reference only if still accurate).
- `SF/state/settingsDomain.ts`: `logLevel: logLevelSchema.default('info')` (same default as today),
  comment "Studio's own diagnostic log verbosity".
- `WB/settings/fields/GitLogLevelField.vue` becomes generic `WB/settings/fields/LogLevelField.vue`
  (`<script setup lang="ts" generic="K extends string">`, precedent `WB/settings/SettingsShell.vue`).
  Props: `advanced: Record<K, LogLevel>`, `leaf: K`, `label: string`, `selectTestId: string`,
  `isAtDefault(section: 'advanced', key: K): boolean`, `resetLeaf(section: 'advanced', key: K): void`.
  Reset testid is `` `settings-reset-advanced-${leaf}` ``. Helper text stays a slot.
- Studio `AdvancedPane.vue`: `leaf="logLevel"`, `label="Log level"`,
  `select-test-id="settings-log-level"`, helper "Verbosity of Kira Studio's own diagnostic log."
  Reset testid becomes `settings-reset-advanced-logLevel`.
- Space `AdvancedPane.vue`: `leaf="gitLogLevel"`, `label="Git log level"`,
  `select-test-id="settings-git-log-level"`. Space UI and tests unchanged.

### §3.3 Studio migration `0028_p120_drop_git_settings.sql`

Register in `ST/internal/storage/migrations/embed.go` as
`{Version: 28, Name: "p120_drop_git_settings", File: "0028_p120_drop_git_settings.sql"}`.

```sql
-- P120: Studio's git-only settings leaves are gone; its log level has its own key.
UPDATE settings SET key = 'advanced.logLevel' WHERE key = 'advanced.gitLogLevel';
DELETE FROM settings
 WHERE key LIKE 'git.%'
    OR key IN ('appearance.inlineBlame', 'appearance.dateFormat');
```

`settings` is `(key TEXT PRIMARY KEY, value TEXT NOT NULL)` (`0001_init.sql:3-6`). No
`advanced.logLevel` row can exist before 0028, so the `UPDATE` cannot hit the primary key.

### §3.4 `LinkService` out of Studio

- Delete `ST/internal/bridge/link.go` and `ST/main.go:177`.
- `git mv ST/internal/bridge/link_test.go KS/internal/bridge/link_test.go`. It is the only test of
  URL-scheme validation. Fix its package/import and `fakeBrowser` to Space's bridge types. Rewrite
  its :6 comment ("Space's LinkService URL-scheme guard").
- Rewrite `KS/internal/bridge/link.go:5-12` header: Space's own generic open-URL service for the
  git-ui host; drop the "ported from Kira Studio" history.
- `WB/bridge/createCoreControl.ts`: delete `CoreBindings.link`, `CoreControl.linkOpenExternal` and
  its body; fix comments :11, :24.
- `KF/bridge/index.ts`: add `linkOpenExternal: (url: string): Promise<void> =>
  unwrap(LinkService.OpenExternal({ url }))` to `spaceControl`. `LinkService` (:8) and `unwrap` (:32)
  are already imported. Drop the `link: LinkService` entry from the core-bindings object passed to
  `createCoreControl`, if present. `KF/repo/git/hostHandlers.ts:428` stays unchanged.
- `SF/bridge/index.ts`: drop import :13 and `link: LinkService` :422.
- Space mocks keep FQN `LinkService.OpenExternal` (`KS/tests/ui/support/mockRuntime.ts:31`).
- Regenerate bindings for both apps (`scripts/setup.sh` or `wails3 task common:generate:bindings`)
  so Studio's `linkservice.js` disappears. Bindings are gitignored; typecheck reads the regenerated
  tree.

### §3.5 Comment rewrites — rule

Per `CLAUDE.md`: comment only where code cannot say it. For each §1.6/§1.11/§1.12/§1.13 site:
- A tombstone (says only what moved or was deleted) is deleted whole.
- A precedent citation to a git-era file is rewritten to cite a live Studio precedent that shows the
  same idiom, or trimmed to the non-obvious *why* with no citation. Concrete replacements:
  - "GitPanel.vue's promptInput" `.$el` idiom: cite `ConsoleView.vue`'s `savedMenuTriggerEl` (in
    `ConsoleView.vue` itself, drop the citation).
  - `gitvsix`/`gitclient` precedents in `mcpinstall/install.go`, `bridge/dbmcp.go`: state the rule
    directly (absolute-path probe list, launchd PATH, function-field deps) without citing.
  - `gitsock` pairing broker precedents in `dbmcp/approval.go`, `approval_test.go`, `state/dbmcp.ts`,
    `DbMcpApprovalDialog.vue`: describe the approval queue's own FIFO/one-presented/timeout rule.
  - `CodeReposRepo`/`coderepos.go` precedents in `repos/{customscripts,maskrules,repos,connections}.go`:
    cite `MaskRulesRepo` (or `CustomScriptsRepo` inside `maskrules.go`) as the shape precedent.
  - "Connected editors" posture: cite 'Database MCP' only.
  - `GitStart.vue` in `TerminalStart.vue`: cite `StudioStart.vue`.
  - `views/repo/*` in `MonacoHost.vue`, `monacoLanguages.ts`, `focusRequest.ts`: drop the citation.
  - `blameAnnotation.ts` in `BrowseView.vue`: state "150ms debounce".
  - `VariableSetView.vue:155` "a Git restore": "a history restore".
  - `DocumentView.vue:507` "ProjectTree/RepoFileTree": "ProjectTree".
  - `state/tabs.ts:123`: drop "unlike Kira Space's dynamic per-repo workspaces".
  - `tabKinds.ts`/`tabDomain.ts` "one worktree's directory": "a working directory".
  - `model/tabs.go:22-24`: "nil for studio/api tabs, 'terminal' for a terminal tab". :52-56 deleted.
    :74-78 shortened to the terminal case.
- Test comments: drop `repo-workspace.spec.ts` citations and Git-mode history; keep any
  assertion-relevant *why*.
- The implementer judges no wording beyond this rule: if a comment has no remaining non-obvious
  *why* once the git reference is gone, delete it.

### §3.6 Scripts placeholder

- `SF/workbench/settings/ScriptsPane.vue:204,263`: `placeholder="Home directory"`.
- `SD/scripts.ts:13`: "'' means the host app's default directory (Space: the active worktree;
  Studio: $HOME)".

### §3.7 Test mocks and tsconfig

- `ST/tests/ui/support/mockRuntime.ts`: delete the 13 `codeWorkspace*` FQN entries, their default
  responses and all comments naming them.
- `ST/tests/ui/support/ipcChannels.ts`: delete `quickOpen`, every `codeWorkspace*` entry and
  `codeSearch`; rewrite :200-202 without `codeSearch`.
- `ST/tsconfig.tests.json`: delete the two `@kira/git-ipc` `paths` entries. Replace :11-17 with one
  line: `allowImportingTsExtensions` is for `packages/kira-ui`'s `.ts` specifiers.
- `ST/frontend/tsconfig.json`: comments become the §2.6 reasons. `ST/tests/unit/tsconfig.json:9-10`
  likewise.

### §3.8 Implementer and split call

One sequential Sonnet implementer. Commits 1-4 share `AS/`, `SD/settings.ts`,
`WB/state/createSettingsStore.ts` and both apps' `settingsDomain.ts`, in order. Commit 5 shares
`createCoreControl.ts` with nothing else, but its bindings regen and Space bridge edits overlap
Space files commit 1-4 touch. No split.

## §4 Commit sequence, file ownership, resume rule

Fast checks after every commit: `bun run typecheck`, `bun run lint`, `bun run lint:go`,
`bun run lint:dead`, `go build ./...`. Regenerate bindings before typecheck on commits that change a
bound Go type (1-5).

| # | Commit | Files |
|---|---|---|
| 1 | `refactor(studio)!: drop git settings section` | `ST/internal/storage/model/settings.go`, `ST/internal/storage/repos/settings.go`, `ST/internal/bridge/settings.go`, `SF/state/settingsDomain.ts`, `SF/workbench/SettingsDialog.vue`, `SF/workbench/settings/types.ts`, `WB/state/createSettingsStore.ts`, `KF/state/settings.ts` |
| 2 | `refactor(settings): move git settings from appsettings into Kira Space` | `AS/appsettings.go`, `AS/repo.go`, `SD/settings.ts`, `KS/internal/storage/model/settings.go`, `KS/internal/storage/repos/settings.go`, `KS/main.go`, `KF/state/settingsDomain.ts` |
| 3 | `refactor(settings)!: move inlineBlame and dateFormat into Kira Space` | `AS/appsettings.go`, `AS/repo.go`, `SD/settings.ts`, `KS/internal/storage/model/settings.go`, `KS/internal/storage/repos/settings.go`, `KF/state/settingsDomain.ts`, `KF/workbench/settings/AppearancePane.vue`, `WB/settings/fields/DateFormatField.vue` moved to `KF/workbench/settings/DateFormatField.vue`, `SF/workbench/settings/AppearancePane.vue`, `SF/state/settingsDomain.ts` |
| 4 | `feat(studio)!: own advanced.logLevel setting, migration 0028` | `AS/appsettings.go`, `SD/settings.ts`, `ST/internal/storage/model/settings.go`, `ST/internal/storage/repos/settings.go`, `ST/internal/storage/repos/settings_test.go`, `ST/internal/storage/migrations/{0028_p120_drop_git_settings.sql,embed.go}`, `ST/main.go`, `ST/internal/bridge/settings.go`, `SF/state/settingsDomain.ts`, `SF/workbench/settings/AdvancedPane.vue`, `WB/settings/fields/GitLogLevelField.vue` moved to `WB/settings/fields/LogLevelField.vue`, `KS/internal/storage/model/settings.go`, `KF/state/settingsDomain.ts`, `KF/workbench/settings/AdvancedPane.vue`, `ST/tests/ui/settings-apply-on-save.spec.ts` |
| 5 | `refactor: move LinkService out of Kira Studio` | `ST/internal/bridge/link.go` (deleted), `ST/internal/bridge/link_test.go` moved to `KS/internal/bridge/link_test.go`, `KS/internal/bridge/link.go`, `ST/main.go`, `SF/bridge/index.ts`, `WB/bridge/createCoreControl.ts`, `KF/bridge/index.ts` |
| 6 | `refactor(studio): drop ChannelCodeSearch and git tombstones from events.go` | `ST/internal/bridge/events.go` |
| 7 | `test(studio): drop CodeWorkspaceService mocks and codeSearch/quickOpen channels` | `ST/tests/ui/support/mockRuntime.ts`, `ST/tests/ui/support/ipcChannels.ts` |
| 8 | `chore(studio): drop git-ipc tsconfig paths, fix flag comments` | `ST/tsconfig.tests.json`, `ST/frontend/tsconfig.json`, `ST/tests/unit/tsconfig.json` |
| 9 | `chore: fix Studio-scoped knip path and biome messages` | `knip.json`, `biome.json` |
| 10 | `fix(studio): Scripts working-dir placeholder names home directory` | `SF/workbench/settings/ScriptsPane.vue`, `SD/scripts.ts` |
| 11 | `docs(studio): drop git references from Go comments` | every §1.11 file not already committed |
| 12 | `docs(studio): drop git references from frontend and test comments` | every §1.12 file |
| 13 | `chore(studio): drop vsix tombstone from darwin Taskfile` | `ST/build/darwin/Taskfile.yml` |
| 14 | `test(studio): re-record settings baselines for P120` | only files that diff, expected `ST/tests/visual/settings.spec.ts-snapshots/settings-{appearance,advanced}-visual-linux.png`, possibly `settings-scripts-visual-linux.png` |
| 15 | `docs: ARCHITECTURE drops Studio LinkService and git settings` | `docs/ARCHITECTURE.md` |
| 16 | `docs(v1.9): record P120 result` | this file's result section |

Commit 1 leaves Studio's appearance git fields in place; they go in commit 3. Commit 2 compiles only
after commit 1 removed Studio's `Git` consumer. Commit 3 is breaking for Studio's wire shape only.

Commit 14: follow `docs/DEV_ENVIRONMENT.md:296-310`. Before `--update-snapshots`, confirm each diff
is element-level (removed field, changed label), not the uniform whole-page glyph drift. Re-record
only diffing files, name each in the message with its cause (P117's `3db471d6` precedent). Space's
settings baselines must not diff; a Space diff is a bug to fix, not to re-record.

Commit 15: at `docs/ARCHITECTURE.md:2210` drop `LinkService` from Studio's list; rewrite
`:3555-3562` so `LinkService` is Space-only; delete Known-open-item `:4078-4087`. Also grep the file
for `advanced.gitLogLevel`/`inlineBlame`/`dateFormat` in Studio context and fix each.

**Resume rule.** `git log --oneline` from the P120 base shows the last landed row. Resume at the next
row; re-read its files first. A half-done row with uncommitted edits: `git diff` it against this
table, finish that row only, commit, continue. Bindings are regenerated, never resumed.

## §5 Verification

### §5.1 Per commit

Fast checks in §4. Commits 1-5 also: regenerate bindings, then `bun run typecheck`.
Commit 4 also: `go test ./apps/kira-studio/internal/storage/...` (rewritten repo tests and
migration-runner tests).
Commit 5 also: `go test ./apps/kira-space/internal/bridge/ -run TestLinkService`.

### §5.2 Phase end, once

- `go test ./...`.
- `bun run test:ui:studio`, `bun run test:ui:space`.
- `bun run test:visual:studio`, `bun run test:visual:space` after commit 14.
- `bun run test:unit` (or the repo's unit script).
- Manual: fresh Studio DB boots with `advanced.logLevel` default; a DB seeded with
  `advanced.gitLogLevel='debug'` and `git.path` rows boots at debug with the git row gone.

Rewrite `ST/internal/storage/repos/settings_test.go:15-65`: keep one Default/RoundTrip/RejectInvalid
set for `advanced.logLevel` only (a leaf-validity guard). Drop `dateFormat` cases from Studio.
Space gets no new test: its fields keep their keys, and `KS/tests/ui/` already covers the UI.

### §5.3 Orchestrator greps

Run from repo root. `EX` excludes build output and the migrations dir (§2.4).

```sh
EX='--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=bin --exclude-dir=bindings --exclude-dir=migrations'
```

1. Broad `git` sweep of Studio. Base: 151. Expected: **0**.
   ```sh
   grep -rnIi git apps/kira-studio $EX \
     | grep -viE 'digit|legitimat|github' \
     | grep -vE '^apps/kira-studio/(Taskfile\.yml:13:|internal/buildinfo/buildinfo\.go:10:|build/config\.yml:(43|50|51|57):|internal/datagrip/datasources\.go:)|git stash|git show |[Ss]ee git( history|$)|ReplacingIt|[Ll]ongitude' \
     | wc -l
   ```
   The allowlist is exactly §2.1-§2.3; at base it removes 16 lines. Line numbers in the allowlist
   may drift if P119 edits `ST/Taskfile.yml`; re-derive from §2.3's named text, not new hits.
2. Git-vocabulary sweep of Studio. Base: 204. Expected: **0**.
   ```sh
   P='blame|worktree|GitPanel|GitStart|RepoFileTree|codeRepo|coderepos|CodeRepos|patchRepoFileTabState|views/repo|repo-workspace|repo workspace|vsix|GitPairing|pairing|codeWorkspace|codeSearch|CodeSearch|quickOpen|LinkService|linkOpenExternal|protectedBranches|graphFontSize|fetchAutoInterval|inlineBlame|dateFormat|gitLogLevel|GitLogLevel|git-ui|git-core|git-ipc|Connected editors|Active repository|repository file viewer|every repository|per-repo'
   grep -rnIE "$P" apps/kira-studio $EX \
     | grep -vE 'latency to blame|validateFormat|same pairing|\(v, source\) pairing' | wc -l
   ```
3. Shared layer carries no Space-only git setting. Expected: **0** each.
   ```sh
   grep -rnE 'InlineBlame|DateFormat|AdvancedCore|GitLogLevel|\bGit(Patch)?\b|DefaultGit|ReadGit|UpsertGit|ValidateGit|FetchAutoInterval|GraphFontSize' internal/appsettings | wc -l
   grep -rnE 'inlineBlame|dateFormat|gitSettingsSchema|GitSettings|gitLogLevel|FETCH_AUTO_INTERVAL' packages/shared/domain/settings.ts packages/workbench/src | wc -l
   grep -rnE 'appsettings\.(Git|GitPatch|DefaultGit|ReadGit|UpsertGit|ValidateGit|AdvancedCore|ValidDateFormat)\b' --include=*.go . | wc -l
   ```
4. `linkOpenExternal` lives only in Space. Expected: 0 in `packages/` and `apps/kira-studio/`;
   exactly 2 in `apps/kira-space/frontend/src` (definition in `bridge/index.ts`, caller in
   `repo/git/hostHandlers.ts`).
   ```sh
   grep -rn linkOpenExternal packages apps/kira-studio --exclude-dir=node_modules | wc -l
   grep -rn linkOpenExternal apps/kira-space/frontend/src | wc -l
   ```
5. Migration present and registered. Expected: 1 each.
   ```sh
   ls apps/kira-studio/internal/storage/migrations | grep -c '^0028_p120_drop_git_settings\.sql$'
   grep -c 'Version: 28, Name: "p120_drop_git_settings"' apps/kira-studio/internal/storage/migrations/embed.go
   ```
6. Space unchanged on the wire. Expected: the same count at base and after (base: run once before
   commit 1 and record it in the result section).
   ```sh
   grep -rnE '"(inlineBlame|dateFormat|gitLogLevel|protectedBranches|fetchAutoIntervalMinutes|gitPath|graphFontSize)"' apps/kira-space/internal | wc -l
   ```
7. Studio bindings have no git service. Expected: 0, after regen.
   ```sh
   ls apps/kira-studio/frontend/bindings | grep -ciE 'link|git|codeworkspace'
   ```
8. CodeGraph (after index sync): `codegraph_explore` on
   `appsettings.Git AdvancedCore LinkService ChannelCodeSearch GitLogLevelField DateFormatField`
   shows no Studio file and no `internal/appsettings` definition for any of them.

Also confirm the result section's claims against these outputs, not its prose.

## §6 Discovery record

`codegraph_explore` calls in this planning pass (6):
1. Survey: git settings, services, IPC bindings anywhere in `ST/`.
2. `appsettings.{Git,DefaultGit,ReadGit,UpsertGit,ValidateGit,GitPatch,AdvancedCore}`,
   `GitLogLevel`, `logging.SetLevel` and callers in both apps.
3. Readers of `appearance.inlineBlame`/`dateFormat` in Studio; `appearanceSettingsSchema`,
   `gitSettingsSchema`, `gitLogLevelSchema`; `DateFormatField`.
4. Studio terminal tabs: `codeRepoId`, `tabKinds.ts`, `mode.ts` `workspaceId`, custom-script cwd.
5. Studio `LinkService.OpenExternal` callers, `link: LinkService` consumer, `control.link*` usage.
6. Custom-script `workingDir` default in Studio (`ScriptsPane.vue`, `TerminalPanel.vue`,
   `SD/scripts.ts`).

`ChannelCodeSearch` and the `codeWorkspace*` mocks were confirmed dead by grep (no symbol-level
caller to trace).

## Result

Full record: `docs/v1.9/SPEC.md`'s own "## P120 result" section (commit list, all 8 §5.3 grep
numbers with explanations, every test-suite tally, the manual DB-migration check, the
`.github/workflows` empty-diff confirmation, and every deviation).

Summary: 18 commits, `94e9d961..cb32d1ec` plus this result commit. Every §1 leftover removed —
git settings and `LinkService` now live only in Kira Space, Studio owns `advanced.logLevel`
(migration 0028) independent of Space's `advanced.gitLogLevel`, dead `ChannelCodeSearch`/
`CodeWorkspaceService` IPC surface and the vsix Taskfile tombstone are gone. All 8 §5.3 greps
verified, each documented non-zero traced to a real, harmless cause (documentary comments, a
`github.com` substring match, the intended 7-field migration into Kira Space's own model — not a
missed leftover). `go test ./...` (69 ok), `bun run test:unit` (1662 pass), both visual suites (14
+ 4 passed), and both UI suites (`test:ui:space`, `test:ui:studio`, each run twice) all clean apart
from sandbox timing flakes in files this phase never touched. No `--no-verify` used.
