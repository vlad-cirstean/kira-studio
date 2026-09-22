# P100 — extract the git module into `apps/kira-space`, rename the extension, new icon

`docs/v1.9/SPEC.md`'s P100 row, turned into concrete steps. Planned against `v1.9` at `0a51975`
(P99 Part 4 result landed). P99 finished migrating every `.vue` file under
`apps/kira-studio/frontend/src` onto Tailwind/shadcn-vue/VueUse/Pinia/TanStack Query and
deliberately left `packages/git-ui`/`packages/kira-ui` alone, naming this phase as the reason
(P99 plan §2.1 point 3).

Every count, path and package edge below was measured in this container against `0a51975`:
call graphs and blast radius through CodeGraph (`codegraph_explore`), package-level import edges
through `go list -f '{{.Imports}}'` over `apps/kira-studio/...` (CodeGraph answers symbol
questions, not whole-package import closures), file/line counts through `find`/`wc`, build and
packaging facts by reading the Taskfiles and scripts directly.

**This one document is the plan for all four parts** (§3). A part's implementer reads §0-§3, its
own part section (§4-§7), then §8-§11. Splitting it into four files would triple-copy §1-§3 and
§8-§10; the plan-per-part rule exists so each pass's reasoning stays legible, which four scoped
part sections in one file satisfy — P99's own precedent.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| The new app's exact shell/build setup | **Wails v3 + go-task, a byte-for-byte structural clone of `apps/kira-studio`** — `main.go` + `Taskfile.yml` + `build/{config.yml,Taskfile.yml,darwin/}` + `frontend/{index.html,package.json,vite.config.ts,tsconfig.json,components.json,src/}`, inside the **same** repo-root Go module and the same Bun workspace (`apps/*/frontend` already globs it). A second `go.mod` was considered and declined | §4.1, §4.2 |
| The extension's exact new identifiers | Directory `apps/kira-space-vscode`, package `kira-space-vscode`, `displayName` **"Kira Space"**, command/view/container/colour/context-key prefix **`kiraSpace.`**, URI scheme **`kira-space`**, settings keys **`kiraSpace.*`**. Full table in §6.2 | §6.2 |
| The exact packaging/distribution mechanism | **Nothing new is invented — the existing one is retargeted.** The `.vsix` already ships inside the app bundle (`Contents/Resources/kira-version.vsix`, installed by the *Connected editors* pane). That whole chain moves to Kira Space: `apps/kira-space/bin/kira-space.vsix` → `Kira Space.app/Contents/Resources/` | §6.3 |
| Do the remaining icon glyphs (document braces, message queue) still make sense? | **No — all four client glyphs go.** The message queue is Kafka/SQS, the braces are a JSON-document mark: both are DB/API-client vocabulary. They are replaced by **one commit-graph glyph, lifted verbatim from the extension's own existing `resources/icon.svg`**, so the app mark and the extension mark become the same drawing | §7.1 |
| Does this phase need a split? | **Yes — four parts.** 272 Go files / 62,066 lines across 15 packages, 46 frontend files / 7,296 lines plus a whole new app shell, 62 extension commands / 373 `kiraVersion` identifier sites, and an icon. Per `CLAUDE.md` an agent-decided split keeps the number: `P100 Part 1` … `Part 4`, never a new `P` number (P101/P102 are taken anyway) | §3 |

---

## 1. Confirmed current state

### 1.1 The git slice is bigger than the SPEC row's list, and three packages are missing from it

`go list` over every package under `apps/kira-studio/internal/`, both directions:

| Package | Go files | Lines | In SPEC's list? |
|---|---|---|---|
| `gitsession` | 42 | 16,725 | yes |
| `gitclient` (incl. `porcelain`, `catfile`, `logsession`) | 53 | 11,020 | yes |
| `gitsock` | 27 | 9,999 | yes |
| `gitrpc` | 29 | 5,983 | yes |
| `gitpreflight` | 22 | 4,787 | yes |
| `gitreview` | 17 | 2,728 | yes |
| `gitops` | 23 | 2,175 | yes |
| `gitsearch` | 13 | 2,131 | yes |
| `ghclient` | 14 | 1,900 | **no** |
| `gitprepare` | 8 | 1,448 | yes |
| `gitaskpass` | 6 | 839 | yes |
| `gitvsix` | 4 | 785 | yes |
| `gitwire` | 5 | 731 | yes |
| `gitstore` | 7 | 657 | yes |
| `gitpath` | 2 | 158 | yes |
| **subtotal** | **272** | **62,066** | |
| `codeworkspace` | 6 | 1,012 | **no** |

**`internal/ghclient` is git-only and must move.** Its only importers anywhere in the tree are
`internal/gitrpc` and `internal/gitsession`. `docs/ARCHITECTURE.md`'s own "Go packages" table
already groups it with the git packages ("plus `internal/ghclient`"); the SPEC row's list simply
omits it.

**`internal/codeworkspace` is git-only and must move.** Importers: `internal/bridge` and `main.go`
only. It imports `gitclient`, `gitclient/catfile`, `gitclient/porcelain` and `pathsafe` — it *is*
the native repo workspace's file/diff/search backend, reached from the frontend as
`control.codeWorkspaceReadFile` / `ReadDiff` / `RepoHeads` / `StartSearch` / `CancelSearch` /
`RepoWorktreeLinks` (`views/repo/fileContent.ts`, `useDiffEditor.ts`, `repo/state/repoHeads.ts`,
`repo/state/search.ts`, `repo/state/repoLinks.ts`). Leaving it behind would leave Kira Studio
with a dead git-spawning package and leave Kira Space's file tree with no backend.
`internal/bridge/codeworkspace.go` moves with it — a **fourth** bridge file beyond the three the
SPEC row names.

Also present and **not** git-only, despite `docs/ARCHITECTURE.md`'s Go-packages table listing it
alongside the git packages: `internal/startupfail`. Its only importer is `main.go` — every boot
step's native alert, not a git concern. Both apps need it (§4.3).

### 1.2 The git slice has almost no upward dependencies — this is the extraction's best property

Every non-git `internal/` package any of the 15 imports, production and test, exhaustively:

| Edge | Count |
|---|---|
| `gitsock → bridge/rpcstream` | 1 |
| `gitsock → notify`, `gitrpc → notify` | 2 |
| `gitsock → storage/model`, `gitsession → storage/model`, `gitrpc → storage/model` (+3 test) | 6 |
| `gitsock → storage/repos` (+1 test) | 2 |
| `gitsock → storage` (test only) | 1 |
| `gitrpc → ipcerr` | 1 |
| `gitreview → config` | 1 |
| `gitsession → ghclient`, `gitrpc → ghclient` (+2 test) | 4 |

That is the entire upward surface: eight packages, and `ghclient` is itself moving. No git package
imports an adapter, `connections`, `tree`, `dbmcp`, `apivars`, `httpclient`, `grpcclient`,
`adapterhost`, `page`, `mask` or `oplog`. `internal/layering_test.go`'s
`TestDomainPackagesDoNotImportBridge` has held that line since P21 and already carves
`internal/gitsock` out by name as "the git module's peer of `internal/bridge`'s Wails-side
transport".

### 1.3 Go's `internal/` rule is the hard constraint this whole phase turns on

One module, rooted at the repo (`go.mod`: `module github.com/kirathecat/kira-studio`, go 1.27.1).
`apps/kira-studio/internal/...` is importable **only** by packages rooted at
`apps/kira-studio/`. So `apps/kira-space/main.go` cannot import a single line of it. This is a
language rule, not a convention — there is no build flag, replace directive or symlink that
bypasses it.

Consequence: every package both apps need must move to a path importable by both. Repo-root
`internal/` is importable by everything inside the module, and is the natural home. §4.3 lists
exactly which eight move there and why each is genuinely shared rather than convenient.

**Declined: a second Go module at `apps/kira-space/go.mod` plus a `go.work`.** It would not remove
the sharing problem (the same packages still need a home both modules can reach — now across a
module boundary, needing a `replace` or a publish), and it doubles every piece of tooling that
currently assumes one module: `apps/kira-studio/build/Taskfile.yml`'s `go:mod:tidy` (whose
`sources:` are `../../go.mod`/`../../go.sum` with a comment saying "the module is at the workspace
root (P3 D2)"), `bun run test:go` (`go test ./...`), `bun run lint:go` (`golangci-lint run` at
root), and `wails3 generate bindings`. Named requirement, per `CLAUDE.md`: nothing about a second
module is needed to satisfy `internal/`, and the cost is four tooling forks.

### 1.4 The frontend git slice, and the three things inside `views/repo/` that are not git

