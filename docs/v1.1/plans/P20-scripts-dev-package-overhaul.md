# P20 — Scripts and dev/package workflow overhaul, second pass

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md:35`, P20 row): *"A full audit and cleanup
> of every dev/build/install/package script in the repo — `scripts/*`, every Taskfile
> (`apps/kira-studio/build/*/Taskfile.yml` and any others), and `package.json`'s `scripts` block —
> fixing whatever's currently broken and removing whatever's been duplicated since P3's own pass.
> User-reported symptoms to chase down: `bun run dev` doesn't work, packaging doesn't work, and
> something isn't being regenerated correctly on the way there … Also collapse duplicated logic the
> scripts have picked up along the way — user-reported: git config gets invoked roughly three times
> across what should be one script — into a single shared implementation."*
>
> **The user's own words, which this phase is answering:** *"The scripts need a cleanup again. I
> can't nor dev not package the app. Smth isn't regenerated properly. Git config appears like 3
> times for just one script. Everything is all over the place. It all needs an overhaul."*
>
> ---
>
> **"Git config appears like 3 times for just one script" is exactly, literally right — and the
> cause is not a duplicated `git config`.** There is precisely **one** `git config` in the whole
> repository (`package.json:12`, the `prepare` lifecycle script). It is *echoed and executed three
> times per `bun run dev`* because **`bun install` runs three times per `bun run dev`** (F2). And
> `bun install` runs three times because of a **single line** —
> `apps/kira-studio/build/Taskfile.yml:21-22`'s `generates: - node_modules`. A bare directory in
> Task's `generates:` makes a task *permanently* not-up-to-date; the identical task with
> `node_modules/**/*`, or with no `generates:` at all, caches correctly. Isolated in a controlled
> Taskfile this session (F3). The user was reading a real symptom of a real bug off their terminal.
>
> **"Something isn't regenerated properly" is the Wails bindings, and there are three independent
> reasons why, all provable.** (a) `common:generate:bindings`'s fingerprint lists `go.mod` and
> `go.sum` — but P3 moved the Go module to the repo root, and Task resolves `sources:` against the
> *including* Taskfile's directory (`apps/kira-studio/`), where neither file has existed since. A
> dependency-only bump therefore never invalidates the task, and **P19's `chore(wails): move to
> v3.0.0-beta.16` (`544127d`) touched exactly `go.mod`, `go.sum`, `package.json`, `bun.lock` and
> nothing else** (F4). (b) `scripts/wails-dev-setup.sh:62` gates regeneration on
> `[ ! -d frontend/bindings ]` — directory presence, never version (F5). (c) The bindings on this
> branch **were in fact stale**: a fresh pinned regeneration this session changed
> `bindings/encoding/json/models.ts` from `RawMessage = any` to `RawMessage = jsontext$0.Value` and
> added a whole missing `bindings/encoding/json/jsontext/` package (F6).
>
> **And there is a fourth, entirely unrecorded regeneration bug that P19 created:**
> `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.16` prints *"requires go >= 1.25.0;
> switching to go1.26.8"* and builds the CLI with **Go 1.26**, because `GOTOOLCHAIN=auto` picks the
> toolchain from the *target module's* directive, not the repo's. Against this repo's `go 1.27.0`
> (`go.mod:3`, raised by P19) the generator then emits **52 warnings** — *"package requires newer Go
> version go1.27 (application built with go1.26)"* — one per package it could not fully type-check.
> `GOTOOLCHAIN=go1.27.0 go install` produces a clean run. `scripts/wails-dev-setup.sh:52` has no
> such pin (F7). This is the *toolchain-skew* twin of the `@latest` hazard `AGENTS.md:255` already
> warns about, and nothing in the repo guards it.
>
> **`bun run dev` and `bun run package` are provably, hard-broken off macOS**, and the cause is
> again P3's module rooting: `wails3 tool docker-mounts` does `os.ReadFile("go.mod")` against the
> **current working directory** (`internal/commands/tool_docker_mounts.go:75` in the pinned CLI), and
> `darwin:build:docker` runs it from `apps/kira-studio/`, where there is no `go.mod`. Reproduced live
> — `bun run dev` here dies with `task: Command "wails3 tool docker-mounts" failed: exit status 1`.
> Worse, it is a `vars:` `sh:` command, so it is evaluated **before** the task's own `docker info`
> precondition and the user never sees the message that was written for them. And even if it ran, the
> task mounts `-v "{{.ROOT_DIR}}:/app"` = `apps/kira-studio` only, so the container would get no
> `go.mod`, no `go.sum` and no `packages/` either (F10).
>
> **"Everything is all over the place" is measurable.** Four scripts compute `ROOT_DIR` with the same
> nine-token idiom and two silently require the caller's cwd to be the repo root; the
> `PATH`-plus-`$(go env GOPATH)/bin` bootstrap appears **six** times; the "install the pinned wails3,
> then generate bindings" block appears **four** times (once as a script, three times copy-pasted
> into CI); and there are **three different `generate bindings` flag lists** across five call sites,
> with CI's three all omitting `-clean=true` that `AGENTS.md:269` calls the pinned invocation (F8,
> F9, F14, F15).
>
> **What is *not* broken, said plainly rather than padded into a finding.** P3's bun standardisation
> held completely — there is no `npm`/`pnpm`/`yarn` invocation anywhere outside `docs/` (F20). The
> `-b`/`-names` flavour is intact (44 `$Call.ByName`, zero `ByID`, zero `@wailsio/runtime` imports).
> `create:dmg`'s flags all still exist in beta.16. `bun run build`, `build:dev`, `typecheck`,
> `go build ./...` and `go vet ./...` are green here. Bindings generated with the *production*
> `BUILD_FLAGS` through `-f` come out byte-identical to a plain run. `wails3 version`'s
> stderr-not-stdout quirk that `wails-dev-setup.sh:37` depends on still holds in beta.16. Each of
> those was checked by running it, not assumed (F11).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `d63648f` (`docs: record what this phase changed underneath the docs`, the tip of
`claude/feature-v1-1-p5-onwards-2isfzt` after P19). Every finding below was checked against the tree
or against a command actually run in this container — never against P3's or P19's prose, per
`docs/v1.1/README.md`'s standing rule that a path named in an earlier plan is true only as of the
phase that named it.

| Claim | Evidence |
|---|---|
| P19 landed | `go.mod:3` is `go 1.27.0`; `go.mod:29` is `github.com/wailsapp/wails/v3 v3.0.0-beta.16`; `package.json:57` is `@wailsio/runtime 3.0.0-beta.16` |
| The pinned toolchain is installed and the task graph is runnable here | `wails3 version` → `v3.0.0-beta.16`; `wails3 task --list-all`, `--dry` and live `common:dev:frontend` all executed this session |
| The tree was, and is, clean | `git status --porcelain` → empty, before and after every experiment below |
| The frontend gate is green | `bun run build`, `bun run build:dev`, `bun run typecheck` (all three projects) → exit 0 |
| The Go gate is green | `go build ./...` → 0; `go vet ./...` → 0; `go mod tidy` → no-op |
| Bindings flavour is correct | 44 `$Call.ByName("…")`, 0 `Call.ByID`, 0 `@wailsio/runtime` imports under `apps/kira-studio/frontend/bindings/` |

**Two local side effects of this research, recorded because the next session inherits this
container.** (1) `apps/kira-studio/frontend/bindings/` was regenerated several times and is now the
*fresh* output of the pinned invocation — it is gitignored, so the tracked tree is unaffected, but it
is no longer the stale tree F6 describes. (2) `$(go env GOPATH)/bin/wails3` was reinstalled with
`GOTOOLCHAIN=go1.27.0` and is now a Go 1.27.0 build; a session that re-runs
`scripts/wails-dev-setup.sh` unchanged will silently replace it with a Go 1.26.8 build again (F7).
`apps/kira-studio/.task/checksum/` now exists with one entry.

### 0.2 Scope

1. Every script in the repository, read in full and traced to its callers: `scripts/*.sh`,
   `scripts/demo-dbs/seed.sh`, all three Taskfiles, `apps/kira-studio/build/config.yml`,
   `package.json`'s `scripts` block, `.githooks/pre-commit`, and both live and staged CI workflows
   (§1).
2. Fixing `bun run dev` and `bun run package` — the specific, cited defects in §2, not a rewrite
   (§3, §4).
3. Making bindings regeneration correct and single-sourced, including the Go-toolchain pin (D3, D4).
4. Collapsing the duplicated logic §2 measures into one shared implementation (D6, D7).
5. Deleting what has become dead: the Docker cross-compile path whose own error message names a task
   this repository does not have (D5).

### 0.3 Not in this phase

- Any behaviour change to the app, any dependency add/remove/upgrade, any new test.
- **The documentation sweep.** `README.md:101`'s stale "Go 1.25+", `docs/PACKAGING.md`'s
  `scripts/install-deps.sh`-plus-`wails-dev-setup.sh` prose (`:26-28`), `docs/ARCHITECTURE.md:697`'s
  and `docs/PACKAGING.md:29`'s `-clean=true`-less binding command, and
  `apps/kira-studio/README.md:13-18`'s wrong step order are all listed in §5 and **fixed only where
  they are a script's own contract**; the rest is P21's charter, which is why P20 lands before it.
- Editing `.github/workflows/*.yml` directly (D9 — same `workflow` OAuth-scope constraint P3's D15
  and `AGENTS.md`'s "Known open items" record). The **staged** copies under
  `docs/v1.1/plans/p19-pending-ci-workflow/` *are* edited.
- `.gitignore`'s stock Node/Next/Nuxt/Gatsby boilerplate (P3 F17/D14 declined it; declined again —
  nothing here needs it and the glob-semantics risk around `dist`/`!dist` has not changed).
- Promoting `packages/*` to real Bun workspace packages (P3 OQ-2, still open, still not this).

### 0.4 Ground rules

- **Every decision in §4 cites a finding in §2, and every finding cites a file:line, a command run
  in this container, or a controlled experiment whose Taskfile is written out.** Where evidence could
  not be obtained here it says so and names the macOS step that would obtain it (§6.3).
- `AGENTS.md`'s standing rules apply: no stubs, comments only where the code cannot speak for itself,
  Conventional Commits, and **no new unit tests** — nothing in this phase clears that bar; it edits
  shell scripts and YAML, and §6's gate is the proof.
- **Run §6.1's block after every commit**, not once at the end.

---

## 1. The inventory, and the real call graph

### 1.1 Every script in the repository

| Path | Lines | Entry point | Notes |
|---|---|---|---|
| `scripts/install-deps.sh` | 25 | `bun run setup` (`package.json:13`) | `bun install` + `go mod download` |
| `scripts/wails-dev-setup.sh` | 65 | `bun run setup`; **and directly** from `apps/kira-studio/tests/e2e-real/fixtures.ts:61` | pinned `wails3` install + bindings |
| `scripts/sign-bundle.sh` | 43 | `bun run package` (`package.json:27`), as `sh ../../scripts/sign-bundle.sh` | macOS-only, ad-hoc signs `.app` + `.dmg` |
| `scripts/verify-packaging.sh` | 131 | `bun run verify:packaging` (`package.json:28`); CI `checks`, `package-smoke`, `release` | S1/S2/S5 + A1/A3/A5/N2/A4/N3 |
| `scripts/db-compat.sh` | 195 | `bun run test:compat` (`package.json:30`); staged `p16-pending-ci-workflow/db-compat.yml:42` | P16's 16-row min/max matrix |
| `scripts/generate-wire.sh` | 96 | `bun run generate:wire` (`package.json:31`) | P11's pinned `flatc` |
| `scripts/demo-dbs/seed.sh` | 54 | manual (`README.md`) | `docker exec` per engine; no repo paths |
| `.githooks/pre-commit` | 13 | `git commit` (wired by `package.json:12`) | `bun run lint` + `bun run typecheck` |
| `apps/kira-studio/Taskfile.yml` | 49 | `wails3 task <x>` | root: `build`/`package`/`run`/`dev`, vars, two includes |
| `apps/kira-studio/build/Taskfile.yml` | 102 | included as `common:` | 7 tasks |
| `apps/kira-studio/build/darwin/Taskfile.yml` | 246 | included as `darwin:` | 15 tasks; re-includes `../Taskfile.yml` as `common:` |
| `apps/kira-studio/build/config.yml` | 79 | read by `wails3 dev` | `dev_mode.executes` is a third dispatcher |
| `.github/workflows/ci.yml` | 4 jobs | GitHub | `checks`, `ui`, `container-tests`, `package-smoke` |
| `.github/workflows/release.yml` | 1 job | GitHub | tag → `.dmg` → draft release |
| `docs/v1.1/plans/p19-pending-ci-workflow/{ci,release}.yml` | — | staged | identical to live except three `uses:` majors |
| `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml` | — | staged | `workflow_dispatch` → `sh scripts/db-compat.sh` |

`package.json:11-32` holds 18 scripts. All 18 have a live consumer; none is deleted for staleness in
this phase.

### 1.2 What actually calls what — `bun run dev`

Traced through the pinned CLI's own source and then run end to end in this container
(`scratchpad/dev.log`):

```
bun run dev
├─ predev              (package.json:14)  → bun run setup
│  └─ setup            (package.json:13)  → sh scripts/install-deps.sh
│     │                                        └─ bun install          ← prepare → git config  (1)
│     │                                        └─ go mod download
│     └─                                    sh scripts/wails-dev-setup.sh
│                                              ├─ go install wails3@<go.mod pin>      [F7: Go 1.26]
│                                              └─ if [ ! -d frontend/bindings ]       [F5: never fires]
└─ dev                 (package.json:15)  → cd apps/kira-studio && wails3 task dev
   └─ dev              (Taskfile.yml:45-48) → wails3 dev -config ./build/config.yml -port 9245
      └─ build/config.yml:58-64  dev_mode.executes — THREE SEPARATE OS PROCESSES:
         ├─ [blocking]   wails3 build DEV=true
         │                 └─ root `build` → darwin:build
         │                    ├─ macOS  → darwin:build:native            (unreachable here)
         │                    │            deps: common:go:mod:tidy      [F12: no sources, always runs]
         │                    │                  common:build:frontend
         │                    │                    deps: common:install:frontend:deps
         │                    │                            └─ bun install ← git config      (2)
         │                    │                          common:generate:bindings [F4: blind fingerprint]
         │                    │                    cmds: bun run build:dev
         │                    │                  common:generate:icons
         │                    │            cmds: go build $BUILD_FLAGS -o "bin/Kira Studio"
         │                    └─ else   → darwin:build:docker            ✗ DIES HERE (F10)
         ├─ [background] wails3 task common:dev:frontend
         │                 deps: common:install:frontend:deps
         │                         └─ bun install ← git config           (3)
         │                 cmds: bun run dev --port 9245 --strictPort    ✓ verified live
         └─ [primary]    wails3 task run → darwin:run
                           rebuilds bin/Kira Studio.dev.app, codesigns, execs it
```

### 1.3 What actually calls what — `bun run package`

```
bun run package
├─ prepackage          (package.json:26)  → bun run setup   (same as above)  ← git config  (1)
└─ package             (package.json:27)  → cd apps/kira-studio
   ├─ wails3 task darwin:package:dmg
   │  └─ darwin:package:dmg → deps darwin:package → deps darwin:build → build:native|build:docker
   │                            (build:frontend → install:frontend:deps → bun install ← git config (2))
   │     darwin:package  cmds: create:app:bundle  (rm -rf, mkdir, cp icns/binary/Info.plist,
   │                                               PlistBuddy version stamp, codesign:adhoc)
   │     darwin:package:dmg cmds: create:dmg → wails3 tool package --format dmg …
   └─ sh ../../scripts/sign-bundle.sh   (re-signs .app, signs .dmg)
```

`bun run verify:packaging` then asserts S1/S2/S5 statically and A1/A3/A5/N2/A4/N3 against
`apps/kira-studio/bin/Kira Studio.{app,dmg}` — the same paths `sign-bundle.sh:13-14` writes, checked
and consistent.

---

## 2. Findings

### F1 — Three dispatchers, one call graph, and no single place that owns it

§1.2's graph crosses four mechanisms — `package.json` lifecycle scripts, `wails3 dev`'s
`dev_mode.executes` (`build/config.yml:58-64`), Task's `deps`, and Task's `includes` — and each
re-enters the others. `run: once` (`build/Taskfile.yml:15,37,68`) deduplicates within one `wails3
task` **process**, and `config.yml:58-64` spawns three of them, so it deduplicates nothing across the
dev loop. This is not a finding to fix on its own; it is why F2 and F3 were invisible for four
phases, and why §4's decisions push work *up* to the one entry point rather than adding another
guard.

### F2 — `bun install` runs three times per `bun run dev`; there is exactly one `git config` in the repo

`grep -rn "git config"` over the whole tree, excluding `node_modules/`, `.git/` and `docs/v1/`,
returns exactly **one** executable hit: `package.json:12`,
`"prepare": "git config core.hooksPath .githooks || true"`. It is correct, it is where
`README.md:168` documents it, and it is not duplicated anywhere.

What the user saw is that line **echoed three times** by three separate `bun install` runs, because
Bun runs and prints the root package's `prepare` lifecycle script on every install. Verified live:

- Run 1 — `predev` → `install-deps.sh:21`. From `scratchpad/dev.log`:
  ```
  install-deps: bun install (workspace root + every apps/*/frontend)
  bun install v1.3.11 (af24e281)
  $ git config core.hooksPath .githooks || true
  ```
- Run 2 — `common:build:frontend`'s dep. `wails3 task --dry common:build:frontend` this session:
  ```
  task: [common:go:mod:tidy] go mod tidy
  task: [common:install:frontend:deps] bun install
  task: [common:generate:bindings] wails3 generate bindings -f '' -clean=true -b -names -ts -i
  task: [build:frontend (DEV=)] bun run build
  ```
- Run 3 — `common:dev:frontend`'s dep, in the *second* `wails3 task` process. Run live this session
  (`wails3 task common:dev:frontend`, `scratchpad/vite.log`):
  ```
  task: [common:install:frontend:deps] bun install
  bun install v1.3.11 (af24e281)
  $ git config core.hooksPath .githooks || true
  task: [common:dev:frontend] bun run dev --port 9245 --strictPort
  ```

`bun run package` produces two, for the same reason minus `dev:frontend`. Every `wails3 dev` watcher
rebuild re-runs `executes`, so the count grows with the session.

### F3 — The cause is one line: a bare directory in Task's `generates:`

`apps/kira-studio/build/Taskfile.yml:13-27` gives `install:frontend:deps` proper `sources:` and a
`generates:` — so it *should* be fingerprinted and skipped. It never is. Run twice in a row, back to
back, in this container:

```
### run A
task: [common:install:frontend:deps] bun install
### run B (should be up to date if fingerprinted)
task: [common:install:frontend:deps] bun install
```

…even though `apps/kira-studio/.task/checksum/common-install-frontend-deps` exists after run A.

Isolated in a controlled Taskfile pair with the same include shape (three tasks, identical
`sources:`, differing only in `generates:`):

| `generates:` | run 1 | run 2 |
|---|---|---|
| `[node_modules]` — a bare directory | ran | **ran again** |
| `["node_modules/**/*"]` | ran | `is up to date` |
| *(omitted entirely)* | ran | `is up to date` |

So `build/Taskfile.yml:21-22` is the whole bug. (A bare **directory** in `sources:` is fine — a
fourth control task with `sources: ["img.png", "sub"]` cached correctly on runs 2 and 3, which is why
`generate:icons`' `sources: appicon.icon` directory entry at `:88-89` is *not* a finding.)

### F4 — `generate:bindings`'s fingerprint watches a `go.mod` that has not existed at that path since P3

`apps/kira-studio/build/Taskfile.yml:71-77`:

```yaml
    sources:
      - "**/*.[jt]s"
      - exclude: frontend/**/*
      - frontend/bindings/**/*
      - "**/*.go"
      - go.mod          # :76
      - go.sum          # :77
