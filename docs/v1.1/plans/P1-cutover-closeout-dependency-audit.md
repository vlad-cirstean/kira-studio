# P1 — Cutover closeout: dependency, script and folder-structure audit

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P1 row): *"The P58f cutover itself
> (deleting `src/engine`, `enginehost` and the vendored Node runtime …) plus a full audit of every
> dependency (`package.json`, `shell/go.mod`) and every script (`scripts/*`, `package.json`'s own
> `scripts` block) against what the post-cutover tree actually uses, removing anything stale — named
> example: `tsgo` no longer does anything meaningful now that the toolchain has moved on. Also audit
> the repository's own folder structure now that it is a single Go backend + single Vue frontend
> rather than the old two-backend/two-framework (Electron+Node engine) shape, and remove or fold in
> any stale folders or structural constructs left over from that shape that no longer serve a
> purpose."*
>
> **The cutover half of that row is already done, and this plan does not re-plan it.** `src/engine`,
> `internal/enginehost` and `shell/runtime/` are gone from the tree — implemented under
> `docs/v1/SPEC.md`'s P58 row (P58f M10-M11) before this chapter opened, and walked through
> criterion by criterion in `docs/v1/plans/P58f-cutover.md` §7 and `AGENTS.md`'s "P58f
> implementation findings" section. §0.1 records the evidence. Everything below is the audit.
>
> **The dependency audit's headline is that there is nothing to remove.** Every one of
> `package.json`'s 30 `devDependencies` and its one `dependencies` entry has a live consumer, and
> every one of `shell/go.mod`'s 24 direct requires has a live Go import (F1, F3). The only `go.mod`
> change the audit earns is a **misclassification**, not a removal: `github.com/twmb/franz-go/pkg/kmsg`
> is listed `// indirect` while `internal/adapters/kafka/definition.go` imports it directly, and
> `go mod tidy` promotes it (F3).
>
> **The SPEC row's named example does not survive contact with the tree.** `tsgo` is not doing
> nothing: it is the *only* typechecker over 72 files and ≈20 400 lines that `vue-tsc` never sees —
> all of `tests/ui/`, `tests/ipc/`, `tests/e2e-real/`, `tests/db/support/`, `tests/unit/` and
> `playwright.config.ts`. Deleting it without a replacement drops that whole surface out of
> `bun run typecheck`, out of the pre-commit hook and out of CI. There *is* a narrower true claim
> underneath — `typescript@5.9.3` is already installed for `vue-tsc`, and plain `tsc` passes both of
> tsgo's projects identically today — but acting on it is a toolchain-policy change that contradicts
> `docs/ARCHITECTURE.md`'s own Stack table, not a staleness removal. F2 states the verdict with the
> measurements; D2 keeps `tsgo` and hands the narrower question to the user rather than deciding it
> here.
>
> **What the audit actually found is a stale *documentation-of-scripts* surface and a handful of
> structural leftovers**: `README.md`'s Development and Tests sections describe eight
> `package.json` scripts that do not exist (F8); `shell/README.md` names three deleted entry points
> (F9); two genuinely dead TypeScript modules under `src/shared/` that died with `src/engine` and
> that no linter can see (F12); a root-level `build/` directory holding byte-identical duplicates of
> artwork that already lives under `shell/build/` (F13); and Wails scaffolding in
> `shell/build/{Taskfile.yml,config.yml}` that assumes `shell/frontend/` is its own npm project,
> which it is not (F14, F15).
>
> **This is an audit, not a refactor.** `src/renderer` and `src/shared` were both examined against
> the single-frontend shape and both **keep their names and locations** on stated evidence (F11);
> the rename question is recorded in §7 as explicitly out of scope, not silently skipped.

---

## 0. What this phase is, and what it is not

### 0.1 The P58f cutover is already implemented — do not re-plan it

Verified against the tree at this plan's authoring commit (`9c2a10a`), not taken from prose:

