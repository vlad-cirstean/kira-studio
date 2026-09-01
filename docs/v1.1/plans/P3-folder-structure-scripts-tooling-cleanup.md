# P3 — Folder structure, scripts, and dependency-tooling cleanup

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P3 row): *"Restructure the
> repository's folder layout to look like what a Wails app is actually supposed to have, and — since
> this is expected to grow into a monorepo hosting more Wails apps plus parts shared between their
> backends and frontends — lay that layout out with room for that growth rather than just tidying
> the current single-app shape. Includes checking whether `tests/db/` … is still in the right place
> under a monorepo-shaped tree, or belongs somewhere else instead. Audit and fix every
> dev/build/install script: `bun run dev` is broken today … and dependency installation is
> inconsistent between `npm` and `bun` across the Taskfiles and scripts rather than standardized on
> `bun`. Remove or fold in whatever folders, files, or leftover structural pieces no longer serve a
> purpose once the new layout is in place."*
>
> **`bun run dev` is worse than "broken".** It is not a no-op and it does not fail cleanly.
> Confirmed by running the real task graph in this container (F6): `install:frontend:deps:npm`
> runs `npm install` inside `shell/frontend/`, which has **no `package.json`** — so npm walks *up*
> the directory tree, finds the **repo-root `package.json`**, and installs *that* project with npm's
> own resolver. In this session it removed 331 packages from the bun-installed `node_modules` and
> wrote a root `package-lock.json`. The stock Taskfile's frontend chain does not degrade to nothing;
> it silently takes over the workspace's dependency tree with the wrong package manager. That
> answers P1's OQ-6/F14 open question with a measurement instead of a guess, and it is the single
> most urgent item in this phase.
>
> **A second, entirely unrecorded bug sits next to it.** `shell/build/Taskfile.yml`'s
> `generate:bindings` runs `wails3 generate bindings -f '…' -clean=true -ts -i` — **without `-b`
> and without `-names`**, while `scripts/wails-dev-setup.sh` runs `wails3 generate bindings -b -i
> -ts -names`. The two flags are load-bearing here, not cosmetic: `-b` makes the bindings import
> `"/wails/runtime.js"` (which `vite.config.ts:38` externalises and `tsconfig.web.json:20` types),
> and `-names` makes them call `$Call.ByName("…")` (which `tests/ui/support/mockRuntime.ts` reads
> to build `CHANNEL_TO_FQN`). **Every build path that regenerates bindings — `wails3 dev`,
> `wails3 task dev`, `bun run package` — overwrites the correct bindings with a flavour the Vite
> config and the `tests/ui` tier are both written against the opposite of** (F7).
>
> **The layout answer is `apps/` + `packages/` with a single root Go module.** The one Wails app
> moves to `apps/kira-studio/` and finally gets the shape the scaffold has always assumed — a real
> `frontend/` project with its own `package.json`, which is what makes `bun run dev` fixable at all
> rather than patchable. `src/shared` becomes `packages/shared`; `tests/db` becomes
> `packages/db-fixtures`. §3 is the tree; §4 is the mapping.
>
> **`tests/db/` should move, and the reason is not aesthetics.** Three separate documents
> (`AGENTS.md`, `docs/ARCHITECTURE.md`, `README.md`) each carry a sentence explaining that
> `tests/db/` is not a test suite. A directory that needs three standing disclaimers is misfiled,
> and under the target tree its two consumer sets sit in different top-level trees on opposite
> sides of the language boundary — which is the definition of a shared package here (F12/D5).
>
> **The most dangerous breakage in the whole move is silent.** `biome.json`'s two
> `noRestrictedImports` overrides are scoped by the literal globs `src/renderer/views/**` and
> `src/renderer/project/**` (`:65`, `:104`). Biome does not warn about an override that matches no
> files. Move `src/renderer` without editing those two globs and the repository's two architectural
> import guards stop applying, `bun run lint` keeps printing "No fixes applied", and nothing ever
> says otherwise (F10). `scripts/verify-packaging.sh`'s S2 check has the same failure mode (F14).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `f9511d2`, with every finding below checked against the tree or against a command
actually run in this container — never against P1's prose, per `docs/v1.1/README.md`'s standing rule
that a path named in an earlier plan is true only as of the phase that named it.

| Claim | Evidence |
|---|---|
| P1 landed | `wails3 task --list-all` no longer lists `common:frontend:vendor:puppertino`; `git ls-files build` is empty; `src/shared/format.ts` and `vite-raw.d.ts` are gone |
| `wails3` is installed here and the task graph is runnable | `wails3 --version` resolves; `wails3 task --list-all`, `--dry` and `--status` all executed against `shell/` this session |
| Tracked tree is clean at authoring time | `git status --porcelain` → empty |
| Tree sizes (used throughout) | `shell/` 306 tracked files (279 `.go`); `src/renderer/` 194 (71 `.vue`); `src/shared/` 23; `tests/` 89; 500 Go import sites naming the module path; 187 `@shared/*` import sites; 13 `@bindings*` import sites |

**One local side effect of this research, recorded because the next session will hit it.** Running
`wails3 task --status common:build:frontend` (§F6) executed the task's `deps` for real — `go mod
tidy`, `wails3 generate bindings`, and `npm install`. The tracked tree is unaffected
(`git status --porcelain` is empty; the stray root `package-lock.json` and the interrupted
`shell/frontend/.bindings-tmp-*` directory were both removed), but **`node_modules/` is now an npm
install, not a bun one** (405 → 208 entries). Run `bun install` before anything else. This is not a
repository change; it is the same class of note P1's F4 made.

### 0.2 Scope

1. A target folder layout for a monorepo hosting multiple Wails apps plus shared Go and TS parts,
   and the migration that gets there (§3, §4, §6).
2. `tests/db/`'s placement under that layout (§F12, D5).
3. Every script and Taskfile in the repository, read in full: `package.json`'s `scripts`,
   `scripts/*.sh`, `shell/Taskfile.yml`, `shell/build/Taskfile.yml`,
   `shell/build/darwin/Taskfile.yml`, `shell/build/config.yml` (§2).
4. Making `bun run dev` / `wails3 dev` / `wails3 task dev` work end to end, and standardising every
   dependency install on bun (§2, D8-D11).
5. Every path literal, alias, glob, include and CI reference the move breaks (§5).
6. Deleting what the new layout makes purposeless (§7).

### 0.3 Not in this phase

- Any behaviour change to the app, any dependency add/remove/upgrade, any new test.
- Splitting `internal/` into shared-vs-app-private Go packages. Nothing is shared yet; §3 reserves
  the location and creates no empty directories (D3).
- Promoting `packages/*` to real Bun workspace packages imported by package name (F11, OQ-2).
- Editing `.github/workflows/*.yml` (D15 — same `workflow`-scope constraint P1's D10 recorded).
  The **staged** copies under `docs/v1/plans/p58-pending-ci-workflows/` *are* edited (D15).
- `.gitignore`'s stock-template blocks beyond the single `out` line (F17, declined again).
- `shell/build/config.yml`'s commented-out `ios:`/`fileAssociations:` scaffold blocks (P1 F15.3,
  declined again).

### 0.4 Ground rules

- **Every decision in §6 cites a finding in §1-§2, and every finding cites something read or run.**
  Where evidence could not be obtained here, the finding says so and names the verification step
  (F8 — `bun run dev` end-to-end is macOS-only and cannot be proven in this container).
- `AGENTS.md`'s standing rules apply: no stubs, comments only where the code cannot speak for
  itself, Conventional Commits, no new unit tests (nothing here clears that bar — this phase moves
  files and edits configuration; `bun run lint`, `bun run typecheck`, `bun run build`, `go build`
  and the existing suites are the proof).
- **Run §8's verification block after every commit**, not once at the end. Each commit in §6 is
  independently green. Two of them (C1, C4) are large-but-atomic renames that cannot be split
  without leaving the tree uncompilable; that is stated where it applies and is not an invitation to
  split them anyway.

---

## 1. Findings — the current layout, and what a Wails app is supposed to look like

### F1 — The canonical Wails v3 layout, read from the pinned CLI's own templates rather than the docs

`v3.wails.io` is 403-blocked from every box here (`AGENTS.md`), so the shape was read from the
installed module: `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/internal/templates/`.
`wails3 init -t vue` produces exactly this:

```
<project>/
  main.go                     # the `main` package; //go:embed all:frontend/dist
  go.mod  go.sum
  Taskfile.yml                # from _common/Taskfile.tmpl.yml
  build/
    Taskfile.yml              # common: tasks (install/build/dev frontend, bindings, icons)
    config.yml                # info + dev_mode.executes
    appicon.png  appicon.icon/
    darwin/  windows/  linux/ # per-platform Taskfile + assets
  frontend/                   # ← a real npm project
    package.json              # scripts: dev / build / build:dev / preview
    vite.config.ts
    index.html
    src/{main.ts,App.vue,...}
    bindings/                 # generated, gitignored
    dist/                     # generated, gitignored
  bin/                        # generated, gitignored
  .task/                      # generated, gitignored
```

`_common/gitignore.tmpl` confirms which of those are generated: `.task`, `bin`, `frontend/dist`,
`frontend/node_modules`.

**The single non-negotiable constraint the whole layout hangs off:** `main.go`'s
`//go:embed all:frontend/dist`. Go's `embed` cannot reference a path outside the embedding package's
own directory — no `..` is permitted — so **the built frontend bundle must land inside the Go main
package's directory tree**. Any layout that puts the frontend somewhere else must still write its
`dist` back under the app's Go directory. That is precisely the compromise this repo made, and it is
why `shell/frontend/` exists at all.

### F2 — What this repo actually has, and the exact shape of the mismatch

```
kira-studio/
  package.json  vite.config.ts  tsconfig{,.node,.web}.json  playwright.config.ts  biome.json
  src/renderer/     ← the real frontend (194 files, 71 .vue), vite `root`
  src/shared/       ← 23 .ts: wire protocol + domain contract
  shell/            ← the Wails project root: main.go, go.mod, Taskfile.yml, build/, internal/
    frontend/
      bindings/     ← generated, gitignored
      dist/         ← generated, gitignored
      (no package.json, no index.html, no src/)
  tests/{unit,ui,ipc,e2e-real}/   ← four suites
  tests/db/         ← not a suite: fixtures/*.sql + support/*.ts
  scripts/{*.sh, demo-dbs/}
  docs/
```

`shell/frontend/` is a **hollowed-out scaffold slot**: the scaffold's `frontend/` project was
deleted, but the two generated directories it owned were kept because `main.go` embeds one of them
and `vite.config.ts:32` writes the other. Everything the scaffold's Taskfile expects to find there —
`package.json`, `index.html`, `src/`, a lockfile — lives at the repo root instead, under different
names. **Every problem in §2 is a direct consequence of that one mismatch**, which is why §3 fixes
the mismatch rather than teaching the Taskfile about it.

Two further mismatches worth naming, because they are what "many structural things unaddressed"
means concretely:

- **The repo root is simultaneously three things**: the workspace root (lockfile, Biome, git hooks),
  the frontend project root (`package.json` with `vite`/`vue` deps, `vite.config.ts`,
  `tsconfig.web.json`), and the test-runner root (`playwright.config.ts`, `tsconfig.node.json`).
  Adding a second app to this root has no non-colliding answer for any of the three.
- **`src/` no longer means anything.** After P58f deleted `src/main`, `src/preload` and
  `src/engine`, `src/` holds exactly two children, one of which (`renderer`) is Electron vocabulary
  for a process that no longer exists (P1 F11, recorded as OQ-2 and handed forward). Under the
  target layout the name disappears as a side effect of the move rather than needing a rename of its
  own.

### F3 — How comparable monorepos lay this out, and which convention actually applies here

The relevant conventions, and how each interacts with this repo's two hard constraints (Go's embed
rule from F1; Playwright's module resolution from F11):

| Convention | Who uses it | Fit here |
|---|---|---|
| `apps/<app>/` + `packages/<lib>/`, one workspace manifest at the root | Turborepo, Nx (as `apps/` + `libs/`), pnpm/Bun/Yarn workspaces generally | **Adopted.** `apps/*` is per-deployable; `packages/*` is cross-app. Bun implements `workspaces` natively, so this is the manifest shape the repo's existing package manager already understands |
| Single Go module at the repo root, apps as `cmd/<app>` or `apps/<app>`, shared code under a root `internal/` or `pkg/` | The standard Go monorepo shape | **Adopted** (D2). Root `internal/…` is importable by every app in the module and invisible outside it — exactly the semantics "parts shared between their backends" needs, with no `go.work`, no `replace` directives and one dependency set |
| A Go module per app plus a root `go.work` | Go workspaces (1.18+) | **Rejected for now** (D2). It buys per-app dependency isolation nobody has asked for, at the cost of a second dependency graph to keep in sync. `go.work` remains a one-file upgrade if that changes |
| Per-app frontend project under `apps/<app>/frontend`, listed in the root workspace glob | any JS monorepo with per-app UIs | **Adopted.** It is *also* the stock Wails slot (F1), so the app satisfies both conventions at once rather than trading one off against the other |

The single design point where the Wails constraint and the monorepo convention could have collided —
where does the frontend live? — resolves cleanly: `apps/kira-studio/frontend/` is simultaneously the
workspace member glob `apps/*/frontend` and the `frontend/dist` sibling `//go:embed` requires. No
compromise is needed, and the current layout is the only one that needed one.