The SPEC row names `frontend/src/repo/*`, two `workbench/` dialogs and five `state/` modules. The
real inventory (measured with `find`/`wc`; the five state modules are **Pinia stores** since P99
Part 1, not the reactive modules the row's prose describes):

| Tree | Files | Lines | Named in SPEC row? |
|---|---|---|---|
| `repo/` (8 `.vue` + 13 `.ts`) | 21 | 3,735 | partly — `QuickOpen.vue`, `fileIcon.ts`, `menus.ts` and all 6 `repo/state/*` stores are not |
| `views/repo/` (6 `.vue` + 17 `.ts`) | 23 | 3,544 | **not at all** |
| `state/{coderepos,repoTabs,gitCredential,gitClients,repoOpenHold,blameStatus,workspace}.ts` | 7 | 741 | 5 of 7 |
| `workbench/{GitCredentialDialog,GitPairingDialog}.vue` | 2 | 218 | yes |
| **total** | **53** | **8,238** | |

`views/repo/` is the bigger omission: it holds `RepoDiffView.vue`, `RepoFileView.vue`,
`RepoGraphView.vue`, `RepoMultiDiffView.vue`, `RepoTerminalView.vue`, `ReviewThread.vue` and their
supporting modules — the actual repo tab bodies. P99 Part 4 already treated `views/repo` as part of
the git surface.

**But three files under `views/repo/` are not git and must stay in Kira Studio**, found by tracing
importers outside the directory:

- `views/repo/monacoEntry.ts` — `editor/monaco.ts` (the **app-wide** Monaco bootstrap shared by the
  SQL console, the cell editor and every other editor surface) dynamically imports it:
  `import('../views/repo/monacoEntry')`.
- `views/repo/monarch/mongo.ts`, `views/repo/monarch/redis.ts` — MongoDB and Redis Monarch
  grammars, registered by `editor/monacoLanguages.ts` as `kira-mongo`/`kira-redis`. Pure DB-client
  code that happens to live under a directory named `repo`.
- `views/repo/monarch/decorators.ts` — used by `monacoEntry.ts` (TypeScript decorator token fix).

These are a P60a layering leftover (`editor/monaco.ts`'s own header comment says the
engine-generic half was moved to `editor/` and re-exported from here). Part 2 moves them to
`editor/` in Kira Studio rather than shipping them to Kira Space.

Two more cross-boundary reads to unwind, both git-side:
`workbench/StatusBar.vue` imports `blameLineText`/`blameLineTooltip` from `views/repo/blameLine`,
and `state/blameStatus.ts` imports its `BlameLineState` type — the inline-blame status-bar widget
(P62). It leaves Kira Studio with the rest.

### 1.5 The git slice leans on the Studio workbench — 17 stores and 10 primitives

Every import the 53 files make into non-git app code, counted:

| Target | Hits |
|---|---|
| `state/*` (17 distinct stores) | 51 |
| `theme/primitives/*` (10 distinct) | 26 |
| `bridge/*` | 9 |
| `theme/*` (tokens/css) | 5 |
| `shortcuts/*` | 3 |
| `clipboard.ts` | 3 |
| `editor/*` | 2 |

Stores: `settings` (8), `repoTabs` (7), `coderepos` (7), `workspace` (4), `tabs` (4), `terminals`
(3), `repoOpenHold` (3), `contextMenu` (3), `tabRuntime` (2), `layout` (2), `gitCredential` (2),
`search`, `pinia`, `mode`, `gitClients`, `blameStatus`, `agentHooks`.
Primitives: `AppButton`, `DialogFrame`, `EmptyState`, `IconButton`, `PanelShell`,
`SegmentedControl`, `TextField`, `TreeHost`, `VirtualList`, `stickyBand`.

**So "move 53 files" is not the frontend job. The job is "stand up a workbench for them to live
in".** §5.2 decides how.

### 1.6 `AppMode` has four members, not three, and one of them is `'git'`

`packages/shared/domain/mode.ts`: `'studio' | 'api' | 'git' | 'terminal'`. P91 added `'terminal'`
as a fourth peer module, so the SPEC row's "Kira Studio keeps only its DB/HTTP/gRPC/queue client
surface" means dropping exactly one member, `'git'` — the terminal module stays.

`packages/shared/domain/workspace.ts`'s `WorkspaceKey = AppMode | \`repo:${string}\`` exists
*solely* for repo workspaces (`repoWorkspaceKey`, `repoIdOfWorkspace`, `isRepoWorkspace`,
`moduleOfWorkspace`). With `'git'` gone, every `WorkspaceKey` is an `AppMode` and the whole module
collapses — §5.4.

### 1.7 Three tables, one socket, two SQLite files — and all of them are Kira Studio's today

| Thing | Path / migration | Moves to Kira Space |
|---|---|---|
| `git_clients` (pairing trust store) | `0016_g1_git_clients.sql` | yes |
| `git_repo_settings` (the `kiraVersion.*` leaves) | `0017_g18_git_repo_settings.sql` | yes |
| `code_repos` (+ `ALTER TABLE tabs ADD COLUMN workspace_id`) | `0018_c5_code_repos.sql` | table yes, column no (§4.5) |
| `review.db` | `gitreview/db.go`: `config.KiraHome()/review.db` | yes |
| `git.sock` + `git.sock.lock` | `main.go:368-369`: `config.KiraHome()/git.sock` | yes |
| `kira.db` | `config/paths.go:39`: `KiraHome()/kira.db` | its own copy |

`KIRA_HOME` defaults to `~/.kira-studio` (`config/paths.go:21`). The extension resolves the same
path independently: `apps/kira-studio-vscode/src/connection.ts:102` —
`process.env.KIRA_HOME ?? path.join(os.homedir(), '.kira-studio')`, then `git.sock`.

**Both apps cannot share one socket.** `gitsock.Server.Start` takes an exclusive `flock` on
`git.sock.lock`; whoever loses simply does not listen (`main.go` logs, never fatals). Kira Space
must own its own `~/.kira-space/` home, its own `kira.db`, its own `review.db` and its own
`git.sock`, and the extension must dial there — §4.4, §6.3.

### 1.8 The extension: 62 commands, 14 colours, 373 `kiraVersion` sites — and `kiraVersion.*` is a persisted wire key

`apps/kira-studio-vscode/package.json` contributes 62 commands, 2 view containers
(`kiraVersion`, `kiraVersionReview`), 2 views (`kiraVersion.graph`, `kiraVersion.review`), 14
colours (`kiraVersion.graphLane0-7`, `reviewedLineBackground`, `reviewedLineOverviewRuler`, …),
menus in 6 contribution points, 4 keybindings, and **no `configuration` properties**
(`docs/ARCHITECTURE.md` says 46 commands and `CONTRACT_VERSION` 30 — both stale; the real
`CONTRACT_VERSION` is **39**, asserted equal in `gitrpc/contract.go:156` and
`packages/git-ipc/src/validate.ts:151`, with a test pinning it in `gitrpc/stash_test.go:48`).

Identifier sites, repo-wide:

| Token | Sites | Biggest files |
|---|---|---|
| `kiraVersion` | 373 | `git-core/settings/schema.test.ts` 54, `kira-studio-vscode/src/commands.ts` 48, `git-ui/…/RepoSettingsDialog.vue` 37, `git-ui/state/repoSettings.test.ts` 34, `git-core/settings/schema.ts` 26, `kira-studio-vscode/src/extension.ts` 25, `git-ipc/src/contract.ts` 24 |
| `kira-version` | 19 | `git-core/search/matcher.test.ts` 4, `src/ports/editorIntegration.ts` 3, `src/diffToolbar.ts` 3 |
| `Kira Version` | 35 | `src/extension.ts` 14, `src/reviewMarking.ts` 8, `README.md` 5 |
| `Kira Studio` (in extension + git packages) | 77 | `src/extension.ts` 15, `README.md` 7, `git-ui/App.vue` 5, `git-ipc/contract.ts` 5 |

**`kiraVersion.*` is not only a VS Code identifier.** It is the key space of
`RepoSettingsSnapshot` in `packages/git-ipc/src/contract.ts:70-100` (11 keys), the key space of
`packages/git-core/src/settings/schema.ts`, and **the literal `key` column value in
`git_repo_settings`**. Renaming it is simultaneously a wire-contract change and a stored-data
change. §6.4 handles both.

### 1.9 Packaging already does what the SPEC row asks — it just points at Kira Studio

Traced through the Taskfiles and the two scripts, end to end:

1. `apps/kira-studio/build/Taskfile.yml`'s `build:vsix` runs `bun run scripts/package-vscode.ts`,
   `generates: apps/kira-studio/bin/kira-version.vsix`. Its `sources:` list names
   `apps/kira-studio-vscode/**` and `packages/git-{core,ipc,ui}/src/**`.
2. `scripts/package-vscode.ts` calls `buildVsCodeBundles()` from `scripts/build-vscode.ts` (Vite
   for the webview via `packages/git-ui/vite.config.ts`, `Bun.build` CJS for `dist/extension.cjs`,
   plus a "no `Bun.`/`bun:` in the bundle" purity check), then shells `vsce package
   --no-dependencies --out apps/kira-studio/bin/kira-version.vsix`.
3. `apps/kira-studio/build/darwin/Taskfile.yml`'s `create:app:bundle` copies that `.vsix` to
   `Kira Studio.app/Contents/Resources/kira-version.vsix` **before** the ad-hoc `codesign`, so the
   signature covers it. `package`/`package:universal` both `deps:` on `common:build:vsix`.
4. `internal/gitvsix/install.go:116-121` resolves it at runtime as
   `filepath.Dir(os.Executable())/../Resources/kira-version.vsix` — a single probe, no env
   override — and `code --install-extension <path> --force`, falling back to `open -R`.
5. `bridge/gitclients.go`'s `VsixStatus`/`InstallVsCodeIntegration` render that as the Settings
   dialog's *Connected editors* pane.

So the answer to "bundled in the same installer, or published separately and version-locked" is
**already decided and shipped: bundled**. §6.3 retargets the five links of that chain, and invents
nothing.

### 1.10 The icon is one 173-line, comment-labelled SVG — and the sandbox cannot rasterize

`apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg`, 8,777 bytes, `viewBox="0 0 1024
1024"`. Its structure is explicit and each glyph group carries its own comment, so the edits below
are line-exact, not "make it look right":

| Lines | Content |
|---|---|
| 2 | `<title>Kira Studio app icon</title>` |
| 4-7 | `linearGradient id="bg"`, vertical, `#D2A97C` → `#A3794C` (the tan/brown background) |
| 8-11 | `radialGradient id="glow"`, `#EDCFA6` at 0.55 → 0 opacity |
| 12-15 | `radialGradient id="iris"` (the cat's eyes — keep) |
| 16-18 / 19-22 | `clipPath id="squircle"` / `id="headClip"` (keep) |
| 25-27 | the squircle group + the two background rects |
| 30 | `<g stroke="#6B4A2B" stroke-width="13" … opacity="0.92">` — the client-glyph wrapper |
| 31-35 | `<!-- document braces -->` |
| 36-43 | `<!-- message queue -->` |
| 44-49 | `<!-- database stack -->` |
| 50-55 | `<!-- sql cell grid -->` |
| 56-65 | `<!-- sparkles in the gaps -->`, 8 four-point stars, `fill="#F6EDDC"` |
| 66+ | the cat (`translate(512 512) scale(0.92)…`), white/grey/pink — untouched |

Background-tied colours, by count: `#F1E4CC` (glyph fill) 7, `#EDCFA6` 2, `#D9B36A` 1, `#D2A97C`
1, `#A3794C` 1, `#6B4A2B` 1, `#F6EDDC` 1. Everything else is the cat.

**No rasterizer exists in this container** — `rsvg-convert`, `inkscape`, `convert`, `magick`,
`cairosvg`, `resvg` and `sips` are all absent, checked. `build/appicon.png` (1024×1024 RGBA) and
`apps/kira-studio-vscode/resources/icon.png` (128×128) are inputs to `wails3 generate icons` and
to `vsce`, and both must be regenerated from the new vector. §7.2 gives the Playwright route.

---

## 2. Scope decision

**In scope:** the 15 Go packages of §1.1 (13 named by SPEC + `ghclient` + `codeworkspace`), the
four `internal/bridge` git files, the 53 frontend files of §1.4, the eight repo-root Go hoists of
§4.3, a new `apps/kira-space` app (Go + frontend + build + packaging), the extension rename, the
icon, and every doc/config/test that names any of it.

**Out of scope, confirmed not forgotten:**

- **`packages/git-core`, `git-ipc`, `git-ui`, `kira-ui` stay exactly where they are**, as the SPEC
  row instructs ("reusing them exactly as `apps/kira-studio-vscode` already does"). Their *content*
  changes only for the `kiraVersion` → `kiraSpace` rename (§6.2) — no file moves, no build change,
  no Tailwind added. P99's §2.1 reasons for keeping Tailwind out of them are unchanged by this
  phase.
- **No behaviour change anywhere.** This is an extraction and a rename. A feature that works today
  works identically after, in whichever app now owns it. A bug found on the way is fixed in its own
  commit, named as such — never folded silently into a move commit.
- **The 255 a11y findings** — P101, untouched, and the `biome.json` `**/*.vue` override stays. The
  new app's own `.vue` files land under the same override; P101's planning pass inherits them.
- **Root `package.json`'s `dependencies`/`devDependencies` split** — P102. Part 2 adds the new
  frontend workspace's own `package.json`; it does not reclassify root entries.
- **`internal/terminal`'s PTY implementation, `internal/dbmcp`, `internal/adapters/*`, every
  DB/HTTP/gRPC/queue package** — none is touched beyond an import-path rewrite if it consumes a
  hoisted package.

---

## 3. Split decision: four parts, `P100 Part 1` … `Part 4`

**A split is necessary.** The measured scope: 62,066 lines of Go across 15 packages plus 1,012
more in `codeworkspace`; 8,238 lines of frontend to move *plus* a workbench to stand up for them;
373 identifier sites across 4 packages and an app; a Wails app skeleton, a packaging chain, a
release workflow and an icon. No single cold subagent pass covers that with the judgment each piece
needs, and a pass that runs out of room mid-extraction leaves a tree that neither builds nor tests.

Per `CLAUDE.md`, an **agent-decided** split keeps the phase number: `P100 Part 1: …` through
`P100 Part 4: …` in `SPEC.md`, never a new `P` (P101 and P102 are both taken, and inventing a
number is the user's call, not a subagent's).

| Part | Scope | Gate at its end |
|---|---|---|
| **Part 1 — Go** | Repo-root hoists; `apps/kira-space` Go skeleton (`main.go`, Taskfile, `build/`); the 15 packages + 4 bridge files moved; storage/socket/home split; Kira Studio's git Go code gone | `go build ./...`, `go vet`, `bun run lint:go`, `bun run test:go`, `bun run typecheck`, both apps launch |
| **Part 2 — frontend** | `apps/kira-space/frontend` stood up; the 53 files moved onto it; Kira Studio drops `'git'`, the repo workspace and the two dialogs; `views/repo/`'s three non-git files relocated to `editor/` | the full suite (§9), both apps' UI tests |
| **Part 3 — extension** | Directory + package rename, all 373 identifier sites, the settings-key migration, `CONTRACT_VERSION` bump, socket retarget, packaging chain retarget, release-workflow patch | `bun run build:vscode`, `bun run test:webview`, `bun run package:vscode`, `bun run test:unit` |
| **Part 4 — icon, docs, audit** | The new mark (both apps + both extension resources + both PNGs), `docs/ARCHITECTURE.md`/`PACKAGING.md`/`DEV_ENVIRONMENT.md`/`README.md`, and the phase-closing audit (§10) | §9 in full, plus §10's eleven checks |

**Why this order.** Part 1 establishes the socket path, the home directory, the DB and the bridge
service surface that Part 2's frontend and Part 3's extension both dial. Part 2 finishes the
product boundary so Part 3's rename lands on a tree where "Kira Space" is already a real app rather
than a directory. Part 4's audit can only run once everything else is in.

**No parallel fan-out.** One sequential subagent per part, parts in order, each committed before
the next is planned — `CLAUDE.md`'s phase loop. The parts are order-dependent by construction;
none of them is the "genuinely independent work" the parallel allowance covers.

### 3.1 `SPEC.md`

This plan's own commit renames the single P100 row to four `P100 Part N:` rows, each pointing at
this file. Nothing is renumbered; P101 and P102 keep their numbers and their order.

---

## 4. Part 1 — the Go extraction

### 4.1 `apps/kira-space`'s shell and build setup

Structural clone of `apps/kira-studio`. Create, in this order:

```
apps/kira-space/
  main.go                      # Wails v3 application.New, the askpass argv shim, the git wiring
  Taskfile.yml                 # APP_NAME "Kira Space", VERSION_VAR …/apps/kira-space/internal/buildinfo.Version
  .gitignore                   # copy: bin/, .task/
  build/
    config.yml                 # productName "Kira Space", productIdentifier com.kirathecat.kira-space
    Taskfile.yml               # copy; build:vsix retargeted (§6.3)
    darwin/{Taskfile.yml,Info.plist,Info.dev.plist,dmg-background.png}
    appicon.png                # Part 4
    appicon.icon/{icon.json,Assets/kira_icon_vector.svg}   # Part 4
  frontend/                    # Part 2
  tsconfig.json, tsconfig.tests.json, playwright.config.ts  # Part 2
  internal/                    # the moved packages, below
```

`build/config.yml` values, changed from Kira Studio's:

| Key | Value |
|---|---|
| `info.productName` | `Kira Space` |
| `info.productIdentifier` | `com.kirathecat.kira-space` |
| `info.description` | `A git client for macOS` |
| `info.comments` | `Kira Space — a git client for macOS` |
| `info.companyName`, `copyright` | unchanged (`Kira the Cat`) |
| `info.version` | `0.0.0` — same single-source rule (Taskfile's `APP_VERSION` seds it out; release.yml writes the tag in) |

`dev_mode.ignore`/`watched_extension` copy verbatim. `Taskfile.yml`'s `VITE_PORT` default must
**not** be 9245 — Kira Studio holds that, and `strictPort: true` means a collision is a hard
failure when both dev servers run. Use **9246**, set in both `Taskfile.yml`'s `VITE_PORT` var and
`frontend/vite.config.ts`'s `server.port` fallback, exactly the way Kira Studio pairs them today.

Root `package.json` gains: `dev:space`, `build:space`, `package:space`, and `typecheck:space-web`
inside the existing parallel `typecheck` fan-out. `workspaces` needs no edit — `apps/*/frontend`
already globs the new one.

### 4.2 `main.go`

Kira Space's `main.go` is a much smaller `apps/kira-studio/main.go`. Port, in order:

1. **The askpass argv shim first, before anything Wails-related** — `apps/kira-studio/main.go:83`:
   `if len(os.Args) > 1 && os.Args[1] == "askpass" { os.Exit(gitaskpass.RunHelper(...)) }`. It
   re-execs *the running executable*, so it follows the binary automatically. Kira Studio's copy is
   **deleted** in the same part; verify with a `grep` for `"askpass"` under `apps/kira-studio/`.
2. `config.EnsureLayout()` → `logging.Init` → `storage.Open` → `repos.New`, each through
   `startupfail.Fatal(step, err)` exactly as today.
3. `wireGit(repositories)` — lift `apps/kira-studio/main.go`'s existing helper wholesale (it
   already returns `{runner, discovery, registry, askpassBroker, router, sock}`).
4. `gitsock.Server` with `SocketPath`/`LockPath` under Kira Space's own home (§4.4).
5. `application.New` with `Services:` = the four moved bridge services only —
   `GitClientsService`, `CodeWorkspaceService`, the gitstream registration
   (`shell.RegisterGitStream(app, router)`), `GithubService` — plus whatever Part 2's frontend
   needs for its own shell (settings, layout, tabs, windows, files, terminal). Part 2 extends this
   list; Part 1 lands the git four and a minimal window.
6. The quit/teardown sequence: `gitSock.Close()`, `askpassBroker` teardown, `repositories`/`db`
   close — same ordering comments as Kira Studio's `wireLifecycle`.

`internal/shell` is **not** hoisted (§4.3): Kira Space writes its own small
`apps/kira-space/internal/shell` with `app.go`'s `RegisterGitStream`, window creation, the quit
handler and the menu. Kira Studio's 16-file `shell` carries menus, accelerators, close-flush and a
window registry built around its own tab model.

### 4.3 The eight repo-root hoists

Each is a `git mv` plus an import-path rewrite, and each is its own commit. New home is
`/internal/<name>` at the repo root (importable by every package in the module).

| Hoist | From | Why shared, measured |
|---|---|---|
| `internal/ipcerr` | `apps/kira-studio/internal/ipcerr` | Both apps' bridges shape errors for `bridge/rpc.ts`'s `unwrap()`. `gitrpc` already imports it |
| `internal/notify` | `apps/kira-studio/internal/notify` | Generic `Emitter[T]`. 9 importers today, 2 of them git (`gitrpc`, `gitsock`) |
| `internal/rpcstream` | `apps/kira-studio/internal/bridge/rpcstream` | `docs/ARCHITECTURE.md` already calls it "module-agnostic infrastructure, and the one deliberate exception to the module-boundary rule". Hoisting **deletes** that exception and `layering_test.go`'s `"internal/bridge/rpcstream"` exemption entry |
| `internal/startupfail` | `apps/kira-studio/internal/startupfail` | Pre-window native alerts for every boot step; Kira Space has the same six boot steps. Sole importer today is `main.go` |
| `internal/logging` | `apps/kira-studio/internal/logging` | Both apps call `logging.Init`/`SetLevel` at boot |
| `internal/buildinfo` | `apps/kira-studio/internal/buildinfo` | `-ldflags -X` version stamping; each app's Taskfile sets its own `VERSION_VAR` **and each app keeps a `Version` var of its own** — see below |
| `internal/pathsafe` | `apps/kira-studio/internal/pathsafe` | `codeworkspace` imports it; Kira Studio's `files`/`terminal` bridge do too |
| `internal/sqlitex` | extracted from `apps/kira-studio/internal/storage` (`db.go` open + `migrate.go`'s `schema_version` runner + `migrations/embed.go`'s shape) | Two apps, two independent migration chains, one runner |
| `internal/kirapaths` | extracted from `apps/kira-studio/internal/config/paths.go` | `Home(dirName string)` / `EnsureLayout(dirName string)`; each app keeps a 20-line `internal/config` wrapper naming its own dir |

`buildinfo` carries a package-level `var Version` written by `-ldflags -X <path>.Version`. One
shared package means one symbol, which two Taskfiles would both try to stamp. **Resolution:**
hoist the *helpers* only if any exist; keep a per-app `internal/buildinfo` holding just the `var
Version` string, each app's Taskfile pointing `VERSION_VAR` at its own. If `buildinfo` turns out to
be nothing but that var, do not hoist it at all — create
`apps/kira-space/internal/buildinfo/buildinfo.go` as a 5-line sibling and say so in the result
section.

`internal/terminal` imports only `internal/buildinfo` — clean enough to hoist, and both apps need a
PTY registry (Kira Studio's terminal module, Kira Space's repo-terminal tab). Hoist it as a ninth
if and only if Part 2's `RepoTerminalView` port actually needs it; Part 1 leaves it in place and
Part 2 decides, since Part 1 has no frontend to prove it against. If the repo-terminal tab reaches
the `claude-code` launch kind (`grep -n "launchKindClaudeCode" apps/kira-studio/internal/terminal
apps/kira-studio/internal/bridge/terminal.go`, then check whether Part 2's ported
`RepoTerminalView.vue`/`state/terminals.ts` path can reach it), `internal/agenthooks` hoists with
it; if not, Kira Space's `TerminalService` wires no `AgentHooks` and the result section says so.

**`layering_test.go` moves too.** Copy it to `apps/kira-space/internal/layering_test.go` with
`modulePrefix` retargeted and an exemption set of `{internal, internal/bridge, internal/shell}` —
`internal/gitsock`'s exemption is no longer needed there either, since `rpcstream` is now a
repo-root package rather than one under `bridge`. Kira Studio's copy keeps its own, minus the two
deleted entries. Both copies still enforce the same rule they always did.

### 4.4 Home, DB, socket, review.db

`apps/kira-space/internal/config`:

| Thing | Kira Studio (unchanged) | Kira Space |
|---|---|---|
| Home | `$KIRA_HOME` else `~/.kira-studio` | `$KIRA_SPACE_HOME` else `~/.kira-space` |
| Main DB | `<home>/kira.db` | `<home>/kira.db` |
| `review.db` | `<home>/review.db` | `<home>/review.db` |
| Socket | `<home>/git.sock` (+ `.lock`) — **deleted** | `<home>/git.sock` (+ `.lock`) |
| Logs | `<home>/logs/` | `<home>/logs/` |

Env var name: **`KIRA_SPACE_HOME`**, not a shared `KIRA_HOME`. A shared one would make the two apps
collide on `kira.db` and `git.sock` for anyone who sets it, which is exactly the class of bug the
flock silently swallows.

`internal/gitreview/db.go`'s `DefaultPath` follows Kira Space's `config.KiraHome()` with no other
change, since it already reads it through that one function.

### 4.5 Storage split

**Kira Space** gets `apps/kira-space/internal/storage/` with its own `migrations/0001_init.sql`
containing, verbatim from the existing files (comments included, so the provenance survives):
`git_clients` + its index (from `0016`), `git_repo_settings` (from `0017`), `code_repos` + its
unique index (from `0018`), plus the shell tables Part 2's frontend needs — `settings`, `layout`,
`tabs`, `windows` — copied from `0001_init.sql`/`0002_p8_windows.sql`/`0014_p22_window_mode.sql`
with only the git-relevant columns kept. `repos/` gets `gitclients.go`, `gitreposettings.go`,
`coderepos.go` moved as-is, plus the shell repos Part 2 needs. `model/` gets `gitclient.go` and
`window.go`'s `validWindowModes` narrowed to whatever Kira Space's own modes are.

**Kira Studio** gets a new `0026_p100_drop_git_tables.sql`:

```sql
DROP TABLE git_repo_settings;
DROP TABLE git_clients;
DROP TABLE code_repos;
```

`tabs.workspace_id` **stays**, with a comment on the migration saying why: every remaining tab
parses as `workspace_id IS NULL` (that was always the studio/api fallback,
`0018_c5_code_repos.sql`'s own note), dropping the column rewrites the whole `tabs` table for zero
behavioural gain, and `model.NormalizeMode` already degrades an unknown mode to `"studio"`. Remove
the *frontend* and Go-side reads of it instead (Part 2), so no live code path consults it.
`model/window.go`'s `validWindowModes` drops `"git"` in the same commit.

**One-time import, so existing users do not lose their pairings and repo list.** On Kira Space's
first boot, if `~/.kira-space/kira.db` did not exist and `~/.kira-studio/kira.db` does, copy the
rows of `git_clients`, `git_repo_settings` and `code_repos` across, and copy (never move)
`~/.kira-studio/review.db` to `~/.kira-space/review.db`. Guard with a `settings` row so it runs
once and never again. Read-only against the studio DB throughout — Kira Studio's own migration
`0026` is what removes its copy, on its own schedule, and a failed import must never leave either
file damaged. The considered alternative — ship nothing and let every paired editor re-pair and
every repository be re-imported — is cheaper to write and is what the result section should record
if the import turns out to need more than one commit's worth of work; but silently discarding a
user's trust store on an app rename is not the "no shortcuts" bar `CLAUDE.md` sets.

### 4.6 The move itself

One commit per package, in dependency order (leaves first), each leaving `go build ./...` green:

`gitwire` → `gitpath` → `gitstore` → `gitclient` (with `porcelain`, `catfile`, `logsession`) →
`ghclient` → `gitpreflight` → `gitprepare` → `gitaskpass` → `gitsearch` → `gitreview` → `gitops` →
`gitsession` → `codeworkspace` → `gitrpc` → `gitsock` → `gitvsix`.

Then the four bridge files as one commit: `bridge/gitclients.go`, `bridge/gitstream.go`,
`bridge/github.go`, `bridge/codeworkspace.go` plus `github_test.go`, `gitstream_test.go`,
`gitstream_classification_coverage_test.go` → `apps/kira-space/internal/bridge/`.

Then Kira Studio's own cleanup as one commit: `main.go`'s git imports and `wireGit`, the
`GitRegistry` field on `appcore.Deps` (`appcore/deps.go:47-53`), `bridge/settings.go`'s reads of
it, `internal/shell/app.go`'s `RegisterGitStream`, and the `advanced.gitLogLevel` setting leaf.
Verify with `grep -rn "gitclient\|gitsession\|gitrpc\|gitsock\|ghclient\|codeworkspace"
apps/kira-studio/` returning nothing outside a comment.

`internal/ipcfixture` (the test fixture that wires bound services together) will reference the
moved services — update it in the same commit rather than leaving a broken fixture.

### 4.7 Part 1 commits

`refactor(go): hoist <pkg> to the repo-root internal/` ×8-9; `feat(kira-space): add the Wails app
skeleton`; `refactor(kira-space): move internal/<pkg>` ×16; `refactor(kira-space): move the git
bridge services`; `feat(kira-space): own home, database and git socket`; `feat(kira-space): import
pairings and repositories from Kira Studio on first boot`; `refactor(kira-studio): drop the git
module's Go surface`; `refactor(go): retarget layering_test to both apps`.

---

## 5. Part 2 — the frontend extraction

### 5.1 `apps/kira-space/frontend`

Same five files Kira Studio's frontend has, copied and retargeted:

- `index.html`, `package.json` (`@kira/kira-space-frontend`, deps `@kira/git-core`, `@kira/git-ipc`,
  `@kira/git-ui`, `workspace:*` each)
- `vite.config.ts` — identical shape to Kira Studio's, with `server.port` default **9246**, and the
  `@bindings`/`@bindings-internal` aliases pointing at
  `./bindings/github.com/kirathecat/kira-studio/apps/kira-space/internal/…` (the module path stays
  `kira-studio` — that is the Go module name, not the app name; do not "fix" it)
- `tsconfig.json`, `components.json` (shadcn-vue config, `@` → `./src`)
- `src/components/ui/**` + `src/lib/utils.ts` — copy the 17 shadcn-vue primitives P99 Part 1
  landed, not a re-fetch: the registry is reachable but a second fetch risks a different upstream
  revision than the one Kira Studio ships, and these must stay identical across the two apps
- `src/theme/{tokens.css,base.css,shadcn-bridge.css,kui-bridge.css,vscode-bridge.css}` — copied;
  `check-tokens.sh` must resolve every `--kira-*`/`--kui-*` in the new tree too

Per `CLAUDE.md`'s P98 rules, every new/ported file here is `<script setup lang="ts">`, styled with
Tailwind utilities (`@apply` under `@reference "@/theme/base.css";` where a block earns one),
composables from VueUse, one-concern Pinia stores, server state through TanStack Query. Ported
files already satisfy this — P99 converted all 53 of them.

### 5.2 The shell: port the subset, do not hoist a shared package

The 53 files need 17 stores and 10 primitives (§1.5). Three routes were weighed:

1. **Hoist the studio shell into `packages/workbench`** and have both apps consume it. **Declined,
   with the requirement named:** the shell is P99 Part 2's own 48 files / 2,570 CSS lines, every
   one converted one-touch-each and verified against 55 `test:ui` specs and 5 visual baselines four
   weeks ago; hoisting re-opens all 48 and re-runs that verification, to serve two consumers one of
   which needs about a third of them. And the state layer is not shareable as-is: `state/tabs.ts`
   (970 lines) and `state/tabKinds.ts` (535) are wired to Studio's own tab-kind registry and its
   own generated Wails bindings — sharing them means parameterizing the kind registry and the
   bridge surface, a redesign this phase's own scope explicitly is not.
2. **Consume `packages/kira-ui` as Kira Space's primitive layer.** Declined: P99 §1.2 measured
   `kira-ui` as *git-ui's* primitive layer, not an app's — `KuiButton` 72 callers, all of them in
   `packages/git-ui`; zero `.vue` usages from a Wails app. It also has no Tailwind build, which
   `CLAUDE.md`'s standing P98 rule requires for a new UI surface. It stays exactly as it is, used
   by `git-ui` in both hosts.
3. **Port the subset into `apps/kira-space/frontend/src`.** **Chosen.** The 10 primitives are
   already shadcn-vue-backed with unchanged public APIs (P99 Part 2 §6.2), so the port is a copy of
   converted code, not a rewrite. The duplication is bounded and stated: 10 primitive files plus
   the shell components below, against 8,238 lines of git code that stops being duplicated at all.

Port into `apps/kira-space/frontend/src`:

| From Kira Studio | Ported as |
|---|---|
| `theme/primitives/{AppButton,DialogFrame,EmptyState,IconButton,PanelShell,SegmentedControl,TextField,TreeHost,VirtualList}.vue` + `stickyBand.ts` | verbatim |
| `workbench/{WorkbenchShell,TitleBar,StatusBar,TabStrip,ContextMenu,AppTooltip,ConfirmDialog}.vue`, `workbench/panels/MainView.vue`, `workbench/{tabViews,state/tooltip}.ts` | trimmed to Kira Space's own tab kinds; `TitleBar` has no module tabs at all (one module) |
| `workbench/SettingsDialog.vue` (2,156 lines) | **rewritten small** — only the *Git*, *Connected editors*, *Appearance* and *Advanced → git log level* panes. Do not port the DB/API panes and then hide them |
| `state/{tabs,tabKinds,tabRuntime,layout,settings,contextMenu,search,pinia,queryClient,terminals}.ts` | trimmed; `state/mode.ts` and `state/workspace.ts` are **not** ported — Kira Space has one module and its workspaces are repositories, so `repoTabs`'s own keying replaces both |
| `bridge/{index,control,rpc,port,data}.ts`, `clipboard.ts`, `shortcuts/` | retargeted at Kira Space's bindings; only the methods its four services expose |
| `editor/{monaco,monacoLanguages,MonacoHost.vue}.ts` + a new `editor/monacoEntry.ts` | Kira Space's own Monaco bootstrap (§1.4) — no `kira-mongo`/`kira-redis` registration |
| `App.vue`, `main.ts` | Kira Space's own bootstrap: `createPinia`, `VueQueryPlugin`, `initTooltips()` |

Then move the 53 files of §1.4 (minus `views/repo/{monacoEntry,monarch/*}.ts`), keeping their
directory shapes: `repo/`, `views/repo/`, `state/{coderepos,repoTabs,gitCredential,gitClients,
repoOpenHold,blameStatus}.ts`, and the two dialogs into `workbench/`.

`repo/git/gitUiModule.ts`'s `loadGitUi()` lazy mount of `packages/git-ui` moves unchanged — it is
the same second-frontend mount `docs/ARCHITECTURE.md`'s "Git graph in the native workspace (C10)"
describes, now in the app that owns the backend.

### 5.3 What Kira Studio deletes

- The 53 files (moved), and `views/repo/` as a directory once its three non-git files are
  relocated to `editor/`: `monacoEntry.ts` → `editor/monacoEntry.ts`,
  `monarch/{mongo,redis,decorators}.ts` → `editor/monarch/`. `editor/monaco.ts`'s
  `import('../views/repo/monacoEntry')` and `editor/monacoLanguages.ts`'s two grammar imports are
  updated in the same commit; `views/repo/monaco.ts`'s re-export shim is deleted with the rest.
- `workbench/tabViews.ts`: the five repo tab-view registrations. `state/tabKinds.ts`: the repo tab
  kinds and their `dropResources` hooks (`dropRepoDiffTab`, `dropRepoFileTab`,
  `dropRepoMultiDiffTab`). `state/tabs.ts`: anything keyed on a repo workspace.
- `workbench/TitleBar.vue`: the Git module tab. `workbench/StatusBar.vue`: the blame widget and its
  `views/repo/blameLine` import. `workbench/WorkbenchShell.vue`/`panels/MainView.vue`: the
  `moduleOfWorkspace(key) === 'git'` branches. `workbench/panels/TabStrip.vue`: repo-tab handling.
- `workbench/SettingsDialog.vue`: the *Git* and *Connected editors* panes.
- `App.vue`, `main.ts`, `shortcuts/state.ts`: their git imports.
- `packages/shared/domain/`: `git.ts` and `repo.ts` move to Kira Space's own shared surface;
  `mode.ts` drops `'git'`; `workspace.ts` collapses — with no `repo:` key left, `WorkspaceKey`
  **is** `AppMode`, so `repoWorkspaceKey`/`repoIdOfWorkspace`/`isRepoWorkspace`/`moduleOfWorkspace`
  all go and every call site reads the mode directly. Delete the file rather than leaving a
  one-line type alias.
- `tabs.ts`'s `TAB_KIND_MODE` entries for repo kinds, and their schemas.
- Tests: `tests/ui/{repo-graph-lifecycle,repo-workspace}.spec.ts` and
  `tests/unit/{blame-line-controller,git-credential-queue,repo-file-tab-revision,
  repo-go-to-file-handler,repo-review-diff-tab,repo-tab-slots,repo-tree-sort-collator,
  repo-workspace-close-drops-caches}.spec.ts` **move** to `apps/kira-space/tests/` with Kira
  Space's own `playwright.config.ts` and `tsconfig.tests.json`. They are not deleted — they are the
  only coverage the moved surface has. Root `package.json` gains `test:ui:space`/`test:unit`'s new
  path; `knip.json` gains an `apps/kira-space/frontend` workspace block mirroring Kira Studio's
  (same `ignore` for `src/lib/utils.ts` and `src/components/ui/**`).

### 5.4 The `WorkspaceKey` collapse is the one place a mechanical sweep can go wrong

`moduleOfWorkspace` is called from `WorkbenchShell.vue` and `MainView.vue` as the sole dispatch
(P67b's own note says the `isRepoWorkspace` special case was already removed in favour of it).
Removing it means those two dispatch on `modeStore.active` directly. Do this as its own commit,
after the file moves, and re-read each call site rather than regex-replacing: a
`WorkspaceKey`-typed variable that silently becomes `AppMode` still typechecks in places where the
runtime value used to be `repo:<id>`.

### 5.5 Part 2 commits

`feat(kira-space): frontend build and shadcn-vue set`; `feat(kira-space): port the workbench
shell`; `feat(kira-space): port theme primitives`; `refactor(kira-space): move repo/ and
views/repo/`; `refactor(kira-space): move the git stores and dialogs`; `refactor(frontend): move
Monaco entry and monarch grammars to editor/`; `refactor(frontend): drop the git module from the
workbench`; `refactor(shared): drop the git AppMode and WorkspaceKey`; `test: move the repo suites
to apps/kira-space`; `chore: teach knip and the scripts about apps/kira-space`.

---

## 6. Part 3 — the extension rename, retarget and packaging

### 6.1 Directory and package

`git mv apps/kira-studio-vscode apps/kira-space-vscode`. Root `package.json`'s `workspaces` entry
`"apps/kira-studio-vscode"` → `"apps/kira-space-vscode"`. `knip.json`'s workspace block likewise.
`scripts/build-vscode.ts`'s `VSCODE_APP`, `scripts/package-vscode.ts`'s `VSCODE_APP`/`OUT`,
`packages/git-ui/vite.config.ts`'s `vscodeApp`, `apps/kira-space-vscode/playwright.config.ts`,
`tsconfig.json`, and `typecheck:git`'s path in root `package.json`.

`packages/git-ui/src/webviewDocument.ts` and the three `tests/**/support/server.ts` harnesses
resolve the app directory by path — grep for `kira-studio-vscode` across the whole repo (19 sites)
and fix every one.

### 6.2 The exact new identifiers

| Kind | Today | New |
|---|---|---|
| `name` | `kira-studio-vscode` | `kira-space-vscode` |
| `displayName` | `Kira Version` | `Kira Space` |
| `description` | `Kira Studio's git graph, branch review and remote operations, inside VS Code.` | `Kira Space's git graph, branch review and remote operations, inside VS Code.` |
| `publisher` | `vladcirstean` | unchanged |
| command category | `Kira Version` | `Kira Space` |
| command ids (62) | `kiraVersion.<verb>` | `kiraSpace.<verb>` |
| panel container id / title | `kiraVersion` / `Kira` | `kiraSpace` / `Kira` |
| activitybar container id / title | `kiraVersionReview` / `Kira Version` | `kiraSpaceReview` / `Kira Space` |
| view ids | `kiraVersion.graph`, `kiraVersion.review` | `kiraSpace.graph`, `kiraSpace.review` |
| view name (review) | `Kira Version` | `Kira Space` |
| colour ids (14) | `kiraVersion.graphLane0-7`, `kiraVersion.reviewedLine*` | `kiraSpace.*`, values byte-identical |
| colour descriptions | `Kira Version: …` | `Kira Space: …` |
| context keys | `kiraVersion.inReviewDiff`, `kiraVersion.reviewSelection` | `kiraSpace.*` |
| comment controller | `kiraVersion.reviewComments` | `kiraSpace.reviewComments` |
| menu group | `kiraVersion@1` | `kiraSpace@1` |
| `when` clauses | `focusedView == 'kiraVersion.graph'`, `resourceScheme == kira-version` | `'kiraSpace.graph'`, `kira-space` |
| virtual-document URI scheme | `kira-version` | `kira-space` |
| settings keys (11) | `kiraVersion.<area>.<leaf>` | `kiraSpace.<area>.<leaf>` |
| `.vsix` filename | `kira-version.vsix` | `kira-space.vsix` |
| log channel / prefix | `Kira Version` | `Kira Space` |
| socket note strings | `` `~/.kira-studio/git.sock` `` | `` `~/.kira-space/git.sock` `` |
| tooltip heading | `**Kira Studio**` | `**Kira Space**` |
| README title/body | `Kira Version` / `Kira Studio` | `Kira Space` throughout |

The sweep is `kiraVersion` → `kiraSpace`, `kira-version` → `kira-space`, `Kira Version` → `Kira
Space`, and — **only inside the extension and the four git packages** — `Kira Studio` → `Kira
Space` where the string names the backend app. Run each replacement per-file, not repo-wide: `Kira
Studio` legitimately still names the DB client in `docs/`, `README.md`, `NOTICES.md`,
`scripts/demo-dbs/**`, `scripts/sign-bundle.sh` and `scripts/verify-packaging.sh`. After each
batch, `grep -rn "kiraVersion\|kira-version\|Kira Version"` over the whole repo; the count must
reach zero by the end of this part, and every remaining `Kira Studio` hit must be one that really
means the DB client.

Watch the two hazards P99 Part 1's own sweep recorded: a blanket regex renaming a name mentioned
only in a comment, and a plain string replace hitting a backtick-quoted comment. `grep -n
"kiraSpace" -- '*.md'` after each batch catches the first.

### 6.3 Retargeting the backend and the packaging chain

Backend dial path — `apps/kira-space-vscode/src/connection.ts:102-103`:
`process.env.KIRA_SPACE_HOME ?? path.join(os.homedir(), '.kira-space')`, then `git.sock`. The two
user-facing strings naming the old path (`src/extension.ts:247`, `:687`) change with it.

Packaging, the five links of §1.9:

1. `scripts/package-vscode.ts`: `OUT` → `apps/kira-space/bin/kira-space.vsix`.
2. `scripts/build-vscode.ts`: `VSCODE_APP` → `apps/kira-space-vscode`.
3. `apps/kira-space/build/Taskfile.yml` gains `build:vsix` (Kira Studio's copy is deleted), with
   `sources:` naming `apps/kira-space-vscode/**` and the four `packages/git-*/src/**`, and
   `generates: apps/kira-space/bin/kira-space.vsix`.
4. `apps/kira-space/build/darwin/Taskfile.yml`'s `create:app:bundle` and `create:app:bundle:dev`
   copy `bin/kira-space.vsix` → `Contents/Resources/kira-space.vsix`, before `codesign`. Kira
   Studio's two copies of that block are deleted.
5. `internal/gitvsix/install.go:20`: `vsixFileName = "kira-space.vsix"`. Its tests' fixtures
   follow.

`.github/workflows/release.yml` needs a second job (or a matrix leg) producing `Kira Space.dmg`,
plus its existing `apps/kira-studio-vscode/package.json` version-stamp step retargeted, its
bindings cache paths, and the bundle assertions (`= 'com.kirathecat.kira-studio'` gains a Kira
Space counterpart). **This session cannot push `.github/workflows/`** — write the intended diff to
`docs/pending-changes/.github__workflows__release.yml.patch` per `docs/DEV_ENVIRONMENT.md`'s own
section, with a one-line note, and the same for `pr.yml` if its job list needs the new app. Do the
same check for `scripts/verify-packaging.sh` and `scripts/sign-bundle.sh` — those are ordinary
files and change directly.

### 6.4 The settings-key rename is a contract change and a data change

`kiraVersion.*` → `kiraSpace.*` touches, in one commit each:

- `packages/git-ipc/src/contract.ts:70-100` — `RepoSettingsSnapshot`'s 11 readonly keys.
- `packages/git-core/src/settings/schema.ts` — the schema map's keys **and** each entry's own `key`
  field (26 sites), plus `schema.test.ts`'s 54.
- `packages/git-ui/src/state/repoSettings.ts` (12) and `RepoSettingsDialog.vue` (37).
- Go: `gitrpc`'s wire types and `gitsession`'s reads of them.
- **`CONTRACT_VERSION` / `ContractVersion` 39 → 40**, both sides, plus `gitrpc/stash_test.go:48`'s
  pin. The two are asserted equal by tests on both sides; a mismatch is a blocking panel in the
  extension, which is the correct behaviour for an extension built before this rename talking to a
  Kira Space built after it.
- **A Kira Space migration rewriting the stored keys**, since `git_repo_settings.key` holds these
  strings literally:
  `UPDATE git_repo_settings SET key = 'kiraSpace.' || substr(key, 13) WHERE key LIKE 'kiraVersion.%';`
  (`length('kiraVersion.') = 12`, so `substr(…, 13)` is the leaf). Land it as
  `0002_p100_rename_setting_keys.sql` **after** §4.5's import migration, so imported rows are
  rewritten too. Verify by round-tripping one settings write through
  `GitRepoSettingsRepo.Get`/`Set` in its existing test.

`kiraVersion.log.level`'s sentinel `repo_id = ''` row (G18 D14) is rewritten by the same statement
— confirm the test covering that sentinel still passes rather than assuming it.

### 6.5 Part 3 commits

`refactor(vscode): rename the extension directory and package`; `refactor(vscode): rename every
kiraVersion contribution id`; `refactor(vscode): rename the kira-version URI scheme`;
`refactor(git): rename the kiraVersion.* settings keys`; `feat(git)!: bump CONTRACT_VERSION to 40`
(a `!` — the handshake rejects an older extension by design); `feat(kira-space): migrate stored
setting keys`; `refactor(vscode): dial Kira Space's socket`; `build: retarget the vsix packaging
chain at Kira Space`; `docs(pending-changes): release workflow patch for Kira Space`.

---

## 7. Part 4 — the icon, the docs, and the closing audit

### 7.1 The mark: exact edits

Work on `apps/kira-space/build/appicon.icon/Assets/kira_icon_vector.svg` (copied from Kira
Studio's in Part 1). **Kira Studio's own icon is not touched** — it keeps the tan background and
all four client glyphs, which still describe it exactly.

Edit 1 — background, lines 4-11:

```xml
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3B9BE8"/>
  <stop offset="1" stop-color="#0A5FA8"/>
</linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.32" r="0.75">
  <stop offset="0" stop-color="#9FD2F7" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#9FD2F7" stop-opacity="0"/>
</radialGradient>
```

The two endpoints are the repo's own blues, not invented: `#0A5FA8` sits between
`kiraVersion.graphLane0`'s dark `#096db3` and the `--kira-accent` `#0078d4` the app already uses;
`#3B9BE8` is `graphLane0`'s light `#1b99f3` lightened to hold the same top-to-bottom contrast ratio
the tan pair had. `#9FD2F7` is the glow's `#EDCFA6` moved to the same hue family. Keep every
`offset`, `cx`, `cy`, `r` and `stop-opacity` byte-identical — only `stop-color` changes.

Edit 2 — delete all four client glyphs: **lines 31-55**, i.e. the four commented groups
`<!-- document braces -->`, `<!-- message queue -->`, `<!-- database stack -->`,
`<!-- sql cell grid -->`. The wrapper `<g stroke="#6B4A2B" …>` on line 30 and its `</g>` survive
to hold the replacement and the sparkles; change its `stroke` to `#0B4C85` (a darker blue against
the new background, same role the brown played against tan).

**The reasoning the SPEC row asked for, stated:** the message queue is a Kafka/SQS mark and the
sql cell grid a result-grid mark — both obviously gone. The **document braces** go too: they are a
JSON/document glyph belonging to the API-client half of Kira Studio, and a pair of braces on a git
mark reads as "code file", which every editor icon already claims. The **database stack** goes by
instruction. Leaving one or two orphans would make the mark say less, not more, and the four were
drawn as a set (one shared stroke wrapper, one shared fill).

Edit 3 — the replacement glyph. Do **not** draw a new one. Lift the extension's own existing
`apps/kira-space-vscode/resources/icon.svg` verbatim — it is already a correct commit-graph mark
(two lanes, four nodes, one branch curve, `viewBox="0 0 24 24"`) and reusing it makes the app icon
and the extension icon literally the same drawing, which is what "new icon, **shared** by the new
app and the renamed extension" asks for. Insert in place of the deleted glyphs, inside the same
wrapper `<g>`:

```xml
<!-- commit graph (behind the cat) — the same mark apps/kira-space-vscode/resources/icon.svg draws -->
<g transform="translate(512 512) scale(21) translate(-12 -12)" fill="none"
   stroke="#F1E4CC" stroke-width="1.6" stroke-linecap="round">
  <path d="M7 5v14M17 9v6"/>
  <path d="M7 12c0-3.9 3-6 6-6h2M13 15h2c1.7 0 4-1 4-3"/>
  <circle cx="7" cy="5" r="2.1" fill="#F1E4CC" stroke="none"/>
  <circle cx="7" cy="19" r="2.1" fill="#F1E4CC" stroke="none"/>
  <circle cx="17" cy="9" r="2.1" fill="#F1E4CC" stroke="none"/>
  <circle cx="17" cy="15" r="2.1" fill="#F1E4CC" stroke="none"/>
</g>
```

`scale(21)` maps the 24-unit box to 504 of the 1024 canvas, the same visual weight the four glyphs
carried together; `translate(-12 -12)` centres it on its own box's middle before the outer
`translate(512 512)`. The `#F1E4CC` fill is the exact cream the deleted glyphs used, kept so the
glyph reads the same against the new background as the old set did against tan. The cat (line 66
onward) still paints **over** it, since this group stays where the deleted ones were — behind.

Edit 4 — line 2: `<title>Kira Space app icon</title>`.

Edit 5 — the 8 sparkles (lines 56-65) keep their geometry; change `fill="#F6EDDC"` to `#E8F4FE`.

**Verify before rasterizing**, three checks, all runnable here: the file still parses
(`python3 -c "import xml.etree.ElementTree as E; E.parse('<path>')"`);
`grep -c "#D2A97C\|#A3794C\|#EDCFA6\|#D9B36A\|#6B4A2B\|#F6EDDC"` returns 0; and the four glyph
comments are gone while every comment in the cat block survives.

### 7.2 Rasterizing, with no rasterizer installed

`build/appicon.png` (1024×1024 RGBA) feeds `wails3 generate icons`; `resources/icon.png` (128×128)
feeds `vsce`. Neither can be hand-written.

**Route:** Playwright's Chromium, already a dev dependency (`@playwright/test` 1.63.0) and already
how `test:ui`/`test:visual` run. Write a throwaway script under
`/tmp` (never committed — it is a one-off, and `CLAUDE.md`'s no-shortcuts rule is about shipped
code, not a rasterizer invocation):

1. `bunx playwright install chromium` if the browser cache is empty (it is, in a fresh container —
   checked: `~/.cache/ms-playwright` does not exist).
2. Launch Chromium, `page.setViewportSize({width: 1024, height: 1024})`,
   `page.goto('file://<abs path to the svg>')`, `page.screenshot({path: …, omitBackground: true})`.
3. Assert the result with `file` — `PNG image data, 1024 x 1024, 8-bit/color RGBA` — and a
   non-trivial byte size.
4. Repeat at 128×128 against the extension's `resources/icon.svg` for `resources/icon.png`.

If Chromium cannot be installed in the session, **stop and say so in the result section** rather
than committing a placeholder PNG: a wrong app icon that ships is worse than a documented gap, and
the SVG (the real source) is committed either way. Record it as a `docs/ARCHITECTURE.md` **Known
open items** entry in that case, and only that case.

`build/appicon.icon/icon.json` needs no edit — it references the SVG by filename, which is
unchanged.

The extension's `resources/{icon.svg,review-icon.svg,mark-reviewed.svg,marked-reviewed.svg}` each
carry `<title>Kira Version</title>`; change all four to `Kira Space`. Their `currentColor` geometry
is untouched — VS Code themes them.

### 7.3 Documentation

- `docs/ARCHITECTURE.md` — the big one. `## Git module (v1.3)` and its six subsections
  (`Transport`, `Session model`, `Go packages`, `The extension and its packages`, `Git graph in the
  native workspace (C10)`, `Code review, ported natively (C11)`, `Git blame, inline (P62)`) all
  describe code that now lives in a different app. Rewrite each in place to name Kira Space, and
  fix the three staleness bugs this phase's investigation found: the Go-packages table lists
  `internal/startupfail` as a git package (it is not — sole importer `main.go`), says the extension
  contributes **46** commands (it is **62**), and says `ContractVersion` is **30** (it is **39**,
  going to **40**). Also: the `Stack` table, `Process model`, `Storage`'s `git_clients`/
  `git_repo_settings`/`code_repos` rows, `UI architecture`'s repo-workspace paragraphs, `Testing`'s
  suite list, and `Renderer security surface` where it names the git socket.
- `docs/PACKAGING.md` — the `.vsix`-in-the-bundle chain, now two apps.
- `docs/DEV_ENVIRONMENT.md` — a Kira Space section: its dev port (9246), its `KIRA_SPACE_HOME`, its
  own `bun run dev:space`.
- `README.md` — repo-root, and the one file `CLAUDE.md` exempts from the terse style. Two products
  now.
- `apps/kira-space/README.md`, `apps/kira-space-vscode/README.md`.
- `NOTICES.md` if any dependency attribution moved.
- **`CLAUDE.md`** — one pruning pass, per its own "prune as you go" rule: the CodeGraph section's
  note that the shipped repo-map feature was removed in P97 is still accurate and stays; nothing in
  the file names the git module, so expect the edit to be small or empty. Say which, either way.

### 7.4 Part 4 commits

`feat(kira-space): new app icon`; `feat(vscode): retitle the extension icon resources`;
`chore(kira-space): regenerate appicon.png and the extension icon.png`;
`docs: rewrite the git-module sections for Kira Space`; `docs: fix three stale
architecture facts found by P100`; then §10's audit fixes, then `docs(v1.9): record P100 Part 4`.

---

## 8. Conversion rules, across all parts

1. **A move is a move.** `git mv` + import-path rewrite, nothing else in the same commit. If a
   moved file needs a real change, that is a second commit with its own message.
2. **No behaviour change rides along.** P99 §9.4's rule, unchanged. A `setTimeout` that should be
   `useDebounceFn`, a `<style>` block that should be `@apply` — P99 already did all of that to
   these exact files. Leave them.
3. **Every new `.vue` file is `<script setup lang="ts">`**, Tailwind-styled, VueUse-composed,
   Pinia-stored, TanStack-Query-fetched — `CLAUDE.md`'s P98 rules apply to the new app from its
   first commit, and every ported file already complies.
4. **Declining a library needs a named requirement**, in code, at the site. Same standard P99
   applied to `ContextMenu.vue` and `AutocompleteField.vue`.
5. **A class name a Playwright selector reads is kept**, even where the file moves. P99 §9.2's
   rule; the moved `test:ui`/`test:unit` specs select on `.repo-head`, `.twisty`, `.prompt-scrim`
   and others.
6. **A failing gate gets fixed in the same pass**, pre-existing or not (`CLAUDE.md`). Confirm it
   predates the part with `git diff --stat` against the part's start commit, then fix it.
7. **`--no-verify` is not an ending.**

---

## 9. Verification

Baselines, from P99 Part 4's result section: `test:unit` 1535, `test:webview` 55, `test:ui` 311
(with the documented `budgets.spec.ts`/`slick-grid.spec.ts` contention flakes and the 5
pre-existing `test:visual` failures).

| Command | Expected | From |
|---|---|---|
| `go build ./...`, `go vet ./...` | Clean, both apps | Part 1 |
| `bun run lint:go` | golangci-lint clean | Part 1 |
| `bun run test:go` | Pass, including both `layering_test.go` copies | Part 1 |
| `bun run typecheck` | Clean, now **six** projects (the new `typecheck:space-web`) | Part 2 |
| `bun run lint` | Biome 0/0/0; `check-tokens.sh` resolves every token in **both** frontends | Part 2 |
| `bun run lint:dead` | knip clean but for the 6 declared duplicate warnings + 4 config hints; the new workspace block must not add a finding | Part 2 |
| `bun run build` / `bun run build:space` | Clean; record any new Vite warning | Part 2 |
| `bun run build:vscode` | Clean | Part 3 |
| `bun run package:vscode` | Produces `apps/kira-space/bin/kira-space.vsix`, PK magic, ≥1 KiB | Part 3 |
| `bun run test:unit` | 1535, split across the two apps' unit directories | Part 2/3 |
| `bun run test:webview` | 55 | Part 3 |
| `bun run test:ui` | Kira Studio's 55 specs minus the 2 moved = 53 files; total count drops by the moved specs' cases and must be accounted for exactly, not approximated | Part 2 |
| `bun run test:ui:space` | The 2 moved specs, passing | Part 2 |
| `bun run test:visual` | Same 5 pre-existing failures, no sixth. A new diff in `workbench` or `connection-dialog` is a Part 2 regression (the title bar and settings dialog both change) | Part 2 |
| `bun run verify:packaging` | Clean for both bundles | Part 3/4 |

**Both apps must actually launch.** `go build` proves nothing about a Wails window. At the end of
Part 1 and again at the end of Part 4, build and run each binary far enough to see its window and,
for Kira Space, to see `git.sock` appear at `~/.kira-space/git.sock` with mode 0600. If the
sandbox cannot run a Wails app (no display), say so explicitly in the result section rather than
implying it was checked.

---

## 10. The phase-closing audit (Part 4)

Run each over the whole repo. Account for **every** hit — converted, moved, or declined with the
requirement named. A check that finds nothing says so.

| Check | Command | Pass condition |
|---|---|---|
| No git Go code left in Kira Studio | `grep -rn "gitclient\|gitsession\|gitrpc\|gitsock\|gitops\|gitstore\|gitwire\|gitpath\|gitaskpass\|gitvsix\|gitprepare\|gitsearch\|gitreview\|gitpreflight\|ghclient\|codeworkspace" apps/kira-studio/` | Zero, outside a historical comment |
| No git frontend left in Kira Studio | `grep -rn "repo/\|views/repo\|coderepos\|repoTabs\|gitCredential\|gitClients\|repoOpenHold\|blameStatus" apps/kira-studio/frontend/src` | Zero |
| No dead route | `grep -rn "Git\|Repo\|CodeWorkspace" apps/kira-studio/frontend/src/bridge/index.ts` and `apps/kira-studio/internal/bridge/*.go` service list | Zero bound method with no Go service behind it |
| No cross-app `internal/` import | `go build ./...` | Enforced by the compiler; also `grep -rn "apps/kira-studio/internal" apps/kira-space/` returns zero |
| `layering_test` still bites | `go test ./apps/kira-studio/internal/ ./apps/kira-space/internal/` | Both pass; neither exemption set has grown |
| No `kiraVersion` anywhere | `grep -rn "kiraVersion\|kira-version\|Kira Version"` repo-wide | Zero |
| Every surviving `Kira Studio` means the DB client | `grep -rn "Kira Studio"` repo-wide | Each hit reviewed; git-package hits are zero |
| Contract versions agree | `grep -rn "ContractVersion\|CONTRACT_VERSION"` | Go and TS both 40; the pinning test updated |
| Settings keys migrated | Round-trip one `kiraSpace.*` write through `GitRepoSettingsRepo` against a DB seeded with `kiraVersion.*` rows | Reads back under the new key, sentinel `repo_id = ''` row included |
| Every component exactly one `<script>` block | `grep -c "<script"` per `.vue` across both frontends + `packages/git-ui`/`kira-ui` | Exactly 1 each (P99 Part 4 proved this for 269 files; the new app's ported copies inherit it) |
| Icon has no client glyph and no tan | `grep -c "database stack\|sql cell grid\|message queue\|document braces\|#D2A97C\|#A3794C"` in Kira Space's SVG | Zero; Kira Studio's own SVG unchanged (`git diff` empty for it) |

---

## 11. Risks

| Risk | Handling |
|---|---|
| Go's `internal/` rule discovered mid-move | §1.3/§4.3 front-load it: the hoists land **before** any git package moves, so the first move already compiles |
| A hoist touches hundreds of import lines and one gets missed | `go build ./...` after each hoist commit; a missed import is a compile error, not a silent bug |
| The shell port under-delivers and the moved views do not render | §5.2's ported subset is derived from the measured 17-store / 10-primitive list (§1.5), not guessed. Port the shell **before** moving the views, so the views land on something real |
| `WorkspaceKey` collapse typechecks but changes runtime dispatch | §5.4: hand-read both call sites, its own commit, after the moves |
| The 373-site rename hits a comment or a doc string | §6.2's per-file batches plus a `grep` after each; P99 Part 1's own two named sweep hazards |
| Renaming settings keys strands stored rows | §6.4's migration, verified by a round-trip test against a seeded DB, not by inspection |
| Two apps race on one socket or one `kira.db` | §4.4: separate homes, a separate env var, and the audit's own grep. The flock failure mode is *silent*, so this cannot be caught by "it seemed to work" |
| An existing user loses pairings and repositories | §4.5's one-time import, read-only against the studio DB, guarded by a marker row |
| No rasterizer for the icon PNGs | §7.2's Playwright route; and if Chromium cannot install, an explicit stop plus a Known-open-items entry, never a placeholder PNG |
| `.github/workflows/` cannot be pushed | §6.3: `docs/pending-changes/` patches, per `docs/DEV_ENVIRONMENT.md` |
| A part runs long and lands half an extraction | Commit per package / per directory. A part that cannot finish stops at a package or directory boundary and says so; the next part starts there rather than at this plan's boundary |