| Claim | Evidence |
|---|---|
| `src/engine` is gone | `ls src/` → `renderer  shared` only |
| `internal/enginehost` is gone | `ls shell/internal/` has no `enginehost`; `grep -rn enginehost shell --include='*.go'` → no live package |
| The vendored Node runtime is not in the repository | `git ls-files shell/runtime` → **empty**. (A `shell/runtime/{node,engine}` tree still exists *on disk* in this container — untracked, gitignored by `shell/.gitignore`'s `runtime` line, pre-cutover residue. See F4.) |
| The tree is green today | `bun run lint` → "Checked 304 files … No fixes applied"; `bun run typecheck` → all three projects exit 0; `cd shell && go build ./internal/... ./cmd/...` → exit 0; `go vet ./internal/... ./cmd/...` → exit 0; `git status --porcelain` → clean |

`docs/v1/plans/P58f-cutover.md` §7 is the criterion-by-criterion walkthrough, and `AGENTS.md`'s
"P58f implementation findings — cutover" section is its record. **P1 adds nothing to that work.**

### 0.2 Scope

1. Every entry in `package.json`'s `dependencies`, `devDependencies` and `scripts` (§1, §2).
2. Every direct require in `shell/go.mod` (§1).
3. Every file under `scripts/` (§2).
4. The repository's folder structure against the single-Go-backend / single-Vue-frontend shape (§3).
5. Removing what §1-§3 confirm is stale, and correcting the documentation of the script surface.

### 0.3 Not in this phase

- Re-implementing or re-verifying the P58f cutover (§0.1).
- Any rename for accuracy or style — `src/renderer`, `src/shared`, `tests/db`, `tsconfig.node.json`
  all keep their names (§7).
- Any behavior change, dependency *upgrade*, or new test.
- Editing `.github/workflows/*.yml` directly (D10, §7).

### 0.4 Ground rules

- **Every removal in §4 cites a finding in §1-§3, and every finding cites a command that was
  actually run.** Where the evidence is ambiguous, the finding says so and the decision is
  "investigate further during implementation" — never a verdict this plan does not have (F14).
- `AGENTS.md`'s standing rules apply: no stubs, comments only where the code cannot speak for
  itself, Conventional Commits, no new unit tests (nothing here clears that bar).
- Run the §5 verification block after **every** commit, not once at the end. Each commit in §4 is
  independently green.

---

## 1. Findings — dependencies

### F1 — Every `package.json` dependency is live. There is nothing to remove.

Method: for each entry, grep the post-cutover tree for a real import/require, a config-file
reference or a script invocation — excluding `node_modules/`, `bun.lock`, `docs/` (plan prose is not
usage) and the untracked `shell/runtime/` residue.

| Package | Bucket | Live? | Evidence |
|---|---|---|---|
| `zod` | `dependencies` | yes | 17 import sites across `src/shared/domain/*` and `src/renderer` |
| `@biomejs/biome` | dev | yes | `package.json` `lint`/`format`; `biome.json`'s `$schema` pins `2.5.10` |
| `@codemirror/autocomplete` | dev | yes | `src/renderer/editor/CodeMirrorHost.vue:7`, `views/console/completion.ts:1` |
| `@codemirror/commands` | dev | yes | `src/renderer/editor/CodeMirrorHost.vue:8` |
| `@codemirror/lang-json` | dev | yes | `src/renderer/editor/languages.ts:1` |
| `@codemirror/lang-sql` | dev | yes | `src/renderer/editor/languages.ts:2` |
| `@codemirror/lang-xml` | dev | yes | `src/renderer/editor/languages.ts:3` |
| `@codemirror/language` | dev | yes | 3 import sites under `src/renderer/editor/` |
| `@codemirror/lint` | dev | yes | `src/renderer/editor/CodeMirrorHost.vue:10` |
| `@codemirror/state` | dev | yes | 3 import sites under `src/renderer/editor/` |
| `@codemirror/view` | dev | yes | 3 import sites under `src/renderer/editor/` |
| `@lezer/highlight` | dev | yes | `src/renderer/editor/theme.ts:3` |
| `@playwright/test` | dev | yes | 42 import sites; `playwright.config.ts:1` |
| `@tailwindcss/vite` | dev | yes | `vite.config.ts:2,13` |
| `@tanstack/vue-virtual` | dev | yes | `views/grid/DataGrid.vue:4`, `views/console/ConsoleResultGrid.vue:3`, `views/shared/page/columns.ts:3` |
| `@testcontainers/kafka` | dev | yes | `tests/db/support/kafka.ts:2` → `tests/e2e-real/support/kafka.ts` → `mariadb-real.spec.ts:3,37` |
| `@testcontainers/mariadb` | dev | yes | `tests/db/support/mariadb.ts:3` → `tests/e2e-real/support/mariadb.ts:4` |
| `@testcontainers/postgresql` | dev | yes | `tests/db/support/postgres.ts:4` → `tests/e2e-real/support/postgres.ts:8` |
| `@types/node` | dev | yes | `tsconfig.node.json`'s `"types": ["node"]` |
| `@types/pg` | dev | yes | `pg@8.23.0` ships **no** types (`node_modules/pg/package.json` has no `types`/`typings` key, no `*.d.ts` at its root), and `tests/db/support/postgres.ts:5` does `import { Client } from 'pg'` inside `tsconfig.node.json`'s program |
| `@typescript/native-preview` | dev | yes | `typecheck:node`, `typecheck:unit` — see **F2** |
| `@vitejs/plugin-vue` | dev | yes | `vite.config.ts:3,13` |
| `@vscode/codicons` | dev | yes | `src/renderer/theme/base.css:2` — `@import "@vscode/codicons/dist/codicon.css"` |
| `@wailsio/runtime` | dev | yes | `tsconfig.web.json:20` maps `/wails/runtime.js` onto its `types/index.d.ts` |
| `bun-types` | dev | yes | `tests/unit/tsconfig.json:11` |
| `mariadb` | dev | yes | `tests/db/support/mariadb.ts:4` (`createConnection`, `importFile`) |
| `pg` | dev | yes | `tests/db/support/postgres.ts:5` |
| `simple-icons` | dev | yes | `src/renderer/theme/EngineIcon.vue:12`; also `NOTICES.md`'s only subject |
| `tailwindcss` | dev | yes | `src/renderer/theme/base.css:1` — `@import "tailwindcss"` |
| `testcontainers` | dev | yes | `tests/db/support/mariadb.ts:5` (`Wait`), `tests/db/fixtures/0005_kafka_seed.ts:1` |
| `typescript` | dev | yes | `vue-tsc`'s peer; provides `node_modules/.bin/tsc` (`5.9.3`) |
| `vite` | dev | yes | `package.json` `build`; `vite.config.ts:4` |
| `vue` | dev | yes | 87 import sites |
| `vue-tsc` | dev | yes | `typecheck:web` |

**The `tests/db/support/*` chain matters and is easy to get wrong.** `tests/db/` no longer holds
specs, but `tests/e2e-real/support/{postgres,mariadb,kafka,sqlite}.ts` re-export directly from
`tests/db/support/`, and `tests/e2e-real/{postgres,mariadb}-real.spec.ts` call `startPostgres()`/
`startMariadb()`/`startKafka()`. That single chain is what keeps `pg`, `mariadb`, `testcontainers`
and all three `@testcontainers/*` packages alive. It is also exactly the shape P58a's own finding
warned about (*"a plan's 'its only consumer' claim about a shared support file is a snapshot, not a
standing fact"*) — **re-run these greps at implementation time before removing anything, even
though this plan removes none of them.**

### F2 — `tsgo` verdict: the SPEC row's named example is **false as stated**. Keep it.

The claim to test: *"`tsgo` no longer does anything meaningful now that the toolchain has moved on."*

**(a) What `tsgo` actually typechecks.** `typecheck:node` runs it over `tsconfig.node.json`, whose
`include` is `src/shared/**/*.ts`, `playwright.config.ts`, `tests/e2e-real/**/*.ts`,
`tests/ui/**/*.ts`, `tests/db/support/**/*.ts`, `tests/ipc/**/*.ts` — **86 `.ts` files, 21 999
lines** (`find … -name '*.ts' | wc -l`, `… -exec cat {} + | wc -l`), plus `playwright.config.ts`.
`typecheck:unit` runs it over `tests/unit/tsconfig.json` — **12 files, 1 264 lines**.

**(b) Is it redundant with `vue-tsc`?** No. `typecheck:web` runs `vue-tsc` over
`tsconfig.web.json`, whose `include` is `src/renderer/**/*.{ts,vue}` and `src/shared/**/*.ts`. The
overlap is `src/shared` alone (27 files, 2 861 lines). **Exclusive to `tsgo`: 60 files / 19 138
lines under `tsconfig.node.json` (every `tests/` tier plus `playwright.config.ts`), and 12 files /
1 264 lines under `tests/unit/` — 72 files, ≈20 400 lines.** Nothing else typechecks them: not
`vue-tsc`, not Biome (a linter, not a type checker), not `bun test` (which strips types rather than
checking them). Dropping `tsgo` with no replacement silently removes ≈20 400 lines from
`bun run typecheck`, from `.githooks/pre-commit` (which runs `bun run lint` + `bun run typecheck`),
and from every CI job — live and staged alike.

**(c) Why a dev-preview package rather than plain `tsc`?** `docs/v1/plans/P0-foundations.md` D8/D9
records it: *"`bun add -d @typescript/native-preview` (binary `tsgo`) **and** `typescript@^5`
(required by `vue-tsc` and by Volar). If a stable `typescript@7` is published and `tsgo`'s job is
subsumed, that is a later cleanup."* `docs/ARCHITECTURE.md`'s Stack table still carries that
position as current: *"TypeScript 7 (native compiler) for `.ts` … converge on one toolchain once
`vue-tsc` runs on TS7."* `AGENTS.md`'s P57 findings add a second, still-live behavioural note
(`tsgo` applies a `"paths"` mapping to every file it reaches, where Bun's `mock.module` does not).
So it is a deliberate, still-documented choice, not vestige.

**(d) The narrower claim that *is* true, measured.** `typescript@5.9.3` is already installed, and
`node_modules/.bin/tsc` passes both of tsgo's projects identically today:

| Command | Result | Wall time (this container) |
|---|---|---|
| `bunx tsgo --noEmit -p tsconfig.node.json` | exit 0 | 0.75 s |
| `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json` | exit 0 | 3.45 s |
| `bunx tsgo --noEmit -p tests/unit/tsconfig.json` | exit 0 | 0.55 s |
| `./node_modules/.bin/tsc --noEmit -p tests/unit/tsconfig.json` | exit 0 | 2.60 s |

So `@typescript/native-preview` (31 MB across `@typescript/native-preview` +
`@typescript/native-preview-linux-x64`) *could* be dropped by repointing the two scripts at `tsc`,
at a cost of ≈4.75 s added to every `bun run typecheck` — i.e. to every commit, via the pre-commit
hook.

**Verdict.** The user's claim is false as written: `tsgo` is the sole typechecker for ≈20 400 lines
of real source. The reduction genuinely available underneath it is a *swap*, not a removal, and it
reverses a position `docs/ARCHITECTURE.md` still states as current. **P1 keeps `tsgo`** (D2) and
hands the swap to the user as an explicit question (§9 OQ-1) rather than deciding it inside a
staleness audit.

### F3 — `shell/go.mod`: all 24 direct requires are used; one is misclassified as indirect.

Method: `grep -rn --include='*.go' '"<module path>' shell/` for each direct require.

All 24 have live imports. Spot checks worth recording, because they are the ones that look
removable and are not: `github.com/aws/smithy-go` has exactly one import
(`internal/adapters/awscfg/errors.go`) and is load-bearing for AWS error shape matching;
`github.com/google/uuid` has exactly one (`internal/adapters/s3/transfer.go`);
`github.com/shirou/gopsutil/v4` has two (`internal/metrics/sampler.go`, `cmd/g1measure/main.go`);
`github.com/keybase/go-keychain` is `_darwin.go`-guarded (`internal/secrets/keyring_darwin.go`) and
therefore invisible to a Linux-only build but genuinely required; the five
`testcontainers-go/modules/*` each have exactly one importer under
`internal/adapters/testsupport/`.

**The one real change**: `go mod tidy` moves `github.com/twmb/franz-go/pkg/kmsg v1.13.1` out of the
`// indirect` block and into the direct require block, because
`internal/adapters/kafka/definition.go:13` imports it directly. Verified by running `go mod tidy` on
a copy and diffing (`go.sum` unchanged; `go.mod` diff is exactly that one line moving):

```
26a27
> 	github.com/twmb/franz-go/pkg/kmsg v1.13.1
98d98
< 	github.com/twmb/franz-go/pkg/kmsg v1.13.1 // indirect
```

Per the phase brief, indirect requires are Go's to manage — `go mod tidy` is the whole treatment,
and no indirect entry is hand-removed.

### F4 — `bun.lock` is clean; `node_modules/` and `shell/runtime/` on disk are not. Neither is a repo change.

`grep -c electron bun.lock` → **0**, and the lockfile's root block matches `package.json` entry for
entry. But this container's `node_modules/.bin/` still contains `electron`, `electron-builder`,
`electron-vite`, `electron-rebuild`, `esbuild`, `asar` …, and `shell/runtime/{node,engine}` still
holds a 123 MB Node binary and a 6 MB `engine.cjs` — all untracked (`git ls-files shell/runtime` is
empty; `node_modules/` is gitignored), all pre-cutover residue from a `bun install` that predates
the dependency deletions.

**This is a local hygiene note, not a commit.** The implementing session may
`rm -rf node_modules shell/runtime && bun install` to get a tree that matches the lockfile; nothing
in the repository changes either way. Worth knowing because a stale `node_modules` makes a
"still installed, therefore still used" reading of the tree wrong.

---

## 2. Findings — scripts

### F5 — Every `package.json` script has a live consumer. One has no CI job.

| Script | Consumer(s) |
|---|---|
| `prepare` | `bun install` lifecycle → `.githooks/pre-commit` |
| `predev` / `dev` | developer entry point; `docs/PACKAGING.md` §1 |
| `build` | `dev`, `test:ui`, `test:ipc:fe`, live + staged `ci.yml`, `tests/e2e-real/fixtures.ts`'s `buildPrerequisites()` |
| `lint` / `format` | `.githooks/pre-commit`; live + staged `ci.yml`/`release.yml` |
| `typecheck` (+ `:node`, `:web`, `:unit`) | `.githooks/pre-commit`; live + staged `ci.yml`/`release.yml` |
| `test:ui` | staged `ci.yml`'s `ui` job |
| `test:ipc:fe` | **no CI job, live or staged.** Referenced only by `AGENTS.md:135` and `README.md:188` |
| `test:unit` | live `ci.yml:69`; staged `ci.yml`'s `container-tests` job |
| `test:go` | staged `ci.yml`'s `checks` and `container-tests` jobs |
| `package` | staged `ci.yml`/`release.yml`; `scripts/verify-packaging.sh`'s S5 check greps for it |
| `verify:packaging` | live `ci.yml:30,94`, `release.yml:50`; staged equivalents |

`playwright.config.ts` defines three projects — `ui`, `ipc-frontend`, `e2e-real`. Two have scripts
(`test:ui`, `test:ipc:fe`); `e2e-real` deliberately has none, because `AGENTS.md`'s Docker section
requires it to be launched through plain Node (`node node_modules/.bin/playwright test
--project=e2e-real`), never `bunx`.

**Nothing here is stale.** The `test:ipc:fe` gap is a *CI coverage* gap, not dead weight — the tier
is 13 live files under `tests/ipc/`. D9 records it as an optional one-line addition to the staged
`ci.yml`; it is explicitly not a removal.

### F6 — `scripts/*.sh`: all three are referenced and all three match the Wails-only shape.

| File | Referenced by | Post-cutover shape? |
|---|---|---|
| `scripts/wails-dev-setup.sh` | `predev`; `docs/PACKAGING.md` §1; `AGENTS.md` | **Yes.** Its own header records the P58f revision (*"there is no vendored Node runtime or bundled engine to check for any more"*), and it checks exactly two things: the pinned `wails3` version read out of `shell/go.mod`, and `shell/frontend/bindings`. No Node, no engine bundle. |
| `scripts/sign-bundle.sh` | `package` | **Yes.** Header records the P58f revision; the body is one `codesign --force --deep --sign -` plus a `--verify` over `shell/bin/Kira Studio.app` — the Wails bundle path, no nested `runtime/node` target. |
| `scripts/verify-packaging.sh` | `verify:packaging` | **Mostly.** See below. |

Two blemishes in `verify-packaging.sh`, neither of which justifies deleting a check:

1. Its header says *"Static checks (S1-S5) always run"*, but only **S1, S2 and S5** exist — S3 and
   S4 were the `electron-builder.yml` checks removed in the P57 rewrite, and the numbering was never
   closed up. Prose inaccuracy; D6 fixes the sentence, keeps the check IDs (renumbering them would
   break the cross-references in `docs/PACKAGING.md`).
2. S1/S2 still grep for `electron-updater` / `update-electron-app` / `autoUpdater`. Those names are
   Electron-era, but the *property* they assert — "v1 ships no auto-update" — is still real, still
   named in `docs/PACKAGING.md` §7 and `README.md`'s "Not in v1", and has **no Wails-side
   equivalent** to replace them with. Two `grep`s costing microseconds are a cheaper guard than
   nothing. **Explicitly declined as a removal** (D6); recorded so the next auditor does not
   re-litigate it.

One thing that is *not* stale but is worth an implementer's eye: S5 shells out to `node -p` to read
`package.json`. `node` is not part of this repo's declared toolchain any more (`README.md` used to
justify it via Electron's embedded Node; `docs/ARCHITECTURE.md` now says Bun is *"tooling only"*).
It works on every GitHub macOS/Ubuntu runner and in this container (`node v22.22.2`), so this is a
latent portability wart, not a break. **Investigate further during implementation**: if `bun -e`
or a `grep` substitutes cleanly, take it; if not, leave it and say so. Do not change it blind.

### F7 — `scripts/demo-dbs/` is live. One stale sentence inside it.

18 files across ten engine directories plus `docker-compose.yml`, `seed.sh` and `README.md`.
Referenced from `README.md:193,224,245` and reachable via `bash scripts/demo-dbs/seed.sh`. All ten
engines the app supports have a directory; `sqlite/seed.ts` runs under `bun` with `node:sqlite` and
needs no container (P35 D36), and its output is gitignored (`.gitignore`'s
`scripts/demo-dbs/sqlite/*.sqlite`). Nothing in it references `src/engine`, the vendored runtime, or
a deleted script.

One stale line: `scripts/demo-dbs/README.md:14` says Kafka *"uses the same image/mode as the
`@testcontainers/kafka` harness under `bun run test:db`"*. `test:db` has not been a script since
P58f. D7 repoints it at `bun run test:go` / `tests/db/support/kafka.ts`, which is what that harness
is today. **No file under `scripts/demo-dbs/` is deleted.**

### F8 — `README.md`'s Development and Tests sections describe a `package.json` that no longer exists.

This is the largest stale surface the script audit turns up, and it is squarely downstream of it:
`README.md` is the only human-facing documentation of the `scripts` block, and it documents eight
scripts that are not in it.

Confirmed line by line against the live `package.json`:

| `README.md` | Claim | Reality |
|---|---|---|
| `:144` | `bun run build` → *"Production build into `out/`"* | `vite.config.ts:32` → `shell/frontend/dist` |
| `:145` | `bun run start` | **no such script** |
| `:148` | *"Runs all four splits below"* | three splits (`:node`, `:web`, `:unit`) |
| `:149` | `typecheck:node` → *"main + engine + preload"* | `src/shared` + every `tests/` tier + `playwright.config.ts` (F2) |
| `:151` | `bun run typecheck:db` → `tests/db` + `tests/electron-db` | **no such script; no such directories** |
| `:153` | `bun run test:db` | **no such script** |
| `:155` | `bun run test:e2e` | **no such script** |
| `:156` | `bun run test:ipc` | **no such script** (only `test:ipc:fe`) |
| `:157-158` | `package:mac`, `package:mac:dir` | **no such scripts** (`package`) |
| `:117,121` | Install via `bun run package:mac`, artifacts in `dist/mac-arm64/` | `bun run package` → `shell/bin/Kira Studio.app`; nothing lands in `dist/` (`docs/PACKAGING.md` §1) |
| `:171` | *"Five suites … `unit/`, `db/`, `electron-db/`, `ipc/`, `e2e/`"* | four directories, none named `electron-db` or `e2e`: `unit/`, `db/` (fixtures only), `ipc/`, `ui/`, `e2e-real/` |
| `:182-184` | `tests/electron-db/`, `bun run test:db:kafka`, Electron's Node ABI | all gone with P57/P58 |
| `:186-191` | `test:ipc:be`, *"no Electron renderer"*, `test:e2e` under `xvfb-run` | `test:ipc:be` is gone (the backend half is Go: `shell/internal/ipcfixture`); `AGENTS.md:133` records that no tier needs `xvfb` |
| `:138` | `bun run dev` → *"electron-vite dev"* | `bun run build && cd shell && wails3 task dev` |
| `:159` | `verify:packaging` → *"the packaging config"* | there is no packaging config file; it asserts properties of the bundle |
| `:131,237` | *"the electron-builder config"* | deleted in P57 M7 (`docs/PACKAGING.md` opening) |

For contrast, `docs/ARCHITECTURE.md` and `docs/PACKAGING.md` **were** brought current by P58f M11
(both open with explicit post-cutover statements). `README.md` was missed. D8 fixes exactly the
script-surface half of it — the Requirements/Install/Development/Tests sections and the top-level
layout block — and leaves the rest to §7/§9, because rewriting README's engine table, Features list
and Architecture prose is a documentation phase, not a script audit.

### F9 — `shell/README.md` names three entry points that no longer exist, and `shell/main.go` names one.

`shell/README.md` (18 lines, last meaningfully touched in the P52 era):

- `:8` and `:11` — *"the repo root's `bun run build:wails` (see `../vite.wails.config.ts`)"*. Neither
  the script nor the file exists (`ls vite*.config.ts` → `vite.config.ts` only). This is the exact
  trap `AGENTS.md`'s P58b findings already recorded once (*"`tests/e2e-real/fixtures.ts` was calling
  a `bun run build:wails` script that no longer existed"*).
- `:12` — `sh scripts/vendor-node.sh`, deleted in P58f M10 (`docs/PACKAGING.md` opening line).
- `:3-5` — *"being built to replace Electron's `src/main`/`src/preload`"* — done, two chapters ago.
- `:18` — the `shell/blank/` + `shell/cmd/g1measure/` sentence is still **accurate** (F18).

`shell/main.go:42` carries the same dead reference in a comment: *"built by `bun run build:wails`
from `src/renderer`"*. D8 fixes both.

### F10 — The live workflows are Electron-era and unfixable from this session; the staged replacements carry two staleness items of their own.

`.github/workflows/{ci,release}.yml` reference `bun run test:e2e`, `bun run test:db`,
`bun run package:mac`, `bun run package:mac:dir`,
`app.asar.unpacked/out/main/engine.js`, `dist/mac-arm64/`, `dist/*.blockmap`, `dist/*.dmg` and
`safeStorage` — none of which exist. That is two generations stale, exactly as
`AGENTS.md`'s P57 findings and `docs/v1/plans/p58-pending-ci-workflows/README.md` record.

**This session cannot fix them**: its push token lacks the `workflow` OAuth scope, and GitHub
rejects any commit touching `.github/workflows/*.yml` outright. The staged replacements in
`docs/v1/plans/p58-pending-ci-workflows/` are the mechanism, and they already cover everything this
audit would need there. **P1 must not edit `.github/workflows/*.yml`** (D10).

Two items *inside* the staged files are fair game, since that directory is ordinary `docs/` content:

1. `p58-pending-ci-workflows/release.yml:48-50` still sets `KIRA_STRICT_UPDATE_CHECK: '1'` for the
   `verify:packaging` step. **`scripts/verify-packaging.sh` no longer reads that variable at all**
   (`grep -c KIRA_STRICT_UPDATE_CHECK scripts/verify-packaging.sh` → 0) — the strict-mode branch went
   with the electron-builder checks in the P57 rewrite. A workflow setting an env var nothing reads
   is exactly the kind of stale reference this audit exists to catch, and it will silently mislead
   whoever eventually applies the file. D9 removes the `env:` block and rewords the step name.
2. Neither staged workflow runs `bun run test:ipc:fe` (F5). D9 makes adding it optional, with the
   reasoning, rather than mandatory — it is a coverage decision, not a staleness fix.

Nothing this plan removes is referenced by either the live or the staged workflows. (Checked
directly: neither file mentions `tsgo`, `@typescript/native-preview`, `src/shared/format.ts`,
`vite-raw.d.ts`, the root `build/` directory, or any `shell/build/Taskfile.yml` task by name.)

---

## 3. Findings — folder structure

The shape being audited against: **one Go backend (`shell/`) + one Vue frontend (`src/renderer`)**,
where the tree was built for Electron main (`src/main`) + preload (`src/preload`) + renderer
(`src/renderer`) + a Node engine sidecar (`src/engine`) + the Go shell. P58f deleted the first,
second and fourth of those.

### F11 — `src/renderer` and `src/shared` both still earn their place. Neither is folded or renamed.

**`src/`'s whole content today** (`find src -maxdepth 2 -type d`): `src/renderer` (with
`assets/ bridge/ editor/ project/ shortcuts/ state/ theme/ views/ workbench/`) and `src/shared`
(with `domain/ protocol/`). No orphan third directory survived the cutover.

**Is `src/shared` still shared?** Consumer counts for `@shared/*` specifiers:

| Tree | `@shared/` import sites |
|---|---|
| `src/renderer` | 148 |
| `tests/ui` | 53 |
| `tests/db` | 4 |
| `tests/unit` | 3 |
| `tests/ipc` | 1 |
| `shell/` (Go) | **0 imports** — but **10+ Go files cite `src/shared/…` paths as their source of truth** |

So it is no longer shared between two *runtimes* — it is shared between the frontend, five test
tiers, and (by hand-maintained mirror, not by import) the Go backend. That last row is the reason to
keep it as its own top-level directory rather than folding it under `src/renderer`:
`shell/internal/page/chunk.go:1`, `internal/shell/accel.go:5,37`, `internal/oplog/wire.go:27`,
`internal/adapterhost/dataframe.go:94`, `internal/secrets/status.go:7`,
`internal/storage/model/tabs.go:5`, `internal/metrics/sampler.go:18`,
`internal/ipcfixture/channels.go:10,23` all name a `src/shared/...` file as the definition their Go
code mirrors. `src/shared` is the wire-protocol and domain contract the Go side is written against;
burying it inside the frontend would erase that signal for a purely cosmetic gain, and would rewrite
209 import specifiers, four tsconfig `paths` blocks and `vite.config.ts`'s alias to do it.
**Verdict: keep, unchanged.**

**Is `src/renderer` still an accurate name?** *"Renderer"* is Electron vocabulary — the process
paired with a *main* process that no longer exists. The name is inaccurate; whether that makes it
*stale in the SPEC's sense* is a different question, and the answer is no: the directory serves its
purpose exactly, and SPEC's own wording scopes this section to *"stale folders or structural
constructs … that no longer serve a purpose."* A rename is a rename. Blast radius, measured so the
decision is informed rather than hand-waved: **27 files outside `src/renderer` name the path as a
string** (`vite.config.ts`'s `root`, `tsconfig.web.json`'s `include`, `tests/unit/tsconfig.json`'s
`include`, `biome.json`'s two `noRestrictedImports` override globs at `:65,:104` plus the 20+ import
patterns inside them, 5 Go comments, 6 `tests/ui/` support files, 8 `tests/unit/` specs that import
`../../src/renderer/…` relatively, `README.md`, `NOTICES.md`, `shell/README.md`). Mechanically safe,
zero functional effect, real review churn — and P2's round-1 subagent (architecture and structure)
is the phase whose remit this actually is, against a tree P1 has already narrowed.
**Verdict: keep the name in P1; recorded as §9 OQ-2.**

### F12 — Two genuinely dead TypeScript modules under `src/shared`, both casualties of `src/engine`'s deletion.

Found by enumerating every `src/shared/**/*.ts` and counting importers of its `@shared/…` specifier
across `src/`, `tests/` and `shell/frontend/`. Every module has importers except two:

1. **`src/shared/format.ts`** (22 lines) — exports one function, `abbreviateCount`.
   `grep -rn abbreviateCount src tests` returns **exactly one hit: its own definition line**. Its
   consumer was the tree's row-estimate badge, which is now built in Go —
   `shell/internal/adapters/postgres/catalog.go:416` and
   `shell/internal/adapters/sqlite/catalog.go:574` each carry their own comment
   *"mirrors `@shared/format`'s abbreviateCount"*. Note the near-miss that makes this look alive to a
   careless grep: `src/renderer/format.ts` is a **different file** exporting `formatBytes`, imported
   by five components via a relative `'../format'`. Neither Biome nor `tsgo` flags
   `src/shared/format.ts`, because an exported symbol in an unimported module is not an unused
   binding — no tool in this repo does cross-module dead-export analysis. **Delete.**
2. **`src/shared/vite-raw.d.ts`** (4 lines) — `declare module '*.sql?raw'`. `grep -rn '?raw' src tests`
   returns **only that declaration**; no file anywhere imports a `.sql?raw` specifier. It existed for
   the SQL files the deleted backend loaded through Vite's `?raw` suffix. The four `.sql` paths that
   remain in the tree (`tests/db/support/*.ts`, `shell/internal/adapters/testsupport/*.go`) are all
   read at runtime with `resolve()`/`filepath.Join` + a file read, never imported. **Delete.**

Both are deleted by D3. `bun run typecheck` and `bun run build` are the proof (an ambient `.d.ts`
that something silently depended on would fail `typecheck:node`/`typecheck:web` immediately).

### F13 — The root `build/` directory is a byte-identical duplicate of artwork that already lives under `shell/build/`.

`git ls-files build` → `build/icon.png`, `build/icon.svg`. Nothing else. Checksums:

```
6e715087f4bbcda5a225d1f2fa91ef17  build/icon.png
6e715087f4bbcda5a225d1f2fa91ef17  shell/build/appicon.png
cde04e37ff31927bab728fd7a2b68e67  build/icon.svg
cde04e37ff31927bab728fd7a2b68e67  shell/build/appicon.icon/Assets/kira_icon_vector.svg
```

Both pairs are identical, and both files entered the tree in the same commit
(`efa5c1b feat(packaging): wire up a real app icon`, the only commit that has ever touched `build/`).

**No tooling reads the root `build/`.** `shell/build/Taskfile.yml`'s `generate:icons` and
`update:build-assets` both declare `dir: build`, which resolves **relative to `shell/`** (the
Taskfile is included from `shell/Taskfile.yml`) — i.e. `shell/build`, not the root. The only
reference anywhere is prose: `docs/PACKAGING.md:223` records that `shell/build/appicon.png` and
`appicon.icon/Assets/kira_icon_vector.svg` *"were swapped from Wails' scaffolded default to
`build/icon.png`/`build/icon.svg` (the app's real icon)"*.

So the root `build/` is a top-level directory named for a build output, which produces nothing,
which duplicates two tracked files verbatim, and which exists only as the historical origin of a
copy — the electron-builder-era convention (`build/icon.png` is electron-builder's default resources
path) outliving the tool that gave it meaning. Deleting it loses no information: the vector source
is retained byte-for-byte under `shell/build/appicon.icon/Assets/`, which is also what
`wails3 generate icons` actually consumes. **Delete, and reword the one `docs/PACKAGING.md`
sentence** (D4). If the implementer would rather keep a designated artwork-source location, that is
a defensible call — say so in the commit message and skip D4's deletion half; do not keep it
silently.

### F14 — `shell/build/Taskfile.yml` still assumes `shell/frontend/` is its own npm project. One task is certainly dead; a second chain needs investigating, not deleting.

`shell/frontend/` contains exactly two entries: `bindings/` and `dist/` — **both generated, both
gitignored** (`shell/.gitignore`: `frontend/dist`, `frontend/bindings`, `frontend/node_modules`).
There is **no `shell/frontend/package.json`**. This repo builds its one frontend from the repo root
(`bun run build` → `vite build` → `outDir: shell/frontend/dist`, `vite.config.ts:32`), which is
precisely the single-frontend shape the SPEC row describes — but the Wails scaffolded Taskfile that
came with `wails3 init` still describes the stock two-project shape, where `frontend/` is an npm
package with its own `dev`/`build` scripts.

**Certainly dead — delete (D5):** `frontend:vendor:puppertino` (`:139-170`). Nothing lists it in any
`deps:` or `cmds:` (`grep -n puppertino shell/build/*.yml shell/build/darwin/*.yml
shell/Taskfile.yml shell/build/config.yml` finds hits only inside the task's own body). It
`curl`s a third-party CSS framework from `raw.githubusercontent.com` at build time into
`frontend/public/puppertino/` (a directory that does not exist), then `awk`/`sed`-rewrites
`frontend/index.html` (a file that does not exist) to inject a stylesheet link and rewrite button
classes. It is Wails template boilerplate for a mobile-styled starter app, it can never do anything
useful here, and it is a live network fetch inside a build. Deleting it removes 32 lines and one
supply-chain surface.

**Needs investigating — do not delete blind:** `install:frontend:deps` and its four
package-manager variants, `build:frontend`, `frontend:run` + its four variants, `dev:frontend`,
`frontend:dev:*`. All of these `dir: frontend` into a directory with no `package.json`. They are not
orphans on paper:

- `shell/build/darwin/Taskfile.yml`'s `build:native` **and** `build:docker` both declare
  `deps: - task: common:build:frontend`, so `wails3 task darwin:package` (what `bun run package`
  runs) reaches it.
- `build:frontend` in turn declares `deps: - task: install:frontend:deps`, which dispatches on
  `PACKAGE_MANAGER`, whose default in `shell/Taskfile.yml:6` is **`npm`** — so a cold run would try
  `npm install` then `npm run build -q` inside `shell/frontend/`.
- `shell/build/config.yml`'s `dev_mode.executes` runs `wails3 task common:dev:frontend` as a
  background command, which reaches `frontend:dev:npm` → `npm run dev --port 9245 --strictPort` in
  the same non-existent project. `bun run dev` goes through this path.

Whether that is harmless or broken depends on Task's up-to-date fingerprinting: `build:frontend`
declares `sources: **/*` (in `frontend/`) and `generates: dist/**/*`, and `shell/frontend/dist`
already exists because the root `vite build` wrote it — so Task may skip the task entirely and never
reach `npm`. **This cannot be settled from this sandbox**: there is no macOS hardware, `wails3` is
not installed here, and `docs/PACKAGING.md` §6 records that *"every item in §4 is unrun — no macOS
hardware has been available."* Corroborating evidence that it has never run: `shell/.task/checksum/`
contains exactly one file, `common-generate-icons` — no `common-build-frontend` fingerprint has ever
been written in this tree.

**Decision: investigate, do not remove (D5).** The implementing session should run
`wails3 task -x darwin:build --dry` (or `wails3 task --list-all` plus a real
`bun run package`, if it has macOS) and record what actually happens. If `build:frontend` is skipped
by fingerprint, that is a latent trap worth a three-line comment in the Taskfile, not a deletion. If
it fails, that is a **packaging bug** and belongs to whoever next has macOS — not to a staleness
audit. Either way, removing a task that a build path declares as a dependency, without being able to
run that build path, is exactly the guess this plan's ground rules forbid.

### F15 — `shell/build/config.yml` carries three Wails scaffold placeholders.

1. `:13` — `comments: "Kira Studio native shell (P52 walking skeleton)"`. Ships into the bundle's
   metadata via `wails3 task common:update:build-assets`. It has not been a walking skeleton since
   P56. **Reword** (D5).
2. `:64-66` — the `other:` block, whose entire content is the literal Wails template placeholder
   `- name: My Other Data`. **Delete** (D5).
3. `:20-33` and `:47-58` — the commented-out `ios:` block and the commented-out `fileAssociations:`
   examples, including a `https://v3.wails.io/noit/done/yet` URL. These are scaffold comments in a
   config file whose header tells you to run `update:build-assets` after editing it. Harmless, and
   trimming a generated-file's comments risks a diff the next `update:build-assets` reverts.
   **Explicitly declined**; recorded so it is not re-raised.

### F16 — `out/`, and the `.gitignore` / `biome.json` entries that name it. Declined, with reasoning.

`out/` exists on disk and is untracked (`git ls-files out` → empty). Its contents are pure
pre-cutover residue: `out/tests/ipc/mariadb.backend.spec.cjs` (an esbuild bundle of a
`*.backend.spec.ts` that P58f D13 deleted) and copies of `tests/db/fixtures/`, including
`0003_mongo_seed.ts`, `0004_redis_seed.ts` and `0006_sqs_seed.ts`, three fixtures that no longer
exist in the repository at all. Nothing writes `out/` today — `vite.config.ts` writes
`shell/frontend/dist`, and `README.md:144`'s *"Production build into `out/`"* is one of F8's stale
claims. A local `rm -rf out` is a developer convenience; there is nothing to commit.

`.gitignore`'s `out` line comes from the stock GitHub Node template's Next.js block
(`# Next.js build output` / `.next` / `out`), not from any tool this repo ever used, and
`biome.json`'s `"!out"` / `"!dist"` sit alongside `"!node_modules"`, `"!test-results"`,
`"!playwright-report"` — all of which are *also* already excluded by `vcs.useIgnoreFile: true`.
Removing them is churn with a nonzero chance of un-excluding a path Biome currently skips (glob
semantics for `!dist` versus `shell/frontend/dist` are not obvious from the config alone).
**Explicitly declined.** The same applies to the rest of `.gitignore`'s boilerplate (`.next`,
`.nuxt`, `.docusaurus`, `bower_components`, …): stock-template lines that were never about this
repo's shape, and therefore out of scope for an audit the SPEC scopes to *"leftovers of the
two-backend/two-framework shape."*

### F17 — Every tsconfig `include` glob resolves. No stale path anywhere in the TS project graph.

Checked path by path:

- `tsconfig.json` — `files: []` plus three `references`; all three project files exist.
- `tsconfig.node.json` — all six `include` globs resolve to real files
  (`src/shared` 27, `playwright.config.ts` 1, `tests/e2e-real` 9, `tests/ui` 32, `tests/db/support`
  5, `tests/ipc` 13).
- `tsconfig.web.json` — `src/renderer/**/*.{ts,vue}` (178 files) + `src/shared/**/*.ts`; the
  `paths` entry `"/wails/runtime.js" → node_modules/@wailsio/runtime/types/index.d.ts` resolves.
- `tests/unit/tsconfig.json` — `**/*.ts` (12 files) + `../../src/renderer/env.d.ts` (exists).
- All three `paths` aliases (`@shared/*`, `@bindings/*`, `@bindings-internal/*`) resolve, and match
  `vite.config.ts`'s `resolve.alias` exactly.

`tsconfig.node.json`'s *name* is Electron-era in the same way `src/renderer` is — it is now "the
non-DOM TypeScript project", not "the Node-process project". Same verdict as F11: a rename, not a
staleness removal. Not done here; §9 OQ-2 covers it alongside `src/renderer`.

### F18 — Non-findings, recorded so the next auditor does not re-derive them.

- **`tests/db/`** — name is misleading (it holds no specs), but it is live: `fixtures/*.sql` are read
  by literal path from five Go files under `shell/internal/adapters/testsupport/`, and
  `support/*.ts` are re-exported by `tests/e2e-real/support/`. `AGENTS.md` and
  `docs/ARCHITECTURE.md` both already document what it became. Renaming it would mean editing Go
  path literals. **Keep.**
- **`shell/blank/index.html`** — not scaffolding residue: it is `//go:embed`ed by `shell/main.go:52`
  and served when `KIRA_G1_BLANK=1`, documented in `docs/PERF.md` §335. **Keep.** (Its comment still
  describes measuring *"the vendored Node child"*, and it calls `Call.ByID(3273072800)` where the
  generated bindings now use `Call.ByName` — an accuracy question for P3/P5, who will actually run
  it. Recorded as §9 OQ-3, not touched here.)
- **`shell/cmd/g1measure/`** — a real, working RSS-measurement tool (`go build ./cmd/...` exits 0)
  that reads its needles from `internal/metrics`. P3 (RAM usage) and P5 (CPU/memory readout) are the
  next two phases in this chapter and are exactly its subject. **Keep.**
- **`shell/internal/appcore/`** — one file (`deps.go`), but a real package with real importers.
  Single-file packages are normal Go. **Keep.**
- **`shell/build/.task/unused-icon.ico`** — untracked (`git ls-files shell/build` does not list it),
  and deliberate: `generate:icons`' own summary explains that `wails3 generate icons` always writes a
  Windows icon and this redirects it out of the way. **Keep.**
- **`zod` sitting in `dependencies` while every renderer library sits in `devDependencies`** — the
  bucket distinction was electron-builder's (`dependencies` = what ships in `node_modules`). Nothing
  installs `node_modules` at runtime now, `bun install --frozen-lockfile` installs both, and no
  script uses `--production`. Moving it is a zero-effect edit. **Explicitly declined.**
- **`src/renderer/**/*.ts` orphan scan** — every `.ts` under `src/renderer` has an importer except
  `main.ts`, which is the Vite entry (referenced from `src/renderer/index.html`). No orphans.
- **`tests/**/*.ts` non-spec orphan scan** — every support module has a consumer except
  `tests/ui/global.d.ts`, which is an ambient `Window` augmentation picked up by
  `tsconfig.node.json`'s `tests/ui/**/*.ts` glob; all three hooks it declares are both assigned
  (`src/renderer/main.ts:49-58`) and read (`tests/ui/{perf,leaks}.spec.ts`). **Keep.**

---

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **No `package.json` dependency is removed, and none is moved between buckets.** | F1: all 31 entries have a live consumer. F18: the `dependencies`/`devDependencies` split has no effect post-Electron. An audit whose honest result is "nothing to remove" says so rather than manufacturing a deletion. |
| **D2** | **`tsgo` (`@typescript/native-preview`) stays. `typecheck:node` and `typecheck:unit` are unchanged.** The SPEC row's named example is recorded as investigated-and-false in `AGENTS.md`, with F2's numbers. | F2: it is the sole typechecker for 72 files / ≈20 400 lines that `vue-tsc` never sees. The available alternative — repoint both scripts at the already-installed `tsc` and drop the package — is a toolchain-policy change that contradicts `docs/ARCHITECTURE.md`'s Stack table and costs ≈4.75 s on every pre-commit. That is a decision for the user (§9 OQ-1), not for a staleness audit. |
| **D3** | **Delete `src/shared/format.ts` and `src/shared/vite-raw.d.ts`.** | F12: zero importers each, confirmed by exhaustive grep; both died with `src/engine`; neither is visible to Biome or `tsgo` as dead. |
| **D4** | **Delete the root `build/` directory (`build/icon.png`, `build/icon.svg`) and update `docs/PACKAGING.md:223`'s provenance sentence.** | F13: byte-identical duplicates of two tracked files under `shell/build/`; no tooling reads the root path; an electron-builder-era convention outliving its tool. |
| **D5** | **In `shell/build/`: delete the `frontend:vendor:puppertino` task; delete `config.yml`'s `other:` placeholder block; reword `config.yml`'s `comments:` line. Leave every other Taskfile task alone and record F14's open question in the plan's §9.** | F14/F15: puppertino is unreferenced, targets non-existent paths and fetches third-party CSS mid-build. The `install/build/dev:frontend` chain *is* referenced by `darwin:build:native`'s `deps`, and whether it is skipped by fingerprint or would fail cannot be determined without macOS (`shell/.task/checksum/` shows it has never run here) — so it is investigated, not removed. |
| **D6** | **In `scripts/verify-packaging.sh`: fix the "S1-S5" header sentence to name the checks that exist (S1, S2, S5). Keep S1 and S2 as they are.** No check IDs are renumbered. | F6: the prose is wrong, the checks are not. S1/S2 assert a property (`no auto-update in v1`) that is still real and has no Wails-side substitute; `docs/PACKAGING.md` cross-references the IDs. |
| **D7** | **Fix `scripts/demo-dbs/README.md:14`'s `bun run test:db` reference.** No file under `scripts/demo-dbs/` is deleted. | F7: one stale script name in an otherwise-live, documented developer tool. |
| **D8** | **Bring the *script surface* of `README.md` current (Requirements, Install, Development table, Tests, the top-level layout block, and the three Electron-shell sentences those sections rest on), and fix `shell/README.md` and `shell/main.go:42`.** Leave README's engine table, Features list and per-engine footnotes alone. | F8/F9: `README.md` is the only human-facing documentation of the `scripts` block and it documents eight scripts that do not exist, four directories that do not exist, and a `dist/` output path nothing writes. `docs/ARCHITECTURE.md` and `docs/PACKAGING.md` were brought current by P58f M11; README was missed. Bounding it to the script surface keeps this an audit; a full README accuracy pass is its own phase (§9 OQ-4), the same bound `docs/v1/plans/P45-docs-cleanup.md` D67 set for the same file. |
| **D9** | **In `docs/v1/plans/p58-pending-ci-workflows/release.yml`: remove the `KIRA_STRICT_UPDATE_CHECK` `env:` block and reword the step name. Update that directory's `README.md` to say P1 revised it.** Adding a `test:ipc:fe` step to the staged `ci.yml` is **optional** and, if taken, gets its own line in that README. | F10: `verify-packaging.sh` no longer reads that variable, so the staged file would ship a misleading env var whenever it is finally applied. The staged directory's own README instructs later phases to revise **in place** and update the generation count — this follows that instruction. F5: the `test:ipc:fe` gap is coverage, not staleness. |
| **D10** | **Nothing in P1 touches `.github/workflows/*.yml`.** | F10: this session's token lacks the `workflow` OAuth scope and GitHub rejects such commits outright; `AGENTS.md` records the same rejection twice. Nothing P1 removes is named by either live workflow, so no staged change beyond D9 is owed. |
| **D11** | **Run `go mod tidy` and commit its result — the `kmsg` promotion.** No indirect require is hand-edited. | F3: `internal/adapters/kafka/definition.go:13` imports it directly. The phase brief's own rule: indirect deps are Go's to manage. |
| **D12** | **`src/renderer`, `src/shared`, `tests/db`, `tsconfig.node.json` keep their names and locations.** | F11/F17/F18: each still serves its purpose; each rename is a rename, and SPEC scopes this section to constructs that *no longer serve a purpose*. Blast radius is measured in F11 and handed to §9 OQ-2 for P2's architecture round. |

---

## 5. Implementation order

Seven commits. Every one is independently green under §6's verification block — run it after each,
not once at the end.

### C1 — `chore(deps): promote franz-go/pkg/kmsg to a direct require` (D11)

```sh
cd shell && go mod tidy
```

Expected diff: `shell/go.mod` only, one line moving out of the `// indirect` block into the direct
block. `go.sum` unchanged. **If `go mod tidy` produces anything else, stop and read it** — an
unexpected removal means a build tag hid an importer from the audit, and this plan's F3 is wrong.

Verify: `cd shell && go build ./internal/... ./cmd/... && go vet ./internal/... ./cmd/... && go test ./internal/storage/... ./internal/adapterhost/...`

### C2 — `refactor: delete two dead src/shared modules` (D3)

```sh
rm src/shared/format.ts src/shared/vite-raw.d.ts
```

Verify: `bun run lint && bun run typecheck && bun run build && bun run test:unit`.
`bun run typecheck` is the real proof here — an ambient `.d.ts` that something depended on fails
`typecheck:node`/`typecheck:web` immediately, and an unnoticed importer of `@shared/format` fails
the same way.

### C3 — `chore: delete the duplicated root build/ icon directory` (D4)

```sh
git rm -r build
```

Then update `docs/PACKAGING.md:223`'s sentence: it currently says the Wails assets *"were swapped
from Wails' scaffolded default to `build/icon.png`/`build/icon.svg` (the app's real icon)"*. Reword
so it names the surviving files (`shell/build/appicon.png`,
`shell/build/appicon.icon/Assets/kira_icon_vector.svg`) as the artwork itself, and records that the
duplicate root copies were removed in P1. Everything else in that paragraph — the `Assets.car`
staleness, the `icon.json` change, the "re-run on real macOS" instruction — stays exactly as
written.

Verify: §6's block, plus `grep -rn '\bbuild/icon' . --exclude-dir=node_modules --exclude-dir=.git`
returns nothing outside `docs/v1/` (which is history and is never retro-edited —
`docs/v1.1/README.md`).

### C4 — `chore(build): drop Wails scaffold leftovers from shell/build` (D5)

1. Delete `shell/build/Taskfile.yml`'s `frontend:vendor:puppertino` task in full (`:139-170`,
   through the blank lines before `generate:bindings`).
2. Delete `shell/build/config.yml`'s trailing `other:` block (`# Other data` / `other:` /
   `  - name: My Other Data`).