### F4 — The Go module path is cheap to change, because the bindings alias already insulates it

`shell/go.mod:1` is `module github.com/kirathecat/kira-studio/shell`. That string appears in:

- **500 import sites across 279 `.go` files** — one `sed`, fully proved by `go build ./...`.
- **Four config files**, as the generated-bindings output path: `vite.config.ts:23,27`,
  `tsconfig.json:6,9`, `tsconfig.web.json:15,18`, `tests/unit/tsconfig.json:15,18`. The bindings
  generator writes each package under its own import path (`internal/generator/config/file.go:44`'s
  `DirCreator` joins the output dir with the package-relative path), which is why the on-disk tree is
  `shell/frontend/bindings/github.com/kirathecat/kira-studio/shell/internal/bridge/`.
- **One test source file**: `tests/ui/support/mockRuntime.ts:33`'s
  `const BRIDGE_PKG = 'github.com/kirathecat/kira-studio/shell/internal/bridge'`.

**Only 13 import sites in the whole repository name `@bindings`/`@bindings-internal`** (all in
`src/renderer/bridge/control.ts`), because P57 D8 aliased the path once instead of repeating it.
That decision is what makes the module-path change a five-file edit rather than a hundred-file one —
worth recording, since the same reasoning is why §3 keeps `@shared/*` as an alias too (F11).

**The escape hatch, named so it is a decision and not an oversight:** Go permits a module path that
does not match its on-disk location. This module is private and never `go get`-ed, so the 500 import
sites *could* be left naming `…/kira-studio/shell` after the directory becomes
`apps/kira-studio`. D2 declines that: it would leave the bindings output tree, and every Go import
line in the repository, naming a directory that no longer exists — the exact species of stale naming
this phase exists to remove.

### F5 — `tests/` is four app-specific suites, not a cross-cutting tier

Checked file by file rather than assumed from the directory name:

| Suite | What it is bound to | App-specific? |
|---|---|---|
| `tests/unit/` | 16 of its 17 spec files import `../../src/renderer/…` directly | yes |
| `tests/ui/` | serves `shell/frontend/dist` (`support/server.ts:8`); shells `go list` in `shell/` (`support/mockRuntime.ts:29`); hardcodes the app's Go bridge package (`:33`) | yes |
| `tests/ipc/` | frontend half drives the app's Vue UI; its `*.fixture.ts` files are written by `shell/internal/ipcfixture`'s Go tests | yes |
| `tests/e2e-real/` | builds and spawns *this app's* `-tags server` binary (`fixtures.ts:14-16,61-71`) | yes |

There is no suite in `tests/` that would survive a second app being added without being re-scoped.
That is the argument for moving all four under `apps/kira-studio/tests/` (D4) — not tidiness. The
counter-argument is recorded honestly in D4.

---

## 2. Findings — scripts, Taskfiles, and the broken dev loop

### F6 — `bun run dev` is broken, and the failure mode is destructive rather than inert

The chain, traced through the pinned CLI's own source and then run:

1. `package.json:11` — `dev` is `bun run build && cd shell && wails3 task dev`.
2. `shell/Taskfile.yml:29-32` — `dev` is `wails3 dev -config ./build/config.yml -port {{.VITE_PORT}}`.
3. `internal/commands/dev.go` — `wails3 dev` reserves the port, exports `WAILS_VITE_PORT` and
   `FRONTEND_DEVSERVER_URL=http://localhost:9245`, then runs the watcher over `build/config.yml`.
4. `shell/build/config.yml:57-63` — `dev_mode.executes` runs, in order:
   `wails3 build DEV=true` (blocking) → `wails3 task common:dev:frontend` (background) →
   `wails3 task run` (primary).
5. `internal/commands/task_wrapper.go:68` — `wails3 build` dispatches through the **root** `build`
   task with `DEV=true` as a global Task variable, so `.DEV` resolves to `"true"` everywhere below.
6. `shell/Taskfile.yml:14-17` → `darwin:build` → `build:native`, whose `deps` include
   `common:build:frontend` (`shell/build/darwin/Taskfile.yml:31`).
7. `shell/build/Taskfile.yml:72-100` — `build:frontend` has `dir: frontend`, `deps:
   install:frontend:deps` + `generate:bindings`, and runs `frontend:run` with
   `SCRIPT: build:dev` (because `DEV=true`).
8. `shell/Taskfile.yml:6` — `PACKAGE_MANAGER` defaults to **`npm`**, so both `install:frontend:deps`
   and `frontend:run` dispatch to their `:npm` variants, which `cd` into `shell/frontend/`.

**What the dry run says** (`cd shell && wails3 task --dry common:build:frontend`, run this session):

```
task: [common:go:mod:tidy] go mod tidy
task: [common:generate:bindings] wails3 generate bindings -f '' -clean=true -ts -i
task: [common:install:frontend:deps:npm] npm install
task: [common:frontend:run:npm] npm run build -q
```

and `wails3 task --dry common:dev:frontend`:

```
task: [common:install:frontend:deps:npm] npm install
task: [common:frontend:dev:npm] npm run dev -- --port 9245 --strictPort
```

**Task's fingerprinting does not save it.** P1's F14 left open the possibility that
`build:frontend`'s `sources`/`generates` would mark it up to date and skip the whole chain. It does
not: the dry runs above list the commands, and the same command against a task that *is* cached
prints `task: Task "common:generate:icons" is up to date` instead. `shell/.task/checksum/` contains
exactly one entry (`common-generate-icons`), confirming the frontend chain has never completed in
this tree.

**What actually happens when it runs.** `wails3 task --status common:build:frontend` executed the
`deps` for real. `npm install` in `shell/frontend/` did **not** fail: npm found no `package.json`
there, walked up through `shell/` to the **repo root**, and installed the root project with npm's
resolver — printing `removed 331 packages, and audited 279 packages` and writing a root
`package-lock.json`. So the stock chain does not degrade to a no-op and does not fail loudly; it
replaces the workspace's bun-installed dependency tree with an npm one and leaves a foreign lockfile
behind. **This is the finding P1 could not obtain and OQ-6 handed forward** (P1 §9 OQ-6), and it
resolves it: the answer is neither "harmless" nor "a macOS-only packaging bug" — it is a
workspace-corrupting default on every platform.

**Even with `PACKAGE_MANAGER=bun`, the chain still cannot work today**, for three independent
reasons, each of which §3's layout removes rather than patches:

1. `shell/frontend/` has no `package.json` at all, so there is no `dev`, `build` or `build:dev`
   script to run.
2. Pointing `dir:` at the repo root instead is a trap, not a fix: `frontend:dev:bun` would run
   `bun run dev`, and the root `dev` script is `bun run build && cd shell && wails3 task dev` —
   **infinite recursion**. The root `package.json`'s script namespace and the Wails frontend
   project's script namespace need different `dev`/`build` meanings and cannot be the same file.
3. `build:frontend` asks for `build:dev` when `DEV=true`; no `build:dev` script exists anywhere in
   the repository.

### F7 — The two binding generators disagree on flags, and the build path's flags are the wrong ones

| Caller | Command |
|---|---|
| `scripts/wails-dev-setup.sh:64` | `wails3 generate bindings -b -i -ts -names` |
| `shell/build/Taskfile.yml:154` | `wails3 generate bindings -f '{{.BUILD_FLAGS}}' -clean=true{{…}} -ts -i` |

From `internal/flags/bindings.go:16-19`: `-b` is *"Use the bundled runtime instead of importing the
npm package"*; `-names` is *"Use names instead of IDs for the binding calls"*. Both are load-bearing:

- **`-b`** makes every generated module `import { Call as $Call, … } from "/wails/runtime.js"`.
  `vite.config.ts:38` marks `/^\/wails\//` external precisely so that import stays literal, and
  `tsconfig.web.json:20` maps `/wails/runtime.js` onto `@wailsio/runtime`'s types. Without `-b` the
  bindings import the npm package instead and Vite bundles a second copy of the runtime into the
  app, next to the one Wails' own asset server already serves at that URL.
- **`-names`** makes them call `$Call.ByName("…")`. `tests/ui/support/mockRuntime.ts:36` states in
  its own comment that `CHANNEL_TO_FQN`'s values were read off the bindings with
  `grep -rhoE '\$Call\.ByName\("[^"]+"'`, and `tests/e2e-real/support/passthrough.ts` reuses that
  table for its allowlist. Without `-names` those strings do not exist in the generated output.

The bindings currently on disk are the `-b -names` flavour (verified: every service module imports
from `"/wails/runtime.js"`, and `$Call.ByName` appears 30+ times across the bridge package with zero
`ByID`), because `scripts/wails-dev-setup.sh` wrote them. **The first `bun run dev` or `bun run
package` that reaches `generate:bindings` replaces them with the wrong flavour**, and since
`shell/frontend/bindings/` is gitignored, nothing in review or CI would show the swap.

### F8 — `bun run dev` is a macOS-only workflow, and this cannot be verified end to end here

`shell/Taskfile.yml`'s `build`/`run` dispatch straight to `darwin:*` (the repo trimmed the stock
`{{.GOOS}}` dispatch, since the product is macOS-only). On Linux, `darwin:build` selects
`build:docker`, which has a `docker info` precondition and needs a prebuilt `wails-cross` image; and
`darwin:run` codesigns. So **no session without macOS can prove the fixed `bun run dev` end to
end.** What *is* provable here, and what §8 therefore asks for:

- `wails3 task --dry dev` / `--dry common:build:frontend` list the intended commands.
- `wails3 task common:dev:frontend` really starts Vite on 9245 (a pure-frontend step with no
  darwin dispatch in its path).
- `go build ./...`, `bun run build`, `bun run lint`, `bun run typecheck`, `bun run test:unit`,
  `bun run test:ui`, `go test ./…` all run here.

`docs/PACKAGING.md` §6 already records that every §4 packaging item is unrun for want of hardware;
this phase adds `bun run dev` to that list rather than reporting it as passed. Say so explicitly in
the acceptance walkthrough (§9 item 12).

### F9 — `package.json`'s scripts: what breaks, and the one that is about to become a lie

Read in full. All thirteen have a live consumer (P1 F5 verified that and nothing has changed), so
**nothing here is deleted for staleness**. What changes is paths, plus two substantive edits:

| Script | Current | Why it changes |
|---|---|---|
| `prepare` | `git config core.hooksPath .githooks \|\| true` | unchanged — `.githooks/` stays at the workspace root |
| `predev` | `sh scripts/wails-dev-setup.sh` | unchanged path; the script's internals change (F13) |
| `dev` | `bun run build && cd shell && wails3 task dev` | `cd apps/kira-studio`; **and the `bun run build` prefix is dropped** — once `build:frontend` works, the Taskfile owns the frontend build, and keeping a second one in front of it is exactly the duplication that let the Taskfile's own copy rot unnoticed. (`//go:embed all:frontend/dist` requires the directory to *exist* at compile time even in dev mode, so `build:frontend` must run — it does, as `build:native`'s dep.) |
| `build` | `vite build` | becomes a delegation into the frontend workspace member: `cd apps/kira-studio/frontend && bun run build`. `vite.config.ts` no longer lives at the root |
| `lint`/`format` | `biome check [--write] .` | unchanged commands; `biome.json`'s override globs change (F10) |
| `typecheck:node` | `tsgo --noEmit -p tsconfig.node.json` | project file moves and is renamed (F16) → `typecheck:tests` |
| `typecheck:web` | `vue-tsc --noEmit -p tsconfig.web.json` | → `apps/kira-studio/frontend/tsconfig.json` |
| `typecheck:unit` | `tsgo --noEmit -p tests/unit/tsconfig.json` | → `apps/kira-studio/tests/unit/tsconfig.json` |
| `test:ui` / `test:ipc:fe` | `bun run build && playwright test --project=…` | `playwright.config.ts` moves under the app, so these become `bun run build && cd apps/kira-studio && playwright test --project=…` |
| `test:unit` | `bun test tests/unit` | → `bun test apps/kira-studio/tests/unit` |
| `test:go` | `cd shell && go test ./...` | → `go test ./...` (one root module) |
| `package` | `cd shell && wails3 task darwin:package && sh ../scripts/sign-bundle.sh` | → `cd apps/kira-studio && … && sh ../../scripts/sign-bundle.sh` |
| `verify:packaging` | `sh scripts/verify-packaging.sh` | unchanged path; the script's internals change (F14) |

**`workspaces` is added** (`["apps/*/frontend"]`). Without it, a `bun install` run from inside
`apps/kira-studio/frontend/` — which `install:frontend:deps` does — would treat that directory as its
own project and create a second `node_modules` and `bun.lock` there. With it, bun resolves to the
workspace root and installs once. `packages/*` is deliberately **not** in the glob (F11).

### F10 — `biome.json` breaks silently. This is the highest-risk single line in the migration

`biome.json:65` and `:104` scope the two `noRestrictedImports` overrides with literal globs:

```json
{ "includes": ["src/renderer/views/**"],   … "SPEC §11: views/* must not import from workbench/* …" }
{ "includes": ["src/renderer/project/**"], … "SPEC §11: project/ must not import views/ directly …" }
```

Biome applies an override to whatever the glob matches and **says nothing when it matches nothing**.
Move `src/renderer` and forget these two lines and both architectural guards silently stop
applying — `bun run lint` still reports "No fixes applied", the pre-commit hook still passes, CI
still passes, and the next `views/<kind>` → `views/<other-kind>` import lands unnoticed. The 20+
relative patterns *inside* each override (`../grid/**`, `**/workbench/**`, …) stay correct and must
not be touched; only the two `includes` globs change.

**Verification that the guard is still live must be positive, not "lint passed."** §8 specifies it:
temporarily add `import '../grid/page';` to a file under `views/documents/`, confirm
`bun run lint` *fails* with the SPEC §11 message, revert.

`biome.json:11-12`'s `"!out"` / `"!dist"` also matter here: `"!dist"` is what keeps Biome off
`apps/kira-studio/frontend/dist` after the move (`vcs.useIgnoreFile: true` plus `.gitignore`'s bare
`dist` line covers it too, but the two are independent). `"!out"` goes with the `out/` deletion (F17).

### F11 — `@shared/*` stays a tsconfig `paths` alias. Playwright is the reason, and it is not obvious

`@shared/*` has 187 import sites: `src/renderer` 148, `tests/ui` 31, `tests/unit` 6, `tests/ipc` 1,
`tests/db` 1. The monorepo-idiomatic move would be to make `packages/shared` a real Bun workspace
package (`@kira/shared`) and rewrite all 187 specifiers, dropping the alias from four config files.
**Do not do that in P3.** Three things resolve `@shared/*` today and they do not resolve a raw-TS
workspace package the same way:

- **Vite** — `vite.config.ts:16`'s `resolve.alias`.
- **Bun** (`bun test tests/unit`) — reads `paths` from the nearest `tsconfig.json`.
- **Playwright** — reads `compilerOptions.paths` from the nearest `tsconfig.json` above each test
  file. This is why the root `tsconfig.json` carries a `paths` block at all despite `"files": []`
  and nothing but `references`: **that block exists for Playwright's resolver, not for `tsc`.**
  Playwright compiles test files with its own transform and does **not** transform files inside
  `node_modules`, which is where a workspace package's symlink lives — so a `@kira/shared` whose
  `exports` point at raw `.ts` sources would resolve and then fail to parse in `tests/ui`'s 31
  import sites.