```

The task has no `dir:`, so it runs from the *including* Taskfile's directory, `apps/kira-studio/`.
`ls apps/kira-studio/go.mod apps/kira-studio/go.sum` → **both absent** since P3's D2 rooted the
module.

Proven, not assumed, that Task resolves an included task's `sources:` against that directory rather
than the repo root — a controlled include pair with `sources: [go.mod]` in the included file:

| step | result |
|---|---|
| run 1 (only `<root>/go.mod` exists) | ran |
| run 2 | `is up to date` |
| rewrite **`<root>/go.mod`**, run 3 | **`is up to date`** — the root file is invisible |
| create `<app>/go.mod`, run 4 | ran |
| rewrite `<app>/go.mod`, run 5 | ran |

A parent-relative entry works correctly, which is the fix: the same harness with
`sources: ["../go.mod"]` reran exactly when the parent file changed.

**Why this is the P19 bug specifically:** `git show --stat 544127d`
(`chore(wails): move to v3.0.0-beta.16`) is `bun.lock | go.mod | go.sum | package.json` — **not one
`.go` file**. Under this fingerprint that commit is invisible to `common:generate:bindings`, so on
any working tree with a warm `.task/checksum` the bindings are simply not regenerated for a Wails
version bump.

### F5 — `wails-dev-setup.sh` gates regeneration on directory presence, never on version

`scripts/wails-dev-setup.sh:62-65`:

```sh
if [ ! -d "$ROOT_DIR/apps/kira-studio/frontend/bindings" ]; then
  echo "wails-dev-setup: generating Wails bindings (…is gitignored)"
  (cd "$ROOT_DIR/apps/kira-studio" && wails3 generate bindings -clean=true -b -names -ts -i)