3. Reword `shell/build/config.yml:13`'s `comments:` value — drop "(P52 walking skeleton)". Suggested:
   `comments: "Kira Studio — a visual database client for macOS"`.

Do **not** touch `install:frontend:deps*`, `build:frontend`, `frontend:run*`, `dev:frontend`,
`frontend:dev:*`, `generate:bindings`, `generate:icons`, `go:mod:tidy` or `update:build-assets`
(F14).

Verify: `cd shell && wails3 task --list-all` (if `wails3` is installed — `sh scripts/wails-dev-setup.sh`
installs the pinned version) exits 0 and no longer lists `common:frontend:vendor:puppertino`;
otherwise a YAML parse check (`bunx js-yaml shell/build/Taskfile.yml >/dev/null` or `python3 -c
"import yaml,sys; yaml.safe_load(open('shell/build/Taskfile.yml'))"`) plus §6's block. **Do not run
`wails3 task common:update:build-assets`** — its own header warns it overwrites the generated assets,
and this commit changes only inputs.

Also, in this commit, carry out F14's investigation and write down the result:
`cd shell && wails3 task -x --dry darwin:build 2>&1 | tee /tmp/p1-taskgraph.txt`. Record what
happens to `common:build:frontend` in the commit message and in the `AGENTS.md` note (C7). If the
command cannot run in the implementing environment, say **that**, explicitly, rather than guessing.