So: relocate the directory, keep the alias name, update its four targets. Zero import-site churn,
and the one place a second app would need to opt in is its own tsconfig — which it needs anyway for
`@bindings`. Recorded as OQ-2 for whenever a real second consumer makes the package-name migration
worth measuring, and **verify the Playwright claim before acting on OQ-2** rather than trusting this
paragraph (P1 F1's own warning about snapshot claims applies).

### F12 — `tests/db/` is misfiled, and its contents prove it

Read in full — 12 files, no specs:

```
tests/db/fixtures/  0001_seed.sql 0002_mariadb_seed.sql 0005_kafka_seed.ts
                    0008_mysql_seed.sql 0009_sqlite_seed.sql 0010_clickhouse_seed.sql
tests/db/support/   connectionConfig.ts docker.ts kafka.ts mariadb.ts postgres.ts sqlite.ts
```

Consumers, verified by grep rather than by the docs' description of them:

| Consumer | How it reaches in |
|---|---|
| `shell/internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go` | `filepath.Join(repoRoot(), "tests", "db", "fixtures", "…")` — five literal path joins, with `repoRoot()` at `postgres.go:49-52` walking `runtime.Caller(0)`'s directory up **four** levels |
| `tests/e2e-real/support/{postgres,mariadb,kafka,sqlite}.ts` | four `export … from '../../db/support/…'` re-export lines |
| `tsconfig.node.json:20` | `"tests/db/support/**/*.ts"` in `include` |
| `tests/db/support/{postgres,sqlite,mariadb}.ts` themselves | `resolve(__dirname, '../fixtures/…')` — **internal**, so `fixtures/` and `support/` must move together or not at all |

**Three separate documents each carry a standing sentence explaining that this directory is not what
its name says** — `AGENTS.md:113` (*"for `tests/db/`'s container fixtures"*),
`docs/ARCHITECTURE.md:773` (*"`tests/db/` is a shared fixture corpus now, not a spec suite"*),
`README.md:169` (*"a shared fixture corpus … not a spec suite of its own"*). A directory that needs
three disclaimers is misfiled, and P1 F18's *"keep"* was correct for an audit whose charter excluded
renames — this phase's charter names it explicitly.

Under the target tree the case gets stronger, not weaker: its Go consumer moves to
`apps/kira-studio/internal/…`, its TS consumer moves to `apps/kira-studio/tests/e2e-real/…`, and a
second app's adapters would want the same corpus. That is a `packages/` member by definition.
**Move to `packages/db-fixtures/`, keeping `fixtures/` and `support/` as its two children** (D5).
It gets no `package.json`: for exactly F11's reason, `tests/e2e-real/support/*.ts` keeps importing it
by relative path rather than by package name.

### F13 — `scripts/wails-dev-setup.sh`: three path edits, and one duplication worth removing

Read in full (65 lines). It is correct and post-cutover accurate. What the move breaks:

- `:21` `grep -m1 'github.com/wailsapp/wails/v3 ' "$ROOT_DIR/shell/go.mod"` → `"$ROOT_DIR/go.mod"`.
- `:62` `if [ ! -d "$ROOT_DIR/shell/frontend/bindings" ]` → `"$ROOT_DIR/apps/kira-studio/frontend/bindings"`.
- `:64` `(cd "$ROOT_DIR/shell" && wails3 generate bindings -b -i -ts -names)` → the new app dir.

`ROOT_DIR` (`:12`, `dirname $0/..`) stays correct because the script stays in `scripts/`.

**The duplication.** This is the second of the two binding generators F7 caught disagreeing. The
durable fix is not to sync two flag lists but to have one: replace `:64`'s body with
`(cd "$ROOT_DIR/apps/kira-studio" && wails3 task common:generate:bindings)`. That makes
`shell/build/Taskfile.yml`'s task the single definition of how this repository generates bindings,
and the divergence class cannot recur. Cost: the task's `deps: go:mod:tidy` runs `go mod tidy` on a
fresh clone (desirable) and it writes a `.task/` checksum entry (gitignored). **If the implementer
finds this makes a cold `bun run dev` materially slower or introduces a chicken-and-egg with a
not-yet-installed `wails3`, take the fallback instead: keep the direct invocation and make the two
flag lists identical** — and say which was taken, in the commit message.

### F14 — `scripts/verify-packaging.sh`: one check degrades silently, one path breaks loudly

Read in full (97 lines). Post-P1 the prose is accurate and S1/S2/S5 are the checks that exist.

- **S1** (`:31`) greps `package.json` for `electron-updater`/`update-electron-app`. Unaffected.
- **S2** (`:36`) is `if grep -rnE "autoUpdater|electron-updater" src/ >/dev/null 2>&1`. **After the
  move `src/` does not exist.** `grep` on a missing directory exits non-zero with its stderr
  swallowed by the `2>&1` redirect, the `if` is false, and the check passes forever without ever
  looking at anything. Same silent-degradation shape as F10. Repoint at `apps/ packages/`.
- **S5** (`:41`) reads `package.json`'s `package` script via `node -p` and requires it to contain
  `wails3 task darwin:package`. The rewritten script still does, so the `case` pattern holds
  unchanged. (P1 F6's note that `node` is no longer a declared toolchain dependency stands; still not
  worth changing blind — leave it, or substitute `bun -e` only if it is a clean swap.)
- **`APP="shell/bin/Kira Studio.app"`** (`:47`) → `apps/kira-studio/bin/Kira Studio.app`. This one
  fails loudly (the artifact checks print "skipped"), so it is the less dangerous of the two.

### F15 — `scripts/sign-bundle.sh` and `scripts/demo-dbs/`

`sign-bundle.sh` (29 lines, read in full): one path, `:13`
`APP="$ROOT_DIR/shell/bin/Kira Studio.app"` → `apps/kira-studio/bin/…`; and `:16`'s error message
names `cd shell && wails3 task darwin:package`. Nothing else.

`scripts/demo-dbs/` (18 files): a manual developer tool, referenced from `README.md` and reachable as
`bash scripts/demo-dbs/seed.sh`. It contains **no path that the move breaks** — only prose
cross-references to `tests/db/support/*` (`README.md:14,18`, `docker-compose.yml:119,156`,
`kafka/seed.sh:4`, `s3/seed.sh:5,11`, `sqs/seed.sh:4`, `mysql/init.sql:6`, `clickhouse/init.sql:162`),
which become `packages/db-fixtures/support/*`. **Stays at `scripts/demo-dbs/`** (D6).

### F16 — Every tsconfig and the Playwright config, and the two that are named for a shape that is gone

- `tsconfig.json` — solution file: `paths` (three aliases, for Playwright per F11) + three
  `references`. Becomes the workspace solution; the app gets its own.
- `tsconfig.node.json` — six `include` globs (`src/shared`, `playwright.config.ts`,
  `tests/e2e-real`, `tests/ui`, `tests/db/support`, `tests/ipc`) and a `@shared/*` path. **Every one
  of the six moves.** Its name has been inaccurate since Electron left (P1 F17, OQ-2): it is "the
  non-DOM TypeScript project", not "the Node-process project". Renamed here to
  `apps/kira-studio/tsconfig.tests.json`, which is what its `include` list actually describes.
- `tsconfig.web.json` — four `paths` + three `include` globs. Becomes
  `apps/kira-studio/frontend/tsconfig.json`, the stock Wails slot, which also puts it where
  Playwright and Bun will find it for frontend files.
- `tests/unit/tsconfig.json` — three `paths` (all `../../`-relative) + `include`
  `["**/*.ts", "../../src/renderer/env.d.ts"]`. Depth from the repo root is unchanged under the
  target tree (`apps/kira-studio/tests/unit` is four levels deep, not two), so **every `../../`
  becomes `../../../../`** — an easy edit to get wrong by exactly one level.
- `playwright.config.ts` — three `testDir`s and `outputDir: 'test-results'`. Moves to
  `apps/kira-studio/`; the `testDir` values stay `./tests/…` verbatim because they move with it.
  `test-results/` and `playwright-report/` land under the app; `.gitignore`'s existing
  `test-results/` and `playwright-report/` lines match at any depth, so no ignore change is owed.

### F17 — What the new layout makes purposeless

- **`src/`** — emptied by the move; the directory itself goes.
- **`shell/`** — emptied by the move; the directory itself goes.
- **`shell/.gitignore`'s `runtime` line** — P58f deleted the vendored Node runtime; `git ls-files
  shell/runtime` is empty and no build writes it. The 126 MB `shell/runtime/{node,engine}` tree still
  on disk here is pre-cutover residue (P1 F4) and should be deleted locally. The ignore line survives
  only because nothing swept it.
- **The npm / pnpm / yarn task variants** in `shell/build/Taskfile.yml` — seven tasks
  (`install:frontend:deps:{npm,pnpm,yarn}`, `frontend:run:{npm,yarn,pnpm}`,
  `frontend:dev:{npm,yarn,pnpm}`), ≈45 lines. This repository has one package manager. Keeping three
  wrong ones and defaulting to one of them is precisely the "inconsistent between npm and bun"
  the SPEC row names, and F6 is what that costs. Deleting them turns `PACKAGE_MANAGER=npm` from a
  silent workspace corruption into a "task not found".
- **`out/`** — untracked, 126 MB-adjacent residue of the pre-cutover esbuild bundling
  (`out/tests/ipc/mariadb.backend.spec.cjs`, plus copies of three fixtures that no longer exist in
  the repository at all). Nothing writes it. Delete on disk, and delete `.gitignore`'s stock Next.js
  `out` line and `biome.json:11`'s `"!out"` with it — *bounded to that one line*; P1 F16 declined
  the wider `.gitignore` boilerplate sweep for a reason that still holds, and D14 declines it again.
- **On-disk only, no commit**: `shell/runtime/`, `out/`, `shell/bin/kira-server-test`,
  `playwright-report/`, `test-results/`, any stray `package-lock.json`, and any
  `shell/frontend/.bindings-tmp-*` left by an interrupted `generate bindings -clean`.

**Explicitly not deleted**, recorded so the next pass does not re-derive it: `shell/blank/`
(embedded by `main.go:52`, `docs/PERF.md` §2.3 — moves with the app; its `Call.ByID(3273072800)`
staleness is P1's OQ-3 and F7 gives it a new angle, see OQ-3 below), `shell/cmd/g1measure/`,
`shell/build/.task/unused-icon.ico` (untracked and deliberate), `shell/build/config.yml`'s
commented-out scaffold blocks (P1 F15.3), `scripts/demo-dbs/`, and every dependency in
`package.json` (P1 D1 — nothing has changed).

---

## 3. Target layout

```
kira-studio/
├── AGENTS.md  LICENSE  NOTICES.md  README.md
├── biome.json  bunfig.toml  bun.lock  package.json      # workspace root
├── go.mod  go.sum                                       # module github.com/kirathecat/kira-studio
├── tsconfig.json                                        # workspace solution (files:[], references)
├── .githooks/            pre-commit
├── .github/workflows/    ci.yml  release.yml            # not edited in P3 (D15)
│
├── apps/                                                # one directory per deployable app
│   └── kira-studio/                                     # the Wails v3 app (stock scaffold shape)
│       ├── Taskfile.yml                                 # was shell/Taskfile.yml
│       ├── README.md                                    # was shell/README.md
│       ├── .gitignore                                   # was shell/.gitignore, minus `runtime`
│       ├── main.go                                      # was shell/main.go
│       ├── playwright.config.ts                         # was ./playwright.config.ts
│       ├── tsconfig.json                                # new: app solution + `paths` for Playwright
│       ├── tsconfig.tests.json                          # was ./tsconfig.node.json
│       ├── bin/                                         # generated, gitignored
│       ├── blank/            index.html                 # G1 measurement page
│       ├── build/                                       # Taskfile.yml  config.yml  appicon*  darwin/
│       ├── cmd/              g1measure/
│       ├── frontend/                                    # the Wails frontend slot, now real
│       │   ├── package.json                             # new: dev / build / build:dev
│       │   ├── vite.config.ts                           # was ./vite.config.ts
│       │   ├── tsconfig.json                            # was ./tsconfig.web.json
│       │   ├── index.html                               # was src/renderer/index.html
│       │   ├── src/                                     # was src/renderer/** (194 files)
│       │   ├── bindings/                                # generated, gitignored
│       │   └── dist/                                    # generated, gitignored
│       ├── internal/                                    # was shell/internal (app-private Go)
│       └── tests/
│           ├── unit/     ui/     ipc/     e2e-real/     # were tests/{unit,ui,ipc,e2e-real}
│
├── packages/                                            # cross-app shared source
│   ├── shared/                                          # was src/shared — `@shared/*` alias target
│   └── db-fixtures/      fixtures/  support/            # was tests/db
│
├── scripts/              wails-dev-setup.sh  sign-bundle.sh  verify-packaging.sh  demo-dbs/
└── docs/                 ARCHITECTURE.md  PACKAGING.md  PERF.md  design/  v1/  v1.1/
```

**Reserved, created only when first used (D3):**

- **`apps/<second-app>/`** — same internal shape; picked up automatically by the `apps/*/frontend`
  workspace glob and by `go build ./...`.
- **root `internal/`** — shared **Go**. Importable as `github.com/kirathecat/kira-studio/internal/…`
  by every app in the module and by nothing outside it. Go's own `internal` rule gives exactly the
  visibility a monorepo wants, with no extra machinery.
- **`packages/<name>/`** — shared **TypeScript/Vue**, same treatment as `packages/shared`.

Two ecosystems, two idiomatic names, no overlap: `packages/` is the TS side, root `internal/` is the
Go side. `apps/*/internal/` remains app-private by the same Go rule. Nothing empty is created now.

---

## 4. Mapping — what moves where

| Today | Target | Notes |
|---|---|---|
| `shell/**` (306 files) | `apps/kira-studio/**` | `git mv`; preserves history |
| `shell/go.mod`, `shell/go.sum` | `./go.mod`, `./go.sum` | module path `…/kira-studio/shell` → `…/kira-studio`; single root module (D2) |
| `github.com/kirathecat/kira-studio/shell/internal/…` (500 sites) | `github.com/kirathecat/kira-studio/apps/kira-studio/internal/…` | one `sed`, proved by `go build ./...` |
| `shell/.gitignore` | `apps/kira-studio/.gitignore` | contents (`frontend/dist`, `frontend/bindings`, `frontend/node_modules`, `bin`, `.task`) stay correct relative to their own directory; the `runtime` line is deleted |
| `src/renderer/index.html` | `apps/kira-studio/frontend/index.html` | `<script src="./main.ts">` → `"/src/main.ts"` |
| `src/renderer/**` (rest) | `apps/kira-studio/frontend/src/**` | |
| `src/shared/**` (23 files) | `packages/shared/**` | `@shared/*` alias retargeted; 187 import sites unchanged (F11) |
| `src/` | *(deleted)* | empty |
| `tests/{unit,ui,ipc,e2e-real}` | `apps/kira-studio/tests/{…}` | app-specific by evidence (F5) |
| `tests/db/{fixtures,support}` | `packages/db-fixtures/{fixtures,support}` | F12/D5 |
| `tests/` | *(deleted)* | empty |
| `./vite.config.ts` | `apps/kira-studio/frontend/vite.config.ts` | rewritten (§5.2) |
| `./tsconfig.web.json` | `apps/kira-studio/frontend/tsconfig.json` | |
| `./tsconfig.node.json` | `apps/kira-studio/tsconfig.tests.json` | renamed (F16) |
| `./tsconfig.json` | `./tsconfig.json` + new `apps/kira-studio/tsconfig.json` | root becomes the workspace solution; the app's carries the `paths` Playwright needs |
| `./playwright.config.ts` | `apps/kira-studio/playwright.config.ts` | `testDir` values unchanged |
| `./package.json` | `./package.json` | stays; gains `workspaces`, scripts repointed (F9) |
| — | `apps/kira-studio/frontend/package.json` | **new**; `dev` / `build` / `build:dev` |
| `scripts/**`, `docs/**`, `biome.json`, `bunfig.toml`, `bun.lock`, `.githooks/`, `.github/` | unchanged locations | contents edited where they name a moved path (§5) |

---

## 5. Everything the move breaks — the exhaustive list

Found by grepping the whole tree (excluding `node_modules/`, `.git/`, generated `bindings/`/`dist/`,
and `docs/v1/`, which is history and is never retro-edited). **Nothing may be skipped**; the two
marked ⚠ fail silently.

### 5.1 Config files

| File | What | New value |
|---|---|---|
| ⚠ `biome.json:65` | `"includes": ["src/renderer/views/**"]` | `["apps/kira-studio/frontend/src/views/**"]` — **silent no-op if missed** (F10) |
| ⚠ `biome.json:104` | `"includes": ["src/renderer/project/**"]` | `["apps/kira-studio/frontend/src/project/**"]` — same |
| `biome.json:11` | `"!out"` | delete with `out/` (F17, D14) |
| `tsconfig.json` | `paths` ×3, `references` ×3 | root becomes `{"files": [], "references": [{"path": "./apps/kira-studio"}]}`; `paths` move to the app's own solution file |
| `tsconfig.node.json:12,15-22` | `@shared/*` + six `include` globs | → `apps/kira-studio/tsconfig.tests.json` (§5.3) |
| `tsconfig.web.json:13-20,23` | four `paths`, three `include` | → `apps/kira-studio/frontend/tsconfig.json` (§5.3) |
| `tests/unit/tsconfig.json:13-19,22` | three `../../` `paths`, `include` `../../src/renderer/env.d.ts` | every `../../` → `../../../../`; `env.d.ts` → `../../frontend/src/env.d.ts` |
| `vite.config.ts:11,16,21-28,32` | `root`, three aliases, `outDir` | rewritten (§5.2) |
| `playwright.config.ts:28,35,49` | three `testDir` | unchanged strings; the file moves |
| `package.json` | 13 scripts + new `workspaces` | F9's table |
| `shell/Taskfile.yml:6` | `PACKAGE_MANAGER … default "npm"` | `"bun"` (§5.4) |
| `shell/build/Taskfile.yml` | frontend chain, `generate:bindings` flags | rewritten (§5.4) |
| `shell/build/config.yml:41-46` | `dev_mode.ignore.dir` | keep `frontend`/`bin`/`node_modules`/`.git`; add `.task` |
| `.gitignore` | `out` line; `shell/.gitignore` folding | D14 |

### 5.2 The new `apps/kira-studio/frontend/vite.config.ts`, written out

```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-studio/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory.
export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  // `wails3 dev` exports WAILS_VITE_PORT and then proxies the app's asset server at
  // FRONTEND_DEVSERVER_URL to it; the Taskfile passes the same port on the CLI. Both are set so
  // neither path silently picks a different one.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url)),
      '@bindings': fileURLToPath(
        new URL(
          './bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge',
          import.meta.url,
        ),
      ),
      '@bindings-internal': fileURLToPath(
        new URL(
          './bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal',
          import.meta.url,
        ),
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Generated with `-b`, the bindings import "/wails/runtime.js" — a path Wails' own asset
      // server resolves inside the webview, not an npm package. Keep it literal.
      external: [/^\/wails\//],
    },
  },
});
```

**Two traps, both real:**

1. `__dirname` is gone. If the new `apps/kira-studio/frontend/package.json` declares
   `"type": "module"` (the stock Wails template does; the repo-root `package.json` does not), Vite
   loads this config as ESM and `__dirname` is undefined. `fileURLToPath(new URL(…, import.meta.url))`
   works under both, which is why it is used above — do not port the old `resolve(__dirname, …)`
   lines across.
2. `src/renderer/index.html`'s CSP is `default-src 'self'; script-src 'self'; …` with **no
   `connect-src`**. In dev mode the page is served through the Wails asset server's reverse proxy to
   Vite, so Vite's HMR WebSocket may be a cross-origin `connect-src` the CSP denies. No one has ever
   run `wails3 dev` in this repository to find out (F6/F8). **Check the webview console on the first
   real macOS dev run**; if HMR is blocked, the fix is a dev-only `connect-src` allowance, not
   loosening the shipped CSP — `docs/ARCHITECTURE.md`'s Renderer security surface section is the
   constraint to honour. Recorded as OQ-4.

### 5.3 The tsconfig set, written out

`apps/kira-studio/tsconfig.json` (**new** — the app solution; its `paths` block is what Playwright
and Bun read for every test file under `apps/kira-studio/tests/`, per F11):

```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../../packages/shared/*"],
      "@bindings/*": ["./frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/*"],
      "@bindings-internal/*": ["./frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./frontend" },
    { "path": "./tsconfig.tests.json" },
    { "path": "./tests/unit" }
  ]
}
```

`apps/kira-studio/tsconfig.tests.json` — `tsconfig.node.json` verbatim except:
`"@shared/*": ["../../packages/shared/*"]`, and `include` becomes
`["../../packages/shared/**/*.ts", "playwright.config.ts", "tests/e2e-real/**/*.ts",
"tests/ui/**/*.ts", "../../packages/db-fixtures/support/**/*.ts", "tests/ipc/**/*.ts"]`.

`apps/kira-studio/frontend/tsconfig.json` — `tsconfig.web.json` verbatim except: `@shared/*` →
`["../../../packages/shared/*"]`, both `@bindings*` → `./bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/…`,
`/wails/runtime.js` → `["../../../node_modules/@wailsio/runtime/types/index.d.ts"]`, and `include`
becomes `["src/**/*.ts", "src/**/*.vue", "../../../packages/shared/**/*.ts"]`.