fi
```

The script's own `:19-25`/`:40` logic *does* compare the installed `wails3` against `go.mod`'s pin and
reinstall on mismatch — but having just reinstalled a different CLI it leaves last version's bindings
in place, because the directory exists. Confirmed live: this session's `bun run dev` printed nothing
at all from `wails-dev-setup.sh`, silently skipping both branches. Together with F4, **no path in the
repository regenerates bindings after a Wails or Go version bump.**

### F6 — And the bindings on this branch were, in fact, stale

Not a hypothesis. Backing up `apps/kira-studio/frontend/bindings/`, running the pinned invocation
verbatim, and diffing:

```
$ cd apps/kira-studio && wails3 generate bindings -clean=true -b -names -ts -i
$ diff -rq <backup> apps/kira-studio/frontend/bindings
Only in …/bindings/encoding/json: jsontext
Files …/bindings/encoding/json/models.ts differ
```

```diff
--- backup/encoding/json/models.ts
+++ fresh/encoding/json/models.ts
+import * as jsontext$0 from "./jsontext/models.js";
-export type RawMessage = any;
+export type RawMessage = jsontext$0.Value;
```

Go 1.27 promotes `encoding/json/jsontext` into the standard library and `encoding/json.RawMessage`
resolves through it, so the checked-out bindings were describing a **pre-P19 stdlib**. The whole
`bindings/encoding/json/jsontext/` package (`index.ts`, `models.ts`) was missing from disk while a
freshly generated `models.ts` imports from it — an unresolvable Vite import waiting for whoever
regenerates half of it.

### F7 — `go install wails3@<pin>` builds the CLI with Go 1.26, not the repo's Go 1.27

`scripts/wails-dev-setup.sh:52` is `go install "github.com/wailsapp/wails/v3/cmd/wails3@$PINNED_VERSION"`.
Run in this container:

```
$ go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.16
go: github.com/wailsapp/wails/v3@v3.0.0-beta.16 requires go >= 1.25.0; switching to go1.26.8
$ go version -m $(go env GOPATH)/bin/wails3
/root/go/bin/wails3: go1.26.8
```

In module-install mode `GOTOOLCHAIN=auto` selects the toolchain from the **installed module's** own
directive, so the CLI is pinned to Wails' floor and never sees this repo's `go.mod:3` `go 1.27.0`.
Every `wails3 generate bindings` run then emits:

```
WARNING [warn] …/apps/kira-studio/main.go:1:1: package requires newer Go version go1.27
                (application built with go1.26)
…
WARNING 52 warnings emitted
```

— one per package the generator's `go/packages` type-checker could not fully load. Rebuilding the CLI
with `GOTOOLCHAIN=go1.27.0 go install …` (verified: `go version -m` → `go1.27.0`) removes **all 52**
and the run prints only its `Processed: 562 Packages, 14 Services, 44 Methods…` line.

**Honest limit on this one.** For *this* codebase the two CLIs produced byte-identical bindings
(`diff -rq` → 0 differences). The defect is that the type-checker is silently degrading on every
package in the app: nothing guarantees it stays benign, and the failure mode when it is not is
precisely the one `AGENTS.md:275-281` spends six lines warning about — a binding that generates
"successfully" and is wrong. `GOTOOLCHAIN=local` is **not** the fix: the base toolchain here is
go1.24.7 (`cd /tmp && go version`), and `GOTOOLCHAIN=local go install` refuses with
*"requires go >= 1.25.0 (running go 1.24.7; GOTOOLCHAIN=local)"*. The version must be read from
`go.mod` and passed explicitly.

### F8 — Five binding-generation call sites, three different flag lists

| Call site | Flags |
|---|---|
| `scripts/wails-dev-setup.sh:64` | `-clean=true -b -names -ts -i` |
| `apps/kira-studio/build/Taskfile.yml:81` | `-f '{{.BUILD_FLAGS}}' -clean=true{{if …}} -obfuscated{{end}} -b -names -ts -i` |
| `.github/workflows/ci.yml:36` | `-b -i -ts -names` |
| `.github/workflows/ci.yml:65` | `-b -i -ts -names` |
| `.github/workflows/release.yml:48` | `-b -i -ts -names` |
| *(staged)* `docs/v1.1/plans/p19-pending-ci-workflow/{ci.yml:36,ci.yml:65,release.yml:48}` | `-b -i -ts -names` |

`AGENTS.md:269-271` names one invocation as *the* pinned one — *"the exact flags
`scripts/wails-dev-setup.sh` uses — `wails3 generate bindings -clean=true -b -names -ts -i` … never a
shorter hand-typed version"*. **CI's three all drop `-clean=true`.** On a fresh runner checkout that
happens to be harmless (there is nothing to clean), which is exactly why it has survived — but it is
the same divergence class P3's F7 caught, re-formed in a different file, and it means the repository
does not do what its own working agreement says it does.

P3's **D11** decided *"`scripts/wails-dev-setup.sh` delegates to that task rather than carrying its
own flag list"*, with a named fallback of keeping two identical lists. The fallback was taken. The
two script/Taskfile lists are indeed equivalent today — but CI was never brought into either branch
of that decision, so the count went from two to five.

### F9 — CI reimplements `wails-dev-setup.sh` inline, three times, and cites a directory P3 deleted

`ci.yml:31-36`, `ci.yml:60-65` and `release.yml:44-48` are the same five lines, thrice:

```yaml
          set -eu
          PINNED_VERSION="$(grep -m1 'github.com/wailsapp/wails/v3 ' go.mod | awk '{print $2}')"
          go install "github.com/wailsapp/wails/v3/cmd/wails3@$PINNED_VERSION"
          export PATH="$PATH:$(go env GOPATH)/bin"
          (cd apps/kira-studio && wails3 generate bindings -b -i -ts -names)