### C5 — `docs: README.md — the post-cutover script and test surface` (D8)

Rewrite these `README.md` sections against the live `package.json`, `playwright.config.ts`,
`vite.config.ts` and `docs/PACKAGING.md` — every claim checked against the tree, not against this
plan's F8 table:

- **`:5`** — the one-line description: *"built on Electron, TypeScript and Vue 3"* → the Wails/Go +
  Vue 3 shape (`docs/ARCHITECTURE.md`'s Stack table is the source).
- **`:18`** — *"via the macOS Keychain (`safeStorage`)"* → `safeStorage` was Electron's API; the Go
  side uses `github.com/keybase/go-keychain` (`shell/internal/secrets/keyring_darwin.go`). Keep the
  pointer to `docs/ARCHITECTURE.md`'s Storage section.
- **`:100-107` Requirements** — Bun is tooling only *because every adapter is native Go*, not
  because Electron embeds its own Node; add Go (`shell/go.mod`: 1.25.0) and the pinned `wails3` CLI,
  matching `docs/PACKAGING.md` §1.
- **`:109-132` Install** — `bun run package`, artifacts at `shell/bin/Kira Studio.app`, nothing in
  `dist/`; drop `package:mac:dir`; drop *"the electron-builder config"* from the
  `docs/PACKAGING.md` pointer.
- **`:134-159` Development** — `bun run dev` is `bun run build && cd shell && wails3 task dev` with
  `predev` running `scripts/wails-dev-setup.sh`; the script table becomes exactly the twelve scripts
  `package.json` actually defines, with `typecheck:node` described as **`src/shared` + every
  `tests/` tier + `playwright.config.ts`** (F2), not "main + engine + preload".
- **`:169-195` Tests** — four tiers as they exist: `tests/unit/` (`bun run test:unit`), `tests/ui/`
  (`bun run test:ui`, WebKit against the built bundle), `tests/ipc/` (`bun run test:ipc:fe` for the
  frontend half; the backend half is Go — `shell/internal/ipcfixture`, run by `bun run test:go` with
  `KIRA_IPC_FIXTURES=write` to regenerate), `tests/e2e-real/` (a real `-tags server` Go binary,
  launched through plain Node per `AGENTS.md`, deliberately without a `package.json` script), plus
  `bun run test:go` for the Go suite. Delete the `tests/electron-db/`, `test:db:kafka`,
  `test:ipc:be` and `xvfb-run` paragraphs. `tests/db/` is described as what it is now: a shared
  fixture corpus, not a suite.
- **`:197-225` Architecture + layout block** — two processes' worth of Electron prose (`src/main`,
  `src/engine`, `utilityProcess`, `MessagePort`, `contextBridge`) → the Wails/Go shape;
  `docs/ARCHITECTURE.md`'s Process model section is the source. The layout block lists what `ls`
  actually shows: `src/renderer`, `src/shared`, `shell/`, `tests/{unit,db,ipc,ui,e2e-real}`, `docs`,
  `scripts/demo-dbs`.