Root `tsconfig.json` — `{"files": [], "references": [{"path": "./apps/kira-studio"}]}`.

### 5.4 The Taskfile changes, written out

**`apps/kira-studio/Taskfile.yml`** — two edits:

```yaml
vars:
  APP_NAME: "Kira Studio"
  BIN_DIR: "bin"
  # This repository has exactly one package manager (docs/ARCHITECTURE.md's Stack table).
  PACKAGE_MANAGER: '{{.PACKAGE_MANAGER | default "bun"}}'
  VITE_PORT: '{{.WAILS_VITE_PORT | default 9245}}'
  # The Bun workspace root: one lockfile, one node_modules, for every app and package.
  WORKSPACE_ROOT: '{{.ROOT_DIR}}/../..'
```

Everything else in that file is unchanged.

**`apps/kira-studio/build/Taskfile.yml`** — replace the whole frontend block. `dir:` in this file
resolves relative to the *including* Taskfile's directory (`apps/kira-studio`), which is why
`generate:icons`' `dir: build` already means `apps/kira-studio/build` (P1 F13 established this).

```yaml
  install:frontend:deps:
    summary: Install workspace dependencies (Bun workspace root — one lockfile for every app)
    run: once
    dir: '{{.WORKSPACE_ROOT}}'
    sources:
      - package.json
      - bun.lock
      - apps/*/frontend/package.json
    generates:
      - node_modules
    preconditions:
      - sh: bun --version
        msg: "bun not found — install it from https://bun.sh"
    cmds:
      - bun install

  build:frontend:
    label: build:frontend (DEV={{.DEV}})
    summary: Build the frontend project
    # darwin:build:universal runs its per-arch builds as parallel deps, each of which depends on
    # this task. Without run:once the two executions race: one regenerates frontend/bindings
    # (-clean deletes it first) while the other's bundler is reading it (#4637).
    run: once
    dir: frontend
    sources:
      - "**/*"
      - exclude: node_modules/**/*
      - exclude: dist/**/*
    generates:
      - dist/**/*
    deps:
      - task: install:frontend:deps
      - task: generate:bindings
        vars:
          BUILD_FLAGS:
            ref: .BUILD_FLAGS
          OBFUSCATED:
            ref: .OBFUSCATED
    cmds:
      - bun run {{if eq .DEV "true"}}build:dev{{else}}build{{end}}
    env:
      PRODUCTION: '{{if eq .DEV "true"}}false{{else}}true{{end}}'

  dev:frontend:
    summary: Runs the frontend dev server (Vite) for `wails3 dev`
    dir: frontend
    deps:
      - task: install:frontend:deps
    cmds:
      - bun run dev --port {{.VITE_PORT}} --strictPort
```

Deleted outright: `install:frontend:deps:{npm,bun,pnpm,yarn}`, `frontend:run`,
`frontend:run:{npm,yarn,pnpm,bun}`, `frontend:dev:{npm,yarn,pnpm,bun}` — twelve tasks collapsed into
the three above. `PACKAGE_MANAGER` survives as a var only because `shell/build/config.yml` and any
external caller may still pass it; nothing dispatches on it any more.

`generate:bindings` — **add `-b` and `-names`** (F7). The `cmds` line becomes:

```yaml
      - wails3 generate bindings -f '{{.BUILD_FLAGS}}' -clean=true{{if eq .OBFUSCATED "true"}} -obfuscated{{end}} -b -names -ts -i
```

Its `sources` exclude glob `frontend/**/*` stays as-is; it is already correct for the new tree, since
the frontend still lives at `frontend/` relative to the app root. (`-names` and `-obfuscated` are
conceptually redundant with each other — obfuscation stabilises numeric ids that `-names` does not
use. This repo never sets `OBFUSCATED`, so leave both and note it; do not silently drop the
obfuscated branch.)

**`apps/kira-studio/build/config.yml`** — `dev_mode.ignore.dir` gains `.task`; nothing else changes.
`root_path: .` and the `frontend` ignore stay correct: Vite owns HMR for everything under
`frontend/`, and the watcher only needs to rebuild the Go binary.

### 5.5 The new `apps/kira-studio/frontend/package.json`, written out

```json
{
  "name": "@kira/kira-studio-frontend",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:dev": "vite build --mode development --minify false"
  }
}
```

No `dependencies` and no `devDependencies`: it is a Bun workspace member, so `vite`, `vue` and the
rest resolve from the workspace root's single `node_modules`. **No `"type": "module"`** — the
repo-root `package.json` has none, and §5.2's config is written to work either way; adding it here
is an independent decision nobody has made. `build:dev` exists because `build:frontend` asks for it
when `DEV=true` (F6 item 3).

### 5.6 Go source

| File | What | New |
|---|---|---|
| every `.go` under the app (500 sites / 279 files) | `github.com/kirathecat/kira-studio/shell/…` | `…/kira-studio/apps/kira-studio/…` |
| `go.mod:1` | `module …/kira-studio/shell` | `module github.com/kirathecat/kira-studio`, moved to the repo root with `go.sum` |
| `internal/adapters/testsupport/postgres.go:49-52` | `repoRoot()` walks **four** levels up from `runtime.Caller(0)`'s dir | **five** (`apps/kira-studio/internal/adapters/testsupport` → root) |
| `internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go` | five `filepath.Join(repoRoot(), "tests", "db", "fixtures", …)` | `…, "packages", "db-fixtures", "fixtures", …` |
| `internal/ipcfixture/fixture_assert_test.go:85` | `repoRootForWrite` joins `wd` with **three** `..` | **four** |
| `internal/ipcfixture/write.go:52` | `filepath.Join(repoRoot, "tests", "ipc", …)` | `…, "apps", "kira-studio", "tests", "ipc", …` |
| `main.go:42-43` | comment naming `src/renderer` | `apps/kira-studio/frontend/src` |
| `internal/{page/chunk.go, shell/accel.go, oplog/wire.go, adapterhost/dataframe.go, secrets/status.go, storage/model/*.go, metrics/sampler.go, ipcfixture/channels.go, bridge/*.go, adapters/*}` | ~25 comments citing `src/shared/…` or `src/renderer/…` as their source of truth | `packages/shared/…`, `apps/kira-studio/frontend/src/…` |
| `internal/adapters/testsupport/*.go`, `internal/adapters/*/\*_test.go` | ~25 comments citing `tests/db/…` | `packages/db-fixtures/…` |