```

That is `scripts/wails-dev-setup.sh:21`, `:52`, `:27-32` and `:64` copy-pasted, minus the GTK
preflight, minus the version comparison, minus `-clean=true`, and — F7 — minus any toolchain pin.
`ci.yml:30`'s step name still reads *"P57 D8/D13 — src/renderer/bridge/*.ts import them directly"*;
`src/renderer` has not existed since P3's C2.

### F10 — Off macOS, `bun run dev` and `bun run package` are hard-broken by P3's module rooting

Reproduced end to end in this container:

```
$ bun run dev
…
task: [dev] wails3 dev -config ./build/config.yml -port 9245
Wails v3.0.0-beta.16 › Build
  ERROR  task: Failed to run task "build": task: Command "wails3 tool docker-mounts" failed: exit status 1
  ERR blocking process failed exec="wails3 build DEV=true" err="exit status 1"
  ERROR  starting processes: exit status 1
  ERROR  task: Failed to run task "dev": exit status 1
error: script "dev" exited with code 1
```

`wails3 task --dry darwin:package:dmg` fails identically, before printing a single command.

The cause, read from the pinned CLI's own source rather than guessed —
`internal/commands/tool_docker_mounts.go:75`:

```go
	data, err := os.ReadFile("go.mod")
```

…a **cwd-relative** read. `darwin:build:docker` runs from `apps/kira-studio/`, which has had no
`go.mod` since P3 (F4). Run by hand from there:

```
$ cd apps/kira-studio && wails3 tool docker-mounts
  ERROR  reading go.mod: open go.mod: no such file or directory
```

…and from the repo root it succeeds (`-v "/root/go/pkg/mod:/go/pkg/mod"`, exit 0). A grep of the
whole pinned module for `"go.mod"` finds this as the **only** cwd-relative read outside `wake/` and
`mcp.go`, so no other task is affected — `wails3 build`, `wails3 dev` and `wails3 generate bindings`
are all fine.

Two aggravating defects sit on top of it:

- **The error the user sees is not the error that was written for them.** `DOCKER_MOUNTS` is a
  `vars:` `sh:` command (`build/darwin/Taskfile.yml:88-89`), and Task evaluates a task's `vars:`
  before its `preconditions:` — so `:69-75`'s *"Docker is required for cross-compilation"* and
  *"Docker image 'wails-cross' not found"* messages can never fire.
- **`build:docker` could not work even with a `go.mod` in reach.** `:77` mounts
  `-v "{{.ROOT_DIR}}:/app"`, and `ROOT_DIR` is the root Taskfile's directory — `apps/kira-studio`.
  The container would get the app package with no `go.mod`, no `go.sum` and no `packages/shared` or
  `packages/db-fixtures`. And `:75`'s remedy, *"Build it first: wails3 task setup:docker"*, names a
  task **this repository does not have** — `wails3 task --list-all` lists 26 tasks and `setup:docker`
  is not among them, because P3 trimmed the stock scaffold's setup tasks.

So `build:docker` is not a broken feature; it is a scaffold leftover that has never been reachable in
this repository and whose only observable behaviour is to replace a clear precondition message with
an opaque one.

### F11 — What was checked and is *not* broken

Recorded so the implementer does not re-derive it, and so §6.3's macOS list is honestly short.

| Suspicion | How it was checked | Result |
|---|---|---|
| `create:dmg`'s flags drifted in beta.16 | `wails3 tool package -help` | all nine flags used at `darwin/Taskfile.yml:144-151` exist |
| `create:dmg` expects the `.app` somewhere else | `internal/commands/tool_package.go:38,44` | `<out>/<name>.app` → `<out>/<name>.dmg`, matching `sign-bundle.sh:13-14` and `verify-packaging.sh:50-51` |
| `-f '<production BUILD_FLAGS>'` breaks bindings generation | ran `wails3 generate bindings -f '-tags production -trimpath -buildvcs=false -ldflags="-w -s -X …buildinfo.Version=0.0.0"' -clean=true -b -names -ts -i` | exit 0; `diff -rq` vs a plain run → **0 differences** |
| Vite 8 / Rolldown broke `build:dev` | `cd apps/kira-studio/frontend && bun run build:dev` | exit 0, `✓ built in 2.45s` |
| `wails3 version` moved to stdout in beta.16, breaking `wails-dev-setup.sh:37` | ran the script's exact expression | `INSTALLED_VERSION=[v3.0.0-beta.16]`, still stderr-only |
| `go mod tidy` mutates the tree under Go 1.27 | ran it | no-op; `git status --porcelain` empty |
| The `-b`/`-names` flavour regressed (P3 F7) | grep over fresh bindings | 44 `$Call.ByName`, 0 `Call.ByID`, 0 `@wailsio/runtime` |
| The tree does not compile / typecheck | `go build ./...`, `go vet ./...`, `bun run typecheck` | all exit 0 |
| `generate:icons` never caches (bare `appicon.icon` directory in `sources`) | controlled Taskfile with a directory in `sources` | caches correctly on runs 2 and 3 — **not** a finding |

**Consequently: no macOS-specific hard failure was reproduced or identified in the
`darwin:build:native` → `create:app:bundle` → `create:dmg` → `sign-bundle.sh` chain.** On the evidence
available here, the user's macOS symptoms are explained by F4+F5+F6+F7 (a build against bindings that
no longer match the Go tree, with the generator's type-checker degraded) — but that is an inference,
and §6.3 says exactly which command on real hardware confirms or refutes it before this phase is
called done.

### F12 — `go:mod:tidy` has no `sources`, so every build and every dev rebuild runs `go mod tidy`

`apps/kira-studio/build/Taskfile.yml:4-11` declares `internal: true`, `run: once` and a comment about
the `#4637` race, but no `sources:` and no `generates:`. It is a dep of both `common:generate:bindings`
(`:69-70`) and `darwin:build:native` (`:30`), and the `--dry` above confirms it is listed on every
`common:build:frontend`. So every `bun run dev`, every watcher rebuild and every `bun run package`
runs `go mod tidy` — which needs the module proxy (a dev loop that cannot run offline) and is free to
rewrite `go.mod`/`go.sum` underneath the developer mid-build. It is a no-op on this tree today, which
is the only reason nobody has noticed.

### F13 — `verify-packaging.sh` depends on `node`, which this repository does not require

`scripts/verify-packaging.sh:41`:

```sh
PACKAGE_SCRIPT="$(node -p "require('./package.json').scripts['package'] || ''")"
```

`README.md:98-108`'s Requirements list is Go, Bun, Xcode CLT and optionally Colima — no Node.
`AGENTS.md` says the vendored Node runtime was deleted in P58f. With `set -eu` (`:17`) a missing
`node` aborts the script at line 41, before any check runs, and `bun run verify:packaging` fails on a
machine that satisfies every documented prerequisite. P3's F14 spotted this and deliberately left it;
it is in scope now. (It happens to be installed in this container — `/opt/node22/bin/node`, v22.22.2
— which is why it has never surfaced here.)

### F14 — `ROOT_DIR`: four copies of one idiom, and two scripts with none