- **`:239-241`** — *"P0 through P45"* → P0 through P58f, and add a `docs/v1.1/` pointer.

Out of scope for this commit, deliberately (§7): the Supported-engines table and its four footnotes
(which still name `node:sqlite` and `@clickhouse/client` — both replaced by Go drivers), the Features
list, the keyboard list, and "Not in v1".

Verify: `bun run lint` (Biome formats Markdown), plus a manual pass confirming every `bun run …` in
the file appears in `package.json`'s `scripts` and every path in the layout block exists:

```sh
grep -o 'bun run [a-z:0-9-]*' README.md | sort -u
bun run --silent 2>/dev/null | head -40   # or: node -p "Object.keys(require('./package.json').scripts).join('\n')"
```

### C6 — `docs: shell/README.md and main.go — the deleted build entry points` (D8)

- `shell/README.md`: rewrite the build block. `bun run build:wails` → `bun run build`;
  `../vite.wails.config.ts` → `../vite.config.ts`; delete the `sh scripts/vendor-node.sh` line
  entirely; `wails3 generate bindings -b -i -ts` → the flags `scripts/wails-dev-setup.sh` and
  `docs/PACKAGING.md` §1 actually use (`-b -i -ts -names`); drop *"being built to replace Electron's
  `src/main`/`src/preload`"*. Keep the `shell/blank/` + `cmd/g1measure/` sentence — F18 confirms it
  is still true.