`main.go`'s two `//go:embed` directives (`all:frontend/dist`, `blank/index.html`) are **unchanged** —
both targets move with the package.

### 5.7 Test sources

| File | What |
|---|---|
| `tests/ui/support/server.ts:8` | `resolve(__dirname, '../../../shell/frontend/dist')` → `'../../../frontend/dist'` |
| `tests/ui/support/mockRuntime.ts:29` | `cwd: resolve(__dirname, '../../../shell')` → `'../../..'` (the app dir) |
| `tests/ui/support/mockRuntime.ts:33` | `BRIDGE_PKG = 'github.com/kirathecat/kira-studio/shell/internal/bridge'` → `…/apps/kira-studio/internal/bridge` |
| `tests/e2e-real/fixtures.ts:14-16` | `ROOT_DIR = resolve(__dirname, '../..')` → `'../../../..'`; `SHELL_DIR` → the app dir (rename it) |
| `tests/e2e-real/fixtures.ts:61,65` | `execFileSync('sh', ['scripts/wails-dev-setup.sh'], {cwd: ROOT_DIR})` and `bun run build` — both still correct once `ROOT_DIR` is right |
| `tests/e2e-real/fixtures.ts:20` | `.e2e-real-build.lock` at `ROOT_DIR` — still correct |
| `tests/e2e-real/support/{postgres,mariadb,kafka,sqlite}.ts` | four `from '../../db/support/…'` → `'../../../../packages/db-fixtures/support/…'` |
| `tests/unit/*.spec.ts` (16 of 17 files) | `../../src/renderer/…` → `../../frontend/src/…` |
| `tests/ui/global.d.ts`, `tests/ipc/support/types.ts`, `tests/ui/support/{ipcChannels,bootSnapshots,measure,mongoFixture,redisFixture,postgresFixture,mariadbFixture,cellEditorCaptures}.ts`, `tests/ui/{perf,leaks,data-view,tree,interaction,autocomplete,budgets}.spec.ts` | comments naming `src/renderer/…`, `src/shared/…`, `tests/db/…` — prose only, but they are the map the next session reads |
| `packages/db-fixtures/support/{postgres,sqlite,mariadb}.ts` | `resolve(__dirname, '../fixtures/…')` — **unchanged**, because `fixtures/` and `support/` move together |

### 5.8 Scripts, CI and documentation

| File | What |
|---|---|
| `scripts/wails-dev-setup.sh:21,62,64` | F13 |
| ⚠ `scripts/verify-packaging.sh:36` | `grep -rnE … src/` → `apps/ packages/` — **passes forever if missed** (F14) |
| `scripts/verify-packaging.sh:47` | `APP="shell/bin/Kira Studio.app"` → `apps/kira-studio/bin/…` |
| `scripts/sign-bundle.sh:13,16` | F15 |
| `scripts/demo-dbs/{README.md,docker-compose.yml,kafka/seed.sh,s3/seed.sh,sqs/seed.sh,mysql/init.sql,clickhouse/init.sql}` | `tests/db/…` prose → `packages/db-fixtures/…` |
| `docs/v1/plans/p58-pending-ci-workflows/ci.yml` | `go-version-file: shell/go.mod` (×4 jobs) → `go.mod`; `(cd shell && wails3 generate bindings …)` (×2) → `(cd apps/kira-studio && …)`; `APP="shell/bin/Kira Studio.app"` → `apps/kira-studio/bin/…` |
| `docs/v1/plans/p58-pending-ci-workflows/release.yml` | same `shell/`-rooted references |
| `docs/v1/plans/p58-pending-ci-workflows/README.md` | record that P3 revised both in place, per that directory's own standing instruction |
| `.github/workflows/{ci,release}.yml` | **not touched** (D15). They are two generations stale already (P1 F10) and reference `bun run test:e2e`, `test:db`, `package:mac`, `app.asar.unpacked/`, `dist/mac-arm64/` — none of which exist. The move adds nothing to that backlog |
| `README.md` | Install/Development/Tests/Architecture + the top-level layout block (`:209-224`) — rewritten against §3 |
| `AGENTS.md` | every `shell/`, `src/renderer`, `src/shared`, `tests/db`, `tests/ipc` path in the Docker, `tests/ipc/`, ClickHouse, SQLite, secrets and Wails sections; and the "Known open items" entries P3 closes (see D16) |
| `docs/ARCHITECTURE.md` | Stack table rows (renderer build, DB tests), Testing section, the `src/shared` mirror references |
| `docs/PACKAGING.md` | ~25 `shell/…` and `scripts/…` references (`:8-12,17-43,66-95,130-134,149,221,254,274`) |
| `docs/PERF.md` | `shell/blank`, `shell/cmd/g1measure` references in §2.3 |
| `shell/README.md` → `apps/kira-studio/README.md` | rewritten: `bun run build` builds `apps/kira-studio/frontend`, bindings come from `wails3 task common:generate:bindings` |
| `NOTICES.md:39-63` | five `src/renderer/assets/fonts/…` and `src/renderer/theme/…` paths — **licence-attribution paths**, so getting these right is not cosmetic |
| `docs/v1/**` | **not touched.** History, never retro-edited (`docs/v1.1/README.md`) |

---