| Script | Line | Behaviour |
|---|---|---|
| `scripts/install-deps.sh` | `:9` | `ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"` |
| `scripts/wails-dev-setup.sh` | `:12` | identical string |
| `scripts/sign-bundle.sh` | `:12` | identical string |
| `scripts/generate-wire.sh` | `:11` | identical string |
| `scripts/verify-packaging.sh` | — | **none** — `:31,36,41,50,51,89` are all cwd-relative |
| `scripts/db-compat.sh` | — | **none** — `:62-77`'s sixteen `./apps/kira-studio/internal/adapters/…` package paths are cwd-relative |

The four that compute it work from anywhere; the two that don't silently misbehave unless the caller's
cwd happens to be the repo root. `package.json` always calls them from the root, so this is latent
rather than currently broken — but `db-compat.sh` is P16's addition and did not follow the pattern the
other five had already established, which is the "all over the place" the user is describing.

### F15 — The `$(go env GOPATH)/bin` bootstrap appears six times

`scripts/wails-dev-setup.sh:27-32` (the careful version, which checks for an existing entry and prints
a profile hint at `:56-58`), `package.json:15`, `package.json:27`, `.github/workflows/ci.yml:35`,
`ci.yml:64`, `release.yml:47`. Five of the six are one-liners that re-derive what the script already
solved.

Adjacent duplication in the same family: `install-deps.sh:11-18` and `wails-dev-setup.sh:14-17` both
implement a `command -v <tool>` preflight with a bespoke message, and the two scripts are only ever
invoked as a pair (`package.json:13`, and `README.md:147`/`docs/PACKAGING.md:26-28` both describe them
as one step).

### F16 — `build:docker` and `build:native` disagree about what they pass to the frontend build

`darwin/Taskfile.yml:29-38` (`build:native`) forwards `BUILD_FLAGS`, `OBFUSCATED` **and** `DEV` to
`common:build:frontend`. `:63-68` (`build:docker`) forwards only `OBFUSCATED`. Since
`common:build:frontend` passes `BUILD_FLAGS` straight through to `generate:bindings`' `-f`
(`build/Taskfile.yml:47-52,81`), the two build paths generate bindings under different `go/packages`
build flags. Harmless in practice (F11 measured `-f` as output-neutral here) and moot once D5 deletes
`build:docker` — recorded so the deletion is understood as also closing this.

### F17 — `package.json`'s script block: one real gap, one cosmetic asymmetry

- **No entry point for the `e2e-real` tier.** `apps/kira-studio/playwright.config.ts:44-52` defines
  the project; nothing in `package.json:11-32` runs it; `AGENTS.md:150-153` gives the raw command
  (`node node_modules/.bin/playwright test --project=e2e-real`, deliberately *not* `bunx`) and
  P16's plan already recorded *"There is no `e2e-real` npm script at all."* Two phases have now
  written that sentence instead of adding the script.
- `test:ui` and `test:ipc:fe` (`:23-24`) both begin `bun run build &&` — a second frontend build in
  front of a suite that already needs one. Correct, but it is the same shape P3's D12 removed from
  `dev` for a reason (*"two builds racing on the same `dist`"*). Left alone here: unlike the dev loop,
  nothing else is writing `dist` concurrently, and removing it would make the two scripts silently
  depend on a build having happened. Recorded as considered-and-declined, not overlooked.

### F18 — Every build prints a Vite config-loader warning

Emitted by `bun run build`, `bun run build:dev` and `vite dev` alike, three times per dev loop:

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'` …
  - ESM syntax in a file loaded as CommonJS (vite.config.ts:1:1). Use a `.mjs` extension or set
    "type": "module" in the closest package.json
```

`apps/kira-studio/frontend/package.json` has no `"type"`. P3's §5.5 deliberately omitted it (*"the
repo-root `package.json` has none, and §5.2's config is written to work either way; adding it here is
an independent decision nobody has made"*) — this is that decision, now that Vite has started warning
about it on every invocation and named the exact remedy.

### F19 — `darwin:` re-includes `common:`, so every common task is listed twice

`apps/kira-studio/build/darwin/Taskfile.yml:3-4` includes `../Taskfile.yml` as `common:`, and
`apps/kira-studio/Taskfile.yml:25-27` includes both. `wails3 task --list-all` therefore prints
`common:build:frontend` **and** `darwin:common:build:frontend`, for all seven common tasks. It is
stock Wails namespacing and `build:native`'s `deps` (`:30-39`) reference `common:*` through it, so it
cannot simply be deleted. Cosmetic; recorded so the next audit does not re-derive it. **No change.**

### F20 — P3's bun standardisation held completely

`grep -rn "\bnpm \|npx \|pnpm\|yarn "` across every `.sh`, `.yml`, `.json`, `.ts` and `.md` outside
`node_modules/`, `bun.lock` and `docs/` returns **zero invocations** — only prose ("npm package",
"npm metadata") and `ci.yml:68`'s `bunx playwright install webkit`. The twelve per-package-manager
Taskfile variants P3's D8 deleted have not come back, and `apps/kira-studio/Taskfile.yml:7` still
defaults `PACKAGE_MANAGER` to `bun` with nothing dispatching on it. **Nothing regressed here.** The
SPEC row's suspicion that it might have is answered in the negative, with the grep as the evidence.

### F21 — Stale prose that is part of a script's contract

Not the docs sweep (P21) — these four are inside or about the scripts this phase edits.

| Where | What it says | Reality |
|---|---|---|
| `scripts/wails-dev-setup.sh:3-4` | *"`bun run dev` (`bun run build && cd apps/kira-studio && wails3 task dev`)"* | P3's D12 dropped the `bun run build` prefix; `package.json:15` has no such prefix |
| `apps/kira-studio/README.md:13-18` | `bun run build` **then** `wails3 task common:generate:bindings` **then** `go run .` | inverted: the Vite build imports `@bindings/*`, so on a fresh clone step 1 fails before step 2 can fix it |
| `.github/workflows/ci.yml:30` | step name cites `src/renderer/bridge/*.ts` | `apps/kira-studio/frontend/src/bridge/` since P3 C2 |
| `README.md:101` | *"Go 1.25+"* | `go.mod:3` is `go 1.27.0` since P19; and F7 makes the exact version load-bearing, not advisory |

---

## 3. What the scripts look like afterwards

```
scripts/
├── lib.sh                 # NEW — sourced, never executed: ROOT_DIR, require_cmd,
│                          #       ensure_gopath_on_path, pinned_wails_version, go_directive
├── setup.sh               # NEW — the one entry point; absorbs install-deps.sh + wails-dev-setup.sh
├── sign-bundle.sh         # unchanged behaviour; sources lib.sh
├── verify-packaging.sh    # sources lib.sh; node -p → POSIX read (F13)
├── db-compat.sh           # sources lib.sh; cd "$ROOT_DIR" (F14)
├── generate-wire.sh       # sources lib.sh
└── demo-dbs/              # untouched
```

`package.json`'s `scripts` after (only the changed lines shown):

```json
    "setup": "sh scripts/setup.sh",
    "test:e2e-real": "bun run build && node node_modules/.bin/playwright test --config=apps/kira-studio/playwright.config.ts --project=e2e-real",
```

`apps/kira-studio/build/Taskfile.yml` after (only the changed blocks shown):

```yaml
  go:mod:tidy:
    summary: Runs `go mod tidy`
    internal: true
    run: once
    # The module is at the workspace root (P3 D2), not this directory — these are the files
    # `go mod tidy` reads and writes, and without them the task reruns on every build (P20 F12).
    sources:
      - ../../go.mod
      - ../../go.sum
      - "**/*.go"
    cmds:
      - go mod tidy

  install:frontend:deps:
    summary: Install workspace dependencies (Bun workspace root — one lockfile for every app)
    run: once
    dir: '{{.WORKSPACE_ROOT}}'
    sources:
      - package.json
      - bun.lock
      - apps/*/frontend/package.json
    # A bare directory here makes Task treat the task as never up to date, so `bun install` — and
    # the `prepare` hook it fires — reran three times per `bun run dev` (P20 F2/F3).
    generates:
      - node_modules/**/*
    preconditions:
      - sh: bun --version
        msg: "bun not found — install it from https://bun.sh"
    cmds:
      - bun install

  generate:bindings:
    summary: Generates bindings for the frontend
    run: once
    deps:
      - task: go:mod:tidy
    sources:
      - "**/*.[jt]s"
      - exclude: frontend/**/*
      - frontend/bindings/**/*
      - "**/*.go"
      # The module is at the workspace root (P3 D2). Named `go.mod`/`go.sum` these matched nothing,
      # so a dependency-only bump — P19's beta.15 -> beta.16 was exactly that — never regenerated
      # anything (P20 F4).
      - ../../go.mod
      - ../../go.sum
    generates:
      - frontend/bindings/**/*
    cmds:
      - wails3 generate bindings -f '{{.BUILD_FLAGS}}' -clean=true{{if eq .OBFUSCATED "true"}} -obfuscated{{end}} -b -names -ts -i