- `shell/main.go:42`: `bun run build:wails` → `bun run build`.

Verify: §6's block; `grep -rn 'build:wails\|vite\.wails\.config\|vendor-node' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/v1` returns nothing.

### C7 — `docs: P1 audit findings — AGENTS.md, staged workflows` (D2, D9)

1. `docs/v1/plans/p58-pending-ci-workflows/release.yml`: delete the `env: KIRA_STRICT_UPDATE_CHECK:
   '1'` block on the `verify:packaging` step and reword the step name (there is no strict mode).
2. `docs/v1/plans/p58-pending-ci-workflows/README.md`: add a line recording that P1 revised
   `release.yml` in place, per that README's own standing instruction. Do **not** claim a new
   "generation" — this is a correction to the staged content, not a new generation of it.
3. `AGENTS.md`: add a `## P1 (v1.1) implementation findings — dependency, script and folder audit`
   section, immediately before the closing "Current-state architecture reference" paragraph, in the
   same voice as the P58x sections. It must carry, at minimum:
   - **The `tsgo` verdict and its numbers** (F2) — so nobody re-opens it from the SPEC row alone.
   - **Dead exports are invisible to this repo's tooling** (F12) — neither Biome nor `tsgo` flags an
     exported symbol in an unimported module, which is why `src/shared/format.ts` survived a full
     cutover; the only way to find one is to enumerate modules and count importers.
   - **`tests/db/support/*` is what keeps five npm packages alive** (F1) — the non-obvious chain
     through `tests/e2e-real/support/`.
   - **What F14's investigation actually found** in C4 — including "could not be determined here", if
     that is the truth.
   - **The near-miss pair** `src/shared/format.ts` (dead) vs `src/renderer/format.ts` (live, five
     importers), as a worked example of why a bare `grep format` is not evidence.