## 6. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **Adopt `apps/` + `packages/` with the workspace manifest at the repo root.** `apps/kira-studio/` is the Wails app in the stock scaffold shape (F1); `packages/` is cross-app shared source. | F2/F3: the current root is simultaneously workspace root, frontend project root and test-runner root, and a second app has no non-colliding answer for any of the three. `apps/*/frontend` is *both* the workspace-member glob and the Wails scaffold slot, so no tradeoff is needed. |
| **D2** | **One Go module at the repo root**, `module github.com/kirathecat/kira-studio`; app packages under `apps/kira-studio/`; shared Go reserved at root `internal/`. Rewrite all 500 import sites. | F3/F4: root `internal/` gives cross-app-shared/outside-invisible with no `go.work`, no `replace`, one dependency set. The 500-site rewrite is one `sed` proved by `go build ./...`; the four config strings that embed the module path are already behind the `@bindings` alias (13 import sites). Keeping the old module path on a directory that no longer exists is the stale naming this phase removes. `go.work` remains a one-file upgrade. |
| **D3** | **Create no empty directories.** Root `internal/` and further `packages/*` are named in §3 as reserved locations and created when something first moves there. | Nothing is shared between backends *yet*; splitting `internal/` on speculation is exactly the over-engineering §0.3 excludes. Naming the convention costs nothing and prevents the next session inventing a different one. |
| **D4** | **All four test suites move to `apps/kira-studio/tests/`**, with `playwright.config.ts` and `tsconfig.tests.json` alongside them. | F5: every one of the four is bound to this app by path, binary or fixture generator — none would survive a second app without re-scoping. The marginal cost is near zero: their `../../src/renderer/…` and `../../../shell/…` paths must change anyway because both trees move. **The counter-argument, recorded**: root `tests/` reads fine with one app, and this makes `bun run test:ui` a `cd`. C4 is a standalone commit so it can be dropped without unpicking anything else if the implementer disagrees — but then say so, rather than skipping it silently. |
| **D5** | **`tests/db/` → `packages/db-fixtures/`**, `fixtures/` and `support/` moving together, with no `package.json`. | F12: it holds no specs, needs a standing disclaimer in three separate documents, and its two consumer sets end up in different top-level trees on opposite sides of the language boundary. No `package.json` because `tests/e2e-real/support/*.ts` must keep importing it by relative path (F11's Playwright constraint). |
| **D6** | **`scripts/` stays at the repo root**, including the three app-specific `.sh` files. | F15: all three are invoked from the root `package.json`'s `scripts`, which is where the workspace's entry points live and where CI calls them. Moving them under the app buys ownership clarity and costs edits in `package.json`, `README.md`, `AGENTS.md`, `docs/PACKAGING.md`, `tests/e2e-real/fixtures.ts` and both staged workflows. Revisit when a second app needs its own — recorded, not silently skipped. |
| **D7** | **`@shared/*` stays a tsconfig `paths` alias**, retargeted at `packages/shared/*`. 187 import sites are untouched. | F11: Vite, Bun and **Playwright** all resolve it from `paths` today; Playwright does not transform files under `node_modules`, so a workspace package exporting raw `.ts` would resolve and then fail to parse in `tests/ui`'s 31 import sites. OQ-2 holds the package-name migration, with the instruction to verify that claim before acting on it. |
| **D8** | **`PACKAGE_MANAGER` defaults to `bun`, and the npm/pnpm/yarn task variants are deleted** — twelve tasks collapse into `install:frontend:deps`, `build:frontend`, `dev:frontend`. | F6/F17: the npm default does not degrade to a no-op, it npm-installs the *workspace root* and prunes 331 bun-installed packages. Changing only the default leaves the destructive path one env var away; deleting the variants turns it into a "task not found". This is the SPEC row's "standardize on bun" made structural rather than declarative. |
| **D9** | **`install:frontend:deps` runs `bun install` at the workspace root** (`dir: {{.WORKSPACE_ROOT}}`), not in the app's `frontend/`. | One lockfile and one `node_modules` for the whole monorepo is the point of declaring `workspaces` at all; a `bun install` inside a workspace member resolves to the root anyway, and pointing the task there makes its `sources` (`package.json`, `bun.lock`, `apps/*/frontend/package.json`) name real files instead of the three that never existed under `shell/frontend/`. |
| **D10** | **`apps/kira-studio/frontend/` gets a real `package.json` with `dev`, `build` and `build:dev`.** | F6: this is what makes `bun run dev` *fixable* rather than patchable. It also resolves the collision the current shape cannot — the workspace root's `dev`/`build` and the Wails frontend's `dev`/`build` mean different things and cannot be the same file (pointing `dir:` at the root instead recurses infinitely through the root `dev` script). And it restores the stock scaffold contract, so the Taskfile no longer needs local knowledge of this repository. |
| **D11** | **`generate:bindings` gains `-b` and `-names`, and `scripts/wails-dev-setup.sh` delegates to that task** rather than carrying its own flag list. | F7: the build path currently regenerates bindings in the flavour `vite.config.ts:38`, `tsconfig.web.json:20` and `tests/ui/support/mockRuntime.ts:36` are all written against the opposite of, and since `frontend/bindings/` is gitignored, nothing would show the swap. One definition removes the divergence class; F13 names the fallback and requires the implementer to say which was taken. |
| **D12** | **Root `dev` becomes `cd apps/kira-studio && wails3 task dev`** — the `bun run build` prefix is dropped. | F9: with `build:frontend` working, the Taskfile owns the frontend build. Two builds racing on the same `dist` is what let the Taskfile's own copy rot unobserved for two chapters. The `//go:embed` directory-must-exist requirement is satisfied by `build:native`'s `common:build:frontend` dep. |
| **D13** | **`tsconfig.node.json` → `apps/kira-studio/tsconfig.tests.json`; `tsconfig.web.json` → `apps/kira-studio/frontend/tsconfig.json`; `typecheck:node` → `typecheck:tests`.** | F16, and P1's OQ-2 hands exactly this forward. `node` has not described that project since Electron left — its `include` is every test tier plus the shared contract. `src/renderer`'s own rename in the same OQ resolves for free: the directory ceases to exist. |
| **D14** | **Delete `out/` on disk, `.gitignore`'s stock Next.js `out` line, and `biome.json`'s `"!out"`. Fold `shell/.gitignore` into `apps/kira-studio/.gitignore` and drop its `runtime` line. Change nothing else in `.gitignore`.** | F17: `out/` holds pre-cutover residue including copies of three fixtures that no longer exist anywhere in the repository, and nothing writes it; keeping the ignore line would silently swallow a future `apps/<x>/out`. The `runtime` line survives a subsystem P58f deleted. P1 F16's reasoning for declining the *wider* boilerplate sweep (glob-semantics risk around `!dist`/`dist` vs `frontend/dist`) still holds and is declined again. |
| **D15** | **`.github/workflows/*.yml` are not touched; the staged copies under `docs/v1/plans/p58-pending-ci-workflows/` are updated to the new paths.** | P1 F10/D10: this session's push token lacks the `workflow` OAuth scope and GitHub rejects any commit touching those files outright. The staged files are ordinary `docs/` content and are the mechanism by which the fix eventually lands; leaving them naming `shell/go.mod` and `cd shell` would ship a broken workflow whenever someone finally applies them. |
| **D16** | **Close both of `AGENTS.md`'s "Known open items" that this phase resolves, and P1's OQ-2/OQ-6 with them.** | The `shell/build/Taskfile.yml` item is answered by F6 with a measurement and fixed by D8-D10; P1's OQ-2 (Electron-era names) is answered by the move itself. The CI-workflow item stays open — D15 does not change its blocker. `AGENTS.md`'s own rule is to delete a resolved item rather than mark it done in place. |

---

## 7. Implementation order

Eight commits. Every one is independently green under §8's block — run it after each, not once at
the end. The order is not cosmetic: **each step's outputs are the next step's inputs.**

- **C1 before everything**: the Go module path determines the generated-bindings directory, which is
  the target of alias strings that C2, C4 and C5 all edit. Doing it later means editing them twice.
- **C2 before C4**: `tests/unit`'s 16 relative imports point at `src/renderer`; moving the tests
  first would point them at a path that is itself about to move.
- **C6 after C1-C5**: the Taskfile and scripts are rewritten once, against final paths.
- **C8 last**: documentation describes the finished tree, not an intermediate one.

### C1 — `refactor(repo)!: move the Wails app to apps/kira-studio and root the Go module`

Atomic; cannot be split without leaving the tree uncompilable.

```sh
mkdir -p apps && git mv shell apps/kira-studio
git mv apps/kira-studio/go.mod go.mod && git mv apps/kira-studio/go.sum go.sum
```

1. `go.mod:1` → `module github.com/kirathecat/kira-studio`.
2. Rewrite every import: `github.com/kirathecat/kira-studio/shell/` →
   `github.com/kirathecat/kira-studio/apps/kira-studio/` across `apps/kira-studio/**/*.go` (500 sites,
   279 files).
3. `apps/kira-studio/internal/adapters/testsupport/postgres.go:52` — add one `".."` (four → five).
4. `apps/kira-studio/internal/ipcfixture/fixture_assert_test.go:85` — add one `".."` (three → four).
5. `apps/kira-studio/.gitignore` — delete the `runtime` line. Everything else in it stays correct
   relative to its own directory.
6. Repoint the module path inside `vite.config.ts:23,27`, `tsconfig.json:6,9`,
   `tsconfig.web.json:15,18`, `tests/unit/tsconfig.json:15,18`,
   `tests/ui/support/mockRuntime.ts:29,33`, `tests/e2e-real/fixtures.ts:15`,
   `tests/ui/support/server.ts:8`, and `package.json`'s `dev`/`package`/`test:go` scripts.
7. `scripts/{wails-dev-setup.sh,sign-bundle.sh,verify-packaging.sh}` — the `shell/` paths (F13-F15),
   **including S2's `src/` grep, which does not break yet but is repointed in C2**.

Verify: `go build ./...` (needs the GTK4/WebKitGTK headers `AGENTS.md` names, because the root
package imports Wails; use `go build ./apps/kira-studio/internal/... ./apps/kira-studio/cmd/...` for
the fast loop) → `go vet` → `go test ./apps/kira-studio/internal/storage/... ./apps/kira-studio/internal/adapterhost/...`
→ then §8's block. **`git mv` before editing** so the rename is recorded as a rename.

### C2 — `refactor(frontend)!: move src/renderer into the Wails frontend slot`

```sh
mkdir -p apps/kira-studio/frontend/src
git mv src/renderer/index.html apps/kira-studio/frontend/index.html
git mv src/renderer/* apps/kira-studio/frontend/src/
git mv vite.config.ts apps/kira-studio/frontend/vite.config.ts
git mv tsconfig.web.json apps/kira-studio/frontend/tsconfig.json
```

1. `index.html`: `<script type="module" src="./main.ts">` → `src="/src/main.ts"`.
2. Rewrite `vite.config.ts` per §5.2 (drop `root`, drop `__dirname`, add `server`).
3. Rewrite `frontend/tsconfig.json` per §5.3.
4. Create `apps/kira-studio/frontend/package.json` per §5.5.
5. `package.json`: add `"workspaces": ["apps/*/frontend"]`; `build` → `cd apps/kira-studio/frontend && bun run build`; `typecheck:web` → the new project path.
6. ⚠ `biome.json:65,104` — the two override `includes` globs (F10).
7. `scripts/verify-packaging.sh:36` — S2's `src/` → `apps/ packages/` (F14).
8. `tests/unit/*.spec.ts` — 16 files, `../../src/renderer/` → `../../apps/kira-studio/frontend/src/`
   (they are still at `tests/unit/` until C4).
9. `tests/unit/tsconfig.json` — `env.d.ts` include and the `@bindings*` paths.
10. `NOTICES.md:39-63` — the font and theme paths.
11. `bun install` (registers the new workspace member).

Verify: §8's block, **plus the positive Biome-guard check** (§8.3). `bun run build` must write
`apps/kira-studio/frontend/dist`, and `git status --porcelain` must not list it.

### C3 — `refactor!: src/shared becomes packages/shared`

```sh
mkdir -p packages && git mv src/shared packages/shared && rmdir src
```

1. Retarget `@shared` in `apps/kira-studio/frontend/vite.config.ts`, `tsconfig.json`,
   `tsconfig.node.json`, `tests/unit/tsconfig.json`. **No import specifier changes** (D7).
2. `tsconfig.node.json`'s `include` — `src/shared/**/*.ts` → `packages/shared/**/*.ts`.
3. The ~25 Go comments citing `src/shared/…` as their mirror source (§5.6).
4. `scripts/demo-dbs/README.md`'s `src/shared` reference.

Verify: §8's block. `grep -rn 'src/shared\|src/renderer' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs .`
returns nothing outside `docs/`.

### C4 — `refactor(tests)!: move the four suites under apps/kira-studio`

```sh
git mv tests apps/kira-studio/tests
git mv apps/kira-studio/tests/db packages/db-fixtures   # deferred to C5; see below
git mv playwright.config.ts apps/kira-studio/playwright.config.ts
git mv tsconfig.node.json apps/kira-studio/tsconfig.tests.json
```

(Keep `tests/db` in place through this commit — C5 moves it. Move only
`tests/{unit,ui,ipc,e2e-real}` here, leaving `tests/db` at the root until C5, or do both in C4 and
fold C5 into it; either is fine as long as each commit is green on its own.)

1. Create `apps/kira-studio/tsconfig.json` per §5.3; reduce the root `tsconfig.json` to
   `{"files": [], "references": [{"path": "./apps/kira-studio"}]}`.
2. `apps/kira-studio/tsconfig.tests.json` — the `include` globs and `@shared/*` (§5.3).
3. `apps/kira-studio/tests/unit/tsconfig.json` — every `../../` → `../../../../`.
4. `tests/unit/*.spec.ts` — `../../apps/kira-studio/frontend/src/` → `../../frontend/src/`.
5. `tests/ui/support/server.ts:8`, `tests/ui/support/mockRuntime.ts:29`,
   `tests/e2e-real/fixtures.ts:14-16` — the depth changes (§5.7).
6. `apps/kira-studio/internal/ipcfixture/write.go:52` — `"tests", "ipc"` →
   `"apps", "kira-studio", "tests", "ipc"`.
7. `package.json` — `test:ui`, `test:ipc:fe`, `test:unit`, `typecheck:tests`, `typecheck:unit`.

Verify: §8's block, plus `bun run test:unit`, `bun run test:ui`, `bun run test:ipc:fe`, and
`cd apps/kira-studio && go test ./internal/ipcfixture/...` (read mode — it must find and match the
committed fixtures at their new path).

### C5 — `refactor(tests)!: tests/db becomes packages/db-fixtures`

```sh
git mv tests/db packages/db-fixtures
```

1. Five Go `seedPath` literals in
   `apps/kira-studio/internal/adapters/testsupport/{postgres,mariadb,mysql,sqlite,clickhouse}.go`.
2. Four re-export specifiers in `apps/kira-studio/tests/e2e-real/support/{postgres,mariadb,kafka,sqlite}.ts`.
3. `apps/kira-studio/tsconfig.tests.json`'s `tests/db/support/**/*.ts` include.
4. The ~25 Go comments and the `scripts/demo-dbs/` prose citing `tests/db/…`.

Verify: §8's block, plus at least one container-backed Go adapter test that reads a seed file
(`cd apps/kira-studio && go test ./internal/adapters/sqlite/...` needs no Docker and reads
`0009_sqlite_seed.sql`, so it is the cheapest proof the path is right).

### C6 — `fix(build): make bun run dev work and standardize every install on bun`

The whole of §5.4 and §5.5's consumers:

1. `apps/kira-studio/Taskfile.yml` — `PACKAGE_MANAGER` default `bun`, add `WORKSPACE_ROOT`.
2. `apps/kira-studio/build/Taskfile.yml` — delete the twelve per-package-manager tasks; write
   `install:frontend:deps`, `build:frontend`, `dev:frontend` as in §5.4; add `-b -names` to
   `generate:bindings`; add `exclude: dist/**/*` to `build:frontend`'s sources.
3. `apps/kira-studio/build/config.yml` — add `.task` to `dev_mode.ignore.dir`.
4. `scripts/wails-dev-setup.sh` — delegate binding generation to
   `wails3 task common:generate:bindings`, or sync the flags (F13; say which, in the commit message).
5. `package.json` — `dev` drops its `bun run build` prefix (D12).

Verify: `cd apps/kira-studio && wails3 task --list-all` exits 0 and lists exactly
`common:{install:frontend:deps,build:frontend,dev:frontend,generate:bindings,generate:icons,go:mod:tidy,update:build-assets}`
with **no** `:npm`/`:pnpm`/`:yarn` entries; `wails3 task --dry common:build:frontend` shows
`bun install` and `bun run build` (never `npm`); `wails3 task --dry common:dev:frontend` shows
`bun run dev --port 9245 --strictPort`. Then §8.2's live checks. **Do not use `wails3 task --status`
as a dry run — it executes `deps` for real** (F6, and §0.1's side-effect note is what that cost).

### C7 — `chore: drop the dead out/ ignore rules and the runtime leftover`

`.gitignore`'s `# Next.js build output` `out` line, `biome.json:11`'s `"!out"`, and (already done in
C1) `apps/kira-studio/.gitignore`'s `runtime`. On disk, not committed: `rm -rf out shell/runtime`
(if a `shell/` residue survives the `git mv`), `playwright-report test-results`, any stray
`package-lock.json`, any `apps/kira-studio/frontend/.bindings-tmp-*`.

Verify: §8's block; `git status --porcelain` clean; `bun run lint` still reports the same file count
modulo the moves.

### C8 — `docs: the apps/ + packages/ layout, and the fixed dev loop`

Everything in §5.8's documentation rows: `README.md` (Install / Development / Tests / Architecture /
the layout block), `AGENTS.md` (every moved path, plus D16's two closed open items),
`docs/ARCHITECTURE.md` (Stack table, Testing section, `packages/shared` mirror references),
`docs/PACKAGING.md`, `docs/PERF.md`, `apps/kira-studio/README.md`,
`scripts/demo-dbs/README.md`, and the three files under
`docs/v1/plans/p58-pending-ci-workflows/`. `docs/v1/**` is otherwise untouched.

Verify: `bun run lint` (Biome formats Markdown), plus §9's mechanical acceptance greps.

---

## 8. Verification

### 8.1 After every commit

```sh
bun run lint
bun run typecheck
bun run build
go build ./apps/kira-studio/internal/... ./apps/kira-studio/cmd/... && go vet ./apps/kira-studio/internal/... ./apps/kira-studio/cmd/...
git status --porcelain          # must be empty — no generated dir leaked past .gitignore
```

`go build ./...` additionally compiles the root `main` package, which imports Wails and needs
GTK4/WebKitGTK headers on Linux (`AGENTS.md`'s Wails section has the `apt-get` line). Use the
narrow form for the loop and run `./...` once at the end if the headers are present.

**Baseline to regress against**, measured at `f9511d2`: `bun run lint` → "Checked 304 files";
`bun run typecheck` → three projects, all exit 0; `go build`/`go vet` → exit 0;
`git status --porcelain` → empty. The file count will change with the moves; the *result* must not.

### 8.2 Once, at the end of the phase

```sh
bun install                                   # §0.1 — node_modules is currently an npm install
bun run test:unit
bun run test:ui                               # needs `bunx playwright install webkit` + its system libs
bun run test:ipc:fe
go test ./...                                 # container-backed cases self-skip without Docker
cd apps/kira-studio && wails3 task --list-all
cd apps/kira-studio && wails3 task --dry common:build:frontend   # bun, never npm
cd apps/kira-studio && wails3 task common:dev:frontend           # must serve Vite on 9245; ^C
```

The last one is the only *live* proof of the dev fix obtainable off macOS (F8) — it exercises
`install:frontend:deps` → `dev:frontend` → `bun run dev --port 9245 --strictPort` with no darwin
dispatch in its path. Confirm `curl -sf http://127.0.0.1:9245/` returns the app's `index.html`.

**Not runnable without macOS, and not to be reported as passed**: `bun run dev` end to end,
`bun run package`, `verify:packaging`'s artifact checks (A1/A3/N2). Same constraint
`docs/PACKAGING.md` §6 records for every earlier phase.

### 8.3 The two silent-failure guards, checked positively

Neither of these fails loudly if the migration misses them, so "the suite passed" is not evidence.

**Biome's architectural guards (F10).** Temporarily add `import '../grid/page';` to a file under
`apps/kira-studio/frontend/src/views/documents/` and confirm `bun run lint` **fails** with
*"SPEC §11: views/<kind>/* must not import another views/<kind>/*"*. Then add
`import '../../views/grid/page';` to a file under `frontend/src/project/` and confirm it fails with
the `project/` message. Revert both.

**verify-packaging's S2 (F14).** Temporarily add a line containing `autoUpdater` to a file under
`apps/kira-studio/frontend/src/` and confirm `bun run verify:packaging` **fails** with
*"updater code present"*. Revert.

### 8.4 Bindings flavour (F7/D11)

After the first `wails3 task common:generate:bindings` under the new Taskfile:

```sh
grep -rl '"/wails/runtime.js"' apps/kira-studio/frontend/bindings/**/bridge/*.ts | wc -l   # every service module
grep -rc '@wailsio/runtime'    apps/kira-studio/frontend/bindings/**/bridge/*.ts           # must be 0
grep -rho '\$Call\.ByName("[^"]*"' apps/kira-studio/frontend/bindings/**/bridge/*.ts | wc -l  # > 0
grep -rc 'Call\.ByID'          apps/kira-studio/frontend/bindings/**/bridge/*.ts           # must be 0
```

Then `bun run test:ui`, whose `mockRuntime.ts` derives `CHANNEL_TO_FQN` from exactly those strings.

---

## 9. Acceptance checklist

P3 is done when every line below is true, each checked against the tree rather than against this
document:

1. `ls` at the repo root shows `apps/ packages/ scripts/ docs/` and **no** `src/`, `shell/`,
   `tests/`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.node.json` or `tsconfig.web.json`.
2. `go.mod:1` is `module github.com/kirathecat/kira-studio`;
   `grep -rn 'kira-studio/shell' --include='*.go' --include='*.ts' --include='*.json' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs`
   returns nothing.
3. `apps/kira-studio/frontend/package.json` exists with `dev`, `build` and `build:dev`;
   `package.json` declares `"workspaces": ["apps/*/frontend"]`; there is exactly one `bun.lock` and
   one `node_modules` in the tree, both at the root.
4. `grep -n 'npm\|pnpm\|yarn' apps/kira-studio/build/Taskfile.yml` returns nothing;
   `grep -n 'PACKAGE_MANAGER' apps/kira-studio/Taskfile.yml` shows `default "bun"`;
   `cd apps/kira-studio && wails3 task --dry common:build:frontend` names `bun` and never `npm`.
5. `grep -n 'generate bindings' apps/kira-studio/build/Taskfile.yml scripts/wails-dev-setup.sh`
   shows **one** flag list, containing `-b`, `-names`, `-ts`, `-i` — or the script delegating to the
   task (F13), with the commit message saying which was taken and why.
6. `biome.json`'s two `noRestrictedImports` overrides name
   `apps/kira-studio/frontend/src/{views,project}/**`, and §8.3's positive check has actually been
   run for both, not assumed.
7. `scripts/verify-packaging.sh` greps `apps/ packages/` (not `src/`), and §8.3's S2 check has
   actually been run.
8. `packages/db-fixtures/{fixtures,support}` exist; no `tests/db` anywhere;
   `cd apps/kira-studio && go test ./internal/adapters/sqlite/...` passes (it reads
   `0009_sqlite_seed.sql` by path).
9. `KIRA_IPC_FIXTURES` read mode is green — `cd apps/kira-studio && go test ./internal/ipcfixture/...`
   finds the committed fixtures at `apps/kira-studio/tests/ipc/<adapter>/`.
10. Every `bun run <script>` named anywhere in `README.md`, `apps/kira-studio/README.md`,
    `scripts/**`, `AGENTS.md`, `docs/ARCHITECTURE.md` or `docs/PACKAGING.md` exists in
    `package.json`'s `scripts`. Checked mechanically:
    ```sh
    comm -23 \
      <(grep -rho 'bun run [a-z:0-9-]*' README.md apps/kira-studio/README.md scripts/ AGENTS.md docs/ARCHITECTURE.md docs/PACKAGING.md | sed 's/bun run //' | sort -u) \
      <(node -p "Object.keys(require('./package.json').scripts).join('\n')" | sort -u)
    ```
    must print nothing.
11. `grep -rn 'src/renderer\|src/shared\|tests/db\|shell/' README.md AGENTS.md NOTICES.md docs/ARCHITECTURE.md docs/PACKAGING.md docs/PERF.md scripts/ apps/ packages/ --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=bindings`
    returns nothing. (`docs/v1/` is excluded by policy and still matches; that is expected.)
12. §8.1 is green after every commit; §8.2 has either been run or has a **stated** reason it could
    not be (no macOS, no Docker, no WebKit). `bun run dev` end to end is macOS-only (F8) — say that,
    do not report it as passed.
13. `AGENTS.md`'s "Known open items" no longer contains the `shell/build/Taskfile.yml` entry, and
    carries a P3 findings section with, at minimum: what `npm install` in a `package.json`-less
    directory actually does (F6), the `-b`/`-names` divergence and why both flags are load-bearing
    (F7), the two silent-failure surfaces and their positive checks (F10/F14, §8.3), and the
    Playwright-does-not-transform-`node_modules` constraint that keeps `@shared/*` an alias (F11).
14. `git status --porcelain` is clean and the diff contains **no** `.github/workflows/` file.

---

## 10. Open questions, handed forward

**OQ-1 — a second Wails app has not been designed, only made possible.** §3 reserves
`apps/<name>/`, root `internal/` and `packages/<name>/` and creates none of them (D3). The first
real second app will settle three things this phase deliberately does not: whether the adapters
belong in root `internal/adapters` rather than the app's; whether each app gets its own
`playwright.config.ts` or one config grows projects; and whether `scripts/`'s three app-specific
`.sh` files move under their app (D6). **Owner: whoever adds the second app.**

**OQ-2 — `@shared/*` alias vs a real `@kira/shared` workspace package.** D7 keeps the alias on the
Playwright grounds in F11. If that constraint is ever removed (Playwright gaining a
transform-node_modules option, or `packages/shared` shipping compiled output), the package-name
migration is a mechanical rewrite of 187 specifiers that would delete an alias from four config
files instead of adding one. **Verify the Playwright claim empirically before acting on it** — this
plan reasons about it from Playwright's documented transform boundary, not from an experiment.
**Owner: a later structural pass.**

**OQ-3 — `apps/kira-studio/blank/index.html` calls `Call.ByID(3273072800)`.** P1's OQ-3 flagged the
hand-copied method id as unverified; F7 adds the reason it is now actively suspect — the bindings
this repository generates use `$Call.ByName`, and the id was copied from a generation that predates
`-names`. Whether the runtime still resolves `ByID` for a `-names` build was **not** determined here
(it needs a running Wails build). **Owner: P5 (RAM usage) or P7 (CPU/memory readout)**, both of which
will actually run this configuration.

**OQ-4 — the renderer CSP may block Vite's HMR socket in dev.** §5.2 trap 2. `index.html`'s
`default-src 'self'; script-src 'self'` has no `connect-src`, and nobody has ever completed a
`wails3 dev` run in this repository to find out (F6/F8). If HMR is blocked, the fix is a dev-only
allowance, never a loosening of the shipped policy. **Owner: the first session with macOS.**

**OQ-5 — `bun run package` remains unverified on real hardware.** `docs/PACKAGING.md` §6 has
recorded this since P52 and P1's OQ-6 pointed at the same gap from the Taskfile side. F6 closes the
*dev* half of that question with a measurement; the *packaging* half — does
`darwin:package` → `build:native` → `build:frontend` now produce a correct bundle — still needs a
real macOS run. **Owner: whoever next has hardware.**

**OQ-6 — the pending CI workflows are still pending, now one generation staler.** D15. The live
`.github/workflows/*.yml` already reference `bun run test:e2e`, `bun run test:db`,
`bun run package:mac` and `app.asar.unpacked/`, none of which exist (P1 F10); after P3 they also
reference a directory layout that is gone. `docs/v1/plans/p58-pending-ci-workflows/README.md` carries
the copy-and-apply steps and its files are updated by C8. **Owner: whoever next has a token with the
`workflow` OAuth scope.**
