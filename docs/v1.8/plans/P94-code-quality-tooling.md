# P94 — repo-wide code-quality tooling: complexity, dead-code, performance

`docs/v1.8/SPEC.md`'s P94 row (`:168`), turned into concrete steps. Everything below was read and
**measured** in the current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `f7b51382`, P71-P93
landed). Every count in this plan is a real number from a real run in this container, not an
estimate.

Three tool categories (Biome complexity + performance, `golangci-lint`, `knip`), a new
`.githooks/pre-push`, a `pr.yml` patch file, then a repo-wide fix pass.

**This phase does not fit one pass.** §1 states the measured scope; §2 the pass split. This file is
**pass 1**'s plan. Passes 2-4 are sketched in §11 and get their own `-iter2`/`-iter3`/`-iter4` files
per `CLAUDE.md`, each planned against the tree the previous pass left.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| `golangci-lint` will not run against this repo (`go.mod` is `go 1.27.1`) — two prior attempts disagreed on the fix | **Solved, verified.** The container's *default* Go is **1.24.7**, not 1.27.1. `go install pkg@version` ignores the current module, so it resolves only golangci-lint's own `go 1.26.0` directive and auto-downloads the *minimum* satisfying toolchain (go1.26.8). Pin it: `GOTOOLCHAIN=go1.27.1 go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2` | §3 |
| Can the prebuilt binary or `golangci-lint-action` be used instead? | **No.** Every official v2.13.2 release binary is built with go1.26.8 and fails identically. Build from source, in CI too | §3.2 |
| Exact pre-commit/pre-push split | **pre-commit unchanged** (`bun run lint` + `bun run typecheck`, 15s measured). New Biome rules ride inside `bun run lint` for free. **pre-push is new**: `go build`, `golangci-lint`, `knip`. Reason is golangci-lint's bimodal cost, not its warm cost | §5 |
| `golangci-lint` enabled-linter set | **9 in pass 1**, plus `gocognit`/`gocyclo` in pass 2 — 11 across the phase, §4.1. `errcheck` (220) and `staticcheck` (49) **declined with reason** and named as follow-up `P95`; `gocritic`'s `hugeParam` (~400) and `rangeValCopy` (107) declined on aliasing-safety grounds | §4.1 |
| Complexity thresholds | **30 everywhere**, Go and TS, `_test.go`/spec files exempt. One metric (SonarSource cognitive complexity), one number | §4.2 |
| Biome `complexity`/`performance` subsets | 4 performance rules enabled, 11 declined individually; `useTopLevelRegex` (379) and `noAwaitInLoops` (77) declined on correctness grounds, not volume | §4.3 |
| `knip` config | Written and **measured**: tuned config cuts the no-config baseline from 36/751/197 to 8/71/46 | §4.4 |
| — | **`golangci-lint` truncates by default** (`max-issues-per-linter: 50`, `max-same-issues: 3`). Both must be `0`, or a pass looks finished while 10x the findings stay hidden | §4.1 |
| `packages/db-fixtures/` is absent from `package.json` workspaces | **Confirmed — and it has no `package.json` at all**, only `fixtures/` and `support/`. So it cannot be a knip workspace. Covered under the root workspace's `entry`/`project` instead | §4.4 |
| One subagent or several? | **One sequential, per pass.** `package.json`, `.githooks/pre-push` and the CI patch are one shared file each, sitting between the would-be splits | §9 |
| Does this fit one pass? | **No.** 4 passes | §2 |