Verify: `bun run lint`; `git diff --stat` shows only `AGENTS.md` and two files under
`docs/v1/plans/p58-pending-ci-workflows/`.

---

## 6. Verification

Run after **every** commit in §4:

```sh
bun run lint
bun run typecheck
bun run build
cd shell && go build ./internal/... ./cmd/... && go vet ./internal/... ./cmd/... && cd ..
```

`go build ./...` (rather than `./internal/... ./cmd/...`) additionally compiles the root `main`
package, which imports Wails and therefore needs GTK4/WebKitGTK headers on Linux — `AGENTS.md`'s
Wails section has the `apt-get` line. Use the narrower form for the loop; run the full `./...` once
at the end if the headers are available.

Once, at the end of the phase:

```sh
bun run test:unit                       # 12 files, no external resource
bun run test:ui                         # needs `bunx playwright install webkit` + its system libs (AGENTS.md)
bun run test:ipc:fe
cd shell && go test ./... && cd ..      # container-backed cases self-skip without Docker
```

**Baseline measured at this plan's authoring commit, so a regression is legible:** `bun run lint` →
*"Checked 304 files … No fixes applied"*; `bun run typecheck` → three projects, all exit 0;
`go build`/`go vet` over `./internal/... ./cmd/...` → exit 0; `git status --porcelain` → clean.