```

`apps/kira-studio/build/darwin/Taskfile.yml` after: `build:docker`, `build:universal:lipo:go` and the
whole `vars:` block (whose only entry was `CROSS_IMAGE`) are gone; `build` and `build:universal` no
longer fork on `OS`:

```yaml
tasks:
  build:
    summary: Builds the application
    # macOS-only product (docs/ARCHITECTURE.md). The scaffold's Docker cross-compile path is
    # deleted, not fixed: it read go.mod from the app directory (P20 F10), mounted only the app
    # directory, and its own "not found" message named a `setup:docker` task this repo has never
    # had.
    preconditions:
      - sh: '[ "$(uname -s)" = Darwin ]'
        msg: "Kira Studio builds on macOS only — see docs/PACKAGING.md."
    cmds:
      - task: build:native
        vars: { … unchanged … }
```

---

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **`generates: node_modules` → `generates: node_modules/**/*`** in `install:frontend:deps`. | F3 isolates this single line as the cause of `bun install` running three times per `bun run dev` — and therefore of the user's "git config appears like 3 times". The `**/*` form and the no-`generates` form both cache correctly; the `**/*` form is kept so the task still declares its output. |
| **D2** | **`package.json:12`'s `prepare` stays exactly as it is.** | F2: there is one `git config` in the repository and it is correct. The symptom was three *executions*, not three definitions, and D1 removes two of them. Moving hook installation out of the `bun install` lifecycle would break `README.md:168`'s documented contract to fix a problem that no longer exists. Recorded as a decision because "the user reported git config three times" invites deleting it. |
| **D3** | **`go.mod`/`go.sum` in `generate:bindings`' and `go:mod:tidy`'s `sources` become `../../go.mod` / `../../go.sum`.** | F4: the current entries have matched nothing since P3 rooted the module, which is why P19's dependency-only bump regenerated nothing. Parent-relative sources were verified working in a controlled harness before this was written. This also gives `go:mod:tidy` a fingerprint at last (F12), so a dev loop stops needing the module proxy on every rebuild. |
| **D4** | **`scripts/setup.sh` installs the CLI as `GOTOOLCHAIN="go$(go_directive)" go install …@$(pinned_wails_version)`, and regenerates bindings whenever a stamp — pinned Wails version, `go.mod`'s go directive, and the installed binary's own build toolchain — differs from the last successful generation.** The stamp lives at `apps/kira-studio/.task/bindings.stamp` (gitignored via `.task`), **not** inside `frontend/bindings/`, which `-clean=true` wipes. | F5/F6/F7. The directory-presence gate is what let stale bindings survive a version bump; the stamp is the smallest thing that closes it without re-running a 30-second generation on every `bun run dev`. `GOTOOLCHAIN` must be explicit because `auto` picks Wails' floor (go1.26.8) and `local` here is go1.24.7 — both measured. |
| **D5** | **Delete `darwin:build:docker`, `build:universal:lipo:go` and `CROSS_IMAGE`; replace the `{{if eq OS "darwin"}}` forks in `build` and `build:universal` with a `uname -s` precondition naming the macOS-only constraint.** | F10: the path reads `go.mod` from the wrong directory, mounts the wrong directory, and its own remedy names `setup:docker`, which `wails3 task --list-all` shows this repository does not have. It has never been runnable here; its only observed effect is to replace the `docker info` precondition's message with `exit status 1`. Deleting it turns "off-macOS `bun run dev` dies opaquely" into "off-macOS `bun run dev` says it is macOS-only", which is the truth `docs/PACKAGING.md` §6 has recorded since P52. Closes F16 as a side effect. |
| **D6** | **`scripts/install-deps.sh` and `scripts/wails-dev-setup.sh` merge into one `scripts/setup.sh`; a new sourced `scripts/lib.sh` holds `ROOT_DIR`, `require_cmd`, `ensure_gopath_on_path`, `pinned_wails_version` and `go_directive`; all five remaining scripts source it.** `apps/kira-studio/tests/e2e-real/fixtures.ts:61` is repointed in the same commit. | F14/F15/F16: four copies of the `ROOT_DIR` idiom, two scripts silently requiring the caller's cwd, two `command -v` preflights, and six `$(go env GOPATH)/bin` bootstraps. The two scripts are already only ever invoked as a pair (`package.json:13`) and already documented as one step (`README.md:147`). This is the SPEC row's "single shared implementation", made structural. |
| **D7** | **CI's three inline blocks become `sh scripts/setup.sh`**, applied to the **staged** `docs/v1.1/plans/p19-pending-ci-workflow/{ci,release}.yml` only. | F8/F9: three copy-pasted reimplementations, all missing `-clean=true`, all missing the toolchain pin, one citing a directory P3 deleted. Routing CI through the same script leaves **one** binding-generation flag list in the repository — `build/Taskfile.yml:81` — which is what P3's D11 asked for and did not get. `scripts/setup.sh` is idempotent and fast on a warm tree, so it is a safe superset of what the inline block did. |
| **D8** | **`scripts/setup.sh` generates bindings by delegating to `wails3 task common:generate:bindings`** (P3 D11's *preferred* branch), not by carrying its own flag list. | F8. P3's stated reason for allowing the fallback was a possible chicken-and-egg with a not-yet-installed `wails3`; that is gone, because `setup.sh` installs the pinned CLI immediately above, and D3 has just given the task a correct fingerprint so a warm call is a no-op rather than a 30-second regeneration. **If the implementer measures a cold `bun run dev` materially slower this way, take the fallback — one shared invocation in `lib.sh`, called by both — and say which was taken, in the commit message**, exactly as P3's F13 required. |
| **D9** | **`.github/workflows/*.yml` are not touched; the staged copies under `docs/v1.1/plans/p19-pending-ci-workflow/` carry P20's edits, and that directory's README records it.** | Same `workflow` OAuth-scope blocker `AGENTS.md`'s "Known open items" and P3's D15 record. Leaving the staged files carrying the inline block would ship F8/F9 forward the moment someone applies them. |
| **D10** | **`verify-packaging.sh:41`'s `node -p` becomes a POSIX `sed` read of `package.json`.** The S5 `case` pattern (`*"wails3 task darwin:package:dmg"*`) is unchanged. | F13: `node` is not in `README.md`'s Requirements and has not been a declared dependency since P58f deleted the vendored runtime; with `set -eu` its absence aborts the script before any check runs. `bun -e` would work but adds a second way to read JSON — the script already parses YAML with `sed` at `:89`. |
| **D11** | **`apps/kira-studio/frontend/package.json` gains `"type": "module"`.** | F18: Vite names this exact remedy in a warning printed on every build and every dev start. P3's §5.2 config was deliberately written to work under both loaders (`fileURLToPath(new URL(…, import.meta.url))`, never `__dirname`), so the switch is safe; `bun run build`, `bun run build:dev` and `vite dev` were all exercised this session and are the proof gate. |
| **D12** | **Add `test:e2e-real` to `package.json`, in `AGENTS.md`'s plain-Node form.** | F17: the project exists in `playwright.config.ts:44-52`, `AGENTS.md:150-153` documents why it must **not** be `bunx`, and two phases have written "there is no script for it" rather than adding one. `node node_modules/.bin/playwright` is not a contradiction of D10 — the Playwright CLI is a Node program either way; what D10 removes is a *shell script* depending on Node. |
| **D13** | **Fix the four stale contract lines in F21** — `wails-dev-setup.sh`'s header (which moves into `setup.sh`), `apps/kira-studio/README.md:13-18`'s inverted order, the staged `ci.yml:30` step name, and `README.md:101`'s `Go 1.25+` → `Go 1.27+`. **Everything else in `README.md`, `docs/PACKAGING.md` and `docs/ARCHITECTURE.md` is left to P21.** | These four are a script's own contract or a build instruction that does not work; the rest is drift, and P20 exists before P21 precisely so P21 documents a workflow that works rather than the other way round. `README.md:147`'s script-table row must change anyway because `install-deps.sh` ceases to exist (D6). |
| **D14** | **`AGENTS.md:269-281`'s Wails fix-note is rewritten to name the task, not the script**, and gains one sentence on the `GOTOOLCHAIN` pin. The `-names` paragraph is kept verbatim — it is still true and still the expensive lesson. | D8 makes `build/Taskfile.yml:81` the single definition, so a note pointing at `scripts/wails-dev-setup.sh` would point at a deleted file. F7 is a standing environment rule (`AGENTS.md`'s own charter: *"how to run things in whichever box a session happens to be on"*), not a phase finding, so it belongs there rather than only here. |

---

## 5. Implementation order

Seven commits. Each is independently green under §6.1 — run it after each, not once at the end. The
order matters: **C1 is the user's reported symptom and is one line, so it lands first and can be
verified on its own**; C2-C3 fix regeneration and must precede any commit that regenerates; C6 is the
only commit that touches CI-shaped files.

### C1 — `fix(build): stop bun install rerunning on every task invocation`

`apps/kira-studio/build/Taskfile.yml:21-22` — `node_modules` → `node_modules/**/*`, with the
two-line comment from §3.

Verify: `cd apps/kira-studio && wails3 task common:install:frontend:deps` twice in a row — the second
must print `task: Task "common:install:frontend:deps" is up to date` and **must not** print
`$ git config core.hooksPath .githooks`. Then §6.1.

### C2 — `fix(build): make the bindings task see the workspace-root go.mod`

`apps/kira-studio/build/Taskfile.yml` — `go:mod:tidy` gains `sources` (`../../go.mod`, `../../go.sum`,
`**/*.go`); `generate:bindings`' `go.mod`/`go.sum` become `../../go.mod`/`../../go.sum`. Comments as
in §3.

Verify: `wails3 task common:generate:bindings` twice — second run `is up to date`; then
`touch ../../go.sum` (or make a real whitespace edit and revert it) and confirm the next run
regenerates. Then §6.4's bindings-flavour block, then §6.1.

### C3 — `refactor(scripts): one setup entry point, one shared shell library`

Creates `scripts/lib.sh` and `scripts/setup.sh`; deletes `scripts/install-deps.sh` and
`scripts/wails-dev-setup.sh`; repoints `package.json:13`, `apps/kira-studio/tests/e2e-real/fixtures.ts:61`
and its two comments at `:26,:48`.

`setup.sh` does, in order: `require_cmd bun`; `require_cmd go`; `bun install`; `go mod download`;
`ensure_gopath_on_path`; install the pinned `wails3` with `GOTOOLCHAIN="go$(go_directive)"` when the
installed version differs from `pinned_wails_version` **or** when `go version -m "$(command -v wails3)"`
reports a toolchain older than the go directive (F7); regenerate bindings via
`wails3 task common:generate:bindings` (D8) when the stamp at
`apps/kira-studio/.task/bindings.stamp` is absent or differs; write the stamp on success. The Linux
GTK preflight (`wails-dev-setup.sh:46-51`) moves across unchanged — it is still required and
`AGENTS.md:250-253` still depends on it.

Verify: `rm -rf apps/kira-studio/frontend/bindings apps/kira-studio/.task && bun run setup` →
regenerates; `bun run setup` again → says nothing about bindings and does not reinstall; then §6.1
and §6.4. Because `tests/e2e-real/fixtures.ts:61` is one of the two callers, also run
`bun run typecheck` (which covers that file via `tsconfig.tests.json`) before moving on.

### C4 — `fix(build)!: drop the unreachable Docker cross-compile path`

`apps/kira-studio/build/darwin/Taskfile.yml` — delete `build:docker` (`:60-89`),
`build:universal:lipo:go` (`:112-117`) and the `CROSS_IMAGE` var (`:6-8`); collapse `build`'s
(`:14`) and `build:universal`'s (`:103`) `{{if eq OS "darwin"}}` forks; add the `uname -s`
precondition from §3. Breaking-change marker because `wails3 task darwin:build` now refuses off
macOS instead of attempting Docker.

Verify: `wails3 task --dry darwin:package:dmg` on Linux now fails with the **precondition message**,
not `Command "wails3 tool docker-mounts" failed`; `bun run dev` on Linux likewise. `grep -rn
'wails-cross\|build:docker\|lipo:go\|setup:docker' apps/ scripts/ package.json` returns nothing.
(Both deleted tasks are `internal: true`, so `wails3 task --list-all` is unchanged at 26 entries —
do not use it as the check.) Then §6.1.

### C5 — `fix(scripts): drop the undeclared node dependency and the cwd assumptions`

`verify-packaging.sh` — `:41`'s `node -p` → a `sed` read; source `lib.sh` and `cd "$ROOT_DIR"`.
`db-compat.sh` — source `lib.sh` and `cd "$ROOT_DIR"`. `sign-bundle.sh` and `generate-wire.sh` —
replace their local `ROOT_DIR` line with the sourced one; no behaviour change.

Verify: `bun run verify:packaging` from the repo root **and** from `/tmp` (`sh
/home/user/kira-studio/scripts/verify-packaging.sh`) both pass identically; the same for
`sh scripts/db-compat.sh --only sqlite` (which matches no row and must exit 2 with its own message,
not a `go test` path error). Confirm the S5 check still passes with the `sed` read by temporarily
mangling `package.json`'s `package` script and seeing it **fail**, then reverting — §6.5.

### C6 — `ci: route the staged workflows through scripts/setup.sh`

`docs/v1.1/plans/p19-pending-ci-workflow/ci.yml` (both blocks) and `release.yml` — replace the
five-line inline block with `- run: sh scripts/setup.sh`, and fix `ci.yml:30`'s step name. Update
`docs/v1.1/plans/p19-pending-ci-workflow/README.md` to say P20 revised these beyond P19's three
`uses:` bumps, per that directory's own standing instruction. **`.github/workflows/*.yml` are not
touched** (D9).

Verify: `diff` the staged files against the live ones and confirm the only differences are the three
`uses:` majors, the three replaced blocks and the one step name; `grep -rn 'generate bindings'
docs/v1.1/plans/p19-pending-ci-workflow/` returns nothing.

### C7 — `chore: the frontend package is ESM, and the contract lines that were wrong`

`apps/kira-studio/frontend/package.json` — `"type": "module"` (D11). `package.json` — add
`test:e2e-real` (D12). `apps/kira-studio/README.md:13-18` — bindings before build. `README.md:101`
(`Go 1.27+`) and `:147` (the script-table row `install-deps.sh` made obsolete). `AGENTS.md:269-281`
per D14.

Verify: `bun run build`, `bun run build:dev` and a live `wails3 task common:dev:frontend` all run
with **no** `configLoader: 'native'` warning; the acceptance greps in §7.

---

## 6. Verification

### 6.1 After every commit

```sh
bun run lint
bun run typecheck
bun run build
go build ./... && go vet ./...
git status --porcelain          # must be empty
```

**Baseline measured at `d63648f`, this session:** all five green, `git status --porcelain` empty.
`go build ./...` compiles the root `main` package, which imports Wails and needs the GTK4/WebKitGTK
headers `AGENTS.md:250-253` names; they are present in this container.

### 6.2 Once, at the end — everything obtainable off macOS

```sh
bun run setup                                            # idempotent; second run must be near-silent
bun run test:unit
bun run test:ui                                          # needs `bunx playwright install webkit` + its system libs
bun run test:ipc:fe
go test ./...                                            # container-backed cases self-skip without Docker
bun run verify:packaging                                 # A1/A3/A5/N2/A4/N3 must report "skipped", and pass
cd apps/kira-studio && wails3 task --list-all            # 26 entries, unchanged: the two deleted
                                                        # tasks are `internal: true` and were never listed
cd apps/kira-studio && wails3 task --dry common:build:frontend
cd apps/kira-studio && wails3 task common:dev:frontend   # serves Vite on 9245; ^C
```

The last one is the only *live* proof of the dev fix obtainable off macOS, and it works today:
verified this session that `curl -sf http://127.0.0.1:9245/` returns the app's `index.html` with
`<script type="module" src="/src/main.ts">`, that `/src/main.ts` answers 200, and that
`/wails/runtime.js` answers 200 from `apps/kira-studio/frontend/wails/runtime.js`. **After C1 it must
additionally not print `$ git config core.hooksPath .githooks` at all.**

### 6.3 macOS-only — what this phase may not report as passed

`docs/PACKAGING.md` §6 has recorded since P52 that every packaging item is unrun for want of
hardware; P20 does not change that, and F11 is explicit that **no macOS-specific failure was
identified here**. The implementer must therefore say plainly which of these were run and which were
not:

| Check | What it proves | Runnable here? |
|---|---|---|
| `bun run dev` end to end — window opens, HMR edits land | the dev loop actually works | **no** — `darwin:run` codesigns and execs a `.app` |
| Count `git config` lines in one `bun run dev` | C1 in the real three-process shape (must be **1** on a cold tree, **0** on a warm one) | partially — the Linux run reaches only the first |
| `bun run package && bun run verify:packaging` | A1/A3/A5/N2/A4/N3 against a real bundle | **no** |
| `codesign -dv --verbose=2 "apps/kira-studio/bin/Kira Studio.dmg"` → `Signature=adhoc` | `sign-bundle.sh:36-39` | **no** |
| `wails3 task darwin:build` on macOS after C4 | the deleted Docker fork did not take `build:native` with it | **no** |
| A cold clone: `rm -rf node_modules apps/kira-studio/frontend/bindings apps/kira-studio/.task && bun run dev` | D4's stamp on a truly fresh tree | partially |

**The one open question this phase cannot close by itself** is whether F4+F5+F6+F7 fully account for
the user's macOS symptoms. §7 item 10 makes that an explicit hand-back: if `bun run dev` still fails
on hardware after C1-C7, the failure output belongs in a P20 iteration-2 plan, not in a guess here.

### 6.4 The bindings guards, checked positively

Neither of these fails loudly if a change misses it — "the build passed" is not evidence.

**Flavour (P3 F7, still the standing guard).** After `wails3 task common:generate:bindings`:

```sh
grep -rho '\$Call\.ByName("[^"]*"' apps/kira-studio/frontend/bindings | wc -l   # 44 today, > 0 always
grep -rc  'Call\.ByID'             apps/kira-studio/frontend/bindings           # every file 0
grep -rl  '@wailsio/runtime'       apps/kira-studio/frontend/bindings | wc -l   # 0
grep -rl  '"/wails/runtime.js"'    apps/kira-studio/frontend/bindings/**/bridge/*.ts | wc -l  # every service module
```

Then `bun run test:ui`, whose `tests/ui/support/mockRuntime.ts` builds `CHANNEL_TO_FQN` from exactly
those `ByName` strings — a `-names`-less regeneration surfaces there as
`Error: no CHANNEL_TO_FQN entry for undefined` and nowhere else (`AGENTS.md:275-281`).

**Freshness (new, F4/F6).** The regeneration must be *provably* triggered by a dependency-only
change, since that is the exact case that failed:

```sh
cd apps/kira-studio
wails3 task common:generate:bindings          # settle
wails3 task common:generate:bindings          # must say: is up to date
touch ../../go.sum
wails3 task common:generate:bindings          # must RUN
```

**Toolchain (new, F7).** The generator must emit **zero** `requires newer Go version` warnings:

```sh
go version -m "$(command -v wails3)" | head -1     # must report go.mod's directive, not go1.26.x
cd apps/kira-studio && wails3 generate bindings -clean=true -b -names -ts -i 2>&1 \
  | grep -c 'requires newer Go version'            # must be 0 (it is 52 before this phase)
```

### 6.5 `verify-packaging.sh`'s own checks, exercised

S2's silent-degradation shape (P3 F14) is unchanged and still needs a positive check; S5 now has a
new reader (D10) and needs one too.

- Temporarily add a line containing `autoUpdater` under `apps/kira-studio/frontend/src/` and confirm
  `bun run verify:packaging` **fails** with *"updater code present"*. Revert.
- Temporarily change `package.json`'s `package` script to drop `:dmg` and confirm it **fails** with
  *"package script changed"*. Revert.

---

## 7. Acceptance checklist

P20 is done when every line below is true, each checked against the tree rather than against this
document:

1. `cd apps/kira-studio && wails3 task common:install:frontend:deps` run twice prints
   `is up to date` the second time, and neither run after the first prints
   `$ git config core.hooksPath .githooks`.
2. `grep -rn "git config" --exclude-dir=node_modules --exclude-dir=.git . | grep -v docs/`
   still returns exactly one hit, `package.json:12` (D2 — it is not supposed to move).
3. `grep -n 'go.mod\|go.sum' apps/kira-studio/build/Taskfile.yml` shows only `../../go.mod` and
   `../../go.sum`, and §6.4's freshness block behaves as written.
4. `grep -rn 'generate bindings' scripts/ apps/ .github/ docs/v1.1/plans/p19-pending-ci-workflow/`
   shows **exactly one** flag list — `apps/kira-studio/build/Taskfile.yml:81` — or, if D8's fallback
   was taken, exactly two identical ones with the commit message saying which and why.
5. `ls scripts/` shows `lib.sh setup.sh sign-bundle.sh verify-packaging.sh db-compat.sh
   generate-wire.sh demo-dbs/` and **no** `install-deps.sh` or `wails-dev-setup.sh`;
   `grep -rn 'install-deps\|wails-dev-setup' --exclude-dir=node_modules --exclude-dir=.git . |
   grep -v '^./docs/v1'` returns nothing outside this plan.
6. `go version -m "$(command -v wails3)"` reports `go.mod`'s directive after a fresh
   `bun run setup`, and §6.4's toolchain grep counts **0** warnings.
7. `grep -n 'build:docker\|lipo:go\|CROSS_IMAGE\|wails-cross\|setup:docker'
   apps/kira-studio/build/darwin/Taskfile.yml` returns nothing (both deleted tasks are
   `internal: true`, so `--list-all` is not the check — it printed 26 entries before and prints 26
   after); `bun run dev` on Linux fails with the macOS-only precondition message, not
   `docker-mounts`.
8. `sh /absolute/path/to/scripts/verify-packaging.sh` run from `/tmp` produces the same output as
   from the repo root, and `command -v node` is not required for it (test with
   `env PATH=/usr/bin:/bin sh scripts/verify-packaging.sh` if node lives outside those).
9. `bun run build` prints no `configLoader: 'native'` warning; `bun run test:e2e-real` exists in
   `package.json` and uses `node node_modules/.bin/playwright`, never `bunx`.
10. §6.2 has been run in full and §6.3's table has an explicit run/not-run verdict per row.
    **`bun run dev` and `bun run package` end to end are macOS-only — say so; do not report them as
    passed.** If they still fail on hardware, the failure output opens a P20 iteration-2 plan rather
    than being patched blind.
11. `git status --porcelain` is clean and the diff contains **no** `.github/workflows/` file.
12. `AGENTS.md`'s Wails section names the task rather than the deleted script, carries the
    `GOTOOLCHAIN` rule, and keeps the `-names` paragraph verbatim. Its "Known open items" is
    unchanged apart from that — both CI-workflow entries stay open (D9 does not clear their blocker).

---

## 8. Open questions, handed forward

**OQ-1 — whether F4-F7 fully explain the user's macOS symptoms.** F11 records that no
macOS-specific failure was reproduced or identified in the `build:native` → `create:app:bundle` →
`create:dmg` → `sign-bundle.sh` chain, and that eight separate suspicions about it were checked and
cleared by running them. The stale-bindings/degraded-generator explanation is an inference from four
proven defects, not an observation of the user's failure. **Owner: the first session with macOS
hardware; §6.3 is its checklist and §7 item 10 its escalation path.**

**OQ-2 — `wails3 tool docker-mounts`' cwd-relative `go.mod` read is a Wails bug, not just ours.**
`internal/commands/tool_docker_mounts.go:75` assumes the Wails app directory is the Go module
directory, which the `apps/` monorepo shape (P3 D2) breaks for anyone, not only this repo. D5 routes
around it by deleting the only caller. If a future phase ever wants real cross-compilation back, the
upstream fix is a module-root walk, and `v3.wails.io` being 403-blocked from every box here
(`AGENTS.md:257`) means the issue would have to be filed from the GitHub side. **Owner: whoever needs
non-macOS builds.**

**OQ-3 — `install:frontend:deps` still runs `bun install` twice per cold `bun run dev`.** D1 makes
the second and third runs cached no-ops, and D6 makes `predev`'s the authoritative one — but on a
genuinely cold tree the Task copy still fires once, because `.task/checksum` is empty. That is
correct behaviour for a bare `wails3 task dev` invoked without `bun run`, and wrong-ish for the
`bun run dev` path that has already installed. Collapsing it further means teaching the Taskfile that
something outside it already ran, which is the kind of local knowledge P3's D10 spent a phase
removing. **Left as is, deliberately. Owner: only revisit if cold-start time is measured as a
problem.**

**OQ-4 — P3's OQ-4 (the renderer CSP vs Vite's HMR socket) is still unanswered**, and this phase did
not answer it either: `apps/kira-studio/frontend/index.html`'s policy is still
`default-src 'self'; script-src 'self'` with no `connect-src`, served intact through the Vite dev
server this session. Nobody has yet completed a `wails3 dev` run in this repository to find out
whether the webview blocks HMR. **Owner: unchanged — the first session with macOS.**

**OQ-5 — the two staged CI workflows are now three generations stale**, and P20 adds a fourth set of
edits to them (D7/D9). The live `ci.yml`/`release.yml` will, until someone with `workflow` scope
applies the staged copies, keep installing an untoolchain-pinned `wails3` and generating bindings
without `-clean=true`. **Owner: whoever next has a token with the `workflow` OAuth scope;
`docs/v1.1/plans/p19-pending-ci-workflow/README.md` carries the exact `git mv`.**