Genuinely left out, named rather than half-built (`CLAUDE.md`'s "scope left out stays out"):

- **`errcheck` and `staticcheck`.** 269 findings between them, and both are error-handling and
  general-correctness linters — none of SPEC's three categories. They deserve a phase, not a
  footnote. Pass 1 adds a `P95` row to `SPEC.md` proposing them.
- **Ratcheting the complexity threshold below 30.** §4.2 argues the number. A later phase may lower
  it; this one enforces 30 with zero findings, which is complete, not partial.
- **`gosec`, `dupl`, `funlen`, `lll`, `unparam`, `nestif`.** §4.1's table gives a reason per linter.
- **Any autofix/`--write` mode in a hook.** Hooks report; the human fixes. A hook that rewrites the
  tree under a commit is a surprise, not a check.
- **Replacing `go vet`'s own CI step.** `govet` runs inside golangci-lint too; the standalone step
  stays until pass 2 proves the aggregate is stable.

---

# 1. The measured scope

Every number below came from a run in this container against `f7b51382`. This is the evidence for
§2's pass split; do not re-derive it, but do re-run each tool after each pass.

**Read this before trusting any golangci-lint count, including your own.** Its defaults are
`max-issues-per-linter: 50` and `max-same-issues: 3`, so a linter with more than 50 findings is
silently truncated *and still reports a tidy-looking total*. The first measurement taken for this
plan put `gocritic` at 50; uncapped it is **541**. §4.1's config sets both to `0`. Always pass
`--max-issues-per-linter=0 --max-same-issues=0` for an ad-hoc run.

**Go — `golangci-lint` v2.13.2, 85 packages, 896 tracked `.go` files, uncapped:**

| Linter | Findings | Non-test | Note |
|---|---|---|---|
| `gocritic` `hugeParam` alone | ~400 | — | **declined**, §4.1 |
| `errcheck` | 220 | 137 | **declined**, §4.1 |
| `gocritic` `rangeValCopy` alone | 107 | — | **declined**, §4.1 |
| `gocognit` (>30) | 71 | **47** | pass 2 |
| `staticcheck` | 49 | — | **declined**, §4.1 |
| `gocritic` (performance, minus `hugeParam` + `rangeValCopy`) | **34** | 26 | `stringXbytes` 18, `equalFold` 4, `wrapperFunc` 3, `ifElseChain` 3, `appendCombine` 2, `appendAssign` 2, `singleCaseSwitch` 1, `assignOp` 1 |
| `prealloc` | 19 | **4** | 15 are in `_test.go` |
| `nilerr` | 16 | — | **declined** |
| `unused` | 11 | 7 | pass 1 |
| `usestdlibvars` | 6 | — | **declined** |
| `copyloopvar` | 5 | — | pass 1 |
| `gocyclo` (>30) | 5 | **4** | pass 2 |
| `unconvert` | 1 | — | pass 1 |
| `ineffassign` | 1 | — | pass 1 |
| `bodyclose`, `makezero`, `govet` | 0 | 0 | already clean — enable to keep it that way |

Verified against the exact pass-1 config in §4.1, uncapped: **56 issues**.

Non-test cognitive complexity distribution: `144 134 107 91 89 76 72 67 64 61 59 55 52 49 47 45 44
43 42 42 42 41 40 40 39 38 36 36 35 35 35 35 35 35 35 35 34 34 33 33 33 31 31 31 31 31 31`.
Counts: `>30: 47`, `>40: 22`, `>50: 13`, `>60: 10`.

P93 landed 11 commits of TS/Vue between this plan's research and its writing. It changed **zero** Go
files (`git diff --name-only 5b58a980..f7b51382`), so every Go number above holds; the TS and knip
numbers below were re-measured against `f7b51382` after it landed.

**TS/Vue — Biome 2.5.13, 980 tracked `.ts`/`.vue` files, run through the repo's own `biome.json`:**

| Rule | Findings | Decision |
|---|---|---|
| `complexity/noExcessiveCognitiveComplexity` | 115 (>15) / 67 (>20) / 38 (>25) / **21 (>30)** / 5 (>40) | pass 3, at 30 |
| `performance/useTopLevelRegex` | 379 | **declined**, §4.3 |
| `performance/noAwaitInLoops` | 77 | **declined** |
| `performance/noNamespaceImport` | 64 | **declined** |
| `complexity/useMaxParams` | 59 | **declined** |
| `performance/noBarrelFile` | 21 | **declined** |
| `performance/noReExportAll` | 8 | **pass 1** |
| `performance/noDelete` | 4 | **pass 1** |
| `performance/noAccumulatingSpread` | 0 | **pass 1** |
| `performance/noDynamicNamespaceImportAccess` | 0 | **pass 1** |

TS cognitive complexity top scores: `92 79 46 43 42 40 38 37 36 36 36 36`.

**Dead code — knip 6.37.0:**

| | No config | §4.4's tuned config |
|---|---|---|
| Unused files | 36 | **8** |
| Unused dependencies | 5 | 5 |
| Unused devDependencies | 6 | 5 |
| Unlisted binaries | 3 | **0** |
| Unused exports | 751 | **71** |
| Unused exported types | 197 | **46** |
| Duplicate exports | 7 | 7 |

The no-config run flags `apps/kira-studio-vscode/src/extension.ts` — the extension's own activation
entry — as unused. That single false positive is the whole argument for §4.4.

**Runtimes, measured warm in this container:** `biome check .` 2s, `scripts/check-tokens.sh` 0s,
`bun run typecheck` 13s, `golangci-lint run ./...` 1s warm, `knip` 3s. Cold (empty Go build cache)
golangci-lint is minutes, not seconds — §5 turns on exactly that gap.

---

# 2. Why this is four passes, not one

The honest total: **~93 findings to fix in pass 1, 51 function refactors in pass 2, ~138 in pass 3,
and a full-suite flake sweep in pass 4** — across 85 Go packages and 8 TS workspaces, plus three new
config files, a new hook and a CI patch. Pass 2 alone rewrites 47 Go functions, ten of them above
cognitive complexity 60 and one at 144. That is not one pass.

The split is not arbitrary. One constraint forces it:

> **A rule enters the enabled set only in the pass that drives it to zero.**

`CLAUDE.md`: *"Never report something complete while a hook, on any commit that will ship, is still
red."* A pass that enables `gocognit` without refactoring the 47 functions leaves `.githooks/pre-push`
red on every commit it ships — and the only way to work would be `git push --no-verify`, which the
same rule forbids as a way of finishing. So each pass's enabled set is exactly what that pass makes
clean, and every pass ends with a green hook on a normal, non-bypassed commit.

Two mechanisms make that possible without any half-built config:

- `knip --include files,dependencies,unlisted,duplicates` — knip's own flag. Pass 1 gates on those
  four rule types; pass 3 drops the filter and gates on `exports`/`types` too.
- A linter simply absent from `.golangci.yml`'s `enable:` list, and a Biome rule absent from
  `biome.json`. Nothing is stubbed, commented out or `TODO`-marked.

| Pass | Plan file | Enables | Fixes | Ends green on |
|---|---|---|---|---|
| **1** | this file | 9 Go linters; 4 Biome performance rules; knip `files,dependencies,unlisted,duplicates` | ~93 | pre-commit + new pre-push |
| 2 | `P94-code-quality-tooling-iter2.md` | `gocognit`, `gocyclo` at 30 | 51 Go refactors | same |
| 3 | `P94-code-quality-tooling-iter3.md` | Biome `noExcessiveCognitiveComplexity` at 30; knip `exports,types` | 21 + ~117 | same |
| 4 | `P94-code-quality-tooling-iter4.md` | nothing new | the named flakes + whatever the full suite surfaces | full suite |

Pass 4 is last because a complexity refactor (pass 2/3) is itself a plausible source of new test
failures. Sweeping flakes before those land would mean sweeping twice.

---

# 3. The `golangci-lint` blocker — root cause and verified fix

This blocked both prior attempts and the two reached opposite conclusions. Here is what is actually
true, established by direct experiment rather than inference.

## 3.1 Root cause

The preinstalled `/usr/local/bin/golangci-lint` is `2.5.0 built with go1.25.1`. Against this repo:

```
Error: can't load config: the Go language version (go1.25) used to build golangci-lint is lower
than the targeted Go version (1.27.1)
```

The first attempt's proposed fix — `go install .../golangci-lint@latest` — produces a binary built
with **go1.26.8**, which fails the same way. The second attempt observed that and stopped. Neither
found why, and the why is the fix:

```
$ go version                      # go1.27.1   <- misleading
$ GOTOOLCHAIN=local go version    # go1.24.7   <- the container's ACTUAL default Go
```

`go version` reports 1.27.1 only because `GOTOOLCHAIN=auto` reads *this repo's* `go.mod` (`go
1.27.1`) and downloads that toolchain on demand. But `go install pkg@version` runs in module-aware
mode **ignoring the current module** — so it sees only golangci-lint's own `go.mod`, whose directive
is `go 1.26.0` (verified; there is no `toolchain` line). `GOTOOLCHAIN=auto` then downloads the
*minimum* toolchain satisfying that directive — go1.26.8, not the 1.27.1 sitting right there in the
module cache. Hence a binary one minor version short, every time, regardless of `@latest`.

## 3.2 The fix

```sh
GOTOOLCHAIN=go1.27.1 go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2
```

Verified end to end in this container:

```
golangci-lint has version 2.13.2 built with go1.27.1 from (unknown, modified: ?, ...)
```

and it then lints all 85 packages, producing the §1 numbers. **The blocker is closed.** No
`go.mod` change, no Go version bump, no source checkout of golangci-lint needed.

Three consequences the implementer must not lose:

- **v2.13.2 is the newest tag** (confirmed against `git ls-remote --tags`). Pin it; do not use
  `@latest`, which will silently drift onto a release whose `go` directive moves again.
- **Do not use `golangci/golangci-lint-action` or any prebuilt release binary**, in CI or locally.
  Official v2.13.2 binaries are built with go1.26.8 and fail identically. CI builds from source.
- **In CI the pin is belt-and-braces, not load-bearing.** `actions/setup-go` with
  `go-version-file: go.mod` makes 1.27.1 the runner's *default* toolchain, so a plain `go install`
  there already builds with 1.27.1. Pass `GOTOOLCHAIN` anyway so one command works in both places.

## 3.3 `scripts/install-golangci-lint.sh` (new)

Mirrors what `scripts/setup.sh` already does for the `wails3` CLI — validate the cached binary
against the pinned version before trusting it, install only on a miss:

```sh
#!/bin/sh
# P94: build golangci-lint from source against THIS repo's Go toolchain.
# A prebuilt release binary is built with an older Go and refuses go.mod's `go 1.27.1`
# (plan §3). GOTOOLCHAIN must be pinned: `go install pkg@version` ignores the current
# module, so `auto` picks golangci-lint's own minimum (go1.26), not ours.
set -e
VERSION=v2.13.2
GOVERSION=go1.27.1
BIN="$(go env GOPATH)/bin/golangci-lint"

if [ -x "$BIN" ] && "$BIN" --version 2>/dev/null | grep -q "version ${VERSION#v} built with $GOVERSION"; then
  exit 0
fi
GOTOOLCHAIN=$GOVERSION go install "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$VERSION"
```

Keep `VERSION`/`GOVERSION` as the single source of truth; `GOVERSION` must track `go.mod`'s
directive, and pass 2's own verification re-checks that it does.

---

# 4. The configs

## 4.1 `.golangci.yml` (new, repo root)

Schema verified with `golangci-lint config verify` and a full run — this is the v2 schema, not v1.

```yaml
version: "2"

run:
  timeout: 10m

linters:
  default: none
  enable:
    - bodyclose      # perf/leak: an unclosed HTTP body holds a connection. 0 findings — keeps it so.
    - copyloopvar    # Go 1.22+ made the loop-var copy redundant. 5.
    - gocritic       # perf tag only, minus hugeParam + rangeValCopy. 34.
    - govet          # already run standalone; free here, and catches the same set.
    - ineffassign    # dead stores — dead code, statement level. 1.
    - makezero       # make([]T, n) then append. 0 findings — keeps it so.
    - prealloc       # perf: a growable slice with a known length. 4 (non-test).
    - unconvert      # redundant conversions. 1.
    - unused         # SPEC's Go dead-code answer, staticcheck-based. 11.
  settings:
    gocritic:
      enabled-tags:
        - performance
      disabled-checks:
        - hugeParam
        - rangeValCopy
  exclusions:
    generated: lax
    rules:
      - path: _test\.go
        linters: [prealloc]

issues:
  # golangci-lint truncates at 50 per linter / 3 per message by default and still
  # prints a tidy total. That hid 507 of gocritic's 541 findings on the first run
  # for this plan. Never leave these at their defaults.
  max-issues-per-linter: 0
  max-same-issues: 0
```

Verified with `golangci-lint config verify` and a full run: **56 issues**. Pass 2 adds
`gocognit`/`gocyclo` and their settings; nothing else here changes.

**`hugeParam` and `rangeValCopy` are disabled together, for one reason.** They are ~400 and 107 of
the 541 raw performance-tag findings, and both remedies do the same thing: replace a value with a
pointer or an index into the backing array. That converts copy semantics to aliasing semantics at
hundreds of sites across adapter, wire and git code — each one a place where a later mutation
becomes visible to a caller that previously held a copy. Trading a real correctness surface for an
unmeasured copy cost is a bad bargain 507 times over. `CLAUDE.md` says to skip a measurement that
would not change the decision; it does not say to take a risky repo-wide refactor on an unmeasured
claim. If either is wanted later, it belongs in a phase that measures first — name it, do not
smuggle it in here.

What remains is the genuinely safe residue: `stringXbytes` (18) drops a `[]byte(s)` allocation in a
comparison, `equalFold` (4) and `wrapperFunc` (3) swap in a cheaper stdlib call, `appendCombine` (2)
merges consecutive appends. None changes a signature or an aliasing relationship.

**`prealloc` is excluded from `_test.go`** — 15 of its 19 findings are there, and preallocating a
slice in a table-driven assertion buys nothing.

Declined, with the reason per linter:

| Linter | Findings | Why not |
|---|---|---|
| `errcheck` | 220 | Error handling — none of SPEC's three categories. 220 fixes is its own phase, and each needs a judgement (handle, log, or `_ =`), not a rewrite rule. → `P95` |
| `staticcheck` | 49 | Broad correctness + style (merges `gosimple`/`stylecheck` in v2), again outside the three categories. → `P95` |
| `nilerr` | 16 | Error handling. Same argument as `errcheck` |
| `usestdlibvars` | 6 | Pure style (`http.MethodGet` over `"GET"`). No complexity, dead-code or performance content |
| `nestif` | — | Redundant: nesting depth is the core term in cognitive complexity, already counted and penalised by `gocognit` |
| `unparam` | — | Known false positives on interface implementations, of which this repo has many (every adapter) |
| `dupl` | — | The adapter conformance suites are deliberately repetitive per `CLAUDE.md`. `dupl` would fight a documented decision |
| `funlen`, `lll` | — | Line/statement counts. `gocognit` measures the thing actually worth measuring |
| `gosec` | — | Security. A real subject, a different phase |

## 4.2 Complexity thresholds — 30, both languages

`gocognit`/`gocyclo` `min-complexity: 30`, `_test.go` exempt. Biome
`noExcessiveCognitiveComplexity` `maxAllowedComplexity: 30`, spec/test files exempt.

**Why one number across both languages.** `gocognit` and Biome's rule both implement SonarSource's
cognitive-complexity metric. Two thresholds would express two policies for one concept and invite
the question at every review. One number is one policy.

**Why 30 and not Biome's default 15.** At 15 the TS side is 115 functions; with Go's 47 that is 162
refactors of working, tested code — a scale at which the refactors themselves become the risk. 30 is
`golangci-lint`'s own default for `gocognit` and the commonly cited bar, and it isolates the
functions that are genuinely hard to hold in your head (the tail runs 144, 134, 107, 92, 91) rather
than the merely long ones. 47 + 21 = 68 refactors is real work that a pass can actually finish.

**Why tests are exempt.** `CLAUDE.md` protects the adapter conformance suites explicitly: keep
per-capability coverage "even where it reads like a CRUD round-trip". `TestClickHouse` sits at
cognitive complexity 220 because it walks every capability in one table — that is the design. Same
for the Playwright specs.

Lowering to 20 or 15 later is a separate decision for a separate phase. A gate at 30 with zero
findings is a finished gate, not a half-built one.

## 4.3 `biome.json` — the rule additions

`linter.rules` today is `{"preset": "recommended"}` plus the `noRestrictedImports` overrides. Pass 1
adds, beside `preset`:

```json
"performance": {
  "noAccumulatingSpread": "error",
  "noDelete": "error",
  "noDynamicNamespaceImportAccess": "error",
  "noReExportAll": "error"
}
```

Pass 3 adds the `complexity` block. Every existing override is untouched.

Enabled, and why:

- **`noAccumulatingSpread`** (0) — spreading an accumulator inside `reduce` is quadratic. Zero
  findings; enabling it keeps a real footgun out.
- **`noDelete`** (4) — `delete` deoptimises the object's shape. Four mechanical fixes
  (`obj[k] = undefined`, or a `Map`).
- **`noDynamicNamespaceImportAccess`** (0) — defeats bundler tree-shaking. Free.
- **`noReExportAll`** (8) — `export *` forces the bundler to keep the whole module and blinds
  dead-export analysis. Converting to named re-exports is mechanical, and it directly sharpens
  knip's pass-3 results. Real synergy, not a coincidence.

Declined, and why — volume is the reason for only two of these:

- **`useTopLevelRegex`** (379) — declined on **correctness**, not volume. A hoisted regex carrying
  the `g` flag keeps `lastIndex` between calls, so lifting one out of a function silently makes it
  stateful across invocations. Trading a latent state bug for a negligible compile saving is a bad
  trade 379 times over.
- **`noAwaitInLoops`** (77) — declined on **semantics**. Sequential `await` is deliberate here:
  ordered IPC, backpressure on streamed chunks, rate-limited adapter calls. The rule's remedy is
  `Promise.all`, which changes the behaviour it flags.
- **`noBarrelFile`** (21) — declined on **architecture**. Every `packages/*` publishes through
  `src/index.ts` (`"exports": {".": "./src/index.ts"}`), and `biome.json`'s own
  `noRestrictedImports` overrides police cross-package imports through exactly those entry points.
  The rule contradicts a documented design.
- **`noNamespaceImport`** (64) — `import * as vscode from 'vscode'` is the only correct form for the
  VS Code API, and the same holds for Node built-ins.
- **`useMaxParams`** (59), **`noExcessiveLinesPerFunction`** — style, outside the three categories.
  Line count also penalises a legitimately long flat `switch`, which cognitive complexity correctly
  does not.
- **`noImgElement`, `noSyncScripts`, `noUnwantedPolyfillio`, `useGoogleFontPreconnect`,
  `noJsxPropsBind`, `useSolidForComponent`** — Next.js/Solid-specific; this is a Vue + Wails app.
- **`useVueVapor`** — an opt-in compiler migration, not a lint finding.

## 4.4 `knip.json` (new, repo root)

Measured against `f7b51382`: this config takes the baseline from 36/751/197 to **8/71/46**, and
clears all 3 unlisted binaries. Start from it verbatim; it is tested, not sketched.

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "workspaces": {
    ".": {
      "entry": [
        "scripts/*.ts",
        "packages/db-fixtures/fixtures/*.ts",
        "packages/db-fixtures/support/*.ts"
      ],
      "project": ["scripts/**/*.ts", "packages/db-fixtures/**/*.ts"]
    },
    "apps/kira-studio/frontend": {
      "entry": ["src/main.ts", "index.html"],
      "project": ["src/**/*.{ts,vue}"]
    },
    "apps/kira-studio-vscode": {
      "entry": [
        "src/extension.ts",
        "src/webview/main.ts",
        "tests/**/*.spec.ts",
        "tests/**/*.entry.ts",
        "playwright.config.ts"
      ],
      "project": ["src/**/*.{ts,vue}", "tests/**/*.ts"]
    },
    "packages/shared":   { "entry": ["**/*.ts"], "project": ["**/*.ts"] },
    "packages/api-core": { "entry": ["src/index.ts", "test/**/*.test.ts"], "project": ["src/**/*.ts", "test/**/*.ts"] },
    "packages/git-ipc":  { "entry": ["src/index.ts", "src/**/*.test.ts"], "project": ["src/**/*.ts"] },
    "packages/git-core": { "entry": ["src/index.ts", "src/**/*.test.ts"], "project": ["src/**/*.ts"] },
    "packages/git-ui":   { "entry": ["src/index.ts", "src/icons/setiFileIcon.ts", "src/**/*.test.ts"], "project": ["src/**/*.{ts,vue}"] },
    "packages/kira-ui":  { "entry": ["src/index.ts", "src/**/*.test.ts"], "project": ["src/**/*.{ts,vue}"] }
  }
}
```

The four decisions inside it:

- **`packages/db-fixtures/` is not a workspace and cannot be made one cheaply.** It has no
  `package.json` at all — only `fixtures/` and `support/`. Its files are imported directly by
  `apps/kira-studio/tests/**` and by `tsconfig.tests.json`'s paths. Adding a `package.json` to make
  knip happy would put a fake package in `bun install`'s graph to serve a linter. Instead it is
  `entry` + `project` on the root workspace, so its exports count as reachable and its files are
  still scanned. Stated because SPEC asked for a reason either way.
- **Explicit `entry` for the VS Code extension.** Its `package.json` `main` is
  `./dist/extension.cjs`, a build artifact, so knip cannot reach `src/extension.ts` and declares the
  entire extension dead. This is the single biggest source of the no-config noise.
- **`apps/kira-studio/frontend` needs `index.html` + `src/main.ts`** — it declares no `main`,
  `module` or `exports`.
- **`packages/shared` is entirely `entry`.** It is a leaf type/protocol layer consumed by path alias
  (`@shared/*`) rather than through one index; treating every file as an entry is the honest model.

Left for pass 1 to finish, deliberately not pre-guessed: the run still reports 5 unused
dependencies and 5 unused devDependencies, several of which are genuine false positives with
distinct causes — `@types/vscode` (types-only), `@vscode/codicons` (a CSS/asset import),
`tailwindcss` (used through the Vite plugin and CSS directives). Each needs a look before it becomes
an `ignoreDependencies` entry or a real removal. knip also emits 23 "configuration hints"; fold them
in and delete any `ignore` entry it calls redundant, so the committed config carries nothing dead of
its own.

---

# 5. The pre-commit / pre-push split

SPEC asked for this to be designed. Measured warm, in this container:

| Check | Warm | Cold |
|---|---|---|
| `biome check .` | 2s | 2s |
| `scripts/check-tokens.sh` | 0s | 0s |
| `bun run typecheck` | 13s | 13s |
| `golangci-lint run ./...` | **1s** | **minutes** (empty Go build cache) |
| `knip` | 3s | 3s |

**pre-commit stays exactly as it is**: `bun run lint` then `bun run typecheck`, ~15s. Not one
command is added.

That is a real decision, not inertia. The new Biome rules live inside `biome.json`, so `bun run
lint` enforces them from pass 1 with no change to the hook, no new dependency and no added time.
Everything SPEC wanted per-commit is already per-commit.

**What does not go in pre-commit, and why:**

- **`golangci-lint` — because its cost is bimodal, not because it is slow.** 1s warm is fine; but on
  a fresh clone, after a dependency bump, or after a Go toolchain change, the first run is minutes
  while the build cache refills. A per-commit hook whose p99 is minutes gets routed around with
  `git commit --no-verify`, and `CLAUDE.md` is explicit that this is not a way of working. Put it
  where a multi-minute wait is already expected.
- **`knip` — because it is a whole-graph analysis and per-commit is the wrong granularity.**
  Mid-refactor, deleting a consumer in commit 1 and adding its replacement in commit 2 makes commit
  1 legitimately dirty. Gating the commit punishes a normal, legible commit sequence. Gating the
  push asks the right question: is the tree you are about to share clean?

**`.githooks/pre-push` (new)** runs `go build ./...`, `golangci-lint run`, then `knip`. ~30s warm.
Push is when the work leaves the machine, which is exactly the boundary CI defends.

```sh
#!/bin/sh
# Kira Studio pre-push — P94 §5. The heavier whole-repo checks, run where a cold
# multi-minute wait is acceptable and a per-commit one is not.
# Bypass mid-investigation only: git push --no-verify
set -e

if [ ! -d node_modules ]; then
  echo "pre-push: node_modules is missing — run \`bun install\` first." >&2
  exit 1
fi

go build ./...
bun run lint:go
bun run lint:dead
```

`package.json` gains three scripts, and `prepare` already sets `core.hooksPath`, so the new hook
installs itself with no further wiring:

```
"lint:go":   "sh scripts/install-golangci-lint.sh && \"$(go env GOPATH)/bin/golangci-lint\" run",
"lint:dead": "knip --include files,dependencies,unlisted,duplicates",
"lint:all":  "bun run lint && bun run lint:go && bun run lint:dead"
```

Pass 3 removes `--include` from `lint:dead`. `knip` becomes a root `devDependency` pinned at
`6.37.0` (MIT, fully open source, no paid tier — `CLAUDE.md`'s licence rule checked at the package
level and for the rule types used). `golangci-lint` is deliberately **not** a JS dependency; it is a
Go binary built by its own script.

**`--no-verify` is not a workflow.** Document in the hook comment, as above, that it buys time
mid-investigation only, and that a red hook gets root-caused and fixed.

---

# 6. CI wiring

`.github/workflows/` cannot be pushed from this session (`CLAUDE.md`; `docs/DEV_ENVIRONMENT.md`
`:27`-`:40`). Neither `docs/pending-changes/` nor `docs/pending-workflows/` exists yet — **pass 1
creates `docs/pending-changes/`**, per that section's "create the directory if it doesn't exist".

Write one file, **`docs/pending-changes/.github__workflows__pr.yml.patch`**: a normal `git
diff`-style patch plus a one-line note of why. It adds three steps to the existing `checks` job
(macOS, `timeout-minutes: 15`), placed **after** the existing `- run: bun run lint` /
`bun run typecheck` / `bun run build` steps and **before** `go build ./...`:

1. Cache `~/go/bin/golangci-lint`, keyed on `hashFiles('scripts/install-golangci-lint.sh', 'go.mod')`
   — the script holds the pinned version and `go.mod` holds the toolchain, so both inputs that can
   invalidate the binary are in the key. Mirrors the existing `wails3` cache step exactly.
2. `- run: bun run lint:go`.
3. `- run: bun run lint:dead`.

Three things the patch must get right:

- **Build golangci-lint from source.** Do not add `golangci/golangci-lint-action`; its prebuilt
  binary hits §3's blocker. `bun run lint:go` already calls the installer script.
- **`actions/setup-go` with `go-version-file: go.mod` is already in the job**, so the runner's
  default toolchain is 1.27.1 and the source build succeeds there. No extra Go setup needed.
- **Watch the 15-minute timeout.** The cold golangci-lint source build plus first lint is the new
  long pole. If the patch's own note cannot promise it fits, raise `timeout-minutes` to 20 in the
  same patch rather than leaving CI to discover it.

Do not touch `.github/workflows/pr.yml` itself. The user applies the patch and deletes the pending
file in the same commit.

---

# 7. File by file — pass 1

**New:**

- `.golangci.yml` — §4.1.
- `knip.json` — §4.4.
- `scripts/install-golangci-lint.sh` — §3.3, `chmod +x`.
- `.githooks/pre-push` — §5, `chmod +x`.
- `docs/pending-changes/.github__workflows__pr.yml.patch` — §6.

**Changed:**

- `package.json` — `lint:go`, `lint:dead`, `lint:all` scripts; `knip@6.37.0` devDependency.
  `bun.lock` follows.
- `biome.json` — the `performance` block of §4.3. Nothing else.
- `docs/DEV_ENVIRONMENT.md` — a short section on the three tools: the `GOTOOLCHAIN` pin and *why*
  (§3.1 is exactly the kind of container quirk that file exists for), that the prebuilt binary and
  the GitHub action both fail, the pre-commit/pre-push split, and the cold-cache cost. This is an
  environment fact, so it belongs there and not in `CLAUDE.md`.
- `docs/ARCHITECTURE.md` — one line in the tooling section naming the three checks. No "Known open
  items" entry: pass 1 leaves nothing open that is not a named later pass.
- `docs/v1.8/SPEC.md` — P94's result section, plus a new **`P95`** row proposing `errcheck` +
  `staticcheck` (269 findings), per `CLAUDE.md`'s rule that a deferred fix becomes a named phase
  rather than a line in a result section. `P95` is the next free number (P93 is the current high).

**Fixed (~93 findings):** Go files across `apps/kira-studio/internal/**` for the §4.1 set; TS/Vue
files for the four Biome performance rules; whatever knip's four pass-1 rule types leave after
§4.4's dependency triage.

---

# 8. Tests

**No new unit tests.** `CLAUDE.md`'s bar is explicit, and nothing here clears it: config files, two
shell scripts, a dependency bump, and a body of mechanical fixes. There is no parser, no boundary
arithmetic, no cache invalidation, no concurrency. The linters are themselves the test, and they run
in two hooks and CI.

**Every existing test must stay green, unedited.** That is the real check on pass 1. A `prealloc`,
`copyloopvar`, `unconvert`, `rangeValCopy` or `stringXbytes` fix is behaviour-preserving by
construction; if a test goes red, the fix was wrong, and the fix gets corrected — never the test.
The one place to be careful is `unused`: deleting a genuinely-unused symbol is safe, but check for a
build-tag-only consumer first (`watch_fsnotify.go`'s `watcherBackend` and
`keychain_other.go`'s `serviceNameForDataSource` both sit in build-tag-split files — verify with a
`GOOS=darwin` and a default build before deleting either).

**`noReExportAll`'s 8 fixes touch package barrels** (`packages/*/src/index.ts`). Converting
`export *` to named re-exports can silently drop an export. After each one, `bun run typecheck` must
pass across all five projects — that is what proves nothing was lost.

---

# 9. Order of work

**One sequential Sonnet subagent.** SPEC asked whether the sub-pieces parallelise. They do not, and
the reason is file-level, not stylistic:

- `package.json` gains `lint:go` and `lint:dead` in the same edit. Three concurrent agents — Biome,
  golangci, knip — would all rewrite that one file.
- `.githooks/pre-push` and the CI patch must name the final command set from **all three** configs.
  Neither can be written until all three are settled, so both are a join point by construction.
- Within the TS half, knip's unused-file deletions and `noReExportAll`'s barrel rewrites both edit
  `packages/*/src/index.ts`. Direct conflict on the same lines.

The one genuinely disjoint seam is **Go fixes vs. TS fixes** — different files, different tools, no
overlap. But the Go half is the smaller one in pass 1, and the shared `package.json`/hook/CI files
sit between them either way. `CLAUDE.md` defaults to one sequential subagent unless independence is
genuine; here it is not. The same holds for passes 2-4.

Commits, in order — each is a working tree, and the tooling lands before anything it would flag:

1. `build: install golangci-lint from source against the repo's Go toolchain` — §3.3's script,
   plus the `docs/DEV_ENVIRONMENT.md` section explaining the `GOTOOLCHAIN` pin. Nothing enforces yet.
2. `chore: add the golangci-lint config, no linter enabled that is not already clean` — §4.1's
   `.golangci.yml` with only `bodyclose`, `makezero`, `govet` (all 0 findings). Green immediately;
   proves the config and the binary before any fix rides on them.
3. `fix: clear the Go dead-code and redundancy findings` — `unused` (11), `ineffassign` (1),
   `unconvert` (1), `copyloopvar` (5), each added to `enable:` as its findings reach zero.
4. `perf: clear the Go performance findings` — `prealloc` (4 non-test) and `gocritic`'s performance
   tag (34), added to `enable:` in the same commit that empties them. Chunk by package if the diff
   gets unreadable; several commits here are better than one.
5. `chore: enable Biome's performance rules` — §4.3's four rules plus their 12 fixes, in one commit
   so the tree is never red.
6. `chore: add knip and its monorepo config` — §4.4, `knip.json`, the devDependency, the dependency
   triage, and the 8 unused-file decisions.
7. `build: add a pre-push hook for the whole-repo checks` — §5's hook and the three
   `package.json` scripts.
8. `ci: add complexity, dead-code and performance checks to the PR checks job` — §6's patch file
   under a newly created `docs/pending-changes/`.
9. `docs(v1.8): record P94 pass 1 and open P95 for errcheck/staticcheck` — §7's `SPEC.md` and
   `ARCHITECTURE.md` edits.

Conventional Commits; each message ends with the two attribution lines this session uses.

---

# 10. Verification

**Per commit (cheap):** `bun run lint`, `bun run typecheck`, and from commit 2 onward
`bun run lint:go`. Each must pass on a **normal, non-bypassed** commit. If a hook goes red, root-
cause and fix it — `--no-verify` buys time inside an investigation and never ends one.

**Once, near the end** (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `bun run lint:all` — all three tools clean against pass 1's enabled sets.
- `go build ./...`, `go vet ./...`, `go test ./...`. `internal/grpcclient`'s reflection test has a
  known port race; if it flakes, note it for pass 4 rather than fixing it here — pass 4 owns it.
- `bun run build`, `bun run build:vscode`, `bun run test:unit` (expect 1517 passed, 0 failed —
  P93's own count; any change is this pass's doing and gets fixed here).
- `bun run test:webview`.
- `bun run test:ui`. Expect the known pre-existing failures documented in this chapter's result
  sections; **do not fix them in this pass** — pass 4 is the dedicated sweep, and fixing them before
  passes 2-3's refactors land would mean doing it twice. Record what failed so pass 4's plan starts
  from a real list.

**Checks specific to this phase's own risk:**

1. `GOTOOLCHAIN=local go version` still reports the container's default. Re-run
   `scripts/install-golangci-lint.sh` on a machine with an empty `GOPATH/bin` and confirm the
   binary it produces reports `built with go1.27.1`, not go1.26.x. This is §3's whole claim; verify
   it rather than inherit it.
2. Delete `~/go/bin/golangci-lint`, run `bun run lint:go`, and confirm the script rebuilds it and
   the second invocation skips the build.
3. `git push` on a throwaway branch actually triggers `.githooks/pre-push` (`core.hooksPath` is set
   by `prepare`; a clone that never ran `bun install` has no hook at all — confirm the script's
   `node_modules` guard fires cleanly rather than erroring obscurely).
4. Re-run knip after the barrel rewrites of commit 5. `noReExportAll` changes what knip can see;
   the numbers in §1 were taken before it, and commit 6's baseline must be re-measured, not assumed.

# 11. Passes 2-4, in shape

Full plans get written against the tree each previous pass leaves — `CLAUDE.md`'s rule is that a
planning pass re-reads the current source rather than trusting the last pass's prose. Sketches only:

**Pass 2 — Go complexity (`-iter2.md`).** Add `gocognit`/`gocyclo` at `min-complexity: 30` with
`_test.go` excluded, and refactor the 47 + 4 non-test functions in the same pass. Order by package
so each commit is one subsystem; start with the tail (`144, 134, 107, 91, 89` — `internal/gitrpc`'s
`(*Router).ForConn` at cyclomatic 65, `internal/gitops`'s `ClassifyOpError` at 46, the kafka
adapter's `readTopic` at 72), because those are where extraction is both hardest and most valuable.
Re-measure first: passes 1's `gocritic` fixes will have moved some scores.

**Pass 3 — TS/Vue complexity and dead exports (`-iter3.md`).** Add Biome's
`noExcessiveCognitiveComplexity` at 30 (21 functions) and drop `--include` from `lint:dead`, fixing
knip's `exports`/`types` findings (71 + 46 before pass 1's barrel changes; re-measure). Expect a
meaningful share of the export findings to be test-only helpers and intentional public API — each
needs a judgement, so budget for triage, not just deletion.

**Pass 4 — the flake sweep (`-iter4.md`).** The list SPEC names, re-grepped from this chapter's
result sections at the time: `cell-editor.spec.ts`'s timing bound, `grpc-request.spec.ts`'s debounce
assertion, `sql-schema.spec.ts`'s stray `.suggest-widget.visible` case,
`http-request-body.spec.ts`'s 500-byte payload threshold, `repo-workspace.spec.ts`'s search-ordering
case, `scroll-trace.spec.ts`'s load-timing flake, `internal/grpcclient`'s reflection-test port race,
and the Monaco-loading timeout that produced 47 `test:ui` failures in P90 and P93 alike. The Monaco
one is the substantial item and probably a resource-contention problem under `workers: '100%'`
rather than 47 separate bugs — treat it as one root cause, and re-read
`apps/kira-studio/playwright.config.ts`'s own comments on worker counts before changing anything.
Also clear the two long-standing Biome findings every phase in this chapter has recorded
(`UncommittedChangesStrip.vue:49` `useShorthandFunctionType`, `RequestSettingsPane.vue:2`
`useImportType`) — both are a warning/info so `biome check` exits 0 today, which is precisely why
they have survived a dozen phases.

# 12. Out of scope

- **`errcheck`, `staticcheck`, `nilerr`, `usestdlibvars`** and every other linter in §4.1's declined
  table. `P95` carries the first two.
- **Lowering the complexity threshold below 30** (§4.2).
- **Autofix in any hook**, and `biome check --write` as a hook step.
- **`.github/workflows/` itself.** Pass 1 writes a patch file; it never edits the workflow (§6).
- **The other workflows** (`container-tests`, `ui`, `release`). Only `pr.yml`'s `checks` job is in
  scope, as SPEC states.
- **`tests/e2e-real/`, `test:compat`, `test:matrix`** and anything needing Docker. Container work is
  its own environment problem (`docs/DEV_ENVIRONMENT.md`) and no linter here touches it.
- **P93's git-graph work.** Independent phase, different subsystem; the two can land in either
  order.