`bun run package` and `bun run verify:packaging`'s artifact checks need macOS and are not runnable
in a Linux container — same constraint `docs/PACKAGING.md` §6 records for every earlier phase. If the
implementing session has no macOS, say so in the acceptance walkthrough rather than reporting them
as passed.

---

## 7. Explicitly out of scope

- **Anything in the P58f cutover** (§0.1). It is done.
- **Removing any dependency.** D1: there is nothing to remove. An audit that deletes something to
  look productive is worse than one that reports a clean result.
- **Swapping `tsgo` for `tsc`** (D2, §9 OQ-1). A toolchain-policy change, not staleness.
- **Renaming `src/renderer`, `src/shared`, `tests/db` or `tsconfig.node.json`** (D12, §9 OQ-2).
- **Folding `src/shared` into `src/renderer`** (F11). 209 import sites, four tsconfigs, one Vite
  alias, and it would erase the signal that ten Go files read as their source of truth.
- **Removing `install:frontend:deps` / `build:frontend` / `dev:frontend` and friends** (F14). A
  build path declares them as dependencies and this session cannot run that build path.
- **Trimming `.gitignore` boilerplate or `biome.json`'s redundant excludes** (F16).
- **Editing `.github/workflows/*.yml`** (D10).
- **A full `README.md` accuracy pass** — engine capability table, footnotes, Features, keyboard
  list, "Not in v1" (D8, §9 OQ-4). C5 is bounded to the script/test/layout surface this audit
  actually covered.
- **Deleting `shell/blank/`, `shell/cmd/g1measure/`, `scripts/demo-dbs/` or anything under
  `tests/`** (F18).
- **Any new test.** Nothing here clears `AGENTS.md`'s bar — these are deletions of unreferenced
  files and edits to prose, all of which `bun run typecheck` / `bun run build` / `go build` already
  guard.

---

## 8. Acceptance checklist

P1 is done when every line below is true, each checked against the tree rather than against this
document:

1. `cd shell && go mod tidy` produces **no diff** (C1 already applied it), and
   `grep -n 'franz-go/pkg/kmsg' shell/go.mod` shows it in the direct require block with no
   `// indirect`.
2. `src/shared/format.ts` and `src/shared/vite-raw.d.ts` do not exist;
   `grep -rn 'abbreviateCount\|?raw' src tests --exclude-dir=node_modules` returns only Go-side
   mirror comments (which live under `shell/`, so: returns nothing).
3. The root `build/` directory does not exist; `shell/build/appicon.png` and
   `shell/build/appicon.icon/Assets/kira_icon_vector.svg` are unchanged (same md5s as F13);
   `docs/PACKAGING.md` no longer points at `build/icon.png`.
4. `grep -n puppertino shell/build/Taskfile.yml` returns nothing;
   `grep -n 'My Other Data\|walking skeleton' shell/build/config.yml` returns nothing;
   `install:frontend:deps`, `build:frontend`, `dev:frontend`, `generate:bindings`,
   `generate:icons`, `update:build-assets` and `go:mod:tidy` are all **still present**.
5. `scripts/verify-packaging.sh`'s header names only the checks that exist; S1, S2 and S5 are
   unchanged in body; `scripts/demo-dbs/README.md` no longer names `bun run test:db`.
6. Every `bun run <script>` mentioned anywhere in `README.md`, `shell/README.md`,
   `scripts/*.sh` or `docs/PACKAGING.md` exists in `package.json`'s `scripts` block. Checked
   mechanically, not by eye:
   ```sh
   comm -23 \
     <(grep -rho 'bun run [a-z:0-9-]*' README.md shell/README.md scripts/ docs/PACKAGING.md docs/ARCHITECTURE.md | sed 's/bun run //' | sort -u) \
     <(node -p "Object.keys(require('./package.json').scripts).join('\n')" | sort -u)
   ```
   must print nothing.
7. `grep -rn 'build:wails\|vite\.wails\.config\|vendor-node\|src/engine\|src/main\|src/preload\|enginehost\|electron-vite\|package:mac\|test:e2e\b\|test:db\b\|typecheck:db\|test:ipc:be' README.md shell/README.md shell/main.go scripts/ docs/PACKAGING.md docs/ARCHITECTURE.md`
   returns nothing. (`.github/workflows/` is excluded by D10 and still fails this; that is expected
   and is recorded in §9.)
8. `docs/v1/plans/p58-pending-ci-workflows/release.yml` no longer sets `KIRA_STRICT_UPDATE_CHECK`,
   and that directory's `README.md` records P1's revision.
9. `AGENTS.md` has a P1 findings section carrying at least the five items C7 lists — including the
   `tsgo` verdict with its measured numbers, and an honest statement of what F14's investigation
   did or did not establish.
10. §6's verification block is green, and the end-of-phase test commands have either been run or
    have a stated reason they could not be (no macOS, no Docker, no WebKit) — never reported as
    passed when they were not run.
11. `git status --porcelain` is clean and the diff contains **no** `.github/workflows/` file.

---

## 9. Open questions, handed forward

**OQ-1 — `tsgo` vs `tsc`: a decision for the user, not for this phase.** F2 establishes that
`typescript@5.9.3` (already installed for `vue-tsc`) passes both tsgo projects identically today, at
+4.75 s per `bun run typecheck` — which the pre-commit hook runs on every commit. Dropping
`@typescript/native-preview` would save 31 MB of `node_modules` and one dev-preview dependency, and
would contradict `docs/ARCHITECTURE.md`'s Stack table (*"TypeScript 7 (native compiler) … converge on
one toolchain once `vue-tsc` runs on TS7"*), which would then need updating too. **Owner: the user.**
If they say yes, it is three lines: `bun remove @typescript/native-preview`, repoint
`typecheck:node`/`typecheck:unit` at `tsc`, amend the Stack table. If they say nothing, D2 stands.

**OQ-2 — `src/renderer` / `src/shared` / `tests/db` / `tsconfig.node.json` carry Electron-era
names for a shape that no longer exists.** F11 measures the `src/renderer` rename at 27 external
files plus four config files, with zero functional effect. **Owner: P2's round-1 subagent
(architecture, structure, maintainability)** — it runs against the tree P1 leaves behind and its
remit is exactly this. Flagging it here so P2 does not have to rediscover the measurement.

**OQ-3 — `shell/blank/index.html` may no longer do what it claims.** Its comment describes measuring
*"the floor cost of Wails + WKWebView/WebKitGTK + Go + the vendored Node child"* — a configuration
that no longer exists — and it calls `Call.ByID(3273072800)` with a hand-copied method id, where the
generated bindings now use `Call.ByName(...)`. Whether that id still resolves was **not** verified
(it needs a running Wails build). **Owner: P3 (RAM usage) or P5 (CPU/memory readout)**, both of which
will actually run this configuration. Not touched in P1: changing a measurement harness you cannot
run is how a measurement quietly starts lying.

**OQ-4 — `README.md`'s non-script content was not re-derived.** C5 fixes what the script audit
covered. Untouched and *not verified*: the Supported-engines table, its four footnotes (which still
name `node:sqlite` for SQLite's cancel story and `@clickhouse/client` as *"the app's first added
dependency"* — both replaced by Go drivers in P58b), the Features list, the keyboard list, and "Not
in v1". `docs/v1/plans/P45-docs-cleanup.md` §8 item 2 drew the same boundary around the same file and
said the honest thing about it: *"nothing contradicted it" is not "it was checked."* **Owner: a docs
phase, if one is wanted.**

**OQ-5 — the pending CI workflows are still pending, now with P1's correction folded in.** D10/D9.
`docs/v1/plans/p58-pending-ci-workflows/README.md` carries the copy-and-apply steps; the directory
continuing to exist is the signal that neither the P57 nor the P58f workflow update has landed.
**Owner: whoever next has a token with the `workflow` OAuth scope.** Note for them: the live
workflows are the one remaining place in the repository that still references `bun run test:e2e`,
`bun run test:db`, `bun run package:mac` and `app.asar.unpacked/` — after P1, everything else is
clean, so acceptance criterion 7's grep is the fastest way to confirm the apply landed correctly.

**OQ-6 — `shell/build/Taskfile.yml`'s frontend chain.** F14/C4. If C4's investigation showed
`common:build:frontend` being skipped by Task's fingerprint, the tasks are harmless but load-bearing
in a way nobody intended, and a short comment in the Taskfile is the right fix. If it showed a
failure, `bun run package` is broken on macOS and that is a packaging bug for whoever next has
hardware — `docs/PACKAGING.md` §6 already records that every §4 item is unrun. **Owner: whoever next
runs a real macOS package build.**
